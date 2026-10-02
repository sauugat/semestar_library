import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, StudentUser } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Avatar } from '@/components/ui/Avatar';
import { UserRow } from '@/components/ui/UserRow';
import { ResourceCard } from '@/components/ui/ResourceCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Chip } from '@/components/ui/Chip';
import { apiFetch } from '@/services/api';
import { formatTimeAgo } from '@/utils/date';

const DEPARTMENTS = ['BIT', 'BBA', 'BPharm', 'BTech', 'BLLB'];
const SEMESTERS = [
  'Semester 1',
  'Semester 2',
  'Semester 3',
  'Semester 4',
  'Semester 5',
  'Semester 6',
  'Semester 7',
  'Semester 8',
];

interface SharedFileItem {
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

interface ClassmateItem {
  studentId: string;
  name: string;
  avatarUrl?: string;
  department?: string;
  semester?: string;
  filesCount?: number | string;
  filescount?: number | string;
  isFollowing?: boolean;
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token, serverUrl, updateProfile, refreshProfile } = useAuth();
  const { colors, spacing, radii } = useTheme();

  // Active Tab: 'uploads' | 'classmates'
  const [activeTab, setActiveTab] = useState<'uploads' | 'classmates'>('uploads');

  // Shared Files Data
  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Classmates Data
  const [classmates, setClassmates] = useState<ClassmateItem[]>([]);
  const [loadingClassmates, setLoadingClassmates] = useState(false);

  // Follow Action In-flight
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  // Avatar Uploading State
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // Helper for full avatar url
  const getFullAvatarUrl = (url?: string | null) => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${serverUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  // Helper to format bytes
  const formatBytes = (bytes?: number | string) => {
    const b = Number(bytes || 0);
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Load Shared Files
  const loadFiles = useCallback(async () => {
    if (!user?.studentId) return;
    setLoadingFiles(true);
    try {
      const res = await apiFetch(`/api/profile/${user.studentId}/files`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setFiles(data);
      }
    } catch (err) {
      console.warn('Error loading files:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, [user?.studentId]);

  // Load Classmates
  const loadClassmates = useCallback(async () => {
    setLoadingClassmates(true);
    try {
      const res = await apiFetch('/api/students/suggested');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setClassmates(data);
          const map: Record<string, boolean> = {};
          data.forEach((c) => {
            map[c.studentId] = Boolean(c.isFollowing);
          });
          setFollowingMap(map);
        }
      }
    } catch (err) {
      console.warn('Error loading classmates:', err);
    } finally {
      setLoadingClassmates(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadFiles();
    loadClassmates();
  }, [loadFiles, loadClassmates]);

  // Pull to refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await refreshProfile();
    await Promise.all([loadFiles(), loadClassmates()]);
    setRefreshing(false);
  };

  // Handle Live Avatar Photo Pick & Upload
  const handlePickAvatar = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert('Permission Denied', 'Permission to access your gallery is required to change your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
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
        const uploadRes = await apiFetch('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        });

        const uploadData = await uploadRes.json().catch(() => ({}));
        setIsUploadingAvatar(false);

        if (uploadRes.ok) {
          await refreshProfile();
          Alert.alert('Success', 'Profile photo updated successfully!');
        } else {
          Alert.alert('Upload Error', uploadData.message || 'Failed to update profile photo.');
        }
      }
    } catch (err: any) {
      setIsUploadingAvatar(false);
      Alert.alert('Error', err.message || 'Failed to select image');
    }
  };

  // Toggle Follow Classmate
  const handleToggleFollow = async (classmateId: string, classmateName: string) => {
    const currentFollowing = Boolean(followingMap[classmateId]);
    // Optimistic toggle
    setFollowingMap((prev) => ({ ...prev, [classmateId]: !currentFollowing }));

    try {
      const res = await apiFetch(`/api/profile/${classmateId}/follow`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setFollowingMap((prev) => ({ ...prev, [classmateId]: Boolean(data.isFollowing) }));
        await refreshProfile();
      } else {
        // Revert on failure
        setFollowingMap((prev) => ({ ...prev, [classmateId]: currentFollowing }));
        Alert.alert('Error', data.message || 'Failed to update follow status');
      }
    } catch {
      setFollowingMap((prev) => ({ ...prev, [classmateId]: currentFollowing }));
    }
  };

  // Delete Shared Resource
  const handleDeletePost = (fileId: number, fileTitle: string) => {
    Alert.alert(
      'Delete Resource?',
      `Are you sure you want to delete "${fileTitle}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
              if (res.ok) {
                setFiles((prev) => prev.filter((f) => f.id !== fileId));
                await refreshProfile();
              } else {
                const data = await res.json().catch(() => ({}));
                Alert.alert('Error', data.message || 'Failed to delete file');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Network error while deleting');
            }
          },
        },
      ]
    );
  };

  // Open Social Link
  const handleOpenLink = async (url?: string) => {
    if (!url) return;
    const target = url.startsWith('http') ? url : `https://${url}`;
    const canOpen = await Linking.canOpenURL(target);
    if (canOpen) {
      await Linking.openURL(target);
    } else {
      Alert.alert('Cannot Open URL', target);
    }
  };

  // Share Profile
  const handleShareProfile = async () => {
    const profileUrl = `${serverUrl}/profile.html?id=${user?.studentId}`;
    await Clipboard.setStringAsync(profileUrl);
    Alert.alert('Profile Link Copied', `Copied to clipboard:\n${profileUrl}`);
  };

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'S';
  const avatarUri = getFullAvatarUrl(user?.avatarUrl);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingBottom: 64 + insets.bottom + 36,
        },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* 1. HERO CARD WITH BANNER & PROFILE IDENTITY */}
      <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Top Aurora Banner Strip */}
        <View style={[styles.bannerStrip, { backgroundColor: colors.primary }]}>
          <View style={styles.bannerAuroraOverlay} />
        </View>

        {/* Profile Identity Content */}
        <View style={styles.identityContent}>
          {/* Avatar with Camera Upload Badge */}
          <View style={styles.avatarWrapper}>
            <View
              style={[
                styles.avatarCircle,
                {
                  backgroundColor: colors.primaryLight,
                  borderColor: colors.surface,
                },
              ]}
            >
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text style={styles.avatarInitial}>{initial}</Text>
              )}

