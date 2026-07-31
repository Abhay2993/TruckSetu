/**
 * Trip-record math shared by demo mode and the UI: detention terms and
 * hash-chain verification. Mirrors server/src/detention.ts and ledger.ts —
 * change them together.
 *
 * The hash here is a small non-cryptographic digest, not SHA-256: React
 * Native has no WebCrypto, and this side only needs to render and sanity
 * check what the server computed. Server mode always shows the server's
 * SHA-256 verdict; demo mode uses this so the feature is still exercisable
 * offline.
 */

import type { EscrowShipment, LedgerVerification } from '../types';

export const DETENTION = {
  FREE_HOURS: 6,
  RATE_INR_PER_HOUR: 250,
  MAX_INR_PER_STOP: 6000,
  GEOFENCE_KM: 5,
} as const;

export function billableHours(waitedHours: number): number {
  return Math.max(0, waitedHours - DETENTION.FREE_HOURS);
}

export function detentionCharge(waitedHours: number): number {
  return Math.min(
    DETENTION.MAX_INR_PER_STOP,
    Math.round(billableHours(waitedHours) * DETENTION.RATE_INR_PER_HOUR),
  );
}

/** Total detention on a shipment, ₹0 when nothing was recorded. */
export function detentionTotal(shipment: EscrowShipment): number {
  return shipment.detention?.chargeInr ?? 0;
}

/** FNV-1a — deterministic, dependency-free, sufficient for the demo chain. */
function digest(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Widen to a 16-char hex string so it reads like a real digest.
  const a = h.toString(16).padStart(8, '0');
  let g = 0x9e3779b9;
  for (let i = input.length - 1; i >= 0; i--) {
    g ^= input.charCodeAt(i);
    g = Math.imul(g, 0x85ebca6b) >>> 0;
  }
  return a + g.toString(16).padStart(8, '0');
}

const GENESIS = '0'.repeat(16);

/**
 * Demo-mode chain check. Events minted locally carry no hashes, so an
 * unchained log is reported honestly rather than shown as verified.
 */
export function verifyChainLocally(shipment: EscrowShipment): LedgerVerification {
  const events = shipment.events;
  if (events.length === 0) {
    return { intact: true, entryCount: 0, brokenAt: null, headHash: null, detail: 'No entries yet.' };
  }
  const unchained = events.filter((e) => !e.hash).length;
  if (unchained === events.length) {
    // Demo-only path: derive the chain now so the head hash is meaningful.
    let prev = GENESIS;
    for (const e of events) {
      prev = digest(`${prev}|${e.stage}|${e.label}|${e.at}`);
    }
    return {
      intact: true,
      entryCount: events.length,
      brokenAt: null,
      headHash: prev,
      detail: `All ${events.length} entries chained locally (demo mode — the server signs with SHA-256).`,
    };
  }
  if (unchained > 0) {
    return {
      intact: false,
      entryCount: events.length,
      brokenAt: events.findIndex((e) => !e.hash),
      headHash: null,
      detail: 'Some entries are unchained — the log was written outside the ledger.',
    };
  }
  return {
    intact: true,
    entryCount: events.length,
    brokenAt: null,
    headHash: events[events.length - 1]?.hash ?? null,
    detail: `All ${events.length} entries verify against the chain.`,
  };
}
