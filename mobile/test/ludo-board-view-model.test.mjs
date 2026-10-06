import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLudoBoardViewModel,
  buildStaticBoardCells,
  getStackOffset,
  getCoordKey,
  getQuadrantForCoord,
} from '../components/games/ludo/board-view-model.ts';

import {
  PLAYER_COLORS,
  TOTAL_TRACK_CELLS,
  SAFE_TRACK_CELLS,
  START_OFFSETS,
  TRACK_CELL_GRID_COORDINATES,
  HOME_STRETCH_GRID_COORDINATES,
  FINISH_GRID_COORDINATES,
  YARD_GRID_COORDINATES,
  progressToBoardPosition,
  getLogicalGridCoordinates,
} from '../../packages/ludo-engine/src/index.ts';

// Helper to construct mock snapshots for deterministic testing
function createMockSnapshot(overrides = {}) {
  const seats = overrides.seats || [
    { color: 'red', status: 'human', displayName: 'Player Red' },
    { color: 'green', status: 'closed', displayName: 'Green' },
    { color: 'yellow', status: 'bot', displayName: 'Player Yellow', botDifficulty: 'normal' },
    { color: 'blue', status: 'closed', displayName: 'Blue' },
  ];

  const defaultTokens = {
    red: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
  };

  const tokens = overrides.tokens ? { ...defaultTokens, ...overrides.tokens } : defaultTokens;

  return {
    sessionId: 'test-session-board-view',
    schemaVersion: 1,
    createdAt: 1000,
    updatedAt: 2000,
    revision: 1,
    status: overrides.status || 'playing',
    seats,
    engineState: {
      tokens,
      currentTurn: overrides.currentTurn || 'red',
      turnPhase: overrides.turnPhase || 'roll',
      currentRoll: overrides.currentRoll ?? null,
      consecutiveSixes: 0,
      status: overrides.engineStatus || 'playing',
      winner: overrides.winner || null,
      rankings: overrides.rankings || [],
      activeColors: seats.filter((s) => s.status !== 'closed').map((s) => s.color),
    },
    activePlayer: seats.find((s) => s.color === (overrides.currentTurn || 'red')) || seats[0],
    currentTurn: overrides.currentTurn || 'red',
    turnPhase: overrides.turnPhase || 'roll',
    currentRoll: overrides.currentRoll ?? null,
    isBotTurn: overrides.isBotTurn || false,
    legalMoves: overrides.legalMoves || [],
    winner: overrides.winner || null,
    rankings: overrides.rankings || [],
    matchHistorySummary: [],
  };
}

// =========================================================================
// SECTION 25 FIXTURES
// =========================================================================

// Fixture A: Initial 2-player game (Red + Yellow in yards)
const FIXTURE_A = createMockSnapshot({
  seats: [
    { color: 'red', status: 'human', displayName: 'Alice' },
    { color: 'green', status: 'closed', displayName: 'Green' },
    { color: 'yellow', status: 'bot', displayName: 'Bob', botDifficulty: 'hard' },
    { color: 'blue', status: 'closed', displayName: 'Blue' },
  ],
  tokens: {
    red: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1],
  },
  currentTurn: 'red',
});

// Fixture B: Mixed mid-game: Red has tokens at home, track, stretch, finished
const FIXTURE_B = createMockSnapshot({
  seats: [
    { color: 'red', status: 'human', displayName: 'Alice' },
    { color: 'green', status: 'closed', displayName: 'Green' },
    { color: 'yellow', status: 'human', displayName: 'Bob' },
    { color: 'blue', status: 'closed', displayName: 'Blue' },
  ],
  tokens: {
    red: [-1, 10, 52, 56], // home, track 10, stretch 1, finish
    yellow: [-1, 0, 20, 56],
  },
  currentTurn: 'yellow',
});

// Fixture C: Stacked tokens (3 Red tokens on track cell 0)
const FIXTURE_C = createMockSnapshot({
  tokens: {
    red: [0, 0, 0, -1],
    yellow: [-1, -1, -1, -1],
  },
});

// Fixture D: Opposing colors sharing a safe cell (track cell 8: safe star)
// Red progress to reach track cell 8: start is 0, so progress 8.
// Yellow start is 26. Safe cell 8 in yellow progress is (8 - 26 + 52) % 52 = 34.
const FIXTURE_D = createMockSnapshot({
  tokens: {
    red: [8, -1, -1, -1],
    yellow: [34, -1, -1, -1],
  },
});

