import type {
  PlayerSymbol,
  GameStatus,
  GameWinner,
  TicTacToeState,
} from '../protocol';

const WINNING_COMBINATIONS: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export interface JoinResult {
  success: boolean;
  symbol?: PlayerSymbol;
  isNewJoin?: boolean;
  error?: string;
}

export interface MoveResult {
  success: boolean;
  symbol?: PlayerSymbol;
  cellIndex?: number;
  winner?: GameWinner;
  winningLine?: number[] | null;
  error?: string;
}

export interface RematchResult {
  success: boolean;
  accepted?: boolean;
  round?: number;
  isIdempotent?: boolean;
  error?: string;
}

export function validateTicTacToeState(
  data: unknown
): { valid: true; state: TicTacToeState } | { valid: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'State must be a non-null object' };
  }

  const s = data as Record<string, unknown>;

  if (s.gameType !== 'tic-tac-toe') {
    return {
      valid: false,
      error: `Invalid gameType: expected "tic-tac-toe", got "${s.gameType}"`,
    };
  }

  if (s.status !== 'waiting' && s.status !== 'playing' && s.status !== 'finished') {
    return { valid: false, error: `Invalid status: "${s.status}"` };
  }

  if (typeof s.revision !== 'number' || !Number.isInteger(s.revision) || s.revision < 0) {
    return {
      valid: false,
      error: `Invalid revision: must be a non-negative integer, got ${s.revision}`,
    };
  }

  if (typeof s.players !== 'object' || s.players === null) {
    return { valid: false, error: 'Missing or invalid players object' };
  }
  const p = s.players as Record<string, unknown>;
  if (p.X !== null && typeof p.X !== 'string') {
    return { valid: false, error: 'players.X must be string or null' };
  }
  if (p.O !== null && typeof p.O !== 'string') {
    return { valid: false, error: 'players.O must be string or null' };
  }

  if (!Array.isArray(s.board) || s.board.length !== 9) {
    return { valid: false, error: 'board must be an array of exactly 9 elements' };
  }
  for (let i = 0; i < 9; i++) {
    const cell = s.board[i];
    if (cell !== null && cell !== 'X' && cell !== 'O') {
      return {
        valid: false,
        error: `board[${i}] must be 'X', 'O', or null, got ${cell}`,
      };
    }
  }

  if (s.currentTurn !== null && s.currentTurn !== 'X' && s.currentTurn !== 'O') {
    return {
      valid: false,
      error: `currentTurn must be 'X', 'O', or null, got ${s.currentTurn}`,
    };
  }

  if (
    s.winner !== null &&
    s.winner !== 'X' &&
    s.winner !== 'O' &&
    s.winner !== 'draw'
  ) {
    return {
      valid: false,
      error: `winner must be 'X', 'O', 'draw', or null, got ${s.winner}`,
    };
  }

  if (s.winningLine !== null) {
    if (!Array.isArray(s.winningLine) || s.winningLine.length !== 3) {
      return {
        valid: false,
        error: 'winningLine must be null or an array of 3 numbers',
      };
    }
    for (const idx of s.winningLine) {
      if (!Number.isInteger(idx) || idx < 0 || idx > 8) {
        return { valid: false, error: `Invalid cell index in winningLine: ${idx}` };
      }
    }
  }

  // Round validation (defaults to 1 if missing for legacy state migration)
  let round = 1;
  if ('round' in s && s.round !== undefined) {
    if (typeof s.round !== 'number' || !Number.isInteger(s.round) || s.round < 1) {
      return {
        valid: false,
        error: `Invalid round: must be a positive integer, got ${s.round}`,
      };
    }
    round = s.round;
  }

  // Rematch validation (defaults to null if missing for legacy state migration)
  let rematchRequestedBy: string | null = null;
  if ('rematchRequestedBy' in s && s.rematchRequestedBy !== undefined) {
    if (s.rematchRequestedBy !== null && typeof s.rematchRequestedBy !== 'string') {
      return {
        valid: false,
        error: 'rematchRequestedBy must be string or null',
      };
    }
    if (s.rematchRequestedBy !== null && s.rematchRequestedBy.trim() === '') {
      return {
        valid: false,
        error: 'rematchRequestedBy cannot be empty string',
      };
    }
    if (s.rematchRequestedBy !== null) {
      if (s.status !== 'finished') {
        return {
          valid: false,
          error: 'rematchRequestedBy must be null unless status is "finished"',
        };
      }
      if (s.rematchRequestedBy !== p.X && s.rematchRequestedBy !== p.O) {
        return {
          valid: false,
          error: 'rematchRequestedBy must be one of the room players',
        };
      }
    }
    rematchRequestedBy = s.rematchRequestedBy;
  }

  // Cross-field status invariants
  if (s.status === 'waiting') {
    if (s.currentTurn !== null) {
      return { valid: false, error: 'currentTurn must be null when status is "waiting"' };
    }
    if (s.winner !== null) {
      return { valid: false, error: 'winner must be null when status is "waiting"' };
    }
    if (rematchRequestedBy !== null) {
      return { valid: false, error: 'rematchRequestedBy must be null when status is "waiting"' };
    }
  } else if (s.status === 'playing') {
    if (p.X === null || p.O === null) {
      return { valid: false, error: 'Both players must be assigned when status is "playing"' };
    }
    if (p.X === p.O) {
      return { valid: false, error: 'players.X and players.O cannot be the same user' };
    }
    if (s.currentTurn !== 'X' && s.currentTurn !== 'O') {
      return { valid: false, error: 'currentTurn must be "X" or "O" when status is "playing"' };
    }
    if (s.winner !== null) {
      return { valid: false, error: 'winner must be null when status is "playing"' };
    }
    if (rematchRequestedBy !== null) {
      return { valid: false, error: 'rematchRequestedBy must be null when status is "playing"' };
    }
  } else if (s.status === 'finished') {
    if (s.winner === null) {
      return { valid: false, error: 'winner cannot be null when status is "finished"' };
    }
    if (s.currentTurn !== null) {
      return { valid: false, error: 'currentTurn must be null when status is "finished"' };
    }
  }

  return {
    valid: true,
    state: {
      gameType: 'tic-tac-toe',
      status: s.status,
      players: {
        X: p.X as string | null,
        O: p.O as string | null,
      },
      board: [...s.board] as (PlayerSymbol | null)[],
      currentTurn: s.currentTurn as PlayerSymbol | null,
      winner: s.winner as GameWinner,
      winningLine: s.winningLine ? ([...s.winningLine] as number[]) : null,
      rematchRequestedBy,
      round,
      revision: s.revision as number,
    },
  };
}

