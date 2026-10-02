import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DevMenu from 'expo-dev-menu';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { KeyboardAwareForm } from '@/components/ui/KeyboardAwareForm';
import { getAutoDetectedServerUrl, DEFAULT_SERVER_URL } from '@/services/api';

export default function DeveloperSettingsScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { serverUrl, updateServerUrl } = useAuth();

  const autoDetected = getAutoDetectedServerUrl();
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    status?: number;
    latencyMs?: number;
    message?: string;
  } | null>(null);

  const handleSave = async () => {
    const trimmed = customUrl.trim().replace(/\/+$/, '');
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      Alert.alert('Invalid URL', 'Server URL must start with http:// or https://');
      return;
    }

    setIsSaving(true);
    try {
      await updateServerUrl(trimmed);
      Alert.alert('Saved', `Server URL set to:\n${trimmed}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update server URL');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const target = customUrl.trim().replace(/\/+$/, '');
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${target}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const text = await res.text();

      setTestResult({
        success: res.ok,
        status: res.status,
        latencyMs,
        message: text.slice(0, 100),
      });
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      setTestResult({
        success: false,
        latencyMs,
        message: err.name === 'AbortError' ? 'Connection timed out (6s)' : (err.message || 'Network error'),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleResetToAuto = async () => {
    setCustomUrl(autoDetected);
    await updateServerUrl(autoDetected);
    Alert.alert('Reset', `Server URL reset to auto-detected LAN:\n${autoDetected}`);
  };

  const handleResetToDefault = async () => {
    setCustomUrl(DEFAULT_SERVER_URL);
    await updateServerUrl(DEFAULT_SERVER_URL);
    Alert.alert('Reset', `Server URL reset to production default:\n${DEFAULT_SERVER_URL}`);
  };

  return (
    <KeyboardAwareForm
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { padding: spacing.md }]}
      clearance={24}
      keyboardShouldPersistTaps="handled"
    >
        {/* Banner Alert */}
        <View
          style={[
            styles.warningBanner,
            { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
          ]}
        >
          <Ionicons name="construct-outline" size={20} color={colors.primary} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text variant="sm" weight="700">
              Developer Settings
            </Text>
            <Caption color="muted">
              Internal network diagnostics. Normal users do not see this menu.
            </Caption>
          </View>
        </View>

        {/* 1. CURRENT ROUTING STATUS */}
        <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          Network Endpoints
        </Subheading>
        <Card variant="elevated" padding="md" style={styles.card}>
          <View style={styles.endpointRow}>
            <Text variant="xs" color="muted">
              Active Server URL:
            </Text>
            <Text variant="sm" weight="700" color="primary">
              {serverUrl}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.endpointRow}>
            <Text variant="xs" color="muted">
              Auto-Detected LAN:
            </Text>
            <Text variant="xs" weight="500">
              {autoDetected}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.endpointRow}>
            <Text variant="xs" color="muted">
              Production Default:
            </Text>
            <Text variant="xs" weight="500">
              {DEFAULT_SERVER_URL}
            </Text>
          </View>
        </Card>

        {/* 2. OVERRIDE SERVER URL */}
        <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          Server URL Override
        </Subheading>
        <Card variant="elevated" padding="md" style={styles.card}>
          <Input
            label="Base API URL"
            value={customUrl}
            onChangeText={setCustomUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.65:3000"
          />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button
              title="Save URL"
              variant="primary"
              size="md"
              loading={isSaving}
              onPress={handleSave}
              style={{ flex: 1 }}
            />
            <Button
              title="Test Health"
              variant="secondary"
              size="md"
              loading={isTesting}
              onPress={handleTestConnection}
              style={{ flex: 1 }}
            />
          </View>

          {/* Test Result Feedback */}
          {testResult && (
            <View
              style={[
                styles.testBanner,
                {
                  backgroundColor: testResult.success ? '#ECFDF5' : '#FEF2F2',
                  borderColor: testResult.success ? '#10B981' : '#EF4444',
                },
              ]}
            >
              <Ionicons
                name={testResult.success ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color={testResult.success ? '#10B981' : '#EF4444'}
                style={{ marginRight: 8 }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  variant="xs"
                  weight="700"
                  style={{ color: testResult.success ? '#065F46' : '#991B1B' }}
                >
                  {testResult.success
                    ? `Connected (${testResult.status} OK • ${testResult.latencyMs}ms)`
                    : `Failed (${testResult.latencyMs}ms)`}
                </Text>
                {testResult.message ? (
                  <Text
                    variant="xs"
                    style={{ color: testResult.success ? '#047857' : '#B91C1C', marginTop: 2 }}
                    numberOfLines={2}
                  >
                    {testResult.message}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border, marginTop: 16 }]} />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Button
              title="Reset to LAN"
              variant="outline"
              size="sm"
              onPress={handleResetToAuto}
              style={{ flex: 1 }}
            />
            <Button
              title="Reset to Prod"
              variant="outline"
              size="sm"
              onPress={handleResetToDefault}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        {/* 3. EXPO DEV MENU & TOOLS */}
        <Subheading style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          Expo Development Tools
        </Subheading>
        <Card variant="elevated" padding="md" style={styles.card}>
          <Text variant="xs" color="muted" style={{ marginBottom: 12 }}>
            Developer overlay is hidden on all user screens. You can trigger the Expo Dev Menu here or by shaking your physical device.
          </Text>
          <Button
            title="Open Expo Dev Menu"
            variant="outline"
            size="md"
            leftIcon={<Ionicons name="hardware-chip-outline" size={18} color={colors.text} />}
            onPress={() => {
              try {
                DevMenu.openMenu();
              } catch (err: any) {
                Alert.alert('Dev Menu', err.message || 'Could not open dev menu');
              }
            }}
          />
        </Card>
    </KeyboardAwareForm>
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
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  endpointRow: {
    paddingVertical: 4,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
  testBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
  },
});
