import { apiFetch } from './api';

export interface DmParticipant {
  studentId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  role: string;
  department?: string;
}

export interface DmMessage {
  id: number | string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderAvatarUrl?: string | null;
  clientId?: string | null;
  text: string | null;
  replyTo?: {
    id: number;
    text: string | null;
    senderId?: string;
    senderName?: string;
    deletedForAll?: boolean;
  } | null;
  isEdited?: boolean;
  editedAt?: string | null;
  deletedForAll?: boolean;
  createdAt: string;
  status?: 'pending' | 'sent' | 'failed';
}

export interface DmConversationItem {
  id: string;
  participant: DmParticipant;
  lastMessage?: {
    id: number;
    text: string | null;
    senderId: string;
    deletedForAll: boolean;
    createdAt: string;
  } | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isMuted?: boolean;
  blocked?: boolean;
  blockedByMe?: boolean;
  blockedByPeer?: boolean;
  lastReadMessageId?: number;
}

export interface DmRealtimeConfig {
  topic: string;
  token: string;
  supabaseUrl: string;
  conversationId: string;
  epoch: number;
  expiresAt: string;
}

export interface DmSyncDelta {
  conversationId: string;
  peerLastReadMessageId: number;
  messages: DmMessage[];
  edits: Array<{ messageId: number; text: string; editedAt: string }>;
  deletions: Array<{ messageId: number; deletedAt: string }>;
}

export async function fetchDmStatus(): Promise<{ enabled: boolean }> {
  try {
    const res = await apiFetch('/api/dm-status', { cache: 'no-store' });
    if (!res.ok) return { enabled: false };
    const data = await res.json();
    return { enabled: Boolean(data?.enabled) };
  } catch {
    return { enabled: false };
  }
}

export async function fetchDmConversations(limit = 40, offset = 0): Promise<DmConversationItem[]> {
  const res = await apiFetch(`/api/dm/conversations?limit=${limit}&offset=${offset}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load conversations');
  }
  const data = await res.json();
  return data.conversations || [];
}

export async function createOrGetDmConversation(targetUserId: string): Promise<{ conversation: DmConversationItem; isNew: boolean }> {
  const res = await apiFetch('/api/dm/conversations', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to start conversation');
  }
  return await res.json();
}

export async function searchDmUsers(query: string, limit = 20): Promise<DmParticipant[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const res = await apiFetch(`/api/dm/users/search?q=${q}&limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to search users');
  }
  const data = await res.json();
  return data.users || [];
}

export async function fetchDmMessages(
  conversationId: string,
  options: { before?: number; limit?: number } = {}
): Promise<{ messages: DmMessage[]; hasMore: boolean }> {
  const { before, limit = 40 } = options;
  let url = `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`;
  if (before) {
    url += `&before=${before}`;
  }
  const res = await apiFetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load messages');
  }
  const data = await res.json();
  return {
    messages: data.messages || [],
    hasMore: Boolean(data.hasMore),
  };
}

export async function sendDmMessage(
  conversationId: string,
  payload: { clientId: string; text: string; replyToId?: number | null }
): Promise<DmMessage> {
  const res = await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to send message');
  }
  const data = await res.json();
  return data.message;
}

export async function editDmMessage(
  conversationId: string,
  messageId: number,
  text: string
): Promise<DmMessage> {
  const res = await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to edit message');
  }
  const data = await res.json();
  return data.message;
}

export async function deleteDmMessage(
  conversationId: string,
  messageId: number,
  mode: 'for_me' | 'for_everyone'
): Promise<{ messageId: number; mode: string; deleted: boolean }> {
  const res = await apiFetch(
    `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}?mode=${mode}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to delete message');
  }
  return await res.json();
}

export async function clearDmConversation(
  conversationId: string
): Promise<{ conversationId: string; clearedAt: string; success: boolean }> {
  const res = await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/clear`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to clear conversation');
  }
  return await res.json();
}

export async function markDmConversationRead(
  conversationId: string,
  lastReadMessageId: number
): Promise<{ conversationId: string; lastReadMessageId: number }> {
  const res = await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastReadMessageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update read receipt');
  }
  return await res.json();
}

export async function sendDmTyping(conversationId: string, isTyping = true): Promise<void> {
  try {
    await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping }),
    });
  } catch {}
}

export async function blockDmUser(userId: string): Promise<{ blocked: boolean }> {
  const res = await apiFetch(`/api/dm/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to block user');
  }
  return await res.json();
}

export async function unblockDmUser(userId: string): Promise<{ blocked: boolean }> {
  const res = await apiFetch(`/api/dm/users/${encodeURIComponent(userId)}/block`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to unblock user');
  }
  return await res.json();
}

export async function reportDm(payload: {
  conversationId: string;
  reportedUserId: string;
  reportedMessageId?: number;
  reason: string;
  description?: string;
}): Promise<{ reportId: string; status: string }> {
  const res = await apiFetch('/api/dm/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to submit report');
  }
  return await res.json();
}

export async function fetchDmRealtimeConfig(conversationId: string): Promise<DmRealtimeConfig> {
  const res = await apiFetch(`/api/dm/conversations/${encodeURIComponent(conversationId)}/realtime-config`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to get realtime configuration');
  }
  return await res.json();
}

export async function syncDmConversation(
  conversationId: string,
  sinceMessageId = 0,
  sinceTimestamp?: string
): Promise<DmSyncDelta> {
  let url = `/api/dm/conversations/${encodeURIComponent(conversationId)}/sync?sinceMessageId=${sinceMessageId}`;
  if (sinceTimestamp) {
    url += `&sinceTimestamp=${encodeURIComponent(sinceTimestamp)}`;
  }
  const res = await apiFetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to sync conversation');
  }
  return await res.json();
}
