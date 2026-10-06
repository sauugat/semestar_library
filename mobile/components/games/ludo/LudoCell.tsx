import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LudoToken } from './LudoToken';
import type { BoardCellViewModel, BoardTokenViewModel } from './board-view-model';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const COLOR_MAP: Record<PlayerColor, string> = {
  red: '#DC2626',
  green: '#059669',
  yellow: '#D97706',
  blue: '#2563EB',
};

export interface LudoCellProps {
  cell: BoardCellViewModel;
  cellSize: number;
  tokens: BoardTokenViewModel[];
  isDarkTheme?: boolean;
  onTokenPress?: (tokenIndex: number) => void;
  disabled?: boolean;
}

export function LudoCell({
  cell,
  cellSize,
  tokens,
  isDarkTheme,
  onTokenPress,
  disabled = false,
}: LudoCellProps) {
  // If cell is inside a 6x6 yard or 3x3 center, LudoHomeYard or LudoCenter renders it
  if (cell.type === 'yard' || cell.type === 'center' || cell.type === 'empty') {
    return null;
  }

  const isTrack = cell.type === 'track';
  const trackInfo = cell.trackInfo;
  const stretchInfo = cell.stretchInfo;

  // Premium tactile light-neutral surface for the shared track
  let backgroundColor = '#EAECEF';
  let isStart = false;
  let isStar = false;
  let startColor: PlayerColor | undefined = undefined;

  if (isTrack && trackInfo) {
    if (trackInfo.isStart && trackInfo.startColor) {
      isStart = true;
      startColor = trackInfo.startColor;
      backgroundColor = COLOR_MAP[trackInfo.startColor];
    } else if (trackInfo.isStar) {
      isStar = true;
      backgroundColor = '#D9DFEC'; // Subtle tinted safe plate
    }
  } else if (cell.type === 'stretch' && stretchInfo) {
    backgroundColor = COLOR_MAP[stretchInfo.color];
  }

  const borderColor = '#CBD2DE';

  return (
    <View
      style={[
        styles.cellContainer,
        {
          left: cell.x * cellSize,
          top: cell.y * cellSize,
          width: cellSize,
          height: cellSize,
          backgroundColor,
          borderColor,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        isTrack
          ? `Track cell ${trackInfo?.trackIndex}${trackInfo?.isSafe ? ', safe' : ''}`
          : cell.type === 'stretch'
          ? `${stretchInfo?.color} home stretch ${stretchInfo?.stretchIndex}`
          : undefined
      }
    >
      {/* Home stretch inner inset plate for visual progression */}
      {cell.type === 'stretch' && (
        <View style={styles.stretchInset} pointerEvents="none" />
      )}

      {/* Prominent Star / Safe Icon on Star Cells */}
      {isStar && (
        <View style={styles.iconContainer} pointerEvents="none">
          <Ionicons
            name="star"
            size={Math.max(12, Math.round(cellSize * 0.52))}
            color="#475569"
          />
        </View>
      )}

      {/* Start Cell Concentric Emblem */}
      {isStart && startColor && (
        <View style={styles.iconContainer} pointerEvents="none">
          <View
            style={[
              styles.startEmblemRing,
              {
                width: Math.max(12, Math.round(cellSize * 0.58)),
                height: Math.max(12, Math.round(cellSize * 0.58)),
                borderRadius: Math.round(cellSize * 0.29),
              },
            ]}
          >
            <View
              style={[
                styles.startDot,
                {
                  width: Math.max(4, Math.round(cellSize * 0.22)),
                  height: Math.max(4, Math.round(cellSize * 0.22)),
                  borderRadius: Math.round(cellSize * 0.11),
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Tokens occupying this cell */}
      {tokens.map((token) => (
        <LudoToken
          key={`${token.color}-${token.tokenIndex}`}
          token={token}
          cellSize={cellSize}
          onPress={onTokenPress ? () => onTokenPress(token.tokenIndex) : undefined}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cellContainer: {
    position: 'absolute',
    borderWidth: 0.75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stretchInset: {
    ...StyleSheet.absoluteFill,
    margin: 1.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  iconContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  startEmblemRing: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.90)',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startDot: {
    backgroundColor: '#FFFFFF',
  },
});
