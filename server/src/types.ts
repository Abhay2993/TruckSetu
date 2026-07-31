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
  /** Consent for lending partners to pull this user's TruckScore. */
  bureauConsent?: boolean;
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
  /** Repositioning bonus when this lane is short of trucks (computed on read). */
  incentiveInr?: number;
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
  /** Hash-chain links — see ledger.ts. Absent on pre-chaining records. */
  prevHash?: string;
  hash?: string;
}

/** Geofenced waiting time at each stop, and what it costs. */
export interface DetentionRecord {
  originArrivedAt: number | null;
  originDepartedAt: number | null;
  destinationArrivedAt: number | null;
  destinationDepartedAt: number | null;
  loadingHours: number | null;
  unloadingHours: number | null;
  chargeInr: number;
  settled: boolean;
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
  /** e-Way bill number, once generated (NIC API / simulated). */
  ewayBillNumber?: string | null;
  /** Aadhaar-eSigned digital LR/contract state. */
  contract?: ShipmentContract | null;
  /** Set when this shipment is one leg of a chained round trip. */
  chainId?: string;
  chainLeg?: number;
  chainLegs?: number;
  /** Geofenced detention/demurrage record. */
  detention?: DetentionRecord;
  dealerId?: string;
  driverId?: string;
}

export interface ShipmentContract {
  /** SHA-256 of the contract text — the tamper-evidence anchor. */
  textHash: string;
  signedByDealerAt: number | null;
  signedByDriverAt: number | null;
}

export type FraudKind = 'gps_spoof' | 'duplicate_pod' | 'route_deviation';

export interface FraudAlert {
  id: string;
  kind: FraudKind;
  userId: string | null;
  shipmentId: string | null;
  detail: string;
  at: number;
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

// ---------------------------------------------------------------------------
// TruckSetu Money — credit, EMIs, fuel card, receivables, bureau
// ---------------------------------------------------------------------------

/** Per-user safety telemetry, the input to insurance pricing. */
export interface DrivingStats {
  points: number;
  overspeedEvents: number;
  harshEvents: number;
  nightPoints: number;
  lastAt: number | null;
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
  /** 'escrow' = auto-swept from a balance release (repayment seniority). */
  source: 'manual' | 'escrow';
}

/** Revolving working-capital line, one per user. */
export interface CreditFacility {
  userId: string;
  limitInr: number;
  drawnInr: number;
  aprPercent: number;
  draws: CreditDraw[];
  repayments: CreditRepayment[];
  updatedAt: number;
}

export interface EmiPlan {
  id: string;
  userId: string;
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
  userId: string;
  last4: string;
  creditLimitInr: number;
  outstandingInr: number;
  litresThisMonth: number;
  savedInr: number;
  transactions: FuelCardTransaction[];
  issuedAt: number;
}

/** A discounted dealer receivable: paid out on day 1, collected at maturity. */
export interface InvoiceAdvance {
  id: string;
  userId: string;
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

export interface VehicleLoanApplication {
  id: string;
  userId: string;
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
  userId: string;
  sumInsuredInr: number;
  basePremiumInr: number;
  discountPercent: number;
  premiumInr: number;
  validUntil: number;
  at: number;
}

/** An audited third-party score pull — the bureau product. */
export interface BureauQuery {
  id: string;
  partner: string;
  subjectPhone: string;
  score: number | null;
  feeInr: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Marketplace — network effects
// ---------------------------------------------------------------------------

/**
 * Assured return load. 'standby_due' means the window lapsed without a
 * backhaul and TruckSetu owes the driver the standby fee.
 */
export interface ReturnGuarantee {
  id: string;
  driverId: string;
  /** The drop city the guarantee is anchored to. */
  city: string;
  /** The inbound shipment that earned the guarantee. */
  shipmentId: string;
  windowHours: number;
  standbyFeeInr: number;
  status: 'active' | 'fulfilled' | 'standby_due' | 'paid';
  startedAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  fulfilledByShipmentId: string | null;
  paidAt: number | null;
}

// ---------------------------------------------------------------------------
// Membership (Suraksha): savings, pension, rewards, assistance
// ---------------------------------------------------------------------------

export interface SavingsTxn {
  id: string;
  kind: 'skim' | 'match' | 'interest' | 'withdrawal';
  amountInr: number;
  note: string;
  at: number;
}

export interface SavingsAccount {
  userId: string;
  /** Share of each settled trip swept into savings (0 disables). */
  skimPercent: number;
  savingsInr: number;
  /** Locked leg — the micro-pension. */
  pensionInr: number;
  matchedInr: number;
  interestInr: number;
  transactions: SavingsTxn[];
  openedAt: number;
}

export interface RewardsLedger {
  earnedInr: number;
  redeemedInr: number;
}

export type LegalCaseKind =
  | 'challan'
  | 'rto_seizure'
  | 'police_stop'
  | 'accident_claim'
  | 'overloading_notice'
  | 'other';

export interface AssistanceCase {
  id: string;
  userId: string;
  kind: LegalCaseKind;
  detail: string;
  latitude: number | null;
  longitude: number | null;
  status: 'open' | 'assigned' | 'resolved';
  /** Whether the membership tier covers this one. */
  covered: boolean;
  advocateName: string | null;
  outcome?: string;
  at: number;
  resolvedAt: number | null;
}

export interface BreakdownCase {
  id: string;
  userId: string;
  latitude: number;
  longitude: number;
  problem: string;
  status: 'dispatched' | 'on_site' | 'resolved';
  covered: boolean;
  garageName: string | null;
  garagePhone: string | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  slaMinutes: number;
  slaDeadlineAt: number;
  note?: string;
  at: number;
  arrivedAt: number | null;
  resolvedAt: number | null;
  /** Set when the mechanic arrives: did we hit the promised SLA? */
  slaMet: boolean | null;
}

// ---------------------------------------------------------------------------
// Regulatory: VAHAN/SARATHI-backed compliance
// ---------------------------------------------------------------------------

export interface ComplianceItem {
  kind: 'registration' | 'fitness' | 'insurance' | 'puc' | 'permit' | 'licence';
  label: string;
  validUpto: string;
  daysLeft: number;
  status: 'valid' | 'expiring' | 'expired';
}

export interface VehicleCompliance {
  userId: string;
  vehicleNumber: string;
  /** False when a statutory document has lapsed — blocks bidding. */
  canBid: boolean;
  blockingReasons: string[];
  expiringCount: number;
  items: ComplianceItem[];
  checkedAt: number;
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
  fraudAlerts: FraudAlert[];
  /** Money: all keyed collections below are per user id where noted. */
  driving: Record<string, DrivingStats>;
  credit: Record<string, CreditFacility>;
  fuelCards: Record<string, FuelCardAccount>;
  emis: EmiPlan[];
  advances: InvoiceAdvance[];
  vehicleLoans: VehicleLoanApplication[];
  policies: InsurancePolicy[];
  bureauQueries: BureauQuery[];
  /** Marketplace. */
  returnGuarantees: ReturnGuarantee[];
  /** Membership: keyed by user id where noted. */
  savings: Record<string, SavingsAccount>;
  rewards: Record<string, RewardsLedger>;
  legalCases: AssistanceCase[];
  breakdowns: BreakdownCase[];
  /** Regulatory: cached VAHAN/SARATHI compliance, keyed by user id. */
  compliance: Record<string, VehicleCompliance>;
}
