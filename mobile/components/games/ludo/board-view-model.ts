/**
 * Semester Library Games Platform - Ludo Board Presentation View Model
 *
 * Pure presentation helper that maps engine state and seat configuration into
 * renderable 15x15 grid data, token positions, stacking offsets, and yard states.
 *
 * Source of truth: @semester-library/ludo-engine
 */

import {
  PLAYER_COLORS,
  TOTAL_TRACK_CELLS,
  SAFE_TRACK_CELLS,
  START_OFFSETS,
  isSafeCell,
  progressToBoardPosition,
  getLogicalGridCoordinates,
  TRACK_CELL_GRID_COORDINATES,
  HOME_STRETCH_GRID_COORDINATES,
  FINISH_GRID_COORDINATES,
  YARD_GRID_COORDINATES,
  type PlayerColor,
  type CanonicalBoardPosition,
  type LudoState,
  type BotDifficulty,
} from '../../../../packages/ludo-engine/src/index.ts';

import type {
  LocalSeatConfig,
  LocalLudoSessionSnapshot,
} from '../../../types/ludo-session.ts';

export interface GridCoordinate {
  x: number; // 0..14
  y: number; // 0..14
}

export interface BoardTokenViewModel {
  color: PlayerColor;
  tokenIndex: number; // 0..3
  progress: number; // -1..56
  logicalPosition: CanonicalBoardPosition;
  gridCoordinate: GridCoordinate;
  accessibilityLabel: string;
  isSelectable: boolean;
  // Stacking layout within cell
  stackIndex: number;
  stackSize: number;
  offsetXRatio: number; // relative to cell size (-0.5..0.5)
  offsetYRatio: number;
  scaleRatio: number; // sizing multiplier (e.g. 0.72 down to 0.42)
}

export interface CellTrackInfo {
  trackIndex: number; // 0..51
  isSafe: boolean;
  isStart: boolean;
  startColor?: PlayerColor;
  isStar: boolean;
}

export interface CellStretchInfo {
  color: PlayerColor;
  stretchIndex: number; // 0..4
}

export interface BoardCellViewModel {
  x: number;
  y: number;
  type: 'track' | 'stretch' | 'yard' | 'center' | 'empty';
  trackInfo?: CellTrackInfo;
  stretchInfo?: CellStretchInfo;
  yardColor?: PlayerColor;
  centerColor?: PlayerColor;
}

export interface YardQuadrantViewModel {
  color: PlayerColor;
  status: 'active' | 'closed';
  playerType: 'human' | 'bot';
  displayName: string;
  isCurrentTurn: boolean;
  // Quadrant bounds (inclusive)
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  tokenSlots: GridCoordinate[];
}

export interface LudoBoardViewModel {
  boardSizeCells: 15;
  cells: BoardCellViewModel[][]; // 15x15 matrix
  yards: Record<PlayerColor, YardQuadrantViewModel>;
  tokens: BoardTokenViewModel[];
  tokensByCellKey: Record<string, BoardTokenViewModel[]>;
  activeColors: PlayerColor[];
  closedColors: PlayerColor[];
  currentTurn: PlayerColor | null;
  winner: PlayerColor | null;
  rankings: PlayerColor[];
  isFinished: boolean;
}

/**
 * Returns deterministic within-cell offset ratios based on stack index and total stack size.
 */
export function getStackOffset(
  stackIndex: number,
  stackSize: number
): { offsetXRatio: number; offsetYRatio: number; scaleRatio: number } {
  if (stackSize <= 1) {
    return { offsetXRatio: 0, offsetYRatio: 0, scaleRatio: 1.0 };
  }

  if (stackSize === 2) {
    // Diagonal arrangement
    const offsets = [
      { offsetXRatio: -0.16, offsetYRatio: -0.16, scaleRatio: 0.74 },
      { offsetXRatio: +0.16, offsetYRatio: +0.16, scaleRatio: 0.74 },
    ];
    return offsets[stackIndex % 2];
  }

  if (stackSize === 3) {
    // Triangle arrangement
    const offsets = [
      { offsetXRatio: 0, offsetYRatio: -0.18, scaleRatio: 0.62 },
      { offsetXRatio: -0.18, offsetYRatio: +0.16, scaleRatio: 0.62 },
      { offsetXRatio: +0.18, offsetYRatio: +0.16, scaleRatio: 0.62 },
    ];
    return offsets[stackIndex % 3];
  }

  // 4 or more: 2x2 grid
  const offsets = [
    { offsetXRatio: -0.18, offsetYRatio: -0.18, scaleRatio: 0.56 },
    { offsetXRatio: +0.18, offsetYRatio: -0.18, scaleRatio: 0.56 },
    { offsetXRatio: -0.18, offsetYRatio: +0.18, scaleRatio: 0.56 },
    { offsetXRatio: +0.18, offsetYRatio: +0.18, scaleRatio: 0.56 },
  ];
  return offsets[stackIndex % 4];
}

