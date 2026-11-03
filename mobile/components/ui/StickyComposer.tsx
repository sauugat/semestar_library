import React, { useEffect } from 'react';
import {
  ViewStyle,
  StyleSheet,
  StyleProp,
  Keyboard,
  Platform,
  type KeyboardEvent,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
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
 * Shared fallback keyboard height shared-value so screens work identically
 * in both native dev-client builds and Expo Go fallback environments.
 */
function useFallbackKeyboardSharedValues() {
  const fallbackHeightSV = useSharedValue(0);
  const fallbackProgressSV = useSharedValue(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const h = e?.endCoordinates?.height || 0;
      const duration = e?.duration && e.duration > 0 ? e.duration : 220;
      if (h > 0) {
        fallbackHeightSV.value = withTiming(-h, { duration });
        fallbackProgressSV.value = withTiming(1, { duration });
      }
    };

    const onHide = (e: KeyboardEvent) => {
      const duration = e?.duration && e.duration > 0 ? e.duration : 200;
      fallbackHeightSV.value = withTiming(0, { duration });
      fallbackProgressSV.value = withTiming(0, { duration });
    };

    const s1 = Keyboard.addListener(showEvent, onShow);
    const s2 = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidShow', onShow) : null;
    const s3 = Keyboard.addListener(hideEvent, onHide);
    const s4 = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidHide', onHide) : null;

    return () => {
      s1.remove();
      s2?.remove();
      s3.remove();
      s4?.remove();
    };
  }, [fallbackHeightSV, fallbackProgressSV]);

  return { fallbackHeightSV, fallbackProgressSV };
}

/**
 * Shared keyboard viewport hook for Semester Library.
 * Synchronizes the content viewport's bottom boundary with the sticky composer
 * so content terminates strictly above the composer without being covered.
 */
export function useKeyboardViewport(options?: UseKeyboardViewportOptions) {
  const insets = useSafeAreaInsets();
  const { height, progress } = useReanimatedKeyboardAnimation();
  const { fallbackHeightSV, fallbackProgressSV } = useFallbackKeyboardSharedValues();

  const openedOffset = options?.openedOffset !== undefined ? options.openedOffset : 0;

  const contentStyle = useAnimatedStyle(() => {
    const activeHeight = height.value !== 0 ? height.value : fallbackHeightSV.value;
    const activeProgress = progress.value !== 0 ? progress.value : fallbackProgressSV.value;
    const offset = interpolate(activeProgress, [0, 1], [0, openedOffset]);
    const lift = Math.max(0, -(activeHeight + offset));
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
 * Backed by react-native-keyboard-controller's native KeyboardStickyView
 * with automatic fallback for Expo Go and dynamic safe-area bottom padding collapse.
 */
export function StickyComposer({
  children,
  style,
  bordered = true,
  openedOffset: customOpenedOffset,
}: StickyComposerProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { height, progress } = useReanimatedKeyboardAnimation();
  const { fallbackHeightSV, fallbackProgressSV } = useFallbackKeyboardSharedValues();

  const closedBottomPadding = Math.max(insets.bottom, COMPOSER_GEOMETRY.verticalPadding);
  const openedBottomPadding = COMPOSER_GEOMETRY.verticalPadding;
  const openedOffset = customOpenedOffset !== undefined ? customOpenedOffset : 0;

  const animatedComposerStyle = useAnimatedStyle(() => {
    const activeProgress = progress.value !== 0 ? progress.value : fallbackProgressSV.value;
    const pb = interpolate(
      activeProgress,
      [0, 1],
      [closedBottomPadding, openedBottomPadding]
    );
    // Only apply fallback translateY if native KeyboardStickyView height.value is 0
    const fallbackTranslateY =
      height.value === 0 && fallbackHeightSV.value !== 0
        ? fallbackHeightSV.value + openedOffset
        : 0;

    return {
      paddingBottom: pb,
      transform: [{ translateY: fallbackTranslateY }],
    };
  }, [closedBottomPadding, openedBottomPadding, openedOffset]);

  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: openedOffset }}
      style={styles.container}
    >
      <Reanimated.View
        style={[
          styles.container,
          {
            backgroundColor: colors.surface,
            borderTopColor: bordered ? colors.border : 'transparent',
            borderTopWidth: bordered ? StyleSheet.hairlineWidth : 0,
            paddingTop: COMPOSER_GEOMETRY.verticalPadding,
            paddingHorizontal: COMPOSER_GEOMETRY.horizontalPadding,
          },
          animatedComposerStyle,
          style,
        ]}
      >
        {children}
      </Reanimated.View>
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
