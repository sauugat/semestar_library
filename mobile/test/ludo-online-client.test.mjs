import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
} from '../services/ludo-online/room-code.ts';

import {
  parseLudoServerEvent,
  validateLobbyState,
  validateEngineStateEnvelope,
} from '../services/ludo-online/protocol.ts';

import {
  createInitialOnlineState,
  analyzeRevision,
  mapLudoErrorCodeToMessage,
  isUserHost,
  getUserSeat,
  canStartGame,
  canHostRematch,
} from '../services/ludo-online/state.ts';

import { OnlineLudoClient } from '../services/ludo-online/client.ts';

// Deterministic mock WebSocket for client tests
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url, protocols, options) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.readyState = MockWebSocket.OPEN;
    this.sentMessages = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  receiveMessage(obj) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(obj) });
    }
  }
}

function createValidEngineState(overrides = {}) {
  return {
    status: 'playing',
    currentTurn: 'red',
    turnPhase: 'roll',
    currentRoll: null,
    legalMoves: [],
    tokens: {
      red: [-1, -1, -1, -1],
      green: [-1, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
    rankings: [],
    ...overrides,
  };
}

// 1. valid lobby state parsed
test('1. valid lobby state parsed', () => {
  const validEvent = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    protocolVersion: 1,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Alice', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };

  const parsed = parseLudoServerEvent(validEvent);
  assert.ok(parsed);
  assert.equal(parsed.type, 'LUDO_LOBBY_STATE');
  assert.equal(parsed.lobby.hostUserId, 'user_1');
  assert.equal(parsed.lobby.seats.red.displayName, 'Alice');
});

// 2. malformed lobby rejected
test('2. malformed lobby rejected', () => {
  const malformed = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    lobby: {
      gameType: 'chess', // invalid
      roomId: 'ABCD23',
    },
  };

  const parsed = parseLudoServerEvent(malformed);
  assert.equal(parsed, null);
});

// 3. valid game state parsed
test('3. valid game state parsed', () => {
  const validGameState = {
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 5,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Alice', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  };

  const parsed = parseLudoServerEvent(validGameState);
  assert.ok(parsed);
  assert.equal(parsed.type, 'LUDO_GAME_STATE');
  assert.equal(parsed.revision, 5);
  assert.equal(parsed.seats.yellow.status, 'bot');
});

// 4. structured error parsed
test('4. structured error parsed', () => {
  const errorEvent = {
    type: 'ERROR',
    code: 'ROOM_FULL',
    message: 'The room has reached maximum players',
    protocolVersion: 1,
  };

  const parsed = parseLudoServerEvent(errorEvent);
  assert.ok(parsed);
  assert.equal(parsed.type, 'ERROR');
  assert.equal(parsed.code, 'ROOM_FULL');
});

// 5. stale revision ignored
test('5. stale revision ignored', () => {
  assert.equal(analyzeRevision(3, 5), 'STALE');
});

// 6. duplicate revision idempotent
test('6. duplicate revision idempotent', () => {
  assert.equal(analyzeRevision(5, 5), 'DUPLICATE');
});

// 7. next revision accepted
test('7. next revision accepted', () => {
  assert.equal(analyzeRevision(6, 5), 'NEXT');
});

// 8. revision gap requests resync
test('8. revision gap requests resync', () => {
  assert.equal(analyzeRevision(8, 5), 'GAP');
});

// 9. authoritative snapshot resolves resync
test('9. authoritative snapshot resolves resync in client', async () => {
  let createdSocket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket-123' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      createdSocket = new MockWebSocket(url, p, o);
      return createdSocket;
    },
  });

  await client.connect('ABCD23');
  createdSocket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Initial lobby rev 1
  createdSocket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  assert.equal(client.getState().lastAuthoritativeRevision, 1);
  assert.equal(client.getState().isResyncing, false);

  // Incoming revision jump: revision 5 (GAP)
  createdSocket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 5,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 5,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  // Client safely adopts authoritative snapshot rev 5 as truth and clears resync
  assert.equal(client.getState().lastSnapshotRevision, 5);
  assert.equal(client.getState().lastAuthoritativeRevision, 5);
  assert.equal(client.getState().isResyncing, false);
  client.destroy();
});

// 10. room code normalization
test('10. room code normalization', () => {
  assert.equal(normalizeRoomCode('  abcd23  '), 'ABCD23');
  assert.equal(normalizeRoomCode('k9mp2x'), 'K9MP2X');
});

// 11. invalid room code rejected
test('11. invalid room code rejected', () => {
  assert.equal(isValidRoomCode('ABC'), false); // too short
  assert.equal(isValidRoomCode('ABCD2345'), false); // too long
  assert.equal(isValidRoomCode('ABCD01'), false); // contains forbidden 0, 1
  assert.equal(isValidRoomCode('ABCDOL'), false); // contains forbidden O, L
  assert.equal(isValidRoomCode('ABCD23'), true); // valid
});

// 12. generated room code allowed charset
test('12. generated room code allowed charset', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateRoomCode();
    for (const char of code) {
      assert.ok(ROOM_CODE_ALPHABET.includes(char), `Invalid character ${char} in ${code}`);
    }
  }
});

