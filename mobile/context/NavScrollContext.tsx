import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

interface NavScrollContextType {
  isCompact: boolean;
  setIsCompact: (compact: boolean) => void;
  resetCompact: () => void;
  reportScroll: (scrollY: number) => void;
}

const NavScrollContext = createContext<NavScrollContextType>({
  isCompact: false,
  setIsCompact: () => {},
  resetCompact: () => {},
  reportScroll: () => {},
});

export const SCROLL_THRESHOLD_DOWN = 24; // ~24dp accumulated downward movement to shrink
export const SCROLL_THRESHOLD_UP = 24;   // ~24dp accumulated upward movement to expand

export function NavScrollProvider({ children }: { children: React.ReactNode }) {
  const [isCompact, setIsCompactState] = useState(false);
  const isCompactRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);

  const setIsCompact = useCallback((compact: boolean) => {
    if (isCompactRef.current !== compact) {
      isCompactRef.current = compact;
      setIsCompactState(compact);
    }
  }, []);

  const resetCompact = useCallback(() => {
    if (isCompactRef.current) {
      isCompactRef.current = false;
      setIsCompactState(false);
    }
    lastScrollYRef.current = 0;
    accumulatedDeltaRef.current = 0;
  }, []);

  const reportScroll = useCallback(
    (scrollY: number) => {
      // Clamp negative bounce/overscroll (e.g. iOS rubber-band at top of list)
      const clampedY = Math.max(0, scrollY);

      // When reaching near the top of the feed or list (<= 15dp), always restore normal mode
      if (clampedY <= 15) {
        if (isCompactRef.current) {
          setIsCompact(false);
        }
        lastScrollYRef.current = clampedY;
        accumulatedDeltaRef.current = 0;
        return;
      }

      const prevY = lastScrollYRef.current;
      const deltaY = clampedY - prevY;
      lastScrollYRef.current = clampedY;

      // Ignore sub-pixel oscillations and negligible noise (< 1dp)
      if (Math.abs(deltaY) < 1) {
        return;
      }

      if (deltaY > 0) {
        // Scrolling DOWNWARD: Reset upward accumulator and accumulate downward distance
        if (accumulatedDeltaRef.current < 0) {
          accumulatedDeltaRef.current = 0;
        }
        accumulatedDeltaRef.current += deltaY;

        // Trigger compact mode once meaningful downward movement threshold is achieved
        if (accumulatedDeltaRef.current >= SCROLL_THRESHOLD_DOWN && !isCompactRef.current) {
          setIsCompact(true);
        }
      } else if (deltaY < 0) {
        // Scrolling UPWARD: Reset downward accumulator and accumulate upward distance
        if (accumulatedDeltaRef.current > 0) {
          accumulatedDeltaRef.current = 0;
        }
        accumulatedDeltaRef.current += deltaY; // negative value

        // Trigger normal mode immediately after meaningful upward movement at ANY scroll position
        if (accumulatedDeltaRef.current <= -SCROLL_THRESHOLD_UP && isCompactRef.current) {
          setIsCompact(false);
        }
      }
    },
    [setIsCompact]
  );

  return (
    <NavScrollContext.Provider
      value={{
        isCompact,
        setIsCompact,
        resetCompact,
        reportScroll,
      }}
    >
      {children}
    </NavScrollContext.Provider>
  );
}

export function useNavScroll() {
  return useContext(NavScrollContext);
}

/**
 * Hook for pages with scrollable feeds/lists (Home, Library, Profile)
 * Attaches scroll listener with minimal overhead and sensible threshold gating.
 */
export function useAdaptiveNavScroll() {
  const { reportScroll } = useNavScroll();

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset?.y ?? 0;
      reportScroll(y);
    },
    [reportScroll]
  );

  return {
    onScroll: handleScroll,
    scrollEventThrottle: 16,
  };
}
