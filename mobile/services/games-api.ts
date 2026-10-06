import { apiFetch } from '@/services/api';

const RAW_GAMES_WS_URL =
  process.env.EXPO_PUBLIC_GAMES_WS_URL ||
  'wss://semester-library-games.semester-library-games.workers.dev';

export const GAMES_WS_BASE_URL = RAW_GAMES_WS_URL.trim().replace(/\/+$/, '');

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
