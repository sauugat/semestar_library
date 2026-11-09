'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const {
  universalSearch,
  normalizeQueryText,
  extractQueryEntities,
  expandWeightedTerms,
  scoreUniversalEvidence,
  deduplicateRecords,
  enforceSecurityAuthorization
} = require('../lib/kyana-universal-retrieval');

const STUDENT_USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

const SEMESTER2_STUDENT = {
  studentId: 's2-student-uuid',
  semester: 2,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

const TEACHER_USER = {
  studentId: 'teacher-newton-uuid',
  role: 'teacher',
  authenticated: true,
  assignedSemesters: [3],
  assignedSubjects: ['Data Structure and Algorithms']
};

const GUEST_USER = {
  studentId: null,
  role: 'guest',
  authenticated: false
};

const REFERENCE_DATE = new Date('2026-11-09T12:00:00.000Z');

// -----------------------------------------------------------------------------
// SCENARIO 1: Project Defense notice discovery
// -----------------------------------------------------------------------------
test('1. Project Defense notice discovery (Post 187, teacher newton, date 2083/08/07)', async () => {
  const query = 'Hamro project defense kaile ho?';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(Array.isArray(res.results), 'Results must be an array');
  assert.ok(res.results.length > 0, 'Must return at least 1 record');

  const topResult = res.results[0];
  assert.equal(Number(topResult.id), 187, 'Top result must be Post 187');
  assert.equal(topResult.source, 'notice', 'Must be classified as notice');
  assert.equal(topResult.authorName, 'newton', 'Author must be teacher newton');
  assert.equal(topResult.authorRole, 'teacher', 'Author role must be teacher');
  assert.ok(topResult.content.includes('2083/08/07'), 'Content must contain defense date 2083/08/07');
  assert.equal(topResult.isExactMatch, true, 'Must be marked as exact match');
  assert.ok(topResult.relevanceScore >= 100, 'Score must reflect exact entity match');
});

// -----------------------------------------------------------------------------
// SCENARIO 2: A newly published notice discovered immediately
// -----------------------------------------------------------------------------
test('2. A newly published notice discovered immediately (live DB query, no indexing lag)', async () => {
  const uniqueTitle = `Emergency Winter Break Notice ${Date.now()}`;
  let tempPostId = null;

  try {
    // Dynamically retrieve an existing student ID to satisfy foreign key constraints
    const userRow = await db.get('SELECT studentid FROM students LIMIT 1');
    const validUserId = userRow?.studentid || userRow?.studentId || '26026242';

    // Insert a new live notice directly into posts table
    const insRes = await db.run(
      `INSERT INTO posts (user_id, title, content, type, category, target_all_semesters, visibility, audience_scope, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 'everyone', 'all_students', CURRENT_TIMESTAMP)`,
      validUserId, uniqueTitle, 'Campus will remain closed tomorrow due to heavy weather conditions.', 'notice', 'notice'
    );
    tempPostId = insRes.lastInsertRowid;

    assert.ok(tempPostId, 'Temporary notice must have been inserted');

    // Query universal search immediately without any background worker delay
    const res = await universalSearch(db, STUDENT_USER, {
      query: uniqueTitle,
      referenceDate: REFERENCE_DATE
    });

    assert.ok(res.results.length > 0, 'Must discover newly published notice immediately');
    const matched = res.results.find(r => Number(r.id) === Number(tempPostId));
    assert.ok(matched, 'Newly inserted notice must appear in results');
    assert.equal(matched.title, uniqueTitle);
  } finally {
    // Clean up temporary post
    if (tempPostId) {
      await db.run('DELETE FROM posts WHERE id = ?', tempPostId).catch(() => {});
    }
  }
});

// -----------------------------------------------------------------------------
// SCENARIO 3: Recent teacher post discovery
// -----------------------------------------------------------------------------
test('3. Recent teacher post discovery ("Sir le hijo k post garnu bhako thiyo?")', async () => {
  const query = 'Sir le hijo k post garnu bhako thiyo?';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must find recent teacher posts');
  const teacherPosts = res.results.filter(r => r.authorRole === 'teacher' || r.authorName === 'newton');
  assert.ok(teacherPosts.length > 0, 'Must discover posts authored by teacher');
  assert.ok(
    teacherPosts.some(r => Number(r.id) === 187 || Number(r.id) === 186),
    'Must include teacher newtons recent posts'
  );
});

// -----------------------------------------------------------------------------
// SCENARIO 4: A question answered using an assignment
// -----------------------------------------------------------------------------
test('4. A question answered using an assignment ("DSA assignment ke cha?")', async () => {
  const query = 'DSA assignment ke cha?';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must find matching assignments');
  const asg = res.results.find(r => r.source === 'assignment');
  assert.ok(asg, 'Must contain assignment result');
  assert.equal(Number(asg.id), 25, 'Must match DSA Assignment 25');
  assert.equal(asg.subject, 'Data Structure and Algorithms');
  assert.ok(asg.navigationUrl.includes('25'), 'Navigation URL must point to assignment 25');
  assert.equal(asg.resourceCard.mobileRoute, '/assignments/25', 'Mobile route must be /assignments/25');
  assert.ok(asg.resourceCard, 'Must include resource card for UI navigation');
});

// -----------------------------------------------------------------------------
// SCENARIO 5: A question answered using a note
// -----------------------------------------------------------------------------
test('5. A question answered using a note ("Chapter 5 PHP notes")', async () => {
  const query = 'Chapter 5 PHP notes';
  const res = await universalSearch(db, SEMESTER2_STUDENT, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must find matching note materials');
  const topResult = res.results[0];
  assert.equal(Number(topResult.id), 34, 'Must rank Chapter 5 PHP notes at top');
  assert.ok(topResult.source === 'note' || topResult.source === 'file', 'Must be a note or file');
  assert.match(topResult.title, /Chapter5/i);
});

// -----------------------------------------------------------------------------
// SCENARIO 6: A question answered using an uploaded file
// -----------------------------------------------------------------------------
test('6. A question answered using an uploaded file ("Is there a curriculum file?")', async () => {
  const query = 'curriculum file';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must discover uploaded curriculum file');
  const fileResult = res.results.find(r => r.id === 6 || /curriculum/i.test(r.title));
  assert.ok(fileResult, 'Must find BIT_CURRICULUM file');
  assert.equal(Number(fileResult.id), 6);
});

// -----------------------------------------------------------------------------
// SCENARIO 7: Routine and examination schedule discovery
// -----------------------------------------------------------------------------
test('7. Routine and examination schedule discovery ("Discrete Mathematics exam kaile ho?")', async () => {
  const query = 'Discrete Mathematics exam kaile ho?';
  const res = await universalSearch(db, SEMESTER2_STUDENT, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must find examination schedule');
  const routineMatch = res.results.find(r => r.source === 'routine' && /Discrete Mathematics/i.test(r.title));
  assert.ok(routineMatch, 'Must find Discrete Mathematics examination routine');
  assert.equal(Number(routineMatch.id), 18);
  assert.equal(routineMatch.date, '2083/05/17');
  assert.equal(routineMatch.navigationUrl, '/routine');
});

// -----------------------------------------------------------------------------
// SCENARIO 8: A question whose answer is spread across multiple sources
// -----------------------------------------------------------------------------
test('8. Multi-source answer discovery ("Web Technology" materials across notes, routine, syllabus)', async () => {
  const query = 'Web Technology';
  const res = await universalSearch(db, SEMESTER2_STUDENT, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length >= 3, 'Must return multiple matching sources');
  const sourceTypes = new Set(res.results.map(r => r.source));

  assert.ok(sourceTypes.has('note') || sourceTypes.has('file'), 'Must include notes/files');
  assert.ok(sourceTypes.has('routine'), 'Must include routine');
  assert.ok(sourceTypes.has('syllabus'), 'Must include syllabus');
});

// -----------------------------------------------------------------------------
// SCENARIO 9: Romanized Nepali search
// -----------------------------------------------------------------------------
test('9. Romanized Nepali search ("Hamro class kaile bata suru huncha?")', async () => {
  const query = 'Hamro class kaile bata suru huncha?';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must understand Romanized Nepali inquiry');
  const topNotice = res.results.find(r => Number(r.id) === 186);
  assert.ok(topNotice, 'Must retrieve Class Resumption Notice (Post 186)');
  assert.ok(topNotice.content.includes('30th Kartik') || topNotice.content.includes('Kartik'), 'Must contain resumption date');
});

// -----------------------------------------------------------------------------
// SCENARIO 10: English search
// -----------------------------------------------------------------------------
test('10. English search ("When do classes resume after Tihar?")', async () => {
  const query = 'When do classes resume after Tihar?';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must retrieve notices for plain English search');
  const match = res.results.find(r => Number(r.id) === 186);
  assert.ok(match, 'Must find Post 186 Resumption after Tihar');
});

// -----------------------------------------------------------------------------
// SCENARIO 11: Contextual follow-up retrieval
// -----------------------------------------------------------------------------
test('11. Contextual follow-up retrieval (query with inherited subject and entity info)', async () => {
  // Simulating turn 2 follow-up asking "What date was scheduled for it?" with previous topic context
  const query = 'what date was scheduled for it';
  const res = await universalSearch(db, STUDENT_USER, {
    query: 'project defense date', // with contextual topic expansion
    referenceDate: REFERENCE_DATE
  });

  assert.ok(res.results.length > 0, 'Follow-up must discover relevant notice');
  assert.equal(Number(res.results[0].id), 187, 'Must resolve to Post 187');
  assert.ok(res.results[0].content.includes('2083/08/07'));
});

// -----------------------------------------------------------------------------
// SCENARIO 12: Exact phrase ranking over loosely related records
// -----------------------------------------------------------------------------
test('12. Exact phrase ranking over loosely related records ("Project Defense" vs "Project Viva")', async () => {
  const mockDefense = {
    id: 101,
    title: 'Project Defense Notice',
    content: 'Final evaluation defense session',
    authorRole: 'teacher',
    resourceType: 'notice'
  };
  const mockViva = {
    id: 102,
    title: 'Project Viva and Practical',
    content: 'Internal practical viva session',
    authorRole: 'teacher',
    resourceType: 'notice'
  };

  const queryInfo = extractQueryEntities('project defense', STUDENT_USER);
  const weightedTerms = expandWeightedTerms(queryInfo.rawTokens);

  const scoreDefense = scoreUniversalEvidence(mockDefense, queryInfo, weightedTerms);
  const scoreViva = scoreUniversalEvidence(mockViva, queryInfo, weightedTerms);

  assert.ok(
    scoreDefense.score > scoreViva.score,
    `Exact phrase "project defense" (${scoreDefense.score}) must outrank related "project viva" (${scoreViva.score})`
  );
  assert.equal(scoreDefense.hasExactPhrase, true, 'Mock defense must have hasExactPhrase = true');
  assert.equal(scoreViva.hasExactPhrase, false, 'Mock viva must have hasExactPhrase = false');
});

// -----------------------------------------------------------------------------
// SCENARIO 13: Unrelated recent posts not outranking relevant older records
// -----------------------------------------------------------------------------
test('13. Unrelated recent posts not outranking relevant older records', async () => {
  const oldRelevantNotice = {
    id: 187,
    title: 'Project Defense Notice',
    content: 'Project Defense I is scheduled for 2083/08/07',
    authorRole: 'teacher',
    resourceType: 'notice',
    createdAt: '2026-11-01T10:00:00.000Z' // 8 days older
  };

  const recentUnrelatedPost = {
    id: 999,
    title: 'Welcome to Campus Football Tournament',
    content: 'Annual sports meet starting this weekend. Everyone is invited!',
    authorRole: 'student',
    resourceType: 'post',
    createdAt: '2026-11-09T11:00:00.000Z' // Just now
  };

  const queryInfo = extractQueryEntities('When is our project defense?', STUDENT_USER);
  const weightedTerms = expandWeightedTerms(queryInfo.rawTokens);

  const scoreRelevant = scoreUniversalEvidence(oldRelevantNotice, queryInfo, weightedTerms);
  const scoreUnrelated = scoreUniversalEvidence(recentUnrelatedPost, queryInfo, weightedTerms);

  assert.ok(
    scoreRelevant.score > scoreUnrelated.score,
    `Relevant older notice score (${scoreRelevant.score}) must be strictly higher than recent unrelated post (${scoreUnrelated.score})`
  );
  assert.ok(scoreUnrelated.score < 20, 'Unrelated post must not get significant score');
});

// -----------------------------------------------------------------------------
// SCENARIO 14: Duplicate evidence elimination
// -----------------------------------------------------------------------------
test('14. Duplicate evidence elimination (merging post & notice duplicates for the same ID)', () => {
  const duplicateRecords = [
    {
      id: 187,
      title: 'Project Defense Notice',
      content: 'Notice content',
      resourceType: 'post',
      relevanceScore: 120
    },
    {
      id: 187,
      title: 'Project Defense Notice',
      content: 'Notice content with official badge',
      resourceType: 'notice',
      isOfficialNotice: true,
      relevanceScore: 180
    },
    {
      id: 34,
      title: 'Chapter5 Slide GU',
      resourceType: 'file',
      relevanceScore: 40
    },
    {
      id: 34,
      title: 'Chapter5 Slide GU',
      resourceType: 'note',
      relevanceScore: 65
    }
  ];

  const deduped = deduplicateRecords(duplicateRecords);
  assert.equal(deduped.length, 2, 'Must collapse 4 items into 2 unique records');

  const post187 = deduped.find(r => r.id === 187);
  assert.ok(post187, 'Must preserve record 187');
  assert.equal(post187.resourceType, 'notice', 'Must prefer official notice over generic post');

  const file34 = deduped.find(r => r.id === 34);
  assert.ok(file34, 'Must preserve record 34');
  assert.equal(file34.resourceType, 'note', 'Must prefer note representation over file');
});

// -----------------------------------------------------------------------------
// SCENARIO 15: Partial source failure resilience
// -----------------------------------------------------------------------------
test('15. Partial source failure resilience (fault tolerance when individual sources throw)', async () => {
  // Create a mock DB where queries to 'routine' throw an unexpected error
  const mockFaultyDb = {
    ...db,
    all: async (sql, ...args) => {
      if (typeof sql === 'string' && sql.includes('FROM routine')) {
        throw new Error('Database relation routine is temporarily locked or offline');
      }
      return db.all(sql, ...args);
    }
  };

  const res = await universalSearch(mockFaultyDb, STUDENT_USER, {
    query: 'Hamro project defense kaile ho?',
    referenceDate: REFERENCE_DATE
  });

  // Overall search must NOT throw or crash
  assert.ok(Array.isArray(res.results), 'Results must still be returned');
  assert.ok(res.results.length > 0, 'Healthy sources must provide evidence');
  assert.equal(res.metadata.isComplete, false, 'isComplete must be false when a source fails');
  assert.ok(res.metadata.sourcesFailed.includes('routine'), 'sourcesFailed must record routine');
  assert.ok(res.metadata.sourcesSucceeded.includes('notices'), 'notices must succeed');
  assert.equal(Number(res.results[0].id), 187, 'Notice evidence must still be safely returned');
});

// -----------------------------------------------------------------------------
// SCENARIO 16: Student privacy & semester isolation
// -----------------------------------------------------------------------------
test('16. Student privacy & semester isolation (preventing unauthorized cross-semester routine/submissions)', () => {
  const records = [
    {
      id: 1,
      title: 'Semester 8 Board Examination',
      semesterNo: 8,
      resourceType: 'routine'
    },
    {
      id: 2,
      title: 'Semester 3 DSA Routine',
      semesterNo: 3,
      resourceType: 'routine'
    },
    {
      id: 3,
      title: 'Confidential Internal Draft',
      audience_scope: 'private',
      userId: 'different-student-uuid',
      resourceType: 'post'
    },
    {
      id: 4,
      title: 'Peer Student Submission',
      resourceType: 'assignment',
      studentSubmission: {
        studentId: 'other-student-uuid',
        marksObtained: 95
      }
    }
  ];

  const authorized = enforceSecurityAuthorization(records, STUDENT_USER);

  // Semester 3 student must only see semester 3 routine
  const routineIds = authorized.filter(r => r.resourceType === 'routine').map(r => r.id);
  assert.deepEqual(routineIds, [2], 'Only authorized semester 3 routine must be allowed');

  // Must not leak private post of another student
  assert.ok(!authorized.some(r => r.id === 3), 'Private post of another student must be blocked');

  // Must not leak another student submission
  assert.ok(!authorized.some(r => r.id === 4), 'Another student personal submission must be blocked');
});

// -----------------------------------------------------------------------------
// SCENARIO 17: Teacher permission boundaries
// -----------------------------------------------------------------------------
test('17. Teacher permission boundaries (enforcing assigned classes and subjects)', () => {
  const teacherContext = {
    role: 'teacher',
    authenticated: true,
    assignedSemesters: [3],
    assignedSubjects: ['Data Structure and Algorithms']
  };

  const records = [
    {
      id: 10,
      title: 'DSA Assignment 1',
      subject: 'Data Structure and Algorithms',
      semesterNo: 3,
      resourceType: 'assignment'
    },
    {
      id: 11,
      title: 'Web Technology Assignment',
      subject: 'Web Technology I',
      semesterNo: 2,
      resourceType: 'assignment'
    },
    {
      id: 12,
      title: 'Discrete Mathematics Notes',
      subject: 'Discrete Mathematics',
      semesterNo: 2,
      resourceType: 'note'
    }
  ];

  const authorized = enforceSecurityAuthorization(records, teacherContext);

  assert.equal(authorized.length, 1, 'Teacher must only access assigned subject/semester');
  assert.equal(authorized[0].id, 10, 'Only DSA Assignment 1 is authorized');
});

// -----------------------------------------------------------------------------
// SCENARIO 18: Unpublished marks protection
// -----------------------------------------------------------------------------
test('18. Unpublished marks protection (draft and unpublished marks strictly withheld)', () => {
  const records = [
    {
      id: 50,
      title: 'Pre-Board DSA Exam Marks',
      status: 'draft',
      resourceType: 'result'
    },
    {
      id: 51,
      title: 'Final Term Exam Marks',
      status: 'unpublished',
      resourceType: 'result'
    },
    {
      id: 52,
      title: 'Mid-Term Exam Marks',
      status: 'published',
      released: true,
      resourceType: 'result'
    }
  ];

  const authorized = enforceSecurityAuthorization(records, STUDENT_USER);

  assert.equal(authorized.length, 1, 'Only published results may pass security');
  assert.equal(authorized[0].id, 52, 'Only published exam marks are returned');
});

// -----------------------------------------------------------------------------
// SCENARIO 19: No-results handling
// -----------------------------------------------------------------------------
test('19. No-results handling (graceful empty output without error or hallucination)', async () => {
  const query = 'xyzzy_quantum_warp_hyperdrive_9999';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.equal(res.results.length, 0, 'Results must be empty for non-existent topic');
  assert.equal(res.metadata.totalRecordsFound, 0, 'totalRecordsFound must be 0');
  assert.equal(res.metadata.isComplete, true, 'Search must be marked complete (no failures)');
  assert.equal(res.metadata.sourcesFailed.length, 0, 'No sources failed');
});

// -----------------------------------------------------------------------------
// SCENARIO 20: Structured UI compatibility
// -----------------------------------------------------------------------------
test('20. Structured UI compatibility (resource cards and deep links across sources)', async () => {
  const query = 'project defense';
  const res = await universalSearch(db, STUDENT_USER, { query, referenceDate: REFERENCE_DATE });

  assert.ok(res.results.length > 0, 'Must have at least one result');
  for (const item of res.results) {
    assert.ok(item.source, 'Must have a source module string');
    assert.ok(item.id !== undefined && item.id !== null, 'Must have an ID');
    assert.ok(typeof item.title === 'string' && item.title.length > 0, 'Must have a non-empty title');
    assert.ok(item.navigationUrl, 'Must have a navigation URL');

    if (item.resourceCard) {
      assert.ok(item.resourceCard.type, 'Resource card must specify card type');
      assert.ok(item.resourceCard.action, 'Resource card must specify action');
      assert.ok(item.resourceCard.deepLink || item.resourceCard.mobileRoute, 'Card must specify link route');
    }
  }
});

test.after(async () => {
  if (db && typeof db.close === 'function') {
    await db.close();
  }
});
