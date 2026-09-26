import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';

const MOCK_NOTICES = [
  {
    id: 1,
    title: 'Mid-Term Examination Schedule Announced',
    date: 'Sep 25, 2026',
    tag: 'Exam Section',
    desc: 'The BCA 2nd Semester mid-term examinations will commence from Ashwin 15. Please check the routine.',
  },
  {
    id: 2,
    title: 'C Programming Lab Report Submission Deadline',
    date: 'Sep 22, 2026',
    tag: 'Department',
    desc: 'All students must submit their complete lab report by Friday. No late submissions accepted.',
  },
  {
    id: 3,
    title: 'Holiday Notice: Dashain Vacation',
    date: 'Sep 20, 2026',
    tag: 'Administration',
    desc: 'University administration and classes will remain closed during the Dashain festival.',
  },
];

export default function NoticesScreen() {
  const { colors, spacing, radii } = useTheme();

  return (
    <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}>
      <Subheading style={{ marginBottom: spacing.md }}>Campus Notices & Announcements</Subheading>

      {MOCK_NOTICES.map((notice) => (
        <Card key={notice.id} variant="elevated" padding="md" style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.primaryLight, borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 2 },
              ]}
            >
              <Text variant="xs" color="accent" weight="700">
                {notice.tag}
              </Text>
            </View>
            <Caption color="muted">{notice.date}</Caption>
          </View>
          <Text variant="md" weight="700" style={{ marginBottom: spacing.xs }}>
            {notice.title}
          </Text>
          <Text variant="sm" color="secondary">
            {notice.desc}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  badge: {
    alignSelf: 'flex-start',
  },
});
