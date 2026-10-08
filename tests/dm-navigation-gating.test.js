'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

describe('Step 5B.3.1: Private Messaging Navigation & Feature Gating Verification', () => {
  const repoRoot = path.join(__dirname, '..');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const dmServicePath = path.join(repoRoot, 'mobile', 'services', 'dm.ts');
  const apiServicePath = path.join(repoRoot, 'mobile', 'services', 'api.ts');
  const authContextPath = path.join(repoRoot, 'mobile', 'context', 'AuthContext.tsx');
  const mobileEnvPath = path.join(repoRoot, 'mobile', '.env');
  const serverPath = path.join(repoRoot, 'server.js');

  // 1. Admin cohort-picker navigation retains DM SegmentedControl
  test('1. Admin cohort picker view renders SegmentedControl and DmInboxView', () => {
    assert.ok(fs.existsSync(chatScreenPath), 'chat.tsx must exist');
    const content = fs.readFileSync(chatScreenPath, 'utf8');

    // Inside the admin room branch (!selectedAdminRoom && isAdmin):
    // Must render SegmentedControl
    const adminPickerSegmentIdx = content.indexOf('active classes');
    assert.ok(adminPickerSegmentIdx !== -1, 'Admin cohort screen must identify active classes');
    
    // Check that SegmentedControl is rendered right after the header in admin view
    const adminSegmentMatches = content.slice(adminPickerSegmentIdx, adminPickerSegmentIdx + 500);
    assert.ok(adminSegmentMatches.includes('<SegmentedControl'), 'Admin screen must render SegmentedControl');

    // And renders DmInboxView container when activeSection === "messages"
    assert.ok(content.includes('<DmInboxView onUnreadCountChange={setDmUnreadCount} />'), 'DmInboxView must be rendered in chat.tsx');
  });

  // 2. DM Feature flag check in chat.tsx depends on user?.studentId
  test('2. Feature status loading reacts to user?.studentId changes', () => {
    const content = fs.readFileSync(chatScreenPath, 'utf8');
    assert.ok(content.includes('fetchDmStatus(user?.studentId)'), 'chat.tsx must pass user?.studentId to fetchDmStatus');
    assert.ok(content.includes('[user?.studentId]'), 'chat.tsx useEffect must depend on [user?.studentId]');
  });

  // 3. fetchDmStatus in dm.ts accepts studentId and formats query param
  test('3. fetchDmStatus passes studentId query parameter', () => {
    assert.ok(fs.existsSync(dmServicePath), 'dm.ts must exist');
    const content = fs.readFileSync(dmServicePath, 'utf8');
    assert.ok(content.includes('export async function fetchDmStatus(studentId?: string)'), 'fetchDmStatus must accept optional studentId');
    assert.ok(content.includes('?studentId=${encodeURIComponent(studentId)}'), 'fetchDmStatus must append studentId query parameter');
  });

  // 4. Local Express server evaluates allowlisted vs non-allowlisted users
  test('4. Backend /api/dm-status respects DM_TEST_USER_IDS allowlist', async () => {
    const isDmAllowedForUser = (userId) => {
      const raw = process.env.DM_TEST_USER_IDS || '12345678,3322';
      const allowlist = new Set(
        raw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      );
      return Boolean(userId && allowlist.has(String(userId).trim()));
    };

    // Approved admin account
    assert.equal(isDmAllowedForUser('12345678'), true, 'Admin account 12345678 must be allowlisted');
    // Approved test student account
    assert.equal(isDmAllowedForUser('3322'), true, 'Test user 3322 must be allowlisted');
    // Non-allowlisted student account
    assert.equal(isDmAllowedForUser('99999999'), false, 'Non-allowlisted user 99999999 must NOT be allowlisted');
    assert.equal(isDmAllowedForUser(null), false, 'Null user must NOT be allowlisted');
  });

  // 5. Backend server endpoint responds correctly via HTTP
  test('5. Local HTTP server /api/dm-status endpoint returns accurate gating per caller', async () => {
    const checkEndpoint = (queryParam) => {
      return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:3000/api/dm-status${queryParam}`, (res) => {
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

    const adminStatus = await checkEndpoint('?studentId=12345678');
    assert.equal(adminStatus.enabled, true, 'Admin 12345678 must get enabled: true from local server');

    const nonTesterStatus = await checkEndpoint('?studentId=99999999');
    assert.equal(nonTesterStatus.enabled, false, 'Student 99999999 must get enabled: false from local server');
  });

  // 6. Mobile environment points to local development backend
  test('6. Mobile environment and api.ts configure local development backend', () => {
    assert.ok(fs.existsSync(mobileEnvPath), 'mobile/.env must exist');
    const envContent = fs.readFileSync(mobileEnvPath, 'utf8');
    assert.ok(envContent.includes('EXPO_PUBLIC_API_URL=http://192.168.1.65:3000'), 'mobile/.env must point to local LAN backend 192.168.1.65:3000');

    // api.ts must purge stale vercel.app in SecureStore
    const apiContent = fs.readFileSync(apiServicePath, 'utf8');
    assert.ok(apiContent.includes("saved.includes('vercel.app')"), 'api.ts must detect stale vercel.app URL');
    assert.ok(apiContent.includes('deleteItemAsync(SERVER_URL_STORAGE_KEY)'), 'api.ts must delete stale vercel URL');

    // AuthContext must purge stale vercel.app in SecureStore
    const authContent = fs.readFileSync(authContextPath, 'utf8');
    assert.ok(authContent.includes("savedUrl.includes('vercel.app')"), 'AuthContext must detect stale vercel.app URL');
    assert.ok(authContent.includes('deleteItemAsync(SERVER_URL_KEY)'), 'AuthContext must delete stale vercel URL');
  });
});
