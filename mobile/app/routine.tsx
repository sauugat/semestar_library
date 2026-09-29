import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function RoutineScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();

  const upcomingFeatures = [
    {
      icon: 'time-outline' as const,
      title: 'Daily Class Schedules',
      desc: 'Period timings, subject codes, and designated lecture halls updated for each semester.',
    },
    {
      icon: 'calendar-outline' as const,
      title: 'Exam Timetables',
      desc: 'Mid-term and final board examination routines with AD/BS date conversion.',
    },
    {
      icon: 'notifications-outline' as const,
      title: 'Schedule Alerts',
      desc: 'Instant notifications when classes are rescheduled or routine changes occur.',
    },
    {
      icon: 'person-outline' as const,
      title: 'Teacher & Lab Information',
      desc: 'Assigned instructors and computer lab allocations for practical sessions.',
    },
  ];

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { padding: spacing.md, backgroundColor: colors.background },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Header */}
      <View style={{ marginBottom: spacing.lg }}>
        <Heading style={{ fontSize: 24 }}>Academic Routine</Heading>
        <Caption color="muted">Class Timetables & Examination Schedule</Caption>
      </View>

      {/* Main Hero Card with Coming Soon Badge */}
      <Card
        variant="elevated"
        padding="lg"
        style={[styles.heroCard, { borderColor: colors.border }]}
      >
        <View style={styles.badgeContainer}>
          <View
            style={[
              styles.comingSoonBadge,
              { backgroundColor: colors.primaryLight, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="sparkles" size={13} color={colors.primary} style={{ marginRight: 5 }} />
            <Text variant="xs" weight="800" style={{ color: colors.primary, letterSpacing: 0.8 }}>
              COMING SOON
            </Text>
          </View>
        </View>

        {/* Central Icon Illustration */}
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="calendar" size={42} color={colors.primary} />
        </View>

        <Heading style={styles.heroTitle}>Routine Module in Progress</Heading>

        <Text variant="sm" color="secondary" style={styles.heroDesc}>
          The official routine and timetable system for Gandaki University is currently under development. Once published by university administration and department coordinators, your live daily lectures and exam schedules will appear here automatically.
        </Text>

        <View
          style={[
            styles.divider,
            { backgroundColor: colors.border },
          ]}
        />

        {/* Sneak Peek Features List */}
        <Subheading style={{ fontSize: 15, marginBottom: spacing.md, textAlign: 'left', width: '100%' }}>
          What's Coming
        </Subheading>

        <View style={{ width: '100%', gap: 12 }}>
          {upcomingFeatures.map((item, idx) => (
            <View key={idx} style={styles.featureRow}>
              <View
                style={[
                  styles.featureIconBox,
                  { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Ionicons name={item.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="sm" weight="700">
                  {item.title}
                </Text>
                <Caption color="muted" style={{ marginTop: 2 }}>
                  {item.desc}
                </Caption>
              </View>
            </View>
          ))}
        </View>
      </Card>

      {/* Return to Feed Action Button */}
      <View style={{ marginTop: spacing.lg, marginBottom: spacing.xl }}>
        <Button
          title="Back to Campus Feed"
          variant="outline"
          size="md"
          onPress={() => router.back()}
          leftIcon={<Ionicons name="arrow-back" size={18} color={colors.text} />}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  badgeContainer: {
    marginBottom: 20,
  },
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 10,
  },
  heroDesc: {
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 14,
    maxWidth: '94%',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
    marginVertical: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  featureIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
