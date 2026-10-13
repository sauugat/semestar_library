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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/services/api';
import { formatTimeAgo } from '@/utils/date';
import { AdminActionConfirmModal } from './AdminActionConfirmModal';

type ContentSubTab = 'queue' | 'reports' | 'history';

interface QueueItem {
  id: number | string;
  content_type: 'post' | 'comment';
  content_id: number | string;
  reporter_id?: string;
  reporter_name?: string;
  reason?: string;
  description?: string;
  status: string;
  contentPreview?: string | null;
  contentAuthor?: { studentId: string; name: string; role: string; postId?: number } | null;
  contentModerationStatus?: 'active' | 'removed';
  created_at: string;
}

interface ReportItem {
  id: number | string;
  content_type: 'post' | 'comment';
  content_id: number | string;
  reporter_id: string;
  reporter_name?: string;
  reason: string;
  description?: string;
  status: string;
  created_at: string;
}

interface HistoryItem {
  id: number | string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name?: string;
  actor_user_id?: string;
  metadata?: any;
  created_at: string;
}

type ModerationAction =
  | { type: 'remove_post'; postId: number | string; title: string }
  | { type: 'restore_post'; postId: number | string; title: string }
  | { type: 'remove_comment'; commentId: number | string; title: string }
  | { type: 'restore_comment'; commentId: number | string; title: string }
  | { type: 'resolve_report'; reportId: number | string; title: string }
  | { type: 'dismiss_report'; reportId: number | string; title: string }
  | null;

