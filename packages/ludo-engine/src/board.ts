/**
 * Semester Library Games Platform - Canonical Ludo Board
 *
 * Defines the canonical 52-cell outer track, color start offsets,
 * safe cells, home stretch, and logical 15x15 grid mapping.
 */

import type {
  PlayerColor,
  CanonicalBoardPosition,
} from './types.ts';

export const TOTAL_TRACK_CELLS = 52;

export const HOME_PROGRESS = -1;
export const START_PROGRESS = 0;
export const TRACK_END_PROGRESS = 50; // 51 track positions (0..50)
export const STRETCH_START_PROGRESS = 51;
export const STRETCH_END_PROGRESS = 55; // 5 stretch positions (0..4)
export const FINISH_PROGRESS = 56;
export const TOTAL_STEPS = 56;

export const START_OFFSETS: Record<PlayerColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

/**
 * 8 Canonical safe cells on the 52-cell track:
 * - 4 Start squares: 0 (Red), 13 (Green), 26 (Yellow), 39 (Blue).
 *   Safe because newly deployed tokens entering play must not be immediately captured upon entry.
 * - 4 Star/Globe squares: 8, 21, 34, 47 (each exactly 8 steps after a start square).
 *   Traditional Pachisi/Ludo rest sanctuaries offering tactical refuge on the shared ring.
 */
export const SAFE_TRACK_CELLS: readonly number[] = [
  0, 8, 13, 21, 26, 34, 39, 47,
] as const;

const SAFE_CELL_SET = new Set<number>(SAFE_TRACK_CELLS);

/**
 * Checks if a track cell index (0..51) is a safe cell.
 */
export function isSafeCell(trackIndex: number): boolean {
  return SAFE_CELL_SET.has(trackIndex);
}

/**
 * Gets start offset on shared track for a given color.
 */
export function getStartOffset(color: PlayerColor): number {
  return START_OFFSETS[color];
}

/**
 * Converts a player's color and token progress into a track cell index (0..51).
 * Returns null if token is at home, in home stretch, or finished.
 */
export function progressToTrackCell(
  color: PlayerColor,
  progress: number
): number | null {
  if (progress < START_PROGRESS || progress > TRACK_END_PROGRESS) {
    return null;
  }
  const offset = START_OFFSETS[color];
  return (offset + progress) % TOTAL_TRACK_CELLS;
}

/**
 * Maps player color and logical token progress (-1..56) to canonical board position.
 */
export function progressToBoardPosition(
  color: PlayerColor,
  progress: number,
  tokenIndex: number = 0
): CanonicalBoardPosition {
  if (progress === HOME_PROGRESS) {
    return { type: 'home', color, tokenIndex };
  }

  if (progress >= START_PROGRESS && progress <= TRACK_END_PROGRESS) {
    const trackIndex = (START_OFFSETS[color] + progress) % TOTAL_TRACK_CELLS;
    return {
      type: 'track',
      trackIndex,
      isSafe: isSafeCell(trackIndex),
    };
  }

  if (progress >= STRETCH_START_PROGRESS && progress <= STRETCH_END_PROGRESS) {
    return {
      type: 'stretch',
      color,
      stretchIndex: progress - STRETCH_START_PROGRESS,
    };
  }

  if (progress === FINISH_PROGRESS) {
    return { type: 'finish', color };
  }

  throw new Error(`Invalid token progress value: ${progress}. Must be between -1 and 56.`);
}

/**
 * 15x15 standard Ludo board coordinates mapping for all 52 track cells.
 * (x: 0..14 column from left to right, y: 0..14 row from top to bottom)
 */
export const TRACK_CELL_GRID_COORDINATES: readonly { x: number; y: number }[] = [
  /* 0 - Red Start */ { x: 1, y: 6 },
  /* 1 */ { x: 2, y: 6 },
  /* 2 */ { x: 3, y: 6 },
  /* 3 */ { x: 4, y: 6 },
  /* 4 */ { x: 5, y: 6 },
  /* 5 */ { x: 6, y: 5 },
  /* 6 */ { x: 6, y: 4 },
  /* 7 */ { x: 6, y: 3 },
  /* 8 - Safe Star */ { x: 6, y: 2 },
  /* 9 */ { x: 6, y: 1 },
  /* 10 */ { x: 6, y: 0 },
  /* 11 */ { x: 7, y: 0 },
  /* 12 */ { x: 8, y: 0 },
  /* 13 - Green Start */ { x: 8, y: 1 },
  /* 14 */ { x: 8, y: 2 },
  /* 15 */ { x: 8, y: 3 },
  /* 16 */ { x: 8, y: 4 },
  /* 17 */ { x: 8, y: 5 },
  /* 18 */ { x: 9, y: 6 },
  /* 19 */ { x: 10, y: 6 },
  /* 20 */ { x: 11, y: 6 },
  /* 21 - Safe Star */ { x: 12, y: 6 },
  /* 22 */ { x: 13, y: 6 },
  /* 23 */ { x: 14, y: 6 },
  /* 24 */ { x: 14, y: 7 },
  /* 25 */ { x: 14, y: 8 },
  /* 26 - Yellow Start */ { x: 13, y: 8 },
  /* 27 */ { x: 12, y: 8 },
  /* 28 */ { x: 11, y: 8 },
  /* 29 */ { x: 10, y: 8 },
  /* 30 */ { x: 9, y: 8 },
  /* 31 */ { x: 8, y: 9 },
  /* 32 */ { x: 8, y: 10 },
  /* 33 */ { x: 8, y: 11 },
  /* 34 - Safe Star */ { x: 8, y: 12 },
  /* 35 */ { x: 8, y: 13 },
  /* 36 */ { x: 8, y: 14 },
  /* 37 */ { x: 7, y: 14 },
  /* 38 */ { x: 6, y: 14 },
  /* 39 - Blue Start */ { x: 6, y: 13 },
  /* 40 */ { x: 6, y: 12 },
  /* 41 */ { x: 6, y: 11 },
  /* 42 */ { x: 6, y: 10 },
  /* 43 */ { x: 6, y: 9 },
  /* 44 */ { x: 5, y: 8 },
  /* 45 */ { x: 4, y: 8 },
  /* 46 */ { x: 3, y: 8 },
  /* 47 - Safe Star */ { x: 2, y: 8 },
  /* 48 */ { x: 1, y: 8 },
  /* 49 */ { x: 0, y: 8 },
  /* 50 */ { x: 0, y: 7 },
  /* 51 */ { x: 0, y: 6 },
];

