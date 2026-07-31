/**
 * Realtime client (Feature 16) — one SSE stream, many features upgraded.
 *
 * Connects to GET /v1/events with the JWT (EventSource can't set headers,
 * so it rides a query param) and fans events into the stores:
 *   • 'message'       → append to the shipment's chat thread instantly
 *   • 'notification'  → refresh the notification centre (badge bumps live)
 * react-native-sse is pure JS (XHR-based), so the same client runs in Expo
 * Go, standalone builds and the browser. Demo mode is a no-op — there is no
 * server to stream from. Auto-reconnect is handled by the library.
 */

import EventSource from 'react-native-sse';
import { API_URL, isServerMode } from '../config';
import { useChatStore } from '../stores/useChatStore';
import { useNotificationsStore } from '../stores/useNotificationsStore';
import type { ChatMessage } from '../types';

type StreamEvents = 'hello' | 'message' | 'notification';

let source: EventSource<StreamEvents> | null = null;

export function connectRealtime(token: string): void {
  if (!isServerMode || !API_URL || source) return;

  source = new EventSource<StreamEvents>(
    `${API_URL}/v1/events?token=${encodeURIComponent(token)}`,
  );

  source.addEventListener('message', (event) => {
    if (!('data' in event) || !event.data) return;
    try {
      const message = JSON.parse(event.data) as ChatMessage;
      useChatStore.setState((s) => {
        const thread = s.byShipment[message.shipmentId] ?? [];
        if (thread.some((m) => m.id === message.id)) return s; // dedupe
        return {
          byShipment: { ...s.byShipment, [message.shipmentId]: [...thread, message] },
        };
      });
    } catch {
      /* malformed frame — ignore */
    }
  });

  source.addEventListener('notification', () => {
    void useNotificationsStore.getState().refresh();
  });

  source.addEventListener('error', () => {
    /* react-native-sse retries automatically; nothing to do */
  });
}

export function disconnectRealtime(): void {
  source?.removeAllEventListeners();
  source?.close();
  source = null;
}
