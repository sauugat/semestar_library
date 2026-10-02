import React from 'react';
import { ViewStyle, StyleSheet, StyleProp } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';
import {
  KeyboardStickyView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { COMPOSER_GEOMETRY } from '@/constants/composerGeometry';

export interface UseKeyboardViewportOptions {
  openedOffset?: number;
}

/**
 * Shared keyboard viewport hook for Semester Library.
 * Synchronizes the content viewport's bottom boundary with the sticky composer
 * so content terminates strictly above the composer without being covered.
 */
export function useKeyboardViewport(options?: UseKeyboardViewportOptions) {
  const insets = useSafeAreaInsets();
  const { height, progress } = useReanimatedKeyboardAnimation();

  const defaultOpenedOffset = Math.max(
    0,
    insets.bottom - COMPOSER_GEOMETRY.keyboardGap
  );
  const openedOffset =
    options?.openedOffset !== undefined
      ? options.openedOffset
      : defaultOpenedOffset;

  const contentStyle = useAnimatedStyle(() => {
    const offset = interpolate(progress.value, [0, 1], [0, openedOffset]);
    const lift = Math.max(0, -(height.value + offset));
    return {
      marginBottom: lift,
    };
  }, [openedOffset]);

  return {
    contentStyle,
    openedOffset,
    insets,
  };
}

export interface KeyboardContentBoundaryProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  openedOffset?: number;
}

/**
 * Structural container that wraps scrollable content (Chat FlatList, Comments ScrollView).
 * Dynamically shrinks its layout viewport as the keyboard opens, ensuring content
 * is never obscured underneath the sticky composer.
 */
export function KeyboardContentBoundary({
  children,
  style,
  openedOffset,
}: KeyboardContentBoundaryProps) {
  const { contentStyle } = useKeyboardViewport({ openedOffset });

  return (
    <Reanimated.View style={[styles.boundary, contentStyle, style]}>
      {children}
    </Reanimated.View>
  );
}

export interface StickyComposerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bordered?: boolean;
  openedOffset?: number;
}

/**
 * Enterprise-grade StickyComposer for Semester Library.
 * Backed by react-native-keyboard-controller's native KeyboardStickyView.
 *
 * Spacing Standards:
 * 1. Synchronously follows the software keyboard during appearance/dismissal.
 * 2. When keyboard is hidden: safely sits above the device navigation bar / home indicator.
 * 3. When keyboard is open: sits intentionally attached ~8dp above the keyboard edge.
 * 4. Preserves native keyboard controllers without custom timers.
 */
export function StickyComposer({
  children,
  style,
  bordered = true,
  openedOffset: customOpenedOffset,
}: StickyComposerProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Offset calculation:
  // When keyboard is open, offset subtracts the safe-area inset (minus the intended 8dp gap)
  // so the composer stays flush and naturally attached above the keyboard without an awkward empty void.
  const openedOffset =
    customOpenedOffset !== undefined
      ? customOpenedOffset
      : Math.max(0, insets.bottom - COMPOSER_GEOMETRY.keyboardGap);

  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: openedOffset }}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: bordered ? colors.border : 'transparent',
          borderTopWidth: bordered ? StyleSheet.hairlineWidth : 0,
          paddingBottom: Math.max(insets.bottom, COMPOSER_GEOMETRY.verticalPadding),
          paddingTop: COMPOSER_GEOMETRY.verticalPadding,
          paddingHorizontal: COMPOSER_GEOMETRY.horizontalPadding,
        },
        style,
      ]}
    >
      {children}
    </KeyboardStickyView>
  );
}

StickyComposer.Boundary = KeyboardContentBoundary;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: 100,
  },
  boundary: {
    flex: 1,
    width: '100%',
  },
});