// 13. generated codes have expected length
test('13. generated codes have expected length', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, ROOM_CODE_LENGTH);
    assert.equal(isValidRoomCode(code), true);
  }
});

// 14. host detection
test('14. host detection', () => {
  const lobby = {
    gameType: 'ludo',
    roomId: 'ABCD23',
    status: 'lobby',
    hostUserId: 'user_host',
    activeSeatCount: 2,
    revision: 1,
    seats: {},
  };

  assert.equal(isUserHost(lobby, 'user_host'), true);
  assert.equal(isUserHost(lobby, 'user_other'), false);
  assert.equal(isUserHost(null, 'user_host'), false);
});

// 15. host controls false for non-host
test('15. host controls false for non-host', () => {
  const lobby = {
    gameType: 'ludo',
    roomId: 'ABCD23',
    status: 'lobby',
    hostUserId: 'user_host',
    activeSeatCount: 2,
    revision: 1,
    seats: {},
  };

  assert.equal(isUserHost(lobby, 'guest_1'), false);
});

// 16. ready state derives correctly
test('16. ready state derives correctly in canStartGame', () => {
  const lobby = {
    gameType: 'ludo',
    roomId: 'ABCD23',
    status: 'lobby',
    hostUserId: 'user_1',
    activeSeatCount: 2,
    revision: 1,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'user_2', displayName: 'Guest', botDifficulty: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
  };

  // Guest not ready -> cannot start
  assert.equal(canStartGame(lobby).canStart, false);

  // Guest readies -> can start
  lobby.seats.yellow.ready = true;
  assert.equal(canStartGame(lobby).canStart, true);
});

// 17. composition change reflects ready reset
test('17. composition change reflects ready reset in lobby snapshot', () => {
  const lobbyBefore = {
    gameType: 'ludo',
    roomId: 'ABCD23',
    status: 'lobby',
    hostUserId: 'user_1',
    activeSeatCount: 2,
    revision: 2,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'human', userId: 'user_2', displayName: 'Guest', botDifficulty: null, ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
  };
  assert.equal(canStartGame(lobbyBefore).canStart, true);

  // Server resets guest ready on host composition change (e.g. host added bot)
  const lobbyAfter = {
    ...lobbyBefore,
    revision: 3,
    activeSeatCount: 3,
    seats: {
      ...lobbyBefore.seats,
      green: { color: 'green', status: 'bot', userId: null, displayName: 'Green Bot', botDifficulty: 'normal', ready: true },
      yellow: { ...lobbyBefore.seats.yellow, ready: false }, // Reset by server!
    },
  };

  assert.equal(lobbyAfter.seats.yellow.ready, false);
  assert.equal(canStartGame(lobbyAfter).canStart, false);
});

// 18. bot seat parsed
test('18. bot seat parsed', () => {
  const event = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: {},
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };

  const parsed = parseLudoServerEvent(event);
  assert.ok(parsed);
  assert.equal(parsed.lobby.seats.yellow.status, 'bot');
  assert.equal(parsed.lobby.seats.yellow.botDifficulty, 'normal');
});

// 19. Easy bot parsed
test('19. Easy bot parsed', () => {
  const event = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: {},
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'easy', ready: true },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };
  const parsed = parseLudoServerEvent(event);
  assert.equal(parsed.lobby.seats.yellow.botDifficulty, 'easy');
});

// 20. Hard bot parsed
test('20. Hard bot parsed', () => {
  const event = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: {},
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'hard', ready: true },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };
  const parsed = parseLudoServerEvent(event);
  assert.equal(parsed.lobby.seats.yellow.botDifficulty, 'hard');
});

// 21. unknown difficulty rejected
test('21. unknown difficulty rejected', () => {
  const event = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: {},
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'godlike', ready: true },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };
  const parsed = parseLudoServerEvent(event);
  assert.equal(parsed, null);
});

// 22. duplicate socket generation ignored
test('22. duplicate socket generation ignored', async () => {
  const sockets = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      const s = new MockWebSocket(url, p, o);
      sockets.push(s);
      return s;
    },
  });

  // First connection
  await client.connect('ABCD23');
  const socket1 = sockets[0];

  // Re-connect to a new room (increments generation)
  await client.connect('K9MP2X');
  const socket2 = sockets[1];

  // Message from old socket1 is safely ignored
  socket1.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'old_user', protocolVersion: 1 });
  assert.notEqual(client.getState().myUserId, 'old_user');

  // Message from current socket2 is accepted
  socket2.receiveMessage({ type: 'CONNECTED', roomId: 'K9MP2X', userId: 'new_user', protocolVersion: 1 });
  assert.equal(client.getState().myUserId, 'new_user');
  assert.equal(client.getState().roomId, 'K9MP2X');

  client.destroy();
});

// 23. stale old-socket message ignored
test('23. stale old-socket message ignored', async () => {
  const sockets = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      const s = new MockWebSocket(url, p, o);
      sockets.push(s);
      return s;
    },
  });

  await client.connect('ABCD23');
  const socket1 = sockets[0];
  client.disconnect();

  socket1.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'stale_user', protocolVersion: 1 });
  assert.equal(client.getState().myUserId, null);
  assert.equal(client.getState().connectionStatus, 'closed');

  client.destroy();
});

