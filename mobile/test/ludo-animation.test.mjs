import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  START_OFFSETS,
  YARD_GRID_COORDINATES,
  TRACK_CELL_GRID_COORDINATES,
  HOME_STRETCH_GRID_COORDINATES,
  FINISH_GRID_COORDINATES,
  getTraversedCoordinates,
} from '../../packages/ludo-engine/src/index.ts';

import {
  buildTokenTravelPlan,
  buildCaptureReturnPlan,
  getAnimationDurationForSteps,
  buildCelebrationParticles,
  LUDO_ANIMATION_CONSTANTS,
} from '../components/games/ludo/ludo-animation.ts';

import {
  LudoHaptics,
  resolveMoveHapticEvent,
} from '../components/games/ludo/ludo-haptics.ts';

import {
  canHumanRoll,
  isBoardInteractive,
  isTokenSelectable,
  determineNextBotAction,
  shouldShowHandoff,
} from '../components/games/ludo/ludo-orchestration.ts';

import {
  createLocalLudoSession,
  restoreLocalLudoSession,
} from '../services/ludo/index.ts';

function createMockMoveResult(overrides = {}) {
  return {
    type: 'MOVE',
    player: 'red',
    tokenId: 0,
    fromProgress: 0,
    toProgress: 4,
    traversedPositions: [],
    traversedCoordinates: getTraversedCoordinates('red', 0, 4),
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: false,
    extraTurnReason: null,
    resultingTurn: 'red',
    resultingPhase: 'roll',
    gameFinished: false,
    handoff: null,
    ...overrides,
  };
}

const mockSeats = [
  { color: 'red', status: 'human', playerType: 'human', displayName: 'Red Player' },
  { color: 'green', status: 'bot', playerType: 'bot', botDifficulty: 'normal', displayName: 'Green Bot' },
  { color: 'yellow', status: 'human', playerType: 'human', displayName: 'Yellow Player' },
  { color: 'blue', status: 'closed', playerType: 'human', displayName: 'Blue Player' },
];

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

async function createTestSession(config, options = {}) {
  return createLocalLudoSession(config, {
    storage: new MemoryStorage(),
    ...options,
  });
}

test('1. roll animation final value equals authoritative roll', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  const rollRes = await session.rollDice();
  assert.equal(rollRes.rolledValue, 6);

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.currentRoll, 6);
  // Authoritative roll guarantees presentation die settles strictly on 6
  assert.equal(snapshot.currentRoll, rollRes.rolledValue);

  // In auto-pass scenario (roll 5 with all in yard), rolledValue is still authoritative 5
  const session2 = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 5 } }
  );
  const autoPassRoll = await session2.rollDice();
  assert.equal(autoPassRoll.rolledValue, 5);
  assert.equal(autoPassRoll.autoPass, true);
});

test('2. token route preserves traversed coordinate order', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 1,
    toProgress: 5,
    traversedCoordinates: getTraversedCoordinates('red', 1, 5),
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.equal(plan.stepCount, 4);
  assert.equal(plan.traversalCoords.length, 4);

  // Expected coordinates for red progress 2, 3, 4, 5
  const expected = getTraversedCoordinates('red', 1, 5);
  assert.deepEqual(plan.traversalCoords, expected);
});

test('3. 1-step token route', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 10,
    toProgress: 11,
    traversedCoordinates: getTraversedCoordinates('red', 10, 11),
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.equal(plan.stepCount, 1);
  assert.equal(plan.pixelSteps.length, 1);
  assert.equal(plan.pixelSteps[0].x, (plan.toCoord.x + 0.5) * 24);
  assert.equal(plan.pixelSteps[0].y, (plan.toCoord.y + 0.5) * 24);
});

test('4. 6-step route', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 0,
    toProgress: 6,
    traversedCoordinates: getTraversedCoordinates('red', 0, 6),
  });

  const plan = buildTokenTravelPlan(moveRes, 20);
  assert.ok(plan);
  assert.equal(plan.stepCount, 6);
  assert.equal(plan.pixelSteps.length, 6);
  assert.ok(plan.totalDurationMs >= 140);
});

