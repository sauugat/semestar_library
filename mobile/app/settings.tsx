import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeMode } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { apiFetch } from '@/services/api';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  NotificationPreferences,
} from '@/services/notifications';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, spacing, radii, isDark, themeMode, setThemeMode } = useTheme();
  const { user, logout } = useAuth();

  // Notification Preferences State
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    muteChat: false,
    notifyNotes: true,
    notifyPosts: true,
    notifyNotices: true,
    hideLockscreenPreview: false,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [updatingPrefKey, setUpdatingPrefKey] = useState<string | null>(null);

  // Change Password Modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const devTapRef = React.useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const prefs = await getNotificationPreferences();
        if (prefs) {
          setNotifPrefs(prefs);
        }
      } finally {
        setLoadingPrefs(false);
      }
    })();
  }, []);

  const handleTogglePref = async (key: keyof NotificationPreferences, value: boolean) => {
    setUpdatingPrefKey(key);
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);

    try {
      const res = await updateNotificationPreferences({ [key]: value });
      if (!res.success) {
        // Revert on failure
        setNotifPrefs(notifPrefs);
        Alert.alert('Error', res.error || 'Failed to update preference.');
      }
    } catch {
      setNotifPrefs(notifPrefs);
      Alert.alert('Error', 'Network error updating preference.');
    } finally {
      setUpdatingPrefKey(null);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordError('Please fill in all password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
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
      if (res.ok) {
        setPasswordSuccess('Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => setShowPasswordModal(false), 1500);
      } else {
        setPasswordError(data.message || 'Failed to change password.');
      }
    } catch {
      setPasswordError('Network error changing password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Semester Library?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setIsLoggingOut(true);
          try {
            await logout();
          } finally {
            setIsLoggingOut(false);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { padding: spacing.md }]}
    >
      {/* 1. APPEARANCE SECTION */}
      <Subheading style={{ marginBottom: spacing.xs }}>Appearance</Subheading>
      <Caption color="muted" style={{ marginBottom: spacing.sm }}>
        Choose your preferred theme across Semester Library
      </Caption>
      <Card variant="elevated" padding="md" style={styles.card}>
        <View style={styles.themeOptionsRow}>
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => {
            const isSelected = themeMode === mode;
            const label = mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark';
            const iconName =
              mode === 'system'
                ? 'phone-portrait-outline'
                : mode === 'light'
                ? 'sunny-outline'
                : 'moon-outline';

            return (
              <TouchableOpacity
                key={mode}
                activeOpacity={0.7}
                onPress={() => void setThemeMode(mode)}
                style={[
                  styles.themeOptionBtn,
                  {
                    borderColor: isSelected ? colors.primary : colors.border,
                    backgroundColor: isSelected ? colors.surfaceRaised : colors.surfaceSubtle,
                  },
                ]}
              >
                <Ionicons
                  name={iconName}
                  size={20}
                  color={isSelected ? colors.primary : colors.textSecondary}
                  style={{ marginBottom: 6 }}
                />
                <Text
                  variant="sm"
                  weight={isSelected ? '700' : '500'}
                  style={{ color: isSelected ? colors.primary : colors.text }}
                >
                  {label}
                </Text>
                {isSelected && (
                  <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* 2. NOTIFICATIONS SECTION */}
      <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
        Push Notifications
      </Subheading>
      <Caption color="muted" style={{ marginBottom: spacing.sm }}>
        Customize which alerts and previews appear on your device
      </Caption>
      <Card variant="elevated" padding="md" style={styles.card}>
        {loadingPrefs ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text variant="xs" color="muted" style={{ marginTop: 8 }}>
              Loading preferences…
            </Text>
          </View>
        ) : (
          <>
            {/* Group Chat */}
            <View style={styles.prefRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text variant="sm" weight="600">
                  Group Chat Messages
                </Text>
                <Caption color="muted">Receive push notifications for BIT class group chats</Caption>
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

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Study Materials */}
            <View style={styles.prefRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text variant="sm" weight="600">
                  Study Materials & Notes
                </Text>
                <Caption color="muted">Alerts when new notes or past questions are shared</Caption>
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

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Feed & Status Posts */}
            <View style={styles.prefRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text variant="sm" weight="600">
                  Classmate Posts & Status
                </Text>
                <Caption color="muted">Alerts when classmates post discussions or updates</Caption>
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

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Official Notices */}
            <View style={styles.prefRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text variant="sm" weight="600">
                  Official Notices & Circulars
                </Text>
                <Caption color="muted">High-priority announcements from administration and CRs</Caption>
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

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Hide Lock Screen Previews */}
            <View style={styles.prefRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text variant="sm" weight="600">
                  Hide Lock Screen Previews
                </Text>
                <Caption color="muted">Mask notification preview texts on the lock screen for privacy</Caption>
              </View>
              {updatingPrefKey === 'hideLockscreenPreview' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={notifPrefs.hideLockscreenPreview}
                  onValueChange={(val) => void handleTogglePref('hideLockscreenPreview', val)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              )}
            </View>
          </>
        )}
      </Card>

      {/* 3. ACCOUNT SECTION */}
      <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>Account</Subheading>
      <Caption color="muted" style={{ marginBottom: spacing.sm }}>
        Your university profile credentials and security
      </Caption>
      <Card variant="elevated" padding="md" style={styles.card}>
        <View style={styles.accountRow}>
          <Text variant="sm" color="secondary">
            Student Name:
          </Text>
          <Text variant="sm" weight="700">
            {user?.name || 'Student'}
          </Text>
        </View>
        <View style={styles.accountRow}>
          <Text variant="sm" color="secondary">
            Student ID:
          </Text>
          <Text variant="sm" weight="600">
            {user?.studentId || '—'}
          </Text>
        </View>
        <View style={styles.accountRow}>
          <Text variant="sm" color="secondary">
            Program & Semester:
          </Text>
          <Text variant="sm" weight="600">
            {user?.department || 'BIT'} • {user?.semester || 'Semester 1'}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Button
          title="Change Password"
          variant="outline"
          size="md"
          leftIcon={<Ionicons name="key-outline" size={17} color={colors.text} />}
          onPress={() => setShowPasswordModal(true)}
        />
      </Card>

      {/* 4. ABOUT SECTION */}
      <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>About</Subheading>
      <Card variant="elevated" padding="md" style={styles.card}>
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Text variant="md" weight="700" style={{ letterSpacing: -0.3 }}>
            Semester Library
          </Text>
          <Caption color="muted" style={{ marginTop: 2 }}>
            Gandaki University Academic Portal
          </Caption>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {
              devTapRef.current += 1;
              if (devTapRef.current >= 7) {
                devTapRef.current = 0;
                router.push('/developer-settings' as any);
              }
            }}
          >
            <Text variant="xs" color="muted" style={{ marginTop: 8 }}>
              Version 1.0.0 (Build 50)
            </Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* 5. SEPARATED DESTRUCTIVE ACTION: SIGN OUT */}
      <View style={{ marginTop: spacing.lg, marginBottom: spacing.xl }}>
        <Button
          title="Sign Out"
          variant="danger"
          size="lg"
          loading={isLoggingOut}
          leftIcon={<Ionicons name="log-out-outline" size={18} color="#FFFFFF" />}
          onPress={handleLogout}
        />
        <Caption color="muted" style={{ textAlign: 'center', marginTop: spacing.xs }}>
          Signed in as {user?.email || user?.username || user?.studentId || 'Student'}
        </Caption>
      </View>

      {/* CHANGE PASSWORD MODAL */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: '88%' }]}>
            <View style={styles.modalHeader}>
              <Heading style={{ fontSize: 18 }}>Change Password</Heading>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)} style={{ padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <KeyboardAwareForm
              clearance={24}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {passwordError && (
                <View style={[styles.modalBanner, { backgroundColor: '#FEF2F2', borderColor: '#EF4444' }]}>
                  <Ionicons name="alert-circle-outline" size={18} color="#EF4444" style={{ marginRight: 6 }} />
                  <Text variant="xs" style={{ color: '#EF4444', flex: 1 }}>
                    {passwordError}
                  </Text>
                </View>
              )}

              {passwordSuccess && (
                <View style={[styles.modalBanner, { backgroundColor: '#ECFDF5', borderColor: '#10B981' }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#10B981" style={{ marginRight: 6 }} />
                  <Text variant="xs" style={{ color: '#10B981', flex: 1 }}>
                    {passwordSuccess}
                  </Text>
                </View>
              )}

              <PasswordField
                label="Current Password"
                placeholder="Enter current password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
              />
              <PasswordField
                label="New Password (min 8 chars)"
                placeholder="Enter new password"
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <PasswordField
                label="Confirm New Password"
                placeholder="Re-enter new password"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
              />

              <Button
                title="Update Password"
                variant="primary"
                size="lg"
                loading={isChangingPassword}
                onPress={handleChangePassword}
                style={{ marginTop: spacing.sm }}
              />
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 40,
  },
  card: {
    borderRadius: 14,
    marginBottom: 8,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  themeOptionBtn: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    position: 'relative',
  },
  selectedIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
});
