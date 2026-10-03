import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, StudentUser } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { ResourceCard } from '@/components/ui/ResourceCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PostCard } from '@/components/PostCard';
import { FullScreenImageViewer } from '@/components/FullScreenImageViewer';
import { EditPostModal } from '@/components/EditPostModal';
import { apiFetch, getBaseUrl } from '@/services/api';
import { Post, deletePost, toggleLike } from '@/services/posts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_HEIGHT = Math.min(200, Math.round(SCREEN_WIDTH * (9 / 16)));

export interface ProfilePhotoItem {
  id: string | number;
  postId: number;
  url: string;
  fileName?: string;
  fileSize?: number;
  createdAt?: string;
  postContent?: string;
}

export interface ProfileAssignmentItem {
  id: number;
  title: string;
  description: string;
  language: string;
  subject?: string;
  semester?: string;
  deadline?: string;
  pdfUrl?: string;
  pdfName?: string;
  createdBy: string;
  createdAt: string;
  submissionCount?: number;
}

export interface SharedFileItem {
  id: number;
  originalName: string;
  title?: string;
  semester?: string;
  subject?: string;
  chapter?: string;
  sizeBytes?: number | string;
  uploadedAt: string;
  uploadedBy: string;
  uploaderName: string;
  uploaderAvatar?: string;
  uploaderRole?: string;
  likeCount?: number | string;
  liked?: boolean;
  commentCount?: number | string;
  canDelete?: boolean;
}

interface ProfileViewProps {
  targetStudentId?: string;
  isTab?: boolean;
}

