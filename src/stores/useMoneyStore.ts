/**
 * TruckSetu Money state.
 *
 * Server mode adopts the authoritative summary from /v1/money/summary and
 * re-fetches after every action. Demo mode builds the same shape locally
 * from the escrow store using services/money.ts arithmetic — identical
 * numbers, no backend — so the public preview exercises the whole product.
 *
 * Only demo-mode state is persisted; in server mode the summary is derived
 * from the server on every refresh, so caching it would only risk drift.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import { computeTruckScore } from '../services/creditScore';
import {
  EMI_CATALOGUE,
  MONEY,
  emiMonthly,
  fuelSwipeMath,
  insuranceQuote,
  invoiceFaceValue,
  limitForScore,
  PARTNER_PUMPS,
  quoteDiscount,
  vehicleLoanQuote,
} from '../services/money';
import type {
  CreditFacility,
  DiscountableInvoice,
  DrivingScore,
  EmiPlan,
  FuelCardAccount,
  InsurancePolicy,
  InvoiceAdvance,
  MoneySummary,
  PlatformScore,
  VehicleLoanApplication,
} from '../types';
import { useAppStore } from './useAppStore';
import { useEscrowStore } from './useEscrowStore';

/** Demo-mode driving score — a good-but-improvable driver. */
const DEMO_DRIVING: DrivingScore = {
  score: 78,
  band: 'Safe',
  discountPercent: 11,
  sampleSize: 420,
};

const EMPTY_CARD: FuelCardAccount = {
  last4: '4417',
  creditLimitInr: 15000,
  outstandingInr: 0,
  litresThisMonth: 0,
  savedInr: 0,
  transactions: [],
};

interface DemoState {
  drawnInr: number;
  emis: EmiPlan[];
  advances: InvoiceAdvance[];
  vehicleLoans: VehicleLoanApplication[];
  policies: InsurancePolicy[];
  fuelCard: FuelCardAccount;
  bureauConsent: boolean;
}

const INITIAL_DEMO: DemoState = {
  drawnInr: 0,
  emis: [],
  advances: [],
  vehicleLoans: [],
  policies: [],
  fuelCard: EMPTY_CARD,
  bureauConsent: false,
};

interface MoneyState {
  summary: MoneySummary | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  demo: DemoState;
  refresh: () => Promise<void>;
  discountInvoice: (shipmentId: string, termDays: 30 | 60) => Promise<void>;
  drawCredit: (amountInr: number) => Promise<void>;
  repayCredit: (amountInr: number) => Promise<void>;
  takeEmi: (itemId: string, tenorMonths: number) => Promise<void>;
  swipeFuelCard: (pump: string, litres: number) => Promise<void>;
  applyVehicleLoan: (
    amountInr: number,
    tenorMonths: number,
    purpose: 'purchase' | 'refinance',
  ) => Promise<void>;
  renewInsurance: (sumInsuredInr: number) => Promise<void>;
  setBureauConsent: (granted: boolean) => Promise<void>;
}

