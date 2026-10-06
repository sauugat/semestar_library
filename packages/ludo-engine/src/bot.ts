/**
 * Semester Library Games Platform - Ludo Bot Controller
 *
 * Offline, deterministic, heuristic bot decision engine supporting Easy, Normal,
 * and Hard difficulties. Guaranteed to only select valid legal moves.
 */

import type {
  PlayerColor,
  BotDifficulty,
  LudoState,
  LegalMove,
  RngFn,
  MoveResult,
} from './types.ts';
import {
  TOTAL_TRACK_CELLS,
  FINISH_PROGRESS,
  HOME_PROGRESS,
  TRACK_END_PROGRESS,
  progressToTrackCell,
} from './board.ts';
import type { LudoEngine } from './engine.ts';

/**
 * Calculates forward step distance from `fromTrack` to `toTrack` along the 52-cell ring.
 */
export function trackDistance(fromTrack: number, toTrack: number): number {
  return (toTrack - fromTrack + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS;
}

/**
 * Evaluates tactical vulnerability on a track cell.
 * Returns true if an active opponent token can land on `targetTrack` on their next turn.
 * Correctly accounts for:
 * 1. 52-cell track wrap (e.g. from 50 to 2)
 * 2. Opponent route bounds (opponent must still be on shared track, not turning into their home stretch)
 */
export function isTrackCellThreatened(
  targetTrack: number,
  playerColor: PlayerColor,
  state: LudoState
): boolean {
  for (const otherColor of state.activeColors) {
    if (otherColor === playerColor) continue;
    const oppTokens = state.tokens[otherColor];
    for (let t = 0; t < 4; t++) {
      const oppProg = oppTokens[t];
      // Opponent must currently be on the shared track
      if (oppProg >= 0 && oppProg <= TRACK_END_PROGRESS) {
        const oppTrack = progressToTrackCell(otherColor, oppProg);
        if (oppTrack !== null) {
          const dist = trackDistance(oppTrack, targetTrack);
          // Distance must be within a single roll (1..6)
          if (dist >= 1 && dist <= 6) {
            // CRITICAL WRAP & BOUNDS CHECK:
            // Opponent only travels to targetTrack if that step remains on the shared track (<= 50).
            // If oppProg + dist > 50, opponent turns into their private home stretch and cannot hit targetTrack!
            if (oppProg + dist <= TRACK_END_PROGRESS) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Scores a move under the NORMAL heuristic model.
 */
function scoreNormalMove(move: LegalMove): number {
  let score = 0;

  // Finishing a token
  if (move.isFinish) {
    score += 500;
  }

  // Capturing an opponent
  if (move.isCapture) {
    score += 300;
  }

  // Leaving home yard
  if (move.isLeavingHome) {
    score += 150;
  }

  // Entering safe cell or stretch
  if (move.targetPosition.type === 'track' && move.targetPosition.isSafe) {
    score += 60;
  } else if (move.targetPosition.type === 'stretch') {
    score += 80;
  }

  // Advancing toward finish
  score += move.targetProgress;

  return score;
}

/**
 * Scores a move under the HARD tactical heuristic model.
 */
function scoreHardMove(
  move: LegalMove,
  playerColor: PlayerColor,
  state: LudoState
): number {
  let score = 0;

  // 1. Immediate Finish
  if (move.isFinish) {
    score += 1000;
  }

  // 2. Immediate Capture
  if (move.isCapture && move.targetPosition.type === 'track') {
    let maxOpponentProg = 0;
    const trackIdx = move.targetPosition.trackIndex;
    for (const otherColor of state.activeColors) {
      if (otherColor === playerColor) continue;
      for (let t = 0; t < 4; t++) {
        const oppProg = state.tokens[otherColor][t];
        if (progressToTrackCell(otherColor, oppProg) === trackIdx) {
          if (oppProg > maxOpponentProg) {
            maxOpponentProg = oppProg;
          }
        }
      }
    }
    // High-value capture: bonus proportional to captured token's distance
    score += 600 + maxOpponentProg * 5;
  }

  // 3. Escaping Capture
  if (move.currentProgress >= 0 && move.currentProgress <= TRACK_END_PROGRESS) {
    const currentTrack = progressToTrackCell(playerColor, move.currentProgress);
    if (currentTrack !== null) {
      const wasThreatened = isTrackCellThreatened(currentTrack, playerColor, state);
      if (wasThreatened) {
        // Escaping danger is highly rewarded
        score += 350;
      }
    }
  }

  // 4. Safe Cell / Safe Stretch Landing
  if (move.targetPosition.type === 'stretch') {
    score += 200; // Completely safe from opponent captures
  } else if (move.targetPosition.type === 'track' && move.targetPosition.isSafe) {
    score += 150;
  }

  // 5. Tactical Risk Penalty: landing on an exposed track square
  if (move.targetPosition.type === 'track' && !move.targetPosition.isSafe) {
    const willBeThreatened = isTrackCellThreatened(
      move.targetPosition.trackIndex,
      playerColor,
      state
    );
    if (willBeThreatened) {
      score -= 280; // Heavy penalty for moving into strike zone
    }
  }

  // 6. Bringing Pieces into Play
  if (move.isLeavingHome) {
    const playerTokens = state.tokens[playerColor];
    const activeTokens = playerTokens.filter(
      (p) => p !== HOME_PROGRESS && p !== FINISH_PROGRESS
    ).length;

    if (activeTokens === 0) {
      score += 320; // Critical to get first piece moving
    } else if (activeTokens === 1) {
      score += 240;
    } else if (activeTokens === 2) {
      score += 130;
    } else {
      score += 50;
    }
  }

  // 7. Stalking Opponents (placing token 1..6 steps behind opponent on shared track)
  if (move.targetPosition.type === 'track') {
    const myTrack = move.targetPosition.trackIndex;
    for (const otherColor of state.activeColors) {
      if (otherColor === playerColor) continue;
      for (let t = 0; t < 4; t++) {
        const oppProg = state.tokens[otherColor][t];
        if (oppProg >= 0 && oppProg <= TRACK_END_PROGRESS) {
          const oppTrack = progressToTrackCell(otherColor, oppProg);
          if (oppTrack !== null) {
            const dist = trackDistance(myTrack, oppTrack);
            if (dist >= 1 && dist <= 6 && move.targetProgress + dist <= TRACK_END_PROGRESS) {
              score += 90; // Threaten opponent
              break;
            }
          }
        }
      }
    }
  }

  // 8. General Advancement
  score += move.targetProgress * 2;

  return score;
}

/**
 * Selects the best legal move for a bot player based on difficulty and injectable RNG.
 * Guaranteed to return an element of state.legalMoves, or null if no legal moves exist.
 */
export function selectBotMove(
  state: LudoState,
  difficulty: BotDifficulty = 'normal',
  rng: RngFn = Math.random
): LegalMove | null {
  const moves = state.legalMoves;
  if (!moves || moves.length === 0) {
    return null;
  }

  if (moves.length === 1) {
    return moves[0];
  }

  const playerColor = state.currentTurn;
  if (!playerColor) {
    return moves[0];
  }

  switch (difficulty) {
    case 'easy': {
      // Pick randomly among legal moves
      const index = Math.floor(rng() * moves.length);
      return moves[index] || moves[0];
    }

    case 'normal': {
      let bestMove = moves[0];
      let bestScore = -Infinity;

      for (const m of moves) {
        const s = scoreNormalMove(m);
        if (s > bestScore) {
          bestScore = s;
          bestMove = m;
        }
      }
      return bestMove;
    }

    case 'hard': {
      let bestMove = moves[0];
      let bestScore = -Infinity;

      for (const m of moves) {
        const s = scoreHardMove(m, playerColor, state);
        if (s > bestScore) {
          bestScore = s;
          bestMove = m;
        }
      }
      return bestMove;
    }
  }
}

/**
 * Helper to step a bot through its turn (roll if needed, then move).
 */
export function stepBot(
  engine: LudoEngine,
  difficulty?: BotDifficulty,
  rng: RngFn = Math.random
): {
  rolled?: number;
  selectedMove?: LegalMove | null;
  moveResult?: MoveResult;
} {
  const state = engine.getState();
  if (state.status !== 'playing' || !state.currentTurn) {
    return {};
  }

  const player = state.players[state.currentTurn];
  const activeDifficulty = difficulty || player?.botDifficulty || 'normal';

  let rolled: number | undefined = undefined;

  // Roll dice if in roll phase
  if (state.turnPhase === 'roll') {
    const dice = Math.floor(rng() * 6) + 1;
    const rollRes = engine.applyRoll(dice);
    rolled = dice;
    if (!rollRes.success || rollRes.autoPassed || rollRes.forfeitedDueToThreeSixes) {
      return { rolled };
    }
  } else {
    rolled = state.currentRoll ?? undefined;
  }

  // Select and execute move
  const updatedState = engine.getState();
  if (updatedState.turnPhase === 'move' && updatedState.legalMoves.length > 0) {
    const chosen = selectBotMove(updatedState, activeDifficulty, rng);
    if (chosen) {
      const moveResult = engine.makeMove(updatedState.currentTurn!, chosen.tokenIndex);
      return { rolled, selectedMove: chosen, moveResult };
    }
  }

  return { rolled };
}