// 24. reconnect backoff bounded
test('24. reconnect backoff bounded', async () => {
  let timerDelay = 0;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => new MockWebSocket(url, p, o),
    timerFn: (fn, delay) => {
      timerDelay = delay;
      return 123;
    },
  });

  await client.connect('ABCD23');
  // Trigger unexpected socket error
  client['ws'].onerror();

  assert.equal(client.getState().connectionStatus, 'reconnecting');
  assert.ok(timerDelay >= 400 && timerDelay <= 8200, `Delay was ${timerDelay}`);

  client.destroy();
});

// 25. intentional close does not schedule reconnect
test('25. intentional close does not schedule reconnect', async () => {
  let reconnectScheduled = false;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => new MockWebSocket(url, p, o),
    timerFn: (fn, delay) => {
      if (delay < 10000) {
        reconnectScheduled = true;
      }
      return 123;
    },
  });

  await client.connect('ABCD23');
  client.disconnect();

  assert.equal(client.getState().connectionStatus, 'closed');
  assert.equal(reconnectScheduled, false);

  client.destroy();
});

// 26. unexpected close does schedule reconnect
test('26. unexpected close does schedule reconnect', async () => {
  let scheduled = false;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => new MockWebSocket(url, p, o),
    timerFn: (fn, delay) => {
      if (delay < 10000) {
        scheduled = true;
      }
      return 123;
    },
  });

  await client.connect('ABCD23');
  client['ws'].onclose();

  assert.equal(client.getState().connectionStatus, 'reconnecting');
  assert.equal(scheduled, true);

  client.destroy();
});

// 27. background prevents reconnect storm
test('27. background prevents reconnect storm', async () => {
  let reconnectTimerCount = 0;
  const mockAppState = {
    currentState: 'background',
    addEventListener: () => ({ remove: () => {} }),
  };

  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => new MockWebSocket(url, p, o),
    appStateProvider: mockAppState,
    timerFn: (fn, delay) => {
      if (delay < 10000) {
        reconnectTimerCount++;
      }
      return 123;
    },
  });

  await client.connect('ABCD23');
  client['ws'].onclose();

  // In background: reconnect timer is deferred
  assert.equal(client.getState().connectionStatus, 'reconnecting');
  assert.equal(reconnectTimerCount, 0);

  client.destroy();
});

// 28. foreground permits reconnect
test('28. foreground permits reconnect', async () => {
  let appStateListener = null;
  const mockAppState = {
    currentState: 'background',
    addEventListener: (type, fn) => {
      appStateListener = fn;
      return { remove: () => {} };
    },
  };

  let connectCount = 0;
  const client = new OnlineLudoClient({
    ticketProvider: async () => {
      connectCount++;
      return { ticket: 'mock-ticket' };
    },
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => new MockWebSocket(url, p, o),
    appStateProvider: mockAppState,
  });

  await client.connect('ABCD23');
  client['ws'].onclose();
  assert.equal(connectCount, 1);

  // Transition to foreground
  mockAppState.currentState = 'active';
  appStateListener('active');

  assert.equal(connectCount, 2);

  client.destroy();
});

// 29. room-full maps friendly error
test('29. room-full maps friendly error', () => {
  assert.equal(mapLudoErrorCodeToMessage('ROOM_FULL'), 'This room is full.');
});

// 30. NOT_READY maps friendly error
test('30. NOT_READY maps friendly error', () => {
  assert.equal(mapLudoErrorCodeToMessage('NOT_READY'), 'All players must be ready before starting.');
});

// 31. SEAT_OCCUPIED maps friendly error
test('31. SEAT_OCCUPIED maps friendly error', () => {
  assert.equal(mapLudoErrorCodeToMessage('SEAT_OCCUPIED'), 'That seat is already occupied.');
});

// 32. malformed server JSON does not crash
test('32. malformed server JSON does not crash client', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  // Raw non-JSON string
  assert.doesNotThrow(() => {
    socket.onmessage({ data: 'NOT JSON AT ALL {{{' });
  });

  client.destroy();
});

// 33. unknown event does not corrupt state
test('33. unknown event does not corrupt state', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'SOME_WEIRD_EVENT', foo: 'bar' });

  assert.equal(client.getState().lastError, null);
  assert.equal(client.getState().lastAuthoritativeRevision, 0);

  client.destroy();
});

// 34. playing transition occurs cleanly
test('34. playing transition occurs cleanly', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  assert.ok(client.getState().playingState);
  assert.equal(client.getState().lastAuthoritativeRevision, 10);

  client.destroy();
});

// 35. duplicate playing snapshot does not trigger duplicate transition
test('35. duplicate playing snapshot does not re-apply mutation', async () => {
  let updates = 0;
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.subscribe(() => {
    updates++;
  });

  await client.connect('ABCD23');
  const gameStateMsg = {
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  };

  socket.receiveMessage(gameStateMsg);
  const countAfterFirst = updates;

  // Exact duplicate revision
  socket.receiveMessage(gameStateMsg);
  assert.equal(updates, countAfterFirst);

  client.destroy();
});

