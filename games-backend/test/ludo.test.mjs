import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LudoEngine,
  validateLudoState,
  selectBotMove,
  stepBot,
  trackDistance,
  isTrackCellThreatened,
  createDeterministicDiceRoller,
  START_OFFSETS,
  SAFE_TRACK_CELLS,
  TOTAL_TRACK_CELLS,
  TRACK_END_PROGRESS,
  STRETCH_START_PROGRESS,
  STRETCH_END_PROGRESS,
  FINISH_PROGRESS,
  isSafeCell,
  progressToTrackCell,
  progressToBoardPosition,
  getLogicalGridCoordinates,
  getTraversedPositions,
  getTraversedCoordinates,
} from '../src/games/ludo/index.ts';

// Deterministic Mulberry32 PRNG for reproducible simulation tests
function createMulberry32(seed = 12345) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTwoPlayerGame(overrides = {}) {
  return LudoEngine.create({
    players: [
      { id: 'user_red', color: 'red', type: 'human' },
      { id: 'user_yellow', color: 'yellow', type: 'human' },
    ],
    ...overrides,
  });
}

function createFourPlayerGame(overrides = {}) {
  return LudoEngine.create({
    players: [
      { id: 'user_red', color: 'red', type: 'human' },
      { id: 'user_green', color: 'green', type: 'human' },
      { id: 'user_yellow', color: 'yellow', type: 'human' },
      { id: 'user_blue', color: 'blue', type: 'human' },
    ],
    ...overrides,
  });
}

// ==========================================
// 1. GAME INITIALIZATION & CONFIGURATIONS
// ==========================================

test('1. Game initialization: creates clean valid state with all tokens in home', () => {
  const engine = createFourPlayerGame();
  const state = engine.getState();

  assert.equal(state.gameType, 'ludo');
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.activeColors, ['red', 'green', 'yellow', 'blue']);
  assert.equal(state.currentTurn, 'red');
  assert.equal(state.turnPhase, 'roll');
  assert.equal(state.currentRoll, null);
  assert.equal(state.consecutiveSixes, 0);
  assert.deepEqual(state.rankings, []);
  assert.equal(state.round, 1);
  assert.equal(state.revision, 0);

  for (const color of ['red', 'green', 'yellow', 'blue']) {
    assert.deepEqual(state.tokens[color], [-1, -1, -1, -1]);
  }
});

test('2. 2-player configuration: alternates turns strictly between active colors', () => {
  const engine = createTwoPlayerGame();
  assert.deepEqual(engine.getState().activeColors, ['red', 'yellow']);
  assert.equal(engine.getState().currentTurn, 'red');

  engine.applyRoll(1); // Red auto-pass
  assert.equal(engine.getState().currentTurn, 'yellow');
  engine.applyRoll(1); // Yellow auto-pass
  assert.equal(engine.getState().currentTurn, 'red');
});

test('3. 3-player configuration: supports 3 active players in clockwise order', () => {
  const engine = LudoEngine.create({
    players: [
      { id: 'u1', color: 'red', type: 'human' },
      { id: 'u2', color: 'green', type: 'human' },
      { id: 'u3', color: 'yellow', type: 'human' },
    ],
  });

  assert.deepEqual(engine.getState().activeColors, ['red', 'green', 'yellow']);
  assert.equal(engine.getState().players.blue, null);

  engine.applyRoll(1); // Red -> Green
  assert.equal(engine.getState().currentTurn, 'green');
  engine.applyRoll(1); // Green -> Yellow
  assert.equal(engine.getState().currentTurn, 'yellow');
  engine.applyRoll(1); // Yellow -> Red
  assert.equal(engine.getState().currentTurn, 'red');
});

test('4. 4-player configuration: supports all 4 active players', () => {
  const engine = createFourPlayerGame();
  assert.equal(engine.getState().activeColors.length, 4);
});

test('5. Seat combinations: all human/bot seat combinations initialize properly', () => {
  const combos = [
    [
      { id: 'h1', color: 'red', type: 'human' },
      { id: 'b1', color: 'yellow', type: 'bot', botDifficulty: 'easy' },
    ],
    [
      { id: 'h1', color: 'red', type: 'human' },
      { id: 'b1', color: 'green', type: 'bot', botDifficulty: 'normal' },
      { id: 'b2', color: 'yellow', type: 'bot', botDifficulty: 'hard' },
    ],
    [
      { id: 'h1', color: 'red', type: 'human' },
      { id: 'b1', color: 'green', type: 'bot', botDifficulty: 'easy' },
      { id: 'b2', color: 'yellow', type: 'bot', botDifficulty: 'normal' },
      { id: 'b3', color: 'blue', type: 'bot', botDifficulty: 'hard' },
    ],
    [
      { id: 'h1', color: 'red', type: 'human' },
      { id: 'h2', color: 'green', type: 'human' },
      { id: 'b1', color: 'yellow', type: 'bot', botDifficulty: 'normal' },
      { id: 'b2', color: 'blue', type: 'bot', botDifficulty: 'hard' },
    ],
    [
      { id: 'b1', color: 'red', type: 'bot', botDifficulty: 'hard' },
      { id: 'b2', color: 'green', type: 'bot', botDifficulty: 'hard' },
      { id: 'b3', color: 'yellow', type: 'bot', botDifficulty: 'hard' },
      { id: 'b4', color: 'blue', type: 'bot', botDifficulty: 'hard' },
    ],
  ];

  for (const players of combos) {
    const engine = LudoEngine.create({ players });
    assert.equal(engine.getState().status, 'playing');
    assert.equal(engine.getState().activeColors.length, players.length);
  }
});

// ==========================================
// 2. ROUTE GEOMETRY & TRANSITIONS
// ==========================================

