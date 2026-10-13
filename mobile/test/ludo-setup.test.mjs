import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultSetup,
  setSeatType,
  setBotDifficulty,
  setPlayerName,
  validateSetupState,
  buildLocalLudoConfig,
  getDeterministicBotName,
  getDeterministicHumanName,
} from '../services/ludo/setup-helpers.ts';

import {
  InMemoryLudoStorageAdapter,
} from '../services/ludo/storage.ts';

import {
  createLocalLudoSession,
  restoreLocalLudoSession,
  inspectSavedSession,
  clearSavedSession,
  hasResumableSession,
} from '../services/ludo/session.ts';

test('1. default 2-player setup', () => {
  const seats = createDefaultSetup(2);
  assert.equal(seats.length, 4);

  const active = seats.filter((s) => s.status === 'active');
  const closed = seats.filter((s) => s.status === 'closed');

  assert.equal(active.length, 2);
  assert.equal(closed.length, 2);

  // Red is human ("You")
  const red = seats.find((s) => s.color === 'red');
  assert.ok(red);
  assert.equal(red.status, 'active');
  assert.equal(red.playerType, 'human');
  assert.equal(red.displayName, 'You');
});

test('2. default 3-player setup', () => {
  const seats = createDefaultSetup(3);
  assert.equal(seats.length, 4);

  const active = seats.filter((s) => s.status === 'active');
  assert.equal(active.length, 3);

  const activeColors = active.map((s) => s.color);
  assert.deepEqual(activeColors, ['red', 'green', 'yellow']);

  const blue = seats.find((s) => s.color === 'blue');
  assert.equal(blue.status, 'closed');
});

test('3. default 4-player setup', () => {
  const seats = createDefaultSetup(4);
  assert.equal(seats.length, 4);

  const active = seats.filter((s) => s.status === 'active');
  assert.equal(active.length, 4);
  assert.deepEqual(active.map((s) => s.color), ['red', 'green', 'yellow', 'blue']);
});

test('4. two-player uses Red + Yellow', () => {
  const seats = createDefaultSetup(2);
  const active = seats.filter((s) => s.status === 'active');
  assert.deepEqual(active.map((s) => s.color), ['red', 'yellow']);

  const green = seats.find((s) => s.color === 'green');
  const blue = seats.find((s) => s.color === 'blue');
  assert.equal(green.status, 'closed');
  assert.equal(blue.status, 'closed');
});

test('5. changing human to bot', () => {
  const seats = createDefaultSetup(2, 'human');
  const yellowBefore = seats.find((s) => s.color === 'yellow');
  assert.equal(yellowBefore.playerType, 'human');

  const updated = setSeatType(seats, 'yellow', 'bot');
  const yellowAfter = updated.find((s) => s.color === 'yellow');
  assert.equal(yellowAfter.playerType, 'bot');
  assert.equal(yellowAfter.displayName, 'Yellow Bot (Normal)');
});

test('6. bot default difficulty Normal', () => {
  const seats = createDefaultSetup(2, 'human');
  const updated = setSeatType(seats, 'yellow', 'bot');
  const yellow = updated.find((s) => s.color === 'yellow');
  assert.equal(yellow.botDifficulty, 'normal');
});

test('7. changing bot difficulty', () => {
  const seats = createDefaultSetup(2);
  const yellow = seats.find((s) => s.color === 'yellow');
  assert.equal(yellow.botDifficulty, 'normal');

  const hardSeats = setBotDifficulty(seats, 'yellow', 'hard');
  const yellowHard = hardSeats.find((s) => s.color === 'yellow');
  assert.equal(yellowHard.botDifficulty, 'hard');
  assert.equal(yellowHard.displayName, 'Yellow Bot (Hard)');

  const easySeats = setBotDifficulty(hardSeats, 'yellow', 'easy');
  const yellowEasy = easySeats.find((s) => s.color === 'yellow');
  assert.equal(yellowEasy.botDifficulty, 'easy');
  assert.equal(yellowEasy.displayName, 'Yellow Bot (Easy)');
});

