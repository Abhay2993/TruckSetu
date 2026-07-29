/**
 * Marketplace math, mirrored from server/src/marketplace.ts so demo mode
 * produces the same numbers the server would book. Pure functions over the
 * loads/shipments the stores already hold — change both files together.
 */

import type {
  ChainLeg,
  ConsolidationGroup,
  EscrowShipment,
  GuaranteeOffer,
  LaneDensity,
  LaneIndex,
  LaneIndexRow,
  Load,
  TripChainQuote,
} from '../types';

export const MARKET = {
  GUARANTEE_WINDOW_HOURS: 12,
  STANDBY_FEE_INR: 3500,
  GUARANTEE_MIN_OPEN_LOADS: 2,
  MAX_INCENTIVE_INR: 4000,
  CHAIN_DISCOUNT_RATE: 0.08,
  CHAIN_DRIVER_UPLIFT_RATE: 0.05,
  LTL_MAX_TONNES: 8,
  TRUCK_CAPACITY_TONNES: 21,
  LTL_SAVING_RATE: 0.18,
} as const;

const DAY_MS = 24 * 3600 * 1000;

export function laneKey(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

export function laneDensities(loads: Load[], shipments: EscrowShipment[]): LaneDensity[] {
  const open = loads.filter((l) => l.status === 'open');
  const inTransit = shipments.filter(
    (s) => s.stage === 'DISPATCHED' || s.stage === 'ADVANCE_PAID',
  );

  const lanes = new Map<string, LaneDensity>();
  for (const load of open) {
    const key = laneKey(load.origin, load.destination);
    const entry = lanes.get(key) ?? {
      lane: key,
      origin: load.origin,
      destination: load.destination,
      demand: 0,
      supply: 0,
      gap: 0,
      status: 'balanced' as const,
      incentiveInr: 0,
    };
    entry.demand += 1;
    lanes.set(key, entry);
  }

  for (const entry of lanes.values()) {
    entry.supply = inTransit.filter((s) => s.destination === entry.origin).length;
    entry.gap = entry.demand - entry.supply;
    entry.status = entry.gap > 0 ? 'deficit' : entry.gap < 0 ? 'surplus' : 'balanced';
    entry.incentiveInr = entry.gap > 0 ? Math.min(MARKET.MAX_INCENTIVE_INR, entry.gap * 1200) : 0;
  }
  return [...lanes.values()].sort((a, b) => b.gap - a.gap);
}

export function guaranteeOffer(city: string, loads: Load[]): GuaranteeOffer {
  const openLoads = loads.filter((l) => l.status === 'open' && l.origin === city).length;
  const available = openLoads >= MARKET.GUARANTEE_MIN_OPEN_LOADS;
  return {
    city,
    available,
    openLoads,
    windowHours: MARKET.GUARANTEE_WINDOW_HOURS,
    standbyFeeInr: MARKET.STANDBY_FEE_INR,
    reason: available
      ? `${openLoads} loads currently leaving ${city} — we can commit.`
      : `Only ${openLoads} load(s) leaving ${city} right now — not enough depth to guarantee.`,
  };
}

export function buildChain(startCity: string, loads: Load[], maxLegs = 3): TripChainQuote | null {
  const used = new Set<string>();
  const legs: ChainLeg[] = [];
  let city = startCity;

  for (let i = 0; i < maxLegs; i++) {
    const candidates = loads.filter(
      (l) => l.status === 'open' && l.origin === city && !used.has(l.id),
    );
    if (candidates.length === 0) break;
    const homeward = candidates.filter((l) => l.destination === startCity);
    const pool = i === maxLegs - 1 && homeward.length > 0 ? homeward : candidates;
    const best = [...pool].sort((a, b) => b.priceInr - a.priceInr)[0];
    if (!best) break;
    used.add(best.id);
    legs.push({
      loadId: best.id,
      origin: best.origin,
      destination: best.destination,
      material: best.material,
      priceInr: best.priceInr,
    });
    city = best.destination;
    if (city === startCity && legs.length >= 2) break;
  }

  if (legs.length < 2) return null;

  const separateTotalInr = legs.reduce((sum, l) => sum + l.priceInr, 0);
  const chainedTotalInr = Math.round(separateTotalInr * (1 - MARKET.CHAIN_DISCOUNT_RATE));
  const driverPayoutInr = Math.round(separateTotalInr * (1 + MARKET.CHAIN_DRIVER_UPLIFT_RATE));
  return {
    legs,
    separateTotalInr,
    chainedTotalInr,
    shipperSavesInr: separateTotalInr - chainedTotalInr,
    driverPayoutInr,
    driverGainsInr: driverPayoutInr - separateTotalInr,
    returnsToStart: legs[legs.length - 1]?.destination === startCity,
  };
}

export function consolidationGroups(loads: Load[]): ConsolidationGroup[] {
  const parts = loads.filter(
    (l) => l.status === 'open' && l.weightTonnes <= MARKET.LTL_MAX_TONNES,
  );
  const byLane = new Map<string, Load[]>();
  for (const load of parts) {
    const key = laneKey(load.origin, load.destination);
    byLane.set(key, [...(byLane.get(key) ?? []), load]);
  }

  const groups: ConsolidationGroup[] = [];
  for (const [lane, laneLoads] of byLane) {
    if (laneLoads.length < 2) continue;
    const queue = [...laneLoads].sort((a, b) => b.weightTonnes - a.weightTonnes);
    let bucket: Load[] = [];
    let tonnes = 0;
    const flush = () => {
      if (bucket.length < 2) return;
      const separateTotalInr = bucket.reduce((sum, l) => sum + l.priceInr, 0);
      const pooledTotalInr = Math.round(separateTotalInr * (1 - MARKET.LTL_SAVING_RATE));
      const first = bucket[0];
      if (!first) return;
      groups.push({
        lane,
        origin: first.origin,
        destination: first.destination,
        loadIds: bucket.map((l) => l.id),
        totalTonnes: Math.round(tonnes * 10) / 10,
        fillPercent: Math.min(100, Math.round((tonnes / MARKET.TRUCK_CAPACITY_TONNES) * 100)),
        separateTotalInr,
        pooledTotalInr,
        savingPerShipperInr: Math.round((separateTotalInr - pooledTotalInr) / bucket.length),
      });
    };
    for (const load of queue) {
      if (tonnes + load.weightTonnes > MARKET.TRUCK_CAPACITY_TONNES) {
        flush();
        bucket = [];
        tonnes = 0;
      }
      bucket.push(load);
      tonnes += load.weightTonnes;
    }
    flush();
  }
  return groups.sort((a, b) => b.fillPercent - a.fillPercent);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function laneIndex(shipments: EscrowShipment[], loads: Load[]): LaneIndex {
  const now = Date.now();
  const byLane = new Map<string, { d7: number[]; d30: number[]; tonnes: number[] }>();

  for (const s of shipments) {
    const at = s.events[0]?.at ?? 0;
    const age = now - at;
    if (age > 30 * DAY_MS) continue;
    const key = laneKey(s.origin, s.destination);
    const entry = byLane.get(key) ?? { d7: [], d30: [], tonnes: [] };
    entry.d30.push(s.totalAmountInr);
    if (age <= 7 * DAY_MS) entry.d7.push(s.totalAmountInr);
    const load = loads.find((l) => l.id === s.loadId);
    if (load && load.weightTonnes > 0) {
      entry.tonnes.push(Math.round(s.totalAmountInr / load.weightTonnes));
    }
    byLane.set(key, entry);
  }

  const lanes: LaneIndexRow[] = [...byLane.entries()].map(([lane, v]) => {
    const avg7dInr = mean(v.d7);
    const avg30dInr = mean(v.d30);
    const trendPercent =
      avg7dInr !== null && avg30dInr !== null && avg30dInr > 0
        ? Math.round(((avg7dInr - avg30dInr) / avg30dInr) * 1000) / 10
        : null;
    const [origin = '', destination = ''] = lane.split(' → ');
    const openAsks = loads
      .filter((l) => l.status === 'open' && laneKey(l.origin, l.destination) === lane)
      .map((l) => l.priceInr);
    return {
      lane,
      origin,
      destination,
      avg7dInr,
      avg30dInr,
      trendPercent,
      direction:
        trendPercent === null
          ? ('new' as const)
          : trendPercent > 1.5
            ? ('up' as const)
            : trendPercent < -1.5
              ? ('down' as const)
              : ('flat' as const),
      tripCount: v.d30.length,
      openAskInr: mean(openAsks),
      perTonneInr: mean(v.tonnes),
    };
  });

  const m7 = mean(lanes.flatMap((l) => (l.avg7dInr !== null ? [l.avg7dInr] : [])));
  const m30 = mean(lanes.flatMap((l) => (l.avg30dInr !== null ? [l.avg30dInr] : [])));
  const indexLevel = m7 !== null && m30 !== null && m30 > 0 ? Math.round((m7 / m30) * 1000) / 10 : 100;

  return {
    indexLevel,
    laneCount: lanes.length,
    tripCount: lanes.reduce((sum, l) => sum + l.tripCount, 0),
    generatedAt: now,
    lanes: lanes.sort((a, b) => b.tripCount - a.tripCount),
  };
}
