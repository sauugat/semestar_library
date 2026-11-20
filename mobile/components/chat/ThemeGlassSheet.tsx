import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

export interface ThemeGlassSheetProps {
  backgroundImage?: number | null;
  tintColor?: string;
  accentColor?: string;
  blurRadius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function hexToRgba(hex: string, alpha: number): string {
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

/**
 * Reusable theme-tinted frosted glass bottom sheet container.
 * Uses expo-image's native GPU blurRadius over the active chat wallpaper plus
 * a translucent theme-tinted gradient and specular glass border.
 */
export const ThemeGlassSheet = React.memo(function ThemeGlassSheet({
  backgroundImage = null,
  tintColor = '#52525B',
  accentColor = '#E4E4E7',
  blurRadius = 26,
  style,
  children,
}: ThemeGlassSheetProps) {
  const topTint = hexToRgba(tintColor, backgroundImage ? 0.24 : 0.16);
  const midTint = hexToRgba(accentColor, backgroundImage ? 0.10 : 0.06);
  const borderTint = hexToRgba(accentColor, 0.26);

  return (
    <View style={[styles.sheet, { borderColor: borderTint }, style]}>
      {/* Native GPU-blurred wallpaper layer for genuine frosted glass */}
      {backgroundImage ? (
        <Image
          source={backgroundImage}
          blurRadius={blurRadius}
          style={styles.blurredWallpaper}
          contentFit="cover"
          cachePolicy="memory"
          pointerEvents="none"
        />
      ) : null}

      {/* Translucent theme-tinted frosted glass gradient */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          topTint,
          midTint,
          'rgba(10, 10, 14, 0.72)',
          'rgba(8, 8, 12, 0.86)',
        ]}
        locations={[0, 0.28, 0.66, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle top specular highlight */}
      <View pointerEvents="none" style={styles.specularTopLine} />

      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: 'rgba(12, 12, 16, 0.72)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  blurredWallpaper: {
    ...StyleSheet.absoluteFill,
    opacity: 0.42,
    transform: [{ scale: 1.08 }],
  },
  specularTopLine: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});
