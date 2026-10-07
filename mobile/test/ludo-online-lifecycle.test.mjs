import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLudoServerEvent,
  VALID_CONTROL_MODES,
  VALID_PRESENCE_STATUSES,
} from '../services/ludo-online/protocol.ts';

import {
  formatReconnectCountdown,
  getReconnectRemainingMs,
  getSeatControlMode,
  getSeatPresence,
  isSeatHumanControlled,
  isCurrentUserSpectator,
  getOnlineResultRankings,
  getLifecyclePlayerLabel,
  detectLifecycleTransitions,
  getOnlineLeaveMode,
} from '../services/ludo-online/lifecycle.ts';

import {
  canOnlineHumanRoll,
  getOnlineSelectableTokens,
  formatOnlineTurnStatus,
  createPresentationStateFromEngine,
  projectDiceRolled,
  resolveOnlineMoveHaptic,
} from '../services/ludo-online/presentation.ts';

import { mapLudoErrorCodeToMessage } from '../services/ludo-online/state.ts';
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

function createMockLobby() {
  return {
    gameType: 'ludo',
    roomId: 'TEST99',
    status: 'lobby',
    hostUserId: 'u1',
    activeSeatCount: 4,
    revision: 1,
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Player 1', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Player 2', botDifficulty: null, ready: true },
      yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
  };
}

function createValidEngineState(overrides = {}) {
  return {
    gameType: 'ludo',
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

function createBaseGameStateEvent(overrides = {}) {
  return {
    type: 'LUDO_GAME_STATE',
    roomId: 'TEST99',
    revision: 2,
    hostUserId: 'u1',
    state: createValidEngineState(),
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', botDifficulty: null, ready: true },
      green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', botDifficulty: null, ready: true },
      yellow: { color: 'yellow', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
      blue: { color: 'blue', status: 'closed', userId: null, displayName: null, botDifficulty: null, ready: false },
    },
    presence: { u1: true, u2: true },
    protocolVersion: 1,
    ...overrides,
  };
}

// ==================================================
// 38. TESTS — PROTOCOL
// ==================================================

test('38.1 Protocol - parses controlMode human', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.controlMode = 'human';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.controlMode, 'human');
});

test('38.2 Protocol - parses controlMode bot', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.green.status = 'bot';
  raw.seats.green.controlMode = 'bot';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.green.controlMode, 'bot');
});

test('38.3 Protocol - parses takeover-bot', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.controlMode = 'takeover-bot';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.controlMode, 'takeover-bot');
});

test('38.4 Protocol - parses presence online', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.presence = 'online';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.presence, 'online');
});

test('38.5 Protocol - parses reconnecting', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.presence = 'reconnecting';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.presence, 'reconnecting');
});

test('38.6 Protocol - parses abandoned', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.presence = 'abandoned';
  raw.seats.red.controlMode = 'takeover-bot';
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.presence, 'abandoned');
});

test('38.7 Protocol - parses disconnectDeadline', () => {
  const deadline = Date.now() + 90000;
  const raw = createBaseGameStateEvent();
  raw.seats.red.presence = 'reconnecting';
  raw.seats.red.disconnectDeadline = deadline;
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.disconnectDeadline, deadline);
});

test('38.8 Protocol - rejects malformed negative deadline', () => {
  const raw = createBaseGameStateEvent();
  raw.seats.red.disconnectDeadline = -500;
  const parsed = parseLudoServerEvent(raw);
  assert.equal(parsed, null);
});

test('38.9 Protocol - parses abandonedAt', () => {
  const abandonedAt = Date.now() - 1000;
  const raw = createBaseGameStateEvent();
  raw.seats.red.abandonedAt = abandonedAt;
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.abandonedAt, abandonedAt);
});

test('38.10 Protocol - parses finishReason', () => {
  const raw = createBaseGameStateEvent({ finishReason: 'all-humans-abandoned' });
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.finishReason, 'all-humans-abandoned');

  const rawNormal = createBaseGameStateEvent({ finishReason: 'normal' });
  const parsedNormal = parseLudoServerEvent(rawNormal);
  assert.ok(parsedNormal);
  assert.equal(parsedNormal.finishReason, 'normal');

  const rawInvalid = createBaseGameStateEvent({ finishReason: 'rage-quit' });
  assert.equal(parseLudoServerEvent(rawInvalid), null);
});

