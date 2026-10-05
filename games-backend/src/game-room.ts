import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

interface RoomAttachment {
  roomId: string;
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private resolveRoomId(requestUrl: string): string {
    const url = new URL(requestUrl);
    const match = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : 'unknown';
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

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server, [roomId]);
      server.serializeAttachment({ roomId } satisfies RoomAttachment);

      server.send(
        JSON.stringify({
          type: 'CONNECTED',
          roomId,
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
      ws.send(
        JSON.stringify({
          type: 'ERROR',
          message: 'Invalid JSON',
        })
      );
      return;
    }

    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const roomId = attachment?.roomId || this.ctx.getTags(ws)[0] || 'unknown';

    const broadcast = JSON.stringify({
      type: 'MESSAGE',
      roomId,
      payload: parsed,
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(broadcast);
      } catch {}
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
