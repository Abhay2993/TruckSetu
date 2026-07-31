/**
 * Trip P&L calculator — the real math behind a bid.
 *
 * profit = freight − diesel − tolls − bhatta (food/stay)
 *
 * Diesel uses the cheapest price on the corridor (the fuel card decides
 * where to fill anyway) and a loaded-truck mileage of ~4 km/L; tolls use the
 * NH per-km average for multi-axle trucks; bhatta is per driving day at
 * ~400 km/day. Distances come from a known-lane table with a conservative
 * fallback — production swaps this for a routing API distance.
 */

import { FUEL_PRICES } from '../data/mock';
import type { FuelPrice } from '../types';

const KM_PER_LITRE = 4;
const TOLL_INR_PER_KM = 2.2; // multi-axle NH average
const BHATTA_INR_PER_DAY = 500;
const KM_PER_DAY = 400;
const FALLBACK_DISTANCE_KM = 500;

/** Known lane distances (km). Keyed as "Origin|Destination", symmetric. */
const LANE_KM: Record<string, number> = {
  'Delhi|Jaipur': 280,
  'Delhi|Gurugram': 35,
  'Jaipur|Gurugram': 250,
  'Mumbai|Ahmedabad': 530,
  'Delhi|Kanpur': 480,
  'Ludhiana|Kanpur': 850,
  'Delhi|Ludhiana': 310,
};

export function laneDistanceKm(origin: string, destination: string): number {
  return (
    LANE_KM[`${origin}|${destination}`] ??
    LANE_KM[`${destination}|${origin}`] ??
    FALLBACK_DISTANCE_KM
  );
}

export interface TripPnl {
  distanceKm: number;
  dieselInr: number;
  dieselLitres: number;
  tollsInr: number;
  bhattaInr: number;
  totalCostInr: number;
  profitInr: number;
}

export function estimateTripPnl(
  origin: string,
  destination: string,
  freightInr: number,
  fuelPrices: FuelPrice[] = FUEL_PRICES,
): TripPnl {
  const distanceKm = laneDistanceKm(origin, destination);
  const cheapestDiesel = fuelPrices.reduce(
    (min, p) => Math.min(min, p.dieselInrPerLitre),
    Number.POSITIVE_INFINITY,
  );
  const dieselLitres = Math.ceil(distanceKm / KM_PER_LITRE);
  const dieselInr = Math.round(dieselLitres * (Number.isFinite(cheapestDiesel) ? cheapestDiesel : 90));
  const tollsInr = Math.round(distanceKm * TOLL_INR_PER_KM);
  const days = Math.max(1, Math.ceil(distanceKm / KM_PER_DAY));
  const bhattaInr = days * BHATTA_INR_PER_DAY;
  const totalCostInr = dieselInr + tollsInr + bhattaInr;
  return {
    distanceKm,
    dieselInr,
    dieselLitres,
    tollsInr,
    bhattaInr,
    totalCostInr,
    profitInr: Math.round(freightInr) - totalCostInr,
  };
}
