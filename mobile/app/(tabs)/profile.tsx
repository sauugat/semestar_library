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
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth, StudentUser } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiFetch } from '@/services/api';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  requestNotificationPermission,
  NotificationPreferences,
} from '@/services/notifications';

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
  const { user, token, serverUrl, updateServerUrl, updateProfile, refreshProfile, logout } = useAuth();
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

  // Edit Profile Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editBio, setEditBio] = useState(user?.bio || '');
  const [editDept, setEditDept] = useState(user?.department || 'BIT');
  const [editSem, setEditSem] = useState(user?.semester || 'Semester 1');
  const [editGithub, setEditGithub] = useState(user?.githubUrl || '');
  const [editLinkedin, setEditLinkedin] = useState(user?.linkedinUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Avatar Uploading State
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Server URL Configuration Card
  const [editingUrl, setEditingUrl] = useState(serverUrl);
  const [urlSaved, setUrlSaved] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Change Password State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Notification Preferences State
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    muteChat: false,
    notifyNotes: true,
    notifyPosts: true,
    notifyNotices: true,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [updatingPrefKey, setUpdatingPrefKey] = useState<string | null>(null);
  const [systemPermissionGranted, setSystemPermissionGranted] = useState<boolean | null>(null);

  // Load preferences from server
  useEffect(() => {
    let isMounted = true;
    if (!token) return;

    void (async () => {
      try {
        setLoadingPrefs(true);
        const perm = await Notifications.getPermissionsAsync().catch(() => null);
        if (isMounted) setSystemPermissionGranted(perm?.status === 'granted');

        const serverPrefs = await getNotificationPreferences();
        if (isMounted && serverPrefs) {
          setNotifPrefs(serverPrefs);
        }
      } catch (err) {
        console.warn('Failed to load notification settings:', err);
      } finally {
        if (isMounted) setLoadingPrefs(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleTogglePref = async (key: keyof NotificationPreferences, nextValue: boolean) => {
    // If user enables a category while OS notification permission is missing, prompt to request or open settings
    if (nextValue && systemPermissionGranted === false && key !== 'muteChat') {
      const granted = await requestNotificationPermission();
      setSystemPermissionGranted(granted);
      if (!granted) {
        Alert.alert(
          'Notifications Disabled in OS',
          'Notifications for Semester Library are disabled in your device settings. Would you like to open Settings to enable them?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
      }
    }

    // Optimistic UI update with rollback on failure
    const prevPrefs = { ...notifPrefs };
    const updated = { ...notifPrefs, [key]: nextValue };
    setNotifPrefs(updated);
    setUpdatingPrefKey(key);

    const res = await updateNotificationPreferences({ [key]: nextValue });
    setUpdatingPrefKey(null);

    if (!res.success) {
      setNotifPrefs(prevPrefs);
      Alert.alert('Update Failed', res.error || 'Could not save notification preferences. Please try again.');
    }
  };

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

  // Helper for time ago
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

  // Helper for file type icon
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

  // Open Edit Profile Modal
  const openEditModal = () => {
    setEditName(user?.name || '');
    setEditBio(user?.bio || '');
    setEditDept(user?.department || 'BIT');
    setEditSem(user?.semester || 'Semester 1');
    setEditGithub(user?.githubUrl || '');
    setEditLinkedin(user?.linkedinUrl || '');
    setShowEditModal(true);
  };

  // Save Profile Changes
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
      Alert.alert('Success', 'Profile updated successfully!');
    } else {
      Alert.alert('Error', result.error || 'Failed to update profile.');
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

  // Change Password Action
  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await apiFetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      setIsChangingPassword(false);

      if (res.ok) {
        setPasswordSuccess(data.message || 'Password successfully updated!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => {
          setShowPasswordModal(false);
          setPasswordSuccess(null);
          Alert.alert('Success', 'Your password has been updated successfully.');
        }, 1200);
      } else {
        setPasswordError(data.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setIsChangingPassword(false);
      setPasswordError(err.message || 'Network error while updating password.');
    }
  };

  // Save LAN URL
  const handleSaveUrl = async () => {
    await updateServerUrl(editingUrl);
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
  };

  // Logout
  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? Your stored authentication session will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            await logout();
            setIsLoggingOut(false);
          },
        },
      ]
    );
  };

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'S';
  const avatarUri = getFullAvatarUrl(user?.avatarUrl);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}
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
                  backgroundColor: colors.primary,
                  borderColor: colors.surface,
                },
              ]}
            >
              <Ionicons name="camera" size={14} color="#FFFFFF" />
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
              onPress={openEditModal}
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
            <Card style={styles.emptyStateCard}>
              <Ionicons name="cloud-upload-outline" size={38} color={colors.textMuted} />
              <Text variant="sm" weight="600" style={{ marginTop: spacing.xs }}>
                No resources uploaded yet
              </Text>
              <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
                Study notes and assignments you share will appear here for your classmates.
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
                    <View
                      style={[
                        styles.fileIconBadge,
                        { backgroundColor: `${fileStyle.color}15`, borderColor: `${fileStyle.color}40` },
                      ]}
                    >
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

                    {file.canDelete && (
                      <TouchableOpacity
                        onPress={() => handleDeletePost(file.id, file.title || file.originalName)}
                        style={styles.deleteButton}
                      >
                        <Ionicons name="trash-outline" size={17} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {(file.subject || file.chapter) && (
                    <View style={styles.fileTagsRow}>
                      {file.subject ? (
                        <View
                          style={[
                            styles.fileTagChip,
                            { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                          ]}
                        >
                          <Text variant="xs" color="secondary" weight="500">
                            {file.subject}
                          </Text>
                        </View>
                      ) : null}
                      {file.chapter ? (
                        <View
                          style={[
                            styles.fileTagChip,
                            { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                          ]}
                        >
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
                        size={15}
                        color={file.liked ? colors.error : colors.textMuted}
                        style={{ marginRight: 4 }}
                      />
                      <Text variant="xs" color="muted">
                        {file.likeCount || 0} likes
                      </Text>
                    </View>
                    <Caption color="muted">Public to Gandaki University</Caption>
                  </View>
                </Card>
              );
            })
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
            <Card style={styles.emptyStateCard}>
              <Ionicons name="people-outline" size={38} color={colors.textMuted} />
              <Text variant="sm" weight="600" style={{ marginTop: spacing.xs }}>
                No classmates registered yet
              </Text>
              <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
                Registered students in your university will appear here.
              </Caption>
            </Card>
          ) : (
            classmates.map((classmate) => {
              const cAvatar = getFullAvatarUrl(classmate.avatarUrl);
              const cInitial = classmate.name ? classmate.name.charAt(0).toUpperCase() : 'S';
              const isFollowing = Boolean(followingMap[classmate.studentId]);
              const filesShared = Number(classmate.filesCount || classmate.filescount || 0);

              return (
                <Card
                  key={classmate.studentId}
                  variant="elevated"
                  style={[styles.classmateCard, { borderColor: colors.border, marginBottom: spacing.sm }]}
                >
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => router.push({ pathname: '/user/[id]', params: { id: classmate.studentId } })}
                    style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}
                  >
                    <View
                      style={[
                        styles.classmateAvatar,
                        { backgroundColor: colors.primaryLight, borderColor: colors.primary },
                      ]}
                    >
                      {cAvatar ? (
                        <Image source={{ uri: cAvatar }} style={styles.classmateAvatarImg} contentFit="cover" />
                      ) : (
                        <Text style={[styles.avatarInitial, { fontSize: 16 }]}>{cInitial}</Text>
                      )}
                    </View>

                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text variant="sm" weight="700">
                        {classmate.name}
                      </Text>
                      <Caption color="muted">
                        @{classmate.studentId} &middot; {classmate.department || 'BIT'}
                      </Caption>
                      <Caption color="secondary" style={{ marginTop: 2 }}>
                        {filesShared} shared {filesShared === 1 ? 'file' : 'files'}
                      </Caption>
                    </View>
                  </TouchableOpacity>

                  <Button
                    title={isFollowing ? 'Following' : 'Follow'}
                    variant={isFollowing ? 'secondary' : 'primary'}
                    size="sm"
                    onPress={() => handleToggleFollow(classmate.studentId, classmate.name)}
                    leftIcon={
                      <Ionicons
                        name={isFollowing ? 'checkmark' : 'person-add-outline'}
                        size={13}
                        color={isFollowing ? colors.text : '#FFFFFF'}
                      />
                    }
                  />
                </Card>
              );
            })
          )}
        </View>
      )}

      {/* 6. ACCOUNT SECURITY & PREFERENCES */}
      <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.lg }}>
        <Subheading style={{ marginBottom: spacing.xs }}>Account & Security</Subheading>
        <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.sm,
                }}
              >
                <Ionicons name="key-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="sm" weight="700">
                  Password
                </Text>
                <Caption color="muted">Change your account sign-in password</Caption>
              </View>
            </View>
            <Button
              title="Change"
              variant="outline"
              size="sm"
              onPress={() => {
                setPasswordError(null);
                setPasswordSuccess(null);
                setCurrentPassword('');
                setNewPassword('');
                setConfirmNewPassword('');
                setShowPasswordModal(true);
              }}
            />
          </View>

          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginVertical: spacing.sm,
            }}
          />

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/modal')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
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

        {/* NOTIFICATION PREFERENCES CARD */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
          <Subheading>Notification Preferences</Subheading>
          {loadingPrefs && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
        <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          {systemPermissionGranted === false && (
            <TouchableOpacity
              onPress={() => Linking.openSettings().catch(() => {})}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceSubtle || '#262626',
                padding: 10,
                borderRadius: radii.sm,
                marginBottom: spacing.sm,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Ionicons name="notifications-off-outline" size={18} color="#EF4444" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text variant="xs" weight="600">System Notifications Disabled</Text>
                <Caption color="muted">Tap to open system settings and enable push alerts.</Caption>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Group Chat */}
          <View style={styles.notifPrefRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text variant="sm" weight="600">Group Chat</Text>
              <Caption color="muted">Incoming messages from your class group chat</Caption>
            </View>
            {updatingPrefKey === 'muteChat' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={!notifPrefs.muteChat}
                onValueChange={(val) => void handleTogglePref('muteChat', !val)}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            )}
          </View>

          <View style={styles.notifDivider} />

          {/* Study Materials */}
          <View style={styles.notifPrefRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text variant="sm" weight="600">Study Materials</Text>
              <Caption color="muted">New notes and PDFs uploaded for your semester</Caption>
            </View>
            {updatingPrefKey === 'notifyNotes' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={notifPrefs.notifyNotes}
                onValueChange={(val) => void handleTogglePref('notifyNotes', val)}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            )}
          </View>

          <View style={styles.notifDivider} />

          {/* Feed Posts */}
          <View style={styles.notifPrefRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text variant="sm" weight="600">Feed Posts</Text>
              <Caption color="muted">New discussions and questions on campus feed</Caption>
            </View>
            {updatingPrefKey === 'notifyPosts' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={notifPrefs.notifyPosts}
                onValueChange={(val) => void handleTogglePref('notifyPosts', val)}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            )}
          </View>

          <View style={styles.notifDivider} />

          {/* Official Notices */}
          <View style={styles.notifPrefRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text variant="sm" weight="600">Official Notices</Text>
              <Caption color="muted">Urgent announcements from campus administration</Caption>
            </View>
            {updatingPrefKey === 'notifyNotices' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={notifPrefs.notifyNotices}
                onValueChange={(val) => void handleTogglePref('notifyNotices', val)}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            )}
          </View>
        </Card>

        {/* SESSION SECURITY CARD */}
        <Subheading style={{ marginBottom: spacing.xs }}>Session Security</Subheading>
        <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          <View style={styles.infoRow}>
            <Text variant="sm" color="secondary">
              Auth Identity:
            </Text>
            <Text variant="sm" weight="600">
              {user?.role ? user.role.toUpperCase() : 'STUDENT'} ({user?.studentId})
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="sm" color="secondary">
              Key Storage:
            </Text>
            <Text variant="sm" weight="600" color="success">
              Hardware SecureStore
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="sm" color="secondary">
              Mobile Token:
            </Text>
            <Text variant="xs" weight="600" style={{ fontFamily: 'monospace' }}>
              {token ? `${token.substring(0, 14)}...` : 'None'}
            </Text>
          </View>
        </Card>

        {/* LAN Server Configuration */}
        <Subheading style={{ marginBottom: spacing.xs }}>Server Connection</Subheading>
        <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          <Input
            label="Backend LAN URL"
            value={editingUrl}
            onChangeText={setEditingUrl}
            autoCapitalize="none"
            autoCorrect={false}
            helper={urlSaved ? '✅ Saved successfully!' : 'IP and port of your Semester Library server'}
          />
          <Button
            title={urlSaved ? 'Saved!' : 'Update Server URL'}
            variant="secondary"
            size="sm"
            onPress={handleSaveUrl}
          />
        </Card>

        {/* Sign Out Button */}
        <Button
          title="Sign Out"
          variant="danger"
          size="lg"
          loading={isLoggingOut}
          onPress={handleLogout}
          leftIcon={<Ionicons name="log-out-outline" size={20} color="#FFFFFF" />}
          style={{ marginBottom: 40 }}
        />
      </View>

      {/* 7. EDIT PROFILE MODAL */}
      <Modal visible={showEditModal} animationType="slide" transparent onRequestClose={() => setShowEditModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Heading style={{ fontSize: 18 }}>Edit Profile</Heading>
              <TouchableOpacity onPress={() => setShowEditModal(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Input
                label="Full Name"
                placeholder="e.g. Full Name"
                value={editName}
                onChangeText={setEditName}
                autoCapitalize="words"
              />

              <Input
                label="Bio / Headline"
                placeholder="e.g. BIT student, passionate about Cloud & AI…"
                value={editBio}
                onChangeText={setEditBio}
                multiline
                numberOfLines={3}
                helper="Max 300 characters"
              />

              <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, marginRight: spacing.xs }}>
                  <Input
                    label="Department"
                    placeholder="BIT"
                    value={editDept}
                    onChangeText={setEditDept}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.xs }}>
                  <Input
                    label="Semester"
                    placeholder="Semester 1"
                    value={editSem}
                    onChangeText={setEditSem}
                  />
                </View>
              </View>

              <Input
                label="GitHub Profile URL"
                placeholder="https://github.com/username"
                value={editGithub}
                onChangeText={setEditGithub}
                autoCapitalize="none"
                keyboardType="url"
              />

              <Input
                label="LinkedIn Profile URL"
                placeholder="https://linkedin.com/in/username"
                value={editLinkedin}
                onChangeText={setEditLinkedin}
                autoCapitalize="none"
                keyboardType="url"
              />

              <View style={styles.modalActionButtons}>
                <Button
                  title="Cancel"
                  variant="outline"
                  size="md"
                  onPress={() => setShowEditModal(false)}
                  style={{ flex: 1, marginRight: spacing.xs }}
                />
                <Button
                  title="Save Changes"
                  variant="primary"
                  size="md"
                  loading={isSavingProfile}
                  onPress={handleSaveProfile}
                  style={{ flex: 1, marginLeft: spacing.xs }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 8. CHANGE PASSWORD MODAL */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Heading style={{ fontSize: 18 }}>Change Password</Heading>
                <Caption color="muted">Enter your current password and a new secure password</Caption>
              </View>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {passwordError ? (
                <View
                  style={{
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.error,
                    borderLeftWidth: 4,
                    borderRadius: radii.sm,
                    padding: spacing.sm,
                    marginBottom: spacing.md,
                  }}
                >
                  <Text variant="xs" color="error" weight="600">
                    {passwordError}
                  </Text>
                </View>
              ) : null}

              {passwordSuccess ? (
                <View
                  style={{
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.success,
                    borderLeftWidth: 4,
                    borderRadius: radii.sm,
                    padding: spacing.sm,
                    marginBottom: spacing.md,
                  }}
                >
                  <Text variant="xs" color="success" weight="600">
                    {passwordSuccess}
                  </Text>
                </View>
              ) : null}

              <Input
                label="Current Password"
                placeholder="Enter current password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              <Input
                label="New Password"
                placeholder="At least 6 characters"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                helper="Minimum 6 characters recommended"
              />

              <Input
                label="Confirm New Password"
                placeholder="Re-enter new password"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              <View style={styles.modalActionButtons}>
                <Button
                  title="Cancel"
                  variant="outline"
                  size="md"
                  onPress={() => setShowPasswordModal(false)}
                  style={{ flex: 1, marginRight: spacing.xs }}
                />
                <Button
                  title="Update Password"
                  variant="primary"
                  size="md"
                  loading={isChangingPassword}
                  onPress={handleChangePassword}
                  style={{ flex: 1, marginLeft: spacing.xs }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
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
  notifPrefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  notifDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 4,
  },
});
