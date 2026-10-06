/**
 * Semester Library Games Platform - Local Ludo Session Controller
 *
 * Authoritative offline match orchestrator managing humans, bots, turns,
 * legal moves, device handoffs, and versioned persistence.
 *
 * Rules remain strictly in @semester-library/ludo-engine.
 */

import {
  LudoEngine,
  validateLudoState,
  selectBotMove,
  getTraversedPositions,
  getTraversedCoordinates,
  createStandardDiceRoller,
  PLAYER_COLORS,
  type PlayerColor,
  type LegalMove,
  type DiceRoller,
  type RngFn,
  type LudoPlayerInit,
  type LudoState,
} from '../../../packages/ludo-engine/src/index.ts';

import type {
  LocalLudoMatchConfig,
  LocalLudoMatchInput,
  LocalSeatConfig,
  LocalSeatInput,
  LocalLudoSessionSnapshot,
  LocalLudoRollResult,
  LocalLudoMoveResult,
  LocalLudoActionResult,
  LocalLudoSavedEnvelope,
  LocalLudoRestoreResult,
  DeviceHandoffMetadata,
  SavedSessionInspection,
} from '../../types/ludo-session.ts';

import {
  type LocalLudoStorage,
  AsyncStorageLudoStorageAdapter,
} from './storage.ts';

