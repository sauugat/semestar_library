import React from 'react';
import { ViewStyle, StyleSheet, StyleProp } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { COMPOSER_GEOMETRY } from '@/constants/composerGeometry';

export interface StickyComposerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bordered?: boolean;
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
}: StickyComposerProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Offset calculation:
  // When keyboard is open, offset subtracts the safe-area inset (minus the intended 8dp gap)
  // so the composer stays flush and naturally attached above the keyboard without an awkward empty void.
  const openedOffset = Math.max(0, insets.bottom - COMPOSER_GEOMETRY.keyboardGap);

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

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: 100,
  },
});
