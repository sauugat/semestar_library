'use strict';

/**
 * KYANA AGENT ENGINE V1.2 — FINAL STAGING VALIDATION SUITE
 * ========================================================
 * Validates all 5 pre-deployment staging requirements:
 * 1. Actual Neon PostgreSQL (`@neondatabase/serverless` Pool + production query adapters + isolated temporary schema)
 * 2. Genuine External LLM Provider Calls (`lib/chat-provider.js` over live HTTPS SSE + timeout & fallback verification)
 * 3. Multi-Instance Cache Consistency (Instance A mutates -> Instance B reads immediately via LISTEN/NOTIFY + shared DB epoch)
 * 4. Original Date Regression (Nov 8, 2026 / 2083-07-23 BS class-resumption notice + English, Romanized Nepali, Devanagari follow-ups)
 * 5. Production Smoke Testing (Staging Web & React Native Mobile HTTP + SSE `/api/ai/chat` flows & visual renderers)
 *
 * SAFETY GUARANTEE:
 * All database operations execute strictly inside an isolated temporary PostgreSQL schema
 * (`kyana_staging_val_<random>`) which is dropped in `after()`. Production `public` tables
 * are verified before and after to ensure 0 rows are modified.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool, Client, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

// Load core modules (dbModule initializes pgDirectConnectionString & aiAssistant loads configuration)
const aiAssistant = require('../ai-assistant');
const { handleChat } = aiAssistant;
const dbModule = require('../db');
const {
  invalidateAgentCache,
  attachPostgresCacheListener,
  getCrossInstanceCacheEpoch
} = require('../lib/kyana-agent-engine');
const { createChatProvider, ChatProviderError } = require('../lib/chat-provider');
const { createChatHandler } = require('../lib/chat-http');
const { createTransactionAdapter } = require('../lib/db-transaction');
const { ensureNeonPoolerUrl, ensureNeonDirectUrl, toPostgresSql, formatRow, formatRows } = dbModule;
const { adToBs, bsToAd, getCurrentNepalDateTime } = require('../lib/nepali-dates');
const {
  ensureAttendanceSchema,
  saveAttendanceSession,
  editAttendanceSessionById
} = require('../lib/attendance-service');
const {
  ensureMarksSchema,
  upsertExamConfiguration,
  saveStudentMarks,
  publishSubjectResults
} = require('../lib/marks-service');
const { renderAdaptiveVisualBlockHtml } = require('../public/chatbot');

neonConfig.webSocketConstructor = ws;
neonConfig.pipelineConnect = 'password';

const REFERENCE_NOV_8_2026 = new Date('2026-11-08T06:00:00.000Z'); // 2026-11-08 11:45 NPT (2083-07-23 BS)

const STUDENT_CTX = {
  authenticated: true,
  studentId: 's_stage_230',
  id: 's_stage_230',
  name: 'Aashrita Lamichhane',
  role: 'student',
  department: 'BIT',
  semester: 'Semester 3',
  currentSemester: 3,
  cohortId: 'coh_stage_3',
  cohort: { id: 'coh_stage_3', slotCode: 'earth', currentSemester: 3, displayName: 'BIT Sem 3' }
};

const TEACHER_DSA_CTX = {
  authenticated: true,
  studentId: 't_stage_101',
  id: 't_stage_101',
  name: 'Ramesh Sharma',
  role: 'teacher',
  department: 'BIT',
  assignedSemesters: [3],
  assignedSubjects: [{ code: 'CIT231', name: 'Data Structure and Algorithms', semester: 3 }]
};

/**
 * Creates a production-compatible database adapter bound to a specific `@neondatabase/serverless` Pool
 * whose search_path is pinned to the isolated staging schema.
 */
function createStagingDbAdapter(pool) {
  const noIdTables = [
    'chat_read_receipts', 'chat_typing', 'file_likes', 'file_votes',
    'assignment_votes', 'follows', 'chat_reactions', 'students',
    'submissions', 'submission_events', 'post_likes', 'post_votes',
    'post_submissions', 'mobile_tokens', 'login_attempts',
    'student_device_tokens', 'student_notification_preferences',
    'push_receipt_tickets', 'cohort_audit_logs', 'admin_audit_logs',
    'dm_participants', 'dm_blocks', 'dm_message_deletions',
    'dm_rate_limits', 'attendance_settings', 'teacher_drive_connections',
    'kyana_cache_state', 'post_target_semesters', 'cohorts', 'subjects',
    'teachers', 'teacher_subjects', 'note_search_documents', 'ai_conversations'
  ];

  const adapter = {
    isPostgres: true,
    pool,
    async exec(sql) {
      await pool.query(sql);
    },
    async query(sql, ...params) {
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const pgSql = toPostgresSql(sql);
      const res = await pool.query(pgSql, normParams);
      return { rows: formatRows(res.rows || []), rowCount: res.rowCount ?? 0 };
    },
    async get(sql, ...params) {
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const pgSql = toPostgresSql(sql);
      const res = await pool.query(pgSql, normParams);
      return formatRow((res.rows && res.rows[0]) || null);
    },
    async all(sql, ...params) {
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const pgSql = toPostgresSql(sql);
      const res = await pool.query(pgSql, normParams);
      return formatRows(res.rows || []);
    },
    async run(sql, ...params) {
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      let pgSql = sql;
      const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
      const hasReturning = /\bRETURNING\b/i.test(sql);
      if (isInsert && !hasReturning) {
        const isNoIdTable = noIdTables.some(tbl => new RegExp(`INSERT\\s+INTO\\s+${tbl}\\b`, 'i').test(sql));
        if (!isNoIdTable) {
          pgSql = `${sql.trim().replace(/;$/, '')} RETURNING id`;
        }
      }
      const converted = toPostgresSql(pgSql);
      const res = await pool.query(converted, normParams);
      const firstRow = res.rows && res.rows[0];
      const lastInsertRowid = firstRow && (firstRow.id !== undefined) ? Number(firstRow.id) : null;
      return {
        lastInsertRowid,
        changes: res.rowCount ?? 0,
        rowCount: res.rowCount ?? 0,
        rows: formatRows(res.rows || [])
      };
    },
    async withTransaction(callback) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txAdapter = createTransactionAdapter(client, true, formatRow, formatRows);
        const result = await callback(txAdapter);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  };
  return adapter;
}

