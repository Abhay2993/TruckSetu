/**
 * Tamper-evident trip ledger.
 *
 * Every shipment event is hash-chained: each entry's hash covers its own
 * contents AND the previous entry's hash, so altering or removing any event
 * breaks every hash after it. That turns the trip timeline from "our system
 * says so" into evidence a counterparty — or a court — can check
 * independently, which is exactly what makes the record worth staying for.
 *
 * This is deliberately not a blockchain: a single-writer hash chain gives
 * tamper-EVIDENCE (you can prove the log changed) without pretending to give
 * tamper-PROOFNESS (which would need external anchoring). The honest upgrade
 * is periodically publishing the head hash somewhere the platform does not
 * control — one function, noted below.
 */

import crypto from 'crypto';
import { EscrowEvent, EscrowShipment } from './types';

/** Genesis link for the first event in a chain. */
const GENESIS = '0'.repeat(64);

function hashEntry(prevHash: string, event: Pick<EscrowEvent, 'stage' | 'label' | 'at'>): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}|${event.stage}|${event.label}|${event.at}`)
    .digest('hex');
}

/**
 * The genesis entry for a brand-new shipment.
 *
 * Shipment-creation paths build their first event inline rather than through
 * pushEvent, so they must mint it here. An unchained first event would make
 * the SECOND event link to GENESIS instead of to it, and the whole chain
 * would fail verification.
 */
export function genesisEvent(
  stage: EscrowEvent['stage'],
  label: string,
  at: number = Date.now(),
): EscrowEvent {
  const entry = { stage, label, at };
  return { ...entry, prevHash: GENESIS, hash: hashEntry(GENESIS, entry) };
}

/**
 * Stamp an event with its chain link. Call when appending, so the chain is
 * built incrementally rather than recomputed.
 */
export function linkEvent(
  shipment: EscrowShipment,
  event: Pick<EscrowEvent, 'stage' | 'label' | 'at'>,
): { prevHash: string; hash: string } {
  const last = shipment.events[shipment.events.length - 1];
  const prevHash = last?.hash ?? GENESIS;
  return { prevHash, hash: hashEntry(prevHash, event) };
}

/** Backfill links for events written before chaining existed. */
export function sealChain(shipment: EscrowShipment): void {
  let prevHash = GENESIS;
  for (const event of shipment.events) {
    if (!event.hash) {
      event.prevHash = prevHash;
      event.hash = hashEntry(prevHash, event);
    }
    prevHash = event.hash;
  }
}

export interface ChainVerification {
  intact: boolean;
  entryCount: number;
  /** Index of the first entry whose hash does not recompute. */
  brokenAt: number | null;
  /** Head hash — publish this to anchor the log externally. */
  headHash: string | null;
  detail: string;
}

/** Recompute the whole chain and report exactly where it diverges. */
export function verifyChain(shipment: EscrowShipment): ChainVerification {
  let prevHash = GENESIS;
  for (let i = 0; i < shipment.events.length; i++) {
    const event = shipment.events[i];
    if (!event) continue;
    if (!event.hash) {
      return {
        intact: false,
        entryCount: shipment.events.length,
        brokenAt: i,
        headHash: null,
        detail: `Entry ${i + 1} is unchained — the log was written outside the ledger.`,
      };
    }
    const expected = hashEntry(prevHash, event);
    if (event.hash !== expected || (event.prevHash ?? GENESIS) !== prevHash) {
      return {
        intact: false,
        entryCount: shipment.events.length,
        brokenAt: i,
        headHash: null,
        detail: `Entry ${i + 1} ("${event.label}") does not match its hash — the record was altered.`,
      };
    }
    prevHash = event.hash;
  }
  return {
    intact: true,
    entryCount: shipment.events.length,
    brokenAt: null,
    headHash: shipment.events.length > 0 ? prevHash : null,
    detail: `All ${shipment.events.length} entries verify against the chain.`,
  };
}

/**
 * Production upgrade: publish head hashes (daily Merkle root of all open
 * shipments) to a notary the platform does not control — a public
 * timestamping service or the counterparty's own systems. That is what
 * upgrades tamper-evidence to third-party-checkable evidence.
 */
export function chainHead(shipment: EscrowShipment): string | null {
  return shipment.events[shipment.events.length - 1]?.hash ?? null;
}
