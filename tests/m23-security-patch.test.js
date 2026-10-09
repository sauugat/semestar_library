'use strict';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const { createDmService } = require('../lib/dm-service');
const dmRoutes = require('../routes/direct-messaging');

function createMockDb() {
  const students = new Map();
  const tokens = new Map();
  const blocks = new Set();
  const conversations = new Map();
  const participants = new Map();

  return {
    isPostgres: false,
    students,
    tokens,
    blocks,
    conversations,
    participants,
    async get(sql, ...params) {
      if (sql.includes('FROM mobile_tokens m') && sql.includes('LEFT JOIN students s')) {
        const token = params[0];
        const tok = tokens.get(token);
        if (!tok) return null;
        const stu = students.get(tok.studentId) || {};
        return {
          token: tok.token,
          studentId: tok.studentId,
          expiresAt: tok.expiresAt,
          username: stu.username,
          name: stu.name,
          role: stu.role || 'student',
          department: stu.department || 'BIT',
          semester: stu.semester || 'Semester 1',
          cohort_id: stu.cohort_id || null,
          gender: stu.gender || null,
          email: stu.email || null,
          avatarUrl: stu.avatarUrl || null,
          verification_status: stu.verification_status || 'unverified'
        };
      }
      if (sql.includes('FROM students WHERE studentId = ?')) {
        return students.get(params[0]) || null;
      }
      if (sql.includes('FROM dm_participants p') && sql.includes('JOIN dm_conversations c')) {
        const [cId, sId] = params;
        const conv = conversations.get(cId);
        if (!conv) return null;
        const part = participants.get(`${cId}:${sId}`);
        if (!part) return null;
        const isBlocked = blocks.has(`${conv.user_one_id}:${conv.user_two_id}`) ||
                          blocks.has(`${conv.user_two_id}:${conv.user_one_id}`);
        return {
          student_id: sId,
          conversation_id: cId,
          user_one_id: conv.user_one_id,
          user_two_id: conv.user_two_id,
          realtime_epoch: conv.realtime_epoch || 1,
          is_blocked: isBlocked
        };
      }
      if (sql.includes('FROM dm_rate_limits')) {
        return null;
      }
      if (sql.includes('FROM dm_messages WHERE conversation_id = ? AND client_id = ?')) {
        return null;
      }
      if (sql.includes('FROM student_notification_preferences')) {
        return { push_enabled: true };
      }
      return null;
    },
    async all(sql, ...params) {
      return [];
    },
    async run(sql, ...params) {
      if (sql.includes('DELETE FROM mobile_tokens WHERE token = ?')) {
        tokens.delete(params[0]);
      }
      return { changes: 1 };
    },
    async withTransaction(fn) {
      return fn(this);
    }
  };
}

