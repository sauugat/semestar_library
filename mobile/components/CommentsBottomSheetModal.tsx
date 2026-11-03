import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  useWindowDimensions,
  type TextInputInstance,
  type ScrollViewInstance,
  type KeyboardEvent,
} from 'react-native';
import { runOnJS } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { CommentItem } from '@/components/CommentItem';
import { CommentComposerBar } from '@/components/CommentComposerBar';
import { PostComment } from '@/services/posts';

export interface CommentsBottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  comments: PostComment[];
  loading: boolean;
  posting: boolean;
  commentInput: string;
  onChangeCommentInput: (text: string) => void;
  onSubmitComment: () => void;
  commentInputRef: React.RefObject<TextInputInstance | null>;
  replyingTo: {
    commentId: number;
    name: string;
    studentId?: string;
  } | null;
  editingComment: {
    id: number;
    content: string;
  } | null;
  onCancelInputMode: () => void;
  onReply?: (comment: PostComment) => void;
  onEdit?: (comment: PostComment) => void;
  onDelete: (comment: PostComment) => void;
  onToggleReaction?: (comment: PostComment) => void;
  getFullUrl: (path?: any) => string | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  currentUserAvatar?: string | null;
  isAdmin?: boolean;
  onNavigateProfile?: (studentId: string) => void;
}

export function CommentsBottomSheetModal({
  visible,
  onClose,
  comments,
  loading,
  posting,
  commentInput,
  onChangeCommentInput,
  onSubmitComment,
  commentInputRef,
  replyingTo,
  editingComment,
  onCancelInputMode,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  getFullUrl,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  isAdmin,
  onNavigateProfile,
}: CommentsBottomSheetModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollViewInstance>(null);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [backdropHeight, setBackdropHeight] = useState(windowHeight);
  const closedBackdropHeightRef = useRef(windowHeight);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
    }
  }, [visible]);

  // Listen to native Keyboard events (works in both native builds & Expo Go)
  useEffect(() => {
    if (!visible) return;

    const onShow = (e: KeyboardEvent) => {
      const h = e?.endCoordinates?.height || 0;
      if (h > 0) {
        setKeyboardHeight(h);
      }
    };
    const onHide = () => {
      setKeyboardHeight(0);
    };

    const s1 = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      onShow
    );
    const s2 =
      Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidShow', onShow) : null;
    const s3 = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      onHide
    );
    const s4 =
      Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidHide', onHide) : null;

    return () => {
      s1.remove();
      s2?.remove();
      s3.remove();
      s4?.remove();
    };
  }, [visible]);

  // Also sync with react-native-keyboard-controller worklet events when available
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        if (e.height > 0) {
          runOnJS(setKeyboardHeight)(e.height);
        }
      },
      onEnd: (e) => {
        'worklet';
        runOnJS(setKeyboardHeight)(Math.max(0, e.height));
      },
    },
    [visible]
  );

  // Update closed reference height when keyboard is closed
  useEffect(() => {
    if (keyboardHeight === 0 && backdropHeight > 0) {
      closedBackdropHeightRef.current = Math.max(windowHeight, backdropHeight);
    }
  }, [keyboardHeight, backdropHeight, windowHeight]);

  // Calculate exact bottom offset so we never double-count if an Android Modal dialog resizes itself
  const baseFullHeight = Math.max(windowHeight, closedBackdropHeightRef.current);
  const modalAlreadyShrankBy =
    keyboardHeight > 0 ? Math.max(0, baseFullHeight - backdropHeight) : 0;
  const effectiveKeyboardPadding =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - modalAlreadyShrankBy) : 0;

  const topSafeMargin = Math.max(insets.top, 24) + 12;
  const availableSheetHeight = Math.max(
    260,
    backdropHeight - effectiveKeyboardPadding - topSafeMargin
  );
  const defaultSheetHeight = Math.round(baseFullHeight * 0.76);
  const sheetHeight =
    keyboardHeight > 0
      ? Math.min(defaultSheetHeight, availableSheetHeight)
      : Math.min(defaultSheetHeight, availableSheetHeight);

  // Scroll to bottom when a comment is added
  const prevCommentCountRef = useRef(comments.length);
  useEffect(() => {
    if (comments.length > prevCommentCountRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
    prevCommentCountRef.current = comments.length;
  }, [comments.length]);

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.backdrop,
          {
            paddingBottom: effectiveKeyboardPadding,
          },
        ]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) {
            setBackdropHeight(h);
          }
        }}
      >
        {/* Tap outside sheet to dismiss */}
        <Pressable
          style={styles.backdropDismissArea}
          onPress={handleClose}
          accessibilityLabel="Close comments"
        />

        {/* Instagram-style Bottom Sheet */}
        <View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.surface,
              height: sheetHeight,
              maxHeight: availableSheetHeight,
            },
          ]}
        >
          {/* Drag Handle + Centered "Comments" Header */}
          <View
            style={[
              styles.sheetHeader,
              {
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: colors.borderStrong || colors.textMuted },
              ]}
            />
            <View style={styles.titleRow}>
              <View style={styles.headerSideSpacer} />
              <Text weight="700" style={[styles.headerTitle, { color: colors.text }]}>
                Comments
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.closeBtn}
                accessibilityLabel="Close comments sheet"
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Comments List */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.commentsScroll}
            contentContainerStyle={styles.commentsScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.emptyContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : comments.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text weight="700" style={{ fontSize: 16, color: colors.text, marginBottom: 4 }}>
                  No comments yet
                </Text>
                <Text variant="xs" color="muted">
                  Start the conversation.
                </Text>
              </View>
            ) : (
              comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleReaction={onToggleReaction}
                  getFullUrl={getFullUrl}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  onNavigateProfile={(sid) => {
                    handleClose();
                    if (onNavigateProfile) {
                      onNavigateProfile(sid);
                    }
                  }}
                />
              ))
            )}
          </ScrollView>

          {/* Docked Quick Emoji Bar + Comment Input Bar */}
          <View
            style={[
              styles.composerFooter,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                paddingBottom: keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 12),
              },
            ]}
          >
            <CommentComposerBar
              value={commentInput}
              onChangeText={onChangeCommentInput}
              onSubmit={onSubmitComment}
              submitting={posting}
              inputRef={commentInputRef}
              userAvatarUrl={getFullUrl(currentUserAvatar)}
              userName={currentUserName}
              replyingTo={replyingTo}
              editingComment={editingComment}
              onCancelMode={onCancelInputMode}
              showQuickEmojis
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropDismissArea: {
    flex: 1,
  },
  sheetContainer: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetHeader: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    opacity: 0.45,
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  headerSideSpacer: {
    width: 28,
  },
  headerTitle: {
    fontSize: 15,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  closeBtn: {
    width: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  commentsScroll: {
    flex: 1,
  },
  commentsScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
  },
  composerFooter: {
    paddingHorizontal: 12,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
