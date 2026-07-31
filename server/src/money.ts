/**
 * TruckSetu Money — the lending flywheel.
 *
 * The moat here is not the loan products; it is the underwriting data no
 * matching-only competitor can buy: settled escrow trips, verified PODs,
 * dispute history, dealer settlement behaviour and driving telemetry. Every
 * settled shipment sharpens the score, which prices credit cheaper, which
 * attracts more flow — a compounding loop.
 *
 * The structural edge that makes this lendable at all is REPAYMENT
 * SENIORITY: TruckSetu controls the escrow, so instalments are deducted from
 * the driver's own balance release before the money ever leaves the platform
 * (see applyEscrowDeductions). Recovery risk is therefore a fraction of an
 * unsecured NBFC loan against the same borrower.
 *
 * Every product below is a provider slot: the arithmetic, ledger and state
 * machine are real, while disbursal/collection route through the existing
 * payments module. Going live means an NBFC/lending partner and an RBI
 * co-lending or DLG arrangement — the money math does not change.
 */

import { db, newId, persist } from './db';
import {
  CreditFacility,
  DrivingStats,
  EmiPlan,
  EscrowShipment,
  FuelCardAccount,
  TelemetryPoint,
  UserRole,
} from './types';

// ---------------------------------------------------------------------------
// Pricing. One place, so a change of commercial terms is one diff.
// ---------------------------------------------------------------------------

export const MONEY = {
  /** Bill discounting: charged per 30 days of tenor on the invoice face value. */
  DISCOUNT_FEE_RATE_PER_30D: 0.0125,
  /** Revolving working-capital line, reducing balance. */
  CREDIT_LINE_APR: 0.18,
  /** Point-of-need EMIs (tyre / repair / battery). */
  EMI_APR: 0.2,
  /** Diesel rebate at partner pumps. */
  FUEL_DISCOUNT_INR_PER_LITRE: 1.5,
  FUEL_CASHBACK_RATE: 0.005,
  /** Share of a balance release swept toward a drawn credit line. */
  CREDIT_SWEEP_RATE: 0.25,
  /** What a lending partner pays per bureau pull. */
  BUREAU_QUERY_FEE_INR: 25,
} as const;

export const EMI_CATALOGUE = [
  { id: 'tyre', label: 'Truck tyre set (6)', priceInr: 96000 },
  { id: 'repair', label: 'Engine repair / overhaul', priceInr: 45000 },
  { id: 'battery', label: 'Heavy-duty battery', priceInr: 18000 },
] as const;

export const PARTNER_PUMPS = [
  { name: 'Behror Highway Fuels', city: 'Behror', dieselInrPerLitre: 89.6 },
  { name: 'Shahjahanpur Truck Stop', city: 'Shahjahanpur', dieselInrPerLitre: 90.2 },
  { name: 'Manesar Fleet Point', city: 'Manesar', dieselInrPerLitre: 88.9 },
] as const;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreFactor {
  label: string;
  value: string;
  positive: boolean;
}

export interface Score {
  score: number; // CIBIL-shaped 300–900 so partners can slot it into existing models
  band: 'Building' | 'Fair' | 'Good' | 'Excellent';
  factors: ScoreFactor[];
}

function bandFor(score: number): Score['band'] {
  if (score >= 750) return 'Excellent';
  if (score >= 620) return 'Good';
  if (score >= 480) return 'Fair';
  return 'Building';
}

/**
 * Driver TruckScore. Kept numerically identical to the app's
 * services/creditScore.ts so demo and server mode show the same number —
 * change both together.
 */