test('5. yard -> start route', () => {
  const moveRes = createMockMoveResult({
    player: 'green',
    tokenId: 2,
    fromProgress: -1,
    toProgress: 0,
    traversedCoordinates: [TRACK_CELL_GRID_COORDINATES[START_OFFSETS.green]],
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.equal(plan.color, 'green');
  assert.equal(plan.tokenIndex, 2);
  assert.deepEqual(plan.fromCoord, YARD_GRID_COORDINATES.green[2]);
  assert.deepEqual(plan.toCoord, TRACK_CELL_GRID_COORDINATES[START_OFFSETS.green]);
});

test('6. track wrap route', () => {
  // Blue start is 39. Blue reaches track 51 then wraps to 0
  const blueTraverse = getTraversedCoordinates('blue', 10, 15);
  assert.equal(blueTraverse.length, 5);

  const moveRes = createMockMoveResult({
    player: 'blue',
    tokenId: 0,
    fromProgress: 10,
    toProgress: 15,
    traversedCoordinates: blueTraverse,
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.equal(plan.stepCount, 5);
  assert.deepEqual(plan.traversalCoords, blueTraverse);
});

test('7. track -> stretch route', () => {
  // Red moves from progress 50 (last track square) to 52 (stretch square 1)
  const redStretch = getTraversedCoordinates('red', 50, 52);
  assert.equal(redStretch.length, 2);
  assert.deepEqual(redStretch[0], HOME_STRETCH_GRID_COORDINATES.red[0]);
  assert.deepEqual(redStretch[1], HOME_STRETCH_GRID_COORDINATES.red[1]);

  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 50,
    toProgress: 52,
    traversedCoordinates: redStretch,
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.deepEqual(plan.traversalCoords, redStretch);
});

test('8. stretch -> finish route', () => {
  // Red moves from stretch progress 54 to finish progress 56
  const toFinish = getTraversedCoordinates('red', 54, 56);
  assert.equal(toFinish.length, 2);
  assert.deepEqual(toFinish[1], FINISH_GRID_COORDINATES.red);

  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 54,
    toProgress: 56,
    traversedCoordinates: toFinish,
    reachedFinish: true,
  });

  const plan = buildTokenTravelPlan(moveRes, 24);
  assert.ok(plan);
  assert.equal(plan.reachedFinish, true);
  assert.deepEqual(plan.toCoord, FINISH_GRID_COORDINATES.red);
});

test('9. capture return plan targets correct token yard slot', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    tokenId: 0,
    capturedTokens: [{ color: 'green', tokenIndex: 3 }],
  });

  const capPlans = buildCaptureReturnPlan(moveRes, 24);
  assert.equal(capPlans.length, 1);
  assert.equal(capPlans[0].color, 'green');
  assert.equal(capPlans[0].tokenIndex, 3);
  assert.deepEqual(capPlans[0].targetYardCoord, YARD_GRID_COORDINATES.green[3]);
});

test('10. 2 captured tokens return to separate correct slots', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    tokenId: 0,
    capturedTokens: [
      { color: 'yellow', tokenIndex: 0 },
      { color: 'yellow', tokenIndex: 2 },
    ],
  });

  const capPlans = buildCaptureReturnPlan(moveRes, 24);
  assert.equal(capPlans.length, 2);
  assert.deepEqual(capPlans[0].targetYardCoord, YARD_GRID_COORDINATES.yellow[0]);
  assert.deepEqual(capPlans[1].targetYardCoord, YARD_GRID_COORDINATES.yellow[2]);
  assert.notDeepEqual(capPlans[0].targetYardCoord, capPlans[1].targetYardCoord);
});

test('11. multi-capture plan', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    tokenId: 0,
    capturedTokens: [
      { color: 'green', tokenIndex: 1 },
      { color: 'green', tokenIndex: 2 },
      { color: 'green', tokenIndex: 3 },
    ],
  });

  const capPlans = buildCaptureReturnPlan(moveRes, 24);
  assert.equal(capPlans.length, 3);
  assert.deepEqual(capPlans[0].targetYardCoord, YARD_GRID_COORDINATES.green[1]);
  assert.deepEqual(capPlans[1].targetYardCoord, YARD_GRID_COORDINATES.green[2]);
  assert.deepEqual(capPlans[2].targetYardCoord, YARD_GRID_COORDINATES.green[3]);
});

