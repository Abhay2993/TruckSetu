/**
 * Assured return load — the guarantee, not the listing.
 *
 * "Drop in Jaipur and we commit a paying load out within 12 hours, or we
 * pay you ₹3,500 standby." Offered only where the board is deep enough to
 * honour it, which is exactly why a thin competitor cannot match it: the
 * promise is priced off liquidity, not code.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMarketStore } from '../stores/useMarketStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { GuaranteeOffer, ReturnGuarantee } from '../types';
import { notify } from '../utils/dialog';
import { formatINR } from '../utils/format';

function hoursLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 3600000));
}

export function ReturnGuaranteeCard({
  offer,
  active,
  shipmentId,
}: {
  offer: GuaranteeOffer;
  active: ReturnGuarantee | null;
  /** The inbound trip that earns the guarantee; null when not on a trip. */
  shipmentId: string | null;
}): React.JSX.Element | null {
  const busy = useMarketStore((s) => s.busy);
  const takeGuarantee = useMarketStore((s) => s.takeGuarantee);
  const claimStandby = useMarketStore((s) => s.claimStandby);

  // Nothing to show when the lane is thin and nothing is running.
  if (!active && !offer.available) {
    return (
      <View style={styles.unavailable}>
        <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
        <Text style={styles.unavailableText}>{offer.reason}</Text>
      </View>
    );
  }

  const claim = async () => {
    if (!active) return;
    const paid = await claimStandby(active.id);
    if (paid !== null) {
      notify('Standby fee paid', `${formatINR(paid)} credited — sorry we could not find you a load.`);
    }
  };

  return (
    <LinearGradient
      colors={[colors.success, '#146B2E']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.head}>
        <MaterialCommunityIcons name="shield-check" size={18} color={colors.textInverse} />
        <Text style={styles.title}>Assured return load</Text>
        {active && (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>
              {active.status === 'active'
                ? `${hoursLeft(active.expiresAt)}h left`
                : active.status === 'fulfilled'
                  ? 'HONOURED'
                  : active.status === 'paid'
                    ? 'PAID'
                    : 'STANDBY DUE'}
            </Text>
          </View>
        )}
      </View>

      {!active && (
        <>
          <Text style={styles.body}>
            Drop in {offer.city} and we will find you a paying load within {offer.windowHours}h — or
            we pay you {formatINR(offer.standbyFeeInr)} standby.
          </Text>
          <Text style={styles.reason}>{offer.reason}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Guarantee my return load"
            disabled={busy || !shipmentId}
            onPress={() => {
              if (!shipmentId) return;
              void takeGuarantee(shipmentId, offer.city).then(() =>
                notify(
                  'Return load guaranteed',
                  `We are working on a load out of ${offer.city}. If nothing lands in ${offer.windowHours}h, the standby fee is yours.`,
                ),
              );
            }}
            style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.85 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <Ionicons name="shield-checkmark" size={16} color={colors.success} />
            )}
            <Text style={styles.ctaText}>Guarantee my return load</Text>
          </Pressable>
        </>
      )}

      {active?.status === 'active' && (
        <Text style={styles.body}>
          Searching for a load out of {active.city}. If nothing is booked in{' '}
          {hoursLeft(active.expiresAt)}h, {formatINR(active.standbyFeeInr)} standby is yours.
        </Text>
      )}

      {active?.status === 'fulfilled' && (
        <Text style={styles.body}>
          We found you a return load in time — the guarantee was honoured. No empty run home.
        </Text>
      )}

      {active?.status === 'standby_due' && (
        <>
          <Text style={styles.body}>
            We could not find a load out of {active.city} in time. The standby fee is yours.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Claim standby fee"
            disabled={busy}
            onPress={() => void claim()}
            style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.85 }]}
          >
            <Ionicons name="cash" size={16} color={colors.success} />
            <Text style={styles.ctaText}>Claim {formatINR(active.standbyFeeInr)} standby</Text>
          </Pressable>
        </>
      )}

      {active?.status === 'paid' && (
        <Text style={styles.body}>
          {formatINR(active.standbyFeeInr)} standby paid. Sorry we could not fill your truck.
        </Text>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  statusChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusChipText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '800',
  },
  body: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    lineHeight: 19,
  },
  reason: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.xs,
    fontWeight: '700',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    marginTop: 2,
  },
  ctaText: {
    color: colors.success,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  unavailableText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontStyle: 'italic',
  },
});