export function AdminContentView() {
  const { colors, radii } = useTheme();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ContentSubTab>('queue');
  const [activeAction, setActiveAction] = useState<ModerationAction>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Moderation Overview Query
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

  // 2. Review Queue Query
  const queueQuery = useQuery({
    queryKey: ['admin-moderation-queue'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/queue?page=1&limit=25&status=all');
      if (!res.ok) {
        if (res.status === 404) return { reports: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'queue',
  });

  // 3. Reports Query
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

  // 4. History Query
  const historyQuery = useQuery({
    queryKey: ['admin-moderation-history'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/moderation/history?page=1&limit=25');
      if (!res.ok) {
        if (res.status === 404) return { logs: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'history',
  });

  const queueItems: QueueItem[] = queueQuery.data?.reports || [];
  const reportItems: ReportItem[] = reportsQuery.data?.reports || [];
  const historyItems: HistoryItem[] = historyQuery.data?.logs || [];

  // Execute Moderation Action Submit
  const handleExecuteModeration = async (reason: string) => {
    if (!activeAction || isSubmitting) return;

    setIsSubmitting(true);
    setActionError(null);

    try {
      let endpoint = '';
      let bodyPayload: any = { reason };

      if (activeAction.type === 'remove_post') {
        endpoint = `/api/admin/moderation/posts/${activeAction.postId}/remove`;
      } else if (activeAction.type === 'restore_post') {
        endpoint = `/api/admin/moderation/posts/${activeAction.postId}/restore`;
      } else if (activeAction.type === 'remove_comment') {
        endpoint = `/api/admin/moderation/comments/${activeAction.commentId}/remove`;
      } else if (activeAction.type === 'restore_comment') {
        endpoint = `/api/admin/moderation/comments/${activeAction.commentId}/restore`;
      } else if (activeAction.type === 'resolve_report') {
        endpoint = `/api/admin/moderation/reports/${activeAction.reportId}/resolve`;
        bodyPayload = { resolutionNotes: reason };
      } else if (activeAction.type === 'dismiss_report') {
        endpoint = `/api/admin/moderation/reports/${activeAction.reportId}/dismiss`;
        bodyPayload = { resolutionNotes: reason };
      }

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Moderation action failed (HTTP ${res.status})`);
      }

      // Targeted cache invalidation
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-moderation-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-moderation-reports'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-moderation-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-moderation-history'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
      ]);

      setActiveAction(null);
    } catch (err: any) {
      setActionError(err.message || 'Operation failed. Please check inputs and retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Heading level={2}>Content Moderation</Heading>
          <Caption style={{ color: colors.textSecondary }}>Safety, reporting & post review queue</Caption>
        </View>
        {overviewQuery.data && (
          <Badge
            label={`${overviewQuery.data.queueCount || 0} In Queue`}
            variant="neutral"
            size="sm"
          />
        )}
      </View>

      {/* Sub Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setActiveTab('queue')}
          style={[
            styles.tabButton,
            activeTab === 'queue' && { borderBottomWidth: 2, borderBottomColor: colors.text },
          ]}
        >
          <Text style={{ fontWeight: '600', color: activeTab === 'queue' ? colors.text : colors.textSecondary }}>
            Review Queue
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('reports')}
          style={[
            styles.tabButton,
            activeTab === 'reports' && { borderBottomWidth: 2, borderBottomColor: colors.text },
          ]}
        >
          <Text style={{ fontWeight: '600', color: activeTab === 'reports' ? colors.text : colors.textSecondary }}>
            Reports List
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('history')}
          style={[
            styles.tabButton,
            activeTab === 'history' && { borderBottomWidth: 2, borderBottomColor: colors.text },
          ]}
        >
          <Text style={{ fontWeight: '600', color: activeTab === 'history' ? colors.text : colors.textSecondary }}>
            Audit History
          </Text>
        </TouchableOpacity>
      </View>

      {/* Migration Pending / Unavailable Banner */}
      {overviewQuery.data?.unavailable && (
        <View style={[styles.banner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
            Content moderation schema pending staging migration on target server.
          </Text>
        </View>
      )}

      {/* TAB 1: REVIEW QUEUE */}
      {activeTab === 'queue' && (
        queueQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
            <Caption style={{ marginTop: 12, color: colors.textSecondary }}>Loading moderation queue...</Caption>
          </View>
        ) : queueItems.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.textSecondary} />
            <Heading level={3} style={{ marginTop: 12 }}>Queue Clear</Heading>
            <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
              No reported posts or comments currently require review.
            </Caption>
          </View>
        ) : (
          <FlatList
            data={queueItems}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            refreshControl={
              <RefreshControl refreshing={queueQuery.isRefetching} onRefresh={() => void queueQuery.refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => {
              const isPost = item.content_type === 'post';
              const isRemoved = item.contentModerationStatus === 'removed';

              return (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                  <View style={styles.cardTop}>
                    <Badge label={isPost ? 'POST' : 'COMMENT'} variant="neutral" size="sm" />
                    <Badge
                      label={isRemoved ? 'REMOVED' : 'ACTIVE'}
                      variant={isRemoved ? 'outline' : 'neutral'}
                      size="sm"
                    />
                    <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(item.created_at)}</Caption>
                  </View>

                  <Text style={[styles.contentPreview, { color: colors.text }]} numberOfLines={3}>
                    {item.contentPreview || `Target ${item.content_type} #${item.content_id}`}
                  </Text>

                  {item.reason && (
                    <View style={[styles.reasonCallout, { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm }]}>
                      <Caption style={{ color: colors.textSecondary, fontWeight: '600' }}>Flag Reason:</Caption>
                      <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>{item.reason}</Text>
                    </View>
                  )}

                  <View style={styles.cardBottom}>
                    <Caption style={{ color: colors.textSecondary }}>
                      Author: {item.contentAuthor?.name || 'Unknown'} ({item.contentAuthor?.role || 'user'})
                    </Caption>
                    <Caption style={{ color: colors.textTertiary }}>
                      Reporter: {item.reporter_name || item.reporter_id || 'Anonymous'}
                    </Caption>
                  </View>

                  {/* Moderation Action Buttons */}
                  <View style={styles.actionRow}>
                    {isRemoved ? (
                      <TouchableOpacity
                        style={[styles.modBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                        onPress={() => {
                          setActiveAction(
                            isPost
                              ? { type: 'restore_post', postId: item.content_id, title: `Restore Post #${item.content_id}` }
                              : { type: 'restore_comment', commentId: item.content_id, title: `Restore Comment #${item.content_id}` }
                          );
                        }}
                      >
                        <Ionicons name="refresh-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                          Restore {isPost ? 'Post' : 'Comment'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.modBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                        onPress={() => {
                          setActiveAction(
                            isPost
                              ? { type: 'remove_post', postId: item.content_id, title: `Remove Post #${item.content_id}` }
                              : { type: 'remove_comment', commentId: item.content_id, title: `Remove Comment #${item.content_id}` }
                          );
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                          Remove {isPost ? 'Post' : 'Comment'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {item.status === 'open' && (
                      <TouchableOpacity
                        style={[styles.modBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                        onPress={() => {
                          setActiveAction({
                            type: 'resolve_report',
                            reportId: item.id,
                            title: `Resolve Report #${item.id}`,
                          });
                        }}
                      >
                        <Ionicons name="checkmark-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>Resolve Report</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )
      )}

      {/* TAB 2: REPORTS LIST */}
      {activeTab === 'reports' && (
        reportsQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : reportItems.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="document-text-outline" size={44} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No user-submitted reports</Text>
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
                  <Badge label={`${item.content_type.toUpperCase()} #${item.content_id}`} variant="neutral" size="sm" />
                  <Badge label={item.status.toUpperCase()} variant={item.status === 'open' ? 'neutral' : 'outline'} size="sm" />
                  <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(item.created_at)}</Caption>
                </View>

                <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>
                  Reason: {item.reason}
                </Text>
                {item.description && (
                  <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
                    Notes: {item.description}
                  </Caption>
                )}

                <View style={styles.cardBottom}>
                  <Caption style={{ color: colors.textSecondary }}>Reporter: {item.reporter_name || item.reporter_id}</Caption>
                </View>

                {item.status === 'open' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.modBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                      onPress={() => {
                        setActiveAction({
                          type: 'resolve_report',
                          reportId: item.id,
                          title: `Resolve Report #${item.id}`,
                        });
                      }}
                    >
                      <Ionicons name="checkmark-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>Resolve</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                      onPress={() => {
                        setActiveAction({
                          type: 'dismiss_report',
                          reportId: item.id,
                          title: `Dismiss Report #${item.id}`,
                        });
                      }}
                    >
                      <Ionicons name="close-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          />
        )
      )}

      {/* TAB 3: AUDIT HISTORY */}
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
                {item.metadata?.reason && (
                  <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
                    Reason: {item.metadata.reason}
                  </Caption>
                )}
                <View style={styles.cardBottom}>
                  <Caption style={{ color: colors.textSecondary }}>Moderator: {item.actor_name || item.actor_user_id || 'System Admin'}</Caption>
                </View>
              </View>
            )}
          />
        )
      )}

      {/* Reusable Action Confirmation Modal */}
      {activeAction && (
        <AdminActionConfirmModal
          visible={Boolean(activeAction)}
          title={activeAction.title}
          subtitle="This moderation action will be recorded in administrative audit logs."
          targetName={activeAction.title}
          actionType={activeAction.type.startsWith('remove') ? 'destructive' : 'neutral'}
          confirmLabel={
            activeAction.type.startsWith('remove')
              ? 'Confirm Removal'
              : activeAction.type.startsWith('restore')
              ? 'Confirm Restore'
              : activeAction.type === 'resolve_report'
              ? 'Resolve Report'
              : 'Dismiss Report'
          }
          requireReason={activeAction.type.startsWith('remove')}
          reasonPlaceholder="Mandatory reason for audit log (minimum 3 characters)..."
          isSubmitting={isSubmitting}
          error={actionError}
          onConfirm={handleExecuteModeration}
          onClose={() => {
            if (!isSubmitting) {
              setActiveAction(null);
              setActionError(null);
            }
          }}
        />
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
  reasonCallout: {
    padding: 8,
    marginVertical: 6,
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
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  modBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
});
