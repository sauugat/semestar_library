import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { getFiles, getMyLibraryFiles, LibraryFile, getLibraryStats, LibraryStat } from '@/services/library';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { getBaseUrl } from '@/services/api';
import { SearchOverlay } from '@/components/SearchOverlay';
import { UploadNoteModal } from '@/components/UploadNoteModal';
import {
  SEMESTERS,
  SemesterItem,
  SubjectItem,
  ChapterItem,
  findSubjectAcrossSemesters,
} from '@/constants/subjects.config';

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

function formatFileSize(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileType(filename: string): 'pdf' | 'pptx' | 'docx' | 'zip' | 'file' {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return 'zip';
  return 'file';
}

function SkeletonCard({ colors, radii, spacing }: { colors: any; radii: any; spacing: any }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <Card variant="elevated" padding="md" style={{ marginBottom: spacing.sm }}>
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', opacity: pulseAnim }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radii.md,
            backgroundColor: colors.surfaceRaised,
            marginRight: spacing.md,
          }}
        />
        <View style={{ flex: 1 }}>
          <View
            style={{
              width: '65%',
              height: 16,
              borderRadius: radii.sm,
              backgroundColor: colors.surfaceRaised,
              marginBottom: 8,
            }}
          />
          <View
            style={{
              width: '40%',
              height: 12,
              borderRadius: radii.sm,
              backgroundColor: colors.surfaceSubtle,
            }}
          />
        </View>
      </Animated.View>
    </Card>
  );
}

