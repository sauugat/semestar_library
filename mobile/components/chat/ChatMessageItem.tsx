import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  PanResponder,
  useWindowDimensions,
  ActivityIndicator,
  Image as RNImage,
  Text as RNText,
  AccessibilityInfo,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui/Typography';
import { ChatMessage, ChatReadReceipt } from '@/services/chat';
import { parseChatDate, formatFileSubtitle, formatFileExtension } from '@/services/chat-state';
import { formatMessageTime as safeFormatTime, formatChatDateSeparator as safeFormatSeparator } from '@/utils/date';

const imageDimensionsCache = new Map<string, { width: number; height: number }>();

function getFileIcon(
  filename?: string | null,
  mimeType?: string | null
): keyof typeof Ionicons.glyphMap {
  const ext = formatFileExtension(filename, mimeType).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'document-text-outline';
    case 'doc':
    case 'docx':
    case 'txt':
    case 'rtf':
      return 'document-outline';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return 'archive-outline';
    case 'ppt':
    case 'pptx':
      return 'easel-outline';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'grid-outline';
    default:
      return 'attach-outline';
  }
}

interface ChatMessageItemProps {
  item: ChatMessage;
  index: number;
  prevMsg: ChatMessage | null; // chronologically previous (visually above in inverted list: messages[index + 1])
  nextMsg: ChatMessage | null; // chronologically next (visually below in inverted list: messages[index - 1])
  currentUserId?: string;
  readReceipts: ChatReadReceipt[];
  serverUrl: string;
  authToken?: string | null;
  downloadingFileId: string | null;
  isInitialLoadItem: boolean;
  isHighlighted: boolean;
  isDelivered?: boolean;
  singleTapDelayMs?: number;
  onLongPress: (item: ChatMessage) => void;
  onSwipeReply: (item: ChatMessage) => void;
  onJumpToReply: (replyToId: number) => void;
  onOpenImage: (image: { uri: string; name: string }) => void;
  onDownloadFile: (item: ChatMessage) => void;
  onToggleReaction: (item: ChatMessage, emoji: string) => void;
  onRetry?: (item: ChatMessage) => void;
  onPressAuthor?: (studentId: string) => void;
  onPressMention?: (handle: string, item: ChatMessage) => void;
}

function formatMessageTime(isoString: string): string {
  return safeFormatTime(isoString);
}

function formatDateSeparator(isoString: string): string {
  return safeFormatSeparator(isoString);
}

function isSameDay(d1Str: string, d2Str: string): boolean {
  try {
    const d1 = parseChatDate(d1Str);
    const d2 = parseChatDate(d2Str);
    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  } catch {
    return false;
  }
}

function isImageAttachment(
  filename?: string | null,
  mimeType?: string | null
): boolean {
  if (mimeType && (mimeType.startsWith('image') || mimeType === 'image')) return true;
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg')
  );
}

function getFileExtension(filename?: string | null): string {
  if (!filename) return 'FILE';
  const parts = filename.split('.');
  if (parts.length > 1) {
    return parts.pop()!.toUpperCase().slice(0, 4);
  }
  return 'FILE';
}

function renderMessageTextWithLinks(
  text: string,
  isMe: boolean,
  baseStyle: any,
  onPressMention?: (handle: string, item: ChatMessage) => void,
  item?: ChatMessage
) {
  const regex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])|(\B@[a-zA-Z0-9_.]{1,30})/gi;
  const tokens: { type: 'text' | 'url' | 'mention'; value: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.substring(lastIndex, match.index) });
    }
    if (match[1]) {
      tokens.push({ type: 'url', value: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'mention', value: match[2] });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.substring(lastIndex) });
  }

  if (tokens.length <= 1 && tokens[0]?.type === 'text') {
    return <Text style={baseStyle}>{text}</Text>;
  }

  return (
    <Text style={baseStyle}>
      {tokens.map((token, i) => {
        if (token.type === 'url') {
          return (
            <Text
              key={i}
              style={[
                baseStyle,
                styles.urlLink,
                { color: isMe ? '#ffffff' : '#f5f5f5' },
              ]}
              onPress={() => Linking.openURL(token.value).catch(() => {})}
            >
              {token.value}
            </Text>
          );
        }
        if (token.type === 'mention') {
          const handle = token.value.slice(1);
          return (
            <Text
              key={i}
              style={[
                baseStyle,
                styles.mentionText,
                isMe ? styles.mentionTextMe : styles.mentionTextOther,
              ]}
              onPress={() => item && onPressMention?.(handle, item)}
            >
              {token.value}
            </Text>
          );
        }
        return <Text key={i} style={baseStyle}>{token.value}</Text>;
      })}
    </Text>
  );
}

