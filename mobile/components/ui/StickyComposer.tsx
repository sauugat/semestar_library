import React from 'react';
import { ViewStyle, StyleSheet, StyleProp } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';

export interface StickyComposerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bordered?: boolean;
}

/**
 * Enterprise-grade StickyComposer for Semester Library.
 * Backed by react-native-keyboard-controller's native KeyboardStickyView.
 *
 * Rules:
 * 1. Synchronously follows the software keyboard during appearance/dismissal.
 * 2. When keyboard is hidden: safely sits above the device navigation bar / home indicator.
 * 3. When keyboard is open: sits flush above the keyboard top edge.
 * 4. Zero custom timers or conflicting Keyboard.addListener subscriptions.
 */
export function StickyComposer({
  children,
  style,
  bordered = true,
}: StickyComposerProps) {
  const insets = useSafeAreaInsets();
  const { colors, spacing } = useTheme();

  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: insets.bottom }}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: bordered ? colors.border : 'transparent',
          borderTopWidth: bordered ? StyleSheet.hairlineWidth : 0,
          paddingBottom: Math.max(insets.bottom, 12),
          paddingTop: spacing.tight,
          paddingHorizontal: spacing.normal,
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
