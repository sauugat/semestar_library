const os = require('os');
const path = require('path');
const testDbPath = path.join(
  os.tmpdir(),
  `games_invitations_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;

const TEST_SECRET = 'a_very_secure_test_secret_for_games_1234567890';
process.env.GAMES_TICKET_SECRET = TEST_SECRET;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const db = require('../db');
const gamesInvitations = require('../lib/games-invitations');
const createGamesInvitationsRouter = require('../routes/games-invitations');

let server;
let baseUrl;

// Test identities
const hostAlice = {
  studentId: 'student_alice_host',
  username: 'alice_host',
  name: 'Alice Host',
  email: 'alice@college.edu',
};

const inviteeBob = {
  studentId: 'student_bob_invitee',
  username: 'bob_gamer',
  name: 'Bob Gamer',
  email: 'bob@college.edu',
};

const outsiderCharlie = {
  studentId: 'student_charlie_other',
  username: 'charlie_third',
  name: 'Charlie Third',
  email: 'charlie@college.edu',
};

// Mock Games Worker Room states
const mockRooms = new Map();

function createMockRoomState(roomId, overrides = {}) {
  return {
    roomId,
    gameType: 'ludo',
    roomStatus: 'lobby',
    hostUserId: hostAlice.studentId,
    activeSeatCount: 1,
    maxSeats: 4,
    seats: {
      red: { status: 'player', userId: hostAlice.studentId },
      green: { status: 'open' },
      yellow: { status: 'open' },
      blue: { status: 'open' },
    },
    ...overrides,
  };
}

// Custom fetchFn to simulate Games Worker queries
async function mockGamesWorkerFetch(url, options = {}) {
  const urlObj = new URL(url);
  const match = urlObj.pathname.match(/\/rooms\/([A-Za-z0-9]+)/);
  if (!match) {
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND', message: 'Endpoint not found' }),
    };
  }

  const roomId = match[1].toUpperCase();
  const room = mockRooms.get(roomId);
  if (!room) {
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'ROOM_NOT_FOUND', message: 'Room does not exist' }),
    };
  }

  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'ok',
      roomId: room.roomId,
      gameType: room.gameType,
      roomStatus: room.roomStatus,
      hostUserId: room.hostUserId,
      activeSeatCount: room.activeSeatCount,
      seats: room.seats,
    }),
  };
}

// Track pushed notifications
const capturedPushes = [];
const mockPushNotifications = {
  async enqueuePushForRecipients(dbConn, options = {}) {
    capturedPushes.push(options);
    return { enqueuedCount: options.recipientStudentIds?.length || 0 };
  },
  async createInAppNotification(dbConn, params) {
    return { id: 'in_app_' + Date.now() };
  },
};

let invitationsRouter;

test.beforeEach(async () => {
  gamesInvitations.clearRateLimits();
  if (invitationsRouter?.clearSearchRateLimits) {
    invitationsRouter.clearSearchRateLimits();
  }
  try {
    await db.run('DELETE FROM game_invitations');
  } catch {}
});

test.before(async () => {
  await db.initSchema();
  await gamesInvitations.ensureGamesInvitationsSchema(db);

  // Insert test students
  for (const s of [hostAlice, inviteeBob, outsiderCharlie]) {
    await db.run(
      `INSERT INTO students (studentId, username, name, role, email, gender, semester, department, avatarUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (studentId) DO NOTHING`,
      s.studentId,
      s.username,
      s.name,
      'student',
      s.email,
      'any',
      'Semester 5',
      'CS',
      'https://example.com/avatar.png'
    );
  }

  // Insert device tokens for Bob (multiple devices)
  await db.run(`DELETE FROM student_device_tokens WHERE student_id = ?`, inviteeBob.studentId);
  await db.run(
    `INSERT INTO student_device_tokens (student_id, expo_push_token, platform)
     VALUES (?, ?, ?)`,
    inviteeBob.studentId,
    'ExponentPushToken[device_bob_1]',
    'ios'
  );
  await db.run(
    `INSERT INTO student_device_tokens (student_id, expo_push_token, platform)
     VALUES (?, ?, ?)`,
    inviteeBob.studentId,
    'ExponentPushToken[device_bob_2]',
    'android'
  );

  // Create Express test app
  const app = express();
  app.use(express.json());

  // Mock requireLogin middleware reading user from header x-test-user
  const mockRequireLogin = (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (!userHeader) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (userHeader === 'alice') req.user = hostAlice;
    else if (userHeader === 'bob') req.user = inviteeBob;
    else if (userHeader === 'charlie') req.user = outsiderCharlie;
    else return res.status(401).json({ message: 'Invalid user header' });
    next();
  };

  const router = createGamesInvitationsRouter(db, mockRequireLogin, {
    gamesServiceUrl: 'http://mock-games-worker.internal',
    customTicketSecret: TEST_SECRET,
    pushNotifications: mockPushNotifications,
    fetchFn: mockGamesWorkerFetch,
  });
  invitationsRouter = router;

  app.use('/api/games/ludo', router);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

test('1. Unauthenticated invitation create is rejected with 401', async () => {
  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: 'ABC234', inviteeUserId: inviteeBob.studentId }),
  });
  assert.strictEqual(res.status, 401);
});

test('2. Non-host invitation create is rejected with 403', async () => {
  const roomId = 'ABC234';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'charlie', // Charlie is not host
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.error, 'NOT_ROOM_HOST');
});

test('3. Host invitation create succeeds and returns invitation', async () => {
  const roomId = 'BCD345';
  mockRooms.set(roomId, createMockRoomState(roomId));
  capturedPushes.length = 0;

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice', // Alice is host
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });

  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.ok(data.invitation);
  assert.strictEqual(data.invitation.roomId, roomId);
  assert.strictEqual(data.invitation.inviterUserId, hostAlice.studentId);
  assert.strictEqual(data.invitation.inviteeUserId, inviteeBob.studentId);
  assert.strictEqual(data.invitation.status, 'pending');
  assert.strictEqual(data.invitation.gameType, 'ludo');
  assert.ok(data.invitation.id);
  assert.ok(data.invitation.expiresAt);

  // Check push notification was dispatched
  assert.strictEqual(capturedPushes.length, 1);
  const push = capturedPushes[0];
  assert.deepStrictEqual(push.recipientStudentIds, [inviteeBob.studentId]);
  assert.strictEqual(push.payload.data.type, 'ludo_invitation');
  assert.strictEqual(push.payload.data.invitationId, data.invitation.id);
  // Privacy verification: no room code in body or title
  assert.ok(!push.payload.body?.includes(roomId));
  assert.ok(!push.payload.title?.includes(roomId));
  // Security verification: no tickets or tokens
  assert.strictEqual(push.payload.data.ticket, undefined);
  assert.strictEqual(push.payload.data.gamesTicket, undefined);
});

test('4. Inviting self is rejected with 400', async () => {
  const roomId = 'CDE456';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: hostAlice.studentId }),
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error, 'CANNOT_INVITE_SELF');
});

test('5. Nonexistent recipient is rejected with 404', async () => {
  const roomId = 'DEF567';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: 'student_does_not_exist_999' }),
  });

  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'RECIPIENT_NOT_FOUND');
});

test('6. Malformed room code is rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId: 'INVALID!!!ROOOM', inviteeUserId: inviteeBob.studentId }),
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error, 'INVALID_ROOM_CODE');
});

test('7. Non-Ludo room is rejected with 400', async () => {
  const roomId = 'EFG678';
  mockRooms.set(roomId, createMockRoomState(roomId, { gameType: 'tictactoe' }));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error, 'INVALID_GAME_TYPE');
});

test('8. Started room is rejected with 409', async () => {
  const roomId = 'FGH789';
  mockRooms.set(roomId, createMockRoomState(roomId, { roomStatus: 'playing' }));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });

  assert.strictEqual(res.status, 409);
  const data = await res.json();
  assert.strictEqual(data.error, 'ROOM_ALREADY_STARTED');
});

test('9. Duplicate pending invitation returns existing record with deduplicated: true', async () => {
  const roomId = 'GHJ892';
  mockRooms.set(roomId, createMockRoomState(roomId));

  // First create
  const res1 = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  assert.strictEqual(res1.status, 201);
  const data1 = await res1.json();

  // Second create: exact same room + inviter + invitee
  const res2 = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  assert.strictEqual(res2.status, 200);
  const data2 = await res2.json();
  assert.strictEqual(data2.deduplicated, true);
  assert.strictEqual(data2.invitation.id, data1.invitation.id);
});

test('10. Rate limiting enforces max 5 invitations per minute per inviter', async () => {
  const rateInviterId = 'student_spammer_test_99';
  gamesInvitations.clearRateLimits();

  // First 5 attempts should succeed
  for (let i = 0; i < 5; i++) {
    const allowed = gamesInvitations.checkRateLimit(rateInviterId);
    assert.strictEqual(allowed, true);
  }

  // 6th attempt should be blocked
  const sixthAllowed = gamesInvitations.checkRateLimit(rateInviterId);
  assert.strictEqual(sixthAllowed, false);
});

test('11. Invitation ID is UUID / secure unpredictable string', async () => {
  const roomId = 'HJK234';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'alice',
    },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const data = await res.json();
  assert.match(
    data.invitation.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test('12. Recipient can GET own invitation details with safe fields', async () => {
  const roomId = 'JKM345';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const getRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}`, {
    headers: { 'x-test-user': 'bob' }, // Bob is invitee
  });
  assert.strictEqual(getRes.status, 200);
  const data = await getRes.json();
  assert.strictEqual(data.invitation.id, invitation.id);
  assert.strictEqual(data.invitation.status, 'pending');
  assert.strictEqual(data.invitation.inviter.userId, hostAlice.studentId);
  assert.strictEqual(data.invitation.inviter.displayName, hostAlice.name);
  assert.strictEqual(data.invitation.invitee.userId, inviteeBob.studentId);
  // Email and tokens must NOT be exposed
  assert.strictEqual(data.invitation.inviter.email, undefined);
  assert.strictEqual(data.invitation.ticket, undefined);
});