export default function LibraryScreen() {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ subject?: string; semester?: string; chapter?: string }>();
  const {
    cohort,
    displayLabel,
    isUnassigned,
    isStaff,
    semesterRoman,
    currentSemesterNumber,
    refetch: refetchAcademicContext,
  } = useAcademicContext();

  const [baseUrl, setBaseUrl] = useState('');
  useEffect(() => {
    getBaseUrl().then(setBaseUrl).catch(() => {});
  }, []);

  const getFullImageUrl = (attachmentUrl: string | null): string | null => {
    if (!attachmentUrl) return null;
    if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
      return attachmentUrl;
    }
    return `${baseUrl}${attachmentUrl.startsWith('/') ? '' : '/'}${attachmentUrl}`;
  };

  const brandAvatarUri = user?.avatarUrl ? getFullImageUrl(user.avatarUrl) : null;

  // Navigation state: Subject -> Chapter -> Notes (semester selector is strictly staff-only)
  const queryClient = useQueryClient();
  const [selectedSemesterId, setSelectedSemesterId] = useState<string>('Semester II');
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Upload note modal states
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastOpacity.setValue(0);
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setToastMessage(null);
      });
    }, 2500);
  }, [toastOpacity]);

  // Active semester object from static config.
  // For students and CRs, this is derived strictly from their server-authoritative cohort currentSemester.
  // For teachers/admins, it reflects their selected filter.
  const currentSemester: SemesterItem = useMemo(() => {
    if (!isStaff && currentSemesterNumber) {
      const match = SEMESTERS.find((s) => s.semester === String(currentSemesterNumber));
      if (match) return match;
    }
    return SEMESTERS.find((s) => s.id === selectedSemesterId) || SEMESTERS[1] || SEMESTERS[0];
  }, [isStaff, currentSemesterNumber, selectedSemesterId]);

  // Handle incoming route params (e.g. from Home search)
  useEffect(() => {
    if (params.subject) {
      const match = findSubjectAcrossSemesters(params.subject);
      if (match) {
        if (isStaff) setSelectedSemesterId(match.semester.id);
        setSelectedSubject(match.subject);
        if (params.chapter) {
          const ch = match.subject.chapters.find(
            (c) => c.title.toLowerCase() === params.chapter?.toLowerCase() || c.id === params.chapter
          );
          if (ch) setSelectedChapter(ch);
        }
      }
    } else if (params.semester && isStaff) {
      const sem = SEMESTERS.find(
        (s) =>
          s.id.toLowerCase() === params.semester?.toLowerCase() ||
          s.semester.toLowerCase() === params.semester?.toLowerCase() ||
          s.shortLabel.toLowerCase() === params.semester?.toLowerCase()
      );
      if (sem) setSelectedSemesterId(sem.id);
    }
  }, [params.subject, params.semester, params.chapter, isStaff]);

  // React Query for Notes/Files when a specific chapter is open
  const isNotesLevel = selectedSubject !== null && selectedChapter !== null;
  const chapterFilterParam = selectedChapter?.id === 'ALL' ? undefined : selectedChapter?.id;

  const {
    data: files = [],
    isLoading: loadingFiles,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery<LibraryFile[]>({
    queryKey: ['library', 'files', isStaff ? selectedSemesterId : (cohort?.id || 'my-cohort'), selectedSubject?.title, selectedChapter?.id],
    queryFn: async () => {
      if (!selectedSubject) return [];
      if (!isStaff) {
        return await getMyLibraryFiles({
          subject: selectedSubject.title,
          chapter: chapterFilterParam,
        });
      }
      return await getFiles({
        semester: selectedSemesterId,
        subject: selectedSubject.title,
        chapter: chapterFilterParam,
      });
    },
    enabled: isNotesLevel,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  // Live stats from API for custom/teacher-added subjects
  const { data: libraryStats = [], refetch: refetchStats } = useQuery<LibraryStat[]>({
    queryKey: ['library', 'stats'],
    queryFn: getLibraryStats,
    staleTime: 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetchAcademicContext();
    await refetchStats();
    if (isNotesLevel) {
      await refetchFiles();
    }
    setRefreshing(false);
  };

  // Subjects in active semester (static curriculum merged with custom subjects from live stats)
  const subjects: SubjectItem[] = useMemo(() => {
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
          // Custom subject added via upload!
          subjectMap.set(key, {
            code: 'CUSTOM',
            title: stat.subject.trim(),
            credit: '—',
            chapters: [
              {
                id: 'ALL',
                title: 'All Notes / Files',
                shortTitle: 'All Notes',
                isSpecial: true,
              },
            ],
          });
        }

        // If this custom subject has a specific chapter in the stat, add it to its chapters list
        if (stat.chapter && stat.chapter.trim()) {
          const sub = subjectMap.get(key)!;
          const chapTitle = stat.chapter.trim();
          const hasChap = sub.chapters.some(
            (c) => c.title.toLowerCase().trim() === chapTitle.toLowerCase() || c.id === chapTitle
          );
          if (!hasChap) {
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

  // Chapters in active subject
  const chapters = selectedSubject?.chapters || [];

  // Navigation handlers
  const handleSelectSemester = (semesterId: string) => {
    setSelectedSemesterId(semesterId);
    setSelectedSubject(null);
    setSelectedChapter(null);
  };

  const handleSelectSubject = (subject: SubjectItem) => {
    setSelectedSubject(subject);
    setSelectedChapter(null);
  };

  const handleSelectChapter = (chapter: ChapterItem) => {
    setSelectedChapter(chapter);
  };

  const handleBackToSubjects = () => {
    setSelectedSubject(null);
    setSelectedChapter(null);
  };

  const handleBackToChapters = () => {
    setSelectedChapter(null);
  };

  // Fixed Brand Header matching Home tab's exact header style and layout
  const renderBrandHeader = () => (
    <View
      style={[
        styles.fixedBrandHeader,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {/* Left: Wordmark & Academic Context Badge */}
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[styles.headerWordmark, { color: colors.text }]}>
          Semester Library
        </Text>
        {Boolean(displayLabel) && (
          <View
            style={[
              styles.academicBadge,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.academicBadgeText,
                { color: isUnassigned ? colors.textMuted : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {isUnassigned ? 'Unassigned' : displayLabel}
            </Text>
          </View>
        )}
      </View>

      {/* Right: Search, Add Note (+), and Profile */}
      <View style={styles.headerRightActions}>
        <TouchableOpacity
          onPress={() => setSearchOpen(true)}
          style={[
            styles.headerActionBtn,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          accessibilityLabel="Search notes"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setUploadModalOpen(true)}
          style={[
            styles.headerActionBtn,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          accessibilityLabel="Add note"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={22} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(tabs)/profile')}
          style={[
            styles.headerAvatarBtn,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          accessibilityLabel="Open profile"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {brandAvatarUri ? (
            <Image
              source={{ uri: brandAvatarUri }}
              style={{ width: '100%', height: '100%', borderRadius: 16 }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text variant="xs" weight="700" color="primary">
              {(user?.name || 'S').charAt(0).toUpperCase()}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      {/* Pinned Brand Header (matching Home style) */}
      {renderBrandHeader()}

      {/* ─────────────────────────────────────────────────────────────
          LEVEL 3: NOTES / FILES VIEW (When Chapter is Selected)
          ───────────────────────────────────────────────────────────── */}
      {selectedSubject && selectedChapter && (
        <ScrollView
          contentContainerStyle={[styles.container, { padding: spacing.md }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Breadcrumb Navigation Bar */}
          <View style={[styles.navHeader, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleBackToChapters}
              style={[
                styles.backButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.sm + 4,
                  paddingVertical: spacing.xs + 2,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.text} style={{ marginRight: 6 }} />
              <Text variant="sm" weight="600" color="primary">
                Chapters
              </Text>
            </TouchableOpacity>

            <View style={styles.breadcrumbTextContainer}>
              <Caption color="muted" numberOfLines={1}>
                {selectedSubject.code} › {selectedChapter.shortTitle || selectedChapter.title}
              </Caption>
            </View>
          </View>

          {/* Chapter Header Card */}
          <Card
            variant="elevated"
            padding="md"
            style={[styles.headerCard, { marginBottom: spacing.md, borderColor: colors.border }]}
          >
            <View style={styles.chapterHeaderRow}>
              <View
                style={[
                  styles.unitBadge,
                  {
                    backgroundColor: '#27272A',
                    borderRadius: radii.md,
                    marginRight: spacing.md,
                  },
                ]}
              >
                <Text variant="xs" weight="800" style={{ color: '#FFFFFF' }}>
                  {selectedChapter.unitNumber ? `U${selectedChapter.unitNumber}` : '•'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Heading style={{ fontSize: 18, lineHeight: 24, marginBottom: 2 }}>
                  {selectedChapter.title}
                </Heading>
                <Caption color="muted">
                  {selectedSubject.title} • {currentSemester.shortLabel}
                </Caption>
              </View>
            </View>
          </Card>

          {/* Section Title */}
          <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
            <Subheading>Study Materials</Subheading>
            {!loadingFiles && (
              <Caption color="muted">
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </Caption>
            )}
          </View>

          {/* Loading State: Skeleton Cards */}
          {loadingFiles && !refreshing && (
            <View>
              <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
              <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
              <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
            </View>
          )}

          {/* Error State */}
          {!loadingFiles && filesError && (
            <Card variant="elevated" padding="lg" style={styles.centerCard}>
              <Ionicons name="cloud-offline-outline" size={40} color={colors.error} style={{ marginBottom: spacing.sm }} />
              <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>Connection Error</Heading>
              <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
                Unable to load materials for this chapter.
              </Text>
              <Button
                title="Try Again"
                variant="primary"
                size="sm"
                onPress={() => refetchFiles()}
                leftIcon={<Ionicons name="refresh" size={14} color={colors.primaryText} />}
              />
            </Card>
          )}

          {/* Empty State */}
          {!loadingFiles && !filesError && files.length === 0 && (
            <EmptyState
              icon="folder-open-outline"
              title="No Notes Yet"
              description={`No study materials have been uploaded for ${selectedChapter.title} yet.`}
              actionTitle="Upload Note"
              onAction={() => setUploadModalOpen(true)}
            />
          )}

          {/* Files List */}
          {!loadingFiles && !filesError && files.length > 0 && (
            <View>
              {files.map((file) => {
                const ext = getFileType(file.originalName);

                return (
                  <Card
                    key={file.id}
                    variant="elevated"
                    padding="md"
                    onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
                    style={{ marginBottom: spacing.sm, borderColor: colors.border }}
                  >
                    <View style={styles.fileRow}>
                      <View
                        style={[
                          styles.fileTypeBadge,
                          {
                            backgroundColor: '#27272A',
                            borderRadius: radii.md,
                            marginRight: spacing.md,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                          {ext.toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text weight="700" variant="sm" numberOfLines={1}>
                          {file.title || file.originalName}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                          <Caption color="muted">
                            {formatFileSize(file.sizeBytes)} • By{' '}
                          </Caption>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={(e) => {
                              e.stopPropagation();
                              if (file.uploadedBy) {
                                router.push({
                                  pathname: '/user/[id]',
                                  params: { id: file.uploadedBy },
                                });
                              }
                            }}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Caption weight="700" color="primary" style={{ textDecorationLine: 'underline' }}>
                              {file.uploaderName || 'Student'}
                            </Caption>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.fileMetaRow}>
                          {Boolean(Number(file.likeCount)) && (
                            <Caption color="muted" style={{ marginRight: spacing.sm }}>
                              ♥ {String(file.likeCount)}
                            </Caption>
                          )}
                          {Boolean(Number(file.commentCount)) && (
                            <Caption color="muted">
                              💬 {String(file.commentCount)}
                            </Caption>
                          )}
                        </View>
                      </View>

                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* ─────────────────────────────────────────────────────────────
          LEVEL 2: CHAPTERS VIEW (When Subject is Selected)
          ───────────────────────────────────────────────────────────── */}
      {selectedSubject && !selectedChapter && (
        <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md }]}>
          {/* Breadcrumb Navigation Bar */}
          <View style={[styles.navHeader, { marginBottom: spacing.md }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleBackToSubjects}
              style={[
                styles.backButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.sm + 4,
                  paddingVertical: spacing.xs + 2,
                },
              ]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.text} style={{ marginRight: 6 }} />
              <Text variant="sm" weight="600" color="primary">
                {currentSemester.shortLabel} Subjects
              </Text>
            </TouchableOpacity>

            <View style={styles.breadcrumbTextContainer}>
              <Caption color="muted" numberOfLines={1}>
                {currentSemester.shortLabel} › {selectedSubject.code}
              </Caption>
            </View>
          </View>

          {/* Subject Header Card */}
          <Card
            variant="elevated"
            padding="lg"
            style={[styles.subjectBannerCard, { marginBottom: spacing.md, borderColor: colors.border }]}
          >
            <View style={styles.subjectBannerTop}>
              <View
                style={[
                  styles.codePill,
                  {
                    backgroundColor: '#27272A',
                    borderRadius: radii.sm,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 2,
                  },
                ]}
              >
                <Text variant="xs" weight="700" style={{ color: '#FFFFFF' }}>
                  {selectedSubject.code}
                </Text>
              </View>
              {Boolean(selectedSubject.credit) && (
                <Caption color="muted">{selectedSubject.credit} Credits</Caption>
              )}
            </View>

            <Heading style={{ fontSize: 20, lineHeight: 26, marginVertical: spacing.xs }}>
              {selectedSubject.title}
            </Heading>

            <Caption color="secondary">
              {currentSemester.year} • {currentSemester.label} • {selectedSubject.chapters.length} Units & Categories
            </Caption>
          </Card>

          {/* Section Header */}
          <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
            <Subheading>Syllabus Units & Chapters</Subheading>
            <Caption color="muted">{chapters.length} Chapters</Caption>
          </View>

          {/* Chapters List */}
          {chapters.map((chapter) => {
            const isSpecial = chapter.isSpecial;

            return (
              <Card
                key={chapter.id}
                variant="elevated"
                padding="md"
                onPress={() => handleSelectChapter(chapter)}
                style={[styles.chapterCard, { marginBottom: spacing.sm, borderColor: colors.border }]}
              >
                <View style={styles.chapterCardRow}>
                  <View
                    style={[
                      styles.chapterBadge,
                      {
                        backgroundColor: isSpecial ? '#1E293B' : '#27272A',
                        borderRadius: radii.md,
                        marginRight: spacing.md,
                      },
                    ]}
                  >
                    {isSpecial ? (
                      <Ionicons
                        name={chapter.id === 'PYQS' ? 'document-text-outline' : 'bookmark-outline'}
                        size={16}
                        color="#FFFFFF"
                      />
                    ) : (
                      <Text variant="xs" weight="800" style={{ color: '#FFFFFF' }}>
                        {chapter.unitNumber ? String(chapter.unitNumber).padStart(2, '0') : '•'}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text variant="sm" weight="600" color="primary" numberOfLines={2}>
                      {chapter.title}
                    </Text>
                    {Boolean(chapter.shortTitle && chapter.shortTitle !== chapter.title) && (
                      <Caption color="muted" numberOfLines={1}>
                        {chapter.shortTitle}
                      </Caption>
                    )}
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* ─────────────────────────────────────────────────────────────
          LEVEL 1: SUBJECTS VIEW (Directly for Students; Filtered for Staff)
          ───────────────────────────────────────────────────────────── */}
      {!selectedSubject && (
        <ScrollView
          contentContainerStyle={[styles.container, { padding: spacing.md }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Unassigned Student State */}
          {isUnassigned && (
            <Card variant="elevated" padding="lg" style={[styles.centerCard, { marginBottom: spacing.md }]}>
              <Ionicons name="school-outline" size={40} color={colors.textSecondary} style={{ marginBottom: spacing.sm }} />
              <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>Class Not Assigned</Heading>
              <Text variant="sm" color="secondary" style={{ textAlign: 'center' }}>
                Your class has not been assigned yet. Course materials for your cohort will appear once assigned by faculty.
              </Text>
            </Card>
          )}

          {/* Teacher/Admin Semester & Cohort Filter Tabs (Only rendered for staff) */}
          {isStaff && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.md, marginBottom: spacing.md }}
              contentContainerStyle={[styles.semesterTabContainer, { paddingHorizontal: spacing.md }]}
            >
              {SEMESTERS.map((sem) => {
                const isSelected = sem.id === selectedSemesterId;
                return (
                  <TouchableOpacity
                    key={sem.id}
                    activeOpacity={0.7}
                    onPress={() => handleSelectSemester(sem.id)}
                    style={[
                      styles.semesterPill,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                        borderRadius: radii.full,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs + 3,
                        marginRight: spacing.xs + 4,
                      },
                    ]}
                  >
                    <Text
                      variant="sm"
                      weight="700"
                      style={{ color: isSelected ? colors.primaryText : colors.text }}
                    >
                      {sem.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Section Header */}
          <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
            <View>
              <Subheading>Subjects & Curriculum</Subheading>
              {Boolean(displayLabel) && (
                <Caption color="muted">{displayLabel}</Caption>
              )}
            </View>
            <Caption color="muted">{subjects.length} Available</Caption>
          </View>

          {/* Subjects List */}
          {subjects.map((subject) => {
            const unitCount = (subject.chapters || []).filter((c) => !c.isSpecial).length;

            return (
              <Card
                key={`${subject.code}-${subject.title}`}
                variant="elevated"
                padding="md"
                onPress={() => handleSelectSubject(subject)}
                style={[styles.subjectCard, { marginBottom: spacing.sm, borderColor: colors.border }]}
              >
                <View style={styles.subjectCardContent}>
                  {/* Top Badge Row */}
                  <View style={styles.subjectTopRow}>
                    <View
                      style={[
                        styles.codeBadge,
                        {
                          backgroundColor: '#27272A',
                          borderRadius: radii.sm,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 2,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                        {subject.code}
                      </Text>
                    </View>
                    {Boolean(subject.credit) && (
                      <Caption color="muted">{subject.credit} Credits</Caption>
                    )}
                  </View>

                  {/* Subject Title */}
                  <Text variant="md" weight="700" color="primary" style={{ marginVertical: spacing.xs }}>
                    {subject.title}
                  </Text>

                  {/* Bottom Row */}
                    <View style={styles.subjectBottomRow}>
                      <Caption color="secondary">
                        {unitCount} Syllabus {unitCount === 1 ? 'Unit' : 'Units'} • Notes & PYQs
                      </Caption>
                      <View
                        style={[
                          styles.openPill,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.borderSubtle,
                            borderRadius: radii.pill,
                          },
                        ]}
                      >
                        <Ionicons name="arrow-forward" size={14} color={colors.textSecondary} />
                      </View>
                    </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* Live Notes / Files Search Overlay */}
      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        filterType="files"
        placeholder="Search notes across subjects & chapters..."
      />

      {/* Upload Note Flow Modal */}
      <UploadNoteModal
        visible={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        initialSemesterId={isStaff ? selectedSemesterId : (semesterRoman || currentSemester.id)}
        initialSubjectTitle={selectedSubject?.title}
        initialChapterTitle={selectedChapter?.title}
        onSuccess={(msg) => {
          queryClient.invalidateQueries({ queryKey: ['library'] });
          refetchFiles();
          showToast(msg || '🎉 Note uploaded successfully!');
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              backgroundColor: '#1E293B',
              borderColor: 'rgba(255, 255, 255, 0.15)',
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="checkmark-circle" size={18} color="#22C55E" style={{ marginRight: 8 }} />
          <Text variant="sm" weight="600" style={{ color: '#F8FAFC' }}>
            {toastMessage}
          </Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fixedBrandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  headerWordmark: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  academicBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  academicBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  toastContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 999,
  },
  container: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  semesterTabContainer: {
    flexDirection: 'row',
  },
  semesterPill: {
    borderWidth: 1,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  breadcrumbTextContainer: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  headerCard: {
    borderWidth: 1,
  },
  subjectBannerCard: {
    borderWidth: 1,
  },
  subjectBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codePill: {
    alignSelf: 'flex-start',
  },
  subjectCard: {
    borderWidth: 1,
  },
  subjectCardContent: {},
  subjectTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeBadge: {
    alignSelf: 'flex-start',
  },
  subjectBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  openPill: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chapterCard: {
    borderWidth: 1,
  },
  chapterCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chapterBadge: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileTypeBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  centerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
});
