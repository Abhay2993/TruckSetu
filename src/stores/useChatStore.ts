/**
 * In-app chat, keyed by shipment (Feature 10).
 *
 * Number masking is structural: the app never holds the counterpart's phone
 * — messages carry only role + text, and a "call" resolves a masked proxy
 * number from the API. Server mode persists messages server-side; demo mode
 * keeps them in this (persisted) store so a conversation survives a reload.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isServerMode } from '../config';
import { api } from '../services/api';
import type { ChatMessage, ChatSenderRole } from '../types';

interface ChatState {
  /** Messages keyed by shipment id. */
  byShipment: Record<string, ChatMessage[]>;
  load: (shipmentId: string) => Promise<void>;
  send: (shipmentId: string, text: string, role: ChatSenderRole, senderId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      byShipment: {},

      load: async (shipmentId) => {
        const remote = await api.fetchMessages(shipmentId).catch(() => null);
        if (remote) {
          set((s) => ({ byShipment: { ...s.byShipment, [shipmentId]: remote } }));
        }
      },

      send: async (shipmentId, text, role, senderId) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const remote = await api.sendMessage(shipmentId, trimmed);
        const message: ChatMessage =
          remote ?? {
            id: `msg-${Date.now()}`,
            shipmentId,
            senderId,
            senderRole: role,
            text: trimmed,
            at: Date.now(),
          };
        set((s) => ({
          byShipment: {
            ...s.byShipment,
            [shipmentId]: [...(s.byShipment[shipmentId] ?? []), message],
          },
        }));
      },
    }),
    {
      name: 'trucksetu-chat',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ byShipment: s.byShipment }),
    },
  ),
);
