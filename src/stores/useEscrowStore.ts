/**
 * Feature C — the 2-stage Indian escrow payment model.
 *
 * Stage 1 (Advance): `confirmDispatch` moves the shipment to DISPATCHED and
 * immediately fires the advance payout (60–80% of freight, typically spent
 * on fuel). The payout is awaited through the mock API so the UI shows a
 * real "processing" window before ADVANCE_PAID.
 *
 * Stage 2 (Balance): the remainder stays "locked" until the driver attaches
 * a digital POD (`attachPod` → POD_UPLOADED), after which — and only after
 * which — the dealer's `releaseBalance` action becomes legal.
 *
 * Stage transitions are validated inside the store so no screen can skip a
 * step; every transition appends to the `events` audit trail that the
 * dashboard renders as a timeline.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isServerMode } from '../config';
import { SEED_SETTLED_SHIPMENT, SEED_SHIPMENT } from '../data/mock';
import { api } from '../services/api';
import type { EscrowShipment, EscrowStage, NotificationKind, ProofOfDelivery } from '../types';
import { useNotificationsStore } from './useNotificationsStore';

/**
 * Emit an in-app notification for an escrow event — demo mode only, because
 * in server mode the backend already creates the authoritative record (which
 * refresh() pulls). Avoids double notifications.
 */
function localNotify(
  kind: NotificationKind,
  title: string,
  body: string,
  shipmentId: string,
): void {
  if (isServerMode) return;
  useNotificationsStore.getState().add(kind, title, body, shipmentId);
}

interface EscrowState {
  shipments: EscrowShipment[];
  /** Shipment ids with a payment API call in flight (drives spinners). */
  processingIds: string[];
  addShipment: (shipment: EscrowShipment) => void;
  confirmDispatch: (shipmentId: string) => Promise<void>;
  attachPod: (shipmentId: string, pod: ProofOfDelivery) => Promise<void>;
  releaseBalance: (shipmentId: string) => Promise<void>;
  /** Two-way rating, legal only after settlement. */
  rateShipment: (shipmentId: string, stars: number, as: 'dealer' | 'driver') => Promise<void>;
}

/** Split helper used by both the store and the dashboard UI. */
export function splitAmounts(shipment: EscrowShipment): {
  advanceInr: number;
  balanceInr: number;
} {
  const advanceInr = Math.round((shipment.totalAmountInr * shipment.advancePercent) / 100);
  return { advanceInr, balanceInr: shipment.totalAmountInr - advanceInr };
}

function transition(
  shipments: EscrowShipment[],
  shipmentId: string,
  stage: EscrowStage,
  label: string,
  extra?: Partial<EscrowShipment>,
): EscrowShipment[] {
  return shipments.map((s) =>
    s.id === shipmentId
      ? { ...s, ...extra, stage, events: [...s.events, { stage, label, at: Date.now() }] }
      : s,
  );
}

