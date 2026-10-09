import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  useWindowDimensions,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Monochrome } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useNavScroll } from '@/context/NavScrollContext';
import { DEFAULT_SERVER_URL } from '@/services/api';
import {
  GlassView,
  isLiquidGlassAvailable,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';

export interface BottomTabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options?: any }>;
  navigation: any;
  insets?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  pagerRef?: React.RefObject<any>;
  registerPagerScrollListener?: (listener: (position: number, offset: number) => void) => () => void;
}

interface TabConfig {
  name: string;
  label: string;
  iconOutline: keyof typeof Ionicons.glyphMap;
  iconFilled: keyof typeof Ionicons.glyphMap;
}

// Exactly five tabs in strict order with Chat in the exact center (index 2)
export const TAB_CONFIGS: TabConfig[] = [
  {
    name: 'index',
    label: 'Home',
    iconOutline: 'home-outline',
    iconFilled: 'home',
  },
  {
    name: 'library',
    label: 'Library',
    iconOutline: 'book-outline',
    iconFilled: 'book',
  },
  {
    name: 'chat',
    label: 'Chat',
    iconOutline: 'chatbubble-outline',
    iconFilled: 'chatbubble',
  },
  {
    name: 'games',
    label: 'Games',
    iconOutline: 'game-controller-outline',
    iconFilled: 'game-controller',
  },
  {
    name: 'profile',
    label: 'Profile',
    iconOutline: 'person-outline',
    iconFilled: 'person',
  },
];

// Normal Mode dimensions
export const BAR_HEIGHT_NORMAL = 54;
export const INDICATOR_WIDTH_NORMAL = 58;
export const INDICATOR_HEIGHT_NORMAL = 40;
export const INDICATOR_RADIUS_NORMAL = 20;

// Compact Mode dimensions (activated on downward scroll on Home, Library, Profile)
export const BAR_HEIGHT_COMPACT = 46;
export const INDICATOR_WIDTH_COMPACT = 50;
export const INDICATOR_HEIGHT_COMPACT = 36;
export const INDICATOR_RADIUS_COMPACT = 18;

/**
 * Detects whether genuine native Apple Liquid Glass is supported.
 * Strict conditions:
 * 1. Must be iOS platform (Platform.OS === 'ios')
 * 2. Must be iPhone (not iPad)
 * 3. Must be iOS 26 or newer (parseInt(String(Platform.Version), 10) >= 26)
 * 4. isGlassEffectAPIAvailable() must return true
 * 5. isLiquidGlassAvailable() must return true
 */