test('38.11 Protocol - parses displayRankings', () => {
  const raw = createBaseGameStateEvent({ displayRankings: ['green', 'red'] });
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed.displayRankings, ['green', 'red']);
});

test('38.12 Protocol - rejects duplicate displayRankings colors', () => {
  const raw = createBaseGameStateEvent({ displayRankings: ['green', 'green'] });
  const parsed = parseLudoServerEvent(raw);
  assert.equal(parsed, null);
});

test('38.13 Protocol - old payload without lifecycle fields still parses', () => {
  const raw = createBaseGameStateEvent();
  // Ensure no Phase 4C fields exist
  delete raw.seats.red.controlMode;
  delete raw.seats.red.presence;
  delete raw.seats.red.disconnectDeadline;
  delete raw.seats.red.abandonedAt;
  delete raw.finishReason;
  delete raw.displayRankings;

  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.seats.red.controlMode, undefined);
  assert.equal(parsed.seats.red.presence, undefined);
  assert.equal(parsed.seats.red.disconnectDeadline, undefined);
  assert.equal(parsed.finishReason, undefined);
  assert.equal(parsed.displayRankings, undefined);
});

// ==================================================
// 39. TESTS — COUNTDOWN
// ==================================================

test('39.14 Countdown - null deadline returns no countdown', () => {
  assert.equal(formatReconnectCountdown(null, Date.now()), null);
  assert.equal(formatReconnectCountdown(undefined, Date.now()), null);
});

test('39.15 Countdown - 90 seconds -> 1:30', () => {
  const now = 1000000;
  const deadline = now + 90000;
  assert.equal(formatReconnectCountdown(deadline, now), '1:30');
});

test('39.16 Countdown - 89 seconds -> 1:29', () => {
  const now = 1000000;
  const deadline = now + 89000;
  assert.equal(formatReconnectCountdown(deadline, now), '1:29');
});

test('39.17 Countdown - 9 seconds -> 0:09', () => {
  const now = 1000000;
  const deadline = now + 9000;
  assert.equal(formatReconnectCountdown(deadline, now), '0:09');
});

test('39.18 Countdown - expired -> 0:00', () => {
  const now = 1000000;
  const deadline = now;
  assert.equal(formatReconnectCountdown(deadline, now), '0:00');
});

test('39.19 Countdown - never negative', () => {
  const now = 1000000;
  const deadline = now - 15000; // 15 seconds past expiry
  assert.equal(formatReconnectCountdown(deadline, now), '0:00');
  assert.equal(getReconnectRemainingMs(deadline, now), 0);
});

test('39.20 Countdown - multiple reconnecting players format independently', () => {
  const now = 1000000;
  const deadlineRed = now + 42000; // 42s
  const deadlineYellow = now + 70000; // 1m10s

  assert.equal(formatReconnectCountdown(deadlineRed, now), '0:42');
  assert.equal(formatReconnectCountdown(deadlineYellow, now), '1:10');
});

// ==================================================
// 40. TESTS — CONTROL AUTHORITY
// ==================================================

test('40.21 Control Authority - online human own turn can roll', () => {
  const canRoll = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'online',
  });
  assert.equal(canRoll, true);
});

test('40.22 Control Authority - reconnecting human cannot roll', () => {
  const canRoll = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'reconnecting',
  });
  assert.equal(canRoll, false);
});

test('40.23 Control Authority - abandoned takeover cannot roll', () => {
  const canRoll = canOnlineHumanRoll({
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
    myControlMode: 'takeover-bot',
    myPresence: 'abandoned',
  });
  assert.equal(canRoll, false);
});

test('40.24 Control Authority - abandoned takeover tokens not selectable', () => {
  const selectable = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [0, 1],
    pendingCommand: null,
    mySeatStatus: 'human',
    myControlMode: 'takeover-bot',
    myPresence: 'abandoned',
  });
  assert.deepEqual(selectable, []);
});

test('40.25 Control Authority - spectator cannot move', () => {
  const seats = {
    red: { color: 'red', status: 'human', userId: 'me', controlMode: 'takeover-bot', presence: 'abandoned' },
  };
  const isSpectator = isCurrentUserSpectator(seats, 'me');
  assert.equal(isSpectator, true);

  const selectable = getOnlineSelectableTokens({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'move',
    myColor: 'red',
    legalMoves: [0],
    pendingCommand: null,
    mySeatStatus: 'human',
    myControlMode: 'takeover-bot',
    myPresence: 'abandoned',
  });
  assert.deepEqual(selectable, []);
});

