import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';

export interface ToastProps {
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'info';
  onDismiss: () => void;
  duration?: number;
  style?: ViewStyle;
}

export function Toast({
  visible,
  message,
  type = 'info',
  onDismiss,
  duration = 3000,
  style,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const { colors, radii, spacing, typography, shadows } = useTheme();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: insets.top + spacing.tight,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        handleDismiss();
      }, duration);

      return () => clearTimeout(timer);
    } else {
      translateY.setValue(-100);
      opacity.setValue(0);
    }
  }, [visible, duration, insets.top]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  if (!visible) return null;

  const getIcon = () => {
    switch (type) {
      case 'success': return { name: 'checkmark-circle' as const, color: colors.success };
      case 'error': return { name: 'alert-circle' as const, color: colors.error };
      case 'info':
      default: return { name: 'information-circle' as const, color: colors.primary };
    }
  };

  const iconInfo = getIcon();

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.borderStrong,
          borderRadius: radii.button,
          paddingVertical: spacing.compact,
          paddingHorizontal: spacing.normal,
          transform: [{ translateY }],
          opacity,
          ...shadows.elevated,
        },
        style,
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleDismiss}
        style={styles.content}
      >
        <Ionicons
          name={iconInfo.name}
          size={20}
          color={iconInfo.color}
          style={{ marginRight: spacing.tight }}
        />
        <Text
          numberOfLines={2}
          style={[
            styles.message,
            typography.sm,
            { color: colors.text },
          ]}
        >
          {message}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  message: {
    flex: 1,
    fontWeight: '600',
  },
});
