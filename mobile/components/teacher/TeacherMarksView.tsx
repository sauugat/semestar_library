import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/services/api';

export const VALID_EXAM_TYPES = ['Mid-Term Exam', 'Pre-Board Exam', 'Final Exam'] as const;
export type ExamType = (typeof VALID_EXAM_TYPES)[number];

export interface TeacherSubjectItem {
  id: string;
  code: string;
  name: string;
  title?: string;
  semester: number;
  department?: string;
  creditHours?: number;
  cohorts?: {
    id: string;
    slotCode: string;
    displayName: string;
    currentSemester: number;
  }[];
  exams?: {
    examType: string;
    configured: boolean;
    maxMarks: number | null;
    enteredCount: number;
    draftCount: number;
    publishedCount: number;
    status: string;
  }[];
}

export interface TeacherMarksContextResponse {
  subjects: TeacherSubjectItem[];
  examTypes?: string[];
  role?: string;
  userId?: string;
}

export interface StudentRosterRecord {
  studentId: string;
  rollNumber: string;
  name: string;
  username?: string | null;
  role?: string;
  department?: string;
  cohortId?: string;
  cohortName?: string;
  markId?: string | null;
  isAbsent: boolean;
  obtainedMarks: number | null;
  maxMarks: number | null;
  percentage: number | null;
  formattedPercentage: string;
  status: 'draft' | 'published' | null;
  entryStatus: 'missing' | 'absent' | 'draft' | 'published';
  isMissing: boolean;
  publishedAt?: string | null;
  updatedAt?: string | null;
}

export interface RosterSummary {
  totalStudents: number;
  enteredCount: number;
  missingCount: number;
  draftCount: number;
  publishedCount: number;
  isConfigured: boolean;
  maxMarks: number | null;
  isPublished: boolean;
  hasPublishedMarks: boolean;
  hasDraftMarks: boolean;
  publicationStatus: string;
  averageMarks: number | null;
  averagePercentage: number | null;
  highestMarks: number | null;
  lowestMarks: number | null;
}

export interface SubjectMarksRosterResponse {
  subject: TeacherSubjectItem;
  semesterNo: number;
  cohort?: any;
  cohorts?: any[];
  examType: ExamType;
  examTypes: ExamType[];
  examConfig: {
    id: string | null;
    maxMarks: number | null;
    configured: boolean;
  };
  students: StudentRosterRecord[];
  summary: RosterSummary;
}

interface LocalStudentMarkState {
  marks: string; // string for input control
  isAbsent: boolean;
  isDirty?: boolean;
}

