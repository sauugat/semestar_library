import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import {
  PROTOCOL_VERSION,
  type ServerEvent,
  type TicTacToeState,
} from './protocol';
import {
  TicTacToeController,
  type TicTacToeRoomCallbacks,
} from './games/tic-tac-toe-controller';
import { TicTacToeEngine } from './games/tic-tac-toe';
import {
  LudoOnlineController,
  type LudoRoomCallbacks,
  type LudoControllerOptions,
} from './games/ludo/index';
import type { LudoRoomState, LudoServerEvent, LudoUserSession } from './games/ludo/types';

interface RoomAttachment {
  roomId: string;
  userId: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
}

export class GameRoom extends DurableObject<Env> {
  private ticTacToeController: TicTacToeController | null = null;
  private ludoController: LudoOnlineController | null = null;
  private roomGameType: 'tic-tac-toe' | 'ludo' | null = null;
  private corruptedStateError: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
    this.loadState();
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

  private isHistoricalTicTacToe(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    const s = data as Record<string, unknown>;
    return (
      Array.isArray(s.board) &&
      s.board.length === 9 &&
      typeof s.currentTurn === 'string' &&
      typeof s.status === 'string' &&
      typeof s.players === 'object' &&
      s.players !== null &&
      'X' in s.players &&
      'O' in s.players &&
      typeof s.revision === 'number'
    );
  }

  private loadState(): void {
    try {
      const cursor = this.ctx.storage.sql.exec<{ game_type: string; state_json: string }>(
        'SELECT game_type, state_json FROM game_state WHERE key = ?',
        'current'
      );
      const rows = cursor.toArray();
      if (rows.length > 0) {
        const row = rows[0];
        const parsed = JSON.parse(row.state_json);
        if (row.game_type === 'ludo' || parsed.gameType === 'ludo') {
          this.roomGameType = 'ludo';
          this.ludoController = LudoOnlineController.fromState(
            this.resolveRoomId(),
            this.createLudoCallbacks() as any,
            parsed
          );
          if (this.ludoController.isCorrupted()) {
            this.corruptedStateError = this.ludoController.getCorruptedError();
          }
        } else if (
          row.game_type === 'tic-tac-toe' ||
          parsed.gameType === 'tic-tac-toe' ||
          this.isHistoricalTicTacToe(parsed)
        ) {
          this.roomGameType = 'tic-tac-toe';
          this.ticTacToeController = new TicTacToeController(
            this.resolveRoomId(),
            this.createTicTacToeCallbacks() as any,
            parsed
          );
          if (this.ticTacToeController.isCorrupted()) {
            this.corruptedStateError = this.ticTacToeController.getCorruptedError();
          }
        } else {
          this.corruptedStateError = 'Unrecognized persisted game state schema';
        }
      }
    } catch (err: unknown) {
      this.corruptedStateError = err instanceof Error ? err.message : String(err);
    }
  }

