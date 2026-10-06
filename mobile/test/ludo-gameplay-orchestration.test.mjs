import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalLudoSession,
  restoreLocalLudoSession,
} from '../services/ludo/index.ts';

import {
  canHumanRoll,
  isBoardInteractive,
  isTokenSelectable,
  determineNextBotAction,
  shouldShowHandoff,
  formatActionStatusMessage,
  formatTurnStatus,
  getRankingsDisplay,
} from '../components/games/ludo/ludo-orchestration.ts';

import {
  buildLudoBoardViewModel,
} from '../components/games/ludo/board-view-model.ts';

// In-memory storage mock
class MemoryStorage {
  constructor() {
    this.data = null;
  }
  async save(envelope) {
    this.data = JSON.parse(JSON.stringify(envelope));
  }
  async load() {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }
  async remove() {
    this.data = null;
  }
}

// Deterministic dice roller
function createDeterministicRoller(rolls) {
  let idx = 0;
  return {
    roll: () => {
      const val = rolls[idx % rolls.length];
      idx += 1;
      return val;
    },
  };
}

test('1. human roll-phase shows Roll', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage() });

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.turnPhase, 'roll');
  assert.equal(snapshot.currentTurn, 'red');
  assert.equal(canHumanRoll(snapshot, false, false), true);
});

test('2. human move-phase hides Roll', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(canHumanRoll(snapshot, false, false), false);
});

test('3. only legal tokens selectable', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const snapshot = session.getSnapshot();
  // With roll 6, tokens at home are legal to leave home
  assert.equal(isTokenSelectable('red', 0, snapshot, false, false), true);
  assert.equal(isTokenSelectable('red', 1, snapshot, false, false), true);

  const vm = buildLudoBoardViewModel(snapshot);
  const redToken0 = vm.tokens.find((t) => t.color === 'red' && t.tokenIndex === 0);
  assert.equal(redToken0.isSelectable, true);
});

test('4. illegal token not selectable', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const snapshot = session.getSnapshot();
  // Yellow token is NOT selectable during Red turn
  assert.equal(isTokenSelectable('yellow', 0, snapshot, false, false), false);

  const vm = buildLudoBoardViewModel(snapshot);
  const yellowToken0 = vm.tokens.find((t) => t.color === 'yellow' && t.tokenIndex === 0);
  assert.equal(yellowToken0.isSelectable, false);
});

test('5. roll updates dice display value', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  const preSnapshot = session.getSnapshot();
  assert.equal(preSnapshot.currentRoll, null);

  const rollResult = await session.rollDice();
  assert.equal(rollResult.rolledValue, 6);

  const postSnapshot = session.getSnapshot();
  assert.equal(postSnapshot.currentRoll, 6);
});

test('6. resume move-phase preserves dice', async () => {
  const storage = new MemoryStorage();
  const roller = createDeterministicRoller([6]);
  const session1 = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage, diceRoller: roller });

  await session1.rollDice();

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const snapshot = restored.session.getSnapshot();

  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(snapshot.currentRoll, 6);
  assert.equal(canHumanRoll(snapshot, false, false), false);
  assert.equal(isBoardInteractive(snapshot, false, false), true);
});