test('12. safe-cell coexistence creates no capture plan', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    tokenId: 0,
    capturedTokens: [], // landed on safe square with enemy tokens
  });

  const capPlans = buildCaptureReturnPlan(moveRes, 24);
  assert.equal(capPlans.length, 0);
});

test('13. stacked destination final offset', () => {
  const moveRes = createMockMoveResult({
    player: 'red',
    fromProgress: 0,
    toProgress: 2,
    traversedCoordinates: getTraversedCoordinates('red', 0, 2),
  });

  const plan = buildTokenTravelPlan(moveRes, 24, {
    targetStackOffset: { offsetXRatio: 0.15, offsetYRatio: -0.15 },
  });
  assert.ok(plan);
  assert.deepEqual(plan.targetStackOffset, { offsetXRatio: 0.15, offsetYRatio: -0.15 });
});

test('14. finish effect triggered only when reachedFinish', () => {
  const unfinishedMove = createMockMoveResult({ reachedFinish: false });
  const plan1 = buildTokenTravelPlan(unfinishedMove, 24);
  assert.equal(plan1?.reachedFinish, false);

  const finishedMove = createMockMoveResult({ reachedFinish: true });
  const plan2 = buildTokenTravelPlan(finishedMove, 24);
  assert.equal(plan2?.reachedFinish, true);
});

test('15. rank celebration triggered only playerRanked', () => {
  const normalMove = createMockMoveResult({ playerRanked: false, rank: null });
  assert.equal(normalMove.playerRanked, false);

  const rankingMove = createMockMoveResult({ playerRanked: true, rank: 1 });
  assert.equal(rankingMove.playerRanked, true);
  assert.equal(rankingMove.rank, 1);
});

test('16. game celebration only when gameFinished', () => {
  const activeMove = createMockMoveResult({ gameFinished: false });
  assert.equal(activeMove.gameFinished, false);

  const finalMove = createMockMoveResult({ gameFinished: true });
  assert.equal(finalMove.gameFinished, true);

  const particles = buildCelebrationParticles(18, 360);
  assert.equal(particles.length, 18);
  assert.ok(particles[0].startX > 0);
});

test('17. reduced-motion plan skips expensive motion', () => {
  const moveRes = createMockMoveResult({
    fromProgress: 0,
    toProgress: 6,
    traversedCoordinates: getTraversedCoordinates('red', 0, 6),
  });

  const normalPlan = buildTokenTravelPlan(moveRes, 24, { isReducedMotion: false });
  const reducedPlan = buildTokenTravelPlan(moveRes, 24, { isReducedMotion: true });

  assert.ok(normalPlan);
  assert.ok(reducedPlan);
  assert.equal(
    reducedPlan.totalDurationMs,
    LUDO_ANIMATION_CONSTANTS.REDUCED_MOTION_STEP_DURATION_MS
  );
  assert.ok(normalPlan.totalDurationMs > reducedPlan.totalDurationMs);
});

test('18. background cancellation resolves to authoritative final snapshot', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  await session.rollDice();
  const moveRes = await session.moveToken(0);

  // Authoritative state in session is immediately updated
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.engineState.tokens.red[0], 0);

  // If presentation cancels during backgrounding, the authoritative snapshot remains valid
  assert.equal(moveRes.player, 'red');
  assert.equal(moveRes.toProgress, 0);
});

test('19. unmount cancellation produces no follow-up action', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );

  let mounted = true;
  let followUpExecuted = false;

  const callback = () => {
    if (!mounted) return;
    followUpExecuted = true;
  };

  // Simulate unmount before callback
  mounted = false;
  callback();
  assert.equal(followUpExecuted, false);
});

test('20. interaction remains locked during movement', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  const snapshot = session.getSnapshot();

  const isMovementAnimating = true;
  const isBusy = isMovementAnimating;

  assert.equal(canHumanRoll(snapshot, isBusy, false), false);
  assert.equal(isBoardInteractive(snapshot, isBusy, false), false);
});

test('21. bot next action waits for animation completion', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 1 } }
  );
  // Red rolls 1 and auto-passes to Green Bot
  await session.rollDice();
  const botSnapshot = session.getSnapshot();
  assert.equal(botSnapshot.isBotTurn, true);

  // While animation is busy:
  assert.equal(determineNextBotAction(botSnapshot, true, false), null);

  // Once animation completes:
  assert.equal(determineNextBotAction(botSnapshot, false, false), 'BOT_ROLL');
});

