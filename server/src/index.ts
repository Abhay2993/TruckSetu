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
import { Bid, EscrowShipment, FastagWallet, Load, TelemetryPoint } from './types';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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

app.post('/v1/shipments/:id/dispatch', requireAuth, (req, res) => {
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

  shipment.stage = 'DISPATCHED';
  pushEvent(shipment, 'Load confirmed & dispatched');

  // Stage 1 fires automatically on dispatch. This is where a real payment
  // rail (Razorpay Payouts / bank transfer to the fuel card) gets called;
  // the reference id shape matches what the app already renders.
  const referenceId = `ADV-${shipment.id}-${advanceInr}`;
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

app.post('/v1/shipments/:id/release', requireAuth, (req, res) => {
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
  const referenceId = `BAL-${shipment.id}-${balanceInr}`;
  shipment.stage = 'BALANCE_RELEASED';
  pushEvent(shipment, `Balance released from escrow (ref ${referenceId})`);
  persist();
  res.json({ shipment });
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

app.listen(PORT, () => {
  console.log(`TruckSetu server listening on :${PORT} (${IS_DEV ? 'dev' : 'production'} mode)`);
});
