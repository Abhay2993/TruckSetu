/**
 * JSON-file persistence.
 *
 * Deliberately not a database: zero native dependencies means this deploys
 * anywhere Node runs (Railway/Render/Fly free tiers included) with no
 * provisioning step. The write path is a debounced atomic rename, which is
 * safe for a single-instance foundation server. When load outgrows a single
 * file, this module is the only thing that changes — swap it for
 * Postgres/Prisma and keep every route as-is.
 */

import fs from 'fs';
import path from 'path';
import { DbShape } from './types';

const DATA_FILE = process.env.DATA_FILE ?? path.join(__dirname, '..', 'data.json');
const SAVE_DEBOUNCE_MS = 250;
/** Hard ceiling on how long a mutation may sit unwritten under sustained load. */
const MAX_SAVE_DELAY_MS = 2000;

function seed(): DbShape {
  const now = Date.now();
  return {
    users: [],
    loads: [
      {
        id: 'load-1',
        origin: 'Delhi',
        destination: 'Jaipur',
        material: 'Cement bags',
        weightTonnes: 18,
        priceInr: 42000,
        advancePercent: 70,
        status: 'open',
        consignmentNo: 'LR-48213',
        bids: [
          { id: 'bid-1', driverName: 'Gurpreet Singh', truckNumber: 'PB 10 AB 4321', amountInr: 41000, rating: 4.7, kycVerified: true, placedAt: now - 45 * 60 * 1000 },
          { id: 'bid-2', driverName: 'Ramesh Yadav', truckNumber: 'RJ 14 CD 8890', amountInr: 43500, rating: 4.2, kycVerified: false, placedAt: now - 30 * 60 * 1000 },
        ],
        postedAt: now - 90 * 60 * 1000,
      },
      {
        id: 'load-2',
        origin: 'Mumbai',
        destination: 'Ahmedabad',
        material: 'FMCG cartons',
        weightTonnes: 9,
        priceInr: 31000,
        advancePercent: 60,
        status: 'open',
        bids: [
          { id: 'bid-3', driverName: 'Suresh Patil', truckNumber: 'MH 04 EF 2210', amountInr: 30500, rating: 4.5, kycVerified: true, placedAt: now - 20 * 60 * 1000 },
        ],
        postedAt: now - 30 * 60 * 1000,
      },
      // Backhaul seeds: loads out of Jaipur so a Delhi→Jaipur driver finds a
      // paying trip home (the return-load finder feature).
      {
        id: 'load-3',
        origin: 'Jaipur',
        destination: 'Delhi',
        material: 'Marble slabs',
        weightTonnes: 16,
        priceInr: 38000,
        advancePercent: 70,
        status: 'open',
        bids: [],
        postedAt: now - 55 * 60 * 1000,
      },
      {
        id: 'load-4',
        origin: 'Jaipur',
        destination: 'Gurugram',
        material: 'Handicraft cartons',
        weightTonnes: 6,
        priceInr: 22000,
        advancePercent: 60,
        status: 'open',
        bids: [],
        postedAt: now - 15 * 60 * 1000,
      },
      // Part-loads sharing one lane — the consolidation feature only has
      // something to pool when the board is dense enough on a single route.
      {
        id: 'load-5',
        origin: 'Pune',
        destination: 'Nashik',
        material: 'Auto components',
        weightTonnes: 6,
        priceInr: 13200,
        advancePercent: 60,
        status: 'open',
        bids: [],
        postedAt: now - 40 * 60 * 1000,
      },
      {
        id: 'load-6',
        origin: 'Pune',
        destination: 'Nashik',
        material: 'Packaged food',
        weightTonnes: 5,
        priceInr: 11000,
        advancePercent: 60,
        status: 'open',
        bids: [],
        postedAt: now - 25 * 60 * 1000,
      },
      {
        id: 'load-7',
        origin: 'Pune',
        destination: 'Nashik',
        material: 'Textile bales',
        weightTonnes: 4,
        priceInr: 8800,
        advancePercent: 60,
        status: 'open',
        bids: [],
        postedAt: now - 10 * 60 * 1000,
      },
    ],
    shipments: [
      {
        id: 'shp-0',
        loadId: 'load-x0',
        origin: 'Delhi',
        destination: 'Jaipur',
        driverName: 'Ramesh Yadav',
        truckNumber: 'RJ 14 CD 8890',
        totalAmountInr: 40000,
        advancePercent: 70,
        stage: 'BALANCE_RELEASED',
        pod: { uri: '', kind: 'document', fileName: 'pod-shp-0.pdf', uploadedAt: now - 5 * 24 * 3600 * 1000 },
        events: [
          { stage: 'CREATED', label: 'Load booked — escrow shipment created', at: now - 6 * 24 * 3600 * 1000 },
          { stage: 'ADVANCE_PAID', label: 'Advance paid to fuel card (ref ADV-shp-0-28000)', at: now - 6 * 24 * 3600 * 1000 },
          { stage: 'POD_UPLOADED', label: 'POD uploaded (pod-shp-0.pdf)', at: now - 5 * 24 * 3600 * 1000 },
          { stage: 'BALANCE_RELEASED', label: 'Balance released from escrow (ref BAL-shp-0-12000)', at: now - 5 * 24 * 3600 * 1000 },
        ],
        ratingByDealer: null,
        ratingByDriver: null,
      },
      {
        id: 'shp-1',
        loadId: 'load-0',
        origin: 'Delhi',
        destination: 'Jaipur',
        driverName: 'Gurpreet Singh',
        truckNumber: 'PB 10 AB 4321',
        totalAmountInr: 42000,
        advancePercent: 70,
        stage: 'CREATED',
        pod: null,
        events: [{ stage: 'CREATED', label: 'Load booked — escrow shipment created', at: now - 20 * 60 * 1000 }],
      },
    ],
    fastag: {},
    telemetry: { totalPoints: 0, lastSyncAt: null, lastPoint: null },
    sosAlerts: [],
    messages: [],
    notifications: [],
    disputes: [],
    whatsappOutbox: [],
    fraudAlerts: [],
    driving: {},
    credit: {},
    fuelCards: {},
    emis: [],
    advances: [],
    vehicleLoans: [],
    policies: [],
    bureauQueries: [],
    returnGuarantees: [],
    savings: {},
    rewards: {},
    legalCases: [],
    breakdowns: [],
  };
}

