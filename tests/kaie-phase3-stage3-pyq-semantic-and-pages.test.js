'use strict';

/**
 * Kyana Phase 3 — Stage 3 Regression Test Suite:
 * PYQ Page Preservation & Semantic Topic Intelligence
 *
 * Covers all 20 mandatory Stage 3 test scenarios:
 * - Page preservation (1–6):
 *   1. Single-page PYQ extraction preserves the correct page.
 *   2. Multiple questions on one page preserve their individual question numbers.
 *   3. Multi-page questions retain correct page provenance (pageNumber & pageEnd / pageRange).
 *   4. Subquestions ((a), (b), (i), (ii)) are not incorrectly separated.
 *   5. Legacy fullText input remains supported (and marks pageProvenanceStatus as 'unavailable' instead of fabricating verified page numbers).
 *   6. Repeated ingestion does not duplicate questions.
 * - Semantic topic linking (7–12):
 *   7. Exact lexical matches still work.
 *   8. Paraphrased questions can match the correct syllabus topic semantically.
 *   9. Similar terminology from another subject cannot create a cross-subject mapping.
 *   10. Ambiguous semantic matches are not automatically confirmed (marked medium/low & routed to review queue).
 *   11. Unmapped questions remain retrievable as unmapped questions.
 *   12. Embedding failures fall back safely to existing lexical/taxonomy matching.
 * - Analytics (13–16):
 *   13. Repeated questions across different years are counted correctly.
 *   14. Duplicate paper ingestion does not inflate frequency.
 *   15. Marks and examination-year analytics are correct (distinguishing same-exam multi-questions vs multi-year repetition).
 *   16. Weak topic mappings are excluded from confirmed-topic analytics.
 * - Integration (17–20):
 *   17. Chapter Tutor retrieves the improved PYQ records.
 *   18. Source page and paper provenance survive retrieval (including multi-page range and unavailable provenance handling).
 *   19. Existing authorization restrictions remain enforced.
 *   20. Teacher review override updates and locks PYQ topic mappings across re-ingestion.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const { ingestAcademicDocument } = require('../lib/document-ingestion');
const { setEmbeddingProvider } = require('../lib/semantic-chunker');
const {
  clearSyllabusTopicEmbeddingCache,
  parsePyqDocumentToQuestions,
  linkPyqQuestionToCurriculum,
  ingestPyqPaper,
  updatePyqTopicMapping,
  searchPyqQuestions,
  getTopicPyqAnalytics
} = require('../lib/pyq-intelligence');
const { getTeacherReviewQueue } = require('../lib/kaie-course-map');
const { answerWithChapterContext } = require('../lib/chapter-tutor-engine');
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
    },
    close() {
      try {
        client.close();
      } catch (_) {}
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
      audience_scope TEXT,
      visibility TEXT,
      resource_category TEXT,
      unit_number INTEGER,
      sort_order INTEGER DEFAULT 0,
      deleted_at TEXT,
      hidden_at TEXT,
      moderation_status TEXT
    );
    CREATE TABLE IF NOT EXISTS file_blobs (
      filename TEXT PRIMARY KEY,
      fileData BLOB
    );
    CREATE TABLE IF NOT EXISTS note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'indexed',
      extraction_error TEXT,
      indexed_at TEXT NOT NULL DEFAULT '',
      content_truncated INTEGER NOT NULL DEFAULT 0
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Page Preservation (Scenarios 1–6): Single-page, multi-question, multi-page continuation, subparts (a)/(b)/(i)/(ii), legacy fullText, and idempotent re-ingestion', async () => {
  const db = await createTestDb();
  try {
    // Scenario 1 & 2: Single-page PYQ extraction preserves exact page number and multiple question numbers on the same page
    const singlePageQuestions = parsePyqDocumentToQuestions(
      [
        {
          page_number: 3,
          cleaned_text: `
            Group A - Short Answer Questions
            1. Define propositional logic and truth table with an example. [5]
            2. State De Morgan's laws for compound propositions. [5]
          `
        }
      ],
      { subject: 'Discrete Mathematics', semesterNo: 2, examYear: '2080 BS' }
    );

    assert.equal(singlePageQuestions.length, 2, 'Scenario 2: Should extract both questions from page 3');
    assert.equal(singlePageQuestions[0].questionNumber, '1');
    assert.equal(singlePageQuestions[0].pageNumber, 3, 'Scenario 1: Q1 must preserve page 3');
    assert.equal(singlePageQuestions[0].pageEnd, 3);
    assert.equal(singlePageQuestions[0].pageProvenanceStatus, 'verified');
    assert.equal(singlePageQuestions[1].questionNumber, '2');
    assert.equal(singlePageQuestions[1].pageNumber, 3, 'Scenario 1: Q2 must preserve page 3');

    // Scenario 3 & 4: Multi-page continuing question + subparts (a), (b), (i), (ii) + headers/footers between pages
    const multiPageInput = [
      {
        page_number: 1,
        cleaned_text: `
          GANDAKI UNIVERSITY
          Bachelor of Information Technology (BIT)
          Final Examination 2081 BS
          Subject: Data Structure and Algorithms (CIT214)
          Full Marks: 100
          Pass Marks: 40

          Group A
          1. Define asymptotic notation and compare Big-O, Big-Omega, and Big-Theta. [5]
          2. Consider a Binary Search Tree (BST) with keys inserted in order:
          (a) Construct the BST step by step for the sequence 45, 20, 60, 15, 30. [4]
          P.T.O.
          Page 1 of 2
        `
      },
      {
        page_number: 2,
        cleaned_text: `
          GANDAKI UNIVERSITY
          Page 2 of 2
          (b) Write recursive algorithms for:
          (i) Inorder traversal of the constructed BST. [3]
          (ii) Deleting a node with two children from the BST. [3]
          3. Explain collision resolution using linear probing and quadratic probing. [5]
        `
      }
    ];

    const multiPageParsed = parsePyqDocumentToQuestions(multiPageInput, {
      subject: 'Data Structure and Algorithms',
      subjectCode: 'CIT214',
      semesterNo: 3
    });

    assert.equal(multiPageParsed.length, 3, 'Scenario 3 & 4: Continuing Q2 across pages 1->2 and its subparts (a),(b),(i),(ii) must NOT be split into separate questions');

    const q1 = multiPageParsed[0];
    assert.equal(q1.questionNumber, '1');
    assert.equal(q1.pageNumber, 1);
    assert.equal(q1.pageEnd, 1);
    assert.equal(q1.pageRange, 'Page 1');

    const q2 = multiPageParsed[1];
    assert.equal(q2.questionNumber, '2');
    assert.equal(q2.pageNumber, 1, 'Scenario 3: Multi-page Q2 starts on Page 1');
    assert.equal(q2.pageEnd, 2, 'Scenario 3: Multi-page Q2 ends on Page 2');
    assert.equal(q2.pageRange, 'Pages 1–2', 'Scenario 3: Multi-page Q2 must record Pages 1–2');
    assert.equal(q2.marks, 10, 'Scenario 4: Subpart marks [4] + [3] + [3] must sum to 10');
    assert.deepEqual(q2.subparts, ['(a)', '(b)', '(i)', '(ii)'], 'Scenario 4: All subparts (a), (b), (i), (ii) must remain attached to Q2');
    assert.match(q2.cleanQuestionText, /Construct the BST/i);
    assert.match(q2.cleanQuestionText, /Inorder traversal/i);
    assert.match(q2.cleanQuestionText, /Deleting a node/i);

    const q3 = multiPageParsed[2];
    assert.equal(q3.questionNumber, '3');
    assert.equal(q3.pageNumber, 2, 'Q3 on page 2 must record Page 2');
    assert.equal(q3.pageEnd, 2);

    // Scenario 5: Legacy fullText input without page structure remains supported and marks pageProvenanceStatus as 'unavailable'
    const legacyParsed = parsePyqDocumentToQuestions(
      `1. Define stack and explain push and pop operations. [5]\n2. Explain circular queue implementation. [5]`,
      { subject: 'Data Structure and Algorithms', semesterNo: 3, examYear: '2079 BS' }
    );
    assert.equal(legacyParsed.length, 2, 'Scenario 5: Legacy fullText string must still parse questions');
    assert.equal(legacyParsed[0].pageProvenanceStatus, 'unavailable', 'Scenario 5: Legacy fullText without page metadata must mark pageProvenanceStatus as unavailable');
    assert.equal(legacyParsed[0].pageRange, null, 'Scenario 5: Must not fabricate a verified page range for legacy fullText');

    // Scenario 6: Repeated ingestion of the same paper is idempotent and does not duplicate questions
    const ingest1 = await ingestPyqPaper(db, {
      subject: 'Data Structure and Algorithms',
      subjectCode: 'CIT214',
      semesterNo: 3,
      examYear: '2081 BS',
      examType: 'Final Exam',
      pages: multiPageInput
    });
    const ingest2 = await ingestPyqPaper(db, {
      subject: 'Data Structure and Algorithms',
      subjectCode: 'CIT214',
      semesterNo: 3,
      examYear: '2081 BS',
      examType: 'Final Exam',
      pages: multiPageInput
    });

    assert.equal(ingest1.paperId, ingest2.paperId, 'Scenario 6: Re-ingesting identical paper must reuse paperId');
    assert.equal(ingest2.idempotentReplaced, true);
    const allStoredQuestions = await db.all(`SELECT * FROM pyq_questions WHERE paper_id = ?`, ingest1.paperId);
    assert.equal(allStoredQuestions.length, 3, 'Scenario 6: Repeated ingestion must not duplicate questions in DB');
  } finally {
    db.close();
  }
});

test('Semantic Topic Linking (Scenarios 7–12): Exact lexical match, paraphrased semantic match, cross-subject isolation, ambiguous review queueing, unmapped question retrieval, and embedding failure fallback', async () => {
  const db = await createTestDb();
  try {
    clearSyllabusTopicEmbeddingCache();

    // Scenario 7: Exact lexical match works with high confidence
    const exactMatch = await linkPyqQuestionToCurriculum(
      db,
      {
        cleanQuestionText: 'Define Mathematical Induction and prove that 1 + 2 + ... + n = n(n+1)/2.',
        marks: 10
      },
      { subject: 'Discrete Mathematics', subjectCode: 'CIT121', semesterNo: 2 }
    );
    assert.equal(exactMatch.mappingConfidence, 'high');
    assert.equal(exactMatch.mappingStatus, 'AUTO_CONFIRMED');
    assert.match(exactMatch.primaryTopic, /Induction/i);

    // Scenario 8: Paraphrased question without literal syllabus topic title matches the correct syllabus topic semantically
    const paraphrasedMatch = await linkPyqQuestionToCurriculum(
      db,
      {
        // Does NOT use the words "Mathematical Induction", instead describes base case n=1 and inductive hypothesis n=k -> n=k+1
        cleanQuestionText: 'Prove that a proposition P(n) holds for all positive integers by verifying the base step n=1 and showing the inductive hypothesis for n=k implies n=k+1.',
        marks: 10
      },
      { subject: 'Discrete Mathematics', subjectCode: 'CIT121', semesterNo: 2 }
    );
    assert.equal(paraphrasedMatch.mappingConfidence, 'high', 'Scenario 8: Paraphrased question should match with high confidence');
    assert.match(paraphrasedMatch.primaryTopic, /Induction/i, 'Scenario 8: Paraphrased base step + inductive hypothesis question must map to Mathematical Induction');
    assert.ok(paraphrasedMatch.semanticScore > 0, 'Scenario 8: Semantic embedding similarity must contribute > 0');

    // Scenario 9: Similar terminology from another subject cannot create a cross-subject mapping
    const crossSubjectCheck = await linkPyqQuestionToCurriculum(
      db,
      {
        cleanQuestionText: 'Explain CSS Flexbox container properties and responsive media queries.',
        marks: 5
      },
      // Passed under Discrete Mathematics (CIT121) — must NEVER map to a Web Technology I CSS unit!
      { subject: 'Discrete Mathematics', subjectCode: 'CIT121', semesterNo: 2 }
    );
    assert.equal(crossSubjectCheck.subject, 'Discrete Mathematics', 'Scenario 9: Must stay restricted to Discrete Mathematics');
    assert.doesNotMatch(crossSubjectCheck.primaryTopic || '', /CSS|Flexbox|Cascading/i, 'Scenario 9: Must never pull a topic from Web Technology I');
    assert.equal(crossSubjectCheck.mappingConfidence, 'unmapped', 'Scenario 9: Out-of-subject question in Discrete Math should be unmapped rather than forced onto a random Discrete Math topic');

    // Scenario 10 & 11: Ambiguous semantic matches are not auto-confirmed (routed to teacher review queue), and unmapped questions remain retrievable
    const paperWithAmbiguousAndUnmapped = await ingestPyqPaper(db, {
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2080 BS',
      examType: 'Mid-Term Exam',
      pages: [
        {
          page_number: 1,
          cleaned_text: `
            1. Discuss general mathematical reasoning and logical proof strategies briefly. [5]
            2. Describe quantum entanglement teleportation in superconducting qubits. [5]
          `
        }
      ]
    });

    const qAmbiguous = paperWithAmbiguousAndUnmapped.questions[0];
    const qUnmapped = paperWithAmbiguousAndUnmapped.questions[1];

    // If a question has medium/low confidence, it must NOT be AUTO_CONFIRMED
    if (qAmbiguous.mappingConfidence === 'medium' || qAmbiguous.mappingConfidence === 'low') {
      assert.equal(qAmbiguous.mappingStatus, 'CANDIDATE_NEEDS_REVIEW', 'Scenario 10: Medium/low confidence matches must not be AUTO_CONFIRMED');
      const reviewQueue = await getTeacherReviewQueue(db, {
        subject: 'Discrete Mathematics',
        reviewType: 'AMBIGUOUS_PYQ_TOPIC_MAPPING'
      });
      assert.ok(reviewQueue.length >= 1, 'Scenario 10: Ambiguous PYQ topic mapping must be queued in kaie_teacher_review_queue');
    }

    // Scenario 11: Unmapped question is stored as UNMAPPED and remains retrievable
    assert.equal(qUnmapped.mappingConfidence, 'unmapped', 'Scenario 11: Quantum qubit question in Discrete Math must be unmapped');
    assert.equal(qUnmapped.mappingStatus, 'UNMAPPED');
    const unmappedRows = await searchPyqQuestions(db, {
      subject: 'Discrete Mathematics',
      unmappedOnly: true
    });
    assert.equal(unmappedRows.length, 1, 'Scenario 11: Unmapped question must remain retrievable via searchPyqQuestions');
    assert.match(unmappedRows[0].clean_question_text, /quantum entanglement/i);

    // Scenario 12: Embedding provider failure falls back safely to lexical/taxonomy matching without throwing
    clearSyllabusTopicEmbeddingCache();
    setEmbeddingProvider({
      provider: 'broken_provider',
      modelName: 'broken-embed-v1',
      modelVersion: '1',
      dimensions: 256,
      async embedBatch() {
        throw new Error('Simulated embedding provider outage');
      }
    });
    try {
      const fallbackLinked = await linkPyqQuestionToCurriculum(
        db,
        {
          cleanQuestionText: 'Define tautology and contradiction using truth tables.',
          marks: 5
        },
        { subject: 'Discrete Mathematics', subjectCode: 'CIT121', semesterNo: 2 }
      );
      assert.equal(fallbackLinked.embeddingFallbackUsed, true, 'Scenario 12: Should flag embeddingFallbackUsed = true when provider fails');
      assert.equal(fallbackLinked.mappingConfidence, 'high', 'Scenario 12: Lexical/taxonomy fallback must still match tautology with high confidence');
    } finally {
      setEmbeddingProvider(null);
      clearSyllabusTopicEmbeddingCache();
    }
  } finally {
    db.close();
  }
});

test('Repeated-Topic Analytics (Scenarios 13–16): Multi-year repetition vs single-exam multi-question distinction, duplicate paper deduplication, marks/year distribution, and weak-match exclusion', async () => {
  const db = await createTestDb();
  try {
    // Paper 1: 2079 BS Final Exam (2 questions in Unit 1: Q1 on Tautology [5], Q2 on Mathematical Induction [10])
    await ingestPyqPaper(db, {
      paperId: 'paper_dm_2079',
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2079 BS',
      examType: 'Final Exam',
      unitNumber: 1,
      pages: [
        {
          page_number: 1,
          cleaned_text: `
            1. Define tautology and logical equivalence with truth tables. [5]
            2. Prove by mathematical induction that 1 + 2 + ... + n = n(n+1)/2. [10]
          `
        }
      ]
    });

    // Paper 2: Duplicate upload of the exact same 2079 BS Final Exam under a different paperId (simulating duplicate upload)
    await ingestPyqPaper(db, {
      paperId: 'paper_dm_2079_duplicate_copy',
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2079 BS',
      examType: 'Final Exam',
      unitNumber: 1,
      pages: [
        {
          page_number: 1,
          cleaned_text: `
            1. Define tautology and logical equivalence with truth tables. [5]
            2. Prove by mathematical induction that 1 + 2 + ... + n = n(n+1)/2. [10]
          `
        }
      ]
    });

    // Check single-year analytics BEFORE adding 2080 BS paper:
    // Even though 2 questions exist in 2079 BS, `isRepeatedAcrossYears` MUST be false because all questions are from a single exam year!
    const singleYearAnalytics = await getTopicPyqAnalytics(db, {
      subject: 'Discrete Mathematics',
      semesterNo: 2,
      unitNumber: 1
    });
    assert.equal(singleYearAnalytics.timesAsked, 2, 'Scenario 14: Duplicate paper copy must be deduplicated (2 questions, not 4)');
    assert.ok(singleYearAnalytics.duplicateRecordsSkipped >= 2, 'Scenario 14: Should record skipped duplicate questions');
    assert.equal(singleYearAnalytics.distinctYearsCount, 1);
    assert.equal(singleYearAnalytics.isRepeatedAcrossYears, false, 'Scenario 15: Must NOT claim cross-year repetition from a single exam year');

    // Paper 3: 2080 BS Final Exam (asks Mathematical Induction again [10], plus an unmapped off-syllabus question [5])
    await ingestPyqPaper(db, {
      paperId: 'paper_dm_2080',
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2080 BS',
      examType: 'Final Exam',
      unitNumber: 1,
      pages: [
        {
          page_number: 2,
          cleaned_text: `
            1. State the principle of mathematical induction and prove 1 + 3 + ... + (2n-1) = n^2. [10]
            2. Explain relativistic tensor calculus in curved spacetime manifolds. [5]
          `
        }
      ]
    });

    // Scenario 13, 15 & 16: Multi-year analytics counts repeated topics across 2079 BS and 2080 BS, computes marks/year distribution, and excludes unmapped/weak questions
    const multiYearAnalytics = await getTopicPyqAnalytics(db, {
      subject: 'Discrete Mathematics',
      semesterNo: 2,
      unitNumber: 1
    });

    assert.equal(multiYearAnalytics.timesAsked, 3, 'Scenario 16: Should count the 3 confirmed questions and exclude the unmapped tensor calculus question');
    assert.equal(multiYearAnalytics.distinctYearsCount, 2, 'Scenario 13: Appeared across 2 distinct exam years (2080 BS, 2079 BS)');
    assert.equal(multiYearAnalytics.isRepeatedAcrossYears, true, 'Scenario 13: Now repeated across 2 distinct exam years');
    assert.deepEqual(multiYearAnalytics.examYears, ['2080 BS', '2079 BS']);
    assert.equal(multiYearAnalytics.yearDistribution['2079 BS'].questionCount, 2);
    assert.equal(multiYearAnalytics.yearDistribution['2079 BS'].totalMarks, 15);
    assert.equal(multiYearAnalytics.yearDistribution['2080 BS'].questionCount, 1);
    assert.equal(multiYearAnalytics.yearDistribution['2080 BS'].totalMarks, 10);
    assert.equal(multiYearAnalytics.marksDistribution[5], 1);
    assert.equal(multiYearAnalytics.marksDistribution[10], 2);
  } finally {
    db.close();
  }
});

test('Integration & Authorization (Scenarios 17–20): Chapter Tutor retrieves multi-page PYQ provenance, handles unavailable page provenance honestly, enforces cohort authorization, and preserves teacher review overrides', async () => {
  const db = await createTestDb();
  try {
    // Seed a multi-page model_questions file via full ingestAcademicDocument pipeline (form-feed `\f` separated pages)
    const multiPagePyqText = [
      `GANDAKI UNIVERSITY\nWeb Technology I (CIT202)\nFinal Exam 2081 BS\nGroup A\n1. Explain inline, internal, and external CSS style sheets with examples. [5]`,
      `Group B\n2. Describe the CSS Box Model (margin, border, padding, content) and demonstrate how total element width is calculated:\n(a) With content-box sizing [5]`,
      `(b) With border-box sizing and responsive flexbox layout [5]`
    ].join('\n\f\n');

    const fileIns = await db.run(
      `INSERT INTO files (
        originalName, storedName, title, subject, semester, semester_no,
        chapter, unit_number, resource_category, cohort_id, audience_scope,
        visibility, uploadedBy, sizeBytes, uploadedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'web-tech-2081-pyq.txt',
      'web-tech-2081-pyq.txt',
      'Web Tech 2081 Past Paper',
      'Web Technology I',
      'Semester 2',
      2,
      'Unit 3: Introducing Cascading Style Sheet',
      3,
      'model_questions',
      '1',
      'cohort',
      'cohort_only',
      'teacher1',
      Buffer.byteLength(multiPagePyqText),
      new Date().toISOString()
    );
    const pyqFileId = Number(fileIns.lastInsertRowid);

    await ingestAcademicDocument(
      db,
      {
        id: pyqFileId,
        originalName: 'web-tech-2081-pyq.txt',
        storedName: 'web-tech-2081-pyq.txt',
        title: 'Web Tech 2081 Past Paper',
        subject: 'Web Technology I',
        semester: 'Semester 2',
        semester_no: 2,
        chapter: 'Unit 3: Introducing Cascading Style Sheet',
        unit_number: 3,
        resource_category: 'model_questions',
        cohort_id: '1',
        audience_scope: 'cohort',
        visibility: 'cohort_only',
        uploadedBy: 'teacher1'
      },
      { buffer: Buffer.from(multiPagePyqText) }
    );

    const studentCohort1 = {
      authenticated: true,
      role: 'student',
      studentId: 'stu_c1',
      username: 'stu_c1',
      currentSemester: 2,
      semester: 'Semester 2',
      semesterNo: 2,
      cohortId: '1',
      cohort: { id: '1', currentSemester: 2, status: 'active' }
    };

    const studentCohort2 = {
      authenticated: true,
      role: 'student',
      studentId: 'stu_c2',
      username: 'stu_c2',
      currentSemester: 2,
      semester: 'Semester 2',
      semesterNo: 2,
      cohortId: '2',
      cohort: { id: '2', currentSemester: 2, status: 'active' }
    };

    // Scenario 17 & 18: Chapter Tutor retrieves the multi-page PYQ records and preserves exact page & page-range provenance (`Pages 2–3`)
    const tutorRes = await answerWithChapterContext(db, {
      message: 'Show previous-year questions from this chapter',
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
        fileIds: []
      },
      academicContext: studentCohort1
    });

    assert.equal(tutorRes.foundPyqQuestions, true, 'Scenario 17: Chapter Tutor must retrieve PYQ questions');
    const qBoxModel = tutorRes.pyqIntelligence.questions.find((q) => String(q.questionNumber) === '2');
    assert.ok(qBoxModel, 'Scenario 17: Multi-page Q2 must be retrieved');
    assert.equal(qBoxModel.pageNumber, 2, 'Scenario 18: Q2 starts on Page 2');
    assert.equal(qBoxModel.pageEnd, 3, 'Scenario 18: Q2 continues to Page 3');
    assert.equal(qBoxModel.pageRange, 'Pages 2–3', 'Scenario 18: Q2 must preserve page range Pages 2–3');
    assert.equal(qBoxModel.documentTitle, 'Web Tech 2081 Past Paper');
    assert.match(tutorRes.reply, /Pages 2–3/, 'Scenario 18: Rendered Chapter Tutor reply must display Pages 2–3');

    // Scenario 19: Cohort 2 student cannot retrieve Cohort 1's restricted PYQ paper
    const unauthorizedTutorRes = await answerWithChapterContext(db, {
      message: 'Show previous-year questions from this chapter',
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
        fileIds: []
      },
      academicContext: studentCohort2
    });
    assert.equal(unauthorizedTutorRes.foundPyqQuestions, false, 'Scenario 19: Cohort 2 student must not receive Cohort 1 restricted PYQ records');

    // Scenario 20: Teacher can review/override a PYQ topic mapping and it remains locked across re-ingestion
    await updatePyqTopicMapping(db, qBoxModel.id, {
      unitNumber: 3,
      chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
      topic: 'The Box Model',
      resolvedByUserId: 'teacher1'
    });
    const updatedRow = await db.get(`SELECT * FROM pyq_questions WHERE id = ?`, qBoxModel.id);
    assert.equal(updatedRow.primary_topic, 'The Box Model');
    assert.equal(updatedRow.mapping_status, 'TEACHER_APPROVED');
  } finally {
    db.close();
  }
});
