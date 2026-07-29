# TruckSetu 🚛

Foundational React Native (Expo + TypeScript) codebase for **TruckSetu** — a
logistics platform bridging Indian truck drivers and dealers/brokers.

## Run it

```bash
npm install
npm start          # Expo dev server — scan the QR with Expo Go
npm run typecheck  # strict TS check, no emit
```

No native config, API keys or prebuild required — runs directly in Expo Go.

## Two modes: demo vs. server

The app has a real backend (see `server/`) but never requires it:

- **Demo mode** (default, no configuration): the API layer simulates the
  backend locally — seed data, fake latency, login OTP is always `123456`.
  This is what the public web preview runs.
- **Server mode**: set `EXPO_PUBLIC_API_URL` and every call (auth, loads,
  bids, escrow, telemetry, FASTag) goes to the backend over HTTPS:

```bash
# Terminal 1 — the backend
cd server && npm install && npm run dev        # listens on :4000

# Terminal 2 — the app, pointed at it (use your LAN IP for a phone)
EXPO_PUBLIC_API_URL=http://192.168.1.5:4000 npm start
```

> Gotcha: `EXPO_PUBLIC_*` values are inlined at bundle time and Metro's
> transform cache does not key on them — after changing the URL, restart
> with `npx expo start --clear` (or `expo export --clear`).

## Backend (`server/`)

Node + Express + TypeScript, JWT sessions, JSON-file persistence — zero
native dependencies, so it deploys unchanged to Railway / Render / Fly.
`db.ts` is the only file to touch when moving to Postgres.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `PUT /v1/me` |
| Loads & bids | `GET/POST /v1/loads`, `POST /v1/loads/:id/bids`, `POST /v1/loads/:id/bids/:bidId/accept` |
| Escrow | `GET /v1/shipments`, `POST /v1/shipments/:id/dispatch`, `…/pod`, `…/release` |
| Telemetry | `POST /v1/telemetry/batch`, `POST /v1/telemetry/live`, `GET /v1/telemetry/stats` |
| FASTag | `GET /v1/fastag`, `POST /v1/fastag/topup` |
| Money | `GET /v1/money/summary`, `…/discount`, `…/credit/draw`, `…/credit/repay`, `…/emi`, `…/fuelcard/swipe`, `…/vehicle-loan/apply`, `…/insurance/renew` |
| Bureau | `GET /v1/bureau/score` (partner API key + user consent) |

The escrow stage machine is enforced **server-side** (releasing before a POD
exists returns 409) — the app's local checks are UX, the server is truth.
Env: `PORT`, `JWT_SECRET` (set in production!), `DATA_FILE`, `NODE_ENV`.

## TruckSetu Money (the lending flywheel)

Underwriting runs on data no matching-only competitor has: settled escrow
trips, verified PODs, dispute history, dealer settlement behaviour and
driving telemetry. Every settled shipment sharpens the score, which prices
credit cheaper, which attracts more flow.

| Product | How it is priced |
| --- | --- |
| Working-capital line | Revolving, limit sized by TruckScore, 18% p.a. |
| Bill discounting | Dealer paid day 1; 1.25% per 30 days of tenor |
| Tyre / repair / battery EMI | 20% p.a. reducing balance, gated at score ≥ 480 |
| Fuel card | ₹1.50/litre off at partner pumps + 0.5% cashback |
| Truck loan | APR by score band (12.5%–21%), eligibility by band |
| Insurance | 2.25% of sum insured, up to 20% off for safe driving |
| TruckScore bureau | ₹25 per consented partner pull |

**Repayment seniority is the underwriting edge.** TruckSetu controls the
escrow, so instalments are collected from the driver's own balance release
before the money leaves the platform (`planEscrowDeductions` →
`commitEscrowDeductions` in `server/src/money.ts`, applied in the release
and instant-payout routes). Priority: EMI → fuel card dues → a 25% sweep
against the drawn line. Deductions are *planned* before the payout and
*committed* only after it succeeds, so a failed payout never charges the
driver.

The bureau API requires both a partner key (`BUREAU_API_KEY`) and the
subject's explicit consent; refused pulls are audited too, and the ops
console shows the live book (drawn, EMI outstanding, invoices advanced,
fee income) alongside every query.

> Going live needs an NBFC/lending partner and an RBI co-lending or DLG
> arrangement. The arithmetic, ledgers and state machines are real; only
> disbursal/collection swap from simulated to partner rails.

