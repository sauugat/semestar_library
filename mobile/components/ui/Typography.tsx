import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { useTheme } from '@/constants/useTheme';

interface CustomTextProps extends RNTextProps {
  variant?: 'hero' | 'xxl' | 'xl' | 'lg' | 'md' | 'sm' | 'xs';
  color?: 'primary' | 'secondary' | 'muted' | 'inverse' | 'accent' | 'error' | 'success';
  weight?: '400' | '500' | '600' | '700' | '800';
  align?: 'left' | 'center' | 'right';
  children: React.ReactNode;
}

export function Text({
  variant = 'md',
  color = 'primary',
  weight,
  align = 'left',
  style,
  children,
  ...props
}: CustomTextProps) {
  const { colors, typography } = useTheme();

  const colorMap = {
    primary: colors.text,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    inverse: colors.surface,
    accent: colors.primary,
    error: colors.error,
    success: colors.success,
  };

  const textStyle = [
    typography[variant],
    {
      color: colorMap[color],
      textAlign: align,
      fontWeight: weight || (typography[variant] as any).fontWeight || '400',
    },
    style,
  ];

  return (
    <RNText style={textStyle} {...props}>
      {children}
    </RNText>
  );
}

export function Heading({ children, style, ...props }: CustomTextProps) {
  return (
    <Text variant="xl" weight="700" style={style} {...props}>
      {children}
    </Text>
  );
}

export function Subheading({ children, style, ...props }: CustomTextProps) {
  return (
    <Text variant="lg" weight="600" color="secondary" style={style} {...props}>
      {children}
    </Text>
  );
}

export function Caption({ children, style, ...props }: CustomTextProps) {
  return (
    <Text variant="xs" color="muted" style={style} {...props}>
      {children}
    </Text>
  );
}