// Fixture E: All four colors active
const FIXTURE_E = createMockSnapshot({
  seats: [
    { color: 'red', status: 'human', displayName: 'P1' },
    { color: 'green', status: 'human', displayName: 'P2' },
    { color: 'yellow', status: 'bot', displayName: 'Bot3' },
    { color: 'blue', status: 'bot', displayName: 'Bot4' },
  ],
  tokens: {
    red: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
  },
});

// =========================================================================
// SECTION 26 CORE TESTS (ITEMS 1..30)
// =========================================================================

test('1. exactly 52 shared track cells rendered', () => {
  const cells = buildStaticBoardCells();
  let trackCellCount = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (cell.type === 'track') {
        trackCellCount++;
      }
    }
  }
  assert.equal(trackCellCount, 52);
  assert.equal(TOTAL_TRACK_CELLS, 52);
});

test('2. 8 safe cells identified', () => {
  const cells = buildStaticBoardCells();
  const safeTrackIndices = new Set();
  for (const row of cells) {
    for (const cell of row) {
      if (cell.type === 'track' && cell.trackInfo?.isSafe) {
        safeTrackIndices.add(cell.trackInfo.trackIndex);
      }
    }
  }
  assert.equal(safeTrackIndices.size, 8);
  for (const safeIdx of SAFE_TRACK_CELLS) {
    assert.ok(safeTrackIndices.has(safeIdx), `Expected cell ${safeIdx} to be safe`);
  }
});

test('3. 4 start cells identified', () => {
  const cells = buildStaticBoardCells();
  const startTrackIndices = new Map();
  for (const row of cells) {
    for (const cell of row) {
      if (cell.type === 'track' && cell.trackInfo?.isStart) {
        startTrackIndices.set(cell.trackInfo.trackIndex, cell.trackInfo.startColor);
      }
    }
  }
  assert.equal(startTrackIndices.size, 4);
  assert.equal(startTrackIndices.get(START_OFFSETS.red), 'red');
  assert.equal(startTrackIndices.get(START_OFFSETS.green), 'green');
  assert.equal(startTrackIndices.get(START_OFFSETS.yellow), 'yellow');
  assert.equal(startTrackIndices.get(START_OFFSETS.blue), 'blue');
});

test('4. correct Red yard orientation (top-left)', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const redYard = vm.yards.red;
  assert.equal(redYard.color, 'red');
  assert.deepEqual(redYard.bounds, { minX: 0, maxX: 5, minY: 0, maxY: 5 });
  assert.equal(getQuadrantForCoord(0, 0), 'red');
  assert.equal(getQuadrantForCoord(5, 5), 'red');
});

test('5. correct Green yard orientation (top-right)', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const greenYard = vm.yards.green;
  assert.equal(greenYard.color, 'green');
  assert.deepEqual(greenYard.bounds, { minX: 9, maxX: 14, minY: 0, maxY: 5 });
  assert.equal(getQuadrantForCoord(9, 0), 'green');
  assert.equal(getQuadrantForCoord(14, 5), 'green');
});

test('6. correct Yellow yard orientation (bottom-right)', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const yellowYard = vm.yards.yellow;
  assert.equal(yellowYard.color, 'yellow');
  assert.deepEqual(yellowYard.bounds, { minX: 9, maxX: 14, minY: 9, maxY: 14 });
  assert.equal(getQuadrantForCoord(9, 9), 'yellow');
  assert.equal(getQuadrantForCoord(14, 14), 'yellow');
});

test('7. correct Blue yard orientation (bottom-left)', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const blueYard = vm.yards.blue;
  assert.equal(blueYard.color, 'blue');
  assert.deepEqual(blueYard.bounds, { minX: 0, maxX: 5, minY: 9, maxY: 14 });
  assert.equal(getQuadrantForCoord(0, 9), 'blue');
  assert.equal(getQuadrantForCoord(5, 14), 'blue');
});

