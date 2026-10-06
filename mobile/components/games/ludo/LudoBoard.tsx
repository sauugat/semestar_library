import React, { useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '@/constants/useTheme';
import { buildLudoBoardViewModel, type LudoBoardViewModel, type BoardTokenViewModel } from './board-view-model';
import { LudoHomeYard } from './LudoHomeYard';
import { LudoCenter } from './LudoCenter';
import { LudoCell } from './LudoCell';
import { LudoAnimatedOverlay } from './LudoAnimatedOverlay';
import type { LocalLudoSessionSnapshot, PlayerColor } from '../../../types/ludo-session';
import type { TokenTravelPlan, CaptureReturnPlan } from './ludo-animation';

export interface LudoBoardProps {
  snapshot: LocalLudoSessionSnapshot;
  maxBoardSize?: number;
  onTokenPress?: (tokenIndex: number) => void;
  disabled?: boolean;
  hiddenTokenKeys?: string[];
  travelPlan?: TokenTravelPlan | null;
  capturePlans?: CaptureReturnPlan[];
  celebrationRank?: { color: PlayerColor; rank: number; displayName: string } | null;
  showWinnerCelebration?: boolean;
  isReducedMotion?: boolean;
  onTravelComplete?: (outcome: 'completed' | 'cancelled') => void;
  onCaptureComplete?: (outcome: 'completed' | 'cancelled') => void;
  onCelebrationComplete?: (outcome: 'completed' | 'cancelled') => void;
  onWinnerCelebrationComplete?: (outcome: 'completed' | 'cancelled') => void;
}

export function LudoBoard({
  snapshot,
  maxBoardSize = 430,
  onTokenPress,
  disabled = false,
  hiddenTokenKeys = [],
  travelPlan = null,
  capturePlans = [],
  celebrationRank = null,
  showWinnerCelebration = false,
  isReducedMotion = false,
  onTravelComplete,
  onCaptureComplete,
  onCelebrationComplete,
  onWinnerCelebrationComplete,
}: LudoBoardProps) {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();

  // Responsive board sizing: maximize presence using 20px safe total margin
  const horizontalPadding = 20;
  const targetWidth = Math.min(width - horizontalPadding, maxBoardSize);
  const boardSize = Math.floor(targetWidth);
  const cellSize = boardSize / 15;

  // Pure presentation view model
  const baseViewModel: LudoBoardViewModel = useMemo(() => {
    return buildLudoBoardViewModel(snapshot);
  }, [snapshot]);

  // Ghost/hide any tokens currently active in the animation layer
  const viewModel: LudoBoardViewModel = useMemo(() => {
    if (!hiddenTokenKeys || hiddenTokenKeys.length === 0) {
      return baseViewModel;
    }

    const hiddenSet = new Set(hiddenTokenKeys);
    const filteredTokens = baseViewModel.tokens.filter(
      (t) => !hiddenSet.has(`${t.color}-${t.tokenIndex}`)
    );

    const filteredTokensByCellKey: Record<string, BoardTokenViewModel[]> = {};
    for (const [cellKey, tokenList] of Object.entries(baseViewModel.tokensByCellKey)) {
      filteredTokensByCellKey[cellKey] = tokenList.filter(
        (t) => !hiddenSet.has(`${t.color}-${t.tokenIndex}`)
      );
    }

    return {
      ...baseViewModel,
      tokens: filteredTokens,
      tokensByCellKey: filteredTokensByCellKey,
    };
  }, [baseViewModel, hiddenTokenKeys]);

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
              onTokenPress={onTokenPress}
              disabled={disabled}
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
        onTokenPress={onTokenPress}
        disabled={disabled}
      />
      <LudoHomeYard
        yard={viewModel.yards.green}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
        onTokenPress={onTokenPress}
        disabled={disabled}
      />
      <LudoHomeYard
        yard={viewModel.yards.yellow}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
        onTokenPress={onTokenPress}
        disabled={disabled}
      />
      <LudoHomeYard
        yard={viewModel.yards.blue}
        cellSize={cellSize}
        tokens={viewModel.tokens}
        isDarkTheme={isDark}
        onTokenPress={onTokenPress}
        disabled={disabled}
      />

      {/* 3. Center 3x3 Finish Area */}
      <LudoCenter
        cellSize={cellSize}
        tokensByCellKey={viewModel.tokensByCellKey}
      />

      {/* 4. Animation Overlay Layer (Traveling tokens, captured returns, particles, rank toasts) */}
      <LudoAnimatedOverlay
        boardSize={boardSize}
        cellSize={cellSize}
        travelPlan={travelPlan}
        capturePlans={capturePlans}
        celebrationRank={celebrationRank}
        showWinnerCelebration={showWinnerCelebration}
        winnerColor={viewModel.winner}
        isReducedMotion={isReducedMotion}
        onTravelComplete={onTravelComplete}
        onCaptureComplete={onCaptureComplete}
        onCelebrationComplete={onCelebrationComplete}
        onWinnerCelebrationComplete={onWinnerCelebrationComplete}
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
