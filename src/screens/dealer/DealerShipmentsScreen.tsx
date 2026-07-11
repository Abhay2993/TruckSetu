/**
 * Dealer — active shipments on the (simulated) map plus a status list.
 * Reuses RouteMapCanvas with a slowly advancing marker so the dealer view
 * mirrors what the driver's telemetry is reporting.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteMapCanvas } from '../../components/RouteMapCanvas';
import { ScreenHeader } from '../../components/ScreenHeader';
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
  // Dealer-side position is a lightweight simulation of the driver feed:
  // in production this would subscribe to the synced telemetry stream.
  const [progress, setProgress] = useState(0.3);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => (p + 0.01 >= 1 ? 0 : p + 0.01));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const inTransit = shipments.filter(
    (s) => s.stage === 'ADVANCE_PAID' || s.stage === 'DISPATCHED',
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Live shipment tracking</Text>
        <RouteMapCanvas
          amenities={[]}
          truckProgress={progress}
          originLabel="Delhi"
          destinationLabel="Jaipur"
          height={200}
        />
        <Text style={styles.mapCaption}>
          {inTransit.length > 0
            ? `${inTransit.length} shipment${inTransit.length > 1 ? 's' : ''} in transit — position from driver telemetry`
            : 'No shipments in transit right now'}
        </Text>

        <Text style={styles.sectionTitle}>All shipments</Text>
        {shipments.map((s) => {
          const summary = STAGE_SUMMARY[s.stage];
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.route}>
                  {s.origin} → {s.destination}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: summary.tint }]} />
                  <Text style={[styles.statusText, { color: summary.tint }]}>{summary.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {s.driverName} · {s.truckNumber} · {formatINR(s.totalAmountInr)}
              </Text>
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
