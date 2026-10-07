/**
 * Lifecycle helper utilities for Phase 4C online Ludo.
 *
 * Provides pure functions for:
 * - Seat control mode & presence resolution
 * - Reconnect countdown presentation
 * - Spectator status detection
 * - Standings resolution (displayRankings fallback)
 * - Restrained lifecycle transition detection
 */

import type {
  PlayerColor,
  LudoSeat,
  LudoControlMode,
  LudoPresenceStatus,
} from './protocol.ts';
import {
  CANONICAL_COLORS,
} from './protocol.ts';

export interface LifecycleToast {
  id: string;
  color: PlayerColor;
  type: 'reconnecting' | 'reconnected' | 'abandoned';
  message: string;
}

/**
 * Resolves the effective control mode of a seat, falling back to legacy defaults.
 */
export function getSeatControlMode(seat?: LudoSeat | null): LudoControlMode {
  if (!seat) return 'human';
  if (seat.controlMode) return seat.controlMode;
  if (seat.status === 'bot') return 'bot';
  return 'human';
}

/**
 * Resolves the effective presence of a seat, falling back to legacy online.
 */
export function getSeatPresence(seat?: LudoSeat | null): LudoPresenceStatus {
  if (!seat) return 'online';
  if (seat.presence) return seat.presence;
  return 'online';
}

/**
 * Returns true if the seat is controlled by an active, online human.
 * Reconnecting, abandoned, takeover-bot, or configured bots return false.
 */
export function isSeatHumanControlled(seat?: LudoSeat | null): boolean {
  if (!seat) return false;
  if (seat.status !== 'human') return false;
  const mode = getSeatControlMode(seat);
  const presence = getSeatPresence(seat);
  return mode === 'human' && presence === 'online';
}

/**
 * Returns true if the current user has been permanently abandoned and is now a spectator.
 */
