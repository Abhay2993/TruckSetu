/**
 * API gateway — the single boundary between the app and the network.
 *
 * Two modes, decided once at bundle time by EXPO_PUBLIC_API_URL (src/config):
 *
 *   SERVER MODE  → every function calls the TruckSetu backend (server/)
 *                  over HTTPS with the JWT from the auth store.
 *   DEMO MODE    → functions that *fetch* return null (stores keep their
 *                  seeded local state) and functions that *mutate* simulate
 *                  latency and succeed locally — the original mock behaviour.
 *
 * Stores treat `null` as "no server — apply the local transition yourself",
 * which is what keeps the Vercel preview and offline demos fully working.
 */

import { DEMO_OTP, isServerMode } from '../config';
import type {
  AuthUser,
  EscrowShipment,
  FastagTransaction,
  FuelPrice,
  Load,
  ProofOfDelivery,
  TelemetryPoint,
  UserRole,
} from '../types';
import { ApiError, request } from './http';

const SIMULATED_LATENCY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TelemetrySyncResult {
  syncedCount: number;
  syncedAt: number;
}

export interface FastagTopUpResult {
  upiRef: string;
  /** Present in server mode — authoritative wallet state after the top-up. */
  balanceInr?: number;
  transactions?: FastagTransaction[];
}

