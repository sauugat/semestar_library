import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Pressable,
  Keyboard,
  StatusBar,
  AppState,
  BackHandler,
  ScrollView,
  Platform,
  Text as RNText,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/constants/useTheme';
import { Monochrome } from '@/constants/theme';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_SERVER_URL } from '@/services/api';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
import { ChatConversationSkeleton } from '@/components/chat/ChatSkeletons';
import { TypingIndicatorBubble } from '@/components/chat/TypingIndicatorBubble';
import { FullScreenImageViewer } from '@/components/FullScreenImageViewer';
import { FullScreenFilePreview } from '@/components/FullScreenFilePreview';
import type { LibraryFile } from '@/services/library';
import { prepareChatAttachment, removeOutboxFile } from '@/services/chat-attachments';
import { safeChatFilename, formatFileExtension } from '@/services/chat-state';
import { ThemeGlassSheet } from '@/components/chat/ThemeGlassSheet';
import {
  DM_CHAT_THEMES,
  getDmThemeById,
  getDmThemeSync,
  loadDmTheme,
  saveDmTheme,
  type DmThemeId,
} from '@/constants/dmThemes';
import {
  getDmThreadMemoryCache,
  getInboxMemoryCache,
  setDmThreadMemoryCache,
} from '@/services/chat-memory-cache';
import { isDmThreadCacheFresh } from '@/services/chat-query-cache';
import {
  FluidChatBackground,
  useChatBackSwipeResponder,
} from '@/components/chat/FluidChatBackground';
import {
  HeartBurstOverlay,
  SwipeableMessageWrapper,
  useDoubleTapHeart,
} from '@/components/chat/ChatGesturePrimitives';
import {
  fetchDmMessages,
  sendDmMessage,
  editDmMessage,
  deleteDmMessage,
  clearDmConversation,
  markDmConversationRead,
  sendDmTyping,
  blockDmUser,
  unblockDmUser,
  muteDmConversation,
  reportDm,
  fetchDmConversations,
  type DmMessage,
  type DmConversationItem,
} from '@/services/dm';
import {
  getCachedDmMessages,
  getCachedDmMessagesSync,
  saveCachedDmMessages,
  updateCachedDmMessage,
  deleteCachedDmMessage,
  getCachedDmConversations,
  updateCachedDmConversationMute,
} from '@/services/dm-db';
import { mergeDmMessages, failDmMessage, createReadCoalescer, getConversationReadCoalescer } from '@/services/dm-state';
import { readDmOutbox, updateDmOutbox, dmOutboxGeneration } from '@/services/dm-outbox';
import { subscribeDmConversationRealtime } from '@/services/dm-realtime';
import { setActiveDmConversation, clearAppBadge } from '@/services/notifications';

const dmDraftCache = new Map<string, string>();
const DM_QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'];

function isDmImageAttachment(filename?: string | null, mimeType?: string | null): boolean {
  const m = String(mimeType || '').toLowerCase();
  if (m.startsWith('image/') || m === 'image') return true;
  if (!filename) return false;
  return /\.(png|jpe?g|webp|gif|heic|heif|bmp|svg|avif)$/i.test(filename);
}

function getDmFileIcon(filename?: string | null, mimeType?: string | null): keyof typeof Ionicons.glyphMap {
  const ext = formatFileExtension(filename, mimeType).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'document-text-outline';
    case 'doc':
    case 'docx':
    case 'txt':
    case 'rtf':
    case 'md':
      return 'document-outline';
    case 'ppt':
    case 'pptx':
      return 'easel-outline';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'grid-outline';
    case 'zip':
    case 'rar':
    case '7z':
      return 'archive-outline';
    default:
      return 'attach-outline';
  }
}

function extractFirstDmUrl(text?: string | null): { url: string; domain: string } | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<]+[^<.,:;"')\]\s]/i);
  if (!match || !match[0]) return null;
  try {
    const raw = match[0];
    const parsed = new URL(raw);
    return { url: raw, domain: parsed.hostname.replace(/^www\./i, '') };
  } catch {
    return null;
  }
}

function getEmojiOnlyCount(text?: string | null): number {
  if (!text) return 0;
  const compact = text.trim().replace(/\s+/g, '');
  if (!compact || /[A-Za-z0-9]/.test(compact)) return 0;
  try {
    const emojiSeqRegex =
      /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
    const matches = compact.match(emojiSeqRegex);
    if (!matches || matches.length === 0 || matches.length > 6) return 0;
    return matches.join('') === compact ? matches.length : 0;
  } catch {
    return 0;
  }
}

function renderDmTextWithLinks(text: string, isSelf: boolean, baseStyle: any) {
  const regex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;
  const tokens: { type: 'text' | 'url'; value: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.substring(lastIndex, match.index) });
    }
    tokens.push({ type: 'url', value: match[1] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.substring(lastIndex) });
  }
  if (tokens.length <= 1 && tokens[0]?.type === 'text') {
    return <Text variant="sm" style={baseStyle}>{text}</Text>;
  }
  return (
    <Text variant="sm" style={baseStyle}>
      {tokens.map((t, idx) =>
        t.type === 'url' ? (
          <Text
            key={idx}
            variant="sm"
            style={[baseStyle, { textDecorationLine: 'underline', fontWeight: '600' }]}
            onPress={() => Linking.openURL(t.value).catch(() => {})}
          >
            {t.value}
          </Text>
        ) : (
          <Text key={idx} variant="sm" style={baseStyle}>{t.value}</Text>
        )
      )}
    </Text>
  );
}

