import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { fetchChatConfig, ChatConfig, ChatMessage } from './chat';
import {
  upsertChatMessages,
  deleteCachedMessage,
  updateCachedReaction,
} from './chat-db';

const CHAT_CONFIG_CACHE_KEY = 'semester_library_chat_config';

let cachedConfig: ChatConfig | null = null;
let supabaseClient: SupabaseClient | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let currentStudentId: string | null = null;

// Callbacks for subscribers (e.g. useClassChat hook)
type ChatRealtimeSubscriber = {
  onNewMessage?: (msg: ChatMessage) => void;
  onDeleteMessage?: (id: number) => void;
  onTyping?: (name: string, studentId: string) => void;
  onReaction?: (messageId: number, emoji: string, studentId: string) => void;
  onOnlineUsers?: (ids: string[]) => void;
  onConnectionChange?: (connected: boolean) => void;
};

const subscribers = new Set<ChatRealtimeSubscriber>();

export function subscribeChatRealtime(sub: ChatRealtimeSubscriber): () => void {
  subscribers.add(sub);
  if (realtimeChannel && sub.onConnectionChange) {
    sub.onConnectionChange(true);
  }
  return () => {
    subscribers.delete(sub);
  };
}

/**
 * Retrieves chat config from memory or SecureStore, fetching from server only if missing.
 */
export async function getCachedChatConfig(): Promise<ChatConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const stored = await SecureStore.getItemAsync(CHAT_CONFIG_CACHE_KEY);
    if (stored) {
      cachedConfig = JSON.parse(stored);
      if (cachedConfig?.url && cachedConfig?.key) {
        return cachedConfig;
      }
    }
  } catch {}

  // Fetch from server
  const config = await fetchChatConfig();
  if (config?.url && config?.key) {
    cachedConfig = config;
    try {
      await SecureStore.setItemAsync(CHAT_CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch {}
  }
  return config;
}

/**
 * Initializes the singleton Supabase client and channel in the background.
 * Reopening Chat reuses this connection without tearing it down.
 */
export async function initChatRealtime(studentId: string): Promise<void> {
  if (realtimeChannel && currentStudentId === studentId) {
    return; // Already initialized and active
  }

  currentStudentId = studentId;

  try {
    const config = await getCachedChatConfig();
    if (!config?.url || !config?.key) return;

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

    const channel = supabaseClient.channel('public:chat_messages', {
      config: { presence: { key: studentId } },
    });

    channel
      .on('broadcast', { event: 'new_message' }, (payload) => {
        if (!payload?.payload) return;
        const msg = payload.payload as ChatMessage;
        // 1. Immediately persist to SQLite
        void upsertChatMessages([msg]);
        // 2. Notify active subscribers
        subscribers.forEach((s) => s.onNewMessage?.(msg));
      })
      .on('broadcast', { event: 'delete_message' }, (payload) => {
        const id = Number(payload?.payload?.id);
        if (id) {
          void deleteCachedMessage(id);
          subscribers.forEach((s) => s.onDeleteMessage?.(id));
        }
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { name, studentId: senderId } = payload?.payload || {};
        if (senderId && String(senderId) !== String(studentId)) {
          subscribers.forEach((s) => s.onTyping?.(name || 'Classmate', String(senderId)));
        }
      })
      .on('broadcast', { event: 'reaction' }, (payload) => {
        const { messageId, emoji, studentId: senderId } = payload?.payload || {};
        if (messageId && emoji && senderId) {
          void updateCachedReaction(Number(messageId), String(senderId), emoji);
          subscribers.forEach((s) => s.onReaction?.(Number(messageId), emoji, String(senderId)));
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const ids = Object.keys(state);
        subscribers.forEach((s) => s.onOnlineUsers?.(ids));
      });

    channel.subscribe((status) => {
      const isConnected = status === 'SUBSCRIBED';
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
  if (realtimeChannel) {
    try {
      await realtimeChannel.track(meta);
    } catch {}
  }
}

/**
 * Disconnects the realtime singleton and clears cached config (e.g. on logout).
 */
export async function disconnectChatRealtime(): Promise<void> {
  if (supabaseClient && realtimeChannel) {
    try {
      await supabaseClient.removeChannel(realtimeChannel);
    } catch {}
  }
  realtimeChannel = null;
  supabaseClient = null;
  currentStudentId = null;
  cachedConfig = null;
  try {
    await SecureStore.deleteItemAsync(CHAT_CONFIG_CACHE_KEY);
  } catch {}
}
