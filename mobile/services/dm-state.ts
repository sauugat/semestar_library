import type { DmMessage } from './dm';

// The inverted conversation list always stores newest first. A client ID is
// scoped to its sender; an echo from another participant cannot replace a send.
export function mergeDmMessages(current: DmMessage[], incoming: DmMessage[]): DmMessage[] {
  const result = [...current];
  for (const message of incoming) {
    const matches = (item: DmMessage) => item.id === message.id || Boolean(
      message.clientId && item.clientId === message.clientId && item.senderId === message.senderId
    );
    const previous = result.find(matches);
    if (previous && typeof previous.id === 'number' && typeof message.id !== 'number') continue;
    const merged = { ...previous, ...message,
      ...(typeof message.id === 'number' ? { status: 'sent' as const } : {}),
    };
    for (let i = result.length - 1; i >= 0; i--) if (matches(result[i])) result.splice(i, 1);
    result.push(merged);
  }
  return result.sort((a, b) => {
    if (typeof a.id === 'number' && typeof b.id === 'number') return b.id - a.id;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function failDmMessage(messages: DmMessage[], clientId: string): DmMessage[] {
  // A late HTTP failure must never downgrade an already acknowledged echo.
  return messages.map(m => m.clientId === clientId && typeof m.id !== 'number'
    ? { ...m, status: 'failed' } : m);
}

/**
 * Compares two message IDs using canonical ordering:
 * - Compares as numeric integers when valid numbers or numeric strings
 * - Safe up to Number.MAX_SAFE_INTEGER
 * - Uses numeric string locale comparison as fallback
 */
export function compareMessageCursors(
  a: number | string | null | undefined,
  b: number | string | null | undefined
): number {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    if (numA < numB) return -1;
    if (numA > numB) return 1;
    return 0;
  }
  const strA = String(a ?? '');
  const strB = String(b ?? '');
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}

export function isCursorNewer(candidate: number | string, baseline: number | string): boolean {
  return compareMessageCursors(candidate, baseline) > 0;
}

export interface ReadCoalescerOptions {
  maxRetries?: number;
  initialAcknowledged?: number;
  onSuccess?: (acknowledgedId: number) => void;
  onError?: (error: unknown, targetId: number) => void;
}

export interface ReadReceiptCoalescer {
  start: () => void;
  request: (id: number) => void;
  stop: () => void;
  flush: () => Promise<void>;
  getLastAcknowledged: () => number;
  getLastRequested: () => number;
  getInFlight: () => number | null;
  setAcknowledged: (id: number) => void;
  reset: () => void;
}

/**
 * Creates a bounded, deduplicating read-receipt coalescer that serializes network requests,
 * tracks acknowledged/requested/in-flight cursors, applies exponential backoff for transient
 * failures, and stops retrying on permanent authorization errors.
 */
export function createReadCoalescer(
  send: (id: number) => Promise<unknown>,
  delay = 350,
  options: ReadCoalescerOptions = {}
): ReadReceiptCoalescer {
  let lastAcknowledged = options.initialAcknowledged ?? 0;
  let lastRequested = lastAcknowledged;
  let inFlight: number | null = null;
  let stopped = false;
  let consecutiveFailures = 0;
  const maxRetries = options.maxRetries ?? 5;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activePromise: Promise<void> | null = null;

  const runFlush = async () => {
    if (stopped) return;
    if (compareMessageCursors(lastRequested, lastAcknowledged) <= 0) return;

    const target = lastRequested;
    inFlight = target;

    try {
      await send(target);
      if (compareMessageCursors(target, lastAcknowledged) > 0) {
        lastAcknowledged = target;
      }
      consecutiveFailures = 0;
      options.onSuccess?.(lastAcknowledged);
    } catch (err: any) {
      consecutiveFailures++;
      options.onError?.(err, target);

      // Do not retry indefinitely on authorization or not-found errors
      const status = Number(err?.status || err?.statusCode || (typeof err?.message === 'string' && (err.message.includes('401') ? 401 : err.message.includes('403') ? 403 : err.message.includes('404') ? 404 : 0)));
      const isAuthError = status === 401 || status === 403 || status === 404;
      if (!isAuthError && consecutiveFailures <= maxRetries && !stopped) {
        // Bounded exponential backoff: min(10000ms, max(delay, delay * 2^failures))
        const backoffMs = Math.min(10000, Math.max(delay, delay * Math.pow(2, consecutiveFailures)));
        scheduleFlush(backoffMs);
      }
    } finally {
      inFlight = null;
      // If a newer cursor was requested while in flight, schedule next flush
      if (!stopped && compareMessageCursors(lastRequested, target) > 0 && !timer) {
        scheduleFlush(delay);
      }
    }
  };

  const scheduleFlush = (ms: number) => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      activePromise = runFlush().finally(() => {
        activePromise = null;
      });
    }, ms);
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (activePromise) {
      await activePromise;
    }
    if (!stopped && compareMessageCursors(lastRequested, lastAcknowledged) > 0) {
      activePromise = runFlush();
      try {
        await activePromise;
      } finally {
        activePromise = null;
      }
    }
  };

  return {
    start() {
      stopped = false;
      consecutiveFailures = 0;
      if (compareMessageCursors(lastRequested, lastAcknowledged) > 0 && !timer && inFlight === null) {
        scheduleFlush(delay);
      }
    },
    request(id: number) {
      if (!Number.isSafeInteger(id) || id <= 0) return;
      if (compareMessageCursors(id, lastAcknowledged) <= 0) return;

      if (compareMessageCursors(id, lastRequested) > 0) {
        lastRequested = id;
      }

      if (!stopped && !timer && inFlight === null) {
        scheduleFlush(delay);
      }
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    flush,
    getLastAcknowledged: () => lastAcknowledged,
    getLastRequested: () => lastRequested,
    getInFlight: () => inFlight,
    setAcknowledged(id: number) {
      if (Number.isSafeInteger(id) && compareMessageCursors(id, lastAcknowledged) > 0) {
        lastAcknowledged = id;
        if (compareMessageCursors(id, lastRequested) > 0) {
          lastRequested = id;
        }
      }
    },
    reset() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      lastAcknowledged = 0;
      lastRequested = 0;
      inFlight = null;
      consecutiveFailures = 0;
    },
  };
}

// Conversation-scoped registry ensuring read cursor state is preserved across screen focus/blur
const conversationCoalescers = new Map<string, ReadReceiptCoalescer>();

export function getConversationReadCoalescer(
  conversationId: string,
  sendFn: (id: number) => Promise<unknown>,
  delay = 350,
  options?: ReadCoalescerOptions
): ReadReceiptCoalescer {
  let coalescer = conversationCoalescers.get(conversationId);
  if (!coalescer) {
    coalescer = createReadCoalescer(sendFn, delay, options);
    conversationCoalescers.set(conversationId, coalescer);
  }
  return coalescer;
}

export function clearConversationReadCoalescer(conversationId?: string): void {
  if (conversationId) {
    conversationCoalescers.get(conversationId)?.stop();
    conversationCoalescers.delete(conversationId);
  } else {
    for (const c of conversationCoalescers.values()) c.stop();
    conversationCoalescers.clear();
  }
}
