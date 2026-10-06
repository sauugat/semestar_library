export const PROTOCOL_VERSION = 1;

export type TicTacToeSymbol = 'X' | 'O';
export type TicTacToeStatus = 'waiting' | 'playing' | 'finished';
export type TicTacToeWinner = TicTacToeSymbol | 'draw' | null;

export interface TicTacToeState {
  gameType: 'tic-tac-toe';
  status: TicTacToeStatus;
  players: {
    X: string | null;
    O: string | null;
  };
  board: (TicTacToeSymbol | null)[];
  currentTurn: TicTacToeSymbol | null;
  winner: TicTacToeWinner;
  winningLine: number[] | null;
  rematchRequestedBy: string | null;
  round: number;
  revision: number;
}

// Client Messages
export interface GamesJoinGameMessage {
  type: 'JOIN_GAME';
}

export interface GamesMakeMoveMessage {
  type: 'MAKE_MOVE';
  cellIndex: number;
}

export interface GamesRequestStateMessage {
  type: 'REQUEST_STATE';
}

export interface GamesRematchMessage {
  type: 'REMATCH';
}

export type GamesClientMessage =
  | GamesJoinGameMessage
  | GamesMakeMoveMessage
  | GamesRequestStateMessage
  | GamesRematchMessage;

// Server Events
export interface GamesConnectedEvent {
  type: 'CONNECTED';
  roomId: string;
  userId: string;
  protocolVersion: number;
}

export interface GamesPlayerJoinedEvent {
  type: 'PLAYER_JOINED';
  roomId: string;
  userId: string;
  symbol: TicTacToeSymbol;
  protocolVersion: number;
}

export interface GamesGameStateEvent {
  type: 'GAME_STATE';
  roomId: string;
  state: TicTacToeState;
  protocolVersion: number;
}

export interface GamesMoveAcceptedEvent {
  type: 'MOVE_ACCEPTED';
  roomId: string;
  userId: string;
  symbol: TicTacToeSymbol;
  cellIndex: number;
  revision: number;
  protocolVersion: number;
}

export interface GamesGameFinishedEvent {
  type: 'GAME_FINISHED';
  roomId: string;
  winner: TicTacToeWinner;
  winningLine: number[] | null;
  revision: number;
  protocolVersion: number;
}

export interface GamesErrorEvent {
  type: 'ERROR';
  message: string;
  code?: string;
  protocolVersion: number;
}

export type GamesServerEvent =
  | GamesConnectedEvent
  | GamesPlayerJoinedEvent
  | GamesGameStateEvent
  | GamesMoveAcceptedEvent
  | GamesGameFinishedEvent
  | GamesErrorEvent;

/**
 * Validates raw state against authoritative TicTacToeState rules.
 * Returns a valid TicTacToeState object or null if validation fails.
 */
export function validateTicTacToeState(raw: unknown): TicTacToeState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const s = raw as Record<string, unknown>;

  if (s.gameType !== 'tic-tac-toe') {
    return null;
  }

  if (s.status !== 'waiting' && s.status !== 'playing' && s.status !== 'finished') {
    return null;
  }

  if (
    typeof s.revision !== 'number' ||
    !Number.isInteger(s.revision) ||
    s.revision < 0
  ) {
    return null;
  }

  if (typeof s.players !== 'object' || s.players === null) {
    return null;
  }
  const p = s.players as Record<string, unknown>;
  if (p.X !== null && typeof p.X !== 'string') {
    return null;
  }
  if (p.O !== null && typeof p.O !== 'string') {
    return null;
  }

  if (!Array.isArray(s.board) || s.board.length !== 9) {
    return null;
  }
  for (let i = 0; i < 9; i++) {
    const cell = s.board[i];
    if (cell !== null && cell !== 'X' && cell !== 'O') {
      return null;
    }
  }

  if (s.currentTurn !== null && s.currentTurn !== 'X' && s.currentTurn !== 'O') {
    return null;
  }

  if (
    s.winner !== null &&
    s.winner !== 'X' &&
    s.winner !== 'O' &&
    s.winner !== 'draw'
  ) {
    return null;
  }

  if (s.winningLine !== null) {
    if (!Array.isArray(s.winningLine) || s.winningLine.length !== 3) {
      return null;
    }
    for (const idx of s.winningLine) {
      if (!Number.isInteger(idx) || idx < 0 || idx > 8) {
        return null;
      }
    }
  }

  // Round validation (defaults to 1 if missing for rollout compatibility)
  let round = 1;
  if ('round' in s && s.round !== undefined) {
    if (typeof s.round !== 'number' || !Number.isInteger(s.round) || s.round < 1) {
      return null;
    }
    round = s.round;
  }

  // Rematch validation (defaults to null if missing for rollout compatibility)
  let rematchRequestedBy: string | null = null;
  if ('rematchRequestedBy' in s && s.rematchRequestedBy !== undefined) {
    if (s.rematchRequestedBy !== null && typeof s.rematchRequestedBy !== 'string') {
      return null;
    }
    if (s.rematchRequestedBy !== null && s.rematchRequestedBy.trim() === '') {
      return null;
    }
    if (s.rematchRequestedBy !== null) {
      if (s.status !== 'finished') {
        return null;
      }
      if (s.rematchRequestedBy !== p.X && s.rematchRequestedBy !== p.O) {
        return null;
      }
    }
    rematchRequestedBy = s.rematchRequestedBy;
  }

  // Cross-field status invariants matching backend engine
  if (s.status === 'waiting') {
    if (s.currentTurn !== null || s.winner !== null || rematchRequestedBy !== null) {
      return null;
    }
  } else if (s.status === 'playing') {
    if (p.X === null || p.O === null || p.X === p.O) {
      return null;
    }
    if (s.currentTurn !== 'X' && s.currentTurn !== 'O') {
      return null;
    }
    if (s.winner !== null || rematchRequestedBy !== null) {
      return null;
    }
  } else if (s.status === 'finished') {
    if (s.winner === null || s.currentTurn !== null) {
      return null;
    }
  }

  return {
    gameType: 'tic-tac-toe',
    status: s.status,
    players: {
      X: p.X as string | null,
      O: p.O as string | null,
    },
    board: [...s.board] as (TicTacToeSymbol | null)[],
    currentTurn: s.currentTurn as TicTacToeSymbol | null,
    winner: s.winner as TicTacToeWinner,
    winningLine: s.winningLine ? ([...s.winningLine] as number[]) : null,
    rematchRequestedBy,
    round,
    revision: s.revision as number,
  };
}

