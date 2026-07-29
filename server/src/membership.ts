/**
 * TruckSetu Suraksha — the driver membership.
 *
 * Every other moat in this codebase is software, and software gets copied.
 * This one is different: a driver whose family health cover, savings and
 * pension run through TruckSetu does not switch platforms for a ₹500 better
 * rate on one trip. Loyalty is bought with things that matter off the
 * highway, and the platform can afford them because it already holds the
 * escrow the benefits are funded from.
 *
 * Tiering is earned, not sold: it comes off the same TruckScore that prices
 * credit, so a driver improving their record gets paid for it twice —
 * cheaper money AND better cover. That is what makes the score worth
 * protecting, which is what makes the driver stay.
 *
 * PROVIDER SLOTS: health/accident cover needs an IRDAI-registered insurer
 * (group policy with TruckSetu as master policyholder); the pension leg
 * needs an NPS/APY intermediary or a partner AMC. The tiering, ledgers and
 * accrual maths here are real; only the underwriting counterparty changes.
 */

import { db, newId, persist } from './db';
import { driverScore } from './money';
import { SavingsAccount, SavingsTxn } from './types';

export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface TierBenefits {
  tier: Tier;
  /** Family floater sum insured (spouse + 2 children). */
  healthCoverInr: number;
  /** Personal accident cover for the driver. */
  accidentCoverInr: number;
  /** Cashback on fuel-card and FASTag spend. */
  cashbackPercent: number;
  /** TruckSetu's contribution on top of the driver's own savings. */
  savingsMatchPercent: number;
  /** Legal cases covered per year. */
  legalCasesPerYear: number;
  /** Breakdown callouts covered per year. */
  breakdownCalloutsPerYear: number;
  /** Target minutes to a mechanic on a covered corridor. */
  breakdownSlaMinutes: number;
}

