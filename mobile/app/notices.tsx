import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { apiFetch } from '@/services/api';
import { formatDate, formatTimeAgo } from '@/utils/date';

interface NoticeItem {
  id: number;
  title?: string | null;
  content: string;
  createdAt: string;
  created_at?: string;
  timestamp?: string;
  name: string;
  role?: string;
  studentId: string;
  avatarUrl?: string;
  imageUrl?: string;
  is_official?: boolean;
}

export default function NoticesScreen() {
  const router = useRouter();
  const { id: targetNoticeId } = useLocalSearchParams<{ id?: string }>();
  const { colors, spacing, radii } = useTheme();
  const { serverUrl } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);

  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getFullUrl = (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = (serverUrl || '').replace(/\/+$/, '');
    const clean = path.replace(/^\/+/, '');
    return `${base}/${clean}`;
  };

  const fetchNotices = useCallback(async () => {
    try {
      const limit = targetNoticeId ? '100' : '50';
      const res = await apiFetch(`/api/posts?type=notice&official=true&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.posts) ? data.posts : Array.isArray(data) ? data : [];
        setNotices(list);
      }
    } catch (err) {
      console.warn('Could not fetch notices:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetNoticeId]);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotices();
  };

  // Helper to extract a title from the notice content
  const extractNoticeTitleAndBody = (rawContent: string) => {
    const lines = rawContent.trim().split('\n').filter(Boolean);
    if (lines.length > 1 && lines[0].length < 80) {
      return {
        title: lines[0].replace(/^#+\s*/, ''),
        preview: lines.slice(1).join(' '),
      };
    }
    return {
      title: 'University Notice',
      preview: rawContent,
    };
  };

  return (
    <ScrollView
      ref={scrollViewRef}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { padding: spacing.normal }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ marginBottom: spacing.normal }}>
        <Heading style={{ fontSize: 22 }}>Notices</Heading>
        <Caption color="muted">Gandaki University Announcements & Circulars</Caption>
      </View>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : notices.length === 0 ? (
        <EmptyState
          icon="megaphone-outline"
          title="No Notices Published Yet"
          description="Announcements, exam schedules, and circulars from university administration and CRs will appear here."
        />
      ) : (
        notices.map((notice) => {
          const authorAvatar = getFullUrl(notice.avatarUrl);
          const noticeImage = getFullUrl(notice.imageUrl);
          const isTarget = Boolean(targetNoticeId && String(notice.id) === String(targetNoticeId));
          const noticeDate = notice.createdAt || notice.created_at || notice.timestamp;

          const { title: fallbackTitle, preview: fallbackPreview } = extractNoticeTitleAndBody(notice.content);
          const displayTitle = (notice.title && notice.title.trim()) || fallbackTitle;
          const displayPreview = (notice.title && notice.title.trim()) ? (notice.content || '') : fallbackPreview;

          return (
            <SurfaceCard
              key={notice.id}
              variant="elevated"
              padding="normal"
              onPress={() => router.push(`/notice/${notice.id}`)}
              style={[
                styles.noticeCard,
                {
                  borderColor: isTarget ? colors.primary : colors.border,
                  borderWidth: isTarget ? 2 : 1,
                  backgroundColor: isTarget ? colors.surfaceRaised : colors.card,
                  marginBottom: spacing.normal,
                },
              ]}
              onLayout={(e) => {
                if (isTarget) {
                  const y = e.nativeEvent.layout.y;
                  scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
                }
              }}
            >
              {/* Highlight badge for targeted notice from push notification */}
              {isTarget && (
                <View style={styles.selectedRow}>
                  <Ionicons name="bookmark" size={12} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                    Selected Notice
                  </Text>
                </View>
              )}

              {/* 1. Publisher & Metadata Header (Profile things) */}
              <View style={styles.headerRow}>
                <View style={styles.publisherInfo}>
                  <Avatar
                    url={authorAvatar}
                    name={notice.name}
                    size="sm"
                  />
                  <View style={{ marginLeft: spacing.tight, flex: 1 }}>
                    <Text variant="sm" weight="700" numberOfLines={1}>
                      {notice.name}
                    </Text>
                    <View style={styles.subMetaRow}>
                      <Text variant="xs" color="muted">
                        {formatDate(noticeDate)} • {formatTimeAgo(noticeDate)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 2. Notice Title */}
              <Text
                variant="md"
                weight="700"
                numberOfLines={2}
                style={[styles.noticeTitle, { color: colors.text, marginTop: spacing.compact }]}
              >
                {displayTitle}
              </Text>

              {/* 3. 2-3 Line Content Preview */}
              <Text
                variant="sm"
                color="secondary"
                numberOfLines={3}
                style={[styles.noticePreview, { marginTop: spacing.micro + 2 }]}
              >
                {displayPreview}
              </Text>

              {/* Attachment Indicator / Image */}
              {noticeImage ? (
                <View
                  style={[
                    styles.attachmentIndicator,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.borderSubtle,
                      borderRadius: radii.input,
                      marginTop: spacing.compact,
                    },
                  ]}
                >
                  <Ionicons name="document-attach-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                  <Text variant="xs" weight="600" color="primary">
                    Official Document Attached
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
                </View>
              ) : null}
            </SurfaceCard>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  noticeCard: {
    borderRadius: 16,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  publisherInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  subMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  noticeTitle: {
    letterSpacing: -0.2,
  },
  noticePreview: {
    lineHeight: 20,
  },
  attachmentIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
});
