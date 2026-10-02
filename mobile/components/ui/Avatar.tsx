import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/constants/useTheme';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

export interface AvatarProps {
  url?: string | null;
  name?: string | null;
  size?: AvatarSize;
  onPress?: () => void;
  style?: ViewStyle;
}

const SIZE_MAP: Record<AvatarSize, { dimension: number; fontSize: number }> = {
  xs: { dimension: 24, fontSize: 10 },
  sm: { dimension: 32, fontSize: 12 },
  md: { dimension: 40, fontSize: 15 },
  lg: { dimension: 48, fontSize: 18 },
  xl: { dimension: 64, fontSize: 24 },
  xxl: { dimension: 80, fontSize: 30 },
};

export function Avatar({
  url,
  name,
  size = 'md',
  onPress,
  style,
}: AvatarProps) {
  const { colors } = useTheme();
  const [loadError, setLoadError] = useState(false);

  const { dimension, fontSize } = SIZE_MAP[size];

  const getInitials = () => {
    if (!name || !name.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const containerStyle = [
    styles.container,
    {
      width: dimension,
      height: dimension,
      borderRadius: dimension / 2,
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    style,
  ];

  const content = (
    url && !loadError ? (
      <Image
        source={{ uri: url }}
        style={[styles.image, { borderRadius: dimension / 2 }]}
        contentFit="cover"
        transition={150}
        onError={() => setLoadError(true)}
      />
    ) : (
      <View style={[styles.fallback, { borderRadius: dimension / 2 }]}>
        <Text
          style={[
            styles.initials,
            {
              fontSize,
              color: colors.textSecondary,
            },
          ]}
        >
          {getInitials()}
        </Text>
      </View>
    )
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={containerStyle}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '700',
  },
});
