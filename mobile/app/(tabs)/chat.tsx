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
  Keyboard,
  useWindowDimensions,
  Dimensions,
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
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { ChatMessageActionsSheet } from "@/components/chat/ChatMessageActionsSheet";
import { FullScreenImageViewer } from "@/components/FullScreenImageViewer";
import { useClassChat } from "@/hooks/useClassChat";
import {
  mergeChatMessages,
  applyChatReaction,
  safeChatFilename,
} from "@/services/chat-state";
import { prepareChatAttachment, removeOutboxFile } from "@/services/chat-attachments";
import {
  savePendingMessage,
  resolvePendingMessage,
  markPendingMessageFailed,
  updateCachedReaction,
  deleteCachedMessage,
} from "@/services/chat-db";

import { useAuth } from "@/context/AuthContext";
import { Text } from "@/components/ui/Typography";
import { getAuthToken } from "@/services/api";
import {
  ChatMessage,
  ChatMember,
  fetchChatMembers,
  pinChatMessage,
  unpinChatMessage,
  deleteChatMessage,
  reactToChatMessage,
  sendChatMessage,
  sendChatTyping,
} from "@/services/chat";
import { setChatScreenActive, clearAppBadge } from "@/services/notifications";

function MemberAvatarItem({
  member,
  serverUrl,
  headers,
}: {
  member: ChatMember;
  serverUrl: string;
  headers?: Record<string, string>;
}) {
  const [loadError, setLoadError] = useState(false);
  const avatarUri = useMemo(() => {
    if (!member.avatarUrl) return null;
    if (member.avatarUrl.startsWith("http://") || member.avatarUrl.startsWith("https://")) {
      return member.avatarUrl;
    }
    const base = (serverUrl || "").replace(/\/+$/, "");
    const path = member.avatarUrl.replace(/^\/+/, "");
    return `${base}/${path}`;
  }, [member.avatarUrl, serverUrl]);

  if (avatarUri && !loadError) {
    return (
      <View style={styles.memberAvatar}>
        <Image
          source={{
            uri: avatarUri,
            headers: headers || undefined,
            cacheKey: avatarUri,
          }}
          cachePolicy="memory-disk"
          style={{ width: 36, height: 36, borderRadius: 18 }}
          contentFit="cover"
          onError={() => setLoadError(true)}
        />
      </View>
    );
  }

  return (
    <View style={styles.memberAvatar}>
      <Text style={{ color: "#f5f5f5", fontWeight: "700" }}>
        {member.name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export default function ChatScreen() {
  const { user, serverUrl, token } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { height: windowHeight } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        if (isNearBottomRef.current) {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      setChatScreenActive(true);
      void clearAppBadge();
      return () => {
        setChatScreenActive(false);
      };
    }, [])
  );

  const isKeyboardVisible = keyboardHeight > 0;

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
    setPinned,
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
  const actionBusyRef = useRef(false);
  const canPin = Boolean(
    user?.isAdmin || user?.role === "admin" || user?.role === "cr",
  );
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
    const newestConfirmed = messages.find(m => m.id > 0);
    if (!showScrollToBottom && newestConfirmed) void markRead(newestConfirmed.id);
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

  // Instant Reactions (Requirement 7: optimistic state & cache, background network, rollback on error)
  const handleToggleReaction = async (message: ChatMessage, emoji: string) => {
    const currentUserId = String(user?.studentId || "");
    if (!currentUserId || message.id <= 0) return;

    setActionMessage(null);

    const existingReaction = (message.reactions || []).find(
      (r) => String(r.studentId) === currentUserId,
    );
    let optimisticAction: "add" | "update" | "remove" = "add";
    if (existingReaction) {
      optimisticAction = existingReaction.emoji === emoji ? "remove" : "update";
    }

    const previousMessages = messages;
    setMessages((prev) =>
      applyChatReaction(prev, message.id, currentUserId, emoji, optimisticAction),
    );
    void updateCachedReaction(message.id, currentUserId, emoji, optimisticAction);

    try {
      const result = await reactToChatMessage(message.id, emoji);
      if (result.action !== optimisticAction) {
        setMessages((prev) =>
          applyChatReaction(prev, message.id, currentUserId, emoji, result.action),
        );
        void updateCachedReaction(message.id, currentUserId, emoji, result.action);
      }
    } catch (err: any) {
      setMessages(previousMessages);
      void updateCachedReaction(
        message.id,
        currentUserId,
        emoji,
        optimisticAction === "remove" ? "add" : "remove",
      );
      Alert.alert(
        "Reaction Failed",
        err.message || "Could not update reaction. Tap to retry.",
        [
          { text: "Dismiss" },
          { text: "Retry", onPress: () => void handleToggleReaction(message, emoji) },
        ],
      );
    }
  };

  // Instant Pin / Unpin (Requirement 7: optimistic state, background network, rollback on error)
  const handleTogglePin = async (message: ChatMessage) => {
    const isCurrentlyPinned = pinned?.messageId === message.id;
    setActionMessage(null);
    const previousPinned = pinned;

    if (isCurrentlyPinned) {
      setPinned(null);
      try {
        await unpinChatMessage();
        void refreshPinned();
      } catch (err: any) {
        setPinned(previousPinned);
        Alert.alert("Unpin Failed", err.message || "Could not unpin announcement.");
      }
    } else {
      const optimisticPinned = {
        messageId: message.id,
        text: message.text || message.attachmentOriginalName || "Attachment",
        senderName: message.name,
      };
      setPinned(optimisticPinned);
      try {
        await pinChatMessage(message.id);
        void refreshPinned();
      } catch (err: any) {
        setPinned(previousPinned);
        Alert.alert("Pin Failed", err.message || "Could not pin announcement.");
      }
    }
  };

  // Instant Delete (Requirement 7: optimistic state & cache, background network, rollback on error)
  const handleDeleteMessage = (msg: ChatMessage) => {
    Alert.alert(
      "Delete message?",
      msg.id > 0
        ? "This removes the message for everyone."
        : "Remove this unsent message from this device?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setActionMessage(null);
            const id = msg.id;
            const previousMessages = messages;
            const previousPinned = pinned;

            setMessages((previous) => previous.filter((m) => m.id !== id));
            if (pinned?.messageId === id) {
              setPinned(null);
            }

            void deleteCachedMessage(id);
            void removeOutboxFile(msg.localUri);

            if (id > 0) {
              try {
                await deleteChatMessage(id);
                void refreshPinned();
              } catch (err: any) {
                setMessages(previousMessages);
                setPinned(previousPinned);
                Alert.alert(
                  "Delete Failed",
                  err.message || "Could not delete message. Tap to retry.",
                  [
                    { text: "Dismiss" },
                    { text: "Retry", onPress: () => handleDeleteMessage(msg) },
                  ],
                );
              }
            }
          },
        },
      ],
    );
  };

  const handleSwipeReply = useCallback((message: ChatMessage) => {
    setReplyTo(message);
    inputRef.current?.focus();
  }, []);

  const handleOpenActions = useCallback((message: ChatMessage) => {
    setActionMessage(message);
  }, []);

  const handleOpenImage = useCallback((img: { uri: string; name: string }) => {
    setViewerImage(img);
  }, []);

  const handlePressAuthor = useCallback(
    (studentId: string) => {
      router.push({ pathname: "/user/[id]", params: { id: studentId } });
    },
    [router]
  );

  // Attachment Selection Handlers (Requirement 9: Camera, Photo Library, Documents)
  const handleTakePhoto = async () => {
    setShowAttachModal(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Camera access is needed to capture photos.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const attachment = await prepareChatAttachment(asset, true);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      Alert.alert("Camera Error", err.message || "Could not capture photo");
    }
  };

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
        const attachment = await prepareChatAttachment(asset, true);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
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
        const attachment = await prepareChatAttachment(asset);
        await removeOutboxFile(selectedAttachment?.uri);
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not pick document");
    }
  };

  // Instant Send Flow (Principles 1, 2, 4, 5, 8: non-blocking, client-generated UUID, in-place resolution)
  const handleSendMessage = useCallback(
    ({
      text,
      file,
      replyTo: replyTarget,
    }: {
      text: string;
      file: { uri: string; name: string; mimeType: string; isImage?: boolean } | null;
      replyTo: ChatMessage | null;
    }) => {
      const trimmed = text.trim();
      if (!trimmed && !file) return;
      if (trimmed.length > 2000) return;

      // 1. Generate client-side UUID and temporary negative ID
      const clientId =
        "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      const tempId = -Date.now();

      const optimisticMessage: ChatMessage = {
        id: tempId,
        clientId,
        text: trimmed,
        localUri: file ? file.uri : undefined,
        pendingFile: file
          ? {
              uri: file.uri,
              name: file.name,
              mimeType: file.mimeType,
            }
          : null,
        attachmentName: file
          ? file.isImage
            ? "pending_image.jpg"
            : "pending_document.pdf"
          : null,
        attachmentOriginalName: file?.name || null,
        attachmentMimeType: file?.mimeType || null,
        replyToId: replyTarget?.id || null,
        replyText:
          replyTarget?.text || replyTarget?.attachmentOriginalName || undefined,
        replySender: replyTarget?.name,
        createdAt: new Date().toISOString(),
        studentId: user?.studentId || "me",
        name: user?.name || "Me",
        avatarUrl: user?.avatarUrl || null,
        reactions: [],
        status: "pending",
      };

      // 2. Insert into in-memory list IMMEDIATELY (new messages prepended at top for inverted list)
      setMessages((prev) => [optimisticMessage, ...prev]);

      // 3. Persist to local SQLite asynchronously in background (never blocks JS thread)
      void savePendingMessage(optimisticMessage);

      // 4. Scroll to bottom instantly if near bottom
      isNearBottomRef.current = true;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      setShowScrollToBottom(false);

      // 5. Fire async network request in background (independent, non-blocking)
      sendChatMessage({
        text: trimmed,
        replyToId: replyTarget?.id,
        clientId,
        file: file
          ? {
              uri: file.uri,
              name: file.name,
              mimeType: file.mimeType,
            }
          : null,
      })
        .then(async (res) => {
          if (res && res.data) {
            const confirmedMsg: ChatMessage = {
              ...res.data,
              clientId,
              status: "sent",
            };
            await resolvePendingMessage(tempId, confirmedMsg);
            await removeOutboxFile(file?.uri);

            // In-place replacement: updates the temp message directly without removal & re-insertion (zero flicker/jump)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId || (m.clientId && m.clientId === clientId)
                  ? confirmedMsg
                  : m
              )
            );
          }
        })
        .catch(async (err: any) => {
          console.warn("Send message error:", err?.message || err);
          await markPendingMessageFailed(tempId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId || (m.clientId && m.clientId === clientId)
                ? { ...m, status: "failed" }
                : m
            )
          );
        });
    },
    [user, setMessages]
  );

  const handleRetryMessage = useCallback(
    async (failedMsg: ChatMessage) => {
      // 1. Reset status to pending in state & SQLite
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id || (failedMsg.clientId && m.clientId === failedMsg.clientId)
            ? { ...m, status: "pending" }
            : m
        )
      );
      void savePendingMessage({ ...failedMsg, status: "pending" });

      try {
        const res = await sendChatMessage({
          text: failedMsg.text,
          replyToId: failedMsg.replyToId,
          clientId: failedMsg.clientId,
          file:
            failedMsg.pendingFile ||
            (failedMsg.localUri
              ? {
                  uri: failedMsg.localUri,
                  name: failedMsg.attachmentOriginalName || "attachment.jpg",
                  mimeType: failedMsg.attachmentMimeType || "image/jpeg",
                }
              : null),
        });

        if (res && res.data) {
          const confirmedMsg: ChatMessage = {
            ...res.data,
            clientId: failedMsg.clientId,
            status: "sent",
          };
          await resolvePendingMessage(failedMsg.id, confirmedMsg);
          await removeOutboxFile(failedMsg.localUri);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === failedMsg.id || (failedMsg.clientId && m.clientId === failedMsg.clientId)
                ? confirmedMsg
                : m
            )
          );
        }
      } catch (err: any) {
        console.warn("Retry failed:", err?.message || err);
        await markPendingMessageFailed(failedMsg.id);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === failedMsg.id || (failedMsg.clientId && m.clientId === failedMsg.clientId)
              ? { ...m, status: "failed" }
              : m
          )
        );
      }
    },
    [setMessages]
  );

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
  const handleDownloadAttachment = useCallback(async (msg: ChatMessage) => {
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
  }, [serverUrl]);

  // Render message using the memoized ChatMessageItem component with stable references
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
          onOpenImage={handleOpenImage}
          onDownloadFile={handleDownloadAttachment}
          onToggleReaction={handleToggleReaction}
          onRetry={handleRetryMessage}
          onPressAuthor={handlePressAuthor}
        />
      );
    },
    [
      messages,
      highlightedMessageId,
      user?.studentId,
      readReceipts,
      serverUrl,
      token,
      downloadingFileId,
      handleOpenActions,
      handleSwipeReply,
      jumpToMessage,
      handleOpenImage,
      handleDownloadAttachment,
      handleToggleReaction,
      handleRetryMessage,
      handlePressAuthor,
    ]
  );

  return (
    <KeyboardAvoidingView
      style={styles.screenContainer}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
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
          keyExtractor={(item) => item.clientId || String(item.id)}
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
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={9}
          removeClippedSubviews={Platform.OS === "android"}
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

      {/* Replying banner, Attachment Preview, and Message Composer */}
      <ChatComposer
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        selectedAttachment={selectedAttachment}
        onClearAttachment={() => {
          void removeOutboxFile(selectedAttachment?.uri);
          setSelectedAttachment(null);
        }}
        onOpenAttachModal={() => setShowAttachModal(true)}
        onPickCamera={handlePickImage}
        onSendMessage={handleSendMessage}
        inputRef={inputRef}
        paddingBottom={isKeyboardVisible ? 8 : Math.max(insets.bottom, 8)}
        userAvailable={Boolean(user)}
      />

      {/* Class Members & Search Modal Panel */}
      <Modal
        visible={panel !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPanel(null)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.panelBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setPanel(null)}
            accessibilityLabel="Close panel"
          />
          <View
            style={[
              styles.panelSheet,
              { paddingBottom: Math.max(insets.bottom, 16) },
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
              multiline={false}
              numberOfLines={1}
              autoCorrect={false}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={{ maxHeight: 340 }}
            >
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
                      <TouchableOpacity
                        key={member.studentId}
                        style={styles.memberRow}
                        activeOpacity={0.7}
                        onPress={() => {
                          setPanel(null);
                          router.push({
                            pathname: '/user/[id]',
                            params: { id: member.studentId },
                          });
                        }}
                      >
                        <MemberAvatarItem
                          member={member}
                          serverUrl={serverUrl}
                          headers={imageAuthHeaders}
                        />
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
                        <Ionicons name="chevron-forward" size={16} color="#71717A" style={{ marginLeft: 6 }} />
                      </TouchableOpacity>
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

      {/* Overhauled Message Actions Sheet (Requirement 1 & 7: Instant Sheet & Haptics) */}
      <ChatMessageActionsSheet
        visible={Boolean(actionMessage)}
        message={actionMessage}
        busy={actionBusy}
        canPin={canPin}
        isPinned={pinned?.messageId === actionMessage?.id}
        isOwnerOrAdmin={Boolean(
          user?.isAdmin ||
            user?.role === "admin" ||
            String(actionMessage?.studentId) === String(user?.studentId),
        )}
        onClose={() => !actionBusy && setActionMessage(null)}
        onReact={(msg, emoji) => void handleToggleReaction(msg, emoji)}
        onReply={(msg) => {
          setReplyTo(msg);
          setActionMessage(null);
          inputRef.current?.focus();
        }}
        onCopy={(msg) => {
          if (msg.text) {
            void Clipboard.setStringAsync(msg.text);
            setActionMessage(null);
          }
        }}
        onPin={(msg) => void handleTogglePin(msg)}
        onDelete={(msg) => handleDeleteMessage(msg)}
      />

      {/* Attachment Action Sheet Modal (Requirement 9: Camera, Photos, Documents) */}
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

            {/* Take Photo with Camera */}
            <TouchableOpacity
              style={styles.attachOptionRow}
              onPress={handleTakePhoto}
            >
              <View style={styles.attachOptionIcon}>
                <Ionicons name="camera-outline" size={20} color="#e4e4e7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="md" weight="600" style={{ color: "#f5f5f5" }}>
                  Take Photo
                </Text>
                <Text variant="xs" style={{ color: "#71717a" }}>
                  Take a photo with your device camera
                </Text>
              </View>
            </TouchableOpacity>

            {/* Photo Library */}
            <TouchableOpacity
              style={styles.attachOptionRow}
              onPress={handlePickImage}
            >
              <View style={styles.attachOptionIcon}>
                <Ionicons name="image-outline" size={20} color="#e4e4e7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="md" weight="600" style={{ color: "#f5f5f5" }}>
                  Photo Library
                </Text>
                <Text variant="xs" style={{ color: "#71717a" }}>
                  Share photos, screenshots, or diagrams
                </Text>
              </View>
            </TouchableOpacity>

            {/* Document & File */}
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

      {/* Shared Full-Screen Image Viewer (Requirement 4: Same viewer as feed, zoom, swipe-down, tap to close) */}
      <FullScreenImageViewer
        visible={viewerImage !== null}
        imageUri={viewerImage?.uri || null}
        imageTitle={viewerImage?.name}
        headers={imageAuthHeaders}
        onClose={() => setViewerImage(null)}
      />
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
    includeFontPadding: false,
    textAlignVertical: "center",
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
    includeFontPadding: false,
    textAlignVertical: "center",
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
