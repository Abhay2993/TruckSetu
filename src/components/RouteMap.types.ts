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

/** One truck on a fleet map, positioned by corridor progress. */
export interface FleetTruck {
  id: string;
  /** Short label shown at the marker, e.g. the truck number's tail. */
  label: string;
  progress: number;
}

export interface RouteMapProps {
  amenities: Amenity[];
  /** 0..1 progress along the corridor — drives the canvas truck marker. */
  truckProgress: number;
  /** Latest real GPS fix — drives the native map's truck marker. */
  lastPoint?: TelemetryPoint | null;
  /**
   * Fleet mode (dealer dashboard): render one marker per truck instead of
   * the single-truck marker.
   */
  fleet?: FleetTruck[];
  originLabel: string;
  destinationLabel: string;
  height?: number;
}
