import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AdminChatRoom, ChatConfig, ChatMember, ChatMessage, ChatPinned, ChatReadReceipt } from '@/services/chat';
import type { DmConversationItem, DmMessage } from '@/services/dm';
import type { KyanaConversation, KyanaInboxPreview, KyanaMessage } from '@/services/kyana';
import {
  getPersistedCohortThread,
  getPersistedDmThread,
  getPersistedKyanaThread,
  prefetchDmThreadQuery,
  setPersistedCohortThread,
  setPersistedDmThread,
  setPersistedKyanaThread,
} from '@/services/chat-query-cache';

/**
 * Strict account-scoped in-memory + persistent local cache for active chat sessions,
 * unified inbox lists, DM message timelines, cohort group timelines, and Kyana AI threads.
 * Eliminates reload jank, cold-start skeleton flickers, and initial load latency when
 * navigating between conversations, tabs, and the dashboard.
 */

const INBOX_STORAGE_KEY_PREFIX = 'semester_library_chat_inbox_v1:';
let persistInboxTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleInboxPersist(snapshot: InboxMemorySnapshot): void {
  if (persistInboxTimer) clearTimeout(persistInboxTimer);
  persistInboxTimer = setTimeout(() => {
    persistInboxTimer = null;
    try {
      const compact: InboxMemorySnapshot = {
        ...snapshot,
        dmConversations: snapshot.dmConversations.slice(0, 40),
        cohortMembers: snapshot.cohortMembers.slice(0, 120),
      };
      void AsyncStorage.setItem(
        `${INBOX_STORAGE_KEY_PREFIX}${snapshot.accountId}`,
        JSON.stringify(compact)
      ).catch(() => {});
    } catch {}
  }, 220);
}

