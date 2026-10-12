import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/services/api';
import { formatTimeAgo } from '@/utils/date';

type ContentSubTab = 'queue' | 'reports' | 'history';

interface QueueItem {
  id: number | string;
  type: 'post' | 'comment';
  content?: string;
  author_id?: string;
  author_name?: string;
  status: string;
  reports_count?: number;
  created_at: string;
}

interface ReportItem {
  id: number | string;
  content_type: 'post' | 'comment';
  content_id: number | string;
  reporter_id: string;
  reporter_name?: string;
  reason: string;
  status: string;
  created_at: string;
}

interface HistoryItem {
  id: number | string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name?: string;
  metadata?: any;
  created_at: string;
}

export function AdminContentView() {
  const { colors, radii, spacing } = useTheme();
  const [activeTab, setActiveTab] = useState<ContentSubTab>('queue');

  // Moderation Overview Query
  const overviewQuery = useQuery({
    queryKey: ['admin-moderation-overview'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/overview');
      if (!res.ok) {
        if (res.status === 404) return { queueCount: 0, reportsCount: 0, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  // Review Queue Query
  const queueQuery = useQuery({
    queryKey: ['admin-moderation-queue'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/queue?page=1&limit=25');
      if (!res.ok) {
        if (res.status === 404) return { queue: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'queue',
  });

  // Reports Query
  const reportsQuery = useQuery({
    queryKey: ['admin-moderation-reports'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/reports?page=1&limit=25');
      if (!res.ok) {
        if (res.status === 404) return { reports: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'reports',
  });

  // History Query
  const historyQuery = useQuery({
    queryKey: ['admin-moderation-history'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/history?page=1&limit=25');
      if (!res.ok) {
        if (res.status === 404) return { history: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'history',
  });

  const queueItems: QueueItem[] = queueQuery.data?.queue || [];
  const reportItems: ReportItem[] = reportsQuery.data?.reports || [];
  const historyItems: HistoryItem[] = historyQuery.data?.history || [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Heading level={2}>Content Moderation</Heading>
          <Caption style={{ color: colors.textSecondary }}>Community safety & reporting overview</Caption>
        </View>
        <Badge label="Read-Only" variant="neutral" size="sm" />
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setActiveTab('queue')}
          style={[styles.tabButton, activeTab === 'queue' && { borderBottomColor: colors.text, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: activeTab === 'queue' ? colors.text : colors.textSecondary, fontWeight: activeTab === 'queue' ? '700' : '400' }}>
            Review Queue
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('reports')}
          style={[styles.tabButton, activeTab === 'reports' && { borderBottomColor: colors.text, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: activeTab === 'reports' ? colors.text : colors.textSecondary, fontWeight: activeTab === 'reports' ? '700' : '400' }}>
            User Reports
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('history')}
          style={[styles.tabButton, activeTab === 'history' && { borderBottomColor: colors.text, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: activeTab === 'history' ? colors.text : colors.textSecondary, fontWeight: activeTab === 'history' ? '700' : '400' }}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* Phase 4C.1 Read-Only Notice */}
      <View style={[styles.banner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md }]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
        <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
          Read-only moderation overview for Phase 4C.1. Moderation actions (Remove, Restore, Resolve, Dismiss) are disabled in this view.
        </Text>
      </View>

      {/* Lists */}
      {activeTab === 'queue' && (
        queueQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : queueItems.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>Moderation queue is clean</Text>
          </View>
        ) : (
          <FlatList
            data={queueItems}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            refreshControl={
              <RefreshControl refreshing={queueQuery.isRefetching} onRefresh={() => void queueQuery.refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.cardTop}>
                  <Badge label={item.type.toUpperCase()} variant="neutral" size="sm" />
                  <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(item.created_at)}</Caption>
                </View>
                <Text style={[styles.contentPreview, { color: colors.text }]} numberOfLines={3}>
                  {item.content || '[Content text withheld or media attachment]'}
                </Text>
                <View style={styles.cardBottom}>
                  <Caption style={{ color: colors.textSecondary }}>Author: {item.author_name || item.author_id || 'Unknown'}</Caption>
                  {item.reports_count !== undefined && item.reports_count > 0 && (
                    <Badge label={`${item.reports_count} Reports`} variant="outline" size="sm" />
                  )}
                </View>
              </View>
            )}
          />
        )
      )}

      {activeTab === 'reports' && (
        reportsQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : reportItems.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="shield-outline" size={44} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No user reports submitted</Text>
          </View>
        ) : (
          <FlatList
            data={reportItems}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            refreshControl={
              <RefreshControl refreshing={reportsQuery.isRefetching} onRefresh={() => void reportsQuery.refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.cardTop}>
                  <Badge label={`Report on ${item.content_type}`} variant="neutral" size="sm" />
                  <Badge label={item.status} variant="outline" size="sm" />
                </View>
                <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>Reason: {item.reason}</Text>
                <View style={styles.cardBottom}>
                  <Caption style={{ color: colors.textSecondary }}>
                    Reporter: {item.reporter_name || item.reporter_id} • {formatTimeAgo(item.created_at)}
                  </Caption>
                </View>
              </View>
            )}
          />
        )
      )}

      {activeTab === 'history' && (
        historyQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : historyItems.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="time-outline" size={44} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No moderation history records</Text>
          </View>
        ) : (
          <FlatList
            data={historyItems}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            refreshControl={
              <RefreshControl refreshing={historyQuery.isRefetching} onRefresh={() => void historyQuery.refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.cardTop}>
                  <Badge label={item.action.replace(/_/g, ' ')} variant="neutral" size="sm" />
                  <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(item.created_at)}</Caption>
                </View>
                <Text style={{ color: colors.text, marginTop: 4 }}>
                  Action applied to {item.entity_type} #{item.entity_id}
                </Text>
                <View style={styles.cardBottom}>
                  <Caption style={{ color: colors.textSecondary }}>Moderator: {item.actor_name || 'System Admin'}</Caption>
                </View>
              </View>
            )}
          />
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    marginBottom: 8,
    padding: 12,
    borderWidth: 1,
  },
  centerBox: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  contentPreview: {
    fontSize: 14,
    lineHeight: 20,
    marginVertical: 4,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
    marginTop: 6,
  },
});
