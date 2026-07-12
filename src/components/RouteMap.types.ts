/**
 * Shared contract for the platform-split route map.
 *
 * Metro resolves `RouteMap.native.tsx` on iOS/Android (real map via
 * react-native-maps) and `RouteMap.tsx` everywhere else (the lightweight
 * canvas, which keeps the web preview free of native map dependencies).
 * Both implementations accept exactly these props, so screens never know
 * which one they got.
 */

import type { Amenity, TelemetryPoint } from '../types';

export interface RouteMapProps {
  amenities: Amenity[];
  /** 0..1 progress along the corridor — drives the canvas truck marker. */
  truckProgress: number;
  /** Latest real GPS fix — drives the native map's truck marker. */
  lastPoint?: TelemetryPoint | null;
  originLabel: string;
  destinationLabel: string;
  height?: number;
}