## Maps

Phones render a **real map** (react-native-maps: Google Maps on Android,
Apple Maps on iOS) with the NH-48 route polyline, dhaba/mechanic markers and
the live truck position from telemetry. The web build automatically falls
back to the lightweight canvas map — Metro picks `RouteMap.native.tsx` on
devices and `RouteMap.tsx` elsewhere.

Expo Go works out of the box. **Standalone Android builds need your own
Google Maps key**: add to `app.json` →
`android.config.googleMaps.apiKey` (get one from the Google Cloud console,
enable "Maps SDK for Android"). iOS needs nothing.

## Payments

Two rails, both env-switched in `server/src/payments.ts`:

- **FASTag top-up (UPI intent)** — on phones the app opens the user's UPI
  app (GPay/PhonePe/Paytm) with a pre-filled payment via a `upi://pay` deep
  link from `POST /v1/fastag/topup/intent`. Set `UPI_PAYEE_VPA` to your
  collection VPA. Production: credit the wallet from the PSP webhook, not
  the in-app confirmation.
- **Escrow payouts (RazorpayX)** — dispatch/release call `executePayout`,
  which hits the RazorpayX Payouts API when `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET` and `RAZORPAYX_ACCOUNT_NUMBER` are set, and
  simulates otherwise. `POST /v1/payments/webhook` verifies Razorpay's
  HMAC-SHA256 signature (constant-time compare) — set
  `RAZORPAY_WEBHOOK_SECRET` and point the Razorpay dashboard at it.

## Ship to stores (EAS)