/**
 * Generates cell coordinate key "x,y"
 */
export function getCoordKey(coord: GridCoordinate): string {
  return `${coord.x},${coord.y}`;
}

/**
 * Checks if a coordinate is within a yard quadrant (6x6 area).
 */
export function getQuadrantForCoord(x: number, y: number): PlayerColor | null {
  if (x >= 0 && x <= 5 && y >= 0 && y <= 5) return 'red';
  if (x >= 9 && x <= 14 && y >= 0 && y <= 5) return 'green';
  if (x >= 9 && x <= 14 && y >= 9 && y <= 14) return 'yellow';
  if (x >= 0 && x <= 5 && y >= 9 && y <= 14) return 'blue';
  return null;
}

/**
 * Builds static 15x15 board cell matrix.
 */
export function buildStaticBoardCells(): BoardCellViewModel[][] {
  const matrix: BoardCellViewModel[][] = [];

  // Build lookups for fast cell classification
  const trackCoordMap = new Map<string, number>();
  TRACK_CELL_GRID_COORDINATES.forEach((c, idx) => {
    trackCoordMap.set(`${c.x},${c.y}`, idx);
  });

  const stretchCoordMap = new Map<string, { color: PlayerColor; stretchIndex: number }>();
  for (const color of PLAYER_COLORS) {
    HOME_STRETCH_GRID_COORDINATES[color].forEach((c, idx) => {
      stretchCoordMap.set(`${c.x},${c.y}`, { color, stretchIndex: idx });
    });
  }

  const startTrackIndices: Record<PlayerColor, number> = {
    red: START_OFFSETS.red,
    green: START_OFFSETS.green,
    yellow: START_OFFSETS.yellow,
    blue: START_OFFSETS.blue,
  };

  const startTrackMap = new Map<number, PlayerColor>();
  for (const color of PLAYER_COLORS) {
    startTrackMap.set(startTrackIndices[color], color);
  }

  // Star cells are safe cells that are NOT start cells
  const starCellSet = new Set<number>([8, 21, 34, 47]);

  for (let y = 0; y < 15; y++) {
    const row: BoardCellViewModel[] = [];
    for (let x = 0; x < 15; x++) {
      const key = `${x},${y}`;

      // 1. Center finish zone (rows 6..8, cols 6..8)
      if (x >= 6 && x <= 8 && y >= 6 && y <= 8) {
        // Individual color finish triangle destinations:
        let centerColor: PlayerColor | undefined = undefined;
        if (x === 6 && y === 7) centerColor = 'red';
        else if (x === 7 && y === 6) centerColor = 'green';
        else if (x === 8 && y === 7) centerColor = 'yellow';
        else if (x === 7 && y === 8) centerColor = 'blue';

        row.push({
          x,
          y,
          type: 'center',
          centerColor,
        });
        continue;
      }

      // 2. Track cells
      if (trackCoordMap.has(key)) {
        const trackIndex = trackCoordMap.get(key)!;
        const isStart = startTrackMap.has(trackIndex);
        const startColor = startTrackMap.get(trackIndex);
        const isStar = starCellSet.has(trackIndex);

        row.push({
          x,
          y,
          type: 'track',
          trackInfo: {
            trackIndex,
            isSafe: isSafeCell(trackIndex),
            isStart,
            startColor,
            isStar,
          },
        });
        continue;
      }

      // 3. Home Stretch cells
      if (stretchCoordMap.has(key)) {
        const stretchData = stretchCoordMap.get(key)!;
        row.push({
          x,
          y,
          type: 'stretch',
          stretchInfo: stretchData,
        });
        continue;
      }

      // 4. Yard quadrants (6x6 corners)
      const quadColor = getQuadrantForCoord(x, y);
      if (quadColor) {
        row.push({
          x,
          y,
          type: 'yard',
          yardColor: quadColor,
        });
        continue;
      }

      // 5. Empty
      row.push({
        x,
        y,
        type: 'empty',
      });
    }
    matrix.push(row);
  }

  return matrix;
}