export function driverScore(userId: string): Score {
  const mine = db.shipments.filter((s) => s.driverId === userId);
  const settled = mine.filter((s) => s.stage === 'BALANCE_RELEASED');
  const trips = settled.length;
  const earningsInr = settled.reduce((sum, s) => sum + s.totalAmountInr, 0);

  const rated = settled.filter((s) => typeof s.ratingByDealer === 'number');
  const avgRating = rated.length
    ? rated.reduce((sum, s) => sum + (s.ratingByDealer ?? 0), 0) / rated.length
    : null;

  const withPod = settled.filter((s) => s.pod);
  const verifiedPods = withPod.filter((s) => s.pod?.verified).length;
  const podRate = withPod.length ? verifiedPods / withPod.length : null;
  const disputed = mine.filter((s) => s.disputeId).length;

  let score = 300;
  score += Math.min(200, trips * 25);
  score += avgRating !== null ? Math.round(((avgRating - 1) / 4) * 150) : 60;
  score += podRate !== null ? Math.round(podRate * 120) : 50;
  score += Math.min(80, Math.round(earningsInr / 50000) * 10);
  score -= disputed * 60;
  score = Math.max(300, Math.min(900, score));

  return {
    score,
    band: bandFor(score),
    factors: [
      { label: 'Settled trips', value: String(trips), positive: trips > 0 },
      {
        label: 'Avg dealer rating',
        value: avgRating !== null ? `${avgRating.toFixed(1)} ★` : '—',
        positive: (avgRating ?? 0) >= 4,
      },
      {
        label: 'Verified PODs',
        value: podRate !== null ? `${Math.round(podRate * 100)}%` : '—',
        positive: (podRate ?? 0) >= 0.8,
      },
      { label: 'Disputes', value: String(disputed), positive: disputed === 0 },
    ],
  };
}

/**
 * Dealer score: how much freight they move and how cleanly they settle it.
 * A dealer who dispatches promptly and never lands in dispute is a better
 * credit than one with the same volume and a queue of frozen escrows.
 */
export function dealerScore(userId: string): Score {
  const mine = db.shipments.filter((s) => s.dealerId === userId);
  const settled = mine.filter((s) => s.stage === 'BALANCE_RELEASED');
  const volumeInr = mine.reduce((sum, s) => sum + s.totalAmountInr, 0);
  const disputed = mine.filter((s) => s.disputeId).length;
  const settleRate = mine.length ? settled.length / mine.length : null;

  let score = 300;
  score += Math.min(220, Math.round(volumeInr / 25000) * 20);
  score += Math.min(180, settled.length * 30);
  score += settleRate !== null ? Math.round(settleRate * 120) : 50;
  score -= disputed * 70;
  score = Math.max(300, Math.min(900, score));

  return {
    score,
    band: bandFor(score),
    factors: [
      { label: 'Freight booked', value: `₹${volumeInr.toLocaleString('en-IN')}`, positive: volumeInr > 0 },
      { label: 'Shipments settled', value: String(settled.length), positive: settled.length > 0 },
      {
        label: 'Settlement rate',
        value: settleRate !== null ? `${Math.round(settleRate * 100)}%` : '—',
        positive: (settleRate ?? 0) >= 0.7,
      },
      { label: 'Disputes', value: String(disputed), positive: disputed === 0 },
    ],
  };
}

export function scoreFor(userId: string, role: UserRole | null): Score {
  return role === 'dealer' ? dealerScore(userId) : driverScore(userId);
}

// ---------------------------------------------------------------------------
// Driving score — telemetry the platform already collects, priced into
// insurance. A competitor without the truck's GPS cannot offer this.
// ---------------------------------------------------------------------------

const OVERSPEED_KMH = 80;
const HARSH_DELTA_KMH = 25;

/** Accumulate safety events from a telemetry batch. */
export function recordDrivingPoints(userId: string, points: TelemetryPoint[]): void {
  const stats: DrivingStats = db.driving[userId] ?? {
    points: 0,
    overspeedEvents: 0,
    harshEvents: 0,
    nightPoints: 0,
    lastAt: null,
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    stats.points += 1;
    if (p.speed > OVERSPEED_KMH) stats.overspeedEvents += 1;
    const prev = points[i - 1];
    if (prev && Math.abs(p.speed - prev.speed) > HARSH_DELTA_KMH) stats.harshEvents += 1;
    const hour = new Date(p.timestamp).getHours();
    if (hour >= 23 || hour < 5) stats.nightPoints += 1;
    stats.lastAt = p.timestamp;
  }
  db.driving[userId] = stats;
  persist();
}

