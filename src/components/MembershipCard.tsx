/**
 * Suraksha membership — the benefits a driver does not want to lose.
 *
 * Health and accident cover for the family, savings with a tier match, and
 * a locked micro-pension. The tier is earned off the same TruckScore that
 * prices credit, so the card also shows exactly what the next tier is worth
 * and what it takes to get there: the driver can see that improving their
 * record pays twice.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ArtTrim } from './ArtTrim';
import { SAVINGS } from '../services/membership';
import { useMembershipStore } from '../stores/useMembershipStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { MembershipSummary, Tier } from '../types';
import { notify } from '../utils/dialog';
import { formatINR } from '../utils/format';

const TIER_COLORS: Record<Tier, [string, string]> = {
  Bronze: ['#8D6E63', '#5D4037'],
  Silver: ['#78909C', '#455A64'],
  Gold: ['#C79A28', '#8D6E11'],
  Platinum: ['#37474F', '#1C262B'],
};

const SKIM_OPTIONS = [0, 3, 5, 10] as const;

export function MembershipCard({ summary }: { summary: MembershipSummary }): React.JSX.Element {
  const setSkim = useMembershipStore((s) => s.setSkim);
  const withdraw = useMembershipStore((s) => s.withdraw);
  const redeem = useMembershipStore((s) => s.redeem);
  const busy = useMembershipStore((s) => s.busy);
  const [showBenefits, setShowBenefits] = useState(false);

  const { benefits, progress, next, savings, rewards } = summary;
  const colours = TIER_COLORS[benefits.tier];

  return (
    <>
      {/* Tier + cover */}
      <LinearGradient
        colors={colours}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.tierCard}
      >
        <View style={styles.tierHead}>
          <MaterialCommunityIcons name="shield-star" size={20} color={colors.textInverse} />
          <Text style={styles.tierKicker}>TruckSetu Suraksha</Text>
        </View>
        <Text style={styles.tierName}>{benefits.tier}</Text>
        <ArtTrim height={6} opacity={0.9} />

        <View style={styles.coverRow}>
          <View style={styles.coverBox}>
            <Text style={styles.coverValue}>{formatINR(benefits.healthCoverInr)}</Text>
            <Text style={styles.coverLabel}>Family health cover</Text>
          </View>
          <View style={styles.coverBox}>
            <Text style={styles.coverValue}>{formatINR(benefits.accidentCoverInr)}</Text>
            <Text style={styles.coverLabel}>Accident cover</Text>
          </View>
        </View>

        <Text style={styles.tierMeta}>
          {benefits.legalCasesPerYear} legal cases · {benefits.breakdownCalloutsPerYear} breakdown
          callouts · {benefits.breakdownSlaMinutes} min SLA
        </Text>

        {next && (
          <View style={styles.nextBox}>
            <Text style={styles.nextText}>
              {progress.needTrips > 0
                ? `${progress.needTrips} more settled trip${progress.needTrips > 1 ? 's' : ''}`
                : 'Score'}
              {progress.needScore > 0 ? ` and +${progress.needScore} TruckScore` : ''} unlocks{' '}
              {next.tier}: {formatINR(next.healthCoverInr)} cover, {next.cashbackPercent}% cashback.
            </Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View membership benefits"
          onPress={() => setShowBenefits((v) => !v)}
          style={styles.benefitsToggle}
        >
          <Text style={styles.benefitsToggleText}>
            {showBenefits ? 'Hide' : 'What is covered?'}
          </Text>
          <Ionicons
            name={showBenefits ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textInverse}
          />
        </Pressable>

        {showBenefits && (
          <View style={styles.benefitsList}>
            {[
              `Hospitalisation for you, your spouse and 2 children up to ${formatINR(benefits.healthCoverInr)}`,
              `Personal accident cover of ${formatINR(benefits.accidentCoverInr)}, paid to your family`,
              `${benefits.legalCasesPerYear} advocate-backed legal cases a year (challan, RTO, police)`,
              `${benefits.breakdownCalloutsPerYear} roadside callouts, mechanic within ${benefits.breakdownSlaMinutes} minutes`,
              `${benefits.cashbackPercent}% cashback on fuel and toll spend`,
              benefits.savingsMatchPercent > 0
                ? `${benefits.savingsMatchPercent}% TruckSetu match on everything you save`
                : 'Savings match unlocks at Silver',
            ].map((line) => (
              <View key={line} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle" size={13} color="#9AE6B4" />
                <Text style={styles.benefitText}>{line}</Text>
              </View>
            ))}
          </View>
        )}
      </LinearGradient>

      {/* Savings + pension */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.cardIcon}>
            <MaterialCommunityIcons name="piggy-bank" size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Savings & pension</Text>
            <Text style={styles.cardCaption}>
              Saved automatically from each settled trip, before the money reaches you
            </Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {formatINR(savings.savingsInr)}
            </Text>
            <Text style={styles.statLabel}>Savings · withdraw anytime</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {formatINR(savings.pensionInr)}
            </Text>
            <Text style={styles.statLabel}>Pension · locked to {SAVINGS.PENSION_UNLOCK_AGE}</Text>
          </View>
        </View>

        {savings.matchedInr > 0 && (
          <Text style={styles.matchLine}>
            + {formatINR(savings.matchedInr)} added by TruckSetu as your {benefits.tier} match
          </Text>
        )}

        <Text style={styles.skimLabel}>Save this much from every trip</Text>
        <View style={styles.chipRow}>
          {SKIM_OPTIONS.map((percent) => (
            <Pressable
              key={percent}
              accessibilityRole="button"
              accessibilityLabel={`Save ${percent} percent`}
              onPress={() => void setSkim(percent)}
              style={[styles.chip, savings.skimPercent === percent && styles.chipOn]}
            >
              <Text
                style={[
                  styles.chipText,
                  savings.skimPercent === percent && styles.chipTextOn,
                ]}
              >
                {percent === 0 ? 'Off' : `${percent}%`}
              </Text>
            </Pressable>
          ))}
        </View>

        {savings.savingsInr > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Withdraw savings"
            disabled={busy}
            onPress={() => {
              void withdraw(savings.savingsInr, 'savings').then((reason) => {
                if (reason) notify('Withdrawal sent', reason);
              });
            }}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="cash-outline" size={15} color={colors.primary} />
            <Text style={styles.secondaryBtnText}>
              Withdraw {formatINR(savings.savingsInr)}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Rewards */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.cardIcon}>
            <MaterialCommunityIcons name="gift" size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Rewards</Text>
            <Text style={styles.cardCaption}>
              {rewards.cashbackPercent}% back on fuel and toll at {rewards.tier}
            </Text>
          </View>
          <Text style={styles.rewardValue}>{formatINR(rewards.availableInr)}</Text>
        </View>

        {rewards.nextTierWouldHavePaidInr !== null &&
          rewards.nextTierWouldHavePaidInr > rewards.earnedInr && (
            <Text style={styles.upsell}>
              At {next?.tier} the same spend would have paid{' '}
              {formatINR(rewards.nextTierWouldHavePaidInr)}.
            </Text>
          )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Redeem cashback"
          disabled={busy || rewards.availableInr <= 0}
          onPress={() => {
            void redeem(rewards.availableInr).then(() =>
              notify('Cashback redeemed', 'Credited to your FASTag wallet.'),
            );
          }}
          style={({ pressed }) => [
            styles.primaryBtn,
            (busy || rewards.availableInr <= 0) && { opacity: 0.5 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="wallet" size={15} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Move cashback to FASTag</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tierCard: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierKicker: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.xs,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tierName: {
    color: colors.textInverse,
    fontSize: fontSizes.display,
    fontWeight: '800',
    lineHeight: 40,
  },
  coverRow: { flexDirection: 'row', gap: spacing.sm },
  coverBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  coverValue: {
    color: colors.textInverse,
    fontSize: fontSizes.lg,
    fontWeight: '800',
  },
  coverLabel: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.xs,
  },
  tierMeta: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.xs,
    fontWeight: '600',
  },
  nextBox: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  nextText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    lineHeight: 17,
    fontWeight: '600',
  },
  benefitsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  benefitsToggleText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  benefitsList: { gap: 5 },
  benefitRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  benefitText: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    lineHeight: 17,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: fontSizes.md, fontWeight: '800', color: colors.textPrimary },
  cardCaption: { fontSize: fontSizes.xs, color: colors.textSecondary, marginTop: 1 },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  statValue: { fontSize: fontSizes.lg, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },
  matchLine: { fontSize: fontSizes.xs, color: colors.success, fontWeight: '700' },
  skimLabel: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSizes.xs, fontWeight: '800', color: colors.textSecondary },
  chipTextOn: { color: colors.textInverse },
  rewardValue: { fontSize: fontSizes.xl, fontWeight: '800', color: colors.accent },
  upsell: { fontSize: fontSizes.xs, color: colors.textSecondary },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSizes.sm, fontWeight: '800' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  secondaryBtnText: { color: colors.primary, fontSize: fontSizes.sm, fontWeight: '800' },
});
