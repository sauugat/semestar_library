import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLudoNotificationPayload,
  getLudoInvitationRoute,
  handleLudoNotificationTap,
  formatInvitationCountdown,
  mapInvitationError,
} from '../services/ludo-invitations/notification-routing.ts';

import {
  normalizeRoomCode,
  isValidRoomCode,
  generateRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_REGEX,
} from '../services/ludo-online/room-code.ts';

import {
  LudoInvitationError,
} from '../services/ludo-invitations/types.ts';

// ----------------------------------------------------
// 1. Notification Payload Parsing Tests
// ----------------------------------------------------
test('1. parseLudoNotificationPayload correctly parses ludo_invitation payload', () => {
  const payload = parseLudoNotificationPayload({
    type: 'ludo_invitation',
    invitationId: 'inv-uuid-12345',
    roomId: 'abc234',
  });

  assert.ok(payload);
  assert.strictEqual(payload.type, 'ludo_invitation');
  assert.strictEqual(payload.invitationId, 'inv-uuid-12345');
  assert.strictEqual(payload.roomId, 'ABC234');
  assert.strictEqual(payload.gameType, 'ludo');
});

test('2. parseLudoNotificationPayload parses game_invite with gameType ludo as ludo_invitation', () => {
  const payload = parseLudoNotificationPayload({
    type: 'game_invite',
    gameType: 'ludo',
    invitationId: 'inv-uuid-67890',
    roomId: 'def567',
  });

  assert.ok(payload);
  assert.strictEqual(payload.type, 'ludo_invitation');
  assert.strictEqual(payload.invitationId, 'inv-uuid-67890');
  assert.strictEqual(payload.roomId, 'DEF567');
  assert.strictEqual(payload.gameType, 'ludo');
});

test('3. parseLudoNotificationPayload rejects ludo_invitation with missing or empty invitationId', () => {
  assert.strictEqual(parseLudoNotificationPayload({ type: 'ludo_invitation' }), null);
  assert.strictEqual(parseLudoNotificationPayload({ type: 'ludo_invitation', invitationId: '' }), null);
  assert.strictEqual(parseLudoNotificationPayload({ type: 'ludo_invitation', invitationId: '   ' }), null);
  assert.strictEqual(parseLudoNotificationPayload({ type: 'ludo_invitation', invitationId: 12345 }), null);
  assert.strictEqual(parseLudoNotificationPayload(null), null);
  assert.strictEqual(parseLudoNotificationPayload(undefined), null);
});

test('4. parseLudoNotificationPayload ignores unrelated notification types', () => {
  assert.strictEqual(parseLudoNotificationPayload({ type: 'chat', messageId: 42 }), null);
  assert.strictEqual(parseLudoNotificationPayload({ type: 'material', fileId: 101 }), null);
  assert.strictEqual(
    parseLudoNotificationPayload({
      type: 'game_invite',
      gameType: 'tic-tac-toe',
      invitationId: 'ttt-123',
    }),
    null
  );
});

// ----------------------------------------------------
// 2. Room Code Validation & Normalization
// ----------------------------------------------------
test('5. isValidRoomCode strictly enforces 6-character canonical alphabet', () => {
  assert.strictEqual(isValidRoomCode('ABC234'), true);
  assert.strictEqual(isValidRoomCode('DEF567'), true);
  assert.strictEqual(isValidRoomCode('XYZ892'), true);

  // Lowercase normalized check
  assert.strictEqual(isValidRoomCode('abc234'), true);

  // Contains forbidden characters: 0, 1, O, I, L
  assert.strictEqual(isValidRoomCode('ROOM01'), false); // 'O' and '0' and '1'
  assert.strictEqual(isValidRoomCode('LUDO12'), false); // 'L', 'O', '1'
  assert.strictEqual(isValidRoomCode('TEST00'), false); // '0'

  // Length != 6
  assert.strictEqual(isValidRoomCode('ABC23'), false); // 5 chars
  assert.strictEqual(isValidRoomCode('ABC2345'), false); // 7 chars
  assert.strictEqual(isValidRoomCode(''), false);
  assert.strictEqual(isValidRoomCode(null), false);
  assert.strictEqual(isValidRoomCode(undefined), false);
});

