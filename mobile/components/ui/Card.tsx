import React from 'react';
import { View, StyleSheet, ViewProps, TouchableOpacity } from 'react-native';
import { useTheme } from '@/constants/useTheme';

interface CardProps {
  variant?: 'elevated' | 'outlined' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onPress?: () => void;
  style?: any;
  children: React.ReactNode;
}

export function Card({
  variant = 'elevated',
  padding = 'md',
  onPress,
  style,
  children,
}: CardProps) {
  const { colors, spacing, radii, shadows } = useTheme();

  const paddingMap = {
    none: 0,
    sm: spacing.sm,
    md: spacing.md,
    lg: spacing.lg,
  };

  const cardStyle = [
    styles.base,
    {
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      padding: paddingMap[padding],
    },
    variant === 'elevated' && {
      ...shadows.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    variant === 'outlined' && {
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    variant === 'flat' && {
      backgroundColor: colors.surfaceSubtle,
    },
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={cardStyle}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={cardStyle}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
