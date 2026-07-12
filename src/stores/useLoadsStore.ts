/**
 * Dealer-side load board: posting loads and managing bids (Feature B).
 * Accepting a bid is the hand-off point into the escrow pipeline — it
 * creates an EscrowShipment in useEscrowStore, which is why this store
 * imports that one (the dependency is one-way by design).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SEED_LOADS } from '../data/mock';
import { api } from '../services/api';
import type { Load } from '../types';
import { useEscrowStore } from './useEscrowStore';

export interface PostLoadInput {
  origin: string;
  destination: string;
  material: string;
  weightTonnes: number;
  priceInr: number;
  advancePercent: number;
}

interface LoadsState {
  loads: Load[];
  /** Throws ApiError in server mode when the backend rejects the load. */
  postLoad: (input: PostLoadInput) => Promise<void>;
  /** Throws ApiError in server mode when the backend rejects the accept. */
  acceptBid: (loadId: string, bidId: string) => Promise<void>;
  /** Driver-side: bid on an open load (backhaul finder). */
  placeBid: (loadId: string, amountInr: number, truckNumber: string) => Promise<void>;
}

export const useLoadsStore = create<LoadsState>()(
  persist(
    (set, get) => ({
      loads: SEED_LOADS,

      postLoad: async (input) => {
        // Server mode: server assigns the id and is the source of truth.
        // Demo mode: createLoad returns null and we mint the load locally.
        const remote = await api.createLoad(input);
        const load: Load =
          remote ?? {
            ...input,
            id: `load-${Date.now()}`,
            status: 'open',
            bids: [],
            postedAt: Date.now(),
          };
        set((s) => ({ loads: [load, ...s.loads] }));
      },

      acceptBid: async (loadId, bidId) => {
        const load = get().loads.find((l) => l.id === loadId);
        const bid = load?.bids.find((b) => b.id === bidId);
        if (!load || !bid || load.status !== 'open') return;

        const remote = await api.acceptBid(loadId, bidId);
        if (remote) {
          // Adopt the server's canonical load + shipment.
          useEscrowStore.getState().addShipment(remote.shipment);
          set((s) => ({ loads: s.loads.map((l) => (l.id === loadId ? remote.load : l)) }));
          return;
        }

        useEscrowStore.getState().addShipment({
          id: `shp-${Date.now()}`,
          loadId: load.id,
          origin: load.origin,
          destination: load.destination,
          driverName: bid.driverName,
          truckNumber: bid.truckNumber,
          totalAmountInr: bid.amountInr,
          advancePercent: load.advancePercent,
          stage: 'CREATED',
          pod: null,
          events: [
            {
              stage: 'CREATED',
              label: `Bid accepted — ${bid.driverName} (${bid.truckNumber})`,
              at: Date.now(),
            },
          ],
        });

        set((s) => ({
          loads: s.loads.map((l) => (l.id === loadId ? { ...l, status: 'booked' as const } : l)),
        }));
      },

      placeBid: async (loadId, amountInr, truckNumber) => {
        const load = get().loads.find((l) => l.id === loadId);
        if (!load || load.status !== 'open') return;

        const remote = await api.placeBid(loadId, { amountInr, truckNumber });
        if (remote) {
          set((s) => ({ loads: s.loads.map((l) => (l.id === loadId ? remote.load : l)) }));
          return;
        }

        // Demo mode: append the bid locally so the driver sees it land.
        set((s) => ({
          loads: s.loads.map((l) =>
            l.id === loadId
              ? {
                  ...l,
                  bids: [
                    ...l.bids,
                    {
                      id: `bid-${Date.now()}`,
                      driverName: 'You',
                      truckNumber,
                      amountInr: Math.round(amountInr),
                      rating: 4.0,
                      placedAt: Date.now(),
                    },
                  ],
                }
              : l,
          ),
        }));
      },
    }),
    {
      name: 'trucksetu-loads',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ loads: s.loads }),
    },
  ),
);
