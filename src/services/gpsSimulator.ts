/**
 * Simulated GPS provider for the demo build.
 *
 * Real deployments swap this for expo-location's watchPositionAsync — the
 * consumer contract is identical: a `TelemetryPoint` handed to a callback
 * every few seconds. Keeping the simulator behind the same shape means the
 * offline telemetry hook and route screen need zero changes when real GPS
 * arrives.
 */

import { useEffect, useRef, useState } from 'react';
import { ROUTE_GPS } from '../data/mock';
import type { TelemetryPoint } from '../types';

const TICK_MS = 3000;
/** Fraction of the route covered per tick — full run ≈ 7½ minutes. */
const PROGRESS_PER_TICK = 0.0067;

export interface GpsSimulator {
  /** 0..1 fraction of the route completed — drives the map truck marker. */
  routeProgress: number;
  /** Last emitted speed in km/h. */
  currentSpeed: number;
}

export function useGpsSimulator(
  onPoint: (point: TelemetryPoint) => void,
  active: boolean,
): GpsSimulator {
  const [routeProgress, setRouteProgress] = useState(0.18);
  const [currentSpeed, setCurrentSpeed] = useState(52);
  const progressRef = useRef(routeProgress);
  // Ref indirection keeps the interval stable even if the caller passes a
  // new callback identity every render.
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;

  useEffect(() => {
    if (!active) return;

    const id = setInterval(() => {
      const next = progressRef.current + PROGRESS_PER_TICK;
      // Loop the demo route endlessly.
      progressRef.current = next >= 1 ? 0 : next;

      // Interpolate between the corridor's anchor coordinates with jitter
      // so consecutive points look like a real noisy GPS trace.
      const t = progressRef.current;
      const jitter = () => (Math.random() - 0.5) * 0.002;
      const speed = 40 + Math.round(Math.random() * 30); // 40–70 km/h

      const point: TelemetryPoint = {
        latitude: ROUTE_GPS.start.latitude + (ROUTE_GPS.end.latitude - ROUTE_GPS.start.latitude) * t + jitter(),
        longitude: ROUTE_GPS.start.longitude + (ROUTE_GPS.end.longitude - ROUTE_GPS.start.longitude) * t + jitter(),
        timestamp: Date.now(),
        speed,
      };

      onPointRef.current(point);
      setRouteProgress(progressRef.current);
      setCurrentSpeed(speed);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [active]);

  return { routeProgress, currentSpeed };
}
