#!/usr/bin/env node
'use strict';

/**
 * KYANA AI 3.0 — Quality Evaluation (G5b) & Relevance Cutoff Test (G4)
 * Runs against Docker PostgreSQL using REAL gemini-embedding-001 embeddings.
 * Evaluates:
 *   1. Keyword-only vs Vector-only vs Hybrid Recall@5 on 30 Multilingual Queries
 *   2. 15 "No Answer Exists" Queries under Minimum Evidence & Cutoff Rules
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
// Safely load environment files if present
for (const envFile of ['.env.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    try {
      process.loadEnvFile(fullPath);
    } catch (_) {}
  }
}

const { embedText } = require('../lib/knowledge-embeddings');
const { searchKnowledge, MIN_RELEVANCE_SCORE, MIN_KEYWORD_EVIDENCE_SCORE, MIN_SEMANTIC_EVIDENCE_SCORE } = require('../lib/knowledge-search');
const { applyKnowledgeMigration } = require('../lib/knowledge-schema');

const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

// 30 Multilingual Queries
const evalDataset = [
  // English (10 queries)
  { query: 'DBMS normalization notes', expectedId: 'post:701', lang: 'en' },
  { query: '1NF 2NF 3NF BCNF concepts', expectedId: 'post:701', lang: 'en' },
  { query: 'Terminal semester examination schedule', expectedId: 'post:702', lang: 'en' },
  { query: 'Exam routine announcement', expectedId: 'post:702', lang: 'en' },
  { query: 'Python OOP inheritance assignment', expectedId: 'assignment:703', lang: 'en' },
  { query: 'Polymorphism code lab deadline', expectedId: 'assignment:703', lang: 'en' },
  { query: 'Relational database theory', expectedId: 'post:701', lang: 'en' },
  { query: 'Terminal exam starts next week', expectedId: 'post:702', lang: 'en' },
  { query: 'Object oriented programming assignment', expectedId: 'assignment:703', lang: 'en' },
  { query: 'Gandaki university semester exam notice', expectedId: 'post:702', lang: 'en' },

  // Romanized Nepali (10 queries)
  { query: 'DBMS ko normalization notes kata cha?', expectedId: 'post:701', lang: 'ne-rom' },
  { query: 'Database ko 1NF ra 2NF barema', expectedId: 'post:701', lang: 'ne-rom' },
  { query: 'Exam routine kahile aauxa?', expectedId: 'post:702', lang: 'ne-rom' },
  { query: 'Pariksha ko schedule aayo ki nai?', expectedId: 'post:702', lang: 'ne-rom' },
  { query: 'Python ko assignment kaile bujhaune?', expectedId: 'assignment:703', lang: 'ne-rom' },
  { query: 'OOP polymorphism ko lab assignment', expectedId: 'assignment:703', lang: 'ne-rom' },
  { query: 'Gandaki university exam routine notice', expectedId: 'post:702', lang: 'ne-rom' },
  { query: 'Normalization ko notes chahiyo', expectedId: 'post:701', lang: 'ne-rom' },
  { query: 'Python lab assignment deadline kahile ho?', expectedId: 'assignment:703', lang: 'ne-rom' },
  { query: 'Semester 3 ko exam notice', expectedId: 'post:702', lang: 'ne-rom' },

  // Devanagari Nepali (10 queries)
  { query: 'परीक्षा तालिका कहिले आउँछ?', expectedId: 'post:702', lang: 'ne-dev' },
  { query: 'गण्डकी विश्वविद्यालय परीक्षा तालिका सूचना', expectedId: 'post:702', lang: 'ne-dev' },
  { query: 'सेमेस्टर परीक्षा सम्बन्धी सूचना', expectedId: 'post:702', lang: 'ne-dev' },
  { query: 'डेटाबेस नर्मलाइजेसन नोटहरू', expectedId: 'post:701', lang: 'ne-dev' },
  { query: 'डेटाबेसको 1NF र 2NF', expectedId: 'post:701', lang: 'ne-dev' },
  { query: 'पाइथन ल्याब असाइनमेन्ट', expectedId: 'assignment:703', lang: 'ne-dev' },
  { query: 'अब्जेक्ट ओरिएन्टेड प्रोग्रामिङ', expectedId: 'assignment:703', lang: 'ne-dev' },
  { query: 'परीक्षा सम्बन्धी जानकारी', expectedId: 'post:702', lang: 'ne-dev' },
  { query: 'कम्प्युटर साइन्स नोट', expectedId: 'post:701', lang: 'ne-dev' },
  { query: 'ल्याब काम बुझाउने अन्तिम मिति', expectedId: 'assignment:703', lang: 'ne-dev' }
];

// 20 "No Answer Exists" Queries (Non-existent faculty, fake courses, unrelated queries, common words)
const noAnswerDataset = [
  'Professor Dumbledore office hours in room 404',
  'Quantum teleportation and warp drive lab manual',
  'Gandaki university astrophysics final exam routine',
  'Medieval European history lecture slides by Dr. Higgins',
  'Underwater basket weaving assignment submission date',
  'Intergalactic federation treaty notes CIT999',
  'Hogwarts sorting hat ceremony schedule',
  'Ferrari engine repair workshop syllabus',
  'Doctor Strange mystic arts midterm exam',
  'Organic chemistry hydrocarbon synthesis problem set 5',
  'Cryptocurrency trading bot seminar at Mars campus',
  'Shakespearean tragedy analysis CIT707 notes',
  'Moon rover trajectory calculations homework',
  'Martian colonial law case studies',
  'Time travel paradoxes exam syllabus',
  'what is the notice',
  'can you show me the post',
  'is there any general announcement today',
  'who is the new teacher in college',
  'what are the notes about'
];

async function main() {
  process.env.KYANA_KNOWLEDGE_V3 = 'true';
  process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
  process.env.ENABLE_LIVE_GEMINI_IN_TESTS = 'true';

  const client = new Client({ connectionString });
  await client.connect();

  console.log('--- KYANA 3.0 EVALUATION WITH REAL GEMINI EMBEDDINGS ---');

  // Ensure base schema and migration
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

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      title TEXT,
      content TEXT NOT NULL,
      cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
      semester_no INTEGER,
      type TEXT NOT NULL DEFAULT 'status',
      category TEXT NOT NULL DEFAULT 'general',
      audience_scope TEXT NOT NULL DEFAULT 'cohort',
      visibility TEXT NOT NULL DEFAULT 'everyone',
      target_all_semesters INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      deadline TIMESTAMPTZ,
      createdBy TEXT REFERENCES students(studentId) ON DELETE CASCADE,
      createdAt TIMESTAMPTZ NOT NULL,
      cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'cohort'
    );

    CREATE TABLE IF NOT EXISTS post_target_semesters (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
      PRIMARY KEY (post_id, semester)
    );

    INSERT INTO cohorts (id, slot_code, display_name, current_semester)
    VALUES ('c_mercury', 'mercury', 'Mercury Cohort', 3),
           ('c_venus', 'venus', 'Venus Cohort', 5)
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

    INSERT INTO students (studentId, name, role, account_status)
    VALUES ('stu_alice', 'Alice Mercury', 'student', 'active'),
           ('tea_carol', 'Carol Teacher', 'teacher', 'active')
    ON CONFLICT (studentId) DO UPDATE SET role = EXCLUDED.role;
  `);

  await applyKnowledgeMigration(client);

  // Clean seed posts & assignments
  await client.query(`
    DELETE FROM assignments WHERE id >= 700;
    DELETE FROM posts WHERE id >= 700;
    DELETE FROM knowledge_chunks WHERE resource_id IN ('post:701', 'post:702', 'assignment:703');
    DELETE FROM knowledge_resources WHERE id IN ('post:701', 'post:702', 'assignment:703');

    INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
    VALUES
      (701, 'stu_alice', 'DBMS Normalization Notes', 'Relational database normalization 1NF 2NF 3NF BCNF concepts.', 3, 'c_mercury', 'general', 'everyone', 'cohort', 0),
      (702, 'tea_carol', 'Semester 3 Exam Schedule Notice', 'Gandaki University terminal semester examination starts next week.', 3, 'c_mercury', 'notice', 'everyone', 'all_students', 1);

    INSERT INTO assignments (id, title, description, language, subject, semester, deadline, createdBy, createdAt, cohort_id, semester_no, audience_scope)
    VALUES
      (703, 'Python Object Oriented Lab', 'Implement polymorphism and inheritance in Python.', 'python', 'CIT201', '3', CURRENT_TIMESTAMP + INTERVAL '7 days', 'tea_carol', CURRENT_TIMESTAMP, 'c_mercury', 3, 'cohort');

    INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, author_role, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, mobile_params, content_hash)
    VALUES
      ('post:701', 'post', 701, 'DBMS Normalization Notes', 5, 'stu_alice', 'student', 'c_mercury', 3, 'cohort', 0, 'everyone', '/dashboard.html?post=701', '/post/701', '{"id":701}'::jsonb, 'hash_701'),
      ('post:702', 'notice', 702, 'Semester 3 Exam Schedule Notice', 2, 'tea_carol', 'teacher', 'c_mercury', 3, 'all_students', 1, 'everyone', '/notices.html?id=702', '/notice/702', '{"id":702}'::jsonb, 'hash_702'),
      ('assignment:703', 'assignment', 703, 'Python Object Oriented Lab', 3, 'tea_carol', 'teacher', 'c_mercury', 3, 'cohort', 0, 'everyone', '/code-lab/assignment.html?id=703', '/assignments/703', '{"id":703}'::jsonb, 'hash_703');
  `);

  // Re-seed with real Gemini embeddings for target resources
  const resourcesToEmbed = [
    {
      id: 'post:701',
      text: '[Type: Post | Title: DBMS Normalization Notes]\nRelational database normalization 1NF 2NF 3NF BCNF concepts and examples.'
    },
    {
      id: 'post:702',
      text: '[Type: Notice | Title: Semester 3 Exam Schedule Notice]\nGandaki University terminal semester examination starts next week. Examination routine published.'
    },
    {
      id: 'assignment:703',
      text: '[Type: Assignment | Title: Python Object Oriented Lab]\nImplement polymorphism and inheritance in Python code lab assignment.'
    }
  ];

  console.log('Generating real Gemini embeddings for base documents...');
  for (const item of resourcesToEmbed) {
    const vec = await embedText(item.text, { taskType: 'RETRIEVAL_DOCUMENT' });
    const vecStr = '[' + vec.join(',') + ']';
    await client.query(`
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
      VALUES ($1, $2, 0, $3, 'gemini-embedding-001', $4::vector(768))
      ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, content = EXCLUDED.content
    `, [item.id + ':c0', item.id, item.text, vecStr]);
  }
  console.log('Base documents embedded successfully with real Gemini vectors.');

  const aliceContext = {
    authenticated: true,
    studentId: 'stu_alice',
    role: 'student',
    cohortId: 'c_mercury',
    currentSemester: 3
  };

  // Helper function to evaluate recall
  async function evaluateMode(modeName, optionsOverride) {
    const stats = { en: { total: 0, hits: 0 }, 'ne-rom': { total: 0, hits: 0 }, 'ne-dev': { total: 0, hits: 0 } };
    let totalHits = 0;

    for (const testCase of evalDataset) {
      stats[testCase.lang].total++;
      const results = await searchKnowledge(client, aliceContext, testCase.query, Object.assign({ limit: 5, minScore: 0.20 }, optionsOverride));
      const top5Ids = results.slice(0, 5).map(r => r.id);
      if (top5Ids.includes(testCase.expectedId)) {
        stats[testCase.lang].hits++;
        totalHits++;
      }
    }

    const enRecall = ((stats.en.hits / stats.en.total) * 100).toFixed(1);
    const romRecall = ((stats['ne-rom'].hits / stats['ne-rom'].total) * 100).toFixed(1);
    const devRecall = ((stats['ne-dev'].hits / stats['ne-dev'].total) * 100).toFixed(1);
    const overall = ((totalHits / evalDataset.length) * 100).toFixed(1);

    console.log(`\nMode: ${modeName}`);
    console.log(`  English Recall@5          : ${enRecall}% (${stats.en.hits}/${stats.en.total})`);
    console.log(`  Romanized Nepali Recall@5 : ${romRecall}% (${stats['ne-rom'].hits}/${stats['ne-rom'].total})`);
    console.log(`  Devanagari Nepali Recall@5: ${devRecall}% (${stats['ne-dev'].hits}/${stats['ne-dev'].total})`);
    console.log(`  OVERALL Recall@5          : ${overall}% (${totalHits}/${evalDataset.length})`);

    return { enRecall, romRecall, devRecall, overall };
  }

  // 1. Keyword-only (Full-Text Search)
  const keywordResults = await evaluateMode('Keyword-Only (Full-Text Search)', { searchMode: 'keyword_only', minScore: 0.15 });

  // 2. Vector-only (Real Gemini Embedding Semantic Search)
  const vectorResults = await evaluateMode('Vector-Only (Real Gemini Embeddings)', { searchMode: 'vector_only', minScore: 0.20, timeoutMs: 5000 });

  // 3. Hybrid (Live Gemini Embedding + FTS)
  const hybridResults = await evaluateMode('Hybrid (Real Gemini Embeddings + FTS)', { searchMode: 'hybrid', minScore: 0.20, timeoutMs: 5000 });

  // 3. Test 15 "No Answer Exists" Queries
  console.log('\n--- TESTING 15 "NO ANSWER EXISTS" QUERIES UNDER RELEVANCE CUTOFF (G4) ---');
  let falsePositiveCount = 0;
  for (const q of noAnswerDataset) {
    const results = await searchKnowledge(client, aliceContext, q, { limit: 5, minScore: MIN_RELEVANCE_SCORE });
    if (results.length > 0) {
      falsePositiveCount++;
      console.log(`  [FALSE POSITIVE] Query: "${q}" -> Returned: ${results.map(r => `${r.id} (${r.score})`).join(', ')}`);
    } else {
      console.log(`  [CORRECT 0 RESULTS] Query: "${q}" -> 0 results`);
    }
  }

  console.log(`\nRelevance Cutoff Summary:`);
  console.log(`  Total Unrelated Queries: ${noAnswerDataset.length}`);
  console.log(`  Wrongly Returned Results: ${falsePositiveCount}`);
  console.log(`  Correctly Blocked (0 results): ${noAnswerDataset.length - falsePositiveCount} (${(((noAnswerDataset.length - falsePositiveCount)/noAnswerDataset.length)*100).toFixed(1)}%)`);

  await client.end();
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
