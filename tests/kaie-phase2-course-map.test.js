'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const {
  ingestAcademicDocument,
  cleanupDeletedDocument,
  enqueueDocumentIngestion
} = require('../lib/document-ingestion');
const {
  parseUploadedSyllabusText,
  syncCourseMap,
  getCourseMap,
  getTeacherReviewQueue,
  resolveTeacherReviewItem
} = require('../lib/kaie-course-map');
const { buildReconciledStudyPlan } = require('../lib/study-partner-reconciler');
const {
  startOrResumeStudySession,
  buildCompiledTopicLessonBundle,
  renderMicroTopicTurn
} = require('../lib/study-partner-engine');
const { formatRow, formatRows } = require('../db');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    client,
    dialect: 'sqlite',
    isPostgres: false,
    async run(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return client.execute({ sql, args: params });
    },
    async get(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRow(res.rows[0] || null);
    },
    async all(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRows(res.rows || []);
    },
    async exec(sql) {
      return client.executeMultiple(sql);
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      semester TEXT,
      subject TEXT,
      chapter TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER,
      uploadedAt TEXT,
      previewName TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT
    );
    CREATE TABLE IF NOT EXISTS file_blobs (
      filename TEXT PRIMARY KEY,
      fileData BLOB
    );
    CREATE TABLE IF NOT EXISTS note_search_documents (
      id TEXT PRIMARY KEY,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      content TEXT,
      updatedAt TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('KAIE Phase 2: ensureRagSchema creates course_syllabus_units, course_syllabus_topics, topic_source_mappings, academic_extracted_items, and kaie_teacher_review_queue', async () => {
  const db = await createTestDb();

  const unitCols = await db.all('PRAGMA table_info(course_syllabus_units)');
  assert.ok(unitCols.some((c) => c.name === 'coverage_ratio'), 'course_syllabus_units.coverage_ratio must exist');

  const topicCols = await db.all('PRAGMA table_info(course_syllabus_topics)');
  assert.ok(topicCols.some((c) => c.name === 'coverage_status'), 'course_syllabus_topics.coverage_status must exist');
  assert.ok(topicCols.some((c) => c.name === 'exam_weight_score'), 'course_syllabus_topics.exam_weight_score must exist');
  assert.ok(topicCols.some((c) => c.name === 'origin_type'), 'course_syllabus_topics.origin_type must exist');
  assert.ok(topicCols.some((c) => c.name === 'is_locked_by_teacher'), 'course_syllabus_topics.is_locked_by_teacher must exist');

  const mapCols = await db.all('PRAGMA table_info(topic_source_mappings)');
  assert.ok(mapCols.some((c) => c.name === 'source_type'), 'topic_source_mappings.source_type must exist');
  assert.ok(mapCols.some((c) => c.name === 'extracted_item_id'), 'topic_source_mappings.extracted_item_id must exist');
  assert.ok(mapCols.some((c) => c.name === 'review_status'), 'topic_source_mappings.review_status must exist');
  assert.ok(mapCols.some((c) => c.name === 'conflict_status'), 'topic_source_mappings.conflict_status must exist');

  const itemCols = await db.all('PRAGMA table_info(academic_extracted_items)');
  assert.ok(itemCols.some((c) => c.name === 'item_type'), 'academic_extracted_items.item_type must exist');

  const rqCols = await db.all('PRAGMA table_info(kaie_teacher_review_queue)');
  assert.ok(rqCols.some((c) => c.name === 'review_type'), 'kaie_teacher_review_queue.review_type must exist');
});

test('KAIE Phase 2: parseUploadedSyllabusText parses units, hours, and subtopics from uploaded syllabus text', () => {
  const sampleSyllabus = `
    Unit 1: Basic Concept (3 hrs)
    1.1 Introduction to Internet, WWW, Web Browser, Web Servers, URL
    1.2 Overview of different protocols: HTTP, HTTPS, FTP

    Unit 3: Introducing Cascading Style Sheet 8hrs
    3.1 Introduction, Where You Can Add CSS Rules, Levels of Style Sheets
    3.2 Style Specification Formats, Style classes, Properties and Property Values, CSS Grid Layout

    Textbooks:
    1. Duckett, HTML and CSS
  `;

  const parsed = parseUploadedSyllabusText(sampleSyllabus);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].unitNumber, 1);
  assert.equal(parsed[0].teachingHours, 3);
  assert.equal(parsed[1].unitNumber, 3);
  assert.equal(parsed[1].teachingHours, 8);
  assert.ok(parsed[1].topics.some((t) => /CSS Grid Layout/i.test(t)), 'Should include custom topic from uploaded syllabus');
});