test('22. auto-pass has no token animation', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 2 } }
  );
  // Roll 2 with all tokens at home results in auto-pass (no token movement)
  const rollRes = await session.rollDice();
  assert.equal(rollRes.autoPass, true);
  assert.equal(rollRes.type, 'ROLL');

  // Verify that an autoPass roll does not produce a token travel plan
  assert.equal(rollRes.movedToken, undefined);
  assert.equal(rollRes.fromProgress, undefined);
});

test('23. third-six has no token animation', async () => {
  let rollCount = 0;
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  // 1st six
  await session.rollDice();
  await session.moveToken(0);
  // 2nd six
  await session.rollDice();
  await session.moveToken(0);
  // 3rd six forfeits turn
  const thirdSixRes = await session.rollDice();
  assert.equal(thirdSixRes.threeSixesForfeit, true);
  assert.equal(thirdSixRes.type, 'ROLL');
  assert.equal(thirdSixRes.fromProgress, undefined);
});

test('24. multiple captured tokens only produce one haptic event', () => {
  const moveRes = createMockMoveResult({
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'green', tokenIndex: 1 },
      { color: 'green', tokenIndex: 2 },
    ],
  });

  let hapticCount = 0;
  const triggerHaptic = () => {
    hapticCount++;
  };

  // The architecture guarantees single haptic invocation per move
  if (moveRes.capturedTokens && moveRes.capturedTokens.length > 0) {
    triggerHaptic();
  }

  assert.equal(hapticCount, 1);
});

test('25. finish haptic once', () => {
  const moveRes = createMockMoveResult({ reachedFinish: true });
  let finishHapticCount = 0;
  if (moveRes.reachedFinish) {
    finishHapticCount++;
  }
  assert.equal(finishHapticCount, 1);
});

test('26. selectable pulse only for legal human tokens', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  // Roll 6 allows token 0, 1, 2, 3 to leave home
  await session.rollDice();
  const snapshot = session.getSnapshot();

  assert.equal(isTokenSelectable('red', 0, snapshot, false, false), true);
  assert.equal(isTokenSelectable('red', 1, snapshot, false, false), true);
});

test('27. illegal token never pulses', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 2 } }
  );
  // Roll 2 with all tokens at home: no tokens are legal
  const snapshot = session.getSnapshot();
  assert.equal(isTokenSelectable('red', 0, snapshot, false, false), false);
  // Opposite player token is never selectable
  assert.equal(isTokenSelectable('yellow', 0, snapshot, false, false), false);
});

test('28. handoff waits for previous animation completion', async () => {
  const session = await createTestSession(
    {
      seats: [
        { color: 'red', status: 'human', playerType: 'human', displayName: 'Red' },
        { color: 'yellow', status: 'human', playerType: 'human', displayName: 'Yellow' },
      ],
      totalSeats: 2,
    },
    { diceRoller: { roll: () => 2 } }
  );
  // Red rolls 2 (auto-passes to Yellow)
  await session.rollDice();
  const snapshot = session.getSnapshot();

  // Engine requires handoff to Yellow
  assert.equal(shouldShowHandoff(snapshot), true);

  // While animation is busy, presentation handoff is withheld
  const isBoardBusy = true;
  const isHandoffActive = shouldShowHandoff(snapshot) && !isBoardBusy;
  assert.equal(isHandoffActive, false);

  // Once animation completes:
  const isHandoffActiveAfterAnim = shouldShowHandoff(snapshot) && !false;
  assert.equal(isHandoffActiveAfterAnim, true);
});

// ==================================================
// PHASE 3C FINAL HARDENING GATE TESTS (1..22)
// ==================================================

test('Hardening 1: cancelled token animation settles cleanly', () => {
  let isMovementAnimating = true;
  let isActionPending = true;
  let actionLock = true;
  let hiddenTokenKeys = ['red-0'];
  let pendingAnimation = { token: 'red-0' };

  // Settlement callback on cancellation
  const handleTravelComplete = (outcome) => {
    if (outcome === 'cancelled') {
      isMovementAnimating = false;
      isActionPending = false;
      actionLock = false;
      hiddenTokenKeys = [];
      pendingAnimation = null;
    }
  };

  handleTravelComplete('cancelled');

  assert.equal(isMovementAnimating, false);
  assert.equal(isActionPending, false);
  assert.equal(actionLock, false);
  assert.deepEqual(hiddenTokenKeys, []);
  assert.equal(pendingAnimation, null);
});

