/**
 * Feature C — Payment Escrow Dashboard (deliverable 3).
 *
 * One screen, two personas: registered in BOTH tab navigators and adapts to
 * the persisted role instead of being duplicated —
 *   • Driver  → sees advance status and owns the "Upload POD" action
 *               (camera or document picker).
 *   • Dealer  → owns "Confirm & Dispatch" (which auto-fires the Stage-1
 *               advance) and "Release Balance" (legal only after POD).
 *
 * All stage transitions live in useEscrowStore — this screen only renders
 * state and invokes actions, so an out-of-order button press is impossible
 * to exploit (the store re-validates every transition).
 */

import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChatSheet } from '../../components/ChatSheet';
import { ContractCard } from '../../components/ContractCard';
import { DisputePanel } from '../../components/DisputePanel';
import { EscrowFlowIndicator } from '../../components/EscrowFlowIndicator';
import { RatingStars } from '../../components/RatingStars';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTranslation } from '../../i18n/i18n';
import { readConsignmentNo } from '../../services/ocr';
import { instantPayoutQuote, splitAmounts, useEscrowStore } from '../../stores/useEscrowStore';
import { useAppStore } from '../../stores/useAppStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { EscrowShipment, ProofOfDelivery } from '../../types';
import { notify } from '../../utils/dialog';
import { formatINR, formatTime } from '../../utils/format';

const STAGE_LABEL: Record<EscrowShipment['stage'], string> = {
  CREATED: 'Awaiting dispatch',
  DISPATCHED: 'Dispatched — advance processing',
  ADVANCE_PAID: 'In transit — advance paid',
  POD_UPLOADED: 'POD uploaded — awaiting release',
  BALANCE_RELEASED: 'Completed — fully paid',
};