test('7. auto-pass transition', async () => {
  // Rolling 3 when all tokens at home causes auto-pass to next player
  const roller = createDeterministicRoller([3]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  const result = await session.rollDice();
  assert.equal(result.autoPass, true);
  assert.equal(result.resultingTurn, 'yellow');
  assert.equal(result.resultingPhase, 'roll');

  const msg = formatActionStatusMessage(result);
  assert.match(msg, /no legal moves/i);
});

test('8. three-sixes transition', async () => {
  const roller = createDeterministicRoller([6, 6, 6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  await session.moveToken(0); // Leaves home

  await session.rollDice();
  await session.moveToken(0); // Advances 6

  const thirdRoll = await session.rollDice();
  assert.equal(thirdRoll.threeSixesForfeit, true);
  assert.equal(thirdRoll.resultingTurn, 'yellow');

  const msg = formatActionStatusMessage(thirdRoll);
  assert.match(msg, /three sixes/i);
});

test('9. extra turn returns same player to roll', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const moveRes = await session.moveToken(0);
  assert.equal(moveRes.extraTurn, true);
  assert.equal(moveRes.resultingTurn, 'red');
  assert.equal(moveRes.resultingPhase, 'roll');

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.currentTurn, 'red');
  assert.equal(canHumanRoll(snapshot, false, false), true);

  const msg = formatActionStatusMessage(moveRes);
  assert.match(msg, /roll again/i);
});

test('10. human -> human requires handoff', async () => {
  const roller = createDeterministicRoller([2]); // Auto-pass from red to yellow
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  const result = await session.rollDice();
  assert.notEqual(result.handoff, null);
  assert.equal(result.handoff.needsHandoff, true);
  assert.equal(result.handoff.toPlayer.color, 'yellow');

  const snapshot = session.getSnapshot();
  assert.equal(shouldShowHandoff(snapshot), true);
});

test('11. human -> bot no handoff', async () => {
  const roller = createDeterministicRoller([2]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'bot', displayName: 'Yellow Bot' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  const result = await session.rollDice();
  assert.equal(result.handoff, null);

  const snapshot = session.getSnapshot();
  assert.equal(shouldShowHandoff(snapshot), false);
});

test('12. same human extra turn no handoff', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const moveRes = await session.moveToken(0);
  assert.equal(moveRes.extraTurn, true);
  assert.equal(moveRes.handoff, null);

  const snapshot = session.getSnapshot();
  assert.equal(shouldShowHandoff(snapshot), false);
});

test('13. auto-pass human -> human handoff', async () => {
  const roller = createDeterministicRoller([1]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Player 1' },
      { color: 'yellow', status: 'human', displayName: 'Player 2' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  const roll = await session.rollDice();
  assert.equal(roll.autoPass, true);
  assert.notEqual(roll.handoff, null);
  assert.equal(roll.handoff.needsHandoff, true);
  assert.equal(roll.handoff.toPlayer.color, 'yellow');
});

test('14. three-sixes human -> human handoff', async () => {
  const roller = createDeterministicRoller([6, 6, 6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Player 1' },
      { color: 'yellow', status: 'human', displayName: 'Player 2' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  await session.moveToken(0);
  await session.rollDice();
  await session.moveToken(0);
  const roll3 = await session.rollDice();

  assert.equal(roll3.threeSixesForfeit, true);
  assert.notEqual(roll3.handoff, null);
  assert.equal(roll3.handoff.needsHandoff, true);
  assert.equal(roll3.handoff.toPlayer.color, 'yellow');
});

test('15. bot roll phase chooses BOT_ROLL', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'bot', displayName: 'Red Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage: new MemoryStorage(), allowBotOnly: true });

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.isBotTurn, true);
  assert.equal(snapshot.turnPhase, 'roll');
  assert.equal(determineNextBotAction(snapshot, false, false), 'BOT_ROLL');
});

test('16. bot move phase chooses BOT_MOVE', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'bot', displayName: 'Red Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller, allowBotOnly: true });

  await session.performBotRoll();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.isBotTurn, true);
  assert.equal(snapshot.turnPhase, 'move');
  assert.equal(determineNextBotAction(snapshot, false, false), 'BOT_MOVE');
});

test('17. finished game schedules no bot action', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'bot', displayName: 'Red Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage: new MemoryStorage(), allowBotOnly: true });

  const snapshot = {
    ...session.getSnapshot(),
    status: 'finished',
  };
  assert.equal(determineNextBotAction(snapshot, false, false), null);
});

test('18. handoff blocks input', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage() });

  const snapshot = session.getSnapshot();
  assert.equal(canHumanRoll(snapshot, false, true), false);
  assert.equal(isBoardInteractive(snapshot, false, true), false);
  assert.equal(isTokenSelectable('red', 0, snapshot, false, true), false);
});

