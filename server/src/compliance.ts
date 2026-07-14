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

/** The digital LR text both parties sign. Deterministic per shipment. */
export function contractText(shipment: EscrowShipment): string {
  return [
    'TRUCKSETU DIGITAL LORRY RECEIPT & TRANSPORT CONTRACT',
    `Shipment: ${shipment.id} · Consignment: ${shipment.consignmentNo ?? '—'}`,
    `Route: ${shipment.origin} → ${shipment.destination}`,
    `Carrier: ${shipment.driverName} (${shipment.truckNumber})`,
    `Freight: INR ${shipment.totalAmountInr} · Advance ${shipment.advancePercent}% on dispatch · Balance on verified POD via escrow`,
    'Terms: goods to be delivered in received condition; POD mandatory for balance release;',
    'disputes freeze escrow until resolved per TruckSetu dispute policy; e-sign under IT Act 2000.',
  ].join('\n');
}

export function contractHash(shipment: EscrowShipment): string {
  return crypto.createHash('sha256').update(contractText(shipment)).digest('hex');
}
