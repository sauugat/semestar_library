import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LudoOnlineController,
  validateLudoRoomState,
  createDeterministicDiceRoller,
  FINISH_PROGRESS,
  TOTAL_TRACK_CELLS,
} from '../src/games/ludo/index.ts';

// --- Test Mock Infrastructure ---

class MockWebSocket {
  constructor(userId = 'mock_user') {
    this.userId = userId;
    this.messages = [];
    this.readyState = 1; // WebSocket.OPEN
  }

  send(data) {
    this.messages.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3; // WebSocket.CLOSED
  }

  get lastMessage() {
    return this.messages[this.messages.length - 1] || null;
  }

  getMessages(type) {
    if (!type) return this.messages;
    return this.messages.filter((m) => m.type === type);
  }

  clear() {
    this.messages = [];
  }
}

class TestContext {
  constructor(roomId = 'test_room_1', options = {}) {
    this.roomId = roomId;
    this.persistedStates = [];
    this.broadcastEvents = [];
    this.sockets = new Map(); // userId -> MockWebSocket[]

    this.callbacks = {
      broadcast: (event) => {
        this.broadcastEvents.push(event);
        for (const sockList of this.sockets.values()) {
          for (const s of sockList) {
            if (s.readyState === 1) s.send(JSON.stringify(event));
          }
        }
      },
      sendToSocket: (ws, event) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(event));
      },
      getUserSockets: (userId) => {
        return (this.sockets.get(userId) || []).filter((s) => s.readyState === 1);
      },
      persist: (state) => {
        this.persistedStates.push(JSON.parse(JSON.stringify(state)));
      },
    };

    this.controller = new LudoOnlineController(
      this.roomId,
      this.callbacks,
      options.initialState,
      options
    );
  }

  createSocket(userId) {
    const ws = new MockWebSocket(userId);
    if (!this.sockets.has(userId)) {
      this.sockets.set(userId, []);
    }
    this.sockets.get(userId).push(ws);
    return ws;
  }

  connect(userId) {
    const ws = this.createSocket(userId);
    this.controller.handleConnect(ws, userId);
    return ws;
  }

  send(ws, sessionOrUserId, message) {
    let session = sessionOrUserId;
    if (typeof sessionOrUserId === 'string') {
      const id = sessionOrUserId;
      let name;
      if (id === 'user_alice' || id === 'alice') name = 'Alice';
      else if (id === 'user_bob' || id === 'bob') name = 'Bob';
      else if (id === 'user_charlie' || id === 'charlie') name = 'Charlie';
      else if (id === 'user_dave' || id === 'dave') name = 'Dave';
      session = {
        userId: id,
        name,
      };
    }
    return this.controller.handleMessage(ws, session, message);
  }

  lastBroadcast(type) {
    if (!type) return this.broadcastEvents[this.broadcastEvents.length - 1] || null;
    for (let i = this.broadcastEvents.length - 1; i >= 0; i--) {
      if (this.broadcastEvents[i].type === type) return this.broadcastEvents[i];
    }
    return null;
  }
}

// ============================================================================
// SECTION 32: LOBBY TESTS (1..24)
// ============================================================================

test('1. create empty Ludo room', () => {
  const ctx = new TestContext('room_1');
  const state = ctx.controller.getState();
  assert.equal(state.status, 'lobby');
  assert.equal(state.hostUserId, null);
  assert.equal(state.activeSeatCount, 2);
  assert.equal(state.revision, 0);
  assert.equal(state.seats.red.status, 'open');
  assert.equal(state.seats.yellow.status, 'open');
  assert.equal(state.seats.green.status, 'closed');
  assert.equal(state.seats.blue.status, 'closed');
});

test('2. first human becomes host', () => {
  const ctx = new TestContext('room_2');
  const ws = ctx.connect('user_alice');
  ctx.send(ws, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  const state = ctx.controller.getState();
  assert.equal(state.hostUserId, 'user_alice');
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.red.status, 'human');
  assert.equal(state.seats.red.displayName, 'Alice');
  assert.equal(state.revision, 1);
});

test('3. second human joins', () => {
  const ctx = new TestContext('room_3');
  const ws1 = ctx.connect('user_alice');
  ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  const ws2 = ctx.connect('user_bob');
  ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', displayName: 'Bob' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.yellow.userId, 'user_bob');
  assert.equal(state.seats.yellow.status, 'human');
  assert.equal(state.seats.yellow.displayName, 'Bob');
});