test('19. busy blocks roll', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage() });

  const snapshot = session.getSnapshot();
  assert.equal(canHumanRoll(snapshot, true, false), false);
});

test('20. busy blocks token press', async () => {
  const roller = createDeterministicRoller([6]);
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage(), diceRoller: roller });

  await session.rollDice();
  const snapshot = session.getSnapshot();
  assert.equal(isTokenSelectable('red', 0, snapshot, true, false), false);
  assert.equal(isBoardInteractive(snapshot, true, false), false);
});

test('21. finished blocks all board input', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Player' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Player' },
    ],
  }, { storage: new MemoryStorage() });

  const finishedSnapshot = {
    ...session.getSnapshot(),
    status: 'finished',
  };
  assert.equal(canHumanRoll(finishedSnapshot, false, false), false);
  assert.equal(isBoardInteractive(finishedSnapshot, false, false), false);
  assert.equal(isTokenSelectable('red', 0, finishedSnapshot, false, false), false);
});

test('22. persistence warning presentation', () => {
  const rollWithWarning = {
    type: 'ROLL',
    player: 'red',
    rolledValue: 5,
    legalMoves: [],
    autoPass: false,
    threeSixesForfeit: false,
    resultingTurn: 'red',
    resultingPhase: 'move',
    handoff: null,
    persistenceWarning: 'Storage write failed',
  };
  const msg = formatActionStatusMessage(rollWithWarning);
  assert.equal(msg, 'Rolled a 5');
});

test('23. 2-player finished ranking', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Alice' },
      { color: 'yellow', status: 'bot', displayName: 'Bob Bot' },
    ],
  }, { storage: new MemoryStorage() });

  const mockSnapshot = {
    ...session.getSnapshot(),
    status: 'finished',
    rankings: ['red', 'yellow'],
  };
  const ranks = getRankingsDisplay(mockSnapshot);
  assert.equal(ranks.length, 2);
  assert.equal(ranks[0].rank, 1);
  assert.equal(ranks[0].displayName, 'Alice');
  assert.equal(ranks[0].isBot, false);
  assert.equal(ranks[1].rank, 2);
  assert.equal(ranks[1].displayName, 'Bob Bot');
  assert.equal(ranks[1].isBot, true);
});

test('24. 3-player finished ranking', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Player 1' },
      { color: 'green', status: 'human', displayName: 'Player 2' },
      { color: 'yellow', status: 'bot', displayName: 'Player 3' },
    ],
  }, { storage: new MemoryStorage() });

  const mockSnapshot = {
    ...session.getSnapshot(),
    status: 'finished',
    rankings: ['green', 'yellow', 'red'],
  };
  const ranks = getRankingsDisplay(mockSnapshot);
  assert.equal(ranks.length, 3);
  assert.equal(ranks[0].color, 'green');
  assert.equal(ranks[1].color, 'yellow');
  assert.equal(ranks[2].color, 'red');
});

test('25. 4-player finished ranking', async () => {
  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'R' },
      { color: 'green', status: 'human', displayName: 'G' },
      { color: 'yellow', status: 'human', displayName: 'Y' },
      { color: 'blue', status: 'bot', displayName: 'B' },
    ],
  }, { storage: new MemoryStorage() });

  const mockSnapshot = {
    ...session.getSnapshot(),
    status: 'finished',
    rankings: ['blue', 'red', 'green', 'yellow'],
  };
  const ranks = getRankingsDisplay(mockSnapshot);
  assert.equal(ranks.length, 4);
  assert.equal(ranks[0].color, 'blue');
  assert.equal(ranks[0].rank, 1);
  assert.equal(ranks[3].color, 'yellow');
  assert.equal(ranks[3].rank, 4);
});

