/**
 * Notification bell + centre (Feature 11). Lives in the header: a badge with
 * the unread count, tapping opens a sheet of recent notifications and marks
 * them read. Reads from useNotificationsStore (server records in server
 * mode, local events in demo mode).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNotificationsStore } from '../stores/useNotificationsStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import { timeAgo } from '../utils/format';
import type { NotificationKind } from '../types';

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  bid_received: 'hammer',
  bid_accepted: 'checkmark-circle',
  advance_paid: 'flash',
  pod_uploaded: 'document-attach',
  balance_released: 'wallet',
  dispute_raised: 'warning',
  dispute_resolved: 'shield-checkmark',
  message: 'chatbubble-ellipses',
};

export function NotificationBell(): React.JSX.Element {
  const notifications = useNotificationsStore((s) => s.notifications);
  const unread = useNotificationsStore((s) => s.unread);
  const refresh = useNotificationsStore((s) => s.refresh);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const [open, setOpen] = useState(false);

  const openSheet = () => {
    setOpen(true);
    void refresh();
  };
  const close = () => {
    setOpen(false);
    void markAllRead();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onPress={openSheet}
        hitSlop={8}
        style={styles.bellBtn}
      >
        <Ionicons name="notifications" size={18} color={colors.textSecondary} />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Notifications</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={close} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <FlatList
              data={notifications}
              keyExtractor={(n) => n.id}
              ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
              renderItem={({ item }) => (
                <View style={[styles.row, !item.read && styles.rowUnread]}>
                  <Ionicons name={KIND_ICON[item.kind]} size={18} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowBody}>{item.body}</Text>
                  </View>
                  <Text style={styles.rowTime}>{timeAgo(item.at)}</Text>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    padding: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: '800',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 42, 92, 0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    paddingVertical: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowUnread: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
  },
  rowTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rowBody: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  rowTime: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
});