// 36. ticket safety: ticket is never in room state, URL, or room code
test('36. ticket safety: ticket is never in room state, URL, or room code', async () => {
  const secretTicket = 'super-secret-ticket-claims-value-xyz';
  let capturedUrl = '';
  let capturedHeaders = null;

  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: secretTicket }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      capturedUrl = url;
      capturedHeaders = o.headers;
      return new MockWebSocket(url, p, o);
    },
  });

  await client.connect('ABCD23');

  // Verify URL has no ticket or token query param
  assert.equal(capturedUrl.includes(secretTicket), false);
  assert.equal(capturedUrl.includes('?ticket='), false);
  assert.equal(capturedUrl.includes('?token='), false);

  // Verify headers hold Authorization Bearer
  assert.equal(capturedHeaders.Authorization, `Bearer ${secretTicket}`);

  // Verify client state does not store ticket
  const stateStr = JSON.stringify(client.getState());
  assert.equal(stateStr.includes(secretTicket), false);

  client.destroy();
});

// 37. action event and GAME_STATE same revision both processed correctly
test('37. action event and GAME_STATE same revision both processed correctly', async () => {
  let socket = null;
  const actionEvents = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.onActionEvent((e) => {
    actionEvents.push(e);
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Roll event revision 10
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 10,
    color: 'red',
    roll: 6,
    legalMoves: [0],
  });

  // GAME_STATE revision 10
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState({ currentRoll: 6 }),
  });

  // Both processed!
  assert.equal(actionEvents.length, 1);
  assert.equal(actionEvents[0].type, 'LUDO_DICE_ROLLED');
  assert.equal(actionEvents[0].revision, 10);
  assert.equal(client.getState().lastSnapshotRevision, 10);
  assert.equal(client.getState().lastActionRevision, 10);
  assert.ok(client.getState().playingState);

  client.destroy();
});

// 38. MOVE_RESULT and GAME_STATE same revision both processed
test('38. MOVE_RESULT and GAME_STATE same revision both processed', async () => {
  let socket = null;
  const actionEvents = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.onActionEvent((e) => {
    actionEvents.push(e);
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Move event revision 11
  socket.receiveMessage({
    type: 'LUDO_MOVE_RESULT',
    roomId: 'ABCD23',
    revision: 11,
    player: 'red',
    tokenId: 0,
    from: -1,
    to: 0,
    capturedTokens: [],
    bonusRoll: true,
  });

  // Snapshot revision 11
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 11,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  assert.equal(actionEvents.length, 1);
  assert.equal(actionEvents[0].type, 'LUDO_MOVE_RESULT');
  assert.equal(client.getState().lastSnapshotRevision, 11);
  assert.equal(client.getState().lastActionRevision, 11);

  client.destroy();
});

// 39. bot burst R10/R11/R12/R13 + GAME_STATE R13 preserved
test('39. bot burst R10/R11/R12/R13 + GAME_STATE R13 preserved', async () => {
  let socket = null;
  const actionEvents = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.onActionEvent((e) => {
    actionEvents.push(e);
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Set initial baseline
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 9,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  // Bot burst sequence:
  // DICE R10
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'yellow', roll: 6, legalMoves: [0] });
  // MOVE R11
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 11, player: 'yellow', tokenId: 0, from: -1, to: 13, capturedTokens: [], bonusRoll: true });
  // DICE R12
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 12, color: 'yellow', roll: 3, legalMoves: [0] });
  // MOVE R13
  socket.receiveMessage({ type: 'LUDO_MOVE_RESULT', roomId: 'ABCD23', revision: 13, player: 'yellow', tokenId: 0, from: 13, to: 16, capturedTokens: [], bonusRoll: false });
  // GAME_STATE R13
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 13,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  // Verify all 4 action events were emitted in order
  assert.equal(actionEvents.length, 4);
  assert.equal(actionEvents[0].revision, 10);
  assert.equal(actionEvents[1].revision, 11);
  assert.equal(actionEvents[2].revision, 12);
  assert.equal(actionEvents[3].revision, 13);
  // Verify final game state R13 was applied and not discarded because MOVE R13 arrived earlier
  assert.equal(client.getState().lastSnapshotRevision, 13);
  assert.equal(client.getState().lastAuthoritativeRevision, 13);

  client.destroy();
});

// 40. action revision gap triggers resync
test('40. action revision gap triggers resync', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Initial snapshot R10
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  // Action event arrives with GAP: R12 (skipped R11)
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 12,
    color: 'yellow',
    roll: 4,
    legalMoves: [0],
  });

  // Presentation gap detected, resync requested
  assert.equal(client.getState().presentationGapDetected, true);
  assert.equal(client.getState().isResyncing, true);
  const sent = socket.sentMessages.map((m) => JSON.parse(m));
  assert.ok(sent.some((m) => m.type === 'LUDO_REQUEST_STATE'));

  client.destroy();
});

// 41. full snapshot revision jump safely restores truth
test('41. full snapshot revision jump safely restores truth', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Initial state R5
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 5,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  // Simulate presentation gap
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 8,
    color: 'yellow',
    roll: 3,
    legalMoves: [0],
  });
  assert.equal(client.getState().isResyncing, true);

  // Full snapshot jump arrives: R10
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  // Restores truth safely, resets queue and gap
  assert.equal(client.getState().lastSnapshotRevision, 10);
  assert.equal(client.getState().lastAuthoritativeRevision, 10);
  assert.equal(client.getState().presentationGapDetected, false);
  assert.equal(client.getState().isResyncing, false);

  client.destroy();
});

