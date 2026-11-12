'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { handleChat } = require('../ai-assistant');
const { ensureRagSchema } = require('../lib/rag-schema');
const { startOrResumeStudySession } = require('../lib/study-partner-engine');
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

test('Reconciler filters "Page 1" generic headings and cleans syllabus objective fragments', async () => {
  const db = await createTestDb();

  await db.run(
    `INSERT INTO files (id, title, originalName, subject, semester_no, chapter)
     VALUES (?, ?, ?, ?, ?, ?)`,
    202, 'Chapter3 Complete Notes GU', 'ch3_notes.pdf', 'Web Technology I', 2, 'Unit 3'
  );

  for (let i = 1; i <= 30; i++) {
    const heading = i <= 25 ? 'Page 1' : (i <= 28 ? 'Slide 2' : 'CSS Box Model');
    await db.run(
      `INSERT INTO document_chunks (
        id, file_id, doc_version, chunk_index, chunk_level,
        page_start, page_end, chapter, unit, section_heading,
        content, clean_content, content_hash, subject, subject_code, semester_no, created_at
      ) VALUES (?, ?, 1, ?, 'child', 1, 1, 'Unit 3', 'Unit 3', ?, 'CSS content', 'CSS content', ?, 'Web Technology I', 'CIT123', 2, ?)`,
      `chk_noise_${i}`, 202, i, heading, `hash_noise_${i}`, new Date().toISOString()
    );
  }

  const studentContext = {
    authenticated: true,
    studentId: 'test_student_noise',
    role: 'student',
    currentSemester: 2
  };

  const turn = await handleChat(db, 'teach me css', studentContext, [], 'sess_css_noise');
  const match = turn.reply.match(/```study_session\n([\s\S]*?)\n```/);
  assert.ok(match, 'Should emit study_session block');
  const parsed = JSON.parse(match[1]);

  assert.ok(parsed.totalSteps <= 15, `Expected <= 15 clean steps, got ${parsed.totalSteps}`);
  for (const item of parsed.checklist) {
    assert.ok(!/^page\s*\d+$/i.test(item.title), `Checklist must not contain generic heading: ${item.title}`);
    assert.ok(!/should be developed\.?$/i.test(item.title), `Checklist must not contain objective sentence: ${item.title}`);
    assert.ok(!/After completing/i.test(item.title), `Checklist must not contain trailing "After completing": ${item.title}`);
  }
  const boxModelCount = parsed.checklist.filter((c) => /box model/i.test(c.title)).length;
  assert.ok(boxModelCount <= 1, 'Duplicate note headings must be deduplicated');
});

test('Self-healing archives corrupt >25-step Page 1 sessions and rebuilds clean session', async () => {
  const db = await createTestDb();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO study_partner_sessions (
      id, student_id, conversation_id, subject, subject_code,
      semester_no, unit_number, chapter_title, status, pedagogical_stage,
      current_step_index, total_steps, mastered_steps, last_interaction_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'study_sess_corrupt', 'stu_heal', 'conv_heal', 'Web Technology I', 'CIT123',
    2, 3, 'Introducing Cascading Style Sheet', 'ACTIVE', 'TEACHING', 1, 93, 0, now, now, now
  );

  await db.run(
    `INSERT INTO study_partner_topic_progress (
      id, session_id, student_id, step_index, topic_title,
      normalized_topic, source_origin, syllabus_ref, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'tp_corrupt_1', 'study_sess_corrupt', 'stu_heal', 12, 'Page 1', 'page 1', 'note_exclusive', 'PDF Extra', 'PENDING', now
  );

  const result = await startOrResumeStudySession(db, {
    studentId: 'stu_heal',
    conversationId: 'conv_heal',
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3,
    chapterQuery: 'css'
  });

  assert.equal(result.isResumed, false, 'Corrupt session should be archived and replaced');
  assert.notEqual(result.session.id, 'study_sess_corrupt');
  assert.ok(result.topics.length <= 15, `Rebuilt session should have <= 15 topics, got ${result.topics.length}`);

  const oldRow = await db.get(`SELECT status FROM study_partner_sessions WHERE id = ?`, 'study_sess_corrupt');
  assert.equal(oldRow.status, 'ARCHIVED');
});

test('Frontend public/chatbot.js renders study_session and pyq_card as interactive HTML cards', () => {
  const chatbotSrc = fs.readFileSync(path.join(__dirname, '../public/chatbot.js'), 'utf8');
  const { renderAdaptiveVisualBlockHtml } = require('../public/chatbot.js');

  assert.match(chatbotSrc, /\(study_session\|pyq_card\|roadmap/, 'KyanaCodeBlock.enhance must intercept study_session and pyq_card');

  const sessionHtml = renderAdaptiveVisualBlockHtml('study_session', JSON.stringify({
    course: 'CIT123 · Web Technology I',
    unit: 'UNIT 3: INTRODUCING CASCADING STYLE SHEET',
    currentStep: 1,
    totalSteps: 10,
    checklist: [{ stepIndex: 1, title: 'Introducing Cascading Style Sheet', status: 'current', sourceBadge: 'Syllabus + Note', hasPyq: true }]
  }));
  assert.ok(sessionHtml && sessionHtml.includes('kyana-study-session-card'), 'Should render kyana-study-session-card');
  assert.ok(sessionHtml.includes('Step 1 of 10'), 'Should display step counter');

  const pyqHtml = renderAdaptiveVisualBlockHtml('pyq_card', JSON.stringify({
    examTitle: 'GANDAKI UNIVERSITY · 2024 FINAL EXAM',
    questionNumber: 'Q.3',
    marks: '5 MARKS',
    questionText: 'Explain CSS Box Model.'
  }));
  assert.ok(pyqHtml && pyqHtml.includes('kyana-pyq-card'), 'Should render kyana-pyq-card');
});
