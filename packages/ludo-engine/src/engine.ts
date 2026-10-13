/**
 * Semester Library Games Platform - Authoritative Ludo Rules Engine
 *
 * Deterministic, serializable, pure TypeScript engine supporting 2-4 players,
 * human/bot seats, standard Ludo v1 ruleset, and injectable RNG.
 */

import type {
  PlayerColor,
  LudoGameStatus,
  TurnPhase,
  ExtraTurnReason,
  LudoPlayer,
  LudoInitOptions,
  LudoState,
  LegalMove,
  LastAction,
  DiceRoller,
  RngFn,
  RollResult,
  MoveResult,
  ForfeitResult,
} from './types.ts';
import { PLAYER_COLORS } from './types.ts';
import {
  START_OFFSETS,
  START_PROGRESS,
  HOME_PROGRESS,
  FINISH_PROGRESS,
  progressToTrackCell,
  progressToBoardPosition,
} from './board.ts';
import { validateLudoState } from './validator.ts';

export function createStandardDiceRoller(rng: RngFn = Math.random): DiceRoller {
  return {
    roll: () => Math.floor(rng() * 6) + 1,
  };
}

export function createDeterministicDiceRoller(sequence: number[]): DiceRoller {
  let index = 0;
  return {
    roll: () => {
      if (sequence.length === 0) {
        throw new Error('Deterministic dice sequence is empty');
      }
      const val = sequence[index % sequence.length];
      index++;
      return val;
    },
  };
}

export class LudoEngine {
  private status: LudoGameStatus = 'waiting';
  private activeColors: PlayerColor[] = [];
  private players: Record<PlayerColor, LudoPlayer | null> = {
    red: null,
    green: null,
    yellow: null,
    blue: null,
  };
  private tokens: Record<PlayerColor, [number, number, number, number]> = {
    red: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
  };
  private currentTurn: PlayerColor | null = null;
  private turnPhase: TurnPhase | null = null;
  private currentRoll: number | null = null;
  private consecutiveSixes: number = 0;
  private legalMoves: LegalMove[] = [];
  private rankings: PlayerColor[] = [];
  private lastAction: LastAction | null = null;
  private round: number = 1;
  private revision: number = 0;

  constructor(initialState?: LudoState) {
    if (initialState) {
      this.status = initialState.status;
      this.activeColors = [...initialState.activeColors];
      this.players = {
        red: initialState.players.red ? { ...initialState.players.red } : null,
        green: initialState.players.green ? { ...initialState.players.green } : null,
        yellow: initialState.players.yellow ? { ...initialState.players.yellow } : null,
        blue: initialState.players.blue ? { ...initialState.players.blue } : null,
      };
      this.tokens = {
        red: [...initialState.tokens.red],
        green: [...initialState.tokens.green],
        yellow: [...initialState.tokens.yellow],
        blue: [...initialState.tokens.blue],
      };
      this.currentTurn = initialState.currentTurn;
      this.turnPhase = initialState.turnPhase;
      this.currentRoll = initialState.currentRoll;
      this.consecutiveSixes = initialState.consecutiveSixes;
      this.legalMoves = initialState.legalMoves.map((m) => ({
        ...m,
        targetPosition: { ...m.targetPosition },
      }));
      this.rankings = [...initialState.rankings];
      this.lastAction = initialState.lastAction
        ? {
            ...initialState.lastAction,
            captured: initialState.lastAction.captured
              ? initialState.lastAction.captured.map((c) => ({ ...c }))
              : undefined,
          }
        : null;
      this.round = initialState.round;
      this.revision = initialState.revision;
    }
  }

