/**
 * Document locker — RC, driving licence, insurance, permit, PUC.
 *
 * Documents stay ON DEVICE (the uri points at local storage); only a driver
 * action should ever upload them anywhere, because these are exactly the
 * papers used for identity theft. Server sync, when added, should be
 * explicit and encrypted. Expiry status is derived, never stored.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DocumentKind, DriverDocument } from '../types';

export type ExpiryStatus = 'missing' | 'valid' | 'expiring' | 'expired' | 'no_expiry';

const EXPIRING_SOON_DAYS = 30;

interface DocumentsState {
  documents: Partial<Record<DocumentKind, DriverDocument>>;
  attachDocument: (doc: DriverDocument) => void;
  setExpiry: (kind: DocumentKind, expiresOn: string | null) => void;
  removeDocument: (kind: DocumentKind) => void;
}

/** Derive the checkpost-readiness of one document. */
export function expiryStatus(doc: DriverDocument | undefined): ExpiryStatus {
  if (!doc) return 'missing';
  if (!doc.expiresOn) return 'no_expiry';
  const expiry = new Date(`${doc.expiresOn}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return 'no_expiry';
  const daysLeft = (expiry.getTime() - Date.now()) / (24 * 3600 * 1000);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRING_SOON_DAYS) return 'expiring';
  return 'valid';
}

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set) => ({
      documents: {},

      attachDocument: (doc) =>
        set((s) => ({ documents: { ...s.documents, [doc.kind]: doc } })),

      setExpiry: (kind, expiresOn) =>
        set((s) => {
          const existing = s.documents[kind];
          if (!existing) return s;
          return { documents: { ...s.documents, [kind]: { ...existing, expiresOn } } };
        }),

      removeDocument: (kind) =>
        set((s) => {
          const next = { ...s.documents };
          delete next[kind];
          return { documents: next };
        }),
    }),
    {
      name: 'trucksetu-documents',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ documents: s.documents }),
    },
  ),
);