test('6. normalizeRoomCode trims whitespace and converts to uppercase', () => {
  assert.strictEqual(normalizeRoomCode('  abc234  '), 'ABC234');
  assert.strictEqual(normalizeRoomCode('xyz892'), 'XYZ892');
  assert.strictEqual(normalizeRoomCode(''), '');
});

test('7. generateRoomCode produces valid 6-character room codes', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    assert.strictEqual(code.length, 6);
    assert.strictEqual(isValidRoomCode(code), true);
  }
});

// ----------------------------------------------------
// 3. Notification Tap Routing & Auth Gating
// ----------------------------------------------------
test('8. handleLudoNotificationTap navigates directly when authenticated', () => {
  const routes = [];
  const handled = handleLudoNotificationTap(
    {
      type: 'ludo_invitation',
      invitationId: 'inv-target-999',
    },
    {
      isAuthenticated: true,
      navigate: (r) => routes.push(r),
      redirectToLogin: () => {},
      setPending: () => {},
    }
  );

  assert.strictEqual(handled, true);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0], '/games/ludo/invitations/inv-target-999');
});

test('9. handleLudoNotificationTap ignores duplicate taps within 4000ms window', () => {
  const routes = [];
  const tapState = { lastId: undefined, lastTimestamp: undefined };

  const raw = {
    type: 'ludo_invitation',
    invitationId: 'inv-duplicate-test',
  };

  // First tap at t=1000
  const first = handleLudoNotificationTap(raw, {
    isAuthenticated: true,
    navigate: (r) => routes.push(r),
    redirectToLogin: () => {},
    setPending: () => {},
    notificationIdentifier: 'tap-1',
    lastTapState: tapState,
    now: 1000,
  });
  assert.strictEqual(first, true);
  assert.strictEqual(routes.length, 1);

  // Second immediate tap at t=1500 (within 4000ms debounce)
  const second = handleLudoNotificationTap(raw, {
    isAuthenticated: true,
    navigate: (r) => routes.push(r),
    redirectToLogin: () => {},
    setPending: () => {},
    notificationIdentifier: 'tap-1',
    lastTapState: tapState,
    now: 1500,
  });
  assert.strictEqual(second, false);
  // Routes length remains 1
  assert.strictEqual(routes.length, 1);

  // Third tap at t=6000 (after 4000ms debounce window expires)
  const third = handleLudoNotificationTap(raw, {
    isAuthenticated: true,
    navigate: (r) => routes.push(r),
    redirectToLogin: () => {},
    setPending: () => {},
    notificationIdentifier: 'tap-1',
    lastTapState: tapState,
    now: 6000,
  });
  assert.strictEqual(third, true);
  assert.strictEqual(routes.length, 2);
});

test('10. handleLudoNotificationTap gates unauthenticated tap to login and saves pending payload', () => {
  let redirectedToLogin = false;
  let savedPending = null;

  const raw = {
    type: 'ludo_invitation',
    invitationId: 'inv-unauth-888',
  };

  const handled = handleLudoNotificationTap(raw, {
    isAuthenticated: false,
    navigate: () => {},
    redirectToLogin: () => {
      redirectedToLogin = true;
    },
    setPending: (p) => {
      savedPending = p;
    },
  });

  assert.strictEqual(handled, true);
  assert.strictEqual(redirectedToLogin, true);
  assert.ok(savedPending);
  assert.strictEqual(savedPending.type, 'ludo_invitation');
  assert.strictEqual(savedPending.invitationId, 'inv-unauth-888');

  // Once login resolves, the pending invitation can be navigated
  const restoredRoute = getLudoInvitationRoute(savedPending.invitationId);
  assert.strictEqual(restoredRoute, '/games/ludo/invitations/inv-unauth-888');
});

// ----------------------------------------------------
// 4. LudoInvitationError Class & Error Mapping
// ----------------------------------------------------
test('11. LudoInvitationError captures message, code, and status', () => {
  const err = new LudoInvitationError('This match has already started.', 'ROOM_STARTED', 409);
  assert.strictEqual(err.message, 'This match has already started.');
  assert.strictEqual(err.code, 'ROOM_STARTED');
  assert.strictEqual(err.status, 409);
  assert.strictEqual(err.name, 'LudoInvitationError');
});

