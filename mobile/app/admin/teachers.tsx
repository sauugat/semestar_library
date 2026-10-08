import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/services/api';

interface TeacherSubject {
  id: string;
  code: string;
  name?: string;
  title?: string;
}

interface TeacherProfile {
  name?: string | null;
  username?: string | null;
  email?: string | null;
  designation?: string | null;
  subjects?: TeacherSubject[];
}

interface TeacherInviteItem {
  id: string;
  temporary_username: string;
  status: 'provisioned' | 'onboarding' | 'awaiting_email_verification' | 'active' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  activated_at?: string | null;
  teacher?: TeacherProfile | null;
}

interface SummaryData {
  total_invites?: number;
  awaiting_activation?: number;
  active_teachers?: number;
  expired?: number;
  revoked?: number;
}

interface GeneratedCredential {
  username: string;
  temporaryPassword?: string;
  tempPassword?: string;
  temporary_password?: string;
  expiresAt?: string;
  expires_at?: string;
}

export default function AdminTeachersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii, typography } = useTheme();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

  // Data state
  const [invites, setInvites] = useState<TeacherInviteItem[]>([]);
  const [summary, setSummary] = useState<SummaryData>({});
  const [onboardingEnabled, setOnboardingEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Single/Bulk Action Modals
  const [isCreatingSingle, setIsCreatingSingle] = useState<boolean>(false);
  const [bulkModalVisible, setBulkModalVisible] = useState<boolean>(false);
  const [bulkCount, setBulkCount] = useState<string>('5');
  const [isCreatingBulk, setIsCreatingBulk] = useState<boolean>(false);

  // Credentials One-Time Display Modal
  const [credentialsModalVisible, setCredentialsModalVisible] = useState<boolean>(false);
  const [credentialsTitle, setCredentialsTitle] = useState<string>('Teacher Login Created');
  const [credentialsList, setCredentialsList] = useState<GeneratedCredential[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Active Teacher Detail Modal
  const [detailModalVisible, setDetailModalVisible] = useState<boolean>(false);
  const [selectedInvite, setSelectedInvite] = useState<TeacherInviteItem | null>(null);

  // Fetch invites from server
  const loadInvites = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter);
      }

      const res = await apiFetch(`/api/admin/teacher-invites?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Administrator access required.');
        }
        const errJson = await res.json().catch(() => ({}));
        const rawMsg = errJson.message || 'Could not load teacher management. Please try again.';
        const safeMsg = rawMsg.toLowerCase().includes('cohort')
          ? 'Teacher management is temporarily unavailable.'
          : rawMsg;
        throw new Error(safeMsg);
      }

      const data = await res.json();
      setInvites(data.invites || []);
      setSummary(data.summary || {});
      setOnboardingEnabled(data.onboarding_enabled !== false);
    } catch (err: any) {
      setError(err?.message || 'Could not load teacher management. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    if (isAdmin) {
      loadInvites();
    }
  }, [isAdmin, loadInvites]);

  // Handle single create
  const handleCreateSingle = async () => {
    setIsCreatingSingle(true);
    try {
      const res = await apiFetch('/api/admin/teacher-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const rawMsg = errJson.message || 'Failed to create teacher login.';
        const safeMsg = rawMsg.toLowerCase().includes('cohort')
          ? 'Teacher management is temporarily unavailable.'
          : rawMsg;
        throw new Error(safeMsg);
      }

      const data = await res.json();
      const generated = data.invites || [];
      if (generated.length === 0) {
        throw new Error('No credentials generated.');
      }

      setCredentialsTitle('Teacher Login Created');
      setCredentialsList(
        generated.map((inv: any) => ({
          username: inv.username || inv.temporary_username,
          temporaryPassword: inv.temporaryPassword || inv.temporary_password,
          expiresAt: inv.expiresAt || inv.expires_at,
        }))
      );
      setCredentialsModalVisible(true);
      loadInvites(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create teacher login.');
    } finally {
      setIsCreatingSingle(false);
    }
  };

  // Handle bulk create
  const handleCreateBulk = async () => {
    const count = parseInt(bulkCount, 10);
    if (isNaN(count) || count < 1 || count > 50) {
      Alert.alert('Invalid Count', 'Please enter a number between 1 and 50.');
      return;
    }

    setIsCreatingBulk(true);
    try {
      const res = await apiFetch('/api/admin/teacher-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const rawMsg = errJson.message || 'Failed to generate bulk credentials.';
        const safeMsg = rawMsg.toLowerCase().includes('cohort')
          ? 'Teacher management is temporarily unavailable.'
          : rawMsg;
        throw new Error(safeMsg);
      }

      const data = await res.json();
      const generated = data.invites || [];

      setBulkModalVisible(false);
      setCredentialsTitle(`Batch Created (${generated.length} Logins)`);
      setCredentialsList(
        generated.map((inv: any) => ({
          username: inv.username || inv.temporary_username,
          temporaryPassword: inv.temporaryPassword || inv.temporary_password,
          expiresAt: inv.expiresAt || inv.expires_at,
        }))
      );
      setCredentialsModalVisible(true);
      loadInvites(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to generate bulk logins.');
    } finally {
      setIsCreatingBulk(false);
    }
  };

  // Handle regenerate password
  const handleRegeneratePassword = (username: string) => {
    Alert.alert(
      'Regenerate Password',
      `Generate a new temporary password for ${username}? Any previous password will immediately stop working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/admin/teacher-invites/${username}/regenerate-password`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to regenerate password.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? 'Teacher management is temporarily unavailable.'
                  : rawMsg;
                throw new Error(safeMsg);
              }
              const data = await res.json();
              setCredentialsTitle(`Password Regenerated: ${username}`);
              setCredentialsList([
                {
                  username,
                  temporaryPassword: data.temporaryPassword || data.temporary_password,
                  expiresAt: data.expiresAt || data.expires_at,
                },
              ]);
              setCredentialsModalVisible(true);
              loadInvites(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to regenerate password.');
            }
          },
        },
      ]
    );
  };

  // Handle reissue
  const handleReissue = (username: string) => {
    Alert.alert(
      'Reissue Invitation',
      `Reissue invite for ${username}? This resets the 14-day expiry window and generates a fresh temporary password.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reissue',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/admin/teacher-invites/${username}/reissue`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to reissue invitation.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? 'Teacher management is temporarily unavailable.'
                  : rawMsg;
                throw new Error(safeMsg);
              }
              const data = await res.json();
              setCredentialsTitle(`Invite Reissued: ${username}`);
              setCredentialsList([
                {
                  username,
                  temporaryPassword: data.temporaryPassword || data.temporary_password,
                  expiresAt: data.expiresAt || data.expires_at,
                },
              ]);
              setCredentialsModalVisible(true);
              loadInvites(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to reissue invitation.');
            }
          },
        },
      ]
    );
  };

  // Handle revoke
  const handleRevoke = (username: string) => {
    Alert.alert(
      'Revoke Invitation',
      `Revoke invite ${username}? This action is permanent and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/admin/teacher-invites/${username}/revoke`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to revoke invitation.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? 'Teacher management is temporarily unavailable.'
                  : rawMsg;
                throw new Error(safeMsg);
              }
              Alert.alert('Revoked', `Invite ${username} has been revoked.`);
              loadInvites(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to revoke invitation.');
            }
          },
        },
      ]
    );
  };

  // Copy helpers
  const copyText = async (text: string, key: string, message = 'Copied to clipboard!') => {
    await Clipboard.setStringAsync(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const copyAllCredentials = async () => {
    const formatted = credentialsList
      .map((c) => `Username: ${c.username}\nTemporary Password: ${c.temporaryPassword || ''}`)
      .join('\n\n---\n\n');
    await Clipboard.setStringAsync(formatted);
    Alert.alert('Copied', 'All generated credentials copied to clipboard.');
  };

  // Status badge config
  const getStatusBadge = (status: TeacherInviteItem['status']) => {
    switch (status) {
      case 'active':
        return <Badge label="Active Faculty" variant="success" size="sm" icon="checkmark-circle-outline" />;
      case 'provisioned':
        return <Badge label="Awaiting Setup" variant="warning" size="sm" icon="time-outline" />;
      case 'onboarding':
      case 'awaiting_email_verification':
        return <Badge label="Setup In Progress" variant="warning" size="sm" icon="sync-outline" />;
      case 'expired':
        return <Badge label="Expired" variant="neutral" size="sm" icon="alert-circle-outline" />;
      case 'revoked':
        return <Badge label="Revoked" variant="error" size="sm" icon="close-circle-outline" />;
      default:
        return <Badge label={status} variant="neutral" size="sm" />;
    }
  };

  // Non-admin Access Denied View
  if (!isAdmin) {
    return (
      <View style={[styles.deniedContainer, { backgroundColor: colors.background, paddingTop: insets.top + 40 }]}>
        <Ionicons name="shield-outline" size={64} color={colors.error} />
        <Heading style={{ marginTop: 16, color: colors.text }}>Access Denied</Heading>
        <Text color="secondary" style={{ textAlign: 'center', marginTop: 8, paddingHorizontal: 32 }}>
          Administrator privileges are required to manage teacher invitations and faculty accounts.
        </Text>
        <Button
          title="Go Back"
          variant="outline"
          size="md"
          onPress={() => router.back()}
          style={{ marginTop: 24 }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadInvites(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header Title Section */}
        <View style={styles.headerBlock}>
          <Text variant="xs" weight="700" color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Admin Portal
          </Text>
          <Heading style={{ marginTop: 2 }}>Teacher Management</Heading>
          <Caption color="secondary" style={{ marginTop: 4 }}>
            Create and manage temporary teacher access credentials.
          </Caption>
        </View>

        {/* Feature Flag Banner (Onboarding Disabled) */}
        {!onboardingEnabled && (
          <Card
            variant="outlined"
            padding="md"
            style={[styles.bannerCard, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}
          >
            <View style={styles.bannerRow}>
              <Ionicons name="alert-circle" size={20} color={colors.warning} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text variant="xs" weight="700" style={{ color: colors.warning }}>
                  Teacher onboarding is currently disabled.
                </Text>
                <Caption style={{ color: colors.text, marginTop: 2 }}>
                  You can prepare credentials, but teachers cannot activate them yet.
                </Caption>
              </View>
            </View>
          </Card>
        )}

        {/* Action Buttons Row */}
        <View style={styles.actionButtonsRow}>
          <Button
            title="Create Teacher Login"
            variant="primary"
            size="md"
            loading={isCreatingSingle}
            leftIcon={<Ionicons name="person-add-outline" size={16} color="#FFFFFF" />}
            onPress={handleCreateSingle}
            style={{ flex: 1.2 }}
          />
          <Button
            title="Create Multiple"
            variant="secondary"
            size="md"
            leftIcon={<Ionicons name="copy-outline" size={16} color={colors.text} />}
            onPress={() => setBulkModalVisible(true)}
            style={{ flex: 1 }}
          />
        </View>

        {/* Summary Metrics Strip */}
        <Card variant="elevated" padding="md" style={styles.summaryCard}>
          <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 10, textTransform: 'uppercase' }}>
            Invitation Overview
          </Text>
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text variant="xl" weight="800" style={{ color: colors.text }}>
                {summary.total_invites ?? 0}
              </Text>
              <Caption color="muted">Total</Caption>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text variant="xl" weight="800" style={{ color: colors.warning }}>
                {summary.awaiting_activation ?? 0}
              </Text>
              <Caption color="muted">Awaiting</Caption>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text variant="xl" weight="800" style={{ color: colors.success }}>
                {summary.active_teachers ?? 0}
              </Text>
              <Caption color="muted">Active</Caption>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text variant="xl" weight="800" style={{ color: colors.textSecondary }}>
                {summary.expired ?? 0}
              </Text>
              <Caption color="muted">Expired</Caption>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text variant="xl" weight="800" style={{ color: colors.error }}>
                {summary.revoked ?? 0}
              </Text>
              <Caption color="muted">Revoked</Caption>
            </View>
          </View>
        </Card>

        {/* Search & Status Filters */}
        <View style={styles.filterSection}>
          <View style={[styles.searchBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={17} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search teacher ID, name, email..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              onSubmitEditing={() => loadInvites()}
            />
            {Boolean(searchQuery) && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterPillsScroll}>
            {[
              { id: 'all', label: 'All Invites' },
              { id: 'provisioned', label: 'Awaiting Setup' },
              { id: 'active', label: 'Active Faculty' },
              { id: 'expired', label: 'Expired' },
              { id: 'revoked', label: 'Revoked' },
            ].map((f) => {
              const active = statusFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setStatusFilter(f.id)}
                >
                  <Text
                    variant="xs"
                    weight={active ? '700' : '500'}
                    style={{ color: active ? '#FFFFFF' : colors.textSecondary }}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* List Content / Loading / Empty State */}
        {loading && !refreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Caption color="muted" style={{ marginTop: 12 }}>
              Loading teacher invitations...
            </Caption>
          </View>
        ) : error ? (
          <Card variant="outlined" padding="lg" style={[styles.errorCard, { borderColor: colors.error }]}>
            <Ionicons name="warning-outline" size={32} color={colors.error} />
            <Text weight="700" style={{ marginTop: 8, color: colors.error }}>
              {error}
            </Text>
            <Button
              title="Try Again"
              variant="outline"
              size="sm"
              onPress={() => loadInvites()}
              style={{ marginTop: 16 }}
            />
          </Card>
        ) : invites.length === 0 ? (
          <Card variant="outlined" padding="lg" style={styles.emptyCard}>
            <Ionicons name="folder-open-outline" size={40} color={colors.textMuted} />
            <Text weight="600" style={{ marginTop: 12, color: colors.text }}>
              No Teacher Invites Found
            </Text>
            <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search query or filter.'
                : 'Tap "Create Teacher Login" above to generate your first temporary access credentials.'}
            </Caption>
          </Card>
        ) : (
          <View style={styles.invitesList}>
            {invites.map((item) => {
              const isUnused = item.status === 'provisioned' || item.status === 'onboarding' || item.status === 'awaiting_email_verification';
              const isActive = item.status === 'active';
              const teacher = item.teacher;

              return (
                <Card key={item.id || item.temporary_username} variant="elevated" padding="md" style={styles.inviteCard}>
                  {/* Card Header */}
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text variant="md" weight="800" style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: colors.text }}>
                        {item.temporary_username}
                      </Text>
                      {isActive && teacher?.name && (
                        <Text variant="sm" weight="600" style={{ color: colors.text, marginTop: 2 }}>
                          {teacher.name}
                        </Text>
                      )}
                      {isActive && teacher?.username && (
                        <Caption color="muted" style={{ marginTop: 1 }}>
                          @{teacher.username}
                        </Caption>
                      )}
                    </View>
                    {getStatusBadge(item.status)}
                  </View>

                  {/* Card Body Details */}
                  <View style={styles.cardMetaBlock}>
                    {isActive ? (
                      <View style={{ gap: 4 }}>
                        {teacher?.email && (
                          <View style={styles.metaRow}>
                            <Ionicons name="mail-outline" size={13} color={colors.textMuted} />
                            <Caption color="secondary">{teacher.email}</Caption>
                          </View>
                        )}
                        {teacher?.subjects && teacher.subjects.length > 0 && (
                          <View style={styles.subjectsRow}>
                            <Ionicons name="book-outline" size={13} color={colors.textMuted} />
                            <View style={styles.subjectsPillContainer}>
                              {teacher.subjects.map((s) => (
                                <View
                                  key={s.id || s.code}
                                  style={[styles.subjectChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                                >
                                  <Text variant="xs" weight="700" style={{ fontSize: 10, color: colors.textSecondary }}>
                                    {s.code}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={styles.metaRow}>
                        <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                        <Caption color="muted">
                          Expires: {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '14 days'}
                        </Caption>
                      </View>
                    )}
                  </View>

                  {/* Action Toolbar */}
                  <View style={[styles.cardActionToolbar, { borderTopColor: colors.borderSubtle }]}>
                    {isUnused ? (
                      <>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleRegeneratePassword(item.temporary_username)}
                        >
                          <Ionicons name="key-outline" size={14} color={colors.primary} />
                          <Text variant="xs" weight="600" style={{ color: colors.primary, marginLeft: 4 }}>
                            Regenerate
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleReissue(item.temporary_username)}
                        >
                          <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
                          <Text variant="xs" weight="600" style={{ color: colors.textSecondary, marginLeft: 4 }}>
                            Reissue
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleRevoke(item.temporary_username)}
                        >
                          <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                          <Text variant="xs" weight="600" style={{ color: colors.error, marginLeft: 4 }}>
                            Revoke
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : isActive ? (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => {
                          setSelectedInvite(item);
                          setDetailModalVisible(true);
                        }}
                      >
                        <Ionicons name="person-outline" size={14} color={colors.primary} />
                        <Text variant="xs" weight="600" style={{ color: colors.primary, marginLeft: 4 }}>
                          View Faculty Details
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Caption color="muted">No actions available for {item.status} invite</Caption>
                    )}
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ============================================================ */}
      {/* 1. CREDENTIALS ONE-TIME DISPLAY MODAL                         */}
      {/* ============================================================ */}
      <Modal
        visible={credentialsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCredentialsList([]);
          setCredentialsModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Subheading weight="800">{credentialsTitle}</Subheading>
                <Caption color="muted">One-time temporary credentials. Save securely now.</Caption>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setCredentialsList([]);
                  setCredentialsModalVisible(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360, marginVertical: 12 }}>
              {credentialsList.map((cred, idx) => {
                const uKey = `u-${cred.username}`;
                const pKey = `p-${cred.username}`;
                const bKey = `b-${cred.username}`;
                const password = cred.temporaryPassword || '—';

                return (
                  <View
                    key={cred.username + idx}
                    style={[styles.credBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                  >
                    <View style={styles.credRow}>
                      <Text variant="xs" weight="700" color="muted">USERNAME:</Text>
                      <Text
                        variant="sm"
                        weight="800"
                        style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: colors.text }}
                      >
                        {cred.username}
                      </Text>
                    </View>

                    <View style={[styles.credRow, { marginTop: 6 }]}>
                      <Text variant="xs" weight="700" color="muted">TEMPORARY PASSWORD:</Text>
                      <Text
                        variant="sm"
                        weight="800"
                        style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: colors.primary }}
                      >
                        {password}
                      </Text>
                    </View>

                    {/* Copy Buttons for this credential */}
                    <View style={styles.credCopyButtons}>
                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() => copyText(cred.username, uKey, 'Username copied!')}
                      >
                        <Ionicons name="copy-outline" size={12} color={colors.text} />
                        <Text variant="xs" weight="600" style={{ marginLeft: 4, color: colors.text }}>
                          {copiedKey === uKey ? 'Copied!' : 'Copy Username'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() => copyText(password, pKey, 'Password copied!')}
                      >
                        <Ionicons name="key-outline" size={12} color={colors.text} />
                        <Text variant="xs" weight="600" style={{ marginLeft: 4, color: colors.text }}>
                          {copiedKey === pKey ? 'Copied!' : 'Copy Password'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() =>
                          copyText(
                            `Username: ${cred.username}\nTemporary Password: ${password}`,
                            bKey,
                            'Username and Password copied!'
                          )
                        }
                      >
                        <Ionicons name="duplicate-outline" size={12} color={colors.text} />
                        <Text variant="xs" weight="600" style={{ marginLeft: 4, color: colors.text }}>
                          {copiedKey === bKey ? 'Copied!' : 'Copy Both'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={[styles.warningNote, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
              <Caption style={{ color: colors.warning, marginLeft: 6, flex: 1 }}>
                Passwords are never stored in plaintext and cannot be retrieved again after closing.
              </Caption>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {credentialsList.length > 1 && (
                <Button
                  title="Copy All"
                  variant="outline"
                  size="md"
                  onPress={copyAllCredentials}
                  leftIcon={<Ionicons name="duplicate-outline" size={15} color={colors.text} />}
                  style={{ flex: 1 }}
                />
              )}
              <Button
                title="Done"
                variant="primary"
                size="md"
                onPress={() => {
                  setCredentialsList([]);
                  setCredentialsModalVisible(false);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================ */}
      {/* 2. BULK CREATE MODAL                                          */}
      {/* ============================================================ */}
      <Modal
        visible={bulkModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Subheading weight="800">Create Multiple Logins</Subheading>
              <TouchableOpacity onPress={() => setBulkModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text variant="sm" color="secondary" style={{ marginTop: 8 }}>
              Generate a batch of temporary teacher access credentials (quantity between 1 and 50).
            </Text>

            <View style={{ marginVertical: 18 }}>
              <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 6 }}>
                QUANTITY (1 - 50):
              </Text>
              <TextInput
                style={[
                  styles.countInput,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, color: colors.text },
                ]}
                keyboardType="number-pad"
                value={bulkCount}
                onChangeText={setBulkCount}
                maxLength={2}
              />
            </View>

            <Caption color="muted" style={{ marginBottom: 16 }}>
              Each login will be assigned an incremental identifier (e.g. teacher001) and an unguessable temporary password valid for 14 days.
            </Caption>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="Cancel"
                variant="outline"
                size="md"
                onPress={() => setBulkModalVisible(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Generate Batch"
                variant="primary"
                size="md"
                loading={isCreatingBulk}
                onPress={handleCreateBulk}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================ */}
      {/* 3. ACTIVE TEACHER DETAIL MODAL                                */}
      {/* ============================================================ */}
      <Modal
        visible={detailModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Subheading weight="800">Faculty Details</Subheading>
                <Caption color="muted">{selectedInvite?.temporary_username}</Caption>
              </View>
              <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedInvite?.teacher ? (
              <View style={{ marginVertical: 16, gap: 12 }}>
                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">FULL NAME</Text>
                  <Text variant="sm" weight="700" style={{ color: colors.text }}>
                    {selectedInvite.teacher.name || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">PERMANENT USERNAME</Text>
                  <Text variant="sm" weight="700" style={{ color: colors.text }}>
                    @{selectedInvite.teacher.username || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">ROLE</Text>
                  <Text variant="sm" weight="700" style={{ color: colors.text }}>
                    Teacher
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">EMAIL</Text>
                  <Text variant="sm" weight="600" style={{ color: colors.text }}>
                    {selectedInvite.teacher.email || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">DESIGNATION</Text>
                  <Text variant="sm" weight="600" style={{ color: colors.text }}>
                    {selectedInvite.teacher.designation || 'Lecturer'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text variant="xs" weight="700" color="muted">SUBJECTS TAUGHT</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {selectedInvite.teacher.subjects && selectedInvite.teacher.subjects.length > 0 ? (
                      selectedInvite.teacher.subjects.map((sub) => (
                        <View
                          key={sub.id || sub.code}
                          style={[
                            styles.subjectChip,
                            { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                          ]}
                        >
                          <Text variant="xs" weight="700" style={{ color: colors.text }}>
                            {sub.code}{sub.title || sub.name ? ` — ${sub.title || sub.name}` : ''}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Caption color="muted">No subjects assigned yet.</Caption>
                    )}
                  </View>
                </View>
              </View>
            ) : (
              <Caption color="muted" style={{ marginVertical: 20 }}>
                No active faculty profile linked to this invite.
              </Caption>
            )}

            <Button
              title="Close"
              variant="outline"
              size="md"
              onPress={() => setDetailModalVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  deniedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  headerBlock: {
    marginBottom: 16,
  },
  bannerCard: {
    marginBottom: 16,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    marginBottom: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#33333330',
  },
  filterSection: {
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  filterPillsScroll: {
    flexDirection: 'row',
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  centerLoading: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  errorCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  invitesList: {
    gap: 12,
  },
  inviteCard: {
    borderRadius: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardMetaBlock: {
    marginVertical: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subjectsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  subjectsPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  subjectChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  cardActionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  credBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  credRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  credCopyButtons: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#55555530',
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  warningNote: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
  },
  countInput: {
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
  },
  detailRow: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#55555520',
    paddingBottom: 8,
  },
});
