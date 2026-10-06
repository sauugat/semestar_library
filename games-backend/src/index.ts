import { GameRoom } from './game-room';
import { verifyGamesTicket } from './auth/games-ticket';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  GAMES_TICKET_SECRET: string;
}

export { GameRoom };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'semester-library-games',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Match /rooms/:roomId/ws
    const roomWsMatch = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)\/ws\/?$/);
    if (roomWsMatch) {
      const roomId = roomWsMatch[1];
      if (request.method !== 'GET') {
        return new Response(
          JSON.stringify({ error: 'Method Not Allowed' }),
          {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const isWsUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
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

      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const ticket = authHeader.slice(7).trim();
      if (!ticket) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const verifyResult = await verifyGamesTicket(ticket, env.GAMES_TICKET_SECRET);
      if (!verifyResult.valid) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.delete('Authorization');

      // Strip any client-supplied identity headers to prevent spoofing
      for (const headerKey of Array.from(forwardHeaders.keys())) {
        if (headerKey.toLowerCase().startsWith('x-games-')) {
          forwardHeaders.delete(headerKey);
        }
      }

      // Inject identity strictly from verified ticket claims
      forwardHeaders.set('X-Games-User-Id', verifyResult.payload.sub);
      if (verifyResult.payload.username) {
        forwardHeaders.set('X-Games-Username', verifyResult.payload.username);
      }
      if (verifyResult.payload.name) {
        forwardHeaders.set('X-Games-Name', verifyResult.payload.name);
      }
      if (verifyResult.payload.avatarUrl) {
        forwardHeaders.set('X-Games-Avatar-Url', verifyResult.payload.avatarUrl);
      }

      const forwardedRequest = new Request(request, {
        headers: forwardHeaders,
      });

      const id = env.GAME_ROOMS.idFromName(roomId);
      const stub = env.GAME_ROOMS.get(id);
      return stub.fetch(forwardedRequest);
    }

    // Match /rooms/:roomId
    const roomMatch = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)\/?$/);
    if (roomMatch) {
      const roomId = roomMatch[1];
      const id = env.GAME_ROOMS.idFromName(roomId);
      const stub = env.GAME_ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response(
      JSON.stringify({ error: 'Not Found' }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  },
};