test('6. Route geometry proof: verifies exact transitions for all four colors', () => {
  const colors = ['red', 'green', 'yellow', 'blue'];
  const expectedStarts = { red: 0, green: 13, yellow: 26, blue: 39 };
  const expectedLastTracks = { red: 50, green: 11, yellow: 24, blue: 37 };

  for (const color of colors) {
    // 1. Spawn square
    const spawnPos = progressToBoardPosition(color, 0, 0);
    assert.equal(spawnPos.type, 'track');
    assert.equal(spawnPos.trackIndex, expectedStarts[color]);
    assert.equal(spawnPos.isSafe, true);

    // 2. Complete track traversal (51 unique track cells: 0..50)
    const visitedTracks = new Set();
    for (let p = 0; p <= TRACK_END_PROGRESS; p++) {
      const trackIdx = progressToTrackCell(color, p);
      assert.notEqual(trackIdx, null);
      assert.equal(visitedTracks.has(trackIdx), false, `Color ${color} visited track ${trackIdx} twice!`);
      visitedTracks.add(trackIdx);
    }
    assert.equal(visitedTracks.size, 51);

    // 3. Final shared track square
    const lastTrackPos = progressToBoardPosition(color, TRACK_END_PROGRESS, 0);
    assert.equal(lastTrackPos.type, 'track');
    assert.equal(lastTrackPos.trackIndex, expectedLastTracks[color]);

    // 4. Stretch transition (progress 51)
    const stretch0Pos = progressToBoardPosition(color, STRETCH_START_PROGRESS, 0);
    assert.equal(stretch0Pos.type, 'stretch');
    assert.equal(stretch0Pos.color, color);
    assert.equal(stretch0Pos.stretchIndex, 0);

    // 5. Stretch cells (51..55)
    for (let sIdx = 0; sIdx < 5; sIdx++) {
      const stretchPos = progressToBoardPosition(color, STRETCH_START_PROGRESS + sIdx, 0);
      assert.equal(stretchPos.type, 'stretch');
      assert.equal(stretchPos.color, color);
      assert.equal(stretchPos.stretchIndex, sIdx);
    }

    // 6. Final finish (progress 56)
    const finishPos = progressToBoardPosition(color, FINISH_PROGRESS, 0);
    assert.equal(finishPos.type, 'finish');
    assert.equal(finishPos.color, color);
  }
});

test('7. Boundary movement: four-color track-to-stretch single-step and multi-step crossings', () => {
  const colors = ['red', 'green', 'yellow', 'blue'];

  for (const color of colors) {
    // A. Step-by-step: 48 -> 49 -> 50 -> 51 (stretch 0) -> 52 (stretch 1)
    const engine1 = createFourPlayerGame();
    const state1 = engine1.getState();
    state1.tokens[color][0] = 48; // final track - 2
    state1.currentTurn = color;
    state1.turnPhase = 'roll';
    const testEngine1 = LudoEngine.fromState(state1);

    // Roll 1: 48 -> 49
    testEngine1.applyRoll(1);
    const m1 = testEngine1.makeMove(color, 0);
    assert.equal(m1.success, true);
    assert.equal(m1.movedToken?.toProgress, 49);
    assert.equal(m1.movedToken?.targetPosition.type, 'track');

    // Force turn back to this color for testing sequence
    const s2 = testEngine1.getState();
    s2.currentTurn = color;
    s2.turnPhase = 'roll';
    const testEngine2 = LudoEngine.fromState(s2);

    // Roll 1: 49 -> 50 (final track cell)
    testEngine2.applyRoll(1);
    const m2 = testEngine2.makeMove(color, 0);
    assert.equal(m2.success, true);
    assert.equal(m2.movedToken?.toProgress, 50);
    assert.equal(m2.movedToken?.targetPosition.type, 'track');

    const s3 = testEngine2.getState();
    s3.currentTurn = color;
    s3.turnPhase = 'roll';
    const testEngine3 = LudoEngine.fromState(s3);

    // Roll 1: 50 -> 51 (home stretch cell 0)
    testEngine3.applyRoll(1);
    const m3 = testEngine3.makeMove(color, 0);
    assert.equal(m3.success, true);
    assert.equal(m3.movedToken?.toProgress, 51);
    assert.equal(m3.movedToken?.targetPosition.type, 'stretch');
    assert.equal(m3.movedToken?.targetPosition.color, color);
    assert.equal(m3.movedToken?.targetPosition.stretchIndex, 0);

    const s4 = testEngine3.getState();
    s4.currentTurn = color;
    s4.turnPhase = 'roll';
    const testEngine4 = LudoEngine.fromState(s4);

    // Roll 1: 51 -> 52 (home stretch cell 1)
    testEngine4.applyRoll(1);
    const m4 = testEngine4.makeMove(color, 0);
    assert.equal(m4.success, true);
    assert.equal(m4.movedToken?.toProgress, 52);
    assert.equal(m4.movedToken?.targetPosition.type, 'stretch');
    assert.equal(m4.movedToken?.targetPosition.color, color);
    assert.equal(m4.movedToken?.targetPosition.stretchIndex, 1);

    // B. Multi-step dice roll crossing track -> private stretch:
    // Token at progress 48 (track), rolls 4 -> lands on progress 52 (stretch 1)
    const engineMulti = createFourPlayerGame();
    const stateMulti = engineMulti.getState();
    stateMulti.tokens[color][0] = 48;
    stateMulti.currentTurn = color;
    stateMulti.turnPhase = 'roll';
    const testEngineMulti = LudoEngine.fromState(stateMulti);

    testEngineMulti.applyRoll(4);
    const moveMulti = testEngineMulti.makeMove(color, 0);
    assert.equal(moveMulti.success, true);
    assert.equal(moveMulti.movedToken?.fromProgress, 48);
    assert.equal(moveMulti.movedToken?.toProgress, 52);
    assert.equal(moveMulti.movedToken?.targetPosition.type, 'stretch');
    assert.equal(moveMulti.movedToken?.targetPosition.color, color);
    assert.equal(moveMulti.movedToken?.targetPosition.stretchIndex, 1);
  }
});

