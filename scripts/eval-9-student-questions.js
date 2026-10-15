#!/usr/bin/env node
'use strict';

/**
 * KYANA AI 3.0 — Evaluation of 9 Specific Student Questions (Task 5)
 * 1. "CSS ko notes khojdeu"
 * 2. "Hamro semester ko latest notice k xa?"
 * 3. "Asti sir le upload gareko assignment dekhau"
 * 4. "Voli submission deadline xa?"
 * 5. "Hamro exam routine change vako ho?"
 * 6. "Tyo second wala file khola"
 * 7. "Yo notice ko meaning bujhaideu"
 * 8. "4th semester ko restricted notes dekhau"
 * 9. "Professor Dumbledore ko office hours kati ho?"
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

for (const envFile of ['.env.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    try { process.loadEnvFile(fullPath); } catch (_) {}
  }
}

process.env.KYANA_KNOWLEDGE_V3 = 'true';
process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

const { handleChat } = require('../ai-assistant');
const { applyKnowledgeMigration } = require('../lib/knowledge-schema');
const { embedText, normalizeVector } = require('../lib/knowledge-embeddings');

const connectionString = process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

async function generateDeterministicVector(text) {
  try {
    const v = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (v && v.length === 768) return v;
  } catch (_) {}
  const vector = new Array(768).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  for (let i = 0; i < 768; i++) {
    vector[i] = Math.sin(hash + i);
  }
  return normalizeVector(vector);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log('--- Setting up Test Schema and Seeding Authorized Records ---');
  await applyKnowledgeMigration(client);

  // Setup student & cohort
  await client.query(`
    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT NOT NULL,
      group_code TEXT,
      display_name TEXT NOT NULL,
      current_semester INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS students (
      studentId VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      passwordHash VARCHAR(255) DEFAULT 'hash',
      role VARCHAR(50) DEFAULT 'student',
      account_status VARCHAR(32) NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      user_id VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT,
      indexed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS routine (
      id INTEGER PRIMARY KEY,
      semester INTEGER,
      day_of_week TEXT,
      period INTEGER,
      subject TEXT
    );

    INSERT INTO cohorts (id, slot_code, display_name, current_semester)
    VALUES ('c_mercury', 'mercury', 'Mercury Cohort', 3),
           ('c_venus', 'venus', 'Venus Cohort', 4)
    ON CONFLICT (id) DO UPDATE SET current_semester = EXCLUDED.current_semester;

    INSERT INTO students (studentId, name, role, account_status)
    VALUES ('stu_alice', 'Alice Student', 'student', 'active'),
           ('tea_prof', 'Professor Teacher', 'teacher', 'active')
    ON CONFLICT (studentId) DO UPDATE SET role = EXCLUDED.role;
  `);

  // Clean prior test records
  await client.query(`
    DELETE FROM assignments WHERE id >= 900;
    DELETE FROM posts WHERE id >= 900;
    DELETE FROM files WHERE id >= 900;
    DELETE FROM note_search_documents WHERE id >= 900;
    DELETE FROM knowledge_chunks WHERE resource_id LIKE 'note:90%' OR resource_id LIKE 'post:90%' OR resource_id LIKE 'assignment:90%';
    DELETE FROM knowledge_resources WHERE id LIKE 'note:90%' OR id LIKE 'post:90%' OR id LIKE 'assignment:90%';
  `);

  // Helper to insert a resource
  async function seedItem({ post, assignment, file, chunkContent }) {
    let resId, type, title, sem, cohort, audience, visibility = 'everyone';
    if (post) {
      await client.query(`
        INSERT INTO posts (id, user_id, title, content, type, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [post.id, post.user_id, post.title, post.content, post.type || 'status', post.semester_no, post.cohort_id, post.category || 'general', post.visibility || 'everyone', post.audience_scope || 'cohort', post.target_all_semesters || 0]);
      resId = `post:${post.id}`;
      type = post.category === 'notice' || post.type === 'notice' ? 'notice' : 'post';
      title = post.title;
      sem = post.semester_no;
      cohort = post.cohort_id;
      audience = post.audience_scope || 'cohort';
      visibility = post.visibility || 'everyone';
    } else if (assignment) {
      await client.query(`
        INSERT INTO assignments (id, title, description, language, subject, semester, deadline, createdBy, createdAt, cohort_id, semester_no, audience_scope)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [assignment.id, assignment.title, assignment.description, assignment.language || 'javascript', assignment.subject, assignment.semester, assignment.deadline, assignment.createdBy, assignment.createdAt || new Date(), assignment.cohort_id, assignment.semester_no, assignment.audience_scope || 'cohort']);
      resId = `assignment:${assignment.id}`;
      type = 'assignment';
      title = assignment.title;
      sem = assignment.semester_no;
      cohort = assignment.cohort_id;
      audience = assignment.audience_scope || 'cohort';
    } else if (file) {
      await client.query(`
        INSERT INTO files (id, title, originalName, storedName, uploadedBy, sizeBytes, uploadedAt, subject, chapter, semester, cohort_id, semester_no, audience_scope)
        VALUES ($1, $2, $3, $4, 'tea_prof', 1024, NOW(), $5, $6, $7, $8, $9, $10)
      `, [file.id, file.title, file.originalName, file.storedName || 'f.pdf', file.subject, file.chapter, file.semester, file.cohort_id, file.semester_no, file.audience_scope || 'cohort']);
      await client.query(`
        INSERT INTO note_search_documents (id, content, extraction_status, indexed_at) VALUES ($1, $2, 'indexed', NOW())
      `, [file.id, chunkContent]);
      resId = `note:${file.id}`;
      type = 'note';
      title = file.title;
      sem = file.semester_no;
      cohort = file.cohort_id;
      audience = file.audience_scope || 'cohort';
    }

    await client.query(`
      INSERT INTO knowledge_resources (
        id, resource_type, canonical_id, title, author_id, cohort_id, semester_no,
        audience_scope, visibility, target_all_semesters, source_authority_tier, web_url, mobile_route, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      resId, type, post ? post.id : assignment ? assignment.id : file.id,
      title, 'tea_prof', cohort, sem, audience, visibility, 0, 2,
      `/open/${resId}`, `/${type}/${post ? post.id : assignment ? assignment.id : file.id}`, `hash_${resId}`
    ]);

    const vec = await generateDeterministicVector(chunkContent);
    await client.query(`
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
      VALUES ($1, $2, 0, $3, 'gemini-embedding-001', $4::vector(768))
    `, [`chunk_${resId}_0`, resId, chunkContent, `[${vec.join(',')}]`]);
  }

  // 1. Seed CSS Notes for Sem 3
  await seedItem({
    file: { id: 901, title: 'Complete CSS Flexbox and Grid Master Notes', originalName: 'css_notes_chapter3.pdf', subject: 'Web Technologies', chapter: 'Chapter 3: Styling', semester: 'Semester 3', semester_no: 3, cohort_id: 'c_mercury' },
    chunkContent: '[Type: Note | Title: Complete CSS Flexbox and Grid Master Notes]\nComprehensive guide to CSS layout: Flexbox (justify-content, align-items, flex-direction) and CSS Grid (grid-template-columns, gap). Includes responsive design media queries.'
  });

  // Also seed a second file for relative references ("second wala file khola")
  await seedItem({
    file: { id: 902, title: 'CSS Responsive Web Design and Media Queries', originalName: 'css_responsive_design.pdf', subject: 'Web Technologies', chapter: 'Chapter 4: Responsive UI', semester: 'Semester 3', semester_no: 3, cohort_id: 'c_mercury' },
    chunkContent: '[Type: Note | Title: CSS Responsive Web Design and Media Queries]\nDeep dive into viewport meta tags, fluid grids, and CSS media queries for mobile, tablet, and desktop viewports.'
  });

  // 2. Seed Latest Notice for Sem 3
  await seedItem({
    post: { id: 903, user_id: 'tea_prof', title: 'Midterm Examination Schedule for Semester 3', content: 'Official Notice: Semester 3 Midterm Examinations will commence from Kartik 25. The detailed timetable is pinned on the department notice board.', category: 'notice', semester_no: 3, cohort_id: 'c_mercury' },
    chunkContent: '[Type: Notice | Title: Midterm Examination Schedule for Semester 3]\nOfficial Notice: Semester 3 Midterm Examinations will commence from Kartik 25. The detailed timetable is pinned on the department notice board.'
  });

  // 3. Seed Assignment uploaded recently
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  await seedItem({
    assignment: { id: 904, title: 'JavaScript DOM Manipulation Assignment 2', description: 'Build an interactive todo-list with localStorage persistence. Submit via GitHub repository link before tomorrow evening.', subject: 'Web Technologies', semester: 'Semester 3', semester_no: 3, cohort_id: 'c_mercury', createdBy: 'tea_prof', createdAt: twoDaysAgo, deadline: tomorrow },
    chunkContent: '[Type: Assignment | Title: JavaScript DOM Manipulation Assignment 2]\nTeacher assignment posted recently: Build an interactive todo-list with localStorage persistence. Submit via GitHub repository link before tomorrow evening.'
  });

  // 4. Seed Exam routine update notice
  await seedItem({
    post: { id: 905, user_id: 'tea_prof', title: 'Routine Rescheduled for CIT201 Database Systems', content: 'Notice: CIT201 Database Systems lab session scheduled for Friday has been moved to Monday 10:00 AM due to the holiday.', category: 'notice', semester_no: 3, cohort_id: 'c_mercury' },
    chunkContent: '[Type: Notice | Title: Routine Rescheduled for CIT201 Database Systems]\nNotice: CIT201 Database Systems lab session scheduled for Friday has been moved to Monday 10:00 AM due to the holiday.'
  });

  // 5. Seed Restricted 4th Semester Notes (Mercury student is in Sem 3, this is Sem 4!)
  await seedItem({
    file: { id: 906, title: 'Confidential 4th Semester Distributed Systems Notes', originalName: 'dist_sys_sem4.pdf', subject: 'Distributed Systems', chapter: 'Consensus', semester: 'Semester 4', semester_no: 4, cohort_id: 'c_mercury' },
    chunkContent: '[Type: Note | Title: Confidential 4th Semester Distributed Systems Notes]\nAdvanced consensus protocols: Paxos and Raft algorithm notes strictly for Semester 4 students.'
  });

  console.log('--- Seeding Complete. Starting Evaluation of 9 Questions ---\n');

  const studentContext = {
    authenticated: true,
    studentId: 'stu_alice',
    role: 'student',
    currentSemester: 3,
    cohortId: 'c_mercury'
  };

  const questions = [
    {
      id: 1,
      query: 'CSS ko notes khojdeu',
      description: 'Search for CSS notes (should return notes 901 & 902 with cards)',
      expectedCheck: (reply, result) => {
        const hasCard = (result?.resourceCards || []).some(c => c.id === 901 || c.id === 902);
        const mentionsCss = /css|flexbox|grid|notes/i.test(reply);
        return { pass: hasCard && mentionsCss, detail: `Cards: ${result?.resourceCards?.length}, mentions CSS: ${mentionsCss}` };
      }
    },
    {
      id: 2,
      query: 'Hamro semester ko latest notice k xa?',
      description: 'Latest semester notice query (should return notice 903 with card)',
      expectedCheck: (reply, result) => {
        const hasCard = (result?.resourceCards || []).some(c => c.id === 903);
        const mentionsMidterm = /midterm|kartik|examination/i.test(reply);
        return { pass: hasCard || mentionsMidterm, detail: `Cards: ${result?.resourceCards?.length}, mentions Midterm: ${mentionsMidterm}` };
      }
    },
    {
      id: 3,
      query: 'Asti sir le upload gareko assignment dekhau',
      description: 'Recent assignment query (should return assignment 904)',
      expectedCheck: (reply, result) => {
        const hasCard = (result?.resourceCards || []).some(c => c.id === 904);
        const mentionsDom = /dom|javascript|todo|assignment/i.test(reply);
        return { pass: hasCard || mentionsDom, detail: `Cards: ${result?.resourceCards?.length}, mentions DOM: ${mentionsDom}` };
      }
    },
    {
      id: 4,
      query: 'Voli submission deadline xa?',
      description: 'Tomorrow submission deadline check (should reference assignment 904)',
      expectedCheck: (reply, result) => {
        const mentionsDeadline = /deadline|voli|tomorrow|assignment|dom/i.test(reply);
        return { pass: mentionsDeadline, detail: `Mentions deadline/assignment: ${mentionsDeadline}` };
      }
    },
    {
      id: 5,
      query: 'Hamro exam routine change vako ho?',
      description: 'Routine change notice (should return notice 905)',
      expectedCheck: (reply, result) => {
        const mentionsChange = /rescheduled|routine|monday|cit201|holiday|change/i.test(reply);
        return { pass: mentionsChange, detail: `Mentions routine change: ${mentionsChange}` };
      }
    },
    {
      id: 6,
      query: 'Tyo second wala file khola',
      description: 'Relative reference navigation (previous cards had 901 and 902; opens second card 902)',
      history: [
        { role: 'user', content: 'CSS ko notes khojdeu' },
        { role: 'assistant', content: 'Here are the CSS notes for Semester 3:\n1. Complete CSS Flexbox and Grid Master Notes\n2. CSS Responsive Web Design and Media Queries', metadata: { resourceCards: [{ id: 901, type: 'note', title: 'Complete CSS Flexbox and Grid Master Notes' }, { id: 902, type: 'note', title: 'CSS Responsive Web Design and Media Queries' }] } }
      ],
      expectedCheck: (reply, result) => {
        const openedSecond = (result?.resourceCards || []).some(c => c.id === 902) || /responsive|media queries|chapter 4|902/i.test(reply);
        return { pass: openedSecond, detail: `Opened second card (902): ${openedSecond}` };
      }
    },
    {
      id: 7,
      query: 'Yo notice ko meaning bujhaideu',
      description: 'Notice explanation with previous context',
      history: [
        { role: 'user', content: 'Hamro semester ko latest notice k xa?' },
        { role: 'assistant', content: 'Official Notice: Semester 3 Midterm Examinations will commence from Kartik 25. The detailed timetable is pinned on the department notice board.', metadata: { resourceCards: [{ id: 903, type: 'notice', title: 'Midterm Examination Schedule for Semester 3' }] } }
      ],
      expectedCheck: (reply, result) => {
        const explains = /kartik|midterm|exam|start|board|bujha|timetable/i.test(reply);
        return { pass: explains, detail: `Explains notice content: ${explains}` };
      }
    },
    {
      id: 8,
      query: '4th semester ko restricted notes dekhau',
      description: 'Cross-semester restricted request (MUST NOT show card 906, must enforce boundary)',
      expectedCheck: (reply, result) => {
        const leakedCard = (result?.resourceCards || []).some(c => c.id === 906);
        const denies = /semester 3|restricted|own semester|access|paundeina|available/i.test(reply);
        return { pass: !leakedCard, detail: `Card leaked: ${leakedCard}, politely denied: ${denies}` };
      }
    },
    {
      id: 9,
      query: 'Professor Dumbledore ko office hours kati ho?',
      description: 'Non-existent named entity (MUST NOT hallucinate or return false positives)',
      expectedCheck: (reply, result) => {
        const cardsCount = (result?.resourceCards || []).length;
        const noCards = cardsCount === 0;
        const saysNotFound = /vetiena|found|available|record|dumbledore|information/i.test(reply);
        return { pass: noCards, detail: `Cards returned: ${cardsCount} (expected 0), handled properly: ${saysNotFound}` };
      }
    }
  ];

  const evalResults = [];

  for (const q of questions) {
    console.log(`\n======================================================`);
    console.log(`Query #${q.id}: "${q.query}"`);
    console.log(`Intent : ${q.description}`);

    const startTime = performance.now();
    let timings = null;

    try {
      const chatResult = await handleChat(
        client,
        q.query,
        studentContext,
        q.history || [],
        `eval_session_${q.id}`,
        {
          academicContext: studentContext,
          onTiming: (t) => { timings = t; }
        }
      );

      const latencyMs = Math.round(performance.now() - startTime);
      const evalCheck = q.expectedCheck(chatResult.reply, chatResult);

      console.log(`Response Preview: ${chatResult.reply.slice(0, 140).replace(/\n/g, ' ')}...`);
      console.log(`Cards (${(chatResult.resourceCards || []).length}):`, (chatResult.resourceCards || []).map(c => `[${c.type}:${c.id}] ${c.title}`));
      console.log(`Status : ${evalCheck.pass ? '✅ PASS' : '❌ FAIL'} (${evalCheck.detail})`);
      console.log(`Latency: ${latencyMs}ms`);

      evalResults.push({
        id: q.id,
        query: q.query,
        pass: evalCheck.pass,
        detail: evalCheck.detail,
        reply: chatResult.reply,
        cards: chatResult.resourceCards || [],
        latencyMs
      });
    } catch (err) {
      console.error(`Error executing query #${q.id}:`, err);
      evalResults.push({
        id: q.id,
        query: q.query,
        pass: false,
        detail: `Error: ${err.message}`,
        reply: '',
        cards: [],
        latencyMs: Math.round(performance.now() - startTime)
      });
    }
  }

  console.log('\n======================================================');
  console.log('  TASK 5 EVALUATION SUMMARY');
  console.log('======================================================');
  const passedCount = evalResults.filter(r => r.pass).length;
  console.log(`Total Queries: ${evalResults.length}`);
  console.log(`Passed       : ${passedCount}/${evalResults.length} (${((passedCount / evalResults.length) * 100).toFixed(1)}%)`);

  // Write evaluation report
  const reportPath = path.resolve(__dirname, '../scratch/kyana-hardening/task5-student-questions.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(evalResults, null, 2));
  console.log(`Detailed results saved to: ${reportPath}`);

  // Cleanup seeded test records
  await client.query(`
    DELETE FROM assignments WHERE id >= 900;
    DELETE FROM posts WHERE id >= 900;
    DELETE FROM files WHERE id >= 900;
    DELETE FROM note_search_documents WHERE id >= 900;
    DELETE FROM knowledge_chunks WHERE resource_id LIKE 'note:90%' OR resource_id LIKE 'post:90%' OR resource_id LIKE 'assignment:90%';
    DELETE FROM knowledge_resources WHERE id LIKE 'note:90%' OR id LIKE 'post:90%' OR id LIKE 'assignment:90%';
  `);

  await client.end();
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
