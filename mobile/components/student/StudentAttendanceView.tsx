import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { apiFetch } from '@/services/api';
import { resolveAppRole } from '@/utils/roles';

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
  if (!percentageAvailable) return '—';
  const num = Number(pct);
  if (!Number.isFinite(num)) return '—';
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Formats a YYYY-MM-DD Nepal calendar date string without UTC timezone conversion
 * so the calendar date never shifts near midnight.
 */
export function formatNepalCalendarDate(yyyyMmDd: string): string {
  if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return '—';
  const clean = yyyyMmDd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const [yStr, mStr, dStr] = clean.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const day = Number(dStr);
  if (monthIdx < 0 || monthIdx > 11 || !day) return clean;
  return `${months[monthIdx]} ${day}, ${year} (${clean})`;
}

export function describeAttendanceEligibility(
  eligibilityStatus: AttendanceEligibilityState,
  configuredThreshold: number | null | undefined,
  scopeLabel?: string
) {
  const prefix = scopeLabel ? `${scopeLabel}: ` : '';
  const hasThreshold =
    configuredThreshold !== null &&
    configuredThreshold !== undefined &&
    Number.isFinite(Number(configuredThreshold));
  const thresholdStr = hasThreshold ? `${Number(configuredThreshold)}%` : null;

  switch (eligibilityStatus) {
    case 'eligible':
      return {
        badgeText: `${prefix}Eligible`,
        tone: 'eligible' as const,
        explanation: thresholdStr
          ? `Meets configured minimum requirement (${thresholdStr})`
          : 'Meets configured attendance requirement',
      };
    case 'ineligible':
      return {
        badgeText: `${prefix}Below Threshold`,
        tone: 'ineligible' as const,
        explanation: thresholdStr
          ? `Below configured minimum requirement (${thresholdStr})`
          : 'Below configured attendance requirement',
      };
    case 'not_applicable':
      return {
        badgeText: `${prefix}No Sessions Recorded`,
        tone: 'neutral' as const,
        explanation: 'No attendance sessions have been recorded yet',
      };
    case 'unconfigured':
    default:
      return {
        badgeText: `${prefix}Threshold Unconfigured`,
        tone: 'neutral' as const,
        explanation: 'Eligibility threshold has not been configured yet',
      };
  }
}

export interface StudentAttendanceViewProps {
  onClose?: () => void;
}

