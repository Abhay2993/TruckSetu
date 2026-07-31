/**
 * Document locker (driver feature) — RC, DL, insurance, permit, PUC.
 *
 * Everything a checkpost can ask for, on the phone, with expiry status at a
 * glance: green (valid) / amber (expires within 30 days) / red (expired).
 * Files stay on-device (see useDocumentsStore). The screen doubles as the
 * driver's profile corner: truck number and the SOS emergency contact live
 * here too.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ComplianceMonitor } from '../../components/ComplianceMonitor';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTranslation } from '../../i18n/i18n';
import { expiryStatus, useDocumentsStore } from '../../stores/useDocumentsStore';
import { useDriverStore } from '../../stores/useDriverStore';
import { cardShadow, colors, fontSizes, radii, spacing } from '../../theme';
import type { DocumentKind } from '../../types';
import { notify } from '../../utils/dialog';

const DOC_TYPES: { kind: DocumentKind; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { kind: 'rc', label: 'Registration Certificate (RC)', icon: 'file-certificate' },
  { kind: 'dl', label: 'Driving Licence', icon: 'card-account-details' },
  { kind: 'insurance', label: 'Vehicle Insurance', icon: 'shield-car' },
  { kind: 'permit', label: 'National Permit', icon: 'file-document' },
  { kind: 'puc', label: 'PUC Certificate', icon: 'leaf' },
];

const STATUS_UI = {
  missing: { label: 'Not added', tint: colors.textMuted, bg: colors.background },
  no_expiry: { label: 'Set expiry', tint: colors.warning, bg: colors.warningSoft },
  valid: { label: 'Valid', tint: colors.success, bg: colors.successSoft },
  expiring: { label: 'Expiring soon', tint: colors.warning, bg: colors.warningSoft },
  expired: { label: 'EXPIRED', tint: colors.danger, bg: colors.dangerSoft },
} as const;

export function DocumentsScreen(): React.JSX.Element {
  const t = useTranslation();
  const documents = useDocumentsStore((s) => s.documents);
  const attachDocument = useDocumentsStore((s) => s.attachDocument);
  const setExpiry = useDocumentsStore((s) => s.setExpiry);
  const truckNumber = useDriverStore((s) => s.truckNumber);
  const setTruckNumber = useDriverStore((s) => s.setTruckNumber);
  const emergencyContact = useDriverStore((s) => s.emergencyContact);
  const setEmergencyContact = useDriverStore((s) => s.setEmergencyContact);

  const attach = async (kind: DocumentKind, label: string) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      attachDocument({
        kind,
        fileName: asset.name ?? `${kind}.pdf`,
        uri: asset.uri,
        expiresOn: null,
        addedAt: Date.now(),
      });
      notify('Document added', `${label} saved on this device. Set its expiry date below it.`);
    } catch {
      notify('Could not open files', 'Please try again.');
    }
  };

  const alerts = DOC_TYPES.filter((d) => {
    const s = expiryStatus(documents[d.kind]);
    return s === 'expired' || s === 'expiring';
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t('documentsTitle')}</Text>

        {/* Official-record check — this one can block bidding */}
        <ComplianceMonitor />

        {alerts.length > 0 && (
          <View style={styles.alertBanner}>
            <Ionicons name="warning" size={16} color={colors.danger} />
            <Text style={styles.alertText}>
              {alerts.map((a) => a.label).join(', ')}{' '}
              {alerts.length === 1 ? 'needs' : 'need'} renewal — avoid checkpost fines.
            </Text>
          </View>
        )}

        {DOC_TYPES.map(({ kind, label, icon }) => {
          const doc = documents[kind];
          const status = expiryStatus(doc);
          const ui = STATUS_UI[status];
          return (
            <View key={kind} style={styles.docCard}>
              <View style={styles.docTop}>
                <View style={styles.docIcon}>
                  <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docLabel}>{label}</Text>
                  {doc && (
                    <Text style={styles.docFile} numberOfLines={1}>
                      {doc.fileName}
                    </Text>
                  )}
                </View>
                <View style={[styles.statusChip, { backgroundColor: ui.bg }]}>
                  <Text style={[styles.statusChipText, { color: ui.tint }]}>{ui.label}</Text>
                </View>
              </View>

              <View style={styles.docActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void attach(kind, label)}
                  style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name={doc ? 'refresh' : 'add'} size={14} color={colors.textInverse} />
                  <Text style={styles.attachBtnText}>{doc ? 'Replace' : 'Add'}</Text>
                </Pressable>
                {doc && <ExpiryField kind={kind} current={doc.expiresOn} onSave={setExpiry} />}
              </View>
            </View>
          );
        })}

        {/* Driver profile: used by bidding (truck no.) and SOS (contact). */}
        <Text style={styles.title}>Profile</Text>
        <View style={styles.docCard}>
          <Text style={styles.fieldLabel}>Truck number</Text>
          <TextInput
            style={styles.input}
            placeholder="PB 10 AB 4321"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            value={truckNumber}
            onChangeText={setTruckNumber}
          />
          <Text style={styles.fieldLabel}>Emergency contact (called on SOS)</Text>
          <TextInput
            style={styles.input}
            placeholder="98765 43210"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            value={emergencyContact}
            onChangeText={setEmergencyContact}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** DD-MM-YYYY input that stores ISO — no datepicker dependency needed. */
function ExpiryField({
  kind,
  current,
  onSave,
}: {
  kind: DocumentKind;
  current: string | null;
  onSave: (kind: DocumentKind, iso: string | null) => void;
}): React.JSX.Element {
  const toDisplay = (iso: string | null) =>
    iso ? iso.split('-').reverse().join('-') : '';
  const [value, setValue] = useState(toDisplay(current));

  const save = () => {
    const match = value.trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (!match) {
      if (value.trim()) notify('Date format', 'Enter the expiry as DD-MM-YYYY, e.g. 31-03-2027.');
      return;
    }
    const [, dd, mm, yyyy] = match;
    onSave(kind, `${yyyy}-${mm}-${dd}`);
  };

  return (
    <TextInput
      style={styles.expiryInput}
      placeholder="Expiry DD-MM-YYYY"
      placeholderTextColor={colors.textMuted}
      value={value}
      onChangeText={setValue}
      onBlur={save}
      onSubmitEditing={save}
    />
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
  title: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  alertText: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.danger,
  },
  docCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
    ...cardShadow,
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docLabel: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  docFile: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 1,
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
  docActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  attachBtnText: {
    color: colors.textInverse,
    fontSize: fontSizes.xs,
    fontWeight: '800',
  },
  expiryInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  fieldLabel: {
    fontSize: fontSizes.xs,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSizes.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
});
