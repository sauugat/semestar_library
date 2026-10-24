import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadNoteModal } from '@/components/UploadNoteModal';
import { apiFetch, getBaseUrl } from '@/services/api';
import { formatTimeAgo, formatDate } from '@/utils/date';
import { useAdaptiveNavScroll } from '@/context/NavScrollContext';

export interface TeacherSubject {
  id: string | number;
  code: string;
  name?: string;
  title?: string;
  semester: number;
  department?: string;
  creditHours?: number;
  nature?: string | null;
}

export interface TeacherNote {
  id: number;
  originalName: string;
  storedName: string;
  title: string;
  subject: string;
  chapter: string | null;
  semester: string | null;
  uploadedBy: string;
  uploadedAt: string;
  sizeBytes: string | number;
  previewName?: string | null;
}

export interface TeacherAssignment {
  id: number;
  title: string;
  description: string;
  subject: string;
  semester: string | number;
  language?: string | null;
  deadline?: string | null;
  createdAt: string;
  createdBy: string;
  questionCount?: number;
  questions_count?: number;
  submissionCount?: number;
  submissions_count?: number;
}

export interface TeacherDashboardInitResponse {
  user: {
    studentId: string;
    name: string;
    email: string;
    role: string;
    department: string;
  };
  teacher?: any;
  assignedSubjects: TeacherSubject[];
  assignedSemesters: number[];
  subjects: TeacherSubject[];
  stats: {
    assignedSubjectsCount?: number;
    uploadedNotesCount?: number;
    createdAssignmentsCount?: number;
    subjectsCount?: number;
    notesCount?: number;
    assignmentsCount?: number;
  };
}

