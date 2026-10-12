import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';

export function UnrecognizedRoleView() {
  const { colors, spacing, radii } = useTheme();
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.text} />
        </View>

        <Heading level={2} style={styles.title}>
          Access Restricted
        </Heading>

        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Your account role ({user?.role ? `"${user.role}"` : 'Unassigned'}) is not recognized by the mobile navigation system.
          Access to student library materials, teacher tools, and administrative consoles is strictly partitioned.
        </Text>

        <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}>
          <Caption style={{ color: colors.textSecondary }}>Account ID</Caption>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{user?.studentId || 'N/A'}</Text>
        </View>

        <Button
          title="Sign Out"
          variant="outline"
          onPress={() => void logout()}
          style={styles.button}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  infoBox: {
    width: '100%',
    padding: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  button: {
    width: '100%',
  },
});
