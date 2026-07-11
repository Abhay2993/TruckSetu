/**
 * Shared top bar: the dynamic brand title, an optional connectivity pill and
 * a role-switch action. Screens compose it instead of using the navigator's
 * default header so the "Setu" rotator (Feature A) is visible everywhere.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppStore } from '../stores/useAppStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import { DynamicHeader } from './DynamicHeader';

interface ScreenHeaderProps {
  /** When provided, renders the green/red online pill. */
  isOnline?: boolean;
  queuedCount?: number;
}

export function ScreenHeader({ isOnline, queuedCount = 0 }: ScreenHeaderProps): React.JSX.Element {
  const setRole = useAppStore((s) => s.setRole);

  return (
    <View style={styles.container}>
      <DynamicHeader size="compact" />
      <View style={styles.right}>
        {isOnline !== undefined && (
          <View
            style={[
              styles.pill,
              { backgroundColor: isOnline ? colors.successSoft : colors.dangerSoft },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: isOnline ? colors.success : colors.danger }]}
            />
            <Text
              style={[styles.pillText, { color: isOnline ? colors.success : colors.danger }]}
            >
              {isOnline ? 'Online' : `Offline · ${queuedCount} cached`}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch role"
          onPress={() => setRole(null)}
          hitSlop={8}
          style={styles.switchBtn}
        >
          <Ionicons name="swap-horizontal" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: fontSizes.xs,
    fontWeight: '700',
  },
  switchBtn: {
    padding: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
});
