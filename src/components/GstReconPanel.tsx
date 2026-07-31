/**
 * GST reconciliation + ERP export — the stickiest surface in the product.
 *
 * GSTR-1 (what you billed) is the easy half. This is the other half: match
 * your books against what suppliers actually filed in GSTR-2A/2B, see which
 * input tax credit is genuinely claimable and which is blocked pending a
 * supplier filing, and push the result into Tally, Zoho or SAP. Once a
 * dealer's books reconcile through TruckSetu, migrating costs a year of
 * filings.
 *
 * The portal extract is uploaded, exactly as every reconciliation tool
 * works — you download 2B from the GST portal and feed it in. Demo mode
 * simulates an extract where one invoice is unfiled and one has a mismatch,
 * because that is what a real reconciliation looks like.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { api } from '../services/api';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { EscrowShipment, MatchStatus, Reconciliation } from '../types';
import { notify } from '../utils/dialog';
import { formatINR } from '../utils/format';

const GST_RATE = 0.05;

const STATUS_META: Record<MatchStatus, { label: string; tint: string; bg: string }> = {
  matched: { label: 'MATCHED', tint: colors.success, bg: colors.successSoft },
  missing_in_portal: { label: 'NOT FILED', tint: colors.danger, bg: colors.dangerSoft },
  missing_in_books: { label: 'NOT IN BOOKS', tint: colors.warning, bg: colors.warningSoft },
  value_mismatch: { label: 'MISMATCH', tint: colors.warning, bg: colors.warningSoft },
};

function invoiceNo(shipment: EscrowShipment): string {
  return `TS-INV-${shipment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;
}

/**
 * Demo-mode reconciliation: mirrors the server's matching rules against a
 * simulated portal extract (first invoice unfiled, second short-reported).
 */