test('M2.3A Security Audit: Token validation, session safety, and authorization fences', async t => {
  const db = createMockDb();

  // Seed student accounts
  db.students.set('stu_verified', {
    studentId: 'stu_verified',
    name: 'Verified Student',
    role: 'student',
    verification_status: 'verified'
  });
  db.students.set('stu_unverified', {
    studentId: 'stu_unverified',
    name: 'Unverified Student',
    role: 'student',
    verification_status: 'unverified'
  });
  db.students.set('stu_peer', {
    studentId: 'stu_peer',
    name: 'Peer Student',
    role: 'student',
    verification_status: 'verified'
  });

  // Seed tokens
  db.tokens.set('valid_tok', {
    token: 'valid_tok',
    studentId: 'stu_verified',
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  db.tokens.set('unverified_tok', {
    token: 'unverified_tok',
    studentId: 'stu_unverified',
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  db.tokens.set('expired_tok', {
    token: 'expired_tok',
    studentId: 'stu_verified',
    expiresAt: new Date(Date.now() - 1000).toISOString()
  });

  // Setup conversations
  db.conversations.set('conv_1', {
    id: 'conv_1',
    user_one_id: 'stu_verified',
    user_two_id: 'stu_peer',
    realtime_epoch: 1
  });
  db.participants.set('conv_1:stu_verified', { conversation_id: 'conv_1', student_id: 'stu_verified' });
  db.participants.set('conv_1:stu_peer', { conversation_id: 'conv_1', student_id: 'stu_peer' });

  // Express App mirroring hardened server.js
  const app = express();
  app.use(express.json());

  // Session middleware with hardened bypass
  let sessionStoreCalled = false;
  app.use((req, res, next) => {
    const hasSessionCookie = Boolean(req.headers.cookie && req.headers.cookie.includes('__gu_session'));
    const authHeader = req.headers['authorization'];
    if (!hasSessionCookie && authHeader && authHeader.startsWith('Bearer ')) {
      return next();
    }
    // Simulate real session middleware
    sessionStoreCalled = true;
    req.session = {
      studentId: req.headers.cookie?.includes('valid_session_cookie') ? 'stu_verified' : undefined,
      role: 'student'
    };
    next();
  });

  const auth = createAuthMiddleware(db);
  app.use((req, res, next) => {
    auth.authenticate(req, res, next);
  });

  // CSRF Origin Guard matching server.js
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      if (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')) {
        return next();
      }
      const origin = req.headers.origin;
      if (origin && origin !== 'http://localhost:3000') {
        return res.status(403).json({ message: 'Cross-origin request blocked.' });
      }
    }
    next();
  });

  function requireLogin(req, res, next) {
    if (req.user && req.user.studentId) {
      req.student = req.user;
      return next();
    }
    if (req.session && req.session.studentId) {
      req.student = { studentId: req.session.studentId, role: req.session.role };
      return next();
    }
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const dmService = createDmService(db);
  app.use('/api/dm', requireLogin, dmRoutes(dmService));

  app.get('/api/test/protected', requireLogin, (req, res) => {
    res.json({ ok: true, studentId: req.student.studentId, role: req.student.role });
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => server.close());

  await t.test('1. Malformed or invalid Bearer token is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/test/protected`, {
      headers: { 'Authorization': 'Bearer bad_malformed_token_123' }
    });
    assert.equal(res.status, 401);
  });

  await t.test('2. Expired token is rejected with 401 and pruned from database', async () => {
    const res = await fetch(`${baseUrl}/api/test/protected`, {
      headers: { 'Authorization': 'Bearer expired_tok' }
    });
    assert.equal(res.status, 401);
    assert.equal(db.tokens.has('expired_tok'), false, 'Expired token must be pruned');
  });

  await t.test('3. Merely supplying ?token= does NOT grant authenticated access', async () => {
    const res = await fetch(`${baseUrl}/api/test/protected?token=random_attacker_token`);
    assert.equal(res.status, 401);
  });

  await t.test('4. Browser session cookie continues working even if ?token= query parameter is present', async () => {
    sessionStoreCalled = false;
    const res = await fetch(`${baseUrl}/api/test/protected?token=some_query_param`, {
      headers: { 'Cookie': '__gu_session=valid_session_cookie' }
    });
    assert.equal(res.status, 200);
    assert.equal(sessionStoreCalled, true, 'Session middleware must execute when cookie is present');
    const data = await res.json();
    assert.equal(data.studentId, 'stu_verified');
  });

  await t.test('5. Stateless Bearer request bypasses session store execution', async () => {
    sessionStoreCalled = false;
    const res = await fetch(`${baseUrl}/api/test/protected`, {
      headers: { 'Authorization': 'Bearer valid_tok' }
    });
    assert.equal(res.status, 200);
    assert.equal(sessionStoreCalled, false, 'Stateless Bearer request must bypass session store');
  });

  await t.test('6. Unverified account is rejected from sending DM (403)', async () => {
    const res = await fetch(`${baseUrl}/api/dm/conversations/conv_1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer unverified_tok',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clientId: 'msg_1', text: 'Hello' })
    });
    assert.equal(res.status, 403, 'Unverified accounts must be rejected from messaging');
    const err = await res.json();
    assert.match(err.message, /Account verification required/i);
  });

  await t.test('7. Blocked users cannot send messages (403)', async () => {
    // Add block
    db.blocks.add('stu_peer:stu_verified');

    const res = await fetch(`${baseUrl}/api/dm/conversations/conv_1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid_tok',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clientId: 'msg_2', text: 'Blocked message' })
    });
    assert.equal(res.status, 403, 'Blocked conversation must reject send');
    const err = await res.json();
    assert.match(err.message, /Cannot send messages to this user/i);

    // Clean up
    db.blocks.delete('stu_peer:stu_verified');
  });

  await t.test('8. Concurrent account suspension immediately rejects next request (401)', async () => {
    // Suspend student
    db.students.get('stu_verified').role = 'suspended';

    const res = await fetch(`${baseUrl}/api/dm/conversations/conv_1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid_tok',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clientId: 'msg_3', text: 'After suspension' })
    });
    assert.equal(res.status, 401, 'Suspended account must be rejected immediately');

    // Restore student
    db.students.get('stu_verified').role = 'student';
  });

  await t.test('9. CSRF origin check blocks cross-origin POST without Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/test/protected`, {
      method: 'POST',
      headers: {
        'Cookie': '__gu_session=valid_session_cookie',
        'Origin': 'https://evil-attacker.com'
      }
    });
    assert.equal(res.status, 403, 'Cross-origin browser request must be blocked by CSRF guard');
  });
});
