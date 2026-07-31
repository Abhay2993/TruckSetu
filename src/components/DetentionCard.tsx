/**
 * Detention & demurrage — waiting time, evidenced and billed.
 *
 * Trucks routinely wait 6–20 hours to load or unload and almost nobody
 * pays for it, because nobody can prove it. Here the arrival/departure
 * timestamps come from geofenced GPS (or an explicit tap), the free-time
 * terms are the ones both parties eSigned on the digital LR, and the charge
 * lands on the invoice. Neutral evidence is the whole product.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEscrowStore } from '../stores/useEscrowStore';
import { DETENTION, billableHours } from '../services/tripRecord';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { EscrowShipment } from '../types';
import { formatINR } from '../utils/format';

function Stop({
  label,
  arrivedAt,
  departedAt,
  hours,
}: {
  label: string;
  arrivedAt: number | null;
  departedAt: number | null;
  hours: number | null;
}): React.JSX.Element {
  const billable = hours !== null ? billableHours(hours) : 0;
  return (
    <View style={styles.stopRow}>
      <MaterialCommunityIcons
        name={hours !== null ? 'timer-sand-complete' : 'timer-sand'}
        size={15}
        color={billable > 0 ? colors.warning : colors.textMuted}
      />
      <Text style={styles.stopLabel}>{label}</Text>
      <Text style={styles.stopValue}>
        {hours !== null
          ? `${hours}h${billable > 0 ? ` · ${billable}h billable` : ' · within free time'}`
          : arrivedAt
            ? 'in progress'
            : 'not started'}
      </Text>
    </View>
  );
}

export function DetentionCard({
  shipment,
  role,
}: {
  shipment: EscrowShipment;
  role: 'dealer' | 'driver';
}): React.JSX.Element {
  const stampDetention = useEscrowStore((s) => s.stampDetention);
  const d = shipment.detention;
  const charge = d?.chargeInr ?? 0;

  // The next timestamp the driver would record, in trip order.
  const nextStamp: { stop: 'origin' | 'destination'; event: 'arrived' | 'departed'; label: string } | null =
    !d?.originArrivedAt
      ? { stop: 'origin', event: 'arrived', label: `Arrived at ${shipment.origin}` }
      : !d?.originDepartedAt
        ? { stop: 'origin', event: 'departed', label: `Loaded — left ${shipment.origin}` }
        : !d?.destinationArrivedAt
          ? { stop: 'destination', event: 'arrived', label: `Arrived at ${shipment.destination}` }
          : !d?.destinationDepartedAt
            ? { stop: 'destination', event: 'departed', label: `Unloaded — left ${shipment.destination}` }
            : null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="hourglass" size={16} color={charge > 0 ? colors.warning : colors.primary} />
        <Text style={styles.title}>Detention & demurrage</Text>
        {charge > 0 && (
          <View style={[styles.chip, d?.settled && { backgroundColor: colors.successSoft }]}>
            <Text style={[styles.chipText, d?.settled && { color: colors.success }]}>
              {d?.settled ? 'SETTLED' : formatINR(charge)}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.terms}>
        {DETENTION.FREE_HOURS}h free at each stop, then {formatINR(DETENTION.RATE_INR_PER_HOUR)}/hour
        (max {formatINR(DETENTION.MAX_INR_PER_STOP)}) — from GPS timestamps both sides can check.
      </Text>

      <Stop
        label="Loading"
        arrivedAt={d?.originArrivedAt ?? null}
        departedAt={d?.originDepartedAt ?? null}
        hours={d?.loadingHours ?? null}
      />
      <Stop
        label="Unloading"
        arrivedAt={d?.destinationArrivedAt ?? null}
        departedAt={d?.destinationDepartedAt ?? null}
        hours={d?.unloadingHours ?? null}
      />

      {charge > 0 && !d?.settled && (
        <Text style={styles.charge}>
          {formatINR(charge)} detention {role === 'dealer' ? 'payable' : 'owed to you'} — added to
          the invoice for this trip.
        </Text>
      )}

      {role === 'driver' && nextStamp && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record detention timestamp"
          onPress={() =>
            void stampDetention(shipment.id, nextStamp.stop, nextStamp.event, Date.now())
          }
          style={({ pressed }) => [styles.stampBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialCommunityIcons name="clock-check-outline" size={14} color={colors.primary} />
          <Text style={styles.stampBtnText}>{nextStamp.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  chip: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warning,
  },
  terms: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopLabel: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textPrimary,
    width: 64,
  },
  stopValue: {
    flex: 1,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  charge: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.warning,
  },
  stampBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    marginTop: 2,
  },
  stampBtnText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.primary,
  },
});
