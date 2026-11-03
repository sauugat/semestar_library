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
  type TextInputInstance,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { AdminDashboardView } from '@/components/admin/AdminDashboardView';
import { UnrecognizedRoleView } from '@/components/admin/UnrecognizedRoleView';
import { resolveAppRole } from '@/utils/roles';
import { useAdminMode } from '@/context/AdminModeContext';
import { useAdaptiveNavScroll } from '@/context/NavScrollContext';
import * as Notifications from 'expo-notifications';
import {
  fetchUnseenCount,
  fetchInAppNotifications,
  subscribeToRealtimeNotifications,
} from '@/services/notifications';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/context/AuthContext';
import { useAcademicContext } from '@/hooks/useAcademicContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { SelectionSheet, SelectionOption, SemesterMultiSelectSheet } from '@/components/ui';
import { formatTimeAgo } from '@/utils/date';
import {
  getPosts,
  getFeedFiles,
  toggleLike,
  votePost,
  toggleFileLike,
  voteFile,
  voteAssignment,
  getFileComments,
  addFileComment,
  editFileComment,
  toggleFileCommentReaction,
  deleteFileComment,
  getAssignmentComments,
  addAssignmentComment,
  editAssignmentComment,
  toggleAssignmentCommentReaction,
  deleteAssignmentComment,
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
  FileComment,
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
import { CommentsBottomSheetModal } from '@/components/CommentsBottomSheetModal';
import { PostCard, VoteButtons } from '@/components/PostCard';
import { SponsoredAdCard } from '@/components/SponsoredAdCard';
import {
  Advertisement,
  interleaveFeedWithAds,
  getEligibleAdvertisements,
  createAdvertisement,
  getFeedSessionKey,
} from '@/services/advertisements';
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

export type FeedItem =
  | { feedType: 'assignment'; assignment: FeedAssignment; time: number }
  | { feedType: 'post'; post: Post; time: number }
  | { feedType: 'file'; file: LibraryFile; time: number }
  | { feedType: 'advertisement'; advertisement: Advertisement; time: number };

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

const CATEGORY_OPTIONS: SelectionOption<string>[] = [
  { id: 'notice', label: 'Notice' },
  { id: 'general', label: 'General' },
  { id: 'announcement', label: 'Announcement' },
  { id: 'news', label: 'News' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'feedback', label: 'Feedback' },
];

const AUDIENCE_OPTIONS: SelectionOption<'everyone' | 'students_only'>[] = [
  {
    id: 'everyone',
    label: 'Everyone',
    sublabel: 'Visible to students, CRs, teachers, and university officials',
  },
  {
    id: 'students_only',
    label: 'Students Only',
    sublabel: "Won't appear in teacher or university staff feeds",
  },
];

const CATEGORY_DISPLAY_MAP: Record<string, string> = {
  notice: 'Notice',
  general: 'General',
  announcement: 'Announcement',
  news: 'News',
  complaints: 'Complaints',
  feedback: 'Feedback',
};

const FEED_CATEGORY_FILTERS = [
  { id: 'all', label: 'All Posts' },
  { id: 'general', label: 'General' },
  { id: 'notice', label: 'Notices' },
  { id: 'announcement', label: 'Announcements' },
  { id: 'news', label: 'News' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'feedback', label: 'Feedback' },
];



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

function StudentHomeScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { displayLabel } = useAcademicContext();
  const { isAdmin, setAdminMode } = useAdminMode();
  const isStaff = Boolean(isAdmin || user?.isAdmin || user?.role === 'teacher' || user?.role === 'admin');
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const feedRef = useRef<FlatList<FeedItem>>(null);
  const { onScroll: handleNavScroll, scrollEventThrottle } = useAdaptiveNavScroll();
  const swipeStart = useRef({ x: 0, y: 0, time: 0, valid: false });
  const [assignments, setAssignments] = useState<FeedAssignment[]>([]);

  const [unseenNotifCount, setUnseenNotifCount] = useState(0);
  const lastAnnouncedCountRef = useRef<number>(0);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notifBubble, setNotifBubble] = useState<{
    visible: boolean;
    likeCount: number;
    commentCount: number;
    otherCount: number;
    avatarUrl: string | null;
    actorName: string | null;
  }>({
    visible: false,
    likeCount: 0,
    commentCount: 0,
    otherCount: 0,
    avatarUrl: null,
    actorName: null,
  });

  const notifPopScale = useRef(new Animated.Value(0)).current;
  const notifPopTranslateY = useRef(new Animated.Value(-8)).current;
  const bellShakeAnim = useRef(new Animated.Value(0)).current;
  const floatHeartOpacity = useRef(new Animated.Value(0)).current;
  const floatHeartTranslateY = useRef(new Animated.Value(0)).current;
  const floatHeartScale = useRef(new Animated.Value(0.4)).current;

  const triggerNotifActivityPop = useCallback(
    (payload: {
      likeCount: number;
      commentCount: number;
      otherCount: number;
      avatarUrl: string | null;
      actorName: string | null;
    }) => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current);
      }

      setNotifBubble({
        visible: true,
        ...payload,
      });

      notifPopScale.setValue(0.4);
      notifPopTranslateY.setValue(-8);
      bellShakeAnim.setValue(0);

      // Bell icon shake + Instagram-style spring pop
      Animated.parallel([
        Animated.sequence([
          Animated.timing(bellShakeAnim, { toValue: 1, duration: 70, useNativeDriver: true }),
          Animated.timing(bellShakeAnim, { toValue: -1, duration: 70, useNativeDriver: true }),
          Animated.timing(bellShakeAnim, { toValue: 0.7, duration: 65, useNativeDriver: true }),
          Animated.timing(bellShakeAnim, { toValue: -0.7, duration: 65, useNativeDriver: true }),
          Animated.timing(bellShakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
        ]),
        Animated.spring(notifPopScale, {
          toValue: 1,
          friction: 5,
          tension: 130,
          useNativeDriver: true,
        }),
        Animated.spring(notifPopTranslateY, {
          toValue: 0,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();

      // Floating love heart burst when a like notification arrives
      if (payload.likeCount > 0) {
        floatHeartOpacity.setValue(1);
        floatHeartTranslateY.setValue(0);
        floatHeartScale.setValue(0.5);
        Animated.parallel([
          Animated.spring(floatHeartScale, {
            toValue: 1.25,
            friction: 4,
            tension: 110,
            useNativeDriver: true,
          }),
          Animated.timing(floatHeartTranslateY, {
            toValue: -26,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(floatHeartOpacity, {
            toValue: 0,
            duration: 900,
            delay: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }

      bubbleTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(notifPopScale, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(notifPopTranslateY, {
            toValue: -6,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setNotifBubble((prev) => ({ ...prev, visible: false }));
        });
      }, 4200);
    },
    [bellShakeAnim, floatHeartOpacity, floatHeartScale, floatHeartTranslateY, notifPopScale, notifPopTranslateY]
  );

  const inspectLatestUnseenAndPop = useCallback(
    async (activityHint?: string) => {
      try {
        const inbox = await fetchInAppNotifications({ tab: 'all', limit: 10 });
        const unseenCount = Number(inbox.unseenCount || 0);
        setUnseenNotifCount(unseenCount);

        const unseenItems = (inbox.notifications || []).filter((n) => !n.isSeen || !n.isRead);
        if (unseenCount > 0 && (unseenCount > lastAnnouncedCountRef.current || activityHint)) {
          lastAnnouncedCountRef.current = unseenCount;
          let likes = 0;
          let comments = 0;
          let others = 0;
          let latestAvatar: string | null = null;
          let latestActorName: string | null = null;

          const sourceList = unseenItems.length > 0 ? unseenItems : inbox.notifications.slice(0, 1);
          for (const item of sourceList) {
            if (!latestAvatar) {
              latestAvatar =
                item.actor?.avatarUrl ||
                item.metadata?.actorAvatar ||
                item.metadata?.actors?.[0]?.avatarUrl ||
                null;
            }
            if (!latestActorName && item.actor?.name) {
              latestActorName = item.actor.name;
            }
            if (item.type === 'post_reaction' || item.type === 'comment_reaction') {
              likes += Number(item.metadata?.totalCount || 1);
            } else if (item.type === 'post_comment' || item.type === 'comment_reply') {
              comments += 1;
            } else {
              others += 1;
            }
          }

          if (likes === 0 && comments === 0 && activityHint) {
            if (activityHint === 'post_reaction' || activityHint === 'comment_reaction') likes = 1;
            else if (activityHint === 'post_comment' || activityHint === 'comment_reply') comments = 1;
            else others = Math.max(1, unseenCount);
          }

          triggerNotifActivityPop({
            likeCount: likes,
            commentCount: comments,
            otherCount: others,
            avatarUrl: latestAvatar,
            actorName: latestActorName,
          });
        } else if (unseenCount === 0) {
          lastAnnouncedCountRef.current = 0;
        }
      } catch {
        const count = await fetchUnseenCount();
        setUnseenNotifCount(count);
      }
    },
    [triggerNotifActivityPop]
  );

  const refreshUnseenCount = useCallback(() => {
    if (!token) return;
    void inspectLatestUnseenAndPop();
  }, [token, inspectLatestUnseenAndPop]);

  useFocusEffect(
    useCallback(() => {
      refreshUnseenCount();
    }, [refreshUnseenCount])
  );

  // Instant real-time notification listener (SSE stream + foreground Expo push listener)
  useEffect(() => {
    if (!token) return;

    const unsubscribeSse = subscribeToRealtimeNotifications((ev) => {
      if (ev.type === 'badge_update' && typeof ev.unseenCount === 'number') {
        setUnseenNotifCount(ev.unseenCount);
        if (ev.unseenCount === 0) {
          lastAnnouncedCountRef.current = 0;
        }
      } else if (ev.type === 'notification') {
        if (typeof ev.unseenCount === 'number') {
          setUnseenNotifCount(ev.unseenCount);
        }
        void inspectLatestUnseenAndPop(ev.activityType);
      }
    });

    const pushReceivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data as Record<string, any> | undefined;
      void inspectLatestUnseenAndPop(data?.type);
    });

    return () => {
      unsubscribeSse();
      pushReceivedSub.remove();
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current);
      }
    };
  }, [token, inspectLatestUnseenAndPop]);

  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [eligibleAds, setEligibleAds] = useState<Advertisement[]>([]);
  const [feedSessionSeed] = useState<string>(() => getFeedSessionKey());
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

  // Fallback query for teacher assigned subjects if not present in cached auth profile
  const isTeacherUser = user?.role === 'teacher' || user?.role === 'faculty';
  const { data: fetchedTeacherSubjects } = useQuery({
    queryKey: ['teacher-feed-subjects', user?.studentId],
    queryFn: async () => {
      if (!isTeacherUser) return [];
      try {
        const res = await apiFetch('/api/teacher/subjects');
        if (res.ok) {
          const json = await res.json();
          return json.subjects || [];
        }
      } catch (_) {}
      return [];
    },
    enabled: Boolean(isTeacherUser && (!user?.subjects || user.subjects.length === 0)),
    staleTime: 5 * 60 * 1000,
  });

  // React Query: Feed caching with 45s staleTime (Campus Posts & Sponsored Ads only; Notes & Assignments live in Library)
  const {
    data: feedData,
    isLoading: isFeedLoading,
    error: feedQueryError,
    refetch: refetchFeed,
  } = useQuery({
    queryKey: ['campus-feed', user?.studentId],
    queryFn: async () => {
      const [postsRes, standaloneAds] = await Promise.all([
        getPosts(null, 20, undefined, undefined, { seed: feedSessionSeed }),
        getEligibleAdvertisements(feedSessionSeed).catch(() => [] as Advertisement[]),
      ]);
      const combinedAdsMap = new Map<number, Advertisement>();
      for (const ad of [
        ...(postsRes.eligibleAdvertisements || []),
        ...(postsRes.advertisements || []),
        ...(standaloneAds || []),
      ]) {
        if (ad && ad.id && !combinedAdsMap.has(Number(ad.id))) {
          combinedAdsMap.set(Number(ad.id), ad);
        }
      }
      return {
        posts: postsRes.posts,
        files: [] as LibraryFile[],
        assignments: [] as FeedAssignment[],
        eligibleAdvertisements: Array.from(combinedAdsMap.values()),
        nextCursor: postsRes.nextCursor,
        fetchedAt: new Date(),
      };
    },
    staleTime: 45 * 1000,
    retry: 1,
  });

  // Sync state whenever fresh or cached feedData arrives
  useEffect(() => {
    if (feedData) {
      setPosts(feedData.posts);
      setFiles([]);
      setAssignments([]);
      setEligibleAds((feedData as any).eligibleAdvertisements || []);
      setNextCursor(feedData.nextCursor);
      setLastFetchedAt(feedData.fetchedAt);
    }
  }, [feedData]);

  const loadingInitial = isFeedLoading && !feedData;
  const error = feedQueryError ? (feedQueryError as any).message || 'Error loading dashboard feed.' : null;

  // Horizontal feed category filter state
  const [feedCategoryFilter, setFeedCategoryFilter] = useState<string>('all');

  // Campus feed items (strictly social/campus posts & ads — notes and assignment posts are displayed in the Library tab)
  const feedItems = useMemo<FeedItem[]>(() => {
    const nonAssignmentPosts = posts.filter(
      (p) => (p.type || '').toLowerCase() !== 'assignment' && (p.category || '').toLowerCase() !== 'assignment'
    );

    const visiblePosts = feedCategoryFilter === 'all'
      ? nonAssignmentPosts
      : nonAssignmentPosts.filter((p) => (p.category || 'general').toLowerCase() === feedCategoryFilter.toLowerCase());

    const postItems: FeedItem[] = visiblePosts.map((p) => ({
      feedType: 'post',
      post: p,
      time: new Date(p.created_at).getTime() || 0,
    }));

    const organicSorted = [...postItems].sort((a, b) => {
      if (b.time !== a.time) return b.time - a.time;
      return (b as any).post.id - (a as any).post.id;
    });

    return interleaveFeedWithAds(organicSorted, eligibleAds, { seed: feedSessionSeed });
  }, [posts, eligibleAds, feedSessionSeed, feedCategoryFilter]);

  // Unified Comments bottom-sheet state (supports Posts/Notices, Notes/Files, and Assignments)
  const [activeCommentPost, setActiveCommentPost] = useState<Post | null>(null);
  const [activeCommentKind, setActiveCommentKind] = useState<'post' | 'file' | 'assignment'>('post');
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

  const handleOpenPostComments = async (post: Post) => {
    setActiveCommentKind('post');
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
    // If replying to a nested reply, attach under its parent root comment
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

  const handleSubmitPostComment = async () => {
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
        setFiles((prev) =>
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
        setAssignments((prev) =>
          prev.map((a) =>
            Number(a.id) === Number(activeCommentPost.id) ? { ...a, commentCount: updatedCount } : a
          )
        );
        showToast(wasReply ? 'Reply posted' : 'Comment posted');
        return;
      }

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
          const targetParentId = res.comment.parentCommentId || commentReplyingTo.commentId;
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
      const res =
        activeCommentKind === 'file'
          ? await toggleFileCommentReaction(activeCommentPost.id, comment.id)
          : activeCommentKind === 'assignment'
          ? await toggleAssignmentCommentReaction(activeCommentPost.id, comment.id)
          : await toggleCommentReaction(activeCommentPost.id, comment.id);
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
            const removeCommentFromTree = (list: PostComment[], targetId: number): PostComment[] =>
              list
                .map((root) => {
                  if (root.id === targetId) {
                    return null;
                  }
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
              setFiles((prev) =>
                prev.map((f) =>
                  Number(f.id) === Number(activeCommentPost.id) ? { ...f, commentCount: updatedCount } : f
                )
              );
              showToast('Comment deleted');
              return;
            }
            if (activeCommentKind === 'assignment') {
              const res = await deleteAssignmentComment(activeCommentPost.id, comment.id);
              setPostComments((prev) => removeCommentFromTree(prev, comment.id));
              const updatedCount = res.commentCount ?? Math.max(0, activeCommentPost.comment_count - 1);
              setActiveCommentPost((prev) => (prev ? { ...prev, comment_count: updatedCount } : null));
              setAssignments((prev) =>
                prev.map((a) =>
                  Number(a.id) === Number(activeCommentPost.id) ? { ...a, commentCount: updatedCount } : a
                )
              );
              showToast('Comment deleted');
              return;
            }
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

  // Create Post Composer states (supports Regular Post & Admin Advertisement modes)
  const [composerOpen, setComposerOpen] = useState(false);
  const [publishingMode, setPublishingMode] = useState<'post' | 'advertisement'>('post');
  const [adAdvertiserName, setAdAdvertiserName] = useState('');
  const [adPrimaryText, setAdPrimaryText] = useState('');
  const [adHeadline, setAdHeadline] = useState('');
  const [adDescription, setAdDescription] = useState('');
  const [adCtaLabel, setAdCtaLabel] = useState('Learn More');
  const [adDestinationUrl, setAdDestinationUrl] = useState('');
  const [adIsActive, setAdIsActive] = useState(true);
  const [adStartDate, setAdStartDate] = useState('');
  const [adEndDate, setAdEndDate] = useState('');
  const [adCreativeAsset, setAdCreativeAsset] = useState<any | null>(null);
  const [adLogoAsset, setAdLogoAsset] = useState<any | null>(null);
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [postCategory, setPostCategory] = useState<string>('general');
  const [postAudience, setPostAudience] = useState<'everyone' | 'students_only'>('everyone');
  const [postAllSemesters, setPostAllSemesters] = useState(true);
  const [postTargetSemesters, setPostTargetSemesters] = useState<number[]>([]);
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [audienceSheetVisible, setAudienceSheetVisible] = useState(false);
  const [semesterSheetVisible, setSemesterSheetVisible] = useState(false);
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

  const userRole = (user?.role || '').toLowerCase();
  const isPrivileged = ['admin', 'cr', 'teacher'].includes(userRole);
  const canSelectAudience = ['student', 'cr'].includes(userRole) || (!['admin', 'teacher'].includes(userRole));
  const canPostNotice = ['admin', 'cr', 'teacher'].includes(userRole);

  const availableCategoryOptions = useMemo(() => {
    return canPostNotice
      ? CATEGORY_OPTIONS
      : CATEGORY_OPTIONS.filter((c) => c.id !== 'notice');
  }, [canPostNotice]);

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
      const res = await getPosts(nextCursor, 20, undefined, undefined, { seed: feedSessionSeed });
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
  const handleToggleLike = async (postId: number, direction: 'up' | 'down' = 'up') => {
    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    const prevUp = Number(targetPost.up_count ?? targetPost.upCount ?? targetPost.like_count ?? 0);
    const prevDown = Number(targetPost.down_count ?? targetPost.downCount ?? 0);
    const prevVote = Number(targetPost.my_vote ?? targetPost.myVote ?? (targetPost.liked_by_me ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              up_count: nextUp,
              down_count: nextDown,
              my_vote: nextVote,
              upCount: nextUp,
              downCount: nextDown,
              myVote: nextVote,
              liked_by_me: nextVote === 1,
              like_count: nextUp,
            }
          : p
      )
    );

    try {
      const result = await votePost(postId, direction);
      const finalUp = Number(result.up_count ?? result.upCount ?? result.like_count ?? nextUp);
      const finalDown = Number(result.down_count ?? result.downCount ?? nextDown);
      const finalVote = Number(result.my_vote ?? result.myVote ?? nextVote);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                up_count: finalUp,
                down_count: finalDown,
                my_vote: finalVote,
                upCount: finalUp,
                downCount: finalDown,
                myVote: finalVote,
                liked_by_me: finalVote === 1,
                like_count: finalUp,
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
                      up_count: finalUp,
                      down_count: finalDown,
                      my_vote: finalVote,
                      upCount: finalUp,
                      downCount: finalDown,
                      myVote: finalVote,
                      liked_by_me: finalVote === 1,
                      like_count: finalUp,
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
                up_count: prevUp,
                down_count: prevDown,
                my_vote: prevVote,
                upCount: prevUp,
                downCount: prevDown,
                myVote: prevVote,
                liked_by_me: prevVote === 1,
                like_count: prevUp,
              }
            : p
        )
      );
      Alert.alert('Action Failed', err.message || 'Could not update vote.');
    }
  };

  const handleToggleFileLike = async (fileId: number, direction: 'up' | 'down' = 'up') => {
    const numFileId = Number(fileId);
    const targetFile = files.find((f) => Number(f.id) === numFileId);
    if (!targetFile) return;

    const prevUp = Number(targetFile.upCount ?? targetFile.up_count ?? targetFile.likeCount ?? 0);
    const prevDown = Number(targetFile.downCount ?? targetFile.down_count ?? 0);
    const prevVote = Number(targetFile.myVote ?? targetFile.my_vote ?? (targetFile.liked ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    setFiles((prev) =>
      prev.map((f) =>
        Number(f.id) === numFileId
          ? {
              ...f,
              upCount: nextUp,
              downCount: nextDown,
              myVote: nextVote,
              up_count: nextUp,
              down_count: nextDown,
              my_vote: nextVote,
              liked: nextVote === 1,
              likeCount: nextUp,
            }
          : f
      )
    );

    try {
      const result = await voteFile(numFileId, direction);
      setFiles((prev) =>
        prev.map((f) =>
          Number(f.id) === numFileId
            ? {
                ...f,
                upCount: result.upCount,
                downCount: result.downCount,
                myVote: result.myVote,
                up_count: result.upCount,
                down_count: result.downCount,
                my_vote: result.myVote,
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
              files: (old.files || []).map((f: LibraryFile) =>
                Number(f.id) === numFileId
                  ? {
                      ...f,
                      upCount: result.upCount,
                      downCount: result.downCount,
                      myVote: result.myVote,
                      up_count: result.upCount,
                      down_count: result.downCount,
                      my_vote: result.myVote,
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
          Number(f.id) === numFileId
            ? {
                ...f,
                upCount: prevUp,
                downCount: prevDown,
                myVote: prevVote,
                up_count: prevUp,
                down_count: prevDown,
                my_vote: prevVote,
                liked: prevVote === 1,
                likeCount: prevUp,
              }
            : f
        )
      );
      showToast(err.message || 'Could not update vote.');
    }
  };

  const handleToggleAssignmentVote = async (assignmentId: number, direction: 'up' | 'down' = 'up') => {
    const numAssignmentId = Number(assignmentId);
    const target = assignments.find((a) => Number(a.id) === numAssignmentId);
    if (!target) return;

    const prevUp = Number(target.upCount ?? target.likeCount ?? 0);
    const prevDown = Number(target.downCount ?? 0);
    const prevVote = Number(target.myVote ?? (target.liked ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    setAssignments((prev) =>
      prev.map((a) =>
        Number(a.id) === numAssignmentId
          ? {
              ...a,
              upCount: nextUp,
              downCount: nextDown,
              myVote: nextVote,
              liked: nextVote === 1,
              likeCount: nextUp,
            }
          : a
      )
    );

    try {
      const result = await voteAssignment(numAssignmentId, direction);
      setAssignments((prev) =>
        prev.map((a) =>
          Number(a.id) === numAssignmentId
            ? {
                ...a,
                upCount: result.upCount,
                downCount: result.downCount,
                myVote: result.myVote,
                liked: result.liked,
                likeCount: result.likeCount,
              }
            : a
        )
      );
      queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
        old
          ? {
              ...old,
              assignments: (old.assignments || []).map((a: FeedAssignment) =>
                Number(a.id) === numAssignmentId
                  ? {
                      ...a,
                      upCount: result.upCount,
                      downCount: result.downCount,
                      myVote: result.myVote,
                      liked: result.liked,
                      likeCount: result.likeCount,
                    }
                  : a
              ),
            }
          : old
      );
    } catch (err: any) {
      setAssignments((prev) =>
        prev.map((a) =>
          Number(a.id) === numAssignmentId
            ? {
                ...a,
                upCount: prevUp,
                downCount: prevDown,
                myVote: prevVote,
                liked: prevVote === 1,
                likeCount: prevUp,
              }
            : a
        )
      );
      showToast(err.message || 'Could not update vote.');
    }
  };

  // Called on double-tap: ensure upvote is triggered if not already upvoted
  const handleDoubleTapLike = (postId: number) => {
    const target = posts.find((p) => p.id === postId);
    if (!target) return;
    const myVote = Number(target.my_vote ?? target.myVote ?? (target.liked_by_me ? 1 : 0));
    if (myVote !== 1) {
      void handleToggleLike(postId, 'up');
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

  const handlePickAdCreative = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      const resolvedMime = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
      setAdCreativeAsset({
        uri: a.uri,
        name: a.fileName || `ad_creative_${Date.now()}.${a.type === 'video' ? 'mp4' : 'jpg'}`,
        type: resolvedMime,
        mimeType: resolvedMime,
        size: a.fileSize,
      });
    }
  };

  const handlePickAdLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      const resolvedMime = a.mimeType || 'image/jpeg';
      setAdLogoAsset({
        uri: a.uri,
        name: a.fileName || `ad_logo_${Date.now()}.jpg`,
        type: resolvedMime,
        mimeType: resolvedMime,
        size: a.fileSize,
      });
    }
  };

  const handlePublishPost = async () => {
    if (publishingMode === 'advertisement') {
      if (userRole !== 'admin') {
        setComposerError('Only administrators can publish advertisements.');
        return;
      }
      if (!adAdvertiserName.trim()) {
        setComposerError('Advertiser / brand name is required.');
        return;
      }
      if (!adPrimaryText.trim()) {
        setComposerError('Primary advertisement text is required.');
        return;
      }
      if (!adCreativeAsset) {
        setComposerError('Please select an image or video creative.');
        return;
      }
      if (!adDestinationUrl.trim()) {
        setComposerError('Destination URL is required.');
        return;
      }
      setSubmittingPost(true);
      setComposerError(null);
      try {
        const createdAd = await createAdvertisement({
          advertiser_name: adAdvertiserName.trim(),
          primary_text: adPrimaryText.trim(),
          headline: adHeadline.trim() || null,
          description: adDescription.trim() || null,
          cta_label: adCtaLabel.trim() || 'Learn More',
          destination_url: adDestinationUrl.trim(),
          status: adIsActive ? 'active' : 'inactive',
          is_active: adIsActive,
          start_date: adStartDate.trim() || null,
          end_date: adEndDate.trim() || null,
          creativeFile: adCreativeAsset,
          logoFile: adLogoAsset,
        });
        if (createdAd && createdAd.is_active === 1) {
          setEligibleAds((prev) => [createdAd, ...prev]);
        }
        setAdAdvertiserName('');
        setAdPrimaryText('');
        setAdHeadline('');
        setAdDescription('');
        setAdCtaLabel('Learn More');
        setAdDestinationUrl('');
        setAdIsActive(true);
        setAdStartDate('');
        setAdEndDate('');
        setAdCreativeAsset(null);
        setAdLogoAsset(null);
        setPublishingMode('post');
        setComposerOpen(false);
        showToast('Advertisement published');
      } catch (err: any) {
        setComposerError(err.message || 'Could not publish advertisement.');
      } finally {
        setSubmittingPost(false);
      }
      return;
    }

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
        title: postCategory === 'general' ? undefined : (postTitle.trim() || undefined),
        content: postContent,
        category: postCategory,
        targetSemesters: postAllSemesters ? [] : postTargetSemesters,
        allSemesters: postAllSemesters,
        type: postCategory === 'notice' && canPostNotice ? 'notice' : (isPrivileged ? postType : 'status'),
        audience: canSelectAudience ? postAudience : 'everyone',
        visibility: canSelectAudience ? postAudience : 'everyone',
        official: postCategory === 'notice' && canPostNotice,
        attachments,
      });

      setPosts((prev) => [newPost, ...prev]);
      setLastFetchedAt(new Date());
      queryClient.setQueryData(['campus-feed', user?.studentId], (old: any) =>
        old ? { ...old, posts: [newPost, ...(old.posts || [])], fetchedAt: new Date() } : old
      );

      setPostTitle('');
      setPostContent('');
      setPostCategory('general');
      setPostAudience('everyone');
      setPostAllSemesters(true);
      setPostTargetSemesters([]);
      setComposerAttachments([]);
      setPostType('status');
      setComposerOpen(false);
    } catch (err: any) {
      setComposerError(err.message || 'Could not publish your post. Please try again.');
    } finally {
      setSubmittingPost(false);
    }
  };

  const getFullImageUrl = (attachmentUrl?: string | null): string | null => {
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
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <TouchableOpacity onPress={refreshFromTop} accessibilityLabel="Refresh home feed">
            <Text
              style={[
                styles.headerWordmark,
                { color: colors.text },
              ]}
            >
              Semester Library
            </Text>
          </TouchableOpacity>
          {false && isStaff && Boolean(displayLabel) && (
            <View style={[styles.academicBadge, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[styles.academicBadgeText, { color: colors.textSecondary }]} numberOfLines={1}>
                {displayLabel}
              </Text>
            </View>
          )}
          {false && isAdmin && (
            <TouchableOpacity
              onPress={() => void setAdminMode('admin')}
              style={{
                marginLeft: 8,
                backgroundColor: '#0f172a',
                borderColor: '#38bdf8',
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 8,
                paddingVertical: 3,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              accessibilityLabel="Switch to Admin Mode"
            >
              <Ionicons name="shield-checkmark" size={12} color="#38bdf8" style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#38bdf8' }}>Admin</Text>
            </TouchableOpacity>
          )}
        </View>

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

          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              onPress={() => {
                setNotifBubble((prev) => ({ ...prev, visible: false }));
                router.push('/notifications' as any);
              }}
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
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: bellShakeAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: ['-18deg', '18deg'],
                      }),
                    },
                  ],
                }}
              >
                <Ionicons
                  name={notifBubble.visible && notifBubble.likeCount > 0 ? 'heart' : 'notifications-outline'}
                  size={19}
                  color={notifBubble.visible && notifBubble.likeCount > 0 ? '#FF3040' : colors.text}
                />
              </Animated.View>
              {unseenNotifCount > 0 && (
                <View
                  style={[
                    styles.headerBellBadge,
                    { backgroundColor: notifBubble.likeCount > 0 ? '#FF3040' : colors.text },
                  ]}
                >
                  <Text
                    style={{
                      color: notifBubble.likeCount > 0 ? '#FFFFFF' : colors.surface,
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

            {/* Floating Love Heart Burst above Bell Icon */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -6,
                left: 8,
                opacity: floatHeartOpacity,
                transform: [
                  { translateY: floatHeartTranslateY },
                  { scale: floatHeartScale },
                ],
                zIndex: 100,
              }}
            >
              <Ionicons name="heart" size={20} color="#FF3040" />
            </Animated.View>

            {/* Instagram-Style Love & Comment Floating Activity Bubble */}
            {notifBubble.visible && (
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 42,
                  right: 0,
                  zIndex: 200,
                  transform: [
                    { scale: notifPopScale },
                    { translateY: notifPopTranslateY },
                  ],
                }}
              >
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setNotifBubble((prev) => ({ ...prev, visible: false }));
                    router.push('/notifications' as any);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#FF3040',
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    gap: 6,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.28,
                    shadowRadius: 8,
                    elevation: 8,
                  }}
                >
                  {/* Top pointer triangle */}
                  <View
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: 12,
                      width: 10,
                      height: 10,
                      backgroundColor: '#FF3040',
                      transform: [{ rotate: '45deg' }],
                    }}
                  />

                  {Boolean(notifBubble.avatarUrl) && (
                    <Image
                      source={{ uri: getFullImageUrl(notifBubble.avatarUrl) || notifBubble.avatarUrl! }}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 1,
                        borderColor: '#FFFFFF',
                      }}
                      contentFit="cover"
                    />
                  )}

                  {notifBubble.likeCount > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="heart" size={13} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>
                        {notifBubble.likeCount}
                      </Text>
                    </View>
                  )}

                  {notifBubble.commentCount > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="chatbubble" size={12} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>
                        {notifBubble.commentCount}
                      </Text>
                    </View>
                  )}

                  {notifBubble.likeCount === 0 && notifBubble.commentCount === 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="notifications" size={12} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>
                        {Math.max(1, notifBubble.otherCount)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
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
            onPress={() => router.push('/attendance' as any)}
            accessibilityRole="button"
            accessibilityLabel="Open Attendance"
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
              <Ionicons name="checkbox-outline" size={17} color={colors.primary} />
            </View>
            <Text variant="xs" weight="700" numberOfLines={1}>
              Attendance
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
            onPress={() => router.push('/syllabus' as any)}
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
              Syllabus
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
        onVote={handleToggleLike}
        onDoubleTapLike={handleDoubleTapLike}
        onShare={handleSharePost}
        onOpenDetail={(p) => {
          void handleOpenPostComments(p);
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

        {/* File Engagement Actions (Reddit-style Up/Down votes, Comments & Share) */}
        <View style={styles.postActionRow}>
          <VoteButtons
            upCount={Number(file.upCount ?? file.up_count ?? file.likeCount ?? 0)}
            downCount={Number(file.downCount ?? file.down_count ?? 0)}
            myVote={Number(file.myVote ?? file.my_vote ?? (file.liked ? 1 : 0))}
            colors={colors}
            onVote={(dir) => void handleToggleFileLike(file.id, dir)}
          />

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => void handleOpenFileComments(file)}
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

  // Render assignment uploaded card using the exact same template as note post (renderFileItem)
  const renderAssignmentItem = (a: FeedAssignment) => {
    const badgeExt = a.pdfUrl ? 'PDF' : (a.language ? a.language.toUpperCase() : 'LAB');
    const uploaderAvatarUrl = getFullImageUrl(a.avatarUrl || a.teacherAvatar || (a as any).avatar_url || null) || a.avatarUrl;
    const openAssignment = () => {
      router.push(`/assignments/${a.id}` as any);
    };

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
          onPress={openAssignment}
        >
          {/* Author / Uploader Row */}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="sm" weight="700" numberOfLines={1}>
                    {a.teacherName || 'Faculty Member'}
                  </Text>
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
                      TEACHER
                    </Text>
                  </View>
                </View>
                <Caption color="muted">
                  Uploaded {formatRelativeTime(a.createdAt)}
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
                ASSIGNMENT
              </Text>
            </View>
          </View>

          {/* Assignment Title, Description & Subject/Deadline tags */}
          <View style={{ marginTop: 10, marginBottom: 8 }}>
            {a.title ? (
              <Text weight="700" style={{ fontSize: 15, marginBottom: 6, lineHeight: 20 }}>
                {a.title}
              </Text>
            ) : null}

            {Boolean(a.description && a.description.trim()) ? (
              <Text variant="sm" color="secondary" numberOfLines={2} style={{ marginBottom: 6, lineHeight: 19 }}>
                {a.description}
              </Text>
            ) : null}

            {(a.subject || a.semester || a.deadline) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {a.subject ? (
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
                      {a.subject}
                    </Text>
                  </View>
                ) : null}
                {a.semester ? (
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
                      {String(a.semester).startsWith('Semester') ? a.semester : `Semester ${a.semester}`}
                    </Text>
                  </View>
                ) : null}
                {a.deadline ? (
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
                      Due {new Date(a.deadline).toLocaleDateString()}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Assignment Attachment Box - matching Note post attachment box */}
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
                {badgeExt}
              </Text>
            </View>

            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text variant="sm" weight="600" numberOfLines={1}>
                {a.pdfName || a.title}
              </Text>
              <Caption color="muted" numberOfLines={1}>
                {typeof a.questionCount === 'number' && a.questionCount > 0
                  ? `${a.questionCount} ${a.questionCount === 1 ? 'Problem' : 'Problems'} • `
                  : ''}
                Tap to view assignment
              </Caption>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        {/* Assignment Engagement Actions (Reddit-style Up/Down votes, Comments, Submissions & Share) */}
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
            accessibilityLabel="View assignment submissions"
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

  const renderFeedItem = ({ item }: { item: FeedItem }) => {
    if (item.feedType === 'assignment') {
      return renderAssignmentItem(item.assignment);
    }
    if (item.feedType === 'advertisement') {
      return (
        <SponsoredAdCard
          advertisement={item.advertisement}
          getFullImageUrl={getFullImageUrl}
          sessionKey={feedSessionSeed}
        />
      );
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
            Couldn't load posts.
          </Heading>
          <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
            {error}
          </Text>
          <Button title="Retry" variant="secondary" size="md" onPress={() => refetchFeed()} />
        </Card>
      );
    }

    return (
      <Card variant="flat" padding="lg" style={styles.stateCard}>
        <Ionicons name="newspaper-outline" size={44} color={colors.textMuted} style={{ marginBottom: spacing.sm }} />
        <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
          No posts yet.
        </Heading>
        <Text variant="sm" color="secondary" style={{ textAlign: 'center' }}>
          There are no updates for your semester right now.
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
          keyExtractor={(item) => (item.feedType === 'post' ? `post-${item.post.id}` : item.feedType === 'file' ? `file-${item.file.id}` : item.feedType === 'advertisement' ? `ad-${item.advertisement.id}` : `assignment-${item.assignment.id}`)}
          renderItem={renderFeedItem}
          ListHeaderComponent={renderFeedHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          onScroll={handleNavScroll}
          scrollEventThrottle={scrollEventThrottle}
          contentContainerStyle={[styles.container, { paddingBottom: 110 }]}
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
                style={styles.modalCloseBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close create post"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>

              <Text variant="md" weight="700" color="primary">
                {publishingMode === 'advertisement' ? 'Create Advertisement' : 'Create Post'}
              </Text>

              <Button
                title={submittingPost ? 'Publishing...' : (publishingMode === 'advertisement' ? 'Publish Ad' : 'Post')}
                size="sm"
                variant="primary"
                loading={submittingPost}
                disabled={
                  publishingMode === 'advertisement'
                    ? (!adAdvertiserName.trim() || !adPrimaryText.trim() || !adDestinationUrl.trim() || !adCreativeAsset || submittingPost)
                    : ((!postContent.trim() && composerAttachments.length === 0) ||
                       composerAttachments.some((a) => a.status === 'uploading' || a.status === 'error') ||
                       submittingPost)
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
              {/* Admin Publishing Mode Selector (Regular Post vs Advertisement) */}
              {userRole === 'admin' && (
                <View
                  style={{
                    flexDirection: 'row',
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: radii.md,
                    padding: 4,
                    marginBottom: spacing.md,
                    gap: 6,
                  }}
                  testID="composer-publishing-mode-toggle"
                >
                  <TouchableOpacity
                    onPress={() => setPublishingMode('post')}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: radii.sm,
                      alignItems: 'center',
                      backgroundColor: publishingMode === 'post' ? colors.surface : 'transparent',
                    }}
                  >
                    <Text variant="xs" weight="700" style={{ color: publishingMode === 'post' ? colors.text : colors.textSecondary }}>
                      Regular Post
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPublishingMode('advertisement')}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: radii.sm,
                      alignItems: 'center',
                      backgroundColor: publishingMode === 'advertisement' ? colors.surface : 'transparent',
                    }}
                  >
                    <Text variant="xs" weight="700" style={{ color: publishingMode === 'advertisement' ? colors.text : colors.textSecondary }}>
                      Advertisement
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

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
                    {user?.role ? user.role.toUpperCase() : 'STUDENT'} • {publishingMode === 'advertisement' ? 'Sponsored Feed Campaign' : 'Public to campus'}
                  </Caption>
                </View>
              </View>

              {publishingMode === 'advertisement' && userRole === 'admin' ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                  {composerError && (
                    <View style={[styles.errorBox, { borderColor: colors.borderStrong, borderRadius: radii.md }]}>
                      <Ionicons name="alert-circle-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
                      <Text variant="xs" color="primary" style={{ flex: 1 }}>{composerError}</Text>
                    </View>
                  )}
                  <TextInput
                    placeholder="Advertiser / Brand Name *"
                    placeholderTextColor={colors.textMuted}
                    value={adAdvertiserName}
                    onChangeText={setAdAdvertiserName}
                    style={[styles.titleInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                  />
                  <TextInput
                    placeholder="Primary Advertisement Text *"
                    placeholderTextColor={colors.textMuted}
                    value={adPrimaryText}
                    onChangeText={setAdPrimaryText}
                    multiline
                    style={[styles.contentInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, minHeight: 100, textAlignVertical: 'top' }]}
                  />
                  <TextInput
                    placeholder="Headline (Optional)"
                    placeholderTextColor={colors.textMuted}
                    value={adHeadline}
                    onChangeText={setAdHeadline}
                    style={[styles.titleInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                  />
                  <TextInput
                    placeholder="Description (Optional)"
                    placeholderTextColor={colors.textMuted}
                    value={adDescription}
                    onChangeText={setAdDescription}
                    style={[styles.titleInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TextInput
                      placeholder="CTA Button Label *"
                      placeholderTextColor={colors.textMuted}
                      value={adCtaLabel}
                      onChangeText={setAdCtaLabel}
                      style={[styles.titleInput, { flex: 1, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                    />
                    <TouchableOpacity
                      onPress={() => setAdIsActive(!adIsActive)}
                      style={[styles.selectorButton, { flex: 1, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' }]}
                    >
                      <Text variant="xs" weight="700" style={{ color: colors.text }}>
                        {adIsActive ? 'Status: Active' : 'Status: Inactive'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    placeholder="Destination URL (https://...) *"
                    placeholderTextColor={colors.textMuted}
                    value={adDestinationUrl}
                    onChangeText={setAdDestinationUrl}
                    autoCapitalize="none"
                    keyboardType="url"
                    style={[styles.titleInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TextInput
                      placeholder="Start Date (YYYY-MM-DD)"
                      placeholderTextColor={colors.textMuted}
                      value={adStartDate}
                      onChangeText={setAdStartDate}
                      style={[styles.titleInput, { flex: 1, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                    />
                    <TextInput
                      placeholder="End Date (YYYY-MM-DD)"
                      placeholderTextColor={colors.textMuted}
                      value={adEndDate}
                      onChangeText={setAdEndDate}
                      style={[styles.titleInput, { flex: 1, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 }]}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TouchableOpacity
                      onPress={handlePickAdCreative}
                      style={[styles.attachPhotoBtn, { flex: 1, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md, justifyContent: 'center' }]}
                    >
                      <Ionicons name="image-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                      <Text variant="xs" weight="600" color="primary">
                        {adCreativeAsset ? 'Creative Selected' : 'Select Creative *'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handlePickAdLogo}
                      style={[styles.attachPhotoBtn, { flex: 1, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md, justifyContent: 'center' }]}
                    >
                      <Ionicons name="person-circle-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                      <Text variant="xs" weight="600" color="primary">
                        {adLogoAsset ? 'Logo Selected' : 'Brand Logo'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>

              {/* Category, Audience, & Target Semesters Selectors */}
              <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {/* Category Button */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setCategorySheetVisible(true)}
                    style={[
                      styles.selectorButton,
                      {
                        flex: 1,
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Caption color="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        Category
                      </Caption>
                      <Text variant="xs" weight="700" color="primary" numberOfLines={1}>
                        {CATEGORY_DISPLAY_MAP[postCategory] || 'General'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {/* Target Semesters Button */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setSemesterSheetVisible(true)}
                    style={[
                      styles.selectorButton,
                      {
                        flex: 1,
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Caption color="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        Target Semesters
                      </Caption>
                      <Text variant="xs" weight="700" color="primary" numberOfLines={1}>
                        {postAllSemesters || postTargetSemesters.length === 0
                          ? 'All Semesters'
                          : `Sem ${postTargetSemesters.join(', ')}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Audience Selector (Students and CRs only) */}
                {canSelectAudience && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setAudienceSheetVisible(true)}
                    style={[
                      styles.selectorButton,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Caption color="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        Audience
                      </Caption>
                      <Text variant="xs" weight="700" color="primary" numberOfLines={1}>
                        {postAudience === 'students_only' ? 'Students Only' : 'Everyone'}
                      </Text>
                      {postAudience === 'students_only' && (
                        <Caption color="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          This post won't appear in teacher or university staff feeds.
                        </Caption>
                      )}
                    </View>
                    <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Title Input (Hidden for General posts) */}
              {postCategory !== 'general' && (
                <TextInput
                  placeholder="Title (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={postTitle}
                  onChangeText={setPostTitle}
                  maxLength={200}
                  style={[
                    styles.titleInput,
                    {
                      color: colors.text,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: 10,
                      marginBottom: spacing.sm,
                    },
                  ]}
                />
              )}

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
              </>
              )}
            </KeyboardAwareForm>

            <SelectionSheet
              visible={categorySheetVisible}
              onClose={() => setCategorySheetVisible(false)}
              title="Select Category"
              options={availableCategoryOptions}
              selectedId={postCategory}
              onSelect={(opt) => {
                setPostCategory(opt.id);
                setCategorySheetVisible(false);
              }}
            />

            {canSelectAudience && (
              <SelectionSheet<'everyone' | 'students_only'>
                visible={audienceSheetVisible}
                onClose={() => setAudienceSheetVisible(false)}
                title="Select Audience"
                options={AUDIENCE_OPTIONS}
                selectedId={postAudience}
                onSelect={(opt) => {
                  setPostAudience(opt.id);
                  setAudienceSheetVisible(false);
                }}
              />
            )}

            <SemesterMultiSelectSheet
              visible={semesterSheetVisible}
              onClose={() => setSemesterSheetVisible(false)}
              selectedSemesters={postTargetSemesters}
              allSemesters={postAllSemesters}
              onApply={(res) => {
                setPostAllSemesters(res.allSemesters);
                setPostTargetSemesters(res.semesters);
                setSemesterSheetVisible(false);
              }}
            />
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

      {/* Instagram-style Comments Bottom Sheet Modal */}
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
        onSubmitComment={handleSubmitPostComment}
        commentInputRef={commentInputRef}
        replyingTo={commentReplyingTo}
        editingComment={commentEditing}
        onCancelInputMode={handleCancelCommentInputMode}
        onReply={handleReplyPressModal}
        onEdit={handleEditPressModal}
        onDelete={handleDeletePostComment}
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

      {/* Floating Toast Notification (positioned cleanly above the floating bottom navigation bar) */}
      {toastMessage && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              bottom: Math.max(insets.bottom, 12) + (isAdmin ? 104 : 74),
              backgroundColor: '#18181B',
              borderColor: 'rgba(255, 255, 255, 0.16)',
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={18} color="#22C55E" style={{ marginRight: 8 }} />
          <Text variant="sm" weight="600" style={{ color: '#FAFAFA' }}>
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
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
  titleInput: {
    fontSize: 15,
    borderWidth: 1,
  },
  selectorButton: {
    minHeight: 48,
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
});

export default function HomeScreen() {
  const { user } = useAuth();
  const { isInAdminMode } = useAdminMode();
  const appRole = resolveAppRole(user);

  if (isInAdminMode) {
    return (
      <TabSwipeContainer tabIndex={0}>
        <AdminDashboardView />
      </TabSwipeContainer>
    );
  }

  if (appRole === 'unknown') {
    return <UnrecognizedRoleView />;
  }

  return <StudentHomeScreenInner />;
}