test('8. all 20 stretch cells rendered', () => {
  const cells = buildStaticBoardCells();
  const stretchByColor = { red: 0, green: 0, yellow: 0, blue: 0 };
  for (const row of cells) {
    for (const cell of row) {
      if (cell.type === 'stretch' && cell.stretchInfo) {
        stretchByColor[cell.stretchInfo.color]++;
      }
    }
  }
  assert.equal(stretchByColor.red, 5);
  assert.equal(stretchByColor.green, 5);
  assert.equal(stretchByColor.yellow, 5);
  assert.equal(stretchByColor.blue, 5);
  const total = stretchByColor.red + stretchByColor.green + stretchByColor.yellow + stretchByColor.blue;
  assert.equal(total, 20);
});

test('9. finish regions exist for all colors', () => {
  assert.deepEqual(FINISH_GRID_COORDINATES.red, { x: 6, y: 7 });
  assert.deepEqual(FINISH_GRID_COORDINATES.green, { x: 7, y: 6 });
  assert.deepEqual(FINISH_GRID_COORDINATES.yellow, { x: 8, y: 7 });
  assert.deepEqual(FINISH_GRID_COORDINATES.blue, { x: 7, y: 8 });

  const cells = buildStaticBoardCells();
  assert.equal(cells[7][6].type, 'center');
  assert.equal(cells[7][6].centerColor, 'red');

  assert.equal(cells[6][7].type, 'center');
  assert.equal(cells[6][7].centerColor, 'green');

  assert.equal(cells[7][8].type, 'center');
  assert.equal(cells[7][8].centerColor, 'yellow');

  assert.equal(cells[8][7].type, 'center');
  assert.equal(cells[8][7].centerColor, 'blue');
});

test('10. initial Red token yard positions', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const redTokens = vm.tokens.filter((t) => t.color === 'red');
  assert.equal(redTokens.length, 4);

  for (let i = 0; i < 4; i++) {
    const token = redTokens.find((t) => t.tokenIndex === i);
    assert.ok(token);
    assert.equal(token.progress, -1);
    assert.deepEqual(token.gridCoordinate, YARD_GRID_COORDINATES.red[i]);
  }
});

test('11. initial Yellow token yard positions', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  const yellowTokens = vm.tokens.filter((t) => t.color === 'yellow');
  assert.equal(yellowTokens.length, 4);

  for (let i = 0; i < 4; i++) {
    const token = yellowTokens.find((t) => t.tokenIndex === i);
    assert.ok(token);
    assert.equal(token.progress, -1);
    assert.deepEqual(token.gridCoordinate, YARD_GRID_COORDINATES.yellow[i]);
  }
});

test('12. progress 0 maps to correct start', () => {
  // Red start: cell 0 => (1, 6)
  const redPos = progressToBoardPosition('red', 0, 0);
  assert.deepEqual(getLogicalGridCoordinates(redPos), { x: 1, y: 6 });

  // Green start: cell 13 => (8, 1)
  const greenPos = progressToBoardPosition('green', 0, 0);
  assert.deepEqual(getLogicalGridCoordinates(greenPos), { x: 8, y: 1 });

  // Yellow start: cell 26 => (13, 8)
  const yellowPos = progressToBoardPosition('yellow', 0, 0);
  assert.deepEqual(getLogicalGridCoordinates(yellowPos), { x: 13, y: 8 });

  // Blue start: cell 39 => (6, 13)
  const bluePos = progressToBoardPosition('blue', 0, 0);
  assert.deepEqual(getLogicalGridCoordinates(bluePos), { x: 6, y: 13 });
});

test('13. progress 50 maps to correct final track', () => {
  // Red final track cell: (0 + 50) % 52 = 50 => (0, 7)
  const redPos = progressToBoardPosition('red', 50, 0);
  assert.deepEqual(getLogicalGridCoordinates(redPos), { x: 0, y: 7 });

  // Green final track cell: (13 + 50) % 52 = 11 => (7, 0)
  const greenPos = progressToBoardPosition('green', 50, 0);
  assert.deepEqual(getLogicalGridCoordinates(greenPos), { x: 7, y: 0 });

  // Yellow final track cell: (26 + 50) % 52 = 24 => (14, 7)
  const yellowPos = progressToBoardPosition('yellow', 50, 0);
  assert.deepEqual(getLogicalGridCoordinates(yellowPos), { x: 14, y: 7 });

  // Blue final track cell: (39 + 50) % 52 = 37 => (7, 14)
  const bluePos = progressToBoardPosition('blue', 50, 0);
  assert.deepEqual(getLogicalGridCoordinates(bluePos), { x: 7, y: 14 });
});