// Cached static cell matrix (never changes)
const STATIC_BOARD_CELLS = buildStaticBoardCells();

export interface GenericSeatPresentation {
  color: PlayerColor;
  status: 'human' | 'bot' | 'closed' | 'open';
  displayName?: string | null;
  botDifficulty?: BotDifficulty | string | null;
  isYou?: boolean;
  isOnline?: boolean;
}

export interface BuildBoardViewModelParams {
  engineState: {
    status: 'playing' | 'finished' | string;
    tokens: Record<PlayerColor, number[] | [number, number, number, number]>;
    activeColors?: PlayerColor[];
    currentTurn?: PlayerColor | null;
    turnPhase?: any;
    legalMoves?: { tokenIndex: number }[] | number[];
    rankings?: PlayerColor[];
    winner?: PlayerColor | null;
  };
  seats: GenericSeatPresentation[] | Record<PlayerColor, GenericSeatPresentation>;
  selectableTokenIds?: number[];
  currentTurn?: PlayerColor | null;
  winner?: PlayerColor | null;
  rankings?: PlayerColor[];
}

/**
 * Builds the complete renderable board view model from arbitrary engine state and seat configuration.
 * Pure, deterministic, zero side-effects.
 */
export function buildLudoBoardViewModelFromState(
  params: BuildBoardViewModelParams
): LudoBoardViewModel {
  const { engineState, seats, selectableTokenIds = [] } = params;
  const currentTurn = params.currentTurn ?? engineState.currentTurn ?? null;
  const winner = params.winner ?? engineState.winner ?? null;
  const rankings = params.rankings ?? engineState.rankings ?? [];

  // Normalize seat map
  const activeColors: PlayerColor[] = [];
  const closedColors: PlayerColor[] = [];
  const seatMap = new Map<PlayerColor, GenericSeatPresentation>();

  if (Array.isArray(seats)) {
    for (const seat of seats) {
      seatMap.set(seat.color, seat);
      if (seat.status === 'closed') {
        closedColors.push(seat.color);
      } else {
        activeColors.push(seat.color);
      }
    }
  } else {
    for (const color of PLAYER_COLORS) {
      const seat = seats[color] || { color, status: 'closed', displayName: null };
      seatMap.set(color, seat);
      if (seat.status === 'closed') {
        closedColors.push(color);
      } else {
        activeColors.push(color);
      }
    }
  }

  // Ensure all colors are represented in seatMap
  for (const color of PLAYER_COLORS) {
    if (!seatMap.has(color)) {
      seatMap.set(color, { color, status: 'closed', displayName: null });
      if (!closedColors.includes(color)) closedColors.push(color);
    }
  }

  // 1. Build Yard View Models
  const quadrantBounds: Record<PlayerColor, { minX: number; maxX: number; minY: number; maxY: number }> = {
    red: { minX: 0, maxX: 5, minY: 0, maxY: 5 },
    green: { minX: 9, maxX: 14, minY: 0, maxY: 5 },
    yellow: { minX: 9, maxX: 14, minY: 9, maxY: 14 },
    blue: { minX: 0, maxX: 5, minY: 9, maxY: 14 },
  };

  const yards = {} as Record<PlayerColor, YardQuadrantViewModel>;

  for (const color of PLAYER_COLORS) {
    const seat = seatMap.get(color)!;
    const isClosed = seat.status === 'closed';

    yards[color] = {
      color,
      status: isClosed ? 'closed' : 'active',
      playerType: seat.status === 'bot' ? 'bot' : 'human',
      displayName: seat.displayName || color.toUpperCase(),
      isCurrentTurn: !isClosed && currentTurn === color && engineState.status === 'playing',
      bounds: quadrantBounds[color],
      tokenSlots: [...YARD_GRID_COORDINATES[color]],
    };
  }

  // 2. Collect tokens for all active players
  const rawTokens: {
    color: PlayerColor;
    tokenIndex: number;
    progress: number;
    logicalPosition: CanonicalBoardPosition;
    gridCoordinate: GridCoordinate;
    accessibilityLabel: string;
    isSelectable: boolean;
  }[] = [];

  for (const color of activeColors) {
    const playerTokens = engineState.tokens[color];
    if (!playerTokens) continue;

    for (let tIndex = 0; tIndex < 4; tIndex++) {
      const progress = playerTokens[tIndex];
      const logicalPos = progressToBoardPosition(color, progress, tIndex);
      const gridCoord = getLogicalGridCoordinates(logicalPos);

      const isSelectable =
        currentTurn === color &&
        selectableTokenIds.includes(tIndex);

      let locDesc = 'home';
      if (progress >= 0 && progress <= 50) locDesc = `track cell ${logicalPos.type === 'track' ? logicalPos.trackIndex : ''}`;
      else if (progress >= 51 && progress <= 55) locDesc = `home stretch ${progress - 50}`;
      else if (progress === 56) locDesc = 'finished';

      const capitalizedColor = color.charAt(0).toUpperCase() + color.slice(1);
      const accessibilityLabel = isSelectable
        ? `${capitalizedColor} token ${tIndex + 1}, ${locDesc}, selectable`
        : `${capitalizedColor} token ${tIndex + 1}, ${locDesc}`;

      rawTokens.push({
        color,
        tokenIndex: tIndex,
        progress,
        logicalPosition: logicalPos,
        gridCoordinate: gridCoord,
        accessibilityLabel,
        isSelectable,
      });
    }
  }

  // 3. Group tokens by grid coordinate for stacking layout
  const tokensByCellKey: Record<string, BoardTokenViewModel[]> = {};
  const tokensByCoordMap = new Map<string, typeof rawTokens>();

  for (const t of rawTokens) {
    const key = getCoordKey(t.gridCoordinate);
    if (!tokensByCoordMap.has(key)) {
      tokensByCoordMap.set(key, []);
    }
    tokensByCoordMap.get(key)!.push(t);
  }

  const finalTokens: BoardTokenViewModel[] = [];

  for (const [key, group] of tokensByCoordMap.entries()) {
    const stackSize = group.length;
    tokensByCellKey[key] = [];

    group.forEach((raw, idx) => {
      const stackOffset = getStackOffset(idx, stackSize);
      const model: BoardTokenViewModel = {
        ...raw,
        stackIndex: idx,
        stackSize,
        offsetXRatio: stackOffset.offsetXRatio,
        offsetYRatio: stackOffset.offsetYRatio,
        scaleRatio: stackOffset.scaleRatio,
      };

      tokensByCellKey[key].push(model);
      finalTokens.push(model);
    });
  }

  return {
    boardSizeCells: 15,
    cells: STATIC_BOARD_CELLS,
    yards,
    tokens: finalTokens,
    tokensByCellKey,
    activeColors,
    closedColors,
    currentTurn,
    winner,
    rankings,
    isFinished: engineState.status === 'finished',
  };
}

/**
 * Builds the complete renderable board view model from a local session snapshot.
 * Backwards-compatible offline wrapper.
 */
export function buildLudoBoardViewModel(
  snapshot: LocalLudoSessionSnapshot
): LudoBoardViewModel {
  const isHumanMovePhase =
    snapshot.engineState.status === 'playing' &&
    !snapshot.isBotTurn &&
    snapshot.engineState.turnPhase === 'move';

  const selectableTokenIds = isHumanMovePhase && snapshot.engineState.currentTurn
    ? snapshot.engineState.legalMoves.map((m) => m.tokenIndex)
    : [];

  return buildLudoBoardViewModelFromState({
    engineState: snapshot.engineState,
    seats: snapshot.seats,
    selectableTokenIds,
    currentTurn: snapshot.currentTurn,
    winner: snapshot.winner,
    rankings: snapshot.rankings,
  });
}
