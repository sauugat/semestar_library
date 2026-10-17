import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import {
  BIT_PROGRAM_INFO,
  BIT_SEMESTERS,
  ELECTIVE_CLUSTERS,
  ELECTIVE_COURSES,
  SyllabusCourse,
  SyllabusSemester,
  findSyllabusCourse,
  searchSyllabusCourses,
} from '@/constants/syllabusData';

type FilterTabId =
  | 'all'
  | 'I'
  | 'II'
  | 'III'
  | 'IV'
  | 'V'
  | 'VI'
  | 'VII'
  | 'VIII'
  | 'electives'
  | 'overview';

const FILTER_TABS: { id: FilterTabId; label: string; shortLabel: string }[] = [
  { id: 'all', label: 'All Semesters', shortLabel: 'All' },
  { id: 'I', label: 'Semester I', shortLabel: 'Sem I' },
  { id: 'II', label: 'Semester II', shortLabel: 'Sem II' },
  { id: 'III', label: 'Semester III', shortLabel: 'Sem III' },
  { id: 'IV', label: 'Semester IV', shortLabel: 'Sem IV' },
  { id: 'V', label: 'Semester V', shortLabel: 'Sem V' },
  { id: 'VI', label: 'Semester VI', shortLabel: 'Sem VI' },
  { id: 'VII', label: 'Semester VII', shortLabel: 'Sem VII' },
  { id: 'VIII', label: 'Semester VIII', shortLabel: 'Sem VIII' },
  { id: 'electives', label: 'Electives (5 Clusters)', shortLabel: 'Electives' },
  { id: 'overview', label: 'Program & Rules', shortLabel: 'Program Info' },
];

