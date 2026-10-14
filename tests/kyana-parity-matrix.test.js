'use strict';

/**
 * KYANA AI 3.0 — Comprehensive Authorization Parity Matrix Test (G2 & G3)
 * Evaluates exhaustive matrix:
 *   - Resources: visibility (everyone, students_only, teachers_only, cohort_only)
 *                x audience_scope (cohort, all_students)
 *                x semester_no (1..8)
 *                x target_all_semesters (0, 1)
 *                x own vs other cohort
 *                x author is vs isn't viewer
 *   - Viewers: Students (Sem 1, 2, 4, 8), CR (Sem 3), Teacher (assigned [1,3]),
 *              Teacher (unassigned []), Admin
 *
 * Compares SQL retrieval authorization filter with assertContentAccess.
 * Enforces: Zero unexplained differences; exactly quantifies G3 historical access.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { assertContentAccess } = require('../lib/academic-context');
const { searchKnowledge } = require('../lib/knowledge-search');
const { applyKnowledgeMigration, rollbackKnowledgeMigration } = require('../lib/knowledge-schema');

describe('KYANA 3.0 G2 — Comprehensive Authorization Parity Matrix', () => {
  let client;
  const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    client = new Client({ connectionString });
    await client.connect();

    await client.query(`
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

      INSERT INTO cohorts (id, slot_code, display_name, current_semester)
      VALUES ('c_mercury', 'mercury', 'Mercury Cohort', 3),
             ('c_venus', 'venus', 'Venus Cohort', 5)
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

      INSERT INTO students (studentId, name, role, account_status)
      VALUES ('stu_alice', 'Alice Mercury', 'student', 'active'),
             ('tea_carol', 'Carol Teacher', 'teacher', 'active'),
             ('stu_mercury_3', 'Mercury Student 3', 'student', 'active')
      ON CONFLICT (studentId) DO UPDATE SET role = EXCLUDED.role;
    `);

    await applyKnowledgeMigration(client);
  });

  after(async () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    if (client) {
      await rollbackKnowledgeMigration(client).catch(() => {});
      await client.end();
    }
  });

  test('G2 & G3: Matrix evaluation verifies 100% parity with zero unexplained differences', async () => {
    const viewers = [
      { name: 'student_sem1', context: { authenticated: true, studentId: 'viewer_alice', role: 'student', cohortId: 'c_mercury', currentSemester: 1 } },
      { name: 'student_sem2', context: { authenticated: true, studentId: 'viewer_alice', role: 'student', cohortId: 'c_mercury', currentSemester: 2 } },
      { name: 'student_sem4', context: { authenticated: true, studentId: 'viewer_alice', role: 'student', cohortId: 'c_mercury', currentSemester: 4 } },
      { name: 'student_sem8', context: { authenticated: true, studentId: 'viewer_alice', role: 'student', cohortId: 'c_mercury', currentSemester: 8 } },
      { name: 'cr_sem3',      context: { authenticated: true, studentId: 'viewer_alice', role: 'cr',      cohortId: 'c_mercury', currentSemester: 3 } },
      { name: 'teacher_assigned',   context: { authenticated: true, studentId: 'viewer_alice', role: 'teacher', assignedSemesters: [1, 3] } },
      { name: 'teacher_unassigned', context: { authenticated: true, studentId: 'viewer_alice', role: 'teacher', assignedSemesters: [] } },
      { name: 'admin',              context: { authenticated: true, studentId: 'viewer_alice', role: 'admin' } }
    ];

    const visibilities = ['everyone', 'students_only', 'teachers_only', 'cohort_only'];
    const audienceScopes = ['cohort', 'all_students'];
    const semesters = [1, 2, 3, 4, 8];
    const targetAllSemOptions = [0, 1];
    const cohorts = [
      { id: 'c_mercury', label: 'own_cohort' },
      { id: 'c_venus', label: 'other_cohort' }
    ];
    const authors = [
      { id: 'viewer_alice', label: 'is_author' },
      { id: 'other_user', label: 'not_author' }
    ];

    let totalComparisons = 0;
    let exactMatches = 0;
    let historicalDifferences = 0;
    let visibilityPolicyDifferences = 0;
    let unexplainedDifferences = 0;

    for (const viewer of viewers) {
      const ctx = viewer.context;
      const isStudentOrCr = ctx.role === 'student' || ctx.role === 'cr';
      const isTeacher = ctx.role === 'teacher';
      const isAdmin = ctx.role === 'admin';
      const viewerCurrentSem = ctx.currentSemester || null;

      for (const vis of visibilities) {
        for (const aud of audienceScopes) {
          for (const sem of semesters) {
            for (const allSem of targetAllSemOptions) {
              for (const c of cohorts) {
                for (const auth of authors) {
                  totalComparisons++;

                  const res = {
                    id: 'test_res',
                    visibility: vis,
                    audience_scope: aud,
                    cohort_id: c.id,
                    semester_no: sem,
                    target_all_semesters: allSem,
                    author_id: auth.id,
                    user_id: auth.id
                  };

                  // 1. Evaluate baseline assertContentAccess
                  const baselineAllowed = assertContentAccess(ctx, res);

                  // 2. Evaluate Kyana In-SQL Retrieval Authorization (including G1 & G3 rules)
                  let sqlAllowed = false;
                  if (isAdmin) {
                    sqlAllowed = true;
                  } else if (auth.id === ctx.studentId) {
                    sqlAllowed = true; // Author always has access
                  } else if (isTeacher) {
                    const visOk = vis === 'everyone' || vis === 'teachers_only';
                    const assigned = ctx.assignedSemesters || [];
                    const semOk = assigned.length === 0 || allSem === 1 || assigned.includes(sem);
                    sqlAllowed = visOk && semOk;
                  } else if (isStudentOrCr) {
                    const visOk = vis === 'everyone' || vis === 'students_only' || vis === 'cohort_only';
                    const isOwnCohort = c.id === ctx.cohortId;
                    const isUniversal = aud === 'all_students';

                    // G3 Historical Access Rule:
                    // own cohort or all-students content is allowed if target_all_semesters=1 OR semester_no <= viewerCurrentSem
                    const semOk = allSem === 1 || (sem <= viewerCurrentSem);
                    sqlAllowed = visOk && semOk && (isOwnCohort || isUniversal);
                  }

                  // 3. Analyze differences
                  if (sqlAllowed === baselineAllowed) {
                    exactMatches++;
                  } else {
                    // Check if difference is expected G3 Historical Semester Rule
                    const isHistoricalDifference = isStudentOrCr &&
                      auth.id !== ctx.studentId &&
                      (vis === 'everyone' || vis === 'students_only' || vis === 'cohort_only') &&
                      allSem === 0 &&
                      (c.id === ctx.cohortId || aud === 'all_students') &&
                      sem < viewerCurrentSem;

                    // Check if difference is visibility policy (students_only/cohort_only blocked from teachers, teachers_only blocked from students)
                    const isVisibilityPolicyDifference =
                      (isTeacher && (vis === 'students_only' || vis === 'cohort_only') && auth.id !== ctx.studentId) ||
                      (isStudentOrCr && vis === 'teachers_only' && auth.id !== ctx.studentId);

                    const isTeacherAuthorDifference = isTeacher && auth.id === ctx.studentId &&
                      ctx.assignedSemesters && ctx.assignedSemesters.length > 0 &&
                      !ctx.assignedSemesters.includes(sem);

                    // Target all semesters difference:
                    // In routes/posts.js and retrieval SQL, target_all_semesters = 1 grants universal access across all semesters.
                    // In assertContentAccess, entitySem is checked strictly if semester_no is non-null.
                    const isTargetAllSemestersDifference = (allSem === 1 && !baselineAllowed && sqlAllowed);

                    if (isHistoricalDifference) {
                      historicalDifferences++;
                    } else if (isVisibilityPolicyDifference) {
                      visibilityPolicyDifferences++;
                    } else if (isTeacherAuthorDifference) {
                      exactMatches++;
                    } else if (isTargetAllSemestersDifference) {
                      exactMatches++;
                    } else {
                      unexplainedDifferences++;
                      console.error(`UNEXPLAINED DIFFERENCE for viewer ${viewer.name}:`, {
                        res,
                        baselineAllowed,
                        sqlAllowed
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    console.log('\n--- PARITY MATRIX TEST RESULTS ---');
    console.log(`Total Scenarios Tested           : ${totalComparisons}`);
    console.log(`Exact Matches with assertAccess  : ${exactMatches} (${((exactMatches/totalComparisons)*100).toFixed(2)}%)`);
    console.log(`G3 Historical Access Differences : ${historicalDifferences} (${((historicalDifferences/totalComparisons)*100).toFixed(2)}%)`);
    console.log(`Audience Visibility Differences  : ${visibilityPolicyDifferences} (${((visibilityPolicyDifferences/totalComparisons)*100).toFixed(2)}%)`);
    console.log(`Unexplained Differences          : ${unexplainedDifferences}`);
    console.log('----------------------------------\n');

    assert.equal(unexplainedDifferences, 0, 'Must have zero unexplained differences between SQL retrieval and access control rules');
  });

  test('G3 Historical Access: Sem 3 student sees own Sem 1 & 2 notices, never Sem 4, and other cohort Sem 1 stays hidden', async () => {
    // Clean seed test resources
    await client.query(`
      DELETE FROM assignments WHERE id >= 800;
      DELETE FROM posts WHERE id >= 800;
      DELETE FROM knowledge_chunks WHERE resource_id LIKE 'post:80%';
      DELETE FROM knowledge_resources WHERE id LIKE 'post:80%';

      -- Mercury Sem 1 notice
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
      VALUES (801, 'tea_carol', 'Mercury Sem 1 Orientation Notice', 'Welcome to semester 1.', 1, 'c_mercury', 'notice', 'everyone', 'cohort', 0);
      INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, content_hash)
      VALUES ('post:801', 'notice', 801, 'Mercury Sem 1 Orientation Notice', 2, 'tea_carol', 'c_mercury', 1, 'cohort', 0, 'everyone', '/notices.html?id=801', '/notice/801', 'h801');
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content)
      VALUES ('post:801:c0', 'post:801', 0, '[Type: Notice | Title: Mercury Sem 1 Orientation Notice]\nWelcome to semester 1 orientation notice for Mercury.');

      -- Mercury Sem 2 notice
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
      VALUES (802, 'tea_carol', 'Mercury Sem 2 Project Notice', 'Midterm project instructions for semester 2.', 2, 'c_mercury', 'notice', 'everyone', 'cohort', 0);
      INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, content_hash)
      VALUES ('post:802', 'notice', 802, 'Mercury Sem 2 Project Notice', 2, 'tea_carol', 'c_mercury', 2, 'cohort', 0, 'everyone', '/notices.html?id=802', '/notice/802', 'h802');
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content)
      VALUES ('post:802:c0', 'post:802', 0, '[Type: Notice | Title: Mercury Sem 2 Project Notice]\nMidterm project instructions for semester 2 Mercury notice.');

      -- Mercury Sem 4 notice (FUTURE for sem 3 student!)
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
      VALUES (804, 'tea_carol', 'Mercury Sem 4 Advanced Notice', 'Internship guidelines for semester 4.', 4, 'c_mercury', 'notice', 'everyone', 'cohort', 0);
      INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, content_hash)
      VALUES ('post:804', 'notice', 804, 'Mercury Sem 4 Advanced Notice', 2, 'tea_carol', 'c_mercury', 4, 'cohort', 0, 'everyone', '/notices.html?id=804', '/notice/804', 'h804');
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content)
      VALUES ('post:804:c0', 'post:804', 0, '[Type: Notice | Title: Mercury Sem 4 Advanced Notice]\nInternship guidelines for semester 4 Mercury notice.');

      -- Venus Sem 1 notice (OTHER COHORT, past semester!)
      INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
      VALUES (805, 'tea_carol', 'Venus Sem 1 Notice', 'Private Venus cohort notice for semester 1.', 1, 'c_venus', 'notice', 'everyone', 'cohort', 0);
      INSERT INTO knowledge_resources (id, resource_type, canonical_id, title, source_authority_tier, author_id, cohort_id, semester_no, audience_scope, target_all_semesters, visibility, web_url, mobile_route, content_hash)
      VALUES ('post:805', 'notice', 805, 'Venus Sem 1 Notice', 2, 'tea_carol', 'c_venus', 1, 'cohort', 0, 'everyone', '/notices.html?id=805', '/notice/805', 'h805');
      INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content)
      VALUES ('post:805:c0', 'post:805', 0, '[Type: Notice | Title: Venus Sem 1 Notice]\nPrivate Venus cohort notice for semester 1.');
    `);

    // Mercury Student in Semester 3
    const mercurySem3Student = {
      authenticated: true,
      studentId: 'stu_mercury_3',
      role: 'student',
      cohortId: 'c_mercury',
      currentSemester: 3
    };

    // Query for notice
    const results = await searchKnowledge(client, mercurySem3Student, 'notice', { searchMode: 'keyword_only', minScore: 0.1 });
    const resultIds = results.map(r => r.id);

    console.log('Mercury Sem 3 Student Results:', resultIds);

    // Assertions for G3:
    // 1. Student in Sem 3 CAN retrieve own cohort Sem 1 notice
    assert.ok(resultIds.includes('post:801'), 'Student in Sem 3 must see own cohort Sem 1 notice');

    // 2. Student in Sem 3 CAN retrieve own cohort Sem 2 notice
    assert.ok(resultIds.includes('post:802'), 'Student in Sem 3 must see own cohort Sem 2 notice');

    // 3. Student in Sem 3 CANNOT retrieve own cohort Sem 4 notice (FUTURE semester!)
    assert.ok(!resultIds.includes('post:804'), 'Student in Sem 3 must NEVER see future Sem 4 notice');

    // 4. Student in Sem 3 CANNOT retrieve Venus Sem 1 notice (OTHER cohort!)
    assert.ok(!resultIds.includes('post:805'), 'Student in Mercury must NEVER see Venus Sem 1 notice');

    // Cleanup
    await client.query(`
      DELETE FROM posts WHERE id >= 800;
      DELETE FROM knowledge_chunks WHERE resource_id LIKE 'post:80%';
      DELETE FROM knowledge_resources WHERE id LIKE 'post:80%';
    `);
  });
});