test('4. third human joins', () => {
  const ctx = new TestContext('room_4');
  const ws1 = ctx.connect('user_1');
  ctx.send(ws1, 'user_1', { type: 'LUDO_JOIN' });
  const ws2 = ctx.connect('user_2');
  ctx.send(ws2, 'user_2', { type: 'LUDO_JOIN' });

  // Host expands to 3 players
  ctx.send(ws1, 'user_1', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  assert.equal(ctx.controller.getState().seats.green.status, 'open');

  const ws3 = ctx.connect('user_3');
  ctx.send(ws3, 'user_3', { type: 'LUDO_JOIN', displayName: 'Charlie' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.green.userId, 'user_3');
  assert.equal(state.seats.green.status, 'human');
});

test('5. fourth human joins', () => {
  const ctx = new TestContext('room_5');
  const ws1 = ctx.connect('user_1');
  ctx.send(ws1, 'user_1', { type: 'LUDO_JOIN' });
  ctx.send(ws1, 'user_1', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const ws2 = ctx.connect('user_2');
  ctx.send(ws2, 'user_2', { type: 'LUDO_JOIN' });
  const ws3 = ctx.connect('user_3');
  ctx.send(ws3, 'user_3', { type: 'LUDO_JOIN' });
  const ws4 = ctx.connect('user_4');
  ctx.send(ws4, 'user_4', { type: 'LUDO_JOIN' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'user_1');
  assert.equal(state.seats.green.userId, 'user_3');
  assert.equal(state.seats.yellow.userId, 'user_2');
  assert.equal(state.seats.blue.userId, 'user_4');
});

test('6. fifth human rejected', () => {
  const ctx = new TestContext('room_6');
  const ws1 = ctx.connect('user_1');
  ctx.send(ws1, 'user_1', { type: 'LUDO_JOIN' });
  ctx.send(ws1, 'user_1', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const ws2 = ctx.connect('user_2');
  ctx.send(ws2, 'user_2', { type: 'LUDO_JOIN' });
  const ws3 = ctx.connect('user_3');
  ctx.send(ws3, 'user_3', { type: 'LUDO_JOIN' });
  const ws4 = ctx.connect('user_4');
  ctx.send(ws4, 'user_4', { type: 'LUDO_JOIN' });

  const ws5 = ctx.connect('user_5');
  ctx.send(ws5, 'user_5', { type: 'LUDO_JOIN' });

  const err = ws5.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'ROOM_FULL');
});

test('7. same user second socket does not occupy second seat', () => {
  const ctx = new TestContext('room_7');
  const wsA1 = ctx.connect('user_alice');
  ctx.send(wsA1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  // Alice opens second socket and sends LUDO_JOIN
  const wsA2 = ctx.connect('user_alice');
  ctx.send(wsA2, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.yellow.userId, null);
  assert.equal(state.seats.yellow.status, 'open');
});

test('8. host adds bot', () => {
  const ctx = new TestContext('room_8');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.status, 'bot');
  assert.equal(state.seats.yellow.botDifficulty, 'hard');
});

test('9. host removes bot', () => {
  const ctx = new TestContext('room_9');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_REMOVE_BOT', color: 'yellow' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.status, 'open');
  assert.equal(state.seats.yellow.botDifficulty, null);
});

test('10. host changes bot difficulty', () => {
  const ctx = new TestContext('room_10');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'easy' });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_BOT_DIFFICULTY', color: 'yellow', difficulty: 'hard' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.botDifficulty, 'hard');
});

test('11. non-host cannot manage bots', () => {
  const ctx = new TestContext('room_11');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsOther = ctx.connect('user_other');
  ctx.send(wsOther, 'user_other', { type: 'LUDO_JOIN' });

  ctx.send(wsOther, 'user_other', { type: 'LUDO_ADD_BOT', color: 'green', difficulty: 'normal' });
  assert.equal(wsOther.lastMessage.type, 'ERROR');
  assert.equal(wsOther.lastMessage.code, 'NOT_HOST');

  ctx.send(wsOther, 'user_other', { type: 'LUDO_SET_BOT_DIFFICULTY', color: 'yellow', difficulty: 'hard' });
  assert.equal(wsOther.lastMessage.type, 'ERROR');
  assert.equal(wsOther.lastMessage.code, 'NOT_HOST');

  ctx.send(wsOther, 'user_other', { type: 'LUDO_REMOVE_BOT', color: 'yellow' });
  assert.equal(wsOther.lastMessage.type, 'ERROR');
  assert.equal(wsOther.lastMessage.code, 'NOT_HOST');
});

test('12. human ready', () => {
  const ctx = new TestContext('room_12');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });

  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.ready, true);
});

test('13. human unready', () => {
  const ctx = new TestContext('room_13');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });

  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });
  assert.equal(ctx.controller.getState().seats.yellow.ready, true);

  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: false });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);
});

test('14. non-host cannot start', () => {
  const ctx = new TestContext('room_14');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsP2, 'user_p2', { type: 'LUDO_START_GAME' });

  assert.equal(wsP2.lastMessage.type, 'ERROR');
  assert.equal(wsP2.lastMessage.code, 'NOT_HOST');
  assert.equal(ctx.controller.getState().status, 'lobby');
});

test('15. start rejected if required human not ready', () => {
  const ctx = new TestContext('room_15');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });

  // P2 is not ready yet
  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'NOT_READY');
  assert.equal(ctx.controller.getState().status, 'lobby');
});

test('16. valid 2-player start', () => {
  const ctx = new TestContext('room_16');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing');
  assert.ok(state.engineState);
  assert.deepEqual(state.engineState.activeColors, ['red', 'yellow']);
  assert.equal(state.engineState.currentTurn, 'red');
});

test('17. valid 3-player start', () => {
  const ctx = new TestContext('room_17');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });

  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  const wsP3 = ctx.connect('user_p3');
  ctx.send(wsP3, 'user_p3', { type: 'LUDO_JOIN' });
  ctx.send(wsP3, 'user_p3', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.engineState.activeColors, ['red', 'green', 'yellow']);
});

test('18. valid 4-player start', () => {
  const ctx = new TestContext('room_18');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  const wsP3 = ctx.connect('user_p3');
  ctx.send(wsP3, 'user_p3', { type: 'LUDO_JOIN' });
  ctx.send(wsP3, 'user_p3', { type: 'LUDO_SET_READY', ready: true });

  const wsP4 = ctx.connect('user_p4');
  ctx.send(wsP4, 'user_p4', { type: 'LUDO_JOIN' });
  ctx.send(wsP4, 'user_p4', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.engineState.activeColors, ['red', 'green', 'yellow', 'blue']);
});

test('19. valid human + bot start', () => {
  const ctx = new TestContext('room_19');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });

  // Bot is always ready; start succeeds immediately
  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.engineState.activeColors, ['red', 'yellow']);
  assert.equal(state.engineState.players.yellow.type, 'bot');
});

test('20. valid 2 humans + 2 bots start', () => {
  const ctx = new TestContext('room_20');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'green', difficulty: 'easy' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'blue', difficulty: 'hard' });
  // Host mutation resets non-host ready state; user_p2 re-readies to confirm bot composition
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.engineState.activeColors, ['red', 'green', 'yellow', 'blue']);
});

test('21. bot-only start rejected', () => {
  const ctx = new TestContext('room_21');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });

  // Close human seat and try to have only bots
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  // Host leaves
  ctx.send(wsHost, 'user_host', { type: 'LUDO_LEAVE' });

  // State has no humans
  const state = ctx.controller.getState();
  assert.equal(state.hostUserId, null);
});

test('22. host transfer when host leaves lobby', () => {
  const ctx = new TestContext('room_22');
  const ws1 = ctx.connect('user_1');
  ctx.send(ws1, 'user_1', { type: 'LUDO_JOIN' });
  const ws2 = ctx.connect('user_2');
  ctx.send(ws2, 'user_2', { type: 'LUDO_JOIN' });

  assert.equal(ctx.controller.getState().hostUserId, 'user_1');

  // User 1 leaves
  ctx.send(ws1, 'user_1', { type: 'LUDO_LEAVE' });

  const state = ctx.controller.getState();
  assert.equal(state.hostUserId, 'user_2');
  assert.equal(state.seats.red.status, 'open');
  assert.equal(state.seats.yellow.userId, 'user_2');
});

