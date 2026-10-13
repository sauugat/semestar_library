/**
 * Semester Library Games Platform - Online Ludo Presentation Layer
 *
 * Pure, side-effect-free presentation projection, queue validation,
 * permission calculations, turn status formatting, and authoritative
 * snapshot reconciliation for Online Ludo.
 *
 * Authority Rule:
 * Mobile NEVER calculates dice, legal move results, captures, turn advancement,
 * extra turns, three-sixes, or rankings.
 * All mutations here are strictly replaying authoritative server events.
 */

import type { PlayerColor, LudoState } from '../../../packages/ludo-engine/src/index.ts';
import type {
  LudoSeat,
  LudoControlMode,
  LudoPresenceStatus,
  LudoDiceRolledEvent,
  LudoMoveResultEvent,
  LudoGameStateEvent,
} from './protocol.ts';

export interface OnlinePresentationState {
  status: 'playing' | 'finished';
  tokens: Record<PlayerColor, [number, number, number, number]>;
  currentTurn: PlayerColor | null;
  turnPhase: 'roll' | 'move' | null;
  currentRoll: number | null;
  legalMoves: number[]; // selectable token IDs for current turn
  rankings: PlayerColor[];
  winner: PlayerColor | null;
  revision: number;
}

export interface CanRollParams {
  connectionStatus: string;
  isResyncing: boolean;
  isPresentationBusy: boolean;
  actionQueueLength: number;
  gameStatus: string;
  currentTurn: PlayerColor | null;
  turnPhase: string | null;
  myColor: PlayerColor | null;
  mySeatStatus: string | null;
  pendingCommand: string | null;
  myControlMode?: LudoControlMode | null;
  myPresence?: LudoPresenceStatus | null;
}

export interface SelectableTokensParams {
  connectionStatus: string;
  isResyncing: boolean;
  isPresentationBusy: boolean;
  gameStatus: string;
  currentTurn: PlayerColor | null;
  turnPhase: string | null;
  myColor: PlayerColor | null;
  legalMoves: number[];
  pendingCommand: string | null;
  mySeatStatus?: string | null;
  myControlMode?: LudoControlMode | null;
  myPresence?: LudoPresenceStatus | null;
}

export interface TurnStatusInfo {
  title: string;
  subtitle: string;
}

export interface TurnStatusLifecycleOptions {
  finishReason?: 'all-humans-abandoned' | 'normal' | null;
  isCurrentTurnReconnecting?: boolean;
  reconnectCountdown?: string | null;
  isCurrentTurnTakeoverBot?: boolean;
  isCurrentUserSpectator?: boolean;
}

/**
 * Derives current user's authoritative seat color.
 * Returns null if user is a spectator, disconnected, or has no human seat.
 */
export function deriveMyColor(
  seats: Record<PlayerColor, LudoSeat> | undefined | null,
  myUserId: string | null
): PlayerColor | null {
  if (!seats || !myUserId) return null;
  for (const seat of Object.values(seats)) {
    if (seat.status === 'human' && seat.userId === myUserId) {
      return seat.color;
    }
  }
  return null;
}

/**
 * Creates presentation state directly from authoritative engine state.
 */
export function createPresentationStateFromEngine(
  engineState: LudoState,
  revision: number = 0
): OnlinePresentationState {
  const legalMoves = (engineState.legalMoves || []).map((m: any) =>
    typeof m === 'number' ? m : (m.tokenIndex ?? m.tokenId ?? 0)
  );

  return {
    status: engineState.status === 'finished' ? 'finished' : 'playing',
    tokens: {
      red: [...(engineState.tokens?.red || [-1, -1, -1, -1])] as [number, number, number, number],
      green: [...(engineState.tokens?.green || [-1, -1, -1, -1])] as [number, number, number, number],
      yellow: [...(engineState.tokens?.yellow || [-1, -1, -1, -1])] as [number, number, number, number],
      blue: [...(engineState.tokens?.blue || [-1, -1, -1, -1])] as [number, number, number, number],
    },
    currentTurn: engineState.currentTurn,
    turnPhase: engineState.turnPhase,
    currentRoll: engineState.currentRoll,
    legalMoves,
    rankings: [...(engineState.rankings || [])],
    winner: engineState.rankings && engineState.rankings.length > 0 ? engineState.rankings[0] : null,
    revision: revision || engineState.revision || 0,
  };
}

