import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Platform,
  ScrollView,
  Switch,
  Animated,
  PanResponder,
  Linking,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { useAdaptiveNavScroll } from '@/context/NavScrollContext';
import { fetchUnseenCount } from '@/services/notifications';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { formatTimeAgo } from '@/utils/date';
import {
  getPosts,
  getFeedFiles,
  toggleLike,
  toggleFileLike,
  createPost,
  deletePost,
  getComments,
  addComment,
  editComment,
  deleteComment,
  toggleCommentReaction,
  Post,
  PostComment,
  LibraryFile,
  MAX_ATTACHMENT_BYTES_PER_FILE,
  MAX_POST_ATTACHMENT_BYTES,
  formatAttachmentBytes,
  uploadPostAttachment,
  deletePostAttachment,
  UploadedAttachment,
} from '@/services/posts';
import { apiFetch, getBaseUrl, getAutoDetectedServerUrl, DEFAULT_SERVER_URL } from '@/services/api';
import { SearchOverlay } from '@/components/SearchOverlay';
import { UploadNoteModal } from '@/components/UploadNoteModal';
import { PostMediaGallery } from '@/components/PostMediaGallery';
import { EditPostModal } from '@/components/EditPostModal';
import { PostFileAttachments } from '@/components/PostFileAttachments';
import { CommentItem } from '@/components/CommentItem';
import { PostCard } from '@/components/PostCard';
import { RawFileAsset } from '@/utils/file-upload';
import * as DocumentPicker from 'expo-document-picker';

function FeedSkeletonCard({ colors, radii }: { colors: any; radii: any }) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceRaised,
        borderRadius: radii.lg,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: colors.surfaceSubtle,
            marginRight: 10,
          }}
        />
        <View style={{ flex: 1 }}>
          <View
            style={{
              width: 120,
              height: 14,
              borderRadius: 4,
              backgroundColor: colors.surfaceSubtle,
              marginBottom: 6,
            }}
          />
          <View
            style={{
              width: 70,
              height: 10,
              borderRadius: 3,
              backgroundColor: colors.surfaceSubtle,
            }}
          />
        </View>
      </View>
      <View
        style={{
          width: '90%',
          height: 12,
          borderRadius: 3,
          backgroundColor: colors.surfaceSubtle,
          marginBottom: 8,
        }}
      />
      <View
        style={{
          width: '75%',
          height: 12,
          borderRadius: 3,
          backgroundColor: colors.surfaceSubtle,
          marginBottom: 8,
        }}
      />
      <View
        style={{
          width: '50%',
          height: 12,
          borderRadius: 3,
          backgroundColor: colors.surfaceSubtle,
          marginBottom: 14,
        }}
      />
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: 10,
        }}
      >
        <View style={{ width: 50, height: 16, borderRadius: 4, backgroundColor: colors.surfaceSubtle }} />
        <View style={{ width: 50, height: 16, borderRadius: 4, backgroundColor: colors.surfaceSubtle }} />
        <View style={{ width: 50, height: 16, borderRadius: 4, backgroundColor: colors.surfaceSubtle }} />
      </View>
    </View>
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

type FeedAssignment = { id: number; title: string; description?: string; teacherName?: string; subject?: string; createdAt: string; deadline?: string };

export type FeedItem =
  | { feedType: 'assignment'; assignment: FeedAssignment; time: number }
  | { feedType: 'post'; post: Post; time: number }
  | { feedType: 'file'; file: LibraryFile; time: number };

function formatRelativeTime(dateString: unknown): string {
  return formatTimeAgo(dateString);
}

function formatLastUpdated(date: Date | string | null): string {
  if (!date) return '';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    return `${diffHour}h ago`;
  } catch {
    return '';
  }
}

// Only show badges for Notice or Assignment types; omit for regular status/discussion
function getTypeBadgeProps(type: string, isOfficial: boolean | undefined, colors: any) {
  if (type === 'notice' || isOfficial) {
    return {
      label: isOfficial ? 'OFFICIAL NOTICE' : 'NOTICE',
      textColor: colors.text,
      bgColor: colors.surfaceRaised,
      borderColor: colors.borderStrong,
      icon: 'megaphone-outline' as const,
    };
  }
  if (type === 'assignment') {
    return {
      label: 'ASSIGNMENT',
      textColor: colors.textSecondary,
      bgColor: colors.surfaceSubtle,
      borderColor: colors.border,
      icon: 'clipboard-outline' as const,
    };
  }
  return null;
}

// Animated Like Button with scale pop bounce and red state
function LikeButton({
  liked,
  count,
  colors,
  onPress,
}: {
  liked: boolean;
  count: number;
  colors: any;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (!liked) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.45,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.0,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.85,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.0,
          duration: 80,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.actionButton}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={18}
          color={liked ? '#EF4444' : colors.textMuted}
        />
      </Animated.View>
      <Text
        variant="xs"
        weight="600"
        style={{
          marginLeft: 5,
          color: liked ? '#EF4444' : colors.textSecondary,
        }}
      >
        {count}
      </Text>
    </TouchableOpacity>
  );
}

