const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `games_invitations_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.GAMES_TICKET_SECRET = 'a_very_secure_test_secret_for_games_1234567890';
process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const {
  INVITATION_TTL_MS,
  MAX_INVITES_PER_WINDOW,
  DUPLICATE_WINDOW_MS,
} = require('../lib/games-invitations');

let server;
let baseUrl;

const senderStudentId = 'student_sender_001';
const senderToken = 'token_sender_000000000000000000000000000000000000000000000000000000000001';

const recipientStudentId = 'student_recipient_002';
const recipientToken = 'token_recipient_00000000000000000000000000000000000000000000000000000002';

const thirdPartyStudentId = 'student_third_party_003';
const thirdPartyToken = 'token_third_party_000000000000000000000000000000000000000000000000003';

const recipientExpoToken = 'ExponentPushToken[recipient_device_test_12345]';

test.before(async () => {
  await db.initSchema();

  // Create test students
  for (const s of [
    { id: senderStudentId, name: 'Saugat Sender', username: 'sauu_gat' },
    { id: recipientStudentId, name: 'Shiva Recipient', username: 'shiva_rec' },
    { id: thirdPartyStudentId, name: 'Third Party', username: 'third_party' },
  ]) {
    await db.run(
      `INSERT INTO students (studentId, username, name, role, email, gender, semester, department)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (studentId) DO NOTHING`,
      s.id, s.username, s.name, 'student', `${s.username}@college.edu`, 'male', 'Semester 5', 'BIT'
    );
  }

  // Create mobile bearer tokens
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?), (?, ?, CURRENT_TIMESTAMP, ?), (?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT (token) DO NOTHING`,
    senderToken, senderStudentId, expiresAt,
    recipientToken, recipientStudentId, expiresAt,
    thirdPartyToken, thirdPartyStudentId, expiresAt
  );

  // Register device token for recipient
  await db.run(
    `INSERT INTO student_device_tokens (expo_push_token, student_id, platform, device_name)
     VALUES (?, ?, 'android', 'Pixel Tester')
     ON CONFLICT (expo_push_token) DO NOTHING`,
    recipientExpoToken, recipientStudentId
  );

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
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

test('POST /api/games/invitations: unauthenticated creation rejected (401)', async () => {
  const res = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'X5QR5A',
      recipientStudentId,
    }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/games/invitations: self-invite rejected (400)', async () => {
  const res = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'X5QR5A',
      recipientStudentId: senderStudentId,
    }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /cannot invite yourself/i);
});

test('POST /api/games/invitations: nonexistent recipient rejected (404)', async () => {
  const res = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'X5QR5A',
      recipientStudentId: 'nonexistent_student_99999',
    }),
  });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.message, /not found/i);
});

test('POST /api/games/invitations: invalid gameType rejected (400)', async () => {
  const res = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'poker',
      roomId: 'X5QR5A',
      recipientStudentId,
    }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /unsupported/i);
});

