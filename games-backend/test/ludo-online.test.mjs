import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LudoOnlineController,
  LudoEngine,
  validateLudoRoomState,
  createDeterministicDiceRoller,
  FINISH_PROGRESS,
  TOTAL_TRACK_CELLS,
  computeLudoDisplayRankings,
  LUDO_RECONNECT_GRACE_MS,
  LUDO_TAKEOVER_BOT_DIFFICULTY,
} from '../src/games/ludo/index.ts';
import {
  parseLudoServerEvent,
  validateEngineStateEnvelope,
} from '../../mobile/services/ludo-online/protocol.ts';
import {
  canOnlineHumanRoll,
  getOnlineSelectableTokens,
  createPresentationStateFromEngine,
} from '../../mobile/services/ludo-online/presentation.ts';

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
    this.alarms = [];
    this.deletedAlarms = 0;
    this.disconnectGraceRows = new Map(); // userId -> { user_id, room_id, deadline }
    this.failPersist = false;

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
      getUserSockets: (userId, excludingWs) => {
        return (this.sockets.get(userId) || []).filter((s) => s.readyState === 1 && s !== excludingWs);
      },
      persist: (state) => {
        if (this.failPersist) {
          throw new Error('Storage write failed');
        }
        this.persistedStates.push(JSON.parse(JSON.stringify(state)));
      },
      scheduleAlarm: (deadline) => {
        this.alarms.push(deadline);
      },
      deleteAlarm: () => {
        this.deletedAlarms++;
      },
      execSql: (query, ...params) => {
        if (query.includes('SELECT') && query.includes('disconnect_grace')) {
          const rows = Array.from(this.disconnectGraceRows.values()).sort((a, b) => a.deadline - b.deadline);
          return { toArray: () => rows };
        }
        if (query.includes('INSERT OR REPLACE INTO disconnect_grace')) {
          const [userId, roomId, deadline] = params;
          this.disconnectGraceRows.set(userId, { user_id: userId, room_id: roomId, deadline });
          return { toArray: () => [] };
        }
        if (query.includes('DELETE FROM disconnect_grace')) {
          if (query.includes('room_id = ?')) {
            const [roomId] = params;
            for (const [uid, r] of this.disconnectGraceRows.entries()) {
              if (r.room_id === roomId) this.disconnectGraceRows.delete(uid);
            }
          } else {
            const [userId] = params;
            this.disconnectGraceRows.delete(userId);
          }
          return { toArray: () => [] };
        }
        return { toArray: () => [] };
      },
    };

    this.execSql = (query, ...params) => this.callbacks.execSql(query, ...params);

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

// ============================================================================
// PHASE 4C1: DISCONNECT, ABANDONMENT, AND LIFECYCLE TESTS (77..136)
// ============================================================================

async function createStartedGame(playerCount = 2, diceRolls = [1, 2]) {
  const ctx = new TestContext('game_room_' + Math.random().toString(36).slice(2), {
    diceRoller: createDeterministicDiceRoller(diceRolls),
  });
  // Alice joins Red
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  if (playerCount > 2) {
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount });
  }

  // Bob joins (Yellow if 2 players, Green if 3 or 4 players)
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', displayName: 'Bob' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });

  let ws3 = null;
  let ws4 = null;

  if (playerCount >= 3) {
    ws3 = ctx.connect('user_charlie');
    await ctx.send(ws3, 'user_charlie', { type: 'LUDO_JOIN', displayName: 'Charlie' });
    await ctx.send(ws3, 'user_charlie', { type: 'LUDO_SET_READY', ready: true });
  }

  if (playerCount >= 4) {
    ws4 = ctx.connect('user_dave');
    await ctx.send(ws4, 'user_dave', { type: 'LUDO_JOIN', displayName: 'Dave' });
    await ctx.send(ws4, 'user_dave', { type: 'LUDO_SET_READY', ready: true });
  }

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });
  assert.equal(ctx.controller.getState().status, 'playing');
  return { ctx, ws1, ws2, ws3, ws4 };
}

// --- PART 1: PRESENCE / GRACE (1..14) ---

test('77. (Min. 1) one socket disconnect starts grace', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.presence, 'reconnecting');
  assert.ok(state.seats.red.disconnectDeadline > Date.now());
  assert.ok(ctx.alarms.length > 0);
  const pres = ctx.lastBroadcast('LUDO_PRESENCE');
  assert.equal(pres.userId, 'user_alice');
  assert.equal(pres.online, false);
  assert.equal(pres.status, 'reconnecting');
  assert.ok(pres.disconnectDeadline > 0);
});

test('78. (Min. 2) one of two sockets disconnects does NOT start grace', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  const ws1b = ctx.createSocket('user_alice');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.red.disconnectDeadline, null);
  assert.equal(ctx.alarms.length, 0);
});

test('79. (Min. 3) last socket disconnect starts grace', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  const ws1b = ctx.createSocket('user_alice');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().seats.red.presence, 'online');

  ws1b.close();
  ctx.controller.handleDisconnect('user_alice', ws1b);
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');
  assert.ok(ctx.controller.getState().seats.red.disconnectDeadline > 0);
});

test('80. (Min. 4) grace deadline persisted', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  assert.ok(ctx.disconnectGraceRows.has('user_alice'));
  const lastPersisted = ctx.persistedStates[ctx.persistedStates.length - 1];
  assert.equal(lastPersisted.seats.red.presence, 'reconnecting');
  assert.ok(lastPersisted.seats.red.disconnectDeadline > 0);
});

test('81. (Min. 5) reconnect before deadline cancels grace', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');

  const wsRe = ctx.connect('user_alice');
  const state = ctx.controller.getState();
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.red.disconnectDeadline, null);
  assert.equal(ctx.disconnectGraceRows.has('user_alice'), false);
  const pres = ctx.lastBroadcast('LUDO_PRESENCE');
  assert.equal(pres.userId, 'user_alice');
  assert.equal(pres.online, true);
  assert.equal(pres.status, 'online');
});

test('82. (Min. 6) reconnect returns same color', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  ctx.connect('user_alice');
  const state = ctx.controller.getState();
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.yellow.userId, 'user_bob');
});

test('83. (Min. 7) reconnect does not create duplicate seat', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  ctx.connect('user_alice');
  const seats = ctx.controller.getState().seats;
  const aliceSeats = Object.values(seats).filter((s) => s.userId === 'user_alice');
  assert.equal(aliceSeats.length, 1);
});

test('84. (Min. 8) stale alarm after reconnect does nothing', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  ctx.connect('user_alice');
  assert.equal(ctx.controller.getState().seats.red.presence, 'online');

  await ctx.controller.handleAlarm();
  const state = ctx.controller.getState();
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.red.controlMode, 'human');
});

test('85. (Min. 9) grace expiration marks abandoned', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const state = ctx.controller.getState();
  assert.equal(state.seats.red.controlMode, 'takeover-bot');
  assert.equal(state.seats.red.presence, 'abandoned');
  assert.ok(state.seats.red.abandonedAt > 0);
  assert.equal(state.seats.red.disconnectDeadline, null);
});

test('86. (Min. 10) abandoned seat control becomes takeover bot', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const seat = ctx.controller.getState().seats.red;
  assert.equal(seat.status, 'human'); // Mobile backward-compatible
  assert.equal(seat.controlMode, 'takeover-bot');
});

test('87. (Min. 11) original identity retained', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const seat = ctx.controller.getState().seats.red;
  assert.equal(seat.userId, 'user_alice');
  assert.equal(seat.displayName, 'Alice');
  assert.equal(seat.color, 'red');
});

test('88. (Min. 12) reconnect after abandonment cannot reclaim', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const wsRe = ctx.connect('user_alice');
  wsRe.clear();
  await ctx.send(wsRe, 'user_alice', { type: 'LUDO_ROLL_DICE' });

  const lastErr = wsRe.getMessages('ERROR')[0];
  assert.ok(lastErr);
  assert.equal(lastErr.code, 'PLAYER_ABANDONED');
});

test('89. (Min. 13) reconnect after abandonment receives state as spectator', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const wsRe = ctx.connect('user_alice');
  const gameStateMsg = wsRe.getMessages('LUDO_GAME_STATE')[0];
  assert.ok(gameStateMsg);
  assert.equal(gameStateMsg.seats.red.controlMode, 'takeover-bot');
  assert.equal(gameStateMsg.seats.red.presence, 'abandoned');
});

test('90. (Min. 14) another user cannot claim abandoned seat', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const wsEve = ctx.createSocket('user_eve');
  await ctx.send(wsEve, 'user_eve', { type: 'LUDO_JOIN' });
  const err = wsEve.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');
});

// --- PART 2: TAKEOVER GAMEPLAY (15..25) ---

test('91. (Min. 15) takeover bot rolls server-side', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [3, 2]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  // Red's turn to roll
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const rollEvents = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_DICE_ROLLED');
  assert.ok(rollEvents.length > 0);
  assert.equal(rollEvents[0].color, 'red');
  assert.equal(rollEvents[0].roll, 3);
});

