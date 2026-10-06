export const PROTOCOL_VERSION = 1;

export type PlayerSymbol = 'X' | 'O';
export type GameStatus = 'waiting' | 'playing' | 'finished';
export type GameWinner = PlayerSymbol | 'draw' | null;

export type GameFinishReason = 'win' | 'draw' | 'leave' | 'timeout' | null;

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
  finishReason?: GameFinishReason;
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

export interface ClientLeaveRoomMessage {
  type: 'LEAVE_ROOM';
}

export type ClientMessage =
  | ClientJoinGameMessage
  | ClientMakeMoveMessage
  | ClientRequestStateMessage
  | ClientRematchMessage
  | ClientLeaveRoomMessage;

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

export interface ServerPlayerPresenceEvent {
  type: 'PLAYER_PRESENCE';
  roomId: string;
  userId: string;
  online: boolean;
  protocolVersion: number;
}

export interface ServerGameStateEvent {
  type: 'GAME_STATE';
  roomId: string;
  state: TicTacToeState;
  presence?: {
    X: boolean;
    O: boolean;
  };
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
  finishReason?: GameFinishReason;
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
  | ServerPlayerPresenceEvent
  | ServerGameStateEvent
  | ServerMoveAcceptedEvent
  | ServerGameFinishedEvent
  | ServerErrorEvent;