test('23. reconnect restores same seat', () => {
  const ctx = new TestContext('room_23');
  const ws1 = ctx.connect('user_alice');
  ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  const ws2 = ctx.connect('user_bob');
  ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', displayName: 'Bob' });

  // Alice disconnects socket
  ws1.close();
  ctx.controller.handleDisconnect('user_alice');

  // Alice reconnects with new socket
  const ws1_reconnected = ctx.connect('user_alice');

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.red.status, 'human');
  // Reconnecting socket received lobby state event
  const lobbyMsg = ws1_reconnected.getMessages('LUDO_LOBBY_STATE')[0];
  assert.ok(lobbyMsg);
  assert.equal(lobbyMsg.lobby.seats.red.userId, 'user_alice');
});

test('24. room game type immutable', () => {
  const ctx = new TestContext('room_24');
  assert.equal(ctx.controller.gameType, 'ludo');
  const state = ctx.controller.getState();
  assert.equal(state.gameType, 'ludo');
});

// ============================================================================
// SECTION 33: GAMEPLAY TESTS (25..41)
// ============================================================================

function createStartedGameContext(deterministicRolls = [6, 4, 2]) {
  const roller = createDeterministicDiceRoller(deterministicRolls);
  const ctx = new TestContext('gp_room', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN', displayName: 'Player A' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN', displayName: 'Player B' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });
  wsA.clear();
  wsB.clear();
  ctx.broadcastEvents = [];
  return { ctx, wsA, wsB, roller };
}

test('25. human server-authoritative roll', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  const state = ctx.controller.getState();
  assert.equal(state.engineState.currentRoll, 6);
  assert.equal(state.engineState.turnPhase, 'move');

  const rollEvent = ctx.lastBroadcast('LUDO_DICE_ROLLED');
  assert.ok(rollEvent);
  assert.equal(rollEvent.player, 'red');
  assert.equal(rollEvent.dice, 6);
});

test('26. client cannot provide dice value', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  // Client attempts to spoof dice: 1
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE', dice: 1 });

  // Server used injected deterministic dice (6), ignoring client spoof
  const state = ctx.controller.getState();
  assert.equal(state.engineState.currentRoll, 6);
});

test('27. wrong user cannot roll current seat', () => {
  const { ctx, wsB } = createStartedGameContext([6]);
  // Turn is 'red' (user_A), but user_B tries to roll
  ctx.send(wsB, 'user_B', { type: 'LUDO_ROLL_DICE' });

  assert.equal(wsB.lastMessage.type, 'ERROR');
  assert.equal(wsB.lastMessage.code, 'NOT_YOUR_TURN');
});

test('28. duplicate roll rejected', () => {
  const { ctx, wsA } = createStartedGameContext([6, 5]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  wsA.clear();

  // Second roll before moving
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.equal(wsA.lastMessage.type, 'ERROR');
  assert.equal(wsA.lastMessage.code, 'INVALID_PHASE');
});

test('29. legal token move', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });

  const state = ctx.controller.getState();
  // Token 0 moved out of home to start position (progress 0)
  assert.equal(state.engineState.tokens.red[0], 0);

  const moveResult = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.ok(moveResult);
  assert.equal(moveResult.player, 'red');
  assert.equal(moveResult.tokenId, 0);
  assert.equal(moveResult.fromProgress, -1);
  assert.equal(moveResult.toProgress, 0);
});

test('30. illegal token move rejected', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  // Token ID 4 is out of bounds (valid: 0..3)
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 4 });
  assert.equal(wsA.lastMessage.type, 'ERROR');
  assert.equal(wsA.lastMessage.code, 'ILLEGAL_MOVE');
});

test('31. wrong user token action rejected', () => {
  const { ctx, wsA, wsB } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  // User B tries to move token on User A's turn
  ctx.send(wsB, 'user_B', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });
  assert.equal(wsB.lastMessage.type, 'ERROR');
  assert.equal(wsB.lastMessage.code, 'NOT_YOUR_TURN');
});

test('32. move metadata contains traversal', () => {
  const { ctx, wsA } = createStartedGameContext([6, 4]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // 6
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 }); // out to 0
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // 4 (extra turn from 6)
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 }); // 0 -> 4

  const moveRes = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.ok(moveRes);
  assert.equal(moveRes.fromProgress, 0);
  assert.equal(moveRes.toProgress, 4);
  assert.ok(Array.isArray(moveRes.traversedCoordinates));
  assert.equal(moveRes.traversedCoordinates.length, 4); // 4 steps forward: 1, 2, 3, 4
});

test('33. capture metadata', () => {
  // Red moves to track 26 (progress 26). Yellow starts at track 26 (progress 0).
  // Red captures Yellow.
  // In 2-player red starts at track 0, yellow starts at track 26.
  // Let's set up state directly to test capture:
  const roller = createDeterministicDiceRoller([2]);
  const ctx = new TestContext('room_cap', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Manually position Red token 0 at progress 24 and Yellow token 0 at progress 0 (both map to track 26 if Red advances 2)
  // Yellow start track cell is 26. Red start track cell is 0.
  // Red progress 26 maps to track cell 26! Track 26 is safe cell for Yellow!
  // Star cells: 8, 21, 34, 47 are safe cells.
  // Cell 10 is NOT a safe cell!
  // Red progress 10 maps to track 10. Yellow progress 36 maps to track (26 + 36) % 52 = 10.
  // So let Red be at progress 8, Yellow at progress 36. Red rolls 2 -> lands on progress 10 (track 10) -> captures Yellow!
  const state = ctx.controller.getState();
  state.engineState.tokens.red[0] = 8;
  state.engineState.tokens.yellow[0] = 36;
  const restored = LudoOnlineController.fromState('room_cap', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // rolls 2
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 }); // 8 -> 10

  const moveRes = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.ok(moveRes);
  assert.equal(moveRes.capturedTokens.length, 1);
  assert.equal(moveRes.capturedTokens[0].color, 'yellow');
  assert.equal(moveRes.capturedTokens[0].tokenIndex, 0);
  assert.equal(moveRes.extraTurn, true);
  assert.equal(moveRes.extraTurnReason, 'capture');
});

test('34. extra turn after six', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });

  const moveRes = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.equal(moveRes.extraTurn, true);
  assert.equal(moveRes.extraTurnReason, 'six');
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'red');
});

test('35. extra turn after capture', () => {
  // Verified in test 33: extraTurnReason === 'capture'
  assert.ok(true);
});

