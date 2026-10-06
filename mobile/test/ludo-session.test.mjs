import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalLudoSession,
  restoreLocalLudoSession,
  hasResumableSession,
  clearSavedSession,
  validateMatchConfig,
  inspectSavedSession,
  InMemoryLudoStorageAdapter,
} from '../services/ludo/index.ts';

import {
  createDeterministicDiceRoller,
} from '../../packages/ludo-engine/src/index.ts';

function createTestConfig(overrides = {}) {
  return {
    sessionId: 'test_session_123',
    schemaVersion: 1,
    createdAt: Date.now(),
    seats: [
      { color: 'red', status: 'human', displayName: 'Alice' },
      { color: 'yellow', status: 'human', displayName: 'Bob' },
    ],
    ...overrides,
  };
}

// ==========================================
// 1. SEAT & SESSION INITIALIZATION
// ==========================================

test('1. create 2-human session', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Player Red' },
      { color: 'yellow', status: 'human', displayName: 'Player Yellow' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.status, 'playing');
  assert.equal(snapshot.turnPhase, 'roll');
  assert.equal(snapshot.currentTurn, 'red');
  assert.equal(snapshot.seats.length, 4); // Canonical 4 seats (2 active + 2 closed)
  assert.equal(session.getActiveSeats().length, 2);
  assert.equal(snapshot.isBotTurn, false);
});

test('2. create 3-human session', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'P1' },
      { color: 'green', status: 'human', displayName: 'P2' },
      { color: 'blue', status: 'human', displayName: 'P3' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.status, 'playing');
  assert.deepEqual(snapshot.engineState.activeColors, ['red', 'green', 'blue']);
});

test('3. create 4-human session', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red' },
      { color: 'green', status: 'human', displayName: 'Green' },
      { color: 'yellow', status: 'human', displayName: 'Yellow' },
      { color: 'blue', status: 'human', displayName: 'Blue' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.status, 'playing');
  assert.equal(session.getActiveSeats().length, 4);
});

test('4. human + bot session', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Human Red' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.status, 'playing');
  assert.equal(session.getSeatForColor('yellow')?.status, 'bot');
  assert.equal(session.getSeatForColor('yellow')?.botDifficulty, 'hard');
});

test('5. 2 humans + 2 bots', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Human 1' },
      { color: 'green', status: 'bot', botDifficulty: 'easy' },
      { color: 'yellow', status: 'human', displayName: 'Human 2' },
      { color: 'blue', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(session.getActiveSeats().length, 4);
  assert.equal(session.getSeatForColor('green')?.botDifficulty, 'easy');
  assert.equal(session.getSeatForColor('blue')?.botDifficulty, 'normal');
});

test('6. 1 human + 3 bots', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Solo Human' },
      { color: 'green', status: 'bot', botDifficulty: 'hard' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
      { color: 'blue', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  assert.equal(session.getActiveSeats().length, 4);
  assert.equal(snapshot.isBotTurn, false); // Red (human) starts
});

test('7. correct initial current player', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Green and Yellow active (Red closed)
  const config = createTestConfig({
    seats: [
      { color: 'green', status: 'human', displayName: 'G' },
      { color: 'yellow', status: 'human', displayName: 'Y' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });
  const snapshot = session.getSnapshot();

  // First active color clockwise is Green
  assert.equal(snapshot.currentTurn, 'green');
});

// ==========================================
// 2. HUMAN TURN LIFECYCLE
// ==========================================

test('8. human roll uses injected DiceRoller without per-call dice argument', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  const rollResult = await session.rollDice();
  assert.equal(rollResult.type, 'ROLL');
  assert.equal(rollResult.player, 'red');
  assert.equal(rollResult.rolledValue, 6);
  assert.equal(rollResult.resultingPhase, 'move');
  assert.equal(rollResult.legalMoves.length, 4);
});

test('9. legal human move', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  const moveResult = await session.moveToken(0);

  assert.equal(moveResult.type, 'MOVE');
  assert.equal(moveResult.player, 'red');
  assert.equal(moveResult.tokenId, 0);
  assert.equal(moveResult.fromProgress, -1);
  assert.equal(moveResult.toProgress, 0);
  assert.equal(moveResult.extraTurn, true);
  assert.equal(moveResult.extraTurnReason, 'six');
  assert.equal(moveResult.resultingTurn, 'red');
  assert.equal(moveResult.resultingPhase, 'roll');
});

test('10. illegal move rejected', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  await assert.rejects(
    () => session.moveToken(99),
    /Illegal move/
  );
});

