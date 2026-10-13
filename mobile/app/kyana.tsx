import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  Alert,
  Keyboard,
  StatusBar,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { Text } from '@/components/ui/Typography';
import { Monochrome } from '@/constants/theme';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { PostMarkdown } from '@/components/PostMarkdown';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
import {
  fetchKyanaConversations,
  fetchKyanaConversationMessages,
  sendKyanaMessage,
  clearKyanaConversation,
  createKyanaConversation,
  type KyanaMessage,
  type KyanaConversation,
  type KyanaResourceCard,
} from '@/services/kyana';
import {
  getCachedKyanaMessages,
  saveCachedKyanaMessages,
  clearCachedKyanaMessages,
} from '@/services/kyana-db';

const QUICK_SUGGESTIONS = [
  { label: '📚 Find Math notes', prompt: 'Give me notes on Engineering Mathematics' },
  { label: '📖 What is in Semester 3?', prompt: "What's in semester 3 syllabus?" },
  { label: '📅 When is the next exam?', prompt: "When's the next exam routine?" },
  { label: '💻 Explain binary search', prompt: 'Explain binary search with a clean C code example' },
];

function formatBubbleTime(isoString?: string | null): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateSeparator(isoString?: string | null): string {
  if (!isoString) return '';
  const d = new Date(isoString);
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
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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

/**
 * 3-dot Animated Typing Indicator matching premium messaging apps.
 */
function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 360,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 360,
            useNativeDriver: true,
          }),
        ])
      );

    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 140);
    const a3 = pulse(dot3, 280);

    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingDotsContainer}>
      <Animated.View style={[styles.typingDot, { opacity: dot1 }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot2 }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot3 }]} />
    </View>
  );
}

