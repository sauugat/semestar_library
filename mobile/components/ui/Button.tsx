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

export interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
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
  const { colors, radii, spacing, typography, touchTarget } = useTheme();

  const isDisabled = disabled || loading;

  const sizeStyles = {
    sm: { minHeight: 36, paddingVertical: spacing.tight, paddingHorizontal: spacing.compact },
    md: { minHeight: touchTarget.comfortable, paddingVertical: spacing.compact, paddingHorizontal: spacing.normal },
    lg: { minHeight: 52, paddingVertical: spacing.normal, paddingHorizontal: spacing.section },
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
          container: {
            backgroundColor: colors.surfaceSubtle,
            borderWidth: 1,
            borderColor: colors.border,
          },
          text: { color: colors.text },
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: colors.borderStrong,
          },
          text: { color: colors.text },
        };
      case 'danger':
        return {
          container: {
            backgroundColor: colors.error,
          },
          text: { color: '#FFFFFF' },
        };
      case 'ghost':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: colors.text },
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
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      activeOpacity={0.75}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          borderRadius: radii.button,
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
              leftIcon ? { marginLeft: spacing.tight } : null,
              rightIcon ? { marginRight: spacing.tight } : null,
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

export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="primary" />;
}

export function SecondaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="secondary" />;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
