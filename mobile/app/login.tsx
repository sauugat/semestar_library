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
import { Text, Heading, Caption, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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
const GENDERS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer_not_to_say' },
];

export default function LoginScreen() {
  const { login, register, forgotPassword, resendVerification, serverUrl, updateServerUrl } = useAuth();
  const { colors, spacing, radii } = useTheme();

  // Mode: 'signin' | 'register' | 'forgot'
  const [authMode, setAuthMode] = useState<'signin' | 'register' | 'forgot'>('signin');

  // Sign In State
  const [identifier, setIdentifier] = useState('26020266'); // Pre-filled for demo
  const [password, setPassword] = useState('saugat266');
  const [isUnverified, setIsUnverified] = useState(false);

  // Register State
  const [regFullName, setRegFullName] = useState('');
  const [regStudentId, setRegStudentId] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDept, setRegDept] = useState('BIT');
  const [regSem, setRegSem] = useState('Semester 1');
  const [regGender, setRegGender] = useState('male');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Forgot Password State
  const [fpIdentifier, setFpIdentifier] = useState('');

  // Status & Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Backend LAN Config
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [showServerConfig, setShowServerConfig] = useState(false);

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsUnverified(false);
  };

  const switchMode = (mode: 'signin' | 'register' | 'forgot') => {
    setAuthMode(mode);
    resetFeedback();
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      setErrorMessage('Please enter your username, email, or student ID and password.');
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await login(identifier, password, customUrl);
    setLoading(false);

    if (!result.success) {
      if (result.code === 'EMAIL_NOT_CONFIRMED') {
        setIsUnverified(true);
      }
      setErrorMessage(result.error || 'Invalid credentials or connection error.');
    }
  };

  const handleRegister = async () => {
    if (
      !regFullName.trim() ||
      !regStudentId.trim() ||
      !regUsername.trim() ||
      !regEmail.trim() ||
      !regPassword ||
      !regConfirmPassword
    ) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    if (regPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await register(
      {
        fullName: regFullName.trim(),
        studentId: regStudentId.trim(),
        username: regUsername.trim(),
        email: regEmail.trim(),
        department: regDept,
        semester: regSem,
        gender: regGender,
        password: regPassword,
        confirmPassword: regConfirmPassword,
      },
      customUrl
    );

    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'Account created! Please verify your email before logging in.');
      setAuthMode('signin');
      setIdentifier(regUsername.trim() || regEmail.trim());
      setPassword('');
    } else {
      setErrorMessage(result.error || 'Registration failed.');
    }
  };

  const handleForgotPassword = async () => {
    if (!fpIdentifier.trim()) {
      setErrorMessage('Please provide your username or email address.');
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await forgotPassword(fpIdentifier, customUrl);
    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'Password reset link sent to your registered email.');
    } else {
      setErrorMessage(result.error || 'Could not send reset link.');
    }
  };

  const handleResendVerification = async () => {
    const target = identifier.trim() || fpIdentifier.trim();
    if (!target) return;

    setLoading(true);
    const result = await resendVerification(target, customUrl);
    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'A new verification email has been sent.');
      setIsUnverified(false);
    } else {
      setErrorMessage(result.error || 'Failed to resend verification.');
    }
  };

  const handleFillDemo = (id: string, pass: string) => {
    setIdentifier(id);
    setPassword(pass);
    resetFeedback();
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
          <View style={[styles.headerContainer, { marginVertical: spacing.md }]}>
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
              <Ionicons name="school" size={38} color={colors.primary} />
            </View>
            <Heading style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              Semester Library
            </Heading>
            <Caption style={{ marginTop: spacing.xs, textAlign: 'center' }}>
              {authMode === 'signin' && 'Sign in with your student credentials'}
              {authMode === 'register' && 'Create your verified student account'}
              {authMode === 'forgot' && 'Recover access to your account'}
            </Caption>
          </View>

          {/* Segmented Auth Navigation */}
          <View
            style={[
              styles.segmentContainer,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                borderRadius: radii.lg,
                marginBottom: spacing.md,
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => switchMode('signin')}
              style={[
                styles.segmentTab,
                authMode === 'signin' && {
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
              <Text
                variant="sm"
                weight={authMode === 'signin' ? '700' : '500'}
                color={authMode === 'signin' ? undefined : 'muted'}
              >
                Sign In
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => switchMode('register')}
              style={[
                styles.segmentTab,
                authMode === 'register' && {
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
              <Text
                variant="sm"
                weight={authMode === 'register' ? '700' : '500'}
                color={authMode === 'register' ? undefined : 'muted'}
              >
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          {/* Feedback Banners */}
          {errorMessage && (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: colors.errorBg || '#FEF2F2',
                  borderColor: colors.error,
                  borderRadius: radii.md,
                  padding: spacing.sm + 2,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Ionicons
                name="alert-circle-outline"
                size={20}
                color={colors.error}
                style={{ marginRight: spacing.xs }}
              />
              <View style={{ flex: 1 }}>
                <Text color="error" variant="sm" weight="600">
                  {errorMessage}
                </Text>
                {isUnverified && (
                  <TouchableOpacity
                    onPress={handleResendVerification}
                    style={{ marginTop: spacing.xs }}
                  >
                    <Text variant="xs" color="accent" weight="700">
                      Resend Verification Email →
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {successMessage && (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: colors.successBg || '#ECFDF5',
                  borderColor: colors.success,
                  borderRadius: radii.md,
                  padding: spacing.sm + 2,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color={colors.success}
                style={{ marginRight: spacing.xs }}
              />
              <Text color="success" variant="sm" weight="600" style={{ flex: 1 }}>
                {successMessage}
              </Text>
            </View>
          )}

          {/* MODE 1: SIGN IN */}
          {authMode === 'signin' && (
            <Card style={{ padding: spacing.lg }}>
              <Input
                label="Username, Email, or Student ID"
                placeholder="e.g. 26020266 or saugat_subedi"
                value={identifier}
                onChangeText={(val) => {
                  setIdentifier(val);
                  if (errorMessage) resetFeedback();
                }}
                leftIcon="person-outline"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Input
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (errorMessage) resetFeedback();
                }}
                leftIcon="lock-closed-outline"
                isPassword
                autoCapitalize="none"
              />

              <View style={styles.forgotRow}>
                <TouchableOpacity onPress={() => switchMode('forgot')}>
                  <Text variant="xs" color="accent" weight="600">
                    Forgot password?
                  </Text>
                </TouchableOpacity>
              </View>

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
          )}

          {/* MODE 2: CREATE ACCOUNT (REGISTER) */}
          {authMode === 'register' && (
            <Card style={{ padding: spacing.lg }}>
              <Input
                label="Full Name"
                placeholder="e.g. Saugat Subedi"
                value={regFullName}
                onChangeText={setRegFullName}
                leftIcon="person-outline"
                autoCapitalize="words"
              />

              <View style={styles.gridRow}>
                <View style={{ flex: 1, marginRight: spacing.xs }}>
                  <Input
                    label="Student ID"
                    placeholder="e.g. 26020266"
                    value={regStudentId}
                    onChangeText={setRegStudentId}
                    autoCapitalize="none"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.xs }}>
                  <Input
                    label="Username"
                    placeholder="e.g. saugat_subedi"
                    value={regUsername}
                    onChangeText={setRegUsername}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <Input
                label="Email Address (for verification)"
                placeholder="student@example.com"
                value={regEmail}
                onChangeText={setRegEmail}
                leftIcon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Department Selector */}
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                  Department
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                  {DEPARTMENTS.map((dept) => {
                    const isSelected = regDept === dept;
                    return (
                      <TouchableOpacity
                        key={dept}
                        onPress={() => setRegDept(dept)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                            borderColor: isSelected ? colors.primary : colors.border,
                            borderRadius: radii.full,
                            marginRight: spacing.xs,
                          },
                        ]}
                      >
                        <Text
                          variant="xs"
                          weight="600"
                          style={{ color: isSelected ? '#FFFFFF' : colors.text }}
                        >
                          {dept}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Semester Selector */}
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                  Semester
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                  {SEMESTERS.map((sem) => {
                    const isSelected = regSem === sem;
                    return (
                      <TouchableOpacity
                        key={sem}
                        onPress={() => setRegSem(sem)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                            borderColor: isSelected ? colors.primary : colors.border,
                            borderRadius: radii.full,
                            marginRight: spacing.xs,
                          },
                        ]}
                      >
                        <Text
                          variant="xs"
                          weight="600"
                          style={{ color: isSelected ? '#FFFFFF' : colors.text }}
                        >
                          {sem}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Gender Selector */}
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                  Gender
                </Text>
                <View style={styles.genderRow}>
                  {GENDERS.map((g) => {
                    const isSelected = regGender === g.value;
                    return (
                      <TouchableOpacity
                        key={g.value}
                        onPress={() => setRegGender(g.value)}
                        style={[
                          styles.genderChip,
                          {
                            backgroundColor: isSelected ? colors.primaryLight : colors.surfaceSubtle,
                            borderColor: isSelected ? colors.primary : colors.border,
                            borderRadius: radii.md,
                          },
                        ]}
                      >
                        <Text
                          variant="xs"
                          weight={isSelected ? '700' : '500'}
                          style={{ color: isSelected ? colors.primary : colors.textSecondary }}
                        >
                          {g.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <Input
                label="Password (min 8 chars)"
                placeholder="Choose a strong password"
                value={regPassword}
                onChangeText={setRegPassword}
                leftIcon="lock-closed-outline"
                isPassword
                autoCapitalize="none"
              />

              <Input
                label="Confirm Password"
                placeholder="Re-enter your password"
                value={regConfirmPassword}
                onChangeText={setRegConfirmPassword}
                leftIcon="lock-closed-outline"
                isPassword
                autoCapitalize="none"
              />

              <Button
                title="Create Account"
                variant="primary"
                size="lg"
                loading={loading}
                onPress={handleRegister}
                style={{ marginTop: spacing.xs }}
              />

              <TouchableOpacity
                onPress={() => switchMode('signin')}
                style={{ marginTop: spacing.md, alignItems: 'center' }}
              >
                <Text variant="sm" color="secondary">
                  Already have an account?{' '}
                  <Text variant="sm" color="accent" weight="700">
                    Sign In
                  </Text>
                </Text>
              </TouchableOpacity>
            </Card>
          )}

          {/* MODE 3: FORGOT PASSWORD */}
          {authMode === 'forgot' && (
            <Card style={{ padding: spacing.lg }}>
              <Subheading style={{ marginBottom: spacing.xs }}>Reset Your Password</Subheading>
              <Caption color="muted" style={{ marginBottom: spacing.md }}>
                Enter your username or registered email address. We'll send you a secure link to reset your password.
              </Caption>

              <Input
                label="Username or Email"
                placeholder="e.g. saugat_subedi or email@example.com"
                value={fpIdentifier}
                onChangeText={setFpIdentifier}
                leftIcon="mail-outline"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Button
                title="Send Reset Link"
                variant="primary"
                size="lg"
                loading={loading}
                onPress={handleForgotPassword}
                style={{ marginTop: spacing.xs }}
              />

              <Button
                title="Back to Sign In"
                variant="outline"
                size="md"
                onPress={() => switchMode('signin')}
                style={{ marginTop: spacing.sm }}
              />
            </Card>
          )}

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
                <Button
                  title="Save Server URL"
                  variant="secondary"
                  size="sm"
                  onPress={async () => {
                    await updateServerUrl(customUrl);
                    setSuccessMessage('Server URL updated successfully!');
                    setTimeout(() => setSuccessMessage(null), 3000);
                  }}
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
    paddingBottom: 40,
  },
  headerContainer: {
    alignItems: 'center',
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentContainer: {
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
    marginTop: -4,
  },
  gridRow: {
    flexDirection: 'row',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  demoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  demoPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  serverHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
