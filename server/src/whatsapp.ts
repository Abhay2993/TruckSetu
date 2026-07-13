/**
 * WhatsApp integration (Meta WhatsApp Cloud API).
 *
 * OUTBOUND — `sendWhatsApp` posts a text message via the Cloud API when
 * WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID are configured; otherwise
 * it simulates. Every send (real or simulated) is recorded in
 * db.whatsappOutbox so the app/tests can see exactly what went out.
 * Production note: business-initiated messages outside the 24-hour customer
 * window require pre-approved TEMPLATES (and OTPs specifically need an
 * "authentication" template) — swap the `text` payload for a `template`
 * payload per message type once your templates are approved.
 *
 * INBOUND — `parseLoadMessage` turns a dealer's free-text WhatsApp message
 * ("LOAD Delhi to Jaipur, 18 ton cement, 42000") into a structured load.
 * The webhook in index.ts matches the sender's phone to a TruckSetu user,
 * posts the load, and replies with a confirmation.
 */

import { db, newId, persist } from './db';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
export const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'trucksetu-verify';

export const whatsappMode: 'cloud-api' | 'simulated' =
  ACCESS_TOKEN && PHONE_NUMBER_ID ? 'cloud-api' : 'simulated';

/** Send a WhatsApp text (fire-and-forget safe) and record it in the outbox. */
export async function sendWhatsApp(phone: string, text: string): Promise<void> {
  db.whatsappOutbox.unshift({
    id: newId('wa'),
    to: phone,
    text,
    mode: whatsappMode,
    at: Date.now(),
  });
  if (db.whatsappOutbox.length > 200) db.whatsappOutbox.length = 200;
  persist();

  if (whatsappMode !== 'cloud-api') {
    console.log(`[whatsapp→${phone}] ${text}`);
    return;
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/^\+/, ''),
          type: 'text',
          text: { body: text },
        }),
      },
    );
    if (!response.ok) {
      console.warn(`[whatsapp] Cloud API send failed (${response.status})`);
    }
  } catch (error) {
    console.warn('[whatsapp] send failed', error);
  }
}

// ---------------------------------------------------------------------------
// Inbound message parsing
// ---------------------------------------------------------------------------

export interface ParsedLoad {
  origin: string;
  destination: string;
  material: string;
  weightTonnes: number;
  priceInr: number;
}

const cap = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

/**
 * Parse a dealer's free-text load message. Understands the shapes dealers
 * actually type: "LOAD Delhi to Jaipur, 18 ton cement, 42000",
 * "Mumbai to Ahmedabad 9 ton FMCG rate 31000",
 * "Delhi se Jaipur 16 ton marble ₹38,000". Returns null when there's no
 * recognisable route — the webhook replies with a format hint instead.
 */
export function parseLoadMessage(raw: string): ParsedLoad | null {
  const text = raw.replace(/\s+/g, ' ').trim();

  // Drop a leading "LOAD"/"loads:" keyword so it can't leak into the origin.
  const cleaned = text.replace(/^\s*loads?\s*:?\s*/i, '');

  // Route: "<origin> to|se|-> <destination>"
  const route = /([a-z][a-z .]+?)\s+(?:to|se|->|→)\s+([a-z][a-z .]+?)(?=[,.]|\s+\d|\s+ka\b|$)/i.exec(
    cleaned,
  );
  if (!route || !route[1] || !route[2]) return null;

  // Weight: "18 ton", "9 tonne", "15MT"
  const weight = /(\d+(?:\.\d+)?)\s*(?:tons?|tonnes?|mt|टन)\b/i.exec(text);
  const weightTonnes = weight?.[1] ? Number(weight[1]) : 10;

  // Price: the last ₹/Rs-prefixed or 4+ digit number that isn't the weight.
  let priceInr = 0;
  const priceRe = /(?:₹|rs\.?|inr|rate)\s*([\d,]{4,9})|(?:^|\s)([\d,]{4,9})(?=\s|$|[,.])/gi;
  for (const m of text.matchAll(priceRe)) {
    const value = Number((m[1] ?? m[2] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 1000) priceInr = value;
  }
  if (!priceInr) return null;

  // Material: the words right after the weight ("18 ton cement, ...").
  let material = 'General goods';
  if (weight) {
    const after = text.slice((weight.index ?? 0) + weight[0].length);
    const mat = /^\s*(?:of\s+)?([a-z][a-z ]{2,30}?)(?=[,.]|\s*(?:₹|rs|inr|rate|\d)|$)/i.exec(after);
    if (mat?.[1]) material = cap(mat[1]);
  }

  return {
    origin: cap(route[1]),
    destination: cap(route[2]),
    material,
    weightTonnes,
    priceInr,
  };
}

export const WHATSAPP_HELP_REPLY = [
  'Namaste from TruckSetu! 🚛 To post a load, send:',
  'LOAD <from> to <to>, <weight> ton <material>, <price>',
  'Example: LOAD Delhi to Jaipur, 18 ton cement, 42000',
  'Send STATUS for your latest shipment.',
].join('\n');
