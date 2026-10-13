/**
 * Semester Library Games Platform - Ludo Animation Utilities & Planning
 *
 * Pure, side-effect-free animation planning calculations, trajectory mapping,
 * timing constants, particle positioning, and reduced-motion adaptors.
 *
 * Source of truth: @semester-library/ludo-engine
 */

import {
  START_OFFSETS,
  YARD_GRID_COORDINATES,
  TRACK_CELL_GRID_COORDINATES,
  getTraversedCoordinates,
  type PlayerColor,
  type CanonicalBoardPosition,
} from '../../../../packages/ludo-engine/src/index.ts';

import type { LocalLudoMoveResult } from '../../../types/ludo-session.ts';

export interface LudoMoveAnimationSource {
  type?: string;
  player: PlayerColor;
  tokenId: number;
  fromProgress: number;
  toProgress: number;
  traversedCoordinates?: { x: number; y: number }[];
  capturedTokens?: { color: PlayerColor; tokenIndex: number }[];
  reachedFinish?: boolean;
  playerRanked?: boolean;
  rank?: number | null;
  gameFinished?: boolean;
}

// Timing Constants (in milliseconds)
export const LUDO_ANIMATION_CONSTANTS = {
  DICE_ROLL_DURATION_MS: 550,
  TOKEN_STEP_DURATION_MS: 110,
  TOKEN_HOP_HEIGHT_PX: 7,
  CAPTURE_RETURN_DURATION_MS: 380,
  CELEBRATION_DURATION_MS: 1400,
  BOT_THINK_DELAY_MS: 400,
  BOT_ACTION_PAUSE_MS: 300,
  AUTO_PASS_HOLD_MS: 850,
  THREE_SIXES_HOLD_MS: 950,
  HANDOFF_FADE_DURATION_MS: 250,
  REDUCED_MOTION_STEP_DURATION_MS: 30,
};

