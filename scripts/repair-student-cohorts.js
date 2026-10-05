'use strict';

/**
 * scripts/repair-student-cohorts.js
 *
 * Safe repair process for existing student accounts with cohort_id = NULL.
 *
 * Rules:
 * - AUTO_ASSIGN_SAFE: role IN ('student', 'cr'), cohort_id IS NULL, valid semester,
 *   exactly 1 active cohort with current_semester = student semester, not staff, not test.
 * - ALREADY_ASSIGNED: cohort_id already populated.
 * - AMBIGUOUS: no matching active cohort or multiple matching cohorts.
 * - INVALID: semester cannot be parsed / invalid.
 * - SKIP_STAFF: role IN ('admin', 'teacher').
 * - SKIP_TEST: synthetic/test accounts.
 *
 * Usage:
 *   node scripts/repair-student-cohorts.js           # Dry-run
 *   node scripts/repair-student-cohorts.js --apply   # Transactional execution
 */

const db = require('../db');
const { parseSemesterNumber, logCohortAudit } = require('../lib/academic-context');

function isTestAccount(student) {
  const sid = String(student.studentId || '').toUpperCase();
  const name = String(student.name || '').toLowerCase();
  return (
    sid.startsWith('TEST-') ||
    sid.startsWith('TEST_') ||
    sid.startsWith('API-STUDENT') ||
    sid.startsWith('NC-STUDENT') ||
    sid.startsWith('STUDENT_S') ||
    sid.startsWith('SMOKE-') ||
    name.includes('test') ||
    name.includes('smoke')
  );
}