test('26. Complete deterministic local session simulation: Human Red + Bot Yellow', async () => {
  const storage = new MemoryStorage();
  // Rolls: Red rolls 6, moves out, gets extra turn; Red rolls 3, advances 3;
  // Yellow bot rolls 6, moves out, gets extra turn; Yellow bot rolls 2, advances 2;
  const rolls = [6, 3, 6, 2];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Human Red' },
      { color: 'yellow', status: 'bot', displayName: 'Yellow Bot', botDifficulty: 'normal' },
    ],
  }, { storage, diceRoller: roller });

  // 1. Initial state
  assert.equal(session.getSnapshot().currentTurn, 'red');
  assert.equal(session.getSnapshot().turnPhase, 'roll');

  // 2. Red human rolls 6
  const redRoll1 = await session.rollDice();
  assert.equal(redRoll1.rolledValue, 6);
  assert.equal(session.getSnapshot().turnPhase, 'move');

  // 3. Red moves token 0 out of home
  const redMove1 = await session.moveToken(0);
  assert.equal(redMove1.extraTurn, true);
  assert.equal(session.getSnapshot().currentTurn, 'red');
  assert.equal(session.getSnapshot().turnPhase, 'roll');

  // 4. Red human rolls 3
  const redRoll2 = await session.rollDice();
  assert.equal(redRoll2.rolledValue, 3);
  assert.equal(session.getSnapshot().turnPhase, 'move');

  // 5. Red moves token 0 by 3
  const redMove2 = await session.moveToken(0);
  assert.equal(redMove2.extraTurn, false);
  assert.equal(session.getSnapshot().currentTurn, 'yellow');
  assert.equal(session.getSnapshot().isBotTurn, true);

  // 6. Yellow bot rolls 6
  assert.equal(determineNextBotAction(session.getSnapshot(), false, false), 'BOT_ROLL');
  const botRoll1 = await session.performBotRoll();
  assert.equal(botRoll1.rolledValue, 6);
  assert.equal(session.getSnapshot().turnPhase, 'move');

  // 7. Yellow bot moves
  assert.equal(determineNextBotAction(session.getSnapshot(), false, false), 'BOT_MOVE');
  const botMove1 = await session.performBotMove();
  assert.equal(botMove1.extraTurn, true);
  assert.equal(session.getSnapshot().currentTurn, 'yellow');

  // 8. Yellow bot rolls 2
  const botRoll2 = await session.performBotRoll();
  assert.equal(botRoll2.rolledValue, 2);

  // 9. Yellow bot moves 2
  const botMove2 = await session.performBotMove();
  assert.equal(botMove2.extraTurn, false);
  assert.equal(session.getSnapshot().currentTurn, 'red');
  assert.equal(session.getSnapshot().isBotTurn, false);

  // 10. Verify storage was persisted throughout
  const savedData = await storage.load();
  assert.notEqual(savedData, null);
  assert.equal(savedData.engineState.currentTurn, 'red');
});

test('27. Complete 2 humans pass-device transition simulation', async () => {
  const storage = new MemoryStorage();
  // Rolls: Red rolls 6, moves; Red rolls 2, moves; Yellow turn triggers handoff;
  const rolls = [6, 2, 4];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Player Red' },
      { color: 'yellow', status: 'human', displayName: 'Player Yellow' },
    ],
  }, { storage, diceRoller: roller });

  // Red roll 6
  await session.rollDice();
  await session.moveToken(0); // Extra turn

  // Red roll 2
  await session.rollDice();
  const redMove2 = await session.moveToken(0); // Transitions to Yellow

  assert.notEqual(redMove2.handoff, null);
  assert.equal(redMove2.handoff.needsHandoff, true);
  assert.equal(redMove2.handoff.toPlayer.color, 'yellow');
  assert.equal(shouldShowHandoff(session.getSnapshot()), true);

  // Yellow player taps I'M READY
  session.clearHandoff();
  assert.equal(shouldShowHandoff(session.getSnapshot()), false);

  // Now Yellow can roll
  assert.equal(canHumanRoll(session.getSnapshot(), false, false), true);
  const yellowRoll = await session.rollDice();
  assert.equal(yellowRoll.rolledValue, 4);
});

