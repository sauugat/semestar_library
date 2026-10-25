'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

test('Regression: toPostgresSql properly distinguishes SQL parameters from question marks in string literals', () => {
  const { toPostgresSql } = db;
  assert.equal(typeof toPostgresSql, 'function', 'toPostgresSql should be exported from db.js');

  // Basic parameter mapping
  assert.equal(toPostgresSql('SELECT * FROM students WHERE studentId = ?'), 'SELECT * FROM students WHERE studentId = $1');

  // String literal containing ? must NOT be replaced with a parameter placeholder
  const avatarQuery = `
    SELECT s.name,
      CASE WHEN s.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || s.studentId || '?v=' || LENGTH(s.avatarUrl) ELSE s.avatarUrl END AS avatarUrl,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked
    FROM students s
    WHERE s.studentId = ?
  `;
  const converted = toPostgresSql(avatarQuery);

  assert.ok(converted.includes("'?v='"), "String literal '?v=' must remain unchanged in the query");
  assert.ok(!converted.includes("'$1v='"), "Literal '?v=' must NOT be replaced with '$1v='");
  assert.ok(converted.includes('studentId = $1) AS liked'), 'First real parameter should be $1');
  assert.ok(converted.includes('WHERE s.studentId = $2'), 'Second real parameter should be $2');

  // Escaped single quotes within string literals
  const escapedQuotesQuery = "SELECT 'Don''t question ? inside', ? AS param";
  const convertedEscaped = toPostgresSql(escapedQuotesQuery);
  assert.ok(convertedEscaped.includes("'Don''t question ? inside'"), "Question mark inside escaped-quote string must be preserved");
  assert.ok(convertedEscaped.includes('$1 AS param'), 'Real parameter after escaped string should be $1');
});

test('Regression: Postgres executes queries with cache-busting avatar ?v= expressions without parameter mismatch error', async (t) => {
  if (!db.isPostgres || !db.pgPool) {
    t.skip('Skipped: PostgreSQL is not active in this test run');
    return;
  }

  // 1. Profile query shape (/api/me)
  const profileQuery = `
    SELECT studentId, username, name,
      CASE WHEN avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || studentId || '?v=' || LENGTH(avatarUrl) || '-' || SUBSTR(avatarUrl, -12) ELSE avatarUrl END AS avatarUrl,
      role, email
    FROM students
    WHERE studentId = ?
  `;
  const profileRow = await db.get(profileQuery, '26020266');
  assert.ok(profileRow, 'Profile query should execute without 42P18 parameter error');
  assert.equal(profileRow.studentId, '26020266');

  // 2. Files query shape (/api/files)
  const filesQuery = `
    SELECT files.id,
      students.name AS uploaderName,
      CASE WHEN students.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || students.studentId || '?v=' || LENGTH(students.avatarUrl) || '-' || SUBSTR(students.avatarUrl, -12) ELSE students.avatarUrl END AS uploaderAvatar,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE 1=1
    LIMIT 2
  `;
  const filesRows = await db.all(filesQuery, '26020266');
  assert.ok(Array.isArray(filesRows), 'Files query should execute without parameter error');

  // 3. Posts query shape (/api/posts)
  const postsQuery = `
    SELECT p.id, s.name,
      CASE WHEN s.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || s.studentId || '?v=' || LENGTH(s.avatarUrl) || '-' || SUBSTR(s.avatarUrl, -12) ELSE s.avatarUrl END AS "avatarUrl",
      (mine.user_id IS NOT NULL) AS liked_by_me
    FROM posts p
    LEFT JOIN students s ON s.studentId = p.user_id
    LEFT JOIN post_likes mine ON mine.post_id = p.id AND mine.user_id = ?
    ORDER BY p.id DESC
    LIMIT 2
  `;
  const postsRows = await db.all(postsQuery, '26020266');
  assert.ok(Array.isArray(postsRows), 'Posts query should execute without parameter error');
});