test('40.26 Control Authority - configured bot remains non-human-controlled', () => {
  const seat = { color: 'green', status: 'bot', botDifficulty: 'normal' };
  assert.equal(getSeatControlMode(seat), 'bot');
  assert.equal(isSeatHumanControlled(seat), false);

  const canRoll = canOnlineHumanRoll({
    connectionStatus: 'connected',
    isResyncing: false,
    isPresentationBusy: false,
    actionQueueLength: 0,
    gameStatus: 'playing',
    currentTurn: 'green',
    turnPhase: 'roll',
    myColor: 'green',
    mySeatStatus: 'bot',
    pendingCommand: null,
    myControlMode: 'bot',
    myPresence: 'online',
  });
  assert.equal(canRoll, false);
});

test('40.27 Control Authority - reconnect online snapshot restores human controls', () => {
  // 1. While reconnecting: blocked
  const canRollReconnecting = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'reconnecting',
  });
  assert.equal(canRollReconnecting, false);

  // 2. Snapshot restores online: permitted
  const canRollRestored = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'online',
  });
  assert.equal(canRollRestored, true);
});

test('40.28 Control Authority - old payload human defaults safely', () => {
  const seat = { color: 'red', status: 'human', displayName: 'Alice' };
  assert.equal(getSeatControlMode(seat), 'human');
  assert.equal(getSeatPresence(seat), 'online');
  assert.equal(isSeatHumanControlled(seat), true);

  const canRoll = canOnlineHumanRoll({
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
    // no myControlMode or myPresence passed
  });
  assert.equal(canRoll, true);
});

// ==================================================
// 41. TESTS — LIFECYCLE TRANSITIONS
// ==================================================

test('41.29 Lifecycle Transitions - online -> reconnecting detected once', () => {
  const prevSeats = {
    red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', presence: 'online', controlMode: 'human' },
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'online', controlMode: 'human' },
  };
  const nextSeats = {
    red: { color: 'red', status: 'human', userId: 'u1', displayName: 'Alice', presence: 'online', controlMode: 'human' },
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'reconnecting', controlMode: 'human' },
  };

  const transitions = detectLifecycleTransitions(prevSeats, nextSeats, 'u1');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].color, 'green');
  assert.equal(transitions[0].type, 'reconnecting');
  assert.match(transitions[0].message, /Bob disconnected/);
});

test('41.30 Lifecycle Transitions - reconnecting -> online detected once', () => {
  const prevSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'reconnecting', controlMode: 'human' },
  };
  const nextSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'online', controlMode: 'human' },
  };

  const transitions = detectLifecycleTransitions(prevSeats, nextSeats, 'u1');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].color, 'green');
  assert.equal(transitions[0].type, 'reconnected');
  assert.equal(transitions[0].message, 'Bob reconnected');
});

test('41.31 Lifecycle Transitions - reconnecting -> abandoned detected once', () => {
  const prevSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'reconnecting', controlMode: 'human' },
  };
  const nextSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'abandoned', controlMode: 'takeover-bot' },
  };

  const transitions = detectLifecycleTransitions(prevSeats, nextSeats, 'u1');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].color, 'green');
  assert.equal(transitions[0].type, 'abandoned');
  assert.equal(transitions[0].message, 'Bob left — bot takeover');
});

test('41.32 Lifecycle Transitions - duplicate snapshot produces no duplicate transition toast', () => {
  const seats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'reconnecting', controlMode: 'human' },
  };

  const transitions = detectLifecycleTransitions(seats, seats, 'u1');
  assert.equal(transitions.length, 0);
});

test('41.33 Lifecycle Transitions - reconnect/remount does not replay abandonment toast', () => {
  // If component mounts and compares same state or null previous state:
  const nextSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'abandoned', controlMode: 'takeover-bot' },
  };
  // null prev indicates fresh mount
  assert.deepEqual(detectLifecycleTransitions(null, nextSeats, 'u1'), []);
  // identical previous state indicates re-render
  assert.deepEqual(detectLifecycleTransitions(nextSeats, nextSeats, 'u1'), []);
});

