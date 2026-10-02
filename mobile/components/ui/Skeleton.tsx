import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle, StyleSheet, View } from 'react-native';
import { useTheme } from '@/constants/useTheme';

export interface SkeletonProps {
  width?: number | `${number}%` | '100%';
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius,
  style,
}: SkeletonProps) {
  const { colors, radii } = useTheme();
  const opacityAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.7,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.3,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius: borderRadius ?? radii.input,
          backgroundColor: colors.skeleton,
          opacity: opacityAnim,
        },
        style,
      ]}
    />
  );
}

/**
 * Pre-composed Card skeleton for feeds and lists
 */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const { spacing, radii, colors } = useTheme();

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radii.card,
          padding: spacing.normal,
          marginBottom: spacing.normal,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Skeleton width="60%" height={14} style={{ marginBottom: 6 }} />
          <Skeleton width="35%" height={10} />
        </View>
      </View>
      <Skeleton width="90%" height={14} style={{ marginTop: 14, marginBottom: 8 }} />
      <Skeleton width="75%" height={14} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={120} borderRadius={radii.card - 2} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
  cardContainer: {
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
