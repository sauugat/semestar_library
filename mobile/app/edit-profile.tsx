import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';

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
  const { colors, spacing, radii } = useTheme();
  const { user, updateProfile, refreshProfile } = useAuth();

  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [dept, setDept] = useState(user?.department || 'BIT');
  const [sem, setSem] = useState(user?.semester || 'Semester 1');
  const [github, setGithub] = useState(user?.githubUrl || '');
  const [linkedin, setLinkedin] = useState(user?.linkedinUrl || '');
  const [isSaving, setIsSaving] = useState(false);

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
});