test('41.34 Lifecycle Transitions - already-abandoned restored snapshot produces no fresh transition', () => {
  const prevSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'abandoned', controlMode: 'takeover-bot' },
  };
  const nextSeats = {
    green: { color: 'green', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'abandoned', controlMode: 'takeover-bot' },
  };

  const transitions = detectLifecycleTransitions(prevSeats, nextSeats, 'u1');
  assert.equal(transitions.length, 0);
});

test('41.35 Lifecycle Transitions - ranked disconnect with no deadline shows no countdown', () => {
  const seat = {
    color: 'red',
    status: 'human',
    displayName: 'Winner',
    presence: 'reconnecting',
    disconnectDeadline: null,
  };
  const countdown = formatReconnectCountdown(seat.disconnectDeadline, Date.now());
  assert.equal(countdown, null);

  const label = getLifecyclePlayerLabel(seat, { countdownText: countdown });
  assert.equal(label.countdown, null);
  assert.equal(label.subtitle, 'Reconnecting…');
});

// ==================================================
// 42. TESTS — RESULTS
// ==================================================

test('42.36 Results - displayRankings preferred over engine rankings', () => {
  const displayRankings = ['blue', 'red', 'green'];
  const engineRankings = ['red', 'green', 'blue'];
  const resolved = getOnlineResultRankings(displayRankings, engineRankings);
  assert.deepEqual(resolved, ['blue', 'red', 'green']);
});

test('42.37 Results - fallback to engine rankings when displayRankings absent', () => {
  const engineRankings = ['red', 'green', 'blue'];
  const resolved = getOnlineResultRankings(null, engineRankings);
  assert.deepEqual(resolved, ['red', 'green', 'blue']);
});

test('42.38 Results - abandoned player keeps original human name', () => {
  const seat = {
    color: 'red',
    status: 'human',
    displayName: 'Shiva',
    controlMode: 'takeover-bot',
    presence: 'abandoned',
  };
  const label = getLifecyclePlayerLabel(seat);
  assert.equal(label.title, 'Shiva');
  assert.equal(label.subtitle, 'Bot takeover');
  assert.equal(label.badge, 'takeover');
});

test('42.39 Results - configured bot displayed as bot', () => {
  const seat = {
    color: 'green',
    status: 'bot',
    displayName: null,
    botDifficulty: 'hard',
  };
  const label = getLifecyclePlayerLabel(seat);
  assert.equal(label.title, 'Green Bot');
  assert.equal(label.subtitle, 'Hard');
  assert.equal(label.badge, 'bot');
});

test('42.40 Results - takeover player labelled correctly', () => {
  const seat = {
    color: 'yellow',
    status: 'human',
    displayName: 'Kiran',
    controlMode: 'takeover-bot',
    presence: 'abandoned',
  };
  const label = getLifecyclePlayerLabel(seat);
  assert.equal(label.badge, 'takeover');
  assert.equal(label.subtitle, 'Bot takeover');
  assert.notEqual(label.title, 'Bot');
  assert.equal(label.title, 'Kiran');
});

test('42.41 Results - all-human abandonment uses MATCH ENDED copy', () => {
  const status = formatOnlineTurnStatus(
    null,
    null,
    false,
    '',
    false,
    'connected',
    false,
    true, // isFinished
    { finishReason: 'all-humans-abandoned' }
  );
  assert.equal(status.title, 'Match Ended');
  assert.equal(status.subtitle, 'All human players left the match.');
});

test('42.42 Results - all-human abandonment does not trigger winner celebration', () => {
  // A finished snapshot with finishReason='all-humans-abandoned' has no move event
  const raw = createBaseGameStateEvent({
    finishReason: 'all-humans-abandoned',
    state: createValidEngineState({ status: 'finished', rankings: ['red', 'green'] }),
  });
  const parsed = parseLudoServerEvent(raw);
  assert.ok(parsed);
  assert.equal(parsed.finishReason, 'all-humans-abandoned');
  // Presentation initialized from engine state has showWinnerCelebration = false
  const pres = createPresentationStateFromEngine(parsed.state);
  assert.equal(pres.status, 'finished');
});