export function PaymentEscrowDashboard(): React.JSX.Element {
  const t = useTranslation();
  const role = useAppStore((s) => s.role);
  const shipments = useEscrowStore((s) => s.shipments);
  const processingIds = useEscrowStore((s) => s.processingIds);
  const confirmDispatch = useEscrowStore((s) => s.confirmDispatch);
  const attachPod = useEscrowStore((s) => s.attachPod);
  const releaseBalance = useEscrowStore((s) => s.releaseBalance);
  const rateShipment = useEscrowStore((s) => s.rateShipment);
  const instantPayout = useEscrowStore((s) => s.instantPayout);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const shipment = useMemo(
    () => shipments.find((s) => s.id === selectedId) ?? shipments[0],
    [shipments, selectedId],
  );

  // ---- POD capture (driver) ----------------------------------------------
  // Both pickers funnel into one attach path. Before attaching, OCR reads the
  // consignment number off the POD (Feature 12) so the store/server can flag
  // a mismatch before the dealer releases the balance.
  const attach = async (shipmentId: string, pod: ProofOfDelivery, expected?: string) => {
    const ocr = await readConsignmentNo(pod.uri, expected);
    // Optimistic: the store transitions locally first, computes verified, and
    // mirrors to the server in the background (see useEscrowStore.attachPod).
    void attachPod(shipmentId, { ...pod, ocrConsignmentNo: ocr.consignmentNo });
    notify('POD attached', 'The dealer can now review and release your balance.');
  };

  const capturePodPhoto = async (shipmentId: string, expected?: string) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        notify('Camera permission needed', 'Allow camera access to photograph the POD.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      await attach(
        shipmentId,
        { uri: asset.uri, kind: 'photo', fileName: asset.fileName ?? `pod-${Date.now()}.jpg`, uploadedAt: Date.now() },
        expected,
      );
    } catch (error) {
      console.warn('[pod] camera capture failed', error);
      notify('Could not open camera', 'Please try again or attach a file instead.');
    }
  };

  const pickPodDocument = async (shipmentId: string, expected?: string) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      await attach(
        shipmentId,
        { uri: asset.uri, kind: 'document', fileName: asset.name ?? `pod-${Date.now()}.pdf`, uploadedAt: Date.now() },
        expected,
      );
    } catch (error) {
      console.warn('[pod] document pick failed', error);
      notify('Could not open files', 'Please try again or use the camera instead.');
    }
  };

  // ---- Empty state ---------------------------------------------------------
  if (!shipment) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader />
        <View style={styles.empty}>
          <Ionicons name="wallet-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No shipments yet. Book a load to start an escrow.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { advanceInr, balanceInr } = splitAmounts(shipment);
  const isProcessing = processingIds.includes(shipment.id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Shipment picker */}
        {shipments.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
            {shipments.map((s) => {
              const selected = s.id === shipment.id;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(s.id)}
                  style={[styles.pickerChip, selected && styles.pickerChipSelected]}
                >
                  <Text style={[styles.pickerChipText, selected && styles.pickerChipTextSelected]}>
                    {s.origin} → {s.destination}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Shipment summary */}
        <View style={styles.card}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.route}>
                {shipment.origin} → {shipment.destination}
              </Text>
              <Text style={styles.subline}>
                {shipment.driverName} · {shipment.truckNumber}
              </Text>
            </View>
            <View style={styles.stageBadge}>
              <Text style={styles.stageBadgeText}>{STAGE_LABEL[shipment.stage]}</Text>
            </View>
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.totalAmount}>{formatINR(shipment.totalAmountInr)}</Text>
            <Text style={styles.subline}>
              Advance {shipment.advancePercent}% ({formatINR(advanceInr)}) · Balance{' '}
              {formatINR(balanceInr)}
              {shipment.insured ? ' · 🛡 Insured' : ''}
            </Text>
          </View>
        </View>

        {/* Stage 1 → escrow → release pipeline */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Payment pipeline</Text>
          <EscrowFlowIndicator shipment={shipment} />
        </View>

        {/* Role-specific actions */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            {role === 'dealer' ? 'Dealer actions' : 'Driver actions'}
          </Text>

          {role === 'dealer' && shipment.stage === 'CREATED' && (
            <ActionButton
              label="Confirm Load & Dispatch"
              caption={`Auto-pays ${formatINR(advanceInr)} advance to the driver's fuel card`}
              icon="rocket"
              busy={isProcessing}
              onPress={() => void confirmDispatch(shipment.id)}
            />
          )}

          {role === 'dealer' && shipment.stage === 'DISPATCHED' && (
            <StatusNote icon="hourglass" text="Advance payout processing…" busy />
          )}

          {role === 'dealer' && shipment.stage === 'ADVANCE_PAID' && (
            <StatusNote
              icon="time"
              text="Waiting for the driver to deliver and upload the POD."
            />
          )}

          {role === 'dealer' && shipment.stage === 'POD_UPLOADED' && (
            <>
              {/* Feature 12: OCR verdict the dealer reviews before releasing. */}
              {shipment.pod && shipment.consignmentNo && (
                <StatusNote
                  icon={shipment.pod.verified ? 'shield-checkmark' : 'warning'}
                  tone={shipment.pod.verified ? 'success' : 'neutral'}
                  text={
                    shipment.pod.verified
                      ? `POD verified — consignment ${shipment.consignmentNo} matches.`
                      : `POD consignment mismatch: read ${shipment.pod.ocrConsignmentNo ?? 'none'}, expected ${shipment.consignmentNo}. Review before releasing.`
                  }
                />
              )}
              {shipment.disputeId ? (
                <StatusNote icon="lock-closed" text="Escrow is frozen by an open dispute — resolve it below to release." />
              ) : (
                <ActionButton
                  label={t('releaseBalance')}
                  caption={`Releases ${formatINR(balanceInr)} from escrow to the driver`}
                  icon="lock-open"
                  tone="success"
                  busy={isProcessing}
                  onPress={() => void releaseBalance(shipment.id)}
                />
              )}
            </>
          )}

          {role === 'driver' && shipment.stage === 'CREATED' && (
            <StatusNote icon="time" text="Waiting for the dealer to confirm dispatch." />
          )}

          {role === 'driver' && shipment.stage === 'DISPATCHED' && (
            <StatusNote icon="hourglass" text="Advance on its way to your fuel card…" busy />
          )}

          {role === 'driver' && shipment.stage === 'ADVANCE_PAID' && (
            <View style={styles.podActions}>
              <StatusNote
                icon="checkmark-circle"
                tone="success"
                text={`${t('advanceReceived')}: ${formatINR(advanceInr)} on fuel card`}
              />
              <Text style={styles.podHint}>
                Delivered? {t('uploadPod')} to unlock your {formatINR(balanceInr)} balance:
              </Text>
              {shipment.consignmentNo && (
                <Text style={styles.podHint}>
                  Consignment on this load: {shipment.consignmentNo} — we'll read it off your POD.
                </Text>
              )}
              <View style={styles.podButtonRow}>
                <ActionButton
                  label="Camera"
                  icon="camera"
                  compact
                  onPress={() => void capturePodPhoto(shipment.id, shipment.consignmentNo)}
                />
                <ActionButton
                  label="Attach file"
                  icon="document-attach"
                  compact
                  tone="neutral"
                  onPress={() => void pickPodDocument(shipment.id, shipment.consignmentNo)}
                />
              </View>
            </View>
          )}

          {shipment.stage === 'POD_UPLOADED' && role === 'driver' && (
            <>
              <StatusNote icon="shield-checkmark" text="POD uploaded — dealer is verifying. Balance releases from escrow next." />
              {/* Instant payout (factoring): don't wait for the dealer. */}
              {!shipment.disputeId && (() => {
                const quote = instantPayoutQuote(shipment);
                return (
                  <ActionButton
                    label={`Get ${formatINR(quote.netInr)} now`}
                    caption={`Instant payout · fee ${formatINR(quote.feeInr)} (1.5%) instead of waiting`}
                    icon="flash"
                    tone="success"
                    busy={isProcessing}
                    onPress={() => void instantPayout(shipment.id)}
                  />
                );
              })()}
            </>
          )}

          {shipment.stage === 'BALANCE_RELEASED' && (
            <>
              <StatusNote
                icon="checkmark-done-circle"
                tone="success"
                text={`Fully settled — ${formatINR(shipment.totalAmountInr)} paid.`}
              />
              {/* Two-way trust: each side rates the other after settlement. */}
              <RatingStars
                label={role === 'dealer' ? `Rate ${shipment.driverName}` : 'Rate the dealer'}
                value={role === 'dealer' ? shipment.ratingByDealer : shipment.ratingByDriver}
                onRate={(stars) =>
                  void rateShipment(shipment.id, stars, role === 'dealer' ? 'dealer' : 'driver')
                }
              />
            </>
          )}
        </View>

        {/* POD preview */}
        {shipment.pod && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Proof of Delivery</Text>
            <View style={styles.podRow}>
              {shipment.pod.kind === 'photo' ? (
                <Image source={{ uri: shipment.pod.uri }} style={styles.podThumb} />
              ) : (
                <View style={[styles.podThumb, styles.podDocThumb]}>
                  <Ionicons name="document-text" size={28} color={colors.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.podName} numberOfLines={1}>
                  {shipment.pod.fileName}
                </Text>
                <Text style={styles.subline}>Uploaded at {formatTime(shipment.pod.uploadedAt)}</Text>
                {shipment.consignmentNo && (
                  <View style={styles.podVerifyRow}>
                    <Ionicons
                      name={shipment.pod.verified ? 'shield-checkmark' : 'warning'}
                      size={13}
                      color={shipment.pod.verified ? colors.success : colors.warning}
                    />
                    <Text
                      style={[
                        styles.podVerifyText,
                        { color: shipment.pod.verified ? colors.success : colors.warning },
                      ]}
                    >
                      {shipment.pod.verified
                        ? `Consignment ${shipment.pod.ocrConsignmentNo} verified`
                        : `OCR read ${shipment.pod.ocrConsignmentNo ?? 'none'} · expected ${shipment.consignmentNo}`}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Chat + dispute (Features 10 & 13) — available once a trip exists */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Coordination</Text>
          <ActionButton
            label={role === 'dealer' ? `Chat with ${shipment.driverName}` : 'Chat with the dealer'}
            icon="chatbubbles"
            tone="neutral"
            onPress={() => setChatOpen(true)}
          />
          <ContractCard shipment={shipment} role={role === 'dealer' ? 'dealer' : 'driver'} />
          <DisputePanel shipment={shipment} role={role === 'dealer' ? 'dealer' : 'driver'} />
        </View>

        {/* Audit timeline */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {[...shipment.events].reverse().map((e, i) => (
            <View key={`${e.at}-${i}`} style={styles.eventRow}>
              <View style={styles.eventDot} />
              <Text style={styles.eventLabel}>{e.label}</Text>
              <Text style={styles.eventTime}>{formatTime(e.at)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <ChatSheet
        visible={chatOpen}
        shipmentId={shipment.id}
        role={role === 'dealer' ? 'dealer' : 'driver'}
        counterpartLabel={role === 'dealer' ? shipment.driverName : 'Dealer'}
        onClose={() => setChatOpen(false)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components — small enough that extracting them to /components
// would hurt discoverability; promote them when a second screen needs one.
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  caption,
  icon,
  onPress,
  busy = false,
  compact = false,
  tone = 'primary',
}: {
  label: string;
  caption?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  busy?: boolean;
  compact?: boolean;
  tone?: 'primary' | 'success' | 'neutral';
}): React.JSX.Element {
  const bg =
    tone === 'success' ? colors.success : tone === 'neutral' ? colors.textSecondary : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        compact && styles.actionBtnCompact,
        { backgroundColor: bg },
        (pressed || busy) && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <Ionicons name={icon} size={18} color={colors.textInverse} />
      )}
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.actionBtnLabel}>{label}</Text>
        {caption && <Text style={styles.actionBtnCaption}>{caption}</Text>}
      </View>
    </Pressable>
  );
}

function StatusNote({
  icon,
  text,
  busy = false,
  tone = 'neutral',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  busy?: boolean;
  tone?: 'neutral' | 'success';
}): React.JSX.Element {
  const tint = tone === 'success' ? colors.success : colors.textSecondary;
  return (
    <View style={styles.statusNote}>
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Ionicons name={icon} size={18} color={tint} />
      )}
      <Text style={[styles.statusNoteText, { color: tint }]}>{text}</Text>
    </View>
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
  picker: {
    flexGrow: 0,
  },
  pickerChip: {
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
  },
  pickerChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pickerChipText: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pickerChipTextSelected: {
    color: colors.textInverse,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...cardShadow,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  route: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subline: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stageBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: 150,
  },
  stageBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warning,
    textAlign: 'center',
  },
  amountRow: {
    gap: 2,
  },
  totalAmount: {
    fontSize: fontSizes.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  actionBtnCompact: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionBtnLabel: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  actionBtnCaption: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.xs,
    marginTop: 1,
  },
  statusNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  statusNoteText: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  podActions: {
    gap: spacing.md,
  },
  podHint: {
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  podButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  podRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  podThumb: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  podDocThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  podName: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  podVerifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  podVerifyText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    flex: 1,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  eventLabel: {
    flex: 1,
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
  },
  eventTime: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fontSizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