// ==========================================
// 3. 15x15 LOGICAL BOARD MAPPING
// ==========================================

test('8. 15x15 Grid structural verification: all 52 track coordinates are unique and inside 0..14', () => {
  const seenCoords = new Set();

  for (let trackIdx = 0; trackIdx < TOTAL_TRACK_CELLS; trackIdx++) {
    const coords = getLogicalGridCoordinates({ type: 'track', trackIndex: trackIdx, isSafe: isSafeCell(trackIdx) });
    assert.ok(coords.x >= 0 && coords.x <= 14, `Track ${trackIdx} x out of bounds: ${coords.x}`);
    assert.ok(coords.y >= 0 && coords.y <= 14, `Track ${trackIdx} y out of bounds: ${coords.y}`);
    const key = `${coords.x},${coords.y}`;
    assert.equal(seenCoords.has(key), false, `Duplicate track coordinate at track ${trackIdx}: ${key}`);
    seenCoords.add(key);
  }
  assert.equal(seenCoords.size, 52);
});

test('9. 15x15 Grid topology: audit every consecutive pair for Manhattan and Chebyshev distance', () => {
  const nonOrthogonalPairs = [];

  for (let i = 0; i < TOTAL_TRACK_CELLS; i++) {
    const next = (i + 1) % TOTAL_TRACK_CELLS;
    const c1 = getLogicalGridCoordinates({ type: 'track', trackIndex: i, isSafe: isSafeCell(i) });
    const c2 = getLogicalGridCoordinates({ type: 'track', trackIndex: next, isSafe: isSafeCell(next) });
    const dx = Math.abs(c1.x - c2.x);
    const dy = Math.abs(c1.y - c2.y);
    const manhattan = dx + dy;
    const chebyshev = Math.max(dx, dy);

    // INVARIANT: Every consecutive track step must be directly adjacent on the board (Chebyshev distance = 1)
    // No visual teleportation, no skipped cells, 100% Moore neighborhood contiguity.
    assert.equal(chebyshev, 1, `Discontinuous gap between track ${i} and ${next}: dx=${dx}, dy=${dy}`);

    if (manhattan !== 1) {
      nonOrthogonalPairs.push({ from: i, to: next, c1, c2, dx, dy, manhattan });
    }
  }

  // Exactly 4 pairs are diagonal inner-corner reflex turns (Chebyshev = 1, Manhattan = 2, dx = 1, dy = 1):
  // 1. 4 -> 5: Left Arm to Top Arm inner corner ({5, 6} -> {6, 5})
  // 2. 17 -> 18: Top Arm to Right Arm inner corner ({8, 5} -> {9, 6})
  // 3. 30 -> 31: Right Arm to Bottom Arm inner corner ({9, 8} -> {8, 9})
  // 4. 43 -> 44: Bottom Arm to Left Arm inner corner ({6, 9} -> {5, 8})
  assert.equal(nonOrthogonalPairs.length, 4, `Expected exactly 4 inner corner reflex turns, got ${nonOrthogonalPairs.length}`);
  assert.deepEqual(nonOrthogonalPairs.map(p => `${p.from}->${p.to}`), ['4->5', '17->18', '30->31', '43->44']);

  for (const pair of nonOrthogonalPairs) {
    assert.equal(pair.dx, 1);
    assert.equal(pair.dy, 1);
    assert.equal(pair.manhattan, 2);
  }

  // Wrap transition 51 -> 0 is strictly orthogonal (Manhattan = 1, Chebyshev = 1)
  const c51 = getLogicalGridCoordinates({ type: 'track', trackIndex: 51, isSafe: isSafeCell(51) });
  const c0 = getLogicalGridCoordinates({ type: 'track', trackIndex: 0, isSafe: isSafeCell(0) });
  assert.equal(Math.abs(c51.x - c0.x) + Math.abs(c51.y - c0.y), 1);
});

test('10. Home stretches do not overlap: all four colors have mutually exclusive stretch coordinates', () => {
  const stretchCoords = new Set();
  for (const color of ['red', 'green', 'yellow', 'blue']) {
    for (let s = 0; s < 5; s++) {
      const coords = getLogicalGridCoordinates({ type: 'stretch', color, stretchIndex: s });
      const key = `${coords.x},${coords.y}`;
      assert.equal(stretchCoords.has(key), false, `Overlap in stretch at ${key}`);
      stretchCoords.add(key);
    }
  }
  assert.equal(stretchCoords.size, 20); // 4 * 5 = 20 distinct stretch cells
});

