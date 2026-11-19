import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  PanResponder,
  StyleSheet,
  View,
  Text as RNText,
  useWindowDimensions,
  type GestureResponderHandlers,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  isBubbleTouchActive,
  markBubbleTouchEnd,
  markBubbleTouchStart,
} from '@/components/chat/FluidChatBackground';

/**
 * Module-level cached Reduce Motion flag (1 native bridge lookup for the entire app,
 * instead of 2 native calls per message bubble).
 */
let cachedReduceMotion = false;
let reduceMotionSubscribed = false;
function ensureReduceMotionListener() {
  if (reduceMotionSubscribed) return;
  reduceMotionSubscribed = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      cachedReduceMotion = Boolean(v);
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
    cachedReduceMotion = Boolean(v);
  });
}

export const CHAT_SPRING_SNAP = {
  damping: 22,
  stiffness: 340,
  mass: 0.72,
};

export const CHAT_SPRING_POP = {
  damping: 11,
  stiffness: 260,
  mass: 0.65,
};

const REPLY_TRIGGER_THRESHOLD = 52;
const REPLY_MAX_DRAG = 86;

function applyRubberBand(rawDx: number): number {
  const abs = Math.abs(rawDx);
  const sign = rawDx >= 0 ? 1 : -1;
  if (abs <= REPLY_TRIGGER_THRESHOLD) {
    return sign * abs * 0.88;
  }
  const excess = abs - REPLY_TRIGGER_THRESHOLD;
  const damped =
    REPLY_TRIGGER_THRESHOLD * 0.88 +
    (REPLY_MAX_DRAG - REPLY_TRIGGER_THRESHOLD * 0.88) *
      (1 - Math.exp(-excess / 42));
  return sign * damped;
}

export interface SwipeableMessageWrapperProps {
  isSelf: boolean;
  swipeDisabled?: boolean;
  onSwipeReply: () => void;
  onDoubleTapReact?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Ultra-lightweight Reanimated v4 swipe-to-reply wrapper:
 * - Only 1 SharedValue + 1 AnimatedStyle per bubble (down from 10 SharedValues + 6 Worklets).
 * - Reply badge mounts lazily ONLY while dragging (zero idle views).
 */
export const SwipeableMessageWrapper = React.memo(function SwipeableMessageWrapper({
  isSelf,
  swipeDisabled = false,
  onSwipeReply,
  style,
  children,
}: SwipeableMessageWrapperProps) {
  const translateX = useSharedValue(0);
  const [dragState, setDragState] = useState<'idle' | 'left' | 'right'>('idle');
  const [isArmed, setIsArmed] = useState(false);

  const onSwipeReplyRef = useRef(onSwipeReply);
  onSwipeReplyRef.current = onSwipeReply;
  const armedRef = useRef(false);
  const dragSideRef = useRef<'idle' | 'left' | 'right'>('idle');
  const swipeDisabledRef = useRef(swipeDisabled);
  swipeDisabledRef.current = swipeDisabled;
  const isSelfRef = useRef(isSelf);
  isSelfRef.current = isSelf;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gs) => {
          if (swipeDisabledRef.current) return false;
          const validDir = isSelfRef.current ? Math.abs(gs.dx) > 9 : gs.dx > 9;
          const claim =
            validDir &&
            Math.abs(gs.dx) > Math.abs(gs.dy) * 1.45 &&
            Math.abs(gs.dy) < 26;
          if (claim) markBubbleTouchStart();
          return claim;
        },
        onMoveShouldSetPanResponder: (_, gs) => {
          if (swipeDisabledRef.current) return false;
          const validDir = isSelfRef.current ? Math.abs(gs.dx) > 9 : gs.dx > 9;
          const claim =
            validDir &&
            Math.abs(gs.dx) > Math.abs(gs.dy) * 1.45 &&
            Math.abs(gs.dy) < 26;
          if (claim) markBubbleTouchStart();
          return claim;
        },
        onPanResponderGrant: () => {
          markBubbleTouchStart();
          armedRef.current = false;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (_, gs) => {
          markBubbleTouchStart();
          let rawDx = gs.dx;
          if (!isSelfRef.current && rawDx < 0) rawDx = 0;

          const damped = applyRubberBand(rawDx);
          translateX.value = damped;

          const nextSide: 'idle' | 'left' | 'right' =
            damped > 6 ? 'left' : damped < -6 && isSelfRef.current ? 'right' : 'idle';
          if (dragSideRef.current !== nextSide) {
            dragSideRef.current = nextSide;
            setDragState(nextSide);
          }

          const absDx = Math.abs(rawDx);
          if (!armedRef.current && absDx >= REPLY_TRIGGER_THRESHOLD) {
            armedRef.current = true;
            setIsArmed(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          } else if (armedRef.current && absDx < REPLY_TRIGGER_THRESHOLD - 10) {
            armedRef.current = false;
            setIsArmed(false);
          }
        },
        onPanResponderRelease: () => {
          markBubbleTouchEnd();
          const shouldReply = armedRef.current && !swipeDisabledRef.current;
          armedRef.current = false;
          dragSideRef.current = 'idle';
          setIsArmed(false);
          setDragState('idle');
          translateX.value = withSpring(0, CHAT_SPRING_SNAP);

          if (shouldReply) {
            onSwipeReplyRef.current();
          }
        },
        onPanResponderTerminate: () => {
          markBubbleTouchEnd();
          armedRef.current = false;
          dragSideRef.current = 'idle';
          setIsArmed(false);
          setDragState('idle');
          translateX.value = withSpring(0, CHAT_SPRING_SNAP);
        },
      }),
    [translateX]
  );

  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={[styles.wrapper, style]}
      onTouchStart={markBubbleTouchStart}
      onTouchEnd={markBubbleTouchEnd}
      onTouchCancel={markBubbleTouchEnd}
      {...panResponder.panHandlers}
    >
      {dragState === 'left' && (
        <View pointerEvents="none" style={styles.replyBadgeLeft}>
          <View
            style={[
              styles.replyBadgeCircle,
              isArmed ? styles.replyBadgeCircleArmed : styles.replyBadgeCircleIdle,
            ]}
          >
            <Ionicons name="arrow-undo" size={15} color={isArmed ? '#09090B' : '#E4E4E7'} />
          </View>
        </View>
      )}

