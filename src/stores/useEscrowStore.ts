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
import { SEED_SHIPMENT } from '../data/mock';
import { api } from '../services/api';
import type { EscrowShipment, EscrowStage, ProofOfDelivery } from '../types';

interface EscrowState {
  shipments: EscrowShipment[];
  /** Shipment ids with a payment API call in flight (drives spinners). */
  processingIds: string[];
  addShipment: (shipment: EscrowShipment) => void;
  confirmDispatch: (shipmentId: string) => Promise<void>;
  attachPod: (shipmentId: string, pod: ProofOfDelivery) => void;
  releaseBalance: (shipmentId: string) => Promise<void>;
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
      shipments: [SEED_SHIPMENT],
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
          const { referenceId } = await api.triggerAdvancePayout(shipmentId, advanceInr);
          set((s) => ({
            shipments: transition(
              s.shipments,
              shipmentId,
              'ADVANCE_PAID',
              `Advance paid to fuel card (ref ${referenceId})`,
            ),
          }));
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

      attachPod: (shipmentId, pod) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        if (!shipment || shipment.stage !== 'ADVANCE_PAID') return;
        set((s) => ({
          shipments: transition(
            s.shipments,
            shipmentId,
            'POD_UPLOADED',
            `POD uploaded (${pod.fileName})`,
            { pod },
          ),
        }));
      },

      releaseBalance: async (shipmentId) => {
        const shipment = get().shipments.find((s) => s.id === shipmentId);
        // The guard that makes this "escrow": no POD, no release.
        if (!shipment || shipment.stage !== 'POD_UPLOADED') return;

        set((s) => ({ processingIds: [...s.processingIds, shipmentId] }));
        const { balanceInr } = splitAmounts(shipment);
        try {
          const { referenceId } = await api.releaseEscrowBalance(shipmentId, balanceInr);
          set((s) => ({
            shipments: transition(
              s.shipments,
              shipmentId,
              'BALANCE_RELEASED',
              `Balance released from escrow (ref ${referenceId})`,
            ),
          }));
        } finally {
          set((s) => ({ processingIds: s.processingIds.filter((id) => id !== shipmentId) }));
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