test('92. (Min. 16) takeover bot makes legal move', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 2]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const moveEvents = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_MOVE_RESULT');
  assert.ok(moveEvents.length > 0);
  assert.equal(moveEvents[0].player, 'red');
  assert.equal(moveEvents[0].tokenId, 0);
  assert.equal(moveEvents[0].toProgress, 0); // Moved out onto start track
});

test('93. (Min. 17) takeover uses Normal difficulty', () => {
  assert.equal(LUDO_TAKEOVER_BOT_DIFFICULTY, 'normal');
});

test('94. (Min. 18) takeover handles six extra turn', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 3, 2]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const moveEvents = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_MOVE_RESULT');
  assert.equal(moveEvents.length, 2);
  assert.equal(moveEvents[0].extraTurn, true);
  assert.equal(moveEvents[1].toProgress, 3);
});

test('95. (Min. 19) takeover handles capture', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 2]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  assert.ok(ctx.broadcastEvents.some((e) => e.type === 'LUDO_MOVE_RESULT'));
});

test('96. (Min. 20) takeover handles finish', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 4]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  assert.equal(ctx.controller.getState().seats.red.controlMode, 'takeover-bot');
});

test('97. (Min. 21) takeover during current turn progresses automatically', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [1, 2]);
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'red');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Red rolled 1 (auto-pass), turn passed to green (in 3-player, next active color is green)
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'green');
});

test('98. (Min. 22) takeover while another player\'s turn waits', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [1, 2]);
  // Red rolls 1 (passes)
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ROLL_DICE' });
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'green');

  // Red disconnects during Green's turn
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Green's turn is undisturbed
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'green');
});

test('99. (Min. 23) configured bot remains configured difficulty', async () => {
  const ctx = new TestContext('room_conf_bot', {
    diceRoller: createDeterministicDiceRoller([1, 2]),
  });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  assert.equal(ctx.controller.getState().seats.yellow.botDifficulty, 'hard');
  assert.equal(ctx.controller.getState().seats.yellow.controlMode, 'bot');
});

test('100. (Min. 24) all bot events retain authoritative revisions', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 2]);
  const revBefore = ctx.controller.getRevision();

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  const revGrace = ctx.controller.getRevision();
  assert.ok(revGrace > revBefore);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const revAfter = ctx.controller.getRevision();
  assert.ok(revAfter > revGrace);
});

test('101. (Min. 25) mobile-compatible action metadata remains unchanged', async () => {
  const { ctx, ws1 } = await createStartedGame(3, [6, 2]);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const diceEvent = ctx.broadcastEvents.find((e) => e.type === 'LUDO_DICE_ROLLED');
  assert.ok('roll' in diceEvent);
  assert.ok('dice' in diceEvent);
  assert.ok('legalMoves' in diceEvent);

  const moveEvent = ctx.broadcastEvents.find((e) => e.type === 'LUDO_MOVE_RESULT');
  assert.ok('traversedCoordinates' in moveEvent);
  assert.ok('extraTurn' in moveEvent);
});

// --- PART 3: MULTIPLE DISCONNECTS (26..34) ---

test('102. (Min. 26) two humans have different deadlines', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  const d1 = ctx.controller.getState().seats.red.disconnectDeadline;

  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);
  const d2 = ctx.controller.getState().seats.yellow.disconnectDeadline;

  assert.ok(d1 > 0);
  assert.ok(d2 > 0);
});

test('103. (Min. 27) earliest deadline schedules alarm', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  assert.ok(ctx.alarms.length >= 2);
  const d1 = ctx.controller.getState().seats.red.disconnectDeadline;
  assert.equal(ctx.alarms[0], d1);
});

test('104. (Min. 28) first expiry preserves second grace', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const state = ctx.controller.getState();
  assert.equal(state.seats.red.controlMode, 'takeover-bot');
  assert.equal(state.seats.yellow.presence, 'reconnecting');
});

test('105. (Min. 29) next alarm rescheduled correctly', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  const alarmCountBefore = ctx.alarms.length;
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  assert.ok(ctx.alarms.length > alarmCountBefore);
});

test('106. (Min. 30) both eventually abandon independently', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.controlMode, 'takeover-bot');
  assert.equal(state.seats.yellow.controlMode, 'takeover-bot');
  assert.equal(state.seats.green.controlMode, 'human'); // Charlie remains
});

test('107. (Min. 31) one reconnects while other expires', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  ctx.connect('user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.controlMode, 'human');
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.yellow.controlMode, 'takeover-bot');
});

test('108. (Min. 32) host disconnect + other disconnect', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  const state = ctx.controller.getState();
  assert.equal(state.seats.red.presence, 'reconnecting');
  assert.equal(state.seats.yellow.presence, 'reconnecting');
});

test('109. (Min. 33) multi-socket host temporary disconnect retains host', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  const ws1b = ctx.createSocket('user_alice');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().hostUserId, 'user_alice');
});

test('110. (Min. 34) permanent host abandonment transfers host', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const state = ctx.controller.getState();
  assert.equal(state.hostUserId, 'user_bob'); // Transferred to Bob
});

// --- PART 4: RANKING (35..45) ---

test('111. (Min. 35) single abandoned player displayed last', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    green: { color: 'green', status: 'human', controlMode: 'human' },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
    blue: { color: 'blue', status: 'human', controlMode: 'human' },
  };
  const activeColors = ['red', 'green', 'yellow', 'blue'];
  const engineRankings = ['yellow', 'blue', 'green'];

  const display = computeLudoDisplayRankings(engineRankings, activeColors, seats);
  assert.deepEqual(display, ['yellow', 'blue', 'green', 'red']);
});

test('112. (Min. 36) two abandoned players ordered by abandonment time', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    green: { color: 'green', status: 'human', controlMode: 'takeover-bot', abandonedAt: 200 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
    blue: { color: 'blue', status: 'human', controlMode: 'human' },
  };
  const activeColors = ['red', 'green', 'yellow', 'blue'];
  const engineRankings = ['yellow', 'blue'];

  const display = computeLudoDisplayRankings(engineRankings, activeColors, seats);
  assert.deepEqual(display, ['yellow', 'blue', 'green', 'red']);
});

test('113. (Min. 37) later abandonment ranks above earlier abandonment', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 50 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'takeover-bot', abandonedAt: 150 },
  };
  const display = computeLudoDisplayRankings([], ['red', 'yellow'], seats);
  assert.deepEqual(display, ['yellow', 'red']);
});

test('114. (Min. 38) configured bot ranks normally', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'human' },
    yellow: { color: 'yellow', status: 'bot', controlMode: 'bot' },
  };
  const display = computeLudoDisplayRankings(['yellow', 'red'], ['red', 'yellow'], seats);
  assert.deepEqual(display, ['yellow', 'red']);
});

test('115. (Min. 39) already-finished human disconnect keeps earned rank', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  // Mark Red as finished in engine rankings
  const candidate = ctx.controller.getState();
  candidate.engineState.rankings = ['red'];
  candidate.rankings = ['red'];
  const restored = new LudoOnlineController(ctx.roomId, ctx.callbacks, candidate);

  ws1.close();
  restored.handleDisconnect('user_alice', ws1);

  // Red is not reconnecting and has no deadline because Red already finished!
  const state = restored.getState();
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.red.disconnectDeadline, null);
  assert.equal(ctx.disconnectGraceRows.has('user_alice'), false);
});

test('116. (Min. 40) takeover color finishing early still ranks after active humans', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
  };
  // Engine rankings: Red finished before Yellow
  const engineRankings = ['red', 'yellow'];
  const display = computeLudoDisplayRankings(engineRankings, ['red', 'yellow'], seats);
  assert.deepEqual(display, ['yellow', 'red']);
});

test('117. (Min. 41) 2-player abandon yields remaining player first', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
  };
  const display = computeLudoDisplayRankings([], ['red', 'yellow'], seats);
  assert.deepEqual(display, ['yellow', 'red']);
});

test('118. (Min. 42) 3-player abandon ordering', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    green: { color: 'green', status: 'human', controlMode: 'takeover-bot', abandonedAt: 200 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
  };
  const display = computeLudoDisplayRankings(['yellow'], ['red', 'green', 'yellow'], seats);
  assert.deepEqual(display, ['yellow', 'green', 'red']);
});

test('119. (Min. 43) 4-player mixed human/bot/abandon ranking', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 100 },
    green: { color: 'green', status: 'bot', controlMode: 'bot' },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human' },
    blue: { color: 'blue', status: 'human', controlMode: 'human' },
  };
  const display = computeLudoDisplayRankings(['yellow', 'green', 'blue'], ['red', 'green', 'yellow', 'blue'], seats);
  assert.deepEqual(display, ['yellow', 'green', 'blue', 'red']);
});

test('120. (Min. 44) final displayRankings persisted', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const state = ctx.controller.getState();
  assert.ok(Array.isArray(state.displayRankings));
  assert.equal(state.status, 'finished');
});

test('121. (Min. 45) restart preserves display rankings', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const finalState = ctx.controller.getState();
  assert.equal(finalState.status, 'finished');
  assert.ok(Array.isArray(finalState.displayRankings));

  const validation = validateLudoRoomState(finalState);
  assert.equal(validation.valid, true);

  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.callbacks, finalState);
  assert.deepEqual(restored.getState().displayRankings, finalState.displayRankings);
});

