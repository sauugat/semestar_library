import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  TouchableOpacityProps,
} from 'react-native';
import { useTheme } from '@/constants/useTheme';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
  onPress,
  ...props
}: ButtonProps) {
  const { colors, radii, spacing, typography } = useTheme();

  const isDisabled = disabled || loading;

  const sizeStyles = {
    sm: { paddingVertical: spacing.xs + 4, paddingHorizontal: spacing.sm + 4 },
    md: { paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.md },
    lg: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  };

  const fontSizes = {
    sm: typography.sm,
    md: typography.md,
    lg: typography.lg,
  };

  const getVariantStyles = (): { container: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'secondary':
        return {
          container: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border },
          text: { color: colors.text },
        };
      case 'outline':
        return {
          container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
          text: { color: colors.primary },
        };
      case 'danger':
        return {
          container: { backgroundColor: colors.error },
          text: { color: '#FFFFFF' },
        };
      case 'ghost':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: colors.primary },
        };
      case 'primary':
      default:
        return {
          container: { backgroundColor: colors.primary },
          text: { color: colors.primaryText },
        };
    }
  };

  const variantStyle = getVariantStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          borderRadius: radii.md,
          ...sizeStyles[size],
          ...variantStyle.container,
        },
        isDisabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.primaryText}
        />
      ) : (
        <>
          {leftIcon && <>{leftIcon}</>}
          <Text
            style={[
              styles.text,
              fontSizes[size],
              variantStyle.text,
              leftIcon ? { marginLeft: spacing.xs + 2 } : null,
              rightIcon ? { marginRight: spacing.xs + 2 } : null,
              textStyle,
            ]}
          >
            {title}
          </Text>
          {rightIcon && <>{rightIcon}</>}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
