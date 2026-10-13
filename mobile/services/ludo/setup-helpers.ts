/**
 * Semester Library Games Platform - Local Ludo Setup Helpers
 *
 * Pure, testable helper functions for offline match setup, presets,
 * seat toggling, bot difficulty, display name defaults, and canonical config building.
 */

import {
  PLAYER_COLORS,
  type PlayerColor,
  type BotDifficulty,
} from '../../../packages/ludo-engine/src/index.ts';

import type {
  LocalSeatConfig,
  LocalLudoMatchConfig,
} from '../../types/ludo-session.ts';

import { normalizeMatchConfig } from './session.ts';

export type SeatPlayerType = 'human' | 'bot';

export interface SetupSeatState {
  color: PlayerColor;
  status: 'active' | 'closed';
  playerType: SeatPlayerType;
  displayName: string;
  botDifficulty?: BotDifficulty;
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getDeterministicBotName(color: PlayerColor, difficulty: BotDifficulty = 'normal'): string {
  return `${capitalize(color)} Bot (${capitalize(difficulty)})`;
}

export function getDeterministicHumanName(color: PlayerColor, seats?: SetupSeatState[]): string {
  if (color === 'red') {
    return 'You';
  }
  // Assign Player 2, Player 3, Player 4 deterministically based on clockwise color order
  const colorOrder: Record<PlayerColor, string> = {
    red: 'You',
    green: 'Player 2',
    yellow: 'Player 3',
    blue: 'Player 4',
  };
  return colorOrder[color];
}

/**
 * Creates default 4-slot setup state for 2, 3, or 4 players.
 *
 * 2 Players: Red + Yellow active (international opposite-track standard), Green + Blue closed.
 * 3 Players: Red + Green + Yellow active, Blue closed.
 * 4 Players: All 4 active.
 *
 * Seat 1 (Red) is always Human ("You").
 * Opponents default to Bot ("Normal") for immediate 1-tap offline play.
 */
export function createDefaultSetup(
  playerCount: 2 | 3 | 4,
  opponentType: SeatPlayerType = 'bot'
): SetupSeatState[] {
  const activeColorSet = new Set<PlayerColor>();

  if (playerCount === 2) {
    activeColorSet.add('red');
    activeColorSet.add('yellow');
  } else if (playerCount === 3) {
    activeColorSet.add('red');
    activeColorSet.add('green');
    activeColorSet.add('yellow');
  } else {
    activeColorSet.add('red');
    activeColorSet.add('green');
    activeColorSet.add('yellow');
    activeColorSet.add('blue');
  }

  return PLAYER_COLORS.map((color) => {
    const isActive = activeColorSet.has(color);
    if (!isActive) {
      return {
        color,
        status: 'closed',
        playerType: 'human',
        displayName: `${capitalize(color)} (Closed)`,
      };
    }

    if (color === 'red') {
      return {
        color,
        status: 'active',
        playerType: 'human',
        displayName: 'You',
      };
    }

    // Opponent seat
    if (opponentType === 'bot') {
      return {
        color,
        status: 'active',
        playerType: 'bot',
        displayName: getDeterministicBotName(color, 'normal'),
        botDifficulty: 'normal',
      };
    } else {
      return {
        color,
        status: 'active',
        playerType: 'human',
        displayName: getDeterministicHumanName(color),
      };
    }
  });
}

/**
 * Changes seat player type between Human and Bot.
 */
export function setSeatType(
  seats: SetupSeatState[],
  color: PlayerColor,
  newType: SeatPlayerType
): SetupSeatState[] {
  return seats.map((seat) => {
    if (seat.color !== color) return seat;

    if (newType === 'bot') {
      const difficulty: BotDifficulty = seat.botDifficulty || 'normal';
      return {
        ...seat,
        playerType: 'bot',
        botDifficulty: difficulty,
        displayName: getDeterministicBotName(color, difficulty),
      };
    } else {
      return {
        ...seat,
        playerType: 'human',
        botDifficulty: undefined,
        displayName: getDeterministicHumanName(color, seats),
      };
    }
  });
}

/**
 * Updates bot difficulty for a bot seat.
 */
export function setBotDifficulty(
  seats: SetupSeatState[],
  color: PlayerColor,
  difficulty: BotDifficulty
): SetupSeatState[] {
  return seats.map((seat) => {
    if (seat.color !== color) return seat;

    // If current displayName matches an existing bot pattern or is empty, refresh it
    const isStandardBotName =
      !seat.displayName ||
      seat.displayName.includes('Bot (') ||
      seat.displayName === `${capitalize(color)} Bot`;

    return {
      ...seat,
      botDifficulty: difficulty,
      displayName: isStandardBotName
        ? getDeterministicBotName(color, difficulty)
        : seat.displayName,
    };
  });
}

/**
 * Updates editable display name for a seat.
 */
export function setPlayerName(
  seats: SetupSeatState[],
  color: PlayerColor,
  name: string
): SetupSeatState[] {
  return seats.map((seat) => {
    if (seat.color !== color) return seat;
    return {
      ...seat,
      displayName: name,
    };
  });
}

/**
 * Validates setup state before creating a match.
 */
export function validateSetupState(
  seats: SetupSeatState[],
  expectedPlayerCount?: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const activeSeats = seats.filter((s) => s.status === 'active');

  if (activeSeats.length < 2 || activeSeats.length > 4) {
    errors.push(`Match must have between 2 and 4 active seats (found ${activeSeats.length}).`);
  }

  if (expectedPlayerCount && activeSeats.length !== expectedPlayerCount) {
    errors.push(`Expected ${expectedPlayerCount} active seats, but found ${activeSeats.length}.`);
  }

  // Requirement: at least one human player
  const hasHuman = activeSeats.some((s) => s.playerType === 'human');
  if (!hasHuman) {
    errors.push('At least one human player is required.');
  }

  // Name validation
  for (const seat of activeSeats) {
    const trimmed = (seat.displayName || '').trim();
    if (trimmed.length > 32) {
      errors.push(`Player name for ${capitalize(seat.color)} exceeds maximum 32 characters.`);
    }

    if (seat.playerType === 'bot') {
      if (!seat.botDifficulty || !['easy', 'normal', 'hard'].includes(seat.botDifficulty)) {
        errors.push(`Invalid bot difficulty for ${capitalize(seat.color)}.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Builds canonical LocalLudoMatchConfig from setup seat states.
 */
export function buildLocalLudoConfig(
  seats: SetupSeatState[],
  sessionId?: string
): { valid: true; config: LocalLudoMatchConfig } | { valid: false; errors: string[] } {
  const validation = validateSetupState(seats);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors };
  }

  const rawSeats = seats.map((seat) => {
    if (seat.status === 'closed') {
      return {
        color: seat.color,
        status: 'closed' as const,
        displayName: `${capitalize(seat.color)} (Closed)`,
      };
    }
    return {
      color: seat.color,
      status: (seat.playerType === 'bot' ? 'bot' : 'human') as 'bot' | 'human',
      displayName: seat.displayName.trim() || (seat.playerType === 'human' ? getDeterministicHumanName(seat.color) : getDeterministicBotName(seat.color, seat.botDifficulty || 'normal')),
      botDifficulty: seat.playerType === 'bot' ? (seat.botDifficulty || 'normal') : undefined,
    };
  });

  const norm = normalizeMatchConfig(
    {
      sessionId,
      seats: rawSeats,
    },
    false // allowBotOnly is false for production setup
  );

  return norm;
}