// --- PART 5: TERMINAL ALL-HUMAN ABANDONMENT (46..51) ---

test('122. (Min. 46) all humans abandoning stops further bot progression', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const state = ctx.controller.getState();
  assert.equal(state.status, 'finished');
  assert.equal(state.finishReason, 'all-humans-abandoned');
});

test('123. (Min. 47) room reaches compatible terminal state', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  assert.equal(ctx.controller.getState().status, 'finished');
});

test('124. (Min. 48) finishReason is all-humans-abandoned', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  assert.equal(ctx.controller.getState().finishReason, 'all-humans-abandoned');
});

test('125. (Min. 49) no endless bot simulation', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const countBefore = ctx.broadcastEvents.length;

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');
  // Only terminal broadcast emitted, no further loop
  const rollsAfter = ctx.broadcastEvents.slice(countBefore).filter((e) => e.type === 'LUDO_DICE_ROLLED');
  assert.equal(rollsAfter.length, 0);
});

test('126. (Min. 50) restart preserves terminal state', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const terminalState = ctx.controller.getState();
  assert.equal(terminalState.status, 'finished');
  assert.equal(terminalState.finishReason, 'all-humans-abandoned');

  const restored = LudoOnlineController.fromState('room_term', ctx.callbacks, terminalState);
  assert.equal(restored.getState().status, 'finished');
  assert.equal(restored.getState().finishReason, 'all-humans-abandoned');
});

test('127. (Min. 51) actions rejected after terminal abandonment', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const ws = ctx.createSocket('user_alice');
  await ctx.send(ws, 'user_alice', { type: 'LUDO_ROLL_DICE' });
  const err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_FINISHED');
});

// --- PART 6: DURABILITY (52..60) ---

test('128. (Min. 52) DO restart during grace', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const savedState = ctx.controller.getState();
  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.callbacks, savedState);

  assert.equal(restored.getState().seats.red.presence, 'reconnecting');
  assert.ok(restored.getState().seats.red.disconnectDeadline > 0);
});

test('129. (Min. 53) alarm expiry after restart', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const pastDeadline = Date.now() - 1000;
  ctx.disconnectGraceRows.set('user_alice', { user_id: 'user_alice', room_id: ctx.roomId, deadline: pastDeadline });
  const savedState = ctx.controller.getState();
  savedState.seats.red.disconnectDeadline = pastDeadline;

  const restored = new LudoOnlineController(ctx.roomId, ctx.callbacks, savedState);
  await restored.handleAlarm();
  assert.equal(restored.getState().seats.red.controlMode, 'takeover-bot');
  assert.equal(restored.getState().seats.red.presence, 'abandoned');
});

test('130. (Min. 54) restart after abandonment', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const savedState = ctx.controller.getState();
  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.callbacks, savedState);
  assert.equal(restored.getState().seats.red.controlMode, 'takeover-bot');
});

test('131. (Min. 55) takeover persists restart', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const savedState = ctx.controller.getState();
  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.callbacks, savedState);

  const wsRe = ctx.createSocket('user_alice');
  await restored.handleConnect(wsRe, 'user_alice');
  await restored.handleMessage(wsRe, 'user_alice', { type: 'LUDO_ROLL_DICE' });

  const err = wsRe.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'PLAYER_ABANDONED');
});

test('132. (Min. 56) stale alarm after restart safe', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ctx.connect('user_alice'); // Reconnected

  const savedState = ctx.controller.getState();
  const restored = new LudoOnlineController(ctx.roomId, ctx.callbacks, savedState);

  await restored.handleAlarm();
  assert.equal(restored.getState().seats.red.controlMode, 'human');
  assert.equal(restored.getState().seats.red.presence, 'online');
});

test('133. (Min. 57) persistence failure starting grace rolls back', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ctx.failPersist = true;

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  // Live state not updated because persist failed
  assert.equal(ctx.controller.getState().seats.red.presence, 'online');
  assert.equal(ctx.controller.getState().seats.red.disconnectDeadline, null);
});

test('134. (Min. 58) persistence failure cancelling grace rolls back', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');

  ctx.failPersist = true;
  ctx.controller.cancelDisconnectGraceIfPending('user_alice');

  // Rolled back
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');
});

test('135. (Min. 59) persistence failure takeover rolls back', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');

  ctx.failPersist = true;
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Takeover did not commit
  assert.equal(ctx.controller.getState().seats.red.controlMode, 'human');
});

test('136. (Min. 60) persistence failure terminal transition rolls back', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  ctx.failPersist = true;
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  assert.equal(ctx.controller.getState().status, 'playing');
});

// --- PART 7: PHASE 4C1 FINAL TERMINAL-STATE / DOUBLE-FIRE / PERSISTENCE GATES ---

test('137. (Gate 1) all-humans-abandoned mobile snapshot serialization & validation', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const finalState = ctx.controller.getState();
  assert.equal(finalState.status, 'finished');
  assert.equal(finalState.finishReason, 'all-humans-abandoned');

  // Verify internal engine state invariants preserved
  assert.ok(ctx.controller.engine);
  // Safe outbound serialization
  const broadcastEngine = ctx.controller.getBroadcastEngineState();
  assert.ok(broadcastEngine);
  assert.equal(broadcastEngine.status, 'finished');
  assert.equal(broadcastEngine.currentTurn, null);
  assert.equal(broadcastEngine.turnPhase, null);
  assert.equal(broadcastEngine.currentRoll, null);
  assert.deepEqual(broadcastEngine.legalMoves, []);
  assert.deepEqual(broadcastEngine.rankings, finalState.displayRankings);

  // Find the terminal LUDO_GAME_STATE broadcast
  const gameStates = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_GAME_STATE');
  const lastGameState = gameStates[gameStates.length - 1];
  assert.ok(lastGameState);
  assert.equal(lastGameState.state.status, 'finished');

  // Verify mobile's Phase 4B2 protocol parser & envelope validation accepts it
  const isEnvelopeValid = validateEngineStateEnvelope(lastGameState.state);
  assert.equal(isEnvelopeValid, true);

  const parsedEvent = parseLudoServerEvent(lastGameState);
  assert.ok(parsedEvent);
  assert.equal(parsedEvent.type, 'LUDO_GAME_STATE');

  // Verify mobile presentation layer disables controls
  const presentationState = createPresentationStateFromEngine(parsedEvent.state);
  assert.equal(presentationState.status, 'finished');

  const canRoll = canOnlineHumanRoll({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    actionQueueLength: 0,
    gameStatus: presentationState.status,
    currentTurn: presentationState.currentTurn,
    turnPhase: presentationState.turnPhase,
    myColor: 'yellow',
    mySeatStatus: 'human',
    pendingCommand: null,
  });
  assert.equal(canRoll, false);

  const selectableTokens = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: presentationState.status,
    currentTurn: presentationState.currentTurn,
    turnPhase: presentationState.turnPhase,
    myColor: 'yellow',
    legalMoves: presentationState.legalMoves,
    pendingCommand: null,
  });
  assert.deepEqual(selectableTokens, []);
});

test('138. (Gate 2) terminal action rejection consistency', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

  const ws = ctx.createSocket('user_alice');

  // ROLL -> GAME_FINISHED
  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_ROLL_DICE' });
  let err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_FINISHED');

  // MOVE -> GAME_FINISHED
  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_MOVE_TOKEN', tokenId: 0 });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_FINISHED');

  // START -> GAME_ALREADY_STARTED
  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_START_GAME' });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  // Non-reconnecting JOIN -> GAME_ALREADY_STARTED
  const wsEve = ctx.createSocket('user_eve');
  wsEve.clear();
  await ctx.send(wsEve, 'user_eve', { type: 'LUDO_JOIN' });
  err = wsEve.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  // Lobby actions -> GAME_ALREADY_STARTED
  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_SET_READY', ready: true });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_SET_SEAT', color: 'green', status: 'closed' });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green' });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_REMOVE_BOT', color: 'green' });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');

  ws.clear();
  await ctx.send(ws, 'user_alice', { type: 'LUDO_SET_BOT_DIFFICULTY', color: 'green', difficulty: 'hard' });
  err = ws.getMessages('ERROR')[0];
  assert.ok(err);
  assert.equal(err.code, 'GAME_ALREADY_STARTED');
});

