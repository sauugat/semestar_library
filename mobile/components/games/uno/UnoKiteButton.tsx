import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Text } from '@/components/ui/Typography';

interface UnoKiteButtonProps {
  onPress: () => void;
  isActive: boolean; // True when player has 1-2 cards
  hasCalledUno?: boolean;
  disabled?: boolean;
}

export function UnoKiteButton({
  onPress,
  isActive,
  hasCalledUno = false,
  disabled,
}: UnoKiteButtonProps) {
  // Traditional Dashain Diamond Kite floating & tail wave animation
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const tailWaveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(tailWaveAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(tailWaveAnim, {
          toValue: -1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [floatAnim, tailWaveAnim]);

  useEffect(() => {
    if (isActive && !hasCalledUno) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.96,
            duration: 420,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, hasCalledUno, pulseAnim]);

  const floatTranslateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, -5],
  });

  const floatRotate = floatAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-3deg', '3deg', '-3deg'],
  });

  const tailSwing = tailWaveAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-12deg', '12deg'],
  });

  return (
    <Animated.View
      style={[
        styles.kiteContainer,
        {
          transform: [
            { translateY: floatTranslateY },
            { rotate: floatRotate },
            { scale: pulseAnim },
          ],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        disabled={disabled}
        style={styles.touchableArea}
      >
        {/* Outer Golden Aura Ring when UNO is ready to be called */}
        {isActive && !hasCalledUno && <View style={styles.activeHaloPulse} />}

        {/* Diamond Kite Body */}
        <View
          style={[
            styles.kiteDiamond,
            isActive && styles.kiteDiamondGlow,
            hasCalledUno && styles.kiteDiamondCalled,
          ]}
        >
          {/* 4 Quadrants: Crimson (TL), Amber Gold (TR), Emerald (BL), Azure (BR) */}
          <View style={styles.kiteQuadrantRow}>
            <View style={[styles.kiteSector, { backgroundColor: '#E11D48' }]} />
            <View style={[styles.kiteSector, { backgroundColor: '#F59E0B' }]} />
          </View>
          <View style={styles.kiteQuadrantRow}>
            <View style={[styles.kiteSector, { backgroundColor: '#059669' }]} />
            <View style={[styles.kiteSector, { backgroundColor: '#0284C7' }]} />
          </View>

          {/* Traditional Bamboo Spine & Crossbar Frame */}
          <View style={styles.bambooSpineVertical} />
          <View style={styles.bambooBowHorizontal} />

          {/* Center "UNO" Medallion */}
          <View style={styles.centerUnoBadge}>
            <Text style={styles.centerUnoText}>UNO!</Text>
          </View>
        </View>

        {/* Fluttering Kite Tail & Ribbons */}
        <Animated.View
          style={[
            styles.kiteTailCluster,
            { transform: [{ rotate: tailSwing }] },
          ]}
        >
          <View style={styles.tailTriangle} />
          <View style={[styles.ribbonStreamer, styles.ribbonLeft]} />
          <View style={[styles.ribbonStreamer, styles.ribbonRight]} />
        </Animated.View>

        {/* Clean English Status Pill */}
        <View
          style={[
            styles.kiteStatusPill,
            isActive && !hasCalledUno && styles.kiteStatusPillUrgent,
            hasCalledUno && styles.kiteStatusPillCalled,
          ]}
        >
          <Text style={styles.kiteStatusText}>
            {hasCalledUno ? 'SAFE ✓' : isActive ? 'TAP UNO!' : 'CALL UNO'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  kiteContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchableArea: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  activeHaloPulse: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: '#FCD34D',
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
  },
  kiteDiamond: {
    width: 56,
    height: 56,
    transform: [{ rotate: '45deg' }],
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FEF08A',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 8,
  },
  kiteDiamondGlow: {
    borderColor: '#FFFFFF',
    borderWidth: 2.5,
    shadowColor: '#F59E0B',
    shadowOpacity: 0.95,
    shadowRadius: 14,
    elevation: 14,
  },
  kiteDiamondCalled: {
    borderColor: '#34D399',
    shadowColor: '#10B981',
  },
  kiteQuadrantRow: {
    flexDirection: 'row',
    flex: 1,
    width: '100%',
  },
  kiteSector: {
    flex: 1,
    height: '100%',
  },
  bambooSpineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '48%',
    width: 2,
    backgroundColor: '#78350F',
    opacity: 0.65,
  },
  bambooBowHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '48%',
    height: 2,
    backgroundColor: '#78350F',
    opacity: 0.65,
  },
  centerUnoBadge: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1,
    borderColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    top: 7,
    left: 7,
    transform: [{ rotate: '-45deg' }],
  },
  centerUnoText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  kiteTailCluster: {
    alignItems: 'center',
    marginTop: -3,
  },
  tailTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#F59E0B',
    transform: [{ rotate: '180deg' }],
  },
  ribbonStreamer: {
    position: 'absolute',
    width: 3,
    height: 12,
    borderRadius: 1.5,
    top: 3,
  },
  ribbonLeft: {
    left: -6,
    backgroundColor: '#E11D48',
    transform: [{ rotate: '-25deg' }],
  },
  ribbonRight: {
    right: -6,
    backgroundColor: '#0284C7',
    transform: [{ rotate: '25deg' }],
  },
  kiteStatusPill: {
    marginTop: 2,
    backgroundColor: 'rgba(69, 26, 3, 0.9)',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  kiteStatusPillUrgent: {
    backgroundColor: '#DC2626',
    borderColor: '#FEF08A',
  },
  kiteStatusPillCalled: {
    backgroundColor: '#065F46',
    borderColor: '#34D399',
  },
  kiteStatusText: {
    color: '#FEF08A',
    fontSize: 8.5,
    fontWeight: '900',
  },
});
