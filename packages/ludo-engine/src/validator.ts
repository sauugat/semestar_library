/**
 * Semester Library Games Platform - Ludo State Validator & Normalizer
 *
 * Strict runtime validation and invariant enforcement for LudoState.
 */

import type {
  PlayerColor,
  PlayerType,
  BotDifficulty,
  LudoState,
  LudoPlayer,
  LegalMove,
  LastAction,
} from './types.ts';
import { PLAYER_COLORS } from './types.ts';
import { FINISH_PROGRESS, HOME_PROGRESS } from './board.ts';

const VALID_COLORS = new Set<string>(PLAYER_COLORS);
const VALID_TYPES = new Set<string>(['human', 'bot']);
const VALID_DIFFICULTIES = new Set<string>(['easy', 'normal', 'hard']);

export function validateLudoState(
  data: unknown
): { valid: true; state: LudoState } | { valid: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'State must be a non-null object' };
  }

  const s = data as Record<string, unknown>;

  if (s.gameType !== 'ludo') {
    return {
      valid: false,
      error: `Invalid gameType: expected "ludo", got "${s.gameType}"`,
    };
  }

  if (
    s.status !== 'waiting' &&
    s.status !== 'playing' &&
    s.status !== 'finished'
  ) {
    return {
      valid: false,
      error: `Invalid status: "${s.status}". Expected "waiting", "playing", or "finished"`,
    };
  }

  if (
    typeof s.revision !== 'number' ||
    !Number.isInteger(s.revision) ||
    s.revision < 0
  ) {
    return {
      valid: false,
      error: `Invalid revision: must be a non-negative integer, got ${s.revision}`,
    };
  }

  if (
    typeof s.round !== 'number' ||
    !Number.isInteger(s.round) ||
    s.round < 1
  ) {
    return {
      valid: false,
      error: `Invalid round: must be a positive integer, got ${s.round}`,
    };
  }

  // Active colors validation
  if (!Array.isArray(s.activeColors)) {
    return { valid: false, error: 'activeColors must be an array' };
  }
  if (s.activeColors.length < 2 || s.activeColors.length > 4) {
    return {
      valid: false,
      error: `activeColors must contain between 2 and 4 players, got ${s.activeColors.length}`,
    };
  }

  const activeColorsSet = new Set<PlayerColor>();
  for (const c of s.activeColors) {
    if (typeof c !== 'string' || !VALID_COLORS.has(c)) {
      return { valid: false, error: `Invalid color in activeColors: "${c}"` };
    }
    const color = c as PlayerColor;
    if (activeColorsSet.has(color)) {
      return { valid: false, error: `Duplicate color in activeColors: "${color}"` };
    }
    activeColorsSet.add(color);
  }

  // Players validation
  if (typeof s.players !== 'object' || s.players === null) {
    return { valid: false, error: 'players must be a non-null object' };
  }
  const playersRaw = s.players as Record<string, unknown>;
  const players: Record<PlayerColor, LudoPlayer | null> = {
    red: null,
    green: null,
    yellow: null,
    blue: null,
  };

  for (const color of PLAYER_COLORS) {
    const p = playersRaw[color];
    const isActive = activeColorsSet.has(color);

    if (isActive) {
      if (typeof p !== 'object' || p === null) {
        return {
          valid: false,
          error: `Missing or null player object for active color "${color}"`,
        };
      }
      const playerRecord = p as Record<string, unknown>;
      if (
        typeof playerRecord.id !== 'string' ||
        playerRecord.id.trim() === ''
      ) {
        return {
          valid: false,
          error: `Player for color "${color}" has invalid or empty id`,
        };
      }
      if (playerRecord.color !== color) {
        return {
          valid: false,
          error: `Player color mismatch for "${color}": got "${playerRecord.color}"`,
        };
      }
      if (
        typeof playerRecord.type !== 'string' ||
        !VALID_TYPES.has(playerRecord.type)
      ) {
        return {
          valid: false,
          error: `Player "${color}" has invalid type: "${playerRecord.type}"`,
        };
      }

      // Invariant: human player must NOT carry a botDifficulty
      if (playerRecord.type === 'human') {
        if (
          playerRecord.botDifficulty !== undefined &&
          playerRecord.botDifficulty !== null
        ) {
          return {
            valid: false,
            error: `Human player "${color}" cannot have a botDifficulty`,
          };
        }
      }

      let botDifficulty: BotDifficulty | undefined = undefined;
      if (playerRecord.type === 'bot') {
        if (
          playerRecord.botDifficulty !== undefined &&
          (typeof playerRecord.botDifficulty !== 'string' ||
            !VALID_DIFFICULTIES.has(playerRecord.botDifficulty))
        ) {
          return {
            valid: false,
            error: `Invalid botDifficulty for "${color}": "${playerRecord.botDifficulty}"`,
          };
        }
        botDifficulty = (playerRecord.botDifficulty as BotDifficulty) || 'normal';
      }

      players[color] = {
        id: playerRecord.id,
        color,
        type: playerRecord.type as PlayerType,
        name: typeof playerRecord.name === 'string' ? playerRecord.name : undefined,
        botDifficulty,
      };
    } else {
      if (p !== null && p !== undefined) {
        return {
          valid: false,
          error: `Inactive color "${color}" must have null player, got ${JSON.stringify(p)}`,
        };
      }
    }
  }

  // Tokens validation
  if (typeof s.tokens !== 'object' || s.tokens === null) {
    return { valid: false, error: 'tokens must be a non-null object' };
  }
  const tokensRaw = s.tokens as Record<string, unknown>;
  const tokens: Record<PlayerColor, [number, number, number, number]> = {
    red: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
  };

  for (const color of PLAYER_COLORS) {
    const colorTokens = tokensRaw[color];
    const isActive = activeColorsSet.has(color);

    if (!Array.isArray(colorTokens) || colorTokens.length !== 4) {
      return {
        valid: false,
        error: `tokens.${color} must be an array of exactly 4 numbers`,
      };
    }
    const tokenTuple: [number, number, number, number] = [-1, -1, -1, -1];
    for (let i = 0; i < 4; i++) {
      const prog = colorTokens[i];
      if (
        typeof prog !== 'number' ||
        !Number.isInteger(prog) ||
        prog < HOME_PROGRESS ||
        prog > FINISH_PROGRESS
      ) {
        return {
          valid: false,
          error: `Invalid token progress for ${color}[${i}]: got ${prog}. Must be integer between ${HOME_PROGRESS} and ${FINISH_PROGRESS}`,
        };
      }
      tokenTuple[i] = prog;
    }

    // Inactive color tokens must remain in yard
    if (!isActive) {
      if (tokenTuple.some((p) => p !== HOME_PROGRESS)) {
        return {
          valid: false,
          error: `Inactive color "${color}" tokens must all be at home (${HOME_PROGRESS})`,
        };
      }
    }

    tokens[color] = tokenTuple;
  }

  // Rankings validation
  if (!Array.isArray(s.rankings)) {
    return { valid: false, error: 'rankings must be an array' };
  }
  const rankingsSet = new Set<PlayerColor>();
  const rankings: PlayerColor[] = [];
  for (const r of s.rankings) {
    if (typeof r !== 'string' || !VALID_COLORS.has(r)) {
      return { valid: false, error: `Invalid color in rankings: "${r}"` };
    }
    const color = r as PlayerColor;
    if (!activeColorsSet.has(color)) {
      return {
        valid: false,
        error: `Color in rankings "${color}" is not an active player in this game`,
      };
    }
    if (rankingsSet.has(color)) {
      return { valid: false, error: `Duplicate color in rankings: "${color}"` };
    }
    rankingsSet.add(color);
    rankings.push(color);
  }

  // Invariant: ranked player must have all 4 tokens finished, EXCEPT possibly the last player in a finished game
  for (let idx = 0; idx < rankings.length; idx++) {
    const color = rankings[idx];
    const isAutoLastPlace = s.status === 'finished' && idx === rankings.length - 1 && rankings.length === activeColorsSet.size;
    if (!isAutoLastPlace) {
      const allDone = tokens[color].every((p) => p === FINISH_PROGRESS);
      if (!allDone) {
        return {
          valid: false,
          error: `Ranked player "${color}" does not have all 4 tokens finished`,
        };
      }
    }
  }

  // Consecutive sixes validation
  if (
    typeof s.consecutiveSixes !== 'number' ||
    !Number.isInteger(s.consecutiveSixes) ||
    s.consecutiveSixes < 0 ||
    s.consecutiveSixes > 2
  ) {
    return {
      valid: false,
      error: `Invalid consecutiveSixes: got ${s.consecutiveSixes}. Must be integer between 0 and 2`,
    };
  }

  // Status cross-field invariants
  if (s.status === 'waiting') {
    if (s.currentTurn !== null) {
      return { valid: false, error: 'currentTurn must be null when status is "waiting"' };
    }
    if (s.turnPhase !== null) {
      return { valid: false, error: 'turnPhase must be null when status is "waiting"' };
    }
    if (s.currentRoll !== null) {
      return { valid: false, error: 'currentRoll must be null when status is "waiting"' };
    }
    if (rankings.length > 0) {
      return { valid: false, error: 'rankings must be empty when status is "waiting"' };
    }
  } else if (s.status === 'playing') {
    if (
      typeof s.currentTurn !== 'string' ||
      !VALID_COLORS.has(s.currentTurn) ||
      !activeColorsSet.has(s.currentTurn as PlayerColor)
    ) {
      return {
        valid: false,
        error: `currentTurn must be an active color when status is "playing", got "${s.currentTurn}"`,
      };
    }
    const currentTurnColor = s.currentTurn as PlayerColor;
    if (rankingsSet.has(currentTurnColor)) {
      return {
        valid: false,
        error: `currentTurn "${currentTurnColor}" is already ranked and finished`,
      };
    }

    // Invariant: currentTurn player cannot already have all 4 tokens finished without being ranked
    const currentTokensDone = tokens[currentTurnColor].every((p) => p === FINISH_PROGRESS);
    if (currentTokensDone) {
      return {
        valid: false,
        error: `currentTurn "${currentTurnColor}" has all 4 tokens finished but is still actively playing`,
      };
    }

    if (s.turnPhase !== 'roll' && s.turnPhase !== 'move') {
      return {
        valid: false,
        error: `turnPhase must be "roll" or "move" when status is "playing", got "${s.turnPhase}"`,
      };
    }
    if (s.turnPhase === 'roll') {
      if (s.currentRoll !== null) {
        return {
          valid: false,
          error: 'currentRoll must be null when turnPhase is "roll"',
        };
      }
    } else if (s.turnPhase === 'move') {
      if (
        typeof s.currentRoll !== 'number' ||
        !Number.isInteger(s.currentRoll) ||
        s.currentRoll < 1 ||
        s.currentRoll > 6
      ) {
        return {
          valid: false,
          error: `currentRoll must be an integer between 1 and 6 when turnPhase is "move", got ${s.currentRoll}`,
        };
      }
    }
  } else if (s.status === 'finished') {
    if (s.currentTurn !== null) {
      return { valid: false, error: 'currentTurn must be null when status is "finished"' };
    }
    if (s.turnPhase !== null) {
      return { valid: false, error: 'turnPhase must be null when status is "finished"' };
    }
    if (s.currentRoll !== null) {
      return { valid: false, error: 'currentRoll must be null when status is "finished"' };
    }
    // Invariant: a finished match must have ranked all active players
    if (rankings.length !== activeColorsSet.size) {
      return {
        valid: false,
        error: `Finished match must have complete rankings for all ${activeColorsSet.size} active players, got ${rankings.length}`,
      };
    }
  }

  // Legal moves validation (array)
  let legalMoves: LegalMove[] = [];
  if (Array.isArray(s.legalMoves)) {
    legalMoves = s.legalMoves as LegalMove[];
  } else if (s.legalMoves !== undefined && s.legalMoves !== null) {
    return { valid: false, error: 'legalMoves must be an array' };
  }

  if (s.status !== 'playing' || s.turnPhase !== 'move') {
    if (legalMoves.length > 0) {
      return {
        valid: false,
        error: 'legalMoves must be empty when not in "move" phase',
      };
    }
  }

  // LastAction normalization
  let lastAction: LastAction | null = null;
  if (typeof s.lastAction === 'object' && s.lastAction !== null) {
    lastAction = s.lastAction as LastAction;
  }

  return {
    valid: true,
    state: {
      gameType: 'ludo',
      status: s.status,
      activeColors: [...s.activeColors] as PlayerColor[],
      players,
      tokens,
      currentTurn: (s.currentTurn as PlayerColor | null) ?? null,
      turnPhase: s.turnPhase as 'roll' | 'move' | null,
      currentRoll: (s.currentRoll as number | null) ?? null,
      consecutiveSixes: s.consecutiveSixes,
      legalMoves,
      rankings,
      lastAction,
      round: s.round,
      revision: s.revision,
    },
  };
}
