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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  getPosts,
  getFeedFiles,
  toggleLike,
  toggleFileLike,
  createPost,
  deletePost,
  getComments,
  addComment,
  deleteComment,
  Post,
  PostComment,
  LibraryFile,
} from '@/services/posts';
import { getBaseUrl, getAutoDetectedServerUrl } from '@/services/api';
import { SearchOverlay } from '@/components/SearchOverlay';
import { initChatRealtime } from '@/services/chat-realtime';
import { FullScreenImageViewer } from '@/components/FullScreenImageViewer';
import { UploadNoteModal } from '@/components/UploadNoteModal';

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

export type FeedItem =
  | { feedType: 'post'; post: Post; time: number }
  | { feedType: 'file'; file: LibraryFile; time: number };

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
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

// Post Image with dynamic 4:5 max-height cap and double-tap to like with Instagram-style heart burst
function PostImageItem({
  imageUrl,
  colors,
  radii,
  onSingleTap,
  onDoubleTap,
}: {
  imageUrl: string;
  colors: any;
  radii: any;
  onSingleTap: () => void;
  onDoubleTap: () => void;
}) {
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handlePress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      triggerHeartBurst();
      onDoubleTap();
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        onSingleTap();
        singleTapTimerRef.current = null;
      }, DOUBLE_TAP_DELAY);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.95}
      onPress={handlePress}
      style={[
        styles.imageContainer,
        {
          aspectRatio,
          borderRadius: radii.md,
          borderColor: colors.border,
          borderWidth: 1,
          backgroundColor: colors.surfaceRaised,
          marginTop: 10,
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
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();

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
    queryKey: ['campus-feed'],
    queryFn: async () => {
      const [postsRes, filesRes] = await Promise.all([
        getPosts(null, 20),
        getFeedFiles(),
      ]);
      return {
        posts: postsRes.posts,
        files: filesRes,
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
    return [...postItems, ...fileItems].sort((a, b) => {
      if (b.time !== a.time) return b.time - a.time;
      const bId = b.feedType === 'post' ? b.post.id : b.file.id;
      const aId = a.feedType === 'post' ? a.post.id : a.file.id;
      return bId - aId;
    });
  }, [posts, files]);

  // Feed Filter Tab state
  const [feedFilter, setFeedFilter] = useState<'all' | 'notes' | 'notices'>('all');

  const filteredFeedItems = useMemo<FeedItem[]>(() => {
    if (feedFilter === 'notes') {
      return feedItems.filter((i) => i.feedType === 'file');
    }
    if (feedFilter === 'notices') {
      return feedItems.filter((i) => i.feedType === 'post' && i.post.type === 'notice');
    }
    return feedItems;
  }, [feedItems, feedFilter]);

  // Post Comments bottom-sheet state
  const [activeCommentPost, setActiveCommentPost] = useState<Post | null>(null);
  const [postComments, setPostComments] = useState<PostComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [commentsModalOpen, setCommentsModalOpen] = useState(false);

  const handleOpenPostComments = async (post: Post) => {
    setActiveCommentPost(post);
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

  const handleAddPostComment = async () => {
    if (!activeCommentPost || !commentInput.trim() || postingComment) return;
    const content = commentInput.trim();
    setPostingComment(true);
    try {
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
      showToast('Reply posted');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not post comment.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeletePostComment = (commentId: number) => {
    if (!activeCommentPost) return;
    Alert.alert('Delete Reply', 'Are you sure you want to delete this reply?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await deleteComment(activeCommentPost.id, commentId);
            setPostComments((prev) => prev.filter((c) => c.id !== commentId));
            const updatedCount = res.comment_count ?? Math.max(0, activeCommentPost.comment_count - 1);
            setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
            setPosts((prev) =>
              prev.map((p) => (p.id === activeCommentPost.id ? { ...p, comment_count: updatedCount } : p))
            );
            showToast('Reply deleted');
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not delete reply.');
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
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [selectedImageAsset, setSelectedImageAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Full-screen image viewer states
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);

  // Support device rotation while full-screen image viewer is open
  useEffect(() => {
    if (viewerImageUri) {
      ScreenOrientation.unlockAsync().catch(() => {});
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [viewerImageUri]);

  // Prefetch and pre-warm chat realtime connection and delta in background while user views Home
  useEffect(() => {
    if (user?.studentId) {
      void initChatRealtime(user.studentId);

    }
  }, [user?.studentId]);

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

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);

    try {
      const res = await getPosts(nextCursor, 20);
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newPosts = res.posts.filter((p) => !existingIds.has(p.id));
        const updated = [...prev, ...newPosts];
        queryClient.setQueryData(['campus-feed'], (old: any) =>
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
      queryClient.setQueryData(['campus-feed'], (old: any) =>
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
      queryClient.setQueryData(['campus-feed'], (old: any) =>
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

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Library Access Required',
          'Please allow access to your photos to attach an image to your post.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedImageUri(result.assets[0].uri);
        setSelectedImageAsset(result.assets[0]);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select image.');
    }
  };

  const handlePublishPost = async () => {
    if (!postContent.trim()) {
      setComposerError('Please write some content before posting.');
      return;
    }

    setSubmittingPost(true);
    setComposerError(null);

    try {
      const newPost = await createPost({
        content: postContent,
        type: isPrivileged ? postType : 'status',
        official: isPrivileged && postType === 'notice' && isOfficialNotice,
        imageUri: selectedImageUri,
        image: selectedImageAsset,
      });

      setPosts((prev) => [newPost, ...prev]);
      setLastFetchedAt(new Date());
      queryClient.setQueryData(['campus-feed'], (old: any) =>
        old ? { ...old, posts: [newPost, ...(old.posts || [])], fetchedAt: new Date() } : old
      );

      setPostContent('');
      setSelectedImageUri(null);
      setSelectedImageAsset(null);
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
    if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
      return attachmentUrl;
    }
    const host = baseUrl || getAutoDetectedServerUrl();
    return `${host}${attachmentUrl.startsWith('/') ? '' : '/'}${attachmentUrl}`;
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
            queryClient.setQueryData(['campus-feed'], (old: any) =>
              old ? { ...old, posts: old.posts ? old.posts.filter((p: Post) => p.id !== postId) : [] } : old
            );

            try {
              await deletePost(postId);
              showToast('Post deleted');
            } catch (err: any) {
              setPosts(prevPosts);
              queryClient.setQueryData(['campus-feed'], (old: any) =>
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
    const brandAvatarUri = user?.avatarUrl ? getFullImageUrl(user.avatarUrl) : null;
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
        {/* Left: "Semester Library" Wordmark */}
        <Text
          style={[
            styles.headerWordmark,
            { color: colors.text },
          ]}
        >
          Semester Library
        </Text>

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
            onPress={() => router.push('/(tabs)/library')}
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
              <Ionicons name="book-outline" size={17} color={colors.primary} />
            </View>
            <Text variant="xs" weight="700" numberOfLines={1}>
              Library
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

      {/* Feed Category Filter Tabs (Matching Website Feed) */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8, paddingHorizontal: 2 }}>
        {[
          { id: 'all', label: 'All Feed', icon: 'grid-outline' },
          { id: 'notes', label: 'Notes & Study', icon: 'document-text-outline' },
          { id: 'notices', label: 'Notices', icon: 'megaphone-outline' },
        ].map((tab) => {
          const active = feedFilter === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              activeOpacity={0.7}
              onPress={() => setFeedFilter(tab.id as any)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: radii.full,
                backgroundColor: active ? colors.text : colors.surfaceRaised,
                borderWidth: 1,
                borderColor: active ? colors.text : colors.border,
              }}
            >
              <Ionicons
                name={tab.icon as any}
                size={13}
                color={active ? colors.background : colors.textSecondary}
              />
              <Text
                variant="xs"
                weight="700"
                style={{
                  color: active ? colors.background : colors.textSecondary,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

  const renderPostItem = ({ item }: { item: Post }) => {
    const badge = getTypeBadgeProps(item.type, item.is_official, colors);
    const imageUrl = getFullImageUrl(item.attachment_url);

    return (
      <View
        style={[
          styles.postItem,
          {
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Post Author & Header */}
        <View style={styles.postAuthorRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              const sid = item.studentId || item.user_id;
              if (sid) {
                router.push({
                  pathname: '/user/[id]',
                  params: { id: sid },
                });
              }
            }}
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
          >
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
              {item.avatarUrl ? (
                <Image
                  source={{ uri: getFullImageUrl(item.avatarUrl) || item.avatarUrl }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text variant="sm" weight="700" color="primary">
                  {(item.name || 'U').charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="sm" weight="700" numberOfLines={1}>
                  {item.name || 'Student'}
                </Text>
                {item.role && item.role !== 'student' && (
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
                      {item.role.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Caption color="muted">
                {formatRelativeTime(item.created_at)}
              </Caption>
            </View>
          </TouchableOpacity>

          {/* Right Header: Badge (if notice/assignment) + Three-Dot Options Button (⋮) */}
          <View style={styles.authorRightActions}>
            {badge && (
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor: badge.bgColor,
                    borderColor: badge.borderColor,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <Ionicons name={badge.icon} size={11} color={badge.textColor} style={{ marginRight: 3 }} />
                <Text
                  variant="xs"
                  weight="700"
                  style={{ color: badge.textColor, fontSize: 10 }}
                >
                  {badge.label}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setSelectedMenuPost(item)}
              style={styles.optionsMenuBtn}
              accessibilityLabel="Post options"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.optionsMenuIcon, { color: colors.textSecondary }]}>
                {'\u22EE'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Post Text Content with See More / See Less */}
        <View style={{ marginTop: spacing.sm }}>
          <Text
            variant="sm"
            style={[styles.postContent, { color: colors.text }]}
          >
            {(item.content || '').length > 180 && !expandedPostIds.has(item.id)
              ? `${(item.content || '').slice(0, 180).trim()}... `
              : item.content}
            {(item.content || '').length > 180 && (
              <Text
                variant="sm"
                weight="700"
                color="secondary"
                onPress={() => toggleExpandPost(item.id)}
                suppressHighlighting
              >
                {expandedPostIds.has(item.id) ? '  See less' : '  See more'}
              </Text>
            )}
          </Text>
        </View>

        {/* Attached Image: natural aspect ratio, 4:5 max height cap, double-tap to like */}
        {imageUrl && (
          <PostImageItem
            imageUrl={imageUrl}
            colors={colors}
            radii={radii}
            onSingleTap={() => setViewerImageUri(imageUrl)}
            onDoubleTap={() => handleDoubleTapLike(item.id)}
          />
        )}

        {/* Post Engagement Actions */}
        <View style={styles.postActionRow}>
          {/* Animated Like Button with scale bounce and red state */}
          <LikeButton
            liked={item.liked_by_me}
            count={item.like_count}
            colors={colors}
            onPress={() => handleToggleLike(item.id)}
          />

          {/* Comment Count / Open Replies Sheet */}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleOpenPostComments(item)}
            accessibilityLabel="View comments on post"
          >
            <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {item.comment_count}
            </Text>
          </TouchableOpacity>

          {/* Share / Copy Post Button */}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleSharePost(item)}
            accessibilityLabel="Share post"
          >
            <Ionicons name="share-outline" size={17} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Assignment Submissions indicator (if assignment) */}
          {item.type === 'assignment' && (
            <View style={styles.actionButton}>
              <Ionicons name="document-text-outline" size={17} color={colors.textMuted} />
              <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
                {item.submission_count} submissions
              </Text>
            </View>
          )}
        </View>
      </View>
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
                {file.uploaderAvatar ? (
                  <Image
                    source={{ uri: getFullImageUrl(file.uploaderAvatar) || file.uploaderAvatar }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <Text variant="sm" weight="700" color="primary">
                    {(file.uploaderName || 'S').charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
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
          <Caption color="muted">You're all caught up! ✨</Caption>
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Fixed / Pinned Brand Header (stays visible while feed scrolls) */}
      {renderBrandHeader()}

      <FlatList
        data={filteredFeedItems}
        keyExtractor={(item) => (item.feedType === 'post' ? `post-${item.post.id}` : `file-${item.file.id}`)}
        renderItem={renderFeedItem}
        ListHeaderComponent={renderFeedHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.container}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.modalBackdrop, { backgroundColor: colors.background }]}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Modal Header */}
            <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => setComposerOpen(false)}
                disabled={submittingPost}
                style={{ padding: 4 }}
              >
                <Text variant="sm" color="secondary">Cancel</Text>
              </TouchableOpacity>

              <Text variant="md" weight="700" color="primary">Create Post</Text>

              <Button
                title={submittingPost ? 'Posting...' : 'Post'}
                size="sm"
                variant="primary"
                loading={submittingPost}
                disabled={!postContent.trim() || submittingPost}
                onPress={handlePublishPost}
                style={{ minWidth: 68 }}
              />
            </View>

            <ScrollView
              style={{ flex: 1, padding: spacing.md }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Author & Post Type Row */}
              <View style={styles.modalAuthorRow}>
                <View
                  style={[
                    styles.authorAvatar,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radii.full,
                    },
                  ]}
                >
                  <Text variant="sm" weight="700" color="primary">
                    {(user?.name || 'S').charAt(0).toUpperCase()}
                  </Text>
                </View>

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

              {/* Attached Image Preview */}
              {selectedImageUri && (
                <View
                  style={[
                    styles.attachedPreviewContainer,
                    {
                      borderColor: colors.border,
                      borderRadius: radii.md,
                      backgroundColor: colors.surfaceRaised,
                      marginTop: spacing.sm,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: selectedImageUri }}
                    style={styles.attachedPreviewImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <TouchableOpacity
                    onPress={() => setSelectedImageUri(null)}
                    style={[styles.removeImageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityLabel="Remove attached image"
                  >
                    <Ionicons name="close" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Attachments Toolbar */}
              <View style={[styles.modalToolbar, { borderTopColor: colors.border, marginTop: spacing.lg }]}>
                <TouchableOpacity
                  onPress={handlePickImage}
                  style={[
                    styles.attachPhotoBtn,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Ionicons name="image-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                  <Text variant="xs" weight="600" color="primary">
                    {selectedImageUri ? 'Change Photo' : 'Attach Photo'}
                  </Text>
                </TouchableOpacity>

                {selectedImageUri && (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedImageUri(null);
                      setSelectedImageAsset(null);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Text variant="xs" color="secondary">
                      Remove
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Shared Full-Screen Zoomable Image Viewer Component (Requirement 4) */}
      <FullScreenImageViewer
        visible={viewerImageUri !== null}
        imageUri={viewerImageUri}
        onClose={() => setViewerImageUri(null)}
      />

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

              {/* Option 3: Delete Post (Conditional) */}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                    No replies yet
                  </Text>
                  <Caption color="muted" style={{ marginTop: 4 }}>
                    Be the first to join the conversation!
                  </Caption>
                </View>
              ) : (
                postComments.map((comment) => (
                  <View
                    key={comment.id}
                    style={{
                      flexDirection: 'row',
                      marginBottom: spacing.md,
                      backgroundColor: colors.surfaceRaised,
                      padding: spacing.md,
                      borderRadius: radii.lg,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    {/* Commenter Avatar (tappable to profile) */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        setCommentsModalOpen(false);
                        const sid = comment.studentId || comment.userId;
                        if (sid) {
                          router.push({
                            pathname: '/user/[id]',
                            params: { id: sid },
                          });
                        }
                      }}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        backgroundColor: colors.surfaceSubtle,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        marginRight: spacing.sm,
                      }}
                    >
                      {comment.avatarUrl ? (
                        <Image
                          source={{ uri: getFullImageUrl(comment.avatarUrl) || comment.avatarUrl }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                        />
                      ) : (
                        <Text variant="xs" weight="700" color="primary">
                          {(comment.name || 'S').charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => {
                            setCommentsModalOpen(false);
                            const sid = comment.studentId || comment.userId;
                            if (sid) {
                              router.push({
                                pathname: '/user/[id]',
                                params: { id: sid },
                              });
                            }
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        >
                          <Text variant="xs" weight="700">
                            {comment.name || 'Classmate'}
                          </Text>
                          {comment.role && comment.role !== 'student' && (
                            <View
                              style={{
                                backgroundColor: colors.surfaceSubtle,
                                paddingHorizontal: 4,
                                paddingVertical: 1,
                                borderRadius: 3,
                              }}
                            >
                              <Text variant="xs" weight="700" color="accent" style={{ fontSize: 9 }}>
                                {comment.role.toUpperCase()}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>

                        {comment.canDelete && (
                          <TouchableOpacity
                            onPress={() => handleDeletePostComment(comment.id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={14} color={colors.error} />
                          </TouchableOpacity>
                        )}
                      </View>

                      <Text variant="sm" style={{ marginTop: 4, lineHeight: 20 }}>
                        {comment.content}
                      </Text>
                      <Caption color="muted" style={{ marginTop: 4, fontSize: 10 }}>
                        {formatRelativeTime(comment.createdAt)}
                      </Caption>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Comment Composer Input Bar */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: colors.surface,
                gap: spacing.sm,
              }}
            >
              <TextInput
                placeholder="Write a reply..."
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
                onPress={handleAddPostComment}
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
                    name="send"
                    size={18}
                    color={commentInput.trim() ? '#FFFFFF' : colors.textMuted}
                  />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
      {/* Upload Note Modal */}
      <UploadNoteModal
        visible={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploadSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['feed-files'] });
          showToast('Note uploaded successfully!');
        }}
      />
    </SafeAreaView>
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
