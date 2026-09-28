import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function ChatSendButton({
  disabled,
  sending,
  onPress,
}: {
  disabled: boolean;
  sending: boolean;
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
        accessibilityLabel={sending ? "Sending message" : "Send message"}
        accessibilityState={{ disabled, busy: sending }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animate(0.92)}
        onPressOut={() => animate(1)}
        activeOpacity={0.8}
        style={[
          styles.button,
          { backgroundColor: disabled ? "#242426" : "#ffffff" },
        ]}
      >
        {sending ? (
          <ActivityIndicator color="#0a0a0a" size="small" />
        ) : (
          <Ionicons
            name="arrow-up"
            size={19}
            color={disabled ? "#71717a" : "#0a0a0a"}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