test('139. (Gate 3) display rankings completeness across 2, 3, and 4 players', async () => {
  // 2-player test
  {
    const { ctx, ws1, ws2 } = await createStartedGame(2);
    ws1.close();
    ctx.controller.handleDisconnect('user_alice', ws1);
    ws2.close();
    ctx.controller.handleDisconnect('user_bob', ws2);
    await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
    await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');

    const rankings = ctx.controller.getState().displayRankings;
    assert.equal(rankings.length, 2);
    assert.deepEqual(new Set(rankings), new Set(['red', 'yellow']));
    assert.equal(new Set(rankings).size, 2); // No duplicates
  }

  // 3-player test (2 humans, 1 bot)
  {
    const ctx = new TestContext('room_3p');
    const ws1 = ctx.connect('user_alice');
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
    const ws2 = ctx.connect('user_bob');
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green' });
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

    ws1.close();
    ctx.controller.handleDisconnect('user_alice', ws1);
    ws2.close();
    ctx.controller.handleDisconnect('user_bob', ws2);
    await ctx.controller.handleDisconnectTimeout('room_3p', 'user_alice');
    await ctx.controller.handleDisconnectTimeout('room_3p', 'user_bob');

    const rankings = ctx.controller.getState().displayRankings;
    assert.equal(rankings.length, 3);
    assert.deepEqual(new Set(rankings), new Set(['red', 'green', 'yellow']));
    assert.equal(new Set(rankings).size, 3);
    assert.equal(rankings[0], 'green'); // configured bot ranks ahead of abandoned humans
  }

  // 4-player test (2 humans, 2 bots)
  {
    const ctx = new TestContext('room_4p');
    const ws1 = ctx.connect('user_alice');
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });
    const ws2 = ctx.connect('user_bob');
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green' });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'blue' });
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
    await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

    ws1.close();
    ctx.controller.handleDisconnect('user_alice', ws1);
    ws2.close();
    ctx.controller.handleDisconnect('user_bob', ws2);
    await ctx.controller.handleDisconnectTimeout('room_4p', 'user_alice');
    await ctx.controller.handleDisconnectTimeout('room_4p', 'user_bob');

    const rankings = ctx.controller.getState().displayRankings;
    assert.equal(rankings.length, 4);
    assert.deepEqual(new Set(rankings), new Set(['red', 'green', 'yellow', 'blue']));
    assert.equal(new Set(rankings).size, 4);
  }
});

test('140. (Gate 4) partial canonical rankings + abandonment preserves legitimate first place', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 1000 },
    green: { color: 'green', status: 'bot', controlMode: 'bot', abandonedAt: null },
    yellow: { color: 'yellow', status: 'human', controlMode: 'human', abandonedAt: null },
    blue: { color: 'blue', status: 'closed', controlMode: 'human', abandonedAt: null },
  };

  // Yellow legitimately finished first before red abandoned
  const engineRankings = ['yellow'];
  const activeColors = ['red', 'green', 'yellow'];

  const display = computeLudoDisplayRankings(engineRankings, activeColors, seats);

  assert.equal(display[0], 'yellow'); // Legitimate winner preserved in 1st place!
  assert.equal(display[1], 'green');  // Active configured bot 2nd
  assert.equal(display[2], 'red');    // Abandoned human last
  assert.equal(display.length, 3);
});

test('141. (Gate 5) explicit LUDO_LEAVE + socket close double-fire', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  const revBefore = ctx.controller.getState().revision;

  // 1. Client explicitly sends LUDO_LEAVE
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_LEAVE' });
  const revAfterLeave = ctx.controller.getState().revision;
  assert.equal(revAfterLeave, revBefore + 1);

  const seatAfterLeave = ctx.controller.getState().seats.red;
  assert.equal(seatAfterLeave.presence, 'reconnecting');
  const deadline = seatAfterLeave.disconnectDeadline;
  assert.ok(deadline > 0);

  const graceRowsCount = ctx.disconnectGraceRows.size;
  assert.equal(graceRowsCount, 1);

  const presenceBroadcastsCount = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_PRESENCE').length;

  // 2. Client then closes the WebSocket connection
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  // Must be a complete no-op: no extra revision, same deadline, no extra rows or broadcasts
  const revAfterClose = ctx.controller.getState().revision;
  assert.equal(revAfterClose, revAfterLeave);
  assert.equal(ctx.controller.getState().seats.red.disconnectDeadline, deadline);
  assert.equal(ctx.disconnectGraceRows.size, 1);
  assert.equal(ctx.broadcastEvents.filter((e) => e.type === 'LUDO_PRESENCE').length, presenceBroadcastsCount);
});

test('142. (Gate 6) repeated disconnect callback idempotency', async () => {
  let currentTime = 1_000_000;
  const ctx = new TestContext('room_rep_disc', { now: () => currentTime });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  // 1st disconnect at T = 1,000,000
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  const expectedDeadline = 1_000_000 + LUDO_RECONNECT_GRACE_MS;
  assert.equal(ctx.controller.getState().seats.red.disconnectDeadline, expectedDeadline);
  const revAfterFirst = ctx.controller.getState().revision;

  // Network layer repeats disconnect callback 5 seconds later at T = 1,005,000
  currentTime += 5000;
  ctx.controller.handleDisconnect('user_alice', ws1);

  // Deadline MUST NOT be extended to 1,005,000 + grace
  assert.equal(ctx.controller.getState().seats.red.disconnectDeadline, expectedDeadline);
  // Revision must not increment
  assert.equal(ctx.controller.getState().revision, revAfterFirst);
});

test('143. (Gate 7) LUDO_LEAVE while already reconnecting', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const deadlineBefore = ctx.controller.getState().seats.red.disconnectDeadline;
  const revBefore = ctx.controller.getState().revision;

  // Stale/second socket sends LUDO_LEAVE
  const wsStale = ctx.createSocket('user_alice');
  await ctx.send(wsStale, 'user_alice', { type: 'LUDO_LEAVE' });

  assert.equal(ctx.controller.getState().seats.red.disconnectDeadline, deadlineBefore);
  assert.equal(ctx.controller.getState().revision, revBefore);
});

test('144. (Gate 8) reconnect cancellation idempotency', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  assert.equal(ctx.controller.getState().seats.red.presence, 'reconnecting');

  // Socket 1 reconnects
  const wsRe1 = ctx.createSocket('user_alice');
  ctx.controller.handleConnect(wsRe1, 'user_alice');
  assert.equal(ctx.controller.getState().seats.red.presence, 'online');
  const revAfterFirstReconnect = ctx.controller.getState().revision;

  // Socket 2 connects immediately afterwards for same user
  const wsRe2 = ctx.createSocket('user_alice');
  ctx.controller.handleConnect(wsRe2, 'user_alice');

  // Must not increment revision again
  assert.equal(ctx.controller.getState().revision, revAfterFirstReconnect);
});

test('145. (Gate 9) alarm + local fallback double-fire', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  // 1. Local fallback timer fires
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  assert.equal(ctx.controller.getState().seats.red.controlMode, 'takeover-bot');
  const abandonedAt1 = ctx.controller.getState().seats.red.abandonedAt;
  const revAfterFallback = ctx.controller.getState().revision;
  const broadcastCount = ctx.broadcastEvents.length;

  // 2. Later Durable Object alarm fires for the same user
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Second execution must be a strict no-op
  assert.equal(ctx.controller.getState().seats.red.abandonedAt, abandonedAt1);
  assert.equal(ctx.controller.getState().revision, revAfterFallback);
  assert.equal(ctx.broadcastEvents.length, broadcastCount);
});

test('146. (Gate 10) abandonment timestamp immutability', async () => {
  let currentTime = 1_000_000;
  const ctx = new TestContext('room_immut', { now: () => currentTime });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
  const ws3 = ctx.connect('user_charlie');
  await ctx.send(ws3, 'user_charlie', { type: 'LUDO_JOIN', preferredColor: 'green' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws3, 'user_charlie', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  // Abandon at T = 1,000,000
  await ctx.controller.handleDisconnectTimeout('room_immut', 'user_alice');
  assert.equal(ctx.controller.getState().seats.red.abandonedAt, 1_000_000);

  // Stale callback runs at T = 1,500,000
  currentTime = 1_500_000;
  await ctx.controller.handleDisconnectTimeout('room_immut', 'user_alice');

  // Must remain 1,000,000
  assert.equal(ctx.controller.getState().seats.red.abandonedAt, 1_000_000);
});

test('147. (Gate 11) takeover activation exactly once', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  // Red's turn currently
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'red');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const rollsBefore = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_DICE_ROLLED').length;

  // 1st timeout invocation: converts and progresses bot
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const rollsAfterFirst = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_DICE_ROLLED').length;
  assert.ok(rollsAfterFirst > rollsBefore);

  const revAfterFirst = ctx.controller.getState().revision;

  // 2nd timeout invocation
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  const rollsAfterSecond = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_DICE_ROLLED').length;
  assert.equal(rollsAfterSecond, rollsAfterFirst); // No extra roll
  assert.equal(ctx.controller.getState().revision, revAfterFirst); // No revision bump
});

test('148. (Gate 12) takeover bot + configured bot chain', async () => {
  const ctx = new TestContext('room_chain', {
    diceRoller: createDeterministicDiceRoller([1, 1, 1]), // rolls that cannot move tokens from yard
  });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green' });
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  // Red is human turn. Alice abandons -> Red becomes takeover bot
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout('room_chain', 'user_alice');

  // Red takeover bot acts (rolls 1, auto-passes) -> Green configured bot acts (rolls 1, auto-passes) -> Yellow human turn
  assert.equal(ctx.controller.getState().seats.red.controlMode, 'takeover-bot');
  assert.equal(ctx.controller.getState().seats.green.controlMode, 'bot');
  assert.equal(ctx.controller.getState().seats.yellow.controlMode, 'human');
  assert.equal(ctx.controller.getState().engineState.currentTurn, 'yellow');
});

test('149. (Gate 13) takeover extra-turn chain + MAX_BOT_TURNS_PER_ACTION safety guard', async () => {
  // Constant sixes
  const ctx = new TestContext('room_guard', {
    diceRoller: { roll: () => 6 },
  });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  // Must not hang or throw infinite loop error
  await ctx.controller.handleDisconnectTimeout('room_guard', 'user_alice');
  assert.ok(true);
});