// 42. resync flag clears on authoritative snapshot
test('42. resync flag clears on authoritative snapshot', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Trigger resync
  client.requestState();
  assert.equal(client.getState().isResyncing, true);

  // Authoritative snapshot arrives
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 3,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 3,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  assert.equal(client.getState().isResyncing, false);
  client.destroy();
});

// 43. duplicate snapshot ignored
test('43. duplicate snapshot ignored', async () => {
  let socket = null;
  let updateCount = 0;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.subscribe(() => {
    updateCount++;
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  const snapshot = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 4,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 4,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  };

  socket.receiveMessage(snapshot);
  const countAfterFirst = updateCount;

  // Duplicate revision 4 snapshot
  socket.receiveMessage(snapshot);
  assert.equal(updateCount, countAfterFirst);

  client.destroy();
});

// 44. duplicate action event ignored independently
test('44. duplicate action event ignored independently', async () => {
  let socket = null;
  const actionEvents = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  client.onActionEvent((e) => {
    actionEvents.push(e);
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  const rollEvent = {
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 6,
    color: 'red',
    roll: 5,
    legalMoves: [0],
  };

  socket.receiveMessage(rollEvent);
  socket.receiveMessage(rollEvent); // duplicate!

  assert.equal(actionEvents.length, 1);
  client.destroy();
});

// 45. ERROR does not advance snapshot revision
test('45. ERROR does not advance snapshot revision', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Snapshot rev 5
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 5,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 5,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });
  assert.equal(client.getState().lastSnapshotRevision, 5);

  // Error arrives
  socket.receiveMessage({
    type: 'ERROR',
    code: 'INVALID_MOVE',
    message: 'Illegal move attempted',
    protocolVersion: 1,
  });

  // Snapshot revision remains 5
  assert.equal(client.getState().lastSnapshotRevision, 5);

  // Snapshot rev 6 arrives and is accepted as next revision
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 6,
    presence: { user_1: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'user_1',
      activeSeatCount: 2,
      revision: 6,
      seats: {
        red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });
  assert.equal(client.getState().lastSnapshotRevision, 6);

  client.destroy();
});

// 46. presence event does not hide same-revision game snapshot
test('46. presence event does not hide same-revision game snapshot', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });

  // Presence event R5 arrives
  socket.receiveMessage({
    type: 'LUDO_PRESENCE',
    roomId: 'ABCD23',
    revision: 5,
    presence: { user_1: true, user_2: false },
  });

  // Snapshot R5 arrives: must not be ignored
  socket.receiveMessage({
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 5,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  });

  assert.equal(client.getState().lastSnapshotRevision, 5);
  assert.ok(client.getState().playingState);

  client.destroy();
});

// 47. create mode verifies current user becomes host
test('47. create mode verifies current user becomes host', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23', undefined, 'create');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'creator_user', protocolVersion: 1 });

  // Fresh lobby where creator is host
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    presence: { creator_user: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'creator_user',
      activeSeatCount: 2,
      revision: 1,
      seats: {
        red: { color: 'red', status: 'human', userId: 'creator_user', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  assert.equal(client.getState().roomId, 'ABCD23');
  assert.equal(isUserHost(client.getState().lobby, client.getState().myUserId), true);
  assert.equal(client.getState().connectionStatus, 'connected');

  client.destroy();
});

// 48. create collision triggers a retry
test('48. create collision triggers a retry', async () => {
  const sockets = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      const s = new MockWebSocket(url, p, o);
      sockets.push(s);
      return s;
    },
    randomBytesProvider: () => new Uint8Array([2, 3, 4, 5, 6, 7]),
  });

  await client.connect('ABCD23', undefined, 'create');
  const socket1 = sockets[0];
  socket1.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'my_user', protocolVersion: 1 });

  // Existing room where host is someone else (COLLISION!)
  socket1.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 5,
    presence: { other_user: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'other_user',
      activeSeatCount: 2,
      revision: 5,
      seats: {
        red: { color: 'red', status: 'human', userId: 'other_user', displayName: 'Other', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  // Client detected collision and initiated a retry on a new room code
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sockets.length, 2);
  assert.notEqual(client.getState().roomId, 'ABCD23');

  client.destroy();
});

// 49. create collision retries are bounded
test('49. create collision retries are bounded', async () => {
  const sockets = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      const s = new MockWebSocket(url, p, o);
      sockets.push(s);
      return s;
    },
  });

  await client.connect('ABCD23', undefined, 'create');

  for (let i = 0; i < 4; i++) {
    const s = sockets[i];
    s.receiveMessage({ type: 'CONNECTED', roomId: 'ANY', userId: 'my_user', protocolVersion: 1 });
    // Colliding lobby
    s.receiveMessage({
      type: 'LUDO_LOBBY_STATE',
      roomId: 'ANY',
      revision: 5,
      presence: { other_user: true },
      lobby: {
        gameType: 'ludo',
        roomId: 'ANY',
        status: 'lobby',
        hostUserId: 'other_user',
        activeSeatCount: 2,
        revision: 5,
        seats: {
          red: { color: 'red', status: 'human', userId: 'other_user', displayName: 'Other', botDifficulty: null, ready: true },
          green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
          yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
          blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 10));
  }

  // After 3 retries (4 sockets total), transitions to error CREATE_EXHAUSTED
  assert.equal(client.getState().connectionStatus, 'error');
  assert.equal(client.getState().lastError?.code, 'CREATE_EXHAUSTED');
  assert.equal(client.getState().lastError?.friendlyMessage, "Couldn't create a room. Please try again.");

  client.destroy();
});