test('KAIE Phase 2: Multi-file reconciliation maps syllabus + notes + practicals + PYQs and detects missing-note gaps', async () => {
  const db = await createTestDb();

  // 1. Upload teacher syllabus with an additional subtopic ("CSS Variables and Custom Properties")
  const sylInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'web-tech-syllabus.txt',
    'web-tech-syllabus.txt',
    'Web Technology Syllabus',
    'Semester 2',
    'Web Technology I',
    'Syllabus',
    'T01',
    500,
    new Date().toISOString(),
    2,
    'syllabus',
    null
  );
  const sylId = Number(sylInsert.lastInsertRowid);
  const sylContent = `
    Unit 3: Introducing Cascading Style Sheet (8 hrs)
    3.1 Introduction, Where You Can Add CSS Rules, Levels of Style Sheets
    3.2 Style Specification Formats, Style classes, Properties and Property Values
    3.3 CSS Variables and Custom Properties
  `;
  await ingestAcademicDocument(db, {
    id: sylId,
    storedName: 'web-tech-syllabus.txt',
    originalName: 'web-tech-syllabus.txt',
    title: 'Web Technology Syllabus',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Syllabus',
    resource_category: 'syllabus'
  }, { buffer: Buffer.from(sylContent) });

  // 2. Upload teacher Chapter 3 CSS Notes (including an extra teacher-only section "CSS Specificity Calculator")
  const noteInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'ch3-css-notes.txt',
    'ch3-css-notes.txt',
    'Chapter 3 CSS Notes',
    'Semester 2',
    'Web Technology I',
    'Unit 3: Introducing Cascading Style Sheet',
    'T01',
    800,
    new Date().toISOString(),
    2,
    'notes',
    3
  );
  const noteId = Number(noteInsert.lastInsertRowid);
  const noteContent = [
    '## Where You Can Add CSS Rules',
    'CSS rules can be added in three places: Inline style attribute, Internal style tag in head, and External stylesheet file.',
    '',
    '## Levels of Style Sheets',
    'The three levels of style sheets are inline, document-level (internal), and external style sheets.',
    '',
    '## CSS Specificity Calculator',
    'Specificity is calculated as a 4-part weight: inline styles (1,0,0,0), IDs (0,1,0,0), classes/pseudo-classes (0,0,1,0), and elements (0,0,0,1).'
  ].join('\n');
  await ingestAcademicDocument(db, {
    id: noteId,
    storedName: 'ch3-css-notes.txt',
    originalName: 'ch3-css-notes.txt',
    title: 'Chapter 3 CSS Notes',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3: Introducing Cascading Style Sheet',
    resource_category: 'notes',
    unit_number: 3
  }, { buffer: Buffer.from(noteContent) });

  // 3. Upload teacher CSS Practical Examples
  const pracInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'css-practical.txt',
    'css-practical.txt',
    'CSS Practical Examples',
    'Semester 2',
    'Web Technology I',
    'Unit 3',
    'T01',
    600,
    new Date().toISOString(),
    2,
    'practical',
    3
  );
  const pracId = Number(pracInsert.lastInsertRowid);
  const pracContent = [
    '## Style classes',
    'Lab Exercise: Create reusable .btn-primary and .card style classes in an external CSS file and apply them to HTML elements.'
  ].join('\n');
  await ingestAcademicDocument(db, {
    id: pracId,
    storedName: 'css-practical.txt',
    originalName: 'css-practical.txt',
    title: 'CSS Practical Examples',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'practical',
    unit_number: 3
  }, { buffer: Buffer.from(pracContent) });

  // 4. Upload Model Questions (PYQ)
  const pyqInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'web-tech-pyq.txt',
    'web-tech-pyq.txt',
    'Web Technology Model Questions 2081',
    'Semester 2',
    'Web Technology I',
    'Unit 3',
    'T01',
    500,
    new Date().toISOString(),
    2,
    'model_questions',
    3
  );
  const pyqId = Number(pyqInsert.lastInsertRowid);
  const pyqContent = `
    GANDAKI UNIVERSITY
    Web Technology I (CIT123)
    2081 BS Final Exam

    1. Explain the different levels of style sheets in CSS with examples. [5]
    2. How do you define style classes in CSS? Write a practical example. [5]
  `;
  await ingestAcademicDocument(db, {
    id: pyqId,
    storedName: 'web-tech-pyq.txt',
    originalName: 'web-tech-pyq.txt',
    title: 'Web Technology Model Questions 2081',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'model_questions',
    unit_number: 3
  }, { buffer: Buffer.from(pyqContent) });

  // 5. Inspect Unit 3 Course Map
  const courseMap = await getCourseMap(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3
  });

  assert.ok(courseMap, 'Course map must be returned');
  assert.equal(courseMap.subjectCode, 'CIT123');
  assert.equal(courseMap.units.length, 1);

  const unit3 = courseMap.units[0];
  assert.equal(unit3.unitNumber, 3);
  assert.equal(unit3.sourceOrigin, 'official_and_uploaded_syllabus');
  assert.ok(unit3.totalTopics >= 9, `Unit 3 should have at least 9 topics (got ${unit3.totalTopics})`);
  assert.ok(unit3.coveredTopics >= 3, `Unit 3 should have at least 3 covered topics (got ${unit3.coveredTopics})`);

  // Verify uploaded syllabus topic was merged
  const customSylTopic = unit3.topics.find((t) => /CSS Variables and Custom Properties/i.test(t.topicTitle));
  assert.ok(customSylTopic, 'Uploaded syllabus subtopic must be merged into Unit 3');
  assert.equal(customSylTopic.coverageStatus, 'MISSING_NOTES', 'Uncovered syllabus topic must be flagged as MISSING_NOTES');

  // Verify Notes + PYQ topic ("Levels of Style Sheets")
  const levelsTopic = unit3.topics.find((t) => /Levels of Style Sheets/i.test(t.topicTitle));
  assert.ok(levelsTopic, 'Levels of Style Sheets topic must exist');
  assert.equal(levelsTopic.hasNotes, true);
  assert.equal(levelsTopic.hasPyq, true);
  assert.ok(levelsTopic.examWeightScore > 0, 'Topic with PYQ must have positive examWeightScore');

  // Verify Practical + PYQ topic ("Style classes")
  const classesTopic = unit3.topics.find((t) => /^Style classes$/i.test(t.topicTitle));
  assert.ok(classesTopic, 'Style classes topic must exist');
  assert.equal(classesTopic.hasPractical, true);
  assert.equal(classesTopic.hasPyq, true);

  // Verify teacher-note-exclusive topic ("CSS Specificity Calculator") is preserved
  const extraTopic = unit3.topics.find((t) => /CSS Specificity Calculator/i.test(t.topicTitle));
  assert.ok(extraTopic, 'Teacher note extra section must be preserved with zero topics left behind');
  assert.equal(extraTopic.sourceOrigin, 'note_exclusive');
  assert.equal(extraTopic.originType, 'teaching_subtopic');

  // 6. Verify Study Partner Reconciler consumes the KAIE course map seamlessly
  const studyPlan = await buildReconciledStudyPlan(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3
  });
  assert.equal(studyPlan.totalSteps, unit3.totalTopics);
  assert.ok(studyPlan.plan.some((s) => /CSS Specificity Calculator/i.test(s.topicTitle)));

  // 7. Verify deleting the note file automatically re-syncs the course map
  await db.run('DELETE FROM files WHERE id = ?', noteId);
  await cleanupDeletedDocument(db, noteId);

  const mapAfterDelete = await getCourseMap(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3
  });
  const levelsAfterDelete = mapAfterDelete.units[0].topics.find((t) => /Levels of Style Sheets/i.test(t.topicTitle));
  assert.equal(levelsAfterDelete.hasNotes, false, 'Deleted note file mappings must be removed on cleanup');
});

