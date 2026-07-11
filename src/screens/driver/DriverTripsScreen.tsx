/**
 * Driver — trips & payout tracking (Feature B, driver focus areas).
 * Reads the same escrow store as the payment dashboard, presented from the
 * driver's earnings perspective: what's been received vs. what's still
 * locked for each shipment.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTranslation } from '../../i18n/i18n';
import { splitAmounts, useEscrowStore } from '../../stores/useEscrowStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { EscrowShipment } from '../../types';
import { formatINR } from '../../utils/format';

function payoutSummary(shipment: EscrowShipment): { received: number; locked: number } {
  const { advanceInr, balanceInr } = splitAmounts(shipment);
  switch (shipment.stage) {
    case 'CREATED':
    case 'DISPATCHED':
      return { received: 0, locked: shipment.totalAmountInr };
    case 'ADVANCE_PAID':
    case 'POD_UPLOADED':
      return { received: advanceInr, locked: balanceInr };
    case 'BALANCE_RELEASED':
      return { received: shipment.totalAmountInr, locked: 0 };
  }
}

export function DriverTripsScreen(): React.JSX.Element {
  const t = useTranslation();
  const shipments = useEscrowStore((s) => s.shipments);

  const totals = shipments.reduce(
    (acc, s) => {
      const p = payoutSummary(s);
      return { received: acc.received + p.received, locked: acc.locked + p.locked };
    },
    { received: 0, locked: 0 },
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Earnings overview */}
        <View style={styles.totalsCard}>
          <View style={styles.totalCol}>
            <Text style={styles.totalValue}>{formatINR(totals.received)}</Text>
            <Text style={styles.totalLabel}>{t('advanceReceived')}</Text>
          </View>
          <View style={styles.totalsDivider} />
          <View style={styles.totalCol}>
            <Text style={[styles.totalValue, { color: colors.warning }]}>
              {formatINR(totals.locked)}
            </Text>
            <Text style={styles.totalLabel}>{t('lockedInEscrow')}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>My trips</Text>

        {shipments.map((s) => {
          const p = payoutSummary(s);
          const done = s.stage === 'BALANCE_RELEASED';
          return (
            <View key={s.id} style={styles.tripCard}>
              <View style={styles.tripTop}>
                <Text style={styles.tripRoute}>
                  {s.origin} → {s.destination}
                </Text>
                <Ionicons
                  name={done ? 'checkmark-done-circle' : 'time'}
                  size={20}
                  color={done ? colors.success : colors.warning}
                />
              </View>
              <Text style={styles.tripMeta}>
                {s.truckNumber} · {formatINR(s.totalAmountInr)} total
              </Text>
              <View style={styles.tripPayRow}>
                <Text style={styles.tripPayReceived}>{formatINR(p.received)} received</Text>
                <Text style={styles.tripPayLocked}>
                  {p.locked > 0 ? `${formatINR(p.locked)} in escrow` : 'Fully settled'}
                </Text>
              </View>
            </View>
          );
        })}

        {shipments.length === 0 && (
          <Text style={styles.emptyText}>No trips yet — accepted loads appear here.</Text>
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
  totalsCard: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...cardShadow,
  },
  totalCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  totalsDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  totalValue: {
    color: colors.textInverse,
    fontSize: fontSizes.xl,
    fontWeight: '800',
  },
  totalLabel: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.xs,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
    ...cardShadow,
  },
  tripTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripRoute: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  tripMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  tripPayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  tripPayReceived: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.success,
  },
  tripPayLocked: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.warning,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    paddingVertical: spacing.xl,
  },
});
