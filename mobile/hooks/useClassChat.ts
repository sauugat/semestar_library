import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  CHAT_LATEST_CURSOR,
  CHAT_PAGE_SIZE,
  ChatMessage,
  ChatPinned,
  ChatReadReceipt,
  fetchChatMessages,
  fetchChatPinned,
  markChatRead,
} from "@/services/chat";
import {
  applyChatReaction,
  mergeChatMessages,
  reconcileChatSnapshot,
} from "@/services/chat-state";
import {
  getCachedChatMessages,
  getNewestCachedMessageId,
  upsertChatMessages,
  configureChatCache,
  getMemoryChatMessages,
  reconcileCachedChat,
} from "@/services/chat-db";
import {
  initChatRealtime,
  subscribeChatRealtime,
  trackChatPresence,
} from "@/services/chat-realtime";

type Typer = { name: string; expiresAt: number };

export interface UseClassChatOptions {
  onNewIncomingMessage?: (message: ChatMessage) => void;
}

export function useClassChat(
  studentId: string | undefined,
  serverUrl: string,
  options?: UseClassChatOptions
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTypers, setActiveTypers] = useState(new Map<string, Typer>());
  const [readReceipts, setReadReceipts] = useState<ChatReadReceipt[]>([]);
  const [pinned, setPinned] = useState<ChatPinned | null>(null);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const generation = useRef(0);
  const active = useRef(false);
  const syncing = useRef(false);
  const paging = useRef(false);
  const hydrated = useRef(false);
  const snapshotCursor = useRef<number | null>(null);

  const refreshPinned = useCallback(async () => {
    const epoch = generation.current;
    try {
      const data = await fetchChatPinned();
      if (active.current && epoch === generation.current) {
        setPinned(data.pinned);
      }
    } catch {
      /* Optional metadata must not block chat */
    }
  }, []);

  // Delta sync and reconciliation
  const sync = useCallback(async () => {
    if (
      !active.current ||
      syncing.current ||
      paging.current ||
      !hydrated.current ||
      AppState.currentState === "background"
    ) {
      return;
    }

    const epoch = generation.current;
    syncing.current = true;

    try {
      const newestCachedId = await getNewestCachedMessageId();

      // Fetch the newest window directly. If we were offline longer than this
      // window, discard the disconnected history segment; paging fills it back
      // from the server instead of silently skipping a gap with MAX(id).
      const data = await fetchChatMessages({ before: CHAT_LATEST_CURSOR, limit: CHAT_PAGE_SIZE });
      if (!active.current || epoch !== generation.current) return;
      const incoming = data.messages || [];
      const reset = snapshotCursor.current === null;
      const confirmedId = newestCachedId;
      const previousSnapshotId = snapshotCursor.current ?? newestCachedId;
      setMessages(previous => reset
        ? mergeChatMessages(previous.filter(m => m.id < 0 || m.id > confirmedId), incoming)
        : reconcileChatSnapshot(previous, incoming, confirmedId, previousSnapshotId));
      snapshotCursor.current = Math.max(0, ...incoming.map(m => m.id));
      if (reset || (incoming.length > 0 && Math.min(...incoming.map(m => m.id)) > previousSnapshotId)) {
        setHasMore(incoming.length >= CHAT_PAGE_SIZE);
      }
      if (data.readReceipts) setReadReceipts(data.readReceipts);
      if (data.typing) {
        setActiveTypers(new Map(data.typing
          .filter(t => String(t.studentId) !== String(studentId))
          .map(t => [String(t.studentId), { name: t.name, expiresAt: new Date(t.timestamp).getTime() + 3500 }])));
      }
      if (hydrated.current && !reset && incoming.length > 0) {
        incoming.forEach((m) => {
          if (m.id > confirmedId && String(m.studentId) !== String(studentId)) {
            optionsRef.current?.onNewIncomingMessage?.(m);
          }
        });
      }
      await reconcileCachedChat(incoming, confirmedId, reset, previousSnapshotId);
      if (!active.current || epoch !== generation.current) return;

      setError(null);
    } catch (err: any) {
      if (active.current && epoch === generation.current) {
        setError(err.message || "Unable to sync messages. Retrying in background...");
      }
    } finally {
      if (epoch === generation.current) {
        syncing.current = false;
        setLoadingInitial(false);
      }
    }
  }, [studentId]);

  // Main lifecycle: Local-first instant load + Realtime Singleton subscription
  useFocusEffect(
    useCallback(() => {
      if (!studentId || !serverUrl) return;

      const epoch = ++generation.current;
      active.current = true;
      syncing.current = false;
      paging.current = false;

      hydrated.current = false;
      snapshotCursor.current = null;
      configureChatCache(serverUrl, studentId);
      const immediate = getMemoryChatMessages();
      setMessages(immediate);
      setLoadingInitial(immediate.length === 0);
      setHasMore(true);
      setError(null);
      setReadReceipts([]);
      setPinned(null);
      setOnlineIds([]);
      setActiveTypers(new Map());
      void (async () => {
        const cached = await getCachedChatMessages(50);
        if (!active.current || epoch !== generation.current) return;
        setMessages(previous => mergeChatMessages(cached, previous));
        hydrated.current = true;
        if (cached.length) setLoadingInitial(false);
        void sync();
        void initChatRealtime(studentId, serverUrl).then(() => {
          if (active.current && epoch === generation.current) void trackChatPresence({ studentId });
        });
      })();

      const unsubscribe = subscribeChatRealtime({
        onNewMessage: (newMsg) => {
          if (!active.current) return;
          let isNew = false;
          setMessages((prev) => {
            const existingIndex = prev.findIndex(
              (m) =>
                (newMsg.clientId && m.clientId === newMsg.clientId) ||
                m.id === newMsg.id
            );
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = {
                ...next[existingIndex],
                ...newMsg,
                id: newMsg.id,
                status: 'sent',
              };
              return next;
            }
            isNew = true;
            return [newMsg, ...prev];
          });
          setActiveTypers((prev) => {
            const next = new Map(prev);
            next.delete(String(newMsg.studentId));
            return next;
          });
          if (isNew && String(newMsg.studentId) !== String(studentId)) {
            optionsRef.current?.onNewIncomingMessage?.(newMsg);
          }
        },
        onDeleteMessage: (deletedId) => {
          if (!active.current) return;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId).map(m => m.replyToId === deletedId
            ? { ...m, replyToId: null, replyText: undefined, replySender: undefined } : m));
          void refreshPinned();
        },
        onTyping: (name, senderId) => {
          if (!active.current) return;
          setActiveTypers((prev) =>
            new Map(prev).set(senderId, {
              name,
              expiresAt: Date.now() + 3500,
            })
          );
        },
        onReaction: (messageId, emoji, senderId, action) => {
          if (!active.current) return;
          if (String(senderId) === String(studentId)) {
            // Already updated optimistically on local device - ignore realtime echo
            return;
          }
          setMessages(previous => applyChatReaction(previous, messageId, senderId, emoji, action));
        },
        onPin: () => { void refreshPinned(); },
        onRead: (receipt) => {
          if (active.current) setReadReceipts(previous => [
            ...previous.filter(r => String(r.studentId) !== String(receipt.studentId)),
            { ...receipt, lastReadMessageId: Math.max(receipt.lastReadMessageId, previous.find(r => String(r.studentId) === String(receipt.studentId))?.lastReadMessageId || 0) },
          ]);
        },
        onOnlineUsers: (ids) => {
          if (active.current) setOnlineIds(ids);
        },
        onConnectionChange: (connected) => {
          if (active.current) {
            setIsConnected(connected);
            if (connected) void sync();
          }
        },
      });

      // 3. Kick off background delta sync & pinned announcements
      void sync();
      void refreshPinned();

      // Prune expired typers
      const pruneInterval = setInterval(() => {
        setActiveTypers((prev) => {
          const now = Date.now();
          let changed = false;
          const next = new Map();
          for (const [id, typer] of prev.entries()) {
            if (typer.expiresAt > now) {
              next.set(id, typer);
            } else {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }, 1000);

      // Low-frequency fallback sync
      const pollInterval = setInterval(() => {
        void sync();
        void refreshPinned();
      }, 3500);

      // AppState foreground listener
      const appStateSub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void sync();
          void refreshPinned();
        }
      });

      return () => {
        active.current = false;
        if (generation.current === epoch) generation.current++;
        unsubscribe();
        clearInterval(pruneInterval);
        clearInterval(pollInterval);
        appStateSub.remove();
        // NOTE: We deliberately do NOT destroy the Supabase client here.
        // It stays alive as a singleton so reopening Chat does not reconnect from scratch.
      };
    }, [studentId, serverUrl, sync, refreshPinned]),
  );

  // Refresh older pages from the server; fall back to disk when offline.
  const loadOlderMessages = useCallback(async () => {
    if (
      !active.current ||
      paging.current ||
      syncing.current ||
      !hasMore ||
      messages.length === 0
    ) {
      return;
    }

    const epoch = generation.current;
    paging.current = true;
    setLoadingMore(true);

    // Find the oldest message ID currently loaded
    const oldestId = Math.min(...messages.map((m) => m.id).filter((id) => id > 0));
    if (!Number.isFinite(oldestId)) { paging.current = false; setLoadingMore(false); return; }

    try {
      // 2. If SQLite doesn't have older messages, fetch from network
      const netData = await fetchChatMessages({
        before: oldestId,
        limit: 30,
      });

      if (!active.current || epoch !== generation.current) return;

      const incoming = netData.messages || [];
      if (incoming.length > 0) {
        await upsertChatMessages(incoming);
        setMessages((prev) => mergeChatMessages(incoming, prev));
        setHasMore(incoming.length >= 30);
      } else {
        setHasMore(false);
      }
    } catch {
      const cachedOlder = await getCachedChatMessages(30, oldestId);
      if (active.current && epoch === generation.current) {
        setMessages(previous => mergeChatMessages(cachedOlder, previous));
        setError("Couldn't load older messages. Check your connection and retry.");
      }
      // Paging failure is non-fatal
    } finally {
      if (epoch === generation.current) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, messages]);

  const markRead = useCallback(async (lastReadMessageId: number) => {
    if (!active.current || AppState.currentState === "background" || lastReadMessageId <= 0) return;
    try {
      await markChatRead(lastReadMessageId);
    } catch {
      // Non-critical, ignore read receipt errors
    }
  }, []);

  return {
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
    loadOlderMessages,
    sync,
    refreshPinned,
    markRead,
  };
}
