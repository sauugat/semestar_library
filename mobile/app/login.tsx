import React, { useState, useRef, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  TextInput,
  Keyboard,
  ActivityIndicator,
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
import { getMobileSupabaseClient } from '@/services/supabase';

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

function generateSecureTempPassword(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ('0' + b.toString(16)).slice(-2)).join('') + '!Aa9#';
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~';
  let result = 'Aa1!';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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
  const { login, register, forgotPassword, resendVerification, serverUrl } = useAuth();
  const { colors, spacing, radii, touchTarget } = useTheme();

  // Mode: 'signin' | 'register' | 'forgot'
  const [authMode, setAuthMode] = useState<'signin' | 'register' | 'forgot'>('signin');

  // Input Refs for smooth keyboard 'Next' chaining
  const loginPasswordRef = useRef<TextInput>(null);

  const regFullNameRef = useRef<TextInput>(null);
  const regUsernameRef = useRef<TextInput>(null);
  const regEmailRef = useRef<TextInput>(null);
  const regPasswordRef = useRef<TextInput>(null);
  const regConfirmPasswordRef = useRef<TextInput>(null);
  const otpInputRefs = useRef<(TextInput | null)[]>([]);

  const fpIdentifierRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Sign In State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isUnverified, setIsUnverified] = useState(false);

  // Register State
  const [regFullName, setRegFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDept, setRegDept] = useState('BIT');
  const [regSem, setRegSem] = useState('Semester 1');
  const [regGender, setRegGender] = useState('male');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Inline OTP & Verified State
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [verifyingEmailLoading, setVerifyingEmailLoading] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState<any>(null);

  // Forgot Password State
  const [fpIdentifier, setFpIdentifier] = useState('');

  // Status & Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 60-second Resend Timer
  useEffect(() => {
    let timer: any = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsUnverified(false);
  };

  const switchMode = (mode: 'signin' | 'register' | 'forgot') => {
    Keyboard.dismiss();
    setAuthMode(mode);
    resetFeedback();
    if (mode !== 'register') {
      setIsEmailVerified(false);
      setOtpSent(false);
      setVerifiedSession(null);
      setOtpDigits(['', '', '', '', '', '']);
    }
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

  const handleOtpChange = (text: string, index: number) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (!cleaned) {
      const updated = [...otpDigits];
      updated[index] = '';
      setOtpDigits(updated);
      return;
    }

    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, 6).split('');
      const updated = [...otpDigits];
      chars.forEach((c, i) => {
        if (i < 6) updated[i] = c;
      });
      setOtpDigits(updated);
      const nextIndex = Math.min(chars.length, 5);
      otpInputRefs.current[nextIndex]?.focus();
      if (chars.length === 6) {
        void verifyOtpCode(chars.join(''));
      }
      return;
    }

    const updated = [...otpDigits];
    updated[index] = cleaned[0];
    setOtpDigits(updated);

    if (index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    } else if (index === 5 && updated.every((d) => d.length === 1)) {
      void verifyOtpCode(updated.join(''));
    }
  };

  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent?.key === 'Backspace') {
      if (!otpDigits[index] && index > 0) {
        const updated = [...otpDigits];
        updated[index - 1] = '';
        setOtpDigits(updated);
        otpInputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleSendVerificationCode = async () => {
    const cleanFullName = regFullName.trim();
    const cleanUsername = regUsername.trim().toLowerCase();
    const cleanEmail = regEmail.trim().toLowerCase();

    if (!cleanFullName) {
      setErrorMessage('Please enter your full name first.');
      regFullNameRef.current?.focus();
      return;
    }
    if (!cleanUsername) {
      setErrorMessage('Please choose a username first.');
      regUsernameRef.current?.focus();
      return;
    }
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(cleanUsername)) {
      setErrorMessage('Username must be 3-30 characters (letters, numbers, underscore, dot).');
      regUsernameRef.current?.focus();
      return;
    }
    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      regEmailRef.current?.focus();
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      regEmailRef.current?.focus();
      return;
    }

    setVerifyingEmailLoading(true);
    resetFeedback();

    try {
      // 1. Check availability with backend
      const checkRes = await fetch(`${serverUrl}/api/auth/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: cleanEmail, username: cleanUsername }),
      });
      const checkData = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok || checkData.available === false) {
        if (checkData.code === 'EMAIL_EXISTS') {
          setErrorMessage('An account with this email already exists. Log in instead.');
        } else if (checkData.code === 'USERNAME_TAKEN') {
          setErrorMessage('This username is already taken. Please choose another.');
        } else {
          setErrorMessage(checkData.message || 'Email or username is unavailable.');
        }
        setVerifyingEmailLoading(false);
        return;
      }

      // 2. Initiate Supabase sign up with high-entropy temporary password
      const supabase = await getMobileSupabaseClient(serverUrl);
      const tempPassword = generateSecureTempPassword();
      const { error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password: tempPassword,
        options: {
          data: {
            full_name: cleanFullName,
            username: cleanUsername,
          },
        },
      });

      if (signUpErr) {
        const errLower = signUpErr.message.toLowerCase();
        if (errLower.includes('already registered') || errLower.includes('already exists')) {
          setErrorMessage('An account with this email already exists. Log in instead.');
        } else {
          setErrorMessage(signUpErr.message);
        }
        setVerifyingEmailLoading(false);
        return;
      }

      // Success: OTP sent
      setOtpSent(true);
      setResendCooldown(60);
      setOtpDigits(['', '', '', '', '', '']);
      setSuccessMessage(`Verification code sent to ${cleanEmail}`);
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 150);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setVerifyingEmailLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resendLoading) return;
    const cleanEmail = regEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    setResendLoading(true);
    resetFeedback();

    try {
      const supabase = await getMobileSupabaseClient(serverUrl);
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccessMessage('A new verification code has been sent to your email.');
        setResendCooldown(60);
        setOtpDigits(['', '', '', '', '', '']);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resend code.');
    } finally {
      setResendLoading(false);
    }
  };

  const verifyOtpCode = async (codeToVerify?: string) => {
    if (isVerifyingOtp) return;
    const code = (codeToVerify || otpDigits.join('')).trim();
    if (code.length !== 6) {
      setErrorMessage('Please enter the 6-digit verification code.');
      return;
    }

    const cleanEmail = regEmail.trim().toLowerCase();
    setIsVerifyingOtp(true);
    resetFeedback();

    try {
      const supabase = await getMobileSupabaseClient(serverUrl);
      const verifyRes = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: code,
        type: 'signup',
      });

      if (verifyRes.error || !verifyRes.data?.session?.access_token) {
        const errMsg = (verifyRes.error?.message || '').toLowerCase();
        if (errMsg.includes('expired') || verifyRes.error?.code === 'otp_expired') {
          setErrorMessage('That code has expired. Request a new code.');
        } else {
          setErrorMessage('That verification code is incorrect.');
        }
        setIsVerifyingOtp(false);
        return;
      }

      const session = verifyRes.data.session;
      const authUser = session.user;

      if (!authUser || !authUser.id || (authUser.email && authUser.email.toLowerCase() !== cleanEmail)) {
        setErrorMessage('Verification identity mismatch. Please try again.');
        setIsVerifyingOtp(false);
        return;
      }

      setVerifiedSession(session);
      setIsEmailVerified(true);
      setOtpSent(false);
      setSuccessMessage('Email verified successfully! Complete your account details below.');
      setTimeout(() => {
        regPasswordRef.current?.focus();
      }, 100);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to verify code.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleChangeEmail = () => {
    setIsEmailVerified(false);
    setOtpSent(false);
    setVerifiedSession(null);
    setOtpDigits(['', '', '', '', '', '']);
    setSuccessMessage(null);
    setErrorMessage(null);
    setTimeout(() => {
      regEmailRef.current?.focus();
    }, 100);
  };

  const handleRegister = async () => {
    if (!isEmailVerified || !verifiedSession?.access_token) {
      setErrorMessage('Please verify your email address before creating your account.');
      return;
    }
    const cleanFullName = regFullName.trim();
    const cleanUsername = regUsername.trim().toLowerCase();
    const cleanEmail = regEmail.trim().toLowerCase();

    if (!cleanFullName) {
      setErrorMessage('Full Name is required.');
      regFullNameRef.current?.focus();
      return;
    }
    if (!cleanUsername) {
      setErrorMessage('Username is required.');
      regUsernameRef.current?.focus();
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

    try {
      // 1. Update permanent password directly in Supabase using the verified session
      const supabase = await getMobileSupabaseClient(serverUrl);
      const { error: pwdErr } = await supabase.auth.updateUser({
        password: regPassword,
      });
      if (pwdErr) {
        setErrorMessage(formatHumanError(pwdErr.message));
        setLoading(false);
        return;
      }

      // 2. Finalize student account with Semester Library backend
      const result = await register({
        fullName: cleanFullName,
        username: cleanUsername,
        email: cleanEmail,
        department: regDept,
        semester: regSem,
        gender: regGender,
        supabaseToken: verifiedSession.access_token,
      });

      setLoading(false);

      if (result.success) {
        setSuccessMessage('✓ Account created! Welcome to Semester Library.');
        setTimeout(() => {
          router.replace('/(tabs)');
        }, 150);
      } else {
        setErrorMessage(formatHumanError(result.error));
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(formatHumanError(err.message));
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
              {/* 1. Full Name */}
              <TextField
                ref={regFullNameRef}
                label="Full Name"
                placeholder="e.g. Saugat Subedi"
                value={regFullName}
                onChangeText={setRegFullName}
                leftIcon="person-outline"
                autoCapitalize="words"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => regUsernameRef.current?.focus()}
              />

              {/* 2. Username */}
              <TextField
                ref={regUsernameRef}
                label="Username"
                placeholder="e.g. saugat123"
                value={regUsername}
                onChangeText={(val) => setRegUsername(val.toLowerCase().replace(/\s+/g, ''))}
                leftIcon="at-outline"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => regEmailRef.current?.focus()}
              />

              {/* 3. Email Row with Inline Verify Button / Verified Status */}
              <TextField
                ref={regEmailRef}
                label="Email"
                placeholder="e.g. saugatxtra@gmail.com"
                value={regEmail}
                editable={!isEmailVerified}
                onChangeText={(val) => {
                  setRegEmail(val);
                  if (otpSent) {
                    setOtpSent(false);
                    setOtpDigits(['', '', '', '', '', '']);
                    resetFeedback();
                  }
                }}
                leftIcon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                rightNode={
                  isEmailVerified ? (
                    <View style={styles.verifiedRightNode}>
                      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                      <Text style={styles.verifiedText}>✓ Verified</Text>
                      <TouchableOpacity
                        onPress={handleChangeEmail}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ marginLeft: 6 }}
                      >
                        <Text style={[styles.changeEmailText, { color: colors.textSecondary }]}>Change</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.inlineVerifyBtn,
                        {
                          backgroundColor: colors.primary,
                        },
                        (!regEmail.trim() || verifyingEmailLoading) && { opacity: 0.5 },
                      ]}
                      onPress={handleSendVerificationCode}
                      disabled={!regEmail.trim() || verifyingEmailLoading}
                      activeOpacity={0.7}
                    >
                      {verifyingEmailLoading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.inlineVerifyBtnText}>
                          {otpSent ? 'Resend' : 'Verify'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                }
              />

              {/* Inline OTP Section: Expands directly BELOW Email */}
              {otpSent && !isEmailVerified && (
                <View
                  style={[
                    styles.otpContainer,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <Text style={[styles.otpTitle, { color: colors.text }]}>
                    Verification Code
                  </Text>
                  <Caption color="muted" style={{ marginBottom: spacing.compact }}>
                    Enter the 6-digit code sent to your email
                  </Caption>

                  <View style={styles.otpBoxesRow}>
                    {otpDigits.map((digit, index) => (
                      <TextInput
                        key={index}
                        ref={(el) => {
                          otpInputRefs.current[index] = el;
                        }}
                        style={[
                          styles.otpBox,
                          {
                            backgroundColor: colors.surface,
                            borderColor: digit ? colors.primary : colors.border,
                            color: colors.text,
                          },
                        ]}
                        value={digit}
                        onChangeText={(txt) => handleOtpChange(txt, index)}
                        onKeyPress={(e) => handleOtpKeyPress(e, index)}
                        keyboardType="number-pad"
                        maxLength={6}
                        selectTextOnFocus
                        textAlign="center"
                      />
                    ))}
                  </View>

                  <Button
                    title="Verify Code"
                    variant="primary"
                    size="md"
                    loading={isVerifyingOtp}
                    disabled={isVerifyingOtp || otpDigits.join('').length !== 6}
                    onPress={() => verifyOtpCode()}
                    style={{ marginTop: spacing.compact }}
                  />

                  <View style={styles.resendRow}>
                    {resendCooldown > 0 ? (
                      <Text style={[styles.resendTimerText, { color: colors.textSecondary }]}>
                        Resend code in {resendCooldown}s
                      </Text>
                    ) : (
                      <TouchableOpacity
                        onPress={handleResendOtp}
                        disabled={resendLoading}
                        style={{ paddingVertical: 4 }}
                      >
                        <Text style={[styles.resendActiveText, { color: colors.accent }]}>
                          {resendLoading ? 'Sending...' : 'Resend Code'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* Progressive Disclosure: Revealed ONLY after Email Verification */}
              {isEmailVerified && (
                <View style={styles.revealedSection}>
                  <PasswordField
                    ref={regPasswordRef}
                    label="Password"
                    placeholder="At least 8 characters"
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

                  <Button
                    title={loading ? 'Creating account...' : 'Create Account'}
                    variant="primary"
                    size="lg"
                    loading={loading}
                    disabled={
                      loading ||
                      !regFullName.trim() ||
                      !regUsername.trim() ||
                      !regPassword ||
                      regPassword.length < 8 ||
                      regPassword !== regConfirmPassword ||
                      !regSem ||
                      !regGender
                    }
                    onPress={handleRegister}
                    style={{ marginTop: spacing.micro }}
                  />
                </View>
              )}

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
  inlineVerifyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineVerifyBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  verifiedRightNode: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
    marginLeft: 3,
  },
  changeEmailText: {
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  otpContainer: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    marginTop: -4,
  },
  otpTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  otpBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 6,
  },
  otpBox: {
    width: 44,
    height: 48,
    borderRadius: 8,
    borderWidth: 1.5,
    fontSize: 20,
    fontWeight: '700',
  },
  resendRow: {
    alignItems: 'center',
    marginTop: 10,
  },
  resendTimerText: {
    fontSize: 12,
  },
  resendActiveText: {
    fontSize: 13,
    fontWeight: '600',
  },
  revealedSection: {
    marginTop: 2,
  },
});