export interface LocalLudoSessionOptions {
  storage?: LocalLudoStorage;
  diceRoller?: DiceRoller;
  botRng?: RngFn;
  allowBotOnly?: boolean; // internal/test flag; normal matches require >= 1 human
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normalizes input seat configurations into the canonical 4-seat structure:
 * Exactly 4 slots in clockwise order [red, green, yellow, blue].
 * Omitted seats are explicitly marked status = 'closed'.
 */
export function normalizeMatchConfig(
  input: LocalLudoMatchConfig | LocalLudoMatchInput,
  allowBotOnly: boolean = false
): { valid: true; config: LocalLudoMatchConfig } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Match configuration must be an object'] };
  }

  const sessionId =
    typeof input.sessionId === 'string' && input.sessionId.trim()
      ? input.sessionId.trim()
      : `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const createdAt =
    typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) && input.createdAt > 0
      ? input.createdAt
      : Date.now();

  if (!Array.isArray(input.seats)) {
    return { valid: false, errors: ['seats must be an array'] };
  }

  // Map input seats by color
  const seatInputMap = new Map<PlayerColor, LocalSeatInput>();
  for (const s of input.seats) {
    if (!s || typeof s !== 'object') {
      errors.push('Each seat must be an object');
      continue;
    }
    if (!PLAYER_COLORS.includes(s.color)) {
      errors.push(`Invalid seat color: '${s.color}'. Must be one of red, green, yellow, blue.`);
      continue;
    }
    if (seatInputMap.has(s.color)) {
      errors.push(`Duplicate seat configuration for color: '${s.color}'.`);
      continue;
    }
    seatInputMap.set(s.color, s);
  }

  // Construct canonical 4-seat array in clockwise order: red -> green -> yellow -> blue
  const canonicalSeats: LocalSeatConfig[] = [];

  for (const color of PLAYER_COLORS) {
    const rawSeat = seatInputMap.get(color);
    if (!rawSeat || rawSeat.status === 'closed') {
      canonicalSeats.push({
        color,
        status: 'closed',
        displayName: `${capitalize(color)} (Closed)`,
      });
      continue;
    }

    if (rawSeat.status !== 'human' && rawSeat.status !== 'bot') {
      errors.push(`Invalid seat status '${rawSeat.status}' for ${color}. Must be 'human', 'bot', or 'closed'.`);
      continue;
    }

    // Name normalization: trim and max 32 chars
    let trimmedName = (rawSeat.displayName || '').trim();
    if (trimmedName.length > 32) {
      errors.push(`Display name for ${color} cannot exceed 32 characters.`);
    }

    if (!trimmedName) {
      if (rawSeat.status === 'human') {
        trimmedName = `${capitalize(color)} Player`;
      } else {
        const diff = rawSeat.botDifficulty || 'normal';
        trimmedName = `${capitalize(color)} Bot (${capitalize(diff)})`;
      }
    }

    let botDiff = rawSeat.botDifficulty;
    if (rawSeat.status === 'bot') {
      botDiff = botDiff || 'normal';
      if (!['easy', 'normal', 'hard'].includes(botDiff)) {
        errors.push(`Invalid botDifficulty '${botDiff}' for ${color}.`);
      }
    } else {
      botDiff = undefined;
    }

    canonicalSeats.push({
      color,
      status: rawSeat.status,
      displayName: trimmedName,
      botDifficulty: botDiff,
    });
  }

  const activeSeats = canonicalSeats.filter((s) => s.status !== 'closed');

  if (activeSeats.length < 2 || activeSeats.length > 4) {
    errors.push(`Match must have between 2 and 4 active seats, found ${activeSeats.length}.`);
  }

  // Requirement: at least one human player for normal offline play
  if (!allowBotOnly) {
    const hasHuman = activeSeats.some((s) => s.status === 'human');
    if (!hasHuman) {
      errors.push('Local match must contain at least one human player unless allowBotOnly is set.');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const config: LocalLudoMatchConfig = {
    sessionId,
    schemaVersion: 1,
    createdAt,
    seats: canonicalSeats as [LocalSeatConfig, LocalSeatConfig, LocalSeatConfig, LocalSeatConfig],
  };

  return { valid: true, config };
}

/**
 * Validates match configuration against rules.
 */
export function validateMatchConfig(
  config: LocalLudoMatchConfig | LocalLudoMatchInput,
  allowBotOnly: boolean = false
): { valid: boolean; errors: string[] } {
  const norm = normalizeMatchConfig(config, allowBotOnly);
  if (!norm.valid) {
    return { valid: false, errors: norm.errors };
  }
  return { valid: true, errors: [] };
}

/**
 * Performs strict bidirectional validation between persisted match config and engine state.
 * Rejects contradictory, corrupted, or tampered saves.
 */
export function crossValidateConfigAndEngine(
  config: LocalLudoMatchConfig,
  engineState: LudoState
): { valid: true } | { valid: false; error: string } {
  if (config.schemaVersion !== 1) {
    return { valid: false, error: `Unsupported schemaVersion: ${config.schemaVersion}` };
  }

  if (engineState.gameType !== 'ludo') {
    return { valid: false, error: `Invalid gameType in engineState: ${engineState.gameType}` };
  }

  const activeSeats = config.seats.filter((s) => s.status !== 'closed');
  const configActiveColors = activeSeats.map((s) => s.color);
  const engineActiveColors = engineState.activeColors;

  // Active colors must be identical in count and members
  if (configActiveColors.length !== engineActiveColors.length) {
    return {
      valid: false,
      error: `Active color count mismatch: config has ${configActiveColors.length}, engine has ${engineActiveColors.length}.`,
    };
  }

  for (const color of configActiveColors) {
    if (!engineActiveColors.includes(color)) {
      return {
        valid: false,
        error: `Engine activeColors is missing configured active color '${color}'.`,
      };
    }
  }

  // Validate every configured seat against engine player
  for (const seat of config.seats) {
    const enginePlayer = engineState.players[seat.color as PlayerColor];

    if (seat.status === 'closed') {
      if (enginePlayer !== null) {
        return {
          valid: false,
          error: `Closed seat '${seat.color}' must not have an active player in engineState.`,
        };
      }
      if (engineActiveColors.includes(seat.color)) {
        return {
          valid: false,
          error: `Closed seat '${seat.color}' appears in engineState.activeColors.`,
        };
      }
    } else {
      if (!enginePlayer) {
        return {
          valid: false,
          error: `Active seat '${seat.color}' is missing corresponding player in engineState.`,
        };
      }

      if (enginePlayer.type !== seat.status) {
        return {
          valid: false,
          error: `Player type mismatch for '${seat.color}': config specifies '${seat.status}', engine has '${enginePlayer.type}'.`,
        };
      }

      if (seat.status === 'bot') {
        const expectedDiff = seat.botDifficulty || 'normal';
        if (enginePlayer.botDifficulty !== expectedDiff) {
          return {
            valid: false,
            error: `Bot difficulty mismatch for '${seat.color}': config specifies '${expectedDiff}', engine has '${enginePlayer.botDifficulty}'.`,
          };
        }
      }
    }
  }

  // Validate currentTurn belongs to active seat
  if (engineState.status === 'playing' && engineState.currentTurn) {
    if (!configActiveColors.includes(engineState.currentTurn)) {
      return {
        valid: false,
        error: `Engine currentTurn '${engineState.currentTurn}' is not among configured active seats.`,
      };
    }
  }

  // Validate rankings only contain active seats
  for (const rankedColor of engineState.rankings) {
    if (!configActiveColors.includes(rankedColor)) {
      return {
        valid: false,
        error: `Engine rankings contains unconfigured or closed color '${rankedColor}'.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Authoritative controller for a single offline Ludo session.
 */
