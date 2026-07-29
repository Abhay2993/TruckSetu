/**
 * Compliance: e-Way bills, GSTR-1 summaries, and Aadhaar-eSigned contracts.
 *
 * e-Way bill — `generateEwayBill` calls the NIC EWB API when NIC_EWB_* env
 * vars are set (production needs GSP onboarding: gstin, username, app key);
 * otherwise it issues a simulated 12-digit EBN with the real validity rule
 * (1 day per 200 km).
 *
 * Contracts — every shipment can render a deterministic digital LR whose
 * SHA-256 hash is the tamper-evidence anchor. Signing is per-party;
 * production wires NSDL/Protean Aadhaar eSign (OTP → signature) where
 * `signShipmentContract` currently accepts the dev OTP.
 */

import crypto from 'crypto';
import { EscrowShipment } from './types';

const NIC_CONFIGURED = Boolean(process.env.NIC_EWB_GSTIN && process.env.NIC_EWB_APP_KEY);

export function generateEwayBill(
  shipment: EscrowShipment,
  distanceKm = 300,
): { ewayBillNumber: string; validUntil: number; mode: 'nic' | 'simulated' } {
  if (NIC_CONFIGURED) {
    // Production: POST to the NIC EWB API (via your GSP) with the invoice
    // payload and return its EBN. Structure kept identical so only this
    // branch changes.
    throw new Error('NIC EWB API call not implemented — plug your GSP client here.');
  }
  // Simulated 12-digit EBN; validity per NIC rule: 1 day per 200 km.
  const ewayBillNumber = String(
    1e11 + Math.floor(Math.random() * 9e11),
  ).slice(0, 12);
  const validityDays = Math.max(1, Math.ceil(distanceKm / 200));
  return {
    ewayBillNumber,
    validUntil: Date.now() + validityDays * 24 * 3600 * 1000,
    mode: 'simulated',
  };
}

/**
 * The digital LR — issued as the LEGAL ORIGINAL consignment note, not a
 * summary of a paper one. Deterministic per shipment so the hash is stable.
 *
 * A consignment note has to carry specific particulars and the carrier's
 * liability terms to function as the contract of carriage; those are set
 * out in full below, including the free-time/detention terms that make
 * automated demurrage billing enforceable rather than merely calculated.
 *
 * Legal footing: eSigned under the IT Act 2000 (s.5 gives electronic
 * signatures parity, s.4 satisfies "in writing"), with the Carriage by Road
 * Act 2007 governing the carrier's liability. Have counsel review the
 * wording and confirm your Carriage by Road registration before issuing
 * these as originals in production.
 */
export function contractText(shipment: EscrowShipment): string {
  const gst = Math.round(shipment.totalAmountInr * 0.05);
  const lines = [
    'TRUCKSETU DIGITAL LORRY RECEIPT (CONSIGNMENT NOTE) — LEGAL ORIGINAL',
    'Issued electronically under the Information Technology Act 2000. This is the',
    'original consignment note; no paper counterpart is issued.',
    '',
    `LR / Consignment No: ${shipment.consignmentNo ?? shipment.id}`,
    `Shipment: ${shipment.id}`,
    `Route: ${shipment.origin} → ${shipment.destination}`,
    `Carrier: ${shipment.driverName} · Vehicle ${shipment.truckNumber}`,
    `Freight: INR ${shipment.totalAmountInr} (GST 5%: INR ${gst})`,
    `Payment: ${shipment.advancePercent}% advance on dispatch, balance on verified POD, held in TruckSetu escrow`,
    `Goods-in-transit insurance: ${shipment.insured ? 'YES — cover in force' : 'NOT opted'}`,
    `e-Way bill: ${shipment.ewayBillNumber ?? 'to be generated before movement'}`,
    '',
    'TERMS OF CARRIAGE',
    '1. The carrier acknowledges receipt of the goods in apparent good order and',
    '   condition and undertakes to deliver them in the same condition.',
    '2. Liability of the carrier is governed by the Carriage by Road Act 2007 and',
    '   the rules made thereunder. Where the consignor has not declared a higher',
    '   value and paid the corresponding charge, liability is limited as provided',
    '   by those rules.',
    '3. Proof of delivery is mandatory. The escrow balance is released only against',
    '   a POD accepted under the platform verification rules.',
    '4. FREE TIME AND DETENTION: 6 hours free at loading and 6 hours free at',
    '   unloading. Beyond free time, detention accrues at INR 250 per hour, capped',
    '   at INR 6,000 per stop. Waiting time is evidenced by geofenced GPS',
    '   arrival/departure timestamps recorded by the platform, which both parties',
    '   accept as the record for this purpose.',
    '5. A dispute raised under the platform dispute policy freezes the escrow until',
    '   resolved. Resolution follows that policy and does not waive either party’s',
    '   statutory rights.',
    '6. The trip event log for this consignment is hash-chained; its head hash is',
    '   printed on the delivery record and can be independently verified.',
    '7. Both parties sign electronically via Aadhaar eSign. Each signature binds the',
    '   exact text above, identified by its SHA-256 hash.',
  ];
  return lines.join('\n');
}

export function contractHash(shipment: EscrowShipment): string {
  return crypto.createHash('sha256').update(contractText(shipment)).digest('hex');
}
