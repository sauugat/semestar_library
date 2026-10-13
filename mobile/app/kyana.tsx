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
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { PostMarkdown } from '@/components/PostMarkdown';
import {
  fetchKyanaConversations,
  fetchKyanaConversationMessages,
  sendKyanaMessage,
  clearKyanaConversation,
  createKyanaConversation,
  type KyanaMessage,
  type KyanaConversation,
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

function formatTime(isoString?: string | null): string {
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

export default function KyanaChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const studentId = user?.studentId || 'guest';
  const { width: screenWidth } = useWindowDimensions();

  // State
  const [conversation, setConversation] = useState<KyanaConversation | null>(null);
  const [messages, setMessages] = useState<KyanaMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | number | null>(null);

  // References
  const flatListRef = useRef<FlatList<any>>(null);
  const activeAbortController = useRef<AbortController | null>(null);
  const typingPulseAnim = useRef(new Animated.Value(0.4)).current;

  // Typing pulse animation
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (isGenerating && !streamingText) {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(typingPulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(typingPulseAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
    } else {
      typingPulseAnim.setValue(0.4);
    }
    return () => {
      anim?.stop();
    };
  }, [isGenerating, streamingText, typingPulseAnim]);

  // Load conversation & cached messages
  const loadActiveConversation = useCallback(async () => {
    if (!studentId) return;
    try {
      // 1. Fetch conversations from server
      const convs = await fetchKyanaConversations();
      let activeConv = convs[0] || null;

      if (!activeConv) {
        // Create default session if none exists
        activeConv = await createKyanaConversation('Chat with Kyana');
      }

      setConversation(activeConv);

      // 2. Load cached messages for immediate render
      const cached = await getCachedKyanaMessages(studentId, activeConv.id);
      if (cached && cached.length > 0) {
        setMessages(cached);
      }

      // 3. Sync authoritative messages from server
      const { messages: serverMsgs } = await fetchKyanaConversationMessages(activeConv.id);
      if (Array.isArray(serverMsgs)) {
        setMessages(serverMsgs);
        await saveCachedKyanaMessages(studentId, activeConv.id, serverMsgs);
      }
    } catch (err) {
      console.warn('[Kyana] Error loading active conversation:', err);
    } finally {
      setIsLoadingInitial(false);
    }
  }, [studentId]);

  useEffect(() => {
    void loadActiveConversation();
  }, [loadActiveConversation]);

  // Auto-scroll on new message
  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 100);
  }, []);

  // Send message handler
  const handleSend = useCallback(
    async (textToSend?: string) => {
      const query = (typeof textToSend === 'string' ? textToSend : inputText).trim();
      if (!query || isGenerating) return;

      setInputText('');
      Keyboard.dismiss();

      const activeConvId = conversation?.id || `kyana_${studentId}_default`;
      const tempUserMsgId = `user_${Date.now()}`;
      const userMessage: KyanaMessage = {
        id: tempUserMsgId,
        conversationId: activeConvId,
        sender: 'user',
        text: query,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };

      // Optimistic update
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      scrollToBottom();

      setIsGenerating(true);
      setStreamingText('');

      const controller = new AbortController();
      activeAbortController.current = controller;

      // Prepare conversational history payload (last 10 messages)
      const historyPayload = updatedMessages.slice(-10).map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      }));

      try {
        let liveDeltaAccumulated = '';
        const result = await sendKyanaMessage({
          message: query,
          conversationId: activeConvId,
          history: historyPayload,
          signal: controller.signal,
          onDelta: (deltaText) => {
            liveDeltaAccumulated += deltaText;
            setStreamingText(liveDeltaAccumulated);
            scrollToBottom(false);
          },
        });

        const replyText = result.reply || liveDeltaAccumulated || "I couldn't complete that answer.";
        const assistantMessage: KyanaMessage = {
          id: `asst_${Date.now()}`,
          conversationId: result.conversationId || activeConvId,
          sender: 'assistant',
          text: replyText,
          metadata: {
            matchedFiles: result.matchedFiles,
            matchedCourses: result.matchedCourses,
            matchedRoutine: result.matchedRoutine,
            webSources: result.webSources,
            actions: result.actions,
            chatMode: result.chatMode,
          },
          createdAt: new Date().toISOString(),
          status: 'sent',
        };

        const finalMessages = [...updatedMessages, assistantMessage];
        setMessages(finalMessages);
        setStreamingText('');

        if (studentId && activeConvId) {
          void saveCachedKyanaMessages(studentId, activeConvId, finalMessages);
        }
      } catch (err: any) {
        if (err?.message === 'Aborted') {
          // User aborted manually
          return;
        }

        const isRateLimit = err?.status === 429;
        const errMsg = isRateLimit
          ? 'Too many messages sent. Please wait a moment before sending again!'
          : "Kyana couldn't complete that response. Please try again.";

        const errorAssistantMsg: KyanaMessage = {
          id: `err_${Date.now()}`,
          conversationId: activeConvId,
          sender: 'assistant',
          text: errMsg,
          createdAt: new Date().toISOString(),
          status: 'error',
        };

        const withError = [...updatedMessages, errorAssistantMsg];
        setMessages(withError);
      } finally {
        setIsGenerating(false);
        setStreamingText('');
        activeAbortController.current = null;
        scrollToBottom();
      }
    },
    [inputText, isGenerating, conversation?.id, studentId, messages, scrollToBottom]
  );

  // Stop generation handler
  const handleStopGeneration = useCallback(() => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
      activeAbortController.current = null;
      setIsGenerating(false);
      setStreamingText('');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // Regenerate last response handler
  const handleRegenerate = useCallback(async () => {
    if (isGenerating || messages.length === 0) return;
    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.sender === 'user');
    if (!lastUserMsg) return;

    // Prune messages back to before that response
    const lastUserIdx = messages.lastIndexOf(lastUserMsg);
    const pruned = messages.slice(0, lastUserIdx);
    setMessages(pruned);
    void handleSend(lastUserMsg.text);
  }, [isGenerating, messages, handleSend]);

  // Copy message text to clipboard
  const handleCopyMessage = useCallback(async (msg: KyanaMessage) => {
    try {
      await Clipboard.setStringAsync(msg.text);
      setCopiedMessageId(msg.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch {}
  }, []);

  // Clear conversation handler
  const handleClear = useCallback(() => {
    setShowOptionsMenu(false);
    if (!conversation?.id) return;

    Alert.alert(
      'Clear Conversation?',
      'This will clear all messages in this conversation. Kyana will start fresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearKyanaConversation(conversation.id);
              if (studentId) {
                await clearCachedKyanaMessages(studentId, conversation.id);
              }
              setMessages([]);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert('Error', 'Could not clear conversation. Please try again.');
            }
          },
        },
      ]
    );
  }, [conversation?.id, studentId]);

  // Start new conversation handler
  const handleStartNew = useCallback(() => {
    setShowOptionsMenu(false);
    Alert.alert(
      'New Conversation',
      'Start a new conversation thread with Kyana?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start New',
          onPress: async () => {
            try {
              setIsLoadingInitial(true);
              const newConv = await createKyanaConversation('Chat with Kyana');
              setConversation(newConv);
              setMessages([]);
              if (studentId) {
                await saveCachedKyanaMessages(studentId, newConv.id, []);
              }
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert('Error', 'Could not create new conversation.');
            } finally {
              setIsLoadingInitial(false);
            }
          },
        },
      ]
    );
  }, [studentId]);

  // Copy entire conversation history
  const handleCopyAll = useCallback(async () => {
    setShowOptionsMenu(false);
    if (messages.length === 0) return;
    const transcript = messages
      .map((m) => `${m.sender === 'user' ? 'You' : 'Kyana'}: ${m.text}`)
      .join('\n\n');
    await Clipboard.setStringAsync(transcript);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Full conversation transcript copied to clipboard.');
  }, [messages]);

  // Render individual message item
  const renderItem = useCallback(
    ({ item, index }: { item: KyanaMessage; index: number }) => {
      const isUser = item.sender === 'user';
      const prev = messages[index - 1];
      const showDate = !prev || !isSameDay(prev.createdAt, item.createdAt);
      const isLastKyana =
        !isUser &&
        index === messages.length - 1 &&
        !isGenerating;
      const isCopied = copiedMessageId === item.id;
      const isError = item.status === 'error';

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
              styles.bubbleContainer,
              isUser ? styles.userBubbleContainer : styles.assistantBubbleContainer,
            ]}
          >
            {/* Assistant Icon Pill */}
            {!isUser && (
              <View style={styles.assistantAvatarSmall}>
                <Ionicons name="sparkles" size={13} color="#F5F5F5" />
              </View>
            )}

            <View
              style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble,
                isError && styles.errorBubble,
              ]}
            >
              {isUser ? (
                <Text style={styles.userBubbleText} selectable>
                  {item.text}
                </Text>
              ) : (
                <View style={styles.markdownWrapper}>
                  <PostMarkdown content={item.text} />
                </View>
              )}

              {/* Bottom Meta & Action Bar */}
              <View
                style={[
                  styles.metaRow,
                  isUser ? styles.userMetaRow : styles.assistantMetaRow,
                ]}
              >
                <Text style={styles.timestampText}>
                  {formatTime(item.createdAt)}
                </Text>

                {/* Quick actions on message */}
                <View style={styles.quickActions}>
                  <TouchableOpacity
                    onPress={() => void handleCopyMessage(item)}
                    style={styles.actionIconBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Copy message"
                  >
                    <Ionicons
                      name={isCopied ? 'checkmark' : 'copy-outline'}
                      size={13}
                      color={isCopied ? '#10B981' : '#71717A'}
                    />
                  </TouchableOpacity>

                  {(isLastKyana || isError) && (
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
              </View>
            </View>
          </View>
        </View>
      );
    },
    [messages, isGenerating, copiedMessageId, handleCopyMessage, handleRegenerate]
  );

  return (
    <View style={styles.container}>
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
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color="#F5F5F5" />
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <View style={styles.headerAvatar}>
            <Ionicons name="sparkles" size={17} color="#F5F5F5" />
          </View>
          <View style={styles.headerTextCol}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle}>Kyana AI</Text>
              <View style={styles.headerAiPill}>
                <Text style={styles.headerAiPillText}>AI</Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle}>
              {isGenerating ? '✦ Thinking…' : 'Study Companion'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowOptionsMenu(true)}
          style={styles.headerBtn}
          accessibilityLabel="Conversation options"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#F5F5F5" />
        </TouchableOpacity>
      </View>

      {/* MAIN MESSAGES AREA */}
      <View style={styles.messagesWrapper}>
        {isLoadingInitial ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#A1A1AA" />
            <Text style={styles.loadingText}>Opening Kyana AI…</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: 24 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyAvatarLarge}>
                  <Ionicons name="sparkles" size={32} color="#FFFFFF" />
                </View>
                <Text style={styles.emptyTitle}>Meet Kyana AI</Text>
                <Text style={styles.emptyDesc}>
                  Your BIT study companion. Ask concepts, code syntax, notes, syllabus, or exam routines.
                </Text>

                <View style={styles.suggestionsContainer}>
                  <Text style={styles.suggestionsTitle}>QUICK QUESTIONS</Text>
                  {QUICK_SUGGESTIONS.map((item, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.suggestionChip}
                      onPress={() => void handleSend(item.prompt)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.suggestionLabel}>{item.label}</Text>
                      <Ionicons name="arrow-forward" size={14} color="#71717A" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            }
            ListFooterComponent={
              isGenerating ? (
                <View style={styles.liveGenerationWrapper}>
                  <View style={styles.assistantAvatarSmall}>
                    <Ionicons name="sparkles" size={13} color="#F5F5F5" />
                  </View>
                  <View style={[styles.bubble, styles.assistantBubble, styles.generatingBubble]}>
                    {streamingText ? (
                      <View style={styles.markdownWrapper}>
                        <PostMarkdown content={streamingText} />
                      </View>
                    ) : (
                      <Animated.View
                        style={[
                          styles.typingIndicatorRow,
                          { opacity: typingPulseAnim },
                        ]}
                      >
                        <Ionicons name="sparkles" size={14} color="#A1A1AA" />
                        <Text style={styles.typingIndicatorText}>
                          Kyana is thinking…
                        </Text>
                      </Animated.View>
                    )}
                  </View>
                </View>
              ) : null
            }
          />
        )}
      </View>

      {/* COMPOSER DOCKED AT BOTTOM */}
      <KeyboardStickyView
        style={[
          styles.composerContainer,
          {
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <View style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Kyana anything…"
            placeholderTextColor="#71717A"
            multiline
            maxLength={8000}
            editable={!isGenerating}
            accessibilityLabel="Message input for Kyana"
          />

          {isGenerating ? (
            <TouchableOpacity
              onPress={handleStopGeneration}
              style={[styles.actionBtn, styles.stopBtn]}
              accessibilityLabel="Stop response generation"
            >
              <View style={styles.stopIconSquare} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => void handleSend()}
              disabled={!inputText.trim()}
              style={[
                styles.actionBtn,
                styles.sendBtn,
                !inputText.trim() && styles.sendBtnDisabled,
              ]}
              accessibilityLabel="Send message"
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={inputText.trim() ? '#000000' : '#52525B'}
              />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.disclaimerText}>
          Kyana can make mistakes. Verify vital exam and syllabus notices.
        </Text>
      </KeyboardStickyView>

      {/* OPTIONS MODAL MENU */}
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
            <Text style={styles.optionsTitle}>Kyana Conversation</Text>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={handleStartNew}
              accessibilityRole="button"
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="add" size={20} color="#F5F5F5" />
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
                <Ionicons name="copy-outline" size={18} color="#F5F5F5" />
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
    backgroundColor: '#090A0D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272A',
    backgroundColor: '#090A0D',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181B',
  },
  headerTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
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
    fontSize: 16,
    fontWeight: '700',
    color: '#F5F5F5',
  },
  headerAiPill: {
    backgroundColor: '#27272A',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3F3F46',
  },
  headerAiPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#A1A1AA',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#A1A1AA',
  },
  messagesWrapper: {
    flex: 1,
    backgroundColor: '#090A0D',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#71717A',
    fontSize: 13,
  },
  messageRowWrapper: {
    marginBottom: 14,
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
    backgroundColor: '#27272A',
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#71717A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bubbleContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  userBubbleContainer: {
    justifyContent: 'flex-end',
  },
  assistantBubbleContainer: {
    justifyContent: 'flex-start',
  },
  assistantAvatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '82%',
  },
  userBubble: {
    backgroundColor: '#27272A',
    borderBottomRightRadius: 4,
  },
  userBubbleText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
  },
  assistantBubble: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    borderBottomLeftRadius: 4,
    minWidth: 120,
  },
  errorBubble: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1C1917',
  },
  markdownWrapper: {
    marginVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
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
    color: '#71717A',
  },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    padding: 2,
  },
  liveGenerationWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 6,
    marginBottom: 14,
  },
  generatingBubble: {
    minHeight: 40,
    justifyContent: 'center',
  },
  typingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  typingIndicatorText: {
    color: '#A1A1AA',
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptyAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#18181B',
    borderWidth: 1.5,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13.5,
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  suggestionsContainer: {
    width: '100%',
    gap: 8,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionLabel: {
    fontSize: 13.5,
    color: '#E4E4E7',
    fontWeight: '500',
  },
  composerContainer: {
    backgroundColor: '#090A0D',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272A',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#18181B',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 46,
  },
  textInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14.5,
    maxHeight: 120,
    paddingVertical: 8,
    paddingRight: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sendBtn: {
    backgroundColor: '#FFFFFF',
  },
  sendBtnDisabled: {
    backgroundColor: '#27272A',
  },
  stopBtn: {
    backgroundColor: '#EF4444',
  },
  stopIconSquare: {
    width: 10,
    height: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  disclaimerText: {
    fontSize: 10.5,
    color: '#52525B',
    textAlign: 'center',
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  optionsSheet: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  optionsHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#3F3F46',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  optionsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  optionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1F1F23',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveIconBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  optionTextCol: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#F5F5F5',
  },
  destructiveLabel: {
    color: '#EF4444',
  },
  optionSub: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 2,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#1F1F23',
    borderRadius: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D4D4D8',
  },
});
