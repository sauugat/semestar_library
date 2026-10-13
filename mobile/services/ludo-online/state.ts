import type {
  PlayerColor,
  LudoSeat,
  LudoLobbyState,
  LudoGameStateEvent,
  LudoServerEvent,
  CANONICAL_COLORS,
} from './protocol.ts';

export type LudoClientConnectionStatus =
  | 'idle'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface LudoClientError {
  code?: string;
  message: string;
  friendlyMessage: string;
}

export interface LudoOnlineState {
  connectionStatus: LudoClientConnectionStatus;
  roomId: string | null;
  myUserId: string | null;
  lastSnapshotRevision: number;
  lastActionRevision: number;
  lastAuthoritativeRevision: number; // Max of snapshot & action revisions
  lobby: LudoLobbyState | null;
  playingState: LudoGameStateEvent | null;
  presence: Record<string, boolean>;
  actionQueue: LudoServerEvent[];
  presentationGapDetected: boolean;
  isResyncing: boolean;
  lastError: LudoClientError | null;
  pendingCommand: string | null;
}

/**
 * Creates a clean default client state.
 */
export function createInitialOnlineState(): LudoOnlineState {
  return {
    connectionStatus: 'idle',
    roomId: null,
    myUserId: null,
    lastSnapshotRevision: 0,
    lastActionRevision: 0,
    lastAuthoritativeRevision: 0,
    lobby: null,
    playingState: null,
    presence: {},
    actionQueue: [],
    presentationGapDetected: false,
    isResyncing: false,
    lastError: null,
    pendingCommand: null,
  };
}

/**
 * Maps structured server error codes to safe, friendly user-facing copy.
 * Never displays raw server stack traces or internal technical codes.
 */
export function mapLudoErrorCodeToMessage(code?: string, defaultMessage?: string): string {
  switch (code) {
    case 'CREATE_EXHAUSTED':
      return "Couldn't create a room. Please try again.";
    case 'INVALID_ROOM_CODE':
      return 'Invalid room code.';
    case 'ROOM_FULL':
      return 'This room is full.';
    case 'NOT_HOST':
      if (defaultMessage && defaultMessage.toLowerCase().includes('match')) {
        return defaultMessage.trim();
      }
      return 'Only the room host can start another match.';
    case 'NOT_READY':
      return 'All players must be ready before starting.';
    case 'SEAT_OCCUPIED':
      return 'That seat is already occupied.';
    case 'INVALID_PLAYER_COUNT':
      return 'Cannot reduce player count while occupied seats would be closed.';
    case 'SEAT_UNAVAILABLE':
      return 'That seat is currently unavailable.';
    case 'INVALID_BOT_DIFFICULTY':
      return 'Invalid bot difficulty.';
    case 'GAME_ALREADY_STARTED':
      return 'This match has already started.';
    case 'ROOM_GAME_TYPE_MISMATCH':
      return 'This room is reserved for a different game.';
    case 'STORAGE_ERROR':
      if (defaultMessage && defaultMessage.toLowerCase().includes('match')) {
        return defaultMessage.trim();
      }
      return "Couldn't prepare another match. Try again.";
    case 'CORRUPTED_STATE':
      return 'Room state error. Please create a new room.';
    case 'BOT_GUARD_LIMIT_EXCEEDED':
      return 'Bot action limit reached.';
    case 'NOT_IN_ROOM':
      return 'You are not seated in this room.';
    case 'NOT_YOUR_TURN':
      return 'It is not your turn.';
    case 'INVALID_PHASE':
      if (defaultMessage && defaultMessage.toLowerCase().includes('reset')) {
        return defaultMessage.trim();
      }
      return "This match can't be reset right now.";
    case 'ILLEGAL_MOVE':
      return 'That move is not legal.';
    case 'PLAYER_ABANDONED':
      return 'A bot has taken over your seat. You can keep watching this match.';
    case 'PLAYER_OFFLINE':
      return 'Your seat is reconnecting. Please wait for synchronization.';
    case 'GAME_OVER':
      return 'This match has ended.';
    case 'INVITATION_STALE':
      return 'This invitation belongs to an earlier match.';
    case 'MALFORMED_MESSAGE':
      return 'Invalid action requested.';
    default:
      if (defaultMessage && defaultMessage.trim() && !defaultMessage.includes('\n') && defaultMessage.length < 100) {
        return defaultMessage.trim();
      }
      return 'An unexpected error occurred. Please try again.';
  }
}

export type RevisionAnalysis = 'STALE' | 'DUPLICATE' | 'NEXT' | 'GAP';

/**
 * Analyzes an incoming authoritative revision against the current client revision.
 */
export function analyzeRevision(incomingRev: number, currentRev: number): RevisionAnalysis {
  if (incomingRev < currentRev) return 'STALE';
  if (incomingRev === currentRev) return 'DUPLICATE';
  if (incomingRev === currentRev + 1) return 'NEXT';
  return 'GAP';
}

/**
 * Finds the seat currently occupied by the specified user ID.
 */
export function getUserSeat(lobby: LudoLobbyState | null, userId: string | null): LudoSeat | null {
  if (!lobby || !userId) return null;
  for (const color of ['red', 'green', 'yellow', 'blue'] as PlayerColor[]) {
    const seat = lobby.seats[color];
    if (seat && seat.status === 'human' && seat.userId === userId) {
      return seat;
    }
  }
  return null;
}

/**
 * Checks whether the current user is the host of the room.
 */
export function isUserHost(lobby: LudoLobbyState | null, userId: string | null): boolean {
  if (!lobby || !userId) return false;
  return lobby.hostUserId === userId;
}

/**
 * Pure evaluation of whether the lobby composition allows starting the game.
 * Note: The server remains the ultimate authoritative gatekeeper.
 */
export function canStartGame(lobby: LudoLobbyState | null): { canStart: boolean; reason?: string } {
  if (!lobby) {
    return { canStart: false, reason: 'Room state not loaded' };
  }

  // Count active occupied seats (human or bot)
  let occupiedCount = 0;
  let hasHuman = false;
  let allNonHostHumansReady = true;

  const colors: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
  for (const color of colors) {
    const seat = lobby.seats[color];
    if (!seat) continue;

    if (seat.status === 'human') {
      occupiedCount++;
      hasHuman = true;
      const isHost = seat.userId === lobby.hostUserId;
      if (!isHost && !seat.ready) {
        allNonHostHumansReady = false;
      }
    } else if (seat.status === 'bot') {
      occupiedCount++;
    }
  }

  if (!hasHuman) {
    return { canStart: false, reason: 'At least one human player is required' };
  }

  if (occupiedCount < 2) {
    return { canStart: false, reason: 'At least 2 players (humans or bots) are required' };
  }

  if (!allNonHostHumansReady) {
    return { canStart: false, reason: 'Waiting for all players to be ready' };
  }

  return { canStart: true };
}

/**
 * Checks whether the current user is authorized to trigger Play Again rematch.
 */
export function canHostRematch(
  playingState: LudoGameStateEvent | { engine?: { status?: string }; finishReason?: string | null } | null,
  hostUserId: string | null,
  currentUserId: string | null
): boolean {
  if (!playingState || !hostUserId || !currentUserId) return false;
  const engineStatus =
    (playingState as any).state?.status || (playingState as any).engine?.status;
  if (engineStatus !== 'finished') return false;
  if (playingState.finishReason === 'all-humans-abandoned') return false;
  return hostUserId === currentUserId;
}
