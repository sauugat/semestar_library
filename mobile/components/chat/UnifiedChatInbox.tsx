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
import { Text } from '@/components/ui/Typography';
import { Monochrome } from '@/constants/theme';
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

const COHORT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  mercury: 'planet-outline',
  venus: 'sparkles-outline',
  earth: 'globe-outline',
  mars: 'flame-outline',
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
        const iconName = COHORT_ICONS[slot] || 'planet-outline';
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
            {/* Charcoal monochrome cohort avatar */}
            <View style={styles.cohortAvatar}>
              <Ionicons name={iconName} size={20} color={Monochrome.cohortAvatarIcon} />
            </View>

            {/* Conversation Details */}
            <View style={styles.itemContent}>
              <View style={styles.itemHeaderRow}>
                <View style={styles.titleWithBadge}>
                  <Text variant="md" weight="600" style={styles.itemTitle} numberOfLines={1}>
                    {cohortItem.title}
                  </Text>
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
                <Text style={styles.dmAvatarInitialText}>
                  {getInitials(dmItem.title)}
                </Text>
              </View>
            )}
            {dmItem.isBlocked && (
              <View style={styles.blockedBadge}>
                <Ionicons name="ban" size={10} color={Monochrome.textTertiary} />
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
                  <View style={styles.roleChip}>
                    <Text style={styles.roleChipText}>
                      {dmItem.peerRole.toLowerCase()}
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
        <Ionicons name="cloud-offline-outline" size={44} color={Monochrome.textTertiary} style={{ marginBottom: 12 }} />
        <Text variant="lg" weight="700" style={{ color: Monochrome.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Could not load chats
        </Text>
        <Text variant="sm" style={{ color: Monochrome.textSecondary, textAlign: 'center', marginBottom: 20 }}>
          {cohortError || dmError}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Text variant="sm" weight="600" style={{ color: Monochrome.textPrimary }}>
            Try Again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header Row with Minimalist Title and Outline New Message Action */}
      <View style={[styles.inboxHeader, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.inboxTitle}>
          Chats
        </Text>

        {dmEnabled && (
          <TouchableOpacity
            style={styles.newChatBtn}
            onPress={onNewMessage}
            accessibilityRole="button"
            accessibilityLabel="Start new conversation"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="create-outline" size={20} color={Monochrome.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Compact Monochrome Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={15} color={Monochrome.textTertiary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations..."
          placeholderTextColor={Monochrome.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color={Monochrome.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Understated Filter Controls: All, Unread, Groups */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'all' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'unread' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('unread')}
        >
          <Text style={[styles.filterChipText, activeFilter === 'unread' && styles.filterChipTextActive]}>
            Unread
          </Text>
          {totalUnread > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {totalUnread}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'groups' ? styles.filterChipActive : styles.filterChipInactive]}
          onPress={() => setActiveFilter('groups')}
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

      {/* Continuous Conversation List */}
      {loading && items.length === 0 ? (
        <View style={styles.centerLoadingContainer}>
          <ActivityIndicator size="large" color={Monochrome.textPrimary} />
        </View>
      ) : displayedItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name={searchQuery ? 'search-outline' : activeFilter === 'unread' ? 'mail-open-outline' : 'chatbubbles-outline'}
            size={40}
            color={Monochrome.textTertiary}
          />
          <Text style={styles.emptyTitle}>
            {searchQuery
              ? 'No matching conversations'
              : activeFilter === 'unread'
              ? 'No unread messages'
              : activeFilter === 'groups'
              ? 'No class groups found'
              : 'No conversations yet'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {searchQuery
              ? `No chats found for "${searchQuery}"`
              : activeFilter === 'unread'
              ? 'You are all caught up.'
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
              tintColor={Monochrome.textPrimary}
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
    backgroundColor: Monochrome.background,
  },
  inboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  inboxTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: Monochrome.textPrimary,
  },
  newChatBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Monochrome.surface,
    borderWidth: 1,
    borderColor: Monochrome.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Monochrome.surface,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: Monochrome.border,
  },
  searchInput: {
    flex: 1,
    color: Monochrome.textPrimary,
    fontSize: 14,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: '#242424',
    borderColor: '#383838',
  },
  filterChipInactive: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  filterChipText: {
    color: Monochrome.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: Monochrome.textPrimary,
    fontWeight: '600',
  },
  filterBadge: {
    backgroundColor: Monochrome.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 5,
  },
  filterBadgeText: {
    color: Monochrome.textPrimary,
    fontSize: 10,
    fontWeight: '700',
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
    paddingVertical: 2,
    paddingBottom: 90,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Monochrome.borderSubtle,
  },
  itemRowPressed: {
    backgroundColor: Monochrome.surface,
  },
  cohortAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Monochrome.cohortAvatarBg,
    borderWidth: 1,
    borderColor: Monochrome.cohortAvatarBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dmAvatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    position: 'relative',
  },
  dmAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Monochrome.surfaceElevated,
  },
  dmAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Monochrome.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Monochrome.border,
  },
  dmAvatarInitialText: {
    color: Monochrome.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  blockedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: Monochrome.surface,
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
    marginBottom: 3,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 6,
  },
  itemTitle: {
    color: Monochrome.textPrimary,
    fontSize: 15.5,
    fontWeight: '600',
  },
  roleChip: {
    backgroundColor: Monochrome.surfaceSubtle,
    borderWidth: 1,
    borderColor: Monochrome.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  roleChipText: {
    color: Monochrome.textSecondary,
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  itemTime: {
    color: Monochrome.textTertiary,
    fontSize: 12,
    fontWeight: '400',
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemSubtitle: {
    color: Monochrome.textSecondary,
    fontSize: 13.5,
    fontWeight: '400',
    flex: 1,
    marginRight: 8,
  },
  itemSubtitleUnread: {
    color: Monochrome.textPrimary,
    fontWeight: '500',
  },
  unreadBadge: {
    backgroundColor: Monochrome.unreadBadgeBg,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: Monochrome.unreadBadgeText,
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
    backgroundColor: Monochrome.background,
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
    marginTop: 60,
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
});
