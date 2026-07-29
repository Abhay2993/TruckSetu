/**
 * TruckSetu API server.
 *
 * Single-file route table on purpose: at this size, one place to read the
 * whole API surface beats ceremony. Every mutation validates the escrow
 * stage machine server-side — the app's local checks are UX, these are the
 * source of truth.
 */

import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AuthedRequest, IS_DEV, normalizePhone, requestOtp, requireAuth, verifyOtp } from './auth';
import { contractHash, contractText, generateEwayBill } from './compliance';
import { db, newId, persist } from './db';
import { checkPodDuplicate, checkTelemetryBatch } from './fraud';
import {
  activeGuaranteeFor,
  buildChain,
  consolidationGroups,
  guaranteeOffer,
  incentiveForLoad,
  laneDensities,
  laneIndex,
  openGuarantee,
  settleGuarantee,
} from './marketplace';
import {
  commitEscrowDeductions,
  createEmiPlan,
  drivingScore,
  EMI_CATALOGUE,
  ensureFacility,
  ensureFuelCard,
  insuranceQuote,
  invoiceFaceValue,
  MONEY,
  PARTNER_PUMPS,
  planEscrowDeductions,
  quoteDiscount,
  recordDrivingPoints,
  scoreFor,
  swipeFuelCard,
  vehicleLoanQuote,
} from './money';
import { notifyUser } from './notify';
import { OPS_CONSOLE_HTML, opsAuthorized } from './ops';
import { connectedClientCount, pushEventTo, registerSseClient } from './realtime';
import { buildUpiIntent, executePayout, paymentsMode, verifyWebhookSignature } from './payments';
import {
  parseLoadMessage,
  sendWhatsApp,
  WHATSAPP_HELP_REPLY,
  WHATSAPP_VERIFY_TOKEN,
  whatsappMode,
} from './whatsapp';
import {
  Bid,
  ChatMessage,
  Dispute,
  DisputeReason,
  EscrowShipment,
  FastagWallet,
  FuelPrice,
  InvoiceAdvance,
  Load,
  TelemetryPoint,
  VehicleLoanApplication,
} from './types';

const app = express();
app.use(cors());
// Keep the raw body around: webhook signatures are computed over the exact
// bytes received, not the re-serialised JSON.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
    },
  }),
);

const PORT = Number(process.env.PORT ?? 4000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitAmounts(s: EscrowShipment): { advanceInr: number; balanceInr: number } {
  const advanceInr = Math.round((s.totalAmountInr * s.advancePercent) / 100);
  return { advanceInr, balanceInr: s.totalAmountInr - advanceInr };
}

function pushEvent(s: EscrowShipment, label: string): void {
  s.events.push({ stage: s.stage, label, at: Date.now() });
}

function wallet(userId: string): FastagWallet {
  let w = db.fastag[userId];
  if (!w) {
    // New wallets start below the low-balance threshold so the top-up flow
    // is immediately exercisable — mirrors the app's demo seed.
    w = {
      balanceInr: 340,
      transactions: [
        { id: newId('ft'), label: 'Toll — Kherki Daula Plaza', amountInr: -305, at: Date.now() - 5 * 3600 * 1000 },
        { id: newId('ft'), label: 'Toll — Manesar Plaza', amountInr: -190, at: Date.now() - 2 * 3600 * 1000 },
      ],
      autoRecharge: { enabled: false, thresholdInr: 300, topUpInr: 500 },
    };
    db.fastag[userId] = w;
    persist();
  }
  return w;
}

/** Apply the auto-recharge rule if the balance fell below the threshold. */
function applyAutoRecharge(w: FastagWallet): void {
  const rule = w.autoRecharge;
  if (!rule?.enabled || w.balanceInr >= rule.thresholdInr) return;
  const ref = `AUTO${Date.now()}`;
  w.balanceInr += rule.topUpInr;
  w.transactions.unshift({
    id: ref,
    label: `Auto top-up (balance below ₹${rule.thresholdInr})`,
    amountInr: rule.topUpInr,
    at: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Health & auth
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'trucksetu-server', dev: IS_DEV, sseClients: connectedClientCount() });
});

// ---------------------------------------------------------------------------
// Realtime (SSE). EventSource can't set headers, so the JWT rides a query
// param; verified the same way as the Authorization header.
// ---------------------------------------------------------------------------

app.get('/v1/events', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET ?? 'trucksetu-dev-secret-change-me',
    ) as { sub: string };
    registerSseClient(payload.sub, res);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

app.post('/v1/auth/otp/request', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) {
    res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    return;
  }
  const result = requestOtp(phone);
  if ('error' in result) {
    res.status(429).json(result);
    return;
  }
  res.json({ ok: true, phone, ...result });
});

app.post('/v1/auth/otp/verify', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!phone || !/^\d{6}$/.test(otp)) {
    res.status(400).json({ error: 'Phone and 6-digit OTP are required.' });
    return;
  }
  const result = verifyOtp(phone, otp);
  if ('error' in result) {
    res.status(401).json(result);
    return;
  }
  res.json(result);
});

app.put('/v1/me', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const { name, role } = req.body ?? {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name must be a non-empty string.' });
      return;
    }
    user.name = name.trim();
  }
  if (role !== undefined) {
    if (role !== 'driver' && role !== 'dealer') {
      res.status(400).json({ error: "Role must be 'driver' or 'dealer'." });
      return;
    }
    user.role = role;
  }
  if (req.body?.whatsappOptIn !== undefined) {
    user.whatsappOptIn = Boolean(req.body.whatsappOptIn);
    if (user.whatsappOptIn) {
      void sendWhatsApp(
        user.phone,
        'Welcome to TruckSetu on WhatsApp! 🚛 You will get bid, payment and POD updates here. Reply STOP to opt out.',
      );
    }
  }
  persist();
  res.json({ user });
});

// ---------------------------------------------------------------------------
// Loads & bidding
// ---------------------------------------------------------------------------

app.get('/v1/loads', requireAuth, (_req, res) => {
  // Loads carry their lane's repositioning bonus, so the board itself
  // steers trucks toward deficit lanes without a separate screen.
  res.json({
    loads: db.loads.map((l) => ({ ...l, incentiveInr: incentiveForLoad(l) })),
  });
});

app.post('/v1/loads', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const { origin, destination, material, weightTonnes, priceInr, advancePercent } = req.body ?? {};
  if (
    typeof origin !== 'string' || !origin.trim() ||
    typeof destination !== 'string' || !destination.trim() ||
    typeof material !== 'string' || !material.trim()
  ) {
    res.status(400).json({ error: 'origin, destination and material are required.' });
    return;
  }
  const weight = Number(weightTonnes);
  const price = Number(priceInr);
  const advance = Number(advancePercent ?? 70);
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(price) || price <= 0) {
    res.status(400).json({ error: 'weightTonnes and priceInr must be positive numbers.' });
    return;
  }
  if (!Number.isFinite(advance) || advance < 0 || advance > 100) {
    res.status(400).json({ error: 'advancePercent must be between 0 and 100.' });
    return;
  }

  const load: Load = {
    id: newId('load'),
    origin: origin.trim(),
    destination: destination.trim(),
    material: material.trim(),
    weightTonnes: weight,
    priceInr: Math.round(price),
    advancePercent: Math.round(advance),
    status: 'open',
    bids: [],
    postedAt: Date.now(),
    // Every load carries a consignment / LR number so POD OCR verification
    // has something to check against (dealer-supplied or auto-generated).
    consignmentNo:
      typeof req.body?.consignmentNo === 'string' && req.body.consignmentNo.trim()
        ? req.body.consignmentNo.trim()
        : `LR-${Math.floor(10000 + Math.random() * 90000)}`,
    // Goods-in-transit insurance: premium = 0.35% of freight, min ₹99.
    // Production: bind the policy with the insurer's API (Digit / ICICI
    // Lombard) here and store the policy number.
    insured: Boolean(req.body?.insured),
    insurancePremiumInr: req.body?.insured
      ? Math.max(99, Math.round(price * 0.0035))
      : undefined,
    dealerId: user.id,
  };
  db.loads.unshift(load);
  persist();
  res.status(201).json({ load });
});

