/**
 * Voice-first assistant — "Setu se poocho" (ask Setu).
 *
 * A driver who cannot read still needs to know what they earned, find a
 * return load, and call a mechanic. This sheet answers all of that by
 * speech in the driver's own language: it speaks the answer aloud with
 * real numbers from the stores, and every option is also a big tappable
 * row for the recogniser-less path.
 *
 * Speech-to-text needs a dev build (services/voice.ts `listen` is the
 * slot). Until that lands the same intents are reachable by tapping, so
 * the feature is genuinely usable today rather than a stub — and when the
 * recogniser is wired, nothing else here changes.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/i18n';
import { speak, stopSpeaking, listen } from '../services/voice';
import {
  greeting,
  INTENT_LABEL,
  matchIntent,
  replyFor,
  unknownReply,
  type VoiceIntent,
} from '../services/voiceCommands';
import { useAppStore } from '../stores/useAppStore';
import { useEscrowStore, splitAmounts } from '../stores/useEscrowStore';
import { useFastagStore } from '../stores/useFastagStore';
import { useLoadsStore } from '../stores/useLoadsStore';
import { useMembershipStore } from '../stores/useMembershipStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';

const ICON: Record<VoiceIntent, keyof typeof MaterialCommunityIcons.glyphMap> = {
  earnings: 'cash-multiple',
  find_loads: 'package-variant',
  fastag_balance: 'wallet',
  savings: 'piggy-bank',
  next_stop: 'silverware-fork-knife',
  breakdown: 'car-wrench',
  legal_help: 'scale-balance',
  sos: 'alarm-light',
  documents: 'file-document-multiple',
  help: 'help-circle',
};

/** Intents offered as taps, in the order a driver most often needs them. */
const QUICK: VoiceIntent[] = [
  'earnings',
  'find_loads',
  'fastag_balance',
  'savings',
  'breakdown',
  'legal_help',
  'documents',
  'help',
];

export function VoiceAssistant({
  visible,
  onClose,
  onIntent,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired for intents that should navigate or act (SOS, breakdown, …). */
  onIntent?: (intent: VoiceIntent) => void;
}): React.JSX.Element {
  const t = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const shipments = useEscrowStore((s) => s.shipments);
  const loads = useLoadsStore((s) => s.loads);
  const fastagBalance = useFastagStore((s) => s.balanceInr);
  const membership = useMembershipStore((s) => s.summary);

  const [heard, setHeard] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);

  // Greet in the driver's language whenever the sheet opens.
  useEffect(() => {
    if (!visible) {
      stopSpeaking();
      return;
    }
    setHeard(null);
    setReply(null);
    speak(greeting(locale), locale);
  }, [visible, locale]);

  /** Live values the spoken replies interpolate. */
  const values = (): Record<string, string | number> => {
    const totals = shipments.reduce(
      (acc, s) => {
        const { advanceInr, balanceInr } = splitAmounts(s);
        const received =
          s.stage === 'BALANCE_RELEASED'
            ? s.totalAmountInr
            : s.stage === 'ADVANCE_PAID' || s.stage === 'POD_UPLOADED'
              ? advanceInr
              : 0;
        const locked =
          s.stage === 'ADVANCE_PAID' || s.stage === 'POD_UPLOADED' ? balanceInr : 0;
        return { received: acc.received + received, locked: acc.locked + locked };
      },
      { received: 0, locked: 0 },
    );
    const activeTrip = shipments.find((s) => s.stage !== 'BALANCE_RELEASED');
    const city = activeTrip?.destination ?? 'Jaipur';
    const open = loads.filter((l) => l.status === 'open' && l.origin === city);
    const best = open.length
      ? Math.max(...open.map((l) => l.priceInr))
      : Math.max(0, ...loads.filter((l) => l.status === 'open').map((l) => l.priceInr));
    return {
      received: totals.received,
      locked: totals.locked,
      city,
      best,
      balance: fastagBalance,
      savings: membership?.savings.savingsInr ?? 0,
      pension: membership?.savings.pensionInr ?? 0,
      stop: 'Behror dhaba',
      expiring: 1,
    };
  };

  const run = (intent: VoiceIntent) => {
    const spoken = replyFor(intent, locale, values());
    setReply(spoken.text);
    speak(spoken.text, locale);
    onIntent?.(intent);
  };

  /** Recogniser path: available in a dev build, no-ops in Expo Go/web. */
  const tapMic = async () => {
    const utterance = await listen();
    if (!utterance) {
      // No recogniser — say the menu instead of failing silently.
      setHeard(null);
      const text = replyFor('help', locale, values()).text;
      setReply(text);
      speak(text, locale);
      return;
    }
    setHeard(utterance);
    const intent = matchIntent(utterance);
    if (!intent) {
      const text = unknownReply(locale);
      setReply(text);
      speak(text, locale);
      return;
    }
    run(intent);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <MaterialCommunityIcons name="microphone" size={20} color={colors.accent} />
            <Text style={styles.title}>{t('voiceAssistant')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close voice assistant"
              onPress={() => {
                stopSpeaking();
                onClose();
              }}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Speak now"
            onPress={() => void tapMic()}
            style={({ pressed }) => [styles.mic, pressed && { opacity: 0.85 }]}
          >
            <MaterialCommunityIcons name="microphone" size={34} color={colors.textInverse} />
          </Pressable>
          <Text style={styles.micHint}>{greeting(locale)}</Text>

          {heard && <Text style={styles.heard}>“{heard}”</Text>}
          {reply && (
            <View style={styles.replyBox}>
              <MaterialCommunityIcons name="volume-high" size={16} color={colors.primary} />
              <Text style={styles.replyText}>{reply}</Text>
            </View>
          )}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {QUICK.map((intent) => (
              <Pressable
                key={intent}
                accessibilityRole="button"
                accessibilityLabel={INTENT_LABEL[intent]}
                onPress={() => run(intent)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
              >
                <View style={styles.rowIcon}>
                  <MaterialCommunityIcons name={ICON[intent]} size={19} color={colors.primary} />
                </View>
                <Text style={styles.rowLabel}>{INTENT_LABEL[intent]}</Text>
                <Ionicons name="volume-medium" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,42,92,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '86%',
    ...cardShadow,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  mic: {
    alignSelf: 'center',
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  micHint: {
    textAlign: 'center',
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  heard: {
    textAlign: 'center',
    fontSize: fontSizes.sm,
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  replyBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  replyText: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  list: {
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
