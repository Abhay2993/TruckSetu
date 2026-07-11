/**
 * Feature E — one row in the route amenities list. Shows the veg/non-veg
 * dot convention Indian users expect (green square = veg, red = non-veg),
 * driver-parking availability and certification for mechanics.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cardShadow, colors, fontSizes, radii, spacing } from '../theme';
import type { Amenity } from '../types';

function FoodDot({ veg }: { veg: boolean }): React.JSX.Element {
  const tint = veg ? colors.success : colors.danger;
  return (
    <View style={[styles.foodDotBox, { borderColor: tint }]}>
      <View style={[styles.foodDot, { backgroundColor: tint }]} />
    </View>
  );
}

export function AmenityCard({
  amenity,
  onNavigate,
}: {
  amenity: Amenity;
  onNavigate: (amenity: Amenity) => void;
}): React.JSX.Element {
  const isDhaba = amenity.kind === 'dhaba';

  return (
    <View style={styles.card}>
      <View
        style={[styles.iconWrap, { backgroundColor: isDhaba ? colors.accentSoft : colors.background }]}
      >
        {isDhaba ? (
          <Ionicons name="restaurant" size={18} color={colors.accent} />
        ) : (
          <MaterialCommunityIcons name="wrench" size={18} color={colors.primary} />
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {amenity.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{amenity.distanceKm} km ahead</Text>
          <Text style={styles.meta}>★ {amenity.rating.toFixed(1)}</Text>
        </View>
        <View style={styles.badgeRow}>
          {amenity.servesVeg && <FoodDot veg />}
          {amenity.servesNonVeg && <FoodDot veg={false} />}
          {amenity.hasDriverParking && (
            <View style={styles.badge}>
              <MaterialCommunityIcons name="parking" size={11} color={colors.primary} />
              <Text style={styles.badgeText}>Truck parking</Text>
            </View>
          )}
          {amenity.isCertified && (
            <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
              <Ionicons name="shield-checkmark" size={11} color={colors.success} />
              <Text style={[styles.badgeText, { color: colors.success }]}>Certified</Text>
            </View>
          )}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Navigate to ${amenity.name}`}
        onPress={() => onNavigate(amenity)}
        style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="navigate" size={16} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
    ...cardShadow,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  meta: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.background,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  foodDotBox: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