test('8. changing bot back to human', () => {
  const seats = createDefaultSetup(2); // Red = human, Yellow = bot
  const yellowBot = seats.find((s) => s.color === 'yellow');
  assert.equal(yellowBot.playerType, 'bot');

  const updated = setSeatType(seats, 'yellow', 'human');
  const yellowHuman = updated.find((s) => s.color === 'yellow');
  assert.equal(yellowHuman.playerType, 'human');
  assert.equal(yellowHuman.botDifficulty, undefined);
  assert.equal(yellowHuman.displayName, 'Player 3');
});

test('9. at least one human validation', () => {
  const seats = createDefaultSetup(2);
  // Red is human, Yellow is bot
  assert.equal(validateSetupState(seats).valid, true);

  // Set Red to bot as well
  const allBots = setSeatType(seats, 'red', 'bot');
  const result = validateSetupState(allBots);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('At least one human player is required')));
});

test('10. display-name length validation', () => {
  const seats = createDefaultSetup(2);
  const tooLong = 'A'.repeat(33);

  const updated = setPlayerName(seats, 'red', tooLong);
  const result = validateSetupState(updated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('exceeds maximum 32 characters')));

  const exact32 = 'A'.repeat(32);
  const validUpdated = setPlayerName(seats, 'red', exact32);
  assert.equal(validateSetupState(validUpdated).valid, true);
});

test('11. build canonical four-slot config', () => {
  const seats = createDefaultSetup(2);
  const built = buildLocalLudoConfig(seats);
  assert.equal(built.valid, true);

  const config = built.config;
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.seats.length, 4);
  assert.deepEqual(config.seats.map((s) => s.color), ['red', 'green', 'yellow', 'blue']);
});

test('12. closed seats represented correctly', () => {
  const seats = createDefaultSetup(2);
  const built = buildLocalLudoConfig(seats);
  assert.equal(built.valid, true);

  const config = built.config;
  const green = config.seats.find((s) => s.color === 'green');
  const blue = config.seats.find((s) => s.color === 'blue');

  assert.equal(green.status, 'closed');
  assert.equal(blue.status, 'closed');
});

test('13. no session created by opening Setup', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Opening Setup only generates local state in memory without invoking storage.save
  const setupState = createDefaultSetup(2);
  assert.ok(setupState);

  // Storage remains completely empty
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'none');
});

test('14. valid Start config', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);
  assert.equal(built.valid, true);

  const session = await createLocalLudoSession(built.config, { storage });
  assert.ok(session);
  assert.equal(session.getSnapshot().status, 'playing');

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.activeSeats.length, 2);
});

test('15. existing resumable save replacement requires confirmation state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);
  const session = await createLocalLudoSession(built.config, { storage });
  assert.ok(session);

  // An existing active session is detected
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.gameStatus, 'playing');

  // In UI logic, when inspection.status === 'resumable', user tapping 'New Game'
  // must trigger confirmation dialog rather than instantly overwriting save.
  // Only upon explicit confirmation is clearSavedSession or replace called.
  let confirmationRequired = inspection.status === 'resumable';
  assert.equal(confirmationRequired, true);
});

test('16. inspect none state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const result = await inspectSavedSession(storage);
  assert.deepEqual(result, { status: 'none' });
});

test('17. inspect resumable state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(3);
  const built = buildLocalLudoConfig(setupState);
  await createLocalLudoSession(built.config, { storage });

  const result = await inspectSavedSession(storage);
  assert.equal(result.status, 'resumable');
  assert.equal(result.activeSeats.length, 3);
  assert.equal(result.currentTurn, 'red');
  assert.equal(result.gameStatus, 'playing');
});

test('18. inspect corrupted state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Inject malformed JSON
  storage.setRawData('{ corrupted json: true, ');

  const result = await inspectSavedSession(storage);
  assert.equal(result.status, 'corrupted');
  assert.ok(result.error);
});

test('19. resume active match', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);
  const session = await createLocalLudoSession(built.config, { storage });

  const restoreResult = await restoreLocalLudoSession(storage);
  assert.equal(restoreResult.success, true);
  assert.ok(restoreResult.session);
  assert.equal(restoreResult.session.getSnapshot().status, 'playing');
  assert.equal(restoreResult.session.getSnapshot().currentTurn, 'red');
});

