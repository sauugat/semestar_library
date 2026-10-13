import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { apiFetch } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { formatTimeAgo, formatDate } from '@/utils/date';
import { AdminActionConfirmModal } from './AdminActionConfirmModal';

interface AdminUserItem {
  studentId: string;
  name: string;
  email: string | null;
  username: string | null;
  department: string | null;
  semester: string | null;
  role: string;
  account_status?: 'active' | 'suspended';
  verification_status?: string;
  cohort_slot?: string;
  cohort_name?: string;
  created_at?: string;
  assignedSubjects?: Array<{ id: string; code: string; name: string }>;
}

type UserActionType = 'suspend' | 'reactivate' | 'promote_cr' | 'demote_cr' | null;

export function AdminUsersView() {
  const { colors, radii } = useTheme();
  const { user: currentAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher' | 'cr' | 'admin'>('all');
  const [semesterFilter, setSemesterFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null);

  // Mutation Modal States
  const [activeAction, setActiveAction] = useState<UserActionType>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // History Modal States
  const [historyModalType, setHistoryModalType] = useState<'suspension' | 'role' | null>(null);

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: '20',
  });
  if (activeSearch) queryParams.append('search', activeSearch);
  if (roleFilter !== 'all') queryParams.append('role', roleFilter);
  if (semesterFilter !== 'all') queryParams.append('semester', semesterFilter);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['admin-users', page, activeSearch, roleFilter, semesterFilter],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/users?${queryParams.toString()}`);
      if (!res.ok) {
        if (res.status === 404) {
          return { users: [], pagination: { total: 0, totalPages: 1 }, unavailable: true };
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  // Query Suspension History for selected user
  const suspensionHistoryQuery = useQuery({
    queryKey: ['admin-user-suspension-history', selectedUser?.studentId],
    queryFn: async () => {
      if (!selectedUser?.studentId) return { history: [] };
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/suspension-history`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: historyModalType === 'suspension' && Boolean(selectedUser?.studentId),
  });

  // Query Role Transition History for selected user
  const roleHistoryQuery = useQuery({
    queryKey: ['admin-user-role-history', selectedUser?.studentId],
    queryFn: async () => {
      if (!selectedUser?.studentId) return { history: [] };
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/role-history`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: historyModalType === 'role' && Boolean(selectedUser?.studentId),
  });

  const users: AdminUserItem[] = data?.users || [];
  const pagination = data?.pagination;

  const handleSearchSubmit = () => {
    setPage(1);
    setActiveSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
    setPage(1);
  };

  // Execute User Mutation Action
  const handleExecuteAction = async (reason: string) => {
    if (!selectedUser || !activeAction || isSubmittingAction) return;

    setIsSubmittingAction(true);
    setActionError(null);

    try {
      let endpoint = '';
      let method = 'POST';
      let payload: any = { reason };

      if (activeAction === 'suspend') {
        endpoint = `/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/suspend`;
      } else if (activeAction === 'reactivate') {
        endpoint = `/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/reactivate`;
      } else if (activeAction === 'promote_cr') {
        endpoint = `/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/promote-cr`;
      } else if (activeAction === 'demote_cr') {
        endpoint = `/api/admin/users/${encodeURIComponent(selectedUser.studentId)}/demote-student`;
      }

      const res = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Action failed (HTTP ${res.status})`);
      }

      // Targeted Cache Invalidation
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-user-suspension-history', selectedUser.studentId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-user-role-history', selectedUser.studentId] }),
      ]);

      // Update local state for selected user
      if (activeAction === 'suspend') {
        setSelectedUser((prev) => (prev ? { ...prev, account_status: 'suspended' } : null));
      } else if (activeAction === 'reactivate') {
        setSelectedUser((prev) => (prev ? { ...prev, account_status: 'active' } : null));
      } else if (activeAction === 'promote_cr') {
        setSelectedUser((prev) => (prev ? { ...prev, role: 'cr' } : null));
      } else if (activeAction === 'demote_cr') {
        setSelectedUser((prev) => (prev ? { ...prev, role: 'student' } : null));
      }

      setActiveAction(null);
    } catch (err: any) {
      setActionError(err.message || 'Operation failed. Please try again.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const isSelf = selectedUser?.studentId === currentAdmin?.studentId;
  const isTargetAdmin = selectedUser?.role === 'admin';
  const isSuspended = selectedUser?.account_status === 'suspended';
  const isCR = selectedUser?.role === 'cr' || selectedUser?.role === 'class_rep';
  const isStudent = selectedUser?.role === 'student';
  const canPromoteToCR = isStudent && !isSuspended && !isTargetAdmin;
  const canDemoteToStudent = isCR && !isSuspended;
  const canSuspend = !isSelf && !isTargetAdmin && !isSuspended;
  const canReactivate = isSuspended;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Heading level={2}>Users Directory</Heading>
          <Caption style={{ color: colors.textSecondary }}>Administrative student & faculty registry</Caption>
        </View>
        {pagination && pagination.total !== undefined && (
          <Badge label={`${pagination.total} Users`} variant="neutral" size="sm" />
        )}
      </View>

      {/* Search Input */}
      <View style={styles.searchBarWrap}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={handleSearchSubmit}
            placeholder="Search by name, ID, username, email..."
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.text }]}
          />
          {searchInput.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Role Filters Row */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['all', 'student', 'cr', 'teacher', 'admin'] as const).map((r) => {
            const isSelected = roleFilter === r;
            const labels: Record<string, string> = {
              all: 'All Roles',
              student: 'Students',
              cr: 'CRs',
              teacher: 'Teachers',
              admin: 'Admins',
            };
            return (
              <TouchableOpacity
                key={r}
                onPress={() => {
                  setRoleFilter(r);
                  setPage(1);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isSelected ? colors.text : colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? colors.background : colors.text }}>
                  {labels[r]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Semester Filter Row */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollSub}>
          <TouchableOpacity
            onPress={() => {
              setSemesterFilter('all');
              setPage(1);
            }}
            style={[
              styles.filterChipSm,
              {
                backgroundColor: semesterFilter === 'all' ? colors.text : colors.background,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: semesterFilter === 'all' ? colors.background : colors.textSecondary }}>
              All Semesters
            </Text>
          </TouchableOpacity>
          {['1', '2', '3', '4', '5', '6', '7', '8'].map((sem) => {
            const isSelected = semesterFilter === sem;
            return (
              <TouchableOpacity
                key={sem}
                onPress={() => {
                  setSemesterFilter(sem);
                  setPage(1);
                }}
                style={[
                  styles.filterChipSm,
                  {
                    backgroundColor: isSelected ? colors.text : colors.background,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: isSelected ? colors.background : colors.textSecondary }}>
                  Sem {sem}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Users List */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <Caption style={{ marginTop: 12, color: colors.textSecondary }}>Loading users directory...</Caption>
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textSecondary} />
          <Heading level={3} style={{ marginTop: 12 }}>Unable to Load Directory</Heading>
          <Caption style={{ textAlign: 'center', marginTop: 4, color: colors.textSecondary }}>
            {(error as any)?.message || 'Failed to retrieve users list.'}
          </Caption>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => void refetch()}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : users.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
          <Heading level={3} style={{ marginTop: 12 }}>No Users Found</Heading>
          <Caption style={{ textAlign: 'center', marginTop: 4, color: colors.textSecondary }}>
            No accounts match your selected filter criteria.
          </Caption>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.studentId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.userCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
              onPress={() => setSelectedUser(item)}
              activeOpacity={0.7}
            >
              <Avatar name={item.name} size="md" />
              <View style={styles.userCardInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {item.account_status === 'suspended' ? (
                      <Badge label="Suspended" variant="outline" size="sm" />
                    ) : item.role === 'admin' ? (
                      <Badge label="Admin" variant="neutral" size="sm" />
                    ) : item.role === 'teacher' ? (
                      <Badge label="Teacher" variant="neutral" size="sm" />
                    ) : item.role === 'cr' ? (
                      <Badge label="CR" variant="neutral" size="sm" />
                    ) : (
                      <Badge label="Student" variant="neutral" size="sm" />
                    )}
                  </View>
                </View>
                <Caption style={[styles.userCardSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.studentId} • {item.email || item.username || 'No email'}
                </Caption>
                {item.semester && item.role !== 'teacher' && (
                  <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>
                    {item.semester.startsWith('Semester') ? item.semester : `Semester ${item.semester}`}
                    {item.cohort_name ? ` • ${item.cohort_name}` : ''}
                  </Caption>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          ListFooterComponent={() => {
            if (!pagination || pagination.totalPages <= 1) return null;
            return (
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  style={[
                    styles.pageBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: page <= 1 ? 0.4 : 1,
                    },
                  ]}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <Ionicons name="chevron-back" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                  Page {page} of {pagination.totalPages}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.pageBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: page >= pagination.totalPages ? 0.4 : 1,
                    },
                  ]}
                  onPress={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                >
                  <Ionicons name="chevron-forward" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* Account Detail & Action Modal */}
      <Modal
        visible={Boolean(selectedUser)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedUser(null)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Heading level={3}>Account Management</Heading>
            <TouchableOpacity
              onPress={() => setSelectedUser(null)}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedUser && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
              {/* Profile Top */}
              <View style={styles.modalProfileTop}>
                <Avatar name={selectedUser.name} size="xl" />
                <Heading level={2} style={{ marginTop: 12 }}>{selectedUser.name}</Heading>
                <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>{selectedUser.studentId}</Caption>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                  <Badge label={selectedUser.role.toUpperCase()} variant="neutral" size="sm" />
                  <Badge
                    label={selectedUser.account_status === 'suspended' ? 'SUSPENDED' : 'ACTIVE'}
                    variant={selectedUser.account_status === 'suspended' ? 'outline' : 'neutral'}
                    size="sm"
                  />
                  {selectedUser.verification_status && (
                    <Badge label={selectedUser.verification_status.toUpperCase()} variant="neutral" size="sm" />
                  )}
                </View>
              </View>

              {/* Administrative Actions Section */}
              <View style={[styles.actionsCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                  Administrative Operations
                </Caption>

                {/* Self-Suspension or Admin Protection Notice */}
                {isSelf ? (
                  <View style={[styles.noticeRow, { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm }]}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
                    <Caption style={{ color: colors.textSecondary, flex: 1 }}>
                      Self-suspension is strictly prohibited. You cannot modify your own administrative status.
                    </Caption>
                  </View>
                ) : isTargetAdmin ? (
                  <View style={[styles.noticeRow, { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm }]}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
                    <Caption style={{ color: colors.textSecondary, flex: 1 }}>
                      Administrator accounts are protected and cannot be suspended or demoted via user controls.
                    </Caption>
                  </View>
                ) : null}

                {/* Action Buttons */}
                <View style={{ gap: 10 }}>
                  {/* Suspension Controls */}
                  {canSuspend && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => setActiveAction('suspend')}
                    >
                      <Ionicons name="pause-circle-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Suspend Account</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}

                  {canReactivate && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => setActiveAction('reactivate')}
                    >
                      <Ionicons name="play-circle-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Reactivate Account</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}

                  {/* CR Role Management Controls */}
                  {canPromoteToCR && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => setActiveAction('promote_cr')}
                    >
                      <Ionicons name="arrow-up-circle-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Promote to Class Representative (CR)</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}

                  {canDemoteToStudent && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => setActiveAction('demote_cr')}
                    >
                      <Ionicons name="arrow-down-circle-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Demote CR to Regular Student</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Audit History Links */}
                <View style={styles.historyLinksRow}>
                  <TouchableOpacity
                    style={[styles.historyBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                    onPress={() => setHistoryModalType('suspension')}
                  >
                    <Ionicons name="time-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
                    <Caption style={{ color: colors.text, fontWeight: '600' }}>Suspension History</Caption>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.historyBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
                    onPress={() => setHistoryModalType('role')}
                  >
                    <Ionicons name="swap-horizontal-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
                    <Caption style={{ color: colors.text, fontWeight: '600' }}>Role History</Caption>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Account Details Breakdown */}
              <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, marginTop: 16 }]}>
                <Caption style={{ color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Academic Information
                </Caption>

                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Username</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.username || '—'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Email Address</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.email || '—'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Department</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.department || 'BIT'}</Text>
                </View>

                {selectedUser.semester && selectedUser.role !== 'teacher' && (
                  <View style={styles.detailRow}>
                    <Caption style={{ color: colors.textSecondary }}>Semester</Caption>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.semester}</Text>
                  </View>
                )}

                {selectedUser.cohort_name && (
                  <View style={styles.detailRow}>
                    <Caption style={{ color: colors.textSecondary }}>Permanent Cohort</Caption>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.cohort_name}</Text>
                  </View>
                )}

                {selectedUser.created_at && (
                  <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                    <Caption style={{ color: colors.textSecondary }}>Account Created</Caption>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{formatDate(selectedUser.created_at)}</Text>
                  </View>
                )}
              </View>

              {/* Assigned Subjects (for teachers) */}
              {selectedUser.assignedSubjects && selectedUser.assignedSubjects.length > 0 && (
                <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, marginTop: 16 }]}>
                  <Heading level={4} style={{ marginBottom: 8 }}>Assigned Subjects ({selectedUser.assignedSubjects.length})</Heading>
                  {selectedUser.assignedSubjects.map((sub) => (
                    <View key={sub.id || sub.code} style={{ paddingVertical: 6 }}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {sub.code} — {sub.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Reusable Action Confirmation Modal */}
      {selectedUser && (
        <AdminActionConfirmModal
          visible={Boolean(activeAction)}
          title={
            activeAction === 'suspend'
              ? 'Suspend Account'
              : activeAction === 'reactivate'
              ? 'Reactivate Account'
              : activeAction === 'promote_cr'
              ? 'Promote to Class Representative'
              : 'Demote to Regular Student'
          }
          subtitle="This action will be transactionally recorded in administrative audit logs."
          targetName={selectedUser.name}
          targetSubtitle={`${selectedUser.studentId} • ${selectedUser.role.toUpperCase()}`}
          actionType={activeAction === 'suspend' || activeAction === 'demote_cr' ? 'destructive' : 'neutral'}
          confirmLabel={
            activeAction === 'suspend'
              ? 'Confirm Suspension'
              : activeAction === 'reactivate'
              ? 'Confirm Reactivation'
              : activeAction === 'promote_cr'
              ? 'Confirm Promotion'
              : 'Confirm Demotion'
          }
          requireReason={true}
          reasonPlaceholder="Enter mandatory administrative reason (minimum 3 characters)..."
          isSubmitting={isSubmittingAction}
          error={actionError}
          onConfirm={handleExecuteAction}
          onClose={() => {
            if (!isSubmittingAction) {
              setActiveAction(null);
              setActionError(null);
            }
          }}
        />
      )}

      {/* History Inspection Modal */}
      <Modal
        visible={Boolean(historyModalType)}
        transparent
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHistoryModalType(null)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <View>
              <Heading level={3}>
                {historyModalType === 'suspension' ? 'Suspension History' : 'Role Transition History'}
              </Heading>
              <Caption style={{ color: colors.textSecondary }}>
                Target: {selectedUser?.name} ({selectedUser?.studentId})
              </Caption>
            </View>
            <TouchableOpacity
              onPress={() => setHistoryModalType(null)}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {historyModalType === 'suspension' ? (
              suspensionHistoryQuery.isLoading ? (
                <ActivityIndicator size="small" color={colors.text} style={{ marginTop: 20 }} />
              ) : suspensionHistoryQuery.isError ? (
                <Text style={{ color: colors.textSecondary, marginTop: 20 }}>
                  Failed to load suspension history.
                </Text>
              ) : (suspensionHistoryQuery.data?.history || []).length === 0 ? (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Ionicons name="checkmark-circle-outline" size={40} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No suspension records on file.</Text>
                </View>
              ) : (
                (suspensionHistoryQuery.data?.history || []).map((h: any) => (
                  <View
                    key={h.id}
                    style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                  >
                    <View style={styles.historyCardTop}>
                      <Badge label={h.action.replace(/_/g, ' ')} variant="neutral" size="sm" />
                      <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(h.createdAt)}</Caption>
                    </View>
                    <Text style={{ color: colors.text, marginTop: 4, fontWeight: '600' }}>
                      Reason: {h.reason || 'No justification provided'}
                    </Text>
                    <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
                      Actor: {h.actorName || h.actorUserId} ({h.actorRole || 'admin'})
                    </Caption>
                  </View>
                ))
              )
            ) : (
              roleHistoryQuery.isLoading ? (
                <ActivityIndicator size="small" color={colors.text} style={{ marginTop: 20 }} />
              ) : roleHistoryQuery.isError ? (
                <Text style={{ color: colors.textSecondary, marginTop: 20 }}>
                  Failed to load role transition history.
                </Text>
              ) : (roleHistoryQuery.data?.history || []).length === 0 ? (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Ionicons name="person-outline" size={40} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No role change records on file.</Text>
                </View>
              ) : (
                (roleHistoryQuery.data?.history || []).map((h: any) => (
                  <View
                    key={h.id}
                    style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                  >
                    <View style={styles.historyCardTop}>
                      <Badge label={h.action.replace(/_/g, ' ')} variant="neutral" size="sm" />
                      <Caption style={{ color: colors.textTertiary }}>{formatTimeAgo(h.createdAt)}</Caption>
                    </View>
                    <Text style={{ color: colors.text, marginTop: 4, fontWeight: '600' }}>
                      Reason: {h.metadata?.reason || h.reason || 'No justification provided'}
                    </Text>
                    <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
                      Actor: {h.actorName || h.actor_user_id}
                    </Caption>
                  </View>
                ))
              )
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  filterScrollSub: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  filterChipSm: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 6,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  userCardInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 6,
  },
  userCardSub: {
    marginTop: 2,
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
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalProfileTop: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  actionsCard: {
    padding: 16,
    borderWidth: 1,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginBottom: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
  },
  historyLinksRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  historyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderWidth: 1,
  },
  detailCard: {
    padding: 16,
    borderWidth: 1,
  },
  detailRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  historyCard: {
    padding: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  historyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
});