export default function KyanaChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const studentId = user?.studentId || 'guest';

  // State
  const [conversation, setConversation] = useState<KyanaConversation | null>(null);
  const [messages, setMessages] = useState<KyanaMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // References
  const flatListRef = useRef<FlatList<any>>(null);
  const inputRef = useRef<TextInput>(null);
  const activeAbortController = useRef<AbortController | null>(null);
  const isNearBottomRef = useRef(true);
  const messagesRef = useRef<KyanaMessage[]>([]);
  messagesRef.current = messages;

  // Inverted data: newest messages are at index 0 (the bottom of the list)
  const invertedMessages = useMemo(() => {
    return [...messages].reverse();
  }, [messages]);

  // Toast trigger
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(cur => (cur === msg ? null : cur));
    }, 1800);
  }, []);

  // 1. Load active conversation and cached/server messages
  useEffect(() => {
    let isMounted = true;

    async function initConversation() {
      try {
        setIsLoadingInitial(true);

        // Fetch conversations from server
        const convList = await fetchKyanaConversations();
        let activeConv = convList.length > 0 ? convList[0] : null;

        if (!activeConv) {
          activeConv = await createKyanaConversation('Chat with Kyana');
        }

        if (!isMounted) return;
        setConversation(activeConv);

        if (activeConv) {
          // Load local offline SQLite cache first for instant render
          try {
            const cached = await getCachedKyanaMessages(studentId, activeConv.id);
            if (cached.length > 0 && isMounted) {
              setMessages(cached);
            }
          } catch (_) {}

          // Refresh with authoritative server messages
          try {
            const data = await fetchKyanaConversationMessages(activeConv.id);
            if (isMounted && data?.messages) {
              setMessages(data.messages);
              await saveCachedKyanaMessages(studentId, activeConv.id, data.messages);
            }
          } catch (_) {}
        }
      } catch (err: any) {
        console.warn('[Kyana] Initialization warning:', err?.message || err);
      } finally {
        if (isMounted) setIsLoadingInitial(false);
      }
    }

    void initConversation();

    return () => {
      isMounted = false;
      if (activeAbortController.current) {
        activeAbortController.current.abort();
      }
    };
  }, [studentId]);

  // 2. Send message handler
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const textToSend = (textOverride || inputText).trim();
      if (!textToSend || isGenerating) return;

      setInputText('');
      Keyboard.dismiss();

      const userMsgId = `local_user_${Date.now()}`;
      const userMsg: KyanaMessage = {
        id: userMsgId,
        conversationId: conversation?.id || 'default',
        sender: 'user',
        text: textToSend,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };

      // Optimistically append user message to messages state
      setMessages(prev => [...prev, userMsg]);

      // Ensure view is scrolled to latest
      isNearBottomRef.current = true;
      setShowScrollBottom(false);

      setIsGenerating(true);
      setStreamingText('');

      const controller = new AbortController();
      activeAbortController.current = controller;

      try {
        // Build recent conversation context for model
        const historyPayload = messagesRef.current.slice(-10).map(m => ({
          role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.text,
        }));

        let accumulatedStream = '';
        const finalResponse = await sendKyanaMessage({
          message: textToSend,
          conversationId: conversation?.id,
          history: historyPayload,
          onDelta: (deltaText: string) => {
            accumulatedStream += deltaText;
            setStreamingText(accumulatedStream);
          },
          signal: controller.signal,
        });

        const assistantMsgId = `asst_${Date.now()}`;
        const assistantMsg: KyanaMessage = {
          id: assistantMsgId,
          conversationId: finalResponse.conversationId || conversation?.id || 'default',
          sender: 'assistant',
          text: finalResponse.reply || accumulatedStream || 'I could not generate a reply.',
          metadata: finalResponse,
          createdAt: new Date().toISOString(),
          status: 'sent',
        };

        setMessages(prev => {
          const updated = [...prev, assistantMsg];
          if (conversation?.id) {
            void saveCachedKyanaMessages(studentId, conversation.id, updated);
          }
          return updated;
        });

        if (finalResponse.conversationId && (!conversation || conversation.id !== finalResponse.conversationId)) {
          setConversation(prev =>
            prev
              ? { ...prev, id: finalResponse.conversationId! }
              : {
                  id: finalResponse.conversationId!,
                  title: 'Chat with Kyana',
                  studentId,
                  lastMessage: null,
                  lastMessageAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
          );
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || controller.signal.aborted) {
          if (streamingText.trim()) {
            const stoppedMsg: KyanaMessage = {
              id: `asst_stopped_${Date.now()}`,
              conversationId: conversation?.id || 'default',
              sender: 'assistant',
              text: streamingText.trim(),
              createdAt: new Date().toISOString(),
              status: 'sent',
            };
            setMessages(prev => [...prev, stoppedMsg]);
          }
        } else {
          console.error('[Kyana Send Error]', err);
          const errorMsg: KyanaMessage = {
            id: `err_${Date.now()}`,
            conversationId: conversation?.id || 'default',
            sender: 'assistant',
            text: 'I couldn’t complete that response. Please check your network and tap retry.',
            createdAt: new Date().toISOString(),
            status: 'error',
          };
          setMessages(prev => [...prev, errorMsg]);
        }
      } finally {
        setIsGenerating(false);
        setStreamingText('');
        activeAbortController.current = null;
      }
    },
    [inputText, isGenerating, conversation, studentId, streamingText]
  );

  // 3. Stop response generation
  const handleStopGeneration = useCallback(() => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
  }, []);

  // 4. Retry / regenerate response
  const handleRegenerate = useCallback(async () => {
    if (isGenerating || messages.length === 0) return;

    // Find the last user query
    const lastUserMsg = [...messages].reverse().find(m => m.sender === 'user');
    if (!lastUserMsg) return;

    // If the last message is an error or assistant response, prune it
    setMessages(prev => {
      const copy = [...prev];
      if (copy.length > 0 && copy[copy.length - 1].sender === 'assistant') {
        copy.pop();
      }
      return copy;
    });

    void handleSend(lastUserMsg.text);
  }, [isGenerating, messages, handleSend]);

  // 5. Copy single message
  const handleCopyMessage = useCallback(async (msg: KyanaMessage) => {
    try {
      await Clipboard.setStringAsync(msg.text);
      await Haptics.selectionAsync();
      showToast('Copied to clipboard');
    } catch (_) {}
  }, [showToast]);

  // 6. Copy entire conversation
  const handleCopyAll = useCallback(async () => {
    setShowOptionsMenu(false);
    if (messages.length === 0) {
      showToast('No messages to copy');
      return;
    }
    const formatted = messages
      .map(m => `${m.sender === 'user' ? 'Student' : 'Kyana AI'} (${formatBubbleTime(m.createdAt)}):\n${m.text}`)
      .join('\n\n');
    await Clipboard.setStringAsync(formatted);
    await Haptics.selectionAsync();
    showToast('Conversation copied to clipboard');
  }, [messages, showToast]);

  // 7. Clear conversation
  const handleClear = useCallback(() => {
    setShowOptionsMenu(false);
    Alert.alert(
      'Clear Conversation',
      'Are you sure you want to delete all messages in this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            if (conversation?.id) {
              try {
                await clearKyanaConversation(conversation.id);
                await clearCachedKyanaMessages(studentId, conversation.id);
              } catch (_) {}
            }
            setMessages([]);
            setStreamingText('');
            showToast('Conversation cleared');
          },
        },
      ]
    );
  }, [conversation, showToast]);

  // 8. Start fresh new conversation
  const handleStartNew = useCallback(async () => {
    setShowOptionsMenu(false);
    try {
      const newConv = await createKyanaConversation('Chat with Kyana');
      setConversation(newConv);
      setMessages([]);
      setStreamingText('');
      showToast('New conversation started');
    } catch (_) {}
  }, [showToast]);

  // Handle resource card navigation
  const handleCardPress = useCallback((card: KyanaResourceCard) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (card.mobileRoute) {
        router.push(card.mobileRoute as any);
        return;
      }
      if (card.type === 'note') {
        router.push(`/material/${card.id}` as any);
      } else if (card.type === 'notice') {
        router.push(`/notice/${card.id}` as any);
      } else if (card.type === 'post') {
        router.push(`/post/${card.id}` as any);
      } else if (card.type === 'routine') {
        router.push('/routine' as any);
      }
    } catch (err: any) {
      console.warn('[Kyana] Navigation error:', err?.message);
    }
  }, [router]);

  // Inverted message item renderer
  const renderItem = useCallback(
    ({ item, index }: { item: KyanaMessage; index: number }) => {
      const isUser = item.sender === 'user';
      // In inverted array, the message chronologically preceding `item` is at index + 1
      const prevChronological = invertedMessages[index + 1];
      const showDate = !prevChronological || !isSameDay(prevChronological.createdAt, item.createdAt);
      const isLatestAssistant = !isUser && index === 0 && !isGenerating;
      const isError = item.status === 'error';

      const resourceCards: KyanaResourceCard[] = (!isUser && item.metadata)
        ? ((Array.isArray(item.metadata.resourceCards) && item.metadata.resourceCards.length > 0)
          ? item.metadata.resourceCards
          : [
              ...(item.metadata.matchedFiles || []).map((f: any) => ({
                type: 'note' as const,
                id: f.id,
                title: f.title || f.originalName,
                subject: f.subject,
                semester: f.semester,
                action: 'open_note' as const,
                mobileRoute: `/material/${f.id}`,
              })),
              ...(item.metadata.matchedNotices || []).map((n: any) => ({
                type: 'notice' as const,
                id: n.id,
                title: n.title,
                action: 'view_notice' as const,
                mobileRoute: `/notice/${n.id}`,
              })),
              ...(item.metadata.matchedPosts || []).map((p: any) => ({
                type: 'post' as const,
                id: p.id,
                title: p.title,
                action: 'view_post' as const,
                mobileRoute: `/post/${p.id}`,
              })),
              ...(item.metadata.matchedAssignments || []).map((a: any) => ({
                type: 'assignment' as const,
                id: a.id,
                title: a.title,
                subject: a.subject,
                action: 'view_assignment' as const,
                mobileRoute: `/assignments/${a.id}`,
              })),
            ])
        : [];

      return (
        <View style={styles.messageRowWrapper}>
          {showDate && (
            <View style={styles.dateSeparatorRow}>
              <View style={styles.dateSeparatorLine} />
              <Text style={styles.dateSeparatorText}>
                {formatDateSeparator(item.createdAt)}
              </Text>
              <View style={styles.dateSeparatorLine} />
            </View>
          )}

          <View
            style={[
              styles.bubbleRow,
              isUser ? styles.userBubbleRow : styles.assistantBubbleRow,
            ]}
          >
            {/* Assistant Avatar */}
            {!isUser && (
              <View style={styles.assistantAvatarSmall}>
                <Ionicons name="sparkles" size={12} color="#FFFFFF" />
              </View>
            )}

            {/* Bubble */}
            <TouchableOpacity
              activeOpacity={0.92}
              onLongPress={() => void handleCopyMessage(item)}
              delayLongPress={280}
              style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble,
                isError && styles.errorBubble,
              ]}
            >
              {isUser ? (
                <Text style={styles.userBubbleText}>
                  {item.text}
                </Text>
              ) : (
                <View style={styles.markdownWrapper}>
                  <PostMarkdown content={item.text} />
                  {resourceCards.length > 0 && (
                    <View style={styles.resourceCardsContainer}>
                      {resourceCards.map((card, cIdx) => {
                        const iconName = card.type === 'note'
                          ? 'document-text-outline'
                          : card.type === 'notice'
                          ? 'megaphone-outline'
                          : card.type === 'assignment' || card.type === 'post_assignment'
                          ? 'code-slash-outline'
                          : card.type === 'routine'
                          ? 'calendar-outline'
                          : 'chatbubbles-outline';

                        const typeLabel = card.type === 'note'
                          ? 'STUDY NOTE'
                          : card.type === 'notice'
                          ? 'CAMPUS NOTICE'
                          : card.type === 'assignment' || card.type === 'post_assignment'
                          ? 'ASSIGNMENT'
                          : card.type === 'routine'
                          ? 'ROUTINE'
                          : 'COMMUNITY';

                        const actionText = card.type === 'note'
                          ? 'Open Note'
                          : card.type === 'notice'
                          ? 'View Notice'
                          : card.type === 'assignment' || card.type === 'post_assignment'
                          ? 'View Assignment'
                          : card.type === 'routine'
                          ? 'View Routine'
                          : 'View Post';

                        return (
                          <TouchableOpacity
                            key={`rc-${card.type}-${card.id}-${cIdx}`}
                            activeOpacity={0.8}
                            onPress={() => handleCardPress(card)}
                            style={styles.resourceCard}
                          >
                            <View style={styles.resourceCardHeader}>
                              <View style={styles.resourceCardBadge}>
                                <Ionicons name={iconName as any} size={11} color="#D4D4D8" />
                                <Text style={styles.resourceCardBadgeText}>{typeLabel}</Text>
                              </View>
                              {Boolean(card.subject) && (
                                <Text style={styles.resourceCardSubject} numberOfLines={1}>
                                  {card.subject}
                                </Text>
                              )}
                            </View>
                            <Text style={styles.resourceCardTitle} numberOfLines={2}>
                              {card.title}
                            </Text>
                            <View style={styles.resourceCardActionRow}>
                              <Text style={styles.resourceCardActionText}>{actionText}</Text>
                              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* Bottom Meta Bar */}
              <View
                style={[
                  styles.metaRow,
                  isUser ? styles.userMetaRow : styles.assistantMetaRow,
                ]}
              >
                <Text style={styles.timestampText}>
                  {formatBubbleTime(item.createdAt)}
                </Text>

                {/* Subtle Action Buttons on Assistant Message */}
                {!isUser && (
                  <View style={styles.quickActions}>
                    <TouchableOpacity
                      onPress={() => void handleCopyMessage(item)}
                      style={styles.actionIconBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Copy message"
                    >
                      <Ionicons name="copy-outline" size={13} color="#71717A" />
                    </TouchableOpacity>

                    {(isLatestAssistant || isError) && (
                      <TouchableOpacity
                        onPress={() => void handleRegenerate()}
                        style={styles.actionIconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Regenerate response"
                      >
                        <Ionicons name="reload-outline" size={13} color="#71717A" />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [invertedMessages, isGenerating, handleCopyMessage, handleRegenerate, handleCardPress]
  );

  return (
    <View style={[styles.container, { backgroundColor: Monochrome.background }]}>
      <StatusBar barStyle="light-content" />

      {/* TOP HEADER */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityLabel="Back to chat list"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={21} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <View style={styles.headerAvatar}>
            <Ionicons name="sparkles" size={16} color="#FFFFFF" />
          </View>
          <View style={styles.headerTextCol}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle}>Kyana AI</Text>
              <View style={styles.headerAiPill}>
                <Text style={styles.headerAiPillText}>AI</Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle}>
              {isGenerating ? '✦ Thinking…' : 'Your study companion'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowOptionsMenu(true)}
          style={styles.headerBtn}
          accessibilityLabel="Conversation options"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="ellipsis-vertical" size={19} color="#A1A1AA" />
        </TouchableOpacity>
      </View>

      {/* TOAST FEEDBACK NOTIFICATION */}
      {toastMessage && (
        <View style={styles.toastContainer}>
          <View style={styles.toastCard}>
            <Ionicons name="checkmark-circle" size={15} color="#10B981" />
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </View>
      )}

      {/* MAIN VIEWPORT WRAPPED IN KEYBOARD CONTENT BOUNDARY */}
      <KeyboardContentBoundary style={styles.timelineBoundary}>
        {isLoadingInitial && messages.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#A1A1AA" />
            <Text style={styles.loadingText}>Opening Kyana AI…</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            keyExtractor={item => String(item.id)}
            renderItem={renderItem}
            inverted
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={100}
            onScroll={event => {
              const offsetY = event.nativeEvent.contentOffset.y;
              // In inverted FlatList, offsetY <= 60 indicates user is at the bottom
              const nearBottom = offsetY <= 60;
              isNearBottomRef.current = nearBottom;
              if (showScrollBottom !== !nearBottom) {
                setShowScrollBottom(!nearBottom);
              }
            }}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 60 }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            // In inverted list, ListHeaderComponent sits at index 0 (the bottom)
            ListHeaderComponent={
              isGenerating ? (
                <View style={styles.liveGenerationRow}>
                  <View style={styles.assistantAvatarSmall}>
                    <Ionicons name="sparkles" size={12} color="#FFFFFF" />
                  </View>
                  <View style={[styles.bubble, styles.assistantBubble, styles.streamingBubble]}>
                    {streamingText ? (
                      <View style={styles.markdownWrapper}>
                        <PostMarkdown content={streamingText} />
                      </View>
                    ) : (
                      <TypingDots />
                    )}
                  </View>
                </View>
              ) : null
            }
            // In inverted list, ListFooterComponent sits at the very top of history
            ListFooterComponent={
              messages.length === 0 ? (
                <View style={styles.emptyStateContainer}>
                  <View style={styles.emptyAvatarLarge}>
                    <Ionicons name="sparkles" size={28} color="#FFFFFF" />
                  </View>
                  <Text style={styles.emptyTitle}>Meet Kyana AI</Text>
                  <Text style={styles.emptyDesc}>
                    Your study companion for concepts, syllabus, code syntax, and notes.
                  </Text>

                  <View style={styles.suggestionsContainer}>
                    <Text style={styles.suggestionsTitle}>QUICK QUESTIONS</Text>
                    {QUICK_SUGGESTIONS.map((item, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.suggestionChip}
                        onPress={() => void handleSend(item.prompt)}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.suggestionLabel}>{item.label}</Text>
                        <Ionicons name="arrow-forward" size={14} color="#71717A" />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.historyStartPadding} />
              )
            }
          />
        )}

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottom && (
          <TouchableOpacity
            style={styles.scrollBottomBtn}
            onPress={() => {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            }}
            hitSlop={8}
            activeOpacity={0.85}
            accessibilityLabel="Scroll to bottom"
          >
            <Ionicons name="chevron-down" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </KeyboardContentBoundary>

      {/* DOCKED STICKY COMPOSER */}
      <StickyComposer bordered>
        <View style={styles.composerRow}>
          <TextInput
            ref={inputRef}
            style={styles.composerInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message Kyana..."
            placeholderTextColor={Monochrome.composerPlaceholder}
            multiline
            maxLength={4000}
            editable={!isGenerating}
            onFocus={() => {
              if (isNearBottomRef.current) {
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
            }}
            accessibilityLabel="Message input for Kyana AI"
          />

          {isGenerating ? (
            <TouchableOpacity
              onPress={handleStopGeneration}
              style={[styles.composerActionBtn, styles.stopBtn]}
              accessibilityLabel="Stop response generation"
              hitSlop={8}
            >
              <View style={styles.stopIconSquare} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => void handleSend()}
              disabled={!inputText.trim()}
              style={[
                styles.composerActionBtn,
                styles.sendBtn,
                !inputText.trim() && styles.sendBtnDisabled,
              ]}
              accessibilityLabel="Send message"
              hitSlop={8}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={inputText.trim() ? '#000000' : Monochrome.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>
      </StickyComposer>

      {/* CONVERSATION OPTIONS MODAL SHEET */}
      <Modal
        visible={showOptionsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOptionsMenu(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowOptionsMenu(false)}
        >
          <View
            style={[
              styles.optionsSheet,
              {
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}
          >
            <View style={styles.optionsHandle} />
            <Text style={styles.optionsTitle}>Kyana AI Options</Text>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => void handleStartNew()}
              accessibilityRole="button"
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.optionTextCol}>
                <Text style={styles.optionLabel}>New Conversation</Text>
                <Text style={styles.optionSub}>Start a fresh thread with Kyana</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => void handleCopyAll()}
              accessibilityRole="button"
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.optionTextCol}>
                <Text style={styles.optionLabel}>Copy Conversation</Text>
                <Text style={styles.optionSub}>Copy full chat history as text</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={handleClear}
              accessibilityRole="button"
            >
              <View style={[styles.optionIconBox, styles.destructiveIconBox]}>
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </View>
              <View style={styles.optionTextCol}>
                <Text style={[styles.optionLabel, styles.destructiveLabel]}>
                  Clear Messages
                </Text>
                <Text style={styles.optionSub}>Wipe all messages in current session</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setShowOptionsMenu(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Monochrome.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Monochrome.border,
    backgroundColor: Monochrome.header,
    zIndex: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginLeft: 4,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Monochrome.surfaceElevated,
    borderWidth: 1,
    borderColor: Monochrome.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    alignItems: 'flex-start',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: Monochrome.text,
  },
  headerAiPill: {
    backgroundColor: '#1E1E22',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D2D33',
  },
  headerAiPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A1A1AA',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: Monochrome.textSecondary,
    marginTop: 1,
  },
  timelineBoundary: {
    flex: 1,
    width: '100%',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: Monochrome.textTertiary,
    fontSize: 13,
  },
  messageRowWrapper: {
    marginBottom: 8,
  },
  dateSeparatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    gap: 12,
  },
  dateSeparatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Monochrome.border,
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: '600',
    color: Monochrome.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
  },
  userBubbleRow: {
    justifyContent: 'flex-end',
  },
  assistantBubbleRow: {
    justifyContent: 'flex-start',
  },
  assistantAvatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Monochrome.surfaceElevated,
    borderWidth: 1,
    borderColor: Monochrome.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  userBubble: {
    backgroundColor: Monochrome.outgoingBubble,
    borderBottomRightRadius: 4,
    maxWidth: '82%',
  },
  userBubbleText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    lineHeight: 21,
  },
  assistantBubble: {
    backgroundColor: Monochrome.surface,
    borderWidth: 1,
    borderColor: Monochrome.border,
    borderBottomLeftRadius: 4,
    maxWidth: '92%',
    minWidth: 90,
  },
  streamingBubble: {
    minHeight: 38,
    justifyContent: 'center',
  },
  errorBubble: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1C1917',
  },
  markdownWrapper: {
    marginVertical: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  userMetaRow: {
    justifyContent: 'flex-end',
  },
  assistantMetaRow: {
    justifyContent: 'space-between',
  },
  timestampText: {
    fontSize: 10,
    color: Monochrome.textTertiary,
  },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    padding: 2,
  },
  liveGenerationRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    marginTop: 6,
    marginBottom: 8,
  },
  typingDotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#A1A1AA',
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyAvatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Monochrome.surfaceElevated,
    borderWidth: 1,
    borderColor: Monochrome.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Monochrome.text,
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    color: Monochrome.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
    maxWidth: 280,
  },
  suggestionsContainer: {
    width: '100%',
    gap: 8,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Monochrome.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Monochrome.surface,
    borderWidth: 1,
    borderColor: Monochrome.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionLabel: {
    fontSize: 13,
    color: '#E4E4E7',
    fontWeight: '500',
  },
  historyStartPadding: {
    height: 20,
  },
  scrollBottomBtn: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Monochrome.surfaceElevated,
    borderWidth: 1,
    borderColor: Monochrome.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 20,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Monochrome.composerInput,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Monochrome.border,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minHeight: 44,
    gap: 8,
  },
  composerInput: {
    flex: 1,
    color: Monochrome.composerText,
    fontSize: 14.5,
    lineHeight: 20,
    maxHeight: 110,
    paddingTop: Platform.OS === 'ios' ? 7 : 5,
    paddingBottom: Platform.OS === 'ios' ? 7 : 5,
    paddingLeft: 4,
  },
  composerActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtn: {
    backgroundColor: '#FFFFFF',
  },
  sendBtnDisabled: {
    backgroundColor: Monochrome.surfaceRaised,
  },
  stopBtn: {
    backgroundColor: '#27272A',
  },
  stopIconSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  toastContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: Monochrome.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 5,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  optionsSheet: {
    backgroundColor: Monochrome.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: Monochrome.border,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  optionsHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Monochrome.borderStrong,
    alignSelf: 'center',
    marginBottom: 16,
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Monochrome.text,
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Monochrome.borderSubtle,
    gap: 14,
  },
  optionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Monochrome.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveIconBox: {
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  optionTextCol: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    color: Monochrome.text,
  },
  destructiveLabel: {
    color: '#EF4444',
  },
  optionSub: {
    fontSize: 12,
    color: Monochrome.textSecondary,
    marginTop: 2,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Monochrome.surfaceElevated,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: Monochrome.text,
  },
  resourceCardsContainer: {
    marginTop: 10,
    gap: 8,
    width: '100%',
  },
  resourceCard: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: Monochrome.borderStrong,
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  resourceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  resourceCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  resourceCardBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#D4D4D8',
    letterSpacing: 0.5,
  },
  resourceCardSubject: {
    fontSize: 10.5,
    color: Monochrome.textTertiary,
    maxWidth: 150,
  },
  resourceCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Monochrome.text,
    lineHeight: 18,
    marginBottom: 8,
  },
  resourceCardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Monochrome.borderSubtle,
    paddingTop: 6,
  },
  resourceCardActionText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
