/**
 * Feature D — the offline-first telemetry queue.
 *
 * Architectural choice: the queue lives in a *persisted* Zustand store, not
 * in component state. Two reasons:
 *   1. Durability — GPS points captured in a tunnel must survive the OS
 *      killing the app, so every enqueue is written through to AsyncStorage
 *      by the persist middleware.
 *   2. Decoupling — capture (the GPS simulator), buffering (this store) and
 *      draining (useOfflineTelemetry's sync effect) are independent; any
 *      screen can observe queue depth without owning the sync lifecycle.
 *
 * Sync uses at-least-once semantics: `drain(n)` removes only the first n
 * points *after* the API confirms receipt, so points recorded while a flush
 * is in flight are never lost.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TelemetryPoint } from '../types';

/** Hard cap so a week-long network outage cannot exhaust device storage. */
const MAX_QUEUE_LENGTH = 5000;

interface TelemetryState {
  queue: TelemetryPoint[];
  lastSyncAt: number | null;
  totalSyncedCount: number;
  enqueue: (point: TelemetryPoint) => void;
  /** Remove the first `count` points after a confirmed sync. */
  drain: (count: number, syncedAt: number) => void;
}

export const useTelemetryStore = create<TelemetryState>()(
  persist(
    (set) => ({
      queue: [],
      lastSyncAt: null,
      totalSyncedCount: 0,
      enqueue: (point) =>
        set((s) => ({
          // Drop the oldest point when full — recent positions matter most.
          queue: [...s.queue.slice(-(MAX_QUEUE_LENGTH - 1)), point],
        })),
      drain: (count, syncedAt) =>
        set((s) => ({
          queue: s.queue.slice(count),
          lastSyncAt: syncedAt,
          totalSyncedCount: s.totalSyncedCount + count,
        })),
    }),
    {
      name: 'trucksetu-telemetry',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        queue: s.queue,
        lastSyncAt: s.lastSyncAt,
        totalSyncedCount: s.totalSyncedCount,
      }),
    },
  ),
);
