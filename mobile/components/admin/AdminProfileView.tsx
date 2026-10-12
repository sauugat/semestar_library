import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { AdminAuditModal } from './AdminAuditModal';
import { AdminCohortsModal } from './AdminCohortsModal';

export function AdminProfileView() {
  const { colors, radii, spacing } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();

  const [auditModalVisible, setAuditModalVisible] = useState(false);
  const [cohortsModalVisible, setCohortsModalVisible] = useState(false);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of the administrator console?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void logout();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Heading level={2}>Admin Profile</Heading>
        <Badge label="Root Authority" variant="neutral" size="sm" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
          <Avatar name={user?.name || 'Administrator'} size="lg" />
          <Heading level={3} style={{ marginTop: 12 }}>{user?.name || 'Administrator'}</Heading>
          <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
            {user?.username ? `@${user.username}` : user?.studentId || 'Admin Account'}
          </Caption>
          <View style={{ marginTop: 8 }}>
            <Badge label="System Administrator" variant="neutral" size="sm" />
          </View>
        </View>

        {/* Account Details */}
        <Heading level={4} style={{ marginTop: 20, marginBottom: 10 }}>Account Credentials</Heading>
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
          <View style={styles.infoRow}>
            <Caption style={{ color: colors.textSecondary }}>Administrator ID</Caption>
            <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>{user?.studentId || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Caption style={{ color: colors.textSecondary }}>Official Email</Caption>
            <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>{user?.email || 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Caption style={{ color: colors.textSecondary }}>Department</Caption>
            <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>{user?.department || 'BIT Administration'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Caption style={{ color: colors.textSecondary }}>Security Status</Caption>
            <Text style={{ color: colors.text, fontWeight: '600', marginTop: 2 }}>Privileged Root Access</Text>
          </View>
        </View>

        {/* Management Shortcuts */}
        <Heading level={4} style={{ marginTop: 24, marginBottom: 10 }}>Administrative Navigation</Heading>

        <TouchableOpacity
          onPress={() => router.push('/admin/teachers')}
          style={[styles.navItem, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
        >
          <View style={styles.navItemLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="people-outline" size={18} color={colors.text} />
            </View>
            <View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Teacher Management</Text>
              <Caption style={{ color: colors.textSecondary }}>Faculty assignments & invitations</Caption>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setCohortsModalVisible(true)}
          style={[styles.navItem, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
        >
          <View style={styles.navItemLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="git-network-outline" size={18} color={colors.text} />
            </View>
            <View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cohort Management</Text>
              <Caption style={{ color: colors.textSecondary }}>Permanent cohort memberships</Caption>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setAuditModalVisible(true)}
          style={[styles.navItem, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
        >
          <View style={styles.navItemLeft}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="time-outline" size={18} color={colors.text} />
            </View>
            <View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Activity History</Text>
              <Caption style={{ color: colors.textSecondary }}>Audit trail of administrative mutations</Caption>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Logout */}
        <View style={{ marginTop: 32 }}>
          <Button
            title="Sign Out"
            variant="outline"
            onPress={handleLogout}
            style={{ borderColor: colors.border }}
          />
        </View>
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
  profileCard: {
    alignItems: 'center',
    padding: 20,
    borderWidth: 1,
  },
  infoCard: {
    padding: 16,
    borderWidth: 1,
  },
  infoRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  navItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