export function TeacherMarksView({
  initialSubjectId,
  initialExamType,
  onClose,
}: {
  initialSubjectId?: string;
  initialExamType?: ExamType;
  onClose?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, radii, isDark } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(initialSubjectId || null);
  const [selectedExamType, setSelectedExamType] = useState<ExamType>(initialExamType || 'Mid-Term Exam');
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'entered' | 'missing' | 'absent'>('all');

  // Local Mark State: studentId -> { marks: string, isAbsent: boolean }
  const [localMarks, setLocalMarks] = useState<Record<string, LocalStudentMarkState>>({});
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // Max Marks Config Modal state
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configInputMax, setConfigInputMax] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Edit Published Reason Modal state
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [editReason, setEditReason] = useState('');

  // 1. Fetch Teacher Context
  const {
    data: contextData,
    isLoading: isContextLoading,
    refetch: refetchContext,
  } = useQuery<TeacherMarksContextResponse>({
    queryKey: ['teacherMarksContext', user?.studentId],
    queryFn: async () => {
      return await api.get<TeacherMarksContextResponse>('/api/marks/teacher/context');
    },
    staleTime: 60 * 1000,
  });

  const subjects = useMemo(() => contextData?.subjects || [], [contextData]);

  // Set default subject if not set
  useEffect(() => {
    if (!selectedSubjectId && subjects.length > 0) {
      if (initialSubjectId) {
        const found = subjects.find(
          (s) =>
            s.id === initialSubjectId ||
            s.code.toLowerCase() === initialSubjectId.toLowerCase()
        );
        if (found) {
          setSelectedSubjectId(found.id);
          return;
        }
      }
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId, initialSubjectId]);

  const activeSubject = useMemo(() => {
    return subjects.find((s) => s.id === selectedSubjectId) || null;
  }, [subjects, selectedSubjectId]);

  // Cohort options for the selected subject
  const cohortOptions = useMemo(() => {
    return activeSubject?.cohorts || [];
  }, [activeSubject]);

  useEffect(() => {
    if (cohortOptions.length > 0 && !selectedCohortId) {
      setSelectedCohortId(cohortOptions[0].id);
    } else if (cohortOptions.length === 0) {
      setSelectedCohortId(null);
    }
  }, [cohortOptions, selectedCohortId]);

  // 2. Fetch Roster for Selected Subject + Exam + Cohort
  const rosterQueryKey = useMemo(() => {
    return [
      'marksRoster',
      selectedSubjectId,
      selectedExamType,
      selectedCohortId || 'all',
    ];
  }, [selectedSubjectId, selectedExamType, selectedCohortId]);

  const {
    data: rosterData,
    isLoading: isRosterLoading,
    isRefetching: isRosterRefetching,
    refetch: refetchRoster,
  } = useQuery<SubjectMarksRosterResponse>({
    queryKey: rosterQueryKey,
    queryFn: async () => {
      if (!selectedSubjectId) {
        throw new Error('No subject selected');
      }
      let url = `/api/marks/roster?subjectId=${encodeURIComponent(
        selectedSubjectId
      )}&examType=${encodeURIComponent(selectedExamType)}`;
      if (selectedCohortId) {
        url += `&cohortId=${encodeURIComponent(selectedCohortId)}`;
      }
      return await api.get<SubjectMarksRosterResponse>(url);
    },
    enabled: Boolean(selectedSubjectId && selectedExamType),
    staleTime: 10 * 1000,
  });

  // Sync local marks with incoming roster data
  useEffect(() => {
    if (!rosterData?.students) return;

    const initialMarks: Record<string, LocalStudentMarkState> = {};
    for (const student of rosterData.students) {
      initialMarks[student.studentId] = {
        marks:
          student.obtainedMarks !== null && student.obtainedMarks !== undefined
            ? String(student.obtainedMarks)
            : '',
        isAbsent: Boolean(student.isAbsent),
        isDirty: false,
      };
    }
    setLocalMarks(initialMarks);

    if (rosterData.summary?.maxMarks) {
      setConfigInputMax(String(rosterData.summary.maxMarks));
    }
  }, [rosterData]);

  const maxMarks = useMemo(() => {
    return (
      rosterData?.summary?.maxMarks ??
      rosterData?.examConfig?.maxMarks ??
      null
    );
  }, [rosterData]);

  const isConfigured = Boolean(maxMarks && maxMarks > 0);
  const isAlreadyPublished = Boolean(rosterData?.summary?.isPublished);

  // Student list filtered by search & status
  const filteredStudents = useMemo(() => {
    const list = rosterData?.students || [];
    const query = searchQuery.trim().toLowerCase();

    return list.filter((student) => {
      // Search matching
      if (query) {
        const nameMatch = (student.name || '').toLowerCase().includes(query);
        const rollMatch = (student.rollNumber || student.studentId || '')
          .toLowerCase()
          .includes(query);
        const userMatch = (student.username || '').toLowerCase().includes(query);
        if (!nameMatch && !rollMatch && !userMatch) return false;
      }

      // Filter matching
      const current = localMarks[student.studentId] || {
        marks: '',
        isAbsent: student.isAbsent,
      };
      if (filterMode === 'absent') {
        return current.isAbsent;
      }
      if (filterMode === 'entered') {
        return (
          (current.marks.trim() !== '' && !current.isAbsent) || current.isAbsent
        );
      }
      if (filterMode === 'missing') {
        return current.marks.trim() === '' && !current.isAbsent;
      }

      return true;
    });
  }, [rosterData?.students, searchQuery, filterMode, localMarks]);

  // Handle Mark Change for a student
  const handleMarkChange = useCallback(
    (studentId: string, text: string) => {
      // Clean numeric string
      const sanitized = text.replace(/[^0-9.]/g, '');
      setLocalMarks((prev) => ({
        ...prev,
        [studentId]: {
          marks: sanitized,
          isAbsent: false,
          isDirty: true,
        },
      }));
    },
    []
  );

  // Handle Absent Toggle
  const handleToggleAbsent = useCallback((studentId: string) => {
    setLocalMarks((prev) => {
      const current = prev[studentId] || { marks: '', isAbsent: false };
      const willBeAbsent = !current.isAbsent;
      return {
        ...prev,
        [studentId]: {
          marks: willBeAbsent ? '' : current.marks,
          isAbsent: willBeAbsent,
          isDirty: true,
        },
      };
    });
  }, []);

  // Quick Action: Mark all currently missing students absent
  const handleMarkRemainingAbsent = useCallback(() => {
    const students = rosterData?.students || [];
    let count = 0;
    setLocalMarks((prev) => {
      const next = { ...prev };
      for (const student of students) {
        const item = next[student.studentId] || { marks: '', isAbsent: false };
        if (!item.isAbsent && item.marks.trim() === '') {
          next[student.studentId] = {
            marks: '',
            isAbsent: true,
            isDirty: true,
          };
          count++;
        }
      }
      return next;
    });

    if (count > 0) {
      Alert.alert(
        'Updated',
        `Marked ${count} pending student${count > 1 ? 's' : ''} as Absent.`
      );
    } else {
      Alert.alert('Notice', 'No missing students found to mark absent.');
    }
  }, [rosterData?.students]);

  // Prepare submission records
  const buildRecordsPayload = useCallback(() => {
    const students = rosterData?.students || [];
    const records = [];

    for (const student of students) {
      const item = localMarks[student.studentId];
      if (!item) continue;

      if (item.isAbsent) {
        records.push({
          studentId: student.studentId,
          obtainedMarks: null,
          isAbsent: true,
        });
      } else if (item.marks.trim() !== '') {
        const parsed = Number(item.marks);
        if (Number.isFinite(parsed)) {
          records.push({
            studentId: student.studentId,
            obtainedMarks: parsed,
            isAbsent: false,
          });
        }
      }
    }

    return records;
  }, [rosterData?.students, localMarks]);

  // Validation: check if any entered marks exceed maxMarks
  const checkExceedsMax = useCallback(() => {
    if (!maxMarks) return null;
    const students = rosterData?.students || [];
    for (const student of students) {
      const item = localMarks[student.studentId];
      if (item && !item.isAbsent && item.marks.trim() !== '') {
        const val = Number(item.marks);
        if (val > maxMarks) {
          return {
            studentName: student.name,
            marks: val,
            maxMarks,
          };
        }
      }
    }
    return null;
  }, [rosterData?.students, localMarks, maxMarks]);

  // 3. Save Draft
  const handleSaveDraft = async () => {
    if (!selectedSubjectId || !selectedExamType) return;

    if (!isConfigured) {
      Alert.alert(
        'Configure Maximum Marks',
        'Please set the maximum marks for this exam before saving scores.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set Max Marks', onPress: () => setConfigModalOpen(true) },
        ]
      );
      return;
    }

    const invalid = checkExceedsMax();
    if (invalid) {
      Alert.alert(
        'Invalid Mark Value',
        `Entered marks for ${invalid.studentName} (${invalid.marks}) exceed maximum marks (${invalid.maxMarks}). Please correct before saving.`
      );
      return;
    }

    const records = buildRecordsPayload();
    if (records.length === 0) {
      Alert.alert(
        'Empty Submission',
        'Please enter marks or mark absent for at least one student.'
      );
      return;
    }

    try {
      setIsSavingDraft(true);
      await api.post('/api/marks/draft', {
        subjectId: selectedSubjectId,
        examType: selectedExamType,
        cohortId: selectedCohortId,
        maxMarks,
        records,
      });

      await queryClient.invalidateQueries({ queryKey: rosterQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['teacherMarksContext'] });
      Alert.alert('Draft Saved', 'Draft marks have been successfully saved.');
    } catch (err: any) {
      Alert.alert(
        'Save Failed',
        err?.message || 'Unable to save draft marks. Please retry.'
      );
    } finally {
      setIsSavingDraft(false);
    }
  };

  // 4. Publish Results
  const handlePublishPress = () => {
    if (!selectedSubjectId || !selectedExamType) return;

    if (!isConfigured) {
      Alert.alert(
        'Configure Maximum Marks',
        'Please set the maximum marks before publishing results.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set Max Marks', onPress: () => setConfigModalOpen(true) },
        ]
      );
      return;
    }

    const invalid = checkExceedsMax();
    if (invalid) {
      Alert.alert(
        'Invalid Mark Value',
        `Entered marks for ${invalid.studentName} (${invalid.marks}) exceed maximum marks (${invalid.maxMarks}). Please correct before publishing.`
      );
      return;
    }

    const records = buildRecordsPayload();
    if (records.length === 0) {
      Alert.alert(
        'No Marks to Publish',
        'Please enter marks or mark absent for at least one student before publishing.'
      );
      return;
    }

    if (isAlreadyPublished) {
      // Editing already published marks -> Prompt for reason
      setReasonModalOpen(true);
      return;
    }

    // First time publishing -> confirm dialog
    Alert.alert(
      'Publish Exam Results',
      `Are you sure you want to publish ${selectedExamType} results for ${records.length} students in ${activeSubject?.code || 'this subject'}?\n\nStudents will immediately be able to view their scores and download report cards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish Now',
          style: 'default',
          onPress: () => executePublish(null),
        },
      ]
    );
  };

  const executePublish = async (reasonText: string | null) => {
    if (!selectedSubjectId || !selectedExamType) return;
    const records = buildRecordsPayload();

    try {
      setIsPublishing(true);
      await api.post('/api/marks/publish', {
        subjectId: selectedSubjectId,
        examType: selectedExamType,
        cohortId: selectedCohortId,
        maxMarks,
        records,
        reason: reasonText || undefined,
      });

      await queryClient.invalidateQueries({ queryKey: rosterQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['teacherMarksContext'] });
      setReasonModalOpen(false);
      setEditReason('');

      Alert.alert(
        'Results Published',
        `${selectedExamType} results have been published successfully! Students can now view their official grades.`
      );
    } catch (err: any) {
      Alert.alert(
        'Publishing Failed',
        err?.message || 'Unable to publish marks. Please check input values.'
      );
    } finally {
      setIsPublishing(false);
    }
  };

  // 5. Save Exam Configuration (Max Marks)
  const handleSaveConfig = async () => {
    const parsed = Number(configInputMax);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Invalid Value', 'Maximum marks must be a number greater than 0.');
      return;
    }

    try {
      setIsSavingConfig(true);
      await api.post('/api/marks/config', {
        subjectId: selectedSubjectId,
        examType: selectedExamType,
        maxMarks: parsed,
        reason: 'Configured maximum exam marks in mobile app',
      });

      await queryClient.invalidateQueries({ queryKey: rosterQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['teacherMarksContext'] });
      setConfigModalOpen(false);
      Alert.alert('Success', `Maximum marks set to ${parsed}.`);
    } catch (err: any) {
      Alert.alert('Configuration Error', err?.message || 'Failed to update maximum marks.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Compute live statistics for header summary
  const liveStats = useMemo(() => {
    const students = rosterData?.students || [];
    let entered = 0;
    let absent = 0;
    let sumMarks = 0;

    for (const s of students) {
      const item = localMarks[s.studentId];
      if (item?.isAbsent) {
        absent++;
        entered++;
      } else if (item?.marks.trim() !== '') {
        const val = Number(item.marks);
        if (Number.isFinite(val)) {
          entered++;
          sumMarks += val;
        }
      }
    }

    const evaluatedStudents = entered - absent;
    const avgScore =
      evaluatedStudents > 0
        ? Math.round((sumMarks / evaluatedStudents) * 10) / 10
        : null;
    const avgPct =
      avgScore !== null && maxMarks && maxMarks > 0
        ? Math.round((avgScore / maxMarks) * 100)
        : null;

    return {
      total: students.length,
      entered,
      missing: Math.max(0, students.length - entered),
      absent,
      avgScore,
      avgPct,
    };
  }, [rosterData?.students, localMarks, maxMarks]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.backBtn, { backgroundColor: colors.surfaceSubtle }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text variant="md" weight="700" numberOfLines={1}>
              Marks Entry
            </Text>
            <Text variant="xs" color="secondary" numberOfLines={1}>
              {activeSubject ? `${activeSubject.code} • Sem ${activeSubject.semester}` : 'Faculty Evaluation'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => refetchRoster()}
          style={[styles.iconButton, { backgroundColor: colors.surfaceSubtle }]}
          accessibilityLabel="Refresh"
        >
          <Ionicons
            name="refresh-outline"
            size={18}
            color={isRosterRefetching ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRosterRefetching}
            onRefresh={() => {
              refetchContext();
              refetchRoster();
            }}
            tintColor={colors.text}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Subject Selector Chips */}
        <View style={styles.section}>
          <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
            ASSIGNED SUBJECT
          </Text>
          {isContextLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
          ) : subjects.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text variant="sm" color="secondary">
                No teaching subjects assigned to your account.
              </Text>
            </Card>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}
            >
              {subjects.map((sub) => {
                const isSelected = sub.id === selectedSubjectId;
                return (
                  <TouchableOpacity
                    key={sub.id}
                    onPress={() => setSelectedSubjectId(sub.id)}
                    style={[
                      styles.subjectChip,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: isSelected ? '#FFFFFF' : colors.text }}
                    >
                      {sub.code}
                    </Text>
                    <Text
                      variant="xs"
                      style={{
                        color: isSelected ? 'rgba(255,255,255,0.85)' : colors.textSecondary,
                        marginLeft: 4,
                        fontSize: 11,
                      }}
                    >
                      Sem {sub.semester}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* 2. Exam Type Tabs */}
        <View style={styles.section}>
          <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
            EXAM TYPE
          </Text>
          <View style={[styles.examTabsContainer, { backgroundColor: colors.surfaceSubtle }]}>
            {VALID_EXAM_TYPES.map((type) => {
              const isSelected = selectedExamType === type;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => setSelectedExamType(type)}
                  style={[
                    styles.examTab,
                    isSelected && [styles.examTabActive, { backgroundColor: colors.surface }],
                  ]}
                >
                  <Text
                    variant="xs"
                    weight={isSelected ? '700' : '500'}
                    style={{ color: isSelected ? colors.text : colors.textSecondary }}
                  >
                    {type.replace(' Exam', '')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. Cohort Selector (if available) */}
        {cohortOptions.length > 1 && (
          <View style={styles.section}>
            <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
              COHORT / SECTION
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
              {cohortOptions.map((cohort) => {
                const isSelected = cohort.id === selectedCohortId;
                return (
                  <TouchableOpacity
                    key={cohort.id}
                    onPress={() => setSelectedCohortId(cohort.id)}
                    style={[
                      styles.cohortChip,
                      {
                        backgroundColor: isSelected ? colors.text : colors.surfaceSubtle,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="600"
                      style={{ color: isSelected ? colors.background : colors.text }}
                    >
                      {cohort.displayName || cohort.slotCode.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 4. Configuration & Status Card */}
        <Card
          style={[
            styles.configCard,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: isAlreadyPublished ? colors.success || '#10b981' : colors.border,
            },
          ]}
        >
          <View style={styles.configHeaderRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Text variant="sm" weight="700">
                  {selectedExamType}
                </Text>
                <Badge
                  label={isAlreadyPublished ? 'Published' : isConfigured ? 'Draft Mode' : 'Not Configured'}
                  variant={isAlreadyPublished ? 'success' : isConfigured ? 'neutral' : 'outline'}
                  size="sm"
                />
              </View>
              <Text variant="xs" color="secondary">
                {isConfigured
                  ? `Maximum Marks: ${maxMarks}`
                  : 'Maximum marks required to begin evaluation'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setConfigModalOpen(true)}
              style={[
                styles.configActionBtn,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                },
              ]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="settings-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
              <Text variant="xs" weight="700" style={{ color: colors.text }}>
                {isConfigured ? 'Edit Max' : 'Set Max'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Metrics Grid */}
          <View style={[styles.metricsGrid, { borderTopColor: colors.border }]}>
            <View style={styles.metricItem}>
              <Text variant="xs" color="secondary" weight="600" style={{ fontSize: 10 }}>
                TOTAL
              </Text>
              <Text variant="sm" weight="700">
                {liveStats.total}
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="xs" color="secondary" weight="600" style={{ fontSize: 10 }}>
                ENTERED
              </Text>
              <Text variant="sm" weight="700" style={{ color: colors.primary }}>
                {liveStats.entered}
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="xs" color="secondary" weight="600" style={{ fontSize: 10 }}>
                MISSING
              </Text>
              <Text
                variant="sm"
                weight="700"
                style={{ color: liveStats.missing > 0 ? colors.warning || '#f59e0b' : colors.text }}
              >
                {liveStats.missing}
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text variant="xs" color="secondary" weight="600" style={{ fontSize: 10 }}>
                CLASS AVG
              </Text>
              <Text variant="sm" weight="700">
                {liveStats.avgPct !== null ? `${liveStats.avgPct}%` : '—'}
              </Text>
            </View>
          </View>
        </Card>

        {/* 5. Student Register / Roster Section */}
        <View style={styles.rosterSectionHeader}>
          <View style={{ flex: 1 }}>
            <Text variant="xs" weight="700" color="secondary" style={styles.sectionLabel}>
              STUDENT ROSTER ({filteredStudents.length})
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleMarkRemainingAbsent}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text variant="xs" weight="700" style={{ color: colors.primary }}>
              Mark Missing Absent
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search & Filter Bar */}
        <View style={styles.searchFilterRow}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <TextInput
              placeholder="Search by name or roll no..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>

          <View style={styles.filterPills}>
            {(['all', 'entered', 'missing', 'absent'] as const).map((mode) => {
              const isSelected = filterMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setFilterMode(mode)}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: isSelected ? colors.text : colors.surfaceSubtle,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{
                      color: isSelected ? colors.background : colors.textSecondary,
                      fontSize: 10,
                    }}
                  >
                    {mode.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Roster List */}
        {isRosterLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
              Loading student register...
            </Text>
          </View>
        ) : filteredStudents.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No Students Found"
            description={
              searchQuery
                ? `No students matching "${searchQuery}".`
                : 'No enrolled students found for this subject and cohort.'
            }
          />
        ) : (
          filteredStudents.map((student) => {
            const current = localMarks[student.studentId] || {
              marks: '',
              isAbsent: false,
            };
            const numericVal = Number(current.marks);
            const isExceeded =
              maxMarks &&
              !current.isAbsent &&
              current.marks.trim() !== '' &&
              numericVal > maxMarks;
            const pct =
              maxMarks && !current.isAbsent && current.marks.trim() !== '' && !isExceeded
                ? Math.round((numericVal / maxMarks) * 100)
                : null;

            return (
              <Card
                key={student.studentId}
                style={[
                  styles.studentRowCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isExceeded
                      ? colors.error
                      : current.isAbsent
                      ? colors.warning || '#f59e0b'
                      : colors.border,
                  },
                ]}
              >
                <View style={styles.studentInfoRow}>
                  {/* Student Roll & Identity */}
                  <View style={styles.studentIdentity}>
                    <View style={styles.rollBadgeContainer}>
                      <View
                        style={[
                          styles.rollBadge,
                          { backgroundColor: colors.surfaceSubtle },
                        ]}
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.text, fontSize: 11 }}>
                          {student.rollNumber || student.studentId}
                        </Text>
                      </View>
                      {student.cohortName && (
                        <Text variant="xs" color="secondary" numberOfLines={1} style={{ fontSize: 11 }}>
                          {student.cohortName}
                        </Text>
                      )}
                    </View>
                    <Text variant="sm" weight="700" numberOfLines={1} style={{ marginTop: 2 }}>
                      {student.name}
                    </Text>
                  </View>

                  {/* Actions: Numeric Input & Absent Button */}
                  <View style={styles.markEntryControls}>
                    {/* Mark Input */}
                    <View style={styles.inputWrap}>
                      <TextInput
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textSecondary}
                        value={current.isAbsent ? '' : current.marks}
                        editable={!current.isAbsent}
                        onChangeText={(txt) => handleMarkChange(student.studentId, txt)}
                        style={[
                          styles.markTextInput,
                          {
                            backgroundColor: current.isAbsent
                              ? colors.surfaceSubtle
                              : colors.surfaceRaised,
                            borderColor: isExceeded
                              ? colors.error
                              : colors.border,
                            color: current.isAbsent ? colors.textSecondary : colors.text,
                          },
                        ]}
                      />
                      {maxMarks && (
                        <Text variant="xs" color="secondary" style={styles.maxMarksAffix}>
                          /{maxMarks}
                        </Text>
                      )}
                    </View>

                    {/* Absent Toggle Button */}
                    <TouchableOpacity
                      onPress={() => handleToggleAbsent(student.studentId)}
                      style={[
                        styles.absentBtn,
                        {
                          backgroundColor: current.isAbsent
                            ? colors.error
                            : colors.surfaceSubtle,
                          borderColor: current.isAbsent
                            ? colors.error
                            : colors.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${student.name} as ${current.isAbsent ? 'present' : 'absent'}`}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{
                          color: current.isAbsent ? '#FFFFFF' : colors.textSecondary,
                          fontSize: 11,
                        }}
                      >
                        {current.isAbsent ? 'ABSENT' : 'ABS'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Sub row: Validation feedback or percentage */}
                <View style={styles.studentMetaRow}>
                  {isExceeded ? (
                    <Text variant="xs" style={{ color: colors.error, fontSize: 11 }}>
                      Exceeds maximum marks ({maxMarks})
                    </Text>
                  ) : current.isAbsent ? (
                    <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                      Marked as absent for this exam
                    </Text>
                  ) : pct !== null ? (
                    <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                      Scored {numericVal} / {maxMarks} ({pct}%)
                    </Text>
                  ) : (
                    <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                      No marks entered yet
                    </Text>
                  )}

                  {student.status === 'published' && (
                    <View style={styles.publishedIndicator}>
                      <Ionicons name="checkmark-circle" size={12} color={colors.success || '#10b981'} />
                      <Text variant="xs" style={{ color: colors.success || '#10b981', marginLeft: 3, fontSize: 11 }}>
                        Published
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Sticky Bottom Actions Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleSaveDraft}
          disabled={isSavingDraft || isPublishing || isRosterLoading}
          style={[
            styles.secondaryActionBtn,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save Draft Marks"
        >
          {isSavingDraft ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <>
              <Ionicons name="bookmark-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
              <Text variant="sm" weight="700" style={{ color: colors.text }}>
                Save Draft
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handlePublishPress}
          disabled={isSavingDraft || isPublishing || isRosterLoading}
          style={[
            styles.primaryActionBtn,
            {
              backgroundColor: colors.primary,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Publish Examination Results"
        >
          {isPublishing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="send" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text variant="sm" weight="700" style={{ color: '#FFFFFF' }}>
                {isAlreadyPublished ? 'Update Published' : 'Publish Results'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Modal: Set / Edit Maximum Marks */}
      <Modal
        visible={configModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfigModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text variant="md" weight="700">
                Set Maximum Marks
              </Text>
              <TouchableOpacity
                onPress={() => setConfigModalOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text variant="xs" color="secondary" style={{ marginTop: 4, marginBottom: 16 }}>
              Configure the total possible marks for {selectedExamType} in {activeSubject?.code}.
            </Text>

            <View style={{ marginBottom: 16 }}>
              <Text variant="xs" weight="700" color="secondary" style={{ marginBottom: 6 }}>
                MAXIMUM MARKS (E.G. 20, 50, 100)
              </Text>
              <TextInput
                keyboardType="decimal-pad"
                placeholder="50"
                placeholderTextColor={colors.textSecondary}
                value={configInputMax}
                onChangeText={setConfigInputMax}
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />
            </View>

            {/* Quick Presets */}
            <View style={styles.presetRow}>
              {[20, 25, 40, 50, 60, 100].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  onPress={() => setConfigInputMax(String(preset))}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor:
                        configInputMax === String(preset) ? colors.text : colors.surfaceSubtle,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{
                      color:
                        configInputMax === String(preset)
                          ? colors.background
                          : colors.textSecondary,
                      fontSize: 11,
                    }}
                  >
                    {preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setConfigModalOpen(false)}
                style={[styles.modalBtn, { backgroundColor: colors.surfaceSubtle }]}
              >
                <Text variant="sm" weight="600" style={{ color: colors.text }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveConfig}
                disabled={isSavingConfig}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {isSavingConfig ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text variant="sm" weight="700" style={{ color: '#FFFFFF' }}>
                    Save Config
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: Edit Published Reason */}
      <Modal
        visible={reasonModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReasonModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text variant="md" weight="700">
                Reason for Revision
              </Text>
              <TouchableOpacity
                onPress={() => setReasonModalOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text variant="xs" color="secondary" style={{ marginTop: 4, marginBottom: 14 }}>
              These exam results have already been published. Please provide a brief reason for recording this correction in the university audit log.
            </Text>

            <TextInput
              placeholder="e.g. Script re-evaluation, scoring typo fixed"
              placeholderTextColor={colors.textSecondary}
              value={editReason}
              onChangeText={setEditReason}
              style={[
                styles.modalInput,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  color: colors.text,
                  minHeight: 44,
                  marginBottom: 16,
                },
              ]}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setReasonModalOpen(false)}
                style={[styles.modalBtn, { backgroundColor: colors.surfaceSubtle }]}
              >
                <Text variant="sm" weight="600" style={{ color: colors.text }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => executePublish(editReason || 'Authorized teacher revision')}
                disabled={isPublishing}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {isPublishing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text variant="sm" weight="700" style={{ color: '#FFFFFF' }}>
                    Confirm & Publish
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerTitles: {
    flex: 1,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 90,
  },
  section: {
    marginBottom: 14,
  },
  sectionLabel: {
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipsScroll: {
    gap: 8,
    flexDirection: 'row',
  },
  subjectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  examTabsContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
  },
  examTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  examTabActive: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  cohortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  configCard: {
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  configHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  configActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  metricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 10,
  },
  metricItem: {
    alignItems: 'center',
  },
  rosterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  searchFilterRow: {
    marginBottom: 12,
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  filterPills: {
    flexDirection: 'row',
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentRowCard: {
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  studentInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  studentIdentity: {
    flex: 1,
    marginRight: 10,
  },
  rollBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rollBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  markEntryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  markTextInput: {
    width: 60,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 14,
  },
  maxMarksAffix: {
    marginLeft: 4,
    fontSize: 11,
  },
  absentBtn: {
    paddingHorizontal: 8,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  publishedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  secondaryActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtn: {
    flex: 1.3,
    height: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 20,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    padding: 16,
    alignItems: 'center',
  },
});
