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
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { SelectionSheet, SelectionOption } from '@/components/ui/SelectionSheet';
import {
  SEMESTERS,
  SemesterItem,
  SubjectItem,
  ChapterItem,
} from '@/constants/subjects.config';
import { uploadNote, getLibraryStats, LibraryStat, UploadFileItem } from '@/services/library';
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

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toUpperCase() || 'FILE';
    if (ext === 'JPEG' || ext === 'JPG' || ext === 'PNG' || ext === 'WEBP') return 'IMG';
    return ext;
  }
  return 'FILE';
}

function cleanFilenameTitle(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
}

type UploadStep = 1 | 2 | 3;

interface QueuedFile {
  id: string;
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
  title: string;
  error?: string;
}

export function UploadNoteModal({
  visible,
  onClose,
  onSuccess,
  initialSemesterId,
  initialSubjectTitle,
  initialChapterTitle,
}: UploadNoteModalProps) {
  const { colors, spacing, radii, touchTarget } = useTheme();
  const { user } = useAuth();

  // Role permissions: Teachers and Admins can upload multiple files in a batch
  const isTeacherOrAdmin = user?.role === 'teacher' || user?.role === 'admin' || Boolean(user?.isAdmin);

  // Step state: 1 (Files) -> 2 (Course) -> 3 (Details & Publish)
  const [currentStep, setCurrentStep] = useState<UploadStep>(1);

  // Selection Sheet visibility states
  const [showSemesterSheet, setShowSemesterSheet] = useState(false);
  const [showSubjectSheet, setShowSubjectSheet] = useState(false);
  const [showChapterSheet, setShowChapterSheet] = useState(false);

  // Fetch live library stats to include custom/teacher-added subjects
  const { data: libraryStats = [] } = useQuery<LibraryStat[]>({
    queryKey: ['library', 'stats'],
    queryFn: getLibraryStats,
    staleTime: 60 * 1000,
  });

  // Selected files queue
  const [selectedFiles, setSelectedFiles] = useState<QueuedFile[]>([]);

  // Form fields
  const [semesterId, setSemesterId] = useState<string>(initialSemesterId || 'Semester II');
  const [selectedSubjectTitle, setSelectedSubjectTitle] = useState<string>(initialSubjectTitle || '');
  const [customSubject, setCustomSubject] = useState<string>('');
  const [isCustomSubject, setIsCustomSubject] = useState<boolean>(false);

  const [selectedChapterTitle, setSelectedChapterTitle] = useState<string>(initialChapterTitle || '');
  const [customChapter, setCustomChapter] = useState<string>('');
  const [isCustomChapter, setIsCustomChapter] = useState<boolean>(false);

  const [commonTitle, setCommonTitle] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
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
      setSubmitting(false);
      setUploadProgressText('');
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

  // Semester Selection Options
  const semesterOptions: SelectionOption<string>[] = useMemo(() => {
    return SEMESTERS.map((s) => ({
      id: s.id,
      label: s.label,
      sublabel: `${s.subjects.length} subjects`,
    }));
  }, []);

  // Subject Selection Options
  const subjectOptions: SelectionOption<string>[] = useMemo(() => {
    return availableSubjects.map((sub) => ({
      id: sub.title,
      label: sub.title,
      sublabel: sub.chapters && sub.chapters.length > 0 ? `${sub.chapters.length} units` : undefined,
      badge: sub.code && sub.code !== 'CUSTOM' ? sub.code : undefined,
    }));
  }, [availableSubjects]);

  // Chapter Selection Options
  const chapterOptions: SelectionOption<string>[] = useMemo(() => {
    const list: SelectionOption<string>[] = [
      { id: '__NO_UNIT__', label: 'No specific unit', sublabel: 'General material' },
    ];
    availableChapters.forEach((chap) => {
      list.push({
        id: chap.title,
        label: chap.title,
        sublabel: chap.shortTitle && chap.shortTitle !== chap.title ? chap.shortTitle : undefined,
      });
    });
    return list;
  }, [availableChapters]);

  // When semester changes, reset subject and chapter if not matching
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

  // When subject changes, reset chapter if not matching
  const handleSelectSubject = (subTitle: string) => {
    setIsCustomSubject(false);
    setSelectedSubjectTitle(subTitle);
    const targetSub = availableSubjects.find((s) => s.title === subTitle);
    if (targetSub && !targetSub.chapters.some((c) => c.title === selectedChapterTitle)) {
      setSelectedChapterTitle('');
      setIsCustomChapter(false);
    }
  };

  // Pick files via DocumentPicker
  const handlePickDocument = async () => {
    try {
      setErrorMsg(null);
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: isTeacherOrAdmin,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const newFiles: QueuedFile[] = [];
        for (const asset of res.assets) {
          const normalized = normalizeUploadFile(asset, 'note.pdf');
          validateFileSize(normalized.size, 250 * 1024 * 1024, 'Document');
          newFiles.push({
            id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            uri: normalized.uri,
            name: normalized.name,
            size: normalized.size,
            mimeType: normalized.type,
            title: cleanFilenameTitle(normalized.name),
          });
        }

        if (isTeacherOrAdmin) {
          setSelectedFiles((prev) => [...prev, ...newFiles]);
        } else {
          setSelectedFiles(newFiles.slice(0, 1));
        }
      }
    } catch (err: any) {
      console.error('File pick error:', err);
      setErrorMsg(err.message || 'Could not open file picker. Please try again.');
    }
  };

  // Pick photos / images of notes via ImagePicker
  const handlePickPhoto = async () => {
    try {
      setErrorMsg(null);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: isTeacherOrAdmin,
        quality: 0.9,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const newFiles: QueuedFile[] = [];
        for (const asset of res.assets) {
          const normalized = normalizeUploadFile(asset, 'note_photo.jpg');
          validateFileSize(normalized.size, 250 * 1024 * 1024, 'Photo');
          newFiles.push({
            id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            uri: normalized.uri,
            name: normalized.name,
            size: normalized.size,
            mimeType: normalized.type,
            title: cleanFilenameTitle(normalized.name),
          });
        }

        if (isTeacherOrAdmin) {
          setSelectedFiles((prev) => [...prev, ...newFiles]);
        } else {
          setSelectedFiles(newFiles.slice(0, 1));
        }
      }
    } catch (err: any) {
      console.error('Photo pick error:', err);
      setErrorMsg(err.message || 'Could not open photo library. Please try again.');
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleUpdateFileTitle = (fileId: string, text: string) => {
    setSelectedFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, title: text } : f))
    );
  };

  // Submit batch flow
  const handleSubmit = async () => {
    if (submitting) return;

    if (selectedFiles.length === 0) {
      setErrorMsg('Please select at least one file to upload.');
      setCurrentStep(1);
      return;
    }

    const effectiveSubject = isCustomSubject ? customSubject.trim() : selectedSubjectTitle.trim();
    if (!effectiveSubject) {
      setErrorMsg('Please select or specify a subject for this upload.');
      setCurrentStep(2);
      return;
    }

    const effectiveChapter = isCustomChapter ? customChapter.trim() : selectedChapterTitle.trim();

    setErrorMsg(null);
    setSubmitting(true);
    setUploadProgressText(`Uploading ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`);

    try {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const filesPayload: UploadFileItem[] = selectedFiles.map((f) => ({
        uri: f.uri,
        name: f.name,
        type: f.mimeType,
        size: f.size,
        title: f.title || cleanFilenameTitle(f.name),
      }));

      const res = await uploadNote({
        files: filesPayload,
        batchId,
        title: commonTitle.trim() || undefined,
        semester: currentSemester.label,
        subject: effectiveSubject,
        chapter: effectiveChapter || undefined,
      });

      // Handle Partial Success (Option B):
      if (res.failedFiles && res.failedFiles.length > 0) {
        // Find which files failed by name/originalName
        const failedNameSet = new Set(res.failedFiles.map((ff) => ff.name || ff.originalName));
        const failedMap = new Map(res.failedFiles.map((ff) => [ff.name || ff.originalName, ff.error]));

        // Keep only failed files in the queue with error annotations
        const remainingQueue = selectedFiles
          .filter((f) => failedNameSet.has(f.name))
          .map((f) => ({
            ...f,
            error: failedMap.get(f.name) || 'Upload failed',
          }));

        setSelectedFiles(remainingQueue);
        setCurrentStep(1); // Jump back to files step so teacher can inspect and retry
        setErrorMsg(`${res.message || 'Some files failed to upload.'} Tap Retry to re-upload.`);
      } else {
        // Complete success: clear queue and close modal
        setSelectedFiles([]);
        setCommonTitle('');
        setCustomSubject('');
        setCustomChapter('');
        setCurrentStep(1);
        onSuccess(res.message || 'Notes uploaded successfully!');
        onClose();
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
      setErrorMsg(err.message || 'Failed to upload notes. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
      setUploadProgressText('');
    }
  };

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
      <View style={[styles.modalRoot, { backgroundColor: colors.background }]}>
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
              <Heading style={styles.headerTitle}>Upload Notes</Heading>
              <Caption color="muted">Step {currentStep} of 3</Caption>
            </View>

            {currentStep < 3 ? (
              <TouchableOpacity
                onPress={() => {
                  if (currentStep === 1) {
                    if (selectedFiles.length === 0) {
                      setErrorMsg('Please select at least one file to continue.');
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
                disabled={submitting || selectedFiles.length === 0}
                style={[
                  styles.publishBtn,
                  {
                    backgroundColor: selectedFiles.length === 0 || submitting ? colors.surfaceRaised : colors.primary,
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
                    style={{ color: selectedFiles.length === 0 ? colors.textMuted : colors.primaryText }}
                  >
                    Upload {selectedFiles.length}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Stepper Progress Bar */}
          <View style={[styles.stepperContainer, { borderBottomColor: colors.border }]}>
            {[
              { step: 1, label: '1. Files' },
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
                    if (s.step === 2 && selectedFiles.length > 0) setCurrentStep(2);
                    if (s.step === 3 && selectedFiles.length > 0 && (selectedSubjectTitle || customSubject)) setCurrentStep(3);
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

            {/* STEP 1: CHOOSE MATERIALS */}
            {currentStep === 1 && (
              <View>
                <View style={styles.sectionHeaderRow}>
                  <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                    CHOOSE MATERIALS *
                  </Text>
                  {isTeacherOrAdmin && (
                    <Caption color="muted">
                      Multi-file batch enabled
                    </Caption>
                  )}
                </View>

                {selectedFiles.length > 0 ? (
                  <View style={{ marginBottom: spacing.normal }}>
                    <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 8 }}>
                      Selected files ({selectedFiles.length})
                    </Text>

                    {/* File Queue List */}
                    {selectedFiles.map((file, idx) => {
                      const ext = getFileExtension(file.name);
                      return (
                        <Card
                          key={file.id}
                          variant="elevated"
                          padding="sm"
                          style={[styles.fileQueueCard, { borderColor: colors.border }]}
                        >
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

                            <View style={{ flex: 1, marginLeft: 10 }}>
                              <Text variant="sm" weight="700" numberOfLines={1}>
                                {file.name}
                              </Text>
                              {file.error ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                  <Ionicons name="alert-circle" size={13} color={colors.error || '#ef4444'} style={{ marginRight: 4 }} />
                                  <Text variant="xs" weight="600" style={{ color: colors.error || '#ef4444' }}>
                                    Failed: {file.error}
                                  </Text>
                                </View>
                              ) : (
                                <Caption color="muted" style={{ marginTop: 2 }}>
                                  {formatBytes(file.size || 0)}
                                </Caption>
                              )}
                            </View>

                            <TouchableOpacity
                              onPress={() => handleRemoveFile(file.id)}
                              accessibilityLabel={`Remove ${file.name}`}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={[styles.removeFileBtn, { backgroundColor: colors.surfaceRaised }]}
                            >
                              <Ionicons name="close" size={16} color={colors.textSecondary} />
                            </TouchableOpacity>
                          </View>
                        </Card>
                      );
                    })}

                    {/* Add More Files Button (for teachers/admins or single file replacement) */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity
                        onPress={handlePickDocument}
                        activeOpacity={0.7}
                        style={[
                          styles.addMoreBtn,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.button,
                          },
                        ]}
                      >
                        <Ionicons name="document-text-outline" size={16} color={colors.primary} />
                        <Text variant="xs" weight="700" style={{ marginLeft: 6 }}>
                          + Add document
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={handlePickPhoto}
                        activeOpacity={0.7}
                        style={[
                          styles.addMoreBtn,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.button,
                          },
                        ]}
                      >
                        <Ionicons name="images-outline" size={16} color={colors.primary} />
                        <Text variant="xs" weight="700" style={{ marginLeft: 6 }}>
                          + Add photo
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
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
                      Select Files to Share
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
                        <Text variant="xs" weight="700">Choose Documents</Text>
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
                        <Text variant="xs" weight="700">Photos / Notes</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <Button
                  title={
                    selectedFiles.some((f) => Boolean(f.error))
                      ? `Retry ${selectedFiles.filter((f) => Boolean(f.error)).length} Failed File${selectedFiles.filter((f) => Boolean(f.error)).length > 1 ? 's' : ''}`
                      : selectedFiles.length > 0
                      ? `Continue with ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} →`
                      : 'Choose Files Above'
                  }
                  variant="primary"
                  size="lg"
                  disabled={selectedFiles.length === 0 || submitting}
                  onPress={() => {
                    if (selectedFiles.some((f) => Boolean(f.error))) {
                      void handleSubmit();
                    } else {
                      setErrorMsg(null);
                      setCurrentStep(2);
                    }
                  }}
                  style={{ marginTop: spacing.compact }}
                />
              </View>
            )}

            {/* STEP 2: COURSE & SUBJECT SELECTORS */}
            {currentStep === 2 && (
              <View>
                {/* Semester Selector Field */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  SEMESTER *
                </Text>
                <TouchableOpacity
                  onPress={() => setShowSemesterSheet(true)}
                  activeOpacity={0.7}
                  style={[
                    styles.selectorField,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      {currentSemester.label}
                    </Text>
                    <Caption color="muted">
                      {availableSubjects.length} subjects available
                    </Caption>
                  </View>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                {/* Subject Selector Field */}
                <Text
                  variant="xs"
                  weight="700"
                  color="secondary"
                  style={[styles.fieldLabel, { marginTop: spacing.normal }]}
                >
                  SUBJECT / COURSE *
                </Text>
                <TouchableOpacity
                  onPress={() => setShowSubjectSheet(true)}
                  activeOpacity={0.7}
                  style={[
                    styles.selectorField,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="sm"
                      weight="700"
                      numberOfLines={1}
                      style={{ color: effectiveSubjectName ? colors.text : colors.textMuted }}
                    >
                      {effectiveSubjectName || 'Select a subject...'}
                    </Text>
                    {currentSubject?.code && currentSubject.code !== 'CUSTOM' ? (
                      <Caption color="muted">{currentSubject.code}</Caption>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                {/* Custom Subject Input if enabled */}
                {isCustomSubject && (
                  <View style={{ marginTop: 8 }}>
                    <TextInput
                      style={[
                        styles.textInput,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          color: colors.text,
                          borderRadius: radii.input,
                        },
                      ]}
                      placeholder="Enter custom subject name..."
                      placeholderTextColor={colors.textMuted}
                      value={customSubject}
                      onChangeText={setCustomSubject}
                      autoFocus
                    />
                  </View>
                )}

                {/* Navigation Buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.large }}>
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
                  <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 8 }}>
                    UPLOAD SUMMARY
                  </Text>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Semester:</Text>
                    <Text variant="xs" weight="700">{currentSemester.label}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Subject:</Text>
                    <Text variant="xs" weight="700">{effectiveSubjectName || '—'}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Unit:</Text>
                    <Text variant="xs" weight="700">{effectiveChapterName || 'No specific unit'}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="xs" color="secondary">Files:</Text>
                    <Text variant="xs" weight="700">{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected</Text>
                  </View>

                  {/* Individual file items preview */}
                  <View style={styles.summaryFileList}>
                    {selectedFiles.map((file, i) => (
                      <View key={file.id} style={styles.summaryFileItem}>
                        <View style={[styles.summaryFileBadge, { backgroundColor: colors.surfaceRaised }]}>
                          <Text variant="xs" weight="800" style={{ color: colors.primary }}>
                            {getFileExtension(file.name)}
                          </Text>
                        </View>
                        <Text variant="xs" weight="600" numberOfLines={1} style={{ flex: 1, marginLeft: 8 }}>
                          {file.title || file.name}
                        </Text>
                        <Caption color="muted">{formatBytes(file.size || 0)}</Caption>
                      </View>
                    ))}
                  </View>
                </Card>

                {/* Chapter / Unit Selector Field */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  CHAPTER / UNIT (OPTIONAL)
                </Text>
                <TouchableOpacity
                  onPress={() => setShowChapterSheet(true)}
                  activeOpacity={0.7}
                  style={[
                    styles.selectorField,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                      marginBottom: isCustomChapter ? 8 : spacing.normal,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="sm" weight="600" style={{ color: colors.text }}>
                      {effectiveChapterName || 'No specific unit'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                {isCustomChapter && (
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                        borderRadius: radii.input,
                        marginBottom: spacing.normal,
                      },
                    ]}
                    placeholder="Enter unit/chapter name (e.g. Unit 1: Introduction)..."
                    placeholderTextColor={colors.textMuted}
                    value={customChapter}
                    onChangeText={setCustomChapter}
                    autoFocus
                  />
                )}

                {/* Optional Common Title Field */}
                <Text variant="xs" weight="700" color="secondary" style={styles.fieldLabel}>
                  BATCH / NOTE TITLE (OPTIONAL)
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
                  value={commonTitle}
                  onChangeText={setCommonTitle}
                  maxLength={100}
                />
                <Caption color="muted" style={{ marginBottom: spacing.large }}>
                  If left blank, each file will use its clean filename.
                </Caption>

                {/* Primary CTA and Back */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    title="← Back"
                    variant="outline"
                    size="lg"
                    onPress={() => setCurrentStep(2)}
                    disabled={submitting}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title={
                      submitting
                        ? uploadProgressText || 'Uploading...'
                        : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`
                    }
                    variant="primary"
                    size="lg"
                    disabled={submitting || selectedFiles.length === 0}
                    onPress={handleSubmit}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}
          </KeyboardAwareForm>
        </SafeAreaView>

        {/* Semester Selection Sheet */}
        <SelectionSheet
          visible={showSemesterSheet}
          onClose={() => setShowSemesterSheet(false)}
          title="Choose semester"
          options={semesterOptions}
          selectedId={semesterId}
          onSelect={(opt) => handleSelectSemester(opt.id)}
        />

        {/* Subject Selection Sheet */}
        <SelectionSheet
          visible={showSubjectSheet}
          onClose={() => setShowSubjectSheet(false)}
          title="Choose subject"
          options={subjectOptions}
          selectedId={isCustomSubject ? null : selectedSubjectTitle}
          searchable
          searchPlaceholder="Search subjects by name or code..."
          customActionLabel="+ Custom Subject"
          onCustomAction={() => {
            setIsCustomSubject(true);
            setSelectedSubjectTitle('');
          }}
          onSelect={(opt) => handleSelectSubject(opt.id)}
        />

        {/* Chapter / Unit Selection Sheet */}
        <SelectionSheet
          visible={showChapterSheet}
          onClose={() => setShowChapterSheet(false)}
          title="Choose unit / chapter"
          options={chapterOptions}
          selectedId={selectedChapterTitle || '__NO_UNIT__'}
          customActionLabel="+ Custom Unit"
          onCustomAction={() => {
            setIsCustomChapter(true);
            setSelectedChapterTitle('');
          }}
          onSelect={(opt) => {
            setIsCustomChapter(false);
            if (opt.id === '__NO_UNIT__') {
              setSelectedChapterTitle('');
            } else {
              setSelectedChapterTitle(opt.id);
            }
          }}
        />
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
    borderBottomWidth: 1,
  },
  headerBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 64,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  publishBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  stepperContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  stepperTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fieldLabel: {
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fileQueueCard: {
    marginBottom: 8,
  },
  fileSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileBadge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeFileBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderWidth: 1,
  },
  dropzoneCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzoneIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
  },
  selectorField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  textInput: {
    minHeight: 46,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  summaryFileList: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  summaryFileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  summaryFileBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