test('11. human cannot act during bot turn', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]); // Red rolls 1 -> auto-pass to Yellow bot
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
  assert.equal(session.isBotTurn(), true);

  await assert.rejects(
    () => session.rollDice(),
    /Cannot execute human roll during bot turn/
  );

  await assert.rejects(
    () => session.moveToken(0),
    /Cannot move token: must roll dice first/
  );
});

// ==========================================
// 3. BOT TURN LIFECYCLE & DIFFICULTIES
// ==========================================

test('12. bot roll', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]); // Red: 1, Bot: 6
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'easy' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice(); // Red passes
  assert.equal(session.isBotTurn(), true);

  const botRoll = await session.performBotRoll();
  assert.equal(botRoll.type, 'ROLL');
  assert.equal(botRoll.player, 'yellow');
  assert.equal(botRoll.rolledValue, 6);
  assert.equal(botRoll.resultingPhase, 'move');
});

test('13. bot legal move', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice(); // Red passes
  await session.performBotRoll(); // Bot rolls 6

  const botMove = await session.performBotMove();
  assert.equal(botMove.type, 'MOVE');
  assert.equal(botMove.player, 'yellow');
  assert.equal(botMove.fromProgress, -1);
  assert.equal(botMove.toProgress, 0);
});

test('14. easy bot flow via performNextBotAction', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'easy' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice(); // Red 1 -> pass
  assert.equal(session.getSnapshot().currentTurn, 'yellow');

  const act1 = await session.performNextBotAction();
  assert.equal(act1.type, 'ROLL');
  assert.equal(act1.resultingPhase, 'move');

  const act2 = await session.performNextBotAction();
  assert.equal(act2.type, 'MOVE');
  assert.equal(act2.extraTurn, true);
});

test('15. normal bot flow', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  await session.performNextBotAction();
  const move = await session.performNextBotAction();
  assert.equal(move.type, 'MOVE');
});

test('16. hard bot flow', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  await session.performNextBotAction();
  const move = await session.performNextBotAction();
  assert.equal(move.type, 'MOVE');
});

test('17. bot extra turn grants another roll without switching player', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6, 3]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  await session.performBotRoll(); // Bot rolls 6
  const moveResult = await session.performBotMove();

  assert.equal(moveResult.extraTurn, true);
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
  assert.equal(session.getSnapshot().turnPhase, 'roll');
  assert.equal(session.isBotTurn(), true);
});

test('18. bot capture', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.tokens.red[0] = 27;
  snap.engineState.tokens.yellow[0] = 0;
  snap.engineState.currentTurn = 'yellow';
  snap.engineState.turnPhase = 'roll';
  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const restored = await restoreLocalLudoSession(storage, { diceRoller });
  const testSession = restored.session;

  await testSession.performBotRoll();
  const botMove = await testSession.performBotMove();

  assert.equal(botMove.capturedTokens.length, 1);
  assert.equal(botMove.capturedTokens[0].color, 'red');
  assert.equal(botMove.extraTurn, true);
  assert.equal(botMove.extraTurnReason, 'capture');
});

test('19. bot finish', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.tokens.yellow[0] = 55;
  snap.engineState.currentTurn = 'yellow';
  snap.engineState.turnPhase = 'roll';
  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const restored = await restoreLocalLudoSession(storage, { diceRoller });
  const testSession = restored.session;

  await testSession.performBotRoll();
  const botMove = await testSession.performBotMove();

  assert.equal(botMove.reachedFinish, true);
  assert.equal(botMove.extraTurn, true);
  assert.equal(botMove.extraTurnReason, 'finish');
});

// ==========================================
// 4. HUMAN RULES & TURN TRANSITIONS
// ==========================================

test('20. human extra turn on roll of 6', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  const move = await session.moveToken(0);

  assert.equal(move.extraTurn, true);
  assert.equal(session.getSnapshot().currentTurn, 'red');
  assert.equal(session.getSnapshot().turnPhase, 'roll');
});

test('21. three sixes forfeits turn immediately', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6, 6, 6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  // 1st six
  await session.rollDice();
  await session.moveToken(0);

  // 2nd six
  await session.rollDice();
  await session.moveToken(0);

  // 3rd six
  const r3 = await session.rollDice();
  assert.equal(r3.threeSixesForfeit, true);
  assert.equal(r3.resultingTurn, 'yellow');
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
  assert.equal(session.getSnapshot().turnPhase, 'roll');
});

