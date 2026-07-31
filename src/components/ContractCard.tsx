/**
 * Digital LR / contract card (Aadhaar eSign, Feature 13 of the trust set).
 *
 * Shows both parties' signature state and lets the current role sign with
 * an Aadhaar OTP (dev accepts any 6 digits; production redirects through
 * NSDL/Protean eSign). A fully signed contract turns dispute resolution
 * into a document-backed process — the SHA-256 hash pins the exact terms.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEscrowStore } from '../stores/useEscrowStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { EscrowShipment } from '../types';
import { notify } from '../utils/dialog';

function SignState({ label, at }: { label: string; at: number | null | undefined }): React.JSX.Element {
  const signed = typeof at === 'number';
  return (
    <View style={styles.signRow}>
      <Ionicons
        name={signed ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={signed ? colors.success : colors.textMuted}
      />
      <Text style={[styles.signText, signed && { color: colors.success }]}>
        {label} {signed ? 'signed' : 'pending'}
      </Text>
    </View>
  );
}

export function ContractCard({
  shipment,
  role,
}: {
  shipment: EscrowShipment;
  role: 'dealer' | 'driver';
}): React.JSX.Element {
  const signContract = useEscrowStore((s) => s.signContract);
  const [otp, setOtp] = useState('');
  const [signing, setSigning] = useState(false);

  const mySignature =
    role === 'dealer' ? shipment.contract?.signedByDealerAt : shipment.contract?.signedByDriverAt;
  const fullySigned = Boolean(
    shipment.contract?.signedByDealerAt && shipment.contract?.signedByDriverAt,
  );

  const sign = async () => {
    if (!/^\d{6}$/.test(otp)) {
      notify('Aadhaar OTP', 'Enter the 6-digit OTP sent to your Aadhaar-linked mobile.');
      return;
    }
    setSigning(true);
    try {
      await signContract(shipment.id, role, otp);
      setOtp('');
      notify('Contract signed', 'Your Aadhaar eSign has been applied to the digital LR.');
    } catch (e) {
      notify('Could not sign', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSigning(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="document-lock" size={16} color={fullySigned ? colors.success : colors.primary} />
        <Text style={styles.title}>Digital LR / Contract</Text>
        {fullySigned && (
          <View style={styles.sealedChip}>
            <Text style={styles.sealedChipText}>SEALED</Text>
          </View>
        )}
      </View>

      <SignState label="Dealer" at={shipment.contract?.signedByDealerAt} />
      <SignState label="Driver" at={shipment.contract?.signedByDriverAt} />
      {shipment.contract?.textHash && (
        <Text style={styles.hash} numberOfLines={1}>
          sha256: {shipment.contract.textHash.slice(0, 24)}…
        </Text>
      )}

      {!mySignature && (
        <View style={styles.signBox}>
          <TextInput
            style={styles.otpInput}
            placeholder="Aadhaar OTP (6 digits)"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/[^\d]/g, ''))}
          />
          <Pressable
            accessibilityRole="button"
            disabled={signing}
            onPress={() => void sign()}
            style={({ pressed }) => [styles.signBtn, (pressed || signing) && { opacity: 0.75 }]}
          >
            <Ionicons name="finger-print" size={15} color={colors.textInverse} />
            <Text style={styles.signBtnText}>eSign</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
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
  sealedChip: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  sealedChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.success,
  },
  signRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  hash: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: 'monospace' as never,
  },
  signBox: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  otpInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSizes.sm,
    letterSpacing: 3,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  signBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  signBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
});
