const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');

test('Push Notification API Endpoints (Phase A)', async (t) => {
  await db.initSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
  });

  const testStudentId = 'API-STUDENT-' + Date.now();
  if (db.isPostgres) {
    await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', testStudentId, 'API Student', 'student', 'test_password_hash');
  } else {
    await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', testStudentId, 'API Student', 'student', 'test_password_hash');
  }

  // Create mock mobile token to authenticate via requireLogin
  const testToken = 'api_token_' + Date.now();
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    testToken, testStudentId, new Date().toISOString(), expiresAt
  );

  const authHeaders = {
    'Authorization': `Bearer ${testToken}`,
    'Content-Type': 'application/json',
  };

  const sampleToken = `ExponentPushToken[api_test_${Date.now()}]`;

  await t.test('POST /api/notifications/device-token registers token under authenticated user', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/device-token`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        expoPushToken: sampleToken,
        platform: 'ios',
        deviceName: 'Test iPhone',
        // Client attempt to spoof another student ID must be ignored
        studentId: 'HACKED-STUDENT-ID',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Verify in DB that it is registered to testStudentId, NOT HACKED-STUDENT-ID
    const row = await db.get('SELECT student_id, platform, device_name FROM student_device_tokens WHERE expo_push_token = ?', sampleToken);
    assert.equal(row.student_id, testStudentId);
    assert.equal(row.platform, 'ios');
    assert.equal(row.device_name, 'Test iPhone');
  });

  await t.test('GET /api/notifications/preferences returns preferences', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'GET',
      headers: authHeaders,
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(typeof data.preferences.muteChat, 'boolean');
    assert.equal(typeof data.preferences.notifyNotes, 'boolean');
  });

  await t.test('PUT /api/notifications/preferences updates preferences', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        muteChat: true,
        notifyNotes: false,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.preferences.muteChat, true);
    assert.equal(data.preferences.notifyNotes, false);
  });

  await t.test('DELETE /api/notifications/device-token unregisters device token', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/device-token`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({
        expoPushToken: sampleToken,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    const check = await db.get('SELECT * FROM student_device_tokens WHERE expo_push_token = ?', sampleToken);
    assert.equal(check, null);
  });

  await t.test('Internal worker endpoints require valid cron authorization in production mode', async () => {
    // When CRON_SECRET is set, unauthorized requests should return 401
    process.env.CRON_SECRET = 'super-secret-cron-key-123';

    const unauthRes = await fetch(`${baseUrl}/api/internal/push/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(unauthRes.status, 401);

    const authRes = await fetch(`${baseUrl}/api/internal/push/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer super-secret-cron-key-123',
      },
    });
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.success, true);

    delete process.env.CRON_SECRET;
  });
});
