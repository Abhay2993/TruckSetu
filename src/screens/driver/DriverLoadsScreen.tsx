/**
 * Return-load finder (backhaul matching) — the driver's biggest earner.
 *
 * Matching rule, deliberately simple and explainable: loads whose ORIGIN is
 * the destination of the driver's active trip surface first ("you're
 * heading to Jaipur — here's what pays you to drive home"), everything else
 * open follows. Bidding reuses the existing load-board machinery
 * (useLoadsStore.placeBid → POST /v1/loads/:id/bids in server mode).
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTranslation } from '../../i18n/i18n';
import { estimateTripPnl } from '../../services/tripPnl';
import { useDriverStore } from '../../stores/useDriverStore';
import { useEscrowStore } from '../../stores/useEscrowStore';
import { useLoadsStore } from '../../stores/useLoadsStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { Load } from '../../types';
import { notify } from '../../utils/dialog';
import { formatINR, timeAgo } from '../../utils/format';

export function DriverLoadsScreen(): React.JSX.Element {
  const t = useTranslation();
  const loads = useLoadsStore((s) => s.loads);
  const shipments = useEscrowStore((s) => s.shipments);
  const [biddingOn, setBiddingOn] = useState<Load | null>(null);

  // The driver's active trip decides what counts as a "return" load.
  const activeTrip = shipments.find((s) => s.stage !== 'BALANCE_RELEASED');
  const tripDestination = activeTrip?.destination ?? 'Jaipur';

  const { returnLoads, otherLoads } = useMemo(() => {
    const open = loads.filter((l) => l.status === 'open');
    return {
      returnLoads: open.filter((l) => l.origin === tripDestination),
      otherLoads: open.filter((l) => l.origin !== tripDestination),
    };
  }, [loads, tripDestination]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.contextCard}>
          <MaterialCommunityIcons name="truck-delivery" size={20} color={colors.accent} />
          <Text style={styles.contextText}>
            Delivering to <Text style={styles.contextCity}>{tripDestination}</Text> — loads out of{' '}
            {tripDestination} first, so you never drive back empty.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>
          {t('returnLoads')} · {tripDestination}
        </Text>
        {returnLoads.map((load) => (
          <LoadRow key={load.id} load={load} highlight onBid={() => setBiddingOn(load)} />
        ))}
        {returnLoads.length === 0 && (
          <Text style={styles.emptyText}>No loads out of {tripDestination} right now — check back soon.</Text>
        )}

        {otherLoads.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>More open loads</Text>
            {otherLoads.map((load) => (
              <LoadRow key={load.id} load={load} onBid={() => setBiddingOn(load)} />
            ))}
          </>
        )}
      </ScrollView>

      <BidModal load={biddingOn} onClose={() => setBiddingOn(null)} />
    </SafeAreaView>
  );
}

function LoadRow({
  load,
  highlight = false,
  onBid,
}: {
  load: Load;
  highlight?: boolean;
  onBid: () => void;
}): React.JSX.Element {
  const t = useTranslation();
  const myBid = load.bids.find((b) => b.driverName === 'You');
  return (
    <View style={[styles.loadCard, highlight && styles.loadCardHighlight]}>
      <View style={styles.loadTop}>
        <Text style={styles.loadRoute}>
          {load.origin} → {load.destination}
        </Text>
        <Text style={styles.loadPrice}>{formatINR(load.priceInr)}</Text>
      </View>
      <Text style={styles.loadMeta}>
        {load.material} · {load.weightTonnes} T · {load.advancePercent}% advance ·{' '}
        {timeAgo(load.postedAt)} · {load.bids.length} bid{load.bids.length === 1 ? '' : 's'}
      </Text>
      {myBid ? (
        <View style={styles.myBidRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text style={styles.myBidText}>Your bid: {formatINR(myBid.amountInr)} — waiting for the dealer</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onBid}
          style={({ pressed }) => [styles.bidBtn, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="hammer" size={14} color={colors.textInverse} />
          <Text style={styles.bidBtnText}>{t('placeBid')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function BidModal({ load, onClose }: { load: Load | null; onClose: () => void }): React.JSX.Element {
  const t = useTranslation();
  const placeBid = useLoadsStore((s) => s.placeBid);
  const truckNumber = useDriverStore((s) => s.truckNumber);
  const setTruckNumber = useDriverStore((s) => s.setTruckNumber);
  const [amount, setAmount] = useState('');
  const [truck, setTruck] = useState('');

  // Reset per load; default the ask to the dealer's price.
  const visible = load !== null;
  React.useEffect(() => {
    if (load) {
      setAmount(String(load.priceInr));
      setTruck(truckNumber);
    }
  }, [load, truckNumber]);

  // Trip P&L: recompute live as the driver types their ask, so the bid is a
  // decision ("this leaves me ₹6,200") instead of guesswork.
  const askInr = Number(amount);
  const pnl =
    load && Number.isFinite(askInr) && askInr > 0
      ? estimateTripPnl(load.origin, load.destination, askInr)
      : null;

  const submit = async () => {
    if (!load) return;
    const amountInr = Number(amount);
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      notify('Invalid amount', 'Enter your asking freight in rupees.');
      return;
    }
    if (!truck.trim()) {
      notify('Truck number needed', 'Enter your truck registration number.');
      return;
    }
    setTruckNumber(truck.trim()); // remember for next time
    try {
      await placeBid(load.id, amountInr, truck.trim());
      onClose();
      notify('Bid placed', `${formatINR(amountInr)} for ${load.origin} → ${load.destination}. The dealer will review it.`);
    } catch (e) {
      notify('Could not place bid', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {t('placeBid')} · {load?.origin} → {load?.destination}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close bid sheet" onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Your freight ask (₹)"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />
          <TextInput
            style={styles.input}
            placeholder="Truck number (e.g. PB 10 AB 4321)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            value={truck}
            onChangeText={setTruck}
          />

          {pnl && (
            <View style={[styles.pnlCard, pnl.profitInr < 0 && styles.pnlCardLoss]}>
              <View style={styles.pnlHeader}>
                <Ionicons
                  name={pnl.profitInr >= 0 ? 'trending-up' : 'trending-down'}
                  size={16}
                  color={pnl.profitInr >= 0 ? colors.success : colors.danger}
                />
                <Text
                  style={[
                    styles.pnlProfit,
                    { color: pnl.profitInr >= 0 ? colors.success : colors.danger },
                  ]}
                >
                  Est. profit {formatINR(pnl.profitInr)}
                </Text>
                <Text style={styles.pnlKm}>{pnl.distanceKm} km</Text>
              </View>
              <Text style={styles.pnlBreakdown}>
                Diesel {formatINR(pnl.dieselInr)} ({pnl.dieselLitres}L) · Tolls{' '}
                {formatINR(pnl.tollsInr)} · Food/stay {formatINR(pnl.bhattaInr)}
              </Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void submit()}
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.submitBtnText}>{t('placeBid')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  contextText: {
    flex: 1,
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
  },
  contextCity: {
    fontWeight: '800',
    color: colors.accent,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  loadCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  loadCardHighlight: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  loadTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loadRoute: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  loadPrice: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.accent,
  },
  loadMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  myBidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  myBidText: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.success,
  },
  bidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
  },
  bidBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
  emptyText: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 42, 92, 0.45)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalTitle: {
    flex: 1,
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSizes.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  pnlCard: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: 4,
  },
  pnlCardLoss: {
    backgroundColor: colors.dangerSoft,
  },
  pnlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pnlProfit: {
    flex: 1,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  pnlKm: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  pnlBreakdown: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  submitBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
});
