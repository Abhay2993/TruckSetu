/**
 * Marketplace mechanics — the network-effects layer.
 *
 * Everything here gets BETTER as the platform gets busier, which is what
 * makes it defensible: a rival can copy the screens in a week, but not the
 * liquidity that makes the numbers work.
 *
 *  • Assured return load — a guarantee, not a listing. TruckSetu pays a
 *    standby fee if no backhaul materialises, so it can only be offered on
 *    lanes with enough depth to make the expected payout affordable.
 *  • Lane density + dynamic incentives — surplus/deficit per lane priced
 *    into a bonus, so the market self-balances instead of stranding trucks.
 *  • Trip chaining — a round trip booked as one contract beats three spot
 *    bookings, and only a platform seeing all three legs can assemble it.
 *  • Part-load consolidation — pooling small consignments needs volume on
 *    the same lane on the same day; thin marketplaces simply cannot.
 *  • Lane rate index — published openly. Whoever sets the benchmark that
 *    the industry quotes owns the conversation.
 */

import { db, newId, persist } from './db';
import { Load, ReturnGuarantee } from './types';

// ---------------------------------------------------------------------------
// Tunables. One block, so commercial policy is a single diff.
// ---------------------------------------------------------------------------

export const MARKET = {
  /** Hours after delivery within which a return load must be confirmed. */
  GUARANTEE_WINDOW_HOURS: 12,
  /** Paid to the driver if the window lapses without a booked backhaul. */
  STANDBY_FEE_INR: 3500,
  /** A lane needs at least this many open loads to be guaranteed. */
  GUARANTEE_MIN_OPEN_LOADS: 2,
  /** Bonus ceiling for repositioning into a deficit lane. */
  MAX_INCENTIVE_INR: 4000,
  /** Discount a shipper gets for booking a chained round trip. */
  CHAIN_DISCOUNT_RATE: 0.08,
  /** Extra the driver keeps on a chain (no empty legs between stops). */
  CHAIN_DRIVER_UPLIFT_RATE: 0.05,
  /** A load at or below this weight is a part-load candidate. */
  LTL_MAX_TONNES: 8,
  /** Usable capacity of a standard truck for pooling. */
  TRUCK_CAPACITY_TONNES: 21,
  /** Saving passed to each shipper when their part-loads share a truck. */
  LTL_SAVING_RATE: 0.18,
} as const;

const DAY_MS = 24 * 3600 * 1000;

