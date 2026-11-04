import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/services/api';
import { resolveAppRole } from '@/utils/roles';
import {
  ATTENDANCE_THEME as T,
  ATTENDANCE_THRESHOLD_PERCENT,
  formatCleanNepalDate,
} from './attendanceTheme';
import {
  AttendanceHeader,
  OverallSummary,
  SubjectRow,
  TeacherUpdateNotice,
} from './AttendanceComponents';

export type AttendanceEligibilityState =
  | 'unconfigured'
  | 'not_applicable'
  | 'eligible'
  | 'ineligible';

export interface StudentSubjectAttendanceItem {
  subjectId: string;
  code: string;
  name: string;
  semester: number;
  creditHours?: number;
  nature?: string | null;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  attendancePercentage: number;
  percentageAvailable: boolean;
  configuredThreshold: number | null;
  eligibilityStatus: AttendanceEligibilityState;
  isEligible: boolean | null;
}

export interface StudentRecentAttendanceItem {
  sessionId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sessionDate: string;
  status: 'present' | 'absent';
  submittedAt?: string;
  markedAt?: string | null;
}

export interface StudentAttendanceSummaryResponse {
  studentId: string;
  name: string;
  role: string;
  academicStatus: 'active' | 'unassigned';
  cohort: {
    id: string;
    slotCode: string;
    displayName: string;
    currentSemester: number;
  } | null;
  semesterNo: number | null;
  eligibilityThreshold: {
    configured: boolean;
    threshold: number | null;
    status: string;
    updatedBy?: string | null;
    updatedAt?: string | null;
  };
  configuredThreshold: number | null;
  eligibilityStatus: AttendanceEligibilityState;
  overall: {
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    attendancePercentage: number;
    percentageAvailable: boolean;
    configuredThreshold: number | null;
    eligibilityStatus: AttendanceEligibilityState;
    isEligible: boolean | null;
  };
  subjects: StudentSubjectAttendanceItem[];
  recentHistory: StudentRecentAttendanceItem[];
}