export function isLiquidGlassSupportedOnDevice(
  customPlatform?: { OS: string; Version: string | number; isPad?: boolean },
  customAPIs?: { isGlassEffectAPIAvailable?: () => boolean; isLiquidGlassAvailable?: () => boolean }
): boolean {
  const pOS = customPlatform?.OS ?? Platform.OS;
  const pPad = customPlatform?.isPad ?? (Platform as any).isPad;
  const pVersion = customPlatform?.Version ?? Platform.Version;

  if (pOS !== 'ios') return false;
  if (pPad) return false;

  const majorVersion = parseInt(String(pVersion), 10);
  if (isNaN(majorVersion) || majorVersion < 26) {
    return false;
  }

  try {
    const checkApi = customAPIs?.isGlassEffectAPIAvailable ?? isGlassEffectAPIAvailable;
    const isApiAvailable = typeof checkApi === 'function' ? checkApi() : false;
    if (!isApiAvailable) return false;

    const checkLiquid = customAPIs?.isLiquidGlassAvailable ?? isLiquidGlassAvailable;
    const isLiquidAvailable = typeof checkLiquid === 'function' ? checkLiquid() : false;
    return Boolean(isLiquidAvailable);
  } catch {
    return false;
  }
}

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  pagerRef,
  registerPagerScrollListener,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { user, serverUrl } = useAuth();
  const { isCompact, resetCompact } = useNavScroll();
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const isLiquidGlassSupported = useMemo(() => isLiquidGlassSupportedOnDevice(), []);

  // Inspect if current focused screen explicitly requested hiding the tab bar
  const focusedRoute = state.routes[state.index];
  const focusedDescriptor = descriptors[focusedRoute?.key];
  const tabBarStyle = focusedDescriptor?.options?.tabBarStyle as any;
  const isTabBarHidden = tabBarStyle?.display === 'none';

  // Reset avatar load error on user or avatarUrl update
  useEffect(() => {
    setAvatarLoadError(false);
  }, [user?.avatarUrl, user?.studentId]);

  // Resolve authoritative avatar URL (supports relative /uploads/... paths)
  const avatarUri = useMemo(() => {
    if (!user?.avatarUrl || typeof user.avatarUrl !== 'string' || !user.avatarUrl.trim()) {
      return null;
    }
    const raw = user.avatarUrl.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    const base = serverUrl || DEFAULT_SERVER_URL;
    return `${base.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`;
  }, [user?.avatarUrl, serverUrl]);

  // Derive user initials for profile fallback
  const userInitials = useMemo(() => {
    if (!user?.name || !user.name.trim()) return '';
    const parts = user.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [user?.name]);

  // Responsive calculations:
  // Normal mode: screen width minus 36dp (in 32-40dp range), capped to max 420dp
  const barWidthNormal = Math.min(420, Math.max(290, windowWidth - 36));
  // Compact mode: approximately 84% of normal width (in 82-85% range)
  const barWidthCompact = Math.round(barWidthNormal * 0.84);

  const getSlotRestX = (idx: number, isCompactMode?: boolean) => {
    const currentBarWidth = isCompactMode ? barWidthCompact : barWidthNormal;
    const currentSlotWidth = currentBarWidth / TAB_CONFIGS.length;
    const currentIndicatorWidth = isCompactMode ? INDICATOR_WIDTH_COMPACT : INDICATOR_WIDTH_NORMAL;
    return idx * currentSlotWidth + (currentSlotWidth - currentIndicatorWidth) / 2;
  };

  // Adaptive scroll resizing applies ONLY to Home (0), Library (1), and Profile (4)
  // Chat (2) and Games (3) are strictly exempt from compact mode.
  const isAdaptiveTab = state.index === 0 || state.index === 1 || state.index === 4;
  const effectiveIsCompact = isAdaptiveTab ? isCompact : false;

  // Animated value for smooth transition between normal and compact modes (180ms)
  // CRITICAL: compactAnim controls layout properties (width, height, radius, top) and must strictly use useNativeDriver: false
  const compactAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(compactAnim, {
      toValue: effectiveIsCompact ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [effectiveIsCompact, compactAnim]);

  // When switching away from an adaptive tab to Chat/Games, ensure compact mode resets
  useEffect(() => {
    if (!isAdaptiveTab) {
      resetCompact();
    }
  }, [state.index, isAdaptiveTab, resetCompact]);

  // Interpolated animated values for adaptive sizing (strictly layout properties)
  const animatedBarWidth = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [barWidthNormal, barWidthCompact],
  });

  const animatedBarHeight = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BAR_HEIGHT_NORMAL, BAR_HEIGHT_COMPACT],
  });

  const animatedBarRadius = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BAR_HEIGHT_NORMAL / 2, BAR_HEIGHT_COMPACT / 2],
  });

  const animatedIndicatorWidth = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [INDICATOR_WIDTH_NORMAL, INDICATOR_WIDTH_COMPACT],
  });

  const animatedIndicatorHeight = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [INDICATOR_HEIGHT_NORMAL, INDICATOR_HEIGHT_COMPACT],
  });

  const animatedIndicatorRadius = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [INDICATOR_RADIUS_NORMAL, INDICATOR_RADIUS_COMPACT],
  });

  const animatedIndicatorTop = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      (BAR_HEIGHT_NORMAL - INDICATOR_HEIGHT_NORMAL) / 2,
      (BAR_HEIGHT_COMPACT - INDICATOR_HEIGHT_COMPACT) / 2,
    ],
  });

  // State & references for gesture handling
  // Keep activeTabRef always synchronized with state.index to prevent stale closures
  const activeTabRef = useRef(state.index);
  activeTabRef.current = state.index;

  const dragOriginXRef = useRef(getSlotRestX(state.index, effectiveIsCompact));
  const dragOriginIndexRef = useRef(state.index);
  const isDraggingRef = useRef(false);
  const startTouchTimeRef = useRef(0);
  const startTouchXRef = useRef(0);
  const hoveredIndexRef = useRef<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // CRITICAL: indicatorAnim controls ONLY horizontal translateX and must strictly use useNativeDriver: true
  // It is attached ONLY to indicatorTrack and NEVER shares a component with layout properties like height/width
  const indicatorAnim = useRef(new Animated.Value(getSlotRestX(state.index, effectiveIsCompact))).current;

  // Keep indicator synchronized with state.index when not actively dragging
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (!isDraggingRef.current) {
      anim = Animated.spring(indicatorAnim, {
        toValue: getSlotRestX(state.index, effectiveIsCompact),
        tension: 85,
        friction: 11,
        useNativeDriver: true,
      });
      anim.start();
    }
    return () => {
      if (anim) {
        anim.stop();
      }
    };
  }, [state.index, effectiveIsCompact, barWidthNormal, barWidthCompact]);

  // Synchronize indicator in real time with continuous native pager swiping
  useEffect(() => {
    if (!registerPagerScrollListener) return;
    const unsubscribe = registerPagerScrollListener((position: number, offset: number) => {
      if (isDraggingRef.current) return;

      const currentBarWidth = effectiveIsCompact ? barWidthCompact : barWidthNormal;
      const currentSlotWidth = currentBarWidth / TAB_CONFIGS.length;
      const currentIndicatorWidth = effectiveIsCompact ? INDICATOR_WIDTH_COMPACT : INDICATOR_WIDTH_NORMAL;

      // Fractional progress (e.g. 0.0 -> 1.0 -> 2.0)
      const fractionalPos = position + offset;
      const targetLeft = fractionalPos * currentSlotWidth + (currentSlotWidth - currentIndicatorWidth) / 2;
      indicatorAnim.setValue(targetLeft);
    });
    return unsubscribe;
  }, [registerPagerScrollListener, effectiveIsCompact, barWidthNormal, barWidthCompact]);

  const handleTabSelect = (targetIndex: number) => {
    const clampedIndex = Math.min(4, Math.max(0, targetIndex));
    const targetTab = TAB_CONFIGS[clampedIndex];
    const isAlreadyFocused = state.index === clampedIndex;

    // Smoothly scroll native pager to target tab
    if (pagerRef?.current) {
      pagerRef.current.setPage(clampedIndex);
    }

    const event = navigation.emit({
      type: 'tabPress',
      target: state.routes[clampedIndex]?.key || targetTab.name,
      canPreventDefault: true,
    });

    if (!isAlreadyFocused && !(event as any)?.defaultPrevented) {
      navigation.navigate(targetTab.name);
    }
  };

  // PanResponder for direct finger-drag navigation (tab bar scrubbing) + tap distinction
  // Crucial Root Cause Fix: Gesture origin ALWAYS reads activeTabRef.current (the CURRENTLY ACTIVE TAB)
  // never hardcoded to Home or capturing a stale index.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dx) > 6;
        },
        onMoveShouldSetPanResponderCapture: () => false,

        onPanResponderGrant: (evt) => {
          startTouchTimeRef.current = Date.now();
          // Derive touch position relative to centered capsule bar
          const currentBarWidth = effectiveIsCompact ? barWidthCompact : barWidthNormal;
          const capsuleLeft = (windowWidth - currentBarWidth) / 2;
          startTouchXRef.current = Math.max(0, evt.nativeEvent.pageX - capsuleLeft);
          isDraggingRef.current = false;
          indicatorAnim.stopAnimation();

          // CRITICAL: Always anchor the drag origin to the CURRENTLY ACTIVE TAB in current mode
          const currentActive = activeTabRef.current;
          dragOriginIndexRef.current = currentActive;
          dragOriginXRef.current = getSlotRestX(currentActive, effectiveIsCompact);
          hoveredIndexRef.current = currentActive;
        },

        onPanResponderMove: (_, gestureState) => {
          const { dx } = gestureState;
          if (!isDraggingRef.current && Math.abs(dx) > 6) {
            isDraggingRef.current = true;
          }

          if (isDraggingRef.current) {
            // Movement tracks relative to CURRENTLY ACTIVE TAB rest position
            const targetLeft = dragOriginXRef.current + dx;
            const minLeft = getSlotRestX(0, effectiveIsCompact);
            const maxLeft = getSlotRestX(4, effectiveIsCompact);

            // Apply edge resistance past boundaries
            let clampedLeft = targetLeft;
            if (targetLeft < minLeft) {
              clampedLeft = minLeft + (targetLeft - minLeft) * 0.2;
            } else if (targetLeft > maxLeft) {
              clampedLeft = maxLeft + (targetLeft - maxLeft) * 0.2;
            }

            indicatorAnim.setValue(clampedLeft);

            // Nearest tab slot calculation from indicator center
            const currentBarWidth = effectiveIsCompact ? barWidthCompact : barWidthNormal;
            const currentSlotWidth = currentBarWidth / TAB_CONFIGS.length;
            const currentIndicatorWidth = effectiveIsCompact ? INDICATOR_WIDTH_COMPACT : INDICATOR_WIDTH_NORMAL;
            const indicatorCenter = clampedLeft + currentIndicatorWidth / 2;
            const nearestSlot = Math.min(
              4,
              Math.max(0, Math.floor(indicatorCenter / currentSlotWidth))
            );
            if (nearestSlot !== hoveredIndexRef.current) {
              hoveredIndexRef.current = nearestSlot;
              setHoveredIndex(nearestSlot);
              // NOTE: All haptics/vibrations strictly removed for silent navigation
            }
          }
        },

        onPanResponderRelease: (_, gestureState) => {
          const { dx } = gestureState;
          const duration = Date.now() - startTouchTimeRef.current;
          const wasDragging = isDraggingRef.current;
          isDraggingRef.current = false;
          setHoveredIndex(null);

          const isTap = !wasDragging && Math.abs(dx) < 8 && duration < 350;
          const currentBarWidth = effectiveIsCompact ? barWidthCompact : barWidthNormal;
          const currentSlotWidth = currentBarWidth / TAB_CONFIGS.length;
          const currentIndicatorWidth = effectiveIsCompact ? INDICATOR_WIDTH_COMPACT : INDICATOR_WIDTH_NORMAL;

          if (isTap) {
            // Single tap: navigate to tapped slot
            const tappedIndex = Math.min(
              4,
              Math.max(0, Math.floor(startTouchXRef.current / currentSlotWidth))
            );
            if (pagerRef?.current) {
              pagerRef.current.setPage(tappedIndex);
            }
            Animated.spring(indicatorAnim, {
              toValue: getSlotRestX(tappedIndex, effectiveIsCompact),
              tension: 85,
              friction: 11,
              useNativeDriver: true,
            }).start();
            handleTabSelect(tappedIndex);
          } else {
            // Drag release: snap to nearest tab slot and commit navigation ONCE
            const finalCenter = dragOriginXRef.current + dx + currentIndicatorWidth / 2;
            const targetIndex = Math.min(
              4,
              Math.max(0, Math.round((finalCenter - currentSlotWidth / 2) / currentSlotWidth))
            );
            if (pagerRef?.current) {
              pagerRef.current.setPage(targetIndex);
            }
            Animated.spring(indicatorAnim, {
              toValue: getSlotRestX(targetIndex, effectiveIsCompact),
              tension: 85,
              friction: 11,
              useNativeDriver: true,
            }).start();
            handleTabSelect(targetIndex);
          }
        },

        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
          setHoveredIndex(null);
          Animated.spring(indicatorAnim, {
            toValue: getSlotRestX(activeTabRef.current, effectiveIsCompact),
            tension: 85,
            friction: 11,
            useNativeDriver: true,
          }).start();
        },
      }),
    [windowWidth, barWidthNormal, barWidthCompact, effectiveIsCompact]
  );

  // Corrected bottom position: sits closely above system home indicator with 6-10dp visual clearance
  const bottomPosition =
    insets.bottom > 0
      ? Platform.OS === 'ios'
        ? Math.max(10, insets.bottom - 13)
        : Math.max(10, insets.bottom - 6)
      : 10;

  const avatarSize = effectiveIsCompact ? 22 : 24;
  const iconActiveSize = effectiveIsCompact ? 22 : 24;
  const iconInactiveSize = effectiveIsCompact ? 21 : 23;

  // Render null strictly after all hooks have executed unconditionally
  if (isTabBarHidden) {
    return null;
  }

  return (
    <View
      style={[
        styles.floatingContainer,
        {
          bottom: bottomPosition,
        },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.capsuleBar,
          {
            width: animatedBarWidth,
            height: animatedBarHeight,
            borderRadius: animatedBarRadius,
            borderColor: isLiquidGlassSupported ? 'rgba(255, 255, 255, 0.16)' : Monochrome.navBorder,
          },
          isLiquidGlassSupported && { backgroundColor: 'transparent' },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Native Apple Liquid Glass View on supported iPhones running iOS 26+ */}
        {isLiquidGlassSupported && (
          <GlassView
            style={styles.glassBackground}
            glassEffectStyle={{
              style: 'regular',
              animate: true,
              animationDuration: 0.18,
            }}
            colorScheme="dark"
            tintColor="rgba(23, 23, 23, 0.40)"
            pointerEvents="none"
          />
        )}
        {/* Native-driven indicator translation layer (UI thread, translateX ONLY - no layout properties) */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicatorTrack,
            {
              transform: [{ translateX: indicatorAnim }],
            },
          ]}
        >
          {/* JS-driven indicator sizing pill (width, height, top, radius - strictly useNativeDriver: false) */}
          <Animated.View
            style={[
              styles.indicatorPill,
              {
                width: animatedIndicatorWidth,
                height: animatedIndicatorHeight,
                borderRadius: animatedIndicatorRadius,
                top: animatedIndicatorTop,
                backgroundColor: Monochrome.navActiveIndicator,
              },
            ]}
          />
        </Animated.View>

        {/* 5 Tab Buttons — equally distributed with flex: 1 for symmetric center-based shrinking */}
        {TAB_CONFIGS.map((tab, idx) => {
          const isSelected = hoveredIndex !== null ? hoveredIndex === idx : state.index === idx;
          const isProfileTab = tab.name === 'profile';

          const iconName = isSelected ? tab.iconFilled : tab.iconOutline;
          const iconColor = isSelected
            ? Monochrome.navIconActive
            : Monochrome.navIconInactive;

          return (
            <TouchableOpacity
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={tab.label}
              testID={`tab-${tab.name}`}
              onPress={() => handleTabSelect(idx)}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8 }}
              style={styles.tabButton}
            >
              {isProfileTab ? (
                // Actual user profile picture integration with initials & icon fallback
                avatarUri && !avatarLoadError ? (
                  <View
                    style={[
                      styles.avatarWrapper,
                      {
                        width: avatarSize + 4,
                        height: avatarSize + 4,
                        borderRadius: (avatarSize + 4) / 2,
                        borderColor: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.24)',
                        borderWidth: isSelected ? 1.5 : 1,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: avatarUri }}
                      style={{
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: avatarSize / 2,
                      }}
                      contentFit="cover"
                      transition={150}
                      onError={() => setAvatarLoadError(true)}
                    />
                  </View>
                ) : userInitials ? (
                  <View
                    style={[
                      styles.avatarFallback,
                      {
                        width: avatarSize + 2,
                        height: avatarSize + 2,
                        borderRadius: (avatarSize + 2) / 2,
                        borderColor: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.24)',
                        borderWidth: isSelected ? 1.5 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.avatarInitials,
                        {
                          fontSize: effectiveIsCompact ? 10 : 11,
                          color: isSelected ? '#FFFFFF' : '#A1A1A1',
                        },
                      ]}
                    >
                      {userInitials}
                    </Text>
                  </View>
                ) : (
                  <Ionicons
                    name={iconName}
                    size={isSelected ? iconActiveSize : iconInactiveSize}
                    color={iconColor}
                  />
                )
              ) : (
                <Ionicons
                  name={iconName}
                  size={isSelected ? iconActiveSize : iconInactiveSize}
                  color={iconColor}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  glassBackground: {
    ...StyleSheet.absoluteFill,
  },
  capsuleBar: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: Monochrome.navSurface,
    // Apple Liquid Glass subtle upper rim highlight
    borderTopColor: 'rgba(255, 255, 255, 0.18)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderLeftColor: 'rgba(255, 255, 255, 0.12)',
    borderRightColor: 'rgba(255, 255, 255, 0.12)',
  },
  indicatorTrack: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-start',
  },
  indicatorPill: {
    // Dynamic width, height, borderRadius, top animated on JS thread via compactAnim
  },
  tabButton: {
    flex: 1,
    height: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  avatarWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262626',
  },
  avatarInitials: {
    fontWeight: '700',
    textAlign: 'center',
  },
});

