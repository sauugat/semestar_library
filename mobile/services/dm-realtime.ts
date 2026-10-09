import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { ApiError } from './api';
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connecting = false;
  let retry = 0;
  const schedule = (ms: number) => {
    if (isCancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void connect(); }, ms);
  };

  async function connect() {
    if (isCancelled || connecting) return;
    connecting = true;
    try {
      const previousClient = client;
      client = null;
      channel = null;
      if (previousClient) await previousClient.removeAllChannels();
      const config = await fetchDmRealtimeConfig(conversationId);
      if (isCancelled) return;

      client = createClient(config.supabaseUrl, config.key, {
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
          const message = payload?.message || (payload?.messageId ? { ...payload, id: Number(payload.messageId) } : null);
          if (!isCancelled && message?.conversationId === conversationId) {
            callbacks.onNewMessage?.(message);
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
            callbacks.onReadReceipt?.({ ...payload, readerId: payload.readerId || payload.studentId });
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
        if (status === 'SUBSCRIBED') {
          retry = 0;
          schedule(Math.max(1000, Date.parse(config.expiresAt) - Date.now() - 30000));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          schedule(Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)));
        }
      });

      channel = receiving;
    } catch (err) {
      if (!isCancelled) {
        console.warn('[DM Realtime] Connection unavailable:', err instanceof ApiError ? err.status : 'network');
        callbacks.onConnectionChange?.(false);
        // Authorization failures need account action; do not hammer the server.
        if (!(err instanceof ApiError && [401, 403, 404].includes(err.status))) {
          schedule(Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)));
        }
      }
    } finally { connecting = false; }
  }

  void connect();

  const unsubscribe = () => {
    isCancelled = true;
    if (timer) clearTimeout(timer);
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

