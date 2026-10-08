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
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
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
  const { colors, spacing } = useTheme();
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

  // Status configuration helper
  const getStatusConfig = (status: TeacherInviteItem['status']) => {
    switch (status) {
      case 'active':
        return { label: 'Active', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.28)' };
      case 'provisioned':
        return { label: 'Awaiting Setup', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.28)' };
      case 'onboarding':
      case 'awaiting_email_verification':
        return { label: 'Setup Started', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.28)' };
      case 'expired':
        return { label: 'Expired', color: '#a3a3a3', bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)' };
      case 'revoked':
        return { label: 'Revoked', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.28)' };
      default:
        return { label: status, color: '#a3a3a3', bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)' };
    }
  };

  // Non-admin Access Denied View
  if (!isAdmin) {
    return (
      <View style={[styles.deniedContainer, { paddingTop: insets.top + 40 }]}>
        <Stack.Screen
          options={{
            title: 'Teacher Management',
            headerTitle: 'Teacher Management',
            headerBackTitle: '',
            headerRight: () => null,
          }}
        />
        <Ionicons name="shield-outline" size={52} color="#ef4444" />
        <Heading style={{ marginTop: 16, color: '#f5f5f5' }}>Access Denied</Heading>
        <Text color="secondary" style={{ textAlign: 'center', marginTop: 8, paddingHorizontal: 32 }}>
          Administrator privileges are required to manage teacher invitations and faculty accounts.
        </Text>
        <Button
          title="Go Back"
          variant="outline"
          size="md"
          onPress={() => router.back()}
          style={{ marginTop: 24, borderRadius: 12 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Teacher Management',
          headerTitle: 'Teacher Management',
          headerBackTitle: '',
          headerRight: () => null,
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 14,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadInvites(true)}
            tintColor="#f5f5f5"
            colors={['#f5f5f5']}
          />
        }
      >
        {/* 2. Screen Intro Description (No duplicate title) */}
        <View style={styles.screenIntro}>
          <Text style={styles.screenIntroText}>
            Manage teacher access and faculty accounts.
          </Text>
        </View>

        {/* 3. Onboarding Disabled Inline Banner - Compact */}
        {!onboardingEnabled && (
          <View style={styles.bannerNotice}>
            <Ionicons name="warning-outline" size={15} color="#f59e0b" style={{ marginRight: 8, marginTop: 1.5 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Teacher onboarding is disabled</Text>
              <Text style={styles.bannerSubtitle}>Teachers cannot activate credentials yet.</Text>
            </View>
          </View>
        )}

        {/* 4. Create Actions - Compact, No clipping */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleCreateSingle}
            disabled={isCreatingSingle}
            activeOpacity={0.8}
          >
            {isCreatingSingle ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <>
                <Ionicons name="add" size={16} color="#000000" style={{ marginRight: 4 }} />
                <Text style={styles.primaryBtnText} numberOfLines={1} ellipsizeMode="tail">
                  Create Login
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setBulkModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="copy-outline" size={14} color="#f5f5f5" style={{ marginRight: 5 }} />
            <Text style={styles.secondaryBtnText} numberOfLines={1} ellipsizeMode="tail">
              Create Multiple
            </Text>
          </TouchableOpacity>
        </View>

        {/* 5. Compact 1-Row Stats Strip (Under 70px) */}
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{summary.total_invites ?? 0}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: '#fbbf24' }]}>{summary.awaiting_activation ?? 0}</Text>
            <Text style={styles.statLabel}>Awaiting</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: '#22c55e' }]}>{summary.active_teachers ?? 0}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: '#737373' }]}>{summary.expired ?? 0}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: '#ef4444' }]}>{summary.revoked ?? 0}</Text>
            <Text style={styles.statLabel}>Revoked</Text>
          </View>
        </View>

        {/* 6. Search & Compact Filter Chips */}
        <View style={styles.filterSection}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={15} color="#737373" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search teachers..."
              placeholderTextColor="#737373"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              onSubmitEditing={() => loadInvites()}
            />
            {Boolean(searchQuery) && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={15} color="#737373" />
              </TouchableOpacity>
            )}
          </View>

          {/* Horizontally scrollable chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipsScroll}
          >
            {FILTER_TABS.map((f) => {
              const active = statusFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.filterChip,
                    active ? styles.filterChipActive : styles.filterChipInactive,
                  ]}
                  onPress={() => setStatusFilter(f.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active ? styles.filterChipTextActive : styles.filterChipTextInactive,
                    ]}
                    numberOfLines={1}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* 7. List Content / Loading / Empty State */}
        {loading && !refreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="small" color="#f5f5f5" />
            <Caption color="muted" style={{ marginTop: 10 }}>
              Loading teacher invitations...
            </Caption>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={26} color="#ef4444" />
            <Text style={styles.errorText}>
              Couldn't load teacher management.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => loadInvites()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : invites.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="folder-open-outline" size={30} color="#737373" />
            <Text style={styles.emptyTitle}>
              {searchQuery || statusFilter !== 'all' ? 'No matching invites' : 'No teacher invites yet.'}
            </Text>
            <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search query or filter.'
                : 'Create a temporary teacher login to get started.'}
            </Caption>
          </View>
        ) : (
          <View style={styles.invitesList}>
            {invites.map((item) => {
              const tempUser = item.temporary_username || item.initial_username || item.username || '—';
              const isActive = item.status === 'active';
              const isExpired = item.status === 'expired';
              const isRevoked = item.status === 'revoked';
              const teacher = item.teacher;
              const statusCfg = getStatusConfig(item.status);

              return (
                <View key={item.id || tempUser} style={styles.card}>
                  {/* Card Header Row: Username/Name + Status Pill */}
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      {isActive && teacher?.name ? (
                        <>
                          <Text style={styles.teacherNameText} numberOfLines={1}>
                            {teacher.name}
                          </Text>
                          {teacher.username && (
                            <Text style={styles.teacherHandleText} numberOfLines={1}>
                              @{teacher.username}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Text style={styles.teacherIdText} numberOfLines={1}>
                          {tempUser}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.statusChip, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
                      <Text style={[styles.statusChipText, { color: statusCfg.color }]} numberOfLines={1}>
                        {statusCfg.label}
                      </Text>
                    </View>
                  </View>

                  {/* Card Sub-metadata */}
                  <View style={styles.cardMetaBlock}>
                    {isActive ? (
                      teacher?.subjects && teacher.subjects.length > 0 ? (
                        <View style={styles.subjectsRow}>
                          {teacher.subjects.slice(0, 3).map((s) => (
                            <View key={s.id || s.code} style={styles.subjectChip}>
                              <Text style={styles.subjectChipText}>{s.code}</Text>
                            </View>
                          ))}
                          {teacher.subjects.length > 3 && (
                            <Text style={styles.moreSubjectsText}>
                              +{teacher.subjects.length - 3} more
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Text style={styles.cardExpiryText}>Active Faculty</Text>
                      )
                    ) : (
                      <Text style={styles.cardExpiryText} numberOfLines={1}>
                        {isExpired
                          ? `Expired on ${item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}`
                          : `Expires ${item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '14 days'}`}
                      </Text>
                    )}
                  </View>

                  {/* Subtle 1px Divider */}
                  <View style={styles.cardDivider} />

                  {/* Card Actions Row (Compact) */}
                  <View style={styles.cardActionsRow}>
                    {isActive ? (
                      <TouchableOpacity
                        style={styles.viewTeacherBtn}
                        onPress={() => {
                          setSelectedInvite(item);
                          setDetailModalVisible(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.viewTeacherText}>View Teacher</Text>
                        <Ionicons name="arrow-forward" size={13} color="#ffffff" style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ) : isExpired ? (
                      <View style={styles.dualActionsGroup}>
                        <TouchableOpacity
                          style={styles.cardActionBtn}
                          onPress={() => handleReissue(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="refresh-outline" size={13} color="#f5f5f5" />
                          <Text style={styles.cardActionText} numberOfLines={1}>Reissue</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.cardActionDangerBtn}
                          onPress={() => handleRevoke(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="close-circle-outline" size={13} color="#ef4444" />
                          <Text style={styles.cardActionDangerText} numberOfLines={1}>Revoke</Text>
                        </TouchableOpacity>
                      </View>
                    ) : isRevoked ? (
                      <Text style={styles.cardRevokedText}>Revoked</Text>
                    ) : (
                      <View style={styles.dualActionsGroup}>
                        <TouchableOpacity
                          style={styles.cardActionBtn}
                          onPress={() => handleRegeneratePassword(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="key-outline" size={13} color="#f5f5f5" />
                          <Text style={styles.cardActionText} numberOfLines={1}>Regenerate</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.cardActionDangerBtn}
                          onPress={() => handleRevoke(tempUser)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="close-circle-outline" size={13} color="#ef4444" />
                          <Text style={styles.cardActionDangerText} numberOfLines={1}>Revoke</Text>
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitleText}>{credentialsTitle}</Text>
                <Text style={styles.modalSubtitleText}>
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
                <Ionicons name="close" size={20} color="#f5f5f5" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 300, marginVertical: 12 }}>
              {credentialsList.map((cred, idx) => {
                const uKey = `u-${cred.username}`;
                const pKey = `p-${cred.username}`;
                const bKey = `b-${cred.username}`;
                const password = cred.temporaryPassword || cred.temporary_password || '—';
                const rawExp = cred.expiresAt || cred.expires_at;
                const expires = rawExp ? new Date(rawExp).toLocaleDateString() : '14 days';

                return (
                  <View key={cred.username + idx} style={styles.credBox}>
                    <View style={styles.credRow}>
                      <Text style={styles.credLabel}>Username</Text>
                      <Text style={styles.credValMonospace}>{cred.username}</Text>
                    </View>

                    <View style={[styles.credRow, { marginTop: 6 }]}>
                      <Text style={styles.credLabel}>Temporary Password</Text>
                      <Text style={[styles.credValMonospace, { color: '#60a5fa' }]}>{password}</Text>
                    </View>

                    <View style={[styles.credRow, { marginTop: 6 }]}>
                      <Text style={styles.credLabel}>Expires</Text>
                      <Text style={styles.credValText}>{expires}</Text>
                    </View>

                    {/* Copy Buttons */}
                    <View style={styles.credCopyButtons}>
                      <TouchableOpacity
                        style={styles.copyChip}
                        onPress={() => copyText(cred.username, uKey, 'Username copied!')}
                      >
                        <Ionicons name="copy-outline" size={12} color="#f5f5f5" />
                        <Text style={styles.copyChipText}>
                          {copiedKey === uKey ? 'Copied' : 'Copy Username'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.copyChip}
                        onPress={() => copyText(password, pKey, 'Password copied!')}
                      >
                        <Ionicons name="key-outline" size={12} color="#f5f5f5" />
                        <Text style={styles.copyChipText}>
                          {copiedKey === pKey ? 'Copied' : 'Copy Password'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.copyChip}
                        onPress={() => copyBothCredentials(cred.username, password)}
                      >
                        <Ionicons name="duplicate-outline" size={12} color="#f5f5f5" />
                        <Text style={styles.copyChipText}>
                          {copiedKey === bKey ? 'Copied' : 'Copy Both'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.warningTagContainer}>
              <Ionicons name="alert-circle-outline" size={14} color="#fbbf24" />
              <Text style={styles.warningTagText}>
                This password is shown only once. It cannot be retrieved again after closing.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {credentialsList.length > 1 && (
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={copyAllCredentials}
                  activeOpacity={0.8}
                >
                  <Ionicons name="duplicate-outline" size={14} color="#f5f5f5" style={{ marginRight: 4 }} />
                  <Text style={styles.modalSecondaryBtnText}>Copy All</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  setCredentialsList([]);
                  setCredentialsModalVisible(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.modalPrimaryBtnText}>I've Saved the Credentials</Text>
              </TouchableOpacity>
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitleText}>Create Multiple Logins</Text>
              <TouchableOpacity onPress={() => setBulkModalVisible(false)}>
                <Ionicons name="close" size={20} color="#f5f5f5" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSubtitleText, { marginTop: 6 }]}>
              Generate a batch of temporary teacher access credentials (quantity 1 to 50).
            </Text>

            <View style={{ marginVertical: 14 }}>
              <Text style={styles.credLabel}>QUANTITY (1 - 50)</Text>
              <TextInput
                style={styles.countInput}
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
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setBulkModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleCreateBulk}
                disabled={isCreatingBulk}
                activeOpacity={0.8}
              >
                {isCreatingBulk ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.modalPrimaryBtnText}>Generate Batch</Text>
                )}
              </TouchableOpacity>
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitleText}>Faculty Details</Text>
                <Caption color="muted">{selectedInvite?.temporary_username || selectedInvite?.initial_username}</Caption>
              </View>
              <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                <Ionicons name="close" size={20} color="#f5f5f5" />
              </TouchableOpacity>
            </View>

            {selectedInvite?.teacher ? (
              <View style={{ marginVertical: 12, gap: 10 }}>
                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>FULL NAME</Text>
                  <Text style={styles.detailValueText}>{selectedInvite.teacher.name || '—'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>PERMANENT USERNAME</Text>
                  <Text style={styles.detailValueText}>@{selectedInvite.teacher.username || '—'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>ROLE</Text>
                  <Text style={styles.detailValueText}>Teacher</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>EMAIL</Text>
                  <Text style={styles.detailValueText}>{selectedInvite.teacher.email || '—'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>DESIGNATION</Text>
                  <Text style={styles.detailValueText}>{selectedInvite.teacher.designation || 'Lecturer'}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.credLabel}>SUBJECTS TAUGHT</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {selectedInvite.teacher.subjects && selectedInvite.teacher.subjects.length > 0 ? (
                      selectedInvite.teacher.subjects.map((sub) => (
                        <View key={sub.id || sub.code} style={styles.subjectChip}>
                          <Text style={styles.subjectChipText}>
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
              <Caption color="muted" style={{ marginVertical: 14 }}>
                No active faculty profile linked to this invite.
              </Caption>
            )}

            <TouchableOpacity
              style={[styles.modalSecondaryBtn, { marginTop: 8 }]}
              onPress={() => setDetailModalVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalSecondaryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  deniedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0a0a0a',
  },
  screenIntro: {
    marginBottom: 14,
  },
  screenIntroText: {
    fontSize: 13.5,
    color: '#a3a3a3',
    lineHeight: 18,
  },
  bannerNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
    marginBottom: 14,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fbbf24',
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#a3a3a3',
    marginTop: 2,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#000000',
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#181818',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryBtnText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#f5f5f5',
  },
  statLabel: {
    fontSize: 10.5,
    color: '#737373',
    marginTop: 2,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterSection: {
    marginBottom: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#141414',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    height: 38,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#f5f5f5',
    paddingVertical: 0,
  },
  filterChipsScroll: {
    flexDirection: 'row',
    paddingRight: 16,
    gap: 6,
  },
  filterChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#ffffff',
  },
  filterChipInactive: {
    backgroundColor: '#181818',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
  },
  filterChipTextActive: {
    color: '#000000',
    fontWeight: '700',
  },
  filterChipTextInactive: {
    color: '#a3a3a3',
    fontWeight: '500',
  },
  centerLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  errorBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  errorText: {
    marginTop: 8,
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '600',
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  retryBtnText: {
    color: '#f5f5f5',
    fontSize: 12.5,
    fontWeight: '600',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptyTitle: {
    marginTop: 10,
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '600',
  },
  invitesList: {
    gap: 10,
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  teacherIdText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#f5f5f5',
    letterSpacing: -0.2,
  },
  teacherNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f5f5f5',
  },
  teacherHandleText: {
    fontSize: 12,
    color: '#737373',
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardMetaBlock: {
    marginTop: 5,
  },
  cardExpiryText: {
    fontSize: 12.5,
    color: '#737373',
  },
  cardRevokedText: {
    fontSize: 12,
    color: '#737373',
  },
  subjectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  subjectChip: {
    backgroundColor: '#1c1c1c',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  subjectChipText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#a3a3a3',
  },
  moreSubjectsText: {
    fontSize: 11,
    color: '#737373',
    marginLeft: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 9,
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
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#181818',
    gap: 4,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  cardActionDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    gap: 4,
  },
  cardActionDangerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  viewTeacherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  viewTeacherText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#161616',
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modalTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f5f5f5',
  },
  modalSubtitleText: {
    fontSize: 12,
    color: '#a3a3a3',
    marginTop: 3,
    lineHeight: 16,
  },
  credBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#1c1c1c',
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
    color: '#737373',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  credValMonospace: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#f5f5f5',
  },
  credValText: {
    fontSize: 12,
    color: '#a3a3a3',
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
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 4,
  },
  copyChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  warningTagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    gap: 6,
    marginTop: 2,
  },
  warningTagText: {
    fontSize: 11,
    color: '#fbbf24',
    flex: 1,
    lineHeight: 15,
  },
  countInput: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#1c1c1c',
    color: '#f5f5f5',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: 'center',
    marginTop: 6,
  },
  modalPrimaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
  modalSecondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1c1c1c',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  detailRow: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 6,
  },
  detailValueText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f5f5f5',
    marginTop: 2,
  },
});