export function isCurrentUserSpectator(
  seats?: Record<PlayerColor, LudoSeat> | null,
  myUserId?: string | null
): boolean {
  if (!seats || !myUserId) return false;
  for (const color of CANONICAL_COLORS) {
    const seat = seats[color];
    if (seat && seat.userId === myUserId) {
      const mode = getSeatControlMode(seat);
      const presence = getSeatPresence(seat);
      if (mode === 'takeover-bot' || presence === 'abandoned') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Calculates remaining milliseconds for a reconnect deadline.
 * Returns null if deadline is null or undefined. Never returns negative numbers.
 */
export function getReconnectRemainingMs(deadline?: number | null, now?: number): number | null {
  if (deadline === null || deadline === undefined) return null;
  const currentNow = typeof now === 'number' ? now : Date.now();
  return Math.max(0, deadline - currentNow);
}

/**
 * Formats a server disconnect deadline epoch timestamp into a presentation countdown (e.g. "1:30", "0:09", "0:00").
 * Returns null if deadline is null or undefined.
 */
export function formatReconnectCountdown(deadline?: number | null, now?: number): string | null {
  if (deadline === null || deadline === undefined) return null;
  const remainingMs = getReconnectRemainingMs(deadline, now);
  if (remainingMs === null) return null;
  if (remainingMs === 0) return '0:00';

  const totalSec = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Resolves final online rankings, prioritizing server-authoritative displayRankings over engine rankings.
 */
export function getOnlineResultRankings(
  displayRankings?: PlayerColor[] | null,
  engineRankings?: PlayerColor[] | null
): PlayerColor[] {
  if (Array.isArray(displayRankings) && displayRankings.length > 0) {
    return displayRankings;
  }
  if (Array.isArray(engineRankings) && engineRankings.length > 0) {
    return engineRankings;
  }
  return [];
}

/**
 * Formats a player's display name and lifecycle badges for UI.
 */
export function getLifecyclePlayerLabel(
  seat: LudoSeat,
  options?: { isYou?: boolean; countdownText?: string | null }
): {
  title: string;
  subtitle: string;
  badge?: 'you' | 'bot' | 'takeover' | 'reconnecting';
  countdown?: string | null;
} {
  const isYou = Boolean(options?.isYou);
  const mode = getSeatControlMode(seat);
  const presence = getSeatPresence(seat);
  const name = seat.displayName?.trim() || (seat.color.charAt(0).toUpperCase() + seat.color.slice(1));

  if (mode === 'takeover-bot' || presence === 'abandoned') {
    return {
      title: name,
      subtitle: 'Bot takeover',
      badge: 'takeover',
    };
  }

  if (presence === 'reconnecting') {
    let subtitle = 'Reconnecting…';
    if (options?.countdownText) {
      if (options.countdownText === '0:00') {
        subtitle = 'Waiting for server…';
      } else {
        subtitle = `Reconnecting • ${options.countdownText}`;
      }
    }
    return {
      title: name,
      subtitle,
      badge: 'reconnecting',
      countdown: options?.countdownText ?? null,
    };
  }

  if (mode === 'bot' || seat.status === 'bot') {
    const diff = seat.botDifficulty
      ? seat.botDifficulty.charAt(0).toUpperCase() + seat.botDifficulty.slice(1)
      : 'Normal';
    return {
      title: `${seat.color.charAt(0).toUpperCase() + seat.color.slice(1)} Bot`,
      subtitle: diff,
      badge: 'bot',
    };
  }

  return {
    title: name,
    subtitle: isYou ? 'You' : 'Online',
    badge: isYou ? 'you' : undefined,
  };
}

export type OnlineLeaveMode = 'lobby' | 'active-human' | 'spectator' | 'ranked-finished' | 'match-finished';

export interface OnlineLeaveCopy {
  mode: OnlineLeaveMode;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  shouldSendLeaveMessage: boolean;
}

/**
 * Pure helper determining the exact exit confirmation semantics for the current user.
 */
export function getOnlineLeaveMode(params: {
  gameStatus?: 'lobby' | 'playing' | 'finished' | null;
  seats?: Record<PlayerColor, LudoSeat> | null;
  myUserId?: string | null;
  rankings?: PlayerColor[] | null;
}): OnlineLeaveCopy {
  if (!params.gameStatus || params.gameStatus === 'lobby') {
    return {
      mode: 'lobby',
      title: 'Leave Room?',
      message: 'Are you sure you want to leave this online lobby?',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      shouldSendLeaveMessage: true,
    };
  }

  if (params.gameStatus === 'finished') {
    return {
      mode: 'match-finished',
      title: 'Leave match?',
      message: 'This match has ended.',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      shouldSendLeaveMessage: false,
    };
  }

  if (!params.myUserId || !params.seats) {
    return {
      mode: 'spectator',
      title: 'Leave match?',
      message: 'You are currently watching this match.',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      shouldSendLeaveMessage: false,
    };
  }

  let mySeat: LudoSeat | null = null;
  let myColor: PlayerColor | null = null;
  for (const c of CANONICAL_COLORS) {
    const s = params.seats[c];
    if (s && s.userId === params.myUserId) {
      mySeat = s;
      myColor = c;
      break;
    }
  }

  if (!mySeat) {
    return {
      mode: 'spectator',
      title: 'Leave match?',
      message: 'You are currently watching this match.',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      shouldSendLeaveMessage: false,
    };
  }

  const mode = getSeatControlMode(mySeat);
  const presence = getSeatPresence(mySeat);

  if (mode === 'takeover-bot' || presence === 'abandoned') {
    return {
      mode: 'spectator',
      title: 'Leave match?',
      message: 'You are currently watching this match.',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      shouldSendLeaveMessage: false,
    };
  }

  if (myColor && Array.isArray(params.rankings) && params.rankings.includes(myColor)) {
    return {
      mode: 'ranked-finished',
      title: 'Leave match?',
      message: 'You have finished your match.',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      shouldSendLeaveMessage: false,
    };
  }

  return {
    mode: 'active-human',
    title: 'Leave online match?',
    message: "Your seat will be reserved for 90 seconds. If you don't return, a bot will take over.",
    confirmLabel: 'Leave',
    cancelLabel: 'Cancel',
    shouldSendLeaveMessage: true,
  };
}

/**
 * Detects restrained lifecycle transitions between successive authoritative snapshots.
 * Only triggers for other players (excluding current user to avoid duplicate noise with socket banner).
 * Never triggers on initial mount / initial restored snapshot.
 */
export function detectLifecycleTransitions(
  prevSeats?: Record<PlayerColor, LudoSeat> | null,
  nextSeats?: Record<PlayerColor, LudoSeat> | null,
  myUserId?: string | null
): LifecycleToast[] {
  if (!prevSeats || !nextSeats) return [];
  const toasts: LifecycleToast[] = [];

  for (const color of CANONICAL_COLORS) {
    const prev = prevSeats[color];
    const next = nextSeats[color];
    if (!prev || !next) continue;

    // Skip current user (handled by socket connection UI / spectator banner)
    if (myUserId && next.userId === myUserId) continue;

    const prevPresence = getSeatPresence(prev);
    const nextPresence = getSeatPresence(next);
    const nextMode = getSeatControlMode(next);
    const name = next.displayName?.trim() || (color.charAt(0).toUpperCase() + color.slice(1));

    // online -> reconnecting
    if (prevPresence === 'online' && nextPresence === 'reconnecting') {
      toasts.push({
        id: `${color}-reconnecting-${Date.now()}`,
        color,
        type: 'reconnecting',
        message: `${name} disconnected. Waiting 90 seconds…`,
      });
    }
    // reconnecting -> online
    else if (prevPresence === 'reconnecting' && nextPresence === 'online') {
      toasts.push({
        id: `${color}-reconnected-${Date.now()}`,
        color,
        type: 'reconnected',
        message: `${name} reconnected`,
      });
    }
    // reconnecting / online -> abandoned (or takeover-bot)
    else if (
      (prevPresence === 'reconnecting' || prevPresence === 'online') &&
      (nextPresence === 'abandoned' || nextMode === 'takeover-bot') &&
      getSeatControlMode(prev) !== 'takeover-bot'
    ) {
      toasts.push({
        id: `${color}-abandoned-${Date.now()}`,
        color,
        type: 'abandoned',
        message: `${name} left — bot takeover`,
      });
    }
  }

  return toasts;
}
