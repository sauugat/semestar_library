import React, { useState, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  TextInput,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { PasswordField } from '@/components/ui/PasswordField';
import { Chip } from '@/components/ui/Chip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Screen } from '@/components/ui/Screen';
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
const GENDERS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer_not_to_say' },
];

function formatHumanError(rawError: string | undefined): string {
  if (!rawError) return 'An unexpected error occurred. Please try again.';
  const lower = rawError.toLowerCase();
  if (
    lower.includes('unique constraint') ||
    lower.includes('duplicate key') ||
    lower.includes('already registered') ||
    lower.includes('already exists')
  ) {
    if (lower.includes('username')) return 'This username is already taken. Please choose another.';
    if (lower.includes('email')) return 'An account with this email already exists.';
    if (lower.includes('studentid') || lower.includes('student_id')) return 'This Student ID is already registered.';
    return 'An account with these student credentials already exists.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Invalid username/email or password. Please verify and try again.';
  }
  if (lower.includes('network request failed') || lower.includes('failed to fetch') || lower.includes('timeout')) {
    return 'Unable to reach the server. Please check your internet connection.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Your email has not been verified yet. Please check your inbox for the confirmation link.';
  }
  if (
    lower.includes('500') ||
    lower.includes('internal server error') ||
    lower.includes('postgres') ||
    lower.includes('relation') ||
    lower.includes('column')
  ) {
    return 'Server error processing your request. Please try again shortly.';
  }
  return rawError;
}

