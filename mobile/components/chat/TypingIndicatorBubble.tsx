import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/ui/Typography';

interface TypingIndicatorBubbleProps {
  /** Optional remote avatar URI */
  avatarUri?: string | null;
  /** Optional local static image source (e.g. require('../../assets/images/kyana-logo.png')) */
  avatarSource?: any;
  /** Fallback initials if no avatar image is available */
  initials?: string;
  /** Optional auth headers for remote avatar */
  headers?: Record<string, string>;
  /** Optional subtle label above/beside the pill (e.g. for group chat) */
  label?: string;
  /** Render only the 3 bouncing dots without the outer avatar/pill wrapper */
  dotsOnly?: boolean;
}

/**
 * Instagram-style smooth wave-bouncing 3-dot typing bubble.
 * Uses native-driver translateY + opacity + scale for 60fps hardware-accelerated motion.
 */
export function TypingDotsWave() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createBounce = (val: Animated.Value, initialDelay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(initialDelay),
          Animated.timing(val, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 280,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(Math.max(0, 420 - initialDelay)),
        ])
      );

    const a1 = createBounce(dot1, 0);
    const a2 = createBounce(dot2, 140);
    const a3 = createBounce(dot3, 280);

    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  const makeDotStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({
      inputRange: [0, 1],
      outputRange: [0.42, 1],
    }),
    transform: [
      {
        translateY: val.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -4.5],
        }),
      },
      {
        scale: val.interpolate({
          inputRange: [0, 1],
          outputRange: [0.92, 1.12],
        }),
      },
    ],
  });

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.dot, makeDotStyle(dot1)]} />
      <Animated.View style={[styles.dot, makeDotStyle(dot2)]} />
      <Animated.View style={[styles.dot, makeDotStyle(dot3)]} />
    </View>
  );
}

export function TypingIndicatorBubble({
  avatarUri,
  avatarSource,
  initials = '?',
  headers,
  label,
  dotsOnly = false,
}: TypingIndicatorBubbleProps) {
  if (dotsOnly) {
    return <TypingDotsWave />;
  }

  return (
    <View style={styles.wrapper}>
      {Boolean(label) && (
        <Text style={styles.labelText} numberOfLines={1}>
          {label}
        </Text>
      )}
      <View style={styles.row}>
        <View style={styles.avatarWrap}>
          {avatarSource ? (
            <View style={styles.avatarCircle}>
              <Image source={avatarSource} style={styles.logoAvatar} contentFit="contain" />
            </View>
          ) : avatarUri ? (
            <Image
              source={{ uri: avatarUri, headers, cacheKey: avatarUri }}
              style={styles.avatarImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>

        <View style={styles.pill}>
          <TypingDotsWave />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 2,
    paddingTop: 6,
    paddingBottom: 6,
  },
  labelText: {
    fontSize: 11,
    color: '#8E8E93',
    marginLeft: 38,
    marginBottom: 4,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  avatarWrap: {
    width: 28,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272A',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoAvatar: {
    width: 18,
    height: 18,
  },
  avatarInitials: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E4E4E7',
  },
  pill: {
    backgroundColor: 'rgba(14, 14, 18, 0.94)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#9CA3AF',
  },
});
