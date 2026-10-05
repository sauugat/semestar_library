import { api, apiFetch, getBaseUrl } from "./api";
import { acceptChatContext, assertCurrentChatSession, assertLocalChatServer, captureChatSession, getChatSession, invalidateChatSession, isCurrentChatSession, type ChatContext } from './chat-session';

export interface ChatMessage {
  chatGroupId: string;
  id: number;
  text: string;
  attachmentName: string | null;
  attachmentOriginalName: string | null;
  attachmentMimeType: string | null;
  attachmentSize?: number | null;
  replyToId: number | null;
  createdAt: string;
  studentId: string;
  name: string;
  avatarUrl: string | null;
  replyText?: string;
  replySender?: string;
  reactions?: { studentId: string; emoji: string }[];
  mentions?: string[];
  mentionsDetail?: { studentId: string; handle?: string | null }[];
  status?: 'sent' | 'pending' | 'failed';
  localUri?: string;
  pendingFile?: { uri: string; name: string; mimeType: string; size?: number } | null;
  clientId?: string;
}

export type ChatConfig = ChatContext;
export interface RealtimeConfig { chatGroupId: string; realtimeEpoch: number; topic: string; expiry: string; token: string; url?: string; key?: string }

export interface SendMessageParams {
  text?: string;
  file?: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
  } | null;
  replyToId?: number | null;
  clientId: string;
  chatGroupId: string;
  mentions?: string[];
}

