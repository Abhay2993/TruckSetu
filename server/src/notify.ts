/**
 * Notifications: persist an in-app record AND best-effort push to the user's
 * device via Expo's push service. The record is the source of truth (the
 * app's bell reads it); the push is a fire-and-forget nudge, so a push
 * failure never blocks the business action that triggered it.
 *
 * Expo push needs no credentials for the request itself — the Expo push
 * token identifies the device — which is why this works from any host.
 */

import { db, newId, persist } from './db';
import { pushEventTo } from './realtime';
import { NotificationKind } from './types';
import { sendWhatsApp } from './whatsapp';

interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  shipmentId?: string;
}

export function notifyUser(input: NotifyInput): void {
  db.notifications.unshift({
    id: newId('ntf'),
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    shipmentId: input.shipmentId,
    at: Date.now(),
    read: false,
  });
  persist();

  // Realtime: connected apps get the event instantly over SSE.
  pushEventTo(input.userId, 'notification', {
    kind: input.kind,
    title: input.title,
    body: input.body,
    shipmentId: input.shipmentId,
  });

  const user = db.users.find((u) => u.id === input.userId);

  // WhatsApp mirror — where Indian drivers actually read messages.
  if (user?.whatsappOptIn) {
    void sendWhatsApp(user.phone, `${input.title}\n${input.body}`);
  }

  const token = user?.pushToken;
  if (!token) return;

  // Fire-and-forget; Expo tokens look like ExponentPushToken[...].
  void fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: input.title,
      body: input.body,
      data: { shipmentId: input.shipmentId, kind: input.kind },
    }),
  }).catch((error) => {
    console.warn('[push] send failed', error);
  });
}