function laneKey(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

// ---------------------------------------------------------------------------
// Lane density + dynamic incentives
// ---------------------------------------------------------------------------

export interface LaneDensity {
  lane: string;
  origin: string;
  destination: string;
  /** Open loads waiting for a truck. */
  demand: number;
  /** Trucks heading here (in-transit shipments terminating at the origin). */
  supply: number;
  /** demand - supply: positive = loads with no truck, negative = idle trucks. */
  gap: number;
  status: 'deficit' | 'balanced' | 'surplus';
  /** Bonus TruckSetu pays a driver to serve this lane, ₹0 when balanced. */
  incentiveInr: number;
}

/**
 * Supply proxy: a truck currently delivering INTO a city becomes available
 * supply for lanes leaving that city. That is exactly the backhaul problem,
 * measured.
 */
export function laneDensities(): LaneDensity[] {
  const open = db.loads.filter((l) => l.status === 'open');
  const inTransit = db.shipments.filter(
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
    // Linear in the shortfall, capped: enough to move a truck, never enough
    // to make repositioning more profitable than carrying freight.
    entry.incentiveInr =
      entry.gap > 0 ? Math.min(MARKET.MAX_INCENTIVE_INR, entry.gap * 1200) : 0;
  }

  return [...lanes.values()].sort((a, b) => b.gap - a.gap);
}

/** The bonus attached to a specific load, if its lane is short of trucks. */
export function incentiveForLoad(load: Load): number {
  if (load.status !== 'open') return 0;
  const lane = laneDensities().find((l) => l.lane === laneKey(load.origin, load.destination));
  return lane?.incentiveInr ?? 0;
}

// ---------------------------------------------------------------------------
// Assured return load
// ---------------------------------------------------------------------------

export interface GuaranteeOffer {
  city: string;
  available: boolean;
  openLoads: number;
  windowHours: number;
  standbyFeeInr: number;
  reason: string;
}

/**
 * Only offered where the platform can actually honour it. Density is the
 * gate, which is precisely why a thin competitor cannot copy the promise.
 */
export function guaranteeOffer(city: string): GuaranteeOffer {
  const openLoads = db.loads.filter((l) => l.status === 'open' && l.origin === city).length;
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

/**
 * Settle a guarantee: fulfilled when the driver booked any load out of the
 * city inside the window, otherwise the standby fee becomes payable. Called
 * lazily on read and by the driver's own "claim" action, so no cron is
 * required for the foundation.
 */
export function settleGuarantee(g: ReturnGuarantee): ReturnGuarantee {
  if (g.status !== 'active') return g;

  const bookedOut = db.shipments.find(
    (s) =>
      s.driverId === g.driverId &&
      s.origin === g.city &&
      (s.events[0]?.at ?? 0) >= g.startedAt &&
      (s.events[0]?.at ?? 0) <= g.expiresAt,
  );
  if (bookedOut) {
    g.status = 'fulfilled';
    g.resolvedAt = Date.now();
    g.fulfilledByShipmentId = bookedOut.id;
    return g;
  }
  if (Date.now() > g.expiresAt) {
    g.status = 'standby_due';
    g.resolvedAt = Date.now();
  }
  return g;
}

export function activeGuaranteeFor(driverId: string): ReturnGuarantee | null {
  const g = db.returnGuarantees.find(
    (x) => x.driverId === driverId && (x.status === 'active' || x.status === 'standby_due'),
  );
  if (!g) return null;
  const settled = settleGuarantee(g);
  persist();
  return settled;
}

// ---------------------------------------------------------------------------
// Multi-leg trip chaining
// ---------------------------------------------------------------------------

export interface ChainLeg {
  loadId: string;
  origin: string;
  destination: string;
  material: string;
  priceInr: number;
}

export interface TripChainQuote {
  legs: ChainLeg[];
  /** What the same legs cost booked separately. */
  separateTotalInr: number;
  /** What the shipper pays for the chain. */
  chainedTotalInr: number;
  shipperSavesInr: number;
  /** What the driver receives — more than the spot sum, because no dead legs. */
  driverPayoutInr: number;
  driverGainsInr: number;
  returnsToStart: boolean;
}

/**
 * Greedy chain from a starting city: take the best-paying open load out of
 * the current city, hop to its destination, repeat. Preferring a final leg
 * that returns to the origin is what turns three one-way trips into a round
 * trip with no empty running.
 */
export function buildChain(startCity: string, maxLegs = 3): TripChainQuote | null {
  const used = new Set<string>();
  const legs: ChainLeg[] = [];
  let city = startCity;

  for (let i = 0; i < maxLegs; i++) {
    const candidates = db.loads.filter(
      (l) => l.status === 'open' && l.origin === city && !used.has(l.id),
    );
    if (candidates.length === 0) break;
    // On the last leg, prefer getting home; otherwise take the best payer.
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
    if (city === startCity && legs.length >= 2) break; // closed the loop
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

// ---------------------------------------------------------------------------
// Part-load (LTL) consolidation
// ---------------------------------------------------------------------------

export interface ConsolidationGroup {
  lane: string;
  origin: string;
  destination: string;
  loadIds: string[];
  totalTonnes: number;
  fillPercent: number;
  /** Sum of what the shippers pay today, as separate part-loads. */
  separateTotalInr: number;
  /** One truck, one price — cheaper for every shipper in the pool. */
  pooledTotalInr: number;
  savingPerShipperInr: number;
}

/**
 * Group open part-loads by lane and pool them into truckloads. The economics
 * only work above a certain density of small consignments on one lane, which
 * is the moat: a thin board never has two shippers on the same lane.
 */
export function consolidationGroups(): ConsolidationGroup[] {
  const parts = db.loads.filter(
    (l) => l.status === 'open' && l.weightTonnes <= MARKET.LTL_MAX_TONNES,
  );
  const byLane = new Map<string, Load[]>();
  for (const load of parts) {
    const key = laneKey(load.origin, load.destination);
    byLane.set(key, [...(byLane.get(key) ?? []), load]);
  }

  const groups: ConsolidationGroup[] = [];
  for (const [lane, loads] of byLane) {
    if (loads.length < 2) continue;
    // Fill one truck at a time, heaviest first, so pools stay realistic.
    const queue = [...loads].sort((a, b) => b.weightTonnes - a.weightTonnes);
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

// ---------------------------------------------------------------------------
// Live lane rate index (published openly)
// ---------------------------------------------------------------------------

export interface LaneIndexRow {
  lane: string;
  origin: string;
  destination: string;
  /** Average agreed rate over the last 7 days. */
  avg7dInr: number | null;
  /** Average over 30 days — the baseline the 7-day rate is compared to. */
  avg30dInr: number | null;
  trendPercent: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
  tripCount: number;
  /** Current asking price on open loads for the same lane. */
  openAskInr: number | null;
  perTonneInr: number | null;
}

export interface LaneIndex {
  /** Index level: 100 = the 30-day national average. */
  indexLevel: number;
  laneCount: number;
  tripCount: number;
  generatedAt: number;
  lanes: LaneIndexRow[];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Built from agreed shipment prices — actual transactions, not asks, which
 * is what makes it a credible benchmark. Public on purpose.
 */
export function laneIndex(): LaneIndex {
  const now = Date.now();
  const byLane = new Map<string, { d7: number[]; d30: number[]; tonnes: number[] }>();

  for (const s of db.shipments) {
    const at = s.events[0]?.at ?? 0;
    const age = now - at;
    if (age > 30 * DAY_MS) continue;
    const key = laneKey(s.origin, s.destination);
    const entry = byLane.get(key) ?? { d7: [], d30: [], tonnes: [] };
    entry.d30.push(s.totalAmountInr);
    if (age <= 7 * DAY_MS) entry.d7.push(s.totalAmountInr);
    const load = db.loads.find((l) => l.id === s.loadId);
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
    const openAsks = db.loads
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
          ? 'new'
          : trendPercent > 1.5
            ? 'up'
            : trendPercent < -1.5
              ? 'down'
              : 'flat',
      tripCount: v.d30.length,
      openAskInr: mean(openAsks),
      perTonneInr: mean(v.tonnes),
    };
  });

  // Index level: 7-day national average against the 30-day baseline.
  const all7 = lanes.flatMap((l) => (l.avg7dInr !== null ? [l.avg7dInr] : []));
  const all30 = lanes.flatMap((l) => (l.avg30dInr !== null ? [l.avg30dInr] : []));
  const m7 = mean(all7);
  const m30 = mean(all30);
  const indexLevel = m7 !== null && m30 !== null && m30 > 0 ? Math.round((m7 / m30) * 1000) / 10 : 100;

  return {
    indexLevel,
    laneCount: lanes.length,
    tripCount: lanes.reduce((sum, l) => sum + l.tripCount, 0),
    generatedAt: now,
    lanes: lanes.sort((a, b) => b.tripCount - a.tripCount),
  };
}

/** Create a guarantee record for a driver arriving into a city. */
export function openGuarantee(driverId: string, city: string, shipmentId: string): ReturnGuarantee {
  const g: ReturnGuarantee = {
    id: newId('grt'),
    driverId,
    city,
    shipmentId,
    windowHours: MARKET.GUARANTEE_WINDOW_HOURS,
    standbyFeeInr: MARKET.STANDBY_FEE_INR,
    status: 'active',
    startedAt: Date.now(),
    expiresAt: Date.now() + MARKET.GUARANTEE_WINDOW_HOURS * 3600 * 1000,
    resolvedAt: null,
    fulfilledByShipmentId: null,
    paidAt: null,
  };
  db.returnGuarantees.unshift(g);
  persist();
  return g;
}
