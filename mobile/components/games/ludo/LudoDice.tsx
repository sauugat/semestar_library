import React from 'react';
import { View, StyleSheet } from 'react-native';

export interface LudoDiceProps {
  value: number | null; // 1..6, or null for idle
  size?: number;
  disabled?: boolean;
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

export function LudoDice({ value, size = 48, disabled = false }: LudoDiceProps) {
  const pipSize = Math.max(5, Math.round(size * 0.17));
  const borderRadius = Math.max(6, Math.round(size * 0.2));
  const pips = value && PIP_CONFIGURATIONS[value] ? PIP_CONFIGURATIONS[value] : [];

  // Determine accessibility label
  const accessibilityLabel = value && value >= 1 && value <= 6
    ? `Rolled ${value}`
    : 'Dice ready';

  return (
    <View
      style={[
        styles.diceBody,
        {
          width: size,
          height: size,
          borderRadius,
          opacity: disabled ? 0.6 : 1,
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
    </View>
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
