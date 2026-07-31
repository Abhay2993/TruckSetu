/**
 * Phone-OTP login — the auth gate in front of role selection.
 *
 * Two steps on one screen: enter a 10-digit mobile number → enter the
 * 6-digit OTP. Errors render inline (not dialogs) because mistyped OTPs are
 * the common path and shouldn't interrupt. When the backend runs in dev
 * mode (or the app in demo mode) the OTP arrives in the response and is
 * shown as a hint, so the flow is testable without an SMS provider.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DynamicHeader } from '../../components/DynamicHeader';
import { TruckHero } from '../../components/TruckHero';
import { useTranslation } from '../../i18n/i18n';
import { ApiError } from '../../services/http';
import { useAuthStore } from '../../stores/useAuthStore';
import { colors, fontSizes, radii, spacing } from '../../theme';

type Step = 'phone' | 'otp';

export function PhoneLoginScreen(): React.JSX.Element {
  const t = useTranslation();
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = /^\d{10}$/.test(phone);
  const otpValid = /^\d{6}$/.test(otp);

  const handleSendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { devOtp } = await requestOtp(phone);
      setDevOtpHint(devOtp ?? null);
      setStep('otp');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send OTP — try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!otpValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, otp);
      // Success: the auth store now has a token and RootNavigator re-routes.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed — try again.');
      setBusy(false);
    }
  };

  const backToPhone = () => {
    setStep('phone');
    setOtp('');
    setError(null);
  };

  return (
    <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <DynamicHeader size="display" prefixColor={colors.textInverse} />
            <Text style={styles.tagline}>{t('appTagline')}</Text>
          </View>

          <View style={styles.hero}>
            <TruckHero height={196} />
          </View>

          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.label}>{t('enterPhone')}</Text>
                <View style={styles.phoneRow}>
                  <View style={styles.prefixBox}>
                    <Text style={styles.prefixText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="98765 43210"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/[^\d]/g, ''))}
                    autoFocus
                  />
                </View>
                <PrimaryButton
                  label={t('sendOtp')}
                  icon="chatbubble-ellipses"
                  disabled={!phoneValid}
                  busy={busy}
                  onPress={handleSendOtp}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>{t('enterOtp')}</Text>
                <Text style={styles.sentTo}>+91 {phone}</Text>
                <TextInput
                  style={styles.otpInput}
                  placeholder="••••••"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/[^\d]/g, ''))}
                  autoFocus
                />
                {devOtpHint && (
                  <View style={styles.devHint}>
                    <Ionicons name="flask" size={13} color={colors.warning} />
                    <Text style={styles.devHintText}>Test OTP: {devOtpHint}</Text>
                  </View>
                )}
                <PrimaryButton
                  label={t('verifyOtp')}
                  icon="shield-checkmark"
                  disabled={!otpValid}
                  busy={busy}
                  onPress={handleVerify}
                />
                <Pressable accessibilityRole="button" onPress={backToPhone} hitSlop={8}>
                  <Text style={styles.linkText}>{t('changeNumber')}</Text>
                </Pressable>
              </>
            )}

            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function PrimaryButton({
  label,
  icon,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        (disabled || busy) && styles.primaryBtnDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <Ionicons name={icon} size={18} color={colors.textInverse} />
      )}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  hero: {
    // Full-bleed: the road should run edge to edge under the padded card.
    marginHorizontal: -spacing.xl,
    marginVertical: -spacing.sm,
  },
  tagline: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  label: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sentTo: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  prefixBox: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  prefixText: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSizes.lg,
    letterSpacing: 1,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  otpInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSizes.xl,
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  devHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    paddingVertical: 6,
  },
  devHintText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.warning,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  linkText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.danger,
  },
});
