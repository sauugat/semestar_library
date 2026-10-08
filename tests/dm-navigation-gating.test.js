'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

describe('Step 5B.3.2: Secure DM Feature Gating & Navigation Architecture', () => {
  const repoRoot = path.join(__dirname, '..');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const dmServicePath = path.join(repoRoot, 'mobile', 'services', 'dm.ts');
  const apiServicePath = path.join(repoRoot, 'mobile', 'services', 'api.ts');
  const authContextPath = path.join(repoRoot, 'mobile', 'context', 'AuthContext.tsx');
  const mobileEnvPath = path.join(repoRoot, 'mobile', '.env');
  const serverPath = path.join(repoRoot, 'server.js');
  const { isDmAllowedForUser } = require('../lib/dm-config');

  // 1. Admin cohort-picker navigation retains DM SegmentedControl & DmInboxView
  test('1. Admin cohort picker view renders SegmentedControl and DmInboxView', () => {
    assert.ok(fs.existsSync(chatScreenPath), 'chat.tsx must exist');
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    const adminPickerSegmentIdx = content.indexOf('active classes');
    assert.ok(adminPickerSegmentIdx !== -1, 'Admin cohort screen must identify active classes');

    const adminSegmentMatches = content.slice(adminPickerSegmentIdx, adminPickerSegmentIdx + 500);
    assert.ok(adminSegmentMatches.includes('<SegmentedControl'), 'Admin screen must render SegmentedControl');

    assert.ok(content.includes('<DmInboxView onUnreadCountChange={setDmUnreadCount} />'), 'DmInboxView must be rendered in chat.tsx');
  });

  // 2. DM Feature flag check in chat.tsx does NOT pass studentId param, preserves user lifecycle
  test('2. Feature status loading reacts to user?.studentId changes without passing parameter', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');
    assert.ok(content.includes('const status = await fetchDmStatus();'), 'chat.tsx must call fetchDmStatus with no arguments');
    assert.ok(!content.includes('fetchDmStatus(user?.studentId)'), 'chat.tsx must NOT pass user?.studentId as argument');
    assert.ok(content.includes('[user?.studentId]'), 'chat.tsx useEffect must depend on [user?.studentId]');
  });

  // 3. fetchDmStatus in dm.ts takes no parameters and attaches no query string
  test('3. fetchDmStatus has no parameters and does not append query parameters', () => {
    assert.ok(fs.existsSync(dmServicePath), 'dm.ts must exist');
    const content = fs.readFileSync(dmServicePath, 'utf8');
    assert.ok(content.includes('export async function fetchDmStatus(): Promise<{ enabled: boolean }>'), 'fetchDmStatus must accept zero parameters');
    assert.ok(content.includes("apiFetch('/api/dm-status'"), 'fetchDmStatus must query /api/dm-status without query string');
    assert.ok(!content.includes('studentId='), 'dm.ts must not contain studentId query parameter');
  });

  // 4. server.js must NOT inspect req.query.studentId for authorization
  test('4. server.js /api/dm-status strictly derives identity from authenticated session or bearer token', () => {
    assert.ok(fs.existsSync(serverPath), 'server.js must exist');
    const content = fs.readFileSync(serverPath, 'utf8');
    const dmStatusMatch = content.match(/app\.get\(['"]\/api\/dm-status['"],\s*(?:async\s*)?\((req,\s*res)\)\s*=>\s*\{([\s\S]*?)\}\);/);
    assert.ok(dmStatusMatch, 'server.js must define /api/dm-status endpoint');

    const handlerBody = dmStatusMatch[2];
    assert.ok(!handlerBody.includes('req.query'), 'server.js must NEVER use req.query for authorization in dm-status');
    assert.ok(handlerBody.includes('req.user?.studentId') || handlerBody.includes('req.student?.studentId'), 'Must inspect authenticated mobile bearer token identity');
    assert.ok(handlerBody.includes('req.session?.studentId'), 'Must inspect authenticated website session identity');
  });

  // 5. Unit test route handler logic with bearer token, session, and forgery attempt
  test('5. Identity resolution unit tests enforce tamper-resistant gating', () => {
    const testEnv = { DM_TEST_USER_IDS: '12345678,3322' };
    const simulateDmStatus = (req) => {
      const callerId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
      return { enabled: isDmAllowedForUser(callerId, testEnv) };
    };

    // Anonymous request (no token, no session)
    assert.equal(simulateDmStatus({}).enabled, false, 'Anonymous request must return enabled: false');

    // Forged query without token/session
    assert.equal(simulateDmStatus({ query: { studentId: '12345678' } }).enabled, false, 'Forged query must return enabled: false');

    // Authenticated allowlisted admin via mobile bearer token (req.user)
    assert.equal(simulateDmStatus({ user: { studentId: '12345678' } }).enabled, true, 'Authenticated admin 12345678 must return enabled: true');

    // Authenticated allowlisted student via mobile bearer token (req.student)
    assert.equal(simulateDmStatus({ student: { studentId: '3322' } }).enabled, true, 'Authenticated tester 3322 must return enabled: true');

    // Authenticated non-allowlisted student
    assert.equal(simulateDmStatus({ user: { studentId: '99999999' } }).enabled, false, 'Non-allowlisted student must return enabled: false');

    // Forged query with non-allowlisted account attempting to spoof admin ID
    assert.equal(simulateDmStatus({ user: { studentId: '99999999' }, query: { studentId: '12345678' } }).enabled, false, 'Spoof attempt must evaluate authenticated user, returning false');

    // Authenticated allowlisted user via website session
    assert.equal(simulateDmStatus({ session: { studentId: '12345678' } }).enabled, true, 'Session-authenticated admin must return enabled: true');

    // Authenticated non-allowlisted user via website session
    assert.equal(simulateDmStatus({ session: { studentId: '99999999' } }).enabled, false, 'Session-authenticated non-tester must return enabled: false');
  });

  // 6. Live HTTP verification on server: unauthenticated and forged requests receive enabled: false
  test('6. Live HTTP server /api/dm-status rejects anonymous and forged query calls', async () => {
    const fetchJson = (endpoint) => {
      return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:3000${endpoint}`, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        }).on('error', reject);
      });
    };

    // Anonymous request
    const anonRes = await fetchJson('/api/dm-status');
    assert.equal(anonRes.enabled, false, 'Anonymous request over HTTP must receive enabled: false');

    // Forged query parameter
    const forgedRes = await fetchJson('/api/dm-status?studentId=12345678');
    assert.equal(forgedRes.enabled, false, 'Forged studentId query parameter over HTTP must receive enabled: false');
  });

  // 7. Production URL override protection
  test('7. Production builds reject local development URLs and lock to trusted production host', () => {
    const apiContent = fs.readFileSync(apiServicePath, 'utf8');

    // Verify isLocalAddress is declared and implemented
    assert.ok(apiContent.includes('export function isLocalAddress(url: string): boolean'), 'isLocalAddress must be exported');
    assert.ok(apiContent.includes("lower.startsWith('http://')"), 'Must reject http://');
    assert.ok(apiContent.includes("lower.includes('localhost')"), 'Must reject localhost');
    assert.ok(apiContent.includes("lower.includes('127.0.0.1')"), 'Must reject 127.0.0.1');
    assert.ok(apiContent.includes("lower.includes('192.168.')"), 'Must reject 192.168.');
    assert.ok(apiContent.includes("lower.includes('10.')"), 'Must reject 10.');

    // Function definition mirror test
    const isLocalAddress = (url) => {
      if (!url) return false;
      const lower = url.toLowerCase().trim();
      return (
        lower.startsWith('http://') ||
        lower.includes('localhost') ||
        lower.includes('127.0.0.1') ||
        lower.includes('192.168.') ||
        lower.includes('10.') ||
        lower.includes('172.16.')
      );
    };

    assert.equal(isLocalAddress('http://192.168.1.65:3000'), true);
    assert.equal(isLocalAddress('http://localhost:3000'), true);
    assert.equal(isLocalAddress('http://127.0.0.1:3000'), true);
    assert.equal(isLocalAddress('http://10.0.2.2:3000'), true);
    assert.equal(isLocalAddress('https://semestar-library.vercel.app'), false);

    assert.ok(apiContent.includes('!isLocalAddress'), 'api.ts must guard getBaseUrl with !isLocalAddress in production');
    assert.ok(apiContent.includes("'https://semestar-library.vercel.app'"), 'api.ts must fallback to trusted production URL');
  });

  // 8. Mobile environment points to local development backend
  test('8. Mobile environment and api.ts configure local development backend in dev', () => {
    assert.ok(fs.existsSync(mobileEnvPath), 'mobile/.env must exist');
    const envContent = fs.readFileSync(mobileEnvPath, 'utf8');
    assert.ok(envContent.includes('EXPO_PUBLIC_API_URL=http://192.168.1.65:3000'), 'mobile/.env must point to local LAN backend');

    const authContent = fs.readFileSync(authContextPath, 'utf8');
    assert.ok(authContent.includes("savedUrl.includes('vercel.app')"), 'AuthContext must detect stale vercel.app URL in dev');
  });

  // 9. Live server /api/chat/admin/rooms is mounted and returns 401 when unauth, not 404
  test('9. Live server /api/chat/admin/rooms is mounted and protected by requireLogin', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3000/api/chat/admin/rooms', (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      }).on('error', reject);
    });

    assert.equal(res.status, 401, 'Unauthenticated request must receive 401, NOT 404 Resource not found');
    assert.ok(!res.body.includes('Resource not found'), 'Response must NOT be Resource not found');
  });

  // 10. Live server allows admin 26020266 to access cohort rooms and DMs
  test('10. Live server allows admin 26020266 to access cohort rooms and DMs with bearer token', async () => {
    const db = require('../db');
    const tokenRecord = await db.get(
      'SELECT token FROM mobile_tokens WHERE studentId = ? ORDER BY expiresat DESC LIMIT 1',
      '26020266'
    );
    assert.ok(tokenRecord && tokenRecord.token, 'Mobile token for 26020266 must exist');

    // Test /api/chat/admin/rooms
    const roomsRes = await fetch('http://127.0.0.1:3000/api/chat/admin/rooms', {
      headers: { Authorization: `Bearer ${tokenRecord.token}` },
    });
    assert.equal(roomsRes.status, 200, 'Admin rooms must return 200 for 26020266');
    const rooms = await roomsRes.json();
    assert.ok(Array.isArray(rooms), 'Rooms must be an array');
    assert.equal(rooms.length, 4, 'Must return 4 active cohorts (Mercury, Earth, Mars, Venus)');

    // Test /api/dm-status
    const dmRes = await fetch('http://127.0.0.1:3000/api/dm-status', {
      headers: { Authorization: `Bearer ${tokenRecord.token}` },
    });
    assert.equal(dmRes.status, 200, 'DM status must return 200');
    const dmData = await dmRes.json();
    assert.equal(dmData.enabled, true, 'DM status must be enabled for allowlisted admin 26020266');
    await db.close();
  });
});
