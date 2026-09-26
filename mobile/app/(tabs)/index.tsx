import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
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
  Post,
  LibraryFile,
} from '@/services/posts';
import { getBaseUrl } from '@/services/api';

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

function formatLastUpdated(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}h ago`;
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

  useEffect(() => {
    let isMounted = true;
    if (!imageUrl) return;

    Image.getSize(
      imageUrl,
      (width, height) => {
        if (isMounted && width > 0 && height > 0) {
          const naturalRatio = width / height;
          // Clamp height at 4:5 aspect ratio (0.8) maximum
          setAspectRatio(Math.max(naturalRatio, 0.8));
        }
      },
      () => {
        if (isMounted) setAspectRatio(16 / 9);
      }
    );

    return () => {
      isMounted = false;
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, [imageUrl]);

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
        resizeMode="cover"
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

  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
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

  // Create Post Composer states
  const [composerOpen, setComposerOpen] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postType, setPostType] = useState<'status' | 'notice' | 'assignment'>('status');
  const [isOfficialNotice, setIsOfficialNotice] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Full-screen image viewer states
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [savingViewerImage, setSavingViewerImage] = useState(false);
  const [sharingViewerImage, setSharingViewerImage] = useState(false);

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

  const fetchInitialData = useCallback(async () => {
    setError(null);
    try {
      const [postsRes, filesRes] = await Promise.all([
        getPosts(null, 20),
        getFeedFiles(),
      ]);
      setPosts(postsRes.posts);
      setFiles(filesRes);
      setNextCursor(postsRes.nextCursor);
      setLastFetchedAt(new Date());
    } catch (err: any) {
      setError(err.message || 'Error loading dashboard feed.');
    } finally {
      setLoadingInitial(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInitialData();
  };

  const handleLoadMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);

    try {
      const res = await getPosts(nextCursor, 20);
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newPosts = res.posts.filter((p) => !existingIds.has(p.id));
        return [...prev, ...newPosts];
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
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: result.liked_by_me ?? result.liked,
                like_count: result.like_count ?? result.likeCount,
              }
            : p
        )
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
      });

      setPosts((prev) => [newPost, ...prev]);
      setLastFetchedAt(new Date());

      setPostContent('');
      setSelectedImageUri(null);
      setPostType('status');
      setIsOfficialNotice(false);
      setComposerOpen(false);
    } catch (err: any) {
      setComposerError(err.message || 'Could not publish your post. Please try again.');
    } finally {
      setSubmittingPost(false);
    }
  };

  // Full-screen viewer: Save image to photo library
  const handleSaveViewerImage = async () => {
    if (!viewerImageUri || savingViewerImage) return;
    setSavingViewerImage(true);

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Photo library access is needed to save images to your device.'
        );
        return;
      }

      let localUri = viewerImageUri;
      if (viewerImageUri.startsWith('http://') || viewerImageUri.startsWith('https://')) {
        const cleanName = (viewerImageUri.split('/').pop() || 'photo.jpg').split('?')[0];
        const targetPath = `${FileSystem.cacheDirectory}save_${Date.now()}_${cleanName}`;
        const downloadRes = await FileSystem.downloadAsync(viewerImageUri, targetPath);
        localUri = downloadRes.uri;
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved to Photos', 'Image saved successfully to your photo library.');
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save the image.');
    } finally {
      setSavingViewerImage(false);
    }
  };

  // Full-screen viewer: Share image via native share sheet
  const handleShareViewerImage = async () => {
    if (!viewerImageUri || sharingViewerImage) return;
    setSharingViewerImage(true);

    try {
      let localUri = viewerImageUri;
      if (viewerImageUri.startsWith('http://') || viewerImageUri.startsWith('https://')) {
        const cleanName = (viewerImageUri.split('/').pop() || 'photo.jpg').split('?')[0];
        const targetPath = `${FileSystem.cacheDirectory}share_${Date.now()}_${cleanName}`;
        const downloadRes = await FileSystem.downloadAsync(viewerImageUri, targetPath);
        localUri = downloadRes.uri;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localUri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Share Image',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      Alert.alert('Share Failed', err.message || 'Could not open share sheet.');
    } finally {
      setSharingViewerImage(false);
    }
  };

  const getFullImageUrl = (attachmentUrl: string | null): string | null => {
    if (!attachmentUrl) return null;
    if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
      return attachmentUrl;
    }
    return `${baseUrl}${attachmentUrl.startsWith('/') ? '' : '/'}${attachmentUrl}`;
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

            try {
              await deletePost(postId);
              showToast('Post deleted');
            } catch (err: any) {
              setPosts(prevPosts);
              Alert.alert('Delete Failed', err.message || 'Could not delete the post.');
            } finally {
              setDeletingPostId(null);
            }
          },
        },
      ]
    );
  };

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
          onPress={() => router.push('/(tabs)/library')}
          style={[
            styles.headerActionBtn,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          accessibilityLabel="Search library materials"
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
          <Text variant="xs" weight="700" color="primary">
            {(user?.name || 'S').charAt(0).toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFeedHeader = () => (
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
              },
            ]}
          >
            <Text variant="sm" weight="700" color="primary">
              {(user?.name || 'S').charAt(0).toUpperCase()}
            </Text>
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
              {(item.name || 'U').charAt(0).toUpperCase()}
            </Text>
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

          {/* Comment Count */}
          <View style={styles.actionButton}>
            <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {item.comment_count}
            </Text>
          </View>

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
          onPress={() => router.push(`/material/${file.id}` as any)}
        >
          {/* Author / Uploader Row */}
          <View style={styles.postAuthorRow}>
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
                {(file.uploaderName || 'S').charAt(0).toUpperCase()}
              </Text>
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
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: spacing.md }}>
            Loading campus feed...
          </Text>
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
          <Button title="Retry Feed" variant="secondary" size="md" onPress={fetchInitialData} />
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
        data={feedItems}
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
                    resizeMode="cover"
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
                    onPress={() => setSelectedImageUri(null)}
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

      {/* Full-Screen Zoomable Image Viewer Modal with Save & Share action row */}
      <Modal
        visible={viewerImageUri !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewerImageUri(null)}
        statusBarTranslucent
      >
        <View style={styles.viewerBackdrop}>
          <SafeAreaView style={styles.viewerSafeArea} edges={['top', 'bottom']}>
            {/* Top Action Bar with Share, Save, and Close */}
            <View style={styles.viewerHeader}>
              <View style={styles.viewerActionGroup}>
                {/* Share Button */}
                <TouchableOpacity
                  onPress={handleShareViewerImage}
                  disabled={sharingViewerImage}
                  style={styles.viewerActionBtn}
                  accessibilityLabel="Share image"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {sharingViewerImage ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="share-outline" size={18} color="#FFFFFF" />
                      <Text variant="xs" weight="600" style={{ color: '#FFFFFF', marginLeft: 5 }}>
                        Share
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Save to Photos Button */}
                <TouchableOpacity
                  onPress={handleSaveViewerImage}
                  disabled={savingViewerImage}
                  style={styles.viewerActionBtn}
                  accessibilityLabel="Save image to photos"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {savingViewerImage ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                      <Text variant="xs" weight="600" style={{ color: '#FFFFFF', marginLeft: 5 }}>
                        Save
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Close Button */}
              <TouchableOpacity
                onPress={() => setViewerImageUri(null)}
                style={styles.viewerCloseBtn}
                accessibilityLabel="Close image viewer"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Pinch-to-zoom ScrollView Container */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.viewerZoomContainer}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
            >
              {viewerImageUri && (
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={() => setViewerImageUri(null)}
                  style={styles.viewerImageWrapper}
                >
                  <Image
                    source={{ uri: viewerImageUri }}
                    style={styles.viewerFullImage}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Viewer Footer hint */}
            <View style={styles.viewerFooter}>
              <Caption color="muted" style={{ color: '#A3A3A3' }}>
                Pinch to zoom • Double-tap post image to like
              </Caption>
            </View>
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