              {isUploadingAvatar && (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              )}
            </View>

            {/* Camera Upload Badge */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handlePickAvatar}
              disabled={isUploadingAvatar}
              style={[
                styles.avatarEditBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="camera-outline" size={13} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Name & Badges Row */}
          <View style={styles.nameRow}>
            <Heading style={styles.profileName}>{user?.name || 'Student'}</Heading>
            <View style={[styles.verifiedBadge, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
              <Text variant="xs" color="primary" weight="700" style={{ marginLeft: 3 }}>
                GU Student
              </Text>
            </View>
          </View>

          {/* Handle */}
          <Text variant="sm" color="muted" style={styles.profileHandle}>
            @{user?.username || user?.studentId || 'student'}
          </Text>

          {/* Accolade Ribbon if Admin or CR */}
          {(user?.isAdmin || user?.isCR || user?.role === 'admin' || user?.role === 'cr') && (
            <View
              style={[
                styles.accoladeRibbon,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
            >
              <View style={[styles.accoladeIconWrap, { backgroundColor: colors.primaryLight }]}>
                <Ionicons
                  name={user?.isAdmin ? 'shield-checkmark' : 'ribbon'}
                  size={18}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="xs" weight="700" color="primary">
                  {user?.isAdmin ? 'System Administrator' : 'Class Representative'}
                </Text>
                <Caption color="muted">
                  {user?.isAdmin
                    ? 'Gandaki University Portal Administrator & Academic Coordinator'
                    : 'Gandaki University BIT Student Representative'}
                </Caption>
              </View>
            </View>
          )}

          {/* Chips Row: Department, Semester, Campus */}
          <View style={styles.chipsRow}>
            <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <Ionicons name="school-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text variant="xs" weight="600" color="secondary">
                {user?.department || 'BIT'}
              </Text>
            </View>

            <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text variant="xs" weight="600" color="secondary">
                {user?.semester || 'Semester 1'}
              </Text>
            </View>

            <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
              <Ionicons name="globe-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text variant="xs" weight="600" color="secondary">
                Gandaki University
              </Text>
            </View>
          </View>

          {/* Bio Headline */}
          <Text
            variant="sm"
            color={user?.bio ? undefined : 'muted'}
            style={[styles.bioText, !user?.bio && { fontStyle: 'italic' }]}
          >
            {user?.bio || "No bio added yet. Tap 'Edit Profile' to introduce yourself to your classmates."}
          </Text>

          {/* Social Links Row */}
          {(user?.githubUrl || user?.linkedinUrl) && (
            <View style={styles.socialRow}>
              {user?.githubUrl ? (
                <TouchableOpacity
                  onPress={() => handleOpenLink(user.githubUrl)}
                  style={[styles.socialChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                >
                  <Ionicons name="logo-github" size={14} color={colors.text} style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="600">
                    GitHub
                  </Text>
                </TouchableOpacity>
              ) : null}

              {user?.linkedinUrl ? (
                <TouchableOpacity
                  onPress={() => handleOpenLink(user.linkedinUrl)}
                  style={[styles.socialChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                >
                  <Ionicons name="logo-linkedin" size={14} color="#0077B5" style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="600">
                    LinkedIn
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* Action CTAs: Edit Profile & Share Profile */}
          <View style={styles.actionsRow}>
            <Button
              title="Edit Profile"
              variant="primary"
              size="sm"
              onPress={() => router.push('/edit-profile')}
              leftIcon={<Ionicons name="create-outline" size={15} color={colors.primaryText} />}
              style={{ flex: 1, marginRight: spacing.xs }}
            />
            <Button
              title="Share"
              variant="outline"
              size="sm"
              onPress={handleShareProfile}
              leftIcon={<Ionicons name="share-social-outline" size={15} color={colors.text} />}
            />
          </View>
        </View>

        {/* 2. STATS BAR STRIP */}
        <View style={[styles.statsStrip, { borderTopColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
          <TouchableOpacity style={styles.statBox} onPress={() => setActiveTab('uploads')}>
            <Text variant="md" weight="800">
              {user?.stats?.filesCount ?? files.length}
            </Text>
            <Caption color="muted">Shared Files</Caption>
          </TouchableOpacity>

          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

          <View style={styles.statBox}>
            <Text variant="md" weight="800">
              {user?.stats?.likesReceived ?? 0}
            </Text>
            <Caption color="muted">Likes</Caption>
          </View>

          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

          <View style={styles.statBox}>
            <Text variant="md" weight="800">
              {user?.stats?.followersCount ?? 0}
            </Text>
            <Caption color="muted">Followers</Caption>
          </View>

          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.statBox} onPress={() => setActiveTab('classmates')}>
            <Text variant="md" weight="800">
              {user?.stats?.followingCount ?? 0}
            </Text>
            <Caption color="muted">Following</Caption>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. SEGMENTED TABS NAVIGATION */}
      <View
        style={[
          styles.tabNavContainer,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.border,
            borderRadius: radii.lg,
            marginHorizontal: spacing.md,
            marginTop: spacing.md,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveTab('uploads')}
          style={[
            styles.tabButton,
            activeTab === 'uploads' && {
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 2,
            },
          ]}
        >
          <Ionicons
            name="folder-open-outline"
            size={16}
            color={activeTab === 'uploads' ? colors.primary : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text variant="sm" weight={activeTab === 'uploads' ? '700' : '500'}>
            Shared Resources ({files.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveTab('classmates')}
          style={[
            styles.tabButton,
            activeTab === 'classmates' && {
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 2,
            },
          ]}
        >
          <Ionicons
            name="people-outline"
            size={16}
            color={activeTab === 'classmates' ? colors.primary : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text variant="sm" weight={activeTab === 'classmates' ? '700' : '500'}>
            Classmates to Follow
          </Text>
        </TouchableOpacity>
      </View>

      {/* 4. TAB 1: SHARED RESOURCES */}
      {activeTab === 'uploads' && (
        <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.md }}>
          {loadingFiles ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Caption style={{ marginTop: spacing.xs }}>Loading shared resources…</Caption>
            </View>
          ) : files.length === 0 ? (
            <EmptyState
              icon="cloud-upload-outline"
              title="No resources uploaded yet"
              description="Study notes and assignments you share will appear here for your classmates."
            />
          ) : (
            files.map((file) => (
              <ResourceCard
                key={file.id}
                id={file.id}
                title={file.title || file.originalName}
                originalName={file.originalName}
                sizeBytes={file.sizeBytes}
                uploadedAt={file.uploadedAt}
                subject={file.subject}
                chapter={file.chapter}
                liked={file.liked}
                likeCount={file.likeCount}
                canDelete={file.canDelete}
                onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
                onDelete={() => handleDeletePost(file.id, file.title || file.originalName)}
              />
            ))
          )}
        </View>
      )}

      {/* 5. TAB 2: CLASSMATES TO FOLLOW */}
      {activeTab === 'classmates' && (
        <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.md }}>
          {loadingClassmates ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Caption style={{ marginTop: spacing.xs }}>Loading classmates…</Caption>
            </View>
          ) : classmates.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No classmates registered yet"
              description="Registered students in your university will appear here."
            />
          ) : (
            classmates.map((classmate) => {
              const cAvatar = getFullAvatarUrl(classmate.avatarUrl);
              const isFollowing = Boolean(followingMap[classmate.studentId]);
              const filesShared = Number(classmate.filesCount || classmate.filescount || 0);

              return (
                <UserRow
                  key={classmate.studentId}
                  id={classmate.studentId}
                  name={classmate.name}
                  studentId={classmate.studentId}
                  avatarUrl={cAvatar}
                  program={classmate.department || 'BIT'}
                  sharedFilesCount={filesShared}
                  isFollowing={isFollowing}
                  onPress={() => router.push({ pathname: '/user/[id]', params: { id: classmate.studentId } })}
                  onToggleFollow={() => handleToggleFollow(classmate.studentId, classmate.name)}
                />
              );
            })
          )}
        </View>
      )}

      {/* 6. SETTINGS & PREFERENCES */}
      <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: 40 }}>
        <Subheading style={{ marginBottom: spacing.xs }}>Settings & Preferences</Subheading>
        <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/settings')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.sm,
                }}
              >
                <Ionicons name="settings-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="sm" weight="700">
                  Settings
                </Text>
                <Caption color="muted">Theme appearance, push notifications, security & sign out</Caption>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginVertical: spacing.xs,
            }}
          />

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/modal')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.sm,
                }}
              >
                <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="sm" weight="700">
                  About Semester Library
                </Text>
                <Caption color="muted">Version 1.0.0 &middot; Gandaki University</Caption>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  heroCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bannerStrip: {
    height: 70,
    width: '100%',
    position: 'relative',
  },
  bannerAuroraOverlay: {
    ...StyleSheet.absoluteFill,
    opacity: 0.25,
    backgroundColor: '#38BDF8',
  },
  identityContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    marginTop: -38,
  },
  avatarWrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: '800',
    color: '#3B82F6',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '800',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  profileHandle: {
    marginTop: 2,
  },
  accoladeRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
  },
  accoladeIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  bioText: {
    marginTop: 10,
    lineHeight: 20,
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
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
  },
  tabNavContainer: {
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyStateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fileCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  fileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    padding: 6,
  },
  fileTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  fileTagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  fileCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  classmateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  classmateAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  classmateAvatarImg: {
    width: '100%',
    height: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalActionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 24,
  },
});