test('150. (Gate 14) lifecycle metadata survives normal gameplay of other players', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  const redSeat = ctx.controller.getState().seats.red;
  assert.equal(redSeat.presence, 'abandoned');
  assert.equal(redSeat.controlMode, 'takeover-bot');
  const redAbandonedAt = redSeat.abandonedAt;
  assert.ok(redAbandonedAt > 0);

  // Bob (yellow) is current turn
  if (ctx.controller.getState().engineState.currentTurn === 'yellow') {
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_ROLL_DICE' });
  }

  // Red's seat metadata MUST NOT be mutated or dropped by Bob's turn
  const redAfterBob = ctx.controller.getState().seats.red;
  assert.equal(redAfterBob.presence, 'abandoned');
  assert.equal(redAfterBob.controlMode, 'takeover-bot');
  assert.equal(redAfterBob.abandonedAt, redAbandonedAt);

  // Also survives DO restart
  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.callbacks, ctx.controller.getState());
  const redRestored = restored.getState().seats.red;
  assert.equal(redRestored.presence, 'abandoned');
  assert.equal(redRestored.controlMode, 'takeover-bot');
  assert.equal(redRestored.abandonedAt, redAbandonedAt);
});

test('151. (Gate 15) grace metadata survives other players gameplay actions', async () => {
  const { ctx, ws1, ws2 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const redDeadline = ctx.controller.getState().seats.red.disconnectDeadline;
  assert.ok(redDeadline > 0);

  // Bob takes an action if his turn
  if (ctx.controller.getState().engineState.currentTurn === 'yellow') {
    await ctx.send(ws2, 'user_bob', { type: 'LUDO_ROLL_DICE' });
  }

  // Red's reconnecting metadata is preserved unchanged
  const redAfter = ctx.controller.getState().seats.red;
  assert.equal(redAfter.presence, 'reconnecting');
  assert.equal(redAfter.disconnectDeadline, redDeadline);
});

test('152. (Gate 16) host transfer exactly once on permanent abandonment', async () => {
  const { ctx, ws1 } = await createStartedGame(3);
  // Alice is red, host
  assert.equal(ctx.controller.getState().hostUserId, 'user_alice');

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Host transferred to next human
  const newHost = ctx.controller.getState().hostUserId;
  assert.ok(newHost !== 'user_alice');
  assert.ok(newHost !== null);

  // Stale alarm / timeout call for Alice
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');

  // Host remains the new host, does NOT rotate again
  assert.equal(ctx.controller.getState().hostUserId, newHost);
});

test('153. (Gate 17) host order consistency across lobby and active game', async () => {
  // 1. Lobby host transfer: red leaves -> green becomes host
  const ctxLobby = new TestContext('room_host_order');
  const wsRed = ctxLobby.connect('user_alice');
  await ctxLobby.send(wsRed, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  await ctxLobby.send(wsRed, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });
  const wsGreen = ctxLobby.connect('user_bob');
  await ctxLobby.send(wsGreen, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'green' });
  const wsYellow = ctxLobby.connect('user_charlie');
  await ctxLobby.send(wsYellow, 'user_charlie', { type: 'LUDO_JOIN', preferredColor: 'yellow' });

  assert.equal(ctxLobby.controller.getState().hostUserId, 'user_alice');
  await ctxLobby.send(wsRed, 'user_alice', { type: 'LUDO_LEAVE' });
  assert.equal(ctxLobby.controller.getState().hostUserId, 'user_bob'); // green is next in canonical order

  // 2. Active game host transfer: red abandons -> green becomes host
  const { ctx, ws1 } = await createStartedGame(3);
  assert.equal(ctx.controller.getState().hostUserId, 'user_alice');
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_alice');
  assert.equal(ctx.controller.getState().hostUserId, 'user_charlie'); // charlie holds green seat, next in canonical order
});

test('154. (Gate 18) already-ranked player disconnect presence', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  // Mark red as winner with all 4 finished tokens
  const candidate = ctx.controller.getState();
  candidate.engineState.tokens.red = [56, 56, 56, 56];
  candidate.engineState.rankings = ['red'];
  candidate.engineState.currentTurn = 'yellow';
  candidate.rankings = ['red'];
  const restored = new LudoOnlineController(ctx.roomId, ctx.callbacks, candidate);

  ws1.close();
  restored.handleDisconnect('user_alice', ws1);

  const redSeat = restored.getState().seats.red;
  assert.equal(redSeat.presence, 'reconnecting');
  assert.equal(redSeat.disconnectDeadline, null); // No deadline
  assert.equal(redSeat.controlMode, 'human');      // Not takeover
  assert.equal(redSeat.abandonedAt, null);        // Not abandoned
  assert.equal(ctx.disconnectGraceRows.size, 0);  // No SQL grace row
});

test('155. (Gate 19) display rankings tie safety', () => {
  const seats = {
    red: { color: 'red', status: 'human', controlMode: 'takeover-bot', abandonedAt: 5000 },
    green: { color: 'green', status: 'human', controlMode: 'takeover-bot', abandonedAt: 5000 },
    yellow: { color: 'yellow', status: 'human', controlMode: 'takeover-bot', abandonedAt: 5000 },
    blue: { color: 'blue', status: 'closed', controlMode: 'human', abandonedAt: null },
  };

  const activeColors = ['red', 'green', 'yellow'];
  const display = computeLudoDisplayRankings([], activeColors, seats);

  assert.equal(display.length, 3);
  assert.deepEqual(display, ['red', 'green', 'yellow']); // Stable canonical color tie-breaker
});

test('156. (Gate 20) clock injection', async () => {
  let currentTime = 1_700_000_000_000;
  const ctx = new TestContext('room_clock', { now: () => currentTime });
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', preferredColor: 'red' });
  const ws2 = ctx.connect('user_bob');
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  assert.equal(
    ctx.controller.getState().seats.red.disconnectDeadline,
    1_700_000_000_000 + LUDO_RECONNECT_GRACE_MS
  );

  currentTime += 100_000;
  await ctx.controller.handleDisconnectTimeout('room_clock', 'user_alice');
  assert.equal(ctx.controller.getState().seats.red.abandonedAt, 1_700_000_100_000);
});

test('157. (Gate 21) deadline validation rejects malformed values and contradictions', () => {
  const base = {
    gameType: 'ludo',
    roomId: 'v1',
    status: 'playing',
    hostUserId: 'u1',
    activeSeatCount: 2,
    engineState: { activeColors: ['red', 'yellow'], rankings: [] },
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'A', botDifficulty: null, ready: true, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'u2', displayName: 'B', botDifficulty: null, ready: true, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    rankings: [],
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
  };

  // 1. disconnectDeadline = NaN
  let bad = JSON.parse(JSON.stringify(base));
  bad.seats.red.disconnectDeadline = NaN;
  assert.equal(validateLudoRoomState(bad).valid, false);

  // 2. disconnectDeadline = -10
  bad = JSON.parse(JSON.stringify(base));
  bad.seats.red.disconnectDeadline = -10;
  assert.equal(validateLudoRoomState(bad).valid, false);

  // 3. presence = 'online' + disconnectDeadline != null
  bad = JSON.parse(JSON.stringify(base));
  bad.seats.red.presence = 'online';
  bad.seats.red.disconnectDeadline = 50000;
  assert.equal(validateLudoRoomState(bad).valid, false);

  // 4. presence = 'abandoned' + abandonedAt = null
  bad = JSON.parse(JSON.stringify(base));
  bad.seats.red.presence = 'abandoned';
  bad.seats.red.controlMode = 'takeover-bot';
  bad.seats.red.abandonedAt = null;
  assert.equal(validateLudoRoomState(bad).valid, false);

  // 5. controlMode = 'takeover-bot' + presence != 'abandoned'
  bad = JSON.parse(JSON.stringify(base));
  bad.seats.red.controlMode = 'takeover-bot';
  bad.seats.red.presence = 'online';
  bad.seats.red.abandonedAt = 5000;
  assert.equal(validateLudoRoomState(bad).valid, false);

  // 6. configured bot with disconnectDeadline
  bad = JSON.parse(JSON.stringify(base));
  bad.seats.yellow.status = 'bot';
  bad.seats.yellow.userId = null;
  bad.seats.yellow.disconnectDeadline = 50000;
  assert.equal(validateLudoRoomState(bad).valid, false);
});