  private resolveRoomId(requestUrl?: string): string {
    if (requestUrl) {
      const url = new URL(requestUrl);
      const match = url.pathname.match(/^\/rooms\/([a-zA-Z0-9_-]+)/);
      if (match) return match[1];
    }
    // Attempt to extract from first WebSocket attachment if available
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as RoomAttachment | null;
        if (attachment?.roomId) return attachment.roomId;
      } catch {}
    }
    return 'unknown';
  }

  private getUserSockets(userId: string, excludingWs?: WebSocket): WebSocket[] {
    const matching: WebSocket[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (excludingWs && socket === excludingWs) continue;
      if ('readyState' in socket && typeof (socket as { readyState?: unknown }).readyState === 'number') {
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

  private broadcast(event: unknown): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  private sendToSocket(ws: WebSocket, event: unknown): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {}
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

  private createTicTacToeCallbacks(): TicTacToeRoomCallbacks {
    return {
      broadcast: (event) => this.broadcast(event),
      sendToSocket: (ws, event) => this.sendToSocket(ws, event),
      getUserSockets: (userId, excluding) => this.getUserSockets(userId, excluding),
      persist: (state: TicTacToeState) => {
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
      },
      scheduleAlarm: (deadline: number) => {
        try {
          void this.ctx.storage.setAlarm(deadline);
        } catch {}
      },
      deleteAlarm: () => {
        try {
          void this.ctx.storage.deleteAlarm();
        } catch {}
      },
      execSql: <T extends Record<string, any>>(query: string, ...params: any[]) => {
        return this.ctx.storage.sql.exec<T>(query, ...params);
      },
    };
  }

  private createLudoCallbacks(): LudoRoomCallbacks {
    return {
      broadcast: (event: LudoServerEvent) => this.broadcast(event),
      sendToSocket: (ws: WebSocket, event: LudoServerEvent) => this.sendToSocket(ws, event),
      getUserSockets: (userId: string) => this.getUserSockets(userId),
      persist: (state: LudoRoomState) => {
        this.ctx.storage.sql.exec(
          `INSERT INTO game_state (key, game_type, state_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             game_type = excluded.game_type,
             state_json = excluded.state_json,
             updated_at = excluded.updated_at`,
          'current',
          'ludo',
          JSON.stringify(state),
          Date.now()
        );
      },
    };
  }

  public getLudoController(options?: LudoControllerOptions): LudoOnlineController {
    if (!this.ludoController) {
      this.roomGameType = 'ludo';
      this.ludoController = new LudoOnlineController(
        this.resolveRoomId(),
        this.createLudoCallbacks(),
        undefined,
        options
      );
    } else if (options?.diceRoller) {
      this.ludoController.setDiceRoller(options.diceRoller);
    }
    return this.ludoController;
  }

  public getTicTacToeController(): TicTacToeController {
    if (!this.ticTacToeController) {
      this.roomGameType = 'tic-tac-toe';
      this.ticTacToeController = new TicTacToeController(
        this.resolveRoomId(),
        this.createTicTacToeCallbacks()
      );
    }
    return this.ticTacToeController;
  }

  async alarm(): Promise<void> {
    if (this.ticTacToeController) {
      await this.ticTacToeController.handleAlarm();
    }
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

      const username = request.headers.get('X-Games-Username') || undefined;
      const name = request.headers.get('X-Games-Name') || undefined;
      const avatarUrl = request.headers.get('X-Games-Avatar-Url') || undefined;

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server, [roomId, userId]);
      server.serializeAttachment({
        roomId,
        userId,
        username,
        name,
        avatarUrl,
      } satisfies RoomAttachment);

      server.send(
        JSON.stringify({
          type: 'CONNECTED',
          roomId,
          userId,
          protocolVersion: PROTOCOL_VERSION,
        })
      );

      // Notify controller if already initialized
      if (this.roomGameType === 'tic-tac-toe' && this.ticTacToeController) {
        this.ticTacToeController.handleConnect(server, userId);
      } else if (this.roomGameType === 'ludo' && this.ludoController) {
        this.ludoController.handleConnect(server, userId);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    const revision =
      this.roomGameType === 'tic-tac-toe' && this.ticTacToeController
        ? this.ticTacToeController.getRevision()
        : this.roomGameType === 'ludo' && this.ludoController
        ? this.ludoController.getRevision()
        : 0;

    return new Response(
      JSON.stringify({
        status: 'ok',
        roomId,
        service: 'semester-library-games-room',
        gameType: this.roomGameType || 'tic-tac-toe',
        revision,
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

    const session: LudoUserSession = {
      userId,
      username: attachment?.username,
      name: attachment?.name,
      avatarUrl: attachment?.avatarUrl,
    };

    const msgType = String((parsed as { type: string }).type);
    const isLudoMessage = msgType.startsWith('LUDO_');

    // 1. Check room type immutability
    if (this.roomGameType === 'tic-tac-toe' && isLudoMessage) {
      this.sendError(
        ws,
        'Room is a tic-tac-toe match, not ludo',
        'ROOM_GAME_TYPE_MISMATCH'
      );
      return;
    }

    if (this.roomGameType === 'ludo' && !isLudoMessage) {
      this.sendError(
        ws,
        'Room is a ludo match, not tic-tac-toe',
        'ROOM_GAME_TYPE_MISMATCH'
      );
      return;
    }

    // 2. Initialize controller if room was previously uninitialized
    if (isLudoMessage) {
      if (!this.ludoController) {
        this.roomGameType = 'ludo';
        this.ludoController = new LudoOnlineController(roomId, this.createLudoCallbacks());
      }
      await this.ludoController.handleMessage(ws, session, parsed);
    } else {
      if (!this.ticTacToeController) {
        this.roomGameType = 'tic-tac-toe';
        this.ticTacToeController = new TicTacToeController(roomId, this.createTicTacToeCallbacks());
      }
      await this.ticTacToeController.handleMessage(ws, userId, parsed);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const userId = attachment?.userId;
    try {
      ws.close(code, reason);
    } catch {}

    if (userId) {
      if (this.roomGameType === 'tic-tac-toe' && this.ticTacToeController) {
        this.ticTacToeController.handleDisconnect(userId, ws);
      } else if (this.roomGameType === 'ludo' && this.ludoController) {
        this.ludoController.handleDisconnect(userId);
      }
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    const userId = attachment?.userId;
    try {
      ws.close(1011, 'WebSocket error occurred');
    } catch {}

    if (userId) {
      if (this.roomGameType === 'tic-tac-toe' && this.ticTacToeController) {
        this.ticTacToeController.handleDisconnect(userId, ws);
      } else if (this.roomGameType === 'ludo' && this.ludoController) {
        this.ludoController.handleDisconnect(userId);
      }
    }
  }
}