export const HOME_STRETCH_GRID_COORDINATES: Record<
  PlayerColor,
  readonly { x: number; y: number }[]
> = {
  red: [
    { x: 1, y: 7 },
    { x: 2, y: 7 },
    { x: 3, y: 7 },
    { x: 4, y: 7 },
    { x: 5, y: 7 },
  ],
  green: [
    { x: 7, y: 1 },
    { x: 7, y: 2 },
    { x: 7, y: 3 },
    { x: 7, y: 4 },
    { x: 7, y: 5 },
  ],
  yellow: [
    { x: 13, y: 7 },
    { x: 12, y: 7 },
    { x: 11, y: 7 },
    { x: 10, y: 7 },
    { x: 9, y: 7 },
  ],
  blue: [
    { x: 7, y: 13 },
    { x: 7, y: 12 },
    { x: 7, y: 11 },
    { x: 7, y: 10 },
    { x: 7, y: 9 },
  ],
};

export const FINISH_GRID_COORDINATES: Record<
  PlayerColor,
  { x: number; y: number }
> = {
  red: { x: 6, y: 7 },
  green: { x: 7, y: 6 },
  yellow: { x: 8, y: 7 },
  blue: { x: 7, y: 8 },
};

export const YARD_GRID_COORDINATES: Record<
  PlayerColor,
  readonly { x: number; y: number }[]
> = {
  red: [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ],
  green: [
    { x: 11, y: 2 },
    { x: 12, y: 2 },
    { x: 11, y: 3 },
    { x: 12, y: 3 },
  ],
  yellow: [
    { x: 11, y: 11 },
    { x: 12, y: 11 },
    { x: 11, y: 12 },
    { x: 12, y: 12 },
  ],
  blue: [
    { x: 2, y: 11 },
    { x: 3, y: 11 },
    { x: 2, y: 12 },
    { x: 3, y: 12 },
  ],
};

/**
 * Maps any canonical board position to 15x15 grid coordinates.
 */
export function getLogicalGridCoordinates(
  pos: CanonicalBoardPosition
): { x: number; y: number } {
  switch (pos.type) {
    case 'home':
      return YARD_GRID_COORDINATES[pos.color][pos.tokenIndex % 4];
    case 'track':
      return TRACK_CELL_GRID_COORDINATES[pos.trackIndex];
    case 'stretch':
      return HOME_STRETCH_GRID_COORDINATES[pos.color][pos.stretchIndex];
    case 'finish':
      return FINISH_GRID_COORDINATES[pos.color];
  }
}

/**
 * Computes the ordered sequence of canonical board positions traversed when a token
 * advances from `fromProgress` to `toProgress`.
 *
 * Useful for step-by-step UI piece animations (e.g. hopping 1 square at a time).
 *
 * Rules:
 * - If fromProgress === toProgress: returns []
 * - If toProgress < fromProgress: returns [] (backward movement not permitted in standard Ludo)
 * - Returns an array of CanonicalBoardPosition for each progress step in (fromProgress, toProgress]
 * - If fromProgress === HOME_PROGRESS (-1) and toProgress === START_PROGRESS (0): returns [start_position]
 * - Handles outer track traversal, track wrapping, track -> home stretch entry, and finish.
 */
export function getTraversedPositions(
  color: PlayerColor,
  fromProgress: number,
  toProgress: number
): CanonicalBoardPosition[] {
  if (toProgress <= fromProgress) {
    return [];
  }
  if (fromProgress < HOME_PROGRESS || toProgress > FINISH_PROGRESS) {
    throw new Error(
      `Invalid progress bounds: fromProgress=${fromProgress}, toProgress=${toProgress}. Allowed range is ${HOME_PROGRESS}..${FINISH_PROGRESS}.`
    );
  }

  const positions: CanonicalBoardPosition[] = [];
  const startStep = fromProgress === HOME_PROGRESS ? START_PROGRESS : fromProgress + 1;

  for (let p = startStep; p <= toProgress; p++) {
    positions.push(progressToBoardPosition(color, p));
  }

  return positions;
}

/**
 * Computes the ordered sequence of 15x15 grid coordinates traversed when a token
 * advances from `fromProgress` to `toProgress`.
 */
export function getTraversedCoordinates(
  color: PlayerColor,
  fromProgress: number,
  toProgress: number
): { x: number; y: number }[] {
  return getTraversedPositions(color, fromProgress, toProgress).map(getLogicalGridCoordinates);
}