export class LocalLudoSession {
  private readonly config: LocalLudoMatchConfig;
  private readonly engine: LudoEngine;
  private readonly storage: LocalLudoStorage;
  private diceRoller: DiceRoller;
  private readonly botRng?: RngFn;
  private lastAction: LocalLudoActionResult | null = null;
  private lastHandoff: DeviceHandoffMetadata | null = null;
  private lastPersistenceWarning?: string;

  constructor(
    config: LocalLudoMatchConfig,
    engine: LudoEngine,
    options: LocalLudoSessionOptions = {}
  ) {
    this.config = config;
    this.engine = engine;
    this.storage = options.storage || new AsyncStorageLudoStorageAdapter();
    this.diceRoller = options.diceRoller || createStandardDiceRoller();
    this.botRng = options.botRng;
  }

  public getSessionId(): string {
    return this.config.sessionId;
  }

  public getConfig(): LocalLudoMatchConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  public getSeats(): [LocalSeatConfig, LocalSeatConfig, LocalSeatConfig, LocalSeatConfig] {
    return JSON.parse(JSON.stringify(this.config.seats));
  }

  public getActiveSeats(): LocalSeatConfig[] {
    return this.config.seats.filter((s) => s.status !== 'closed');
  }

  public getSeatForColor(color: PlayerColor | null): LocalSeatConfig | null {
    if (!color) return null;
    const seat = this.config.seats.find((s) => s.color === color);
    return seat ? JSON.parse(JSON.stringify(seat)) : null;
  }

  public setDiceRoller(roller: DiceRoller): void {
    this.diceRoller = roller;
  }

  /**
   * Returns complete reactive snapshot of current session state.
   */
  public getSnapshot(): LocalLudoSessionSnapshot {
    const engineState = this.engine.getState();
    const activeSeat = this.getSeatForColor(engineState.currentTurn);
    const isBot = activeSeat?.status === 'bot';

    return {
      sessionId: this.config.sessionId,
      status: engineState.status,
      turnPhase: engineState.turnPhase,
      currentTurn: engineState.currentTurn,
      currentRoll: engineState.currentRoll,
      consecutiveSixes: engineState.consecutiveSixes,
      legalMoves: engineState.legalMoves,
      rankings: engineState.rankings,
      winner: engineState.rankings.length > 0 ? engineState.rankings[0] : null,
      isBotTurn: Boolean(isBot && engineState.status === 'playing'),
      activePlayer: activeSeat,
      seats: this.getSeats(),
      engineState,
      handoff: this.lastHandoff,
      lastAction: this.lastAction,
    };
  }