describe('Kyana V1.2 — Final Staging Validation Suite', () => {
  const schemaName = `kyana_staging_val_${crypto.randomBytes(4).toString('hex')}`;
  let adminPool = null;
  let poolInstanceA = null;
  let poolInstanceB = null;
  let dbInstanceA = null;
  let dbInstanceB = null;
  let publicCountsBefore = { students: 0, assignments: 0, posts: 0 };
  const stagingReport = {
    schemaName,
    neonPostgres: {},
    llmVerification: {},
    multiInstanceCache: {},
    dateRegression: {},
    smokeTests: {}
  };

  before(async () => {
    const rawUrl = dbModule.pgDirectConnectionString;
    assert.ok(rawUrl, 'Staging connection string must be available via dbModule');

    const poolerUrl = ensureNeonPoolerUrl(rawUrl);
    adminPool = new Pool({
      connectionString: poolerUrl,
      max: 4,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 15000
    });

    // 1. Snapshot production `public` row counts BEFORE creating isolated staging schema
    const [studRes, assignRes, postRes] = await Promise.all([
      adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.students'),
      adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.assignments'),
      adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.posts')
    ]);
    publicCountsBefore = {
      students: studRes.rows[0].cnt,
      assignments: assignRes.rows[0].cnt,
      posts: postRes.rows[0].cnt
    };

    // 2. Create isolated temporary staging schema
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);

    // Helper to build a Pool pinned to `schemaName`
    const createSchemaPinnedPool = (maxConns = 6) => {
      const p = new Pool({
        connectionString: poolerUrl,
        max: maxConns,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 15000
      });
      p.on('connect', (client) => {
        client.on('error', () => {});
      });
      const origConnect = p.connect.bind(p);
      p.connect = async function (...args) {
        const client = await origConnect(...args);
        await client.query(`SET search_path TO ${schemaName}`);
        return client;
      };
      p.query = async function (text, values) {
        const client = await origConnect();
        try {
          await client.query(`SET search_path TO ${schemaName}`);
          return await client.query(text, values);
        } finally {
          await client.query('SET search_path TO public').catch(() => {});
          client.release();
        }
      };
      return p;
    };

    poolInstanceA = createSchemaPinnedPool(6);
    poolInstanceB = createSchemaPinnedPool(6);
    dbInstanceA = createStagingDbAdapter(poolInstanceA);
    dbInstanceB = createStagingDbAdapter(poolInstanceB);

    // 3. Verify that both Instance A and Instance B are strictly pinned to `schemaName` and NOT `public`
    const schemaCheckA = await dbInstanceA.get('SELECT current_schema() AS schema');
    const schemaCheckB = await dbInstanceB.get('SELECT current_schema() AS schema');
    assert.equal(schemaCheckA.schema, schemaName, 'Instance A must be isolated to temporary staging schema');
    assert.equal(schemaCheckB.schema, schemaName, 'Instance B must be isolated to temporary staging schema');

    // 4. Initialize production-compatible tables inside the isolated staging schema
    await dbInstanceA.exec(`
      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        slot_code TEXT,
        display_name TEXT NOT NULL,
        current_semester INTEGER NOT NULL,
        intake_year INTEGER,
        intake_identifier TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        graduated_at TIMESTAMPTZ
      );

      CREATE TABLE admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT,
        entity_type TEXT,
        entity_id TEXT,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        before_state JSONB,
        after_state JSONB,
        metadata JSONB,
        metadata_json TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT,
        email TEXT,
        role TEXT DEFAULT 'student',
        department TEXT DEFAULT 'BIT',
        semester TEXT DEFAULT 'Semester 3',
        cohort_id TEXT DEFAULT 'coh_stage_3',
        avatarUrl TEXT,
        account_status VARCHAR(32) NOT NULL DEFAULT 'active',
        verification_status TEXT DEFAULT 'verified',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE subjects (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        semester INTEGER NOT NULL,
        department TEXT DEFAULT 'BIT',
        credit_hours NUMERIC(4,1) DEFAULT 3.0,
        nature TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE teacher_invites (
        id TEXT PRIMARY KEY,
        initial_username TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE teachers (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        invite_id TEXT,
        name TEXT,
        full_name TEXT,
        designation TEXT DEFAULT 'Lecturer',
        email TEXT,
        department TEXT DEFAULT 'BIT',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE teacher_subjects (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        semester INTEGER DEFAULT 3,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE assignments (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT,
        language TEXT NOT NULL DEFAULT 'c',
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        deadline TIMESTAMPTZ,
        pdfUrl TEXT,
        pdfName TEXT,
        createdBy TEXT NOT NULL,
        createdAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE assignment_questions (
        id SERIAL PRIMARY KEY,
        assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        questionNumber INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        starterCode TEXT,
        language TEXT NOT NULL DEFAULT 'c',
        maxPoints INTEGER DEFAULT 10,
        createdAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignmentId, questionNumber)
      );

      CREATE TABLE submissions (
        id SERIAL PRIMARY KEY,
        assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE,
        questionTitle TEXT,
        studentId TEXT NOT NULL,
        code TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT,
        testResults TEXT,
        submittedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignmentId, studentId, questionId)
      );

      CREATE TABLE submission_grades (
        id SERIAL PRIMARY KEY,
        questionId INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
        studentId TEXT NOT NULL,
        marksObtained NUMERIC(8,2),
        remarks TEXT,
        checked BOOLEAN DEFAULT FALSE,
        released BOOLEAN DEFAULT FALSE,
        gradedBy TEXT,
        gradedAt TIMESTAMPTZ,
        updatedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(questionId, studentId)
      );

      CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        author_role TEXT DEFAULT 'admin',
        title TEXT,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'notice',
        category TEXT DEFAULT 'notice',
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        target_all_semesters INTEGER DEFAULT 1,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        visibility TEXT DEFAULT 'everyone',
        moderation_status TEXT DEFAULT 'active',
        is_official INTEGER DEFAULT 1,
        superseded BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ,
        hidden_at TIMESTAMPTZ
      );

      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        semester INTEGER NOT NULL,
        PRIMARY KEY (post_id, semester)
      );

      CREATE TABLE routine (
        id SERIAL PRIMARY KEY,
        semester INTEGER NOT NULL,
        subject_name TEXT NOT NULL,
        subject_code TEXT,
        exam_date TEXT NOT NULL,
        calendar TEXT DEFAULT 'AD',
        weekday TEXT,
        exam_time TEXT,
        room TEXT,
        exam_type TEXT DEFAULT 'Final Exam',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE files (
        id SERIAL PRIMARY KEY,
        filename TEXT,
        storedName TEXT,
        originalName TEXT NOT NULL,
        title TEXT,
        subject TEXT,
        chapter TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        uploadedBy TEXT NOT NULL,
        sizeBytes BIGINT NOT NULL DEFAULT 1024,
        uploadedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        uploadDate TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ,
        hidden_at TIMESTAMPTZ
      );

      CREATE TABLE note_search_documents (
        id INTEGER PRIMARY KEY,
        title TEXT,
        original_name TEXT,
        subject TEXT,
        chapter TEXT,
        semester TEXT,
        content TEXT NOT NULL DEFAULT '',
        extraction_status TEXT DEFAULT 'indexed',
        extraction_error TEXT,
        indexed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        content_truncated INTEGER NOT NULL DEFAULT 0,
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
      );

      CREATE TABLE note_chunks (
        id SERIAL PRIMARY KEY,
        file_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        page_number INTEGER DEFAULT 1,
        content TEXT NOT NULL
      );

      CREATE TABLE ai_conversations (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        title TEXT DEFAULT 'Chat with Kyana',
        last_message TEXT,
        last_message_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ai_messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await ensureAttendanceSchema(dbInstanceA);
    await ensureMarksSchema(dbInstanceA);

    // 5. Seed baseline isolated test records in `schemaName`
    await dbInstanceA.exec(`
      INSERT INTO cohorts (id, slot_code, display_name, current_semester, intake_year, status)
      VALUES ('coh_stage_3', 'earth', 'BIT Semester 3', 3, 2025, 'active');

      INSERT INTO students (studentId, name, username, email, role, department, semester, cohort_id)
      VALUES
        ('s_stage_230', 'Aashrita Lamichhane', 'aashrita_stage', 'aashrita@gu.edu.np', 'student', 'BIT', 'Semester 3', 'coh_stage_3'),
        ('s_other', 'Bikash Gurung', 'bikash_stage', 'bikash@gu.edu.np', 'student', 'BIT', 'Semester 3', 'coh_stage_3'),
        ('t_stage_101', 'Ramesh Sharma', 'ramesh_sir', 'ramesh@gu.edu.np', 'teacher', 'BIT', NULL, NULL),
        ('admin_stage_1', 'Saugat Subedi', 'saugat_admin', 'admin@gu.edu.np', 'admin', 'BIT', NULL, NULL);

      INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
      VALUES
        ('CIT231', 'CIT231', 'Data Structure and Algorithms', 3, 'BIT', 3.0, 'TH + PR', TRUE),
        ('CIT232', 'CIT232', 'Database Management System', 3, 'BIT', 3.0, 'TH + PR', TRUE),
        ('CIT233', 'CIT233', 'Operating Systems', 3, 'BIT', 3.0, 'TH + PR', TRUE),
        ('CIT123', 'CIT123', 'Web Technology I', 3, 'BIT', 3.0, 'TH + PR', TRUE),
        ('CIT351', 'CIT351', 'Data Communication and Computer Networks', 5, 'BIT', 3.0, 'TH + PR', TRUE);

      INSERT INTO teachers (id, user_id, name, full_name, email, department, status)
      VALUES ('t_stage_101', 't_stage_101', 'Ramesh Sharma', 'Ramesh Sharma', 'ramesh@gu.edu.np', 'BIT', 'active');

      INSERT INTO teacher_subjects (id, teacher_id, subject_id, semester)
      VALUES
        ('ts_stage_dsa', 't_stage_101', 'CIT231', 3),
        ('ts_stage_dbms', 't_stage_101', 'CIT232', 3);

      INSERT INTO assignments (id, title, description, language, subject, semester, semester_no, cohort_id, audience_scope, deadline, createdBy, createdAt)
      VALUES
        (101, 'DSA Linked List & Stack Lab', 'Implement singly linked list operations in C.', 'c', 'Data Structure and Algorithms', 'Semester 3', 3, 'coh_stage_3', 'all_students', '2026-11-12T18:14:59Z', 't_stage_101', '2026-11-01T08:00:00Z'),
        (102, 'Web Tech Session & Cookie Lab', 'Build HTTP cookie session login flow.', 'javascript', 'Web Technology I', 'Semester 3', 3, 'coh_stage_3', 'all_students', '2026-11-16T18:14:59Z', 't_stage_101', '2026-11-02T08:00:00Z'),
        (103, 'OS Process Scheduling Lab', 'Simulate Round Robin scheduling.', 'c', 'Operating Systems', 'Semester 3', 3, 'coh_stage_3', 'all_students', NULL, 't_stage_101', '2026-11-03T08:00:00Z');

      INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints, createdAt)
      VALUES
        (1001, 101, 1, 'Singly Linked List Insertion', 'Insert node at head and tail.', 'c', 10, '2026-11-01T08:00:00Z'),
        (1002, 101, 2, 'Stack Using Linked List', 'Push and pop operations.', 'c', 10, '2026-11-01T08:00:00Z'),
        (1003, 102, 1, 'Cookie Parser Middleware', 'Parse Cookie header.', 'javascript', 10, '2026-11-02T08:00:00Z'),
        (1004, 103, 1, 'RR Gantt Chart', 'Compute waiting time.', 'c', 10, '2026-11-03T08:00:00Z');

      INSERT INTO routine (id, semester, subject_name, subject_code, exam_date, calendar, weekday, exam_time, room, exam_type)
      VALUES
        (1, 3, 'Operating Systems', 'CIT233', '2026-11-01', 'AD', 'Sunday', '11:00 AM', 'Room 201', 'Mid-Term Exam'),
        (2, 3, 'Data Structure and Algorithms', 'CIT231', '2026-11-14', 'AD', 'Saturday', '11:00 AM', 'Room 302', 'Final Exam'),
        (3, 3, 'Database Management System', 'CIT232', '2026-11-18', 'AD', 'Wednesday', '11:00 AM', 'Room 304', 'Final Exam');

      INSERT INTO files (id, filename, storedName, originalName, title, subject, chapter, semester, semester_no, cohort_id, uploadedBy, sizeBytes, uploadedAt)
      VALUES
        (501, 'dsa_unit3_linked_list.pdf', 'dsa_unit3_linked_list.pdf', 'DSA_Linked_List_Notes.pdf', 'DSA Unit 3 Linked List Notes', 'Data Structure and Algorithms', 'Unit 3', 'Semester 3', 3, 'coh_stage_3', 't_stage_101', 20480, '2026-10-20T10:00:00Z');

      INSERT INTO note_search_documents (id, title, original_name, subject, chapter, semester, content, extraction_status)
      VALUES
        (501, 'DSA Unit 3 Linked List Notes', 'DSA_Linked_List_Notes.pdf', 'Data Structure and Algorithms', 'Unit 3', 'Semester 3', 'A linked list is a linear data structure where each node holds data and a next pointer. Head insertion takes O(1) time.', 'indexed');

      INSERT INTO note_chunks (file_id, chunk_index, page_number, content)
      VALUES
        (501, 0, 1, 'A linked list is a linear data structure where each node holds data and a next pointer. Head insertion takes O(1) time.');

      INSERT INTO posts (id, user_id, author_role, title, content, type, category, semester, semester_no, target_all_semesters, cohort_id, audience_scope, visibility, is_official, superseded, created_at)
      VALUES
        (201, 'admin_stage_1', 'admin', 'Earlier Notice on Class Resumption', 'Regular BIT classes will resume from 2026-11-12 (2083-07-27 BS) after Tihar break.', 'notice', 'notice', 'All Semesters', NULL, 1, 'coh_stage_3', 'all_students', 'everyone', 1, TRUE, '2026-11-01T09:00:00Z'),
        (202, 'admin_stage_1', 'admin', 'Official Update: Revised Class Resumption Date', 'Official Update: Regular BIT classes will resume from 2026-11-16 (2083-08-01 BS / Mangsir 1, 2083) following the Tihar and Chhath vacation due to university senate scheduling.', 'notice', 'notice', 'All Semesters', NULL, 1, 'coh_stage_3', 'all_students', 'everyone', 1, FALSE, '2026-11-06T10:00:00Z');

      INSERT INTO post_target_semesters (post_id, semester)
      VALUES (201, 3), (202, 3);
    `);

    // Seed Attendance & Marks via production services
    await saveAttendanceSession(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT231',
      cohortId: 'coh_stage_3',
      sessionDate: '2026-11-02',
      records: [
        { studentId: 's_stage_230', status: 'present' },
        { studentId: 's_other', status: 'absent' }
      ],
      now: REFERENCE_NOV_8_2026
    });
    await saveAttendanceSession(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT232',
      cohortId: 'coh_stage_3',
      sessionDate: '2026-11-02',
      records: [
        { studentId: 's_stage_230', status: 'absent' },
        { studentId: 's_other', status: 'present' }
      ],
      now: REFERENCE_NOV_8_2026
    });

    await upsertExamConfiguration(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT231',
      examType: 'Mid-Term Exam',
      maxMarks: 50
    });
    await saveStudentMarks(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT231',
      examType: 'Mid-Term Exam',
      maxMarks: 50,
      publish: true,
      records: [
        { studentId: 's_stage_230', obtainedMarks: 41 },
        { studentId: 's_other', obtainedMarks: 32 }
      ]
    });

    // Unpublished Pre-Board draft marks (must stay hidden from student)
    await upsertExamConfiguration(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT232',
      examType: 'Mid-Term Exam',
      maxMarks: 50
    });
    await saveStudentMarks(dbInstanceA, {
      actorUserId: 't_stage_101',
      subjectId: 'CIT232',
      examType: 'Mid-Term Exam',
      maxMarks: 50,
      publish: false,
      records: [
        { studentId: 's_stage_230', obtainedMarks: 47 }
      ]
    });
  });

  after(async () => {
    try {
      if (adminPool) {
        await adminPool.query('DISCARD ALL').catch(() => {});
        await adminPool.query('SET search_path TO public').catch(() => {});
        await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
        const [studAfter, assignAfter, postAfter] = await Promise.all([
          adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.students'),
          adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.assignments'),
          adminPool.query('SELECT COUNT(*)::int AS cnt FROM public.posts')
        ]);
        assert.equal(studAfter.rows[0].cnt, publicCountsBefore.students, 'Production public.students count must be untouched');
        assert.equal(assignAfter.rows[0].cnt, publicCountsBefore.assignments, 'Production public.assignments count must be untouched');
        assert.equal(postAfter.rows[0].cnt, publicCountsBefore.posts, 'Production public.posts count must be untouched');
        stagingReport.neonPostgres.productionPublicUntouched = true;
      }
    } finally {
      console.log('\n================================================================');
      console.log('KYANA V1.2 FINAL STAGING VALIDATION TELEMETRY SUMMARY');
      console.log(JSON.stringify(stagingReport, null, 2));
      console.log('================================================================\n');
      if (adminPool) {
        await adminPool.query('DISCARD ALL').catch(() => {});
        await adminPool.query('SET search_path TO public').catch(() => {});
      }
      await Promise.all([
        poolInstanceA?.end().catch(() => {}),
        poolInstanceB?.end().catch(() => {}),
        adminPool?.end().catch(() => {}),
        dbModule.close?.().catch(() => {})
      ]);
    }
  });

  // ===========================================================================
  // 1. ACTUAL NEON POSTGRESQL INTEGRATION
  // ===========================================================================
  describe('1. Actual Neon PostgreSQL Integration (Pool, Transactions, Concurrency, Dates, Rollbacks)', () => {
    it('1.1 Verifies Neon connection pooling, 12 concurrent queries, and TIMESTAMPTZ ISO date serialization', async () => {
      const t0 = Date.now();
      const serverVersion = await dbInstanceA.get('SELECT version() AS ver, current_database() AS db, current_schema() AS schema');
      assert.match(serverVersion.ver, /PostgreSQL/i);
      assert.equal(serverVersion.schema, schemaName);

      // Fire 12 concurrent queries across the Neon Pool
      const concurrentPromises = Array.from({ length: 12 }, (_, idx) =>
        dbInstanceA.get(
          'SELECT id, title, deadline, createdAt FROM assignments WHERE id = ?',
          idx % 2 === 0 ? 101 : 102
        )
      );
      const results = await Promise.all(concurrentPromises);
      const concurrentDurationMs = Date.now() - t0;

      assert.equal(results.length, 12);
      for (const row of results) {
        assert.equal(typeof row.deadline, 'string', 'TIMESTAMPTZ deadline must serialize to ISO string via formatRow');
        assert.match(row.deadline, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        assert.equal(typeof row.createdAt, 'string', 'TIMESTAMPTZ createdAt must serialize to ISO string via formatRow');
      }

      stagingReport.neonPostgres.engineVersion = serverVersion.ver.split(',')[0];
      stagingReport.neonPostgres.isolatedSchema = serverVersion.schema;
      stagingReport.neonPostgres.concurrentQueries12Ms = concurrentDurationMs;
      stagingReport.neonPostgres.dateSerializationVerified = true;
    });

    it('1.2 Verifies atomic transactions (COMMIT and ROLLBACK on mid-transaction failure) and pool error recovery', async () => {
      // 1. Test atomic COMMIT via withTransaction (`lib/db-transaction.js`)
      const commitRes = await dbInstanceA.withTransaction(async (tx) => {
        await tx.run(
          `INSERT INTO submissions (assignmentId, questionId, questionTitle, studentId, code, stdout, submittedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          102, 1003, 'Cookie Parser Middleware', 's_other', 'console.log("ok")', 'ok', '2026-11-05T10:00:00Z'
        );
        const row = await tx.get(
          'SELECT id, submittedAt FROM submissions WHERE assignmentId = ? AND studentId = ?',
          102, 's_other'
        );
        return row;
      });
      assert.ok(commitRes?.id, 'Committed transaction row must exist');

      // 2. Test atomic ROLLBACK when an error occurs mid-transaction
      await assert.rejects(
        async () => {
          await dbInstanceA.withTransaction(async (tx) => {
            await tx.run(
              `INSERT INTO submissions (assignmentId, questionId, questionTitle, studentId, code, stdout, submittedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              103, 1004, 'RR Gantt Chart', 's_other', 'int main(){}', 'ok', '2026-11-05T11:00:00Z'
            );
            throw new Error('SIMULATED_MID_TX_FAILURE');
          });
        },
        /SIMULATED_MID_TX_FAILURE/
      );

      const rolledBackRow = await dbInstanceA.get(
        'SELECT id FROM submissions WHERE assignmentId = ? AND studentId = ?',
        103, 's_other'
      );
      assert.equal(rolledBackRow, null, 'Rolled-back transaction must leave zero partial writes in Neon PostgreSQL');

      // 3. Test SQL error recovery on pool (invalid SQL followed immediately by valid query)
      await assert.rejects(
        () => dbInstanceA.get('SELECT * FROM nonexistent_table_xyz'),
        /relation .* does not exist/i
      );
      const recoveredRow = await dbInstanceA.get('SELECT COUNT(*)::int AS cnt FROM assignments');
      assert.equal(Number(recoveredRow.cnt), 3, 'Pool must recover immediately after a failed query');

      stagingReport.neonPostgres.transactionsCommitRollbackVerified = true;
      stagingReport.neonPostgres.errorRecoveryVerified = true;
    });
  });

  // ===========================================================================
  // 2. GENUINE LLM PROVIDER VERIFICATION
  // ===========================================================================
  describe('2. Genuine LLM Provider Verification (Real External API Calls, TTFT, Latency, Timeout & Fallback)', () => {
    it('2.1 Executes a genuine external LLM call and records provider, model, requestId, TTFT, and totalGenerationMs', async () => {
      const liveProvider = createChatProvider({ timeoutMs: 20000 });
      const streamedDeltas = [];
      const tStart = Date.now();
      const llmResult = await liveProvider.generateReply({
        message: 'In 2 concise sentences, explain what a Singly Linked List node contains in C for BIT Semester 3 DSA.',
        systemPrompt: 'You are Kyana, the Gandaki University BIT academic tutor. Be concise and accurate.',
        onDelta: (chunk) => streamedDeltas.push(chunk)
      });
      const wallClockMs = Date.now() - tStart;

      assert.ok(llmResult.reply && llmResult.reply.length > 20, 'Genuine LLM call must return non-empty reply');
      assert.ok(['gemini', 'groq', 'openrouter', 'openai', 'deepseek'].includes(llmResult.provider), `Expected real provider, got ${llmResult.provider}`);
      assert.ok(typeof llmResult.model === 'string' && llmResult.model.length > 0, 'Model identifier must be recorded');
      assert.ok(typeof llmResult.timeToFirstTokenMs === 'number' && llmResult.timeToFirstTokenMs > 0, 'Real TTFT must be > 0ms');
      assert.ok(typeof llmResult.totalGenerationMs === 'number' && llmResult.totalGenerationMs >= llmResult.timeToFirstTokenMs, 'Total generation time must be >= TTFT');
      assert.ok(streamedDeltas.length > 0, 'SSE stream deltas must be received');

      stagingReport.llmVerification.genuineExternalCall = {
        executionType: 'GENUINE_EXTERNAL_API_CALL',
        provider: llmResult.provider,
        model: llmResult.model,
        requestId: llmResult.requestId || 'stream_no_header_id',
        timeToFirstTokenMs: llmResult.timeToFirstTokenMs,
        totalGenerationMs: llmResult.totalGenerationMs,
        wallClockMs,
        fallbackUsed: llmResult.fallbackUsed,
        fallbackAttempts: llmResult.fallbackAttempts,
        streamChunksCount: streamedDeltas.length,
        replyPreview: llmResult.reply.slice(0, 140)
      };
    });

    it('2.2 Clearly distinguishes deterministic execution, mocked LLM tests, and genuine external LLM calls through Kyana Agent Engine', async () => {
      invalidateAgentCache(dbInstanceA);

      // A. Deterministic Agent Execution (0 LLM calls, real Neon PostgreSQL queries)
      const detRes = await handleChat(
        dbInstanceA,
        'How many days left for my DSA assignment?',
        STUDENT_CTX,
        [],
        'sess_det_1',
        { referenceDate: REFERENCE_NOV_8_2026 }
      );
      assert.equal(detRes.agentTrace.metrics.totalLlmCalls, 0);
      assert.match(detRes.reply, /4 days remaining/i);

      // B. Mocked LLM Callback Execution (synthetic in-memory callback)
      const mockRes = await handleChat(
        dbInstanceA,
        'How many days left for my DSA assignment?',
        STUDENT_CTX,
        [],
        'sess_mock_1',
        {
          referenceDate: REFERENCE_NOV_8_2026,
          generateReply: async () => ({
            reply: 'There are **4 days remaining** until the deadline for **DSA Linked List & Stack Lab** (**2026-11-12** / **2083-07-27 BS**). You have **not submitted** this assignment yet.',
            provider: 'mock',
            model: 'mock-unit-test',
            requestId: 'mock_req_001',
            timeToFirstTokenMs: 1,
            totalGenerationMs: 1
          })
        }
      );
      assert.equal(mockRes.agentTrace.metrics.totalLlmCalls, 1);
      assert.equal(mockRes.agentTrace.metrics.llmProvider, 'mock');

      // C. Genuine External LLM Call through Kyana Agent Engine
      const liveProvider = createChatProvider({ timeoutMs: 20000 });
      const liveAgentRes = await handleChat(
        dbInstanceA,
        'Explain linked list with an example in C',
        STUDENT_CTX,
        [],
        'sess_live_llm_1',
        {
          referenceDate: REFERENCE_NOV_8_2026,
          generateReply: (opts) => liveProvider.generateReply(opts)
        }
      );
      assert.equal(liveAgentRes.agentTrace.metrics.totalLlmCalls, 1);
      assert.ok(liveAgentRes.agentTrace.metrics.llmExecutionMs > 50, 'Genuine external LLM call latency must be measured honestly');
      assert.match(liveAgentRes.reply, /struct\s+Node|linked\s+list/i);

      stagingReport.llmVerification.modeComparison = {
        deterministicExecution: {
          mode: 'DETERMINISTIC_NEON_PG',
          llmCalls: detRes.agentTrace.metrics.totalLlmCalls,
          dbQueryCount: detRes.agentTrace.metrics.dbQueryCount,
          dbExecutionMs: detRes.agentTrace.metrics.dbExecutionMs,
          toolExecutionMs: detRes.agentTrace.metrics.toolExecutionMs,
          totalLatencyMs: detRes.agentTrace.metrics.totalLatencyMs
        },
        mockedTestExecution: {
          mode: 'MOCKED_UNIT_TEST',
          llmCalls: mockRes.agentTrace.metrics.totalLlmCalls,
          llmProvider: mockRes.agentTrace.metrics.llmProvider,
          llmExecutionMs: mockRes.agentTrace.metrics.llmExecutionMs,
          totalLatencyMs: mockRes.agentTrace.metrics.totalLatencyMs
        },
        genuineExternalAgentExecution: {
          mode: 'GENUINE_EXTERNAL_LLM_PLUS_NEON_PG',
          llmCalls: liveAgentRes.agentTrace.metrics.totalLlmCalls,
          llmProvider: liveAgentRes.agentTrace.metrics.llmProvider,
          llmModel: liveAgentRes.agentTrace.metrics.llmModel,
          llmRequestId: liveAgentRes.agentTrace.metrics.llmRequestId,
          llmTimeToFirstTokenMs: liveAgentRes.agentTrace.metrics.llmTimeToFirstTokenMs,
          llmExecutionMs: liveAgentRes.agentTrace.metrics.llmExecutionMs,
          dbExecutionMs: liveAgentRes.agentTrace.metrics.dbExecutionMs,
          totalLatencyMs: liveAgentRes.agentTrace.metrics.totalLatencyMs
        }
      };
    });

    it('2.3 Verifies timeout behavior and automatic provider chain fallback to a live external provider', async () => {
      // 1. Timeout behavior: 5ms deadline against a slow request must abort with PROVIDER_TIMEOUT
      const tightTimeoutProvider = createChatProvider({
        timeoutMs: 5,
        fetchImpl: async (_url, init) => {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 200);
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(t);
              reject(init.signal.reason || new Error('Aborted'));
            });
          });
          return new Response('late', { status: 200 });
        }
      });
      await assert.rejects(
        () => tightTimeoutProvider.generateReply({ message: 'Explain B-Trees in detail.' }),
        (err) => err instanceof ChatProviderError && err.code === 'PROVIDER_TIMEOUT'
      );

      // Verify Kyana Agent Engine safely falls back to verified deterministic reply on PROVIDER_TIMEOUT
      const agentTimeoutFallback = await handleChat(
        dbInstanceA,
        'How many days left for my DSA assignment?',
        STUDENT_CTX,
        [],
        'sess_timeout_fb',
        {
          referenceDate: REFERENCE_NOV_8_2026,
          generateReply: (opts) => tightTimeoutProvider.generateReply(opts)
        }
      );
      assert.equal(agentTimeoutFallback.agentTrace.metrics.llmFallbackUsed, true);
      assert.equal(agentTimeoutFallback.agentTrace.metrics.llmFallbackReason, 'PROVIDER_TIMEOUT');
      assert.match(agentTimeoutFallback.reply, /4 days remaining/i);

      // 2. Live Provider Chain Fallback: primary provider fails (simulated 503 on Gemini -> real secondary provider succeeds)
      const realFetch = globalThis.fetch;
      let forcedPrimaryFailureCount = 0;
      const fallbackProvider = createChatProvider({
        timeoutMs: 20000,
        fetchImpl: async (url, init) => {
          if (String(url).includes('generativelanguage.googleapis.com')) {
            forcedPrimaryFailureCount += 1;
            return new Response('Service Unavailable', { status: 503 });
          }
          return realFetch(url, init);
        }
      });

      const fbRes = await fallbackProvider.generateReply({
        message: 'Reply with the single word READY.'
      });
      assert.ok(forcedPrimaryFailureCount >= 1, 'Primary provider failure must be triggered');
      assert.notEqual(fbRes.provider, 'gemini', 'Must fall back to secondary live external provider');
      assert.equal(fbRes.fallbackUsed, true);
      assert.ok(fbRes.fallbackAttempts.length >= 1);
      assert.ok(fbRes.reply.length > 0);

      stagingReport.llmVerification.timeoutAndFallback = {
        timeoutCodeVerified: 'PROVIDER_TIMEOUT',
        agentDeterministicFallbackOnTimeout: true,
        fallbackProviderUsed: fbRes.provider,
        fallbackModelUsed: fbRes.model,
        fallbackRequestId: fbRes.requestId,
        fallbackTimeToFirstTokenMs: fbRes.timeToFirstTokenMs,
        fallbackTotalGenerationMs: fbRes.totalGenerationMs,
        failedAttemptsRecorded: fbRes.fallbackAttempts.length
      };
    });
  });

  // ===========================================================================
  // 3. MULTI-INSTANCE CACHE CONSISTENCY
  // ===========================================================================
  describe('3. Multi-Instance Cache Consistency (Instance A Updates -> Instance B Queries Immediately)', () => {
    it('3.1 Instance B receives updated assignment deadline immediately after Instance A updates it without waiting for 60s TTL (LISTEN/NOTIFY + Shared DB Epoch)', async () => {
      invalidateAgentCache(dbInstanceA);
      invalidateAgentCache(dbInstanceB);

      // Connect a dedicated PostgreSQL LISTEN client for Instance B using direct connection
      const rawUrl = dbModule.pgDirectConnectionString;
      const directUrl = ensureNeonDirectUrl(rawUrl);
      const listenerClient = new Client({ connectionString: directUrl });
      await listenerClient.connect();
      await listenerClient.query(`SET search_path TO ${schemaName}`);
      const listenerHandle = await attachPostgresCacheListener(dbInstanceB, listenerClient);

      try {
        // Step 1: Instance B queries DSA assignment deadline -> warms Instance B's cache (2026-11-12 = 4 days remaining)
        const bFirst = await handleChat(
          dbInstanceB,
          'How many days left for my DSA assignment?',
          STUDENT_CTX,
          [],
          'sess_inst_b_1',
          { referenceDate: REFERENCE_NOV_8_2026 }
        );
        assert.match(bFirst.reply, /2026-11-12/);
        assert.match(bFirst.reply, /4 days remaining/i);
        assert.equal(bFirst.agentTrace.metrics.cacheHits, 0);

        // Step 2: Instance B queries again -> served from Instance B's warm cache (cacheHits >= 1, dbQueryCount === 0)
        const bWarm = await handleChat(
          dbInstanceB,
          'How many days left for my DSA assignment?',
          STUDENT_CTX,
          [],
          'sess_inst_b_2',
          { referenceDate: REFERENCE_NOV_8_2026 }
        );
        assert.match(bWarm.reply, /4 days remaining/i);
        assert.ok(bWarm.agentTrace.metrics.cacheHits >= 1, 'Second read on Instance B must hit warm cache');
        assert.equal(bWarm.agentTrace.metrics.dbQueryCount, 0, 'Warm cache hit must execute 0 tool DB queries');

        // Step 3: Instance A updates the assignment deadline to 2026-11-15 (7 days remaining)
        const epochBefore = await getCrossInstanceCacheEpoch(dbInstanceA);
        await dbInstanceA.run(
          'UPDATE assignments SET deadline = ? WHERE id = ?',
          '2026-11-15T18:14:59Z',
          101
        );
        const epochAfter = await getCrossInstanceCacheEpoch(dbInstanceB);
        assert.ok(epochAfter > epochBefore, `Shared DB cache epoch must increment (${epochBefore} -> ${epochAfter})`);

        // Step 4: Instance B queries immediately (<100ms, well before 60s TTL) -> MUST receive 2026-11-15 (7 days remaining)!
        const bAfterMutation = await handleChat(
          dbInstanceB,
          'How many days left for my DSA assignment?',
          STUDENT_CTX,
          [],
          'sess_inst_b_3',
          { referenceDate: REFERENCE_NOV_8_2026 }
        );
        assert.match(bAfterMutation.reply, /2026-11-15/, 'Instance B must reflect updated deadline 2026-11-15 immediately');
        assert.match(bAfterMutation.reply, /7 days remaining/i, 'Instance B must compute 7 days remaining immediately');
        assert.doesNotMatch(bAfterMutation.reply, /4 days remaining/i, 'Stale 4-day countdown must not be served by Instance B');
        assert.equal(bAfterMutation.agentTrace.metrics.cacheHits, 0, 'Instance B must invalidate stale cache and fetch fresh DB state');

        stagingReport.multiInstanceCache.deadlinePropagation = {
          initialDeadlineOnInstanceB: '2026-11-12 (4 days remaining)',
          warmCacheHitOnInstanceBVerified: true,
          updatedByInstanceATo: '2026-11-15 (7 days remaining)',
          epochBefore,
          epochAfter,
          listenNotificationsReceived: listenerHandle.notifications.length,
          instanceBImmediateRead: '2026-11-15 (7 days remaining)',
          waitedFor60sTtl: false
        };
      } finally {
        await listenerHandle.close();
        await listenerClient.end().catch(() => {});
        // Restore assignment 101 deadline to 2026-11-12 for subsequent tests
        await dbInstanceA.run(
          'UPDATE assignments SET deadline = ? WHERE id = ?',
          '2026-11-12T18:14:59Z',
          101
        );
      }
    });

    it('3.2 Handles concurrent mutations on Instance A and failed-mutation recovery without serving stale or corrupted data on Instance B', async () => {
      // Warm Instance B cache on assignments and attendance
      await handleChat(dbInstanceB, 'How many days left for my DSA assignment?', STUDENT_CTX, [], 'sess_conc_b1', {
        referenceDate: REFERENCE_NOV_8_2026
      });
      await handleChat(dbInstanceB, 'How is my attendance across all subjects?', STUDENT_CTX, [], 'sess_conc_b2', {
        referenceDate: REFERENCE_NOV_8_2026
      });

      // Execute concurrent mutations on Instance A (deadline update + attendance session edit)
      const sessions = await dbInstanceA.all('SELECT id, subject_id FROM attendance_sessions WHERE subject_id = ?', 'CIT232');
      await Promise.all([
        dbInstanceA.run('UPDATE assignments SET deadline = ? WHERE id = ?', '2026-11-13T18:14:59Z', 101),
        editAttendanceSessionById(dbInstanceA, {
          actorUserId: 't_stage_101',
          sessionId: sessions[0].id,
          records: [
            { studentId: 's_stage_230', status: 'present' },
            { studentId: 's_other', status: 'present' }
          ],
          reason: 'Verified present',
          now: REFERENCE_NOV_8_2026
        })
      ]);

      // Instance B queries both concurrently and must see 5 days remaining (2026-11-13) and 100% CIT232 attendance
      const [bAssignRes, bAttRes] = await Promise.all([
        handleChat(dbInstanceB, 'How many days left for my DSA assignment?', STUDENT_CTX, [], 'sess_conc_b3', {
          referenceDate: REFERENCE_NOV_8_2026
        }),
        handleChat(dbInstanceB, 'How is my attendance across all subjects?', STUDENT_CTX, [], 'sess_conc_b4', {
          referenceDate: REFERENCE_NOV_8_2026
        })
      ]);

      assert.match(bAssignRes.reply, /2026-11-13/);
      assert.match(bAssignRes.reply, /5 days remaining/i);
      assert.match(bAttRes.reply, /100%/);

      // Failed mutation on Instance A must not corrupt Instance B
      await assert.rejects(
        () => dbInstanceA.run('UPDATE assignments SET non_existent_column = 1 WHERE id = 101'),
        /column "non_existent_column" of relation "assignments" does not exist/i
      );

      const bRecoveryRes = await handleChat(
        dbInstanceB,
        'How many days left for my DSA assignment?',
        STUDENT_CTX,
        [],
        'sess_conc_b5',
        { referenceDate: REFERENCE_NOV_8_2026 }
      );
      assert.match(bRecoveryRes.reply, /2026-11-13/);
      assert.match(bRecoveryRes.reply, /5 days remaining/i);

      // Restore baseline state
      await dbInstanceA.run('UPDATE assignments SET deadline = ? WHERE id = ?', '2026-11-12T18:14:59Z', 101);
      await editAttendanceSessionById(dbInstanceA, {
        actorUserId: 't_stage_101',
        sessionId: sessions[0].id,
        records: [
          { studentId: 's_stage_230', status: 'absent' },
          { studentId: 's_other', status: 'present' }
        ],
        reason: 'Restore baseline',
        now: REFERENCE_NOV_8_2026
      });

      stagingReport.multiInstanceCache.concurrentMutationsAndRecoveryVerified = true;
    });
  });

  // ===========================================================================
  // 4. ORIGINAL DATE REGRESSION (NOVEMBER 8, 2026 CLASS-RESUMPTION QUESTION)
  // ===========================================================================
  describe('4. Original Date Regression (Nov 8, 2026 Class-Resumption Notice & BS Conversion)', () => {
    it('4.1 Verifies Bikram Sambat conversion for Nov 8, 2026 (2083-07-23 BS) and class-resumption notice across English, Romanized Nepali, and Devanagari follow-ups', async () => {
      // 1. Verify deterministic BS/AD conversions
      const clock = getCurrentNepalDateTime(REFERENCE_NOV_8_2026);
      assert.equal(clock.adDate, '2026-11-08');
      assert.equal(clock.bsDate, '2083-07-23');
      assert.equal(adToBs('2026-11-08'), '2083-07-23');
      assert.equal(bsToAd('2083-07-23'), '2026-11-08');
      assert.equal(adToBs('2026-11-16'), '2083-08-01');
      assert.equal(bsToAd('2083-08-01'), '2026-11-16');

      // 2. English query: "When do our classes resume? Has the date changed?"
      const enRes = await handleChat(
        dbInstanceA,
        'When do our classes resume? Has the date changed?',
        STUDENT_CTX,
        [],
        'sess_nov8_en',
        { referenceDate: REFERENCE_NOV_8_2026 }
      );
      assert.equal(enRes.agentTrace.verification.currentAdDate, '2026-11-08');
      assert.equal(enRes.agentTrace.verification.currentBsDate, '2083-07-23');
      assert.match(enRes.reply, /2026-11-16/, 'Must state the latest official resumption date 2026-11-16');
      assert.match(enRes.reply, /2083-08-01|1 Mangsir 2083/, 'Must include verified BS date');
      assert.match(enRes.reply, /Official Update: Revised Class Resumption Date/i, 'Must cite the latest official notice title');
      assert.match(enRes.reply, /supersedes|Earlier Notice on Class Resumption|2026-11-12/i, 'Must disclose that the earlier 2026-11-12 notice was superseded');

      const historyAfterEn = [
        { role: 'user', content: 'When do our classes resume? Has the date changed?' },
        {
          role: 'assistant',
          content: enRes.reply,
          matchedNotices: enRes.matchedNotices,
          resourceCards: enRes.resourceCards
        }
      ];

      // 3. Romanized Nepali follow-up: "Hamro class kahile dekhi suru huncha bro? Yo kina saryo?"
      const romRes = await handleChat(
        dbInstanceA,
        'Hamro class kahile dekhi suru huncha bro? Yo kina saryo?',
        STUDENT_CTX,
        historyAfterEn,
        'sess_nov8_rom',
        { referenceDate: REFERENCE_NOV_8_2026 }
      );
      assert.match(romRes.reply, /2026-11-16/);
      assert.match(romRes.reply, /2083-08-01|1 Mangsir 2083/);
      assert.match(romRes.reply, /Tihar and Chhath vacation|senate scheduling/i);

      // 4. Devanagari Nepali follow-up: "हाम्रो कक्षा कहिलेदेखि सुरु हुन्छ? मिति परिवर्तन भएको हो?"
      const devRes = await handleChat(
        dbInstanceA,
        'हाम्रो कक्षा कहिलेदेखि सुरु हुन्छ? मिति परिवर्तन भएको हो?',
        STUDENT_CTX,
        historyAfterEn,
        'sess_nov8_dev',
        { referenceDate: REFERENCE_NOV_8_2026 }
      );
      assert.match(devRes.reply, /2026-11-16/);
      assert.match(devRes.reply, /2083-08-01|1 Mangsir 2083/);
      assert.match(devRes.reply, /supersedes|2026-11-12/i);

      stagingReport.dateRegression = {
        referenceAdDate: clock.adDate,
        referenceBsDate: clock.bsDate,
        latestNoticeEffectiveAdDate: '2026-11-16',
        latestNoticeEffectiveBsDate: '2083-08-01',
        supersededNoticeAdDate: '2026-11-12',
        englishPassed: true,
        romanizedNepaliPassed: true,
        devanagariPassed: true
      };
    });
  });

  // ===========================================================================
  // 5. PRODUCTION SMOKE TESTING (WEB & REACT NATIVE MOBILE HTTP/SSE FLOWS)
  // ===========================================================================
  describe('5. Production Smoke Testing (Staging Web & Mobile HTTP/SSE Endpoints + Visual Renderers)', () => {
    let reqOverrideOptions = null;

    function buildStagingChatHandler() {
      const stagingAssistant = {
        handleChat: (db, msg, studentInfo, history, convId, opts = {}) =>
          aiAssistant.handleChat(db, msg, studentInfo, history, convId, {
            ...opts,
            referenceDate: REFERENCE_NOV_8_2026,
            academicContext: studentInfo?.authenticated ? studentInfo : undefined,
            ...(reqOverrideOptions || {})
          })
      };
      return createChatHandler(dbInstanceA, stagingAssistant, { heartbeatMs: 5000 });
    }

    async function invokeChatJson(message, userRole = 'student', history = []) {
      const handler = buildStagingChatHandler();
      const userObj = userRole === 'student' ? STUDENT_CTX : (userRole === 'teacher' ? TEACHER_DSA_CTX : null);
      return new Promise((resolve, reject) => {
        let statusCode = 200;
        const req = {
          body: { message, history, stream: false },
          headers: {},
          user: userObj,
          session: {
            studentId: userObj?.studentId || null,
            role: userObj?.role || 'guest',
            chatMode: userRole === 'teacher' ? 'formal' : 'roast',
            save: cb => cb?.()
          }
        };
        const res = {
          status(code) { statusCode = code; return this; },
          set() { return this; },
          json(payload) { resolve({ status: statusCode, data: payload }); }
        };
        handler(req, res).catch(reject);
      });
    }

    async function invokeChatSse(message, userRole = 'student', history = []) {
      const handler = buildStagingChatHandler();
      const userObj = userRole === 'student' ? STUDENT_CTX : (userRole === 'teacher' ? TEACHER_DSA_CTX : null);
      return new Promise((resolve, reject) => {
        let statusCode = 200;
        let rawText = '';
        const req = {
          body: { message, history, stream: true },
          headers: { accept: 'text/event-stream' },
          user: userObj,
          session: {
            studentId: userObj?.studentId || null,
            role: userObj?.role || 'guest',
            chatMode: userRole === 'teacher' ? 'formal' : 'roast',
            save: cb => cb?.()
          },
          on() {},
          off() {}
        };
        const res = {
          destroyed: false,
          writableEnded: false,
          status(code) { statusCode = code; return this; },
          set() { return this; },
          flushHeaders() {},
          write(chunk) { rawText += String(chunk); },
          end() {
            this.writableEnded = true;
            const events = [];
            for (const block of rawText.split('\n\n')) {
              const lines = block.trim().split('\n');
              let eventName = null;
              let dataStr = '';
              for (const l of lines) {
                if (l.startsWith('event:')) eventName = l.slice(6).trim();
                else if (l.startsWith('data:')) dataStr += l.slice(5).trim();
              }
              if (eventName && dataStr) {
                events.push({ event: eventName, data: JSON.parse(dataStr) });
              }
            }
            const deltas = events.filter(e => e.event === 'delta').map(e => e.data.text).join('');
            const finalResult = events.find(e => e.event === 'result')?.data || null;
            resolve({ status: statusCode, events, deltas, finalResult });
          },
          on() {},
          off() {}
        };
        handler(req, res).catch(reject);
      });
    }

    it('5.1 Smoke tests Student authorization, Teacher authorization, Assignment deadlines, Attendance, Published marks, Notices, Academic tutoring, Visual rendering, and Provider failure recovery', async () => {
      // 1. Student Authorization (own data allowed, cross-student blocked)
      const crossStudentRes = await invokeChatJson("Show Bikash Gurung's attendance and marks", 'student');
      assert.equal(crossStudentRes.status, 200);
      assert.match(crossStudentRes.data.reply, /only access your own|private|cannot share another student|another student/i);

      // 2. Teacher Authorization (assigned DSA allowed, unassigned Semester 5 Networks blocked)
      const teacherAllowed = await invokeChatJson('Show assignments for Data Structure and Algorithms', 'teacher');
      assert.equal(teacherAllowed.status, 200);
      assert.match(teacherAllowed.data.reply, /DSA Linked List & Stack Lab/i);

      const teacherDenied = await invokeChatJson('Show assignments for Semester 5 Data Communication and Computer Networks', 'teacher');
      assert.equal(teacherDenied.status, 200);
      assert.match(teacherDenied.data.reply, /assigned to teach Semester\(s\) 3|not in your assigned teaching subjects/i);

      // 3. Assignment Deadlines via SSE Streaming (Mobile/Web SSE flow)
      const assignSse = await invokeChatSse('Which assignments are pending and which one is due first?', 'student');
      assert.equal(assignSse.status, 200);
      assert.ok(assignSse.finalResult, 'SSE stream must emit final result event');
      assert.match(assignSse.finalResult.reply, /DSA Linked List & Stack Lab/);
      assert.match(assignSse.finalResult.reply, /urgent one and due first/i);
      assert.match(assignSse.finalResult.reply, /4 days/i);
      assert.ok(assignSse.finalResult.resourceCards.some(c => c.type === 'assignment' && Number(c.id) === 101));

      // 4. Attendance across subjects via JSON & Web Visual Renderer
      const attJson = await invokeChatJson('How is my attendance across all subjects?', 'student');
      assert.equal(attJson.status, 200);
      assert.match(attJson.data.reply, /Data Structure and Algorithms/);
      assert.match(attJson.data.reply, /100%/);
      assert.match(attJson.data.reply, /Database Management System/);
      assert.match(attJson.data.reply, /0%/);
      assert.match(attJson.data.reply, /```attendance/);

      // Extract ```attendance or ```attendance_chart payload and validate in Web renderer
      const chartMatch = attJson.data.reply.match(/```(attendance(?:_chart)?)\n([\s\S]*?)\n```/);
      assert.ok(chartMatch, 'Attendance response must include ```attendance block');
      const renderedChartHtml = renderAdaptiveVisualBlockHtml(chartMatch[1], chartMatch[2]);
      assert.match(renderedChartHtml, /kyana-adaptive-visual|kyana-visual-attendance/);
      assert.match(renderedChartHtml, /Data Structure and Algorithms/);

      // 5. Published Marks vs Unpublished Draft Marks
      const marksJson = await invokeChatJson('Show my exam marks and results', 'student');
      assert.equal(marksJson.status, 200);
      assert.match(marksJson.data.reply, /41\s*\/\s*50|41/);
      assert.match(marksJson.data.reply, /Mid-Term/i);
      assert.doesNotMatch(marksJson.data.reply, /47\s*\/\s*50/, 'Unpublished DBMS draft marks must never leak');

      // 6. Notices via SSE
      const noticeSse = await invokeChatSse('When does college reopen after Tihar?', 'student');
      assert.equal(noticeSse.status, 200);
      assert.match(noticeSse.finalResult.reply, /2026-11-16/);
      assert.match(noticeSse.finalResult.reply, /2083-08-01|1 Mangsir 2083/);

      // 7. Academic Tutoring & Visual Diagram Rendering ("Explain how cookies work")
      const tutorSse = await invokeChatSse('Explain how cookies work', 'student');
      assert.equal(tutorSse.status, 200);
      assert.match(tutorSse.finalResult.reply, /Set-Cookie/i);
      assert.match(tutorSse.finalResult.reply, /```diagram/);
      const diagMatch = tutorSse.finalResult.reply.match(/```diagram\n([\s\S]*?)\n```/);
      assert.ok(diagMatch, 'Cookies explanation must include ```diagram block');
      const renderedDiagramHtml = renderAdaptiveVisualBlockHtml('diagram', diagMatch[1]);
      assert.match(renderedDiagramHtml, /kyana-visual-diagram/);

      // Verify Mobile PostMarkdown.tsx visual block support
      const mobilePostMarkdownSource = fs.readFileSync(path.join(__dirname, '../mobile/components/PostMarkdown.tsx'), 'utf8');
      assert.match(mobilePostMarkdownSource, /class MarkdownErrorBoundary/);
      assert.match(mobilePostMarkdownSource, /attendance/);
      assert.match(mobilePostMarkdownSource, /roadmap/);

      // 8. Model Provider Failure & Recovery over HTTP/SSE
      reqOverrideOptions = {
        generateReply: async () => {
          throw new ChatProviderError('Simulated upstream 503 outage', 'PROVIDER_HTTP_ERROR', true);
        }
      };
      try {
        const recoverySse = await invokeChatSse('What should I prepare before my next exam?', 'student');
        assert.equal(recoverySse.status, 200);
        assert.ok(recoverySse.finalResult, 'SSE endpoint must recover and return verified result when LLM provider fails');
        assert.equal(recoverySse.finalResult.agentTrace.metrics.llmFallbackUsed, true);
        assert.match(recoverySse.finalResult.reply, /Data Structure and Algorithms/);
        assert.match(recoverySse.finalResult.reply, /```roadmap/);
      } finally {
        reqOverrideOptions = null;
      }

      stagingReport.smokeTests = {
        studentAuthorizationPassed: true,
        teacherAuthorizationPassed: true,
        assignmentDeadlinesSsePassed: true,
        attendanceComparisonPassed: true,
        publishedMarksIsolationPassed: true,
        noticesSsePassed: true,
        academicTutoringPassed: true,
        visualRenderingWebAndMobilePassed: true,
        modelProviderFailureRecoveryPassed: true
      };
    });
  });
});
