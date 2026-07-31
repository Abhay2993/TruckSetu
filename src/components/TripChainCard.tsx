/**
 * Multi-leg trip chaining — Delhi → Jaipur → Ajmer → Delhi booked as one
 * contract instead of three spot trips.
 *
 * Only a platform that can see all three legs at once can assemble this,
 * and it is positive-sum: the shipper pays less than three separate
 * bookings while the driver earns MORE, because the empty legs disappear.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMarketStore } from '../stores/useMarketStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { TripChainQuote } from '../types';
import { notify } from '../utils/dialog';
import { formatINR } from '../utils/format';

export function TripChainCard({
  quote,
  startCity,
  truckNumber,
}: {
  quote: TripChainQuote;
  startCity: string;
  truckNumber: string;
}): React.JSX.Element {
  const busy = useMarketStore((s) => s.busy);
  const bookChain = useMarketStore((s) => s.bookChain);

  const route = [startCity, ...quote.legs.map((l) => l.destination)].join(' → ');

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="link-variant" size={18} color={colors.primary} />
        <Text style={styles.title}>Chain {quote.legs.length} legs into one trip</Text>
        {quote.returnsToStart && (
          <View style={styles.loopChip}>
            <Text style={styles.loopChipText}>ROUND TRIP</Text>
          </View>
        )}
      </View>

      <Text style={styles.route}>{route}</Text>

      {quote.legs.map((leg, i) => (
        <View key={leg.loadId} style={styles.legRow}>
          <View style={styles.legIndex}>
            <Text style={styles.legIndexText}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.legRoute}>
              {leg.origin} → {leg.destination}
            </Text>
            <Text style={styles.legMeta}>{leg.material}</Text>
          </View>
          <Text style={styles.legPrice}>{formatINR(leg.priceInr)}</Text>
        </View>
      ))}

      <View style={styles.payoutBox}>
        <Text style={styles.payoutValue}>{formatINR(quote.driverPayoutInr)}</Text>
        <Text style={styles.payoutLabel}>
          you earn · {formatINR(quote.driverGainsInr)} more than booking these separately, because
          no leg runs empty
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Book chained trip"
        disabled={busy}
        onPress={() => {
          void bookChain(startCity, truckNumber).then((legs) => {
            if (legs > 0) {
              notify(
                'Chained trip booked',
                `${legs} legs confirmed as one contract. Each leg runs through escrow as usual.`,
              );
            }
          });
        }}
        style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.85 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Ionicons name="git-merge" size={16} color={colors.textInverse} />
        )}
        <Text style={styles.ctaText}>Book all {quote.legs.length} legs</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    ...cardShadow,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  loopChip: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  loopChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.accent,
  },
  route: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  legIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legIndexText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '800',
  },
  legRoute: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  legMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  legPrice: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  payoutBox: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  payoutValue: {
    fontSize: fontSizes.xl,
    fontWeight: '800',
    color: colors.success,
  },
  payoutLabel: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
});
