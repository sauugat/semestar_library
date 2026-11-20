import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Dimensions,
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
import { Monochrome } from '@/constants/theme';
import { HeartBurstOverlay, SwipeableMessageWrapper } from './ChatGesturePrimitives';
import { ChatMessage, ChatReadReceipt } from '@/services/chat';
import { parseChatDate, formatFileSubtitle, formatFileExtension } from '@/services/chat-state';
import { formatMessageTime as safeFormatTime, formatChatDateSeparator as safeFormatSeparator } from '@/utils/date';

// Monochrome dark surface tokens aligned with colors.surfaceRaised (#2c2c2e) and colors.surfaceSubtle (#1c1c1e)
const imageDimensionsCache = new Map<string, { width: number; height: number }>();
const INITIAL_SCREEN_WIDTH = Dimensions.get('window').width;

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
  seenBySummary?: string | null;
  serverUrl: string;
  authToken?: string | null;
  downloadingFileId: string | null;
  isInitialLoadItem: boolean;
  isHighlighted: boolean;
  isDelivered?: boolean;
  isStarred?: boolean;
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
  onPressReadBy?: (item: ChatMessage) => void;
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

function extractFirstUrl(text?: string | null): { url: string; domain: string; path: string } | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<]+[^<.,:;"')\]\s]/i);
  if (!match || !match[0]) return null;
  try {
    const raw = match[0];
    const parsed = new URL(raw);
    const domain = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return { url: raw, domain, path };
  } catch {
    return null;
  }
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
                { color: isMe ? '#FFFFFF' : '#F5F5F5' },
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
  readByCount = 0,
  isDelivered,
  isEdited,
  isStarred,
  onRetry,
  onPressReadBy,
  overlay = false,
}: {
  status?: 'sent' | 'pending' | 'failed';
  isMe: boolean;
  timeString: string;
  isRead: boolean;
  readByCount?: number;
  isDelivered?: boolean;
  isEdited?: boolean;
  isStarred?: boolean;
  onRetry?: () => void;
  onPressReadBy?: () => void;
  overlay?: boolean;
}) {
  const isPending = status === 'pending';
  const isFailed = status === 'failed';
  const timeStyle = overlay
    ? styles.imageOverlayTimeText
    : isMe
    ? styles.timestampTextMe
    : styles.timestampTextOther;
  const editedStyle = overlay
    ? styles.imageOverlayEditedText
    : isMe
    ? styles.editedLabelMe
    : styles.editedLabelOther;
  const iconColor = overlay
    ? '#ffffff'
    : isMe
    ? (isRead ? Monochrome.bubbleOutgoingText : Monochrome.bubbleOutgoingMeta)
    : Monochrome.bubbleIncomingMeta;

  if (isFailed) {
    return (
      <TouchableOpacity
        onPress={onRetry}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Retry sending message"
      >
        <Text style={[timeStyle, { color: '#fca5a5' }]}>
          Tap to retry
        </Text>
        <Ionicons name="alert-circle" size={13} color="#fca5a5" style={{ marginLeft: 3 }} />
      </TouchableOpacity>
    );
  }

  // Ticks removed from inside bubbles; seen status is rendered as "Seen by ..." below the bubble.
  const hasVisibleMeta = Boolean(isStarred || isEdited || (isMe && isPending));
  if (!hasVisibleMeta) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {Boolean(isStarred) && (
        <Ionicons
          name="star"
          size={10}
          color={isMe ? '#F4F4F5' : '#A1A1AA'}
          style={{ marginRight: 3 }}
        />
      )}
      {Boolean(isEdited) && (
        <Text style={editedStyle}>
          Edited
        </Text>
      )}
      {isMe && isPending && (
        <Ionicons
          name="time-outline"
          size={11}
          color={iconColor}
          style={{ marginLeft: 3 }}
        />
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
  if (prev.item.chatGroupId !== next.item.chatGroupId) return false;
  if (prev.item.localUri !== next.item.localUri) return false;
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.downloadingFileId !== next.downloadingFileId) return false;
  if (prev.isDelivered !== next.isDelivered) return false;
  if (prev.isStarred !== next.isStarred) return false;
  if (prev.seenBySummary !== next.seenBySummary) return false;

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
  seenBySummary,
  serverUrl,
  authToken,
  downloadingFileId,
  isInitialLoadItem,
  isHighlighted,
  isDelivered: isDeliveredProp,
  isStarred,
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
  onPressReadBy,
}: ChatMessageItemProps) {
  const screenWidth = INITIAL_SCREEN_WIDTH;
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
  const remoteAttachmentUrl = useMemo(() => {
    if (!item.attachmentName) return null;
    const base = `${serverUrl.replace(/\/+$/, '')}/api/chat/attachment/${encodeURIComponent(item.attachmentName)}`;
    return item.chatGroupId ? `${base}?chatGroupId=${encodeURIComponent(item.chatGroupId)}` : base;
  }, [serverUrl, item.attachmentName, item.chatGroupId]);

  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [localUriFailed, setLocalUriFailed] = useState(false);

  // Authoritative remote source:
  // Transient localUri is only used for pending optimistic state; once sent or if local fails, remote is authoritative
  const effectiveImageUrl = useMemo(() => {
    if (item.status === 'pending' && item.localUri && !localUriFailed) {
      return item.localUri;
    }
    return remoteAttachmentUrl;
  }, [item.status, item.localUri, localUriFailed, remoteAttachmentUrl]);

  const timeString = formatMessageTime(item.createdAt);
  const initialChar = (item.name || 'S').trim().charAt(0).toUpperCase();

  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const avatarFullUrl = useMemo(() => {
    const base = (serverUrl || 'https://semestar-library.vercel.app').replace(/\/+$/, '');
    if (item.avatarUrl && typeof item.avatarUrl === 'string' && item.avatarUrl.trim()) {
      const trimmed = item.avatarUrl.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
        return trimmed;
      }
      return `${base}/${trimmed.replace(/^\/+/, '')}`;
    }
    if (item.studentId && String(item.studentId).trim()) {
      return `${base}/api/avatar/student/${encodeURIComponent(String(item.studentId).trim())}`;
    }
    return null;
  }, [item.avatarUrl, item.studentId, serverUrl]);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [avatarFullUrl]);

  // Image natural aspect ratio tracking & measurement
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(() => {
    if (!effectiveImageUrl) return null;
    return imageDimensionsCache.get(effectiveImageUrl) || null;
  });

  useEffect(() => {
    if (!isImg || !effectiveImageUrl) return;
    setImageState('loading');
    if (imageDimensionsCache.has(effectiveImageUrl)) {
      const cached = imageDimensionsCache.get(effectiveImageUrl)!;
      setImageDims(cached);
    } else {
      RNImage.getSize(
        effectiveImageUrl,
        (w, h) => {
          if (w > 0 && h > 0) {
            imageDimensionsCache.set(effectiveImageUrl, { width: w, height: h });
            setImageDims({ width: w, height: h });
          }
        },
        () => {
          if (item.localUri && !localUriFailed && remoteAttachmentUrl) {
            setLocalUriFailed(true);
          }
        }
      );
    }
  }, [isImg, effectiveImageUrl, retryKey]);

  const targetImageWidth = Math.min(Math.round(screenWidth * 0.74), 280);
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
  const readByCount = useMemo(() => {
    if (!isMe || item.id <= 0) return 0;
    return readReceipts.filter(
      (r) => String(r.studentId) !== String(currentUserId) && r.lastReadMessageId >= item.id
    ).length;
  }, [isMe, item.id, readReceipts, currentUserId]);
  const isRead = readByCount > 0;
  const isDelivered = isMe && (isDeliveredProp || isRead || (item.status === 'sent' && item.id > 0 && Boolean((item as any).delivered)));
  const linkPreview = useMemo(() => extractFirstUrl(item.text), [item.text]);

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

  // Gesture refs for single tap vs double tap coordination (zero idle SharedValues or native bridge calls)
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [heartBurstKey, setHeartBurstKey] = useState(0);
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  const triggerHeartReaction = () => {
    if (item.id <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setHeartBurstKey((k) => k + 1);
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
    if (imageState === 'error') return;
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
        if (effectiveImageUrl) {
          onOpenImage({
            uri: effectiveImageUrl,
            name: item.attachmentOriginalName || item.attachmentName || 'image.jpg',
          });
        }
      } else {
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null;
          if (effectiveImageUrl) {
            onOpenImage({
              uri: effectiveImageUrl,
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
    <View style={styles.rowWrapper}>
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

      {/* Message Row Container (only the bubble itself is swipeable for reply) */}
      <View style={styles.swipeRowWrapper}>
        <View
          style={[
            styles.bubbleRowAnimated,
            isMe ? styles.bubbleRowRight : styles.bubbleRowLeft,
            {
              marginTop: isConsecutive ? 3 : 12,
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
                      recyclingKey={avatarFullUrl}
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

          {/* Bubble Container with Reanimated v4 Rubber-Band Swipe-to-Reply + Detached Reply */}
          <SwipeableMessageWrapper
            isSelf={isMe}
            swipeDisabled={item.id <= 0}
            onSwipeReply={() => {
              if (item.id > 0) onSwipeReply(item);
            }}
            style={[
              { maxWidth: maxBubbleWidth },
              isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' },
            ]}
          >
            {/* Detached Reply Preview ABOVE the bubble (Instagram-style) */}
            {Boolean(item.replyToId) && (
              <View
                style={[
                  styles.detachedReplyWrap,
                  isMe ? styles.detachedReplyWrapMe : styles.detachedReplyWrapOther,
                ]}
              >
                <Text style={styles.detachedReplyLabel} numberOfLines={1}>
                  {isMe
                    ? item.replySender
                      ? `You replied to ${item.replySender.split(/\s+/)[0]}`
                      : 'You replied'
                    : item.replySender
                      ? `Replied to ${item.replySender.split(/\s+/)[0]}`
                      : 'Replied to you'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => onJumpToReply(item.replyToId!)}
                  style={[
                    styles.detachedReplyRow,
                    isMe ? styles.detachedReplyRowMe : styles.detachedReplyRowOther,
                  ]}
                >
                  {!isMe && <View style={styles.detachedReplyBar} />}
                  <View style={styles.detachedReplyPill}>
                    <Text style={styles.detachedReplyText} numberOfLines={2}>
                      {item.replyText || 'Attachment'}
                    </Text>
                  </View>
                  {isMe && <View style={styles.detachedReplyBar} />}
                </TouchableOpacity>
              </View>
            )}

            <Pressable
              onPress={handleBubblePress}
              onLongPress={handleLongPress}
              delayLongPress={280}
              accessibilityLabel={`Message from ${item.name || 'someone'}. Double tap to react with heart. Long press for actions.`}
              style={({ pressed }) => [
                styles.messageBubble,
                isMe ? styles.bubbleMe : styles.bubbleOther,
                isMe
                  ? {
                      borderTopRightRadius: isFirstInGroup || Boolean(item.replyToId) ? 22 : 6,
                      borderBottomRightRadius: isLastInGroup ? 22 : 6,
                      borderTopLeftRadius: 22,
                      borderBottomLeftRadius: 22,
                    }
                  : {
                      borderTopLeftRadius: isFirstInGroup || Boolean(item.replyToId) ? 22 : 6,
                      borderBottomLeftRadius: isLastInGroup ? 22 : 6,
                      borderTopRightRadius: 22,
                      borderBottomRightRadius: 22,
                    },
                isImageOnly && styles.imageBubbleTightPadding,
                isImg && { width: renderedImageDims.width + 6 },
                pressed ? { opacity: 0.9 } : undefined,
              ]}
            >
              {/* Highlight Overlay */}
              {isHighlighted && (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.highlightOverlay]}
                />
              )}

              {/* Lazy Heart Pop Animation (mounted only on double-tap) */}
              {heartBurstKey > 0 && (
                <HeartBurstOverlay
                  burstKey={heartBurstKey}
                  onDone={() => setHeartBurstKey(0)}
                />
              )}

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

              {/* Image Attachment */}
              {isImg && effectiveImageUrl && (
                <Pressable
                  onPress={handleImagePress}
                  onLongPress={handleLongPress}
                  delayLongPress={280}
                  accessibilityLabel="Open photo. Double tap for heart reaction. Long press for message actions."
                  style={[
                    styles.imageContainer,
                    imageState === 'error' && styles.imageErrorContainer,
                  ]}
                >
                  {imageState === 'loading' && (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        styles.imageSkeleton,
                        {
                          width: renderedImageDims.width,
                          height: renderedImageDims.height,
                        },
                      ]}
                    >
                      <ActivityIndicator size="small" color="#71717a" />
                    </View>
                  )}

                  {imageState === 'error' ? (
                    <View
                      style={[
                        styles.imageErrorCard,
                        { width: Math.min(renderedImageDims.width, 240) },
                      ]}
                    >
                      <Ionicons name="alert-circle-outline" size={26} color="#71717a" />
                      <Text style={styles.imageErrorText}>Couldn't load image</Text>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          setImageState('loading');
                          setLocalUriFailed(true);
                          setRetryKey((k) => k + 1);
                        }}
                        style={styles.imageRetryBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="refresh-outline" size={13} color="#e4e4e7" style={{ marginRight: 4 }} />
                        <Text style={styles.imageRetryText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Image
                      key={`${effectiveImageUrl}:${retryKey}`}
                      source={{
                        uri: effectiveImageUrl,
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
                        setImageState('loaded');
                        const { width, height } = e.source;
                        if (width && height && effectiveImageUrl && !imageDimensionsCache.has(effectiveImageUrl)) {
                          imageDimensionsCache.set(effectiveImageUrl, { width, height });
                          setImageDims({ width, height });
                        }
                      }}
                      onError={() => {
                        if (item.localUri && !localUriFailed && remoteAttachmentUrl) {
                          setLocalUriFailed(true);
                          setImageState('loading');
                        } else {
                          setImageState('error');
                        }
                      }}
                    />
                  )}

                  {/* Subtle translucent dark overlay while uploading */}
                  {item.status === 'pending' && imageState !== 'error' && (
                    <View style={styles.imageUploadingOverlay}>
                      <ActivityIndicator size="small" color="#ffffff" />
                    </View>
                  )}

                  {/* If image only: show overlay pill only for self status/failed or starred/edited */}
                  {isImageOnly && imageState !== 'error' && (isMe || isStarred || Boolean((item as any).isEdited) || item.status === 'failed') && (
                    <View style={styles.imageOverlayMetaPill}>
                      <MessageStatusMeta
                        status={item.status}
                        isMe={isMe}
                        timeString={timeString}
                        isRead={isRead}
                        readByCount={readByCount}
                        isDelivered={isDelivered}
                        isEdited={Boolean((item as any).isEdited)}
                        isStarred={isStarred}
                        onRetry={() => onRetry?.(item)}
                        onPressReadBy={onPressReadBy ? () => onPressReadBy(item) : undefined}
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

                    {/* Invisible spacer only when failed/pending/edited/star meta is shown */}
                    {((isMe && item.status === 'pending') || Boolean((item as any).isEdited) || Boolean(isStarred) || item.status === 'failed') && (
                      <Text style={styles.invisibleMetaSpacer} pointerEvents="none">
                        {item.status === 'failed' ? '   Tap to retry' : ''}
                        {isMe && item.status === 'pending' ? '  ⏱' : ''}
                        {Boolean((item as any).isEdited) ? '  Edited' : ''}
                        {Boolean(isStarred) ? ' ★' : ''}
                      </Text>
                    )}
                  </View>

                  {/* Link Preview Card (Item 15) */}
                  {linkPreview && (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => Linking.openURL(linkPreview.url).catch(() => {})}
                      style={[
                        styles.linkPreviewCard,
                        isMe ? styles.linkPreviewCardMe : styles.linkPreviewCardOther,
                      ]}
                    >
                      <View style={styles.linkPreviewIconWrap}>
                        <Ionicons name="globe-outline" size={16} color="#E4E4E7" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.linkPreviewDomain} numberOfLines={1}>
                          {linkPreview.domain}
                        </Text>
                        <Text style={styles.linkPreviewUrl} numberOfLines={1}>
                          {linkPreview.url}
                        </Text>
                      </View>
                      <Ionicons name="open-outline" size={14} color="#A1A1AA" style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  )}

                  {/* Absolute inline metadata placed at bottom-right */}
                  <View style={styles.inlineMetaBox}>
                    <MessageStatusMeta
                      status={item.status}
                      isMe={isMe}
                      timeString={timeString}
                      isRead={isRead}
                      readByCount={readByCount}
                      isDelivered={isDelivered}
                      isEdited={Boolean((item as any).isEdited)}
                      isStarred={isStarred}
                      onRetry={() => onRetry?.(item)}
                      onPressReadBy={onPressReadBy ? () => onPressReadBy(item) : undefined}
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
                    readByCount={readByCount}
                    isDelivered={isDelivered}
                    isEdited={Boolean((item as any).isEdited)}
                    isStarred={isStarred}
                    onRetry={() => onRetry?.(item)}
                    onPressReadBy={onPressReadBy ? () => onPressReadBy(item) : undefined}
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
          </SwipeableMessageWrapper>
        </View>

        {/* Instagram-style "Seen by Sandesh, Saugat" underneath the latest seen outgoing message */}
        {isMe && Boolean(seenBySummary) && (
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={!onPressReadBy}
            onPress={() => onPressReadBy?.(item)}
            style={styles.seenByRow}
          >
            <Text style={styles.seenByText} numberOfLines={1}>
              {seenBySummary}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}, areMessagePropsEqual);

const styles = StyleSheet.create({
  rowWrapper: {
    width: '100%',
  },
  dateSeparatorRow: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dateSeparatorPill: {
    backgroundColor: 'rgba(18, 18, 22, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A1A1AA',
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
    backgroundColor: 'rgba(39, 39, 42, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  bubbleRowAnimated: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    // marginTop: isConsecutive ? 2 : 10
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  avatarInitial: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
  detachedReplyWrap: {
    marginBottom: 5,
    maxWidth: '100%',
  },
  detachedReplyWrapMe: {
    alignItems: 'flex-end',
  },
  detachedReplyWrapOther: {
    alignItems: 'flex-start',
  },
  detachedReplyLabel: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 4,
    paddingHorizontal: 2,
    fontWeight: '500',
  },
  detachedReplyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  detachedReplyRowMe: {
    justifyContent: 'flex-end',
  },
  detachedReplyRowOther: {
    justifyContent: 'flex-start',
  },
  detachedReplyBar: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 28,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
  },
  detachedReplyPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.13)',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  detachedReplyText: {
    fontSize: 13.5,
    color: 'rgba(255, 255, 255, 0.72)',
    lineHeight: 18,
  },
  seenByRow: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginRight: 4,
    marginBottom: 2,
  },
  seenByText: {
    fontSize: 11.5,
    color: '#A1A1AA',
    fontWeight: '500',
  },
  messageBubble: {
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  bubbleMe: {
    backgroundColor: '#606064',
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  bubbleOther: {
    backgroundColor: 'rgba(12, 12, 14, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  imageBubbleTightPadding: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: 'transparent',
  },
  highlightOverlay: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 18,
  },
  senderNameText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#A1A1A1',
    marginBottom: 4,
  },
  replyQuoteBlock: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  replyQuoteMe: {
    backgroundColor: 'rgba(0, 0, 0, 0.20)',
    borderLeftColor: '#FFFFFF',
  },
  replyQuoteOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderLeftColor: '#737373',
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
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#18181b',
  },
  imageThumbnail: {
    borderRadius: 16,
  },
  imageSkeleton: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageErrorContainer: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  imageErrorCard: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageErrorText: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 6,
    marginBottom: 8,
    fontWeight: '500',
  },
  imageRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
  },
  imageRetryText: {
    fontSize: 11.5,
    color: '#e4e4e7',
    fontWeight: '600',
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
    borderRadius: 16,
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
    color: '#FFFFFF',
  },
  bubbleTextOther: {
    fontSize: 14.5,
    lineHeight: 20,
    color: '#FFFFFF',
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
  timestampTextMe: {
    fontSize: 10,
    color: '#D4D4D4',
  },
  timestampTextOther: {
    fontSize: 10,
    color: '#737373',
  },
  editedLabelMe: {
    fontSize: 9.5,
    color: '#D4D4D4',
  },
  editedLabelOther: {
    fontSize: 9.5,
    color: '#737373',
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
    backgroundColor: '#1C1C1C',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#282828',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minHeight: 24,
    minWidth: 28,
    overflow: 'visible',
  },
  reactionPillActive: {
    backgroundColor: '#242424',
    borderColor: '#383838',
  },
  reactionPillEmojiText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  reactionPillCountText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#A1A1A1',
    marginLeft: 3,
    includeFontPadding: false,
  },
  mentionText: {
    fontWeight: '700',
  },
  mentionTextMe: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
  },
  mentionTextOther: {
    color: '#F5F5F5',
    textDecorationLine: 'underline',
  },
  linkPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkPreviewCardMe: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  linkPreviewCardOther: {
    backgroundColor: '#1E1E22',
    borderColor: '#2E2E32',
  },
  linkPreviewIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  linkPreviewDomain: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F4F4F5',
  },
  linkPreviewUrl: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 1,
  },
});
