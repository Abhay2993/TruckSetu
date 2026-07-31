/**
 * Thin fetch wrapper for the TruckSetu API: base-URL prefixing, JSON
 * encode/decode, bearer-token injection from the auth store, a 15s timeout,
 * and typed errors. Every server call in api.ts goes through here.
 */

import { API_URL } from '../config';
import { useAuthStore } from '../stores/useAuthStore';

const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (pre-login endpoints). */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, 'No API URL configured — app is in demo mode.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!options.anonymous) {
    // getState() (not a hook): this runs outside React, e.g. in store
    // actions and the telemetry flush.
    const token = useAuthStore.getState().token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof (data as { error?: unknown })?.error === 'string'
          ? (data as { error: string }).error
          : `Request failed (${response.status})`;
      throw new ApiError(response.status, message);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // AbortError, DNS failure, offline — normalise to a retryable ApiError.
    throw new ApiError(0, 'Network error — check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
