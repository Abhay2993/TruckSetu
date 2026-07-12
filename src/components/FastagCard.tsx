/**
 * Feature E — FASTag wallet card: current balance, low-balance warning and
 * an instant "Top Up via UPI" flow with quick-amount chips. All wallet state
 * lives in useFastagStore; this component is just the surface.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/i18n';
import { LOW_BALANCE_THRESHOLD_INR, useFastagStore } from '../stores/useFastagStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import { notify } from '../utils/dialog';
import { formatINR } from '../utils/format';

const QUICK_AMOUNTS = [500, 1000, 2000] as const;

export function FastagCard(): React.JSX.Element {
  const t = useTranslation();
  const balanceInr = useFastagStore((s) => s.balanceInr);
  const isToppingUp = useFastagStore((s) => s.isToppingUp);
  const topUp = useFastagStore((s) => s.topUp);
  const [selectedAmount, setSelectedAmount] = useState<number>(500);

  const isLow = balanceInr < LOW_BALANCE_THRESHOLD_INR;

  const handleTopUp = async () => {
    const ok = await topUp(selectedAmount);
    if (ok) {
      notify('Top-up successful', `${formatINR(selectedAmount)} added via UPI.`);
    } else {
      notify('Top-up failed', 'UPI payment could not be completed. Please try again.');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <MaterialCommunityIcons name="boom-gate" size={18} color={colors.textInverse} />
          <Text style={styles.title}>{t('fastagBalance')}</Text>
        </View>
        <Ionicons name="wallet" size={18} color={colors.textInverse} />
      </View>

      <Text style={styles.balance}>{formatINR(balanceInr)}</Text>

      {isLow && (
        <View style={styles.warningRow}>
          <Ionicons name="warning" size={14} color="#FFD54F" />
          <Text style={styles.warningText}>
            Low balance — below {formatINR(LOW_BALANCE_THRESHOLD_INR)}. Top up before the next toll plaza.
          </Text>
        </View>
      )}

      <View style={styles.topUpRow}>
        {QUICK_AMOUNTS.map((amount) => {
          const selected = amount === selectedAmount;
          return (
            <Pressable
              key={amount}
              accessibilityRole="button"
              onPress={() => setSelectedAmount(amount)}
              style={[styles.amountChip, selected && styles.amountChipSelected]}
            >
              <Text style={[styles.amountChipText, selected && styles.amountChipTextSelected]}>
                {formatINR(amount)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={handleTopUp}
        disabled={isToppingUp}
        style={({ pressed }) => [styles.upiButton, (pressed || isToppingUp) && styles.upiButtonPressed]}
      >
        {isToppingUp ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Ionicons name="flash" size={16} color={colors.primary} />
            <Text style={styles.upiButtonText}>{t('topUpViaUpi')}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary,
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
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    opacity: 0.9,
  },
  balance: {
    color: colors.textInverse,
    fontSize: fontSizes.xl,
    fontWeight: '800',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 213, 79, 0.15)',
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  warningText: {
    flex: 1,
    color: '#FFE082',
    fontSize: fontSizes.xs,
    fontWeight: '600',
  },
  topUpRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  amountChip: {
    flex: 1,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  amountChipSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: colors.textInverse,
  },
  amountChipText: {
    color: colors.textInverse,
    opacity: 0.75,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
  amountChipTextSelected: {
    opacity: 1,
  },
  upiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.textInverse,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  upiButtonPressed: {
    opacity: 0.75,
  },
  upiButtonText: {
    color: colors.primary,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
});
