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

export interface LudoRoomCallbacks {
  broadcast: (event: LudoServerEvent) => void;
  sendToSocket: (ws: WebSocket, event: LudoServerEvent) => void;
  getUserSockets: (userId: string) => WebSocket[];
  persist: (state: LudoRoomState) => void;
}

export interface LudoControllerOptions {
  diceRoller?: DiceRoller;
}

function createDefaultSeats(): Record<PlayerColor, LudoSeat> {
  return {
    red: { color: 'red', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
    green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
    blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
  };
}

export class LudoOnlineController {
  public readonly gameType = 'ludo' as const;
  private readonly roomId: string;
  private callbacks: LudoRoomCallbacks;
  private diceRoller: DiceRoller;

  private state: LudoRoomState;
  private engine: LudoEngine | null = null;
  private corruptedStateError: string | null = null;

  constructor(
    roomId: string,
    callbacks: LudoRoomCallbacks,
    initialState?: LudoRoomState,
    options: LudoControllerOptions = {}
  ) {
    this.roomId = roomId;
    this.callbacks = callbacks;
    this.diceRoller = options.diceRoller || createCryptographicDiceRoller();

    if (initialState) {
      this.state = initialState;
      if (initialState.engineState) {
        try {
          this.engine = LudoEngine.fromState(initialState.engineState);
        } catch (err: unknown) {
          this.corruptedStateError = err instanceof Error ? err.message : String(err);
        }
      }
    } else {
      const now = Date.now();
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
      };
    }
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

  private sendError(ws: WebSocket, message: string, code?: string): void {
    this.callbacks.sendToSocket(ws, {
      type: 'ERROR',
      message,
      ...(code ? { code } : {}),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private commitAndBroadcast(candidateState: LudoRoomState, onCommit?: () => void): boolean {
    candidateState.updatedAt = Date.now();
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
        state: this.state.engineState,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
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
        state: this.state.engineState,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
      });
    }

    // Broadcast presence change to other connected sockets
    this.callbacks.broadcast({
      type: 'LUDO_PRESENCE',
      roomId: this.roomId,
      userId,
      online: true,
      protocolVersion: PROTOCOL_VERSION,
    });

    if (this.state.status === 'playing' && this.state.engineState) {
      this.progressBotTurnIfActive();
    }
  }

  public handleDisconnect(userId: string): void {
    const remainingSockets = this.callbacks.getUserSockets(userId);
    if (remainingSockets.length === 0) {
      this.callbacks.broadcast({
        type: 'LUDO_PRESENCE',
        roomId: this.roomId,
        userId,
        online: false,
        protocolVersion: PROTOCOL_VERSION,
      });
    }
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
    seat.userId = null;
    seat.displayName = `${(color as string).charAt(0).toUpperCase() + (color as string).slice(1)} Bot`;
    seat.botDifficulty = diff as BotDifficulty;
    seat.ready = true;

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
    seat.userId = null;
    seat.displayName = null;
    seat.botDifficulty = null;
    seat.ready = false;

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

    const currentTurn = this.state.engineState.currentTurn;
    if (!currentTurn) {
      this.sendError(ws, 'No active turn', 'INVALID_PHASE');
      return;
    }

    const seat = this.state.seats[currentTurn];
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
    candidateState.updatedAt = Date.now();

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
      state: this.state.engineState!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
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

    const currentTurn = this.state.engineState.currentTurn;
    if (!currentTurn) {
      this.sendError(ws, 'No active turn', 'INVALID_PHASE');
      return;
    }

    const seat = this.state.seats[currentTurn];
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
    candidateState.updatedAt = Date.now();

    if (moveRes.gameFinished || candidateState.engineState.status === 'finished') {
      candidateState.status = 'finished';
      candidateState.rankings = [...candidateState.engineState.rankings];
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
      state: this.state.engineState!,
      seats: this.state.seats,
      hostUserId: this.state.hostUserId,
      presence: this.getPresence(),
      revision: this.state.revision,
      protocolVersion: PROTOCOL_VERSION,
    });

    // If next turn is bot:
    this.progressBotTurnIfActive();
  }

  private progressBotTurnIfActive(): void {
    if (this.state.status !== 'playing' || !this.engine || !this.state.engineState) {
      return;
    }

    let loopGuard = 0;
    while (
      this.state.status === 'playing' &&
      this.state.engineState &&
      this.state.engineState.currentTurn &&
      this.state.seats[this.state.engineState.currentTurn]?.status === 'bot' &&
      loopGuard < MAX_BOT_TURNS_PER_ACTION
    ) {
      loopGuard++;
      const botColor = this.state.engineState.currentTurn;
      const botSeat = this.state.seats[botColor];
      const botDifficulty = botSeat.botDifficulty || 'normal';

      if (this.state.engineState.turnPhase === 'roll') {
        const candidateEngine = LudoEngine.fromState(this.engine.getState());
        const rollRes = candidateEngine.rollDice(this.diceRoller);
        if (!rollRes.success) break;

        const candidateState: LudoRoomState = JSON.parse(JSON.stringify(this.state));
        candidateState.engineState = candidateEngine.getState();
        candidateState.revision++;
        candidateState.updatedAt = Date.now();

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
          state: this.state.engineState!,
          seats: this.state.seats,
          hostUserId: this.state.hostUserId,
          presence: this.getPresence(),
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
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
        candidateState.updatedAt = Date.now();

        if (moveRes.gameFinished || candidateState.engineState.status === 'finished') {
          candidateState.status = 'finished';
          candidateState.rankings = [...candidateState.engineState.rankings];
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
          state: this.state.engineState!,
          seats: this.state.seats,
          hostUserId: this.state.hostUserId,
          presence: this.getPresence(),
          revision: this.state.revision,
          protocolVersion: PROTOCOL_VERSION,
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
          for (const c of ['red', 'yellow', 'green', 'blue'] as PlayerColor[]) {
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
    }
    // During active game: socket detach only, seat reserved for reconnect (defer forfeit to Phase 4C)
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
        state: this.state.engineState,
        seats: this.state.seats,
        hostUserId: this.state.hostUserId,
        presence: this.getPresence(),
        revision: this.state.revision,
        protocolVersion: PROTOCOL_VERSION,
      });
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