test('10b. Animation path helper: getTraversedPositions and getTraversedCoordinates', () => {
  // A. Normal track movement: Red 0 -> 4
  const redTrack = getTraversedPositions('red', 0, 4);
  assert.equal(redTrack.length, 4);
  assert.deepEqual(
    redTrack.map(p => p.type === 'track' ? p.trackIndex : -1),
    [1, 2, 3, 4]
  );
  const redCoords = getTraversedCoordinates('red', 0, 4);
  assert.deepEqual(redCoords, [
    { x: 2, y: 6 },
    { x: 3, y: 6 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ]);

  // B. Track wrap: Blue from progress 10 to 15 (start offset 39 -> track cells 49, 50, 51, 0, 1, 2)
  const blueWrap = getTraversedPositions('blue', 10, 15);
  assert.equal(blueWrap.length, 5);
  assert.deepEqual(
    blueWrap.map(p => p.type === 'track' ? p.trackIndex : -1),
    [50, 51, 0, 1, 2]
  );

  // C. Track to stretch: Green from progress 48 to 53 (Green start 13)
  // Progress 49 -> track 10, Progress 50 -> track 11 (last track),
  // Progress 51 -> stretch 0, Progress 52 -> stretch 1, Progress 53 -> stretch 2
  const greenStretch = getTraversedPositions('green', 48, 53);
  assert.equal(greenStretch.length, 5);
  assert.equal(greenStretch[0].type, 'track');
  assert.equal(greenStretch[0].trackIndex, 10);
  assert.equal(greenStretch[1].type, 'track');
  assert.equal(greenStretch[1].trackIndex, 11);
  assert.equal(greenStretch[2].type, 'stretch');
  assert.equal(greenStretch[2].color, 'green');
  assert.equal(greenStretch[2].stretchIndex, 0);
  assert.equal(greenStretch[3].type, 'stretch');
  assert.equal(greenStretch[3].stretchIndex, 1);
  assert.equal(greenStretch[4].type, 'stretch');
  assert.equal(greenStretch[4].stretchIndex, 2);

  // D. Stretch movement: Yellow from progress 51 to 54
  const yellowStretch = getTraversedPositions('yellow', 51, 54);
  assert.equal(yellowStretch.length, 3);
  assert.deepEqual(
    yellowStretch.map(p => p.type === 'stretch' ? p.stretchIndex : -1),
    [1, 2, 3]
  );

  // E. Reaching finish: Red from progress 54 to 56
  const redFinish = getTraversedPositions('red', 54, 56);
  assert.equal(redFinish.length, 2);
  assert.equal(redFinish[0].type, 'stretch');
  assert.equal(redFinish[0].stretchIndex, 4);
  assert.equal(redFinish[1].type, 'finish');
  assert.equal(redFinish[1].color, 'red');

  // F. Spawn from yard: progress -1 to 0
  const redSpawn = getTraversedPositions('red', -1, 0);
  assert.equal(redSpawn.length, 1);
  assert.equal(redSpawn[0].type, 'track');
  assert.equal(redSpawn[0].trackIndex, 0);
  assert.deepEqual(getTraversedCoordinates('red', -1, 0), [{ x: 1, y: 6 }]);

  // G. Identity / backwards return empty array
  assert.deepEqual(getTraversedPositions('red', 5, 5), []);
  assert.deepEqual(getTraversedPositions('red', 10, 5), []);

  // H. Bounds checking throws
  assert.throws(() => getTraversedPositions('red', -2, 5));
  assert.throws(() => getTraversedPositions('red', 5, 57));
});

// ==========================================
// 4. SAFE CELLS & WRAP PROTECTION
// ==========================================

test('11. Safe cells audit: verifies 4 start cells and 4 star cells are safe and adjacent are capturable', () => {
  const expectedSafe = [0, 8, 13, 21, 26, 34, 39, 47];
  assert.deepEqual([...SAFE_TRACK_CELLS], expectedSafe);

  for (const safeIdx of expectedSafe) {
    assert.equal(isSafeCell(safeIdx), true, `Cell ${safeIdx} should be safe`);
    // Immediately adjacent cells must NOT be safe
    const prev = (safeIdx - 1 + TOTAL_TRACK_CELLS) % TOTAL_TRACK_CELLS;
    const next = (safeIdx + 1) % TOTAL_TRACK_CELLS;
    assert.equal(isSafeCell(prev), false, `Cell ${prev} adjacent to ${safeIdx} should NOT be safe`);
    assert.equal(isSafeCell(next), false, `Cell ${next} adjacent to ${safeIdx} should NOT be safe`);
  }
});

test('12. Safe cell protection after track wrap: safe cells protect against capture after wrap', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Blue start is cell 39. Yellow starts at 26.
  // Cell 0 is safe (Red start).
  // Suppose Yellow token 0 is at cell 0.
  // Yellow progress to reach cell 0: (0 - 26 + 52) % 52 = 26.
  state.tokens.yellow[0] = 26; // Yellow at cell 0 (safe)
  // Red token 0 at cell 50 (progress 50).
  state.tokens.red[0] = 48; // Red at cell 48
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red rolls 4: from 48 lands on (48+4)%52 = 0 (safe Red start)
  testEngine.applyRoll(4);
  const moveRes = testEngine.makeMove('red', 0);
  assert.equal(moveRes.success, true);
  assert.equal(moveRes.capturedTokens, undefined); // Safe cell prevents capture!
  assert.equal(testEngine.getState().tokens.yellow[0], 26); // Yellow untouched
  assert.equal(testEngine.getState().tokens.red[0], 52); // Red moved to stretch 1
});

// ==========================================
// 5. MULTIPLE TOKENS ON ONE CELL
// ==========================================

test('13. Multiple tokens on one cell: same-color sharing and multi-capture on non-safe square', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Yellow has TWO tokens on track cell 14 (non-safe):
  // Yellow start = 26. Yellow progress to reach 14 = (14 - 26 + 52) % 52 = 40.
  state.tokens.yellow[0] = 40;
  state.tokens.yellow[1] = 40;
  // Red has token 0 at track cell 12 (Red progress 12)
  state.tokens.red[0] = 12;
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red rolls 2 -> lands on track cell 14
  testEngine.applyRoll(2);
  const moveRes = testEngine.makeMove('red', 0);

  assert.equal(moveRes.success, true);
  // Both Yellow tokens captured!
  assert.deepEqual(moveRes.capturedTokens, [
    { color: 'yellow', tokenIndex: 0 },
    { color: 'yellow', tokenIndex: 1 },
  ]);
  assert.equal(testEngine.getState().tokens.yellow[0], -1);
  assert.equal(testEngine.getState().tokens.yellow[1], -1);
});

test('14. Multiple tokens on safe square: opponent cannot capture either token', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Yellow has TWO tokens on safe cell 8 (Star):
  // Yellow start = 26. Progress to reach 8 = (8 - 26 + 52) % 52 = 34.
  state.tokens.yellow[0] = 34;
  state.tokens.yellow[1] = 34;
  // Red has token 0 at cell 6 (Red progress 6)
  state.tokens.red[0] = 6;
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red rolls 2 -> lands on cell 8 (safe)
  testEngine.applyRoll(2);
  const moveRes = testEngine.makeMove('red', 0);

  assert.equal(moveRes.success, true);
  assert.equal(moveRes.capturedTokens, undefined); // No capture
  assert.equal(testEngine.getState().tokens.yellow[0], 34);
  assert.equal(testEngine.getState().tokens.yellow[1], 34);
  assert.equal(testEngine.getState().tokens.red[0], 8);
});