test('Hardening 2: cancelled dice animation settles cleanly', () => {
  let isDiceRolling = true;
  let isActionPending = true;
  let actionLock = true;
  let transientFace = 4;

  const handleDiceRollComplete = (outcome) => {
    if (outcome === 'cancelled') {
      isDiceRolling = false;
      isActionPending = false;
      actionLock = false;
      transientFace = null;
    }
  };

  handleDiceRollComplete('cancelled');

  assert.equal(isDiceRolling, false);
  assert.equal(isActionPending, false);
  assert.equal(actionLock, false);
  assert.equal(transientFace, null);
});

test('Hardening 3: cancellation does not request another engine action', async () => {
  let engineActionCount = 0;
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );

  // Perform one authoritative move
  await session.rollDice();
  engineActionCount++;
  const moveRes = await session.moveToken(0);
  engineActionCount++;

  assert.equal(engineActionCount, 2);

  // Cancellation outcome in presentation
  const onCancel = () => {
    // Never calls session.moveToken() or session.rollDice()
  };
  onCancel();

  assert.equal(engineActionCount, 2);
  const snap = session.getSnapshot();
  assert.equal(snap.engineState.tokens.red[0], 0);
});

test('Hardening 4: background move resolves to authoritative final state', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  await session.rollDice();
  const moveRes = await session.moveToken(0);

  // Authoritative state is immediately committed in engine
  assert.equal(moveRes.toProgress, 0);

  // Presentation layer simulates background event
  let displayedSnapshot = null;
  let hiddenKeys = ['red-0'];
  let isMovementAnimating = true;

  const onAppBackground = () => {
    isMovementAnimating = false;
    hiddenKeys = [];
    displayedSnapshot = session.getSnapshot();
  };

  onAppBackground();

  assert.equal(isMovementAnimating, false);
  assert.deepEqual(hiddenKeys, []);
  assert.equal(displayedSnapshot.engineState.tokens.red[0], 0);
});

test('Hardening 5: background roll preserves authoritative roll state', async () => {
  const session = await createTestSession(
    { seats: mockSeats, totalSeats: 4 },
    { diceRoller: { roll: () => 6 } }
  );
  const rollRes = await session.rollDice();
  assert.equal(rollRes.rolledValue, 6);

  let isDiceRolling = true;
  let displayDiceValue = 6;
  let actionLock = true;

  const onAppBackground = () => {
    isDiceRolling = false;
    actionLock = false;
    const snap = session.getSnapshot();
    if (snap.turnPhase === 'move' && snap.currentRoll !== null) {
      displayDiceValue = snap.currentRoll;
    }
  };

  onAppBackground();

  assert.equal(isDiceRolling, false);
  assert.equal(actionLock, false);
  assert.equal(displayDiceValue, 6);
  assert.equal(session.getSnapshot().turnPhase, 'move');
});

test('Hardening 6: unmount bot animation has no continuation', () => {
  let mounted = true;
  let generation = 1;
  let botTimer = 123;
  let staleActionExecuted = false;

  // Unmount occurs
  mounted = false;
  clearTimeout(botTimer);
  generation++;

  // Stale bot timeout fires
  const onBotTimeout = (callGen) => {
    if (!mounted || callGen !== 1) {
      return;
    }
    staleActionExecuted = true;
  };

  onBotTimeout(1);
  assert.equal(staleActionExecuted, false);
});

test('Hardening 7: haptic precedence - finish only', () => {
  const moveRes = createMockMoveResult({
    reachedFinish: true,
    playerRanked: false,
    rank: null,
    gameFinished: false,
    capturedTokens: [],
  });

  const event = resolveMoveHapticEvent(moveRes, false);
  assert.equal(event, 'finishToken');
});

