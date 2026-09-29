import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from '@/components/ui/Typography';
import {
  searchGlobal,
  SearchResponse,
  SearchFileItem,
  SearchSubjectItem,
  SearchStudentItem,
  SearchAssignmentItem,
} from '@/services/search';

export interface SearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  filterType?: 'all' | 'files';
  placeholder?: string;
}

function getFileType(filename: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'PPTX';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'DOCX';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return 'ZIP';
  return 'FILE';
}

function formatFileSize(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function SearchOverlay({
  visible,
  onClose,
  filterType = 'all',
  placeholder,
}: SearchOverlayProps) {
  const router = useRouter();
  const { user, serverUrl } = useAuth();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  // Dynamic top padding to prevent Dynamic Island and Notch collision on all iOS / Android screens
  const topInset = Math.max(insets.top, Platform.OS === 'ios' ? 52 : 16);
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 12);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);

  // Modals for student / assignment details
  const [selectedStudent, setSelectedStudent] = useState<SearchStudentItem | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<SearchAssignmentItem | null>(null);

  const inputRef = useRef<TextInput>(null);

  // Debounce search query by ~400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Execute search when debounced query changes
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    let isCurrent = true;
    setIsLoading(true);

    searchGlobal(q)
      .then((data) => {
        if (isCurrent) {
          setResults(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Search error:', err);
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [debouncedQuery]);

  // Reset search state when closing
  const handleClose = () => {
    setQuery('');
    setDebouncedQuery('');
    setResults(null);
    setSelectedStudent(null);
    setSelectedAssignment(null);
    onClose();
  };

  const getFullImageUrl = (path: string | null | undefined): string | null => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${serverUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const hasResults =
    results &&
    ((results.files && results.files.length > 0) ||
      (results.subjects && results.subjects.length > 0) ||
      (filterType !== 'files' &&
        ((results.students && results.students.length > 0) ||
          (results.assignments && results.assignments.length > 0))));

  const isEmpty =
    results &&
    !isLoading &&
    debouncedQuery.trim().length > 0 &&
    !hasResults;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        {/* Header Search Bar */}
        <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: colors.text }]}
              placeholder={
                placeholder ||
                (filterType === 'files'
                  ? 'Search notes across subjects and chapters...'
                  : 'Search notes, subjects, students...')
              }
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus={true}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ padding: 2 }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={handleClose}
            style={styles.cancelBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text variant="sm" weight="600" color="primary">
              Cancel
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content Body */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text variant="sm" color="secondary" style={{ marginTop: 12 }}>
              Searching campus library...
            </Text>
          </View>
        ) : isEmpty ? (
          <View style={styles.centerContainer}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search-outline" size={28} color={colors.textMuted} />
            </View>
            <Text variant="md" weight="700" style={{ marginTop: 14 }}>
              No results found
            </Text>
            <Text variant="sm" color="muted" style={{ textAlign: 'center', marginTop: 4, paddingHorizontal: 32 }}>
              No notes, subjects, classmates, or assignments matched "{debouncedQuery}"
            </Text>
          </View>
        ) : !debouncedQuery.trim() ? (
          <View style={styles.centerContainer}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={28} color={colors.textSecondary} />
            </View>
            <Text variant="md" weight="700" style={{ marginTop: 14 }}>
              {filterType === 'files' ? 'Search Library Notes' : 'Search Campus'}
            </Text>
            <Text variant="sm" color="muted" style={{ textAlign: 'center', marginTop: 4, paddingHorizontal: 32 }}>
              {filterType === 'files'
                ? 'Type to find notes across all semesters, subjects, and chapters.'
                : 'Type to find study notes, subjects, classmates, and assignments.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 1. Files & Notes */}
            {results?.files && results.files.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.sectionTitle}>
                    FILES & NOTES ({results.files.length})
                  </Text>
                </View>
                {results.files.map((file) => {
                  const ext = getFileType(file.originalName);
                  return (
                    <TouchableOpacity
                      key={`file-${file.id}`}
                      style={[
                        styles.resultCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        handleClose();
                        router.push(`/material/${file.id}?preview=1` as any);
                      }}
                    >
                      {/* Monochrome gray file badge */}
                      <View
                        style={[
                          styles.fileBadge,
                          {
                            backgroundColor: '#4B5563',
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="800" style={{ color: '#FFFFFF', fontSize: 10 }}>
                          {ext}
                        </Text>
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text variant="sm" weight="700" numberOfLines={1}>
                          {file.title || file.originalName}
                        </Text>

                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, flexWrap: 'wrap', gap: 6 }}>
                          {file.subject ? (
                            <View
                              style={[
                                styles.pillTag,
                                { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                              ]}
                            >
                              <Text variant="xs" weight="600" color="secondary" style={{ fontSize: 11 }}>
                                {file.subject}
                              </Text>
                            </View>
                          ) : null}

                          {file.chapter ? (
                            <Text variant="xs" color="muted">
                              {file.chapter}
                            </Text>
                          ) : null}

                          <Text variant="xs" color="muted">
                            • {formatFileSize(file.sizeBytes)}
                          </Text>
                        </View>

                        <Caption color="muted" style={{ marginTop: 4 }}>
                          By {file.uploaderName || 'Student'}
                          {file.semester ? ` • ${file.semester}` : ''}
                        </Caption>
                      </View>

                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* 2. Subjects */}
            {results?.subjects && results.subjects.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.sectionTitle}>
                    SUBJECTS ({results.subjects.length})
                  </Text>
                </View>
                {results.subjects.map((sub, idx) => (
                  <TouchableOpacity
                    key={`sub-${idx}-${sub.subject}`}
                    style={[
                      styles.resultCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      handleClose();
                      router.push({
                        pathname: '/(tabs)/library',
                        params: { subject: sub.subject },
                      } as any);
                    }}
                  >
                    <View
                      style={[
                        styles.iconBadge,
                        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                      ]}
                    >
                      <Ionicons name="book-outline" size={18} color={colors.text} />
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="sm" weight="700">
                        {sub.subject}
                      </Text>
                      <Caption color="muted" style={{ marginTop: 2 }}>
                        {sub.fileCount} file{Number(sub.fileCount) === 1 ? '' : 's'} • {sub.chapterCount} chapter{Number(sub.chapterCount) === 1 ? '' : 's'}
                      </Caption>
                    </View>

                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* 3. Students & Classmates (Hidden when searching specifically for files) */}
            {filterType !== 'files' && results?.students && results.students.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.sectionTitle}>
                    STUDENTS & CLASSMATES ({results.students.length})
                  </Text>
                </View>
                {results.students.map((student) => {
                  const avatarUri = getFullImageUrl(student.avatarUrl);
                  return (
                    <TouchableOpacity
                      key={`student-${student.studentId}`}
                      style={[
                        styles.resultCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (user?.studentId && user.studentId === student.studentId) {
                          handleClose();
                          router.push('/(tabs)/profile');
                        } else {
                          setSelectedStudent(student);
                        }
                      }}
                    >
                      <View
                        style={[
                          styles.avatarContainer,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        {avatarUri ? (
                          <Image
                            source={{ uri: avatarUri }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                        ) : (
                          <Text variant="sm" weight="700" color="primary">
                            {(student.name || 'S').charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text variant="sm" weight="700" numberOfLines={1}>
                            {student.name}
                          </Text>
                          {student.role && student.role !== 'student' && (
                            <View
                              style={[
                                styles.pillTag,
                                {
                                  backgroundColor: colors.surfaceRaised,
                                  borderColor: colors.border,
                                },
                              ]}
                            >
                              <Text variant="xs" weight="700" color="secondary" style={{ fontSize: 9 }}>
                                {student.role.toUpperCase()}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Caption color="muted" style={{ marginTop: 2 }}>
                          @{student.studentId} • {student.semester || 'Semester 1'} • {student.filesCount || 0} upload{Number(student.filesCount) === 1 ? '' : 's'}
                        </Caption>
                      </View>

                      <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* 4. Code Lab Assignments (Hidden when searching specifically for files) */}
            {filterType !== 'files' && results?.assignments && results.assignments.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.sectionTitle}>
                    CODE LAB ASSIGNMENTS ({results.assignments.length})
                  </Text>
                </View>
                {results.assignments.map((assignment) => (
                  <TouchableOpacity
                    key={`assign-${assignment.id}`}
                    style={[
                      styles.resultCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    activeOpacity={0.7}
                    onPress={() => setSelectedAssignment(assignment)}
                  >
                    <View
                      style={[
                        styles.iconBadge,
                        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                      ]}
                    >
                      <Ionicons name="terminal-outline" size={18} color={colors.text} />
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="sm" weight="700" numberOfLines={1}>
                        {assignment.title}
                      </Text>
                      <Caption color="muted" style={{ marginTop: 2 }}>
                        {assignment.subject ? `${assignment.subject} • ` : ''}
                        {assignment.teacherName ? `By ${assignment.teacherName}` : 'Instructor'}
                      </Caption>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 10 }}>
                        <Caption color="secondary">
                          {assignment.questionCount || 0} questions
                        </Caption>
                        <Caption color="muted">
                          {assignment.submissionCount || 0} submissions
                        </Caption>
                      </View>
                    </View>

                    <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        {/* Student Detail Modal */}
        <Modal
          visible={selectedStudent !== null}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSelectedStudent(null)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setSelectedStudent(null)}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={[
                styles.detailSheet,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {selectedStudent && (
                <>
                  <View
                    style={[
                      styles.sheetAvatar,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    {getFullImageUrl(selectedStudent.avatarUrl) ? (
                      <Image
                        source={{ uri: getFullImageUrl(selectedStudent.avatarUrl)! }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <Text variant="xl" weight="700" color="primary">
                        {(selectedStudent.name || 'S').charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <Text variant="lg" weight="700" style={{ marginTop: 12, textAlign: 'center' }}>
                    {selectedStudent.name}
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, justifyContent: 'center' }}>
                    <Caption color="muted">@{selectedStudent.studentId}</Caption>
                    {selectedStudent.role && selectedStudent.role !== 'student' && (
                      <View
                        style={[
                          styles.pillTag,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="700" color="secondary" style={{ fontSize: 10 }}>
                          {selectedStudent.role.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>

                  {selectedStudent.bio ? (
                    <Text
                      variant="sm"
                      color="secondary"
                      style={{ textAlign: 'center', marginTop: 12, paddingHorizontal: 16 }}
                    >
                      {selectedStudent.bio}
                    </Text>
                  ) : null}

                  <View
                    style={[
                      styles.statsRow,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.statCol}>
                      <Text variant="sm" weight="700">
                        {selectedStudent.semester || 'Semester 1'}
                      </Text>
                      <Caption color="muted">Semester</Caption>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.statCol}>
                      <Text variant="sm" weight="700">
                        {selectedStudent.filesCount || 0}
                      </Text>
                      <Caption color="muted">Uploads</Caption>
                    </View>
                    {selectedStudent.department && (
                      <>
                        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                        <View style={styles.statCol}>
                          <Text variant="sm" weight="700" numberOfLines={1}>
                            {selectedStudent.department}
                          </Text>
                          <Caption color="muted">Dept</Caption>
                        </View>
                      </>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.closeSheetBtn,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setSelectedStudent(null)}
                  >
                    <Text variant="sm" weight="600" color="primary">
                      Close
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Assignment Detail Modal */}
        <Modal
          visible={selectedAssignment !== null}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSelectedAssignment(null)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setSelectedAssignment(null)}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={[
                styles.detailSheet,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {selectedAssignment && (
                <>
                  <View
                    style={[
                      styles.sheetAvatar,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="terminal-outline" size={28} color={colors.text} />
                  </View>

                  <Text variant="lg" weight="700" style={{ marginTop: 12, textAlign: 'center' }}>
                    {selectedAssignment.title}
                  </Text>

                  <Caption color="muted" style={{ marginTop: 4, textAlign: 'center' }}>
                    {selectedAssignment.subject || 'Code Lab'}
                    {selectedAssignment.semester ? ` • ${selectedAssignment.semester}` : ''}
                  </Caption>

                  <View
                    style={[
                      styles.statsRow,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.statCol}>
                      <Text variant="sm" weight="700">
                        {selectedAssignment.questionCount || 0}
                      </Text>
                      <Caption color="muted">Questions</Caption>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.statCol}>
                      <Text variant="sm" weight="700">
                        {selectedAssignment.submissionCount || 0}
                      </Text>
                      <Caption color="muted">Submissions</Caption>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.statCol}>
                      <Text variant="sm" weight="700" numberOfLines={1}>
                        {selectedAssignment.teacherName || 'Faculty'}
                      </Text>
                      <Caption color="muted">Instructor</Caption>
                    </View>
                  </View>

                  {selectedAssignment.dueDate && (
                    <Text variant="xs" color="secondary" style={{ textAlign: 'center', marginTop: 10 }}>
                      Due: {new Date(selectedAssignment.dueDate).toLocaleDateString()}
                    </Text>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.closeSheetBtn,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setSelectedAssignment(null)}
                  >
                    <Text variant="sm" weight="600" color="primary">
                      Close
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    letterSpacing: 0.8,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  fileBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  detailSheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  sheetAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    paddingVertical: 10,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
  },
  closeSheetBtn: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
});
