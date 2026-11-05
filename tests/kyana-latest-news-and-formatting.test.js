'use strict';

/**
 * Test Suite: Kyana AI — Latest News Prioritization & Website Reply Formatting
 *
 * Verifies:
 * 1. Focus on Latest News First: When there are multiple notices on a topic (such as class resumption,
 *    holidays, or exams), Kyana always prioritizes and focuses on the newest / latest announcement first.
 * 2. Older notices on the same topic are marked superseded by the strictly later announcement.
 * 3. History Retrieval: When the user explicitly asks for history or previous announcements ("purano notice", "previous notice"),
 *    historical records are accessible.
 * 4. Website Reply Formatting: fallbackMarkdown formats **bold**, __bold__, tables, lists, headings, and links cleanly
 *    with 0 raw asterisks and 0 raw markdown table pipes.
 * 5. Strict XSS sanitization in web markdown rendering.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat, invalidateCache, clearPaginationState } = require('../ai-assistant');
const { fallbackMarkdown } = require('../public/chatbot');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
    isPostgres: false,
    client,
    async exec(sql) {
      const stmts = sql
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
      for (const s of stmts) {
        await client.execute(s);
      }
    },
    async run(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: Number(res.lastInsertRowid || 0),
        changes: Number(res.rowsAffected || 0)
      };
    },
    async get(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    async all(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows.map(r => ({ ...r }));
    }
  };
}

describe('Kyana AI — Latest News Prioritization & Web Markdown Formatting', () => {
  let db;
  const studentCtx = {
    studentId: 'student_latest_test',
    student_id: 'student_latest_test',
    userId: 'student_latest_test',
    role: 'student',
    currentSemester: 3,
    semester: 3,
    semester_no: 3,
    department: 'BIT',
    cohortId: 'bit_2024',
    authenticated: true
  };

  before(async () => {
    db = createTestDb();

    await db.exec(`
      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        semester INTEGER DEFAULT 1,
        department TEXT DEFAULT 'BIT',
        avatarUrl TEXT
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT,
        semester_no INTEGER,
        visibility TEXT DEFAULT 'everyone',
        target_all_semesters INTEGER DEFAULT 1,
        audience_scope TEXT DEFAULT 'all_students',
        cohort_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        edited_at TEXT,
        moderation_status TEXT DEFAULT 'active',
        subject TEXT
      );

      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL,
        semester INTEGER NOT NULL
      );

      CREATE TABLE routine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_name TEXT NOT NULL,
        subject_code TEXT,
        exam_date TEXT NOT NULL,
        calendar TEXT DEFAULT 'BS',
        weekday TEXT,
        exam_time TEXT,
        room TEXT,
        semester INTEGER NOT NULL,
        exam_type TEXT DEFAULT 'Regular'
      );
    `);

    // Seed trusted students
    await db.run(
      `INSERT INTO students (studentId, name, email, password, role, semester, department)
       VALUES ('admin_gu', 'Campus Administration', 'admin@gu.edu.np', 'hash', 'admin', 3, 'BIT')`
    );
    await db.run(
      `INSERT INTO students (studentId, name, email, password, role, semester, department)
       VALUES ('student_latest_test', 'Aarav Sharma', 'aarav@gu.edu.np', 'hash', 'student', 3, 'BIT')`
    );

    // 1. Seed 3 consecutive class resumption notices on the same topic:
    // Notice 201 (Oldest: 2026-10-10): "Resumption of Regular Classes after Dashain Vacation"
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (201, 'admin_gu', 'Resumption of Regular Classes after Dashain Vacation',
         'All BIT regular classes will resume following Dashain vacation on Kartik 15, 2083.',
         'notice', 'notice', 3, 'everyone', 1, 'all_students', '2026-10-10T08:00:00Z')`
    );

    // Notice 202 (Intermediate: 2026-10-22): "Notice Regarding Extension of Vacation and Regular Classes"
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (202, 'admin_gu', 'Notice Regarding Extension of Vacation and Regular Classes',
         'Vacation is extended. All regular classes will resume on Kartik 28, 2083.',
         'notice', 'notice', 3, 'everyone', 1, 'all_students', '2026-10-22T08:00:00Z')`
    );

    // Notice 203 (LATEST: 2026-11-04): "Latest Notice: Regular Classes Resume from Mangsir 1"
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (203, 'admin_gu', 'Latest Notice: Regular Classes Resume from Mangsir 1',
         'University announcement: Regular classes resume from Mangsir 1, 2083 as per updated schedule.',
         'notice', 'notice', 3, 'everyone', 1, 'all_students', '2026-11-04T08:00:00Z')`
    );

    // 2. Seed holiday notices:
    // Holiday Notice 301 (Old: 2026-10-01): "Dashain Public Holiday Notice"
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (301, 'admin_gu', 'Dashain Public Holiday Notice',
         'College will remain closed for Dashain holiday from 2026-10-05.',
         'notice', 'notice', 3, 'everyone', 1, 'all_students', '2026-10-01T08:00:00Z')`
    );

    // Holiday Notice 302 (Latest: Published Today): "Urgent Holiday Notice for Tomorrow"
    const todayIso = new Date().toISOString();
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (302, 'admin_gu', 'Urgent Holiday Notice for Tomorrow',
         'The college will remain closed tomorrow for a local public holiday. All regular classes are suspended.',
         'notice', 'notice', 3, 'everyone', 1, 'all_students', ?)`,
      todayIso
    );
  });

  after(() => {
    if (db?.client) db.client.close();
  });

  // --- Category 1: Latest News Prioritization ---

  test('1. Focus on Latest News First: Kyana prioritizes the newest class resumption notice (post 203)', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Hamro class kaile bata ho?', studentCtx, [], 'sess_recency_1', {
      academicContext: studentCtx
    });

    // Must cite or answer according to the LATEST notice (post 203 - Mangsir 1)
    assert.match(res.reply, /Mangsir 1/i, 'Reply must be based on the latest notice (Mangsir 1)');
    assert.doesNotMatch(res.reply, /Kartik 15/i, 'Must not claim classes resume on older superseded date (Kartik 15)');
    assert.doesNotMatch(res.reply, /Kartik 28/i, 'Must not claim classes resume on intermediate superseded date (Kartik 28)');

    // Resource card must be for the LATEST notice (post 203)
    const noticeCards = res.resourceCards.filter(c => c.type === 'notice');
    assert.ok(noticeCards.length > 0, 'Must attach at least 1 notice card');
    assert.equal(noticeCards[0].id, 203, 'Primary resource card must be post 203 (the latest announcement)');
    assert.ok(!res.resourceCards.some(c => c.id === 201), 'Must NOT attach card for older superseded post 201');
  });

  test('2. Latest Holiday Notice: Kyana prioritizes the newest holiday notice over past holidays', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Bholi holiday ho ki haina?', studentCtx, [], 'sess_recency_2', {
      academicContext: studentCtx
    });

    assert.match(res.reply, /closed tomorrow|suspended|holiday/i, 'Must answer based on latest holiday notice');
    assert.doesNotMatch(res.reply, /Dashain/i, 'Must not confuse tomorrow with older Dashain holiday');
    assert.ok(res.resourceCards.some(c => c.id === 302), 'Must attach card for latest holiday notice 302');
  });

  test('3. Historical Notice Query: Allows retrieving earlier notices when user explicitly asks for history', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Class ko purano previous notice ma k thiyo?', studentCtx, [], 'sess_history_1', {
      academicContext: studentCtx
    });

    // When explicitly asking for previous/purano notice, should find historical notices
    assert.ok(res.reply.length > 0, 'Must provide historical reply');
    assert.ok(res.resourceCards.some(c => c.id === 201 || c.id === 202), 'Must allow discovering earlier notice when asking history');
  });

  // --- Category 2: Website Reply Formatting (fallbackMarkdown) ---

  test('4. Web Formatting: Converts **bold** and __bold__ to <strong> with ZERO raw asterisks', () => {
    const input = 'University ko **latest official notice** anusar regular classes **Mangsir 1** bata resume huncha as per __updated schedule__.';
    const html = fallbackMarkdown(input);

    assert.ok(html.includes('<strong>latest official notice</strong>'), 'Should format bold strong');
    assert.ok(html.includes('<strong>Mangsir 1</strong>'), 'Should format bold date');
    assert.ok(html.includes('<strong>updated schedule</strong>'), 'Should format __bold__ as strong');
    assert.doesNotMatch(html, /\*\*/, 'Rendered HTML must have zero raw ** tokens');
    assert.doesNotMatch(html, /__/, 'Rendered HTML must have zero raw __ tokens');
  });

  test('5. Web Formatting: Formats Markdown tables into <table> with <th> and <td> with zero raw pipes', () => {
    const input = `| Subject | Attendance % | Status |
|:---|:---:|---:|
| Data Structures | 85% | Eligible |
| Web Technology | 100% | Eligible |`;

    const html = fallbackMarkdown(input);

    assert.ok(html.includes('<div class="kyana-table-wrapper">'), 'Should wrap table in kyana-table-wrapper');
    assert.ok(html.includes('<table class="kyana-table">'), 'Should create kyana-table');
    assert.ok(html.includes('<th style="text-align: left;">Subject</th>'), 'Should parse header cell with alignment');
    assert.ok(html.includes('<th style="text-align: center;">Attendance %</th>'), 'Should parse header cell with alignment');
    assert.ok(html.includes('<td style="text-align: left;">Data Structures</td>'), 'Should parse data cell');
    assert.ok(html.includes('<td style="text-align: right;">Eligible</td>'), 'Should parse right-aligned cell');
    assert.doesNotMatch(html, /\|/, 'Rendered table must have zero raw pipe characters');
  });

  test('6. Web Formatting: Formats Markdown headings (###, ##, #) into proper HTML heading tags', () => {
    const input = `### 📊 Subject-Wise Attendance Breakdown
## Important Notice
# University Updates`;

    const html = fallbackMarkdown(input);

    assert.ok(html.includes('<h3>📊 Subject-Wise Attendance Breakdown</h3>'), 'Should render <h3> tag');
    assert.ok(html.includes('<h2>Important Notice</h2>'), 'Should render <h2> tag');
    assert.ok(html.includes('<h1>University Updates</h1>'), 'Should render <h1> tag');
    assert.doesNotMatch(html, /#{1,4}\s+/, 'Rendered HTML must have zero raw heading hash tokens');
  });

  test('7. Web Formatting: Formats bullet lists and numbered lists into <ul> and <ol>', () => {
    const input = `- **Present:** 3 classes
- **Absent:** 1 class
1. First step
2. Second step`;

    const html = fallbackMarkdown(input);

    assert.ok(html.includes('<ul><li><strong>Present:</strong> 3 classes</li>'), 'Should render <ul> and <li>');
    assert.ok(html.includes('<ol><li>First step</li>'), 'Should render <ol> and <li>');
  });

  test('8. Web Formatting: Security sanitization strips unsafe script tags', () => {
    const malicious = '<script>alert("hacked")</script>**Safe bold** <img src=x onerror=alert(1)>';
    const html = fallbackMarkdown(malicious);

    assert.ok(!html.includes('<script>'), 'Must not contain raw script tags');
    assert.ok(html.includes('<strong>Safe bold</strong>'), 'Must format bold correctly');
    assert.ok(html.includes('&lt;script&gt;'), 'Must escape dangerous tags');
  });
});