  /**
   * Initializes a new Ludo match with specified player configurations.
   */
  public static create(options: LudoInitOptions): LudoEngine {
    if (!options.players || options.players.length < 2 || options.players.length > 4) {
      throw new Error(`Ludo requires between 2 and 4 players, got ${options?.players?.length ?? 0}`);
    }

    const seenColors = new Set<PlayerColor>();
    const seenIds = new Set<string>();

    for (const p of options.players) {
      if (!PLAYER_COLORS.includes(p.color)) {
        throw new Error(`Invalid player color: "${p.color}"`);
      }
      if (seenColors.has(p.color)) {
        throw new Error(`Duplicate player color: "${p.color}"`);
      }
      if (!p.id || typeof p.id !== 'string') {
        throw new Error(`Player must have a non-empty string id`);
      }
      if (seenIds.has(p.id)) {
        throw new Error(`Duplicate player id: "${p.id}"`);
      }
      seenColors.add(p.color);
      seenIds.add(p.id);
    }

    // Active colors ordered in canonical clockwise order (red -> green -> yellow -> blue)
    const activeColors: PlayerColor[] = PLAYER_COLORS.filter((c) => seenColors.has(c));

    const playersRecord: Record<PlayerColor, LudoPlayer | null> = {
      red: null,
      green: null,
      yellow: null,
      blue: null,
    };

    for (const p of options.players) {
      playersRecord[p.color] = {
        id: p.id,
        color: p.color,
        type: p.type,
        name: p.name,
        botDifficulty: p.type === 'bot' ? p.botDifficulty || 'normal' : undefined,
      };
    }

    const firstColor =
      options.startingColor && seenColors.has(options.startingColor)
        ? options.startingColor
        : activeColors[0];

    const state: LudoState = {
      gameType: 'ludo',
      status: 'playing',
      activeColors,
      players: playersRecord,
      tokens: {
        red: [-1, -1, -1, -1],
        green: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
      },
      currentTurn: firstColor,
      turnPhase: 'roll',
      currentRoll: null,
      consecutiveSixes: 0,
      legalMoves: [],
      rankings: [],
      lastAction: null,
      round: 1,
      revision: 0,
    };

    return new LudoEngine(state);
  }

  /**
   * Restores an engine from raw or parsed state with strict runtime validation.
   */
  public static fromState(raw: unknown): LudoEngine {
    const validated = validateLudoState(raw);
    if (!validated.valid) {
      throw new Error(`Failed to restore LudoEngine: ${validated.error}`);
    }
    return new LudoEngine(validated.state);
  }

  public clone(): LudoEngine {
    return new LudoEngine(this.getState());
  }

  public getState(): LudoState {
    return {
      gameType: 'ludo',
      status: this.status,
      activeColors: [...this.activeColors],
      players: {
        red: this.players.red ? { ...this.players.red } : null,
        green: this.players.green ? { ...this.players.green } : null,
        yellow: this.players.yellow ? { ...this.players.yellow } : null,
        blue: this.players.blue ? { ...this.players.blue } : null,
      },
      tokens: {
        red: [...this.tokens.red],
        green: [...this.tokens.green],
        yellow: [...this.tokens.yellow],
        blue: [...this.tokens.blue],
      },
      currentTurn: this.currentTurn,
      turnPhase: this.turnPhase,
      currentRoll: this.currentRoll,
      consecutiveSixes: this.consecutiveSixes,
      legalMoves: this.legalMoves.map((m) => ({
        ...m,
        targetPosition: { ...m.targetPosition },
      })),
      rankings: [...this.rankings],
      lastAction: this.lastAction
        ? {
            ...this.lastAction,
            captured: this.lastAction.captured
              ? this.lastAction.captured.map((c) => ({ ...c }))
              : undefined,
          }
        : null,
      round: this.round,
      revision: this.revision,
    };
  }

  /**
   * Returns legal moves for the current turn, or empty array if not in move phase.
   */
  public getLegalMoves(color?: PlayerColor): LegalMove[] {
    if (this.status !== 'playing' || this.turnPhase !== 'move' || this.currentRoll === null) {
      return [];
    }
    const targetColor = color || this.currentTurn;
    if (targetColor !== this.currentTurn) {
      return [];
    }
    return this.legalMoves.map((m) => ({
      ...m,
      targetPosition: { ...m.targetPosition },
    }));
  }

  /**
   * Checks whether a specific token of a player can legally move right now.
   */
  public canMoveToken(color: PlayerColor, tokenIndex: number): boolean {
    if (this.status !== 'playing' || this.turnPhase !== 'move' || color !== this.currentTurn) {
      return false;
    }
    return this.legalMoves.some((m) => m.tokenIndex === tokenIndex);
  }

