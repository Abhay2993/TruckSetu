/**
 * Fraud detection — three checks over data the platform already collects:
 *
 *  1. GPS spoofing: consecutive telemetry fixes implying an impossible
 *     speed (a truck can't do 400 km/h between pings).
 *  2. Route deviation: a fix further than the tolerance from the assigned
 *     corridor (diversion / device left the truck).
 *  3. Duplicate POD: the same document fingerprint appearing on multiple
 *     shipments (one delivery photo reused to unlock several escrows).
 *     Foundation fingerprints metadata (name + OCR number); production
 *     swaps in a perceptual image hash over the actual bytes.
 *
 * Alerts land in db.fraudAlerts, which the ops console watches.
 */

import { db, newId, persist } from './db';
import { EscrowShipment, TelemetryPoint } from './types';

const MAX_PLAUSIBLE_SPEED_KMH = 140;
const ROUTE_TOLERANCE_KM = 30;

/** NH-48 corridor (kept in sync with the app's ROUTE_WAYPOINTS). */
const CORRIDOR: { latitude: number; longitude: number }[] = [
  { latitude: 28.6139, longitude: 77.209 },
  { latitude: 28.4595, longitude: 77.0266 },
  { latitude: 28.2181, longitude: 76.8465 },
  { latitude: 27.9924, longitude: 76.6066 },
  { latitude: 27.8886, longitude: 76.2814 },
  { latitude: 27.7025, longitude: 76.1993 },
  { latitude: 27.4924, longitude: 76.1305 },
  { latitude: 27.1767, longitude: 75.9982 },
  { latitude: 26.9124, longitude: 75.7873 },
];

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function addAlert(kind: 'gps_spoof' | 'duplicate_pod' | 'route_deviation', detail: string, userId: string | null, shipmentId: string | null): void {
  db.fraudAlerts.unshift({ id: newId('fa'), kind, userId, shipmentId, detail, at: Date.now() });
  if (db.fraudAlerts.length > 200) db.fraudAlerts.length = 200;
  persist();
  console.warn(`[fraud] ${kind}: ${detail}`);
}

/** Check a telemetry batch for impossible jumps and corridor deviation. */
export function checkTelemetryBatch(points: TelemetryPoint[], userId: string): void {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const hours = (curr.timestamp - prev.timestamp) / 3600000;
    if (hours <= 0) continue;
    const impliedKmh = haversineKm(prev, curr) / hours;
    if (impliedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
      addAlert(
        'gps_spoof',
        `Implied ${Math.round(impliedKmh)} km/h between fixes — possible GPS spoofing`,
        userId,
        null,
      );
      break; // one alert per batch is enough signal
    }
  }

  const last = points[points.length - 1];
  if (last) {
    const minDistance = Math.min(...CORRIDOR.map((w) => haversineKm(last, w)));
    if (minDistance > ROUTE_TOLERANCE_KM) {
      addAlert(
        'route_deviation',
        `Last fix ${Math.round(minDistance)} km off the assigned corridor`,
        userId,
        null,
      );
    }
  }
}

/** Fingerprint a POD and flag reuse across shipments. */
export function checkPodDuplicate(shipment: EscrowShipment): void {
  const pod = shipment.pod;
  if (!pod) return;
  const fingerprint = `${pod.fileName}|${pod.ocrConsignmentNo ?? ''}`;
  const clash = db.shipments.find(
    (s) =>
      s.id !== shipment.id &&
      s.pod &&
      `${s.pod.fileName}|${s.pod.ocrConsignmentNo ?? ''}` === fingerprint,
  );
  if (clash) {
    addAlert(
      'duplicate_pod',
      `POD "${pod.fileName}" also used on shipment ${clash.id}`,
      shipment.driverId ?? null,
      shipment.id,
    );
  }
}
