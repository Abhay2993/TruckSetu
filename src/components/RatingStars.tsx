/**
 * Two-way rating stars — display-only when a value exists, tappable input
 * when it doesn't (ratings are immutable once given, matching the server).
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSizes, spacing } from '../theme';

export function RatingStars({
  value,
  onRate,
  label,
}: {
  value: number | null | undefined;
  /** Present ⇒ interactive (only while value is unset). */
  onRate?: (stars: number) => void;
  label: string;
}): React.JSX.Element {
  const rated = typeof value === 'number' && value >= 1;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = rated && star <= (value ?? 0);
          return (
            <Pressable
              key={star}
              disabled={rated || !onRate}
              accessibilityRole="button"
              accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
              onPress={() => onRate?.(star)}
              hitSlop={4}
            >
              <Ionicons
                name={filled ? 'star' : 'star-outline'}
                size={22}
                color={filled ? colors.accent : colors.textMuted}
              />
            </Pressable>
          );
        })}
      </View>
      {rated && <Text style={styles.thanks}>✓</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
  },
  thanks: {
    color: colors.success,
    fontWeight: '800',
  },
});