  /**
   * Applies an authoritative dice roll (1..6).
   */
  public applyRoll(diceValue: number): RollResult {
    if (this.status === 'finished') {
      return { success: false, error: 'Game is already finished.' };
    }
    if (this.status !== 'playing') {
      return { success: false, error: 'Game is not in playing state.' };
    }
    if (this.turnPhase !== 'roll') {
      return {
        success: false,
        error: `Cannot roll dice in "${this.turnPhase}" phase. Waiting for token move.`,
      };
    }
    if (!Number.isInteger(diceValue) || diceValue < 1 || diceValue > 6) {
      return {
        success: false,
        error: `Invalid dice roll: ${diceValue}. Must be an integer between 1 and 6.`,
      };
    }

    const playerColor = this.currentTurn!;

    // Check consecutive sixes
    if (diceValue === 6) {
      this.consecutiveSixes++;
      if (this.consecutiveSixes === 3) {
        // Three consecutive sixes forfeits the current turn!
        this.consecutiveSixes = 0;
        this.currentRoll = null;
        this.turnPhase = 'roll';
        this.legalMoves = [];
        this.lastAction = {
          type: 'three_sixes_forfeit',
          color: playerColor,
          roll: 6,
          consecutiveSixes: 3,
        };
        this.advanceTurn();
        this.revision++;

        return {
          success: true,
          diceValue: 6,
          consecutiveSixes: 3,
          forfeitedDueToThreeSixes: true,
          nextTurn: this.currentTurn,
        };
      }
    } else {
      this.consecutiveSixes = 0;
    }

    // Compute legal moves
    const moves = this.calculateLegalMovesForRoll(playerColor, diceValue);

    if (moves.length === 0) {
      // Auto-pass: no legal moves possible
      this.currentRoll = null;
      this.turnPhase = 'roll';
      this.legalMoves = [];
      this.lastAction = {
        type: 'pass',
        color: playerColor,
        roll: diceValue,
        consecutiveSixes: this.consecutiveSixes,
      };
      this.advanceTurn();
      this.revision++;

      return {
        success: true,
        diceValue,
        consecutiveSixes: this.consecutiveSixes,
        legalMoves: [],
        autoPassed: true,
        nextTurn: this.currentTurn,
      };
    }

    // Legal moves available: enter move phase
    this.currentRoll = diceValue;
    this.turnPhase = 'move';
    this.legalMoves = moves;
    this.lastAction = {
      type: 'roll',
      color: playerColor,
      roll: diceValue,
      consecutiveSixes: this.consecutiveSixes,
    };
    this.revision++;

    return {
      success: true,
      diceValue,
      consecutiveSixes: this.consecutiveSixes,
      legalMoves: moves.map((m) => ({
        ...m,
        targetPosition: { ...m.targetPosition },
      })),
    };
  }

  /**
   * Rolls using an injected DiceRoller, number, or RngFn.
   */
  public rollDice(roller?: DiceRoller | number | RngFn): RollResult {
    if (typeof roller === 'number') {
      return this.applyRoll(roller);
    }
    if (typeof roller === 'function') {
      const dice = Math.floor(roller() * 6) + 1;
      return this.applyRoll(dice);
    }
    if (roller && typeof roller.roll === 'function') {
      return this.applyRoll(roller.roll());
    }
    const defaultDice = Math.floor(Math.random() * 6) + 1;
    return this.applyRoll(defaultDice);
  }

  /**
   * Authoritative token movement execution.
   */
  public makeMove(color: PlayerColor, tokenIndex: number): MoveResult {
    if (this.status === 'finished') {
      return { success: false, error: 'Game is already finished.' };
    }
    if (this.status !== 'playing') {
      return { success: false, error: 'Game is not in playing state.' };
    }
    if (color !== this.currentTurn) {
      return {
        success: false,
        error: `It is not player ${color}'s turn. Current turn: ${this.currentTurn}.`,
      };
    }
    if (this.turnPhase !== 'move' || this.currentRoll === null) {
      return {
        success: false,
        error: 'Must roll the dice before making a move.',
      };
    }
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
      return {
        success: false,
        error: `Invalid tokenIndex: ${tokenIndex}. Must be 0, 1, 2, or 3.`,
      };
    }

    const matchingMove = this.legalMoves.find((m) => m.tokenIndex === tokenIndex);
    if (!matchingMove) {
      return {
        success: false,
        error: `Token ${tokenIndex} cannot legally move with roll ${this.currentRoll}.`,
      };
    }

    const fromProgress = this.tokens[color][tokenIndex];
    const toProgress = matchingMove.targetProgress;
    const rollUsed = this.currentRoll;

