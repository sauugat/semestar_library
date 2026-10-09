import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { queryClient } from '@/services/query-client';
import { getPostById, Post } from '@/services/posts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate } from '@/utils/date';

export default function NoticeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { user, serverUrl } = useAuth();

  const cachedInitialNotice = React.useMemo(() => {
    if (!noticeId || isNaN(noticeId)) return null;
    const feed = queryClient.getQueryData<{ posts: Post[] }>(['campus-feed', user?.studentId]);
    return feed?.posts?.find((p) => Number(p.id) === noticeId) || null;
  }, [noticeId, user?.studentId]);

  const [notice, setNotice] = useState<Post | null>(cachedInitialNotice);
  const [loading, setLoading] = useState(!cachedInitialNotice);
  const [refreshing, setRefreshing] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);

  const getFullUrl = useCallback(
    (path?: string | null) => {
      if (!path) return null;
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const base = (serverUrl || '').replace(/\/+$/, '');
      const clean = path.replace(/^\/+/, '');
      return `${base}/${clean}`;
    },
    [serverUrl]
  );

  const formatFullDate = (dateVal?: unknown) => {
    return formatDate(dateVal, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const loadNotice = useCallback(async () => {
    if (!noticeId || isNaN(noticeId)) return;
    try {
      const data = await getPostById(noticeId);
      if (data) {
        setNotice(data);
      }
    } catch (err) {
      console.warn('Could not load notice:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [noticeId]);

  useEffect(() => {
    loadNotice();
  }, [loadNotice]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotice();
  };

  const handleShare = async () => {
    if (!notice) return;
    try {
      await Share.share({
        title: `Official Notice: ${notice.name}`,
        message: `[Official Notice from ${notice.name}]\n\n${notice.content}\n\n— Semester Library`,
      });
    } catch {}
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/notices');
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="sm" color="muted" style={{ marginTop: 12 }}>
          Loading official notice…
        </Text>
      </View>
    );
  }

  if (!notice) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="megaphone-outline" size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
        <Heading style={{ fontSize: 18, marginBottom: 6 }}>Notice Not Found</Heading>
        <Caption color="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
          This notice may have expired or is no longer available.
        </Caption>
        <Button title="Back to Notices" variant="primary" onPress={handleBack} />
      </View>
    );
  }

  const authorAvatar = getFullUrl(notice.avatarUrl);
  const noticeImage = getFullUrl(notice.attachment_url);
  const isAdmin = notice.role === 'admin';
  const isCR = notice.role === 'cr';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: spacing.md,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom + 20, 32),
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Notice Card */}
        <Card variant="elevated" padding="lg" style={styles.noticeCard}>
          {/* Header Row: Publisher */}
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Avatar
                url={authorAvatar}
                name={notice.name}
                size="md"
              />

              <View style={{ marginLeft: spacing.compact, flex: 1 }}>
                <Text variant="md" weight="700" numberOfLines={1}>
                  {notice.name}
                </Text>
                <Caption color="muted">{formatFullDate(notice.created_at || (notice as any).createdAt || (notice as any).timestamp)}</Caption>
              </View>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Notice Title (Bold & Big) */}
          {Boolean(notice.title && notice.title.trim()) && (
            <Text
              style={{
                fontSize: 22,
                fontWeight: '800',
                color: colors.text,
                lineHeight: 28,
                letterSpacing: -0.3,
                marginBottom: spacing.xs,
              }}
              selectable
            >
              {notice.title}
            </Text>
          )}

          {/* Full Notice Content */}
          <Text
            variant="md"
            style={[
              styles.noticeBody,
              {
                color: colors.text,
                marginTop: notice.title && notice.title.trim() ? spacing.xs : spacing.sm,
                marginBottom: spacing.lg,
              },
            ]}
            selectable
          >
            {notice.content}
          </Text>

          {/* Attached Image / Circular Document Preview */}
          {noticeImage ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text variant="xs" weight="700" color="secondary" style={{ marginBottom: 8 }}>
                ATTACHED CIRCULAR / SCAN
              </Text>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setShowImageModal(true)}
                style={[styles.imageWrap, { borderColor: colors.border, borderRadius: radii.md }]}
              >
                <Image source={{ uri: noticeImage }} style={styles.noticeImg} contentFit="contain" />
                <View style={styles.expandOverlay}>
                  <Ionicons name="expand" size={14} color="#ffffff" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '600' }}>Tap for full view</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Actions Bar */}
          <View style={[styles.actionsBar, { borderTopColor: colors.border }]}>
            <Button
              title="Share Notice"
              variant="secondary"
              size="md"
              leftIcon={<Ionicons name="share-outline" size={17} color={colors.text} />}
              onPress={handleShare}
              style={{ flex: 1, marginRight: 8 }}
            />
            <Button
              title="All Notices"
              variant="outline"
              size="md"
              onPress={handleBack}
              style={{ flex: 1, marginLeft: 8 }}
            />
          </View>
        </Card>
      </ScrollView>

      {/* Full-Screen Image Modal */}
      {noticeImage && (
        <Modal
          visible={showImageModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageModal(false)}
        >
          <View style={styles.modalBg}>
            <TouchableOpacity onPress={() => setShowImageModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={28} color="#ffffff" />
            </TouchableOpacity>
            <Image source={{ uri: noticeImage }} style={styles.modalImg} contentFit="contain" />
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  noticeCard: {
    borderRadius: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  noticeBody: {
    fontSize: 16,
    lineHeight: 25,
  },
  imageWrap: {
    height: 280,
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  noticeImg: {
    width: '100%',
    height: '100%',
  },
  expandOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 16,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  modalImg: {
    width: '95%',
    height: '85%',
  },
});
