import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyGamesTicket } from '../src/auth/games-ticket.ts';

// Import Semester Library backend ticket creator directly to prove cross-compatibility
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGamesTicket } = require('../../lib/games-ticket.js');

const TEST_SECRET = 'cloudflare_test_secret_for_games_1234567890';
const WRONG_SECRET = 'a_completely_different_test_secret_1234567890';

// Helper to manually build custom tickets for edge-case testing
function buildCustomTicket(payloadObj, secret = TEST_SECRET, version = 'v1') {
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const signingInput = `${version}.${payloadB64}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

test('Cloudflare Verifier: valid ticket issued by Semester Library backend verifies successfully', async () => {
  const user = {
    studentId: 'student_cf_test_1',
    username: 'saugat',
    name: 'Saugat Sharma',
    avatarUrl: 'https://example.com/avatar.jpg',
  };

  const ticket = createGamesTicket(user, TEST_SECRET);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.payload.v, 1);
    assert.equal(result.payload.sub, 'student_cf_test_1');
    assert.equal(result.payload.username, 'saugat');
    assert.equal(result.payload.name, 'Saugat Sharma');
    assert.equal(result.payload.avatarUrl, 'https://example.com/avatar.jpg');
    assert.equal(result.payload.iss, 'semester-library');
    assert.equal(result.payload.aud, 'semester-games');
    assert.ok(result.payload.jti);
    assert.equal(result.payload.exp - result.payload.iat, 300);
  }
});

test('Cloudflare Verifier: wrong secret fails verification', async () => {
  const user = { studentId: 'student_cf_test_2', name: 'User' };
  const ticket = createGamesTicket(user, TEST_SECRET);

  const result = await verifyGamesTicket(ticket, WRONG_SECRET);
  assert.equal(result.valid, false);
  assert.match(result.error, /signature/i);
});

test('Cloudflare Verifier: modified payload fails verification', async () => {
  const user = { studentId: 'student_original', name: 'User' };
  const ticket = createGamesTicket(user, TEST_SECRET);
  const [version, payloadB64, signature] = ticket.split('.');

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  payload.sub = 'student_impersonated';
  const tamperedB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const tamperedTicket = `${version}.${tamperedB64}.${signature}`;

  const result = await verifyGamesTicket(tamperedTicket, TEST_SECRET);
  assert.equal(result.valid, false);
  assert.match(result.error, /signature/i);
});

test('Cloudflare Verifier: modified signature fails verification', async () => {
  const user = { studentId: 'student_test', name: 'User' };
  const ticket = createGamesTicket(user, TEST_SECRET);
  const [version, payloadB64, signature] = ticket.split('.');

  const corruptedSig = signature.slice(0, -2) + (signature.endsWith('a') ? 'b' : 'a');
  const corruptedTicket = `${version}.${payloadB64}.${corruptedSig}`;

  const result = await verifyGamesTicket(corruptedTicket, TEST_SECRET);
  assert.equal(result.valid, false);
  assert.match(result.error, /signature/i);
});

test('Cloudflare Verifier: expired ticket fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const expiredPayload = {
    v: 1,
    sub: 'student_expired',
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now - 600,
    exp: now - 300, // Expired 5 minutes ago (well past 30s clock skew)
    jti: 'ticket_id_expired',
  };

  const ticket = buildCustomTicket(expiredPayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /expired/i);
});

test('Cloudflare Verifier: wrong issuer fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const badIssuerPayload = {
    v: 1,
    sub: 'student_123',
    iss: 'untrusted-issuer',
    aud: 'semester-games',
    iat: now,
    exp: now + 300,
    jti: 'ticket_id_1',
  };

  const ticket = buildCustomTicket(badIssuerPayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /issuer/i);
});

test('Cloudflare Verifier: wrong audience fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const badAudiencePayload = {
    v: 1,
    sub: 'student_123',
    iss: 'semester-library',
    aud: 'some-other-service',
    iat: now,
    exp: now + 300,
    jti: 'ticket_id_2',
  };

  const ticket = buildCustomTicket(badAudiencePayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /audience/i);
});

test('Cloudflare Verifier: wrong version prefix or payload v fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: 'student_123',
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now,
    exp: now + 300,
    jti: 'ticket_id_3',
  };

  // Wrong prefix (e.g. v2)
  const ticketV2 = buildCustomTicket(payload, TEST_SECRET, 'v2');
  const res1 = await verifyGamesTicket(ticketV2, TEST_SECRET);
  assert.equal(res1.valid, false);
  assert.match(res1.error, /version/i);

  // Wrong payload version (v: 2)
  const ticketPayloadV2 = buildCustomTicket({ ...payload, v: 2 });
  const res2 = await verifyGamesTicket(ticketPayloadV2, TEST_SECRET);
  assert.equal(res2.valid, false);
  assert.match(res2.error, /version/i);
});

test('Cloudflare Verifier: malformed base64 or payload fails verification', async () => {
  const res1 = await verifyGamesTicket('v1.invalid_base64_!@#$.sig', TEST_SECRET);
  assert.equal(res1.valid, false);

  const res2 = await verifyGamesTicket('v1.not_enough_parts', TEST_SECRET);
  assert.equal(res2.valid, false);

  const res3 = await verifyGamesTicket(12345, TEST_SECRET);
  assert.equal(res3.valid, false);
});

test('Cloudflare Verifier: missing or empty sub fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const noSubPayload = {
    v: 1,
    sub: '   ',
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now,
    exp: now + 300,
    jti: 'ticket_id_4',
  };

  const ticket = buildCustomTicket(noSubPayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /sub/i);
});

test('Cloudflare Verifier: missing or empty jti fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const noJtiPayload = {
    v: 1,
    sub: 'student_123',
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now,
    exp: now + 300,
    jti: '',
  };

  const ticket = buildCustomTicket(noJtiPayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /jti/i);
});

test('Cloudflare Verifier: lifetime greater than 300 seconds fails verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const longLifetimePayload = {
    v: 1,
    sub: 'student_123',
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now,
    exp: now + 600, // 10 minutes (exceeds 300s limit)
    jti: 'ticket_id_5',
  };

  const ticket = buildCustomTicket(longLifetimePayload);
  const result = await verifyGamesTicket(ticket, TEST_SECRET);

  assert.equal(result.valid, false);
  assert.match(result.error, /lifetime/i);
});

test('Cloudflare Verifier: weak secret fails closed', async () => {
  const user = { studentId: 'student_123', name: 'User' };
  const ticket = createGamesTicket(user, TEST_SECRET);

  const res1 = await verifyGamesTicket(ticket, 'short');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /secret/i);

  const res2 = await verifyGamesTicket(ticket, '');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /secret/i);
});
