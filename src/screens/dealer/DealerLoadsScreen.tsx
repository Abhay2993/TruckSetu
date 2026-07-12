/**
 * Dealer — load board: post new loads and manage bidding (Feature B, dealer
 * focus areas). Accepting a bid hands the load off to the escrow pipeline
 * (see useLoadsStore.acceptBid), after which it shows up on the Payments tab.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
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
import { useLoadsStore } from '../../stores/useLoadsStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { Load } from '../../types';
import { confirmAction, notify } from '../../utils/dialog';
import { formatINR, timeAgo } from '../../utils/format';

export function DealerLoadsScreen(): React.JSX.Element {
  const t = useTranslation();
  const loads = useLoadsStore((s) => s.loads);
  const acceptBid = useLoadsStore((s) => s.acceptBid);
  const [showPostModal, setShowPostModal] = useState(false);

  const handleAccept = async (load: Load, bidId: string, driverName: string) => {
    const ok = await confirmAction(
      'Accept bid?',
      `Book ${driverName} for ${load.origin} → ${load.destination}? An escrow shipment will be created.`,
      'Accept',
    );
    if (!ok) return;
    try {
      await acceptBid(load.id, bidId);
    } catch (e) {
      notify('Could not accept bid', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowPostModal(true)}
          style={({ pressed }) => [styles.postButton, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="add-circle" size={20} color={colors.textInverse} />
          <Text style={styles.postButtonText}>{t('bookLoad')}</Text>
        </Pressable>

        {loads.map((load) => (
          <View key={load.id} style={styles.loadCard}>
            <View style={styles.loadTop}>
              <Text style={styles.loadRoute}>
                {load.origin} → {load.destination}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: load.status === 'open' ? colors.accentSoft : colors.successSoft },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: load.status === 'open' ? colors.warning : colors.success },
                  ]}
                >
                  {load.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.loadMeta}>
              {load.material} · {load.weightTonnes} T · {formatINR(load.priceInr)} ·{' '}
              {load.advancePercent}% advance · {timeAgo(load.postedAt)}
            </Text>

            {load.status === 'open' && load.bids.length > 0 && (
              <View style={styles.bidsBlock}>
                <Text style={styles.bidsTitle}>
                  {load.bids.length} bid{load.bids.length > 1 ? 's' : ''}
                </Text>
                {load.bids.map((bid) => (
                  <View key={bid.id} style={styles.bidRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bidDriver}>
                        {bid.driverName} · ★ {bid.rating.toFixed(1)}
                      </Text>
                      <Text style={styles.bidMeta}>{bid.truckNumber}</Text>
                    </View>
                    <Text style={styles.bidAmount}>{formatINR(bid.amountInr)}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleAccept(load, bid.id, bid.driverName)}
                      style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.8 }]}
                    >
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {load.status === 'open' && load.bids.length === 0 && (
              <Text style={styles.noBids}>No bids yet — drivers are viewing this load.</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <PostLoadModal visible={showPostModal} onClose={() => setShowPostModal(false)} />
    </SafeAreaView>
  );
}

/**
 * Minimal inline post-load form. Numeric fields are validated before submit;
 * invalid input keeps the modal open with an explanatory alert rather than
 * silently posting garbage.
 */
function PostLoadModal({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const t = useTranslation();
  const postLoad = useLoadsStore((s) => s.postLoad);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [material, setMaterial] = useState('');
  const [weight, setWeight] = useState('');
  const [price, setPrice] = useState('');

  const submit = async () => {
    const weightTonnes = Number(weight);
    const priceInr = Number(price);
    if (!origin.trim() || !destination.trim() || !material.trim()) {
      notify('Missing details', 'Origin, destination and material are required.');
      return;
    }
    if (!Number.isFinite(weightTonnes) || weightTonnes <= 0 || !Number.isFinite(priceInr) || priceInr <= 0) {
      notify('Invalid numbers', 'Weight and freight amount must be positive numbers.');
      return;
    }
    try {
      await postLoad({
        origin: origin.trim(),
        destination: destination.trim(),
        material: material.trim(),
        weightTonnes,
        priceInr,
        advancePercent: 70,
      });
    } catch (e) {
      // Server mode: the backend rejected the load — keep the sheet open.
      notify('Could not post load', e instanceof Error ? e.message : 'Please try again.');
      return;
    }
    setOrigin('');
    setDestination('');
    setMaterial('');
    setWeight('');
    setPrice('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('bookLoad')}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Origin city"
            placeholderTextColor={colors.textMuted}
            value={origin}
            onChangeText={setOrigin}
          />
          <TextInput
            style={styles.input}
            placeholder="Destination city"
            placeholderTextColor={colors.textMuted}
            value={destination}
            onChangeText={setDestination}
          />
          <TextInput
            style={styles.input}
            placeholder="Material (e.g. Cement bags)"
            placeholderTextColor={colors.textMuted}
            value={material}
            onChangeText={setMaterial}
          />
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Weight (tonnes)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Freight (₹)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={price}
              onChangeText={setPrice}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void submit()}
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.submitBtnText}>Post load (70% advance)</Text>
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
  postButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    ...cardShadow,
  },
  postButtonText: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  loadCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
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
  statusBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  loadMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  bidsBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  bidsTitle: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bidDriver: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bidMeta: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  bidAmount: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  acceptBtn: {
    backgroundColor: colors.success,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  acceptBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  noBids: {
    fontSize: fontSizes.xs,
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
  },
  modalTitle: {
    fontSize: fontSizes.lg,
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
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  submitBtn: {
    backgroundColor: colors.primary,
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