test('14. progress 51 maps to correct stretch 0', () => {
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('red', 51, 0)), { x: 1, y: 7 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('green', 51, 0)), { x: 7, y: 1 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('yellow', 51, 0)), { x: 13, y: 7 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('blue', 51, 0)), { x: 7, y: 13 });
});

test('15. progress 55 maps to stretch 4', () => {
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('red', 55, 0)), { x: 5, y: 7 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('green', 55, 0)), { x: 7, y: 5 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('yellow', 55, 0)), { x: 9, y: 7 });
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('blue', 55, 0)), { x: 7, y: 9 });
});

test('16. progress 56 maps to finish', () => {
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('red', 56, 0)), FINISH_GRID_COORDINATES.red);
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('green', 56, 0)), FINISH_GRID_COORDINATES.green);
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('yellow', 56, 0)), FINISH_GRID_COORDINATES.yellow);
  assert.deepEqual(getLogicalGridCoordinates(progressToBoardPosition('blue', 56, 0)), FINISH_GRID_COORDINATES.blue);
});

test('17. 2 tokens grouped', () => {
  const o0 = getStackOffset(0, 2);
  const o1 = getStackOffset(1, 2);

  assert.equal(o0.scaleRatio, 0.74);
  assert.equal(o1.scaleRatio, 0.74);
  // Diagonal symmetry
  assert.equal(o0.offsetXRatio, -0.16);
  assert.equal(o0.offsetYRatio, -0.16);
  assert.equal(o1.offsetXRatio, 0.16);
  assert.equal(o1.offsetYRatio, 0.16);
});

test('18. 3 tokens grouped', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_C);
  // Red tokens 0, 1, 2 are all at progress 0 (track 0 => x=1, y=6)
  const key = '1,6';
  const group = vm.tokensByCellKey[key];
  assert.ok(group);
  assert.equal(group.length, 3);

  group.forEach((t, idx) => {
    assert.equal(t.stackSize, 3);
    assert.equal(t.stackIndex, idx);
    assert.equal(t.scaleRatio, 0.62);
  });
  // Verify triangle geometry
  assert.equal(group[0].offsetXRatio, 0);
  assert.equal(group[0].offsetYRatio, -0.18);
  assert.equal(group[1].offsetXRatio, -0.18);
  assert.equal(group[1].offsetYRatio, 0.16);
  assert.equal(group[2].offsetXRatio, 0.18);
  assert.equal(group[2].offsetYRatio, 0.16);
});

test('19. 4 tokens grouped', () => {
  const fourOffset = [0, 1, 2, 3].map((i) => getStackOffset(i, 4));
  for (const o of fourOffset) {
    assert.equal(o.scaleRatio, 0.56);
  }
  // 2x2 quadrant layout
  assert.deepEqual(fourOffset[0], { offsetXRatio: -0.18, offsetYRatio: -0.18, scaleRatio: 0.56 });
  assert.deepEqual(fourOffset[1], { offsetXRatio: 0.18, offsetYRatio: -0.18, scaleRatio: 0.56 });
  assert.deepEqual(fourOffset[2], { offsetXRatio: -0.18, offsetYRatio: 0.18, scaleRatio: 0.56 });
  assert.deepEqual(fourOffset[3], { offsetXRatio: 0.18, offsetYRatio: 0.18, scaleRatio: 0.56 });
});

test('20. opposing colors coexist on safe square', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_D);
  // Red progress 8 => track 8 (x=6, y=2)
  // Yellow progress 34 => track (26 + 34) % 52 = 8 => (x=6, y=2)
  const key = '6,2';
  const group = vm.tokensByCellKey[key];
  assert.ok(group, 'Expected token group on safe cell (6,2)');
  assert.equal(group.length, 2);

  const colors = group.map((t) => t.color).sort();
  assert.deepEqual(colors, ['red', 'yellow']);

  assert.equal(group[0].stackSize, 2);
  assert.equal(group[1].stackSize, 2);
  assert.notEqual(group[0].offsetXRatio, group[1].offsetXRatio);
});

test('21. 2-player closed colors', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  assert.deepEqual(vm.activeColors.sort(), ['red', 'yellow']);
  assert.deepEqual(vm.closedColors.sort(), ['blue', 'green']);
  assert.equal(vm.yards.red.status, 'active');
  assert.equal(vm.yards.yellow.status, 'active');
  assert.equal(vm.yards.green.status, 'closed');
  assert.equal(vm.yards.blue.status, 'closed');
});