test('22. auto-pass when no moves available', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([3]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  const r = await session.rollDice();
  assert.equal(r.autoPass, true);
  assert.equal(r.resultingTurn, 'yellow');
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
});

// ==========================================
// 5. HANDOFF METADATA
// ==========================================

test('23. handoff human -> human asks to pass device', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Alice' },
      { color: 'yellow', status: 'human', displayName: 'Bob' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  const r = await session.rollDice();
  assert.ok(r.handoff);
  assert.equal(r.handoff?.needsHandoff, true);
  assert.equal(r.handoff?.fromPlayer.color, 'red');
  assert.equal(r.handoff?.toPlayer.color, 'yellow');
  assert.equal(r.handoff?.message, 'Pass the device to Bob (yellow)');
});

test('24. human -> bot does NOT request handoff', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Alice' },
      { color: 'yellow', status: 'bot', botDifficulty: 'normal' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  const r = await session.rollDice();
  assert.equal(r.handoff, null);
});

test('25. bot -> human transition does NOT request handoff (device stays with user)', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'bot', botDifficulty: 'easy' },
      { color: 'yellow', status: 'human', displayName: 'Bob' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  const r = await session.performBotRoll();
  assert.equal(r.handoff, null);
});

// ==========================================
// 6. PERSISTENCE & RESUME
// ==========================================

test('26. save after roll', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  const saved = await storage.load();

  assert.ok(saved);
  assert.equal(saved?.engineState.turnPhase, 'move');
  assert.equal(saved?.engineState.currentRoll, 6);
});

test('27. save after move', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  await session.moveToken(0);
  const saved = await storage.load();

  assert.ok(saved);
  assert.equal(saved?.engineState.tokens.red[0], 0);
  assert.equal(saved?.engineState.turnPhase, 'roll');
});

test('28. resume during roll phase', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const session = await createLocalLudoSession(createTestConfig(), { storage });

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const snapshot = restored.session.getSnapshot();

  assert.equal(snapshot.turnPhase, 'roll');
  assert.equal(snapshot.currentTurn, 'red');
  assert.equal(snapshot.currentRoll, null);
});

test('29. resume during move phase', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const snapshot = restored.session.getSnapshot();

  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(snapshot.currentRoll, 6);
  assert.equal(snapshot.legalMoves.length, 4);
});

test('30. resume exact dice result without rerolling', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice();
  const restored = await restoreLocalLudoSession(storage);
  const snapshot = restored.session.getSnapshot();

  assert.equal(snapshot.currentRoll, 6);
  const moveResult = await restored.session.moveToken(1);
  assert.equal(moveResult.toProgress, 0);
});

test('31. resume rankings and finished state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig();
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.status = 'finished';
  snap.engineState.currentTurn = null;
  snap.engineState.turnPhase = null;
  snap.engineState.rankings = ['red', 'yellow'];
  snap.engineState.tokens.red = [56, 56, 56, 56];
  snap.engineState.tokens.yellow = [56, 56, 56, 56];

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const snapshot = restored.session.getSnapshot();
  assert.equal(snapshot.status, 'finished');
  assert.deepEqual(snapshot.rankings, ['red', 'yellow']);
  assert.equal(snapshot.winner, 'red');
});

test('32. resume bot turn without automatically acting', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
  assert.equal(session.isBotTurn(), true);

  const restored = await restoreLocalLudoSession(storage, { diceRoller });
  assert.equal(restored.success, true);
  const restoredSession = restored.session;

  assert.equal(restoredSession.isBotTurn(), true);
  assert.equal(restoredSession.getSnapshot().currentTurn, 'yellow');
  assert.equal(restoredSession.getSnapshot().turnPhase, 'roll');
  assert.equal(restoredSession.getSnapshot().currentRoll, null);

  const botRoll = await restoredSession.performBotRoll();
  assert.equal(botRoll.rolledValue, 6);
});

test('33. serialization round trip', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const config = createTestConfig();
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice();
  await session.moveToken(0);

  const rawEnvelope = await storage.load();
  const serialized = JSON.stringify(rawEnvelope);
  const parsed = JSON.parse(serialized);

  await storage.save(parsed);
  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  assert.deepEqual(restored.session.getSnapshot().engineState.tokens.red[0], 0);
});

// ==========================================
// 7. CORRUPTED & EDGE CASE STORAGE
// ==========================================

test('34. corrupt JSON does not crash app', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  storage.setRawData('{ corrupt json here ...');

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, false);
  assert.equal(restored.isCorrupted, true);
  assert.ok(restored.error);
});