  public isBotTurn(): boolean {
    const state = this.engine.getState();
    if (state.status !== 'playing' || !state.currentTurn) {
      return false;
    }
    const seat = this.getSeatForColor(state.currentTurn);
    return seat?.status === 'bot';
  }

  public getLegalMoves(): LegalMove[] {
    return this.engine.getLegalMoves();
  }

  /**
   * Evaluates if a turn transition requires handing the device to another human player.
   */
  private evaluateHandoff(
    prevTurn: PlayerColor | null,
    nextTurn: PlayerColor | null
  ): DeviceHandoffMetadata | null {
    if (!prevTurn || !nextTurn || prevTurn === nextTurn) {
      return null;
    }

    const prevSeat = this.getSeatForColor(prevTurn);
    const nextSeat = this.getSeatForColor(nextTurn);

    if (!prevSeat || !nextSeat) {
      return null;
    }

    // Handoff is only requested when transferring from human to a DIFFERENT human
    if (prevSeat.status === 'human' && nextSeat.status === 'human') {
      const displayName = nextSeat.displayName || `${capitalize(nextSeat.color)} Player`;
      return {
        needsHandoff: true,
        fromPlayer: prevSeat,
        toPlayer: nextSeat,
        message: `Pass the device to ${displayName} (${nextSeat.color})`,
      };
    }

    return null;
  }

  /**
   * Executes a dice roll for the current human player.
   * Roll value is determined authoritatively by the injected DiceRoller.
   * UI cannot choose or inject dice values.
   */
  public async rollDice(): Promise<LocalLudoRollResult> {
    const preState = this.engine.getState();

    if (preState.status !== 'playing') {
      throw new Error(`Cannot roll dice: game status is '${preState.status}'.`);
    }

    if (preState.turnPhase !== 'roll') {
      throw new Error('Cannot roll dice: already rolled. Must choose a move.');
    }

    const currentSeat = this.getSeatForColor(preState.currentTurn);
    if (currentSeat?.status === 'bot') {
      throw new Error('Cannot execute human roll during bot turn. Call performBotRoll() instead.');
    }

    const prevTurn = preState.currentTurn!;
    const diceValue = this.diceRoller.roll();
    const rollResult = this.engine.applyRoll(diceValue);

    if (!rollResult.success) {
      throw new Error(`Dice roll rejected: ${rollResult.error}`);
    }

    const postState = this.engine.getState();
    this.lastHandoff = this.evaluateHandoff(prevTurn, postState.currentTurn);

    const actionResult: LocalLudoRollResult = {
      type: 'ROLL',
      player: prevTurn,
      rolledValue: diceValue,
      legalMoves: rollResult.legalMoves || [],
      autoPass: Boolean(rollResult.autoPassed),
      threeSixesForfeit: Boolean(rollResult.forfeitedDueToThreeSixes),
      resultingTurn: postState.currentTurn,
      resultingPhase: postState.turnPhase,
      handoff: this.lastHandoff,
    };

    await this.persistSafe(actionResult);
    this.lastAction = actionResult;
    return actionResult;
  }

