import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { apiFetch, getBaseUrl } from '@/services/api';

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

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { colors, spacing, radii } = useTheme();
  const { user, updateProfile, refreshProfile, serverUrl } = useAuth();

  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [dept, setDept] = useState(user?.department || 'BIT');
  const [sem, setSem] = useState(user?.semester || 'Semester 1');
  const [github, setGithub] = useState(user?.githubUrl || '');
  const [linkedin, setLinkedin] = useState(user?.linkedinUrl || '');
  const [isSaving, setIsSaving] = useState(false);

  // Cover photo and Avatar states
  const [coverUrl, setCoverUrl] = useState<string | null>(user?.coverUrl || null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl || null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const getFullUrl = useCallback(
    (path?: string | null) => {
      if (!path) return null;
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const base = serverUrl || getBaseUrl();
      return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    },
    [serverUrl]
  );

  // Cover Photo Handlers
  const handlePickCover = async () => {
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
          if (fresh?.coverUrl) setCoverUrl(fresh.coverUrl);
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          Alert.alert('Success', 'Cover photo updated!');
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

  const handleRemoveCover = () => {
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
              await refreshProfile();
              setCoverUrl(null);
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

  const handleCoverPress = () => {
    if (coverUrl) {
      Alert.alert('Cover Photo', 'Manage your cover photo', [
        { text: 'Choose from Gallery', onPress: handlePickCover },
        { text: 'Remove Cover Photo', style: 'destructive', onPress: handleRemoveCover },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      handlePickCover();
    }
  };

  // Avatar Handlers
  const handlePickAvatar = async () => {
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
          if (fresh?.avatarUrl) setAvatarUrl(fresh.avatarUrl);
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          queryClient.invalidateQueries({ queryKey: ['posts'] });
          Alert.alert('Success', 'Profile picture updated!');
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
    Alert.alert('Remove Profile Picture', 'Are you sure you want to remove your profile picture?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsUploadingAvatar(true);
          try {
            const res = await apiFetch('/api/profile/avatar', { method: 'DELETE' });
            if (res.ok) {
              await refreshProfile();
              setAvatarUrl(null);
              queryClient.invalidateQueries({ queryKey: ['profile'] });
              queryClient.invalidateQueries({ queryKey: ['posts'] });
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

  const handleAvatarPress = () => {
    if (avatarUrl) {
      Alert.alert('Profile Picture', 'Manage your profile picture', [
        { text: 'Choose from Gallery', onPress: handlePickAvatar },
        { text: 'Remove Profile Picture', style: 'destructive', onPress: handleRemoveAvatar },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      handlePickAvatar();
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation Error', 'Full Name is required.');
      return;
    }

    setIsSaving(true);
    const result = await updateProfile({
      name: name.trim(),
      bio: bio.trim(),
      department: dept.trim(),
      semester: sem.trim(),
      githubUrl: github.trim(),
      linkedinUrl: linkedin.trim(),
    });
    setIsSaving(false);

    if (result.success) {
      void refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/profile');
      }
    } else {
      Alert.alert('Error', result.error || 'Failed to update profile.');
    }
  };

  const handleCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleCancel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBtn}
        >
          <Text variant="sm" color="secondary" weight="600">
            Cancel
          </Text>
        </TouchableOpacity>

        <Heading style={{ fontSize: 17 }}>Edit Profile</Heading>

        <TouchableOpacity
          onPress={handleSave}
          disabled={isSaving || !name.trim()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBtn}
        >
          <Text
            variant="sm"
            color="primary"
            weight="700"
            style={{ opacity: isSaving || !name.trim() ? 0.5 : 1 }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Keyboard-Aware Form Body */}
      <KeyboardAwareForm
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, 24) + 16,
        }}
        clearance={24}
      >
        {/* Cover Photo & Avatar Visual Header */}
        <View style={styles.photoSection}>
          <TouchableOpacity
            style={[styles.coverBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            onPress={handleCoverPress}
            activeOpacity={0.85}
          >
            {coverUrl ? (
              <Image
                source={{ uri: getFullUrl(coverUrl)! }}
                style={styles.coverImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="images-outline" size={28} color={colors.textMuted} />
                <Text variant="xs" color="muted" style={{ marginTop: 4 }}>
                  Add Cover Photo
                </Text>
              </View>
            )}

            {/* Dark glass pill on cover */}
            <View style={styles.coverEditPill}>
              {isUploadingCover ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={13} color="#FFFFFF" />
                  <Text variant="xs" weight="700" style={{ color: '#FFFFFF', marginLeft: 4, fontSize: 11 }}>
                    {coverUrl ? 'Edit Cover' : 'Add Cover'}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          {/* Overlapping Avatar Circle */}
          <View style={styles.avatarContainer}>
            <TouchableOpacity
              onPress={handleAvatarPress}
              activeOpacity={0.8}
              style={[
                styles.avatarTouch,
                {
                  borderColor: colors.background,
                  backgroundColor: colors.surfaceRaised,
                },
              ]}
            >
              <Avatar
                url={getFullUrl(avatarUrl)}
                name={name || user?.name}
                size="xxl"
                style={{ width: 76, height: 76, borderRadius: 38 }}
              />
              <View
                style={[
                  styles.avatarCameraBadge,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.background,
                  },
                ]}
              >
                {isUploadingAvatar ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons name="camera" size={13} color={colors.text} />
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <TextField
          label="Full Name *"
          placeholder="e.g. John Doe"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        <TextField
          label="Bio / Headline"
          placeholder="Brief intro for your classmates…"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={3}
          maxLength={300}
          helper={`${bio.length}/300 characters`}
        />

        {/* Department Selector */}
        <View style={{ marginBottom: spacing.normal }}>
          <Text
            variant="sm"
            color="secondary"
            weight="600"
            style={{ marginBottom: spacing.tight }}
          >
            Department
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.tight, paddingVertical: 2 }}
          >
            {DEPARTMENTS.map((d) => (
              <Chip
                key={d}
                label={d}
                selected={dept === d}
                onPress={() => setDept(d)}
                size="sm"
              />
            ))}
          </ScrollView>
        </View>

        {/* Semester Selector */}
        <View style={{ marginBottom: spacing.normal }}>
          <Text
            variant="sm"
            color="secondary"
            weight="600"
            style={{ marginBottom: spacing.tight }}
          >
            Semester
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.tight, paddingVertical: 2 }}
          >
            {SEMESTERS.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={sem === s}
                onPress={() => setSem(s)}
                size="sm"
              />
            ))}
          </ScrollView>
        </View>

        <TextField
          label="GitHub Profile URL"
          placeholder="https://github.com/username"
          value={github}
          onChangeText={setGithub}
          autoCapitalize="none"
          keyboardType="url"
        />

        <TextField
          label="LinkedIn Profile URL"
          placeholder="https://linkedin.com/in/username"
          value={linkedin}
          onChangeText={setLinkedin}
          autoCapitalize="none"
          keyboardType="url"
        />

        {/* Save Button */}
        <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
          <Button
            title="Save Profile Changes"
            variant="primary"
            size="lg"
            loading={isSaving}
            onPress={handleSave}
          />
        </View>
      </KeyboardAwareForm>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  photoSection: {
    marginBottom: 16,
  },
  coverBanner: {
    width: '100%',
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEditPill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  avatarContainer: {
    marginTop: -38,
    paddingHorizontal: 12,
  },
  avatarTouch: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    position: 'relative',
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
