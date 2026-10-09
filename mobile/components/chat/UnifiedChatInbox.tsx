import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import {
  type UnifiedConversationItem,
  type CohortConversationItem,
  type DmConversationItem,
  type InboxFilterTab,
  filterUnifiedConversations,
  searchUnifiedConversations,
  sortUnifiedConversations,
} from '@/services/unified-inbox';

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const COHORT_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  mercury: { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)', text: '#60a5fa', icon: 'planet-outline' },
  venus: { bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.3)', text: '#c084fc', icon: 'sparkles-outline' },
  earth: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', text: '#34d399', icon: 'globe-outline' },
  mars: { bg: 'rgba(249, 115, 22, 0.15)', border: 'rgba(249, 115, 22, 0.3)', text: '#fb923c', icon: 'flame-outline' },
};

export interface UnifiedChatInboxProps {
  items: UnifiedConversationItem[];
  loading: boolean;
  refreshing: boolean;
  cohortError?: string | null;
  dmError?: string | null;
  dmEnabled: boolean;
  onRefresh: () => void;
  onRetryCohort?: () => void;
  onRetryDm?: () => void;
  onSelectCohort: (item: CohortConversationItem) => void;
  onSelectDm: (item: DmConversationItem) => void;
  onNewMessage: () => void;
}

