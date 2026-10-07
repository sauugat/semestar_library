import {
  type PlayerColor,
  type BotDifficulty,
  type LudoClientMessage,
  type LudoServerEvent,
  parseLudoServerEvent,
} from './protocol.ts';
import {
  type LudoOnlineState,
  createInitialOnlineState,
  mapLudoErrorCodeToMessage,
} from './state.ts';
import {
  normalizeRoomCode,
  generateRoomCode,
  type RandomByteProvider,
} from './room-code.ts';

export type AppStateStatus = 'active' | 'background' | 'inactive';
export type OnlineEntryIntent = 'create' | 'join';

interface ReactNativeWebSocketOptions {
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface ReactNativeWebSocketConstructor {
  new (
    url: string,
    protocols?: string | string[] | null,
    options?: ReactNativeWebSocketOptions
  ): WebSocket;
}

export interface OnlineLudoClientDependencies {
  ticketProvider?: () => Promise<{ ticket: string }>;
  wsUrlResolver?: (roomId: string) => string;
  socketFactory?: (url: string, protocols: string | null, options: ReactNativeWebSocketOptions) => WebSocket;
  appStateProvider?: {
    currentState: AppStateStatus;
    addEventListener: (type: 'change', listener: (state: AppStateStatus) => void) => { remove: () => void };
  };
  randomBytesProvider?: RandomByteProvider;
  timerFn?: typeof setTimeout;
  clearTimerFn?: typeof clearTimeout;
}

const MAX_RECONNECT_DELAY_MS = 8000;
const BASE_RECONNECT_DELAY_MS = 500;
const HANDSHAKE_TIMEOUT_MS = 10000;
export const MAX_CREATE_RETRIES = 3;

async function defaultTicketProvider(): Promise<{ ticket: string }> {
  try {
    const { requestGamesTicket } = await import('../games-api');
    return requestGamesTicket();
  } catch {
    throw new Error('Unable to acquire games ticket');
  }
}

function defaultWsUrlResolver(roomId: string): string {
  const rawUrl =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_GAMES_WS_URL) ||
    'wss://semester-library-games.semester-library-games.workers.dev';
  const base = rawUrl.trim().replace(/\/+$/, '');
  return `${base}/rooms/${encodeURIComponent(roomId.trim())}/ws`;
}

function defaultSocketFactory(
  url: string,
  protocols: string | null,
  options: ReactNativeWebSocketOptions
): WebSocket {
  const RNWebSocket = WebSocket as unknown as ReactNativeWebSocketConstructor;
  return new RNWebSocket(url, protocols, options);
}

function defaultAppStateProvider(): {
  currentState: AppStateStatus;
  addEventListener: (type: 'change', listener: (state: AppStateStatus) => void) => { remove: () => void };
} {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).ReactNativeAppState) {
      return (globalThis as any).ReactNativeAppState;
    }
  } catch {}
  return {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  };
}

export class OnlineLudoClient {
  private state: LudoOnlineState = createInitialOnlineState();
  private listeners: Set<(state: LudoOnlineState) => void> = new Set();
  private actionListeners: Set<(event: LudoServerEvent) => void> = new Set();

  private ws: WebSocket | null = null;
  private connectionGeneration: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt: number = 0;
  private isExplicitlyClosed: boolean = false;
  private preferredColor?: PlayerColor;
  private entryIntent: OnlineEntryIntent = 'join';
  private createRetryCount: number = 0;
  private hasSentJoinForCurrentConnection: boolean = false;
  private processedActionIds: Set<string> = new Set();
  private processedActionOrder: string[] = [];
  public static readonly MAX_PROCESSED_ACTION_IDS = 256;
  private appStateSubscription: { remove: () => void } | null = null;

  private readonly ticketProvider: () => Promise<{ ticket: string }>;
  private readonly wsUrlResolver: (roomId: string) => string;
  private readonly socketFactory: (url: string, protocols: string | null, options: ReactNativeWebSocketOptions) => WebSocket;
  private readonly appStateProvider: {
    currentState: AppStateStatus;
    addEventListener: (type: 'change', listener: (state: AppStateStatus) => void) => { remove: () => void };
  };
  private readonly randomBytesProvider?: RandomByteProvider;
  private readonly timerFn: typeof setTimeout;
  private readonly clearTimerFn: typeof clearTimeout;