export function ProfileView({ targetStudentId, isTab = false }: ProfileViewProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user: currentUser, serverUrl, refreshProfile } = useAuth();
  const { colors, spacing, radii } = useTheme();

  const effectiveStudentId = targetStudentId || currentUser?.studentId;
  const isSelf = Boolean(
    currentUser?.studentId &&
    effectiveStudentId &&
    String(currentUser.studentId).toLowerCase() === String(effectiveStudentId).toLowerCase()
  );

  // Profile data
  const [profile, setProfile] = useState<StudentUser | null>(isSelf ? currentUser : null);
  const [loadingProfile, setLoadingProfile] = useState(!profile);
  const [refreshing, setRefreshing] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'posts' | 'photos' | 'files' | 'assignments'>('posts');

  // Content state
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  const [photos, setPhotos] = useState<ProfilePhotoItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const [assignments, setAssignments] = useState<ProfileAssignmentItem[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // Follow state for other student
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  // Image upload in-flight
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  // Menus and Viewers
  const [avatarActionVisible, setAvatarActionVisible] = useState(false);
  const [coverActionVisible, setCoverActionVisible] = useState(false);
  const [repositionVisible, setRepositionVisible] = useState(false);
  const [repositionY, setRepositionY] = useState(0.5);

  // Full Screen Image Viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>('Image');

  // Edit Post modal
  const [editingPost, setEditingPost] = useState<Post | null>(null);

  const getFullUrl = useCallback(
    (path?: string | null) => {
      if (!path) return null;
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const base = serverUrl || getBaseUrl();
      return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    },
    [serverUrl]
  );

  // Parse vertical offset from coverPosition (e.g. JSON {"y": 0.5})
  const coverOffsetY = useMemo(() => {
    if (!profile?.coverPosition) return 0.5;
    try {
      if (typeof profile.coverPosition === 'string') {
        const parsed = JSON.parse(profile.coverPosition);
        if (typeof parsed?.y === 'number') return Math.max(0, Math.min(1, parsed.y));
      } else if (typeof (profile.coverPosition as any)?.y === 'number') {
        return Math.max(0, Math.min(1, (profile.coverPosition as any).y));
      }
    } catch (_) {}
    return 0.5;
  }, [profile?.coverPosition]);

  // Load Profile Header
  const fetchProfile = useCallback(async () => {
    if (!effectiveStudentId) return;
    try {
      const endpoint = isSelf ? '/api/profile' : `/api/profile/${effectiveStudentId}`;
      const res = await apiFetch(endpoint);
      if (res.ok) {
        const data: StudentUser = await res.json();
        setProfile(data);
        setIsFollowing(Boolean((data as any).isFollowing));
        setFollowersCount(data.stats?.followersCount || 0);
        if (data.coverPosition) {
          try {
            const parsed = typeof data.coverPosition === 'string' ? JSON.parse(data.coverPosition) : data.coverPosition;
            if (typeof parsed?.y === 'number') setRepositionY(parsed.y);
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Failed to fetch student profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, [effectiveStudentId, isSelf]);

  // Load Posts tab
  const fetchPosts = useCallback(async () => {
    if (!effectiveStudentId) return;
    setLoadingPosts(true);
    try {
      const res = await apiFetch(`/api/posts?studentId=${encodeURIComponent(effectiveStudentId)}&limit=30`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      }
    } catch (err) {
      console.warn('Failed to load profile posts:', err);
    } finally {
      setLoadingPosts(false);
    }
  }, [effectiveStudentId]);

  // Load Photos tab
  const fetchPhotos = useCallback(async () => {
    if (!effectiveStudentId) return;
    setLoadingPhotos(true);
    try {
      const res = await apiFetch(`/api/profile/${encodeURIComponent(effectiveStudentId)}/photos`);
      if (res.ok) {
        const data = await res.json();
        setPhotos(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Failed to load profile photos:', err);
    } finally {
      setLoadingPhotos(false);
    }
  }, [effectiveStudentId]);

  // Load Files tab
  const fetchFiles = useCallback(async () => {
    if (!effectiveStudentId) return;
    setLoadingFiles(true);
    try {
      const res = await apiFetch(`/api/profile/${encodeURIComponent(effectiveStudentId)}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Failed to load profile files:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, [effectiveStudentId]);

  // Load Assignments tab
  const fetchAssignments = useCallback(async () => {
    if (!effectiveStudentId) return;
    setLoadingAssignments(true);
    try {
      const res = await apiFetch(`/api/profile/${encodeURIComponent(effectiveStudentId)}/assignments`);
      if (res.ok) {
        const data = await res.json();
        setAssignments(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Failed to load profile assignments:', err);
    } finally {
      setLoadingAssignments(false);
    }
  }, [effectiveStudentId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (activeTab === 'posts') fetchPosts();
    else if (activeTab === 'photos') fetchPhotos();
    else if (activeTab === 'files') fetchFiles();
    else if (activeTab === 'assignments') fetchAssignments();
  }, [activeTab, fetchPosts, fetchPhotos, fetchFiles, fetchAssignments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchProfile(),
      activeTab === 'posts' ? fetchPosts() : Promise.resolve(),
      activeTab === 'photos' ? fetchPhotos() : Promise.resolve(),
      activeTab === 'files' ? fetchFiles() : Promise.resolve(),
      activeTab === 'assignments' ? fetchAssignments() : Promise.resolve(),
    ]);
    if (isSelf) {
      await refreshProfile();
    }
    setRefreshing(false);
  }, [fetchProfile, activeTab, fetchPosts, fetchPhotos, fetchFiles, fetchAssignments, isSelf, refreshProfile]);

  // Follow / Unfollow toggle
  const handleToggleFollow = async () => {
    if (!profile?.studentId || isFollowLoading) return;
    const nextState = !isFollowing;
    setIsFollowing(nextState);
    setFollowersCount((prev) => (nextState ? prev + 1 : Math.max(0, prev - 1)));
    setIsFollowLoading(true);

    try {
      const res = await apiFetch(`/api/profile/${profile.studentId}/follow`, {
        method: 'POST',
        body: JSON.stringify({ following: nextState }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(Boolean(data.isFollowing));
        if (typeof data.followersCount === 'number') {
          setFollowersCount(data.followersCount);
        }
      } else {
        // Rollback
        setIsFollowing(!nextState);
        setFollowersCount((prev) => (!nextState ? prev + 1 : Math.max(0, prev - 1)));
      }
    } catch (err) {
      // Rollback
      setIsFollowing(!nextState);
      setFollowersCount((prev) => (!nextState ? prev + 1 : Math.max(0, prev - 1)));
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Avatar Photo Actions
  const handlePickAvatar = async () => {
    setAvatarActionVisible(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Gallery access is required to change your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const uri = asset.uri;
        const filename = uri.split('/').pop() || 'avatar.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1].toLowerCase()}` : `image/jpeg`;

        const formData = new FormData();
        formData.append('avatar', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          name: filename,
          type,
        } as any);

        setIsUploadingAvatar(true);
        const res = await apiFetch('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        });
        setIsUploadingAvatar(false);

        if (res.ok) {
          const fresh = await refreshProfile();
          if (fresh) setProfile(fresh);
          queryClient.invalidateQueries({ queryKey: ['posts'] });
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          Alert.alert('Success', 'Profile photo updated successfully!');
        } else {
          const data = await res.json().catch(() => ({}));
          Alert.alert('Upload Error', data.message || 'Failed to update profile photo.');
        }
      }
    } catch (err: any) {
      setIsUploadingAvatar(false);
      Alert.alert('Error', err.message || 'Failed to select image.');
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarActionVisible(false);
    Alert.alert('Remove Profile Picture', 'Are you sure you want to remove your profile photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsUploadingAvatar(true);
          try {
            const res = await apiFetch('/api/profile/avatar', { method: 'DELETE' });
            if (res.ok) {
              const fresh = await refreshProfile();
              if (fresh) setProfile(fresh);
              queryClient.invalidateQueries({ queryKey: ['posts'] });
              queryClient.invalidateQueries({ queryKey: ['profile'] });
              Alert.alert('Success', 'Profile picture removed.');
            } else {
              Alert.alert('Error', 'Could not remove profile picture.');
            }
          } catch (_) {
            Alert.alert('Error', 'Failed to connect to server.');
          } finally {
            setIsUploadingAvatar(false);
          }
        },
      },
    ]);
  };

  // Cover Photo Actions
  const handlePickCover = async () => {
    setCoverActionVisible(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Gallery access is required to change your cover photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const uri = asset.uri;
        const filename = uri.split('/').pop() || 'cover.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1].toLowerCase()}` : `image/jpeg`;

        const formData = new FormData();
        formData.append('cover', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          name: filename,
          type,
        } as any);

        setIsUploadingCover(true);
        const res = await apiFetch('/api/profile/cover', {
          method: 'POST',
          body: formData,
        });
        setIsUploadingCover(false);

        if (res.ok) {
          const fresh = await refreshProfile();
          if (fresh) setProfile(fresh);
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          Alert.alert('Success', 'Cover photo updated successfully!');
        } else {
          const data = await res.json().catch(() => ({}));
          Alert.alert('Upload Error', data.message || 'Failed to update cover photo.');
        }
      }
    } catch (err: any) {
      setIsUploadingCover(false);
      Alert.alert('Error', err.message || 'Failed to select cover image.');
    }
  };

  const handleSaveCoverReposition = async (newY: number) => {
    setRepositionVisible(false);
    try {
      const res = await apiFetch('/api/profile/cover/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: { y: newY } }),
      });
      if (res.ok) {
        setRepositionY(newY);
        setProfile((prev) => prev ? { ...prev, coverPosition: JSON.stringify({ y: newY }) } : null);
        void refreshProfile();
      } else {
        Alert.alert('Error', 'Failed to save cover framing.');
      }
    } catch (_) {
      Alert.alert('Error', 'Could not update cover framing.');
    }
  };

  const handleRemoveCover = () => {
    setCoverActionVisible(false);
    Alert.alert('Remove Cover Photo', 'Are you sure you want to remove your cover photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsUploadingCover(true);
          try {
            const res = await apiFetch('/api/profile/cover', { method: 'DELETE' });
            if (res.ok) {
              const fresh = await refreshProfile();
              if (fresh) setProfile(fresh);
              queryClient.invalidateQueries({ queryKey: ['profile'] });
              Alert.alert('Success', 'Cover photo removed.');
            } else {
              Alert.alert('Error', 'Could not remove cover photo.');
            }
          } catch (_) {
            Alert.alert('Error', 'Failed to connect to server.');
          } finally {
            setIsUploadingCover(false);
          }
        },
      },
    ]);
  };

  // Share profile
  const handleShareProfile = async () => {
    if (!profile) return;
    try {
      const shareUrl = `${serverUrl || getBaseUrl()}/user/${profile.studentId}`;
      await Share.share({
        title: `${profile.name}'s Profile`,
        message: `Check out ${profile.name}'s academic profile on Semester Library: ${shareUrl}`,
      });
    } catch (_) {}
  };

  // Post Actions
  const handleLikePost = async (postId: number) => {
    try {
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id === postId) {
            const nextLiked = !p.liked_by_me;
            return {
              ...p,
              liked_by_me: nextLiked,
              like_count: nextLiked ? (p.like_count || 0) + 1 : Math.max(0, (p.like_count || 1) - 1),
            };
          }
          return p;
        })
      );
      await toggleLike(postId);
    } catch (_) {}
  };

  const handlePostMenu = (post: Post) => {
    const isOwner = currentUser?.studentId && post.user_id === currentUser.studentId;
    if (isOwner) {
      Alert.alert('Post Options', undefined, [
        { text: 'Edit Post', onPress: () => setEditingPost(post) },
        {
          text: 'Delete Post',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Delete Post', 'Are you sure you want to permanently delete this post?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deletePost(post.id);
                    setPosts((prev) => prev.filter((p) => p.id !== post.id));
                    queryClient.invalidateQueries({ queryKey: ['posts'] });
                  } catch (err: any) {
                    Alert.alert('Error', err.message || 'Failed to delete post');
                  }
                },
              },
            ]);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert('Post Options', undefined, [
        {
          text: 'Share Post',
          onPress: () => {
            const url = `${serverUrl || getBaseUrl()}/post/${post.id}`;
            Share.share({ message: `${post.content ? post.content.slice(0, 100) + '... ' : ''}${url}` });
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  if (loadingProfile && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  const avatarFullUrl = getFullUrl(profile?.avatarUrl);
  const coverFullUrl = getFullUrl(profile?.coverUrl);
  const canShowAssignments = Boolean(profile?.canCreateAssignments || (profile?.stats?.assignmentsCount || 0) > 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Top Stack Header (Only if not tab screen) */}
      {!isTab && (
        <View
          style={[
            styles.stackHeader,
            {
              paddingTop: insets.top + 6,
              backgroundColor: colors.surfaceRaised,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text variant="md" weight="700" numberOfLines={1} style={{ flex: 1, marginHorizontal: 8 }}>
            {profile?.name || 'Profile'}
          </Text>
          <TouchableOpacity onPress={handleShareProfile} activeOpacity={0.7} style={styles.shareBtn}>
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: isTab ? insets.top : 0,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
            colors={[colors.text]}
          />
        }
      >
        {/* ============================================================ */}
        {/* 1. COVER PHOTO HEADER                                        */}
        {/* ============================================================ */}
        <View style={styles.coverContainer}>
          {coverFullUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                setViewerUri(coverFullUrl);
                setViewerTitle(`${profile?.name || 'Student'}'s Cover Photo`);
                setViewerVisible(true);
              }}
              style={styles.coverTouchArea}
            >
              <Image
                source={{ uri: coverFullUrl }}
                style={styles.coverImage}
                contentFit="cover"
                contentPosition={{ top: `${repositionY * 100}%` }}
                transition={200}
              />
              {/* Subtle bottom vignette gradient overlay */}
              <View style={styles.coverVignette} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.coverFallback, { backgroundColor: colors.surfaceRaised }]}>
              <View style={styles.coverFallbackInner}>
                <Ionicons name="images-outline" size={32} color={colors.textMuted} />
                {isSelf && (
                  <Text variant="xs" color="muted" style={{ marginTop: 4 }}>
                    Add a cover photo to personalize your profile
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Cover Action Button (Owner only) */}
          {isSelf && (
            <TouchableOpacity
              style={[
                styles.coverEditButton,
                {
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  borderColor: 'rgba(255,255,255,0.2)',
                },
              ]}
              onPress={() => setCoverActionVisible(true)}
              activeOpacity={0.8}
            >
              {isUploadingCover ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={15} color="#FFFFFF" />
                  <Text variant="xs" weight="700" style={{ color: '#FFFFFF', marginLeft: 5 }}>
                    {coverFullUrl ? 'Edit Cover' : 'Add Cover'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ============================================================ */}
        {/* 2. PROFILE PICTURE & HERO IDENTITY                           */}
        {/* ============================================================ */}
        <View style={styles.profileHeaderContent}>
          {/* Avatar Circle Overlapping Cover */}
          <View style={styles.avatarRow}>
            <View
              style={[
                styles.avatarWrapper,
                {
                  borderColor: colors.background,
                  backgroundColor: colors.surfaceRaised,
                },
              ]}
            >
              <TouchableOpacity
                activeOpacity={avatarFullUrl ? 0.8 : 1}
                onPress={() => {
                  if (avatarFullUrl) {
                    setViewerUri(avatarFullUrl);
                    setViewerTitle(`${profile?.name || 'Student'}'s Profile Picture`);
                    setViewerVisible(true);
                  } else if (isSelf) {
                    setAvatarActionVisible(true);
                  }
                }}
              >
                <Avatar
                  url={avatarFullUrl}
                  name={profile?.name}
                  size="xxl"
                  style={{ width: 92, height: 92, borderRadius: 46 }}
                />
              </TouchableOpacity>

              {/* Avatar Loading Spinner */}
              {isUploadingAvatar && (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              )}

              {/* Avatar Edit Camera Badge (Owner only) */}
              {isSelf && (
                <TouchableOpacity
                  style={[
                    styles.avatarBadge,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.background,
                    },
                  ]}
                  onPress={() => setAvatarActionVisible(true)}
                  activeOpacity={0.8}
                  accessibilityLabel="Edit profile picture"
                >
                  <Ionicons name="camera" size={13} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>

            {/* Top Right Action Button: Edit Profile (Self) vs Follow/Message (Other) */}
            <View style={styles.headerRightActions}>
              {isSelf ? (
                <Button
                  title="Edit Profile"
                  variant="outline"
                  size="sm"
                  onPress={() => router.push('/edit-profile')}
                  leftIcon={<Ionicons name="create-outline" size={15} color={colors.text} />}
                  style={{ borderRadius: radii.full, paddingHorizontal: 16 }}
                />
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    title={isFollowing ? 'Following' : 'Follow'}
                    variant={isFollowing ? 'outline' : 'primary'}
                    size="sm"
                    loading={isFollowLoading}
                    onPress={handleToggleFollow}
                    style={{ borderRadius: radii.full, paddingHorizontal: 18 }}
                  />
                  <Button
                    title="Message"
                    variant="outline"
                    size="sm"
                    onPress={() => {
                      router.push({
                        pathname: '/chat',
                        params: { directStudentId: profile?.studentId },
                      } as any);
                    }}
                    leftIcon={<Ionicons name="chatbubble-outline" size={14} color={colors.text} />}
                    style={{ borderRadius: radii.full }}
                  />
                </View>
              )}
            </View>
          </View>

          {/* Identity Information */}
          <View style={styles.identityDetails}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text variant="lg" weight="800" style={{ fontSize: 22, color: colors.text }}>
                {profile?.name || 'Student'}
              </Text>
              {profile?.role && profile.role !== 'student' && (
                <View
                  style={[
                    styles.roleBadge,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Text variant="xs" weight="800" color="secondary" style={{ fontSize: 10 }}>
                    {profile.role.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {/* Username if present */}
            {Boolean(profile?.username) && (
              <Caption color="muted" style={{ marginTop: 2, fontSize: 13 }}>
                @{profile?.username}
              </Caption>
            )}

            {/* Department and Semester Pill */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
              <View
                style={[
                  styles.academicPill,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.borderSubtle,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <Ionicons name="school-outline" size={13} color={colors.textSecondary} style={{ marginRight: 5 }} />
                <Text variant="xs" weight="600" color="secondary">
                  {profile?.department || 'BIT'} • {profile?.semester || 'Semester 1'}
                </Text>
              </View>
            </View>

            {/* Bio text */}
            {Boolean(profile?.bio && profile.bio.trim()) ? (
              <Text variant="sm" style={[styles.bioText, { color: colors.text, lineHeight: 21 }]}>
                {profile?.bio}
              </Text>
            ) : isSelf ? (
              <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/edit-profile')}>
                <Text variant="xs" color="muted" style={{ marginTop: 8, fontStyle: 'italic' }}>
                  Tap here or &quot;Edit Profile&quot; to add a short bio...
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Social Links (GitHub, LinkedIn) */}
            {(Boolean(profile?.githubUrl) || Boolean(profile?.linkedinUrl)) && (
              <View style={styles.socialRow}>
                {Boolean(profile?.githubUrl) && (
                  <TouchableOpacity
                    style={[
                      styles.socialChip,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.full,
                      },
                    ]}
                    onPress={() => profile?.githubUrl && Linking.openURL(profile.githubUrl)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="logo-github" size={13} color={colors.text} />
                    <Text variant="xs" weight="600" style={{ marginLeft: 5, color: colors.text }}>
                      GitHub
                    </Text>
                  </TouchableOpacity>
                )}
                {Boolean(profile?.linkedinUrl) && (
                  <TouchableOpacity
                    style={[
                      styles.socialChip,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.full,
                      },
                    ]}
                    onPress={() => profile?.linkedinUrl && Linking.openURL(profile.linkedinUrl)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="logo-linkedin" size={13} color="#0A66C2" />
                    <Text variant="xs" weight="600" style={{ marginLeft: 5, color: colors.text }}>
                      LinkedIn
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Stats Row Strip */}
            <View
              style={[
                styles.statsRow,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceSubtle,
                  borderRadius: radii.md,
                },
              ]}
            >
              <TouchableOpacity
                style={styles.statBox}
                activeOpacity={0.7}
                onPress={() => setActiveTab('posts')}
              >
                <Text variant="md" weight="800">
                  {profile?.stats?.postsCount ?? posts.length}
                </Text>
                <Caption color="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  Posts
                </Caption>
              </TouchableOpacity>

              <View style={[styles.statDivider, { backgroundColor: colors.borderSubtle }]} />

              <TouchableOpacity
                style={styles.statBox}
                activeOpacity={0.7}
                onPress={() => setActiveTab('photos')}
              >
                <Text variant="md" weight="800">
                  {profile?.stats?.photosCount ?? photos.length}
                </Text>
                <Caption color="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  Photos
                </Caption>
              </TouchableOpacity>

              <View style={[styles.statDivider, { backgroundColor: colors.borderSubtle }]} />

              <TouchableOpacity
                style={styles.statBox}
                activeOpacity={0.7}
                onPress={() => setActiveTab('files')}
              >
                <Text variant="md" weight="800">
                  {profile?.stats?.filesCount ?? files.length}
                </Text>
                <Caption color="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  Files
                </Caption>
              </TouchableOpacity>

              <View style={[styles.statDivider, { backgroundColor: colors.borderSubtle }]} />

              <View style={styles.statBox}>
                <Text variant="md" weight="800">
                  {followersCount}
                </Text>
                <Caption color="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  Followers
                </Caption>
              </View>
            </View>
          </View>
        </View>

        {/* ============================================================ */}
        {/* 3. CONTENT SECTIONS TABS                                     */}
        {/* ============================================================ */}
        <View
          style={[
            styles.tabsBar,
            {
              backgroundColor: colors.background,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'posts' && styles.activeTabButton]}
            onPress={() => setActiveTab('posts')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={activeTab === 'posts' ? 'newspaper' : 'newspaper-outline'}
              size={16}
              color={activeTab === 'posts' ? colors.text : colors.textMuted}
            />
            <Text
              variant="sm"
              weight={activeTab === 'posts' ? '700' : '500'}
              style={{
                marginLeft: 6,
                color: activeTab === 'posts' ? colors.text : colors.textMuted,
              }}
            >
              Posts
            </Text>
            {activeTab === 'posts' && (
              <View style={[styles.activeTabIndicator, { backgroundColor: colors.text }]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'photos' && styles.activeTabButton]}
            onPress={() => setActiveTab('photos')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={activeTab === 'photos' ? 'images' : 'images-outline'}
              size={16}
              color={activeTab === 'photos' ? colors.text : colors.textMuted}
            />
            <Text
              variant="sm"
              weight={activeTab === 'photos' ? '700' : '500'}
              style={{
                marginLeft: 6,
                color: activeTab === 'photos' ? colors.text : colors.textMuted,
              }}
            >
              Photos
            </Text>
            {activeTab === 'photos' && (
              <View style={[styles.activeTabIndicator, { backgroundColor: colors.text }]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'files' && styles.activeTabButton]}
            onPress={() => setActiveTab('files')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={activeTab === 'files' ? 'folder' : 'folder-outline'}
              size={16}
              color={activeTab === 'files' ? colors.text : colors.textMuted}
            />
            <Text
              variant="sm"
              weight={activeTab === 'files' ? '700' : '500'}
              style={{
                marginLeft: 6,
                color: activeTab === 'files' ? colors.text : colors.textMuted,
              }}
            >
              Files
            </Text>
            {activeTab === 'files' && (
              <View style={[styles.activeTabIndicator, { backgroundColor: colors.text }]} />
            )}
          </TouchableOpacity>

          {canShowAssignments && (
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'assignments' && styles.activeTabButton]}
              onPress={() => setActiveTab('assignments')}
              activeOpacity={0.7}
            >
              <Ionicons
                name={activeTab === 'assignments' ? 'clipboard' : 'clipboard-outline'}
                size={16}
                color={activeTab === 'assignments' ? colors.text : colors.textMuted}
              />
              <Text
                variant="sm"
                weight={activeTab === 'assignments' ? '700' : '500'}
                style={{
                  marginLeft: 6,
                  color: activeTab === 'assignments' ? colors.text : colors.textMuted,
                }}
              >
                Assignments
              </Text>
              {activeTab === 'assignments' && (
                <View style={[styles.activeTabIndicator, { backgroundColor: colors.text }]} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ============================================================ */}
        {/* 4. TAB CONTENTS                                              */}
        {/* ============================================================ */}

        {/* --- POSTS TAB --- */}
        {activeTab === 'posts' && (
          <View style={styles.tabContentContainer}>
            {loadingPosts ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : posts.length === 0 ? (
              <EmptyState
                icon="newspaper-outline"
                title="No Posts Yet"
                description={
                  isSelf
                    ? "You haven't shared any posts yet. Head over to the feed tab to post an update or note."
                    : `${profile?.name || 'This student'} hasn't published any posts yet.`
                }
              />
            ) : (
              posts.map((post) => (
                <PostCard
                  key={`profile_post_${post.id}`}
                  post={post}
                  currentUserId={currentUser?.studentId}
                  onLike={handleLikePost}
                  onDoubleTapLike={handleLikePost}
                  onShare={(p) => {
                    const url = `${serverUrl || getBaseUrl()}/post/${p.id}`;
                    Share.share({ message: `${p.content ? p.content.slice(0, 100) + '... ' : ''}${url}` });
                  }}
                  onOpenDetail={(p) => {
                    if (p.type === 'notice') {
                      router.push(`/notice/${p.id}`);
                    } else {
                      router.push(`/post/${p.id}`);
                    }
                  }}
                  onOpenMenu={handlePostMenu}
                  getFullImageUrl={getFullUrl}
                />
              ))
            )}
          </View>
        )}

        {/* --- PHOTOS TAB (3-column responsive grid) --- */}
        {activeTab === 'photos' && (
          <View style={styles.tabContentContainer}>
            {loadingPhotos ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : photos.length === 0 ? (
              <EmptyState
                icon="images-outline"
                title="No Photos"
                description={
                  isSelf
                    ? 'Photos attached to your posts will automatically appear in this gallery.'
                    : `${profile?.name || 'This student'} hasn't shared any photos yet.`
                }
              />
            ) : (
              <View style={styles.photoGrid}>
                {photos.map((item, idx) => {
                  const fullPhotoUrl = getFullUrl(item.url);
                  return (
                    <TouchableOpacity
                      key={`photo_${item.id}_${idx}`}
                      style={styles.photoGridTile}
                      activeOpacity={0.8}
                      onPress={() => {
                        if (fullPhotoUrl) {
                          setViewerUri(fullPhotoUrl);
                          setViewerTitle(item.postContent ? `${item.postContent.slice(0, 30)}...` : 'Photo');
                          setViewerVisible(true);
                        }
                      }}
                    >
                      <Image
                        source={{ uri: fullPhotoUrl || undefined }}
                        style={styles.gridImage}
                        contentFit="cover"
                        transition={150}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* --- FILES TAB (Uploaded Library materials) --- */}
        {activeTab === 'files' && (
          <View style={styles.tabContentContainer}>
            {loadingFiles ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : files.length === 0 ? (
              <EmptyState
                icon="folder-open-outline"
                title="No Uploaded Materials"
                description={
                  isSelf
                    ? "You haven't uploaded any study materials or notes to the library yet."
                    : `${profile?.name || 'This student'} hasn't uploaded any study materials yet.`
                }
              />
            ) : (
              files.map((file) => (
                <View key={`file_${file.id}`} style={{ paddingHorizontal: 16, marginTop: 10 }}>
                  <ResourceCard
                    id={file.id}
                    title={file.title || file.originalName}
                    originalName={file.originalName}
                    subject={file.subject || file.semester || 'Academic Note'}
                    sizeBytes={file.sizeBytes}
                    uploadedAt={file.uploadedAt}
                    liked={file.liked}
                    likeCount={file.likeCount}
                    onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
                  />
                </View>
              ))
            )}
          </View>
        )}

        {/* --- ASSIGNMENTS TAB --- */}
        {activeTab === 'assignments' && (
          <View style={styles.tabContentContainer}>
            {loadingAssignments ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : assignments.length === 0 ? (
              <EmptyState
                icon="clipboard-outline"
                title="No Assignments"
                description="No assignments have been published by this instructor or representative."
              />
            ) : (
              assignments.map((assignment) => (
                <TouchableOpacity
                  key={`assign_${assignment.id}`}
                  style={[
                    styles.assignmentCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (assignment.pdfUrl) {
                      const fullPdfUrl = getFullUrl(assignment.pdfUrl);
                      if (fullPdfUrl) Linking.openURL(fullPdfUrl);
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="sm" weight="700" numberOfLines={1} style={{ flex: 1 }}>
                      {assignment.title}
                    </Text>
                    {Boolean(assignment.language) && (
                      <View
                        style={[
                          styles.langBadge,
                          { backgroundColor: colors.surfaceSubtle, borderRadius: radii.sm },
                        ]}
                      >
                        <Text variant="xs" weight="700" color="secondary">
                          {assignment.language.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>

                  {Boolean(assignment.description) && (
                    <Text variant="xs" color="secondary" numberOfLines={2} style={{ marginTop: 4 }}>
                      {assignment.description}
                    </Text>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 }}>
                    {Boolean(assignment.subject) && (
                      <Caption color="muted">
                        <Ionicons name="book-outline" size={11} color={colors.textMuted} /> {assignment.subject}
                      </Caption>
                    )}
                    {Boolean(assignment.deadline) && (
                      <Caption color="muted">
                        <Ionicons name="time-outline" size={11} color={colors.textMuted} /> Due:{' '}
                        {new Date(assignment.deadline!).toLocaleDateString()}
                      </Caption>
                    )}
                    {typeof assignment.submissionCount === 'number' && (
                      <Caption color="muted">
                        <Ionicons name="people-outline" size={11} color={colors.textMuted} /> {assignment.submissionCount} submissions
                      </Caption>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* ============================================================ */}
      {/* 5. MODALS & ACTION SHEETS                                    */}
      {/* ============================================================ */}

      {/* Avatar Actions Modal (Owner) */}
      <Modal
        visible={avatarActionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarActionVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setAvatarActionVisible(false)}
        >
          <View
            style={[
              styles.actionSheet,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.lg,
              },
            ]}
          >
            <Text variant="md" weight="700" style={{ marginBottom: 16 }}>
              Profile Photo
            </Text>

            {Boolean(avatarFullUrl) && (
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={() => {
                  setAvatarActionVisible(false);
                  setViewerUri(avatarFullUrl);
                  setViewerTitle(`${profile?.name || 'Student'}'s Profile Photo`);
                  setViewerVisible(true);
                }}
              >
                <Ionicons name="eye-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={{ marginLeft: 12 }}>
                  View Profile Picture
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionSheetOption} onPress={handlePickAvatar}>
              <Ionicons name="images-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={{ marginLeft: 12 }}>
                {avatarFullUrl ? 'Choose New Photo' : 'Upload Photo'}
              </Text>
            </TouchableOpacity>

            {Boolean(avatarFullUrl) && (
              <TouchableOpacity style={styles.actionSheetOption} onPress={handleRemoveAvatar}>
                <Ionicons name="trash-outline" size={20} color="#EF4444" />
                <Text variant="sm" weight="600" style={{ marginLeft: 12, color: '#EF4444' }}>
                  Remove Photo
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionSheetCancel, { borderTopColor: colors.border }]}
              onPress={() => setAvatarActionVisible(false)}
            >
              <Text variant="sm" weight="700" color="muted">
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Cover Actions Modal (Owner) */}
      <Modal
        visible={coverActionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCoverActionVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setCoverActionVisible(false)}
        >
          <View
            style={[
              styles.actionSheet,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.lg,
              },
            ]}
          >
            <Text variant="md" weight="700" style={{ marginBottom: 16 }}>
              Cover Photo
            </Text>

            {Boolean(coverFullUrl) && (
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={() => {
                  setCoverActionVisible(false);
                  setViewerUri(coverFullUrl);
                  setViewerTitle(`${profile?.name || 'Student'}'s Cover Photo`);
                  setViewerVisible(true);
                }}
              >
                <Ionicons name="eye-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={{ marginLeft: 12 }}>
                  View Cover Photo
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionSheetOption} onPress={handlePickCover}>
              <Ionicons name="images-outline" size={20} color={colors.text} />
              <Text variant="sm" weight="600" style={{ marginLeft: 12 }}>
                {coverFullUrl ? 'Choose New Cover' : 'Upload Cover Photo'}
              </Text>
            </TouchableOpacity>

            {Boolean(coverFullUrl) && (
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={() => {
                  setCoverActionVisible(false);
                  setRepositionVisible(true);
                }}
              >
                <Ionicons name="swap-vertical-outline" size={20} color={colors.text} />
                <Text variant="sm" weight="600" style={{ marginLeft: 12 }}>
                  Reposition Cover
                </Text>
              </TouchableOpacity>
            )}

            {Boolean(coverFullUrl) && (
              <TouchableOpacity style={styles.actionSheetOption} onPress={handleRemoveCover}>
                <Ionicons name="trash-outline" size={20} color="#EF4444" />
                <Text variant="sm" weight="600" style={{ marginLeft: 12, color: '#EF4444' }}>
                  Remove Cover Photo
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionSheetCancel, { borderTopColor: colors.border }]}
              onPress={() => setCoverActionVisible(false)}
            >
              <Text variant="sm" weight="700" color="muted">
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reposition Cover Modal */}
      <Modal
        visible={repositionVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRepositionVisible(false)}
      >
        <View style={[styles.repositionContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.repositionHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setRepositionVisible(false)}>
              <Text variant="sm" weight="600" color="secondary">
                Cancel
              </Text>
            </TouchableOpacity>
            <Text variant="md" weight="700">
              Reposition Cover
            </Text>
            <TouchableOpacity onPress={() => handleSaveCoverReposition(repositionY)}>
              <Text variant="sm" weight="700">
                Save
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.repositionFrameBox}>
            <Text variant="xs" color="muted" style={{ textAlign: 'center', marginVertical: 12 }}>
              Select desired vertical framing for your cover photo
            </Text>

            <View style={[styles.repositionWindow, { borderColor: colors.border }]}>
              {Boolean(coverFullUrl) && (
                <Image
                  source={{ uri: coverFullUrl || undefined }}
                  style={styles.repositionImage}
                  contentFit="cover"
                  contentPosition={{ top: `${repositionY * 100}%` }}
                />
              )}
            </View>

            {/* Quick framing offset presets */}
            <View style={styles.presetButtonsRow}>
              {[
                { label: 'Top', val: 0.1 },
                { label: 'Center', val: 0.5 },
                { label: 'Bottom', val: 0.9 },
              ].map((p) => (
                <TouchableOpacity
                  key={p.label}
                  style={[
                    styles.presetBtn,
                    {
                      backgroundColor: Math.abs(repositionY - p.val) < 0.1 ? colors.surfaceRaised : colors.surfaceSubtle,
                      borderColor: Math.abs(repositionY - p.val) < 0.1 ? colors.text : colors.border,
                    },
                  ]}
                  onPress={() => setRepositionY(p.val)}
                >
                  <Text variant="xs" weight="700">
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Post Modal */}
      {editingPost && (
        <EditPostModal
          visible={Boolean(editingPost)}
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onPostUpdated={() => {
            setEditingPost(null);
            fetchPosts();
            queryClient.invalidateQueries({ queryKey: ['posts'] });
          }}
          getFullUrl={getFullUrl}
        />
      )}

      {/* Full-Screen Avatar / Cover / Photo Viewer */}
      <FullScreenImageViewer
        visible={viewerVisible}
        imageUri={viewerUri}
        imageTitle={viewerTitle}
        onClose={() => {
          setViewerVisible(false);
          setViewerUri(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  backBtn: {
    padding: 6,
  },
  shareBtn: {
    padding: 6,
  },
  scrollContent: {
    flexGrow: 1,
  },
  coverContainer: {
    width: '100%',
    height: COVER_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  coverTouchArea: {
    width: '100%',
    height: '100%',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverVignette: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  coverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverFallbackInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  coverEditButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  profileHeaderContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: -44,
    marginBottom: 8,
  },
  avatarWrapper: {
    position: 'relative',
    borderRadius: 48,
    borderWidth: 3,
    overflow: 'visible',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightActions: {
    paddingBottom: 4,
  },
  identityDetails: {
    marginTop: 4,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  academicPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  bioText: {
    marginTop: 10,
    fontSize: 14,
  },
  socialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  socialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    marginTop: 16,
    borderWidth: 1,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
  },
  tabsBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  activeTabButton: {},
  activeTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
  },
  tabContentContainer: {
    minHeight: 250,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 1,
  },
  photoGridTile: {
    width: (SCREEN_WIDTH - 4) / 3,
    height: (SCREEN_WIDTH - 4) / 3,
    padding: 1,
  },
  gridImage: {
    width: '100%',
    height: '100%',
    borderRadius: 3,
  },
  assignmentCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
  },
  langBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  actionSheet: {
    padding: 20,
    borderWidth: 1,
  },
  actionSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  actionSheetCancel: {
    alignItems: 'center',
    paddingTop: 16,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  repositionContainer: {
    flex: 1,
  },
  repositionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  repositionFrameBox: {
    padding: 16,
  },
  repositionWindow: {
    width: '100%',
    height: COVER_HEIGHT,
    overflow: 'hidden',
    borderWidth: 1,
  },
  repositionImage: {
    width: '100%',
    height: '100%',
  },
  presetButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 20,
  },
  presetBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
});
