/**
 * Global app preferences: the selected role (Feature B) and locale
 * (Feature F). Persisted with AsyncStorage so the driver/dealer choice and
 * language survive restarts — role selection is a one-time onboarding step,
 * not a login wall.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Locale, UserRole } from '../types';

interface AppState {
  role: UserRole | null;
  locale: Locale;
  /** True once the persisted state has been read back from disk. */
  hasHydrated: boolean;
  setRole: (role: UserRole | null) => void;
  setLocale: (locale: Locale) => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      role: null,
      locale: 'en',
      hasHydrated: false,
      setRole: (role) => set({ role }),
      setLocale: (locale) => set({ locale }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'trucksetu-app',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ role: s.role, locale: s.locale }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
