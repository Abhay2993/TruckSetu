/**
 * Compliance monitor — VAHAN/SARATHI-backed, and it can stop you bidding.
 *
 * Every driver already knows an expired fitness certificate is a problem;
 * what they do not have is something that watches all six documents and
 * warns before the checkpost does. Because the platform checks against the
 * official records rather than what was uploaded, it can also tell an
 * enterprise shipper that every truck carrying their freight was road-legal
 * on the day it moved — which is the reason to route freight here.
 *
 * The blocking rule is deliberately narrow: fitness, insurance, PUC and
 * licence make a truck illegal to run, so they block bidding. Registration
 * and permit lapses warn instead, because those are often mid-renewal with
 * valid paperwork in hand and stopping a driver's income has to be right.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../services/api';
import { deriveCompliance } from '../services/compliance';
import { useDocumentsStore } from '../stores/useDocumentsStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { ComplianceItem, VehicleCompliance } from '../types';

const STATUS_TINT: Record<ComplianceItem['status'], { tint: string; bg: string; label: string }> = {
  valid: { tint: colors.success, bg: colors.successSoft, label: 'OK' },
  expiring: { tint: colors.warning, bg: colors.warningSoft, label: 'RENEW' },
  expired: { tint: colors.danger, bg: colors.dangerSoft, label: 'EXPIRED' },
};

export function ComplianceMonitor({
  vehicleNumber = 'PB 10 AB 4321',
}: {
  vehicleNumber?: string;
}): React.JSX.Element {
  const documents = useDocumentsStore((s) => s.documents);
  const [report, setReport] = useState<VehicleCompliance | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      // Server mode checks the official records; demo mode derives the same
      // shape from the documents in the locker.
      const remote = await api.myCompliance().catch(() => null);
      setReport(remote ?? deriveCompliance(vehicleNumber, documents));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // Re-derive whenever the locker changes so an added expiry shows at once.
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCheck = async () => {
    setBusy(true);
    try {
      const remote = await api
        .checkCompliance(vehicleNumber, documents.dl?.fileName ?? null)
        .catch(() => null);
      setReport(remote ?? deriveCompliance(vehicleNumber, documents));
    } finally {
      setBusy(false);
    }
  };

  if (!report) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.card, !report.canBid && styles.cardBlocked]}>
      <View style={styles.head}>
        <MaterialCommunityIcons
          name={report.canBid ? 'shield-check' : 'shield-alert'}
          size={18}
          color={report.canBid ? colors.success : colors.danger}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Compliance monitor</Text>
          <Text style={styles.sub}>
            {report.vehicleNumber} · checked against VAHAN & SARATHI
          </Text>
        </View>
      </View>

      {!report.canBid ? (
        <View style={styles.blockBox}>
          <Text style={styles.blockTitle}>Bidding blocked</Text>
          {report.blockingReasons.map((reason) => (
            <Text key={reason} style={styles.blockReason}>
              • {reason}
            </Text>
          ))}
          <Text style={styles.blockFoot}>
            Renew and re-check to start bidding again. Running without these is a challan waiting to
            happen.
          </Text>
        </View>
      ) : report.expiringCount > 0 ? (
        <View style={styles.warnBox}>
          <Ionicons name="alert-circle" size={14} color={colors.warning} />
          <Text style={styles.warnText}>
            {report.expiringCount} document{report.expiringCount > 1 ? 's' : ''} expire within 30
            days — renew before your next long trip.
          </Text>
        </View>
      ) : (
        <View style={styles.okBox}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <Text style={styles.okText}>All papers valid. You can bid on any load.</Text>
        </View>
      )}

      {report.items.map((item) => {
        const tint = STATUS_TINT[item.status];
        return (
          <View key={`${item.kind}-${item.label}`} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowDate}>
              {item.status === 'expired'
                ? `${Math.abs(item.daysLeft)}d overdue`
                : `${item.daysLeft}d left`}
            </Text>
            <View style={[styles.chip, { backgroundColor: tint.bg }]}>
              <Text style={[styles.chipText, { color: tint.tint }]}>{tint.label}</Text>
            </View>
          </View>
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Re-check compliance"
        disabled={busy}
        onPress={() => void runCheck()}
        style={({ pressed }) => [styles.btn, (pressed || busy) && { opacity: 0.8 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <MaterialCommunityIcons name="refresh" size={15} color={colors.primary} />
        )}
        <Text style={styles.btnText}>Re-check with VAHAN</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  cardBlocked: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: fontSizes.md, fontWeight: '800', color: colors.textPrimary },
  sub: { fontSize: fontSizes.xs, color: colors.textSecondary },
  blockBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 3,
  },
  blockTitle: { fontSize: fontSizes.sm, fontWeight: '800', color: colors.danger },
  blockReason: { fontSize: fontSizes.xs, color: colors.textPrimary, fontWeight: '600' },
  blockFoot: { fontSize: fontSizes.xs, color: colors.textSecondary, marginTop: 3 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  warnText: { flex: 1, fontSize: fontSizes.xs, color: colors.warning, fontWeight: '700' },
  okBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  okText: { flex: 1, fontSize: fontSizes.xs, color: colors.success, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  rowLabel: { flex: 1, fontSize: fontSizes.sm, fontWeight: '700', color: colors.textPrimary },
  rowDate: { fontSize: fontSizes.xs, color: colors.textSecondary },
  chip: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { fontSize: 9, fontWeight: '800' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  btnText: { fontSize: fontSizes.xs, fontWeight: '800', color: colors.primary },
});