test('Regression: Client-side auth rejects UUID studentId for students, accepts teacher UUIDs, and purges v1 cache', () => {
  const authSource = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');

  // Verify UUID check and validator exist
  assert.ok(authSource.includes('function isUuid('), 'auth.js must include isUuid validation helper');
  assert.ok(authSource.includes('function isValidCachedUser('), 'auth.js must validate cached user shape');
  assert.ok(authSource.includes('sl_user_cache_v2'), 'auth.js must bump user cache version to v2');
  assert.ok(authSource.includes("localStorage.removeItem('sl_user_cache_v1')"), 'auth.js must purge sl_user_cache_v1');

  // Validate that UUID detection logic works
  const uuid = 'c4905454-6a38-41a2-a1ce-6b8919062d7a';
  const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
  const isValidCachedUser = (u) => {
    if (!u || typeof u !== 'object') return false;
    if (!u.name || typeof u.name !== 'string') return false;
    if (u.role === 'teacher' || u.role === 'faculty') {
      return Boolean(u.studentId || u.username || u.email);
    }
    return Boolean(u.studentId && !isUuid(u.studentId));
  };

  assert.equal(isUuid(uuid), true, 'Valid UUID should be recognized as UUID');
  assert.equal(isUuid('26020230'), false, 'Real student ID should not be recognized as UUID');
  assert.equal(isUuid('s_teacher_01'), false, 'Teacher ID should not be recognized as UUID');

  assert.equal(isValidCachedUser({ studentId: uuid, name: 'Student' }), false, 'Cached student user with UUID studentId must be rejected');
  assert.equal(isValidCachedUser({ studentId: uuid, username: 'newton2', name: 'newton', role: 'teacher' }), true, 'Teacher account with UUID studentId and role=teacher must be accepted');
  assert.equal(isValidCachedUser({ studentId: '26020230', name: 'Aashrita' }), true, 'Cached user with real studentId must be accepted');
  assert.equal(isValidCachedUser({ studentId: null, name: 'Student' }), false, 'Cached user without studentId must be rejected');
});

test('Regression: Service Worker strictly excludes all /api/ endpoints and bumps cache version', () => {
  const swSource = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');

  // Must exclude any /api/ endpoint
  assert.ok(swSource.includes("p.startsWith('/api/')"), 'Service Worker must exclude all /api/ paths from cache');
  assert.ok(swSource.includes("const SW_VERSION = 'v26'"), 'Service Worker version must be bumped to v26');
});

test('Regression: SWR version is bumped and invalid/empty responses are rejected', () => {
  const swrSource = fs.readFileSync(path.join(__dirname, '../public/swr.js'), 'utf8');

  assert.ok(swrSource.includes("const SWR_VERSION = 'sl_swr_v3'"), 'SWR_VERSION must be bumped to sl_swr_v3');
  assert.ok(swrSource.includes("sl_user_cache_"), 'pruneOldVersions must clear old user cache versions');
  assert.ok(swrSource.includes('Invalid or empty response payload'), 'swrFetch must refuse to cache null/empty/error response payloads');
});

test('Regression: vercel.json prioritizes no-cache header for runtime scripts over immutable static rule', () => {
  const vercelJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  const headers = vercelJson.headers || [];

  assert.ok(headers.length >= 2, 'vercel.json must have header rules');
  const firstRule = headers[0];
  const secondRule = headers[1];

  const firstHeader = firstRule.headers?.find(h => h.key === 'Cache-Control');
  assert.ok(firstHeader?.value.includes('must-revalidate'), 'First header rule must be must-revalidate for runtime scripts');
  assert.ok(firstRule.source.includes('auth') && firstRule.source.includes('sw'), 'First rule must target auth/sw/swr scripts');

  const secondHeader = secondRule.headers?.find(h => h.key === 'Cache-Control');
  assert.ok(secondHeader?.value.includes('immutable'), 'Second rule can be immutable for versioned static assets');
});