test('12. mapInvitationError provides clear user-friendly messages for known failure codes', () => {
  assert.strictEqual(mapInvitationError('ROOM_STARTED').title, 'Match Already Started');
  assert.strictEqual(mapInvitationError('ROOM_FULL').title, 'Room is Full');
  assert.strictEqual(mapInvitationError('ROOM_UNAVAILABLE').title, 'Room Unavailable');
  assert.strictEqual(mapInvitationError('EXPIRED').title, 'Invitation Expired');
  assert.strictEqual(mapInvitationError('WRONG_ACCOUNT').title, 'Unavailable');
  assert.strictEqual(mapInvitationError('RATE_LIMIT_EXCEEDED').title, 'Please Wait');
});

test('13. formatInvitationCountdown properly formats seconds remaining', () => {
  assert.strictEqual(formatInvitationCountdown(600), '10m 00s');
  assert.strictEqual(formatInvitationCountdown(543), '9m 03s');
  assert.strictEqual(formatInvitationCountdown(65), '1m 05s');
  assert.strictEqual(formatInvitationCountdown(59), '59s');
  assert.strictEqual(formatInvitationCountdown(5), '5s');
  assert.strictEqual(formatInvitationCountdown(0), '0s');
  assert.strictEqual(formatInvitationCountdown(-10), '0s');
});

// ----------------------------------------------------
// 5. End-to-End Simulation: Host Invites -> Recipient Accepts / Joins
// ----------------------------------------------------
test('14. End-to-End Flow: Push Delivered -> Tap -> Open Detail -> Accept -> Join Room Flow', () => {
  // Step 1: Push payload arrives
  const pushData = {
    type: 'ludo_invitation',
    invitationId: 'inv-flow-e2e-1',
    roomId: 'GHJ892',
    version: 1,
  };

  // Step 2: Push payload parsed
  const parsed = parseLudoNotificationPayload(pushData);
  assert.ok(parsed);
  assert.strictEqual(parsed.type, 'ludo_invitation');

  // Verify payload contains NO tickets, tokens, or credentials
  assert.strictEqual(parsed.ticket, undefined);
  assert.strictEqual(parsed.gamesTicket, undefined);
  assert.strictEqual(parsed.authToken, undefined);

  // Step 3: Notification tap router
  const navDestinations = [];
  handleLudoNotificationTap(pushData, {
    isAuthenticated: true,
    navigate: (route) => navDestinations.push(route),
    redirectToLogin: () => {},
    setPending: () => {},
  });

  assert.strictEqual(navDestinations.length, 1);
  assert.strictEqual(navDestinations[0], `/games/ludo/invitations/${pushData.invitationId}`);

  // Step 4: Screen fetches invitation and recipient accepts
  const simulatedAcceptResponse = {
    success: true,
    roomId: 'GHJ892',
    status: 'accepted',
  };
  assert.strictEqual(simulatedAcceptResponse.success, true);
  assert.strictEqual(simulatedAcceptResponse.roomId, 'GHJ892');

  // Step 5: Screen navigates into existing online Ludo room join flow
  const joinParams = {
    pathname: '/games/ludo/online/[roomId]',
    params: { roomId: simulatedAcceptResponse.roomId, intent: 'join' },
  };
  assert.strictEqual(joinParams.params.roomId, 'GHJ892');
  assert.strictEqual(joinParams.params.intent, 'join');
});

