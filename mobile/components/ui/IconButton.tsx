import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'subtle' | 'primary' | 'outline' | 'danger';
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function IconButton({
  icon,
  onPress,
  size = 'md',
  variant = 'ghost',
  color,
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: IconButtonProps) {
  const { colors, radii, touchTarget } = useTheme();

  const getDimension = () => {
    switch (size) {
      case 'sm': return 36;
      case 'lg': return 48;
      case 'md':
      default: return 44;
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'sm': return 18;
      case 'lg': return 24;
      case 'md':
      default: return 20;
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: colors.primary,
          border: 'transparent',
          defaultColor: colors.primaryText,
        };
      case 'subtle':
        return {
          bg: colors.surfaceSubtle,
          border: colors.borderSubtle,
          defaultColor: colors.text,
        };
      case 'outline':
        return {
          bg: 'transparent',
          border: colors.borderStrong,
          defaultColor: colors.text,
        };
      case 'danger':
        return {
          bg: colors.errorBg,
          border: 'transparent',
          defaultColor: colors.error,
        };
      case 'ghost':
      default:
        return {
          bg: 'transparent',
          border: 'transparent',
          defaultColor: colors.text,
        };
    }
  };

  const dim = getDimension();
  const vStyle = getVariantStyles();
  const iconColor = color ?? vStyle.defaultColor;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.7}
      disabled={disabled || loading}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[
        styles.base,
        {
          width: dim,
          height: dim,
          borderRadius: radii.button,
          backgroundColor: vStyle.bg,
          borderColor: vStyle.border,
          borderWidth: vStyle.border !== 'transparent' ? 1 : 0,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name={icon} size={getIconSize()} color={iconColor} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
