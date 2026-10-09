import React, { useRef, useEffect, useCallback, useState, useMemo, createContext, useContext } from 'react';
import { View, StyleSheet } from 'react-native';
import PagerView from 'react-native-pager-view';
import {
  useNavigationBuilder,
  TabRouter,
  createNavigatorFactory,
  TabNavigationState,
  TabActionHelpers,
  ParamListBase,
} from 'expo-router/react-navigation';
import { withLayoutContext } from 'expo-router';

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

interface PagerTabNavigatorProps {
  id?: string;
  initialRouteName?: string;
  backBehavior?: 'initialRoute' | 'firstRoute' | 'history' | 'order' | 'none';
  children?: React.ReactNode;
  screenListeners?: any;
  screenOptions?: any;
  tabBar?: (props: any) => React.ReactNode;
}

function PagerTabNavigator({
  id,
  initialRouteName,
  backBehavior = 'history',
  children,
  screenListeners,
  screenOptions,
  tabBar,
  ...rest
}: PagerTabNavigatorProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    any,
    TabActionHelpers<ParamListBase>,
    any,
    any
  >(TabRouter, {
    id,
    initialRouteName,
    backBehavior,
    children,
    screenListeners,
    screenOptions,
  });

  const pagerRef = useRef<PagerView>(null);
  const isUserInteractingRef = useRef(false);
  const scrollListenersRef = useRef<Set<PagerScrollListener>>(new Set());
  const [childSwipeEnabled, setChildSwipeEnabled] = useState(true);

  // Allow child components (such as FloatingTabBar) to register continuous scroll listeners
  const registerPagerScrollListener = useCallback((listener: PagerScrollListener) => {
    scrollListenersRef.current.add(listener);
    return () => {
      scrollListenersRef.current.delete(listener);
    };
  }, []);

  // Synchronize native pager when state.index changes externally (e.g. deep link or back navigation)
  useEffect(() => {
    if (!isUserInteractingRef.current && pagerRef.current) {
      pagerRef.current.setPage(state.index);
    }
  }, [state.index]);

  const focusedRoute = state.routes[state.index];
  const focusedDescriptor = descriptors[focusedRoute?.key];
  const isSwipeEnabled =
    childSwipeEnabled &&
    focusedDescriptor?.options?.swipeEnabled !== false &&
    focusedDescriptor?.options?.tabBarStyle?.display !== 'none';

  const handlePageScroll = useCallback((e: any) => {
    const { position, offset } = e.nativeEvent;
    for (const listener of scrollListenersRef.current) {
      listener(position, offset);
    }
  }, []);

  const handlePageScrollStateChanged = useCallback((e: any) => {
    const scrollState = e.nativeEvent.pageScrollState;
    isUserInteractingRef.current = scrollState === 'dragging' || scrollState === 'settling';
  }, []);

  const handlePageSelected = useCallback(
    (e: any) => {
      const newIndex = e.nativeEvent.position;
      isUserInteractingRef.current = false;
      if (newIndex !== state.index && state.routes[newIndex]) {
        const targetRoute = state.routes[newIndex];
        const event = navigation.emit({
          type: 'tabPress',
          target: targetRoute.key,
          canPreventDefault: true,
        });
        if (!(event as any)?.defaultPrevented) {
          navigation.navigate(targetRoute.name);
        }
      }
    },
    [state.index, state.routes, navigation]
  );

  const swipeContextValue = useMemo(
    () => ({ setSwipeEnabled: setChildSwipeEnabled }),
    []
  );

  return (
    <NavigationContent>
      <PagerSwipeContext.Provider value={swipeContextValue}>
        <View style={styles.container}>
          <PagerView
            ref={pagerRef}
            style={styles.pager}
            initialPage={state.index}
            scrollEnabled={isSwipeEnabled}
            offscreenPageLimit={2}
            onPageScroll={handlePageScroll}
            onPageScrollStateChanged={handlePageScrollStateChanged}
            onPageSelected={handlePageSelected}
          >
            {state.routes.map((route) => {
              const descriptor = descriptors[route.key];
              return (
                <View key={route.key} style={styles.page} collapsable={false}>
                  {descriptor.render()}
                </View>
              );
            })}
          </PagerView>

          {/* Floating bottom navigation capsule overlay */}
          {tabBar ? (
            tabBar({
              state,
              descriptors,
              navigation,
              pagerRef,
              registerPagerScrollListener,
            })
          ) : null}
        </View>
      </PagerSwipeContext.Provider>
    </NavigationContent>
  );
}

const PagerNavigator = createNavigatorFactory(PagerTabNavigator)();

export const PagerTabs = withLayoutContext<any, typeof PagerNavigator.Navigator, any, any>(
  PagerNavigator.Navigator
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
  pager: {
    flex: 1,
    backgroundColor: '#080808',
  },
  page: {
    flex: 1,
    backgroundColor: '#080808',
  },
});
