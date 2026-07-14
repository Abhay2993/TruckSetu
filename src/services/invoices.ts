/**
 * GST invoices, ledger summary and lane-rate analytics.
 *
 * All three derive purely from shipment/load data the stores already hold
 * (and already sync from the server), so demo and server mode share one
 * code path with zero drift. Production upgrades: sequential invoice
 * numbering server-side, PDF rendering, and e-way bill generation via the
 * NIC EWB API — the shapes here are ready for all three.
 *
 * GST note: road transport (GTA) is commonly 5% under reverse charge —
 * confirm the correct treatment for your registration with a CA before
 * issuing real invoices. The rate is one constant below.
 */

import type { EscrowShipment, Load } from '../types';
import { splitAmounts } from '../stores/useEscrowStore';

export const GST_RATE = 0.05;

export interface Invoice {
  number: string;
  shipmentId: string;
  route: string;
  driverName: string;
  truckNumber: string;
  date: number;
  baseAmountInr: number;
  gstInr: number;
  totalInr: number;
  /** PAID once the escrow fully settles; else the escrow state. */
  status: 'PAID' | 'IN ESCROW' | 'PENDING';
  advanceInr: number;
  balanceInr: number;
  /** Placeholder until NIC e-way bill API integration. */
  ewayBillNumber: string | null;
}

export function buildInvoice(shipment: EscrowShipment): Invoice {
  const { advanceInr, balanceInr } = splitAmounts(shipment);
  const gstInr = Math.round(shipment.totalAmountInr * GST_RATE);
  const suffix = shipment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return {
    number: `TS-INV-${suffix}`,
    shipmentId: shipment.id,
    route: `${shipment.origin} → ${shipment.destination}`,
    driverName: shipment.driverName,
    truckNumber: shipment.truckNumber,
    date: shipment.events[0]?.at ?? Date.now(),
    baseAmountInr: shipment.totalAmountInr,
    gstInr,
    totalInr: shipment.totalAmountInr + gstInr,
    status:
      shipment.stage === 'BALANCE_RELEASED'
        ? 'PAID'
        : shipment.stage === 'CREATED'
          ? 'PENDING'
          : 'IN ESCROW',
    advanceInr,
    balanceInr,
    ewayBillNumber: shipment.ewayBillNumber ?? null,
  };
}

export interface LedgerSummary {
  shipmentCount: number;
  freightInr: number;
  gstInr: number;
  paidOutInr: number;
  inEscrowInr: number;
}

/** Totals across all shipments — the dealer's one-glance money position. */
export function buildLedgerSummary(shipments: EscrowShipment[]): LedgerSummary {
  return shipments.reduce<LedgerSummary>(
    (acc, s) => {
      const { advanceInr, balanceInr } = splitAmounts(s);
      const paid =
        s.stage === 'BALANCE_RELEASED'
          ? s.totalAmountInr
          : s.stage === 'ADVANCE_PAID' || s.stage === 'POD_UPLOADED'
            ? advanceInr
            : 0;
      const locked =
        s.stage === 'ADVANCE_PAID' || s.stage === 'POD_UPLOADED' ? balanceInr : 0;
      return {
        shipmentCount: acc.shipmentCount + 1,
        freightInr: acc.freightInr + s.totalAmountInr,
        gstInr: acc.gstInr + Math.round(s.totalAmountInr * GST_RATE),
        paidOutInr: acc.paidOutInr + paid,
        inEscrowInr: acc.inEscrowInr + locked,
      };
    },
    { shipmentCount: 0, freightInr: 0, gstInr: 0, paidOutInr: 0, inEscrowInr: 0 },
  );
}

export interface LaneRate {
  lane: string;
  tripCount: number;
  avgInr: number;
  minInr: number;
  maxInr: number;
  /** Average asking price of currently open loads on this lane, if any. */
  marketAskInr: number | null;
}

/**
 * Lane-rate analytics over the last 30 days of agreed shipment prices,
 * enriched with the current open-load ask — "Delhi→Jaipur averaged ₹41,500
 * this month" is exactly what prices the next load correctly.
 */
export function buildLaneRates(shipments: EscrowShipment[], loads: Load[]): LaneRate[] {
  const windowStart = Date.now() - 30 * 24 * 3600 * 1000;
  const byLane = new Map<string, number[]>();

  for (const s of shipments) {
    const startedAt = s.events[0]?.at ?? 0;
    if (startedAt < windowStart) continue;
    const lane = `${s.origin} → ${s.destination}`;
    byLane.set(lane, [...(byLane.get(lane) ?? []), s.totalAmountInr]);
  }

  return [...byLane.entries()]
    .map(([lane, amounts]) => {
      const openAsks = loads
        .filter((l) => l.status === 'open' && `${l.origin} → ${l.destination}` === lane)
        .map((l) => l.priceInr);
      return {
        lane,
        tripCount: amounts.length,
        avgInr: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
        minInr: Math.min(...amounts),
        maxInr: Math.max(...amounts),
        marketAskInr: openAsks.length
          ? Math.round(openAsks.reduce((a, b) => a + b, 0) / openAsks.length)
          : null,
      };
    })
    .sort((a, b) => b.tripCount - a.tripCount);
}
