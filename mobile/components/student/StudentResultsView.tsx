import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { api, getBaseUrl, getAuthToken } from '@/services/api';

export interface StudentExamSlot {
  examType: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  semesterNo: number;
  semesterLabel: string;
  isPublished: boolean;
  isAbsent?: boolean;
  isMissing?: boolean;
  obtainedMarks: number | null;
  maxMarks: number | null;
  percentage: number | null;
  formattedPercentage: string;
  percentageAvailable: boolean;
  status: string;
  publicationStatus: string;
  publishedAt?: string | null;
}

export interface StudentSubjectResult {
  subjectId: string;
  code: string;
  name: string;
  semesterNo: number;
  department?: string;
  creditHours?: number;
  nature?: string | null;
  publishedExamsCount: number;
  totalExamTypes: number;
  unpublishedExamsCount: number;
  isPartiallyPublished: boolean;
  examSlots: StudentExamSlot[];
  summary: {
    publishedExamsCount: number;
    totalExamTypes: number;
    unpublishedExamsCount: number;
    isPartiallyPublished: boolean;
    totalObtainedMarks: number;
    totalMaxMarks: number;
    overallPercentage: number | null;
    formattedOverallPercentage: string;
    percentageAvailable: boolean;
  };
}

export interface StudentSemesterResultGroup {
  semesterNo: number;
  semesterLabel: string;
  publishedSubjectsCount: number;
  totalCurriculumSubjectsCount: number;
  publishedExamsCount: number;
  unpublishedExamsCount: number;
  isPartiallyPublished: boolean;
  summary: {
    publishedSubjectsCount: number;
    totalCurriculumSubjectsCount: number;
    publishedExamsCount: number;
    totalExpectedExamsCount: number;
    unpublishedExamsCount: number;
    isPartiallyPublished: boolean;
    totalObtainedMarks: number;
    totalMaxMarks: number;
    overallPercentage: number | null;
    formattedOverallPercentage: string;
    aggregatePercentage: number | null;
    formattedAggregatePercentage: string;
    averagePercentage: number | null;
    formattedAveragePercentage: string;
    percentageAvailable: boolean;
  };
  subjects: StudentSubjectResult[];
}

export interface AvailableSemesterItem {
  semesterNo: number;
  semesterLabel: string;
  isCurrentSemester: boolean;
  hasPublishedResults: boolean;
  publishedSubjectsCount: number;
  publishedExamsCount: number;
}

export interface StudentResultsResponse {
  semesters: StudentSemesterResultGroup[];
  availableSemesters: AvailableSemesterItem[];
  overallSummary?: {
    totalPublishedExams: number;
    totalObtainedMarks: number;
    totalMaxMarks: number;
    overallAveragePercentage: number | null;
    formattedOverallAveragePercentage: string;
    subjectsWithResultsCount: number;
  };
  examTypeBreakdown?: Record<string, { publishedCount: number; averagePercentage: number | null }>;
}