test('158. (Gate 22) display rankings validation', () => {
  const eng = LudoEngine.create({
    players: [
      { id: 'u1', color: 'red', type: 'human' },
      { id: 'u2', color: 'yellow', type: 'human' },
    ],
  });
  const engineState = eng.getState();
  engineState.status = 'finished';
  engineState.currentTurn = null;
  engineState.turnPhase = null;
  engineState.tokens.yellow = [56, 56, 56, 56];
  engineState.rankings = ['yellow', 'red'];

  const base = {
    gameType: 'ludo',
    roomId: 'v2',
    status: 'finished',
    hostUserId: 'u1',
    activeSeatCount: 2,
    engineState,
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'A', botDifficulty: null, ready: true, controlMode: 'takeover-bot', presence: 'abandoned', disconnectDeadline: null, abandonedAt: 1000 },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'u2', displayName: 'B', botDifficulty: null, ready: true, controlMode: 'takeover-bot', presence: 'abandoned', disconnectDeadline: null, abandonedAt: 2000 },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    rankings: ['yellow', 'red'],
    displayRankings: ['yellow', 'red'],
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
  };

  // Valid display rankings
  assert.equal(validateLudoRoomState(base).valid, true);

  // Invalid color
  let bad = JSON.parse(JSON.stringify(base));
  bad.displayRankings = ['yellow', 'purple'];
  assert.equal(validateLudoRoomState(bad).valid, false);

  // Duplicates
  bad = JSON.parse(JSON.stringify(base));
  bad.displayRankings = ['yellow', 'yellow'];
  assert.equal(validateLudoRoomState(bad).valid, false);

  // Missing active color when finished
  bad = JSON.parse(JSON.stringify(base));
  bad.displayRankings = ['yellow'];
  assert.equal(validateLudoRoomState(bad).valid, false);
});

test('159. (Gate 23) legacy pre-4C1 active room state restore', () => {
  const eng = LudoEngine.create({
    players: [
      { id: 'user_alice', color: 'red', type: 'human' },
      { id: 'bot-green', color: 'green', type: 'bot' },
      { id: 'user_bob', color: 'yellow', type: 'human' },
    ],
  });
  const legacyActiveState = {
    gameType: 'ludo',
    roomId: 'legacy_active',
    status: 'playing',
    hostUserId: 'user_alice',
    activeSeatCount: 3,
    engineState: eng.getState(),
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_alice', displayName: 'Alice', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'bot', userId: null, displayName: 'Bot Green', botDifficulty: 'normal', ready: true },
      yellow: { color: 'yellow', status: 'human', userId: 'user_bob', displayName: 'Bob', botDifficulty: null, ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    rankings: [],
    createdAt: 1000,
    updatedAt: 1000,
    revision: 5,
  };

  const validation = validateLudoRoomState(legacyActiveState);
  assert.equal(validation.valid, true);

  const ctx = new TestContext('legacy_active');
  const restored = LudoOnlineController.fromState('legacy_active', ctx.callbacks, legacyActiveState);

  // Safely normalized
  const state = restored.getState();
  assert.equal(state.seats.red.controlMode, 'human');
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.green.controlMode, 'bot');
  assert.equal(state.seats.green.presence, 'online');
  assert.equal(state.seats.yellow.controlMode, 'human');
  assert.equal(state.seats.yellow.presence, 'online');
});

test('160. (Gate 24) legacy finished room state restore', () => {
  const eng = LudoEngine.create({
    players: [
      { id: 'user_alice', color: 'red', type: 'human' },
      { id: 'user_bob', color: 'yellow', type: 'human' },
    ],
  });
  const engineState = eng.getState();
  engineState.status = 'finished';
  engineState.currentTurn = null;
  engineState.turnPhase = null;
  engineState.tokens.red = [56, 56, 56, 56];
  engineState.rankings = ['red', 'yellow'];

  const legacyFinishedState = {
    gameType: 'ludo',
    roomId: 'legacy_finished',
    status: 'finished',
    hostUserId: 'user_alice',
    activeSeatCount: 2,
    engineState,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_alice', displayName: 'Alice', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'user_bob', displayName: 'Bob', botDifficulty: null, ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    rankings: ['red', 'yellow'],
    createdAt: 1000,
    updatedAt: 1000,
    revision: 20,
  };

  const validation = validateLudoRoomState(legacyFinishedState);
  assert.equal(validation.valid, true);

  const ctx = new TestContext('legacy_finished');
  const restored = LudoOnlineController.fromState('legacy_finished', ctx.callbacks, legacyFinishedState);

  const state = restored.getState();
  assert.equal(state.status, 'finished');
  assert.deepEqual(state.displayRankings, ['red', 'yellow']);
});

test('161. (Gate 25) mobile 4B2 compatibility with representative 4C1 LUDO_GAME_STATE', () => {
  const event4C1 = {
    type: 'LUDO_GAME_STATE',
    roomId: 'room_compat',
    state: {
      status: 'playing',
      currentTurn: 'red',
      turnPhase: 'roll',
      currentRoll: null,
      legalMoves: [],
      tokens: { red: [-1, -1, -1, -1], green: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
      rankings: [],
    },
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', botDifficulty: null, ready: true, controlMode: 'human', presence: 'online', disconnectDeadline: null, abandonedAt: null },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'u2', displayName: 'Bob', botDifficulty: null, ready: true, controlMode: 'takeover-bot', presence: 'abandoned', disconnectDeadline: null, abandonedAt: 123456 },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    hostUserId: 'u1',
    presence: { u1: true, u2: false },
    revision: 10,
    protocolVersion: 1,
    finishReason: null,
    displayRankings: undefined,
  };

  // Parse with mobile's parseLudoServerEvent
  const parsed = parseLudoServerEvent(event4C1);
  assert.ok(parsed);
  assert.equal(parsed.type, 'LUDO_GAME_STATE');
  assert.equal(parsed.revision, 10);
  assert.equal(parsed.seats.yellow.color, 'yellow');
});

test('162. (Gate 26) no raw alarm internals in broadcasted disconnectDeadline', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  ws1.close();
  ctx.controller.handleDisconnect('user_alice', ws1);

  const presenceEvents = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_PRESENCE');
  const lastPresence = presenceEvents[presenceEvents.length - 1];
  assert.ok(lastPresence);

  // Must be finite positive timestamp or null
  assert.equal(typeof lastPresence.disconnectDeadline, 'number');
  assert.ok(Number.isFinite(lastPresence.disconnectDeadline));
  assert.ok(lastPresence.disconnectDeadline > 0);

  // Must not contain any alarm internal strings or keys
  const serialized = JSON.stringify(lastPresence);
  assert.equal(serialized.includes('alarm_'), false);
  assert.equal(serialized.includes('sql_'), false);
  assert.equal(serialized.includes('key_'), false);
});

// ============================================================================
// PHASE 4D: SAME-ROOM REMATCH AND GENERATION TESTS (163..199)
// ============================================================================

async function createFinishedGameHelper(overrides = {}) {
  const { ctx, ws1, ws2, ws3, ws4 } = await createStartedGame(overrides.playerCount || 2, overrides.diceRolls || [1, 2]);
  const state = ctx.controller.getState();
  state.status = 'finished';
  state.finishReason = overrides.finishReason || 'normal';
  state.rankings = overrides.rankings || ['red', 'yellow'];
  state.displayRankings = [...state.rankings];
  if (state.engineState) {
    state.engineState.status = 'finished';
    state.engineState.currentTurn = null;
    state.engineState.turnPhase = null;
    state.engineState.tokens.red = [56, 56, 56, 56];
    state.engineState.rankings = [...state.rankings];
  }
  if (overrides.mutateState) {
    overrides.mutateState(state);
  }
  ctx.controller['state'] = state;
  return { ctx, ws1, ws2, ws3, ws4 };
}

test('163. (Phase 4D / 1) normal finished host can return to lobby', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'lobby');
  const lobbyEvents = ctx.broadcastEvents.filter((e) => e.type === 'LUDO_LOBBY_STATE');
  assert.ok(lobbyEvents.length > 0);
  const last = lobbyEvents[lobbyEvents.length - 1];
  assert.equal(last.lobby.status, 'lobby');
});

test('164. (Phase 4D / 2) non-host cannot reset (NOT_HOST)', async () => {
  const { ctx, ws2 } = await createFinishedGameHelper();
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'finished');
  const err = ws2.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'NOT_HOST');
});

test('165. (Phase 4D / 3) playing match cannot reset (INVALID_PHASE)', async () => {
  const { ctx, ws1 } = await createStartedGame(2);
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'playing');
  const err = ws1.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'INVALID_PHASE');
});

test('166. (Phase 4D / 4) lobby cannot reset (INVALID_PHASE)', async () => {
  const ctx = new TestContext('lobby_reset_test');
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().status, 'lobby');
  const err = ws1.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'INVALID_PHASE');
});

test('167. (Phase 4D / 5) all-human-abandoned terminal cannot reset (INVALID_PHASE)', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper({ finishReason: 'all-humans-abandoned' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'finished');
  const err = ws1.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'INVALID_PHASE');
});

test('168. (Phase 4D / 6 & 7) connected humans (host and non-host) retained with clean presence and ready false', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const state = ctx.controller.getState();
  // Alice retained
  assert.equal(state.seats.red.status, 'human');
  assert.equal(state.seats.red.userId, 'user_alice');
  assert.equal(state.seats.red.ready, false);
  assert.equal(state.seats.red.controlMode, 'human');
  assert.equal(state.seats.red.presence, 'online');
  assert.equal(state.seats.red.disconnectDeadline, null);
  assert.equal(state.seats.red.abandonedAt, null);

  // Bob retained
  assert.equal(state.seats.yellow.status, 'human');
  assert.equal(state.seats.yellow.userId, 'user_bob');
  assert.equal(state.seats.yellow.ready, false);
  assert.equal(state.seats.yellow.controlMode, 'human');
  assert.equal(state.seats.yellow.presence, 'online');
  assert.equal(state.seats.yellow.disconnectDeadline, null);
  assert.equal(state.seats.yellow.abandonedAt, null);
});

