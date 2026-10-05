import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { runOnJS } from "react-native-reanimated";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  Animated,
  StatusBar,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Pressable,
  ScrollView,
  Keyboard,
  BackHandler,
  useWindowDimensions,
  Dimensions,
} from "react-native";
import { KeyboardStickyView, useKeyboardHandler } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Clipboard from "expo-clipboard";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { StickyComposer, KeyboardContentBoundary } from "@/components/ui/StickyComposer";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { ChatMessageActionsSheet } from "@/components/chat/ChatMessageActionsSheet";
import { FullScreenImageViewer } from "@/components/FullScreenImageViewer";
import { useClassChat } from "@/hooks/useClassChat";
import {
  mergeChatMessages,
  applyChatReaction,
  safeChatFilename,
  shouldIncrementUnseenCounter,
  formatUnseenBadge,
} from "@/services/chat-state";
import { prepareChatAttachment, removeOutboxFile } from "@/services/chat-attachments";
import {
  savePendingMessage,
  resolvePendingMessage,
  markPendingMessageFailed,
  updateCachedReaction,
  deleteCachedMessage,
  upsertChatMessages,
} from "@/services/chat-db";

import { useAuth } from "@/context/AuthContext";
import { Text } from "@/components/ui/Typography";
import {
  ChatMessage,
  ChatMember,
  fetchChatMembers,
  fetchChatMessages,
  fetchExactChatMessage,
  pinChatMessage,
  unpinChatMessage,
  deleteChatMessage,
  reactToChatMessage,
  sendChatMessage,
  sendChatTyping,
} from "@/services/chat";
import { setChatScreenActive, clearAppBadge } from "@/services/notifications";
import { captureChatSession, getChatSession, isCurrentChatSession, subscribeChatSession } from '@/services/chat-session';

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

  useFocusEffect(
    useCallback(() => {
      setChatScreenActive(true);
      void clearAppBadge();
      return () => {
        setChatScreenActive(false);
      };
    }, [])
  );

  // Inverted list bottom tracking and unseen new incoming message counter
  const isNearBottomRef = useRef(true);
  const seenMessageIdsRef = useRef<Set<number | string>>(new Set());
  const [newIncomingCount, setNewIncomingCount] = useState(0);

  const handleNewIncomingMessage = useCallback(
    (newMsg: ChatMessage) => {
      const currentUserId = user?.studentId;
      const isNear = isNearBottomRef.current;
      if (
        shouldIncrementUnseenCounter(
          newMsg,
          currentUserId,
          isNear,
          seenMessageIdsRef.current
        )
      ) {
        seenMessageIdsRef.current.add(newMsg.id);
        if (newMsg.clientId) seenMessageIdsRef.current.add(newMsg.clientId);
        setNewIncomingCount((prev) => prev + 1);
      }
    },
    [user?.studentId]
  );

  const chatOptions = useMemo(
    () => ({ onNewIncomingMessage: handleNewIncomingMessage, authToken: token }),
    [handleNewIncomingMessage, token]
  );

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
    context,
    roomGeneration,
  } = useClassChat(user?.studentId, serverUrl, chatOptions);

  const { targetMessageId, targetChatGroupId } = useLocalSearchParams<{ targetMessageId?: string; targetChatGroupId?: string }>();
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

  // Preload group members on mount for instant zero-latency @mention suggestions
  useEffect(() => {
    if (!context?.chatGroupId) return;
    let mounted = true;
    void (async () => {
      try {
        const data = await fetchChatMembers();
        if (mounted && data.members) {
          setMembers(data.members);
        }
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [roomGeneration, context?.chatGroupId]);

  // Track initially loaded message IDs to disable slide animation on initial load and initialize seen set
  const initialLoadedIds = useRef(new Set<number>());
  useEffect(() => {
    if (!loadingInitial && messages.length > 0 && initialLoadedIds.current.size === 0) {
      messages.forEach((m) => {
        initialLoadedIds.current.add(m.id);
        if (m.id > 0) seenMessageIdsRef.current.add(m.id);
        if (m.clientId) seenMessageIdsRef.current.add(m.clientId);
      });
    }
  }, [loadingInitial, messages]);

  const [remoteSearch, setRemoteSearch] = useState<{query:string;generation:number;messages:ChatMessage[]}>({query:'',generation:0,messages:[]});
  useEffect(() => {
    let cancelled = false;
    if (!context?.chatGroupId || panel !== 'search' || !query.trim()) return;
    const timer = setTimeout(() => { void fetchChatMessages({q:query,limit:100}).then(data=>{
      if (!cancelled) setRemoteSearch({query,generation:roomGeneration,messages:data.messages});
    }).catch(()=>{}); },250);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[query,panel,roomGeneration,context?.chatGroupId]);
  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? mergeChatMessages(messages,remoteSearch.query===query && remoteSearch.generation===roomGeneration ? remoteSearch.messages : []).filter((message) =>
          `${message.text} ${message.name} ${message.attachmentOriginalName || ""}`
            .toLowerCase()
            .includes(term),
        )
      : [];
  }, [messages, remoteSearch, query, roomGeneration]);

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

  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  useEffect(() => {
    let generation=getChatSession().generation;
    return subscribeChatSession(()=>{
      if(generation===getChatSession().generation)return;
      generation=getChatSession().generation;
      setReplyTo(null);setActionMessage(null);setSelectedAttachment(null);setPanel(null);setQuery('');
      setMembers([]);setHighlightedMessageId(null);setNewIncomingCount(0);
      setDownloadingFileId(null);
      initialLoadedIds.current.clear();seenMessageIdsRef.current.clear();setShowAttachModal(false);setViewerImage(null);
    });
  }, []);

  // Refs
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const lastTypingSentRef = useRef<number>(0);
  const isPickerLaunchingRef = useRef<boolean>(false);
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

  const isArchived = Boolean(
    context && (
      context.cohortStatus === "graduated" ||
      context.roomStatus === "closed" ||
      (context.permissions && context.permissions.canPost === false)
    )
  );

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
      setNewIncomingCount(0);
    }, []),
  );

  // Keyboard-aware scroll: when the keyboard finishes appearing and the user
  // is reading the latest messages, scroll the inverted list to offset 0 so
  // the newest message stays visible above the composer.  This is the root
  // fix for the bug where messages disappear behind the keyboard on Android.
  const scrollToBottomIfNeeded = useCallback(() => {
    if (isNearBottomRef.current) {
      // Let the layout settle after the resize before scrolling
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
    }
  }, []);

  useKeyboardHandler({
    onEnd: (e) => {
      "worklet";
      // Only auto-scroll when the keyboard has just opened (height > 0)
      if (e.height > 0) {
        runOnJS(scrollToBottomIfNeeded)();
      }
    },
  }, [scrollToBottomIfNeeded]);

  // Handle Android hardware back press when attachment overlay is open
  useEffect(() => {
    if (!showAttachModal) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowAttachModal(false);
      return true;
    });
    return () => sub.remove();
  }, [showAttachModal]);

  useEffect(() => {
    const newestConfirmed = messages.find(m => m.id > 0);
    if (!showScrollToBottom && newestConfirmed) void markRead(newestConfirmed.id);
  }, [messages, showScrollToBottom, markRead]);

  const openMembers = async () => {
    const start = getChatSession();
    if (!isCurrentChatSession(start)) return;
    setQuery("");
    setPanel("members");
    setMembersLoading(true);
    setMembersError(false);
    try {
      const data = await fetchChatMembers();
      if (!isCurrentChatSession(start)) return;
      setMembers(data.members || []);
    } catch {
      if (!isCurrentChatSession(start)) return;
      setMembersError(true);
    } finally {
      if (isCurrentChatSession(start)) setMembersLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showAttachModal || viewerImage || Keyboard.isVisible()) return false;
      router.navigate('/(tabs)'); return true;
    });
    return () => back.remove();
  }, [router, showAttachModal, viewerImage]));

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

  // Deep Link: automatically jump and highlight exact message from push notification
  const handledTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetMessageId || !context?.chatGroupId || handledTargetRef.current === `${targetChatGroupId}:${targetMessageId}`) return;
    const tid = Number(targetMessageId);
    if (!Number.isFinite(tid) || tid <= 0) return;

    handledTargetRef.current = `${targetChatGroupId}:${targetMessageId}`;
    let cancelled = false;
    const start = captureChatSession();
    void (async () => {
      try {
        const message = await fetchExactChatMessage(targetChatGroupId || '',tid);
        if (cancelled || !isCurrentChatSession(start)) return;
        await upsertChatMessages([message]);
        if (cancelled || !isCurrentChatSession(start)) return;
        setMessages(prev => mergeChatMessages(prev,[message]));
        setHighlightedMessageId(tid);
        router.setParams({ targetMessageId: '', targetChatGroupId: '' });
      } catch {
        if (!cancelled && isCurrentChatSession(start)) Alert.alert('Conversation unavailable','This conversation is no longer available.');
      }
    })();
    return () => { cancelled = true; };
  }, [targetMessageId, targetChatGroupId, roomGeneration, context?.chatGroupId, router, setMessages]);
  useEffect(() => {
    if (highlightedMessageId && messages.some(m=>m.id === highlightedMessageId)) {
      const timer = setTimeout(()=>jumpToMessage(highlightedMessageId),150);
      return ()=>clearTimeout(timer);
    }
  }, [highlightedMessageId, messages, jumpToMessage]);

  const handlePressMention = useCallback(
    (handle: string, item?: ChatMessage) => {
      const lower = handle.toLowerCase();
      // 1. Structured mention metadata resolution (stable across username/handle updates)
      if (item?.mentionsDetail && Array.isArray(item.mentionsDetail)) {
        const directMatch = item.mentionsDetail.find(
          (m) =>
            (m.handle && m.handle.toLowerCase() === lower) ||
            (m.studentId && m.studentId.toLowerCase() === lower)
        );
        if (directMatch?.studentId) {
          router.push({ pathname: "/user/[id]", params: { id: directMatch.studentId } });
          return;
        }
      }
      // If single mention on message, route directly to it
      if (item?.mentions && item.mentions.length === 1) {
        router.push({ pathname: "/user/[id]", params: { id: item.mentions[0] } });
        return;
      }
      // 2. Fallback: lookup current members list
      const targetMember = members.find(
        (m) =>
          (m.username && m.username.toLowerCase() === lower) ||
          m.studentId.toLowerCase() === lower ||
          m.name.toLowerCase().replace(/\s+/g, "_") === lower
      );
      const targetId = targetMember ? targetMember.studentId : handle;
      router.push({ pathname: "/user/[id]", params: { id: targetId } });
    },
    [members, router]
  );

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
    const start = getChatSession();
    if (!isCurrentChatSession(start) || message.chatGroupId !== start.context?.chatGroupId) return;
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
      if (!isCurrentChatSession(start)) return;
      if (result.action !== optimisticAction) {
        setMessages((prev) =>
          applyChatReaction(prev, message.id, currentUserId, emoji, result.action),
        );
        void updateCachedReaction(message.id, currentUserId, emoji, result.action);
      }
    } catch (err: any) {
      if (!isCurrentChatSession(start)) return;
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
    const start = getChatSession();
    if (!isCurrentChatSession(start) || message.chatGroupId !== start.context?.chatGroupId) return;
    const isCurrentlyPinned = pinned?.messageId === message.id;
    setActionMessage(null);
    const previousPinned = pinned;

    if (isCurrentlyPinned) {
      setPinned(null);
      try {
        await unpinChatMessage();
        if (!isCurrentChatSession(start)) return;
        void refreshPinned();
      } catch (err: any) {
        if (!isCurrentChatSession(start)) return;
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
        if (!isCurrentChatSession(start)) return;
        void refreshPinned();
      } catch (err: any) {
        if (!isCurrentChatSession(start)) return;
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
            const start = getChatSession();
            if (!isCurrentChatSession(start) || msg.chatGroupId !== start.context?.chatGroupId) return;
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
                if (!isCurrentChatSession(start)) return;
                void refreshPinned();
              } catch (err: any) {
                if (!isCurrentChatSession(start)) return;
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
    const start = getChatSession();
    if (!isCurrentChatSession(start)) return;
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    if (__DEV__) {
      console.log("[ChatAttachment] handleTakePhoto entered");
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (__DEV__) {
        console.log("[ChatAttachment] Camera permission status:", status);
      }
      if (status !== "granted") {
        setShowAttachModal(false);
        Alert.alert(
          "Permission Required",
          "Camera access is needed to capture photos.",
        );
        return;
      }
      if (__DEV__) {
        console.log("[ChatAttachment] Launching camera...");
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });

      if (__DEV__) {
        console.log("[ChatAttachment] Camera result:", {
          canceled: result.canceled,
          assetCount: result.assets ? result.assets.length : 0,
        });
      }

      setShowAttachModal(false);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const attachment = await prepareChatAttachment(asset, true);
        await removeOutboxFile(selectedAttachment?.uri);
        if (!isCurrentChatSession(start)) { await removeOutboxFile(attachment.uri); return; }
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      if (__DEV__) {
        console.error("[ChatAttachment] handleTakePhoto error:", err);
      }
      Alert.alert("Camera Error", err.message || "Unable to open camera. Please try again.");
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  const handlePickImage = async () => {
    const start = getChatSession();
    if (!isCurrentChatSession(start)) return;
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    if (__DEV__) {
      console.log("[ChatAttachment] handlePickImage entered");
    }
    try {
      if (__DEV__) {
        console.log("[ChatAttachment] Launching photo library...");
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });

      if (__DEV__) {
        console.log("[ChatAttachment] Photo library result:", {
          canceled: result.canceled,
          assetCount: result.assets ? result.assets.length : 0,
        });
      }

      setShowAttachModal(false);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const attachment = await prepareChatAttachment(asset, true);
        await removeOutboxFile(selectedAttachment?.uri);
        if (!isCurrentChatSession(start)) { await removeOutboxFile(attachment.uri); return; }
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      if (__DEV__) {
        console.error("[ChatAttachment] handlePickImage error:", err);
      }
      Alert.alert("Error", err.message || "Unable to open photo library. Please try again.");
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  const handlePickDocument = async () => {
    const start = getChatSession();
    if (!isCurrentChatSession(start)) return;
    if (isPickerLaunchingRef.current) return;
    isPickerLaunchingRef.current = true;
    if (__DEV__) {
      console.log("[ChatAttachment] handlePickDocument entered");
    }
    try {
      if (__DEV__) {
        console.log("[ChatAttachment] Launching document picker...");
      }
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (__DEV__) {
        console.log("[ChatAttachment] Document picker result:", {
          canceled: res.canceled,
          assetCount: res.assets ? res.assets.length : 0,
        });
      }

      setShowAttachModal(false);

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        const attachment = await prepareChatAttachment(asset);
        await removeOutboxFile(selectedAttachment?.uri);
        if (!isCurrentChatSession(start)) { await removeOutboxFile(attachment.uri); return; }
        setSelectedAttachment(attachment);
      }
    } catch (err: any) {
      setShowAttachModal(false);
      if (__DEV__) {
        console.error("[ChatAttachment] handlePickDocument error:", err);
      }
      Alert.alert("Error", err.message || "Unable to open file picker. Please try again.");
    } finally {
      isPickerLaunchingRef.current = false;
    }
  };

  // Instant Send Flow (Principles 1, 2, 4, 5, 8: non-blocking, client-generated UUID, in-place resolution)
  const handleSendMessage = useCallback(
    ({
      text,
      file,
      replyTo: replyTarget,
      mentions,
    }: {
      text: string;
      file: { uri: string; name: string; mimeType: string; isImage?: boolean; size?: number } | null;
      replyTo: ChatMessage | null;
      mentions?: string[];
    }) => {
      const start = getChatSession();
      if (!isCurrentChatSession(start) || !start.context) return;
      const trimmed = text.trim();
      if (!trimmed && !file) return;
      if (trimmed.length > 2000) return;

      // Clear composer attachment selection immediately so UI updates
      setSelectedAttachment(null);

      // 1. Generate client-side UUID and temporary negative ID
      const clientId =
        "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      const tempId = -Date.now();

      const optimisticMessage: ChatMessage = {
        chatGroupId: start.context.chatGroupId,
        id: tempId,
        clientId,
        text: trimmed,
        localUri: file ? file.uri : undefined,
        pendingFile: file
          ? {
              uri: file.uri,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
            }
          : null,
        attachmentName: file
          ? file.isImage
            ? "pending_image.jpg"
            : "pending_document.pdf"
          : null,
        attachmentOriginalName: file?.name || null,
        attachmentMimeType: file?.mimeType || null,
        attachmentSize: file?.size || null,
        replyToId: replyTarget?.id || null,
        replyText:
          replyTarget?.text || replyTarget?.attachmentOriginalName || undefined,
        replySender: replyTarget?.name,
        createdAt: new Date().toISOString(),
        studentId: user?.studentId || "me",
        name: user?.name || "Me",
        avatarUrl: user?.avatarUrl || null,
        reactions: [],
        mentions: mentions || [],
        status: "pending",
      };

      // 2. Insert into in-memory list IMMEDIATELY (new messages prepended at top for inverted list)
      setMessages((prev) => [optimisticMessage, ...prev]);

      // 3. Persist to local SQLite asynchronously in background (never blocks JS thread)
      void savePendingMessage(optimisticMessage);

      // 4. Scroll to bottom instantly if near bottom and reset unread count
      isNearBottomRef.current = true;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      setShowScrollToBottom(false);
      setNewIncomingCount(0);

      // 5. Fire async network request in background (independent, non-blocking)
      sendChatMessage({
        chatGroupId: start.context.chatGroupId,
        text: trimmed,
        replyToId: replyTarget?.id,
        clientId,
        mentions: mentions || [],
        file: file
          ? {
              uri: file.uri,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
            }
          : null,
      })
        .then(async (res) => {
          if (!isCurrentChatSession(start)) return;
          if (res && res.data) {
            const confirmedMsg: ChatMessage = {
              ...res.data,
              attachmentSize: file?.size || res.data.attachmentSize || null,
              clientId,
              status: "sent",
            };
            await resolvePendingMessage(tempId, confirmedMsg);
            await removeOutboxFile(file?.uri);
            if (!isCurrentChatSession(start)) return;

            // In-place replacement: updates the temp message directly without removal & re-insertion (zero flicker/jump)
            setMessages((prev) => mergeChatMessages(prev, [confirmedMsg]));
          }
        })
        .catch(async (err: any) => {
          if (!isCurrentChatSession(start)) return;
          console.warn("Send message error:", err?.message || err);
          await markPendingMessageFailed(tempId);
          if (!isCurrentChatSession(start)) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId || (m.studentId === start.account && m.clientId === clientId)
                ? { ...m, status: "failed" }
                : m
            )
          );
          if (file) {
            Alert.alert(
              "Upload Failed",
              err?.message || "Could not upload attachment. Tap the alert icon on the message to retry."
            );
          }
        });
    },
    [user, setMessages]
  );

  const handleRetryMessage = useCallback(
    async (failedMsg: ChatMessage) => {
      const start = getChatSession();
      if (!isCurrentChatSession(start) || failedMsg.chatGroupId !== start.context?.chatGroupId || !failedMsg.clientId) {
        Alert.alert('Conversation unavailable','This conversation is no longer available.'); return;
      }
      // 1. Reset status to pending in state & SQLite
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id || (m.studentId === failedMsg.studentId && m.clientId === failedMsg.clientId)
            ? { ...m, status: "pending" }
            : m
        )
      );
      void savePendingMessage({ ...failedMsg, status: "pending" });

      try {
        const res = await sendChatMessage({
          chatGroupId: failedMsg.chatGroupId,
          text: failedMsg.text,
          replyToId: failedMsg.replyToId,
          clientId: failedMsg.clientId,
          mentions: failedMsg.mentions,
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

        if (!isCurrentChatSession(start)) return;
        if (res && res.data) {
          const confirmedMsg: ChatMessage = {
            ...res.data,
            attachmentSize: failedMsg.attachmentSize || failedMsg.pendingFile?.size || res.data.attachmentSize || null,
            clientId: failedMsg.clientId,
            status: "sent",
          };
          await resolvePendingMessage(failedMsg.id, confirmedMsg);
          await removeOutboxFile(failedMsg.localUri);
          if (!isCurrentChatSession(start)) return;
          setMessages((prev) => mergeChatMessages(prev, [confirmedMsg]));
        }
      } catch (err: any) {
        if (!isCurrentChatSession(start)) return;
        console.warn("Retry failed:", err?.message || err);
        await markPendingMessageFailed(failedMsg.id);
        if (!isCurrentChatSession(start)) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === failedMsg.id || (m.studentId === failedMsg.studentId && m.clientId === failedMsg.clientId)
              ? { ...m, status: "failed" }
              : m
          )
        );
      }
    },
    [setMessages]
  );

  // Scroll tracking in inverted list: offset 0 is newest messages (bottom)
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset } = event.nativeEvent;
    const distanceToBottom = Math.max(0, contentOffset.y);
    const isNear = distanceToBottom <= 60;
    isNearBottomRef.current = isNear;
    setShowScrollToBottom(!isNear);
    if (isNear) {
      setNewIncomingCount(0);
      messages.forEach((m) => {
        if (m.id > 0) seenMessageIdsRef.current.add(m.id);
        if (m.clientId) seenMessageIdsRef.current.add(m.clientId);
      });
    }
  };

  const handleJumpToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    setNewIncomingCount(0);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    messages.forEach((m) => {
      if (m.id > 0) seenMessageIdsRef.current.add(m.id);
      if (m.clientId) seenMessageIdsRef.current.add(m.clientId);
    });
  }, [messages]);

  // Document Download & Open Handler
  const handleDownloadAttachment = useCallback(async (msg: ChatMessage) => {
    const start = getChatSession();
    if (!msg.attachmentName || !isCurrentChatSession(start) || msg.chatGroupId !== start.context?.chatGroupId) return;
    const filename = msg.attachmentName;
    const originalName = msg.attachmentOriginalName || filename;
    const fileUrl = `${start.server}/api/chat/attachment/${encodeURIComponent(filename)}?chatGroupId=${encodeURIComponent(msg.chatGroupId)}`;

    try {
      setDownloadingFileId(String(msg.id));
      const targetDir = FileSystem.cacheDirectory || "";
      if (!targetDir) throw new Error("File storage is unavailable.");
      const localUri = `${targetDir}chat-${start.generation}-${msg.id}-${safeChatFilename(originalName)}`;

      const downloadHeaders: Record<string, string> = {};
      if (start.credential) downloadHeaders["Authorization"] = `Bearer ${start.credential}`;

      const res = await FileSystem.downloadAsync(fileUrl, localUri, {
        headers: downloadHeaders,
      });
      if (!isCurrentChatSession(start)) {
        await FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
        return;
      }
      if (res.status === 200) {
        const canShare = await Sharing.isAvailableAsync();
        if (!isCurrentChatSession(start)) {
          await FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
          return;
        }
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
      if (!isCurrentChatSession(start)) return;
      Alert.alert(
        "Download Error",
        err.message || "Failed to download attachment",
      );
    } finally {
      if (isCurrentChatSession(start)) setDownloadingFileId(null);
    }
  }, []);

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
          onPressMention={handlePressMention}
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
      handlePressMention,
    ]
  );

  return (
    <View style={styles.screenContainer}>
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
              {context
                ? `${context.cohortDisplayName || (context.groupCode.charAt(0) + context.groupCode.slice(1).toLowerCase())} • ${context.cohortStatus === "graduated" ? "Graduated" : `Semester ${context.currentSemester}`}`
                : "Class Chat"}
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

      {/* Archived Banner */}
      {isArchived && (
        <View style={styles.archivedBanner}>
          <Ionicons name="archive-outline" size={16} color="#e4e4e7" />
          <Text style={styles.archivedBannerText}>
            This cohort has graduated. Conversation is in read-only mode.
          </Text>
        </View>
      )}

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

      {/* Main Message List & Viewport Boundary */}
      <KeyboardContentBoundary style={styles.messagesBoundary}>
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
            keyExtractor={(item) => item.clientId ? `${item.studentId}:${item.clientId}` : String(item.id)}
            renderItem={renderMessageItem}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesFeed}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustContentInsets={false}
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

        {/* Floating Scroll to Bottom Button */}
        {showScrollToBottom && (
          <View
            style={[
              styles.floatingScrollContainer,
              activeTypers.size > 0 && (styles.floatingScrollContainerWithTyping || styles.floatingScrollBtnWithTyping),
            ]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.floatingScrollBtn}
              onPress={handleJumpToBottom}
              activeOpacity={0.8}
              accessibilityLabel={
                newIncomingCount > 0
                  ? `Scroll to bottom, ${newIncomingCount} new message${newIncomingCount > 1 ? "s" : ""}`
                  : "Scroll to bottom"
              }
            >
              <Ionicons name="chevron-down" size={19} color="#f5f5f5" />
            </TouchableOpacity>
            {newIncomingCount > 0 && (
              <View style={styles.floatingBadgePill} pointerEvents="none">
                <Text style={styles.floatingBadgeText}>
                  {formatUnseenBadge(newIncomingCount)}
                </Text>
              </View>
            )}
          </View>
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
      </KeyboardContentBoundary>

      {/* Replying banner, Attachment Preview, and Message Composer */}
      <StickyComposer bordered>
        {isArchived ? (
          <View style={styles.archivedComposerNotice}>
            <Ionicons name="lock-closed-outline" size={18} color="#a1a1aa" style={{ marginRight: 8 }} />
            <Text variant="sm" style={styles.archivedComposerText}>
              This cohort has graduated. Conversation is read-only.
            </Text>
          </View>
        ) : (
          <ChatComposer
            key={`${user?.studentId}:${roomGeneration}`}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            selectedAttachment={selectedAttachment}
            onClearAttachment={() => {
              void removeOutboxFile(selectedAttachment?.uri);
              setSelectedAttachment(null);
            }}
            onOpenAttachModal={() => {
              Keyboard.dismiss();
              setShowAttachModal(true);
            }}
            onPickCamera={handleTakePhoto}
            onSendMessage={handleSendMessage}
            inputRef={inputRef}
            userAvailable={Boolean(user && context)}
            members={members}
            serverUrl={serverUrl}
            currentUserId={user?.studentId}
          />
        )}
      </StickyComposer>

      {/* Class Members & Search Modal Panel */}
      <Modal
        visible={panel !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPanel(null)}
        statusBarTranslucent
      >
        <KeyboardStickyView
          style={styles.panelBackdrop}
          offset={{ closed: 0, opened: insets.bottom }}
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
        </KeyboardStickyView>
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

      {/* Attachment Action Sheet (Rendered in-tree to prevent Android native Dialog window conflicts) */}
      {showAttachModal && (
        <View style={styles.attachOverlayWrapper}>
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowAttachModal(false)}
            accessibilityLabel="Close attachment options"
          />
          <View
            style={[
              styles.attachSheetContainer,
              { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
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
              onPress={() => void handleTakePhoto()}
              activeOpacity={0.7}
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
              onPress={() => void handlePickImage()}
              activeOpacity={0.7}
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
              onPress={() => void handlePickDocument()}
              activeOpacity={0.7}
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
              activeOpacity={0.7}
            >
              <Text variant="sm" weight="600" style={{ color: "#a1a1aa" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Shared Full-Screen Image Viewer (Requirement 4: Same viewer as feed, zoom, swipe-down, tap to close) */}
      <FullScreenImageViewer
        visible={viewerImage !== null}
        imageUri={viewerImage?.uri || null}
        imageTitle={viewerImage?.name}
        headers={imageAuthHeaders}
        onClose={() => setViewerImage(null)}
      />
    </View>
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
  messagesBoundary: {
    flex: 1,
    position: "relative",
  },
  messagesList: {
    flex: 1,
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
  floatingScrollContainer: {
    position: "absolute",
    right: 16,
    bottom: 14, // Floating clearly above composer inside boundary
    zIndex: 99,
  },
  floatingScrollContainerWithTyping: {
    bottom: 44,
  },
  floatingScrollBtnWithTyping: {
    bottom: 44,
  },
  floatingScrollBtn: {
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
  },
  floatingBadgePill: {
    position: "absolute",
    top: -6,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18181b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  floatingBadgeText: {
    color: "#0a0a0a",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    includeFontPadding: false,
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
  attachOverlayWrapper: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    zIndex: 999,
    elevation: 20,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.7)",
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
  archivedBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#27272a",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#3f3f46",
  },
  archivedBannerText: {
    color: "#e4e4e7",
    fontSize: 13,
    fontWeight: "500",
  },
  archivedComposerNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#18181b",
  },
  archivedComposerText: {
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: "500",
  },
});
