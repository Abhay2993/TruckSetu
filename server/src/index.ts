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
import { AuthedRequest, IS_DEV, normalizePhone, requestOtp, requireAuth, verifyOtp } from './auth';
import { db, newId, persist } from './db';
import { buildUpiIntent, executePayout, paymentsMode, verifyWebhookSignature } from './payments';
import { Bid, EscrowShipment, FastagWallet, FuelPrice, Load, TelemetryPoint } from './types';

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
    };
    db.fastag[userId] = w;
    persist();
  }
  return w;
}

// ---------------------------------------------------------------------------
// Health & auth
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'trucksetu-server', dev: IS_DEV });
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
  persist();
  res.json({ user });
});

// ---------------------------------------------------------------------------
// Loads & bidding
// ---------------------------------------------------------------------------

app.get('/v1/loads', requireAuth, (_req, res) => {
  res.json({ loads: db.loads });
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
    placedAt: Date.now(),
  };
  load.bids.push(bid);
  persist();
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
    dealerId: user.id,
  };
  shipment.events.push({
    stage: 'CREATED',
    label: `Bid accepted — ${bid.driverName} (${bid.truckNumber})`,
    at: Date.now(),
  });
  db.shipments.unshift(shipment);
  persist();
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
  const { fileName, kind, uri } = req.body ?? {};
  if (typeof fileName !== 'string' || (kind !== 'photo' && kind !== 'document')) {
    res.status(400).json({ error: 'fileName and kind (photo|document) are required.' });
    return;
  }

  // Foundation stores POD metadata; the binary stays on-device. Production
  // path: return a presigned S3/GCS URL here, client uploads, then confirm.
  shipment.pod = {
    uri: typeof uri === 'string' ? uri : '',
    kind,
    fileName,
    uploadedAt: Date.now(),
  };
  shipment.stage = 'POD_UPLOADED';
  pushEvent(shipment, `POD uploaded (${fileName})`);
  persist();
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
  const { balanceInr } = splitAmounts(shipment);
  let referenceId: string;
  try {
    ({ referenceId } = await executePayout('balance', shipment.id, balanceInr));
  } catch (error) {
    console.error('[payments] balance payout failed', error);
    res.status(502).json({ error: 'Balance payout failed — try releasing again.' });
    return;
  }
  shipment.stage = 'BALANCE_RELEASED';
  pushEvent(shipment, `Balance released from escrow (ref ${referenceId})`);
  persist();
  res.json({ shipment });
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

app.listen(PORT, () => {
  console.log(
    `TruckSetu server listening on :${PORT} (${IS_DEV ? 'dev' : 'production'} mode, payments: ${paymentsMode})`,
  );
});
