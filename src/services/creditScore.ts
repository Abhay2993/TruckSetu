/**
 * TruckScore — platform credit scoring (foundation for NBFC lending).
 *
 * Banks can't score a driver with no formal credit history; TruckSetu can,
 * from data no bank has: settled trips, dispute record, ratings, verified
 * PODs and platform earnings. The score is CIBIL-shaped (300–900) so a
 * lending partner can slot it into existing underwriting, and every factor
 * is surfaced so drivers see exactly how to improve it. Production: expose
 * this via a partner API with driver consent (RBI account-aggregator style).
 */

import type { EscrowShipment } from '../types';

export interface TruckScore {
  score: number; // 300–900
  band: 'Building' | 'Fair' | 'Good' | 'Excellent';
  maxLoanInr: number;
  factors: { label: string; value: string; positive: boolean }[];
}

export function computeTruckScore(shipments: EscrowShipment[]): TruckScore {
  const settled = shipments.filter((s) => s.stage === 'BALANCE_RELEASED');
  const trips = settled.length;
  const earningsInr = settled.reduce((sum, s) => sum + s.totalAmountInr, 0);

  const rated = settled.filter((s) => typeof s.ratingByDealer === 'number');
  const avgRating = rated.length
    ? rated.reduce((sum, s) => sum + (s.ratingByDealer ?? 0), 0) / rated.length
    : null;

  const withPod = settled.filter((s) => s.pod);
  const verifiedPods = withPod.filter((s) => s.pod?.verified).length;
  const podVerifiedRate = withPod.length ? verifiedPods / withPod.length : null;

  const disputed = shipments.filter((s) => s.disputeId).length;

  // 300 base + up to 600 from weighted factors.
  let score = 300;
  score += Math.min(200, trips * 25); // volume: 8+ settled trips maxes it
  score += avgRating !== null ? Math.round(((avgRating - 1) / 4) * 150) : 60;
  score += podVerifiedRate !== null ? Math.round(podVerifiedRate * 120) : 50;
  score += Math.min(80, Math.round(earningsInr / 50000) * 10); // scale of business
  score -= disputed * 60;
  score = Math.max(300, Math.min(900, score));

  const band: TruckScore['band'] =
    score >= 750 ? 'Excellent' : score >= 620 ? 'Good' : score >= 480 ? 'Fair' : 'Building';

  // Simple eligibility curve: better score unlocks a larger working-capital line.
  const maxLoanInr =
    score >= 750 ? 200000 : score >= 620 ? 100000 : score >= 480 ? 40000 : 10000;

  return {
    score,
    band,
    maxLoanInr,
    factors: [
      { label: 'Settled trips', value: String(trips), positive: trips > 0 },
      {
        label: 'Avg dealer rating',
        value: avgRating !== null ? `${avgRating.toFixed(1)} ★` : '—',
        positive: (avgRating ?? 0) >= 4,
      },
      {
        label: 'Verified PODs',
        value: podVerifiedRate !== null ? `${Math.round(podVerifiedRate * 100)}%` : '—',
        positive: (podVerifiedRate ?? 0) >= 0.8,
      },
      { label: 'Disputes', value: String(disputed), positive: disputed === 0 },
    ],
  };
}
