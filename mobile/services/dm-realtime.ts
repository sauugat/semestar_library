import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { fetchDmRealtimeConfig, type DmMessage } from './dm';

export interface DmRealtimeCallbacks {
  onNewMessage?: (message: DmMessage) => void;
  onEditedMessage?: (payload: { messageId: number; text: string; editedAt: string }) => void;
  onDeletedMessage?: (payload: { messageId: number; deletedAt: string }) => void;
  onReadReceipt?: (payload: { readerId: string; lastReadMessageId: number; readAt: string }) => void;
  onTyping?: (payload: { studentId: string; isTyping: boolean; expiresAt: string }) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function subscribeDmConversationRealtime(
  conversationId: string,
  callbacks: DmRealtimeCallbacks
): () => void {
  let isCancelled = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;

  async function connect() {
    try {
      const config = await fetchDmRealtimeConfig(conversationId);
      if (isCancelled) return;

      client = createClient(config.supabaseUrl, config.token, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await client.realtime.setAuth(config.token);

      if (isCancelled) {
        await client.removeAllChannels();
        return;
      }

      const receiving = client.channel(config.topic, {
        config: {
          broadcast: { self: false, ack: false },
          private: true,
        },
      });

      receiving
        .on('broadcast', { event: 'dm:message:new' }, ({ payload }) => {
          if (!isCancelled && payload?.message) {
            callbacks.onNewMessage?.(payload.message);
          }
        })
        .on('broadcast', { event: 'dm:message:edited' }, ({ payload }) => {
          if (!isCancelled && payload) {
            callbacks.onEditedMessage?.(payload);
          }
        })
        .on('broadcast', { event: 'dm:message:deleted' }, ({ payload }) => {
          if (!isCancelled && payload) {
            callbacks.onDeletedMessage?.(payload);
          }
        })
        .on('broadcast', { event: 'dm:read:updated' }, ({ payload }) => {
          if (!isCancelled && payload) {
            callbacks.onReadReceipt?.(payload);
          }
        })
        .on('broadcast', { event: 'dm:typing' }, ({ payload }) => {
          if (!isCancelled && payload) {
            callbacks.onTyping?.(payload);
          }
        });

      receiving.subscribe((status) => {
        if (isCancelled) return;
        callbacks.onConnectionChange?.(status === 'SUBSCRIBED');
      });

      channel = receiving;
    } catch (err) {
      if (!isCancelled) {
        console.warn('[DM Realtime] Connection error:', err);
        callbacks.onConnectionChange?.(false);
      }
    }
  }

  void connect();

  const unsubscribe = () => {
    isCancelled = true;
    activeSubscriptions.delete(unsubscribe);
    if (channel && client) {
      void client.removeChannel(channel).catch(() => {});
    }
    client = null;
    channel = null;
  };

  activeSubscriptions.add(unsubscribe);
  return unsubscribe;
}

const activeSubscriptions = new Set<() => void>();

export function disconnectAllDmRealtime(): void {
  for (const unsub of Array.from(activeSubscriptions)) {
    try {
      unsub();
    } catch {}
  }
  activeSubscriptions.clear();
}

