import {
  parseGamesServerEvent,
  type GamesClientMessage,
  type GamesServerEvent,
} from '@/types/games';
import { requestGamesTicket, getGamesRoomWebSocketUrl } from './games-api';

export type GamesSocketStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type GamesEventListener = (event: GamesServerEvent) => void;
export type GamesStatusListener = (status: GamesSocketStatus) => void;

/**
 * Narrow local compatibility interface for React Native's native WebSocket constructor,
 * which supports an options bag containing custom handshake headers as its 3rd argument.
 */
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

const RNWebSocket = WebSocket as unknown as ReactNativeWebSocketConstructor;

const HANDSHAKE_TIMEOUT_MS = 10_000;

export class GamesSocketClient {
  private ws: WebSocket | null = null;
  private status: GamesSocketStatus = 'idle';
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private connectionGeneration: number = 0;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingConnectPromise: Promise<void> | null = null;
  private pendingConnectResolve: (() => void) | null = null;
  private pendingConnectReject: ((reason?: unknown) => void) | null = null;

  private eventListeners: Set<GamesEventListener> = new Set();
  private statusListeners: Set<GamesStatusListener> = new Set();

  public getStatus(): GamesSocketStatus {
    return this.status;
  }

  public getRoomId(): string | null {
    return this.currentRoomId;
  }

  public getUserId(): string | null {
    return this.currentUserId;
  }

  public onEvent(listener: GamesEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onStatusChange(listener: GamesStatusListener): () => void {
    this.statusListeners.add(listener);
    try {
      listener(this.status);
    } catch {}
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(newStatus: GamesSocketStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        if (__DEV__) {
          console.warn('[GamesSocket] Error in status listener:', err);
        }
      }
    }
  }

  private dispatchEvent(event: GamesServerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        if (__DEV__) {
          console.warn('[GamesSocket] Error in event listener:', err);
        }
      }
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  /**
   * Connects to a game room using a freshly acquired short-lived Games ticket.
   * Authentication is passed exclusively via the native WebSocket upgrade header.
   * connect() resolves only after receiving and validating the server CONNECTED event.
   */
  public async connect(roomId: string): Promise<void> {
    if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
      throw new Error('Cannot connect: Room ID cannot be empty');
    }

    const targetRoomId = roomId.trim();

    // Prevent duplicate simultaneous connection attempts to the same room
    if (
      this.status === 'connecting' &&
      this.currentRoomId === targetRoomId &&
      this.pendingConnectPromise
    ) {
      return this.pendingConnectPromise;
    }

    if (this.status === 'connected' && this.currentRoomId === targetRoomId) {
      return;
    }

    // Clean up any existing connection and invalidate older generation
    this.disconnect();

    const gen = ++this.connectionGeneration;
    this.currentRoomId = targetRoomId;
    this.currentUserId = null;
    this.setStatus('connecting');

