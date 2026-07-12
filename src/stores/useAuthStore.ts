/**
 * Authentication state: phone-OTP session with a persisted JWT.
 *
 * The token survives restarts (30-day expiry server-side), so drivers log in
 * once. Signing out also clears the persisted role, sending the user back
 * through the full gate: login → role select → tabs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import { syncFromServer } from '../services/sync';
import type { AuthUser } from '../types';
import { useAppStore } from './useAppStore';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  hasHydrated: boolean;
  /** Returns the dev OTP when the backend is in dev mode (or demo mode). */
  requestOtp: (phone: string) => Promise<{ devOtp?: string }>;
  /** Throws ApiError on a wrong/expired OTP — the login screen renders it. */
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  signOut: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hasHydrated: false,

      requestOtp: (phone) => api.requestOtp(phone),

      verifyOtp: async (phone, otp) => {
        const { token, user } = await api.verifyOtp(phone, otp);
        set({ token, user });
        // Returning users already picked a role server-side — restore it so
        // they land straight in their interface.
        if (user.role) {
          useAppStore.getState().setRole(user.role);
        }
        // Pull authoritative loads/shipments/wallet now that we have a token.
        void syncFromServer();
      },

      signOut: () => {
        set({ token: null, user: null });
        useAppStore.getState().setRole(null);
      },

      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'trucksetu-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) {
          useAuthStore.setState({ hasHydrated: true });
        } else {
          state.setHasHydrated(true);
        }
      },
    },
  ),
);
