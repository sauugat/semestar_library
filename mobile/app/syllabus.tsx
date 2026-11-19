import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import {
  BIT_SEMESTERS,
  ELECTIVE_CLUSTERS,
  ELECTIVE_COURSES,
  SyllabusCourse,
  SyllabusSemester,
  findSyllabusCourse,
  searchSyllabusCourses,
} from '@/constants/syllabusData';

// Minimal Monochrome Academic Design System Tokens
const PALETTE = {
  background: '#0B0B0B',
  surface: '#151515',
  surfaceRaised: '#1B1B1B',
  surfaceSubtle: '#121212',
  border: '#292929',
  borderSubtle: '#1F1F1F',
  borderStrong: '#3A3A3A',
  textPrimary: '#F5F5F5',
  textSecondary: '#999999',
  textMuted: '#666666',
  badgeBg: '#1B1B1B',
  badgeBorder: '#303030',
  activeBadgeBg: '#F5F5F5',
  activeBadgeText: '#0B0B0B',
} as const;

interface YearGroup {
  yearNumber: number;
  yearLabel: string;
  yearSubtitle: string;
  semesters: SyllabusSemester[];
}

export default function SyllabusScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors, spacing, radii } = useTheme();
  const { semesterRoman } = useAcademicContext();
  const params = useLocalSearchParams<{
    course?: string;
    semester?: string;
    fromLibrary?: string;
  }>();

  // 3-Level Hierarchy State:
  // Level 1: selectedSemesterId === null && selectedCourse === null (Grouped Semester Landing)
  // Level 2: selectedSemesterId !== null && selectedCourse === null (Subjects Listing for that Semester)
  // Level 3: selectedCourse !== null (Micro-Syllabus with Unit Accordions)
  const [selectedSemesterId, setSelectedSemesterId] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<SyllabusCourse | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Accordion state for Level 3 units: only Unit 1 expanded by default
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set([1]));
  // Collapsible toggle for course description/objectives if long
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);

  // Sync deep-link route params (e.g. when "View Syllabus" is clicked in Library)
  useEffect(() => {
    if (params.course) {
      const found = findSyllabusCourse(params.course);
      if (found) {
        setSelectedCourse(found);
        setExpandedUnits(new Set([found.units[0]?.unitNumber || 1]));
        const sem = BIT_SEMESTERS.find((s) => s.semesterRoman === found.semester);
        if (sem) {
          setSelectedSemesterId(sem.id);
        } else if (found.cluster) {
          setSelectedSemesterId('electives');
        }
        return;
      }
    }
    if (params.semester) {
      const clean = params.semester.replace(/^semester\s+/i, '').trim().toUpperCase();
      const sem = BIT_SEMESTERS.find(
        (s) =>
          s.semesterRoman === clean ||
          String(s.semesterNumber) === clean ||
          s.id.toLowerCase() === clean.toLowerCase()
      );
      if (sem) {
        setSelectedSemesterId(sem.id);
        setSelectedCourse(null);
      }
    }
  }, [params.course, params.semester]);

  // Update screen header title dynamically based on navigation level
  useEffect(() => {
    if (selectedCourse) {
      navigation.setOptions({ title: `${selectedCourse.code} · Syllabus` });
    } else if (selectedSemesterId === 'electives') {
      navigation.setOptions({ title: 'Elective Subjects' });
    } else if (selectedSemesterId) {
      const sem = BIT_SEMESTERS.find((s) => s.id === selectedSemesterId);
      navigation.setOptions({
        title: sem ? `Semester ${sem.semesterRoman} Subjects` : 'Subjects',
      });
    } else {
      navigation.setOptions({ title: 'BIT Syllabus' });
    }
  }, [selectedCourse, selectedSemesterId, navigation]);

  // Handle hardware back button on Android for smooth 3-level drill-down
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedCourse) {
        if (params.fromLibrary === '1') {
          router.back();
          return true;
        }
        setSelectedCourse(null);
        return true;
      }
      if (selectedSemesterId) {
        setSelectedSemesterId(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selectedCourse, selectedSemesterId, params.fromLibrary, router]);

  const activeSemester: SyllabusSemester | null = useMemo(() => {
    if (!selectedSemesterId || selectedSemesterId === 'electives') return null;
    return BIT_SEMESTERS.find((s) => s.id === selectedSemesterId) || null;
  }, [selectedSemesterId]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchSyllabusCourses(searchQuery);
  }, [searchQuery]);

  const visibleElectives = useMemo(() => {
    if (selectedCluster === 'ALL') return ELECTIVE_COURSES;
    return ELECTIVE_COURSES.filter((c) => c.cluster === selectedCluster);
  }, [selectedCluster]);

  // Semesters grouped by Academic Year (Year 1 to Year 4)
  const yearGroups: YearGroup[] = useMemo(() => {
    return [
      {
        yearNumber: 1,
        yearLabel: 'Year 1',
        yearSubtitle: 'First Year (Semesters I & II)',
        semesters: BIT_SEMESTERS.filter((s) => s.yearNumber === 1),
      },
      {
        yearNumber: 2,
        yearLabel: 'Year 2',
        yearSubtitle: 'Second Year (Semesters III & IV)',
        semesters: BIT_SEMESTERS.filter((s) => s.yearNumber === 2),
      },
      {
        yearNumber: 3,
        yearLabel: 'Year 3',
        yearSubtitle: 'Third Year (Semesters V & VI)',
        semesters: BIT_SEMESTERS.filter((s) => s.yearNumber === 3),
      },
      {
        yearNumber: 4,
        yearLabel: 'Year 4',
        yearSubtitle: 'Fourth Year (Semesters VII & VIII)',
        semesters: BIT_SEMESTERS.filter((s) => s.yearNumber === 4),
      },
    ];
  }, []);

  // Navigate to Library for a specific subject and optional unit/chapter
  const handleViewNotesInLibrary = (
    course: SyllabusCourse,
    unitNumber?: number,
    unitTitle?: string
  ) => {
    const queryParams: Record<string, string> = {
      subject: course.title,
      semester: `Semester ${course.semester}`,
      fromSyllabus: '1',
    };
    if (unitNumber !== undefined && unitTitle) {
      queryParams.unit = String(unitNumber);
      queryParams.chapter = `Unit ${unitNumber}: ${unitTitle}`;
    }
    router.push({
      pathname: '/(tabs)/library',
      params: queryParams,
    } as any);
  };

  const handleSelectCourse = (course: SyllabusCourse) => {
    if (course.isElectiveSlot) {
      setSelectedSemesterId('electives');
      setSelectedCourse(null);
      return;
    }
    setSelectedCourse(course);
    setExpandedUnits(new Set([course.units[0]?.unitNumber || 1]));
    setIsOverviewExpanded(false);
  };

  const toggleUnit = (unitNumber: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitNumber)) {
        next.delete(unitNumber);
      } else {
        next.add(unitNumber);
      }
      return next;
    });
  };

  const toggleAllUnits = (course: SyllabusCourse) => {
    if (expandedUnits.size === course.units.length) {
      setExpandedUnits(new Set());
    } else {
      setExpandedUnits(new Set(course.units.map((u) => u.unitNumber)));
    }
  };

  const isNarrowScreen = width < 350;

  // ═══════════════════════════════════════════════════════════════════════════
  // LEVEL 3: MICRO-SYLLABUS VIEW (When a specific subject is clicked)
  // ═══════════════════════════════════════════════════════════════════════════
  if (selectedCourse) {
    const allExpanded = expandedUnits.size === selectedCourse.units.length;
    const hasLongObjectives =
      selectedCourse.objectives && selectedCourse.objectives.length > 2;

    return (
      <View style={[styles.root, { backgroundColor: PALETTE.background }]}>
        <ScrollView
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Navigation Bar */}
          <View style={[styles.topNavRow, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                if (params.fromLibrary === '1') {
                  router.back();
                } else {
                  setSelectedCourse(null);
                }
              }}
              style={[
                styles.backPillBtn,
                {
                  backgroundColor: PALETTE.surface,
                  borderColor: PALETTE.border,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={15} color={PALETTE.textPrimary} />
              <Text
                variant="xs"
                weight="700"
                style={{ marginLeft: 6, color: PALETTE.textPrimary }}
              >
                {params.fromLibrary === '1'
                  ? 'Back to Library'
                  : selectedSemesterId === 'electives'
                  ? 'Electives'
                  : activeSemester
                  ? `Sem ${activeSemester.semesterRoman} Subjects`
                  : 'Subjects'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => handleViewNotesInLibrary(selectedCourse)}
              style={[
                styles.notesHeaderBtn,
                {
                  backgroundColor: PALETTE.surfaceRaised,
                  borderColor: PALETTE.borderStrong,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Ionicons
                name="folder-open-outline"
                size={13}
                color={PALETTE.textPrimary}
              />
              <Text
                variant="xs"
                weight="700"
                style={{ marginLeft: 5, color: PALETTE.textPrimary }}
              >
                Subject Notes
              </Text>
            </TouchableOpacity>
          </View>

          {/* Subject Header & Metadata Card */}
          <View
            style={[
              styles.subjectHeaderCard,
              {
                backgroundColor: PALETTE.surface,
                borderColor: PALETTE.border,
                borderRadius: radii.card,
                marginBottom: spacing.md,
              },
            ]}
          >
            {/* Horizontal Compact Metadata Bar */}
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.codePill,
                  {
                    backgroundColor: PALETTE.surfaceRaised,
                    borderColor: PALETTE.borderStrong,
                    borderWidth: 1,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="800"
                  style={{ color: PALETTE.textPrimary }}
                >
                  {selectedCourse.code}
                </Text>
              </View>

              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor: PALETTE.surfaceSubtle,
                    borderColor: PALETTE.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="600"
                  style={{ color: PALETTE.textPrimary }}
                >
                  {selectedCourse.creditDisplay} Credits
                </Text>
              </View>

              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor: PALETTE.surfaceSubtle,
                    borderColor: PALETTE.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="600"
                  style={{ color: PALETTE.textSecondary }}
                >
                  {selectedCourse.nature}
                </Text>
              </View>

              {selectedCourse.totalHours ? (
                <View
                  style={[
                    styles.metaPill,
                    {
                      backgroundColor: PALETTE.surfaceSubtle,
                      borderColor: PALETTE.border,
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="600"
                    style={{ color: PALETTE.textSecondary }}
                  >
                    {selectedCourse.totalHours}
                  </Text>
                </View>
              ) : null}
            </View>

            <Heading
              style={{
                fontSize: 18,
                lineHeight: 24,
                marginTop: 10,
                color: PALETTE.textPrimary,
              }}
            >
              {selectedCourse.title}
            </Heading>

            <Caption
              style={{
                marginTop: 4,
                color: PALETTE.textMuted,
                fontWeight: '500',
              }}
            >
              {selectedCourse.cluster
                ? selectedCourse.cluster
                : `${selectedCourse.year} · Semester ${selectedCourse.semester} · Gandaki University`}
            </Caption>
          </View>

          {/* Course Overview / Objectives (Collapsible if long) */}
          {selectedCourse.objectives && selectedCourse.objectives.length > 0 ? (
            <View
              style={[
                styles.overviewCard,
                {
                  backgroundColor: PALETTE.surface,
                  borderColor: PALETTE.border,
                  borderRadius: radii.card,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <Text
                  variant="xs"
                  weight="700"
                  style={{ color: PALETTE.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  Course Overview & Objectives
                </Text>
                {hasLongObjectives ? (
                  <TouchableOpacity
                    onPress={() => setIsOverviewExpanded((prev) => !prev)}
                    style={styles.toggleBtn}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: PALETTE.textPrimary, fontSize: 11 }}
                    >
                      {isOverviewExpanded ? 'Show Less' : 'Show All'}
                    </Text>
                    <Ionicons
                      name={isOverviewExpanded ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      color={PALETTE.textPrimary}
                      style={{ marginLeft: 2 }}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={{ marginTop: 8, gap: 6 }}>
                {(isOverviewExpanded
                  ? selectedCourse.objectives
                  : selectedCourse.objectives.slice(0, 2)
                ).map((obj, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text
                      variant="xs"
                      style={{ color: PALETTE.textMuted, width: 12, lineHeight: 18 }}
                    >
                      •
                    </Text>
                    <Text
                      variant="xs"
                      style={{
                        flex: 1,
                        color: PALETTE.textSecondary,
                        lineHeight: 18,
                      }}
                    >
                      {obj}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Course Contents: Units & Chapters Accordion */}
          <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
            <Subheading style={{ fontSize: 14, color: PALETTE.textPrimary, fontWeight: '700' }}>
              Chapters & Micro-Syllabus ({selectedCourse.units.length}{' '}
              {selectedCourse.units.length === 1 ? 'Unit' : 'Units'})
            </Subheading>
            <TouchableOpacity
              onPress={() => toggleAllUnits(selectedCourse)}
              style={styles.toggleBtn}
            >
              <Text
                variant="xs"
                weight="700"
                style={{ color: PALETTE.textMuted, fontSize: 11 }}
              >
                {allExpanded ? 'Collapse All' : 'Expand All'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Units Accordion List */}
          <View style={{ gap: 8 }}>
            {selectedCourse.units.map((unit) => {
              const isExpanded = expandedUnits.has(unit.unitNumber);

              return (
                <View
                  key={unit.unitNumber}
                  style={[
                    styles.unitAccordionCard,
                    {
                      backgroundColor: PALETTE.surface,
                      borderColor: isExpanded ? PALETTE.borderStrong : PALETTE.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  {/* Unit Accordion Header Row */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => toggleUnit(unit.unitNumber)}
                    style={styles.unitAccordionHeader}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.unitMetaRow}>
                        <View
                          style={[
                            styles.unitNumBadge,
                            {
                              backgroundColor: PALETTE.surfaceRaised,
                              borderColor: PALETTE.borderStrong,
                              borderRadius: radii.sm,
                            },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="800"
                            style={{ color: PALETTE.textPrimary, fontSize: 10.5 }}
                          >
                            Unit {unit.unitNumber}
                          </Text>
                        </View>

                        {unit.hours ? (
                          <Caption
                            style={{
                              fontWeight: '600',
                              marginLeft: 8,
                              color: PALETTE.textMuted,
                              fontSize: 11,
                            }}
                          >
                            {unit.hours}
                          </Caption>
                        ) : null}

                        <Caption
                          style={{
                            fontWeight: '500',
                            marginLeft: 8,
                            color: PALETTE.textMuted,
                            fontSize: 11,
                          }}
                        >
                          {unit.topics.length} Topics
                        </Caption>
                      </View>

                      {/* Unit Title */}
                      <Text
                        variant="sm"
                        weight="700"
                        style={{
                          color: PALETTE.textPrimary,
                          marginTop: 6,
                          lineHeight: 19,
                        }}
                      >
                        {unit.title}
                      </Text>
                    </View>

                    {/* Actions: Direct Unit Notes & Expand Chevron */}
                    <View style={styles.unitActionGroup}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleViewNotesInLibrary(
                            selectedCourse,
                            unit.unitNumber,
                            unit.title
                          );
                        }}
                        style={[
                          styles.unitNotesPill,
                          {
                            backgroundColor: PALETTE.surfaceRaised,
                            borderColor: PALETTE.border,
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Ionicons
                          name="document-text-outline"
                          size={11}
                          color={PALETTE.textSecondary}
                          style={{ marginRight: 3 }}
                        />
                        <Text
                          variant="xs"
                          weight="700"
                          style={{ color: PALETTE.textSecondary, fontSize: 10.5 }}
                        >
                          Notes
                        </Text>
                      </TouchableOpacity>

                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={PALETTE.textMuted}
                        style={{ marginLeft: 6 }}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Expanded Micro-Syllabus Topics Breakdown */}
                  {isExpanded ? (
                    <View
                      style={[
                        styles.unitTopicsContainer,
                        {
                          borderTopColor: PALETTE.borderSubtle,
                        },
                      ]}
                    >
                      {unit.topics.map((topic, idx) => (
                        <View key={idx} style={styles.bulletRow}>
                          <Text
                            variant="xs"
                            style={{
                              color: PALETTE.textMuted,
                              width: 12,
                              lineHeight: 18,
                            }}
                          >
                            •
                          </Text>
                          <Text
                            variant="xs"
                            style={{
                              flex: 1,
                              color: PALETTE.textSecondary,
                              lineHeight: 18,
                            }}
                          >
                            {topic}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Laboratory / Practical Work (if applicable) */}
          {selectedCourse.laboratoryWork && selectedCourse.laboratoryWork.length > 0 ? (
            <View
              style={[
                styles.extraSectionCard,
                {
                  backgroundColor: PALETTE.surface,
                  borderColor: PALETTE.border,
                  borderRadius: radii.card,
                  marginTop: spacing.md,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="flask-outline" size={15} color={PALETTE.textPrimary} />
                <Text
                  variant="xs"
                  weight="800"
                  style={{
                    marginLeft: 6,
                    color: PALETTE.textPrimary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Laboratory / Practical Work
                </Text>
              </View>
              <View style={{ gap: 5 }}>
                {selectedCourse.laboratoryWork.map((item, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text
                      variant="xs"
                      style={{ color: PALETTE.textMuted, width: 12, lineHeight: 18 }}
                    >
                      •
                    </Text>
                    <Text
                      variant="xs"
                      style={{
                        flex: 1,
                        color: PALETTE.textSecondary,
                        lineHeight: 18,
                      }}
                    >
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Textbooks & References (if applicable) */}
          {(selectedCourse.textbooks && selectedCourse.textbooks.length > 0) ||
          (selectedCourse.references && selectedCourse.references.length > 0) ? (
            <View
              style={[
                styles.extraSectionCard,
                {
                  backgroundColor: PALETTE.surface,
                  borderColor: PALETTE.border,
                  borderRadius: radii.card,
                  marginTop: spacing.md,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="book-outline" size={15} color={PALETTE.textPrimary} />
                <Text
                  variant="xs"
                  weight="800"
                  style={{
                    marginLeft: 6,
                    color: PALETTE.textPrimary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Textbooks & References
                </Text>
              </View>
              <View style={{ gap: 5 }}>
                {[
                  ...(selectedCourse.textbooks || []),
                  ...(selectedCourse.references || []),
                ].map((book, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: PALETTE.textMuted, width: 16, lineHeight: 18 }}
                    >
                      {i + 1}.
                    </Text>
                    <Text
                      variant="xs"
                      style={{
                        flex: 1,
                        color: PALETTE.textSecondary,
                        lineHeight: 18,
                      }}
                    >
                      {book}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEVEL 2: SUBJECTS LIST VIEW (When a specific Semester is selected)
  // ═══════════════════════════════════════════════════════════════════════════
  if (selectedSemesterId) {
    const isElectives = selectedSemesterId === 'electives';
    const coursesList = isElectives
      ? visibleElectives
      : activeSemester?.courses || [];

    return (
      <View style={[styles.root, { backgroundColor: PALETTE.background }]}>
        <ScrollView
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Back Navigation Bar */}
          <View style={[styles.topNavRow, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setSelectedSemesterId(null)}
              style={[
                styles.backPillBtn,
                {
                  backgroundColor: PALETTE.surface,
                  borderColor: PALETTE.border,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={15} color={PALETTE.textPrimary} />
              <Text
                variant="xs"
                weight="700"
                style={{ marginLeft: 6, color: PALETTE.textPrimary }}
              >
                All Semesters
              </Text>
            </TouchableOpacity>

            <Caption style={{ color: PALETTE.textMuted, fontWeight: '600' }}>
              {isElectives
                ? '5 Clusters'
                : `Year ${activeSemester?.yearNumber} · Sem ${activeSemester?.semesterRoman}`}
            </Caption>
          </View>

          {/* Compact Overview Strip (No oversized card) */}
          <View
            style={[
              styles.overviewStrip,
              {
                backgroundColor: PALETTE.surface,
                borderColor: PALETTE.border,
                borderRadius: radii.card,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                variant="sm"
                weight="800"
                style={{ color: PALETTE.textPrimary }}
              >
                {isElectives
                  ? 'Specialization Elective Courses'
                  : `Semester ${activeSemester?.semesterRoman} (${activeSemester?.year})`}
              </Text>
              <Caption style={{ color: PALETTE.textMuted, marginTop: 1 }}>
                {isElectives
                  ? 'Prescribed for Semesters VII & VIII'
                  : 'Gandaki University · Bachelor in Information Technology'}
              </Caption>
            </View>

            <View
              style={[
                styles.statBadge,
                {
                  backgroundColor: PALETTE.surfaceRaised,
                  borderColor: PALETTE.borderStrong,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="800"
                style={{ color: PALETTE.textPrimary }}
              >
                {isElectives
                  ? `${ELECTIVE_COURSES.length} Courses`
                  : `${activeSemester?.totalCourses} Subjects · ${activeSemester?.totalCredits} Cr`}
              </Text>
            </View>
          </View>

          {/* Cluster Filter Chips for Electives */}
          {isElectives ? (
            <View style={{ marginBottom: spacing.md }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                <TouchableOpacity
                  onPress={() => setSelectedCluster('ALL')}
                  style={[
                    styles.clusterChip,
                    {
                      backgroundColor:
                        selectedCluster === 'ALL'
                          ? PALETTE.activeBadgeBg
                          : PALETTE.surfaceRaised,
                      borderColor:
                        selectedCluster === 'ALL'
                          ? PALETTE.activeBadgeBg
                          : PALETTE.border,
                      borderRadius: radii.pill,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{
                      color:
                        selectedCluster === 'ALL'
                          ? PALETTE.activeBadgeText
                          : PALETTE.textSecondary,
                    }}
                  >
                    All ({ELECTIVE_COURSES.length})
                  </Text>
                </TouchableOpacity>

                {ELECTIVE_CLUSTERS.map((cl) => {
                  const label = `Cluster ${cl.number}: ${cl.name}`;
                  const active = selectedCluster === label;
                  return (
                    <TouchableOpacity
                      key={cl.id}
                      onPress={() => setSelectedCluster(label)}
                      style={[
                        styles.clusterChip,
                        {
                          backgroundColor: active
                            ? PALETTE.activeBadgeBg
                            : PALETTE.surfaceRaised,
                          borderColor: active
                            ? PALETTE.activeBadgeBg
                            : PALETTE.border,
                          borderRadius: radii.pill,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{
                          color: active
                            ? PALETTE.activeBadgeText
                            : PALETTE.textSecondary,
                        }}
                      >
                        C{cl.number}: {cl.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Prescribed Subjects Section */}
          <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
            <Subheading style={{ fontSize: 14, color: PALETTE.textPrimary, fontWeight: '700' }}>
              Curriculum Subjects ({coursesList.length})
            </Subheading>
            <Caption style={{ color: PALETTE.textMuted }}>Tap subject for micro-syllabus</Caption>
          </View>

          {/* Subject Rows */}
          <View style={{ gap: 8 }}>
            {coursesList.map((course, idx) => (
              <TouchableOpacity
                key={`${course.code}-${course.title}-${idx}`}
                activeOpacity={0.7}
                onPress={() => handleSelectCourse(course)}
                style={[
                  styles.subjectRowCard,
                  {
                    backgroundColor: PALETTE.surface,
                    borderColor: PALETTE.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                {/* Top Row: Course Code Pill + Credit Info + Subtle Notes Action */}
                <View style={styles.subjectRowTop}>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.codePill,
                        {
                          backgroundColor: PALETTE.surfaceRaised,
                          borderColor: PALETTE.borderStrong,
                          borderWidth: 1,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="800"
                        style={{ color: PALETTE.textPrimary, fontSize: 11 }}
                      >
                        {course.code}
                      </Text>
                    </View>

                    <Caption
                      style={{
                        fontWeight: '600',
                        color: PALETTE.textMuted,
                        marginLeft: 4,
                      }}
                    >
                      {course.creditDisplay} Cr · {course.nature}
                    </Caption>
                  </View>

                  {!course.isElectiveSlot ? (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleViewNotesInLibrary(course);
                      }}
                      style={[
                        styles.subjectNotesBtn,
                        {
                          backgroundColor: PALETTE.surfaceRaised,
                          borderColor: PALETTE.border,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Ionicons
                        name="folder-open-outline"
                        size={11}
                        color={PALETTE.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: PALETTE.textSecondary, fontSize: 10.5 }}
                      >
                        Notes
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Subject Name: Prominent & readable */}
                <Text
                  variant="md"
                  weight="700"
                  style={{
                    color: PALETTE.textPrimary,
                    marginTop: 8,
                    lineHeight: 20,
                  }}
                >
                  {course.title}
                </Text>

                {course.cluster ? (
                  <Caption style={{ color: PALETTE.textMuted, marginTop: 2 }}>
                    {course.cluster}
                  </Caption>
                ) : null}

                {/* Subject Card Footer */}
                <View
                  style={[
                    styles.subjectRowFooter,
                    {
                      borderTopColor: PALETTE.borderSubtle,
                      marginTop: 10,
                      paddingTop: 8,
                    },
                  ]}
                >
                  <Caption style={{ color: PALETTE.textMuted }}>
                    {course.isElectiveSlot
                      ? '5 Elective Specialization Clusters'
                      : `${course.units.length} ${
                          course.units.length === 1 ? 'Unit' : 'Units'
                        }${course.totalHours ? ` · ${course.totalHours}` : ''}`}
                  </Caption>

                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: PALETTE.textSecondary, fontSize: 11.5 }}
                    >
                      {course.isElectiveSlot ? 'View Electives' : 'Micro-Syllabus'}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color={PALETTE.textSecondary}
                      style={{ marginLeft: 2 }}
                    />
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEVEL 1: BIT SYLLABUS LANDING PAGE (Grouped by Academic Year)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <View style={[styles.root, { backgroundColor: PALETTE.background }]}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: insets.bottom + 36,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Simplified Page Header */}
        <View style={{ marginBottom: spacing.sm }}>
          <Heading style={{ fontSize: 20, letterSpacing: -0.3, color: PALETTE.textPrimary }}>
            BIT Syllabus
          </Heading>
          <Caption style={{ marginTop: 2, color: PALETTE.textMuted, fontWeight: '500' }}>
            Gandaki University · 4 Years · 8 Semesters · 138 Credits
          </Caption>
        </View>

        {/* Compact Search Field */}
        <View
          style={[
            styles.searchContainer,
            {
              backgroundColor: PALETTE.surface,
              borderColor: PALETTE.border,
              borderRadius: radii.sm,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={16}
            color={PALETTE.textMuted}
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search subject name or course code..."
            placeholderTextColor={PALETTE.textMuted}
            style={[styles.searchInput, { color: PALETTE.textPrimary }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={17} color={PALETTE.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* If Searching: Display Matching Subjects Directly */}
        {searchQuery.trim().length > 0 ? (
          <View>
            <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
              <Subheading style={{ fontSize: 14, color: PALETTE.textPrimary, fontWeight: '700' }}>
                Search Results ({searchResults.length})
              </Subheading>
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Caption style={{ color: PALETTE.textSecondary, fontWeight: '700' }}>
                  Clear
                </Caption>
              </TouchableOpacity>
            </View>

            {searchResults.length === 0 ? (
              <View
                style={[
                  styles.emptyStateCard,
                  {
                    backgroundColor: PALETTE.surface,
                    borderColor: PALETTE.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <Ionicons name="search-outline" size={24} color={PALETTE.textMuted} />
                <Text
                  variant="sm"
                  weight="600"
                  style={{ marginTop: 8, color: PALETTE.textSecondary }}
                >
                  No subjects found for &quot;{searchQuery}&quot;
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {searchResults.map((course, idx) => (
                  <TouchableOpacity
                    key={`${course.code}-${course.title}-${idx}`}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSearchQuery('');
                      handleSelectCourse(course);
                    }}
                    style={[
                      styles.searchResultItem,
                      {
                        backgroundColor: PALETTE.surface,
                        borderColor: PALETTE.border,
                        borderRadius: radii.card,
                      },
                    ]}
                  >
                    <View style={styles.subjectRowTop}>
                      <View style={styles.badgeRow}>
                        <View
                          style={[
                            styles.codePill,
                            {
                              backgroundColor: PALETTE.surfaceRaised,
                              borderColor: PALETTE.borderStrong,
                              borderWidth: 1,
                              borderRadius: radii.sm,
                            },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="800"
                            style={{ color: PALETTE.textPrimary, fontSize: 11 }}
                          >
                            {course.code}
                          </Text>
                        </View>
                        <Caption style={{ color: PALETTE.textMuted, marginLeft: 4 }}>
                          Sem {course.semester} · {course.creditDisplay} Cr
                        </Caption>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={15}
                        color={PALETTE.textMuted}
                      />
                    </View>
                    <Text
                      variant="sm"
                      weight="700"
                      style={{ color: PALETTE.textPrimary, marginTop: 6 }}
                    >
                      {course.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          /* Grouped by Academic Year: Year 1 to Year 4 */
          <View style={{ gap: spacing.md }}>
            {yearGroups.map((group) => {
              const yearTotalCourses = group.semesters.reduce(
                (sum, s) => sum + s.totalCourses,
                0
              );
              const yearTotalCredits = group.semesters.reduce(
                (sum, s) => sum + s.totalCredits,
                0
              );

              return (
                <View key={`year-${group.yearNumber}`}>
                  {/* Academic Year Group Header */}
                  <View style={[styles.sectionHeaderRow, { marginBottom: 8 }]}>
                    <Text
                      variant="xs"
                      weight="800"
                      style={{
                        color: PALETTE.textSecondary,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                      }}
                    >
                      {group.yearLabel} · {group.yearSubtitle.split('(')[0].trim()}
                    </Text>
                    <Caption style={{ color: PALETTE.textMuted }}>
                      {yearTotalCourses} Subjects · {yearTotalCredits} Cr
                    </Caption>
                  </View>

                  {/* 2-Column Responsive Semester Cards Grid */}
                  <View
                    style={[
                      styles.semesterGrid,
                      isNarrowScreen && { flexDirection: 'column' },
                    ]}
                  >
                    {group.semesters.map((sem) => {
                      const isMySem = semesterRoman === sem.semesterRoman;

                      return (
                        <TouchableOpacity
                          key={sem.id}
                          activeOpacity={0.7}
                          onPress={() => setSelectedSemesterId(sem.id)}
                          style={[
                            styles.semesterCard,
                            {
                              width: isNarrowScreen ? '100%' : '48.5%',
                              backgroundColor: PALETTE.surface,
                              borderColor: isMySem
                                ? PALETTE.borderStrong
                                : PALETTE.border,
                              borderWidth: 1,
                              borderRadius: radii.card,
                            },
                          ]}
                        >
                          <View style={styles.semesterCardTop}>
                            <View
                              style={[
                                styles.semBadge,
                                {
                                  backgroundColor: isMySem
                                    ? PALETTE.activeBadgeBg
                                    : PALETTE.surfaceRaised,
                                  borderColor: isMySem
                                    ? PALETTE.activeBadgeBg
                                    : PALETTE.borderStrong,
                                  borderRadius: radii.sm,
                                },
                              ]}
                            >
                              <Text
                                variant="xs"
                                weight="800"
                                style={{
                                  color: isMySem
                                    ? PALETTE.activeBadgeText
                                    : PALETTE.textPrimary,
                                  fontSize: 10.5,
                                }}
                              >
                                SEM {sem.semesterRoman}
                              </Text>
                            </View>

                            {isMySem ? (
                              <View style={styles.currentIndicator}>
                                <View style={styles.currentDot} />
                                <Caption
                                  style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: PALETTE.textPrimary,
                                  }}
                                >
                                  Current
                                </Caption>
                              </View>
                            ) : null}
                          </View>

                          <Text
                            variant="md"
                            weight="800"
                            style={{
                              color: PALETTE.textPrimary,
                              marginTop: 10,
                            }}
                          >
                            Semester {sem.semesterRoman}
                          </Text>

                          <Caption
                            style={{
                              color: PALETTE.textMuted,
                              marginTop: 2,
                              fontSize: 11.5,
                            }}
                          >
                            {sem.totalCourses} Subjects · {sem.totalCredits} Credits
                          </Caption>

                          <View
                            style={[
                              styles.semesterCardFooter,
                              {
                                borderTopColor: PALETTE.borderSubtle,
                                marginTop: 10,
                                paddingTop: 8,
                              },
                            ]}
                          >
                            <Text
                              variant="xs"
                              weight="700"
                              style={{ color: PALETTE.textSecondary, fontSize: 11 }}
                            >
                              View Subjects
                            </Text>
                            <Ionicons
                              name="arrow-forward"
                              size={12}
                              color={PALETTE.textSecondary}
                            />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {/* Elective Specialization Tracks Section */}
            <View style={{ marginTop: 4 }}>
              <View style={[styles.sectionHeaderRow, { marginBottom: 8 }]}>
                <Text
                  variant="xs"
                  weight="800"
                  style={{
                    color: PALETTE.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  Specialization Tracks
                </Text>
                <Caption style={{ color: PALETTE.textMuted }}>Sem VII & VIII</Caption>
              </View>

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setSelectedSemesterId('electives')}
                style={[
                  styles.electivesCard,
                  {
                    backgroundColor: PALETTE.surface,
                    borderColor: PALETTE.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.semBadge,
                        {
                          backgroundColor: PALETTE.surfaceRaised,
                          borderColor: PALETTE.borderStrong,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="800"
                        style={{ color: PALETTE.textPrimary, fontSize: 10.5 }}
                      >
                        5 Clusters
                      </Text>
                    </View>
                    <Caption
                      style={{
                        color: PALETTE.textMuted,
                        fontWeight: '600',
                        fontSize: 11,
                      }}
                    >
                      {ELECTIVE_COURSES.length} Elective Subjects
                    </Caption>
                  </View>

                  <Text
                    variant="md"
                    weight="800"
                    style={{
                      color: PALETTE.textPrimary,
                      marginTop: 8,
                    }}
                  >
                    Elective Specialization Courses
                  </Text>
                  <Caption
                    style={{
                      color: PALETTE.textMuted,
                      marginTop: 2,
                      fontSize: 11.5,
                    }}
                  >
                    AI/ML, Data Science, Cloud/IoT, E-Gov & Software Engineering
                  </Caption>
                </View>

                <View
                  style={[
                    styles.iconCircle,
                    {
                      backgroundColor: PALETTE.surfaceRaised,
                      borderColor: PALETTE.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={PALETTE.textPrimary}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  semesterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  semesterCard: {
    padding: 12,
  },
  semesterCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  semBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderWidth: 1,
  },
  currentIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.textPrimary,
  },
  semesterCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  electivesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 14,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  notesHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  overviewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    marginLeft: 8,
  },
  clusterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  subjectRowCard: {
    borderWidth: 1,
    padding: 12,
  },
  subjectRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subjectRowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subjectNotesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderWidth: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  codePill: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  metaPill: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderWidth: 1,
  },
  subjectHeaderCard: {
    borderWidth: 1,
    padding: 14,
  },
  overviewCard: {
    borderWidth: 1,
    padding: 12,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  unitAccordionCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  unitAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 12,
  },
  unitMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  unitNumBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderWidth: 1,
  },
  unitActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    marginTop: 2,
  },
  unitNotesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
  },
  unitTopicsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  extraSectionCard: {
    borderWidth: 1,
    padding: 12,
  },
  emptyStateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    padding: 24,
  },
  searchResultItem: {
    borderWidth: 1,
    padding: 12,
  },
});