test('POST /api/games/invitations: malformed room ID rejected (400)', async () => {
  const malformedRooms = ['', 'AB', 'X5QR$!', 'A'.repeat(25)];
  for (const roomId of malformedRooms) {
    const res = await fetch(`${baseUrl}/api/games/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
      },
      body: JSON.stringify({
        gameType: 'tic-tac-toe',
        roomId,
        recipientStudentId,
      }),
    });
    assert.equal(res.status, 400);
  }
});

test('POST /api/games/invitations: valid invitation succeeds, derives sender from auth, generates 10min expiry, persists, and enqueues push', async () => {
  const tBefore = Date.now();
  const res = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'X5QR5A',
      recipientStudentId,
      // Attempt injection of spoofed sender
      senderStudentId: 'evil_spoofed_student',
      senderName: 'Fake Name',
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.invitation);
  assert.ok(data.invitation.id);
  assert.equal(data.invitation.gameType, 'tic-tac-toe');
  assert.equal(data.invitation.roomId, 'X5QR5A');
  assert.equal(data.invitation.recipientStudentId, recipientStudentId);

  // Check server-generated expiry (~10 minutes)
  const expMs = new Date(data.invitation.expiresAt).getTime();
  assert.ok(expMs >= tBefore + 9 * 60 * 1000);
  assert.ok(expMs <= tBefore + 11 * 60 * 1000);

  // Verify database record has authoritative sender from auth
  const row = await db.get('SELECT * FROM game_invitations WHERE id = ?', data.invitation.id);
  assert.ok(row);
  assert.equal(row.sender_student_id, senderStudentId);
  assert.notEqual(row.sender_student_id, 'evil_spoofed_student');
  assert.equal(row.recipient_student_id, recipientStudentId);
  assert.equal(row.game_type, 'tic-tac-toe');
  assert.equal(row.room_id, 'X5QR5A');

  // Verify outbox entry
  const outbox = await db.get(
    'SELECT * FROM push_notification_outbox WHERE event_type = ? AND event_id = ?',
    'game_invite', data.invitation.id
  );
  assert.ok(outbox, 'Outbox item should be created for game_invite');
  assert.equal(outbox.recipient_student_id, recipientStudentId);

  const payload = JSON.parse(outbox.payload_json);
  assert.equal(payload.title, 'Tic Tac Toe Invite');
  assert.match(payload.body, /Saugat Sender invited you to play Tic Tac Toe/);
  assert.equal(payload.data.type, 'game_invite');
  assert.equal(payload.data.gameType, 'tic-tac-toe');
  assert.equal(payload.data.invitationId, data.invitation.id);
  assert.equal(payload.data.roomId, 'X5QR5A');
  assert.ok(payload.data.expiresAt);

  // Verify NO tokens or secrets enter push payload
  const payloadStr = JSON.stringify(payload);
  assert.equal(payloadStr.includes(senderToken), false);
  assert.equal(payloadStr.includes(process.env.GAMES_TICKET_SECRET), false);
  assert.equal(payloadStr.includes('password'), false);
  assert.equal(payloadStr.includes('ticket'), false);
});

test('POST /api/games/invitations: duplicate rapid invite within 30s returns existing without resending push', async () => {
  const res1 = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'DUP111',
      recipientStudentId,
    }),
  });
  assert.equal(res1.status, 201);
  const data1 = await res1.json();
  const inviteId1 = data1.invitation.id;

  const countOutbox1 = await db.get(
    'SELECT COUNT(*) as count FROM push_notification_outbox WHERE event_type = ? AND event_id = ?',
    'game_invite', inviteId1
  );
  assert.equal(Number(countOutbox1.count), 1);

  // Immediate second invite for same room and recipient
  const res2 = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'DUP111',
      recipientStudentId,
    }),
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.invitation.id, inviteId1, 'Should return existing active invitation');

  // Push count must remain 1
  const countOutbox2 = await db.get(
    'SELECT COUNT(*) as count FROM push_notification_outbox WHERE event_type = ? AND event_id = ?',
    'game_invite', inviteId1
  );
  assert.equal(Number(countOutbox2.count), 1, 'Duplicate invite must not create additional push outbox entry');
});

test('POST /api/games/invitations: rate limiting blocks sending > 3 invites in 60s', async () => {
  // Clear any existing invitations for sender
  await db.run('DELETE FROM game_invitations WHERE sender_student_id = ?', senderStudentId);

  // Send 3 distinct invitations to different rooms
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${baseUrl}/api/games/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
      },
      body: JSON.stringify({
        gameType: 'tic-tac-toe',
        roomId: `RATE0${i}`,
        recipientStudentId,
      }),
    });
    assert.equal(res.status, 201, `Invite ${i} should succeed`);
  }

  // 4th invite must be blocked with 429
  const res4 = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'RATE04',
      recipientStudentId,
    }),
  });
  assert.equal(res4.status, 429);
  const data4 = await res4.json();
  assert.match(data4.message, /too quickly/i);
});

test('GET /api/games/invitations/:id: recipient-only validation succeeds with safe public details', async () => {
  // Create an invitation from sender to recipient
  const createRes = await fetch(`${baseUrl}/api/games/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${senderToken}`,
    },
    body: JSON.stringify({
      gameType: 'tic-tac-toe',
      roomId: 'VALID1',
      recipientStudentId,
    }),
  });

  // If rate-limited, clean invitations and retry
  let inviteId;
  if (createRes.status === 201) {
    const d = await createRes.json();
    inviteId = d.invitation.id;
  } else {
    await db.run('DELETE FROM game_invitations WHERE sender_student_id = ?', senderStudentId);
    const retry = await fetch(`${baseUrl}/api/games/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
      },
      body: JSON.stringify({
        gameType: 'tic-tac-toe',
        roomId: 'VALID1',
        recipientStudentId,
      }),
    });
    assert.equal(retry.status, 201);
    const d = await retry.json();
    inviteId = d.invitation.id;
  }

  // Recipient fetches invitation
  const res = await fetch(`${baseUrl}/api/games/invitations/${inviteId}`, {
    headers: {
      Authorization: `Bearer ${recipientToken}`,
    },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.invitation);
  assert.equal(data.invitation.id, inviteId);
  assert.equal(data.invitation.gameType, 'tic-tac-toe');
  assert.equal(data.invitation.roomId, 'VALID1');
  assert.equal(data.invitation.inviter.name, 'Saugat Sender');
  assert.ok(data.invitation.expiresAt);

  // Check no private info exposed
  assert.equal(data.invitation.inviter.email, undefined);
  assert.equal(data.invitation.inviter.token, undefined);
  assert.equal(data.invitation.inviter.gender, undefined);
});

test('GET /api/games/invitations/:id: unauthenticated request rejected (401)', async () => {
  const res = await fetch(`${baseUrl}/api/games/invitations/any-id`);
  assert.equal(res.status, 401);
});

test('GET /api/games/invitations/:id: unrelated student cannot read invitation (404)', async () => {
  // Create invite specifically for recipient
  const inviteId = 'secure-invite-uuid-1234';
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO game_invitations (id, sender_student_id, recipient_student_id, game_type, room_id, created_at, expires_at)
     VALUES (?, ?, ?, 'tic-tac-toe', 'PRIV88', CURRENT_TIMESTAMP, ?)`,
    inviteId, senderStudentId, recipientStudentId, expiresAt
  );

  // Third party attempts to read it
  const res = await fetch(`${baseUrl}/api/games/invitations/${inviteId}`, {
    headers: {
      Authorization: `Bearer ${thirdPartyToken}`,
    },
  });
  assert.equal(res.status, 404);
});

test('GET /api/games/invitations/:id: expired invitation returns 410 Gone', async () => {
  const expiredInviteId = 'expired-invite-uuid-9999';
  const pastExpiresAt = new Date(Date.now() - 5000).toISOString();
  await db.run(
    `INSERT INTO game_invitations (id, sender_student_id, recipient_student_id, game_type, room_id, created_at, expires_at)
     VALUES (?, ?, ?, 'tic-tac-toe', 'OLD999', CURRENT_TIMESTAMP, ?)`,
    expiredInviteId, senderStudentId, recipientStudentId, pastExpiresAt
  );

  const res = await fetch(`${baseUrl}/api/games/invitations/${expiredInviteId}`, {
    headers: {
      Authorization: `Bearer ${recipientToken}`,
    },
  });
  assert.equal(res.status, 410);
  const data = await res.json();
  assert.match(data.message, /no longer active/i);
  assert.equal(data.expired, true);
});
