/**
 * Dispute resolution (Feature 13).
 *
 * Raising a dispute freezes the shipment's escrow (sets shipment.disputeId);
 * the escrow store's releaseBalance refuses while it's set, mirroring the
 * server guarantee. Resolving clears it with an outcome. Server mode returns
 * the authoritative shipment; demo mode applies the same transition locally.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../services/api';
import type { Dispute, DisputeReason, DisputeResolution } from '../types';
import { useEscrowStore } from './useEscrowStore';
import { useNotificationsStore } from './useNotificationsStore';

interface DisputeState {
  disputes: Dispute[];
  raise: (shipmentId: string, reason: DisputeReason, detail: string) => Promise<void>;
  resolve: (disputeId: string, resolution: DisputeResolution) => Promise<void>;
  openForShipment: (shipmentId: string) => Dispute | undefined;
}

export const useDisputeStore = create<DisputeState>()(
  persist(
    (set, get) => ({
      disputes: [],

      raise: async (shipmentId, reason, detail) => {
        const remote = await api.raiseDispute(shipmentId, reason, detail);
        const dispute: Dispute =
          remote?.dispute ?? {
            id: `dsp-${Date.now()}`,
            shipmentId,
            raisedByRole: 'dealer',
            reason,
            detail,
            status: 'open',
            resolution: null,
            at: Date.now(),
            resolvedAt: null,
          };
        set((s) => ({ disputes: [dispute, ...s.disputes] }));
        // Freeze the escrow locally too (server already did in server mode).
        useEscrowStore.setState((s) => ({
          shipments: s.shipments.map((sh) =>
            sh.id === shipmentId ? (remote?.shipment ?? { ...sh, disputeId: dispute.id }) : sh,
          ),
        }));
        useNotificationsStore
          .getState()
          .add('dispute_raised', 'Dispute raised', `${reason.replace('_', ' ')} — escrow on hold`, shipmentId);
      },

      resolve: async (disputeId, resolution) => {
        const remote = await api.resolveDispute(disputeId, resolution);
        set((s) => ({
          disputes: s.disputes.map((d) =>
            d.id === disputeId
              ? { ...d, status: 'resolved', resolution, resolvedAt: Date.now() }
              : d,
          ),
        }));
        const dispute = get().disputes.find((d) => d.id === disputeId);
        const shipmentId = remote?.dispute.shipmentId ?? dispute?.shipmentId;
        if (shipmentId) {
          useEscrowStore.setState((s) => ({
            shipments: s.shipments.map((sh) =>
              sh.id === shipmentId
                ? (remote?.shipment ?? { ...sh, disputeId: null })
                : sh,
            ),
          }));
          useNotificationsStore
            .getState()
            .add('dispute_resolved', 'Dispute resolved', `${resolution} — escrow unfrozen`, shipmentId);
        }
      },

      openForShipment: (shipmentId) =>
        get().disputes.find((d) => d.shipmentId === shipmentId && d.status !== 'resolved'),
    }),
    {
      name: 'trucksetu-disputes',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ disputes: s.disputes }),
    },
  ),
);
