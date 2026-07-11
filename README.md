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
src/
├── components/             # DynamicHeader, EscrowFlowIndicator, FastagCard,
│                           # RouteMapCanvas, AmenityCard, ScreenHeader
├── data/mock.ts            # seed dataset (deletable once backend lands)
├── hooks/OfflineTelemetryHook.ts
├── i18n/i18n.ts            # typed 5-locale dictionary + useTranslation
├── navigation/RootNavigator.tsx
├── screens/
│   ├── onboarding/RoleSelectScreen.tsx
│   ├── driver/             # DriverRouteScreen, DriverTripsScreen
│   ├── dealer/             # DealerLoadsScreen, DealerShipmentsScreen
│   └── shared/PaymentEscrowDashboard.tsx
├── services/               # api.ts (mock gateway), gpsSimulator.ts
├── stores/                 # useAppStore, useTelemetryStore, useEscrowStore,
│                           # useFastagStore, useLoadsStore
├── theme/                  # design tokens
├── types/                  # shared domain models
└── utils/format.ts         # INR (Indian digit grouping), time helpers
```