async function analyzeStudentCohortStatus(dbInstance = db) {
  const cohorts = (await dbInstance.all(
    `SELECT id, slot_code, display_name, current_semester, status
     FROM cohorts
     WHERE status = 'active'`
  )) || [];

  const cohortBySem = new Map();
  for (const c of cohorts) {
    const sem = Number(c.currentSemester || c.current_semester);
    if (!cohortBySem.has(sem)) cohortBySem.set(sem, []);
    cohortBySem.get(sem).push(c);
  }

  const students = (await dbInstance.all(
    `SELECT studentId, name, role, semester, cohort_id
     FROM students
     ORDER BY CASE
       WHEN role IN ('admin', 'teacher') THEN 3
       WHEN cohort_id IS NOT NULL THEN 2
       ELSE 1
     END, studentId ASC`
  )) || [];

  const report = [];

  for (const s of students) {
    const studentId = s.studentId;
    const name = s.name;
    const role = (s.role || 'student').toLowerCase();
    const legacySemester = s.semester || null;
    const currentCohortId = s.cohort_id || s.cohortId || null;

    let status = 'AMBIGUOUS';
    let matchingCohortName = null;
    let proposedCohortId = null;

    if (role === 'admin' || role === 'teacher') {
      status = 'SKIP_STAFF';
    } else if (isTestAccount(s)) {
      status = 'SKIP_TEST';
    } else if (currentCohortId) {
      status = 'ALREADY_ASSIGNED';
      const existing = cohorts.find(c => c.id === currentCohortId);
      matchingCohortName = existing ? `${existing.displayName || existing.display_name} (Sem ${existing.currentSemester || existing.current_semester})` : 'Unknown/Archived';
      proposedCohortId = currentCohortId;
    } else {
      const semNum = parseSemesterNumber(legacySemester);
      if (!semNum) {
        status = 'INVALID';
      } else {
        const matches = cohortBySem.get(semNum) || [];
        if (matches.length === 0) {
          status = 'AMBIGUOUS';
        } else if (matches.length > 1) {
          status = 'AMBIGUOUS';
        } else {
          const match = matches[0];
          status = 'AUTO_ASSIGN_SAFE';
          matchingCohortName = `${match.displayName || match.display_name} (Sem ${match.currentSemester || match.current_semester})`;
          proposedCohortId = match.id;
        }
      }
    }

    report.push({
      studentId,
      name,
      role,
      legacySemester,
      currentCohortId,
      matchingActiveCohort: matchingCohortName,
      proposedCohortId,
      status
    });
  }

  return { cohorts, report };
}

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n=============================================================================`);
  console.log(`  Semester Library — Student Cohort Safe Repair (${isApply ? 'APPLY MODE' : 'DRY-RUN'})`);
  console.log(`=============================================================================\n`);

  const { cohorts, report } = await analyzeStudentCohortStatus(db);

  console.log(`Active Cohorts:`);
  for (const c of cohorts) {
    console.log(` - ${c.displayName || c.display_name} (${(c.slotCode || c.slot_code).toUpperCase()}): Semester ${c.currentSemester || c.current_semester} [UUID: ${c.id}]`);
  }
  console.log(`\nAccount Audit (${report.length} accounts):\n`);

  console.log(
    '| ' +
    'studentId'.padEnd(28) + ' | ' +
    'name'.padEnd(20) + ' | ' +
    'role'.padEnd(7) + ' | ' +
    'legacy sem'.padEnd(11) + ' | ' +
    'current cohort_id'.padEnd(20) + ' | ' +
    'matching cohort'.padEnd(20) + ' | ' +
    'status'.padEnd(17) + ' |'
  );
  console.log('|-' + '-'.repeat(28) + '-|-' + '-'.repeat(20) + '-|-' + '-'.repeat(7) + '-|-' + '-'.repeat(11) + '-|-' + '-'.repeat(20) + '-|-' + '-'.repeat(20) + '-|-' + '-'.repeat(17) + '-|');

  for (const r of report) {
    const sid = String(r.studentId).slice(0, 28).padEnd(28);
    const n = String(r.name).slice(0, 20).padEnd(20);
    const ro = String(r.role).padEnd(7);
    const ls = String(r.legacySemester || 'NULL').padEnd(11);
    const cc = (r.currentCohortId ? r.currentCohortId.slice(0, 8) + '...' : 'NULL').padEnd(20);
    const mc = String(r.matchingActiveCohort || '-').slice(0, 20).padEnd(20);
    const st = String(r.status).padEnd(17);
    console.log(`| ${sid} | ${n} | ${ro} | ${ls} | ${cc} | ${mc} | ${st} |`);
  }

  const safeList = report.filter(r => r.status === 'AUTO_ASSIGN_SAFE');
  const alreadyList = report.filter(r => r.status === 'ALREADY_ASSIGNED');
  const skipStaff = report.filter(r => r.status === 'SKIP_STAFF');
  const skipTest = report.filter(r => r.status === 'SKIP_TEST');
  const ambiguous = report.filter(r => r.status === 'AMBIGUOUS');
  const invalid = report.filter(r => r.status === 'INVALID');

  console.log(`\nSummary:`);
  console.log(` - AUTO_ASSIGN_SAFE : ${safeList.length}`);
  console.log(` - ALREADY_ASSIGNED : ${alreadyList.length}`);
  console.log(` - SKIP_STAFF      : ${skipStaff.length}`);
  console.log(` - SKIP_TEST       : ${skipTest.length}`);
  console.log(` - AMBIGUOUS       : ${ambiguous.length}`);
  console.log(` - INVALID         : ${invalid.length}`);

  if (safeList.length > 0) {
    console.log(`\nProposed Actions for AUTO_ASSIGN_SAFE:`);
    for (const s of safeList) {
      console.log(` -> Assign ${s.studentId} ("${s.name}") to ${s.matchingActiveCohort} [UUID: ${s.proposedCohortId}]`);
    }
  }

  if (isApply) {
    if (safeList.length === 0) {
      console.log('\nNo accounts qualify for AUTO_ASSIGN_SAFE. Nothing to apply.');
      process.exit(0);
    }

    console.log(`\nApplying ${safeList.length} assignments transactionally...`);
    await db.withTransaction(async (tx) => {
      for (const item of safeList) {
        await tx.run(
          `UPDATE students
           SET cohort_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE studentId = ? AND (cohort_id IS NULL OR cohort_id = '')`,
          item.proposedCohortId,
          item.studentId
        );

        await logCohortAudit(tx, {
          action: 'safe_repair_auto_assign',
          cohortId: item.proposedCohortId,
          actorId: 'system_repair_script',
          details: {
            studentId: item.studentId,
            studentName: item.name,
            legacySemester: item.legacySemester,
            assignedCohort: item.matchingActiveCohort
          }
        });
      }
    });

    console.log(`✅ Successfully repaired ${safeList.length} accounts in production!`);
  } else {
    console.log(`\n[DRY RUN ONLY] No changes were written to the database.`);
    console.log(`To execute these assignments, run: node scripts/repair-student-cohorts.js --apply\n`);
  }

  process.exit(0);
}

if (require.main === module) {
  run().catch(err => {
    console.error('Repair script failed:', err);
    process.exit(1);
  });
}

module.exports = {
  isTestAccount,
  analyzeStudentCohortStatus
};
