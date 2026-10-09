import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  CHAT_PAGE_SIZE,
  ChatMessage,
  ChatPinned,
  ChatReadReceipt,
  fetchChatMessages,
  fetchChatPinned,
  markChatRead,
  fetchChatConfig,
  sendChatHeartbeat,
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
  reconcileCachedChat,
} from "@/services/chat-db";
import {
  initChatRealtime,
  subscribeChatRealtime,
  disconnectChatRealtime,
} from "@/services/chat-realtime";
import { beginChatSession, getChatSession, subscribeChatSession, chatScope, type ChatContext } from '@/services/chat-session';

type Typer = { studentId: string; name: string; expiresAt: number };

export interface UseClassChatOptions {
  authToken?: string | null;
  onNewIncomingMessage?: (message: ChatMessage) => void;
  selectedChatGroupId?: string | null;
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
  const [context, setContext] = useState<ChatContext | null>(null);
  const [roomGeneration, setRoomGeneration] = useState(0);
  const onlineExpiry = useRef(new Map<string, number>());
  const lastHeartbeat = useRef(0);

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
      const data = await fetchChatMessages({ since: newestCachedId, recent: CHAT_PAGE_SIZE, limit: CHAT_PAGE_SIZE });
      if (!active.current || epoch !== generation.current) return;
      const incoming = data.recentMessages || data.messages || [];
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
          .map(t => [String(t.studentId), { studentId: String(t.studentId), name: t.name, expiresAt: new Date(t.timestamp).getTime() + 3500 }])));
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
      }
      if (active.current) {
        setLoadingInitial(false);
      }
    }
  }, [studentId]);

  // Main lifecycle: Local-first instant load + Realtime Singleton subscription
  useFocusEffect(
    useCallback(() => {
      if (!studentId || !serverUrl) return;

      ++generation.current;
      active.current = true;
      syncing.current = false;
      paging.current = false;

      hydrated.current = false;
      snapshotCursor.current = null;
      beginChatSession(serverUrl, studentId, options?.authToken);
      setMessages([]);
      setLoadingInitial(true);
      setHasMore(true);
      setError(null);
      setReadReceipts([]);
      setPinned(null);
      setOnlineIds([]);
      setActiveTypers(new Map());
      let lastScope = '', validating = false, lastRefresh = 0;
      const reset = () => {
        const session = getChatSession();
        const nextScope = chatScope(session);
        setContext(session.context);
        if (lastScope !== nextScope) {
          lastScope = nextScope; generation.current++; setRoomGeneration(session.generation);
          hydrated.current = false; snapshotCursor.current = null; syncing.current = false; paging.current = false;
          setMessages([]); setPinned(null); setReadReceipts([]); setActiveTypers(new Map()); setOnlineIds([]);
          onlineExpiry.current.clear(); setHasMore(true); setLoadingMore(false);
          lastHeartbeat.current=0;
          if (!session.context) {setError('This conversation is no longer available.');setLoadingInitial(false);}
        }
      };
      const stopSession = subscribeChatSession(reset); reset();
      const refresh = async () => {
        if (!active.current || validating || AppState.currentState === 'background') return;
        validating = true; lastRefresh = Date.now();
        try {
          await fetchChatConfig(optionsRef.current?.selectedChatGroupId || undefined);
          if (!active.current) return;
          const epoch = generation.current;
        const cached = await getCachedChatMessages(50);
        if (!active.current || epoch !== generation.current) return;
        setMessages(previous => mergeChatMessages(cached, previous));
        hydrated.current = true;
        if (cached.length) setLoadingInitial(false);
        void sync();
          void refreshPinned();
          await initChatRealtime();
        } catch (err: any) {
          if (active.current) { setError(err.message || 'Unable to validate conversation.'); setLoadingInitial(false); }
        } finally {
          validating = false;
          if (active.current && !hydrated.current) {
            setLoadingInitial(false);
          }
        }
      };
      const heartbeat = async () => {
        if (!active.current || !getChatSession().context || AppState.currentState !== 'active') return;
        if(Date.now()-lastHeartbeat.current<25000)return;
        lastHeartbeat.current=Date.now();
        const epoch = generation.current;
        try { const data = await sendChatHeartbeat(); if (active.current && epoch === generation.current) {
          onlineExpiry.current = new Map(data.members.map(m => [m.studentId,Date.parse(m.expiresAt)])); setOnlineIds(data.onlineIds);
        } } catch {}
      };
      void refresh().then(heartbeat);

      const unsubscribe = subscribeChatRealtime({
        onNewMessage: (newMsg) => {
          if (!active.current) return;
          let isNew = false;
          setMessages((prev) => {
            const existingIndex = prev.findIndex(
              (m) =>
                (newMsg.clientId && m.studentId === newMsg.studentId && m.clientId === newMsg.clientId) ||
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
        onTyping: (name, senderId, expiresAt) => {
          if (!active.current) return;
          if (String(senderId) === String(studentId)) return;
          setActiveTypers((prev) =>
            new Map(prev).set(String(senderId), {
              studentId: String(senderId),
              name,
              expiresAt: Date.parse(expiresAt),
            })
          );
        },
        onReaction: (messageId, emoji, senderId, action) => {
          if (!active.current) return;
          setMessages(previous => applyChatReaction(previous, messageId, senderId, emoji, action));
        },
        onPin: () => { void refreshPinned(); },
        onRead: (receipt) => {
          if (active.current) setReadReceipts(previous => [
            ...previous.filter(r => String(r.studentId) !== String(receipt.studentId)),
            { ...receipt, lastReadMessageId: Math.max(receipt.lastReadMessageId, previous.find(r => String(r.studentId) === String(receipt.studentId))?.lastReadMessageId || 0) },
          ]);
        },
        onOnlineUsers: (members) => {
          if (active.current) { onlineExpiry.current = new Map(members.map(m => [m.studentId,Date.parse(m.expiresAt)])); setOnlineIds(members.filter(m => Date.parse(m.expiresAt)>Date.now()).map(m=>m.studentId)); }
        },
        onRefreshNeeded: () => { if (Date.now()-lastRefresh>5000) void refresh(); },
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
        setOnlineIds(previous => previous.filter(id => (onlineExpiry.current.get(id) || 0)>Date.now()));
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
      const pollInterval = setInterval(() => { void refresh(); void heartbeat(); }, 30000);

      // AppState foreground listener
      const appStateSub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void refresh().then(heartbeat);
        } else { void disconnectChatRealtime(); setOnlineIds([]); }
      });

      return () => {
        active.current = false;
        generation.current++;
        stopSession();
        unsubscribe();
        clearInterval(pruneInterval);
        clearInterval(pollInterval);
        appStateSub.remove();
        void disconnectChatRealtime();
      };
    }, [studentId, serverUrl, options?.authToken, options?.selectedChatGroupId, sync, refreshPinned]),
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
        if (!active.current || epoch !== generation.current) return;
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
    context,
    roomGeneration,
    loadOlderMessages,
    sync,
    refreshPinned,
    markRead,
  };
}
