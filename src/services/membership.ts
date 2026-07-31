/**
 * Membership tiering and assistance data, mirrored from
 * server/src/membership.ts and assistance.ts so demo mode shows exactly the
 * benefits the server would grant. Change them together.
 */

import type { LegalCaseKind, Tier, TierBenefits } from '../types';

export const SAVINGS = {
  DEFAULT_SKIM_PERCENT: 3,
  MAX_SKIM_PERCENT: 15,
  SAVINGS_APR: 0.07,
  PENSION_APR: 0.09,
  PENSION_UNLOCK_AGE: 58,
  PENSION_SPLIT: 0.4,
} as const;

export const TIERS: Record<Tier, TierBenefits> = {
  Bronze: {
    tier: 'Bronze',
    healthCoverInr: 100000,
    accidentCoverInr: 200000,
    cashbackPercent: 0.5,
    savingsMatchPercent: 0,
    legalCasesPerYear: 1,
    breakdownCalloutsPerYear: 2,
    breakdownSlaMinutes: 120,
  },
  Silver: {
    tier: 'Silver',
    healthCoverInr: 200000,
    accidentCoverInr: 400000,
    cashbackPercent: 1,
    savingsMatchPercent: 2,
    legalCasesPerYear: 2,
    breakdownCalloutsPerYear: 4,
    breakdownSlaMinutes: 90,
  },
  Gold: {
    tier: 'Gold',
    healthCoverInr: 300000,
    accidentCoverInr: 700000,
    cashbackPercent: 1.5,
    savingsMatchPercent: 4,
    legalCasesPerYear: 4,
    breakdownCalloutsPerYear: 8,
    breakdownSlaMinutes: 60,
  },
  Platinum: {
    tier: 'Platinum',
    healthCoverInr: 500000,
    accidentCoverInr: 1000000,
    cashbackPercent: 2,
    savingsMatchPercent: 6,
    legalCasesPerYear: 6,
    breakdownCalloutsPerYear: 12,
    breakdownSlaMinutes: 45,
  },
};

/** Tier is earned from the platform record — score sets it, trips prove it. */
export function tierFor(score: number, settledTrips: number): TierBenefits {
  if (score >= 750 && settledTrips >= 12) return TIERS.Platinum;
  if (score >= 620 && settledTrips >= 6) return TIERS.Gold;
  if (score >= 480 && settledTrips >= 2) return TIERS.Silver;
  return TIERS.Bronze;
}

export function nextTier(current: Tier): TierBenefits | null {
  const order: Tier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const next = order[order.indexOf(current) + 1];
  return next ? TIERS[next] : null;
}

export const LEGAL_KIND_LABEL: Record<LegalCaseKind, string> = {
  challan: 'Challan / fine',
  rto_seizure: 'RTO seizure',
  police_stop: 'Police stop',
  accident_claim: 'Accident claim',
  overloading_notice: 'Overloading notice',
  other: 'Something else',
};

/** First-line guidance shown instantly, before an advocate calls back. */
export const FIRST_AID: Record<LegalCaseKind, string> = {
  challan:
    'Ask for the challan copy and the officer’s ID. A challan must state the section and the amount — pay only against a receipt or the official e-challan link, never in cash on the road.',
  rto_seizure:
    'Ask which section the vehicle is being detained under and request the seizure memo in writing. Do not hand over original documents without a receipt — your digital LR and RC are in the app.',
  police_stop:
    'Stay in the cab, keep the doors locked at night, and share your live location from the app. You are entitled to see the officer’s identification before producing documents.',
  accident_claim:
    'Photograph the scene, the other vehicle and the number plates before anything is moved. Do not sign any statement you have not read. Your goods-in-transit cover details are on the shipment.',
  overloading_notice:
    'Ask for the weighbridge slip. Overloading penalties are computed per excess tonne — check the slip against your LR weight before accepting any figure.',
  other:
    'Note the time, place and the officer or party involved. Keep your digital LR and documents ready in the app; an advocate will call you.',
};

export const GARAGE_NETWORK = [
  { name: 'Manesar Truck Care', city: 'Manesar', latitude: 28.3536, longitude: 76.9366, phone: '+919000000101' },
  { name: 'Behror Highway Garage', city: 'Behror', latitude: 27.8886, longitude: 76.2814, phone: '+919000000102' },
  { name: 'Shahjahanpur Motors', city: 'Shahjahanpur', latitude: 27.4924, longitude: 76.1305, phone: '+919000000103' },
  { name: 'Jaipur Ring Road Service', city: 'Jaipur', latitude: 26.9124, longitude: 75.7873, phone: '+919000000104' },
  { name: 'Delhi Transport Nagar Works', city: 'Delhi', latitude: 28.6139, longitude: 77.209, phone: '+919000000105' },
] as const;

const ASSIST_SPEED_KMH = 45;

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function nearestGarage(
  latitude: number,
  longitude: number,
): { garage: (typeof GARAGE_NETWORK)[number]; distanceKm: number; etaMinutes: number } | null {
  let best: { garage: (typeof GARAGE_NETWORK)[number]; distanceKm: number } | null = null;
  for (const garage of GARAGE_NETWORK) {
    const distanceKm = haversineKm({ latitude, longitude }, garage);
    if (!best || distanceKm < best.distanceKm) best = { garage, distanceKm };
  }
  if (!best) return null;
  return {
    garage: best.garage,
    distanceKm: Math.round(best.distanceKm * 10) / 10,
    etaMinutes: Math.max(15, Math.round((best.distanceKm / ASSIST_SPEED_KMH) * 60)),
  };
}
