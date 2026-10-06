import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { fetchRealtimeConfig, type ChatMessage, type ChatReadReceipt } from './chat';
import { applyCachedChatEvent } from './chat-db';
import { CHAT_EVENTS, decodeChatEvent } from './chat-events';
import { assertLocalChatServer, getChatSession, isCurrentChatSession, subscribeChatSession } from './chat-session';

type Subscriber = {
  onNewMessage?: (message: ChatMessage) => void; onDeleteMessage?: (id: number) => void;
  onTyping?: (name: string, studentId: string, expiresAt: string) => void;
  onReaction?: (messageId: number, emoji: string, studentId: string, action: string) => void;
  onPin?: () => void; onRead?: (receipt: ChatReadReceipt) => void;
  onOnlineUsers?: (members: { studentId: string; expiresAt: string }[]) => void;
  onConnectionChange?: (connected: boolean) => void; onRefreshNeeded?: () => void;
};
const subscribers = new Set<Subscriber>();
export const subscribeChatRealtime = (sub: Subscriber) => { subscribers.add(sub); return () => { subscribers.delete(sub); }; };
let client: SupabaseClient | null = null, channel: RealtimeChannel | null = null;
let attempt = 0, topic = '', expiry = 0;
let renewal: ReturnType<typeof setTimeout> | undefined;
let connected = false;
let pending: Promise<void> | null = null;
const connection = (value: boolean) => { connected = value; subscribers.forEach(s => s.onConnectionChange?.(value)); };

subscribeChatSession(() => {
  const session = getChatSession();
  if (!session.context || (topic && topic !== `chat:${session.context.chatGroupId}:${session.context.realtimeEpoch}`)) void disconnectChatRealtime();
});

export async function initChatRealtime(_studentId?: string, _serverUrl?: string): Promise<void> {
  if (pending) return pending;
  const work = async () => {
    const start = getChatSession();
    if (!start.context) return;
    const expected = `chat:${start.context.chatGroupId}:${start.context.realtimeEpoch}`;
    if (connected && topic === expected && expiry - Date.now() > 45000) return;
    await disconnectChatRealtime();
    const mine = ++attempt;
    const current = () => mine === attempt && isCurrentChatSession(start) && getChatSession().context?.realtimeEpoch === start.context?.realtimeEpoch;
    try {
      const config = await fetchRealtimeConfig();
      if (!current()) return;
      if (config.topic !== expected || config.chatGroupId !== start.context.chatGroupId || config.realtimeEpoch !== start.context.realtimeEpoch || Date.parse(config.expiry) <= Date.now()) throw new Error('Invalid realtime configuration');
      // The authenticated backend supplies the pinned provider's public settings.
      // Room credentials remain short-lived and private; no singleton fallback.
      if (!config.url || !config.key) return;
      assertLocalChatServer(config.url);
      const local = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
      client = local;
      await local.realtime.setAuth(config.token);
      if (!current()) { await local.removeAllChannels(); return; }
      const receiving = local.channel(config.topic, { config: { private: true } });
      channel = receiving; topic = config.topic; expiry = Date.parse(config.expiry);
      for (const type of CHAT_EVENTS) receiving.on('broadcast',{event:type},async ({payload}) => {
        if (!current()) return;
        const event = decodeChatEvent(type,payload,getChatSession());
        if (!event) return;
        try {
          if (!await applyCachedChatEvent(event,start) || !current()) return;
          subscribers.forEach(s => {
            switch (event.type) {
              case 'new_message': s.onNewMessage?.(event.message); break;
              case 'delete_message': if (event.messageId) s.onDeleteMessage?.(event.messageId); break;
              case 'reaction_update': s.onReaction?.(event.messageId,event.emoji,event.studentId,event.action); break;
              case 'typing': s.onTyping?.(event.name,event.studentId,event.expiresAt); break;
              case 'read_receipt': s.onRead?.(event); break;
              case 'pin_message': s.onPin?.(); break;
              case 'online_snapshot': s.onOnlineUsers?.(event.members); break;
            }
          });
        } catch { subscribers.forEach(s => s.onRefreshNeeded?.()); }
      });
      receiving.subscribe(status => {
        if (!current()) return;
        connection(status === 'SUBSCRIBED');
        if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) subscribers.forEach(s => s.onRefreshNeeded?.());
      });
      renewal = setTimeout(() => { if (current()) subscribers.forEach(s => s.onRefreshNeeded?.()); },Math.max(1000,expiry-Date.now()-30000));
    } catch { if (current()) connection(false); }
  };
  pending = work().finally(() => { pending = null; }); return pending;
}
export async function disconnectChatRealtime() {
  attempt++; clearTimeout(renewal); topic = ''; expiry = 0; connection(false);
  const old = client, oldChannel = channel; client = null; channel = null;
  if (old && oldChannel) { try { await old.removeChannel(oldChannel); } catch {} }
}
