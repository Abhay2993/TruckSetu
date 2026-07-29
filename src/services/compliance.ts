/**
 * Demo-mode compliance derivation.
 *
 * Server mode checks VAHAN/SARATHI; offline we derive the same report shape
 * from the expiry dates in the document locker, applying the identical
 * blocking rule (see server/src/integrations.ts) so the bid gate behaves
 * the same either way. Documents with no expiry recorded are treated as
 * unknown, not as failures — punishing a driver for a blank field would be
 * both wrong and infuriating.
 */

import type { ComplianceItem, DocumentKind, DriverDocument, VehicleCompliance } from '../types';

const EXPIRING_SOON_DAYS = 30;

/** Statutory documents that make a truck illegal to run when lapsed. */
const BLOCKING: ComplianceItem['kind'][] = ['fitness', 'insurance', 'puc', 'licence'];

const DOC_MAP: { docKind: DocumentKind; kind: ComplianceItem['kind']; label: string }[] = [
  { docKind: 'rc', kind: 'registration', label: 'Registration (RC)' },
  { docKind: 'insurance', kind: 'insurance', label: 'Insurance' },
  { docKind: 'puc', kind: 'puc', label: 'PUC certificate' },
  { docKind: 'permit', kind: 'permit', label: 'Permit' },
  { docKind: 'dl', kind: 'licence', label: 'Driving licence' },
];

function itemFor(kind: ComplianceItem['kind'], label: string, validUpto: string): ComplianceItem {
  const expiry = new Date(`${validUpto}T23:59:59`).getTime();
  const daysLeft = Math.floor((expiry - Date.now()) / (24 * 3600 * 1000));
  return {
    kind,
    label,
    validUpto,
    daysLeft,
    status: daysLeft < 0 ? 'expired' : daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'valid',
  };
}

export function deriveCompliance(
  vehicleNumber: string,
  documents: Partial<Record<DocumentKind, DriverDocument>>,
): VehicleCompliance {
  const items: ComplianceItem[] = [];
  for (const { docKind, kind, label } of DOC_MAP) {
    const doc = documents[docKind];
    if (!doc?.expiresOn) continue; // no expiry recorded — unknown, not failed
    items.push(itemFor(kind, label, doc.expiresOn));
  }

  const expired = items.filter((i) => i.status === 'expired');
  const blocking = expired.filter((i) => BLOCKING.includes(i.kind));
  return {
    vehicleNumber,
    canBid: blocking.length === 0,
    blockingReasons: blocking.map(
      (i) => `${i.label} expired ${Math.abs(i.daysLeft)} day(s) ago`,
    ),
    expiringCount: items.filter((i) => i.status === 'expiring').length,
    items,
    checkedAt: Date.now(),
  };
}
