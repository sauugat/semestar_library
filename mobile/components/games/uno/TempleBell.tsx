import React, { useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { playUnoSfx } from './uno-sfx';

interface TempleBellProps {
  onPress?: () => void;
  size?: number;
}

export function TempleBell({ onPress, size = 24 }: TempleBellProps) {
  const swingAnim = useRef(new Animated.Value(0)).current;
  const rippleScale = useRef(new Animated.Value(0.6)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const triggerRing = () => {
    playUnoSfx('bell_chime');
    if (onPress) onPress();

    // Harmonic Pashupatinath bronze bell swinging physics + sonic ripple
    swingAnim.setValue(0);
    rippleScale.setValue(0.6);
    rippleOpacity.setValue(0.9);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(swingAnim, { toValue: -1, duration: 110, useNativeDriver: true }),
        Animated.timing(swingAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(swingAnim, { toValue: -0.7, duration: 160, useNativeDriver: true }),
        Animated.timing(swingAnim, { toValue: 0.45, duration: 140, useNativeDriver: true }),
        Animated.timing(swingAnim, { toValue: -0.2, duration: 120, useNativeDriver: true }),
        Animated.timing(swingAnim, { toValue: 0, duration: 110, useNativeDriver: true }),
      ]),
      Animated.timing(rippleScale, {
        toValue: 2.1,
        duration: 620,
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 620,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const bellRotation = swingAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-22deg', '22deg'],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={triggerRing}
      style={styles.bellTouch}
      accessibilityLabel="Ring Nepali Temple Bell (मन्दिरको घण्टी)"
    >
      {/* Sonic Chime Ripple Ring */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sonicRippleRing,
          {
            opacity: rippleOpacity,
            transform: [{ scale: rippleScale }],
          },
        ]}
      />

      {/* Brass Chain Mount */}
      <View style={styles.brassMountCap} />
      <View style={styles.hangingRope} />

      {/* Swinging Brass Bell */}
      <Animated.View
        style={[
          styles.bellBody,
          {
            transform: [{ rotate: bellRotation }],
          },
        ]}
      >
        <Ionicons name="notifications" size={size} color="#FBBF24" />
        <View style={styles.bellClapper} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
    position: 'relative',
  },
  sonicRippleRing: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.8,
    borderColor: '#FDE047',
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
  },
  brassMountCap: {
    width: 8,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#D97706',
  },
  hangingRope: {
    width: 2,
    height: 7,
    backgroundColor: '#B45309',
  },
  bellBody: {
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.65,
    shadowRadius: 5,
    elevation: 4,
  },
  bellClapper: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FEF08A',
    marginTop: -2,
    borderWidth: 0.8,
    borderColor: '#92400E',
  },
});