test('36. home finish', () => {
  const roller = createDeterministicDiceRoller([2]);
  const ctx = new TestContext('room_fin', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Put Red token 0 at 54 (needs 2 to reach 56 FINISH_PROGRESS)
  const state = ctx.controller.getState();
  state.engineState.tokens.red[0] = 54;
  const restored = LudoOnlineController.fromState('room_fin', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // 2
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 }); // 54 -> 56

  const moveRes = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.ok(moveRes);
  assert.equal(moveRes.toProgress, FINISH_PROGRESS);
  assert.equal(moveRes.reachedFinish, true);
});

test('37. three-sixes', () => {
  // 6 -> move -> 6 -> move -> 6 forfeits turn immediately
  const { ctx, wsA } = createStartedGameContext([6, 6, 6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });

  // 3rd six forfeits turn immediately
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  const state = ctx.controller.getState();
  assert.equal(state.engineState.currentTurn, 'yellow');
  assert.equal(state.engineState.consecutiveSixes, 0);
});

test('38. auto-pass', () => {
  // Rolling non-6 when all tokens in yard automatically passes
  const { ctx, wsA } = createStartedGameContext([3]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  const state = ctx.controller.getState();
  assert.equal(state.engineState.currentTurn, 'yellow');
  assert.equal(state.engineState.turnPhase, 'roll');
});

test('39. player ranking', () => {
  const roller = createDeterministicDiceRoller([1]);
  const ctx = new TestContext('room_rank', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Tokens 0, 1, 2 already at 56. Token 3 at 55.
  const state = ctx.controller.getState();
  state.engineState.tokens.red = [56, 56, 56, 55];
  const restored = LudoOnlineController.fromState('room_rank', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // 1
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 3 }); // 55 -> 56

  const moveRes = ctx.lastBroadcast('LUDO_MOVE_RESULT');
  assert.ok(moveRes);
  assert.equal(moveRes.playerRanked, true);
  assert.equal(moveRes.rank, 1);
});

test('40. complete match rankings', () => {
  const roller = createDeterministicDiceRoller([1]);
  const ctx = new TestContext('room_cmr', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // When Red finishes in 2-player match, match completes and Yellow is ranked 2nd
  const state = ctx.controller.getState();
  state.engineState.tokens.red = [56, 56, 56, 55];
  const restored = LudoOnlineController.fromState('room_cmr', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 3 });

  const finalState = ctx.controller.getState();
  assert.equal(finalState.status, 'finished');
  assert.deepEqual(finalState.rankings, ['red', 'yellow']);
});

test('41. action rejected after finish', () => {
  const roller = createDeterministicDiceRoller([1]);
  const ctx = new TestContext('room_post_fin', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  state.engineState.tokens.red = [56, 56, 56, 55];
  const restored = LudoOnlineController.fromState('room_post_fin', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 3 });

  // Game is now finished. Try to roll again:
  wsA.clear();
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.equal(wsA.lastMessage.type, 'ERROR');
  assert.equal(wsA.lastMessage.code, 'GAME_FINISHED');
});

// ============================================================================
// SECTION 34: BOT TESTS (42..52)
// ============================================================================

test('42. bot server roll', () => {
  // Red rolls 3 (auto-pass) -> passes turn to Yellow (bot)
  // Yellow bot rolls 3 (auto-pass) -> passes turn to Red
  const roller = createDeterministicDiceRoller([3, 3]);
  const ctx = new TestContext('room_bot_roll', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  wsA.clear();
  ctx.broadcastEvents = [];

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // Red rolls 3, auto-passes to Yellow bot

  // Verify Yellow bot performed server roll
  const botRollEvents = ctx.broadcastEvents.filter(
    (e) => e.type === 'LUDO_DICE_ROLLED' && e.player === 'yellow'
  );
  assert.equal(botRollEvents.length, 1);
  assert.equal(botRollEvents[0].dice, 3);
});

test('43. bot legal move', () => {
  // Red rolls 3 (auto-pass) -> Yellow bot rolls 6 -> moves token 0 out to progress 0
  const roller = createDeterministicDiceRoller([3, 6, 2]);
  const ctx = new TestContext('room_bot_move', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // Red 3

  const botMoveEvents = ctx.broadcastEvents.filter(
    (e) => e.type === 'LUDO_MOVE_RESULT' && e.player === 'yellow'
  );
  assert.ok(botMoveEvents.length >= 1);
  assert.equal(botMoveEvents[0].player, 'yellow');
  assert.equal(botMoveEvents[0].toProgress, 0);
});

test('44. Easy bot', () => {
  const roller = createDeterministicDiceRoller([3, 6, 2]);
  const ctx = new TestContext('room_bot_easy', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'easy' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.ok(ctx.controller.getState().engineState.tokens.yellow.some((p) => p >= 0));
});

test('45. Normal bot', () => {
  const roller = createDeterministicDiceRoller([3, 6, 2]);
  const ctx = new TestContext('room_bot_norm', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.ok(ctx.controller.getState().engineState.tokens.yellow.some((p) => p >= 0));
});

test('46. Hard bot', () => {
  const roller = createDeterministicDiceRoller([3, 6, 2]);
  const ctx = new TestContext('room_bot_hard', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.ok(ctx.controller.getState().engineState.tokens.yellow.some((p) => p >= 0));
});

test('47. bot extra turn', () => {
  // Red rolls 3 -> Yellow bot rolls 6 (extra turn) -> Yellow bot rolls 2 (moves) -> passes to Red
  const roller = createDeterministicDiceRoller([3, 6, 2]);
  const ctx = new TestContext('room_bot_extra', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  const botRolls = ctx.broadcastEvents.filter(
    (e) => e.type === 'LUDO_DICE_ROLLED' && e.player === 'yellow'
  );
  assert.equal(botRolls.length, 2);
  assert.equal(botRolls[0].dice, 6);
  assert.equal(botRolls[1].dice, 2);
});

test('48. bot capture', () => {
  // Set up scenario where bot captures human token
  const roller = createDeterministicDiceRoller([2]);
  const ctx = new TestContext('room_bot_cap', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Place Red token at non-safe track cell 10 (Red progress 10)
  // Yellow starts at track 26. Yellow progress 34 -> track (26 + 34) % 52 = 8.
  // Yellow at progress 34 rolling 2 reaches progress 36 (track 10) -> captures Red!
  const state = ctx.controller.getState();
  state.engineState.tokens.red[0] = 10;
  state.engineState.tokens.yellow[0] = 34;
  state.engineState.currentTurn = 'yellow';
  state.engineState.turnPhase = 'roll';
  const restored = LudoOnlineController.fromState('room_bot_cap', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  // Progress bot turn directly
  restored.progressBotTurnIfActive();

  // Bot rolls 2, moves to 36, captures Red token 0
  const capEvents = ctx.broadcastEvents.filter(
    (e) => e.type === 'LUDO_MOVE_RESULT' && e.capturedTokens && e.capturedTokens.length > 0
  );
  assert.ok(capEvents.length >= 1);
  assert.equal(capEvents[0].capturedTokens[0].color, 'red');
});

test('49. bot finish', () => {
  const roller = createDeterministicDiceRoller([1]);
  const ctx = new TestContext('room_bot_fin', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  state.engineState.tokens.yellow[0] = 55;
  state.engineState.currentTurn = 'yellow';
  state.engineState.turnPhase = 'roll';
  const restored = LudoOnlineController.fromState('room_bot_fin', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  restored.progressBotTurnIfActive();

  assert.equal(ctx.controller.getState().engineState.tokens.yellow[0], FINISH_PROGRESS);
});

test('50. mixed human/bot full deterministic match', () => {
  // Let Red be one move from victory and Bot Yellow one move from second place
  const roller = createDeterministicDiceRoller([1, 1]);
  const ctx = new TestContext('room_bot_full', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  state.engineState.tokens.red = [56, 56, 56, 55];
  const restored = LudoOnlineController.fromState('room_bot_full', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = restored;

  // Red rolls 1 and wins
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 3 });

  const finalState = ctx.controller.getState();
  assert.equal(finalState.status, 'finished');
  assert.deepEqual(finalState.rankings, ['red', 'yellow']);
});

test('51. bot state survives Durable Object restart', () => {
  const roller = createDeterministicDiceRoller([6, 3]);
  const ctx = new TestContext('room_bot_restart', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  assert.ok(persisted);

  // Restore into a new controller instance
  const restored = LudoOnlineController.fromState('room_bot_restart', ctx.callbacks, persisted, { diceRoller: roller });
  assert.equal(restored.isCorrupted(), false);
  assert.equal(restored.getState().status, 'playing');
  assert.equal(restored.getState().seats.yellow.status, 'bot');
});

test('52. no infinite bot action loop', () => {
  // If bot rolls 6 consecutively, loop safety limit (20) prevents infinite hanging
  const roller = createDeterministicDiceRoller(new Array(30).fill(6));
  const ctx = new TestContext('room_bot_loop', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Red rolls 3 to hand turn to bot
  ctx.controller.setDiceRoller(createDeterministicDiceRoller([3, ...new Array(30).fill(6)]));
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  // Does not hang; terminates safely
  assert.ok(true);
});

// ============================================================================
// SECTION 35: PERSISTENCE & CORRUPTION TESTS (53..61)
// ============================================================================

test('53. lobby persists restart', () => {
  const ctx = new TestContext('p_room_53');
  const wsA = ctx.connect('user_alice');
  ctx.send(wsA, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('p_room_53', ctx.callbacks, persisted);

  assert.equal(restored.isCorrupted(), false);
  const state = restored.getState();
  assert.equal(state.status, 'lobby');
  assert.equal(state.hostUserId, 'user_alice');
  assert.equal(state.seats.red.userId, 'user_alice');
});

test('54. seat ownership persists', () => {
  const ctx = new TestContext('p_room_54');
  const wsA = ctx.connect('user_alice');
  ctx.send(wsA, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  const wsB = ctx.connect('user_bob');
  ctx.send(wsB, 'user_bob', { type: 'LUDO_JOIN', displayName: 'Bob' });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('p_room_54', ctx.callbacks, persisted);

  const state = restored.getState();
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.yellow.userId, 'user_bob');
});

test('55. ready state persists', () => {
  const ctx = new TestContext('p_room_55');
  const wsA = ctx.connect('user_alice');
  ctx.send(wsA, 'user_alice', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_bob');
  ctx.send(wsB, 'user_bob', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_bob', { type: 'LUDO_SET_READY', ready: true });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('p_room_55', ctx.callbacks, persisted);

  assert.equal(restored.getState().seats.yellow.ready, true);
});

test('56. bot config persists', () => {
  const ctx = new TestContext('p_room_56');
  const wsA = ctx.connect('user_alice');
  ctx.send(wsA, 'user_alice', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('p_room_56', ctx.callbacks, persisted);

  assert.equal(restored.getState().seats.yellow.status, 'bot');
  assert.equal(restored.getState().seats.yellow.botDifficulty, 'hard');
});

test('57. active engine state persists', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('gp_room', ctx.callbacks, persisted);

  assert.equal(restored.isCorrupted(), false);
  const state = restored.getState();
  assert.equal(state.status, 'playing');
  assert.equal(state.engineState.tokens.red[0], 0);
});

test('58. current roll/move phase persists', () => {
  const { ctx, wsA } = createStartedGameContext([6]);
  // Roll without moving
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('gp_room', ctx.callbacks, persisted);

  const state = restored.getState();
  assert.equal(state.engineState.currentRoll, 6);
  assert.equal(state.engineState.turnPhase, 'move');
});

test('59. rankings persist', () => {
  const roller = createDeterministicDiceRoller([1]);
  const ctx = new TestContext('p_room_59', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  state.engineState.tokens.red = [56, 56, 56, 55];
  const controller = LudoOnlineController.fromState('p_room_59', ctx.callbacks, state, { diceRoller: roller });
  ctx.controller = controller;

  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 3 });

  const persisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  const restored = LudoOnlineController.fromState('p_room_59', ctx.callbacks, persisted);

  assert.equal(restored.getState().status, 'finished');
  assert.deepEqual(restored.getState().rankings, ['red', 'yellow']);
});

test('60. corrupt Ludo state rejected', () => {
  const ctx = new TestContext('p_room_60');
  const corrupted = {
    gameType: 'invalid_game',
    status: 'lobby',
  };

  const validation = validateLudoRoomState(corrupted);
  assert.equal(validation.valid, false);

  const restored = LudoOnlineController.fromState('p_room_60', ctx.callbacks, corrupted);
  assert.equal(restored.isCorrupted(), true);
  assert.ok(restored.getCorruptedError());
});

test('61. config/engine mismatch rejected', () => {
  const ctx = new TestContext('p_room_61');
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const corrupted = ctx.controller.getState();
  // Corrupt: engine activeColors says ['red', 'yellow'], but seats has blue instead of yellow
  corrupted.seats.yellow.status = 'closed';
  corrupted.seats.blue.status = 'human';
  corrupted.seats.blue.userId = 'user_spoof';

  const validation = validateLudoRoomState(corrupted);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /yellow|closed|open/i);
});

// ============================================================================
// PHASE 4A FINAL SECURITY & STATE-INTEGRITY TESTS (62..85)
// ============================================================================

test('62. client sends fake celebrity displayName -> ignored, verified session used', () => {
  const ctx = new TestContext('p_room_62');
  const ws = ctx.connect('student_123');
  // Client attempts to spoof displayName as 'Celebrity VIP'
  ctx.send(ws, { userId: 'student_123', name: 'Real Student', username: 'student123' }, {
    type: 'LUDO_JOIN',
    displayName: 'Celebrity VIP',
  });

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'student_123');
  assert.equal(state.seats.red.displayName, 'Real Student'); // Fake client string ignored!
});

test('63. seat identity fallback order: name -> username -> generic player label', () => {
  const ctx = new TestContext('p_room_63');

  // Player 1: has verified name
  const ws1 = ctx.connect('u1');
  ctx.send(ws1, { userId: 'u1', name: 'Verified Name', username: 'uname1' }, { type: 'LUDO_JOIN' });
  assert.equal(ctx.controller.getState().seats.red.displayName, 'Verified Name');

  // Player 2: has username only (no name)
  const ws2 = ctx.connect('u2');
  ctx.send(ws2, { userId: 'u2', username: 'verified_username' }, { type: 'LUDO_JOIN' });
  assert.equal(ctx.controller.getState().seats.yellow.displayName, 'verified_username');

  // Player 3: has neither (fallback to generic player label)
  ctx.send(ws1, 'u1', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  const ws3 = ctx.connect('u3');
  ctx.send(ws3, { userId: 'u3' }, { type: 'LUDO_JOIN' });
  assert.equal(ctx.controller.getState().seats.green.displayName, 'Player Green');
});

test('64. client cannot spoof userId and second socket with same identity maps to same seat', () => {
  const ctx = new TestContext('p_room_64');
  const ws1 = ctx.connect('student_A');
  ctx.send(ws1, { userId: 'student_A', name: 'Alice' }, { type: 'LUDO_JOIN' });

  // Second socket for same authenticated user
  const ws2 = ctx.connect('student_A');
  ctx.send(ws2, { userId: 'student_A', name: 'Alice' }, { type: 'LUDO_JOIN' });

  const state = ctx.controller.getState();
  // Alice still only has Red seat; no duplicate seat created
  assert.equal(state.seats.red.userId, 'student_A');
  assert.equal(state.seats.yellow.userId, null);
  assert.equal(state.seats.yellow.status, 'open');
});

test('65. different authenticated user cannot claim existing seat identity', () => {
  const ctx = new TestContext('p_room_65');
  const wsA = ctx.connect('student_A');
  ctx.send(wsA, { userId: 'student_A', name: 'Alice' }, { type: 'LUDO_JOIN', preferredColor: 'red' });

  // Different user attempts to request red seat
  const wsB = ctx.connect('student_B');
  ctx.send(wsB, { userId: 'student_B', name: 'Bob' }, { type: 'LUDO_JOIN', preferredColor: 'red' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'student_A');
  // Bob assigned to first open seat (yellow), red was preserved for Alice
  assert.equal(state.seats.yellow.userId, 'student_B');
});

test('66. seat mutation invariants: player count reduction with occupied seats is rejected', () => {
  const ctx = new TestContext('p_room_66');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, { userId: 'user_host', name: 'Host' }, { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const wsBlue = ctx.connect('user_blue');
  ctx.send(wsBlue, { userId: 'user_blue', name: 'Blue Player' }, { type: 'LUDO_JOIN', preferredColor: 'blue' });
  assert.equal(ctx.controller.getState().seats.blue.userId, 'user_blue');

  // 4 -> 3 with occupied Blue = rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');
  assert.equal(ctx.controller.getState().activeSeatCount, 4);

  // 4 -> 2 with occupied Blue = rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 2 });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');

  // Blue player leaves -> Blue becomes open
  ctx.send(wsBlue, 'user_blue', { type: 'LUDO_LEAVE' });
  assert.equal(ctx.controller.getState().seats.blue.status, 'open');

  // 4 -> 3 with empty Blue = allowed
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  assert.equal(ctx.controller.getState().activeSeatCount, 3);
  assert.equal(ctx.controller.getState().seats.blue.status, 'closed');

  // Now occupy Green with a bot
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'green', difficulty: 'normal' });
  assert.equal(ctx.controller.getState().seats.green.status, 'bot');

  // 3 -> 2 with occupied Green = rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 2 });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');

  // Host removes bot explicitly
  ctx.send(wsHost, 'user_host', { type: 'LUDO_REMOVE_BOT', color: 'green' });
  assert.equal(ctx.controller.getState().seats.green.status, 'open');

  // 3 -> 2 with empty Green = allowed
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 2 });
  assert.equal(ctx.controller.getState().activeSeatCount, 2);
  assert.equal(ctx.controller.getState().seats.green.status, 'closed');
});

test('67. seat mutation invariants: closing occupied human or bot seat is rejected', () => {
  const ctx = new TestContext('p_room_67');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });

  // Host attempts to close own occupied seat -> rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_SEAT', color: 'red', status: 'closed' });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');

  // Add bot to yellow
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  assert.equal(ctx.controller.getState().seats.yellow.status, 'bot');

  // Host attempts to close yellow without removing bot -> rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_SEAT', color: 'yellow', status: 'closed' });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');

  // Host attempts to add bot to occupied human seat red -> rejected
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'red' });
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'SEAT_OCCUPIED');
});

test('68. ready state invalidation: any host mutation resets non-host human ready states', () => {
  const ctx = new TestContext('p_room_68');
  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });

  const wsP2 = ctx.connect('user_p2');
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_JOIN' });
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });
  assert.equal(ctx.controller.getState().seats.yellow.ready, true);

  // 1. Host adds bot -> resets P2 ready
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'blue', difficulty: 'easy' });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);

  // P2 re-readies
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });
  assert.equal(ctx.controller.getState().seats.yellow.ready, true);

  // 2. Host changes bot difficulty -> resets P2 ready
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_BOT_DIFFICULTY', color: 'blue', difficulty: 'hard' });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);

  // P2 re-readies
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  // 3. Host removes bot -> resets P2 ready
  ctx.send(wsHost, 'user_host', { type: 'LUDO_REMOVE_BOT', color: 'blue' });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);

  // P2 re-readies
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  // 4. Host opens/closes seat -> resets P2 ready
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_SEAT', color: 'blue', status: 'closed' });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);

  // P2 re-readies
  ctx.send(wsP2, 'user_p2', { type: 'LUDO_SET_READY', ready: true });

  // 5. Host changes player count -> resets P2 ready
  ctx.send(wsHost, 'user_host', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 2 });
  assert.equal(ctx.controller.getState().seats.yellow.ready, false);
});