app.post('/v1/loads/:loadId/bids', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) {
    res.status(404).json({ error: 'Load not found.' });
    return;
  }
  if (load.status !== 'open') {
    res.status(409).json({ error: 'Load is no longer open for bidding.' });
    return;
  }
  const amount = Number(req.body?.amountInr);
  const truckNumber = typeof req.body?.truckNumber === 'string' ? req.body.truckNumber.trim() : '';
  if (!Number.isFinite(amount) || amount <= 0 || !truckNumber) {
    res.status(400).json({ error: 'amountInr (positive) and truckNumber are required.' });
    return;
  }
  const bid: Bid = {
    id: newId('bid'),
    driverName: user.name ?? user.phone,
    truckNumber,
    amountInr: Math.round(amount),
    rating: 4.0,
    kycVerified: user.kycVerified ?? false,
    driverId: user.id,
    placedAt: Date.now(),
  };
  load.bids.push(bid);
  persist();
  if (load.dealerId) {
    notifyUser({
      userId: load.dealerId,
      kind: 'bid_received',
      title: 'New bid received',
      body: `${bid.driverName} bid ${bid.amountInr} on ${load.origin} → ${load.destination}.`,
    });
  }
  res.status(201).json({ bid, load });
});

app.post('/v1/loads/:loadId/bids/:bidId/accept', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const load = db.loads.find((l) => l.id === req.params.loadId);
  const bid = load?.bids.find((b) => b.id === req.params.bidId);
  if (!load || !bid) {
    res.status(404).json({ error: 'Load or bid not found.' });
    return;
  }
  if (load.status !== 'open') {
    res.status(409).json({ error: 'Load already booked.' });
    return;
  }

  load.status = 'booked';
  const shipment: EscrowShipment = {
    id: newId('shp'),
    loadId: load.id,
    origin: load.origin,
    destination: load.destination,
    driverName: bid.driverName,
    truckNumber: bid.truckNumber,
    totalAmountInr: bid.amountInr,
    advancePercent: load.advancePercent,
    stage: 'CREATED',
    pod: null,
    events: [],
    consignmentNo: load.consignmentNo,
    disputeId: null,
    insured: load.insured,
    dealerId: user.id,
    driverId: bid.driverId,
  };
  shipment.events.push({
    stage: 'CREATED',
    label: `Bid accepted — ${bid.driverName} (${bid.truckNumber})`,
    at: Date.now(),
  });
  db.shipments.unshift(shipment);
  persist();
  if (bid.driverId) {
    notifyUser({
      userId: bid.driverId,
      kind: 'bid_accepted',
      title: 'Your bid was accepted!',
      body: `${load.origin} → ${load.destination} is yours. Awaiting dispatch.`,
      shipmentId: shipment.id,
    });
  }
  res.status(201).json({ load, shipment });
});

// ---------------------------------------------------------------------------
// Escrow lifecycle — the stage machine lives HERE, authoritatively.
// ---------------------------------------------------------------------------

app.get('/v1/shipments', requireAuth, (_req, res) => {
  res.json({ shipments: db.shipments });
});

app.post('/v1/shipments/:id/dispatch', requireAuth, async (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (shipment.stage !== 'CREATED') {
    res.status(409).json({ error: `Cannot dispatch from stage ${shipment.stage}.` });
    return;
  }
  const { advanceInr } = splitAmounts(shipment);

  // Stage 1 fires automatically on dispatch — execute the payout FIRST so a
  // failed payment leaves the shipment dispatchable again, never half-paid.
  let referenceId: string;
  try {
    ({ referenceId } = await executePayout('advance', shipment.id, advanceInr));
  } catch (error) {
    console.error('[payments] advance payout failed', error);
    res.status(502).json({ error: 'Advance payout failed — try dispatching again.' });
    return;
  }

  shipment.stage = 'DISPATCHED';
  pushEvent(shipment, 'Load confirmed & dispatched');
  shipment.stage = 'ADVANCE_PAID';
  pushEvent(shipment, `Advance paid to fuel card (ref ${referenceId})`);

  persist();
  if (shipment.driverId) {
    notifyUser({
      userId: shipment.driverId,
      kind: 'advance_paid',
      title: 'Advance paid to your fuel card',
      body: `${advanceInr} released for ${shipment.origin} → ${shipment.destination}.`,
      shipmentId: shipment.id,
    });
  }
  res.json({ shipment });
});

app.post('/v1/shipments/:id/pod', requireAuth, (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (shipment.stage !== 'ADVANCE_PAID') {
    res.status(409).json({ error: `Cannot attach POD in stage ${shipment.stage}.` });
    return;
  }
  const { fileName, kind, uri, ocrConsignmentNo } = req.body ?? {};
  if (typeof fileName !== 'string' || (kind !== 'photo' && kind !== 'document')) {
    res.status(400).json({ error: 'fileName and kind (photo|document) are required.' });
    return;
  }

  // POD OCR verification: the client reads the consignment number off the
  // POD image and sends it; the server is the authority on whether it
  // matches what the load promised. Mismatch does NOT block upload — it
  // flags the shipment so the dealer reviews before releasing.
  const readNo = typeof ocrConsignmentNo === 'string' ? ocrConsignmentNo.trim() : null;
  const verified = Boolean(shipment.consignmentNo && readNo && readNo === shipment.consignmentNo);

  // Foundation stores POD metadata; the binary stays on-device. Production
  // path: return a presigned S3/GCS URL here, client uploads, then confirm.
  shipment.pod = {
    uri: typeof uri === 'string' ? uri : '',
    kind,
    fileName,
    uploadedAt: Date.now(),
    ocrConsignmentNo: readNo,
    verified,
  };
  shipment.stage = 'POD_UPLOADED';
  pushEvent(
    shipment,
    verified
      ? `POD uploaded & verified (consignment ${readNo})`
      : shipment.consignmentNo
        ? `POD uploaded — consignment mismatch (read ${readNo ?? 'none'}, expected ${shipment.consignmentNo})`
        : `POD uploaded (${fileName})`,
  );
  persist();
  // Fraud screening: the same POD reused across shipments.
  checkPodDuplicate(shipment);
  if (shipment.dealerId) {
    notifyUser({
      userId: shipment.dealerId,
      kind: 'pod_uploaded',
      title: verified ? 'POD uploaded & verified' : 'POD uploaded — needs review',
      body: `${shipment.origin} → ${shipment.destination}. ${verified ? 'Consignment matches.' : 'Check the consignment number.'}`,
      shipmentId: shipment.id,
    });
  }
  res.json({ shipment });
});

app.post('/v1/shipments/:id/release', requireAuth, async (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  // The escrow guarantee, enforced server-side: no POD, no release.
  if (shipment.stage !== 'POD_UPLOADED') {
    res.status(409).json({ error: `Cannot release balance in stage ${shipment.stage}.` });
    return;
  }
  // A second guarantee: an open dispute freezes the money until resolved.
  if (shipment.disputeId) {
    res.status(409).json({ error: 'An open dispute is holding this escrow — resolve it first.' });
    return;
  }
  const { balanceInr } = splitAmounts(shipment);
  // Repayment seniority: the driver's TruckSetu Money obligations are
  // collected from their own escrow money before it leaves the platform.
  // Planned first, committed only after the payout lands — a failed payout
  // must never leave the driver charged for money they did not receive.
  const plan = shipment.driverId
    ? planEscrowDeductions(shipment.driverId, balanceInr)
    : { netInr: balanceInr, deductions: [] };
  let referenceId: string;
  try {
    ({ referenceId } = await executePayout('balance', shipment.id, plan.netInr));
  } catch (error) {
    console.error('[payments] balance payout failed', error);
    res.status(502).json({ error: 'Balance payout failed — try releasing again.' });
    return;
  }
  if (shipment.driverId) commitEscrowDeductions(shipment.driverId, plan);
  const netInr = plan.netInr;
  shipment.stage = 'BALANCE_RELEASED';
  pushEvent(shipment, `Balance released from escrow (ref ${referenceId})`);
  for (const d of plan.deductions) {
    pushEvent(shipment, `Auto-deducted ₹${d.amountInr} — ${d.label}`);
  }
  persist();
  if (shipment.driverId) {
    notifyUser({
      userId: shipment.driverId,
      kind: 'balance_released',
      title: 'Balance released!',
      body: `${netInr} paid for ${shipment.origin} → ${shipment.destination}. Trip settled.`,
      shipmentId: shipment.id,
    });
  }
  res.json({ shipment, netInr, deductions: plan.deductions });
});