test('13. Other user (Charlie) cannot GET invitation (403)', async () => {
  const roomId = 'KMN456';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const getRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}`, {
    headers: { 'x-test-user': 'charlie' }, // Charlie is neither inviter nor invitee
  });
  assert.strictEqual(getRes.status, 403);
});

test('14. Recipient accepts invitation and receives room ID', async () => {
  const roomId = 'MNP567';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { 'x-test-user': 'bob' },
  });
  assert.strictEqual(acceptRes.status, 200);
  const data = await acceptRes.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.roomId, roomId);
  assert.strictEqual(data.status, 'accepted');

  // Verify DB state updated
  const row = await db.get(`SELECT status FROM game_invitations WHERE id = ?`, invitation.id);
  assert.strictEqual(row.status, 'accepted');
});

test('15. Inviter cannot accept their own invitation (403)', async () => {
  const roomId = 'NPQ678';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { 'x-test-user': 'alice' }, // Alice is inviter
  });
  assert.strictEqual(acceptRes.status, 403);
  const data = await acceptRes.json();
  assert.strictEqual(data.error, 'WRONG_ACCOUNT');
});

test('16. Other user (Charlie) cannot accept invitation (403)', async () => {
  const roomId = 'PQR789';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { 'x-test-user': 'charlie' },
  });
  assert.strictEqual(acceptRes.status, 403);
});

test('17. Recipient declines invitation', async () => {
  const roomId = 'QRS892';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const declineRes = await fetch(
    `${baseUrl}/api/games/ludo/invitations/${invitation.id}/decline`,
    {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }
  );
  assert.strictEqual(declineRes.status, 200);
  const data = await declineRes.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.status, 'declined');

  // Verify Bob cannot later accept the declined invitation
  const lateAcceptRes = await fetch(
    `${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`,
    {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }
  );
  assert.strictEqual(lateAcceptRes.status, 400);
});

test('18. Other user cannot decline invitation (403)', async () => {
  const roomId = 'RST234';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  const declineRes = await fetch(
    `${baseUrl}/api/games/ludo/invitations/${invitation.id}/decline`,
    {
      method: 'POST',
      headers: { 'x-test-user': 'charlie' },
    }
  );
  assert.strictEqual(declineRes.status, 403);
});

test('19. Expired invitation cannot be accepted (410 EXPIRED)', async () => {
  const roomId = 'STU345';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  // Manually update expiresAt to past in DB
  const pastDate = new Date(Date.now() - 10000).toISOString();
  await db.run(`UPDATE game_invitations SET expires_at = ? WHERE id = ?`, pastDate, invitation.id);

  const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { 'x-test-user': 'bob' },
  });
  assert.strictEqual(acceptRes.status, 410);
  const data = await acceptRes.json();
  assert.strictEqual(data.error, 'EXPIRED');
});

test('20 & 21. Acceptance fails safely if room started or full during race', async () => {
  const roomId = 'UVW567';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  // 21a. Simulate room became full before Bob accepted
  mockRooms.set(
    roomId,
    createMockRoomState(roomId, {
      seats: {
        red: { status: 'player', userId: hostAlice.studentId },
        green: { status: 'player', userId: 'user_2' },
        yellow: { status: 'player', userId: 'user_3' },
        blue: { status: 'player', userId: 'user_4' },
      },
    })
  );

  const acceptResFull = await fetch(
    `${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`,
    {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }
  );
  assert.strictEqual(acceptResFull.status, 409);
  const dataFull = await acceptResFull.json();
  assert.strictEqual(dataFull.error, 'ROOM_FULL');

  // 21b. Simulate room started before Bob accepted
  mockRooms.set(
    roomId,
    createMockRoomState(roomId, {
      roomStatus: 'playing',
    })
  );

  const acceptResStarted = await fetch(
    `${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`,
    {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }
  );
  assert.strictEqual(acceptResStarted.status, 409);
  const dataStarted = await acceptResStarted.json();
  assert.strictEqual(dataStarted.error, 'ROOM_STARTED');
});

test('User Search: safe fields only, excludes emails and current user', async () => {
  const res = await fetch(`${baseUrl}/api/games/ludo/users/search?q=gamer`, {
    headers: { 'x-test-user': 'alice' },
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.users));
  // Bob gamer should match
  const foundBob = data.users.find((u) => u.studentId === inviteeBob.studentId);
  assert.ok(foundBob);
  assert.strictEqual(foundBob.name, inviteeBob.name);
  assert.strictEqual(foundBob.username, inviteeBob.username);
  // Email must NEVER be exposed
  assert.strictEqual(foundBob.email, undefined);

  // Current user (Alice) must be excluded even if searching for alice
  const resAlice = await fetch(`${baseUrl}/api/games/ludo/users/search?q=alice`, {
    headers: { 'x-test-user': 'alice' },
  });
  const dataAlice = await resAlice.json();
  const foundAlice = dataAlice.users.find((u) => u.studentId === hostAlice.studentId);
  assert.strictEqual(foundAlice, undefined);
});

test('22. Malformed invitation UUID rejected with 400', async () => {
  const malformedIds = ['../../etc/passwd', 'not-a-uuid', '12345', 'SELECT * FROM users', 'a'.repeat(200)];

  for (const badId of malformedIds) {
    const getRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${encodeURIComponent(badId)}`, {
      headers: { 'x-test-user': 'bob' },
    });
    assert.strictEqual(getRes.status, 400);
    const getData = await getRes.json();
    assert.strictEqual(getData.error, 'INVALID_INVITATION_ID');

    const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${encodeURIComponent(badId)}/accept`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    });
    assert.strictEqual(acceptRes.status, 400);

    const declineRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${encodeURIComponent(badId)}/decline`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    });
    assert.strictEqual(declineRes.status, 400);
  }
});

