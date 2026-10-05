import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)/);
    const roomId = roomMatch ? roomMatch[1] : request.headers.get('x-room-id') || 'unknown';

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
}