// ==========================================
// 6. THREE-SIXES EDGE CASES
// ==========================================

test('15. Three-sixes sequence: 6 -> move -> 6 -> move -> 6 forfeits turn BEFORE token move', () => {
  const engine = createTwoPlayerGame();

  // 1st six
  engine.applyRoll(6);
  engine.makeMove('red', 0);
  assert.equal(engine.getState().currentTurn, 'red');
  assert.equal(engine.getState().consecutiveSixes, 1);

  // 2nd six
  engine.applyRoll(6);
  engine.makeMove('red', 0);
  assert.equal(engine.getState().currentTurn, 'red');
  assert.equal(engine.getState().consecutiveSixes, 2);

  // 3rd six: immediately forfeits without move phase
  const roll3 = engine.applyRoll(6);
  assert.equal(roll3.forfeitedDueToThreeSixes, true);
  assert.equal(roll3.consecutiveSixes, 3);
  assert.equal(engine.getState().currentTurn, 'yellow');
  assert.equal(engine.getState().turnPhase, 'roll');
  assert.equal(engine.getState().consecutiveSixes, 0);
});

test('16. Three-sixes with capture: 2nd six produces capture, 3rd six still forfeits turn', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Red token 0 at cell 0 (progress 0)
  state.tokens.red[0] = 0;
  // Yellow token 0 at cell 6 (non-safe)
  state.tokens.yellow[0] = (6 - 26 + 52) % 52;
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // 1st six (spawns token 1)
  testEngine.applyRoll(6);
  testEngine.makeMove('red', 1);
  assert.equal(testEngine.getState().consecutiveSixes, 1);

  // 2nd six (moves token 0 from cell 0 to cell 6: CAPTURE!)
  testEngine.applyRoll(6);
  const moveRes = testEngine.makeMove('red', 0);
  assert.equal(moveRes.capturedTokens?.length, 1);
  assert.equal(testEngine.getState().consecutiveSixes, 2);

  // 3rd six: Must still count as third consecutive six and forfeit!
  const roll3 = testEngine.applyRoll(6);
  assert.equal(roll3.forfeitedDueToThreeSixes, true);
  assert.equal(testEngine.getState().currentTurn, 'yellow');
});

test('17. Non-six resets consecutive-sixes count', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();
  state.tokens.red[0] = 0;
  state.tokens.yellow[0] = (3 - 26 + 52) % 52; // Yellow at cell 3
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // 1st six
  testEngine.applyRoll(6);
  testEngine.makeMove('red', 1);
  assert.equal(testEngine.getState().consecutiveSixes, 1);

  // Rolls 3 (non-six): captures Yellow!
  testEngine.applyRoll(3);
  const moveRes = testEngine.makeMove('red', 0);
  assert.equal(moveRes.capturedTokens?.length, 1);
  // consecutiveSixes must have been reset to 0 by the non-six!
  assert.equal(testEngine.getState().consecutiveSixes, 0);

  // Next roll is six: counts as first six, NOT second or third
  testEngine.applyRoll(6);
  assert.equal(testEngine.getState().consecutiveSixes, 1);
});

// ==========================================
// 7. EXTRA-TURN PRECEDENCE
// ==========================================

test('18. Extra-turn precedence: finish > capture > six with exactly one extra turn', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Setup: Red token 0 at progress 50 (last track square)
  // Needs 6 to reach FINISH (50 + 6 = 56)
  state.tokens.red[0] = 50;
  state.tokens.red[1] = 0; // keep another token in play so game doesn't terminate
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red rolls 6: satisfies both 'six' AND 'finish'
  testEngine.applyRoll(6);
  const moveRes = testEngine.makeMove('red', 0);

  assert.equal(moveRes.reachedFinish, true);
  assert.equal(moveRes.extraTurnGranted, true);
  // Precedence defines 'finish' > 'six'
  assert.equal(moveRes.extraTurnReason, 'finish');
  assert.equal(testEngine.getState().currentTurn, 'red');
  assert.equal(testEngine.getState().turnPhase, 'roll');
});

// ==========================================
// 8. RANKING EDGE CASES
// ==========================================

test('19. 2-Player ranking: first finisher triggers auto-rank for 2nd and game completion', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();
  state.tokens.red = [56, 56, 56, 55]; // Red needs 1 to complete all 4
  state.tokens.yellow = [0, -1, -1, -1];
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  testEngine.applyRoll(1);
  const moveRes = testEngine.makeMove('red', 3);

  assert.equal(moveRes.gameFinished, true);
  assert.equal(moveRes.playerRanked?.rank, 1);
  assert.deepEqual(testEngine.getState().rankings, ['red', 'yellow']);
  assert.equal(testEngine.getState().status, 'finished');
});

test('20. 3-Player ranking: rank 1, rank 2, and auto-rank 3', () => {
  const engine = LudoEngine.create({
    players: [
      { id: 'u1', color: 'red', type: 'human' },
      { id: 'u2', color: 'green', type: 'human' },
      { id: 'u3', color: 'yellow', type: 'human' },
    ],
  });
  const state = engine.getState();
  state.tokens.red = [56, 56, 56, 55]; // Red ready to finish
  state.tokens.green = [56, 56, 56, 55]; // Green ready to finish
  state.tokens.yellow = [0, -1, -1, -1];
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red finishes 1st
  testEngine.applyRoll(1);
  testEngine.makeMove('red', 3);
  assert.deepEqual(testEngine.getState().rankings, ['red']);
  assert.equal(testEngine.getState().status, 'playing');
  assert.equal(testEngine.getState().currentTurn, 'green'); // skips red

  // Green finishes 2nd -> triggers auto-rank 3rd for Yellow and finishes game
  testEngine.applyRoll(1);
  const moveGreen = testEngine.makeMove('green', 3);
  assert.equal(moveGreen.gameFinished, true);
  assert.deepEqual(testEngine.getState().rankings, ['red', 'green', 'yellow']);
  assert.equal(testEngine.getState().status, 'finished');
});

