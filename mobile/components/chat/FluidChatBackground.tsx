import React, { useEffect, useMemo, useRef } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

/**
 * Shared gesture state coordinating Bubble-Only Swipe-to-Reply vs.
 * Outside-Bubble Swipe-to-Back across Group Chat, Personal DM, and Kyana AI.
 */
let activeBubbleTouchUntil = 0;
let isCurrentlyTouchingBubble = false;

export function markBubbleTouchStart(): void {
  isCurrentlyTouchingBubble = true;
  activeBubbleTouchUntil = Date.now() + 1200;
}

export function markBubbleTouchEnd(): void {
  isCurrentlyTouchingBubble = false;
  activeBubbleTouchUntil = Date.now() + 120;
}

export function isBubbleTouchActive(): boolean {
  return isCurrentlyTouchingBubble || Date.now() < activeBubbleTouchUntil;
}

/**
 * Hook that returns PanResponder handlers for navigating back to the inbox
 * when the user swipes right anywhere OUTSIDE of a message bubble.
 */
export function useChatBackSwipeResponder(
  onBack: () => void,
  enabled = true
): GestureResponderHandlers {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const triggeredRef = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
          if (!enabled || isBubbleTouchActive()) return false;
          // On iOS, let UIKit's native 120fps interactivePopGestureRecognizer handle left-edge swipes
          if (Platform.OS === 'ios' && evt.nativeEvent.pageX < 36) return false;
          return (
            gestureState.dx > 18 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.55 &&
            Math.abs(gestureState.dy) < 34
          );
        },
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          if (!enabled || isBubbleTouchActive()) return false;
          if (Platform.OS === 'ios' && evt.nativeEvent.pageX < 36) return false;
          return (
            gestureState.dx > 18 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.55 &&
            Math.abs(gestureState.dy) < 34
          );
        },
        onPanResponderGrant: () => {
          triggeredRef.current = false;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isBubbleTouchActive() || triggeredRef.current) return;
          if (
            (gestureState.dx > 54 || (gestureState.dx > 30 && gestureState.vx > 0.42)) &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.35
          ) {
            triggeredRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onBackRef.current();
          }
        },
      }),
    [enabled]
  );

  return responder.panHandlers;
}

export interface FluidChatBackgroundProps {
  veilOpacity?: number;
}

/**
 * Zero-overdraw, single-pass obsidian metallic gradient backdrop for all chat screens.
 * Eliminates the 6 offscreen CoreAnimation render passes + continuous worklets that
 * previously stalled push/pop transitions on iOS and Android.
 */
export const FluidChatBackground = React.memo(function FluidChatBackground({
  veilOpacity = 0,
}: FluidChatBackgroundProps) {
  return (
    <View
      pointerEvents="none"
      style={styles.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient
        colors={['#050507', '#0C0D11', '#070709', '#111218', '#040406']}
        locations={[0, 0.28, 0.52, 0.78, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {veilOpacity > 0 && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(0, 0, 0, ${veilOpacity})` },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#050507',
    zIndex: 0,
  },
});