  /**
   * Executes a token move for the current human player.
   */
  public async moveToken(tokenId: number): Promise<LocalLudoMoveResult> {
    const preState = this.engine.getState();

    if (preState.status !== 'playing') {
      throw new Error(`Cannot move token: game status is '${preState.status}'.`);
    }

    if (preState.turnPhase !== 'move') {
      throw new Error('Cannot move token: must roll dice first.');
    }

    const currentSeat = this.getSeatForColor(preState.currentTurn);
    if (currentSeat?.status === 'bot') {
      throw new Error('Cannot execute human move during bot turn. Call performBotMove() instead.');
    }

    const playerColor = preState.currentTurn!;
    const prevTurn = playerColor;
    const moveResult = this.engine.makeMove(playerColor, tokenId);

    if (!moveResult.success) {
      throw new Error(`Illegal move: ${moveResult.error}`);
    }

    const postState = this.engine.getState();
    this.lastHandoff = this.evaluateHandoff(prevTurn, postState.currentTurn);

    const movedToken = moveResult.movedToken!;
    const traversedPositions = getTraversedPositions(
      playerColor,
      movedToken.fromProgress,
      movedToken.toProgress
    );
    const traversedCoordinates = getTraversedCoordinates(
      playerColor,
      movedToken.fromProgress,
      movedToken.toProgress
    );

    const actionResult: LocalLudoMoveResult = {
      type: 'MOVE',
      player: playerColor,
      tokenId,
      fromProgress: movedToken.fromProgress,
      toProgress: movedToken.toProgress,
      traversedPositions,
      traversedCoordinates,
      capturedTokens: (moveResult.capturedTokens || []).map((c) => ({
        color: c.color,
        tokenIndex: c.tokenIndex,
      })),
      reachedFinish: Boolean(moveResult.reachedFinish),
      playerRanked: Boolean(moveResult.playerRanked),
      rank: moveResult.playerRanked ? moveResult.playerRanked.rank : null,
      extraTurn: Boolean(moveResult.extraTurnGranted),
      extraTurnReason: moveResult.extraTurnReason || null,
      resultingTurn: postState.currentTurn,
      resultingPhase: postState.turnPhase,
      gameFinished: postState.status === 'finished',
      handoff: this.lastHandoff,
    };

    await this.persistSafe(actionResult);
    this.lastAction = actionResult;
    return actionResult;
  }

  /**
   * Executes discrete bot roll action.
   * Roll value is determined authoritatively by the injected DiceRoller.
   */
  public async performBotRoll(): Promise<LocalLudoRollResult> {
    const preState = this.engine.getState();

    if (preState.status !== 'playing') {
      throw new Error(`Cannot perform bot roll: game status is '${preState.status}'.`);
    }

    if (preState.turnPhase !== 'roll') {
      throw new Error('Cannot perform bot roll: game is in move phase.');
    }

    const currentSeat = this.getSeatForColor(preState.currentTurn);
    if (currentSeat?.status !== 'bot') {
      throw new Error('Current turn does not belong to a bot.');
    }

    const prevTurn = preState.currentTurn!;
    const diceValue = this.diceRoller.roll();
    const rollResult = this.engine.applyRoll(diceValue);

    if (!rollResult.success) {
      throw new Error(`Bot dice roll rejected: ${rollResult.error}`);
    }

    const postState = this.engine.getState();
    this.lastHandoff = this.evaluateHandoff(prevTurn, postState.currentTurn);

    const actionResult: LocalLudoRollResult = {
      type: 'ROLL',
      player: prevTurn,
      rolledValue: diceValue,
      legalMoves: rollResult.legalMoves || [],
      autoPass: Boolean(rollResult.autoPassed),
      threeSixesForfeit: Boolean(rollResult.forfeitedDueToThreeSixes),
      resultingTurn: postState.currentTurn,
      resultingPhase: postState.turnPhase,
      handoff: this.lastHandoff,
    };

    await this.persistSafe(actionResult);
    this.lastAction = actionResult;
    return actionResult;
  }

