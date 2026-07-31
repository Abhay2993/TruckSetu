/**
 * Accounting: GST reconciliation, TDS on freight, and ERP export.
 *
 * GSTR-1 (what you billed) was the easy half. The half that actually locks
 * a dealer in is the other side: matching purchase invoices against GSTR-2A
 * /2B, working out how much input tax credit is genuinely claimable, and
 * getting TDS under section 194C right. Once a dealer's books reconcile
 * through TruckSetu, migrating means re-doing a year of filings — which is
 * why accounting integrations are the stickiest software there is.
 *
 * GST NOTE: road transport (GTA) is commonly 5% under reverse charge, where
 * the RECIPIENT pays the tax and the transporter does not charge it. Which
 * treatment applies depends on the registration and the forward-charge
 * election. The engine models both and flags which one it applied — confirm
 * with a CA before filing anything real.
 *
 * TDS NOTE: under 194C, TDS on transport payments is NOT deductible when the
 * transporter owns ten or fewer goods carriages and furnishes a declaration
 * with their PAN. That exemption is modelled explicitly because it applies
 * to most owner-drivers on this platform.
 */

import { db } from './db';
import { EscrowShipment } from './types';

export const TAX = {
  GST_RATE: 0.05,
  /** 194C: 1% when the payee is an individual/HUF, 2% otherwise. */
  TDS_RATE_INDIVIDUAL: 0.01,
  TDS_RATE_ENTITY: 0.02,
  /** No TDS below this per single payment... */
  TDS_SINGLE_PAYMENT_THRESHOLD: 30000,
  /** ...or below this in aggregate across the financial year. */
  TDS_ANNUAL_THRESHOLD: 100000,
} as const;

export type GstTreatment = 'reverse_charge' | 'forward_charge';

