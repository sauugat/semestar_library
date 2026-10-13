import React from 'react';
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

interface AdminCohortsModalProps {
  visible: boolean;
  onClose: () => void;
}

interface CohortItem {
  id: string;
  slot_code: string;
  display_name: string;
  status: string;
  current_semester?: number | string;
  student_count?: number;
  created_at?: string;
}

export function AdminCohortsModal({ visible, onClose }: AdminCohortsModalProps) {
  const { colors, radii, spacing } = useTheme();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['admin-cohorts'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/cohorts');
      if (!res.ok) {
        if (res.status === 404) {
          return { cohorts: [], message: 'Cohort management endpoint is not available on this server.' };
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: visible,
  });

  const cohorts: CohortItem[] = data?.cohorts || [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Heading level={3}>Cohort Overview</Heading>
            <Caption style={{ color: colors.textSecondary }}>Permanent academic cohorts and student allocations</Caption>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.surfaceSubtle }]} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : isError ? (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.text, marginTop: 10, textAlign: 'center' }}>
              {(error as any)?.message || 'Failed to load cohorts'}
            </Text>
          </View>
        ) : cohorts.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No cohorts found</Text>
          </View>
        ) : (
          <FlatList
            data={cohorts}
            keyExtractor={(item) => item.id || item.slot_code}
            contentContainerStyle={{ padding: spacing.md }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.cohortCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.cardTop}>
                  <View>
                    <Text style={[styles.cohortName, { color: colors.text }]}>{item.display_name}</Text>
                    <Caption style={{ color: colors.textSecondary }}>Slot: {item.slot_code?.toUpperCase() ?? 'N/A'}</Caption>
                  </View>
                  <Badge
                    label={item.status === 'active' ? 'Active' : item.status || 'Active'}
                    variant={item.status === 'active' ? 'neutral' : 'outline'}
                    size="sm"
                  />
                </View>

                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Caption style={{ color: colors.textTertiary }}>Enrolled Students</Caption>
                    <Text style={[styles.statValue, { color: colors.text }]}>{item.student_count ?? '-'}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Caption style={{ color: colors.textTertiary }}>Current Semester</Caption>
                    <Text style={[styles.statValue, { color: colors.text }]}>
                      {item.current_semester ? `Semester ${item.current_semester}` : '-'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  cohortCard: {
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cohortName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },
  statItem: {
    flex: 1,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
});
