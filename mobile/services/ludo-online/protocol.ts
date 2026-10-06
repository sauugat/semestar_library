/**
 * Mobile-side protocol types and runtime validators for Online Ludo.
 *
 * Strict boundary:
 * - TypeScript types disappear at runtime; all inbound server messages MUST be runtime-validated.
 * - Client messages never send authoritative data (displayName, engineState, revision, etc.).
 */

export const LUDO_PROTOCOL_VERSION = 1;

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export const CANONICAL_COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const VALID_BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

export type LudoSeatStatus = 'human' | 'bot' | 'open' | 'closed';

export interface LudoSeat {
  color: PlayerColor;
  status: LudoSeatStatus;
  userId: string | null;
  displayName: string | null;
  botDifficulty: BotDifficulty | null;
  ready: boolean;
}

export interface LudoLobbyState {
  gameType: 'ludo';
  roomId: string;
  status: 'lobby';
  hostUserId: string | null;
  seats: Record<PlayerColor, LudoSeat>;
  activeSeatCount: number;
  revision: number;
}

// Outgoing Client Messages
export type LudoClientMessage =
  | { type: 'LUDO_JOIN'; preferredColor?: PlayerColor }
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
  | { type: 'LUDO_LEAVE' };

// Inbound Server Events
export interface LudoConnectedEvent {
  type: 'CONNECTED';
  roomId: string;
  userId: string;
  protocolVersion: number;
}

export interface LudoLobbyStateEvent {
  type: 'LUDO_LOBBY_STATE';
  roomId: string;
  lobby: LudoLobbyState;
  presence: Record<string, boolean>;
  revision: number;
  protocolVersion: number;
}

export interface LudoGameStateEvent {
  type: 'LUDO_GAME_STATE';
  roomId: string;
  state: unknown; // Full engine state, consumed in Phase 4B2
  seats: Record<PlayerColor, LudoSeat>;
  hostUserId: string | null;
  presence: Record<string, boolean>;
  revision: number;
  protocolVersion: number;
}

export interface LudoDiceRolledEvent {
  type: 'LUDO_DICE_ROLLED';
  roomId: string;
  color: PlayerColor;
  roll: number;
  consecutiveSixes: number;
  legalMoves: unknown[];
  autoPassed: boolean;
  threeSixesForfeit: boolean;
  nextTurn: PlayerColor | null;
  revision: number;
  protocolVersion: number;
}

export interface LudoMoveResultEvent {
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
  resultingTurn: PlayerColor | null;
  gameFinished: boolean;
  rankings: PlayerColor[];
  revision: number;
  protocolVersion: number;
}

export interface LudoPresenceEvent {
  type: 'LUDO_PRESENCE';
  roomId: string;
  userId: string;
  online: boolean;
  protocolVersion: number;
}

export interface LudoErrorEvent {
  type: 'ERROR';
  message: string;
  code?: string;
  protocolVersion: number;
}

export type LudoServerEvent =
  | LudoConnectedEvent
  | LudoLobbyStateEvent
  | LudoGameStateEvent
  | LudoDiceRolledEvent
  | LudoMoveResultEvent
  | LudoPresenceEvent
  | LudoErrorEvent;

/**
 * Validates a single LudoSeat object.
 */
function validateSeat(raw: unknown, expectedColor: PlayerColor): LudoSeat | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;

  if (s.color !== expectedColor) return null;
  if (s.status !== 'human' && s.status !== 'bot' && s.status !== 'open' && s.status !== 'closed') {
    return null;
  }

  const userId = typeof s.userId === 'string' && s.userId.trim() ? s.userId.trim() : null;
  const displayName = typeof s.displayName === 'string' && s.displayName.trim() ? s.displayName.trim() : null;

  let botDifficulty: BotDifficulty | null = null;
  if (s.botDifficulty !== null && s.botDifficulty !== undefined) {
    if (typeof s.botDifficulty !== 'string' || !VALID_BOT_DIFFICULTIES.includes(s.botDifficulty as BotDifficulty)) {
      return null;
    }
    botDifficulty = s.botDifficulty as BotDifficulty;
  }

  const ready = typeof s.ready === 'boolean' ? s.ready : false;

  return {
    color: expectedColor,
    status: s.status,
    userId,
    displayName,
    botDifficulty,
    ready,
  };
}

/**
 * Validates the seats dictionary for all four canonical colors.
 */
