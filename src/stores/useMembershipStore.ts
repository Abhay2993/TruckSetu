/**
 * Suraksha membership state: tier benefits, savings + micro-pension,
 * cashback rewards, and the legal/breakdown assistance desk.
 *
 * Server mode adopts /v1/membership/summary and /v1/assistance/summary;
 * demo mode keeps an equivalent local ledger so the whole benefit stack is
 * exercisable offline. The tier arithmetic lives in services/membership.ts
 * and mirrors the server exactly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import { computeTruckScore } from '../services/creditScore';
import { FIRST_AID, nearestGarage, nextTier, SAVINGS, tierFor } from '../services/membership';
import type {
  AssistanceCase,
  AssistanceSummary,
  BreakdownCase,
  LegalCaseKind,
  MembershipSummary,
  SavingsAccount,
  SavingsTxn,
} from '../types';
import { useEscrowStore } from './useEscrowStore';

const HELPLINE = '1800-000-0000';

interface DemoState {
  savings: SavingsAccount;
  earnedInr: number;
  redeemedInr: number;
  legalCases: AssistanceCase[];
  breakdowns: BreakdownCase[];
}

const INITIAL_SAVINGS: SavingsAccount = {
  skimPercent: SAVINGS.DEFAULT_SKIM_PERCENT,
  savingsInr: 0,
  pensionInr: 0,
  matchedInr: 0,
  interestInr: 0,
  transactions: [],
  openedAt: Date.now(),
};

const INITIAL_DEMO: DemoState = {
  savings: INITIAL_SAVINGS,
  earnedInr: 0,
  redeemedInr: 0,
  legalCases: [],
  breakdowns: [],
};

interface MembershipState {
  summary: MembershipSummary | null;
  assistance: AssistanceSummary | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  demo: DemoState;
  refresh: () => Promise<void>;
  setSkim: (percent: number) => Promise<void>;
  withdraw: (amountInr: number, leg: 'savings' | 'pension') => Promise<string | null>;
  redeem: (amountInr: number) => Promise<void>;
  openLegalCase: (kind: LegalCaseKind, detail: string) => Promise<string | null>;
  requestBreakdown: (
    latitude: number,
    longitude: number,
    problem: string,
  ) => Promise<BreakdownCase | null>;
}

/** Build the server's summary shape from local demo state. */
function buildDemoSummary(demo: DemoState): MembershipSummary {
  const shipments = useEscrowStore.getState().shipments;
  const settled = shipments.filter((s) => s.stage === 'BALANCE_RELEASED').length;
  const score = computeTruckScore(shipments).score;
  const benefits = tierFor(score, settled);
  const spend = benefits.cashbackPercent > 0 ? demo.earnedInr / (benefits.cashbackPercent / 100) : 0;
  const next = nextTier(benefits.tier);

  const targets: Record<string, { trips: number; score: number }> = {
    Bronze: { trips: 2, score: 480 },
    Silver: { trips: 6, score: 620 },
    Gold: { trips: 12, score: 750 },
    Platinum: { trips: 0, score: 0 },
  };
  const target = targets[benefits.tier] ?? { trips: 0, score: 0 };

  return {
    benefits,
    progress: {
      settledTrips: settled,
      score,
      needTrips: Math.max(0, target.trips - settled),
      needScore: Math.max(0, target.score - score),
    },
    next,
    savings: demo.savings,
    rewards: {
      tier: benefits.tier,
      cashbackPercent: benefits.cashbackPercent,
      earnedInr: demo.earnedInr,
      redeemedInr: demo.redeemedInr,
      availableInr: Math.max(0, demo.earnedInr - demo.redeemedInr),
      nextTierWouldHavePaidInr: next ? Math.round((spend * next.cashbackPercent) / 100) : null,
    },
  };
}

function buildDemoAssistance(demo: DemoState): AssistanceSummary {
  const shipments = useEscrowStore.getState().shipments;
  const settled = shipments.filter((s) => s.stage === 'BALANCE_RELEASED').length;
  const benefits = tierFor(computeTruckScore(shipments).score, settled);
  return {
    helpline: HELPLINE,
    legal: {
      used: demo.legalCases.length,
      allowed: benefits.legalCasesPerYear,
      cases: demo.legalCases.slice(0, 10),
    },
    breakdown: {
      used: demo.breakdowns.length,
      allowed: benefits.breakdownCalloutsPerYear,
      slaMinutes: benefits.breakdownSlaMinutes,
      cases: demo.breakdowns.slice(0, 10),
    },
    garages: [],
  };
}