test('KAIE Phase 3-5: Structured item extraction, cross-file conflict detection, teacher review queue resolution, cohort isolation & Study Partner bundle', async () => {
  const db = await createTestDb();

  // 1. Upload first teacher note with Definitions, Formulas, Code Examples, Worked Examples, and Inline Questions (Cohort 101)
  const noteAInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, cohort_id, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'css-complete-notes.txt',
    'css-complete-notes.txt',
    'CSS Complete Notes.pdf',
    'Semester 2',
    'Web Technology I',
    'Unit 3: Introducing Cascading Style Sheet',
    'T01',
    1200,
    new Date().toISOString(),
    '101',
    2,
    'notes',
    3
  );
  const noteAId = Number(noteAInsert.lastInsertRowid);
  const noteAContent = [
    '## Style classes',
    'CSS Class Selector: A selector that targets HTML elements based on their class attribute using a period prefix and has a specificity weight of 10.',
    'Formula: $Specificity = 100 \\times ID + 10 \\times Class + 1 \\times Element$',
    'Example 1: Applying the .highlight class to paragraphs changes their background to yellow.',
    '```css',
    '.highlight { background-color: yellow; color: black; }',
    '```',
    '1. Differentiate between class selectors and ID selectors with examples. [5]'
  ].join('\n');

  const ingestResA = await ingestAcademicDocument(db, {
    id: noteAId,
    storedName: 'css-complete-notes.txt',
    originalName: 'css-complete-notes.txt',
    title: 'CSS Complete Notes.pdf',
    semester: 'Semester 2',
    semester_no: 2,
    cohort_id: '101',
    subject: 'Web Technology I',
    chapter: 'Unit 3: Introducing Cascading Style Sheet',
    resource_category: 'notes',
    unit_number: 3
  }, { buffer: Buffer.from(noteAContent) });

  assert.equal(ingestResA.status, 'ready');
  assert.ok(ingestResA.extractedItemsCount >= 4, `Expected >= 4 extracted academic items, got ${ingestResA.extractedItemsCount}`);

  // Verify idempotent enqueueDocumentIngestion does not overwrite INDEXED status back to QUEUED
  const enqRes = await enqueueDocumentIngestion(db, {
    id: noteAId,
    originalName: 'css-complete-notes.txt'
  }, { triggerAsync: false });
  assert.equal(enqRes.status, 'INDEXED');
  assert.equal(enqRes.alreadyIndexed, true);

  // 2. Upload second file with a conflicting numeric definition for "CSS Class Selector" (specificity weight 100 instead of 10)
  const noteBInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, cohort_id, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'css-reference-guide.txt',
    'css-reference-guide.txt',
    'CSS Reference Guide.pdf',
    'Semester 2',
    'Web Technology I',
    'Unit 3: Introducing Cascading Style Sheet',
    'T02',
    900,
    new Date().toISOString(),
    null,
    2,
    'reference',
    3
  );
  const noteBId = Number(noteBInsert.lastInsertRowid);
  const noteBContent = [
    '## Style classes',
    'CSS Class Selector: A selector that targets HTML elements by class name and has a specificity weight of 100 in modern browsers.'
  ].join('\n');

  await ingestAcademicDocument(db, {
    id: noteBId,
    storedName: 'css-reference-guide.txt',
    originalName: 'css-reference-guide.txt',
    title: 'CSS Reference Guide.pdf',
    semester: 'Semester 2',
    semester_no: 2,
    cohort_id: null,
    subject: 'Web Technology I',
    chapter: 'Unit 3: Introducing Cascading Style Sheet',
    resource_category: 'reference',
    unit_number: 3
  }, { buffer: Buffer.from(noteBContent) });

  // 3. Check Course Map for extractedItems, originType separation, and cross-file conflicts
  const fullMap = await getCourseMap(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3
  });
  const unit3 = fullMap.units[0];
  const styleClassesTopic = unit3.topics.find((t) => /^Style classes$/i.test(t.topicTitle));
  assert.ok(styleClassesTopic, 'Style classes topic must exist');
  assert.equal(styleClassesTopic.originType, 'official_syllabus', 'Official syllabus topic must preserve originType = official_syllabus');
  assert.ok(styleClassesTopic.extractedItems.definitions.length >= 2, 'Should map definitions from both uploaded files');
  assert.ok(styleClassesTopic.extractedItems.formulas.length >= 1, 'Should map extracted formula');
  assert.ok(styleClassesTopic.extractedItems.examples.length >= 1, 'Should map extracted worked/code examples');
  assert.ok(styleClassesTopic.extractedItems.inlineQuestions.length >= 1, 'Should map extracted inline question');

  // 4. Verify Cross-File Conflict Detection in Teacher Review Queue
  const reviewQueue = await getTeacherReviewQueue(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3,
    reviewType: 'CROSS_FILE_CONFLICT'
  });
  assert.ok(reviewQueue.length >= 1, 'Cross-file numeric conflict between File A (weight 10) and File B (weight 100) must be queued for teacher review');
  const conflictItem = reviewQueue[0];
  assert.equal(conflictItem.status, 'PENDING');

  // 5. Resolve the review item as a teacher and verify non-destructive preservation across rebuilds
  const resolved = await resolveTeacherReviewItem(db, conflictItem.id, {
    action: 'APPROVE',
    resolutionNote: 'Verified weight is 10 per W3C standard.',
    resolvedByUserId: 1
  });
  assert.equal(resolved.status, 'APPROVED');

  const rebuiltMap = await syncCourseMap(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3
  });
  const rebuiltTopic = rebuiltMap.units[0].topics.find((t) => /^Style classes$/i.test(t.topicTitle));
  assert.equal(rebuiltTopic.isLockedByTeacher, true, 'Teacher-approved topic lock must survive syncCourseMap rebuild');
  assert.ok(rebuiltTopic.curriculumVersion >= 2, 'curriculumVersion must increment across rebuilds');

  // 6. Verify Cohort Scoping in getCourseMap: Student in Cohort 202 must NOT see Cohort 101 private file mappings
  const cohort202Map = await getCourseMap(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3,
    academicContext: { role: 'student', cohortId: '202', currentSemester: 2 }
  });
  const cohort202Topic = cohort202Map.units[0].topics.find((t) => /^Style classes$/i.test(t.topicTitle));
  const leakedCohort101 = cohort202Topic.mappings.some((m) => String(m.fileId) === String(noteAId));
  assert.equal(leakedCohort101, false, 'Cohort 202 student must not receive mappings from Cohort 101 private resource');

  // 7. Verify Study Partner Lesson Bundle & Rendering for Cohort 101 Student
  const studentCtx = { role: 'student', cohortId: '101', currentSemester: 2 };
  const sessionRes = await startOrResumeStudySession(db, {
    studentId: 'STU101',
    conversationId: 'conv_kaie_test',
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3,
    academicContext: studentCtx
  });
  const stepForClasses = sessionRes.topics.find((t) => /^Style classes$/i.test(t.topicTitle));
  assert.ok(stepForClasses, 'Study session must include Style classes step');

  const bundle = await buildCompiledTopicLessonBundle(db, {
    session: sessionRes.session,
    step: stepForClasses,
    academicContext: studentCtx
  });
  assert.ok(bundle.definitions.length >= 1, 'Compiled lesson bundle must include extracted definitions');
  assert.ok(bundle.examples.length >= 1, 'Compiled lesson bundle must include extracted code/worked examples');

  const renderedTurn = renderMicroTopicTurn({
    session: sessionRes.session,
    step: stepForClasses,
    topics: sessionRes.topics,
    lessonBundle: bundle
  });
  assert.match(renderedTurn, /CSS Complete Notes\.pdf, Page 1/, 'Rendered lesson must cite teacher file and page number');
});

