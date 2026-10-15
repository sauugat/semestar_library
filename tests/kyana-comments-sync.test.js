'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const { applyKnowledgeMigration } = require('../lib/knowledge-schema');
const { asKnowledgeDb } = require('../lib/knowledge-db');
const { buildCommentKnowledge } = require('../lib/knowledge-builder');
const { onCommentSaved, onCommentDeleted, onCommentModerationChanged, onPostDeleted } = require('../lib/knowledge-sync');
const { searchKnowledge } = require('../lib/knowledge-search');
const { readResource, resourceCard } = require('../lib/kyana-access');

describe('KYANA 3.0 Phase 5 — Student & Teacher Comment Knowledge Engine Integration', () => {
  let client;
  let db;
  const connectionString = process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    client = new Client({ connectionString });
    await client.connect();
    db = asKnowledgeDb(client);

    // Apply knowledge schema
    await applyKnowledgeMigration(client);

    // Seed test cohorts, users, and post
    await client.query(`
      INSERT INTO cohorts (id, slot_code, display_name, current_semester)
      VALUES ('c_comments_sem3', 'earth', 'Comments Test Sem 3', 3),
             ('c_comments_sem5', 'mars', 'Comments Test Sem 5', 5)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO students (studentId, name, role, account_status)
      VALUES ('stu_author_s3', 'Bikash Student', 'student', 'active'),
             ('stu_cr_s3', 'Aayush CR', 'cr', 'active'),
             ('tea_sharma', 'Prof Sharma', 'teacher', 'active'),
             ('stu_other_s5', 'Suman Other', 'student', 'active')
      ON CONFLICT (studentId) DO NOTHING;

      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
      VALUES (9001, 'stu_author_s3', 'Database Normalization Clarification', 'Can someone clarify 3NF and BCNF differences?', 3, 'c_comments_sem3', 'general', 'everyone', 'cohort', 0)
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content;

      CREATE TABLE IF NOT EXISTS post_comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        content TEXT NOT NULL,
        parent_comment_id INTEGER,
        reply_to_user_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        moderation_status TEXT DEFAULT 'active',
        moderated_at TIMESTAMPTZ,
        moderated_by TEXT,
        moderation_reason TEXT
      );

      DELETE FROM post_comments WHERE post_id = 9001;
      DELETE FROM knowledge_resources WHERE id LIKE 'comment:%' OR id = 'post:9001';
    `);
  });

  after(async () => {
    if (client) {
      await client.query(`
        DELETE FROM post_comments WHERE post_id = 9001;
        DELETE FROM knowledge_resources WHERE id LIKE 'comment:%' OR id = 'post:9001';
        DELETE FROM posts WHERE id = 9001;
      `).catch(() => {});
      await client.end();
    }
  });

  test('1. Authority tier assignment: Teacher gets Tier 2, CR gets Tier 3, Student gets Tier 4', async () => {
    const parentPost = {
      id: 9001,
      title: 'Database Normalization Clarification',
      cohort_id: 'c_comments_sem3',
      semester_no: 3,
      audience_scope: 'cohort',
      visibility: 'everyone',
      target_all_semesters: 0
    };

    const teacherComm = { id: 101, post_id: 9001, user_id: 'tea_sharma', author_role: 'teacher', name: 'Prof Sharma', content: 'BCNF requires every determinant to be a candidate key.' };
    const crComm = { id: 102, post_id: 9001, user_id: 'stu_cr_s3', author_role: 'cr', name: 'Aayush CR', content: 'CR announcement: Sir will discuss this in Monday class.' };
    const stuComm = { id: 103, post_id: 9001, user_id: 'stu_author_s3', author_role: 'student', name: 'Bikash Student', content: 'Thanks, that clarifies the difference!' };

    const builtTeacher = buildCommentKnowledge(teacherComm, parentPost);
    const builtCR = buildCommentKnowledge(crComm, parentPost);
    const builtStu = buildCommentKnowledge(stuComm, parentPost);

    assert.equal(builtTeacher.resource.source_authority_tier, 2, 'Teacher comments must be Tier 2');
    assert.equal(builtCR.resource.source_authority_tier, 3, 'CR comments must be Tier 3');
    assert.equal(builtStu.resource.source_authority_tier, 4, 'Student comments must be Tier 4');

    assert.ok(builtTeacher.resource.title.includes('Teacher Clarification'));
    assert.ok(builtCR.resource.title.includes('CR Clarification'));
    assert.ok(builtStu.resource.title.includes('Student Discussion'));

    // Inherited parent post scope
    assert.equal(builtTeacher.resource.semester_no, 3);
    assert.equal(builtTeacher.resource.cohort_id, 'c_comments_sem3');
    assert.equal(builtTeacher.resource.canonical_code, 'post:9001');
    assert.equal(builtTeacher.resource.web_url, '/dashboard.html?post=9001&comment=101');
    assert.equal(builtTeacher.resource.mobile_route, '/post/9001');
  });

  test('2. Live indexing and search: Teacher clarification comment is retrieved for semester 3 student', async () => {
    // Insert comment row
    const commRes = await client.query(`
      INSERT INTO post_comments (id, post_id, user_id, content, created_at)
      VALUES (5001, 9001, 'tea_sharma', 'Official clarification: In 3NF, transitive functional dependencies are eliminated.', CURRENT_TIMESTAMP)
      RETURNING *
    `);
    const comment = commRes.rows[0];

    const postRes = await client.query('SELECT * FROM posts WHERE id = 9001');
    const parentPost = postRes.rows[0];

    // Trigger save hook
    await onCommentSaved(db, comment, parentPost, { keywordOnly: true });

    // Verify record in knowledge_resources
    const krRes = await client.query("SELECT * FROM knowledge_resources WHERE id = 'comment:5001'");
    assert.equal(krRes.rows.length, 1);
    assert.equal(krRes.rows[0].source_authority_tier, 2);
    assert.equal(krRes.rows[0].deleted_at, null);

    // Search as semester 3 student
    const s3Context = {
      authenticated: true,
      studentId: 'stu_author_s3',
      role: 'student',
      currentSemester: 3,
      cohort: { id: 'c_comments_sem3', currentSemester: 3 }
    };

    const results = await searchKnowledge(db, s3Context, 'functional dependencies 3NF clarification', { minScore: 0.01 });
    const match = results.find(r => r.id === 'comment:5001');
    assert.ok(match, 'Comment must be retrieved for authorized semester 3 student');
    assert.equal(match.authorityTier, 2);
    assert.ok(match.webUrl.includes('comment=5001'));

    // Verify student in semester 5 CANNOT see the comment (strict semester isolation)
    const s5Context = {
      authenticated: true,
      studentId: 'stu_other_s5',
      role: 'student',
      currentSemester: 5,
      cohort: { id: 'c_comments_sem5', currentSemester: 5 }
    };
    const s5Results = await searchKnowledge(db, s5Context, 'functional dependencies 3NF clarification', { minScore: 0.01 });
    const s5Match = s5Results.find(r => r.id === 'comment:5001');
    assert.equal(s5Match, undefined, 'Semester 5 student must NOT see Semester 3 comment');
  });

  test('3. Comment edit: content and content_hash update correctly', async () => {
    // Update comment in DB
    await client.query(`
      UPDATE post_comments
      SET content = 'Official clarification: In 3NF, transitive functional dependencies are strictly eliminated and X must be superkey.',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 5001
    `);

    // Fetch updated and sync
    await onCommentSaved(db, 5001, null, { keywordOnly: true });

    // Verify chunk content updated
    const chunkRes = await client.query("SELECT content FROM knowledge_chunks WHERE resource_id = 'comment:5001'");
    assert.ok(chunkRes.rows[0].content.includes('superkey'), 'Chunk content must reflect updated comment text');
  });

  test('4. Comment moderation / deletion: hidden or soft-deleted comments become immediately unsearchable', async () => {
    const s3Context = {
      authenticated: true,
      studentId: 'stu_author_s3',
      role: 'student',
      currentSemester: 3,
      cohort: { id: 'c_comments_sem3', currentSemester: 3 }
    };

    // 4a. Hide via moderation
    await onCommentModerationChanged(db, 5001, { isHidden: true });
    let res = await searchKnowledge(db, s3Context, 'transitive functional dependencies', { minScore: 0.01 });
    assert.equal(res.find(r => r.id === 'comment:5001'), undefined, 'Hidden comment must not appear in search');

    // 4b. Unhide
    await onCommentModerationChanged(db, 5001, { isHidden: false });
    res = await searchKnowledge(db, s3Context, 'transitive functional dependencies', { minScore: 0.01 });
    assert.ok(res.find(r => r.id === 'comment:5001'), 'Restored comment must reappear in search');

    // 4c. Soft delete comment
    await onCommentDeleted(db, 5001);
    res = await searchKnowledge(db, s3Context, 'transitive functional dependencies', { minScore: 0.01 });
    assert.equal(res.find(r => r.id === 'comment:5001'), undefined, 'Deleted comment must not appear in search');
  });

  test('5. Cascading parent post deletion: soft-deleting post marks child comments soft-deleted', async () => {
    // Restore comment 5001 for test
    await client.query("UPDATE knowledge_resources SET deleted_at = NULL WHERE id = 'comment:5001'");

    // Delete parent post 9001
    await onPostDeleted(db, 9001);

    const commRes = await client.query("SELECT deleted_at FROM knowledge_resources WHERE id = 'comment:5001'");
    assert.ok(commRes.rows[0].deleted_at !== null, 'Child comment index must be soft-deleted when parent post is deleted');
  });

  test('6. Resource card navigation: comment cards format deepLink and mobileRoute correctly', async () => {
    const commentRow = {
      id: 5001,
      post_id: 9001,
      name: 'Prof Sharma',
      content: 'Clarification notes',
      parent_post: { id: 9001, title: 'Database Normalization Clarification' }
    };

    const card = resourceCard('comment', commentRow);
    assert.equal(card.type, 'comment');
    assert.equal(card.id, 5001);
    assert.equal(card.deepLink, '/dashboard.html?post=9001&comment=5001');
    assert.equal(card.mobileRoute, '/post/9001');
    assert.deepEqual(card.mobileParams, { id: 9001, commentId: 5001 });
  });
});
