/**
 * In-app chat sheet for one shipment (Feature 10), with a masked call.
 *
 * Number masking is enforced by never exposing the counterpart's phone: the
 * "Call" button resolves a proxy bridge number from the API and dials that.
 * Messages carry only role + text.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../services/api';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore } from '../stores/useChatStore';
import { colors, fontSizes, radii, spacing } from '../theme';
import type { ChatMessage, ChatSenderRole } from '../types';
import { notify } from '../utils/dialog';
import { formatTime } from '../utils/format';

interface ChatSheetProps {
  visible: boolean;
  shipmentId: string;
  role: ChatSenderRole;
  counterpartLabel: string;
  onClose: () => void;
}

/**
 * Stable empty reference — a `?? []` literal inside the selector would return
 * a new array every render, which makes useSyncExternalStore loop forever
 * (React error #185). Share one frozen array instead.
 */
const NO_MESSAGES: ChatMessage[] = [];

export function ChatSheet({
  visible,
  shipmentId,
  role,
  counterpartLabel,
  onClose,
}: ChatSheetProps): React.JSX.Element {
  const userId = useAuthStore((s) => s.user?.id ?? 'me');
  const messages = useChatStore((s) => s.byShipment[shipmentId] ?? NO_MESSAGES);
  const load = useChatStore((s) => s.load);
  const send = useChatStore((s) => s.send);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) void load(shipmentId);
  }, [visible, shipmentId, load]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await send(shipmentId, text, role, userId);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const call = async () => {
    const result = await api.getMaskedCall(shipmentId);
    if (!result) return;
    const ok = await Linking.canOpenURL(`tel:${result.maskedNumber.replace(/\s/g, '')}`).catch(() => false);
    if (ok) {
      void Linking.openURL(`tel:${result.maskedNumber.replace(/\s/g, '')}`);
    } else {
      notify('Masked call', `Dial ${result.maskedNumber} — your real numbers stay private.`);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{counterpartLabel}</Text>
              <Text style={styles.subtitle}>Numbers stay private · TruckSetu chat</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Masked call" onPress={() => void call()} style={styles.callBtn}>
              <Ionicons name="call" size={16} color={colors.textInverse} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close chat" onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            ListEmptyComponent={<Text style={styles.empty}>Say hello — messages are private to this trip.</Text>}
            renderItem={({ item }) => {
              const mine = item.senderRole === role;
              return (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && { color: colors.textInverse }]}>{item.text}</Text>
                    <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>
                      {formatTime(item.at)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Type a message…"
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void handleSend()}
              returnKeyType="send"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              onPress={() => void handleSend()}
              style={styles.sendBtn}
            >
              <Ionicons name="send" size={16} color={colors.textInverse} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    height: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
  },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    padding: 4,
  },
  messages: {
    padding: spacing.lg,
    gap: spacing.sm,
    flexGrow: 1,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    paddingVertical: spacing.xl,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.background,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: fontSizes.sm,
    color: colors.textPrimary,
  },
  bubbleTime: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontSize: fontSizes.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