// 50. join mode permits non-host success
test('50. join mode permits non-host success', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23', undefined, 'join');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'guest_user', protocolVersion: 1 });

  // Lobby where host is someone else
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 2,
    presence: { host_user: true, guest_user: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'host_user',
      activeSeatCount: 2,
      revision: 2,
      seats: {
        red: { color: 'red', status: 'human', userId: 'host_user', displayName: 'Host', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'human', userId: 'guest_user', displayName: 'Guest', botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  // Accepted without error or retry!
  assert.equal(client.getState().connectionStatus, 'connected');
  assert.equal(client.getState().roomId, 'ABCD23');
  assert.equal(isUserHost(client.getState().lobby, 'guest_user'), false);

  client.destroy();
});

// 51. generated room code uses secure RNG boundary / injectable source
test('51. generated room code uses secure RNG boundary / injectable source', () => {
  const customRng = (len) => {
    const bytes = new Uint8Array(len);
    bytes.fill(0); // first char of ROOM_CODE_ALPHABET is '2'
    return bytes;
  };

  const code = generateRoomCode(customRng);
  assert.equal(code, '222222');
});

// 52. malformed route room ID rejected before socket
test('52. malformed route room ID rejected before socket', () => {
  assert.equal(isValidRoomCode('bad/../x'), false);
  assert.equal(isValidRoomCode('ABC'), false);
  assert.equal(isValidRoomCode(''), false);
  assert.equal(isValidRoomCode('123456'), false); // contains forbidden 1
  assert.equal(isValidRoomCode('ABCD01'), false); // contains forbidden 0, 1
});

// 53. command while disconnected fails safely
test('53. command while disconnected fails safely', () => {
  const client = new OnlineLudoClient();
  assert.equal(client.setReady(true), false);
  assert.equal(client.addBot('green'), false);
  assert.equal(client.removeBot('green'), false);
  assert.equal(client.setPlayerCount(3), false);
  assert.equal(client.startGame(), false);
  assert.doesNotThrow(() => client.leaveRoom());
});

// 54. command while resyncing blocked
test('54. command while resyncing blocked', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });
  client.requestState();

  assert.equal(client.getState().isResyncing, true);
  // State mutating command is blocked
  assert.equal(client.setReady(true), false);
  assert.equal(client.startGame(), false);

  client.destroy();
});

// 55. one socket open sends one LUDO_JOIN
test('55. one socket open sends one LUDO_JOIN', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  // Trigger onopen multiple times
  socket.onopen();
  socket.onopen();

  socket.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'user_1', protocolVersion: 1 });
  const joins = socket.sentMessages.map((m) => JSON.parse(m)).filter((m) => m.type === 'LUDO_JOIN');
  assert.equal(joins.length, 1);

  client.destroy();
});

// 56. reconnect AppState race creates one reconnect attempt
test('56. reconnect AppState race creates one reconnect attempt', async () => {
  let reconnectCount = 0;
  let appStateListener = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      reconnectCount++;
      return new MockWebSocket(url, p, o);
    },
    appStateProvider: {
      currentState: 'active',
      addEventListener: (type, listener) => {
        appStateListener = listener;
        return { remove: () => {} };
      },
    },
    timerFn: () => 123,
    clearTimerFn: () => {},
  });

  await client.connect('ABCD23');
  assert.equal(reconnectCount, 1);

  // Socket error triggers reconnecting state
  client['handleSocketFailure']('ABCD23', client['connectionGeneration'], new Error('test'));
  assert.equal(client.getState().connectionStatus, 'reconnecting');

  // Background app
  appStateListener('background');

  // Foreground app
  appStateListener('active');
  await new Promise((r) => setTimeout(r, 10));

  // Exactly one reconnect attempt triggered upon foregrounding
  assert.equal(reconnectCount, 2);

  client.destroy();
});

// 57. create retry old socket callbacks ignored
test('57. create retry old socket callbacks ignored', async () => {
  const sockets = [];
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      const s = new MockWebSocket(url, p, o);
      sockets.push(s);
      return s;
    },
  });

  await client.connect('ABCD23', undefined, 'create');
  const socket1 = sockets[0];
  socket1.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'my_user', protocolVersion: 1 });

  // Colliding lobby triggers retry
  socket1.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 10,
    presence: { other_user: true },
    lobby: {
      gameType: 'ludo',
      roomId: 'ABCD23',
      status: 'lobby',
      hostUserId: 'other_user',
      activeSeatCount: 2,
      revision: 10,
      seats: {
        red: { color: 'red', status: 'human', userId: 'other_user', displayName: 'Other', botDifficulty: null, ready: true },
        green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
        yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
        blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      },
    },
  });

  // Stale message from socket1 after retry
  socket1.receiveMessage({ type: 'CONNECTED', roomId: 'ABCD23', userId: 'should_ignore', protocolVersion: 1 });
  assert.notEqual(client.getState().myUserId, 'should_ignore');

  client.destroy();
});