export interface PixelPoint {
  x: number;
  y: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface TokenTravelPlan {
  color: PlayerColor;
  tokenIndex: number;
  fromProgress: number;
  toProgress: number;
  stepCount: number;
  fromCoord: GridPoint;
  toCoord: GridPoint;
  traversalCoords: GridPoint[];
  pixelSteps: PixelPoint[]; // center pixel of each cell along the path
  stepDurationMs: number;
  totalDurationMs: number;
  reachedFinish: boolean;
  targetStackOffset?: { offsetXRatio: number; offsetYRatio: number };
}

export interface CaptureReturnPlan {
  color: PlayerColor;
  tokenIndex: number;
  startCoord: GridPoint;
  startPixel: PixelPoint;
  targetYardCoord: GridPoint;
  targetYardPixel: PixelPoint;
  durationMs: number;
}

export interface CelebrationParticle {
  id: string;
  colorHex: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  rotationDeg: number;
}

/**
 * Computes the duration in ms for a multi-step token movement.
 */
export function getAnimationDurationForSteps(
  stepCount: number,
  isReducedMotion: boolean = false
): number {
  if (isReducedMotion) {
    return LUDO_ANIMATION_CONSTANTS.REDUCED_MOTION_STEP_DURATION_MS;
  }
  if (stepCount <= 0) return 0;
  return Math.max(
    140,
    Math.min(stepCount * LUDO_ANIMATION_CONSTANTS.TOKEN_STEP_DURATION_MS, 800)
  );
}

/**
 * Builds the step-by-step travel plan for a moved token using authoritative
 * engine traversal data.
 */
export function buildTokenTravelPlan(
  moveResult: LudoMoveAnimationSource | LocalLudoMoveResult,
  cellSize: number,
  options: {
    isReducedMotion?: boolean;
    targetStackOffset?: { offsetXRatio: number; offsetYRatio: number };
  } = {}
): TokenTravelPlan | null {
  if (cellSize <= 0 || !Number.isFinite(cellSize)) {
    return null;
  }

  if (
    'type' in moveResult &&
    moveResult.type !== undefined &&
    moveResult.type !== 'MOVE' &&
    moveResult.type !== 'LUDO_MOVE_RESULT'
  ) {
    return null;
  }

  const color = moveResult.player;
  const tokenIndex = moveResult.tokenId;
  const fromProgress = moveResult.fromProgress;
  const toProgress = moveResult.toProgress;
  const isReducedMotion = Boolean(options.isReducedMotion);

  let fromCoord: GridPoint;
  let traversalCoords: GridPoint[] = [];

  if (fromProgress === -1) {
    // Yard -> Start square
    fromCoord = YARD_GRID_COORDINATES[color][tokenIndex % 4];
    const startCoord = TRACK_CELL_GRID_COORDINATES[START_OFFSETS[color]];
    traversalCoords = [startCoord];
  } else {
    // Normal track, stretch, or finish progression
    const coords =
      moveResult.traversedCoordinates && moveResult.traversedCoordinates.length > 0
        ? moveResult.traversedCoordinates
        : getTraversedCoordinates(color, fromProgress, toProgress);
    traversalCoords = coords;

    // Starting coordinate from initial progress
    if (fromProgress === 0) {
      fromCoord = TRACK_CELL_GRID_COORDINATES[START_OFFSETS[color]];
    } else {
      // Prior coordinate
      const prior = getTraversedCoordinates(color, fromProgress - 1, fromProgress);
      fromCoord = prior[prior.length - 1] || coords[0];
    }
  }

  if (traversalCoords.length === 0) {
    return null;
  }

  const toCoord = traversalCoords[traversalCoords.length - 1];

  // Convert each grid coordinate into its cell center pixel within the board
  const pixelSteps: PixelPoint[] = traversalCoords.map((coord) => ({
    x: (coord.x + 0.5) * cellSize,
    y: (coord.y + 0.5) * cellSize,
  }));

  const stepCount = traversalCoords.length;
  const totalDurationMs = getAnimationDurationForSteps(stepCount, isReducedMotion);
  const stepDurationMs = isReducedMotion
    ? LUDO_ANIMATION_CONSTANTS.REDUCED_MOTION_STEP_DURATION_MS
    : Math.max(60, Math.round(totalDurationMs / stepCount));

  return {
    color,
    tokenIndex,
    fromProgress,
    toProgress,
    stepCount,
    fromCoord,
    toCoord,
    traversalCoords,
    pixelSteps,
    stepDurationMs,
    totalDurationMs,
    reachedFinish: Boolean(moveResult.reachedFinish),
    targetStackOffset: options.targetStackOffset,
  };
}

/**
 * Builds the return trajectory plan for captured opponent tokens traveling back to their yards.
 */
export function buildCaptureReturnPlan(
  moveResult: LudoMoveAnimationSource | LocalLudoMoveResult,
  cellSize: number,
  options: { isReducedMotion?: boolean } = {}
): CaptureReturnPlan[] {
  if (cellSize <= 0 || !Number.isFinite(cellSize)) {
    return [];
  }

  if (!moveResult.capturedTokens || moveResult.capturedTokens.length === 0) {
    return [];
  }

  // The capture location is the target position of the moving token
  let captureCoord: GridPoint;
  if (moveResult.traversedCoordinates && moveResult.traversedCoordinates.length > 0) {
    captureCoord = moveResult.traversedCoordinates[moveResult.traversedCoordinates.length - 1];
  } else if (moveResult.toProgress !== undefined) {
    const coords = getTraversedCoordinates(
      moveResult.player,
      moveResult.fromProgress,
      moveResult.toProgress
    );
    captureCoord = coords[coords.length - 1];
  } else {
    captureCoord = { x: 7, y: 7 };
  }

  const startPixel: PixelPoint = {
    x: (captureCoord.x + 0.5) * cellSize,
    y: (captureCoord.y + 0.5) * cellSize,
  };

  const isReducedMotion = Boolean(options.isReducedMotion);
  const durationMs = isReducedMotion
    ? LUDO_ANIMATION_CONSTANTS.REDUCED_MOTION_STEP_DURATION_MS
    : LUDO_ANIMATION_CONSTANTS.CAPTURE_RETURN_DURATION_MS;

  const plans: CaptureReturnPlan[] = [];

  for (const c of moveResult.capturedTokens) {
    if (!c || !c.color || typeof c.tokenIndex !== 'number') {
      continue;
    }
    // Validate canonical tokenIndex is an integer strictly between 0 and 3
    if (!Number.isInteger(c.tokenIndex) || c.tokenIndex < 0 || c.tokenIndex > 3) {
      continue;
    }
    const colorSlots = YARD_GRID_COORDINATES[c.color];
    if (!colorSlots || !colorSlots[c.tokenIndex]) {
      continue;
    }

    const yardCoord = colorSlots[c.tokenIndex];
    const targetYardPixel: PixelPoint = {
      x: (yardCoord.x + 0.5) * cellSize,
      y: (yardCoord.y + 0.5) * cellSize,
    };

    plans.push({
      color: c.color,
      tokenIndex: c.tokenIndex,
      startCoord: captureCoord,
      startPixel,
      targetYardCoord: yardCoord,
      targetYardPixel,
      durationMs,
    });
  }

  return plans;
}

const PARTICLE_COLORS = ['#EF4444', '#10B981', '#F59E0B', '#3B82F6', '#FBBF24', '#EC4899'];

/**
 * Generates deterministic radial celebration confetti particles around the board center.
 */
export function buildCelebrationParticles(
  count: number = 18,
  boardSize: number = 360
): CelebrationParticle[] {
  const particles: CelebrationParticle[] = [];
  const centerX = boardSize / 2;
  const centerY = boardSize / 2;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const distance = (boardSize * 0.22) + ((i % 3) * (boardSize * 0.1));
    const targetX = centerX + Math.cos(angle) * distance;
    const targetY = centerY + Math.sin(angle) * distance;

    particles.push({
      id: `p-${i}`,
      colorHex: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
      startX: centerX,
      startY: centerY,
      targetX,
      targetY,
      size: 6 + (i % 4) * 2,
      rotationDeg: (i * 47) % 360,
    });
  }

  return particles;
}