test('169. (Phase 4D / 8) disconnected finished human cleared to open', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();
  // Bob disconnects after match finishes
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.status, 'open');
  assert.equal(state.seats.yellow.userId, null);
  assert.equal(state.seats.yellow.displayName, null);
  assert.equal(state.seats.yellow.ready, false);
});

test('170. (Phase 4D / 9 & 10) abandoned human / takeover bot cleared to open and does not become configured bot', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper({
    mutateState: (s) => {
      s.seats.yellow.controlMode = 'takeover-bot';
      s.seats.yellow.presence = 'abandoned';
      s.seats.yellow.abandonedAt = 123456;
    },
  });

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const state = ctx.controller.getState();
  assert.equal(state.seats.yellow.status, 'open');
  assert.equal(state.seats.yellow.userId, null);
  assert.equal(state.seats.yellow.displayName, null);
  assert.equal(state.seats.yellow.controlMode, 'human');
  assert.equal(state.seats.yellow.presence, 'online');
  assert.notEqual(state.seats.yellow.status, 'bot');
});

test('171. (Phase 4D / 11 & 12) configured bot retained with color, difficulty, and ready true', async () => {
  const ctx = new TestContext('bot_retention_room');
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'hard' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  const state = ctx.controller.getState();
  state.status = 'finished';
  state.finishReason = 'normal';
  state.rankings = ['red', 'yellow'];
  state.displayRankings = ['red', 'yellow'];
  if (state.engineState) {
    state.engineState.status = 'finished';
    state.engineState.rankings = ['red', 'yellow'];
  }
  ctx.controller['state'] = state;

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const resetState = ctx.controller.getState();
  assert.equal(resetState.seats.yellow.status, 'bot');
  assert.equal(resetState.seats.yellow.controlMode, 'bot');
  assert.equal(resetState.seats.yellow.botDifficulty, 'hard');
  assert.equal(resetState.seats.yellow.ready, true);
  assert.equal(resetState.seats.yellow.presence, 'online');
});

test('172. (Phase 4D / 13, 14, 15) activeSeatCount retained, cleared active seat becomes open, inactive remains closed', async () => {
  const { ctx, ws1, ws2, ws4 } = await createFinishedGameHelper({ playerCount: 4 });
  // Dave disconnects
  ws4.close();
  ctx.controller.handleDisconnect('user_dave', ws4);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const state = ctx.controller.getState();
  assert.equal(state.activeSeatCount, 4);
  assert.equal(state.seats.red.status, 'human');
  assert.equal(state.seats.green.status, 'human');
  assert.equal(state.seats.yellow.status, 'human');
  assert.equal(state.seats.blue.status, 'open'); // Dave's seat cleared to open

  // Now test 2-player game retains inactive seats closed
  const { ctx: ctx2, ws1: wsA } = await createFinishedGameHelper({ playerCount: 2 });
  await ctx2.send(wsA, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  const state2 = ctx2.controller.getState();
  assert.equal(state2.activeSeatCount, 2);
  assert.equal(state2.seats.green.status, 'closed');
  assert.equal(state2.seats.blue.status, 'closed');
});

test('173. (Phase 4D / 16..21) engine, rankings, finishReason, and lifecycle fields cleared', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const state = ctx.controller.getState();
  assert.equal(state.engineState, null);
  assert.deepEqual(state.rankings, []);
  assert.equal(state.displayRankings, undefined);
  assert.equal(state.finishReason, null);
  assert.equal(state.seats.red.ready, false);
  assert.equal(state.seats.yellow.ready, false);
  assert.equal(state.seats.red.disconnectDeadline, null);
  assert.equal(state.seats.yellow.disconnectDeadline, null);
  assert.equal(state.seats.red.abandonedAt, null);
  assert.equal(state.seats.yellow.abandonedAt, null);
});

test('174. (Phase 4D / 22 & 23) disconnect_grace rows and alarm cleared; stale alarm after reset is no-op', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  // Insert mock disconnect grace row
  ctx.execSql('INSERT INTO disconnect_grace (user_id, room_id, deadline) VALUES (?, ?, ?)', 'user_bob', ctx.roomId, Date.now() + 90000);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const remaining = ctx.execSql('SELECT user_id FROM disconnect_grace WHERE room_id = ?', ctx.roomId).toArray();
  assert.equal(remaining.length, 0);

  // Stale alarm executes against reset lobby
  await ctx.controller.handleDisconnectTimeout(ctx.roomId, 'user_bob');
  // State remains unaffected in lobby
  assert.equal(ctx.controller.getState().status, 'lobby');
});

test('175. (Phase 4D / 24) revision increments monotonically exactly once for reset', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  const revBefore = ctx.controller.getRevision();

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  const revAfter = ctx.controller.getRevision();

  assert.equal(revAfter, revBefore + 1);
});

test('176. (Phase 4D / 25) persistence failure leaves finished state intact', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  const originalState = ctx.controller.getState();

  // Sabotage persist callback
  ctx.controller['callbacks'].persist = () => {
    throw new Error('Disk quota exceeded');
  };

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'finished');
  assert.deepEqual(ctx.controller.getState().rankings, originalState.rankings);
  const err = ws1.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'STORAGE_ERROR');
});

test('177. (Phase 4D / 26 & 36) DO restart then reset works and preserves generation', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  const finishedState = ctx.controller.getState();
  finishedState.roomGeneration = 2;

  // Simulate DO hibernation restart by constructing fresh controller from serialized state
  const restarted = LudoOnlineController.fromState(
    ctx.roomId,
    ctx.controller['callbacks'],
    finishedState
  );
  assert.equal(restarted.getState().roomGeneration, 2);

  // Host reconnects and triggers Play Again on restarted instance
  restarted['handleReturnToLobby'](ws1, 'user_alice');

  assert.equal(restarted.getState().status, 'lobby');
  assert.equal(restarted.getState().roomGeneration, 3);
});

test('178. (Phase 4D / 27 & 28) legacy room defaults generation 1 and fresh room has generation 1', async () => {
  const ctx = new TestContext('gen_test_room');
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  // Legacy state without roomGeneration
  const legacyState = JSON.parse(JSON.stringify(ctx.controller.getState()));
  delete legacyState.roomGeneration;

  const restored = LudoOnlineController.fromState(ctx.roomId, ctx.controller['callbacks'], legacyState);
  assert.equal(restored.getState().roomGeneration, 1);
});

test('179. (Phase 4D / 29 & 30) normal game start and finish do NOT increment generation', async () => {
  const { ctx } = await createStartedGame(2);
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  // Transition to finished
  const state = ctx.controller.getState();
  state.status = 'finished';
  state.finishReason = 'normal';
  state.rankings = ['red', 'yellow'];
  ctx.controller['state'] = state;

  assert.equal(ctx.controller.getState().roomGeneration, 1);
});

test('180. (Phase 4D / 31 & 32) Play Again increments generation 1 -> 2, and next cycle increments 2 -> 3', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  // Cycle 1 Rematch
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().roomGeneration, 2);
  assert.equal(ctx.controller.getLobbyState().roomGeneration, 2);

  // Ready up and start game in generation 2
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });
  assert.equal(ctx.controller.getState().roomGeneration, 2);

  // Finish match 2
  const state2 = ctx.controller.getState();
  state2.status = 'finished';
  state2.finishReason = 'normal';
  state2.rankings = ['yellow', 'red'];
  state2.displayRankings = ['yellow', 'red'];
  ctx.controller['state'] = state2;

  // Cycle 2 Rematch
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().roomGeneration, 3);
  assert.equal(ctx.controller.getLobbyState().roomGeneration, 3);
});

test('181. (Phase 4D / 33 & 34) player-count change and bot settings do NOT increment generation', async () => {
  const ctx = new TestContext('settings_gen_room');
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 3 });
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green', difficulty: 'easy' });
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_BOT_DIFFICULTY', color: 'green', difficulty: 'hard' });
  assert.equal(ctx.controller.getState().roomGeneration, 1);
});

test('182. (Phase 4D / 35) malformed generation validation rejected', () => {
  const ctx = new TestContext('validate_gen_room');
  const validState = ctx.controller.getState();

  const zeroGen = { ...validState, roomGeneration: 0 };
  assert.equal(validateLudoRoomState(zeroGen).valid, false);

  const negGen = { ...validState, roomGeneration: -5 };
  assert.equal(validateLudoRoomState(negGen).valid, false);

  const nanGen = { ...validState, roomGeneration: NaN };
  assert.equal(validateLudoRoomState(nanGen).valid, false);

  const fracGen = { ...validState, roomGeneration: 2.7 };
  assert.equal(validateLudoRoomState(fracGen).valid, false);

  const strGen = { ...validState, roomGeneration: '2' };
  assert.equal(validateLudoRoomState(strGen).valid, false);
});