/**
 * Presentation projection for LUDO_DICE_ROLLED.
 * Projects dice roll value and server-provided legal moves into visual presentation.
 */
export function projectDiceRolled(
  prev: OnlinePresentationState,
  event: LudoDiceRolledEvent
): OnlinePresentationState {
  const legalMoves = (event.legalMoves || []).map((m: any) =>
    typeof m === 'number' ? m : (m.tokenIndex ?? m.tokenId ?? 0)
  );

  const hasMoves = legalMoves.length > 0;

  return {
    ...prev,
    currentTurn: event.color || prev.currentTurn,
    currentRoll: event.roll,
    turnPhase: hasMoves ? 'move' : prev.turnPhase,
    legalMoves: hasMoves ? legalMoves : [],
    revision: event.revision,
  };
}

/**
 * Presentation projection for LUDO_MOVE_RESULT.
 * Applies server-provided toProgress and returns captured tokens to yard (-1).
 * Never calculates rules, next turns, or destinations locally.
 */
export function projectMoveResult(
  prev: OnlinePresentationState,
  event: LudoMoveResultEvent
): OnlinePresentationState {
  // Deep clone tokens
  const nextTokens: Record<PlayerColor, [number, number, number, number]> = {
    red: [...prev.tokens.red],
    green: [...prev.tokens.green],
    yellow: [...prev.tokens.yellow],
    blue: [...prev.tokens.blue],
  };

  // 1. Apply moving token progress
  if (
    nextTokens[event.player] &&
    typeof event.tokenId === 'number' &&
    event.tokenId >= 0 &&
    event.tokenId <= 3 &&
    typeof event.toProgress === 'number' &&
    Number.isFinite(event.toProgress)
  ) {
    const playerTokens = [...nextTokens[event.player]] as [number, number, number, number];
    playerTokens[event.tokenId] = event.toProgress;
    nextTokens[event.player] = playerTokens;
  }

  // 2. Apply explicit server captured tokens return to yard
  if (Array.isArray(event.capturedTokens)) {
    for (const cap of event.capturedTokens) {
      if (
        cap &&
        nextTokens[cap.color] &&
        typeof cap.tokenIndex === 'number' &&
        cap.tokenIndex >= 0 &&
        cap.tokenIndex <= 3
      ) {
        const capTokens = [...nextTokens[cap.color]] as [number, number, number, number];
        capTokens[cap.tokenIndex] = -1;
        nextTokens[cap.color] = capTokens;
      }
    }
  }

  const newRankings = event.rankings && event.rankings.length > 0
    ? [...event.rankings]
    : prev.rankings;

  return {
    ...prev,
    status: event.gameFinished ? 'finished' : prev.status,
    tokens: nextTokens,
    currentRoll: null,
    legalMoves: [],
    rankings: newRankings,
    winner: newRankings.length > 0 ? newRankings[0] : prev.winner,
    revision: event.revision,
  };
}

/**
 * Authoritative snapshot reconciliation.
 * Overrides any intermediate presentation state with absolute server truth.
 */
export function reconcileWithAuthoritativeState(
  authoritativeState: LudoState,
  revision: number
): OnlinePresentationState {
  return createPresentationStateFromEngine(authoritativeState, revision);
}

/**
 * Human Roll Permission Gate.
 * Enforces all 9 safety rules before roll button can be active.
 */
export function canOnlineHumanRoll(params: CanRollParams): boolean {
  if (params.connectionStatus !== 'connected') return false;
  if (params.isResyncing) return false;
  if (params.isPresentationBusy) return false;
  if (params.actionQueueLength > 0) return false;
  if (params.gameStatus !== 'playing') return false;
  if (!params.myColor || params.currentTurn !== params.myColor) return false;
  if (params.turnPhase !== 'roll') return false;
  if (params.mySeatStatus !== 'human') return false;
  if (params.pendingCommand !== null) return false;

  const controlMode = params.myControlMode ?? 'human';
  if (controlMode !== 'human') return false;

  const presence = params.myPresence ?? 'online';
  if (presence !== 'online') return false;

  return true;
}

/**
 * Human Move Permission Gate.
 * Only tokens in server-provided legalMoves can be selected by the human player.
 */