test('KAIE Phase 4-5: Student 5-6 Subject Scope Gate, Topic-to-Course Resolution ("Teach me infinite series"), and Hybrid RAG Extracted Items', async () => {
  const db = await createTestDb();
  const { getStudentEnrolledCourses, resolveCourseAndChapter } = require('../lib/study-partner-reconciler');
  const { retrieveAcademicEvidence } = require('../lib/hybrid-rag-engine');

  // 1. Verify Semester 3 student receives their exact 6 enrolled BIT courses
  const sem3Courses = getStudentEnrolledCourses(3);
  assert.equal(sem3Courses.length, 6);
  assert.ok(sem3Courses.some((c) => c.code === 'CIT214'), 'Should include CIT214 Data Structure and Algorithms');
  assert.ok(sem3Courses.some((c) => c.code === 'CIT213'), 'Should include CIT213 Database Management System');

  // 2. Verify "Teach me infinite series" resolves to BSM121 Mathematics II Unit 2 (Semester 2)
  // For a Semester 2 student -> IN_ENROLLED_SCOPE
  const sem2Series = resolveCourseAndChapter('Teach me infinite series', null, 2);
  assert.equal(sem2Series.course.code, 'BSM121');
  assert.equal(sem2Series.unitNumber, 2);
  assert.match(sem2Series.chapterTitle, /Infinite Series/i);
  assert.equal(sem2Series.scopeStatus, 'IN_ENROLLED_SCOPE');

  // For a Semester 3 student -> CROSS_SEMESTER_SYLLABUS (transparently flagged outside Semester 3's 6 courses)
  const sem3Series = resolveCourseAndChapter('Teach me infinite series', null, 3);
  assert.equal(sem3Series.course.code, 'BSM121');
  assert.equal(sem3Series.scopeStatus, 'CROSS_SEMESTER_SYLLABUS');

  // For a completely non-BIT topic -> OUT_OF_SYLLABUS
  const outScope = resolveCourseAndChapter('Quantum Chromodynamics and String Theory', null, 3);
  assert.equal(outScope.scopeStatus, 'OUT_OF_SYLLABUS');
  assert.equal(outScope.enrolledSemesterCourses.length, 6);

  // 3. Verify Hybrid RAG attaches structured academic_extracted_items to retrieved passages
  const noteInsert = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'math2-infinite-series.txt',
    'math2-infinite-series.txt',
    'Mathematics II Unit 2 Infinite Series Notes.pdf',
    'Semester 2',
    'Mathematics II',
    'Unit 2: Infinite Series',
    'T01',
    900,
    new Date().toISOString(),
    2,
    'notes',
    2
  );
  const noteId = Number(noteInsert.lastInsertRowid);
  const noteText = [
    '## Infinite Series and P-Series Test',
    'Infinite Series: The sum of infinitely many terms of a sequence written as a_1 + a_2 + a_3 + ...',
    'Formula: $\\sum_{n=1}^{\\infty} \\frac{1}{n^p}$ converges if $p > 1$ and diverges if $p \\le 1$.'
  ].join('\n');

  await ingestAcademicDocument(db, {
    id: noteId,
    storedName: 'math2-infinite-series.txt',
    originalName: 'math2-infinite-series.txt',
    title: 'Mathematics II Unit 2 Infinite Series Notes.pdf',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Mathematics II',
    chapter: 'Unit 2: Infinite Series',
    resource_category: 'notes',
    unit_number: 2
  }, { buffer: Buffer.from(noteText) });

  const ragRes = await retrieveAcademicEvidence(db, {
    query: 'Explain infinite series and p-series test',
    semester: 2
  });
  assert.ok(ragRes.passages.length >= 1, 'Should retrieve Mathematics II passage');
  assert.ok(Array.isArray(ragRes.passages[0].extractedItems), 'Passage must include extractedItems array');
  assert.ok(ragRes.passages[0].extractedItems.length >= 1, 'Passage must attach extracted definition/formula from academic_extracted_items');

  // 4. Verify Student Academic Workspace returns 6 enrolled Semester 2 courses with live KAIE coverage for Mathematics II
  const { getStudentAcademicWorkspace } = require('../lib/kaie-course-map');
  const workspace = await getStudentAcademicWorkspace(db, { semesterNo: 2 });
  assert.equal(workspace.semesterNo, 2);
  assert.equal(workspace.coursesCount, 6);
  const mathCourse = workspace.courses.find((c) => c.code === 'BSM121');
  assert.ok(mathCourse, 'Semester 2 workspace must include BSM121 Mathematics II');
  assert.ok(mathCourse.extractedItemsCount >= 1, 'Mathematics II workspace card must reflect extracted items count');
  assert.ok(mathCourse.totalTopics >= 1, 'Mathematics II workspace card must reflect compiled syllabus topics');
});

