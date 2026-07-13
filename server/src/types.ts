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
  /** Expo push token registered by the device. */
  pushToken?: string | null;
  /** Mirror notifications/OTPs to WhatsApp when true. */
  whatsappOptIn?: boolean;
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
  /** The bidding driver's user id, so accepting can link the shipment. */
  driverId?: string;
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
  /** Consignment / LR number the POD must match (OCR verification). */
  consignmentNo?: string;
  /** Goods-in-transit insurance opted at posting. */
  insured?: boolean;
  insurancePremiumInr?: number;
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
  /** Consignment number read from the POD by OCR. */
  ocrConsignmentNo?: string | null;
  /** True when the OCR number matches the load's consignmentNo. */
  verified?: boolean;
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
  /** Expected consignment number, carried from the load for POD matching. */
  consignmentNo?: string;
  /** Open dispute id, if any — blocks balance release while set. */
  disputeId?: string | null;
  /** Goods-in-transit insurance, inherited from the load. */
  insured?: boolean;
  /** Instant-payout (factoring) fee retained, when the driver cashed out early. */
  instantPayoutFeeInr?: number;
  dealerId?: string;
  driverId?: string;
}

export interface FastagTransaction {
  id: string;
  label: string;
  amountInr: number;
  at: number;
}

export interface AutoRechargeRule {
  enabled: boolean;
  /** Trigger a top-up when balance drops below this. */
  thresholdInr: number;
  /** How much to add each auto top-up. */
  topUpInr: number;
}

export interface FastagWallet {
  balanceInr: number;
  transactions: FastagTransaction[];
  autoRecharge?: AutoRechargeRule;
}

export type ChatSenderRole = 'dealer' | 'driver';

export interface ChatMessage {
  id: string;
  shipmentId: string;
  senderId: string;
  senderRole: ChatSenderRole;
  text: string;
  at: number;
}

export type NotificationKind =
  | 'bid_received'
  | 'bid_accepted'
  | 'advance_paid'
  | 'pod_uploaded'
  | 'balance_released'
  | 'dispute_raised'
  | 'dispute_resolved'
  | 'message';

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  shipmentId?: string;
  at: number;
  read: boolean;
}

export type DisputeReason = 'damaged_goods' | 'late_delivery' | 'shortage' | 'wrong_pod' | 'other';
export type DisputeStatus = 'open' | 'under_review' | 'resolved';
export type DisputeResolution = 'released' | 'refunded' | 'partial' | 'dismissed';

export interface Dispute {
  id: string;
  shipmentId: string;
  raisedByRole: ChatSenderRole;
  reason: DisputeReason;
  detail: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  at: number;
  resolvedAt: number | null;
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

export interface WhatsAppOutboxEntry {
  id: string;
  to: string;
  text: string;
  mode: 'cloud-api' | 'simulated';
  at: number;
}

export interface DbShape {
  users: User[];
  loads: Load[];
  shipments: EscrowShipment[];
  /** Keyed by user id. */
  fastag: Record<string, FastagWallet>;
  telemetry: TelemetryStats;
  sosAlerts: SosAlert[];
  messages: ChatMessage[];
  notifications: Notification[];
  disputes: Dispute[];
  whatsappOutbox: WhatsAppOutboxEntry[];
}