test('28. Multi-capture messaging', () => {
  // 1 captured
  const singleCap = {
    type: 'MOVE',
    player: 'red',
    tokenId: 0,
    fromProgress: 10,
    toProgress: 15,
    traversedPositions: [],
    traversedCoordinates: [],
    capturedTokens: [{ color: 'green', tokenIndex: 0 }],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: false,
    extraTurnReason: null,
    resultingTurn: 'yellow',
    resultingPhase: 'roll',
    gameFinished: false,
    handoff: null,
  };
  assert.equal(formatActionStatusMessage(singleCap), 'Captured Green token');

  // 2 same-color captured
  const doubleCap = {
    ...singleCap,
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'green', tokenIndex: 1 },
    ],
  };
  assert.equal(formatActionStatusMessage(doubleCap), 'Captured 2 Green tokens');

  // 3 same-color captured
  const tripleCap = {
    ...singleCap,
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'green', tokenIndex: 1 },
      { color: 'green', tokenIndex: 2 },
    ],
  };
  assert.equal(formatActionStatusMessage(tripleCap), 'Captured 3 Green tokens');

  // Mixed colors captured
  const mixedCap = {
    ...singleCap,
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'blue', tokenIndex: 1 },
    ],
  };
  assert.equal(formatActionStatusMessage(mixedCap), 'Captured 2 tokens');
});

test('29. Flow A: Human Red -> Bot Green -> Human Yellow handoff', async () => {
  const storage = new MemoryStorage();
  // Red rolls 2 (auto-passes to Green Bot)
  // Green Bot rolls 2 (auto-passes to Yellow Human)
  const rolls = [2, 2];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'green', status: 'bot', displayName: 'Green Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  assert.equal(session.getDeviceHolder(), 'red');

  // Red rolls 2 -> auto-passes to Green Bot. Red still holds device!
  const redRoll = await session.rollDice();
  assert.equal(redRoll.autoPass, true);
  assert.equal(session.getSnapshot().currentTurn, 'green');
  assert.equal(session.getSnapshot().handoff, null); // No handoff to bot

  // Green Bot rolls 2 -> auto-passes to Yellow Human
  const botRoll = await session.performBotRoll();
  assert.equal(botRoll.autoPass, true);
  assert.equal(session.getSnapshot().currentTurn, 'yellow');

  // Because device was held by Red and turn is now Yellow Human, handoff MUST appear!
  assert.notEqual(session.getSnapshot().handoff, null);
  assert.equal(session.getSnapshot().handoff.needsHandoff, true);
  assert.equal(session.getSnapshot().handoff.toPlayer.color, 'yellow');
  assert.equal(shouldShowHandoff(session.getSnapshot()), true);
});

test('30. Flow B: Human Red -> Bot Green -> Human Red (no handoff)', async () => {
  const storage = new MemoryStorage();
  // Red rolls 2 (auto-passes to Green Bot)
  // Green Bot rolls 2 (auto-passes back to Red Human)
  const rolls = [2, 2];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'green', status: 'bot', displayName: 'Green Bot' },
    ],
  }, { storage, diceRoller: roller });

  assert.equal(session.getDeviceHolder(), 'red');

  // Red rolls 2 -> auto-passes to Green Bot
  await session.rollDice();
  assert.equal(session.getSnapshot().handoff, null);

  // Green Bot rolls 2 -> auto-passes to Red Human
  const botRoll = await session.performBotRoll();
  assert.equal(botRoll.autoPass, true);
  assert.equal(session.getSnapshot().currentTurn, 'red');

  // Device was held by Red and it returned to Red. NO handoff!
  assert.equal(session.getSnapshot().handoff, null);
  assert.equal(shouldShowHandoff(session.getSnapshot()), false);
});

