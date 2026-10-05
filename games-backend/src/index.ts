import { GameRoom } from './game-room';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
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
