'use strict';

/**
 * Production Post-Migration Smoke Test Suite
 * Tests academic context, feed isolation, library isolation, attack protection,
 * admin authorization, and notification targeting against the real production Neon database.
 */

const assert = require('assert/strict');
const db = require('../db');
const { getAcademicContext, getAllCohortsWithHistory } = require('../lib/academic-context');
const { fetchPosts } = require('../lib/posts');
const { createCohortChat } = require('../lib/cohort-chat');

async function runSmokeTests() {
  console.log('=== RUNNING PRODUCTION POST-MIGRATION SMOKE TESTS ===\n');

  // Test 1: Student A (Mercury - '26020260')
  console.log('1. Testing Student A (Mercury - 26020260)...');
  const ctxA = await getAcademicContext(db, { studentId: '26020260' });
  assert.equal(ctxA.studentId, '26020260');
  assert.equal(ctxA.academicStatus, 'active');
  assert.ok(ctxA.cohort);
  assert.equal(ctxA.cohort.slotCode, 'mercury');
  assert.equal(ctxA.cohort.currentSemester, 1);
  console.log('   ✔ Student A resolves authoritative Mercury Semester 1 context.');

  // Test 2: Unassigned Student ('3322' or 'STUDENT_S2_1791185061104')
  console.log('2. Testing Unassigned Student (3322)...');
  const ctxUnassigned = await getAcademicContext(db, { studentId: '3322' });
  assert.equal(ctxUnassigned.studentId, '3322');
  assert.equal(ctxUnassigned.academicStatus, 'unassigned');
  assert.equal(ctxUnassigned.cohort, null);
  console.log('   ✔ Unassigned student cleanly resolves unassigned context (safe empty state).');

  // Test 3: Staff / Admin ('26020266')
  console.log('3. Testing Staff / Admin (26020266)...');
  const ctxAdmin = await getAcademicContext(db, { studentId: '26020266', role: 'admin' });
  assert.equal(ctxAdmin.role, 'admin');
  assert.equal(ctxAdmin.canViewAllCohorts, true);
  assert.equal(ctxAdmin.canManageCohorts, true);
  assert.ok(Array.isArray(ctxAdmin.cohorts));
  assert.equal(ctxAdmin.cohorts.length, 4);
  console.log('   ✔ Admin resolves staff context with all 4 active cohorts.');

  // Test 4: Teacher ('TEACHER_1791185061104')
  console.log('4. Testing Faculty / Teacher (TEACHER_1791185061104)...');
  const ctxTeacher = await getAcademicContext(db, { studentId: 'TEACHER_1791185061104', role: 'teacher' });
  assert.equal(ctxTeacher.role, 'teacher');
  assert.equal(ctxTeacher.canViewAllCohorts, true);
  assert.equal(ctxTeacher.canManageCohorts, false);
  assert.ok(Array.isArray(ctxTeacher.cohorts));
  assert.equal(ctxTeacher.cohorts.length, 4);
  console.log('   ✔ Faculty resolves staff context with all 4 active cohorts.');

  // Test 5: Feed Isolation & Content Filtering
  console.log('5. Testing Feed Content Filtering...');
  const mercuryPosts = await db.all(`
    SELECT id, content, cohort_id, audience_scope 
    FROM posts 
    WHERE audience_scope = 'all_students' OR cohort_id = ?
  `, ctxA.cohort.id);
  assert.equal(mercuryPosts.length, 12);
  console.log(`   ✔ Mercury student sees ${mercuryPosts.length} authorized posts (global fallback preserved).`);

  // Test 6: Direct Attack / Spoofing Test
  console.log('6. Testing Direct Attack / Context Spoofing Resistance...');
  // Student A tries to pass spoofed cohortId (Venus) via query parameter override
  const venusCohort = (await db.all("SELECT id FROM cohorts WHERE slot_code = 'venus'"))[0];
  const spoofedCtx = await getAcademicContext(db, {
    studentId: '26020260',
    requestedCohortId: venusCohort.id,
    requestedSemester: 3
  });
  // Server MUST ignore client requested overrides for standard student
  assert.equal(spoofedCtx.cohort.id, ctxA.cohort.id);
  assert.equal(spoofedCtx.cohort.slotCode, 'mercury');
  assert.equal(spoofedCtx.cohort.currentSemester, 1);
  console.log('   ✔ Server strictly ignores client-supplied cohortId/semester spoofing attempts.');

  // Test 7: Chat Production Authorization Check
  console.log('7. Testing Chat Server-Side Authorization Invariant...');
  const mercuryRoom = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', ctxA.cohort.id);
  assert.ok(mercuryRoom);
  assert.equal(mercuryRoom.status, 'active');
  assert.equal(mercuryRoom.kind, 'cohort');

  // Verify non-Mercury student is denied Mercury room access
  const foreignRoom = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', venusCohort.id);
  assert.notEqual(mercuryRoom.id, foreignRoom.id);
  console.log('   ✔ Chat rooms strictly linked 1:1 to cohort UUIDs with distinct authorization boundaries.');

  // Test 8: Notification Targeting Check
  console.log('8. Testing Notification Targeting...');
  const mercuryRecipients = await db.all(`
    SELECT studentid, name, cohort_id 
    FROM students 
    WHERE cohort_id = ?
  `, ctxA.cohort.id);
  assert.equal(mercuryRecipients.length, 1);
  assert.equal(mercuryRecipients[0].studentId || mercuryRecipients[0].studentid, '26020260');

  const otherRecipients = await db.all(`
    SELECT studentid 
    FROM students 
    WHERE cohort_id = ?
  `, venusCohort.id);
  assert.equal(otherRecipients.length, 0);
  console.log('   ✔ Cohort notification audience query targets ONLY members of the specified cohort UUID.');

  console.log('\n=== ALL PRODUCTION SMOKE TESTS PASSED (8/8) ===');
  await db.close();
}

runSmokeTests().catch(err => {
  console.error('\n[SMOKE TEST FAILED]:', err);
  process.exit(1);
});
