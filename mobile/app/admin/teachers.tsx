import React, { useState, useEffect, useCallback } from 'react';
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
  temporary_username?: string;
  initial_username?: string;
  username?: string;
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

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'provisioned', label: 'Awaiting' },
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
  { id: 'revoked', label: 'Revoked' },
];

export default function AdminTeachersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
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
        const rawMsg = errJson.message || "Couldn't load teacher management.";
        const safeMsg = rawMsg.toLowerCase().includes('cohort')
          ? "Couldn't load teacher management."
          : rawMsg;
        throw new Error(safeMsg);
      }

      const data = await res.json();
      setInvites(data.invites || []);
      setSummary(data.summary || {});
      setOnboardingEnabled(data.onboarding_enabled !== false);
    } catch (err: any) {
      setError(err?.message || "Couldn't load teacher management.");
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
          ? "Couldn't load teacher management."
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
          username: inv.temporary_username || inv.initial_username || inv.username,
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
          ? "Couldn't load teacher management."
          : rawMsg;
        throw new Error(safeMsg);
      }

      const data = await res.json();
      const generated = data.invites || [];

      setBulkModalVisible(false);
      setCredentialsTitle(`Batch Created (${generated.length} Logins)`);
      setCredentialsList(
        generated.map((inv: any) => ({
          username: inv.temporary_username || inv.initial_username || inv.username,
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
      `Generate a new temporary password for ${username}? The previous temporary password will stop working immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/admin/teacher-invites/${encodeURIComponent(username)}/regenerate-password`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to regenerate password.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? "Couldn't load teacher management."
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
              const res = await apiFetch(`/api/admin/teacher-invites/${encodeURIComponent(username)}/reissue`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to reissue invitation.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? "Couldn't load teacher management."
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
              const res = await apiFetch(`/api/admin/teacher-invites/${encodeURIComponent(username)}/revoke`, {
                method: 'POST',
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const rawMsg = errJson.message || 'Failed to revoke invitation.';
                const safeMsg = rawMsg.toLowerCase().includes('cohort')
                  ? "Couldn't load teacher management."
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

  const copyBothCredentials = async (username: string, password: string) => {
    const text = `Gandaki University — Semester Library Faculty Login\nUsername: ${username}\nTemporary Password: ${password}\n\nPlease log in at https://semestar-library.vercel.app/login.html to complete faculty onboarding.`;
    await Clipboard.setStringAsync(text);
    setCopiedKey(`b-${username}`);
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
        return <Badge label="Active" variant="success" size="sm" />;
      case 'provisioned':
        return <Badge label="Awaiting Setup" variant="warning" size="sm" />;
      case 'onboarding':
      case 'awaiting_email_verification':
        return <Badge label="Setup Started" variant="warning" size="sm" />;
      case 'expired':
        return <Badge label="Expired" variant="neutral" size="sm" />;
      case 'revoked':
        return <Badge label="Revoked" variant="error" size="sm" />;
      default:
        return <Badge label={status} variant="neutral" size="sm" />;
    }
  };

  // Non-admin Access Denied View
  if (!isAdmin) {
    return (
      <View style={[styles.deniedContainer, { backgroundColor: colors.background, paddingTop: insets.top + 40 }]}>
        <Ionicons name="shield-outline" size={56} color={colors.error} />
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
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + 36,
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
        {/* Compact Page Header (Standard native header handled by stack) */}
        <View style={styles.headerBlock}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Teacher Management</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Manage teacher access and faculty accounts.
          </Text>
        </View>

        {/* Feature Flag Banner (Onboarding Disabled) - Compact */}
        {!onboardingEnabled && (
          <View style={styles.compactBanner}>
            <Ionicons name="warning-outline" size={16} color="#fbbf24" style={{ marginTop: 1, marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compactBannerTitle}>
                Teacher onboarding is disabled
              </Text>
              <Text style={[styles.compactBannerSubtext, { color: colors.textSecondary }]}>
                Credentials can be prepared, but teachers cannot activate them yet.
              </Text>
            </View>
          </View>
        )}

        {/* Action Buttons Row */}
        <View style={styles.actionButtonsRow}>
          <Button
            title="+ Create Teacher Login"
            variant="primary"
            size="md"
            loading={isCreatingSingle}
            leftIcon={<Ionicons name="person-add-outline" size={15} color={colors.primaryText} />}
            onPress={handleCreateSingle}
            style={{ flex: 1.3, borderRadius: 12, height: 44 }}
            textStyle={{ fontWeight: '700' }}
          />
          <Button
            title="Create Multiple"
            variant="secondary"
            size="md"
            leftIcon={<Ionicons name="copy-outline" size={15} color={colors.text} />}
            onPress={() => setBulkModalVisible(true)}
            style={{ flex: 1, borderRadius: 12, height: 44 }}
          />
        </View>

        {/* Compact 2-Row Summary Card */}
        <View style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Row 1 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>TOTAL</Text>
              <Text style={[styles.summaryNumber, { color: colors.text }]}>
                {summary.total_invites ?? 0}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>AWAITING</Text>
              <Text style={[styles.summaryNumber, { color: '#fbbf24' }]}>
                {summary.awaiting_activation ?? 0}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>ACTIVE</Text>
              <Text style={[styles.summaryNumber, { color: '#22c55e' }]}>
                {summary.active_teachers ?? 0}
              </Text>
            </View>
          </View>

          {/* Row Divider */}
          <View style={[styles.summaryHorizontalDivider, { backgroundColor: colors.border }]} />

          {/* Row 2 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>EXPIRED</Text>
              <Text style={[styles.summaryNumber, { color: colors.textSecondary }]}>
                {summary.expired ?? 0}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>REVOKED</Text>
              <Text style={[styles.summaryNumber, { color: '#ef4444' }]}>
                {summary.revoked ?? 0}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'transparent' }]} />
            <View style={styles.summaryItem} />
          </View>
        </View>

        {/* Search & Horizontal Filter Chips */}
        <View style={styles.filterSection}>
          <View style={[styles.searchBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
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

          {/* Filter Chips - Fully reachable horizontal scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipsContent}
          >
            {FILTER_TABS.map((f) => {
              const active = statusFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? '#FFFFFF' : colors.surfaceSubtle,
                      borderColor: active ? '#FFFFFF' : colors.border,
                    },
                  ]}
                  onPress={() => setStatusFilter(f.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      {
                        color: active ? '#000000' : colors.textSecondary,
                        fontWeight: active ? '700' : '500',
                      },
                    ]}
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
            <ActivityIndicator size="small" color={colors.primary} />
            <Caption color="muted" style={{ marginTop: 10 }}>
              Loading teacher invitations...
            </Caption>
          </View>
        ) : error ? (
          <Card variant="outlined" padding="lg" style={[styles.errorCard, { borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
            <Text weight="700" style={{ marginTop: 8, color: colors.text, fontSize: 15 }}>
              Couldn't load teacher management.
            </Text>
            <Button
              title="Retry"
              variant="outline"
              size="sm"
              onPress={() => loadInvites()}
              style={{ marginTop: 14, borderRadius: 10 }}
            />
          </Card>
        ) : invites.length === 0 ? (
          <Card variant="outlined" padding="lg" style={styles.emptyCard}>
            <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
            <Text weight="600" style={{ marginTop: 10, color: colors.text, fontSize: 14 }}>
              {searchQuery || statusFilter !== 'all' ? 'No matching invites' : 'No teacher invites yet.'}
            </Text>
            <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search query or filter.'
                : 'Create a temporary teacher login to get started.'}
            </Caption>
          </Card>
        ) : (
          <View style={styles.invitesList}>
            {invites.map((item) => {
              const tempUser = item.temporary_username || item.initial_username || item.username || '—';
              const isActive = item.status === 'active';
              const isExpired = item.status === 'expired';
              const isRevoked = item.status === 'revoked';
              const teacher = item.teacher;

              return (
                <View
                  key={item.id || tempUser}
                  style={[
                    styles.compactInviteCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  {/* Card Top Row: Prominent Temporary ID / Name + Status */}
                  <View style={styles.cardTopRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      {isActive && teacher?.name ? (
                        <>
                          <Text style={[styles.activeTeacherName, { color: colors.text }]}>
                            {teacher.name}
                          </Text>
                          {teacher.username && (
                            <Text style={styles.activeTeacherUsername}>
                              @{teacher.username}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Text style={[styles.cardTemporaryUsername, { color: colors.text }]}>
                          {tempUser}
                        </Text>
                      )}
                    </View>
                    {getStatusBadge(item.status)}
                  </View>

                  {/* Card Secondary Metadata */}
                  <View style={styles.cardMetaRow}>
                    {isActive ? (
                      teacher?.subjects && teacher.subjects.length > 0 ? (
                        <View style={styles.subjectsContainer}>
                          {teacher.subjects.slice(0, 3).map((s) => (
                            <View
                              key={s.id || s.code}
                              style={[styles.compactSubjectChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                            >
                              <Text style={[styles.compactSubjectText, { color: colors.textSecondary }]}>
                                {s.code}
                              </Text>
                            </View>
                          ))}
                          {teacher.subjects.length > 3 && (
                            <Text style={[styles.moreSubjectsLabel, { color: colors.textMuted }]}>
                              +{teacher.subjects.length - 3} more
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Text style={[styles.cardExpiryText, { color: colors.textMuted }]}>
                          Active Faculty
                        </Text>
                      )
                    ) : (
                      <Text style={[styles.cardExpiryText, { color: colors.textMuted }]}>
                        {isExpired
                          ? `Expired on ${item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}`
                          : `Expires ${item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '14 days'}`}
                      </Text>
                    )}
                  </View>

                  {/* Card Divider */}
                  <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

                  {/* State-Specific Actions Toolbar */}
                  <View style={styles.cardActionsRow}>
                    {isActive ? (
                      <TouchableOpacity
                        style={styles.cardLinkAction}
                        onPress={() => {
                          setSelectedInvite(item);
                          setDetailModalVisible(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.cardLinkActionText, { color: colors.primary }]}>
                          View Teacher →
                        </Text>
                      </TouchableOpacity>
                    ) : isExpired ? (
                      <View style={styles.dualActionsGroup}>
                        <TouchableOpacity
                          style={[styles.compactBtn, { borderColor: colors.border }]}
                          onPress={() => handleReissue(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="refresh-outline" size={13} color={colors.text} />
                          <Text style={[styles.compactBtnText, { color: colors.text }]}>Reissue</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.compactDangerBtn, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}
                          onPress={() => handleRevoke(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="close-circle-outline" size={13} color="#ef4444" />
                          <Text style={styles.compactDangerBtnText}>Revoke</Text>
                        </TouchableOpacity>
                      </View>
                    ) : isRevoked ? (
                      <Text style={[styles.cardExpiryText, { color: colors.textMuted }]}>Revoked</Text>
                    ) : (
                      <View style={styles.dualActionsGroup}>
                        <TouchableOpacity
                          style={[styles.compactBtn, { borderColor: colors.border }]}
                          onPress={() => handleRegeneratePassword(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="key-outline" size={13} color={colors.text} />
                          <Text style={[styles.compactBtnText, { color: colors.text }]}>Regenerate</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.compactDangerBtn, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}
                          onPress={() => handleRevoke(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="close-circle-outline" size={13} color="#ef4444" />
                          <Text style={styles.compactDangerBtnText}>Revoke</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
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
        animationType="fade"
        onRequestClose={() => {
          setCredentialsList([]);
          setCredentialsModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitleText, { color: colors.text }]}>
                  {credentialsTitle}
                </Text>
                <Text style={[styles.modalSubtitleText, { color: colors.textSecondary }]}>
                  Save these credentials now. The temporary password will not be shown again.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setCredentialsList([]);
                  setCredentialsModalVisible(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 320, marginVertical: 12 }}>
              {credentialsList.map((cred, idx) => {
                const uKey = `u-${cred.username}`;
                const pKey = `p-${cred.username}`;
                const bKey = `b-${cred.username}`;
                const password = cred.temporaryPassword || cred.temporary_password || '—';
                const rawExp = cred.expiresAt || cred.expires_at;
                const expires = rawExp ? new Date(rawExp).toLocaleDateString() : '14 days';

                return (
                  <View
                    key={cred.username + idx}
                    style={[styles.credBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                  >
                    <View style={styles.credRow}>
                      <Text style={styles.credLabel}>Username</Text>
                      <Text style={[styles.credValMonospace, { color: colors.text }]}>
                        {cred.username}
                      </Text>
                    </View>

                    <View style={[styles.credRow, { marginTop: 6 }]}>
                      <Text style={styles.credLabel}>Temporary Password</Text>
                      <Text style={[styles.credValMonospace, { color: '#60a5fa' }]}>
                        {password}
                      </Text>
                    </View>

                    <View style={[styles.credRow, { marginTop: 6 }]}>
                      <Text style={styles.credLabel}>Expires</Text>
                      <Text style={[styles.credValText, { color: colors.textSecondary }]}>
                        {expires}
                      </Text>
                    </View>

                    {/* Copy Buttons */}
                    <View style={styles.credCopyButtons}>
                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() => copyText(cred.username, uKey, 'Username copied!')}
                      >
                        <Ionicons name="copy-outline" size={12} color={colors.text} />
                        <Text style={[styles.copyChipText, { color: colors.text }]}>
                          {copiedKey === uKey ? 'Copied' : 'Copy Username'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() => copyText(password, pKey, 'Password copied!')}
                      >
                        <Ionicons name="key-outline" size={12} color={colors.text} />
                        <Text style={[styles.copyChipText, { color: colors.text }]}>
                          {copiedKey === pKey ? 'Copied' : 'Copy Password'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.copyChip, { borderColor: colors.border }]}
                        onPress={() => copyBothCredentials(cred.username, password)}
                      >
                        <Ionicons name="duplicate-outline" size={12} color={colors.text} />
                        <Text style={[styles.copyChipText, { color: colors.text }]}>
                          {copiedKey === bKey ? 'Copied' : 'Copy Both'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.warningTagContainer}>
              <Ionicons name="alert-circle-outline" size={15} color="#fbbf24" />
              <Text style={styles.warningTagText}>
                This password is shown only once. It cannot be retrieved again after closing.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {credentialsList.length > 1 && (
                <Button
                  title="Copy All"
                  variant="outline"
                  size="md"
                  onPress={copyAllCredentials}
                  leftIcon={<Ionicons name="duplicate-outline" size={14} color={colors.text} />}
                  style={{ flex: 1, borderRadius: 12 }}
                />
              )}
              <Button
                title="I've Saved the Credentials"
                variant="primary"
                size="md"
                onPress={() => {
                  setCredentialsList([]);
                  setCredentialsModalVisible(false);
                }}
                style={{ flex: 1, borderRadius: 12 }}
                textStyle={{ fontWeight: '700' }}
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
              <Text style={[styles.modalTitleText, { color: colors.text }]}>Create Multiple Logins</Text>
              <TouchableOpacity onPress={() => setBulkModalVisible(false)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSubtitleText, { color: colors.textSecondary, marginTop: 6 }]}>
              Generate a batch of temporary teacher access credentials (quantity 1 to 50).
            </Text>

            <View style={{ marginVertical: 16 }}>
              <Text style={styles.credLabel}>QUANTITY (1 - 50)</Text>
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

            <Caption color="muted" style={{ marginBottom: 14 }}>
              Each login will be assigned an incremental identifier (e.g. teacher001) and a temporary password valid for 14 days.
            </Caption>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="Cancel"
                variant="outline"
                size="md"
                onPress={() => setBulkModalVisible(false)}
                style={{ flex: 1, borderRadius: 12 }}
              />
              <Button
                title="Generate Batch"
                variant="primary"
                size="md"
                loading={isCreatingBulk}
                onPress={handleCreateBulk}
                style={{ flex: 1, borderRadius: 12 }}
                textStyle={{ fontWeight: '700' }}
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
        animationType="fade"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitleText, { color: colors.text }]}>Faculty Details</Text>
                <Caption color="muted">{selectedInvite?.temporary_username || selectedInvite?.initial_username}</Caption>
              </View>
              <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedInvite?.teacher ? (
              <View style={{ marginVertical: 14, gap: 10 }}>
                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>FULL NAME</Text>
                  <Text style={[styles.detailValueText, { color: colors.text }]}>
                    {selectedInvite.teacher.name || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>PERMANENT USERNAME</Text>
                  <Text style={[styles.detailValueText, { color: colors.text }]}>
                    @{selectedInvite.teacher.username || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>ROLE</Text>
                  <Text style={[styles.detailValueText, { color: colors.text }]}>Teacher</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>EMAIL</Text>
                  <Text style={[styles.detailValueText, { color: colors.text }]}>
                    {selectedInvite.teacher.email || '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>DESIGNATION</Text>
                  <Text style={[styles.detailValueText, { color: colors.text }]}>
                    {selectedInvite.teacher.designation || 'Lecturer'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>SUBJECTS TAUGHT</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {selectedInvite.teacher.subjects && selectedInvite.teacher.subjects.length > 0 ? (
                      selectedInvite.teacher.subjects.map((sub) => (
                        <View
                          key={sub.id || sub.code}
                          style={[
                            styles.compactSubjectChip,
                            { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[styles.compactSubjectText, { color: colors.text }]}>
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
              <Caption color="muted" style={{ marginVertical: 16 }}>
                No active faculty profile linked to this invite.
              </Caption>
            )}

            <Button
              title="Close"
              variant="outline"
              size="md"
              onPress={() => setDetailModalVisible(false)}
              style={{ borderRadius: 12, marginTop: 4 }}
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
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  compactBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.28)',
    marginBottom: 14,
  },
  compactBannerTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#fbbf24',
  },
  compactBannerSubtext: {
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 16,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  summaryBox: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 0.5,
  },
  summaryNumber: {
    fontSize: 19,
    fontWeight: '800',
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
  },
  summaryHorizontalDivider: {
    height: 1,
    marginVertical: 8,
  },
  filterSection: {
    marginBottom: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    paddingVertical: 0,
  },
  filterChipsContent: {
    flexDirection: 'row',
    paddingRight: 16,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
  },
  centerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorCard: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  invitesList: {
    gap: 10,
  },
  compactInviteCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTemporaryUsername: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: -0.2,
  },
  activeTeacherName: {
    fontSize: 15,
    fontWeight: '700',
  },
  activeTeacherUsername: {
    fontSize: 12,
    color: '#888888',
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  cardMetaRow: {
    marginTop: 6,
  },
  cardExpiryText: {
    fontSize: 12.5,
  },
  subjectsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  compactSubjectChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  compactSubjectText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  moreSubjectsLabel: {
    fontSize: 11,
    marginLeft: 2,
  },
  cardDivider: {
    height: 1,
    marginVertical: 10,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dualActionsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  compactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  compactBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  compactDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  compactDangerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  cardLinkAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  cardLinkActionText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modalTitleText: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalSubtitleText: {
    fontSize: 12.5,
    marginTop: 3,
    lineHeight: 16,
  },
  credBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  credRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  credLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  credValMonospace: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  credValText: {
    fontSize: 12,
  },
  credCopyButtons: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  copyChipText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  warningTagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    gap: 6,
    marginTop: 2,
  },
  warningTagText: {
    fontSize: 11.5,
    color: '#fbbf24',
    flex: 1,
    lineHeight: 15,
  },
  countInput: {
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: 'center',
    marginTop: 6,
  },
  detailRow: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 6,
  },
  detailValueText: {
    fontSize: 13.5,
    fontWeight: '600',
    marginTop: 2,
  },
});
