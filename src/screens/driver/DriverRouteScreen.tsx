/**
 * Feature E (+D) — Driver Route Screen (deliverable 4).
 *
 * The driver's home tab. Composes:
 *   • ScreenHeader with the live online/offline pill fed by the offline
 *     telemetry hook (Feature D) — the same hook instance also receives the
 *     simulated GPS stream, so this screen is where capture → cache → sync
 *     is actually wired together.
 *   • RouteMapCanvas — simulated highway with dhaba/mechanic markers and a
 *     truck that advances with each GPS tick.
 *   • FastagCard — balance, low-balance warning, UPI top-up (Feature E).
 *   • Filterable amenity list (Veg / Non-Veg / Parking / Mechanic).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmenityCard } from '../../components/AmenityCard';
import { FastagCard } from '../../components/FastagCard';
import { RouteMapCanvas } from '../../components/RouteMapCanvas';
import { ScreenHeader } from '../../components/ScreenHeader';
import { AMENITIES } from '../../data/mock';
import { useOfflineTelemetry } from '../../hooks/OfflineTelemetryHook';
import { useTranslation } from '../../i18n/i18n';
import { useGpsSimulator } from '../../services/gpsSimulator';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { Amenity } from '../../types';
import { formatTime } from '../../utils/format';

type AmenityFilter = 'all' | 'veg' | 'nonveg' | 'parking' | 'mechanic';

const FILTERS: { key: AmenityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'veg', label: 'Veg' },
  { key: 'nonveg', label: 'Non-Veg' },
  { key: 'parking', label: 'Parking' },
  { key: 'mechanic', label: 'Mechanic' },
];

function applyFilter(amenities: Amenity[], filter: AmenityFilter): Amenity[] {
  switch (filter) {
    case 'veg':
      return amenities.filter((a) => a.servesVeg === true);
    case 'nonveg':
      return amenities.filter((a) => a.servesNonVeg === true);
    case 'parking':
      return amenities.filter((a) => a.hasDriverParking === true);
    case 'mechanic':
      return amenities.filter((a) => a.kind === 'mechanic');
    default:
      return amenities;
  }
}

export function DriverRouteScreen(): React.JSX.Element {
  const t = useTranslation();
  const [filter, setFilter] = useState<AmenityFilter>('all');

  // Feature D wiring: every simulated GPS tick flows through recordPoint,
  // which routes it live to the API or into the persisted offline cache.
  const telemetry = useOfflineTelemetry();
  const { routeProgress, currentSpeed } = useGpsSimulator(telemetry.recordPoint, true);

  const filtered = useMemo(() => applyFilter(AMENITIES, filter), [filter]);

  const handleNavigate = (amenity: Amenity) => {
    // Placeholder until deep-linking into Google Maps navigation lands.
    Alert.alert('Start navigation', `Routing you to ${amenity.name} (${amenity.distanceKm} km ahead).`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader isOnline={telemetry.isOnline} queuedCount={telemetry.queuedCount} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Offline banner — visible reassurance that fixes aren't being lost */}
        {!telemetry.isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline" size={16} color={colors.danger} />
            <Text style={styles.offlineBannerText}>{t('youAreOffline')}</Text>
          </View>
        )}

        {/* Live route map */}
        <RouteMapCanvas
          amenities={filtered}
          truckProgress={routeProgress}
          originLabel="Delhi"
          destinationLabel="Jaipur"
        />

        {/* Telemetry strip: speed, cache depth, sync status */}
        <View style={styles.telemetryStrip}>
          <TelemetryStat label="Speed" value={`${currentSpeed} km/h`} />
          <TelemetryStat label="Cached" value={`${telemetry.queuedCount} pts`} highlight={telemetry.queuedCount > 0} />
          <TelemetryStat label="Synced" value={`${telemetry.totalSyncedCount} pts`} />
          <TelemetryStat
            label="Last sync"
            value={
              telemetry.isSyncing
                ? 'syncing…'
                : telemetry.lastSyncAt
                  ? formatTime(telemetry.lastSyncAt)
                  : '—'
            }
          />
        </View>

        {/* FASTag wallet */}
        <FastagCard />

        {/* Amenities */}
        <View style={styles.amenityHeader}>
          <Text style={styles.sectionTitle}>{t('findDhaba')} & services</Text>
        </View>
        <View style={styles.filterRow}>
          {FILTERS.map(({ key, label }) => {
            const selected = key === filter;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => setFilter(key)}
                style={[styles.filterChip, selected && styles.filterChipSelected]}
              >
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.amenityList}>
          {filtered.map((a) => (
            <AmenityCard key={a.id} amenity={a} onNavigate={handleNavigate} />
          ))}
          {filtered.length === 0 && (
            <Text style={styles.emptyText}>Nothing matches this filter on the current route.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TelemetryStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, highlight && { color: colors.warning }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  offlineBannerText: {
    flex: 1,
    color: colors.danger,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
  telemetryStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    ...cardShadow,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  amenityHeader: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  filterChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  filterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterChipTextSelected: {
    color: colors.textInverse,
  },
  amenityList: {
    gap: spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    paddingVertical: spacing.lg,
  },
});
