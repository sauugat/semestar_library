import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { ChatMessage } from '@/services/chat';
import * as Haptics from 'expo-haptics';

interface ChatMessageActionsSheetProps {
  visible: boolean;
  message: ChatMessage | null;
  busy: boolean;
  canPin: boolean;
  isPinned?: boolean;
  isOwnerOrAdmin: boolean;
  onClose: () => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onCopy: (message: ChatMessage) => void;
  onPin: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'];

export function ChatMessageActionsSheet({
  visible,
  message,
  busy,
  canPin,
  isPinned,
  isOwnerOrAdmin,
  onClose,
  onReact,
  onReply,
  onCopy,
  onPin,
  onDelete,
}: ChatMessageActionsSheetProps) {
  const insets = useSafeAreaInsets();

  if (!message) return null;

  const confirmed = message.id > 0;

  const handleReact = (emoji: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onReact(message, emoji);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && onClose()}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={() => !busy && onClose()}
          accessibilityLabel="Dismiss message actions"
        />

        <View
          style={[
            styles.sheetContainer,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
          accessibilityViewIsModal
        >
          {/* Subtle handle bar */}
          <View style={styles.handle} />

          {/* Quick Reaction Row */}
          {confirmed && <View style={styles.reactionsBar}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                disabled={busy}
                onPress={() => handleReact(emoji)}
                style={styles.reactionButton}
                activeOpacity={0.65}
                accessibilityLabel={`React with ${emoji}`}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>}

          {/* Action List */}
          <View style={styles.actionsList}>
            {/* Reply Action */}
            {confirmed && <TouchableOpacity
              disabled={busy}
              style={styles.actionRow}
              activeOpacity={0.7}
              onPress={() => onReply(message)}
            >
              <View style={styles.actionIconBox}>
                <Ionicons name="arrow-undo-outline" size={20} color="#e4e4e7" />
              </View>
              <Text variant="md" weight="500" style={styles.actionLabel}>
                Reply
              </Text>
            </TouchableOpacity>}

            {/* Copy Text Action */}
            {Boolean(message.text && message.text.trim()) && (
              <TouchableOpacity
                disabled={busy}
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={() => onCopy(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name="copy-outline" size={20} color="#e4e4e7" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  Copy text
                </Text>
              </TouchableOpacity>
            )}

            {/* Pin / Unpin Announcement Action */}
            {confirmed && canPin && (
              <TouchableOpacity
                disabled={busy}
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={() => onPin(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name={isPinned ? "pin-outline" : "pin-outline"} size={20} color="#e4e4e7" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  {isPinned ? "Unpin announcement" : "Pin announcement"}
                </Text>
              </TouchableOpacity>
            )}

            {/* Delete Action (only for owner or admin) */}
            {isOwnerOrAdmin && (
              <TouchableOpacity
                disabled={busy}
                style={[styles.actionRow, styles.actionRowLast]}
                activeOpacity={0.7}
                onPress={() => onDelete(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name="trash-outline" size={20} color="#e4e4e7" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  {confirmed ? 'Delete for everyone' : 'Remove unsent message'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {busy && (
            <View style={styles.busyIndicator}>
              <ActivityIndicator color="#ffffff" size="small" />
            </View>
          )}

          {/* Cancel Button */}
          <TouchableOpacity
            disabled={busy}
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text variant="md" weight="600" style={styles.cancelLabel}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#18181a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#48484a',
    alignSelf: 'center',
    marginBottom: 14,
  },
  reactionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#202022',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2a2a2e',
  },
  reactionButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  reactionEmoji: {
    fontSize: 24,
    textAlign: 'center',
    includeFontPadding: false,
  },
  actionsList: {
    backgroundColor: '#202022',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a2e',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2e2e32',
    minHeight: 48,
  },
  actionRowLast: {
    borderBottomWidth: 0,
  },
  actionIconBox: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionLabel: {
    color: '#f5f5f5',
    flex: 1,
  },
  busyIndicator: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelButton: {
    marginTop: 10,
    backgroundColor: '#202022',
    borderRadius: 14,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2e',
  },
  cancelLabel: {
    color: '#a1a1aa',
  },
});
