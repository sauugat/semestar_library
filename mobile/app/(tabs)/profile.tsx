import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ProfileScreen() {
  const { user, token, serverUrl, updateServerUrl, logout } = useAuth();
  const { colors, spacing, radii } = useTheme();

  const [editingUrl, setEditingUrl] = useState(serverUrl);
  const [urlSaved, setUrlSaved] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleSaveUrl = async () => {
    await updateServerUrl(editingUrl);
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? Your stored token will be deleted.',
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

  return (
    <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}>
      {/* User Info Card */}
      <Card variant="elevated" padding="lg" style={{ marginBottom: spacing.md, alignItems: 'center' }}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: colors.primaryLight,
              borderColor: colors.primary,
              borderRadius: radii.full,
              marginBottom: spacing.sm,
              overflow: 'hidden',
            },
          ]}
        >
          {user?.avatarUrl ? (
            <Image
              source={{ uri: user.avatarUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Ionicons name="person" size={36} color={colors.primary} />
          )}
        </View>

        <Heading style={{ textAlign: 'center' }}>{user?.name || 'Student'}</Heading>
        <Caption color="muted">Student ID: {user?.studentId || 'N/A'}</Caption>

        <View
          style={[
            styles.rolePill,
            {
              backgroundColor: colors.surfaceSubtle,
              borderRadius: radii.full,
              paddingHorizontal: spacing.sm + 4,
              paddingVertical: spacing.xs,
              marginTop: spacing.sm,
            },
          ]}
        >
          <Text variant="xs" color="accent" weight="700">
            ROLE: {user?.role ? user.role.toUpperCase() : 'STUDENT'}
          </Text>
        </View>
      </Card>

      {/* Security & Token Status */}
      <Subheading style={{ marginBottom: spacing.sm }}>Security & Session</Subheading>
      <Card variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
        <View style={styles.infoRow}>
          <Text variant="sm" color="secondary">
            Auth Method:
          </Text>
          <Text variant="sm" weight="600">
            Bearer Token (Opaque 64-hex)
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text variant="sm" color="secondary">
            Storage:
          </Text>
          <Text variant="sm" weight="600" color="success">
            expo-secure-store (Hardware-backed)
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text variant="sm" color="secondary">
            Token Status:
          </Text>
          <Text variant="xs" weight="600" style={{ fontFamily: 'monospace' }}>
            {token ? `${token.substring(0, 12)}...` : 'None'}
          </Text>
        </View>
      </Card>

      {/* LAN Server Configuration */}
      <Subheading style={{ marginBottom: spacing.sm }}>Server Connection</Subheading>
      <Card variant="elevated" padding="md" style={{ marginBottom: spacing.lg }}>
        <Input
          label="Backend LAN URL"
          value={editingUrl}
          onChangeText={setEditingUrl}
          autoCapitalize="none"
          autoCorrect={false}
          helper={urlSaved ? '✅ Saved successfully!' : 'IP/port of your Semester Library server'}
        />
        <Button
          title={urlSaved ? 'Saved!' : 'Update Server URL'}
          variant="secondary"
          size="sm"
          onPress={handleSaveUrl}
        />
      </Card>

      {/* Logout Button */}
      <Button
        title="Sign Out"
        variant="danger"
        size="lg"
        loading={isLoggingOut}
        onPress={handleLogout}
        leftIcon={<Ionicons name="log-out-outline" size={20} color="#FFFFFF" />}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  avatar: {
    width: 72,
    height: 72,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolePill: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
});
