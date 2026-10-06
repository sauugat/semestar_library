export const PROTOCOL_VERSION = 1;

export type PlayerSymbol = 'X' | 'O';
export type GameStatus = 'waiting' | 'playing' | 'finished';
export type GameWinner = PlayerSymbol | 'draw' | null;

export interface TicTacToeState {
  gameType: 'tic-tac-toe';
  status: GameStatus;
  players: {
    X: string | null;
    O: string | null;
  };
  board: (PlayerSymbol | null)[];
  currentTurn: PlayerSymbol | null;
  winner: GameWinner;
  winningLine: number[] | null;
  rematchRequestedBy: string | null;
  round: number;
  revision: number;
}

// Client Messages
export interface ClientJoinGameMessage {
  type: 'JOIN_GAME';
}

export interface ClientMakeMoveMessage {
  type: 'MAKE_MOVE';
  cellIndex: number;
}

export interface ClientRequestStateMessage {
  type: 'REQUEST_STATE';
}

export interface ClientRematchMessage {
  type: 'REMATCH';
}

export type ClientMessage =
  | ClientJoinGameMessage
  | ClientMakeMoveMessage
  | ClientRequestStateMessage
  | ClientRematchMessage;

// Server Events
export interface ServerConnectedEvent {
  type: 'CONNECTED';
  roomId: string;
  userId: string;
  protocolVersion: number;
}

export interface ServerPlayerJoinedEvent {
  type: 'PLAYER_JOINED';
  roomId: string;
  userId: string;
  symbol: PlayerSymbol;
  protocolVersion: number;
}

export interface ServerGameStateEvent {
  type: 'GAME_STATE';
  roomId: string;
  state: TicTacToeState;
  protocolVersion: number;
}

export interface ServerMoveAcceptedEvent {
  type: 'MOVE_ACCEPTED';
  roomId: string;
  userId: string;
  symbol: PlayerSymbol;
  cellIndex: number;
  revision: number;
  protocolVersion: number;
}

export interface ServerGameFinishedEvent {
  type: 'GAME_FINISHED';
  roomId: string;
  winner: GameWinner;
  winningLine: number[] | null;
  revision: number;
  protocolVersion: number;
}

export interface ServerErrorEvent {
  type: 'ERROR';
  message: string;
  code?: string;
  protocolVersion: number;
}

export type ServerEvent =
  | ServerConnectedEvent
  | ServerPlayerJoinedEvent
  | ServerGameStateEvent
  | ServerMoveAcceptedEvent
  | ServerGameFinishedEvent
  | ServerErrorEvent;
