/**
 * RouteMap — web/default implementation.
 *
 * Delegates to the self-contained RouteMapCanvas so browsers (the Vercel
 * preview, Expo web) need no native map SDK. Phones get the real map from
 * RouteMap.native.tsx via Metro's platform resolution.
 */

import React from 'react';
import type { RouteMapProps } from './RouteMap.types';
import { RouteMapCanvas } from './RouteMapCanvas';

export function RouteMap({
  amenities,
  truckProgress,
  originLabel,
  destinationLabel,
  height,
}: RouteMapProps): React.JSX.Element {
  return (
    <RouteMapCanvas
      amenities={amenities}
      truckProgress={truckProgress}
      originLabel={originLabel}
      destinationLabel={destinationLabel}
      height={height}
    />
  );
}
