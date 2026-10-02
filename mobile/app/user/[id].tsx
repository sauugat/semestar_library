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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useAuth, StudentUser } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ResourceCard } from '@/components/ui/ResourceCard';
import { formatTimeAgo } from '@/utils/date';
import { Input } from '@/components/ui/Input';
import { apiFetch } from '@/services/api';

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

interface StudentProfileData extends StudentUser {
  isSelf?: boolean;
  isFollowing?: boolean;
}

export default function StudentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: currentUser, serverUrl, updateProfile, refreshProfile } = useAuth();
  const { colors, spacing, radii } = useTheme();

  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [files, setFiles] = useState<SharedFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const targetStudentId = id || currentUser?.studentId;

  const getFullAvatarUrl = (url?: string | null) => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${serverUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const formatBytes = (bytes?: number | string) => {
    const b = Number(bytes || 0);
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const fetchProfileData = useCallback(async () => {
    if (!targetStudentId) return;
    try {
      const [profileRes, filesRes] = await Promise.all([
        apiFetch(`/api/profile/${targetStudentId}`),
        apiFetch(`/api/profile/${targetStudentId}/files`),
      ]);

      if (profileRes.ok) {
        const data: StudentProfileData = await profileRes.json();
        setProfile(data);
        setIsFollowing(Boolean(data.isFollowing));
        setFollowersCount(data.stats?.followersCount || 0);
      }

      if (filesRes.ok) {
        const filesData = await filesRes.json();
        if (Array.isArray(filesData)) setFiles(filesData);
      }
    } catch (err) {
      console.warn('Error fetching student profile:', err);
    } finally {
      setLoading(false);
    }
  }, [targetStudentId]);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfileData();
    setRefreshing(false);
  };

  const handleToggleFollow = async () => {
    if (!profile) return;
    const prev = isFollowing;
    const prevCount = followersCount;

    // Optimistic toggle
    setIsFollowing(!prev);
    setFollowersCount(prev ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const res = await apiFetch(`/api/profile/${profile.studentId}/follow`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setIsFollowing(Boolean(data.isFollowing));
        setFollowersCount(data.followersCount);
        await refreshProfile();
      } else {
        // Revert
        setIsFollowing(prev);
        setFollowersCount(prevCount);
        Alert.alert('Error', data.message || 'Failed to update follow status');
      }
    } catch {
      setIsFollowing(prev);
      setFollowersCount(prevCount);
    }
  };

  const openEditModal = () => {
    router.push('/edit-profile');
  };

  const handlePickAvatar = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert('Permission Denied', 'Permission to access your gallery is required.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
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
          await fetchProfileData();
          await refreshProfile();
          Alert.alert('Success', 'Profile photo updated successfully!');
        } else {
          Alert.alert('Upload Error', uploadData.message || 'Failed to update photo.');
        }
      }
    } catch (err: any) {
      setIsUploadingAvatar(false);
      Alert.alert('Error', err.message || 'Failed to select image');
    }
  };

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

  const handleShareProfile = async () => {
    const profileUrl = `${serverUrl}/profile.html?id=${targetStudentId}`;
    await Clipboard.setStringAsync(profileUrl);
    Alert.alert('Profile Link Copied', `Copied to clipboard:\n${profileUrl}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Caption style={{ marginTop: spacing.sm }}>Loading student profile…</Caption>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="person-circle-outline"
          title="Student Not Found"
          description={`Could not locate student with ID: ${targetStudentId}`}
          actionTitle="Go Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  const isSelf = profile.isSelf || profile.studentId === currentUser?.studentId;
  const avatarUri = getFullAvatarUrl(profile.avatarUrl);
  const initial = profile.name ? profile.name.charAt(0).toUpperCase() : 'S';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header bar */}
      <View style={[styles.navHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text variant="md" weight="700" numberOfLines={1} style={{ flex: 1, marginHorizontal: 8 }}>
          {profile.name}
        </Text>
        <TouchableOpacity onPress={handleShareProfile} style={styles.shareBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="share-social-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* HERO CARD */}
        <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.bannerStrip, { backgroundColor: colors.primary }]}>
            <View style={styles.bannerAuroraOverlay} />
          </View>

          <View style={styles.identityContent}>
            {/* Avatar */}
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight, borderColor: colors.surface }]}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Text style={styles.avatarInitial}>{initial}</Text>
                )}

                {isUploadingAvatar && (
                  <View style={styles.avatarLoadingOverlay}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                )}
              </View>

              {isSelf && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handlePickAvatar}
                  disabled={isUploadingAvatar}
                  style={[styles.avatarEditBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}
                >
                  <Ionicons name="camera" size={13} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>

            {/* Name & Badges */}
            <View style={styles.nameRow}>
              <Heading style={styles.profileName}>{profile.name}</Heading>
              <View style={[styles.verifiedBadge, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
                <Text variant="xs" color="primary" weight="700" style={{ marginLeft: 3 }}>
                  GU Student
                </Text>
              </View>
            </View>

            <Text variant="sm" color="muted" style={styles.profileHandle}>
              @{profile.username || profile.studentId}
            </Text>

            {/* Accolade Ribbon */}
            {(profile.isAdmin || profile.isCR || profile.role === 'admin' || profile.role === 'cr') && (
              <View style={[styles.accoladeRibbon, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderRadius: radii.md }]}>
                <View style={[styles.accoladeIconWrap, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name={profile.isAdmin ? 'shield-checkmark' : 'ribbon'} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text variant="xs" weight="700" color="primary">
                    {profile.isAdmin ? 'System Administrator' : 'Class Representative'}
                  </Text>
                  <Caption color="muted">
                    {profile.isAdmin
                      ? 'Gandaki University Academic Coordinator & Portal Admin'
                      : 'Gandaki University BIT Student Representative'}
                  </Caption>
                </View>
              </View>
            )}

            {/* Chips Row */}
            <View style={styles.chipsRow}>
              <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Ionicons name="school-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text variant="xs" weight="600" color="secondary">
                  {profile.department || 'BIT'}
                </Text>
              </View>

              <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text variant="xs" weight="600" color="secondary">
                  {profile.semester || 'Semester 1'}
                </Text>
              </View>

              <View style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Ionicons name="globe-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text variant="xs" weight="600" color="secondary">
                  Gandaki University
                </Text>
              </View>
            </View>

            {/* Bio */}
            <Text variant="sm" color={profile.bio ? undefined : 'muted'} style={[styles.bioText, !profile.bio && { fontStyle: 'italic' }]}>
              {profile.bio || 'No bio added yet.'}
            </Text>

            {/* Social Chips */}
            {(profile.githubUrl || profile.linkedinUrl) && (
              <View style={styles.socialRow}>
                {profile.githubUrl ? (
                  <TouchableOpacity
                    onPress={() => handleOpenLink(profile.githubUrl)}
                    style={[styles.socialChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                  >
                    <Ionicons name="logo-github" size={14} color={colors.text} style={{ marginRight: 4 }} />
                    <Text variant="xs" weight="600">
                      GitHub
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {profile.linkedinUrl ? (
                  <TouchableOpacity
                    onPress={() => handleOpenLink(profile.linkedinUrl)}
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

            {/* Action CTAs */}
            <View style={styles.actionsRow}>
              {isSelf ? (
                <Button
                  title="Edit Profile"
                  variant="primary"
                  size="sm"
                  onPress={openEditModal}
                  leftIcon={<Ionicons name="create-outline" size={15} color={colors.primaryText} />}
                  style={{ flex: 1 }}
                />
              ) : (
                <Button
                  title={isFollowing ? 'Following' : 'Follow'}
                  variant={isFollowing ? 'secondary' : 'primary'}
                  size="sm"
                  onPress={handleToggleFollow}
                  leftIcon={
                    <Ionicons
                      name={isFollowing ? 'checkmark' : 'person-add-outline'}
                      size={14}
                      color={isFollowing ? colors.text : colors.primaryText}
                    />
                  }
                  style={{ flex: 1, marginRight: spacing.xs }}
                />
              )}
              <Button
                title="Share"
                variant="outline"
                size="sm"
                onPress={handleShareProfile}
                leftIcon={<Ionicons name="share-social-outline" size={15} color={colors.text} />}
                style={isSelf ? { marginLeft: spacing.xs } : undefined}
              />
            </View>
          </View>

          {/* Stats Bar */}
          <View style={[styles.statsStrip, { borderTopColor: colors.border, backgroundColor: colors.surfaceSubtle }]}>
            <View style={styles.statBox}>
              <Text variant="md" weight="800">
                {profile.stats?.filesCount ?? files.length}
              </Text>
              <Caption color="muted">Shared Files</Caption>
            </View>

            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

            <View style={styles.statBox}>
              <Text variant="md" weight="800">
                {profile.stats?.likesReceived ?? 0}
              </Text>
              <Caption color="muted">Likes</Caption>
            </View>

            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

            <View style={styles.statBox}>
              <Text variant="md" weight="800">
                {followersCount}
              </Text>
              <Caption color="muted">Followers</Caption>
            </View>

            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

            <View style={styles.statBox}>
              <Text variant="md" weight="800">
                {profile.stats?.followingCount ?? 0}
              </Text>
              <Caption color="muted">Following</Caption>
            </View>
          </View>
        </View>

        {/* SHARED RESOURCES FEED */}
        <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.sm }}>
          <View style={styles.sectionHeaderRow}>
            <Subheading>Shared Resources ({files.length})</Subheading>
          </View>

          {files.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              title="No resources uploaded yet"
              description={`Study materials shared by ${profile.name} will appear here.`}
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
                onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    padding: 4,
  },
  shareBtn: {
    padding: 4,
  },
  container: {
    flexGrow: 1,
    paddingBottom: 40,
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
  sectionHeaderRow: {
    marginBottom: 8,
  },
  emptyCard: {
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
  modalActionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 24,
  },
});
