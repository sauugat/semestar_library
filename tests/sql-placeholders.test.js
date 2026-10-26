'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPostgresPlaceholders } = require('../lib/sql-placeholders');

test('a ? inside single quotes stays untouched', () => {
  const input = "SELECT * FROM files WHERE query = '?v=12' AND id = ?";
  const expected = "SELECT * FROM files WHERE query = '?v=12' AND id = $1";
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('normal ? are numbered in sequential order', () => {
  const input = 'SELECT * FROM students WHERE id = ? AND department = ? AND semester = ?';
  const expected = 'SELECT * FROM students WHERE id = $1 AND department = $2 AND semester = $3';
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('escaped single quotes inside string literals do not exit string literal state', () => {
  const input = "SELECT * FROM posts WHERE content = 'Don''t touch ? inside' AND author_id = ?";
  const expected = "SELECT * FROM posts WHERE content = 'Don''t touch ? inside' AND author_id = $1";
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('double-quoted identifiers leave ? inside untouched', () => {
  const input = 'SELECT "col?name", "another""?col" FROM "table?name" WHERE id = ?';
  const expected = 'SELECT "col?name", "another""?col" FROM "table?name" WHERE id = $1';
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('multiple params with mixed single and double quoted segments', () => {
  const input = 'SELECT ?, "field?name", \'?v=34\' AS v, ? AS val, \'escaped \'\'?\'\' literal\' AS esc, ? AS final';
  const expected = 'SELECT $1, "field?name", \'?v=34\' AS v, $2 AS val, \'escaped \'\'?\'\' literal\' AS esc, $3 AS final';
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('no ? at all returns unchanged string', () => {
  const input = 'SELECT id, name, created_at FROM students ORDER BY id ASC';
  assert.equal(toPostgresPlaceholders(input), input);
  assert.equal(toPostgresPlaceholders(''), '');
  assert.equal(toPostgresPlaceholders(null), null);
  assert.equal(toPostgresPlaceholders(undefined), undefined);
});

test('does NOT replace datetime(\'now\') or alter other SQL constructs', () => {
  const input = "SELECT datetime('now') AS current_time, ? AS param";
  const expected = "SELECT datetime('now') AS current_time, $1 AS param";
  assert.equal(toPostgresPlaceholders(input), expected);
});

test('exact cohort chat members query text preserves ?v= and converts external ? to $1 and $2', () => {
  const membersSql = `SELECT s.studentId AS student_id,s.name,s.username,
    CASE WHEN s.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || s.studentId || '?v=' || LENGTH(s.avatarUrl) || '-' || SUBSTR(s.avatarUrl, -12) ELSE s.avatarUrl END AS avatar_url,
    s.supabase_uid
    FROM students s WHERE ((s.cohort_id=? AND UPPER(TRIM(s.department))='BIT') OR s.role IN ('admin','teacher'))
    AND COALESCE(s.role,'student') NOT IN ('blocked','banned','suspended')
    AND NOT EXISTS(SELECT 1 FROM chat_room_revocations r WHERE r.chat_group_id=? AND r.student_id=s.studentId)
    ORDER BY s.studentId`;

  const converted = toPostgresPlaceholders(membersSql);

  // '?v=' remains completely untouched
  assert.ok(converted.includes("'?v='"), "Expected '?v=' inside string literal to remain untouched");
  assert.ok(!converted.includes("'$1v='"), "Should not have replaced ? inside '?v=' with $1");

  // Placeholders outside quotes are converted in order
  assert.ok(converted.includes('s.cohort_id=$1'), 'Expected s.cohort_id=$1');
  assert.ok(converted.includes('r.chat_group_id=$2'), 'Expected r.chat_group_id=$2');

  // Count replaced placeholders in the query
  const matches = converted.match(/\$\d+/g) || [];
  assert.equal(matches.length, 2, 'Expected exactly 2 numbered placeholders in the members query');
  assert.deepEqual(matches, ['$1', '$2']);
});

test('cohort chat query with 3 positional parameters converts to exactly 3 placeholders ($1, $2, $3) with ?v= untouched', () => {
  const query = `SELECT s.studentId,
    CASE WHEN s.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || s.studentId || '?v=' || LENGTH(s.avatarUrl) ELSE s.avatarUrl END AS avatar_url
    FROM students s
    WHERE s.cohort_id = ? AND s.department = ? AND s.semester = ?`;

  const converted = toPostgresPlaceholders(query);

  assert.ok(converted.includes("'?v='"), "Expected '?v=' inside string literal to remain untouched");
  const matches = converted.match(/\$\d+/g) || [];
  assert.equal(matches.length, 3, 'Expected exactly 3 numbered placeholders');
  assert.deepEqual(matches, ['$1', '$2', '$3']);
});
