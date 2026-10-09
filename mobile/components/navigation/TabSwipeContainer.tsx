import React, { useEffect } from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import { usePagerSwipe } from './PagerTabs';

export const TAB_ROUTE_PATHS = [
  '/(tabs)',
  '/(tabs)/library',
  '/(tabs)/chat',
  '/(tabs)/games',
  '/(tabs)/profile',
] as const;

export interface TabSwipeContainerProps {
  tabIndex?: number;
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * TabSwipeContainer is a clean pass-through view.
 * Genuine full-screen horizontal paging is handled natively at the layout level by PagerTabs,
 * eliminating single-screen translation, empty canvas gaps, and synthetic navigation flashes.
 * It also supports optional gesture locking via disabled={true} for nested modals and rooms.
 */
export function TabSwipeContainer({
  disabled,
  children,
  style,
}: TabSwipeContainerProps) {
  const { setSwipeEnabled } = usePagerSwipe();

  useEffect(() => {
    if (disabled !== undefined) {
      setSwipeEnabled(!disabled);
      return () => {
        setSwipeEnabled(true);
      };
    }
  }, [disabled, setSwipeEnabled]);

  return <View style={[styles.container, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
});