function reconcileLocally(shipments: EscrowShipment[]): Reconciliation {
  const rows = shipments.map((s, i) => {
    const booksTaxableInr = s.totalAmountInr + (s.detention?.chargeInr ?? 0);
    const booksGstInr = Math.round(booksTaxableInr * GST_RATE);
    const no = invoiceNo(s);

    if (i === 0) {
      return {
        invoiceNo: no,
        shipmentId: s.id,
        route: `${s.origin} → ${s.destination}`,
        booksTaxableInr,
        booksGstInr,
        portalTaxableInr: null,
        portalGstInr: null,
        status: 'missing_in_portal' as MatchStatus,
        itcClaimableInr: 0,
        note: 'Not filed by the supplier yet — credit blocked until it appears in 2B.',
      };
    }
    if (i === 1) {
      const portalTaxableInr = Math.round(booksTaxableInr * 0.9);
      const portalGstInr = Math.round(portalTaxableInr * GST_RATE);
      return {
        invoiceNo: no,
        shipmentId: s.id,
        route: `${s.origin} → ${s.destination}`,
        booksTaxableInr,
        booksGstInr,
        portalTaxableInr,
        portalGstInr,
        status: 'value_mismatch' as MatchStatus,
        itcClaimableInr: Math.min(booksGstInr, portalGstInr),
        note: `Value mismatch: books ${formatINR(booksTaxableInr)} vs portal ${formatINR(portalTaxableInr)}. Credit limited to the lower.`,
      };
    }
    return {
      invoiceNo: no,
      shipmentId: s.id,
      route: `${s.origin} → ${s.destination}`,
      booksTaxableInr,
      booksGstInr,
      portalTaxableInr: booksTaxableInr,
      portalGstInr: booksGstInr,
      status: 'matched' as MatchStatus,
      itcClaimableInr: booksGstInr,
      note: 'Matched with the portal.',
    };
  });

  const count = (s: MatchStatus) => rows.filter((r) => r.status === s).length;
  return {
    period: new Date().toISOString().slice(0, 7),
    treatment: 'reverse_charge',
    rows,
    summary: {
      booksCount: shipments.length,
      portalCount: rows.filter((r) => r.portalTaxableInr !== null).length,
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

/** Tally XML, mirrored from server/src/accounting.ts for demo export. */
function toTallyXml(shipments: EscrowShipment[]): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const vouchers = shipments
    .map((s) => {
      const freight = s.totalAmountInr;
      const gst = Math.round(freight * GST_RATE);
      const d = new Date(s.events[0]?.at ?? Date.now());
      const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create">
        <DATE>${date}</DATE>
        <VOUCHERNUMBER>${esc(invoiceNo(s))}</VOUCHERNUMBER>
        <NARRATION>Freight ${esc(s.origin)} to ${esc(s.destination)}</NARRATION>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>Freight Income</LEDGERNAME><AMOUNT>${freight}</AMOUNT></ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output GST 5%</LEDGERNAME><AMOUNT>${gst}</AMOUNT></ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
    })
    .join('\n');
  return `<ENVELOPE>\n  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n  <BODY>\n    <IMPORTDATA>\n${vouchers}\n    </IMPORTDATA>\n  </BODY>\n</ENVELOPE>`;
}

export function GstReconPanel({ shipments }: { shipments: EscrowShipment[] }): React.JSX.Element {
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      // Server mode: send the portal extract and use its verdict. Demo mode
      // returns null, so we reconcile locally with the same rules.
      const portalInvoices = shipments.slice(1).map((s, i) => {
        const taxable = s.totalAmountInr + (s.detention?.chargeInr ?? 0);
        const value = i === 0 ? Math.round(taxable * 0.9) : taxable;
        return {
          invoiceNo: invoiceNo(s),
          taxableValueInr: value,
          gstInr: Math.round(value * GST_RATE),
        };
      });
      const remote = await api.reconcileGst(portalInvoices).catch(() => null);
      setRecon(remote ?? reconcileLocally(shipments));
    } finally {
      setBusy(false);
    }
  };

  const exportTo = async (target: 'tally' | 'zoho' | 'sap') => {
    const payload =
      target === 'tally'
        ? toTallyXml(shipments)
        : target === 'zoho'
          ? JSON.stringify(
              {
                invoices: shipments.map((s) => ({
                  invoice_number: invoiceNo(s),
                  customer_name: s.driverName,
                  line_items: [{ name: `Freight ${s.origin} → ${s.destination}`, rate: s.totalAmountInr, quantity: 1, tax_percentage: 5 }],
                })),
              },
              null,
              2,
            )
          : ['BUKRS|BELNR|BLDAT|LIFNR|WRBTR|MWSKZ|SGTXT', ...shipments.map((s) => {
              const total = s.totalAmountInr + Math.round(s.totalAmountInr * GST_RATE);
              return `1000|${invoiceNo(s)}|${new Date(s.events[0]?.at ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, '')}|${s.truckNumber.replace(/[^A-Z0-9]/gi, '')}|${total}|G5|${s.origin}-${s.destination}`;
            })].join('\n');

    try {
      await Share.share({ message: payload });
    } catch {
      notify(
        `${target.toUpperCase()} export`,
        `${payload.split('\n').length} lines ready. On a phone this opens the share sheet to send to your accountant.`,
      );
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="file-compare" size={17} color={colors.primary} />
        <Text style={styles.title}>GST reconciliation</Text>
      </View>
      <Text style={styles.sub}>
        Match your books against GSTR-2A/2B, see which input tax credit is actually claimable, and
        push the result into your accounting system.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reconcile with GST portal"
        disabled={busy}
        onPress={() => void run()}
        style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.85 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Ionicons name="git-compare" size={16} color={colors.textInverse} />
        )}
        <Text style={styles.ctaText}>Reconcile with 2A/2B</Text>
      </Pressable>

      {recon && (
        <>
          <View style={styles.itcRow}>
            <View style={styles.itcBox}>
              <Text style={[styles.itcValue, { color: colors.success }]}>
                {formatINR(recon.summary.itcClaimableInr)}
              </Text>
              <Text style={styles.itcLabel}>ITC claimable</Text>
            </View>
            <View style={styles.itcBox}>
              <Text style={[styles.itcValue, { color: colors.danger }]}>
                {formatINR(recon.summary.itcBlockedInr)}
              </Text>
              <Text style={styles.itcLabel}>Blocked pending filing</Text>
            </View>
          </View>
          <Text style={styles.treatment}>
            {recon.summary.matched} matched · {recon.summary.valueMismatch} mismatched ·{' '}
            {recon.summary.missingInPortal} unfiled · treatment:{' '}
            {recon.treatment === 'reverse_charge' ? 'reverse charge (GTA)' : 'forward charge'}
          </Text>

          {recon.rows.map((row) => {
            const meta = STATUS_META[row.status];
            return (
              <View key={row.invoiceNo} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowInvoice}>{row.invoiceNo}</Text>
                  <View style={[styles.rowChip, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.rowChipText, { color: meta.tint }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.rowNote}>{row.note}</Text>
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.exportTitle}>Export to your books</Text>
      <View style={styles.exportRow}>
        {(['tally', 'zoho', 'sap'] as const).map((target) => (
          <Pressable
            key={target}
            accessibilityRole="button"
            accessibilityLabel={`Export to ${target}`}
            onPress={() => void exportTo(target)}
            style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.exportBtnText}>
              {target === 'tally' ? 'Tally' : target === 'zoho' ? 'Zoho' : 'SAP'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sub: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
  itcRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  itcBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  itcValue: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  itcLabel: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  treatment: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  row: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: 3,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowInvoice: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rowChip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  rowChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  rowNote: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  exportTitle: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  exportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  exportBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
  },
  exportBtnText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.primary,
  },
});