function createDmClientId() {
  return `dm_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function resolveDmAvatarUri(rawUrl?: string | null, serverUrl?: string, peerId?: string | null): string | null {
  const base = (serverUrl || DEFAULT_SERVER_URL || '').replace(/\/+$/, '');
  if (rawUrl && typeof rawUrl === 'string') {
    const trimmed = rawUrl.trim();
    if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') {
      if (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('file://') ||
        trimmed.startsWith('data:')
      ) {
        return trimmed;
      }
      if (base) {
        return `${base}/${trimmed.replace(/^\/+/, '')}`;
      }
    }
  }
  if (peerId && typeof peerId === 'string' && peerId.trim() && base) {
    return `${base}/api/avatar/student/${encodeURIComponent(peerId.trim())}`;
  }
  return null;
}

function formatBubbleTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateSeparator(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function isSameDay(iso1?: string | null, iso2?: string | null): boolean {
  if (!iso1 || !iso2) return false;
  const d1 = new Date(iso1);
  const d2 = new Date(iso2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

const dmHeartStyles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  ring: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#FF2D55',
  },
  emoji: {
    fontSize: 42,
    lineHeight: 50,
    textAlign: 'center',
    textShadowColor: 'rgba(255, 45, 85, 0.5)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
});

const DmInteractiveBubble = React.memo(function DmInteractiveBubble({
  isSelf,
  disabled,
  onSwipeReply,
  onDoubleTapReact,
  onLongPress,
  bubbleStyle,
  headerContent,
  children,
}: {
  isSelf: boolean;
  disabled?: boolean;
  onSwipeReply: () => void;
  onDoubleTapReact: () => void;
  onLongPress: () => void;
  bubbleStyle: StyleProp<ViewStyle>;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { handlePress, burstKey, clearBurst } = useDoubleTapHeart(onDoubleTapReact);

  return (
    <SwipeableMessageWrapper
      isSelf={isSelf}
      swipeDisabled={disabled}
      onSwipeReply={onSwipeReply}
      style={{ maxWidth: '76%' }}
    >
      <View style={isSelf ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }}>
        {headerContent}
        <View style={{ maxWidth: '100%' }}>
          <Pressable
            onPress={() => {
              if (!disabled) handlePress();
            }}
            onLongPress={onLongPress}
            delayLongPress={250}
            style={({ pressed }) => [
              bubbleStyle,
              pressed && !disabled ? { opacity: 0.9 } : undefined,
            ]}
          >
            {children}
            {burstKey > 0 && <HeartBurstOverlay burstKey={burstKey} onDone={clearBurst} />}
          </Pressable>
        </View>
      </View>
    </SwipeableMessageWrapper>
  );
});

export default function DmConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  return <DmConversation key={`${user?.studentId || ''}:${id}`} />;
}

function DmConversation() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, serverUrl, token } = useAuth();
  const currentUserId = user?.studentId || '';
  const imageHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  const params = useLocalSearchParams<{
    id: string;
    peerName?: string;
    peerRole?: string;
    peerAvatar?: string;
    peerAvatarUrl?: string;
    peerId?: string;
    targetMessageId?: string;
  }>();

  const conversationId = params.id;
  const activeRef = useRef(false);
  const nearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [topHeaderHeight, setTopHeaderHeight] = useState(() => Math.max(insets.top, 10) + 56);
  const [composerHeight, setComposerHeight] = useState(() => 64 + Math.max(insets.bottom, 10));
  const messagesRef = useRef<DmMessage[]>([]);
  const loadInFlight = useRef(false);
  const sendsInFlight = useRef(new Set<string>());
  const acknowledgedSends = useRef(new Set<string>());
  const readQueueRef = useRef<ReturnType<typeof createReadCoalescer> | null>(null);
  const markIncomingRead = useCallback((items: DmMessage[]) => {
    if (!activeRef.current || !nearBottomRef.current || AppState.currentState !== 'active') return;
    const incomingItems = items.filter(m => m.senderId !== currentUserId && typeof m.id === 'number' && Number.isSafeInteger(m.id) && m.id > 0);
    if (incomingItems.length === 0) return;
    const newest = Math.max(0, ...incomingItems.map(m => Number(m.id)));
    if (newest > 0) {
      readQueueRef.current?.request(newest);
    }
  }, [currentUserId]);

  // Synchronous in-memory hydration from inbox + thread caches (zero-latency frame-0 render)
  const initialInboxConv = useMemo(
    () => getInboxMemoryCache(currentUserId)?.dmConversations.find((c) => c.id === conversationId) || null,
    [currentUserId, conversationId]
  );

  // Participant info state
  const [peerInfo, setPeerInfo] = useState<{
    id: string;
    name: string;
    role: string;
    username?: string | null;
    avatarUrl?: string | null;
  }>(() => ({
    id: params.peerId || initialInboxConv?.participant?.studentId || '',
    name: params.peerName || initialInboxConv?.participant?.name || 'Conversation',
    role: params.peerRole || initialInboxConv?.participant?.role || 'Student',
    username: initialInboxConv?.participant?.username || null,
    avatarUrl: params.peerAvatar || params.peerAvatarUrl || initialInboxConv?.participant?.avatarUrl || null,
  }));

  const [headerAvatarFailed, setHeaderAvatarFailed] = useState(false);
  const [bubbleAvatarFailed, setBubbleAvatarFailed] = useState(false);
  const resolvedPeerAvatarUri = useMemo(
    () => resolveDmAvatarUri(peerInfo.avatarUrl, serverUrl, peerInfo.id),
    [peerInfo.avatarUrl, serverUrl, peerInfo.id]
  );
  useEffect(() => {
    setHeaderAvatarFailed(false);
    setBubbleAvatarFailed(false);
  }, [resolvedPeerAvatarUri]);

  // Synchronous in-memory hydration from thread cache OR dm-db memory map
  const initialThreadMem = useMemo(
    () => getDmThreadMemoryCache(currentUserId, conversationId),
    [currentUserId, conversationId]
  );
  const initialMessages = useMemo(() => {
    if (initialThreadMem && initialThreadMem.messages.length > 0) {
      return initialThreadMem.messages;
    }
    return getCachedDmMessagesSync(currentUserId, conversationId, 50);
  }, [initialThreadMem, currentUserId, conversationId]);
  const [conversation, setConversation] = useState<DmConversationItem | null>(() => initialInboxConv);
  const [messages, setMessages] = useState<DmMessage[]>(() => initialMessages);
  useEffect(() => {
    messagesRef.current = messages;
    if (currentUserId && conversationId && messages.length > 0) {
      setDmThreadMemoryCache(currentUserId, conversationId, { messages });
    }
  }, [messages, currentUserId, conversationId]);
  const [loading, setLoading] = useState(() => initialMessages.length === 0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Realtime & typing states
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingTypingThrottlerRef = useRef<number>(0);
  const [peerLastReadId, setPeerLastReadId] = useState<number>(() => initialThreadMem?.peerLastReadMessageId || 0);
  const [peerInfoModalVisible, setPeerInfoModalVisible] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [dmThemeId, setDmThemeId] = useState<DmThemeId>(() => getDmThemeSync(currentUserId, conversationId));
  const activeDmTheme = useMemo(() => getDmThemeById(dmThemeId), [dmThemeId]);
  useEffect(() => {
    let cancelled = false;
    void loadDmTheme(currentUserId, conversationId).then((loaded) => {
      if (!cancelled) setDmThemeId(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, conversationId]);
  const handleSelectDmTheme = useCallback(
    (nextId: DmThemeId) => {
      Haptics.selectionAsync().catch(() => {});
      setDmThemeId(nextId);
      void saveDmTheme(currentUserId, conversationId, nextId);
    },
    [currentUserId, conversationId]
  );
  useEffect(() => {
    if (currentUserId && conversationId && peerLastReadId > 0) {
      setDmThreadMemoryCache(currentUserId, conversationId, { peerLastReadMessageId: peerLastReadId });
    }
  }, [peerLastReadId, currentUserId, conversationId]);

  // Composer states with per-conversation draft persistence (Item 50)
  const draftKey = `${currentUserId}:${conversationId}`;
  const [inputText, setInputText] = useState(() => dmDraftCache.get(draftKey) || '');
  const [replyingTo, setReplyingTo] = useState<DmMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<{
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
    isImage?: boolean;
  } | null>(null);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [viewerImage, setViewerImage] = useState<{ uri: string; name: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    file: LibraryFile;
    localUri: string;
    mimeType?: string | null;
    fileUrl: string;
  } | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const isPickerLaunchingRef = useRef(false);

  // In-chat Search, Starred Messages, Reactions, and Shared Links (Items 12, 14, 30, 86, 100)
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [starredIds, setStarredIds] = useState<Set<number | string>>(new Set());
  const [localReactions, setLocalReactions] = useState<Record<string, string[]>>({});
  const [subPanel, setSubPanel] = useState<'starred' | 'links' | null>(null);

  // Modals & Action Sheets
  const [selectedActionMessage, setSelectedActionMessage] = useState<DmMessage | null>(null);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportReason, setReportReason] = useState('HARASSMENT');
  const [reportDescription, setReportDescription] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const flatListRef = useRef<FlatList<DmMessage>>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | string | null>(null);

  const handleJumpToReply = useCallback((replyId: number | string) => {
    const idx = messages.findIndex((m) => m.id === replyId || m.clientId === replyId);
    if (idx >= 0 && flatListRef.current) {
      flatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      setHighlightedMessageId(replyId);
      setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1400);
    }
  }, [messages]);

  useEffect(() => {
    if (params.targetMessageId && messages.length > 0) {
      const target = Number(params.targetMessageId) || params.targetMessageId;
      handleJumpToReply(target);
    }
  }, [params.targetMessageId, messages.length, handleJumpToReply]);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chat');
    }
  }, [router]);

  // Bubble-safe background swipe-to-exit: swiping on empty chat space triggers native Stack back
  // (shows real Inbox underneath with zero black); touching a bubble strictly triggers Reply.
  const backSwipeHandlers = useChatBackSwipeResponder(handleBack, true);

  // Android hardware back press handler
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        // 1. Modals have top priority
        if (previewFile) {
          setPreviewFile(null);
          return true;
        }
        if (viewerImage) {
          setViewerImage(null);
          return true;
        }
        if (showAttachModal) {
          setShowAttachModal(false);
          return true;
        }
        if (reportModalVisible) {
          setReportModalVisible(false);
          return true;
        }
        if (settingsModalVisible) {
          setSettingsModalVisible(false);
          return true;
        }
        if (selectedActionMessage) {
          setSelectedActionMessage(null);
          return true;
        }

        // 2. Allow native Android keyboard dismissal if open
        if (Keyboard.isVisible()) {
          return false;
        }

        // 3. Navigate back to inbox
        handleBack();
        return true;
      };

      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [previewFile, viewerImage, showAttachModal, reportModalVisible, settingsModalVisible, selectedActionMessage, handleBack])
  );

  // 1. Identify peer information from in-memory inbox cache first; skip redundant 50-conv network call when warm
  useEffect(() => {
    let isMounted = true;
    const memMatch = getInboxMemoryCache(currentUserId)?.dmConversations.find((c) => c.id === conversationId);
    if (memMatch) {
      if (typeof memMatch.lastReadMessageId === 'number' && memMatch.lastReadMessageId > 0) {
        readQueueRef.current?.setAcknowledged(memMatch.lastReadMessageId);
      }
      return;
    }

    const deferTimer = setTimeout(() => {
      if (!isMounted) return;
      void (async () => {
        try {
          const cachedConvs = await getCachedDmConversations(currentUserId);
          const match = cachedConvs.find((c) => c.id === conversationId);
          if (match && isMounted) {
            setConversation(match);
            if (typeof match.lastReadMessageId === 'number' && match.lastReadMessageId > 0) {
              readQueueRef.current?.setAcknowledged(match.lastReadMessageId);
            }
            if (match.participant) {
              setPeerInfo((prev) => ({
                id: match.participant.studentId || prev.id,
                name: match.participant.name || prev.name,
                role: match.participant.role || prev.role || 'Student',
                username: match.participant.username || prev.username || null,
                avatarUrl: match.participant.avatarUrl || prev.avatarUrl || null,
              }));
            }
            return;
          }
          // Only hit network if conversation metadata wasn't in memory or local SQLite
          const fresh = await fetchDmConversations(50);
          const found = fresh.find((c) => c.id === conversationId);
          if (found && isMounted) {
            setConversation(found);
            if (typeof found.lastReadMessageId === 'number' && found.lastReadMessageId > 0) {
              readQueueRef.current?.setAcknowledged(found.lastReadMessageId);
            }
            if (found.participant) {
              setPeerInfo((prev) => ({
                id: found.participant.studentId || prev.id,
                name: found.participant.name || prev.name,
                role: found.participant.role || prev.role || 'Student',
                username: found.participant.username || prev.username || null,
                avatarUrl: found.participant.avatarUrl || prev.avatarUrl || null,
              }));
            }
          }
        } catch {}
      })();
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(deferTimer);
    };
  }, [conversationId, currentUserId]);

  // Load once on focus, and refresh after reconnect/resume. Runs SQLite + outbox + network in parallel.
  const loadMessages = useCallback(async () => {
    if (!conversationId || !currentUserId || loadInFlight.current) return;
    loadInFlight.current = true;
    setError(null);
    try {
      // Kick off network fetch immediately in parallel with local SQLite & outbox reads
      const netPromise = fetchDmMessages(conversationId, { limit: 50 });
      const [cached, outbox] = await Promise.all([
        getCachedDmMessages(currentUserId, conversationId, 50),
        readDmOutbox(currentUserId, conversationId).catch(() => {
          if (activeRef.current) setError('Saved pending messages could not be loaded. Please reopen the conversation.');
          return [];
        }),
      ]);
      if (!activeRef.current) return;
      const restored = outbox.map(m => ({ ...m, status: sendsInFlight.current.has(m.clientId || '') ? 'pending' as const : 'failed' as const }));
      if (cached.length || restored.length) {
        setMessages(prev => mergeDmMessages(mergeDmMessages(cached, restored), prev));
        setLoading(false);
      }
      const res = await netPromise;
      if (!activeRef.current) return;
      if (typeof res.lastReadMessageId === 'number' && res.lastReadMessageId > 0) {
        readQueueRef.current?.setAcknowledged(res.lastReadMessageId);
      }
      setMessages(prev => mergeDmMessages(prev, res.messages));
      setHasMore(res.hasMore);
      setPeerLastReadId(prev => Math.max(prev, res.peerLastReadMessageId));
      void saveCachedDmMessages(currentUserId, conversationId, res.messages);
      for (const m of res.messages) if (m.senderId === currentUserId && m.clientId) {
        void updateDmOutbox(currentUserId, conversationId, m, dmOutboxGeneration()).catch(() => {});
      }
      markIncomingRead(res.messages);
    } catch (err: any) {
      if (activeRef.current) setError(err.message || 'Failed to load messages');
    } finally {
      loadInFlight.current = false;
      if (activeRef.current) setLoading(false);
    }
  }, [conversationId, currentUserId, markIncomingRead]);

  useEffect(() => {
    if (!conversationId) return;
    const coalescer = getConversationReadCoalescer(
      conversationId,
      (id) => (activeRef.current && AppState.currentState === 'active'
        ? markDmConversationRead(conversationId, id)
        : Promise.reject(new Error('Conversation is inactive')))
    );
    readQueueRef.current = coalescer;
    return () => {
      coalescer.stop();
    };
  }, [conversationId]);

  useFocusEffect(useCallback(() => {
    activeRef.current = true;
    setActiveDmConversation(conversationId || null);
    void clearAppBadge();
    readQueueRef.current?.start();
    // Skip redundant network fetch when React Query's persisted cache is fresh (< 60s);
    // otherwise defer sync until after the native push transition settles when warm.
    const isCacheFresh = isDmThreadCacheFresh(currentUserId, conversationId);
    const hasWarmMessages = messagesRef.current.length > 0;
    const syncTimer = isCacheFresh
      ? null
      : setTimeout(() => {
          if (activeRef.current) void loadMessages();
        }, hasWarmMessages ? 300 : 0);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setActiveDmConversation(conversationId || null);
        readQueueRef.current?.start();
        void loadMessages();
      } else {
        setActiveDmConversation(null);
        readQueueRef.current?.stop();
      }
    });
    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      activeRef.current = false;
      setActiveDmConversation(null);
      readQueueRef.current?.stop();
      sub.remove();
    };
  }, [conversationId, loadMessages]));

  // 3. Load older messages (cursor pagination)
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    const oldest = [...messages].reverse().find(m => typeof m.id === 'number');
    if (!oldest) return;
    if (typeof oldest.id !== 'number') return;

    setLoadingOlder(true);
    try {
      const res = await fetchDmMessages(conversationId, {
        before: oldest.id,
        limit: 40,
      });
      if (res.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const filtered = res.messages.filter((m) => !existingIds.has(m.id));
          const combined = mergeDmMessages(prev, filtered);
          void saveCachedDmMessages(currentUserId, conversationId, combined);
          return combined;
        });
      }
      setHasMore(res.hasMore);
      setPeerLastReadId(prev => Math.max(prev, res.peerLastReadMessageId));
    } catch (err) {
      console.warn('[DM] Load older messages error:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, currentUserId, hasMore, loadingOlder, messages]);

  // Realtime is active only while this conversation is focused.
  // Deferred 300ms so Supabase client initialization never hangs the native push animation.
  useFocusEffect(useCallback(() => {
    if (!conversationId || !currentUserId) return;
    let connectedNow = false;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const poll = setInterval(() => {
      if (!connectedNow && AppState.currentState === 'active') void loadMessages();
    }, 15000);
    const connectTimer = setTimeout(() => {
      if (cancelled) return;
      unsubscribe = subscribeDmConversationRealtime(conversationId, {
        onConnectionChange: connected => {
          connectedNow = connected;
          setRealtimeConnected(connected);
          if (connected) void loadMessages();
        },
        onNewMessage: (newMsg) => {
          if (newMsg.senderId === currentUserId && newMsg.clientId) acknowledgedSends.current.add(newMsg.clientId);
          setMessages(prev => mergeDmMessages(prev, [newMsg]));
          void saveCachedDmMessages(currentUserId, conversationId, [newMsg]);
          if (newMsg.senderId === currentUserId && newMsg.clientId) {
            void updateDmOutbox(currentUserId, conversationId, newMsg, dmOutboxGeneration()).catch(() => {});
          }
          markIncomingRead([newMsg]);
        },

        onEditedMessage: ({ messageId, text, editedAt }) => {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === messageId
                ? { ...m, text, isEdited: true, editedAt }
                : m
            );
            void saveCachedDmMessages(currentUserId, conversationId, updated);
            return updated;
          });
        },

        onDeletedMessage: ({ messageId }) => {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === messageId
                ? { ...m, text: null, deletedForAll: true }
                : m
            );
            void saveCachedDmMessages(currentUserId, conversationId, updated);
            return updated;
          });
        },

        onReadReceipt: ({ readerId, lastReadMessageId }) => {
          if (readerId !== currentUserId) {
            setPeerLastReadId((prev) => Math.max(prev, lastReadMessageId));
          } else if (typeof lastReadMessageId === 'number' && lastReadMessageId > 0) {
            readQueueRef.current?.setAcknowledged(lastReadMessageId);
          }
        },

        onTyping: ({ studentId, isTyping }) => {
          if (studentId !== currentUserId) {
            if (isTyping) {
              setPeerIsTyping(true);
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = setTimeout(() => {
                setPeerIsTyping(false);
              }, 4000);
            } else {
              setPeerIsTyping(false);
            }
          }
        },
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(connectTimer);
      clearInterval(poll);
      const unsub = unsubscribe;
      unsubscribe = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      // Defer socket & typing cleanup by one tick so interactive pop stays locked at 120fps
      setTimeout(() => {
        unsub?.();
        void sendDmTyping(conversationId, false);
      }, 0);
    };
  }, [conversationId, currentUserId, loadMessages, markIncomingRead]));

  // 5. Handling outgoing typing indicator (throttled to 2.5s) + Draft save (Item 50)
  const handleInputChange = (text: string) => {
    setInputText(text);
    if (!editingMessage) {
      if (text.trim()) dmDraftCache.set(draftKey, text);
      else dmDraftCache.delete(draftKey);
    }
    const now = Date.now();
    if (now - outgoingTypingThrottlerRef.current > 2500) {
      outgoingTypingThrottlerRef.current = now;
      void sendDmTyping(conversationId, true);
    }
  };

  // 5b. Take photo, pick image, or pick document (resized/compressed safely for upload)
  const handleTakePhoto = async () => {
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setShowAttachModal(false);
        Alert.alert('Permission Required', 'Camera access is needed to capture photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      setShowAttachModal(false);
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const attachment = await prepareChatAttachment(result.assets[0], true);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      Alert.alert('Camera Error', err?.message || 'Unable to open camera.');
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  const handlePickImage = async () => {
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      setShowAttachModal(false);
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const attachment = await prepareChatAttachment(result.assets[0], true);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      Alert.alert('Image Error', err?.message || 'Unable to open photo library.');
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  const handlePickDocument = async () => {
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      setShowAttachModal(false);
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const attachment = await prepareChatAttachment(res.assets[0], false);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      Alert.alert('File Error', err?.message || 'Unable to pick file.');
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  // 5c. Download & open DM file attachment in-app
  const handleOpenDmFile = useCallback(async (msg: DmMessage) => {
    if (!msg.attachmentName) return;
    const filename = msg.attachmentName;
    const originalName = msg.attachmentOriginalName || filename;
    const base = (serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    const fileUrl = `${base}/api/dm/attachments/${encodeURIComponent(filename)}`;

    try {
      setDownloadingFileId(String(msg.id));
      let localUri = msg.localUri || '';
      let fileSize = 0;

      if (localUri) {
        const localInfo = await FileSystem.getInfoAsync(localUri).catch(() => ({ exists: false } as any));
        if (!localInfo.exists) localUri = '';
        else if (typeof localInfo.size === 'number') fileSize = localInfo.size;
      }

      if (!localUri) {
        const targetDir = FileSystem.cacheDirectory || '';
        if (!targetDir) throw new Error('File storage is unavailable.');
        const cachedUri = `${targetDir}dm-${conversationId}-${msg.id}-${safeChatFilename(originalName)}`;
        const cachedInfo = await FileSystem.getInfoAsync(cachedUri).catch(() => ({ exists: false } as any));
        if (cachedInfo.exists) {
          localUri = cachedUri;
          if (typeof cachedInfo.size === 'number') fileSize = cachedInfo.size;
        } else {
          const downloadHeaders: Record<string, string> = {};
          if (token) downloadHeaders['Authorization'] = `Bearer ${token}`;
          const res = await FileSystem.downloadAsync(fileUrl, cachedUri, { headers: downloadHeaders });
          if (res.status !== 200) {
            throw new Error(`Could not load file (status ${res.status}).`);
          }
          localUri = res.uri;
          const dlInfo = await FileSystem.getInfoAsync(localUri).catch(() => ({ exists: false } as any));
          if (dlInfo.exists && typeof dlInfo.size === 'number') fileSize = dlInfo.size;
        }
      }

      setPreviewFile({
        file: {
          id: 0,
          title: originalName,
          originalName,
          filename,
          subject: '',
          semester: 0,
          uploadedBy: msg.senderName || peerInfo.name || '',
          uploadDate: msg.createdAt,
          sizeBytes: fileSize,
          mimeType: msg.attachmentMimeType || undefined,
        } as unknown as LibraryFile,
        localUri,
        mimeType: msg.attachmentMimeType || undefined,
        fileUrl,
      });
    } catch (err: any) {
      Alert.alert('Open File Error', err?.message || 'Failed to open file.');
    } finally {
      setDownloadingFileId(null);
    }
  }, [serverUrl, conversationId, token, peerInfo.name]);

  // 6. Sending a message (optimistic reconciliation, supports text, images & file attachments)
  const handleSend = async () => {
    const text = inputText.trim();
    const attachmentToSend = selectedAttachment;
    if ((!text && !attachmentToSend) || text.length > 2000 || sending) return;

    // Check if in edit mode
    if (editingMessage) {
      if (!text) return;
      const msgId = typeof editingMessage.id === 'number' ? editingMessage.id : parseInt(String(editingMessage.id), 10);
      if (isNaN(msgId)) return;
      setSending(true);
      try {
        const updated = await editDmMessage(conversationId, msgId, text);
        const mergedEdit: DmMessage = {
          ...editingMessage,
          ...updated,
          id: msgId,
          senderId: editingMessage.senderId || currentUserId,
          text: updated.text ?? text,
          isEdited: true,
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? mergedEdit : m))
        );
        void updateCachedDmMessage(currentUserId, conversationId, mergedEdit);
        setEditingMessage(null);
        setInputText('');
      } catch (err: any) {
        Alert.alert('Edit Failed', err.message || 'Could not edit message');
      } finally {
        setSending(false);
      }
      return;
    }

    // Normal Send: Generate optimistic clientId
    const clientId = createDmClientId();
    const isPendingImg = attachmentToSend ? Boolean(attachmentToSend.isImage) : false;
    const tempMessage: DmMessage = {
      id: clientId,
      conversationId,
      senderId: currentUserId,
      clientId,
      text: text || null,
      attachmentName: attachmentToSend ? (isPendingImg ? 'pending_image.jpg' : 'pending_file') : null,
      attachmentOriginalName: attachmentToSend ? attachmentToSend.name : null,
      attachmentMimeType: attachmentToSend ? attachmentToSend.mimeType : null,
      localUri: attachmentToSend ? attachmentToSend.uri : null,
      createdAt: new Date().toISOString(),
      status: 'pending',
      replyTo: replyingTo
        ? {
            id: typeof replyingTo.id === 'number' ? replyingTo.id : 0,
            text: replyingTo.text || (replyingTo.attachmentName ? (isDmImageAttachment(replyingTo.attachmentOriginalName || replyingTo.attachmentName, replyingTo.attachmentMimeType) ? '📷 Photo' : `📎 ${replyingTo.attachmentOriginalName || 'File'}`) : null),
            senderId: replyingTo.senderId,
            senderName: replyingTo.senderId === currentUserId ? 'You' : peerInfo.name,
          }
        : null,
    };

    // Optimistically insert to list
    setMessages((prev) => [tempMessage, ...prev]);
    setInputText('');
    setSelectedAttachment(null);
    dmDraftCache.delete(draftKey);
    setReplyingTo(null);
    requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));

    void transmitMessage(tempMessage, attachmentToSend);
  };

  // Persist before dispatch. Retries reuse the exact client ID and original content.
  const transmitMessage = async (
    message: DmMessage,
    fileOverride?: { uri: string; name: string; mimeType: string } | null
  ) => {
    const clientId = message.clientId;
    const fileToSend = fileOverride || (message.localUri
      ? {
          uri: message.localUri,
          name: message.attachmentOriginalName || 'attachment',
          mimeType: message.attachmentMimeType || 'application/octet-stream',
        }
      : null);
    if (!clientId || (!message.text && !fileToSend) || sendsInFlight.current.has(clientId)) return;
    sendsInFlight.current.add(clientId);
    const generation = dmOutboxGeneration();
    const pending = { ...message, status: 'pending' as const };
    setMessages(prev => mergeDmMessages(prev, [pending]));
    try {
      await updateDmOutbox(currentUserId, conversationId, pending, generation);
      if (generation !== dmOutboxGeneration()) return;
      const confirmed = await sendDmMessage(conversationId, {
        clientId,
        text: message.text,
        replyToId: message.replyTo?.id || null,
        file: fileToSend,
      });
      if (generation !== dmOutboxGeneration()) return;
      acknowledgedSends.current.add(clientId);
      if (activeRef.current) setMessages(prev => mergeDmMessages(prev, [confirmed]));
      void saveCachedDmMessages(currentUserId, conversationId, [confirmed]);
      await updateDmOutbox(currentUserId, conversationId, confirmed, generation);
      if (fileToSend?.uri) void removeOutboxFile(fileToSend.uri);
    } catch (err: any) {
      if (generation !== dmOutboxGeneration()) return;
      const acknowledged = acknowledgedSends.current.has(clientId) || messagesRef.current.some(m => m.clientId === clientId && typeof m.id === 'number');
      if (!acknowledged) {
        if (activeRef.current) setMessages(prev => failDmMessage(prev, clientId));
        await updateDmOutbox(currentUserId, conversationId, { ...message, status: 'failed' }, generation).catch(() => {});
        if (fileToSend && activeRef.current) {
          Alert.alert('Upload Failed', err?.message || 'Could not upload attachment. Tap Retry to try again.');
        }
      }
    } finally {
      sendsInFlight.current.delete(clientId);
    }
  };

  const handleRetry = (message: DmMessage) => transmitMessage(message);

  // 8. Message actions: React, Copy, Reply, Forward, Star, Edit, Delete for me, Delete for everyone, Report
  const handleOpenActionSheet = (msg: DmMessage) => {
    if (typeof msg.id !== 'number') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedActionMessage(msg);
  };

  const handleToggleDmReaction = (msg: DmMessage, emoji: string) => {
    const key = String(msg.id);
    Haptics.selectionAsync().catch(() => {});
    setLocalReactions((prev) => {
      const existing = prev[key] || [];
      const next = existing.includes(emoji)
        ? existing.filter((e) => e !== emoji)
        : [...existing, emoji];
      return { ...prev, [key]: next };
    });
    setSelectedActionMessage(null);
  };

  const handleToggleStarMessage = () => {
    if (!selectedActionMessage) return;
    const id = selectedActionMessage.id;
    Haptics.selectionAsync().catch(() => {});
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedActionMessage(null);
  };

  const handleForwardMessage = () => {
    if (!selectedActionMessage?.text) return;
    const text = selectedActionMessage.text;
    setSelectedActionMessage(null);
    void Clipboard.setStringAsync(`↪ Forwarded:\n${text}`);
    Alert.alert(
      'Forward Message',
      'Choose a recipient to forward this message to (also copied to clipboard):',
      [
        { text: 'Select Recipient', onPress: () => router.push('/dm/new') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleCopyMessage = async () => {
    if (selectedActionMessage?.text) {
      await Clipboard.setStringAsync(selectedActionMessage.text);
    }
    setSelectedActionMessage(null);
  };

  const handleStartReply = () => {
    if (selectedActionMessage) {
      setReplyingTo(selectedActionMessage);
      setEditingMessage(null);
    }
    setSelectedActionMessage(null);
  };

  const handleStartEdit = () => {
    if (selectedActionMessage && selectedActionMessage.text) {
      setEditingMessage(selectedActionMessage);
      setInputText(selectedActionMessage.text);
      setReplyingTo(null);
    }
    setSelectedActionMessage(null);
  };

  const handleDeleteForMe = async () => {
    if (!selectedActionMessage) return;
    const msg = selectedActionMessage;
    setSelectedActionMessage(null);

    const msgId = typeof msg.id === 'number' ? msg.id : parseInt(String(msg.id), 10);
    if (isNaN(msgId)) return;

    try {
      await deleteDmMessage(conversationId, msgId, 'for_me');
      setMessages((prev) => {
        const updated = prev.filter((m) => m.id !== msg.id);
        void deleteCachedDmMessage(currentUserId, conversationId, msgId);
        return updated;
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not delete message');
    }
  };

  const handleDeleteForEveryone = () => {
    if (!selectedActionMessage) return;
    const msg = selectedActionMessage;
    setSelectedActionMessage(null);

    Alert.alert(
      'Delete for Everyone?',
      'This message will be deleted for both participants.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const msgId = typeof msg.id === 'number' ? msg.id : parseInt(String(msg.id), 10);
            if (isNaN(msgId)) return;
            try {
              await deleteDmMessage(conversationId, msgId, 'for_everyone');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msgId ? { ...m, text: null, deletedForAll: true } : m
                )
              );
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not delete for everyone');
            }
          },
        },
      ]
    );
  };

  // 9. Conversation settings: Mute, Search, Starred, Links, Clear, Block/Unblock, Report
  const isMuted = Boolean(conversation?.isMuted);

  const handleToggleMute = async () => {
    setSettingsModalVisible(false);
    const nextMuted = !isMuted;
    try {
      await muteDmConversation(conversationId, nextMuted);
      setConversation((prev) => (prev ? { ...prev, isMuted: nextMuted } : prev));
      await updateCachedDmConversationMute(currentUserId, conversationId, nextMuted);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update mute settings.');
    }
  };

  const displayedMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!searchMode || !q) return messages;
    return messages.filter((m) => !m.deletedForAll && (m.text || '').toLowerCase().includes(q));
  }, [messages, searchMode, searchQuery]);

  const needsMessageCollections = subPanel !== null || peerInfoModalVisible || settingsModalVisible;
  const sharedLinks = useMemo(() => {
    if (!needsMessageCollections) return [];
    const list: { messageId: number | string; url: string; domain: string; createdAt: string }[] = [];
    for (const m of messages) {
      if (m.deletedForAll || !m.text) continue;
      const info = extractFirstDmUrl(m.text);
      if (info) {
        list.push({ messageId: m.id, url: info.url, domain: info.domain, createdAt: m.createdAt });
      }
    }
    return list;
  }, [messages, needsMessageCollections]);

  const starredMessages = useMemo(
    () => (needsMessageCollections ? messages.filter((m) => starredIds.has(m.id) && !m.deletedForAll) : []),
    [messages, starredIds, needsMessageCollections]
  );

  const handleClearConversation = () => {
    setSettingsModalVisible(false);
    Alert.alert(
      'Clear Conversation?',
      'All messages in this conversation will be cleared from your view. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearDmConversation(conversationId);
              setMessages([]);
              void saveCachedDmMessages(currentUserId, conversationId, []);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not clear conversation');
            }
          },
        },
      ]
    );
  };

  const handleToggleBlock = () => {
    setSettingsModalVisible(false);
    const isCurrentlyBlocked = Boolean(conversation?.blockedByMe);
    const targetUserId = peerInfo.id;
    if (!targetUserId) {
      Alert.alert('Error', 'Unable to resolve user identifier for blocking.');
      return;
    }

    if (isCurrentlyBlocked) {
      Alert.alert('Unblock User?', `Are you sure you want to unblock ${peerInfo.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockDmUser(targetUserId);
              setConversation((prev) =>
                prev ? { ...prev, blocked: false, blockedByMe: false } : null
              );
              Alert.alert('Unblocked', `${peerInfo.name} has been unblocked.`);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not unblock user');
            }
          },
        },
      ]);
    } else {
      Alert.alert(
        'Block User?',
        `Blocking will prevent ${peerInfo.name} from sending new messages to you. Past message history is preserved.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block User',
            style: 'destructive',
            onPress: async () => {
              try {
                await blockDmUser(targetUserId);
                setConversation((prev) =>
                  prev ? { ...prev, blocked: true, blockedByMe: true } : null
                );
                Alert.alert('Blocked', `${peerInfo.name} has been blocked.`);
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Could not block user');
              }
            },
          },
        ]
      );
    }
  };

  const handleOpenReportModal = () => {
    setSettingsModalVisible(false);
    setSelectedActionMessage(null);
    setReportReason('HARASSMENT');
    setReportDescription('');
    setReportModalVisible(true);
  };

  const handleSubmitReport = async () => {
    if (!peerInfo.id) return;
    setSubmittingReport(true);
    try {
      await reportDm({
        conversationId,
        reportedUserId: peerInfo.id,
        reportedMessageId: selectedActionMessage
          ? typeof selectedActionMessage.id === 'number'
            ? selectedActionMessage.id
            : undefined
          : undefined,
        reason: reportReason,
        description: reportDescription.trim() || undefined,
      });
      setReportModalVisible(false);
      Alert.alert('Report Submitted', 'Thank you. Our moderation team will review this report.');
    } catch (err: any) {
      Alert.alert('Report Failed', err.message || 'Could not submit report');
    } finally {
      setSubmittingReport(false);
    }
  };

  // Blocked Banner Check
  const isBlockedByMe = Boolean(conversation?.blockedByMe);
  const isBlockedByPeer = Boolean(conversation?.blockedByPeer);
  const isBlocked = isBlockedByMe || isBlockedByPeer;

  // Newest confirmed outgoing message seen by peer (Instagram-style "Seen" footer)
  const latestSeenSelfMessageId = useMemo(() => {
    if (!peerLastReadId) return null;
    for (const m of displayedMessages) {
      if (m.senderId === currentUserId && typeof m.id === 'number' && m.id > 0 && peerLastReadId >= m.id) {
        return m.id;
      }
    }
    return null;
  }, [displayedMessages, currentUserId, peerLastReadId]);

  const dmKeyExtractor = useCallback(
    (item: DmMessage) => (item.clientId ? `${item.senderId}:${item.clientId}` : String(item.id)),
    []
  );

  // Memoized message row renderer so composer keystrokes never re-render chat bubbles
  const renderMessageItem = useCallback(({ item, index }: { item: DmMessage; index: number }) => {
    const isSelf = item.senderId === currentUserId;
    const isDeleted = Boolean(item.deletedForAll);

    // Date separator logic for inverted list:
    // Compare current item with the NEXT item in the array (which is chronologically older)
    const olderItem = messages[index + 1];
    const showDateSeparator = !olderItem || !isSameDay(item.createdAt, olderItem.createdAt);

    // Consecutive grouping checks (inverted list: index + 1 is visually above, index - 1 is visually below)
    const newerItem = index > 0 ? messages[index - 1] : undefined;
    const isSameSenderAbove = Boolean(
      olderItem && olderItem.senderId === item.senderId && !showDateSeparator
    );
    const isSameSenderBelow = Boolean(
      newerItem && newerItem.senderId === item.senderId && isSameDay(item.createdAt, newerItem.createdAt)
    );

    // Seen / Sent read receipt
    const numericId = typeof item.id === 'number' ? item.id : 0;
    const isSeen = isSelf && numericId > 0 && peerLastReadId >= numericId;
    const isFirstInGroup = !isSameSenderAbove;
    const isLastInGroup = !isSameSenderBelow;
    const isHighlighted = highlightedMessageId !== null && (item.id === highlightedMessageId || item.clientId === highlightedMessageId);

    const msgAvatarUri = !isSelf
      ? resolveDmAvatarUri(item.senderAvatarUrl || peerInfo.avatarUrl, serverUrl, item.senderId || peerInfo.id)
      : null;

    const isAttachmentImg = Boolean(
      !isDeleted &&
      (item.attachmentName || item.localUri) &&
      isDmImageAttachment(item.attachmentOriginalName || item.attachmentName, item.attachmentMimeType)
    );
    const dmImgUri = isAttachmentImg
      ? (item.status === 'pending' || item.status === 'failed') && item.localUri
        ? item.localUri
        : item.attachmentName
          ? `${(serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')}/api/dm/attachments/${encodeURIComponent(item.attachmentName)}`
          : null
      : null;
    const hasImage = Boolean(dmImgUri);
    const hasFileAttachment = Boolean(!isDeleted && !isAttachmentImg && item.attachmentName);
    const hasText = Boolean(item.text && item.text.trim());
    const isImageOnly = !isDeleted && hasImage && !hasText;
    const emojiOnlyCount = !isDeleted && !hasImage && !hasFileAttachment ? getEmojiOnlyCount(item.text) : 0;
    const isEmojiOnly = emojiOnlyCount > 0;
    const bubbleTextColor = isSelf ? activeDmTheme.selfTextColor : activeDmTheme.peerTextColor;
    const isDarkBubbleText = bubbleTextColor.toLowerCase().startsWith('#0') || bubbleTextColor.toLowerCase().startsWith('#1');

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparatorContainer}>
            <View style={styles.dateSeparatorPill}>
              <Text variant="xs" weight="600" style={styles.dateSeparatorText}>
                {formatDateSeparator(item.createdAt)}
              </Text>
            </View>
          </View>
        )}

        <View
          style={[
            styles.bubbleRow,
            isSelf ? styles.bubbleRowSelf : styles.bubbleRowPeer,
            {
              marginTop: isFirstInGroup ? 10 : 2,
              marginBottom: 2,
            },
          ]}
        >
          {!isSelf && (
            <View style={styles.peerBubbleAvatarGutter}>
              {isLastInGroup ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  disabled={!peerInfo.id}
                  onPress={() => {
                    if (peerInfo.id) {
                      router.push({ pathname: '/user/[id]', params: { id: peerInfo.id } } as any);
                    }
                  }}
                >
                  {msgAvatarUri && !bubbleAvatarFailed ? (
                    <Image
                      source={{ uri: msgAvatarUri, headers: imageHeaders, cacheKey: msgAvatarUri }}
                      cachePolicy="memory-disk"
                      recyclingKey={msgAvatarUri}
                      style={styles.peerBubbleAvatar}
                      contentFit="cover"
                      onError={() => setBubbleAvatarFailed(true)}
                    />
                  ) : (
                    <View style={[styles.peerBubbleAvatar, styles.peerBubbleAvatarFallback]}>
                      <Text style={styles.peerBubbleAvatarInitials}>{getInitials(peerInfo.name)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.peerBubbleAvatarSpacer} />
              )}
            </View>
          )}

          <DmInteractiveBubble
            isSelf={isSelf}
            disabled={isDeleted || typeof item.id !== 'number'}
            onSwipeReply={() => {
              if (!isDeleted && typeof item.id === 'number') {
                setReplyingTo(item);
                setEditingMessage(null);
              }
            }}
            onDoubleTapReact={() => {
              if (!isDeleted && typeof item.id === 'number') {
                handleToggleDmReaction(item, '❤️');
              }
            }}
            onLongPress={() => handleOpenActionSheet(item)}
            headerContent={
              item.replyTo ? (
                <View
                  style={[
                    styles.dmDetachedReplyWrap,
                    isSelf ? styles.dmDetachedReplyWrapSelf : styles.dmDetachedReplyWrapPeer,
                  ]}
                >
                  <Text style={styles.dmDetachedReplyLabel} numberOfLines={1}>
                    {isSelf
                      ? 'You replied'
                      : item.replyTo.senderId === currentUserId
                        ? 'Replied to you'
                        : `Replied to ${item.replyTo.senderName || peerInfo.name}`}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => item.replyTo && handleJumpToReply(item.replyTo.id)}
                    style={[
                      styles.dmDetachedReplyRow,
                      isSelf ? styles.dmDetachedReplyRowSelf : styles.dmDetachedReplyRowPeer,
                    ]}
                  >
                    {!isSelf && <View style={styles.dmDetachedReplyBar} />}
                    <View style={styles.dmDetachedReplyPill}>
                      <Text style={styles.dmDetachedReplyText} numberOfLines={2}>
                        {item.replyTo.deletedForAll ? 'Original message deleted' : item.replyTo.text || 'Message'}
                      </Text>
                    </View>
                    {isSelf && <View style={styles.dmDetachedReplyBar} />}
                  </TouchableOpacity>
                </View>
              ) : undefined
            }
            bubbleStyle={[
              styles.bubbleContainer,
              { maxWidth: '100%', borderWidth: 0, borderColor: 'transparent' },
              isImageOnly
                ? {
                    backgroundColor: 'transparent',
                    paddingHorizontal: 0,
                    paddingTop: 0,
                    paddingBottom: 0,
                    borderRadius: 18,
                  }
                : isEmojiOnly
                  ? {
                      backgroundColor: 'transparent',
                      paddingHorizontal: 2,
                      paddingTop: 2,
                      paddingBottom: 2,
                    }
                  : isSelf
                    ? [
                        styles.bubbleSelf,
                        {
                          backgroundColor: activeDmTheme.selfBubbleBg,
                          borderTopRightRadius: isFirstInGroup || Boolean(item.replyTo) ? 22 : 6,
                          borderBottomRightRadius: isLastInGroup ? 22 : 6,
                          borderTopLeftRadius: 22,
                          borderBottomLeftRadius: 22,
                        },
                      ]
                    : [
                        styles.bubblePeer,
                        {
                          backgroundColor: activeDmTheme.peerBubbleBg,
                          borderTopLeftRadius: isFirstInGroup || Boolean(item.replyTo) ? 22 : 6,
                          borderBottomLeftRadius: isLastInGroup ? 22 : 6,
                          borderTopRightRadius: 22,
                          borderBottomRightRadius: 22,
                        },
                      ],
            ]}
          >
            {/* Highlight Flash Overlay */}
            {isHighlighted && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'rgba(255, 255, 255, 0.18)', borderRadius: 22, zIndex: 5 },
                ]}
              />
            )}

            {/* Message Body */}
            {isDeleted ? (
              <View style={styles.deletedRow}>
                <Ionicons
                  name="trash-outline"
                  size={14}
                  color={isSelf ? Monochrome.outgoingMeta : Monochrome.textTertiary}
                  style={{ marginRight: 6 }}
                />
                <Text
                  variant="sm"
                  style={[
                    styles.deletedText,
                    { color: isSelf ? Monochrome.outgoingMeta : Monochrome.textTertiary },
                  ]}
                >
                  This message was deleted
                </Text>
              </View>
            ) : (
              <>
                {dmImgUri && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setViewerImage({ uri: dmImgUri, name: item.attachmentOriginalName || 'Photo' })}
                    onLongPress={() => handleOpenActionSheet(item)}
                    delayLongPress={250}
                    style={[styles.dmImageWrap, isImageOnly && { marginBottom: 0 }]}
                  >
                    <Image
                      source={{
                        uri: dmImgUri,
                        headers: dmImgUri.startsWith('http://') || dmImgUri.startsWith('https://') ? imageHeaders : undefined,
                        cacheKey: dmImgUri,
                      }}
                      style={styles.dmBubbleImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={dmImgUri}
                      transition={150}
                    />
                    {item.status === 'pending' && (
                      <View style={styles.dmImageUploadingOverlay}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                {hasFileAttachment && (
                  <TouchableOpacity
                    activeOpacity={0.78}
                    onPress={() => void handleOpenDmFile(item)}
                    onLongPress={() => handleOpenActionSheet(item)}
                    delayLongPress={250}
                    style={[styles.dmFileRow, hasText && { marginBottom: 8 }]}
                  >
                    <View
                      style={[
                        styles.dmFileIconBadge,
                        { backgroundColor: isDarkBubbleText ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.16)' },
                      ]}
                    >
                      <Ionicons
                        name={getDmFileIcon(item.attachmentOriginalName || item.attachmentName, item.attachmentMimeType)}
                        size={20}
                        color={bubbleTextColor}
                      />
                    </View>
                    <View style={styles.dmFileTextCol}>
                      <Text
                        variant="sm"
                        weight="600"
                        numberOfLines={2}
                        ellipsizeMode="middle"
                        style={{ color: bubbleTextColor, lineHeight: 18 }}
                      >
                        {item.attachmentOriginalName || item.attachmentName}
                      </Text>
                      <Text
                        variant="xs"
                        numberOfLines={1}
                        style={{ color: bubbleTextColor, opacity: 0.72, marginTop: 2 }}
                      >
                        {`${formatFileExtension(item.attachmentOriginalName || item.attachmentName, item.attachmentMimeType)} · Tap to open`}
                      </Text>
                    </View>
                    {downloadingFileId === String(item.id) || item.status === 'pending' ? (
                      <ActivityIndicator size="small" color={bubbleTextColor} style={{ marginLeft: 8 }} />
                    ) : (
                      <Ionicons
                        name="open-outline"
                        size={16}
                        color={bubbleTextColor}
                        style={{ marginLeft: 8, opacity: 0.78 }}
                      />
                    )}
                  </TouchableOpacity>
                )}
                {hasText && (isEmojiOnly ? (
                  <RNText
                    style={emojiOnlyCount > 3 ? styles.emojiOnlyTextCompact : styles.emojiOnlyText}
                    allowFontScaling={false}
                  >
                    {item.text?.trim()}
                  </RNText>
                ) : renderDmTextWithLinks(
                  item.text || '',
                  isSelf,
                  [
                    styles.bubbleText,
                    { color: isSelf ? activeDmTheme.selfTextColor : activeDmTheme.peerTextColor },
                  ]
                ))}
                {(() => {
                  const preview = extractFirstDmUrl(item.text);
                  if (!preview) return null;
                  return (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => Linking.openURL(preview.url).catch(() => {})}
                      style={[
                        styles.dmLinkPreviewCard,
                        {
                          backgroundColor: isSelf ? 'rgba(0,0,0,0.08)' : '#222226',
                          borderColor: isSelf ? 'rgba(0,0,0,0.14)' : '#323238',
                        },
                      ]}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={15}
                        color={isSelf ? Monochrome.outgoingText : '#E4E4E7'}
                        style={{ marginRight: 7 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          variant="xs"
                          weight="700"
                          numberOfLines={1}
                          style={{ color: isSelf ? Monochrome.outgoingText : '#F4F4F5' }}
                        >
                          {preview.domain}
                        </Text>
                        <Text
                          variant="xs"
                          numberOfLines={1}
                          style={{ color: isSelf ? Monochrome.outgoingMeta : '#A1A1AA' }}
                        >
                          {preview.url}
                        </Text>
                      </View>
                      <Ionicons
                        name="open-outline"
                        size={13}
                        color={isSelf ? Monochrome.outgoingMeta : '#A1A1AA'}
                        style={{ marginLeft: 6 }}
                      />
                    </TouchableOpacity>
                  );
                })()}
              </>
            )}

            {/* Minimal Footer: Starred / Edited / Pending / Failed Retry only (no ticks inside bubble) */}
            {((isSelf && (item.status === 'pending' || item.status === 'failed')) || (starredIds.has(item.id) && !isDeleted) || (item.isEdited && !isDeleted)) && (
              <View style={styles.bubbleFooter}>
                {starredIds.has(item.id) && !isDeleted && (
                  <Ionicons
                    name="star"
                    size={10}
                    color={isSelf ? Monochrome.outgoingMeta : '#A1A1AA'}
                    style={{ marginRight: 4 }}
                  />
                )}
                {item.isEdited && !isDeleted && (
                  <Text
                    variant="xs"
                    style={[
                      styles.editedTag,
                      { color: isSelf ? Monochrome.outgoingMeta : Monochrome.textTertiary },
                    ]}
                  >
                    edited
                  </Text>
                )}

                {isSelf && item.status === 'pending' && (
                  <View style={styles.receiptContainer}>
                    <Ionicons name="time-outline" size={12} color={Monochrome.outgoingMeta} />
                  </View>
                )}
                {isSelf && item.status === 'failed' && (
                  <View style={styles.receiptContainer}>
                    <TouchableOpacity
                      accessibilityLabel="Retry failed message"
                      onPress={() => void handleRetry(item)}
                      hitSlop={6}
                      style={(isImageOnly || isEmojiOnly) ? styles.floatingRetryPill : undefined}
                    >
                      <Text variant="xs" style={{ color: '#FCA5A5' }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </DmInteractiveBubble>
        </View>

        {/* Instagram-style "Seen" underneath the newest seen outgoing message */}
        {isSelf && isSeen && numericId === latestSeenSelfMessageId && (
          <View style={styles.dmSeenRow}>
            <Text style={styles.dmSeenText}>Seen</Text>
          </View>
        )}

        {/* Quick Reaction Pills on DM Bubble (Item 12) */}
        {(localReactions[String(item.id)] || []).length > 0 && (
          <View
            style={[
              styles.dmReactionPillsRow,
              isSelf ? { justifyContent: 'flex-end', paddingRight: 6 } : { justifyContent: 'flex-start', paddingLeft: 42 },
            ]}
          >
            {(localReactions[String(item.id)] || []).map((emoji) => (
              <TouchableOpacity
                key={emoji}
                activeOpacity={0.75}
                onPress={() => handleToggleDmReaction(item, emoji)}
                style={styles.dmReactionPill}
              >
                <RNText style={{ fontSize: 12 }} allowFontScaling={false}>
                  {emoji}
                </RNText>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }, [
    currentUserId,
    messages,
    peerLastReadId,
    highlightedMessageId,
    peerInfo.avatarUrl,
    peerInfo.id,
    peerInfo.name,
    serverUrl,
    bubbleAvatarFailed,
    imageHeaders,
    router,
    handleJumpToReply,
    starredIds,
    latestSeenSelfMessageId,
    localReactions,
    activeDmTheme,
    downloadingFileId,
    handleOpenDmFile,
  ]);

  if (!conversationId) {
    return (
      <View style={[styles.container, styles.centerContainer, { backgroundColor: colors.background, paddingHorizontal: 32 }]}>
        <StatusBar barStyle="light-content" />
        <Ionicons name="alert-circle-outline" size={54} color={colors.textMuted} />
        <Text variant="lg" weight="700" style={{ color: colors.text, marginTop: 16 }}>
          Conversation Not Found
        </Text>
        <Text variant="sm" color="secondary" align="center" style={{ marginTop: 8, lineHeight: 20 }}>
          This conversation could not be loaded because the conversation ID is missing or invalid.
        </Text>
        <TouchableOpacity
          onPress={handleBack}
          style={[styles.retryBtn, { backgroundColor: colors.surfaceRaised, marginTop: 24 }]}
        >
          <Text variant="sm" weight="600" style={{ color: colors.text }}>
            Back to Messages
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: Monochrome.background }]} {...backSwipeHandlers}>
      <StatusBar barStyle="light-content" />
      {activeDmTheme.backgroundImage ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Image
            source={activeDmTheme.backgroundImage}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            priority="high"
          />
          {activeDmTheme.backgroundOverlay !== 'transparent' && (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: activeDmTheme.backgroundOverlay }]}
            />
          )}
        </View>
      ) : (
        <FluidChatBackground />
      )}

      {/* Main Timeline — Edge-to-edge full screen so messages scroll softly behind floating header & composer */}
      <View style={{ flex: 1 }}>
      <KeyboardContentBoundary style={styles.timelineBoundary}>
        {loading && messages.length === 0 ? (
          <View style={{ flex: 1, paddingTop: topHeaderHeight, paddingBottom: composerHeight }}>
            <ChatConversationSkeleton />
          </View>
        ) : error && messages.length === 0 ? (
          <View style={[styles.centerContainer, { paddingTop: topHeaderHeight, paddingBottom: composerHeight }]}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text variant="sm" style={{ color: colors.textMuted, marginTop: 8, textAlign: 'center' }}>
              {error}
            </Text>
            <TouchableOpacity
              onPress={() => void loadMessages()}
              style={[styles.retryBtn, { backgroundColor: Monochrome.surfaceElevated, borderColor: Monochrome.border, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text variant="sm" weight="600" style={{ color: colors.text }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : messages.length === 0 ? (
          <View style={[styles.centerContainer, { paddingTop: topHeaderHeight, paddingBottom: composerHeight }]}>
            <View style={styles.emptyPeerAvatarWrap}>
              {resolvedPeerAvatarUri && !headerAvatarFailed ? (
                <Image
                  source={{ uri: resolvedPeerAvatarUri, headers: imageHeaders, cacheKey: resolvedPeerAvatarUri }}
                  cachePolicy="memory-disk"
                  style={styles.emptyPeerAvatar}
                  contentFit="cover"
                  onError={() => setHeaderAvatarFailed(true)}
                />
              ) : (
                <View style={[styles.emptyPeerAvatar, styles.avatarFallback]}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: '#F4F4F5' }}>
                    {getInitials(peerInfo.name)}
                  </Text>
                </View>
              )}
            </View>
            <Text variant="lg" weight="700" style={{ color: '#F4F4F5', marginTop: 14 }}>
              {peerInfo.name}
            </Text>
            <Text variant="sm" style={{ color: '#8E8E93', marginTop: 4, textAlign: 'center' }}>
              Send a message to start chatting with {peerInfo.name}.
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={flatListRef}
              data={displayedMessages}
              renderItem={renderMessageItem}
              keyExtractor={dmKeyExtractor}
              inverted
              initialNumToRender={8}
              maxToRenderPerBatch={5}
              windowSize={5}
              updateCellsBatchingPeriod={40}
              removeClippedSubviews={Platform.OS === 'android'}
              scrollEventThrottle={64}
              onScroll={event => {
                const offsetY = event.nativeEvent.contentOffset.y;
                nearBottomRef.current = offsetY < 80;
                setShowScrollToBottom(offsetY > 220);
                if (nearBottomRef.current) markIncomingRead(messagesRef.current);
              }}
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
              onScrollToIndexFailed={({ averageItemLength, index }) => {
                flatListRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true });
              }}
              onEndReached={loadOlderMessages}
              onEndReachedThreshold={0.3}
              ListHeaderComponent={
                peerIsTyping ? (
                  <TypingIndicatorBubble
                    avatarUri={resolvedPeerAvatarUri}
                    initials={getInitials(peerInfo.name)}
                    headers={imageHeaders}
                  />
                ) : undefined
              }
              ListFooterComponent={
                loadingOlder ? (
                  <View style={{ paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color={Monochrome.textSecondary} />
                  </View>
                ) : undefined
              }
              contentContainerStyle={[
                styles.listContent,
                {
                  paddingBottom: topHeaderHeight + 18,
                  paddingTop: composerHeight + 14,
                },
              ]}
              keyboardDismissMode="on-drag"
            />
            {showScrollToBottom && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
                  setShowScrollToBottom(false);
                }}
                style={{
                  position: 'absolute',
                  right: 16,
                  bottom: composerHeight + 14,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: Monochrome.surfaceElevated,
                  borderColor: Monochrome.border,
                  borderWidth: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.35,
                  shadowRadius: 6,
                  elevation: 4,
                }}
                accessibilityLabel="Scroll to latest messages"
              >
                <Ionicons name="chevron-down" size={20} color={colors.text} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardContentBoundary>
      </View>

      {/* Floating Top Header with Instagram-style seamless feathered fade over scrolling messages */}
      <View
        pointerEvents="box-none"
        style={styles.floatingHeaderOverlay}
        onLayout={(e) => {
          const nextH = Math.round(e.nativeEvent.layout.height);
          if (nextH > 0 && Math.abs(nextH - topHeaderHeight) > 1) {
            setTopHeaderHeight(nextH);
          }
        }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(6, 6, 10, 0.99)',
            'rgba(6, 6, 10, 0.96)',
            'rgba(6, 6, 10, 0.88)',
            'rgba(6, 6, 10, 0.66)',
            'rgba(6, 6, 10, 0.32)',
            'rgba(6, 6, 10, 0.09)',
            'rgba(6, 6, 10, 0)',
          ]}
          locations={[0, 0.28, 0.50, 0.68, 0.82, 0.93, 1]}
          style={styles.topFadeScrim}
        />

        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top, 10),
              backgroundColor: 'transparent',
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Peer Avatar & Name — opens User Info & Quick Actions Modal Bottom Sheet */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => {
              Keyboard.dismiss();
              setPeerInfoModalVisible(true);
            }}
            accessibilityLabel="Open chat details and quick actions"
            style={styles.headerProfileTouch}
          >
            <View style={styles.headerAvatarContainer}>
              {resolvedPeerAvatarUri && !headerAvatarFailed ? (
                <Image
                  source={{ uri: resolvedPeerAvatarUri, headers: imageHeaders, cacheKey: resolvedPeerAvatarUri }}
                  cachePolicy="memory-disk"
                  style={styles.headerAvatar}
                  contentFit="cover"
                  onError={() => setHeaderAvatarFailed(true)}
                />
              ) : (
                <View style={[styles.headerAvatar, styles.avatarFallback]}>
                  <Text variant="sm" weight="700" style={{ color: '#F4F4F5' }}>
                    {getInitials(peerInfo.name)}
                  </Text>
                </View>
              )}
              {realtimeConnected && !isBlocked && (
                <View style={styles.headerOnlineDot} />
              )}
            </View>

            {/* Peer Name & Subtitle */}
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerNameRow}>
                <Text variant="md" weight="700" numberOfLines={1} style={styles.headerPeerName}>
                  {peerInfo.name}
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#A1A1AA" style={{ marginLeft: 3 }} />
              </View>

              {peerIsTyping ? (
                <Text variant="xs" weight="600" style={styles.typingIndicator}>
                  typing...
                </Text>
              ) : peerInfo.username ? (
                <Text variant="xs" style={styles.headerSubtitleText} numberOfLines={1}>
                  @{peerInfo.username}
                </Text>
              ) : (
                <Text variant="xs" style={styles.headerSubtitleText} numberOfLines={1}>
                  Direct message
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Search & Conversation Settings Buttons */}
          <TouchableOpacity
            onPress={() => {
              setSearchMode((prev) => !prev);
              setSearchQuery('');
            }}
            style={[styles.headerActionBtn, { marginRight: 6 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Search in conversation"
          >
            <Ionicons name={searchMode ? 'close' : 'search-outline'} size={18} color="#E4E4E7" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSettingsModalVisible(true)}
            style={styles.headerActionBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Conversation options"
          >
            <Ionicons name="ellipsis-horizontal" size={19} color="#E4E4E7" />
          </TouchableOpacity>
        </View>

        {/* In-Chat Search Bar (Item 14) */}
        {searchMode && (
          <View style={styles.dmSearchBar}>
            <Ionicons name="search-outline" size={16} color="#8E8E93" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.dmSearchInput}
              placeholder="Search in conversation..."
              placeholderTextColor="#71717A"
              keyboardAppearance="dark"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {Boolean(searchQuery) && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#8E8E93" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Floating Message Composer or Blocked Banner with matching bottom fade behind & below message box */}
      <View pointerEvents="box-none" style={styles.floatingComposerOverlay}>
      {isBlocked ? (
        <View
          onLayout={(e) => {
            const nextH = Math.round(e.nativeEvent.layout.height);
            if (nextH > 0 && Math.abs(nextH - composerHeight) > 1) {
              setComposerHeight(nextH);
            }
          }}
          style={[
            styles.blockedBanner,
            {
              backgroundColor: 'rgba(14, 14, 18, 0.88)',
              borderTopColor: 'rgba(255, 255, 255, 0.08)',
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
          <Text variant="sm" style={{ color: colors.textMuted, marginLeft: 8, flex: 1 }}>
            {isBlockedByMe
              ? 'You have blocked this user.'
              : 'You cannot send messages to this user.'}
          </Text>
          {isBlockedByMe && (
            <TouchableOpacity onPress={handleToggleBlock} style={styles.unblockBannerBtn}>
              <Text variant="sm" weight="700" style={{ color: colors.text }}>
                Unblock
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <StickyComposer bordered={false} style={{ backgroundColor: 'transparent', paddingHorizontal: 4 }}>
          <LinearGradient
            pointerEvents="none"
            colors={[
              'rgba(6, 6, 10, 0)',
              'rgba(6, 6, 10, 0.14)',
              'rgba(6, 6, 10, 0.48)',
              'rgba(6, 6, 10, 0.84)',
              'rgba(6, 6, 10, 0.98)',
            ]}
            locations={[0, 0.22, 0.48, 0.76, 1]}
            style={styles.bottomFadeScrim}
          />
          <View
            onLayout={(e) => {
              const nextH = Math.round(e.nativeEvent.layout.height) + Math.max(insets.bottom, 10);
              if (nextH > 0 && Math.abs(nextH - composerHeight) > 1) {
                setComposerHeight(nextH);
              }
            }}
          >
          {/* Replying Banner */}
          {replyingTo && (
            <View style={[styles.contextBanner, { backgroundColor: Monochrome.surfaceElevated, borderColor: Monochrome.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <View style={{ flex: 1 }}>
                <Text variant="xs" weight="600" style={{ color: Monochrome.text }}>
                  Replying to {replyingTo.senderId === currentUserId ? 'yourself' : peerInfo.name}
                </Text>
                <Text variant="xs" numberOfLines={1} style={{ color: Monochrome.textSecondary }}>
                  {replyingTo.text}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
                <Ionicons name="close" size={18} color={Monochrome.textTertiary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Editing Banner */}
          {editingMessage && (
            <View style={[styles.contextBanner, { backgroundColor: Monochrome.surfaceElevated, borderColor: Monochrome.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <View style={{ flex: 1 }}>
                <Text variant="xs" weight="600" style={{ color: Monochrome.text }}>
                  Editing message
                </Text>
                <Text variant="xs" numberOfLines={1} style={{ color: Monochrome.textSecondary }}>
                  {editingMessage.text}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setEditingMessage(null);
                  setInputText('');
                }}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={Monochrome.textTertiary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Selected Attachment Preview Banner (Photo or File) */}
          {selectedAttachment && (
            <View style={[styles.contextBanner, { backgroundColor: Monochrome.surfaceElevated, borderColor: Monochrome.border, borderWidth: StyleSheet.hairlineWidth }]}>
              {selectedAttachment.isImage ? (
                <Image source={{ uri: selectedAttachment.uri }} style={styles.dmPreviewThumb} contentFit="cover" />
              ) : (
                <View style={styles.dmPreviewFileIconBox}>
                  <Ionicons
                    name={getDmFileIcon(selectedAttachment.name, selectedAttachment.mimeType)}
                    size={20}
                    color="#E4E4E7"
                  />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="xs" weight="600" numberOfLines={1} style={{ color: Monochrome.text }}>
                  {selectedAttachment.name}
                </Text>
                <Text variant="xs" style={{ color: Monochrome.textSecondary }}>
                  {selectedAttachment.isImage
                    ? 'Photo ready to send'
                    : `${formatFileExtension(selectedAttachment.name, selectedAttachment.mimeType)} · Ready to send`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  void removeOutboxFile(selectedAttachment.uri);
                  setSelectedAttachment(null);
                }}
                hitSlop={8}
                accessibilityLabel="Remove selected attachment"
              >
                <Ionicons name="close-circle" size={19} color={Monochrome.textTertiary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Input Row — Clean Pill Capsule (Attach + Send) */}
          <View style={styles.composerRow}>
            {!editingMessage && (
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setShowAttachModal(true);
                }}
                style={styles.composerImageCircle}
                activeOpacity={0.75}
                accessibilityLabel="Attach photo or file"
              >
                <Ionicons name="add" size={22} color="#F4F4F5" />
              </TouchableOpacity>
            )}

            <TextInput
              style={styles.composerInput}
              placeholder="Message..."
              placeholderTextColor="#9CA3AF"
              keyboardAppearance="dark"
              value={inputText}
              onChangeText={handleInputChange}
              multiline
              maxLength={2000}
            />

            {/* Character counter if > 1500 */}
            {inputText.length > 1500 && (
              <Text
                variant="xs"
                style={[
                  styles.charCounter,
                  { color: inputText.length > 1950 ? Monochrome.text : Monochrome.textTertiary },
                ]}
              >
                {inputText.length}/2000
              </Text>
            )}

            <TouchableOpacity
              onPress={handleSend}
              disabled={sending || (!inputText.trim() && !selectedAttachment)}
              style={[
                styles.sendButton,
                (inputText.trim() || selectedAttachment)
                  ? [styles.sendButtonActive, { backgroundColor: activeDmTheme.sendButtonActiveBg }]
                  : styles.sendButtonInactive,
              ]}
              accessibilityLabel={editingMessage ? 'Save edited message' : 'Send message'}
            >
              {sending ? (
                <ActivityIndicator size="small" color={activeDmTheme.sendButtonActiveIcon} />
              ) : (
                <Ionicons
                  name={editingMessage ? 'checkmark' : 'arrow-up'}
                  size={19}
                  color={(inputText.trim() || selectedAttachment) ? activeDmTheme.sendButtonActiveIcon : '#71717A'}
                />
              )}
            </TouchableOpacity>
          </View>
          </View>
        </StickyComposer>
      )}
      </View>

      {/* Message Action Sheet / Context Modal (mounted lazily only when open) */}
      {Boolean(selectedActionMessage) && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedActionMessage(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSelectedActionMessage(null)}
        >
          <ThemeGlassSheet
            backgroundImage={activeDmTheme.backgroundImage}
            tintColor={activeDmTheme.selfBubbleBg}
            accentColor={activeDmTheme.previewColors[2]}
            blurRadius={26}
            style={styles.actionSheetContent}
          >
            <View style={styles.peerSheetHandle} />
            {/* Message Timestamp Header (shown on long-press alongside reactions & actions) */}
            {Boolean(selectedActionMessage?.createdAt) && (
              <View style={styles.dmActionTimestampRow}>
                <Ionicons name="time-outline" size={13} color="#A1A1AA" />
                <Text variant="xs" weight="500" style={styles.dmActionTimestampText}>
                  {`${formatDateSeparator(selectedActionMessage?.createdAt)} · ${formatBubbleTime(selectedActionMessage?.createdAt)}`}
                  {selectedActionMessage?.isEdited ? ' · Edited' : ''}
                </Text>
              </View>
            )}

            {/* Quick Emoji Reaction Bar (Items 12, 94, 98) */}
            {!selectedActionMessage?.deletedForAll && (
              <View style={styles.dmQuickReactionBar}>
                {DM_QUICK_REACTIONS.map((emoji) => {
                  const active = (
                    localReactions[String(selectedActionMessage?.id || '')] || []
                  ).includes(emoji);
                  return (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() =>
                        selectedActionMessage && handleToggleDmReaction(selectedActionMessage, emoji)
                      }
                      style={[
                        styles.dmQuickReactionBtn,
                        active && styles.dmQuickReactionBtnActive,
                      ]}
                    >
                      <RNText style={{ fontSize: 22 }} allowFontScaling={false}>
                        {emoji}
                      </RNText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!selectedActionMessage?.deletedForAll && (
              <TouchableOpacity style={styles.actionSheetRow} onPress={handleStartReply}>
                <Ionicons name="arrow-undo-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                  Reply
                </Text>
              </TouchableOpacity>
            )}

            {!selectedActionMessage?.deletedForAll && (
              <TouchableOpacity style={styles.actionSheetRow} onPress={handleForwardMessage}>
                <Ionicons name="arrow-redo-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                  Forward Message
                </Text>
              </TouchableOpacity>
            )}

            {!selectedActionMessage?.deletedForAll && (
              <TouchableOpacity style={styles.actionSheetRow} onPress={handleToggleStarMessage}>
                <Ionicons
                  name={selectedActionMessage && starredIds.has(selectedActionMessage.id) ? 'star' : 'star-outline'}
                  size={20}
                  color={colors.text}
                />
                <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                  {selectedActionMessage && starredIds.has(selectedActionMessage.id)
                    ? 'Remove Star'
                    : 'Star Message'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionSheetRow} onPress={handleCopyMessage}>
              <Ionicons name="copy-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Copy Text
              </Text>
            </TouchableOpacity>

            {/* Self-only: Edit message (if not deleted) */}
            {selectedActionMessage?.senderId === currentUserId &&
              !selectedActionMessage?.deletedForAll && (
                <TouchableOpacity style={styles.actionSheetRow} onPress={handleStartEdit}>
                  <Ionicons name="pencil-outline" size={20} color={colors.text} />
                  <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                    Edit Message
                  </Text>
                </TouchableOpacity>
              )}

            {/* Delete for me */}
            <TouchableOpacity style={styles.actionSheetRow} onPress={handleDeleteForMe}>
              <Ionicons name="trash-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Delete for Me
              </Text>
            </TouchableOpacity>

            {/* Self-only: Delete for everyone */}
            {selectedActionMessage?.senderId === currentUserId &&
              !selectedActionMessage?.deletedForAll && (
                <TouchableOpacity style={styles.actionSheetRow} onPress={handleDeleteForEveryone}>
                  <Ionicons name="trash" size={20} color={Monochrome.text} />
                  <Text variant="sm" weight="600" style={[styles.actionRowText, { color: Monochrome.text }]}>
                    Delete for Everyone
                  </Text>
                </TouchableOpacity>
              )}

            {/* Peer-only: Report message */}
            {selectedActionMessage?.senderId !== currentUserId && (
              <TouchableOpacity style={styles.actionSheetRow} onPress={handleOpenReportModal}>
                <Ionicons name="flag-outline" size={20} color={Monochrome.textSecondary} />
                <Text variant="sm" weight="600" style={[styles.actionRowText, { color: Monochrome.textSecondary }]}>
                  Report Message
                </Text>
              </TouchableOpacity>
            )}
          </ThemeGlassSheet>
        </Pressable>
      </Modal>
      )}

      {/* Conversation Settings Modal (mounted lazily only when open) */}
      {settingsModalVisible && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSettingsModalVisible(false)}
        >
          <ThemeGlassSheet
            backgroundImage={activeDmTheme.backgroundImage}
            tintColor={activeDmTheme.selfBubbleBg}
            accentColor={activeDmTheme.previewColors[2]}
            blurRadius={26}
            style={styles.actionSheetContent}
          >
            <View style={styles.peerSheetHandle} />
            <Text variant="sm" weight="700" style={[styles.actionSheetHeader, { color: colors.textMuted }]}>
              CONVERSATION OPTIONS
            </Text>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() => {
                setSettingsModalVisible(false);
                setThemeModalVisible(true);
              }}
            >
              <Ionicons name="color-palette-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text, flex: 1 }]}>
                Chat Theme
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.themeMiniDot, { backgroundColor: activeDmTheme.selfBubbleBg }]} />
                <Text variant="xs" style={{ color: colors.textMuted }}>
                  {activeDmTheme.name}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() => {
                setSettingsModalVisible(false);
                setSearchMode(true);
              }}
            >
              <Ionicons name="search-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Search in Conversation
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionSheetRow} onPress={() => void handleToggleMute()}>
              <Ionicons
                name={isMuted ? 'notifications-outline' : 'notifications-off-outline'}
                size={20}
                color={colors.text}
              />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() => {
                setSettingsModalVisible(false);
                setSubPanel('links');
              }}
            >
              <Ionicons name="link-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Shared Links ({sharedLinks.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() => {
                setSettingsModalVisible(false);
                setSubPanel('starred');
              }}
            >
              <Ionicons name="star-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Starred Messages ({starredMessages.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionSheetRow} onPress={handleClearConversation}>
              <Ionicons name="trash-bin-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Clear Conversation
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionSheetRow} onPress={handleToggleBlock}>
              <Ionicons
                name={isBlockedByMe ? 'shield-checkmark-outline' : 'ban-outline'}
                size={20}
                color={colors.text}
              />
              <Text
                variant="sm"
                weight="600"
                style={[
                  styles.actionRowText,
                  { color: colors.text },
                ]}
              >
                {isBlockedByMe ? 'Unblock User' : 'Block User'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionSheetRow} onPress={handleOpenReportModal}>
              <Ionicons name="flag-outline" size={20} color={Monochrome.textSecondary} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: Monochrome.textSecondary }]}>
                Report User
              </Text>
            </TouchableOpacity>
          </ThemeGlassSheet>
        </Pressable>
      </Modal>
      )}

      {/* Shared Links & Starred Messages Modal (mounted lazily only when open) */}
      {subPanel !== null && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setSubPanel(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSubPanel(null)}>
          <ThemeGlassSheet
            backgroundImage={activeDmTheme.backgroundImage}
            tintColor={activeDmTheme.selfBubbleBg}
            accentColor={activeDmTheme.previewColors[2]}
            blurRadius={26}
            style={[styles.actionSheetContent, { maxHeight: 420 }]}
          >
            <View style={styles.peerSheetHandle} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text variant="sm" weight="700" style={{ color: colors.textMuted, letterSpacing: 0.5 }}>
                {subPanel === 'links' ? 'SHARED LINKS' : 'STARRED MESSAGES'}
              </Text>
              <TouchableOpacity onPress={() => setSubPanel(null)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 330 }}>
              {subPanel === 'links' ? (
                sharedLinks.length === 0 ? (
                  <Text variant="sm" style={{ color: colors.textMuted, paddingVertical: 16 }}>
                    No links shared in this conversation yet.
                  </Text>
                ) : (
                  sharedLinks.map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.messageId}:${idx}`}
                      style={styles.actionSheetRow}
                      onPress={() => {
                        setSubPanel(null);
                        Linking.openURL(item.url).catch(() => {});
                      }}
                    >
                      <Ionicons name="globe-outline" size={18} color={colors.text} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text variant="sm" weight="600" style={{ color: colors.text }} numberOfLines={1}>
                          {item.domain}
                        </Text>
                        <Text variant="xs" style={{ color: colors.textMuted }} numberOfLines={1}>
                          {item.url}
                        </Text>
                      </View>
                      <Ionicons name="open-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))
                )
              ) : starredMessages.length === 0 ? (
                <Text variant="sm" style={{ color: colors.textMuted, paddingVertical: 16 }}>
                  Long-press any message and tap Star Message to bookmark it here.
                </Text>
              ) : (
                starredMessages.map((m) => (
                  <TouchableOpacity
                    key={String(m.id)}
                    style={styles.actionSheetRow}
                    onPress={() => {
                      setSubPanel(null);
                      handleJumpToReply(m.id);
                    }}
                  >
                    <Ionicons name="star" size={16} color={colors.text} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="sm" style={{ color: colors.text }} numberOfLines={2}>
                        {m.text}
                      </Text>
                      <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                        {formatBubbleTime(m.createdAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </ThemeGlassSheet>
        </Pressable>
      </Modal>
      )}

      {/* Report Modal (mounted lazily only when open) */}
      {reportModalVisible && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.reportModalOverlay}>
          <View
            style={[
              styles.reportModalCard,
              { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
            ]}
          >
            <View style={styles.reportModalHeader}>
              <Text variant="md" weight="700" style={{ color: colors.text }}>
                Report {peerInfo.name}
              </Text>
              <TouchableOpacity onPress={() => setReportModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text variant="xs" style={{ color: colors.textMuted, marginBottom: 12 }}>
              Select a reason for this report:
            </Text>

            {(['HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'OTHER'] as const).map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reportReasonRow,
                  {
                    backgroundColor:
                      reportReason === reason ? colors.surfaceRaised : 'transparent',
                    borderColor:
                      reportReason === reason ? colors.text : colors.borderSubtle,
                  },
                ]}
                onPress={() => setReportReason(reason)}
              >
                <Text
                  variant="sm"
                  weight={reportReason === reason ? '700' : '500'}
                  style={{ color: colors.text }}
                >
                  {reason}
                </Text>
                {reportReason === reason && (
                  <Ionicons name="checkmark-circle" size={18} color={colors.text} />
                )}
              </TouchableOpacity>
            ))}

            <TextInput
              style={[
                styles.reportTextInput,
                {
                  backgroundColor: colors.surfaceRaised,
                  color: colors.text,
                  borderColor: colors.borderSubtle,
                },
              ]}
              placeholder="Additional details (optional)..."
              placeholderTextColor={colors.textMuted}
              value={reportDescription}
              onChangeText={setReportDescription}
              multiline
              numberOfLines={3}
            />

            <View style={styles.reportModalActions}>
              <TouchableOpacity
                style={[styles.reportCancelBtn, { borderColor: colors.borderSubtle }]}
                onPress={() => setReportModalVisible(false)}
              >
                <Text variant="sm" weight="600" style={{ color: colors.text }}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.reportSubmitBtn,
                  {
                    backgroundColor: reportDescription.trim() ? Monochrome.outgoingBubble : Monochrome.surfaceRaised,
                  },
                ]}
                onPress={handleSubmitReport}
                disabled={submittingReport || !reportDescription.trim()}
              >
                {submittingReport ? (
                  <ActivityIndicator size="small" color={Monochrome.outgoingText} />
                ) : (
                  <Text
                    variant="sm"
                    weight="700"
                    style={{
                      color: reportDescription.trim() ? Monochrome.outgoingText : Monochrome.textTertiary,
                    }}
                  >
                    Submit Report
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* User Info & Quick Actions Modal Bottom Sheet (mounted lazily only when open) */}
      {peerInfoModalVisible && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setPeerInfoModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPeerInfoModalVisible(false)}
        >
          <Pressable onPress={() => {}}>
          <ThemeGlassSheet
            backgroundImage={activeDmTheme.backgroundImage}
            tintColor={activeDmTheme.selfBubbleBg}
            accentColor={activeDmTheme.previewColors[2]}
            blurRadius={26}
            style={[
              styles.peerSheetContainer,
              { paddingBottom: Math.max(insets.bottom, 22) },
            ]}
          >
            <View style={styles.peerSheetHandle} />

            {/* Recipient Metadata Header */}
            <View style={styles.peerSheetProfileHeader}>
              <View style={styles.peerSheetAvatarWrap}>
                {resolvedPeerAvatarUri && !headerAvatarFailed ? (
                  <Image
                    source={{ uri: resolvedPeerAvatarUri, headers: imageHeaders, cacheKey: resolvedPeerAvatarUri }}
                    cachePolicy="memory-disk"
                    style={styles.peerSheetAvatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.peerSheetAvatar, styles.avatarFallback]}>
                    <Text variant="lg" weight="700" style={{ color: '#F4F4F5' }}>
                      {getInitials(peerInfo.name)}
                    </Text>
                  </View>
                )}
                {realtimeConnected && !isBlocked && <View style={styles.peerSheetOnlineDot} />}
              </View>

              <Text variant="lg" weight="700" style={{ color: '#FFFFFF', marginTop: 10 }} numberOfLines={1}>
                {peerInfo.name}
              </Text>
              <View style={styles.peerSheetMetaRow}>
                {Boolean(peerInfo.username) && (
                  <Text variant="xs" style={{ color: '#A1A1AA' }}>@{peerInfo.username}</Text>
                )}
                {Boolean(peerInfo.role) && (
                  <View style={styles.peerSheetRolePill}>
                    <Text variant="xs" weight="600" style={{ color: '#E4E4E7', fontSize: 11 }}>
                      {peerInfo.role.toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.peerSheetStatusPill}>
                  <View
                    style={[
                      styles.peerSheetStatusDot,
                      { backgroundColor: isBlocked ? '#EF4444' : realtimeConnected ? '#22C55E' : '#71717A' },
                    ]}
                  />
                  <Text variant="xs" style={{ color: '#A1A1AA', fontSize: 11 }}>
                    {isBlocked ? 'Blocked' : realtimeConnected ? 'Active' : 'Offline'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Action Toggle Grid */}
            <View style={styles.peerQuickGrid}>
              <TouchableOpacity
                style={[styles.peerQuickTile, isMuted && styles.peerQuickTileActive]}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  void handleToggleMute();
                }}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={isMuted ? 'notifications-off' : 'notifications-outline'}
                  size={20}
                  color="#FFFFFF"
                />
                <Text variant="xs" weight="600" style={styles.peerQuickTileLabel}>
                  {isMuted ? 'Muted' : 'Mute'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.peerQuickTile}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  setSearchMode(true);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="search-outline" size={20} color="#FFFFFF" />
                <Text variant="xs" weight="600" style={styles.peerQuickTileLabel}>
                  Search
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.peerQuickTile}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  setSubPanel('links');
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="link-outline" size={20} color="#FFFFFF" />
                <Text variant="xs" weight="600" style={styles.peerQuickTileLabel}>
                  Links ({sharedLinks.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.peerQuickTile}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  setSubPanel('starred');
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="star-outline" size={20} color="#FFFFFF" />
                <Text variant="xs" weight="600" style={styles.peerQuickTileLabel}>
                  Starred ({starredMessages.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Secondary List Actions */}
            <View style={styles.peerSheetListGroup}>
              <TouchableOpacity
                style={styles.peerSheetListRow}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  setThemeModalVisible(true);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="color-palette-outline" size={20} color="#E4E4E7" />
                <Text variant="sm" weight="600" style={styles.peerSheetListLabel}>
                  Theme
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 6 }}>
                  <View style={[styles.themeMiniDot, { backgroundColor: activeDmTheme.selfBubbleBg }]} />
                  <Text variant="xs" style={{ color: '#A1A1AA' }}>
                    {activeDmTheme.name}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#71717A" />
              </TouchableOpacity>

              {Boolean(peerInfo.id) && (
                <TouchableOpacity
                  style={styles.peerSheetListRow}
                  onPress={() => {
                    setPeerInfoModalVisible(false);
                    router.push({ pathname: '/user/[id]', params: { id: peerInfo.id } } as any);
                  }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="person-circle-outline" size={20} color="#E4E4E7" />
                  <Text variant="sm" weight="600" style={styles.peerSheetListLabel}>
                    View Full Profile
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#71717A" />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.peerSheetListRow}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  handleClearConversation();
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-bin-outline" size={19} color="#E4E4E7" />
                <Text variant="sm" weight="600" style={styles.peerSheetListLabel}>
                  Clear Chat
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.peerSheetListRow}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  handleToggleBlock();
                }}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={isBlockedByMe ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={19}
                  color={isBlockedByMe ? '#22C55E' : '#EF4444'}
                />
                <Text
                  variant="sm"
                  weight="600"
                  style={[styles.peerSheetListLabel, { color: isBlockedByMe ? '#22C55E' : '#EF4444' }]}
                >
                  {isBlockedByMe ? 'Unblock User' : 'Block User'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.peerSheetListRow, { borderBottomWidth: 0 }]}
                onPress={() => {
                  setPeerInfoModalVisible(false);
                  handleOpenReportModal();
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="flag-outline" size={19} color="#A1A1AA" />
                <Text variant="sm" weight="600" style={[styles.peerSheetListLabel, { color: '#A1A1AA' }]}>
                  Report User
                </Text>
              </TouchableOpacity>
            </View>
          </ThemeGlassSheet>
          </Pressable>
        </Pressable>
      </Modal>
      )}

      {/* DM Chat Theme Picker Bottom Sheet (DM only — not in Kyana AI or Group Chat) */}
      {themeModalVisible && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setThemeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setThemeModalVisible(false)}
          />
          <ThemeGlassSheet
            backgroundImage={activeDmTheme.backgroundImage}
            tintColor={activeDmTheme.selfBubbleBg}
            accentColor={activeDmTheme.previewColors[2]}
            blurRadius={26}
            style={[
              styles.peerSheetContainer,
              { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            <View style={styles.peerSheetHandle} />
            <View style={styles.themePickerHeader}>
              <View>
                <Text variant="md" weight="700" style={{ color: '#FFFFFF' }}>
                  Chat Theme ({DM_CHAT_THEMES.length})
                </Text>
                <Text variant="xs" style={{ color: '#A1A1AA', marginTop: 2 }}>
                  Applies to this private conversation
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setThemeModalVisible(false)}
                style={styles.themeCloseBtn}
              >
                <Ionicons name="close" size={18} color="#F4F4F5" />
              </TouchableOpacity>
            </View>

            {/* Live Mini Preview */}
            <View style={styles.themePreviewBox}>
              {activeDmTheme.backgroundImage ? (
                <Image
                  source={activeDmTheme.backgroundImage}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0C' }]} />
              )}
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: activeDmTheme.backgroundOverlay },
                ]}
              />
              <View style={styles.themePreviewBubbles}>
                <View
                  style={[
                    styles.themePreviewBubble,
                    {
                      alignSelf: 'flex-start',
                      backgroundColor: activeDmTheme.peerBubbleBg,
                    },
                  ]}
                >
                  <Text variant="xs" style={{ color: activeDmTheme.peerTextColor }}>
                    See you in 15 mins?
                  </Text>
                </View>
                <View
                  style={[
                    styles.themePreviewBubble,
                    {
                      alignSelf: 'flex-end',
                      backgroundColor: activeDmTheme.selfBubbleBg,
                    },
                  ]}
                >
                  <Text variant="xs" style={{ color: activeDmTheme.selfTextColor }}>
                    On my way right now!
                  </Text>
                </View>
              </View>
            </View>

            {/* Theme Cards (scrollable for all themes) */}
            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
            >
              {DM_CHAT_THEMES.map((t) => {
                const selected = t.id === activeDmTheme.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    activeOpacity={0.8}
                    onPress={() => handleSelectDmTheme(t.id)}
                    style={[
                      styles.themeOptionCard,
                      selected && styles.themeOptionCardActive,
                    ]}
                  >
                    <View style={styles.themeSwatchWrap}>
                      {t.backgroundImage ? (
                        <Image
                          source={t.backgroundImage}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="memory"
                        />
                      ) : (
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#121215' }]} />
                      )}
                      <View
                        style={[
                          styles.themeSwatchDot,
                          { backgroundColor: t.selfBubbleBg, borderColor: t.peerBubbleBorder },
                        ]}
                      />
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="sm" weight="700" style={{ color: '#FFFFFF' }}>
                        {t.name}
                      </Text>
                      <Text variant="xs" style={{ color: '#A1A1AA', marginTop: 2 }}>
                        {t.subtitle}
                      </Text>
                    </View>

                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#52525B" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </ThemeGlassSheet>
        </View>
      </Modal>
      )}

      {/* DM Attachment Picker Sheet (Photo Library, Camera, Document & File) */}
      {showAttachModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setShowAttachModal(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowAttachModal(false)}
          >
            <Pressable onPress={() => {}}>
            <ThemeGlassSheet
              backgroundImage={activeDmTheme.backgroundImage}
              tintColor={activeDmTheme.selfBubbleBg}
              accentColor={activeDmTheme.previewColors[2]}
              blurRadius={26}
              style={[
                styles.actionSheetContent,
                { paddingBottom: Math.max(insets.bottom, 24) },
              ]}
            >
              <View style={styles.peerSheetHandle} />
              <Text variant="md" weight="700" style={{ color: '#F5F5F5', marginBottom: 14 }}>
                Share Attachment
              </Text>

              <TouchableOpacity
                style={styles.dmAttachOptionRow}
                onPress={() => void handleTakePhoto()}
                activeOpacity={0.75}
              >
                <View style={styles.dmAttachOptionIcon}>
                  <Ionicons name="camera-outline" size={20} color="#E4E4E7" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="sm" weight="600" style={{ color: '#F5F5F5' }}>
                    Take Photo
                  </Text>
                  <Text variant="xs" style={{ color: '#8E8E93', marginTop: 1 }}>
                    Capture a photo with your camera
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dmAttachOptionRow}
                onPress={() => void handlePickImage()}
                activeOpacity={0.75}
              >
                <View style={styles.dmAttachOptionIcon}>
                  <Ionicons name="image-outline" size={20} color="#E4E4E7" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="sm" weight="600" style={{ color: '#F5F5F5' }}>
                    Photo Library
                  </Text>
                  <Text variant="xs" style={{ color: '#8E8E93', marginTop: 1 }}>
                    Share photos or screenshots
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dmAttachOptionRow}
                onPress={() => void handlePickDocument()}
                activeOpacity={0.75}
              >
                <View style={styles.dmAttachOptionIcon}>
                  <Ionicons name="document-outline" size={20} color="#E4E4E7" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="sm" weight="600" style={{ color: '#F5F5F5' }}>
                    Document & File
                  </Text>
                  <Text variant="xs" style={{ color: '#A1A1AA', marginTop: 1 }}>
                    PDF, DOCX, PPTX, XLSX, TXT, or ZIP
                  </Text>
                </View>
              </TouchableOpacity>
            </ThemeGlassSheet>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Full-Screen Image Viewer for DM photos (mounted lazily only when open) */}
      {viewerImage !== null && (
        <FullScreenImageViewer
          visible
          imageUri={viewerImage.uri}
          imageTitle={viewerImage.name}
          headers={imageHeaders}
          onClose={() => setViewerImage(null)}
        />
      )}

      {/* In-App File Viewer for DM documents (mounted lazily only when open) */}
      {previewFile !== null && (
        <FullScreenFilePreview
          visible
          file={previewFile.file}
          localFileUri={previewFile.localUri}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
          onDownloadFile={async () => previewFile.localUri}
          onShareFile={async () => {
            try {
              const canShare = await Sharing.isAvailableAsync();
              if (canShare) {
                await Sharing.shareAsync(previewFile.localUri, {
                  dialogTitle: `Open ${previewFile.file.originalName}`,
                  mimeType: previewFile.mimeType || undefined,
                });
              } else {
                Alert.alert('Saved', `File ready: ${previewFile.file.originalName}`);
              }
            } catch (e: any) {
              Alert.alert('Share Error', e?.message || 'Could not open external app.');
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  floatingHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  topFadeScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: -64,
  },
  floatingComposerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  bottomFadeScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -60,
    bottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 11,
    borderBottomWidth: 0,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(32, 32, 38, 0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerProfileTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  headerAvatarContainer: {
    marginRight: 10,
    position: 'relative',
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerOnlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#101010',
  },
  avatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  headerTitleGroup: {
    flex: 1,
    justifyContent: 'center',
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerPeerName: {
    color: '#F4F4F5',
    fontSize: 16,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerSubtitleText: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 1,
  },
  typingIndicator: {
    fontSize: 12,
    color: '#22C55E',
    marginTop: 1,
  },
  headerActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(32, 32, 38, 0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineBoundary: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyPeerAvatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPeerAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  dateSeparatorContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dateSeparatorPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#141416',
    borderColor: '#262629',
  },
  dateSeparatorText: {
    color: '#8E8E93',
    fontSize: 11,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bubbleRowSelf: {
    justifyContent: 'flex-end',
  },
  bubbleRowPeer: {
    justifyContent: 'flex-start',
  },
  peerBubbleAvatarGutter: {
    width: 30,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  peerBubbleAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2C2C2E',
  },
  peerBubbleAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerBubbleAvatarInitials: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E4E4E7',
  },
  peerBubbleAvatarSpacer: {
    width: 28,
    height: 28,
  },
  dmDetachedReplyWrap: {
    marginBottom: 5,
    maxWidth: '100%',
  },
  dmDetachedReplyWrapSelf: {
    alignItems: 'flex-end',
  },
  dmDetachedReplyWrapPeer: {
    alignItems: 'flex-start',
  },
  dmDetachedReplyLabel: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.65)',
    marginBottom: 4,
    paddingHorizontal: 2,
    fontWeight: '500',
  },
  dmDetachedReplyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  dmDetachedReplyRowSelf: {
    justifyContent: 'flex-end',
  },
  dmDetachedReplyRowPeer: {
    justifyContent: 'flex-start',
  },
  dmDetachedReplyBar: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 28,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
  },
  dmDetachedReplyPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.13)',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  dmDetachedReplyText: {
    fontSize: 13.5,
    color: 'rgba(255, 255, 255, 0.72)',
    lineHeight: 18,
  },
  dmSeenRow: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginRight: 6,
    marginBottom: 2,
  },
  dmSeenText: {
    fontSize: 11.5,
    color: '#A1A1AA',
    fontWeight: '500',
  },
  peerSheetContainer: {
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  peerSheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  peerSheetProfileHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  peerSheetAvatarWrap: {
    position: 'relative',
  },
  peerSheetAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  peerSheetOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2.5,
    borderColor: '#121215',
  },
  peerSheetMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  peerSheetRolePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  peerSheetStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  peerSheetStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  peerQuickGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  peerQuickTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  peerQuickTileActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  peerQuickTileLabel: {
    color: '#F4F4F5',
    fontSize: 11,
    textAlign: 'center',
  },
  peerSheetListGroup: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
    overflow: 'hidden',
  },
  peerSheetListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  peerSheetListLabel: {
    flex: 1,
    marginLeft: 12,
    color: '#F4F4F5',
  },
  bubbleContainer: {
    maxWidth: '76%',
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
  },
  bubbleSelf: {
    borderBottomRightRadius: 6,
  },
  bubblePeer: {
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20.5,
  },
  emojiOnlyText: {
    fontSize: 40,
    lineHeight: 48,
  },
  emojiOnlyTextCompact: {
    fontSize: 32,
    lineHeight: 40,
  },
  floatingRetryPill: {
    backgroundColor: 'rgba(18, 18, 22, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deletedText: {
    fontStyle: 'italic',
    fontSize: 14,
  },
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 9,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 6,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
  },
  editedTag: {
    fontSize: 10,
  },
  timestampText: {
    fontSize: 10.5,
  },
  receiptContainer: {
    marginLeft: 4,
  },
  contextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 10,
    marginTop: 6,
    borderRadius: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginHorizontal: 8,
    marginBottom: 4,
    gap: 8,
    backgroundColor: 'rgba(22, 22, 26, 0.88)',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  composerImageCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(115, 118, 128, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmPreviewThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#27272A',
  },
  dmPreviewFileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 196,
    maxWidth: 256,
    paddingVertical: 2,
  },
  dmFileIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dmFileTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  dmAttachOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
  },
  dmAttachOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#242426',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmImageWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 4,
    position: 'relative',
    backgroundColor: '#18181B',
  },
  dmBubbleImage: {
    width: 220,
    height: 220,
    borderRadius: 18,
  },
  dmImageUploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmActionTimestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  dmActionTimestampText: {
    color: '#A1A1AA',
    fontSize: 12,
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: '#F5F5F5',
    paddingHorizontal: 6,
    paddingTop: 9,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 20,
  },
  charCounter: {
    fontSize: 10,
    marginRight: 4,
    marginBottom: 10,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 1,
  },
  sendButtonActive: {
    backgroundColor: '#FFFFFF',
  },
  sendButtonInactive: {
    backgroundColor: '#242426',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#303034',
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  unblockBannerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  actionSheetHeader: {
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  actionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  actionRowText: {
    marginLeft: 12,
    fontSize: 15,
  },
  reportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  reportModalCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportReasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  reportTextInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginTop: 6,
    marginBottom: 14,
    textAlignVertical: 'top',
  },
  reportModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  reportCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 10,
  },
  reportSubmitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dmSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#121214',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272A',
  },
  dmSearchInput: {
    flex: 1,
    color: '#F4F4F5',
    fontSize: 14,
    paddingVertical: 4,
  },
  dmLinkPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dmQuickReactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  dmQuickReactionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmQuickReactionBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
  },
  dmReactionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
    marginBottom: 2,
  },
  dmReactionPill: {
    backgroundColor: '#1C1C1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2E2E32',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dmSwipeRowWrapper: {
    width: '100%',
    position: 'relative',
  },
  dmSwipeReplyIconBox: {
    position: 'absolute',
    left: 10,
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  themeMiniDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  themePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  themeCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themePreviewBox: {
    height: 128,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    marginBottom: 16,
    justifyContent: 'center',
  },
  themePreviewBubbles: {
    paddingHorizontal: 14,
    gap: 8,
  },
  themePreviewBubble: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 18,
    maxWidth: '78%',
  },
  themeOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  themeOptionCardActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.42)',
  },
  themeSwatchWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  themeSwatchDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
  },
});