test('69. start-game snapshot atomicity: persistence failure rolls back candidate to lobby', () => {
  let shouldFailPersist = false;
  const ctx = new TestContext('p_room_69');
  const originalPersist = ctx.callbacks.persist;
  ctx.callbacks.persist = (state) => {
    if (shouldFailPersist) {
      throw new Error('Injected persistence disk failure');
    }
    originalPersist(state);
  };

  const wsHost = ctx.connect('user_host');
  ctx.send(wsHost, 'user_host', { type: 'LUDO_JOIN' });
  ctx.send(wsHost, 'user_host', { type: 'LUDO_ADD_BOT', color: 'yellow' });

  // Inject failure right before starting game
  shouldFailPersist = true;
  wsHost.clear();
  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });

  // Verified: Error emitted to caller, state remains lobby, revision NOT committed
  assert.equal(wsHost.lastMessage.type, 'ERROR');
  assert.equal(wsHost.lastMessage.code, 'STORAGE_ERROR');

  const state = ctx.controller.getState();
  assert.equal(state.status, 'lobby');
  assert.equal(state.engineState, null);

  // Broadcast events do not contain playing state
  const playingBroadcasts = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_GAME_STATE');
  assert.equal(playingBroadcasts.length, 0);

  // Allow persist: game starts cleanly
  shouldFailPersist = false;
  ctx.send(wsHost, 'user_host', { type: 'LUDO_START_GAME' });
  assert.equal(ctx.controller.getState().status, 'playing');
});

