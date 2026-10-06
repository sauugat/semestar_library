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

export class GameRoom extends DurableObject<Env> {
  private game: TicTacToeEngine;
  private corruptedStateError: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
    this.game = this.loadState();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS game_state (
        key TEXT PRIMARY KEY,
        game_type TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
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

  private broadcast(event: ServerEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
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
        this.broadcast({
          type: 'GAME_STATE',
          roomId,
          state: this.game.getState(),
          protocolVersion: PROTOCOL_VERSION,
        });
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
        this.broadcast({
          type: 'GAME_STATE',
          roomId,
          state: this.game.getState(),
          protocolVersion: PROTOCOL_VERSION,
        });
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
          protocolVersion: PROTOCOL_VERSION,
        };
        try {
          ws.send(JSON.stringify(stateEvent));
        } catch {}
        break;
      }

      default: {
        this.sendError(ws, `Unknown or unsupported message type: ${(msg as { type?: unknown }).type}`);
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {}
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    try {
      ws.close(1011, 'WebSocket error occurred');
    } catch {}
  }
}