test('42.43 Results - normal finished match still uses winner presentation', () => {
  const status = formatOnlineTurnStatus(
    null,
    null,
    false,
    '',
    false,
    'connected',
    false,
    true, // isFinished
    { finishReason: 'normal' }
  );
  assert.equal(status.title, 'Game Finished');
  assert.equal(status.subtitle, 'Match complete');
});

// ==================================================
// 43. TESTS — RECONNECT USER EXPERIENCE
// ==================================================

test('43.44 UX - current user reconnecting blocks controls', () => {
  const canRoll = canOnlineHumanRoll({
    connectionStatus: 'reconnecting',
    isResyncing: false,
    isPresentationBusy: false,
    actionQueueLength: 0,
    gameStatus: 'playing',
    currentTurn: 'red',
    turnPhase: 'roll',
    myColor: 'red',
    mySeatStatus: 'human',
    pendingCommand: null,
  });
  assert.equal(canRoll, false);
});

test('43.45 UX - returning before deadline restores same-seat gameplay', () => {
  // User reconnected before deadline: server sends seat with presence='online', controlMode='human'
  const restoredSeats = {
    red: { color: 'red', status: 'human', userId: 'my-user', presence: 'online', controlMode: 'human', disconnectDeadline: null },
  };
  assert.equal(isCurrentUserSpectator(restoredSeats, 'my-user'), false);
  assert.equal(isSeatHumanControlled(restoredSeats.red), true);
});

test('43.46 UX - returning after abandonment enters spectator mode', () => {
  // User reconnected after deadline: server sends seat with presence='abandoned', controlMode='takeover-bot'
  const abandonedSeats = {
    red: { color: 'red', status: 'human', userId: 'my-user', presence: 'abandoned', controlMode: 'takeover-bot' },
  };
  assert.equal(isCurrentUserSpectator(abandonedSeats, 'my-user'), true);
  assert.equal(isSeatHumanControlled(abandonedSeats.red), false);
});

test('43.47 UX - spectator still receives/animates authoritative board updates', () => {
  // Spectator still projects dice rolled and move results onto presentation state
  const prev = createPresentationStateFromEngine(createValidEngineState());
  const diceEvent = {
    type: 'LUDO_DICE_ROLLED',
    roomId: 'TEST99',
    color: 'red',
    roll: 6,
    consecutiveSixes: 1,
    legalMoves: [0],
    autoPassed: false,
    threeSixesForfeit: false,
    nextTurn: null,
    revision: 3,
    protocolVersion: 1,
  };
  const projected = projectDiceRolled(prev, diceEvent);
  assert.equal(projected.currentRoll, 6);
  assert.equal(projected.turnPhase, 'move');
});

test('43.48 & 49 UX - PLAYER_ABANDONED clears pending command and triggers resync', async () => {
  let createdWs = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => {
      createdWs = new MockWebSocket(url, proto);
      return createdWs;
    },
  });

  await client.connect('TEST99');
  createdWs.onopen();
  createdWs.receiveMessage({
    type: 'CONNECTED',
    roomId: 'TEST99',
    userId: 'u1',
    protocolVersion: 1,
  });

  // Receive PLAYER_ABANDONED error
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_ABANDONED',
    message: 'Player abandoned',
    protocolVersion: 1,
  });

  const state = client.getState();
  assert.ok(state.lastError);
  assert.equal(state.lastError.code, 'PLAYER_ABANDONED');
  assert.equal(
    state.lastError.friendlyMessage,
    'A bot has taken over your seat. You can keep watching this match.'
  );
  // Resync requested
  assert.equal(state.isResyncing, true);
  const lastSent = JSON.parse(createdWs.sentMessages[createdWs.sentMessages.length - 1]);
  assert.equal(lastSent.type, 'LUDO_REQUEST_STATE');
  client.destroy();
});

test('43.50 & 51 UX - PLAYER_OFFLINE clears pending command and triggers resync', async () => {
  let createdWs = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => {
      createdWs = new MockWebSocket(url, proto);
      return createdWs;
    },
  });

  await client.connect('TEST99');
  createdWs.onopen();
  createdWs.receiveMessage({
    type: 'CONNECTED',
    roomId: 'TEST99',
    userId: 'u1',
    protocolVersion: 1,
  });

  // Receive PLAYER_OFFLINE error
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_OFFLINE',
    message: 'Player offline',
    protocolVersion: 1,
  });

  const state = client.getState();
  assert.ok(state.lastError);
  assert.equal(state.lastError.code, 'PLAYER_OFFLINE');
  assert.equal(
    state.lastError.friendlyMessage,
    'Your seat is reconnecting. Please wait for synchronization.'
  );
  // Resync requested
  assert.equal(state.isResyncing, true);
  const lastSent = JSON.parse(createdWs.sentMessages[createdWs.sentMessages.length - 1]);
  assert.equal(lastSent.type, 'LUDO_REQUEST_STATE');
  client.destroy();
});