/**
 * Instant payout (invoice factoring): once the POD is in, the driver can
 * cash out the escrowed balance immediately for a fee instead of waiting
 * for the dealer's release. The fee is TruckSetu's factoring revenue.
 * Guards mirror release: POD_UPLOADED stage, no open dispute.
 */
const INSTANT_PAYOUT_FEE_RATE = 0.015; // 1.5%

app.post('/v1/shipments/:id/instant-payout', requireAuth, async (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (shipment.stage !== 'POD_UPLOADED') {
    res.status(409).json({ error: 'Instant payout needs an uploaded POD.' });
    return;
  }
  if (shipment.disputeId) {
    res.status(409).json({ error: 'An open dispute is holding this escrow.' });
    return;
  }
  const { balanceInr } = splitAmounts(shipment);
  const feeInr = Math.max(49, Math.round(balanceInr * INSTANT_PAYOUT_FEE_RATE));
  const afterFeeInr = balanceInr - feeInr;
  // Same seniority rule as a normal release — cashing out early does not
  // jump the queue ahead of TruckSetu Money obligations.
  const plan = shipment.driverId
    ? planEscrowDeductions(shipment.driverId, afterFeeInr)
    : { netInr: afterFeeInr, deductions: [] };
  const netInr = plan.netInr;

  let referenceId: string;
  try {
    ({ referenceId } = await executePayout('balance', shipment.id, netInr));
  } catch (error) {
    console.error('[payments] instant payout failed', error);
    res.status(502).json({ error: 'Instant payout failed — try again.' });
    return;
  }
  if (shipment.driverId) commitEscrowDeductions(shipment.driverId, plan);

  shipment.stage = 'BALANCE_RELEASED';
  shipment.instantPayoutFeeInr = feeInr;
  pushEvent(
    shipment,
    `Instant payout: ${netInr} paid now (fee ${feeInr} @ 1.5%, ref ${referenceId})`,
  );
  for (const d of plan.deductions) {
    pushEvent(shipment, `Auto-deducted ₹${d.amountInr} — ${d.label}`);
  }
  persist();
  if (shipment.dealerId) {
    notifyUser({
      userId: shipment.dealerId,
      kind: 'balance_released',
      title: 'Driver took instant payout',
      body: `${shipment.origin} → ${shipment.destination} settled via instant payout.`,
      shipmentId: shipment.id,
    });
  }
  res.json({ shipment, feeInr, netInr });
});

// ---------------------------------------------------------------------------
// Compliance: e-Way bill, GSTR-1 summary, Aadhaar-eSigned contracts
// ---------------------------------------------------------------------------

app.post('/v1/shipments/:id/ewaybill', requireAuth, (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (shipment.ewayBillNumber) {
    res.json({ shipment, ewayBillNumber: shipment.ewayBillNumber });
    return;
  }
  const { ewayBillNumber, validUntil, mode } = generateEwayBill(shipment);
  shipment.ewayBillNumber = ewayBillNumber;
  pushEvent(shipment, `e-Way bill generated: ${ewayBillNumber} (${mode})`);
  persist();
  res.json({ shipment, ewayBillNumber, validUntil, mode });
});

/** GSTR-1 shaped summary of the month's invoices for filing/export. */
app.get('/v1/gst/gstr1', requireAuth, (_req, res) => {
  const GST_RATE = 0.05;
  const rows = db.shipments.map((s) => ({
    invoiceNo: `TS-INV-${s.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`,
    date: s.events[0]?.at ?? Date.now(),
    route: `${s.origin} → ${s.destination}`,
    taxableValueInr: s.totalAmountInr,
    gstInr: Math.round(s.totalAmountInr * GST_RATE),
    ewayBillNumber: s.ewayBillNumber ?? null,
    status: s.stage === 'BALANCE_RELEASED' ? 'PAID' : 'OUTSTANDING',
  }));
  res.json({
    period: new Date().toISOString().slice(0, 7),
    gstRate: GST_RATE,
    invoiceCount: rows.length,
    taxableValueInr: rows.reduce((a, r) => a + r.taxableValueInr, 0),
    gstInr: rows.reduce((a, r) => a + r.gstInr, 0),
    rows,
  });
});

app.get('/v1/shipments/:id/contract', requireAuth, (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  res.json({
    text: contractText(shipment),
    hash: contractHash(shipment),
    contract: shipment.contract ?? null,
  });
});

/**
 * Aadhaar eSign (dev stand-in): production redirects to NSDL/Protean's
 * eSign flow (Aadhaar OTP at the provider, signature returned in the
 * callback). Dev accepts any 6-digit OTP so the two-party flow is testable.
 */
app.post('/v1/shipments/:id/contract/sign', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  const as = req.body?.as;
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if ((as !== 'dealer' && as !== 'driver') || !/^\d{6}$/.test(otp)) {
    res.status(400).json({ error: "as (dealer|driver) and a 6-digit Aadhaar OTP are required." });
    return;
  }
  if (!IS_DEV) {
    res.status(501).json({ error: 'Aadhaar eSign provider integration pending — see compliance.ts.' });
    return;
  }
  const hash = contractHash(shipment);
  const contract = shipment.contract ?? { textHash: hash, signedByDealerAt: null, signedByDriverAt: null };
  if (contract.textHash !== hash) {
    res.status(409).json({ error: 'Contract text changed since first signature — re-issue required.' });
    return;
  }
  if (as === 'dealer') contract.signedByDealerAt = contract.signedByDealerAt ?? Date.now();
  else contract.signedByDriverAt = contract.signedByDriverAt ?? Date.now();
  shipment.contract = contract;
  const fully = contract.signedByDealerAt && contract.signedByDriverAt;
  pushEvent(shipment, fully ? `Contract fully signed (sha256 ${hash.slice(0, 12)}…)` : `Contract signed by ${as}`);
  persist();

  const counterpartId = as === 'dealer' ? shipment.driverId : shipment.dealerId;
  if (counterpartId && counterpartId !== user.id) {
    notifyUser({
      userId: counterpartId,
      kind: 'message',
      title: 'Contract signed',
      body: `${shipment.origin} → ${shipment.destination}: ${as} signed the digital LR.`,
      shipmentId: shipment.id,
    });
  }
  res.json({ shipment, contract });
});

app.post('/v1/shipments/:id/rate', requireAuth, (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  // Ratings only after the money has fully moved — no rating hostage games.
  if (shipment.stage !== 'BALANCE_RELEASED') {
    res.status(409).json({ error: 'Ratings open once the shipment is settled.' });
    return;
  }
  const stars = Number(req.body?.stars);
  const as = req.body?.as;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5 || (as !== 'dealer' && as !== 'driver')) {
    res.status(400).json({ error: "stars must be 1-5 and 'as' must be dealer|driver." });
    return;
  }
  if (as === 'dealer') shipment.ratingByDealer = stars;
  else shipment.ratingByDriver = stars;
  persist();
  res.json({ shipment });
});

/**
 * KYC (dev stand-in). Production: create a verification request with a KYC
 * provider (DigiLocker / Karza / Signzy) and set kycVerified in its
 * callback. Dev mode verifies immediately so the badge flow is testable.
 */
app.post('/v1/kyc/verify', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  if (!IS_DEV) {
    res.status(501).json({ error: 'KYC provider integration pending — see server/src/index.ts.' });
    return;
  }
  user.kycVerified = true;
  persist();
  res.json({ user });
});

// ---------------------------------------------------------------------------
// Telemetry ingestion (Feature D's server half)
// ---------------------------------------------------------------------------