    this.pendingConnectPromise = new Promise<void>((resolve, reject) => {
      this.pendingConnectResolve = resolve;
      this.pendingConnectReject = reject;

      // Start handshake timeout timer
      this.handshakeTimer = setTimeout(() => {
        if (this.connectionGeneration !== gen) return;

        this.clearHandshakeTimer();
        this.setStatus('error');

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

        const rejectFn = this.pendingConnectReject;
        this.pendingConnectResolve = null;
        this.pendingConnectReject = null;
        this.pendingConnectPromise = null;

        if (rejectFn) {
          rejectFn(new Error('Games connection handshake timed out.'));
        }
      }, HANDSHAKE_TIMEOUT_MS);

      // Perform handshake
      (async () => {
        try {
          // 1. Obtain short-lived in-memory ticket via Semester Library session
          const { ticket } = await requestGamesTicket();
          if (this.connectionGeneration !== gen) return;

          // 2. Build clean URL (no credentials in URL)
          const wsUrl = getGamesRoomWebSocketUrl(targetRoomId);
          if (this.connectionGeneration !== gen) return;

          // 3. Initiate native WebSocket connection with Bearer authentication header
          const socket = new RNWebSocket(wsUrl, null, {
            headers: {
              Authorization: `Bearer ${ticket}`,
            },
          });

          this.ws = socket;

          socket.onopen = () => {
            if (this.connectionGeneration !== gen || this.ws !== socket) return;
            // Status remains 'connecting' until backend sends valid CONNECTED event
          };

          socket.onmessage = (event: WebSocketMessageEvent) => {
            if (this.connectionGeneration !== gen || this.ws !== socket) return;
            this.handleMessage(event.data, targetRoomId, gen);
          };

          socket.onerror = () => {
            if (this.connectionGeneration !== gen || this.ws !== socket) return;
            this.clearHandshakeTimer();
            this.setStatus('error');

            const rejectFn = this.pendingConnectReject;
            this.pendingConnectResolve = null;
            this.pendingConnectReject = null;
            this.pendingConnectPromise = null;

            if (rejectFn) {
              rejectFn(new Error('Games WebSocket connection failed.'));
            }
          };

          socket.onclose = () => {
            if (this.connectionGeneration !== gen || this.ws !== socket) return;
            this.clearHandshakeTimer();
            this.setStatus('closed');
            this.ws = null;

            const rejectFn = this.pendingConnectReject;
            this.pendingConnectResolve = null;
            this.pendingConnectReject = null;
            this.pendingConnectPromise = null;

            if (rejectFn) {
              rejectFn(new Error('Games WebSocket closed prematurely.'));
            }
          };
        } catch (err) {
          if (this.connectionGeneration !== gen) return;
          this.clearHandshakeTimer();
          this.setStatus('error');

          const rejectFn = this.pendingConnectReject;
          this.pendingConnectResolve = null;
          this.pendingConnectReject = null;
          this.pendingConnectPromise = null;

          if (rejectFn) {
            rejectFn(
              err instanceof Error
                ? err
                : new Error('Failed to initiate games connection.')
            );
          }
        }
      })();
    });

    return this.pendingConnectPromise;
  }

  public disconnect(): void {
    // Invalidate generation immediately
    this.connectionGeneration++;
    this.clearHandshakeTimer();

    // If a connect attempt was pending, reject it cleanly
    const rejectFn = this.pendingConnectReject;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    this.pendingConnectPromise = null;

    if (rejectFn) {
      try {
        rejectFn(new Error('Games connection was cancelled.'));
      } catch {}
    }

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

    this.currentRoomId = null;
    this.currentUserId = null;
    this.setStatus('closed');
  }

  public send(message: GamesClientMessage): void {
    if (this.status !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Games connection is not ready.');
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      if (__DEV__) {
        console.warn('[GamesSocket] Failed to send message:', err);
      }
      throw err;
    }
  }

  private handleMessage(
    rawData: string | ArrayBuffer,
    expectedRoomId: string,
    gen: number
  ): void {
    if (this.connectionGeneration !== gen) return;

    let text: string;
    if (typeof rawData === 'string') {
      text = rawData;
    } else {
      text = new TextDecoder().decode(rawData);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Malformed JSON is safely ignored without crashing
      return;
    }

    const event = parseGamesServerEvent(parsed);
    if (!event) {
      // Malformed or unknown server event is safely discarded
      if (__DEV__) {
        console.warn('[GamesSocket] Discarded invalid server event');
      }
      return;
    }

    // Complete connection handshake upon receiving valid CONNECTED event for current room
    if (event.type === 'CONNECTED') {
      if (event.roomId === expectedRoomId && this.status === 'connecting') {
        this.clearHandshakeTimer();
        this.currentUserId = event.userId;
        this.setStatus('connected');

        const resolveFn = this.pendingConnectResolve;
        this.pendingConnectResolve = null;
        this.pendingConnectReject = null;
        this.pendingConnectPromise = null;

        if (resolveFn) {
          resolveFn();
        }
      }
    }

    // Dispatch validated event to listeners
    this.dispatchEvent(event);
  }
}
