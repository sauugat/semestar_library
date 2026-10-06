import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LudoToken } from './LudoToken';
import type { BoardTokenViewModel } from './board-view-model';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const CENTER_COLORS: Record<PlayerColor, string> = {
  red: '#DC2626',
  green: '#059669',
  yellow: '#D97706',
  blue: '#2563EB',
};

export interface LudoCenterProps {
  cellSize: number;
  tokensByCellKey: Record<string, BoardTokenViewModel[]>;
}

export function LudoCenter({ cellSize, tokensByCellKey }: LudoCenterProps) {
  const centerSize = cellSize * 3;
  const half = centerSize / 2;

  // Finish tokens at canonical coordinates:
  // red: (6, 7), green: (7, 6), yellow: (8, 7), blue: (7, 8)
  const redTokens = tokensByCellKey['6,7'] || [];
  const greenTokens = tokensByCellKey['7,6'] || [];
  const yellowTokens = tokensByCellKey['8,7'] || [];
  const blueTokens = tokensByCellKey['7,8'] || [];

  const diagonal = Math.ceil(centerSize * Math.SQRT2);
  const diagonalOffset = (centerSize - diagonal) / 2;

  const hubSize = Math.max(12, Math.round(cellSize * 0.65));
  const hubRadius = hubSize / 2;

  return (
    <View
      style={[
        styles.centerContainer,
        {
          left: cellSize * 6,
          top: cellSize * 6,
          width: centerSize,
          height: centerSize,
          borderColor: '#1F2937',
          borderWidth: 1,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel="Ludo center finish area"
    >
      {/* 1. Top Triangle: Green */}
      <View
        style={[
          styles.triangle,
          {
            top: 0,
            left: 0,
            borderTopWidth: half,
            borderLeftWidth: half,
            borderRightWidth: half,
            borderTopColor: CENTER_COLORS.green,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
          },
        ]}
      />

      {/* 2. Right Triangle: Yellow */}
      <View
        style={[
          styles.triangle,
          {
            top: 0,
            right: 0,
            borderRightWidth: half,
            borderTopWidth: half,
            borderBottomWidth: half,
            borderRightColor: CENTER_COLORS.yellow,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
          },
        ]}
      />

      {/* 3. Bottom Triangle: Blue */}
      <View
        style={[
          styles.triangle,
          {
            bottom: 0,
            left: 0,
            borderBottomWidth: half,
            borderLeftWidth: half,
            borderRightWidth: half,
            borderBottomColor: CENTER_COLORS.blue,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
          },
        ]}
      />

      {/* 4. Left Triangle: Red */}
      <View
        style={[
          styles.triangle,
          {
            top: 0,
            left: 0,
            borderLeftWidth: half,
            borderTopWidth: half,
            borderBottomWidth: half,
            borderLeftColor: CENTER_COLORS.red,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
          },
        ]}
      />

      {/* Center Dividing Lines - full diagonal length */}
      <View
        style={[
          styles.dividerLine,
          {
            width: diagonal,
            height: 1,
            top: half - 0.5,
            left: diagonalOffset,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.dividerLine,
          {
            width: diagonal,
            height: 1,
            top: half - 0.5,
            left: diagonalOffset,
            transform: [{ rotate: '-45deg' }],
          },
        ]}
      />

      {/* Central Hub Medallion */}
      <View
        style={[
          styles.centerHub,
          {
            width: hubSize,
            height: hubSize,
            borderRadius: hubRadius,
            top: half - hubRadius,
            left: half - hubRadius,
          },
        ]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.centerInnerDot,
            {
              width: Math.max(4, Math.round(hubSize * 0.42)),
              height: Math.max(4, Math.round(hubSize * 0.42)),
              borderRadius: Math.round(hubSize * 0.21),
            },
          ]}
        />
      </View>

      {/* Render Finish Tokens in Each Direction (guaranteed above triangles with zIndex 10) */}
      {/* Top Finish (Green) at relative x: cellSize, y: 0 */}
      <View style={[styles.finishSector, { top: 0, left: cellSize, width: cellSize, height: cellSize }]}>
        {greenTokens.map((t) => (
          <LudoToken key={`green-${t.tokenIndex}`} token={t} cellSize={cellSize} />
        ))}
      </View>

      {/* Right Finish (Yellow) at relative x: cellSize * 2, y: cellSize */}
      <View style={[styles.finishSector, { top: cellSize, left: cellSize * 2, width: cellSize, height: cellSize }]}>
        {yellowTokens.map((t) => (
          <LudoToken key={`yellow-${t.tokenIndex}`} token={t} cellSize={cellSize} />
        ))}
      </View>

      {/* Bottom Finish (Blue) at relative x: cellSize, y: cellSize * 2 */}
      <View style={[styles.finishSector, { top: cellSize * 2, left: cellSize, width: cellSize, height: cellSize }]}>
        {blueTokens.map((t) => (
          <LudoToken key={`blue-${t.tokenIndex}`} token={t} cellSize={cellSize} />
        ))}
      </View>

      {/* Left Finish (Red) at relative x: 0, y: cellSize */}
      <View style={[styles.finishSector, { top: cellSize, left: 0, width: cellSize, height: cellSize }]}>
        {redTokens.map((t) => (
          <LudoToken key={`red-${t.tokenIndex}`} token={t} cellSize={cellSize} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    position: 'absolute',
    backgroundColor: '#0F172A',
    overflow: 'hidden',
  },
  triangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
  },
  dividerLine: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  centerHub: {
    position: 'absolute',
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  centerInnerDot: {
    backgroundColor: '#F59E0B',
  },
  finishSector: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
