/**
 * TruckSetu Money — the lending hub, one screen for both roles.
 *
 * Dealers see receivable discounting ("get paid today"); drivers see EMIs,
 * the fuel card, telemetry-priced insurance and truck finance. Both see the
 * revolving line their platform history has earned them.
 *
 * The framing is deliberate: every product states WHY the user qualifies —
 * settled trips, verified PODs, safe driving — because the score improving
 * with each trip is exactly what keeps them on the platform.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArtTrim } from '../../components/ArtTrim';
import { IndianTruck } from '../../components/IndianTruck';
import { MembershipCard } from '../../components/MembershipCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  EMI_CATALOGUE,
  EMI_TENORS,
  PARTNER_PUMPS,
  vehicleLoanQuote,
} from '../../services/money';
import { useAppStore } from '../../stores/useAppStore';
import { useMembershipStore } from '../../stores/useMembershipStore';
import { useMoneyStore } from '../../stores/useMoneyStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import { notify } from '../../utils/dialog';
import { formatINR } from '../../utils/format';

const DRAW_AMOUNTS = [10000, 25000, 50000] as const;
const LOAN_AMOUNTS = [600000, 1200000, 1800000] as const;
const LOAN_TENOR_MONTHS = 48;

export function MoneyScreen(): React.JSX.Element {
  const role = useAppStore((s) => s.role);
  const summary = useMoneyStore((s) => s.summary);
  const loading = useMoneyStore((s) => s.loading);
  const busy = useMoneyStore((s) => s.busy);
  const refresh = useMoneyStore((s) => s.refresh);
  const drawCredit = useMoneyStore((s) => s.drawCredit);
  const repayCredit = useMoneyStore((s) => s.repayCredit);
  const discountInvoice = useMoneyStore((s) => s.discountInvoice);
  const takeEmi = useMoneyStore((s) => s.takeEmi);
  const swipeFuelCard = useMoneyStore((s) => s.swipeFuelCard);
  const renewInsurance = useMoneyStore((s) => s.renewInsurance);
  const applyVehicleLoan = useMoneyStore((s) => s.applyVehicleLoan);
  const setBureauConsent = useMoneyStore((s) => s.setBureauConsent);

  const membership = useMembershipStore((s) => s.summary);
  const refreshMembership = useMembershipStore((s) => s.refresh);

  const [drawAmount, setDrawAmount] = useState<number>(10000);
  const [loanAmount, setLoanAmount] = useState<number>(1200000);

  useEffect(() => {
    void refresh();
    void refreshMembership();
  }, [refresh, refreshMembership]);

  if (!summary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const { score, facility, driving, fuelCard, emis, advances, discountable, insuranceQuote } =
    summary;
  const isDealer = role === 'dealer';
  const activeEmis = emis.filter((e) => e.status === 'active');
  const loanQuote = vehicleLoanQuote(score.score, loanAmount, LOAN_TENOR_MONTHS);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        {/* Hero: the score that prices everything below it */}
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroWatermark} pointerEvents="none">
            <IndianTruck width={190} shadow={false} />
          </View>
          <Text style={styles.heroKicker}>TruckSetu Money</Text>
          <View style={styles.heroScoreRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroScore}>{score.score}</Text>
              <Text style={styles.heroBand}>
                {isDealer ? 'Dealer score' : 'TruckScore™'} · {score.band}
              </Text>
            </View>
            <View style={styles.heroLimitBox}>
              <Text style={styles.heroLimitLabel}>Credit limit</Text>
              <Text style={styles.heroLimit}>{formatINR(facility.limitInr)}</Text>
            </View>
          </View>
          <ArtTrim height={6} opacity={0.9} />
          <View style={styles.factorWrap}>
            {score.factors.map((f) => (
              <View key={f.label} style={styles.factorChip}>
                <Ionicons
                  name={f.positive ? 'checkmark-circle' : 'remove-circle'}
                  size={11}
                  color={f.positive ? '#7FE0A0' : 'rgba(255,255,255,0.6)'}
                />
                <Text style={styles.factorText}>
                  {f.label}: {f.value}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* Suraksha membership — cover, savings, rewards (drivers only) */}
        {!isDealer && membership && <MembershipCard summary={membership} />}

        {/* Revolving working-capital line */}
        <Section
          icon="wallet"
          title="Working capital line"
          caption={`${facility.aprPercent}% p.a. · repaid automatically from your trip settlements`}
        >
          <View style={styles.lineRow}>
            <Stat label="Available" value={formatINR(facility.availableInr)} tint={colors.success} />
            <Stat label="Drawn" value={formatINR(facility.drawnInr)} tint={colors.warning} />
          </View>
          <View style={styles.chipRow}>
            {DRAW_AMOUNTS.map((amount) => (
              <Chip
                key={amount}
                label={formatINR(amount)}
                selected={amount === drawAmount}
                onPress={() => setDrawAmount(amount)}
              />
            ))}
          </View>
          <PrimaryButton
            label={`Draw ${formatINR(drawAmount)}`}
            icon="flash"
            busy={busy}
            disabled={drawAmount > facility.availableInr}
            onPress={() => {
              if (drawAmount > facility.availableInr) return;
              void drawCredit(drawAmount).then(() =>
                notify('Money on the way', `${formatINR(drawAmount)} credited to your account.`),
              );
            }}
          />
          {facility.drawnInr > 0 && (
            <SecondaryButton
              label={`Repay ${formatINR(Math.min(facility.drawnInr, drawAmount))}`}
              icon="arrow-undo"
              onPress={() => void repayCredit(Math.min(facility.drawnInr, drawAmount))}
            />
          )}
        </Section>

        {/* Dealer: turn a settled receivable into cash today */}
        {isDealer && (
          <Section
            icon="cash"
            title="Get paid today"
            caption="Discount a settled invoice — we collect from your consignor at maturity"
          >
            {discountable.length === 0 && advances.length === 0 && (
              <Text style={styles.empty}>
                Settled invoices appear here. Complete a shipment to unlock same-day cash.
              </Text>
            )}
            {discountable.map((inv) => (
              <View key={inv.shipmentId} style={styles.invoiceRow}>
                <View style={styles.invoiceTop}>
                  <Text style={styles.invoiceNo}>{inv.invoiceNo}</Text>
                  <Text style={styles.invoiceFace}>{formatINR(inv.faceValueInr)}</Text>
                </View>
                <Text style={styles.invoiceMeta}>{inv.route}</Text>
                <View style={styles.chipRow}>
                  <TermButton
                    days={30}
                    netInr={inv.quote30.netInr}
                    feeInr={inv.quote30.feeInr}
                    onPress={() => void discountInvoice(inv.shipmentId, 30)}
                  />
                  <TermButton
                    days={60}
                    netInr={inv.quote60.netInr}
                    feeInr={inv.quote60.feeInr}
                    onPress={() => void discountInvoice(inv.shipmentId, 60)}
                  />
                </View>
              </View>
            ))}
            {advances.map((a) => (
              <View key={a.id} style={styles.advanceRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={styles.advanceText}>
                  {a.invoiceNo}: {formatINR(a.netInr)} paid · fee {formatINR(a.feeInr)} ·{' '}
                  {a.termDays}-day term
                </Text>
              </View>
            ))}
          </Section>
        )}

        {/* Driver: point-of-need EMIs */}
        {!isDealer && (
          <Section
            icon="construct"
            title="Tyres & repairs on EMI"
            caption="Approved on your trip history — instalments come out of future settlements"
          >
            {activeEmis.map((plan) => (
              <View key={plan.id} style={styles.emiActive}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emiActiveLabel}>{plan.itemLabel}</Text>
                  <Text style={styles.emiActiveMeta}>
                    {formatINR(plan.monthlyInr)}/mo · {plan.paidInstalments}/{plan.tenorMonths} paid ·{' '}
                    {formatINR(plan.outstandingInr)} left
                  </Text>
                </View>
                <MaterialCommunityIcons name="calendar-check" size={18} color={colors.success} />
              </View>
            ))}
            {EMI_CATALOGUE.map((item) => (
              <EmiOffer
                key={item.id}
                label={item.label}
                priceInr={item.priceInr}
                onTake={(tenor) =>
                  void takeEmi(item.id, tenor).then(() =>
                    notify('EMI approved', `${item.label} — auto-paid from your trip settlements.`),
                  )
                }
              />
            ))}
          </Section>
        )}

        {/* Driver: co-branded fuel card */}
        {!isDealer && (
          <Section
            icon="card"
            title="TruckSetu fuel card"
            caption={`₹1.50/litre off at partner pumps · card ending ${fuelCard.last4}`}
          >
            <View style={styles.lineRow}>
              <Stat label="Saved so far" value={formatINR(fuelCard.savedInr)} tint={colors.success} />
              <Stat label="Card dues" value={formatINR(fuelCard.outstandingInr)} tint={colors.warning} />
            </View>
            <View style={styles.chipRow}>
              {PARTNER_PUMPS.slice(0, 2).map((pump) => (
                <Pressable
                  key={pump.name}
                  accessibilityRole="button"
                  onPress={() =>
                    void swipeFuelCard(pump.name, 60).then(() =>
                      notify('Fuelled up', `60 L at ${pump.city} — rebate and cashback applied.`),
                    )
                  }
                  style={({ pressed }) => [styles.pumpBtn, pressed && { opacity: 0.8 }]}
                >
                  <MaterialCommunityIcons name="fuel" size={14} color={colors.primary} />
                  <Text style={styles.pumpBtnText}>Fill 60 L · {pump.city}</Text>
                </Pressable>
              ))}
            </View>
            {fuelCard.transactions.slice(0, 3).map((tx) => (
              <Text key={tx.id} style={styles.txLine}>
                {tx.pump} · {tx.litres} L · {formatINR(tx.amountInr)}{' '}
                <Text style={{ color: colors.success }}>
                  (saved {formatINR(tx.discountInr + tx.cashbackInr)})
                </Text>
              </Text>
            ))}
          </Section>
        )}

        {/* Driver: telemetry-priced insurance */}
        {!isDealer && (
          <Section
            icon="shield-checkmark"
            title="Insurance priced on your driving"
            caption={
              driving
                ? `Driving score ${driving.score}/100 · ${driving.band} — ${driving.discountPercent}% off`
                : 'Drive a few more trips to unlock a safe-driving discount'
            }
          >
            <View style={styles.premiumRow}>
              <Text style={styles.premiumStrike}>{formatINR(insuranceQuote.basePremiumInr)}</Text>
              <Text style={styles.premiumNow}>{formatINR(insuranceQuote.premiumInr)}</Text>
              <Text style={styles.premiumPer}>/ year</Text>
            </View>
            <Text style={styles.premiumNote}>
              {formatINR(insuranceQuote.sumInsuredInr)} cover · you save{' '}
              {formatINR(insuranceQuote.savedInr)} because your telemetry proves it.
            </Text>
            <PrimaryButton
              label="Renew at this price"
              icon="shield-checkmark"
              busy={busy}
              disabled={false}
              onPress={() =>
                void renewInsurance(insuranceQuote.sumInsuredInr).then(() =>
                  notify('Policy issued', 'Your goods-in-transit cover is active for 12 months.'),
                )
              }
            />
          </Section>
        )}

        {/* Driver: truck finance */}
        {!isDealer && (
          <Section
            icon="car-sport"
            title="Buy or refinance a truck"
            caption={`Your score prices this at ${loanQuote.aprPercent}% p.a. — eligible up to ${formatINR(loanQuote.maxEligibleInr)}`}
          >
            <View style={styles.chipRow}>
              {LOAN_AMOUNTS.map((amount) => (
                <Chip
                  key={amount}
                  label={`₹${Math.round(amount / 100000)}L`}
                  selected={amount === loanAmount}
                  onPress={() => setLoanAmount(amount)}
                />
              ))}
            </View>
            <Text style={styles.loanEmi}>
              {formatINR(loanQuote.emiInr)}<Text style={styles.loanEmiSub}> / month · {LOAN_TENOR_MONTHS} months</Text>
            </Text>
            <PrimaryButton
              label={loanQuote.eligible ? 'Apply now' : 'Above your current limit'}
              icon="document-text"
              busy={busy}
              disabled={!loanQuote.eligible}
              onPress={() =>
                void applyVehicleLoan(loanAmount, LOAN_TENOR_MONTHS, 'purchase').then(() =>
                  notify(
                    'Application submitted',
                    'In-principle approved on your TruckSetu history. Our lending partner will confirm after KYC and vehicle valuation.',
                  ),
                )
              }
            />
          </Section>
        )}

        {/* Bureau consent — the user owns their score */}
        <View style={styles.consentCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentTitle}>Share my TruckScore with lenders</Text>
            <Text style={styles.consentSub}>
              Banks and NBFCs can check your score to offer you cheaper credit. Nothing is shared
              until you switch this on.
            </Text>
          </View>
          <Switch
            value={summary.bureauConsent}
            onValueChange={(v) => void setBureauConsent(v)}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.surface}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Local presentational pieces
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  caption,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardCaption}>{caption}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function TermButton({
  days,
  netInr,
  feeInr,
  onPress,
}: {
  days: number;
  netInr: number;
  feeInr: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Discount ${days} day term`}
      onPress={onPress}
      style={({ pressed }) => [styles.termBtn, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.termNet}>{formatINR(netInr)}</Text>
      <Text style={styles.termMeta}>
        now · {days}d · fee {formatINR(feeInr)}
      </Text>
    </Pressable>
  );
}

function EmiOffer({
  label,
  priceInr,
  onTake,
}: {
  label: string;
  priceInr: number;
  onTake: (tenorMonths: number) => void;
}): React.JSX.Element {
  const [tenor, setTenor] = useState<number>(6);
  return (
    <View style={styles.emiOffer}>
      <View style={styles.emiTop}>
        <Text style={styles.emiLabel}>{label}</Text>
        <Text style={styles.emiPrice}>{formatINR(priceInr)}</Text>
      </View>
      <View style={styles.chipRow}>
        {EMI_TENORS.map((months) => (
          <Chip
            key={months}
            label={`${months}m`}
            selected={months === tenor}
            onPress={() => setTenor(months)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Take EMI for ${label}`}
          onPress={() => onTake(tenor)}
          style={({ pressed }) => [styles.emiTake, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.emiTakeText}>Take EMI</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <Ionicons name={icon} size={16} color={colors.textInverse} />
      )}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  hero: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    overflow: 'hidden',
    ...cardShadow,
  },
  heroWatermark: {
    position: 'absolute',
    right: -34,
    bottom: -10,
    opacity: 0.1,
  },
  heroKicker: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.xs,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  heroScore: {
    color: colors.textInverse,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 48,
  },
  heroBand: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
  heroLimitBox: { alignItems: 'flex-end' },
  heroLimitLabel: {
    color: colors.textInverse,
    opacity: 0.75,
    fontSize: fontSizes.xs,
    fontWeight: '700',
  },
  heroLimit: {
    color: colors.accent,
    fontSize: fontSizes.xl,
    fontWeight: '800',
  },
  factorWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  factorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  factorText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  cardCaption: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  lineRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  statValue: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  chipTextSelected: { color: colors.textInverse },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
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
  secondaryBtnText: {
    color: colors.primary,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
  empty: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  invoiceRow: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  invoiceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceNo: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  invoiceFace: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  invoiceMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  termBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
  },
  termNet: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  termMeta: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: 10,
    fontWeight: '600',
  },
  advanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  advanceText: {
    flex: 1,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  emiActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  emiActiveLabel: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emiActiveMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  emiOffer: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  emiTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emiLabel: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emiPrice: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emiTake: {
    marginLeft: 'auto',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  emiTakeText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  pumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pumpBtnText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.primary,
  },
  txLine: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  premiumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  premiumStrike: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  premiumNow: {
    fontSize: fontSizes.xl,
    fontWeight: '800',
    color: colors.success,
  },
  premiumPer: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  premiumNote: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  loanEmi: {
    fontSize: fontSizes.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  loanEmiSub: {
    fontSize: fontSizes.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  consentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...cardShadow,
  },
  consentTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  consentSub: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
