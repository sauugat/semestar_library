import { api, apiFetch, getBaseUrl } from "./api";

export interface ChatMessage {
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
  status?: 'sent' | 'pending' | 'failed';
  localUri?: string;
  pendingFile?: { uri: string; name: string; mimeType: string; size?: number } | null;
  clientId?: string;
}

export interface ChatConfig {
  url: string;
  key: string;
}

export interface SendMessageParams {
  text?: string;
  file?: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
  } | null;
  replyToId?: number | null;
  clientId?: string;
}

export async function fetchChatConfig(): Promise<ChatConfig> {
  return await api.get<ChatConfig>("/api/chat/config");
}

export async function fetchChatMessages(params?: {
  since?: number;
  before?: number;
  limit?: number;
}): Promise<{ messages: ChatMessage[]; readReceipts: ChatReadReceipt[]; typing?: { studentId: string; name: string; timestamp: string }[] }> {
  const query = new URLSearchParams();
  if (params?.since !== undefined) query.append("since", String(params.since));
  if (params?.before) query.append("before", String(params.before));
  if (params?.limit) query.append("limit", String(params.limit));
  const queryString = query.toString() ? `?${query.toString()}` : "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await api.get<{
      messages: ChatMessage[];
      readReceipts: ChatReadReceipt[];
    }>(`/api/chat/messages${queryString}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendChatMessage(
  params: SendMessageParams,
): Promise<{ message: string; messageId: number; data: ChatMessage }> {
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
  if (params.file) {
    formData.append("attachment", {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.mimeType || "application/octet-stream",
    } as any);
  }

  const res = await apiFetch("/api/chat/messages", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.message || err.error || `Failed to send message (HTTP ${res.status})`;
    console.warn(`[Chat] sendChatMessage failed (${res.status}):`, message);
    throw new Error(message);
  }

  return await res.json();
}

export async function sendChatTyping(): Promise<void> {
  try {
    await api.post("/api/chat/typing", {});
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
  avatarUrl?: string;
  semester?: string;
  role?: string;
}
export interface ChatPinned {
  messageId: number;
  text: string;
  senderName: string;
}
export const fetchChatMembers = () =>
  api.get<{ members: ChatMember[]; total: number }>("/api/chat/members");
export const fetchChatPinned = () =>
  api.get<{ pinned: ChatPinned | null }>("/api/chat/pinned");
export const pinChatMessage = (id: number) =>
  api.post(`/api/chat/pinned/${id}`);
export const unpinChatMessage = () => api.delete("/api/chat/pinned");
export const deleteChatMessage = (id: number) =>
  api.delete(`/api/chat/messages/${id}`);
export const reactToChatMessage = (messageId: number, emoji: string) =>
  api.post<{ action: "add" | "update" | "remove" }>("/api/chat/reactions", {
    messageId,
    emoji,
  });
export const markChatRead = (lastReadMessageId: number) =>
  api.post("/api/chat/read", { lastReadMessageId });