function invoiceNo(shipment: EscrowShipment): string {
  return `TS-INV-${shipment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// TDS on freight (section 194C)
// ---------------------------------------------------------------------------

export interface TdsAssessment {
  applicable: boolean;
  ratePercent: number;
  amountInr: number;
  reason: string;
}

/**
 * Small-fleet owner-drivers are exempt on declaration; everyone else is
 * assessed against both the per-payment and annual thresholds.
 */
export function assessTds(
  paymentInr: number,
  annualPaidInr: number,
  opts: { smallFleetDeclaration: boolean; payeeIsIndividual: boolean },
): TdsAssessment {
  if (opts.smallFleetDeclaration) {
    return {
      applicable: false,
      ratePercent: 0,
      amountInr: 0,
      reason: '194C(6): transporter owns ≤10 goods carriages and has furnished PAN + declaration.',
    };
  }
  const crossesSingle = paymentInr > TAX.TDS_SINGLE_PAYMENT_THRESHOLD;
  const crossesAnnual = annualPaidInr + paymentInr > TAX.TDS_ANNUAL_THRESHOLD;
  if (!crossesSingle && !crossesAnnual) {
    return {
      applicable: false,
      ratePercent: 0,
      amountInr: 0,
      reason: `Below both thresholds (₹${TAX.TDS_SINGLE_PAYMENT_THRESHOLD} single / ₹${TAX.TDS_ANNUAL_THRESHOLD} annual).`,
    };
  }
  const rate = opts.payeeIsIndividual ? TAX.TDS_RATE_INDIVIDUAL : TAX.TDS_RATE_ENTITY;
  return {
    applicable: true,
    ratePercent: rate * 100,
    amountInr: Math.round(paymentInr * rate),
    reason: crossesSingle
      ? 'Single payment above ₹30,000.'
      : 'Aggregate payments for the year above ₹1,00,000.',
  };
}

// ---------------------------------------------------------------------------
// GSTR-2A/2B reconciliation
// ---------------------------------------------------------------------------

export type MatchStatus = 'matched' | 'missing_in_portal' | 'missing_in_books' | 'value_mismatch';

export interface ReconRow {
  invoiceNo: string;
  shipmentId: string | null;
  route: string;
  booksTaxableInr: number | null;
  booksGstInr: number | null;
  portalTaxableInr: number | null;
  portalGstInr: number | null;
  status: MatchStatus;
  /** ITC claimable from this line right now. */
  itcClaimableInr: number;
  note: string;
}

export interface PortalInvoice {
  invoiceNo: string;
  taxableValueInr: number;
  gstInr: number;
}

export interface Reconciliation {
  period: string;
  treatment: GstTreatment;
  rows: ReconRow[];
  summary: {
    booksCount: number;
    portalCount: number;
    matched: number;
    missingInPortal: number;
    missingInBooks: number;
    valueMismatch: number;
    itcClaimableInr: number;
    itcBlockedInr: number;
  };
}

/**
 * Match the dealer's own invoices against what suppliers actually filed.
 *
 * ITC is only claimable once the supplier has filed — the whole point of
 * 2A/2B matching. Anything missing from the portal is blocked credit and a
 * follow-up with the supplier, which is precisely the workflow that keeps
 * finance teams inside the tool.
 */
export function reconcile(
  dealerId: string,
  portalInvoices: PortalInvoice[],
  treatment: GstTreatment = 'reverse_charge',
): Reconciliation {
  const mine = db.shipments.filter((s) => s.dealerId === dealerId);
  const portalByNo = new Map(portalInvoices.map((p) => [p.invoiceNo, p]));
  const seen = new Set<string>();
  const rows: ReconRow[] = [];

  for (const shipment of mine) {
    const no = invoiceNo(shipment);
    seen.add(no);
    // Must match the invoice exactly, detention included — reconciling a
    // different taxable base than the one billed manufactures mismatches.
    const booksTaxableInr = shipment.totalAmountInr + (shipment.detention?.chargeInr ?? 0);
    const booksGstInr = Math.round(booksTaxableInr * TAX.GST_RATE);
    const portal = portalByNo.get(no);

    if (!portal) {
      rows.push({
        invoiceNo: no,
        shipmentId: shipment.id,
        route: `${shipment.origin} → ${shipment.destination}`,
        booksTaxableInr,
        booksGstInr,
        portalTaxableInr: null,
        portalGstInr: null,
        status: 'missing_in_portal',
        itcClaimableInr: 0,
        note: 'Not filed by the supplier yet — credit blocked until it appears in 2B.',
      });
      continue;
    }

    const valuesAgree =
      portal.taxableValueInr === booksTaxableInr && portal.gstInr === booksGstInr;
    rows.push({
      invoiceNo: no,
      shipmentId: shipment.id,
      route: `${shipment.origin} → ${shipment.destination}`,
      booksTaxableInr,
      booksGstInr,
      portalTaxableInr: portal.taxableValueInr,
      portalGstInr: portal.gstInr,
      status: valuesAgree ? 'matched' : 'value_mismatch',
      // Under reverse charge the recipient pays the tax and claims it back;
      // under forward charge the credit follows the supplier's filing.
      itcClaimableInr: valuesAgree
        ? treatment === 'reverse_charge'
          ? booksGstInr
          : portal.gstInr
        : Math.min(booksGstInr, portal.gstInr),
      note: valuesAgree
        ? 'Matched with the portal.'
        : `Value mismatch: books ₹${booksTaxableInr} vs portal ₹${portal.taxableValueInr}. Credit limited to the lower.`,
    });
  }

  // Anything the portal shows that the books do not know about.
  for (const portal of portalInvoices) {
    if (seen.has(portal.invoiceNo)) continue;
    rows.push({
      invoiceNo: portal.invoiceNo,
      shipmentId: null,
      route: '—',
      booksTaxableInr: null,
      booksGstInr: null,
      portalTaxableInr: portal.taxableValueInr,
      portalGstInr: portal.gstInr,
      status: 'missing_in_books',
      itcClaimableInr: 0,
      note: 'In the portal but not in your books — record it or query the supplier.',
    });
  }

  const count = (s: MatchStatus) => rows.filter((r) => r.status === s).length;
  return {
    period: new Date().toISOString().slice(0, 7),
    treatment,
    rows,
    summary: {
      booksCount: mine.length,
      portalCount: portalInvoices.length,
      matched: count('matched'),
      missingInPortal: count('missing_in_portal'),
      missingInBooks: count('missing_in_books'),
      valueMismatch: count('value_mismatch'),
      itcClaimableInr: rows.reduce((sum, r) => sum + r.itcClaimableInr, 0),
      itcBlockedInr: rows.reduce(
        (sum, r) => sum + Math.max(0, (r.booksGstInr ?? 0) - r.itcClaimableInr),
        0,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// ERP connectors
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tallyDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Tally XML vouchers — Tally Prime imports this directly (Gateway → Import
 * Data → Vouchers). Sales voucher per shipment with freight and GST split
 * into separate ledger entries, which is how a Tally user expects to see it.
 */
export function toTallyXml(shipments: EscrowShipment[], companyName = 'TruckSetu'): string {
  const vouchers = shipments
    .map((s) => {
      const freight = s.totalAmountInr;
      const gst = Math.round(freight * TAX.GST_RATE);
      const total = freight + gst;
      const detention = s.detention?.chargeInr ?? 0;
      return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create">
        <DATE>${tallyDate(s.events[0]?.at ?? Date.now())}</DATE>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${escapeXml(invoiceNo(s))}</VOUCHERNUMBER>
        <REFERENCE>${escapeXml(s.consignmentNo ?? s.id)}</REFERENCE>
        <NARRATION>Freight ${escapeXml(s.origin)} to ${escapeXml(s.destination)} · ${escapeXml(s.truckNumber)}</NARRATION>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Freight Income</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${freight}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Output GST 5%</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${gst}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>${
          detention > 0
            ? `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Detention Charges</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${detention}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`
            : ''
        }
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(s.driverName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${total + detention}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
    })
    .join('\n');

  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
${vouchers}
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/** Zoho Books bulk-invoice JSON (POST /invoices, or CSV import). */
export function toZohoBooks(shipments: EscrowShipment[]): unknown {
  return {
    invoices: shipments.map((s) => {
      const freight = s.totalAmountInr;
      const detention = s.detention?.chargeInr ?? 0;
      return {
        invoice_number: invoiceNo(s),
        date: new Date(s.events[0]?.at ?? Date.now()).toISOString().slice(0, 10),
        customer_name: s.driverName,
        reference_number: s.consignmentNo ?? s.id,
        notes: `${s.origin} → ${s.destination} · ${s.truckNumber}`,
        line_items: [
          {
            name: `Freight ${s.origin} → ${s.destination}`,
            rate: freight,
            quantity: 1,
            tax_percentage: TAX.GST_RATE * 100,
          },
          ...(detention > 0
            ? [
                {
                  name: 'Detention / demurrage',
                  rate: detention,
                  quantity: 1,
                  tax_percentage: TAX.GST_RATE * 100,
                },
              ]
            : []),
        ],
      };
    }),
  };
}

/**
 * SAP-style flat file. Real SAP landscapes ingest IDoc or a BAPI call; the
 * pipe-delimited posting file below is the format most Indian SAP shops
 * accept for third-party invoice upload, and maps 1:1 onto an FI posting.
 */
export function toSapFlatFile(shipments: EscrowShipment[]): string {
  const header = 'BUKRS|BELNR|BLDAT|LIFNR|WRBTR|MWSKZ|SGTXT';
  const rows = shipments.map((s) => {
    const freight = s.totalAmountInr;
    const gst = Math.round(freight * TAX.GST_RATE);
    const date = new Date(s.events[0]?.at ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
    const text = `${s.origin}-${s.destination} ${s.truckNumber}`.replace(/\|/g, ' ');
    return `1000|${invoiceNo(s)}|${date}|${s.truckNumber.replace(/[^A-Z0-9]/gi, '')}|${freight + gst}|G5|${text}`;
  });
  return [header, ...rows].join('\n');
}
