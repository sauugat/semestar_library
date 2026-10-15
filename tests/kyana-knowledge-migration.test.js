'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  isKnowledgeV3Enabled,
  applyKnowledgeMigration,
  rollbackKnowledgeMigration,
  isKnowledgeSchemaReady,
  ensureKnowledgeSchema
} = require('../lib/knowledge-schema');

describe('KYANA 3.0 Step 2 — Unified Knowledge Schema & Migrations (Docker PostgreSQL 16 + pgvector)', () => {
  let client;
  const connectionString = process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    client = new Client({ connectionString });
    await client.connect();

    // Clean drop knowledge tables
    await client.query(`
      DROP TABLE IF EXISTS knowledge_jobs CASCADE;
      DROP TABLE IF EXISTS knowledge_chunks CASCADE;
      DROP TABLE IF EXISTS knowledge_resources CASCADE;
    `);

    // Check if students table exists; if not, and schema.sql exists in workspace root, load it
    const checkStudents = await client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'students'
    `);
    if (checkStudents.rows.length === 0) {
      const schemaSqlPath = path.join(__dirname, '..', 'schema.sql');
      if (fs.existsSync(schemaSqlPath)) {
        let realSchemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
        realSchemaSql = realSchemaSql
          .split('\n')
          .filter(line => !line.trim().startsWith('\\'))
          .join('\n');
        await client.query(realSchemaSql);
      }
    } else {
      // Set up REAL production schema matching migrate.js, lib/academic-context.js, and lib/posts.js
      await client.query(`
        CREATE TABLE IF NOT EXISTS students (
          studentId VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          passwordHash VARCHAR(255) NOT NULL,
          avatarUrl TEXT,
          bio TEXT,
          department VARCHAR(100) DEFAULT 'BIT',
          semester VARCHAR(50) DEFAULT 'Semester 1',
          githubUrl TEXT,
          linkedinUrl TEXT,
          role VARCHAR(50) DEFAULT 'student',
          account_status VARCHAR(20) DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS cohorts (
          id TEXT PRIMARY KEY,
          slot_code TEXT NOT NULL CHECK (slot_code IN ('mercury', 'venus', 'earth', 'mars')),
          group_code TEXT,
          display_name TEXT NOT NULL,
          intake_year INTEGER,
          intake_identifier TEXT,
          current_semester INTEGER NOT NULL CHECK (current_semester BETWEEN 1 AND 8),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'archived')),
          version INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          graduated_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          author_id VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          subject VARCHAR(100),
          semester INTEGER,
          cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
          audience_scope VARCHAR(20) DEFAULT 'cohort',
          visibility VARCHAR(20) DEFAULT 'public',
          target_all_semesters INTEGER DEFAULT 0,
          is_pinned INTEGER DEFAULT 0,
          category VARCHAR(50) DEFAULT 'general',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMPTZ,
          moderation_status VARCHAR(20) DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS assignments (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          language TEXT NOT NULL,
          subject TEXT,
          semester TEXT,
          deadline TIMESTAMPTZ,
          pdfUrl TEXT,
          pdfName TEXT,
          createdBy TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          createdAt TIMESTAMPTZ NOT NULL,
          cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
          semester_no INTEGER,
          audience_scope TEXT DEFAULT 'cohort'
        );
      `);
    }

    // Seed sample student and cohort safely
    const existingMercury = await client.query("SELECT id FROM cohorts WHERE slot_code = 'mercury' LIMIT 1");
    if (existingMercury.rows.length === 0) {
      await client.query(`
        INSERT INTO cohorts (id, slot_code, display_name, current_semester) 
        VALUES ('cohort_test_1', 'mercury', 'Mercury 2026', 3) 
        ON CONFLICT (id) DO NOTHING;
      `);
    }

    await client.query(`
      INSERT INTO students (studentId, name, passwordHash, role, account_status) 
      VALUES ('STU_TEST_01', 'Test Student', 'hash123', 'student', 'active') 
      ON CONFLICT (studentId) DO NOTHING;
    `);
  });

  after(async () => {
    if (client) {
      await client.end();
    }
  });

  test('Feature flag check: KYANA_KNOWLEDGE_V3 defaults to false when undefined', () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    delete process.env.KYANA_KNOWLEDGE_V3_USERS;
    assert.equal(isKnowledgeV3Enabled(), false);

    process.env.KYANA_KNOWLEDGE_V3 = 'false';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    assert.equal(isKnowledgeV3Enabled(), false);

    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    assert.equal(isKnowledgeV3Enabled(), true);

    // Reset
    delete process.env.KYANA_KNOWLEDGE_V3;
    delete process.env.KYANA_KNOWLEDGE_V3_USERS;
  });

  test('ensureKnowledgeSchema skips migration when feature flag is OFF', async () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    const res = await ensureKnowledgeSchema(client);
    assert.equal(res.active, false);
    assert.equal(res.status, 'disabled_by_feature_flag');
  });

  test('Real schema column verification: verify students.studentId and cohorts.id types', async () => {
    const studentCol = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'students' AND column_name = 'studentid'
    `);
    assert.equal(studentCol.rows.length, 1);
    assert.equal(studentCol.rows[0].data_type, 'character varying');
    assert.equal(studentCol.rows[0].character_maximum_length, 50);
    assert.equal(studentCol.rows[0].is_nullable, 'NO');

    const cohortCol = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'cohorts' AND column_name = 'id'
    `);
    assert.equal(cohortCol.rows.length, 1);
    assert.equal(cohortCol.rows[0].data_type, 'text');
    assert.equal(cohortCol.rows[0].is_nullable, 'NO');
  });

  test('UP Migration: applies cleanly on real schema, creates vector extension, tables, and indexes', async () => {
    await applyKnowledgeMigration(client);

    const readyCheck = await isKnowledgeSchemaReady(client);
    assert.equal(readyCheck.ready, true);
    assert.equal(readyCheck.hasVector, true);
    assert.equal(readyCheck.hasResourcesTable, true);
    assert.equal(readyCheck.hasChunksTable, true);
    assert.equal(readyCheck.hasJobsTable, true);

    // Verify vector column dimensionality (768)
    const colRes = await client.query(`
      SELECT atttypmod 
      FROM pg_attribute 
      WHERE attrelid = 'knowledge_chunks'::regclass 
        AND attname = 'embedding'
    `);
    assert.equal(colRes.rows.length, 1);
    assert.equal(colRes.rows[0].atttypmod, 768, 'Embedding column must have vector dimensionality of 768');

    // Verify hidden_at column exists on knowledge_resources
    const hiddenColRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'knowledge_resources' 
        AND column_name = 'hidden_at'
    `);
    assert.equal(hiddenColRes.rows.length, 1);
    assert.equal(hiddenColRes.rows[0].data_type, 'timestamp with time zone');

    // Verify idx_kr_scope exists on knowledge_resources
    const scopeIndexRes = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'knowledge_resources' 
        AND indexname = 'idx_kr_scope'
    `);
    assert.equal(scopeIndexRes.rows.length, 1);

    // Verify idx_kj_status exists on knowledge_jobs
    const jobStatusIndexRes = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'knowledge_jobs' 
        AND indexname = 'idx_kj_status'
    `);
    assert.equal(jobStatusIndexRes.rows.length, 1);

    // Verify uq_kj_pending_resource_op exists on knowledge_jobs
    const partialUqIndexRes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'knowledge_jobs' 
        AND indexname = 'uq_kj_pending_resource_op'
    `);
    assert.ok(partialUqIndexRes.rows[0].indexdef.includes("WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]))"));
  });

  test('Partial unique constraint on knowledge_jobs prevents duplicate pending/processing jobs', async () => {
    // Insert initial pending job
    await client.query(`
      INSERT INTO knowledge_jobs (resource_id, resource_type, operation, status)
      VALUES ('post:1001', 'post', 'index', 'pending')
    `);

    // Duplicate pending job should throw unique violation error (code 23505)
    await assert.rejects(async () => {
      await client.query(`
        INSERT INTO knowledge_jobs (resource_id, resource_type, operation, status)
        VALUES ('post:1001', 'post', 'index', 'pending')
      `);
    }, (err) => err.code === '23505');

    // Different operation for same resource should succeed
    await client.query(`
      INSERT INTO knowledge_jobs (resource_id, resource_type, operation, status)
      VALUES ('post:1001', 'post', 'delete', 'pending')
    `);

    // Clean up
    await client.query(`DELETE FROM knowledge_jobs WHERE resource_id = 'post:1001'`);
  });

  test('Data integrity: insert and retrieve knowledge resource with hidden_at, chunk, and job', async () => {
    // Lookup existing cohort id
    const cRes = await client.query('SELECT id FROM cohorts LIMIT 1');
    const validCohortId = cRes.rows[0].id;

    // Insert resource
    await client.query(`
      INSERT INTO knowledge_resources (
        id, resource_type, canonical_id, title, source_authority_tier,
        author_id, author_role, cohort_id, semester_no, audience_scope,
        target_all_semesters, visibility, web_url, mobile_route, mobile_params, content_hash
      ) VALUES (
        'post:999', 'post', 999, 'Test Post on DBMS', 5,
        'STU_TEST_01', 'student', $1, 3, 'cohort',
        0, 'everyone', '/dashboard.html?post=999', '/post/999', '{"id": 999}'::jsonb, 'hash_abc123'
      )
    `, [validCohortId]);

    // Insert chunk with a dummy 768-dimension vector
    const zeroVector = '[' + new Array(768).fill(0.01).join(',') + ']';
    await client.query(`
      INSERT INTO knowledge_chunks (
        id, resource_id, chunk_index, content, embedding_model, embedding
      ) VALUES (
        'post:999:c0', 'post:999', 0, 'Database normalization ensures minimal redundancy and dependency.',
        'gemini-embedding-001', $1::vector(768)
      )
    `, [zeroVector]);

    // Insert completed retry job
    await client.query(`
      INSERT INTO knowledge_jobs (
        resource_id, resource_type, operation, status
      ) VALUES (
        'post:999', 'post', 'index', 'completed'
      )
    `);

    // Verify retrieval & vector distance calculation
    const queryVector = '[' + new Array(768).fill(0.01).join(',') + ']';
    const queryRes = await client.query(`
      SELECT c.id, c.content, c.embedding_model,
             (1 - (c.embedding <=> $1::vector(768))) AS cosine_similarity,
             r.title, r.web_url, r.mobile_route, r.hidden_at
      FROM knowledge_chunks c
      JOIN knowledge_resources r ON r.id = c.resource_id
      WHERE c.resource_id = 'post:999'
    `, [queryVector]);

    assert.equal(queryRes.rows.length, 1);
    const row = queryRes.rows[0];
    assert.equal(row.id, 'post:999:c0');
    assert.equal(row.embedding_model, 'gemini-embedding-001');
    assert.equal(row.title, 'Test Post on DBMS');
    assert.equal(row.web_url, '/dashboard.html?post=999');
    assert.equal(row.mobile_route, '/post/999');
    assert.equal(row.hidden_at, null);
    assert.ok(row.cosine_similarity > 0.99, 'Identical vector should yield cosine similarity close to 1.0');
  });

  test('DOWN Migration: fully rolls back tables cleanly and reversibly', async () => {
    await rollbackKnowledgeMigration(client);

    const readyCheck = await isKnowledgeSchemaReady(client);
    assert.equal(readyCheck.ready, false);
    assert.equal(readyCheck.hasResourcesTable, false);
    assert.equal(readyCheck.hasChunksTable, false);
    assert.equal(readyCheck.hasJobsTable, false);
  });

  test('Idempotence: UP migration can be re-run after rollback without errors', async () => {
    await applyKnowledgeMigration(client);
    const readyCheck1 = await isKnowledgeSchemaReady(client);
    assert.equal(readyCheck1.ready, true);

    // Run a second time to ensure idempotence
    await applyKnowledgeMigration(client);
    const readyCheck2 = await isKnowledgeSchemaReady(client);
    assert.equal(readyCheck2.ready, true);
  });
});

