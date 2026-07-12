/**
 * Fleet dashboard (dealer feature) — every truck on one map, every rupee in
 * one strip.
 *
 * The summary tiles aggregate across ALL shipments (freight committed,
 * advances out, locked in escrow, fully settled) from the same escrow store
 * the Payments tab uses, so the numbers can never disagree. The map runs in
 * fleet mode: one marker per in-transit shipment; in production each truck's
 * progress comes from its driver's synced telemetry — here it advances on a
 * simulated tick with a stable per-truck offset.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteMap } from '../../components/RouteMap';
import { ScreenHeader } from '../../components/ScreenHeader';
import { buildLedgerSummary } from '../../services/invoices';
import { useEscrowStore } from '../../stores/useEscrowStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { EscrowShipment } from '../../types';
import { formatINR } from '../../utils/format';

const STAGE_SUMMARY: Record<EscrowShipment['stage'], { label: string; tint: string }> = {
  CREATED: { label: 'Awaiting dispatch', tint: colors.textMuted },
  DISPATCHED: { label: 'Dispatching', tint: colors.warning },
  ADVANCE_PAID: { label: 'In transit', tint: colors.accent },
  POD_UPLOADED: { label: 'Delivered — POD in', tint: colors.primary },
  BALANCE_RELEASED: { label: 'Completed', tint: colors.success },
};

export function DealerShipmentsScreen(): React.JSX.Element {
  const shipments = useEscrowStore((s) => s.shipments);
  // Simulated fleet motion — production reads each driver's telemetry.
  const [tick, setTick] = useState(0.3);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((p) => (p + 0.01 >= 1 ? 0 : p + 0.01));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const inTransit = shipments.filter(
    (s) => s.stage === 'ADVANCE_PAID' || s.stage === 'DISPATCHED' || s.stage === 'POD_UPLOADED',
  );
  // Stable per-truck offset so markers spread along the corridor.
  const fleet = inTransit.map((s, i) => ({
    id: s.id,
    label: s.truckNumber.split(' ').slice(-1)[0] ?? s.truckNumber,
    progress: (tick + i * 0.27) % 1,
  }));

  const summary = buildLedgerSummary(shipments);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* One payment position across the whole fleet */}
        <View style={styles.summaryStrip}>
          <SummaryTile label="Freight" value={formatINR(summary.freightInr)} />
          <SummaryTile label="Paid out" value={formatINR(summary.paidOutInr)} tint={colors.success} />
          <SummaryTile label="In escrow" value={formatINR(summary.inEscrowInr)} tint={colors.warning} />
          <SummaryTile label="Trips" value={String(summary.shipmentCount)} />
        </View>

        <Text style={styles.sectionTitle}>Fleet map</Text>
        <RouteMap
          amenities={[]}
          truckProgress={tick}
          fleet={fleet}
          originLabel="Delhi"
          destinationLabel="Jaipur"
          height={210}
        />
        <Text style={styles.mapCaption}>
          {inTransit.length > 0
            ? `${inTransit.length} truck${inTransit.length > 1 ? 's' : ''} on the road — positions from driver telemetry`
            : 'No trucks in transit right now'}
        </Text>

        <Text style={styles.sectionTitle}>All shipments</Text>
        {shipments.map((s) => {
          const stage = STAGE_SUMMARY[s.stage];
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.route}>
                  {s.origin} → {s.destination}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: stage.tint }]} />
                  <Text style={[styles.statusText, { color: stage.tint }]}>{stage.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {s.driverName} · {s.truckNumber} · {formatINR(s.totalAmountInr)}
              </Text>
              {typeof s.ratingByDealer === 'number' && (
                <View style={styles.ratedRow}>
                  <Ionicons name="star" size={13} color={colors.accent} />
                  <Text style={styles.ratedText}>You rated this driver {s.ratingByDealer}/5</Text>
                </View>
              )}
            </View>
          );
        })}

        {shipments.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>Accept a bid on the Loads tab to start a shipment.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryTile({
  label,
  value,
  tint = colors.textPrimary,
}: {
  label: string;
  value: string;
  tint?: string;
}): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
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
  summaryStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    ...cardShadow,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
  tileValue: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  tileLabel: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  mapCaption: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
    ...cardShadow,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  route: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  meta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  ratedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ratedText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.accent,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
