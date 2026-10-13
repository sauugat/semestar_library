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
  await db.run(
    `INSERT OR REPLACE INTO cohorts (id, slot_code, group_code, display_name, intake_year, current_semester, status, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa-cohort-mercury', 'mercury', 'MERCURY', 'BIT 2025 Mercury', 2025, 1, 'active', 1
  );

  // Seed Chat Group for Cohort
  await db.run(
    `INSERT OR REPLACE INTO chat_groups (id, cohort_id, kind, status, realtime_epoch, projection_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'group-qa-mercury', 'qa-cohort-mercury', 'cohort', 'active', 1, 'ready'
  );

  // Seed Chat Group Slot
  await db.run(
    `INSERT OR REPLACE INTO chat_group_slots (group_code, current_chat_group_id, version)
     VALUES (?, ?, ?)`,
    'MERCURY', 'group-qa-mercury', 1
  );

  console.log('[QA Seed]: Seeding canonical subjects...');
  const subjects = [
    { id: 'sub_cs101', code: 'CS101', name: 'Introduction to Programming', sem: 1, nature: 'Theory + Lab' },
    { id: 'sub_cs102', code: 'CS102', name: 'Discrete Mathematics', sem: 1, nature: 'Theory' },
    { id: 'sub_cs103', code: 'CS103', name: 'Digital Logic Systems', sem: 1, nature: 'Theory + Lab' },
  ];

  for (const s of subjects) {
    await db.run(
      `INSERT OR REPLACE INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.code, s.name, s.sem, 'BIT', 3.0, s.nature, 1
    );
  }

  console.log('[QA Seed]: Seeding synthetic test accounts...');
  // 1. qa_admin
  await db.run(
    `INSERT OR REPLACE INTO students (
      studentId, username, name, passwordHash, role, department, semester, account_status, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa_admin', 'qa_admin', 'QA Administrator', QA_PASSWORD_HASHES.admin, 'admin', 'BIT', 'Semester 1', 'active', 'verified'
  );

  // 2. qa_student
  await db.run(
    `INSERT OR REPLACE INTO students (
      studentId, username, name, passwordHash, role, department, semester, cohort_id, account_status, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa_student', 'qa_student', 'QA Student', QA_PASSWORD_HASHES.student, 'student', 'BIT', 'Semester 1', 'qa-cohort-mercury', 'active', 'verified'
  );

  // 3. qa_cr
  await db.run(
    `INSERT OR REPLACE INTO students (
      studentId, username, name, passwordHash, role, department, semester, cohort_id, account_status, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa_cr', 'qa_cr', 'QA Class Representative', QA_PASSWORD_HASHES.cr, 'cr', 'BIT', 'Semester 1', 'qa-cohort-mercury', 'active', 'verified'
  );

  // 4. qa_teacher
  await db.run(
    `INSERT OR REPLACE INTO students (
      studentId, username, email, name, passwordHash, role, department, semester, account_status, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa_teacher', 'qa_teacher', 'qa_teacher@test.local', 'QA Teacher', QA_PASSWORD_HASHES.teacher, 'teacher', 'BIT', 'Semester 1', 'active', 'verified'
  );

  // Teachers table link
  await db.run(
    `INSERT OR REPLACE INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    't_qa_teacher', 'qa_teacher', 'Senior Lecturer', 'active'
  );

  // Teacher subject assignments
  await db.run(
    `INSERT OR REPLACE INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_qa_1', 't_qa_teacher', 'sub_cs101'
  );
  await db.run(
    `INSERT OR REPLACE INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_qa_2', 't_qa_teacher', 'sub_cs102'
  );

  console.log('[QA Seed]: Seeding academic materials and coursework...');
  // File / Material
  await db.run(
    `INSERT OR REPLACE INTO files (id, storedName, originalName, title, subject, chapter, semester, uploadedBy, sizeBytes, cohort_id, semester_no, audience_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    1, 'qa_lecture1_intro.pdf', 'Lecture_01_Intro.pdf', 'Lecture 1: Introduction to Programming',
    'CS101', 'Unit 1', 'Semester 1', 'qa_teacher', 102400, 'qa-cohort-mercury', 1, 'cohort'
  );

  // Assignment
  await db.run(
    `INSERT OR REPLACE INTO assignments (id, title, description, subject, semester, deadline, createdBy, cohort_id, semester_no, audience_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    1, 'Assignment 1: Logic Gates & Truth Tables', 'Complete questions 1 to 5 from chapter 1.',
    'CS102', 'Semester 1', '2026-11-20T23:59:59Z', 'qa_teacher', 'qa-cohort-mercury', 1, 'cohort'
  );

  console.log('[QA Seed]: Seeding posts, comments, and moderation report...');
  // Post
  await db.run(
    `INSERT OR REPLACE INTO posts (id, student_id, title, content, audience_scope, cohort_id, semester_no, moderation_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    1, 'qa_student', 'Welcome to Local QA Testing',
    'This post is seeded for verifying mobile feed, comment, and moderation actions.',
    'cohort', 'qa-cohort-mercury', 1, 'visible'
  );

  // Comment
  await db.run(
    `INSERT OR REPLACE INTO post_comments (id, post_id, student_id, content, moderation_status)
     VALUES (?, ?, ?, ?, ?)`,
    1, 1, 'qa_cr', 'Feed, comments, and role navigation are functioning properly in local QA!', 'visible'
  );

  // Moderation Report
  await db.run(
    `INSERT OR REPLACE INTO content_reports (id, content_type, content_id, reporter_id, reason, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    1, 'post', 1, 'qa_cr', 'other',
    'Test moderation report for Admin Content Moderation panel testing.', 'open'
  );

  // Admin Audit Log
  await db.run(
    `INSERT OR REPLACE INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, before_state, after_state, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'qa_audit_init', 'qa_admin', 'qa_environment_initialized', 'system', 'qa_environment',
    '{}', '{"status":"active"}', '{"environment":"local_qa"}'
  );

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
  // When executed directly, ensure QA environment flags are set
  process.env.QA_MODE = 'true';
  process.env.NODE_ENV = 'qa';
  process.env.EXPO_PUSH_DISABLED = 'true';
  process.env.TEACHER_ONBOARDING_ENABLED = 'false';
  process.env.DM_ENABLED = 'false';

  const db = require('../db');
  seedQa(db)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[QA Seed Error]:', err.message);
      process.exit(1);
    });
}

module.exports = { seedQa, QA_PASSWORD_HASHES };