function MessageStatusMeta({
  status,
  isMe,
  timeString,
  isRead,
  isDelivered,
  isEdited,
  onRetry,
  overlay = false,
}: {
  status?: 'sent' | 'pending' | 'failed';
  isMe: boolean;
  timeString: string;
  isRead: boolean;
  isDelivered?: boolean;
  isEdited?: boolean;
  onRetry?: () => void;
  overlay?: boolean;
}) {
  const isPending = status === 'pending';
  const isFailed = status === 'failed';
  const iconColor = overlay ? '#ffffff' : '#8e8e93';

  if (isFailed) {
    return (
      <TouchableOpacity
        onPress={onRetry}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {Boolean(timeString) && (
          <Text style={[overlay ? styles.imageOverlayTimeText : styles.timestampText, { color: '#ef4444' }]}>
            {timeString}
          </Text>
        )}
        <Ionicons name="alert-circle" size={13} color="#ef4444" style={{ marginLeft: 3 }} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {Boolean(isEdited) && (
        <Text style={overlay ? styles.imageOverlayEditedText : styles.editedLabel}>
          Edited{' '}
        </Text>
      )}
      <Text style={overlay ? styles.imageOverlayTimeText : styles.timestampText}>
        {timeString}
      </Text>
      {isMe && (
        isPending ? (
          <Ionicons
            name="time-outline"
            size={11}
            color={iconColor}
            style={{ marginLeft: 3 }}
          />
        ) : (
          <Ionicons
            name="checkmark"
            size={13}
            color={iconColor}
            style={{ marginLeft: 3 }}
          />
        )
      )}
    </View>
  );
}

function areMessagePropsEqual(
  prev: ChatMessageItemProps,
  next: ChatMessageItemProps
): boolean {
  if (prev.item.id !== next.item.id) return false;
  if (prev.item.clientId !== next.item.clientId) return false;
  if (prev.item.status !== next.item.status) return false;
  if (prev.item.text !== next.item.text) return false;
  if (prev.item.attachmentName !== next.item.attachmentName) return false;
  if (prev.item.attachmentSize !== next.item.attachmentSize) return false;
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.downloadingFileId !== next.downloadingFileId) return false;
  if (prev.isDelivered !== next.isDelivered) return false;
  if (prev.index !== next.index) return false;

  // Compare reactions
  const prevReactions = prev.item.reactions || [];
  const nextReactions = next.item.reactions || [];
  if (prevReactions.length !== nextReactions.length) return false;
  for (let i = 0; i < prevReactions.length; i++) {
    if (
      prevReactions[i].emoji !== nextReactions[i].emoji ||
      prevReactions[i].studentId !== nextReactions[i].studentId
    ) {
      return false;
    }
  }

  // Check read receipt state: only re-render if the read status for this specific message changed
  const prevIsRead =
    prev.currentUserId &&
    String(prev.item.studentId) === String(prev.currentUserId) &&
    prev.readReceipts.some(
      (r) =>
        String(r.studentId) !== String(prev.currentUserId) &&
        r.lastReadMessageId >= prev.item.id
    );
  const nextIsRead =
    next.currentUserId &&
    String(next.item.studentId) === String(next.currentUserId) &&
    next.readReceipts.some(
      (r) =>
        String(r.studentId) !== String(next.currentUserId) &&
        r.lastReadMessageId >= next.item.id
    );
  if (prevIsRead !== nextIsRead) return false;

  // Author grouping transitions
  if (prev.prevMsg?.studentId !== next.prevMsg?.studentId) return false;
  if (prev.nextMsg?.studentId !== next.nextMsg?.studentId) return false;
  if (prev.prevMsg?.id !== next.prevMsg?.id) return false;
  if (prev.nextMsg?.id !== next.nextMsg?.id) return false;

  return true;
}