  /**
   * Executes discrete bot move action.
   */
  public async performBotMove(): Promise<LocalLudoMoveResult> {
    const preState = this.engine.getState();

    if (preState.status !== 'playing') {
      throw new Error(`Cannot perform bot move: game status is '${preState.status}'.`);
    }

    if (preState.turnPhase !== 'move') {
      throw new Error('Cannot perform bot move: must roll dice first.');
    }

    const currentSeat = this.getSeatForColor(preState.currentTurn);
    if (currentSeat?.status !== 'bot') {
      throw new Error('Current turn does not belong to a bot.');
    }

    const playerColor = preState.currentTurn!;
    const botDifficulty = currentSeat.botDifficulty || 'normal';
    const chosenMove = selectBotMove(preState, botDifficulty, this.botRng);

    if (!chosenMove) {
      throw new Error('Bot could not determine a legal move.');
    }

    const prevTurn = playerColor;
    const moveResult = this.engine.makeMove(playerColor, chosenMove.tokenIndex);

    if (!moveResult.success) {
      throw new Error(`Bot selected illegal move: ${moveResult.error}`);
    }

    const postState = this.engine.getState();
    this.lastHandoff = this.evaluateHandoff(prevTurn, postState.currentTurn);

    const movedToken = moveResult.movedToken!;
    const traversedPositions = getTraversedPositions(
      playerColor,
      movedToken.fromProgress,
      movedToken.toProgress
    );
    const traversedCoordinates = getTraversedCoordinates(
      playerColor,
      movedToken.fromProgress,
      movedToken.toProgress
    );

    const actionResult: LocalLudoMoveResult = {
      type: 'MOVE',
      player: playerColor,
      tokenId: chosenMove.tokenIndex,
      fromProgress: movedToken.fromProgress,
      toProgress: movedToken.toProgress,
      traversedPositions,
      traversedCoordinates,
      capturedTokens: (moveResult.capturedTokens || []).map((c) => ({
        color: c.color,
        tokenIndex: c.tokenIndex,
      })),
      reachedFinish: Boolean(moveResult.reachedFinish),
      playerRanked: Boolean(moveResult.playerRanked),
      rank: moveResult.playerRanked ? moveResult.playerRanked.rank : null,
      extraTurn: Boolean(moveResult.extraTurnGranted),
      extraTurnReason: moveResult.extraTurnReason || null,
      resultingTurn: postState.currentTurn,
      resultingPhase: postState.turnPhase,
      gameFinished: postState.status === 'finished',
      handoff: this.lastHandoff,
    };

    await this.persistSafe(actionResult);
    this.lastAction = actionResult;
    return actionResult;
  }

  /**
   * Convenience dispatcher executing either bot roll or bot move depending on phase.
   */
  public async performNextBotAction(): Promise<LocalLudoActionResult> {
    const snapshot = this.getSnapshot();
    if (!snapshot.isBotTurn) {
      throw new Error('Cannot execute bot action: not currently a bot turn.');
    }

    if (snapshot.turnPhase === 'roll') {
      return this.performBotRoll();
    } else {
      return this.performBotMove();
    }
  }

  /**
   * Persists session safely without aborting state on storage failure.
   */
  private async persistSafe(actionResult?: LocalLudoActionResult): Promise<void> {
    try {
      await this.save();
      this.lastPersistenceWarning = undefined;
    } catch (err: any) {
      const warning = `Persistence warning: ${err?.message || 'Storage save failed'}`;
      this.lastPersistenceWarning = warning;
      if (actionResult) {
        actionResult.persistenceWarning = warning;
      }
    }
  }

  /**
   * Authoritative save to persistent storage.
   */
  public async save(): Promise<void> {
    const envelope: LocalLudoSavedEnvelope = {
      schemaVersion: 1,
      sessionId: this.config.sessionId,
      savedAt: Date.now(),
      config: this.config,
      engineState: this.engine.getState(),
    };
    await this.storage.save(envelope);
  }

  /**
   * Explicitly removes current saved match.
   */
  public async clearSavedSession(): Promise<void> {
    await this.storage.remove();
  }
}

/**
 * Factory for creating a fresh offline Ludo session.
 */
export async function createLocalLudoSession(
  input: LocalLudoMatchConfig | LocalLudoMatchInput,
  options: LocalLudoSessionOptions = {}
): Promise<LocalLudoSession> {
  const norm = normalizeMatchConfig(input, options.allowBotOnly);
  if (!norm.valid) {
    throw new Error(`Invalid match configuration: ${norm.errors.join(', ')}`);
  }
  const config = norm.config;

  // Active seats in canonical clockwise order
  const activeSeats = config.seats.filter((s) => s.status !== 'closed');

  const playerConfigs: LudoPlayerInit[] = activeSeats.map((seat) => ({
    id: `local_${seat.color}`,
    color: seat.color,
    type: seat.status === 'bot' ? 'bot' : 'human',
    botDifficulty: seat.status === 'bot' ? (seat.botDifficulty || 'normal') : undefined,
    name: seat.displayName,
  }));

  const engine = LudoEngine.create({
    players: playerConfigs,
  });

  const session = new LocalLudoSession(config, engine, options);
  await session.save();
  return session;
}

