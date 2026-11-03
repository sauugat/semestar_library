import React from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  type TextInputInstance,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';

const QUICK_EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

export interface CommentComposerBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  inputRef?: React.RefObject<TextInputInstance | null>;
  placeholder?: string;
  userAvatarUrl?: string | null;
  userName?: string | null;
  replyingTo?: {
    commentId: number;
    name: string;
    studentId?: string;
  } | null;
  editingComment?: {
    id: number;
    content: string;
  } | null;
  onCancelMode?: () => void;
  showQuickEmojis?: boolean;
}

export function CommentComposerBar({
  value,
  onChangeText,
  onSubmit,
  submitting = false,
  inputRef,
  placeholder,
  userAvatarUrl,
  userName,
  replyingTo,
  editingComment,
  onCancelMode,
  showQuickEmojis = true,
}: CommentComposerBarProps) {
  const { colors } = useTheme();
  const hasText = Boolean(value.trim());

  const handleEmojiPress = (emoji: string) => {
    onChangeText(`${value}${emoji}`);
    setTimeout(() => {
      inputRef?.current?.focus();
    }, 20);
  };

  const resolvedPlaceholder = editingComment
    ? 'Edit your comment...'
    : replyingTo
    ? `Reply to ${replyingTo.name}...`
    : placeholder || 'Join the conversation...';

  return (
    <View style={styles.wrapper}>
      {/* Replying / Editing Indicator Bar */}
      {(replyingTo || editingComment) && (
        <View
          style={[
            styles.contextBar,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.contextLeft}>
            <Ionicons
              name={editingComment ? 'pencil' : 'arrow-undo'}
              size={13}
              color={colors.primary}
            />
            <Text variant="xs" weight="600" color="secondary" numberOfLines={1}>
              {editingComment ? 'Editing comment' : `Replying to ${replyingTo?.name}`}
            </Text>
          </View>
          {onCancelMode && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onCancelMode}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Instagram-style Quick Emoji Bar */}
      {showQuickEmojis && (
        <View style={styles.emojiBar}>
          {QUICK_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              activeOpacity={0.65}
              onPress={() => handleEmojiPress(emoji)}
              style={styles.emojiBtn}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input Row: Avatar on Left + Pill Input with Inline Send Button */}
      <View style={styles.inputRow}>
        <Avatar
          url={userAvatarUrl || null}
          name={userName || 'You'}
          size="sm"
        />

        <View
          style={[
            styles.pillContainer,
            {
              backgroundColor: colors.surfaceSubtle || colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            placeholder={resolvedPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={value}
            onChangeText={onChangeText}
            multiline
            maxLength={1000}
            style={[
              styles.textInput,
              {
                color: colors.text,
              },
            ]}
          />

          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onSubmit}
            disabled={!hasText || submitting}
            style={[
              styles.sendBtn,
              {
                backgroundColor: hasText ? '#3B82F6' : 'transparent',
                opacity: hasText ? 1 : 0.4,
              },
            ]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel={editingComment ? 'Save comment edit' : 'Post comment'}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name={editingComment ? 'checkmark' : 'arrow-up'}
                size={18}
                color={hasText ? '#FFFFFF' : colors.textMuted}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  contextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  emojiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
    paddingTop: 2,
  },
  emojiBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 22,
    lineHeight: 28,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  pillContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 42,
    maxHeight: 110,
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 4,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    minHeight: 32,
    maxHeight: 96,
    paddingTop: Platform.OS === 'ios' ? 6 : 5,
    paddingBottom: Platform.OS === 'ios' ? 6 : 5,
    paddingRight: 8,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
});
