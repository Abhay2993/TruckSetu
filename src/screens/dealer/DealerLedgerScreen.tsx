/**
 * Ledger (dealer features): GST invoices per shipment, the monthly money
 * position, and lane-rate analytics.
 *
 * Everything derives from the shipment/load stores via services/invoices —
 * one code path for demo and server mode. "Share" emits a plain-text
 * invoice through the native share sheet (PDF rendering and NIC e-way bill
 * generation are the production upgrades; the data shapes already fit).
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  buildInvoice,
  buildLaneRates,
  buildLedgerSummary,
  GST_RATE,
  Invoice,
} from '../../services/invoices';
import { useEscrowStore } from '../../stores/useEscrowStore';
import { useLoadsStore } from '../../stores/useLoadsStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import { notify } from '../../utils/dialog';
import { formatINR } from '../../utils/format';

const STATUS_TINT: Record<Invoice['status'], { tint: string; bg: string }> = {
  PAID: { tint: colors.success, bg: colors.successSoft },
  'IN ESCROW': { tint: colors.warning, bg: colors.warningSoft },
  PENDING: { tint: colors.textMuted, bg: colors.background },
};

function invoiceText(inv: Invoice): string {
  return [
    `TruckSetu Tax Invoice ${inv.number}`,
    `Route: ${inv.route}`,
    `Driver: ${inv.driverName} (${inv.truckNumber})`,
    `Freight: ${formatINR(inv.baseAmountInr)}`,
    `GST (${GST_RATE * 100}%): ${formatINR(inv.gstInr)}`,
    `Total: ${formatINR(inv.totalInr)}`,
    `Status: ${inv.status}`,
    `E-way bill: ${inv.ewayBillNumber ?? 'pending'}`,
  ].join('\n');
}

export function DealerLedgerScreen(): React.JSX.Element {
  const shipments = useEscrowStore((s) => s.shipments);
  const loads = useLoadsStore((s) => s.loads);

  const summary = buildLedgerSummary(shipments);
  const invoices = shipments.map(buildInvoice);
  const lanes = buildLaneRates(shipments, loads);

  const share = async (inv: Invoice) => {
    try {
      await Share.share({ message: invoiceText(inv) });
    } catch {
      // Web/simulators without a share sheet — show the invoice instead.
      notify(`Invoice ${inv.number}`, invoiceText(inv));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Monthly position */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>This month</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Freight ({summary.shipmentCount} shipments)</Text>
            <Text style={styles.summaryValue}>{formatINR(summary.freightInr)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST @ {GST_RATE * 100}%</Text>
            <Text style={styles.summaryValue}>{formatINR(summary.gstInr)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Paid out</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              {formatINR(summary.paidOutInr)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Locked in escrow</Text>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>
              {formatINR(summary.inEscrowInr)}
            </Text>
          </View>
        </View>

        {/* Lane-rate analytics */}
        <Text style={styles.sectionTitle}>Lane rates · last 30 days</Text>
        {lanes.map((lane) => (
          <View key={lane.lane} style={styles.laneCard}>
            <View style={styles.laneTop}>
              <Text style={styles.laneName}>{lane.lane}</Text>
              <Text style={styles.laneAvg}>avg {formatINR(lane.avgInr)}</Text>
            </View>
            <Text style={styles.laneMeta}>
              {lane.tripCount} trip{lane.tripCount > 1 ? 's' : ''} · {formatINR(lane.minInr)}–
              {formatINR(lane.maxInr)}
              {lane.marketAskInr ? ` · open loads asking ${formatINR(lane.marketAskInr)}` : ''}
            </Text>
          </View>
        ))}
        {lanes.length === 0 && (
          <Text style={styles.emptyText}>Lane averages appear after your first booked shipment.</Text>
        )}

        {/* Invoices */}
        <Text style={styles.sectionTitle}>Invoices</Text>
        {invoices.map((inv) => {
          const status = STATUS_TINT[inv.status];
          return (
            <View key={inv.number} style={styles.invoiceCard}>
              <View style={styles.invoiceTop}>
                <View style={styles.invoiceIcon}>
                  <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceNumber}>{inv.number}</Text>
                  <Text style={styles.invoiceMeta}>
                    {inv.route} · {inv.driverName}
                  </Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusChipText, { color: status.tint }]}>{inv.status}</Text>
                </View>
              </View>
              <View style={styles.invoiceAmounts}>
                <Text style={styles.invoiceLine}>
                  Freight {formatINR(inv.baseAmountInr)} · GST {formatINR(inv.gstInr)} ·{' '}
                  <Text style={styles.invoiceTotal}>Total {formatINR(inv.totalInr)}</Text>
                </Text>
                <Text style={styles.ewayLine}>
                  E-way bill: {inv.ewayBillNumber ?? 'pending NIC integration'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => void share(inv)}
                style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="share-social" size={14} color={colors.textInverse} />
                <Text style={styles.shareBtnText}>Share invoice</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
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
  summaryCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  summaryTitle: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.sm,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.sm,
  },
  summaryValue: {
    color: colors.textInverse,
    fontSize: fontSizes.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  laneCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
    ...cardShadow,
  },
  laneTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  laneName: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  laneAvg: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.accent,
  },
  laneMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  invoiceCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  invoiceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  invoiceIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceNumber: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  invoiceMeta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  statusChip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  invoiceAmounts: {
    gap: 2,
  },
  invoiceLine: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  invoiceTotal: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  ewayLine: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
  },
  shareBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  emptyText: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