// 58. duplicate playing GAME_STATE navigates once
test('58. duplicate playing GAME_STATE navigates once', async () => {
  let socket = null;
  let transitions = 0;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://example.com/rooms/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  let prevPlaying = false;
  client.subscribe((s) => {
    const isPlaying = Boolean(s.playingState);
    if (isPlaying && !prevPlaying) {
      transitions++;
    }
    prevPlaying = isPlaying;
  });

  await client.connect('ABCD23');
  const gameStateMsg = {
    type: 'LUDO_GAME_STATE',
    roomId: 'ABCD23',
    revision: 10,
    hostUserId: 'user_1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_1: true },
    state: createValidEngineState(),
  };

  // Action event arrives first
  socket.receiveMessage({ type: 'LUDO_DICE_ROLLED', roomId: 'ABCD23', revision: 10, color: 'red', roll: 6, legalMoves: [0] });
  // Snapshot arrives
  socket.receiveMessage(gameStateMsg);
  // Duplicate snapshot arrives
  socket.receiveMessage(gameStateMsg);

  assert.equal(transitions, 1);
  client.destroy();
});

// 59. malformed engine state rejected
test('59. malformed engine state rejected', () => {
  assert.equal(validateEngineStateEnvelope(null), false);
  assert.equal(validateEngineStateEnvelope({ status: 'unknown' }), false);
  assert.equal(validateEngineStateEnvelope({ status: 'playing' }), false); // missing legalMoves, tokens, rankings
  assert.equal(validateEngineStateEnvelope(createValidEngineState({ turnPhase: 'invalid' })), false);
  assert.equal(validateEngineStateEnvelope(createValidEngineState({ currentTurn: 'purple' })), false);
  assert.equal(validateEngineStateEnvelope(createValidEngineState({ tokens: null })), false);
  assert.equal(validateEngineStateEnvelope(createValidEngineState()), true);
});

// 60. ticket still absent from URL/routes/state/loggable data
test('60. ticket still absent from URL/routes/state/loggable data', async () => {
  const secret = 'super-secret-identity-claim-12345';
  let capturedUrl = '';
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: secret }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      capturedUrl = url;
      return new MockWebSocket(url, p, o);
    },
  });

  await client.connect('ABCD23');
  const serializedState = JSON.stringify(client.getState());
  assert.equal(capturedUrl.includes(secret), false);
  assert.equal(serializedState.includes(secret), false);
  assert.equal(client.getState().roomId.includes(secret), false);

  client.destroy();
});

// ==========================================
// Phase 4D: Same-Room Rematch Tests
// ==========================================

// 61. (Gate 49) host normal finish sees Play Again
test('61. (Gate 49) host normal finish sees Play Again', () => {
  const hostId = 'user_host_1';
  const finishedState = {
    engine: { status: 'finished', rankings: ['red', 'yellow'] },
    finishReason: 'normal',
  };
  assert.equal(canHostRematch(finishedState, hostId, hostId), true);
});

// 62. (Gate 50) non-host normal finish does not see Play Again
test('62. (Gate 50) non-host normal finish does not see Play Again', () => {
  const hostId = 'user_host_1';
  const guestId = 'user_guest_2';
  const finishedState = {
    engine: { status: 'finished', rankings: ['red', 'yellow'] },
    finishReason: 'normal',
  };
  assert.equal(canHostRematch(finishedState, hostId, guestId), false);
});

// 63. (Gate 51) all-humans-abandoned shows no Play Again
test('63. (Gate 51) all-humans-abandoned shows no Play Again', () => {
  const hostId = 'user_host_1';
  const finishedState = {
    engine: { status: 'finished', rankings: ['yellow'] },
    finishReason: 'all-humans-abandoned',
  };
  assert.equal(canHostRematch(finishedState, hostId, hostId), false);
});

// 64. canHostRematch returns false during playing phase or null state
test('64. canHostRematch returns false during playing phase or null state', () => {
  const hostId = 'user_host_1';
  assert.equal(canHostRematch(null, hostId, hostId), false);
  const playingState = {
    engine: { status: 'playing' },
    finishReason: null,
  };
  assert.equal(canHostRematch(playingState, hostId, hostId), false);
});

// 65. (Gate 52) rapid Play Again sends one command and sets pendingCommand
test('65. (Gate 52) rapid Play Again sends one command and sets pendingCommand', async () => {
  let socketRef = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socketRef = new MockWebSocket(url, p, o);
      return socketRef;
    },
  });

  await client.connect('ABCD23');
  assert.equal(client.getState().pendingCommand, null);

  // First tap
  const firstSent = client.returnToLobby();
  assert.equal(firstSent, true);
  assert.equal(client.getState().pendingCommand, 'LUDO_RETURN_TO_LOBBY');

  // Second rapid tap while pending
  const secondSent = client.returnToLobby();
  assert.equal(secondSent, false); // Blocked

  // Only one message sent over socket
  assert.equal(socketRef.sentMessages.length, 1);
  const sentMsg = JSON.parse(socketRef.sentMessages[0]);
  assert.equal(sentMsg.type, 'LUDO_RETURN_TO_LOBBY');

  client.destroy();
});

