import {
  LudoEngine,
  createStandardDiceRoller,
  selectBotMove,
  getTraversedCoordinates,
  validateLudoState,
  type PlayerColor,
  type BotDifficulty,
  type LudoState,
  type LudoPlayerInit,
  type DiceRoller,
} from '../../../../packages/ludo-engine/src/index.ts';

import {
  type LudoSeat,
  type LudoRoomState,
  type LudoLobbyState,
  type LudoClientMessage,
  type LudoServerEvent,
  type LudoUserSession,
  LUDO_RECONNECT_GRACE_MS,
  LUDO_TAKEOVER_BOT_DIFFICULTY,
} from './types.ts';

const PROTOCOL_VERSION = 1;
const CANONICAL_COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export const MAX_BOT_TURNS_PER_ACTION = 20;

export function generateAuthoritativeDiceRoll(): number {
  const buf = new Uint8Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= 252);
  return (buf[0] % 6) + 1;
}

export function createCryptographicDiceRoller(): DiceRoller {
  return {
    roll: () => generateAuthoritativeDiceRoll(),
  };
}

export function computeLudoDisplayRankings(
  engineRankings: PlayerColor[],
  activeColors: PlayerColor[],
  seats: Record<PlayerColor, LudoSeat>
): PlayerColor[] {
  const isAbandoned = (color: PlayerColor): boolean => {
    const seat = seats[color];
    return seat ? seat.controlMode === 'takeover-bot' : false;
  };

  const nonAbandonedActive = activeColors.filter((c) => !isAbandoned(c));
  const abandonedActive = activeColors.filter((c) => isAbandoned(c));

  // 1. Non-abandoned: preserve canonical engine finishing order first
  const nonAbandonedFinished = engineRankings.filter((c) => nonAbandonedActive.includes(c));
  const nonAbandonedUnfinished = nonAbandonedActive.filter((c) => !nonAbandonedFinished.includes(c));
  const nonAbandonedOrdered = [...nonAbandonedFinished, ...nonAbandonedUnfinished];

  // 2. Abandoned: later abandonment ranks ahead of earlier abandonment (descending abandonedAt)
  const abandonedOrdered = [...abandonedActive].sort((a, b) => {
    const timeA = seats[a]?.abandonedAt ?? 0;
    const timeB = seats[b]?.abandonedAt ?? 0;
    if (timeB !== timeA) {
      return timeB - timeA; // larger timestamp (later) comes first
    }
    return activeColors.indexOf(a) - activeColors.indexOf(b);
  });

  return [...nonAbandonedOrdered, ...abandonedOrdered];
}

export interface LudoRoomCallbacks {
  broadcast: (event: LudoServerEvent) => void;
  sendToSocket: (ws: WebSocket, event: LudoServerEvent) => void;
  getUserSockets: (userId: string, excludingWs?: WebSocket) => WebSocket[];
  persist: (state: LudoRoomState) => void;
  scheduleAlarm?: (deadline: number) => void;
  deleteAlarm?: () => void;
  execSql?: <T extends Record<string, any>>(query: string, ...params: any[]) => { toArray: () => T[] };
}

export interface LudoControllerOptions {
  diceRoller?: DiceRoller;
  now?: () => number;
}

interface PendingDisconnect {
  roomId: string;
  userId: string;
  deadline: number;
}

