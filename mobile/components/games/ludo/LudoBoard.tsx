import React, { useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '@/constants/useTheme';
import { buildLudoBoardViewModel, type LudoBoardViewModel } from './board-view-model';
import { LudoHomeYard } from './LudoHomeYard';
import { LudoCenter } from './LudoCenter';
import { LudoCell } from './LudoCell';
import type { LocalLudoSessionSnapshot } from '../../../types/ludo-session';

export interface LudoBoardProps {
  snapshot: LocalLudoSessionSnapshot;
  maxBoardSize?: number;
}

export function LudoBoard({ snapshot, maxBoardSize = 430 }: LudoBoardProps) {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();

  // Responsive board sizing: maximize presence using 20px safe total margin
  const horizontalPadding = 20;
  const targetWidth = Math.min(width - horizontalPadding, maxBoardSize);
  const boardSize = Math.floor(targetWidth);
  const cellSize = boardSize / 15;

  // Pure presentation view model
  const viewModel: LudoBoardViewModel = useMemo(() => {
    return buildLudoBoardViewModel(snapshot);
  }, [snapshot]);

  return (
    <View
      style={[
        styles.boardOuterWrapper,
        {
          width: boardSize,
          height: boardSize,
          backgroundColor: isDark ? '#0F172A' : '#E2E8F0',
          borderColor: isDark ? '#334155' : '#94A3B8',
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel="Ludo 15 by 15 board"
    >
      {/* 1. Track & Stretch Cells (arms) */}
      {viewModel.cells.map((row, y) =>
        row.map((cell, x) => {
          if (cell.type === 'yard' || cell.type === 'center' || cell.type === 'empty') {
            return null;
          }
          const cellKey = `${x},${y}`;
          const tokensOnCell = viewModel.tokensByCellKey[cellKey] || [];

          return (
            <LudoCell
              key={cellKey}
              cell={cell}
              cellSize={cellSize}
              tokens={tokensOnCell}
              isDarkTheme={isDark}
            />
          );
        })
      )}

      {/* 2. Four 6x6 Home Yards (Red: TL, Green: TR, Yellow: BR, Blue: BL) */}
      <LudoHomeYard
        yard={viewModel.yards.red}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
      />
      <LudoHomeYard
        yard={viewModel.yards.green}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
      />
      <LudoHomeYard
        yard={viewModel.yards.yellow}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
      />
      <LudoHomeYard
        yard={viewModel.yards.blue}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
      />

      {/* 3. Center 3x3 Finish Area */}
      <LudoCenter
        cellSize={cellSize}
        tokensByCellKey={viewModel.tokensByCellKey}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  boardOuterWrapper: {
    position: 'relative',
    borderRadius: 14,
    borderWidth: 2,
    overflow: 'hidden',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
});
