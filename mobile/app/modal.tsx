import React from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';

export default function ModalScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />

      <View
        style={[
          styles.logoContainer,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.borderStrong,
            borderRadius: 24,
          },
        ]}
      >
        <Image
          source={require('@/assets/images/app-logo.jpg')}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
      </View>

      <Heading style={{ marginBottom: 4 }}>Semester Library</Heading>
      <Caption color="muted" style={{ marginBottom: spacing.md }}>
        Version 1.0.0 (Production Build)
      </Caption>

      <View
        style={[
          styles.infoCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.lg,
            padding: spacing.md,
            marginBottom: spacing.lg,
          },
        ]}
      >
        <Text variant="sm" color="secondary" style={{ textAlign: 'center', lineHeight: 20 }}>
          Gandaki University Central Study Repository & Academic Portal. Access semester curriculum, class notes, real-time community chat, and official notices.
        </Text>
      </View>

      <Button
        title="Close"
        variant="primary"
        size="md"
        onPress={() => router.back()}
        style={{ minWidth: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginBottom: 16,
  },
  infoCard: {
    borderWidth: 1,
    width: '100%',
    maxWidth: 340,
  },
});