test('31. Flow C: Human Red -> Bot Green -> Bot Yellow -> Human Blue handoff', async () => {
  const storage = new MemoryStorage();
  // 4 players: Red Human, Green Bot, Yellow Bot, Blue Human
  // Red auto-passes to Green, Green auto-passes to Yellow, Yellow auto-passes to Blue
  const rolls = [2, 2, 2];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'green', status: 'bot', displayName: 'Green Bot' },
      { color: 'yellow', status: 'bot', displayName: 'Yellow Bot' },
      { color: 'blue', status: 'human', displayName: 'Blue Human' },
    ],
  }, { storage, diceRoller: roller });

  assert.equal(session.getDeviceHolder(), 'red');

  await session.rollDice(); // Red -> Green
  assert.equal(session.getSnapshot().handoff, null);

  await session.performBotRoll(); // Green -> Yellow
  assert.equal(session.getSnapshot().handoff, null);

  await session.performBotRoll(); // Yellow -> Blue
  assert.equal(session.getSnapshot().currentTurn, 'blue');

  // Blue is human and different from Red holder -> handoff to Blue!
  assert.notEqual(session.getSnapshot().handoff, null);
  assert.equal(session.getSnapshot().handoff.needsHandoff, true);
  assert.equal(session.getSnapshot().handoff.toPlayer.color, 'blue');
  assert.equal(shouldShowHandoff(session.getSnapshot()), true);
});

test('32. Flow D: Human Red auto-pass -> Human Yellow handoff', async () => {
  const storage = new MemoryStorage();
  const roller = createDeterministicRoller([3]);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  const roll = await session.rollDice();
  assert.equal(roll.autoPass, true);
  assert.equal(roll.resultingTurn, 'yellow');
  assert.notEqual(roll.handoff, null);
  assert.equal(roll.handoff.needsHandoff, true);
  assert.equal(roll.handoff.toPlayer.color, 'yellow');
});

test('33. Flow E: Human Red third-six forfeit -> Human Yellow handoff', async () => {
  const storage = new MemoryStorage();
  const roller = createDeterministicRoller([6, 6, 6]);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  await session.rollDice();
  await session.moveToken(0);
  await session.rollDice();
  await session.moveToken(0);
  const roll3 = await session.rollDice();

  assert.equal(roll3.threeSixesForfeit, true);
  assert.equal(roll3.resultingTurn, 'yellow');
  assert.notEqual(roll3.handoff, null);
  assert.equal(roll3.handoff.needsHandoff, true);
  assert.equal(roll3.handoff.toPlayer.color, 'yellow');
});

test('34. Flow F: Bot auto-pass -> another human holder-based handoff', async () => {
  const storage = new MemoryStorage();
  // Red Human, Green Bot, Yellow Human
  // Red rolls 6, moves out -> then rolls 2 (auto-pass not possible since token on track, let's roll 2 and move token)
  // Then Green Bot rolls 1 (all tokens at home -> auto-pass) -> Yellow Human!
  const rolls = [6, 2, 1];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'green', status: 'bot', displayName: 'Green Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  // Red rolls 6, moves out
  await session.rollDice();
  await session.moveToken(0);

  // Red rolls 2, moves forward -> Green Bot
  await session.rollDice();
  await session.moveToken(0);
  assert.equal(session.getSnapshot().currentTurn, 'green');

  // Green Bot rolls 1 with all tokens home -> auto-pass to Yellow Human!
  const botRoll = await session.performBotRoll();
  assert.equal(botRoll.autoPass, true);
  assert.equal(session.getSnapshot().currentTurn, 'yellow');

  // Handoff to Yellow
  assert.notEqual(session.getSnapshot().handoff, null);
  assert.equal(session.getSnapshot().handoff.needsHandoff, true);
  assert.equal(session.getSnapshot().handoff.toPlayer.color, 'yellow');
});

