import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { getPosts, Post, PostsResponse } from '@/services/posts';
import { useAdaptiveNavScroll } from '@/context/NavScrollContext';
import { formatTimeAgo } from '@/utils/date';

export function TeacherNoticesView() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { onScroll: handleNavScroll, scrollEventThrottle } = useAdaptiveNavScroll();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'official' | 'announcements'>('all');
  const [refreshing, setRefreshing] = useState(false);

  // 1. Fetch university notices & announcements
  const {
    data: noticesData,
    isLoading,
    refetch,
  } = useQuery<PostsResponse>({
    queryKey: ['teacher-notices-feed', user?.studentId],
    queryFn: async () => {
      // Reuses standard getPosts endpoint
      return await getPosts(null, 30);
    },
    staleTime: 45 * 1000,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Filter notices to notice and announcement posts
  const allNotices = useMemo(() => {
    const raw = noticesData?.posts || [];
    return raw.filter((p: Post) => {
      const isNotice = p.category === 'notice' || p.type === 'notice';
      const isOfficial = Boolean(p.is_official);
      const isAnnouncement = p.category === 'announcement';
      return isNotice || isOfficial || isAnnouncement;
    });
  }, [noticesData?.posts]);

  // Apply sub-filter and search
  const displayedNotices = useMemo(() => {
    let list = allNotices;
    if (filterType === 'official') {
      list = list.filter((p: Post) => Boolean(p.is_official));
    } else if (filterType === 'announcements') {
      list = list.filter((p: Post) => p.category === 'announcement');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p: Post) =>
          (p.content || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [allNotices, filterType, searchQuery]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 1. Header Bar */}
      <View style={[styles.header, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text variant="xl" weight="800" style={{ color: colors.text, letterSpacing: -0.5 }}>
            University Notices
          </Text>
          <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
            Official announcements, academic circulars & departmental memos
          </Text>
        </View>
      </View>

      {/* 2. Filter Pills & Search Bar */}
      <View style={styles.filterSection}>
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search notices and circulars…"
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.pill,
              {
                backgroundColor: filterType === 'all' ? colors.text : colors.surfaceRaised,
                borderColor: filterType === 'all' ? colors.text : colors.border,
              },
            ]}
            onPress={() => setFilterType('all')}
          >
            <Text
              variant="xs"
              weight="700"
              style={{ color: filterType === 'all' ? colors.background : colors.textSecondary }}
            >
              All Notices ({allNotices.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pill,
              {
                backgroundColor: filterType === 'official' ? colors.text : colors.surfaceRaised,
                borderColor: filterType === 'official' ? colors.text : colors.border,
              },
            ]}
            onPress={() => setFilterType('official')}
          >
            <Text
              variant="xs"
              weight="700"
              style={{ color: filterType === 'official' ? colors.background : colors.textSecondary }}
            >
              Official Only
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pill,
              {
                backgroundColor: filterType === 'announcements' ? colors.text : colors.surfaceRaised,
                borderColor: filterType === 'announcements' ? colors.text : colors.border,
              },
            ]}
            onPress={() => setFilterType('announcements')}
          >
            <Text
              variant="xs"
              weight="700"
              style={{ color: filterType === 'announcements' ? colors.background : colors.textSecondary }}
            >
              Announcements
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. Notices List */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 110 }]}
        onScroll={handleNavScroll}
        scrollEventThrottle={scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.text}
            colors={[colors.text]}
          />
        }
      >
        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
              Loading university notices…
            </Text>
          </View>
        ) : displayedNotices.length === 0 ? (
          <EmptyState
            icon="megaphone-outline"
            title={searchQuery ? 'No matching notices' : 'No notices posted'}
            description={
              searchQuery
                ? 'Try a different keyword or filter.'
                : 'There are currently no official notices or announcements published.'
            }
          />
        ) : (
          displayedNotices.map((post: Post) => (
            <Card
              key={post.id}
              variant="elevated"
              style={[styles.noticeCard, { borderColor: colors.border }]}
            >
              <View style={styles.noticeHeader}>
                <Avatar
                  name={post.name || 'University'}
                  url={post.avatarUrl}
                  size="sm"
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      {post.name || 'Academic Administration'}
                    </Text>
                    {post.is_official ? (
                      <Badge label="OFFICIAL" variant="official" size="sm" />
                    ) : (
                      <Badge label="NOTICE" variant="neutral" size="sm" />
                    )}
                  </View>
                  <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                    {formatTimeAgo(post.created_at)}
                  </Text>
                </View>
              </View>

              <Text variant="sm" style={[styles.noticeBody, { color: colors.text }]}>
                {post.content}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  filterPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#121212',
    borderWidth: 1,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  noticeBody: {
    fontSize: 14,
    lineHeight: 20,
  },
});
