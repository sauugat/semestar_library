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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import {
  SEMESTERS,
  SemesterItem,
  SubjectItem,
  ChapterItem,
} from '@/constants/subjects.config';
import { uploadNote, getLibraryStats, LibraryStat } from '@/services/library';
import { normalizeUploadFile, validateFileSize } from '@/utils/file-upload';

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

type UploadStep = 1 | 2 | 3;

export function UploadNoteModal({
  visible,
  onClose,
  onSuccess,
  initialSemesterId,
  initialSubjectTitle,
  initialChapterTitle,
}: UploadNoteModalProps) {
  const { colors, spacing, radii, touchTarget } = useTheme();

  // Step state: 1 (File) -> 2 (Subject) -> 3 (Details & Publish)
  const [currentStep, setCurrentStep] = useState<UploadStep>(1);

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
      setCurrentStep(1);
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
        const normalized = normalizeUploadFile(asset, 'note.pdf');
        validateFileSize(normalized.size, 250 * 1024 * 1024, 'Document');

        setSelectedFile({
          uri: normalized.uri,
          name: normalized.name,
          size: normalized.size,
          mimeType: normalized.type,
        });

        // Pre-fill title if currently blank
        if (!title.trim()) {
          const cleanName = normalized.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
          setTitle(cleanName);
        }
      }
    } catch (err: any) {
      console.error('File pick error:', err);
      setErrorMsg(err.message || 'Could not open file picker. Please try again.');
    }
  };

  // Pick photo / images of notes via ImagePicker
  const handlePickPhoto = async () => {
    try {
      setErrorMsg(null);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        const normalized = normalizeUploadFile(asset, 'note_photo.jpg');
        validateFileSize(normalized.size, 250 * 1024 * 1024, 'Photo');

        setSelectedFile({
          uri: normalized.uri,
          name: normalized.name,
          size: normalized.size,
          mimeType: normalized.type,
        });

        if (!title.trim()) {
          const cleanName = normalized.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
          setTitle(cleanName);
        }
      }
    } catch (err: any) {
      console.error('Photo pick error:', err);
      setErrorMsg(err.message || 'Could not open photo library. Please try again.');
    }
  };

  // Submit flow
  const handleSubmit = async () => {
    if (submitting) return;

    if (!selectedFile) {
      setErrorMsg('Please select a file to upload.');
      setCurrentStep(1);
      return;
    }

    const effectiveSubject = isCustomSubject ? customSubject.trim() : selectedSubjectTitle.trim();
    if (!effectiveSubject) {
      setErrorMsg('Please select or specify a subject for this note.');
      setCurrentStep(2);
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
        fileSize: selectedFile.size,
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
      setCurrentStep(1);
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
  const effectiveSubjectName = isCustomSubject ? customSubject : selectedSubjectTitle;
  const effectiveChapterName = isCustomChapter ? customChapter : selectedChapterTitle;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
    >
      <View
        style={[styles.modalRoot, { backgroundColor: colors.background }]}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
          {/* Header Bar */}
          <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => {
                if (currentStep > 1) {
                  setCurrentStep((prev) => (prev - 1) as UploadStep);
                } else {
                  onClose();
                }
              }}
              disabled={submitting}
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text variant="sm" color="secondary" weight="600">
                {currentStep > 1 ? '← Back' : 'Cancel'}
              </Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Heading style={styles.headerTitle}>Upload Note</Heading>
              <Caption color="muted">Step {currentStep} of 3</Caption>
            </View>

            {currentStep < 3 ? (
              <TouchableOpacity
                onPress={() => {
                  if (currentStep === 1) {
                    if (!selectedFile) {
                      setErrorMsg('Please select a file to continue.');
                      return;
                    }
                    setErrorMsg(null);
                    setCurrentStep(2);
                  } else if (currentStep === 2) {
                    const sub = isCustomSubject ? customSubject.trim() : selectedSubjectTitle.trim();
                    if (!sub) {
                      setErrorMsg('Please select or specify a subject.');
                      return;
                    }
                    setErrorMsg(null);
                    setCurrentStep(3);
                  }
                }}
                style={styles.headerBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text variant="sm" color="accent" weight="700">
                  Next →
                </Text>
              </TouchableOpacity>
            ) : (
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
                  <ActivityIndicator size="small" color={colors.primaryText} />
                ) : (
                  <Text
                    variant="sm"
                    weight="700"
                    style={{ color: !selectedFile ? colors.textMuted : colors.primaryText }}
                  >
                    Publish
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Stepper Progress Bar */}
          <View style={[styles.stepperContainer, { borderBottomColor: colors.border }]}>
            {[
              { step: 1, label: '1. File' },
              { step: 2, label: '2. Course' },
              { step: 3, label: '3. Details' },
            ].map((s) => {
              const isActive = currentStep === s.step;
              const isPast = currentStep > s.step;
              return (
                <TouchableOpacity
                  key={s.step}
                  onPress={() => {
                    if (s.step === 1) setCurrentStep(1);
                    if (s.step === 2 && selectedFile) setCurrentStep(2);
                    if (s.step === 3 && selectedFile && (selectedSubjectTitle || customSubject)) setCurrentStep(3);
                  }}
                  style={[
                    styles.stepperTab,
                    isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight={isActive ? '700' : '500'}
                    style={{
                      color: isActive
                        ? colors.primary
                        : isPast
                        ? colors.text
                        : colors.textMuted,
                    }}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Form Scroll Content */}
          <KeyboardAwareForm
            contentContainerStyle={[styles.scrollContent, { padding: spacing.cardPadding }]}
            keyboardShouldPersistTaps="handled"
            clearance={24}
          >
            {/* Error Banner */}
            {errorMsg && (
              <View style={[styles.errorBanner, { backgroundColor: colors.errorBg || '#2A1215', borderColor: colors.error }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} style={{ marginRight: 8 }} />
                <Text variant="xs" style={{ color: colors.error, flex: 1 }}>
                  {errorMsg}
                </Text>
              </View>
            )}

            {/* STEP 1: CHOOSE FILE */}
            {currentStep === 1 && (
              <View>
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  ATTACH STUDY DOCUMENT OR PHOTO *
                </Text>

                {selectedFile ? (
                  <Card variant="elevated" padding="md" style={{ marginBottom: spacing.normal, borderColor: colors.border }}>
                    <View style={styles.fileSelectedRow}>
                      <View
                        style={[
                          styles.fileBadge,
                          { backgroundColor: colors.surfaceRaised, borderRadius: radii.card },
                        ]}
                      >
                        <Text variant="xs" weight="800" style={{ color: colors.primary }}>
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

                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={handlePickDocument}
                          accessibilityLabel="Change document"
                          style={[styles.changeFileBtn, { backgroundColor: colors.surfaceRaised }]}
                        >
                          <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handlePickPhoto}
                          accessibilityLabel="Change photo"
                          style={[styles.changeFileBtn, { backgroundColor: colors.surfaceRaised }]}
                        >
                          <Ionicons name="image-outline" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </Card>
                ) : (
                  <View
                    style={[
                      styles.dropzoneCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                        marginBottom: spacing.normal,
                      },
                    ]}
                  >
                    <View style={[styles.dropzoneIconCircle, { backgroundColor: colors.surfaceRaised }]}>
                      <Ionicons name="cloud-upload-outline" size={32} color={colors.primary} />
                    </View>
                    <Text variant="sm" weight="700" style={{ marginTop: 10 }}>
                      Select File to Share
                    </Text>
                    <Caption color="muted" style={{ marginTop: 4, textAlign: 'center' }}>
                      PDF, DOCX, PPTX, Images, Notes up to 250MB
                    </Caption>

                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' }}>
                      <TouchableOpacity
                        onPress={handlePickDocument}
                        activeOpacity={0.7}
                        style={[
                          styles.uploadActionBtn,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.button,
                          },
                        ]}
                      >
                        <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                        <Text variant="xs" weight="700">Document</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={handlePickPhoto}
                        activeOpacity={0.7}
                        style={[
                          styles.uploadActionBtn,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.button,
                          },
                        ]}
                      >
                        <Ionicons name="images-outline" size={18} color={colors.primary} />
                        <Text variant="xs" weight="700">Photo / Notes</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <Button
                  title={selectedFile ? 'Continue to Course Selection →' : 'Choose a File Above'}
                  variant="primary"
                  size="lg"
                  disabled={!selectedFile}
                  onPress={() => {
                    setErrorMsg(null);
                    setCurrentStep(2);
                  }}
                  style={{ marginTop: spacing.compact }}
                />
              </View>
            )}

            {/* STEP 2: COURSE & SUBJECT */}
            {currentStep === 2 && (
              <View>
                {/* Semester Selector */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  SEMESTER *
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingBottom: spacing.tight, marginBottom: spacing.tight }}
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
                            borderRadius: radii.pill,
                            minHeight: touchTarget.min,
                            justifyContent: 'center',
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

                {/* Course / Subject Selector */}
                <Text
                  variant="xs"
                  weight="700"
                  color="secondary"
                  style={[styles.fieldLabel, { marginTop: spacing.normal }]}
                >
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
                            borderRadius: radii.card,
                            minHeight: touchTarget.min,
                            justifyContent: 'center',
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
                        borderRadius: radii.card,
                        minHeight: touchTarget.min,
                        justifyContent: 'center',
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
                        borderRadius: radii.input,
                        marginTop: 8,
                        marginBottom: spacing.normal,
                      },
                    ]}
                    placeholder="Enter custom subject name..."
                    placeholderTextColor={colors.textMuted}
                    value={customSubject}
                    onChangeText={setCustomSubject}
                    autoFocus
                  />
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.normal }}>
                  <Button
                    title="← Back"
                    variant="outline"
                    size="lg"
                    onPress={() => setCurrentStep(1)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Continue →"
                    variant="primary"
                    size="lg"
                    disabled={!selectedSubjectTitle && !customSubject.trim()}
                    onPress={() => {
                      const sub = isCustomSubject ? customSubject.trim() : selectedSubjectTitle.trim();
                      if (!sub) {
                        setErrorMsg('Please select or enter a subject.');
                        return;
                      }
                      setErrorMsg(null);
                      setCurrentStep(3);
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}

            {/* STEP 3: DETAILS & PUBLISH */}
            {currentStep === 3 && (
              <View>
                {/* Upload Summary Card */}
                <Card variant="elevated" padding="md" style={{ marginBottom: spacing.normal, borderColor: colors.border }}>
                  <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 6 }}>
                    UPLOAD SUMMARY
                  </Text>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">File:</Text>
                    <Text variant="xs" weight="700" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
                      {selectedFile?.name || '—'}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Semester:</Text>
                    <Text variant="xs" weight="700">{currentSemester.label}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Subject:</Text>
                    <Text variant="xs" weight="700">{effectiveSubjectName || '—'}</Text>
                  </View>
                </Card>

                {/* Resource Title */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  NOTE TITLE (OPTIONAL)
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                      borderRadius: radii.input,
                      marginBottom: spacing.tight,
                    },
                  ]}
                  placeholder="e.g. Complete Lecture Slides & Numerical Solutions"
                  placeholderTextColor={colors.textMuted}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={100}
                />
                <Caption color="muted" style={{ marginBottom: spacing.normal }}>
                  Defaults to the original file name if left blank.
                </Caption>

                {/* Chapter / Unit Selector */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
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
                              borderRadius: radii.card,
                              minHeight: touchTarget.min,
                              justifyContent: 'center',
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
                          borderRadius: radii.card,
                          minHeight: touchTarget.min,
                          justifyContent: 'center',
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
                        borderRadius: radii.input,
                        marginTop: 8,
                        marginBottom: spacing.normal,
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

                {/* Bottom Submit Action */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.normal }}>
                  <Button
                    title="← Back"
                    variant="outline"
                    size="lg"
                    onPress={() => setCurrentStep(2)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title={submitting ? 'Uploading...' : 'Publish to Library'}
                    variant="primary"
                    size="lg"
                    loading={submitting}
                    disabled={!selectedFile || submitting}
                    onPress={handleSubmit}
                    leftIcon={<Ionicons name="cloud-upload-outline" size={18} color={colors.primaryText} />}
                    style={{ flex: 2 }}
                  />
                </View>
              </View>
            )}
          </KeyboardAwareForm>
        </SafeAreaView>
      </View>
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
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  publishBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperContainer: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepperTab: {
    flex: 1,
    paddingVertical: 12,
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
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  dropzoneIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    gap: 8,
    minHeight: 44,
  },
  fileSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileBadge: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeFileBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
    paddingVertical: 8,
    borderWidth: 1,
  },
  textInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 48,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
});
