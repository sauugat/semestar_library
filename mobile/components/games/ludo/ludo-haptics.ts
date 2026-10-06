/**
 * Semester Library Games Platform - Ludo Haptics Abstraction
 *
 * Centralized, fail-safe haptic feedback utility for Ludo gameplay.
 * All functions wrap expo-haptics with .catch() handlers and try/catch
 * blocks to prevent any unhandled Promise rejections on platforms without
 * haptic hardware or when native calls fail asynchronously.
 *
 * Includes deterministic haptic precedence and bot policies:
 * - Precedence: gameWon > playerRanked > finishToken > capture
 * - Bot Policy: Bots do not trigger repetitive vibrations during rolls/moves.
 */

// Safe driver loading for Expo Haptics (graceful fallback in test/unsupported runtimes)
export interface HapticsDriver {
  impactAsync(style: any): Promise<void>;
  notificationAsync(type: any): Promise<void>;
  ImpactFeedbackStyle?: Record<string, any>;
  NotificationFeedbackType?: Record<string, any>;
}

let nativeHaptics: any = null;
if (typeof require === 'function') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeHaptics = require('expo-haptics');
  } catch {
    nativeHaptics = null;
  }
}

let activeDriver: HapticsDriver | null = null;

function getDriver(): HapticsDriver | null {
  return activeDriver || nativeHaptics;
}

const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
};

const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
};

import type { LocalLudoMoveResult } from '../../../types/ludo-session.ts';

export type LudoMoveHapticEvent = 'gameWon' | 'playerRanked' | 'finishToken' | 'capture';

/**
 * Pure helper determining the single highest-precedence haptic event for a move.
 * Guarantees no conflicting or duplicate success haptics are fired for a single action.
 */
export function resolveMoveHapticEvent(
  result: LocalLudoMoveResult,
  isBotTurn: boolean = false
): LudoMoveHapticEvent | null {
  // If match concluded, game victory haptic always takes top precedence
  if (result.gameFinished) {
    return 'gameWon';
  }

  // During bot turns, preserve user device calmness: do not vibrate on bot moves
  if (isBotTurn) {
    return null;
  }

  // Human player priority chain
  if (result.playerRanked && result.rank !== null) {
    return 'playerRanked';
  }

  if (result.reachedFinish) {
    return 'finishToken';
  }

  if (result.capturedTokens && result.capturedTokens.length > 0) {
    return 'capture';
  }

  return null;
}

export const LudoHaptics = {
  /**
   * Overrides the underlying haptics driver for testing or custom environments.
   */
  setDriver(driver: HapticsDriver | null): void {
    activeDriver = driver;
  },

  /**
   * Resets driver back to default native driver.
   */
  resetDriver(): void {
    activeDriver = null;
  },

  /**
   * Triggered when a human player begins rolling the dice.
   */
  async rollStart(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.impactAsync(driver.ImpactFeedbackStyle?.Light ?? ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      // Graceful no-op on unsupported platforms
    }
  },

  /**
   * Triggered when the dice settles on its final authoritative value.
   */
  async rollSettle(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.impactAsync(driver.ImpactFeedbackStyle?.Medium ?? ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Triggered when a human player taps a legal/selectable token.
   */
  async tokenSelected(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.impactAsync(driver.ImpactFeedbackStyle?.Light ?? ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Triggered when a moving token captures one or more opponent tokens.
   * Single call per move regardless of token count to avoid overlapping vibration queues.
   */
  async capture(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.impactAsync(driver.ImpactFeedbackStyle?.Heavy ?? ImpactFeedbackStyle.Heavy).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Triggered when a token successfully reaches the finish cell.
   */
  async finishToken(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.notificationAsync(driver.NotificationFeedbackType?.Success ?? NotificationFeedbackType.Success).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Triggered when a player finishes all tokens and is ranked.
   */
  async playerRanked(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.notificationAsync(driver.NotificationFeedbackType?.Success ?? NotificationFeedbackType.Success).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Triggered when the entire match concludes.
   */
  async gameWon(): Promise<void> {
    const driver = getDriver();
    if (!driver) return;
    try {
      await driver.notificationAsync(driver.NotificationFeedbackType?.Success ?? NotificationFeedbackType.Success).catch(() => {});
    } catch {
      // Graceful no-op
    }
  },

  /**
   * Dispatches the single appropriate haptic for a move based on precedence and bot policy.
   */
  async triggerMoveHaptic(result: LocalLudoMoveResult, isBotTurn: boolean = false): Promise<void> {
    const event = resolveMoveHapticEvent(result, isBotTurn);
    if (!event) return;

    switch (event) {
      case 'gameWon':
        await this.gameWon();
        break;
      case 'playerRanked':
        await this.playerRanked();
        break;
      case 'finishToken':
        await this.finishToken();
        break;
      case 'capture':
        await this.capture();
        break;
    }
  },
};
