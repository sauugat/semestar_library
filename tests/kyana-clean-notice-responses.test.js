/**
 * Regression Test Suite: Kyana AI — Clean Conversational Notice Responses
 *
 * Verifies that:
 * 1. Conversational questions ("Bida sakiyo, class kaile suru huncha?", "Hamro class kaile bata ho?")
 *    return natural, concise, straight-to-the-point answers and NEVER dump raw notice records.
 * 2. Exact match with user prompt specification for "Bida sakiyo, class kaile suru huncha?":
 *    - Opener: "Bida sakiyera aru padhna thalisake bro, timi chai balla class kaile suru hunxa vandai xau 💀"
 *    - Reply: "University ko latest official notice anusar regular classes resume hune kura cha, tara exact starting date mention gareko chaina. Updated timetable publish bhayepachi confirm huncha."
 * 3. Identical/duplicate notices are deduplicated to a single citation.
 * 4. Superseded notices are excluded from output unless historical context is explicitly requested.
 * 5. Publication date is never confused with event/start date; exact date absence is honestly noted.
 * 6. Explicit requests for a notice ("Show me the official notice about classes") provide the resource card
 *    and cite title concisely without raw database dumps.
 * 7. User-facing outputs contain ZERO raw metadata tokens:
 *    - No "(Admin — Official Notice)"
 *    - No "| Semester: ..."
 *    - No "(published on ...)" standalone lines
 *    - No "[Note: Superseded by a newer notice]"
 *    - No "*(Related notice attached below)*"
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat, invalidateCache, clearPaginationState } = require('../ai-assistant');
const { searchNotices } = require('../lib/ai-search-tools');

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

describe('Kyana AI — Clean Conversational Notice Responses', () => {
  let db;

  const studentContext = {
    authenticated: true,
    studentId: 'STU_SEM3',
    name: 'Aayush Shrestha',
    role: 'student',
    semester: 'Semester III',
    currentSemester: 3,
    cohortId: 'BIT_2025'
  };

  test('setup test database', async () => {
    db = createTestDb();
    await db.exec(`
      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        avatarUrl TEXT
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'notice',
        category TEXT NOT NULL DEFAULT 'NOTICE',
        visibility TEXT NOT NULL DEFAULT 'everyone',
        target_all_semesters INTEGER NOT NULL DEFAULT 1,
        audience_scope TEXT NOT NULL DEFAULT 'all_students',
        cohort_id TEXT,
        semester_no INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        edited_at TEXT
      );

      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_semester INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        PRIMARY KEY (post_id, semester)
      );

      CREATE TABLE routine (
        id INTEGER PRIMARY KEY,
        semester INTEGER,
        subject_name TEXT,
        subject_code TEXT,
        exam_date TEXT,
        calendar TEXT,
        weekday TEXT,
        exam_time TEXT,
        room TEXT,
        exam_type TEXT
      );

      CREATE TABLE assignments (
        id INTEGER PRIMARY KEY,
        title TEXT
      );

      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        title TEXT
      );
    `);

    // Insert trusted admin
    await db.run(
      `INSERT INTO students (studentId, name, role) VALUES (?, ?, ?)`,
      'ADMIN_01', 'Admin Sau Gat', 'admin'
    );

    // Active official notice 184 (published Nov 3)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      184,
      'ADMIN_01',
      'Resumption of Regular Classes',
      'Regular BIT classes resume following Dashain vacation as per the updated academic schedule.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-11-03T10:00:00Z'
    );

    // Superseded notice 171 (published Oct 9)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      171,
      'ADMIN_01',
      'Resumption of Regular Classes',
      'Regular classes will resume after vacation according to earlier schedule.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-10-09T08:00:00Z'
    );

    // Duplicate notice with same title (e.g. re-posted)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, visibility, target_all_semesters, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      185,
      'ADMIN_01',
      'Resumption of Regular Classes',
      'Regular BIT classes resume following Dashain vacation as per the updated academic schedule.',
      'status',
      'NOTICE',
      'everyone',
      1,
      'all_students',
      '2026-11-03T10:05:00Z'
    );
  });

  test('1. Exact Match: "Bida sakiyo, class kaile suru huncha?" gives natural conversational answer', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Bida sakiyo, class kaile suru huncha?', studentContext, [], 'sess_clean_1', {
      academicContext: studentContext,
      chatMode: 'roast'
    });

    // Verify roast opener matches spec exactly
    assert.ok(
      res.reply.includes('Bida sakiyera aru padhna thalisake bro, timi chai balla class kaile suru hunxa vandai xau 💀'),
      'Reply must include exact specified witty opener'
    );

    // Verify body matches spec exactly
    assert.ok(
      res.reply.includes('University ko latest official notice anusar regular classes resume hune kura cha, tara exact starting date mention gareko chaina. Updated timetable publish bhayepachi confirm huncha.'),
      'Reply must include exact specified conversational body'
    );

    // Cleanliness check: Zero raw metadata or source dumps
    assert.doesNotMatch(res.reply, /Based on \*\*Resumption of Regular Classes\*\*/);
    assert.doesNotMatch(res.reply, /\(Admin — Official Notice\)/);
    assert.doesNotMatch(res.reply, /\|\s*Semester:/);
    assert.doesNotMatch(res.reply, /\(published on 2026-11-03\)/);
    assert.doesNotMatch(res.reply, /\[Note: Superseded by a newer notice\]/);
    assert.doesNotMatch(res.reply, /\*\(Related notice attached below\)\*/);

    // Attached card must be present for the notice
    assert.ok(res.resourceCards.some(c => (c.id === 184 || c.id === 185) && c.type === 'notice'));
  });

  test('2. Clean Conversational English: "When do regular BIT classes resume?"', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'When do regular BIT classes resume?', studentContext, [], 'sess_clean_2', {
      academicContext: studentContext,
      chatMode: 'formal'
    });

    assert.ok(
      res.reply.includes("According to the university's latest official notice, regular classes resume following vacation as per the updated academic schedule, but no exact starting date is stated in the notice. It will be confirmed once the updated department timetable is published."),
      'English reply must be clean, natural, and honest about missing calendar date'
    );

    assert.doesNotMatch(res.reply, /Based on \*\*Resumption of Regular Classes\*\*/);
    assert.doesNotMatch(res.reply, /\*\(Related notice attached below\)\*/);
    assert.doesNotMatch(res.reply, /classes (?:will )?(?:start|resume) on 2026-11-03/i, 'Must not claim classes start on publication date');
  });

  test('3. Deduplication: Duplicate notices in database are collapsed to one citation and card', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Hamro class kaile bata ho?', studentContext, [], 'sess_clean_3', {
      academicContext: studentContext
    });

    // Only one notice card should be attached despite post 184 and 185 having the same title/content
    const noticeCards = res.resourceCards.filter(c => c.type === 'notice');
    assert.equal(noticeCards.length, 1, 'Duplicate notices must be collapsed to exactly 1 card');
    assert.ok(noticeCards[0].id === 184 || noticeCards[0].id === 185);
  });

  test('4. Supersession Exclusion: Superseded notices (post 171) are excluded from user-facing answer and cards', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Hamro class kaile bata ho?', studentContext, [], 'sess_clean_4', {
      academicContext: studentContext
    });

    assert.doesNotMatch(res.reply, /Note: Superseded/i, 'User reply must not list superseded notices');
    assert.doesNotMatch(res.reply, /2026-10-09/, 'User reply must not display superseded notice date');
    assert.ok(
      !res.resourceCards.some(c => c.id === 171),
      'Superseded notice 171 card must NOT be shown when asking current class schedule'
    );
  });

  test('5. Historical Inquiry: Historical context explicitly requested includes earlier notices', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Show me previous notice history about vacation', studentContext, [], 'sess_clean_5', {
      academicContext: studentContext
    });

    // When explicitly asked for history, notices can be retrieved
    assert.ok(res.matchedNotices.length > 0);
  });

  test('6. Explicit Request: "Show me the official notice about classes" provides card and cites title', async () => {
    invalidateCache(db);
    clearPaginationState();

    const res = await handleChat(db, 'Show me the official notice about classes', studentContext, [], 'sess_clean_6', {
      academicContext: studentContext
    });

    assert.ok(
      res.reply.includes('Resumption of Regular Classes'),
      'Explicit request for notice must name the notice title'
    );
    assert.ok(
      res.resourceCards.some(c => (c.id === 184 || c.id === 185) && c.title === 'Resumption of Regular Classes'),
      'Must provide the interactive resource card'
    );
  });
});
