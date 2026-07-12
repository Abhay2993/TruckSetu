/**
 * Domain models — deliberately mirrors src/types/index.ts in the app so the
 * JSON on the wire needs no mapping layer. If this file and the app's types
 * drift, the API contract broke; change them together.
 */

export type UserRole = 'driver' | 'dealer';

export interface User {
  id: string;
  phone: string;
  name: string | null;
  role: UserRole | null;
  /** Set by the KYC provider callback (dev mode: /v1/kyc/verify). */
  kycVerified?: boolean;
  createdAt: number;
}

export interface TelemetryPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number;
}

export type LoadStatus = 'open' | 'booked' | 'in_transit' | 'delivered';

export interface Bid {
  id: string;
  driverName: string;
  truckNumber: string;
  amountInr: number;
  rating: number;
  kycVerified?: boolean;
  placedAt: number;
}

export interface Load {
  id: string;
  origin: string;
  destination: string;
  material: string;
  weightTonnes: number;
  priceInr: number;
  advancePercent: number;
  status: LoadStatus;
  bids: Bid[];
  postedAt: number;
  /** Server-only linkage; the app ignores unknown keys. */
  dealerId?: string;
}

export type EscrowStage =
  | 'CREATED'
  | 'DISPATCHED'
  | 'ADVANCE_PAID'
  | 'POD_UPLOADED'
  | 'BALANCE_RELEASED';

export interface ProofOfDelivery {
  uri: string;
  kind: 'photo' | 'document';
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
  events: EscrowEvent[];
  ratingByDealer?: number | null;
  ratingByDriver?: number | null;
  dealerId?: string;
  driverId?: string;
}

export interface FastagTransaction {
  id: string;
  label: string;
  amountInr: number;
  at: number;
}

export interface FastagWallet {
  balanceInr: number;
  transactions: FastagTransaction[];
}

export interface TelemetryStats {
  totalPoints: number;
  lastSyncAt: number | null;
  lastPoint: TelemetryPoint | null;
}

export interface SosAlert {
  id: string;
  userId: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  at: number;
  resolvedAt: number | null;
}

export interface FuelPrice {
  city: string;
  state: string;
  dieselInrPerLitre: number;
  updatedAt: number;
}

export interface DbShape {
  users: User[];
  loads: Load[];
  shipments: EscrowShipment[];
  /** Keyed by user id. */
  fastag: Record<string, FastagWallet>;
  telemetry: TelemetryStats;
  sosAlerts: SosAlert[];
}
