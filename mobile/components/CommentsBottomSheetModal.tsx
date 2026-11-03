import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Animated,
  Easing,
  PanResponder,
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

const DISMISS_DRAG_DISTANCE = 80;
const DISMISS_SWIPE_VELOCITY = 0.65;

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

  // Internal mount state so we completely control slide-in and slide-out animations
  // without fighting React Native Modal's native animationType="slide" (which caused the close flicker).
  const [modalMounted, setModalMounted] = useState(visible);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [backdropHeight, setBackdropHeight] = useState(windowHeight);
  const closedBackdropHeightRef = useRef(windowHeight);

  const offscreenY = Math.max(windowHeight, 800) + 60;
  const sheetTranslateY = useRef(new Animated.Value(offscreenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const isClosingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const scrollOffsetYRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const offscreenYRef = useRef(offscreenY);
  offscreenYRef.current = offscreenY;

  const animateClose = useCallback(
    (notifyParent: boolean = true) => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      isDraggingRef.current = false;

      Keyboard.dismiss();
      sheetTranslateY.stopAnimation();
      backdropOpacity.stopAnimation();

      Animated.parallel([
        Animated.timing(sheetTranslateY, {
          toValue: offscreenYRef.current,
          duration: 210,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 190,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        // CRITICAL: Never reset sheetTranslateY to 0 here before unmount!
        // Keep it at offscreenY while unmounting so the sheet can never flash back onto the screen.
        setKeyboardHeight(0);
        setModalMounted(false);
        if (notifyParent) {
          onCloseRef.current();
        }
      });
    },
    [backdropOpacity, sheetTranslateY]
  );

  const snapBackToOpen = useCallback(() => {
    if (isClosingRef.current) return;
    isDraggingRef.current = false;
    sheetTranslateY.stopAnimation();
    backdropOpacity.stopAnimation();

    Animated.parallel([
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        damping: 24,
        stiffness: 260,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, sheetTranslateY]);

  // Synchronize open / close lifecycle with `visible` prop
  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      isDraggingRef.current = false;
      scrollOffsetYRef.current = 0;
      setModalMounted(true);

      // Start strictly offscreen before animating up to 0
      sheetTranslateY.stopAnimation();
      backdropOpacity.stopAnimation();
      sheetTranslateY.setValue(offscreenYRef.current);
      backdropOpacity.setValue(0);

      const frame = requestAnimationFrame(() => {
        if (isClosingRef.current) return;
        Animated.parallel([
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 26,
            stiffness: 250,
            mass: 0.9,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      });

      return () => cancelAnimationFrame(frame);
    } else if (modalMounted && !isClosingRef.current) {
      animateClose(false);
    }
  }, [visible, modalMounted, animateClose, backdropOpacity, sheetTranslateY]);

  // Shared helper for updating drag position & backdrop opacity during a downward swipe
  const updateDragPosition = (dy: number) => {
    if (isClosingRef.current) return;
    const clampedDy = Math.max(0, dy);
    sheetTranslateY.setValue(clampedDy);
    const progress = Math.min(1, clampedDy / Math.max(320, offscreenYRef.current * 0.55));
    backdropOpacity.setValue(Math.max(0, 1 - progress * 0.85));
  };

  // Shared helper for finishing or cancelling a gesture
  const finishDragGesture = (dy: number, vy: number) => {
    if (isClosingRef.current) return;
    if (dy > DISMISS_DRAG_DISTANCE || (dy > 24 && vy > DISMISS_SWIPE_VELOCITY)) {
      animateClose(true);
    } else {
      snapBackToOpen();
    }
  };

  // 1. Header / Drag Handle PanResponder (highest priority on the top bar)
  const headerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isClosingRef.current,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        !isClosingRef.current && gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        !isClosingRef.current && gs.dy > 6 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => {
        if (isClosingRef.current) return;
        isDraggingRef.current = true;
        sheetTranslateY.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        updateDragPosition(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        finishDragGesture(gs.dy, gs.vy);
      },
      onPanResponderTerminate: (_, gs) => {
        finishDragGesture(gs.dy, gs.vy);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // 2. Comments Body Pull-Down PanResponder (activates only when ScrollView is at top y <= 1 and user pulls down)
  const bodyPullPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        !isClosingRef.current &&
        scrollOffsetYRef.current <= 1 &&
        gs.dy > 10 &&
        gs.dy > Math.abs(gs.dx) * 1.35,
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        !isClosingRef.current &&
        scrollOffsetYRef.current <= 1 &&
        gs.dy > 10 &&
        gs.dy > Math.abs(gs.dx) * 1.35,
      onPanResponderGrant: () => {
        if (isClosingRef.current) return;
        isDraggingRef.current = true;
        sheetTranslateY.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        updateDragPosition(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        finishDragGesture(gs.dy, gs.vy);
      },
      onPanResponderTerminate: (_, gs) => {
        finishDragGesture(gs.dy, gs.vy);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // Listen to native Keyboard events (works in both native builds & Expo Go)
  useEffect(() => {
    if (!modalMounted) return;

    const onShow = (e: KeyboardEvent) => {
      if (isClosingRef.current) return;
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
  }, [modalMounted]);

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
    [modalMounted]
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
  const sheetHeight = Math.min(defaultSheetHeight, availableSheetHeight);

  // Scroll to bottom when a new comment is added
  const prevCommentCountRef = useRef(comments.length);
  useEffect(() => {
    if (comments.length > prevCommentCountRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
    prevCommentCountRef.current = comments.length;
  }, [comments.length]);

  const handleClose = useCallback(() => {
    animateClose(true);
  }, [animateClose]);

  if (!modalMounted && !visible) {
    return null;
  }

  return (
    <Modal
      visible={modalMounted}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.rootContainer,
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
        {/* Animated Dimmed Backdrop */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.backdropOverlay,
            {
              opacity: backdropOpacity,
            },
          ]}
        />

        {/* Tap outside sheet to dismiss */}
        <Pressable
          style={styles.backdropDismissArea}
          onPress={handleClose}
          accessibilityLabel="Close comments"
        />

        {/* Instagram-style Draggable Bottom Sheet */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.surface,
              height: sheetHeight,
              maxHeight: availableSheetHeight,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}
        >
          {/* Drag Handle + Centered "Comments" Header (swipe down to dismiss) */}
          <View
            {...headerPanResponder.panHandlers}
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

          {/* Comments List (also supports pulling down when at top of scroll to close) */}
          <View style={styles.commentsScrollWrapper} {...bodyPullPanResponder.panHandlers}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.commentsScroll}
              contentContainerStyle={styles.commentsScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollOffsetYRef.current = Math.max(0, e.nativeEvent.contentOffset.y);
              }}
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
                      animateClose(true);
                      if (onNavigateProfile) {
                        onNavigateProfile(sid);
                      }
                    }}
                  />
                ))
              )}
            </ScrollView>
          </View>

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
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropOverlay: {
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
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dragHandle: {
    width: 40,
    height: 4.5,
    borderRadius: 2.5,
    opacity: 0.5,
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
  commentsScrollWrapper: {
    flex: 1,
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