export const useEscrowStore = create<EscrowState>()(
  persist(
    (set, get) => ({
      shipments: [SEED_SHIPMENT, SEED_SETTLED_SHIPMENT],
      processingIds: [],

      addShipment: (shipment) => set((s) => ({ shipments: [shipment, ...s.shipments] })),

      confirmDispatch: async (shipmentId) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        if (!shipment || shipment.stage !== 'CREATED') return;

        set((s) => ({
          processingIds: [...s.processingIds, shipmentId],
          shipments: transition(s.shipments, shipmentId, 'DISPATCHED', 'Load confirmed & dispatched'),
        }));

        const { advanceInr } = splitAmounts(shipment);
        try {
          // Stage 1 fires automatically on dispatch — no extra user action.
          // Server mode returns the authoritative shipment; demo mode
          // returns null and the equivalent transition is applied locally.
          const remote = await api.dispatchShipment(shipmentId);
          if (remote) {
            set((s) => ({
              shipments: s.shipments.map((sh) => (sh.id === shipmentId ? remote : sh)),
            }));
            return;
          }
          set((s) => ({
            shipments: transition(
              s.shipments,
              shipmentId,
              'ADVANCE_PAID',
              `Advance paid to fuel card (ref ADV-${shipmentId}-${advanceInr})`,
            ),
          }));
          localNotify('advance_paid', 'Advance paid to fuel card', `₹${advanceInr} released`, shipmentId);
        } catch {
          // Payout failed — roll back so the dealer can retry dispatch.
          set((s) => ({
            shipments: s.shipments.map((sh) =>
              sh.id === shipmentId
                ? {
                    ...sh,
                    stage: 'CREATED',
                    events: [
                      ...sh.events,
                      { stage: 'CREATED' as const, label: 'Advance payout failed — retry dispatch', at: Date.now() },
                    ],
                  }
                : sh,
            ),
          }));
        } finally {
          set((s) => ({ processingIds: s.processingIds.filter((id) => id !== shipmentId) }));
        }
      },

      attachPod: async (shipmentId, pod) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        if (!shipment || shipment.stage !== 'ADVANCE_PAID') return;
        // OCR verification (Feature 12): compare the number read off the POD
        // to what the load promised. Server recomputes authoritatively; this
        // gives demo mode the same verified/mismatch signal.
        const verified = Boolean(
          shipment.consignmentNo && pod.ocrConsignmentNo && pod.ocrConsignmentNo === shipment.consignmentNo,
        );
        const verifiedPod = { ...pod, verified };
        const label = verified
          ? `POD uploaded & verified (consignment ${pod.ocrConsignmentNo})`
          : shipment.consignmentNo
            ? `POD uploaded — consignment mismatch (read ${pod.ocrConsignmentNo ?? 'none'}, expected ${shipment.consignmentNo})`
            : `POD uploaded (${pod.fileName})`;
        // Optimistic local transition — the POD file lives on-device, so the
        // driver's copy is correct regardless of connectivity.
        set((s) => ({
          shipments: transition(s.shipments, shipmentId, 'POD_UPLOADED', label, { pod: verifiedPod }),
        }));
        localNotify(
          'pod_uploaded',
          verified ? 'POD uploaded & verified' : 'POD uploaded — needs review',
          verified ? 'Consignment matches' : 'Check the consignment number',
          shipmentId,
        );
        try {
          const remote = await api.uploadPod(shipmentId, pod);
          if (remote) {
            // Server copy is authoritative but must not clobber the local
            // file uri (the server only stores metadata).
            set((s) => ({
              shipments: s.shipments.map((sh) =>
                sh.id === shipmentId ? { ...remote, pod: sh.pod ?? remote.pod } : sh,
              ),
            }));
          }
        } catch (error) {
          // Local state stands; the next releaseBalance surfaces any
          // server-side stage mismatch as a retryable failure event.
          console.warn('[escrow] POD server sync failed', error);
        }
      },

      releaseBalance: async (shipmentId) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        // The guard that makes this "escrow": no POD, no release.
        if (!shipment || shipment.stage !== 'POD_UPLOADED') return;
        // Feature 13: an open dispute freezes the money (server enforces the
        // same; this keeps the demo honest and avoids a doomed request).
        if (shipment.disputeId) return;

        set((s) => ({ processingIds: [...s.processingIds, shipmentId] }));
        const { balanceInr } = splitAmounts(shipment);
        try {
          const remote = await api.releaseShipmentBalance(shipmentId);
          if (remote) {
            set((s) => ({
              shipments: s.shipments.map((sh) =>
                sh.id === shipmentId ? { ...remote, pod: sh.pod ?? remote.pod } : sh,
              ),
            }));
            return;
          }
          set((s) => ({
            shipments: transition(
              s.shipments,
              shipmentId,
              'BALANCE_RELEASED',
              `Balance released from escrow (ref BAL-${shipmentId}-${balanceInr})`,
            ),
          }));
          localNotify('balance_released', 'Balance released!', `₹${balanceInr} paid — trip settled`, shipmentId);
        } catch {
          // Payment API failed — stay in POD_UPLOADED so the dealer can
          // retry, and record the attempt in the audit trail. Without this
          // catch the rejection would escape as an unhandled promise
          // rejection (screens call this fire-and-forget).
          set((s) => ({
            shipments: transition(
              s.shipments,
              shipmentId,
              'POD_UPLOADED',
              'Balance release failed — tap Release Balance to retry',
            ),
          }));
        } finally {
          set((s) => ({ processingIds: s.processingIds.filter((id) => id !== shipmentId) }));
        }
      },

      rateShipment: async (shipmentId, stars, as) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        const clamped = Math.round(Math.min(5, Math.max(1, stars)));
        if (!shipment || shipment.stage !== 'BALANCE_RELEASED') return;

        // Optimistic — a star tap must feel instant.
        const field = as === 'dealer' ? 'ratingByDealer' : 'ratingByDriver';
        set((s) => ({
          shipments: s.shipments.map((sh) =>
            sh.id === shipmentId ? { ...sh, [field]: clamped } : sh,
          ),
        }));
        try {
          const remote = await api.rateShipment(shipmentId, clamped, as);
          if (remote) {
            set((s) => ({
              shipments: s.shipments.map((sh) =>
                sh.id === shipmentId ? { ...remote, pod: sh.pod ?? remote.pod } : sh,
              ),
            }));
          }
        } catch (error) {
          console.warn('[escrow] rating sync failed', error);
        }
      },
    }),
    {
      name: 'trucksetu-escrow',
      storage: createJSONStorage(() => AsyncStorage),
      // processingIds is transient UI state — never persist it, otherwise a
      // crash mid-payment would leave a shipment stuck "processing" forever.
      partialize: (s) => ({ shipments: s.shipments }),
    },
  ),
);
