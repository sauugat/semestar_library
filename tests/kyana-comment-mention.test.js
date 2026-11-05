'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const {
  KYANA_BOT_ID,
  KYANA_BOT_NAME,
  KYANA_BOT_ROLE,
  hasKyanaMention,
  extractMentionQuery,
  ensureKyanaBotAccount,
  resolveEntityContext,
  resolveThreadContext,
  retrieveRelatedAppData,
  generateKyanaCommentReply,
  postKyanaCommentReply,
  handleCommentMention
} = require('../lib/kyana-comment-agent');

const { createCommentOrReply, fetchPostComments } = require('../lib/comments');
const { ensurePostsSchema } = require('../lib/posts');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    isPostgres: false,
    exec: (sql) => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
    }
  };

  // Create core schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      avatarUrl TEXT,
      bio TEXT,
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 2',
      email TEXT,
      account_status TEXT DEFAULT 'active',
      verification_status TEXT DEFAULT 'verified'
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'status',
      category TEXT DEFAULT 'general',
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      target_all_semesters INTEGER DEFAULT 1,
      visibility TEXT DEFAULT 'everyone',
      audience_scope TEXT DEFAULT 'all_students',
      cohort_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_comment_id INTEGER,
      reply_to_user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      deleted_at TEXT,
      moderation_status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      semester TEXT,
      dueDate TEXT,
      totalMarks INTEGER,
      instructions TEXT,
      createdBy TEXT
    );

    CREATE TABLE IF NOT EXISTS assignment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      studentId TEXT NOT NULL,
      commentText TEXT NOT NULL,
      parent_comment_id INTEGER,
      reply_to_user_id TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      semester TEXT,
      chapter TEXT,
      description TEXT,
      uploadedBy TEXT
    );

    CREATE TABLE IF NOT EXISTS file_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileId INTEGER NOT NULL,
      studentId TEXT NOT NULL,
      commentText TEXT NOT NULL,
      parent_comment_id INTEGER,
      reply_to_user_id TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      subject_code TEXT,
      exam_date TEXT NOT NULL,
      calendar TEXT DEFAULT 'AD',
      weekday TEXT,
      exam_time TEXT,
      room TEXT,
      semester INTEGER,
      exam_type TEXT DEFAULT 'Internal'
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_id TEXT,
      title TEXT,
      body TEXT,
      entity_type TEXT,
      entity_id TEXT,
      secondary_entity_id TEXT,
      deep_link TEXT,
      web_path TEXT,
      group_key TEXT,
      priority TEXT DEFAULT 'normal',
      recipientStudentId TEXT,
      isRead INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_recipients (
      notification_id TEXT,
      user_id TEXT,
      is_read INTEGER DEFAULT 0,
      read_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id)
    );
  `);

  // Seed sample users
  await db.exec(`
    INSERT INTO students (studentId, name, role, semester, department) VALUES
      ('admin_saugat', 'Admin Sau Gat', 'admin', 'Semester 2', 'BIT'),
      ('teacher_pkr', 'Prof Pokhrel', 'teacher', 'Semester 2', 'BIT'),
      ('student_aarav', 'Aarav Sharma', 'student', 'Semester 2', 'BIT'),
      ('student_sneha', 'Sneha Shrestha', 'student', 'Semester 2', 'BIT');
  `);

  return db;
}

test('Kyana AI Comment Agent Suite', async (t) => {

  await t.test('1. Mention detection & query extraction', () => {
    assert.equal(hasKyanaMention('@kyana summarize this post'), true);
    assert.equal(hasKyanaMention('Hey @Kyana what is the deadline?'), true);
    assert.equal(hasKyanaMention('@kyana_ai help me with task 2'), true);
    assert.equal(hasKyanaMention('@KYANA: any thoughts on this?'), true);
    assert.equal(hasKyanaMention('Just a normal comment with no mentions'), false);
    assert.equal(hasKyanaMention('Email me at kyana@domain.com'), false);

    assert.equal(extractMentionQuery('@kyana summarize this notice'), 'summarize this notice');
    assert.equal(extractMentionQuery('@Kyana: when do classes resume?'), 'when do classes resume?');
    // Bare mention defaults to summary
    assert.equal(extractMentionQuery('@kyana'), 'Summarize this post and highlight the key points, dates, and requirements.');
    assert.equal(extractMentionQuery('  @kyana   '), 'Summarize this post and highlight the key points, dates, and requirements.');
  });

  await t.test('2. Bot account initialization idempotency', async () => {
    const db = await createTestDb();
    await ensureKyanaBotAccount(db);

    const bot = await db.get('SELECT studentId, name, role, avatarUrl FROM students WHERE studentId = ?', KYANA_BOT_ID);
    assert.ok(bot);
    assert.equal(bot.studentId, KYANA_BOT_ID);
    assert.equal(bot.name, KYANA_BOT_NAME);
    assert.equal(bot.role, KYANA_BOT_ROLE);

    // Call again to verify idempotency
    await ensureKyanaBotAccount(db);
    const count = await db.get('SELECT count(*) as c FROM students WHERE studentId = ?', KYANA_BOT_ID);
    assert.equal(Number(count.c), 1);
  });

  await t.test('3. Post & Notice Comment Mention (@kyana summarize this post)', async () => {
    const db = await createTestDb();
    await ensurePostsSchema(db);

    // Seed official notice 184
    await db.run(`
      INSERT INTO posts (id, user_id, title, content, type, category, semester_no)
      VALUES (184, 'admin_saugat', 'Resumption of Regular Classes', 'Regular BIT classes resume following Dashain vacation as per the updated academic schedule.', 'status', 'NOTICE', 2)
    `);

    // Student Aarav writes a comment tagging @kyana
    const res = await createCommentOrReply(db, {
      postId: 184,
      targetParentId: null,
      replyToUserId: null,
      content: '@kyana can you summarize this notice and explain when classes resume?',
      req: {
        postUser: { studentId: 'student_aarav', name: 'Aarav Sharma', role: 'student' },
        query: { await_kyana: 'true' }
      }
    });

    assert.ok(res.comment, 'User comment created');
    assert.equal(res.comment.studentId, 'student_aarav');
    assert.ok(res.kyanaReply, 'Kyana reply generated synchronously');
    assert.equal(res.kyanaReply.replyComment.userId, KYANA_BOT_ID);
    assert.equal(res.kyanaReply.replyComment.replyToUserId, 'student_aarav');
    assert.equal(res.kyanaReply.replyComment.parentCommentId, res.comment.id);

    // Verify reply text mentions key facts from notice
    const replyText = res.kyanaReply.replyText;
    assert.match(replyText, /Resumption of Regular Classes|Dashain|academic schedule|Admin Sau Gat/i);

    // Check database has 2 comments: user comment and Kyana reply
    const allComments = await fetchPostComments(db, 184, {});
    assert.equal(allComments.length, 1); // 1 root comment
    assert.equal(allComments[0].replies.length, 1); // 1 nested reply from Kyana
    assert.equal(allComments[0].replies[0].userId, KYANA_BOT_ID);
    assert.equal(allComments[0].replies[0].name, KYANA_BOT_NAME);
  });

  await t.test('4. Code Lab Assignment Comment Mention (@kyana give suggestions)', async () => {
    const db = await createTestDb();

    // Seed assignment
    const assignRes = await db.run(`
      INSERT INTO assignments (title, description, subject, semester, dueDate, totalMarks, createdBy)
      VALUES ('Binary Search Tree Implementation', 'Implement insert, search, and delete operations in C++ with O(log n) average time complexity.', 'Data Structures and Algorithms', 'Semester 2', '2026-11-20', 20, 'teacher_pkr')
    `);
    const assignmentId = assignRes.lastInsertRowid;

    // Student Sneha comments tagging @kyana asking for suggestions
    const mentionResult = await handleCommentMention(db, {
      entityType: 'assignment',
      entityId: assignmentId,
      commentId: 1,
      commentText: '@kyana what is your opinion on this assignment and what are your suggestions for tackling the delete operation?',
      user: { studentId: 'student_sneha', name: 'Sneha Shrestha', role: 'student' },
      parentCommentId: null,
      awaitReply: true
    });

    assert.ok(mentionResult, 'Mention handled');
    assert.ok(mentionResult.replyComment);
    assert.equal(mentionResult.replyComment.studentId, KYANA_BOT_ID);
    assert.equal(mentionResult.replyComment.replyToUserId, 'student_sneha');

    // Verify stored in assignment_comments
    const saved = await db.get('SELECT * FROM assignment_comments WHERE assignmentId = ? AND studentId = ?', assignmentId, KYANA_BOT_ID);
    assert.ok(saved);
    assert.match(saved.commentText, /Binary Search Tree|Data Structures|suggestions|delete/i);
  });

  await t.test('5. Semester Library Study Note Comment Mention (@kyana summarize note)', async () => {
    const db = await createTestDb();

    // Seed study material in files
    const fileRes = await db.run(`
      INSERT INTO files (storedName, originalName, title, subject, semester, chapter, description, uploadedBy)
      VALUES ('os_ch3_deadlock.pdf', 'Operating_Systems_Unit3.pdf', 'Deadlock Detection and Recovery', 'Operating Systems', 'Semester 2', 'Unit 3', 'Covers Banker algorithm, resource allocation graphs, circular wait conditions, and recovery methods.', 'teacher_pkr')
    `);
    const fileId = fileRes.lastInsertRowid;

    // Student Aarav asks in Romanized Nepali
    const mentionResult = await handleCommentMention(db, {
      entityType: 'file',
      entityId: fileId,
      commentId: 10,
      commentText: '@kyana yo study material ko summary deu na, exam ko lagi k k imp cha?',
      user: { studentId: 'student_aarav', name: 'Aarav Sharma', role: 'student' },
      parentCommentId: null,
      awaitReply: true
    });

    assert.ok(mentionResult);
    assert.ok(mentionResult.replyComment);
    assert.equal(mentionResult.replyComment.studentId, KYANA_BOT_ID);

    // Verify stored in file_comments
    const saved = await db.get('SELECT * FROM file_comments WHERE fileId = ? AND studentId = ?', fileId, KYANA_BOT_ID);
    assert.ok(saved);
    assert.match(saved.commentText, /Deadlock Detection|Operating Systems|Banker|सुझाव|सारांश|Summary/i);
  });

  await t.test('6. Cross-reference App Data (Routine / Timetable in Comment)', async () => {
    const db = await createTestDb();

    // Seed routine schedule for semester 2
    await db.run(`
      INSERT INTO routine (subject_name, subject_code, exam_date, weekday, exam_time, room, semester, exam_type)
      VALUES ('Data Structures and Algorithms', 'CIT123', '2026-11-15', 'Sunday', '11:00 AM', 'Hall A', 2, 'Mid-Term')
    `);

    // Seed post
    const postRes = await db.run(`
      INSERT INTO posts (user_id, title, content, type, category, semester_no)
      VALUES ('teacher_pkr', 'Mid-Term Exam Reminder', 'Students should prepare for the upcoming mid-term examinations.', 'status', 'NOTICE', 2)
    `);

    const mentionResult = await handleCommentMention(db, {
      entityType: 'post',
      entityId: postRes.lastInsertRowid,
      commentId: 101,
      commentText: '@kyana what is our exam routine or timetable according to the schedule?',
      user: { studentId: 'student_aarav', name: 'Aarav Sharma', role: 'student', semester: 'Semester 2' },
      parentCommentId: null,
      awaitReply: true
    });

    assert.ok(mentionResult);
    assert.match(mentionResult.replyText, /Data Structures and Algorithms|Sunday|11:00 AM|Hall A/i);
  });

  await t.test('7. Threaded reply nested under existing comment', async () => {
    const db = await createTestDb();
    await ensurePostsSchema(db);

    await db.run(`
      INSERT INTO posts (id, user_id, title, content)
      VALUES (500, 'admin_saugat', 'Hackathon Registration', 'Register your team before November 10.')
    `);

    // Root comment by Sneha
    const rootRes = await db.run(`
      INSERT INTO post_comments (post_id, user_id, content)
      VALUES (500, 'student_sneha', 'Is there any registration fee?')
    `);
    const rootCommentId = rootRes.lastInsertRowid;

    // Aarav replies to Sneha and tags @kyana
    const replyRes = await createCommentOrReply(db, {
      postId: 500,
      targetParentId: rootCommentId,
      replyToUserId: 'student_sneha',
      content: '@kyana does this post mention any registration fee?',
      req: {
        postUser: { studentId: 'student_aarav', name: 'Aarav Sharma' },
        query: { await_kyana: 'true' }
      }
    });

    assert.ok(replyRes.kyanaReply);
    // Kyana's reply should be nested under the root comment (500 -> rootCommentId)
    assert.equal(replyRes.kyanaReply.replyComment.parentCommentId, rootCommentId);
    assert.equal(replyRes.kyanaReply.replyComment.replyToUserId, 'student_aarav');
  });

  await t.test('8. Anti-recursion loop: Kyana never replies to Kyana', async () => {
    const db = await createTestDb();

    const res = await handleCommentMention(db, {
      entityType: 'post',
      entityId: 1,
      commentId: 999,
      commentText: '@kyana should I reply to myself?',
      user: { studentId: KYANA_BOT_ID, name: KYANA_BOT_NAME },
      awaitReply: true
    });

    assert.equal(res, null, 'Must refuse to process comments authored by Kyana herself');
  });

});