// ==================================================
// 44. TESTS — MULTIPLE PLAYERS
// ==================================================

test('44.52 Multiple Players - two reconnecting seats with different deadlines', () => {
  const now = 2000000;
  const deadlineRed = now + 15000; // 15s
  const deadlineGreen = now + 85000; // 1m25s

  assert.equal(formatReconnectCountdown(deadlineRed, now), '0:15');
  assert.equal(formatReconnectCountdown(deadlineGreen, now), '1:25');
});

test('44.53 Multiple Players - current-turn reconnect countdown displayed', () => {
  const turnStatus = formatOnlineTurnStatus(
    'red',
    'roll',
    false,
    'Alice',
    false,
    'connected',
    false,
    false,
    {
      isCurrentTurnReconnecting: true,
      reconnectCountdown: '1:12',
    }
  );
  assert.equal(turnStatus.title, 'Alice disconnected');
  assert.equal(turnStatus.subtitle, 'Waiting for reconnection • 1:12');
});

test('44.54 Multiple Players - non-current reconnect appears only in player bar', () => {
  // If current turn is Green (Bob) who is online, and Red (Alice) is reconnecting
  const turnStatus = formatOnlineTurnStatus(
    'green',
    'roll',
    false,
    'Bob',
    false,
    'connected',
    false,
    false,
    {
      isCurrentTurnReconnecting: false,
    }
  );
  assert.equal(turnStatus.title, "Bob's turn");
  assert.equal(turnStatus.subtitle, 'Waiting for Bob');

  // Red's player bar chip still has reconnect countdown
  const redSeat = { color: 'red', status: 'human', displayName: 'Alice', presence: 'reconnecting' };
  const label = getLifecyclePlayerLabel(redSeat, { countdownText: '0:45' });
  assert.equal(label.subtitle, 'Reconnecting • 0:45');
});

test('44.55 Multiple Players - takeover bot current turn uses bot status', () => {
  const turnStatus = formatOnlineTurnStatus(
    'red',
    'roll',
    false,
    'Alice',
    false,
    'connected',
    false,
    false,
    {
      isCurrentTurnTakeoverBot: true,
    }
  );
  assert.equal(turnStatus.title, 'Alice • Bot takeover');
  assert.equal(turnStatus.subtitle, 'Bot is playing for them');
});

test('44.56 Multiple Players - takeover bot action still enters existing action presentation queue', async () => {
  let createdWs = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => {
      createdWs = new MockWebSocket(url, proto);
      return createdWs;
    },
  });

  await client.connect('TEST99');
  createdWs.onopen();
  createdWs.receiveMessage({
    type: 'CONNECTED',
    roomId: 'TEST99',
    userId: 'u1',
    protocolVersion: 1,
  });

  // Initial playing state
  createdWs.receiveMessage(createBaseGameStateEvent({ revision: 1 }));

  // Takeover bot action received
  createdWs.receiveMessage({
    type: 'LUDO_DICE_ROLLED',
    roomId: 'TEST99',
    color: 'red',
    roll: 4,
    consecutiveSixes: 0,
    legalMoves: [1],
    autoPassed: false,
    threeSixesForfeit: false,
    nextTurn: null,
    revision: 2,
    protocolVersion: 1,
  });

  const nextAction = client.peekNextAction();
  assert.ok(nextAction);
  assert.equal(nextAction.type, 'LUDO_DICE_ROLLED');
  assert.equal(nextAction.roll, 4);
  client.destroy();
});

// ==================================================
// 45. TESTS — PHASE 4C2A GATE VALIDATIONS
// ==================================================