test('23. Already seated recipient is rejected with 400 ALREADY_IN_ROOM', async () => {
  const roomId = 'SEA234';
  // Charlie is already seated in green
  mockRooms.set(
    roomId,
    createMockRoomState(roomId, {
      seats: {
        red: { status: 'player', userId: hostAlice.studentId },
        green: { status: 'player', userId: outsiderCharlie.studentId },
        yellow: { status: 'open' },
        blue: { status: 'open' },
      },
    })
  );

  const res = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: outsiderCharlie.studentId }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error, 'ALREADY_IN_ROOM');
});

test('24. Concurrent duplicate invitation create yields ONE DB invitation and ONE push enqueue', async () => {
  const roomId = 'CKN234';
  mockRooms.set(roomId, createMockRoomState(roomId));
  capturedPushes.length = 0;

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/games/ludo/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
    }),
    fetch(`${baseUrl}/api/games/ludo/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
    }),
  ]);

  const data1 = await res1.json();
  const data2 = await res2.json();

  // Both resolve successfully to the same invitation ID
  assert.ok(res1.status === 200 || res1.status === 201);
  assert.ok(res2.status === 200 || res2.status === 201);
  assert.strictEqual(data1.invitation.id, data2.invitation.id);

  // Exactly one pending invitation in DB
  const rows = await db.all(
    `SELECT id FROM game_invitations WHERE room_id = ? AND inviter_user_id = ? AND invitee_user_id = ? AND status = 'pending'`,
    roomId,
    hostAlice.studentId,
    inviteeBob.studentId
  );
  assert.strictEqual(rows.length, 1);

  // Exactly ONE push was enqueued
  assert.strictEqual(capturedPushes.length, 1);
});

test('25. Accept double-submit is idempotent and does not error', async () => {
  const roomId = 'DBK345';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const createBody = await createRes.json();
  const { invitation } = createBody;

  // Two concurrent accept requests from Bob
  const [acceptRes1, acceptRes2] = await Promise.all([
    fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }),
    fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }),
  ]);

  assert.strictEqual(acceptRes1.status, 200);
  assert.strictEqual(acceptRes2.status, 200);
  const data1 = await acceptRes1.json();
  const data2 = await acceptRes2.json();
  assert.strictEqual(data1.status, 'accepted');
  assert.strictEqual(data2.status, 'accepted');
  assert.strictEqual(data1.roomId, roomId);
  assert.strictEqual(data2.roomId, roomId);

  // DB has status accepted with one updated row
  const row = await db.get(`SELECT status FROM game_invitations WHERE id = ?`, invitation.id);
  assert.strictEqual(row.status, 'accepted');
});

test('26. Accept vs Decline race has exactly one winner', async () => {
  const roomId = 'RAC456';
  mockRooms.set(roomId, createMockRoomState(roomId));

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  // Simultaneous accept and decline
  const [resAccept, resDecline] = await Promise.all([
    fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }),
    fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/decline`, {
      method: 'POST',
      headers: { 'x-test-user': 'bob' },
    }),
  ]);

  const statuses = [resAccept.status, resDecline.status].sort();
  // One must be 200 (winner) and one must be 400 (loser)
  assert.deepStrictEqual(statuses, [200, 400]);

  const row = await db.get(`SELECT status FROM game_invitations WHERE id = ?`, invitation.id);
  assert.ok(row.status === 'accepted' || row.status === 'declined');
});