/**
 * Parses and strictly validates incoming server messages against backend protocol contracts.
 * Returns a typed GamesServerEvent if valid, or null if malformed or untrusted.
 */
export function parseGamesServerEvent(raw: unknown): GamesServerEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.type !== 'string' || record.protocolVersion !== PROTOCOL_VERSION) {
    return null;
  }

  switch (record.type) {
    case 'CONNECTED': {
      if (
        typeof record.roomId !== 'string' ||
        !record.roomId.trim() ||
        typeof record.userId !== 'string' ||
        !record.userId.trim()
      ) {
        return null;
      }
      return {
        type: 'CONNECTED',
        roomId: record.roomId.trim(),
        userId: record.userId.trim(),
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    case 'GAME_STATE': {
      if (typeof record.roomId !== 'string' || !record.roomId.trim()) {
        return null;
      }
      const validatedState = validateTicTacToeState(record.state);
      if (!validatedState) {
        return null;
      }
      return {
        type: 'GAME_STATE',
        roomId: record.roomId.trim(),
        state: validatedState,
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    case 'ERROR': {
      if (typeof record.message !== 'string') {
        return null;
      }
      const code = typeof record.code === 'string' ? record.code : undefined;
      return {
        type: 'ERROR',
        message: record.message,
        code,
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    case 'PLAYER_JOINED': {
      if (
        typeof record.roomId !== 'string' ||
        !record.roomId.trim() ||
        typeof record.userId !== 'string' ||
        !record.userId.trim() ||
        (record.symbol !== 'X' && record.symbol !== 'O')
      ) {
        return null;
      }
      return {
        type: 'PLAYER_JOINED',
        roomId: record.roomId.trim(),
        userId: record.userId.trim(),
        symbol: record.symbol,
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    case 'MOVE_ACCEPTED': {
      if (
        typeof record.roomId !== 'string' ||
        !record.roomId.trim() ||
        typeof record.userId !== 'string' ||
        !record.userId.trim() ||
        (record.symbol !== 'X' && record.symbol !== 'O') ||
        typeof record.cellIndex !== 'number' ||
        !Number.isInteger(record.cellIndex) ||
        record.cellIndex < 0 ||
        record.cellIndex > 8 ||
        typeof record.revision !== 'number' ||
        !Number.isInteger(record.revision) ||
        record.revision < 0
      ) {
        return null;
      }
      return {
        type: 'MOVE_ACCEPTED',
        roomId: record.roomId.trim(),
        userId: record.userId.trim(),
        symbol: record.symbol,
        cellIndex: record.cellIndex,
        revision: record.revision,
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    case 'GAME_FINISHED': {
      if (
        typeof record.roomId !== 'string' ||
        !record.roomId.trim() ||
        (record.winner !== 'X' && record.winner !== 'O' && record.winner !== 'draw') ||
        typeof record.revision !== 'number' ||
        !Number.isInteger(record.revision) ||
        record.revision < 0
      ) {
        return null;
      }

      let winningLine: number[] | null = null;
      if (record.winningLine !== null && record.winningLine !== undefined) {
        if (!Array.isArray(record.winningLine) || record.winningLine.length !== 3) {
          return null;
        }
        for (const idx of record.winningLine) {
          if (!Number.isInteger(idx) || idx < 0 || idx > 8) {
            return null;
          }
        }
        winningLine = [...record.winningLine];
      }

      return {
        type: 'GAME_FINISHED',
        roomId: record.roomId.trim(),
        winner: record.winner,
        winningLine,
        revision: record.revision,
        protocolVersion: PROTOCOL_VERSION,
      };
    }

    default:
      return null;
  }
}
