/**
 * Dispute panel for a shipment (Feature 13).
 *
 * Shows the open dispute if one exists (with a dealer-only resolve control),
 * otherwise offers a "Raise dispute" reason picker. Raising freezes the
 * escrow; resolving with any outcome unfreezes it. Both actions run through
 * useDisputeStore, which keeps the escrow store's disputeId in step.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useDisputeStore } from '../stores/useDisputeStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { DisputeReason, DisputeResolution, EscrowShipment } from '../types';
import { confirmAction, notify } from '../utils/dialog';

const REASONS: { value: DisputeReason; label: string }[] = [
  { value: 'damaged_goods', label: 'Damaged goods' },
  { value: 'late_delivery', label: 'Late delivery' },
  { value: 'shortage', label: 'Shortage' },
  { value: 'wrong_pod', label: 'Wrong POD' },
  { value: 'other', label: 'Other' },
];

const RESOLUTIONS: { value: DisputeResolution; label: string; tone: string }[] = [
  { value: 'released', label: 'Release to driver', tone: colors.success },
  { value: 'partial', label: 'Partial settlement', tone: colors.warning },
  { value: 'refunded', label: 'Refund dealer', tone: colors.danger },
  { value: 'dismissed', label: 'Dismiss dispute', tone: colors.textSecondary },
];

export function DisputePanel({
  shipment,
  role,
}: {
  shipment: EscrowShipment;
  role: 'dealer' | 'driver';
}): React.JSX.Element | null {
  const openForShipment = useDisputeStore((s) => s.openForShipment);
  const disputes = useDisputeStore((s) => s.disputes);
  const raise = useDisputeStore((s) => s.raise);
  const resolve = useDisputeStore((s) => s.resolve);
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [detail, setDetail] = useState('');

  // Recompute against `disputes` so the panel re-renders on change.
  void disputes;
  const open = openForShipment(shipment.id) ?? (shipment.disputeId ? undefined : undefined);
  const activeDispute = disputes.find((d) => d.shipmentId === shipment.id && d.status !== 'resolved');

  // Disputes are meaningless before dispatch or after settlement.
  const canRaise =
    shipment.stage === 'ADVANCE_PAID' || shipment.stage === 'POD_UPLOADED' || shipment.stage === 'DISPATCHED';

  if (activeDispute) {
    return (
      <View style={styles.openBanner}>
        <View style={styles.openHeader}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.openTitle}>
            Dispute open · {activeDispute.reason.replace('_', ' ')}
          </Text>
        </View>
        {!!activeDispute.detail && <Text style={styles.openDetail}>{activeDispute.detail}</Text>}
        <Text style={styles.openNote}>Escrow is frozen until this is resolved.</Text>
        {role === 'dealer' && (
          <View style={styles.resolveRow}>
            {RESOLUTIONS.map((r) => (
              <Pressable
                key={r.value}
                accessibilityRole="button"
                onPress={async () => {
                  const ok = await confirmAction('Resolve dispute', `Mark this dispute as "${r.label}"?`, 'Confirm');
                  if (ok) {
                    await resolve(activeDispute.id, r.value);
                    notify('Dispute resolved', `${r.label}. Escrow unfrozen.`);
                  }
                }}
                style={[styles.resolveChip, { borderColor: r.tone }]}
              >
                <Text style={[styles.resolveChipText, { color: r.tone }]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (!canRaise) return null;

  if (!picking) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        style={({ pressed }) => [styles.raiseBtn, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="flag" size={15} color={colors.danger} />
        <Text style={styles.raiseBtnText}>Raise a dispute</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.picker}>
      <Text style={styles.pickerTitle}>What went wrong?</Text>
      <View style={styles.reasonRow}>
        {REASONS.map((r) => {
          const selected = r.value === reason;
          return (
            <Pressable
              key={r.value}
              accessibilityRole="button"
              onPress={() => setReason(r.value)}
              style={[styles.reasonChip, selected && styles.reasonChipSelected]}
            >
              <Text style={[styles.reasonChipText, selected && styles.reasonChipTextSelected]}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        placeholder="Add details (optional)"
        placeholderTextColor={colors.textMuted}
        value={detail}
        onChangeText={setDetail}
        multiline
      />
      <View style={styles.pickerActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setPicking(false);
            setReason(null);
            setDetail('');
          }}
          style={styles.cancelBtn}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!reason}
          onPress={async () => {
            if (!reason) return;
            await raise(shipment.id, reason, detail.trim());
            setPicking(false);
            setReason(null);
            setDetail('');
            notify('Dispute raised', 'The escrow is now frozen until this is resolved.');
          }}
          style={[styles.submitBtn, !reason && { opacity: 0.5 }]}
        >
          <Text style={styles.submitBtnText}>Freeze escrow & raise</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  openBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  openHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  openTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.danger,
    textTransform: 'capitalize',
  },
  openDetail: {
    fontSize: fontSizes.xs,
    color: colors.textPrimary,
  },
  openNote: {
    fontSize: fontSizes.xs,
    color: colors.danger,
    fontWeight: '600',
  },
  resolveRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  resolveChip: {
    borderWidth: 1.5,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  resolveChipText: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  raiseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  raiseBtnText: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    fontWeight: '800',
  },
  picker: {
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pickerTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reasonChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  reasonChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  reasonChipText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  reasonChipTextSelected: {
    color: colors.textInverse,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  pickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  submitBtn: {
    flex: 2,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  submitBtnText: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textInverse,
  },
});
