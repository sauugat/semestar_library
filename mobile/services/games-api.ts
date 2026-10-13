import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiFetch, isQaMode, isLocalAddress } from '@/services/api';

/**
 * Derives the host address for the local Cloudflare games worker in development.
 * Accurately routes to:
 * 1. Explicit EXPO_PUBLIC_GAMES_WS_URL if set.
 * 2. Host derived from explicit EXPO_PUBLIC_API_URL if it points to a LAN IP.
 * 3. Host derived from Expo Metro hostUri / debuggerHost (Physical Android / iOS on Wi-Fi).
 * 4. Android Emulator host alias (10.0.2.2) when running on Android emulator without custom host.
 * 5. Loopback 127.0.0.1 for MacBook local test runner / iOS simulator.
 */
export function getLocalGamesWorkerHost(): string {
  // 1. Explicit games worker environment variable
  const explicitGamesUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GAMES_WS_URL?.trim() : undefined;
  if (explicitGamesUrl) {
    try {
      const sanitized = explicitGamesUrl
        .replace(/^ws:\/\//i, 'http://')
        .replace(/^wss:\/\//i, 'https://');
      const parsed = new URL(sanitized);
      if (parsed.hostname) {
        return parsed.hostname;
      }
    } catch {}
  }

  // 2. Derive host from explicit EXPO_PUBLIC_API_URL if it is a local LAN address
  const explicitApiUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_URL?.trim() : undefined;
  if (explicitApiUrl && isLocalAddress(explicitApiUrl)) {
    try {
      const parsed = new URL(explicitApiUrl);
      if (parsed.hostname && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return parsed.hostname;
      }
    } catch {}
  }

  // 3. Auto-detected LAN host from Expo Metro debugger host (Physical Android / iOS on Wi-Fi)
  try {
    const hostUri =
      Constants?.expoConfig?.hostUri ||
      (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost;
    if (hostUri && typeof hostUri === 'string') {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return host;
      }
    }
  } catch {}

  // 4. Android emulator fallback (10.0.2.2) when running on Android without custom LAN host
  try {
    if (typeof Platform !== 'undefined' && Platform.OS === 'android') {
      return '10.0.2.2';
    }
  } catch {}

  // 5. Default loopback for MacBook local tests and iOS simulator
  return '127.0.0.1';
}

/**
 * Resolves the WebSocket base URL with strict production isolation guards:
 * - In QA mode or DEV: Only connects to local address (derived host on port 8789 or EXPO_PUBLIC_GAMES_WS_URL).
 *   Never silently falls back to the production Cloudflare Worker.
 * - In Production: Uses EXPO_PUBLIC_GAMES_WS_URL or production worker when QA mode is disabled.
 */
export function resolveGamesWsUrl(): string {
  const isQa = typeof isQaMode === 'function' ? isQaMode() : Boolean(process.env?.EXPO_PUBLIC_QA_MODE === 'true');
  const explicitWsUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GAMES_WS_URL?.trim() : undefined;

  if (isQa || (typeof __DEV__ !== 'undefined' && __DEV__)) {
    if (explicitWsUrl) {
      return explicitWsUrl.replace(/\/+$/, '');
    }
    const host = getLocalGamesWorkerHost();
    return `ws://${host}:8789`;
  }

  // Production environment
  if (explicitWsUrl) {
    return explicitWsUrl.replace(/\/+$/, '');
  }
  return 'wss://semester-library-games.semester-library-games.workers.dev';
}

export const GAMES_WS_BASE_URL = resolveGamesWsUrl();

/**
 * Checks whether an online multiplayer backend is safely and explicitly configured.
 */
export function isOnlineGamesConfigured(): boolean {
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_GAMES_DISABLED === 'true') {
    return false;
  }
  const isQa = typeof isQaMode === 'function' ? isQaMode() : Boolean(process.env?.EXPO_PUBLIC_QA_MODE === 'true');
  if (isQa || (typeof __DEV__ !== 'undefined' && __DEV__)) {
    return Boolean(
      process.env?.EXPO_PUBLIC_ENABLE_LOCAL_QA_GAMES === 'true' ||
      process.env?.EXPO_PUBLIC_GAMES_WS_URL ||
      process.env?.EXPO_PUBLIC_QA_MODE === 'true'
    );
  }
  return Boolean(GAMES_WS_BASE_URL);
}

export function isOnlineGamesAvailable(): boolean {
  return isOnlineGamesConfigured();
}

export type GamesWorkerReachabilityStatus =
  | 'not_configured'
  | 'configured_unreachable'
  | 'available';

export interface GamesWorkerHealthResult {
  status: GamesWorkerReachabilityStatus;
  available: boolean;
  message?: string;
  wsUrl: string;
}

let lastHealthCheckResult: {
  status: GamesWorkerReachabilityStatus;
  timestamp: number;
  message?: string;
} | null = null;

const HEALTH_CACHE_TTL_MS = 15_000; // 15 seconds cooldown

/**
 * Probes the games worker to determine actual network reachability.
 * Uses a short (2000ms) timeout and caches results for 15s to avoid polling storms.
 */
export async function checkGamesWorkerReachability(
  forceRefresh = false
): Promise<GamesWorkerHealthResult> {
  const wsUrl = resolveGamesWsUrl();

  if (!isOnlineGamesConfigured()) {
    return {
      status: 'not_configured',
      available: false,
      message: 'Multiplayer is not configured or disabled in environment settings.',
      wsUrl,
    };
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    lastHealthCheckResult &&
    now - lastHealthCheckResult.timestamp < HEALTH_CACHE_TTL_MS
  ) {
    return {
      status: lastHealthCheckResult.status,
      available: lastHealthCheckResult.status === 'available',
      message: lastHealthCheckResult.message,
      wsUrl,
    };
  }

  // Convert ws:// to http:// or wss:// to https://
  const httpUrl = wsUrl
    .replace(/^ws:\/\//i, 'http://')
    .replace(/^wss:\/\//i, 'https://');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${httpUrl}/`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data && (data.service === 'semester-library-games' || data.status === 'ok')) {
        lastHealthCheckResult = { status: 'available', timestamp: now };
        return { status: 'available', available: true, wsUrl };
      }
    }

    const msg = `Games server at ${wsUrl} returned status ${response.status}.`;
    lastHealthCheckResult = {
      status: 'configured_unreachable',
      timestamp: now,
      message: msg,
    };
    return {
      status: 'configured_unreachable',
      available: false,
      message: msg,
      wsUrl,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    const msg = isTimeout
      ? `Games server at ${wsUrl} timed out after 2 seconds.`
      : `Cannot reach local games worker at ${wsUrl}. Ensure local worker is running.`;

    lastHealthCheckResult = {
      status: 'configured_unreachable',
      timestamp: now,
      message: msg,
    };
    return {
      status: 'configured_unreachable',
      available: false,
      message: msg,
      wsUrl,
    };
  }
}

export interface GamesTicketResponse {
  ticket: string;
  expiresIn: number;
}

/**
 * Requests a short-lived (5-minute) Games ticket using the existing authenticated mobile session.
 * The ticket exists strictly in memory and is used solely for the WebSocket upgrade handshake.
 */
export async function requestGamesTicket(): Promise<GamesTicketResponse> {
  try {
    const response = await apiFetch('/api/games/ticket', {
      method: 'POST',
    });

    let rawData: unknown = null;
    try {
      const text = await response.text();
      if (text && text.trim()) {
        rawData = JSON.parse(text);
      }
    } catch {
      throw new Error('Unable to connect to games service. Please try again.');
    }

    if (!response.ok) {
      let errorMessage = 'Failed to obtain games authentication ticket.';
      if (
        rawData &&
        typeof rawData === 'object' &&
        'message' in rawData &&
        typeof (rawData as { message?: unknown }).message === 'string'
      ) {
        errorMessage = (rawData as { message: string }).message;
      }
      throw new Error(errorMessage);
    }

    if (
      !rawData ||
      typeof rawData !== 'object' ||
      typeof (rawData as { ticket?: unknown }).ticket !== 'string' ||
      !(rawData as { ticket: string }).ticket.trim() ||
      typeof (rawData as { expiresIn?: unknown }).expiresIn !== 'number' ||
      !Number.isFinite((rawData as { expiresIn: number }).expiresIn) ||
      (rawData as { expiresIn: number }).expiresIn <= 0
    ) {
      throw new Error('Invalid authentication response from games service.');
    }

    const validData = rawData as { ticket: string; expiresIn: number };
    return {
      ticket: validData.ticket.trim(),
      expiresIn: validData.expiresIn,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to acquire games authentication ticket.');
  }
}

/**
 * Constructs the canonical WebSocket connection URL for a specified game room.
 * URL format: wss://<host>/rooms/<encoded-room-id>/ws
 * Note: Ticket is never placed in the URL; authentication occurs exclusively via headers.
 */
export function getGamesRoomWebSocketUrl(roomId: string): string {
  if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
    throw new Error('Room ID cannot be empty');
  }

  const encodedRoomId = encodeURIComponent(roomId.trim());
  return `${GAMES_WS_BASE_URL}/rooms/${encodedRoomId}/ws`;
}

export interface GameInvitation {
  id: string;
  gameType: string;
  roomId: string;
  recipientStudentId?: string;
  expiresAt: string;
}

export interface GameInvitationValidationResult {
  id: string;
  gameType: string;
  roomId: string;
  inviter: {
    name: string;
  };
  expiresAt: string;
}

export interface GetGameInvitationResponse {
  invitation?: GameInvitationValidationResult;
  error?: string;
  expired?: boolean;
  status: number;
}

/**
 * Sends an in-app game invitation to a classmate for a specified room.
 * Rate-limited server-side and deduplicated against rapid repetitive taps.
 */
export async function sendGameInvitation(params: {
  roomId: string;
  recipientStudentId: string;
  gameType?: string;
}): Promise<{ invitation?: GameInvitation; error?: string; status: number }> {
  try {
    const res = await apiFetch('/api/games/invitations', {
      method: 'POST',
      body: JSON.stringify({
        roomId: params.roomId.trim().toUpperCase(),
        recipientStudentId: params.recipientStudentId.trim(),
        gameType: params.gameType || 'tic-tac-toe',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
          ? (data as { message: string }).message
          : res.status === 429
          ? "You're sending invitations too quickly. Try again shortly."
          : 'Failed to send game invitation.';
      return { error: msg, status: res.status };
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !('invitation' in data) ||
      typeof (data as { invitation?: { id?: unknown } }).invitation?.id !== 'string'
    ) {
      return { error: 'Invalid response from games service.', status: res.status };
    }

    return {
      invitation: (data as { invitation: GameInvitation }).invitation,
      status: res.status,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while sending invitation.';
    return { error: msg, status: 0 };
  }
}

/**
 * Retrieves and validates a game invitation prior to auto-joining.
 * Ensures the invitation belongs to the current user and has not expired.
 */
export async function getGameInvitation(invitationId: string): Promise<GetGameInvitationResponse> {
  if (!invitationId || typeof invitationId !== 'string' || !invitationId.trim()) {
    return { error: 'Invitation ID is required.', status: 400 };
  }

  try {
    const res = await apiFetch(`/api/games/invitations/${encodeURIComponent(invitationId.trim())}`, {
      method: 'GET',
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 410 || (data && typeof data === 'object' && (data as { expired?: boolean }).expired)) {
      return {
        error:
          data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'This game invitation is no longer active.',
        expired: true,
        status: 410,
      };
    }

    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
          ? (data as { message: string }).message
          : 'Invitation not found.';
      return { error: msg, status: res.status };
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !('invitation' in data) ||
      typeof (data as { invitation?: { id?: unknown } }).invitation?.id !== 'string'
    ) {
      return { error: 'Invalid invitation response.', status: res.status };
    }

    return {
      invitation: (data as { invitation: GameInvitationValidationResult }).invitation,
      status: res.status,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while validating invitation.';
    return { error: msg, status: 0 };
  }
}