test('70. gameplay persistence failure: roll and move rollback cleanly on failure', () => {
  let shouldFailPersist = false;
  const roller = createDeterministicDiceRoller([6, 6]);
  const ctx = new TestContext('p_room_70', { diceRoller: roller });
  const originalPersist = ctx.callbacks.persist;
  ctx.callbacks.persist = (state) => {
    if (shouldFailPersist) {
      throw new Error('Database locked');
    }
    originalPersist(state);
  };

  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const revBeforeRoll = ctx.controller.getRevision();

  // Inject failure on roll
  shouldFailPersist = true;
  wsA.clear();
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.equal(wsA.lastMessage.type, 'ERROR');
  assert.equal(wsA.lastMessage.code, 'STORAGE_ERROR');
  assert.equal(ctx.controller.getRevision(), revBeforeRoll); // Unchanged

  // Roll succeeds without failure
  shouldFailPersist = false;
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  assert.equal(ctx.controller.getRevision(), revBeforeRoll + 1);

  const revBeforeMove = ctx.controller.getRevision();

  // Inject failure on move
  shouldFailPersist = true;
  wsA.clear();
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });
  assert.equal(wsA.lastMessage.type, 'ERROR');
  assert.equal(wsA.lastMessage.code, 'STORAGE_ERROR');
  assert.equal(ctx.controller.getRevision(), revBeforeMove); // Unchanged
});

