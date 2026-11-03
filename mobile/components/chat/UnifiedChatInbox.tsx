import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Typography';
import { Monochrome } from '@/constants/theme';
import { DEFAULT_SERVER_URL } from '@/services/api';
import type { ChatMember } from '@/services/chat';
import {
  type UnifiedConversationItem,
  type CohortConversationItem,
  type DmConversationItem,
  type KyanaConversationItem,
  type InboxFilterTab,
  filterUnifiedConversations,
  searchUnifiedConversations,
  sortUnifiedConversations,
  partitionInboxSections,
} from '@/services/unified-inbox';

export interface ActiveNowPerson {
  studentId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  role?: string;
  isOnline?: boolean;
  talkScore?: number;
  lastActiveEpoch?: number;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getFirstName(name?: string): string {
  if (!name) return 'Student';
  const trimmed = name.trim();
  if (!trimmed) return 'Student';
  return trimmed.split(/\s+/)[0];
}

function resolveAvatarUri(rawUrl?: string | null, serverUrl?: string, studentId?: string | null): string | null {
  const base = (serverUrl || DEFAULT_SERVER_URL || '').replace(/\/+$/, '');
  if (rawUrl && typeof rawUrl === 'string') {
    const trimmed = rawUrl.trim();
    if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://') || trimmed.startsWith('data:')) {
        return trimmed;
      }
      if (base) {
        return `${base}/${trimmed.replace(/^\/+/, '')}`;
      }
    }
  }
  if (studentId && typeof studentId === 'string' && studentId.trim() && base) {
    return `${base}/api/avatar/student/${encodeURIComponent(studentId.trim())}`;
  }
  return null;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return SHORT_DAYS[date.getDay()];
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

const COHORT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  mercury: 'planet-outline',
  venus: 'sparkles-outline',
  earth: 'globe-outline',
  mars: 'flame-outline',
};

type InboxListEntry =
  | { entryKey: 'header:pinned'; entryType: 'section_header'; title: 'PINNED' }
  | { entryKey: 'header:messages'; entryType: 'section_header'; title: 'MESSAGES' }
  | { entryKey: string; entryType: 'item'; item: UnifiedConversationItem };

function AvatarWithFallback({
  uri,
  name,
  size = 54,
  headers,
  preferSilhouette = false,
}: {
  uri: string | null;
  name: string;
  size?: number;
  headers?: Record<string, string>;
  preferSilhouette?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const radius = size / 2;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri, headers, cacheKey: uri }}
        cachePolicy="memory-disk"
        transition={0}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: '#18181B',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: '#27272A',
        }}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  if (preferSilhouette) {
    return (
      <View
        style={[
          styles.silhouetteAvatar,
          { width: size, height: size, borderRadius: radius },
        ]}
      >
        <Ionicons name="person" size={Math.round(size * 0.5)} color="#E4E4E7" />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.dmAvatarFallback,
        { width: size, height: size, borderRadius: radius },
      ]}
    >
      <Text style={[styles.dmAvatarInitialText, { fontSize: Math.max(13, Math.round(size * 0.32)) }]}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

