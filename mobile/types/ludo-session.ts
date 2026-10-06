/**
 * Semester Library Games Platform - Local / Offline Ludo Session Types
 *
 * Defines models for local pass-and-play match configuration, seat allocation,
 * device handoff, action results, and versioned persistence envelopes.
 */

import type {
  PlayerColor,
  TurnPhase,
  LudoGameStatus,
  LegalMove,
  CanonicalBoardPosition,
  ExtraTurnReason,
  LudoState,
  BotDifficulty,
} from '../../packages/ludo-engine/src/index.ts';

export type {
  PlayerColor,
  TurnPhase,
  LudoGameStatus,
  LegalMove,
  CanonicalBoardPosition,
  ExtraTurnReason,
  LudoState,
  BotDifficulty,
};

export type LocalSeatStatus = 'human' | 'bot' | 'closed';

export interface LocalSeatConfig {
  color: PlayerColor;
  status: LocalSeatStatus;
  displayName: string; // Trimmed, defaults to e.g. "Red Player" or "Red Bot (Normal)"
  botDifficulty?: BotDifficulty; // 'easy' | 'normal' | 'hard'
}

export interface LocalSeatInput {
  color: PlayerColor;
  status: LocalSeatStatus;
  displayName?: string;
  botDifficulty?: BotDifficulty;
}

/**
 * Canonical match configuration.
 * Always contains exactly 4 canonical seats in clockwise order:
 * [red, green, yellow, blue], where inactive seats are explicitly status = 'closed'.
 */
export interface LocalLudoMatchConfig {
  sessionId: string;
  schemaVersion: 1;
  createdAt: number;
  seats: [LocalSeatConfig, LocalSeatConfig, LocalSeatConfig, LocalSeatConfig];
}

export interface LocalLudoMatchInput {
  sessionId?: string;
  createdAt?: number;
  seats: LocalSeatInput[];
}

export interface DeviceHandoffMetadata {
  needsHandoff: boolean; // true only when turn passes from one human to a different human
  fromPlayer: LocalSeatConfig;
  toPlayer: LocalSeatConfig;
  message: string;
}

export interface LocalLudoRollResult {
  type: 'ROLL';
  player: PlayerColor;
  rolledValue: number;
  legalMoves: LegalMove[];
  autoPass: boolean;
  threeSixesForfeit: boolean;
  resultingTurn: PlayerColor | null;
  resultingPhase: TurnPhase | null;
  handoff: DeviceHandoffMetadata | null;
  persistenceWarning?: string;
}

export interface LocalLudoMoveResult {
  type: 'MOVE';
  player: PlayerColor;
  tokenId: number;
  fromProgress: number;
  toProgress: number;
  traversedPositions: CanonicalBoardPosition[];
  traversedCoordinates: { x: number; y: number }[];
  capturedTokens: { color: PlayerColor; tokenIndex: number }[];
  reachedFinish: boolean;
  playerRanked: boolean;
  rank: number | null;
  extraTurn: boolean;
  extraTurnReason: ExtraTurnReason | null;
  resultingTurn: PlayerColor | null;
  resultingPhase: TurnPhase | null;
  gameFinished: boolean;
  handoff: DeviceHandoffMetadata | null;
  persistenceWarning?: string;
}

export type LocalLudoActionResult = LocalLudoRollResult | LocalLudoMoveResult;

export interface LocalLudoSessionSnapshot {
  sessionId: string;
  status: LudoGameStatus;
  turnPhase: TurnPhase | null;
  currentTurn: PlayerColor | null;
  currentRoll: number | null;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  rankings: PlayerColor[];
  winner: PlayerColor | null;
  isBotTurn: boolean;
  activePlayer: LocalSeatConfig | null;
  seats: [LocalSeatConfig, LocalSeatConfig, LocalSeatConfig, LocalSeatConfig];
  engineState: LudoState;
  handoff: DeviceHandoffMetadata | null;
  lastAction: LocalLudoActionResult | null;
}

export interface LocalLudoSavedEnvelope {
  schemaVersion: 1;
  sessionId: string;
  savedAt: number;
  config: LocalLudoMatchConfig;
  engineState: LudoState;
}

export interface LocalLudoRestoreResult {
  success: boolean;
  session?: any; // LocalLudoSession
  error?: string;
  isCorrupted?: boolean;
}

export type SavedSessionInspection =
  | { status: 'none' }
  | {
      status: 'resumable';
      envelope: LocalLudoSavedEnvelope;
      sessionId: string;
      savedAt: number;
      activeSeats: LocalSeatConfig[];
      currentTurn: PlayerColor | null;
      gameStatus: LudoGameStatus;
    }
  | { status: 'corrupted'; error: string };
