import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Animated,
  StatusBar,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Clipboard from "expo-clipboard";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { ChatMessageActionsSheet } from "@/components/chat/ChatMessageActionsSheet";
import { useClassChat } from "@/hooks/useClassChat";
import {
  mergeChatMessages,
  applyChatReaction,
  safeChatFilename,
} from "@/services/chat-state";
import { normalizeUploadFile, validateFileSize } from "@/utils/file-upload";
import {
  savePendingMessage,
  resolvePendingMessage,
  markPendingMessageFailed,
} from "@/services/chat-db";

import { useAuth } from "@/context/AuthContext";
import { Text } from "@/components/ui/Typography";
import { getAuthToken } from "@/services/api";
import {
  ChatMessage,
  ChatMember,
  CHAT_MAX_FILE_SIZE,
  fetchChatMembers,
  pinChatMessage,
  unpinChatMessage,
  deleteChatMessage,
  reactToChatMessage,
  sendChatMessage,
  sendChatTyping,
} from "@/services/chat";

export default function ChatScreen() {
  const { user, serverUrl, token } = useAuth();
  const insets = useSafeAreaInsets();
  const [inputFocused, setInputFocused] = useState(false);
  const router = useRouter();

  // State
  const {
    messages,
    setMessages,
    loadingInitial,
    loadingMore,
    hasMore,
    error,
    isConnected,
    activeTypers,
    readReceipts,
    pinned,
    onlineIds,
    sync,
    refreshPinned,
    loadOlderMessages,
    markRead,
  } = useClassChat(user?.studentId, serverUrl);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [panel, setPanel] = useState<"search" | "members" | null>(null);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const sendingRef = useRef(false);
  const actionBusyRef = useRef(false);
  const canPin = Boolean(
    user?.isAdmin || user?.role === "admin" || user?.role === "cr",
  );
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [lastVisibleMessageId, setLastVisibleMessageId] = useState(0);

  // Track initially loaded message IDs to disable slide animation on initial load (Requirement 20)
  const initialLoadedIds = useRef(new Set<number>());
  useEffect(() => {
    if (!loadingInitial && messages.length > 0 && initialLoadedIds.current.size === 0) {
      messages.forEach((m) => initialLoadedIds.current.add(m.id));
    }
  }, [loadingInitial, messages]);

  const unreadBelow = showScrollToBottom
    ? messages.filter(
        (message) =>
          message.id > lastVisibleMessageId &&
          String(message.studentId) !== String(user?.studentId),
      ).length
    : 0;

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? messages.filter((message) =>
          `${message.text} ${message.name} ${message.attachmentOriginalName || ""}`
            .toLowerCase()
            .includes(term),
        )
      : [];
  }, [messages, query]);

  const filteredMembers = useMemo(
    () =>
      members.filter((member) =>
        member.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [members, query],
  );

  // Selected Attachment State (before send)
  const [selectedAttachment, setSelectedAttachment] = useState<{
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
    isImage?: boolean;
  } | null>(null);
  const [showAttachModal, setShowAttachModal] = useState(false);

  // Full-screen Image Viewer State
  const [viewerImage, setViewerImage] = useState<{
    uri: string;
    name: string;
  } | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);

  // Downloading document state
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  // Refs
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isNearBottomRef = useRef(true);
  const lastTypingSentRef = useRef<number>(0);
  const [typingPulsingAnim] = useState(() => new Animated.Value(0.3));

  // Header subtitle: Requirement 14 & 15 (No hardcoded BCA, show online count)
  const typingNames = useMemo(() => {
    return Array.from(activeTypers.values()).map((t) => t.name);
  }, [activeTypers]);

  const headerSubtitle = useMemo(() => {
    if (typingNames.length > 0) {
      return `${typingNames[0]} is typing...`;
    }
    if (error) return "Waiting for connection • tap to retry";
    if (isConnected && onlineIds.length > 0) {
      return `${onlineIds.length} online`;
    }
    return "Class conversation";
  }, [typingNames, isConnected, onlineIds.length, error]);

  // Auth headers for image sources
  const imageAuthHeaders = useMemo(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  useEffect(() => {
    if (!activeTypers.size) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(typingPulsingAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(typingPulsingAnim, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [activeTypers.size, typingPulsingAnim]);

  useFocusEffect(
    useCallback(() => {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setLastVisibleMessageId(0);
    }, []),
  );

  useEffect(() => {
    if (!showScrollToBottom && messages[0]?.id) void markRead(messages[0].id);
  }, [messages, showScrollToBottom, markRead]);

  const openMembers = async () => {
    setQuery("");
    setPanel("members");
    setMembersLoading(true);
    setMembersError(false);
    try {
      const data = await fetchChatMembers();
      setMembers(data.members || []);
    } catch {
      setMembersError(true);
    } finally {
      setMembersLoading(false);
    }
  };

  const jumpToMessage = useCallback((id: number) => {
    const index = messages.findIndex((m) => m.id === id);
    setPanel(null);
    if (index < 0) {
      Alert.alert(
        "Earlier message",
        "This message is further back in the conversation. Scroll up to load earlier messages.",
      );
      return;
    }
    isNearBottomRef.current = index === 0;
    flatListRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
    setHighlightedMessageId(id);
    setTimeout(() => {
      setHighlightedMessageId((cur) => (cur === id ? null : cur));
    }, 1500);
  }, [messages]);

  const runAction = async (operation: () => Promise<unknown>) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      await operation();
      setActionMessage(null);
    } catch (failure) {
      Alert.alert(
        "Could not complete action",
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  const react = async (message: ChatMessage, emoji: string) => {
    const result = await reactToChatMessage(message.id, emoji);
    setMessages((previous) =>
      applyChatReaction(
        previous,
        message.id,
        String(user?.studentId),
        emoji,
        result.action,
      ),
    );
  };

  const handleToggleReaction = useCallback((message: ChatMessage, emoji: string) => {
    void runAction(() => react(message, emoji));
  }, [user?.studentId]);

  const handleSwipeReply = useCallback((message: ChatMessage) => {
    setReplyTo(message);
    inputRef.current?.focus();
  }, []);

  const handleOpenActions = useCallback((message: ChatMessage) => {
    setActionMessage(message);
  }, []);

  // Handle typing throttling
  const handleTextChange = (text: string) => {
    setInputText(text);
    const now = Date.now();
    if (text.trim() && now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      sendChatTyping();
    }
  };

  // Attachment Selection Handlers
  const handlePickImage = async () => {
    setShowAttachModal(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const normalized = normalizeUploadFile(asset, `image_${Date.now()}.jpg`);
        validateFileSize(normalized.size, CHAT_MAX_FILE_SIZE, "Photo");

        setSelectedAttachment({
          uri: normalized.uri,
          name: normalized.name,
          mimeType: normalized.type,
          size: normalized.size,
          isImage: true,
        });
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not pick image");
    }
  };

  const handlePickDocument = async () => {
    setShowAttachModal(false);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        const normalized = normalizeUploadFile(asset, "document.pdf");
        validateFileSize(normalized.size, CHAT_MAX_FILE_SIZE, "Document");

        const isImg =
          normalized.type.startsWith("image/") ||
          /\.(jpg|jpeg|png|webp|gif)$/i.test(normalized.name);

        setSelectedAttachment({
          uri: normalized.uri,
          name: normalized.name,
          mimeType: normalized.type,
          size: normalized.size,
          isImage: isImg,
        });
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not pick document");
    }
  };

  // Send message
  const handleSendMessage = async () => {
    const trimmed = inputText.trim();
    if (!trimmed && !selectedAttachment) return;
    if (sendingRef.current) return;
    if (trimmed.length > 2000) return;
    sendingRef.current = true;

    setSending(true);
    const textToSend = trimmed;
    const attachmentToSend = selectedAttachment;
    const replyToSend = replyTo;

    // 1. Generate optimistic message with temporary negative ID
    const tempId = -Date.now();
    const optimisticMessage: ChatMessage = {
      id: tempId,
      text: textToSend,
      attachmentName: attachmentToSend
        ? attachmentToSend.isImage
          ? 'pending_image.jpg'
          : 'pending_document.pdf'
        : null,
      attachmentOriginalName: attachmentToSend?.name || null,
      attachmentMimeType: attachmentToSend?.mimeType || null,
      replyToId: replyToSend?.id || null,
      replyText: replyToSend?.text,
      replySender: replyToSend?.name,
      createdAt: new Date().toISOString(),
      studentId: user?.studentId || 'me',
      name: user?.name || 'Me',
      avatarUrl: user?.avatarUrl || null,
      reactions: [],
      status: 'pending',
    };

    // 2. Render immediately in UI and persist to local SQLite
    setMessages((prev) => mergeChatMessages(prev, [optimisticMessage]));
    void savePendingMessage(optimisticMessage);

    // 3. Clear inputs and scroll to bottom instantly
    setInputText("");
    setSelectedAttachment(null);
    setReplyTo(null);
    isNearBottomRef.current = true;
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowScrollToBottom(false);

    try {
      const res = await sendChatMessage({
        text: textToSend,
        replyToId: replyToSend?.id,
        file: attachmentToSend
          ? {
              uri: attachmentToSend.uri,
              name: attachmentToSend.name,
              mimeType: attachmentToSend.mimeType,
            }
          : null,
      });

      if (res && res.data) {
        await resolvePendingMessage(tempId, res.data);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? res.data : m))
        );
      }
    } catch (err: any) {
      console.warn("Optimistic message failed:", err.message);
      await markPendingMessageFailed(tempId);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    if (sendingRef.current) return;
    sendingRef.current = true;

    // Reset status to pending in state & SQLite
    setMessages((prev) =>
      prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'pending' } : m))
    );
    void savePendingMessage({ ...failedMsg, status: 'pending' });

    try {
      const res = await sendChatMessage({
        text: failedMsg.text,
        replyToId: failedMsg.replyToId,
      });

      if (res && res.data) {
        await resolvePendingMessage(failedMsg.id, res.data);
        setMessages((prev) =>
          prev.map((m) => (m.id === failedMsg.id ? res.data : m))
        );
      }
    } catch {
      await markPendingMessageFailed(failedMsg.id);
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'failed' } : m))
      );
    } finally {
      sendingRef.current = false;
    }
  };

  // Scroll tracking in inverted list
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset } = event.nativeEvent;
    const distanceToBottom = Math.max(0, contentOffset.y);
    const isNear = distanceToBottom < 100;
    isNearBottomRef.current = isNear;
    setShowScrollToBottom(!isNear);
    if (isNear) {
      setLastVisibleMessageId(messages[0]?.id || 0);
    }
  };

  // Document Download & Open Handler
  const handleDownloadAttachment = async (msg: ChatMessage) => {
    if (!msg.attachmentName) return;
    const filename = msg.attachmentName;
    const originalName = msg.attachmentOriginalName || filename;
    const fileUrl = `${serverUrl}/api/chat/attachment/${encodeURIComponent(filename)}`;

    try {
      setDownloadingFileId(String(msg.id));
      const targetDir = FileSystem.cacheDirectory || "";
      if (!targetDir) throw new Error("File storage is unavailable.");
      const localUri = `${targetDir}chat-${msg.id}-${safeChatFilename(originalName)}`;

      const authToken = await getAuthToken();
      const downloadHeaders: Record<string, string> = {};
      if (authToken) downloadHeaders["Authorization"] = `Bearer ${authToken}`;

      const res = await FileSystem.downloadAsync(fileUrl, localUri, {
        headers: downloadHeaders,
      });
      if (res.status === 200) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(res.uri, {
            dialogTitle: `Open ${originalName}`,
            mimeType: msg.attachmentMimeType || undefined,
          });
        } else {
          Alert.alert("Downloaded", `Saved to storage: ${originalName}`);
        }
      } else {
        throw new Error(`Server returned status ${res.status}`);
      }
    } catch (err: any) {
      Alert.alert(
        "Download Error",
        err.message || "Failed to download attachment",
      );
    } finally {
      setDownloadingFileId(null);
    }
  };

  // Image Save & Share Handlers for Fullscreen Viewer
  const handleSaveViewerImage = async () => {
    if (!viewerImage) return;
    setSavingImage(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true, [
        "photo",
      ]);
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Please grant photos permission to save images.",
        );
        return;
      }
      const targetPath = `${FileSystem.cacheDirectory || ""}chat-${safeChatFilename(viewerImage.name)}`;
      const authToken = await getAuthToken();
      const dlHeaders: Record<string, string> = {};
      if (authToken) dlHeaders["Authorization"] = `Bearer ${authToken}`;
      const res = await FileSystem.downloadAsync(viewerImage.uri, targetPath, {
        headers: dlHeaders,
      });
      if (res.status !== 200) throw new Error("Could not download image.");
      await MediaLibrary.saveToLibraryAsync(res.uri);
      Alert.alert("Saved", "Image successfully saved to your Photos.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save image to Photos");
    } finally {
      setSavingImage(false);
    }
  };

  const handleShareViewerImage = async () => {
    if (!viewerImage) return;
    setSharingImage(true);
    try {
      const targetPath = `${FileSystem.cacheDirectory || ""}chat-${safeChatFilename(viewerImage.name)}`;
      const authToken = await getAuthToken();
      const dlHeaders: Record<string, string> = {};
      if (authToken) dlHeaders["Authorization"] = `Bearer ${authToken}`;
      const res = await FileSystem.downloadAsync(viewerImage.uri, targetPath, {
        headers: dlHeaders,
      });
      if (res.status !== 200) throw new Error("Could not download image.");
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("Sharing is unavailable on this device.");
      await Sharing.shareAsync(res.uri);
    } catch (err: any) {
      Alert.alert("Share Error", err.message || "Could not share image");
    } finally {
      setSharingImage(false);
    }
  };

  // Render message using the overhauled ChatMessageItem component
  const renderMessageItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const prevMsg = messages[index + 1] || null;
      const nextMsg = messages[index - 1] || null;
      const isInitial = initialLoadedIds.current.has(item.id);
      const isHighlighted = highlightedMessageId === item.id;

      return (
        <ChatMessageItem
          item={item}
          index={index}
          prevMsg={prevMsg}
          nextMsg={nextMsg}
          currentUserId={user?.studentId}
          readReceipts={readReceipts}
          serverUrl={serverUrl}
          authToken={token}
          downloadingFileId={downloadingFileId}
          isInitialLoadItem={isInitial}
          isHighlighted={isHighlighted}
          onLongPress={handleOpenActions}
          onSwipeReply={handleSwipeReply}
          onJumpToReply={jumpToMessage}
          onOpenImage={setViewerImage}
          onDownloadFile={handleDownloadAttachment}
          onToggleReaction={handleToggleReaction}
          onRetry={handleRetryMessage}
        />
      );
    },
    [
      messages,
      user?.studentId,
      readReceipts,
      serverUrl,
      token,
      downloadingFileId,
      highlightedMessageId,
      handleOpenActions,
      handleSwipeReply,
      jumpToMessage,
      handleDownloadAttachment,
      handleToggleReaction,
      handleRetryMessage,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.screenContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <StatusBar barStyle="light-content" />

      {/* Overhauled WhatsApp-styled Header (Requirement 14 & 15) */}
      <View
        style={[
          styles.customHeader,
          {
            paddingTop: Math.max(insets.top, 10),
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.navigate("/(tabs)")}
          style={styles.headerBackBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color="#f5f5f5" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerTitleContainer}
          onPress={() => void openMembers()}
          activeOpacity={0.7}
          accessibilityLabel="View class members"
        >
          {/* Circular group icon */}
          <View style={styles.groupAvatarCircle}>
            <Ionicons name="people" size={17} color="#e4e4e7" />
          </View>

          <View style={styles.headerTextGroup}>
            <Text variant="md" weight="700" style={styles.headerGroupName} numberOfLines={1}>
              Class Group
            </Text>
            <Text variant="xs" style={styles.headerSubtitle} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel="Search loaded messages"
          style={styles.headerSearchBtn}
          onPress={() => {
            setQuery("");
            setPanel("search");
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="search-outline" size={21} color="#f5f5f5" />
        </TouchableOpacity>
      </View>

      {/* Pinned Message Banner */}
      {pinned && (
        <View style={styles.pinnedBanner}>
          <Ionicons name="pin-outline" size={16} color="#a1a1aa" />
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => jumpToMessage(pinned.messageId)}
          >
            <Text style={styles.miniLabel}>PINNED MESSAGE</Text>
            <Text numberOfLines={1} style={styles.panelSecondary}>
              {pinned.senderName}: {pinned.text || "Attachment"}
            </Text>
          </TouchableOpacity>
          {canPin && (
            <TouchableOpacity
              accessibilityLabel="Unpin message"
              onPress={() =>
                Alert.alert(
                  "Unpin message?",
                  "Remove this announcement from the top of the conversation?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Unpin",
                      onPress: () =>
                        void runAction(async () => {
                          await unpinChatMessage();
                          await refreshPinned();
                        }),
                    },
                  ],
                )
              }
            >
              <Ionicons name="close" size={18} color="#71717a" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Network / Error Notice */}
      {error && (
        <TouchableOpacity
          style={styles.errorBanner}
          onPress={() => void sync()}
          accessibilityRole="button"
        >
          <Ionicons name="refresh-outline" size={16} color="#f5f5f5" />
          <Text style={styles.errorBannerText}>{error} Tap to retry.</Text>
        </TouchableOpacity>
      )}

      {/* Main Message List */}
      {loadingInitial ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#f5f5f5" />
          <Text variant="sm" style={styles.loadingInitialText}>
            Loading group messages...
          </Text>
        </View>
      ) : error && messages.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="cloud-offline-outline" size={36} color="#71717a" />
          <Text style={styles.panelTitle}>Could not load messages</Text>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={() => void sync()}
          >
            <Text style={{ color: "#f5f5f5" }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.messagesFeed}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 80,
          }}
          onContentSizeChange={() => {
            if (isNearBottomRef.current)
              flatListRef.current?.scrollToOffset({
                offset: 0,
                animated: false,
              });
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatListRef.current?.scrollToOffset({
              offset: index * averageItemLength,
              animated: true,
            });
          }}
          onEndReached={loadOlderMessages}
          onEndReachedThreshold={0.3}
          inverted
          initialNumToRender={14}
          windowSize={11}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMoreContainer}>
                <ActivityIndicator size="small" color="#71717a" />
                <Text variant="xs" style={styles.loadingMoreText}>
                  Loading older messages...
                </Text>
              </View>
            ) : hasMore && messages.length > 0 ? (
              <TouchableOpacity
                accessibilityLabel="Load earlier messages"
                style={styles.loadingMoreContainer}
                onPress={() => void loadOlderMessages()}
              >
                <Text style={styles.panelSecondary}>Load earlier messages</Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
              <View style={styles.emptyIconBox}>
                <Ionicons name="chatbubbles-outline" size={30} color="#71717a" />
              </View>
              <Text variant="md" weight="700" style={styles.emptyTitle}>
                Welcome to Class Chat
              </Text>
              <Text variant="sm" style={styles.emptyDesc}>
                Ask questions, share study notes, and collaborate with your class.
              </Text>
            </View>
          }
        />
      )}

      {/* Floating Scroll to Bottom Button (Requirement 17: floats clearly above composer with margin) */}
      {showScrollToBottom && (
        <TouchableOpacity
          style={styles.floatingScrollBtn}
          onPress={() => {
            isNearBottomRef.current = true;
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            setShowScrollToBottom(false);
            setLastVisibleMessageId(messages[0]?.id || 0);
          }}
          activeOpacity={0.8}
          accessibilityLabel="Scroll to bottom"
        >
          <Ionicons name="chevron-down" size={19} color="#f5f5f5" />
          {unreadBelow > 0 && (
            <View style={styles.floatingUnreadBadge}>
              <Text variant="xs" weight="700" style={styles.floatingUnreadBadgeText}>
                {unreadBelow}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Typing Indicator Bar */}
      {activeTypers.size > 0 && (
        <View style={styles.typingBar}>
          <View style={styles.typingDotsContainer}>
            <Animated.View style={[styles.typingDot, { opacity: typingPulsingAnim }]} />
            <Animated.View style={[styles.typingDot, { opacity: typingPulsingAnim }]} />
            <Animated.View style={[styles.typingDot, { opacity: typingPulsingAnim }]} />
          </View>
          <Text variant="xs" style={styles.typingText}>
            {typingNames.length === 1
              ? `${typingNames[0]} is typing...`
              : `${typingNames[0]} and ${typingNames.length - 1} others are typing...`}
          </Text>
        </View>
      )}

      {/* Replying-to Preview Bar (compact, 3px accent bar, no nested border) */}
      {replyTo && (
        <View style={styles.replyBanner}>
          <Ionicons name="arrow-undo" size={16} color="#a1a1aa" />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBannerSender}>REPLYING TO {replyTo.name || "CLASSMATE"}</Text>
            <Text numberOfLines={1} style={styles.replyBannerPreview}>
              {replyTo.text || replyTo.attachmentOriginalName || "Attachment"}
            </Text>
          </View>
          <TouchableOpacity
            disabled={sending}
            accessibilityLabel="Cancel reply"
            onPress={() => setReplyTo(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color="#a1a1aa" />
          </TouchableOpacity>
        </View>
      )}

      {/* Selected Attachment Preview Bar (above text input) */}
      {selectedAttachment && (
        <View style={styles.attachmentPreviewBanner}>
          <View style={styles.attachmentPreviewContent}>
            {selectedAttachment.isImage ? (
              <Image
                source={{ uri: selectedAttachment.uri }}
                style={styles.previewThumbnail}
              />
            ) : (
              <View style={styles.previewIconBox}>
                <Ionicons name="document-text" size={18} color="#e4e4e7" />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text variant="sm" weight="600" numberOfLines={1} style={{ color: "#f5f5f5" }}>
                {selectedAttachment.name}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            disabled={sending}
            accessibilityLabel="Remove attachment"
            onPress={() => setSelectedAttachment(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.removeAttachmentBtn}
          >
            <Ionicons name="close-circle" size={18} color="#a1a1aa" />
          </TouchableOpacity>
        </View>
      )}

      {/* Message Composer (Requirement 16: Slim circular buttons, pill input, reduced excess padding) */}
      <View
        style={[
          styles.composerContainer,
          {
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          },
        ]}
      >
        {/* Slim circular '+' button */}
        <TouchableOpacity
          style={styles.attachButtonCircle}
          onPress={() => setShowAttachModal(true)}
          disabled={sending}
          activeOpacity={0.7}
          accessibilityLabel="Add attachment"
        >
          <Ionicons name="add" size={22} color="#f5f5f5" />
        </TouchableOpacity>

        {/* Pill-shaped input */}
        <TextInput
          ref={inputRef}
          accessibilityLabel="Message your class"
          keyboardAppearance="dark"
          style={[
            styles.pillTextInput,
            inputFocused && { borderColor: "#48484a" },
          ]}
          placeholder="Message…"
          placeholderTextColor="#71717a"
          multiline
          maxLength={2000}
          value={inputText}
          onChangeText={handleTextChange}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          editable={!sending && Boolean(user)}
        />

        {/* Send button when content exists, otherwise camera button */}
        {Boolean(inputText.trim() || selectedAttachment) ? (
          <ChatSendButton
            disabled={(!inputText.trim() && !selectedAttachment) || sending || !user}
            sending={sending}
            onPress={() => void handleSendMessage()}
          />
        ) : (
          <TouchableOpacity
            style={styles.cameraButtonCircle}
            onPress={handlePickImage}
            disabled={sending || !user}
            activeOpacity={0.7}
            accessibilityLabel="Share photo"
          >
            <Ionicons name="camera-outline" size={20} color="#a1a1aa" />
          </TouchableOpacity>
        )}
      </View>

      {/* Class Members & Search Modal Panel */}
      <Modal
        visible={panel !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPanel(null)}
      >
        <KeyboardAvoidingView
          style={styles.panelBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setPanel(null)}
            accessibilityLabel="Close panel"
          />
          <View
            style={[
              styles.panelSheet,
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
            accessibilityViewIsModal
          >
            <View style={styles.sheetHandle} />
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>
                {panel === "members" ? "Class members" : "Search conversation"}
              </Text>
              <TouchableOpacity
                accessibilityLabel="Close panel"
                onPress={() => setPanel(null)}
              >
                <Ionicons name="close" size={22} color="#f5f5f5" />
              </TouchableOpacity>
            </View>
            <TextInput
              accessibilityLabel={
                panel === "members" ? "Filter members" : "Search messages"
              }
              keyboardAppearance="dark"
              style={styles.panelInput}
              placeholder={
                panel === "members"
                  ? "Find a classmate…"
                  : "Search loaded messages…"
              }
              placeholderTextColor="#71717a"
              value={query}
              onChangeText={setQuery}
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {panel === "members" ? (
                membersLoading ? (
                  <ActivityIndicator color="#f5f5f5" />
                ) : membersError ? (
                  <TouchableOpacity
                    style={styles.sheetAction}
                    onPress={() => void openMembers()}
                  >
                    <Text style={styles.panelSecondary}>
                      Could not load members. Tap to retry.
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <Text style={styles.miniLabel}>
                      {members.length} MEMBERS
                      {isConnected ? ` • ${onlineIds.length} ONLINE` : ""}
                    </Text>
                    {filteredMembers.map((member) => (
                      <View key={member.studentId} style={styles.memberRow}>
                        <View style={styles.memberAvatar}>
                          <Text style={{ color: "#f5f5f5", fontWeight: "700" }}>
                            {member.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: "#f5f5f5", fontWeight: "600" }}>
                            {member.name}
                          </Text>
                          <Text style={styles.panelSecondary}>
                            {member.role === "admin"
                              ? "Admin"
                              : member.semester
                                ? `Semester ${member.semester}`
                                : "Class member"}
                          </Text>
                        </View>
                        {onlineIds.includes(String(member.studentId)) && (
                          <View style={styles.onlineBadge}>
                            <View style={styles.onlineDot} />
                            <Text style={styles.onlineText}>Online</Text>
                          </View>
                        )}
                      </View>
                    ))}
                    {!filteredMembers.length && (
                      <Text style={styles.panelSecondary}>
                        No classmates match your search.
                      </Text>
                    )}
                  </>
                )
              ) : (
                <>
                  <Text style={styles.miniLabel}>
                    SEARCHES {messages.length} LOADED MESSAGES
                  </Text>
                  {query.trim() ? (
                    searchResults.length ? (
                      searchResults.map((message) => (
                        <TouchableOpacity
                          key={message.id}
                          style={styles.sheetAction}
                          onPress={() => jumpToMessage(message.id)}
                        >
                          <Text style={styles.miniLabel}>
                            {message.name}
                          </Text>
                          <Text
                            numberOfLines={3}
                            style={{ color: "#f5f5f5", fontSize: 14 }}
                          >
                            {message.text ||
                              message.attachmentOriginalName ||
                              "Attachment"}
                          </Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.panelSecondary}>
                        No matching messages.
                      </Text>
                    )
                  ) : (
                    <Text style={styles.panelSecondary}>
                      Find a message, classmate, or shared file. Scroll up in
                      the conversation to load more history.
                    </Text>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Overhauled Message Actions Sheet (Requirement 18: Compact bottom sheet) */}
      <ChatMessageActionsSheet
        visible={Boolean(actionMessage)}
        message={actionMessage}
        busy={actionBusy}
        canPin={canPin}
        isOwnerOrAdmin={Boolean(
          user?.isAdmin ||
            user?.role === "admin" ||
            String(actionMessage?.studentId) === String(user?.studentId),
        )}
        onClose={() => !actionBusy && setActionMessage(null)}
        onReact={(msg, emoji) => void runAction(() => react(msg, emoji))}
        onReply={(msg) => {
          setReplyTo(msg);
          setActionMessage(null);
          inputRef.current?.focus();
        }}
        onCopy={(msg) => {
          if (msg.text) {
            void runAction(() => Clipboard.setStringAsync(msg.text));
          }
        }}
        onPin={(msg) => {
          void runAction(async () => {
            await pinChatMessage(msg.id);
            await refreshPinned();
          });
        }}
        onDelete={(msg) => {
          Alert.alert(
            "Delete message?",
            "This removes the message for everyone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () =>
                  void runAction(async () => {
                    const id = msg.id;
                    await deleteChatMessage(id);
                    setMessages((previous) =>
                      previous.filter((m) => m.id !== id),
                    );
                    await refreshPinned();
                  }),
              },
            ],
          );
        }}
      />

      {/* Attachment Action Sheet Modal */}
      <Modal
        visible={showAttachModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowAttachModal(false)}
        >
          <View style={styles.attachSheetContainer}>
            <Text
              variant="md"
              weight="700"
              style={{ color: "#f5f5f5", marginBottom: 14 }}
            >
              Share Attachment
            </Text>

            <TouchableOpacity
              style={styles.attachOptionRow}
              onPress={handlePickImage}
            >
              <View style={styles.attachOptionIcon}>
                <Ionicons name="image-outline" size={20} color="#e4e4e7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="md" weight="600" style={{ color: "#f5f5f5" }}>
                  Photo & Image
                </Text>
                <Text variant="xs" style={{ color: "#71717a" }}>
                  Share photos, screenshots, or diagrams
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachOptionRow}
              onPress={handlePickDocument}
            >
              <View style={styles.attachOptionIcon}>
                <Ionicons name="document-outline" size={20} color="#e4e4e7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="md" weight="600" style={{ color: "#f5f5f5" }}>
                  Document & File
                </Text>
                <Text variant="xs" style={{ color: "#71717a" }}>
                  PDF, DOCX, ZIP, or code files
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.attachCancelBtn}
              onPress={() => setShowAttachModal(false)}
            >
              <Text variant="sm" weight="600" style={{ color: "#a1a1aa" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Full-Screen Image Viewer Modal */}
      <Modal
        visible={viewerImage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerImage(null)}
        statusBarTranslucent
      >
        <View style={styles.viewerBackdrop}>
          <View
            style={[
              styles.viewerHeader,
              { paddingTop: (insets.top || 20) + 10 },
            ]}
          >
            <TouchableOpacity
              onPress={() => setViewerImage(null)}
              style={styles.viewerCloseBtn}
              accessibilityLabel="Close viewer"
            >
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>

            <Text
              variant="sm"
              weight="600"
              numberOfLines={1}
              style={styles.viewerTitle}
            >
              {viewerImage?.name}
            </Text>

            <View style={styles.viewerActionsRow}>
              <TouchableOpacity
                onPress={handleShareViewerImage}
                accessibilityLabel="Share image"
                disabled={sharingImage}
                style={styles.viewerActionBtn}
              >
                {sharingImage ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="share-outline" size={20} color="#ffffff" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSaveViewerImage}
                accessibilityLabel="Save image to photos"
                disabled={savingImage}
                style={[styles.viewerActionBtn, { marginLeft: 12 }]}
              >
                {savingImage ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="download-outline" size={20} color="#ffffff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {viewerImage && (
            <View style={styles.viewerImageWrapper}>
              <Image
                source={{ uri: viewerImage.uri, headers: imageAuthHeaders }}
                style={styles.viewerImage}
                contentFit="contain"
              />
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a", // Strict black background
  },
  customHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: "#121214",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f1f21",
  },
  headerBackBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 2,
    marginRight: 8,
  },
  groupAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  headerTextGroup: {
    flex: 1,
    justifyContent: "center",
  },
  headerGroupName: {
    color: "#f5f5f5",
    fontSize: 15,
  },
  headerSubtitle: {
    color: "#a1a1aa",
    fontSize: 11,
    marginTop: 1,
  },
  headerSearchBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  pinnedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#161618",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  errorBanner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#222225",
  },
  errorBannerText: {
    color: "#f5f5f5",
    fontSize: 12,
  },
  messagesFeed: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingInitialText: {
    color: "#71717a",
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: "#f5f5f5",
    marginTop: 14,
  },
  emptyDesc: {
    color: "#71717a",
    textAlign: "center",
    marginTop: 6,
  },
  loadingMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  loadingMoreText: {
    color: "#71717a",
    marginLeft: 8,
  },
  floatingScrollBtn: {
    position: "absolute",
    right: 16,
    bottom: 74, // Floating clearly above composer (not clipped)
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#242426",
    borderWidth: 1,
    borderColor: "#38383a",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 99,
  },
  floatingUnreadBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "#ffffff",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  floatingUnreadBadgeText: {
    color: "#0a0a0a",
    fontSize: 10,
  },
  typingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: "#121214",
  },
  typingDotsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#71717a",
  },
  typingText: {
    color: "#a1a1aa",
    marginLeft: 8,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#161618",
    borderLeftWidth: 3,
    borderLeftColor: "#8e8e93",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#242426",
  },
  replyBannerSender: {
    fontSize: 11,
    fontWeight: "600",
    color: "#e4e4e7",
  },
  replyBannerPreview: {
    fontSize: 11,
    color: "#a1a1aa",
    marginTop: 1,
  },
  attachmentPreviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#161618",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#242426",
  },
  attachmentPreviewContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  previewThumbnail: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  previewIconBox: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
  },
  removeAttachmentBtn: {
    padding: 4,
  },
  composerContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: "#121214",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1f1f21",
  },
  attachButtonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 1,
  },
  pillTextInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 110,
    backgroundColor: "#1c1c1e",
    borderRadius: 19,
    paddingHorizontal: 15,
    paddingTop: Platform.OS === "ios" ? 9 : 7,
    paddingBottom: Platform.OS === "ios" ? 9 : 7,
    fontSize: 15,
    color: "#ffffff",
    lineHeight: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#2e2e32",
  },
  cameraButtonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  panelBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)" },
  panelSheet: {
    maxHeight: "80%",
    backgroundColor: "#18181a",
    padding: 20,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#48484a",
    marginBottom: 16,
    marginTop: -8,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  panelTitle: {
    color: "#f5f5f5",
    fontSize: 18,
    fontWeight: "700",
  },
  panelSecondary: {
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 18,
  },
  miniLabel: {
    color: "#71717a",
    fontSize: 10,
    letterSpacing: 0.6,
    fontWeight: "600",
    marginBottom: 6,
  },
  panelInput: {
    backgroundColor: "#222224",
    borderColor: "#333336",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#f5f5f5",
    fontSize: 15,
    marginBottom: 14,
  },
  sheetAction: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
    minHeight: 46,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
  },
  onlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
  },
  onlineText: {
    fontSize: 11,
    color: "#a1a1aa",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  attachSheetContainer: {
    backgroundColor: "#18181a",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: "#27272a",
    padding: 20,
    paddingBottom: 36,
  },
  attachOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  attachOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
  },
  attachCancelBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#222224",
    borderWidth: 1,
    borderColor: "#2e2e32",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "#000000",
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 10,
  },
  viewerCloseBtn: {
    padding: 6,
  },
  viewerTitle: {
    flex: 1,
    color: "#ffffff",
    marginHorizontal: 12,
  },
  viewerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  viewerActionBtn: {
    padding: 6,
  },
  viewerImageWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: {
    width: "100%",
    height: "100%",
  },
});