function isValidPoint(p: unknown): p is TelemetryPoint {
  if (typeof p !== 'object' || p === null) return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.latitude === 'number' &&
    typeof q.longitude === 'number' &&
    typeof q.timestamp === 'number' &&
    typeof q.speed === 'number'
  );
}

app.post('/v1/telemetry/batch', requireAuth, (req, res) => {
  const points: unknown = req.body?.points;
  if (!Array.isArray(points) || !points.every(isValidPoint)) {
    res.status(400).json({ error: 'points must be an array of {latitude, longitude, timestamp, speed}.' });
    return;
  }
  const syncedAt = Date.now();
  db.telemetry.totalPoints += points.length;
  db.telemetry.lastSyncAt = syncedAt;
  db.telemetry.lastPoint = points[points.length - 1] ?? db.telemetry.lastPoint;
  persist();
  const userId = (req as AuthedRequest).user.id;
  // Fraud screening: impossible speeds and corridor deviation.
  checkTelemetryBatch(points, userId);
  // Safety scoring: the input to telemetry-priced insurance.
  recordDrivingPoints(userId, points);
  res.json({ syncedCount: points.length, syncedAt });
});

app.post('/v1/telemetry/live', requireAuth, (req, res) => {
  const point: unknown = req.body?.point;
  if (!isValidPoint(point)) {
    res.status(400).json({ error: 'point must be {latitude, longitude, timestamp, speed}.' });
    return;
  }
  db.telemetry.totalPoints += 1;
  db.telemetry.lastPoint = point;
  persist();
  res.json({ ok: true });
});

app.get('/v1/telemetry/stats', requireAuth, (_req, res) => {
  res.json(db.telemetry);
});

// ---------------------------------------------------------------------------
// FASTag wallet
// ---------------------------------------------------------------------------

app.get('/v1/fastag', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  res.json(wallet(user.id));
});

/**
 * Step 1 of a real top-up: hand the app a UPI deep link to open in the
 * user's UPI app. Step 2 (crediting the wallet) should arrive via the PSP
 * webhook in production; the /topup endpoint below stands in until then.
 */
app.post('/v1/fastag/topup/intent', requireAuth, (req, res) => {
  const amount = Number(req.body?.amountInr);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    res.status(400).json({ error: 'amountInr must be between 1 and 1,00,000.' });
    return;
  }
  res.json({ ...buildUpiIntent(Math.round(amount), 'FASTag top-up'), amountInr: Math.round(amount) });
});

app.post('/v1/fastag/topup', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const amount = Number(req.body?.amountInr);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    res.status(400).json({ error: 'amountInr must be between 1 and 1,00,000.' });
    return;
  }
  // Production path: create a UPI collect request / payment-gateway order
  // here and credit the wallet in the payment webhook, not inline.
  const w = wallet(user.id);
  const upiRef = `UPI${Date.now()}${Math.round(amount)}`;
  w.balanceInr += Math.round(amount);
  w.transactions.unshift({
    id: upiRef,
    label: `Top-up via UPI (${upiRef.slice(0, 10)}…)`,
    amountInr: Math.round(amount),
    at: Date.now(),
  });
  persist();
  res.json({ upiRef, balanceInr: w.balanceInr, transactions: w.transactions });
});

/**
 * Simulate a toll debit — the trigger the auto-recharge rule reacts to.
 * Real deployments debit on the NHAI/bank webhook and then call
 * applyAutoRecharge; this endpoint lets the app demo the whole loop.
 */
app.post('/v1/fastag/toll', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const amount = Number(req.body?.amountInr);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amountInr must be a positive toll amount.' });
    return;
  }
  const w = wallet(user.id);
  w.balanceInr -= Math.round(amount);
  w.transactions.unshift({
    id: newId('ft'),
    label: typeof req.body?.plaza === 'string' ? `Toll — ${req.body.plaza}` : 'Toll plaza',
    amountInr: -Math.round(amount),
    at: Date.now(),
  });
  const before = w.balanceInr;
  applyAutoRecharge(w);
  persist();
  res.json({
    balanceInr: w.balanceInr,
    transactions: w.transactions,
    autoRecharged: w.balanceInr !== before,
  });
});

// ---------------------------------------------------------------------------
// Push token registration + in-app notifications
// ---------------------------------------------------------------------------

app.put('/v1/push/token', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const token = req.body?.token;
  user.pushToken = typeof token === 'string' && token.length > 0 ? token : null;
  persist();
  res.json({ ok: true });
});

app.get('/v1/notifications', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const mine = db.notifications.filter((n) => n.userId === user.id).slice(0, 50);
  res.json({ notifications: mine, unread: mine.filter((n) => !n.read).length });
});

app.post('/v1/notifications/read', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  for (const n of db.notifications) {
    if (n.userId === user.id) n.read = true;
  }
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// In-app chat with number masking. Messages are keyed by shipment; the API
// never returns the counterpart's phone. "Calls" go through a masked proxy
// number (production: a telephony bridge like Exotel/Knowlarity/Twilio).
// ---------------------------------------------------------------------------

function shipmentParty(shipment: EscrowShipment, userId: string): 'dealer' | 'driver' | null {
  if (shipment.dealerId === userId) return 'dealer';
  if (shipment.driverId === userId) return 'driver';
  return null;
}

app.get('/v1/shipments/:id/messages', requireAuth, (req, res) => {
  const messages = db.messages
    .filter((m) => m.shipmentId === req.params.id)
    .sort((a, b) => a.at - b.at);
  res.json({ messages });
});

app.post('/v1/shipments/:id/messages', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1000) : '';
  if (!text) {
    res.status(400).json({ error: 'Message text is required.' });
    return;
  }
  // Fall back to the acting user's role when the shipment isn't linked to
  // them (demo/seed data) so chat still works end to end.
  const role = shipmentParty(shipment, user.id) ?? user.role ?? 'dealer';
  const message: ChatMessage = {
    id: newId('msg'),
    shipmentId: shipment.id,
    senderId: user.id,
    senderRole: role,
    text,
    at: Date.now(),
  };
  db.messages.push(message);
  persist();

  const counterpartId = role === 'dealer' ? shipment.driverId : shipment.dealerId;
  if (counterpartId && counterpartId !== user.id) {
    // Live chat: deliver the message itself over SSE, then the notification.
    pushEventTo(counterpartId, 'message', message);
    notifyUser({
      userId: counterpartId,
      kind: 'message',
      title: `New message · ${shipment.origin} → ${shipment.destination}`,
      body: text.slice(0, 80),
      shipmentId: shipment.id,
    });
  }
  res.status(201).json({ message });
});

/** Masked-call proxy: returns a bridge number, never the real one. */
app.get('/v1/shipments/:id/call', requireAuth, (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  // Production: provision a masked number from the telephony provider that
  // bridges the two parties for this shipment only. Demo: a stable
  // deterministic proxy so the UI has something real to dial.
  const suffix = shipment.id.replace(/\D/g, '').slice(-4).padStart(4, '0');
  res.json({ maskedNumber: `+91 80 4718 ${suffix}`, expiresInMinutes: 30 });
});

// ---------------------------------------------------------------------------
// Dispute resolution. An open dispute freezes the escrow (release checks
// shipment.disputeId). Raise → under_review → resolved with an outcome.
// ---------------------------------------------------------------------------

const DISPUTE_REASONS: DisputeReason[] = [
  'damaged_goods',
  'late_delivery',
  'shortage',
  'wrong_pod',
  'other',
];

app.get('/v1/disputes', requireAuth, (_req, res) => {
  res.json({ disputes: db.disputes });
});

