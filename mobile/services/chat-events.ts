import type { ChatMessage } from './chat';
import type { ChatSession } from './chat-session';
export const CHAT_EVENTS = ['new_message','delete_message','reaction_update','typing','read_receipt','pin_message','online_snapshot'] as const;
export type ChatEventType = typeof CHAT_EVENTS[number];
type Envelope = { eventId: string; chatGroupId: string; realtimeEpoch: number };
export type ChatEvent = Envelope & (
  { type: 'new_message'; message: ChatMessage } |
  { type: 'delete_message' | 'pin_message'; messageId: number | null } |
  { type: 'reaction_update'; messageId: number; studentId: string; emoji: string; action: string } |
  { type: 'typing'; studentId: string; name: string; expiresAt: string } |
  { type: 'read_receipt'; studentId: string; lastReadMessageId: number } |
  { type: 'online_snapshot'; members: { studentId: string; expiresAt: string }[] }
);
export function decodeChatEvent(type: string, value: Record<string, any>, session: ChatSession): ChatEvent | null {
  const ctx = session.context;
  if (!ctx || !CHAT_EVENTS.includes(type as ChatEventType) || typeof value?.eventId !== 'string' || !value.eventId ||
      value.chatGroupId !== ctx.chatGroupId || value.realtimeEpoch !== ctx.realtimeEpoch) return null;
  if (type === 'new_message' && (!Number.isSafeInteger(value.id) || value.id <= 0 || !value.studentId)) return null;
  if (['delete_message','reaction_update'].includes(type) && (!Number.isSafeInteger(value.messageId) || value.messageId <= 0)) return null;
  if (type === 'typing' && (!value.studentId || !(Date.parse(value.expiresAt) > Date.now()))) return null;
  if (type === 'online_snapshot' && !Array.isArray(value.members)) return null;
  if (type === 'read_receipt' && (!value.studentId || !Number.isSafeInteger(value.lastReadMessageId))) return null;
  if (type === 'reaction_update' && (!value.studentId || !value.emoji || !['add','update','remove'].includes(value.action))) return null;
  return { ...value, type, ...(type === 'new_message' ? { message: value } : {}) } as ChatEvent;
}