      {dragState === 'right' && isSelf && (
        <View pointerEvents="none" style={styles.replyBadgeRight}>
          <View
            style={[
              styles.replyBadgeCircle,
              isArmed ? styles.replyBadgeCircleArmed : styles.replyBadgeCircleIdle,
            ]}
          >
            <Ionicons name="arrow-undo" size={15} color={isArmed ? '#09090B' : '#E4E4E7'} />
          </View>
        </View>
      )}

      <Reanimated.View style={bubbleAnimatedStyle}>
        {children}
      </Reanimated.View>
    </View>
  );
});

/**
 * Lazy-mounted Instagram heart burst overlay — only mounted for 560ms when the user
 * actually double-taps a message (zero SharedValues or Views on idle bubbles).
 */
export function HeartBurstOverlay({
  burstKey,
  onDone,
}: {
  burstKey: number;
  onDone: () => void;
}) {
  const heartScale = useSharedValue(0.2);
  const heartOpacity = useSharedValue(1);
  const heartTranslateY = useSharedValue(6);
  const heartRotate = useSharedValue(burstKey % 2 === 0 ? -16 : 16);
  const ringScale = useSharedValue(0.35);
  const ringOpacity = useSharedValue(0.78);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    ensureReduceMotionListener();
    const tilt = burstKey % 2 === 0 ? 1 : -1;
    if (cachedReduceMotion) {
      heartScale.value = 1;
      heartTranslateY.value = 0;
      heartRotate.value = 0;
      ringOpacity.value = 0;
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 360 }),
        withTiming(0, { duration: 180 }, (finished) => {
          if (finished) runOnJS(onDoneRef.current)();
        })
      );
      return;
    }

    ringScale.value = withTiming(1.65, { duration: 400, easing: Easing.out(Easing.cubic) });
    ringOpacity.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) });
    heartScale.value = withSequence(
      withSpring(1.3, CHAT_SPRING_POP),
      withSpring(1.0, { damping: 14, stiffness: 260 }),
      withTiming(1.12, { duration: 220 })
    );
    heartRotate.value = withSequence(
      withSpring(tilt * 8, CHAT_SPRING_POP),
      withSpring(0, { damping: 14, stiffness: 220 })
    );
    heartTranslateY.value = withSequence(
      withTiming(-4, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(-28, { duration: 340, easing: Easing.out(Easing.cubic) })
    );
    heartOpacity.value = withSequence(
      withTiming(1, { duration: 300 }),
      withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDoneRef.current)();
      })
    );
  }, [burstKey, heartScale, heartOpacity, heartTranslateY, heartRotate, ringScale, ringOpacity]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [
      { translateY: heartTranslateY.value },
      { scale: heartScale.value },
      { rotateZ: `${heartRotate.value}deg` },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  return (
    <View pointerEvents="none" style={styles.heartOverlayRoot}>
      <Reanimated.View style={[styles.heartRing, ringStyle]} />
      <Reanimated.View style={heartStyle}>
        <RNText style={styles.heartEmoji} allowFontScaling={false}>
          ❤️
        </RNText>
      </Reanimated.View>
    </View>
  );
}

