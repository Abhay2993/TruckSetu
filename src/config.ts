/**
 * Runtime configuration.
 *
 * EXPO_PUBLIC_* variables are inlined by Expo at bundle time, so switching
 * backends is a rebuild, not a code change:
 *
 *   EXPO_PUBLIC_API_URL=https://api.trucksetu.example npm start
 *   EXPO_PUBLIC_API_URL=http://192.168.1.5:4000 npm start   (LAN dev server)
 *
 * When unset the app runs in DEMO MODE: the api layer falls back to its
 * built-in simulation (seed data, fake latency, OTP 123456), which is what
 * keeps the public Vercel preview alive without a deployed backend.
 */

declare const process: { env: Record<string, string | undefined> };

export const API_URL: string | null =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') ?? null;

export const isServerMode: boolean = API_URL !== null;

/** The OTP the demo-mode auth accepts. Surfaced as a hint on the login screen. */
export const DEMO_OTP = '123456';
