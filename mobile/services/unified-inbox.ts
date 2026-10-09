/**
 * Unified Chat Inbox Data Foundation (Stage A)
 *
 * Provides pure, network-free data structures, normalization adapters,
 * deterministic sorting, and filtering for combining cohort conversations
 * and private 1-to-1 conversations.
 *
 * Strictly adheres to:
 * - Genuine API fields only (no invented fields or manufactured dates).
 * - Stable, namespaced presentation keys ('cohort:<id>', 'dm:<id>').
 * - Failure and permission isolation (presentation-only layer).
 */

import type { AdminChatRoom, ChatConfig } from './chat';
import type { DmConversationItem as RawDmConversation } from './dm';

export type ConversationType = 'cohort' | 'dm';
export type PresentationKey = `cohort:${string}` | `dm:${string}`;
export type InboxFilterTab = 'all' | 'unread' | 'groups';

export interface CohortConversationItem {
  readonly key: `cohort:${string}`;
  readonly type: 'cohort';
  readonly chatGroupId: string;
  readonly cohortId: string;
  readonly groupCode: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly timestamp: string | null;
  readonly unreadCount: number | null;
  readonly currentSemester: number;
  readonly roomStatus: string;
  readonly cohortStatus?: string;
  readonly canPin?: boolean;
}

export interface DmConversationItem {
  readonly key: `dm:${string}`;
  readonly type: 'dm';
  readonly conversationId: string;
  readonly peerId: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly timestamp: string | null;
  readonly unreadCount: number;
  readonly peerUsername: string | null;
  readonly peerAvatarUrl: string | null;
  readonly peerRole: string;
  readonly isMuted: boolean;
  readonly isBlocked: boolean;
  readonly isBlockedByMe: boolean;
  readonly isBlockedByPeer: boolean;
}

export type UnifiedConversationItem = CohortConversationItem | DmConversationItem;

/**
 * Validates whether a value is a genuine ISO timestamp parseable by Date.parse.
 * Returns the parsed epoch millisecond or null if missing/invalid.
 */
export function parseActivityTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp || typeof timestamp !== 'string') return null;
  const trimmed = timestamp.trim();
  if (!trimmed) return null;
  const epoch = Date.parse(trimmed);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * Transforms an AdminChatRoom record into a CohortConversationItem.
 * Returns null if the source record is malformed.
 */
export function adaptAdminCohortRoom(room: AdminChatRoom | null | undefined): CohortConversationItem | null {
  if (!room || typeof room !== 'object') return null;
  const chatGroupId = String(room.chatGroupId || '').trim();
  if (!chatGroupId) return null;

  const validTimestamp = parseActivityTimestamp(room.latestMessageAt);
  const subtitle = typeof room.latestMessage === 'string' && room.latestMessage.trim().length > 0
    ? room.latestMessage.trim()
    : null;

  const unreadCount = typeof room.unreadCount === 'number' && Number.isFinite(room.unreadCount) && room.unreadCount >= 0
    ? room.unreadCount
    : null;

  const title = (room.cohortDisplayName && room.cohortDisplayName.trim()) ||
    (room.groupCode ? (room.groupCode.charAt(0) + room.groupCode.slice(1).toLowerCase()) : 'Cohort');

  return {
    key: `cohort:${chatGroupId}`,
    type: 'cohort',
    chatGroupId,
    cohortId: String(room.cohortId || '').trim(),
    groupCode: String(room.groupCode || '').trim().toUpperCase(),
    title,
    subtitle,
    timestamp: validTimestamp !== null ? room.latestMessageAt : null,
    unreadCount,
    currentSemester: Number(room.currentSemester) || 0,
    roomStatus: String(room.roomStatus || 'active').trim(),
  };
}

/**
 * Transforms a student/teacher ChatConfig record into a CohortConversationItem.
 * Note: /api/chat/config does not return latestMessage or unreadCount;
 * these can be optionally supplied via local cached preview or explicitly remain null.
 */