/**
 * Zero-overhead double-tap hook: allocates ZERO SharedValues or AnimatedStyles on idle bubbles.
 * Mounts <HeartBurstOverlay /> lazily only when a double-tap actually happens.
 */
export function useDoubleTapHeart(onReact: () => void, delayMs = 280) {
  const lastTapRef = useRef(0);
  const [burstKey, setBurstKey] = useState(0);
  const onReactRef = useRef(onReact);
  onReactRef.current = onReact;

  const trigger = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBurstKey((k) => k + 1);
    onReactRef.current();
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < delayMs) {
      lastTapRef.current = 0;
      trigger();
      return true;
    }
    lastTapRef.current = now;
    return false;
  };

  const clearBurst = () => setBurstKey(0);

  return {
    handlePress,
    trigger,
    burstKey,
    clearBurst,
  };
}

/**
 * Interactive 120fps slide-in / slide-out swipe-to-exit hook for inline chat screens (Group Chat).
 * Uses a rAF-aligned entrance so the slide-in animation is never eaten by React's mount commit.
 */
export function useInteractiveChatBackSwipe(
  onBack: () => void,
  enabled = true
): {
  panHandlers: GestureResponderHandlers;
  animatedScreenStyle: any;
  scrimStyle: any;
  underlayStyle: any;
  isExiting: boolean;
  triggerAnimatedBack: () => void;
  cancelExit: () => void;
} {
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(enabled ? screenWidth || 390 : 0);
  const [isExiting, setIsExiting] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const widthRef = useRef(screenWidth);
  widthRef.current = screenWidth;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const exitingRef = useRef(false);
  const exitSeqRef = useRef(0);

  // Start from offscreen-right and glide in on the next frame so the push animation is always visible & smooth
  useEffect(() => {
    if (enabled) {
      exitSeqRef.current += 1;
      exitingRef.current = false;
      setIsExiting(false);
      const w = widthRef.current || 390;
      translateX.value = w;
      const rafId = requestAnimationFrame(() => {
        translateX.value = withTiming(0, {
          duration: 230,
          easing: Easing.out(Easing.cubic),
        });
      });
      return () => cancelAnimationFrame(rafId);
    } else {
      exitSeqRef.current += 1;
      exitingRef.current = false;
      setIsExiting(false);
      translateX.value = 0;
    }
  }, [enabled, translateX]);

  const finishExit = (seq: number) => {
    // Ignore stale exit callbacks if the user already re-opened Semester Group
    if (seq !== exitSeqRef.current) return;
    exitingRef.current = false;
    setIsExiting(false);
    onBackRef.current();
  };

  const cancelExit = () => {
    exitSeqRef.current += 1;
    exitingRef.current = false;
    setIsExiting(false);
    translateX.value = withTiming(0, {
      duration: 210,
      easing: Easing.out(Easing.cubic),
    });
  };

  const triggerAnimatedBack = () => {
    if (!enabledRef.current || exitingRef.current) return;
    const seq = ++exitSeqRef.current;
    exitingRef.current = true;
    setIsExiting(true);
    const w = widthRef.current || 390;
    translateX.value = withTiming(
      w,
      { duration: 190, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(finishExit)(seq);
        }
      }
    );
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (evt, gs) => {
          if (!enabledRef.current || exitingRef.current) return false;
          if (isBubbleTouchActive()) return false;
          const startedAtEdge = evt.nativeEvent.pageX < 36;
          return (
            gs.dx > (startedAtEdge ? 8 : 16) &&
            Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 &&
            Math.abs(gs.dy) < 34
          );
        },
        onMoveShouldSetPanResponder: (evt, gs) => {
          if (!enabledRef.current || exitingRef.current) return false;
          if (isBubbleTouchActive()) return false;
          const startedAtEdge = evt.nativeEvent.pageX < 36;
          return (
            gs.dx > (startedAtEdge ? 8 : 16) &&
            Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 &&
            Math.abs(gs.dy) < 34
          );
        },
        onPanResponderMove: (_, gs) => {
          if (exitingRef.current || isBubbleTouchActive()) return;
          translateX.value = Math.max(0, gs.dx);
        },
        onPanResponderRelease: (_, gs) => {
          if (exitingRef.current) return;
          const w = widthRef.current || 390;
          const shouldExit = gs.dx > w * 0.24 || (gs.dx > 38 && gs.vx > 0.4);
          if (shouldExit) {
            const seq = ++exitSeqRef.current;
            exitingRef.current = true;
            setIsExiting(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            const remaining = Math.max(0, w - Math.max(0, gs.dx));
            const speed = Math.max(gs.vx * 1000, 1400);
            const duration = Math.max(85, Math.min(185, Math.round((remaining / speed) * 1000)));
            translateX.value = withTiming(
              w,
              { duration, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished) {
                  runOnJS(finishExit)(seq);
                }
              }
            );
          } else {
            translateX.value = withSpring(0, {
              velocity: gs.vx * 1000,
              damping: 28,
              stiffness: 360,
              mass: 0.68,
            });
          }
        },
        onPanResponderTerminate: () => {
          if (!exitingRef.current) {
            translateX.value = withSpring(0, {
              damping: 28,
              stiffness: 360,
              mass: 0.68,
            });
          }
        },
      }),
    [translateX]
  );

  const animatedScreenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, (screenWidth || 390) * 0.85],
      [0.42, 0],
      Extrapolation.CLAMP
    );
    return {
      opacity: translateX.value > 1 ? opacity : 0,
    };
  });

  const underlayStyle = useAnimatedStyle(() => {
    const w = screenWidth || 390;
    const tx = interpolate(
      translateX.value,
      [0, w],
      [-w * 0.22, 0],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX: translateX.value > 0.5 ? tx : 0 }],
    };
  });

  return {
    panHandlers: enabled ? responder.panHandlers : {},
    animatedScreenStyle,
    scrimStyle,
    underlayStyle,
    isExiting,
    triggerAnimatedBack,
    cancelExit,
  };
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  replyBadgeLeft: {
    position: 'absolute',
    left: -38,
    top: '50%',
    marginTop: -15,
    zIndex: 1,
  },
  replyBadgeRight: {
    position: 'absolute',
    right: -38,
    top: '50%',
    marginTop: -15,
    zIndex: 1,
  },
  replyBadgeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBadgeCircleIdle: {
    backgroundColor: 'rgba(39, 39, 44, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  replyBadgeCircleArmed: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  heartOverlayRoot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  heartRing: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#FF2D55',
  },
  heartEmoji: {
    fontSize: 44,
    lineHeight: 52,
    textAlign: 'center',
    textShadowColor: 'rgba(255, 45, 85, 0.5)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
});