export async function hydrateInboxCacheFromStorage(
  accountId: string | null | undefined
): Promise<InboxMemorySnapshot | null> {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return null;
  const existing = getInboxMemoryCache(normalized);
  if (existing && (existing.dmConversations.length > 0 || existing.studentConfig || existing.adminRooms.length > 0)) {
    return existing;
  }
  try {
    const raw = await AsyncStorage.getItem(`${INBOX_STORAGE_KEY_PREFIX}${normalized}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InboxMemorySnapshot;
    if (!parsed || parsed.accountId !== normalized) return null;
    ensureChatCacheAccount(normalized);
    const current = getInboxMemoryCache(normalized);
    inboxCache = current
      ? {
          ...parsed,
          ...current,
          dmConversations: current.dmConversations.length > 0 ? current.dmConversations : parsed.dmConversations,
          adminRooms: current.adminRooms.length > 0 ? current.adminRooms : parsed.adminRooms,
          studentConfig: current.studentConfig || parsed.studentConfig,
          studentPreview: current.studentPreview || parsed.studentPreview,
          kyanaPreview: current.kyanaPreview || parsed.kyanaPreview,
          cohortMembers: current.cohortMembers.length > 0 ? current.cohortMembers : parsed.cohortMembers,
        }
      : parsed;
    return inboxCache;
  } catch {
    return null;
  }
}

export interface InboxMemorySnapshot {
  accountId: string;
  adminRooms: AdminChatRoom[];
  studentConfig: ChatConfig | null;
  studentPreview?: { latestMessage?: string | null; latestMessageAt?: string | null };
  dmConversations: DmConversationItem[];
  dmEnabled: boolean;
  kyanaPreview: KyanaInboxPreview | null;
  cohortMembers: ChatMember[];
  updatedAt: number;
}

export interface DmThreadMemorySnapshot {
  accountId: string;
  conversationId: string;
  messages: DmMessage[];
  peerLastReadMessageId: number | null;
  peerInfo?: {
    studentId?: string;
    name?: string;
    username?: string;
    role?: string;
    avatarUrl?: string | null;
    department?: string;
    semester?: string;
  };
  updatedAt: number;
}

export interface CohortThreadMemorySnapshot {
  accountId: string;
  chatGroupId: string;
  messages: ChatMessage[];
  pinned: ChatPinned | null;
  readReceipts: ChatReadReceipt[];
  updatedAt: number;
}

export interface KyanaThreadMemorySnapshot {
  accountId: string;
  conversation: KyanaConversation | null;
  messages: KyanaMessage[];
  updatedAt: number;
}

let activeAccountId: string | null = null;
let inboxCache: InboxMemorySnapshot | null = null;
const dmThreadCache = new Map<string, DmThreadMemorySnapshot>();
const cohortThreadCache = new Map<string, CohortThreadMemorySnapshot>();
let kyanaThreadCache: KyanaThreadMemorySnapshot | null = null;
const dmPrefetchInFlight = new Map<string, Promise<void>>();

function normalizeAccount(accountId?: string | null): string {
  return String(accountId || '').trim().toLowerCase();
}

export function ensureChatCacheAccount(accountId?: string | null): void {
  const normalized = normalizeAccount(accountId);
  if (!normalized) {
    clearAllChatMemoryCache();
    return;
  }
  if (activeAccountId && activeAccountId !== normalized) {
    clearAllChatMemoryCache();
  }
  activeAccountId = normalized;
}

export function clearAllChatMemoryCache(): void {
  if (persistInboxTimer) {
    clearTimeout(persistInboxTimer);
    persistInboxTimer = null;
  }
  activeAccountId = null;
  inboxCache = null;
  dmThreadCache.clear();
  cohortThreadCache.clear();
  kyanaThreadCache = null;
  dmPrefetchInFlight.clear();
}

export function getInboxMemoryCache(accountId?: string | null): InboxMemorySnapshot | null {
  const normalized = normalizeAccount(accountId);
  if (!normalized || !inboxCache || inboxCache.accountId !== normalized) {
    return null;
  }
  return inboxCache;
}

export function patchInboxMemoryCache(
  accountId: string | null | undefined,
  patch: Partial<Omit<InboxMemorySnapshot, 'accountId' | 'updatedAt'>>
): InboxMemorySnapshot | null {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return null;
  ensureChatCacheAccount(normalized);

  const prev = inboxCache && inboxCache.accountId === normalized
    ? inboxCache
    : {
        accountId: normalized,
        adminRooms: [],
        studentConfig: null,
        studentPreview: undefined,
        dmConversations: [],
        dmEnabled: false,
        kyanaPreview: null,
        cohortMembers: [],
        updatedAt: Date.now(),
      };

  inboxCache = {
    ...prev,
    ...patch,
    accountId: normalized,
    updatedAt: Date.now(),
  };
  scheduleInboxPersist(inboxCache);
  return inboxCache;
}

export function getDmThreadMemoryCache(
  accountId: string | null | undefined,
  conversationId: string | null | undefined
): DmThreadMemorySnapshot | null {
  const normalized = normalizeAccount(accountId);
  const convId = String(conversationId || '').trim();
  if (!normalized || !convId) return null;
  const entry = dmThreadCache.get(convId);
  if (entry && entry.accountId === normalized && entry.messages.length > 0) {
    return entry;
  }
  // Fall back to TanStack React Query's persisted cache (survives cold restarts)
  const persisted = getPersistedDmThread(normalized, convId);
  if (persisted && persisted.messages.length > 0) {
    const hydrated: DmThreadMemorySnapshot = {
      accountId: normalized,
      conversationId: convId,
      messages: persisted.messages,
      peerLastReadMessageId: persisted.peerLastReadMessageId ?? null,
      updatedAt: persisted.updatedAt,
    };
    dmThreadCache.set(convId, hydrated);
    return hydrated;
  }
  return entry && entry.accountId === normalized ? entry : null;
}

export function setDmThreadMemoryCache(
  accountId: string | null | undefined,
  conversationId: string | null | undefined,
  patch: Partial<Omit<DmThreadMemorySnapshot, 'accountId' | 'conversationId' | 'updatedAt'>>
): void {
  const normalized = normalizeAccount(accountId);
  const convId = String(conversationId || '').trim();
  if (!normalized || !convId) return;
  ensureChatCacheAccount(normalized);

  const prev = dmThreadCache.get(convId);
  const base: DmThreadMemorySnapshot =
    prev && prev.accountId === normalized
      ? prev
      : {
          accountId: normalized,
          conversationId: convId,
          messages: [],
          peerLastReadMessageId: null,
          updatedAt: Date.now(),
        };

  const next: DmThreadMemorySnapshot = {
    ...base,
    ...patch,
    accountId: normalized,
    conversationId: convId,
    updatedAt: Date.now(),
  };
  dmThreadCache.set(convId, next);
  setPersistedDmThread(normalized, convId, {
    messages: next.messages,
    peerLastReadMessageId: next.peerLastReadMessageId ?? 0,
  });
}

/**
 * Silently pre-warms a DM thread into TanStack React Query's persisted cache + memory
 * (deduped with staleTime) so tapping a conversation row renders messages on frame 0.
 */
export function prefetchDmThread(
  accountId: string | null | undefined,
  conversationId: string | null | undefined,
  options?: { network?: boolean }
): Promise<void> {
  const rawAccount = String(accountId || '').trim();
  const normalized = normalizeAccount(accountId);
  const convId = String(conversationId || '').trim();
  if (!rawAccount || !normalized || !convId) return Promise.resolve();

  const inflightKey = `${normalized}:${convId}`;
  const existingPromise = dmPrefetchInFlight.get(inflightKey);
  if (existingPromise) return existingPromise;

  const task = prefetchDmThreadQuery(rawAccount, convId, options)
    .then(() => {
      const persisted = getPersistedDmThread(normalized, convId);
      if (persisted && persisted.messages.length > 0) {
        dmThreadCache.set(convId, {
          accountId: normalized,
          conversationId: convId,
          messages: persisted.messages,
          peerLastReadMessageId: persisted.peerLastReadMessageId ?? null,
          updatedAt: persisted.updatedAt,
        });
      }
    })
    .catch(() => {})
    .finally(() => {
      dmPrefetchInFlight.delete(inflightKey);
    });

  dmPrefetchInFlight.set(inflightKey, task);
  return task;
}

export function getCohortThreadMemoryCache(
  accountId: string | null | undefined,
  chatGroupId?: string | null
): CohortThreadMemorySnapshot | null {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return null;
  const groupKey = String(chatGroupId || '__default__').trim();
  const entry = cohortThreadCache.get(groupKey);
  if (entry && entry.accountId === normalized && entry.messages.length > 0) return entry;
  const persisted = getPersistedCohortThread(normalized, groupKey);
  if (persisted && persisted.messages.length > 0) {
    const hydrated: CohortThreadMemorySnapshot = {
      accountId: normalized,
      chatGroupId: groupKey,
      messages: persisted.messages,
      pinned: persisted.pinned,
      readReceipts: persisted.readReceipts,
      updatedAt: persisted.updatedAt,
    };
    cohortThreadCache.set(groupKey, hydrated);
    return hydrated;
  }
  return entry && entry.accountId === normalized ? entry : null;
}

export function setCohortThreadMemoryCache(
  accountId: string | null | undefined,
  chatGroupId: string | null | undefined,
  patch: Partial<Omit<CohortThreadMemorySnapshot, 'accountId' | 'chatGroupId' | 'updatedAt'>>
): void {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return;
  ensureChatCacheAccount(normalized);
  const groupKey = String(chatGroupId || '__default__').trim();
  const prev = cohortThreadCache.get(groupKey);
  const base: CohortThreadMemorySnapshot =
    prev && prev.accountId === normalized
      ? prev
      : {
          accountId: normalized,
          chatGroupId: groupKey,
          messages: [],
          pinned: null,
          readReceipts: [],
          updatedAt: Date.now(),
        };
  const next: CohortThreadMemorySnapshot = {
    ...base,
    ...patch,
    accountId: normalized,
    chatGroupId: groupKey,
    updatedAt: Date.now(),
  };
  cohortThreadCache.set(groupKey, next);
  if (groupKey !== '__default__') {
    cohortThreadCache.set('__default__', next);
  }
  setPersistedCohortThread(normalized, groupKey, {
    messages: next.messages,
    pinned: next.pinned,
    readReceipts: next.readReceipts,
  });
}

export function getKyanaMemoryCache(
  accountId: string | null | undefined
): KyanaThreadMemorySnapshot | null {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return null;
  if (kyanaThreadCache && kyanaThreadCache.accountId === normalized && kyanaThreadCache.messages.length > 0) {
    return kyanaThreadCache;
  }
  const persisted = getPersistedKyanaThread(normalized);
  if (persisted && persisted.messages.length > 0) {
    kyanaThreadCache = {
      accountId: normalized,
      conversation: persisted.conversation,
      messages: persisted.messages,
      updatedAt: persisted.updatedAt,
    };
    return kyanaThreadCache;
  }
  return kyanaThreadCache && kyanaThreadCache.accountId === normalized ? kyanaThreadCache : null;
}

export function setKyanaMemoryCache(
  accountId: string | null | undefined,
  patch: Partial<Omit<KyanaThreadMemorySnapshot, 'accountId' | 'updatedAt'>>
): void {
  const normalized = normalizeAccount(accountId);
  if (!normalized) return;
  ensureChatCacheAccount(normalized);
  const prev = kyanaThreadCache && kyanaThreadCache.accountId === normalized
    ? kyanaThreadCache
    : {
        accountId: normalized,
        conversation: null,
        messages: [],
        updatedAt: Date.now(),
      };
  kyanaThreadCache = {
    ...prev,
    ...patch,
    accountId: normalized,
    updatedAt: Date.now(),
  };
  setPersistedKyanaThread(normalized, {
    conversation: kyanaThreadCache.conversation,
    messages: kyanaThreadCache.messages,
  });
}