export function StudentAttendanceView({ onClose }: StudentAttendanceViewProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const appRole = resolveAppRole(user);
  const isStudentAccount = appRole === 'student';

  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('ALL');
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

  useEffect(() => {
    if (selectedSubjectFilter === 'ALL') return;
    const exists = subjects.some(
      (s) => s.subjectId === selectedSubjectFilter || s.code === selectedSubjectFilter
    );
    if (!exists) {
      setSelectedSubjectFilter('ALL');
    }
  }, [subjects, selectedSubjectFilter, user?.studentId]);

  const filteredHistory = useMemo(() => {
    if (selectedSubjectFilter === 'ALL') return recentHistory;
    return recentHistory.filter(
      (item) =>
        item.subjectId === selectedSubjectFilter || item.subjectCode === selectedSubjectFilter
    );
  }, [recentHistory, selectedSubjectFilter]);

  if (!isStudentAccount) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => (onClose ? onClose() : router.back())}
            style={[styles.backBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text variant="lg" weight="800" style={{ color: colors.text, marginLeft: 10 }}>
            My Attendance
          </Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <EmptyState
            icon="school-outline"
            title="Student Summary View"
            description="Personal attendance summaries are available for enrolled student and CR accounts."
            actionTitle="Go Back"
            onAction={() => (onClose ? onClose() : router.back())}
          />
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

  const overallElig = describeAttendanceEligibility(
    overall.eligibilityStatus,
    overall.configuredThreshold,
    'Overall'
  );
  const overallPctDisplay = formatDisplayPercentage(
    overall.attendancePercentage,
    overall.percentageAvailable
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Top Bar */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (onClose ? onClose() : router.back())}
          style={[styles.backBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text variant="lg" weight="800" style={{ color: colors.text, letterSpacing: -0.3 }}>
            My Attendance
          </Text>
          <Text variant="xs" color="secondary" numberOfLines={1}>
            {summary?.cohort
              ? `${summary.cohort.displayName} Cohort • Semester ${summary.semesterNo}`
              : 'Personal Attendance Summary'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => refetch()}
          style={[styles.backBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Refresh attendance"
        >
          <Ionicons name="refresh" size={17} color={colors.text} />
        </TouchableOpacity>
      </View>

      {isLoading && !summary ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Loading your attendance summary…
          </Text>
        </View>
      ) : error ? (
        <View style={{ padding: 20, flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="alert-circle-outline"
            title={
              (error as any)?.status === 401
                ? 'Session Expired'
                : 'Could Not Load Attendance'
            }
            description={
              (error as any)?.message || 'Please check your connection and try again.'
            }
            actionTitle={(error as any)?.status === 401 ? 'Sign In Again' : 'Retry'}
            onAction={() => {
              if ((error as any)?.status === 401) {
                router.replace('/login' as any);
              } else {
                refetch();
              }
            }}
          />
        </View>
      ) : summary?.academicStatus === 'unassigned' || !summary?.cohort ? (
        <ScrollView
          contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: 'center' }}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handlePullRefresh}
              tintColor={colors.text}
            />
          }
        >
          <EmptyState
            icon="school-outline"
            title="Class Cohort Not Assigned Yet"
            description="Your account has not been assigned to an active class cohort yet. Once assigned, your subject-wise attendance and session history will appear here."
            actionTitle="Refresh Status"
            onAction={() => refetch()}
          />
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(40, insets.bottom + 24) }}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handlePullRefresh}
              tintColor={colors.text}
            />
          }
        >
          {/* 1. Overall Attendance Summary Card */}
          <Card variant="elevated" style={[styles.sectionCard, { borderColor: colors.border }]}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text variant="xs" weight="700" color="secondary" style={styles.eyebrow}>
                  {summary.cohort.displayName.toUpperCase()} COHORT • SEMESTER {summary.semesterNo}
                </Text>
                <Text variant="lg" weight="800" style={{ color: colors.text }}>
                  Overall Attendance
                </Text>
              </View>

              <View
                style={[
                  styles.statusPill,
                  overallElig.tone === 'eligible'
                    ? { backgroundColor: colors.text, borderColor: colors.text }
                    : overallElig.tone === 'ineligible'
                    ? styles.ineligiblePill
                    : { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              >
                <Text
                  variant="xs"
                  weight="700"
                  style={{
                    color:
                      overallElig.tone === 'eligible'
                        ? colors.background
                        : overallElig.tone === 'ineligible'
                        ? '#fca5a5'
                        : colors.textSecondary,
                  }}
                >
                  {overallElig.badgeText}
                </Text>
              </View>
            </View>

            <Text variant="xs" color="secondary" style={{ marginTop: 4, marginBottom: 14 }}>
              {overall.totalSessions === 0
                ? 'No attendance has been recorded yet.'
                : overallElig.explanation}
            </Text>

            <View style={styles.statsGrid}>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text variant="xl" weight="800" style={{ color: colors.text }}>
                  {overallPctDisplay}
                </Text>
                <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                  {overall.totalSessions === 0 ? 'No Sessions' : 'Percentage'}
                </Text>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text variant="xl" weight="800" style={{ color: colors.text }}>
                  {overall.totalSessions}
                </Text>
                <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                  Sessions
                </Text>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text variant="xl" weight="800" style={{ color: colors.text }}>
                  {overall.presentCount}
                </Text>
                <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                  Present
                </Text>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text variant="xl" weight="800" style={{ color: colors.text }}>
                  {overall.absentCount}
                </Text>
                <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                  Absent
                </Text>
              </View>
            </View>

            <View style={[styles.thresholdRow, { borderTopColor: colors.borderSubtle }]}>
              <Text variant="xs" color="secondary">
                Configured Eligibility Threshold:
              </Text>
              <Text variant="xs" weight="700" style={{ color: colors.text }}>
                {overall.configuredThreshold !== null && overall.configuredThreshold !== undefined
                  ? `${overall.configuredThreshold}%`
                  : 'Unconfigured'}
              </Text>
            </View>
          </Card>

          {/* 2. Subject-Wise Attendance Breakdown */}
          <View style={styles.sectionTitleRow}>
            <Text variant="md" weight="800" style={{ color: colors.text }}>
              Subject-Wise Attendance ({subjects.length})
            </Text>
          </View>

          {subjects.length === 0 ? (
            <EmptyState
              icon="book-outline"
              title="No Subjects Found"
              description="Subjects for your current semester will appear here once configured."
            />
          ) : (
            subjects.map((sub) => {
              const hasSessions = Boolean(sub.percentageAvailable && sub.totalSessions > 0);
              const pctLabel = formatDisplayPercentage(sub.attendancePercentage, hasSessions);
              const barRatio = hasSessions
                ? Math.max(0, Math.min(100, Number(sub.attendancePercentage) || 0))
                : 0;
              const subElig = describeAttendanceEligibility(
                sub.eligibilityStatus,
                sub.configuredThreshold
              );

              return (
                <Card
                  key={sub.subjectId}
                  variant="elevated"
                  style={[styles.subjectCard, { borderColor: colors.border }]}
                >
                  <View style={styles.cardHeaderRow}>
                    <Badge label={sub.code || sub.subjectId} variant="neutral" size="sm" />
                    <View
                      style={[
                        styles.statusPill,
                        subElig.tone === 'eligible'
                          ? { backgroundColor: colors.text, borderColor: colors.text }
                          : subElig.tone === 'ineligible'
                          ? styles.ineligiblePill
                          : { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{
                          color:
                            subElig.tone === 'eligible'
                              ? colors.background
                              : subElig.tone === 'ineligible'
                              ? '#fca5a5'
                              : colors.textSecondary,
                        }}
                      >
                        {subElig.badgeText}
                      </Text>
                    </View>
                  </View>

                  <Text variant="md" weight="700" style={{ color: colors.text, marginTop: 8 }}>
                    {sub.name}
                  </Text>

                  <Text variant="xs" color="secondary" style={{ marginTop: 4, marginBottom: 12 }}>
                    {sub.totalSessions === 0
                      ? 'No sessions recorded'
                      : `${sub.presentCount} Present • ${sub.absentCount} Absent • ${sub.totalSessions} ${
                          sub.totalSessions === 1 ? 'Session' : 'Sessions'
                        }`}
                  </Text>

                  <View style={styles.progressHeader}>
                    <Text variant="xs" color="secondary">
                      {sub.totalSessions === 0 ? 'No sessions recorded' : subElig.explanation}
                    </Text>
                    <Text variant="md" weight="800" style={{ color: colors.text }}>
                      {pctLabel}
                    </Text>
                  </View>

                  <View style={[styles.progressBarBg, { backgroundColor: colors.surfaceSubtle }]}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${barRatio}%`,
                          backgroundColor: colors.text,
                        },
                      ]}
                    />
                  </View>
                </Card>
              );
            })
          )}

          {/* 3. Recent Attendance History */}
          <View style={[styles.sectionTitleRow, { marginTop: 10 }]}>
            <Text variant="md" weight="800" style={{ color: colors.text }}>
              Recent Attendance History
            </Text>
          </View>

          {subjects.length > 1 && recentHistory.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
            >
              <TouchableOpacity
                onPress={() => setSelectedSubjectFilter('ALL')}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      selectedSubjectFilter === 'ALL' ? colors.text : colors.surfaceRaised,
                    borderColor: selectedSubjectFilter === 'ALL' ? colors.text : colors.border,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="700"
                  style={{
                    color:
                      selectedSubjectFilter === 'ALL' ? colors.background : colors.textSecondary,
                  }}
                >
                  All ({recentHistory.length})
                </Text>
              </TouchableOpacity>

              {subjects.map((sub) => {
                const isSelected = selectedSubjectFilter === sub.subjectId;
                return (
                  <TouchableOpacity
                    key={sub.subjectId}
                    onPress={() => setSelectedSubjectFilter(sub.subjectId)}
                    style={[
                      styles.filterPill,
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
                      {sub.code}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <Card variant="elevated" style={[styles.sectionCard, { borderColor: colors.border }]}>
            {recentHistory.length === 0 ? (
              <Text variant="xs" color="secondary" style={{ textAlign: 'center', paddingVertical: 16 }}>
                No attendance has been recorded yet. Finalized class sessions will appear here.
              </Text>
            ) : filteredHistory.length === 0 ? (
              <Text variant="xs" color="secondary" style={{ textAlign: 'center', paddingVertical: 16 }}>
                No recorded sessions for the selected subject filter.
              </Text>
            ) : (
              filteredHistory.map((item, idx) => {
                const isPresent = item.status === 'present';
                return (
                  <View
                    key={`${item.sessionId}-${idx}`}
                    style={[
                      styles.historyRow,
                      idx < filteredHistory.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text variant="sm" weight="700" style={{ color: colors.text }}>
                        [{item.subjectCode || item.subjectId}] {item.subjectName}
                      </Text>
                      <Text variant="xs" color="secondary" style={{ marginTop: 2 }}>
                        {formatNepalCalendarDate(item.sessionDate)}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusPill,
                        isPresent
                          ? { backgroundColor: colors.text, borderColor: colors.text }
                          : styles.ineligiblePill,
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: isPresent ? colors.background : '#fca5a5' }}
                      >
                        {isPresent ? 'Present' : 'Absent'}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </ScrollView>
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  sectionCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  subjectCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eyebrow: {
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  ineligiblePill: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statBox: {
    flex: 1,
    minWidth: '22%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
});