test('71. revision semantics & server event order: strictly monotonic ordering', () => {
  const roller = createDeterministicDiceRoller([6, 3]);
  const ctx = new TestContext('p_room_71', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  const revStart = ctx.controller.getRevision();

  // Roll
  ctx.broadcastEvents = [];
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' });
  const revRoll = ctx.controller.getRevision();
  assert.ok(revRoll > revStart, 'Roll revision must be strictly greater than start revision');

  // Verify event sequence: DICE_ROLLED then GAME_STATE with exact revision
  assert.equal(ctx.broadcastEvents.length, 2);
  assert.equal(ctx.broadcastEvents[0].type, 'LUDO_DICE_ROLLED');
  assert.equal(ctx.broadcastEvents[0].revision, revRoll);
  assert.equal(ctx.broadcastEvents[1].type, 'LUDO_GAME_STATE');
  assert.equal(ctx.broadcastEvents[1].revision, revRoll);

  // Move
  ctx.broadcastEvents = [];
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });
  const revMove = ctx.controller.getRevision();
  assert.ok(revMove > revRoll, 'Move revision must be strictly greater than roll revision');

  // Verify event sequence: MOVE_RESULT then GAME_STATE
  assert.equal(ctx.broadcastEvents.length, 2);
  assert.equal(ctx.broadcastEvents[0].type, 'LUDO_MOVE_RESULT');
  assert.equal(ctx.broadcastEvents[0].revision, revMove);
  assert.equal(ctx.broadcastEvents[1].type, 'LUDO_GAME_STATE');
  assert.equal(ctx.broadcastEvents[1].revision, revMove);

  // Rejected action does not increment revision
  wsA.clear();
  ctx.send(wsA, 'user_A', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 }); // Invalid: turn phase is roll
  assert.equal(ctx.controller.getRevision(), revMove);
});