export function getOnlineSelectableTokens(params: SelectableTokensParams): number[] {
  if (params.connectionStatus !== 'connected') return [];
  if (params.isResyncing) return [];
  if (params.isPresentationBusy) return [];
  if (params.gameStatus !== 'playing') return [];
  if (!params.myColor || params.currentTurn !== params.myColor) return [];
  if (params.turnPhase !== 'move') return [];
  if (params.pendingCommand !== null) return [];

  if (params.mySeatStatus !== undefined && params.mySeatStatus !== null && params.mySeatStatus !== 'human') {
    return [];
  }

  const controlMode = params.myControlMode ?? 'human';
  if (controlMode !== 'human') return [];

  const presence = params.myPresence ?? 'online';
  if (presence !== 'online') return [];

  return Array.isArray(params.legalMoves) ? params.legalMoves : [];
}

/**
 * Status message formatting for dice rolls.
 */
export function formatOnlineRollStatus(
  event: LudoDiceRolledEvent,
  isMyAction: boolean,
  playerName: string
): string {
  if (event.threeSixesForfeit) {
    return 'Three sixes — turn forfeited';
  }
  if (event.autoPassed) {
    return 'No legal moves';
  }
  if (isMyAction) {
    return `You rolled ${event.roll}`;
  }
  return `${playerName} rolled ${event.roll}`;
}

/**
 * Turn banner title and subtitle formatting.
 */
export function formatOnlineTurnStatus(
  currentTurn: PlayerColor | null,
  turnPhase: 'roll' | 'move' | null,
  isMyTurn: boolean,
  playerName: string,
  isBot: boolean,
  connectionStatus: string,
  isResyncing: boolean,
  isFinished: boolean,
  options?: TurnStatusLifecycleOptions
): TurnStatusInfo {
  if (isFinished) {
    if (options?.finishReason === 'all-humans-abandoned') {
      return { title: 'Match Ended', subtitle: 'All human players left the match.' };
    }
    return { title: 'Game Finished', subtitle: 'Match complete' };
  }
  if (connectionStatus === 'reconnecting') {
    return { title: 'Reconnecting…', subtitle: 'Restoring match connection' };
  }
  if (isResyncing) {
    return { title: 'Synchronizing…', subtitle: 'Updating game state' };
  }
  if (!currentTurn) {
    return { title: 'Waiting…', subtitle: 'Setting up game' };
  }

  if (options?.isCurrentTurnReconnecting) {
    let subtitle = 'Waiting for reconnection…';
    if (options.reconnectCountdown === '0:00') {
      subtitle = 'Waiting for server…';
    } else if (options.reconnectCountdown) {
      subtitle = `Waiting for reconnection • ${options.reconnectCountdown}`;
    }
    return { title: `${playerName} disconnected`, subtitle };
  }

  if (options?.isCurrentTurnTakeoverBot) {
    return { title: `${playerName} • Bot takeover`, subtitle: 'Bot is playing for them' };
  }

  if (isMyTurn && !options?.isCurrentUserSpectator) {
    if (turnPhase === 'roll') {
      return { title: 'Your turn', subtitle: 'Roll the dice' };
    }
    if (turnPhase === 'move') {
      return { title: 'Your turn', subtitle: 'Choose a token' };
    }
    return { title: 'Your turn', subtitle: 'Playing...' };
  }

  if (isBot) {
    return { title: playerName, subtitle: 'Playing...' };
  }

  return { title: `${playerName}'s turn`, subtitle: `Waiting for ${playerName}` };
}

/**
 * Resolves haptic feedback event for online move completion.
 * Enforces: local device-originated actions produce input/step feedback;
 * remote human actions and bots produce no vibration spam.
 * Winner and rank events produce appropriate celebratory haptics.
 */
export function resolveOnlineMoveHaptic(
  event: LudoMoveResultEvent,
  isMyAction: boolean
): 'gameWin' | 'rank' | 'finish' | 'capture' | 'step' | null {
  if (event.gameFinished) {
    return 'gameWin';
  }
  if (event.playerRanked) {
    return 'rank';
  }
  if (event.reachedFinish) {
    return 'finish';
  }
  if (isMyAction && Array.isArray(event.capturedTokens) && event.capturedTokens.length > 0) {
    return 'capture';
  }
  if (isMyAction) {
    return 'step';
  }
  return null;
}
