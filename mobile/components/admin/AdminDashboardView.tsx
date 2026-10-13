import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { useAdminMode } from '@/context/AdminModeContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/services/api';
import { AdminAuditModal } from './AdminAuditModal';
import { AdminCohortsModal } from './AdminCohortsModal';

export function AdminDashboardView() {
  const { colors, radii, spacing } = useTheme();
  const { user } = useAuth();
  const { setAdminMode } = useAdminMode();
  const router = useRouter();

  const [auditModalVisible, setAuditModalVisible] = useState(false);
  const [cohortsModalVisible, setCohortsModalVisible] = useState(false);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/overview');
      if (!res.ok) {
        if (res.status === 404) {
          return { unavailable: true, message: 'Admin overview API is not available on this server.' };
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  const counts = data?.counts || {};
  const isUnavailable = Boolean(data?.unavailable);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Brand Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Heading level={2} style={styles.brandTitle}>
            Admin Console
          </Heading>
          <Caption style={{ color: colors.textSecondary }}>Semester Library Management System</Caption>
        </View>
        <TouchableOpacity
          onPress={() => void setAdminMode('normal')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: radii.full,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
          accessibilityLabel="Switch to Normal Mode"
          testID="dashboard-switch-to-normal-btn"
        >
          <Ionicons name="eye-outline" size={13} color={colors.text} style={{ marginRight: 4 }} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text }}>Normal View</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 110 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.text} />
        }
      >
        {isUnavailable && (
          <View style={[styles.banner, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
              {data?.message || 'Administrative API endpoints are not available on this server environment.'}
            </Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Loading platform statistics...</Text>
          </View>
        ) : isError ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.textSecondary} style={{ marginBottom: 8 }} />
            <Heading level={4} style={{ color: colors.text }}>Unable to load statistics</Heading>
            <Caption style={{ color: colors.textSecondary, marginTop: 4 }}>
              {(error as any)?.message || 'Network or authorization error'}
            </Caption>
            <TouchableOpacity onPress={() => void refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
              <Caption style={{ color: colors.text }}>Retry</Caption>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Quick Actions / Shortcuts */}
            <Heading level={4} style={[styles.sectionHeading, { color: colors.text }]}>
              Quick Management
            </Heading>
            <View style={styles.shortcutsRow}>
              <TouchableOpacity
                onPress={() => router.push('/admin/teachers')}
                style={[styles.shortcutCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
              >
                <View style={[styles.shortcutIconWrap, { backgroundColor: colors.surfaceRaised }]}>
                  <Ionicons name="people-outline" size={20} color={colors.text} />
                </View>
                <Text style={[styles.shortcutTitle, { color: colors.text }]}>Teacher Management</Text>
                <Caption style={{ color: colors.textSecondary }}>Assignments & Faculty</Caption>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setCohortsModalVisible(true)}
                style={[styles.shortcutCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
              >
                <View style={[styles.shortcutIconWrap, { backgroundColor: colors.surfaceRaised }]}>
                  <Ionicons name="git-network-outline" size={20} color={colors.text} />
                </View>
                <Text style={[styles.shortcutTitle, { color: colors.text }]}>Cohort Overview</Text>
                <Caption style={{ color: colors.textSecondary }}>Permanent Slots</Caption>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setAuditModalVisible(true)}
              style={[styles.auditShortcut, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.shortcutIconWrap, { backgroundColor: colors.surfaceRaised, marginRight: 12 }]}>
                  <Ionicons name="time-outline" size={20} color={colors.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.shortcutTitle, { color: colors.text }]}>Administrative Activity Log</Text>
                  <Caption style={{ color: colors.textSecondary }}>Durable audit records of admin actions</Caption>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Platform Metrics Grid */}
            <Heading level={4} style={[styles.sectionHeading, { color: colors.text, marginTop: 24 }]}>
              Platform Statistics
            </Heading>

            <View style={styles.grid}>
              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Total Students</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.students ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Enrolled BIT learners</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Total Teachers</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.teachers ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Department faculty</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Class Representatives</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.crs ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Elected student CRs</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Community Posts</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.posts ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Student & staff feed</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Academic Materials</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.materials ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Study notes & files</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Assignments</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.assignments ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Coursework & labs</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Active Cohorts</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.activeCohorts ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Permanent batches</Caption>
              </View>

              <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
                <Caption style={{ color: colors.textSecondary }}>Pending Invitations</Caption>
                <Text style={[styles.statValue, { color: colors.text }]}>{counts.pendingTeacherInvites ?? 0}</Text>
                <Caption style={{ color: colors.textTertiary, marginTop: 2 }}>Teacher onboarding</Caption>
              </View>
            </View>

            {/* Signed-in identity summary */}
            <View style={[styles.adminIdentityCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
              <View style={styles.identityRow}>
                <View style={[styles.avatarCircle, { backgroundColor: colors.surfaceRaised }]}>
                  <Ionicons name="shield-checkmark" size={20} color={colors.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.adminName, { color: colors.text }]}>{user?.name || 'Administrator'}</Text>
                  <Caption style={{ color: colors.textSecondary }}>{user?.email || user?.studentId || 'Admin Account'}</Caption>
                </View>
                <Badge label="System Admin" variant="neutral" size="sm" />
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Modals */}
      <AdminAuditModal visible={auditModalVisible} onClose={() => setAuditModalVisible(false)} />
      <AdminCohortsModal visible={cohortsModalVisible} onClose={() => setCohortsModalVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  brandTitle: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  scrollContent: {
    padding: 16,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 16,
  },
  centerContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: 20,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  shortcutsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  shortcutCard: {
    flex: 1,
    padding: 14,
    borderWidth: 1,
  },
  shortcutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  shortcutTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  auditShortcut: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    width: '48.5%',
    padding: 14,
    borderWidth: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  adminIdentityCard: {
    marginTop: 20,
    padding: 14,
    borderWidth: 1,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  adminName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
});
