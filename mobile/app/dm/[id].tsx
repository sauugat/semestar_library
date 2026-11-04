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
  Animated,
  PanResponder,
  Text as RNText,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/constants/useTheme';
import { Monochrome } from '@/constants/theme';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_SERVER_URL } from '@/services/api';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
import {
  FluidChatBackground,
  markBubbleTouchStart,
  markBubbleTouchEnd,
  useChatBackSwipeResponder,
} from '@/components/chat/FluidChatBackground';
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

function DmSwipeableBubbleRow({
  disabled,
  onSwipeReply,
  children,
}: {
  disabled?: boolean;
  onSwipeReply: () => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onSwipeReplyRef = useRef(onSwipeReply);
  useEffect(() => {
    onSwipeReplyRef.current = onSwipeReply;
  }, [onSwipeReply]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (disabled) return false;
          const claim =
            gestureState.dx > 10 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4 &&
            Math.abs(gestureState.dy) < 28;
          if (claim) markBubbleTouchStart();
          return claim;
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (disabled) return false;
          const claim =
            gestureState.dx > 10 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4 &&
            Math.abs(gestureState.dy) < 28;
          if (claim) markBubbleTouchStart();
          return claim;
        },
        onPanResponderGrant: () => {
          markBubbleTouchStart();
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (_, gestureState) => {
          markBubbleTouchStart();
          if (gestureState.dx > 0) {
            translateX.setValue(Math.min(gestureState.dx * 0.65, 56));
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          markBubbleTouchEnd();
          if (gestureState.dx > 42 && !disabled) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onSwipeReplyRef.current();
          }
          Animated.spring(translateX, {
            toValue: 0,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          markBubbleTouchEnd();
          Animated.spring(translateX, {
            toValue: 0,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }).start();
        },
      }),
    [disabled, translateX]
  );

  return (
    <View
      style={{ maxWidth: '76%', position: 'relative' }}
      onTouchStart={markBubbleTouchStart}
      onTouchEnd={markBubbleTouchEnd}
      onTouchCancel={markBubbleTouchEnd}
      {...panResponder.panHandlers}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.dmSwipeReplyIconBox,
          {
            opacity: translateX.interpolate({
              inputRange: [0, 22, 42],
              outputRange: [0, 0.7, 1],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                scale: translateX.interpolate({
                  inputRange: [0, 28, 46],
                  outputRange: [0.5, 0.9, 1.08],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        <Ionicons name="arrow-undo" size={15} color="#E4E4E7" />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

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

  // Participant info state
  const [peerInfo, setPeerInfo] = useState<{
    id: string;
    name: string;
    role: string;
    username?: string | null;
    avatarUrl?: string | null;
  }>({
    id: params.peerId || '',
    name: params.peerName || 'Conversation',
    role: params.peerRole || 'Student',
    username: null,
    avatarUrl: params.peerAvatar || params.peerAvatarUrl || null,
  });

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

  const [conversation, setConversation] = useState<DmConversationItem | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Realtime & typing states
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingTypingThrottlerRef = useRef<number>(0);
  const [peerLastReadId, setPeerLastReadId] = useState<number>(0);

  // Composer states with per-conversation draft persistence (Item 50)
  const draftKey = `${currentUserId}:${conversationId}`;
  const [inputText, setInputText] = useState(() => dmDraftCache.get(draftKey) || '');
  const [replyingTo, setReplyingTo] = useState<DmMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [sending, setSending] = useState(false);

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

  const backSwipeHandlers = useChatBackSwipeResponder(handleBack, true);

  // Android hardware back press handler
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        // 1. Modals have top priority
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
    }, [reportModalVisible, settingsModalVisible, selectedActionMessage, handleBack])
  );

  // 1. Identify peer information from cached conversation or load
  useEffect(() => {
    let isMounted = true;
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
        }
        // Always fetch fresh conversations to ensure latest avatarUrl and metadata
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

    return () => {
      isMounted = false;
    };
  }, [conversationId, currentUserId]);

  // Load once on focus, and refresh after reconnect/resume. Never depend on list length.
  const loadMessages = useCallback(async () => {
    if (!conversationId || !currentUserId || loadInFlight.current) return;
    loadInFlight.current = true;
    setError(null);
    try {
      const [cached, outbox] = await Promise.all([
        getCachedDmMessages(currentUserId, conversationId, 50),
        readDmOutbox(currentUserId, conversationId).catch(() => {
          if (activeRef.current) setError('Saved pending messages could not be loaded. Please reopen the conversation.');
          return [];
        }),
      ]);
      if (!activeRef.current) return;
      const restored = outbox.map(m => ({ ...m, status: sendsInFlight.current.has(m.clientId || '') ? 'pending' as const : 'failed' as const }));
      setMessages(prev => mergeDmMessages(mergeDmMessages(cached, restored), prev));
      if (cached.length || restored.length) setLoading(false);
      const res = await fetchDmMessages(conversationId, { limit: 50 });
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
    void loadMessages();
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
  useFocusEffect(useCallback(() => {
    if (!conversationId || !currentUserId) return;
    let connectedNow = false;
    const poll = setInterval(() => {
      if (!connectedNow && AppState.currentState === 'active') void loadMessages();
    }, 15000);
    const unsubscribe = subscribeDmConversationRealtime(conversationId, {
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

    return () => {
      clearInterval(poll);
      unsubscribe();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      // Clean up typing indicator on exit
      void sendDmTyping(conversationId, false);
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

  // 6. Sending a message (optimistic reconciliation)
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || text.length > 2000 || sending) return;

    // Check if in edit mode
    if (editingMessage) {
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
    const tempMessage: DmMessage = {
      id: clientId,
      conversationId,
      senderId: currentUserId,
      clientId,
      text,
      createdAt: new Date().toISOString(),
      status: 'pending',
      replyTo: replyingTo
        ? {
            id: typeof replyingTo.id === 'number' ? replyingTo.id : 0,
            text: replyingTo.text,
            senderId: replyingTo.senderId,
            senderName: replyingTo.senderId === currentUserId ? 'You' : peerInfo.name,
          }
        : null,
    };

    // Optimistically insert to list
    setMessages((prev) => [tempMessage, ...prev]);
    setInputText('');
    dmDraftCache.delete(draftKey);
    setReplyingTo(null);
    requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));

    void transmitMessage(tempMessage);
  };

  // Persist before dispatch. Retries reuse the exact client ID and original content.
  const transmitMessage = async (message: DmMessage) => {
    const clientId = message.clientId;
    if (!clientId || !message.text || sendsInFlight.current.has(clientId)) return;
    sendsInFlight.current.add(clientId);
    const generation = dmOutboxGeneration();
    const pending = { ...message, status: 'pending' as const };
    setMessages(prev => mergeDmMessages(prev, [pending]));
    try {
      await updateDmOutbox(currentUserId, conversationId, pending, generation);
      if (generation !== dmOutboxGeneration()) return;
      const confirmed = await sendDmMessage(conversationId, {
        clientId, text: message.text, replyToId: message.replyTo?.id || null,
      });
      if (generation !== dmOutboxGeneration()) return;
      acknowledgedSends.current.add(clientId);
      if (activeRef.current) setMessages(prev => mergeDmMessages(prev, [confirmed]));
      void saveCachedDmMessages(currentUserId, conversationId, [confirmed]);
      await updateDmOutbox(currentUserId, conversationId, confirmed, generation);
    } catch {
      if (generation !== dmOutboxGeneration()) return;
      const acknowledged = acknowledgedSends.current.has(clientId) || messagesRef.current.some(m => m.clientId === clientId && typeof m.id === 'number');
      if (!acknowledged) {
        if (activeRef.current) setMessages(prev => failDmMessage(prev, clientId));
        await updateDmOutbox(currentUserId, conversationId, { ...message, status: 'failed' }, generation).catch(() => {});
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

  const sharedLinks = useMemo(() => {
    const list: { messageId: number | string; url: string; domain: string; createdAt: string }[] = [];
    for (const m of messages) {
      if (m.deletedForAll || !m.text) continue;
      const info = extractFirstDmUrl(m.text);
      if (info) {
        list.push({ messageId: m.id, url: info.url, domain: info.domain, createdAt: m.createdAt });
      }
    }
    return list;
  }, [messages]);

  const starredMessages = useMemo(
    () => messages.filter((m) => starredIds.has(m.id) && !m.deletedForAll),
    [messages, starredIds]
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

  // Render individual message bubble
  const renderMessageItem = ({ item, index }: { item: DmMessage; index: number }) => {
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

          <DmSwipeableBubbleRow
            disabled={isDeleted || typeof item.id !== 'number'}
            onSwipeReply={() => {
              if (!isDeleted && typeof item.id === 'number') {
                setReplyingTo(item);
                setEditingMessage(null);
              }
            }}
          >
          <Pressable
            onLongPress={() => handleOpenActionSheet(item)}
            delayLongPress={250}
            style={[
              styles.bubbleContainer,
              { maxWidth: '100%' },
              isSelf
                ? [
                    styles.bubbleSelf,
                    {
                      backgroundColor: Monochrome.outgoingBubble,
                      borderColor: 'rgba(255, 255, 255, 0.16)',
                      borderWidth: StyleSheet.hairlineWidth,
                      borderTopRightRadius: isFirstInGroup ? 18 : 4,
                      borderBottomRightRadius: isLastInGroup ? (isFirstInGroup ? 18 : 4) : 4,
                      borderTopLeftRadius: 20,
                      borderBottomLeftRadius: 20,
                    },
                  ]
                : [
                    styles.bubblePeer,
                    {
                      backgroundColor: 'rgba(14, 14, 18, 0.92)',
                      borderColor: 'rgba(255, 255, 255, 0.09)',
                      borderTopLeftRadius: isFirstInGroup ? 18 : 4,
                      borderBottomLeftRadius: isLastInGroup ? (isFirstInGroup ? 18 : 4) : 4,
                      borderTopRightRadius: 20,
                      borderBottomRightRadius: 20,
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
                  { backgroundColor: 'rgba(255, 255, 255, 0.18)', borderRadius: 18, zIndex: 5 },
                ]}
              />
            )}

            {/* Reply Quote Banner */}
            {item.replyTo && (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => item.replyTo && handleJumpToReply(item.replyTo.id)}
                style={[
                  styles.replyQuote,
                  {
                    backgroundColor: isSelf ? 'rgba(0,0,0,0.06)' : Monochrome.surface,
                    borderLeftColor: isSelf ? Monochrome.outgoingText : Monochrome.textTertiary,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="600"
                  style={{ color: isSelf ? Monochrome.outgoingText : Monochrome.text, marginBottom: 2 }}
                >
                  {item.replyTo.senderName || 'Replying'}
                </Text>
                <Text
                  variant="xs"
                  numberOfLines={1}
                  style={{ color: isSelf ? Monochrome.outgoingMeta : Monochrome.textTertiary }}
                >
                  {item.replyTo.deletedForAll ? 'Original message deleted' : item.replyTo.text || 'Message'}
                </Text>
              </TouchableOpacity>
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
                {renderDmTextWithLinks(
                  item.text || '',
                  isSelf,
                  [
                    styles.bubbleText,
                    { color: isSelf ? Monochrome.outgoingText : Monochrome.incomingText },
                  ]
                )}
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

            {/* Footer: Starred, Timestamp, Edited tag, Read receipt */}
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
                  edited ·{' '}
                </Text>
              )}
              <Text
                variant="xs"
                style={[
                  styles.timestampText,
                  { color: isSelf ? Monochrome.outgoingMeta : Monochrome.incomingMeta },
                ]}
              >
                {formatBubbleTime(item.createdAt)}
              </Text>

              {/* Status indicators for self messages */}
              {isSelf && (
                <View style={styles.receiptContainer}>
                  {item.status === 'pending' ? (
                    <Ionicons name="time-outline" size={12} color={Monochrome.outgoingMeta} />
                  ) : item.status === 'failed' ? (
                    <TouchableOpacity accessibilityLabel="Retry failed message" onPress={() => void handleRetry(item)} hitSlop={6}>
                      <Text variant="xs" style={{ color: Monochrome.outgoingText }}>Retry</Text>
                    </TouchableOpacity>
                  ) : isSeen ? (
                    <Ionicons name="checkmark-done" size={14} color={Monochrome.outgoingText} />
                  ) : (
                    <Ionicons name="checkmark" size={13} color={Monochrome.outgoingMeta} />
                  )}
                </View>
              )}
            </View>
          </Pressable>
          </DmSwipeableBubbleRow>
        </View>

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
  };

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
    <View style={[styles.container, { backgroundColor: Monochrome.background }]}>
      <StatusBar barStyle="light-content" />
      <FluidChatBackground />

      {/* Top Header (floating glass controls over fluid background, base Monochrome.header) */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 10),
            backgroundColor: 'rgba(10, 10, 14, 0.38)',
            borderBottomColor: 'rgba(255, 255, 255, 0.06)',
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

        {/* Peer Avatar & Profile Link */}
        <TouchableOpacity
          activeOpacity={0.75}
          disabled={!peerInfo.id}
          onPress={() => {
            if (peerInfo.id) {
              router.push({ pathname: '/user/[id]', params: { id: peerInfo.id } } as any);
            }
          }}
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

      {/* Main Timeline wrapped in KeyboardContentBoundary (swipe right outside bubble goes back to inbox) */}
      <View style={{ flex: 1 }} {...backSwipeHandlers}>
      <KeyboardContentBoundary style={styles.timelineBoundary}>
        {loading && messages.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={Monochrome.textSecondary} />
          </View>
        ) : error && messages.length === 0 ? (
          <View style={styles.centerContainer}>
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
          <View style={styles.centerContainer}>
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
              keyExtractor={(item) => item.clientId ? `${item.senderId}:${item.clientId}` : String(item.id)}
              inverted
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
                  <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8 }}>
                    <View style={{ alignSelf: 'flex-start', backgroundColor: Monochrome.incomingBubble, borderColor: Monochrome.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text variant="xs" weight="500" style={{ color: '#10b981' }}>
                        {peerInfo.name} is typing…
                      </Text>
                    </View>
                  </View>
                ) : undefined
              }
              ListFooterComponent={
                loadingOlder ? (
                  <View style={{ paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color={Monochrome.textSecondary} />
                  </View>
                ) : undefined
              }
              contentContainerStyle={styles.listContent}
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
                  bottom: 14,
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

      {/* Message Composer or Blocked Banner */}
      {isBlocked ? (
        <View
          style={[
            styles.blockedBanner,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.borderSubtle,
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

          {/* Input Row — Modern Floating Pill Capsule matching screenshot */}
          <View style={styles.composerRow}>
            <View style={styles.composerCameraCircle}>
              <Ionicons name="camera" size={18} color="#FFFFFF" />
            </View>

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

            {!inputText.trim() && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="mic-outline" size={20} color="#F4F4F5" />
                <Ionicons name="image-outline" size={20} color="#F4F4F5" />
                <Ionicons name="chatbubble-ellipses-outline" size={19} color="#F4F4F5" />
              </View>
            )}

            <TouchableOpacity
              onPress={inputText.trim() ? handleSend : () => setSettingsModalVisible(true)}
              disabled={sending}
              style={[
                styles.sendButton,
                {
                  backgroundColor: inputText.trim() ? Monochrome.outgoingBubble : Monochrome.surfaceRaised,
                },
                inputText.trim() ? styles.sendButtonActive : styles.sendButtonInactive,
              ]}
              accessibilityLabel={editingMessage ? 'Save edited message' : 'Send message'}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : inputText.trim() ? (
                <Ionicons
                  name={editingMessage ? 'checkmark' : 'arrow-up'}
                  size={19}
                  color="#09090B"
                />
              ) : (
                <Ionicons name="add-circle-outline" size={22} color="#F4F4F5" />
              )}
            </TouchableOpacity>
          </View>
        </StickyComposer>
      )}

      {/* Message Action Sheet / Context Modal */}
      <Modal
        visible={Boolean(selectedActionMessage)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedActionMessage(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSelectedActionMessage(null)}
        >
          <View
            style={[
              styles.actionSheetContent,
              { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
            ]}
          >
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
          </View>
        </Pressable>
      </Modal>

      {/* Conversation Settings Modal (Items 14, 30, 55, 86, 100) */}
      <Modal
        visible={settingsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSettingsModalVisible(false)}
        >
          <View
            style={[
              styles.actionSheetContent,
              { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
            ]}
          >
            <Text variant="sm" weight="700" style={[styles.actionSheetHeader, { color: colors.textMuted }]}>
              CONVERSATION OPTIONS
            </Text>

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
          </View>
        </Pressable>
      </Modal>

      {/* Shared Links & Starred Messages Modal (Items 30 & 86) */}
      <Modal
        visible={subPanel !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSubPanel(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSubPanel(null)}>
          <View
            style={[
              styles.actionSheetContent,
              { backgroundColor: colors.surface, borderColor: colors.borderSubtle, maxHeight: 420 },
            ]}
          >
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
          </View>
        </Pressable>
      </Modal>

      {/* Report Modal */}
      <Modal
        visible={reportModalVisible}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  bubbleContainer: {
    maxWidth: '76%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 7,
  },
  bubbleSelf: {
    borderBottomRightRadius: 5,
  },
  bubblePeer: {
    borderBottomLeftRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20.5,
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
  composerCameraCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(115, 118, 128, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
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
    borderBottomColor: '#27272A',
  },
  dmQuickReactionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmQuickReactionBtnActive: {
    backgroundColor: '#2E2E32',
    borderWidth: 1,
    borderColor: '#52525B',
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
});
