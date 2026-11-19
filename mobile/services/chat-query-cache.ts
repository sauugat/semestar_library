import { queryClient } from '@/services/query-client';
import { fetchDmMessages, type DmMessage } from '@/services/dm';
import { getCachedDmMessages, saveCachedDmMessages } from '@/services/dm-db';
import type { ChatMessage, ChatPinned, ChatReadReceipt } from '@/services/chat';
import type { KyanaConversation, KyanaMessage } from '@/services/kyana';

/**
 * TanStack React Query persisted local caching layer for chat history.
 * Backed by PersistQueryClientProvider + AsyncStorage (`SEMESTER_LIBRARY_QUERY_CACHE`),
 * so chat threads hydrate synchronously from local storage without triggering network
 * requests on every tap.
 */

export const DM_THREAD_STALE_TIME_MS = 60 * 1000; // 60s — realtime keeps active threads live
export const COHORT_THREAD_STALE_TIME_MS = 45 * 1000;
export const KYANA_THREAD_STALE_TIME_MS = 60 * 1000;

export const chatQueryKeys = {
  dmThread: (accountId: string, conversationId: string) =>
    ['chat', 'dm-thread', accountId.trim().toLowerCase(), conversationId.trim()] as const,
  cohortThread: (accountId: string, chatGroupId?: string | null) =>
    ['chat', 'cohort-thread', accountId.trim().toLowerCase(), String(chatGroupId || '__default__').trim()] as const,
  kyanaThread: (accountId: string) =>
    ['chat', 'kyana-thread', accountId.trim().toLowerCase()] as const,
};

export interface PersistedDmThreadData {
  messages: DmMessage[];
  peerLastReadMessageId: number;
  hasMore: boolean;
  updatedAt: number;
}

export interface PersistedCohortThreadData {
  messages: ChatMessage[];
  pinned: ChatPinned | null;
  readReceipts: ChatReadReceipt[];
  updatedAt: number;
}

export interface PersistedKyanaThreadData {
  conversation: KyanaConversation | null;
  messages: KyanaMessage[];
  updatedAt: number;
}

export function getPersistedDmThread(
  accountId?: string | null,
  conversationId?: string | null
): PersistedDmThreadData | null {
  if (!accountId || !conversationId) return null;
  return (
    queryClient.getQueryData<PersistedDmThreadData>(
      chatQueryKeys.dmThread(accountId, conversationId)
    ) || null
  );
}

export function isDmThreadCacheFresh(
  accountId?: string | null,
  conversationId?: string | null,
  staleTimeMs = DM_THREAD_STALE_TIME_MS
): boolean {
  const data = getPersistedDmThread(accountId, conversationId);
  if (!data || data.messages.length === 0) return false;
  return Date.now() - data.updatedAt < staleTimeMs;
}

export function setPersistedDmThread(
  accountId: string | null | undefined,
  conversationId: string | null | undefined,
  patch: Partial<Omit<PersistedDmThreadData, 'updatedAt'>>
): void {
  if (!accountId || !conversationId) return;
  const key = chatQueryKeys.dmThread(accountId, conversationId);
  const prev = queryClient.getQueryData<PersistedDmThreadData>(key);
  queryClient.setQueryData<PersistedDmThreadData>(key, {
    messages: (patch.messages ?? prev?.messages ?? []).slice(0, 60),
    peerLastReadMessageId: patch.peerLastReadMessageId ?? prev?.peerLastReadMessageId ?? 0,
    hasMore: patch.hasMore ?? prev?.hasMore ?? false,
    updatedAt: Date.now(),
  });
}

/**
 * Prefetches a DM thread into React Query's persisted cache (respecting staleTime so
 * repeated taps or hovers never trigger redundant network calls).
 */
