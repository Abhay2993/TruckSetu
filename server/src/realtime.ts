/**
 * Realtime backbone — Server-Sent Events.
 *
 * SSE over plain HTTP: no extra dependency, works through proxies, and the
 * client is the browser-native EventSource (react-native-sse on devices).
 * Each connected client registers under its userId; `pushEventTo` fans an
 * event out to every open stream for that user. Chat, bids, notifications
 * and fleet positions all ride this one channel — the app just refreshes
 * the relevant store when an event of that type arrives.
 */

import { Response } from 'express';

interface Client {
  userId: string;
  res: Response;
}

const clients = new Set<Client>();

export function registerSseClient(userId: string, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: {"userId":"${userId}"}\n\n`);

  const client: Client = { userId, res };
  clients.add(client);
  res.on('close', () => {
    clients.delete(client);
  });
}

export function pushEventTo(userId: string, type: string, payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.userId !== userId) continue;
    try {
      client.res.write(`event: ${type}\ndata: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

export function connectedClientCount(): number {
  return clients.size;
}

// Keep intermediaries from closing idle streams.
setInterval(() => {
  for (const client of clients) {
    try {
      client.res.write(`: ping\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}, 25000).unref();
