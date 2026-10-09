import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';
import { Monochrome } from '@/constants/theme';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
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
} from '@/services/dm-db';
import { mergeDmMessages, failDmMessage, createReadCoalescer } from '@/services/dm-state';
import { readDmOutbox, updateDmOutbox, dmOutboxGeneration } from '@/services/dm-outbox';
import { subscribeDmConversationRealtime } from '@/services/dm-realtime';

function createDmClientId() {
  return `dm_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

export default function DmConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  return <DmConversation key={`${user?.studentId || ''}:${id}`} />;
}

function DmConversation() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.studentId || '';

  const params = useLocalSearchParams<{
    id: string;
    peerName?: string;
    peerRole?: string;
    peerAvatar?: string;
    peerId?: string;
    targetMessageId?: string;
  }>();

  const conversationId = params.id;
  const activeRef = useRef(false);
  const nearBottomRef = useRef(true);
  const messagesRef = useRef<DmMessage[]>([]);
  const loadInFlight = useRef(false);
  const sendsInFlight = useRef(new Set<string>());
  const acknowledgedSends = useRef(new Set<string>());
  const readQueueRef = useRef<ReturnType<typeof createReadCoalescer> | null>(null);
  const markIncomingRead = useCallback((items: DmMessage[]) => {
    if (!activeRef.current || !nearBottomRef.current || AppState.currentState !== 'active') return;
    const newest = Math.max(0, ...items.filter(m => m.senderId !== currentUserId && typeof m.id === 'number').map(m => Number(m.id)));
    readQueueRef.current?.request(newest);
  }, [currentUserId]);

  // Participant info state
  const [peerInfo, setPeerInfo] = useState<{
    id: string;
    name: string;
    role: string;
    avatarUrl?: string | null;
  }>({
    id: params.peerId || '',
    name: params.peerName || 'Conversation',
    role: params.peerRole || 'Student',
    avatarUrl: params.peerAvatar || null,
  });

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

  // Composer states
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<DmMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [sending, setSending] = useState(false);

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
          if (match.participant) {
            setPeerInfo({
              id: match.participant.studentId,
              name: match.participant.name,
              role: match.participant.role || 'Student',
              avatarUrl: match.participant.avatarUrl || null,
            });
          }
        } else {
          // Fetch fresh list to find this conversation
          const fresh = await fetchDmConversations(50);
          const found = fresh.find((c) => c.id === conversationId);
          if (found && isMounted) {
            setConversation(found);
            if (found.participant) {
              setPeerInfo({
                id: found.participant.studentId,
                name: found.participant.name,
                role: found.participant.role || 'Student',
                avatarUrl: found.participant.avatarUrl || null,
              });
            }
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

  useFocusEffect(useCallback(() => {
    activeRef.current = true;
    const readQueue = createReadCoalescer(id => activeRef.current && AppState.currentState === 'active'
      ? markDmConversationRead(conversationId, id) : Promise.reject(new Error('Conversation is inactive')));
    readQueueRef.current = readQueue;
    void loadMessages();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void loadMessages();
    });
    return () => { activeRef.current = false; readQueue.stop(); readQueueRef.current = null; sub.remove(); };
  }, [loadMessages, conversationId]));

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

  // 5. Handling outgoing typing indicator (throttled to 2.5s)
  const handleInputChange = (text: string) => {
    setInputText(text);
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
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? updated : m))
        );
        void updateCachedDmMessage(currentUserId, conversationId, updated);
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

  // 8. Message actions: Copy, Reply, Edit, Delete for me, Delete for everyone, Report
  const handleOpenActionSheet = (msg: DmMessage) => {
    if (typeof msg.id !== 'number') return;
    setSelectedActionMessage(msg);
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

  // 9. Conversation settings: Clear, Block/Unblock, Report
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

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparatorContainer}>
            <View style={[styles.dateSeparatorPill, { backgroundColor: '#141414', borderColor: '#282828' }]}>
              <Text variant="xs" weight="500" style={{ color: '#737373' }}>
                {formatDateSeparator(item.createdAt)}
              </Text>
            </View>
          </View>
        )}

        <Pressable
          onLongPress={() => handleOpenActionSheet(item)}
          delayLongPress={250}
          style={[
            styles.bubbleRow,
            isSelf ? styles.bubbleRowSelf : styles.bubbleRowPeer,
            {
              marginTop: isFirstInGroup ? 10 : 2,
              marginBottom: 2,
            },
          ]}
        >
          <View
            style={[
              styles.bubbleContainer,
              isSelf
                ? [
                    styles.bubbleSelf,
                    {
                      backgroundColor: Monochrome.outgoingBubble,
                      borderTopRightRadius: isFirstInGroup ? 18 : 4,
                      borderBottomRightRadius: isLastInGroup ? (isFirstInGroup ? 18 : 4) : 4,
                      borderTopLeftRadius: 18,
                      borderBottomLeftRadius: 18,
                    },
                  ]
                : [
                    styles.bubblePeer,
                    {
                      backgroundColor: Monochrome.incomingBubble,
                      borderColor: Monochrome.border,
                      borderTopLeftRadius: isFirstInGroup ? 18 : 4,
                      borderBottomLeftRadius: isLastInGroup ? (isFirstInGroup ? 18 : 4) : 4,
                      borderTopRightRadius: 18,
                      borderBottomRightRadius: 18,
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
              <Text
                variant="sm"
                style={[
                  styles.bubbleText,
                  { color: isSelf ? Monochrome.outgoingText : Monochrome.incomingText },
                ]}
              >
                {item.text}
              </Text>
            )}

            {/* Footer: Timestamp, Edited tag, Read receipt */}
            <View style={styles.bubbleFooter}>
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
          </View>
        </Pressable>
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

      {/* Top Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 10),
            backgroundColor: Monochrome.header,
            borderBottomColor: Monochrome.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        {/* Peer Avatar */}
        <View style={styles.headerAvatarContainer}>
          {peerInfo.avatarUrl ? (
            <Image
              source={{ uri: peerInfo.avatarUrl }}
              style={styles.headerAvatar}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.headerAvatar,
                styles.avatarFallback,
                { backgroundColor: colors.surfaceRaised },
              ]}
            >
              <Text variant="sm" weight="700" style={{ color: colors.text }}>
                {getInitials(peerInfo.name)}
              </Text>
            </View>
          )}
        </View>

        {/* Peer Name & Subtitle (Role / Typing) */}
        <View style={styles.headerTitleGroup}>
          <View style={styles.headerNameRow}>
            <Text variant="md" weight="700" numberOfLines={1} style={{ color: colors.text }}>
              {peerInfo.name}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: Monochrome.surfaceElevated, borderColor: Monochrome.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <Text variant="xs" weight="600" style={{ color: Monochrome.textSecondary }}>
                {peerInfo.role}
              </Text>
            </View>
          </View>

          {peerIsTyping ? (
            <Text variant="xs" weight="600" style={styles.typingIndicator}>
              typing...
            </Text>
          ) : !realtimeConnected ? (
            <Text variant="xs" style={{ color: Monochrome.textSecondary }}>Live updates unavailable · checking periodically</Text>
          ) : null}
        </View>

        {/* Conversation Settings Button */}
        <TouchableOpacity
          onPress={() => setSettingsModalVisible(true)}
          style={styles.headerActionBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Conversation options"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Main Timeline wrapped in KeyboardContentBoundary */}
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
            <Ionicons name="chatbubbles-outline" size={44} color={colors.textMuted} />
            <Text variant="md" weight="600" style={{ color: colors.text, marginTop: 12 }}>
              No messages yet
            </Text>
            <Text variant="sm" style={{ color: colors.textMuted, marginTop: 4, textAlign: 'center' }}>
              Send a message to start chatting with {peerInfo.name}.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessageItem}
            keyExtractor={(item) => item.clientId ? `${item.senderId}:${item.clientId}` : String(item.id)}
            inverted
            scrollEventThrottle={100}
            onScroll={event => {
              nearBottomRef.current = event.nativeEvent.contentOffset.y < 80;
              if (nearBottomRef.current) markIncomingRead(messagesRef.current);
            }}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
            onScrollToIndexFailed={({ averageItemLength, index }) => {
              flatListRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true });
            }}
            onEndReached={loadOlderMessages}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingOlder ? (
                <View style={{ paddingVertical: 12 }}>
                  <ActivityIndicator size="small" color={Monochrome.textSecondary} />
                </View>
              ) : null
            }
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="on-drag"
          />
        )}
      </KeyboardContentBoundary>

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
        <StickyComposer bordered>
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

          {/* Input Row */}
          <View style={styles.composerRow}>
            <TextInput
              style={[
                styles.composerInput,
                {
                  backgroundColor: Monochrome.composerInput,
                  color: Monochrome.composerText,
                  borderColor: Monochrome.border,
                },
              ]}
              placeholder="Message..."
              placeholderTextColor={Monochrome.composerPlaceholder}
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
              disabled={!inputText.trim() || sending}
              style={[
                styles.sendButton,
                {
                  backgroundColor: inputText.trim() ? Monochrome.outgoingBubble : Monochrome.surfaceRaised,
                  opacity: inputText.trim() ? 1 : 0.4,
                },
              ]}
              accessibilityLabel={editingMessage ? 'Save edited message' : 'Send message'}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Monochrome.outgoingText} />
              ) : (
                <Ionicons
                  name={editingMessage ? 'checkmark' : 'arrow-up'}
                  size={20}
                  color={inputText.trim() ? Monochrome.outgoingText : Monochrome.textTertiary}
                />
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
            <TouchableOpacity style={styles.actionSheetRow} onPress={handleCopyMessage}>
              <Ionicons name="copy-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                Copy Text
              </Text>
            </TouchableOpacity>

            {!selectedActionMessage?.deletedForAll && (
              <TouchableOpacity style={styles.actionSheetRow} onPress={handleStartReply}>
                <Ionicons name="arrow-undo-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={[styles.actionRowText, { color: colors.text }]}>
                  Reply
                </Text>
              </TouchableOpacity>
            )}

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

      {/* Conversation Settings Modal */}
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
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  backButton: {
    padding: 6,
    marginRight: 4,
  },
  headerAvatarContainer: {
    marginRight: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleGroup: {
    flex: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  typingIndicator: {
    fontSize: 11,
    color: Monochrome.textSecondary,
    marginTop: 1,
  },
  headerActionBtn: {
    padding: 8,
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
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateSeparatorContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dateSeparatorPill: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#141414',
    borderColor: '#282828',
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowSelf: {
    justifyContent: 'flex-end',
  },
  bubbleRowPeer: {
    justifyContent: 'flex-start',
  },
  bubbleContainer: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 7,
  },
  bubbleSelf: {
    borderBottomRightRadius: 4,
  },
  bubblePeer: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
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
    paddingLeft: 8,
    paddingVertical: 4,
    borderRadius: 4,
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
    fontSize: 10,
  },
  receiptContainer: {
    marginLeft: 4,
  },
  contextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 6,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  charCounter: {
    fontSize: 10,
    marginRight: 6,
    marginBottom: 10,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
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
});