export interface DrivingScore {
  score: number; // 0–100
  band: 'Needs work' | 'Fair' | 'Safe' | 'Elite';
  /** Insurance premium discount this driving earns. */
  discountPercent: number;
  sampleSize: number;
}

/** Null until there is enough telemetry to be fair to the driver. */
export function drivingScore(userId: string): DrivingScore | null {
  const stats = db.driving[userId];
  if (!stats || stats.points < 20) return null;
  const per100 = (n: number) => (n / stats.points) * 100;
  let score = 100;
  score -= Math.min(45, per100(stats.overspeedEvents) * 1.5);
  score -= Math.min(35, per100(stats.harshEvents) * 2);
  score -= Math.min(15, per100(stats.nightPoints) * 0.4);
  score = Math.max(0, Math.round(score));
  const band: DrivingScore['band'] =
    score >= 85 ? 'Elite' : score >= 70 ? 'Safe' : score >= 50 ? 'Fair' : 'Needs work';
  // Up to 20% off — the safe-driving proof a rival cannot produce.
  const discountPercent = Math.max(0, Math.round(((score - 50) / 50) * 20));
  return { score, band, discountPercent, sampleSize: stats.points };
}

// ---------------------------------------------------------------------------
// Revolving credit line
// ---------------------------------------------------------------------------

/** Sanctioned limit from the score — the eligibility curve. */
export function limitForScore(score: number, role: UserRole | null): number {
  const base = role === 'dealer' ? 1.5 : 1;
  if (score >= 750) return Math.round(200000 * base);
  if (score >= 620) return Math.round(100000 * base);
  if (score >= 480) return Math.round(40000 * base);
  return Math.round(10000 * base);
}

export function ensureFacility(userId: string, role: UserRole | null): CreditFacility {
  const score = scoreFor(userId, role).score;
  const limitInr = limitForScore(score, role);
  const existing = db.credit[userId];
  if (existing) {
    // Re-underwrite on every read: the limit tracks the score upward, but
    // never drops below what is already drawn.
    existing.limitInr = Math.max(limitInr, existing.drawnInr);
    return existing;
  }
  const facility: CreditFacility = {
    userId,
    limitInr,
    drawnInr: 0,
    aprPercent: Math.round(MONEY.CREDIT_LINE_APR * 100),
    draws: [],
    repayments: [],
    updatedAt: Date.now(),
  };
  db.credit[userId] = facility;
  persist();
  return facility;
}

// ---------------------------------------------------------------------------
// EMIs (tyre / repair / battery at point of need)
// ---------------------------------------------------------------------------

/** Standard reducing-balance amortisation. */
export function emiMonthly(
  principalInr: number,
  tenorMonths: number,
  apr: number = MONEY.EMI_APR,
): number {
  const r = apr / 12;
  const f = Math.pow(1 + r, tenorMonths);
  return Math.round((principalInr * r * f) / (f - 1));
}

export function createEmiPlan(
  userId: string,
  itemId: string,
  itemLabel: string,
  principalInr: number,
  tenorMonths: number,
): EmiPlan {
  const monthlyInr = emiMonthly(principalInr, tenorMonths);
  const plan: EmiPlan = {
    id: newId('emi'),
    userId,
    itemId,
    itemLabel,
    principalInr,
    tenorMonths,
    monthlyInr,
    aprPercent: Math.round(MONEY.EMI_APR * 100),
    paidInstalments: 0,
    outstandingInr: monthlyInr * tenorMonths,
    status: 'active',
    at: Date.now(),
  };
  db.emis.unshift(plan);
  persist();
  return plan;
}

// ---------------------------------------------------------------------------
// Repayment seniority — the underwriting edge.
//
// Called on every balance release/instant payout for the DRIVER. Obligations
// are collected from the driver's own escrow money before it leaves the
// platform, in priority order: EMI instalments, then fuel-card dues, then a
// partial sweep against the revolving line.
// ---------------------------------------------------------------------------

export interface Deduction {
  label: string;
  amountInr: number;
  kind: 'emi' | 'fuel_card' | 'credit_line';
  /** EMI plan id, so the commit charges exactly the plan that was quoted. */
  targetId?: string;
}

