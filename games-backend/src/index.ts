import { GameRoom } from './game-room';

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

      const id = env.GAME_ROOMS.idFromName(roomId);
      const stub = env.GAME_ROOMS.get(id);
      return stub.fetch(request);
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
