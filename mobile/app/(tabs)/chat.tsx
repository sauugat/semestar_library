import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function ChatScreen() {
  const { colors, spacing, radii } = useTheme();

  return (
    <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}>
      {/* AI Assistant Banner */}
      <Card
        variant="elevated"
        padding="lg"
        style={{
          backgroundColor: colors.primary,
          marginBottom: spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <Ionicons name="sparkles" size={20} color="#FDE047" style={{ marginRight: spacing.xs }} />
          <Text variant="lg" weight="700" style={{ color: '#FFFFFF' }}>
            Gemini Academic AI
          </Text>
        </View>
        <Text variant="sm" style={{ color: '#E0E7FF', marginBottom: spacing.md }}>
          Ask questions about your syllabus, C code, routines, or exam topics.
        </Text>
        <Button
          title="Start AI Chat (Coming in Phase 2)"
          variant="secondary"
          size="sm"
          disabled
        />
      </Card>

      <Subheading style={{ marginBottom: spacing.sm }}>Active Discussion Channels</Subheading>

      {[
        { name: 'Semester 2 General', desc: '48 members • 12 messages today', icon: 'people' },
        { name: 'C Programming Lab Help', desc: '32 members • 5 active discussions', icon: 'code' },
        { name: 'Exam & Assignment Queries', desc: 'CR & Faculty announcements', icon: 'help-buoy' },
      ].map((channel, i) => (
        <Card key={i} variant="elevated" padding="md" style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.md,
                backgroundColor: colors.surfaceSubtle,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: spacing.md,
              }}
            >
              <Ionicons name={channel.icon as any} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="600" variant="sm">
                {channel.name}
              </Text>
              <Caption color="muted">{channel.desc}</Caption>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
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
});