function formatFileSize(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(filename: string): keyof typeof Ionicons.glyphMap {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'document-text-outline';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'easel-outline';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'document-outline';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return 'archive-outline';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image-outline';
  return 'document-attach-outline';
}

type MaterialTab = 'subjects' | 'notes' | 'assignments';

export function TeacherMaterialsView() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { onScroll: handleNavScroll, scrollEventThrottle } = useAdaptiveNavScroll();

  const [activeTab, setActiveTab] = useState<MaterialTab>('subjects');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadPresetSubject, setUploadPresetSubject] = useState<string | undefined>(undefined);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // 1. Fetch Teacher Dashboard Init (authoritative stats & assigned subjects)
  const {
    data: initData,
    isLoading: isInitLoading,
    refetch: refetchInit,
  } = useQuery<TeacherDashboardInitResponse>({
    queryKey: ['teacher-dashboard-init', user?.studentId],
    queryFn: async () => {
      const res = await apiFetch('/api/teacher/dashboard-init');
      if (!res.ok) throw new Error('Failed to load teacher dashboard');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // 2. Fetch Teacher Subjects (fallback only when dashboard-init does not supply subjects)
  const hasInitSubjects = Array.isArray(initData?.assignedSubjects || initData?.subjects);
  const {
    data: subjectsData,
    isLoading: isSubjectsLoading,
    refetch: refetchSubjects,
  } = useQuery<{ subjects: TeacherSubject[] }>({
    queryKey: ['teacher-subjects', user?.studentId],
    queryFn: async () => {
      const res = await apiFetch('/api/teacher/subjects');
      if (!res.ok) throw new Error('Failed to load teacher subjects');
      return res.json();
    },
    enabled: Boolean(!hasInitSubjects && !isInitLoading),
    staleTime: 60 * 1000,
  });

  const userSubjects = user?.subjects;

  // Resolve assigned subjects list
  const assignedSubjects: TeacherSubject[] = useMemo(() => {
    const fromInit = initData?.assignedSubjects || initData?.subjects;
    if (Array.isArray(fromInit) && fromInit.length > 0) return fromInit;
    if (Array.isArray(subjectsData?.subjects) && subjectsData.subjects.length > 0) return subjectsData.subjects;
    if (Array.isArray(userSubjects) && userSubjects.length > 0) {
      return userSubjects.map((s: any) => ({
        id: s.id,
        code: s.code,
        name: s.title || s.name,
        title: s.title || s.name,
        semester: Number(s.semester || 1),
      }));
    }
    return [];
  }, [initData, subjectsData, userSubjects]);

  // 3. Fetch Teacher Notes (scoped to authenticated teacher)
  const {
    data: notesData,
    isLoading: isNotesLoading,
    refetch: refetchNotes,
  } = useQuery<{ notes: TeacherNote[] }>({
    queryKey: ['teacher-notes', user?.studentId, selectedSubjectFilter],
    queryFn: async () => {
      const param = selectedSubjectFilter !== 'all' ? `?subject=${encodeURIComponent(selectedSubjectFilter)}` : '';
      const res = await apiFetch(`/api/teacher/notes${param}`);
      if (!res.ok) throw new Error('Failed to load teacher notes');
      return res.json();
    },
    staleTime: 45 * 1000,
  });

  // 4. Fetch Teacher Assignments (scoped to authenticated teacher)
  const {
    data: assignmentsData,
    isLoading: isAssignmentsLoading,
    refetch: refetchAssignments,
  } = useQuery<{ assignments: TeacherAssignment[] }>({
    queryKey: ['teacher-assignments', user?.studentId, selectedSubjectFilter],
    queryFn: async () => {
      const param = selectedSubjectFilter !== 'all' ? `?subject=${encodeURIComponent(selectedSubjectFilter)}` : '';
      const res = await apiFetch(`/api/teacher/assignments${param}`);
      if (!res.ok) throw new Error('Failed to load teacher assignments');
      return res.json();
    },
    staleTime: 45 * 1000,
  });

  // Refresh all teacher materials data
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const refreshTasks: Promise<unknown>[] = [
      refetchInit(),
      refetchNotes(),
      refetchAssignments(),
    ];
    if (!hasInitSubjects) {
      refreshTasks.push(refetchSubjects());
    }
    await Promise.allSettled(refreshTasks);
    setRefreshing(false);
  }, [refetchInit, refetchNotes, refetchAssignments, hasInitSubjects, refetchSubjects]);

  // Compute counts
  const subjectsCount = assignedSubjects.length;
  const notesCount = notesData?.notes?.length ?? (initData?.stats?.uploadedNotesCount ?? 0);
  const assignmentsCount = assignmentsData?.assignments?.length ?? (initData?.stats?.createdAssignmentsCount ?? 0);

  // Filtered lists based on searchQuery
  const filteredSubjects = useMemo(() => {
    if (!searchQuery.trim()) return assignedSubjects;
    const q = searchQuery.toLowerCase().trim();
    return assignedSubjects.filter(
      (s) =>
        (s.name || s.title || '').toLowerCase().includes(q) ||
        (s.code || '').toLowerCase().includes(q) ||
        `semester ${s.semester}`.includes(q)
    );
  }, [assignedSubjects, searchQuery]);

  const filteredNotes = useMemo(() => {
    const list = notesData?.notes || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (n) =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.originalName || '').toLowerCase().includes(q) ||
        (n.subject || '').toLowerCase().includes(q) ||
        (n.chapter || '').toLowerCase().includes(q)
    );
  }, [notesData?.notes, searchQuery]);

  const filteredAssignments = useMemo(() => {
    const list = assignmentsData?.assignments || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (a) =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.subject || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.language || '').toLowerCase().includes(q)
    );
  }, [assignmentsData?.assignments, searchQuery]);

  // Action handlers
  const handleOpenUpload = (subjectTitle?: string) => {
    setUploadPresetSubject(subjectTitle);
    setUploadModalOpen(true);
  };

  const handleDownloadAndShare = async (note: TeacherNote) => {
    try {
      setDownloadingId(note.id);
      const baseUrl = await getBaseUrl();
      const fileUrl = `${baseUrl}/api/files/download/${note.id}`;
      const localUri = `${FileSystem.cacheDirectory}${note.originalName || `note_${note.id}.pdf`}`;

      const downloadResult = await FileSystem.downloadAsync(fileUrl, localUri);
      if (downloadResult.status === 200 && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(downloadResult.uri);
      } else {
        Alert.alert('Download Complete', `File saved to ${downloadResult.uri}`);
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Unable to download file.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePreviewNote = (note: TeacherNote) => {
    router.push({
      pathname: '/material/[id]',
      params: { id: note.id },
    } as any);
  };

  const isCurrentLoading =
    activeTab === 'subjects' ? isSubjectsLoading || isInitLoading :
    activeTab === 'notes' ? isNotesLoading :
    isAssignmentsLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 1. Header Bar */}
      <View style={[styles.header, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text variant="xl" weight="800" style={{ color: colors.text, letterSpacing: -0.5 }}>
            My Materials
          </Text>
          <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
            Faculty teaching workspace & course assets
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => router.push('/attendance' as any)}
            style={[styles.uploadButton, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Open classroom attendance"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="checkbox-outline" size={16} color={colors.text} style={{ marginRight: 5 }} />
            <Text variant="xs" weight="700" style={{ color: colors.text }}>
              Attendance
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleOpenUpload()}
            style={[styles.uploadButton, { backgroundColor: colors.text, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Upload note"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="cloud-upload-outline" size={16} color={colors.background} style={{ marginRight: 6 }} />
            <Text variant="xs" weight="700" style={{ color: colors.background }}>
              Upload
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Top Segmented Tab Switcher */}
      <View style={[styles.tabBar, { borderBottomColor: colors.borderSubtle }]}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'subjects' && styles.tabButtonActive,
            activeTab === 'subjects' && { borderColor: colors.text },
          ]}
          onPress={() => {
            setActiveTab('subjects');
            setSelectedSubjectFilter('all');
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'subjects' }}
        >
          <Ionicons
            name={activeTab === 'subjects' ? 'school' : 'school-outline'}
            size={15}
            color={activeTab === 'subjects' ? colors.text : colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text
            variant="sm"
            weight={activeTab === 'subjects' ? '700' : '500'}
            style={{ color: activeTab === 'subjects' ? colors.text : colors.textSecondary }}
          >
            My Subjects ({subjectsCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'notes' && styles.tabButtonActive,
            activeTab === 'notes' && { borderColor: colors.text },
          ]}
          onPress={() => setActiveTab('notes')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'notes' }}
        >
          <Ionicons
            name={activeTab === 'notes' ? 'document-text' : 'document-text-outline'}
            size={15}
            color={activeTab === 'notes' ? colors.text : colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text
            variant="sm"
            weight={activeTab === 'notes' ? '700' : '500'}
            style={{ color: activeTab === 'notes' ? colors.text : colors.textSecondary }}
          >
            My Notes ({notesCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'assignments' && styles.tabButtonActive,
            activeTab === 'assignments' && { borderColor: colors.text },
          ]}
          onPress={() => setActiveTab('assignments')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'assignments' }}
        >
          <Ionicons
            name={activeTab === 'assignments' ? 'code-slash' : 'code-slash-outline'}
            size={15}
            color={activeTab === 'assignments' ? colors.text : colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text
            variant="sm"
            weight={activeTab === 'assignments' ? '700' : '500'}
            style={{ color: activeTab === 'assignments' ? colors.text : colors.textSecondary }}
          >
            Assignments ({assignmentsCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* 3. Search and Subject Filter Bar (when on Notes or Assignments) */}
      <View style={styles.filterSection}>
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={
              activeTab === 'subjects'
                ? 'Search assigned subjects…'
                : activeTab === 'notes'
                ? 'Search my uploaded notes…'
                : 'Search assignments…'
            }
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {activeTab !== 'subjects' && assignedSubjects.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subjectPillsContainer}
            style={{ marginTop: 10 }}
          >
            <TouchableOpacity
              onPress={() => setSelectedSubjectFilter('all')}
              style={[
                styles.subjectPill,
                {
                  backgroundColor: selectedSubjectFilter === 'all' ? colors.text : colors.surfaceRaised,
                  borderColor: selectedSubjectFilter === 'all' ? colors.text : colors.border,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="700"
                style={{
                  color: selectedSubjectFilter === 'all' ? colors.background : colors.textSecondary,
                }}
              >
                All Subjects
              </Text>
            </TouchableOpacity>

            {assignedSubjects.map((sub) => {
              const subName = sub.name || sub.title || sub.code;
              const isSelected = selectedSubjectFilter.toLowerCase() === subName.toLowerCase();
              return (
                <TouchableOpacity
                  key={sub.id || sub.code}
                  onPress={() => setSelectedSubjectFilter(isSelected ? 'all' : subName)}
                  style={[
                    styles.subjectPill,
                    {
                      backgroundColor: isSelected ? colors.text : colors.surfaceRaised,
                      borderColor: isSelected ? colors.text : colors.border,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{
                      color: isSelected ? colors.background : colors.textSecondary,
                    }}
                  >
                    {sub.code ? `[${sub.code}] ` : ''}{subName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* 4. Content Area with Pull-to-Refresh & Adaptive Nav Scroll */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 110 }]}
        onScroll={handleNavScroll}
        scrollEventThrottle={scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.text}
            colors={[colors.text]}
          />
        }
      >
        {isCurrentLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
              Loading materials…
            </Text>
          </View>
        ) : activeTab === 'subjects' ? (
          /* SECTION A: MY ASSIGNED SUBJECTS */
          filteredSubjects.length === 0 ? (
            <EmptyState
              icon="school-outline"
              title={searchQuery ? 'No matching subjects' : 'No subjects assigned'}
              description={
                searchQuery
                  ? 'Try a different search keyword.'
                  : 'You have not been assigned any subjects yet. Contact the academic administrator to configure your course allocations.'
              }
            />
          ) : (
            filteredSubjects.map((subject) => {
              const subTitle = subject.name || subject.title || 'Course Subject';
              return (
                <Card
                  key={subject.id || subject.code}
                  variant="elevated"
                  style={[styles.materialCard, { borderColor: colors.border }]}
                >
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {subject.code && (
                            <View
                              style={[
                                styles.codeBadge,
                                { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                              ]}
                            >
                              <Text variant="xs" weight="700" style={{ color: colors.text }}>
                                {subject.code}
                              </Text>
                            </View>
                          )}
                          <Badge
                            label={`Semester ${subject.semester}`}
                            variant="neutral"
                            size="sm"
                          />
                        </View>
                        <TouchableOpacity
                          activeOpacity={0.75}
                          onPress={() =>
                            router.push({
                              pathname: '/syllabus',
                              params: {
                                course: subject.code || subTitle,
                                semester: String(subject.semester),
                                fromLibrary: '1',
                              },
                            } as any)
                          }
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            borderWidth: 1,
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                          }}
                        >
                          <Ionicons name="book-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                          <Text variant="xs" weight="700" style={{ color: colors.textSecondary, fontSize: 11 }}>
                            View Syllabus
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <Text variant="md" weight="700" style={{ color: colors.text }}>
                        {subTitle}
                      </Text>
                      <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                        {subject.department || 'BIT'} Department • {subject.creditHours || 3} Credit Hours
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.cardDivider, { backgroundColor: colors.borderSubtle }]} />

                  <View style={[styles.cardActionsRow, { flexWrap: 'wrap' }]}>
                    <TouchableOpacity
                      style={[styles.cardActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1 }]}
                      onPress={() =>
                        router.push({
                          pathname: '/attendance',
                          params: {
                            subjectId: String(subject.id || subject.code),
                            subjectCode: subject.code || '',
                          },
                        } as any)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Take attendance for ${subTitle}`}
                    >
                      <Ionicons name="checkbox-outline" size={14} color={colors.text} style={{ marginRight: 5 }} />
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Attendance
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.cardActionBtn, { backgroundColor: colors.surfaceSubtle }]}
                      onPress={() => {
                        setSelectedSubjectFilter(subTitle);
                        setActiveTab('notes');
                      }}
                    >
                      <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} style={{ marginRight: 5 }} />
                      <Text variant="xs" weight="600" color="secondary">
                        View Notes
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.cardActionBtn, { backgroundColor: colors.surfaceSubtle }]}
                      onPress={() => {
                        setSelectedSubjectFilter(subTitle);
                        setActiveTab('assignments');
                      }}
                    >
                      <Ionicons name="code-slash-outline" size={14} color={colors.textSecondary} style={{ marginRight: 5 }} />
                      <Text variant="xs" weight="600" color="secondary">
                        Assignments
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.cardActionBtn, { backgroundColor: colors.text }]}
                      onPress={() => handleOpenUpload(subTitle)}
                    >
                      <Ionicons name="cloud-upload-outline" size={14} color={colors.background} style={{ marginRight: 5 }} />
                      <Text variant="xs" weight="700" style={{ color: colors.background }}>
                        Upload Note
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )
        ) : activeTab === 'notes' ? (
          /* SECTION B: MY UPLOADED NOTES */
          filteredNotes.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title={searchQuery ? 'No matching notes' : 'No uploaded notes'}
              description={
                searchQuery
                  ? 'No notes match your search criteria.'
                  : selectedSubjectFilter !== 'all'
                  ? `You haven't uploaded any notes for ${selectedSubjectFilter} yet.`
                  : 'You have not uploaded any lecture slides or reference materials yet.'
              }
              actionTitle="Upload Note"
              onAction={() => handleOpenUpload(selectedSubjectFilter !== 'all' ? selectedSubjectFilter : undefined)}
            />
          ) : (
            filteredNotes.map((note) => {
              const isDownloading = downloadingId === note.id;
              return (
                <Card
                  key={note.id}
                  variant="elevated"
                  style={[styles.materialCard, { borderColor: colors.border }]}
                >
                  <TouchableOpacity
                    onPress={() => handlePreviewNote(note)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.fileIconBox,
                          { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                        ]}
                      >
                        <Ionicons
                          name={getFileIcon(note.originalName || note.storedName)}
                          size={24}
                          color={colors.text}
                        />
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text variant="md" weight="700" numberOfLines={2} style={{ color: colors.text }}>
                          {note.title || note.originalName}
                        </Text>
                        <Text variant="xs" color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
                          {note.originalName}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <Badge label={note.subject} variant="neutral" size="sm" />
                          {note.chapter ? (
                            <Badge label={note.chapter} variant="outline" size="sm" />
                          ) : null}
                          {note.semester ? (
                            <Badge label={note.semester} variant="neutral" size="sm" />
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <View style={[styles.cardDivider, { backgroundColor: colors.borderSubtle }]} />

                  <View style={styles.noteMetaRow}>
                    <Text variant="xs" color="secondary">
                      {formatFileSize(note.sizeBytes)} • {formatTimeAgo(note.uploadedAt)}
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        style={[styles.iconButton, { backgroundColor: colors.surfaceSubtle }]}
                        onPress={() => handlePreviewNote(note)}
                        accessibilityLabel="Preview note"
                      >
                        <Ionicons name="eye-outline" size={15} color={colors.text} />
                        <Text variant="xs" weight="600" style={{ color: colors.text, marginLeft: 4 }}>
                          Preview
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.iconButton, { backgroundColor: colors.surfaceSubtle }]}
                        onPress={() => handleDownloadAndShare(note)}
                        disabled={isDownloading}
                        accessibilityLabel="Share note"
                      >
                        {isDownloading ? (
                          <ActivityIndicator size="small" color={colors.text} />
                        ) : (
                          <>
                            <Ionicons name="share-outline" size={15} color={colors.text} />
                            <Text variant="xs" weight="600" style={{ color: colors.text, marginLeft: 4 }}>
                              Share
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              );
            })
          )
        ) : (
          /* SECTION C: MY ASSIGNMENTS */
          filteredAssignments.length === 0 ? (
            <EmptyState
              icon="code-slash-outline"
              title={searchQuery ? 'No matching assignments' : 'No assignments created'}
              description={
                searchQuery
                  ? 'No assignments match your search keywords.'
                  : selectedSubjectFilter !== 'all'
                  ? `No assignments found for ${selectedSubjectFilter}.`
                  : 'You have not created any lab assignments or coding exercises yet.'
              }
            />
          ) : (
            filteredAssignments.map((assignment) => {
              const qCount = assignment.questionCount ?? assignment.questions_count ?? 0;
              const subCount = assignment.submissionCount ?? assignment.submissions_count ?? 0;

              return (
                <Card
                  key={assignment.id}
                  variant="elevated"
                  style={[styles.materialCard, { borderColor: colors.border }]}
                >
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                        <Badge label={assignment.subject} variant="neutral" size="sm" />
                        {assignment.language ? (
                          <Badge label={assignment.language} variant="outline" size="sm" />
                        ) : null}
                        <Badge label={`Sem ${assignment.semester}`} variant="neutral" size="sm" />
                      </View>

                      <Text variant="md" weight="700" style={{ color: colors.text }}>
                        {assignment.title}
                      </Text>

                      {assignment.description ? (
                        <Text variant="xs" color="secondary" numberOfLines={2} style={{ marginTop: 4 }}>
                          {assignment.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={[styles.cardDivider, { backgroundColor: colors.borderSubtle }]} />

                  <View style={styles.assignmentStatsRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="help-circle-outline" size={14} color={colors.textSecondary} style={{ marginRight: 4 }} />
                        <Text variant="xs" weight="600" color="secondary">
                          {qCount} Questions
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="people-outline" size={14} color={colors.textSecondary} style={{ marginRight: 4 }} />
                        <Text variant="xs" weight="600" color="secondary">
                          {subCount} Submissions
                        </Text>
                      </View>
                    </View>

                    <Text variant="xs" color="secondary">
                      {formatDate(assignment.createdAt)}
                    </Text>
                  </View>
                </Card>
              );
            })
          )
        )}
      </ScrollView>

      {/* 5. Upload Note Modal (locked to assigned subjects) */}
      <UploadNoteModal
        visible={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        initialSubjectTitle={uploadPresetSubject}
        onSuccess={() => {
          setUploadModalOpen(false);
          refetchNotes();
          refetchInit();
          queryClient.invalidateQueries({ queryKey: ['campus-feed'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomWidth: 2,
  },
  filterSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  subjectPillsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
  },
  subjectPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  materialCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#121212',
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  codeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  cardDivider: {
    height: 1,
    marginVertical: 12,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  fileIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  noteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  assignmentStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
