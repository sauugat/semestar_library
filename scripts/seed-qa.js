'use strict';

/**
 * Phase 4D.3: Deterministic Local QA Seed Script
 *
 * Seeds artificial test accounts and realistic relational data into disposable local storage.
 * - qa_admin (Admin role)
 * - qa_student (Student role, Semester 1 BIT)
 * - qa_cr (CR role, Semester 1 BIT)
 * - qa_teacher (Teacher role, assigned to CS101 & CS102)
 *
 * Guarantees:
 * - Fail-closed: Will abort immediately if connected to production Neon or Supabase.
 * - Idempotent: Can be run repeatedly without duplicating or corrupting data.
 * - All artificial data: zero production records copied.
 */

const bcrypt = require('bcryptjs');
const { assertSafeQaEnvironment } = require('../lib/qa-guard');
const { ensureAcademicCohortSchema } = require('../lib/academic-context');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensurePostsSchema } = require('../lib/posts');
const { ensureAuditSchema } = require('../lib/audit-service');

const QA_PASSWORD_HASHES = {
  admin: bcrypt.hashSync('QaAdmin123!', 10),
  student: bcrypt.hashSync('QaStudent123!', 10),
  cr: bcrypt.hashSync('QaCr123!', 10),
  teacher: bcrypt.hashSync('QaTeacher123!', 10),
};

