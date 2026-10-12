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
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { apiFetch } from '@/services/api';
import { formatTimeAgo, formatDate } from '@/utils/date';

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

export function AdminUsersView() {
  const { colors, radii, spacing } = useTheme();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher' | 'cr' | 'admin'>('all');
  const [semesterFilter, setSemesterFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<AdminUserItem | null>(null);

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
        {(['all', 'student', 'teacher', 'cr', 'admin'] as const).map((r) => {
          const isSelected = roleFilter === r;
          const label = r === 'all' ? 'All Roles' : r === 'cr' ? 'CR' : r.charAt(0).toUpperCase() + r.slice(1) + 's';
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
                  backgroundColor: isSelected ? colors.surfaceRaised : colors.surface,
                  borderColor: isSelected ? colors.text : colors.border,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Text style={{ color: isSelected ? colors.text : colors.textSecondary, fontSize: 13, fontWeight: isSelected ? '600' : '400' }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Semester Filters Row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollSub}>
        <TouchableOpacity
          onPress={() => {
            setSemesterFilter('all');
            setPage(1);
          }}
          style={[
            styles.filterChipSm,
            {
              backgroundColor: semesterFilter === 'all' ? colors.surfaceRaised : 'transparent',
              borderColor: semesterFilter === 'all' ? colors.text : colors.border,
              borderRadius: radii.full,
            },
          ]}
        >
          <Text style={{ color: semesterFilter === 'all' ? colors.text : colors.textSecondary, fontSize: 12 }}>All Sems</Text>
        </TouchableOpacity>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => {
          const semStr = String(s);
          const isSelected = semesterFilter === semStr;
          return (
            <TouchableOpacity
              key={semStr}
              onPress={() => {
                setSemesterFilter(semStr);
                setPage(1);
              }}
              style={[
                styles.filterChipSm,
                {
                  backgroundColor: isSelected ? colors.surfaceRaised : 'transparent',
                  borderColor: isSelected ? colors.text : colors.border,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Text style={{ color: isSelected ? colors.text : colors.textSecondary, fontSize: 12 }}>Sem {s}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* User Directory List */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Loading users...</Text>
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textSecondary} />
          <Text style={{ color: colors.text, marginTop: 8 }}>{(error as any)?.message || 'Failed to load users'}</Text>
          <TouchableOpacity onPress={() => void refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Caption style={{ color: colors.text }}>Retry</Caption>
          </TouchableOpacity>
        </View>
      ) : users.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 10 }}>No matching users found</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.studentId}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
          }
          renderItem={({ item }) => {
            const isSuspended = item.account_status === 'suspended';
            return (
              <TouchableOpacity
                onPress={() => setSelectedUser(item)}
                style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
              >
                <Avatar name={item.name} size="md" />
                <View style={styles.userCardInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {isSuspended ? (
                      <Badge label="Suspended" variant="outline" size="sm" />
                    ) : (
                      <Badge label={item.role.toUpperCase()} variant="neutral" size="sm" />
                    )}
                  </View>
                  <Caption style={{ color: colors.textSecondary }}>
                    ID: {item.studentId} {item.username ? `• @${item.username}` : ''}
                  </Caption>
                  <View style={styles.userCardSub}>
                    <Caption style={{ color: colors.textTertiary }}>
                      {item.role === 'teacher'
                        ? 'Faculty'
                        : item.semester
                        ? `Semester ${item.semester}`
                        : 'No Semester'}
                      {item.cohort_name ? ` • ${item.cohort_name}` : ''}
                    </Caption>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            pagination && pagination.totalPages > 1 ? (
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  disabled={page <= 1}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                  style={[styles.pageBtn, { borderColor: colors.border, opacity: page <= 1 ? 0.3 : 1 }]}
                >
                  <Caption style={{ color: colors.text }}>Previous</Caption>
                </TouchableOpacity>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                  Page {page} of {pagination.totalPages}
                </Text>
                <TouchableOpacity
                  disabled={page >= pagination.totalPages}
                  onPress={() => setPage((p) => p + 1)}
                  style={[styles.pageBtn, { borderColor: colors.border, opacity: page >= pagination.totalPages ? 0.3 : 1 }]}
                >
                  <Caption style={{ color: colors.text }}>Next</Caption>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Read-Only User Detail Modal */}
      <Modal visible={Boolean(selectedUser)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedUser(null)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Heading level={3}>Account Details</Heading>
            <TouchableOpacity onPress={() => setSelectedUser(null)} style={[styles.closeBtn, { backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedUser && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
              <View style={styles.modalProfileTop}>
                <Avatar name={selectedUser.name} size="lg" />
                <View style={{ marginTop: 12, alignItems: 'center' }}>
                  <Heading level={3}>{selectedUser.name}</Heading>
                  <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
                    {selectedUser.username ? `@${selectedUser.username}` : selectedUser.studentId}
                  </Caption>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Badge label={selectedUser.role.toUpperCase()} variant="neutral" size="sm" />
                    <Badge
                      label={selectedUser.account_status === 'suspended' ? 'Suspended' : 'Active Account'}
                      variant={selectedUser.account_status === 'suspended' ? 'outline' : 'neutral'}
                      size="sm"
                    />
                  </View>
                </View>
              </View>

              {/* Account Meta Grid */}
              <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>System Student/User ID</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.studentId}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Email Address</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.email || 'None'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Department</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.department || 'BIT'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Semester</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedUser.semester ? `Semester ${selectedUser.semester}` : 'N/A'}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Assigned Cohort</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedUser.cohort_name ? `${selectedUser.cohort_name} (${selectedUser.cohort_slot?.toUpperCase()})` : 'Unassigned'}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Caption style={{ color: colors.textSecondary }}>Account Created</Caption>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedUser.created_at ? formatDate(selectedUser.created_at) : 'N/A'}
                  </Text>
                </View>
              </View>

              {/* Assigned Subjects if Teacher */}
              {selectedUser.role === 'teacher' && selectedUser.assignedSubjects && selectedUser.assignedSubjects.length > 0 && (
                <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, marginTop: 14 }]}>
                  <Caption style={{ color: colors.textSecondary, marginBottom: 8 }}>Officially Assigned Subjects</Caption>
                  {selectedUser.assignedSubjects.map((sub) => (
                    <View key={sub.id || sub.code} style={{ paddingVertical: 6 }}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {sub.code} — {sub.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Phase 4C.1 Read-Only Notice */}
              <View style={[styles.phaseNotice, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md }]}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
                  Read-only account inspection for Phase 4C.1. Account suspension, reactivation, promotion, and demotion controls will be enabled in Phase 4C.2.
                </Text>
              </View>
            </ScrollView>
          )}
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
  phaseNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginTop: 18,
  },
});