export function UnifiedChatInbox({
  items,
  loading,
  refreshing,
  cohortError,
  dmError,
  dmEnabled,
  onRefresh,
  onRetryCohort,
  onRetryDm,
  onSelectCohort,
  onSelectDm,
  onNewMessage,
}: UnifiedChatInboxProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<InboxFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Sort deterministically by activity recency
  const sortedItems = useMemo(() => sortUnifiedConversations(items), [items]);

  // 2. Filter by tab ('all' | 'unread' | 'groups')
  const filteredItems = useMemo(
    () => filterUnifiedConversations(sortedItems, activeFilter),
    [sortedItems, activeFilter]
  );

  // 3. Filter by search query
  const displayedItems = useMemo(
    () => searchUnifiedConversations(filteredItems, searchQuery),
    [filteredItems, searchQuery]
  );

  // Compute unread totals
  const totalUnread = useMemo(
    () => items.reduce((sum, item) => sum + (item.unreadCount || 0), 0),
    [items]
  );

  const renderItem = useCallback(
    ({ item }: { item: UnifiedConversationItem }) => {
      const isCohort = item.type === 'cohort';

      if (isCohort) {
        const cohortItem = item as CohortConversationItem;
        const slot = (cohortItem.groupCode || '').toLowerCase();
        const theme = COHORT_COLORS[slot] || COHORT_COLORS.mercury;
        const time = formatRelativeTime(cohortItem.timestamp);

        return (
          <Pressable
            style={({ pressed }) => [
              styles.itemRow,
              pressed && styles.itemRowPressed,
            ]}
            onPress={() => onSelectCohort(cohortItem)}
            accessibilityRole="button"
            accessibilityLabel={`${cohortItem.title} class cohort`}
          >
            {/* Avatar Badge */}
            <View style={[styles.cohortAvatar, { backgroundColor: theme.bg, borderColor: theme.border }]}>
              <Ionicons name={theme.icon as any} size={22} color={theme.text} />
            </View>

            {/* Conversation Details */}
            <View style={styles.itemContent}>
              <View style={styles.itemHeaderRow}>
                <View style={styles.titleWithBadge}>
                  <Text variant="md" weight="700" style={styles.itemTitle} numberOfLines={1}>
                    {cohortItem.title}
                  </Text>
                  <View style={[styles.typeBadge, { backgroundColor: theme.bg }]}>
                    <Text variant="xs" weight="600" style={{ color: theme.text, fontSize: 10 }}>
                      CLASS
                    </Text>
                  </View>
                </View>
                {time ? (
                  <Text variant="xs" style={styles.itemTime}>
                    {time}
                  </Text>
                ) : null}
              </View>

              <View style={styles.itemFooterRow}>
                <Text
                  variant="sm"
                  style={[styles.itemSubtitle, (cohortItem.unreadCount || 0) > 0 && styles.itemSubtitleUnread]}
                  numberOfLines={1}
                >
                  {cohortItem.subtitle || 'Class conversation'}
                </Text>
                {(cohortItem.unreadCount || 0) > 0 && (
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

      // DM Conversation Item
      const dmItem = item as DmConversationItem;
      const time = formatRelativeTime(dmItem.timestamp);
      const isPeerSpecial = dmItem.peerRole === 'admin' || dmItem.peerRole === 'teacher';

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
          {/* User Avatar */}
          <View style={styles.dmAvatarContainer}>
            {dmItem.peerAvatarUrl ? (
              <Image source={{ uri: dmItem.peerAvatarUrl }} style={styles.dmAvatarImage} />
            ) : (
              <View style={styles.dmAvatarFallback}>
                <Text variant="sm" weight="700" style={{ color: '#e4e4e7' }}>
                  {getInitials(dmItem.title)}
                </Text>
              </View>
            )}
            {dmItem.isBlocked && (
              <View style={styles.blockedBadge}>
                <Ionicons name="ban" size={10} color="#ef4444" />
              </View>
            )}
          </View>

          {/* Conversation Details */}
          <View style={styles.itemContent}>
            <View style={styles.itemHeaderRow}>
              <View style={styles.titleWithBadge}>
                <Text variant="md" weight="600" style={styles.itemTitle} numberOfLines={1}>
                  {dmItem.title}
                </Text>
                {isPeerSpecial && (
                  <View style={styles.staffBadge}>
                    <Text variant="xs" weight="600" style={styles.staffBadgeText}>
                      {dmItem.peerRole.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              {time ? (
                <Text variant="xs" style={styles.itemTime}>
                  {time}
                </Text>
              ) : null}
            </View>

            <View style={styles.itemFooterRow}>
              <Text
                variant="sm"
                style={[styles.itemSubtitle, dmItem.unreadCount > 0 && styles.itemSubtitleUnread]}
                numberOfLines={1}
              >
                {dmItem.subtitle || 'Direct message'}
              </Text>
              {dmItem.unreadCount > 0 && (
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
    [onSelectCohort, onSelectDm]
  );

  // Full Screen Error (if both fail and no items)
  if (!loading && cohortError && dmError && items.length === 0) {
    return (
      <View style={styles.centerErrorContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color="#ef4444" style={{ marginBottom: 12 }} />
        <Text variant="lg" weight="700" style={{ color: '#f5f5f5', textAlign: 'center', marginBottom: 8 }}>
          Could not load chats
        </Text>
        <Text variant="sm" style={{ color: '#a1a1aa', textAlign: 'center', marginBottom: 20 }}>
          {cohortError || dmError}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Text variant="sm" weight="600" style={{ color: '#f5f5f5' }}>
            Try Again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header Row with Title and New Message Action */}
      <View style={[styles.inboxHeader, { paddingTop: Math.max(insets.top, 12) }]}>
        <View>
          <Text variant="xl" weight="800" style={{ color: '#f5f5f5' }}>
            Chats
          </Text>
          <Text variant="xs" style={{ color: '#71717a' }}>
            {items.length ? `${items.length} conversation${items.length === 1 ? '' : 's'}` : 'Messages & Groups'}
          </Text>
        </View>

        {dmEnabled && (
          <TouchableOpacity
            style={styles.newChatBtn}
            onPress={onNewMessage}
            accessibilityRole="button"
            accessibilityLabel="Start new conversation"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="create-outline" size={20} color="#f5f5f5" />
          </TouchableOpacity>
        )}
      </View>

      {/* Single Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#71717a" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations..."
          placeholderTextColor="#71717a"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color="#71717a" />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs: All, Unread, Groups */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text
            variant="xs"
            weight={activeFilter === 'all' ? '700' : '500'}
            style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}
          >
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'unread' && styles.filterChipActive]}
          onPress={() => setActiveFilter('unread')}
        >
          <Text
            variant="xs"
            weight={activeFilter === 'unread' ? '700' : '500'}
            style={[styles.filterChipText, activeFilter === 'unread' && styles.filterChipTextActive]}
          >
            Unread
          </Text>
          {totalUnread > 0 && (
            <View style={styles.filterBadge}>
              <Text variant="xs" weight="700" style={{ color: '#fff', fontSize: 10 }}>
                {totalUnread}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'groups' && styles.filterChipActive]}
          onPress={() => setActiveFilter('groups')}
        >
          <Text
            variant="xs"
            weight={activeFilter === 'groups' ? '700' : '500'}
            style={[styles.filterChipText, activeFilter === 'groups' && styles.filterChipTextActive]}
          >
            Groups
          </Text>
        </TouchableOpacity>
      </View>

      {/* Partial Failure Banners */}
      {cohortError && items.length > 0 && (
        <View style={styles.partialErrorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />
          <Text variant="xs" style={{ color: '#fca5a5', flex: 1 }} numberOfLines={1}>
            Could not refresh cohorts.
          </Text>
          {onRetryCohort && (
            <TouchableOpacity onPress={onRetryCohort} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text variant="xs" weight="700" style={{ color: '#60a5fa' }}>
                Retry
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {dmError && items.length > 0 && (
        <View style={styles.partialErrorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />
          <Text variant="xs" style={{ color: '#fca5a5', flex: 1 }} numberOfLines={1}>
            Could not refresh direct messages.
          </Text>
          {onRetryDm && (
            <TouchableOpacity onPress={onRetryDm} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text variant="xs" weight="700" style={{ color: '#60a5fa' }}>
                Retry
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Conversation List */}
      {loading && items.length === 0 ? (
        <View style={styles.centerLoadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : displayedItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name={searchQuery ? 'search-outline' : activeFilter === 'unread' ? 'mail-open-outline' : 'chatbubbles-outline'}
            size={42}
            color="#52525b"
            style={{ marginBottom: 12 }}
          />
          <Text variant="md" weight="600" style={{ color: '#e4e4e7', marginBottom: 4 }}>
            {searchQuery
              ? 'No matching conversations'
              : activeFilter === 'unread'
              ? 'No unread messages'
              : activeFilter === 'groups'
              ? 'No class groups found'
              : 'No conversations yet'}
          </Text>
          <Text variant="xs" style={{ color: '#71717a', textAlign: 'center', maxWidth: 260 }}>
            {searchQuery
              ? `No chats found for "${searchQuery}"`
              : activeFilter === 'unread'
              ? 'You are all caught up!'
              : dmEnabled
              ? 'Start a direct message with a classmate or check back for class announcements.'
              : 'Your class announcements and cohort discussions will appear here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedItems}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3b82f6"
            />
          }
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  inboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  newChatBtn: {
    backgroundColor: '#27272a',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  searchInput: {
    flex: 1,
    color: '#f5f5f5',
    fontSize: 14,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  filterChipActive: {
    backgroundColor: '#27272a',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#71717a',
  },
  filterChipTextActive: {
    color: '#f5f5f5',
  },
  filterBadge: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 5,
  },
  partialErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  listContent: {
    paddingVertical: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#18181b',
  },
  itemRowPressed: {
    backgroundColor: '#18181b',
  },
  cohortAvatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dmAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    position: 'relative',
  },
  dmAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  dmAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  blockedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#18181b',
    borderRadius: 6,
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
  },
  itemTitle: {
    color: '#f5f5f5',
    marginRight: 6,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  staffBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  staffBadgeText: {
    color: '#60a5fa',
    fontSize: 9,
  },
  itemTime: {
    color: '#71717a',
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemSubtitle: {
    color: '#a1a1aa',
    flex: 1,
    marginRight: 8,
  },
  itemSubtitleUnread: {
    color: '#f5f5f5',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 11,
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
    backgroundColor: '#09090b',
  },
  retryBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});
