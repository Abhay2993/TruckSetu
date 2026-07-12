/**
 * Feature E — FASTag wallet state: balance, low-balance detection and the
 * simulated "Top Up via UPI" flow. Persisted so toll debits/top-ups made in
 * a demo session stick around.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import type { AutoRechargeRule, FastagTransaction } from '../types';

export const LOW_BALANCE_THRESHOLD_INR = 500;

const DEFAULT_RULE: AutoRechargeRule = { enabled: false, thresholdInr: 300, topUpInr: 500 };

interface FastagState {
  balanceInr: number;
  transactions: FastagTransaction[];
  autoRecharge: AutoRechargeRule;
  isToppingUp: boolean;
  topUp: (amountInr: number) => Promise<boolean>;
  /** Feature 14: save the rule (persists locally + syncs to server). */
  setAutoRecharge: (rule: AutoRechargeRule) => Promise<void>;
  /** Simulate a toll debit; applies the rule if balance drops below it. */
  payToll: (amountInr: number, plaza: string) => Promise<{ autoRecharged: boolean }>;
}

export const useFastagStore = create<FastagState>()(
  persist(
    (set) => ({
      // Seeded below the threshold on purpose so the low-balance warning
      // and top-up flow are visible on first launch.
      balanceInr: 340,
      transactions: [
        { id: 'ft-1', label: 'Toll — Kherki Daula Plaza', amountInr: -305, at: Date.now() - 1000 * 60 * 60 * 5 },
        { id: 'ft-2', label: 'Toll — Manesar Plaza', amountInr: -190, at: Date.now() - 1000 * 60 * 60 * 2 },
      ],
      autoRecharge: DEFAULT_RULE,
      isToppingUp: false,

      setAutoRecharge: async (rule) => {
        set({ autoRecharge: rule });
        await api.setAutoRecharge(rule).catch(() => {
          /* local rule stands; will re-sync next server session */
        });
      },

      payToll: async (amountInr, plaza) => {
        const remote = await api.simulateToll(amountInr, plaza).catch(() => null);
        if (remote) {
          set({ balanceInr: remote.balanceInr, transactions: remote.transactions });
          return { autoRecharged: remote.autoRecharged };
        }
        // Demo mode: debit locally, then apply the rule ourselves.
        let autoRecharged = false;
        set((s) => {
          const txns: FastagTransaction[] = [
            { id: `ft-${Date.now()}`, label: `Toll — ${plaza}`, amountInr: -Math.round(amountInr), at: Date.now() },
            ...s.transactions,
          ];
          let balance = s.balanceInr - Math.round(amountInr);
          const rule = s.autoRecharge;
          if (rule.enabled && balance < rule.thresholdInr) {
            balance += rule.topUpInr;
            txns.unshift({
              id: `auto-${Date.now()}`,
              label: `Auto top-up (balance below ₹${rule.thresholdInr})`,
              amountInr: rule.topUpInr,
              at: Date.now() + 1,
            });
            autoRecharged = true;
          }
          return { balanceInr: balance, transactions: txns };
        });
        return { autoRecharged };
      },

      topUp: async (amountInr) => {
        if (amountInr <= 0) return false;
        set({ isToppingUp: true });
        try {
          const result = await api.topUpFastag(amountInr);
          if (result.balanceInr !== undefined && result.transactions) {
            // Server mode: adopt the authoritative wallet state.
            set({ balanceInr: result.balanceInr, transactions: result.transactions });
          } else {
            set((s) => ({
              balanceInr: s.balanceInr + amountInr,
              transactions: [
                {
                  id: result.upiRef,
                  label: `Top-up via UPI (${result.upiRef.slice(0, 10)}…)`,
                  amountInr,
                  at: Date.now(),
                },
                ...s.transactions,
              ],
            }));
          }
          return true;
        } catch {
          return false;
        } finally {
          set({ isToppingUp: false });
        }
      },
    }),
    {
      name: 'trucksetu-fastag',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        balanceInr: s.balanceInr,
        transactions: s.transactions,
        autoRecharge: s.autoRecharge,
      }),
    },
  ),
);
