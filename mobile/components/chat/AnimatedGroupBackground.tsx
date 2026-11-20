import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface AnimatedGroupBackgroundProps {
  source: number;
  overlayColor?: string;
  accentColor?: string;
}

interface StarSpec {
  id: number;
  top: `${number}%`;
  left: `${number}%`;
  size: number;
  delay: number;
  duration: number;
  maxOpacity: number;
}

const STAR_SPECS: StarSpec[] = [
  { id: 1, top: '12%', left: '14%', size: 2.2, delay: 0, duration: 3200, maxOpacity: 0.72 },
  { id: 2, top: '20%', left: '34%', size: 1.8, delay: 900, duration: 4100, maxOpacity: 0.58 },
  { id: 3, top: '28%', left: '10%', size: 2.5, delay: 1600, duration: 3600, maxOpacity: 0.78 },
  { id: 4, top: '38%', left: '24%', size: 1.7, delay: 400, duration: 4500, maxOpacity: 0.52 },
  { id: 5, top: '52%', left: '12%', size: 2.2, delay: 2100, duration: 3400, maxOpacity: 0.68 },
  { id: 6, top: '66%', left: '20%', size: 1.8, delay: 1100, duration: 3900, maxOpacity: 0.60 },
  { id: 7, top: '76%', left: '10%', size: 2.4, delay: 600, duration: 4300, maxOpacity: 0.74 },
  { id: 8, top: '16%', left: '78%', size: 2.0, delay: 1400, duration: 3700, maxOpacity: 0.62 },
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TwinklingStar = React.memo(function TwinklingStar({
  star,
  reduceMotion,
}: {
  star: StarSpec;
  reduceMotion: boolean;
}) {
  const opacity = useSharedValue(reduceMotion ? star.maxOpacity * 0.45 : 0.12);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(opacity);
      opacity.value = star.maxOpacity * 0.45;
      return;
    }
    opacity.value = withDelay(
      star.delay,
      withRepeat(
        withTiming(star.maxOpacity, {
          duration: star.duration,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true
      )
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity, reduceMotion, star.delay, star.duration, star.maxOpacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View
      style={[
        styles.starDot,
        {
          top: star.top,
          left: star.left,
          width: star.size,
          height: star.size,
          borderRadius: star.size / 2,
        },
        animStyle,
      ]}
    />
  );
});

/**
 * Subtle, UI-thread animated planetary backdrop:
 * - Slow orbital breathing zoom & micro-drift on the wallpaper image
 * - Gentle atmospheric shimmer tinted to the planet's accent color
 * - Soft twinkling starlight specks in deep space
 * Automatically pauses animations when Reduce Motion is enabled.
 */
export const AnimatedGroupBackground = React.memo(function AnimatedGroupBackground({
  source,
  overlayColor = 'transparent',
  accentColor = '#FFFFFF',
}: AnimatedGroupBackgroundProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  const scale = useSharedValue(1.05);
  const translateX = useSharedValue(-5);
  const translateY = useSharedValue(-6);
  const glowOpacity = useSharedValue(0.06);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (mounted) setReduceMotion(Boolean(enabled));
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(glowOpacity);
      scale.value = 1.03;
      translateX.value = 0;
      translateY.value = 0;
      glowOpacity.value = 0.08;
      return;
    }

    // Asynchronous periods create an organic, non-repetitive cosmic drift
    scale.value = withRepeat(
      withTiming(1.10, {
        duration: 14000,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
    translateX.value = withRepeat(
      withTiming(6, {
        duration: 18500,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
    translateY.value = withRepeat(
      withTiming(7, {
        duration: 21000,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
    glowOpacity.value = withRepeat(
      withTiming(0.20, {
        duration: 6500,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );

    return () => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(glowOpacity);
    };
  }, [reduceMotion, scale, translateX, translateY, glowOpacity]);

  const imageMotionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const glowMotionStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const glowStrong = hexToRgba(accentColor, 0.42);
  const glowSoft = hexToRgba(accentColor, 0.12);

  return (
    <View
      pointerEvents="none"
      style={styles.root}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Slowly drifting & breathing planet image */}
      <Reanimated.View style={[StyleSheet.absoluteFill, imageMotionStyle]}>
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
          priority="high"
        />
      </Reanimated.View>

      {/* Soft atmospheric shimmer tinted to the planet's palette */}
      <Reanimated.View style={[StyleSheet.absoluteFill, glowMotionStyle]}>
        <LinearGradient
          colors={['transparent', glowSoft, glowStrong, glowSoft, 'transparent']}
          locations={[0, 0.25, 0.52, 0.78, 1]}
          start={{ x: 0.9, y: 0.15 }}
          end={{ x: 0.1, y: 0.85 }}
          style={StyleSheet.absoluteFill}
        />
      </Reanimated.View>

      {/* Subtle twinkling starlight specks */}
      {STAR_SPECS.map((star) => (
        <TwinklingStar key={star.id} star={star} reduceMotion={reduceMotion} />
      ))}

      {/* Readability scrim */}
      {overlayColor !== 'transparent' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backgroundColor: '#050507',
  },
  starDot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
});
