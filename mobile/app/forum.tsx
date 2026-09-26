import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const MOCK_POSTS = [
  {
    id: 1,
    author: 'Aashrita Lamichhane',
    role: 'Student',
    time: '2 hours ago',
    title: 'How to implement pointers to functions in C?',
    content: 'Can someone explain the syntax for declaring an array of function pointers in C? Having trouble with lab exercise 4.',
    likes: 12,
    comments: 5,
  },
  {
    id: 2,
    author: 'Saugat Subedi',
    role: 'Admin',
    time: '5 hours ago',
    title: 'Digital Logic assignment solution slides uploaded',
    content: 'All questions from Chapter 3 K-Maps have been solved and uploaded to the Digital Logic section.',
    likes: 24,
    comments: 8,
  },
];

export default function ForumScreen() {
  const { colors, spacing, radii } = useTheme();

  return (
    <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <Subheading>Community Feed</Subheading>
        <Button
          title="New Post"
          size="sm"
          leftIcon={<Ionicons name="add" size={16} color="#FFFFFF" />}
          disabled
        />
      </View>

      {MOCK_POSTS.map((post) => (
        <Card key={post.id} variant="elevated" padding="md" style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radii.full,
                backgroundColor: colors.primaryLight,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: spacing.sm,
              }}
            >
              <Text weight="700" color="accent">
                {post.author[0]}
              </Text>
            </View>
            <View>
              <Text variant="sm" weight="700">
                {post.author}
              </Text>
              <Caption color="muted">{post.role} • {post.time}</Caption>
            </View>
          </View>

          <Text variant="md" weight="700" style={{ marginBottom: spacing.xs }}>
            {post.title}
          </Text>
          <Text variant="sm" color="secondary" style={{ marginBottom: spacing.md }}>
            {post.content}
          </Text>

          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: spacing.lg }}>
              <Ionicons name="heart-outline" size={18} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text variant="xs" color="secondary">
                {post.likes}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text variant="xs" color="secondary">
                {post.comments} comments
              </Text>
            </View>
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