  constructor(deps?: OnlineLudoClientDependencies) {
    this.ticketProvider = deps?.ticketProvider || defaultTicketProvider;
    this.wsUrlResolver = deps?.wsUrlResolver || defaultWsUrlResolver;
    this.socketFactory = deps?.socketFactory || defaultSocketFactory;
    this.appStateProvider = deps?.appStateProvider || defaultAppStateProvider();
    this.randomBytesProvider = deps?.randomBytesProvider;
    this.timerFn = deps?.timerFn || setTimeout;
    this.clearTimerFn = deps?.clearTimerFn || clearTimeout;

    this.setupAppStateListener();
  }

  public getState(): LudoOnlineState {
    return this.state;
  }

  public subscribe(listener: (state: LudoOnlineState) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.state);
    } catch {}
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onActionEvent(listener: (event: LudoServerEvent) => void): () => void {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  private updateState(updater: (prev: LudoOnlineState) => Partial<LudoOnlineState>): void {
    const patch = updater(this.state);
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[OnlineLudoClient] Listener error:', err);
        }
      }
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      this.clearTimerFn(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimerFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setupAppStateListener(): void {
    if (this.appStateSubscription) return;
    try {
      this.appStateSubscription = this.appStateProvider.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          // Returning to foreground: if connection was lost or reconnecting, trigger exactly one reconnect attempt
          if (
            !this.isExplicitlyClosed &&
            this.state.roomId &&
            (this.state.connectionStatus === 'reconnecting' ||
              this.state.connectionStatus === 'closed' ||
              this.state.connectionStatus === 'error')
          ) {
            this.clearReconnectTimer();
            const gen = ++this.connectionGeneration;
            this.executeConnect(this.state.roomId, gen);
          }
        } else if (nextState === 'background') {
          // Defend against reconnect storms while in background
          this.clearReconnectTimer();
        }
      });
    } catch {}
  }

  /**
   * Connects to a private Ludo room with an explicit entry intent ('create' | 'join').
   */
  public async connect(
    roomId: string,
    preferredColor?: PlayerColor,
    intent: OnlineEntryIntent = 'join'
  ): Promise<void> {
    const normalizedRoomId = normalizeRoomCode(roomId);
    if (!normalizedRoomId) {
      throw new Error('Room code cannot be empty');
    }

    this.isExplicitlyClosed = false;
    this.preferredColor = preferredColor;
    this.entryIntent = intent;
    this.createRetryCount = 0;
    this.reconnectAttempt = 0;
    this.hasSentJoinForCurrentConnection = false;
    this.clearReconnectTimer();

    // Increment connection generation to invalidate any previous socket callbacks
    const gen = ++this.connectionGeneration;

    this.updateState(() => ({
      connectionStatus: 'authenticating',
      roomId: normalizedRoomId,
      lastError: null,
    }));

    return this.executeConnect(normalizedRoomId, gen);
  }

  private async executeConnect(roomId: string, gen: number): Promise<void> {
    this.clearHandshakeTimer();
    this.hasSentJoinForCurrentConnection = false;

    try {
      this.updateState(() => ({ connectionStatus: 'authenticating' }));

      // 1. Obtain fresh short-lived Games ticket
      const { ticket } = await this.ticketProvider();
      if (this.connectionGeneration !== gen) return;

      this.updateState(() => ({ connectionStatus: 'connecting' }));

      // 2. Build WebSocket URL
      const wsUrl = this.wsUrlResolver(roomId);
      if (this.connectionGeneration !== gen) return;

      // 3. Initiate native WebSocket connection with Bearer authentication header
      const socket = this.socketFactory(wsUrl, null, {
        headers: {
          Authorization: `Bearer ${ticket}`,
        },
      });

      this.ws = socket;

      // 4. Arm handshake timeout
      this.handshakeTimer = this.timerFn(() => {
        if (this.connectionGeneration !== gen) return;
        this.clearHandshakeTimer();
        this.handleSocketFailure(roomId, gen, new Error('Connection timed out'));
      }, HANDSHAKE_TIMEOUT_MS);

      socket.onopen = () => {
        if (this.connectionGeneration !== gen || this.ws !== socket) return;
        // Status remains 'connecting' until server sends valid CONNECTED event
      };

      socket.onmessage = (event: WebSocketMessageEvent) => {
        if (this.connectionGeneration !== gen || this.ws !== socket) return;
        this.handleMessage(event.data, roomId, gen);
      };

      socket.onerror = () => {
        if (this.connectionGeneration !== gen || this.ws !== socket) return;
        this.handleSocketFailure(roomId, gen, new Error('WebSocket connection error'));
      };

      socket.onclose = () => {
        if (this.connectionGeneration !== gen || this.ws !== socket) return;
        this.handleSocketFailure(roomId, gen, new Error('WebSocket closed'));
      };
    } catch (err: unknown) {
      if (this.connectionGeneration !== gen) return;
      this.handleSocketFailure(
        roomId,
        gen,
        err instanceof Error ? err : new Error('Failed to acquire ticket or connect')
      );
    }
  }

  private handleSocketFailure(roomId: string, gen: number, error: Error): void {
    if (this.connectionGeneration !== gen) return;

    this.clearHandshakeTimer();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    if (this.isExplicitlyClosed) {
      this.updateState(() => ({ connectionStatus: 'closed' }));
      return;
    }

    // Schedule exponential backoff reconnect
    this.updateState(() => ({
      connectionStatus: 'reconnecting',
      lastError: {
        message: error.message,
        friendlyMessage: 'Connection lost. Reconnecting…',
      },
    }));

    // If app is currently backgrounded, pause reconnect until app foregrounds
    if (this.appStateProvider.currentState === 'background') {
      return;
    }

    this.reconnectAttempt++;
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1) + Math.random() * 200
    );

    this.clearReconnectTimer();
    this.reconnectTimer = this.timerFn(() => {
      if (this.connectionGeneration !== gen || this.isExplicitlyClosed) return;
      this.executeConnect(roomId, gen);
    }, delay);
  }

  private handleMessage(rawData: string | ArrayBuffer, roomId: string, gen: number): void {
    if (this.connectionGeneration !== gen) return;

    let text: string;
    if (typeof rawData === 'string') {
      text = rawData;
    } else {
      text = new TextDecoder().decode(rawData);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // Malformed JSON is discarded safely without crashing
      return;
    }

    const event = parseLudoServerEvent(parsedJson);
    if (!event) {
      // Unknown or malformed protocol event safely ignored
      return;
    }

    switch (event.type) {
      case 'CONNECTED': {
        this.clearHandshakeTimer();
        this.reconnectAttempt = 0;
        this.updateState(() => ({
          connectionStatus: 'connected',
          myUserId: event.userId,
        }));

        // Send exactly one LUDO_JOIN per connection generation
        if (!this.hasSentJoinForCurrentConnection) {
          this.hasSentJoinForCurrentConnection = true;
          this.send({
            type: 'LUDO_JOIN',
            preferredColor: this.preferredColor,
          });
        }
        break;
      }

      case 'LUDO_LOBBY_STATE': {
        // Create Room Collision Guard:
        if (this.entryIntent === 'create') {
          const isHost = event.lobby.hostUserId === this.state.myUserId;
          const humans = Object.values(event.lobby.seats).filter((s) => s.status === 'human');
          const bots = Object.values(event.lobby.seats).filter((s) => s.status === 'bot');
          const isFreshLobby = isHost && humans.length === 1 && bots.length === 0;

          if (!isFreshLobby) {
            // Collision with an existing or abandoned room code
            if (this.createRetryCount < MAX_CREATE_RETRIES) {
              this.createRetryCount++;
              const nextRoomCode = generateRoomCode(this.randomBytesProvider);

              // Close current socket silently (sendLeave = false to avoid disrupting existing room)
              if (this.ws) {
                try {
                  this.ws.onopen = null;
                  this.ws.onmessage = null;
                  this.ws.onerror = null;
                  this.ws.onclose = null;
                  this.ws.close();
                } catch {}
                this.ws = null;
              }

              const nextGen = ++this.connectionGeneration;
              this.updateState(() => ({
                roomId: nextRoomCode,
                connectionStatus: 'authenticating',
                lastError: null,
              }));

              this.executeConnect(nextRoomCode, nextGen);
              return;
            } else {
              // Retry limit exhausted
              this.disconnect();
              this.updateState(() => ({
                connectionStatus: 'error',
                lastError: {
                  code: 'CREATE_EXHAUSTED',
                  message: 'Exhausted create room retries',
                  friendlyMessage: mapLudoErrorCodeToMessage('CREATE_EXHAUSTED'),
                },
              }));
              return;
            }
          }
        }

        // Snapshot revision deduplication
        if (event.revision < this.state.lastSnapshotRevision) {
          return; // Stale snapshot
        }
        if (event.revision === this.state.lastSnapshotRevision) {
          return; // Duplicate snapshot
        }

        // Newer authoritative snapshot: accept as truth
        this.updateState((prev) => ({
          lobby: event.lobby,
          presence: event.presence,
          lastSnapshotRevision: event.revision,
          lastAuthoritativeRevision: Math.max(event.revision, prev.lastActionRevision),
          actionQueue: [], // Snapshot resets presentation backlog
          presentationGapDetected: false,
          isResyncing: false,
          lastError: null,
        }));
        break;
      }

      case 'LUDO_GAME_STATE': {
        // Snapshot revision deduplication
        if (event.revision < this.state.lastSnapshotRevision) {
          return; // Stale snapshot
        }
        if (event.revision === this.state.lastSnapshotRevision) {
          return; // Duplicate snapshot
        }

        const isResyncingOrGap = this.state.isResyncing || this.state.presentationGapDetected;

        // Newer authoritative game snapshot: accept as truth
        this.updateState((prev) => ({
          playingState: event,
          presence: event.presence,
          lastSnapshotRevision: event.revision,
          lastAuthoritativeRevision: Math.max(event.revision, prev.lastActionRevision),
          // Clear queue only when recovering from gap/resync. Contiguous bot/human bursts
          // are preserved so presentation can sequentially animate every action.
          actionQueue: isResyncingOrGap ? [] : prev.actionQueue,
          presentationGapDetected: false,
          isResyncing: false,
          lastError: null,
        }));
        break;
      }

      case 'LUDO_DICE_ROLLED':
      case 'LUDO_MOVE_RESULT': {
        const actionId = `${event.type}:${event.revision}`;
        if (this.processedActionIds.has(actionId)) {
          return; // Duplicate action event
        }
        if (event.revision <= this.state.lastSnapshotRevision) {
          return; // Stale action event covered by current or newer snapshot
        }

        this.recordProcessedAction(actionId);

        // Detect action sequence gap
        const baselineRevision = Math.max(this.state.lastSnapshotRevision, this.state.lastActionRevision);
        let gapDetected = false;
        if (baselineRevision > 0 && event.revision > baselineRevision + 1) {
          gapDetected = true;
          this.requestState();
        }

        this.updateState((prev) => ({
          actionQueue: gapDetected ? prev.actionQueue : [...prev.actionQueue, event],
          presentationGapDetected: prev.presentationGapDetected || gapDetected,
          isResyncing: prev.isResyncing || gapDetected,
          lastActionRevision: event.revision,
          lastAuthoritativeRevision: Math.max(prev.lastSnapshotRevision, event.revision),
        }));

        // Dispatch action event to listeners only if presentation history is contiguous
        if (!gapDetected) {
          for (const actionListener of this.actionListeners) {
            try {
              actionListener(event);
            } catch {}
          }
        }
        break;
      }

      case 'LUDO_PRESENCE': {
        // Presence updates presence map without advancing snapshot/action revisions
        this.updateState((prev) => ({
          presence: {
            ...prev.presence,
            [event.userId]: event.online,
          },
        }));
        break;
      }

      case 'ERROR': {
        // Error events do not advance snapshot/action revisions
        const friendlyMessage = mapLudoErrorCodeToMessage(event.code, event.message);
        this.updateState(() => ({
          lastError: {
            code: event.code,
            message: event.message,
            friendlyMessage,
          },
        }));
        break;
      }
    }
  }

  /**
   * Sends an authoritative client message over the WebSocket.
   * Fails safely without throwing when disconnected or resyncing.
   */
  public send(message: LudoClientMessage): boolean {
    if (this.state.connectionStatus !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Block state-mutating commands while in resync state
    if (
      this.state.isResyncing &&
      message.type !== 'LUDO_REQUEST_STATE' &&
      message.type !== 'LUDO_LEAVE'
    ) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[OnlineLudoClient] Failed to send message:', err);
      }
      return false;
    }
  }

  // Authoritative Lobby Commands
  public setReady(ready: boolean): boolean {
    return this.send({ type: 'LUDO_SET_READY', ready });
  }

  public setPlayerCount(playerCount: 2 | 3 | 4): boolean {
    return this.send({ type: 'LUDO_SET_PLAYER_COUNT', playerCount });
  }

  public setSeat(color: PlayerColor, status: 'open' | 'closed'): boolean {
    return this.send({ type: 'LUDO_SET_SEAT', color, status });
  }

  public addBot(color: PlayerColor, difficulty: BotDifficulty = 'normal'): boolean {
    return this.send({ type: 'LUDO_ADD_BOT', color, difficulty });
  }

  public removeBot(color: PlayerColor): boolean {
    return this.send({ type: 'LUDO_REMOVE_BOT', color });
  }

  public setBotDifficulty(color: PlayerColor, difficulty: BotDifficulty): boolean {
    return this.send({ type: 'LUDO_SET_BOT_DIFFICULTY', color, difficulty });
  }

  public startGame(): boolean {
    return this.send({ type: 'LUDO_START_GAME' });
  }

  // Authoritative Gameplay Commands (Phase 4B2)
  public rollDice(): boolean {
    return this.send({ type: 'LUDO_ROLL_DICE' });
  }

  public moveToken(tokenId: number): boolean {
    return this.send({ type: 'LUDO_MOVE_TOKEN', tokenId });
  }

  // Action Queue Consumption & Acknowledgement (Phase 4B2)
  public peekNextAction(): LudoServerEvent | null {
    return this.state.actionQueue[0] || null;
  }

  public ackAction(eventOrId?: LudoServerEvent | string): void {
    this.updateState((prev) => {
      if (prev.actionQueue.length === 0) return prev;
      if (!eventOrId) {
        return { actionQueue: prev.actionQueue.slice(1) };
      }
      const targetId =
        typeof eventOrId === 'string'
          ? eventOrId
          : `${eventOrId.type}:${(eventOrId as any).revision}`;
      const head = prev.actionQueue[0];
      const headId = `${head.type}:${(head as any).revision}`;
      if (headId === targetId) {
        return { actionQueue: prev.actionQueue.slice(1) };
      }
      return {
        actionQueue: prev.actionQueue.filter(
          (a) => `${a.type}:${(a as any).revision}` !== targetId
        ),
      };
    });
  }

  public clearActionQueue(): void {
    this.updateState(() => ({
      actionQueue: [],
      presentationGapDetected: false,
    }));
  }

  private recordProcessedAction(actionId: string): void {
    this.processedActionIds.add(actionId);
    this.processedActionOrder.push(actionId);
    if (this.processedActionOrder.length > OnlineLudoClient.MAX_PROCESSED_ACTION_IDS) {
      const oldest = this.processedActionOrder.shift();
      if (oldest) {
        this.processedActionIds.delete(oldest);
      }
    }
  }

  public requestState(): boolean {
    this.updateState(() => ({ isResyncing: true }));
    return this.send({ type: 'LUDO_REQUEST_STATE' });
  }

  public leaveRoom(): void {
    try {
      this.send({ type: 'LUDO_LEAVE' });
    } catch {}
    this.disconnect();
  }

  /**
   * Intentionally closes connection and cleans up all timers and resources.
   */
  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.connectionGeneration++;
    this.clearHandshakeTimer();
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.processedActionIds.clear();
    this.processedActionOrder = [];

    this.updateState(() => ({
      connectionStatus: 'closed',
      roomId: null,
      lobby: null,
      playingState: null,
      presence: {},
      actionQueue: [],
      presentationGapDetected: false,
      isResyncing: false,
    }));
  }

  public destroy(): void {
    this.disconnect();
    if (this.appStateSubscription) {
      try {
        this.appStateSubscription.remove();
      } catch {}
      this.appStateSubscription = null;
    }
    this.listeners.clear();
    this.actionListeners.clear();
  }
}
