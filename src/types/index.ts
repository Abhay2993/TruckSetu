/**
 * TruckSetu — shared domain models.
 *
 * Every store, screen and service imports from this single module so the
 * shape of a "Load", "Shipment" or "TelemetryPoint" is defined exactly once.
 * When the real backend lands, these interfaces become the API contract.
 */

/** The two user personas the app serves (Feature B). */
export type UserRole = 'driver' | 'dealer';

/** Authenticated user, as returned by the auth endpoints. */
export interface AuthUser {
  id: string;
  phone: string;
  name: string | null;
  role: UserRole | null;
}

/** Supported vernacular locales (Feature F). */
export type Locale = 'en' | 'hi' | 'pa' | 'te' | 'ta';

// ---------------------------------------------------------------------------
// Telemetry (Feature D)
// ---------------------------------------------------------------------------

/** A single GPS fix. This is the exact object cached offline and synced. */
export interface TelemetryPoint {
  latitude: number;
  longitude: number;
  /** Unix epoch millis — numeric so it serialises losslessly to AsyncStorage. */
  timestamp: number;
  /** km/h as reported by the GPS provider. */
  speed: number;
}

// ---------------------------------------------------------------------------
// Loads & bidding (Dealer side)
// ---------------------------------------------------------------------------

export type LoadStatus = 'open' | 'booked' | 'in_transit' | 'delivered';

export interface Load {
  id: string;
  origin: string;
  destination: string;
  /** Human-readable material, e.g. "Cement bags", "FMCG cartons". */
  material: string;
  weightTonnes: number;
  /** Dealer's asking freight in INR. */
  priceInr: number;
  /** Percentage of freight paid as advance on dispatch (60–80 typical). */
  advancePercent: number;
  status: LoadStatus;
  bids: Bid[];
  postedAt: number;
}

export interface Bid {
  id: string;
  driverName: string;
  truckNumber: string;
  /** Driver's counter-offer in INR. */
  amountInr: number;
  rating: number;
  placedAt: number;
}

// ---------------------------------------------------------------------------
// Escrow payments (Feature C)
// ---------------------------------------------------------------------------

/**
 * The 2-stage Indian escrow lifecycle:
 *
 *   CREATED ──confirmDispatch()──▶ DISPATCHED ──auto payout──▶ ADVANCE_PAID
 *   ADVANCE_PAID ──driver uploads POD──▶ POD_UPLOADED
 *   POD_UPLOADED ──dealer releases──▶ BALANCE_RELEASED
 */
export type EscrowStage =
  | 'CREATED'
  | 'DISPATCHED'
  | 'ADVANCE_PAID'
  | 'POD_UPLOADED'
  | 'BALANCE_RELEASED';

export type PodKind = 'photo' | 'document';

export interface ProofOfDelivery {
  uri: string;
  kind: PodKind;
  fileName: string;
  uploadedAt: number;
}

export interface EscrowEvent {
  stage: EscrowStage;
  label: string;
  at: number;
}

export interface EscrowShipment {
  id: string;
  loadId: string;
  origin: string;
  destination: string;
  driverName: string;
  truckNumber: string;
  totalAmountInr: number;
  advancePercent: number;
  stage: EscrowStage;
  pod: ProofOfDelivery | null;
  /** Append-only audit trail rendered as the payment timeline. */
  events: EscrowEvent[];
}

// ---------------------------------------------------------------------------
// Route amenities & FASTag (Feature E)
// ---------------------------------------------------------------------------

export type AmenityKind = 'dhaba' | 'mechanic';

export interface Amenity {
  id: string;
  kind: AmenityKind;
  name: string;
  /** Distance ahead of the truck along the current route. */
  distanceKm: number;
  rating: number;
  /** Real GPS position — used by the native react-native-maps view. */
  latitude: number;
  longitude: number;
  /** Normalised 0..1 position on the simulated web/canvas map. */
  mapX: number;
  mapY: number;
  /** Dhaba-only flags — undefined for mechanics. */
  servesVeg?: boolean;
  servesNonVeg?: boolean;
  hasDriverParking?: boolean;
  /** Mechanic-only flag. */
  isCertified?: boolean;
}

export interface FastagTransaction {
  id: string;
  label: string;
  /** Negative = toll debit, positive = top-up credit. */
  amountInr: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Driver features: fuel prices, document locker, SOS
// ---------------------------------------------------------------------------

export interface FuelPrice {
  city: string;
  state: string;
  dieselInrPerLitre: number;
  updatedAt: number;
}

export type DocumentKind = 'rc' | 'dl' | 'insurance' | 'permit' | 'puc';

export interface DriverDocument {
  kind: DocumentKind;
  fileName: string;
  uri: string;
  /** ISO date (YYYY-MM-DD); null when the doc has no expiry set yet. */
  expiresOn: string | null;
  addedAt: number;
}
