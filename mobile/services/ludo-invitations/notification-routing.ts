/**
 * Notification Routing and Parsing Utilities for Ludo Invitations
 * Phase 4C2B
 */

export interface ParsedLudoInvitationPayload {
  type: 'ludo_invitation';
  invitationId: string;
  roomId?: string;
  gameType: 'ludo';
  actorId?: string;
  actorName?: string;
}

/**
 * Parses raw push notification data into a strictly typed Ludo invitation payload.
 * Returns null if the data is invalid, expired, or not a Ludo invitation.
 */
export function parseLudoNotificationPayload(
  data: unknown
): ParsedLudoInvitationPayload | null {
  if (!data || typeof data !== 'object') return null;

  const raw = data as Record<string, any>;
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';

  // Direct ludo_invitation payload
  if (type === 'ludo_invitation') {
    const invitationId = typeof raw.invitationId === 'string' ? raw.invitationId.trim() : '';
    if (!invitationId) return null;

    const roomId =
      typeof raw.roomId === 'string' && raw.roomId.trim().length > 0
        ? raw.roomId.trim().toUpperCase()
        : undefined;

    return {
      type: 'ludo_invitation',
      invitationId,
      roomId,
      gameType: 'ludo',
      actorId: raw.actorId ? String(raw.actorId) : undefined,
      actorName: raw.actorName ? String(raw.actorName) : undefined,
    };
  }

  // Generic game_invite payload where gameType === 'ludo'
  if (type === 'game_invite') {
    const gameType = typeof raw.gameType === 'string' ? raw.gameType.trim().toLowerCase() : '';
    if (gameType !== 'ludo') return null;

    const invitationId = typeof raw.invitationId === 'string' ? raw.invitationId.trim() : '';
    if (!invitationId) return null;

    const roomId =
      typeof raw.roomId === 'string' && raw.roomId.trim().length > 0
        ? raw.roomId.trim().toUpperCase()
        : undefined;

    return {
      type: 'ludo_invitation',
      invitationId,
      roomId,
      gameType: 'ludo',
      actorId: raw.actorId ? String(raw.actorId) : undefined,
      actorName: raw.actorName ? String(raw.actorName) : undefined,
    };
  }

  return null;
}

/**
 * Returns the deep-link route for an invitation.
 */
export function getLudoInvitationRoute(invitationId: string): string {
  if (!invitationId || typeof invitationId !== 'string') {
    return '/games';
  }
  return `/games/ludo/invitations/${encodeURIComponent(invitationId.trim())}`;
}

export interface NotificationTapHandlerOptions {
  isAuthenticated: boolean;
  navigate: (route: string) => void;
  redirectToLogin: () => void;
  setPending: (payload: ParsedLudoInvitationPayload) => void;
  notificationIdentifier?: string;
  lastTapState?: { lastId?: string; lastTimestamp?: number };
  debounceMs?: number;
  now?: number;
}

/**
 * Handles incoming push notification tap with debounce, auth-gating, and safe routing.
 * Returns true if navigation was executed or queued, false if duplicate or invalid.
 */
export function handleLudoNotificationTap(
  rawPayload: unknown,
  options: NotificationTapHandlerOptions
): boolean {
  const now = options.now ?? Date.now();
  const debounceWindow = options.debounceMs ?? 4000;

  // Duplicate tap detection within debounce window
  if (options.notificationIdentifier && options.lastTapState) {
    if (
      options.lastTapState.lastId === options.notificationIdentifier &&
      now - (options.lastTapState.lastTimestamp ?? 0) < debounceWindow
    ) {
      return false;
    }
    options.lastTapState.lastId = options.notificationIdentifier;
    options.lastTapState.lastTimestamp = now;
  }

  const payload = parseLudoNotificationPayload(rawPayload);
  if (!payload) {
    return false;
  }

  // Unauthenticated gating
  if (!options.isAuthenticated) {
    options.setPending(payload);
    options.redirectToLogin();
    return true;
  }

  // Authenticated direct routing
  const route = getLudoInvitationRoute(payload.invitationId);
  options.navigate(route);
  return true;
}

/**
 * Formats seconds into human-readable countdown string.
 */
export function formatInvitationCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

/**
 * Maps invitation error codes to user-friendly messages.
 */
export function mapInvitationError(errorCode: string): { title: string; message: string } {
  switch (errorCode) {
    case 'ROOM_STARTED':
      return {
        title: 'Match Already Started',
        message: 'This match has already started and cannot accept new players.',
      };
    case 'ROOM_FULL':
      return {
        title: 'Room is Full',
        message: 'All seats in this match have been taken by other players.',
      };
    case 'ROOM_UNAVAILABLE':
    case 'ROOM_NOT_FOUND':
      return {
        title: 'Room Unavailable',
        message: 'This room is no longer active or could not be found.',
      };
    case 'EXPIRED':
      return {
        title: 'Invitation Expired',
        message: 'This invitation has expired. Ask the host to send a new invite.',
      };
    case 'INVITATION_STALE':
      return {
        title: 'Invitation Stale',
        message: 'This invitation belongs to an earlier match.',
      };
    case 'WRONG_ACCOUNT':
    case 'FORBIDDEN':
      return {
        title: 'Unavailable',
        message: "This invitation isn't available for this account.",
      };
    case 'RATE_LIMIT_EXCEEDED':
    case 'RATE_LIMITED':
      return {
        title: 'Please Wait',
        message: 'Too many invitations sent. Please wait a moment before trying again.',
      };
    default:
      return {
        title: 'Invitation Error',
        message: 'An error occurred while processing this invitation.',
      };
  }
}