/**
 * Inspects persistent storage and returns structured save status for Phase 2B UI.
 * Distinguishes cleanly between 'none', 'resumable', and 'corrupted'.
 * Does NOT delete corrupted data.
 */
export async function inspectSavedSession(
  storage: LocalLudoStorage
): Promise<SavedSessionInspection> {
  try {
    const envelope = await storage.load();
    if (!envelope) {
      return { status: 'none' };
    }

    if (!envelope || typeof envelope !== 'object') {
      return { status: 'corrupted', error: 'Saved envelope is malformed' };
    }

    if (envelope.schemaVersion !== 1) {
      return {
        status: 'corrupted',
        error: `Unsupported save schema version: ${envelope.schemaVersion}`,
      };
    }

    if (typeof envelope.sessionId !== 'string' || !envelope.sessionId.trim()) {
      return { status: 'corrupted', error: 'Missing or empty sessionId in envelope' };
    }

    if (!envelope.config || envelope.config.sessionId !== envelope.sessionId) {
      return { status: 'corrupted', error: 'Session ID mismatch between envelope and config' };
    }

    const configNorm = normalizeMatchConfig(envelope.config, true);
    if (!configNorm.valid) {
      return {
        status: 'corrupted',
        error: `Invalid match configuration in save: ${configNorm.errors.join(', ')}`,
      };
    }

    const engineValidation = validateLudoState(envelope.engineState);
    if (!engineValidation.valid) {
      return {
        status: 'corrupted',
        error: `Corrupted engine state: ${engineValidation.error}`,
      };
    }

    const crossVal = crossValidateConfigAndEngine(configNorm.config, envelope.engineState);
    if (!crossVal.valid) {
      return { status: 'corrupted', error: crossVal.error };
    }

    return {
      status: 'resumable',
      envelope: {
        ...envelope,
        config: configNorm.config,
      },
      sessionId: envelope.sessionId,
      savedAt: envelope.savedAt,
      activeSeats: configNorm.config.seats.filter((s) => s.status !== 'closed'),
      currentTurn: envelope.engineState.currentTurn,
      gameStatus: envelope.engineState.status,
    };
  } catch (err: any) {
    return {
      status: 'corrupted',
      error: `Storage inspection exception: ${err?.message || 'Unknown error'}`,
    };
  }
}

/**
 * Checks whether a resumable offline match exists in storage without throwing.
 */
export async function hasResumableSession(storage: LocalLudoStorage): Promise<boolean> {
  const inspection = await inspectSavedSession(storage);
  return inspection.status === 'resumable';
}

/**
 * Restores an offline Ludo session from persistent storage.
 * Does NOT execute bot actions during deserialization.
 */
export async function restoreLocalLudoSession(
  storage: LocalLudoStorage,
  options: LocalLudoSessionOptions = {}
): Promise<LocalLudoRestoreResult> {
  const inspection = await inspectSavedSession(storage);

  if (inspection.status === 'none') {
    return { success: false, error: 'No saved match found in storage.' };
  }

  if (inspection.status === 'corrupted') {
    return { success: false, error: inspection.error, isCorrupted: true };
  }

  const envelope = inspection.envelope;
  const engine = LudoEngine.fromState(envelope.engineState);
  const session = new LocalLudoSession(envelope.config, engine, {
    ...options,
    storage,
  });

  return { success: true, session };
}

/**
 * Explicitly clears the saved offline match.
 */
export async function clearSavedSession(storage: LocalLudoStorage): Promise<void> {
  await storage.remove();
}
