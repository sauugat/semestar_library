/**
 * Semester Library Games Platform - Canonical Ludo Engine Types
 *
 * Fully serializable, independent of React Native, Node, and Cloudflare Workers.
 * Pure TypeScript standard library (ES2022).
 */

export const LUDO_PROTOCOL_VERSION = 1;

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export const PLAYER_COLORS: readonly PlayerColor[] = [
  'red',
  'green',
  'yellow',
  'blue',
] as const;

export type PlayerType = 'human' | 'bot';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export type LudoGameStatus = 'waiting' | 'playing' | 'finished';

export type TurnPhase = 'roll' | 'move';

/**
 * Precedence for animation and analytics metadata:
 * finish > capture > six
 */
export type ExtraTurnReason = 'finish' | 'capture' | 'six';

export interface LudoPlayer {
  id: string;
  color: PlayerColor;
  type: PlayerType;
  name?: string;
  botDifficulty?: BotDifficulty;
}

export interface LudoPlayerInit {
  id: string;
  color: PlayerColor;
  type: PlayerType;
  name?: string;
  botDifficulty?: BotDifficulty;
}

export interface LudoInitOptions {
  players: LudoPlayerInit[];
  startingColor?: PlayerColor;
}

export type CanonicalBoardPosition =
  | { type: 'home'; color: PlayerColor; tokenIndex: number }
  | { type: 'track'; trackIndex: number; isSafe: boolean }
  | { type: 'stretch'; color: PlayerColor; stretchIndex: number }
  | { type: 'finish'; color: PlayerColor };

export interface LegalMove {
  tokenIndex: number; // 0..3
  currentProgress: number; // -1..55
  targetProgress: number; // 0..56
  isLeavingHome: boolean;
  isCapture: boolean;
  isFinish: boolean;
  targetPosition: CanonicalBoardPosition;
}

export interface LastAction {
  type: 'roll' | 'move' | 'pass' | 'three_sixes_forfeit';
  color: PlayerColor;
  roll?: number;
  tokenIndex?: number;
  captured?: {
    color: PlayerColor;
    tokenIndex: number;
  }[];
  consecutiveSixes?: number;
}

export interface LudoState {
  gameType: 'ludo';
  status: LudoGameStatus;
  activeColors: PlayerColor[];
  players: Record<PlayerColor, LudoPlayer | null>;
  tokens: Record<PlayerColor, [number, number, number, number]>;
  currentTurn: PlayerColor | null;
  turnPhase: TurnPhase | null;
  currentRoll: number | null;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  rankings: PlayerColor[];
  lastAction: LastAction | null;
  round: number;
  revision: number;
}

export type RngFn = () => number;

export interface DiceRoller {
  roll(): number;
}

export interface RollResult {
  success: boolean;
  diceValue?: number;
  consecutiveSixes?: number;
  legalMoves?: LegalMove[];
  autoPassed?: boolean;
  forfeitedDueToThreeSixes?: boolean;
  nextTurn?: PlayerColor | null;
  error?: string;
}

export interface MoveResult {
  success: boolean;
  movedToken?: {
    color: PlayerColor;
    tokenIndex: number;
    fromProgress: number;
    toProgress: number;
    targetPosition: CanonicalBoardPosition;
  };
  capturedTokens?: {
    color: PlayerColor;
    tokenIndex: number;
  }[];
  reachedFinish?: boolean;
  playerRanked?: {
    color: PlayerColor;
    rank: number;
  };
  extraTurnGranted?: boolean;
  extraTurnReason?: ExtraTurnReason | null;
  nextTurn?: PlayerColor | null;
  gameFinished?: boolean;
  error?: string;
}

export interface ForfeitResult {
  success: boolean;
  forfeitedColor?: PlayerColor;
  rankings?: PlayerColor[];
  gameFinished?: boolean;
  error?: string;
}
