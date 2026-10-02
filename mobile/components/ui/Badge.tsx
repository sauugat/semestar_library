import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface BadgeProps {
  label: string;
  variant?: 'official' | 'neutral' | 'success' | 'warning' | 'error' | 'outline';
  size?: 'sm' | 'md';
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function Badge({
  label,
  variant = 'neutral',
  size = 'sm',
  icon,
  style,
}: BadgeProps) {
  const { colors, radii, spacing, typography } = useTheme();

  const getVariantStyles = () => {
    switch (variant) {
      case 'official':
        return {
          bg: colors.badgeNoticeBg,
          text: colors.badgeNotice,
          border: colors.borderStrong,
        };
      case 'success':
        return {
          bg: colors.successBg,
          text: colors.success,
          border: 'transparent',
        };
      case 'warning':
        return {
          bg: colors.warningBg,
          text: colors.warning,
          border: 'transparent',
        };
      case 'error':
        return {
          bg: colors.errorBg,
          text: colors.error,
          border: 'transparent',
        };
      case 'outline':
        return {
          bg: 'transparent',
          text: colors.textSecondary,
          border: colors.border,
        };
      case 'neutral':
      default:
        return {
          bg: colors.surfaceSubtle,
          text: colors.textSecondary,
          border: colors.borderSubtle,
        };
    }
  };

  const vStyle = getVariantStyles();
  const isSm = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: vStyle.bg,
          borderColor: vStyle.border,
          borderRadius: radii.pill,
          paddingVertical: isSm ? 2 : 4,
          paddingHorizontal: isSm ? spacing.tight : spacing.compact,
        },
        style,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={isSm ? 12 : 14}
          color={vStyle.text}
          style={{ marginRight: 4 }}
        />
      )}
      <Text
        style={[
          styles.label,
          isSm ? typography.xs : typography.sm,
          { color: vStyle.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  label: {
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