function validateSeats(rawSeats: unknown): Record<PlayerColor, LudoSeat> | null {
  if (typeof rawSeats !== 'object' || rawSeats === null) return null;
  const s = rawSeats as Record<string, unknown>;

  const red = validateSeat(s.red, 'red');
  const green = validateSeat(s.green, 'green');
  const yellow = validateSeat(s.yellow, 'yellow');
  const blue = validateSeat(s.blue, 'blue');

  if (!red || !green || !yellow || !blue) return null;

  return { red, green, yellow, blue };
}

/**
 * Validates a LudoLobbyState object.
 */
export function validateLobbyState(raw: unknown): LudoLobbyState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const l = raw as Record<string, unknown>;

  if (l.gameType !== 'ludo') return null;
  if (l.status !== 'lobby') return null;
  if (typeof l.roomId !== 'string' || !l.roomId.trim()) return null;
  if (typeof l.revision !== 'number' || !Number.isInteger(l.revision) || l.revision < 0) return null;
  if (typeof l.activeSeatCount !== 'number' || ![2, 3, 4].includes(l.activeSeatCount)) return null;

  const hostUserId = typeof l.hostUserId === 'string' && l.hostUserId.trim() ? l.hostUserId.trim() : null;
  const seats = validateSeats(l.seats);
  if (!seats) return null;

  return {
    gameType: 'ludo',
    roomId: l.roomId.trim(),
    status: 'lobby',
    hostUserId,
    seats,
    activeSeatCount: l.activeSeatCount as 2 | 3 | 4,
    revision: l.revision,
  };
}

/**
 * Validates the minimal structure of the engineState envelope in LUDO_GAME_STATE.
 * Ensures the runtime structure is safe for Phase 4B2 without crashing.
 */
export function validateEngineStateEnvelope(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const s = raw as Record<string, unknown>;

  if (s.status !== 'playing' && s.status !== 'finished') return false;

  if (
    s.currentTurn !== null &&
    (typeof s.currentTurn !== 'string' || !CANONICAL_COLORS.includes(s.currentTurn as PlayerColor))
  ) {
    return false;
  }

  if (s.turnPhase !== null && s.turnPhase !== 'roll' && s.turnPhase !== 'move') {
    return false;
  }

  if (
    s.currentRoll !== null &&
    s.currentRoll !== undefined &&
    (typeof s.currentRoll !== 'number' || !Number.isInteger(s.currentRoll))
  ) {
    return false;
  }

  if (!Array.isArray(s.legalMoves)) return false;
  if (typeof s.tokens !== 'object' || s.tokens === null) return false;
  if (!Array.isArray(s.rankings)) return false;

  return true;
}

/**
 * Parses and validates an arbitrary server event safely.
 * Returns null if the event is malformed or unrecognized.
 */