    // Resolve Captures (all opponent tokens on that non-safe track cell return home)
    const capturedTokens: { color: PlayerColor; tokenIndex: number }[] = [];
    if (matchingMove.isCapture && matchingMove.targetPosition.type === 'track') {
      const trackIndex = matchingMove.targetPosition.trackIndex;
      for (const otherColor of this.activeColors) {
        if (otherColor === color) continue;
        for (let t = 0; t < 4; t++) {
          const prog = this.tokens[otherColor][t];
          const oppTrack = progressToTrackCell(otherColor, prog);
          if (oppTrack === trackIndex) {
            // Captured! Opponent token sent back to home yard
            this.tokens[otherColor][t] = HOME_PROGRESS;
            capturedTokens.push({ color: otherColor, tokenIndex: t });
          }
        }
      }
    }

    // Apply movement
    this.tokens[color][tokenIndex] = toProgress;

    // Check if token finished
    const reachedFinish = toProgress === FINISH_PROGRESS;
    let playerRanked: { color: PlayerColor; rank: number } | undefined = undefined;

    // Check if player completed all 4 tokens
    const allFinished = this.tokens[color].every((p) => p === FINISH_PROGRESS);
    if (allFinished && !this.rankings.includes(color)) {
      this.rankings.push(color);
      playerRanked = { color, rank: this.rankings.length };
    }

    // Check if game is mathematically complete
    const remainingUnranked = this.activeColors.filter((c) => !this.rankings.includes(c));
    let gameFinished = false;

    if (remainingUnranked.length <= 1) {
      // Last remaining player automatically receives the final rank
      if (remainingUnranked.length === 1) {
        this.rankings.push(remainingUnranked[0]);
      }
      this.status = 'finished';
      this.currentTurn = null;
      this.turnPhase = null;
      this.currentRoll = null;
      this.legalMoves = [];
      gameFinished = true;
    }

    // Extra Turn Logic:
    // Defined precedence: finish > capture > six
    let extraTurnGranted = false;
    let extraTurnReason: ExtraTurnReason | null = null;

    if (!gameFinished) {
      if (allFinished) {
        // Player who completed their 4th token NEVER rolls again
        extraTurnGranted = false;
        this.advanceTurn();
        this.consecutiveSixes = 0;
      } else {
        const isSix = rollUsed === 6;
        const hasCapture = capturedTokens.length > 0;
        const hasFinish = reachedFinish;

        if (hasFinish) {
          extraTurnGranted = true;
          extraTurnReason = 'finish';
        } else if (hasCapture) {
          extraTurnGranted = true;
          extraTurnReason = 'capture';
        } else if (isSix) {
          extraTurnGranted = true;
          extraTurnReason = 'six';
        }

        if (extraTurnGranted) {
          // Exactly ONE extra turn granted; player keeps turn for another roll
          this.turnPhase = 'roll';
          this.currentRoll = null;
          this.legalMoves = [];
        } else {
          // Turn passes to next player
          this.advanceTurn();
          this.consecutiveSixes = 0;
        }
      }
    }

    this.lastAction = {
      type: 'move',
      color,
      roll: rollUsed,
      tokenIndex,
      ...(capturedTokens.length > 0 ? { captured: capturedTokens } : {}),
      consecutiveSixes: this.consecutiveSixes,
    };
    this.revision++;

