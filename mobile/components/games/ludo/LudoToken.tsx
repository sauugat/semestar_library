import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import type { BoardTokenViewModel } from './board-view-model';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const TOKEN_COLOR_THEME: Record<
  PlayerColor,
  { fill: string; rim: string; innerBorder: string; shadow: string }
> = {
  red: {
    fill: '#E11D48',
    rim: '#881337',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(136, 19, 55, 0.40)',
  },
  green: {
    fill: '#10B981',
    rim: '#064E3B',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(6, 78, 59, 0.40)',
  },
  yellow: {
    fill: '#F59E0B',
    rim: '#78350F',
    innerBorder: 'rgba(255, 255, 255, 0.50)',
    shadow: 'rgba(120, 53, 15, 0.45)',
  },
  blue: {
    fill: '#3B82F6',
    rim: '#1E3A8A',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(30, 58, 138, 0.40)',
  },
};

export interface LudoTokenProps {
  token: BoardTokenViewModel;
  cellSize: number;
  onPress?: () => void;
  disabled?: boolean;
}

export function LudoToken({ token, cellSize, onPress, disabled = false }: LudoTokenProps) {
  const theme = TOKEN_COLOR_THEME[token.color];

  const isInteractive = token.isSelectable && !disabled && Boolean(onPress);

  // Base token diameter when alone in a cell is ~74% of cell size
  const baseDiameter = cellSize * 0.74;
  const scaleBoost = token.isSelectable ? 1.06 : 1.0;
  const tokenDiameter = Math.max(13, Math.round(baseDiameter * token.scaleRatio * scaleBoost));
  const innerDiscSize = Math.max(6, Math.round(tokenDiameter * 0.54));
  const highlightWidth = Math.max(3, Math.round(tokenDiameter * 0.24));
  const highlightHeight = Math.max(2, Math.round(tokenDiameter * 0.12));

  // Offset inside the cell
  const pixelOffsetX = token.offsetXRatio * cellSize;
  const pixelOffsetY = token.offsetYRatio * cellSize;

  const content = (
    <>
      {/* Selection indicator ring when token is legal to move */}
      {token.isSelectable && (
        <View
          style={[
            styles.selectionHalo,
            {
              width: tokenDiameter + 8,
              height: tokenDiameter + 8,
              borderRadius: (tokenDiameter + 8) / 2,
            },
          ]}
        />
      )}

      {/* 1. Base disc with dark contrasting rim and drop shadow */}
      <View
        style={[
          styles.outerRimDisc,
          {
            width: tokenDiameter,
            height: tokenDiameter,
            borderRadius: tokenDiameter / 2,
            backgroundColor: theme.rim,
            shadowColor: theme.shadow,
            borderWidth: token.isSelectable ? 2 : 0,
            borderColor: '#FFFFFF',
          },
        ]}
      >
        {/* 2. Main color body */}
        <View
          style={[
            styles.mainBodyDisc,
            {
              width: tokenDiameter - Math.max(2, Math.round(tokenDiameter * 0.15)),
              height: tokenDiameter - Math.max(2, Math.round(tokenDiameter * 0.15)),
              borderRadius: tokenDiameter / 2,
              backgroundColor: theme.fill,
            },
          ]}
        >
          {/* 3. Concentric inner bevel plate */}
          <View
            style={[
              styles.innerBevelPlate,
              {
                width: innerDiscSize,
                height: innerDiscSize,
                borderRadius: innerDiscSize / 2,
                borderColor: theme.innerBorder,
                backgroundColor: 'rgba(255, 255, 255, 0.16)',
              },
            ]}
          >
            {/* 4. Soft micro-highlight */}
            <View
              style={[
                styles.highlightArc,
                {
                  width: highlightWidth,
                  height: highlightHeight,
                  borderRadius: highlightHeight / 2,
                },
              ]}
            />
          </View>
        </View>
      </View>
    </>
  );

  if (isInteractive) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        style={[
          styles.tokenWrapper,
          {
            width: tokenDiameter,
            height: tokenDiameter,
            transform: [
              { translateX: pixelOffsetX },
              { translateY: pixelOffsetY },
            ],
            zIndex: 30, // Elevated above non-interactive elements
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={token.accessibilityLabel}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.tokenWrapper,
        {
          width: tokenDiameter,
          height: tokenDiameter,
          transform: [
            { translateX: pixelOffsetX },
            { translateY: pixelOffsetY },
          ],
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={token.accessibilityLabel}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  tokenWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  outerRimDisc: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.38,
    shadowRadius: 2.5,
    elevation: 4,
  },
  mainBodyDisc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerBevelPlate: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  highlightArc: {
    position: 'absolute',
    top: 1,
    left: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
  selectionHalo: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 4,
  },
});