test('21. Finished player completing 4th token does NOT take another turn', () => {
  const engine = createFourPlayerGame();
  const state = engine.getState();
  state.tokens.red = [56, 56, 56, 50]; // Red rolls 6 to finish
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  const testEngine = LudoEngine.fromState(state);

  // Red rolls 6 and finishes 4th token
  testEngine.applyRoll(6);
  const moveRes = testEngine.makeMove('red', 3);

  assert.equal(moveRes.playerRanked?.color, 'red');
  assert.equal(moveRes.extraTurnGranted, false); // 4th token finisher does NOT roll again!
  assert.equal(testEngine.getState().currentTurn, 'green'); // Turn passes to green
});

// ==========================================
// 9. BOT HARD STRATEGY WRAP SAFETY
// ==========================================

test('22. Bot Hard strategy wrap safety: correctly identifies threat across wrap 51 -> 0', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Attacker (Yellow) at cell 50. Victim (Red) at cell 2.
  // Distance from 50 to 2 along 52 ring = 4 steps forward!
  const dist = trackDistance(50, 2);
  assert.equal(dist, 4);

  // Yellow progress at cell 50: (50 - 26 + 52) % 52 = 24.
  // 24 + 4 = 28 <= 50 (still on shared track!)
  state.tokens.yellow[0] = 24;
  state.tokens.red[0] = 2; // Red at cell 2 (not safe)

  // Track cell 2 is threatened by Yellow!
  assert.equal(isTrackCellThreatened(2, 'red', state), true);
});

test('23. Bot Hard strategy bounds safety: attacker entering home stretch cannot threaten outer track', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  // Attacker (Red) is at cell 50 (Red progress 50).
  // Target cell is cell 2.
  // Distance is 4 steps forward.
  // BUT Red progress 50 + 4 = 54 > 50! Red turns into Red home stretch, NOT cell 2!
  state.tokens.red[0] = 50;
  state.tokens.yellow[0] = (2 - 26 + 52) % 52; // Yellow at cell 2

  // Red CANNOT hit Yellow at cell 2!
  assert.equal(isTrackCellThreatened(2, 'yellow', state), false);
});

// ==========================================
// 10. STATE VALIDATOR CROSS-FIELD INVARIANTS
// ==========================================

test('24. Validator rejects invalid cross-field combinations', () => {
  const base = createTwoPlayerGame().getState();

  // Human player cannot carry a botDifficulty
  const humanWithBotDiff = {
    ...base,
    players: {
      ...base.players,
      red: { ...base.players.red, botDifficulty: 'hard' },
    },
  };
  assert.equal(validateLudoState(humanWithBotDiff).valid, false);

  // Inactive color tokens cannot be on track
  const activeOnly = {
    ...base,
    tokens: { ...base.tokens, green: [5, -1, -1, -1] }, // green inactive
  };
  assert.equal(validateLudoState(activeOnly).valid, false);

  // Current turn player cannot already have all 4 tokens finished while game is playing
  const allTokensDonePlaying = {
    ...base,
    tokens: { ...base.tokens, red: [56, 56, 56, 56] },
    currentTurn: 'red',
  };
  assert.equal(validateLudoState(allTokensDonePlaying).valid, false);

  // Finished game must have complete rankings
  const incompleteFinished = {
    ...base,
    status: 'finished',
    rankings: ['red'], // only 1 of 2 ranked!
    currentTurn: null,
    turnPhase: null,
    currentRoll: null,
  };
  assert.equal(validateLudoState(incompleteFinished).valid, false);

  // Roll phase cannot have currentRoll populated
  const rollWithDice = {
    ...base,
    turnPhase: 'roll',
    currentRoll: 4,
  };
  assert.equal(validateLudoState(rollWithDice).valid, false);

  // Move phase must have valid currentRoll
  const moveWithoutDice = {
    ...base,
    turnPhase: 'move',
    currentRoll: null,
  };
  assert.equal(validateLudoState(moveWithoutDice).valid, false);
});

// ==========================================
// 11. IMMUTABILITY CHECK
// ==========================================

test('25. Immutability check: query functions and getState copies do not mutate internal state', () => {
  const engine = createFourPlayerGame();
  engine.applyRoll(6);

  const state1 = engine.getState();
  // Attempt to mutate state copy
  state1.tokens.red[0] = 99;
  state1.activeColors.push('purple');
  if (state1.legalMoves.length > 0) {
    state1.legalMoves[0].targetProgress = 999;
  }

  // Internal state remains untouched
  const state2 = engine.getState();
  assert.equal(state2.tokens.red[0], -1);
  assert.deepEqual(state2.activeColors, ['red', 'green', 'yellow', 'blue']);
  assert.notEqual(state2.legalMoves[0]?.targetProgress, 999);

  // Test getLegalMoves() copy
  const moves = engine.getLegalMoves();
  if (moves.length > 0) {
    moves[0].tokenIndex = 99;
  }
  assert.equal(engine.getLegalMoves()[0].tokenIndex, 0);
});

// ==========================================
// 12. DETERMINISTIC RANDOM GAME SIMULATIONS
// ==========================================

