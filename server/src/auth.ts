/**
 * Phone-OTP authentication with JWT sessions.
 *
 * Flow: POST /v1/auth/otp/request stores a 6-digit code against the phone
 * number (5-minute expiry, basic per-phone rate limit), then
 * POST /v1/auth/otp/verify exchanges phone+code for a JWT and creates the
 * user record on first login.
 *
 * SMS delivery is a stub (`sendSms`) — in production wire MSG91 / Twilio /
 * Firebase there. Until then, non-production responses include `devOtp` so
 * the flow is fully testable without a provider.
 */

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db, newId, persist } from './db';
import { User } from './types';

const JWT_SECRET = process.env.JWT_SECRET ?? 'trucksetu-dev-secret-change-me';
const TOKEN_TTL = '30d';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_REQUESTS = 5; // per phone per window
const OTP_WINDOW_MS = 10 * 60 * 1000;
export const IS_DEV = process.env.NODE_ENV !== 'production';

interface PendingOtp {
  code: string;
  expiresAt: number;
  attemptsLeft: number;
}

const pendingOtps = new Map<string, PendingOtp>();
const requestCounts = new Map<string, { count: number; windowStart: number }>();

/** Production integration point: MSG91 / Twilio / Firebase goes here. */
function sendSms(phone: string, message: string): void {
  console.log(`[sms→${phone}] ${message}`);
}

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d]/g, '');
  // Accept bare 10-digit Indian numbers or 12-digit with country code.
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

export function requestOtp(phone: string): { devOtp?: string } | { error: string } {
  const now = Date.now();
  const window = requestCounts.get(phone);
  if (window && now - window.windowStart < OTP_WINDOW_MS && window.count >= OTP_MAX_REQUESTS) {
    return { error: 'Too many OTP requests — try again in a few minutes.' };
  }
  if (!window || now - window.windowStart >= OTP_WINDOW_MS) {
    requestCounts.set(phone, { count: 1, windowStart: now });
  } else {
    window.count += 1;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingOtps.set(phone, { code, expiresAt: now + OTP_TTL_MS, attemptsLeft: 3 });
  sendSms(phone, `Your TruckSetu OTP is ${code}. Valid for 5 minutes.`);
  return IS_DEV ? { devOtp: code } : {};
}

export function verifyOtp(phone: string, otp: string): { token: string; user: User } | { error: string } {
  const pending = pendingOtps.get(phone);
  if (!pending || Date.now() > pending.expiresAt) {
    pendingOtps.delete(phone);
    return { error: 'OTP expired — request a new one.' };
  }
  if (pending.code !== otp) {
    pending.attemptsLeft -= 1;
    if (pending.attemptsLeft <= 0) pendingOtps.delete(phone);
    return { error: 'Incorrect OTP.' };
  }
  pendingOtps.delete(phone);

  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    user = { id: newId('usr'), phone, name: null, role: null, createdAt: Date.now() };
    db.users.push(user);
    persist();
  }
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user };
}

/** Express middleware: requires a valid Bearer token, attaches req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Unknown user' });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export interface AuthedRequest extends Request {
  user: User;
}
