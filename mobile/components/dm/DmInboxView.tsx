import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import {
  fetchDmConversations,
  type DmConversationItem,
} from '@/services/dm';
import {
  getCachedDmConversations,
  saveCachedDmConversations,
} from '@/services/dm-db';

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

export interface DmInboxViewProps {
  onUnreadCountChange?: (count: number) => void;
}

export function DmInboxView({ onUnreadCountChange }: DmInboxViewProps = {}) {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [conversations, setConversations] = useState<DmConversationItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigatingRef = useRef(false);

  const accountId = user?.studentId || '';

  // Load from local SQLite cache first for instant 0ms rendering
  const loadCached = useCallback(async () => {
    if (!accountId) return;
    try {
      const cached = await getCachedDmConversations(accountId);
      if (cached && cached.length > 0) {
        setConversations(cached);
        setLoading(false);
      }
    } catch {}
  }, [accountId]);

  // Fetch fresh conversations from backend
  const refreshConversations = useCallback(async () => {
    if (!accountId) return;
    setError(null);
    try {
      const fresh = await fetchDmConversations(50);
      setConversations(fresh);
      void saveCachedDmConversations(accountId, fresh);
    } catch (err: any) {
      if (conversations.length === 0) {
        setError(err.message || 'Could not load messages');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, conversations.length]);

  useEffect(() => {
    void loadCached();
    void refreshConversations();
  }, [loadCached, refreshConversations]);

  // Report total unread count upward for segmented tab badge
  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    onUnreadCountChange?.(total);
  }, [conversations, onUnreadCountChange]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshConversations();
  }, [refreshConversations]);

  // Guard against rapid duplicate taps
  const handleOpenConversation = useCallback(
    (item: DmConversationItem) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      setTimeout(() => {
        navigatingRef.current = false;
      }, 400);

      const peer = item.participant;
      router.push({
        pathname: '/dm/[id]',
        params: {
          id: item.id,
          peerName: peer?.name || 'Conversation',
          peerRole: peer?.role || 'Student',
          peerAvatar: peer?.avatarUrl || '',
        },
      });
    },
    [router]
  );

  const handleNewMessage = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setTimeout(() => {
      navigatingRef.current = false;
    }, 400);

    router.push('/dm/new');
  }, [router]);

  // Filter conversations by participant name, username, or preview text
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = (c.participant?.name || '').toLowerCase();
      const username = (c.participant?.username || '').toLowerCase();
      const preview = (c.lastMessage?.text || '').toLowerCase();
      return name.includes(q) || username.includes(q) || preview.includes(q);
    });
  }, [conversations, searchQuery]);

  const renderItem = useCallback(
    ({ item }: { item: DmConversationItem }) => {
      const peer = item.participant;
      const isUnread = item.unreadCount > 0;
      const role = (peer.role || '').toLowerCase();

      let preview = 'No messages yet';
      let isDeleted = false;
      if (item.lastMessage) {
        if (item.lastMessage.deletedForAll) {
          preview = 'Message deleted';
          isDeleted = true;
        } else if (item.lastMessage.text) {
          const prefix = item.lastMessage.senderId === accountId ? 'You: ' : '';
          preview = prefix + item.lastMessage.text;
        }
      }

      return (
        <Pressable
          style={({ pressed }) => [
            styles.conversationRow,
            {
              backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
              borderBottomColor: colors.borderSubtle,
            },
          ]}
          onPress={() => handleOpenConversation(item)}
        >
          {/* Avatar */}
          <View style={[styles.avatarContainer, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            {peer.avatarUrl ? (
              <Image source={{ uri: peer.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <Text variant="sm" weight="700" style={{ color: colors.text }}>
                {getInitials(peer.name)}
              </Text>
            )}
          </View>

          {/* Details */}
          <View style={styles.detailsContainer}>
            <View style={styles.nameRow}>
              <View style={styles.nameWithRole}>
                <Text variant="md" weight={isUnread ? '700' : '600'} numberOfLines={1} style={{ color: colors.text }}>
                  {peer.name}
                </Text>
                {role && role !== 'student' ? (
                  <View style={[styles.roleBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                    <Text variant="xs" weight="700" style={styles.roleBadgeText}>
                      {role.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="xs" style={{ color: colors.textMuted }}>
                {formatRelativeTime(item.lastMessageAt || item.lastMessage?.createdAt)}
              </Text>
            </View>

            <View style={styles.previewRow}>
              <Text
                variant="sm"
                weight={isUnread ? '600' : '400'}
                numberOfLines={1}
                style={[
                  styles.previewText,
                  {
                    color: isUnread ? colors.text : colors.textSecondary,
                    fontStyle: isDeleted ? 'italic' : 'normal',
                  },
                ]}
              >
                {preview}
              </Text>

              {isUnread ? (
                <View style={[styles.unreadBadge, { backgroundColor: colors.text }]}>
                  <Text variant="xs" weight="700" style={{ color: colors.background }}>
                    {item.unreadCount > 99 ? '99+' : String(item.unreadCount)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [accountId, colors, router]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search Bar & New Message Row */}
      <View style={[styles.headerActions, { borderBottomColor: colors.borderSubtle }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            placeholder="Search conversations..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchInput, { color: colors.text }]}
            returnKeyType="search"
            autoCapitalize="none"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.newMessageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={handleNewMessage}
          accessibilityLabel="New Message"
        >
          <Ionicons name="create-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Loading Skeleton */}
      {loading && conversations.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Loading conversations...
          </Text>
        </View>
      ) : error && conversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
          <Text variant="md" weight="600" style={{ marginTop: 12, color: colors.text }}>
            Could not load conversations
          </Text>
          <Text variant="sm" color="secondary" align="center" style={{ marginTop: 6, marginHorizontal: 32 }}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={refreshConversations}
          >
            <Text variant="sm" weight="600">
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : filteredConversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={44} color={colors.textMuted} />
          <Text variant="lg" weight="700" style={{ marginTop: 14, color: colors.text }}>
            {searchQuery ? 'No results found' : 'No messages yet'}
          </Text>
          <Text variant="sm" color="secondary" align="center" style={{ marginTop: 6, marginHorizontal: 40, lineHeight: 20 }}>
            {searchQuery
              ? `No conversations match "${searchQuery}"`
              : 'Connect privately with classmates, CRs, teachers, and administrators.'}
          </Text>
          {!searchQuery ? (
            <TouchableOpacity
              style={[styles.startChatBtn, { backgroundColor: colors.text }]}
              onPress={() => router.push('/dm/new')}
            >
              <Text variant="sm" weight="700" style={{ color: colors.background }}>
                New Message
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  newMessageBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingVertical: 4,
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  avatarImage: {
    width: 46,
    height: 46,
  },
  detailsContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameWithRole: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 9,
    letterSpacing: 0.3,
    color: '#a3a3a3',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewText: {
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: -40,
  },
  startChatBtn: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
});
