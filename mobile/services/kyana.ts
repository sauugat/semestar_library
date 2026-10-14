import { apiFetch, getBaseUrl, getAuthToken, ApiError } from './api';

export interface KyanaResourceCard {
  type: 'note' | 'post' | 'notice' | 'post_assignment' | 'assignment' | 'routine';
  id: string | number;
  title: string;
  subject?: string;
  semester?: number | string;
  action: 'open_note' | 'view_post' | 'view_notice' | 'view_assignment' | 'view_routine';
  deepLink?: string;
  viewUrl?: string;
  downloadUrl?: string;
  mobileRoute?: string;
  mobileParams?: Record<string, any>;
}

export interface KyanaMessage {
  id: string | number;
  conversationId: string;
  sender: 'user' | 'assistant';
  text: string;
  metadata?: {
    matchedFiles?: any[];
    matchedCourses?: any[];
    matchedRoutine?: any[];
    matchedPosts?: any[];
    matchedNotices?: any[];
    matchedAssignments?: any[];
    resourceCards?: KyanaResourceCard[];
    webSources?: any[];
    actions?: any[];
    chatMode?: string;
  } | null;
  createdAt: string;
  status?: 'pending' | 'sent' | 'error';
}

export interface KyanaConversation {
  id: string;
  studentId: string;
  title: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KyanaInboxPreview {
  conversationId: string | null;
  title: string;
  subtitle: string;
  timestamp: string | null;
  unreadCount: number;
  isPinned: boolean;
}

export interface SendKyanaMessageParams {
  message: string;
  conversationId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onDelta?: (deltaText: string) => void;
  signal?: AbortSignal;
}

export interface SendKyanaMessageResult {
  reply: string;
  conversationId?: string;
  matchedFiles?: any[];
  matchedCourses?: any[];
  matchedRoutine?: any[];
  matchedPosts?: any[];
  matchedNotices?: any[];
  matchedAssignments?: any[];
  resourceCards?: KyanaResourceCard[];
  webSources?: any[];
  actions?: any[];
  chatMode?: string;
}

/**
 * Retrieves the high-level preview for displaying Kyana AI pinned in the unified chat list.
 */
export async function fetchKyanaPreview(): Promise<KyanaInboxPreview> {
  try {
    const res = await apiFetch('/api/ai/preview');
    if (!res.ok) {
      return {
        conversationId: null,
        title: 'Kyana AI',
        subtitle: 'How can I help you today?',
        timestamp: null,
        unreadCount: 0,
        isPinned: true,
      };
    }
    const data = await res.json();
    return {
      conversationId: data.conversationId || null,
      title: data.title || 'Kyana AI',
      subtitle: data.subtitle || 'How can I help you today?',
      timestamp: data.timestamp || null,
      unreadCount: 0,
      isPinned: true,
    };
  } catch {
    return {
      conversationId: null,
      title: 'Kyana AI',
      subtitle: 'How can I help you today?',
      timestamp: null,
      unreadCount: 0,
      isPinned: true,
    };
  }
}

/**
 * Retrieves all conversations for the authenticated student.
 */
export async function fetchKyanaConversations(): Promise<KyanaConversation[]> {
  const res = await apiFetch('/api/ai/conversations');
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return [];
    throw new ApiError('Failed to fetch AI conversations', res.status);
  }
  return res.json();
}

/**
 * Retrieves messages for a specific conversation.
 */
export async function fetchKyanaConversationMessages(
  conversationId: string
): Promise<{ conversation: KyanaConversation; messages: KyanaMessage[] }> {
  const res = await apiFetch(`/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (!res.ok) {
    throw new ApiError('Failed to fetch messages for conversation', res.status);
  }
  return res.json();
}

/**
 * Clears all messages in an AI conversation while keeping the conversation identity.
 */
export async function clearKyanaConversation(conversationId: string): Promise<boolean> {
  const res = await apiFetch(`/api/ai/conversations/${encodeURIComponent(conversationId)}/clear`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new ApiError('Failed to clear conversation', res.status);
  }
  return true;
}

/**
 * Creates a brand new conversation session.
 */
export async function createKyanaConversation(title?: string): Promise<KyanaConversation> {
  const res = await apiFetch('/api/ai/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: title || 'New conversation' }),
  });
  if (!res.ok) {
    throw new ApiError('Failed to create new AI conversation', res.status);
  }
  return res.json();
}

/**
 * Sends a message to Kyana AI with live streaming (SSE) support and JSON fallback.
 */
export async function sendKyanaMessage(
  params: SendKyanaMessageParams
): Promise<SendKyanaMessageResult> {
  const { message, conversationId, history, onDelta, signal } = params;
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getAuthToken()]);
  const url = `${baseUrl.replace(/\/+$/, '')}/api/ai/chat`;

  return new Promise<SendKyanaMessageResult>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Aborted'));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream, application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    let processedIndex = 0;
    let accumulatedText = '';
    let finalResult: SendKyanaMessageResult | null = null;

    const abortHandler = () => {
      try {
        xhr.abort();
      } catch {}
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', abortHandler);

    function parseSseText(rawText: string) {
      const slice = rawText.slice(processedIndex);
      processedIndex = rawText.length;

      const lines = slice.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(jsonStr);
            if (data && typeof data.text === 'string') {
              accumulatedText += data.text;
              onDelta?.(data.text);
            }
            if (data && typeof data.reply === 'string') {
              finalResult = data as SendKyanaMessageResult;
            }
          } catch {
            // Partial chunk or non-JSON data line
          }
        }
      }
    }

    xhr.onprogress = () => {
      try {
        const current = xhr.responseText || '';
        if (current.length > processedIndex) {
          parseSseText(current);
        }
      } catch {}
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', abortHandler);
      const status = xhr.status;

      if (status >= 200 && status < 300) {
        try {
          const fullResponse = xhr.responseText || '';
          if (fullResponse.length > processedIndex) {
            parseSseText(fullResponse);
          }

          if (finalResult) {
            return resolve(finalResult);
          }

          // Try parsing standard JSON response
          const json = JSON.parse(fullResponse);
          if (json && typeof json.reply === 'string') {
            return resolve(json);
          }
        } catch {}

        // Fallback with accumulated text
        return resolve({
          reply: accumulatedText || 'Kyana was unable to complete this reply.',
          conversationId,
        });
      }

      if (status === 429) {
        return reject(
          new ApiError('Too many messages sent. Please wait a moment!', 429)
        );
      }

      let errMessage = 'Couldn’t finish that reply. Try again in a moment.';
      try {
        const errJson = JSON.parse(xhr.responseText || '{}');
        if (errJson.message) errMessage = errJson.message;
      } catch {}

      return reject(new ApiError(errMessage, status));
    };

    xhr.onerror = () => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new ApiError('Network connection lost while messaging Kyana.', 0));
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new ApiError('Request timed out while waiting for Kyana.', 408));
    };

    xhr.timeout = 60000; // 60s timeout

    const payload = JSON.stringify({
      message,
      conversationId,
      history: history || [],
      stream: true,
    });

    try {
      xhr.send(payload);
    } catch (err: any) {
      signal?.removeEventListener('abort', abortHandler);
      reject(new ApiError(err?.message || 'Failed to send message', 0));
    }
  });
}
