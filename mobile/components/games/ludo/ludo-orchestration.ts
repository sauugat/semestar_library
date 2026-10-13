/**
 * Semester Library Games Platform - Ludo Gameplay Orchestration Helpers
 *
 * Pure, side-effect-free helpers for turn orchestration, input locks,
 * bot action determination, device handoff evaluation, and status messaging.
 */

import type { PlayerColor, TurnPhase } from '../../../../packages/ludo-engine/src/index.ts';
import type {
  LocalLudoSessionSnapshot,
  LocalLudoActionResult,
  LocalLudoRollResult,
  LocalLudoMoveResult,
  LocalSeatConfig,
} from '../../../types/ludo-session.ts';

/**
 * Checks whether the current human player can tap the primary Roll Dice button.
 */
export function canHumanRoll(
  snapshot: LocalLudoSessionSnapshot,
  isBusy: boolean = false,
  isHandoffVisible: boolean = false
): boolean {
  if (isBusy || isHandoffVisible) {
    return false;
  }
  if (snapshot.status !== 'playing') {
    return false;
  }
  if (snapshot.isBotTurn) {
    return false;
  }
  if (snapshot.turnPhase !== 'roll') {
    return false;
  }
  return snapshot.activePlayer?.status === 'human';
}

/**
 * Checks whether the board allows token interaction.
 */
export function isBoardInteractive(
  snapshot: LocalLudoSessionSnapshot,
  isBusy: boolean = false,
  isHandoffVisible: boolean = false
): boolean {
  if (isBusy || isHandoffVisible) {
    return false;
  }
  if (snapshot.status !== 'playing') {
    return false;
  }
  if (snapshot.isBotTurn) {
    return false;
  }
  if (snapshot.turnPhase !== 'move') {
    return false;
  }
  return snapshot.activePlayer?.status === 'human';
}

/**
 * Checks whether a specific token of a given color and index is legal to move and interactive.
 */
export function isTokenSelectable(
  color: PlayerColor,
  tokenIndex: number,
  snapshot: LocalLudoSessionSnapshot,
  isBusy: boolean = false,
  isHandoffVisible: boolean = false
): boolean {
  if (!isBoardInteractive(snapshot, isBusy, isHandoffVisible)) {
    return false;
  }
  if (snapshot.currentTurn !== color) {
    return false;
  }
  return snapshot.legalMoves.some((m) => m.tokenIndex === tokenIndex);
}

export type BotActionType = 'BOT_ROLL' | 'BOT_MOVE';

/**
 * Evaluates what bot action (if any) should be scheduled for the current state.
 */
export function determineNextBotAction(
  snapshot: LocalLudoSessionSnapshot,
  isBusy: boolean = false,
  isHandoffVisible: boolean = false
): BotActionType | null {
  if (isBusy || isHandoffVisible) {
    return null;
  }
  if (snapshot.status !== 'playing') {
    return null;
  }
  if (!snapshot.isBotTurn) {
    return null;
  }

  if (snapshot.turnPhase === 'roll') {
    return 'BOT_ROLL';
  }
  if (snapshot.turnPhase === 'move') {
    return 'BOT_MOVE';
  }
  return null;
}

/**
 * Returns whether the pass-the-phone handoff overlay should be shown.
 * Game finished state strictly supersedes handoff.
 */
export function shouldShowHandoff(snapshot: LocalLudoSessionSnapshot): boolean {
  if (snapshot.status === 'finished') {
    return false;
  }
  return Boolean(snapshot.handoff && snapshot.handoff.needsHandoff);
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Formats a single-line user-facing summary of the latest action result.
 */
export function formatActionStatusMessage(action: LocalLudoActionResult | null): string {
  if (!action) {
    return '';
  }

  if (action.type === 'ROLL') {
    const roll = action as LocalLudoRollResult;
    if (roll.threeSixesForfeit) {
      return 'Three sixes — turn forfeited';
    }
    if (roll.autoPass) {
      return `Rolled a ${roll.rolledValue} — no legal moves`;
    }
    return `Rolled a ${roll.rolledValue}`;
  }

  if (action.type === 'MOVE') {
    const move = action as LocalLudoMoveResult;
    const parts: string[] = [];

    if (move.capturedTokens && move.capturedTokens.length > 0) {
      const count = move.capturedTokens.length;
      const uniqueColors = Array.from(new Set(move.capturedTokens.map((c) => c.color)));
      if (uniqueColors.length === 1) {
        const colorName = capitalize(uniqueColors[0]);
        if (count === 1) {
          parts.push(`Captured ${colorName} token`);
        } else {
          parts.push(`Captured ${count} ${colorName} tokens`);
        }
      } else {
        parts.push(`Captured ${count} tokens`);
      }
    } else if (move.reachedFinish) {
      parts.push('Token reached home');
    }

    if (move.extraTurn) {
      if (move.extraTurnReason === 'six') {
        parts.push('Rolled a six — roll again');
      } else if (move.extraTurnReason === 'capture') {
        parts.push('Capture bonus — roll again');
      } else if (move.extraTurnReason === 'finish') {
        parts.push('Home bonus — roll again');
      } else {
        parts.push('Roll again');
      }
    }

    if (parts.length > 0) {
      return parts.join(' • ');
    }
  }

  return '';
}

export interface TurnStatusPresentation {
  title: string;
  subtitle: string;
  isBot: boolean;
}

/**
 * Formats status information for the top current-turn bar.
 */
export function formatTurnStatus(
  snapshot: LocalLudoSessionSnapshot,
  isBusy: boolean = false
): TurnStatusPresentation {
  if (snapshot.status === 'finished') {
    const winnerName = snapshot.winner ? `${capitalize(snapshot.winner)} Player` : 'Game';
    return {
      title: 'Match Finished',
      subtitle: `${winnerName} won the game`,
      isBot: false,
    };
  }

  const activeSeat = snapshot.activePlayer;
  const isBot = snapshot.isBotTurn;
  const playerName = activeSeat?.displayName || `${capitalize(snapshot.currentTurn || 'Current')} Player`;

  if (isBusy && isBot) {
    return {
      title: playerName,
      subtitle: snapshot.turnPhase === 'roll' ? 'Rolling dice...' : 'Choosing token...',
      isBot: true,
    };
  }

  if (isBot) {
    return {
      title: playerName,
      subtitle: snapshot.turnPhase === 'roll' ? 'Thinking...' : 'Moving...',
      isBot: true,
    };
  }

  // Human player
  if (snapshot.turnPhase === 'roll') {
    return {
      title: playerName,
      subtitle: 'Your turn to roll',
      isBot: false,
    };
  }

  return {
    title: playerName,
    subtitle: 'Choose a token to move',
    isBot: false,
  };
}

export interface PlayerRankDisplay {
  rank: number;
  color: PlayerColor;
  displayName: string;
  isBot: boolean;
}

/**
 * Formats finished rankings in finishing order.
 */
export function getRankingsDisplay(snapshot: LocalLudoSessionSnapshot): PlayerRankDisplay[] {
  const seatsByColor = new Map<PlayerColor, LocalSeatConfig>();
  for (const s of snapshot.seats) {
    seatsByColor.set(s.color, s);
  }

  return snapshot.rankings.map((color, index) => {
    const seat = seatsByColor.get(color);
    return {
      rank: index + 1,
      color,
      displayName: seat?.displayName || `${capitalize(color)} Player`,
      isBot: seat?.status === 'bot',
    };
  });
}
