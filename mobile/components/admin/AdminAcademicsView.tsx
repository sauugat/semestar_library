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
import { apiFetch } from '@/services/api';
import { AdminActionConfirmModal } from './AdminActionConfirmModal';
import { AdminSubjectFormModal, SubjectFormData } from './AdminSubjectFormModal';

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
  const { colors, radii } = useTheme();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AcademicSubTab>('overview');
  const [selectedSemester, setSelectedSemester] = useState<string>('all');
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectStatusFilter, setSubjectStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [subjectPage, setSubjectPage] = useState(1);
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);

  // Subject Form Modal State (Create or Edit)
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [formModalMode, setFormModalMode] = useState<'create' | 'edit'>('create');
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Archive / Reactivate Action Modal State
  const [confirmActionType, setConfirmActionType] = useState<'archive' | 'reactivate' | null>(null);
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
        if (res.status === 404) return { unclassified: [], count: 0, unavailable: true };
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: activeTab === 'unclassified',
  });

  // Detail Query for selected subject
  const subjectDetailQuery = useQuery({
    queryKey: ['admin-academics-subject-detail', selectedSubject?.id],
    queryFn: async () => {
      if (!selectedSubject?.id) return null;
      const res = await apiFetch(`/api/admin/academics/subjects/${encodeURIComponent(selectedSubject.id)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: Boolean(selectedSubject?.id),
  });

  // Handle Create or Edit Subject Submit
  const handleSubjectFormSubmit = async (formData: SubjectFormData) => {
    setIsSubmittingForm(true);
    setFormError(null);

    try {
      const endpoint =
        formModalMode === 'create'
          ? '/api/admin/academics/subjects'
          : `/api/admin/academics/subjects/${encodeURIComponent(selectedSubject!.id)}`;
      const method = formModalMode === 'create' ? 'POST' : 'PUT';

      const res = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Operation failed with status ${res.status}`);
      }

      const resJson = await res.json();

      // Targeted cache invalidation
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-academics-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-academics-subjects'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
        selectedSubject?.id
          ? queryClient.invalidateQueries({ queryKey: ['admin-academics-subject-detail', selectedSubject.id] })
          : Promise.resolve(),
      ]);

      if (formModalMode === 'edit' && resJson.subject) {
        setSelectedSubject(resJson.subject);
      }

      setFormModalVisible(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save subject. Please check inputs and retry.');
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Handle Archive or Reactivate Submit
  const handleConfirmActionSubmit = async (reason: string) => {
    if (!selectedSubject || !confirmActionType || isSubmittingConfirm) return;

    setIsSubmittingConfirm(true);
    setConfirmError(null);

    try {
      const endpoint = `/api/admin/academics/subjects/${encodeURIComponent(selectedSubject.id)}/${confirmActionType}`;
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Failed to ${confirmActionType} subject.`);
      }

      const resJson = await res.json();

      // Targeted cache invalidation
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-academics-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-academics-subjects'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-academics-subject-detail', selectedSubject.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
      ]);

      if (resJson.subject) {
        setSelectedSubject(resJson.subject);
      } else {
        setSelectedSubject((prev) => (prev ? { ...prev, active: confirmActionType === 'reactivate' } : null));
      }

      setConfirmActionType(null);
    } catch (err: any) {
      setConfirmError(err.message || `Failed to ${confirmActionType} subject.`);
    } finally {
      setIsSubmittingConfirm(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Heading level={2}>Academic Management</Heading>
          <Caption style={{ color: colors.textSecondary }}>Curriculum, subjects & syllabus control</Caption>
        </View>
        <TouchableOpacity
          style={[styles.addSubjectBtn, { backgroundColor: colors.text, borderRadius: radii.md }]}
          onPress={() => {
            setFormModalMode('create');
            setFormError(null);
            setFormModalVisible(true);
          }}
        >
          <Ionicons name="add" size={16} color={colors.background} style={{ marginRight: 4 }} />
          <Text style={{ color: colors.background, fontWeight: '700', fontSize: 13 }}>New Subject</Text>
        </TouchableOpacity>
      </View>

      {/* Sub Tabs */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {[
            { id: 'overview', label: '8-Sem Overview', icon: 'grid-outline' },
            { id: 'subjects', label: 'Canonical Directory', icon: 'book-outline' },
            { id: 'materials', label: 'Materials Explorer', icon: 'document-text-outline' },
            { id: 'assignments', label: 'Assignments Explorer', icon: 'clipboard-outline' },
            { id: 'unclassified', label: 'Unclassified Review', icon: 'help-circle-outline' },
          ].map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id as AcademicSubTab)}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: isSelected ? colors.text : colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={14}
                  color={isSelected ? colors.background : colors.textSecondary}
                  style={{ marginRight: 6 }}
                />
                <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? colors.background : colors.text }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content for TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        overviewQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
            <Caption style={{ marginTop: 12, color: colors.textSecondary }}>Loading 8-semester curriculum metrics...</Caption>
          </View>
        ) : overviewQuery.isError ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.textSecondary} />
            <Heading level={3} style={{ marginTop: 12 }}>Unable to Load Overview</Heading>
            <Caption style={{ textAlign: 'center', marginTop: 4, color: colors.textSecondary }}>
              {(overviewQuery.error as any)?.message || 'Failed to retrieve academic metrics.'}
            </Caption>
          </View>
        ) : (
          <FlatList
            data={(overviewQuery.data?.semesters || []) as SemesterMetric[]}
            keyExtractor={(item) => String(item.semester)}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            refreshControl={
              <RefreshControl refreshing={overviewQuery.isRefetching} onRefresh={() => void overviewQuery.refetch()} tintColor={colors.text} />
            }
            renderItem={({ item }) => (
              <View style={[styles.semCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={styles.semCardTop}>
                  <Text style={[styles.semTitle, { color: colors.text }]}>{item.title || `Semester ${item.semester}`}</Text>
                  <Badge label={`${item.activeSubjectsCount || 0} Subjects`} variant="neutral" size="sm" />
                </View>
                <View style={styles.semStatsRow}>
                  <View style={styles.semStatCol}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.assignedTeachersCount || 0}</Text>
                    <Caption style={{ color: colors.textSecondary }}>Faculty</Caption>
                  </View>
                  <View style={styles.semStatCol}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.materialsCount || 0}</Text>
                    <Caption style={{ color: colors.textSecondary }}>Materials</Caption>
                  </View>
                  <View style={styles.semStatCol}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.assignmentsCount || 0}</Text>
                    <Caption style={{ color: colors.textSecondary }}>Coursework</Caption>
                  </View>
                </View>
              </View>
            )}
          />
        )
      )}

      {/* Content for TAB 2: SUBJECTS DIRECTORY */}
      {activeTab === 'subjects' && (
        <View style={{ flex: 1 }}>
          {/* Search & Status Filters */}
          <View style={styles.searchWrap}>
            <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <TextInput
                value={subjectSearch}
                onChangeText={setSubjectSearch}
                placeholder="Search code or subject title..."
                placeholderTextColor={colors.textTertiary}
                style={[styles.searchInput, { color: colors.text }]}
              />
              {subjectSearch.length > 0 && (
                <TouchableOpacity onPress={() => setSubjectSearch('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.statusFilters}>
              {(['all', 'active', 'archived'] as const).map((st) => {
                const isSel = subjectStatusFilter === st;
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() => setSubjectStatusFilter(st)}
                    style={[
                      styles.statusChip,
                      {
                        backgroundColor: isSel ? colors.text : colors.background,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: isSel ? colors.background : colors.textSecondary }}>
                      {st.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {subjectsQuery.isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.text} />
              <Caption style={{ marginTop: 12, color: colors.textSecondary }}>Loading canonical subjects...</Caption>
            </View>
          ) : (
            <FlatList
              data={(subjectsQuery.data?.subjects || []) as SubjectItem[]}
              keyExtractor={(item) => item.id || item.code}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
              refreshControl={
                <RefreshControl refreshing={subjectsQuery.isRefetching} onRefresh={() => void subjectsQuery.refetch()} tintColor={colors.text} />
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.subjectCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                  onPress={() => setSelectedSubject(item)}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.subjectCode, { color: colors.text }]}>{item.code}</Text>
                      <Badge label={`Sem ${item.semester}`} variant="neutral" size="sm" />
                      {!item.active && <Badge label="Archived" variant="outline" size="sm" />}
                    </View>
                    <Text style={[styles.subjectName, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {/* Content for TAB 3: MATERIALS EXPLORER */}
      {activeTab === 'materials' && (
        <View style={{ flex: 1, padding: 16 }}>
          {materialsQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <FlatList
              data={materialsQuery.data?.materials || []}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 110 }}
              renderItem={({ item }: { item: any }) => (
                <View style={[styles.resCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.title || item.originalName}</Text>
                  <Caption style={{ color: colors.textSecondary }}>
                    {item.subject || 'General'} • Sem {item.semester || '1'}
                  </Caption>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Content for TAB 4: ASSIGNMENTS EXPLORER */}
      {activeTab === 'assignments' && (
        <View style={{ flex: 1, padding: 16 }}>
          {assignmentsQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <FlatList
              data={assignmentsQuery.data?.assignments || []}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 110 }}
              renderItem={({ item }: { item: any }) => (
                <View style={[styles.resCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.title}</Text>
                  <Caption style={{ color: colors.textSecondary }}>
                    {item.subject || 'General'} • Sem {item.semester || '1'}
                  </Caption>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Content for TAB 5: UNCLASSIFIED MATERIALS */}
      {activeTab === 'unclassified' && (
        <View style={{ flex: 1, padding: 16 }}>
          <View style={[styles.unclassifiedBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md }]}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
              Legacy and unclassified study materials review. Materials require catalog alignment via Web Administration Console.
            </Text>
          </View>
          {unclassifiedQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <FlatList
              data={unclassifiedQuery.data?.unclassified || []}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 110, marginTop: 12 }}
              renderItem={({ item }: { item: any }) => (
                <View style={[styles.resCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.title || item.originalName}</Text>
                  <Caption style={{ color: colors.textSecondary }}>
                    Uploaded: {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                  </Caption>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Subject Detail & Action Modal */}
      <Modal
        visible={Boolean(selectedSubject)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedSubject(null)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Heading level={3}>Course Information</Heading>
            <TouchableOpacity
              onPress={() => setSelectedSubject(null)}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedSubject && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
              <View style={styles.detailTop}>
                <Heading level={2}>{selectedSubject.code}</Heading>
                <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 4 }}>{selectedSubject.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Badge label={`Semester ${selectedSubject.semester}`} variant="neutral" size="sm" />
                  <Badge label={selectedSubject.active ? 'Active' : 'Archived'} variant={selectedSubject.active ? 'neutral' : 'outline'} size="sm" />
                </View>
              </View>

              {/* Administrative Operations Card */}
              <View style={[styles.actionsCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                  Administrative Operations
                </Caption>

                <View style={{ gap: 10 }}>
                  {/* Edit Subject Button */}
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                    onPress={() => {
                      setFormModalMode('edit');
                      setFormError(null);
                      setFormModalVisible(true);
                    }}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                    <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Edit Course Metadata</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>

                  {/* Archive or Reactivate Button */}
                  {selectedSubject.active ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => {
                        setConfirmError(null);
                        setConfirmActionType('archive');
                      }}
                    >
                      <Ionicons name="archive-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Archive Subject</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md }]}
                      onPress={() => {
                        setConfirmError(null);
                        setConfirmActionType('reactivate');
                      }}
                    >
                      <Ionicons name="refresh-outline" size={18} color={colors.text} style={{ marginRight: 10 }} />
                      <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Reactivate Subject</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={[styles.metaCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, marginTop: 16 }]}>
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
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Create / Edit Subject Form Modal */}
      <AdminSubjectFormModal
        visible={formModalVisible}
        mode={formModalMode}
        initialSubject={formModalMode === 'edit' ? selectedSubject : null}
        isSubmitting={isSubmittingForm}
        error={formError}
        onSubmit={handleSubjectFormSubmit}
        onClose={() => {
          if (!isSubmittingForm) {
            setFormModalVisible(false);
            setFormError(null);
          }
        }}
      />

      {/* Archive / Reactivate Confirmation Modal */}
      {selectedSubject && (
        <AdminActionConfirmModal
          visible={Boolean(confirmActionType)}
          title={confirmActionType === 'archive' ? 'Archive Subject' : 'Reactivate Subject'}
          subtitle="This action will be transactionally recorded in administrative audit logs."
          targetName={`${selectedSubject.code} — ${selectedSubject.name}`}
          targetSubtitle={`Semester ${selectedSubject.semester} • ${selectedSubject.department || 'BIT'}`}
          actionType={confirmActionType === 'archive' ? 'destructive' : 'neutral'}
          confirmLabel={confirmActionType === 'archive' ? 'Confirm Archive' : 'Confirm Reactivation'}
          requireReason={true}
          reasonPlaceholder="Enter mandatory administrative reason (minimum 3 characters)..."
          isSubmitting={isSubmittingConfirm}
          error={confirmError}
          onConfirm={handleConfirmActionSubmit}
          onClose={() => {
            if (!isSubmittingConfirm) {
              setConfirmActionType(null);
              setConfirmError(null);
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
  addSubjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  statusFilters: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  subjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  subjectCode: {
    fontSize: 15,
    fontWeight: '700',
  },
  subjectName: {
    fontSize: 13,
    marginTop: 2,
  },
  resCard: {
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  unclassifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
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
  detailTop: {
    paddingVertical: 12,
  },
  actionsCard: {
    padding: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
  },
  metaCard: {
    padding: 16,
    borderWidth: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  teacherItem: {
    padding: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
});