test('22. 3-player closed color', () => {
  const snap = createMockSnapshot({
    seats: [
      { color: 'red', status: 'human', displayName: 'P1' },
      { color: 'green', status: 'human', displayName: 'P2' },
      { color: 'yellow', status: 'bot', displayName: 'P3' },
      { color: 'blue', status: 'closed', displayName: 'P4' },
    ],
  });
  const vm = buildLudoBoardViewModel(snap);
  assert.deepEqual(vm.activeColors.sort(), ['green', 'red', 'yellow']);
  assert.deepEqual(vm.closedColors, ['blue']);
  assert.equal(vm.yards.blue.status, 'closed');
  assert.equal(vm.yards.red.status, 'active');
});

test('23. 4-player all active', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_E);
  assert.equal(vm.activeColors.length, 4);
  assert.equal(vm.closedColors.length, 0);
  for (const color of PLAYER_COLORS) {
    assert.equal(vm.yards[color].status, 'active');
  }
});

test('24. current player flagged', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_A);
  assert.equal(vm.currentTurn, 'red');
  assert.equal(vm.yards.red.isCurrentTurn, true);
  assert.equal(vm.yards.yellow.isCurrentTurn, false);
  assert.equal(vm.yards.green.isCurrentTurn, false);
  assert.equal(vm.yards.blue.isCurrentTurn, false);
});

test('25. deterministic view-model output', () => {
  const vm1 = buildLudoBoardViewModel(FIXTURE_B);
  const vm2 = buildLudoBoardViewModel(FIXTURE_B);
  assert.deepEqual(vm1, vm2);
});

test('26. no engine state mutation', () => {
  const clone = JSON.parse(JSON.stringify(FIXTURE_B));
  buildLudoBoardViewModel(clone);
  assert.deepEqual(clone, FIXTURE_B);
});

test('27. all token render coordinates within board bounds', () => {
  const vm = buildLudoBoardViewModel(FIXTURE_B);
  for (const t of vm.tokens) {
    assert.ok(t.gridCoordinate.x >= 0 && t.gridCoordinate.x <= 14, `Token x=${t.gridCoordinate.x} out of bounds`);
    assert.ok(t.gridCoordinate.y >= 0 && t.gridCoordinate.y <= 14, `Token y=${t.gridCoordinate.y} out of bounds`);
  }
});

test('28. all cell coordinates within 0..14', () => {
  const cells = buildStaticBoardCells();
  assert.equal(cells.length, 15);
  for (let y = 0; y < 15; y++) {
    assert.equal(cells[y].length, 15);
    for (let x = 0; x < 15; x++) {
      assert.equal(cells[y][x].x, x);
      assert.equal(cells[y][x].y, y);
    }
  }
});

test('29. no duplicate shared-track coordinates', () => {
  const seen = new Set();
  TRACK_CELL_GRID_COORDINATES.forEach((c, idx) => {
    const key = `${c.x},${c.y}`;
    assert.ok(!seen.has(key), `Duplicate track coordinate at index ${idx}: ${key}`);
    seen.add(key);
  });
  assert.equal(seen.size, 52);
});

test('30. every active player has exactly four rendered tokens', () => {
  // 2 players active => 8 tokens
  const vm2 = buildLudoBoardViewModel(FIXTURE_A);
  assert.equal(vm2.tokens.length, 8);

  // 4 players active => 16 tokens
  const vm4 = buildLudoBoardViewModel(FIXTURE_E);
  assert.equal(vm4.tokens.length, 16);
  for (const color of PLAYER_COLORS) {
    const playerTokens = vm4.tokens.filter((t) => t.color === color);
    assert.equal(playerTokens.length, 4);
  }
});

test('31. getCoordKey helper works accurately', () => {
  assert.equal(getCoordKey({ x: 0, y: 0 }), '0,0');
  assert.equal(getCoordKey({ x: 14, y: 14 }), '14,14');
  assert.equal(getCoordKey({ x: 7, y: 6 }), '7,6');
});

test('32. single token has scale 1.0 and zero offset', () => {
  const offset = getStackOffset(0, 1);
  assert.equal(offset.scaleRatio, 1.0);
  assert.equal(offset.offsetXRatio, 0);
  assert.equal(offset.offsetYRatio, 0);
});
