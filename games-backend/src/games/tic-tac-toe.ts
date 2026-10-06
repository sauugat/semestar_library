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

export class TicTacToeEngine {
  private status: GameStatus = 'waiting';
  private playerX: string | null = null;
  private playerO: string | null = null;
  private board: (PlayerSymbol | null)[] = Array(9).fill(null);
  private currentTurn: PlayerSymbol | null = null;
  private winner: GameWinner = null;
  private winningLine: number[] | null = null;
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
      if (initialState.winningLine !== undefined) this.winningLine = initialState.winningLine ? [...initialState.winningLine] : null;
      if (typeof initialState.revision === 'number') this.revision = initialState.revision;
    }
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
}