export default function SyllabusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { semesterRoman } = useAcademicContext();
  const params = useLocalSearchParams<{ course?: string; semester?: string; tab?: string }>();

  const initialTab = useMemo<FilterTabId>(() => {
    if (params.tab === 'electives') return 'electives';
    if (params.tab === 'overview') return 'overview';
    if (params.semester) {
      const s = params.semester.toUpperCase().trim();
      if (['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].includes(s)) {
        return s as FilterTabId;
      }
    }
    return 'all';
  }, [params.tab, params.semester]);

  const [activeTab, setActiveTab] = useState<FilterTabId>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<string>('ALL');
  const [selectedCourse, setSelectedCourse] = useState<SyllabusCourse | null>(() => {
    if (params.course) {
      return findSyllabusCourse(params.course);
    }
    return null;
  });
  const [collapsedUnits, setCollapsedUnits] = useState<Record<number, boolean>>({});

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchSyllabusCourses(searchQuery);
  }, [searchQuery]);

  const visibleSemesters = useMemo<SyllabusSemester[]>(() => {
    if (activeTab === 'all') return BIT_SEMESTERS;
    if (['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].includes(activeTab)) {
      return BIT_SEMESTERS.filter((s) => s.semesterRoman === activeTab);
    }
    return [];
  }, [activeTab]);

  const visibleElectives = useMemo<SyllabusCourse[]>(() => {
    if (selectedCluster === 'ALL') return ELECTIVE_COURSES;
    return ELECTIVE_COURSES.filter((c) => c.cluster === selectedCluster);
  }, [selectedCluster]);

  const handleOpenCourse = (course: SyllabusCourse) => {
    if (course.isElectiveSlot) {
      setActiveTab('electives');
      return;
    }
    setCollapsedUnits({});
    setSelectedCourse(course);
  };

  const toggleUnit = (unitNum: number) => {
    setCollapsedUnits((prev) => ({
      ...prev,
      [unitNum]: !prev[unitNum],
    }));
  };

  const renderCourseCard = (course: SyllabusCourse, index?: number) => {
    const isTheoryPractical = course.nature === 'TH + PR';
    const isPracticalOnly = course.nature === 'PR';

    return (
      <TouchableOpacity
        key={`${course.code}-${course.title}-${index ?? 0}`}
        activeOpacity={0.75}
        onPress={() => handleOpenCourse(course)}
        style={[
          styles.courseCard,
          {
            backgroundColor: colors.surface,
            borderColor: course.isElectiveSlot ? colors.borderStrong : colors.border,
            borderRadius: radii.card,
          },
        ]}
      >
        {/* Top Metadata Row */}
        <View style={styles.courseCardTop}>
          <View style={styles.courseBadgeGroup}>
            <View
              style={[
                styles.codePill,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text
                variant="xs"
                weight="800"
                style={{ color: colors.primaryText, letterSpacing: 0.4 }}
              >
                {course.code}
              </Text>
            </View>

            <View
              style={[
                styles.metaPill,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                {course.creditDisplay} {course.credit === 1 ? 'Credit' : 'Credits'}
              </Text>
            </View>

            <View
              style={[
                styles.metaPill,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.borderSubtle,
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text variant="xs" weight="600" style={{ color: colors.textMuted }}>
                {isTheoryPractical
                  ? 'Theory + Lab'
                  : isPracticalOnly
                  ? 'Practical / Project'
                  : 'Theory'}
              </Text>
            </View>
          </View>

          {course.totalHours ? (
            <Caption color="muted" style={{ fontWeight: '600' }}>
              {course.totalHours}
            </Caption>
          ) : null}
        </View>

        {/* Course Title */}
        <Text
          variant="md"
          weight="700"
          style={{ color: colors.text, marginTop: 10, lineHeight: 21 }}
        >
          {course.title}
        </Text>

        {/* Cluster Tag for Electives */}
        {course.cluster ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Ionicons
              name="layers-outline"
              size={12}
              color={colors.textMuted}
              style={{ marginRight: 4 }}
            />
            <Caption color="muted" style={{ fontWeight: '600' }}>
              {course.cluster}
            </Caption>
          </View>
        ) : null}

        {/* Brief Objective Preview */}
        {course.objectives && course.objectives.length > 0 ? (
          <Text
            variant="xs"
            color="secondary"
            numberOfLines={2}
            style={{ marginTop: 6, lineHeight: 17 }}
          >
            {course.objectives[0]}
          </Text>
        ) : null}

        {/* Footer Info Row */}
        <View
          style={[
            styles.courseCardFooter,
            {
              borderTopColor: colors.borderSubtle,
              marginTop: 12,
              paddingTop: 10,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons
                name="book-outline"
                size={13}
                color={colors.textMuted}
                style={{ marginRight: 4 }}
              />
              <Caption color="muted">
                {course.isElectiveSlot
                  ? '5 Specialization Clusters'
                  : `${course.units.length} ${course.units.length === 1 ? 'Unit' : 'Units'}`}
              </Caption>
            </View>

            {course.laboratoryWork && course.laboratoryWork.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name="flask-outline"
                  size={13}
                  color={colors.textMuted}
                  style={{ marginRight: 4 }}
                />
                <Caption color="muted">Lab Work</Caption>
              </View>
            ) : null}

            {(course.textbooks?.length || 0) + (course.references?.length || 0) > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name="library-outline"
                  size={13}
                  color={colors.textMuted}
                  style={{ marginRight: 4 }}
                />
                <Caption color="muted">
                  {(course.textbooks?.length || 0) + (course.references?.length || 0)} Refs
                </Caption>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="xs" weight="700" style={{ color: colors.text }}>
              {course.isElectiveSlot ? 'Browse Electives' : 'Micro-Syllabus'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.text}
              style={{ marginLeft: 3 }}
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: spacing.md, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Banner Card */}
        <View
          style={[
            styles.heroBanner,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              marginTop: spacing.sm,
            },
          ]}
        >
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.universityBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Ionicons name="school-outline" size={13} color={colors.text} style={{ marginRight: 5 }} />
              <Text variant="xs" weight="800" style={{ color: colors.text, letterSpacing: 0.6 }}>
                GANDAKI UNIVERSITY · BIT
              </Text>
            </View>

            {semesterRoman ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setActiveTab(semesterRoman as FilterTabId)}
                style={[
                  styles.mySemPill,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Text variant="xs" weight="800" style={{ color: colors.primaryText }}>
                  My Sem: {semesterRoman}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Heading style={{ fontSize: 22, marginTop: 10, letterSpacing: -0.3 }}>
            Bachelor of Information Technology
          </Heading>
          <Text variant="xs" color="secondary" style={{ marginTop: 4, lineHeight: 18 }}>
            Official 4-Year / 8-Semester Curriculum & Micro-Syllabus Bulletin (138 Credit Hours)
          </Text>

          {/* Metrics Strip */}
          <View
            style={[
              styles.metricsStrip,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.md,
                marginTop: 14,
              },
            ]}
          >
            <View style={styles.metricBox}>
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                {BIT_PROGRAM_INFO.durationYears}
              </Text>
              <Caption color="muted">Years</Caption>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metricBox}>
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                {BIT_PROGRAM_INFO.totalSemesters}
              </Text>
              <Caption color="muted">Semesters</Caption>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metricBox}>
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                {BIT_PROGRAM_INFO.totalCourses}
              </Text>
              <Caption color="muted">Courses</Caption>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metricBox}>
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                {BIT_PROGRAM_INFO.totalCredits}
              </Text>
              <Caption color="muted">Credits</Caption>
            </View>
          </View>
        </View>

        {/* Search Input Bar */}
        <View
          style={[
            styles.searchContainer,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.input,
              marginTop: spacing.sm,
            },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search course code, subject, unit, or topic (e.g. CIT214, Docker, AI)..."
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Horizontal Filter Tabs (hidden when searching) */}
        {!searchQuery.trim() ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScrollContainer}
            style={{ marginTop: spacing.sm, marginBottom: spacing.xs }}
          >
            {FILTER_TABS.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  activeOpacity={0.75}
                  onPress={() => setActiveTab(tab.id)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surface,
                      borderColor: isSelected ? colors.primary : colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{
                      color: isSelected ? colors.primaryText : colors.textSecondary,
                    }}
                  >
                    {tab.shortLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* ─── SEARCH RESULTS VIEW ─── */}
        {searchQuery.trim().length > 0 ? (
          <View style={{ marginTop: spacing.sm }}>
            <View style={styles.sectionHeaderRow}>
              <Subheading style={{ fontSize: 15 }}>
                Search Results ({searchResults.length})
              </Subheading>
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Caption style={{ color: colors.textSecondary, fontWeight: '600' }}>
                  Clear Search
                </Caption>
              </TouchableOpacity>
            </View>

            {searchResults.length === 0 ? (
              <Card
                variant="elevated"
                padding="lg"
                style={{ alignItems: 'center', marginTop: spacing.sm, borderColor: colors.border }}
              >
                <Ionicons name="search-outline" size={32} color={colors.textMuted} />
                <Text variant="md" weight="700" style={{ marginTop: 10 }}>
                  No matching courses or topics
                </Text>
                <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
                  Try searching by course code (e.g. CIT111, ELX211) or topic (e.g. Pointer, SQL, Kubernetes).
                </Caption>
              </Card>
            ) : (
              searchResults.map((course, idx) => renderCourseCard(course, idx))
            )}
          </View>
        ) : null}

        {/* ─── SEMESTERS & COURSES VIEW ─── */}
        {!searchQuery.trim() && visibleSemesters.length > 0 ? (
          <View>
            {visibleSemesters.map((sem) => (
              <View key={sem.id} style={{ marginTop: spacing.md }}>
                {/* Semester Banner Header */}
                <View
                  style={[
                    styles.semesterHeaderCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.borderStrong,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.semesterHeaderTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View
                        style={[
                          styles.semBadgePill,
                          { backgroundColor: colors.primary, borderRadius: radii.sm },
                        ]}
                      >
                        <Text variant="xs" weight="800" style={{ color: colors.primaryText }}>
                          SEMESTER {sem.semesterRoman}
                        </Text>
                      </View>
                      <Caption style={{ color: colors.textSecondary, fontWeight: '700' }}>
                        {sem.year}
                      </Caption>
                    </View>

                    <View
                      style={[
                        styles.semCreditPill,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {sem.totalCourses} Courses · {sem.totalCredits} Credits
                      </Text>
                    </View>
                  </View>

                  <Text
                    variant="xs"
                    color="secondary"
                    style={{ marginTop: 8, lineHeight: 17 }}
                  >
                    {sem.description}
                  </Text>
                </View>

                {/* Courses in Semester */}
                <View style={{ marginTop: spacing.sm }}>
                  {sem.courses.map((course, idx) => renderCourseCard(course, idx))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ─── ELECTIVES VIEW ─── */}
        {!searchQuery.trim() && activeTab === 'electives' ? (
          <View style={{ marginTop: spacing.md }}>
            <View
              style={[
                styles.semesterHeaderCard,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.card,
                  marginBottom: spacing.sm,
                },
              ]}
            >
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                Elective Specialization Clusters (Semesters VII & VIII)
              </Text>
              <Text variant="xs" color="secondary" style={{ marginTop: 4, lineHeight: 18 }}>
                Students choose Elective I (Semester VII, 3 Credits) and Elective II (Semester VIII, 3 Credits) from 5 specialized tracks.
              </Text>

              {/* Cluster Filter Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingTop: 12 }}
              >
                <TouchableOpacity
                  onPress={() => setSelectedCluster('ALL')}
                  style={[
                    styles.clusterFilterChip,
                    {
                      backgroundColor:
                        selectedCluster === 'ALL' ? colors.primary : colors.surface,
                      borderColor:
                        selectedCluster === 'ALL' ? colors.primary : colors.border,
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
                          ? colors.primaryText
                          : colors.textSecondary,
                    }}
                  >
                    All Clusters ({ELECTIVE_COURSES.length})
                  </Text>
                </TouchableOpacity>

                {ELECTIVE_CLUSTERS.map((cl) => {
                  const fullLabel = `Cluster ${cl.number}: ${cl.name}`;
                  const active = selectedCluster === fullLabel;
                  return (
                    <TouchableOpacity
                      key={cl.id}
                      onPress={() => setSelectedCluster(fullLabel)}
                      style={[
                        styles.clusterFilterChip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{
                          color: active ? colors.primaryText : colors.textSecondary,
                        }}
                      >
                        Cluster {cl.number}: {cl.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {visibleElectives.map((course, idx) => renderCourseCard(course, idx))}
          </View>
        ) : null}

        {/* ─── PROGRAM OVERVIEW & STRUCTURE TABLE VIEW ─── */}
        {!searchQuery.trim() && activeTab === 'overview' ? (
          <View style={{ marginTop: spacing.md, gap: 14 }}>
            {/* University & Program Summary Card */}
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.infoCardHeader}>
                <Ionicons name="business-outline" size={18} color={colors.text} />
                <Text variant="md" weight="800" style={{ marginLeft: 8 }}>
                  Gandaki University & BIT Vision
                </Text>
              </View>
              <Text variant="xs" color="secondary" style={{ lineHeight: 19, marginTop: 8 }}>
                {BIT_PROGRAM_INFO.vision}
              </Text>
              <Text variant="xs" color="secondary" style={{ lineHeight: 19, marginTop: 8 }}>
                {BIT_PROGRAM_INFO.mission}
              </Text>
            </View>

            {/* Complete 8-Semester Credit Breakdown Table */}
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.infoCardHeader}>
                <Ionicons name="grid-outline" size={18} color={colors.text} />
                <Text variant="md" weight="800" style={{ marginLeft: 8 }}>
                  Official 8-Semester Credit Structure
                </Text>
              </View>
              <Caption color="muted" style={{ marginTop: 4, marginBottom: 10 }}>
                Tap any semester row to inspect its prescribed courses
              </Caption>

              {BIT_SEMESTERS.map((sem) => (
                <TouchableOpacity
                  key={sem.id}
                  activeOpacity={0.7}
                  onPress={() => setActiveTab(sem.semesterRoman as FilterTabId)}
                  style={[
                    styles.tableRow,
                    { borderBottomColor: colors.borderSubtle },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      {sem.year} · Semester {sem.semesterRoman}
                    </Text>
                    <Caption color="muted">
                      {sem.courses.map((c) => c.code).join(', ')}
                    </Caption>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="xs" weight="800" style={{ color: colors.text }}>
                      {sem.totalCredits} Credits
                    </Text>
                    <Caption color="muted">{sem.totalCourses} Courses</Caption>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={15}
                    color={colors.textMuted}
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              ))}

              <View
                style={[
                  styles.tableTotalRow,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderRadius: radii.sm,
                    marginTop: 10,
                  },
                ]}
              >
                <Text variant="sm" weight="800" style={{ color: colors.text }}>
                  Total Degree Load
                </Text>
                <Text variant="sm" weight="800" style={{ color: colors.text }}>
                  47 Courses · 138 Credit Hours
                </Text>
              </View>
            </View>

            {/* Key Learning Outcomes */}
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.infoCardHeader}>
                <Ionicons name="checkmark-done-circle-outline" size={18} color={colors.text} />
                <Text variant="md" weight="800" style={{ marginLeft: 8 }}>
                  Key Program Learning Outcomes
                </Text>
              </View>
              <View style={{ marginTop: 8, gap: 8 }}>
                {BIT_PROGRAM_INFO.learningOutcomes.map((item, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <Text variant="xs" weight="800" style={{ color: colors.textMuted, width: 20 }}>
                      {idx + 1}.
                    </Text>
                    <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Admission Eligibility & Education System */}
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.infoCardHeader}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.text} />
                <Text variant="md" weight="800" style={{ marginLeft: 8 }}>
                  Eligibility & Academic Rules
                </Text>
              </View>
              <Text variant="xs" weight="700" style={{ color: colors.text, marginTop: 10 }}>
                Admission Eligibility
              </Text>
              <Text variant="xs" color="secondary" style={{ lineHeight: 18, marginTop: 4 }}>
                {BIT_PROGRAM_INFO.eligibility}
              </Text>

              <Text variant="xs" weight="700" style={{ color: colors.text, marginTop: 12 }}>
                Education System & Evaluation
              </Text>
              <View style={{ marginTop: 6, gap: 6 }}>
                {BIT_PROGRAM_INFO.educationSystem.map((rule, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                      •
                    </Text>
                    <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                      {rule}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Career Prospects */}
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.infoCardHeader}>
                <Ionicons name="briefcase-outline" size={18} color={colors.text} />
                <Text variant="md" weight="800" style={{ marginLeft: 8 }}>
                  Career Prospects for BIT Graduates
                </Text>
              </View>
              <View style={styles.careerChipsWrap}>
                {BIT_PROGRAM_INFO.careerProspects.map((role, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.careerChip,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: colors.textSecondary }}>
                      {role}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* ─── FULL MICRO-SYLLABUS MODAL ─── */}
      <Modal
        visible={Boolean(selectedCourse)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedCourse(null)}
      >
        {selectedCourse ? (
          <SafeAreaView
            style={[styles.modalRoot, { backgroundColor: colors.background }]}
            edges={['top', 'bottom']}
          >
            <StatusBar barStyle="light-content" />
            {/* Sticky Modal Top Bar */}
            <View
              style={[
                styles.modalTopBar,
                {
                  backgroundColor: colors.surface,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => setSelectedCourse(null)}
                style={[
                  styles.modalCloseBtn,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons name="arrow-back" size={16} color={colors.text} />
                <Text variant="xs" weight="700" style={{ marginLeft: 5, color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>

              <View style={{ flex: 1, marginHorizontal: 12, alignItems: 'center' }}>
                <Text variant="xs" weight="800" numberOfLines={1} style={{ color: colors.text }}>
                  {selectedCourse.code} · Micro-Syllabus
                </Text>
                <Caption color="muted" numberOfLines={1}>
                  {selectedCourse.year} · Semester {selectedCourse.semester}
                </Caption>
              </View>

              <TouchableOpacity
                onPress={() => {
                  const title = selectedCourse.title;
                  const sem = selectedCourse.semester;
                  setSelectedCourse(null);
                  router.push({
                    pathname: '/(tabs)/library',
                    params: { subject: title, semester: `Semester ${sem}` },
                  } as any);
                }}
                style={[
                  styles.modalLibraryBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Ionicons name="folder-open-outline" size={14} color={colors.primaryText} />
                <Text
                  variant="xs"
                  weight="800"
                  style={{ marginLeft: 4, color: colors.primaryText }}
                >
                  Notes
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{
                padding: spacing.md,
                paddingBottom: insets.bottom + 36,
                gap: 14,
              }}
              showsVerticalScrollIndicator={false}
            >
              {/* Course Hero Card */}
              <View
                style={[
                  styles.detailCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <View style={styles.courseBadgeGroup}>
                  <View
                    style={[
                      styles.codePill,
                      { backgroundColor: colors.primary, borderRadius: radii.sm },
                    ]}
                  >
                    <Text variant="xs" weight="800" style={{ color: colors.primaryText }}>
                      {selectedCourse.code}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaPill,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {selectedCourse.creditDisplay} Credit Hours
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaPill,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                      Nature: {selectedCourse.nature}
                    </Text>
                  </View>
                  {selectedCourse.totalHours ? (
                    <View
                      style={[
                        styles.metaPill,
                        {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.border,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                        {selectedCourse.totalHours}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Heading style={{ fontSize: 21, marginTop: 12, lineHeight: 27 }}>
                  {selectedCourse.title}
                </Heading>

                <Caption color="muted" style={{ marginTop: 4 }}>
                  {selectedCourse.cluster
                    ? `${selectedCourse.cluster} · Elective Course`
                    : `${selectedCourse.year} · Semester ${selectedCourse.semester} · Bachelor of Information Technology (BIT)`}
                </Caption>

                {selectedCourse.note ? (
                  <View
                    style={[
                      styles.noteBanner,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                        marginTop: 10,
                      },
                    ]}
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={15}
                      color={colors.textSecondary}
                      style={{ marginRight: 6, marginTop: 1 }}
                    />
                    <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 17 }}>
                      {selectedCourse.note}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Prerequisites */}
              {selectedCourse.prerequisites && selectedCourse.prerequisites.length > 0 ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="git-branch-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Prerequisites
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {selectedCourse.prerequisites.map((pre, i) => (
                      <View
                        key={i}
                        style={[
                          styles.careerChip,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="600" style={{ color: colors.textSecondary }}>
                          {pre}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Course Objectives */}
              {selectedCourse.objectives && selectedCourse.objectives.length > 0 ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="compass-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Course Objectives
                    </Text>
                  </View>
                  <View style={{ marginTop: 8, gap: 6 }}>
                    {selectedCourse.objectives.map((obj, i) => (
                      <View key={i} style={styles.bulletRow}>
                        <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                          •
                        </Text>
                        <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 19 }}>
                          {obj}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Course Description */}
              {selectedCourse.description ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="document-text-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Course Description
                    </Text>
                  </View>
                  <Text variant="xs" color="secondary" style={{ marginTop: 8, lineHeight: 19 }}>
                    {selectedCourse.description}
                  </Text>
                </View>
              ) : null}

              {/* Course Outcomes */}
              {selectedCourse.outcomes && selectedCourse.outcomes.length > 0 ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="ribbon-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Course Outcomes
                    </Text>
                  </View>
                  <View style={{ marginTop: 8, gap: 6 }}>
                    {selectedCourse.outcomes.map((out, i) => (
                      <View key={i} style={styles.bulletRow}>
                        <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                          ✓
                        </Text>
                        <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 19 }}>
                          {out}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Unit-by-Unit Course Contents */}
              <View
                style={[
                  styles.detailCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="layers-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Detailed Unit Syllabus ({selectedCourse.units.length}{' '}
                      {selectedCourse.units.length === 1 ? 'Unit' : 'Units'})
                    </Text>
                  </View>

                  {selectedCourse.units.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => {
                        const anyCollapsed = selectedCourse.units.some(
                          (u) => collapsedUnits[u.unitNumber]
                        );
                        if (anyCollapsed) {
                          setCollapsedUnits({});
                        } else {
                          const next: Record<number, boolean> = {};
                          selectedCourse.units.forEach((u) => {
                            next[u.unitNumber] = true;
                          });
                          setCollapsedUnits(next);
                        }
                      }}
                    >
                      <Caption style={{ color: colors.textSecondary, fontWeight: '700' }}>
                        {selectedCourse.units.some((u) => collapsedUnits[u.unitNumber])
                          ? 'Expand All'
                          : 'Collapse All'}
                      </Caption>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={{ gap: 10 }}>
                  {selectedCourse.units.map((unit) => {
                    const isCollapsed = Boolean(collapsedUnits[unit.unitNumber]);
                    return (
                      <View
                        key={unit.unitNumber}
                        style={[
                          styles.unitBox,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.md,
                          },
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.75}
                          onPress={() => toggleUnit(unit.unitNumber)}
                          style={styles.unitBoxHeader}
                        >
                          <View
                            style={[
                              styles.unitNumBadge,
                              {
                                backgroundColor: colors.primary,
                                borderRadius: radii.sm,
                              },
                            ]}
                          >
                            <Text
                              variant="xs"
                              weight="800"
                              style={{ color: colors.primaryText }}
                            >
                              U{unit.unitNumber}
                            </Text>
                          </View>

                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text
                              variant="sm"
                              weight="700"
                              style={{ color: colors.text, lineHeight: 19 }}
                            >
                              {unit.title}
                            </Text>
                          </View>

                          {unit.hours ? (
                            <View
                              style={[
                                styles.unitHoursBadge,
                                {
                                  backgroundColor: colors.surface,
                                  borderColor: colors.border,
                                  borderRadius: radii.sm,
                                },
                              ]}
                            >
                              <Text
                                variant="xs"
                                weight="700"
                                style={{ color: colors.textSecondary }}
                              >
                                {unit.hours}
                              </Text>
                            </View>
                          ) : null}

                          <Ionicons
                            name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                            size={16}
                            color={colors.textMuted}
                            style={{ marginLeft: 6 }}
                          />
                        </TouchableOpacity>

                        {!isCollapsed ? (
                          <View
                            style={[
                              styles.unitTopicsContainer,
                              { borderTopColor: colors.borderSubtle },
                            ]}
                          >
                            {unit.topics.map((topic, tIdx) => (
                              <View key={tIdx} style={styles.bulletRow}>
                                <Text
                                  variant="xs"
                                  style={{ color: colors.textMuted, width: 14 }}
                                >
                                  •
                                </Text>
                                <Text
                                  variant="xs"
                                  color="secondary"
                                  style={{ flex: 1, lineHeight: 18 }}
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
              </View>

              {/* Project Guidelines / Report Format Standards */}
              {selectedCourse.projectGuidelines ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="construct-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Project Requirements & Report Standards
                    </Text>
                  </View>

                  {selectedCourse.projectGuidelines.phases ? (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      {selectedCourse.projectGuidelines.phases.map((ph, i) => (
                        <View
                          key={i}
                          style={{
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderWidth: 1,
                            borderRadius: radii.sm,
                            padding: 10,
                          }}
                        >
                          <Text variant="xs" weight="800" style={{ color: colors.text }}>
                            {ph.title}
                          </Text>
                          <Text
                            variant="xs"
                            color="secondary"
                            style={{ marginTop: 3, lineHeight: 18 }}
                          >
                            {ph.description}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {selectedCourse.projectGuidelines.requirements ? (
                    <View style={{ marginTop: 10, gap: 5 }}>
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Course Requirements
                      </Text>
                      {selectedCourse.projectGuidelines.requirements.map((req, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                            •
                          </Text>
                          <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                            {req}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {selectedCourse.projectGuidelines.documentItems ? (
                    <View style={{ marginTop: 10, gap: 5 }}>
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Prescribed Report Deliverables
                      </Text>
                      {selectedCourse.projectGuidelines.documentItems.map((item, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                            •
                          </Text>
                          <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                            {item}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {selectedCourse.projectGuidelines.reportFormat ? (
                    <View style={{ marginTop: 10, gap: 5 }}>
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        Formatting Standards (Gandaki University)
                      </Text>
                      {selectedCourse.projectGuidelines.reportFormat.map((fmt, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                            •
                          </Text>
                          <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                            {fmt}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Laboratory / Practical Work */}
              {selectedCourse.laboratoryWork && selectedCourse.laboratoryWork.length > 0 ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="flask-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Laboratory & Practical Work
                    </Text>
                  </View>
                  <View style={{ marginTop: 8, gap: 6 }}>
                    {selectedCourse.laboratoryWork.map((labItem, i) => (
                      <View key={i} style={styles.bulletRow}>
                        <Text variant="xs" style={{ color: colors.textMuted, width: 14 }}>
                          •
                        </Text>
                        <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 19 }}>
                          {labItem}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Textbooks & References */}
              {(selectedCourse.textbooks && selectedCourse.textbooks.length > 0) ||
              (selectedCourse.references && selectedCourse.references.length > 0) ? (
                <View
                  style={[
                    styles.detailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="library-outline" size={16} color={colors.text} />
                    <Text variant="sm" weight="800" style={{ marginLeft: 6 }}>
                      Textbooks & Reference Books
                    </Text>
                  </View>

                  {selectedCourse.textbooks && selectedCourse.textbooks.length > 0 ? (
                    <View style={{ marginTop: 8, gap: 6 }}>
                      <Caption style={{ color: colors.text, fontWeight: '700' }}>
                        Textbooks
                      </Caption>
                      {selectedCourse.textbooks.map((tb, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text
                            variant="xs"
                            weight="700"
                            style={{ color: colors.textMuted, width: 18 }}
                          >
                            {i + 1}.
                          </Text>
                          <Text
                            variant="xs"
                            color="secondary"
                            style={{ flex: 1, lineHeight: 18 }}
                          >
                            {tb}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {selectedCourse.references && selectedCourse.references.length > 0 ? (
                    <View style={{ marginTop: 10, gap: 6 }}>
                      <Caption style={{ color: colors.text, fontWeight: '700' }}>
                        References
                      </Caption>
                      {selectedCourse.references.map((ref, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text
                            variant="xs"
                            weight="700"
                            style={{ color: colors.textMuted, width: 18 }}
                          >
                            {i + 1}.
                          </Text>
                          <Text
                            variant="xs"
                            color="secondary"
                            style={{ flex: 1, lineHeight: 18 }}
                          >
                            {ref}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroBanner: {
    borderWidth: 1,
    padding: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  universityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  mySemPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metricsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  metricBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricDivider: {
    width: 1,
    height: 24,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    paddingVertical: 0,
  },
  tabsScrollContainer: {
    gap: 8,
    paddingVertical: 4,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  semesterHeaderCard: {
    borderWidth: 1,
    padding: 14,
  },
  semesterHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  semBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  semCreditPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  courseCard: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  courseCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  courseBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  codePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  courseCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clusterFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  infoCard: {
    borderWidth: 1,
    padding: 16,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  careerChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  careerChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  modalRoot: {
    flex: 1,
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  modalCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  modalLibraryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  detailCard: {
    borderWidth: 1,
    padding: 16,
  },
  noteBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderWidth: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitBox: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  unitBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  unitNumBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  unitHoursBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
  },
  unitTopicsContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
});