const TIERS: Record<Tier, TierBenefits> = {
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

export const SAVINGS = {
  /** Default share of each settled trip swept into savings. */
  DEFAULT_SKIM_PERCENT: 3,
  MAX_SKIM_PERCENT: 15,
  /** Annual interest credited on the savings balance. */
  SAVINGS_APR: 0.07,
  /** Pension leg: locked until retirement, higher return, higher match. */
  PENSION_APR: 0.09,
  PENSION_UNLOCK_AGE: 58,
  /** Share of the skim routed to the locked pension leg. */
  PENSION_SPLIT: 0.4,
} as const;

/** Tier from the driver's own record — earned, never sold. */
export function tierFor(userId: string): TierBenefits {
  const { score } = driverScore(userId);
  const settled = db.shipments.filter(
    (s) => s.driverId === userId && s.stage === 'BALANCE_RELEASED',
  ).length;
  // Score sets the ceiling; trips prove it is not a one-off.
  if (score >= 750 && settled >= 12) return TIERS.Platinum;
  if (score >= 620 && settled >= 6) return TIERS.Gold;
  if (score >= 480 && settled >= 2) return TIERS.Silver;
  return TIERS.Bronze;
}

export function nextTier(current: Tier): TierBenefits | null {
  const order: Tier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const next = order[order.indexOf(current) + 1];
  return next ? TIERS[next] : null;
}

/** What the driver must still do to reach the next tier. */
export function tierProgress(userId: string): {
  settledTrips: number;
  score: number;
  needTrips: number;
  needScore: number;
} {
  const { score } = driverScore(userId);
  const settled = db.shipments.filter(
    (s) => s.driverId === userId && s.stage === 'BALANCE_RELEASED',
  ).length;
  const current = tierFor(userId).tier;
  const targets: Record<Tier, { trips: number; score: number }> = {
    Bronze: { trips: 2, score: 480 },
    Silver: { trips: 6, score: 620 },
    Gold: { trips: 12, score: 750 },
    Platinum: { trips: 0, score: 0 },
  };
  const target = targets[current];
  return {
    settledTrips: settled,
    score,
    needTrips: Math.max(0, target.trips - settled),
    needScore: Math.max(0, target.score - score),
  };
}

// ---------------------------------------------------------------------------
// Savings & micro-pension
// ---------------------------------------------------------------------------

export function ensureSavings(userId: string): SavingsAccount {
  const existing = db.savings[userId];
  if (existing) return existing;
  const account: SavingsAccount = {
    userId,
    skimPercent: SAVINGS.DEFAULT_SKIM_PERCENT,
    savingsInr: 0,
    pensionInr: 0,
    matchedInr: 0,
    interestInr: 0,
    transactions: [],
    openedAt: Date.now(),
  };
  db.savings[userId] = account;
  persist();
  return account;
}

export interface SkimResult {
  skimmedInr: number;
  toSavingsInr: number;
  toPensionInr: number;
  matchInr: number;
}

/**
 * Sweep a share of a settled trip into savings + pension, and add the tier
 * match on top. Called on balance release: the money is saved BEFORE it
 * reaches the driver's hands, which is the only mechanism that reliably
 * builds savings for irregular cash incomes.
 */
export function skimToSavings(userId: string, releaseInr: number): SkimResult {
  const account = ensureSavings(userId);
  const none: SkimResult = { skimmedInr: 0, toSavingsInr: 0, toPensionInr: 0, matchInr: 0 };
  if (account.skimPercent <= 0 || releaseInr <= 0) return none;

  const skimmedInr = Math.round((releaseInr * account.skimPercent) / 100);
  if (skimmedInr <= 0) return none;

  const toPensionInr = Math.round(skimmedInr * SAVINGS.PENSION_SPLIT);
  const toSavingsInr = skimmedInr - toPensionInr;
  const matchInr = Math.round((skimmedInr * tierFor(userId).savingsMatchPercent) / 100);

  account.savingsInr += toSavingsInr + matchInr;
  account.pensionInr += toPensionInr;
  account.matchedInr += matchInr;
  account.transactions.unshift({
    id: newId('sav'),
    kind: 'skim',
    amountInr: skimmedInr,
    note: `${account.skimPercent}% of a settled trip · ₹${toPensionInr} to pension`,
    at: Date.now(),
  });
  if (matchInr > 0) {
    account.transactions.unshift({
      id: newId('sav'),
      kind: 'match',
      amountInr: matchInr,
      note: `${tierFor(userId).tier} tier match`,
      at: Date.now(),
    });
  }
  if (account.transactions.length > 100) account.transactions.length = 100;
  persist();
  return { skimmedInr, toSavingsInr, toPensionInr, matchInr };
}

export interface WithdrawResult {
  ok: boolean;
  paidInr: number;
  reason: string;
}

/**
 * Savings are withdrawable on demand — that is what makes drivers trust the
 * product enough to use it. The pension leg is deliberately locked; an
 * emergency withdrawal is allowed but costs the match, so the default is
 * to leave it alone.
 */
export function withdrawSavings(
  userId: string,
  amountInr: number,
  leg: 'savings' | 'pension',
  age: number | null,
): WithdrawResult {
  const account = ensureSavings(userId);
  if (amountInr <= 0) return { ok: false, paidInr: 0, reason: 'Amount must be positive.' };

  if (leg === 'savings') {
    if (amountInr > account.savingsInr) {
      return { ok: false, paidInr: 0, reason: `Only ₹${account.savingsInr} in savings.` };
    }
    account.savingsInr -= amountInr;
    account.transactions.unshift({
      id: newId('sav'),
      kind: 'withdrawal',
      amountInr: -amountInr,
      note: 'Savings withdrawal',
      at: Date.now(),
    });
    persist();
    return { ok: true, paidInr: amountInr, reason: 'Paid to your account.' };
  }

  if (amountInr > account.pensionInr) {
    return { ok: false, paidInr: 0, reason: `Only ₹${account.pensionInr} in the pension leg.` };
  }
  const retired = age !== null && age >= SAVINGS.PENSION_UNLOCK_AGE;
  // Early exit forfeits the tier match on the amount taken out.
  const penaltyInr = retired ? 0 : Math.round(amountInr * 0.1);
  account.pensionInr -= amountInr;
  const paidInr = amountInr - penaltyInr;
  account.transactions.unshift({
    id: newId('sav'),
    kind: 'withdrawal',
    amountInr: -amountInr,
    note: retired
      ? 'Pension withdrawal (age 58+)'
      : `Early pension exit · ₹${penaltyInr} match forfeited`,
    at: Date.now(),
  });
  persist();
  return {
    ok: true,
    paidInr,
    reason: retired
      ? 'Paid to your account.'
      : `Paid ₹${paidInr} after a ₹${penaltyInr} early-exit adjustment.`,
  };
}

/** Credit accrued interest — call on read; idempotent within a day. */
export function accrueInterest(userId: string): number {
  const account = ensureSavings(userId);
  const last = account.transactions.find((t) => t.kind === 'interest');
  const since = last?.at ?? account.openedAt;
  const days = (Date.now() - since) / (24 * 3600 * 1000);
  if (days < 1) return 0;
  const interest =
    Math.round(((account.savingsInr * SAVINGS.SAVINGS_APR) / 365) * days) +
    Math.round(((account.pensionInr * SAVINGS.PENSION_APR) / 365) * days);
  if (interest <= 0) return 0;
  account.savingsInr += interest;
  account.interestInr += interest;
  account.transactions.unshift({
    id: newId('sav'),
    kind: 'interest',
    amountInr: interest,
    note: `${Math.floor(days)} day(s) interest`,
    at: Date.now(),
  });
  persist();
  return interest;
}

// ---------------------------------------------------------------------------
// Rewards — cashback that pays for score improvement immediately
// ---------------------------------------------------------------------------

export interface RewardsSummary {
  tier: Tier;
  cashbackPercent: number;
  earnedInr: number;
  redeemedInr: number;
  availableInr: number;
  /** What the next tier would have paid on the same spend. */
  nextTierWouldHavePaidInr: number | null;
}

export function rewardsSummary(userId: string): RewardsSummary {
  const benefits = tierFor(userId);
  const ledger = db.rewards[userId] ?? { earnedInr: 0, redeemedInr: 0 };
  const next = nextTier(benefits.tier);
  const spend = benefits.cashbackPercent > 0 ? ledger.earnedInr / (benefits.cashbackPercent / 100) : 0;
  return {
    tier: benefits.tier,
    cashbackPercent: benefits.cashbackPercent,
    earnedInr: ledger.earnedInr,
    redeemedInr: ledger.redeemedInr,
    availableInr: Math.max(0, ledger.earnedInr - ledger.redeemedInr),
    nextTierWouldHavePaidInr: next ? Math.round((spend * next.cashbackPercent) / 100) : null,
  };
}

/** Accrue cashback on fuel-card or FASTag spend, at the driver's tier rate. */
export function accrueCashback(userId: string, spendInr: number, source: 'fuel' | 'toll'): number {
  const benefits = tierFor(userId);
  const cashbackInr = Math.round((spendInr * benefits.cashbackPercent) / 100);
  if (cashbackInr <= 0) return 0;
  const ledger = db.rewards[userId] ?? { earnedInr: 0, redeemedInr: 0 };
  ledger.earnedInr += cashbackInr;
  db.rewards[userId] = ledger;
  persist();
  console.log(`[rewards] ${userId} +₹${cashbackInr} (${source}, ${benefits.tier})`);
  return cashbackInr;
}

export function redeemCashback(userId: string, amountInr: number): { ok: boolean; reason: string } {
  const ledger = db.rewards[userId] ?? { earnedInr: 0, redeemedInr: 0 };
  const available = ledger.earnedInr - ledger.redeemedInr;
  if (amountInr <= 0 || amountInr > available) {
    return { ok: false, reason: `Only ₹${Math.max(0, available)} cashback available.` };
  }
  ledger.redeemedInr += amountInr;
  db.rewards[userId] = ledger;
  persist();
  return { ok: true, reason: 'Credited to your FASTag wallet.' };
}

/** The full membership view. */
export function membershipSummary(userId: string): {
  benefits: TierBenefits;
  progress: ReturnType<typeof tierProgress>;
  next: TierBenefits | null;
  savings: SavingsAccount;
  rewards: RewardsSummary;
} {
  accrueInterest(userId);
  return {
    benefits: tierFor(userId),
    progress: tierProgress(userId),
    next: nextTier(tierFor(userId).tier),
    savings: ensureSavings(userId),
    rewards: rewardsSummary(userId),
  };
}

export type { SavingsTxn };
