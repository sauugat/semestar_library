import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';

export const TEACHER_ONBOARDING_TOKEN_KEY = 'semester_library_teacher_onboarding_token';

interface SubjectItem {
  id: string;
  code: string;
  title: string;
  semester: number;
}

export default function TeacherOnboardingScreen() {
  const router = useRouter();
  const { colors, radii, spacing } = useTheme();
  const { serverUrl } = useAuth();
  const params = useLocalSearchParams<{ token?: string; state?: string }>();

  const [activeToken, setActiveToken] = useState<string>(params.token || '');
  const [isCompleted, setIsCompleted] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Non-dismissible lock: intercept Android hardware back press
  useEffect(() => {
    const backAction = () => {
      // Consume back press and do nothing
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  // Steps: 1: Account, 2: Subjects, 3: Awaiting Email
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 1 State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 2 State
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Step 3 State
  const [maskedEmail, setMaskedEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [savingNewEmail, setSavingNewEmail] = useState(false);

  // Common UI feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check initial state from server on mount
  useEffect(() => {
    const checkState = async () => {
      let tokenToUse = activeToken;
      if (!tokenToUse) {
        tokenToUse = (await SecureStore.getItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => null)) || '';
        if (tokenToUse) {
          setActiveToken(tokenToUse);
        }
      } else {
        await SecureStore.setItemAsync(TEACHER_ONBOARDING_TOKEN_KEY, tokenToUse).catch(() => {});
      }

      if (!tokenToUse) {
        Alert.alert('Session Missing', 'Please log in with your temporary credentials.', [
          { text: 'OK', onPress: () => router.replace('/login') },
        ]);
        return;
      }

      try {
        const res = await fetch(`${serverUrl}/api/teacher/onboarding/state`, {
          headers: { Authorization: `Bearer ${tokenToUse}` },
        });
        if (res.status === 401) {
          await SecureStore.deleteItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => {});
          Alert.alert('Session Expired', 'Please log in again with your temporary credentials.', [
            { text: 'OK', onPress: () => router.replace('/login') },
          ]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.status === 'completed' || data.completed) {
          await SecureStore.deleteItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => {});
          setIsCompleted(true);
          return;
        }
        if (data.status === 'awaiting_email_verification') {
          setMaskedEmail(data.emailMasked || '');
          setCurrentStep(3);
        } else {
          loadSubjectsList(tokenToUse);
        }
      } catch (err) {
        loadSubjectsList(tokenToUse);
      }
    };

    checkState();
  }, [params.token, serverUrl]);

  // Load BIT subjects
  const loadSubjectsList = async (tokenToUse?: string) => {
    const token = tokenToUse || activeToken;
    if (!token) return;
    setLoadingSubjects(true);
    try {
      const res = await fetch(`${serverUrl}/api/teacher/onboarding/subjects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSubjects(data.subjects || []);
      }
    } catch (err) {
      console.warn('Failed to load subjects:', err);
    } finally {
      setLoadingSubjects(false);
    }
  };

  // Manual Check Status Handler
  const handleCheckStatus = async () => {
    if (checkingStatus) return;
    setCheckingStatus(true);
    setErrorMessage(null);

    try {
      let tokenToUse = activeToken;
      if (!tokenToUse) {
        tokenToUse = (await SecureStore.getItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => null)) || '';
      }
      const res = await fetch(`${serverUrl}/api/teacher/onboarding/state`, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'completed' || data.completed) {
        await SecureStore.deleteItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => {});
        setIsCompleted(true);
        return;
      }
      if (res.status === 401) {
        await SecureStore.deleteItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => {});
        Alert.alert('Session Expired', 'Please log in again with your temporary credentials.', [
          { text: 'OK', onPress: () => router.replace('/login') },
        ]);
        return;
      }
      Alert.alert('Awaiting Verification', 'Your email verification is still pending. Tap the link in your email, then check status again.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not check status. Please verify your connection.');
    } finally {
      setCheckingStatus(false);
    }
  };

  // Cooldown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Step 1 Validation
  const handleProceedToSubjects = () => {
    setErrorMessage(null);
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
      setErrorMessage('Full Name must be between 2 and 100 characters.');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9._]{3,30}$/;
    if (!usernameRegex.test(cleanUsername)) {
      setErrorMessage('Username must be 3–30 characters (letters, numbers, dot, or underscore).');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage('Please enter a valid recovery email address.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setCurrentStep(2);
  };

  // Subject selection helpers
  const toggleSubject = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const removeSubject = (id: string) => {
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  };

  // Filtered & grouped subjects
  const filteredSubjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.code && s.code.toLowerCase().includes(q))
    );
  }, [subjects, searchQuery]);

  const groupedBySemester = useMemo(() => {
    const map: Record<number, SubjectItem[]> = {};
    for (let sem = 1; sem <= 8; sem++) {
      map[sem] = [];
    }
    filteredSubjects.forEach((sub) => {
      const sem = sub.semester || 1;
      if (!map[sem]) map[sem] = [];
      map[sem].push(sub);
    });
    return map;
  }, [filteredSubjects]);

  // Submit Onboarding
  const handleSubmitSetup = async () => {
    if (selectedIds.length === 0) {
      setErrorMessage('Please select at least one subject you teach.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const payload = {
        name: name.trim().replace(/\s+/g, ' '),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        confirmPassword,
        subjectIds: selectedIds,
      };

      const res = await fetch(`${serverUrl}/api/teacher/onboarding/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Onboarding submission failed.');
      }

      setMaskedEmail(data.emailMasked || email);
      setCurrentStep(3);
      setResendCooldown(60);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during onboarding.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Resend Verification Email
  const handleResend = async () => {
    if (resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${serverUrl}/api/teacher/onboarding/resend-verification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to resend verification email.');
      }
      Alert.alert('Email Sent', 'Verification link resent to your email.');
      setResendCooldown(60);
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not resend email.');
    } finally {
      setResendLoading(false);
    }
  };

  // Change Email Action
  const handleSaveNewEmail = async () => {
    const cleanNewEmail = newEmailInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanNewEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setSavingNewEmail(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${serverUrl}/api/teacher/onboarding/change-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ email: cleanNewEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Could not change email.');
      }
      setMaskedEmail(data.emailMasked || cleanNewEmail);
      setIsChangingEmail(false);
      setNewEmailInput('');
      setResendCooldown(60);
      Alert.alert('Email Updated', 'Verification email sent to your new address.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update email.');
    } finally {
      setSavingNewEmail(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 60 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header Branding */}
        <View style={styles.header}>
          <Text variant="xl" weight="800" style={{ color: colors.text, textAlign: 'center' }}>
            Teacher Account Setup
          </Text>
          <Text variant="sm" color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
            {currentStep === 1 && 'Step 1: Set up your permanent identity'}
            {currentStep === 2 && 'Step 2: Choose the BIT subjects you teach'}
            {currentStep === 3 && 'Step 3: Verify your recovery email'}
          </Text>
        </View>

        {isCompleted ? (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(34, 197, 94, 0.15)', width: 80, height: 80, borderRadius: 40 }]}>
              <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
            </View>
            <Text variant="xl" weight="800" style={{ color: colors.text, marginTop: 16 }}>
              Account Ready
            </Text>
            <Text variant="sm" color="muted" style={{ textAlign: 'center', marginTop: 10, lineHeight: 22, paddingHorizontal: 16 }}>
              Your teacher account is ready. Sign in with your new username and password.
            </Text>
            <Button
              title="Sign In"
              variant="primary"
              size="lg"
              onPress={async () => {
                await SecureStore.deleteItemAsync(TEACHER_ONBOARDING_TOKEN_KEY).catch(() => {});
                router.replace('/login');
              }}
              style={{ marginTop: 24, width: '100%', borderRadius: radii.md }}
            />
          </View>
        ) : (
          <>
            {/* Step Indicator */}
            <View style={styles.stepperRow}>
              <View style={[styles.stepDot, currentStep >= 1 && { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNum, currentStep >= 1 && { color: colors.background }]}>1</Text>
              </View>
              <View style={[styles.stepLine, currentStep >= 2 && { backgroundColor: colors.primary }]} />
              <View style={[styles.stepDot, currentStep >= 2 && { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNum, currentStep >= 2 && { color: colors.background }]}>2</Text>
              </View>
              <View style={[styles.stepLine, currentStep >= 3 && { backgroundColor: colors.primary }]} />
              <View style={[styles.stepDot, currentStep >= 3 && { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNum, currentStep >= 3 && { color: colors.background }]}>3</Text>
              </View>
            </View>

            {/* Error Alert Banner */}
            {errorMessage ? (
              <View style={[styles.errorBanner, { backgroundColor: colors.surfaceRaised, borderColor: colors.error }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} style={{ marginRight: 8 }} />
                <Text variant="xs" style={{ color: colors.error, flex: 1 }}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

        {/* STEP 1: Personal Account */}
        {currentStep === 1 && (
          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                FULL NAME
              </Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="e.g. Dr. Ram Sharma"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                PERMANENT USERNAME
              </Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="e.g. ram.sharma"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                RECOVERY EMAIL
              </Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="e.g. ram.sharma@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                NEW PASSWORD (MIN 8 CHARS)
              </Text>
              <View style={[styles.passwordWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.text }]}
                  placeholder="Enter secure password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 8 }}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                CONFIRM PASSWORD
              </Text>
              <View style={[styles.passwordWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.text }]}
                  placeholder="Confirm your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={{ padding: 8 }}>
                  <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <Button
              title="Continue to Subjects →"
              variant="primary"
              size="lg"
              onPress={handleProceedToSubjects}
              style={{ marginTop: 12, borderRadius: radii.md }}
            />
          </View>
        )}

        {/* STEP 2: Subjects You Teach */}
        {currentStep === 2 && (
          <View style={styles.card}>
            {/* Search Input */}
            <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 14 }}
                placeholder="Search subjects or course code (e.g. CIT123)..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {/* Selected Chips */}
            <View style={{ marginVertical: 10 }}>
              <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 6 }}>
                SELECTED ({selectedIds.length})
              </Text>
              <View style={styles.chipsWrap}>
                {selectedIds.length === 0 ? (
                  <Text variant="xs" color="muted">No subjects selected yet.</Text>
                ) : (
                  selectedIds.map((id) => {
                    const sub = subjects.find((s) => s.id === id);
                    return (
                      <View key={id} style={[styles.chip, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                        <Text variant="xs" weight="600" style={{ color: colors.text, marginRight: 4 }}>
                          {sub ? sub.code : id}
                        </Text>
                        <TouchableOpacity onPress={() => removeSubject(id)}>
                          <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </View>
            </View>

            {/* Grouped Semester List */}
            {loadingSubjects ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.subjectListWrapper}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                  const semSubjects = groupedBySemester[sem];
                  if (!semSubjects || semSubjects.length === 0) return null;
                  return (
                    <View key={sem} style={{ marginBottom: 14 }}>
                      <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 6, letterSpacing: 0.5 }}>
                        SEMESTER {sem}
                      </Text>
                      {semSubjects.map((sub) => {
                        const isSelected = selectedIds.includes(sub.id);
                        return (
                          <TouchableOpacity
                            key={sub.id}
                            style={[
                              styles.subjectItem,
                              { borderBottomColor: colors.borderSubtle },
                              isSelected && { backgroundColor: colors.surfaceRaised },
                            ]}
                            onPress={() => toggleSubject(sub.id)}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={isSelected ? 'checkbox' : 'square-outline'}
                              size={20}
                              color={isSelected ? colors.primary : colors.textMuted}
                              style={{ marginRight: 10 }}
                            />
                            <View style={{ flex: 1 }}>
                              <Text variant="sm" weight="600" style={{ color: colors.text }}>
                                {sub.code}
                              </Text>
                              <Text variant="xs" color="muted">
                                {sub.title}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Concise Review Card */}
            <View style={[styles.reviewCard, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
              <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 4 }}>
                REVIEW SETUP
              </Text>
              <Text variant="xs" style={{ color: colors.text }}>
                <Text weight="600">Name:</Text> {name}
              </Text>
              <Text variant="xs" style={{ color: colors.text }}>
                <Text weight="600">Username:</Text> @{username}
              </Text>
              <Text variant="xs" style={{ color: colors.text }}>
                <Text weight="600">Email:</Text> {email}
              </Text>
              <Text variant="xs" style={{ color: colors.text }}>
                <Text weight="600">Subjects:</Text> {selectedIds.length} selected
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <Button
                title="← Back"
                variant="outline"
                size="md"
                onPress={() => setCurrentStep(1)}
                style={{ flex: 1, marginRight: 8, borderRadius: radii.md }}
              />
              <Button
                title="Complete Setup"
                variant="primary"
                size="md"
                loading={isSubmitting}
                onPress={handleSubmitSetup}
                style={{ flex: 2, borderRadius: radii.md }}
              />
            </View>
          </View>
        )}

        {/* STEP 3: Verify Your Email */}
        {currentStep === 3 && (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail-outline" size={40} color={colors.primary} />
            </View>
            <Text variant="lg" weight="800" style={{ color: colors.text, marginTop: 12 }}>
              Verify Your Email
            </Text>
            <Text variant="sm" color="muted" style={{ textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
              We sent a verification link to <Text weight="700" style={{ color: colors.text }}>{maskedEmail}</Text>.
              Please open your email and tap the link to activate your permanent faculty account.
            </Text>

            <View style={{ width: '100%', marginTop: 24, gap: 10 }}>
              <Button
                title={resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
                variant="primary"
                size="md"
                disabled={resendCooldown > 0}
                loading={resendLoading}
                onPress={handleResend}
                style={{ borderRadius: radii.md }}
              />

              <Button
                title="Check Status"
                variant="outline"
                size="md"
                loading={checkingStatus}
                onPress={handleCheckStatus}
                style={{ borderRadius: radii.md }}
              />

              <Button
                title="Change Email Address"
                variant="outline"
                size="md"
                onPress={() => setIsChangingEmail(!isChangingEmail)}
                style={{ borderRadius: radii.md }}
              />
            </View>

            {/* Change Email Subform */}
            {isChangingEmail && (
              <View style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text variant="xs" weight="700" color="muted" style={styles.fieldLabel}>
                  CORRECT EMAIL ADDRESS
                </Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
                  placeholder="new.email@example.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={newEmailInput}
                  onChangeText={setNewEmailInput}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button
                    title="Cancel"
                    variant="outline"
                    size="sm"
                    onPress={() => setIsChangingEmail(false)}
                    style={{ flex: 1, borderRadius: radii.md }}
                  />
                  <Button
                    title="Save & Resend"
                    variant="primary"
                    size="sm"
                    loading={savingNewEmail}
                    onPress={handleSaveNewEmail}
                    style={{ flex: 1, borderRadius: radii.md }}
                  />
                </View>
              </View>
            )}
          </View>
        )}
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 30,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#71717a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717a',
  },
  stepLine: {
    width: 36,
    height: 2,
    backgroundColor: '#71717a',
    marginHorizontal: 6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  card: {
    width: '100%',
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    borderWidth: 1,
    borderRadius: 8,
    paddingLeft: 12,
  },
  passwordInput: {
    flex: 1,
    fontSize: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  subjectListWrapper: {
    maxHeight: 280,
    marginVertical: 10,
  },
  subjectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderBottomWidth: 1,
  },
  reviewCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120, 120, 120, 0.1)',
  },
  subCard: {
    width: '100%',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
  },
});
