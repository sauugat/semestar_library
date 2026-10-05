const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `games_ticket_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;

const TEST_SECRET = 'a_very_secure_test_secret_for_games_1234567890';
process.env.GAMES_TICKET_SECRET = TEST_SECRET;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const { createGamesTicket, verifyGamesTicket, TICKET_TTL_SECONDS, MIN_SECRET_LENGTH } = require('../lib/games-ticket');

let server;
let baseUrl;
const testStudentId = 'student_games_tester_1';
const testMobileToken = 'token_games_test_999999999999999999999999999999999999999999999999999999999999';

test.before(async () => {
  await db.initSchema();

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, gender, semester, department, avatarUrl)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (studentId) DO NOTHING`,
    testStudentId, 'gamertest', 'Gamer Tester', 'student', 'secret_email@college.edu', 'male', 'Semester 5', 'BIT', 'https://example.com/avatar.png'
  );

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT (token) DO NOTHING`,
    testMobileToken, testStudentId, expiresAt
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

test('Ticket Format: exactly 3 dot-separated parts with v1 prefix', () => {
  const user = { studentId: 'student_123', username: 'gamer', name: 'Gamer One' };
  const ticket = createGamesTicket(user, TEST_SECRET);

  const parts = ticket.split('.');
  assert.equal(parts.length, 3, 'Ticket must have exactly 3 parts');
  assert.equal(parts[0], 'v1', 'Ticket must start with v1 prefix');
  assert.ok(parts[1].length > 0, 'Payload part must not be empty');
  assert.ok(parts[2].length > 0, 'Signature part must not be empty');
});

test('Ticket Verification: valid ticket verifies successfully with correct claims', () => {
  const user = {
    studentId: 'student_456',
    username: 'player2',
    name: 'Player Two',
    avatarUrl: 'https://example.com/p2.png',
  };
  const ticket = createGamesTicket(user, TEST_SECRET);
  const result = verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, true);
  assert.ok(result.payload);
  assert.equal(result.payload.v, 1);
  assert.equal(result.payload.sub, 'student_456');
  assert.equal(result.payload.username, 'player2');
  assert.equal(result.payload.name, 'Player Two');
  assert.equal(result.payload.avatarUrl, 'https://example.com/p2.png');
  assert.equal(result.payload.iss, 'semester-library');
  assert.equal(result.payload.aud, 'semester-games');
  assert.equal(result.payload.exp - result.payload.iat, 300, 'Expiration must be exactly 300 seconds');
  assert.ok(result.payload.jti, 'jti must be present');
});

test('Ticket Uniqueness: separately generated tickets have different jti and timestamps', async () => {
  const user = { studentId: 'student_789', name: 'Player' };
  const ticket1 = createGamesTicket(user, TEST_SECRET);
  const ticket2 = createGamesTicket(user, TEST_SECRET);

  const res1 = verifyGamesTicket(ticket1, TEST_SECRET);
  const res2 = verifyGamesTicket(ticket2, TEST_SECRET);

  assert.notEqual(res1.payload.jti, res2.payload.jti, 'Different tickets must have distinct jti values');
  assert.notEqual(ticket1, ticket2, 'Ticket strings must be unique');
});

test('Ticket Security: modifying payload invalidates signature', () => {
  const user = { studentId: 'student_real', name: 'Real User' };
  const ticket = createGamesTicket(user, TEST_SECRET);
  const [version, payloadB64, signature] = ticket.split('.');

  // Tamper with payload: change studentId to admin
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  payload.sub = 'student_admin';
  const tamperedB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const tamperedTicket = `${version}.${tamperedB64}.${signature}`;

  const result = verifyGamesTicket(tamperedTicket, TEST_SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'Invalid signature');
});

test('Ticket Security: modifying signature invalidates ticket', () => {
  const user = { studentId: 'student_test', name: 'Tester' };
  const ticket = createGamesTicket(user, TEST_SECRET);
  const [version, payloadB64, signature] = ticket.split('.');

  // Corrupt signature
  const corruptedSignature = signature.slice(0, -2) + (signature.endsWith('a') ? 'b' : 'a');
  const corruptedTicket = `${version}.${payloadB64}.${corruptedSignature}`;

  const result = verifyGamesTicket(corruptedTicket, TEST_SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'Invalid signature');
});

test('Ticket Configuration: weak or missing secret is rejected', () => {
  const user = { studentId: 'student_123', name: 'Test' };

  assert.throws(() => createGamesTicket(user, ''), /GAMES_TICKET_SECRET/);
  assert.throws(() => createGamesTicket(user, 'short_secret'), /GAMES_TICKET_SECRET/);
  assert.throws(() => createGamesTicket(user, null), /GAMES_TICKET_SECRET/);

  // When process.env.GAMES_TICKET_SECRET is unset
  const oldSec = process.env.GAMES_TICKET_SECRET;
  try {
    delete process.env.GAMES_TICKET_SECRET;
    assert.throws(() => createGamesTicket(user), /GAMES_TICKET_SECRET/);
  } finally {
    process.env.GAMES_TICKET_SECRET = oldSec;
  }

  // Verify function also rejects weak secrets
  const ticket = createGamesTicket(user, TEST_SECRET);
  assert.throws(() => verifyGamesTicket(ticket, 'short'), /GAMES_TICKET_SECRET/);
});

test('Ticket Payload Hygiene: excluded sensitive fields are never in the ticket payload', () => {
  // Pass an object with sensitive fields (email, gender, password, token, semester, etc.)
  const userWithSensitiveData = {
    studentId: 'student_leak_test',
    username: 'leaktest',
    name: 'Leak Tester',
    email: 'private@college.edu',
    gender: 'female',
    passwordHash: '$2a$10$abcdefg',
    mobileToken: 'opaque_token_12345',
    token: 'opaque_token_12345',
    semester: 'Semester 4',
    department: 'BIT',
    verificationStatus: 'verified',
    verification_status: 'verified',
    role: 'admin',
    isAdmin: true,
  };

  const ticket = createGamesTicket(userWithSensitiveData, TEST_SECRET);
  const { payload } = verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(payload.email, undefined);
  assert.equal(payload.gender, undefined);
  assert.equal(payload.passwordHash, undefined);
  assert.equal(payload.password, undefined);
  assert.equal(payload.mobileToken, undefined);
  assert.equal(payload.token, undefined);
  assert.equal(payload.semester, undefined);
  assert.equal(payload.department, undefined);
  assert.equal(payload.verificationStatus, undefined);
  assert.equal(payload.role, undefined);
  assert.equal(payload.isAdmin, undefined);

  // Exact set of allowed keys
  const allowedKeys = new Set(['v', 'sub', 'username', 'name', 'avatarUrl', 'iss', 'aud', 'iat', 'exp', 'jti']);
  for (const key of Object.keys(payload)) {
    assert.ok(allowedKeys.has(key), `Payload contains unexpected claim: ${key}`);
  }
});

test('Endpoint POST /api/games/ticket: returns 200 with ticket for authenticated mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/games/ticket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${testMobileToken}`,
      'Content-Type': 'application/json',
    },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ticket, 'Must return ticket string');
  assert.equal(data.expiresIn, 300, 'Must return expiresIn of 300 seconds');

  // Verify the returned ticket matches the authenticated user
  const verification = verifyGamesTicket(data.ticket, TEST_SECRET);
  assert.equal(verification.valid, true);
  assert.equal(verification.payload.sub, testStudentId);
  assert.equal(verification.payload.username, 'gamertest');
  assert.equal(verification.payload.name, 'Gamer Tester');
  assert.equal(verification.payload.avatarUrl, 'https://example.com/avatar.png');
});

test('Endpoint POST /api/games/ticket: returns 401 for unauthenticated request', async () => {
  const res = await fetch(`${baseUrl}/api/games/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.ok(data.message.includes('Authentication required'));
});

test('Endpoint POST /api/games/ticket: returns 401 for invalid mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/games/ticket`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer invalid_nonexistent_token_1234567890',
      'Content-Type': 'application/json',
    },
  });

  assert.equal(res.status, 401);
});

test('Endpoint POST /api/games/ticket: fails closed (500) if secret is unconfigured without leaking details', async () => {
  const savedSecret = process.env.GAMES_TICKET_SECRET;
  try {
    delete process.env.GAMES_TICKET_SECRET;

    const res = await fetch(`${baseUrl}/api/games/ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${testMobileToken}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.message, 'Failed to issue Games ticket. Please try again later.');
    // Confirm no secret or config stack was returned
    assert.equal(data.secret, undefined);
    assert.equal(data.error, undefined);
  } finally {
    process.env.GAMES_TICKET_SECRET = savedSecret;
  }
});