// Post Image with Instagram-style pinch-to-zoom and double-tap to like (single tap does nothing, no full-screen jump)
function PostImageItem({
  imageUrl,
  colors,
  radii,
  onDoubleTap,
  onZoomChange,
}: {
  imageUrl: string;
  colors: any;
  radii: any;
  onDoubleTap: () => void;
  onZoomChange?: (zooming: boolean) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [isZooming, setIsZooming] = useState<boolean>(false);

  // Animated values for pinch zoom & pan
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Gesture tracking refs
  const initialDistance = useRef<number>(0);
  const initialMidpoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPinching = useRef<boolean>(false);
  const lastTapRef = useRef<number>(0);

  // Heart burst animation refs
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;

  const triggerHeartBurst = () => {
    heartScale.setValue(0);
    heartOpacity.setValue(1);

    Animated.sequence([
      Animated.spring(heartScale, {
        toValue: 1.25,
        friction: 4,
        tension: 110,
        useNativeDriver: true,
      }),
      Animated.timing(heartOpacity, {
        toValue: 0,
        duration: 320,
        delay: 180,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const resetZoom = () => {
    isPinching.current = false;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsZooming(false);
      onZoomChange?.(false);
      initialDistance.current = 0;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          isPinching.current = true;
          setIsZooming(true);
          onZoomChange?.(true);

          const [t1, t2] = touches;
          const dx = t1.pageX - t2.pageX;
          const dy = t1.pageY - t2.pageY;
          initialDistance.current = Math.sqrt(dx * dx + dy * dy);
          initialMidpoint.current = {
            x: (t1.pageX + t2.pageX) / 2,
            y: (t1.pageY + t2.pageY) / 2,
          };
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && initialDistance.current > 0) {
          const [t1, t2] = touches;
          const dx = t1.pageX - t2.pageX;
          const dy = t1.pageY - t2.pageY;
          const currentDistance = Math.sqrt(dx * dx + dy * dy);

          const newScale = Math.max(1, Math.min(currentDistance / initialDistance.current, 4.5));
          scale.setValue(newScale);

          const midX = (t1.pageX + t2.pageX) / 2;
          const midY = (t1.pageY + t2.pageY) / 2;
          translateX.setValue(midX - initialMidpoint.current.x);
          translateY.setValue(midY - initialMidpoint.current.y);
        }
      },

      onPanResponderRelease: () => {
        if (isPinching.current) {
          resetZoom();
        }
      },

      onPanResponderTerminate: () => {
        if (isPinching.current) {
          resetZoom();
        }
      },
    })
  ).current;

  // Single tap explicitly does NOTHING (no jumping, no full-screen viewer)
  // Double tap triggers Instagram heart burst like
  const handleTouchEnd = (evt: any) => {
    if (isPinching.current) return;
    if (evt.nativeEvent.touches && evt.nativeEvent.touches.length > 0) return;

    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      lastTapRef.current = 0;
      triggerHeartBurst();
      onDoubleTap();
    } else {
      lastTapRef.current = now;
      // Single tap explicitly does nothing!
    }
  };

  return (
    <View
      {...panResponder.panHandlers}
      onTouchEnd={handleTouchEnd}
      style={[
        styles.imageContainer,
        {
          aspectRatio,
          borderRadius: radii.md,
          borderColor: colors.border,
          borderWidth: 1,
          backgroundColor: colors.surfaceRaised,
          marginTop: 10,
          overflow: isZooming ? 'visible' : 'hidden',
          zIndex: isZooming ? 9999 : 1,
          elevation: isZooming ? 30 : 0,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.postImage,
          {
            transform: [
              { scale },
              { translateX },
              { translateY },
            ],
          },
        ]}
      >
        <Image
          source={{ uri: imageUrl }}
          style={styles.postImage}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          onLoad={(e) => {
            const { width, height } = e.source;
            if (width > 0 && height > 0) {
              setAspectRatio(Math.max(width / height, 0.8));
            }
          }}
        />
      </Animated.View>

      {/* Instagram-style heart burst overlay */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.overlayHeartContainer,
          {
            opacity: heartOpacity,
            transform: [{ scale: heartScale }],
          },
        ]}
      >
        <Ionicons name="heart" size={84} color="#EF4444" style={styles.overlayHeartGlow} />
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const feedRef = useRef<FlatList<FeedItem>>(null);
  const { onScroll: handleNavScroll, scrollEventThrottle } = useAdaptiveNavScroll();
  const swipeStart = useRef({ x: 0, y: 0, time: 0, valid: false });
  const [assignments, setAssignments] = useState<FeedAssignment[]>([]);

  const [unseenNotifCount, setUnseenNotifCount] = useState(0);

  const refreshUnseenCount = useCallback(() => {
    if (!token) return;
    void (async () => {
      const count = await fetchUnseenCount();
      setUnseenNotifCount(count);
    })();
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      refreshUnseenCount();
    }, [refreshUnseenCount])
  );

  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(getAutoDetectedServerUrl());
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // Periodically refresh relative timestamp every 30 seconds while screen is mounted
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const lastUpdatedText = useMemo(() => {
    return formatLastUpdated(lastFetchedAt);
  }, [lastFetchedAt, nowTick]);

  // React Query: Feed caching with 45s staleTime
  const {
    data: feedData,
    isLoading: isFeedLoading,
    error: feedQueryError,
    refetch: refetchFeed,
  } = useQuery({
    queryKey: ['campus-feed', user?.studentId],
    queryFn: async () => {
      const [postsRes, filesRes, assignmentsRes] = await Promise.all([
        getPosts(null, 20),
        getFeedFiles(),
        apiFetch('/api/code-lab/assignments').then(async response => {
          if (!response.ok) throw new Error('Could not load assignments. Pull to refresh.');
          return response.json() as Promise<FeedAssignment[]>;
        }),
      ]);
      return {
        posts: postsRes.posts,
        files: filesRes,
        assignments: assignmentsRes,
        nextCursor: postsRes.nextCursor,
        fetchedAt: new Date(),
      };
    },
    staleTime: 45 * 1000,
  });

  // Sync state whenever fresh or cached feedData arrives
  useEffect(() => {
    if (feedData) {
      setPosts(feedData.posts);
      setFiles(feedData.files);
      setAssignments(feedData.assignments || []);
      setNextCursor(feedData.nextCursor);
      setLastFetchedAt(feedData.fetchedAt);
    }
  }, [feedData]);

  const loadingInitial = isFeedLoading && !feedData;
  const error = feedQueryError ? (feedQueryError as any).message || 'Error loading dashboard feed.' : null;

  // Merge posts and uploaded files into a unified chronological feed
  const feedItems = useMemo<FeedItem[]>(() => {
    const postItems: FeedItem[] = posts.map((p) => ({
      feedType: 'post',
      post: p,
      time: new Date(p.created_at).getTime() || 0,
    }));
    const fileItems: FeedItem[] = files.map((f) => ({
      feedType: 'file',
      file: f,
      time: new Date(f.uploadedAt || (f as any).createdAt || 0).getTime() || 0,
    }));
    const assignmentItems: FeedItem[] = assignments.map(assignment => ({ feedType: 'assignment', assignment, time: new Date(assignment.createdAt).getTime() || 0 }));
    return [...postItems, ...fileItems, ...assignmentItems].sort((a, b) => {
      if (b.time !== a.time) return b.time - a.time;
      const bId = b.feedType === 'post' ? b.post.id : b.feedType === 'file' ? b.file.id : b.assignment.id;
      const aId = a.feedType === 'post' ? a.post.id : a.feedType === 'file' ? a.file.id : a.assignment.id;
      return bId - aId;
    });
  }, [posts, files, assignments]);

  // Post Comments bottom-sheet state
  const [activeCommentPost, setActiveCommentPost] = useState<Post | null>(null);
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
  const commentInputRef = useRef<TextInput>(null);

  const handleOpenPostComments = async (post: Post) => {
    setActiveCommentPost(post);
    setCommentReplyingTo(null);
    setCommentEditing(null);
    setCommentInput('');
    setCommentsModalOpen(true);
    setLoadingComments(true);
    try {
      const data = await getComments(post.id);
      setPostComments(data || []);
    } catch {
      showToast('Could not load comments');
    } finally {
      setLoadingComments(false);
    }
  };

  // Push notification deep-link: open comment discussion for target post
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const handledNotificationPostId = useRef<string | null>(null);

  useEffect(() => {
    if (!postId || handledNotificationPostId.current === postId) return;
    const targetPost = posts.find((p) => String(p.id) === String(postId));
    if (targetPost) {
      handledNotificationPostId.current = postId;
      void handleOpenPostComments(targetPost);
    } else if (!loadingInitial && posts.length > 0) {
      handledNotificationPostId.current = postId;
      const fallbackPost: Post = {
        id: Number(postId),
        user_id: '',
        name: 'Post Discussion',
        content: '',
        type: 'status',
        attachment_url: null,
        created_at: new Date().toISOString(),
        role: 'student',
        avatarUrl: null,
        studentId: '',
        like_count: 0,
        comment_count: 0,
        submission_count: 0,
        liked_by_me: false,
      };
      void handleOpenPostComments(fallbackPost);
    }
  }, [postId, posts, loadingInitial]);

  const handleReplyPressModal = (comment: PostComment) => {
    setCommentEditing(null);
    setCommentReplyingTo({
      commentId: comment.id,
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

  const handleSubmitPostComment = async () => {
    if (!activeCommentPost || !commentInput.trim() || postingComment) return;
    const content = commentInput.trim();
    setPostingComment(true);
    try {
      if (commentEditing) {
        // Edit mode
        const res = await editComment(activeCommentPost.id, commentEditing.id, content);
        setPostComments((prev) =>
          prev.map((root) => {
            if (root.id === commentEditing.id) {
              return { ...root, ...res.comment };
            }
            if (root.replies && root.replies.length > 0) {
              return {
                ...root,
                replies: root.replies.map((reply) =>
                  reply.id === commentEditing.id ? { ...reply, ...res.comment } : reply
                ),
              };
            }
            return root;
          })
        );
        setCommentEditing(null);
        setCommentInput('');
        showToast('Comment updated');
      } else if (commentReplyingTo) {
        // Reply mode
        const res = await addComment(activeCommentPost.id, content, {
          parentCommentId: commentReplyingTo.commentId,
          replyToUserId: commentReplyingTo.studentId,
        });
        setCommentInput('');
        setCommentReplyingTo(null);
        if (res.comment) {
          const targetParentId = res.comment.parentCommentId;
          setPostComments((prev) =>
            prev.map((root) => {
              if (root.id === targetParentId) {
                const currentReplies = root.replies || [];
                return {
                  ...root,
                  replyCount: (root.replyCount || currentReplies.length) + 1,
                  replies: [...currentReplies, res.comment],
                };
              }
              return root;
            })
          );
        }
        const updatedCount = res.comment_count ?? (activeCommentPost.comment_count + 1);
        setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
        setPosts((prev) =>
          prev.map((p) => (p.id === activeCommentPost.id ? { ...p, comment_count: updatedCount } : p))
        );
        showToast('Reply posted');
      } else {
        // Root comment mode
        const res = await addComment(activeCommentPost.id, content);
        setCommentInput('');
        if (res.comment) {
          setPostComments((prev) => [...prev, res.comment]);
        }
        const updatedCount = res.comment_count ?? (activeCommentPost.comment_count + 1);
        setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
        setPosts((prev) =>
          prev.map((p) => (p.id === activeCommentPost.id ? { ...p, comment_count: updatedCount } : p))
        );
        showToast('Comment posted');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not post comment.');
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
      const res = await toggleCommentReaction(activeCommentPost.id, comment.id);
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

  const handleDeletePostComment = (comment: PostComment) => {
    if (!activeCommentPost) return;
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await deleteComment(activeCommentPost.id, comment.id);
            setPostComments((prev) =>
              prev
                .map((root) => {
                  if (root.id === comment.id) {
                    const hasReplies = (root.replies || []).length > 0;
                    if (hasReplies) {
                      return {
                        ...root,
                        isDeleted: true,
                        content: '[Comment deleted]',
                        canDelete: false,
                        canEdit: false,
                      };
                    }
                    return null;
                  }
                  if (root.replies && root.replies.length > 0) {
                    const updatedReplies = root.replies.filter((r) => r.id !== comment.id);
                    return {
                      ...root,
                      replies: updatedReplies,
                      replyCount: updatedReplies.length,
                    };
                  }
                  return root;
                })
                .filter(Boolean) as PostComment[]
            );
            const updatedCount = res.comment_count ?? Math.max(0, activeCommentPost.comment_count - 1);
            setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
            setPosts((prev) =>
              prev.map((p) => (p.id === activeCommentPost.id ? { ...p, comment_count: updatedCount } : p))
            );
            showToast('Comment deleted');
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not delete comment.');
          }
        },
      },
    ]);
  };

  const handleSharePost = async (post: Post) => {
    try {
      const textToShare = `${post.name} posted: "${post.content}"\n\nShared via Semester Library`;
      await Clipboard.setStringAsync(textToShare);
      showToast('Post copied to clipboard');
    } catch {
      showToast('Could not copy post');
    }
  };

  const handleShareFileItem = async (file: LibraryFile) => {
    try {
      const link = `${baseUrl || ''}/api/files/${file.id}/view`;
      await Clipboard.setStringAsync(link);
      showToast('File link copied to clipboard');
    } catch {
      showToast('Could not copy link');
    }
  };

  // Search Overlay state
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Create Post Composer states
  const [composerOpen, setComposerOpen] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postType, setPostType] = useState<'status' | 'notice' | 'assignment'>('status');
  const [isOfficialNotice, setIsOfficialNotice] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<{
    id: string;
    uri: string;
    name: string;
    size?: number;
    type?: string;
    mediaType: 'image' | 'file';
    status: 'idle' | 'uploading' | 'uploaded' | 'error';
    progress: number;
    uploaded?: UploadedAttachment;
    error?: string;
  }[]>([]);
  const composerImages = useMemo(() => composerAttachments.filter((a) => a.mediaType === 'image'), [composerAttachments]);
  const composerFiles = useMemo(() => composerAttachments.filter((a) => a.mediaType === 'file'), [composerAttachments]);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Track which post image is currently being pinched/zoomed
  const [zoomingPostId, setZoomingPostId] = useState<number | null>(null);


  // Post options menu & Toast states
  const [selectedMenuPost, setSelectedMenuPost] = useState<Post | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null);
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
        toastTimerRef.current = null;
      });
    }, 2000);
  }, [toastOpacity]);

  // Expanded post IDs for inline "See more" / "See less" text truncation
  const [expandedPostIds, setExpandedPostIds] = useState<Set<number>>(new Set());

  const toggleExpandPost = (postId: number) => {
    setExpandedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const isPrivileged = ['admin', 'cr', 'teacher'].includes((user?.role || '').toLowerCase());

  useEffect(() => {
    getBaseUrl().then(setBaseUrl);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetchFeed();
    setRefreshing(false);
  };

  const refreshFromTop = useCallback(() => {
    feedRef.current?.scrollToOffset({ offset: 0, animated: true });
    void refetchFeed();
  }, [refetchFeed]);

  useEffect(() => {
    return navigation.addListener('tabPress' as any, refreshFromTop);
  }, [navigation, refreshFromTop]);

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);

    try {
      const res = await getPosts(nextCursor, 20);
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newPosts = res.posts.filter((p) => !existingIds.has(p.id));
        const updated = [...prev, ...newPosts];
        queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
          old ? { ...old, posts: updated, nextCursor: res.nextCursor } : old
        );
        return updated;
      });
      setNextCursor(res.nextCursor);
      setLastFetchedAt(new Date());
    } catch (err: any) {
      console.warn('Failed loading more posts:', err.message);
    } finally {
      setLoadingMore(false);
    }
  };
  const handleToggleLike = async (postId: number) => {
    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    const previousLiked = targetPost.liked_by_me;
    const previousCount = targetPost.like_count;
    const newLiked = !previousLiked;
    const newCount = newLiked ? previousCount + 1 : Math.max(0, previousCount - 1);

    // Optimistic UI update
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              liked_by_me: newLiked,
              like_count: newCount,
            }
          : p
      )
    );

    try {
      const result = await toggleLike(postId, previousLiked);
      const finalLiked = result.liked_by_me ?? result.liked;
      const finalCount = result.like_count ?? result.likeCount;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: finalLiked,
                like_count: finalCount,
              }
            : p
        )
      );
      queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
        old
          ? {
              ...old,
              posts: old.posts.map((p: Post) =>
                p.id === postId
                  ? {
                      ...p,
                      liked_by_me: finalLiked,
                      like_count: finalCount,
                    }
                  : p
              ),
            }
          : old
      );
    } catch (err: any) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: previousLiked,
                like_count: previousCount,
              }
            : p
        )
      );
      Alert.alert('Action Failed', err.message || 'Could not update like status.');
    }
  };

  const handleToggleFileLike = async (fileId: number) => {
    const targetFile = files.find((f) => f.id === fileId);
    if (!targetFile) return;

    const previousLiked = Boolean(targetFile.liked);
    const previousCount = Number(targetFile.likeCount || 0);
    const newLiked = !previousLiked;
    const newCount = newLiked ? previousCount + 1 : Math.max(0, previousCount - 1);

    // Optimistic UI update
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              liked: newLiked,
              likeCount: newCount,
            }
          : f
      )
    );

    try {
      const result = await toggleFileLike(fileId, previousLiked);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                liked: result.liked,
                likeCount: result.likeCount,
              }
            : f
        )
      );
      queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
        old
          ? {
              ...old,
              files: old.files.map((f: LibraryFile) =>
                f.id === fileId
                  ? {
                      ...f,
                      liked: result.liked,
                      likeCount: result.likeCount,
                    }
                  : f
              ),
            }
          : old
      );
    } catch (err: any) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                liked: previousLiked,
                likeCount: previousCount,
              }
            : f
        )
      );
      showToast(err.message || 'Could not update like.');
    }
  };

  // Called on double-tap: ensure like is triggered if not already liked
  const handleDoubleTapLike = (postId: number) => {
    const target = posts.find((p) => p.id === postId);
    if (!target) return;
    if (!target.liked_by_me) {
      handleToggleLike(postId);
    }
  };

  const uploadItem = useCallback(async (item: {
    id: string;
    uri: string;
    name: string;
    size?: number;
    type?: string;
    mediaType: 'image' | 'file';
  }) => {
    setComposerAttachments((prev) =>
      prev.map((a) => (a.id === item.id ? { ...a, status: 'uploading', progress: 0, error: undefined } : a))
    );

    try {
      const res = await uploadPostAttachment(
        {
          uri: item.uri,
          name: item.name,
          type: item.type || (item.mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream'),
          size: item.size,
        },
        (pct) => {
          setComposerAttachments((prev) =>
            prev.map((a) => (a.id === item.id ? { ...a, progress: pct } : a))
          );
        }
      );

      setComposerAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id ? { ...a, status: 'uploaded', progress: 100, uploaded: res } : a
        )
      );
    } catch (err: any) {
      setComposerAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id ? { ...a, status: 'error', error: err.message || 'Upload failed' } : a
        )
      );
    }
  }, []);

  const handlePickImage = async () => {
    try {
      const remainingSlots = 10 - composerImages.length;
      if (remainingSlots <= 0) {
        Alert.alert('Limit Reached', 'You can attach up to 10 photos per post.');
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Library Access Required',
          'Please allow access to your photos to attach images to your post.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const existingUris = new Set(composerAttachments.map((a) => a.uri));
        const oversized = result.assets.filter((a) => a.fileSize && a.fileSize > MAX_ATTACHMENT_BYTES_PER_FILE);
        if (oversized.length > 0) {
          Alert.alert(
            'Photo Too Large',
            'Photos must be 4 MB or smaller each. For larger study materials, upload them to the Library.'
          );
        }

        const validAssets = result.assets.filter(
          (a) => !existingUris.has(a.uri) && (!a.fileSize || a.fileSize <= MAX_ATTACHMENT_BYTES_PER_FILE)
        );

        const newItems = validAssets.slice(0, remainingSlots).map((a, idx) => ({
          id: `img_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          uri: a.uri,
          name: a.fileName || `post_photo_${Date.now()}_${idx}.jpg`,
          size: a.fileSize,
          type: a.mimeType || 'image/jpeg',
          mediaType: 'image' as const,
          status: 'idle' as const,
          progress: 0,
        }));

        if (newItems.length > 0) {
          setComposerAttachments((prev) => [...prev, ...newItems]);
          newItems.forEach((item) => void uploadItem(item));
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select images.');
    }
  };

  const handleRemoveComposerImage = (idToRemove: string) => {
    const target = composerAttachments.find((a) => a.id === idToRemove);
    if (target?.uploaded?.filename) {
      void deletePostAttachment(target.uploaded.filename);
    }
    setComposerAttachments((prev) => prev.filter((a) => a.id !== idToRemove));
  };

  const handleMoveComposerImage = (fromIdx: number, toIdx: number) => {
    const images = composerAttachments.filter((a) => a.mediaType === 'image');
    if (toIdx < 0 || toIdx >= images.length) return;
    const fromItem = images[fromIdx];
    const toItem = images[toIdx];
    setComposerAttachments((prev) => {
      const next = [...prev];
      const actualFrom = next.findIndex((a) => a.id === fromItem.id);
      const actualTo = next.findIndex((a) => a.id === toItem.id);
      if (actualFrom === -1 || actualTo === -1) return prev;
      const temp = next[actualFrom];
      next[actualFrom] = next[actualTo];
      next[actualTo] = temp;
      return next;
    });
  };

  const handlePickDocument = async () => {
    try {
      const remainingSlots = 5 - composerFiles.length;
      if (remainingSlots <= 0) {
        Alert.alert('Limit Reached', 'You can attach up to 5 files per post.');
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain',
          'application/zip',
          '*/*',
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const oversized = result.assets.filter((a) => a.size && a.size > MAX_ATTACHMENT_BYTES_PER_FILE);
        if (oversized.length > 0) {
          Alert.alert(
            'File Too Large',
            'Documents must be 4 MB or smaller each. For larger notes, slides, or books, please upload directly to the Semester Library.'
          );
        }

        const existingUris = new Set(composerAttachments.map((a) => a.uri));
        const validAssets = result.assets.filter(
          (a) => !existingUris.has(a.uri) && (!a.size || a.size <= MAX_ATTACHMENT_BYTES_PER_FILE)
        );

        const newItems = validAssets.slice(0, remainingSlots).map((a, idx) => ({
          id: `doc_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          uri: a.uri,
          name: a.name,
          size: a.size,
          type: a.mimeType || 'application/octet-stream',
          mediaType: 'file' as const,
          status: 'idle' as const,
          progress: 0,
        }));

        if (newItems.length > 0) {
          setComposerAttachments((prev) => [...prev, ...newItems]);
          newItems.forEach((item) => void uploadItem(item));
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select document.');
    }
  };

  const handleRemoveComposerFile = (idToRemove: string) => {
    const target = composerAttachments.find((a) => a.id === idToRemove);
    if (target?.uploaded?.filename) {
      void deletePostAttachment(target.uploaded.filename);
    }
    setComposerAttachments((prev) => prev.filter((a) => a.id !== idToRemove));
  };

  const handleRetryUpload = (idToRetry: string) => {
    const target = composerAttachments.find((a) => a.id === idToRetry);
    if (target) {
      void uploadItem(target);
    }
  };

  const handleOpenAttachedFile = async (file: any) => {
    try {
      const fileUrl = getFullImageUrl(file.url);
      if (fileUrl) {
        await Linking.openURL(fileUrl);
      }
    } catch {
      Alert.alert('Error', 'Could not open attached file.');
    }
  };

  const handlePublishPost = async () => {
    const hasText = Boolean(postContent.trim());
    const hasAttachments = composerAttachments.length > 0;
    if (!hasText && !hasAttachments) {
      setComposerError('Please write some content or attach at least one photo or file.');
      return;
    }

    const hasFailed = composerAttachments.some((a) => a.status === 'error');
    if (hasFailed) {
      setComposerError('Some attachments failed to upload. Please tap Retry on the failed files or remove them before posting.');
      return;
    }

    const isUploading = composerAttachments.some((a) => a.status === 'uploading' || a.status === 'idle');
    if (isUploading) {
      setComposerError('Attachments are still uploading. Please wait a moment.');
      return;
    }

    setSubmittingPost(true);
    setComposerError(null);

    try {
      const attachments = composerAttachments
        .map((a) => a.uploaded!)
        .filter(Boolean);

      const newPost = await createPost({
        content: postContent,
        type: isPrivileged ? postType : 'status',
        official: isPrivileged && postType === 'notice' && isOfficialNotice,
        attachments,
      });

      setPosts((prev) => [newPost, ...prev]);
      setLastFetchedAt(new Date());
      queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
        old ? { ...old, posts: [newPost, ...(old.posts || [])], fetchedAt: new Date() } : old
      );

      setPostContent('');
      setComposerAttachments([]);
      setPostType('status');
      setIsOfficialNotice(false);
      setComposerOpen(false);
    } catch (err: any) {
      setComposerError(err.message || 'Could not publish your post. Please try again.');
    } finally {
      setSubmittingPost(false);
    }
  };

  const getFullImageUrl = (attachmentUrl: string | null): string | null => {
    if (!attachmentUrl) return null;
    if (
      attachmentUrl.startsWith('http://') ||
      attachmentUrl.startsWith('https://') ||
      attachmentUrl.startsWith('file://') ||
      attachmentUrl.startsWith('blob:') ||
      attachmentUrl.startsWith('data:')
    ) {
      return attachmentUrl;
    }
    const host = (baseUrl || getAutoDetectedServerUrl() || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    const clean = attachmentUrl.replace(/^\/+/, '');
    return `${host}/${clean}`;
  };

  // Post options menu actions
  const handleCopyText = async () => {
    if (!selectedMenuPost) return;
    const textToCopy = selectedMenuPost.content || '';
    setSelectedMenuPost(null);
    try {
      await Clipboard.setStringAsync(textToCopy);
      showToast('Copied to clipboard');
    } catch {
      Alert.alert('Copy Failed', 'Unable to copy text to clipboard.');
    }
  };

  const handleCopyImageLink = async () => {
    if (!selectedMenuPost || !selectedMenuPost.attachment_url) return;
    const imageUrl = getFullImageUrl(selectedMenuPost.attachment_url);
    setSelectedMenuPost(null);
    if (!imageUrl) return;
    try {
      await Clipboard.setStringAsync(imageUrl);
      showToast('Image link copied');
    } catch {
      Alert.alert('Copy Failed', 'Unable to copy image link.');
    }
  };

  const handleDeletePost = () => {
    if (!selectedMenuPost) return;
    const targetPost = selectedMenuPost;
    setSelectedMenuPost(null);

    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const postId = targetPost.id;
            setDeletingPostId(postId);
            const prevPosts = [...posts];
            setPosts((current) => current.filter((p) => p.id !== postId));
            queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
              old ? { ...old, posts: old.posts ? old.posts.filter((p: Post) => p.id !== postId) : [] } : old
            );

            try {
              await deletePost(postId);
              showToast('Post deleted');
            } catch (err: any) {
              setPosts(prevPosts);
              queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
                old ? { ...old, posts: prevPosts } : old
              );
              Alert.alert('Delete Failed', err.message || 'Could not delete the post.');
            } finally {
              setDeletingPostId(null);
            }
          },
        },
      ]
    );
  };

  const renderBrandHeader = () => {
    return (
      <View
        style={[
          styles.fixedBrandHeader,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Left: "Semester Library" Wordmark and Academic Context Badge */}
        <TouchableOpacity onPress={refreshFromTop} accessibilityLabel="Refresh home feed" style={{ flex: 1, marginRight: 12 }}>
          <Text
            style={[
              styles.headerWordmark,
              { color: colors.text },
            ]}
          >
            Semester Library
          </Text>
        </TouchableOpacity>

        {/* Right: Search, Create (+), and Profile */}
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
            accessibilityLabel="Search campus"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setComposerOpen(true)}
            style={[
              styles.headerActionBtn,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
            accessibilityLabel="Create post"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="add" size={22} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={[
              styles.headerActionBtn,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                position: 'relative',
              },
            ]}
            accessibilityLabel="Notifications"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="notifications-outline" size={19} color={colors.text} />
            {unseenNotifCount > 0 && (
              <View
                style={[
                  styles.headerBellBadge,
                  { backgroundColor: colors.text },
                ]}
              >
                <Text
                  style={{
                    color: colors.surface,
                    fontSize: unseenNotifCount > 9 ? 8 : 9,
                    fontWeight: '800',
                    lineHeight: unseenNotifCount > 9 ? 9 : 10,
                  }}
                >
                  {unseenNotifCount > 99 ? '99+' : unseenNotifCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFeedHeader = () => {
    const feedAvatarUri = user?.avatarUrl ? getFullImageUrl(user.avatarUrl) : null;
    return (
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, marginBottom: spacing.xs }}>

        {/* Create Post Composer Trigger Card with clean placeholder */}
        <Card
          variant="elevated"
          padding="md"
          onPress={() => setComposerOpen(true)}
          style={[styles.composerTriggerCard, { borderColor: colors.border, marginBottom: spacing.md }]}
        >
          <View style={styles.composerTriggerRow}>
            <View
              style={[
                styles.authorAvatar,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: radii.full,
                  overflow: 'hidden',
                },
              ]}
            >
              {feedAvatarUri ? (
                <Image
                  source={{ uri: feedAvatarUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text variant="sm" weight="700" color="primary">
                  {(user?.name || 'S').charAt(0).toUpperCase()}
                </Text>
              )}
            </View>

          <View
            style={[
              styles.composerTriggerInput,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.full,
              },
            ]}
          >
            <Text variant="sm" color="muted">
              What's on your mind?
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => {
              setComposerOpen(true);
              setTimeout(handlePickImage, 350);
            }}
            style={styles.composerCameraBtn}
            accessibilityLabel="Attach photo and open composer"
          >
            <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </Card>

      {/* Campus Quick Hub Shortcuts (Parity with Website Features) */}
      <View style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/routine')}
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.md,
              paddingVertical: 10,
              paddingHorizontal: 6,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              <Ionicons name="calendar-outline" size={17} color={colors.primary} />
            </View>
            <Text variant="xs" weight="700" numberOfLines={1}>
              Routine
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/notices')}
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.md,
              paddingVertical: 10,
              paddingHorizontal: 6,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              <Ionicons name="megaphone-outline" size={17} color={colors.primary} />
            </View>
            <Text variant="xs" weight="700" numberOfLines={1}>
              Notices
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setUploadModalOpen(true)}
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.md,
              paddingVertical: 10,
              paddingHorizontal: 6,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              <Ionicons name="cloud-upload-outline" size={17} color={colors.primary} />
            </View>
            <Text variant="xs" weight="700" numberOfLines={1}>
              Upload
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Campus Feed Section Title with thin bottom divider */}
      <View
        style={[
          styles.sectionHeader,
          {
            borderBottomColor: colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
            marginBottom: spacing.xs,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="newspaper-outline" size={15} color={colors.textSecondary} />
          <Text
            weight="600"
            color="secondary"
            style={{ fontSize: 14.5, letterSpacing: -0.2 }}
          >
            Campus Feed
          </Text>
        </View>

        {Boolean(lastUpdatedText) && (
          <Text
            variant="xs"
            color="muted"
            style={{ fontSize: 12.5 }}
          >
            {lastUpdatedText}
          </Text>
        )}
      </View>


    </View>
  );
};

  const renderPostItem = ({ item }: { item: Post }) => {
    return (
      <PostCard
        post={item}
        currentUserId={user?.studentId}
        onLike={handleToggleLike}
        onDoubleTapLike={handleDoubleTapLike}
        onShare={handleSharePost}
        onOpenDetail={(p) => {
          if (p.type === 'notice') {
            router.push(`/notice/${p.id}`);
          } else {
            router.push(`/post/${p.id}`);
          }
        }}
        onOpenMenu={(p) => setSelectedMenuPost(p)}
        onOpenFile={handleOpenAttachedFile}
        getFullImageUrl={getFullImageUrl}
      />
    );
  };

  // Render study material / notes uploaded card
  const renderFileItem = (file: LibraryFile) => {
    const ext = getFileType(file.originalName);

    return (
      <View
        style={[
          styles.postItem,
          {
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
        >
          {/* Author / Uploader Row */}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="sm" weight="700" numberOfLines={1}>
                    {file.uploaderName || 'Student'}
                  </Text>
                  {file.uploaderRole && file.uploaderRole !== 'student' && (
                    <View
                      style={[
                        styles.rolePill,
                        {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.border,
                          borderWidth: 1,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text variant="xs" weight="700" color="secondary">
                        {file.uploaderRole.toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Caption color="muted">
                  Uploaded {formatRelativeTime(file.uploadedAt)}
                </Caption>
              </View>
            </TouchableOpacity>

            {/* Type Badge: NOTE / STUDY MATERIAL */}
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Ionicons name="document-text-outline" size={11} color={colors.textSecondary} style={{ marginRight: 3 }} />
              <Text
                variant="xs"
                weight="700"
                style={{ color: colors.textSecondary, fontSize: 10 }}
              >
                NOTE
              </Text>
            </View>
          </View>

          {/* Post Title & Subject/Chapter tags */}
          <View style={{ marginTop: 10, marginBottom: 8 }}>
            {file.title && file.title !== file.originalName ? (
              <Text weight="700" style={{ fontSize: 15, marginBottom: 6, lineHeight: 20 }}>
                {file.title}
              </Text>
            ) : null}

            {(file.subject || file.chapter) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {file.subject ? (
                  <View
                    style={[
                      styles.fileMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="book-outline" size={11} color={colors.textSecondary} style={{ marginRight: 4 }} />
                    <Text variant="xs" weight="600" color="secondary">
                      {file.subject}
                    </Text>
                  </View>
                ) : null}
                {file.chapter ? (
                  <View
                    style={[
                      styles.fileMetaTag,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text variant="xs" color="muted">
                      {file.chapter}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* File Attachment Box - plain gray background with white text (monochrome) */}
          <View
            style={[
              styles.feedFileAttachmentBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.md,
              },
            ]}
          >
            <View
              style={[
                styles.fileTypeBadge,
                {
                  backgroundColor: '#4B5563',
                  borderRadius: radii.sm,
                },
              ]}
            >
              <Text variant="xs" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                {ext.toUpperCase()}
              </Text>
            </View>

            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text variant="sm" weight="600" numberOfLines={1}>
                {file.originalName}
              </Text>
              <Caption color="muted" numberOfLines={1}>
                {formatFileSize(file.sizeBytes)} • Tap to view material
              </Caption>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        {/* File Engagement Actions (Like button & Comments count) */}
        <View style={styles.postActionRow}>
          <LikeButton
            liked={Boolean(file.liked)}
            count={Number(file.likeCount || 0)}
            colors={colors}
            onPress={() => handleToggleFileLike(file.id)}
          />

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push(`/material/${file.id}` as any)}
            accessibilityLabel="View comments on material"
          >
            <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {Number(file.commentCount || 0)}
            </Text>
          </TouchableOpacity>

          {/* Share / Copy File Link */}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleShareFileItem(file)}
            accessibilityLabel="Share material link"
          >
            <Ionicons name="share-outline" size={17} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFeedItem = ({ item }: { item: FeedItem }) => {
    if (item.feedType === 'assignment') {
      const a = item.assignment;
      return <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
        <Text weight="700">{a.teacherName || 'Faculty'} · Assignment</Text>
        <Caption color="muted">{formatTimeAgo(a.createdAt)}{a.subject ? ` · ${a.subject}` : ''}</Caption>
        <Subheading style={{ marginTop: 12 }}>{a.title}</Subheading>
        {!!a.description && <Text variant="sm" numberOfLines={4} style={{ marginVertical: 8 }}>{a.description}</Text>}
        {!!a.deadline && <Caption color="secondary">Due {new Date(a.deadline).toLocaleDateString()}</Caption>}
        <Button title="Do assignment on website" variant="secondary" size="sm" onPress={() => {
          void Linking.openURL(`${baseUrl}/code-lab/assignment.html?id=${a.id}`).catch(() => showToast('Could not open the website.'));
        }} />
      </Card>;
    }
    if (item.feedType === 'file') {
      return renderFileItem(item.file);
    }
    return renderPostItem({ item: item.post });
  };

  const renderEmpty = () => {
    if (loadingInitial) {
      return (
        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          <FeedSkeletonCard colors={colors} radii={radii} />
          <FeedSkeletonCard colors={colors} radii={radii} />
          <FeedSkeletonCard colors={colors} radii={radii} />
        </View>
      );
    }

    if (error) {
      return (
        <Card variant="elevated" padding="lg" style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textSecondary} style={{ marginBottom: spacing.sm }} />
          <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
            Unable to Load Feed
          </Heading>
          <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
            {error}
          </Text>
          <Button title="Retry Feed" variant="secondary" size="md" onPress={() => refetchFeed()} />
        </Card>
      );
    }

    return (
      <Card variant="flat" padding="lg" style={styles.stateCard}>
        <Ionicons name="newspaper-outline" size={44} color={colors.textMuted} style={{ marginBottom: spacing.sm }} />
        <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
          No Posts Yet
        </Heading>
        <Text variant="sm" color="secondary" style={{ textAlign: 'center' }}>
          Be the first to share an update or question with your classmates above!
        </Text>
      </Card>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="xs" color="secondary" style={{ marginLeft: spacing.sm }}>
            Loading older posts...
          </Text>
        </View>
      );
    }

    if (feedItems.length > 0 && !nextCursor) {
      return (
        <View style={styles.footerLoader}>
          <Caption color="muted">You reached Bedrock :)</Caption>
        </View>
      );
    }

    if (nextCursor && !loadingMore && feedItems.length > 0) {
      return (
        <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
          <Button
            title="Load More Posts"
            variant="secondary"
            size="sm"
            onPress={handleLoadMore}
          />
        </View>
      );
    }

    return null;
  };

  return (
    <TabSwipeContainer tabIndex={0} disabled={Boolean(commentsModalOpen || uploadModalOpen)}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
        {/* Fixed / Pinned Brand Header (stays visible while feed scrolls) */}
        {renderBrandHeader()}

        <FlatList
          ref={feedRef}
          data={feedItems}
          keyExtractor={(item) => (item.feedType === 'post' ? `post-${item.post.id}` : item.feedType === 'file' ? `file-${item.file.id}` : `assignment-${item.assignment.id}`)}
          renderItem={renderFeedItem}
          ListHeaderComponent={renderFeedHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          onScroll={handleNavScroll}
          scrollEventThrottle={scrollEventThrottle}
          contentContainerStyle={[styles.container, { paddingBottom: 90 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.text]}
              tintColor={colors.text}
            />
          }
        />

      {/* Live Campus Search Overlay */}
      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

      {/* Create Post Modal */}
      <Modal
        visible={composerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!submittingPost) setComposerOpen(false);
        }}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: colors.background }]}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Modal Header */}
            <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => setComposerOpen(false)}
                disabled={submittingPost}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text variant="sm" color="secondary">Cancel</Text>
              </TouchableOpacity>

              <Text variant="md" weight="700" color="primary">Create Post</Text>

              <Button
                title={submittingPost ? 'Posting...' : 'Post'}
                size="sm"
                variant="primary"
                loading={submittingPost}
                disabled={
                  (!postContent.trim() && composerAttachments.length === 0) ||
                  composerAttachments.some((a) => a.status === 'uploading' || a.status === 'error') ||
                  submittingPost
                }
                onPress={handlePublishPost}
                style={{ minWidth: 68 }}
              />
            </View>

            {/* Upload Status Indicator — only show during upload or on error */}
            {composerAttachments.length > 0 && (() => {
              const isUploading = composerAttachments.some((a) => a.status === 'uploading' || a.status === 'idle');
              const hasError = composerAttachments.some((a) => a.status === 'error');

              if (isUploading) {
                return (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: spacing.md,
                      paddingVertical: 8,
                      backgroundColor: colors.surfaceRaised,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />
                    <Text variant="xs" weight="600" style={{ color: colors.primary, flex: 1 }}>
                      Uploading…
                    </Text>
                  </View>
                );
              }
              if (hasError) {
                return (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: spacing.md,
                      paddingVertical: 8,
                      backgroundColor: '#FEF2F2',
                      borderBottomWidth: 1,
                      borderBottomColor: '#FCA5A5',
                    }}
                  >
                    <Ionicons name="alert-circle" size={15} color="#DC2626" style={{ marginRight: 6 }} />
                    <Text variant="xs" weight="600" style={{ color: '#DC2626', flex: 1 }}>
                      Some uploads failed. Tap "Retry" on failed items.
                    </Text>
                  </View>
                );
              }
              // All uploaded successfully — no banner, UI returns to normal
              return null;
            })()}

            <KeyboardAwareForm
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: spacing.md }}
              keyboardShouldPersistTaps="handled"
              clearance={24}
            >
              {/* Author & Post Type Row */}
              <View style={styles.modalAuthorRow}>
                <Avatar
                  size="sm"
                  url={getFullImageUrl(user?.avatarUrl || null)}
                  name={user?.name}
                />

                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text variant="sm" weight="700" color="primary">
                    {user?.name || 'Student'}
                  </Text>
                  <Caption color="muted">
                    {user?.role ? user.role.toUpperCase() : 'STUDENT'} • Public to campus
                  </Caption>
                </View>
              </View>

              {/* Type Selection (Restricted by Role) */}
              <View style={{ marginVertical: spacing.sm }}>
                {isPrivileged ? (
                  <View>
                    <Caption color="muted" style={{ marginBottom: 6 }}>
                      Post Category
                    </Caption>
                    <View style={styles.typeSegmentRow}>
                      {(['status', 'notice', 'assignment'] as const).map((t) => {
                        const isSelected = postType === t;
                        return (
                          <TouchableOpacity
                            key={t}
                            onPress={() => setPostType(t)}
                            style={[
                              styles.typeSegmentPill,
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
                              style={{
                                color: isSelected ? colors.primaryText : colors.textSecondary,
                                textTransform: 'uppercase',
                              }}
                            >
                              {t}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Official Notice Toggle for privileged users */}
                    {postType === 'notice' && (
                      <View style={[styles.officialRow, { borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceRaised }]}>
                        <View style={{ flex: 1 }}>
                          <Text variant="xs" weight="700" color="primary">
                            Publish as Official Notice
                          </Text>
                          <Caption color="muted">
                            Marks post with verified official banner
                          </Caption>
                        </View>
                        <Switch
                          value={isOfficialNotice}
                          onValueChange={setIsOfficialNotice}
                          thumbColor={isOfficialNotice ? colors.primary : colors.textMuted}
                          trackColor={{ false: colors.border, true: colors.borderStrong }}
                        />
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.studentTypePill}>
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.textSecondary} style={{ marginRight: 4 }} />
                    <Text variant="xs" color="secondary" weight="600">
                      Category: General Discussion & Status
                    </Text>
                  </View>
                )}
              </View>

              {/* Error Banner */}
              {composerError && (
                <View style={[styles.errorBox, { borderColor: colors.borderStrong, borderRadius: radii.md }]}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
                  <Text variant="xs" color="primary" style={{ flex: 1 }}>
                    {composerError}
                  </Text>
                </View>
              )}

              {/* Main Content Input with subtle "Write something..." placeholder */}
              <TextInput
                placeholder="Write something..."
                placeholderTextColor={colors.textMuted}
                value={postContent}
                onChangeText={setPostContent}
                multiline
                maxLength={5000}
                style={[
                  styles.contentInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    padding: spacing.md,
                  },
                ]}
                textAlignVertical="top"
              />

              <View style={styles.characterCounterRow}>
                <Caption color="muted">
                  {postContent.length} / 5,000 characters
                </Caption>
              </View>

              {/* Attached Images Preview Strip */}
              {composerImages.length > 0 && (
                <View style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Caption color="muted">
                      Attached Photos ({composerImages.length} / 10)
                    </Caption>
                    {composerImages.length < 10 && (
                      <TouchableOpacity
                        onPress={handlePickImage}
                        disabled={submittingPost}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                          + Add More
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
                  >
                    {composerImages.map((asset, idx) => (
                      <View
                        key={`asset-${asset.id}`}
                        style={{
                          width: 88,
                          height: 88,
                          borderRadius: radii.md,
                          overflow: 'hidden',
                          borderWidth: 1,
                          borderColor: asset.status === 'error' ? '#EF4444' : colors.border,
                          backgroundColor: colors.surfaceRaised,
                          position: 'relative',
                        }}
                      >
                        <Image
                          source={{ uri: asset.uri }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                        />

                        {/* Upload Status Overlay */}
                        {asset.status === 'uploading' && (
                          <View
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: 'rgba(0,0,0,0.5)',
                              justifyContent: 'center',
                              alignItems: 'center',
                            }}
                          >
                            <ActivityIndicator size="small" color="#ffffff" />
                            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                              {asset.progress}%
                            </Text>
                          </View>
                        )}

                        {asset.status === 'uploaded' && (
                          <View
                            style={{
                              position: 'absolute',
                              bottom: 22,
                              right: 4,
                              backgroundColor: 'rgba(16, 185, 129, 0.9)',
                              borderRadius: 8,
                              padding: 2,
                            }}
                          >
                            <Ionicons name="checkmark" size={12} color="#ffffff" />
                          </View>
                        )}

                        {asset.status === 'error' && (
                          <TouchableOpacity
                            onPress={() => handleRetryUpload(asset.id)}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: 'rgba(239, 68, 68, 0.8)',
                              justifyContent: 'center',
                              alignItems: 'center',
                              padding: 4,
                            }}
                          >
                            <Ionicons name="alert-circle" size={20} color="#ffffff" />
                            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                              Retry
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          onPress={() => handleRemoveComposerImage(asset.id)}
                          disabled={submittingPost}
                          style={{
                            position: 'absolute',
                            top: 2,
                            right: 2,
                            backgroundColor: '#ffffff',
                            borderRadius: 10,
                            zIndex: 10,
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          accessibilityLabel="Remove photo"
                        >
                          <Ionicons name="close-circle" size={20} color="#EF4444" />
                        </TouchableOpacity>

                        {/* Reorder controls if more than 1 image */}
                        {composerImages.length > 1 && (
                          <View
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: 20,
                              backgroundColor: 'rgba(0,0,0,0.6)',
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingHorizontal: 2,
                            }}
                          >
                            {idx > 0 ? (
                              <TouchableOpacity onPress={() => handleMoveComposerImage(idx, idx - 1)}>
                                <Ionicons name="chevron-back" size={13} color="#ffffff" />
                              </TouchableOpacity>
                            ) : <View style={{ width: 13 }} />}
                            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700' }}>{idx + 1}</Text>
                            {idx < composerImages.length - 1 ? (
                              <TouchableOpacity onPress={() => handleMoveComposerImage(idx, idx + 1)}>
                                <Ionicons name="chevron-forward" size={13} color="#ffffff" />
                              </TouchableOpacity>
                            ) : <View style={{ width: 13 }} />}
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Attached Files & Documents List */}
              {composerFiles.length > 0 && (
                <View style={{ marginTop: spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Caption color="muted">
                      Attached Files ({composerFiles.length} / 5)
                    </Caption>
                    {composerFiles.length < 5 && (
                      <TouchableOpacity
                        onPress={handlePickDocument}
                        disabled={submittingPost}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                          + Add More
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ gap: 6 }}>
                    {composerFiles.map((file) => (
                      <View
                        key={`composer-file-${file.id}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          padding: 8,
                          borderRadius: radii.md,
                          borderWidth: 1,
                          borderColor: file.status === 'error' ? '#EF4444' : colors.border,
                          backgroundColor: colors.surfaceRaised,
                        }}
                      >
                        <Ionicons name="document-text-outline" size={20} color={colors.text} style={{ marginRight: 8 }} />
                        <View style={{ flex: 1, marginRight: 6 }}>
                          <Text variant="xs" weight="600" numberOfLines={1}>
                            {file.name}
                          </Text>
                          {Boolean(file.size) && (
                            <Caption color="muted">
                              {(Number(file.size) / (1024 * 1024)).toFixed(1)} MB
                            </Caption>
                          )}
                        </View>

                        {/* Upload Status / Retry Button */}
                        {file.status === 'uploading' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 }}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text variant="xs" style={{ color: colors.primary }}>{file.progress}%</Text>
                          </View>
                        )}

                        {file.status === 'uploaded' && (
                          <View style={{ marginRight: 8 }}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                          </View>
                        )}

                        {file.status === 'error' && (
                          <TouchableOpacity
                            onPress={() => handleRetryUpload(file.id)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 3,
                              backgroundColor: '#FEE2E2',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: radii.sm,
                              marginRight: 8,
                            }}
                          >
                            <Ionicons name="refresh" size={12} color="#DC2626" />
                            <Text style={{ color: '#DC2626', fontSize: 10, fontWeight: '700' }}>Retry</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          onPress={() => handleRemoveComposerFile(file.id)}
                          disabled={submittingPost}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Attachments Toolbar */}
              <View style={[styles.modalToolbar, { borderTopColor: colors.border, marginTop: spacing.lg }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    onPress={handlePickImage}
                    disabled={submittingPost || composerImages.length >= 10}
                    style={[
                      styles.attachPhotoBtn,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        opacity: composerImages.length >= 10 ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="image-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                    <Text variant="xs" weight="600" color="primary">
                      {composerImages.length > 0 ? '+ Photos' : 'Add Photos'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handlePickDocument}
                    disabled={submittingPost || composerFiles.length >= 5}
                    style={[
                      styles.attachPhotoBtn,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        opacity: composerFiles.length >= 5 ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="attach-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                    <Text variant="xs" weight="600" color="primary">
                      {composerFiles.length > 0 ? '+ Files' : 'Add Files'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {composerAttachments.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      composerAttachments.forEach((a) => {
                        if (a.uploaded?.filename) void deletePostAttachment(a.uploaded.filename);
                      });
                      setComposerAttachments([]);
                    }}
                    disabled={submittingPost}
                    style={{ padding: 8 }}
                  >
                    <Text variant="xs" color="secondary">
                      Clear All
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </KeyboardAwareForm>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Post Options Bottom Sheet Menu */}
      <Modal
        visible={Boolean(selectedMenuPost)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMenuPost(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSelectedMenuPost(null)}
          style={styles.menuBackdrop}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.menuSheet,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            {/* Sheet Drag Indicator */}
            <View style={styles.menuHandle} />

            {/* Menu Options Group */}
            <View
              style={[
                styles.menuOptionsGroup,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {/* Option 1: Copy Text */}
              <TouchableOpacity
                onPress={handleCopyText}
                style={[
                  styles.menuItem,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth:
                      Boolean(selectedMenuPost?.attachment_url) ||
                      Boolean(
                        selectedMenuPost?.canDelete ||
                        (user?.studentId && selectedMenuPost?.studentId === user.studentId) ||
                        (user?.role && user.role.toLowerCase() === 'admin')
                      )
                        ? StyleSheet.hairlineWidth
                        : 0,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={19} color={colors.text} style={styles.menuItemIcon} />
                <Text variant="sm" weight="600" color="primary">
                  Copy text
                </Text>
              </TouchableOpacity>

              {/* Option 2: Copy Image Link (Conditional) */}
              {Boolean(selectedMenuPost?.attachment_url) && (
                <TouchableOpacity
                  onPress={handleCopyImageLink}
                  style={[
                    styles.menuItem,
                    {
                      borderBottomColor: colors.border,
                      borderBottomWidth: Boolean(
                        selectedMenuPost?.canDelete ||
                        (user?.studentId && selectedMenuPost?.studentId === user.studentId) ||
                        (user?.role && user.role.toLowerCase() === 'admin')
                      )
                        ? StyleSheet.hairlineWidth
                        : 0,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="link-outline" size={19} color={colors.text} style={styles.menuItemIcon} />
                  <Text variant="sm" weight="600" color="primary">
                    Copy image link
                  </Text>
                </TouchableOpacity>
              )}

              {/* Option 3: Edit Post (Author or Admin) */}
              {Boolean(
                selectedMenuPost?.canEdit ||
                (user?.studentId && selectedMenuPost?.user_id === user.studentId) ||
                (user?.studentId && selectedMenuPost?.studentId === user.studentId) ||
                (user?.role && user.role.toLowerCase() === 'admin')
              ) && (
                <TouchableOpacity
                  onPress={() => {
                    const postToEdit = selectedMenuPost;
                    setSelectedMenuPost(null);
                    setEditingPost(postToEdit);
                  }}
                  style={[
                    styles.menuItem,
                    {
                      borderBottomColor: colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil-outline" size={19} color={colors.text} style={styles.menuItemIcon} />
                  <Text variant="sm" weight="600" color="primary">
                    Edit post
                  </Text>
                </TouchableOpacity>
              )}

              {/* Option 4: Delete Post (Conditional) */}
              {Boolean(
                selectedMenuPost?.canDelete ||
                (user?.studentId && selectedMenuPost?.studentId === user.studentId) ||
                (user?.role && user.role.toLowerCase() === 'admin')
              ) && (
                <TouchableOpacity
                  onPress={handleDeletePost}
                  style={styles.menuItem}
                  activeOpacity={0.7}
                  disabled={deletingPostId === selectedMenuPost?.id}
                >
                  <Ionicons name="trash-outline" size={19} color="#EF4444" style={styles.menuItemIcon} />
                  <Text variant="sm" weight="600" style={{ color: '#EF4444' }}>
                    Delete post
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Cancel Button */}
            <TouchableOpacity
              onPress={() => setSelectedMenuPost(null)}
              style={[
                styles.menuCancelBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text variant="sm" weight="600" color="secondary">
                Cancel
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Edit Post Modal */}
      <EditPostModal
        visible={Boolean(editingPost)}
        post={editingPost}
        getFullUrl={getFullImageUrl}
        onClose={() => setEditingPost(null)}
        onPostUpdated={(updatedPost) => {
          setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? { ...p, ...updatedPost } : p)));
          queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
            old
              ? {
                  ...old,
                  posts: (old.posts || []).map((p: Post) =>
                    p.id === updatedPost.id ? { ...p, ...updatedPost } : p
                  ),
                }
              : old
          );
          showToast('Post updated');
        }}
      />

      {/* Post Comments Modal Dialog / Sheet */}
      <Modal
        visible={commentsModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setCommentsModalOpen(false);
          setActiveCommentPost(null);
        }}
      >
        <KeyboardStickyView
          offset={{ closed: 0, opened: insets.bottom }}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              maxHeight: '85%',
              minHeight: '55%',
              paddingBottom: Platform.OS === 'ios' ? 24 : 12,
            }}
          >
            {/* Comments Header */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View>
                <Heading style={{ fontSize: 16 }}>Comments</Heading>
                <Caption color="muted">
                  {activeCommentPost ? `On post by ${activeCommentPost.name}` : 'Post replies'}
                </Caption>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setCommentsModalOpen(false);
                  setActiveCommentPost(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  padding: 6,
                  borderRadius: radii.full,
                  backgroundColor: colors.surfaceRaised,
                }}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Comments List */}
            <ScrollView
              contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {loadingComments ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 32 }} />
              ) : postComments.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                  <Ionicons name="chatbubbles-outline" size={42} color={colors.textMuted} style={{ marginBottom: 8 }} />
                  <Text variant="sm" weight="600" color="secondary">
                    No comments yet
                  </Text>
                  <Caption color="muted" style={{ marginTop: 4 }}>
                    Be the first to join the conversation!
                  </Caption>
                </View>
              ) : (
                postComments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    onReply={handleReplyPressModal}
                    onEdit={handleEditPressModal}
                    onDelete={handleDeletePostComment}
                    onToggleReaction={handleToggleCommentReactionModal}
                    getFullUrl={getFullImageUrl}
                    currentUserId={user?.studentId || null}
                    isAdmin={user?.role === 'admin'}
                  />
                ))
              )}
            </ScrollView>

            {/* Comment Composer Input Bar */}
            <View
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              {(commentReplyingTo || commentEditing) && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceRaised,
                    marginBottom: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                    <Ionicons
                      name={commentEditing ? 'pencil' : 'arrow-undo'}
                      size={13}
                      color={colors.primary}
                    />
                    <Text variant="xs" weight="600" color="secondary" numberOfLines={1}>
                      {commentEditing
                        ? 'Editing your comment'
                        : `Replying to ${commentReplyingTo?.name}`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handleCancelCommentInputMode}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TextInput
                  ref={commentInputRef}
                  placeholder={
                    commentEditing
                      ? 'Edit your comment…'
                      : commentReplyingTo
                      ? `Reply to ${commentReplyingTo.name}…`
                      : 'Write a reply...'
                  }
                  placeholderTextColor={colors.textMuted}
                  value={commentInput}
                  onChangeText={setCommentInput}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: radii.full,
                    paddingHorizontal: spacing.md,
                    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
                    color: colors.text,
                    fontSize: 14,
                    maxHeight: 90,
                  }}
                  multiline
                />
                <TouchableOpacity
                  onPress={handleSubmitPostComment}
                  disabled={!commentInput.trim() || postingComment}
                  style={{
                    backgroundColor: commentInput.trim() ? colors.primary : colors.surfaceRaised,
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {postingComment ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons
                      name={commentEditing ? 'checkmark' : 'send'}
                      size={18}
                      color={commentInput.trim() ? '#FFFFFF' : colors.textMuted}
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardStickyView>
      </Modal>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text variant="sm" weight="600" color="primary">
            {toastMessage}
          </Text>
        </Animated.View>
      )}

      {/* Upload Note Modal */}
      <UploadNoteModal
        visible={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={(msg) => {
          queryClient.invalidateQueries({ queryKey: ['feed-files'] });
          showToast(msg || 'Note uploaded successfully!');
        }}
      />
    </SafeAreaView>
  </TabSwipeContainer>
);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingBottom: 36,
  },
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
  headerBellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  headerAvatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerTriggerCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  composerTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  composerTriggerInput: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  composerCameraBtn: {
    padding: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  postItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  postAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorAvatar: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  feedFileAttachmentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  fileTypeBadge: {
    width: 44,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fileMetaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 4,
  },
  postContent: {
    lineHeight: 20,
  },
  imageContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  overlayHeartContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  overlayHeartGlow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
  postActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  centerContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateCard: {
    margin: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  modalBackdrop: {
    flex: 1,
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  typeSegmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  typeSegmentPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  officialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  studentTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    marginBottom: 12,
    backgroundColor: '#1f1f1f',
  },
  contentInput: {
    minHeight: 140,
    fontSize: 15,
    borderWidth: 1,
  },
  characterCounterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  attachedPreviewContainer: {
    position: 'relative',
    height: 180,
    width: '100%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  attachedPreviewImage: {
    width: '100%',
    height: '100%',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },
  viewerSafeArea: {
    flex: 1,
  },
  viewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 10,
  },
  viewerActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  viewerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  viewerCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerZoomContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImageWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerFullImage: {
    width: '100%',
    height: '100%',
  },
  viewerFooter: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  authorRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  optionsMenuBtn: {
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsMenuIcon: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
    width: 18,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#52525b',
    alignSelf: 'center',
    marginBottom: 16,
  },
  menuOptionsGroup: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 14,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemIcon: {
    marginRight: 14,
    width: 22,
    textAlign: 'center',
  },
  menuCancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  toastContainer: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
});
