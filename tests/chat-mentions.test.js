const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Chat @Mentions — Full Integration Test Suite', async (t) => {
  // Disable immediate synchronous dispatch to test outbox state in isolation
  process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';
  t.after(() => { delete process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH; });

  await db.initSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ts = Date.now();
  const senderA = `MENTION_A_${ts}`;
  const studentB = `MENTION_B_${ts}`;
  const studentC = `MENTION_C_${ts}`;
  const studentD = `MENTION_D_${ts}`;
  const studentOutside = `MENTION_OUTSIDE_${ts}`;
  const allIds = [senderA, studentB, studentC, studentD, studentOutside];
  const usernameA = `alice_${ts}`;
  const usernameB = `bob_${ts}`;
  const usernameC = `charlie_${ts}`;
  const usernameOutside = `outside_${ts}`;

  // Seed test students
  for (const s of [
    { id: senderA,        name: 'Alice Sender',   username: usernameA,       role: 'student', department: 'BIT' },
    { id: studentB,       name: 'Bob Receiver',   username: usernameB,       role: 'student', department: 'BIT' },
    { id: studentC,       name: 'Charlie Other',  username: usernameC,       role: 'student', department: 'BIT' },
    { id: studentD,       name: 'Diana Quiet',    username: null,            role: 'student', department: 'BIT' },
    { id: studentOutside, name: 'Oscar Outside',  username: usernameOutside, role: 'student', department: 'BBA' },
  ]) {
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO students (studentId, name, username, role, department, passwordHash) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (studentId) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, department = EXCLUDED.department, role = EXCLUDED.role`,
        s.id, s.name, s.username, s.role, s.department, 'test_hash'
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO students (studentId, name, username, role, department, passwordHash) VALUES (?, ?, ?, ?, ?, ?)',
        s.id, s.name, s.username, s.role, s.department, 'test_hash'
      );
    }
  }

  // Generate mobile bearer tokens
  const tokens = {};
  for (const id of allIds) {
    const token = `tok_mention_${id}_${Date.now()}`;
    tokens[id] = token;
    await db.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, id, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()
    );
  }

  // Register device tokens for B and C (not D — D has no device)
  await push.registerDeviceToken(db, {
    studentId: studentB,
    expoPushToken: `ExponentPushToken[mention_b_${ts}]`,
    platform: 'android'
  });
  await push.registerDeviceToken(db, {
    studentId: studentC,
    expoPushToken: `ExponentPushToken[mention_c_${ts}]`,
    platform: 'android'
  });

  // Helper: make authenticated request
  async function apiRequest(method, path, token, body = null) {
    const url = `${baseUrl}${path}`;
    const headers = { 'Authorization': `Bearer ${token}` };
    const opts = { method, headers };

    if (body && method !== 'GET') {
      if (typeof body === 'string' || body instanceof Buffer) {
        opts.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }

    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    return { status: res.status, json, text };
  }

  // Helper: POST chat message with mentions via form data or JSON
  async function sendMessage(senderToken, text, mentions = []) {
    const url = `${baseUrl}/api/chat/messages`;
    const headers = {
      'Authorization': `Bearer ${senderToken}`,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ text, mentions: JSON.stringify(mentions) });
    const res = await fetch(url, { method: 'POST', headers, body });
    const json = await res.json();
    return { status: res.status, json };
  }

  // ─── SCHEMA TESTS ───
  await t.test('S1: chat_message_mentions table exists', async () => {
    // Attempt a trivial query — if table doesn't exist, it throws
    const rows = await db.all('SELECT COUNT(*) AS c FROM chat_message_mentions');
    assert.ok(rows, 'Table query should succeed');
  });

  // ─── AUTOCOMPLETE TESTS ───
  await t.test('AC1: Autocomplete returns matching students by name', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/mentions/students?q=bob', tokens[senderA]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.students), 'Response should have students array');
    const bobMatch = json.students.find(s => s.studentId === studentB);
    assert.ok(bobMatch, 'Should find Bob by name search');
    assert.equal(bobMatch.name, 'Bob Receiver');
    assert.equal(bobMatch.avatarUrl, null);
  });

  await t.test('AC2: Autocomplete returns matching students by username', async () => {
    const { status, json } = await apiRequest('GET', `/api/chat/mentions/students?q=${usernameC}`, tokens[senderA]);
    assert.equal(status, 200);
    const match = json.students.find(s => s.studentId === studentC);
    assert.ok(match, 'Should find Charlie by username search');
  });

  await t.test('AC3: Autocomplete excludes the requesting user', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/mentions/students?q=alice', tokens[senderA]);
    assert.equal(status, 200);
    const selfMatch = json.students.find(s => s.studentId === senderA);
    assert.equal(selfMatch, undefined, 'Should NOT return the requesting user');
  });

  await t.test('AC4: Autocomplete returns empty for no match', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/mentions/students?q=zzzznonexistent', tokens[senderA]);
    assert.equal(status, 200);
    assert.equal(json.students.length, 0);
  });

  await t.test('AC5: Autocomplete returns empty for empty query', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/mentions/students?q=', tokens[senderA]);
    assert.equal(status, 200);
    assert.equal(json.students.length, 0);
  });

  await t.test('AC6: Autocomplete only returns safe fields', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/mentions/students?q=bob', tokens[senderA]);
    assert.equal(status, 200);
    const bob = json.students.find(s => s.studentId === studentB);
    assert.ok(bob);
    // Must have these safe fields
    assert.ok('studentId' in bob);
    assert.ok('name' in bob);
    assert.ok('avatarUrl' in bob);
    // Must NOT have sensitive fields
    assert.equal(bob.email, undefined, 'Should not leak email');
    assert.equal(bob.passwordHash, undefined, 'Should not leak password');
  });

  await t.test('AC7: Autocomplete is case-insensitive', async () => {
    const { json: upper } = await apiRequest('GET', '/api/chat/mentions/students?q=BOB', tokens[senderA]);
    const { json: lower } = await apiRequest('GET', '/api/chat/mentions/students?q=bob', tokens[senderA]);
    assert.ok(upper.students.length > 0, 'Uppercase query should find results');
    assert.ok(lower.students.length > 0, 'Lowercase query should find results');
    assert.equal(upper.students[0].studentId, lower.students[0].studentId, 'Same student found');
  });

  // ─── MESSAGE CREATION WITH MENTIONS ───
  let messageWithMentionId;

  await t.test('MC1: Send message mentioning B — mention records stored', async () => {
    // Clean outbox for isolation
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    const { status, json } = await sendMessage(tokens[senderA], 'Hey @bob check this out!', [studentB]);
    assert.equal(status, 200);
    assert.ok(json.messageId, 'Should return messageId');
    messageWithMentionId = json.messageId;

    // Verify mention record exists in DB
    const mentions = await db.all(
      'SELECT mentioned_student_id FROM chat_message_mentions WHERE message_id = ?',
      messageWithMentionId
    );
    assert.equal(mentions.length, 1, 'Should have exactly 1 mention record');
    const mentionedId = mentions[0].mentionedStudentId || mentions[0].mentioned_student_id;
    assert.equal(mentionedId, studentB, 'Mentioned student should be B');
  });

  await t.test('MC2: Mentions array attached to response data', async () => {
    const { json } = await sendMessage(tokens[senderA], 'Hello @bob @charlie', [studentB, studentC]);
    assert.ok(json.data, 'Response should have data');
    assert.ok(Array.isArray(json.data.mentions), 'data.mentions should be an array');
    assert.equal(json.data.mentions.length, 2, 'Should have 2 mentions');
    assert.ok(json.data.mentions.includes(studentB), 'Should include B');
    assert.ok(json.data.mentions.includes(studentC), 'Should include C');
  });

  await t.test('MC3: Sender self-mention + valid recipient → valid recipient only, safely ignore sender', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Talking to myself @alice and @bob', [senderA, studentB]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.data.mentions));
    assert.ok(!json.data.mentions.includes(senderA), 'Sender should NOT be in mentions');
    assert.ok(json.data.mentions.includes(studentB), 'B should be in mentions');
  });

  await t.test('MC4a: Nonexistent mention ID → rejected with 400', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Ghost mention', ['NONEXISTENT_999']);
    assert.equal(status, 400, 'Nonexistent mention ID must be rejected with 400');
    assert.ok(json.error, 'Response should contain error');
    assert.ok(Array.isArray(json.invalidStudentIds), 'Should return invalidStudentIds array');
    assert.ok(json.invalidStudentIds.includes('NONEXISTENT_999'));
  });

  await t.test('MC4b: Valid student outside eligible group (BBA) → rejected with 400 (OUTSIDE_CHAT_MENTION_TEST)', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Hey outside student', [studentOutside]);
    assert.equal(status, 400, 'Student outside eligible department must be rejected with 400');
    assert.ok(json.error, 'Response should contain error');
    assert.ok(json.invalidStudentIds.includes(studentOutside));

    // Verify in database that NO message, NO mention, and NO outbox was created
    const msgs = await db.all('SELECT id FROM chat_messages WHERE text = ?', 'Hey outside student');
    assert.equal(msgs.length, 0, 'No message row should be created for rejected outside mention');
  });

  await t.test('MC4c: Mix of valid + forged IDs → whole request rejected with 400', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Mixed valid and fake', [studentB, 'FORGED_999']);
    assert.equal(status, 400, 'Mix of valid + forged IDs must reject entire request');
    assert.ok(json.invalidStudentIds.includes('FORGED_999'));

    const msgs = await db.all('SELECT id FROM chat_messages WHERE text = ?', 'Mixed valid and fake');
    assert.equal(msgs.length, 0, 'No partial message should be created');
  });

  await t.test('MC5: Duplicate valid IDs → deduplicated to one mention', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Dupe test @bob @bob', [studentB, studentB, studentB]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.data.mentions));
    assert.equal(json.data.mentions.length, 1, 'Duplicates should be collapsed to 1');

    const mentions = await db.all(
      'SELECT mentioned_student_id FROM chat_message_mentions WHERE message_id = ?',
      json.messageId
    );
    assert.equal(mentions.length, 1, 'DB should have exactly 1 mention record for duplicates');
  });

  await t.test('MC6: Message without mentions works normally (regression)', async () => {
    const { status, json } = await sendMessage(tokens[senderA], 'Just a normal message');
    assert.equal(status, 200);
    assert.ok(json.messageId);
    assert.ok(Array.isArray(json.data.mentions));
    assert.equal(json.data.mentions.length, 0, 'No mentions for plain message');

    const mentions = await db.all(
      'SELECT mentioned_student_id FROM chat_message_mentions WHERE message_id = ?',
      json.messageId
    );
    assert.equal(mentions.length, 0, 'No DB records for plain message');
  });

  // ─── ELIGIBILITY CONSISTENCY TESTS ───
  await t.test('ELIG1: Autocomplete excludes outside chat student', async () => {
    const { status, json } = await apiRequest('GET', `/api/chat/mentions/students?q=${usernameOutside}`, tokens[senderA]);
    assert.equal(status, 200);
    assert.equal(json.students.length, 0, 'Outside student should not appear in autocomplete');
  });

  await t.test('ELIG2: Members list excludes outside chat student', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/members', tokens[senderA]);
    assert.equal(status, 200);
    const outsideMember = json.members.find(m => m.studentId === studentOutside);
    assert.equal(outsideMember, undefined, 'Outside student should not appear in chat members');
  });

  // ─── TRANSACTION ATOMICITY & ROLLBACK TESTS ───
  await t.test('TX1: Injected failure before outbox enqueue rolls back message + mentions + outbox (MENTION_ROLLBACK_TEST)', async () => {
    process.env.TEST_INJECT_CHAT_FAIL = 'before_outbox';
    const testText = `Rollback Test Before Outbox ${Date.now()}`;
    const { status } = await sendMessage(tokens[senderA], testText, [studentB]);
    delete process.env.TEST_INJECT_CHAT_FAIL;

    assert.equal(status, 500, 'Injected failure should cause HTTP 500');

    // Prove rollback: 0 new chat message
    const msgRows = await db.all('SELECT id FROM chat_messages WHERE text = ?', testText);
    assert.equal(msgRows.length, 0, '0 chat message rows should exist after rollback');

    // Prove rollback: 0 mention rows
    const mentionRows = await db.all(
      'SELECT id FROM chat_message_mentions WHERE mentioned_student_id = ? AND message_id NOT IN (SELECT id FROM chat_messages)',
      studentB
    );
    assert.equal(mentionRows.length, 0, '0 orphaned mention rows should exist after rollback');

    // Prove rollback: 0 outbox rows
    const outboxRows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE CAST(payload_json AS TEXT) LIKE ?",
      `%${testText}%`
    );
    assert.equal(outboxRows.length, 0, '0 outbox rows should exist after rollback');
  });

  await t.test('TX2: Injected failure after outbox enqueue rolls back message + mentions + outbox (MENTION_MESSAGE_TRANSACTION)', async () => {
    process.env.TEST_INJECT_CHAT_FAIL = 'after_outbox';
    const testText = `Rollback Test After Outbox ${Date.now()}`;
    const { status } = await sendMessage(tokens[senderA], testText, [studentB]);
    delete process.env.TEST_INJECT_CHAT_FAIL;

    assert.equal(status, 500, 'Injected failure should cause HTTP 500');

    // Prove rollback: 0 new chat message
    const msgRows = await db.all('SELECT id FROM chat_messages WHERE text = ?', testText);
    assert.equal(msgRows.length, 0, '0 chat message rows should exist after rollback');

    // Prove rollback: 0 mention rows
    const mentionRows = await db.all(
      'SELECT id FROM chat_message_mentions WHERE mentioned_student_id = ? AND message_id NOT IN (SELECT id FROM chat_messages)',
      studentB
    );
    assert.equal(mentionRows.length, 0, '0 orphaned mention rows should exist after rollback');

    // Prove rollback: 0 outbox rows
    const outboxRows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE CAST(payload_json AS TEXT) LIKE ?",
      `%${testText}%`
    );
    assert.equal(outboxRows.length, 0, '0 outbox rows should exist after rollback');
  });

  // ─── NOTIFICATION TARGETING ───
  await t.test('NT1: Mention-targeted push → only mentioned student gets outbox entry', async () => {
    // Clean outbox
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    // A mentions B only
    const { json } = await sendMessage(tokens[senderA], 'Hey @bob only you should get this', [studentB]);
    const msgId = json.messageId;

    // Check outbox
    const outboxRows = await db.all(
      "SELECT recipient_student_id, payload_json FROM push_notification_outbox WHERE event_id = ?",
      String(msgId)
    );

    const recipientIds = outboxRows.map(r => r.recipient_student_id);
    assert.ok(recipientIds.includes(studentB), 'B should have outbox entry');
    assert.ok(!recipientIds.includes(studentC), 'C should NOT have outbox entry');
    assert.ok(!recipientIds.includes(senderA), 'Sender A should NOT have outbox entry');
  });

  await t.test('NT2: Mention notification payload says "mentioned you"', async () => {
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    const { json } = await sendMessage(tokens[senderA], 'Check this @bob', [studentB]);
    const msgId = json.messageId;

    const outboxRow = await db.get(
      "SELECT payload_json FROM push_notification_outbox WHERE event_id = ? AND recipient_student_id = ?",
      String(msgId), studentB
    );
    assert.ok(outboxRow, 'Outbox entry should exist for B');

    const payload = typeof outboxRow.payload_json === 'string' ? JSON.parse(outboxRow.payload_json) : outboxRow.payload_json;
    assert.ok(payload.title.includes('mentioned'), 'Title should indicate mention');
    assert.ok(payload.body.includes('mentioned you'), 'Body should indicate mention');
    assert.equal(payload.data.subType, 'mention', 'data.subType should be "mention"');
  });

  await t.test('NT3: No-mention message broadcasts to all (existing behavior preserved)', async () => {
    // Register device for A as well so outbox entries are created
    await push.registerDeviceToken(db, {
      studentId: senderA,
      expoPushToken: `ExponentPushToken[mention_a_${ts}]`,
      platform: 'android'
    });

    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    // B sends a message with NO mentions
    const { json } = await sendMessage(tokens[studentB], 'General broadcast message to everyone');
    const msgId = json.messageId;

    const outboxRows = await db.all(
      "SELECT recipient_student_id, payload_json FROM push_notification_outbox WHERE event_type = 'chat' AND event_id = ?",
      String(msgId)
    );

    const recipientIds = outboxRows.map(r => r.recipient_student_id);
    // Everyone except sender B should get it (those with device tokens: A, C)
    assert.ok(recipientIds.includes(senderA), 'A should get broadcast');
    assert.ok(recipientIds.includes(studentC), 'C should get broadcast');
    assert.ok(!recipientIds.includes(studentB), 'Sender B should NOT get broadcast');

    // Verify it's a normal chat notification, not a mention
    const payload = typeof outboxRows[0].payload_json === 'string'
      ? JSON.parse(outboxRows[0].payload_json)
      : outboxRows[0].payload_json;
    assert.ok(!payload.title.includes('mentioned'), 'Title should NOT say mentioned for broadcast');
    assert.equal(payload.data.subType, 'message', 'data.subType should be "message"');
  });

  await t.test('NT4: Sender cannot receive their own mention notification', async () => {
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    // A mentions A and B — A should be stripped
    const { json } = await sendMessage(tokens[senderA], 'Self-mention @alice @bob', [senderA, studentB]);
    const msgId = json.messageId;

    const outboxRows = await db.all(
      "SELECT recipient_student_id FROM push_notification_outbox WHERE event_id = ?",
      String(msgId)
    );
    const recipientIds = outboxRows.map(r => r.recipient_student_id);
    assert.ok(!recipientIds.includes(senderA), 'Sender should NOT receive mention push');
    assert.ok(recipientIds.includes(studentB), 'B should receive mention push');
  });

  await t.test('NT5: Multiple mentions in one message → each gets exactly one notification', async () => {
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    const { json } = await sendMessage(tokens[senderA], '@bob @charlie both of you', [studentB, studentC]);
    const msgId = json.messageId;

    const outboxRows = await db.all(
      "SELECT recipient_student_id FROM push_notification_outbox WHERE event_id = ?",
      String(msgId)
    );

    const bCount = outboxRows.filter(r => r.recipient_student_id === studentB).length;
    const cCount = outboxRows.filter(r => r.recipient_student_id === studentC).length;
    assert.equal(bCount, 1, 'B should get exactly 1 notification');
    assert.equal(cCount, 1, 'C should get exactly 1 notification');
  });

  // ─── GET MESSAGES RETURNS MENTIONS ───
  await t.test('GM1: GET /api/chat/messages includes mentions array', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/messages?limit=50', tokens[senderA]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.messages));

    // Find the message that has mentions
    const msgWithMention = json.messages.find(m => m.id === messageWithMentionId);
    assert.ok(msgWithMention, 'Should find our mentioned message');
    assert.ok(Array.isArray(msgWithMention.mentions), 'Message should have mentions array');
    assert.ok(msgWithMention.mentions.includes(studentB), 'Mentions should include B');
  });

  await t.test('GM2: Messages without mentions have empty mentions array', async () => {
    const { json } = await apiRequest('GET', '/api/chat/messages?limit=50', tokens[senderA]);
    const plainMsg = json.messages.find(m => m.mentions && m.mentions.length === 0);
    assert.ok(plainMsg, 'Should find a message with empty mentions array');
  });

  // ─── SECURITY TESTS ───
  await t.test('SEC1: Unauthenticated autocomplete request is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/chat/mentions/students?q=bob`);
    assert.ok(res.status === 401 || res.status === 403 || res.status === 302, 'Should reject unauthenticated request');
  });

  await t.test('SEC2: SQL injection in autocomplete is safely handled', async () => {
    const { status, json } = await apiRequest(
      'GET',
      `/api/chat/mentions/students?q=${encodeURIComponent("'; DROP TABLE students; --")}`,
      tokens[senderA]
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.students), 'Should return safe response');
    // Verify students table still exists
    const count = await db.get('SELECT COUNT(*) AS c FROM students');
    assert.ok(Number(count.c) > 0, 'Students table should still exist');
  });

  await t.test('SEC3: Forged mention IDs rejected with 400 (abuse prevention)', async () => {
    const fakeMentions = Array.from({ length: 10 }, (_, i) => `FAKE_${i}`);
    const { status, json } = await sendMessage(tokens[senderA], 'Mass mention test', fakeMentions);
    assert.equal(status, 400, 'Forged mention IDs must be rejected with 400');
    assert.ok(json.error);
    assert.ok(Array.isArray(json.invalidStudentIds));
    assert.equal(json.invalidStudentIds.length, 10);
  });

  // ─── ADDITIONAL INTEGRATION TESTS ───
  await t.test('MEM1: GET /api/chat/members includes username', async () => {
    const { status, json } = await apiRequest('GET', '/api/chat/members', tokens[senderA]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.members));
    const memberB = json.members.find(m => m.studentId === studentB);
    assert.ok(memberB);
    assert.equal(memberB.username, usernameB);
  });

  await t.test('PROF1: GET /api/profile/:username resolves student by username', async () => {
    const { status, json } = await apiRequest('GET', `/api/profile/${usernameB}`, tokens[senderA]);
    assert.equal(status, 200);
    assert.equal(json.studentId, studentB);
    assert.equal(json.name, 'Bob Receiver');
    assert.equal(json.username, usernameB);
  });

  await t.test('ATT1: Message with attachment and mention properly records mentions', async () => {
    await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'MENTION_%'");

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const bodyParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nCheck this doc @bob\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="mentions"\r\n\r\n["${studentB}"]\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="notes.pdf"\r\nContent-Type: application/pdf\r\n\r\nfake-pdf-content\r\n`,
      `--${boundary}--\r\n`
    ];
    const multipartBody = bodyParts.join('');

    const res = await fetch(`${baseUrl}/api/chat/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[senderA]}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.ok(json.messageId);
    assert.ok(Array.isArray(json.data.mentions));
    assert.ok(json.data.mentions.includes(studentB));

    // Verify outbox entry targeted Bob
    const outboxRows = await db.all(
      "SELECT recipient_student_id FROM push_notification_outbox WHERE event_id = ?",
      String(json.messageId)
    );
    const recipientIds = outboxRows.map(r => r.recipient_student_id);
    assert.ok(recipientIds.includes(studentB), 'Bob should receive attachment mention notification');
    assert.ok(!recipientIds.includes(studentC), 'Charlie should NOT receive notification');
  });

  // ─── USERNAME CHANGE & IDENTITY STABILITY ───
  await t.test('UC1: Historical mention preserves student identity after username change (USERNAME_CHANGE_TEST)', async () => {
    // 1. Sender A mentions student B (@bob_ts)
    const { status, json } = await sendMessage(tokens[senderA], 'Hey @bob check this out!', [studentB]);
    assert.equal(status, 200);
    const msgId = json.messageId;

    // Verify structured mention row stores B's studentId and handle
    const mentionRows = await db.all(
      'SELECT message_id, mentioned_student_id, handle FROM chat_message_mentions WHERE message_id = ?',
      msgId
    );
    assert.equal(mentionRows.length, 1);
    const mRow = mentionRows[0];
    const storedSid = mRow.mentionedStudentId || mRow.mentioned_student_id;
    assert.equal(storedSid, studentB, 'Mention record must store immutable studentId');
    assert.equal(mRow.handle, usernameB, 'Mention record stores handle at time of mention');

    // Verify GET /api/chat/messages returns mentionsDetail
    const getRes = await apiRequest('GET', '/api/chat/messages?limit=10', tokens[senderA]);
    assert.equal(getRes.status, 200);
    const sentMsg = getRes.json.messages.find(m => m.id === msgId);
    assert.ok(sentMsg);
    assert.ok(Array.isArray(sentMsg.mentionsDetail), 'Message should have mentionsDetail');
    const directMention = sentMsg.mentionsDetail.find(m => m.studentId === studentB);
    assert.ok(directMention, 'mentionsDetail should link to studentB');
    assert.equal(directMention.handle, usernameB);

    // 2. Student B changes username to @robert_ts
    const newUsernameB = `robert_${ts}`;
    await db.run('UPDATE students SET username = ? WHERE studentId = ?', newUsernameB, studentB);

    // 3. User opens old message and checks resolution
    // The structured mention metadata in the DB still references studentB and original handle
    const getResAfter = await apiRequest('GET', '/api/chat/messages?limit=10', tokens[senderA]);
    const afterMsg = getResAfter.json.messages.find(m => m.id === msgId);
    assert.ok(afterMsg);
    const detailAfter = afterMsg.mentionsDetail.find(m => m.handle === usernameB);
    assert.ok(detailAfter, 'Historical mention still present with original handle in metadata');
    assert.equal(detailAfter.studentId, studentB, 'Historical mention still represents Student B');

    // 4. Resolving profile by immutable studentId loads Bob with his new username
    const profRes = await apiRequest('GET', `/api/profile/${studentB}`, tokens[senderA]);
    assert.equal(profRes.status, 200);
    assert.equal(profRes.json.studentId, studentB);
    assert.equal(profRes.json.username, newUsernameB, 'Profile reflects current username');
  });

  // ─── DEEP-LINK TESTS ───
  await t.test('DL1: Deep link target message routing payload and pagination verification', async () => {
    // 1. Verify notification payload includes targetMessageId / messageId and subType
    const { status, json } = await sendMessage(tokens[senderA], 'Deep link test message @bob', [studentB]);
    assert.equal(status, 200);
    const testMsgId = json.messageId;

    const outboxRow = await db.get(
      "SELECT payload_json FROM push_notification_outbox WHERE event_id = ? AND recipient_student_id = ?",
      String(testMsgId), studentB
    );
    assert.ok(outboxRow);
    const payload = typeof outboxRow.payload_json === 'string' ? JSON.parse(outboxRow.payload_json) : outboxRow.payload_json;
    assert.equal(payload.data.type, 'chat');
    assert.equal(payload.data.subType, 'mention');
    assert.equal(payload.data.messageId, testMsgId);
    assert.equal(payload.data.groupId, 'bit');

    // 2. Pagination test: verify fetching older history by before=<id> retrieves messages outside current window
    const pageRes = await apiRequest('GET', `/api/chat/messages?before=${testMsgId + 1}&limit=1`, tokens[studentB]);
    assert.equal(pageRes.status, 200);
    const found = pageRes.json.messages.some(m => m.id === testMsgId);
    assert.ok(found, 'Message outside first page can be resolved via pagination');
  });

  // ─── MIGRATION & BACKWARD COMPATIBILITY ───
  await t.test('MIG1: Schema migration adds handle column idempotently to legacy table without data loss (MENTION_HANDLE_MIGRATION)', async () => {
    await db.exec('DROP TABLE IF EXISTS test_legacy_mentions_full');
    if (db.isPostgres) {
      await db.exec(`
        CREATE TABLE test_legacy_mentions_full (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL,
          mentioned_student_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, mentioned_student_id)
        );
        CREATE INDEX idx_test_leg_full_msg ON test_legacy_mentions_full(message_id);
        CREATE INDEX idx_test_leg_full_stu ON test_legacy_mentions_full(mentioned_student_id);
      `);
    } else {
      await db.exec(`
        CREATE TABLE test_legacy_mentions_full (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL,
          mentioned_student_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, mentioned_student_id)
        );
        CREATE INDEX idx_test_leg_full_msg ON test_legacy_mentions_full(message_id);
        CREATE INDEX idx_test_leg_full_stu ON test_legacy_mentions_full(mentioned_student_id);
      `);
    }

    await db.run('INSERT INTO test_legacy_mentions_full (message_id, mentioned_student_id) VALUES (?, ?)', 2001, 'legacy_user_1');
    await db.run('INSERT INTO test_legacy_mentions_full (message_id, mentioned_student_id) VALUES (?, ?)', 2001, 'legacy_user_2');

    async function runMigration() {
      if (db.isPostgres) {
        await db.exec('ALTER TABLE test_legacy_mentions_full ADD COLUMN IF NOT EXISTS handle TEXT');
      } else {
        try {
          await db.exec('ALTER TABLE test_legacy_mentions_full ADD COLUMN handle TEXT');
        } catch (err) {
          const msg = (err?.message || '').toLowerCase();
          if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw err;
        }
      }
    }

    await runMigration();
    const rows = await db.all('SELECT message_id, mentioned_student_id, handle FROM test_legacy_mentions_full WHERE message_id = 2001 ORDER BY id ASC');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].mentionedStudentId || rows[0].mentioned_student_id, 'legacy_user_1');
    assert.equal(rows[0].handle, null);

    // Run migration 2nd time (idempotency)
    await runMigration();

    // Verify inserting new row with handle
    await db.run('INSERT INTO test_legacy_mentions_full (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)', 2002, 'legacy_user_3', 'handle_3');
    const row3 = await db.get('SELECT handle FROM test_legacy_mentions_full WHERE message_id = 2002');
    assert.equal(row3.handle, 'handle_3');

    // Verify unique constraint
    let threwUnique = false;
    try {
      await db.run('INSERT INTO test_legacy_mentions_full (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)', 2001, 'legacy_user_1', 'dup');
    } catch (_) {
      threwUnique = true;
    }
    assert.ok(threwUnique, 'UNIQUE constraint preserved');

    // Verify live ensurePushNotificationSchema runs twice safely
    await push.ensurePushNotificationSchema(db);
    await push.ensurePushNotificationSchema(db);

    await db.exec('DROP TABLE IF EXISTS test_legacy_mentions_full');
  });

  await t.test('COMPAT1: Old mention rows with handle = NULL resolve safely without crashing or rendering @undefined (OLD_MENTION_ROW_COMPATIBILITY)', async () => {
    // 1. Insert chat message
    const msgRes = await db.run(
      'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
      senderA, `Testing legacy mention for @${usernameC}`, new Date().toISOString()
    );
    const legacyMsgId = msgRes.lastInsertRowid;

    // 2. Insert legacy mention row directly with handle = NULL
    await db.run(
      'INSERT INTO chat_message_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, NULL)',
      legacyMsgId, studentC
    );

    // 3. Request messages via API
    const res = await apiRequest('GET', `/api/chat/messages?limit=20`, tokens[senderA]);
    assert.equal(res.status, 200);
    const foundMsg = res.json.messages.find(m => m.id === legacyMsgId);
    assert.ok(foundMsg, 'Message must be returned');

    // 4. Verify mentionsDetail tolerates handle = NULL gracefully
    assert.ok(Array.isArray(foundMsg.mentions));
    assert.ok(foundMsg.mentions.includes(studentC), 'Structured studentId must remain authoritative');

    assert.ok(Array.isArray(foundMsg.mentionsDetail));
    assert.equal(foundMsg.mentionsDetail.length, 1);
    const detail = foundMsg.mentionsDetail[0];
    assert.equal(detail.studentId, studentC, 'Authoritative studentId matches');
    assert.equal(detail.handle, usernameC, 'Null handle safely resolved to current student username');
    assert.notEqual(detail.handle, 'undefined');
    assert.notEqual(detail.handle, '@undefined');
    assert.notEqual(detail.handle, null);

    // Cleanup
    await db.run('DELETE FROM chat_message_mentions WHERE message_id = ?', legacyMsgId);
    await db.run('DELETE FROM chat_messages WHERE id = ?', legacyMsgId);
  });

  // ─── CLEANUP ───
  t.after(async () => {
    server.close();
    // Clean up test data
    for (const id of allIds) {
      try {
        await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id = ?", id);
        await db.run("DELETE FROM student_device_tokens WHERE student_id = ?", id);
        await db.run("DELETE FROM mobile_tokens WHERE studentId = ?", id);
        await db.run("DELETE FROM chat_message_mentions WHERE mentioned_student_id = ?", id);
        await db.run("DELETE FROM students WHERE studentId = ?", id);
      } catch (_) {}
    }
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
});
