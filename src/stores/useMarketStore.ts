/**
 * Marketplace state: the assured return load, lane density, trip chaining
 * and part-load consolidation.
 *
 * Server mode adopts /v1/market/summary; demo mode computes the identical
 * shape from the loads/shipments stores via services/marketplace.ts. Only
 * the demo-side guarantee record is persisted — everything else is derived,
 * so caching it would just risk drift.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import {
  buildChain,
  consolidationGroups,
  guaranteeOffer,
  laneDensities,
  laneIndex,
  MARKET,
} from '../services/marketplace';
import type { LaneIndex, MarketSummary, ReturnGuarantee } from '../types';
import { useEscrowStore } from './useEscrowStore';
import { useLoadsStore } from './useLoadsStore';

interface MarketState {
  summary: MarketSummary | null;
  index: LaneIndex | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Demo-mode guarantee record (server mode keeps it server-side). */
  demoGuarantee: ReturnGuarantee | null;
  refresh: (city?: string) => Promise<void>;
  takeGuarantee: (shipmentId: string, city: string) => Promise<void>;
  claimStandby: (guaranteeId: string) => Promise<number | null>;
  bookChain: (startCity: string, truckNumber: string) => Promise<number>;
}

/** Settle a demo guarantee the same way the server would. */
function settleDemo(g: ReturnGuarantee | null): ReturnGuarantee | null {
  if (!g || g.status !== 'active') return g;
  const bookedOut = useEscrowStore
    .getState()
    .shipments.find(
      (s) =>
        s.origin === g.city && (s.events[0]?.at ?? 0) >= g.startedAt && (s.events[0]?.at ?? 0) <= g.expiresAt,
    );
  if (bookedOut) {
    return { ...g, status: 'fulfilled', resolvedAt: Date.now(), fulfilledByShipmentId: bookedOut.id };
  }
  if (Date.now() > g.expiresAt) {
    return { ...g, status: 'standby_due', resolvedAt: Date.now() };
  }
  return g;
}

function buildDemoSummary(city: string, demoGuarantee: ReturnGuarantee | null): MarketSummary {
  const loads = useLoadsStore.getState().loads;
  const shipments = useEscrowStore.getState().shipments;
  return {
    city,
    guarantee: guaranteeOffer(city, loads),
    activeGuarantee: settleDemo(demoGuarantee),
    lanes: laneDensities(loads, shipments),
    chain: buildChain(city, loads),
    consolidation: consolidationGroups(loads),
  };
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      summary: null,
      index: null,
      loading: false,
      busy: false,
      error: null,
      demoGuarantee: null,

      refresh: async (city) => {
        set({ loading: true, error: null });
        try {
          const target =
            city ??
            useEscrowStore.getState().shipments.find((s) => s.stage !== 'BALANCE_RELEASED')
              ?.destination ??
            'Jaipur';
          const [remote, remoteIndex] = await Promise.all([
            api.marketSummary(target).catch(() => null),
            api.laneIndex().catch(() => null),
          ]);
          const loads = useLoadsStore.getState().loads;
          const shipments = useEscrowStore.getState().shipments;
          set({
            summary: remote ?? buildDemoSummary(target, get().demoGuarantee),
            index: remoteIndex ?? laneIndex(shipments, loads),
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not load the market view.' });
        } finally {
          set({ loading: false });
        }
      },

      takeGuarantee: async (shipmentId, city) => {
        set({ busy: true, error: null });
        try {
          const remote = await api.takeGuarantee(shipmentId);
          if (!remote) {
            // Demo mode: mint the identical record locally.
            const now = Date.now();
            set({
              demoGuarantee: {
                id: `grt-${now}`,
                city,
                shipmentId,
                windowHours: MARKET.GUARANTEE_WINDOW_HOURS,
                standbyFeeInr: MARKET.STANDBY_FEE_INR,
                status: 'active',
                startedAt: now,
                expiresAt: now + MARKET.GUARANTEE_WINDOW_HOURS * 3600 * 1000,
                resolvedAt: null,
                fulfilledByShipmentId: null,
                paidAt: null,
              },
            });
          }
          await get().refresh(city);
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not start the guarantee.' });
        } finally {
          set({ busy: false });
        }
      },

      claimStandby: async (guaranteeId) => {
        set({ busy: true, error: null });
        try {
          const remote = await api.claimStandby(guaranteeId);
          if (remote) {
            await get().refresh();
            return remote.paidInr;
          }
          const g = get().demoGuarantee;
          if (!g || settleDemo(g)?.status !== 'standby_due') {
            set({ error: 'The window is still open — we are still searching.' });
            return null;
          }
          set({ demoGuarantee: { ...g, status: 'paid', paidAt: Date.now() } });
          await get().refresh();
          return g.standbyFeeInr;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not claim the standby fee.' });
          return null;
        } finally {
          set({ busy: false });
        }
      },

      bookChain: async (startCity, truckNumber) => {
        set({ busy: true, error: null });
        try {
          const remote = await api.bookChain(startCity, truckNumber);
          if (remote) {
            for (const shipment of remote.shipments) {
              useEscrowStore.getState().addShipment(shipment);
            }
            await get().refresh(startCity);
            return remote.shipments.length;
          }
          // Demo mode: create one shipment per leg with the uplifted payout.
          const loads = useLoadsStore.getState().loads;
          const quote = buildChain(startCity, loads);
          if (!quote) {
            set({ error: 'Not enough open loads to chain a trip from there yet.' });
            return 0;
          }
          const chainId = `chn-${Date.now()}`;
          quote.legs.forEach((leg, i) => {
            const load = loads.find((l) => l.id === leg.loadId);
            if (!load) return;
            useEscrowStore.getState().addShipment({
              id: `shp-${Date.now()}-${i}`,
              loadId: load.id,
              origin: leg.origin,
              destination: leg.destination,
              driverName: 'You',
              truckNumber,
              totalAmountInr: Math.round(
                (leg.priceInr / quote.separateTotalInr) * quote.driverPayoutInr,
              ),
              advancePercent: load.advancePercent,
              stage: 'CREATED',
              pod: null,
              consignmentNo: load.consignmentNo,
              disputeId: null,
              insured: load.insured,
              chainId,
              chainLeg: i + 1,
              chainLegs: quote.legs.length,
              events: [
                {
                  stage: 'CREATED',
                  label: `Chained trip leg ${i + 1}/${quote.legs.length} — ${leg.origin} → ${leg.destination}`,
                  at: Date.now(),
                },
              ],
            });
          });
          useLoadsStore.setState((s) => ({
            loads: s.loads.map((l) =>
              quote.legs.some((leg) => leg.loadId === l.id) ? { ...l, status: 'booked' as const } : l,
            ),
          }));
          await get().refresh(startCity);
          return quote.legs.length;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not book the chained trip.' });
          return 0;
        } finally {
          set({ busy: false });
        }
      },
    }),
    {
      name: 'trucksetu-market',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ demoGuarantee: s.demoGuarantee }),
    },
  ),
);
