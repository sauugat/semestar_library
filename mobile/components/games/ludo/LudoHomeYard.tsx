import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { LudoToken } from './LudoToken';
import type { YardQuadrantViewModel, BoardTokenViewModel } from './board-view-model';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const YARD_THEME: Record<
  PlayerColor,
  { primary: string; border: string; turnGlow: string }
> = {
  red: {
    primary: '#DC2626',
    border: '#991B1B',
    turnGlow: '#EF4444',
  },
  green: {
    primary: '#059669',
    border: '#065F46',
    turnGlow: '#10B981',
  },
  yellow: {
    primary: '#D97706',
    border: '#92400E',
    turnGlow: '#F59E0B',
  },
  blue: {
    primary: '#2563EB',
    border: '#1E40AF',
    turnGlow: '#3B82F6',
  },
};

export interface LudoHomeYardProps {
  yard: YardQuadrantViewModel;
  cellSize: number;
  tokens: BoardTokenViewModel[];
  isDarkTheme?: boolean;
  onTokenPress?: (tokenIndex: number) => void;
  disabled?: boolean;
}

export function LudoHomeYard({
  yard,
  cellSize,
  tokens,
  isDarkTheme,
  onTokenPress,
  disabled = false,
}: LudoHomeYardProps) {
  const theme = YARD_THEME[yard.color];
  const yardSize = cellSize * 6;
  const isClosed = yard.status === 'closed';

  // Tokens currently in yard slots (progress = -1)
  const yardTokensBySlot = new Map<number, BoardTokenViewModel>();
  for (const t of tokens) {
    if (t.color === yard.color && t.progress === -1) {
      yardTokensBySlot.set(t.tokenIndex, t);
    }
  }

  // Corner quadrant position
  const positionStyle = {
    left: yard.bounds.minX * cellSize,
    top: yard.bounds.minY * cellSize,
    width: yardSize,
    height: yardSize,
  };

  // Position for inner token arena (covers cells 1..4 in both dimensions)
  const innerArenaLeft = cellSize;
  const innerArenaTop = cellSize;
  const innerArenaSize = cellSize * 4;
  const socketSize = Math.max(16, Math.round(cellSize * 1.10));
  const socketRadius = socketSize / 2;

  return (
    <View
      style={[
        styles.yardContainer,
        positionStyle,
        {
          backgroundColor: isClosed ? '#334155' : theme.primary,
          borderColor: isClosed ? '#1F2937' : yard.isCurrentTurn ? theme.turnGlow : theme.border,
          borderWidth: yard.isCurrentTurn && !isClosed ? 2.5 : 1,
          opacity: isClosed ? 0.22 : 1.0,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${yard.color} home yard, ${isClosed ? 'closed' : yard.displayName}`}
    >
      {/* Inner Token Arena */}
      <View
        style={[
          styles.innerArena,
          {
            left: innerArenaLeft,
            top: innerArenaTop,
            width: innerArenaSize,
            height: innerArenaSize,
            backgroundColor: isClosed ? '#1E293B' : '#FFFFFF',
            borderColor: isClosed ? '#334155' : 'rgba(0, 0, 0, 0.12)',
          },
        ]}
      >
        {isClosed && (
          <View style={styles.closedBadge}>
            <Text style={styles.closedText}>
              CLOSED
            </Text>
          </View>
        )}
      </View>

      {/* 4 Proper Recessed Token Sockets positioned at canonical engine coordinates */}
      {!isClosed &&
        yard.tokenSlots.map((coord, slotIdx) => {
          const relX = coord.x - yard.bounds.minX;
          const relY = coord.y - yard.bounds.minY;
          const slotLeft = Math.round((relX + 0.5) * cellSize - socketRadius);
          const slotTop = Math.round((relY + 0.5) * cellSize - socketRadius);
          const token = yardTokensBySlot.get(slotIdx);

          return (
            <View
              key={slotIdx}
              style={[
                styles.socketOuter,
                {
                  position: 'absolute',
                  left: slotLeft,
                  top: slotTop,
                  width: socketSize,
                  height: socketSize,
                  borderRadius: socketSize / 2,
                  backgroundColor: '#E2E8F0',
                  borderColor: 'rgba(0, 0, 0, 0.14)',
                },
              ]}
            >
              {/* Recessed cavity disc */}
              <View
                style={[
                  styles.socketCavity,
                  {
                    width: Math.max(12, Math.round(socketSize * 0.82)),
                    height: Math.max(12, Math.round(socketSize * 0.82)),
                    borderRadius: socketSize / 2,
                    backgroundColor: '#CBD5E1',
                    borderColor: 'rgba(0, 0, 0, 0.10)',
                  },
                ]}
              >
                {token && (
                  <LudoToken
                    token={token}
                    cellSize={cellSize}
                    onPress={onTokenPress ? () => onTokenPress(token.tokenIndex) : undefined}
                    disabled={disabled}
                  />
                )}
              </View>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  yardContainer: {
    position: 'absolute',
    overflow: 'hidden',
  },
  innerArena: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  closedText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  socketOuter: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  socketCavity: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

