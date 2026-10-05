'use strict';

/**
 * Academic Cohorts Migration & Backfill Tool
 *
 * Usage:
 *   node scripts/migrate-academic-cohorts.js           # Dry-run audit report
 *   node scripts/migrate-academic-cohorts.js --apply   # Apply to current database (local/test only)
 *
 * SAFETY RULE: Will abort if run against a remote production database without explicit flags.
 */

const crypto = require('crypto');
const db = require('../db');
const {
  ensureAcademicCohortSchema,
  createCohort
} = require('../lib/academic-context');
const { normalizeSemester } = require('../lib/note-search');

const CANONICAL_COHORTS = [
  { slotCode: 'mercury', displayName: 'Mercury', currentSemester: 1, intakeYear: 2024, intakeIdentifier: 'BIT-2024' },
  { slotCode: 'venus',   displayName: 'Venus',   currentSemester: 3, intakeYear: 2023, intakeIdentifier: 'BIT-2023' },
  { slotCode: 'earth',   displayName: 'Earth',   currentSemester: 5, intakeYear: 2022, intakeIdentifier: 'BIT-2022' },
  { slotCode: 'mars',    displayName: 'Mars',    currentSemester: 7, intakeYear: 2021, intakeIdentifier: 'BIT-2021' }
];

const TEST_STUDENT_REGEX = /^(TEST|NC-|API-|MOCK|SAMPLE)/i;

