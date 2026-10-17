import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import {
  BIT_SEMESTERS,
  ELECTIVE_CLUSTERS,
  ELECTIVE_COURSES,
  SyllabusCourse,
  SyllabusSemester,
  findSyllabusCourse,
  searchSyllabusCourses,
} from '@/constants/syllabusData';

export default function SyllabusScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { semesterRoman } = useAcademicContext();
  const params = useLocalSearchParams<{
    course?: string;
    semester?: string;
    fromLibrary?: string;
  }>();

  // 3-Level Hierarchy State:
  // Level 1: selectedSemester === null && selectedCourse === null (Semester Template Boxes)
  // Level 2: selectedSemester !== null && selectedCourse === null (Subjects of that Semester)
  // Level 3: selectedCourse !== null (Micro-Syllabus of that Subject)
  const [selectedSemesterId, setSelectedSemesterId] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<SyllabusCourse | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync deep-link route params (e.g. when "View Syllabus" is clicked in Library)
  useEffect(() => {
    if (params.course) {
      const found = findSyllabusCourse(params.course);
      if (found) {
        setSelectedCourse(found);
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

  // Update screen header title dynamically based on level
  useEffect(() => {
    if (selectedCourse) {
      navigation.setOptions({ title: selectedCourse.code + ' · Syllabus' });
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
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LEVEL 3: MICRO-SYLLABUS VIEW (When a specific subject is clicked)
  // ═══════════════════════════════════════════════════════════════════════════
  if (selectedCourse) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
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
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.text} />
              <Text variant="xs" weight="700" style={{ marginLeft: 6, color: colors.text }}>
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
                styles.allNotesBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="folder-open-outline" size={14} color={colors.primaryText} />
              <Text
                variant="xs"
                weight="800"
                style={{ marginLeft: 5, color: colors.primaryText }}
              >
                Subject Notes
              </Text>
            </TouchableOpacity>
          </View>

          {/* Subject Hero Card */}
          <View
            style={[
              styles.subjectHeroCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
                borderRadius: radii.card,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={styles.badgeRow}>
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
                  {selectedCourse.creditDisplay} Credits
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
                <Text variant="xs" weight="600" style={{ color: colors.textSecondary }}>
                  {selectedCourse.nature}
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
                  <Text variant="xs" weight="600" style={{ color: colors.textSecondary }}>
                    {selectedCourse.totalHours}
                  </Text>
                </View>
              ) : null}
            </View>

            <Heading style={{ fontSize: 20, lineHeight: 26, marginTop: 10 }}>
              {selectedCourse.title}
            </Heading>

            <Caption color="muted" style={{ marginTop: 4 }}>
              {selectedCourse.cluster
                ? `${selectedCourse.cluster}`
                : `${selectedCourse.year} · Semester ${selectedCourse.semester} · Gandaki University`}
            </Caption>

            {selectedCourse.objectives && selectedCourse.objectives.length > 0 ? (
              <Text
                variant="xs"
                color="secondary"
                style={{ marginTop: 10, lineHeight: 18 }}
              >
                {selectedCourse.objectives.join(' ')}
              </Text>
            ) : null}
          </View>

          {/* Section Title: Units & Chapters */}
          <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
            <Subheading style={{ fontSize: 15 }}>
              Chapters & Micro-Syllabus ({selectedCourse.units.length}{' '}
              {selectedCourse.units.length === 1 ? 'Unit' : 'Units'})
            </Subheading>
            <Caption color="muted">Tap View Notes for chapter files</Caption>
          </View>

          {/* Units / Chapters List with Small "View Notes" Button on Each Chapter */}
          <View style={{ gap: 10 }}>
            {selectedCourse.units.map((unit) => (
              <View
                key={unit.unitNumber}
                style={[
                  styles.unitCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                {/* Unit Header Row */}
                <View style={styles.unitHeaderRow}>
                  <View
                    style={[
                      styles.unitNumBadge,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.borderStrong,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="800" style={{ color: colors.text }}>
                      Unit {unit.unitNumber}
                    </Text>
                  </View>

                  {unit.hours ? (
                    <Caption color="muted" style={{ fontWeight: '700', marginLeft: 8 }}>
                      {unit.hours}
                    </Caption>
                  ) : null}

                  {/* Small "View Notes" Button for this specific Chapter */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() =>
                      handleViewNotesInLibrary(
                        selectedCourse,
                        unit.unitNumber,
                        unit.title
                      )
                    }
                    style={[
                      styles.chapterNotesBtn,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.borderStrong,
                        borderRadius: radii.sm,
                        marginLeft: 'auto',
                      },
                    ]}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={12}
                      color={colors.text}
                      style={{ marginRight: 4 }}
                    />
                    <Text variant="xs" weight="700" style={{ color: colors.text, fontSize: 11 }}>
                      View Notes
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Unit Title */}
                <Text
                  variant="sm"
                  weight="700"
                  style={{ color: colors.text, marginTop: 8, lineHeight: 20 }}
                >
                  {unit.title}
                </Text>

                {/* Unit Topics Breakdown */}
                <View
                  style={[
                    styles.unitTopicsList,
                    {
                      borderTopColor: colors.borderSubtle,
                      marginTop: 8,
                      paddingTop: 8,
                    },
                  ]}
                >
                  {unit.topics.map((topic, idx) => (
                    <View key={idx} style={styles.bulletRow}>
                      <Text variant="xs" style={{ color: colors.textMuted, width: 12 }}>
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
              </View>
            ))}
          </View>

          {/* Laboratory Work (if applicable) */}
          {selectedCourse.laboratoryWork && selectedCourse.laboratoryWork.length > 0 ? (
            <View
              style={[
                styles.extraSectionCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  marginTop: spacing.md,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="flask-outline" size={16} color={colors.text} />
                <Text variant="sm" weight="800" style={{ marginLeft: 6, color: colors.text }}>
                  Laboratory / Practical Work
                </Text>
              </View>
              <View style={{ gap: 5 }}>
                {selectedCourse.laboratoryWork.map((item, i) => (
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
            </View>
          ) : null}

          {/* Textbooks & References (if applicable) */}
          {(selectedCourse.textbooks && selectedCourse.textbooks.length > 0) ||
          (selectedCourse.references && selectedCourse.references.length > 0) ? (
            <View
              style={[
                styles.extraSectionCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  marginTop: spacing.md,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Ionicons name="book-outline" size={16} color={colors.text} />
                <Text variant="sm" weight="800" style={{ marginLeft: 6, color: colors.text }}>
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
                      style={{ color: colors.textMuted, width: 18 }}
                    >
                      {i + 1}.
                    </Text>
                    <Text variant="xs" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
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
  // LEVEL 2: SUBJECTS LIST VIEW (When a specific Semester box is clicked)
  // ═══════════════════════════════════════════════════════════════════════════
  if (selectedSemesterId) {
    const isElectives = selectedSemesterId === 'electives';
    const coursesList = isElectives
      ? visibleElectives
      : activeSemester?.courses || [];

    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Back Bar */}
          <View style={[styles.topNavRow, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setSelectedSemesterId(null)}
              style={[
                styles.backPillBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.text} />
              <Text variant="xs" weight="700" style={{ marginLeft: 6, color: colors.text }}>
                All Semesters
              </Text>
            </TouchableOpacity>

            <Caption color="muted" style={{ fontWeight: '600' }}>
              {isElectives
                ? '5 Specialization Clusters'
                : `${activeSemester?.year} · Semester ${activeSemester?.semesterRoman}`}
            </Caption>
          </View>

          {/* Semester Banner Card */}
          <View
            style={[
              styles.semesterBanner,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
                borderRadius: radii.card,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={styles.semesterBannerTop}>
              <View
                style={[
                  styles.codePill,
                  { backgroundColor: colors.primary, borderRadius: radii.sm },
                ]}
              >
                <Text variant="xs" weight="800" style={{ color: colors.primaryText }}>
                  {isElectives ? 'ELECTIVES' : `SEMESTER ${activeSemester?.semesterRoman}`}
                </Text>
              </View>

              <Caption style={{ color: colors.textSecondary, fontWeight: '700' }}>
                {isElectives
                  ? `${ELECTIVE_COURSES.length} Courses · 3 Credits Each`
                  : `${activeSemester?.totalCourses} Subjects · ${activeSemester?.totalCredits} Credits`}
              </Caption>
            </View>

            <Heading style={{ fontSize: 20, marginTop: 8 }}>
              {isElectives
                ? 'Elective Specialization Courses'
                : `${activeSemester?.year} · Semester ${activeSemester?.semesterRoman}`}
            </Heading>

            <Text variant="xs" color="secondary" style={{ marginTop: 4, lineHeight: 18 }}>
              {isElectives
                ? 'Select any elective subject below to view its unit-wise micro-syllabus.'
                : activeSemester?.description}
            </Text>

            {/* Cluster Filter Pills for Electives */}
            {isElectives ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingTop: 12 }}
              >
                <TouchableOpacity
                  onPress={() => setSelectedCluster('ALL')}
                  style={[
                    styles.clusterChip,
                    {
                      backgroundColor:
                        selectedCluster === 'ALL' ? colors.primary : colors.surfaceRaised,
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
                        selectedCluster === 'ALL' ? colors.primaryText : colors.textSecondary,
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
                          backgroundColor: active ? colors.primary : colors.surfaceRaised,
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
                        C{cl.number}: {cl.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          {/* Subjects List */}
          <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
            <Subheading style={{ fontSize: 15 }}>Prescribed Subjects</Subheading>
            <Caption color="muted">Tap a subject for micro-syllabus</Caption>
          </View>

          <View style={{ gap: 10 }}>
            {coursesList.map((course, idx) => (
              <TouchableOpacity
                key={`${course.code}-${course.title}-${idx}`}
                activeOpacity={0.75}
                onPress={() => handleSelectCourse(course)}
                style={[
                  styles.subjectListItem,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <View style={styles.subjectListTop}>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.codePill,
                        {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.borderStrong,
                          borderWidth: 1,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="800" style={{ color: colors.text }}>
                        {course.code}
                      </Text>
                    </View>
                    <Caption color="muted" style={{ fontWeight: '600' }}>
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
                        styles.chapterNotesBtn,
                        {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.border,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Ionicons
                        name="folder-open-outline"
                        size={12}
                        color={colors.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: colors.textSecondary, fontSize: 11 }}
                      >
                        View Notes
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <Text
                  variant="md"
                  weight="700"
                  style={{ color: colors.text, marginTop: 8, lineHeight: 21 }}
                >
                  {course.title}
                </Text>

                {course.cluster ? (
                  <Caption color="muted" style={{ marginTop: 2 }}>
                    {course.cluster}
                  </Caption>
                ) : null}

                <View
                  style={[
                    styles.subjectListFooter,
                    {
                      borderTopColor: colors.borderSubtle,
                      marginTop: 10,
                      paddingTop: 8,
                    },
                  ]}
                >
                  <Caption color="muted">
                    {course.isElectiveSlot
                      ? '5 Elective Specialization Clusters'
                      : `${course.units.length} Syllabus ${
                          course.units.length === 1 ? 'Unit' : 'Units'
                        }${course.totalHours ? ` · ${course.totalHours}` : ''}`}
                  </Caption>

                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text variant="xs" weight="700" style={{ color: colors.text }}>
                      {course.isElectiveSlot ? 'View Electives' : 'Micro-Syllabus'}
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
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEVEL 1: SEMESTER TEMPLATE BOXES (Default Screen when Syllabus is clicked)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: insets.bottom + 36,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Minimalist Header */}
        <View style={{ marginBottom: spacing.sm }}>
          <Heading style={{ fontSize: 22, letterSpacing: -0.3 }}>
            BIT Course Syllabus
          </Heading>
          <Caption color="muted" style={{ marginTop: 2 }}>
            Gandaki University · 4 Years · 8 Semesters · 138 Credits
          </Caption>
        </View>

        {/* Compact Search Bar */}
        <View
          style={[
            styles.searchContainer,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.input,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={17}
            color={colors.textMuted}
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Quick search subject or code (e.g. DSA, CIT111, Java)..."
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* If Searching: Show Matching Subjects Directly */}
        {searchQuery.trim().length > 0 ? (
          <View>
            <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
              <Subheading style={{ fontSize: 15 }}>
                Matching Subjects ({searchResults.length})
              </Subheading>
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Caption style={{ color: colors.textSecondary, fontWeight: '700' }}>
                  Clear
                </Caption>
              </TouchableOpacity>
            </View>

            {searchResults.length === 0 ? (
              <Card
                variant="elevated"
                padding="lg"
                style={{ alignItems: 'center', borderColor: colors.border }}
              >
                <Ionicons name="search-outline" size={28} color={colors.textMuted} />
                <Text variant="sm" weight="700" style={{ marginTop: 8 }}>
                  No subjects found for &quot;{searchQuery}&quot;
                </Text>
              </Card>
            ) : (
              <View style={{ gap: 10 }}>
                {searchResults.map((course, idx) => (
                  <TouchableOpacity
                    key={`${course.code}-${course.title}-${idx}`}
                    activeOpacity={0.75}
                    onPress={() => {
                      setSearchQuery('');
                      handleSelectCourse(course);
                    }}
                    style={[
                      styles.subjectListItem,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                      },
                    ]}
                  >
                    <View style={styles.subjectListTop}>
                      <View style={styles.badgeRow}>
                        <View
                          style={[
                            styles.codePill,
                            { backgroundColor: colors.primary, borderRadius: radii.sm },
                          ]}
                        >
                          <Text
                            variant="xs"
                            weight="800"
                            style={{ color: colors.primaryText }}
                          >
                            {course.code}
                          </Text>
                        </View>
                        <Caption color="muted">
                          Sem {course.semester} · {course.creditDisplay} Cr
                        </Caption>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </View>
                    <Text variant="md" weight="700" style={{ color: colors.text, marginTop: 6 }}>
                      {course.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          /* Semester Template Boxes Grid */
          <View>
            <View style={[styles.sectionHeaderRow, { marginBottom: spacing.sm }]}>
              <Subheading style={{ fontSize: 15 }}>Select Semester</Subheading>
              <Caption color="muted">8 Semesters</Caption>
            </View>

            <View style={styles.semesterGrid}>
              {BIT_SEMESTERS.map((sem) => {
                const isMySem = semesterRoman === sem.semesterRoman;
                return (
                  <TouchableOpacity
                    key={sem.id}
                    activeOpacity={0.75}
                    onPress={() => setSelectedSemesterId(sem.id)}
                    style={[
                      styles.semesterBox,
                      {
                        backgroundColor: colors.surface,
                        borderColor: isMySem ? colors.primary : colors.border,
                        borderWidth: isMySem ? 1.5 : 1,
                        borderRadius: radii.card,
                      },
                    ]}
                  >
                    <View style={styles.semesterBoxTop}>
                      <View
                        style={[
                          styles.semNumBadge,
                          {
                            backgroundColor: isMySem
                              ? colors.primary
                              : colors.surfaceRaised,
                            borderColor: colors.borderStrong,
                            borderWidth: isMySem ? 0 : 1,
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Text
                          variant="xs"
                          weight="800"
                          style={{
                            color: isMySem ? colors.primaryText : colors.text,
                          }}
                        >
                          Sem 0{sem.semesterNumber}
                        </Text>
                      </View>

                      <Caption color="muted" style={{ fontWeight: '600' }}>
                        {sem.year}
                      </Caption>
                    </View>

                    <Text
                      variant="md"
                      weight="800"
                      style={{ color: colors.text, marginTop: 12 }}
                    >
                      Semester {sem.semesterRoman}
                    </Text>

                    <Caption color="secondary" style={{ marginTop: 3 }}>
                      {sem.totalCourses} Subjects · {sem.totalCredits} Cr
                    </Caption>

                    <View
                      style={[
                        styles.semesterBoxFooter,
                        {
                          borderTopColor: colors.borderSubtle,
                          marginTop: 12,
                          paddingTop: 8,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: colors.textSecondary }}
                      >
                        {isMySem ? 'Current Sem' : 'View Subjects'}
                      </Text>
                      <Ionicons
                        name="arrow-forward"
                        size={13}
                        color={colors.textSecondary}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Full-Width Electives Template Box */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => setSelectedSemesterId('electives')}
              style={[
                styles.electivesBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  marginTop: 10,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.semNumBadge,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.borderStrong,
                        borderWidth: 1,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="800" style={{ color: colors.text }}>
                      Specialization
                    </Text>
                  </View>
                  <Caption color="muted" style={{ fontWeight: '600' }}>
                    5 Clusters · {ELECTIVE_COURSES.length} Electives
                  </Caption>
                </View>

                <Text variant="md" weight="800" style={{ color: colors.text, marginTop: 8 }}>
                  Elective Courses (Sem VII & VIII)
                </Text>
                <Caption color="secondary" style={{ marginTop: 2 }}>
                  AI/ML, Data Science, Cloud/IoT, E-Governance, C#/.NET, QA & GIS
                </Caption>
              </View>

              <View
                style={[
                  styles.iconCircle,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="arrow-forward" size={16} color={colors.text} />
              </View>
            </TouchableOpacity>
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
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
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
    rowGap: 10,
  },
  semesterBox: {
    width: '48.5%',
    padding: 14,
  },
  semesterBoxTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  semNumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  semesterBoxFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  electivesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 15,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  allNotesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  semesterBanner: {
    borderWidth: 1,
    padding: 16,
  },
  semesterBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clusterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  subjectListItem: {
    borderWidth: 1,
    padding: 14,
  },
  subjectListTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subjectListFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  badgeRow: {
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
  subjectHeroCard: {
    borderWidth: 1,
    padding: 16,
  },
  unitCard: {
    borderWidth: 1,
    padding: 14,
  },
  unitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitNumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  chapterNotesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  unitTopicsList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  extraSectionCard: {
    borderWidth: 1,
    padding: 14,
  },
});
