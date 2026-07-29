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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmenityCard } from '../../components/AmenityCard';
import { FastagCard } from '../../components/FastagCard';
import { FuelPriceCard } from '../../components/FuelPriceCard';
import { RouteMap } from '../../components/RouteMap';
import { ScreenHeader } from '../../components/ScreenHeader';
import { AssistancePanel } from '../../components/AssistancePanel';
import { SosButton } from '../../components/SosButton';
import { AMENITIES } from '../../data/mock';
import { useOfflineTelemetry } from '../../hooks/OfflineTelemetryHook';
import { useTranslation } from '../../i18n/i18n';
import { useGpsSimulator } from '../../services/gpsSimulator';
import { fillTemplate, speak } from '../../services/voice';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { Amenity } from '../../types';
import { notify } from '../../utils/dialog';
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
  const user = useAuthStore((s) => s.user);
  const locale = useAppStore((s) => s.locale);
  const [filter, setFilter] = useState<AmenityFilter>('all');

  // Feature D wiring: every simulated GPS tick flows through recordPoint,
  // which routes it live to the API or into the persisted offline cache.
  const telemetry = useOfflineTelemetry();
  const { routeProgress, currentSpeed, lastPoint } = useGpsSimulator(telemetry.recordPoint, true);

  const filtered = useMemo(() => applyFilter(AMENITIES, filter), [filter]);

  const handleNavigate = (amenity: Amenity) => {
    // Placeholder until deep-linking into Google Maps navigation lands.
    notify('Start navigation', `Routing you to ${amenity.name} (${amenity.distanceKm} km ahead).`);
  };

  // Vernacular voice: announce the amenity results in the user's language
  // (expo-speech TTS — works in Expo Go; STT slot documented in voice.ts).
  const speakResults = () => {
    const nearest = [...filtered].sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (!nearest) return;
    speak(
      fillTemplate(t('voiceAmenitySummary'), {
        count: filtered.length,
        name: nearest.name,
        km: nearest.distanceKm,
      }),
      locale,
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader isOnline={telemetry.isOnline} queuedCount={telemetry.queuedCount} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Greeting + active route context */}
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              Namaste{user?.name ? `, ${user.name}` : user?.phone ? `, ${user.phone}` : ''} 🙏
            </Text>
            <Text style={styles.greetingSub}>Delhi → Jaipur · NH-48 · on trip</Text>
          </View>
          <View style={styles.speedBadge}>
            <Text style={styles.speedValue}>{currentSpeed}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
        </View>

        {/* SOS: button when idle, red status banner while an alert is live */}
        <SosButton lastPoint={lastPoint} />

        {/* Breakdown + legal help — the two calls a driver actually makes */}
        <AssistancePanel lastPoint={lastPoint} />

        {/* Offline banner — visible reassurance that fixes aren't being lost */}
        {!telemetry.isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline" size={16} color={colors.danger} />
            <Text style={styles.offlineBannerText}>{t('youAreOffline')}</Text>
          </View>
        )}

        {/* Live route map — real map on phones, canvas on web */}
        <RouteMap
          amenities={filtered}
          truckProgress={routeProgress}
          lastPoint={lastPoint}
          originLabel="Delhi"
          destinationLabel="Jaipur"
        />

        {/* Telemetry strip: cache depth and sync status */}
        <View style={styles.telemetryStrip}>
          <TelemetryStat
            icon="hardware-chip-outline"
            label="Cached"
            value={`${telemetry.queuedCount} pts`}
            highlight={telemetry.queuedCount > 0}
          />
          <TelemetryStat
            icon="cloud-done-outline"
            label="Synced"
            value={`${telemetry.totalSyncedCount} pts`}
          />
          <TelemetryStat
            icon="time-outline"
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

        {/* Diesel prices + fuel credit */}
        <FuelPriceCard />

        {/* Amenities */}
        <View style={styles.amenityHeader}>
          <Text style={styles.sectionTitle}>{t('findDhaba')} & services</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Speak results"
            onPress={speakResults}
            hitSlop={8}
            style={({ pressed }) => [styles.speakBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="volume-high" size={18} color={colors.accent} />
          </Pressable>
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
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  highlight?: boolean;
}): React.JSX.Element {
  const tint = highlight ? colors.warning : colors.textMuted;
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={15} color={tint} />
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
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  greeting: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  greetingSub: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  speedBadge: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  speedValue: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.accent,
  },
  speedUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accent,
    opacity: 0.8,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  speakBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
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