export interface DeductionPlan {
  netInr: number;
  deductions: Deduction[];
}

/**
 * Work out what this release owes — PURE, no writes.
 *
 * Planning and committing are separate on purpose: the payout can fail, and
 * a driver must never be charged for money that did not reach them. Callers
 * plan, attempt the payout, and only commit once it succeeds.
 */
export function planEscrowDeductions(userId: string, grossInr: number): DeductionPlan {
  const deductions: Deduction[] = [];
  let remaining = grossInr;

  // 1. EMI instalments — one per release, oldest plan first.
  for (const plan of [...db.emis].reverse()) {
    if (remaining <= 0) break;
    if (plan.userId !== userId || plan.status !== 'active') continue;
    const due = Math.min(plan.monthlyInr, plan.outstandingInr, remaining);
    if (due <= 0) continue;
    remaining -= due;
    deductions.push({
      label: `EMI · ${plan.itemLabel}`,
      amountInr: due,
      kind: 'emi',
      targetId: plan.id,
    });
  }

  // 2. Fuel card outstanding — settled in full where the release allows.
  const card = db.fuelCards[userId];
  if (card && card.outstandingInr > 0 && remaining > 0) {
    const due = Math.min(card.outstandingInr, remaining);
    remaining -= due;
    deductions.push({ label: 'Fuel card dues', amountInr: due, kind: 'fuel_card' });
  }

  // 3. Revolving line — a partial sweep, so a release is never fully consumed.
  const facility = db.credit[userId];
  if (facility && facility.drawnInr > 0 && remaining > 0) {
    const sweep = Math.min(
      facility.drawnInr,
      Math.round(grossInr * MONEY.CREDIT_SWEEP_RATE),
      remaining,
    );
    if (sweep > 0) {
      remaining -= sweep;
      deductions.push({ label: 'Credit line sweep', amountInr: sweep, kind: 'credit_line' });
    }
  }

  return { netInr: Math.max(0, remaining), deductions };
}

/** Apply a plan to the ledgers. Call only after the payout has succeeded. */
export function commitEscrowDeductions(userId: string, plan: DeductionPlan): void {
  if (plan.deductions.length === 0) return;

  for (const d of plan.deductions) {
    if (d.kind === 'emi') {
      const emi = db.emis.find((e) => e.id === d.targetId);
      if (!emi) continue;
      emi.outstandingInr = Math.max(0, emi.outstandingInr - d.amountInr);
      emi.paidInstalments += 1;
      if (emi.outstandingInr === 0) emi.status = 'closed';
    } else if (d.kind === 'fuel_card') {
      const card = db.fuelCards[userId];
      if (card) card.outstandingInr = Math.max(0, card.outstandingInr - d.amountInr);
    } else {
      const facility = db.credit[userId];
      if (!facility) continue;
      facility.drawnInr = Math.max(0, facility.drawnInr - d.amountInr);
      facility.repayments.unshift({
        id: newId('rep'),
        amountInr: d.amountInr,
        at: Date.now(),
        source: 'escrow',
      });
      facility.updatedAt = Date.now();
    }
  }
  persist();
}

// ---------------------------------------------------------------------------
// Fuel card
// ---------------------------------------------------------------------------

export function ensureFuelCard(userId: string): FuelCardAccount {
  const existing = db.fuelCards[userId];
  if (existing) return existing;
  const card: FuelCardAccount = {
    userId,
    // Deterministic 4 digits from the user id — stable across restarts.
    last4: String(
      1000 + ([...userId].reduce((a, c) => a + c.charCodeAt(0), 0) % 9000),
    ),
    creditLimitInr: 15000,
    outstandingInr: 0,
    litresThisMonth: 0,
    savedInr: 0,
    transactions: [],
    issuedAt: Date.now(),
  };
  db.fuelCards[userId] = card;
  persist();
  return card;
}

export interface FuelSwipeResult {
  litres: number;
  grossInr: number;
  discountInr: number;
  cashbackInr: number;
  netInr: number;
}

