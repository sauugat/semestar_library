import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { LudoHaptics } from './ludo-haptics';

export interface LudoDiceProps {
  value: number | null; // 1..6, or null for idle
  size?: number;
  disabled?: boolean;
  isRolling?: boolean;
  isBotTurn?: boolean;
  onRollComplete?: (outcome: 'completed' | 'cancelled') => void;
  isReducedMotion?: boolean;
}

// 3x3 grid matrix coordinates: [row, col] where row in 0..2, col in 0..2
const PIP_CONFIGURATIONS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 2],
    [2, 0],
  ],
  3: [
    [0, 2],
    [1, 1],
    [2, 0],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
};

export function LudoDice({
  value,
  size = 48,
  disabled = false,
  isRolling = false,
  isBotTurn = false,
  onRollComplete,
  isReducedMotion = false,
}: LudoDiceProps) {
  const pipSize = Math.max(5, Math.round(size * 0.17));
  const borderRadius = Math.max(6, Math.round(size * 0.2));

  // Intermediate presentation-only face while dice is in mid-roll animation
  const [transientFace, setTransientFace] = useState<number | null>(null);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const isRollingRef = useRef(false);
  const activeAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isRolling && !isRollingRef.current) {
      isRollingRef.current = true;

      if (isReducedMotion) {
        // Reduced motion: subtle quick scale without rotation or pip cycling
        const reducedAnim = Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.05,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1.0,
            duration: 80,
            useNativeDriver: true,
          }),
        ]);
        activeAnimationRef.current = reducedAnim;

        reducedAnim.start(({ finished }) => {
          isRollingRef.current = false;
          setTransientFace(null);
          scaleAnim.setValue(1);
          rotateAnim.setValue(0);
          activeAnimationRef.current = null;
          if (finished) {
            if (!isBotTurn) {
              void LudoHaptics.rollSettle();
            }
            onRollComplete?.('completed');
          } else {
            onRollComplete?.('cancelled');
          }
        });
        return;
      }

      // Standard animation: rapid presentation face cycling
      let cycleCount = 0;
      intervalRef.current = setInterval(() => {
        cycleCount++;
        const randomFace = (cycleCount % 6) + 1;
        setTransientFace(randomFace);
      }, 75);

      const standardAnim = Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 0.88,
            duration: 120,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1.10,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1.0,
            duration: 180,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(rotateAnim, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: -1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: 0.6,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]);
      activeAnimationRef.current = standardAnim;

      standardAnim.start(({ finished }) => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setTransientFace(null);
        isRollingRef.current = false;
        scaleAnim.setValue(1);
        rotateAnim.setValue(0);
        activeAnimationRef.current = null;

        if (finished) {
          if (!isBotTurn) {
            void LudoHaptics.rollSettle();
          }
          onRollComplete?.('completed');
        } else {
          onRollComplete?.('cancelled');
        }
      });

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (activeAnimationRef.current) {
          activeAnimationRef.current.stop();
          activeAnimationRef.current = null;
        }
        isRollingRef.current = false;
        setTransientFace(null);
        scaleAnim.setValue(1);
        rotateAnim.setValue(0);
      };
    } else if (!isRolling && isRollingRef.current) {
      // Force-cancelled from outside
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (activeAnimationRef.current) {
        activeAnimationRef.current.stop();
        activeAnimationRef.current = null;
      }
      isRollingRef.current = false;
      setTransientFace(null);
      scaleAnim.setValue(1);
      rotateAnim.setValue(0);
    }
  }, [isRolling, isBotTurn, isReducedMotion, scaleAnim, rotateAnim, onRollComplete]);

  // Active display face: if rolling, transient face; otherwise authoritative value
  const activeValue = isRolling && transientFace !== null ? transientFace : value;
  const pips = activeValue && PIP_CONFIGURATIONS[activeValue] ? PIP_CONFIGURATIONS[activeValue] : [];

  // Determine accessibility label
  const accessibilityLabel = isRolling
    ? 'Rolling dice'
    : value && value >= 1 && value <= 6
    ? `Rolled ${value}`
    : 'Dice ready';

  const rotateDeg = rotateAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-14deg', '0deg', '14deg'],
  });

  return (
    <Animated.View
      style={[
        styles.diceBody,
        {
          width: size,
          height: size,
          borderRadius,
          opacity: disabled ? 0.6 : 1,
          transform: [
            { scale: scaleAnim },
            { rotate: rotateDeg },
          ],
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Subtle top-light inner bevel frame */}
      <View
        style={[
          styles.innerBevel,
          {
            borderRadius: borderRadius - 2,
          },
        ]}
      >
        {pips.length > 0 ? (
          // Render standard 3x3 layout
          [0, 1, 2].map((row) => (
            <View key={`row-${row}`} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const isPipActive = pips.some(([r, c]) => r === row && c === col);
                return (
                  <View
                    key={`col-${col}`}
                    style={[
                      styles.gridSlot,
                      {
                        width: pipSize + 4,
                        height: pipSize + 4,
                      },
                    ]}
                  >
                    {isPipActive && (
                      <View
                        style={[
                          styles.pipDot,
                          {
                            width: pipSize,
                            height: pipSize,
                            borderRadius: pipSize / 2,
                          },
                        ]}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          ))
        ) : (
          // Idle calm face
          <View style={styles.idleContainer}>
            <View
              style={[
                styles.idleIndicator,
                {
                  width: Math.round(size * 0.28),
                  height: Math.round(size * 0.28),
                  borderRadius: Math.round(size * 0.14),
                },
              ]}
            />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  diceBody: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  innerBevel: {
    width: '100%',
    height: '100%',
    padding: 4,
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flex: 1,
  },
  gridSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipDot: {
    backgroundColor: '#1E293B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1,
    elevation: 1,
  },
  idleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleIndicator: {
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
});
