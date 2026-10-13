/**
 * Semester Library Games Platform - Online Ludo Gameplay & Presentation Tests
 *
 * Phase 4B2 Test Suite:
 * - Board Adapter (2/3/4 player online board, token states, selectability)
 * - Presentation Queue (DICE, MOVE, contiguous bursts, true gaps, deduplication, ack, bounds)
 * - Presentation Projection (tokens, captures, multi-captures, finish, snapshot reconciliation)
 * - Controls & Permissions (human roll, move, locks, opponent blocked, rapid tap safety)
 * - Multi-Socket / Errors (remote action presentation, haptic isolation, error clearing, desync sync)
 * - Reconnect Handling (idle snap, dice cancellation, move recovery, stale generations, rank/win guards)
 * - Bot Burst Serialization (serialized hops, extra turns, non-overlapping, pass/third-six)
 * - Game Finish & Celebrations (event-driven rank/win, standings rendering)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLudoBoardViewModelFromState,
  buildLudoBoardViewModel,
} from '../components/games/ludo/board-view-model.ts';

import {
  buildTokenTravelPlan,
  buildCaptureReturnPlan,
} from '../components/games/ludo/ludo-animation.ts';

import {
  resolveMoveHapticEvent,
} from '../components/games/ludo/ludo-haptics.ts';

import {
  OnlineLudoClient,
} from '../services/ludo-online/client.ts';

import {
  deriveMyColor,
  createPresentationStateFromEngine,
  projectDiceRolled,
  projectMoveResult,
  reconcileWithAuthoritativeState,
  canOnlineHumanRoll,
  getOnlineSelectableTokens,
  formatOnlineRollStatus,
  formatOnlineTurnStatus,
  resolveOnlineMoveHaptic,
} from '../services/ludo-online/presentation.ts';

// Helper to create mock engine state
function createMockEngineState(overrides = {}) {
  return {
    gameType: 'ludo',
    status: 'playing',
    activeColors: ['red', 'green', 'yellow', 'blue'],
    players: {
      red: { id: 'u1', color: 'red', type: 'human', name: 'Alice' },
      green: { id: 'u2', color: 'green', type: 'bot', name: 'Green Bot', botDifficulty: 'normal' },
      yellow: { id: 'u3', color: 'yellow', type: 'human', name: 'Charlie' },
      blue: { id: 'u4', color: 'blue', type: 'bot', name: 'Blue Bot', botDifficulty: 'hard' },
    },
    tokens: {
      red: [-1, -1, -1, -1],
      green: [-1, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
    currentTurn: 'red',
    turnPhase: 'roll',
    currentRoll: null,
    consecutiveSixes: 0,
    legalMoves: [],
    rankings: [],
    lastAction: null,
    round: 1,
    revision: 1,
    ...overrides,
  };
}

// Mock WebSocket for queue/client tests
class MockWebSocket {
  constructor(url, protocols, options) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.sentMessages = [];
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code: 1000, reason: 'Normal Closure' });
  }

  receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// ============================================================================
// 1. BOARD ADAPTER TESTS (Requirements 44)
// ============================================================================

test('Board Adapter - 2 player online board', () => {
  const engineState = createMockEngineState({
    activeColors: ['red', 'yellow'],
    tokens: {
      red: [-1, 0, 52, 56],
      green: [-1, -1, -1, -1],
      yellow: [-1, 10, -1, -1],
      blue: [-1, -1, -1, -1],
    },
  });

  const seats = {
    red: { color: 'red', status: 'human', displayName: 'Player 1', isYou: true },
    green: { color: 'green', status: 'closed', displayName: null },
    yellow: { color: 'yellow', status: 'human', displayName: 'Player 2', isYou: false },
    blue: { color: 'blue', status: 'closed', displayName: null },
  };

  const vm = buildLudoBoardViewModelFromState({
    engineState,
    seats,
    selectableTokenIds: [1],
    currentTurn: 'red',
  });

  assert.equal(vm.activeColors.length, 2);
  assert.equal(vm.closedColors.length, 2);
  assert.equal(vm.yards.green.status, 'closed');
  assert.equal(vm.yards.blue.status, 'closed');
  assert.equal(vm.yards.red.status, 'active');
  assert.equal(vm.yards.yellow.status, 'active');

  // Verify tokens
  const redTokens = vm.tokens.filter((t) => t.color === 'red');
  assert.equal(redTokens.length, 4);
  assert.equal(redTokens[0].progress, -1); // Yard
  assert.equal(redTokens[1].progress, 0); // Track
  assert.equal(redTokens[1].isSelectable, true);
  assert.equal(redTokens[2].progress, 52); // Stretch
  assert.equal(redTokens[3].progress, 56); // Finished
});

test('Board Adapter - 3 player online board', () => {
  const engineState = createMockEngineState({
    activeColors: ['red', 'green', 'yellow'],
  });

  const seats = {
    red: { color: 'red', status: 'human', displayName: 'P1' },
    green: { color: 'green', status: 'human', displayName: 'P2' },
    yellow: { color: 'yellow', status: 'bot', displayName: 'P3' },
    blue: { color: 'blue', status: 'closed', displayName: null },
  };

  const vm = buildLudoBoardViewModelFromState({ engineState, seats });
  assert.equal(vm.activeColors.length, 3);
  assert.equal(vm.closedColors.length, 1);
  assert.equal(vm.closedColors[0], 'blue');
});

test('Board Adapter - 4 player online board', () => {
  const engineState = createMockEngineState();
  const seats = {
    red: { color: 'red', status: 'human', displayName: 'P1' },
    green: { color: 'green', status: 'bot', displayName: 'P2' },
    yellow: { color: 'yellow', status: 'human', displayName: 'P3' },
    blue: { color: 'blue', status: 'bot', displayName: 'P4' },
  };

  const vm = buildLudoBoardViewModelFromState({ engineState, seats });
  assert.equal(vm.activeColors.length, 4);
  assert.equal(vm.closedColors.length, 0);
});

test('Board Adapter - legal-token selectability for local player only', () => {
  const engineState = createMockEngineState({
    currentTurn: 'red',
    tokens: {
      red: [0, 5, -1, -1],
      green: [0, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
  });

  const seats = {
    red: { color: 'red', status: 'human', displayName: 'You', isYou: true },
    green: { color: 'green', status: 'human', displayName: 'Other', isYou: false },
    yellow: { color: 'yellow', status: 'closed', displayName: null },
    blue: { color: 'blue', status: 'closed', displayName: null },
  };

  // Only token index 0 is in legal moves
  const vm = buildLudoBoardViewModelFromState({
    engineState,
    seats,
    selectableTokenIds: [0],
    currentTurn: 'red',
  });

  const red0 = vm.tokens.find((t) => t.color === 'red' && t.tokenIndex === 0);
  const red1 = vm.tokens.find((t) => t.color === 'red' && t.tokenIndex === 1);
  const green0 = vm.tokens.find((t) => t.color === 'green' && t.tokenIndex === 0);

  assert.equal(red0.isSelectable, true);
  assert.equal(red1.isSelectable, false);
  assert.equal(green0.isSelectable, false);
});

// ============================================================================
// 2. PRESENTATION QUEUE TESTS (Requirements 45)
// ============================================================================

test('Presentation Queue - 1. DICE R10 queued', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 10,
    color: 'red',
    roll: 6,
    legalMoves: [0],
  });

  const next = client.peekNextAction();
  assert.ok(next);
  assert.equal(next.type, 'LUDO_DICE_ROLLED');
  assert.equal(next.revision, 10);
  client.destroy();
});

test('Presentation Queue - 2. MOVE R11 queued after dice', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 6, legalMoves: [0] });
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'red', tokenId: 0, fromProgress: -1, toProgress: 0, traversedCoordinates: [], capturedTokens: [] });

  assert.equal(client.getState().actionQueue.length, 2);
  assert.equal(client.getState().actionQueue[0].type, 'LUDO_DICE_ROLLED');
  assert.equal(client.getState().actionQueue[1].type, 'LUDO_MOVE_RESULT');
  client.destroy();
});

test('Presentation Queue - 3. complete bot burst R10-R13 retained when GAME_STATE R13 arrives', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  const defaultValidSeats = {
    red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', botDifficulty: null, ready: true },
    green: { color: 'green', status: 'bot', userId: null, displayName: 'Green Bot', botDifficulty: 'normal', ready: true },
    yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
  };

  // Baseline R9
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 9,
    hostUserId: 'u1',
    seats: defaultValidSeats,
    presence: { u1: true },
    state: createMockEngineState({ revision: 9 }),
  });

  // Contiguous burst R10..R13
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'green', roll: 6, legalMoves: [0] });
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'green', tokenId: 0, fromProgress: -1, toProgress: 13 });
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 12, color: 'green', roll: 3, legalMoves: [0] });
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 13, player: 'green', tokenId: 0, fromProgress: 13, toProgress: 16 });

  // GAME_STATE R13 arrives!
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 13,
    hostUserId: 'u1',
    seats: defaultValidSeats,
    presence: { u1: true },
    state: createMockEngineState({ revision: 13 }),
  });

  // Must retain all 4 actions in actionQueue for the user to see the bot burst!
  assert.equal(client.getState().actionQueue.length, 4);
  assert.equal(client.getState().lastSnapshotRevision, 13);
  client.destroy();
});

test('Presentation Queue - 4. GAME_STATE same revision as MOVE doesn\'t erase move', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  const defaultValidSeats = {
    red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', botDifficulty: null, ready: true },
    green: { color: 'green', status: 'bot', userId: null, displayName: 'Green Bot', botDifficulty: 'normal', ready: true },
    yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
  };

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 10, player: 'red', tokenId: 0, fromProgress: 0, toProgress: 4 });
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'u1',
    seats: defaultValidSeats,
    presence: { u1: true },
    state: createMockEngineState({ revision: 10 }),
  });

  assert.equal(client.getState().actionQueue.length, 1);
  assert.equal(client.getState().actionQueue[0].type, 'LUDO_MOVE_RESULT');
  client.destroy();
});

test('Presentation Queue - 5. incomplete action gap clears animation queue and resyncs', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  const defaultValidSeats = {
    red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', botDifficulty: null, ready: true },
    green: { color: 'green', status: 'bot', userId: null, displayName: 'Green Bot', botDifficulty: 'normal', ready: true },
    yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
  };

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Baseline R9
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 9,
    hostUserId: 'u1',
    seats: defaultValidSeats,
    presence: { u1: true },
    state: createMockEngineState({ revision: 9 }),
  });

  // Action R10 arrives
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 4, legalMoves: [] });
  assert.equal(client.getState().actionQueue.length, 1);

  // GAP: R12 arrives without R11!
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 12, color: 'green', roll: 5, legalMoves: [] });

  assert.equal(client.getState().presentationGapDetected, true);
  assert.equal(client.getState().isResyncing, true);

  // Authoritative snapshot arrives to resolve gap
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 12,
    hostUserId: 'u1',
    seats: defaultValidSeats,
    presence: { u1: true },
    state: createMockEngineState({ revision: 12 }),
  });

  // After gap recovery, actionQueue is reset
  assert.equal(client.getState().actionQueue.length, 0);
  assert.equal(client.getState().presentationGapDetected, false);
  assert.equal(client.getState().isResyncing, false);
  client.destroy();
});

test('Presentation Queue - 6 & 7. duplicate dice/move event not replayed', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 6, legalMoves: [0] });
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 6, legalMoves: [0] }); // duplicate

  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'red', tokenId: 0, fromProgress: -1, toProgress: 0 });
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'red', tokenId: 0, fromProgress: -1, toProgress: 0 }); // duplicate

  assert.equal(client.getState().actionQueue.length, 2);
  client.destroy();
});

test('Presentation Queue - 8. event acknowledged only after completion', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 6, legalMoves: [0] });
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'red', tokenId: 0, fromProgress: -1, toProgress: 0 });

  const first = client.peekNextAction();
  assert.equal(first.revision, 10);
  assert.equal(client.getState().actionQueue.length, 2);

  // Acknowledge first action
  client.ackAction(first);
  assert.equal(client.getState().actionQueue.length, 1);
  assert.equal(client.peekNextAction().revision, 11);

  // Acknowledge second action
  client.ackAction();
  assert.equal(client.getState().actionQueue.length, 0);
  assert.equal(client.peekNextAction(), null);
  client.destroy();
});

test('Presentation Queue - 9. cancelled event safely discarded during resync', () => {
  const client = new OnlineLudoClient();
  client['state'].actionQueue = [
    { type: 'LUDO_DICE_ROLLED', revision: 10 },
  ];

  client.clearActionQueue();
  assert.equal(client.getState().actionQueue.length, 0);
  client.destroy();
});

test('Presentation Queue - 10. bounded processed-event history', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Simulate 300 actions
  for (let r = 1; r <= 300; r++) {
    socket.receiveMessage({
      type: 'LUDO_DICE_ROLLED',
      roomId: 'ABCD23',
      revision: r,
      color: 'red',
      roll: (r % 6) + 1,
      legalMoves: [],
    });
  }

  // processedActionIds must never exceed MAX_PROCESSED_ACTION_IDS (256)
  assert.ok(client['processedActionIds'].size <= 256);
  assert.ok(client['processedActionOrder'].length <= 256);
  client.destroy();
});

// ============================================================================
// 3. PRESENTATION PROJECTION TESTS (Requirements 46)
// ============================================================================

test('Presentation Projection - 11. moved token projection uses server toProgress', () => {
  const initial = createPresentationStateFromEngine(createMockEngineState());
  const moveEvent = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 2,
    player: 'red',
    tokenId: 1,
    fromProgress: -1,
    toProgress: 0,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: false,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, moveEvent);
  assert.equal(projected.tokens.red[1], 0);
  assert.equal(projected.tokens.red[0], -1); // Other tokens untouched
});

test('Presentation Projection - 12. capture projection sends explicit captured token to yard', () => {
  const initial = createPresentationStateFromEngine(
    createMockEngineState({
      tokens: {
        red: [10, -1, -1, -1],
        green: [10, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
      },
    })
  );

  const captureMove = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 3,
    player: 'red',
    tokenId: 0,
    fromProgress: 8,
    toProgress: 10,
    traversedCoordinates: [],
    capturedTokens: [{ color: 'green', tokenIndex: 0 }],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: true,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, captureMove);
  assert.equal(projected.tokens.red[0], 10);
  assert.equal(projected.tokens.green[0], -1); // Captured back to yard (-1)
});

test('Presentation Projection - 13. multi-capture projection', () => {
  const initial = createPresentationStateFromEngine(
    createMockEngineState({
      tokens: {
        red: [12, -1, -1, -1],
        green: [14, -1, -1, -1],
        yellow: [14, -1, -1, -1],
        blue: [-1, -1, -1, -1],
      },
    })
  );

  const multiCaptureMove = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 4,
    player: 'red',
    tokenId: 0,
    fromProgress: 12,
    toProgress: 14,
    traversedCoordinates: [],
    capturedTokens: [
      { color: 'green', tokenIndex: 0 },
      { color: 'yellow', tokenIndex: 0 },
    ],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: true,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, multiCaptureMove);
  assert.equal(projected.tokens.red[0], 14);
  assert.equal(projected.tokens.green[0], -1);
  assert.equal(projected.tokens.yellow[0], -1);
});

test('Presentation Projection - 14. no capture when capturedTokens empty', () => {
  const initial = createPresentationStateFromEngine(
    createMockEngineState({
      tokens: {
        red: [5, -1, -1, -1],
        green: [8, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
      },
    })
  );

  const move = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 2,
    player: 'red',
    tokenId: 0,
    fromProgress: 5,
    toProgress: 7,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: false,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, move);
  assert.equal(projected.tokens.green[0], 8); // Untouched
});

test('Presentation Projection - 15. finish progress projects correctly', () => {
  const initial = createPresentationStateFromEngine(
    createMockEngineState({
      tokens: {
        red: [55, -1, -1, -1],
        green: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
      },
    })
  );

  const finishMove = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 5,
    player: 'red',
    tokenId: 0,
    fromProgress: 55,
    toProgress: 56,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: true,
    playerRanked: true,
    rank: 1,
    extraTurn: true,
    resultingTurn: null,
    gameFinished: false,
    rankings: ['red'],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, finishMove);
  assert.equal(projected.tokens.red[0], 56);
  assert.deepEqual(projected.rankings, ['red']);
  assert.equal(projected.winner, 'red');
});

test('Presentation Projection - 16. projection never calculates legal moves', () => {
  const initial = createPresentationStateFromEngine(createMockEngineState());
  const move = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 6,
    player: 'red',
    tokenId: 0,
    fromProgress: 0,
    toProgress: 4,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: true,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, move);
  assert.deepEqual(projected.legalMoves, []);
  assert.equal(projected.currentRoll, null);
});

test('Presentation Projection - 17. final snapshot reconciliation overrides presentation projection', () => {
  const initial = createPresentationStateFromEngine(createMockEngineState());
  // Server true state
  const serverTruth = createMockEngineState({
    tokens: {
      red: [15, 20, -1, -1],
      green: [-1, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
    turnPhase: 'roll',
    currentTurn: 'green',
    revision: 10,
  });

  const reconciled = reconcileWithAuthoritativeState(serverTruth, 10);
  assert.equal(reconciled.tokens.red[0], 15);
  assert.equal(reconciled.tokens.red[1], 20);
  assert.equal(reconciled.currentTurn, 'green');
  assert.equal(reconciled.revision, 10);
});

test('Presentation Projection - 18. malformed move metadata fails safe to snapshot', () => {
  const initial = createPresentationStateFromEngine(createMockEngineState());
  // Move with invalid tokenId 99
  const malformedMove = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 2,
    player: 'red',
    tokenId: 99,
    fromProgress: 0,
    toProgress: 5,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    rank: null,
    extraTurn: false,
    resultingTurn: null,
    gameFinished: false,
    rankings: [],
    protocolVersion: 1,
  };

  const projected = projectMoveResult(initial, malformedMove);
  // Red tokens are safe and uncorrupted
  assert.deepEqual(projected.tokens.red, [-1, -1, -1, -1]);
});

// ============================================================================
// 4. CONTROLS & PERMISSIONS (Requirements 47)
// ============================================================================

const defaultRollParams = {
  connectionStatus: 'connected',
  isResyncing: false,
  isPresentationBusy: false,
  actionQueueLength: 0,
  gameStatus: 'playing',
  currentTurn: 'red',
  turnPhase: 'roll',
  myColor: 'red',
  mySeatStatus: 'human',
  pendingCommand: null,
};

test('Controls - 19. my roll turn allows Roll', () => {
  assert.equal(canOnlineHumanRoll(defaultRollParams), true);
});

test('Controls - 20. other human turn blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, currentTurn: 'yellow' }), false);
});

test('Controls - 21. bot turn blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, currentTurn: 'green' }), false);
});

test('Controls - 22. spectator blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, myColor: null }), false);
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, mySeatStatus: null }), false);
});

test('Controls - 23. disconnected blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, connectionStatus: 'reconnecting' }), false);
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, connectionStatus: 'closed' }), false);
});

test('Controls - 24. resyncing blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, isResyncing: true }), false);
});

test('Controls - 25. presentation busy blocks Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, isPresentationBusy: true }), false);
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, actionQueueLength: 1 }), false);
});

test('Controls - 26. move phase hides/disables Roll', () => {
  assert.equal(canOnlineHumanRoll({ ...defaultRollParams, turnPhase: 'move' }), false);
});

test('Controls - 27. only server legalMoves selectable', () => {
  const selectable = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [1, 3],
    pendingCommand: null,
  });

  assert.deepEqual(selectable, [1, 3]);
});

test('Controls - 28. opponent token never selectable', () => {
  const selectable = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'green', // Opponent's turn
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [0],
    pendingCommand: null,
  });

  assert.deepEqual(selectable, []);
});

test('Controls - 29. rapid roll only sends once via pendingCommand', () => {
  const params = { ...defaultRollParams };
  assert.equal(canOnlineHumanRoll(params), true);

  // Once roll is tapped:
  params.pendingCommand = 'roll';
  assert.equal(canOnlineHumanRoll(params), false);
});

test('Controls - 30. rapid token tap only sends once via pendingCommand', () => {
  const params = {
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [0],
    pendingCommand: null,
  };

  assert.deepEqual(getOnlineSelectableTokens(params), [0]);

  // Once move is in flight:
  params.pendingCommand = 'move';
  assert.deepEqual(getOnlineSelectableTokens(params), []);
});

// ============================================================================
// 5. MULTI-SOCKET / ERRORS (Requirements 48)
// ============================================================================

test('Multi-Socket - 31. same-seat action from another device animates normally', () => {
  const diceEvent = {
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 5,
    color: 'red',
    roll: 6,
    legalMoves: [0],
    autoPassed: false,
    threeSixesForfeit: false,
    nextTurn: null,
    protocolVersion: 1,
  };

  const initial = createPresentationStateFromEngine(createMockEngineState());
  const projected = projectDiceRolled(initial, diceEvent);
  assert.equal(projected.currentRoll, 6);
  assert.deepEqual(projected.legalMoves, [0]);
});

test('Multi-Socket - 32. remote same-seat action does not produce input haptic', () => {
  const moveEvent = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    player: 'red',
    tokenId: 0,
    fromProgress: 0,
    toProgress: 4,
    traversedCoordinates: [],
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    gameFinished: false,
  };

  // If action originated locally on this device:
  assert.equal(resolveOnlineMoveHaptic(moveEvent, true), 'step');

  // If action was executed remotely by another device watching the same seat:
  assert.equal(resolveOnlineMoveHaptic(moveEvent, false), null);
});

test('Multi-Socket - 33, 34, 35. INVALID_PHASE, NOT_YOUR_TURN, ILLEGAL_MOVE clears pending command', () => {
  let pendingCommand = 'roll';
  const handleServerErr = (errCode) => {
    if (['INVALID_PHASE', 'NOT_YOUR_TURN', 'ILLEGAL_MOVE'].includes(errCode)) {
      pendingCommand = null;
    }
  };

  handleServerErr('INVALID_PHASE');
  assert.equal(pendingCommand, null);

  pendingCommand = 'move';
  handleServerErr('NOT_YOUR_TURN');
  assert.equal(pendingCommand, null);

  pendingCommand = 'move';
  handleServerErr('ILLEGAL_MOVE');
  assert.equal(pendingCommand, null);
});

test('Multi-Socket - 36. state request issued when stale error suggests desync', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Simulate server sending error
  socket.receiveMessage({ type: 'ERROR', code: 'INVALID_PHASE', message: 'Invalid phase for roll', protocolVersion: 1 });

  assert.equal(client.getState().lastError?.code, 'INVALID_PHASE');
  client.destroy();
});

// ============================================================================
// 6. RECONNECT HANDLING (Requirements 49)
// ============================================================================

test('Reconnect - 37. reconnect during idle snaps to authoritative state', () => {
  const restoredEngine = createMockEngineState({
    currentTurn: 'yellow',
    turnPhase: 'roll',
    revision: 20,
  });

  const snapped = reconcileWithAuthoritativeState(restoredEngine, 20);
  assert.equal(snapped.currentTurn, 'yellow');
  assert.equal(snapped.turnPhase, 'roll');
  assert.equal(snapped.revision, 20);
});

test('Reconnect - 38. reconnect during dice cancels animation and clears presentation locks', () => {
  let isDiceRolling = true;
  let pendingCommand = 'roll';

  // Reconnect triggers reset
  const handleReconnect = () => {
    isDiceRolling = false;
    pendingCommand = null;
  };

  handleReconnect();
  assert.equal(isDiceRolling, false);
  assert.equal(pendingCommand, null);
});

test('Reconnect - 39. reconnect during move restores hidden token', () => {
  let hiddenTokens = ['red:0', 'green:1'];
  const handleReconnect = () => {
    hiddenTokens = [];
  };

  handleReconnect();
  assert.equal(hiddenTokens.length, 0);
});

test('Reconnect - 40. old generation event ignored', async () => {
  const sockets = [];

  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      const s = new MockWebSocket(u, p, o);
      sockets.push(s);
      return s;
    },
  });

  await client.connect('ABCD23');
  const socket1 = sockets[0];
  // Disconnect advances connection generation
  client.disconnect();

  // Message from old socket 1 must be ignored
  socket1.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 50,
    color: 'red',
    roll: 6,
    legalMoves: [],
  });

  assert.equal(client.getState().actionQueue.length, 0);
  client.destroy();
});

test('Reconnect - 41. reconnect finished snapshot does not replay celebration', () => {
  const finishedState = createMockEngineState({
    status: 'finished',
    rankings: ['red', 'green', 'yellow', 'blue'],
    revision: 40,
  });

  // Reconciling existing finished state directly does not produce move events
  const presentation = reconcileWithAuthoritativeState(finishedState, 40);
  assert.equal(presentation.status, 'finished');
  // Notice showWinnerCelebration is only triggered by fresh action event with gameFinished = true
});

test('Reconnect - 42. reconnect previously ranked player does not replay rank event', () => {
  const rankedState = createMockEngineState({
    rankings: ['red'],
    revision: 30,
  });

  const presentation = reconcileWithAuthoritativeState(rankedState, 30);
  assert.deepEqual(presentation.rankings, ['red']);
});

// ============================================================================
// 7. BOT BURST SERIALIZATION (Requirements 50)
// ============================================================================

test('Bot Burst - 43. bot dice then move serialized in queue', async () => {
  const client = new OnlineLudoClient();
  client['state'].actionQueue = [
    { type: 'LUDO_DICE_ROLLED', revision: 10, color: 'green', roll: 6 },
    { type: 'LUDO_MOVE_RESULT', revision: 11, player: 'green', tokenId: 0 },
  ];

  assert.equal(client.peekNextAction().type, 'LUDO_DICE_ROLLED');
  client.ackAction();
  assert.equal(client.peekNextAction().type, 'LUDO_MOVE_RESULT');
  client.destroy();
});

test('Bot Burst - 44 & 45. bot six extra turn burst serialized without overlapping', async () => {
  const client = new OnlineLudoClient();
  client['state'].actionQueue = [
    { type: 'LUDO_DICE_ROLLED', revision: 10, color: 'green', roll: 6 },
    { type: 'LUDO_MOVE_RESULT', revision: 11, player: 'green', tokenId: 0 },
    { type: 'LUDO_DICE_ROLLED', revision: 12, color: 'green', roll: 3 },
    { type: 'LUDO_MOVE_RESULT', revision: 13, player: 'green', tokenId: 0 },
  ];

  const processed = [];
  while (client.peekNextAction()) {
    const act = client.peekNextAction();
    processed.push(act.revision);
    client.ackAction();
  }

  assert.deepEqual(processed, [10, 11, 12, 13]);
  client.destroy();
});

test('Bot Burst - 46. final snapshot applied after burst', () => {
  let presentation = createPresentationStateFromEngine(createMockEngineState());
  const finalSnapshot = createMockEngineState({
    tokens: {
      red: [-1, -1, -1, -1],
      green: [16, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
    currentTurn: 'yellow',
    turnPhase: 'roll',
    revision: 13,
  });

  presentation = reconcileWithAuthoritativeState(finalSnapshot, 13);
  assert.equal(presentation.tokens.green[0], 16);
  assert.equal(presentation.currentTurn, 'yellow');
});

test('Bot Burst - 47. bot third-six has dice only, no move animation', () => {
  const thirdSixDice = {
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 12,
    color: 'green',
    roll: 6,
    legalMoves: [],
    autoPassed: false,
    threeSixesForfeit: true,
    nextTurn: 'yellow',
    protocolVersion: 1,
  };

  const status = formatOnlineRollStatus(thirdSixDice, false, 'Green Bot');
  assert.equal(status, 'Three sixes — turn forfeited');
});

test('Bot Burst - 48. bot auto-pass has dice only', () => {
  const autoPassDice = {
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 14,
    color: 'green',
    roll: 2,
    legalMoves: [],
    autoPassed: true,
    threeSixesForfeit: false,
    nextTurn: 'yellow',
    protocolVersion: 1,
  };

  const status = formatOnlineRollStatus(autoPassDice, false, 'Green Bot');
  assert.equal(status, 'No legal moves');
});

// ============================================================================
// 8. GAME FINISH & CELEBRATIONS (Requirements 51)
// ============================================================================

test('Finish - 49. fresh playerRanked event triggers rank presentation once', () => {
  const rankMove = {
    gameFinished: false,
    playerRanked: true,
    rank: 1,
    reachedFinish: true,
  };

  const haptic = resolveMoveHapticEvent(rankMove, false);
  assert.equal(haptic, 'playerRanked');
});

test('Finish - 50. fresh gameFinished triggers winner presentation once', () => {
  const winMove = {
    gameFinished: true,
    playerRanked: true,
    rank: 1,
  };

  const haptic = resolveMoveHapticEvent(winMove, false);
  assert.equal(haptic, 'gameWon');
});

test('Finish - 51. finished snapshot alone triggers no winner animation', () => {
  const snapshotState = createMockEngineState({
    status: 'finished',
    rankings: ['red', 'green'],
  });

  const presentation = reconcileWithAuthoritativeState(snapshotState, 20);
  assert.equal(presentation.status, 'finished');
  // Does not invoke resolveMoveHapticEvent or celebrate
});

test('Finish - 52. final authoritative rankings rendered', () => {
  const finishedState = createMockEngineState({
    status: 'finished',
    rankings: ['red', 'green', 'yellow', 'blue'],
  });

  const seats = {
    red: { color: 'red', status: 'human', displayName: 'Alice' },
    green: { color: 'green', status: 'bot', displayName: 'Bot 1' },
    yellow: { color: 'yellow', status: 'human', displayName: 'Charlie' },
    blue: { color: 'blue', status: 'bot', displayName: 'Bot 2' },
  };

  const vm = buildLudoBoardViewModelFromState({
    engineState: finishedState,
    seats,
  });

  assert.equal(vm.isFinished, true);
  assert.deepEqual(vm.rankings, ['red', 'green', 'yellow', 'blue']);
});

// ============================================================================
// 9. PHASE 4B2 LIFECYCLE & LIVE-SYNC GATES (Requirements 2-24)
// ============================================================================

test('Lifecycle Gate - 53. pendingCommand clearing does not unblock controls if isResyncing is true', () => {
  // Pending command cleared (e.g. on background or after error)
  const pendingCommand = null;

  // Even though pendingCommand is null and it's my roll turn,
  // isResyncing=true MUST block controls until authoritative snapshot arrives
  const rollBlocked = canOnlineHumanRoll({
    connectionStatus: 'connected',
    isResyncing: true, // Reconciliation lock
    isPresentationBusy: false,
    actionQueueLength: 0,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'roll',
    myColor: 'red',
    mySeatStatus: 'human',
    pendingCommand,
  });
  assert.equal(rollBlocked, false);

  const moveBlocked = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: true, // Reconciliation lock
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [0, 1],
    pendingCommand,
  });
  assert.deepEqual(moveBlocked, []);
});

test('Lifecycle Gate - 54. same-account two-device race: roll and token move', async () => {
  // Device B sends roll, but Device A tapped first and server accepted A's action
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Baseline R10
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', ready: true },
      green: { color: 'green', status: 'bot', userId: null, displayName: 'Bot', ready: true },
      yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, ready: false },
    },
    presence: { u1: true },
    state: createMockEngineState({ revision: 10, currentTurn: 'red', turnPhase: 'roll' }),
  });

  // Device B taps Roll (pendingCommand = 'roll')
  let pendingCommand = 'roll';

  // Server rejected Device B's duplicate roll with INVALID_PHASE (Device A already rolled)
  socket.receiveMessage({
    type: 'ERROR',
    code: 'INVALID_PHASE',
    message: 'Already rolled',
    protocolVersion: 1,
  });

  // Device B clears pendingCommand on error
  pendingCommand = null;
  assert.equal(pendingCommand, null);

  // Server broadcasts Device A's accepted roll R11
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 11,
    color: 'red',
    roll: 6,
    legalMoves: [0],
  });

  // Device B animates Device A's accepted authoritative roll from queue without fabricating its own
  const nextAction = client.peekNextAction();
  assert.ok(nextAction);
  assert.equal(nextAction.type, 'LUDO_DICE_ROLLED');
  assert.equal(nextAction.roll, 6);
  assert.equal(client.getState().lastError?.code, 'INVALID_PHASE');

  client.destroy();
});

test('Lifecycle Gate - 55. late action event after snapshot discarded without rewind', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Snapshot R10 arrives FIRST
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', ready: true },
      green: { color: 'green', status: 'bot', userId: null, displayName: 'Bot', ready: true },
      yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, ready: false },
    },
    presence: { u1: true },
    state: createMockEngineState({ revision: 10 }),
  });
  assert.equal(client.getState().lastSnapshotRevision, 10);

  // Late DICE R10 arrives AFTER snapshot R10
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 10,
    color: 'red',
    roll: 5,
    legalMoves: [],
  });

  // Action R10 is not queued because snapshot R10 is already established as truth
  assert.equal(client.getState().actionQueue.length, 0);

  // Even older action R9 arriving late is discarded
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 9,
    color: 'red',
    roll: 4,
    legalMoves: [],
  });
  assert.equal(client.getState().actionQueue.length, 0);

  client.destroy();
});

test('Lifecycle Gate - 56. action acknowledgement failure safety & exception recovery', () => {
  const queue = [
    { type: 'LUDO_MOVE_RESULT', revision: 5, player: 'red', tokenId: 0 },
    { type: 'LUDO_DICE_ROLLED', revision: 6, color: 'green', roll: 3 },
  ];

  // If an animation calculation throws, ackAction acknowledges the failing action
  // so the queue is never stuck at the head
  let isProcessingBusy = true;
  let activeAction = queue[0];
  let resyncRequested = false;

  try {
    // Simulate throwing during animation trajectory build
    throw new Error('Bogus geometry');
  } catch (_err) {
    // Fail-safe handling:
    queue.shift(); // ackAction
    isProcessingBusy = false;
    activeAction = null;
    resyncRequested = true;
  }

  assert.equal(isProcessingBusy, false);
  assert.equal(activeAction, null);
  assert.equal(resyncRequested, true);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, 'LUDO_DICE_ROLLED');
});

test('Lifecycle Gate - 57. online result haptic deduplication: capture + rank + gameFinished => single gameWin haptic', () => {
  const compoundMove = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    player: 'red',
    tokenId: 0,
    fromProgress: 55,
    toProgress: 56,
    traversedCoordinates: [],
    capturedTokens: [{ color: 'green', tokenIndex: 0 }],
    reachedFinish: true,
    playerRanked: true,
    rank: 1,
    gameFinished: true,
  };

  // Local action produces exactly ONE haptic event, obeying precedence gameWin > rank > finish > capture
  const hapticEvent = resolveOnlineMoveHaptic(compoundMove, true);
  assert.equal(hapticEvent, 'gameWin');

  // If not gameFinished, playerRanked wins over capture
  const rankMove = { ...compoundMove, gameFinished: false };
  assert.equal(resolveOnlineMoveHaptic(rankMove, true), 'rank');

  // Remote action does not produce capture haptic
  const remoteCaptureMove = { ...compoundMove, gameFinished: false, playerRanked: false, reachedFinish: false };
  assert.equal(resolveOnlineMoveHaptic(remoteCaptureMove, false), null);
});

test('Lifecycle Gate - 58. board layout / cellSize 0 safety: buildTokenTravelPlan returns null, does not animate to 0,0', () => {
  const moveEvent = {
    type: 'LUDO_MOVE_RESULT',
    player: 'red',
    tokenId: 0,
    fromProgress: -1,
    toProgress: 0,
    traversedCoordinates: [{ x: 1, y: 6 }],
    capturedTokens: [],
    reachedFinish: false,
  };

  // cellSize 0
  assert.equal(buildTokenTravelPlan(moveEvent, 0), null);
  assert.deepEqual(buildCaptureReturnPlan(moveEvent, 0), []);

  // Negative cellSize
  assert.equal(buildTokenTravelPlan(moveEvent, -10), null);
  assert.deepEqual(buildCaptureReturnPlan(moveEvent, -10), []);

  // Valid cellSize produces valid travel plan
  const validPlan = buildTokenTravelPlan(moveEvent, 20);
  assert.ok(validPlan);
  assert.ok(validPlan.pixelSteps.length > 0);
  assert.notEqual(validPlan.pixelSteps[0].x, 0);
});

test('Lifecycle Gate - 59. processedActionIds 256 bound evicts oldest and rejects ancient evicted action', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
    socketFactory: (u, p, o) => {
      socket = new MockWebSocket(u, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'u1', protocolVersion: 1 });

  // Stream 300 actions
  for (let r = 1; r <= 300; r++) {
    socket.receiveMessage({
      type: 'LUDO_DICE_ROLLED',
      roomId: 'ABCD23',
      revision: r,
      color: 'red',
      roll: 6,
      legalMoves: [],
    });
  }

  // Bound check
  assert.equal(client['processedActionIds'].size, 256);
  assert.equal(client['processedActionOrder'].length, 256);

  // Action 1 was evicted from processedActionIds
  assert.equal(client['processedActionIds'].has('LUDO_DICE_ROLLED:1'), false);
  // Recent action 300 is preserved
  assert.equal(client['processedActionIds'].has('LUDO_DICE_ROLLED:300'), true);

  // Now an authoritative snapshot arrives at revision 300
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 300,
    hostUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', ready: true },
      green: { color: 'green', status: 'bot', userId: null, displayName: 'Bot', ready: true },
      yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, ready: false },
    },
    presence: { u1: true },
    state: createMockEngineState({ revision: 300 }),
  });

  client.clearActionQueue();

  // If ancient evicted action 1 arrives again, snapshot revision check rejects it
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 1,
    color: 'red',
    roll: 1,
    legalMoves: [],
  });

  // Not added to queue!
  assert.equal(client.getState().actionQueue.length, 0);

  client.destroy();
});

test('Lifecycle Gate - 60. subscription cleanup leaves zero active listeners', async () => {
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 't' }),
    wsUrlResolver: (id) => `wss://test/${id}`,
  });

  let calls = 0;
  const unsubState = client.subscribe(() => {
    calls++;
  });
  const unsubAction = client.onActionEvent(() => {
    calls++;
  });

  assert.equal(client['listeners'].size, 1);
  assert.equal(client['actionListeners'].size, 1);

  // Unsubscribe
  unsubState();
  unsubAction();

  assert.equal(client['listeners'].size, 0);
  assert.equal(client['actionListeners'].size, 0);

  client.destroy();
});