export function StudentResultsView({
  initialSemester,
  onClose,
}: {
  initialSemester?: number;
  onClose?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, radii, isDark } = useTheme();
  const { user } = useAuth();

  const [selectedSemester, setSelectedSemester] = useState<number | null>(initialSemester || null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // 1. Fetch Student Published Results
  const {
    data: resultsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<StudentResultsResponse>({
    queryKey: ['studentPublishedResults', user?.studentId],
    queryFn: async () => {
      return await api.get<StudentResultsResponse>('/api/results/my-results');
    },
    staleTime: 30 * 1000,
  });

  const availableSemesters = useMemo(() => {
    return resultsData?.availableSemesters || [];
  }, [resultsData]);

  // Set default selected semester
  useEffect(() => {
    if (selectedSemester !== null) return;
    if (availableSemesters.length > 0) {
      // Prefer current semester if available, else first semester with published results, else first available
      const current = availableSemesters.find((s) => s.isCurrentSemester);
      const withPub = availableSemesters.find((s) => s.hasPublishedResults);
      setSelectedSemester((current || withPub || availableSemesters[0]).semesterNo);
    }
  }, [availableSemesters, selectedSemester]);

  // Active semester group
  const activeSemesterGroup = useMemo(() => {
    if (!resultsData?.semesters || selectedSemester === null) return null;
    return resultsData.semesters.find((s) => s.semesterNo === selectedSemester) || null;
  }, [resultsData, selectedSemester]);

  // Handle PDF Report Card Download
  const handleDownloadReportCard = async () => {
    if (!selectedSemester) return;

    try {
      setIsDownloadingPdf(true);
      const baseUrl = await getBaseUrl();
      const token = await getAuthToken();
      const endpoint = `${baseUrl}/api/results/report-card?semester=${selectedSemester}`;
      const localUri = `${FileSystem.cacheDirectory}BIT_Report_Card_Sem_${selectedSemester}_${Date.now()}.pdf`;

      const downloadResult = await FileSystem.downloadAsync(endpoint, localUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (downloadResult.status === 200) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Semester ${selectedSemester} Report Card`,
          });
        } else {
          Alert.alert('Download Complete', `Report card saved to: ${downloadResult.uri}`);
        }
      } else {
        throw new Error('Server returned an error generating the report card.');
      }
    } catch (err: any) {
      Alert.alert(
        'Download Error',
        err?.message || 'Unable to download report card. Please try again later.'
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const semSummary = activeSemesterGroup?.summary;
  const hasResults = Boolean(activeSemesterGroup && activeSemesterGroup.subjects.length > 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.backBtn, { backgroundColor: colors.surfaceSubtle }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text variant="md" weight="700" numberOfLines={1}>
              Academic Results
            </Text>
            <Text variant="xs" color="secondary" numberOfLines={1}>
              Gandaki University • BIT Program
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => refetch()}
          style={[styles.iconButton, { backgroundColor: colors.surfaceSubtle }]}
          accessibilityLabel="Refresh results"
        >
          <Ionicons
            name="refresh-outline"
            size={18}
            color={isRefetching ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            tintColor={colors.text}
          />
        }
      >
        {/* Semester Selection Horizontal Tabs */}
        {availableSemesters.length > 0 && (
          <View style={styles.semesterTabsWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.semesterTabsScroll}
            >
              {availableSemesters.map((sem) => {
                const isSelected = sem.semesterNo === selectedSemester;
                return (
                  <TouchableOpacity
                    key={sem.semesterNo}
                    onPress={() => setSelectedSemester(sem.semesterNo)}
                    style={[
                      styles.semesterTabChip,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight={isSelected ? '700' : '600'}
                      style={{ color: isSelected ? '#FFFFFF' : colors.text }}
                    >
                      {sem.semesterLabel}
                    </Text>
                    {sem.hasPublishedResults && (
                      <View
                        style={[
                          styles.publishedDot,
                          { backgroundColor: isSelected ? '#FFFFFF' : colors.success || '#10b981' },
                        ]}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
              Loading examination results...
            </Text>
          </View>
        ) : !hasResults ? (
          <EmptyState
            icon="document-text-outline"
            title="No Results Published Yet"
            description={`Official examination scores for Semester ${selectedSemester || ''} have not been published by your teachers yet.`}
          />
        ) : (
          <>
            {/* Overview Hero Card */}
            <Card
              style={[
                styles.heroCard,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.heroTopRow}>
                <View>
                  <Text variant="xs" weight="700" color="secondary" style={{ letterSpacing: 0.5, fontSize: 11 }}>
                    SEMESTER {selectedSemester} STANDING
                  </Text>
                  <View style={styles.percentageRow}>
                    <Text variant="xxl" weight="800" style={{ color: colors.text }}>
                      {semSummary?.formattedOverallPercentage || '—'}
                    </Text>
                    {semSummary?.percentageAvailable && (
                      <Badge label="Good Standing" variant="success" size="sm" style={styles.standingBadge} />
                    )}
                  </View>
                </View>

                {/* Download Report Card Button */}
                <TouchableOpacity
                  onPress={handleDownloadReportCard}
                  disabled={isDownloadingPdf}
                  style={[
                    styles.downloadBtn,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Download PDF Report Card"
                >
                  {isDownloadingPdf ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <>
                      <Ionicons
                        name="cloud-download-outline"
                        size={16}
                        color={colors.text}
                        style={{ marginRight: 6 }}
                      />
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Report Card (PDF)
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Progress and score details */}
              <View style={[styles.heroDetailsRow, { borderTopColor: colors.border }]}>
                <View style={styles.heroDetailItem}>
                  <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                    Total Scored
                  </Text>
                  <Text variant="sm" weight="700">
                    {semSummary?.totalObtainedMarks ?? 0} / {semSummary?.totalMaxMarks ?? 0}
                  </Text>
                </View>

                <View style={styles.heroDetailItem}>
                  <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                    Evaluated Exams
                  </Text>
                  <Text variant="sm" weight="700">
                    {semSummary?.publishedExamsCount ?? 0}
                  </Text>
                </View>

                <View style={styles.heroDetailItem}>
                  <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                    Subjects
                  </Text>
                  <Text variant="sm" weight="700">
                    {activeSemesterGroup?.subjects.length ?? 0}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Subject-wise Result Cards */}
            <View style={styles.sectionHeader}>
              <Text variant="xs" weight="700" color="secondary" style={styles.sectionTitle}>
                SUBJECT BREAKDOWN
              </Text>
            </View>

            {activeSemesterGroup?.subjects.map((subject) => {
              const overallPct = subject.summary.overallPercentage;
              return (
                <Card
                  key={subject.subjectId}
                  style={[
                    styles.subjectCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {/* Subject Header */}
                  <View style={styles.subjectCardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                          {subject.code}
                        </Text>
                        {subject.creditHours && (
                          <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                            • {subject.creditHours} Cr
                          </Text>
                        )}
                      </View>
                      <Text variant="sm" weight="700" numberOfLines={1}>
                        {subject.name}
                      </Text>
                    </View>

                    {overallPct !== null ? (
                      <Badge label={`${Math.round(overallPct)}%`} variant="neutral" size="md" />
                    ) : (
                      <Badge label="In Progress" variant="outline" size="sm" />
                    )}
                  </View>

                  {/* 3 Exam Slots Breakdown */}
                  <View style={[styles.examSlotsContainer, { borderTopColor: colors.border }]}>
                    {subject.examSlots.map((slot) => {
                      const isPub = slot.isPublished;
                      const isAbs = slot.isAbsent;
                      const hasMark = isPub && slot.obtainedMarks !== null && !isAbs;

                      return (
                        <View
                          key={slot.examType}
                          style={[
                            styles.examSlotItem,
                            {
                              backgroundColor: colors.surfaceSubtle,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Text variant="xs" weight="600" color="secondary" numberOfLines={1} style={{ fontSize: 11 }}>
                            {slot.examType.replace(' Exam', '')}
                          </Text>

                          {isAbs ? (
                            <Text variant="xs" weight="700" style={{ color: colors.error, marginTop: 4 }}>
                              Absent
                            </Text>
                          ) : hasMark ? (
                            <View style={{ marginTop: 4, alignItems: 'center' }}>
                              <Text variant="sm" weight="700">
                                {slot.obtainedMarks}
                                <Text variant="xs" color="secondary" style={{ fontSize: 11 }}>
                                  /{slot.maxMarks}
                                </Text>
                              </Text>
                              {slot.percentage !== null && (
                                <Text variant="xs" weight="600" style={{ color: colors.primary, fontSize: 11 }}>
                                  {Math.round(slot.percentage)}%
                                </Text>
                              )}
                            </View>
                          ) : (
                            <Text variant="xs" color="secondary" style={{ marginTop: 6, fontSize: 11 }}>
                              Pending
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
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
    paddingBottom: 40,
  },
  semesterTabsWrapper: {
    marginBottom: 16,
  },
  semesterTabsScroll: {
    gap: 8,
    flexDirection: 'row',
  },
  semesterTabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  publishedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
  loadingContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  percentageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  standingBadge: {
    marginLeft: 6,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  heroDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  heroDetailItem: {
    alignItems: 'center',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  subjectCard: {
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  subjectCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  examSlotsContainer: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  examSlotItem: {
    flex: 1,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
});