export const useMembershipStore = create<MembershipState>()(
  persist(
    (set, get) => {
      const resync = async () => {
        const [remote, remoteAssist] = await Promise.all([
          api.membershipSummary().catch(() => null),
          api.assistanceSummary().catch(() => null),
        ]);
        set({
          summary: remote ?? buildDemoSummary(get().demo),
          assistance: remoteAssist ?? buildDemoAssistance(get().demo),
        });
      };

      return {
        summary: null,
        assistance: null,
        loading: false,
        busy: false,
        error: null,
        demo: INITIAL_DEMO,

        refresh: async () => {
          set({ loading: true, error: null });
          try {
            await resync();
          } catch (e) {
            set({ error: e instanceof Error ? e.message : 'Could not load your membership.' });
          } finally {
            set({ loading: false });
          }
        },

        setSkim: async (percent) => {
          const clamped = Math.max(0, Math.min(SAVINGS.MAX_SKIM_PERCENT, Math.round(percent)));
          const remote = await api.setSavingsSkim(clamped).catch(() => null);
          if (!remote) {
            set((s) => ({ demo: { ...s.demo, savings: { ...s.demo.savings, skimPercent: clamped } } }));
          }
          await resync();
        },

        withdraw: async (amountInr, leg) => {
          set({ busy: true, error: null });
          try {
            const remote = await api.withdrawSavings(amountInr, leg).catch((e) => {
              throw e;
            });
            if (remote) {
              await resync();
              return remote.reason;
            }
            // Demo mode: apply the same rules locally.
            const account = get().demo.savings;
            const balance = leg === 'savings' ? account.savingsInr : account.pensionInr;
            if (amountInr <= 0 || amountInr > balance) {
              set({ error: `Only ₹${balance} available in ${leg}.` });
              return null;
            }
            // Early pension exit forfeits 10% — the lock has to bite to work.
            const penalty = leg === 'pension' ? Math.round(amountInr * 0.1) : 0;
            const txn: SavingsTxn = {
              id: `sav-${Date.now()}`,
              kind: 'withdrawal',
              amountInr: -amountInr,
              note:
                leg === 'pension'
                  ? `Early pension exit · ₹${penalty} forfeited`
                  : 'Savings withdrawal',
              at: Date.now(),
            };
            set((s) => ({
              demo: {
                ...s.demo,
                savings: {
                  ...s.demo.savings,
                  savingsInr:
                    leg === 'savings' ? s.demo.savings.savingsInr - amountInr : s.demo.savings.savingsInr,
                  pensionInr:
                    leg === 'pension' ? s.demo.savings.pensionInr - amountInr : s.demo.savings.pensionInr,
                  transactions: [txn, ...s.demo.savings.transactions].slice(0, 100),
                },
              },
            }));
            await resync();
            return penalty > 0
              ? `Paid ₹${amountInr - penalty} after a ₹${penalty} early-exit adjustment.`
              : 'Paid to your account.';
          } catch (e) {
            set({ error: e instanceof Error ? e.message : 'Withdrawal failed.' });
            return null;
          } finally {
            set({ busy: false });
          }
        },

        redeem: async (amountInr) => {
          set({ busy: true, error: null });
          try {
            const remote = await api.redeemCashback(amountInr).catch(() => null);
            if (!remote) {
              const { earnedInr, redeemedInr } = get().demo;
              if (amountInr <= 0 || amountInr > earnedInr - redeemedInr) {
                set({ error: 'Not enough cashback to redeem yet.' });
                return;
              }
              set((s) => ({ demo: { ...s.demo, redeemedInr: s.demo.redeemedInr + amountInr } }));
            }
            await resync();
          } finally {
            set({ busy: false });
          }
        },

        openLegalCase: async (kind, detail) => {
          set({ busy: true, error: null });
          try {
            const remote = await api.openLegalCase(kind, detail, null).catch(() => null);
            if (remote) {
              await resync();
              return remote.firstAid;
            }
            const allowed = get().summary?.benefits.legalCasesPerYear ?? 1;
            const record: AssistanceCase = {
              id: `leg-${Date.now()}`,
              kind,
              detail,
              latitude: null,
              longitude: null,
              status: 'open',
              covered: get().demo.legalCases.length < allowed,
              advocateName: 'Adv. panel — assigning',
              at: Date.now(),
              resolvedAt: null,
            };
            set((s) => ({ demo: { ...s.demo, legalCases: [record, ...s.demo.legalCases] } }));
            await resync();
            return FIRST_AID[kind];
          } finally {
            set({ busy: false });
          }
        },

        requestBreakdown: async (latitude, longitude, problem) => {
          set({ busy: true, error: null });
          try {
            const remote = await api.requestBreakdown(latitude, longitude, problem).catch(() => null);
            if (remote) {
              await resync();
              return remote.case;
            }
            const slaMinutes = get().summary?.benefits.breakdownSlaMinutes ?? 120;
            const allowed = get().summary?.benefits.breakdownCalloutsPerYear ?? 2;
            const match = nearestGarage(latitude, longitude);
            const record: BreakdownCase = {
              id: `bkd-${Date.now()}`,
              latitude,
              longitude,
              problem,
              status: 'dispatched',
              covered: get().demo.breakdowns.length < allowed,
              garageName: match?.garage.name ?? null,
              garagePhone: match?.garage.phone ?? null,
              distanceKm: match?.distanceKm ?? null,
              etaMinutes: match?.etaMinutes ?? null,
              slaMinutes,
              slaDeadlineAt: Date.now() + slaMinutes * 60 * 1000,
              at: Date.now(),
              arrivedAt: null,
              resolvedAt: null,
              slaMet: null,
            };
            set((s) => ({ demo: { ...s.demo, breakdowns: [record, ...s.demo.breakdowns] } }));
            await resync();
            return record;
          } finally {
            set({ busy: false });
          }
        },
      };
    },
    {
      name: 'trucksetu-membership',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ demo: s.demo }),
    },
  ),
);