test('45.57 Resync - outbound REQUEST_STATE counted exactly once on error', async () => {
  let createdWs = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => {
      createdWs = new MockWebSocket(url, proto);
      return createdWs;
    },
  });

  await client.connect('TEST99');
  createdWs.onopen();
  createdWs.receiveMessage({ type: 'CONNECTED', roomId: 'TEST99', userId: 'u1', protocolVersion: 1 });

  // Clear initial connect messages if any
  createdWs.sentMessages = [];

  // Trigger error
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_ABANDONED',
    message: 'Player abandoned',
    protocolVersion: 1,
  });

  const requestStateMsgs = createdWs.sentMessages
    .map((m) => JSON.parse(m))
    .filter((m) => m.type === 'LUDO_REQUEST_STATE');

  assert.equal(requestStateMsgs.length, 1);
  assert.equal(client.getState().isResyncing, true);
  client.destroy();
});

test('45.58 Resync Dedupe - repeated lifecycle error does not flood server', async () => {
  let createdWs = null;
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => {
      createdWs = new MockWebSocket(url, proto);
      return createdWs;
    },
  });

  await client.connect('TEST99');
  createdWs.onopen();
  createdWs.receiveMessage({ type: 'CONNECTED', roomId: 'TEST99', userId: 'u1', protocolVersion: 1 });
  createdWs.sentMessages = [];

  // First error triggers resync
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_OFFLINE',
    message: 'Player offline 1',
    protocolVersion: 1,
  });
  assert.equal(client.getState().isResyncing, true);

  // Repeated errors arrive before snapshot
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_OFFLINE',
    message: 'Player offline 2',
    protocolVersion: 1,
  });
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_ABANDONED',
    message: 'Player abandoned',
    protocolVersion: 1,
  });

  // Outbound count remains strictly 1
  const requestStateMsgs = createdWs.sentMessages
    .map((m) => JSON.parse(m))
    .filter((m) => m.type === 'LUDO_REQUEST_STATE');
  assert.equal(requestStateMsgs.length, 1);

  // Authoritative snapshot arrives and clears isResyncing
  createdWs.receiveMessage(createBaseGameStateEvent({ revision: 5 }));
  assert.equal(client.getState().isResyncing, false);

  // Now a subsequent independent error can resync again
  createdWs.receiveMessage({
    type: 'ERROR',
    code: 'PLAYER_OFFLINE',
    message: 'Player offline 3',
    protocolVersion: 1,
  });
  const totalRequestStateMsgs = createdWs.sentMessages
    .map((m) => JSON.parse(m))
    .filter((m) => m.type === 'LUDO_REQUEST_STATE');
  assert.equal(totalRequestStateMsgs.length, 2);

  client.destroy();
});

test('45.59 Exit Mode - lobby returns lobby mode and sends leave message', () => {
  const result = getOnlineLeaveMode({ gameStatus: 'lobby' });
  assert.equal(result.mode, 'lobby');
  assert.equal(result.shouldSendLeaveMessage, true);
  assert.match(result.message, /leave this online lobby/);
});

test('45.60 Exit Mode - active human returns active-human mode with 90s reservation', () => {
  const result = getOnlineLeaveMode({
    gameStatus: 'playing',
    myUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', presence: 'online', controlMode: 'human' },
    },
  });
  assert.equal(result.mode, 'active-human');
  assert.equal(result.shouldSendLeaveMessage, true);
  assert.match(result.message, /reserved for 90 seconds/);
});

test('45.61 Exit Mode - spectator returns spectator mode with watching copy and no leave message', () => {
  const result = getOnlineLeaveMode({
    gameStatus: 'playing',
    myUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', presence: 'abandoned', controlMode: 'takeover-bot' },
    },
  });
  assert.equal(result.mode, 'spectator');
  assert.equal(result.shouldSendLeaveMessage, false);
  assert.match(result.message, /currently watching this match/);
  assert.doesNotMatch(result.message, /90 seconds/);
});

test('45.62 Exit Mode - ranked player returns ranked-finished mode with neutral copy', () => {
  const result = getOnlineLeaveMode({
    gameStatus: 'playing',
    myUserId: 'u1',
    seats: {
      red: { color: 'red', status: 'human', userId: 'u1', presence: 'reconnecting', controlMode: 'human', disconnectDeadline: null },
    },
    rankings: ['red'],
  });
  assert.equal(result.mode, 'ranked-finished');
  assert.equal(result.shouldSendLeaveMessage, false);
  assert.match(result.message, /finished your match/);
  assert.doesNotMatch(result.message, /90 seconds/);
});