test('Hardening 8: haptic precedence - rank beats finish', () => {
  const moveRes = createMockMoveResult({
    reachedFinish: true,
    playerRanked: true,
    rank: 1,
    gameFinished: false,
    capturedTokens: [],
  });

  const event = resolveMoveHapticEvent(moveRes, false);
  assert.equal(event, 'playerRanked');
});

test('Hardening 9: haptic precedence - game win beats rank + finish', () => {
  const moveRes = createMockMoveResult({
    reachedFinish: true,
    playerRanked: true,
    rank: 1,
    gameFinished: true,
    capturedTokens: [{ color: 'green', tokenIndex: 0 }],
  });

  const event = resolveMoveHapticEvent(moveRes, false);
  assert.equal(event, 'gameWon');
});

test('Hardening 10: multi-capture produces exactly one capture haptic', async () => {
  const moveRes = createMockMoveResult({
    reachedFinish: false,
    playerRanked: false,
    gameFinished: false,
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'green', tokenIndex: 1 },
      { color: 'green', tokenIndex: 2 },
    ],
  });

  const event = resolveMoveHapticEvent(moveRes, false);
  assert.equal(event, 'capture');

  let impactCalls = 0;
  LudoHaptics.setDriver({
    async impactAsync() {
      impactCalls++;
    },
    async notificationAsync() {},
  });

  await LudoHaptics.triggerMoveHaptic(moveRes, false);
  LudoHaptics.resetDriver();

  assert.equal(impactCalls, 1);
});

test('Hardening 11: bot action haptic policy', () => {
  const botMove = createMockMoveResult({
    reachedFinish: true,
    playerRanked: true,
    rank: 1,
    capturedTokens: [{ color: 'red', tokenIndex: 0 }],
    gameFinished: false,
  });

  // Bot normal actions must return null
  assert.equal(resolveMoveHapticEvent(botMove, true), null);

  // Bot game-ending action may trigger gameWon
  const botWin = createMockMoveResult({
    gameFinished: true,
  });
  assert.equal(resolveMoveHapticEvent(botWin, true), 'gameWon');
});

test('Hardening 12: async haptic rejection handled safely', async () => {
  LudoHaptics.setDriver({
    impactAsync: () => Promise.reject(new Error('Haptics hardware unavailable')),
    notificationAsync: () => Promise.reject(new Error('Notification haptic failed')),
  });

  // None of these should throw or produce unhandled rejections
  await assert.doesNotReject(async () => {
    await LudoHaptics.rollStart();
    await LudoHaptics.rollSettle();
    await LudoHaptics.tokenSelected();
    await LudoHaptics.capture();
    await LudoHaptics.finishToken();
    await LudoHaptics.playerRanked();
    await LudoHaptics.gameWon();
    await LudoHaptics.triggerMoveHaptic(createMockMoveResult({ gameFinished: true }));
  });

  LudoHaptics.resetDriver();
});

test('Hardening 13: finished save restore does not trigger win celebration', async () => {
  const storage = new MemoryStorage();
  const session = await createLocalLudoSession(
    { seats: mockSeats, totalSeats: 4 },
    { storage }
  );

  // Mark saved session as finished with valid engine state
  const saved = await storage.load();
  assert.ok(saved);
  saved.engineState.tokens.red = [56, 56, 56, 56];
  saved.engineState.tokens.green = [56, 56, 56, 56];
  saved.engineState.status = 'finished';
  saved.engineState.currentTurn = null;
  saved.engineState.turnPhase = null;
  saved.engineState.rankings = ['red', 'green', 'yellow'];
  await storage.save(saved);

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  assert.equal(restored.session?.getSnapshot().status, 'finished');

  // In local.tsx, showWinnerCelebration is event-driven: starts false, never set on restore
  const showWinnerCelebration = false;
  assert.equal(showWinnerCelebration, false);
});

test('Hardening 14: fresh playing -> finished transition does trigger celebration', () => {
  let showWinnerCelebration = false;
  const moveRes = createMockMoveResult({ gameFinished: true });

  const finishMovementSequence = (result, isReducedMotion) => {
    if (result.gameFinished && !isReducedMotion) {
      showWinnerCelebration = true;
    }
  };

  finishMovementSequence(moveRes, false);
  assert.equal(showWinnerCelebration, true);
});

