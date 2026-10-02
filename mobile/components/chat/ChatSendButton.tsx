import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { COMPOSER_GEOMETRY } from "@/constants/composerGeometry";

export function ChatSendButton({
  disabled,
  sending = false,
  onPress,
}: {
  disabled: boolean;
  sending?: boolean;
  onPress: () => void;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      listener.remove();
    };
  }, []);

  const animate = (toValue: number) => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue,
      speed: 28,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: disabled || sending }}
        disabled={disabled || sending}
        onPress={onPress}
        onPressIn={() => animate(0.92)}
        onPressOut={() => animate(1)}
        activeOpacity={0.8}
        style={styles.touchArea}
      >
        <View
          style={[
            styles.button,
            { backgroundColor: disabled ? "#242426" : "#ffffff" },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#0a0a0a" />
          ) : (
            <Ionicons
              name="arrow-up"
              size={20}
              color={disabled ? "#71717a" : "#0a0a0a"}
            />
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    width: COMPOSER_GEOMETRY.minActionTouchTarget,
    height: COMPOSER_GEOMETRY.minActionTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    width: COMPOSER_GEOMETRY.actionButtonSize,
    height: COMPOSER_GEOMETRY.actionButtonSize,
    borderRadius: COMPOSER_GEOMETRY.actionButtonRadius,
    alignItems: "center",
    justifyContent: "center",
  },
});

