/**
 * Detention & demurrage — automated, from data both parties already trust.
 *
 * Trucks routinely wait 6–20 hours at loading and unloading points and
 * almost nobody pays for it, because nobody can prove it. TruckSetu can:
 * geofenced telemetry produces arrival/departure timestamps, the eSigned
 * digital LR fixes the free-time terms in advance, and the escrow settles
 * the resulting charge. That combination makes the platform the neutral
 * arbiter of trip truth — and once detention disputes are settled by these
 * records, leaving the platform means losing the evidence.
 *
 * The geofence is deliberately generous (5 km) because consumer GPS in a
 * loaded yard is noisy; free time and rates follow common Indian contract
 * practice and are per-shipment terms, not hard-coded policy.
 */

import { db, persist } from './db';
import { haversineKm } from './fraud';
import { DetentionRecord, EscrowShipment, TelemetryPoint } from './types';

export const DETENTION = {
  /** Radius that counts as "at the facility". */
  GEOFENCE_KM: 5,
  /** Hours of loading/unloading included in the freight. */
  FREE_HOURS: 6,
  /** Charged per hour beyond free time. */
  RATE_INR_PER_HOUR: 250,
  /** Cap per stop, so a stranded truck cannot bankrupt a shipper. */
  MAX_INR_PER_STOP: 6000,
} as const;

/** Approximate coordinates for the corridor cities the demo uses. */
const CITY_COORDS: Record<string, { latitude: number; longitude: number }> = {
  Delhi: { latitude: 28.6139, longitude: 77.209 },
  Gurugram: { latitude: 28.4595, longitude: 77.0266 },
  Jaipur: { latitude: 26.9124, longitude: 75.7873 },
  Ajmer: { latitude: 26.4499, longitude: 74.6399 },
  Kanpur: { latitude: 26.4499, longitude: 80.3319 },
  Lucknow: { latitude: 26.8467, longitude: 80.9462 },
  Agra: { latitude: 27.1767, longitude: 78.0081 },
  Mumbai: { latitude: 19.076, longitude: 72.8777 },
  Ahmedabad: { latitude: 23.0225, longitude: 72.5714 },
  Pune: { latitude: 18.5204, longitude: 73.8567 },
  Nashik: { latitude: 19.9975, longitude: 73.7898 },
};

export function cityCoords(city: string): { latitude: number; longitude: number } | null {
  return CITY_COORDS[city] ?? null;
}

/** True when a fix is inside the facility geofence for a city. */
export function atCity(point: TelemetryPoint, city: string): boolean {
  const coords = CITY_COORDS[city];
  if (!coords) return false;
  return haversineKm(point, coords) <= DETENTION.GEOFENCE_KM;
}

export function billableHours(waitedHours: number): number {
  return Math.max(0, waitedHours - DETENTION.FREE_HOURS);
}

export function detentionCharge(waitedHours: number): number {
  const billable = billableHours(waitedHours);
  return Math.min(
    DETENTION.MAX_INR_PER_STOP,
    Math.round(billable * DETENTION.RATE_INR_PER_HOUR),
  );
}

/**
 * Fold a telemetry batch into arrival/departure timestamps for a shipment's
 * origin and destination. Called on every batch, so the record builds up as
 * the trip runs rather than being reconstructed afterwards.
 */
export function recordGeofenceEvents(
  shipment: EscrowShipment,
  points: TelemetryPoint[],
): DetentionRecord {
  const record: DetentionRecord = shipment.detention ?? {
    originArrivedAt: null,
    originDepartedAt: null,
    destinationArrivedAt: null,
    destinationDepartedAt: null,
    loadingHours: null,
    unloadingHours: null,
    chargeInr: 0,
    settled: false,
  };

  for (const point of points) {
    if (atCity(point, shipment.origin)) {
      record.originArrivedAt = record.originArrivedAt ?? point.timestamp;
    } else if (record.originArrivedAt !== null && record.originDepartedAt === null) {
      // First fix outside the origin geofence closes the loading window.
      record.originDepartedAt = point.timestamp;
    }

    if (atCity(point, shipment.destination)) {
      record.destinationArrivedAt = record.destinationArrivedAt ?? point.timestamp;
    } else if (record.destinationArrivedAt !== null && record.destinationDepartedAt === null) {
      record.destinationDepartedAt = point.timestamp;
    }
  }

  return recomputeDetention(record);
}

/** Recompute durations and the charge from whatever timestamps exist. */
export function recomputeDetention(record: DetentionRecord): DetentionRecord {
  const hours = (from: number | null, to: number | null): number | null =>
    from !== null && to !== null && to > from
      ? Math.round(((to - from) / 3600000) * 10) / 10
      : null;

  record.loadingHours = hours(record.originArrivedAt, record.originDepartedAt);
  record.unloadingHours = hours(record.destinationArrivedAt, record.destinationDepartedAt);
  record.chargeInr =
    (record.loadingHours !== null ? detentionCharge(record.loadingHours) : 0) +
    (record.unloadingHours !== null ? detentionCharge(record.unloadingHours) : 0);
  return record;
}

/**
 * Manual stamp for the stops telemetry missed (driver taps "arrived"/"left",
 * or ops corrects a record). Both parties see the same timestamps, which is
 * what makes the resulting charge arguable-with rather than arbitrary.
 */
export function stampDetention(
  shipment: EscrowShipment,
  stop: 'origin' | 'destination',
  event: 'arrived' | 'departed',
  at: number,
): DetentionRecord {
  const record: DetentionRecord = shipment.detention ?? {
    originArrivedAt: null,
    originDepartedAt: null,
    destinationArrivedAt: null,
    destinationDepartedAt: null,
    loadingHours: null,
    unloadingHours: null,
    chargeInr: 0,
    settled: false,
  };
  if (stop === 'origin' && event === 'arrived') record.originArrivedAt = at;
  if (stop === 'origin' && event === 'departed') record.originDepartedAt = at;
  if (stop === 'destination' && event === 'arrived') record.destinationArrivedAt = at;
  if (stop === 'destination' && event === 'departed') record.destinationDepartedAt = at;

  shipment.detention = recomputeDetention(record);
  persist();
  return shipment.detention;
}

/** Every shipment with an unsettled detention charge — the ops/dealer view. */
export function outstandingDetention(): { shipmentId: string; route: string; chargeInr: number }[] {
  return db.shipments
    .filter((s) => (s.detention?.chargeInr ?? 0) > 0 && !s.detention?.settled)
    .map((s) => ({
      shipmentId: s.id,
      route: `${s.origin} → ${s.destination}`,
      chargeInr: s.detention?.chargeInr ?? 0,
    }));
}
