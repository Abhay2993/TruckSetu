/**
 * Fuel price tracker + fuel credit (driver feature).
 *
 * Diesel prices at towns along the active corridor, cheapest highlighted
 * with the per-litre saving vs the priciest stop — the difference decides
 * WHERE a 400-litre tank gets filled. The fuel-credit line surfaces the
 * escrow advance that landed on the fuel card (Feature C's Stage 1), which
 * is exactly the money this decision spends.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FUEL_PRICES } from '../data/mock';
import { useTranslation } from '../i18n/i18n';
import { api } from '../services/api';
import { splitAmounts, useEscrowStore } from '../stores/useEscrowStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { FuelPrice } from '../types';
import { formatINR } from '../utils/format';

export function FuelPriceCard(): React.JSX.Element {
  const t = useTranslation();
  const [prices, setPrices] = useState<FuelPrice[]>(FUEL_PRICES);
  const shipments = useEscrowStore((s) => s.shipments);

  useEffect(() => {
    // Server mode overrides the demo table; failures keep the local copy.
    api
      .fetchFuelPrices()
      .then((remote) => {
        if (remote && remote.length > 0) setPrices(remote);
      })
      .catch(() => {});
  }, []);

  const cheapest = prices.reduce((a, b) => (b.dieselInrPerLitre < a.dieselInrPerLitre ? b : a));
  const priciest = prices.reduce((a, b) => (b.dieselInrPerLitre > a.dieselInrPerLitre ? b : a));
  const savingPerLitre = priciest.dieselInrPerLitre - cheapest.dieselInrPerLitre;

  // Fuel credit = the advance sitting on the fuel card for the active trip.
  const funded = shipments.find((s) => s.stage === 'ADVANCE_PAID' || s.stage === 'POD_UPLOADED');
  const fuelCredit = funded ? splitAmounts(funded).advanceInr : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <MaterialCommunityIcons name="fuel" size={17} color={colors.accent} />
          <Text style={styles.title}>{t('fuelPricesTitle')}</Text>
        </View>
        <Text style={styles.subtitle}>₹/litre · NH-48</Text>
      </View>

      {prices.map((p) => {
        const isCheapest = p.city === cheapest.city;
        return (
          <View key={p.city} style={styles.row}>
            <Text style={[styles.city, isCheapest && styles.cheapestText]}>
              {p.city} <Text style={styles.state}>({p.state})</Text>
            </Text>
            {isCheapest && (
              <View style={styles.bestBadge}>
                <Ionicons name="trending-down" size={11} color={colors.success} />
                <Text style={styles.bestBadgeText}>
                  save ₹{savingPerLitre.toFixed(1)}/L
                </Text>
              </View>
            )}
            <Text style={[styles.price, isCheapest && styles.cheapestText]}>
              ₹{p.dieselInrPerLitre.toFixed(2)}
            </Text>
          </View>
        );
      })}

      <View style={styles.creditRow}>
        <Ionicons name="card" size={15} color={fuelCredit > 0 ? colors.success : colors.textMuted} />
        <Text style={[styles.creditText, fuelCredit > 0 && { color: colors.success }]}>
          {fuelCredit > 0
            ? `Fuel credit on card: ${formatINR(fuelCredit)} (trip advance)`
            : 'Fuel credit arrives with your next trip advance'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  city: {
    flex: 1,
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  state: {
    color: colors.textMuted,
    fontWeight: '400',
    fontSize: fontSizes.xs,
  },
  price: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  cheapestText: {
    color: colors.success,
  },
  bestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.successSoft,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bestBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.success,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: 2,
  },
  creditText: {
    flex: 1,
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});
