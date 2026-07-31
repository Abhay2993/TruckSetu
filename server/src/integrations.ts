/**
 * Government and network integrations — VAHAN, SARATHI, NETC, ONDC.
 *
 * The moat here is not the code, it is the onboarding. VAHAN/SARATHI access
 * needs a MoRTH-approved agreement, NETC needs NPCI membership through an
 * acquirer bank, and ONDC needs a signed participant registration on the
 * network registry. Each takes months and paperwork a new entrant cannot
 * shortcut — so the right thing to build now is the exact call shape and
 * the fallback, which is what this module is.
 *
 * Every function follows the house provider-slot pattern: real call when
 * credentials exist, structurally identical simulation otherwise, so no
 * caller ever branches on which mode is live.
 */

import crypto from 'crypto';
import { db, newId, persist } from './db';
import { VehicleCompliance } from './types';

const VAHAN_API_KEY = process.env.VAHAN_API_KEY;
const SARATHI_API_KEY = process.env.SARATHI_API_KEY;
const NETC_MEMBER_ID = process.env.NETC_MEMBER_ID;

export const integrationModes = {
  vahan: VAHAN_API_KEY ? ('live' as const) : ('simulated' as const),
  sarathi: SARATHI_API_KEY ? ('live' as const) : ('simulated' as const),
  netc: NETC_MEMBER_ID ? ('live' as const) : ('simulated' as const),
  ondc: process.env.ONDC_SUBSCRIBER_ID ? ('live' as const) : ('simulated' as const),
};

// ---------------------------------------------------------------------------
// VAHAN — vehicle registration lookup
// ---------------------------------------------------------------------------

export interface VahanRecord {
  registrationNumber: string;
  ownerName: string;
  vehicleClass: string;
  fuelType: string;
  /** ISO dates — the compliance monitor keys off these. */
  registrationValidUpto: string;
  fitnessValidUpto: string;
  insuranceValidUpto: string;
  pucValidUpto: string;
  permitValidUpto: string;
  nationalPermit: boolean;
  blacklisted: boolean;
  mode: 'live' | 'simulated';
}

/** Deterministic date offsets so a given plate always yields the same record. */
function seededDate(seed: number, minDays: number, maxDays: number): string {
  const span = maxDays - minDays;
  const days = minDays + (seed % span);
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function plateSeed(registrationNumber: string): number {
  return [...registrationNumber.toUpperCase().replace(/\s/g, '')].reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  );
}

/**
 * Look up a vehicle. Production calls the VAHAN citizen/API endpoint through
 * the MoRTH-approved channel; the simulation returns the same fields with
 * deterministic validity dates, and deliberately makes some vehicles
 * near-expiry so the compliance monitor has something real to warn about.
 */
export async function vahanLookup(registrationNumber: string): Promise<VahanRecord> {
  if (integrationModes.vahan === 'live') {
    // Production: POST to the VAHAN API with the approved credentials.
    // Response field names map 1:1 onto VahanRecord.
    throw new Error('VAHAN API call not implemented — plug your MoRTH-approved client here.');
  }
  const seed = plateSeed(registrationNumber);
  return {
    registrationNumber: registrationNumber.toUpperCase(),
    ownerName: 'As per RC',
    vehicleClass: 'HGV — Heavy Goods Vehicle',
    fuelType: 'Diesel',
    registrationValidUpto: seededDate(seed, 400, 3000),
    // Fitness and PUC are the ones that actually lapse in the field.
    fitnessValidUpto: seededDate(seed * 3, -30, 400),
    insuranceValidUpto: seededDate(seed * 5, 10, 380),
    pucValidUpto: seededDate(seed * 7, -10, 180),
    permitValidUpto: seededDate(seed * 11, 60, 1800),
    nationalPermit: seed % 3 !== 0,
    blacklisted: false,
    mode: 'simulated',
  };
}

// ---------------------------------------------------------------------------
// SARATHI — driving licence lookup
// ---------------------------------------------------------------------------

export interface SarathiRecord {
  licenceNumber: string;
  holderName: string;
  validUpto: string;
  /** Heavy goods vehicle authorisation — the one that matters here. */
  vehicleClasses: string[];
  hazardousEndorsement: boolean;
  mode: 'live' | 'simulated';
}

export async function sarathiLookup(licenceNumber: string, name: string): Promise<SarathiRecord> {
  if (integrationModes.sarathi === 'live') {
    throw new Error('SARATHI API call not implemented — plug your MoRTH-approved client here.');
  }
  const seed = plateSeed(licenceNumber);
  return {
    licenceNumber: licenceNumber.toUpperCase(),
    holderName: name,
    validUpto: seededDate(seed, -20, 2000),
    vehicleClasses: seed % 4 === 0 ? ['LMV'] : ['LMV', 'HGMV', 'HTV'],
    hazardousEndorsement: seed % 5 === 0,
    mode: 'simulated',
  };
}

