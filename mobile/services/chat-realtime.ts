import { getBaseUrl } from './api';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { fetchChatConfig, ChatConfig, ChatMessage, ChatReadReceipt } from './chat';
import {
  upsertChatMessages,
  configureChatCache,
  getChatCacheScope,
  deleteCachedMessage,
  updateCachedReaction,
} from './chat-db';

let connectionReady = false;
let epoch = 0;
let presence: Record<string, any> = {};
let currentServer = '';

let supabaseClient: SupabaseClient | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let currentStudentId: string | null = null;

// Callbacks for subscribers (e.g. useClassChat hook)
type ChatRealtimeSubscriber = {
  onNewMessage?: (msg: ChatMessage) => void;
  onDeleteMessage?: (id: number) => void;
  onTyping?: (name: string, studentId: string) => void;
  onReaction?: (messageId: number, emoji: string, studentId: string, action: string) => void;
  onPin?: () => void;
  onRead?: (receipt: ChatReadReceipt) => void;
  onOnlineUsers?: (ids: string[]) => void;
  onConnectionChange?: (connected: boolean) => void;
};

const subscribers = new Set<ChatRealtimeSubscriber>();

export function subscribeChatRealtime(sub: ChatRealtimeSubscriber): () => void {
  subscribers.add(sub);
  if (realtimeChannel && sub.onConnectionChange) {
    sub.onConnectionChange(connectionReady);
  }
  return () => {
    subscribers.delete(sub);
  };
}

/**
 * Retrieves connection configuration for the current server.
 */
export async function getCachedChatConfig(): Promise<ChatConfig> {
  return fetchChatConfig();
}

/**
 * Initializes the singleton Supabase client and channel in the background.
 * Reopening Chat reuses this connection without tearing it down.
 */
export async function initChatRealtime(studentId: string, serverUrl?: string): Promise<void> {
  const requestEpoch = epoch;
  serverUrl = serverUrl || await getBaseUrl();
  if (requestEpoch !== epoch) return;
  if (realtimeChannel && currentStudentId === studentId && currentServer === serverUrl) {
    return; // Already initialized and active
  }

  await disconnectChatRealtime();
  const attempt = ++epoch;
  currentStudentId = studentId;
  currentServer = serverUrl;
  configureChatCache(serverUrl, studentId);

  try {
    const config = await getCachedChatConfig();
    if (attempt !== epoch || !config?.url || !config?.key) return;

    if (!supabaseClient) {
      supabaseClient = createClient(config.url, config.key, {
        auth: { persistSession: false },
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      });
    }

    if (realtimeChannel) {
      try {
        await supabaseClient.removeChannel(realtimeChannel);
      } catch {}
    }

    const cacheKey = `${serverUrl.replace(/\/+$/, '')}|${studentId}`;
    const isCurrent = () => attempt === epoch && getChatCacheScope() === cacheKey;
    const channel = supabaseClient.channel('public:chat_messages', {
      config: { presence: { key: studentId } },
    });

    channel
      .on('broadcast', { event: 'new_message' }, (payload) => {
        if (!isCurrent() || !payload?.payload) return;
        const msg = payload.payload as ChatMessage;
        // 1. Immediately persist to SQLite
        void upsertChatMessages([msg]);
        // 2. Notify active subscribers
        subscribers.forEach((s) => s.onNewMessage?.(msg));
      })
      .on('broadcast', { event: 'delete_message' }, (payload) => {
        if (!isCurrent()) return;
        const id = Number(payload?.payload?.messageId);
        if (id) {
          void deleteCachedMessage(id);
          subscribers.forEach((s) => s.onDeleteMessage?.(id));
        }
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (!isCurrent()) return;
        const { name, studentId: senderId } = payload?.payload || {};
        if (senderId && String(senderId) !== String(studentId)) {
          subscribers.forEach((s) => s.onTyping?.(name || 'Classmate', String(senderId)));
        }
      })
      .on('broadcast', { event: 'reaction_update' }, (payload) => {
        if (!isCurrent()) return;
        const { messageId, emoji, studentId: senderId, action } = payload?.payload || {};
        if (messageId && emoji && senderId) {
          void updateCachedReaction(Number(messageId), String(senderId), emoji, action);
          subscribers.forEach((s) => s.onReaction?.(Number(messageId), emoji, String(senderId), action));
        }
      })
      .on('broadcast', { event: 'pin_message' }, () => { if (isCurrent()) subscribers.forEach(s => s.onPin?.()); })
      .on('broadcast', { event: 'read_receipt' }, ({ payload }) => { if (isCurrent()) subscribers.forEach(s => s.onRead?.(payload)); })
      .on('presence', { event: 'sync' }, () => {
        if (!isCurrent()) return;
        const state = channel.presenceState();
        const ids = Object.keys(state);
        subscribers.forEach((s) => s.onOnlineUsers?.(ids));
      });

    channel.subscribe((status) => {
      if (attempt !== epoch) return;
      const isConnected = status === 'SUBSCRIBED';
      connectionReady = isConnected;
      if (isConnected) void channel.track({ studentId, ...presence });
      subscribers.forEach((s) => s.onConnectionChange?.(isConnected));
    });

    realtimeChannel = channel;
  } catch (err) {
    console.warn('[Chat Realtime] Init error:', err);
  }
}

/**
 * Broadcasts presence on the active channel.
 */
export async function trackChatPresence(meta: Record<string, any>): Promise<void> {
  presence = meta;
  if (realtimeChannel && connectionReady) {
    try {
      await realtimeChannel.track(meta);
    } catch {}
  }
}

/**
 * Disconnects the realtime singleton and clears cached config (e.g. on logout).
 */
export async function disconnectChatRealtime(): Promise<void> {
  epoch++;
  connectionReady = false;
  presence = {};
  const client = supabaseClient;
  const channel = realtimeChannel;
  realtimeChannel = null;
  supabaseClient = null;
  currentStudentId = null;
  if (client && channel) {
    try { await client.removeChannel(channel); } catch {}
  }
}