export function parseLudoServerEvent(raw: unknown): LudoServerEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;

  const protocolVersion =
    typeof e.protocolVersion === 'number' && Number.isInteger(e.protocolVersion)
      ? e.protocolVersion
      : LUDO_PROTOCOL_VERSION;

  switch (e.type) {
    case 'CONNECTED': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.userId !== 'string' || !e.userId.trim()) return null;
      return {
        type: 'CONNECTED',
        roomId: e.roomId.trim(),
        userId: e.userId.trim(),
        protocolVersion,
      };
    }

    case 'LUDO_LOBBY_STATE': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.revision !== 'number' || !Number.isInteger(e.revision) || e.revision < 0) return null;

      const lobby = validateLobbyState(e.lobby);
      if (!lobby) return null;

      const presence: Record<string, boolean> = {};
      if (typeof e.presence === 'object' && e.presence !== null) {
        for (const [k, v] of Object.entries(e.presence)) {
          if (typeof v === 'boolean') {
            presence[k] = v;
          }
        }
      }

      return {
        type: 'LUDO_LOBBY_STATE',
        roomId: e.roomId.trim(),
        lobby,
        presence,
        revision: e.revision,
        protocolVersion,
      };
    }

    case 'LUDO_GAME_STATE': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.revision !== 'number' || !Number.isInteger(e.revision) || e.revision < 0) return null;

      if (!validateEngineStateEnvelope(e.state)) return null;

      const seats = validateSeats(e.seats);
      if (!seats) return null;

      const hostUserId = typeof e.hostUserId === 'string' && e.hostUserId.trim() ? e.hostUserId.trim() : null;

      const presence: Record<string, boolean> = {};
      if (typeof e.presence === 'object' && e.presence !== null) {
        for (const [k, v] of Object.entries(e.presence)) {
          if (typeof v === 'boolean') {
            presence[k] = v;
          }
        }
      }

      return {
        type: 'LUDO_GAME_STATE',
        roomId: e.roomId.trim(),
        state: e.state,
        seats,
        hostUserId,
        presence,
        revision: e.revision,
        protocolVersion,
      };
    }

    case 'LUDO_DICE_ROLLED': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.color !== 'string' || !CANONICAL_COLORS.includes(e.color as PlayerColor)) return null;
      if (typeof e.roll !== 'number' || !Number.isInteger(e.roll) || e.roll < 1 || e.roll > 6) return null;
      if (typeof e.revision !== 'number' || !Number.isInteger(e.revision) || e.revision < 0) return null;

      return {
        type: 'LUDO_DICE_ROLLED',
        roomId: e.roomId.trim(),
        color: e.color as PlayerColor,
        roll: e.roll,
        consecutiveSixes: typeof e.consecutiveSixes === 'number' ? e.consecutiveSixes : 0,
        legalMoves: Array.isArray(e.legalMoves) ? e.legalMoves : [],
        autoPassed: Boolean(e.autoPassed),
        threeSixesForfeit: Boolean(e.threeSixesForfeit),
        nextTurn:
          typeof e.nextTurn === 'string' && CANONICAL_COLORS.includes(e.nextTurn as PlayerColor)
            ? (e.nextTurn as PlayerColor)
            : null,
        revision: e.revision,
        protocolVersion,
      };
    }

    case 'LUDO_MOVE_RESULT': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.player !== 'string' || !CANONICAL_COLORS.includes(e.player as PlayerColor)) return null;
      if (typeof e.tokenId !== 'number' || !Number.isInteger(e.tokenId) || e.tokenId < 0 || e.tokenId > 3) return null;
      if (typeof e.revision !== 'number' || !Number.isInteger(e.revision) || e.revision < 0) return null;

      const traversedCoordinates: { x: number; y: number }[] = [];
      if (Array.isArray(e.traversedCoordinates)) {
        for (const coord of e.traversedCoordinates) {
          if (
            typeof coord === 'object' &&
            coord !== null &&
            typeof (coord as any).x === 'number' &&
            typeof (coord as any).y === 'number'
          ) {
            traversedCoordinates.push({ x: (coord as any).x, y: (coord as any).y });
          }
        }
      }

      const capturedTokens: { color: PlayerColor; tokenIndex: number }[] = [];
      if (Array.isArray(e.capturedTokens)) {
        for (const cap of e.capturedTokens) {
          if (
            typeof cap === 'object' &&
            cap !== null &&
            typeof (cap as any).color === 'string' &&
            CANONICAL_COLORS.includes((cap as any).color) &&
            typeof (cap as any).tokenIndex === 'number'
          ) {
            capturedTokens.push({ color: (cap as any).color, tokenIndex: (cap as any).tokenIndex });
          }
        }
      }

      const rankings: PlayerColor[] = [];
      if (Array.isArray(e.rankings)) {
        for (const r of e.rankings) {
          if (typeof r === 'string' && CANONICAL_COLORS.includes(r as PlayerColor)) {
            rankings.push(r as PlayerColor);
          }
        }
      }

      return {
        type: 'LUDO_MOVE_RESULT',
        roomId: e.roomId.trim(),
        player: e.player as PlayerColor,
        tokenId: e.tokenId,
        fromProgress: typeof e.fromProgress === 'number' ? e.fromProgress : 0,
        toProgress: typeof e.toProgress === 'number' ? e.toProgress : 0,
        traversedCoordinates,
        capturedTokens,
        reachedFinish: Boolean(e.reachedFinish),
        playerRanked: Boolean(e.playerRanked),
        rank: typeof e.rank === 'number' ? e.rank : null,
        extraTurn: Boolean(e.extraTurn),
        resultingTurn:
          typeof e.resultingTurn === 'string' && CANONICAL_COLORS.includes(e.resultingTurn as PlayerColor)
            ? (e.resultingTurn as PlayerColor)
            : null,
        gameFinished: Boolean(e.gameFinished),
        rankings,
        revision: e.revision,
        protocolVersion,
      };
    }

    case 'LUDO_PRESENCE': {
      if (typeof e.roomId !== 'string' || !e.roomId.trim()) return null;
      if (typeof e.userId !== 'string' || !e.userId.trim()) return null;
      if (typeof e.online !== 'boolean') return null;

      return {
        type: 'LUDO_PRESENCE',
        roomId: e.roomId.trim(),
        userId: e.userId.trim(),
        online: e.online,
        protocolVersion,
      };
    }

    case 'ERROR': {
      if (typeof e.message !== 'string') return null;
      return {
        type: 'ERROR',
        message: e.message,
        code: typeof e.code === 'string' ? e.code : undefined,
        protocolVersion,
      };
    }

    default:
      return null;
  }
}
