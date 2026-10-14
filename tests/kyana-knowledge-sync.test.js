'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const {
  applyKnowledgeMigration,
  rollbackKnowledgeMigration
} = require('../lib/knowledge-schema');
const {
  onPostSaved,
  onPostDeleted,
  onPostModerationChanged,
  onAssignmentSaved,
  onAssignmentDeleted,
  persistKnowledgeResource
} = require('../lib/knowledge-sync');
const { processPendingJobs, reconcileKnowledge } = require('../lib/knowledge-worker');
const { runBackfill } = require('../scripts/backfill-knowledge');
const { buildPostKnowledge, buildAssignmentKnowledge } = require('../lib/knowledge-builder');

describe('KYANA 3.0 Step 3 — Sync Hooks, Worker, Reconciliation & Backfill (Docker PostgreSQL 16 + pgvector)', () => {
  let client;
  const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    client = new Client({ connectionString });
    await client.connect();

    // Drop knowledge tables and ensure fresh state
    await client.query(`
      DROP TABLE IF EXISTS knowledge_jobs CASCADE;
      DROP TABLE IF EXISTS knowledge_chunks CASCADE;
      DROP TABLE IF EXISTS knowledge_resources CASCADE;

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

      DELETE FROM assignments WHERE id IN (603);
      DELETE FROM posts WHERE id IN (401, 501, 601, 602);

      INSERT INTO cohorts (id, slot_code, display_name, current_semester)
      VALUES ('c_mercury', 'mercury', 'Mercury Cohort', 3)
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

      INSERT INTO students (studentId, name, role, account_status)
      VALUES ('stu_alice', 'Alice Student', 'student', 'active'),
             ('tea_bob', 'Bob Teacher', 'teacher', 'active')
      ON CONFLICT (studentId) DO UPDATE SET role = EXCLUDED.role;
    `);

    // Apply knowledge schema
    await applyKnowledgeMigration(client);
  });

  after(async () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    if (client) {
      await rollbackKnowledgeMigration(client).catch(() => {});
      await client.end();
    }
  });

  test('1. Post lifecycle: create, edit, hide, restore, delete flows update knowledge index correctly', async () => {
    // 1. Create post
    const postData = {
      id: 201,
      title: 'Operating Systems Chapter 3 Summary',
      content: 'Process synchronization requires atomic operations such as test-and-set and semaphores to prevent race conditions.',
      subject: 'Operating Systems',
      category: 'general',
      visibility: 'public',
      audience_scope: 'cohort',
      cohort_id: 'c_mercury',
      semester: 3,
      target_all_semesters: 0,
      author_id: 'stu_alice',
      author_role: 'student'
    };

    await onPostSaved(client, postData);

    const resCheck = await client.query('SELECT * FROM knowledge_resources WHERE id = $1', ['post:201']);
    assert.equal(resCheck.rows.length, 1);
    assert.equal(resCheck.rows[0].title, 'Operating Systems Chapter 3 Summary');
    assert.equal(resCheck.rows[0].deleted_at, null);
    assert.equal(resCheck.rows[0].hidden_at, null);

    const chunkCheck = await client.query('SELECT * FROM knowledge_chunks WHERE resource_id = $1', ['post:201']);
    assert.ok(chunkCheck.rows.length >= 1);
    assert.ok(chunkCheck.rows[0].content.includes('[Type: Post | Title: Operating Systems'));

    // 2. Edit post
    const initialHash = resCheck.rows[0].content_hash;
    const editedPostData = {
      ...postData,
      title: 'Operating Systems Chapter 3 & 4 Summary',
      content: 'Process synchronization and deadlock handling: mutual exclusion, hold and wait, no preemption, and circular wait.'
    };
    await onPostSaved(client, editedPostData);

    const editedResCheck = await client.query('SELECT * FROM knowledge_resources WHERE id = $1', ['post:201']);
    assert.equal(editedResCheck.rows[0].title, 'Operating Systems Chapter 3 & 4 Summary');
    assert.notEqual(editedResCheck.rows[0].content_hash, initialHash);

    // 3. Hide post (moderation threshold 3 reports)
    await onPostModerationChanged(client, 201, { isHidden: true });
    const hiddenResCheck = await client.query('SELECT hidden_at FROM knowledge_resources WHERE id = $1', ['post:201']);
    assert.ok(hiddenResCheck.rows[0].hidden_at !== null, 'hidden_at must be populated on moderation hide');

    // 4. Restore post (moderator dismisses reports)
    await onPostModerationChanged(client, 201, { isHidden: false });
    const restoredResCheck = await client.query('SELECT hidden_at FROM knowledge_resources WHERE id = $1', ['post:201']);
    assert.equal(restoredResCheck.rows[0].hidden_at, null, 'hidden_at must be cleared on moderation restore');

    // 5. Delete post
    await onPostDeleted(client, 201);
    const deletedResCheck = await client.query('SELECT deleted_at FROM knowledge_resources WHERE id = $1', ['post:201']);
    assert.ok(deletedResCheck.rows[0].deleted_at !== null, 'deleted_at must be populated on post delete');
  });

  test('2. Assignment lifecycle: create and delete update knowledge index correctly', async () => {
    const assignmentData = {
      id: 301,
      title: 'C Programming Lab 2: Linked Lists',
      description: 'Implement a singly linked list with insert, delete, and reverse operations.',
      instructions: 'Submit your solution as lab2.c. Ensure zero memory leaks with valgrind.',
      language: 'c',
      subject: 'Data Structures and Algorithms',
      semester: '3',
      semester_no: 3,
      deadline: new Date(Date.now() + 86400000).toISOString(),
      createdBy: 'tea_bob',
      cohort_id: 'c_mercury',
      audience_scope: 'cohort'
    };

    await onAssignmentSaved(client, assignmentData);

    const aResCheck = await client.query('SELECT * FROM knowledge_resources WHERE id = $1', ['assignment:301']);
    assert.equal(aResCheck.rows.length, 1);
    assert.equal(aResCheck.rows[0].source_authority_tier, 2, 'Teacher assignment must have authority tier 2');
    assert.equal(aResCheck.rows[0].web_url, '/code-lab/assignment.html?id=301');
    assert.equal(aResCheck.rows[0].mobile_route, '/assignments/301');

    await onAssignmentDeleted(client, 301);
    const aDeletedCheck = await client.query('SELECT deleted_at FROM knowledge_resources WHERE id = $1', ['assignment:301']);
    assert.ok(aDeletedCheck.rows[0].deleted_at !== null);
  });

  test('3. Failed embedding call creates a job and does NOT break the student action', async () => {
    // Pass invalid database/embedding payload that throws
    const invalidPost = {
      id: 401,
      title: 'Faulty Post',
      content: 'This post indexing will encounter simulated error.',
      author_id: 'stu_alice'
    };

    // Simulate an embedding call failure by providing forceEmbedError
    const failOption = {
      forceEmbedError: 'Simulated Gemini Service Outage'
    };

    // onPostSaved must NOT throw!
    await assert.doesNotReject(async () => {
      await onPostSaved(client, invalidPost, failOption);
    });

    // Check that knowledge_jobs has recorded a pending job
    const jobCheck = await client.query(`
      SELECT * FROM knowledge_jobs
      WHERE resource_id = 'post:401' AND operation = 'index'
    `);
    assert.equal(jobCheck.rows.length, 1);
    assert.equal(jobCheck.rows[0].status, 'pending');
    assert.ok(jobCheck.rows[0].last_error.includes('Simulated Gemini Service Outage'));
  });

  test('4. Running the worker twice causes NO duplicates', async () => {
    // Seed real post in posts table so worker can process job 401
    await client.query(`
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id)
      VALUES (401, 'stu_alice', 'Faulty Post Recovered', 'Recovered content text.', 3, 'c_mercury')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;
    `);

    // First worker run: should process pending job 401
    const run1 = await processPendingJobs(client, { batchSize: 10 });
    assert.equal(run1.processed, 1);
    assert.equal(run1.succeeded, 1);

    const jobAfterRun1 = await client.query("SELECT status FROM knowledge_jobs WHERE resource_id = 'post:401'");
    assert.equal(jobAfterRun1.rows[0].status, 'completed');

    // Second worker run: should find 0 pending jobs
    const run2 = await processPendingJobs(client, { batchSize: 10 });
    assert.equal(run2.processed, 0);

    // Verify exactly 1 resource and chunk exists
    const resCount = await client.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE id = 'post:401'");
    assert.equal(Number(resCount.rows[0].c), 1);
  });

  test('5. Reconciliation removes an orphan when source record is hard deleted', async () => {
    // Insert post 501 into posts and index it
    await client.query(`
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id)
      VALUES (501, 'stu_alice', 'Orphan Candidate Post', 'Will be hard deleted.', 3, 'c_mercury')
    `);
    const built = buildPostKnowledge({ id: 501, title: 'Orphan Candidate Post', content: 'Will be hard deleted.' });
    await persistKnowledgeResource(client, built);

    // Confirm it exists in knowledge_resources
    const beforeCheck = await client.query("SELECT deleted_at FROM knowledge_resources WHERE id = 'post:501'");
    assert.equal(beforeCheck.rows[0].deleted_at, null);

    // Hard-delete the source post from posts table
    await client.query('DELETE FROM posts WHERE id = 501');

    // Run reconciliation
    const reconStats = await reconcileKnowledge(client);
    assert.ok(reconStats.orphansRemoved >= 1);

    // Verify orphan in knowledge_resources is soft-deleted
    const afterCheck = await client.query("SELECT deleted_at FROM knowledge_resources WHERE id = 'post:501'");
    assert.ok(afterCheck.rows[0].deleted_at !== null, 'Orphan resource must have deleted_at set after reconciliation');
  });

  test('6. Backfill script is idempotent: dry-run does not mutate, apply mutates, 2nd apply skips all matching hashes', async () => {
    // Seed posts and assignments in base tables
    await client.query(`
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id)
      VALUES (601, 'stu_alice', 'Backfill Post Alpha', 'Content for post alpha', 1, 'c_mercury'),
             (602, 'stu_alice', 'Backfill Post Beta', 'Content for post beta', 1, 'c_mercury')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO assignments (id, title, description, language, subject, semester, createdBy, createdAt, cohort_id)
      VALUES (603, 'Backfill Assignment Gamma', 'Description gamma', 'python', 'CIT103', '1', 'tea_bob', CURRENT_TIMESTAMP, 'c_mercury')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1. Dry Run: counts scanned and pending items, but does not mutate knowledge_resources
    const dryStats = await runBackfill(client, { isDryRun: true, batchSize: 50, throttleMs: 0 });
    assert.ok(dryStats.posts.scanned >= 2);
    assert.ok(dryStats.assignments.scanned >= 1);

    const dryCheck = await client.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE id IN ('post:601', 'post:602', 'assignment:603')");
    assert.equal(Number(dryCheck.rows[0].c), 0, 'Dry-run must not insert any rows');

    // 2. Apply: mutates database and indexes rows
    const apply1Stats = await runBackfill(client, { isDryRun: false, batchSize: 50, throttleMs: 0 });
    assert.ok(apply1Stats.posts.indexed >= 2);
    assert.ok(apply1Stats.assignments.indexed >= 1);

    const applyCheck = await client.query("SELECT COUNT(*) AS c FROM knowledge_resources WHERE id IN ('post:601', 'post:602', 'assignment:603')");
    assert.equal(Number(applyCheck.rows[0].c), 3, 'Apply must insert all 3 resources');

    // 3. Second Apply: idempotent! Since hashes match, 100% of rows are skipped
    const apply2Stats = await runBackfill(client, { isDryRun: false, batchSize: 50, throttleMs: 0 });
    assert.ok(apply2Stats.posts.skipped >= 2, 'Unchanged posts must be skipped');
    assert.ok(apply2Stats.assignments.skipped >= 1, 'Unchanged assignments must be skipped');
    assert.equal(apply2Stats.posts.failed, 0);
    assert.equal(apply2Stats.assignments.failed, 0);
  });

  test('7. Internal reconcile endpoint: enforces secret authentication and runs safely', async () => {
    const express = require('express');
    const internalKnowledgeRouter = require('../routes/internal-knowledge');
    const app = express();
    app.use(express.json());
    app.locals.db = client;
    app.use('/api/internal/knowledge', internalKnowledgeRouter);

    process.env.INTERNAL_CRON_SECRET = 'super-secret-cron-token-123';

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 1. Unauthorized request (missing secret) -> 403
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/internal/knowledge/reconcile`, {
        method: 'POST'
      });
      assert.equal(unauthRes.status, 403);

      // 2. Unauthorized request (wrong secret) -> 403
      const wrongRes = await fetch(`http://127.0.0.1:${port}/api/internal/knowledge/reconcile`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong-token' }
      });
      assert.equal(wrongRes.status, 403);

      // 3. Unset secret in environment -> fail closed 503
      delete process.env.INTERNAL_CRON_SECRET;
      delete process.env.CRON_SECRET;
      const unconfigRes = await fetch(`http://127.0.0.1:${port}/api/internal/knowledge/reconcile`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'any-token' }
      });
      assert.equal(unconfigRes.status, 503);
      process.env.INTERNAL_CRON_SECRET = 'super-secret-cron-token-123';

      // 4. Authorized request to worker endpoint with x-cron-secret
      const workerRes = await fetch(`http://127.0.0.1:${port}/api/internal/knowledge/worker`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'super-secret-cron-token-123' }
      });
      assert.equal(workerRes.status, 200);
      const workerJson = await workerRes.json();
      assert.equal(workerJson.success, true);
      assert.ok(workerJson.jobs);

      // 5. Authorized request to reconcile endpoint
      const authRes = await fetch(`http://127.0.0.1:${port}/api/internal/knowledge/reconcile`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer super-secret-cron-token-123' }
      });
      assert.equal(authRes.status, 200);
      const json = await authRes.json();
      assert.equal(json.success, true);
      assert.ok(json.reconciliation);
    } finally {
      delete process.env.INTERNAL_CRON_SECRET;
      server.close();
    }
  });
});

