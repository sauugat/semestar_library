import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerEvent,
  type TicTacToeState,
} from './protocol';
import { TicTacToeEngine } from './games/tic-tac-toe';

interface RoomAttachment {
  roomId: string;
  userId: string;
}

interface PendingDisconnect {
  roomId: string;
  userId: string;
  deadline: number;
}

export class GameRoom extends DurableObject<Env> {
  private game: TicTacToeEngine;
  private corruptedStateError: string | null = null;
  private pendingDisconnect: PendingDisconnect | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
    this.game = this.loadState();
    this.loadPendingDisconnectGrace();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS game_state (
        key TEXT PRIMARY KEY,
        game_type TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS disconnect_grace (
        user_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        deadline INTEGER NOT NULL
      );
    `);
  }

  private loadPendingDisconnectGrace(): void {
    try {
      const cursor = this.ctx.storage.sql.exec<{ user_id: string; room_id: string; deadline: number }>(
        'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
      );
      const rows = cursor.toArray();
      if (rows.length > 0) {
        const earliest = rows[0];
        const remaining = earliest.deadline - Date.now();
        this.pendingDisconnect = { roomId: earliest.room_id, userId: earliest.user_id, deadline: earliest.deadline };
        if (remaining <= 0) {
          void this.handleDisconnectTimeout(earliest.room_id, earliest.user_id);
        } else {
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => {
            void this.handleDisconnectTimeout(earliest.room_id, earliest.user_id);
          }, remaining);
          try {
            void this.ctx.storage.setAlarm(earliest.deadline);
          } catch {}
        }
      }
    } catch {}
  }

  private loadState(): TicTacToeEngine {
    try {
      const cursor = this.ctx.storage.sql.exec<{ state_json: string }>(
        'SELECT state_json FROM game_state WHERE key = ?',
        'current'
      );
      const rows = cursor.toArray();
      if (rows.length > 0) {
        const parsed = JSON.parse(rows[0].state_json);
        return TicTacToeEngine.fromState(parsed);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.corruptedStateError = errorMsg;
      return new TicTacToeEngine();
    }
    return new TicTacToeEngine();
  }

  private persistState(state: TicTacToeState): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO game_state (key, game_type, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         game_type = excluded.game_type,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
      'current',
      'tic-tac-toe',
      JSON.stringify(state),
      Date.now()
    );
  }

  private resolveRoomId(requestUrl: string): string {
    const url = new URL(requestUrl);
    const match = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : 'unknown';
  }

  private getUserSockets(userId: string, excludingWs?: WebSocket): WebSocket[] {
    const matching: WebSocket[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (excludingWs && socket === excludingWs) continue;
      if ('readyState' in socket && typeof (socket as { readyState?: unknown }).readyState === 'number') {
        // 1 is WebSocket.OPEN
        if ((socket as unknown as { readyState: number }).readyState !== 1) {
          continue;
        }
      }
      try {
        const attachment = socket.deserializeAttachment() as RoomAttachment | null;
        if (attachment?.userId === userId) {
          matching.push(socket);
        }
      } catch {}
    }
    return matching;
  }

  private getPresence(closingWs?: WebSocket): { X: boolean; O: boolean } {
    const state = this.game.getState();
    const xOnline = state.players.X ? this.getUserSockets(state.players.X, closingWs).length > 0 : false;
    const oOnline = state.players.O ? this.getUserSockets(state.players.O, closingWs).length > 0 : false;
    return {
      X: xOnline,
      O: oOnline,
    };
  }

  private broadcast(event: ServerEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  private broadcastGameState(roomId: string, closingWs?: WebSocket): void {
    this.broadcast({
      type: 'GAME_STATE',
      roomId,
      state: this.game.getState(),
      presence: this.getPresence(closingWs),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private sendError(ws: WebSocket, message: string, code?: string): void {
    const errorEvent: ServerEvent = {
      type: 'ERROR',
      message,
      ...(code ? { code } : {}),
      protocolVersion: PROTOCOL_VERSION,
    };
    try {
      ws.send(JSON.stringify(errorEvent));
    } catch {}
  }

  private scheduleDisconnectGrace(roomId: string, userId: string, timeoutMs: number = 30_000): void {
    this.clearDisconnectGrace(userId);
    const deadline = Date.now() + timeoutMs;
    this.pendingDisconnect = { roomId, userId, deadline };
    try {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO disconnect_grace (user_id, room_id, deadline) VALUES (?, ?, ?)',
        userId,
        roomId,
        deadline
      );
      void this.ctx.storage.setAlarm(deadline);
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
      this.ctx.storage.sql.exec('DELETE FROM disconnect_grace WHERE user_id = ?', userId);
      const remainingRows = this.ctx.storage.sql.exec<{ deadline: number }>(
        'SELECT deadline FROM disconnect_grace ORDER BY deadline ASC'
      ).toArray();
      if (remainingRows.length > 0) {
        void this.ctx.storage.setAlarm(remainingRows[0].deadline);
      } else {
        void this.ctx.storage.deleteAlarm();
      }
    } catch {}
    return cleared;
  }

  public async handleDisconnectTimeout(roomId: string, userId: string): Promise<void> {
    this.clearDisconnectGrace(userId);

    const activeSockets = this.getUserSockets(userId);
    if (activeSockets.length > 0) {
      return;
    }

    const state = this.game.getState();
    if (state.status !== 'playing') {
      return;
    }

    const xOnline = state.players.X ? this.getUserSockets(state.players.X).length > 0 : false;
    const oOnline = state.players.O ? this.getUserSockets(state.players.O).length > 0 : false;

    const candidate = this.game.clone();
    if (!xOnline && !oOnline) {
      // Both players are offline: neutral abandonment / draw, do not invent a winner!
      const abandonResult = candidate.abandon('timeout');
      if (!abandonResult.success) {
        return;
      }
    } else {
      // One player is offline, the other is online: forfeit win for online player
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
    this.broadcastGameState(roomId);
  }

  async alarm(): Promise<void> {
    try {
      const cursor = this.ctx.storage.sql.exec<{ user_id: string; room_id: string; deadline: number }>(
        'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
      );
      const rows = cursor.toArray();
      const now = Date.now();
      for (const row of rows) {
        if (row.deadline <= now + 1000) {
          await this.handleDisconnectTimeout(row.room_id, row.user_id);
        }
      }
      const nextRows = this.ctx.storage.sql.exec<{ deadline: number }>(
        'SELECT deadline FROM disconnect_grace ORDER BY deadline ASC'
      ).toArray();
      if (nextRows.length > 0) {
        await this.ctx.storage.setAlarm(nextRows[0].deadline);
      }
    } catch {}
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = this.resolveRoomId(request.url);

    const isWsRoute = url.pathname.endsWith('/ws');
    const isWsUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

    if (isWsRoute) {
      if (!isWsUpgrade) {
        return new Response(
          JSON.stringify({
            error: 'Upgrade Required',
            message: 'Expected WebSocket connection (Upgrade: websocket)',
          }),
          {
            status: 426,
            headers: {
              'Content-Type': 'application/json',
              'Upgrade': 'websocket',
            },
          }
        );
      }

      const userId = request.headers.get('X-Games-User-Id');
      if (!userId) {
        return new Response(
          JSON.stringify({
            error: 'Unauthorized',
            message: 'Missing trusted identity header',
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server, [roomId, userId]);
      server.serializeAttachment({ roomId, userId } satisfies RoomAttachment);

      server.send(
        JSON.stringify({
          type: 'CONNECTED',
          roomId,
          userId,
          protocolVersion: PROTOCOL_VERSION,
        })
      );

      // If user had an active disconnect grace period and reconnected:
      const hadPendingDisconnect = this.clearDisconnectGrace(userId);
      if (hadPendingDisconnect) {
        this.broadcastGameState(roomId);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response(
      JSON.stringify({
        status: 'ok',
        roomId,
        service: 'semester-library-games-room',
        gameType: 'tic-tac-toe',
        revision: this.game.getState().revision,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let rawText: string;
    if (typeof message === 'string') {
      rawText = message;
    } else {
      rawText = new TextDecoder().decode(message);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      this.sendError(ws, 'Invalid JSON format');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      this.sendError(ws, 'Message must be an object with a "type" field');
      return;
    }

    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const roomId = attachment?.roomId || 'unknown';
    const userId = attachment?.userId;

    if (!userId) {
      this.sendError(ws, 'Unauthorized: session has no attached user identity');
      return;
    }

    const msg = parsed as ClientMessage;

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
        this.broadcastGameState(roomId);
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
        this.broadcastGameState(roomId);
        break;
      }

      case 'REQUEST_STATE': {
        if (this.corruptedStateError) {
          this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`);
          return;
        }

        const stateEvent: ServerEvent = {
          type: 'GAME_STATE',
          roomId,
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
        const isOpponentOnline = opponentId ? this.getUserSockets(opponentId).length > 0 : false;

        // Block rematch acceptance if opponent is currently offline
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
        this.broadcastGameState(roomId);
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
        this.broadcastGameState(roomId);
        break;
      }

      default: {
        this.sendError(ws, `Unknown or unsupported message type: ${(msg as { type?: unknown }).type}`);
        break;
      }
    }
  }

  private handleSocketDisconnect(roomId: string, userId: string, closingWs?: WebSocket): void {
    const remainingSockets = this.getUserSockets(userId, closingWs);
    if (remainingSockets.length > 0) {
      return;
    }

    const state = this.game.getState();
    if (state.players.X === userId || state.players.O === userId) {
      if (state.status === 'playing') {
        const opponentId = userId === state.players.X ? state.players.O : state.players.X;
        const opponentOnline = opponentId ? this.getUserSockets(opponentId, closingWs).length > 0 : false;
        if (opponentOnline) {
          this.scheduleDisconnectGrace(roomId, userId);
          this.broadcastGameState(roomId, closingWs);
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const roomId = attachment?.roomId || 'unknown';
    const userId = attachment?.userId;
    try {
      ws.close(code, reason);
    } catch {}
    if (userId) {
      this.handleSocketDisconnect(roomId, userId, ws);
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const roomId = attachment?.roomId || 'unknown';
    const userId = attachment?.userId;
    try {
      ws.close(1011, 'WebSocket error occurred');
    } catch {}
    if (userId) {
      this.handleSocketDisconnect(roomId, userId, ws);
    }
  }
}
