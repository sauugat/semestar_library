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
  mergeChatMessages,
  reconcileChatSnapshot,
} from "@/services/chat-state";
import {
  getCachedChatMessages,
  getNewestCachedMessageId,
  upsertChatMessages,
  deleteCachedMessage,
} from "@/services/chat-db";
import {
  initChatRealtime,
  subscribeChatRealtime,
  trackChatPresence,
} from "@/services/chat-realtime";

type Typer = { name: string; expiresAt: number };

export function useClassChat(studentId: string | undefined, serverUrl: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTypers, setActiveTypers] = useState(new Map<string, Typer>());
  const [readReceipts, setReadReceipts] = useState<ChatReadReceipt[]>([]);
  const [pinned, setPinned] = useState<ChatPinned | null>(null);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const generation = useRef(0);
  const active = useRef(false);
  const syncing = useRef(false);
  const paging = useRef(false);
  const initialCacheLoaded = useRef(false);

  const refreshPinned = useCallback(async () => {
    try {
      const data = await fetchChatPinned();
      if (active.current) {
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
      AppState.currentState === "background"
    ) {
      return;
    }

    const epoch = generation.current;
    syncing.current = true;

    try {
      const newestCachedId = await getNewestCachedMessageId();

      if (newestCachedId > 0) {
        // Fetch only delta: messages newer than our newest cached id
        const deltaData = await fetchChatMessages({
          since: newestCachedId,
          limit: 100,
        });

        if (!active.current || epoch !== generation.current) return;

        const deltaMessages = deltaData.messages || [];
        if (deltaMessages.length > 0) {
          await upsertChatMessages(deltaMessages);
          setMessages((prev) => mergeChatMessages(prev, deltaMessages));
          setActiveTypers((prev) => {
            const next = new Map(prev);
            deltaMessages.forEach((msg) => next.delete(String(msg.studentId)));
            return next;
          });
        }
        if (deltaData.readReceipts) {
          setReadReceipts(deltaData.readReceipts);
        }

        // Reconcile recent ~50 messages in background for reactions, edits, and deletions
        const snapshotData = await fetchChatMessages({
          before: CHAT_LATEST_CURSOR,
          limit: 50,
        });

        if (active.current && epoch === generation.current && snapshotData.messages) {
          await upsertChatMessages(snapshotData.messages);
          setMessages((prev) =>
            reconcileChatSnapshot(prev, snapshotData.messages, newestCachedId)
          );
          if (snapshotData.readReceipts) {
            setReadReceipts(snapshotData.readReceipts);
          }
        }
      } else {
        // First cold start: cache is empty
        if (!initialCacheLoaded.current) {
          setLoadingInitial(true);
        }

        const initialData = await fetchChatMessages({
          before: CHAT_LATEST_CURSOR,
          limit: CHAT_PAGE_SIZE,
        });

        if (!active.current || epoch !== generation.current) return;

        const incoming = initialData.messages || [];
        await upsertChatMessages(incoming);
        setMessages((prev) => mergeChatMessages(prev, incoming));
        setHasMore(incoming.length >= CHAT_PAGE_SIZE);
        if (initialData.readReceipts) {
          setReadReceipts(initialData.readReceipts);
        }
      }

      setError(null);
    } catch (err: any) {
      if (active.current && epoch === generation.current && messagesRef.current.length === 0) {
        setError(err.message || "Unable to sync messages. Retrying in background...");
      }
    } finally {
      if (epoch === generation.current) {
        syncing.current = false;
        setLoadingInitial(false);
      }
    }
  }, []);

  // Main lifecycle: Local-first instant load + Realtime Singleton subscription
  useFocusEffect(
    useCallback(() => {
      if (!studentId || !serverUrl) return;

      const epoch = ++generation.current;
      active.current = true;
      syncing.current = false;
      paging.current = false;

      // 1. Immediately read cached messages from local SQLite (0ms UI render, NO SPINNER)
      void (async () => {
        const cached = await getCachedChatMessages(50);
        if (active.current && epoch === generation.current) {
          if (cached.length > 0) {
            initialCacheLoaded.current = true;
            setMessages((prev) => mergeChatMessages(prev, cached));
            setLoadingInitial(false);
          } else {
            setLoadingInitial(true);
          }
        }
      })();

      // 2. Start/Subscribe to Realtime Singleton channel (reused across opens)
      void initChatRealtime(studentId).then(() => {
        if (active.current) {
          void trackChatPresence({ studentId });
        }
      });

      const unsubscribe = subscribeChatRealtime({
        onNewMessage: (newMsg) => {
          if (!active.current) return;
          setMessages((prev) => mergeChatMessages(prev, [newMsg]));
          setActiveTypers((prev) => {
            const next = new Map(prev);
            next.delete(String(newMsg.studentId));
            return next;
          });
        },
        onDeleteMessage: (deletedId) => {
          if (!active.current) return;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
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
        onReaction: (messageId, emoji, senderId) => {
          if (!active.current) return;
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== messageId) return msg;
              const current = [...(msg.reactions || [])];
              const idx = current.findIndex((r) => r.studentId === senderId);
              if (idx >= 0) {
                if (current[idx].emoji === emoji) {
                  current.splice(idx, 1);
                } else {
                  current[idx] = { studentId: senderId, emoji };
                }
              } else {
                current.push({ studentId: senderId, emoji });
              }
              return { ...msg, reactions: current };
            })
          );
        },
        onOnlineUsers: (ids) => {
          if (active.current) setOnlineIds(ids);
        },
        onConnectionChange: (connected) => {
          if (active.current) setIsConnected(connected);
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
      }, 8000);

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

  // Pagination: Load older messages from SQLite first, then network
  const loadOlderMessages = useCallback(async () => {
    if (
      !active.current ||
      paging.current ||
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

    try {
      // 1. Try loading older messages from SQLite first
      const cachedOlder = await getCachedChatMessages(30, oldestId);
      if (!active.current || epoch !== generation.current) return;

      if (cachedOlder.length > 0) {
        setMessages((prev) => mergeChatMessages(cachedOlder, prev));
        return;
      }

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
      // Paging failure is non-fatal
    } finally {
      if (epoch === generation.current) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, messages]);

  const markRead = useCallback(async (lastReadMessageId: number) => {
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
    onlineIds,
    loadOlderMessages,
    sync,
    refreshPinned,
    markRead,
  };
}
