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
  /** Consignment / LR number the POD must match (Feature 12). */
  consignmentNo?: string;
  /** Goods-in-transit insurance opted at posting. */
  insured?: boolean;
  insurancePremiumInr?: number;
}

export interface Bid {
  id: string;
  driverName: string;
  truckNumber: string;
  /** Driver's counter-offer in INR. */
  amountInr: number;
  rating: number;
  /** KYC-verified driver badge — trust is the product in this market. */
  kycVerified?: boolean;
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
  /** Consignment number read off the POD by OCR (Feature 12). */
  ocrConsignmentNo?: string | null;
  /** True when the OCR number matches the load's consignment number. */
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
  /** Append-only audit trail rendered as the payment timeline. */
  events: EscrowEvent[];
  /** Two-way ratings, settable once the shipment is fully settled. */
  ratingByDealer?: number | null;
  ratingByDriver?: number | null;
  /** Expected consignment number, carried from the load (Feature 12). */
  consignmentNo?: string;
  /** Open dispute id — blocks balance release while set (Feature 13). */
  disputeId?: string | null;
  /** Goods-in-transit insurance, inherited from the load. */
  insured?: boolean;
  /** Factoring fee retained when the driver took an instant payout. */
  instantPayoutFeeInr?: number;
  /** e-Way bill number, once generated. */
  ewayBillNumber?: string | null;
  /** Aadhaar-eSigned digital LR state. */
  contract?: ShipmentContract | null;
}

export interface ShipmentContract {
  /** SHA-256 of the contract text — the tamper-evidence anchor. */
  textHash: string;
  signedByDealerAt: number | null;
  signedByDriverAt: number | null;
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

/** FASTag auto-recharge rule (Feature 14). */
export interface AutoRechargeRule {
  enabled: boolean;
  thresholdInr: number;
  topUpInr: number;
}

// ---------------------------------------------------------------------------
// Chat, notifications, disputes (platform features 10, 11, 13)
// ---------------------------------------------------------------------------

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

export interface AppNotification {
  id: string;
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

// ---------------------------------------------------------------------------
// TruckSetu Money — mirrors server/src/types.ts
// ---------------------------------------------------------------------------

export interface ScoreFactor {
  label: string;
  value: string;
  positive: boolean;
}

export interface PlatformScore {
  score: number;
  band: 'Building' | 'Fair' | 'Good' | 'Excellent';
  factors: ScoreFactor[];
}

export interface DrivingScore {
  score: number;
  band: 'Needs work' | 'Fair' | 'Safe' | 'Elite';
  discountPercent: number;
  sampleSize: number;
}

export interface CreditDraw {
  id: string;
  amountInr: number;
  at: number;
  referenceId: string;
}

export interface CreditRepayment {
  id: string;
  amountInr: number;
  at: number;
  source: 'manual' | 'escrow';
}

export interface CreditFacility {
  limitInr: number;
  drawnInr: number;
  availableInr: number;
  aprPercent: number;
  draws: CreditDraw[];
  repayments: CreditRepayment[];
}

export interface EmiPlan {
  id: string;
  itemId: string;
  itemLabel: string;
  principalInr: number;
  tenorMonths: number;
  monthlyInr: number;
  aprPercent: number;
  paidInstalments: number;
  outstandingInr: number;
  status: 'active' | 'closed';
  at: number;
}

export interface FuelCardTransaction {
  id: string;
  pump: string;
  city: string;
  litres: number;
  amountInr: number;
  discountInr: number;
  cashbackInr: number;
  at: number;
}

export interface FuelCardAccount {
  last4: string;
  creditLimitInr: number;
  outstandingInr: number;
  litresThisMonth: number;
  savedInr: number;
  transactions: FuelCardTransaction[];
}

export interface InvoiceAdvance {
  id: string;
  shipmentId: string;
  invoiceNo: string;
  faceValueInr: number;
  feeInr: number;
  netInr: number;
  termDays: number;
  dueAt: number;
  status: 'advanced' | 'collected';
  at: number;
}

/** A settled receivable the dealer can turn into cash today. */
export interface DiscountableInvoice {
  shipmentId: string;
  invoiceNo: string;
  route: string;
  faceValueInr: number;
  quote30: { faceValueInr: number; feeInr: number; netInr: number; dueAt: number };
  quote60: { faceValueInr: number; feeInr: number; netInr: number; dueAt: number };
}

export interface VehicleLoanApplication {
  id: string;
  purpose: 'purchase' | 'refinance';
  amountInr: number;
  tenorMonths: number;
  aprPercent: number;
  emiInr: number;
  status: 'submitted' | 'approved' | 'rejected';
  at: number;
}

export interface InsurancePolicy {
  id: string;
  sumInsuredInr: number;
  basePremiumInr: number;
  discountPercent: number;
  premiumInr: number;
  validUntil: number;
  at: number;
}

/** Everything the Money screen renders, in one shape. */
export interface MoneySummary {
  score: PlatformScore;
  driving: DrivingScore | null;
  facility: CreditFacility;
  fuelCard: FuelCardAccount;
  emis: EmiPlan[];
  advances: InvoiceAdvance[];
  discountable: DiscountableInvoice[];
  vehicleLoans: VehicleLoanApplication[];
  policies: InsurancePolicy[];
  insuranceQuote: {
    sumInsuredInr: number;
    basePremiumInr: number;
    drivingScore: number | null;
    discountPercent: number;
    premiumInr: number;
    savedInr: number;
  };
  bureauConsent: boolean;
}
