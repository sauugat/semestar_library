import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
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

  // Edit Modal State (when viewing self)
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editSem, setEditSem] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editLinkedin, setEditLinkedin] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
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

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const getFileIcon = (name: string): { icon: keyof typeof Ionicons.glyphMap; color: string } => {
    const ext = (name || '').split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return { icon: 'document-text', color: '#EF4444' };
    if (['ppt', 'pptx'].includes(ext || '')) return { icon: 'easel', color: '#F97316' };
    if (['doc', 'docx'].includes(ext || '')) return { icon: 'document', color: '#3B82F6' };
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext || '')) return { icon: 'image', color: '#10B981' };
    if (['zip', 'rar', '7z', 'tar'].includes(ext || '')) return { icon: 'archive', color: '#8B5CF6' };
    if (['c', 'cpp', 'py', 'java', 'js', 'html', 'css', 'sql'].includes(ext || ''))
      return { icon: 'code-slash', color: '#06B6D4' };
    return { icon: 'document-outline', color: '#6B7280' };
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
    if (!profile) return;
    setEditName(profile.name || '');
    setEditBio(profile.bio || '');
    setEditDept(profile.department || 'BIT');
    setEditSem(profile.semester || 'Semester 1');
    setEditGithub(profile.githubUrl || '');
    setEditLinkedin(profile.linkedinUrl || '');
    setShowEditModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert('Validation Error', 'Full Name is required.');
      return;
    }

    setIsSavingProfile(true);
    const result = await updateProfile({
      name: editName.trim(),
      bio: editBio.trim(),
      department: editDept.trim(),
      semester: editSem.trim(),
      githubUrl: editGithub.trim(),
      linkedinUrl: editLinkedin.trim(),
    });
    setIsSavingProfile(false);

    if (result.success) {
      setShowEditModal(false);
      await fetchProfileData();
      Alert.alert('Success', 'Profile updated successfully!');
    } else {
      Alert.alert('Error', result.error || 'Failed to update profile.');
    }
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
        <Ionicons name="person-circle-outline" size={54} color={colors.textMuted} />
        <Heading style={{ marginTop: spacing.sm }}>Student Not Found</Heading>
        <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
          Could not locate student with ID: {targetStudentId}
        </Caption>
        <Button
          title="Go Back"
          variant="primary"
          size="sm"
          onPress={() => router.back()}
          style={{ marginTop: spacing.md }}
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
                  leftIcon={<Ionicons name="create-outline" size={15} color="#FFFFFF" />}
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
                      color={isFollowing ? colors.text : '#FFFFFF'}
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
            <Card style={styles.emptyCard}>
              <Ionicons name="folder-open-outline" size={38} color={colors.textMuted} />
              <Text variant="sm" weight="600" style={{ marginTop: spacing.xs }}>
                No resources uploaded yet
              </Text>
              <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
                Study materials shared by {profile.name} will appear here.
              </Caption>
            </Card>
          ) : (
            files.map((file) => {
              const fileStyle = getFileIcon(file.originalName);
              return (
                <Card
                  key={file.id}
                  variant="elevated"
                  onPress={() => router.push(`/material/${file.id}?preview=1` as any)}
                  style={[styles.fileCard, { borderColor: colors.border, marginBottom: spacing.sm }]}
                >
                  <View style={styles.fileCardHeader}>
                    <View style={[styles.fileIconBadge, { backgroundColor: `${fileStyle.color}15`, borderColor: `${fileStyle.color}40` }]}>
                      <Ionicons name={fileStyle.icon} size={22} color={fileStyle.color} />
                    </View>

                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text variant="sm" weight="700" numberOfLines={1}>
                        {file.title || file.originalName}
                      </Text>
                      <Caption color="muted" numberOfLines={1}>
                        {formatBytes(file.sizeBytes)} &middot; {formatTimeAgo(file.uploadedAt)}
                      </Caption>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>

                  {(file.subject || file.chapter) && (
                    <View style={styles.fileTagsRow}>
                      {file.subject ? (
                        <View style={[styles.fileTagChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                          <Text variant="xs" color="secondary" weight="500">
                            {file.subject}
                          </Text>
                        </View>
                      ) : null}
                      {file.chapter ? (
                        <View style={[styles.fileTagChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                          <Text variant="xs" color="secondary" weight="500">
                            {file.chapter}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  <View style={[styles.fileCardFooter, { borderTopColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons
                        name={file.liked ? 'heart' : 'heart-outline'}
                        size={14}
                        color={file.liked ? colors.error : colors.textMuted}
                        style={{ marginRight: 4 }}
                      />
                      <Text variant="xs" color="muted">
                        {file.likeCount || 0} likes
                      </Text>
                    </View>
                    <Caption color="muted">Tap to view note</Caption>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* EDIT PROFILE MODAL */}
      <Modal visible={showEditModal} animationType="slide" transparent onRequestClose={() => setShowEditModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Heading style={{ fontSize: 18 }}>Edit Profile</Heading>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Input label="Full Name" placeholder="e.g. Saugat Subedi" value={editName} onChangeText={setEditName} autoCapitalize="words" />
              <Input label="Bio / Headline" placeholder="Brief intro for your classmates…" value={editBio} onChangeText={setEditBio} multiline numberOfLines={3} helper="Max 300 characters" />
              <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, marginRight: spacing.xs }}>
                  <Input label="Department" placeholder="BIT" value={editDept} onChangeText={setEditDept} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.xs }}>
                  <Input label="Semester" placeholder="Semester 1" value={editSem} onChangeText={setEditSem} />
                </View>
              </View>
              <Input label="GitHub Profile URL" placeholder="https://github.com/username" value={editGithub} onChangeText={setEditGithub} autoCapitalize="none" keyboardType="url" />
              <Input label="LinkedIn Profile URL" placeholder="https://linkedin.com/in/username" value={editLinkedin} onChangeText={setEditLinkedin} autoCapitalize="none" keyboardType="url" />

              <View style={styles.modalActionButtons}>
                <Button title="Cancel" variant="outline" size="md" onPress={() => setShowEditModal(false)} style={{ flex: 1, marginRight: spacing.xs }} />
                <Button title="Save Changes" variant="primary" size="md" loading={isSavingProfile} onPress={handleSaveProfile} style={{ flex: 1, marginLeft: spacing.xs }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
