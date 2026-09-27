import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  SEMESTERS,
  SemesterItem,
  SubjectItem,
  ChapterItem,
} from '@/constants/subjects.config';
import { uploadNote, getLibraryStats, LibraryStat } from '@/services/library';

function isMatchingSemester(dbSemester: string | null | undefined, semItem: SemesterItem): boolean {
  if (!dbSemester) return false;
  const clean = dbSemester.trim().toLowerCase();
  const idLower = semItem.id.toLowerCase();
  const semLower = semItem.semester.toLowerCase();
  const labelLower = semItem.label.toLowerCase();
  const shortLower = semItem.shortLabel.toLowerCase();

  return (
    clean === idLower ||
    clean === semLower ||
    clean === labelLower ||
    clean === shortLower ||
    clean === `semester ${semLower}` ||
    clean === `sem ${semLower}`
  );
}

export interface UploadNoteModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (message?: string) => void;
  initialSemesterId?: string;
  initialSubjectTitle?: string;
  initialChapterTitle?: string;
}

function formatBytes(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function UploadNoteModal({
  visible,
  onClose,
  onSuccess,
  initialSemesterId,
  initialSubjectTitle,
  initialChapterTitle,
}: UploadNoteModalProps) {
  const { colors, spacing, radii } = useTheme();

  // Fetch live library stats to include custom/teacher-added subjects
  const { data: libraryStats = [] } = useQuery<LibraryStat[]>({
    queryKey: ['library', 'stats'],
    queryFn: getLibraryStats,
    staleTime: 60 * 1000,
  });

  // Selected file state
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    size?: number;
    mimeType?: string;
  } | null>(null);

  // Form fields
  const [semesterId, setSemesterId] = useState<string>(initialSemesterId || 'Semester II');
  const [selectedSubjectTitle, setSelectedSubjectTitle] = useState<string>(initialSubjectTitle || '');
  const [customSubject, setCustomSubject] = useState<string>('');
  const [isCustomSubject, setIsCustomSubject] = useState<boolean>(false);

  const [selectedChapterTitle, setSelectedChapterTitle] = useState<string>(initialChapterTitle || '');
  const [customChapter, setCustomChapter] = useState<string>('');
  const [isCustomChapter, setIsCustomChapter] = useState<boolean>(false);

  const [title, setTitle] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync initial props when opened
  useEffect(() => {
    if (visible) {
      if (initialSemesterId) setSemesterId(initialSemesterId);
      if (initialSubjectTitle) {
        setSelectedSubjectTitle(initialSubjectTitle);
        setIsCustomSubject(false);
      }
      if (initialChapterTitle) {
        setSelectedChapterTitle(initialChapterTitle);
        setIsCustomChapter(false);
      }
      setErrorMsg(null);
    }
  }, [visible, initialSemesterId, initialSubjectTitle, initialChapterTitle]);

  // Active semester object from static config
  const currentSemester: SemesterItem = useMemo(() => {
    return SEMESTERS.find((s) => s.id === semesterId || s.shortLabel === semesterId) || SEMESTERS[1] || SEMESTERS[0];
  }, [semesterId]);

  // Subjects available for current semester (static curriculum merged with custom subjects from libraryStats)
  const availableSubjects: SubjectItem[] = useMemo(() => {
    const baseSubjects = currentSemester.subjects || [];
    const subjectMap = new Map<string, SubjectItem>();

    baseSubjects.forEach((sub) => {
      subjectMap.set(sub.title.toLowerCase().trim(), { ...sub, chapters: [...sub.chapters] });
    });

    if (Array.isArray(libraryStats)) {
      libraryStats.forEach((stat) => {
        if (!stat.subject || !stat.subject.trim()) return;
        if (!isMatchingSemester(stat.semester, currentSemester)) return;

        const key = stat.subject.toLowerCase().trim();
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            code: 'CUSTOM',
            title: stat.subject.trim(),
            credit: '—',
            chapters: [],
          });
        }

        if (stat.chapter && stat.chapter.trim()) {
          const sub = subjectMap.get(key)!;
          const chapTitle = stat.chapter.trim();
          if (!sub.chapters.some((c) => c.title.toLowerCase().trim() === chapTitle.toLowerCase())) {
            sub.chapters.push({
              id: chapTitle,
              title: chapTitle,
              shortTitle: chapTitle,
            });
          }
        }
      });
    }

    return Array.from(subjectMap.values());
  }, [currentSemester, libraryStats]);

  // Active subject object
  const currentSubject: SubjectItem | undefined = useMemo(() => {
    return availableSubjects.find((s) => s.title === selectedSubjectTitle);
  }, [availableSubjects, selectedSubjectTitle]);

  // Chapters available for current subject
  const availableChapters: ChapterItem[] = useMemo(() => {
    return currentSubject?.chapters || [];
  }, [currentSubject]);

  // When semester changes, reset subject if it doesn't exist in new semester
  const handleSelectSemester = (newSemId: string) => {
    setSemesterId(newSemId);
    const targetSem = SEMESTERS.find((s) => s.id === newSemId);
    if (targetSem && !targetSem.subjects.some((s) => s.title === selectedSubjectTitle)) {
      setSelectedSubjectTitle('');
      setIsCustomSubject(false);
      setSelectedChapterTitle('');
      setIsCustomChapter(false);
    }
  };

  // When subject changes, reset chapter if it doesn't exist in new subject
  const handleSelectSubject = (subTitle: string) => {
    setIsCustomSubject(false);
    setSelectedSubjectTitle(subTitle);
    const targetSub = availableSubjects.find((s) => s.title === subTitle);
    if (targetSub && !targetSub.chapters.some((c) => c.title === selectedChapterTitle)) {
      setSelectedChapterTitle('');
      setIsCustomChapter(false);
    }
  };

  // Pick file via DocumentPicker
  const handlePickDocument = async () => {
    try {
      setErrorMsg(null);
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        setSelectedFile({
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
          mimeType: asset.mimeType,
        });

        // If title is currently empty, prefill with clean file name
        if (!title.trim()) {
          const cleanName = asset.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
          setTitle(cleanName);
        }
      }
    } catch (err: any) {
      console.error('File pick error:', err);
      setErrorMsg('Could not open file picker. Please try again.');
    }
  };

  // Submit flow
  const handleSubmit = async () => {
    if (submitting) return;

    if (!selectedFile) {
      setErrorMsg('Please select a file to upload.');
      return;
    }

    const effectiveSubject = isCustomSubject ? customSubject.trim() : selectedSubjectTitle.trim();
    if (!effectiveSubject) {
      setErrorMsg('Please select or specify a subject for this note.');
      return;
    }

    const effectiveChapter = isCustomChapter ? customChapter.trim() : selectedChapterTitle.trim();

    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await uploadNote({
        fileUri: selectedFile.uri,
        fileName: selectedFile.name,
        fileType: selectedFile.mimeType,
        title: title.trim() || undefined,
        semester: currentSemester.label,
        subject: effectiveSubject,
        chapter: effectiveChapter || undefined,
      });

      // Reset state and notify parent
      setSelectedFile(null);
      setTitle('');
      setCustomSubject('');
      setCustomChapter('');
      onSuccess(res.message || 'Note uploaded successfully!');
      onClose();
    } catch (err: any) {
      console.error('Upload failed:', err);
      setErrorMsg(err.message || 'Failed to upload note. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const ext = selectedFile ? (selectedFile.name.split('.').pop() || 'FILE').toUpperCase() : '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalRoot, { backgroundColor: colors.background }]}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
          {/* Header Bar */}
          <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={submitting}
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text variant="sm" color="secondary" weight="600">
                Cancel
              </Text>
            </TouchableOpacity>

            <Heading style={styles.headerTitle}>Upload Note</Heading>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting || !selectedFile}
              style={[
                styles.publishBtn,
                {
                  backgroundColor: !selectedFile || submitting ? colors.surfaceRaised : colors.primary,
                  borderColor: colors.border,
                },
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  variant="sm"
                  weight="700"
                  style={{ color: !selectedFile ? colors.textMuted : '#FFFFFF' }}
                >
                  Publish
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Form Scroll Content */}
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Error Banner */}
            {errorMsg && (
              <View style={[styles.errorBanner, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: colors.error }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} style={{ marginRight: 8 }} />
                <Text variant="xs" style={{ color: colors.error, flex: 1 }}>
                  {errorMsg}
                </Text>
              </View>
            )}

            {/* 1. File Picker Box */}
            <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
              ATTACHED FILE *
            </Text>

            {selectedFile ? (
              <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md, borderColor: colors.border }}>
                <View style={styles.fileSelectedRow}>
                  <View
                    style={[
                      styles.fileBadge,
                      { backgroundColor: '#27272A', borderRadius: radii.md },
                    ]}
                  >
                    <Text variant="xs" weight="800" style={{ color: '#FFFFFF' }}>
                      {ext}
                    </Text>
                  </View>

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text variant="sm" weight="700" numberOfLines={1}>
                      {selectedFile.name}
                    </Text>
                    <Caption color="muted" style={{ marginTop: 2 }}>
                      {formatBytes(selectedFile.size || 0)} • Ready for upload
                    </Caption>
                  </View>

                  <TouchableOpacity
                    onPress={handlePickDocument}
                    style={[styles.changeFileBtn, { backgroundColor: colors.surfaceRaised }]}
                  >
                    <Ionicons name="swap-horizontal-outline" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </Card>
            ) : (
              <TouchableOpacity
                onPress={handlePickDocument}
                activeOpacity={0.7}
                style={[
                  styles.dropzoneCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.lg,
                    marginBottom: spacing.md,
                  },
                ]}
              >
                <View style={[styles.dropzoneIconCircle, { backgroundColor: colors.surfaceRaised }]}>
                  <Ionicons name="cloud-upload-outline" size={28} color={colors.primary} />
                </View>
                <Text variant="sm" weight="700" style={{ marginTop: 8 }}>
                  Choose Note or Document
                </Text>
                <Caption color="muted" style={{ marginTop: 4, textAlign: 'center' }}>
                  PDF, DOCX, PPTX, Images, ZIP up to 250MB
                </Caption>
              </TouchableOpacity>
            )}

            {/* 2. Semester Selector */}
            <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
              SEMESTER *
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: spacing.sm, marginBottom: spacing.sm }}
            >
              {SEMESTERS.map((sem) => {
                const isSelected = sem.id === semesterId;
                return (
                  <TouchableOpacity
                    key={sem.id}
                    onPress={() => handleSelectSemester(sem.id)}
                    style={[
                      styles.semesterPill,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                        borderRadius: radii.full,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: isSelected ? colors.primaryText : colors.text }}
                    >
                      {sem.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 3. Course / Subject Selector */}
            <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
              SUBJECT / COURSE *
            </Text>
            <View style={styles.chipGrid}>
              {availableSubjects.map((sub) => {
                const isSelected = !isCustomSubject && selectedSubjectTitle === sub.title;
                return (
                  <TouchableOpacity
                    key={sub.code || sub.title}
                    onPress={() => handleSelectSubject(sub.title)}
                    style={[
                      styles.subjectChip,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      numberOfLines={1}
                      style={{ color: isSelected ? colors.primaryText : colors.text }}
                    >
                      {sub.code ? `${sub.code} • ` : ''}{sub.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => {
                  setIsCustomSubject(true);
                  setSelectedSubjectTitle('');
                }}
                style={[
                  styles.subjectChip,
                  {
                    backgroundColor: isCustomSubject ? colors.primary : colors.surfaceRaised,
                    borderColor: isCustomSubject ? colors.primary : colors.border,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Text
                  variant="xs"
                  weight="700"
                  style={{ color: isCustomSubject ? colors.primaryText : colors.textSecondary }}
                >
                  + Custom Subject
                </Text>
              </TouchableOpacity>
            </View>

            {isCustomSubject && (
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                    borderRadius: radii.md,
                    marginTop: 8,
                    marginBottom: spacing.md,
                  },
                ]}
                placeholder="Enter custom subject name..."
                placeholderTextColor={colors.textMuted}
                value={customSubject}
                onChangeText={setCustomSubject}
                autoFocus
              />
            )}

            {/* 4. Chapter / Unit Selector */}
            <Text variant="xs" weight="700" color="secondary" style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
              CHAPTER / UNIT (OPTIONAL)
            </Text>
            {availableChapters.length > 0 && !isCustomSubject ? (
              <View style={styles.chipGrid}>
                {availableChapters.map((chap) => {
                  const isSelected = !isCustomChapter && selectedChapterTitle === chap.title;
                  return (
                    <TouchableOpacity
                      key={chap.id}
                      onPress={() => {
                        setIsCustomChapter(false);
                        setSelectedChapterTitle(chap.title);
                      }}
                      style={[
                        styles.chapterChip,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderRadius: radii.md,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="600"
                        numberOfLines={1}
                        style={{ color: isSelected ? colors.primaryText : colors.text }}
                      >
                        {chap.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={() => {
                    setIsCustomChapter(true);
                    setSelectedChapterTitle('');
                  }}
                  style={[
                    styles.chapterChip,
                    {
                      backgroundColor: isCustomChapter ? colors.primary : colors.surfaceRaised,
                      borderColor: isCustomChapter ? colors.primary : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="600"
                    style={{ color: isCustomChapter ? colors.primaryText : colors.textSecondary }}
                  >
                    + Custom Unit
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {(isCustomChapter || isCustomSubject || availableChapters.length === 0) && (
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                    borderRadius: radii.md,
                    marginTop: 8,
                    marginBottom: spacing.md,
                  },
                ]}
                placeholder="Enter unit/chapter name (e.g. Unit 1: Introduction)..."
                placeholderTextColor={colors.textMuted}
                value={isCustomChapter ? customChapter : selectedChapterTitle}
                onChangeText={(val) => {
                  if (isCustomChapter) setCustomChapter(val);
                  else setSelectedChapterTitle(val);
                }}
              />
            )}

            {/* 5. Resource Title */}
            <Text variant="xs" weight="700" color="secondary" style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
              RESOURCE TITLE (OPTIONAL)
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                  borderRadius: radii.md,
                  marginBottom: spacing.xs,
                },
              ]}
              placeholder="e.g. Complete Lecture Slides & Numerical Solutions"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <Caption color="muted" style={{ marginBottom: spacing.lg }}>
              Defaults to the original file name if left blank.
            </Caption>

            {/* Bottom Submit Action */}
            <Button
              title={submitting ? 'Uploading Note...' : 'Publish Note to Library'}
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={!selectedFile || submitting}
              onPress={handleSubmit}
              leftIcon={<Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />}
              style={{ marginTop: spacing.sm }}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  publishBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  dropzoneCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  dropzoneIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeFileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semesterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  subjectChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  chapterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  textInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
});