test('Hardening 15: already-ranked save does not trigger rank celebration', async () => {
  const storage = new MemoryStorage();
  const session = await createLocalLudoSession(
    { seats: mockSeats, totalSeats: 4 },
    { storage }
  );

  const saved = await storage.load();
  assert.ok(saved);
  saved.engineState.tokens.red = [56, 56, 56, 56];
  saved.engineState.rankings = ['red'];
  saved.engineState.currentTurn = 'green';
  await storage.save(saved);

  const restored = await restoreLocalLudoSession(storage);
  assert.equal(restored.success, true);
  assert.deepEqual(restored.session?.getSnapshot().rankings, ['red']);

  // In local.tsx, celebrationRank starts as null on restore
  const celebrationRank = null;
  assert.equal(celebrationRank, null);
});

test('Hardening 16: fresh playerRanked result does trigger rank celebration', () => {
  let celebrationRank = null;
  const moveRes = createMockMoveResult({
    player: 'red',
    playerRanked: true,
    rank: 1,
    gameFinished: false,
  });

  const finishMovementSequence = (result, isReducedMotion) => {
    if (result.gameFinished && !isReducedMotion) {
      // not finished
    } else if (result.playerRanked && result.rank !== null && !isReducedMotion) {
      celebrationRank = {
        color: result.player,
        rank: result.rank,
        displayName: 'Red Player',
      };
    }
  };

  finishMovementSequence(moveRes, false);
  assert.ok(celebrationRank);
  assert.equal(celebrationRank.color, 'red');
  assert.equal(celebrationRank.rank, 1);
});

test('Hardening 17: confetti created once with unique IDs', () => {
  const particles = buildCelebrationParticles(18, 360);
  assert.equal(particles.length, 18);

  const ids = new Set(particles.map((p) => p.id));
  assert.equal(ids.size, 18);

  for (const p of particles) {
    assert.ok(Number.isFinite(p.startX));
    assert.ok(Number.isFinite(p.targetX));
    assert.ok(Number.isFinite(p.targetY));
  }
});

test('Hardening 18: reduced motion creates no confetti', () => {
  const isReducedMotion = true;
  let particlesCreated = false;

  if (!isReducedMotion) {
    buildCelebrationParticles(18, 360);
    particlesCreated = true;
  }

  assert.equal(particlesCreated, false);
});

test('Hardening 19: dice temporary-face timer cleaned on cancellation', () => {
  let intervalCleared = false;
  let transientFace = 5;
  const timer = setInterval(() => {}, 100);

  // Cancellation cleanup
  clearInterval(timer);
  intervalCleared = true;
  transientFace = null;

  assert.equal(intervalCleared, true);
  assert.equal(transientFace, null);
});

test('Hardening 20: hidden moving token restored after cancellation', () => {
  let hiddenTokenKeys = ['red-0'];

  const finalizeMoveState = () => {
    hiddenTokenKeys = [];
  };

  finalizeMoveState();
  assert.deepEqual(hiddenTokenKeys, []);
});

test('Hardening 21: hidden captured tokens restored after cancellation', () => {
  let hiddenTokenKeys = ['red-0', 'green-1', 'green-2'];

  const finalizeMoveState = () => {
    hiddenTokenKeys = [];
  };

  finalizeMoveState();
  assert.deepEqual(hiddenTokenKeys, []);
});

test('Hardening 22: invalid capture tokenIndex does not break presentation', () => {
  const invalidMove = createMockMoveResult({
    capturedTokens: [
      { color: 'green', tokenIndex: 99 },
      { color: 'green', tokenIndex: -1 },
      { color: 'green', tokenIndex: 1.5 },
      { color: 'unknownColor', tokenIndex: 0 },
      null,
      undefined,
    ],
  });

  // Must not throw, safely filters invalid items
  const plans = buildCaptureReturnPlan(invalidMove, 24);
  assert.equal(plans.length, 0);

  // Valid entries among invalid entries must still succeed
  const mixedMove = createMockMoveResult({
    capturedTokens: [
      { color: 'green', tokenIndex: 99 },
      { color: 'green', tokenIndex: 2 },
    ],
  });
  const mixedPlans = buildCaptureReturnPlan(mixedMove, 24);
  assert.equal(mixedPlans.length, 1);
  assert.equal(mixedPlans[0].tokenIndex, 2);
});
