import { apiFetch, getBaseUrl, getAuthToken, ApiError } from './api';

export interface KyanaResourceCard {
  type: 'note' | 'post' | 'notice' | 'post_assignment' | 'assignment' | 'routine';
  id: string | number;
  title: string;
  subject?: string;
  chapter?: string;
  semester?: number | string;
  deadline?: string | null;
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
  onReplace?: (fullReplyText: string) => void;
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
  replacedStream?: boolean;
}

export interface SseStreamCallbacks {
  onDelta?: (deltaText: string) => void;
  onReplace?: (fullReplyText: string) => void;
  onResult?: (result: SendKyanaMessageResult) => void;
  onDone?: (payload?: any) => void;
  onError?: (errorMessage: string, payload?: any) => void;
}

/**
 * Stateful SSE parser for XMLHttpRequest progressive `responseText`.
 * - Never discards incomplete SSE frames.
 * - Advances `processedIndex` only through complete event boundaries (`\n\n` or `\r\n\r\n`).
 * - Handles events split across multiple network packets and multiple events in one packet.
 * - Handles `delta`, `result`, `done`, and `error` events, plus final buffered event on close (`flush = true`).
 */
export function createKyanaSseParser(callbacks: SseStreamCallbacks = {}) {
  let processedIndex = 0;
  let accumulatedText = '';
  let finalResult: SendKyanaMessageResult | null = null;
  let streamError: string | null = null;
  let isDone = false;

  function processEventBlock(rawBlock: string) {
    const trimmedBlock = rawBlock.trim();
    if (!trimmedBlock) return;

    const lines = rawBlock.split(/\r?\n/);
    let eventType = '';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) {
        // SSE comment / keepalive
        continue;
      }
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim().toLowerCase();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      if (eventType === 'done') {
        isDone = true;
        callbacks.onDone?.({});
      }
      return;
    }

    const rawData = dataLines.join('\n').trim();
    if (!rawData) return;

    if (rawData === '[DONE]') {
      isDone = true;
      callbacks.onDone?.({ done: true });
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const resolvedType =
      eventType ||
      (typeof parsed.error === 'string' ? 'error' : '') ||
      (typeof parsed.reply === 'string' ? 'result' : '') ||
      (typeof parsed.text === 'string' ? 'delta' : '') ||
      (parsed.done === true ? 'done' : '');

    if (resolvedType === 'delta') {
      if (typeof parsed.text === 'string' && parsed.text.length > 0) {
        accumulatedText += parsed.text;
        callbacks.onDelta?.(parsed.text);
      }
      return;
    }

    if (resolvedType === 'result') {
      if (typeof parsed.reply === 'string') {
        if (parsed.replacedStream && parsed.reply !== accumulatedText) {
          accumulatedText = parsed.reply;
          callbacks.onReplace?.(parsed.reply);
        } else if (!accumulatedText) {
          accumulatedText = parsed.reply;
        }
        finalResult = parsed as SendKyanaMessageResult;
        callbacks.onResult?.(finalResult);
      }
      return;
    }

    if (resolvedType === 'done') {
      isDone = true;
      if (typeof parsed.reply === 'string' && !finalResult) {
        finalResult = parsed as SendKyanaMessageResult;
        callbacks.onResult?.(finalResult);
      }
      callbacks.onDone?.(parsed);
      return;
    }

    if (resolvedType === 'error') {
      const msg =
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        'Couldn’t finish that reply. Try again in a moment.';
      streamError = msg;
      callbacks.onError?.(msg, parsed);
    }
  }

  function feed(fullResponseText: string, flush = false) {
    if (typeof fullResponseText !== 'string') return;
    if (fullResponseText.length < processedIndex) {
      processedIndex = 0;
    }

    while (processedIndex < fullResponseText.length) {
      const slice = fullResponseText.slice(processedIndex);
      const boundaryMatch = /\r?\n\r?\n/.exec(slice);

      if (!boundaryMatch) {
        if (flush) {
          processedIndex = fullResponseText.length;
          processEventBlock(slice);
        }
        break;
      }

      const eventBlock = slice.slice(0, boundaryMatch.index);
      processedIndex += boundaryMatch.index + boundaryMatch[0].length;
      processEventBlock(eventBlock);
    }
  }

  return {
    feed,
    getProcessedIndex: () => processedIndex,
    getAccumulatedText: () => accumulatedText,
    getFinalResult: () => finalResult,
    getStreamError: () => streamError,
    isDone: () => isDone,
  };
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
  const { message, conversationId, history, onDelta, onReplace, signal } = params;
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

    const sseParser = createKyanaSseParser({
      onDelta,
      onReplace,
    });

    const abortHandler = () => {
      try {
        xhr.abort();
      } catch {}
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', abortHandler);

    xhr.onprogress = () => {
      try {
        const current = xhr.responseText || '';
        if (current.length > sseParser.getProcessedIndex()) {
          sseParser.feed(current, false);
        }
      } catch {}
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', abortHandler);
      const status = xhr.status;

      if (status >= 200 && status < 300) {
        const fullResponse = xhr.responseText || '';
        try {
          // Flush any remaining complete or final buffered SSE event at connection close
          sseParser.feed(fullResponse, true);

          const finalResult = sseParser.getFinalResult();
          if (finalResult) {
            return resolve(finalResult);
          }

          const streamError = sseParser.getStreamError();
          if (streamError && !sseParser.getAccumulatedText()) {
            return reject(new ApiError(streamError, 503));
          }

          // Try parsing standard non-SSE JSON response fallback
          const json = JSON.parse(fullResponse);
          if (json && typeof json.reply === 'string') {
            return resolve(json);
          }
        } catch {}

        const streamError = sseParser.getStreamError();
        if (streamError && !sseParser.getAccumulatedText()) {
          return reject(new ApiError(streamError, 503));
        }

        // Fallback with accumulated text
        return resolve({
          reply: sseParser.getAccumulatedText() || 'Kyana was unable to complete this reply.',
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

/** Revalidate source access before navigating; never trust persisted route strings. */
export async function resolveKyanaResource(card: KyanaResourceCard): Promise<KyanaResourceCard> {
  const res = await apiFetch(`/api/ai/resources/${encodeURIComponent(card.type)}/${encodeURIComponent(String(card.id))}/open?format=json`);
  if (!res.ok) throw new Error('This resource is no longer available to your account.');
  return res.json();
}