test('45.63 Exit Mode - finished match returns match-finished mode', () => {
  const result = getOnlineLeaveMode({ gameStatus: 'finished' });
  assert.equal(result.mode, 'match-finished');
  assert.equal(result.shouldSendLeaveMessage, false);
  assert.match(result.message, /ended/);
});

test('45.64 Authority - connected socket but seat reconnecting blocks roll', () => {
  // Socket connected, but authoritative seat is still reconnecting
  const canRollReconnecting = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'reconnecting',
  });
  assert.equal(canRollReconnecting, false);

  // Authoritative snapshot updates presence to online: roll unblocks
  const canRollOnline = canOnlineHumanRoll({
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
    myControlMode: 'human',
    myPresence: 'online',
  });
  assert.equal(canRollOnline, true);
});

test('45.65 Countdown Expiry - 0:00 displays waiting for server and does not infer takeover', () => {
  const seat = {
    color: 'red',
    status: 'human',
    displayName: 'Alice',
    presence: 'reconnecting',
    controlMode: 'human',
    disconnectDeadline: 1000,
  };
  const label = getLifecyclePlayerLabel(seat, { countdownText: '0:00' });
  assert.equal(label.subtitle, 'Waiting for server…');
  assert.equal(label.badge, 'reconnecting');

  const turnStatus = formatOnlineTurnStatus(
    'red',
    'roll',
    false,
    'Alice',
    false,
    'connected',
    false,
    false,
    {
      isCurrentTurnReconnecting: true,
      reconnectCountdown: '0:00',
    }
  );
  assert.equal(turnStatus.title, 'Alice disconnected');
  assert.equal(turnStatus.subtitle, 'Waiting for server…');
});

test('45.66 Deadline Dynamic Update - deadline A to deadline B immediately recomputes', () => {
  const now = 1000000;
  const deadlineA = now + 40000; // 40s
  const deadlineB = now + 80000; // 80s = 1:20

  assert.equal(formatReconnectCountdown(deadlineA, now), '0:40');
  assert.equal(formatReconnectCountdown(deadlineB, now), '1:20');
});

test('45.67 Toast Baseline - generation reconnect does not replay historical abandonment toast', () => {
  // When generation B mounts/connects, detectLifecycleTransitions is called with null prev:
  const genBSeats = {
    red: { color: 'red', status: 'human', userId: 'u2', displayName: 'Bob', presence: 'abandoned', controlMode: 'takeover-bot' },
  };
  const initialTransitions = detectLifecycleTransitions(null, genBSeats, 'u1');
  assert.deepEqual(initialTransitions, []);
});

test('45.68 Haptics - takeover bot actions do not trigger local routine action haptics', () => {
  const moveEvent = {
    type: 'LUDO_MOVE_RESULT',
    roomId: 'TEST99',
    player: 'red',
    tokenId: 0,
    fromPos: 5,
    toPos: 9,
    diceValue: 4,
    capturedTokens: [],
    reachedFinish: false,
    playerRanked: false,
    gameFinished: false,
    nextTurn: 'green',
    revision: 10,
    protocolVersion: 1,
  };

  // Local human action triggers step haptic
  assert.equal(resolveOnlineMoveHaptic(moveEvent, true), 'step');

  // Remote action / takeover bot action (isMyAction=false) is completely silent for step
  assert.equal(resolveOnlineMoveHaptic(moveEvent, false), null);

  // Capture event: local triggers capture, bot/spectator is silent
  const captureEvent = { ...moveEvent, capturedTokens: [{ color: 'green', tokenIndex: 0 }] };
  assert.equal(resolveOnlineMoveHaptic(captureEvent, true), 'capture');
  assert.equal(resolveOnlineMoveHaptic(captureEvent, false), null);
});

test('45.69 Request State Failure Safety - socket closed does not throw', () => {
  const client = new OnlineLudoClient({
    ticketProvider: async () => ({ ticket: 'test-ticket' }),
    wsUrlResolver: () => 'wss://test.local',
    socketFactory: (url, proto) => new MockWebSocket(url, proto),
  });

  // Calling requestState when socket is null or not open must be completely safe
  assert.doesNotThrow(() => {
    client.requestState();
  });
  client.destroy();
});
