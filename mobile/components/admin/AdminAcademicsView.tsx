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
import { apiFetch } from '@/services/api';

type AcademicSubTab = 'overview' | 'subjects' | 'materials' | 'assignments' | 'unclassified';

interface SubjectItem {
  id: string;
  code: string;
  name: string;
  semester: number;
  department: string;
  creditHours?: number;
  nature?: string | null;
  active: boolean;
  assignedTeachersCount?: number;
  materialsCount?: number;
  assignmentsCount?: number;
}

interface SemesterMetric {
  semester: number;
  title: string;
  activeSubjectsCount: number;
  archivedSubjectsCount: number;
  assignedTeachersCount: number;
  materialsCount: number;
  assignmentsCount: number;
}

export function AdminAcademicsView() {
  const { colors, radii, spacing } = useTheme();

  const [activeTab, setActiveTab] = useState<AcademicSubTab>('overview');
  const [selectedSemester, setSelectedSemester] = useState<string>('all');
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectStatusFilter, setSubjectStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [subjectPage, setSubjectPage] = useState(1);
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);

  // 1. Overview Query (Semesters 1-8 metrics)
  const overviewQuery = useQuery({
    queryKey: ['admin-academics-overview'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/academics');
      if (!res.ok) {
        if (res.status === 404) return { semesters: [], unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'overview',
  });

  // 2. Subjects Directory Query
  const subjectsQuery = useQuery({
    queryKey: ['admin-academics-subjects', subjectPage, selectedSemester, subjectStatusFilter, subjectSearch],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: String(subjectPage),
        limit: '20',
        status: subjectStatusFilter,
      });
      if (selectedSemester !== 'all') p.append('semester', selectedSemester);
      if (subjectSearch.trim()) p.append('search', subjectSearch.trim());

      const res = await apiFetch(`/api/admin/academics/subjects?${p.toString()}`);
      if (!res.ok) {
        if (res.status === 404) return { subjects: [], pagination: { total: 0, totalPages: 1 }, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'subjects',
  });

  // 3. Materials Explorer Query
  const materialsQuery = useQuery({
    queryKey: ['admin-academics-materials', selectedSemester],
    queryFn: async () => {
      const p = new URLSearchParams({ page: '1', limit: '25' });
      if (selectedSemester !== 'all') p.append('semester', selectedSemester);
      const res = await apiFetch(`/api/admin/academics/materials?${p.toString()}`);
      if (!res.ok) {
        if (res.status === 404) return { materials: [], pagination: { total: 0 }, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'materials',
  });

  // 4. Assignments Explorer Query
  const assignmentsQuery = useQuery({
    queryKey: ['admin-academics-assignments', selectedSemester],
    queryFn: async () => {
      const p = new URLSearchParams({ page: '1', limit: '25' });
      if (selectedSemester !== 'all') p.append('semester', selectedSemester);
      const res = await apiFetch(`/api/admin/academics/assignments?${p.toString()}`);
      if (!res.ok) {
        if (res.status === 404) return { assignments: [], pagination: { total: 0 }, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'assignments',
  });

  // 5. Unclassified Materials Query
  const unclassifiedQuery = useQuery({
    queryKey: ['admin-academics-unclassified'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/academics/unclassified-materials');
      if (!res.ok) {
        if (res.status === 404) return { items: [], total: 0, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'unclassified',
  });

  // Subject Detail Query (assigned teachers)
  const subjectDetailQuery = useQuery({
    queryKey: ['admin-subject-detail', selectedSubject?.id],
    queryFn: async () => {
      if (!selectedSubject?.id) return null;
      const res = await apiFetch(`/api/admin/academics/subjects/${selectedSubject.id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(selectedSubject?.id),
  });

  const semesters: SemesterMetric[] = overviewQuery.data?.semesters || [];
  const subjects: SubjectItem[] = subjectsQuery.data?.subjects || [];
  const subjectsPagination = subjectsQuery.data?.pagination;
  const materialsList = materialsQuery.data?.materials || [];
  const assignmentsList = assignmentsQuery.data?.assignments || [];
  const unclassifiedItems = unclassifiedQuery.data?.items || [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Heading level={2}>Academic Catalog</Heading>
          <Caption style={{ color: colors.textSecondary }}>Curriculum, semesters & canonical courses</Caption>
        </View>
        <Badge label="BIT 1–8" variant="neutral" size="sm" />
      </View>

      {/* Subtab Segmented Switcher */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
        {[
          { key: 'overview', label: '8 Semesters' },
          { key: 'subjects', label: 'Subjects' },
          { key: 'materials', label: 'Materials' },
          { key: 'assignments', label: 'Coursework' },
          { key: 'unclassified', label: 'Unclassified' },
        ].map((t) => {
          const isSelected = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setActiveTab(t.key as AcademicSubTab)}
              style={[
                styles.tabChip,
                {
                  backgroundColor: isSelected ? colors.surfaceRaised : colors.surface,
                  borderColor: isSelected ? colors.text : colors.border,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Text style={{ color: isSelected ? colors.text : colors.textSecondary, fontSize: 13, fontWeight: isSelected ? '600' : '400' }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content per subtab */}
      {activeTab === 'overview' && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={overviewQuery.isRefetching} onRefresh={() => void overviewQuery.refetch()} tintColor={colors.text} />
          }
        >
          {overviewQuery.isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.text} />
            </View>
          ) : (
            <>
              <Heading level={4} style={{ marginBottom: 12 }}>BIT Academic Overview (Semesters 1 to 8)</Heading>
              {semesters.map((sem) => (
                <TouchableOpacity
                  key={sem.semester}
                  onPress={() => {
                    setSelectedSemester(String(sem.semester));
                    setActiveTab('subjects');
                    setSubjectPage(1);
                  }}
                  style={[styles.semCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                >
                  <View style={styles.semCardTop}>
                    <Text style={[styles.semTitle, { color: colors.text }]}>{sem.title || `Semester ${sem.semester}`}</Text>
                    <Badge label={`${sem.activeSubjectsCount} Active`} variant="neutral" size="sm" />
                  </View>
                  <View style={styles.semStatsRow}>
                    <View style={styles.semStatCol}>
                      <Caption style={{ color: colors.textTertiary }}>Teachers</Caption>
                      <Text style={[styles.semStatVal, { color: colors.text }]}>{sem.assignedTeachersCount}</Text>
                    </View>
                    <View style={styles.semStatCol}>
                      <Caption style={{ color: colors.textTertiary }}>Materials</Caption>
                      <Text style={[styles.semStatVal, { color: colors.text }]}>{sem.materialsCount}</Text>
                    </View>
                    <View style={styles.semStatCol}>
                      <Caption style={{ color: colors.textTertiary }}>Coursework</Caption>
                      <Text style={[styles.semStatVal, { color: colors.text }]}>{sem.assignmentsCount}</Text>
                    </View>
                    <View style={styles.semStatCol}>
                      <Caption style={{ color: colors.textTertiary }}>Archived</Caption>
                      <Text style={[styles.semStatVal, { color: colors.textSecondary }]}>{sem.archivedSubjectsCount}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {activeTab === 'subjects' && (
        <View style={{ flex: 1 }}>
          {/* Filters */}
          <View style={styles.subFilterRow}>
            <TextInput
              value={subjectSearch}
              onChangeText={(text) => {
                setSubjectSearch(text);
                setSubjectPage(1);
              }}
              placeholder="Search code or subject..."
              placeholderTextColor={colors.textTertiary}
              style={[styles.subSearchInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, borderRadius: radii.sm }]}
            />
          </View>

          {/* Semester Selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.semFilterScroll}>
            <TouchableOpacity
              onPress={() => {
                setSelectedSemester('all');
                setSubjectPage(1);
              }}
              style={[
                styles.semChip,
                {
                  backgroundColor: selectedSemester === 'all' ? colors.surfaceRaised : 'transparent',
                  borderColor: selectedSemester === 'all' ? colors.text : colors.border,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Text style={{ color: selectedSemester === 'all' ? colors.text : colors.textSecondary, fontSize: 12 }}>All</Text>
            </TouchableOpacity>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => {
              const semStr = String(s);
              const isSelected = selectedSemester === semStr;
              return (
                <TouchableOpacity
                  key={semStr}
                  onPress={() => {
                    setSelectedSemester(semStr);
                    setSubjectPage(1);
                  }}
                  style={[
                    styles.semChip,
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

          {subjectsQuery.isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.text} />
            </View>
          ) : subjects.length === 0 ? (
            <View style={styles.centerBox}>
              <Ionicons name="book-outline" size={36} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, marginTop: 8 }}>No canonical subjects found</Text>
            </View>
          ) : (
            <FlatList
              data={subjects}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
              refreshControl={
                <RefreshControl refreshing={subjectsQuery.isRefetching} onRefresh={() => void subjectsQuery.refetch()} tintColor={colors.text} />
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => setSelectedSubject(item)}
                  style={[styles.subjectCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                >
                  <View style={styles.subjectTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.subjectCode, { color: colors.text }]}>{item.code}</Text>
                      <Text style={[styles.subjectName, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    <Badge label={item.active ? `Sem ${item.semester}` : 'Archived'} variant={item.active ? 'neutral' : 'outline'} size="sm" />
                  </View>
                  <View style={styles.subjectBottomRow}>
                    <Caption style={{ color: colors.textSecondary }}>
                      {item.assignedTeachersCount ?? 0} Faculty • {item.materialsCount ?? 0} Files • {item.assignmentsCount ?? 0} Assignments
                    </Caption>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {activeTab === 'materials' && (
        <FlatList
          data={materialsList}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={materialsQuery.isRefetching} onRefresh={() => void materialsQuery.refetch()} tintColor={colors.text} />
          }
          renderItem={({ item }: { item: any }) => (
            <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{item.title || item.storedName}</Text>
                <Badge label={`Sem ${item.semester}`} variant="neutral" size="sm" />
              </View>
              <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
                Subject: {item.subject} • Author: {item.uploadedBy || 'Anonymous'}
              </Caption>
            </View>
          )}
        />
      )}

      {activeTab === 'assignments' && (
        <FlatList
          data={assignmentsList}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={assignmentsQuery.isRefetching} onRefresh={() => void assignmentsQuery.refetch()} tintColor={colors.text} />
          }
          renderItem={({ item }: { item: any }) => (
            <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{item.title}</Text>
                <Badge label={`Sem ${item.semester}`} variant="neutral" size="sm" />
              </View>
              <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
                Subject: {item.subject} • Creator: {item.createdBy || 'Staff'}
              </Caption>
            </View>
          )}
        />
      )}

      {activeTab === 'unclassified' && (
        <FlatList
          data={unclassifiedItems}
          keyExtractor={(item: any) => `${item.type}-${item.id}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={unclassifiedQuery.isRefetching} onRefresh={() => void unclassifiedQuery.refetch()} tintColor={colors.text} />
          }
          ListHeaderComponent={
            <View style={[styles.infoBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md, marginBottom: 12 }]}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
                Read-only review of legacy materials with missing or unlinked semester classifications. Automatic reclassification is disabled to preserve student isolation.
              </Text>
            </View>
          }
          renderItem={({ item }: { item: any }) => (
            <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{item.title}</Text>
                <Badge label={item.type.toUpperCase()} variant="outline" size="sm" />
              </View>
              <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
                Reported Issue: {item.issues ? item.issues.join(', ') : 'Unclassified subject association'}
              </Caption>
            </View>
          )}
        />
      )}

      {/* Subject Detail Modal */}
      <Modal visible={Boolean(selectedSubject)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedSubject(null)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Heading level={3}>Subject Details</Heading>
            <TouchableOpacity onPress={() => setSelectedSubject(null)} style={[styles.closeBtn, { backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedSubject && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
              <View style={{ marginBottom: 16 }}>
                <Heading level={2}>{selectedSubject.code}</Heading>
                <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 2 }}>{selectedSubject.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Badge label={`Semester ${selectedSubject.semester}`} variant="neutral" size="sm" />
                  <Badge label={selectedSubject.active ? 'Active' : 'Archived'} variant={selectedSubject.active ? 'neutral' : 'outline'} size="sm" />
                </View>
              </View>

              <View style={[styles.metaCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.metaRow}>
                  <Caption style={{ color: colors.textSecondary }}>Department</Caption>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{selectedSubject.department || 'BIT'}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Caption style={{ color: colors.textSecondary }}>Credit Hours</Caption>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{selectedSubject.creditHours || 3.0}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Caption style={{ color: colors.textSecondary }}>Nature</Caption>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{selectedSubject.nature || 'Theory & Practical'}</Text>
                </View>
              </View>

              {/* Assigned Teachers List */}
              <Heading level={4} style={{ marginTop: 20, marginBottom: 10 }}>Assigned Faculty</Heading>
              {subjectDetailQuery.isLoading ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : subjectDetailQuery.data?.assignedTeachers && subjectDetailQuery.data.assignedTeachers.length > 0 ? (
                subjectDetailQuery.data.assignedTeachers.map((t: any) => (
                  <View key={t.teacher_id || t.user_id} style={[styles.teacherItem, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t.name || t.username}</Text>
                    <Caption style={{ color: colors.textSecondary }}>{t.designation || 'Faculty Member'} • {t.email || t.user_id}</Caption>
                  </View>
                ))
              ) : (
                <Caption style={{ color: colors.textSecondary }}>No faculty assigned to this subject yet.</Caption>
              )}

              <View style={[styles.infoBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md, marginTop: 24 }]}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
                  Read-only view for Phase 4C.1. Subject creation, editing, and archiving operations are managed via Admin Web Console.
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
  tabScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  centerBox: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semCard: {
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  semCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  semTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  semStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 10,
  },
  semStatCol: {
    flex: 1,
  },
  semStatVal: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  subFilterRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  subSearchInput: {
    height: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
    fontSize: 14,
  },
  semFilterScroll: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  semChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  subjectCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  subjectTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subjectCode: {
    fontSize: 15,
    fontWeight: '700',
  },
  subjectName: {
    fontSize: 13,
    marginTop: 2,
  },
  subjectBottomRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
    marginTop: 4,
  },
  itemCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCard: {
    padding: 14,
    borderWidth: 1,
  },
  metaRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  teacherItem: {
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
});