export const ChatMessageItem = React.memo(function ChatMessageItem({
  item,
  prevMsg,
  nextMsg,
  currentUserId,
  readReceipts,
  serverUrl,
  authToken,
  downloadingFileId,
  isInitialLoadItem,
  isHighlighted,
  isDelivered: isDeliveredProp,
  singleTapDelayMs,
  onLongPress,
  onSwipeReply,
  onJumpToReply,
  onOpenImage,
  onDownloadFile,
  onToggleReaction,
  onRetry,
  onPressAuthor,
  onPressMention,
}: ChatMessageItemProps) {
  const { width: screenWidth } = useWindowDimensions();
  const maxBubbleWidth = Math.round(screenWidth * 0.8);
  const maxImageWidth = Math.round(screenWidth * 0.74);
  const maxImageHeight = Math.round(maxImageWidth * 1.25); // 4:5 max ratio

  const isMe = currentUserId ? String(item.studentId) === String(currentUserId) : false;

  // Date Separator Check: if no prevMsg (chronologically earlier, visually above) or different day
  const showDate = !prevMsg || !isSameDay(prevMsg.createdAt, item.createdAt);

  // Consecutive Grouping Logic
  // prevMsg is chronologically earlier (visually above).
  // If prevMsg has same sender, same day, and < 4 mins apart, this message follows a previous one.
  const isFirstInGroup =
    !prevMsg ||
    showDate ||
    String(prevMsg.studentId) !== String(item.studentId) ||
    Math.abs(parseChatDate(item.createdAt).getTime() - parseChatDate(prevMsg.createdAt).getTime()) >= 4 * 60 * 1000;

  // nextMsg is chronologically later (visually below).
  // If nextMsg has same sender, same day, and < 4 mins apart, this message is followed by another.
  const nextIsSameDay = nextMsg ? isSameDay(item.createdAt, nextMsg.createdAt) : false;
  const isLastInGroup =
    !nextMsg ||
    !nextIsSameDay ||
    String(nextMsg.studentId) !== String(item.studentId) ||
    Math.abs(parseChatDate(nextMsg.createdAt).getTime() - parseChatDate(item.createdAt).getTime()) >= 4 * 60 * 1000;

  const isConsecutive = !isFirstInGroup;

  const isImg = isImageAttachment(item.attachmentName, item.attachmentMimeType);
  const attachmentUrl = item.localUri
    ? item.localUri
    : item.attachmentName
      ? `${serverUrl}/api/chat/attachment/${encodeURIComponent(item.attachmentName)}`
      : null;

  const timeString = formatMessageTime(item.createdAt);
  const initialChar = (item.name || 'S').trim().charAt(0).toUpperCase();

  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const avatarFullUrl = useMemo(() => {
    if (!item.avatarUrl) return null;
    if (item.avatarUrl.startsWith('http://') || item.avatarUrl.startsWith('https://')) {
      return item.avatarUrl;
    }
    const base = serverUrl || 'https://semestar-library.vercel.app';
    return `${base.replace(/\/+$/, '')}/${item.avatarUrl.replace(/^\/+/, '')}`;
  }, [item.avatarUrl, serverUrl]);

  // Image natural aspect ratio tracking & measurement
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(() => {
    if (!attachmentUrl) return null;
    return imageDimensionsCache.get(attachmentUrl) || null;
  });

  useEffect(() => {
    if (!isImg || !attachmentUrl) return;
    if (imageDimensionsCache.has(attachmentUrl)) return;
    RNImage.getSize(
      attachmentUrl,
      (w, h) => {
        if (w > 0 && h > 0) {
          imageDimensionsCache.set(attachmentUrl, { width: w, height: h });
          setImageDims({ width: w, height: h });
        }
      },
      () => {}
    );
  }, [isImg, attachmentUrl]);

  const targetImageWidth = Math.min(Math.round(screenWidth * 0.72), 290);
  const renderedImageDims = useMemo(() => {
    if (!imageDims || !imageDims.width || !imageDims.height) {
      return { width: targetImageWidth, height: Math.round(targetImageWidth * 0.75), contentFit: 'cover' as const };
    }
    const naturalRatio = imageDims.width / imageDims.height;
    const minRatio = 4 / 5; // 0.8 cap: only crop if taller than 4:5
    if (naturalRatio < minRatio) {
      return { width: targetImageWidth, height: Math.round(targetImageWidth / minRatio), contentFit: 'cover' as const };
    }
    return { width: targetImageWidth, height: Math.round(targetImageWidth / naturalRatio), contentFit: 'cover' as const };
  }, [imageDims, targetImageWidth]);

  // Read receipts check: someone else read up to this message
  const isRead = isMe && readReceipts.some(
    (r) => String(r.studentId) !== String(currentUserId) && r.lastReadMessageId >= item.id
  );
  const isDelivered = isMe && (isDeliveredProp || isRead || (item.status === 'sent' && item.id > 0 && Boolean((item as any).delivered)));

  // Grouped Reactions: map to emoji -> count & userReacted
  const reactionMap = useMemo(() => {
    const map = new Map<string, { count: number; reactedByMe: boolean }>();
    (item.reactions || []).forEach((r) => {
      const existing = map.get(r.emoji) || { count: 0, reactedByMe: false };
      existing.count += 1;
      if (currentUserId && String(r.studentId) === String(currentUserId)) {
        existing.reactedByMe = true;
      }
      map.set(r.emoji, existing);
    });
    return Array.from(map.entries()).map(([emoji, data]) => ({ emoji, ...data }));
  }, [item.reactions, currentUserId]);

  // Entrance motion: subtle & fast (< 180ms) for new messages, none for initial history
  const entryAnim = useRef(new Animated.Value(isInitialLoadItem ? 1 : 0)).current;
  useEffect(() => {
    if (!isInitialLoadItem) {
      Animated.timing(entryAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }
  }, [isInitialLoadItem, entryAnim]);

  // Highlight flash animation when jumped to
  const highlightAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isHighlighted) {
      Animated.sequence([
        Animated.timing(highlightAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(highlightAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [isHighlighted, highlightAnim]);

  // Swipe-to-reply PanResponder
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            gestureState.dx > 10 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5 &&
            Math.abs(gestureState.dy) < 25
          );
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 0) {
            translateX.setValue(Math.min(gestureState.dx * 0.65, 55));
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 45) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            if (item.id > 0) onSwipeReply(item);
          }
          Animated.spring(translateX, {
            toValue: 0,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }).start();
        },
      }),
    [item, onSwipeReply, translateX]
  );

  // Reduced motion preference
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // Gesture refs for single tap vs double tap coordination
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  // Heart pop animation shared values
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);
  const heartTranslateY = useSharedValue(0);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: heartScale.value },
      { translateY: heartTranslateY.value },
    ],
    opacity: heartOpacity.value,
  }));

  const triggerHeartReaction = () => {
    if (item.id <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (reduceMotion) {
      heartScale.value = 1.0;
      heartTranslateY.value = 0;
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 80 }),
        withTiming(1, { duration: 400 }),
        withTiming(0, { duration: 200 })
      );
    } else {
      heartScale.value = 0.6;
      heartTranslateY.value = 0;
      heartOpacity.value = 1;

      heartScale.value = withSequence(
        withSpring(1.15, { damping: 10, stiffness: 220 }),
        withSpring(1.0, { damping: 12, stiffness: 180 }),
        withTiming(1.05, { duration: 220 })
      );
      heartTranslateY.value = withSequence(
        withTiming(0, { duration: 180 }),
        withTiming(-16, { duration: 450 })
      );
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 350 }),
        withTiming(0, { duration: 250 })
      );
    }

    onToggleReaction(item, '❤️');
  };

  const handleBubblePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      triggerHeartReaction();
    } else {
      lastTapRef.current = now;
    }
  };

  const tapDelay = singleTapDelayMs ?? 250;
  const handleImagePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      triggerHeartReaction();
    } else {
      lastTapRef.current = now;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      if (tapDelay <= 0) {
        if (attachmentUrl) {
          onOpenImage({
            uri: attachmentUrl,
            name: item.attachmentOriginalName || item.attachmentName || 'image.jpg',
          });
        }
      } else {
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null;
          if (attachmentUrl) {
            onOpenImage({
              uri: attachmentUrl,
              name: item.attachmentOriginalName || item.attachmentName || 'image.jpg',
            });
          }
        }, tapDelay);
      }
    }
  };

  const handleFilePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      triggerHeartReaction();
    } else {
      lastTapRef.current = now;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      if (tapDelay <= 0) {
        onDownloadFile(item);
      } else {
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null;
          onDownloadFile(item);
        }, tapDelay);
      }
    }
  };

  const handleLongPress = () => {
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
    }
    lastTapRef.current = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onLongPress(item);
  };

  const hasCaption = isImg && Boolean(item.text && item.text.trim());
  const isImageOnly = isImg && !hasCaption;

  return (
    <Animated.View
      style={[
        styles.rowWrapper,
        {
          opacity: entryAnim,
          transform: [
            {
              translateY: entryAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Date Separator Pill */}
      {showDate && (
        <View style={styles.dateSeparatorRow}>
          <View style={styles.dateSeparatorPill}>
            <Text style={styles.dateSeparatorText}>
              {formatDateSeparator(item.createdAt)}
            </Text>
          </View>
        </View>
      )}

      {/* Swipeable Container */}
      <View style={styles.swipeRowWrapper} {...panResponder.panHandlers}>
        {/* Reply Icon Indicator revealed on swipe right */}
        <Animated.View
          style={[
            styles.swipeReplyIconBox,
            {
              opacity: translateX.interpolate({
                inputRange: [0, 25, 45],
                outputRange: [0, 0.7, 1],
              }),
              transform: [
                {
                  scale: translateX.interpolate({
                    inputRange: [0, 30, 48],
                    outputRange: [0.5, 0.9, 1.1],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons name="arrow-undo" size={15} color="#e4e4e7" />
        </Animated.View>

        {/* Animated Message Row */}
        <Animated.View
          style={[
            styles.bubbleRowAnimated,
            isMe ? styles.bubbleRowRight : styles.bubbleRowLeft,
            {
              marginTop: isConsecutive ? 2 : 10,
              transform: [{ translateX }],
            },
          ]}
        >
          {/* Avatar for Others (shown only on LAST message of a group) */}
          {!isMe && (
            <View style={styles.avatarGutter}>
              {isLastInGroup ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => item.studentId && onPressAuthor?.(item.studentId)}
                  disabled={!item.studentId || !onPressAuthor}
                  accessibilityLabel={`View ${item.name || 'student'}'s profile`}
                >
                  {avatarFullUrl && !avatarLoadError ? (
                    <Image
                      source={{
                        uri: avatarFullUrl,
                        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                        cacheKey: item.avatarUrl || avatarFullUrl,
                      }}
                      style={styles.avatarImage}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      onError={() => setAvatarLoadError(true)}
                    />
                  ) : (
                    <View style={styles.avatarInitial}>
                      <Text style={styles.avatarInitialText}>{initialChar}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.avatarSpacer} />
              )}
            </View>
          )}

          {/* Bubble Container & Reactions */}
          <View style={{ maxWidth: maxBubbleWidth }}>
            <Pressable
              onPress={handleBubblePress}
              onLongPress={handleLongPress}
              delayLongPress={280}
              accessibilityLabel={`Message from ${item.name || 'someone'}. Double tap to react with heart. Long press for actions.`}
              style={[
                styles.messageBubble,
                isMe ? styles.bubbleMe : styles.bubbleOther,
                // Tail corner radius: 4px on bottom corner when last in group
                isMe && isLastInGroup && { borderBottomRightRadius: 4 },
                !isMe && isLastInGroup && { borderBottomLeftRadius: 4 },
                isImageOnly && styles.imageBubbleTightPadding,
                isImg && { width: renderedImageDims.width + 6 },
              ]}
            >
              {/* Highlight Flash Overlay */}
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  styles.highlightOverlay,
                  { opacity: highlightAnim },
                ]}
              />

              {/* Temporary Heart Pop Animation */}
              <Reanimated.View
                pointerEvents="none"
                style={[
                  styles.heartPopContainer,
                  heartAnimatedStyle,
                ]}
              >
                <RNText style={styles.heartPopEmoji} allowFontScaling={false}>
                  ❤️
                </RNText>
              </Reanimated.View>

              {/* Sender Name for Others (first message in group only) */}
              {!isMe && isFirstInGroup && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => item.studentId && onPressAuthor?.(item.studentId)}
                  disabled={!item.studentId || !onPressAuthor}
                  accessibilityLabel={`View ${item.name || 'student'}'s profile`}
                  style={{ alignSelf: 'flex-start', marginBottom: 2 }}
                >
                  <Text style={styles.senderNameText} numberOfLines={1}>
                    {item.name || 'Classmate'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Quoted Reply Block */}
              {Boolean(item.replyToId) && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => onJumpToReply(item.replyToId!)}
                  style={styles.replyQuoteBlock}
                >
                  <Text style={styles.replySenderText} numberOfLines={1}>
                    {item.replySender || 'Someone'}
                  </Text>
                  <Text style={styles.replyPreviewText} numberOfLines={1}>
                    {item.replyText || 'Attachment'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Image Attachment */}
              {isImg && attachmentUrl && (
                <Pressable
                  onPress={handleImagePress}
                  onLongPress={handleLongPress}
                  delayLongPress={280}
                  accessibilityLabel="Open photo. Double tap for heart reaction. Long press for message actions."
                  style={styles.imageContainer}
                >
                  <Image
                    source={{
                      uri: attachmentUrl,
                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                    }}
                    style={[
                      styles.imageThumbnail,
                      {
                        width: renderedImageDims.width,
                        height: renderedImageDims.height,
                      },
                    ]}
                    cachePolicy="memory-disk"
                    recyclingKey={`${item.id}:${item.attachmentName}`}
                    contentFit={renderedImageDims.contentFit}
                    transition={150}
                    onLoad={(e) => {
                      const { width, height } = e.source;
                      if (width && height && attachmentUrl && !imageDimensionsCache.has(attachmentUrl)) {
                        imageDimensionsCache.set(attachmentUrl, { width, height });
                        setImageDims({ width, height });
                      }
                    }}
                  />

                  {/* Subtle translucent dark overlay while uploading */}
                  {item.status === 'pending' && (
                    <View style={styles.imageUploadingOverlay}>
                      <ActivityIndicator size="small" color="#ffffff" />
                    </View>
                  )}

                  {/* If image only: overlay timestamp pill on bottom-right of image */}
                  {isImageOnly && (
                    <View style={styles.imageOverlayMetaPill}>
                      <MessageStatusMeta
                        status={item.status}
                        isMe={isMe}
                        timeString={timeString}
                        isRead={isRead}
                        isDelivered={isDelivered}
                        isEdited={Boolean((item as any).isEdited)}
                        onRetry={() => onRetry?.(item)}
                        overlay
                      />
                    </View>
                  )}
                </Pressable>
              )}

              {/* Non-image File Attachment Row */}
              {!isImg && item.attachmentName && (
                <Pressable
                  onPress={handleFilePress}
                  onLongPress={handleLongPress}
                  delayLongPress={280}
                  accessibilityRole="button"
                  accessibilityLabel={`Open attachment. ${item.attachmentOriginalName || item.attachmentName}. Double tap to react with heart, single tap to download.`}
                  style={[
                    styles.fileCard,
                    isMe ? styles.fileCardMe : styles.fileCardOther,
                  ]}
                >
                  <View style={styles.fileIconBox}>
                    <Ionicons
                      name={getFileIcon(item.attachmentOriginalName || item.attachmentName, item.attachmentMimeType)}
                      size={22}
                      color="#e4e4e7"
                    />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text
                      style={styles.fileNameText}
                      numberOfLines={2}
                      ellipsizeMode="middle"
                    >
                      {item.attachmentOriginalName || item.attachmentName}
                    </Text>
                    <Text style={styles.fileMetaSubtitle}>
                      {formatFileSubtitle(
                        item.attachmentOriginalName || item.attachmentName,
                        item.attachmentSize || (item.pendingFile as any)?.size,
                        item.attachmentMimeType
                      )}
                    </Text>
                  </View>
                  {downloadingFileId === String(item.id) ? (
                    <ActivityIndicator size="small" color="#e4e4e7" style={styles.fileActionIcon} />
                  ) : (
                    <Ionicons
                      name="arrow-down-circle-outline"
                      size={20}
                      color="#a1a1aa"
                      style={styles.fileActionIcon}
                    />
                  )}
                </Pressable>
              )}

              {/* Text Body with Inline Bottom-Right Meta */}
              {Boolean(item.text && item.text.trim()) && (
                <View style={[styles.textContainer, isImg && styles.captionContainer]}>
                  <View style={styles.textWithInlineMetaWrapper}>
                    {renderMessageTextWithLinks(
                      item.text,
                      isMe,
                      isMe ? styles.bubbleTextMe : styles.bubbleTextOther,
                      onPressMention,
                      item
                    )}

                    {/* Invisible spacer to reserve width for inline timestamp */}
                    <Text style={styles.invisibleMetaSpacer} pointerEvents="none">
                      {'   '}{timeString}{isMe ? '  ✓✓' : ''}
                      {Boolean((item as any).isEdited) ? '  Edited' : ''}
                    </Text>
                  </View>

                  {/* Absolute inline metadata placed at bottom-right */}
                  <View style={styles.inlineMetaBox}>
                    <MessageStatusMeta
                      status={item.status}
                      isMe={isMe}
                      timeString={timeString}
                      isRead={isRead}
                      isDelivered={isDelivered}
                      isEdited={Boolean((item as any).isEdited)}
                      onRetry={() => onRetry?.(item)}
                    />
                  </View>
                </View>
              )}

              {/* If no text and not image-only (e.g. document only), render timestamp bar */}
              {!isImg && !Boolean(item.text && item.text.trim()) && (
                <View style={styles.fileMetaRow}>
                  <MessageStatusMeta
                    status={item.status}
                    isMe={isMe}
                    timeString={timeString}
                    isRead={isRead}
                    isDelivered={isDelivered}
                    isEdited={Boolean((item as any).isEdited)}
                    onRetry={() => onRetry?.(item)}
                  />
                </View>
              )}
            </Pressable>


            {/* Reactions (rendered as small pills just below the bubble's bottom edge) */}
            {reactionMap.length > 0 && (
              <View
                style={[
                  styles.reactionPillsContainer,
                  isMe ? styles.reactionPillsRight : styles.reactionPillsLeft,
                ]}
              >
                {reactionMap.map(({ emoji, count, reactedByMe }) => (
                  <TouchableOpacity
                    key={emoji}
                    activeOpacity={0.7}
                    onPress={() => onToggleReaction(item, emoji)}
                    style={[
                      styles.reactionPill,
                      reactedByMe && styles.reactionPillActive,
                    ]}
                  >
                    <RNText style={styles.reactionPillEmojiText} allowFontScaling={false}>{emoji}</RNText>
                    {count > 1 && (
                      <Text style={styles.reactionPillCountText}>{count}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}, areMessagePropsEqual);

const styles = StyleSheet.create({
  rowWrapper: {
    width: '100%',
  },
  dateSeparatorRow: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dateSeparatorPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 0,
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8e8e93',
  },
  swipeRowWrapper: {
    width: '100%',
    position: 'relative',
  },
  swipeReplyIconBox: {
    position: 'absolute',
    left: 12,
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  bubbleRowAnimated: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  avatarGutter: {
    width: 28,
    marginRight: 8,
    alignItems: 'center',
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272a',
  },
  avatarInitial: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitialText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e4e4e7',
  },
  avatarSpacer: {
    width: 28,
    height: 1,
  },
  messageBubble: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: 16,
    borderWidth: 0, // STRICTLY NO BORDER
    overflow: 'hidden',
  },
  bubbleMe: {
    backgroundColor: '#2c2c2e', // own: lighter gray fill
  },
  bubbleOther: {
    backgroundColor: '#1c1c1e', // others: darker gray fill
  },
  imageBubbleTightPadding: {
    paddingHorizontal: 3,
    paddingTop: 3,
    paddingBottom: 3,
  },
  highlightOverlay: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 16,
  },
  senderNameText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#a1a1aa', // Semibold light gray, strictly no colors
    marginBottom: 4,
  },
  replyQuoteBlock: {
    borderLeftWidth: 3,
    borderLeftColor: '#8e8e93',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
    borderWidth: 0,
  },
  replySenderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e4e4e7',
  },
  replyPreviewText: {
    fontSize: 11,
    color: '#a1a1aa',
    marginTop: 1,
  },
  imageContainer: {
    borderRadius: 13,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#18181b',
  },
  imageThumbnail: {
    borderRadius: 13,
  },
  imageUploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.40)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  captionContainer: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
  },
  imageOverlayMetaPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageOverlayTimeText: {
    fontSize: 10,
    color: '#f5f5f5',
    fontWeight: '500',
  },
  imageOverlayEditedText: {
    fontSize: 9,
    color: '#d4d4d8',
    marginRight: 4,
  },
  heartPopContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  heartPopEmoji: {
    fontSize: 48,
    lineHeight: 56,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 210,
    maxWidth: 290,
    marginBottom: 4,
  },
  fileCardMe: {
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    borderColor: '#3f3f46',
  },
  fileCardOther: {
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    borderColor: '#2e2e32',
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  fileInfo: {
    flex: 1,
    marginRight: 6,
    justifyContent: 'center',
  },
  fileNameText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: 16,
  },
  fileMetaSubtitle: {
    fontSize: 11,
    color: '#a1a1aa',
    marginTop: 2,
    fontWeight: '500',
  },
  fileActionIcon: {
    marginLeft: 4,
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  textContainer: {
    position: 'relative',
  },
  textWithInlineMetaWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bubbleTextMe: {
    fontSize: 14.5,
    lineHeight: 20,
    color: '#f5f5f5',
  },
  bubbleTextOther: {
    fontSize: 14.5,
    lineHeight: 20,
    color: '#e4e4e7',
  },
  urlLink: {
    textDecorationLine: 'underline',
  },
  invisibleMetaSpacer: {
    opacity: 0,
    fontSize: 10,
    lineHeight: 18,
  },
  inlineMetaBox: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  timestampText: {
    fontSize: 10,
    color: '#8e8e93',
  },
  editedLabel: {
    fontSize: 9.5,
    color: '#8e8e93',
  },
  reactionPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: -5,
    marginBottom: 2,
    zIndex: 2,
  },
  reactionPillsRight: {
    justifyContent: 'flex-end',
    marginRight: 4,
  },
  reactionPillsLeft: {
    justifyContent: 'flex-start',
    marginLeft: 4,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222224',
    borderWidth: 1,
    borderColor: '#333336',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    minHeight: 28,
    minWidth: 32,
    overflow: 'visible',
  },
  reactionPillActive: {
    backgroundColor: '#2c2c30',
    borderColor: '#4b4b50',
  },
  reactionPillEmojiText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  reactionPillCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d4d4d8',
    marginLeft: 4,
    includeFontPadding: false,
  },
  mentionText: {
    fontWeight: '700',
  },
  mentionTextMe: {
    color: '#ffffff',
    textDecorationLine: 'underline',
  },
  mentionTextOther: {
    color: '#f4f4f5',
    textDecorationLine: 'underline',
  },
});
