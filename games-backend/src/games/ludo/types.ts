import type {
  PlayerColor,
  BotDifficulty,
  TurnPhase,
  ExtraTurnReason,
  LegalMove,
  LudoState,
  LudoGameStatus,
} from '../../../../packages/ludo-engine/src/index.ts';

export const LUDO_RECONNECT_GRACE_MS = 90_000;
export const LUDO_TAKEOVER_BOT_DIFFICULTY: BotDifficulty = 'normal';

export type LudoSeatStatus = 'human' | 'bot' | 'open' | 'closed';
export type LudoControlMode = 'human' | 'bot' | 'takeover-bot';
export type LudoPresenceStatus = 'online' | 'reconnecting' | 'abandoned';

export interface LudoUserSession {
  userId: string;
  username?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface LudoSeat {
  color: PlayerColor;
  status: LudoSeatStatus;
  userId: string | null;
  displayName: string | null;
  botDifficulty: BotDifficulty | null;
  ready: boolean;
  // Phase 4C1 lifecycle extensions
  controlMode?: LudoControlMode;
  presence?: LudoPresenceStatus;
  disconnectDeadline?: number | null;
  abandonedAt?: number | null;
}

export type LudoRoomStatus = 'lobby' | 'playing' | 'finished';

export interface LudoLobbyState {
  gameType: 'ludo';
  roomId: string;
  status: 'lobby';
  hostUserId: string | null;
  seats: Record<PlayerColor, LudoSeat>;
  activeSeatCount: number;
  revision: number;
  roomGeneration?: number;
}

export interface LudoRoomState {
  gameType: 'ludo';
  roomId: string;
  status: LudoRoomStatus;
  hostUserId: string | null;
  seats: Record<PlayerColor, LudoSeat>;
  activeSeatCount: number;
  engineState: LudoState | null;
  rankings: PlayerColor[];
  createdAt: number;
  updatedAt: number;
  revision: number;
  roomGeneration?: number;
  // Phase 4C1 lifecycle extensions
  finishReason?: 'all-humans-abandoned' | 'normal' | null;
  displayRankings?: PlayerColor[];
}

// Client Messages
export type LudoClientMessage =
  | { type: 'LUDO_JOIN'; displayName?: string; preferredColor?: PlayerColor }
  | { type: 'LUDO_SET_READY'; ready: boolean }
  | { type: 'LUDO_SET_SEAT'; color: PlayerColor; status: 'open' | 'closed' }
  | { type: 'LUDO_SET_PLAYER_COUNT'; playerCount: 2 | 3 | 4 }
  | { type: 'LUDO_ADD_BOT'; color: PlayerColor; difficulty?: BotDifficulty }
  | { type: 'LUDO_REMOVE_BOT'; color: PlayerColor }
  | { type: 'LUDO_SET_BOT_DIFFICULTY'; color: PlayerColor; difficulty: BotDifficulty }
  | { type: 'LUDO_START_GAME' }
  | { type: 'LUDO_ROLL_DICE' }
  | { type: 'LUDO_MOVE_TOKEN'; tokenId: number }
  | { type: 'LUDO_REQUEST_STATE' }
  | { type: 'LUDO_LEAVE' }
  | { type: 'LUDO_RETURN_TO_LOBBY' };

// Server Events
export interface ServerLudoLobbyStateEvent {
  type: 'LUDO_LOBBY_STATE';
  roomId: string;
  lobby: LudoLobbyState;
  presence: Record<string, boolean>;
  revision: number;
  protocolVersion: number;
}

export interface ServerLudoGameStateEvent {
  type: 'LUDO_GAME_STATE';
  roomId: string;
  state: LudoState;
  seats: Record<PlayerColor, LudoSeat>;
  hostUserId: string | null;
  presence: Record<string, boolean>;
  revision: number;
  protocolVersion: number;
  finishReason?: 'all-humans-abandoned' | 'normal' | null;
  displayRankings?: PlayerColor[];
}

export interface ServerLudoDiceRolledEvent {
  type: 'LUDO_DICE_ROLLED';
  roomId: string;
  color: PlayerColor;
  player?: PlayerColor;
  roll: number;
  dice?: number;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  autoPassed: boolean;
  threeSixesForfeit: boolean;
  nextTurn: PlayerColor | null;
  revision: number;
  protocolVersion: number;
}

export interface ServerLudoMoveResultEvent {
  type: 'LUDO_MOVE_RESULT';
  roomId: string;
  player: PlayerColor;
  tokenId: number;
  fromProgress: number;
  toProgress: number;
  traversedCoordinates: { x: number; y: number }[];
  capturedTokens: { color: PlayerColor; tokenIndex: number }[];
  reachedFinish: boolean;
  playerRanked: boolean;
  rank: number | null;
  extraTurn: boolean;
  extraTurnReason: ExtraTurnReason | null;
  resultingTurn: PlayerColor | null;
  gameFinished: boolean;
  rankings: PlayerColor[];
  revision: number;
  protocolVersion: number;
}

export interface ServerLudoPresenceEvent {
  type: 'LUDO_PRESENCE';
  roomId: string;
  userId: string;
  online: boolean;
  status?: LudoPresenceStatus;
  disconnectDeadline?: number | null;
  protocolVersion: number;
}

export interface ServerLudoErrorEvent {
  type: 'ERROR';
  message: string;
  code?: string;
  protocolVersion: number;
}

export type LudoServerEvent =
  | ServerLudoLobbyStateEvent
  | ServerLudoGameStateEvent
  | ServerLudoDiceRolledEvent
  | ServerLudoMoveResultEvent
  | ServerLudoPresenceEvent
  | ServerLudoErrorEvent;