/** Dealer counterpart to TruckScore — volume and settlement discipline. */
function demoDealerScore(): PlatformScore {
  const shipments = useEscrowStore.getState().shipments;
  const settled = shipments.filter((s) => s.stage === 'BALANCE_RELEASED');
  const volumeInr = shipments.reduce((sum, s) => sum + s.totalAmountInr, 0);
  const disputed = shipments.filter((s) => s.disputeId).length;
  const settleRate = shipments.length ? settled.length / shipments.length : null;

  let score = 300;
  score += Math.min(220, Math.round(volumeInr / 25000) * 20);
  score += Math.min(180, settled.length * 30);
  score += settleRate !== null ? Math.round(settleRate * 120) : 50;
  score -= disputed * 70;
  score = Math.max(300, Math.min(900, score));

  return {
    score,
    band: score >= 750 ? 'Excellent' : score >= 620 ? 'Good' : score >= 480 ? 'Fair' : 'Building',
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

/** Build the same summary shape the server returns, from local state. */
function buildDemoSummary(demo: DemoState): MoneySummary {
  const role = useAppStore.getState().role;
  const shipments = useEscrowStore.getState().shipments;

  const score: PlatformScore =
    role === 'dealer'
      ? demoDealerScore()
      : (() => {
          const ts = computeTruckScore(shipments);
          return { score: ts.score, band: ts.band, factors: ts.factors };
        })();

  const limitInr = Math.max(limitForScore(score.score, role), demo.drawnInr);
  const advancedIds = new Set(demo.advances.map((a) => a.shipmentId));
  const discountable: DiscountableInvoice[] = shipments
    .filter((s) => s.stage === 'BALANCE_RELEASED' && !advancedIds.has(s.id) && !s.disputeId)
    .map((s) => ({
      shipmentId: s.id,
      invoiceNo: `TS-INV-${s.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`,
      route: `${s.origin} → ${s.destination}`,
      faceValueInr: invoiceFaceValue(s),
      quote30: quoteDiscount(s, 30),
      quote60: quoteDiscount(s, 60),
    }));

  const facility: CreditFacility = {
    limitInr,
    drawnInr: demo.drawnInr,
    availableInr: Math.max(0, limitInr - demo.drawnInr),
    aprPercent: Math.round(MONEY.CREDIT_LINE_APR * 100),
    draws: [],
    repayments: [],
  };

  return {
    score,
    driving: DEMO_DRIVING,
    facility,
    fuelCard: demo.fuelCard,
    emis: demo.emis,
    advances: demo.advances,
    discountable,
    vehicleLoans: demo.vehicleLoans,
    policies: demo.policies,
    insuranceQuote: insuranceQuote(800000, DEMO_DRIVING),
    bureauConsent: demo.bureauConsent,
  };
}

export const useMoneyStore = create<MoneyState>()(
  persist(
    (set, get) => {
      /** Server: adopt the fresh summary. Demo: rebuild from local state. */
      const resync = async () => {
        const remote = await api.moneySummary().catch(() => null);
        set({ summary: remote ?? buildDemoSummary(get().demo) });
      };

      /**
       * Run a money action: the server call is authoritative when present;
       * otherwise `local` applies the identical transition to demo state.
       */
      const act = async (
        remote: () => Promise<unknown | null>,
        local: (demo: DemoState) => DemoState,
      ) => {
        set({ busy: true, error: null });
        try {
          const result = await remote();
          if (result === null) set({ demo: local(get().demo) });
          await resync();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not complete that request.' });
        } finally {
          set({ busy: false });
        }
      };

      return {
        summary: null,
        loading: false,
        busy: false,
        error: null,
        demo: INITIAL_DEMO,

        refresh: async () => {
          set({ loading: true, error: null });
          try {
            await resync();
          } catch (e) {
            set({ error: e instanceof Error ? e.message : 'Could not load TruckSetu Money.' });
          } finally {
            set({ loading: false });
          }
        },

        discountInvoice: (shipmentId, termDays) =>
          act(
            () => api.discountInvoice(shipmentId, termDays),
            (demo) => {
              const shipment = useEscrowStore
                .getState()
                .shipments.find((s) => s.id === shipmentId);
              if (!shipment) return demo;
              const quote = quoteDiscount(shipment, termDays);
              const advance: InvoiceAdvance = {
                id: `adv-${Date.now()}`,
                shipmentId,
                invoiceNo: `TS-INV-${shipmentId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`,
                faceValueInr: quote.faceValueInr,
                feeInr: quote.feeInr,
                netInr: quote.netInr,
                termDays,
                dueAt: quote.dueAt,
                status: 'advanced',
                at: Date.now(),
              };
              return { ...demo, advances: [advance, ...demo.advances] };
            },
          ),

        drawCredit: (amountInr) =>
          act(
            () => api.drawCredit(amountInr),
            (demo) => ({ ...demo, drawnInr: demo.drawnInr + amountInr }),
          ),

        repayCredit: (amountInr) =>
          act(
            () => api.repayCredit(amountInr),
            (demo) => ({ ...demo, drawnInr: Math.max(0, demo.drawnInr - amountInr) }),
          ),

        takeEmi: (itemId, tenorMonths) =>
          act(
            () => api.takeEmi(itemId, tenorMonths),
            (demo) => {
              const item = EMI_CATALOGUE.find((i) => i.id === itemId);
              if (!item) return demo;
              const monthlyInr = emiMonthly(item.priceInr, tenorMonths);
              const plan: EmiPlan = {
                id: `emi-${Date.now()}`,
                itemId: item.id,
                itemLabel: item.label,
                principalInr: item.priceInr,
                tenorMonths,
                monthlyInr,
                aprPercent: Math.round(MONEY.EMI_APR * 100),
                paidInstalments: 0,
                outstandingInr: monthlyInr * tenorMonths,
                status: 'active',
                at: Date.now(),
              };
              return { ...demo, emis: [plan, ...demo.emis] };
            },
          ),

        swipeFuelCard: (pump, litres) =>
          act(
            () => api.swipeFuelCard(pump, litres),
            (demo) => {
              const station = PARTNER_PUMPS.find((p) => p.name === pump) ?? PARTNER_PUMPS[0];
              const math = fuelSwipeMath(litres, station.dieselInrPerLitre);
              const card = demo.fuelCard;
              return {
                ...demo,
                fuelCard: {
                  ...card,
                  outstandingInr: card.outstandingInr + math.netInr,
                  litresThisMonth: card.litresThisMonth + litres,
                  savedInr: card.savedInr + math.discountInr + math.cashbackInr,
                  transactions: [
                    {
                      id: `fcx-${Date.now()}`,
                      pump: station.name,
                      city: station.city,
                      litres,
                      amountInr: math.netInr,
                      discountInr: math.discountInr,
                      cashbackInr: math.cashbackInr,
                      at: Date.now(),
                    },
                    ...card.transactions,
                  ].slice(0, 50),
                },
              };
            },
          ),

        applyVehicleLoan: (amountInr, tenorMonths, purpose) =>
          act(
            () => api.applyVehicleLoan(amountInr, tenorMonths, purpose),
            (demo) => {
              const score = buildDemoSummary(demo).score.score;
              const quote = vehicleLoanQuote(score, amountInr, tenorMonths);
              const application: VehicleLoanApplication = {
                id: `vl-${Date.now()}`,
                purpose,
                amountInr,
                tenorMonths,
                aprPercent: quote.aprPercent,
                emiInr: quote.emiInr,
                status: quote.eligible ? 'approved' : 'rejected',
                at: Date.now(),
              };
              return { ...demo, vehicleLoans: [application, ...demo.vehicleLoans] };
            },
          ),

        renewInsurance: (sumInsuredInr) =>
          act(
            () => api.renewInsurance(sumInsuredInr),
            (demo) => {
              const quote = insuranceQuote(sumInsuredInr, DEMO_DRIVING);
              const policy: InsurancePolicy = {
                id: `pol-${Date.now()}`,
                sumInsuredInr,
                basePremiumInr: quote.basePremiumInr,
                discountPercent: quote.discountPercent,
                premiumInr: quote.premiumInr,
                validUntil: Date.now() + 365 * 24 * 3600 * 1000,
                at: Date.now(),
              };
              return { ...demo, policies: [policy, ...demo.policies] };
            },
          ),

        setBureauConsent: async (granted) => {
          await api.setBureauConsent(granted).catch(() => {
            /* local consent stands; re-syncs next server session */
          });
          set((s) => ({ demo: { ...s.demo, bureauConsent: granted } }));
          await resync();
        },
      };
    },
    {
      name: 'trucksetu-money',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ demo: s.demo }),
    },
  ),
);