// ---------------------------------------------------------------------------
// NETC — FASTag balance and toll transactions via NPCI
// ---------------------------------------------------------------------------

export interface NetcTagStatus {
  tagId: string;
  vehicleNumber: string;
  status: 'active' | 'low_balance' | 'blacklisted' | 'exception';
  balanceInr: number;
  bankIssuer: string;
  mode: 'live' | 'simulated';
}

export async function netcTagStatus(
  vehicleNumber: string,
  balanceInr: number,
): Promise<NetcTagStatus> {
  if (integrationModes.netc === 'live') {
    throw new Error('NETC call not implemented — plug your NPCI acquirer client here.');
  }
  return {
    tagId: `34161FA820328${plateSeed(vehicleNumber) % 1000}`,
    vehicleNumber: vehicleNumber.toUpperCase(),
    // NPCI marks a tag low below ₹150 for most classes; blacklist is a bank action.
    status: balanceInr < 150 ? 'low_balance' : 'active',
    balanceInr,
    bankIssuer: 'Simulated Issuer Bank',
    mode: 'simulated',
  };
}

// ---------------------------------------------------------------------------
// Compliance monitor
// ---------------------------------------------------------------------------

export type ComplianceDocKind =
  | 'registration'
  | 'fitness'
  | 'insurance'
  | 'puc'
  | 'permit'
  | 'licence';

export interface ComplianceItem {
  kind: ComplianceDocKind;
  label: string;
  validUpto: string;
  daysLeft: number;
  status: 'valid' | 'expiring' | 'expired';
}

export interface ComplianceReport {
  vehicleNumber: string;
  checkedAt: number;
  items: ComplianceItem[];
  expiredCount: number;
  expiringCount: number;
  /** The gate: an expired statutory document blocks bidding. */
  canBid: boolean;
  blockingReasons: string[];
}

const EXPIRING_SOON_DAYS = 30;

const DOC_LABEL: Record<ComplianceDocKind, string> = {
  registration: 'Registration (RC)',
  fitness: 'Fitness certificate',
  insurance: 'Insurance',
  puc: 'PUC certificate',
  permit: 'Permit',
  licence: 'Driving licence',
};

/**
 * Documents that make a truck ILLEGAL to run when lapsed. Registration and
 * permit lapses are serious but often mid-renewal with valid paperwork in
 * hand, so they warn rather than block — blocking a driver's income needs
 * to be right, not merely strict.
 */
const BLOCKING: ComplianceDocKind[] = ['fitness', 'insurance', 'puc', 'licence'];

function itemFor(kind: ComplianceDocKind, validUpto: string): ComplianceItem {
  const expiry = new Date(`${validUpto}T23:59:59`).getTime();
  const daysLeft = Math.floor((expiry - Date.now()) / (24 * 3600 * 1000));
  return {
    kind,
    label: DOC_LABEL[kind],
    validUpto,
    daysLeft,
    status: daysLeft < 0 ? 'expired' : daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'valid',
  };
}

/**
 * Build the compliance picture for a truck from the official records. This
 * is what makes TruckSetu the safest choice for an enterprise shipper: the
 * platform can state, per trip, that the vehicle and driver were legal.
 */
export async function checkCompliance(
  vehicleNumber: string,
  licenceNumber: string | null,
  driverName: string,
): Promise<ComplianceReport> {
  const vahan = await vahanLookup(vehicleNumber);
  const items: ComplianceItem[] = [
    itemFor('registration', vahan.registrationValidUpto),
    itemFor('fitness', vahan.fitnessValidUpto),
    itemFor('insurance', vahan.insuranceValidUpto),
    itemFor('puc', vahan.pucValidUpto),
    itemFor('permit', vahan.permitValidUpto),
  ];
  if (licenceNumber) {
    const sarathi = await sarathiLookup(licenceNumber, driverName);
    items.push(itemFor('licence', sarathi.validUpto));
    if (!sarathi.vehicleClasses.some((c) => c === 'HGMV' || c === 'HTV')) {
      items.push({
        kind: 'licence',
        label: 'Licence class (heavy vehicle)',
        validUpto: sarathi.validUpto,
        daysLeft: -1,
        status: 'expired',
      });
    }
  }

  const expired = items.filter((i) => i.status === 'expired');
  const blocking = expired.filter((i) => BLOCKING.includes(i.kind));
  return {
    vehicleNumber: vahan.registrationNumber,
    checkedAt: Date.now(),
    items,
    expiredCount: expired.length,
    expiringCount: items.filter((i) => i.status === 'expiring').length,
    canBid: blocking.length === 0 && !vahan.blacklisted,
    blockingReasons: [
      ...blocking.map((i) => `${i.label} expired ${Math.abs(i.daysLeft)} day(s) ago`),
      ...(vahan.blacklisted ? ['Vehicle is blacklisted on VAHAN'] : []),
    ],
  };
}