export function adaptStudentCohortConfig(
  config: ChatConfig | null | undefined,
  preview?: {
    latestMessage?: string | null;
    latestMessageAt?: string | null;
    unreadCount?: number | null;
  }
): CohortConversationItem | null {
  if (!config || typeof config !== 'object') return null;
  const chatGroupId = String(config.chatGroupId || '').trim();
  if (!chatGroupId) return null;

  const validTimestamp = parseActivityTimestamp(preview?.latestMessageAt);
  const subtitle = typeof preview?.latestMessage === 'string' && preview.latestMessage.trim().length > 0
    ? preview.latestMessage.trim()
    : null;

  const unreadCount = typeof preview?.unreadCount === 'number' && Number.isFinite(preview.unreadCount) && preview.unreadCount >= 0
    ? preview.unreadCount
    : null;

  const groupCode = String(config.groupCode || '').trim().toUpperCase();
  const title = (config.cohortDisplayName && config.cohortDisplayName.trim()) ||
    (groupCode ? (groupCode.charAt(0) + groupCode.slice(1).toLowerCase()) : 'Class Chat');

  return {
    key: `cohort:${chatGroupId}`,
    type: 'cohort',
    chatGroupId,
    cohortId: String(config.cohortId || '').trim(),
    groupCode,
    title,
    subtitle,
    timestamp: validTimestamp !== null ? preview?.latestMessageAt || null : null,
    unreadCount,
    currentSemester: Number(config.currentSemester) || 0,
    roomStatus: String(config.roomStatus || 'active').trim(),
    cohortStatus: config.cohortStatus ? String(config.cohortStatus).trim() : undefined,
    canPin: Boolean(config.permissions?.canPin),
  };
}

/**
 * Transforms a raw DM conversation summary into a DmConversationItem.
 * Returns null if the source record is malformed.
 */
export function adaptDmConversation(
  convo: RawDmConversation | null | undefined
): DmConversationItem | null {
  if (!convo || typeof convo !== 'object') return null;
  const conversationId = String(convo.id || '').trim();
  if (!conversationId) return null;

  const participant = convo.participant || ({} as any);
  const peerId = String(participant.studentId || '').trim();

  const title = (participant.name && String(participant.name).trim()) ||
    (participant.username && String(participant.username).trim()) ||
    'Direct Message';

  // Last message preview handling
  let subtitle: string | null = null;
  let rawTimestamp: string | null = null;

  if (convo.lastMessage && typeof convo.lastMessage === 'object') {
    if (!convo.lastMessage.deletedForAll && typeof convo.lastMessage.text === 'string' && convo.lastMessage.text.trim()) {
      subtitle = convo.lastMessage.text.trim();
    }
    if (typeof convo.lastMessage.createdAt === 'string') {
      rawTimestamp = convo.lastMessage.createdAt;
    }
  }

  if (!rawTimestamp && typeof convo.lastMessageAt === 'string') {
    rawTimestamp = convo.lastMessageAt;
  }

  const validTimestamp = parseActivityTimestamp(rawTimestamp);

  const unreadCount = typeof convo.unreadCount === 'number' && Number.isFinite(convo.unreadCount) && convo.unreadCount >= 0
    ? convo.unreadCount
    : 0;

  return {
    key: `dm:${conversationId}`,
    type: 'dm',
    conversationId,
    peerId,
    title,
    subtitle,
    timestamp: validTimestamp !== null ? rawTimestamp : null,
    unreadCount,
    peerUsername: participant.username ? String(participant.username).trim() : null,
    peerAvatarUrl: participant.avatarUrl ? String(participant.avatarUrl).trim() : null,
    peerRole: String(participant.role || 'student').trim(),
    isMuted: Boolean(convo.isMuted),
    isBlocked: Boolean(convo.blocked),
    isBlockedByMe: Boolean(convo.blockedByMe),
    isBlockedByPeer: Boolean(convo.blockedByPeer),
  };
}

/**
 * Normalizes input arrays of cohort rooms, student cohort configs, and DM conversations
 * into a deduplicated, presentation-ready UnifiedConversationItem array.
 */