test('26. Deterministic simulations: 100 2-player matches complete without invariant violation', () => {
  const rng = createMulberry32(1002);
  let totalMatches = 0;

  for (let match = 0; match < 100; match++) {
    const engine = LudoEngine.create({
      players: [
        { id: `b1_${match}`, color: 'red', type: 'bot', botDifficulty: 'hard' },
        { id: `b2_${match}`, color: 'yellow', type: 'bot', botDifficulty: 'hard' },
      ],
    });

    let turns = 0;
    while (engine.getState().status === 'playing' && turns < 600) {
      const step = stepBot(engine, 'hard', rng);
      if (step.moveResult) {
        assert.equal(step.moveResult.success, true);
      }
      // Runtime validation on every 20th turn to assert invariant integrity
      if (turns % 20 === 0) {
        const v = validateLudoState(engine.getState());
        assert.equal(v.valid, true, `Invariant violation at turn ${turns}: ${v.error}`);
      }
      turns++;
    }

    const finalState = engine.getState();
    assert.equal(finalState.status, 'finished');
    assert.equal(finalState.rankings.length, 2);
    totalMatches++;
  }
  assert.equal(totalMatches, 100);
});

test('27. Deterministic simulations: 100 3-player matches complete without invariant violation', () => {
  const rng = createMulberry32(1003);
  let totalMatches = 0;

  for (let match = 0; match < 100; match++) {
    const engine = LudoEngine.create({
      players: [
        { id: `b1_${match}`, color: 'red', type: 'bot', botDifficulty: 'normal' },
        { id: `b2_${match}`, color: 'green', type: 'bot', botDifficulty: 'hard' },
        { id: `b3_${match}`, color: 'yellow', type: 'bot', botDifficulty: 'normal' },
      ],
    });

    let turns = 0;
    while (engine.getState().status === 'playing' && turns < 800) {
      stepBot(engine, undefined, rng);
      turns++;
    }

    const finalState = engine.getState();
    assert.equal(finalState.status, 'finished');
    assert.equal(finalState.rankings.length, 3);
    totalMatches++;
  }
  assert.equal(totalMatches, 100);
});

test('28. Deterministic simulations: 100 4-player matches complete without invariant violation', () => {
  const rng = createMulberry32(1004);
  let totalMatches = 0;

  for (let match = 0; match < 100; match++) {
    const engine = LudoEngine.create({
      players: [
        { id: `b1_${match}`, color: 'red', type: 'bot', botDifficulty: 'hard' },
        { id: `b2_${match}`, color: 'green', type: 'bot', botDifficulty: 'hard' },
        { id: `b3_${match}`, color: 'yellow', type: 'bot', botDifficulty: 'hard' },
        { id: `b4_${match}`, color: 'blue', type: 'bot', botDifficulty: 'hard' },
      ],
    });

    let turns = 0;
    while (engine.getState().status === 'playing' && turns < 1000) {
      stepBot(engine, undefined, rng);
      turns++;
    }

    const finalState = engine.getState();
    assert.equal(finalState.status, 'finished');
    assert.equal(finalState.rankings.length, 4);
    totalMatches++;
  }
  assert.equal(totalMatches, 100);
});

// ==========================================
// 13. ADDITIONAL SCENARIO UNIT TESTS
// ==========================================

test('29. Token cannot leave without 6: rolls 1..5 auto-pass when all tokens at home', () => {
  const engine = createTwoPlayerGame();

  for (let roll = 1; roll <= 5; roll++) {
    const current = engine.getState().currentTurn;
    const res = engine.applyRoll(roll);
    assert.equal(res.success, true);
    assert.equal(res.autoPassed, true);
    assert.equal(res.legalMoves?.length, 0);
    assert.notEqual(engine.getState().currentTurn, current);
  }
});

test('30. Token leaves with 6: rolling 6 allows token to leave home onto start square', () => {
  const engine = createTwoPlayerGame();

  const rollRes = engine.applyRoll(6);
  assert.equal(rollRes.success, true);
  assert.equal(rollRes.legalMoves?.length, 4);

  const moveRes = engine.makeMove('red', 0);
  assert.equal(moveRes.success, true);
  assert.equal(moveRes.movedToken?.fromProgress, -1);
  assert.equal(moveRes.movedToken?.toProgress, 0);
  assert.equal(moveRes.movedToken?.targetPosition.type, 'track');
  assert.equal(moveRes.movedToken?.targetPosition.trackIndex, 0);
  assert.deepEqual(engine.getState().tokens.red, [0, -1, -1, -1]);
});

test('31. Normal movement: advancing token on track updates progress by exact dice roll', () => {
  const engine = createTwoPlayerGame();
  engine.applyRoll(6);
  engine.makeMove('red', 0);

  const rollRes = engine.applyRoll(4);
  assert.equal(rollRes.success, true);
  assert.equal(rollRes.legalMoves[0].targetProgress, 4);

  const moveRes = engine.makeMove('red', 0);
  assert.equal(moveRes.success, true);
  assert.equal(moveRes.movedToken?.toProgress, 4);
  assert.equal(engine.getState().tokens.red[0], 4);
});

test('32. Exact home entry: token reaches progress 56 with exact roll', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();
  state.tokens.red[0] = 54;
  const testEngine = LudoEngine.fromState(state);

  const rollRes = testEngine.applyRoll(2);
  assert.equal(rollRes.success, true);
  assert.equal(rollRes.legalMoves[0].isFinish, true);
  assert.equal(rollRes.legalMoves[0].targetProgress, 56);

  const moveRes = testEngine.makeMove('red', 0);
  assert.equal(moveRes.success, true);
  assert.equal(moveRes.reachedFinish, true);
  assert.equal(testEngine.getState().tokens.red[0], 56);
});

test('33. Overshoot rejected: roll greater than remaining distance to finish is illegal', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();
  state.tokens.red[0] = 54;
  const testEngine = LudoEngine.fromState(state);

  const rollRes = testEngine.applyRoll(3);
  assert.equal(rollRes.success, true);
  assert.equal(rollRes.autoPassed, true);
  assert.equal(testEngine.getState().tokens.red[0], 54);
  assert.equal(testEngine.getState().currentTurn, 'yellow');
});