Icons, splash, bundle ids and `eas.json` build profiles are already in the
repo. From a machine with an [Expo account](https://expo.dev):

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview     # installable APK for testing
eas build -p android --profile production  # AAB for the Play Store
eas build -p ios --profile production      # needs an Apple Developer account
eas submit -p android                      # upload to Play Console
```

Before the production build: set the real backend URL in `eas.json` →
`build.production.env.EXPO_PUBLIC_API_URL`, and add the Google Maps key
(above). Play Store needs a one-time $25 developer account and a service
account JSON for `eas submit`; App Store needs the $99/yr Apple Developer
Program.

## Authentication

Phone-OTP (the norm for drivers): enter a 10-digit number → 6-digit OTP →
30-day JWT, persisted so login happens once. SMS delivery is a stub
(`server/src/auth.ts` → `sendSms`) — wire MSG91/Twilio/Firebase there; until
then dev-mode responses include `devOtp`, which the login screen shows as a
hint. Signing out (header icon) clears the session and the saved role.

## Deploy the web preview (Vercel)

The app also exports as a static website via React Native Web:

```bash
npm run build   # expo export --platform web  →  dist/
```

`vercel.json` already configures the build command, `dist` output directory
and SPA fallback rewrite, so connecting this repo to Vercel just works. If
you created the Vercel project before this file existed, either redeploy the
latest commit, or set it manually under Project → Settings → Build &
Development Settings: Framework Preset **Other**, Build Command
`npx expo export --platform web`, Output Directory `dist`.

Note: the website is a demo/preview surface — the product target is the
native app via Expo Go / EAS builds.

## Tech stack

| Concern            | Choice                                                       |
| ------------------ | ------------------------------------------------------------ |
| Framework          | Expo managed workflow, TypeScript (`strict`)                  |
| Styling            | `StyleSheet` + central design tokens (`src/theme`)            |
| State & offline    | Zustand + AsyncStorage persistence (`zustand/middleware`)     |
| Navigation         | React Navigation — bottom tabs per role, native stack shell   |
| Icons              | `@expo/vector-icons` (Ionicons, MaterialCommunityIcons)       |
| Connectivity       | `@react-native-community/netinfo`                             |
| POD capture        | `expo-image-picker` (camera) + `expo-document-picker` (files) |

## Feature map

| Feature | Where |
| ------- | ----- |
| **A — "Setu" rotator** (1 s dynamic title) | `src/components/DynamicHeader.tsx` |
| **B — Dual-interface routing** (Driver vs Dealer) | `src/screens/onboarding/RoleSelectScreen.tsx`, `src/navigation/RootNavigator.tsx` |
| **C — 2-stage escrow payments** (advance → escrow → POD → release) | `src/screens/shared/PaymentEscrowDashboard.tsx`, `src/stores/useEscrowStore.ts`, `src/components/EscrowFlowIndicator.tsx` |
| **D — Offline-first GPS telemetry** | `src/hooks/OfflineTelemetryHook.ts`, `src/stores/useTelemetryStore.ts`, `src/services/gpsSimulator.ts` |
| **E — Route amenities & FASTag** | `src/screens/driver/DriverRouteScreen.tsx`, `src/components/RouteMapCanvas.tsx`, `src/components/FastagCard.tsx`, `src/components/AmenityCard.tsx` |
| **F — Vernacular localization** (en / हिंदी / ਪੰਜਾਬੀ / తెలుగు / தமிழ்) | `src/i18n/i18n.ts` |

## Architecture notes

### State: Zustand stores, persisted where it matters
Each domain gets its own store under `src/stores/`. Stores that must survive
restarts (`app` prefs, `telemetry` queue, `escrow` shipments, `fastag`
wallet, `loads` board) use the `persist` middleware over AsyncStorage, with
`partialize` keeping transient UI state (in-flight payment ids, spinners)
out of disk. Stores are importable from non-React code — the telemetry sync
path reads the queue via `getState()` snapshots, never via hooks.

### Offline-first telemetry (Feature D)
`useOfflineTelemetry` is the single wiring point:

```
GPS source ──recordPoint()──▶  online?  ──yes──▶ live push (fallback: queue)
                                 │no
                                 ▼
                    persisted AsyncStorage queue
                                 │  (offline → online edge, via NetInfo)
                                 ▼
                    batch flush ──▶ api.syncTelemetryBatch ──▶ drain(n)
```

At-least-once semantics: the queue is only drained by the count actually
confirmed, so points recorded during a flush survive; a failed flush leaves
the queue intact for automatic retry.

### Escrow lifecycle (Feature C)
Stage transitions are validated inside `useEscrowStore` — screens can only
*request* transitions, so "release before POD" is structurally impossible:

```
CREATED → DISPATCHED → ADVANCE_PAID → POD_UPLOADED → BALANCE_RELEASED
            (advance auto-fires)  (driver uploads)  (dealer releases)
```

### Simulated map & GPS
`RouteMapCanvas` renders a normalised-coordinate route with amenity/truck
markers using plain Views — zero native map config, runs in Expo Go. The
data contract (normalised positions + real distances + 0..1 route progress)
maps 1:1 onto react-native-maps later. Likewise `gpsSimulator.ts` emits the
same `TelemetryPoint` shape `expo-location` would.

### Mock backend
All network effects go through `src/services/api.ts` with realistic latency,
so spinners/disabled/retry states are exercised for real and the swap to a
production HTTP client is a one-file change.

## Project layout

```
App.tsx                     # providers only
server/                     # Express API: auth, loads, escrow, telemetry, FASTag
├── src/index.ts            # route table (stage machine enforced here)
├── src/auth.ts             # OTP + JWT (sendSms stub = SMS provider slot)
├── src/db.ts               # JSON-file persistence (swap for Postgres here)
└── src/types.ts            # wire types (mirrors src/types)
src/
├── config.ts               # EXPO_PUBLIC_API_URL → demo vs server mode
├── components/             # DynamicHeader, EscrowFlowIndicator, FastagCard,
│                           # RouteMapCanvas, AmenityCard, ScreenHeader
├── data/mock.ts            # demo-mode seed dataset
├── hooks/OfflineTelemetryHook.ts
├── i18n/i18n.ts            # typed 5-locale dictionary + useTranslation
├── navigation/RootNavigator.tsx   # gates: auth → role → tabs
├── screens/
│   ├── auth/PhoneLoginScreen.tsx  # phone → OTP login
│   ├── onboarding/RoleSelectScreen.tsx
│   ├── driver/             # DriverRouteScreen, DriverTripsScreen
│   ├── dealer/             # DealerLoadsScreen, DealerShipmentsScreen
│   └── shared/PaymentEscrowDashboard.tsx
├── services/               # api.ts (gateway), http.ts (fetch+JWT),
│                           # sync.ts (server→store hydration), gpsSimulator.ts
├── stores/                 # useAuthStore, useAppStore, useTelemetryStore,
│                           # useEscrowStore, useFastagStore, useLoadsStore
├── theme/                  # design tokens
├── types/                  # shared domain models
└── utils/                  # format (INR grouping), dialog (web-safe alerts)
```