export function normalizeUnifiedConversations(params: {
  adminRooms?: (AdminChatRoom | null | undefined)[];
  studentConfig?: ChatConfig | null;
  studentPreview?: {
    latestMessage?: string | null;
    latestMessageAt?: string | null;
    unreadCount?: number | null;
  };
  dmConversations?: (RawDmConversation | null | undefined)[];
}): UnifiedConversationItem[] {
  const seenKeys = new Set<string>();
  const result: UnifiedConversationItem[] = [];

  // 1. Process Admin Cohorts
  if (Array.isArray(params.adminRooms)) {
    for (const room of params.adminRooms) {
      if (!room) continue;
      const adapted = (room as any).type === 'cohort' && (room as any).key
        ? (room as unknown as CohortConversationItem)
        : adaptAdminCohortRoom(room);
      if (adapted && !seenKeys.has(adapted.key)) {
        seenKeys.add(adapted.key);
        result.push(adapted);
      }
    }
  }

  // 2. Process Student Cohort (if provided and not already covered by admin rooms)
  if (params.studentConfig) {
    const adapted = (params.studentConfig as any).type === 'cohort' && (params.studentConfig as any).key
      ? (params.studentConfig as unknown as CohortConversationItem)
      : adaptStudentCohortConfig(params.studentConfig, params.studentPreview);
    if (adapted && !seenKeys.has(adapted.key)) {
      seenKeys.add(adapted.key);
      result.push(adapted);
    }
  }

  // 3. Process DM Conversations
  if (Array.isArray(params.dmConversations)) {
    for (const dm of params.dmConversations) {
      if (!dm) continue;
      const adapted = (dm as any).type === 'dm' && (dm as any).key
        ? (dm as unknown as DmConversationItem)
        : adaptDmConversation(dm);
      if (adapted && !seenKeys.has(adapted.key)) {
        seenKeys.add(adapted.key);
        result.push(adapted);
      }
    }
  }

  return result;
}

/**
 * Deterministically sorts a unified conversation list by genuine activity recency.
 *
 * Rules:
 * 1. Items with valid timestamps are sorted descending (most recent first).
 * 2. Items without timestamps follow timestamped items.
 * 3. Ties (or missing timestamps) are broken deterministically:
 *    - Cohorts before DMs
 *    - Alphabetical by title
 *    - Stable key as final tie-breaker
 * 4. Pure function: does not mutate the source array.
 */
export function sortUnifiedConversations(items: readonly UnifiedConversationItem[]): UnifiedConversationItem[] {
  return [...items].sort((a, b) => {
    const timeA = parseActivityTimestamp(a.timestamp);
    const timeB = parseActivityTimestamp(b.timestamp);

    // Both have valid timestamps
    if (timeA !== null && timeB !== null) {
      if (timeB !== timeA) return timeB - timeA;
    } else if (timeA !== null && timeB === null) {
      return -1; // Valid timestamp comes first
    } else if (timeA === null && timeB !== null) {
      return 1;  // Missing timestamp comes second
    }

    // Deterministic tie-breaker
    if (a.type !== b.type) {
      return a.type === 'cohort' ? -1 : 1;
    }

    const titleComparison = a.title.localeCompare(b.title);
    if (titleComparison !== 0) return titleComparison;

    return a.key.localeCompare(b.key);
  });
}

/**
 * Pure filter function for conversation tabs.
 *
 * Rules:
 * - 'all': returns all items.
 * - 'unread': returns items where unreadCount is confirmed > 0 (does not treat null/unknown as 0).
 * - 'groups': returns cohort items only.
 */
export function filterUnifiedConversations(
  items: readonly UnifiedConversationItem[],
  filter: InboxFilterTab
): UnifiedConversationItem[] {
  switch (filter) {
    case 'unread':
      return items.filter(item => item.unreadCount !== null && item.unreadCount > 0);
    case 'groups':
      return items.filter(item => item.type === 'cohort');
    case 'all':
    default:
      return [...items];
  }
}

/**
 * Pure search function over unified conversations.
 * Searches across title, subtitle, groupCode, and peerUsername case-insensitively.
 * Empty or whitespace query returns all items unchanged.
 */
export function searchUnifiedConversations(
  items: readonly UnifiedConversationItem[],
  query: string
): UnifiedConversationItem[] {
  if (!query || typeof query !== 'string') return [...items];
  const term = query.trim().toLowerCase();
  if (!term) return [...items];

  return items.filter(item => {
    if (item.title.toLowerCase().includes(term)) return true;
    if (item.subtitle && item.subtitle.toLowerCase().includes(term)) return true;
    if (item.type === 'cohort' && item.groupCode.toLowerCase().includes(term)) return true;
    if (item.type === 'dm' && item.peerUsername && item.peerUsername.toLowerCase().includes(term)) return true;
    return false;
  });
}
