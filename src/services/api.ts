/**
 * Mock backend gateway.
 *
 * Every network side-effect in the app funnels through this module so the
 * simulated latency/failure behaviour is centralised and swapping in a real
 * HTTP client (fetch/axios against the TruckSetu API) is a one-file change.
 * Functions intentionally return promises with realistic delays so UI states
 * (spinners, disabled buttons, retry paths) are exercised for real.
 */

import type { TelemetryPoint } from '../types';

const SIMULATED_LATENCY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TelemetrySyncResult {
  syncedCount: number;
  syncedAt: number;
}

export const api = {
  /**
   * Feature D — bulk-flush of the offline telemetry queue. The real
   * implementation would POST to /v1/trips/:id/telemetry/batch.
   */
  async syncTelemetryBatch(points: TelemetryPoint[]): Promise<TelemetrySyncResult> {
    await delay(SIMULATED_LATENCY_MS);
    if (points.length === 0) {
      return { syncedCount: 0, syncedAt: Date.now() };
    }
    return { syncedCount: points.length, syncedAt: Date.now() };
  },

  /** Live single-point push used while the device is online. */
  async pushTelemetryLive(_point: TelemetryPoint): Promise<void> {
    await delay(120);
  },

  /**
   * Feature C — Stage 1: advance payout to the driver's fuel card/account,
   * fired automatically when the dealer confirms dispatch.
   */
  async triggerAdvancePayout(shipmentId: string, amountInr: number): Promise<{ referenceId: string }> {
    await delay(SIMULATED_LATENCY_MS);
    return { referenceId: `ADV-${shipmentId}-${Math.round(amountInr)}` };
  },

  /** Feature C — Stage 2: release of the escrow-locked balance. */
  async releaseEscrowBalance(shipmentId: string, amountInr: number): Promise<{ referenceId: string }> {
    await delay(SIMULATED_LATENCY_MS);
    return { referenceId: `BAL-${shipmentId}-${Math.round(amountInr)}` };
  },

  /** Feature E — FASTag top-up via UPI intent. */
  async topUpFastag(amountInr: number): Promise<{ upiRef: string }> {
    await delay(SIMULATED_LATENCY_MS);
    return { upiRef: `UPI${Date.now()}${Math.round(amountInr)}` };
  },
};
