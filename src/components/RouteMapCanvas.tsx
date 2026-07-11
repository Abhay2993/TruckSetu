/**
 * Feature E — simulated route map.
 *
 * Architectural choice: a lightweight custom canvas (plain Views positioned
 * from normalised 0..1 coordinates) instead of react-native-maps. This keeps
 * the demo runnable in Expo Go with zero native config / API keys, while the
 * data contract (amenities carry mapX/mapY AND real distances; the truck is
 * a 0..1 route progress) maps 1:1 onto a real map SDK later — swap this
 * component, keep every caller.
 *
 * The route polyline is rendered as a dotted chain of interpolated points;
 * the truck marker is positioned by arc-length interpolation along the same
 * path, so marker and route can never drift apart.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { ROUTE_PATH } from '../data/mock';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { Amenity } from '../types';

interface RouteMapCanvasProps {
  amenities: Amenity[];
  /** 0..1 progress of the truck along the route. */
  truckProgress: number;
  originLabel: string;
  destinationLabel: string;
  height?: number;
}

interface XY {
  x: number;
  y: number;
}

/** Evenly resample the polyline so the dotted route looks continuous. */
function resamplePath(path: XY[], samples: number): XY[] {
  const points: XY[] = [];
  for (let i = 0; i < samples; i++) {
    points.push(pointAlongPath(path, i / (samples - 1)));
  }
  return points;
}

/** Arc-length interpolation: t=0 start of route, t=1 end. */
function pointAlongPath(path: XY[], t: number): XY {
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return { x: 0, y: 0 };
  if (path.length < 2 || t <= 0) return first;
  if (t >= 1) return last;

  const segmentLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segmentLengths.push(len);
    total += len;
  }

  let remaining = t * total;
  for (let i = 0; i < segmentLengths.length; i++) {
    const len = segmentLengths[i] ?? 0;
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    if (remaining <= len && len > 0) {
      const f = remaining / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= len;
  }
  return last;
}

export function RouteMapCanvas({
  amenities,
  truckProgress,
  originLabel,
  destinationLabel,
  height = 230,
}: RouteMapCanvasProps): React.JSX.Element {
  const [size, setSize] = useState({ width: 0, height });

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  };

  const routeDots = useMemo(() => resamplePath(ROUTE_PATH, 46), []);
  const truckPos = pointAlongPath(ROUTE_PATH, truckProgress);
  const ready = size.width > 0;

  const toPx = (p: XY) => ({ left: p.x * size.width, top: p.y * size.height });

  return (
    <View style={[styles.canvas, { height }]} onLayout={onLayout}>
      {/* Grid backdrop to suggest map tiles */}
      {ready &&
        Array.from({ length: 5 }, (_, i) => (
          <View
            key={`h${i}`}
            style={[styles.gridLineH, { top: ((i + 1) * size.height) / 6 }]}
          />
        ))}
      {ready &&
        Array.from({ length: 7 }, (_, i) => (
          <View key={`v${i}`} style={[styles.gridLineV, { left: ((i + 1) * size.width) / 8 }]} />
        ))}

      {/* Dotted highway route */}
      {ready &&
        routeDots.map((p, i) => (
          <View key={`r${i}`} style={[styles.routeDot, toPx(p)]} />
        ))}

      {/* Origin / destination flags */}
      {ready && (
        <>
          <View style={[styles.endpoint, toPx(ROUTE_PATH[0] ?? { x: 0, y: 0 })]}>
            <Ionicons name="ellipse" size={10} color={colors.success} />
            <Text style={styles.endpointLabel}>{originLabel}</Text>
          </View>
          <View style={[styles.endpoint, toPx(ROUTE_PATH[ROUTE_PATH.length - 1] ?? { x: 1, y: 0 })]}>
            <Ionicons name="flag" size={12} color={colors.danger} />
            <Text style={styles.endpointLabel}>{destinationLabel}</Text>
          </View>
        </>
      )}

      {/* Amenity markers */}
      {ready &&
        amenities.map((a) => (
          <View key={a.id} style={[styles.marker, toPx({ x: a.mapX, y: a.mapY })]}>
            <View
              style={[
                styles.markerBubble,
                { backgroundColor: a.kind === 'dhaba' ? colors.accent : colors.primary },
              ]}
            >
              {a.kind === 'dhaba' ? (
                <Ionicons name="restaurant" size={11} color={colors.textInverse} />
              ) : (
                <MaterialCommunityIcons name="wrench" size={11} color={colors.textInverse} />
              )}
            </View>
          </View>
        ))}

      {/* Truck marker */}
      {ready && (
        <View style={[styles.truck, toPx(truckPos)]}>
          <View style={styles.truckBubble}>
            <MaterialCommunityIcons name="truck" size={14} color={colors.textInverse} />
          </View>
        </View>
      )}
    </View>
  );
}

const MARKER_SIZE = 22;

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: colors.mapBg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.mapGrid,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.mapGrid,
  },
  routeDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.mapRoute,
    marginLeft: -2,
    marginTop: -2,
  },
  endpoint: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: -6,
    marginTop: -18,
  },
  endpointLabel: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textPrimary,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  marker: {
    position: 'absolute',
    marginLeft: -MARKER_SIZE / 2,
    marginTop: -MARKER_SIZE / 2,
  },
  markerBubble: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  truck: {
    position: 'absolute',
    marginLeft: -14,
    marginTop: -14,
  },
  truckBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  spacer: {
    height: spacing.sm,
  },
});