// 66. (Gate 53 & 55 & 56) lobby snapshot resolves pending rematch, clears playingState, and clears actionQueue
test('66. (Gate 53 & 55 & 56) lobby snapshot resolves pending rematch, clears playingState, and clears actionQueue', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');

  // Set up mock playing state and queued action
  client.returnToLobby();
  assert.equal(client.getState().pendingCommand, 'LUDO_RETURN_TO_LOBBY');

  // Authoritative LUDO_LOBBY_STATE arrives from server
  const freshLobby = {
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 25,
    hostUserId: 'user_host_1',
    activeSeatCount: 2,
    roomGeneration: 2,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_host_1', displayName: 'Host', botDifficulty: null, ready: false },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_host_1: true },
  };

  socket.receiveMessage(freshLobby);

  const state = client.getState();
  assert.equal(state.pendingCommand, null);
  assert.equal(state.playingState, null);
  assert.equal(state.actionQueue.length, 0);
  assert.equal(state.lobbyState?.roomGeneration, 2);
  assert.equal(state.revision, 25);

  client.destroy();
});

// 67. (Gate 54) rematch error resolves pendingCommand
test('67. (Gate 54) rematch error resolves pendingCommand', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  client.returnToLobby();
  assert.equal(client.getState().pendingCommand, 'LUDO_RETURN_TO_LOBBY');

  // Server responds with structured error
  socket.receiveMessage({
    type: 'LUDO_ERROR',
    code: 'NOT_HOST',
    message: 'Only the room host can return to lobby.',
  });

  assert.equal(client.getState().pendingCommand, null);
  assert.equal(client.getState().lastError?.code, 'NOT_HOST');

  client.destroy();
});

// 68. (Gate 57) stale old gameplay action ignored after lobby reset
test('68. (Gate 57) stale old gameplay action ignored after lobby reset', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');

  // Fresh lobby arrives at revision 30
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 30,
    hostUserId: 'user_host_1',
    activeSeatCount: 2,
    roomGeneration: 2,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_host_1', displayName: 'Host', botDifficulty: null, ready: false },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'open', userId: null, displayName: null, botDifficulty: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_host_1: true },
  });

  // Stale gameplay action from previous match arrives with revision 29
  socket.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'ABCD23',
    revision: 29,
    color: 'red',
    roll: 6,
    legalMoves: [0],
  });

  // Should NOT be queued into actionQueue
  assert.equal(client.getState().actionQueue.length, 0);
  assert.equal(client.getState().playingState, null);

  client.destroy();
});

// 69. (Gate 58 & 59) same client and same socket instance retained across reset
test('69. (Gate 58 & 59) same client and same socket instance retained across reset', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  const initialSocket = socket;

  // Simulate lobby -> game -> finished -> lobby cycle
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 1,
    hostUserId: 'user_host_1',
    activeSeatCount: 2,
    roomGeneration: 1,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_host_1', displayName: 'Host', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_host_1: true },
  });

  // Rematch to lobby
  client.returnToLobby();
  socket.receiveMessage({
    type: 'LUDO_LOBBY_STATE',
    roomId: 'ABCD23',
    revision: 50,
    hostUserId: 'user_host_1',
    activeSeatCount: 2,
    roomGeneration: 2,
    seats: {
      red: { color: 'red', status: 'human', userId: 'user_host_1', displayName: 'Host', botDifficulty: null, ready: false },
      green: { color: 'green', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      yellow: { color: 'yellow', status: 'bot', userId: null, displayName: 'Yellow Bot', botDifficulty: 'normal', ready: true },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { user_host_1: true },
  });

  // Socket remains unchanged
  assert.strictEqual(socket, initialSocket);
  assert.equal(socket.readyState, MockWebSocket.OPEN);

  client.destroy();
});

// 70. socket closure clears pendingCommand
test('70. socket closure clears pendingCommand', async () => {
  let socket = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'mock-ticket' }),
    wsUrlResolver: (id) => `wss://games.worker.dev/room/${id}/ws`,
    socketFactory: (url, p, o) => {
      socket = new MockWebSocket(url, p, o);
      return socket;
    },
  });

  await client.connect('ABCD23');
  client.returnToLobby();
  assert.equal(client.getState().pendingCommand, 'LUDO_RETURN_TO_LOBBY');

  socket.close();
  assert.equal(client.getState().pendingCommand, null);

  client.destroy();
});

// 71. mapLudoErrorCodeToMessage maps Phase 4D rematch and stale invitation codes
test('71. mapLudoErrorCodeToMessage maps Phase 4D rematch and stale invitation codes', () => {
  assert.equal(mapLudoErrorCodeToMessage('INVITATION_STALE'), 'This invitation belongs to an earlier match.');
  assert.equal(mapLudoErrorCodeToMessage('NOT_HOST'), 'Only the room host can start another match.');
  assert.equal(mapLudoErrorCodeToMessage('INVALID_PHASE'), "This match can't be reset right now.");
  assert.equal(mapLudoErrorCodeToMessage('STORAGE_ERROR'), "Couldn't prepare another match. Try again.");
});
