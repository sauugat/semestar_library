import React, { createContext, useContext } from 'react';
import { Tabs, withLayoutContext } from 'expo-router';

export type PagerScrollListener = (position: number, offset: number) => void;

interface PagerSwipeContextType {
  setSwipeEnabled: (enabled: boolean) => void;
}

const PagerSwipeContext = createContext<PagerSwipeContextType>({
  setSwipeEnabled: () => {},
});

export function usePagerSwipe() {
  return useContext(PagerSwipeContext);
}

/**
 * PagerTabs adapter:
 * In runtime 1.0.0, we use standard Expo Router Tabs with FloatingTabBar.
 * Native PagerView swiping requires a native APK rebuild (versionCode 8+),
 * as react-native-pager-view's RNCViewPager cannot be injected via OTA updates.
 *
 * <PagerView
 *   offscreenPageLimit={2}
 *   collapsable={false}
 *   style={{ backgroundColor: '#080808' }}
 * />
 */
// export const PagerTabs = withLayoutContext
export const PagerTabs: typeof Tabs = Tabs;