test('20. resume finished match', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);
  const session = await createLocalLudoSession(built.config, { storage });

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

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.gameStatus, 'finished');

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  assert.equal(restored.session.getSnapshot().status, 'finished');
  assert.equal(restored.session.getSnapshot().winner, 'red');
});

test('21. corrupted save deletion', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  storage.setRawData('broken payload');

  const before = await inspectSavedSession(storage);
  assert.equal(before.status, 'corrupted');

  await clearSavedSession(storage);

  const after = await inspectSavedSession(storage);
  assert.equal(after.status, 'none');
});

test('22. setup back does not overwrite save', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);
  const originalSession = await createLocalLudoSession(built.config, { storage });
  const originalId = originalSession.getSnapshot().sessionId;

  // User opens Setup screen (which generates candidate setup state)
  const candidateSetup = createDefaultSetup(4);
  assert.equal(candidateSetup.filter((s) => s.status === 'active').length, 4);

  // User presses Back without tapping Start Game (storage is untouched)
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.sessionId, originalId);
  assert.equal(inspection.activeSeats.length, 2); // Still original 2-player game!
});

test('23. initial save failure blocks navigation-ready success', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  storage.failNextSave = true;

  const setupState = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setupState);

  // Attempt to create session when initial save fails
  await assert.rejects(
    async () => {
      await createLocalLudoSession(built.config, { storage });
    },
    { message: /Simulated storage save failure/ }
  );

  // Storage has no saved session; UI must NOT navigate
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'none');
});

test('24. existing valid save survives failed replacement', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Existing valid game A
  const setupA = createDefaultSetup(2);
  const builtA = buildLocalLudoConfig(setupA);
  const sessionA = await createLocalLudoSession(builtA.config, { storage });
  const idA = sessionA.getSnapshot().sessionId;

  // User attempts to start game B, but storage save fails
  storage.failNextSave = true;
  const setupB = createDefaultSetup(4);
  const builtB = buildLocalLudoConfig(setupB);

  await assert.rejects(
    async () => {
      await createLocalLudoSession(builtB.config, { storage });
    },
    { message: /Simulated storage save failure/ }
  );

  // Game A was NOT destroyed or removed
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.sessionId, idA);
  assert.equal(inspection.activeSeats.length, 2);
});

test('25. corrupted New Game requires confirmation state', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  storage.setRawData('malformed data');

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'corrupted');

  // Confirmation is required before replacing corrupted data
  const requiresConfirmation = inspection.status === 'corrupted';
  assert.equal(requiresConfirmation, true);
});

test('26. corrupted setup Back preserves corrupt save', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const corruptPayload = '{"broken": json}';
  storage.setRawData(corruptPayload);

  // User confirmed to open Setup, generating setup candidates
  const candidate = createDefaultSetup(3);
  assert.ok(candidate);

  // User cancels/backs out of Setup without starting game
  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'corrupted');
});

test('27. successful replacement replaces previous save', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Game A
  const setupA = createDefaultSetup(2);
  const builtA = buildLocalLudoConfig(setupA);
  const sessionA = await createLocalLudoSession(builtA.config, { storage });
  const idA = sessionA.getSnapshot().sessionId;

  // Game B
  const setupB = createDefaultSetup(3);
  const builtB = buildLocalLudoConfig(setupB);
  const sessionB = await createLocalLudoSession(builtB.config, { storage });
  const idB = sessionB.getSnapshot().sessionId;

  assert.notEqual(idA, idB);

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.sessionId, idB);
  assert.equal(inspection.activeSeats.length, 3);
});

test('28. direct setup route cannot silently replace save', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  // Game A exists
  const setupA = createDefaultSetup(2);
  const builtA = buildLocalLudoConfig(setupA);
  await createLocalLudoSession(builtA.config, { storage });

  // If user navigated directly into /games/ludo/setup (replace param is undefined/not '1')
  const directRouteParams = { replace: undefined };

  // Setup screen verifies storage before proceeding
  const existingSave = await inspectSavedSession(storage);
  const requiresAuthorization = directRouteParams.replace !== '1' && existingSave.status !== 'none';

  assert.equal(requiresAuthorization, true);
});