async function upsertRecord(db, table, conflictCol, record) {
  const keys = Object.keys(record);
  const placeholders = keys.map(() => '?').join(', ');
  const updateClause = keys
    .filter(k => k !== conflictCol)
    .map(k => `${k} = excluded.${k}`)
    .join(', ');

  const sql = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(${conflictCol}) DO UPDATE SET ${updateClause}
  `;
  await db.run(sql, ...Object.values(record));
}

async function seedQa(db) {
  // 1. Enforce fail-closed production guards
  assertSafeQaEnvironment();

  console.log('[QA Seed]: Initializing database schema on disposable storage...');
  await db.initSchema();
  await ensureAcademicCohortSchema({
    exec: db.exec,
    run: db.run,
    all: db.all,
    isPostgres: db.isPostgres
  });
  await ensureTeacherSchema({
    exec: db.exec,
    isPostgres: db.isPostgres
  });
  await ensurePostsSchema({
    exec: db.exec,
    isPostgres: db.isPostgres
  });
  await ensureAuditSchema(db);

  console.log('[QA Seed]: Seeding academic cohorts and chat rooms...');
  // Seed Cohort
  await upsertRecord(db, 'cohorts', 'id', {
    id: 'qa-cohort-mercury',
    slot_code: 'mercury',
    group_code: 'MERCURY',
    display_name: 'BIT 2025 Mercury',
    intake_year: 2025,
    current_semester: 1,
    status: 'active',
    version: 1
  });

  // Seed Chat Group for Cohort
  await upsertRecord(db, 'chat_groups', 'id', {
    id: 'group-qa-mercury',
    cohort_id: 'qa-cohort-mercury',
    kind: 'cohort',
    status: 'active',
    realtime_epoch: 1,
    projection_status: 'ready'
  });

  // Seed Chat Group Slot
  await upsertRecord(db, 'chat_group_slots', 'group_code', {
    group_code: 'MERCURY',
    current_chat_group_id: 'group-qa-mercury',
    version: 1
  });

  console.log('[QA Seed]: Seeding canonical subjects...');
  const subjects = [
    { id: 'sub_cs101', code: 'CS101', name: 'Introduction to Programming', semester: 1, department: 'BIT', credit_hours: 3.0, nature: 'Theory + Lab', active: 1 },
    { id: 'sub_cs102', code: 'CS102', name: 'Discrete Mathematics', semester: 1, department: 'BIT', credit_hours: 3.0, nature: 'Theory', active: 1 },
    { id: 'sub_cs103', code: 'CS103', name: 'Digital Logic Systems', semester: 1, department: 'BIT', credit_hours: 3.0, nature: 'Theory + Lab', active: 1 },
  ];

  for (const s of subjects) {
    await upsertRecord(db, 'subjects', 'id', s);
  }

  console.log('[QA Seed]: Seeding synthetic test accounts...');
  // 1. qa_admin
  await upsertRecord(db, 'students', 'studentId', {
    studentId: 'qa_admin',
    username: 'qa_admin',
    name: 'QA Administrator',
    passwordHash: QA_PASSWORD_HASHES.admin,
    role: 'admin',
    department: 'BIT',
    semester: 'Semester 1',
    account_status: 'active',
    verification_status: 'verified'
  });

  // 2. qa_student
  await upsertRecord(db, 'students', 'studentId', {
    studentId: 'qa_student',
    username: 'qa_student',
    name: 'QA Student',
    passwordHash: QA_PASSWORD_HASHES.student,
    role: 'student',
    department: 'BIT',
    semester: 'Semester 1',
    cohort_id: 'qa-cohort-mercury',
    account_status: 'active',
    verification_status: 'verified'
  });

  // 3. qa_cr
  await upsertRecord(db, 'students', 'studentId', {
    studentId: 'qa_cr',
    username: 'qa_cr',
    name: 'QA Class Representative',
    passwordHash: QA_PASSWORD_HASHES.cr,
    role: 'cr',
    department: 'BIT',
    semester: 'Semester 1',
    cohort_id: 'qa-cohort-mercury',
    account_status: 'active',
    verification_status: 'verified'
  });

  // 4. qa_teacher
  await upsertRecord(db, 'students', 'studentId', {
    studentId: 'qa_teacher',
    username: 'qa_teacher',
    email: 'qa_teacher@test.local',
    name: 'QA Teacher',
    passwordHash: QA_PASSWORD_HASHES.teacher,
    role: 'teacher',
    department: 'BIT',
    semester: 'Semester 1',
    account_status: 'active',
    verification_status: 'verified'
  });

  // Teachers table link
  await upsertRecord(db, 'teachers', 'id', {
    id: 't_qa_teacher',
    user_id: 'qa_teacher',
    designation: 'Senior Lecturer',
    status: 'active'
  });

  // Teacher subject assignments
  await upsertRecord(db, 'teacher_subjects', 'id', {
    id: 'ts_qa_1',
    teacher_id: 't_qa_teacher',
    subject_id: 'sub_cs101'
  });
  await upsertRecord(db, 'teacher_subjects', 'id', {
    id: 'ts_qa_2',
    teacher_id: 't_qa_teacher',
    subject_id: 'sub_cs102'
  });

  console.log('[QA Seed]: Seeding academic materials and coursework...');
  const nowIso = new Date().toISOString();

  // File / Material
  await upsertRecord(db, 'files', 'id', {
    id: 1,
    storedName: 'qa_lecture1_intro.pdf',
    originalName: 'Lecture_01_Intro.pdf',
    title: 'Lecture 1: Introduction to Programming',
    subject: 'CS101',
    chapter: 'Unit 1',
    semester: 'Semester 1',
    uploadedBy: 'qa_teacher',
    sizeBytes: 102400,
    uploadedAt: nowIso,
    cohort_id: 'qa-cohort-mercury',
    semester_no: 1,
    audience_scope: 'cohort'
  });

  // Assignment
  await upsertRecord(db, 'assignments', 'id', {
    id: 1,
    title: 'Assignment 1: Logic Gates & Truth Tables',
    description: 'Complete questions 1 to 5 from chapter 1.',
    language: 'c',
    subject: 'CS102',
    semester: 'Semester 1',
    deadline: '2026-11-20T23:59:59Z',
    createdBy: 'qa_teacher',
    createdAt: nowIso,
    cohort_id: 'qa-cohort-mercury',
    semester_no: 1,
    audience_scope: 'cohort'
  });

  console.log('[QA Seed]: Seeding posts, comments, and moderation report...');
  // Post
  await upsertRecord(db, 'posts', 'id', {
    id: 1,
    user_id: 'qa_student',
    title: 'Welcome to Local QA Testing',
    content: 'This post is seeded for verifying mobile feed, comment, and moderation actions.',
    audience_scope: 'cohort',
    cohort_id: 'qa-cohort-mercury',
    semester_no: 1,
    moderation_status: 'visible'
  });

  // Comment
  await upsertRecord(db, 'post_comments', 'id', {
    id: 1,
    post_id: 1,
    user_id: 'qa_cr',
    content: 'Feed, comments, and role navigation are functioning properly in local QA!',
    moderation_status: 'visible'
  });

  // Moderation Report
  await upsertRecord(db, 'content_reports', 'id', {
    id: 1,
    content_type: 'post',
    content_id: 1,
    reporter_id: 'qa_cr',
    reason: 'other',
    description: 'Test moderation report for Admin Content Moderation panel testing.',
    status: 'open'
  });

  // Admin Audit Log
  await upsertRecord(db, 'admin_audit_logs', 'id', {
    id: 'qa_audit_init',
    actor_user_id: 'qa_admin',
    action: 'qa_environment_initialized',
    entity_type: 'system',
    entity_id: 'qa_environment',
    before_state: '{}',
    after_state: '{"status":"active"}',
    metadata: '{"environment":"local_qa"}'
  });

  console.log('\n======================================================');
  console.log(' ✔ DISPOSABLE LOCAL QA DATA SEEDED SUCCESSFULLY');
  console.log('======================================================');
  console.log('Synthetic Accounts Available for Mobile Login:');
  console.log('  1. Admin:   username: qa_admin   | password: QaAdmin123!');
  console.log('  2. Student: username: qa_student | password: QaStudent123!');
  console.log('  3. CR:      username: qa_cr      | password: QaCr123!');
  console.log('  4. Teacher: username: qa_teacher | password: QaTeacher123!');
  console.log('======================================================\n');
}

if (require.main === module) {
  // When executed directly, ensure QA environment flags default safely
  if (!process.env.QA_MODE) process.env.QA_MODE = 'true';
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'qa';
  if (!process.env.EXPO_PUSH_DISABLED) process.env.EXPO_PUSH_DISABLED = 'true';
  if (!process.env.TEACHER_ONBOARDING_ENABLED) process.env.TEACHER_ONBOARDING_ENABLED = 'false';
  if (!process.env.DM_ENABLED) process.env.DM_ENABLED = 'false';

  const db = require('../db');
  seedQa(db)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[QA Seed Error]:', err.message);
      process.exit(1);
    });
}

module.exports = { seedQa, QA_PASSWORD_HASHES };
