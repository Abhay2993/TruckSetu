/**
 * RouteMap — native (iOS/Android) implementation on react-native-maps.
 *
 * Renders the real NH-48 corridor: Apple Maps on iOS, Google Maps on
 * Android (Expo Go ships its own Maps key; standalone builds need
 * android.config.googleMaps.apiKey in app.json — see README).
 *
 * The truck marker prefers the latest real GPS fix (`lastPoint`, exactly
 * what the telemetry pipeline records) and falls back to interpolating
 * `truckProgress` along the corridor, so both driver (live GPS) and dealer
 * (progress-only) screens work.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { ROUTE_WAYPOINTS } from '../data/mock';
import { colors, radii } from '../theme';
import type { RouteMapProps } from './RouteMap.types';

function interpolateAlongWaypoints(t: number): { latitude: number; longitude: number } {
  const clamped = Math.min(Math.max(t, 0), 1);
  const segments = ROUTE_WAYPOINTS.length - 1;
  const scaled = clamped * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const f = scaled - i;
  const a = ROUTE_WAYPOINTS[i] ?? ROUTE_WAYPOINTS[0];
  const b = ROUTE_WAYPOINTS[i + 1] ?? a;
  if (!a || !b) return { latitude: 0, longitude: 0 };
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
  };
}

export function RouteMap({
  amenities,
  truckProgress,
  lastPoint,
  originLabel,
  destinationLabel,
  height = 230,
}: RouteMapProps): React.JSX.Element {
  // Frame the whole corridor with a little padding.
  const initialRegion = useMemo(() => {
    const lats = ROUTE_WAYPOINTS.map((w) => w.latitude);
    const lngs = ROUTE_WAYPOINTS.map((w) => w.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.4,
      longitudeDelta: (maxLng - minLng) * 1.4,
    };
  }, []);

  const truckCoordinate = lastPoint
    ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude }
    : interpolateAlongWaypoints(truckProgress);

  const origin = ROUTE_WAYPOINTS[0];
  const destination = ROUTE_WAYPOINTS[ROUTE_WAYPOINTS.length - 1];

  return (
    <View style={[styles.container, { height }]}>
      <MapView style={StyleSheet.absoluteFill} initialRegion={initialRegion}>
        <Polyline
          coordinates={ROUTE_WAYPOINTS}
          strokeColor={colors.mapRoute}
          strokeWidth={4}
        />

        {origin && <Marker coordinate={origin} title={originLabel} pinColor="green" />}
        {destination && <Marker coordinate={destination} title={destinationLabel} pinColor="red" />}

        {amenities.map((a) => (
          <Marker
            key={a.id}
            coordinate={{ latitude: a.latitude, longitude: a.longitude }}
            title={a.name}
            description={`${a.distanceKm} km ahead · ★ ${a.rating.toFixed(1)}`}
          >
            <View
              style={[
                styles.amenityBubble,
                { backgroundColor: a.kind === 'dhaba' ? colors.accent : colors.primary },
              ]}
            >
              {a.kind === 'dhaba' ? (
                <Ionicons name="restaurant" size={12} color={colors.textInverse} />
              ) : (
                <MaterialCommunityIcons name="wrench" size={12} color={colors.textInverse} />
              )}
            </View>
          </Marker>
        ))}

        <Marker coordinate={truckCoordinate} title="Your truck" anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.truckBubble}>
            <MaterialCommunityIcons name="truck" size={15} color={colors.textInverse} />
          </View>
        </Marker>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  amenityBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  truckBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