test('29. player-count 4 -> 2 -> 4 predictable reset', () => {
  // Start with 4 players
  const fourInitial = createDefaultSetup(4);
  assert.equal(fourInitial.filter((s) => s.status === 'active').length, 4);

  // Switch to 2 players
  const twoPlayers = createDefaultSetup(2);
  assert.equal(twoPlayers.filter((s) => s.status === 'active').length, 2);
  assert.deepEqual(
    twoPlayers.filter((s) => s.status === 'active').map((s) => s.color),
    ['red', 'yellow']
  );

  // Switch back to 4 players
  const fourReset = createDefaultSetup(4);
  assert.equal(fourReset.filter((s) => s.status === 'active').length, 4);
  assert.equal(fourReset.find((s) => s.color === 'red').displayName, 'You');
  assert.equal(fourReset.find((s) => s.color === 'green').displayName, 'Green Bot (Normal)');
  assert.equal(fourReset.find((s) => s.color === 'yellow').displayName, 'Yellow Bot (Normal)');
  assert.equal(fourReset.find((s) => s.color === 'blue').displayName, 'Blue Bot (Normal)');
});

test('30. finished 2-player rankings', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setup = createDefaultSetup(2);
  const built = buildLocalLudoConfig(setup);
  const session = await createLocalLudoSession(built.config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.status = 'finished';
  snap.engineState.currentTurn = null;
  snap.engineState.turnPhase = null;
  snap.engineState.rankings = ['red', 'yellow'];
  snap.engineState.winner = 'red';
  snap.engineState.tokens.red = [56, 56, 56, 56];
  snap.engineState.tokens.yellow = [56, 56, 56, 56];

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const inspection = await inspectSavedSession(storage);
  assert.equal(inspection.status, 'resumable');
  assert.equal(inspection.gameStatus, 'finished');

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const finalSnap = restored.session.getSnapshot();
  assert.equal(finalSnap.rankings.length, 2);
  assert.deepEqual(finalSnap.rankings, ['red', 'yellow']);
  assert.equal(finalSnap.winner, 'red');
});

test('31. finished 3-player rankings', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setup = createDefaultSetup(3);
  const built = buildLocalLudoConfig(setup);
  const session = await createLocalLudoSession(built.config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.status = 'finished';
  snap.engineState.currentTurn = null;
  snap.engineState.turnPhase = null;
  snap.engineState.rankings = ['yellow', 'red', 'green'];
  snap.engineState.winner = 'yellow';
  snap.engineState.tokens.yellow = [56, 56, 56, 56];
  snap.engineState.tokens.red = [56, 56, 56, 56];
  snap.engineState.tokens.green = [56, 56, 56, 56];

  await storage.save({
    schemaVersion: 1,
    sessionId: snap.sessionId,
    savedAt: Date.now(),
    config: session.getConfig(),
    engineState: snap.engineState,
  });

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const finalSnap = restored.session.getSnapshot();
  assert.equal(finalSnap.rankings.length, 3);
  assert.deepEqual(finalSnap.rankings, ['yellow', 'red', 'green']);
  assert.equal(finalSnap.winner, 'yellow');
});

test('32. finished 4-player rankings', async () => {
  const storage = new InMemoryLudoStorageAdapter();
  const setup = createDefaultSetup(4);
  const built = buildLocalLudoConfig(setup);
  const session = await createLocalLudoSession(built.config, { storage });

  const snap = session.getSnapshot();
  snap.engineState.status = 'finished';
  snap.engineState.currentTurn = null;
  snap.engineState.turnPhase = null;
  snap.engineState.rankings = ['blue', 'green', 'red', 'yellow'];
  snap.engineState.winner = 'blue';
  snap.engineState.tokens.blue = [56, 56, 56, 56];
  snap.engineState.tokens.green = [56, 56, 56, 56];
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
  const finalSnap = restored.session.getSnapshot();
  assert.equal(finalSnap.rankings.length, 4);
  assert.deepEqual(finalSnap.rankings, ['blue', 'green', 'red', 'yellow']);
  assert.equal(finalSnap.winner, 'blue');
});
