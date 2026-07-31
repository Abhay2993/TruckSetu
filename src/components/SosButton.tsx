/**
 * SOS (driver feature) — the one control that must work at 2 AM on a dark
 * highway shoulder. One tap → confirm → the alert with the last GPS fix
 * goes to the server (dealer/ops fan-out hangs off that record), and if an
 * emergency contact is saved the phone dialer opens with it. The active
 * state persists across app restarts until the driver cancels.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDriverStore } from '../stores/useDriverStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { TelemetryPoint } from '../types';
import { confirmAction, notify } from '../utils/dialog';

export function SosButton({ lastPoint }: { lastPoint: TelemetryPoint | null }): React.JSX.Element {
  const activeSosId = useDriverStore((s) => s.activeSosId);
  const isSendingSos = useDriverStore((s) => s.isSendingSos);
  const emergencyContact = useDriverStore((s) => s.emergencyContact);
  const sendSos = useDriverStore((s) => s.sendSos);
  const resolveSos = useDriverStore((s) => s.resolveSos);

  const trigger = async () => {
    const ok = await confirmAction(
      'Send SOS?',
      'Your live location will be shared with your dealer and TruckSetu support.',
      'Send SOS',
    );
    if (!ok) return;
    try {
      await sendSos(lastPoint);
      if (emergencyContact) {
        // Open the dialer with the saved contact — the driver presses call.
        Linking.openURL(`tel:${emergencyContact}`).catch(() => {});
      }
      notify('SOS sent', 'Help is being notified. Stay with your vehicle if it is safe.');
    } catch {
      notify('SOS failed to send', 'Check your connection and try again — or call your contact directly.');
    }
  };

  const cancel = async () => {
    const ok = await confirmAction('Cancel SOS?', 'Mark this emergency as resolved.', 'I am safe');
    if (ok) await resolveSos();
  };

  if (activeSosId) {
    return (
      <View style={styles.activeBanner}>
        <Ionicons name="alert-circle" size={18} color={colors.textInverse} />
        <Text style={styles.activeText}>SOS active — location shared</Text>
        <Pressable accessibilityRole="button" onPress={() => void cancel()} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>I'm safe</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send SOS"
      onPress={() => void trigger()}
      disabled={isSendingSos}
      style={({ pressed }) => [styles.sosBtn, pressed && { transform: [{ scale: 0.96 }] }]}
    >
      {isSendingSos ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <>
          <Ionicons name="warning" size={16} color={colors.textInverse} />
          <Text style={styles.sosText}>SOS</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    shadowColor: colors.danger,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sosText: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '900',
    letterSpacing: 1,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  activeText: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  cancelBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
});