export class TicTacToeEngine {
  private status: GameStatus = 'waiting';
  private playerX: string | null = null;
  private playerO: string | null = null;
  private board: (PlayerSymbol | null)[] = Array(9).fill(null);
  private currentTurn: PlayerSymbol | null = null;
  private winner: GameWinner = null;
  private winningLine: number[] | null = null;
  private rematchRequestedBy: string | null = null;
  private round: number = 1;
  private revision: number = 0;

  constructor(initialState?: Partial<TicTacToeState>) {
    if (initialState) {
      if (initialState.status) this.status = initialState.status;
      if (initialState.players) {
        this.playerX = initialState.players.X ?? null;
        this.playerO = initialState.players.O ?? null;
      }
      if (initialState.board && initialState.board.length === 9) {
        this.board = [...initialState.board];
      }
      if (initialState.currentTurn !== undefined) this.currentTurn = initialState.currentTurn;
      if (initialState.winner !== undefined) this.winner = initialState.winner;
      if (initialState.winningLine !== undefined) {
        this.winningLine = initialState.winningLine ? [...initialState.winningLine] : null;
      }
      if (initialState.rematchRequestedBy !== undefined) {
        this.rematchRequestedBy = initialState.rematchRequestedBy;
      }
      if (typeof initialState.round === 'number') {
        this.round = initialState.round;
      }
      if (typeof initialState.revision === 'number') this.revision = initialState.revision;
    }
  }

  public static fromState(raw: unknown): TicTacToeEngine {
    const validated = validateTicTacToeState(raw);
    if (!validated.valid) {
      throw new Error(`Failed to restore TicTacToeEngine: ${validated.error}`);
    }
    return new TicTacToeEngine(validated.state);
  }

  public clone(): TicTacToeEngine {
    return new TicTacToeEngine(this.getState());
  }