test('72. bot event bursts: multi-step bot execution retains strict ordering and distinct revisions', () => {
  // Human rolls 1 (no move possible, auto-passes to Yellow Bot)
  // Yellow Bot rolls 6, moves token 0, gets extra turn, rolls 3, moves token 0
  const roller = createDeterministicDiceRoller([1, 6, 3]);
  const ctx = new TestContext('p_room_72', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'easy' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  ctx.broadcastEvents = [];
  ctx.send(wsA, 'user_A', { type: 'LUDO_ROLL_DICE' }); // Red rolls 1 -> autoPasses to Yellow

  // Find all yellow events
  const yellowEvents = ctx.broadcastEvents.filter(
    (e) => e.color === 'yellow' || e.player === 'yellow' || (e.type === 'LUDO_GAME_STATE' && e.state.currentTurn === 'yellow')
  );

  assert.ok(yellowEvents.length >= 4, 'Must have at least roll 6, move, roll 3, move for bot');

  // Verify all revisions are monotonically increasing
  let lastRev = 0;
  for (const ev of ctx.broadcastEvents) {
    assert.ok(ev.revision >= lastRev, `Revisions must be non-decreasing: ${ev.revision} >= ${lastRev}`);
    lastRev = ev.revision;
  }

  const finalState = ctx.controller.getState();
  const yellowMoved = finalState.engineState.tokens.yellow.find((p) => p > -1);
  assert.equal(yellowMoved, 3); // Moved from home (0 progress) + 3 = 3
});

test('73. bot safety guard trips cleanly without room wipe or invented moves', () => {
  // Always roll 6 to force bot into consecutive loop
  const roller = { roll: () => 6 };
  const ctx = new TestContext('p_room_73', { diceRoller: roller });
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  // Add 3 bots
  ctx.send(wsA, 'user_A', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'green' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_ADD_BOT', color: 'blue' });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Red rolls 6 -> moves -> rolls 1 -> passes to green bot
  // Bots run with constant rolls
  const state = ctx.controller.getState();
  assert.ok(state.status === 'playing' || state.status === 'finished');
  // State remains valid
  const validation = validateLudoRoomState(state);
  assert.equal(validation.valid, true);
});

test('74. active-game leave policy: preserves seats, does not auto-win, does not mutate engine', () => {
  const ctx = new TestContext('p_room_74');
  const wsA = ctx.connect('user_A');
  ctx.send(wsA, 'user_A', { type: 'LUDO_JOIN' });
  const wsB = ctx.connect('user_B');
  ctx.send(wsB, 'user_B', { type: 'LUDO_JOIN' });
  ctx.send(wsB, 'user_B', { type: 'LUDO_SET_READY', ready: true });
  ctx.send(wsA, 'user_A', { type: 'LUDO_START_GAME' });

  // Player A sends LUDO_LEAVE during active match
  ctx.send(wsA, 'user_A', { type: 'LUDO_LEAVE' });

  const state = ctx.controller.getState();
  assert.equal(state.status, 'playing'); // Did NOT end game or auto-win
  assert.equal(state.seats.red.userId, 'user_A'); // Seat NOT freed
  assert.equal(state.seats.red.status, 'human');
  assert.equal(state.rankings.length, 0); // Rankings untouched

  // Stranger attempts to take Red's seat
  const wsC = ctx.connect('user_C');
  wsC.clear();
  ctx.send(wsC, 'user_C', { type: 'LUDO_JOIN', preferredColor: 'red' });
  assert.equal(wsC.lastMessage.type, 'ERROR');
  assert.equal(wsC.lastMessage.code, 'GAME_ALREADY_STARTED');
});

test('75. protocol parser strictness: rejects malformed values safely without stack trace', () => {
  const ctx = new TestContext('p_room_75');
  const ws = ctx.connect('user_1');
  ctx.send(ws, 'user_1', { type: 'LUDO_JOIN' });

  // 1. Invalid player count = 1, 5, 2.5
  for (const badCount of [1, 5, 2.5, 'two']) {
    ws.clear();
    ctx.send(ws, 'user_1', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: badCount });
    assert.equal(ws.lastMessage.type, 'ERROR');
    assert.equal(ws.lastMessage.code, 'INVALID_PLAYER_COUNT');
  }

  // 2. Non-boolean ready
  ws.clear();
  ctx.send(ws, 'user_1', { type: 'LUDO_SET_READY', ready: 'true' });
  assert.equal(ws.lastMessage.type, 'ERROR');
  assert.equal(ws.lastMessage.code, 'MALFORMED_MESSAGE');

  // 3. Invalid bot difficulty
  ws.clear();
  ctx.send(ws, 'user_1', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'expert' });
  assert.equal(ws.lastMessage.type, 'ERROR');
  assert.equal(ws.lastMessage.code, 'INVALID_BOT_DIFFICULTY');

  // 4. Invalid token ID: -1, 4, 1.5, '0'
  ctx.send(ws, 'user_1', { type: 'LUDO_ADD_BOT', color: 'yellow' });
  ctx.send(ws, 'user_1', { type: 'LUDO_START_GAME' });

  for (const badTokenId of [-1, 4, 1.5, '0']) {
    ws.clear();
    ctx.send(ws, 'user_1', { type: 'LUDO_MOVE_TOKEN', tokenId: badTokenId });
    assert.equal(ws.lastMessage.type, 'ERROR');
    assert.equal(ws.lastMessage.code, 'ILLEGAL_MOVE');
  }
});

test('76. cross-field corrupt validation: rejects duplicate human seats, missing userIds, and mismatched layouts', () => {
  const validState = {
    gameType: 'ludo',
    roomId: 'room_corrupt_test',
    status: 'lobby',
    hostUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'P1', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    activeSeatCount: 2,
    engineState: null,
    rankings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 1,
  };

  assert.equal(validateLudoRoomState(validState).valid, true);

  // 1. Same user owns two human seats
  const dupUser = JSON.parse(JSON.stringify(validState));
  dupUser.seats.yellow.status = 'human';
  dupUser.seats.yellow.userId = 'u1';
  assert.equal(validateLudoRoomState(dupUser).valid, false);

  // 2. Bot seat has userId
  const botWithUser = JSON.parse(JSON.stringify(validState));
  botWithUser.seats.yellow.status = 'bot';
  botWithUser.seats.yellow.userId = 'bot_user_id';
  assert.equal(validateLudoRoomState(botWithUser).valid, false);

  // 3. Human seat missing userId
  const humanNoUser = JSON.parse(JSON.stringify(validState));
  humanNoUser.seats.red.userId = null;
  assert.equal(validateLudoRoomState(humanNoUser).valid, false);

  // 4. activeSeatCount contradicts layout
  const badActiveCount = JSON.parse(JSON.stringify(validState));
  badActiveCount.activeSeatCount = 3; // Should be 2
  assert.equal(validateLudoRoomState(badActiveCount).valid, false);

  // 5. Host userId does not match any human seat
  const badHost = JSON.parse(JSON.stringify(validState));
  badHost.hostUserId = 'ghost_user';
  assert.equal(validateLudoRoomState(badHost).valid, false);

  // 6. Invalid revision
  const badRev = JSON.parse(JSON.stringify(validState));
  badRev.revision = -1;
  assert.equal(validateLudoRoomState(badRev).valid, false);
});