app.post('/v1/shipments/:id/dispute', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (shipment.stage === 'BALANCE_RELEASED') {
    res.status(409).json({ error: 'Shipment already settled — cannot dispute.' });
    return;
  }
  if (shipment.disputeId) {
    res.status(409).json({ error: 'A dispute is already open on this shipment.' });
    return;
  }
  const reason = req.body?.reason as DisputeReason;
  if (!DISPUTE_REASONS.includes(reason)) {
    res.status(400).json({ error: `reason must be one of ${DISPUTE_REASONS.join(', ')}.` });
    return;
  }
  const dispute: Dispute = {
    id: newId('dsp'),
    shipmentId: shipment.id,
    raisedByRole: shipmentParty(shipment, user.id) ?? user.role ?? 'dealer',
    reason,
    detail: typeof req.body?.detail === 'string' ? req.body.detail.slice(0, 500) : '',
    status: 'open',
    resolution: null,
    at: Date.now(),
    resolvedAt: null,
  };
  db.disputes.unshift(dispute);
  shipment.disputeId = dispute.id;
  pushEvent(shipment, `Dispute raised: ${reason.replace('_', ' ')}`);
  persist();

  const counterpartId =
    dispute.raisedByRole === 'dealer' ? shipment.driverId : shipment.dealerId;
  if (counterpartId && counterpartId !== user.id) {
    notifyUser({
      userId: counterpartId,
      kind: 'dispute_raised',
      title: 'Dispute raised on your shipment',
      body: `${shipment.origin} → ${shipment.destination}: ${reason.replace('_', ' ')}. Escrow is on hold.`,
      shipmentId: shipment.id,
    });
  }
  res.status(201).json({ dispute, shipment });
});

app.post('/v1/disputes/:id/resolve', requireAuth, (req, res) => {
  const dispute = db.disputes.find((d) => d.id === req.params.id);
  if (!dispute) {
    res.status(404).json({ error: 'Dispute not found.' });
    return;
  }
  const resolution = req.body?.resolution;
  if (!['released', 'refunded', 'partial', 'dismissed'].includes(resolution)) {
    res.status(400).json({ error: 'resolution must be released|refunded|partial|dismissed.' });
    return;
  }
  dispute.status = 'resolved';
  dispute.resolution = resolution;
  dispute.resolvedAt = Date.now();
  const shipment = db.shipments.find((s) => s.id === dispute.shipmentId);
  if (shipment) {
    shipment.disputeId = null; // unfreeze the escrow
    pushEvent(shipment, `Dispute resolved: ${resolution}`);
    for (const uid of [shipment.dealerId, shipment.driverId]) {
      if (uid) {
        notifyUser({
          userId: uid,
          kind: 'dispute_resolved',
          title: 'Dispute resolved',
          body: `${shipment.origin} → ${shipment.destination}: ${resolution}. Escrow unfrozen.`,
          shipmentId: shipment.id,
        });
      }
    }
  }
  persist();
  res.json({ dispute, shipment });
});

// ---------------------------------------------------------------------------
// FASTag auto-recharge rule + rule-aware top-up
// ---------------------------------------------------------------------------

app.put('/v1/fastag/autorecharge', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const w = wallet(user.id);
  const enabled = Boolean(req.body?.enabled);
  const thresholdInr = Number(req.body?.thresholdInr);
  const topUpInr = Number(req.body?.topUpInr);
  if (enabled && (!Number.isFinite(thresholdInr) || thresholdInr < 0 || !Number.isFinite(topUpInr) || topUpInr <= 0)) {
    res.status(400).json({ error: 'thresholdInr (>=0) and topUpInr (>0) are required when enabling.' });
    return;
  }
  w.autoRecharge = {
    enabled,
    thresholdInr: Math.round(thresholdInr) || 300,
    topUpInr: Math.round(topUpInr) || 500,
  };
  persist();
  res.json({ autoRecharge: w.autoRecharge });
});

// ---------------------------------------------------------------------------
// Fuel prices (driver feature). Reference data served from code — swap the
// constant for a fuel-price API (e.g. a state-wise scraper or data vendor)
// without touching the route.
// ---------------------------------------------------------------------------

const FUEL_PRICES: FuelPrice[] = [
  { city: 'Delhi', state: 'Delhi', dieselInrPerLitre: 87.62, updatedAt: Date.now() },
  { city: 'Gurugram', state: 'Haryana', dieselInrPerLitre: 90.05, updatedAt: Date.now() },
  { city: 'Behror', state: 'Rajasthan', dieselInrPerLitre: 89.32, updatedAt: Date.now() },
  { city: 'Kotputli', state: 'Rajasthan', dieselInrPerLitre: 89.51, updatedAt: Date.now() },
  { city: 'Jaipur', state: 'Rajasthan', dieselInrPerLitre: 89.94, updatedAt: Date.now() },
];

app.get('/v1/fuel/prices', requireAuth, (_req, res) => {
  res.json({ prices: FUEL_PRICES });
});

// ---------------------------------------------------------------------------
// SOS alerts (driver feature). POST creates an alert with the last known
// position; production fan-out (dealer push notification, ops dashboard,
// SMS to the emergency contact) hangs off this record.
// ---------------------------------------------------------------------------

app.post('/v1/sos', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null;
  const alert = {
    id: newId('sos'),
    userId: user.id,
    phone: user.phone,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    note,
    at: Date.now(),
    resolvedAt: null,
  };
  db.sosAlerts.unshift(alert);
  persist();
  console.warn(`[SOS] ${user.phone} at ${alert.latitude},${alert.longitude} (${alert.id})`);
  res.status(201).json({ id: alert.id, at: alert.at });
});

app.post('/v1/sos/:id/resolve', requireAuth, (req, res) => {
  const alert = db.sosAlerts.find((a) => a.id === req.params.id);
  if (!alert) {
    res.status(404).json({ error: 'Alert not found.' });
    return;
  }
  alert.resolvedAt = alert.resolvedAt ?? Date.now();
  persist();
  res.json({ ok: true });
});

app.get('/v1/sos', requireAuth, (_req, res) => {
  res.json({ alerts: db.sosAlerts.filter((a) => a.resolvedAt === null) });
});

// ---------------------------------------------------------------------------
// WhatsApp webhook (Meta Cloud API). GET = Meta's verification handshake;
// POST = inbound messages. A dealer can post a load by messaging
// "LOAD Delhi to Jaipur, 18 ton cement, 42000" — the sender's phone maps to
// their TruckSetu account, and the reply confirms with the LR number.
// ---------------------------------------------------------------------------

app.get('/v1/whatsapp/webhook', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === WHATSAPP_VERIFY_TOKEN
  ) {
    res.send(req.query['hub.challenge']);
    return;
  }
  res.status(403).json({ error: 'Verification failed.' });
});

/** Shared handler so the dev simulate endpoint drives the same code path. */
async function handleInboundWhatsApp(fromRaw: string, text: string): Promise<string> {
  const phone = normalizePhone(fromRaw) ?? fromRaw;
  const user = db.users.find((u) => u.phone === phone);

  if (/^stop$/i.test(text.trim())) {
    if (user) {
      user.whatsappOptIn = false;
      persist();
    }
    return 'You will no longer receive TruckSetu updates on WhatsApp.';
  }

  if (/^status$/i.test(text.trim())) {
    const latest = db.shipments.find(
      (s) => s.dealerId === user?.id || s.driverId === user?.id,
    ) ?? db.shipments[0];
    return latest
      ? `Latest shipment ${latest.origin} → ${latest.destination}: ${latest.stage.replace(/_/g, ' ')}.`
      : 'No shipments yet.';
  }

  const parsed = parseLoadMessage(text);
  if (!parsed) return WHATSAPP_HELP_REPLY;
  if (!user) {
    return 'This number is not registered on TruckSetu yet — download the app and log in once, then post loads right here.';
  }

  const load: Load = {
    id: newId('load'),
    ...parsed,
    advancePercent: 70,
    status: 'open',
    bids: [],
    postedAt: Date.now(),
    consignmentNo: `LR-${Math.floor(10000 + Math.random() * 90000)}`,
    dealerId: user.id,
  };
  db.loads.unshift(load);
  persist();
  return `✅ Load posted: ${load.origin} → ${load.destination}, ${load.weightTonnes}T ${load.material}, ₹${load.priceInr} (${load.consignmentNo}). Bids will arrive in your TruckSetu app.`;
}