test('27. Host transfer after invite: invitation remains valid for unexpired lobby', async () => {
  const roomId = 'TRF567';
  mockRooms.set(roomId, createMockRoomState(roomId)); // Alice is host

  const createRes = await fetch(`${baseUrl}/api/games/ludo/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': 'alice' },
    body: JSON.stringify({ roomId, inviteeUserId: inviteeBob.studentId }),
  });
  const { invitation } = await createRes.json();

  // Host transfers to Charlie
  mockRooms.set(
    roomId,
    createMockRoomState(roomId, {
      hostUserId: outsiderCharlie.studentId,
      seats: {
        red: { status: 'open' }, // Alice left
        green: { status: 'player', userId: outsiderCharlie.studentId },
        yellow: { status: 'open' },
        blue: { status: 'open' },
      },
    })
  );

  // Bob accepts invitation -> revalidation succeeds because room is still lobby with open capacity
  const acceptRes = await fetch(`${baseUrl}/api/games/ludo/invitations/${invitation.id}/accept`, {
    method: 'POST',
    headers: { 'x-test-user': 'bob' },
  });
  assert.strictEqual(acceptRes.status, 200);
  const data = await acceptRes.json();
  assert.strictEqual(data.status, 'accepted');
});

test('28. User search rate limit: 30 requests/minute/user', async () => {
  // Fire 30 requests - should succeed
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${baseUrl}/api/games/ludo/users/search?q=bo`, {
      headers: { 'x-test-user': 'alice' },
    });
    assert.strictEqual(res.status, 200);
  }

  // 31st request from Alice should be rate limited
  const resLimit = await fetch(`${baseUrl}/api/games/ludo/users/search?q=bo`, {
    headers: { 'x-test-user': 'alice' },
  });
  assert.strictEqual(resLimit.status, 429);
  const dataLimit = await resLimit.json();
  assert.strictEqual(dataLimit.error, 'RATE_LIMITED');
});
