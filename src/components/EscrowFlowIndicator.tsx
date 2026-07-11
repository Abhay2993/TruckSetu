/**
 * Feature C — the visual money pipeline:
 *
 *   [Advance → Fuel Card]  ➔  [Balance locked in Escrow]  ➔  [Release]
 *
 * A pure presentational component: it derives everything from the shipment
 * so the dashboard, trip list and dealer views can all reuse it without
 * duplicating stage logic.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/i18n';
import { splitAmounts } from '../stores/useEscrowStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { EscrowShipment } from '../types';
import { formatINR } from '../utils/format';

const STAGE_ORDER = ['CREATED', 'DISPATCHED', 'ADVANCE_PAID', 'POD_UPLOADED', 'BALANCE_RELEASED'] as const;

function stageIndex(stage: EscrowShipment['stage']): number {
  return STAGE_ORDER.indexOf(stage);
}

interface NodeProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  amount: string;
  caption: string;
  state: 'done' | 'active' | 'pending';
}

function Node({ icon, title, amount, caption, state }: NodeProps): React.JSX.Element {
  const tint =
    state === 'done' ? colors.success : state === 'active' ? colors.accent : colors.textMuted;
  const bg =
    state === 'done' ? colors.successSoft : state === 'active' ? colors.accentSoft : colors.background;

  return (
    <View style={styles.node}>
      <View style={[styles.iconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <Text style={[styles.nodeAmount, { color: tint }]}>{amount}</Text>
      <Text style={styles.nodeTitle}>{title}</Text>
      <Text style={styles.nodeCaption}>{caption}</Text>
    </View>
  );
}

export function EscrowFlowIndicator({ shipment }: { shipment: EscrowShipment }): React.JSX.Element {
  const t = useTranslation();
  const { advanceInr, balanceInr } = splitAmounts(shipment);
  const idx = stageIndex(shipment.stage);

  const advanceState: NodeProps['state'] =
    idx >= stageIndex('ADVANCE_PAID') ? 'done' : idx >= stageIndex('DISPATCHED') ? 'active' : 'pending';
  const escrowState: NodeProps['state'] =
    idx >= stageIndex('BALANCE_RELEASED') ? 'done' : idx >= stageIndex('ADVANCE_PAID') ? 'active' : 'pending';
  const releaseState: NodeProps['state'] =
    idx >= stageIndex('BALANCE_RELEASED') ? 'done' : idx >= stageIndex('POD_UPLOADED') ? 'active' : 'pending';

  return (
    <View style={styles.row}>
      <Node
        icon="flash"
        title={t('advanceReceived')}
        amount={formatINR(advanceInr)}
        caption={`${shipment.advancePercent}% · Fuel card`}
        state={advanceState}
      />
      <Ionicons name="arrow-forward" size={16} color={colors.textMuted} style={styles.arrow} />
      <Node
        icon="lock-closed"
        title={t('lockedInEscrow')}
        amount={formatINR(balanceInr)}
        caption={`${100 - shipment.advancePercent}% · On POD`}
        state={escrowState}
      />
      <Ionicons name="arrow-forward" size={16} color={colors.textMuted} style={styles.arrow} />
      <Node
        icon="checkmark-circle"
        title={t('releaseBalance')}
        amount={idx >= stageIndex('BALANCE_RELEASED') ? formatINR(balanceInr) : '—'}
        caption={idx >= stageIndex('BALANCE_RELEASED') ? 'Paid out' : 'Needs POD'}
        state={releaseState}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  node: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  nodeAmount: {
    fontSize: fontSizes.md,
    fontWeight: '800',
  },
  nodeTitle: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  nodeCaption: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    textAlign: 'center',
  },
  arrow: {
    marginTop: 14,
    marginHorizontal: 2,
  },
});