app.post('/v1/whatsapp/webhook', async (req, res) => {
  // Meta's envelope: entry[].changes[].value.messages[]
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (message?.type === 'text' && typeof message.from === 'string') {
    const reply = await handleInboundWhatsApp(message.from, message.text?.body ?? '');
    void sendWhatsApp(normalizePhone(message.from) ?? message.from, reply);
  }
  res.json({ ok: true }); // always 200 — Meta retries non-2xx aggressively
});

/** Dev stand-in for Meta: inject an inbound message, get the reply back. */
app.post('/v1/whatsapp/simulate-inbound', async (req, res) => {
  if (!IS_DEV) {
    res.status(403).json({ error: 'Dev only.' });
    return;
  }
  const { from, text } = req.body ?? {};
  if (typeof from !== 'string' || typeof text !== 'string') {
    res.status(400).json({ error: 'from and text are required.' });
    return;
  }
  const reply = await handleInboundWhatsApp(from, text);
  void sendWhatsApp(normalizePhone(from) ?? from, reply);
  res.json({ reply });
});

/** Outbox inspection (dev): what would have gone to WhatsApp. */
app.get('/v1/whatsapp/outbox', requireAuth, (_req, res) => {
  res.json({ mode: whatsappMode, outbox: db.whatsappOutbox.slice(0, 20) });
});

// ---------------------------------------------------------------------------
// Payment-provider webhook (Razorpay). Signature-verified; unauthenticated
// by design (the PSP calls it), which is exactly why the HMAC check matters.
// ---------------------------------------------------------------------------

