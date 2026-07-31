/**
 * Driver profile & safety state: the truck number used when bidding, the
 * emergency contact, and the active SOS alert. Persisted — an SOS that
 * survives an app restart is the whole point of an SOS.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import type { TelemetryPoint } from '../types';

interface DriverState {
  truckNumber: string;
  emergencyContact: string;
  activeSosId: string | null;
  isSendingSos: boolean;
  setTruckNumber: (v: string) => void;
  setEmergencyContact: (v: string) => void;
  /** Sends the alert with the last known position. Throws on server error. */
  sendSos: (point: TelemetryPoint | null) => Promise<void>;
  resolveSos: () => Promise<void>;
}

export const useDriverStore = create<DriverState>()(
  persist(
    (set, get) => ({
      truckNumber: '',
      emergencyContact: '',
      activeSosId: null,
      isSendingSos: false,

      setTruckNumber: (v) => set({ truckNumber: v }),
      setEmergencyContact: (v) => set({ emergencyContact: v }),

      sendSos: async (point) => {
        if (get().activeSosId) return; // one active alert at a time
        set({ isSendingSos: true });
        try {
          const { id } = await api.sendSos(point);
          set({ activeSosId: id });
        } finally {
          set({ isSendingSos: false });
        }
      },

      resolveSos: async () => {
        const id = get().activeSosId;
        if (!id) return;
        set({ activeSosId: null }); // optimistic — cancel must feel instant
        await api.resolveSos(id).catch(() => {
          /* server copy stays open; ops can close it */
        });
      },
    }),
    {
      name: 'trucksetu-driver',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        truckNumber: s.truckNumber,
        emergencyContact: s.emergencyContact,
        activeSosId: s.activeSosId,
      }),
    },
  ),
);