export const api = {
  // -------------------------------------------------------------------------
  // Auth (Feature: phone-OTP login)
  // -------------------------------------------------------------------------

  async requestOtp(phone: string): Promise<{ devOtp?: string }> {
    if (isServerMode) {
      return request<{ devOtp?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: { phone },
        anonymous: true,
      });
    }
    await delay(SIMULATED_LATENCY_MS);
    return { devOtp: DEMO_OTP };
  },

  async verifyOtp(phone: string, otp: string): Promise<{ token: string; user: AuthUser }> {
    if (isServerMode) {
      return request<{ token: string; user: AuthUser }>('/v1/auth/otp/verify', {
        method: 'POST',
        body: { phone, otp },
        anonymous: true,
      });
    }
    await delay(SIMULATED_LATENCY_MS);
    if (otp !== DEMO_OTP) {
      throw new ApiError(401, `Incorrect OTP — demo mode accepts ${DEMO_OTP}.`);
    }
    return {
      token: `demo-token-${Date.now()}`,
      user: { id: 'usr-demo', phone, name: null, role: null },
    };
  },

  /** Fire-and-forget profile sync; no-op in demo mode. */
  async updateProfile(update: { name?: string; role?: UserRole }): Promise<void> {
    if (!isServerMode) return;
    await request('/v1/me', { method: 'PUT', body: update });
  },

  // -------------------------------------------------------------------------
  // Telemetry (Feature D)
  // -------------------------------------------------------------------------

  async syncTelemetryBatch(points: TelemetryPoint[]): Promise<TelemetrySyncResult> {
    if (isServerMode) {
      return request<TelemetrySyncResult>('/v1/telemetry/batch', {
        method: 'POST',
        body: { points },
      });
    }
    await delay(SIMULATED_LATENCY_MS);
    return { syncedCount: points.length, syncedAt: Date.now() };
  },

  async pushTelemetryLive(point: TelemetryPoint): Promise<void> {
    if (isServerMode) {
      await request('/v1/telemetry/live', { method: 'POST', body: { point } });
      return;
    }
    await delay(120);
  },

  // -------------------------------------------------------------------------
  // Loads & bidding (dealer side)
  // -------------------------------------------------------------------------

  async fetchLoads(): Promise<Load[] | null> {
    if (!isServerMode) return null;
    const { loads } = await request<{ loads: Load[] }>('/v1/loads');
    return loads;
  },

  /** Returns the canonical server Load, or null in demo mode. */
  async createLoad(input: {
    origin: string;
    destination: string;
    material: string;
    weightTonnes: number;
    priceInr: number;
    advancePercent: number;
  }): Promise<Load | null> {
    if (!isServerMode) return null;
    const { load } = await request<{ load: Load }>('/v1/loads', { method: 'POST', body: input });
    return load;
  },

  /** Returns the updated load + created shipment, or null in demo mode. */
  async acceptBid(loadId: string, bidId: string): Promise<{ load: Load; shipment: EscrowShipment } | null> {
    if (!isServerMode) return null;
    return request<{ load: Load; shipment: EscrowShipment }>(
      `/v1/loads/${loadId}/bids/${bidId}/accept`,
      { method: 'POST' },
    );
  },

  /** Driver-side: bid on a load (the backhaul finder's action). */
  async placeBid(
    loadId: string,
    input: { amountInr: number; truckNumber: string },
  ): Promise<{ load: Load } | null> {
    if (!isServerMode) return null;
    return request<{ load: Load }>(`/v1/loads/${loadId}/bids`, { method: 'POST', body: input });
  },

  // -------------------------------------------------------------------------
  // Escrow lifecycle (Feature C) — server returns the authoritative shipment
  // -------------------------------------------------------------------------

  async fetchShipments(): Promise<EscrowShipment[] | null> {
    if (!isServerMode) return null;
    const { shipments } = await request<{ shipments: EscrowShipment[] }>('/v1/shipments');
    return shipments;
  },

  async dispatchShipment(shipmentId: string): Promise<EscrowShipment | null> {
    if (!isServerMode) {
      await delay(SIMULATED_LATENCY_MS);
      return null;
    }
    const { shipment } = await request<{ shipment: EscrowShipment }>(
      `/v1/shipments/${shipmentId}/dispatch`,
      { method: 'POST' },
    );
    return shipment;
  },

  async uploadPod(shipmentId: string, pod: ProofOfDelivery): Promise<EscrowShipment | null> {
    if (!isServerMode) return null;
    // Foundation sends POD metadata; the image/PDF bytes stay on-device.
    // Production: request a presigned upload URL here, PUT the binary, then
    // confirm — the endpoint shape is already compatible.
    const { shipment } = await request<{ shipment: EscrowShipment }>(
      `/v1/shipments/${shipmentId}/pod`,
      { method: 'POST', body: { fileName: pod.fileName, kind: pod.kind, uri: pod.uri } },
    );
    return shipment;
  },

  async releaseShipmentBalance(shipmentId: string): Promise<EscrowShipment | null> {
    if (!isServerMode) {
      await delay(SIMULATED_LATENCY_MS);
      return null;
    }
    const { shipment } = await request<{ shipment: EscrowShipment }>(
      `/v1/shipments/${shipmentId}/release`,
      { method: 'POST' },
    );
    return shipment;
  },

  /** Two-way rating on a settled shipment. */
  async rateShipment(
    shipmentId: string,
    stars: number,
    as: 'dealer' | 'driver',
  ): Promise<EscrowShipment | null> {
    if (!isServerMode) return null;
    const { shipment } = await request<{ shipment: EscrowShipment }>(
      `/v1/shipments/${shipmentId}/rate`,
      { method: 'POST', body: { stars, as } },
    );
    return shipment;
  },

  // -------------------------------------------------------------------------
  // FASTag wallet (Feature E)
  // -------------------------------------------------------------------------

  async fetchFastag(): Promise<{ balanceInr: number; transactions: FastagTransaction[] } | null> {
    if (!isServerMode) return null;
    return request<{ balanceInr: number; transactions: FastagTransaction[] }>('/v1/fastag');
  },

  /**
   * Real-UPI path: ask the server for a upi:// deep link the phone can open
   * in GPay/PhonePe/Paytm. Null in demo mode (simulated top-up instead).
   */
  async getFastagTopUpIntent(amountInr: number): Promise<{ upiUri: string; payeeVpa: string } | null> {
    if (!isServerMode) return null;
    return request<{ upiUri: string; payeeVpa: string }>('/v1/fastag/topup/intent', {
      method: 'POST',
      body: { amountInr },
    });
  },

  async topUpFastag(amountInr: number): Promise<FastagTopUpResult> {
    if (isServerMode) {
      return request<FastagTopUpResult>('/v1/fastag/topup', {
        method: 'POST',
        body: { amountInr },
      });
    }
    await delay(SIMULATED_LATENCY_MS);
    return { upiRef: `UPI${Date.now()}${Math.round(amountInr)}` };
  },

  // -------------------------------------------------------------------------
  // Driver features: fuel prices & SOS
  // -------------------------------------------------------------------------

  async fetchFuelPrices(): Promise<FuelPrice[] | null> {
    if (!isServerMode) return null;
    const { prices } = await request<{ prices: FuelPrice[] }>('/v1/fuel/prices');
    return prices;
  },

  async sendSos(point: TelemetryPoint | null): Promise<{ id: string }> {
    if (isServerMode) {
      return request<{ id: string }>('/v1/sos', {
        method: 'POST',
        body: { latitude: point?.latitude, longitude: point?.longitude },
      });
    }
    await delay(400);
    return { id: `sos-${Date.now()}` };
  },

  async resolveSos(id: string): Promise<void> {
    if (!isServerMode) return;
    await request(`/v1/sos/${id}/resolve`, { method: 'POST' });
  },
};
