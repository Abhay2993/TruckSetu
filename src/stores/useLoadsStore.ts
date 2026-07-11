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
  postLoad: (input: PostLoadInput) => void;
  acceptBid: (loadId: string, bidId: string) => void;
}

export const useLoadsStore = create<LoadsState>()(
  persist(
    (set, get) => ({
      loads: SEED_LOADS,

      postLoad: (input) =>
        set((s) => ({
          loads: [
            {
              ...input,
              id: `load-${Date.now()}`,
              status: 'open',
              bids: [],
              postedAt: Date.now(),
            },
            ...s.loads,
          ],
        })),

      acceptBid: (loadId, bidId) => {
        const load = get().loads.find((l) => l.id === loadId);
        const bid = load?.bids.find((b) => b.id === bidId);
        if (!load || !bid || load.status !== 'open') return;

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
    }),
    {
      name: 'trucksetu-loads',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ loads: s.loads }),
    },
  ),
);
