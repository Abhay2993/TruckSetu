/**
 * Roadside and legal help — the two moments that decide whether a driver
 * stays with a platform for years.
 *
 * Breakdown dispatches the nearest partner garage with an SLA clock the
 * driver can watch; legal opens a case AND immediately shows what to do in
 * the next five minutes, because an advocate's callback is no use while an
 * officer is standing at the window. Entitlements come from the membership
 * tier, so the benefit is visibly earned.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LEGAL_KIND_LABEL } from '../services/membership';
import { useMembershipStore } from '../stores/useMembershipStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { BreakdownCase, LegalCaseKind, TelemetryPoint } from '../types';
import { notify } from '../utils/dialog';

const LEGAL_KINDS: LegalCaseKind[] = [
  'challan',
  'police_stop',
  'rto_seizure',
  'overloading_notice',
  'accident_claim',
  'other',
];

function minutesLeft(deadlineAt: number): number {
  return Math.max(0, Math.round((deadlineAt - Date.now()) / 60000));
}

export function AssistancePanel({
  lastPoint,
}: {
  /** Live position from the GPS feed — where the mechanic is sent. */
  lastPoint: TelemetryPoint | null;
}): React.JSX.Element {
  const assistance = useMembershipStore((s) => s.assistance);
  const refresh = useMembershipStore((s) => s.refresh);
  const requestBreakdown = useMembershipStore((s) => s.requestBreakdown);
  const openLegalCase = useMembershipStore((s) => s.openLegalCase);
  const busy = useMembershipStore((s) => s.busy);

  const [legalOpen, setLegalOpen] = useState(false);
  const [firstAid, setFirstAid] = useState<{ kind: LegalCaseKind; text: string } | null>(null);
  const [dispatched, setDispatched] = useState<BreakdownCase | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeBreakdown =
    dispatched ?? assistance?.breakdown.cases.find((c) => c.status !== 'resolved') ?? null;

  const callBreakdown = () => {
    // Telemetry gives the position; the NH-48 corridor start is the fallback
    // so the desk still gets somewhere to look.
    const lat = lastPoint?.latitude ?? 28.4595;
    const lng = lastPoint?.longitude ?? 77.0266;
    void requestBreakdown(lat, lng, 'Breakdown on the highway').then((record) => {
      if (!record) return;
      setDispatched(record);
      notify(
        'Mechanic dispatched',
        record.garageName
          ? `${record.garageName} — ${record.distanceKm} km away, ETA ${record.etaMinutes} min.`
          : 'Our desk is calling garages on this stretch now.',
      );
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="lifebuoy" size={18} color={colors.primary} />
        <Text style={styles.title}>Help on the road</Text>
        {assistance && (
          <Text style={styles.quota}>
            {assistance.breakdown.allowed - assistance.breakdown.used} callouts ·{' '}
            {assistance.legal.allowed - assistance.legal.used} legal left
          </Text>
        )}
      </View>

      {activeBreakdown && activeBreakdown.status !== 'resolved' ? (
        <View style={styles.dispatchBox}>
          <View style={styles.dispatchTop}>
            <MaterialCommunityIcons name="car-wrench" size={16} color={colors.success} />
            <Text style={styles.dispatchTitle}>
              {activeBreakdown.garageName ?? 'Finding a garage'}
            </Text>
            <Text style={styles.slaChip}>{minutesLeft(activeBreakdown.slaDeadlineAt)} min left</Text>
          </View>
          <Text style={styles.dispatchMeta}>
            {activeBreakdown.distanceKm !== null
              ? `${activeBreakdown.distanceKm} km away · ETA ${activeBreakdown.etaMinutes} min`
              : 'Locating the nearest partner garage'}
            {activeBreakdown.covered ? ' · covered by your membership' : ' · chargeable'}
          </Text>
          {activeBreakdown.garagePhone && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Call the garage"
              onPress={() => void Linking.openURL(`tel:${activeBreakdown.garagePhone}`)}
              style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="call" size={15} color={colors.textInverse} />
              <Text style={styles.callBtnText}>Call {activeBreakdown.garageName}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request breakdown assistance"
          disabled={busy}
          onPress={callBreakdown}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
        >
          <MaterialCommunityIcons name="car-wrench" size={17} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Truck broken down</Text>
            <Text style={styles.actionSub}>
              Mechanic to your location
              {assistance ? ` within ${assistance.breakdown.slaMinutes} min` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Get legal help"
        onPress={() => setLegalOpen(true)}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
      >
        <MaterialCommunityIcons name="scale-balance" size={17} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Police, RTO or challan</Text>
          <Text style={styles.actionSub}>Advocate callback + what to do right now</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>

      {firstAid && (
        <View style={styles.firstAidBox}>
          <View style={styles.firstAidTop}>
            <Ionicons name="information-circle" size={15} color={colors.warning} />
            <Text style={styles.firstAidTitle}>{LEGAL_KIND_LABEL[firstAid.kind]} — do this now</Text>
          </View>
          <Text style={styles.firstAidText}>{firstAid.text}</Text>
          {assistance && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Call the legal helpline"
              onPress={() => void Linking.openURL(`tel:${assistance.helpline}`)}
              style={({ pressed }) => [styles.helplineBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="call" size={14} color={colors.primary} />
              <Text style={styles.helplineText}>Helpline {assistance.helpline}</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal visible={legalOpen} animationType="slide" transparent onRequestClose={() => setLegalOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>What is happening?</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close legal help"
                onPress={() => setLegalOpen(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {LEGAL_KINDS.map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityLabel={LEGAL_KIND_LABEL[kind]}
                  onPress={() => {
                    void openLegalCase(kind, LEGAL_KIND_LABEL[kind]).then((aid) => {
                      setLegalOpen(false);
                      if (aid) setFirstAid({ kind, text: aid });
                    });
                  }}
                  style={({ pressed }) => [styles.kindRow, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.kindLabel}>{LEGAL_KIND_LABEL[kind]}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSizes.md, fontWeight: '800', color: colors.textPrimary },
  quota: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  actionTitle: { fontSize: fontSizes.sm, fontWeight: '800', color: colors.textPrimary },
  actionSub: { fontSize: fontSizes.xs, color: colors.textSecondary },
  dispatchBox: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  dispatchTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dispatchTitle: { flex: 1, fontSize: fontSizes.sm, fontWeight: '800', color: colors.textPrimary },
  slaChip: { fontSize: 10, fontWeight: '800', color: colors.success },
  dispatchMeta: { fontSize: fontSizes.xs, color: colors.textSecondary },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.success,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
  },
  callBtnText: { color: colors.textInverse, fontSize: fontSizes.sm, fontWeight: '800' },
  firstAidBox: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  firstAidTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  firstAidTitle: { flex: 1, fontSize: fontSizes.xs, fontWeight: '800', color: colors.warning },
  firstAidText: { fontSize: fontSizes.xs, color: colors.textPrimary, lineHeight: 18 },
  helplineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: 7,
  },
  helplineText: { fontSize: fontSizes.xs, fontWeight: '800', color: colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,42,92,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: fontSizes.lg, fontWeight: '800', color: colors.textPrimary },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  kindLabel: { fontSize: fontSizes.md, fontWeight: '700', color: colors.textPrimary },
});
