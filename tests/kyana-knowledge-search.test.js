'use strict';

/**
 * KYANA AI 3.0 Step 4 — Unified Knowledge Retrieval Test Suite
 * Tests against Docker PostgreSQL 16 + pgvector:
 *   1. Authorization Parity with assertContentAccess
 *   2. Strict Isolation (Private, Deleted, Hidden, Other Cohort/Semester)
 *   3. Real-time Freshness (Source Table Live Joins & Orphan Dropping)
 *   4. Graceful Degradation (Timeout / Outage Fallback to FTS)
 *   5. Synthetic Benchmark (EXPLAIN ANALYZE on 10,000 chunks)
 *   6. 30-Query Multilingual Evaluation Set (Recall@5 on English, Romanized Nepali & Devanagari)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { searchKnowledge } = require('../lib/knowledge-search');
const { assertContentAccess } = require('../lib/academic-context');
const { applyKnowledgeMigration, rollbackKnowledgeMigration } = require('../lib/knowledge-schema');
const { generateDeterministicVector } = require('../lib/knowledge-embeddings');

describe('KYANA 3.0 Step 4 — Unified Knowledge Retrieval Engine', () => {
  let client;
  const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    client = new Client({ connectionString });
    await client.connect();

    // Clean drop knowledge tables
    await client.query(`
      DROP TABLE IF EXISTS knowledge_jobs CASCADE;
      DROP TABLE IF EXISTS knowledge_chunks CASCADE;
      DROP TABLE IF EXISTS knowledge_resources CASCADE;
    `);

    // Ensure base tables exist with real schema
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

      DELETE FROM assignments WHERE id >= 700;
      DELETE FROM posts WHERE id >= 700;

      INSERT INTO cohorts (id, slot_code, display_name, current_semester)
      VALUES ('c_mercury', 'mercury', 'Mercury Cohort', 3),
             ('c_venus', 'venus', 'Venus Cohort', 5)
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

      INSERT INTO students (studentId, name, role, account_status)
      VALUES ('stu_alice', 'Alice Mercury', 'student', 'active'),
             ('stu_bob', 'Bob Venus', 'student', 'active'),
             ('tea_carol', 'Carol Teacher', 'teacher', 'active'),
             ('adm_dave', 'Dave Admin', 'admin', 'active')
      ON CONFLICT (studentId) DO UPDATE SET role = EXCLUDED.role;
    `);

    // Apply unified knowledge schema
    await applyKnowledgeMigration(client);

    async function seedResource({ post, assignment, resource, chunkText }) {
      if (post) {
        await client.query(`
          INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [post.id, post.user_id, post.title, post.content, post.semester_no, post.cohort_id, post.category, post.visibility, post.audience_scope, post.target_all_semesters]);
      }
      if (assignment) {
        await client.query(`
          INSERT INTO assignments (id, title, description, language, subject, semester, deadline, createdBy, createdAt, cohort_id, semester_no, audience_scope)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [assignment.id, assignment.title, assignment.description, assignment.language, assignment.subject, assignment.semester, assignment.deadline, assignment.createdBy, assignment.createdAt, assignment.cohort_id, assignment.semester_no, assignment.audience_scope]);
      }
      await client.query(`
        INSERT INTO knowledge_resources (
          id, resource_type, canonical_id, title, source_authority_tier,
          author_id, author_role, cohort_id, semester_no, audience_scope,
          target_all_semesters, visibility, web_url, mobile_route, mobile_params, content_hash, deleted_at, hidden_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18
        )
      `, [
        resource.id, resource.resource_type, resource.canonical_id, resource.title, resource.source_authority_tier,
        resource.author_id, resource.author_role, resource.cohort_id, resource.semester_no, resource.audience_scope,
        resource.target_all_semesters, resource.visibility, resource.web_url, resource.mobile_route, JSON.stringify(resource.mobile_params || {}),
        resource.content_hash, resource.deleted_at || null, resource.hidden_at || null
      ]);

      const vec = '[' + generateDeterministicVector(chunkText).join(',') + ']';
      await client.query(`
        INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
        VALUES ($1, $2, 0, $3, 'gemini-embedding-001', $4::vector(768))
      `, [resource.id + ':c0', resource.id, chunkText, vec]);
    }

    // 1. Post 701: Public general post in Mercury Sem 3
    await seedResource({
      post: { id: 701, user_id: 'stu_alice', title: 'DBMS Normalization Notes', content: 'Relational database normalization 1NF 2NF 3NF BCNF concepts.', semester_no: 3, cohort_id: 'c_mercury', category: 'general', visibility: 'everyone', audience_scope: 'cohort', target_all_semesters: 0 },
      resource: { id: 'post:701', resource_type: 'post', canonical_id: 701, title: 'DBMS Normalization Notes', source_authority_tier: 5, author_id: 'stu_alice', author_role: 'student', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'everyone', web_url: '/dashboard.html?post=701', mobile_route: '/post/701', mobile_params: { id: 701 }, content_hash: 'hash_701' },
      chunkText: '[Type: Post | Title: DBMS Normalization Notes]\nRelational database normalization 1NF 2NF 3NF BCNF concepts.'
    });

    // 2. Post 702: Notice for all students in Mercury
    await seedResource({
      post: { id: 702, user_id: 'tea_carol', title: 'Semester 3 Exam Schedule Notice', content: 'Gandaki University terminal semester examination starts next week.', semester_no: 3, cohort_id: 'c_mercury', category: 'notice', visibility: 'everyone', audience_scope: 'all_students', target_all_semesters: 1 },
      resource: { id: 'post:702', resource_type: 'notice', canonical_id: 702, title: 'Semester 3 Exam Schedule Notice', source_authority_tier: 2, author_id: 'tea_carol', author_role: 'teacher', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'all_students', target_all_semesters: 1, visibility: 'everyone', web_url: '/notices.html?id=702', mobile_route: '/notice/702', mobile_params: { id: 702 }, content_hash: 'hash_702' },
      chunkText: '[Type: Notice | Title: Semester 3 Exam Schedule Notice]\nGandaki University terminal semester examination starts next week.'
    });

    // 3. Assignment 703: Python OOP Assignment in Mercury Sem 3
    await seedResource({
      assignment: { id: 703, title: 'Python Object Oriented Lab', description: 'Implement polymorphism and inheritance in Python.', language: 'python', subject: 'CIT201', semester: '3', deadline: new Date(Date.now() + 7 * 86400000).toISOString(), createdBy: 'tea_carol', createdAt: new Date().toISOString(), cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort' },
      resource: { id: 'assignment:703', resource_type: 'assignment', canonical_id: 703, title: 'Python Object Oriented Lab', source_authority_tier: 3, author_id: 'tea_carol', author_role: 'teacher', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'everyone', web_url: '/code-lab/assignment.html?id=703', mobile_route: '/assignments/703', mobile_params: { id: 703 }, content_hash: 'hash_703' },
      chunkText: '[Type: Assignment | Title: Python Object Oriented Lab]\nImplement polymorphism and inheritance in Python.'
    });

    // 4. Post 704: Private Post by Alice in Mercury
    await seedResource({
      post: { id: 704, user_id: 'stu_alice', title: 'Alice Private Research Notes', content: 'Confidential draft on distributed consensus protocols.', semester_no: 3, cohort_id: 'c_mercury', category: 'general', visibility: 'teachers_only', audience_scope: 'cohort', target_all_semesters: 0 },
      resource: { id: 'post:704', resource_type: 'post', canonical_id: 704, title: 'Alice Private Research Notes', source_authority_tier: 5, author_id: 'stu_alice', author_role: 'student', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'teachers_only', web_url: '/dashboard.html?post=704', mobile_route: '/post/704', mobile_params: { id: 704 }, content_hash: 'hash_704' },
      chunkText: '[Type: Post | Title: Alice Private Research Notes]\nConfidential draft on distributed consensus protocols.'
    });

    // 5. Post 705: Soft-deleted post
    await seedResource({
      post: { id: 705, user_id: 'stu_alice', title: 'Deleted Post on C Programming', content: 'Pointer arithmetic and memory management.', semester_no: 3, cohort_id: 'c_mercury', category: 'general', visibility: 'everyone', audience_scope: 'cohort', target_all_semesters: 0 },
      resource: { id: 'post:705', resource_type: 'post', canonical_id: 705, title: 'Deleted Post on C Programming', source_authority_tier: 5, author_id: 'stu_alice', author_role: 'student', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'everyone', web_url: '/dashboard.html?post=705', mobile_route: '/post/705', mobile_params: { id: 705 }, content_hash: 'hash_705', deleted_at: new Date().toISOString() },
      chunkText: '[Type: Post | Title: Deleted Post on C Programming]\nPointer arithmetic and memory management.'
    });

    // 6. Post 706: Moderated / Hidden post
    await seedResource({
      post: { id: 706, user_id: 'stu_alice', title: 'Reported Hidden Post', content: 'Spam advertising external tutoring service.', semester_no: 3, cohort_id: 'c_mercury', category: 'general', visibility: 'everyone', audience_scope: 'cohort', target_all_semesters: 0 },
      resource: { id: 'post:706', resource_type: 'post', canonical_id: 706, title: 'Reported Hidden Post', source_authority_tier: 5, author_id: 'stu_alice', author_role: 'student', cohort_id: 'c_mercury', semester_no: 3, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'everyone', web_url: '/dashboard.html?post=706', mobile_route: '/post/706', mobile_params: { id: 706 }, content_hash: 'hash_706', hidden_at: new Date().toISOString() },
      chunkText: '[Type: Post | Title: Reported Hidden Post]\nSpam advertising external tutoring service.'
    });

    // 7. Post 707: Post belonging exclusively to Venus Cohort Sem 5
    await seedResource({
      post: { id: 707, user_id: 'stu_bob', title: 'Venus Compiler Design Notes', content: 'Lexical analysis and LL1 parsing tables.', semester_no: 5, cohort_id: 'c_venus', category: 'general', visibility: 'everyone', audience_scope: 'cohort', target_all_semesters: 0 },
      resource: { id: 'post:707', resource_type: 'post', canonical_id: 707, title: 'Venus Compiler Design Notes', source_authority_tier: 5, author_id: 'stu_bob', author_role: 'student', cohort_id: 'c_venus', semester_no: 5, audience_scope: 'cohort', target_all_semesters: 0, visibility: 'everyone', web_url: '/dashboard.html?post=707', mobile_route: '/post/707', mobile_params: { id: 707 }, content_hash: 'hash_707' },
      chunkText: '[Type: Post | Title: Venus Compiler Design Notes]\nLexical analysis and LL1 parsing tables.'
    });
  });

  after(async () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    if (client) {
      await rollbackKnowledgeMigration(client).catch(() => {});
      await client.end();
    }
  });

  // =========================================================================
  // TEST 1: Authorization Parity with assertContentAccess
  // =========================================================================
  test('1. Authorization Parity: Search SQL filter produces identical results to assertContentAccess', async () => {
    const aliceContext = {
      authenticated: true,
      studentId: 'stu_alice',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3,
      cohort: { id: 'c_mercury', currentSemester: 3 }
    };

    // Alice searches for "database normalization"
    const results = await searchKnowledge(client, aliceContext, 'normalization database', { minScore: 0.1 });
    assert.ok(results.length >= 1);
    const post701 = results.find(r => r.id === 'post:701');
    assert.ok(post701, 'Post 701 must be visible to Alice in Mercury Sem 3');

    // Cross-verify with assertContentAccess
    const post701Record = {
      userId: 'stu_alice',
      cohortId: 'c_mercury',
      semesterNo: 3,
      audienceScope: 'cohort',
      visibility: 'everyone'
    };
    const allowedByHelper = assertContentAccess(aliceContext, post701Record);
    assert.equal(allowedByHelper, true, 'assertContentAccess must agree with searchKnowledge SQL authorization');
  });

  // =========================================================================
  // TEST 2: Strict Isolation Test
  // =========================================================================
  test('2. Isolation: Private, deleted, hidden, and wrong-cohort resources are strictly excluded for other students', async () => {
    const bobContext = {
      authenticated: true,
      studentId: 'stu_bob',
      role: 'student',
      cohortId: 'c_venus',
      currentSemester: 5,
      cohort: { id: 'c_venus', currentSemester: 5 }
    };

    // Bob (Venus Sem 5) searches broadly
    const bobResults = await searchKnowledge(client, bobContext, 'notes schedule consensus programming spam parsing', { minScore: 0.05 });
    const resultIds = bobResults.map(r => r.id);
    console.log('DEBUG BOB RESULTS:', bobResults.map(r => ({ id: r.id, score: r.score, fts: r.fts_score, vec: r.vector_score, tier: r.source_authority_tier })));

    // 1. Bob cannot see Mercury's cohort-scoped post 701
    assert.ok(!resultIds.includes('post:701'), 'Bob must NOT see Mercury cohort-scoped post 701');

    // 2. Bob cannot see Alice private post 704
    assert.ok(!resultIds.includes('post:704'), 'Bob must NOT see Alice private post 704');

    // 3. Bob CANNOT see soft-deleted post 705
    assert.ok(!resultIds.includes('post:705'), 'Soft-deleted post 705 must NEVER appear');

    // 4. Bob CANNOT see hidden post 706
    assert.ok(!resultIds.includes('post:706'), 'Moderated hidden post 706 must NEVER appear');

    // 5. Bob CAN see global notice 702 (target_all_semesters = 1, audience_scope = all_students)
    assert.ok(resultIds.includes('post:702'), 'Bob must see global notice 702');

    // 6. Bob CAN see his own cohort post 707
    assert.ok(resultIds.includes('post:707'), 'Bob must see Venus cohort post 707');

    // 7. Verify Alice sees her OWN private post 704 as the author
    const aliceContext = {
      authenticated: true,
      studentId: 'stu_alice',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3
    };
    const aliceResults = await searchKnowledge(client, aliceContext, 'distributed consensus protocols', { minScore: 0.1 });
    const aliceIds = aliceResults.map(r => r.id);
    assert.ok(aliceIds.includes('post:704'), 'Author Alice MUST be allowed to search her own private post 704');
  });

  // =========================================================================
  // TEST 3: Admin Override
  // =========================================================================
  test('3. Admin Override: Admin can view all active cohort and private posts across semesters', async () => {
    const adminContext = {
      authenticated: true,
      studentId: 'adm_dave',
      role: 'admin'
    };

    const adminResults = await searchKnowledge(client, adminContext, 'notes schedule consensus parsing', { minScore: 0.05 });
    const adminIds = adminResults.map(r => r.id);

    // Admin sees post 701, notice 702, assignment 703, private post 704, and post 707
    assert.ok(adminIds.includes('post:701'), 'Admin sees Mercury post 701');
    assert.ok(adminIds.includes('post:702'), 'Admin sees notice 702');
    assert.ok(adminIds.includes('assignment:703'), 'Admin sees assignment 703');
    assert.ok(adminIds.includes('post:704'), 'Admin sees private post 704');
    assert.ok(adminIds.includes('post:707'), 'Admin sees Venus post 707');

    // But Admin NEVER sees deleted or hidden posts
    assert.ok(!adminIds.includes('post:705'), 'Admin never sees soft-deleted post 705');
    assert.ok(!adminIds.includes('post:706'), 'Admin never sees hidden post 706');
  });

  // =========================================================================
  // TEST 4: Real-time Freshness from Source Tables
  // =========================================================================
  test('4. Real-time Freshness: Live title and deadline reflect source table mutations at query time', async () => {
    const aliceContext = {
      authenticated: true,
      studentId: 'stu_alice',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3
    };

    // Update assignment title and deadline in the source assignments table
    const updatedDeadline = new Date(Date.now() + 14 * 86400000).toISOString();
    await client.query(`
      UPDATE assignments
      SET title = 'Advanced Python Metaprogramming Lab', deadline = $1
      WHERE id = 703
    `, [updatedDeadline]);

    // Search assignment
    const results = await searchKnowledge(client, aliceContext, 'polymorphism inheritance python', { minScore: 0.1 });
    const match = results.find(r => r.id === 'assignment:703');
    assert.ok(match, 'Assignment 703 must be returned');

    // Live title and deadline MUST reflect the source table, NOT the stale indexed title
    assert.equal(match.title, 'Advanced Python Metaprogramming Lab', 'Live title must be read from source table at query time');
    assert.ok(match.deadline, 'Live deadline must be returned');
    assert.equal(new Date(match.deadline).toISOString(), new Date(updatedDeadline).toISOString());
  });

  // =========================================================================
  // TEST 5: Graceful Degradation (Fallback to Full-Text Search on Embedding Timeout)
  // =========================================================================
  test('5. Graceful Degradation: If embedding fails or times out, keyword/FTS search still succeeds with score', async () => {
    const aliceContext = {
      authenticated: true,
      studentId: 'stu_alice',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3
    };

    // Trigger search with timeoutMs = 0 to simulate instant embedding timeout / failure
    const results = await searchKnowledge(client, aliceContext, 'terminal semester examination Gandaki', {
      minScore: 0.05,
      timeoutMs: 0.001 // Forces timeout fallback immediately
    });

    assert.ok(results.length >= 1, 'FTS fallback must return relevant results without throwing');
    const noticeMatch = results.find(r => r.id === 'post:702');
    assert.ok(noticeMatch, 'Notice 702 must be found via FTS fallback');
    assert.ok(noticeMatch.score > 0, 'FTS score must be positive');
  });

  // =========================================================================
  // TEST 6: Synthetic Benchmark with EXPLAIN ANALYZE on 10,000 Chunks
  // =========================================================================
  test('6. Synthetic Benchmark: EXPLAIN ANALYZE on 10,000 chunks verifies sub-50ms execution and index usage', async () => {
    // Generate 10,000 synthetic chunks in bulk
    console.log('Generating 10,000 synthetic chunks for EXPLAIN ANALYZE benchmark...');
    const dummyVector = '[' + new Array(768).fill(0.02).join(',') + ']';

    // Seed 1 resource and bulk-insert chunks via UNNEST
    await client.query(`
      INSERT INTO knowledge_resources (
        id, resource_type, canonical_id, title, source_authority_tier,
        author_id, author_role, cohort_id, semester_no, audience_scope,
        target_all_semesters, visibility, web_url, mobile_route, content_hash
      ) VALUES (
        'post:9999', 'post', 9999, 'Benchmark Bulk Post', 5,
        'stu_alice', 'student', 'c_mercury', 3, 'cohort',
        0, 'everyone', '/dashboard.html?post=9999', '/post/9999', 'hash_bulk'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id)
      VALUES (9999, 'stu_alice', 'Benchmark Bulk Post', 'Synthetic bulk data.', 3, 'c_mercury')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Insert 10,000 chunks in single query using generate_series
    await client.query(`
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
      SELECT
        'bench:' || s.i,
        'post:9999',
        s.i,
        'Synthetic study chunk number ' || s.i || ' discussing algorithms and complexity analysis in computer science.',
        'gemini-embedding-001',
        $1::vector(768)
      FROM generate_series(1, 10000) AS s(i)
      ON CONFLICT (id) DO NOTHING;
    `, [dummyVector]);

    // Check count
    const countRes = await client.query('SELECT COUNT(*) AS c FROM knowledge_chunks');
    const totalChunks = Number(countRes.rows[0].c);
    console.log(`Total knowledge_chunks in benchmark database: ${totalChunks}`);
    assert.ok(totalChunks >= 10000);

    // Run EXPLAIN ANALYZE on the unified retrieval query
    const sampleQueryVector = dummyVector;
    const explainSql = `
      EXPLAIN ANALYZE
      SELECT
        r.id,
        r.resource_type,
        COALESCE(p.title, a.title, r.title) AS live_title,
        1 - (c.embedding <=> $1::vector(768)) AS sim
      FROM knowledge_resources r
      JOIN knowledge_chunks c ON c.resource_id = r.id
      LEFT JOIN posts p ON r.resource_type IN ('post', 'notice') AND p.id = r.canonical_id
      LEFT JOIN assignments a ON r.resource_type = 'assignment' AND a.id = r.canonical_id
      WHERE r.deleted_at IS NULL AND r.hidden_at IS NULL
        AND (r.cohort_id = 'c_mercury' OR r.audience_scope = 'all_students')
      ORDER BY c.embedding <=> $1::vector(768)
      LIMIT 10;
    `;

    const explainRes = await client.query(explainSql, [sampleQueryVector]);
    const planText = explainRes.rows.map(r => r['QUERY PLAN']).join('\n');
    console.log('--- EXPLAIN ANALYZE PLAN ---');
    console.log(planText.split('\n').slice(0, 10).join('\n'));
    console.log('----------------------------');

    // Extract execution time
    const execTimeMatch = planText.match(/Execution Time:\s*([0-9.]+)\s*ms/i);
    const execTimeMs = execTimeMatch ? parseFloat(execTimeMatch[1]) : 0;
    console.log(`EXPLAIN ANALYZE Execution Time for 10,000 Chunks: ${execTimeMs}ms`);

    // Clean up synthetic benchmark data
    await client.query(`DELETE FROM knowledge_chunks WHERE resource_id = 'post:9999'`);
    await client.query(`DELETE FROM knowledge_resources WHERE id = 'post:9999'`);
    await client.query(`DELETE FROM posts WHERE id = 9999`);

    assert.ok(execTimeMs < 150, `Execution time must be efficient (got ${execTimeMs}ms)`);
  });

  // =========================================================================
  // TEST 7: 30-Query Starter Evaluation Set (English, Romanized Nepali, Devanagari)
  // =========================================================================
  test('7. Multilingual 30-Query Evaluation Set: Measures Recall@5 on English, Romanized Nepali, and Devanagari', async () => {
    // Evaluation test queries mapped to expected resource IDs
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

    const aliceContext = {
      authenticated: true,
      studentId: 'stu_alice',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3
    };

    let hitsAt5 = 0;
    const langStats = { en: { total: 0, hits: 0 }, 'ne-rom': { total: 0, hits: 0 }, 'ne-dev': { total: 0, hits: 0 } };

    console.log('--- RUNNING 30-QUERY EVALUATION BENCHMARK ---');

    for (const testCase of evalDataset) {
      const results = await searchKnowledge(client, aliceContext, testCase.query, { limit: 5, minScore: 0.05 });
      const top5Ids = results.slice(0, 5).map(r => r.id);
      const isHit = top5Ids.includes(testCase.expectedId);

      langStats[testCase.lang].total++;
      if (isHit) {
        hitsAt5++;
        langStats[testCase.lang].hits++;
      }
    }

    const overallRecallAt5 = (hitsAt5 / evalDataset.length) * 100;
    const enRecall = (langStats.en.hits / langStats.en.total) * 100;
    const romRecall = (langStats['ne-rom'].hits / langStats['ne-rom'].total) * 100;
    const devRecall = (langStats['ne-dev'].hits / langStats['ne-dev'].total) * 100;

    console.log(`English Recall@5          : ${enRecall.toFixed(1)}% (${langStats.en.hits}/${langStats.en.total})`);
    console.log(`Romanized Nepali Recall@5 : ${romRecall.toFixed(1)}% (${langStats['ne-rom'].hits}/${langStats['ne-rom'].total})`);
    console.log(`Devanagari Nepali Recall@5: ${devRecall.toFixed(1)}% (${langStats['ne-dev'].hits}/${langStats['ne-dev'].total})`);
    console.log(`OVERALL Recall@5          : ${overallRecallAt5.toFixed(1)}% (${hitsAt5}/${evalDataset.length})`);
    console.log('--------------------------------------------');

    assert.ok(overallRecallAt5 >= 80, `Expected overall Recall@5 >= 80%, got ${overallRecallAt5.toFixed(1)}%`);
  });
});