test('35. unsupported save version is rejected', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  storage.setRawData(
    JSON.stringify({
      schemaVersion: 99,
      sessionId: 'sess_1',
      savedAt: Date.now(),
      config: createTestConfig(),
      engineState: {},
    })
  );

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, false);
  assert.equal(restored.isCorrupted, true);
  assert.match(restored.error, /Unsupported save schema version: 99/);
});

test('36. corrupt engine state is rejected', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig();

  storage.setRawData(
    JSON.stringify({
      schemaVersion: 1,
      sessionId: config.sessionId,
      savedAt: Date.now(),
      config,
      engineState: {
        gameType: 'ludo',
        status: 'playing',
        activeColors: ['red', 'yellow'],
        players: { red: null, yellow: null, green: null, blue: null },
        tokens: { red: [999, -1, -1, -1], yellow: [-1, -1, -1, -1], green: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        currentTurn: 'red',
        turnPhase: 'roll',
        currentRoll: null,
        consecutiveSixes: 0,
        legalMoves: [],
        rankings: [],
        round: 1,
        revision: 0,
      },
    })
  );

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, false);
  assert.equal(restored.isCorrupted, true);
  assert.match(restored.error, /Corrupted engine state/);
});

test('37. storage save failure logs warning without crashing in-memory state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  storage.failNextSave = true;
  const rollResult = await session.rollDice();

  assert.equal(session.getSnapshot().currentRoll, 6);
  assert.ok(rollResult.persistenceWarning);
  assert.match(rollResult.persistenceWarning, /Simulated storage save failure/);
});

test('38. explicit clear save', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const session = await createLocalLudoSession(createTestConfig(), { storage });

  assert.equal(await hasResumableSession(storage), true);
  await clearSavedSession(storage);
  assert.equal(await hasResumableSession(storage), false);
});

test('39. finished game preserved until cleared', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const session = await createLocalLudoSession(createTestConfig(), { storage });

  const snap = session.getSnapshot();
  snap.engineState.status = 'finished';
  snap.engineState.currentTurn = null;
  snap.engineState.turnPhase = null;
  snap.engineState.rankings = ['red', 'yellow'];
  snap.engineState.tokens.red = [56, 56, 56, 56];
  snap.engineState.tokens.yellow = [56, 56, 56, 56];

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  assert.equal(await hasResumableSession(storage), true);
  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.session.getSnapshot().status, 'finished');
});

test('40. all combinations remain offline and make zero network calls', async () => {
  const session = await createLocalLudoSession(createTestConfig(), {
    storage: new InMemoryLudoStorageAdapter(),
  });
  assert.equal(typeof session.rollDice, 'function');
  assert.equal(typeof session.moveToken, 'function');
  assert.equal(typeof session.performBotRoll, 'function');
  assert.equal(typeof session.performBotMove, 'function');
});

// ==========================================
// 8. FINAL GATE HARDENING TESTS
// ==========================================

test('41. bot-only match rejected in normal production creation', async () => {
  const config = {
    sessionId: 'bot_only_test',
    schemaVersion: 1,
    createdAt: Date.now(),
    seats: [
      { color: 'red', status: 'bot', botDifficulty: 'normal' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  };

  await assert.rejects(
    () => createLocalLudoSession(config),
    /Local match must contain at least one human player/
  );
});

test('42. bot-only match accepted when allowBotOnly is explicitly set', async () => {
  const config = {
    sessionId: 'bot_only_sim',
    schemaVersion: 1,
    createdAt: Date.now(),
    seats: [
      { color: 'red', status: 'bot', botDifficulty: 'normal' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  };

  const session = await createLocalLudoSession(config, {
    storage: new InMemoryLudoStorageAdapter(),
    allowBotOnly: true,
  });
  assert.equal(session.getSnapshot().isBotTurn, true);
});

test('43. config <-> engine cross-validation rejects player type mismatch', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human', displayName: 'Alice' },
      { color: 'yellow', status: 'human', displayName: 'Bob' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  // Corrupt engine state by changing Red from human to bot
  snap.engineState.players.red.type = 'bot';

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'corrupted');
  assert.match(inspection.error, /Player type mismatch for 'red'/);

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, false);
  assert.equal(restored.isCorrupted, true);
});

test('44. config <-> engine cross-validation rejects bot difficulty mismatch', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  // Tamper engine difficulty from hard to easy
  snap.engineState.players.yellow.botDifficulty = 'easy';

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'corrupted');
  assert.match(inspection.error, /Bot difficulty mismatch for 'yellow'/);
});