export function formatDisplayPercentage(pct: number, percentageAvailable: boolean): string {
  if (!percentageAvailable) return '0%';
  const num = Number(pct);
  if (!Number.isFinite(num)) return '0%';
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Formats a YYYY-MM-DD Nepal calendar date string into "Oct 26, 2026"
 * without UTC timezone conversion so the calendar date never shifts near midnight.
 */
export function formatNepalCalendarDate(yyyyMmDd: string): string {
  return formatCleanNepalDate(yyyyMmDd);
}

export function describeAttendanceEligibility(
  eligibilityStatus: AttendanceEligibilityState,
  _configuredThreshold?: number | null
) {
  switch (eligibilityStatus) {
    case 'eligible':
      return {
        badgeText: '',
        tone: 'eligible' as const,
        explanation: '',
      };
    case 'ineligible':
      return {
        badgeText: '',
        tone: 'ineligible' as const,
        explanation: `Below ${ATTENDANCE_THRESHOLD_PERCENT}%`,
      };
    case 'not_applicable':
    case 'unconfigured':
    default:
      return {
        badgeText: '',
        tone: 'neutral' as const,
        explanation: '',
      };
  }
}

export interface StudentAttendanceViewProps {
  onClose?: () => void;
}

export function StudentAttendanceView({ onClose }: StudentAttendanceViewProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const appRole = resolveAppRole(user);
  const isStudentAccount = appRole === 'student';

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const didInitialFocusRef = useRef(false);

  const {
    data: summary,
    isLoading,
    error,
    refetch,
  } = useQuery<StudentAttendanceSummaryResponse>({
    queryKey: ['attendance-my-summary', user?.studentId],
    queryFn: async () => {
      // Never pass a client-supplied studentId query parameter; server resolves identity from auth token
      const res = await apiFetch('/api/attendance/my-summary');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(
          json.message ||
            (res.status === 401
              ? 'Your session has expired. Please sign in again.'
              : 'Failed to load your attendance summary.')
        );
        err.status = res.status;
        throw err;
      }
      return json;
    },
    enabled: Boolean(isStudentAccount && user?.studentId),
    staleTime: 15 * 1000,
  });

  // Refresh attendance data when the screen is revisited (skipping duplicate initial mount fetch)
  useFocusEffect(
    useCallback(() => {
      if (!didInitialFocusRef.current) {
        didInitialFocusRef.current = true;
        return;
      }
      if (isStudentAccount && user?.studentId) {
        refetch();
      }
    }, [isStudentAccount, user?.studentId, refetch])
  );

  const handlePullRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const subjects = useMemo(() => summary?.subjects || [], [summary?.subjects]);
  const recentHistory = useMemo(() => summary?.recentHistory || [], [summary?.recentHistory]);

  // Sort subjects so that recently attended subjects appear at the top in order of recent attendance
  const sortedSubjects = useMemo(() => {
    const recencyRank = new Map<string, number>();
    recentHistory.forEach((item, index) => {
      if (item.subjectId && !recencyRank.has(item.subjectId)) {
        recencyRank.set(item.subjectId, index);
      }
      if (item.subjectCode && !recencyRank.has(item.subjectCode)) {
        recencyRank.set(item.subjectCode, index);
      }
    });

    return [...subjects].sort((a, b) => {
      const rankA =
        recencyRank.get(a.subjectId) ??
        recencyRank.get(a.code) ??
        Number.POSITIVE_INFINITY;
      const rankB =
        recencyRank.get(b.subjectId) ??
        recencyRank.get(b.code) ??
        Number.POSITIVE_INFINITY;

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      const aHasSessions = a.totalSessions > 0 ? 1 : 0;
      const bHasSessions = b.totalSessions > 0 ? 1 : 0;
      if (aHasSessions !== bHasSessions) {
        return bHasSessions - aHasSessions;
      }

      if (b.totalSessions !== a.totalSessions) {
        return b.totalSessions - a.totalSessions;
      }

      return 0;
    });
  }, [subjects, recentHistory]);

  const handleBack = () => (onClose ? onClose() : router.back());

  const cohortSubtitle = summary?.cohort
    ? `Semester ${summary.semesterNo} • ${summary.cohort.displayName} Cohort`
    : 'Personal Attendance';

  if (!isStudentAccount) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <AttendanceHeader onBack={handleBack} />
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            Personal attendance is only available for student accounts.
          </Text>
        </View>
      </View>
    );
  }

  const overall = summary?.overall || {
    totalSessions: 0,
    presentCount: 0,
    absentCount: 0,
    attendancePercentage: 0,
    percentageAvailable: false,
    configuredThreshold: summary?.configuredThreshold ?? null,
    eligibilityStatus: summary?.eligibilityStatus || 'unconfigured',
    isEligible: null,
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <AttendanceHeader
        subtitle={cohortSubtitle}
        onBack={handleBack}
        onRefresh={() => refetch()}
      />

      {isLoading && !summary ? (
        <View style={styles.stateBox}>
          <ActivityIndicator size="small" color={T.colors.textSecondary} />
          <Text style={styles.stateText}>Loading attendance…</Text>
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            {(error as any)?.message || 'Could not load attendance.'}
          </Text>
          <TouchableOpacity
            onPress={() =>
              (error as any)?.status === 401
                ? router.replace('/login' as any)
                : refetch()
            }
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>
              {(error as any)?.status === 401 ? 'Sign in' : 'Try again'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : summary?.academicStatus === 'unassigned' || !summary?.cohort ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>No class cohort assigned yet.</Text>
        </View>
      ) : (
        <FlatList
          data={sortedSubjects}
          keyExtractor={(item) => item.subjectId}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(T.spacing.lg, insets.bottom + T.spacing.md) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handlePullRefresh}
              tintColor={T.colors.textSecondary}
            />
          }
          ListHeaderComponent={
            <View>
              <OverallSummary
                presentCount={overall.presentCount}
                totalSessions={overall.totalSessions}
                absentCount={overall.absentCount}
                attendancePercentage={overall.attendancePercentage}
                percentageAvailable={overall.percentageAvailable}
              />

              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleGroup}>
                  <Ionicons name="stats-chart" size={18} color={T.colors.textPrimary} />
                  <Text style={styles.sectionTitle}>
                    Subject-Wise Attendance ({sortedSubjects.length})
                  </Text>
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => <SubjectRow subject={item} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.stateText}>No subjects found.</Text>
            </View>
          }
          ListFooterComponent={<TeacherUpdateNotice />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.colors.background,
  },
  listContent: {
    paddingHorizontal: T.spacing.screenPadding,
    paddingTop: T.spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.spacing.sm,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    ...T.typography.sectionTitle,
    color: T.colors.textPrimary,
  },
  emptyBox: {
    backgroundColor: T.colors.surface,
    borderRadius: T.radii.card,
    borderWidth: 1,
    borderColor: T.colors.border,
    padding: T.spacing.md,
    alignItems: 'center',
  },
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.spacing.lg,
    gap: T.spacing.sm,
  },
  stateText: {
    ...T.typography.muted,
    color: T.colors.textMuted,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: T.touchTarget,
    paddingHorizontal: T.spacing.md,
    backgroundColor: T.colors.surface,
    borderRadius: T.radii.inner,
    borderWidth: 1,
    borderColor: T.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    ...T.typography.body,
    color: T.colors.textPrimary,
  },
});