/** Swipe at a partner pump: rebate per litre plus cashback, billed to the card. */
export function swipeFuelCard(userId: string, pumpName: string, litres: number): FuelSwipeResult {
  const card = ensureFuelCard(userId);
  const pump = PARTNER_PUMPS.find((p) => p.name === pumpName) ?? PARTNER_PUMPS[0];
  const grossInr = Math.round(litres * pump.dieselInrPerLitre);
  const discountInr = Math.round(litres * MONEY.FUEL_DISCOUNT_INR_PER_LITRE);
  const afterDiscount = grossInr - discountInr;
  const cashbackInr = Math.round(afterDiscount * MONEY.FUEL_CASHBACK_RATE);
  const netInr = afterDiscount - cashbackInr;

  card.outstandingInr += netInr;
  card.litresThisMonth += litres;
  card.savedInr += discountInr + cashbackInr;
  card.transactions.unshift({
    id: newId('fcx'),
    pump: pump.name,
    city: pump.city,
    litres,
    amountInr: netInr,
    discountInr,
    cashbackInr,
    at: Date.now(),
  });
  if (card.transactions.length > 50) card.transactions.length = 50;
  persist();
  return { litres, grossInr, discountInr, cashbackInr, netInr };
}

// ---------------------------------------------------------------------------
// Bill discounting (dealer receivables)
// ---------------------------------------------------------------------------

export const GST_RATE = 0.05;

export function invoiceFaceValue(shipment: EscrowShipment): number {
  return shipment.totalAmountInr + Math.round(shipment.totalAmountInr * GST_RATE);
}

export function quoteDiscount(
  shipment: EscrowShipment,
  termDays: number,
): { faceValueInr: number; feeInr: number; netInr: number; dueAt: number } {
  const faceValueInr = invoiceFaceValue(shipment);
  const feeInr = Math.round(faceValueInr * MONEY.DISCOUNT_FEE_RATE_PER_30D * (termDays / 30));
  return {
    faceValueInr,
    feeInr,
    netInr: faceValueInr - feeInr,
    dueAt: Date.now() + termDays * 24 * 3600 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Vehicle loan (purchase / refinance)
// ---------------------------------------------------------------------------

export interface VehicleLoanQuote {
  amountInr: number;
  tenorMonths: number;
  aprPercent: number;
  emiInr: number;
  maxEligibleInr: number;
  eligible: boolean;
}

/** Score-priced APR — the whole point of owning the underwriting data. */
export function vehicleLoanQuote(
  score: number,
  amountInr: number,
  tenorMonths: number,
): VehicleLoanQuote {
  const apr = score >= 750 ? 0.125 : score >= 620 ? 0.145 : score >= 480 ? 0.17 : 0.21;
  const maxEligibleInr =
    score >= 750 ? 2500000 : score >= 620 ? 1500000 : score >= 480 ? 600000 : 150000;
  return {
    amountInr,
    tenorMonths,
    aprPercent: Math.round(apr * 1000) / 10,
    emiInr: emiMonthly(amountInr, tenorMonths, apr),
    maxEligibleInr,
    eligible: amountInr <= maxEligibleInr,
  };
}

// ---------------------------------------------------------------------------
// Telemetry-priced insurance
// ---------------------------------------------------------------------------

export interface InsuranceQuote {
  sumInsuredInr: number;
  basePremiumInr: number;
  drivingScore: number | null;
  discountPercent: number;
  premiumInr: number;
  savedInr: number;
}

const BASE_PREMIUM_RATE = 0.0225; // 2.25% of sum insured, annual

export function insuranceQuote(userId: string, sumInsuredInr: number): InsuranceQuote {
  const basePremiumInr = Math.round(sumInsuredInr * BASE_PREMIUM_RATE);
  const driving = drivingScore(userId);
  const discountPercent = driving?.discountPercent ?? 0;
  const premiumInr = Math.round(basePremiumInr * (1 - discountPercent / 100));
  return {
    sumInsuredInr,
    basePremiumInr,
    drivingScore: driving?.score ?? null,
    discountPercent,
    premiumInr,
    savedInr: basePremiumInr - premiumInr,
  };
}
