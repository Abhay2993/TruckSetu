/**
 * Shared top bar: the dynamic brand title, an optional connectivity pill and
 * a role-switch action. Screens compose it instead of using the navigator's
 * default header so the "Setu" rotator (Feature A) is visible everywhere.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/i18n';
import { useAppStore } from '../stores/useAppStore';
import { useAuthStore } from '../stores/useAuthStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import { confirmAction } from '../utils/dialog';
import { ArtTrim } from './ArtTrim';
import { DynamicHeader } from './DynamicHeader';
import { NotificationBell } from './NotificationBell';
import { VoiceAssistant } from './VoiceAssistant';

interface ScreenHeaderProps {
  /** When provided, renders the green/red online pill. */
  isOnline?: boolean;
  queuedCount?: number;
}

export function ScreenHeader({ isOnline, queuedCount = 0 }: ScreenHeaderProps): React.JSX.Element {
  const t = useTranslation();
  const setRole = useAppStore((s) => s.setRole);
  const signOut = useAuthStore((s) => s.signOut);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const handleSignOut = async () => {
    const ok = await confirmAction(
      `${t('signOut')}?`,
      'You will need to verify your mobile number again.',
      t('signOut'),
    );
    if (ok) signOut();
  };

  return (
    <View style={styles.shell}>
      <View style={styles.container}>
        <DynamicHeader size="compact" />
      <View style={styles.right}>
        {isOnline !== undefined && (
          <View
            style={[
              styles.pill,
              { backgroundColor: isOnline ? colors.successSoft : colors.dangerSoft },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: isOnline ? colors.success : colors.danger }]}
            />
            <Text
              style={[styles.pillText, { color: isOnline ? colors.success : colors.danger }]}
            >
              {isOnline ? 'Online' : `Offline · ${queuedCount} cached`}
            </Text>
          </View>
        )}
        {/* Voice-first: reachable from every screen, not buried in a menu */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('voiceAssistant')}
          onPress={() => setVoiceOpen(true)}
          hitSlop={8}
          style={[styles.switchBtn, styles.micBtn]}
        >
          <MaterialCommunityIcons name="microphone" size={18} color={colors.accent} />
        </Pressable>
        <NotificationBell />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch role"
          onPress={() => setRole(null)}
          hitSlop={8}
          style={styles.switchBtn}
        >
          <Ionicons name="swap-horizontal" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('signOut')}
          onPress={() => void handleSignOut()}
          hitSlop={8}
          style={styles.switchBtn}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} />
        </Pressable>
        </View>
      </View>
      {/* Signature lorry-art bunting under every header */}
      <ArtTrim height={7} />
      <VoiceAssistant visible={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
    shadowColor: colors.primary,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    zIndex: 2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
  },
  switchBtn: {
    padding: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  micBtn: {
    backgroundColor: colors.accentSoft,
  },
});