app.post('/v1/payments/webhook', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? (IS_DEV ? 'dev-webhook-secret' : null);
  if (!secret) {
    res.status(503).json({ error: 'Webhook secret not configured.' });
    return;
  }
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = (req as express.Request & { rawBody?: string }).rawBody ?? '';
  if (typeof signature !== 'string' || !verifyWebhookSignature(rawBody, signature, secret)) {
    res.status(401).json({ error: 'Invalid webhook signature.' });
    return;
  }
  const event = (req.body ?? {}) as { event?: string };
  // Handle the events you subscribe to: payment.captured → credit the
  // FASTag wallet / mark escrow funded; payout.processed → confirm the
  // driver payout landed. Foundation logs and acknowledges.
  console.log(`[webhook] verified event: ${event.event ?? 'unknown'}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Ops console: HTML desk + summary + action endpoints, guarded by OPS_KEY.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Marketplace — network effects. Every endpoint here returns better numbers
// as liquidity grows, which is the point: the mechanics are copyable, the
// density that makes them work is not.
// ---------------------------------------------------------------------------

/** One call powers the driver's marketplace surface. */
app.get('/v1/market/summary', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const city =
    typeof req.query.city === 'string' && req.query.city
      ? req.query.city
      : (db.shipments.find((s) => s.driverId === user.id && s.stage !== 'BALANCE_RELEASED')
          ?.destination ?? 'Jaipur');

  res.json({
    city,
    guarantee: guaranteeOffer(city),
    activeGuarantee: activeGuaranteeFor(user.id),
    lanes: laneDensities(),
    chain: buildChain(city),
    consolidation: consolidationGroups(),
  });
});

/** Opt into the assured return load for the city the driver is heading to. */
app.post('/v1/market/guarantee', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const shipment = db.shipments.find((s) => s.id === req.body?.shipmentId);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  const offer = guaranteeOffer(shipment.destination);
  if (!offer.available) {
    res.status(409).json({ error: offer.reason });
    return;
  }
  if (db.returnGuarantees.some((g) => g.driverId === user.id && g.status === 'active')) {
    res.status(409).json({ error: 'You already have an active return guarantee.' });
    return;
  }
  const guarantee = openGuarantee(user.id, shipment.destination, shipment.id);
  notifyUser({
    userId: user.id,
    kind: 'message',
    title: 'Return load guaranteed',
    body: `We will find you a load out of ${shipment.destination} within ${offer.windowHours}h, or pay you ₹${offer.standbyFeeInr} standby.`,
    shipmentId: shipment.id,
  });
  res.status(201).json({ guarantee });
});

/** Claim the standby fee once the window has lapsed unfulfilled. */
app.post('/v1/market/guarantee/:id/claim', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest;
  const guarantee = db.returnGuarantees.find(
    (g) => g.id === req.params.id && g.driverId === user.id,
  );
  if (!guarantee) {
    res.status(404).json({ error: 'Guarantee not found.' });
    return;
  }
  settleGuarantee(guarantee);
  if (guarantee.status === 'fulfilled') {
    res.status(409).json({ error: 'A return load was booked — the guarantee was honoured.' });
    return;
  }
  if (guarantee.status !== 'standby_due') {
    const hoursLeft = Math.max(0, Math.ceil((guarantee.expiresAt - Date.now()) / 3600000));
    res.status(409).json({ error: `Still searching — ${hoursLeft}h left in the window.` });
    return;
  }
  try {
    await executePayout('balance', `standby-${guarantee.id}`, guarantee.standbyFeeInr);
  } catch (error) {
    console.error('[market] standby payout failed', error);
    res.status(502).json({ error: 'Standby payout failed — try again.' });
    return;
  }
  guarantee.status = 'paid';
  guarantee.paidAt = Date.now();
  persist();
  res.json({ guarantee, paidInr: guarantee.standbyFeeInr });
});

/** Book a chained round trip as one contract. */
app.post('/v1/market/chain', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const startCity = typeof req.body?.startCity === 'string' ? req.body.startCity : '';
  const quote = startCity ? buildChain(startCity) : null;
  if (!quote) {
    res.status(409).json({ error: 'Not enough open loads to chain a trip from there yet.' });
    return;
  }
  const truckNumber =
    typeof req.body?.truckNumber === 'string' ? req.body.truckNumber : 'TS 00 XX 0000';
  const shipments: EscrowShipment[] = [];
  const chainId = newId('chn');

  quote.legs.forEach((leg, i) => {
    const load = db.loads.find((l) => l.id === leg.loadId);
    if (!load || load.status !== 'open') return;
    load.status = 'booked';
    // The driver's uplift is spread across the legs pro rata.
    const legPayout = Math.round(
      (leg.priceInr / quote.separateTotalInr) * quote.driverPayoutInr,
    );
    const shipment: EscrowShipment = {
      id: newId('shp'),
      loadId: load.id,
      origin: load.origin,
      destination: load.destination,
      driverName: user.name ?? 'Driver',
      truckNumber,
      totalAmountInr: legPayout,
      advancePercent: load.advancePercent,
      stage: 'CREATED',
      pod: null,
      consignmentNo: load.consignmentNo,
      disputeId: null,
      insured: load.insured,
      chainId,
      chainLeg: i + 1,
      chainLegs: quote.legs.length,
      events: [
        {
          stage: 'CREATED',
          label: `Chained trip leg ${i + 1}/${quote.legs.length} — ${load.origin} → ${load.destination}`,
          at: Date.now(),
        },
      ],
      dealerId: load.dealerId,
      driverId: user.id,
    };
    db.shipments.unshift(shipment);
    shipments.push(shipment);
  });

  if (shipments.length === 0) {
    res.status(409).json({ error: 'Those loads were taken — refresh and try again.' });
    return;
  }
  persist();
  res.status(201).json({ chainId, quote, shipments });
});

/** Public: the TruckSetu lane rate index. No auth — that is the point. */
app.get('/v1/index/lanes', (_req, res) => {
  res.json(laneIndex());
});

// ---------------------------------------------------------------------------
// TruckSetu Money — the lending flywheel.
//
// Underwriting runs on platform data (escrow history, PODs, disputes,
// telemetry) rather than bureau files, and repayment is senior because the
// instalments come out of the borrower's own escrow release. Disbursal and
// collection route through the existing payments module, so switching from
// simulated to a real NBFC partner is a credentials change, not a rewrite.
// ---------------------------------------------------------------------------

/** One call powers the whole Money screen. */
app.get('/v1/money/summary', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const score = scoreFor(user.id, user.role ?? null);
  const facility = ensureFacility(user.id, user.role ?? null);
  const card = ensureFuelCard(user.id);
  const driving = drivingScore(user.id);

  // Dealer receivables that are eligible for day-1 discounting: settled
  // shipments that have not already been advanced against.
  const advancedIds = new Set(db.advances.map((a) => a.shipmentId));
  const discountable = db.shipments
    .filter(
      (s) =>
        s.dealerId === user.id &&
        s.stage === 'BALANCE_RELEASED' &&
        !advancedIds.has(s.id) &&
        !s.disputeId,
    )
    .map((s) => ({
      shipmentId: s.id,
      invoiceNo: `TS-INV-${s.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`,
      route: `${s.origin} → ${s.destination}`,
      faceValueInr: invoiceFaceValue(s),
      quote30: quoteDiscount(s, 30),
      quote60: quoteDiscount(s, 60),
    }));

  res.json({
    score,
    driving,
    facility: {
      limitInr: facility.limitInr,
      drawnInr: facility.drawnInr,
      availableInr: Math.max(0, facility.limitInr - facility.drawnInr),
      aprPercent: facility.aprPercent,
      draws: facility.draws.slice(0, 10),
      repayments: facility.repayments.slice(0, 10),
    },
    fuelCard: card,
    pumps: PARTNER_PUMPS,
    emiCatalogue: EMI_CATALOGUE,
    emis: db.emis.filter((e) => e.userId === user.id),
    advances: db.advances.filter((a) => a.userId === user.id),
    discountable,
    vehicleLoans: db.vehicleLoans.filter((l) => l.userId === user.id),
    policies: db.policies.filter((p) => p.userId === user.id),
    insuranceQuote: insuranceQuote(user.id, 800000),
    bureauConsent: user.bureauConsent === true,
  });
});

/** Bill discounting: dealer is paid on day 1, TruckSetu collects at maturity. */
app.post('/v1/money/discount', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest;
  const shipment = db.shipments.find((s) => s.id === req.body?.shipmentId);
  const termDays = Number(req.body?.termDays);
  if (!shipment) {
    res.status(404).json({ error: 'Shipment not found.' });
    return;
  }
  if (termDays !== 30 && termDays !== 60) {
    res.status(400).json({ error: 'termDays must be 30 or 60.' });
    return;
  }
  if (shipment.stage !== 'BALANCE_RELEASED') {
    res.status(409).json({ error: 'Only a settled shipment has a receivable to discount.' });
    return;
  }
  if (db.advances.some((a) => a.shipmentId === shipment.id)) {
    res.status(409).json({ error: 'This invoice has already been discounted.' });
    return;
  }
  const quote = quoteDiscount(shipment, termDays);
  try {
    await executePayout('balance', shipment.id, quote.netInr);
  } catch (error) {
    console.error('[money] discount disbursal failed', error);
    res.status(502).json({ error: 'Disbursal failed — try again.' });
    return;
  }
  const advance: InvoiceAdvance = {
    id: newId('adv'),
    userId: user.id,
    shipmentId: shipment.id,
    invoiceNo: `TS-INV-${shipment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`,
    faceValueInr: quote.faceValueInr,
    feeInr: quote.feeInr,
    netInr: quote.netInr,
    termDays,
    dueAt: quote.dueAt,
    status: 'advanced',
    at: Date.now(),
  };
  db.advances.unshift(advance);
  pushEvent(shipment, `Invoice discounted: ₹${quote.netInr} paid now (fee ₹${quote.feeInr})`);
  persist();
  res.status(201).json({ advance });
});

/** Draw on the revolving working-capital line. */
app.post('/v1/money/credit/draw', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest;
  const amountInr = Math.round(Number(req.body?.amountInr));
  const facility = ensureFacility(user.id, user.role ?? null);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    res.status(400).json({ error: 'amountInr must be a positive number.' });
    return;
  }
  const available = facility.limitInr - facility.drawnInr;
  if (amountInr > available) {
    res.status(409).json({ error: `Only ₹${available} available on your line.` });
    return;
  }
  let referenceId: string;
  try {
    ({ referenceId } = await executePayout('balance', `credit-${user.id}`, amountInr));
  } catch (error) {
    console.error('[money] credit draw failed', error);
    res.status(502).json({ error: 'Disbursal failed — try again.' });
    return;
  }
  facility.drawnInr += amountInr;
  facility.draws.unshift({ id: newId('drw'), amountInr, at: Date.now(), referenceId });
  facility.updatedAt = Date.now();
  persist();
  res.status(201).json({ facility, referenceId });
});

app.post('/v1/money/credit/repay', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const amountInr = Math.round(Number(req.body?.amountInr));
  const facility = ensureFacility(user.id, user.role ?? null);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    res.status(400).json({ error: 'amountInr must be a positive number.' });
    return;
  }
  const applied = Math.min(amountInr, facility.drawnInr);
  facility.drawnInr -= applied;
  facility.repayments.unshift({ id: newId('rep'), amountInr: applied, at: Date.now(), source: 'manual' });
  facility.updatedAt = Date.now();
  persist();
  res.json({ facility, appliedInr: applied });
});

/** Point-of-need EMI: tyres, repairs, batteries — repaid from escrow. */
app.post('/v1/money/emi', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const item = EMI_CATALOGUE.find((i) => i.id === req.body?.itemId);
  const tenorMonths = Math.round(Number(req.body?.tenorMonths));
  if (!item) {
    res.status(400).json({ error: `itemId must be one of ${EMI_CATALOGUE.map((i) => i.id).join(', ')}.` });
    return;
  }
  if (![3, 6, 9, 12].includes(tenorMonths)) {
    res.status(400).json({ error: 'tenorMonths must be 3, 6, 9 or 12.' });
    return;
  }
  const score = scoreFor(user.id, user.role ?? null).score;
  if (score < 480) {
    res.status(409).json({
      error: 'Build your TruckScore above 480 with settled trips to unlock EMIs.',
    });
    return;
  }
  const plan = createEmiPlan(user.id, item.id, item.label, item.priceInr, tenorMonths);
  notifyUser({
    userId: user.id,
    kind: 'message',
    title: 'EMI approved',
    body: `${item.label}: ₹${plan.monthlyInr}/month for ${tenorMonths} months, auto-paid from your trip settlements.`,
  });
  res.status(201).json({ plan });
});

/** Co-branded fuel card: rebate per litre plus cashback at partner pumps. */
app.get('/v1/money/fuelcard', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ card: ensureFuelCard(user.id), pumps: PARTNER_PUMPS });
});

app.post('/v1/money/fuelcard/swipe', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const litres = Number(req.body?.litres);
  const pump = typeof req.body?.pump === 'string' ? req.body.pump : PARTNER_PUMPS[0].name;
  if (!Number.isFinite(litres) || litres <= 0 || litres > 500) {
    res.status(400).json({ error: 'litres must be between 1 and 500.' });
    return;
  }
  const card = ensureFuelCard(user.id);
  const projected = card.outstandingInr + Math.round(litres * 90);
  if (projected > card.creditLimitInr) {
    res.status(409).json({ error: `Fuel card limit ₹${card.creditLimitInr} would be exceeded.` });
    return;
  }
  const result = swipeFuelCard(user.id, pump, litres);
  res.status(201).json({ ...result, card: db.fuelCards[user.id] });
});

/** Truck purchase / refinance — score-priced APR. */
app.get('/v1/money/vehicle-loan/quote', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const amountInr = Math.round(Number(req.query.amountInr ?? 1200000));
  const tenorMonths = Math.round(Number(req.query.tenorMonths ?? 48));
  if (!Number.isFinite(amountInr) || amountInr <= 0 || !Number.isFinite(tenorMonths) || tenorMonths < 6) {
    res.status(400).json({ error: 'amountInr and tenorMonths (>= 6) are required.' });
    return;
  }
  const score = scoreFor(user.id, user.role ?? null).score;
  res.json(vehicleLoanQuote(score, amountInr, tenorMonths));
});

app.post('/v1/money/vehicle-loan/apply', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const amountInr = Math.round(Number(req.body?.amountInr));
  const tenorMonths = Math.round(Number(req.body?.tenorMonths));
  const purpose = req.body?.purpose === 'refinance' ? 'refinance' : 'purchase';
  if (!Number.isFinite(amountInr) || amountInr <= 0 || !Number.isFinite(tenorMonths) || tenorMonths < 6) {
    res.status(400).json({ error: 'amountInr and tenorMonths (>= 6) are required.' });
    return;
  }
  const score = scoreFor(user.id, user.role ?? null).score;
  const quote = vehicleLoanQuote(score, amountInr, tenorMonths);
  const application: VehicleLoanApplication = {
    id: newId('vl'),
    userId: user.id,
    purpose,
    amountInr,
    tenorMonths,
    aprPercent: quote.aprPercent,
    emiInr: quote.emiInr,
    // In-principle decision from the platform's own data; the lending
    // partner's final sanction follows KYC + vehicle valuation.
    status: quote.eligible ? 'approved' : 'rejected',
    at: Date.now(),
  };
  db.vehicleLoans.unshift(application);
  persist();
  res.status(201).json({ application, quote });
});

/** Insurance priced on telemetry the platform already owns. */
app.get('/v1/money/insurance/quote', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const sumInsuredInr = Math.round(Number(req.query.sumInsuredInr ?? 800000));
  if (!Number.isFinite(sumInsuredInr) || sumInsuredInr <= 0) {
    res.status(400).json({ error: 'sumInsuredInr must be a positive number.' });
    return;
  }
  res.json(insuranceQuote(user.id, sumInsuredInr));
});

app.post('/v1/money/insurance/renew', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const sumInsuredInr = Math.round(Number(req.body?.sumInsuredInr ?? 800000));
  if (!Number.isFinite(sumInsuredInr) || sumInsuredInr <= 0) {
    res.status(400).json({ error: 'sumInsuredInr must be a positive number.' });
    return;
  }
  const quote = insuranceQuote(user.id, sumInsuredInr);
  const policy = {
    id: newId('pol'),
    userId: user.id,
    sumInsuredInr,
    basePremiumInr: quote.basePremiumInr,
    discountPercent: quote.discountPercent,
    premiumInr: quote.premiumInr,
    validUntil: Date.now() + 365 * 24 * 3600 * 1000,
    at: Date.now(),
  };
  db.policies.unshift(policy);
  persist();
  res.status(201).json({ policy });
});

/** Consent gate for the bureau — the user owns their score. */
app.put('/v1/money/bureau/consent', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  user.bureauConsent = req.body?.granted === true;
  persist();
  res.json({ bureauConsent: user.bureauConsent });
});

// ---------------------------------------------------------------------------
// TruckScore bureau — lending partners query scores for a fee. Turning the
// score into an industry reference is itself the moat: rivals end up pricing
// their own risk off TruckSetu's data.
// ---------------------------------------------------------------------------

const BUREAU_KEY = process.env.BUREAU_API_KEY ?? 'trucksetu-bureau-dev';

app.get('/v1/bureau/score', (req, res) => {
  const key = req.header('X-Bureau-Key') ?? '';
  const partner = req.header('X-Bureau-Partner') ?? 'unknown';
  if (key !== BUREAU_KEY) {
    res.status(401).json({ error: 'Invalid bureau API key.' });
    return;
  }
  const phone = normalizePhone(req.query.phone);
  if (!phone) {
    res.status(400).json({ error: 'phone (10-digit) is required.' });
    return;
  }
  const subject = db.users.find((u) => u.phone === phone);
  // Consent is mandatory — no consent, no score, and the attempt is audited.
  if (!subject || subject.bureauConsent !== true) {
    db.bureauQueries.unshift({
      id: newId('bq'),
      partner,
      subjectPhone: phone,
      score: null,
      feeInr: 0,
      at: Date.now(),
    });
    persist();
    res.status(403).json({ error: 'No consent on record for this subject.' });
    return;
  }
  const score = scoreFor(subject.id, subject.role ?? null);
  const driving = drivingScore(subject.id);
  db.bureauQueries.unshift({
    id: newId('bq'),
    partner,
    subjectPhone: phone,
    score: score.score,
    feeInr: MONEY.BUREAU_QUERY_FEE_INR,
    at: Date.now(),
  });
  if (db.bureauQueries.length > 500) db.bureauQueries.length = 500;
  persist();
  res.json({
    subjectPhone: phone,
    truckScore: score.score,
    band: score.band,
    factors: score.factors,
    drivingScore: driving?.score ?? null,
    settledTrips: db.shipments.filter(
      (s) => s.driverId === subject.id && s.stage === 'BALANCE_RELEASED',
    ).length,
    queryFeeInr: MONEY.BUREAU_QUERY_FEE_INR,
    generatedAt: Date.now(),
  });
});

app.get('/ops', (req, res) => {
  if (!opsAuthorized(req)) {
    res.status(401).send('Add ?key=<OPS_KEY> to the URL.');
    return;
  }
  res.type('html').send(OPS_CONSOLE_HTML);
});

app.get('/v1/ops/summary', (req, res) => {
  if (!opsAuthorized(req)) {
    res.status(401).json({ error: 'Bad ops key.' });
    return;
  }
  res.json({
    sseClients: connectedClientCount(),
    userCount: db.users.length,
    sos: db.sosAlerts.filter((a) => a.resolvedAt === null),
    disputes: db.disputes.filter((d) => d.status !== 'resolved'),
    fraud: db.fraudAlerts.slice(0, 20),
    kycPending: db.users.filter((u) => !u.kycVerified).map((u) => ({
      id: u.id,
      phone: u.phone,
      name: u.name,
      role: u.role,
    })),
    whatsapp: db.whatsappOutbox.slice(0, 10),
    bureau: db.bureauQueries.slice(0, 10),
    /** Money book: what the platform has lent and earned. */
    money: {
      drawnInr: Object.values(db.credit).reduce((a, f) => a + f.drawnInr, 0),
      activeEmis: db.emis.filter((e) => e.status === 'active').length,
      emiOutstandingInr: db.emis.reduce((a, e) => a + e.outstandingInr, 0),
      advancedInr: db.advances.reduce((a, x) => a + x.netInr, 0),
      discountFeesInr: db.advances.reduce((a, x) => a + x.feeInr, 0),
      bureauFeesInr: db.bureauQueries.reduce((a, q) => a + q.feeInr, 0),
    },
  });
});

app.post('/v1/ops/sos/:id/resolve', (req, res) => {
  if (!opsAuthorized(req)) {
    res.status(401).json({ error: 'Bad ops key.' });
    return;
  }
  const alert = db.sosAlerts.find((a) => a.id === req.params.id);
  if (alert) {
    alert.resolvedAt = alert.resolvedAt ?? Date.now();
    persist();
  }
  res.json({ ok: true });
});

app.post('/v1/ops/disputes/:id/resolve', (req, res) => {
  if (!opsAuthorized(req)) {
    res.status(401).json({ error: 'Bad ops key.' });
    return;
  }
  const dispute = db.disputes.find((d) => d.id === req.params.id);
  const resolution = req.query.resolution;
  if (!dispute || !['released', 'refunded', 'partial', 'dismissed'].includes(String(resolution))) {
    res.status(400).json({ error: 'Unknown dispute or resolution.' });
    return;
  }
  dispute.status = 'resolved';
  dispute.resolution = resolution as Dispute['resolution'];
  dispute.resolvedAt = Date.now();
  const shipment = db.shipments.find((s) => s.id === dispute.shipmentId);
  if (shipment) {
    shipment.disputeId = null;
    pushEvent(shipment, `Dispute resolved by ops: ${String(resolution)}`);
  }
  persist();
  res.json({ ok: true });
});

app.post('/v1/ops/kyc/:userId/verify', (req, res) => {
  if (!opsAuthorized(req)) {
    res.status(401).json({ error: 'Bad ops key.' });
    return;
  }
  const user = db.users.find((u) => u.id === req.params.userId);
  if (user) {
    user.kycVerified = true;
    persist();
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(
    `TruckSetu server listening on :${PORT} (${IS_DEV ? 'dev' : 'production'} mode, payments: ${paymentsMode})`,
  );
});