test('35. Resume during bot turn with holder Red', async () => {
  const storage = new MemoryStorage();
  const rolls = [2, 2];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'green', status: 'bot', displayName: 'Green Bot' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  // Red rolls 2 -> advances to Green Bot
  await session.rollDice();
  assert.equal(session.getSnapshot().currentTurn, 'green');

  // Simulate app restart: restore from storage
  const restored = await restoreLocalLudoSession(storage, { diceRoller: roller });
  assert.equal(restored.success, true);
  const restoredSession = restored.session;

  assert.equal(restoredSession.getDeviceHolder(), 'red');
  assert.equal(restoredSession.getSnapshot().currentTurn, 'green');

  // Green Bot completes roll and auto-passes to Yellow
  const botRoll = await restoredSession.performBotRoll();
  assert.equal(botRoll.autoPass, true);
  assert.equal(restoredSession.getSnapshot().currentTurn, 'yellow');

  // Yellow must receive handoff!
  assert.notEqual(restoredSession.getSnapshot().handoff, null);
  assert.equal(restoredSession.getSnapshot().handoff.needsHandoff, true);
  assert.equal(restoredSession.getSnapshot().handoff.toPlayer.color, 'yellow');
});

test('36. Resume move phase for Yellow after Yellow acknowledged', async () => {
  const storage = new MemoryStorage();
  const rolls = [2, 6];
  const roller = createDeterministicRoller(rolls);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  // Red rolls 2 -> auto-pass to Yellow
  await session.rollDice();
  assert.equal(session.getSnapshot().currentTurn, 'yellow');

  // Yellow acknowledges handoff
  await session.acknowledgeHandoff();
  assert.equal(session.getDeviceHolder(), 'yellow');

  // Yellow rolls 6 -> move phase
  await session.rollDice();
  assert.equal(session.getSnapshot().turnPhase, 'move');

  // App restarts: restore from storage
  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  const restoredSession = restored.session;

  assert.equal(restoredSession.getDeviceHolder(), 'yellow');
  assert.equal(restoredSession.getSnapshot().currentTurn, 'yellow');
  assert.equal(restoredSession.getSnapshot().turnPhase, 'move');
  assert.equal(restoredSession.getSnapshot().currentRoll, 6);
  // No unnecessary handoff on screen load!
  assert.equal(shouldShowHandoff(restoredSession.getSnapshot()), false);
});

test('37. Finished match strictly blocks handoff', () => {
  const finishedSnapshot = {
    sessionId: 'session_test',
    status: 'finished',
    turnPhase: null,
    currentTurn: null,
    currentRoll: null,
    consecutiveSixes: 0,
    legalMoves: [],
    rankings: ['red', 'yellow'],
    winner: 'red',
    isBotTurn: false,
    activePlayer: null,
    seats: [
      { color: 'red', status: 'human', displayName: 'Red' },
      { color: 'yellow', status: 'human', displayName: 'Yellow' },
      { color: 'green', status: 'closed', displayName: 'Green' },
      { color: 'blue', status: 'closed', displayName: 'Blue' },
    ],
    engineState: {},
    handoff: {
      needsHandoff: true,
      fromPlayer: { color: 'red', status: 'human', displayName: 'Red' },
      toPlayer: { color: 'yellow', status: 'human', displayName: 'Yellow' },
      message: 'Pass the device',
    },
    lastAction: null,
  };

  assert.equal(shouldShowHandoff(finishedSnapshot), false);
});

test('38. I\'M READY semantics authoritatively update holder and persist', async () => {
  const storage = new MemoryStorage();
  const roller = createDeterministicRoller([2]);

  const session = await createLocalLudoSession({
    seats: [
      { color: 'red', status: 'human', displayName: 'Red Human' },
      { color: 'yellow', status: 'human', displayName: 'Yellow Human' },
    ],
  }, { storage, diceRoller: roller });

  assert.equal(session.getDeviceHolder(), 'red');

  // Red rolls 2 -> handoff to Yellow
  await session.rollDice();
  assert.equal(shouldShowHandoff(session.getSnapshot()), true);

  // Yellow acknowledges handoff
  await session.acknowledgeHandoff();
  assert.equal(session.getDeviceHolder(), 'yellow');
  assert.equal(session.getSnapshot().handoff, null);
  assert.equal(shouldShowHandoff(session.getSnapshot()), false);

  // Check persisted storage reflects deviceHolderColor
  const saved = await storage.load();
  assert.equal(saved.deviceHolderColor, 'yellow');
});
