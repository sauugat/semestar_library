import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle, LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/constants/useTheme';

export interface SurfaceCardProps {
  children: React.ReactNode;
  variant?: 'elevated' | 'subtle' | 'outlined' | 'flat';
  padding?: 'none' | 'tight' | 'compact' | 'normal' | 'large' | 'sm' | 'md' | 'lg';
  radius?: 'input' | 'button' | 'card' | 'sheet' | 'pill' | number;
  onPress?: () => void;
  onLongPress?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: ViewStyle | ViewStyle[] | any;
  activeOpacity?: number;
  disabled?: boolean;
}

export function SurfaceCard({
  children,
  variant = 'elevated',
  padding = 'normal',
  radius = 'card',
  onPress,
  onLongPress,
  onLayout,
  style,
  activeOpacity = 0.75,
  disabled = false,
}: SurfaceCardProps) {
  const { colors, spacing, radii, shadows } = useTheme();

  const getPaddingValue = () => {
    switch (padding) {
      case 'none': return 0;
      case 'tight':
      case 'sm': return spacing.tight;
      case 'compact': return spacing.compact;
      case 'large':
      case 'lg': return spacing.large;
      case 'normal':
      case 'md':
      default: return spacing.normal; // 16dp
    }
  };

  const getRadiusValue = () => {
    if (typeof radius === 'number') return radius;
    switch (radius) {
      case 'input': return radii.input;
      case 'button': return radii.button;
      case 'sheet': return radii.sheet;
      case 'pill': return radii.pill;
      case 'card':
      default: return radii.card; // 16dp
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'subtle':
      case 'flat':
        return {
          backgroundColor: colors.surfaceSubtle,
          borderColor: colors.borderSubtle,
          borderWidth: StyleSheet.hairlineWidth,
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          borderColor: colors.borderStrong,
          borderWidth: 1,
        };
      case 'elevated':
      default:
        return {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          ...shadows.subtle,
        };
    }
  };

  const cardStyle = [
    styles.card,
    {
      padding: getPaddingValue(),
      borderRadius: getRadiusValue(),
      ...getVariantStyles(),
    },
    style,
  ];

  if (onPress || onLongPress) {
    return (
      <TouchableOpacity
        activeOpacity={activeOpacity}
        onPress={onPress}
        onLongPress={onLongPress}
        onLayout={onLayout}
        disabled={disabled}
        style={cardStyle}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle} onLayout={onLayout}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
