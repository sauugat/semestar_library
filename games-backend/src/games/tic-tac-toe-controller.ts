import {
  PROTOCOL_VERSION,
  type PlayerSymbol,
  type TicTacToeState,
  type ClientMessage,
  type ServerEvent,
} from '../protocol';
import { TicTacToeEngine } from './tic-tac-toe';

export interface TicTacToeRoomCallbacks {
  broadcast: (event: ServerEvent) => void;
  sendToSocket: (ws: WebSocket, event: ServerEvent) => void;
  getUserSockets: (userId: string, excludingWs?: WebSocket) => WebSocket[];
  persist: (state: TicTacToeState) => void;
  scheduleAlarm: (deadline: number) => void;
  deleteAlarm: () => void;
  execSql: <T extends Record<string, any>>(query: string, ...params: any[]) => { toArray: () => T[] };
}

interface PendingDisconnect {
  roomId: string;
  userId: string;
  deadline: number;
}

export class TicTacToeController {
  public readonly gameType = 'tic-tac-toe' as const;
  private readonly roomId: string;
  private callbacks: TicTacToeRoomCallbacks;
  private game: TicTacToeEngine;
  private corruptedStateError: string | null = null;
  private pendingDisconnect: PendingDisconnect | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    roomId: string,
    callbacks: TicTacToeRoomCallbacks,
    initialState?: TicTacToeState
  ) {
    this.roomId = roomId;
    this.callbacks = callbacks;
    if (initialState) {
      try {
        this.game = TicTacToeEngine.fromState(initialState);
      } catch (err: unknown) {
        this.corruptedStateError = err instanceof Error ? err.message : String(err);
        this.game = new TicTacToeEngine();
      }
    } else {
      this.game = new TicTacToeEngine();
    }
    this.loadPendingDisconnectGrace();
  }

  public getState(): TicTacToeState {
    return this.game.getState();
  }

  public getRevision(): number {
    return this.game.getState().revision;
  }

  public isCorrupted(): boolean {
    return this.corruptedStateError !== null;
  }

  public getCorruptedError(): string | null {
    return this.corruptedStateError;
  }

  private sendError(ws: WebSocket, message: string, code?: string): void {
    this.callbacks.sendToSocket(ws, {
      type: 'ERROR',
      message,
      ...(code ? { code } : {}),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private getPresence(closingWs?: WebSocket): { X: boolean; O: boolean } {
    const state = this.game.getState();
    const xOnline = state.players.X
      ? this.callbacks.getUserSockets(state.players.X, closingWs).length > 0
      : false;
    const oOnline = state.players.O
      ? this.callbacks.getUserSockets(state.players.O, closingWs).length > 0
      : false;
    return {
      X: xOnline,
      O: oOnline,
    };
  }

  public broadcastGameState(closingWs?: WebSocket): void {
    this.callbacks.broadcast({
      type: 'GAME_STATE',
      roomId: this.roomId,
      state: this.game.getState(),
      presence: this.getPresence(closingWs),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private persistState(state: TicTacToeState): void {
    this.callbacks.persist(state);
  }

  private loadPendingDisconnectGrace(): void {
    try {
      const cursor = this.callbacks.execSql<{ user_id: string; room_id: string; deadline: number }>(
        'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
      );
      const rows = cursor.toArray();
      if (rows.length > 0) {
        const earliest = rows[0];
        const remaining = earliest.deadline - Date.now();
        this.pendingDisconnect = {
          roomId: earliest.room_id,
          userId: earliest.user_id,
          deadline: earliest.deadline,
        };
        if (remaining <= 0) {
          void this.handleDisconnectTimeout(earliest.room_id, earliest.user_id);
        } else {
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => {
            void this.handleDisconnectTimeout(earliest.room_id, earliest.user_id);
          }, remaining);
          try {
            this.callbacks.scheduleAlarm(earliest.deadline);
          } catch {}
        }
      }
    } catch {}
  }

  private scheduleDisconnectGrace(roomId: string, userId: string, timeoutMs: number = 30_000): void {
    this.clearDisconnectGrace(userId);
    const deadline = Date.now() + timeoutMs;
    this.pendingDisconnect = { roomId, userId, deadline };
    try {
      this.callbacks.execSql(
        'INSERT OR REPLACE INTO disconnect_grace (user_id, room_id, deadline) VALUES (?, ?, ?)',
        userId,
        roomId,
        deadline
      );
      this.callbacks.scheduleAlarm(deadline);
    } catch {}

    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = setTimeout(() => {
      void this.handleDisconnectTimeout(roomId, userId);
    }, timeoutMs);
  }

  private clearDisconnectGrace(userId: string): boolean {
    let cleared = false;
    if (this.pendingDisconnect?.userId === userId) {
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      this.pendingDisconnect = null;
      cleared = true;
    }
    try {
      this.callbacks.execSql('DELETE FROM disconnect_grace WHERE user_id = ?', userId);
      const remainingRows = this.callbacks
        .execSql<{ deadline: number }>(
          'SELECT deadline FROM disconnect_grace ORDER BY deadline ASC'
        )
        .toArray();
      if (remainingRows.length > 0) {
        this.callbacks.scheduleAlarm(remainingRows[0].deadline);
      } else {
        this.callbacks.deleteAlarm();
      }
    } catch {}
    return cleared;
  }

  public async handleDisconnectTimeout(roomId: string, userId: string): Promise<void> {
    this.clearDisconnectGrace(userId);

    const activeSockets = this.callbacks.getUserSockets(userId);
    if (activeSockets.length > 0) {
      return;
    }

    const state = this.game.getState();
    if (state.status !== 'playing') {
      return;
    }

    const xOnline = state.players.X
      ? this.callbacks.getUserSockets(state.players.X).length > 0
      : false;
    const oOnline = state.players.O
      ? this.callbacks.getUserSockets(state.players.O).length > 0
      : false;

    const candidate = this.game.clone();
    if (!xOnline && !oOnline) {
      // Both players offline: neutral abandonment / draw
      const abandonResult = candidate.abandon('timeout');
      if (!abandonResult.success) {
        return;
      }
    } else {
      // One player offline, other online: forfeit win for online player
      const forfeitResult = candidate.forfeit(userId, 'timeout');
      if (!forfeitResult.success) {
        return;
      }
    }

    try {
      this.persistState(candidate.getState());
    } catch {
      return;
    }

    this.game = candidate;
    this.broadcastGameState();
  }

  public async handleAlarm(): Promise<void> {
    try {
      const cursor = this.callbacks.execSql<{ user_id: string; room_id: string; deadline: number }>(
        'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
      );
      const rows = cursor.toArray();
      const now = Date.now();
      for (const row of rows) {
        if (row.deadline <= now + 1000) {
          await this.handleDisconnectTimeout(row.room_id, row.user_id);
        }
      }
      const nextRows = this.callbacks
        .execSql<{ deadline: number }>(
          'SELECT deadline FROM disconnect_grace ORDER BY deadline ASC'
        )
        .toArray();
      if (nextRows.length > 0) {
        this.callbacks.scheduleAlarm(nextRows[0].deadline);
      }
    } catch {}
  }

  public handleConnect(ws: WebSocket, userId: string): void {
    const hadPendingDisconnect = this.clearDisconnectGrace(userId);
    if (hadPendingDisconnect) {
      this.broadcastGameState();
    }
  }

  public handleDisconnect(userId: string, closingWs?: WebSocket): void {
    const remainingSockets = this.callbacks.getUserSockets(userId, closingWs);
    if (remainingSockets.length > 0) {
      return;
    }

    const state = this.game.getState();
    if (state.players.X === userId || state.players.O === userId) {
      if (state.status === 'playing') {
        const opponentId = userId === state.players.X ? state.players.O : state.players.X;
        const opponentOnline = opponentId
          ? this.callbacks.getUserSockets(opponentId, closingWs).length > 0
          : false;
        if (opponentOnline) {
          this.scheduleDisconnectGrace(this.roomId, userId);
          this.broadcastGameState(closingWs);
        }
      }
    }
  }

  public async handleMessage(ws: WebSocket, userId: string, rawMsg: unknown): Promise<void> {
    const msg = rawMsg as ClientMessage;

    switch (msg.type) {
      case 'JOIN_GAME': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        const candidate = this.game.clone();
        const joinResult = candidate.join(userId);
        if (!joinResult.success) {
          this.sendError(ws, joinResult.error || 'Failed to join game');
          return;
        }

        if (joinResult.isNewJoin) {
          try {
            this.persistState(candidate.getState());
          } catch {
            this.sendError(ws, 'Failed to persist game state');
            return;
          }
        }

        this.game = candidate;
        this.broadcastGameState();
        break;
      }

      case 'MAKE_MOVE': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        if (typeof (msg as { cellIndex?: unknown }).cellIndex !== 'number') {
          this.sendError(ws, 'Missing or invalid "cellIndex" in MAKE_MOVE message');
          return;
        }

        const candidate = this.game.clone();
        const moveResult = candidate.makeMove(userId, msg.cellIndex);
        if (!moveResult.success) {
          this.sendError(ws, moveResult.error || 'Invalid move');
          return;
        }

        try {
          this.persistState(candidate.getState());
        } catch {
          this.sendError(ws, 'Failed to persist game state');
          return;
        }

        this.game = candidate;
        this.broadcastGameState();
        break;
      }

      case 'REQUEST_STATE': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        const stateEvent: ServerEvent = {
          type: 'GAME_STATE',
          roomId: this.roomId,
          state: this.game.getState(),
          presence: this.getPresence(),
          protocolVersion: PROTOCOL_VERSION,
        };
        try {
          ws.send(JSON.stringify(stateEvent));
        } catch {}
        break;
      }

      case 'REMATCH': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        const state = this.game.getState();
        const opponentId = userId === state.players.X ? state.players.O : state.players.X;
        const isOpponentOnline = opponentId
          ? this.callbacks.getUserSockets(opponentId).length > 0
          : false;

        if (
          state.rematchRequestedBy !== null &&
          state.rematchRequestedBy !== userId &&
          !isOpponentOnline
        ) {
          this.sendError(ws, 'Cannot start rematch while opponent is offline.');
          return;
        }

        const candidate = this.game.clone();
        const rematchResult = candidate.requestRematch(userId);
        if (!rematchResult.success) {
          this.sendError(ws, rematchResult.error || 'Failed to request rematch');
          return;
        }

        if (!rematchResult.isIdempotent) {
          try {
            this.persistState(candidate.getState());
          } catch {
            this.sendError(ws, 'Failed to persist game state');
            return;
          }
        }

        this.game = candidate;
        this.broadcastGameState();
        break;
      }

      case 'LEAVE_ROOM': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        const candidate = this.game.clone();
        const forfeitResult = candidate.forfeit(userId, 'leave');
        if (!forfeitResult.success) {
          this.sendError(ws, forfeitResult.error || 'Failed to leave game');
          return;
        }

        try {
          this.persistState(candidate.getState());
        } catch {
          this.sendError(ws, 'Failed to persist game state');
          return;
        }

        this.game = candidate;
        this.broadcastGameState();
        break;
      }

      default:
        this.sendError(ws, `Unknown or unsupported message type: ${(msg as { type?: unknown }).type}`);
        break;
    }
  }
}