function load(): DbShape {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw) as DbShape;
    // Migrate data files written before newer collections existed.
    data.sosAlerts = data.sosAlerts ?? [];
    data.messages = data.messages ?? [];
    data.notifications = data.notifications ?? [];
    data.disputes = data.disputes ?? [];
    data.whatsappOutbox = data.whatsappOutbox ?? [];
    data.fraudAlerts = data.fraudAlerts ?? [];
    data.driving = data.driving ?? {};
    data.credit = data.credit ?? {};
    data.fuelCards = data.fuelCards ?? {};
    data.emis = data.emis ?? [];
    data.advances = data.advances ?? [];
    data.vehicleLoans = data.vehicleLoans ?? [];
    data.policies = data.policies ?? [];
    data.bureauQueries = data.bureauQueries ?? [];
    data.returnGuarantees = data.returnGuarantees ?? [];
    data.savings = data.savings ?? {};
    data.rewards = data.rewards ?? {};
    data.legalCases = data.legalCases ?? [];
    data.breakdowns = data.breakdowns ?? [];
    return data;
  } catch {
    // Missing or corrupted file → start from seed. Corruption is not
    // silently overwritten until the first write actually happens.
    return seed();
  }
}

export const db: DbShape = load();

let saveTimer: NodeJS.Timeout | null = null;
/** When the oldest un-written mutation happened; null when clean. */
let dirtySince: number | null = null;

/** Atomic write: temp file + rename, so a crash never leaves a partial file. */
export function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirtySince === null) return;
  dirtySince = null;
  const tmp = `${DATA_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    console.error('[db] persist failed', error);
  }
}

/**
 * Debounced atomic write — call after every mutation.
 *
 * The debounce coalesces bursts, but it is capped by MAX_SAVE_DELAY_MS:
 * without that ceiling a steady stream of writes keeps resetting the timer
 * and the file never lands. Pending work is also flushed on shutdown, so a
 * SIGTERM (deploys, container stops) does not drop the last mutations.
 */
export function persist(): void {
  const now = Date.now();
  if (dirtySince === null) dirtySince = now;
  if (now - dirtySince >= MAX_SAVE_DELAY_MS) {
    flush();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    flush();
    process.exit(0);
  });
}
process.on('exit', flush);

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
