import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/services/api';

interface NoticeItem {
  id: number;
  content: string;
  createdAt: string;
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

  const formatTimeAgo = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      const diffDay = Math.floor(diffHour / 24);
      if (diffDay < 7) return `${diffDay}d ago`;
      return d.toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const fetchNotices = useCallback(async () => {
    try {
      const limit = targetNoticeId ? '100' : '50';
      const res = await apiFetch(`/api/posts?type=notice&limit=${limit}`);
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

  return (
    <ScrollView
      ref={scrollViewRef}
      contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ marginBottom: spacing.md }}>
        <Heading style={{ fontSize: 22 }}>Official Notices & Circulars</Heading>
        <Caption color="muted">Gandaki University Announcements & Academic Circulars</Caption>
      </View>

      {loading ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="sm" color="muted" style={{ marginTop: 12 }}>
            Loading official notices…
          </Text>
        </View>
      ) : notices.length === 0 ? (
        <Card variant="elevated" padding="lg" style={{ alignItems: 'center', marginVertical: 20 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <Ionicons name="megaphone-outline" size={28} color={colors.textMuted} />
          </View>
          <Text variant="md" weight="700" style={{ marginBottom: 6 }}>
            No Notices Published Yet
          </Text>
          <Caption color="muted" style={{ textAlign: 'center', lineHeight: 18 }}>
            Official announcements, examination schedules, and faculty notices from university administration and CRs will appear here.
          </Caption>
        </Card>
      ) : (
        notices.map((notice) => {
          const authorAvatar = getFullUrl(notice.avatarUrl);
          const noticeImage = getFullUrl(notice.imageUrl);
          const isAdmin = notice.role === 'admin';
          const isCR = notice.role === 'cr';
          const isTarget = Boolean(targetNoticeId && String(notice.id) === String(targetNoticeId));

          return (
            <Card
              key={notice.id}
              variant="elevated"
              padding="md"
              style={[
                styles.noticeCard,
                {
                  borderColor: isTarget ? colors.primary : colors.border,
                  borderWidth: isTarget ? 2 : 1,
                  backgroundColor: isTarget ? colors.surfaceRaised : colors.surface,
                  marginBottom: spacing.sm,
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
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.primary,
                    alignSelf: 'flex-start',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    marginBottom: 10,
                  }}
                >
                  <Ionicons name="bookmark" size={12} color="#ffffff" style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="700" style={{ color: '#ffffff', fontSize: 11 }}>
                    Selected Notice
                  </Text>
                </View>
              )}

              {/* Header row: Author & Badge */}
              <View style={styles.noticeHeader}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/user/[id]', params: { id: notice.studentId } })}
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                >
                  <View
                    style={[
                      styles.avatarBox,
                      { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    {authorAvatar ? (
                      <Image source={{ uri: authorAvatar }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text variant="xs" weight="700" color="primary">
                        {(notice.name || 'U').charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text variant="sm" weight="700" numberOfLines={1}>
                      {notice.name}
                    </Text>
                    <Caption color="muted">{formatTimeAgo(notice.createdAt)}</Caption>
                  </View>
                </TouchableOpacity>

                <View
                  style={[
                    styles.roleBadge,
                    {
                      backgroundColor: isAdmin ? colors.primaryLight : colors.surfaceRaised,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={isAdmin ? 'shield-checkmark' : isCR ? 'ribbon' : 'megaphone'}
                    size={11}
                    color={isAdmin ? colors.primary : colors.textSecondary}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    variant="xs"
                    weight="700"
                    style={{ color: isAdmin ? colors.primary : colors.textSecondary, fontSize: 11 }}
                  >
                    {isAdmin ? 'Administration' : isCR ? 'Class Representative' : 'Notice'}
                  </Text>
                </View>
              </View>

              {/* Content body */}
              <Text
                variant="sm"
                color="primary"
                style={{ marginTop: spacing.sm, lineHeight: 21, fontSize: 14.5 }}
              >
                {notice.content}
              </Text>

              {/* Attached Notice Image if any */}
              {noticeImage ? (
                <View style={[styles.imageWrap, { borderColor: colors.border, borderRadius: radii.md }]}>
                  <Image source={{ uri: noticeImage }} style={styles.noticeImg} contentFit="cover" />
                </View>
              ) : null}
            </Card>
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
    borderRadius: 14,
    borderWidth: 1,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  imageWrap: {
    marginTop: 10,
    height: 200,
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  noticeImg: {
    width: '100%',
    height: '100%',
  },
});
