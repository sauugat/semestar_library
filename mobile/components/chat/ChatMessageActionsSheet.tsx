import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  Text as RNText,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { ThemeGlassSheet } from '@/components/chat/ThemeGlassSheet';
import { ChatMessage } from '@/services/chat';
import { formatMessageTime, formatChatDateSeparator } from '@/utils/date';
import * as Haptics from 'expo-haptics';

interface ChatMessageActionsSheetProps {
  visible: boolean;
  message: ChatMessage | null;
  busy: boolean;
  canPin: boolean;
  isPinned?: boolean;
  isStarred?: boolean;
  isOwnerOrAdmin: boolean;
  currentUserId?: string;
  themeBackgroundImage?: number | null;
  themeTintColor?: string;
  themeAccentColor?: string;
  onClose: () => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onToggleStar?: (message: ChatMessage) => void;
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
  isStarred,
  isOwnerOrAdmin,
  currentUserId,
  themeBackgroundImage,
  themeTintColor,
  themeAccentColor,
  onClose,
  onReact,
  onReply,
  onForward,
  onToggleStar,
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
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={() => !busy && onClose()}
          accessibilityLabel="Dismiss message actions"
        />

        <ThemeGlassSheet
          backgroundImage={themeBackgroundImage}
          tintColor={themeTintColor}
          accentColor={themeAccentColor}
          blurRadius={26}
          style={[
            styles.sheetContainer,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          {/* Subtle handle bar */}
          <View style={styles.handle} />

          {/* Message Timestamp Header */}
          {Boolean(message.createdAt) && (
            <View style={styles.timestampRow}>
              <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.68)" />
              <Text variant="xs" weight="500" style={styles.timestampLabel}>
                {`${formatChatDateSeparator(message.createdAt)} · ${formatMessageTime(message.createdAt)}`}
              </Text>
            </View>
          )}

          {/* Quick Reaction Row */}
          {confirmed && <View style={styles.reactionsBar}>
            {REACTION_EMOJIS.map((emoji) => {
              const isSelected = Boolean(
                currentUserId &&
                  message.reactions?.some(
                    (r) => r.emoji === emoji && r.studentId === currentUserId,
                  ),
              );
              return (
                <TouchableOpacity
                  key={emoji}
                  disabled={busy}
                  onPress={() => handleReact(emoji)}
                  style={[
                    styles.reactionButton,
                    isSelected && {
                      backgroundColor: 'rgba(255, 255, 255, 0.18)',
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.34)',
                    },
                  ]}
                  activeOpacity={0.65}
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <RNText style={styles.reactionEmoji} allowFontScaling={false}>{emoji}</RNText>
                </TouchableOpacity>
              );
            })}
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
                <Ionicons name="arrow-undo-outline" size={20} color="#F4F4F5" />
              </View>
              <Text variant="md" weight="500" style={styles.actionLabel}>
                Reply
              </Text>
            </TouchableOpacity>}

            {/* Forward Action */}
            {confirmed && onForward && Boolean(message.text && message.text.trim()) && (
              <TouchableOpacity
                disabled={busy}
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={() => onForward(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name="arrow-redo-outline" size={20} color="#F4F4F5" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  Forward message
                </Text>
              </TouchableOpacity>
            )}

            {/* Star / Bookmark Action */}
            {confirmed && onToggleStar && (
              <TouchableOpacity
                disabled={busy}
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={() => onToggleStar(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name={isStarred ? 'star' : 'star-outline'} size={20} color="#F4F4F5" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  {isStarred ? 'Remove star' : 'Star message'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Copy Text Action */}
            {Boolean(message.text && message.text.trim()) && (
              <TouchableOpacity
                disabled={busy}
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={() => onCopy(message)}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name="copy-outline" size={20} color="#F4F4F5" />
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
                  <Ionicons name="pin-outline" size={20} color="#F4F4F5" />
                </View>
                <Text variant="md" weight="500" style={styles.actionLabel}>
                  {isPinned ? 'Unpin announcement' : 'Pin announcement'}
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
                  <Ionicons name="trash-outline" size={20} color="#F4F4F5" />
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
        </ThemeGlassSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    flex: 1,
  },
  sheetContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    alignSelf: 'center',
    marginBottom: 10,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  timestampLabel: {
    color: 'rgba(255, 255, 255, 0.70)',
    fontSize: 12,
  },
  reactionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  reactionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  reactionEmoji: {
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
  actionsList: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.13)',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.09)',
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
    color: '#F5F5F5',
    flex: 1,
  },
  busyIndicator: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelButton: {
    marginTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  cancelLabel: {
    color: '#E4E4E7',
  },
});