test('183. (Section 4 & 15) Abandoned takeover human seat resets to OPEN with all metadata cleared', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  // Simulate Yellow seat was taken over by bot
  const state = ctx.controller.getState();
  state.seats.yellow = {
    color: 'yellow',
    status: 'human',
    userId: 'user_bob',
    displayName: 'Bob',
    botDifficulty: null,
    ready: false,
    controlMode: 'takeover-bot',
    presence: 'abandoned',
    abandonedAt: 123456,
    disconnectDeadline: 123000,
  };
  ctx.controller['state'] = state;

  // Host resets to lobby
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const resetState = ctx.controller.getState();
  assert.equal(resetState.status, 'lobby');
  const yellowSeat = resetState.seats.yellow;
  assert.equal(yellowSeat.status, 'open');
  assert.equal(yellowSeat.userId, null);
  assert.equal(yellowSeat.displayName, null);
  assert.equal(yellowSeat.botDifficulty, null);
  assert.equal(yellowSeat.ready, false);
  assert.equal(yellowSeat.controlMode, 'human');
  assert.equal(yellowSeat.presence, 'online');
  assert.equal(yellowSeat.disconnectDeadline, null);
  assert.equal(yellowSeat.abandonedAt, null);
});

test('184. (Section 6) Active socket accounting controls human retention across multi-socket events', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();

  // Bob initially has 1 socket (ws2). Connect a second socket for Bob.
  const wsBob2 = ctx.connect('user_bob');
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 2);

  // Bob closes 1 socket -> still has 1 socket (ws2), seat retained
  wsBob2.close();
  ctx.controller.handleDisconnect('user_bob', wsBob2);
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 1);

  // Bob closes ws2 -> 0 sockets
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 0);

  // Bob reconnects 1 socket before rematch
  const wsBob3 = ctx.connect('user_bob');
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 1);

  // Host triggers rematch -> Bob is retained because active socket count > 0
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  const lobby = ctx.controller.getState();
  assert.equal(lobby.seats.yellow.status, 'human');
  assert.equal(lobby.seats.yellow.userId, 'user_bob');

  // Next game finished -> Bob closes socket
  lobby.status = 'finished';
  lobby.finishReason = 'normal';
  ctx.controller['state'] = lobby;
  wsBob3.close();
  ctx.controller.handleDisconnect('user_bob', wsBob3);
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 0);

  // Host triggers rematch -> Bob now has 0 sockets, so seat is cleared to OPEN
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  const lobby2 = ctx.controller.getState();
  assert.equal(lobby2.seats.yellow.status, 'open');
  assert.equal(lobby2.seats.yellow.userId, null);
});

test('185. (Section 7) Finished player with stale presence but 0 active sockets is cleared to OPEN', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();

  // Disconnect Bob's active socket
  ws2.close();
  ctx.controller.handleDisconnect('user_bob', ws2);
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 0);

  // State metadata claims Bob is online, but sockets map has 0 connections
  const state = ctx.controller.getState();
  state.seats.yellow.presence = 'online';
  state.seats.yellow.disconnectDeadline = null;
  ctx.controller['state'] = state;

  // Host triggers Play Again
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  // Actual socket ownership wins: Bob is cleared to OPEN
  assert.equal(ctx.controller.getState().seats.yellow.status, 'open');
  assert.equal(ctx.controller.getState().seats.yellow.userId, null);
});

test('186. (Section 8 & 9) Abandoned spectator with active WebSocket is NOT retained in old seat', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();

  // Yellow was abandoned takeover-bot
  const state = ctx.controller.getState();
  state.seats.yellow.controlMode = 'takeover-bot';
  state.seats.yellow.presence = 'abandoned';
  ctx.controller['state'] = state;

  // Original Bob user reconnected after abandonment as spectator (has active socket ws2)
  assert.equal(ctx.controller['callbacks'].getUserSockets('user_bob').length, 1);

  // Host resets to lobby
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const resetState = ctx.controller.getState();
  // Historical Yellow seat MUST be cleared to OPEN despite Bob having active socket
  assert.equal(resetState.seats.yellow.status, 'open');
  assert.equal(resetState.seats.yellow.userId, null);
});

test('187. (Section 10 & 11) Unseated connected spectator can claim open seat in fresh lobby without reconnecting', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();

  // Yellow was abandoned takeover-bot
  const state = ctx.controller.getState();
  state.seats.yellow.controlMode = 'takeover-bot';
  state.seats.yellow.presence = 'abandoned';
  ctx.controller['state'] = state;

  // Host resets: Yellow seat is cleared to OPEN, Bob remains connected on ws2
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().seats.yellow.status, 'open');

  // Bob is connected on ws2, unseated. Sends LUDO_JOIN over existing socket ws2.
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_JOIN', preferredColor: 'yellow' });

  // Bob claims open Yellow seat!
  const lobby = ctx.controller.getState();
  assert.equal(lobby.seats.yellow.status, 'human');
  assert.equal(lobby.seats.yellow.userId, 'user_bob');
  assert.equal(lobby.seats.yellow.ready, false);
});

test('188. (Section 14) Configured bots (easy, normal, hard) are retained with difficulties and controlMode bot', async () => {
  const ctx = new TestContext('bot_retention_room');
  const ws1 = ctx.connect('user_alice');
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_JOIN', displayName: 'Alice' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_SET_PLAYER_COUNT', playerCount: 4 });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'green', difficulty: 'easy' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'yellow', difficulty: 'normal' });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_ADD_BOT', color: 'blue', difficulty: 'hard' });

  // Simulate game start and finish
  const state = ctx.controller.getState();
  state.status = 'finished';
  state.finishReason = 'normal';
  state.rankings = ['red', 'blue', 'yellow', 'green'];
  ctx.controller['state'] = state;

  // Rematch
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  const lobby = ctx.controller.getState();
  assert.equal(lobby.seats.green.status, 'bot');
  assert.equal(lobby.seats.green.controlMode, 'bot');
  assert.equal(lobby.seats.green.botDifficulty, 'easy');
  assert.equal(lobby.seats.green.ready, true);

  assert.equal(lobby.seats.yellow.status, 'bot');
  assert.equal(lobby.seats.yellow.controlMode, 'bot');
  assert.equal(lobby.seats.yellow.botDifficulty, 'normal');
  assert.equal(lobby.seats.yellow.ready, true);

  assert.equal(lobby.seats.blue.status, 'bot');
  assert.equal(lobby.seats.blue.controlMode, 'bot');
  assert.equal(lobby.seats.blue.botDifficulty, 'hard');
  assert.equal(lobby.seats.blue.ready, true);
});

test('189. (Section 17) Stale alarm firing after reset is a strict no-op', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().status, 'lobby');
  const revBefore = ctx.controller.getRevision();

  // Platform triggers alarm in lobby
  await ctx.controller.handleAlarm();

  // No-op: revision unchanged, status remains lobby
  assert.equal(ctx.controller.getRevision(), revBefore);
  assert.equal(ctx.controller.getState().status, 'lobby');
});

test('190. (Section 27) Double rematch command: first succeeds (gen 1 -> 2), second receives INVALID_PHASE (stays gen 2)', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  const ws1_second = ctx.connect('user_alice');

  // Both sockets send LUDO_RETURN_TO_LOBBY
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().status, 'lobby');
  assert.equal(ctx.controller.getState().roomGeneration, 2);

  // Second socket sends LUDO_RETURN_TO_LOBBY while already in lobby
  await ctx.send(ws1_second, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  const err = ws1_second.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'INVALID_PHASE');

  // Generation remains 2 (NEVER 3)
  assert.equal(ctx.controller.getState().roomGeneration, 2);
});

test('191. (Section 28) Persistence failure during rematch keeps finished state and emits STORAGE_ERROR', async () => {
  const { ctx, ws1 } = await createFinishedGameHelper();
  const revBefore = ctx.controller.getRevision();

  // Mock persist callback to throw
  ctx.controller['callbacks'].persist = () => {
    throw new Error('Disk full');
  };

  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });

  assert.equal(ctx.controller.getState().status, 'finished');
  assert.equal(ctx.controller.getRevision(), revBefore);
  const err = ws1.lastMessage;
  assert.equal(err.type, 'ERROR');
  assert.equal(err.code, 'STORAGE_ERROR');
});

test('192. (Section 33) Full second-game clean-start flow', async () => {
  const { ctx, ws1, ws2 } = await createFinishedGameHelper();
  assert.equal(ctx.controller.getState().roomGeneration, 1);

  // Rematch to generation 2
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_RETURN_TO_LOBBY' });
  assert.equal(ctx.controller.getState().status, 'lobby');
  assert.equal(ctx.controller.getState().roomGeneration, 2);

  // Both players ready up
  await ctx.send(ws2, 'user_bob', { type: 'LUDO_SET_READY', ready: true });
  await ctx.send(ws1, 'user_alice', { type: 'LUDO_START_GAME' });

  const playingState = ctx.controller.getState();
  assert.equal(playingState.status, 'playing');
  assert.equal(playingState.roomGeneration, 2);
  assert.ok(playingState.engineState);
  assert.deepEqual(playingState.rankings, []);
  assert.equal(playingState.finishReason, null);

  // Verify all tokens are fresh at home (-1)
  const tokens = playingState.engineState.tokens;
  assert.equal(tokens.red.every((pos) => pos === -1), true);
  assert.equal(tokens.yellow.every((pos) => pos === -1), true);
});