function createDefaultSeats(): Record<PlayerColor, LudoSeat> {
  return {
    red: { color: 'red', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
    green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
    yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
    blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
  };
}

export class LudoOnlineController {
  public readonly gameType = 'ludo' as const;
  private readonly roomId: string;
  private callbacks: LudoRoomCallbacks;
  private diceRoller: DiceRoller;
  private readonly now: () => number;

  private state: LudoRoomState;
  private engine: LudoEngine | null = null;
  private corruptedStateError: string | null = null;

  private pendingDisconnects = new Map<string, PendingDisconnect>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    roomId: string,
    callbacks: LudoRoomCallbacks,
    initialState?: LudoRoomState,
    options: LudoControllerOptions = {}
  ) {
    this.roomId = roomId;
    this.callbacks = callbacks;
    this.diceRoller = options.diceRoller || createCryptographicDiceRoller();
    this.now = options.now || (() => Date.now());

    if (initialState) {
      this.state = initialState;
      if (!this.state.roomGeneration) {
        this.state.roomGeneration = 1;
      }
      // Normalize missing 4C1 fields for legacy pre-4C1 states
      for (const color of CANONICAL_COLORS) {
        const s = this.state.seats[color];
        if (s.status === 'human') {
          if (!s.controlMode) s.controlMode = 'human';
          if (!s.presence) s.presence = 'online';
        } else if (s.status === 'bot') {
          if (!s.controlMode) s.controlMode = 'bot';
          if (!s.presence) s.presence = 'online';
        }
      }
      if (this.state.status === 'finished' && !this.state.displayRankings && this.state.rankings) {
        this.state.displayRankings = [...this.state.rankings];
      }
      if (initialState.engineState) {
        try {
          this.engine = LudoEngine.fromState(initialState.engineState);
        } catch (err: unknown) {
          this.corruptedStateError = err instanceof Error ? err.message : String(err);
        }
      }
    } else {
      const now = this.now();
      this.state = {
        gameType: 'ludo',
        roomId,
        status: 'lobby',
        hostUserId: null,
        seats: createDefaultSeats(),
        activeSeatCount: 2,
        engineState: null,
        rankings: [],
        createdAt: now,
        updatedAt: now,
        revision: 0,
        roomGeneration: 1,
      };
    }
    this.loadPendingDisconnectGrace();
  }

  private loadPendingDisconnectGrace(): void {
    if (this.callbacks.execSql) {
      try {
        const cursor = this.callbacks.execSql<{ user_id: string; room_id: string; deadline: number }>(
          'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
        );
        const rows = cursor.toArray();
        const now = this.now();
        let earliestFutureDeadline: number | null = null;

        for (const row of rows) {
          this.pendingDisconnects.set(row.user_id, {
            roomId: row.room_id,
            userId: row.user_id,
            deadline: row.deadline,
          });

          const remaining = row.deadline - now;
          if (remaining <= 0) {
            void this.handleDisconnectTimeout(row.room_id, row.user_id);
          } else {
            const timer = setTimeout(() => {
              void this.handleDisconnectTimeout(row.room_id, row.user_id);
            }, remaining);
            if (typeof (timer as any).unref === 'function') {
              (timer as any).unref();
            }
            this.disconnectTimers.set(row.user_id, timer);

            if (earliestFutureDeadline === null || row.deadline < earliestFutureDeadline) {
              earliestFutureDeadline = row.deadline;
            }
          }
        }

        if (earliestFutureDeadline !== null && this.callbacks.scheduleAlarm) {
          try {
            this.callbacks.scheduleAlarm(earliestFutureDeadline);
          } catch {}
        }
      } catch {}
    }

    if (this.state.status === 'playing') {
      const now = this.now();
      for (const color of CANONICAL_COLORS) {
        const seat = this.state.seats[color];
        if (
          seat.status === 'human' &&
          seat.userId &&
          seat.presence === 'reconnecting' &&
          seat.disconnectDeadline &&
          !this.pendingDisconnects.has(seat.userId)
        ) {
          const remaining = seat.disconnectDeadline - now;
          this.pendingDisconnects.set(seat.userId, {
            roomId: this.roomId,
            userId: seat.userId,
            deadline: seat.disconnectDeadline,
          });
          if (remaining <= 0) {
            void this.handleDisconnectTimeout(this.roomId, seat.userId);
          } else {
            const timer = setTimeout(() => {
              void this.handleDisconnectTimeout(this.roomId, seat.userId!);
            }, remaining);
            if (typeof (timer as any).unref === 'function') {
              (timer as any).unref();
            }
            this.disconnectTimers.set(seat.userId, timer);
          }
        }
      }
    }
  }

  private scheduleDisconnectGrace(
    roomId: string,
    userId: string,
    timeoutMs: number = LUDO_RECONNECT_GRACE_MS
  ): void {
    this.clearDisconnectGrace(userId, false);
    const deadline = this.now() + timeoutMs;
    this.pendingDisconnects.set(userId, { roomId, userId, deadline });

    if (this.callbacks.execSql) {
      try {
        this.callbacks.execSql(
          'INSERT OR REPLACE INTO disconnect_grace (user_id, room_id, deadline) VALUES (?, ?, ?)',
          userId,
          roomId,
          deadline
        );
      } catch {}
    }

    this.recalculateAndScheduleEarliestAlarm();

    const timer = setTimeout(() => {
      void this.handleDisconnectTimeout(roomId, userId);
    }, timeoutMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.disconnectTimers.set(userId, timer);
  }

  private clearDisconnectGrace(userId: string, reschedule: boolean = true): boolean {
    let cleared = false;
    const timer = this.disconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(userId);
      cleared = true;
    }
    if (this.pendingDisconnects.has(userId)) {
      this.pendingDisconnects.delete(userId);
      cleared = true;
    }

    if (this.callbacks.execSql) {
      try {
        this.callbacks.execSql('DELETE FROM disconnect_grace WHERE user_id = ?', userId);
      } catch {}
    }

    if (reschedule) {
      this.recalculateAndScheduleEarliestAlarm();
    }
    return cleared;
  }

  private recalculateAndScheduleEarliestAlarm(): void {
    if (this.callbacks.execSql && this.callbacks.scheduleAlarm) {
      try {
        const remainingRows = this.callbacks
          .execSql<{ deadline: number }>(
            'SELECT deadline FROM disconnect_grace ORDER BY deadline ASC'
          )
          .toArray();
        if (remainingRows.length > 0) {
          this.callbacks.scheduleAlarm(remainingRows[0].deadline);
        } else if (this.callbacks.deleteAlarm) {
          this.callbacks.deleteAlarm();
        }
      } catch {}
    } else if (this.callbacks.scheduleAlarm) {
      let earliest: number | null = null;
      for (const pd of this.pendingDisconnects.values()) {
        if (earliest === null || pd.deadline < earliest) {
          earliest = pd.deadline;
        }
      }
      if (earliest !== null) {
        try {
          this.callbacks.scheduleAlarm(earliest);
        } catch {}
      } else if (this.callbacks.deleteAlarm) {
        try {
          this.callbacks.deleteAlarm();
        } catch {}
      }
    }
  }

  public async handleAlarm(): Promise<void> {
    const now = this.now();
    const expiredUsers: { roomId: string; userId: string }[] = [];

    if (this.callbacks.execSql) {
      try {
        const cursor = this.callbacks.execSql<{ user_id: string; room_id: string; deadline: number }>(
          'SELECT user_id, room_id, deadline FROM disconnect_grace ORDER BY deadline ASC'
        );
        const rows = cursor.toArray();
        for (const row of rows) {
          if (row.deadline <= now + 1000) {
            expiredUsers.push({ roomId: row.room_id, userId: row.user_id });
          }
        }
      } catch {}
    } else {
      for (const pd of this.pendingDisconnects.values()) {
        if (pd.deadline <= now + 1000) {
          expiredUsers.push({ roomId: pd.roomId, userId: pd.userId });
        }
      }
    }

    for (const exp of expiredUsers) {
      await this.handleDisconnectTimeout(exp.roomId, exp.userId);
    }

    this.recalculateAndScheduleEarliestAlarm();
  }

  public async handleDisconnectTimeout(roomId: string, userId: string): Promise<void> {
    this.clearDisconnectGrace(userId);

    const activeSockets = this.callbacks.getUserSockets(userId);
    if (activeSockets.length > 0) {
      return;
    }

    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      return;
    }

    const seat = this.findUserSeat(userId);
    if (!seat || seat.status !== 'human' || seat.controlMode === 'takeover-bot') {
      return;
    }

    // Finished players keep their earned rank
    if (
      this.state.engineState.rankings.includes(seat.color) ||
      this.state.rankings.includes(seat.color)
    ) {
      return;
    }

    const now = this.now();
    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const cSeat = candidateState.seats[seat.color];

    cSeat.controlMode = 'takeover-bot';
    cSeat.presence = 'abandoned';
    cSeat.abandonedAt = now;
    cSeat.disconnectDeadline = null;

    // Transfer host if host permanently abandoned
    if (candidateState.hostUserId === userId) {
      let nextHostFound = false;
      for (const color of CANONICAL_COLORS) {
        const s = candidateState.seats[color];
        if (s.status === 'human' && s.controlMode !== 'takeover-bot' && s.userId) {
          candidateState.hostUserId = s.userId;
          nextHostFound = true;
          break;
        }
      }
      if (!nextHostFound) {
        candidateState.hostUserId = null;
      }
    }

    // Check if ALL human seats permanently abandoned
    const anyHumanRemaining = CANONICAL_COLORS.some((color) => {
      const s = candidateState.seats[color];
      return s.status === 'human' && s.controlMode !== 'takeover-bot';
    });

    if (!anyHumanRemaining) {
      if (!candidateState.engineState) return;
      candidateState.status = 'finished';
      candidateState.finishReason = 'all-humans-abandoned';
      candidateState.rankings = [...(candidateState.engineState.rankings || [])];
      candidateState.displayRankings = computeLudoDisplayRankings(
        candidateState.rankings,
        candidateState.engineState.activeColors,
        candidateState.seats
      );
      candidateState.revision++;
      candidateState.updatedAt = now;

      try {
        this.callbacks.persist(candidateState);
      } catch {
        return;
      }

      this.state = candidateState;
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: false,
        status: 'abandoned',
        disconnectDeadline: null,
        protocolVersion: PROTOCOL_VERSION,
      });
      this.callbacks.broadcast({
        type: 'LUDO_GAME_STATE',
        roomId: this.roomId,
        state: this.getBroadcastEngineState()!,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
        finishReason: this.state.finishReason,
        displayRankings: this.state.displayRankings,
      });
      return;
    }

    candidateState.revision++;
    candidateState.updatedAt = now;

    try {
      this.callbacks.persist(candidateState);
    } catch {
      return;
    }

    this.state = candidateState;

    this.callbacks.broadcast({
      type: 'LUDO_PRESENCE',
      roomId: this.roomId,
      userId,
      online: false,
      status: 'abandoned',
      disconnectDeadline: null,
      protocolVersion: PROTOCOL_VERSION,
    });

    this.callbacks.broadcast({
      type: 'LUDO_GAME_STATE',
      roomId: this.roomId,
      state: this.getBroadcastEngineState()!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
      finishReason: this.state.finishReason,
      displayRankings: this.state.displayRankings,
    });

    // If it is currently this abandoned player's turn, progress immediately
    this.progressBotTurnIfActive();
  }

  public cancelDisconnectGraceIfPending(userId: string): boolean {
    const seat = this.findUserSeat(userId);
    if (!seat || seat.status !== 'human' || seat.controlMode === 'takeover-bot') {
      return false;
    }
    const hadPending = this.clearDisconnectGrace(userId);
    if (seat.presence === 'reconnecting' || hadPending) {
      const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
      const cSeat = candidateState.seats[seat.color];
      cSeat.presence = 'online';
      cSeat.disconnectDeadline = null;
      candidateState.revision++;
      candidateState.updatedAt = this.now();
      try {
        this.callbacks.persist(candidateState);
      } catch {
        return false;
      }
      this.state = candidateState;
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: true,
        status: 'online',
        disconnectDeadline: null,
        protocolVersion: PROTOCOL_VERSION,
      });
      if (this.state.engineState) {
        this.callbacks.broadcast({
          type: 'LUDO_GAME_STATE',
          roomId: this.roomId,
          state: this.getBroadcastEngineState()!,
          seats: this.state.seats,
          hostUserId: this.state.hostUserId,
          presence: this.getPresence(),
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
          finishReason: this.state.finishReason,
          displayRankings: this.state.displayRankings,
        });
      }
      return true;
    }
    return false;
  }

  public static fromState(
    roomId: string,
    callbacks: LudoRoomCallbacks,
    rawState: unknown,
    options: LudoControllerOptions = {}
  ): LudoOnlineController {
    const validation = validateLudoRoomState(rawState);
    if (!validation.valid) {
      const controller = new LudoOnlineController(roomId, callbacks, undefined, options);
      controller.corruptedStateError = validation.error;
      return controller;
    }
    return new LudoOnlineController(roomId, callbacks, validation.state, options);
  }

  public setDiceRoller(roller: DiceRoller): void {
    this.diceRoller = roller;
  }

  public getState(): LudoRoomState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public getRevision(): number {
    return this.state.revision;
  }

  public isCorrupted(): boolean {
    return this.corruptedStateError !== null;
  }

  public getCorruptedError(): string | null {
    return this.corruptedStateError;
  }

  public destroy(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.pendingDisconnects.clear();
  }

  public getBroadcastEngineState(): LudoState | null {
    if (!this.state.engineState) return null;
    if (this.state.status === 'finished') {
      return {
        ...this.state.engineState,
        status: 'finished',
        currentTurn: null,
        turnPhase: null,
        currentRoll: null,
        legalMoves: [],
        rankings: this.state.displayRankings || this.state.engineState.rankings,
      };
    }
    return this.state.engineState;
  }

  private sendError(ws: WebSocket, message: string, code?: string): void {
    this.callbacks.sendToSocket(ws, {
      type: 'ERROR',
      message,
      ...(code ? { code } : {}),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private commitAndBroadcast(candidateState: LudoRoomState, onCommit?: () => void): boolean {
    candidateState.updatedAt = this.now();
    try {
      this.callbacks.persist(candidateState);
    } catch {
      return false;
    }

    this.state = candidateState;
    if (onCommit) {
      onCommit();
    }

    if (this.state.status === 'lobby') {
      this.callbacks.broadcast({
        type: 'LUDO_LOBBY_STATE',
        roomId: this.roomId,
        lobby: this.getLobbyState(),
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
      });
    } else if (this.state.engineState) {
      this.callbacks.broadcast({
        type: 'LUDO_GAME_STATE',
        roomId: this.roomId,
        state: this.getBroadcastEngineState()!,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
        finishReason: this.state.finishReason,
        displayRankings: this.state.displayRankings,
      });
    }
    return true;
  }

  private resetNonHostReadyStates(candidate?: LudoRoomState): void {
    const targetState = candidate || this.state;
    for (const color of CANONICAL_COLORS) {
      const seat = targetState.seats[color];
      if (seat.status === 'human' && seat.userId !== targetState.hostUserId) {
        seat.ready = false;
      }
    }
  }

  public getLobbyState(): LudoLobbyState {
    return {
      gameType: 'ludo',
      roomId: this.roomId,
      status: 'lobby',
      hostUserId: this.state.hostUserId,
      seats: JSON.parse(JSON.stringify(this.state.seats)),
      activeSeatCount: this.state.activeSeatCount,
      revision: this.state.revision,
      roomGeneration: this.state.roomGeneration || 1,
    };
  }

  public getPresence(): Record<string, boolean> {
    const presence: Record<string, boolean> = {};
    for (const color of CANONICAL_COLORS) {
      const seat = this.state.seats[color];
      if (seat.status === 'human' && seat.userId) {
        presence[seat.userId] = this.callbacks.getUserSockets(seat.userId).length > 0;
      }
    }
    return presence;
  }

  public handleConnect(ws: WebSocket, userId: string): void {
    if (this.corruptedStateError) {
      this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`, 'CORRUPTED_STATE');
      return;
    }

    const seat = this.findUserSeat(userId);
    if (seat && this.state.status === 'playing') {
      if (seat.controlMode === 'takeover-bot') {
        // Abandoned player reconnects as spectator
      } else {
        this.cancelDisconnectGraceIfPending(userId);
      }
    }

    // Send current state on connection
    if (this.state.status === 'lobby') {
      this.callbacks.sendToSocket(ws, {
        type: 'LUDO_LOBBY_STATE',
        roomId: this.roomId,
        lobby: this.getLobbyState(),
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
      });
    } else if (this.state.engineState) {
      this.callbacks.sendToSocket(ws, {
        type: 'LUDO_GAME_STATE',
        roomId: this.roomId,
        state: this.getBroadcastEngineState()!,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
        finishReason: this.state.finishReason,
        displayRankings: this.state.displayRankings,
      });
    }

    // Broadcast presence change to other connected sockets
    this.callbacks.broadcast({
      type: 'LUDO_PRESENCE',
      roomId: this.roomId,
      userId,
      online: true,
      status: seat?.controlMode === 'takeover-bot' ? 'abandoned' : 'online',
      disconnectDeadline: null,
      protocolVersion: PROTOCOL_VERSION,
    });

    if (this.state.status === 'playing' && this.state.engineState) {
      this.progressBotTurnIfActive();
    }
  }

  public handleDisconnect(userId: string, closingWs?: WebSocket): void {
    const remainingSockets = this.callbacks.getUserSockets(userId, closingWs);
    if (remainingSockets.length > 0) {
      return;
    }

    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: false,
        status: 'online',
        protocolVersion: PROTOCOL_VERSION,
      });
      return;
    }

    const seat = this.findUserSeat(userId);
    if (!seat || seat.status !== 'human') {
      return;
    }

    if (seat.controlMode === 'takeover-bot') {
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: false,
        status: 'abandoned',
        protocolVersion: PROTOCOL_VERSION,
      });
      return;
    }

    // Strictly idempotent: if already in grace (e.g. from explicit leave or repeated socket close), do nothing
    if (seat.presence === 'reconnecting') {
      return;
    }

    this.startDisconnectGrace(userId);
  }

  private startDisconnectGrace(userId: string): boolean {
    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      return false;
    }

    const seat = this.findUserSeat(userId);
    if (!seat || seat.status !== 'human' || seat.controlMode === 'takeover-bot') {
      return false;
    }

    // Strictly idempotent: if already reconnecting, do not reset deadline or bump revision
    if (seat.presence === 'reconnecting') {
      return false;
    }

    // Finished players keep their earned rank; do not start grace
    const isAlreadyFinished =
      this.state.engineState.rankings.includes(seat.color) ||
      this.state.rankings.includes(seat.color);
    if (isAlreadyFinished) {
      const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
      const cSeat = candidateState.seats[seat.color];
      cSeat.presence = 'reconnecting';
      cSeat.disconnectDeadline = null;
      candidateState.revision++;
      candidateState.updatedAt = this.now();
      try {
        this.callbacks.persist(candidateState);
      } catch {
        return false;
      }
      this.state = candidateState;
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: false,
        status: 'reconnecting',
        disconnectDeadline: null,
        protocolVersion: PROTOCOL_VERSION,
      });
      return true;
    }

    const deadline = this.now() + LUDO_RECONNECT_GRACE_MS;
    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const cSeat = candidateState.seats[seat.color];
    cSeat.presence = 'reconnecting';
    cSeat.disconnectDeadline = deadline;
    candidateState.revision++;
    candidateState.updatedAt = this.now();

    try {
      this.callbacks.persist(candidateState);
    } catch {
      return false;
    }

    this.state = candidateState;
    this.scheduleDisconnectGrace(this.roomId, userId, LUDO_RECONNECT_GRACE_MS);

    this.callbacks.broadcast({
      type: 'LUDO_PRESENCE',
      roomId: this.roomId,
      userId,
      online: false,
      status: 'reconnecting',
      disconnectDeadline: deadline,
      protocolVersion: PROTOCOL_VERSION,
    });

    this.callbacks.broadcast({
      type: 'LUDO_GAME_STATE',
      roomId: this.roomId,
      state: this.getBroadcastEngineState()!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
      finishReason: this.state.finishReason,
      displayRankings: this.state.displayRankings,
    });
    return true;
  }

  public async handleMessage(
    ws: WebSocket,
    sessionOrUserId: LudoUserSession | string,
    rawMsg: unknown
  ): Promise<void> {
    if (this.corruptedStateError) {
      this.sendError(ws, `Room persistent state is corrupted: ${this.corruptedStateError}`, 'CORRUPTED_STATE');
      return;
    }

    const session: LudoUserSession = typeof sessionOrUserId === 'string'
      ? { userId: sessionOrUserId }
      : sessionOrUserId;
    const userId = session.userId;

    if (!rawMsg || typeof rawMsg !== 'object' || !('type' in rawMsg)) {
      this.sendError(ws, 'Malformed message: must be an object with "type"', 'MALFORMED_MESSAGE');
      return;
    }

    const msg = rawMsg as LudoClientMessage;

    switch (msg.type) {
      case 'LUDO_JOIN':
        this.handleJoin(ws, session, (msg as { preferredColor?: unknown }).preferredColor);
        break;

      case 'LUDO_SET_READY':
        this.handleSetReady(ws, userId, (msg as { ready?: unknown }).ready);
        break;

      case 'LUDO_SET_PLAYER_COUNT':
        this.handleSetPlayerCount(ws, userId, (msg as { playerCount?: unknown }).playerCount);
        break;

      case 'LUDO_SET_SEAT':
        this.handleSetSeat(
          ws,
          userId,
          (msg as { color?: unknown }).color,
          (msg as { status?: unknown }).status
        );
        break;

      case 'LUDO_ADD_BOT':
        this.handleAddBot(
          ws,
          userId,
          (msg as { color?: unknown }).color,
          (msg as { difficulty?: unknown }).difficulty
        );
        break;

      case 'LUDO_REMOVE_BOT':
        this.handleRemoveBot(ws, userId, (msg as { color?: unknown }).color);
        break;

      case 'LUDO_SET_BOT_DIFFICULTY':
        this.handleSetBotDifficulty(
          ws,
          userId,
          (msg as { color?: unknown }).color,
          (msg as { difficulty?: unknown }).difficulty
        );
        break;

      case 'LUDO_START_GAME':
        this.handleStartGame(ws, userId);
        break;

      case 'LUDO_ROLL_DICE':
        this.handleRollDice(ws, userId);
        break;

      case 'LUDO_MOVE_TOKEN':
        this.handleMoveToken(ws, userId, (msg as { tokenId?: unknown }).tokenId);
        break;

      case 'LUDO_REQUEST_STATE':
        this.handleRequestState(ws);
        break;

      case 'LUDO_LEAVE':
        this.handleLeave(ws, userId);
        break;

      case 'LUDO_RETURN_TO_LOBBY':
        this.handleReturnToLobby(ws, userId);
        break;

      default:
        this.sendError(ws, `Unknown Ludo message type: ${(msg as { type?: unknown }).type}`, 'MALFORMED_MESSAGE');
        break;
    }
  }

  private handleJoin(
    ws: WebSocket,
    session: LudoUserSession,
    preferredColor?: unknown
  ): void {
    const userId = session.userId;
    if (this.state.status !== 'lobby') {
      // Game already playing/finished: check if reconnecting player
      const existingSeat = this.findUserSeat(userId);
      if (existingSeat) {
        if (existingSeat.controlMode === 'human') {
          this.cancelDisconnectGraceIfPending(userId);
        }
        this.handleRequestState(ws);
        return;
      }
      this.sendError(ws, 'Cannot join match in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    // Check if user already occupies a seat (idempotent reconnect/multi-socket)
    const currentSeat = this.findUserSeat(userId);
    if (currentSeat) {
      // Discard client displayName: use verified ticket claims only
      const verifiedName = session.name?.trim() || session.username?.trim();
      if (verifiedName && currentSeat.displayName !== verifiedName) {
        const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
        candidateState.seats[currentSeat.color].displayName = verifiedName;
        candidateState.revision++;
        if (!this.commitAndBroadcast(candidateState)) {
          this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
        }
      } else {
        this.handleRequestState(ws);
      }
      return;
    }

    // Determine target seat
    const validatedPreferredColor =
      typeof preferredColor === 'string' && CANONICAL_COLORS.includes(preferredColor as PlayerColor)
        ? (preferredColor as PlayerColor)
        : undefined;

    let targetColor: PlayerColor | null = null;
    if (validatedPreferredColor && this.state.seats[validatedPreferredColor]?.status === 'open') {
      targetColor = validatedPreferredColor;
    } else {
      // Find first open seat in canonical search order: red, yellow, green, blue
      const searchOrder: PlayerColor[] = ['red', 'yellow', 'green', 'blue'];
      for (const c of searchOrder) {
        if (this.state.seats[c].status === 'open') {
          targetColor = c;
          break;
        }
      }
    }

    if (!targetColor) {
      this.sendError(ws, 'Room has no available open seats', 'ROOM_FULL');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const isFirstHuman = candidateState.hostUserId === null;
    if (isFirstHuman) {
      candidateState.hostUserId = userId;
    }

    const fallbackLabel = isFirstHuman
      ? 'Host'
      : `Player ${targetColor.charAt(0).toUpperCase() + targetColor.slice(1)}`;
    const effectiveDisplayName = session.name?.trim() || session.username?.trim() || fallbackLabel;

    candidateState.seats[targetColor] = {
      color: targetColor,
      status: 'human',
      userId,
      displayName: effectiveDisplayName,
      botDifficulty: null,
      ready: isFirstHuman ? true : false,
    };

    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleSetReady(ws: WebSocket, userId: string, ready: unknown): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (typeof ready !== 'boolean') {
      this.sendError(ws, 'Field "ready" must be a boolean', 'MALFORMED_MESSAGE');
      return;
    }

    const seat = this.findUserSeat(userId);
    if (!seat) {
      this.sendError(ws, 'You do not hold a seat in this room', 'NOT_IN_ROOM');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.seats[seat.color].ready = ready;
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleSetPlayerCount(ws: WebSocket, userId: string, count: unknown): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can configure player count', 'NOT_HOST');
      return;
    }

    if (typeof count !== 'number' || !Number.isInteger(count) || (count !== 2 && count !== 3 && count !== 4)) {
      this.sendError(ws, 'Player count must be 2, 3, or 4', 'INVALID_PLAYER_COUNT');
      return;
    }

    // Invariant checks on count reduction:
    // 4 -> 3: Blue seat must not be occupied (human or bot)
    // 3 -> 2: Green seat must not be occupied (human or bot)
    // 4 -> 2: Both Green and Blue must not be occupied
    if (count === 2) {
      const greenOccupied = this.state.seats.green.status === 'human' || this.state.seats.green.status === 'bot';
      const blueOccupied = this.state.seats.blue.status === 'human' || this.state.seats.blue.status === 'bot';
      if (greenOccupied || blueOccupied) {
        this.sendError(ws, 'Cannot reduce player count: seats that would be closed are occupied', 'SEAT_OCCUPIED');
        return;
      }
    } else if (count === 3) {
      const blueOccupied = this.state.seats.blue.status === 'human' || this.state.seats.blue.status === 'bot';
      if (blueOccupied) {
        this.sendError(ws, 'Cannot reduce player count: Blue seat is occupied', 'SEAT_OCCUPIED');
        return;
      }
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));

    if (count === 2) {
      if (candidateState.seats.red.status === 'closed') candidateState.seats.red.status = 'open';
      if (candidateState.seats.yellow.status === 'closed') candidateState.seats.yellow.status = 'open';
      candidateState.seats.green.status = 'closed';
      candidateState.seats.green.userId = null;
      candidateState.seats.green.displayName = null;
      candidateState.seats.green.botDifficulty = null;
      candidateState.seats.green.ready = false;
      candidateState.seats.blue.status = 'closed';
      candidateState.seats.blue.userId = null;
      candidateState.seats.blue.displayName = null;
      candidateState.seats.blue.botDifficulty = null;
      candidateState.seats.blue.ready = false;
      candidateState.activeSeatCount = 2;
    } else if (count === 3) {
      if (candidateState.seats.red.status === 'closed') candidateState.seats.red.status = 'open';
      if (candidateState.seats.green.status === 'closed') candidateState.seats.green.status = 'open';
      if (candidateState.seats.yellow.status === 'closed') candidateState.seats.yellow.status = 'open';
      candidateState.seats.blue.status = 'closed';
      candidateState.seats.blue.userId = null;
      candidateState.seats.blue.displayName = null;
      candidateState.seats.blue.botDifficulty = null;
      candidateState.seats.blue.ready = false;
      candidateState.activeSeatCount = 3;
    } else {
      if (candidateState.seats.red.status === 'closed') candidateState.seats.red.status = 'open';
      if (candidateState.seats.green.status === 'closed') candidateState.seats.green.status = 'open';
      if (candidateState.seats.yellow.status === 'closed') candidateState.seats.yellow.status = 'open';
      if (candidateState.seats.blue.status === 'closed') candidateState.seats.blue.status = 'open';
      candidateState.activeSeatCount = 4;
    }

    this.resetNonHostReadyStates(candidateState);
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleSetSeat(
    ws: WebSocket,
    userId: string,
    color: unknown,
    status: unknown
  ): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can configure seats', 'NOT_HOST');
      return;
    }

    if (typeof color !== 'string' || !CANONICAL_COLORS.includes(color as PlayerColor)) {
      this.sendError(ws, `Invalid seat color: "${color}"`, 'MALFORMED_MESSAGE');
      return;
    }

    if (status !== 'open' && status !== 'closed') {
      this.sendError(ws, 'Seat status must be "open" or "closed"', 'MALFORMED_MESSAGE');
      return;
    }

    const currentSeat = this.state.seats[color as PlayerColor];
    if (status === 'closed') {
      if (currentSeat.status === 'human') {
        this.sendError(ws, 'Cannot close an occupied human seat', 'SEAT_OCCUPIED');
        return;
      }
      if (currentSeat.status === 'bot') {
        this.sendError(ws, 'Cannot close an occupied bot seat. Remove bot first.', 'SEAT_OCCUPIED');
        return;
      }
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const seat = candidateState.seats[color as PlayerColor];
    seat.status = status as 'open' | 'closed';
    seat.userId = null;
    seat.displayName = null;
    seat.botDifficulty = null;
    seat.ready = false;

    let count = 0;
    for (const c of CANONICAL_COLORS) {
      const s = candidateState.seats[c];
      if (s.status !== 'closed') count++;
    }
    candidateState.activeSeatCount = count;

    this.resetNonHostReadyStates(candidateState);
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleAddBot(
    ws: WebSocket,
    userId: string,
    color: unknown,
    difficulty: unknown = 'normal'
  ): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can add bots', 'NOT_HOST');
      return;
    }

    if (typeof color !== 'string' || !CANONICAL_COLORS.includes(color as PlayerColor)) {
      this.sendError(ws, `Invalid bot color: "${color}"`, 'MALFORMED_MESSAGE');
      return;
    }

    const diff = difficulty === undefined || difficulty === null ? 'normal' : difficulty;
    if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
      this.sendError(ws, `Invalid bot difficulty: "${diff}"`, 'INVALID_BOT_DIFFICULTY');
      return;
    }

    const currentSeat = this.state.seats[color as PlayerColor];
    if (currentSeat.status === 'human') {
      this.sendError(ws, 'Seat is occupied by a human player', 'SEAT_OCCUPIED');
      return;
    }
    if (currentSeat.status === 'closed') {
      this.sendError(ws, 'Seat is closed. Open the seat before adding a bot.', 'SEAT_UNAVAILABLE');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const seat = candidateState.seats[color as PlayerColor];
    seat.status = 'bot';
    seat.controlMode = 'bot';
    seat.userId = null;
    seat.displayName = `${(color as string).charAt(0).toUpperCase() + (color as string).slice(1)} Bot`;
    seat.botDifficulty = diff as BotDifficulty;
    seat.ready = true;
    seat.presence = 'online';
    seat.disconnectDeadline = null;
    seat.abandonedAt = null;

    this.resetNonHostReadyStates(candidateState);
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleRemoveBot(ws: WebSocket, userId: string, color: unknown): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can remove bots', 'NOT_HOST');
      return;
    }

    if (typeof color !== 'string' || !CANONICAL_COLORS.includes(color as PlayerColor)) {
      this.sendError(ws, `Invalid seat color: "${color}"`, 'MALFORMED_MESSAGE');
      return;
    }

    const currentSeat = this.state.seats[color as PlayerColor];
    if (!currentSeat || currentSeat.status !== 'bot') {
      this.sendError(ws, `Seat ${color} is not a bot seat`, 'INVALID_TARGET');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    const seat = candidateState.seats[color as PlayerColor];
    seat.status = 'open';
    seat.controlMode = 'human';
    seat.userId = null;
    seat.displayName = null;
    seat.botDifficulty = null;
    seat.ready = false;
    seat.presence = 'online';
    seat.disconnectDeadline = null;
    seat.abandonedAt = null;

    this.resetNonHostReadyStates(candidateState);
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleSetBotDifficulty(
    ws: WebSocket,
    userId: string,
    color: unknown,
    difficulty: unknown
  ): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already in progress', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can change bot difficulty', 'NOT_HOST');
      return;
    }

    if (typeof color !== 'string' || !CANONICAL_COLORS.includes(color as PlayerColor)) {
      this.sendError(ws, `Invalid seat color: "${color}"`, 'MALFORMED_MESSAGE');
      return;
    }

    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') {
      this.sendError(ws, `Invalid bot difficulty: "${difficulty}"`, 'INVALID_BOT_DIFFICULTY');
      return;
    }

    const currentSeat = this.state.seats[color as PlayerColor];
    if (!currentSeat || currentSeat.status !== 'bot') {
      this.sendError(ws, `Seat ${color} is not a bot`, 'INVALID_TARGET');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.seats[color as PlayerColor].botDifficulty = difficulty as BotDifficulty;

    this.resetNonHostReadyStates(candidateState);
    candidateState.revision++;

    if (!this.commitAndBroadcast(candidateState)) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
    }
  }

  private handleStartGame(ws: WebSocket, userId: string): void {
    if (this.state.status !== 'lobby') {
      this.sendError(ws, 'Match is already started', 'GAME_ALREADY_STARTED');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the host can start the match', 'NOT_HOST');
      return;
    }

    // 1. Validate seats
    const activeSeats: LudoSeat[] = [];
    let humanCount = 0;

    for (const color of CANONICAL_COLORS) {
      const seat = this.state.seats[color];
      if (seat.status === 'open') {
        this.sendError(
          ws,
          `Cannot start: Seat "${color}" is open but empty. Fill it or close it.`,
          'SEAT_UNAVAILABLE'
        );
        return;
      }
      if (seat.status === 'human' || seat.status === 'bot') {
        activeSeats.push(seat);
        if (seat.status === 'human') humanCount++;
      }
    }

    if (activeSeats.length < 2 || activeSeats.length > 4) {
      this.sendError(
        ws,
        `Cannot start: Match requires 2 to 4 active players, got ${activeSeats.length}`,
        'INVALID_PLAYER_COUNT'
      );
      return;
    }

    if (humanCount === 0) {
      this.sendError(ws, 'Cannot start match without at least one human player', 'AT_LEAST_ONE_HUMAN_REQUIRED');
      return;
    }

    // 2. Validate readiness of all non-host humans
    for (const seat of activeSeats) {
      if (seat.status === 'human' && seat.userId !== this.state.hostUserId) {
        if (!seat.ready) {
          this.sendError(
            ws,
            `Cannot start: Player ${seat.displayName || seat.color} is not ready`,
            'NOT_READY'
          );
          return;
        }
      }
    }

    // 3. Create candidate engine
    const playersInit: LudoPlayerInit[] = activeSeats.map((s) => ({
      id: s.userId || `bot-${s.color}`,
      color: s.color,
      type: s.status as 'human' | 'bot',
      name: s.displayName || undefined,
      botDifficulty: s.botDifficulty || undefined,
    }));

    let engineCandidate: LudoEngine;
    try {
      engineCandidate = LudoEngine.create({ players: playersInit });
    } catch (err: unknown) {
      this.sendError(ws, err instanceof Error ? err.message : 'Failed to instantiate match engine');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.status = 'playing';
    candidateState.engineState = engineCandidate.getState();
    for (const color of CANONICAL_COLORS) {
      const seat = candidateState.seats[color];
      if (seat.status === 'human') {
        seat.controlMode = 'human';
        seat.presence = 'online';
        seat.disconnectDeadline = null;
        seat.abandonedAt = null;
      } else if (seat.status === 'bot') {
        seat.controlMode = 'bot';
        seat.presence = 'online';
        seat.disconnectDeadline = null;
        seat.abandonedAt = null;
      }
    }
    candidateState.finishReason = null;
    candidateState.displayRankings = undefined;
    candidateState.revision++;

    const committed = this.commitAndBroadcast(candidateState, () => {
      this.engine = engineCandidate;
    });

    if (!committed) {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
      return;
    }

    // If opening turn belongs to a bot, trigger server bot execution
    this.progressBotTurnIfActive();
  }

  private handleRollDice(ws: WebSocket, userId: string): void {
    if (this.state.status === 'finished') {
      this.sendError(ws, 'Game is already finished', 'GAME_FINISHED');
      return;
    }

    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      this.sendError(ws, 'Match is not in playing state', 'INVALID_PHASE');
      return;
    }

    const callerSeat = this.findUserSeat(userId);
    if (callerSeat?.controlMode === 'takeover-bot') {
      this.sendError(ws, 'Seat is controlled by takeover bot', 'PLAYER_ABANDONED');
      return;
    }
    if (callerSeat?.presence === 'reconnecting') {
      this.sendError(ws, 'Player is reconnecting', 'PLAYER_OFFLINE');
      return;
    }

    const currentTurn = this.state.engineState.currentTurn;
    if (!currentTurn) {
      this.sendError(ws, 'No active turn', 'INVALID_PHASE');
      return;
    }

    const seat = this.state.seats[currentTurn];
    if (seat.controlMode === 'takeover-bot') {
      this.sendError(ws, 'Seat is controlled by takeover bot', 'PLAYER_ABANDONED');
      return;
    }

    if (seat.presence === 'reconnecting') {
      this.sendError(ws, 'Player is reconnecting', 'PLAYER_OFFLINE');
      return;
    }

    if (seat.status !== 'human' || seat.userId !== userId) {
      this.sendError(ws, `It is not your turn to roll (Current: ${currentTurn})`, 'NOT_YOUR_TURN');
      return;
    }

    if (this.state.engineState.turnPhase !== 'roll') {
      this.sendError(ws, 'Cannot roll: turn phase is not "roll"', 'INVALID_PHASE');
      return;
    }

    const candidateEngine = LudoEngine.fromState(this.engine.getState());
    const rollRes = candidateEngine.rollDice(this.diceRoller);
    if (!rollRes.success) {
      this.sendError(ws, rollRes.error || 'Failed to roll dice');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.engineState = candidateEngine.getState();
    candidateState.revision++;
    candidateState.updatedAt = this.now();

    try {
      this.callbacks.persist(candidateState);
    } catch {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
      return;
    }

    this.engine = candidateEngine;
    this.state = candidateState;

    // 1. Broadcast LUDO_DICE_ROLLED
    this.callbacks.broadcast({
      type: 'LUDO_DICE_ROLLED',
      roomId: this.roomId,
      color: currentTurn,
      player: currentTurn,
      roll: rollRes.diceValue!,
      dice: rollRes.diceValue!,
      consecutiveSixes: rollRes.consecutiveSixes || 0,
      legalMoves: rollRes.legalMoves || [],
      autoPassed: Boolean(rollRes.autoPassed),
      threeSixesForfeit: Boolean(rollRes.forfeitedDueToThreeSixes),
      nextTurn: rollRes.nextTurn ?? null,
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
    });

    // 2. Broadcast authoritative LUDO_GAME_STATE
    this.callbacks.broadcast({
      type: 'LUDO_GAME_STATE',
      roomId: this.roomId,
      state: this.getBroadcastEngineState()!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
      finishReason: this.state.finishReason,
      displayRankings: this.state.displayRankings,
    });

    // If auto-pass advanced turn to a bot:
    this.progressBotTurnIfActive();
  }

  private handleMoveToken(ws: WebSocket, userId: string, tokenId: unknown): void {
    if (this.state.status === 'finished') {
      this.sendError(ws, 'Game is already finished', 'GAME_FINISHED');
      return;
    }

    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      this.sendError(ws, 'Match is not in playing state', 'INVALID_PHASE');
      return;
    }

    const callerSeat = this.findUserSeat(userId);
    if (callerSeat?.controlMode === 'takeover-bot') {
      this.sendError(ws, 'Seat is controlled by takeover bot', 'PLAYER_ABANDONED');
      return;
    }
    if (callerSeat?.presence === 'reconnecting') {
      this.sendError(ws, 'Player is reconnecting', 'PLAYER_OFFLINE');
      return;
    }

    const currentTurn = this.state.engineState.currentTurn;
    if (!currentTurn) {
      this.sendError(ws, 'No active turn', 'INVALID_PHASE');
      return;
    }

    const seat = this.state.seats[currentTurn];
    if (seat.controlMode === 'takeover-bot') {
      this.sendError(ws, 'Seat is controlled by takeover bot', 'PLAYER_ABANDONED');
      return;
    }

    if (seat.presence === 'reconnecting') {
      this.sendError(ws, 'Player is reconnecting', 'PLAYER_OFFLINE');
      return;
    }

    if (seat.status !== 'human' || seat.userId !== userId) {
      this.sendError(ws, `It is not your turn to move (Current: ${currentTurn})`, 'NOT_YOUR_TURN');
      return;
    }

    if (typeof tokenId !== 'number' || !Number.isInteger(tokenId) || tokenId < 0 || tokenId > 3) {
      this.sendError(ws, `Invalid token ID: ${tokenId}`, 'ILLEGAL_MOVE');
      return;
    }

    if (this.state.engineState.turnPhase !== 'move') {
      this.sendError(ws, 'Cannot move: turn phase is not "move"', 'INVALID_PHASE');
      return;
    }

    const isLegal = this.state.engineState.legalMoves.some((m) => m.tokenIndex === tokenId);
    if (!isLegal) {
      this.sendError(ws, `Token ${tokenId} is not a legal move`, 'ILLEGAL_MOVE');
      return;
    }

    const candidateEngine = LudoEngine.fromState(this.engine.getState());
    const moveRes = candidateEngine.makeMove(currentTurn, tokenId);
    if (!moveRes.success) {
      this.sendError(ws, moveRes.error || 'Illegal move', 'ILLEGAL_MOVE');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.engineState = candidateEngine.getState();
    candidateState.revision++;
    candidateState.updatedAt = this.now();

    if (moveRes.gameFinished || candidateState.engineState.status === 'finished') {
      candidateState.status = 'finished';
      candidateState.rankings = [...candidateState.engineState.rankings];
      candidateState.displayRankings = computeLudoDisplayRankings(
        candidateState.rankings,
        candidateState.engineState.activeColors,
        candidateState.seats
      );
      if (!candidateState.finishReason) {
        candidateState.finishReason = 'normal';
      }
    } else if (candidateState.engineState.rankings.length > 0) {
      candidateState.displayRankings = computeLudoDisplayRankings(
        candidateState.engineState.rankings,
        candidateState.engineState.activeColors,
        candidateState.seats
      );
    }

    try {
      this.callbacks.persist(candidateState);
    } catch {
      this.sendError(ws, 'Failed to persist game state', 'STORAGE_ERROR');
      return;
    }

    this.engine = candidateEngine;
    this.state = candidateState;

    const moved = moveRes.movedToken!;
    const traversedCoords = getTraversedCoordinates(moved.color, moved.fromProgress, moved.toProgress);

    // 1. Broadcast LUDO_MOVE_RESULT
    this.callbacks.broadcast({
      type: 'LUDO_MOVE_RESULT',
      roomId: this.roomId,
      player: moved.color,
      tokenId: moved.tokenIndex,
      fromProgress: moved.fromProgress,
      toProgress: moved.toProgress,
      traversedCoordinates: traversedCoords,
      capturedTokens: moveRes.capturedTokens || [],
      reachedFinish: Boolean(moveRes.reachedFinish),
      playerRanked: Boolean(moveRes.playerRanked),
      rank: moveRes.playerRanked ? moveRes.playerRanked.rank : null,
      extraTurn: Boolean(moveRes.extraTurnGranted),
      extraTurnReason: moveRes.extraTurnReason ?? null,
      resultingTurn: moveRes.nextTurn ?? null,
      gameFinished: Boolean(moveRes.gameFinished),
      rankings: this.state.engineState!.rankings,
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
    });

    // 2. Broadcast authoritative LUDO_GAME_STATE
    this.callbacks.broadcast({
      type: 'LUDO_GAME_STATE',
      roomId: this.roomId,
      state: this.getBroadcastEngineState()!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
      finishReason: this.state.finishReason,
      displayRankings: this.state.displayRankings,
    });

    // If next turn is bot:
    this.progressBotTurnIfActive();
  }

  private progressBotTurnIfActive(): void {
    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      return;
    }

    const isSeatBotControlled = (seat: LudoSeat | undefined): boolean => {
      if (!seat) return false;
      return seat.status === 'bot' || seat.controlMode === 'takeover-bot';
    };

    let loopGuard = 0;
    while (
      this.state.status === 'playing' &&
      this.state.engineState &&
      this.state.engineState.currentTurn &&
      isSeatBotControlled(this.state.seats[this.state.engineState.currentTurn]) &&
      loopGuard < MAX_BOT_TURNS_PER_ACTION
    ) {
      loopGuard++;
      const botColor = this.state.engineState.currentTurn;
      const botSeat = this.state.seats[botColor];
      const botDifficulty = botSeat.controlMode === 'takeover-bot'
        ? LUDO_TAKEOVER_BOT_DIFFICULTY
        : (botSeat.botDifficulty || 'normal');

      if (this.state.engineState.turnPhase === 'roll') {
        const candidateEngine = LudoEngine.fromState(this.engine.getState());
        const rollRes = candidateEngine.rollDice(this.diceRoller);
        if (!rollRes.success) break;

        const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
        candidateState.engineState = candidateEngine.getState();
        candidateState.revision++;
        candidateState.updatedAt = this.now();

        try {
          this.callbacks.persist(candidateState);
        } catch {
          break;
        }

        this.engine = candidateEngine;
        this.state = candidateState;

        // 1. Broadcast LUDO_DICE_ROLLED
        this.callbacks.broadcast({
          type: 'LUDO_DICE_ROLLED',
          roomId: this.roomId,
          color: botColor,
          player: botColor,
          roll: rollRes.diceValue!,
          dice: rollRes.diceValue!,
          consecutiveSixes: rollRes.consecutiveSixes || 0,
          legalMoves: rollRes.legalMoves || [],
          autoPassed: Boolean(rollRes.autoPassed),
          threeSixesForfeit: Boolean(rollRes.forfeitedDueToThreeSixes),
          nextTurn: rollRes.nextTurn ?? null,
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
        });

        // 2. Broadcast authoritative LUDO_GAME_STATE
        this.callbacks.broadcast({
          type: 'LUDO_GAME_STATE',
          roomId: this.roomId,
          state: this.getBroadcastEngineState()!,
          seats: this.state.seats,
          hostUserId: this.state.hostUserId,
          presence: this.getPresence(),
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
          finishReason: this.state.finishReason,
          displayRankings: this.state.displayRankings,
        });

        continue;
      }

      if (this.state.engineState.turnPhase === 'move') {
        const chosenMove = selectBotMove(
          this.state.engineState,
          botDifficulty
        );

        if (chosenMove === null) {
          break;
        }

        const candidateEngine = LudoEngine.fromState(this.engine.getState());
        const moveRes = candidateEngine.makeMove(botColor, chosenMove.tokenIndex);
        if (!moveRes.success) {
          break;
        }

        const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
        candidateState.engineState = candidateEngine.getState();
        candidateState.revision++;
        candidateState.updatedAt = this.now();

        if (moveRes.gameFinished || candidateState.engineState.status === 'finished') {
          candidateState.status = 'finished';
          candidateState.rankings = [...candidateState.engineState.rankings];
          candidateState.displayRankings = computeLudoDisplayRankings(
            candidateState.rankings,
            candidateState.engineState.activeColors,
            candidateState.seats
          );
          if (!candidateState.finishReason) {
            candidateState.finishReason = 'normal';
          }
        } else if (candidateState.engineState.rankings.length > 0) {
          candidateState.displayRankings = computeLudoDisplayRankings(
            candidateState.engineState.rankings,
            candidateState.engineState.activeColors,
            candidateState.seats
          );
        }

        try {
          this.callbacks.persist(candidateState);
        } catch {
          break;
        }

        this.engine = candidateEngine;
        this.state = candidateState;

        const moved = moveRes.movedToken!;
        const traversedCoords = getTraversedCoordinates(moved.color, moved.fromProgress, moved.toProgress);

        // 1. Broadcast LUDO_MOVE_RESULT
        this.callbacks.broadcast({
          type: 'LUDO_MOVE_RESULT',
          roomId: this.roomId,
          player: moved.color,
          tokenId: moved.tokenIndex,
          fromProgress: moved.fromProgress,
          toProgress: moved.toProgress,
          traversedCoordinates: traversedCoords,
          capturedTokens: moveRes.capturedTokens || [],
          reachedFinish: Boolean(moveRes.reachedFinish),
          playerRanked: Boolean(moveRes.playerRanked),
          rank: moveRes.playerRanked ? moveRes.playerRanked.rank : null,
          extraTurn: Boolean(moveRes.extraTurnGranted),
          extraTurnReason: moveRes.extraTurnReason ?? null,
          resultingTurn: moveRes.nextTurn ?? null,
          gameFinished: Boolean(moveRes.gameFinished),
          rankings: this.state.engineState!.rankings,
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
        });

        // 2. Broadcast authoritative LUDO_GAME_STATE
        this.callbacks.broadcast({
          type: 'LUDO_GAME_STATE',
          roomId: this.roomId,
          state: this.getBroadcastEngineState()!,
          seats: this.state.seats,
          hostUserId: this.state.hostUserId,
          presence: this.getPresence(),
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
          finishReason: this.state.finishReason,
          displayRankings: this.state.displayRankings,
        });

        if (moveRes.gameFinished) {
          break;
        }
      }
    }

    if (loopGuard >= MAX_BOT_TURNS_PER_ACTION) {
      console.error(`[LudoOnlineController] Bot safety guard tripped in room ${this.roomId}`);
      this.callbacks.broadcast({
        type: 'ERROR',
        message: 'Bot progression reached safety iteration limit',
        code: 'BOT_GUARD_LIMIT_EXCEEDED',
        protocolVersion: PROTOCOL_VERSION,
      });
      try {
        this.callbacks.persist(this.state);
      } catch {}
    }
  }

  private handleLeave(_ws: WebSocket, userId: string): void {
    if (this.state.status === 'lobby') {
      const seat = this.findUserSeat(userId);
      if (seat) {
        const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
        const cSeat = candidateState.seats[seat.color];
        cSeat.status = 'open';
        cSeat.userId = null;
        cSeat.displayName = null;
        cSeat.ready = false;

        // If host left, transfer host deterministically
        if (candidateState.hostUserId === userId) {
          let nextHostFound = false;
          for (const c of CANONICAL_COLORS) {
            const s = candidateState.seats[c];
            if (s.status === 'human' && s.userId) {
              candidateState.hostUserId = s.userId;
              s.ready = true;
              nextHostFound = true;
              break;
            }
          }
          if (!nextHostFound) {
            // No humans remain: reset lobby to defaults
            candidateState.hostUserId = null;
            candidateState.seats = createDefaultSeats();
            candidateState.activeSeatCount = 2;
          }
        }

        this.resetNonHostReadyStates(candidateState);
        candidateState.revision++;

        if (!this.commitAndBroadcast(candidateState)) {
          this.sendError(_ws, 'Failed to persist game state', 'STORAGE_ERROR');
        }
      }
    } else if (this.state.status === 'playing') {
      const seat = this.findUserSeat(userId);
      if (seat && seat.status === 'human' && seat.controlMode !== 'takeover-bot') {
        this.startDisconnectGrace(userId);
      }
    }
  }

  private handleRequestState(ws: WebSocket): void {
    if (this.state.status === 'lobby') {
      this.callbacks.sendToSocket(ws, {
        type: 'LUDO_LOBBY_STATE',
        roomId: this.roomId,
        lobby: this.getLobbyState(),
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
      });
    } else if (this.state.engineState) {
      this.callbacks.sendToSocket(ws, {
        type: 'LUDO_GAME_STATE',
        roomId: this.roomId,
        state: this.getBroadcastEngineState()!,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
        finishReason: this.state.finishReason,
        displayRankings: this.state.displayRankings,
      });
    }
  }

  private handleReturnToLobby(ws: WebSocket, userId: string): void {
    if (this.state.status !== 'finished') {
      this.sendError(ws, "This match can't be reset right now.", 'INVALID_PHASE');
      return;
    }

    if (this.state.hostUserId !== userId) {
      this.sendError(ws, 'Only the room host can start another match.', 'NOT_HOST');
      return;
    }

    if (this.state.finishReason === 'all-humans-abandoned') {
      this.sendError(ws, "This match can't be reset right now.", 'INVALID_PHASE');
      return;
    }

    const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
    candidateState.status = 'lobby';
    candidateState.engineState = null;
    candidateState.rankings = [];
    candidateState.displayRankings = undefined;
    candidateState.finishReason = null;
    candidateState.roomGeneration = (this.state.roomGeneration || 1) + 1;
    candidateState.revision = this.state.revision + 1;

    // Preserving activeSeatCount layout
    const activeColors: PlayerColor[] =
      candidateState.activeSeatCount === 2
        ? ['red', 'yellow']
        : candidateState.activeSeatCount === 3
        ? ['red', 'green', 'yellow']
        : ['red', 'green', 'yellow', 'blue'];

    for (const color of CANONICAL_COLORS) {
      const prevSeat = this.state.seats[color];
      const isCanonicalActive = activeColors.includes(color);

      if (!isCanonicalActive) {
        candidateState.seats[color] = {
          color,
          status: 'closed',
          userId: null,
          displayName: null,
          botDifficulty: null,
          ready: false,
          controlMode: 'human',
          presence: 'online',
          disconnectDeadline: null,
          abandonedAt: null,
        };
        continue;
      }

      // Configured bot retention
      if (prevSeat.status === 'bot' && prevSeat.controlMode === 'bot') {
        candidateState.seats[color] = {
          color,
          status: 'bot',
          userId: null,
          displayName: prevSeat.displayName || `${color.charAt(0).toUpperCase() + color.slice(1)} Bot`,
          botDifficulty: prevSeat.botDifficulty || 'normal',
          ready: true,
          controlMode: 'bot',
          presence: 'online',
          disconnectDeadline: null,
          abandonedAt: null,
        };
      } else if (
        prevSeat.status === 'human' &&
        prevSeat.userId &&
        prevSeat.controlMode !== 'takeover-bot' &&
        prevSeat.presence !== 'abandoned' &&
        this.callbacks.getUserSockets(prevSeat.userId).length > 0
      ) {
        // Connected human retention with active socket
        candidateState.seats[color] = {
          color,
          status: 'human',
          userId: prevSeat.userId,
          displayName: prevSeat.displayName,
          botDifficulty: null,
          ready: false,
          controlMode: 'human',
          presence: 'online',
          disconnectDeadline: null,
          abandonedAt: null,
        };
      } else {
        // Cleared human (disconnected, takeover-bot, or abandoned) -> open
        candidateState.seats[color] = {
          color,
          status: 'open',
          userId: null,
          displayName: null,
          botDifficulty: null,
          ready: false,
          controlMode: 'human',
          presence: 'online',
          disconnectDeadline: null,
          abandonedAt: null,
        };
      }
    }

    const validation = validateLudoRoomState(candidateState);
    if (!validation.valid) {
      this.sendError(ws, "Couldn't prepare another match. Try again.", 'STORAGE_ERROR');
      return;
    }

    const committed = this.commitAndBroadcast(candidateState, () => {
      this.engine = null;
      for (const timer of this.disconnectTimers.values()) {
        clearTimeout(timer);
      }
      this.disconnectTimers.clear();
      this.pendingDisconnects.clear();

      if (this.callbacks.execSql) {
        try {
          this.callbacks.execSql('DELETE FROM disconnect_grace WHERE room_id = ?', this.roomId);
        } catch {}
      }
      if (this.callbacks.deleteAlarm) {
        try {
          this.callbacks.deleteAlarm();
        } catch {}
      }
    });

    if (!committed) {
      this.sendError(ws, "Couldn't prepare another match. Try again.", 'STORAGE_ERROR');
      return;
    }
  }

  private findUserSeat(userId: string): LudoSeat | null {
    for (const color of CANONICAL_COLORS) {
      const s = this.state.seats[color];
      if (s.status === 'human' && s.userId === userId) {
        return s;
      }
    }
    return null;
  }
}

export function validateLudoRoomState(
  data: unknown
): { valid: true; state: LudoRoomState } | { valid: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Ludo room state must be a non-null object' };
  }

  const s = data as Record<string, unknown>;

  if (s.gameType !== 'ludo') {
    return { valid: false, error: `Invalid gameType: expected "ludo", got "${s.gameType}"` };
  }

  if (s.status !== 'lobby' && s.status !== 'playing' && s.status !== 'finished') {
    return { valid: false, error: `Invalid room status: "${s.status}"` };
  }

  if (typeof s.roomId !== 'string' || !s.roomId) {
    return { valid: false, error: 'Missing or invalid roomId' };
  }

  if (typeof s.revision !== 'number' || !Number.isInteger(s.revision) || s.revision < 0) {
    return { valid: false, error: 'Invalid revision' };
  }

  if (s.roomGeneration !== undefined && s.roomGeneration !== null) {
    if (typeof s.roomGeneration !== 'number' || !Number.isInteger(s.roomGeneration) || s.roomGeneration < 1) {
      return { valid: false, error: 'Invalid roomGeneration' };
    }
  } else {
    (s as any).roomGeneration = 1;
  }

  if (typeof s.seats !== 'object' || s.seats === null) {
    return { valid: false, error: 'Missing seats object' };
  }

  const seats = s.seats as Record<string, unknown>;
  const humanUserIds = new Set<string>();
  let humanSeatCount = 0;
  let nonClosedSeatCount = 0;

  for (const color of CANONICAL_COLORS) {
    const seat = seats[color] as Record<string, unknown> | undefined;
    if (!seat || typeof seat !== 'object') {
      return { valid: false, error: `Missing seat for canonical color "${color}"` };
    }
    if (!['human', 'bot', 'open', 'closed'].includes(seat.status as string)) {
      return { valid: false, error: `Invalid seat status for "${color}": "${seat.status}"` };
    }

    if (seat.status !== 'closed') {
      nonClosedSeatCount++;
    }

    if (seat.status === 'human') {
      humanSeatCount++;
      if (typeof seat.userId !== 'string' || !seat.userId.trim()) {
        return { valid: false, error: `Human seat "${color}" must have a non-empty string userId` };
      }
      if (humanUserIds.has(seat.userId)) {
        return { valid: false, error: `Duplicate human userId "${seat.userId}" across seats` };
      }
      humanUserIds.add(seat.userId);
    } else if (seat.status === 'bot') {
      if (seat.userId !== null && seat.userId !== undefined) {
        return { valid: false, error: `Bot seat "${color}" cannot have a userId` };
      }
    }

    if (seat.controlMode !== undefined && seat.controlMode !== null) {
      if (typeof seat.controlMode !== 'string' || !['human', 'bot', 'takeover-bot'].includes(seat.controlMode as string)) {
        return { valid: false, error: `Invalid controlMode "${seat.controlMode}" for seat "${color}"` };
      }
    }
    if (seat.presence !== undefined && seat.presence !== null) {
      if (typeof seat.presence !== 'string' || !['online', 'reconnecting', 'abandoned'].includes(seat.presence as string)) {
        return { valid: false, error: `Invalid presence "${seat.presence}" for seat "${color}"` };
      }
    }
    if (seat.disconnectDeadline !== undefined && seat.disconnectDeadline !== null) {
      if (
        typeof seat.disconnectDeadline !== 'number' ||
        Number.isNaN(seat.disconnectDeadline) ||
        !Number.isInteger(seat.disconnectDeadline) ||
        seat.disconnectDeadline <= 0
      ) {
        return { valid: false, error: `Invalid disconnectDeadline for seat "${color}"` };
      }
    }
    if (seat.abandonedAt !== undefined && seat.abandonedAt !== null) {
      if (
        typeof seat.abandonedAt !== 'number' ||
        Number.isNaN(seat.abandonedAt) ||
        !Number.isInteger(seat.abandonedAt) ||
        seat.abandonedAt <= 0
      ) {
        return { valid: false, error: `Invalid abandonedAt for seat "${color}"` };
      }
    }

    // Lifecycle invariant checks
    if (seat.presence === 'online' && seat.disconnectDeadline !== null && seat.disconnectDeadline !== undefined) {
      return { valid: false, error: `Contradiction: seat "${color}" has presence online with non-null disconnectDeadline` };
    }
    if (seat.presence === 'abandoned' && (seat.abandonedAt === null || seat.abandonedAt === undefined)) {
      return { valid: false, error: `Contradiction: abandoned seat "${color}" missing abandonedAt` };
    }
    if (seat.controlMode === 'takeover-bot' && seat.presence !== 'abandoned') {
      return { valid: false, error: `Contradiction: takeover-bot seat "${color}" has non-abandoned presence "${seat.presence}"` };
    }
    if (seat.status === 'bot' && seat.disconnectDeadline !== null && seat.disconnectDeadline !== undefined) {
      return { valid: false, error: `Contradiction: configured bot seat "${color}" cannot have disconnectDeadline` };
    }
  }

  if (s.finishReason !== undefined && s.finishReason !== null) {
    if (typeof s.finishReason !== 'string' || !['all-humans-abandoned', 'normal'].includes(s.finishReason as string)) {
      return { valid: false, error: `Invalid finishReason: "${s.finishReason}"` };
    }
  }
  if (s.displayRankings !== undefined && s.displayRankings !== null) {
    if (!Array.isArray(s.displayRankings)) {
      return { valid: false, error: 'displayRankings must be an array' };
    }
    const seen = new Set<PlayerColor>();
    for (const r of s.displayRankings) {
      if (typeof r !== 'string' || !CANONICAL_COLORS.includes(r as PlayerColor)) {
        return { valid: false, error: `Invalid color "${r}" in displayRankings` };
      }
      if (seen.has(r as PlayerColor)) {
        return { valid: false, error: `Duplicate color "${r}" in displayRankings` };
      }
      seen.add(r as PlayerColor);
    }
    if (s.status === 'finished' && s.engineState && typeof s.engineState === 'object') {
      const active = (s.engineState as any).activeColors;
      if (Array.isArray(active)) {
        for (const ac of active) {
          if (!seen.has(ac as PlayerColor)) {
            return { valid: false, error: `displayRankings missing active match color "${ac}"` };
          }
        }
      }
    }
  }

  // Check activeSeatCount matches non-closed seats layout
  if (typeof s.activeSeatCount !== 'number' || s.activeSeatCount !== nonClosedSeatCount) {
    return {
      valid: false,
      error: `activeSeatCount (${s.activeSeatCount}) contradicts seat layout (${nonClosedSeatCount})`,
    };
  }

  // Host userId validation
  if (s.status === 'lobby') {
    if (humanSeatCount > 0) {
      if (typeof s.hostUserId !== 'string' || !humanUserIds.has(s.hostUserId)) {
        return { valid: false, error: `Invalid hostUserId "${s.hostUserId}": does not match any human seat` };
      }
    } else {
      if (s.hostUserId !== null && s.hostUserId !== undefined) {
        return { valid: false, error: 'hostUserId must be null when there are no human players in lobby' };
      }
    }
  }

  if (s.status === 'playing' || s.status === 'finished') {
    // Playing/finished room must not have open seats
    for (const color of CANONICAL_COLORS) {
      const seat = seats[color] as Record<string, unknown>;
      if (seat.status === 'open') {
        return { valid: false, error: `Active match cannot have open seat "${color}"` };
      }
    }

    if (!s.engineState || typeof s.engineState !== 'object') {
      return { valid: false, error: 'Missing engineState for active/finished match' };
    }
    const engineVal = validateLudoState(s.engineState);
    if (!engineVal.valid) {
      return { valid: false, error: `Invalid engineState: ${engineVal.error}` };
    }

    // Cross-validate active seat colors match engine active colors
    const engineActive = new Set(engineVal.state.activeColors);
    for (const color of CANONICAL_COLORS) {
      const seat = seats[color] as Record<string, unknown>;
      const isActiveSeat = seat.status === 'human' || seat.status === 'bot';
      if (isActiveSeat && !engineActive.has(color as PlayerColor)) {
        return { valid: false, error: `Active seat "${color}" not present in engine activeColors` };
      }
      if (!isActiveSeat && engineActive.has(color as PlayerColor)) {
        return { valid: false, error: `Engine active color "${color}" is closed in room seats` };
      }
    }

    // Cross-validate engine player identities match occupied active seats
    for (const player of Object.values(engineVal.state.players)) {
      if (!player) continue;
      const seat = seats[player.color] as Record<string, unknown>;
      if (!seat) {
        return { valid: false, error: `Engine player "${player.color}" has no room seat` };
      }
      if (player.type !== seat.status) {
        return {
          valid: false,
          error: `Engine player "${player.color}" type (${player.type}) does not match seat status (${seat.status})`,
        };
      }
      if (player.type === 'human' && player.id !== seat.userId) {
        return {
          valid: false,
          error: `Engine player "${player.color}" id (${player.id}) does not match seat userId (${seat.userId})`,
        };
      }
    }
  }

  return { valid: true, state: data as LudoRoomState };
}
