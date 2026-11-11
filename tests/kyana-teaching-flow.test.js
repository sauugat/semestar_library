'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const { ensureRagSchema } = require('../lib/rag-schema');
const { formatRow, formatRows } = require('../db');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    client,
    dialect: 'sqlite',
    isPostgres: false,
    async run(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return client.execute({ sql, args: params });
    },
    async get(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRow(res.rows[0] || null);
    },
    async all(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRows(res.rows || []);
    },
    async exec(sql) {
      return client.executeMultiple(sql);
    }
  };

  await db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id INTEGER,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      previewName TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER DEFAULT 1024,
      uploadedAt TEXT,
      deleted_at TEXT,
      hidden_at TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Kyana Study Partner End-to-End Teaching Flow: "teach me css" -> "next" -> "bujhina"', async (t) => {
  const db = await createTestDb();

  // Seed sample file for Web Technology I
  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    101, 'Chapter3 Complete Notes GU', 'ch3_web_tech_notes.pdf', 'Web Technology I', 2, 'Introducing Cascading Style Sheet'
  );

  await db.run(
    `INSERT INTO document_chunks (
      id, file_id, doc_version, chunk_index, chunk_level,
      page_start, page_end, chapter, unit, section_heading,
      content, clean_content, content_hash, subject, subject_code, semester_no, created_at
    ) VALUES (?, ?, 1, 1, 'child', 1, 3, 'Unit 3', 'Unit 3', 'Introducing Cascading Style Sheet', 'CSS stands for Cascading Style Sheets.', 'CSS stands for Cascading Style Sheets.', 'hash_css', 'Web Technology I', 'CIT123', 2, ?)`,
    'chk_css_1', 101, new Date().toISOString()
  );

  const studentContext = {
    authenticated: true,
    studentId: 'test_student_css_flow',
    role: 'student',
    currentSemester: 2
  };

  // Turn 1: Student says "teach me css"
  const turn1 = await handleChat(db, 'teach me css', studentContext, [], 'sess_css_test');

  assert.equal(turn1.intent, 'study_partner', 'Turn 1 must route to study_partner');
  assert.ok(!turn1.reply.includes('This is extracted from'), 'Must NOT contain "This is extracted from..."');
  assert.ok(turn1.reply.includes('```study_session'), 'Must render study_session visual block');
  assert.ok(turn1.reply.includes('Cascading Style Sheets') || turn1.reply.includes('presentation language'), 'Explains CSS conceptually');
  assert.ok(turn1.reply.includes('Checkpoint Question') || turn1.reply.includes('🎯 Checkpoint'), 'Includes Socratic checkpoint');

  // Verify Course Isolation on Resource Cards: only Web Technology I notes, NEVER Discrete Math
  for (const card of turn1.resourceCards || []) {
    assert.match(card.subject, /Web Technology/i, 'Cards must strictly belong to active course');
  }

  // Turn 2: Student says "next" to advance to micro-topic 2
  const turn2History = [
    { role: 'user', content: 'teach me css' },
    { role: 'assistant', content: turn1.reply, resourceCards: turn1.resourceCards }
  ];
  const turn2 = await handleChat(db, 'next', studentContext, turn2History, 'sess_css_test');

  assert.equal(turn2.intent, 'study_partner', 'Turn 2 follow-up "next" must route to study_partner');
  assert.ok(!turn2.reply.includes('This is extracted from'), 'Turn 2 must NOT dump raw notes');
  assert.ok(turn2.reply.includes('```study_session'), 'Turn 2 must render updated study_session progress');
  assert.ok(turn2.reply.includes('Step 2') || turn2.reply.includes('mastered') || turn2.reply.includes('Next'), 'Advances to step 2');

  // Turn 3: Student says "bujhina, explain simpler"
  const turn3History = [
    ...turn2History,
    { role: 'user', content: 'next' },
    { role: 'assistant', content: turn2.reply, resourceCards: turn2.resourceCards }
  ];
  const turn3 = await handleChat(db, 'bujhina, explain simpler', studentContext, turn3History, 'sess_css_test');

  assert.equal(turn3.intent, 'study_partner', 'Turn 3 remediation must route to study_partner');
  assert.ok(turn3.reply.includes('simpler') || turn3.reply.includes('analogy') || turn3.reply.includes('house') || turn3.reply.includes('break this down'), 'Triggers pedagogical remediation');
});
