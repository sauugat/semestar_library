import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LoginScreen() {
  const { login, serverUrl, updateServerUrl } = useAuth();
  const { colors, spacing, radii } = useTheme();

  const [studentId, setStudentId] = useState('26020266'); // Pre-filled with Saugat Subedi
  const [password, setPassword] = useState('saugat266');
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!studentId.trim() || !password) {
      setErrorMessage('Please enter both Student ID and Password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const result = await login(studentId, password, customUrl);
    setLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Invalid credentials or connection error.');
    }
  };

  const handleFillDemo = (id: string, pass: string) => {
    setStudentId(id);
    setPassword(pass);
    setErrorMessage(null);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand Header */}
          <View style={[styles.headerContainer, { marginVertical: spacing.lg }]}>
            <View
              style={[
                styles.logoBadge,
                {
                  backgroundColor: colors.primaryLight,
                  borderColor: colors.primary,
                  borderRadius: radii.xl,
                },
              ]}
            >
              <Ionicons name="school" size={40} color={colors.primary} />
            </View>
            <Heading style={{ marginTop: spacing.md, textAlign: 'center' }}>
              Semester Library
            </Heading>
            <Caption style={{ marginTop: spacing.xs, textAlign: 'center' }}>
              Sign in with your student credentials
            </Caption>
          </View>

          {/* Form Card */}
          <Card style={{ padding: spacing.lg }}>
            {errorMessage && (
              <View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: colors.errorBg,
                    borderColor: colors.error,
                    borderRadius: radii.md,
                    padding: spacing.sm,
                    marginBottom: spacing.md,
                  },
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.error}
                  style={{ marginRight: spacing.xs }}
                />
                <Text color="error" variant="sm" style={{ flex: 1 }}>
                  {errorMessage}
                </Text>
              </View>
            )}

            <Input
              label="Student ID"
              placeholder="e.g. 26020266"
              value={studentId}
              onChangeText={(val) => {
                setStudentId(val);
                if (errorMessage) setErrorMessage(null);
              }}
              leftIcon="person-outline"
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={(val) => {
                setPassword(val);
                if (errorMessage) setErrorMessage(null);
              }}
              leftIcon="lock-closed-outline"
              isPassword
              autoCapitalize="none"
            />

            <Button
              title="Sign In"
              variant="primary"
              size="lg"
              loading={loading}
              onPress={handleLogin}
              style={{ marginTop: spacing.xs }}
            />

            {/* Quick Demo Fill Helper */}
            <View style={[styles.demoRow, { marginTop: spacing.md }]}>
              <Caption color="muted">Quick fill: </Caption>
              <TouchableOpacity
                onPress={() => handleFillDemo('26020266', 'saugat266')}
                style={[
                  styles.demoPill,
                  { backgroundColor: colors.surfaceSubtle, borderRadius: radii.sm },
                ]}
              >
                <Text variant="xs" color="accent" weight="600">
                  Admin (Saugat)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleFillDemo('26020230', 'aashrita230')}
                style={[
                  styles.demoPill,
                  { backgroundColor: colors.surfaceSubtle, borderRadius: radii.sm, marginLeft: spacing.xs },
                ]}
              >
                <Text variant="xs" color="accent" weight="600">
                  Student (Aashrita)
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Configurable Server URL Card */}
          <Card
            variant="flat"
            style={{ marginTop: spacing.md, padding: spacing.md }}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowServerConfig(!showServerConfig)}
              style={styles.serverHeaderRow}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name="server-outline"
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginRight: spacing.xs }}
                />
                <Text variant="sm" color="secondary" weight="600">
                  Backend LAN Config
                </Text>
              </View>
              <Ionicons
                name={showServerConfig ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {showServerConfig && (
              <View style={{ marginTop: spacing.sm }}>
                <Input
                  label="Target API Base URL"
                  value={customUrl}
                  onChangeText={setCustomUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="http://192.168.1.65:3000"
                  helper="Change if your computer's Wi-Fi IP changes."
                />
              </View>
            )}

            {!showServerConfig && (
              <Caption color="muted" style={{ marginTop: spacing.xs }}>
                Connected to: {customUrl}
              </Caption>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  demoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  demoPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  serverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
