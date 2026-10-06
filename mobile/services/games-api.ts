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