/** Cache a report so the bid gate does not re-hit VAHAN on every request. */
export function cacheCompliance(userId: string, report: ComplianceReport): VehicleCompliance {
  const record: VehicleCompliance = {
    userId,
    vehicleNumber: report.vehicleNumber,
    canBid: report.canBid,
    blockingReasons: report.blockingReasons,
    expiringCount: report.expiringCount,
    items: report.items,
    checkedAt: report.checkedAt,
  };
  db.compliance[userId] = record;
  persist();
  return record;
}

/** Reports older than this are treated as stale and re-fetched. */
export const COMPLIANCE_TTL_MS = 24 * 3600 * 1000;

export function cachedCompliance(userId: string): VehicleCompliance | null {
  const record = db.compliance[userId];
  if (!record) return null;
  if (Date.now() - record.checkedAt > COMPLIANCE_TTL_MS) return null;
  return record;
}

// ---------------------------------------------------------------------------
// ONDC — Beckn protocol participation
// ---------------------------------------------------------------------------

const ONDC_SUBSCRIBER_ID = process.env.ONDC_SUBSCRIBER_ID ?? 'trucksetu.example.com';
const ONDC_DOMAIN = 'ONDC:LOG10'; // logistics

/** Beckn context block, identical in shape to what the network expects. */
export function becknContext(action: string, transactionId?: string): Record<string, unknown> {
  return {
    domain: ONDC_DOMAIN,
    country: 'IND',
    city: 'std:080',
    action,
    core_version: '1.2.0',
    bap_id: ONDC_SUBSCRIBER_ID,
    bap_uri: `https://${ONDC_SUBSCRIBER_ID}/ondc`,
    bpp_id: ONDC_SUBSCRIBER_ID,
    bpp_uri: `https://${ONDC_SUBSCRIBER_ID}/ondc`,
    transaction_id: transactionId ?? newId('txn'),
    message_id: newId('msg'),
    timestamp: new Date().toISOString(),
    ttl: 'PT30S',
  };
}

/**
 * Answer an ONDC /search with TruckSetu's catalog of freight capacity.
 *
 * As a BPP (seller-side participant) the platform publishes what it can
 * carry; buyer apps across the network can then book it. Being early on the
 * network is the structural advantage — the registry entry and the
 * agreements are the barrier, not this handler.
 */
export function ondcCatalog(
  origin: string | null,
  destination: string | null,
): Record<string, unknown> {
  const lanes = db.loads.filter(
    (l) =>
      l.status === 'open' &&
      (!origin || l.origin.toLowerCase() === origin.toLowerCase()) &&
      (!destination || l.destination.toLowerCase() === destination.toLowerCase()),
  );
  return {
    'bpp/descriptor': { name: 'TruckSetu', short_desc: 'Verified truck capacity, escrowed freight' },
    'bpp/providers': [
      {
        id: ONDC_SUBSCRIBER_ID,
        descriptor: { name: 'TruckSetu Logistics' },
        categories: [{ id: 'Standard Delivery', descriptor: { name: 'FTL / Part load' } }],
        items: lanes.map((l) => ({
          id: l.id,
          descriptor: {
            name: `${l.origin} → ${l.destination}`,
            short_desc: `${l.material}, ${l.weightTonnes}T`,
          },
          category_id: l.weightTonnes <= 8 ? 'Part load' : 'FTL',
          price: { currency: 'INR', value: String(l.priceInr) },
          fulfillment_id: `ff-${l.id}`,
          '@ondc/org/category': 'Standard Delivery',
        })),
        fulfillments: lanes.map((l) => ({
          id: `ff-${l.id}`,
          type: 'Delivery',
          start: { location: { address: { city: l.origin } } },
          end: { location: { address: { city: l.destination } } },
          '@ondc/org/TAT': 'P1D',
        })),
      },
    ],
  };
}

/**
 * Beckn signatures use Ed25519 over a Blake-512 digest of specified headers.
 * The real signing key comes from the network registry enrolment; this
 * returns the header shape so the transport is testable end to end.
 */
export function signingHeader(body: string): string {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 30;
  const digest = crypto.createHash('sha512').update(body).digest('base64');
  return [
    `Signature keyId="${ONDC_SUBSCRIBER_ID}|key1|ed25519"`,
    'algorithm="ed25519"',
    `created="${created}"`,
    `expires="${expires}"`,
    'headers="(created) (expires) digest"',
    `signature="${digest.slice(0, 44)}"`,
  ].join(',');
}
