import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
  PanResponder,
  Alert,
  useWindowDimensions,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { usePagerSwipe } from '@/components/navigation/PagerTabs';
import { useAdaptiveNavScroll } from '@/context/NavScrollContext';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import {
  getFiles,
  getMyLibraryFiles,
  LibraryFile,
  getLibraryStats,
  LibraryStat,
  voteFile,
  getFileComments,
  addFileComment,
  editFileComment,
  toggleFileCommentReaction,
  deleteFileComment,
  FileComment,
} from '@/services/library';
import {
  getFeedFiles,
  voteAssignment,
  applyCachedAssignmentVotes,
  getAssignmentComments,
  addAssignmentComment,
  editAssignmentComment,
  toggleAssignmentCommentReaction,
  deleteAssignmentComment,
  Post,
  PostComment,
} from '@/services/posts';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { apiFetch, getBaseUrl, getAutoDetectedServerUrl } from '@/services/api';
import { formatTimeAgo } from '@/utils/date';
import { SearchOverlay } from '@/components/SearchOverlay';
import { UploadNoteModal } from '@/components/UploadNoteModal';
import { VoteButtons } from '@/components/PostCard';
import { CommentsBottomSheetModal } from '@/components/CommentsBottomSheetModal';
import { TeacherMaterialsView } from '@/components/teacher/TeacherMaterialsView';
import { AdminUsersView } from '@/components/admin/AdminUsersView';
import { UnrecognizedRoleView } from '@/components/admin/UnrecognizedRoleView';
import { resolveAppRole } from '@/utils/roles';
import { useAdminMode } from '@/context/AdminModeContext';
import {
  SEMESTERS,
  SemesterItem,
  SubjectItem,
  ChapterItem,
  findSubjectAcrossSemesters,
} from '@/constants/subjects.config';

type LibrarySection = 'feed' | 'browse';

type FeedAssignment = {
  id: number;
  title: string;
  description?: string;
  teacherName?: string;
  createdBy?: string;
  subject?: string;
  semester?: string;
  language?: string;
  pdfUrl?: string | null;
  pdfName?: string | null;
  createdAt: string;
  deadline?: string;
  avatarUrl?: string;
  teacherAvatar?: string;
  questionCount?: number;
  submissionCount?: number;
  liked?: boolean;
  likeCount?: number;
  upCount?: number;
  downCount?: number;
  myVote?: number;
  commentCount?: number;
};

type LibraryFeedItem =
  | { feedType: 'file'; file: LibraryFile; time: number }
  | { feedType: 'assignment'; assignment: FeedAssignment; time: number };

function isBoilerplatePdfDescription(desc?: string | null): boolean {
  if (!desc) return true;
  const clean = desc.trim().toLowerCase();
  return (
    clean === '' ||
    clean === 'refer to attached assignment pdf for problem statement' ||
    clean === 'refer to attached assignment pdf for problem statement.' ||
    clean === 'question solution from attached pdf'
  );
}

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

function FeedPostSkeletonCard({ colors }: { colors: any }) {
  return (
    <View
      style={{
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: colors.surfaceRaised,
            marginRight: 10,
          }}
        />
        <View style={{ flex: 1 }}>
          <View
            style={{
              width: 130,
              height: 14,
              borderRadius: 4,
              backgroundColor: colors.surfaceRaised,
              marginBottom: 6,
            }}
          />
          <View
            style={{
              width: 80,
              height: 10,
              borderRadius: 3,
              backgroundColor: colors.surfaceSubtle,
            }}
          />
        </View>
      </View>
      <View
        style={{
          width: '85%',
          height: 14,
          borderRadius: 4,
          backgroundColor: colors.surfaceRaised,
          marginBottom: 10,
        }}
      />
      <View
        style={{
          width: '100%',
          height: 54,
          borderRadius: 12,
          backgroundColor: colors.surfaceRaised,
          marginBottom: 12,
        }}
      />
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ width: 64, height: 18, borderRadius: 4, backgroundColor: colors.surfaceSubtle }} />
        <View style={{ width: 48, height: 18, borderRadius: 4, backgroundColor: colors.surfaceSubtle }} />
      </View>
    </View>
  );
}

