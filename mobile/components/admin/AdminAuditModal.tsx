import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/services/api';
import { formatTimeAgo } from '@/utils/date';

interface AdminAuditModalProps {
  visible: boolean;
  onClose: () => void;
}

interface AuditLogItem {
  id: string | number;
  actor_user_id: string;
  actor_name?: string;
  actor_role?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  description?: string;
  metadata?: any;
  created_at: string;
}

export function AdminAuditModal({ visible, onClose }: AdminAuditModalProps) {
  const { colors, radii, spacing } = useTheme();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['admin-audit-logs', page],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/audit-logs?page=${page}&limit=25`);
      if (!res.ok) {
        if (res.status === 404) {
          return { logs: [], auditTableAvailable: false, message: 'Administrative audit logging endpoint is not available on this server.' };
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: visible,
  });

  const logs: AuditLogItem[] = data?.logs || [];
  const pagination = data?.pagination;
  const auditTableAvailable = data?.auditTableAvailable !== false;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Heading level={3}>Administrative Activity</Heading>
            <Caption style={{ color: colors.textSecondary }}>Durable audit log of administrative operations</Caption>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.surfaceSubtle }]} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {!auditTableAvailable && (
          <View style={[styles.noticeBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
              {data?.message || 'Durable administrative audit logging table has not yet been migrated to this environment.'}
            </Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : isError ? (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.text, marginTop: 10, textAlign: 'center' }}>
              {(error as any)?.message || 'Failed to load administrative logs'}
            </Text>
          </View>
        ) : logs.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons name="document-text-outline" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No activity records found</Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: spacing.md }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.logCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.logHeader}>
                  <Badge label={item.action.replace(/_/g, ' ')} variant="neutral" size="sm" />
                  <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(item.created_at)}</Caption>
                </View>
                <Text style={[styles.logDescription, { color: colors.text }]}>
                  {item.description || `${item.action} on ${item.entity_type} ${item.entity_id || ''}`}
                </Text>
                <View style={styles.logFooter}>
                  <Caption style={{ color: colors.textSecondary }}>
                    Actor: {item.actor_name || item.actor_user_id} ({item.actor_role || 'admin'})
                  </Caption>
                </View>
              </View>
            )}
            ListFooterComponent={
              pagination && pagination.totalPages > 1 ? (
                <View style={styles.paginationRow}>
                  <TouchableOpacity
                    disabled={page <= 1}
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                    style={[styles.pageBtn, { borderColor: colors.border, opacity: page <= 1 ? 0.4 : 1 }]}
                  >
                    <Caption style={{ color: colors.text }}>Previous</Caption>
                  </TouchableOpacity>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    Page {page} of {pagination.totalPages}
                  </Text>
                  <TouchableOpacity
                    disabled={page >= pagination.totalPages}
                    onPress={() => setPage((p) => p + 1)}
                    style={[styles.pageBtn, { borderColor: colors.border, opacity: page >= pagination.totalPages ? 0.4 : 1 }]}
                  >
                    <Caption style={{ color: colors.text }}>Next</Caption>
                  </TouchableOpacity>
                </View>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </Modal>
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
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  logDescription: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 8,
  },
  logFooter: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 6,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  pageBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
});
