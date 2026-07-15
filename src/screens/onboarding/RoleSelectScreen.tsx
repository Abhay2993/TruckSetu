/**
 * Feature B — dual-interface routing entry point.
 *
 * Doubles as the splash/branding moment: the display-size DynamicHeader
 * (Feature A) runs the 1-second "Setu" rotation while the user picks a role
 * and, optionally, a vernacular language (Feature F). The choice persists,
 * so returning users land straight in their interface.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DynamicHeader } from '../../components/DynamicHeader';
import { IndianTruck } from '../../components/IndianTruck';
import { SUPPORTED_LOCALES, useTranslation } from '../../i18n/i18n';
import { api } from '../../services/api';
import { useAppStore } from '../../stores/useAppStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { UserRole } from '../../types';

export function RoleSelectScreen(): React.JSX.Element {
  const t = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const setRole = useAppStore((s) => s.setRole);

  const chooseRole = (role: UserRole) => {
    setRole(role);
    // Persist the choice server-side so the next login skips this screen;
    // fire-and-forget — a failure only means re-asking next time.
    void api.updateProfile({ role }).catch(() => {});
  };

  return (
    <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.flex}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <DynamicHeader size="display" prefixColor={colors.textInverse} />
          <Text style={styles.tagline}>{t('appTagline')}</Text>
        </View>

        {/* Language first — a driver who reads only ਪੰਜਾਬੀ needs this before
            they can understand the role cards below. */}
        <View style={styles.localeRow}>
          {SUPPORTED_LOCALES.map(({ code, label }) => {
            const selected = code === locale;
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                onPress={() => setLocale(code)}
                style={[styles.localeChip, selected && styles.localeChipSelected]}
              >
                <Text style={[styles.localeChipText, selected && styles.localeChipTextSelected]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.chooseTitle}>{t('chooseRole')}</Text>

        <RoleCard
          role="driver"
          title={t('roleDriver')}
          description={t('roleDriverDesc')}
          icon={<IndianTruck width={62} shadow={false} />}
          onSelect={chooseRole}
        />
        <RoleCard
          role="dealer"
          title={t('roleDealer')}
          description={t('roleDealerDesc')}
          icon={<Ionicons name="briefcase" size={30} color={colors.accent} />}
          onSelect={chooseRole}
        />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function RoleCard({
  role,
  title,
  description,
  icon,
  onSelect,
}: {
  role: UserRole;
  title: string;
  description: string;
  icon: React.ReactNode;
  onSelect: (role: UserRole) => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => onSelect(role)}
      style={({ pressed }) => [styles.roleCard, pressed && styles.roleCardPressed]}
    >
      <View style={styles.roleIcon}>{icon}</View>
      <View style={styles.roleBody}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDesc}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tagline: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
  localeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  localeChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  localeChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  localeChipText: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
  localeChipTextSelected: {
    opacity: 1,
  },
  chooseTitle: {
    color: colors.textInverse,
    fontSize: fontSizes.lg,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...cardShadow,
  },
  roleCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  roleIcon: {
    width: 72,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBody: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  roleDesc: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
});