function SemesterGroupAvatar({
  cohortItem,
  collageUris,
  headers,
}: {
  cohortItem: CohortConversationItem;
  collageUris: string[];
  headers?: Record<string, string>;
}) {
  const slot = (cohortItem.groupCode || '').toLowerCase();
  const iconName = COHORT_ICONS[slot] || 'planet-outline';

  return (
    <View style={styles.groupAvatarWrapper}>
      {collageUris.length >= 2 ? (
        <View style={styles.collageCircle}>
          {[0, 1, 2, 3].map((idx) => {
            const uri = collageUris[idx % collageUris.length];
            return (
              <View key={idx} style={styles.collageQuadrant}>
                <Image
                  source={{ uri, headers, cacheKey: uri }}
                  cachePolicy="memory-disk"
                  style={styles.collageImage}
                  contentFit="cover"
                />
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.cohortAvatar}>
          <Ionicons name={iconName} size={22} color={Monochrome.cohortAvatarIcon} />
        </View>
      )}
      <View style={styles.groupBadgeOverlay}>
        <Ionicons name="people" size={11} color="#F4F4F5" />
      </View>
    </View>
  );
}

export interface UnifiedChatInboxProps {
  items: UnifiedConversationItem[];
  loading: boolean;
  refreshing: boolean;
  cohortError?: string | null;
  dmError?: string | null;
  dmEnabled: boolean;
  isTeacher?: boolean;
  onlineIds?: string[];
  cohortMembers?: ChatMember[];
  memberTalkStats?: Record<string, { count: number; lastAt: number }>;
  currentUserId?: string;
  serverUrl?: string;
  authToken?: string | null;
  onRefresh: () => void;
  onRetryCohort?: () => void;
  onRetryDm?: () => void;
  onSelectCohort: (item: CohortConversationItem) => void;
  onSelectDm: (item: DmConversationItem) => void;
  onSelectKyana?: () => void;
  onSelectOnlineUser?: (person: ActiveNowPerson) => void;
  onNewMessage: () => void;
}

export function UnifiedChatInbox({
  items,
  loading,
  refreshing,
  cohortError,
  dmError,
  dmEnabled,
  isTeacher = false,
  onlineIds = [],
  cohortMembers = [],
  memberTalkStats = {},
  currentUserId,
  serverUrl,
  authToken,
  onRefresh,
  onRetryCohort,
  onRetryDm,
  onSelectCohort,
  onSelectDm,
  onSelectKyana,
  onSelectOnlineUser,
  onNewMessage,
}: UnifiedChatInboxProps) {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<InboxFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const imageHeaders = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined),
    [authToken]
  );

  // Stable online IDs signature so Active Now never remounts or blinks when array reference changes
  const onlineIdsSignature = useMemo(
    () =>
      onlineIds
        .map((id) => (id ? String(id).trim() : ''))
        .filter(Boolean)
        .sort()
        .join(','),
    [onlineIds]
  );

  // Set of currently online student IDs from real-time presence
  const onlineSet = useMemo(() => {
    const set = new Set<string>();
    if (!onlineIdsSignature) return set;
    for (const id of onlineIdsSignature.split(',')) {
      if (id) set.add(id);
    }
    return set;
  }, [onlineIdsSignature]);

  // Always show classmate/peer avatars in the horizontal circle row:
  // - Online users appear in front with the green online dot
  // - Offline users (and ties among online users) are ordered by who talks more (highest message/DM activity & recency)
  const carouselClassmates = useMemo(() => {
    const byId = new Map<string, ActiveNowPerson>();

    // Index DM activity per peer
    const dmStatsByPeer = new Map<string, { dmBonus: number; lastDmEpoch: number; item: DmConversationItem }>();
    items.forEach((item, index) => {
      if (item.type !== 'dm') return;
      const peerId = String(item.peerId || '');
      if (!peerId || peerId === String(currentUserId || '')) return;
      const dmEpoch = item.timestamp ? Date.parse(item.timestamp) : 0;
      const recencyRankBonus = Math.max(1, 50 - index);
      const dmBonus = (item.subtitle ? 25 : 10) + (item.unreadCount || 0) * 5 + recencyRankBonus;
      dmStatsByPeer.set(peerId, {
        dmBonus,
        lastDmEpoch: Number.isFinite(dmEpoch) ? dmEpoch : 0,
        item,
      });
    });

    // 1. Add all authorized semester cohort members
    for (const member of cohortMembers) {
      const id = String(member.studentId || '');
      if (!id || id === String(currentUserId || '') || byId.has(id)) continue;
      const groupStat = memberTalkStats[id];
      const dmStat = dmStatsByPeer.get(id);
      const isOnline = onlineSet.has(id);
      const talkScore = (groupStat?.count || 0) * 3 + (dmStat?.dmBonus || 0);
      const lastActiveEpoch = Math.max(groupStat?.lastAt || 0, dmStat?.lastDmEpoch || 0);
      byId.set(id, {
        studentId: id,
        name: member.name || dmStat?.item.title || 'Student',
        username: member.username || dmStat?.item.peerUsername || null,
        avatarUrl: member.avatarUrl || dmStat?.item.peerAvatarUrl || null,
        role: member.role || dmStat?.item.peerRole || 'student',
        isOnline,
        talkScore,
        lastActiveEpoch,
      });
    }

    // 2. Also include any DM conversation peers not already in cohortMembers
    for (const [peerId, dmStat] of dmStatsByPeer.entries()) {
      if (byId.has(peerId)) continue;
      const groupStat = memberTalkStats[peerId];
      const isOnline = onlineSet.has(peerId);
      const talkScore = (groupStat?.count || 0) * 3 + dmStat.dmBonus;
      const lastActiveEpoch = Math.max(groupStat?.lastAt || 0, dmStat.lastDmEpoch);
      byId.set(peerId, {
        studentId: peerId,
        name: dmStat.item.title,
        username: dmStat.item.peerUsername,
        avatarUrl: dmStat.item.peerAvatarUrl,
        role: dmStat.item.peerRole,
        isOnline,
        talkScore,
        lastActiveEpoch,
      });
    }

    return Array.from(byId.values()).sort((a, b) => {
      // 1. Online people always in front
      if (Boolean(a.isOnline) !== Boolean(b.isOnline)) {
        return a.isOnline ? -1 : 1;
      }
      // 2. Person who talks more comes first
      const scoreDiff = (b.talkScore || 0) - (a.talkScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      // 3. More recent message activity
      const timeDiff = (b.lastActiveEpoch || 0) - (a.lastActiveEpoch || 0);
      if (timeDiff !== 0) return timeDiff;
      // 4. Alphabetical fallback
      return a.name.localeCompare(b.name);
    });
  }, [cohortMembers, items, currentUserId, memberTalkStats, onlineSet]);

  const onlineCount = useMemo(
    () => carouselClassmates.filter((p) => p.isOnline).length,
    [carouselClassmates]
  );

  // Member avatar URLs for the Semester Group 2x2 collage avatar
  const collageUris = useMemo(() => {
    const uris: string[] = [];
    const seen = new Set<string>();
    for (const member of cohortMembers) {
      const resolved = resolveAvatarUri(member.avatarUrl, serverUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        uris.push(resolved);
        if (uris.length >= 4) break;
      }
    }
    if (uris.length < 4) {
      for (const item of items) {
        if (item.type === 'dm' && item.peerAvatarUrl) {
          const resolved = resolveAvatarUri(item.peerAvatarUrl, serverUrl);
          if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            uris.push(resolved);
            if (uris.length >= 4) break;
          }
        }
      }
    }
    return uris;
  }, [cohortMembers, items, serverUrl]);

  // Count how many cohort items exist (1 for students, multiple for admins)
  const totalCohortCount = useMemo(
    () => items.filter((i) => i.type === 'cohort').length,
    [items]
  );

  // Preserve pure helpers for test compatibility & deterministic ordering
  const sortedItems = useMemo(() => sortUnifiedConversations(items), [items]);
  const filteredItems = useMemo(
    () => filterUnifiedConversations(sortedItems, activeFilter),
    [sortedItems, activeFilter]
  );
  const displayedItems = useMemo(
    () => searchUnifiedConversations(filteredItems, searchQuery),
    [filteredItems, searchQuery]
  );

  // Partition into PINNED (Kyana AI + Semester Group) and MESSAGES (individual DMs only)
  const { pinned: pinnedItems, messages: messageItems } = useMemo(
    () => partitionInboxSections(items, activeFilter, searchQuery),
    [items, activeFilter, searchQuery]
  );

  // Flatten into sectioned list entries for FlatList
  const listEntries = useMemo<InboxListEntry[]>(() => {
    const entries: InboxListEntry[] = [];
    if (pinnedItems.length > 0) {
      entries.push({
        entryKey: 'header:pinned',
        entryType: 'section_header',
        title: 'PINNED',
      });
      for (const item of pinnedItems) {
        entries.push({
          entryKey: `pinned:${item.key}`,
          entryType: 'item',
          item,
        });
      }
    }
    if (messageItems.length > 0) {
      entries.push({
        entryKey: 'header:messages',
        entryType: 'section_header',
        title: 'MESSAGES',
      });
      for (const item of messageItems) {
        entries.push({
          entryKey: item.key,
          entryType: 'item',
          item,
        });
      }
    }
    return entries;
  }, [pinnedItems, messageItems]);

  const renderEntry = useCallback(
    ({ item: entry }: { item: InboxListEntry }) => {
      if (entry.entryType === 'section_header') {
        return (
          <View
            style={[
              styles.sectionHeaderRow,
              entry.title === 'MESSAGES' && styles.sectionHeaderMessages,
            ]}
          >
            <Text style={styles.sectionHeaderText}>{entry.title}</Text>
          </View>
        );
      }

      const { item } = entry;

      // 0. Render Kyana AI pinned assistant row
      if (item.type === 'kyana') {
        const kyanaItem = item as KyanaConversationItem;
        const time = formatRelativeTime(kyanaItem.timestamp);

        return (
          <Pressable
            style={({ pressed }) => [
              styles.itemRow,
              pressed && styles.itemRowPressed,
              styles.kyanaPinnedRow,
            ]}
            onPress={() => onSelectKyana?.()}
            accessibilityRole="button"
            accessibilityLabel="Kyana AI Study Companion conversation"
          >
            {/* Kyana AI Avatar */}
            <View style={styles.kyanaAvatarContainer}>
              <Image
                source={require('../../assets/images/kyana-logo.png')}
                style={styles.kyanaAvatarImage}
                contentFit="contain"
              />
            </View>

            {/* Conversation Details */}
            <View style={styles.itemContent}>
              <View style={styles.itemHeaderRow}>
                <View style={styles.titleWithBadge}>
                  <Text variant="md" weight="600" style={styles.itemTitle} numberOfLines={1}>
                    {kyanaItem.title}
                  </Text>
                </View>
                <View style={styles.headerRightContainer}>
                  {time ? (
                    <Text variant="xs" style={styles.itemTime}>
                      {time}
                    </Text>
                  ) : null}
                  <Ionicons name="pin" size={13} color="#8E8E93" style={styles.pinIcon} />
                </View>
              </View>

              <View style={styles.itemFooterRow}>
                <Text
                  variant="sm"
                  style={styles.itemSubtitle}
                  numberOfLines={1}
                >
                  {kyanaItem.subtitle || 'How can I help you today?'}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      }

      // 1. Render Pinned Semester Group / Cohort Row
      if (item.type === 'cohort') {
        const cohortItem = item as CohortConversationItem;
        const time = formatRelativeTime(cohortItem.timestamp);
        const hasUnread = (cohortItem.unreadCount || 0) > 0;
        const displayTitle =
          !isTeacher && totalCohortCount === 1
            ? 'Semester Group'
            : cohortItem.title;

        return (
          <Pressable
            style={({ pressed }) => [
              styles.itemRow,
              pressed && styles.itemRowPressed,
            ]}
            onPress={() => onSelectCohort(cohortItem)}
            accessibilityRole="button"
            accessibilityLabel={`${displayTitle} class cohort`}
          >
            <SemesterGroupAvatar
              cohortItem={cohortItem}
              collageUris={collageUris}
              headers={imageHeaders}
            />

            {/* Conversation Details */}
            <View style={styles.itemContent}>
              <View style={styles.itemHeaderRow}>
                <View style={styles.titleWithBadge}>
                  <Text
                    variant="md"
                    weight={hasUnread ? '700' : '600'}
                    style={[styles.itemTitle, hasUnread && styles.itemTitleUnread]}
                    numberOfLines={1}
                  >
                    {displayTitle}
                  </Text>
                </View>
                <View style={styles.headerRightContainer}>
                  {time ? (
                    <Text variant="xs" style={styles.itemTime}>
                      {time}
                    </Text>
                  ) : null}
                  <Ionicons name="pin" size={13} color="#8E8E93" style={styles.pinIcon} />
                </View>
              </View>

              <View style={styles.itemFooterRow}>
                <Text
                  variant="sm"
                  style={[styles.itemSubtitle, hasUnread && styles.itemSubtitleUnread]}
                  numberOfLines={1}
                >
                  {cohortItem.subtitle || 'Class conversation'}
                </Text>
                {hasUnread && (
                  <View style={styles.unreadBadge}>
                    <Text variant="xs" weight="700" style={styles.unreadBadgeText}>
                      {cohortItem.unreadCount}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        );
      }

      // 2. Render Individual DM Conversation Item in MESSAGES
      const dmItem = item as DmConversationItem;
      const time = formatRelativeTime(dmItem.timestamp);
      const isOnline = onlineSet.has(String(dmItem.peerId));
      const hasUnread = dmItem.unreadCount > 0;
      const matchedMember = cohortMembers.find((m) => String(m.studentId) === String(dmItem.peerId));
      const avatarUri = resolveAvatarUri(
        dmItem.peerAvatarUrl || matchedMember?.avatarUrl,
        serverUrl,
        dmItem.peerId
      );

      let previewText = dmItem.subtitle || 'Direct message';
      if (
        dmItem.subtitle &&
        dmItem.lastMessageSenderId &&
        currentUserId &&
        String(dmItem.lastMessageSenderId) === String(currentUserId) &&
        !dmItem.subtitle.startsWith('You: ')
      ) {
        previewText = `You: ${dmItem.subtitle}`;
      }

      return (
        <Pressable
          style={({ pressed }) => [
            styles.itemRow,
            pressed && styles.itemRowPressed,
          ]}
          onPress={() => onSelectDm(dmItem)}
          accessibilityRole="button"
          accessibilityLabel={`Conversation with ${dmItem.title}`}
        >
          {/* User Avatar + Online Presence Indicator */}
          <View style={styles.dmAvatarContainer}>
            <AvatarWithFallback
              uri={avatarUri}
              name={dmItem.title}
              size={54}
              headers={imageHeaders}
            />
            {dmItem.isBlocked ? (
              <View style={styles.blockedBadge}>
                <Ionicons name="ban" size={10} color={Monochrome.textTertiary} />
              </View>
            ) : isOnline ? (
              <View style={styles.onlineDotAvatar} />
            ) : null}
          </View>

          {/* Conversation Details */}
          <View style={styles.itemContent}>
            <View style={styles.itemHeaderRow}>
              <View style={styles.titleWithBadge}>
                <Text
                  variant="md"
                  weight={hasUnread ? '700' : '600'}
                  style={[styles.itemTitle, hasUnread && styles.itemTitleUnread]}
                  numberOfLines={1}
                >
                  {dmItem.title}
                </Text>
              </View>
              {time ? (
                <Text variant="xs" style={[styles.itemTime, hasUnread && styles.itemTimeUnread]}>
                  {time}
                </Text>
              ) : null}
            </View>

            <View style={styles.itemFooterRow}>
              <Text
                variant="sm"
                style={[styles.itemSubtitle, hasUnread && styles.itemSubtitleUnread]}
                numberOfLines={1}
              >
                {previewText}
              </Text>
              {hasUnread && (
                <View style={styles.unreadBadge}>
                  <Text variant="xs" weight="700" style={styles.unreadBadgeText}>
                    {dmItem.unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [
      onSelectKyana,
      onSelectCohort,
      onSelectDm,
      isTeacher,
      totalCohortCount,
      collageUris,
      imageHeaders,
      onlineSet,
      cohortMembers,
      serverUrl,
      currentUserId,
    ]
  );

  // Memoized React element (NOT a component function) so FlatList reconciles in-place
  // without unmounting the horizontal ScrollView or snapping scroll position back to top.
  const listHeaderElement = useMemo(() => {
    if (carouselClassmates.length === 0 || searchQuery.trim().length > 0) {
      return undefined;
    }

    return (
      <View style={styles.activeNowSection}>
        <View style={styles.activeNowHeader}>
          <View style={styles.activeNowTitleRow}>
            <View
              style={[
                styles.activeNowHeaderDot,
                onlineCount === 0 && { backgroundColor: '#52525B' },
              ]}
            />
            <Text style={styles.activeNowTitle}>Active now</Text>
          </View>
          <TouchableOpacity
            style={styles.activeNowCountBtn}
            onPress={onNewMessage}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${onlineCount} classmates online`}
          >
            <Text style={styles.activeNowCountText}>
              {onlineCount} online
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.activeNowScrollContent}
        >
          {carouselClassmates.map((person) => {
            const uri = resolveAvatarUri(person.avatarUrl, serverUrl, person.studentId);
            return (
              <TouchableOpacity
                key={person.studentId}
                style={styles.activeNowItem}
                activeOpacity={0.85}
                onPress={() => onSelectOnlineUser?.(person)}
                accessibilityRole="button"
                accessibilityLabel={
                  person.isOnline
                    ? `Message ${person.name}, online now`
                    : `Message ${person.name}`
                }
              >
                <View style={styles.activeNowAvatarWrap}>
                  <AvatarWithFallback
                    uri={uri}
                    name={person.name}
                    size={58}
                    headers={imageHeaders}
                  />
                  {person.isOnline && <View style={styles.activeNowOnlineDot} />}
                </View>
                <Text style={styles.activeNowName} numberOfLines={1}>
                  {getFirstName(person.name)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }, [carouselClassmates, onlineCount, searchQuery, onNewMessage, serverUrl, imageHeaders, onSelectOnlineUser]);

  // Full Screen Error (if cohort loading fails and no items available)
  const isFatalError = !loading && items.length === 0 && Boolean(cohortError || (dmEnabled && dmError));
  if (isFatalError) {
    return (
      <View style={styles.centerErrorContainer}>
        <Ionicons name="cloud-offline-outline" size={44} color={Monochrome.textTertiary} style={{ marginBottom: 12 }} />
        <Text variant="lg" weight="700" style={{ color: Monochrome.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Couldn't load conversations.
        </Text>
        <Text variant="sm" style={{ color: Monochrome.textSecondary, textAlign: 'center', marginBottom: 20 }}>
          {cohortError || dmError || 'Network request failed. Please check your connection.'}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetryCohort || onRefresh}>
          <Text variant="sm" weight="600" style={{ color: Monochrome.textPrimary }}>
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasAnyVisibleRows = listEntries.length > 0 && displayedItems.length >= 0;

  return (
    <View style={styles.container}>
      {/* Top Header Row: Large Chats Title and Rounded-Square Compose Button */}
      <View style={[styles.inboxHeader, { paddingTop: Math.max(insets.top + 6, 16) }]}>
        <Text style={styles.inboxTitle}>
          Chats
        </Text>

        <TouchableOpacity
          style={styles.newChatBtn}
          onPress={onNewMessage}
          accessibilityRole="button"
          accessibilityLabel="Start new conversation"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="create-outline" size={21} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Full-Width Rounded Search Field (~50px height) */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8E8E93" style={{ marginRight: 10 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations..."
          placeholderTextColor="#8E8E93"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
          keyboardAppearance="dark"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={17} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      {/* Compact Pill Filter Controls: All, Unread, Groups */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'all' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('all')}
          activeOpacity={0.75}
        >
          <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'unread' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('unread')}
          activeOpacity={0.75}
        >
          <Text style={[styles.filterChipText, activeFilter === 'unread' && styles.filterChipTextActive]}>
            Unread
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'groups' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('groups')}
          activeOpacity={0.75}
        >
          <Text style={[styles.filterChipText, activeFilter === 'groups' && styles.filterChipTextActive]}>
            Groups
          </Text>
        </TouchableOpacity>
      </View>

      {/* Partial Failure Banners (Monochrome) */}
      {cohortError && items.length > 0 && (
        <View style={styles.partialErrorBanner}>
          <Ionicons name="alert-circle-outline" size={15} color={Monochrome.textSecondary} />
          <Text style={styles.partialErrorText} numberOfLines={1}>
            Could not refresh cohorts.
          </Text>
          {onRetryCohort && (
            <TouchableOpacity onPress={onRetryCohort} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.partialErrorRetryText}>
                Retry
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {dmError && items.length > 0 && (
        <View style={styles.partialErrorBanner}>
          <Ionicons name="alert-circle-outline" size={15} color={Monochrome.textSecondary} />
          <Text style={styles.partialErrorText} numberOfLines={1}>
            Could not refresh direct messages.
          </Text>
          {onRetryDm && (
            <TouchableOpacity onPress={onRetryDm} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.partialErrorRetryText}>
                Retry
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Sectioned Conversation List (Active Now + PINNED + MESSAGES) */}
      {loading && items.length === 0 ? (
        <View style={styles.centerLoadingContainer}>
          <ActivityIndicator size="large" color={Monochrome.textPrimary} />
        </View>
      ) : !hasAnyVisibleRows ? (
        <View style={{ flex: 1 }}>
          {listHeaderElement}
          <View style={styles.emptyContainer}>
            <Ionicons
              name={
                searchQuery
                  ? 'search-outline'
                  : isTeacher
                  ? 'school-outline'
                  : activeFilter === 'unread'
                  ? 'mail-open-outline'
                  : 'chatbubbles-outline'
              }
              size={40}
              color={Monochrome.textTertiary}
            />
            <Text style={styles.emptyTitle}>
              {searchQuery
                ? 'No matching conversations'
                : isTeacher
                ? 'Faculty Communications'
                : activeFilter === 'unread'
                ? 'No unread messages'
                : activeFilter === 'groups'
                ? 'No class groups found'
                : 'No conversations yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? `No chats found for "${searchQuery}"`
                : isTeacher
                ? 'Cohort group chats are restricted to enrolled student sections. Direct messages will appear here when initiated.'
                : activeFilter === 'unread'
                ? 'You are all caught up.'
                : dmEnabled
                ? 'Start a direct message with a classmate or check back for class announcements.'
                : 'Your class announcements and cohort discussions will appear here.'}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={listEntries}
          keyExtractor={(entry) => entry.entryKey}
          renderItem={renderEntry}
          ListHeaderComponent={listHeaderElement}
          removeClippedSubviews={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Monochrome.textPrimary}
            />
          }
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  inboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  inboxTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  newChatBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#262629',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 24,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: '#222225',
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15.5,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 6,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  filterChipActive: {
    backgroundColor: '#262629',
  },
  filterChipInactive: {
    backgroundColor: 'transparent',
  },
  filterChipText: {
    color: '#8E8E93',
    fontSize: 14,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  activeNowSection: {
    paddingTop: 6,
    paddingBottom: 10,
  },
  activeNowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  activeNowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeNowHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  activeNowTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  activeNowCountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  activeNowCountText: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '500',
  },
  activeNowScrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  activeNowItem: {
    alignItems: 'center',
    width: 62,
  },
  activeNowAvatarWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeNowOnlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2.5,
    borderColor: '#000000',
  },
  activeNowName: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 6,
    textAlign: 'center',
  },
  sectionHeaderRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sectionHeaderMessages: {
    paddingTop: 14,
  },
  sectionHeaderText: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  partialErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Monochrome.surfaceElevated,
    borderColor: Monochrome.border,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  partialErrorText: {
    color: Monochrome.textSecondary,
    fontSize: 12,
    flex: 1,
    marginLeft: 6,
  },
  partialErrorRetryText: {
    color: Monochrome.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  listContent: {
    paddingTop: 2,
    paddingBottom: 110,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#18181B',
  },
  itemRowPressed: {
    backgroundColor: '#121214',
  },
  groupAvatarWrapper: {
    width: 54,
    height: 54,
    marginRight: 14,
    position: 'relative',
  },
  collageCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#18181B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#27272A',
  },
  collageQuadrant: {
    width: '50%',
    height: '50%',
    padding: 0.5,
  },
  collageImage: {
    width: '100%',
    height: '100%',
  },
  groupBadgeOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#18181B',
    borderWidth: 2,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cohortAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Monochrome.cohortAvatarBg,
    borderWidth: 1,
    borderColor: Monochrome.cohortAvatarBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dmAvatarContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginRight: 14,
    position: 'relative',
  },
  dmAvatarImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Monochrome.surfaceElevated,
  },
  silhouetteAvatar: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dmAvatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  dmAvatarInitialText: {
    color: '#F4F4F5',
    fontSize: 16,
    fontWeight: '700',
  },
  onlineDotAvatar: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2.5,
    borderColor: '#000000',
  },
  blockedBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    backgroundColor: Monochrome.surface,
    borderRadius: 7,
    padding: 2,
  },
  itemContent: {
    flex: 1,
    justifyContent: 'center',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 6,
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontWeight: '600',
  },
  itemTitleUnread: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  itemTime: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '400',
  },
  itemTimeUnread: {
    color: '#D4D4D8',
    fontWeight: '500',
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemSubtitle: {
    color: '#8E8E93',
    fontSize: 14.5,
    fontWeight: '400',
    flex: 1,
    marginRight: 8,
  },
  itemSubtitleUnread: {
    color: '#F4F4F5',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#000000',
    fontSize: 10.5,
    fontWeight: '700',
  },
  centerLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#000000',
  },
  retryBtn: {
    backgroundColor: Monochrome.surfaceElevated,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Monochrome.border,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 48,
  },
  emptyTitle: {
    color: Monochrome.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
  },
  emptySubtitle: {
    color: Monochrome.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 260,
  },
  kyanaPinnedRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#18181B',
  },
  kyanaAvatarContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#262629',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  kyanaAvatarImage: {
    width: 34,
    height: 34,
  },
  aiBadge: {
    display: 'none',
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinIcon: {
    opacity: 0.85,
  },
});