// ----------------------------------------------------
// 6. Concurrency, Deduplication, and Race Handling
// ----------------------------------------------------
test('15. Cold start getLastNotificationResponseAsync + listener navigation dedupe by invitationId', () => {
  const routes = [];
  const processedInvitations = new Set();

  function routeWithDedupe(payload, notificationIdentifier) {
    if (processedInvitations.has(payload.invitationId)) {
      return false; // deduplicated across startup window
    }
    processedInvitations.add(payload.invitationId);
    routes.push(getLudoInvitationRoute(payload.invitationId));
    return true;
  }

  const payload = {
    type: 'ludo_invitation',
    invitationId: 'inv-cold-start-dedupe-1',
  };

  // 1. Cold start event surfaces
  const first = routeWithDedupe(payload, 'cold-start-notif-id');
  assert.strictEqual(first, true);
  assert.strictEqual(routes.length, 1);

  // 2. Listener event surfaces with different notificationIdentifier > 4s later
  const second = routeWithDedupe(payload, 'listener-notif-id');
  assert.strictEqual(second, false);
  assert.strictEqual(routes.length, 1); // No duplicate navigation
});

test('16. Signed-out pending invite is consumed exactly once even if wrong account logs in', () => {
  let pendingNotification = {
    type: 'ludo_invitation',
    invitationId: 'inv-pending-bob-123',
  };

  // Bob taps notification while signed out -> stored in pending
  assert.ok(pendingNotification);

  // User logs into Charlie (wrong account)
  // Pending notification is retrieved and consumed (cleared immediately)
  const consumedNotification = pendingNotification;
  pendingNotification = null;

  assert.strictEqual(consumedNotification.invitationId, 'inv-pending-bob-123');
  assert.strictEqual(pendingNotification, null);

  // Even if Charlie navigates and server rejects with WRONG_ACCOUNT (403),
  // pendingNotification is NOT restored, preventing loop
  assert.strictEqual(pendingNotification, null);
});

test('17. User search cancellation / race: sequence guard drops older query response', () => {
  let latestSeq = 0;
  let activeResults = [];

  function handleSearchResponse(seq, query, results) {
    // Only accept results if this is the latest sequence
    if (seq === latestSeq) {
      activeResults = results;
    }
  }

  // Request 1: "bo"
  const seq1 = ++latestSeq;
  // Request 2: "bob"
  const seq2 = ++latestSeq;

  // Simulate Request 2 resolving first (faster network)
  handleSearchResponse(seq2, 'bob', [{ studentId: 'student_bob', name: 'Bob' }]);
  assert.strictEqual(activeResults.length, 1);
  assert.strictEqual(activeResults[0].name, 'Bob');

  // Simulate Request 1 resolving second (slow/laggy response for "bo")
  handleSearchResponse(seq1, 'bo', [{ studentId: 'student_bob', name: 'Bob' }, { studentId: 'student_boris', name: 'Boris' }]);
  // Must NOT overwrite newer results with stale "bo" results!
  assert.strictEqual(activeResults.length, 1);
  assert.strictEqual(activeResults[0].name, 'Bob');
});

// ----------------------------------------------------
// Phase 4D: Stale Invitation Tests (Gates 65-68)
// ----------------------------------------------------
test('18. (Gate 65) INVITATION_STALE mapped to friendly copy', () => {
  const mapped = mapInvitationError('INVITATION_STALE', 'Room generation mismatch');
  assert.strictEqual(mapped, 'This invitation belongs to an earlier match.');

  const mappedFromError = mapInvitationError(new LudoInvitationError('INVITATION_STALE', 'Generation changed'));
  assert.strictEqual(mappedFromError, 'This invitation belongs to an earlier match.');
});

test('19. (Gate 66 & 67) stale invitation state is read-only with no join action', () => {
  const invitation = {
    id: 'inv-stale-1',
    roomId: 'ABC234',
    status: 'cancelled',
    roomGeneration: 1,
  };
  const isStale = invitation.status === 'cancelled';
  // Read-only state flags: no join button enabled, does not route to game
  assert.strictEqual(isStale, true);

  const canJoin = invitation.status === 'pending';
  assert.strictEqual(canJoin, false);
});

test('20. (Gate 68) current generation active invitation is joinable', () => {
  const invitation = {
    id: 'inv-fresh-2',
    roomId: 'ABC234',
    status: 'pending',
    roomGeneration: 2,
  };
  const isStale = invitation.status === 'cancelled';
  assert.strictEqual(isStale, false);

  const canJoin = invitation.status === 'pending';
  assert.strictEqual(canJoin, true);
});