export async function fetchChatConfig(): Promise<ChatConfig> {
  const start = getChatSession();
  assertLocalChatServer(start.server);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const context = await api.get<ChatConfig>(`${start.server}/api/chat/config`, {signal: controller.signal, headers: {Authorization: `Bearer ${start.credential || ''}`}});
    if (!acceptChatContext(start, context)) throw new Error('Stale chat context');
    return context;
  } catch (error: any) {
    if (start.generation === getChatSession().generation && [401,403,404].includes(error.status)) invalidateChatSession();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatRequest<T>(path: string, method = 'GET', body?: any, signal?: AbortSignal): Promise<T> {
  const start = captureChatSession();
  const url = `${path}${path.includes('?') ? '&' : '?'}chatGroupId=${encodeURIComponent(start.context.chatGroupId)}`;
  try {
    const response = await apiFetch(`${start.server}${url}`, { method, signal, headers: {Authorization: `Bearer ${start.credential || ''}`}, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
    assertCurrentChatSession(start);
    const result = await response.json();
    assertCurrentChatSession(start);
    if (!response.ok) {
      if ([401,403].includes(response.status) || (response.status === 404 && /\/(messages|heartbeat|realtime-config)\?/.test(url))) invalidateChatSession();
      throw Object.assign(new Error(result.message || 'Chat request failed'), { status: response.status });
    }
    if (result.chatGroupId && result.chatGroupId !== start.context.chatGroupId) throw new Error('Unexpected conversation');
    for (const item of [...(result.messages || []), ...(result.recentMessages || []), ...(result.data ? [result.data] : [])]) {
      if (item.chatGroupId !== start.context.chatGroupId) throw new Error('Unexpected conversation');
    }
    return result;
  } catch (error: any) {
    if (isCurrentChatSession(start) && error.status === 401) invalidateChatSession();
    throw error;
  }
}
export const fetchRealtimeConfig = () => chatRequest<RealtimeConfig>('/api/chat/realtime-config');
export const sendChatHeartbeat = () => chatRequest<{ onlineIds: string[]; total: number; members: { studentId: string; expiresAt: string }[] }>('/api/chat/heartbeat','POST',{});
export async function fetchExactChatMessage(room: string, id: number) {
  await fetchChatConfig();
  const start = captureChatSession();
  if (room !== start.context.chatGroupId) throw new Error('This conversation is no longer available.');
  const message = await chatRequest<ChatMessage>(`/api/chat/groups/${encodeURIComponent(room)}/messages/${id}`);
  if (message.chatGroupId !== room) throw new Error('This conversation is no longer available.');
  return message;
}

export async function fetchChatMessages(params?: {
  since?: number;
  before?: number;
  limit?: number;
  recent?: number;
  q?: string;
}): Promise<{ messages: ChatMessage[]; recentMessages?: ChatMessage[]; readReceipts: ChatReadReceipt[]; typing?: { studentId: string; name: string; timestamp: string }[] }> {
  const query = new URLSearchParams();
  if (params?.since !== undefined) query.append("since", String(params.since));
  if (params?.before) query.append("before", String(params.before));
  if (params?.limit) query.append("limit", String(params.limit));
  if (params?.recent) query.append('recent', String(params.recent));
  if (params?.q) query.append('q', params.q);
  const queryString = query.toString() ? `?${query.toString()}` : "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await chatRequest<{
      messages: ChatMessage[];
      readReceipts: ChatReadReceipt[];
    }>(`/api/chat/messages${queryString}`, 'GET', undefined, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendChatMessage(
  params: SendMessageParams,
): Promise<{ message: string; messageId: number; data: ChatMessage }> {
  if (params.chatGroupId !== captureChatSession().context.chatGroupId || !params.clientId) throw new Error('This conversation is no longer available.');
  const formData = new FormData();
  if (params.text && params.text.trim()) {
    formData.append("text", params.text.trim());
  }
  if (params.replyToId) {
    formData.append("replyToId", String(params.replyToId));
  }
  if (params.clientId) {
    formData.append("clientId", params.clientId);
  }
  if (params.mentions && params.mentions.length > 0) {
    formData.append("mentions", JSON.stringify(params.mentions));
  }
  if (params.file) {
    formData.append("attachment", {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.mimeType || "application/octet-stream",
    } as any);
  }

  return chatRequest('/api/chat/messages','POST',formData);
}

export interface MentionCandidate {
  studentId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

export async function searchMentionCandidates(query: string): Promise<MentionCandidate[]> {
  if (!query.trim()) return [];
  const res = await chatRequest<MentionCandidate[]>(
    `/api/chat/mentions/students?q=${encodeURIComponent(query.trim())}`
  );
  return res;
}

export async function sendChatTyping(): Promise<void> {
  try {
    await chatRequest('/api/chat/typing','POST',{});
  } catch {
    // Non-critical, ignore typing broadcast failure
  }
}

export async function getAttachmentUrl(filename: string): Promise<string> {
  const baseUrl = await getBaseUrl();
  return `${baseUrl}/api/chat/attachment/${encodeURIComponent(filename)}`;
}

export const CHAT_PAGE_SIZE = 40;
export const CHAT_LATEST_CURSOR = 2147483647; // PostgreSQL INTEGER, not MAX_SAFE_INTEGER.
export const CHAT_MAX_FILE_SIZE = 25 * 1024 * 1024;
export interface ChatReadReceipt {
  studentId: string;
  lastReadMessageId: number;
}
export interface ChatMember {
  studentId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string;
  semester?: string;
  role?: string;
}
export interface ChatPinned {
  messageId: number;
  text: string;
  senderName: string;
}
export const fetchChatMembers = async () => { const members = await chatRequest<ChatMember[]>('/api/chat/members'); return { members, total: members.length }; };
export const fetchChatPinned = async () => {
  const { pinned } = await chatRequest<{ pinned: ChatMessage | null }>('/api/chat/pinned');
  if (pinned && pinned.chatGroupId !== captureChatSession().context.chatGroupId) throw new Error('Unexpected conversation');
  return { pinned: pinned ? { messageId: pinned.id, text: pinned.text || pinned.attachmentOriginalName || 'Attachment', senderName: pinned.name } : null };
};
export const pinChatMessage = (id: number) =>
  chatRequest(`/api/chat/pinned/${id}`, 'POST');
export const unpinChatMessage = () => chatRequest('/api/chat/pinned','DELETE');
export const deleteChatMessage = (id: number) =>
  chatRequest(`/api/chat/messages/${id}`,'DELETE');
export const reactToChatMessage = (messageId: number, emoji: string) =>
  chatRequest<{ action: "add" | "update" | "remove" }>("/api/chat/reactions", 'POST', {
    messageId,
    emoji,
  });
export const markChatRead = (lastReadMessageId: number) =>
  chatRequest('/api/chat/read','POST', { lastReadMessageId });