function StudentLibraryView({ isTeacherRole = false }: { isTeacherRole?: boolean }) {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const { setSwipeEnabled } = usePagerSwipe();
  const { onScroll: handleNavScroll, scrollEventThrottle } = useAdaptiveNavScroll();
  const params = useLocalSearchParams<{
    subject?: string;
    semester?: string;
    chapter?: string;
    unit?: string;
    fromSyllabus?: string;
    section?: string;
  }>();
  const {
    cohort,
    displayLabel,
    isUnassigned,
    isStaff,
    semesterRoman,
    currentSemesterNumber,
    refetch: refetchAcademicContext,
  } = useAcademicContext();

  const [baseUrl, setBaseUrl] = useState<string>(getAutoDetectedServerUrl());
  useEffect(() => {
    getBaseUrl().then(setBaseUrl).catch(() => {});
  }, []);

  const getFullImageUrl = useCallback(
    (attachmentUrl: string | null | undefined): string | null => {
      if (!attachmentUrl) return null;
      if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
        return attachmentUrl;
      }
      return `${baseUrl}${attachmentUrl.startsWith('/') ? '' : '/'}${attachmentUrl}`;
    },
    [baseUrl]
  );

  const brandAvatarUri = user?.avatarUrl ? getFullImageUrl(user.avatarUrl) : null;

  // ─────────────────────────────────────────────────────────────
  // SLIDABLE & ANIMATED 2-SECTION STATE ('feed' = 0, 'browse' = 1)
  // ─────────────────────────────────────────────────────────────
  const initialSection: LibrarySection =
    params.subject || params.semester || params.section === 'browse' ? 'browse' : 'feed';
  const [activeSection, setActiveSection] = useState<LibrarySection>(initialSection);
  const activeSectionRef = useRef<LibrarySection>(initialSection);
  const slideAnim = useRef(new Animated.Value(initialSection === 'browse' ? 1 : 0)).current;
  const [switcherTrackWidth, setSwitcherTrackWidth] = useState(0);

  // Navigation state for Section 2 (Subject -> Chapter -> Notes)
  const queryClient = useQueryClient();
  const [selectedSemesterId, setSelectedSemesterId] = useState<string>('Semester I');
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const selectedSubjectRef = useRef<SubjectItem | null>(null);
  useEffect(() => {
    selectedSubjectRef.current = selectedSubject;
  }, [selectedSubject]);

  const animateToSection = useCallback(
    (target: LibrarySection) => {
      activeSectionRef.current = target;
      setActiveSection(target);
      Animated.spring(slideAnim, {
        toValue: target === 'browse' ? 1 : 0,
        damping: 24,
        stiffness: 240,
        mass: 0.85,
        useNativeDriver: true,
      }).start();
    },
    [slideAnim]
  );

  // Horizontal swipe gesture responder to smoothly slide between Section 1 & Section 2
  const pagerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.35) {
            return false;
          }
          if (activeSectionRef.current === 'feed' && dx < -14) {
            return true;
          }
          if (activeSectionRef.current === 'browse' && dx > 14 && !selectedSubjectRef.current) {
            return true;
          }
          return false;
        },
        onPanResponderGrant: () => {
          setSwipeEnabled(false);
          slideAnim.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          const w = Math.max(screenWidth, 1);
          const base = activeSectionRef.current === 'browse' ? 1 : 0;
          const next = Math.max(0, Math.min(1, base - gestureState.dx / w));
          slideAnim.setValue(next);
        },
        onPanResponderRelease: (_, gestureState) => {
          setSwipeEnabled(true);
          const w = Math.max(screenWidth, 1);
          const base = activeSectionRef.current === 'browse' ? 1 : 0;
          const projected = base - (gestureState.dx + gestureState.vx * 110) / w;
          const target: LibrarySection = projected >= 0.5 ? 'browse' : 'feed';
          animateToSection(target);
        },
        onPanResponderTerminate: () => {
          setSwipeEnabled(true);
          animateToSection(activeSectionRef.current);
        },
      }),
    [screenWidth, slideAnim, animateToSection, setSwipeEnabled]
  );

  const [refreshing, setRefreshing] = useState(false);

  // Search & Upload note modal states
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (msg: string) => {
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
    },
    [toastOpacity]
  );

  // ─────────────────────────────────────────────────────────────
  // SECTION 1 DATA: NOTES & ASSIGNMENT POSTS FEED
  // ─────────────────────────────────────────────────────────────
  const isTeacherUser = isTeacherRole || user?.role === 'teacher' || user?.role === 'faculty';
  const [feedFiles, setFeedFiles] = useState<LibraryFile[]>([]);
  const [feedAssignments, setFeedAssignments] = useState<FeedAssignment[]>([]);

  const {
    data: libraryFeedData,
    isLoading: isLibraryFeedLoading,
    error: libraryFeedError,
    refetch: refetchLibraryFeed,
  } = useQuery({
    queryKey: ['library-posts-feed', user?.studentId, isTeacherUser],
    queryFn: async () => {
      const feedQuery = isTeacherUser ? '?feed=1' : '';
      const [filesRes, rawAssignments] = await Promise.all([
        getFeedFiles(feedQuery),
        apiFetch(`/api/code-lab/assignments${feedQuery}`)
          .then(async (res) => (res.ok ? ((await res.json()) as FeedAssignment[]) : []))
          .catch(() => [] as FeedAssignment[]),
      ]);
      const assignmentsWithVotes = await applyCachedAssignmentVotes(
        Array.isArray(rawAssignments) ? rawAssignments : []
      );
      return {
        files: Array.isArray(filesRes) ? filesRes : [],
        assignments: assignmentsWithVotes,
      };
    },
    staleTime: 45 * 1000,
  });

  useEffect(() => {
    if (libraryFeedData) {
      setFeedFiles(libraryFeedData.files);
      setFeedAssignments(libraryFeedData.assignments);
    }
  }, [libraryFeedData]);

  const eligibleFeedFiles = useMemo(() => {
    if (isTeacherUser && user?.studentId) {
      return feedFiles.filter((f) => f.uploadedBy === user.studentId);
    }
    return feedFiles;
  }, [feedFiles, isTeacherUser, user?.studentId]);

  const eligibleFeedAssignments = useMemo(() => {
    if (isTeacherUser && user?.studentId) {
      return feedAssignments.filter((a) => a.createdBy === user.studentId);
    }
    return feedAssignments;
  }, [feedAssignments, isTeacherUser, user?.studentId]);

  const combinedFeedItems = useMemo<LibraryFeedItem[]>(() => {
    const fileItems: LibraryFeedItem[] = eligibleFeedFiles.map((file) => ({
      feedType: 'file',
      file,
      time: new Date(file.uploadedAt || (file as any).createdAt || 0).getTime() || 0,
    }));

    const assignmentItems: LibraryFeedItem[] = eligibleFeedAssignments.map((assignment) => ({
      feedType: 'assignment',
      assignment,
      time: new Date(assignment.createdAt || 0).getTime() || 0,
    }));

    return [...fileItems, ...assignmentItems].sort((a, b) => {
      if (b.time !== a.time) return b.time - a.time;
      const bId = b.feedType === 'file' ? b.file.id : b.assignment.id;
      const aId = a.feedType === 'file' ? a.file.id : a.assignment.id;
      return Number(bId) - Number(aId);
    });
  }, [eligibleFeedFiles, eligibleFeedAssignments]);

  // ─────────────────────────────────────────────────────────────
  // COMMENTS & VOTING HANDLERS FOR NOTES & ASSIGNMENTS
  // ─────────────────────────────────────────────────────────────
  const [activeCommentPost, setActiveCommentPost] = useState<Post | null>(null);
  const [activeCommentKind, setActiveCommentKind] = useState<'file' | 'assignment'>('file');
  const [postComments, setPostComments] = useState<PostComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [commentsModalOpen, setCommentsModalOpen] = useState(false);
  const [commentReplyingTo, setCommentReplyingTo] = useState<{
    commentId: number;
    name: string;
    studentId?: string;
  } | null>(null);
  const [commentEditing, setCommentEditing] = useState<{
    id: number;
    content: string;
  } | null>(null);
  const commentInputRef = useRef<TextInputInstance>(null);

  const normalizeFileOrAssignmentComment = useCallback(
    (c: FileComment, targetPostId: number): PostComment => ({
      id: Number(c.id),
      postId: Number(c.postId || c.fileId || targetPostId),
      userId: c.userId || c.studentId,
      studentId: c.studentId,
      content: c.content || c.commentText || '',
      createdAt: c.createdAt || (c as any).created_at,
      updatedAt: c.updatedAt || (c as any).updated_at || null,
      edited: Boolean(
        c.edited ||
          ((c.updatedAt || (c as any).updated_at) &&
            (c.updatedAt || (c as any).updated_at) !== (c.createdAt || (c as any).created_at))
      ),
      name: c.name || c.commenterName || 'Student',
      role: c.role || 'student',
      avatarUrl: c.avatarUrl || null,
      parentCommentId: c.parentCommentId ?? (c as any).parent_comment_id ?? null,
      replyToUserId: c.replyToUserId ?? (c as any).reply_to_user_id ?? null,
      replyToUser: c.replyToUser || null,
      reactionCount: Number(c.reactionCount ?? (c as any).reaction_count ?? 0),
      reactedByMe: Boolean(c.reactedByMe ?? (c as any).reacted_by_me),
      canDelete: Boolean(
        c.canDelete ||
          (user?.studentId && c.studentId === user.studentId) ||
          user?.role === 'admin'
      ),
      canEdit: Boolean(c.canEdit || (user?.studentId && c.studentId === user.studentId)),
      replyCount: Number(c.replyCount ?? (c.replies ? c.replies.length : 0)),
      replies: Array.isArray(c.replies)
        ? c.replies.map((r) => ({
            id: Number(r.id),
            postId: Number(r.postId || r.fileId || targetPostId),
            userId: r.userId || r.studentId,
            studentId: r.studentId,
            content: r.content || r.commentText || '',
            createdAt: r.createdAt || (r as any).created_at,
            updatedAt: r.updatedAt || (r as any).updated_at || null,
            edited: Boolean(
              r.edited ||
                ((r.updatedAt || (r as any).updated_at) &&
                  (r.updatedAt || (r as any).updated_at) !== (r.createdAt || (r as any).created_at))
            ),
            name: r.name || r.commenterName || 'Student',
            role: r.role || 'student',
            avatarUrl: r.avatarUrl || null,
            parentCommentId: r.parentCommentId ?? (r as any).parent_comment_id ?? c.id,
            replyToUserId: r.replyToUserId ?? (r as any).reply_to_user_id ?? null,
            replyToUser: r.replyToUser || null,
            reactionCount: Number(r.reactionCount ?? (r as any).reaction_count ?? 0),
            reactedByMe: Boolean(r.reactedByMe ?? (r as any).reacted_by_me),
            canDelete: Boolean(
              r.canDelete ||
                (user?.studentId && r.studentId === user.studentId) ||
                user?.role === 'admin'
            ),
            canEdit: Boolean(r.canEdit || (user?.studentId && r.studentId === user.studentId)),
            replies: [],
          }))
        : [],
    }),
    [user?.studentId, user?.role]
  );

  const handleOpenFileComments = async (file: LibraryFile) => {
    setActiveCommentKind('file');
    setActiveCommentPost({
      id: file.id,
      user_id: file.uploadedBy,
      studentId: file.uploadedBy,
      name: file.uploaderName || 'Student',
      role: file.uploaderRole || 'student',
      avatarUrl: file.uploaderAvatar || null,
      title: file.title || file.originalName,
      content: file.subject ? `${file.subject}${file.chapter ? ` • ${file.chapter}` : ''}` : file.originalName,
      type: 'status',
      attachment_url: null,
      created_at: file.uploadedAt,
      like_count: Number(file.upCount ?? file.likeCount ?? 0),
      comment_count: Number(file.commentCount || 0),
      submission_count: 0,
      liked_by_me: Boolean(file.liked),
    });
    setCommentReplyingTo(null);
    setCommentEditing(null);
    setCommentInput('');
    setCommentsModalOpen(true);
    setLoadingComments(true);
    try {
      const data = await getFileComments(file.id);
      setPostComments((data || []).map((c) => normalizeFileOrAssignmentComment(c, file.id)));
    } catch {
      showToast('Could not load note comments');
    } finally {
      setLoadingComments(false);
    }
  };

  const handleOpenAssignmentComments = async (assignment: FeedAssignment) => {
    setActiveCommentKind('assignment');
    setActiveCommentPost({
      id: assignment.id,
      user_id: assignment.createdBy || '',
      studentId: assignment.createdBy || '',
      name: assignment.teacherName || 'Faculty Member',
      role: 'teacher',
      avatarUrl: assignment.avatarUrl || assignment.teacherAvatar || null,
      title: assignment.title,
      content: assignment.description || assignment.subject || '',
      type: 'assignment',
      attachment_url: null,
      created_at: assignment.createdAt,
      like_count: Number(assignment.upCount ?? assignment.likeCount ?? 0),
      comment_count: Number(assignment.commentCount || 0),
      submission_count: Number(assignment.submissionCount || 0),
      liked_by_me: Boolean(assignment.liked),
    });
    setCommentReplyingTo(null);
    setCommentEditing(null);
    setCommentInput('');
    setCommentsModalOpen(true);
    setLoadingComments(true);
    try {
      const data = await getAssignmentComments(assignment.id);
      setPostComments((data || []).map((c) => normalizeFileOrAssignmentComment(c, assignment.id)));
    } catch {
      showToast('Could not load assignment comments');
    } finally {
      setLoadingComments(false);
    }
  };

  const handleReplyPressModal = (comment: PostComment) => {
    setCommentEditing(null);
    const rootCommentId = comment.parentCommentId ? Number(comment.parentCommentId) : Number(comment.id);
    setCommentReplyingTo({
      commentId: rootCommentId,
      name: comment.name || 'User',
      studentId: comment.studentId || comment.userId,
    });
    setTimeout(() => {
      commentInputRef.current?.focus();
    }, 50);
  };

  const handleEditPressModal = (comment: PostComment) => {
    setCommentReplyingTo(null);
    setCommentEditing({
      id: comment.id,
      content: comment.content,
    });
    setCommentInput(comment.content);
    setTimeout(() => {
      commentInputRef.current?.focus();
    }, 50);
  };

  const handleCancelCommentInputMode = () => {
    setCommentReplyingTo(null);
    setCommentEditing(null);
    setCommentInput('');
  };

  const handleSubmitComment = async () => {
    if (!activeCommentPost || !commentInput.trim() || postingComment) return;
    const content = commentInput.trim();
    setPostingComment(true);
    try {
      if (activeCommentKind === 'file') {
        if (commentEditing) {
          const res = await editFileComment(activeCommentPost.id, commentEditing.id, content);
          const normalized = res.comment
            ? normalizeFileOrAssignmentComment(res.comment, activeCommentPost.id)
            : null;
          setPostComments((prev) =>
            prev.map((root) => {
              if (root.id === commentEditing.id) {
                return normalized ? { ...root, ...normalized, replies: root.replies } : { ...root, content, edited: true };
              }
              if (root.replies && root.replies.length > 0) {
                return {
                  ...root,
                  replies: root.replies.map((reply) =>
                    reply.id === commentEditing.id
                      ? normalized
                        ? { ...reply, ...normalized }
                        : { ...reply, content, edited: true }
                      : reply
                  ),
                };
              }
              return root;
            })
          );
          setCommentEditing(null);
          setCommentInput('');
          showToast('Comment updated');
          return;
        }

        const res = await addFileComment(
          activeCommentPost.id,
          content,
          commentReplyingTo
            ? {
                parentCommentId: commentReplyingTo.commentId,
                replyToUserId: commentReplyingTo.studentId,
              }
            : undefined
        );
        const wasReply = Boolean(commentReplyingTo);
        const parentId = commentReplyingTo?.commentId;
        setCommentInput('');
        setCommentReplyingTo(null);
        if (res.comment) {
          const newComment = normalizeFileOrAssignmentComment(res.comment, activeCommentPost.id);
          if (wasReply && parentId) {
            setPostComments((prev) =>
              prev.map((root) => {
                if (root.id === parentId) {
                  const currentReplies = root.replies || [];
                  return {
                    ...root,
                    replyCount: (root.replyCount || currentReplies.length) + 1,
                    replies: [...currentReplies, newComment],
                  };
                }
                return root;
              })
            );
          } else {
            setPostComments((prev) => [...prev, newComment]);
          }
        }
        const updatedCount = res.commentCount ?? (activeCommentPost.comment_count + 1);
        setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
        setFeedFiles((prev) =>
          prev.map((f) =>
            Number(f.id) === Number(activeCommentPost.id) ? { ...f, commentCount: updatedCount } : f
          )
        );
        showToast(wasReply ? 'Reply posted' : 'Comment posted');
        return;
      }

      if (activeCommentKind === 'assignment') {
        if (commentEditing) {
          const res = await editAssignmentComment(activeCommentPost.id, commentEditing.id, content);
          const normalized = res.comment
            ? normalizeFileOrAssignmentComment(res.comment, activeCommentPost.id)
            : null;
          setPostComments((prev) =>
            prev.map((root) => {
              if (root.id === commentEditing.id) {
                return normalized ? { ...root, ...normalized, replies: root.replies } : { ...root, content, edited: true };
              }
              if (root.replies && root.replies.length > 0) {
                return {
                  ...root,
                  replies: root.replies.map((reply) =>
                    reply.id === commentEditing.id
                      ? normalized
                        ? { ...reply, ...normalized }
                        : { ...reply, content, edited: true }
                      : reply
                  ),
                };
              }
              return root;
            })
          );
          setCommentEditing(null);
          setCommentInput('');
          showToast('Comment updated');
          return;
        }

        const res = await addAssignmentComment(
          activeCommentPost.id,
          content,
          commentReplyingTo
            ? {
                parentCommentId: commentReplyingTo.commentId,
                replyToUserId: commentReplyingTo.studentId,
              }
            : undefined
        );
        const wasReply = Boolean(commentReplyingTo);
        const parentId = commentReplyingTo?.commentId;
        setCommentInput('');
        setCommentReplyingTo(null);
        if (res.comment) {
          const newComment = normalizeFileOrAssignmentComment(res.comment, activeCommentPost.id);
          if (wasReply && parentId) {
            setPostComments((prev) =>
              prev.map((root) => {
                if (root.id === parentId) {
                  const currentReplies = root.replies || [];
                  return {
                    ...root,
                    replyCount: (root.replyCount || currentReplies.length) + 1,
                    replies: [...currentReplies, newComment],
                  };
                }
                return root;
              })
            );
          } else {
            setPostComments((prev) => [...prev, newComment]);
          }
        }
        const updatedCount = res.commentCount ?? (activeCommentPost.comment_count + 1);
        setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
        setFeedAssignments((prev) =>
          prev.map((a) =>
            Number(a.id) === Number(activeCommentPost.id) ? { ...a, commentCount: updatedCount } : a
          )
        );
        showToast(wasReply ? 'Reply posted' : 'Comment posted');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not post comment.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleToggleCommentReactionModal = async (comment: PostComment) => {
    if (!activeCommentPost) return;
    const previousReacted = Boolean(comment.reactedByMe);
    const previousCount = Number(comment.reactionCount || 0);
    const nextReacted = !previousReacted;
    const nextCount = previousReacted ? Math.max(0, previousCount - 1) : previousCount + 1;

    setPostComments((prev) =>
      prev.map((root) => {
        if (root.id === comment.id) {
          return { ...root, reactedByMe: nextReacted, reactionCount: nextCount };
        }
        if (root.replies && root.replies.length > 0) {
          return {
            ...root,
            replies: root.replies.map((reply) =>
              reply.id === comment.id
                ? { ...reply, reactedByMe: nextReacted, reactionCount: nextCount }
                : reply
            ),
          };
        }
        return root;
      })
    );

    try {
      const res =
        activeCommentKind === 'file'
          ? await toggleFileCommentReaction(activeCommentPost.id, comment.id)
          : await toggleAssignmentCommentReaction(activeCommentPost.id, comment.id);
      setPostComments((prev) =>
        prev.map((root) => {
          if (root.id === comment.id) {
            return {
              ...root,
              reactedByMe: res.reacted,
              reactionCount: res.reactionCount ?? res.reaction_count,
            };
          }
          if (root.replies && root.replies.length > 0) {
            return {
              ...root,
              replies: root.replies.map((reply) =>
                reply.id === comment.id
                  ? {
                      ...reply,
                      reactedByMe: res.reacted,
                      reactionCount: res.reactionCount ?? res.reaction_count,
                    }
                  : reply
              ),
            };
          }
          return root;
        })
      );
    } catch {
      setPostComments((prev) =>
        prev.map((root) => {
          if (root.id === comment.id) {
            return { ...root, reactedByMe: previousReacted, reactionCount: previousCount };
          }
          if (root.replies && root.replies.length > 0) {
            return {
              ...root,
              replies: root.replies.map((reply) =>
                reply.id === comment.id
                  ? { ...reply, reactedByMe: previousReacted, reactionCount: previousCount }
                  : reply
              ),
            };
          }
          return root;
        })
      );
    }
  };

  const handleDeleteCommentModal = (comment: PostComment) => {
    if (!activeCommentPost) return;
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const removeCommentFromTree = (list: PostComment[], targetId: number): PostComment[] =>
              list
                .map((root) => {
                  if (root.id === targetId) return null;
                  if (root.replies && root.replies.length > 0) {
                    const updatedReplies = root.replies.filter((r) => r.id !== targetId);
                    return {
                      ...root,
                      replies: updatedReplies,
                      replyCount: updatedReplies.length,
                    };
                  }
                  return root;
                })
                .filter(Boolean) as PostComment[];

            if (activeCommentKind === 'file') {
              const res = await deleteFileComment(activeCommentPost.id, comment.id);
              setPostComments((prev) => removeCommentFromTree(prev, comment.id));
              const updatedCount = res.commentCount ?? Math.max(0, activeCommentPost.comment_count - 1);
              setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
              setFeedFiles((prev) =>
                prev.map((f) =>
                  Number(f.id) === Number(activeCommentPost.id) ? { ...f, commentCount: updatedCount } : f
                )
              );
              showToast('Comment deleted');
              return;
            }

            const res = await deleteAssignmentComment(activeCommentPost.id, comment.id);
            setPostComments((prev) => removeCommentFromTree(prev, comment.id));
            const updatedCount = res.commentCount ?? Math.max(0, activeCommentPost.comment_count - 1);
            setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
            setFeedAssignments((prev) =>
              prev.map((a) =>
                Number(a.id) === Number(activeCommentPost.id) ? { ...a, commentCount: updatedCount } : a
              )
            );
            showToast('Comment deleted');
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not delete comment.');
          }
        },
      },
    ]);
  };

  const handleToggleFileVote = async (fileId: number, direction: 'up' | 'down' = 'up') => {
    const numFileId = Number(fileId);
    const targetFile = feedFiles.find((f) => Number(f.id) === numFileId);
    if (!targetFile) return;

    const prevUp = Number(targetFile.upCount ?? targetFile.up_count ?? targetFile.likeCount ?? 0);
    const prevDown = Number(targetFile.downCount ?? targetFile.down_count ?? 0);
    const prevVote = Number(targetFile.myVote ?? targetFile.my_vote ?? (targetFile.liked ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    const applyFileVoteUpdate = (list: LibraryFile[], up: number, down: number, vote: number) =>
      list.map((f) =>
        Number(f.id) === numFileId
          ? {
              ...f,
              upCount: up,
              downCount: down,
              myVote: vote,
              up_count: up,
              down_count: down,
              my_vote: vote,
              liked: vote === 1,
              likeCount: up,
            }
          : f
      );

    setFeedFiles((prev) => applyFileVoteUpdate(prev, nextUp, nextDown, nextVote));
    queryClient.setQueryData(['library-posts-feed', user?.studentId, isTeacherUser], (old: any) =>
      old ? { ...old, files: applyFileVoteUpdate(old.files || [], nextUp, nextDown, nextVote) } : old
    );

    try {
      const result = await voteFile(numFileId, direction, {
        upCount: prevUp,
        downCount: prevDown,
        myVote: prevVote,
      });
      setFeedFiles((prev) => applyFileVoteUpdate(prev, result.upCount, result.downCount, result.myVote));
      queryClient.setQueryData(['library-posts-feed', user?.studentId, isTeacherUser], (old: any) =>
        old
          ? {
              ...old,
              files: applyFileVoteUpdate(old.files || [], result.upCount, result.downCount, result.myVote),
            }
          : old
      );
    } catch (err: any) {
      setFeedFiles((prev) => applyFileVoteUpdate(prev, prevUp, prevDown, prevVote));
      showToast(err?.message || 'Could not update vote.');
    }
  };

  const handleToggleAssignmentVote = async (assignmentId: number, direction: 'up' | 'down' = 'up') => {
    const numAssignmentId = Number(assignmentId);
    const target = feedAssignments.find((a) => Number(a.id) === numAssignmentId);
    if (!target) return;

    const prevUp = Number(target.upCount ?? target.likeCount ?? 0);
    const prevDown = Number(target.downCount ?? 0);
    const prevVote = Number(target.myVote ?? (target.liked ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    const applyAssignmentVoteUpdate = (list: FeedAssignment[], up: number, down: number, vote: number) =>
      list.map((a) =>
        Number(a.id) === numAssignmentId
          ? {
              ...a,
              upCount: up,
              downCount: down,
              myVote: vote,
              liked: vote === 1,
              likeCount: up,
            }
          : a
      );

    setFeedAssignments((prev) => applyAssignmentVoteUpdate(prev, nextUp, nextDown, nextVote));
    queryClient.setQueryData(['library-posts-feed', user?.studentId, isTeacherUser], (old: any) =>
      old
        ? {
            ...old,
            assignments: applyAssignmentVoteUpdate(old.assignments || [], nextUp, nextDown, nextVote),
          }
        : old
    );

    try {
      const result = await voteAssignment(numAssignmentId, direction, {
        upCount: prevUp,
        downCount: prevDown,
        myVote: prevVote,
      });
      setFeedAssignments((prev) =>
        applyAssignmentVoteUpdate(prev, result.upCount, result.downCount, result.myVote)
      );
      queryClient.setQueryData(['library-posts-feed', user?.studentId, isTeacherUser], (old: any) =>
        old
          ? {
              ...old,
              assignments: applyAssignmentVoteUpdate(
                old.assignments || [],
                result.upCount,
                result.downCount,
                result.myVote
              ),
            }
          : old
      );
    } catch (err: any) {
      setFeedAssignments((prev) => applyAssignmentVoteUpdate(prev, prevUp, prevDown, prevVote));
      showToast(err?.message || 'Could not update vote.');
    }
  };

  const handleShareFileItem = async (file: LibraryFile) => {
    try {
      const link = `${baseUrl || ''}/api/files/${file.id}/view`;
      await Clipboard.setStringAsync(link);
      showToast('Note link copied to clipboard');
    } catch {
      showToast('Could not copy link');
    }
  };

  // ─────────────────────────────────────────────────────────────
  // SECTION 2 DATA: SUBJECTS -> CHAPTERS -> STUDY MATERIALS
  // ─────────────────────────────────────────────────────────────
  const currentSemester: SemesterItem = useMemo(() => {
    if (!isStaff && params.fromSyllabus !== '1') {
      if (currentSemesterNumber && currentSemesterNumber >= 1 && currentSemesterNumber <= SEMESTERS.length) {
        return SEMESTERS[currentSemesterNumber - 1];
      }
      if (semesterRoman) {
        const match = SEMESTERS.find((s) => s.semester === semesterRoman || s.id === `Semester ${semesterRoman}`);
        if (match) return match;
      }
      return SEMESTERS[0];
    }
    return SEMESTERS.find((s) => s.id === selectedSemesterId) || SEMESTERS[0];
  }, [isStaff, params.fromSyllabus, currentSemesterNumber, semesterRoman, selectedSemesterId]);

  useEffect(() => {
    if (params.subject) {
      animateToSection('browse');
      const match = findSubjectAcrossSemesters(params.subject);
      if (match) {
        if (isStaff || params.fromSyllabus === '1') {
          setSelectedSemesterId(match.semester.id);
          setSelectedSubject(match.subject);
        } else {
          const belongsToCurrentSem = currentSemester.subjects.some(
            (s) =>
              s.title.toLowerCase() === match.subject.title.toLowerCase() ||
              s.code.toLowerCase() === match.subject.code.toLowerCase()
          );
          if (belongsToCurrentSem) {
            setSelectedSubject(match.subject);
          } else {
            setSelectedSubject(null);
          }
        }
        if (params.unit || params.chapter) {
          const unitNum = params.unit ? Number(params.unit) : NaN;
          const chapLower = (params.chapter || '').trim().toLowerCase();
          const ch = match.subject.chapters.find(
            (c) =>
              (!isNaN(unitNum) && c.unitNumber === unitNum) ||
              c.title.toLowerCase() === chapLower ||
              c.id.toLowerCase() === chapLower ||
              (c.shortTitle && c.shortTitle.toLowerCase() === chapLower)
          );
          setSelectedChapter(ch || null);
        } else {
          setSelectedChapter(null);
        }
      }
    } else if (params.semester && isStaff) {
      animateToSection('browse');
      const sem = SEMESTERS.find(
        (s) =>
          s.id.toLowerCase() === params.semester?.toLowerCase() ||
          s.semester.toLowerCase() === params.semester?.toLowerCase() ||
          s.shortLabel.toLowerCase() === params.semester?.toLowerCase()
      );
      if (sem) setSelectedSemesterId(sem.id);
    }
  }, [params.subject, params.semester, params.chapter, params.unit, params.fromSyllabus, isStaff, currentSemester, animateToSection]);

  const isNotesLevel = selectedSubject !== null && selectedChapter !== null;
  const chapterFilterParam = selectedChapter?.id === 'ALL' ? undefined : selectedChapter?.id;

  const {
    data: files = [],
    isLoading: loadingFiles,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery<LibraryFile[]>({
    queryKey: [
      'library',
      'files',
      isStaff ? selectedSemesterId : cohort?.id || 'my-cohort',
      selectedSubject?.title,
      selectedChapter?.id,
    ],
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
    staleTime: 5 * 60 * 1000,
  });

  const { data: libraryStats = [], refetch: refetchStats } = useQuery<LibraryStat[]>({
    queryKey: ['library', 'stats'],
    queryFn: getLibraryStats,
    staleTime: 60 * 1000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeSection === 'feed') {
      await refetchLibraryFeed();
    } else {
      await refetchAcademicContext();
      await refetchStats();
      if (isNotesLevel) {
        await refetchFiles();
      }
    }
    setRefreshing(false);
  };

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

  const chapters = selectedSubject?.chapters || [];

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

  const renderBrandHeader = () => (
    <View
      style={[
        styles.fixedBrandHeader,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[styles.headerWordmark, { color: colors.text }]}>
          Semester Library
        </Text>
      </View>

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

        {!isStaff && (
          <TouchableOpacity
            onPress={() => router.push('/attendance' as any)}
            style={[
              styles.headerActionBtn,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="View my attendance"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="checkbox-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        {isStaff && (
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
        )}

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

  // Borderless, Clean Animated 2-Section Switcher (No outer box border, no count number)
  const renderSectionSwitcher = () => {
    const isFeedActive = activeSection === 'feed';
    const isBrowseActive = activeSection === 'browse';
    const tabWidth = switcherTrackWidth / 2;
    const indicatorTranslateX = slideAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, tabWidth],
    });

    return (
      <View
        onLayout={(e) => setSwitcherTrackWidth(e.nativeEvent.layout.width)}
        style={[
          styles.sectionSwitcherBar,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => animateToSection('feed')}
          accessibilityRole="tab"
          accessibilityState={{ selected: isFeedActive }}
          style={styles.sectionSwitcherTab}
        >
          <Ionicons
            name={isFeedActive ? 'documents' : 'documents-outline'}
            size={15}
            color={isFeedActive ? colors.text : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text
            variant="xs"
            weight={isFeedActive ? '700' : '600'}
            style={{
              color: isFeedActive ? colors.text : colors.textMuted,
              fontSize: 13.5,
            }}
            numberOfLines={1}
          >
            Notes & Assignments
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => animateToSection('browse')}
          accessibilityRole="tab"
          accessibilityState={{ selected: isBrowseActive }}
          style={styles.sectionSwitcherTab}
        >
          <Ionicons
            name={isBrowseActive ? 'library' : 'library-outline'}
            size={15}
            color={isBrowseActive ? colors.text : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text
            variant="xs"
            weight={isBrowseActive ? '700' : '600'}
            style={{
              color: isBrowseActive ? colors.text : colors.textMuted,
              fontSize: 13.5,
            }}
            numberOfLines={1}
          >
            {isTeacherRole ? 'My Materials' : 'Subjects & Library'}
          </Text>
        </TouchableOpacity>

        {tabWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sectionUnderlineIndicator,
              {
                width: tabWidth,
                backgroundColor: colors.text,
                transform: [{ translateX: indicatorTranslateX }],
              },
            ]}
          />
        )}
      </View>
    );
  };

  // Render Note Post Item (No outer box border, no teacher/role tag, small subject/chapter tags, no semester tag)
  const renderFeedFileCard = (file: LibraryFile) => {
    const ext = getFileType(file.originalName);

    return (
      <View
        style={[
          styles.feedPostItem,
          {
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
        >
          {/* Author / Uploader Row (without Teacher/Role tag) */}
          <View style={styles.postAuthorRow}>
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
              style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            >
              <Avatar
                url={getFullImageUrl(file.uploaderAvatar || null) || file.uploaderAvatar}
                name={file.uploaderName}
                size="md"
              />
              <View style={{ flex: 1, marginLeft: spacing.compact }}>
                <Text variant="sm" weight="700" numberOfLines={1}>
                  {file.uploaderName || 'Student'}
                </Text>
                <Caption color="muted">
                  Uploaded {formatTimeAgo(file.uploadedAt)}
                </Caption>
              </View>
            </TouchableOpacity>

            {/* Type Badge: NOTE */}
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="document-text-outline" size={11} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text
                variant="xs"
                weight="700"
                style={{ color: colors.textSecondary, fontSize: 10, letterSpacing: 0.3 }}
              >
                NOTE
              </Text>
            </View>
          </View>

          {/* Post Title & Small Subject/Chapter tags */}
          <View style={{ marginTop: 10, marginBottom: 6 }}>
            {file.title && file.title !== file.originalName ? (
              <Text weight="700" style={{ fontSize: 15, marginBottom: 5, lineHeight: 20 }}>
                {file.title}
              </Text>
            ) : null}

            {(file.subject || file.chapter) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                {file.subject ? (
                  <View
                    style={[
                      styles.smallMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="book-outline" size={10} color={colors.textMuted} style={{ marginRight: 3 }} />
                    <Text style={[styles.smallMetaTagText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {file.subject}
                    </Text>
                  </View>
                ) : null}
                {file.chapter ? (
                  <View
                    style={[
                      styles.smallMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.smallMetaTagText, { color: colors.textMuted }]} numberOfLines={1}>
                      {file.chapter}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* File Attachment Box */}
          <View
            style={[
              styles.feedFileAttachmentBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.feedFileTypeBadge}>
              <Text variant="xs" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                {ext.toUpperCase()}
              </Text>
            </View>

            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text variant="sm" weight="600" numberOfLines={1}>
                {file.originalName}
              </Text>
              <Caption color="muted" numberOfLines={1}>
                {formatFileSize(file.sizeBytes)} • Tap to preview note
              </Caption>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        {/* File Engagement Actions */}
        <View style={styles.postActionRow}>
          <VoteButtons
            upCount={Number(file.upCount ?? file.up_count ?? file.likeCount ?? 0)}
            downCount={Number(file.downCount ?? file.down_count ?? 0)}
            myVote={Number(file.myVote ?? file.my_vote ?? (file.liked ? 1 : 0))}
            colors={colors}
            onVote={(dir) => void handleToggleFileVote(file.id, dir)}
          />

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => void handleOpenFileComments(file)}
            accessibilityLabel="View comments on note"
          >
            <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {Number(file.commentCount || 0)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => void handleShareFileItem(file)}
            accessibilityLabel="Share note link"
          >
            <Ionicons name="share-outline" size={17} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {Number(file.commentCount || 0) > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => void handleOpenFileComments(file)}
            style={{
              marginTop: spacing.compact,
              paddingTop: spacing.tight,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.borderSubtle,
            }}
          >
            <Text variant="xs" color="muted">
              View all {file.commentCount} {Number(file.commentCount) === 1 ? 'comment' : 'comments'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Render Assignment Post Item (No outer box border, no TEACHER tag, small subject tag, no boilerplate description)
  const renderFeedAssignmentCard = (a: FeedAssignment) => {
    const badgeExt = a.pdfUrl ? 'PDF' : a.language ? a.language.toUpperCase() : 'LAB';
    const uploaderAvatarUrl =
      getFullImageUrl(a.avatarUrl || a.teacherAvatar || (a as any).avatar_url || null) || a.avatarUrl;
    const openAssignment = () => {
      router.push(`/assignments/${a.id}` as any);
    };

    const showDescription = !isBoilerplatePdfDescription(a.description);

    return (
      <View
        style={[
          styles.feedPostItem,
          {
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity activeOpacity={0.75} onPress={openAssignment}>
          {/* Author / Uploader Row (without TEACHER tag) */}
          <View style={styles.postAuthorRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={(e) => {
                e.stopPropagation();
                if (a.createdBy) {
                  router.push({
                    pathname: '/user/[id]',
                    params: { id: a.createdBy },
                  });
                }
              }}
              style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            >
              <Avatar
                url={uploaderAvatarUrl}
                name={a.teacherName || 'Faculty Member'}
                size="md"
              />
              <View style={{ flex: 1, marginLeft: spacing.compact }}>
                <Text variant="sm" weight="700" numberOfLines={1}>
                  {a.teacherName || 'Faculty Member'}
                </Text>
                <Caption color="muted">
                  Posted {formatTimeAgo(a.createdAt)}
                </Caption>
              </View>
            </TouchableOpacity>

            {/* Type Badge: ASSIGNMENT */}
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="code-slash-outline" size={11} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text
                variant="xs"
                weight="700"
                style={{ color: colors.textSecondary, fontSize: 10, letterSpacing: 0.3 }}
              >
                ASSIGNMENT
              </Text>
            </View>
          </View>

          {/* Assignment Title, non-boilerplate Description & Small Subject/Deadline tags */}
          <View style={{ marginTop: 10, marginBottom: 6 }}>
            {a.title ? (
              <Text weight="700" style={{ fontSize: 15, marginBottom: 5, lineHeight: 20 }}>
                {a.title}
              </Text>
            ) : null}

            {showDescription ? (
              <Text variant="sm" color="secondary" numberOfLines={2} style={{ marginBottom: 5, lineHeight: 19 }}>
                {a.description}
              </Text>
            ) : null}

            {(a.subject || a.deadline) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                {a.subject ? (
                  <View
                    style={[
                      styles.smallMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="book-outline" size={10} color={colors.textMuted} style={{ marginRight: 3 }} />
                    <Text style={[styles.smallMetaTagText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {a.subject}
                    </Text>
                  </View>
                ) : null}
                {a.deadline ? (
                  <View
                    style={[
                      styles.smallMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="time-outline" size={10} color={colors.textMuted} style={{ marginRight: 3 }} />
                    <Text style={[styles.smallMetaTagText, { color: colors.textMuted }]} numberOfLines={1}>
                      Due {new Date(a.deadline).toLocaleDateString()}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Assignment Attachment Box */}
          <View
            style={[
              styles.feedFileAttachmentBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.feedFileTypeBadge}>
              <Text variant="xs" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                {badgeExt}
              </Text>
            </View>

            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text variant="sm" weight="600" numberOfLines={1}>
                {a.pdfName || a.title}
              </Text>
              <Caption color="muted" numberOfLines={1}>
                {a.pdfUrl
                  ? 'Tap to view PDF'
                  : typeof a.questionCount === 'number' && a.questionCount > 0
                  ? `${a.questionCount} ${a.questionCount === 1 ? 'Question' : 'Questions'} • Tap to view`
                  : 'Tap to view assignment'}
              </Caption>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        {/* Assignment Engagement Actions */}
        <View style={styles.postActionRow}>
          <VoteButtons
            upCount={Number(a.upCount ?? a.likeCount ?? 0)}
            downCount={Number(a.downCount ?? 0)}
            myVote={Number(a.myVote ?? (a.liked ? 1 : 0))}
            colors={colors}
            onVote={(dir) => void handleToggleAssignmentVote(a.id, dir)}
          />

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => void handleOpenAssignmentComments(a)}
            accessibilityLabel="View comments on assignment"
          >
            <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {Number(a.commentCount || 0)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={openAssignment}
            accessibilityLabel="View assignment details"
          >
            <Ionicons name="document-text-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {Number(a.submissionCount || 0)} submitted
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              const link = `${baseUrl}/code-lab/assignment.html?id=${a.id}`;
              void Clipboard.setStringAsync(link).then(() => showToast('Assignment link copied!'));
            }}
            accessibilityLabel="Share assignment link"
          >
            <Ionicons name="share-outline" size={17} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {Number(a.commentCount || 0) > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => void handleOpenAssignmentComments(a)}
            style={{
              marginTop: spacing.compact,
              paddingTop: spacing.tight,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.borderSubtle,
            }}
          >
            <Text variant="xs" color="muted">
              View all {a.commentCount} {Number(a.commentCount) === 1 ? 'comment' : 'comments'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const pagerTranslateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenWidth],
  });

  return (
    <TabSwipeContainer tabIndex={1} disabled={Boolean(searchOpen || uploadModalOpen || commentsModalOpen)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        {/* Pinned Brand Header */}
        {renderBrandHeader()}

        {/* Borderless Animated 2-Section Switcher Bar */}
        {renderSectionSwitcher()}

        {/* Slidable 2-Page Horizontal Track */}
        <View style={{ flex: 1, overflow: 'hidden' }} {...pagerPanResponder.panHandlers}>
          <Animated.View
            style={{
              flex: 1,
              flexDirection: 'row',
              width: screenWidth * 2,
              transform: [{ translateX: pagerTranslateX }],
            }}
          >
            {/* ═════════════════════════════════════════════════════════════
                PAGE 1: NOTES & ASSIGNMENT POSTS FEED
                ═════════════════════════════════════════════════════════════ */}
            <View style={{ width: screenWidth, flex: 1 }}>
              <FlatList
                data={combinedFeedItems}
                keyExtractor={(item) =>
                  item.feedType === 'file' ? `lib-file-${item.file.id}` : `lib-assign-${item.assignment.id}`
                }
                renderItem={({ item }) =>
                  item.feedType === 'file'
                    ? renderFeedFileCard(item.file)
                    : renderFeedAssignmentCard(item.assignment)
                }
                ListEmptyComponent={
                  isLibraryFeedLoading && !libraryFeedData ? (
                    <View>
                      <FeedPostSkeletonCard colors={colors} />
                      <FeedPostSkeletonCard colors={colors} />
                      <FeedPostSkeletonCard colors={colors} />
                    </View>
                  ) : libraryFeedError ? (
                    <Card variant="elevated" padding="lg" style={[styles.centerCard, { margin: spacing.md }]}>
                      <Ionicons name="cloud-offline-outline" size={40} color={colors.error} style={{ marginBottom: spacing.sm }} />
                      <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
                        Unable to Load Posts
                      </Heading>
                      <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
                        Could not fetch notes and assignment posts right now.
                      </Text>
                      <Button
                        title="Retry"
                        variant="primary"
                        size="sm"
                        onPress={() => void refetchLibraryFeed()}
                      />
                    </Card>
                  ) : (
                    <EmptyState
                      icon="documents-outline"
                      title="No Notes or Assignments Yet"
                      description="New study notes and assignment posts shared with your cohort will appear here."
                      actionTitle={isStaff ? 'Upload Note' : undefined}
                      onAction={isStaff ? () => setUploadModalOpen(true) : undefined}
                    />
                  )
                }
                onScroll={handleNavScroll}
                scrollEventThrottle={scrollEventThrottle}
                contentContainerStyle={[
                  styles.container,
                  {
                    paddingBottom: 130,
                  },
                ]}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor={colors.primary}
                    colors={[colors.primary]}
                  />
                }
              />
            </View>

            {/* ═════════════════════════════════════════════════════════════
                PAGE 2: CURRENT LIBRARY VIEW (Subjects & Chapters / Teacher Materials)
                ═════════════════════════════════════════════════════════════ */}
            <View style={{ width: screenWidth, flex: 1 }}>
              {isTeacherRole ? (
                <View style={{ flex: 1 }}>
                  <TeacherMaterialsView />
                </View>
              ) : selectedSubject && selectedChapter ? (
                /* LEVEL 3: NOTES / FILES VIEW (When Chapter is Selected) */
                <ScrollView
                  contentContainerStyle={[styles.container, { padding: spacing.md, paddingBottom: 120 }]}
                  onScroll={handleNavScroll}
                  scrollEventThrottle={scrollEventThrottle}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={handleRefresh}
                      tintColor={colors.primary}
                      colors={[colors.primary]}
                    />
                  }
                >
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

                  <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
                    <Subheading>Study Materials</Subheading>
                    {!loadingFiles && (
                      <Caption color="muted">
                        {files.length} {files.length === 1 ? 'file' : 'files'}
                      </Caption>
                    )}
                  </View>

                  {loadingFiles && !refreshing && (
                    <View>
                      <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
                      <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
                      <SkeletonCard colors={colors} radii={radii} spacing={spacing} />
                    </View>
                  )}

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

                  {!loadingFiles && !filesError && files.length === 0 && (
                    <EmptyState
                      icon="folder-open-outline"
                      title="No Notes Yet"
                      description={`No study materials have been uploaded for ${selectedChapter.title} yet.`}
                      actionTitle={isStaff ? 'Upload Note' : undefined}
                      onAction={isStaff ? () => setUploadModalOpen(true) : undefined}
                    />
                  )}

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
              ) : selectedSubject && !selectedChapter ? (
                /* LEVEL 2: CHAPTERS VIEW (When Subject is Selected) */
                <ScrollView
                  contentContainerStyle={[styles.container, { padding: spacing.md, paddingBottom: 120 }]}
                  onScroll={handleNavScroll}
                  scrollEventThrottle={scrollEventThrottle}
                >
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

                  <Card
                    variant="elevated"
                    padding="lg"
                    style={[styles.subjectBannerCard, { marginBottom: spacing.md, borderColor: colors.border }]}
                  >
                    <View style={styles.subjectBannerTop}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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

                      {selectedSubject.code !== 'CUSTOM' && (
                        <TouchableOpacity
                          activeOpacity={0.75}
                          onPress={() =>
                            router.push({
                              pathname: '/syllabus',
                              params: {
                                course: selectedSubject.code || selectedSubject.title,
                                semester: currentSemester.semester,
                                fromLibrary: '1',
                              },
                            } as any)
                          }
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.borderStrong,
                            borderWidth: 1,
                            borderRadius: radii.sm,
                            paddingHorizontal: 9,
                            paddingVertical: 4,
                          }}
                        >
                          <Ionicons name="book-outline" size={12} color={colors.text} style={{ marginRight: 4 }} />
                          <Text variant="xs" weight="700" style={{ color: colors.text, fontSize: 11 }}>
                            View Syllabus
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <Heading style={{ fontSize: 20, lineHeight: 26, marginVertical: spacing.xs }}>
                      {selectedSubject.title}
                    </Heading>

                    <Caption color="secondary">
                      {currentSemester.year} • {currentSemester.label} • {selectedSubject.chapters.length} Units & Categories
                    </Caption>
                  </Card>

                  <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
                    <Subheading>Syllabus Units & Chapters</Subheading>
                    <Caption color="muted">{chapters.length} Chapters</Caption>
                  </View>

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
              ) : (
                /* LEVEL 1: SUBJECTS VIEW */
                <ScrollView
                  contentContainerStyle={[styles.container, { padding: spacing.md, paddingBottom: 120 }]}
                  onScroll={handleNavScroll}
                  scrollEventThrottle={scrollEventThrottle}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={handleRefresh}
                      tintColor={colors.primary}
                      colors={[colors.primary]}
                    />
                  }
                >
                  {isUnassigned && (
                    <Card variant="elevated" padding="lg" style={[styles.centerCard, { marginBottom: spacing.md }]}>
                      <Ionicons name="school-outline" size={40} color={colors.textSecondary} style={{ marginBottom: spacing.sm }} />
                      <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>Class Not Assigned</Heading>
                      <Text variant="sm" color="secondary" style={{ textAlign: 'center' }}>
                        Your class has not been assigned yet. Course materials for your cohort will appear once assigned by faculty.
                      </Text>
                    </Card>
                  )}

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

                  <View style={[styles.sectionRow, { marginBottom: spacing.sm }]}>
                    <View>
                      <Subheading>Subjects & Curriculum</Subheading>
                      {isStaff && Boolean(displayLabel) && (
                        <Caption color="muted">{displayLabel}</Caption>
                      )}
                    </View>
                    {isStaff && <Caption color="muted">{subjects.length} Available</Caption>}
                  </View>

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

                          <Text variant="md" weight="700" color="primary" style={{ marginVertical: spacing.xs }}>
                            {subject.title}
                          </Text>

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
            </View>
          </Animated.View>
        </View>

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
          initialSemesterId={isStaff ? selectedSemesterId : semesterRoman || currentSemester.id}
          initialSubjectTitle={selectedSubject?.title}
          initialChapterTitle={selectedChapter?.title}
          onSuccess={(msg) => {
            queryClient.invalidateQueries({ queryKey: ['library'] });
            queryClient.invalidateQueries({ queryKey: ['library-posts-feed'] });
            void refetchLibraryFeed();
            if (isNotesLevel) {
              void refetchFiles();
            }
            showToast(msg || '🎉 Note uploaded successfully!');
          }}
        />

        {/* Comments Bottom Sheet Modal for Notes & Assignment Posts */}
        <CommentsBottomSheetModal
          visible={commentsModalOpen}
          onClose={() => {
            setCommentsModalOpen(false);
            setActiveCommentPost(null);
            setCommentReplyingTo(null);
            setCommentEditing(null);
          }}
          comments={postComments}
          loading={loadingComments}
          posting={postingComment}
          commentInput={commentInput}
          onChangeCommentInput={setCommentInput}
          onSubmitComment={handleSubmitComment}
          commentInputRef={commentInputRef}
          replyingTo={commentReplyingTo}
          editingComment={commentEditing}
          onCancelInputMode={handleCancelCommentInputMode}
          onReply={handleReplyPressModal}
          onEdit={handleEditPressModal}
          onDelete={handleDeleteCommentModal}
          onToggleReaction={handleToggleCommentReactionModal}
          getFullUrl={getFullImageUrl}
          currentUserId={user?.studentId || null}
          currentUserName={user?.name || null}
          currentUserAvatar={user?.avatarUrl || null}
          isAdmin={user?.role === 'admin'}
          onNavigateProfile={(sid) => {
            router.push({ pathname: '/user/[id]', params: { id: sid } });
          }}
        />

        {/* Toast Notification */}
        {toastMessage && (
          <Animated.View
            style={[
              styles.toastContainer,
              {
                opacity: toastOpacity,
                bottom: user?.isAdmin || user?.role === 'admin' ? 116 : 86,
                backgroundColor: '#18181B',
                borderColor: 'rgba(255, 255, 255, 0.16)',
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="checkmark-circle" size={18} color="#22C55E" style={{ marginRight: 8 }} />
            <Text variant="sm" weight="600" style={{ color: '#FAFAFA' }}>
              {toastMessage}
            </Text>
          </Animated.View>
        )}
      </SafeAreaView>
    </TabSwipeContainer>
  );
}

export default function LibraryScreen() {
  const { user } = useAuth();
  const { isInAdminMode } = useAdminMode();
  const appRole = resolveAppRole(user);
  const isTeacher = user?.role === 'teacher' || user?.role === 'faculty';

  if (isInAdminMode) {
    return (
      <TabSwipeContainer tabIndex={1}>
        <AdminUsersView />
      </TabSwipeContainer>
    );
  }

  if (appRole === 'unknown') {
    return <UnrecognizedRoleView />;
  }

  return <StudentLibraryView isTeacherRole={isTeacher} />;
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
  sectionSwitcherBar: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionSwitcherTab: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sectionUnderlineIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2.5,
    borderRadius: 2,
  },
  feedPostItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  postAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  feedFileAttachmentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  feedFileTypeBadge: {
    width: 44,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  smallMetaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 5,
  },
  smallMetaTagText: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
  },
  postActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  toastContainer: {
    position: 'absolute',
    bottom: 92,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 24,
    zIndex: 99999,
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