async function run() {
  const isApply = process.argv.includes('--apply');
  const isDryRun = !isApply;

  console.log('====================================================');
  console.log(`Academic Cohort Migration Tool — Mode: ${isDryRun ? 'DRY-RUN AUDIT' : 'APPLY MIGRATION'}`);
  console.log('====================================================');

  // Check safety gate
  if (db.isPostgres && process.env.NODE_ENV !== 'test' && isApply) {
    if (!process.argv.includes('--force-production')) {
      console.error('\n[SAFETY GATE TRIPPED]: Remote production database detected.');
      console.error('DO NOT run --apply against production during Phase 1.');
      console.error('To run safely locally, use NODE_ENV=test node scripts/migrate-academic-cohorts.js --apply\n');
      process.exit(1);
    }
  }

  // Ensure schema exists
  await db.initSchema();

  // 1. Audit Cohorts
  const existingCohorts = await db.all('SELECT * FROM cohorts');
  console.log(`\nExisting Cohorts in DB: ${existingCohorts.length}`);
  for (const c of existingCohorts) {
    console.log(`  - [${c.slotCode || c.slot_code}] ${c.displayName || c.display_name} (ID: ${c.id}) Sem: ${c.currentSemester || c.current_semester} Status: ${c.status}`);
  }

  // 2. Audit Students
  const allStudents = await db.all('SELECT studentId, name, role, department, semester, cohort_id FROM students');
  const testStudents = allStudents.filter(s => TEST_STUDENT_REGEX.test(s.studentId));
  const regularStudents = allStudents.filter(s => !TEST_STUDENT_REGEX.test(s.studentId));
  const bitBatchStudents = regularStudents.filter(s => /^260202\d\d$/.test(s.studentId));
  const unmappedStudents = regularStudents.filter(s => !/^260202\d\d$/.test(s.studentId));

  console.log(`\nTotal Students: ${allStudents.length}`);
  console.log(`  - Regular Gandaki Univ BIT Batch (260202xx): ${bitBatchStudents.length} (Category 1: Safely Mappable)`);
  console.log(`  - Other / Non-standard Students: ${unmappedStudents.length} (Category 3: Ambiguous - Keep unassigned)`);
  console.log(`  - Synthetic / Test Accounts: ${testStudents.length} (Category 4: Test/Legacy - Keep unassigned)`);

  // 3. Audit Files
  const allFiles = await db.all('SELECT id, originalName, title, semester, subject, uploadedBy, cohort_id, semester_no, audience_scope FROM files');
  const filesWithoutSem = allFiles.filter(f => !f.semester);
  const filesWithSem = allFiles.filter(f => f.semester);

  console.log(`\nTotal Files: ${allFiles.length}`);
  console.log(`  - General / Multi-cohort Files (semester IS NULL): ${filesWithoutSem.length} (Category 2: Global all_students)`);
  console.log(`  - Files with Semester Tag: ${filesWithSem.length} (Category 3: Ambiguous cohort provenance -> Fallback all_students with semester_no)`);

  // 4. Audit Posts
  const allPosts = await db.all('SELECT id, user_id, type, cohort_id, semester_no, audience_scope FROM posts');
  console.log(`\nTotal Posts: ${allPosts.length}`);
  console.log(`  - Existing Posts: ${allPosts.length} (Category 2: Global all_students)`);

  // 5. Audit Assignments
  const allAssignments = await db.all('SELECT id, title, subject, semester, cohort_id, semester_no, audience_scope FROM assignments');
  console.log(`\nTotal Assignments: ${allAssignments.length}`);

  if (isDryRun) {
    console.log('\n--- DRY-RUN SUMMARY (No database modifications were made) ---');
    console.log('To execute migration on local/test database, run with: --apply');
    await db.close();
    process.exit(0);
  }

  // --- APPLY PHASE (Local / Staging Only) ---
  console.log('\n>>> Applying Non-Destructive Academic Cohort Migration...');

  // Step A: Seed Canonical Active Cohorts if slot is vacant
  const cohortSlotMap = {};
  for (const item of CANONICAL_COHORTS) {
    const existing = await db.get('SELECT * FROM cohorts WHERE slot_code = ? AND status = "active"', item.slotCode);
    if (existing) {
      cohortSlotMap[item.slotCode] = existing.id;
      console.log(`  [Keep Cohort]: Slot ${item.slotCode} already occupied by ${existing.id}`);
    } else {
      const created = await createCohort(db, {
        slotCode: item.slotCode,
        displayName: item.displayName,
        currentSemester: item.currentSemester,
        intakeYear: item.intakeYear,
        intakeIdentifier: item.intakeIdentifier,
        actorId: 'MIGRATION_ADMIN'
      });
      cohortSlotMap[item.slotCode] = created.id;
      console.log(`  [Created Cohort]: Slot ${item.slotCode} -> ${created.id} (Sem ${created.currentSemester})`);
    }
  }

  // Step B: Backfill Safely Mappable Students (BIT regular students matching slot semesters)
  let studentsUpdated = 0;
  for (const s of bitBatchStudents) {
    const semNum = normalizeSemester(s.semester);
    let targetSlot = null;
    if (semNum === 1) targetSlot = 'mercury';
    else if (semNum === 3) targetSlot = 'venus';
    else if (semNum === 5) targetSlot = 'earth';
    else if (semNum === 7) targetSlot = 'mars';

    if (targetSlot && cohortSlotMap[targetSlot]) {
      const targetCohortId = cohortSlotMap[targetSlot];
      await db.run('UPDATE students SET cohort_id = ? WHERE studentId = ? AND cohort_id IS NULL', targetCohortId, s.studentId);
      studentsUpdated++;
    }
  }
  console.log(`  [Students Mapped]: ${studentsUpdated} safely mapped to active cohorts.`);

  // Step C: Backfill Global Content (Files without semester or institutional)
  let globalFiles = 0;
  for (const f of filesWithoutSem) {
    await db.run(
      'UPDATE files SET audience_scope = "all_students", cohort_id = NULL, semester_no = NULL WHERE id = ? AND audience_scope IS NULL',
      f.id
    );
    globalFiles++;
  }

  // Step D: Backfill Ambiguous Semester Files (preserve semester_no, fallback audience_scope = all_students)
  let ambiguousFiles = 0;
  for (const f of filesWithSem) {
    const semNo = normalizeSemester(f.semester);
    await db.run(
      'UPDATE files SET audience_scope = "all_students", semester_no = ? WHERE id = ? AND (semester_no IS NULL OR audience_scope IS NULL)',
      semNo, f.id
    );
    ambiguousFiles++;
  }
  console.log(`  [Files Mapped]: ${globalFiles} global files + ${ambiguousFiles} semester curriculum files backfilled.`);

  // Step E: Backfill Existing Posts (Default to all_students)
  let postsUpdated = 0;
  for (const p of allPosts) {
    await db.run(
      'UPDATE posts SET audience_scope = "all_students" WHERE id = ? AND (audience_scope IS NULL OR audience_scope = "")',
      p.id
    );
    postsUpdated++;
  }
  console.log(`  [Posts Mapped]: ${postsUpdated} posts backfilled to audience_scope = "all_students".`);

  // Step F: Backfill Existing Assignments
  // Classification:
  // - Admin / universal reference lab assignments (e.g. Assignment 20 created by admin 26020266 in Sem I):
  //   audience_scope = 'all_students', semester_no = 1, cohort_id = NULL. Accessible to any student in Sem 1.
  // - Cohort-student authored assignments (if any):
  //   audience_scope = 'cohort', cohort_id = creator.cohort_id, semester_no = semNo.
  // - Synthetic test assignments:
  //   audience_scope = 'all_students', semester_no = semNo, cohort_id = NULL.
  let assignmentsUpdated = 0;
  for (const a of allAssignments) {
    const semNo = normalizeSemester(a.semester) || 1;
    const isTest = TEST_STUDENT_REGEX.test(a.createdBy);
    const creator = regularStudents.find(s => s.studentId === a.createdBy);
    let targetCohortId = null;
    let targetScope = 'all_students';

    if (creator && creator.cohort_id && !isTest && creator.role === 'student') {
      targetCohortId = creator.cohort_id;
      targetScope = 'cohort';
    }

    await db.run(
      'UPDATE assignments SET audience_scope = ?, cohort_id = ?, semester_no = ? WHERE id = ? AND (semester_no IS NULL OR audience_scope IS NULL)',
      targetScope, targetCohortId, semNo, a.id
    );
    assignmentsUpdated++;
  }
  console.log(`  [Assignments Mapped]: ${assignmentsUpdated} assignments backfilled with semester_no snapshot & audience scope.`);

  console.log('\n>>> Migration Completed Successfully!');
  await db.close();
}

run().catch(err => {
  console.error('[Migration Error]:', err);
  process.exit(1);
});