test('KAIE Alignment: Scoped corpus loading, 0.72 confidence threshold gating, and non-destructive versioned upserts', async () => {
  const db = await createTestDb();
  const { getOrLoadIndexedCorpus } = require('../lib/hybrid-rag-engine');

  // 1. Insert notes in two different subjects/semesters to verify (subjectCode, semesterNo) scoping
  const webIns = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'web-u3.txt', 'web-u3.txt', 'Web Tech Unit 3 Notes', 'Semester 2', 'Web Technology I', 'Unit 3', 'T01', 400, new Date().toISOString(), 2, 'notes', 3
  );
  const webId = Number(webIns.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: webId,
    storedName: 'web-u3.txt',
    originalName: 'web-u3.txt',
    title: 'Web Tech Unit 3 Notes',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'notes',
    unit_number: 3
  }, { buffer: Buffer.from('## Specification Formats\nStyle rules can be grouped using selector lists and property declarations.') });

  const dsaIns = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'dsa-u1.txt', 'dsa-u1.txt', 'DSA Unit 1 Notes', 'Semester 3', 'Data Structure and Algorithms', 'Unit 1', 'T02', 400, new Date().toISOString(), 3, 'notes', 1
  );
  const dsaId = Number(dsaIns.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: dsaId,
    storedName: 'dsa-u1.txt',
    originalName: 'dsa-u1.txt',
    title: 'DSA Unit 1 Notes',
    semester: 'Semester 3',
    semester_no: 3,
    subject: 'Data Structure and Algorithms',
    chapter: 'Unit 1',
    resource_category: 'notes',
    unit_number: 1
  }, { buffer: Buffer.from('## Asymptotic Notation\nBig-O notation describes the upper bound of an algorithm runtime complexity.') });

  const scopedWebCorpus = await getOrLoadIndexedCorpus(db, { subjectCode: 'CIT123', semesterNo: 2 });
  assert.ok(scopedWebCorpus.preparedChunks.length >= 1, 'Scoped Web Tech corpus should have chunks');
  assert.ok(
    scopedWebCorpus.preparedChunks.every((c) => Number(c.file_semester_no ?? c.semester_no) === 2),
    'Scoped corpus must only include Semester 2 chunks'
  );
  assert.ok(
    !scopedWebCorpus.preparedChunks.some((c) => String(c.file_id) === String(dsaId)),
    'Scoped corpus for CIT123 Sem 2 must not load DSA Sem 3 chunks'
  );

  // Verify cache hit on second scoped call
  const scopedWebCached = await getOrLoadIndexedCorpus(db, { subjectCode: 'CIT123', semesterNo: 2 });
  assert.equal(scopedWebCached.cacheHit, true, 'Second scoped call should hit per-scope cache');

  // 2. Verify 0.42–0.71 confidence gating queues UNCERTAIN_SYLLABUS_MAPPING with NEEDS_REVIEW
  const borderlineIns = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'web-borderline.txt', 'web-borderline.txt', 'CSS Positioning Draft', 'Semester 2', 'Web Technology I', 'Unit 3', 'T01', 350, new Date().toISOString(), 2, 'notes', 3
  );
  const borderlineId = Number(borderlineIns.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: borderlineId,
    storedName: 'web-borderline.txt',
    originalName: 'web-borderline.txt',
    title: 'CSS Positioning Draft',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'notes',
    unit_number: 3
  }, { buffer: Buffer.from('## Positioning Elements Layout\nUsing relative and absolute offsets to arrange page boxes cleanly.') });

  const mapBeforeLock = await syncCourseMap(db, { subject: 'Web Technology I', semesterNo: 2, unitNumber: 3 });
  const uncertainQueue = await getTeacherReviewQueue(db, {
    subject: 'Web Technology I',
    semesterNo: 2,
    unitNumber: 3,
    reviewType: 'UNCERTAIN_SYLLABUS_MAPPING'
  });
  assert.ok(
    uncertainQueue.some((q) => q.confidence >= 0.42 && q.confidence < 0.72),
    'Borderline match (0.42–0.71) must be queued in kaie_teacher_review_queue for teacher review'
  );

  // 3. Verify non-destructive upsert preserves TEACHER_APPROVED mapping and teacher-locked topic title
  const targetTopic = mapBeforeLock.units[0].topics.find((t) => t.mappings.length > 0);
  assert.ok(targetTopic, 'Must have a mapped topic in Unit 3');
  const firstMapping = targetTopic.mappings[0];
  await db.run(
    `UPDATE course_syllabus_topics SET is_locked_by_teacher = 1, topic_title = ? WHERE id = ?`,
    ['Locked Custom Title', targetTopic.id]
  );
  await db.run(
    `UPDATE topic_source_mappings SET review_status = 'TEACHER_APPROVED' WHERE id = ?`,
    [firstMapping.id]
  );

  const mapAfterRebuild = await syncCourseMap(db, { subject: 'Web Technology I', semesterNo: 2, unitNumber: 3 });
  const rebuiltTopic = mapAfterRebuild.units[0].topics.find((t) => t.id === targetTopic.id);
  assert.ok(rebuiltTopic, 'Locked topic ID must remain stable across non-destructive upsert');
  assert.equal(rebuiltTopic.topicTitle, 'Locked Custom Title', 'Non-destructive upsert must preserve teacher-locked topic_title');
  assert.equal(rebuiltTopic.isLockedByTeacher, true);
  const preservedMapping = rebuiltTopic.mappings.find((m) => m.id === firstMapping.id);
  assert.ok(preservedMapping, 'Teacher-approved mapping must remain preserved');
  assert.equal(preservedMapping.reviewStatus, 'TEACHER_APPROVED');
});


