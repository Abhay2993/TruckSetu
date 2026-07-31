/**
 * In-app notification centre (Feature 11).
 *
 * Server mode is the source of truth — `refresh()` pulls the user's records
 * (which the backend creates on every escrow event). Demo mode has no
 * server, so local escrow/chat actions call `add()` directly, keeping the
 * bell meaningful offline. Persisted so the badge count survives restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isServerMode } from '../config';
import { api } from '../services/api';
import type { AppNotification, NotificationKind } from '../types';

interface NotificationsState {
  notifications: AppNotification[];
  unread: number;
  refresh: () => Promise<void>;
  add: (kind: NotificationKind, title: string, body: string, shipmentId?: string) => void;
  markAllRead: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unread: 0,

      refresh: async () => {
        if (!isServerMode) return;
        const result = await api.fetchNotifications().catch(() => null);
        if (result) set({ notifications: result.notifications, unread: result.unread });
      },

      add: (kind, title, body, shipmentId) =>
        set((s) => {
          const n: AppNotification = {
            id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind,
            title,
            body,
            shipmentId,
            at: Date.now(),
            read: false,
          };
          return { notifications: [n, ...s.notifications].slice(0, 50), unread: s.unread + 1 };
        }),

      markAllRead: async () => {
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), unread: 0 }));
        if (isServerMode) await api.markNotificationsRead().catch(() => {});
        else void get; // keep signature stable
      },
    }),
    {
      name: 'trucksetu-notifications',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ notifications: s.notifications, unread: s.unread }),
    },
  ),
);