  public getState(): TicTacToeState {
    return {
      gameType: 'tic-tac-toe',
      status: this.status,
      players: {
        X: this.playerX,
        O: this.playerO,
      },
      board: [...this.board],
      currentTurn: this.currentTurn,
      winner: this.winner,
      winningLine: this.winningLine ? [...this.winningLine] : null,
      rematchRequestedBy: this.rematchRequestedBy,
      round: this.round,
      revision: this.revision,
    };
  }

  public join(userId: string): JoinResult {
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    // Existing player rejoining
    if (this.playerX === userId) {
      return { success: true, symbol: 'X', isNewJoin: false };
    }
    if (this.playerO === userId) {
      return { success: true, symbol: 'O', isNewJoin: false };
    }

    // Assign Player X
    if (this.playerX === null) {
      this.playerX = userId;
      this.revision++;
      return { success: true, symbol: 'X', isNewJoin: true };
    }

    // Assign Player O and start game
    if (this.playerO === null) {
      this.playerO = userId;
      this.status = 'playing';
      this.currentTurn = 'X';
      this.revision++;
      return { success: true, symbol: 'O', isNewJoin: true };
    }

    // Game already full
    return { success: false, error: 'Room is full (maximum 2 players)' };
  }

  public makeMove(userId: string, cellIndex: number): MoveResult {
    if (this.status === 'waiting') {
      return { success: false, error: 'Game has not started yet. Waiting for opponent.' };
    }

    if (this.status === 'finished') {
      return { success: false, error: 'Game is already finished.' };
    }

    // Validate player identity
    let symbol: PlayerSymbol;
    if (userId === this.playerX) {
      symbol = 'X';
    } else if (userId === this.playerO) {
      symbol = 'O';
    } else {
      return { success: false, error: 'You are not a player in this game.' };
    }

    // Validate turn
    if (this.currentTurn !== symbol) {
      return { success: false, error: `It is not your turn. Waiting for player ${this.currentTurn}.` };
    }

    // Validate cell index
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) {
      return { success: false, error: 'Invalid cell index. Must be an integer between 0 and 8.' };
    }

    // Validate unoccupied cell
    if (this.board[cellIndex] !== null) {
      return { success: false, error: 'Cell is already occupied.' };
    }

    // Apply move
    this.board[cellIndex] = symbol;

    // Check for win
    let won = false;
    for (const combo of WINNING_COMBINATIONS) {
      const [a, b, c] = combo;
      if (
        this.board[a] === symbol &&
        this.board[b] === symbol &&
        this.board[c] === symbol
      ) {
        won = true;
        this.winner = symbol;
        this.winningLine = [...combo];
        this.status = 'finished';
        this.currentTurn = null;
        break;
      }
    }

    // Check for draw
    if (!won) {
      const hasEmptyCell = this.board.some((cell) => cell === null);
      if (!hasEmptyCell) {
        this.winner = 'draw';
        this.winningLine = null;
        this.status = 'finished';
        this.currentTurn = null;
      } else {
        // Toggle turn
        this.currentTurn = symbol === 'X' ? 'O' : 'X';
      }
    }

    this.revision++;

    return {
      success: true,
      symbol,
      cellIndex,
      winner: this.winner,
      winningLine: this.winningLine,
    };
  }

  public requestRematch(userId: string): RematchResult {
    if (!userId || typeof userId !== 'string') {
      return { success: false, error: 'Invalid user ID' };
    }

    if (this.status !== 'finished') {
      return { success: false, error: 'Cannot request rematch: game is not finished.' };
    }

    if (userId !== this.playerX && userId !== this.playerO) {
      return { success: false, error: 'You are not a player in this game.' };
    }

    // No request pending: first request
    if (this.rematchRequestedBy === null) {
      this.rematchRequestedBy = userId;
      this.revision++;
      return { success: true, accepted: false, round: this.round };
    }

    // Same user pressed again: idempotent
    if (this.rematchRequestedBy === userId) {
      return { success: true, accepted: false, isIdempotent: true, round: this.round };
    }

    // Opponent requests while first request is pending: ACCEPT
    const prevX = this.playerX;
    const prevO = this.playerO;
    this.playerX = prevO;
    this.playerO = prevX;

    this.board = Array(9).fill(null);
    this.status = 'playing';
    this.currentTurn = 'X';
    this.winner = null;
    this.winningLine = null;
    this.rematchRequestedBy = null;
    this.round += 1;
    this.revision += 1;

    return { success: true, accepted: true, round: this.round };
  }
}