    return {
      success: true,
      movedToken: {
        color,
        tokenIndex,
        fromProgress,
        toProgress,
        targetPosition: matchingMove.targetPosition,
      },
      capturedTokens: capturedTokens.length > 0 ? capturedTokens : undefined,
      reachedFinish,
      playerRanked,
      extraTurnGranted,
      extraTurnReason,
      nextTurn: this.currentTurn,
      gameFinished,
    };
  }

  /**
   * Handles explicit player forfeit.
   */
  public forfeit(color: PlayerColor): ForfeitResult {
    if (this.status !== 'playing') {
      return { success: false, error: 'Cannot forfeit: game is not playing.' };
    }
    if (!this.activeColors.includes(color)) {
      return { success: false, error: `Color "${color}" is not an active player in this game.` };
    }
    if (this.rankings.includes(color)) {
      return { success: false, error: `Player "${color}" has already finished.` };
    }

    // Place forfeiting player at lowest rank
    this.rankings.push(color);

    const remainingUnranked = this.activeColors.filter((c) => !this.rankings.includes(c));
    let gameFinished = false;

    if (remainingUnranked.length <= 1) {
      if (remainingUnranked.length === 1) {
        // Place sole survivor at current best available rank ahead of forfeited player
        const survivor = remainingUnranked[0];
        const forfeitIdx = this.rankings.indexOf(color);
        this.rankings.splice(forfeitIdx, 0, survivor);
      }
      this.status = 'finished';
      this.currentTurn = null;
      this.turnPhase = null;
      this.currentRoll = null;
      this.legalMoves = [];
      gameFinished = true;
    } else {
      if (this.currentTurn === color) {
        this.advanceTurn();
      }
    }

    this.revision++;

    return {
      success: true,
      forfeitedColor: color,
      rankings: [...this.rankings],
      gameFinished,
    };
  }

  /**
   * Advances current turn clockwise to the next active player who hasn't finished.
   */
  private advanceTurn(): PlayerColor | null {
    if (this.status === 'finished') {
      this.currentTurn = null;
      this.turnPhase = null;
      this.currentRoll = null;
      this.legalMoves = [];
      return null;
    }

    const availableColors = this.activeColors.filter((c) => !this.rankings.includes(c));
    if (availableColors.length <= 1) {
      if (availableColors.length === 1) {
        this.rankings.push(availableColors[0]);
      }
      this.status = 'finished';
      this.currentTurn = null;
      this.turnPhase = null;
      this.currentRoll = null;
      this.legalMoves = [];
      return null;
    }

    const currentIndex = this.currentTurn
      ? this.activeColors.indexOf(this.currentTurn)
      : -1;

    for (let offset = 1; offset <= this.activeColors.length; offset++) {
      const nextIdx = (currentIndex + offset) % this.activeColors.length;
      const candidate = this.activeColors[nextIdx];
      if (!this.rankings.includes(candidate)) {
        this.currentTurn = candidate;
        this.turnPhase = 'roll';
        this.currentRoll = null;
        this.legalMoves = [];
        this.consecutiveSixes = 0;
        return candidate;
      }
    }

    // Fallback if all players finished
    this.status = 'finished';
    this.currentTurn = null;
    this.turnPhase = null;
    return null;
  }

  /**
   * Pure calculation of legal moves for a given player and dice roll.
   */
  public calculateLegalMovesForRoll(color: PlayerColor, roll: number): LegalMove[] {
    if (this.rankings.includes(color)) {
      return [];
    }

    const moves: LegalMove[] = [];
    const playerTokens = this.tokens[color];

    for (let t = 0; t < 4; t++) {
      const prog = playerTokens[t];

      // Token in home yard
      if (prog === HOME_PROGRESS) {
        if (roll === 6) {
          const targetPos = progressToBoardPosition(color, START_PROGRESS, t);
          // Leaving home to start square (start squares are safe)
          moves.push({
            tokenIndex: t,
            currentProgress: HOME_PROGRESS,
            targetProgress: START_PROGRESS,
            isLeavingHome: true,
            isCapture: false, // Start squares are safe, cannot capture
            isFinish: false,
            targetPosition: targetPos,
          });
        }
        continue;
      }

      // Token already finished
      if (prog === FINISH_PROGRESS) {
        continue;
      }

      // Token on track or home stretch
      const targetProg = prog + roll;

      // Overshoot check
      if (targetProg > FINISH_PROGRESS) {
        continue; // Illegal overshoot
      }

      const targetPos = progressToBoardPosition(color, targetProg, t);
      const isFinish = targetProg === FINISH_PROGRESS;
      let isCapture = false;

      // Check if this move captures an opponent token
      if (targetPos.type === 'track' && !targetPos.isSafe) {
        const targetTrack = targetPos.trackIndex;
        for (const otherColor of this.activeColors) {
          if (otherColor === color) continue;
          for (let oppT = 0; oppT < 4; oppT++) {
            const oppProg = this.tokens[otherColor][oppT];
            if (progressToTrackCell(otherColor, oppProg) === targetTrack) {
              isCapture = true;
              break;
            }
          }
          if (isCapture) break;
        }
      }

      moves.push({
        tokenIndex: t,
        currentProgress: prog,
        targetProgress: targetProg,
        isLeavingHome: false,
        isCapture,
        isFinish,
        targetPosition: targetPos,
      });
    }

    return moves;
  }
}