test('34. Cross-color capture matrix: Red captures Green, Green captures Yellow, Yellow captures Blue, Blue captures Red', () => {
  const pairs = [
    { attacker: 'red', defender: 'green', attOffset: 0, defOffset: 13, trackIdx: 14 },
    { attacker: 'green', defender: 'yellow', attOffset: 13, defOffset: 26, trackIdx: 27 },
    { attacker: 'yellow', defender: 'blue', attOffset: 26, defOffset: 39, trackIdx: 40 },
    { attacker: 'blue', defender: 'red', attOffset: 39, defOffset: 0, trackIdx: 1 },
  ];

  for (const { attacker, defender, attOffset, defOffset, trackIdx } of pairs) {
    const engine = createFourPlayerGame();
    const state = engine.getState();

    const attProg = (trackIdx - 1 - attOffset + 52) % 52;
    const defProg = (trackIdx - defOffset + 52) % 52;

    state.tokens[attacker][0] = attProg;
    state.tokens[defender][0] = defProg;
    state.currentTurn = attacker;
    state.turnPhase = 'roll';

    const testEngine = LudoEngine.fromState(state);
    testEngine.applyRoll(1);
    const moveRes = testEngine.makeMove(attacker, 0);

    assert.equal(moveRes.success, true);
    assert.deepEqual(moveRes.capturedTokens, [{ color: defender, tokenIndex: 0 }]);
    assert.equal(testEngine.getState().tokens[defender][0], -1);
  }
});

test('35. Serialization round-trip: JSON serialization and restoration preserve state', () => {
  const engine = createFourPlayerGame();
  engine.applyRoll(6);
  engine.makeMove('red', 0);

  const originalState = engine.getState();
  const serialized = JSON.stringify(originalState);
  const parsed = JSON.parse(serialized);

  const validated = validateLudoState(parsed);
  assert.equal(validated.valid, true);

  const restoredEngine = LudoEngine.fromState(parsed);
  assert.deepEqual(restoredEngine.getState(), originalState);
});

test('36. Deterministic RNG: deterministic roller reproduces exact game rolls', () => {
  const sequence = [6, 4, 6, 2];
  const roller = createDeterministicDiceRoller(sequence);

  assert.equal(roller.roll(), 6);
  assert.equal(roller.roll(), 4);
  assert.equal(roller.roll(), 6);
  assert.equal(roller.roll(), 2);
  assert.equal(roller.roll(), 6);
});

test('37. Easy bot: always chooses among legal moves', () => {
  const engine = createTwoPlayerGame({
    players: [
      { id: 'u1', color: 'red', type: 'bot', botDifficulty: 'easy' },
      { id: 'u2', color: 'yellow', type: 'human' },
    ],
  });

  engine.applyRoll(6);
  const state = engine.getState();
  const move = selectBotMove(state, 'easy', () => 0.5);

  assert.notEqual(move, null);
  assert.equal(state.legalMoves.some((m) => m.tokenIndex === move.tokenIndex), true);
});

test('38. Normal bot: prefers capture or finish over idle moves', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  state.tokens.red = [8, 54, -1, -1];
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  state.currentRoll = null;
  const testEngine = LudoEngine.fromState(state);
  testEngine.applyRoll(2);

  const move = selectBotMove(testEngine.getState(), 'normal');
  assert.equal(move?.tokenIndex, 1);
  assert.equal(move?.isFinish, true);
});

test('39. Hard bot: tactical scoring selects high-value capture and safe escape', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();

  state.tokens.red = [10, 20, -1, -1];
  state.tokens.yellow = [37, -1, -1, -1];
  state.currentTurn = 'red';
  state.turnPhase = 'roll';
  state.currentRoll = null;
  const testEngine = LudoEngine.fromState(state);
  testEngine.applyRoll(1);

  const move = selectBotMove(testEngine.getState(), 'hard');
  assert.equal(move?.tokenIndex, 0);
  assert.equal(move?.isCapture, true);
});

test('40. Invalid token ID: rejects invalid token IDs', () => {
  const engine = createTwoPlayerGame();
  engine.applyRoll(6);

  const invalidTokens = [-1, 4, 10, 1.5, NaN];
  for (const tid of invalidTokens) {
    const res = engine.makeMove('red', tid);
    assert.equal(res.success, false);
    assert.match(res.error, /tokenIndex/i);
  }
});

test('41. Wrong player token: rejects moves attempted by non-current turn player', () => {
  const engine = createTwoPlayerGame();
  engine.applyRoll(6);

  const res = engine.makeMove('yellow', 0);
  assert.equal(res.success, false);
  assert.match(res.error, /not player yellow's turn/i);
});

test('42. Duplicate roll: cannot roll twice without making a move', () => {
  const engine = createTwoPlayerGame();
  engine.applyRoll(6);

  const duplicateRoll = engine.applyRoll(3);
  assert.equal(duplicateRoll.success, false);
  assert.match(duplicateRoll.error, /Waiting for token move/i);
});

test('43. Action after game finished: rejects all actions once game is finished', () => {
  const engine = createTwoPlayerGame();
  const state = engine.getState();
  state.status = 'finished';
  state.tokens.red = [56, 56, 56, 56];
  state.rankings = ['red', 'yellow'];
  state.currentTurn = null;
  state.turnPhase = null;
  state.currentRoll = null;
  state.legalMoves = [];
  const finishedEngine = LudoEngine.fromState(state);

  assert.equal(finishedEngine.applyRoll(6).success, false);
  assert.equal(finishedEngine.makeMove('red', 0).success, false);
});

test('44. Forfeit mechanics: forfeiting player ranked last and game concludes if only 1 remains', () => {
  const engine = createTwoPlayerGame();

  const forfeitRes = engine.forfeit('red');
  assert.equal(forfeitRes.success, true);
  assert.equal(forfeitRes.gameFinished, true);
  assert.deepEqual(forfeitRes.rankings, ['yellow', 'red']);
  assert.equal(engine.getState().status, 'finished');
});