export function prefetchDmThreadQuery(
  accountId: string | null | undefined,
  conversationId: string | null | undefined,
  options?: { network?: boolean }
): Promise<void> {
  if (!accountId || !conversationId) return Promise.resolve();
  const key = chatQueryKeys.dmThread(accountId, conversationId);
  const shouldFetchNetwork = options?.network !== false;

  return queryClient.prefetchQuery({
    queryKey: key,
    staleTime: DM_THREAD_STALE_TIME_MS,
    queryFn: async (): Promise<PersistedDmThreadData> => {
      const existing = queryClient.getQueryData<PersistedDmThreadData>(key);
      const cached = await getCachedDmMessages(accountId, conversationId, 50).catch(() => [] as DmMessage[]);

      if (!shouldFetchNetwork) {
        return {
          messages: cached.length > 0 ? cached : existing?.messages || [],
          peerLastReadMessageId: existing?.peerLastReadMessageId || 0,
          hasMore: existing?.hasMore || false,
          updatedAt: Date.now(),
        };
      }

      if (cached.length > 0 && (!existing || existing.messages.length === 0)) {
        queryClient.setQueryData<PersistedDmThreadData>(key, {
          messages: cached,
          peerLastReadMessageId: existing?.peerLastReadMessageId || 0,
          hasMore: existing?.hasMore || false,
          updatedAt: Date.now(),
        });
      }

      const res = await fetchDmMessages(conversationId, { limit: 50 });
      if (res?.messages) {
        void saveCachedDmMessages(accountId, conversationId, res.messages);
      }
      return {
        messages: res?.messages || cached,
        peerLastReadMessageId: res?.peerLastReadMessageId || existing?.peerLastReadMessageId || 0,
        hasMore: Boolean(res?.hasMore),
        updatedAt: Date.now(),
      };
    },
  });
}

export function getPersistedCohortThread(
  accountId?: string | null,
  chatGroupId?: string | null
): PersistedCohortThreadData | null {
  if (!accountId) return null;
  return (
    queryClient.getQueryData<PersistedCohortThreadData>(
      chatQueryKeys.cohortThread(accountId, chatGroupId)
    ) || null
  );
}

export function setPersistedCohortThread(
  accountId: string | null | undefined,
  chatGroupId: string | null | undefined,
  patch: Partial<Omit<PersistedCohortThreadData, 'updatedAt'>>
): void {
  if (!accountId) return;
  const key = chatQueryKeys.cohortThread(accountId, chatGroupId);
  const prev = queryClient.getQueryData<PersistedCohortThreadData>(key);
  const next: PersistedCohortThreadData = {
    messages: (patch.messages ?? prev?.messages ?? []).slice(0, 60),
    pinned: patch.pinned !== undefined ? patch.pinned : prev?.pinned ?? null,
    readReceipts: patch.readReceipts ?? prev?.readReceipts ?? [],
    updatedAt: Date.now(),
  };
  queryClient.setQueryData<PersistedCohortThreadData>(key, next);
  if (chatGroupId) {
    queryClient.setQueryData<PersistedCohortThreadData>(
      chatQueryKeys.cohortThread(accountId, '__default__'),
      next
    );
  }
}

export function getPersistedKyanaThread(
  accountId?: string | null
): PersistedKyanaThreadData | null {
  if (!accountId) return null;
  return (
    queryClient.getQueryData<PersistedKyanaThreadData>(
      chatQueryKeys.kyanaThread(accountId)
    ) || null
  );
}

export function setPersistedKyanaThread(
  accountId: string | null | undefined,
  patch: Partial<Omit<PersistedKyanaThreadData, 'updatedAt'>>
): void {
  if (!accountId) return;
  const key = chatQueryKeys.kyanaThread(accountId);
  const prev = queryClient.getQueryData<PersistedKyanaThreadData>(key);
  queryClient.setQueryData<PersistedKyanaThreadData>(key, {
    conversation: patch.conversation !== undefined ? patch.conversation : prev?.conversation ?? null,
    messages: (patch.messages ?? prev?.messages ?? []).slice(-60),
    updatedAt: Date.now(),
  });
}