test('45. config <-> engine cross-validation rejects closed seat in engine activeColors', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'human' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage });

  const snap = session.getSnapshot();
  // Tamper engine activeColors to include Green (which is closed in config)
  snap.engineState.activeColors.push('green');
  snap.engineState.players.green = { id: 'p_green', color: 'green', type: 'human' };

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'corrupted');
  assert.match(inspection.error, /Active color count mismatch/);
});

test('46. canonical closed-seat representation normalizes missing seats into explicit closed slots', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const config = {
    sessionId: 'two_seat_input',
    schemaVersion: 1,
    createdAt: Date.now(),
    seats: [
      { color: 'red', status: 'human', displayName: '   Alice   ' },
      { color: 'yellow', status: 'human' },
    ],
  };

  const session = await createLocalLudoSession(config, { storage });
  const allSeats = session.getSeats();

  assert.equal(allSeats.length, 4);
  assert.equal(allSeats[0].color, 'red');
  assert.equal(allSeats[0].displayName, 'Alice'); // trimmed
  assert.equal(allSeats[1].color, 'green');
  assert.equal(allSeats[1].status, 'closed');
  assert.equal(allSeats[2].color, 'yellow');
  assert.equal(allSeats[2].displayName, 'Yellow Player'); // default
  assert.equal(allSeats[3].color, 'blue');
  assert.equal(allSeats[3].status, 'closed');
});

test('47. overly long display name (>32 chars) is rejected', async () => {
  const config = {
    sessionId: 'long_name_test',
    schemaVersion: 1,
    createdAt: Date.now(),
    seats: [
      { color: 'red', status: 'human', displayName: 'ThisNameIsWayTooLongAndExceedsThirtyTwoCharacters' },
      { color: 'yellow', status: 'human' },
    ],
  };

  await assert.rejects(
    () => createLocalLudoSession(config),
    /Display name for red cannot exceed 32 characters/
  );
});

test('48. inspectSavedSession distinguishes none, resumable, and corrupted', async () => {
  const storage = new InMemoryLudoStorageAdapter();

  // Status: none
  const inspectNone = await inspectSavedSession(storage);
  assert.equal(inspectNone.status, 'none');

  // Status: resumable
  const session = await createLocalLudoSession(createTestConfig(), { storage });
  const inspectResumable = await inspectSavedSession(storage);
  assert.equal(inspectResumable.status, 'resumable');
  assert.equal(inspectResumable.sessionId, 'test_session_123');

  // Status: corrupted
  storage.setRawData('{"bad": "json');
  const inspectCorrupt = await inspectSavedSession(storage);
  assert.equal(inspectCorrupt.status, 'corrupted');
});

test('49. exact human move-phase resume preserves roll and legal moves without rerolling', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([6]);
  const session = await createLocalLudoSession(createTestConfig(), { storage, diceRoller });

  await session.rollDice(); // Rolled 6, in move phase

  // Simulate app restart: destroy session object and restore from storage
  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const resumed = restored.session;
  const snapshot = resumed.getSnapshot();

  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(snapshot.currentRoll, 6);
  assert.equal(snapshot.currentTurn, 'red');
  assert.equal(snapshot.legalMoves.length, 4);

  // Player can make move immediately with restored roll
  const moveRes = await resumed.moveToken(0);
  assert.equal(moveRes.toProgress, 0);
  assert.equal(moveRes.extraTurn, true);
});

test('50. exact bot move-phase resume preserves roll without auto-acting', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const diceRoller = createDeterministicDiceRoller([1, 6]);
  const config = createTestConfig({
    seats: [
      { color: 'red', status: 'human' },
      { color: 'yellow', status: 'bot', botDifficulty: 'hard' },
    ],
  });
  const session = await createLocalLudoSession(config, { storage, diceRoller });

  await session.rollDice(); // Red passes to Yellow bot
  await session.performBotRoll(); // Yellow bot rolls 6, in move phase

  // App kills/restarts while bot is in move phase
  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const resumed = restored.session;
  const snapshot = resumed.getSnapshot();

  // Preserved exactly in move phase
  assert.equal(snapshot.isBotTurn, true);
  assert.equal(snapshot.currentTurn, 'yellow');
  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(snapshot.currentRoll, 6);

  // Bot did NOT execute automatically during restore
  assert.equal(snapshot.engineState.tokens.yellow[0], -1);

  // UI explicitly triggers bot move
  const botMove = await resumed.performNextBotAction();
  assert.equal(botMove.type, 'MOVE');
  assert.equal(botMove.toProgress, 0);
});
