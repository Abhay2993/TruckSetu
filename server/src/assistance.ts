/**
 * Assistance desk — legal help and roadside breakdown.
 *
 * These are the two things that actually frighten a driver: a challan or an
 * RTO/police stop they cannot argue with, and a breakdown at 2am on a
 * highway with a loaded truck. Nobody serves either well, and both are
 * moments where a platform either earns loyalty for years or loses it in
 * one night.
 *
 * The platform has an unfair advantage on both: it already knows where the
 * truck is (telemetry), what papers it carries (document locker), what the
 * trip terms were (eSigned LR), and it can put money behind the answer
 * (membership tier). A rival with a load board cannot.
 *
 * PROVIDER SLOTS: legal needs a panel of advocates on retainer per state;
 * breakdown needs a garage network with commercial agreements along the
 * corridors. The case machinery, SLA clock and entitlement checks are real.
 */

import { db, newId, persist } from './db';
import { haversineKm } from './fraud';
import { tierFor } from './membership';
import { AssistanceCase, BreakdownCase, LegalCaseKind } from './types';

export const LEGAL_KINDS: LegalCaseKind[] = [
  'challan',
  'rto_seizure',
  'police_stop',
  'accident_claim',
  'overloading_notice',
  'other',
];

/** First-line guidance while a human advocate is being assigned. */
const FIRST_AID: Record<LegalCaseKind, string> = {
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

const HELPLINE = process.env.LEGAL_HELPLINE ?? '1800-000-0000';

export function openLegalCase(
  userId: string,
  kind: LegalCaseKind,
  detail: string,
  location: { latitude: number; longitude: number } | null,
): { case: AssistanceCase; covered: boolean; firstAid: string; helpline: string } {
  const benefits = tierFor(userId);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const usedThisYear = db.legalCases.filter(
    (c) => c.userId === userId && c.at >= yearStart,
  ).length;
  const covered = usedThisYear < benefits.legalCasesPerYear;

  const record: AssistanceCase = {
    id: newId('leg'),
    userId,
    kind,
    detail: detail.slice(0, 500),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    status: 'open',
    covered,
    advocateName: covered ? 'Adv. panel — assigning' : null,
    at: Date.now(),
    resolvedAt: null,
  };
  db.legalCases.unshift(record);
  if (db.legalCases.length > 500) db.legalCases.length = 500;
  persist();

  return { case: record, covered, firstAid: FIRST_AID[kind], helpline: HELPLINE };
}

export function assignAdvocate(caseId: string, advocateName: string): AssistanceCase | null {
  const record = db.legalCases.find((c) => c.id === caseId);
  if (!record) return null;
  record.advocateName = advocateName;
  record.status = 'assigned';
  persist();
  return record;
}

export function closeLegalCase(caseId: string, outcome: string): AssistanceCase | null {
  const record = db.legalCases.find((c) => c.id === caseId);
  if (!record) return null;
  record.status = 'resolved';
  record.outcome = outcome.slice(0, 300);
  record.resolvedAt = Date.now();
  persist();
  return record;
}

// ---------------------------------------------------------------------------
// Breakdown assistance
// ---------------------------------------------------------------------------

/** Partner garages along the corridors the platform actually serves. */
export const GARAGE_NETWORK = [
  { name: 'Manesar Truck Care', city: 'Manesar', latitude: 28.3536, longitude: 76.9366, phone: '+919000000101' },
  { name: 'Behror Highway Garage', city: 'Behror', latitude: 27.8886, longitude: 76.2814, phone: '+919000000102' },
  { name: 'Shahjahanpur Motors', city: 'Shahjahanpur', latitude: 27.4924, longitude: 76.1305, phone: '+919000000103' },
  { name: 'Jaipur Ring Road Service', city: 'Jaipur', latitude: 26.9124, longitude: 75.7873, phone: '+919000000104' },
  { name: 'Delhi Transport Nagar Works', city: 'Delhi', latitude: 28.6139, longitude: 77.209, phone: '+919000000105' },
] as const;

/** Rough road speed used to turn distance into an ETA. */
const ASSIST_SPEED_KMH = 45;

export function nearestGarage(latitude: number, longitude: number): {
  garage: (typeof GARAGE_NETWORK)[number];
  distanceKm: number;
  etaMinutes: number;
} | null {
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

export function requestBreakdown(
  userId: string,
  latitude: number,
  longitude: number,
  problem: string,
): { case: BreakdownCase; covered: boolean; slaMinutes: number } {
  const benefits = tierFor(userId);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const usedThisYear = db.breakdowns.filter(
    (c) => c.userId === userId && c.at >= yearStart,
  ).length;
  const covered = usedThisYear < benefits.breakdownCalloutsPerYear;
  const match = nearestGarage(latitude, longitude);

  const record: BreakdownCase = {
    id: newId('bkd'),
    userId,
    latitude,
    longitude,
    problem: problem.slice(0, 300),
    status: 'dispatched',
    covered,
    garageName: match?.garage.name ?? null,
    garagePhone: match?.garage.phone ?? null,
    distanceKm: match?.distanceKm ?? null,
    etaMinutes: match?.etaMinutes ?? null,
    slaMinutes: benefits.breakdownSlaMinutes,
    /** SLA is met when a mechanic arrives before this. */
    slaDeadlineAt: Date.now() + benefits.breakdownSlaMinutes * 60 * 1000,
    at: Date.now(),
    arrivedAt: null,
    resolvedAt: null,
    slaMet: null,
  };
  db.breakdowns.unshift(record);
  if (db.breakdowns.length > 500) db.breakdowns.length = 500;
  persist();
  return { case: record, covered, slaMinutes: benefits.breakdownSlaMinutes };
}

/** Mechanic on site — this is the moment the SLA is judged. */
export function markMechanicArrived(caseId: string, at = Date.now()): BreakdownCase | null {
  const record = db.breakdowns.find((c) => c.id === caseId);
  if (!record) return null;
  record.arrivedAt = at;
  record.status = 'on_site';
  record.slaMet = at <= record.slaDeadlineAt;
  persist();
  return record;
}

export function resolveBreakdown(caseId: string, note: string): BreakdownCase | null {
  const record = db.breakdowns.find((c) => c.id === caseId);
  if (!record) return null;
  record.status = 'resolved';
  record.note = note.slice(0, 300);
  record.resolvedAt = Date.now();
  persist();
  return record;
}

/** Entitlement + usage for the driver's assistance screen. */
export function assistanceSummary(userId: string): {
  helpline: string;
  legal: { used: number; allowed: number; cases: AssistanceCase[] };
  breakdown: { used: number; allowed: number; slaMinutes: number; cases: BreakdownCase[] };
  garages: typeof GARAGE_NETWORK;
} {
  const benefits = tierFor(userId);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const legalCases = db.legalCases.filter((c) => c.userId === userId);
  const breakdownCases = db.breakdowns.filter((c) => c.userId === userId);
  return {
    helpline: HELPLINE,
    legal: {
      used: legalCases.filter((c) => c.at >= yearStart).length,
      allowed: benefits.legalCasesPerYear,
      cases: legalCases.slice(0, 10),
    },
    breakdown: {
      used: breakdownCases.filter((c) => c.at >= yearStart).length,
      allowed: benefits.breakdownCalloutsPerYear,
      slaMinutes: benefits.breakdownSlaMinutes,
      cases: breakdownCases.slice(0, 10),
    },
    garages: GARAGE_NETWORK,
  };
}

export { FIRST_AID };
