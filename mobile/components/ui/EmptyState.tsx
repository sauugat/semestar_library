import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionTitle?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  description,
  actionTitle,
  onAction,
  style,
}: EmptyStateProps) {
  const { colors, spacing, typography, radii } = useTheme();

  return (
    <View style={[styles.container, { padding: spacing.large }, style]}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.borderSubtle,
            borderRadius: radii.full,
            marginBottom: spacing.normal,
          },
        ]}
      >
        <Ionicons name={icon} size={32} color={colors.textSecondary} />
      </View>

      <Text
        style={[
          styles.title,
          typography.lg,
          { color: colors.text, marginBottom: spacing.tight },
        ]}
      >
        {title}
      </Text>

      {description ? (
        <Text
          style={[
            styles.description,
            typography.sm,
            { color: colors.textSecondary, marginBottom: actionTitle ? spacing.section : 0 },
          ]}
        >
          {description}
        </Text>
      ) : null}

      {actionTitle && onAction ? (
        <Button
          title={actionTitle}
          variant="secondary"
          size="sm"
          onPress={onAction}
          style={{ minWidth: 140 }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
    width: '100%',
  },
  iconCircle: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
});
