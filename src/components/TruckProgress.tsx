/**
 * Trip progress as a journey: the mini lorry drives along a dashed highway
 * from origin to destination, springing forward whenever the escrow stage
 * advances. A green flag marks delivery. Pure layout + Animated — the truck
 * position is measured from the container width, so it works at any size.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, fontSizes } from '../theme';
import type { EscrowShipment } from '../types';
import { IndianTruck } from './IndianTruck';

const STAGE_PROGRESS: Record<EscrowShipment['stage'], number> = {
  CREATED: 0.06,
  DISPATCHED: 0.32,
  ADVANCE_PAID: 0.56,
  POD_UPLOADED: 0.84,
  BALANCE_RELEASED: 1,
};

const TRUCK_W = 66;

export function TruckProgress({ shipment }: { shipment: EscrowShipment }): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const progress = STAGE_PROGRESS[shipment.stage];

  useEffect(() => {
    if (width === 0) return;
    Animated.spring(x, {
      toValue: progress * (width - TRUCK_W),
      friction: 8,
      tension: 30,
      useNativeDriver: true,
    }).start();
  }, [progress, width, x]);

  const delivered = shipment.stage === 'BALANCE_RELEASED';

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.roadRow}>
        <Animated.View style={[styles.truck, { transform: [{ translateX: x }] }]}>
          <IndianTruck width={TRUCK_W} shadow={false} />
        </Animated.View>
        <View style={styles.flag}>
          <Ionicons
            name={delivered ? 'flag' : 'flag-outline'}
            size={16}
            color={delivered ? colors.success : colors.textMuted}
          />
        </View>
      </View>
      <View style={styles.track}>
        {Array.from({ length: 14 }, (_, i) => (
          <View key={i} style={styles.dash} />
        ))}
      </View>
      <View style={styles.labels}>
        <Text style={styles.city}>{shipment.origin}</Text>
        <Text style={[styles.city, delivered && { color: colors.success }]}>
          {shipment.destination}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  roadRow: {
    height: 40,
    justifyContent: 'flex-end',
  },
  truck: {
    position: 'absolute',
    bottom: -4,
    left: 0,
    zIndex: 1,
  },
  flag: {
    position: 'absolute',
    right: 0,
    bottom: 2,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    overflow: 'hidden',
  },
  dash: {
    width: 10,
    height: 1.6,
    borderRadius: 1,
    backgroundColor: colors.surface,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  city: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});