export default function LoginScreen() {
  const router = useRouter();
  const { login, register, forgotPassword, resendVerification } = useAuth();
  const { colors, spacing, radii, touchTarget } = useTheme();

  // Mode: 'signin' | 'register' | 'forgot'
  const [authMode, setAuthMode] = useState<'signin' | 'register' | 'forgot'>('signin');

  // Input Refs for smooth keyboard 'Next' chaining
  const loginPasswordRef = useRef<TextInput>(null);

  const regFullNameRef = useRef<TextInput>(null);
  const regStudentIdRef = useRef<TextInput>(null);
  const regUsernameRef = useRef<TextInput>(null);
  const regEmailRef = useRef<TextInput>(null);
  const regPasswordRef = useRef<TextInput>(null);
  const regConfirmPasswordRef = useRef<TextInput>(null);

  const fpIdentifierRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Sign In State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsUnverified(false);
  };

  const switchMode = (mode: 'signin' | 'register' | 'forgot') => {
    Keyboard.dismiss();
    setAuthMode(mode);
    resetFeedback();
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 60);
  };

  const handleLogin = async () => {
    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setErrorMessage('Please enter your username, email, or student ID and password.');
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await login(cleanId, password);
    setLoading(false);

    if (result.onboardingRequired) {
      if (result.onboardingToken) {
        await SecureStore.setItemAsync('semester_library_teacher_onboarding_token', result.onboardingToken).catch(() => {});
      }
      router.push({
        pathname: '/teacher-onboarding' as any,
        params: {
          token: result.onboardingToken,
          state: JSON.stringify(result.state || {}),
        },
      });
      return;
    }

    if (!result.success) {
      if (result.code === 'EMAIL_NOT_CONFIRMED') {
        setIsUnverified(true);
      }
      setErrorMessage(formatHumanError(result.error));
    }
  };

  const handleRegister = async () => {
    const cleanFullName = regFullName.trim();
    const cleanStudentId = regStudentId.trim();
    const cleanUsername = regUsername.trim().toLowerCase();
    const cleanEmail = regEmail.trim().toLowerCase();

    if (!cleanFullName) {
      setErrorMessage('Full Name is required.');
      regFullNameRef.current?.focus();
      return;
    }
    if (!cleanStudentId) {
      setErrorMessage('Student ID is required.');
      regStudentIdRef.current?.focus();
      return;
    }
    if (!cleanUsername) {
      setErrorMessage('Username is required.');
      regUsernameRef.current?.focus();
      return;
    }
    if (!cleanEmail) {
      setErrorMessage('Email address is required.');
      regEmailRef.current?.focus();
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      regEmailRef.current?.focus();
      return;
    }
    if (!regPassword) {
      setErrorMessage('Password is required.');
      regPasswordRef.current?.focus();
      return;
    }
    if (regPassword.length < 8) {
      setErrorMessage('Password must contain at least 8 characters.');
      regPasswordRef.current?.focus();
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your password.');
      regConfirmPasswordRef.current?.focus();
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await register({
      fullName: cleanFullName,
      studentId: cleanStudentId,
      username: cleanUsername,
      email: cleanEmail,
      department: regDept,
      semester: regSem,
      gender: regGender,
      password: regPassword,
      confirmPassword: regConfirmPassword,
    });

    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'Account created! Please verify your email before logging in.');
      setAuthMode('signin');
      setIdentifier(cleanUsername || cleanEmail);
      setPassword('');
    } else {
      setErrorMessage(formatHumanError(result.error));
    }
  };

  const handleForgotPassword = async () => {
    const cleanFp = fpIdentifier.trim();
    if (!cleanFp) {
      setErrorMessage('Please provide your username or email address.');
      fpIdentifierRef.current?.focus();
      return;
    }

    setLoading(true);
    resetFeedback();

    const result = await forgotPassword(cleanFp);
    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'Password reset link sent to your registered email.');
    } else {
      setErrorMessage(formatHumanError(result.error));
    }
  };

  const handleResendVerification = async () => {
    const target = identifier.trim() || fpIdentifier.trim();
    if (!target) return;

    setLoading(true);
    const result = await resendVerification(target);
    setLoading(false);

    if (result.success) {
      setSuccessMessage(result.message || 'A new verification email has been sent.');
      setIsUnverified(false);
    } else {
      setErrorMessage(result.error || 'Failed to resend verification.');
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAwareForm
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: spacing.screenHorizontal,
            paddingTop: spacing.normal,
          },
        ]}
        clearance={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          {/* Brand Header */}
          <View style={[styles.headerContainer, { marginBottom: spacing.normal }]}>
            <View
              style={[
                styles.logoBadge,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.card,
                },
              ]}
            >
              <Image
                source={require('@/assets/images/app-logo.jpg')}
                style={styles.logoImage}
                contentFit="cover"
              />
            </View>
            <Heading style={{ marginTop: spacing.compact, textAlign: 'center' }}>
              Semester Library
            </Heading>
            <Caption color="muted" style={{ marginTop: spacing.micro, textAlign: 'center' }}>
              {authMode === 'signin' && 'Sign in with your student credentials'}
              {authMode === 'register' && 'Create your verified student account'}
              {authMode === 'forgot' && 'Recover access to your account'}
            </Caption>
          </View>

          {/* Segmented Auth Navigation */}
          {authMode !== 'forgot' && (
            <SegmentedControl
              items={[
                { key: 'signin', label: 'Sign In' },
                { key: 'register', label: 'Create Account' },
              ]}
              selectedKey={authMode}
              onSelect={(key) => switchMode(key as 'signin' | 'register')}
              style={{ marginBottom: spacing.normal }}
            />
          )}

          {/* Feedback Banners */}
          {errorMessage && (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: colors.errorBg || '#2A1215',
                  borderColor: colors.error,
                  borderRadius: radii.input,
                  padding: spacing.compact,
                  marginBottom: spacing.normal,
                },
              ]}
            >
              <Ionicons
                name="alert-circle-outline"
                size={20}
                color={colors.error}
                style={{ marginRight: spacing.tight, marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <Text color="error" variant="sm" weight="600">
                  {errorMessage}
                </Text>
                {isUnverified && (
                  <TouchableOpacity
                    onPress={handleResendVerification}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginTop: spacing.tight }}
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
                  backgroundColor: colors.successBg || '#0F291E',
                  borderColor: colors.success,
                  borderRadius: radii.input,
                  padding: spacing.compact,
                  marginBottom: spacing.normal,
                },
              ]}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color={colors.success}
                style={{ marginRight: spacing.tight, marginTop: 1 }}
              />
              <Text color="success" variant="sm" weight="600" style={{ flex: 1 }}>
                {successMessage}
              </Text>
            </View>
          )}

          {/* MODE 1: SIGN IN */}
          {authMode === 'signin' && (
            <Card style={{ padding: spacing.cardPadding }}>
              <TextField
                label="Username, Email, or Student ID"
                placeholder="Student ID, email, or username"
                value={identifier}
                onChangeText={(val) => {
                  setIdentifier(val);
                  if (errorMessage) resetFeedback();
                }}
                leftIcon="person-outline"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => loginPasswordRef.current?.focus()}
              />

              <PasswordField
                ref={loginPasswordRef}
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (errorMessage) resetFeedback();
                }}
                leftIcon="lock-closed-outline"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />

              <View style={styles.forgotRow}>
                <TouchableOpacity
                  onPress={() => switchMode('forgot')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ minHeight: touchTarget.min, justifyContent: 'center' }}
                >
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
                disabled={loading}
                onPress={handleLogin}
                style={{ marginTop: spacing.micro }}
              />
            </Card>
          )}

          {/* MODE 2: CREATE ACCOUNT (REGISTER) */}
          {authMode === 'register' && (
            <Card style={{ padding: spacing.cardPadding }}>
              <TextField
                ref={regFullNameRef}
                label="Full Name"
                placeholder="e.g. Aarav Sharma"
                value={regFullName}
                onChangeText={setRegFullName}
                leftIcon="person-outline"
                autoCapitalize="words"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => regStudentIdRef.current?.focus()}
              />

              <View style={styles.gridRow}>
                <View style={{ flex: 1, marginRight: spacing.tight }}>
                  <TextField
                    ref={regStudentIdRef}
                    label="Student ID"
                    placeholder="e.g. 26020001"
                    value={regStudentId}
                    onChangeText={setRegStudentId}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => regUsernameRef.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.tight }}>
                  <TextField
                    ref={regUsernameRef}
                    label="Username"
                    placeholder="e.g. aarav26"
                    value={regUsername}
                    onChangeText={(val) => setRegUsername(val.toLowerCase().replace(/\s+/g, ''))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => regEmailRef.current?.focus()}
                  />
                </View>
              </View>

              <TextField
                ref={regEmailRef}
                label="Email Address (for verification)"
                placeholder="student@example.com"
                value={regEmail}
                onChangeText={setRegEmail}
                leftIcon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => regPasswordRef.current?.focus()}
              />

              {/* Department Selector */}
              <View style={{ marginBottom: spacing.normal }}>
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textSecondary, marginBottom: spacing.tight },
                  ]}
                >
                  Department
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.tight }}
                >
                  {DEPARTMENTS.map((dept) => (
                    <Chip
                      key={dept}
                      label={dept}
                      selected={regDept === dept}
                      onPress={() => setRegDept(dept)}
                      size="sm"
                    />
                  ))}
                </ScrollView>
              </View>

              {/* Semester Selector */}
              <View style={{ marginBottom: spacing.normal }}>
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textSecondary, marginBottom: spacing.tight },
                  ]}
                >
                  Semester
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.tight }}
                >
                  {SEMESTERS.map((sem) => (
                    <Chip
                      key={sem}
                      label={sem}
                      selected={regSem === sem}
                      onPress={() => setRegSem(sem)}
                      size="sm"
                    />
                  ))}
                </ScrollView>
              </View>

              {/* Gender Selector */}
              <View style={{ marginBottom: spacing.normal }}>
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textSecondary, marginBottom: spacing.tight },
                  ]}
                >
                  Gender
                </Text>
                <View style={styles.genderRow}>
                  {GENDERS.map((g) => (
                    <Chip
                      key={g.value}
                      label={g.label}
                      selected={regGender === g.value}
                      onPress={() => setRegGender(g.value)}
                      size="sm"
                    />
                  ))}
                </View>
              </View>

              <PasswordField
                ref={regPasswordRef}
                label="Password (min 8 chars)"
                placeholder="Choose a strong password"
                value={regPassword}
                onChangeText={setRegPassword}
                leftIcon="lock-closed-outline"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => regConfirmPasswordRef.current?.focus()}
              />

              <PasswordField
                ref={regConfirmPasswordRef}
                label="Confirm Password"
                placeholder="Re-enter your password"
                value={regConfirmPassword}
                onChangeText={setRegConfirmPassword}
                leftIcon="lock-closed-outline"
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />

              <Button
                title="Create Account"
                variant="primary"
                size="lg"
                loading={loading}
                disabled={loading}
                onPress={handleRegister}
                style={{ marginTop: spacing.micro }}
              />

              <TouchableOpacity
                onPress={() => switchMode('signin')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  marginTop: spacing.normal,
                  alignItems: 'center',
                  minHeight: touchTarget.min,
                  justifyContent: 'center',
                }}
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
            <Card style={{ padding: spacing.cardPadding }}>
              <Subheading style={{ marginBottom: spacing.tight }}>Reset Your Password</Subheading>
              <Caption color="muted" style={{ marginBottom: spacing.normal }}>
                Enter your username or registered email address. We'll send you a secure link to reset your password.
              </Caption>

              <TextField
                ref={fpIdentifierRef}
                label="Username or Email"
                placeholder="e.g. username or student@example.com"
                value={fpIdentifier}
                onChangeText={setFpIdentifier}
                leftIcon="mail-outline"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleForgotPassword}
              />

              <Button
                title="Send Reset Link"
                variant="primary"
                size="lg"
                loading={loading}
                disabled={loading}
                onPress={handleForgotPassword}
                style={{ marginTop: spacing.micro }}
              />

              <Button
                title="Back to Sign In"
                variant="outline"
                size="md"
                onPress={() => switchMode('signin')}
                style={{ marginTop: spacing.compact }}
              />
            </Card>
          )}
        </KeyboardAwareForm>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  headerContainer: {
    alignItems: 'center',
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
    marginTop: -4,
  },
  gridRow: {
    flexDirection: 'row',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
