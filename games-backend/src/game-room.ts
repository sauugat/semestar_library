import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { PROTOCOL_VERSION, type ClientMessage, type ServerEvent } from './protocol';
import { TicTacToeEngine } from './games/tic-tac-toe';

interface RoomAttachment {
  roomId: string;
  userId: string;
}

export class GameRoom extends DurableObject<Env> {
  private game: TicTacToeEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.game = new TicTacToeEngine();
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
        const joinResult = this.game.join(userId);
        if (!joinResult.success) {
          this.sendError(ws, joinResult.error || 'Failed to join game');
          return;
        }

        this.broadcast({
          type: 'GAME_STATE',
          roomId,
          state: this.game.getState(),
          protocolVersion: PROTOCOL_VERSION,
        });
        break;
      }

      case 'MAKE_MOVE': {
        if (typeof (msg as { cellIndex?: unknown }).cellIndex !== 'number') {
          this.sendError(ws, 'Missing or invalid "cellIndex" in MAKE_MOVE message');
          return;
        }

        const moveResult = this.game.makeMove(userId, msg.cellIndex);
        if (!moveResult.success) {
          this.sendError(ws, moveResult.error || 'Invalid move');
          return;
        }

        this.broadcast({
          type: 'GAME_STATE',
          roomId,
          state: this.game.getState(),
          protocolVersion: PROTOCOL_VERSION,
        });
        break;
      }

      case 'REQUEST_STATE': {
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
