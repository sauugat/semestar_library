'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const { buildReconciledStudyPlan } = require('./study-partner-reconciler');
const { normalizeText } = require('./academic-document-understanding');

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/**
 * Starts or resumes a stateful chapter study session for a student.
 */
async function startOrResumeStudySession(db, params = {}) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();

  const studentId = String(params.studentId || 'anonymous_student');
  const conversationId = params.conversationId ? String(params.conversationId) : null;
  const subject = params.subject || 'General Academic';
  const semesterNo = params.semesterNo ? Number(params.semesterNo) : null;
  const unitNumber = params.unitNumber ? Number(params.unitNumber) : null;
  const chapterQuery = params.chapterQuery || (unitNumber ? `Unit ${unitNumber}` : 'Unit 1');

  let existingSession = null;
  if (conversationId && subject && subject !== 'General Academic') {
    existingSession = await db.get(
      `SELECT * FROM study_partner_sessions
       WHERE student_id = ? AND conversation_id = ? AND status = 'ACTIVE'
         AND (subject LIKE ? OR subject_code LIKE ?)
       ORDER BY updated_at DESC LIMIT 1`,
      studentId,
      conversationId,
      `%${subject}%`,
      `%${subject}%`
    );
  } else if (conversationId) {
    existingSession = await db.get(
      `SELECT * FROM study_partner_sessions
       WHERE student_id = ? AND conversation_id = ? AND status = 'ACTIVE'
       ORDER BY updated_at DESC LIMIT 1`,
      studentId,
      conversationId
    );
  }

  if (!existingSession) {
    const queryParams = [studentId, `%${subject}%`];
    let sql = `SELECT * FROM study_partner_sessions
               WHERE student_id = ? AND status = 'ACTIVE' AND (subject LIKE ? OR subject_code LIKE ?)`;
    queryParams.push(`%${subject}%`);
    if (unitNumber) {
      sql += ` AND unit_number = ?`;
      queryParams.push(unitNumber);
    }
    sql += ` ORDER BY updated_at DESC LIMIT 1`;
    existingSession = await db.get(sql, ...queryParams);
  }

  if (existingSession) {
    const topics = await db.all(
      `SELECT * FROM study_partner_topic_progress
       WHERE session_id = ?
       ORDER BY step_index ASC`,
      existingSession.id
    );

    const hasCorruptSteps =
      !topics ||
      topics.length === 0 ||
      topics.length > 25 ||
      topics.some((t) => /^(?:page|slide)\s*\d+$/i.test((t.topic_title || t.topicTitle || '').trim()));

    if (!hasCorruptSteps) {
      return {
        session: existingSession,
        topics: topics || [],
        isResumed: true
      };
    }

    await db.run(
      `UPDATE study_partner_sessions SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`,
      now,
      existingSession.id
    );
  }

  // Build the exhaustive Zero-Topic-Left-Behind study plan
  const reconciled = await buildReconciledStudyPlan(db, {
    subject,
    chapterQuery,
    semesterNo,
    unitNumber,
    academicContext: params.academicContext
  });

  const sessionId = 'study_sess_' + crypto.randomUUID().slice(0, 16);
  const totalSteps = Math.max(1, reconciled.totalSteps);

  await db.run(
    `INSERT INTO study_partner_sessions (
      id, student_id, conversation_id, subject, subject_code,
      semester_no, unit_number, chapter_title, status, pedagogical_stage,
      current_step_index, total_steps, mastered_steps, reconciled_plan_json,
      source_files_json, pyq_summary_json, last_interaction_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    studentId,
    conversationId,
    reconciled.subject,
    reconciled.subjectCode,
    reconciled.semesterNo || semesterNo || 1,
    reconciled.unitNumber,
    reconciled.chapterTitle,
    'ACTIVE',
    'TEACHING',
    1,
    totalSteps,
    0,
    JSON.stringify(reconciled.plan || []),
    JSON.stringify(reconciled.summary.sourceFiles || []),
    JSON.stringify({
      totalPyqs: reconciled.summary.totalPyqsMatched,
      pyqAlertsCount: reconciled.summary.pyqAlertsCount
    }),
    now,
    now,
    now
  );

  const topics = [];
  for (const step of reconciled.plan) {
    const topicId = `topic_prog_${sessionId}_${step.stepIndex}`;
    const defaultCheckpoint = generateCheckpointQuestion(step);

    await db.run(
      `INSERT INTO study_partner_topic_progress (
        id, session_id, student_id, step_index, topic_title,
        normalized_topic, source_origin, syllabus_ref, note_citations_json,
        pyq_matches_json, status, checkpoint_question, student_last_answer,
        attempts_count, mastered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      topicId,
      sessionId,
      studentId,
      step.stepIndex,
      step.topicTitle,
      step.normalizedTopic,
      step.sourceOrigin,
      step.syllabusRef,
      JSON.stringify(step.noteCitations || []),
      JSON.stringify(step.pyqMatches || []),
      step.stepIndex === 1 ? 'IN_PROGRESS' : 'PENDING',
      defaultCheckpoint,
      null,
      0,
      null,
      now
    );

    topics.push({
      id: topicId,
      sessionId,
      studentId,
      stepIndex: step.stepIndex,
      topicTitle: step.topicTitle,
      normalizedTopic: step.normalizedTopic,
      sourceOrigin: step.sourceOrigin,
      coverageStatus: step.coverageStatus || ((step.noteCitations && step.noteCitations.length > 0) ? 'NOTES_COVERED' : 'MISSING_NOTES'),
      syllabusRef: step.syllabusRef,
      noteCitations: step.noteCitations,
      pyqMatches: step.pyqMatches,
      extractedItems: step.extractedItems || null,
      conflicts: step.conflicts || [],
      status: step.stepIndex === 1 ? 'IN_PROGRESS' : 'PENDING',
      checkpointQuestion: defaultCheckpoint,
      attemptsCount: 0
    });
  }

  const createdSession = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessionId);

  return {
    session: createdSession,
    topics,
    isResumed: false
  };
}

/**
 * Advances a session to the next micro-topic step or marks the current step mastered.
 */
async function advanceStudySessionStep(db, sessionId, studentId, options = {}) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();

  const session = await db.get(
    `SELECT * FROM study_partner_sessions WHERE id = ? AND student_id = ?`,
    sessionId,
    studentId
  );
  if (!session) return { ok: false, error: 'Session not found' };

  const currentStep = session.current_step_index || session.currentStepIndex || 1;
  const targetStep = options.targetStepIndex || currentStep + 1;
  const markStatus = options.markCurrentStatus || 'MASTERED';

  await db.run(
    `UPDATE study_partner_topic_progress
     SET status = ?, mastered_at = ?, updated_at = ?
     WHERE session_id = ? AND step_index = ?`,
    markStatus,
    markStatus === 'MASTERED' ? now : null,
    now,
    sessionId,
    currentStep
  );

  const countRow = await db.get(
    `SELECT COUNT(*) as count FROM study_partner_topic_progress
     WHERE session_id = ? AND status = 'MASTERED'`,
    sessionId
  );
  const masteredCount = Number(countRow?.count || 0);

  const totalSteps = session.total_steps || session.totalSteps || 1;
  const isCompleted = targetStep > totalSteps;

  if (isCompleted) {
    await db.run(
      `UPDATE study_partner_sessions
       SET status = 'COMPLETED', pedagogical_stage = 'COMPLETED',
           mastered_steps = ?, last_interaction_at = ?, updated_at = ?
       WHERE id = ?`,
      masteredCount,
      now,
      now,
      sessionId
    );
  } else {
    await db.run(
      `UPDATE study_partner_topic_progress
       SET status = 'IN_PROGRESS', updated_at = ?
       WHERE session_id = ? AND step_index = ?`,
      now,
      sessionId,
      targetStep
    );

    await db.run(
      `UPDATE study_partner_sessions
       SET current_step_index = ?, mastered_steps = ?,
           pedagogical_stage = 'TEACHING', last_interaction_at = ?, updated_at = ?
       WHERE id = ?`,
      targetStep,
      masteredCount,
      now,
      now,
      sessionId
    );
  }

  const updatedSession = await db.get(`SELECT * FROM study_partner_sessions WHERE id = ?`, sessionId);
  const updatedTopics = await db.all(
    `SELECT * FROM study_partner_topic_progress WHERE session_id = ? ORDER BY step_index ASC`,
    sessionId
  );

  return {
    ok: true,
    session: updatedSession,
    topics: updatedTopics,
    currentStepIndex: isCompleted ? totalSteps : targetStep,
    isCompleted
  };
}

/**
 * Evaluates the student's conversational reply against pedagogical intent.
 */
function evaluateStudentIntent(studentMessage, currentStep, lastCheckpoint) {
  const text = String(studentMessage || '').trim();
  const lower = text.toLowerCase();

  if (
    /^(?:next|continue|move on|move to next|proceed|go ahead|understood|got it|bujhe|bujhiyo|next topic|next subtopic|skip|let's go|aagi badham)$/i.test(lower) ||
    lower.includes('next topic') ||
    lower.includes('agadi badham') ||
    lower.includes('move to next')
  ) {
    return { intent: 'advance_directly', confidence: 0.95 };
  }

  if (
    /^(?:bujhina|confused|lost|feri bujhaideu|explain simpler|give example|simpler analogy|gahro vo|didn't get it|dont understand|can you explain again)$/i.test(lower) ||
    lower.includes('bujhina') ||
    lower.includes('simpler example') ||
    lower.includes('simpler words') ||
    lower.includes('another example') ||
    lower.includes('another simple example') ||
    lower.includes('give me a hint') ||
    /explain\s+(?:this|it)?\s*again/i.test(lower) ||
    lower.includes('confused')
  ) {
    return { intent: 'remediate', confidence: 0.92 };
  }

  if (
    lower.includes('pyq') ||
    lower.includes('past question') ||
    lower.includes('exam question') ||
    lower.includes('solve pyq') ||
    lower.includes('show exam question')
  ) {
    return { intent: 'practice_pyq', confidence: 0.9 };
  }

  if (
    lower.includes('quiz me') ||
    lower.includes('test me') ||
    lower.includes('ask me a question')
  ) {
    return { intent: 'quiz', confidence: 0.88 };
  }

  return {
    intent: 'answer_attempt',
    confidence: 0.8,
    answerText: text
  };
}

/**
 * Formulates a Socratic checkpoint question tailored to a micro-topic,
 * leveraging inline questions extracted from teacher notes when available.
 */
function generateCheckpointQuestion(step) {
  const title = step.topicTitle || step.topic_title || 'this concept';
  const lower = title.toLowerCase();

  const inlineQs = step?.extractedItems?.inlineQuestions || [];
  if (inlineQs.length > 0 && inlineQs[0].contentText) {
    return `Quick check (${inlineQs[0].fileTitle || 'Teacher Note'}, p.${inlineQs[0].pageStart || 1}): ${inlineQs[0].contentText}`;
  }

  if (lower.includes('adt') || lower.includes('abstract data type')) {
    return `Quick check: Why is an Abstract Data Type (ADT) concerned only with "what" operations do rather than "how" they are implemented in memory?`;
  }
  if (lower.includes('singly linked list') && lower.includes('insertion')) {
    return `Quick check: When inserting a new node at the beginning of a singly linked list, which pointer must be updated first: \`newNode->next\` or the \`head\` pointer? Why?`;
  }
  if (lower.includes('reversing') || lower.includes('reverse')) {
    return `Quick check: Why do we need three pointers (\`prev\`, \`current\`, \`next\`) to reverse a singly linked list in a single pass without losing the rest of the list?`;
  }
  if (lower.includes('doubly') || lower.includes('two way')) {
    return `Quick check: What is the main memory tradeoff of a Doubly Linked List compared to a Singly Linked List, and what operation does it make significantly faster?`;
  }
  if (lower.includes('circular')) {
    return `Quick check: In a Circular Linked List, what does the \`next\` pointer of the last node point to instead of NULL?`;
  }
  if (lower.includes('malloc') || lower.includes('memory allocation')) {
    return `Quick check: What does \`malloc()\` return if memory allocation fails, and why must we always check for that condition before accessing \`node->next\`?`;
  }
  if (lower.includes('pointer')) {
    return `Quick check: If pointer \`ptr\` points to an \`int\` at memory address 1000, what address will \`ptr + 1\` point to on a 4-byte integer architecture?`;
  }
  if (lower.includes('deadlock') || lower.includes('prevention')) {
    return `Quick check: Why does imposing a strict numerical ordering on resource requests prevent the Circular Wait condition?`;
  }

  if (lower.includes('cascading style sheet') || lower.includes('css') || lower.includes('introducing cascading') || lower.includes('web technology')) {
    if (lower.includes('where you can add') || lower.includes('levels of style') || lower.includes('introduction')) {
      return `Quick check: What are the three levels where CSS can be applied (ways to add CSS to HTML), and why is an external stylesheet considered the best practice?`;
    }
    if (lower.includes('selector') || lower.includes('class') || lower.includes('format')) {
      return `Quick check: If an element is \`<p id="main" class="highlight">Hello</p>\` with rules \`#main { color: green; }\` and \`.highlight { color: red; }\`, which color wins and why?`;
    }
    if (lower.includes('box model') || lower.includes('layout') || lower.includes('positioning')) {
      return `Quick check: In the CSS Box Model, what is the exact difference between \`padding\` and \`margin\`?`;
    }
    return `Quick check: What does CSS stand for, and why do we separate CSS presentation from HTML structure?`;
  }

  return `Quick check before we move forward: In your own words, what is the primary role of ${title} in this course?`;
}

/**
 * Loads the compiled KAIE lesson bundle for a micro-topic step from `topic_source_mappings`,
 * `academic_extracted_items`, and `document_chunks` (filtered by student cohort scope).
 */
async function buildCompiledTopicLessonBundle(db, { session = {}, step = {}, academicContext = null } = {}) {
  const emptyBundle = {
    coverageStatus: step.coverageStatus || 'MISSING_NOTES',
    originType: step.originType || 'official_syllabus',
    definitions: [],
    formulas: [],
    examples: [],
    diagrams: [],
    tables: [],
    inlineQuestions: [],
    noteChunks: [],
    conflicts: []
  };
  if (!db || typeof db.all !== 'function') return emptyBundle;

  try {
    await ensureRagSchema(db);
    const subject = session.subject || '';
    const semesterNo = Number(session.semester_no ?? session.semesterNo) || 1;
    const unitNumber = Number(session.unit_number ?? session.unitNumber) || 1;
    const normTopic = step.normalizedTopic || step.normalized_topic || normalizeText(step.topicTitle || step.topic_title || '');

    const callerRole = String(academicContext?.role || '').toLowerCase();
    const studentCohortId = academicContext?.cohortId;
    const enforceCohort = callerRole === 'student' || (studentCohortId !== undefined && callerRole !== 'admin' && callerRole !== 'teacher');

    const rows = await db.all(
      `SELECT * FROM topic_source_mappings
       WHERE subject = ? AND semester_no = ? AND unit_number = ? AND normalized_topic = ?
       ORDER BY relevance_score DESC`,
      subject,
      semesterNo,
      unitNumber,
      normTopic
    ).catch(() => []);

    const visibleRows = (rows || []).filter((m) => {
      if (!enforceCohort) return true;
      const mCohort = m.cohort_id ?? m.cohortId;
      if (mCohort === null || mCohort === undefined || mCohort === '') return true;
      if (studentCohortId === null || studentCohortId === undefined) return false;
      return Number(mCohort) === Number(studentCohortId);
    });

    const toItem = (m) => ({
      id: m.extracted_item_id || m.id,
      type: m.source_type || m.sourceType,
      title: m.section_heading || m.sectionHeading,
      content: m.snippet || '',
      fileId: m.file_id || m.fileId,
      fileTitle: m.file_title || m.fileTitle || 'Teacher Resource',
      pageStart: m.page_start ?? m.pageStart ?? 1,
      pageEnd: m.page_end ?? m.pageEnd ?? 1,
      conflictStatus: m.conflict_status || m.conflictStatus || 'NONE',
      metadata: safeJsonParse(m.metadata_json || m.metadataJson, {})
    });

    const definitions = visibleRows.filter((m) => (m.source_type || m.sourceType) === 'definition').map(toItem);
    const formulas = visibleRows.filter((m) => (m.source_type || m.sourceType) === 'formula').map(toItem);
    const examples = visibleRows
      .filter((m) => (m.source_type || m.sourceType) === 'code_example' || (m.source_type || m.sourceType) === 'worked_example')
      .map(toItem);
    const diagrams = visibleRows.filter((m) => (m.source_type || m.sourceType) === 'diagram').map(toItem);
    const tables = visibleRows.filter((m) => (m.source_type || m.sourceType) === 'table').map(toItem);
    const inlineQuestions = visibleRows.filter((m) => (m.source_type || m.sourceType) === 'inline_question').map(toItem);

    // Fetch full chunk texts for mapped note/practical chunk IDs
    const chunkIds = visibleRows
      .filter((m) => ['notes', 'practical', 'reference'].includes(m.source_type || m.sourceType))
      .map((m) => m.chunk_id || m.chunkId)
      .filter(Boolean)
      .slice(0, 4);

    let noteChunks = [];
    if (chunkIds.length > 0) {
      const placeholders = chunkIds.map(() => '?').join(', ');
      noteChunks = await db.all(
        `SELECT c.id, c.clean_content, c.page_start, c.page_end, c.section_heading,
                f.title AS file_title, f.resource_category
         FROM document_chunks c
         JOIN files f ON CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)
         WHERE c.id IN (${placeholders})`,
        ...chunkIds
      ).catch(() => []);
    }

    if (noteChunks.length === 0) {
      const citations = Array.isArray(step.noteCitations)
        ? step.noteCitations
        : safeJsonParse(step.note_citations_json, []);
      for (const cit of citations.slice(0, 3)) {
        if (cit.snippet) {
          noteChunks.push({
            id: cit.chunkId,
            clean_content: cit.snippet,
            page_start: cit.pageStart || 1,
            page_end: cit.pageEnd || 1,
            section_heading: cit.sectionHeading,
            file_title: cit.fileTitle || 'Teacher Note',
            resource_category: cit.sourceType || 'notes'
          });
        }
      }
    }

    const conflicts = await db.all(
      `SELECT * FROM kaie_teacher_review_queue
       WHERE subject = ? AND semester_no = ? AND unit_number = ?
         AND review_type = 'CROSS_FILE_CONFLICT' AND status = 'PENDING'
         AND LOWER(topic_title) = LOWER(?)`,
      subject,
      semesterNo,
      unitNumber,
      step.topicTitle || step.topic_title || ''
    ).catch(() => []);

    const hasTeacherMaterial = noteChunks.length > 0 || definitions.length > 0 || examples.length > 0 || formulas.length > 0;
    const coverageStatus = hasTeacherMaterial
      ? (examples.length > 0 ? 'COMPLETE' : 'NOTES_COVERED')
      : 'MISSING_NOTES';

    return {
      coverageStatus,
      originType: step.originType || 'official_syllabus',
      definitions,
      formulas,
      examples,
      diagrams,
      tables,
      inlineQuestions,
      noteChunks,
      conflicts: (conflicts || []).map((c) => ({
        concept: c.extracted_concept || c.extractedConcept,
        summary: c.evidence_summary || c.evidenceSummary,
        primaryFileTitle: c.primary_file_title || c.primaryFileTitle,
        primaryPageStart: c.primary_page_start ?? c.primaryPageStart,
        secondaryFileTitle: c.secondary_file_title || c.secondaryFileTitle,
        secondaryPageStart: c.secondary_page_start ?? c.secondaryPageStart
      }))
    };
  } catch (_) {
    return emptyBundle;
  }
}

/**
 * Teaches a single micro-topic in depth with teacher note citations, visual blocks, and PYQ alert.
 */
function renderMicroTopicTurn({
  session,
  step,
  topics,
  lessonBundle = null,
  isRemediation = false,
  studentAnswerEvaluation = null
}) {
  const total = topics.length || 1;
  const currentIdx = step.stepIndex || step.step_index || 1;
  const pct = Math.round(((currentIdx - 1) / total) * 100);

  const parts = [];

  // 1. Interactive Study Session Visual Block
  const sessionBlock = {
    course: `${session.subject_code || session.subjectCode || 'CIT'} · ${session.subject}`,
    unit: `UNIT ${session.unit_number || session.unitNumber}: ${(session.chapter_title || session.chapterTitle || 'CHAPTER').toUpperCase()}`,
    currentStep: currentIdx,
    totalSteps: total,
    progressPercentage: pct,
    checklist: topics.map((t) => ({
      stepIndex: t.stepIndex || t.step_index,
      title: t.topicTitle || t.topic_title,
      status: (t.stepIndex || t.step_index) === currentIdx ? 'current' : ((t.stepIndex || t.step_index) < currentIdx ? 'mastered' : 'pending'),
      sourceBadge: (t.sourceOrigin || t.source_origin) === 'note_exclusive'
        ? 'PDF Extra'
        : (t.coverageStatus === 'MISSING_NOTES' || (t.sourceOrigin || t.source_origin) === 'syllabus_only')
          ? 'Syllabus Gap'
          : 'Syllabus + Note',
      hasPyq: Array.isArray(t.pyqMatches) ? t.pyqMatches.length > 0 : (safeJsonParse(t.pyq_matches_json, []).length > 0)
    }))
  };

  parts.push('```study_session\n' + JSON.stringify(sessionBlock, null, 2) + '\n```');

  // 2. Affirmative transition or remediation intro
  if (studentAnswerEvaluation && studentAnswerEvaluation.feedback) {
    parts.push(`> ${studentAnswerEvaluation.feedback}\n`);
  } else if (isRemediation) {
    parts.push(`> Let's break this down with a simpler everyday analogy so it clicks 100% before we move forward.\n`);
  }

  // 3. Lesson Header with Multi-File Source Traceability
  const citations = Array.isArray(step.noteCitations) ? step.noteCitations : safeJsonParse(step.note_citations_json, []);
  const uniqueSourceBadges = [];
  const seenSourceKeys = new Set();
  for (const c of citations) {
    const k = `${c.fileTitle || 'Teacher Note'}|${c.pageStart || 1}`;
    if (!seenSourceKeys.has(k)) {
      seenSourceKeys.add(k);
      uniqueSourceBadges.push(`${c.fileTitle || 'Teacher Note'}, Page ${c.pageStart || 1}`);
    }
  }
  const citationNotice = uniqueSourceBadges.length > 0
    ? `*(Grounded in ${uniqueSourceBadges.slice(0, 3).join(' · ')})*`
    : `*(Official University Syllabus Topic — Supplemental Explanation)*`;

  parts.push(`### Step ${currentIdx} of ${total}: ${step.topicTitle || step.topic_title} ${citationNotice}\n`);

  // 4. Micro-topic Core Explanation + Compiled KAIE Extracted Items
  parts.push(generateConceptPedagogy(step, isRemediation, lessonBundle));

  // 5. Past Year Question (PYQ) Exam Spotlight
  const pyqs = Array.isArray(step.pyqMatches) ? step.pyqMatches : safeJsonParse(step.pyq_matches_json, []);
  if (pyqs.length > 0) {
    const topPyq = pyqs[0];
    const pyqCardBlock = {
      examTitle: `GANDAKI UNIVERSITY · ${topPyq.examYear || 'PAST EXAM'} ${topPyq.examType || 'FINAL EXAM'}`,
      questionNumber: `Q.${topPyq.questionNumber || '1'}`,
      marks: `${topPyq.marks || 5} MARKS`,
      questionText: topPyq.cleanText || topPyq.questionText || topPyq.question_text,
      teacherNoteReference: citations.length > 0 ? `${citations[0].fileTitle} (Page ${citations[0].pageStart})` : `Unit ${session.unit_number || session.unitNumber || 1} Lecture Notes`,
      callToAction: 'Practice writing a full-marks exam answer for this past question'
    };
    parts.push('\n```pyq_card\n' + JSON.stringify(pyqCardBlock, null, 2) + '\n```\n');
  }

  // 6. Socratic Checkpoint
  const checkpoint = step.checkpointQuestion || step.checkpoint_question || generateCheckpointQuestion(step);
  parts.push(`\n**🎯 Checkpoint Question:**\n${checkpoint}`);

  return parts.join('\n');
}

/**
 * Formats extracted KAIE knowledge items (definitions, formulas, examples, diagrams, conflicts)
 * with explicit file and page citations so teacher material is directly woven into the lesson.
 */
function formatKaieBundleSection(lessonBundle) {
  if (!lessonBundle) return '';
  const blocks = [];

  if (Array.isArray(lessonBundle.definitions) && lessonBundle.definitions.length > 0) {
    const defLines = lessonBundle.definitions.slice(0, 3).map((d) =>
      `- **${d.title || 'Definition'}:** ${d.content} *(${d.fileTitle}, Page ${d.pageStart})*`
    );
    blocks.push(`#### Key Definitions from Your Teacher's Notes\n${defLines.join('\n')}`);
  }

  if (Array.isArray(lessonBundle.formulas) && lessonBundle.formulas.length > 0) {
    const eqLines = lessonBundle.formulas.slice(0, 3).map((f) =>
      `- ${f.content} *(${f.fileTitle}, Page ${f.pageStart})*`
    );
    blocks.push(`#### Formulas & Rules\n${eqLines.join('\n')}`);
  }

  if (Array.isArray(lessonBundle.examples) && lessonBundle.examples.length > 0) {
    const exParts = lessonBundle.examples.slice(0, 2).map((ex) => {
      const lang = ex.metadata?.language || (ex.type === 'code_example' ? 'code' : '');
      if (ex.type === 'code_example') {
        return `**${ex.title || 'Practical Code Example'}** *(${ex.fileTitle}, Page ${ex.pageStart})*:\n\`\`\`${lang}\n${ex.content}\n\`\`\``;
      }
      return `- **${ex.title || 'Worked Example'}:** ${ex.content} *(${ex.fileTitle}, Page ${ex.pageStart})*`;
    });
    blocks.push(`#### Practical & Worked Examples\n${exParts.join('\n\n')}`);
  }

  if (Array.isArray(lessonBundle.diagrams) && lessonBundle.diagrams.length > 0) {
    const diagLines = lessonBundle.diagrams.slice(0, 2).map((dg) =>
      `- **${dg.title || 'Diagram'}:** ${dg.content} *(${dg.fileTitle}, Page ${dg.pageStart})*`
    );
    blocks.push(`#### Visual & Diagram Breakdown\n${diagLines.join('\n')}`);
  }

  if (Array.isArray(lessonBundle.conflicts) && lessonBundle.conflicts.length > 0) {
    const confLines = lessonBundle.conflicts.map((c) =>
      `> **Note on Uploaded Sources:** ${c.summary}`
    );
    blocks.push(confLines.join('\n'));
  }

  return blocks.join('\n\n');
}

/**
 * Synthesizes pedagogical explanation for a micro-topic, combining built-in visual analogies
 * with compiled KAIE teacher-uploaded definitions, formulas, code examples, and note excerpts.
 */
function generateConceptPedagogy(step, isRemediation = false, lessonBundle = null) {
  const title = (step.topicTitle || step.topic_title || '').toLowerCase();
  const bundleSupplement = formatKaieBundleSection(lessonBundle);

  if (title.includes('adt') || title.includes('abstract data type')) {
    const base = isRemediation
      ? [
          `Think of an **Abstract Data Type (ADT)** like an **ATM or a Smartphone**:`,
          `- As a user, you know **what** buttons to press (\`withdraw()\`, \`checkBalance()\`).`,
          `- You do **not** need to know the internal circuit wiring, database queries, or currency roller motors inside the ATM machine.`,
          ``,
          `In Data Structures:`,
          `1. **ADT Definition:** Specifies the mathematical concept and public operations (e.g. \`insert()\`, \`delete()\`, \`search()\`).`,
          `2. **Implementation:** How we actually code it using C structures (\`struct Node\`) and pointer memory addresses.`
        ].join('\n')
      : [
          `An **Abstract Data Type (ADT)** is a mathematical model for data types where a data type is defined by its **behavior (semantics)** from the user's perspective, rather than its memory representation.`,
          ``,
          `#### Key Principles:`,
          `- **Data Encapsulation & Abstraction:** Users interact only with allowed operations (\`insert()\`, \`delete()\`, \`search()\`, \`isEmpty()\`).`,
          `- **Separation of Interface and Implementation:** The interface guarantees *what* operations do, while the implementation details (using arrays or linked nodes) remain hidden.`,
          `- **Linked List as an ADT:** A Linked List is an ADT that represents a linear sequence of elements where each element is stored in an independent node dynamically allocated in heap memory.`
        ].join('\n');
    return bundleSupplement ? `${base}\n\n${bundleSupplement}` : base;
  }

  if (title.includes('singly linked list') && (title.includes('insert') || title.includes('representation'))) {
    const base = [
      `A **Singly Linked List** is a linear collection of data elements called **nodes**, where each node contains:`,
      `1. **Data Field:** The actual value or payload.`,
      `2. **Next Pointer:** A pointer storing the memory address of the next node in sequence (or \`NULL\` at the end).`,
      ``,
      '```c',
      'struct Node {',
      '    int data;',
      '    struct Node* next;',
      '};',
      '```',
      ``,
      `#### Insertion at Beginning ($O(1)$ Time):`,
      `1. Allocate memory for the new node: \`struct Node* newNode = (struct Node*)malloc(sizeof(struct Node));\``,
      `2. Assign data: \`newNode->data = val;\``,
      `3. Point new node to current head: \`newNode->next = head;\``,
      `4. Update head to point to new node: \`head = newNode;\``,
      ``,
      '```diagram',
      'graph LR',
      '  NewNode[newNode: data | next] --> HeadNode[head: Node 1]',
      '  HeadNode --> Node2[Node 2]',
      '  Node2 --> NULL[NULL]',
      '```'
    ].join('\n');
    return bundleSupplement ? `${base}\n\n${bundleSupplement}` : base;
  }

  if (title.includes('malloc') || title.includes('dynamic memory')) {
    const base = [
      `In C, static arrays require a fixed size known at compile time. Linked lists achieve dynamic sizing using **Dynamic Memory Allocation** from the **Heap** via \`malloc()\`.`,
      ``,
      `#### Node Allocation Mechanics:`,
      '```c',
      'struct Node* newNode = (struct Node*)malloc(sizeof(struct Node));',
      'if (newNode == NULL) {',
      '    printf("Memory Allocation Failed! Heap exhausted.\\n");',
      '    return;',
      '}',
      '```',
      `- \`sizeof(struct Node)\` calculates the exact number of bytes needed for \`int data\` (4 bytes) + \`struct Node* next\` (8 bytes on 64-bit systems) = 12 to 16 bytes.`,
      `- \`malloc()\` returns a \`void*\` address, which is cast to \`struct Node*\`.`
    ].join('\n');
    return bundleSupplement ? `${base}\n\n${bundleSupplement}` : base;
  }

  if (title.includes('revers') || title.includes('reverse')) {
    const base = [
      `Reversing a singly linked list means flipping the direction of all \`next\` pointers so that the tail node becomes the new head and the original head points to \`NULL\`.`,
      ``,
      `#### The 3-Pointer Iterative Technique ($O(n)$ Time, $O(1)$ Auxiliary Space):`,
      '```c',
      'struct Node* reverseList(struct Node* head) {',
      '    struct Node* prev = NULL;',
      '    struct Node* current = head;',
      '    struct Node* next = NULL;',
      '    while (current != NULL) {',
      '        next = current->next;  // 1. Save next node',
      '        current->next = prev;  // 2. Reverse current pointer',
      '        prev = current;        // 3. Move prev forward',
      '        current = next;        // 4. Move current forward',
      '    }',
      '    return prev;               // New head',
      '}',
      '```'
    ].join('\n');
    return bundleSupplement ? `${base}\n\n${bundleSupplement}` : base;
  }

  if (title.includes('css') || title.includes('cascading style sheet') || title.includes('levels of style') || title.includes('where you can add') || title.includes('style specification') || title === 'introduction') {
    if (isRemediation) {
      const remBase = [
        `Think of building a website like building a **house**:`,
        `- **HTML = Structure** (walls, doors, rooms — without CSS, it's just plain grey concrete).`,
        `- **CSS = Appearance** (paint, furniture, decoration).`,
        `- **JavaScript = Behaviour** (automatic doors, lights, interactions).`,
        ``,
        `#### The 3 ways to add CSS (from quickest to cleanest):`,
        `1. **Inline** (right inside an HTML tag): \`<p style="color: red;">Hello</p>\` — quick for testing, messy for real apps.`,
        `2. **Internal** (inside \`<style>\` in \`<head>\`): styles one single HTML page.`,
        `3. **External** (a separate \`style.css\` file): \`<link rel="stylesheet" href="style.css">\` — **best for real projects** because one file can style your entire website!`
      ].join('\n');
      return bundleSupplement ? `${remBase}\n\n${bundleSupplement}` : remBase;
    }
    const cssBase = [
      `Think of building a website like building a **house**:`,
      `- **HTML** = Structure (walls, doors, rooms).`,
      `- **CSS** = Appearance (paint, furniture, decoration).`,
      `- **JavaScript** = Behaviour (automatic doors, lights, interactions).`,
      ``,
      `#### 1. What exactly is CSS?`,
      `**CSS** stands for **Cascading Style Sheets**. It is the language that controls how HTML elements look and how they are arranged on a webpage.`,
      ``,
      `Imagine you write this HTML:`,
      '```html',
      '<h1>Hello!</h1>',
      '<p>Welcome to my website.</p>',
      '```',
      `By default, the browser shows plain black text on a white background. But what if you want:`,
      `- The heading to be **red**?`,
      `- The text to be **centered**?`,
      `- The paragraph to be **bigger**?`,
      ``,
      `**HTML defines what something is. CSS defines how it looks.**`,
      ``,
      `#### 2. Your first CSS rule`,
      '```css',
      'h1 {',
      '    color: red;',
      '    font-size: 40px;',
      '    text-align: center;',
      '}',
      '```',
      `Let's break down the anatomy of a CSS rule:`,
      `- **Selector (\`h1\`):** Which HTML element should be styled?`,
      `- **Property (\`color\`, \`font-size\`):** What aspect do you want to change?`,
      `- **Value (\`red\`, \`40px\`):** What should that property become?`,
      `- **Declaration:** A property and its value together (e.g., \`color: red;\`).`,
      ``,
      `#### 3. Where can you write CSS?`,
      `1. **Inline CSS** — directly inside an HTML tag (good for quick tests, avoid in big projects):`,
      '```html',
      '<h1 style="color: red;">Hello World</h1>',
      '```',
      `2. **Internal CSS** — inside a \`<style>\` tag in the \`<head>\`:`,
      '```html',
      '<head>',
      '    <style>',
      '        h1 { color: blue; }',
      '    </style>',
      '</head>',
      '```',
      `3. **External CSS (Recommended)** — in a separate \`style.css\` file linked from HTML so one stylesheet controls multiple pages:`,
      '```html',
      '<link rel="stylesheet" href="style.css">',
      '```',
      ``,
      `#### 4. Try to understand it visually`,
      '```live_demo\n' + JSON.stringify({
        title: 'CSS Live Concept Demonstration',
        subtitle: 'Change the stylesheet to see how CSS affects the exact same HTML',
        caption: 'The HTML content stays the same. Only CSS changes.',
        html: '<h1>Hello World!</h1><p>Welcome to my first webpage.</p><button>Click me</button>',
        variants: [
          {
            label: 'Default',
            css: 'body{font-family:Georgia,serif;background:#ffffff;color:#111111;} h1{font-size:22px;margin:0 0 8px;} p{margin:0 0 12px;} button{padding:4px 10px;}'
          },
          {
            label: 'Modern',
            css: 'body{font-family:-apple-system,sans-serif;background:#f8fafc;color:#0f172a;text-align:center;} h1{color:#2563eb;font-size:24px;margin:0 0 6px;} p{color:#475569;margin:0 0 14px;} button{background:#2563eb;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:600;}'
          },
          {
            label: 'Dark',
            css: 'body{font-family:system-ui,sans-serif;background:#09090b;color:#f4f4f5;text-align:center;} h1{color:#ffffff;font-size:24px;margin:0 0 6px;letter-spacing:-0.02em;} p{color:#a1a1aa;margin:0 0 14px;} button{background:#ffffff;color:#09090b;border:none;padding:8px 18px;border-radius:999px;font-weight:700;}'
          }
        ]
      }, null, 2) + '\n```'
    ].join('\n');
    return bundleSupplement ? `${cssBase}\n\n${bundleSupplement}` : cssBase;
  }

  // Dynamic KAIE-grounded synthesis for any topic across all 45 BIT courses
  const dynamicSections = [];
  dynamicSections.push(`Let's master **${step.topicTitle || step.topic_title}** step by step.`);

  if (lessonBundle && lessonBundle.coverageStatus === 'MISSING_NOTES') {
    dynamicSections.push(
      `> *Note: This topic is part of the official university syllabus, but no teacher notes have been uploaded for it yet. Below is a supplemental academic explanation aligned to your BIT curriculum.*`
    );
  }

  if (lessonBundle && Array.isArray(lessonBundle.noteChunks) && lessonBundle.noteChunks.length > 0) {
    const chunkLines = lessonBundle.noteChunks.slice(0, 2).map((ch) => {
      const cleaned = String(ch.clean_content || '').replace(/^#{1,6}\s+[^\n]+\n?/, '').trim().slice(0, 600);
      return `${cleaned}\n*(Source: ${ch.file_title || 'Teacher Note'}, Page ${ch.page_start || 1})*`;
    });
    dynamicSections.push(`#### Core Explanation from Your Course Materials\n${chunkLines.join('\n\n')}`);
  } else {
    const citations = Array.isArray(step.noteCitations) ? step.noteCitations : safeJsonParse(step.note_citations_json, []);
    const snippets = citations.filter((c) => c.snippet).slice(0, 2);
    if (snippets.length > 0) {
      dynamicSections.push(
        `#### Core Explanation from Your Course Materials\n` +
        snippets.map((s) => `${s.snippet}\n*(Source: ${s.fileTitle || 'Teacher Note'}, Page ${s.pageStart || 1})*`).join('\n\n')
      );
    }
  }

  if (bundleSupplement) {
    dynamicSections.push(bundleSupplement);
  }

  if (dynamicSections.length === 1) {
    dynamicSections.push(
      `#### What it is in simple words:\n` +
      `- **Core Idea:** Understand *why* **${step.topicTitle || step.topic_title}** is used before memorizing definitions.\n` +
      `- **How it works:** Trace how inputs transform step-by-step and note key boundary conditions.\n` +
      `- **Exam Tip:** Always include a clear definition and a concise example or diagram in university exams.`
    );
  }

  return dynamicSections.join('\n\n');
}

/**
 * Evaluates student answer to checkpoint and determines whether to advance or remediate.
 */
function evaluateCheckpointReply(studentAnswer, currentTopic, checkpointQuestion) {
  const rawAns = String(studentAnswer || '').trim();
  const coreAns = rawAns
    .replace(/^(?:i\s+said|it\s+is|it's|its|the\s+answer\s+is|answer\s+is|answer|i\s+think(?:\s+it's|\s+it\s+is)?|maybe|probably)\s+/i, '')
    .replace(/[?.!`"']+$/g, '')
    .replace(/^[`"']+/g, '')
    .trim();
  const normAns = normalizeText(coreAns || rawAns);
  const title = (currentTopic.topicTitle || currentTopic.topic_title || '').toLowerCase();

  if (/^(?:yes|correct|done|got it|makes sense|clear|ha|bujhe|thik cha)$/i.test(rawAns)) {
    return {
      passed: true,
      feedback: 'Excellent! You’ve nailed this core concept. Let’s advance to the next micro-topic.'
    };
  }

  if (checkpointQuestion && coreAns) {
    const qLower = String(checkpointQuestion).toLowerCase();
    const coreLower = coreAns.toLowerCase();
    const cssRuleMatch = String(checkpointQuestion).match(/`([^`]+)\{([^}]+)\}`/);
    if (cssRuleMatch) {
      const selectorToken = cssRuleMatch[1].trim().toLowerCase();
      const declBody = cssRuleMatch[2].trim().toLowerCase();
      if (qLower.includes('selector') && (coreLower === selectorToken || coreLower === `${selectorToken} tag` || coreLower === `<${selectorToken}>`)) {
        return {
          passed: true,
          feedback: `Spot on! \`${selectorToken}\` is the Selector — it tells CSS which HTML element to style.`
        };
      }
      if (qLower.includes('property') && declBody.includes(`${coreLower}:`)) {
        return {
          passed: true,
          feedback: `Exactly right! \`${coreLower}\` is the Property being changed.`
        };
      }
      if (qLower.includes('value') && new RegExp(`:\\s*${coreLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(declBody)) {
        return {
          passed: true,
          feedback: `Spot on! \`${coreLower}\` is the Value applied to the property.`
        };
      }
    }
    const backtickTokens = [...String(checkpointQuestion).matchAll(/`([^`]{1,30})`/g)].map((m) => m[1].trim().toLowerCase());
    if (coreLower.length >= 1 && backtickTokens.some((tok) => tok === coreLower)) {
      return {
        passed: true,
        feedback: `Exactly right! \`${coreAns}\` is spot on. Let’s move to the next step.`
      };
    }
  }

  if (title.includes('adt')) {
    if (normAns.includes('what') || normAns.includes('how') || normAns.includes('implementation') || normAns.includes('interface') || normAns.includes('hiding') || normAns.includes('user')) {
      return {
        passed: true,
        feedback: 'Spot on! ADTs define the interface (what operations can be performed) while abstracting away the internal implementation (how data is physically stored in memory).'
      };
    }
  }

  if (title.includes('singly') && title.includes('insert')) {
    if (normAns.includes('newnode') || normAns.includes('next') || normAns.includes('lose') || normAns.includes('head')) {
      return {
        passed: true,
        feedback: 'Exactly right! Updating `newNode->next = head` first ensures we don’t orphan the rest of the list before moving `head`.'
      };
    }
  }

  if (title.includes('revers')) {
    if (normAns.includes('prev') || normAns.includes('current') || normAns.includes('next') || normAns.includes('lose') || normAns.includes('pointer')) {
      return {
        passed: true,
        feedback: 'Perfect! The three pointers allow us to flip the link while preserving the forward address to traverse the remaining chain.'
      };
    }
  }

  if (title.includes('css') || title.includes('cascading style sheet') || title.includes('levels of style') || title.includes('style specification')) {
    if (normAns.includes('external') || normAns.includes('inline') || normAns.includes('internal') || normAns.includes('link') || normAns.includes('head')) {
      return {
        passed: true,
        feedback: 'Spot on! Inline, Internal, and External are the 3 levels. External stylesheets keep code modular and allow a single file to style an entire website.'
      };
    }
    if (normAns.includes('green') || normAns.includes('id') || normAns.includes('specificity') || normAns.includes('priority')) {
      return {
        passed: true,
        feedback: 'Exactly right! ID selectors (#main) carry higher specificity than class selectors (.highlight), so green wins.'
      };
    }
    if (normAns.includes('inside') || normAns.includes('outside') || normAns.includes('border') || normAns.includes('space')) {
      return {
        passed: true,
        feedback: 'Perfect! Padding creates breathing room inside the element around content, while margin pushes adjacent elements away on the outside.'
      };
    }
    if (normAns.includes('structure') || normAns.includes('presentation') || normAns.includes('style') || normAns.includes('separation')) {
      return {
        passed: true,
        feedback: 'Excellent! HTML handles semantic structure while CSS handles presentation, keeping the code clean and maintainable.'
      };
    }
  }

  const wordCount = coreAns.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 3) {
    return {
      passed: true,
      feedback: 'Great response! You’ve demonstrated clear comprehension of this concept.'
    };
  }

  return {
    passed: false,
    feedback: 'Not quite, but you’re on the right track! Let’s clarify this subtle point before moving forward.'
  };
}

/**
 * Builds the system prompt for LLM-powered adaptive teaching when a provider is configured.
 * Grounds the lesson in the compiled KAIE topic bundle (definitions, formulas, examples, diagrams, note chunks).
 */
function buildStudyPartnerLlmPrompt({
  session,
  step,
  topics,
  noteChunks = [],
  lessonBundle = null,
  isRemediation = false,
  studentAnswerEvaluation = null,
  languageInstruction = 'Reply in simple, crystal-clear everyday English.'
}) {
  const total = (topics && topics.length) || 1;
  const currentIdx = step.stepIndex || step.step_index || 1;
  const topicTitle = step.topicTitle || step.topic_title || 'Topic';

  const effectiveChunks = (lessonBundle && Array.isArray(lessonBundle.noteChunks) && lessonBundle.noteChunks.length > 0)
    ? lessonBundle.noteChunks
    : (noteChunks || []);

  const noteContext = effectiveChunks
    .slice(0, 3)
    .map((c, idx) => `[Note Excerpt ${idx + 1} — ${c.file_title || 'Teacher Note'}, Page ${c.page_start || 1}]:\n${String(c.clean_content || '').slice(0, 1200)}`)
    .join('\n\n');

  const kaieStructuredParts = [];
  if (lessonBundle) {
    if (lessonBundle.coverageStatus === 'MISSING_NOTES') {
      kaieStructuredParts.push(
        `COVERAGE STATUS: MISSING_NOTES — This topic is in the official university syllabus, but no teacher notes cover it yet. Teach it clearly using standard academic knowledge while explicitly mentioning that it is a supplemental explanation for an official syllabus topic.`
      );
    }
    if (Array.isArray(lessonBundle.definitions) && lessonBundle.definitions.length > 0) {
      kaieStructuredParts.push(
        `EXTRACTED DEFINITIONS:\n` +
        lessonBundle.definitions.map((d) => `- ${d.content} (${d.fileTitle}, Page ${d.pageStart})`).join('\n')
      );
    }
    if (Array.isArray(lessonBundle.formulas) && lessonBundle.formulas.length > 0) {
      kaieStructuredParts.push(
        `EXTRACTED FORMULAS & EQUATIONS:\n` +
        lessonBundle.formulas.map((f) => `- ${f.content} (${f.fileTitle}, Page ${f.pageStart})`).join('\n')
      );
    }
    if (Array.isArray(lessonBundle.examples) && lessonBundle.examples.length > 0) {
      kaieStructuredParts.push(
        `EXTRACTED WORKED & CODE EXAMPLES:\n` +
        lessonBundle.examples.map((e) => `- [${e.title}] ${e.content} (${e.fileTitle}, Page ${e.pageStart})`).join('\n')
      );
    }
    if (Array.isArray(lessonBundle.diagrams) && lessonBundle.diagrams.length > 0) {
      kaieStructuredParts.push(
        `EXTRACTED DIAGRAMS:\n` +
        lessonBundle.diagrams.map((dg) => `- [${dg.title}] ${dg.content} (${dg.fileTitle}, Page ${dg.pageStart})`).join('\n')
      );
    }
    if (Array.isArray(lessonBundle.conflicts) && lessonBundle.conflicts.length > 0) {
      kaieStructuredParts.push(
        `CROSS-FILE CONFLICT NOTICE (Mention both sources transparently to the student):\n` +
        lessonBundle.conflicts.map((c) => `- ${c.summary}`).join('\n')
      );
    }
  }

  const feedbackNote = studentAnswerEvaluation?.feedback
    ? `Student Answer Feedback to weave in warmly at the top: "${studentAnswerEvaluation.feedback}"`
    : '';
  const remediationNote = isRemediation
    ? 'REMEDIATION MODE: The student is confused or asked for a simpler explanation. Use a fresh, super simple everyday analogy and step-by-step breakdown.'
    : '';

  return `You are Kyana, a warm, patient BIT senior study partner teaching a student from scratch — assume they know NOTHING about this topic yet.

LANGUAGE: ${languageInstruction}

ACTIVE STUDY CONTEXT:
- Course: ${session.subject_code || 'CIT'} · ${session.subject} (Semester ${session.semester_no || 1})
- Unit: Unit ${session.unit_number || 1} — ${session.chapter_title}
- Current Micro-Topic (Step ${currentIdx} of ${total}): ${topicTitle}
${feedbackNote}
${remediationNote}

TEACHING RULES (7-STEP STUDY PARTNER LOOP):
1. Teach ONLY this single micro-topic ("${topicTitle}") in depth — do NOT dump the whole chapter at once.
2. Start with a relatable real-world analogy (like building a house for HTML/CSS/JS, or a train/chain for Linked Lists) so a complete beginner immediately gets it.
3. Explain in plain, everyday words first, then introduce technical terms cleanly (e.g., Selector, Property, Value, Declaration), citing the teacher's file title and page number when using extracted definitions or examples.
4. Show concrete, easy-to-follow code examples or worked steps with "before & after" or anatomy breakdowns.
5. If teaching web/CSS/HTML concepts, include ONE interactive \`\`\`live_demo JSON block so the student can click buttons (e.g. Default / Modern / Dark) and see the concept live! Format:
\`\`\`live_demo
{"title":"...","subtitle":"...","caption":"...","html":"<h1>...</h1><p>...</p><button>...</button>","variants":[{"label":"Default","css":"..."},{"label":"Modern","css":"..."},{"label":"Dark","css":"..."}]}
\`\`\`
6. End with ONE short, friendly **🎯 Checkpoint Question** to test their understanding before moving to the next step (they can reply with their answer, or say "next", or "explain simpler").
7. NEVER write "This is extracted from..." or output raw JSON for \`study_session\` or \`pyq_card\` (the server prepends/appends those cards automatically).
8. At the VERY END of your response (after the checkpoint question), optionally include a \`<kyana_actions>\` JSON block for interactive UI buttons (2–4 concise actions using ONLY allowed action names: \`continue_lesson\`, \`explain_example\`, \`explain_again\`, \`practice_concept\`, \`take_quiz\`, \`try_harder_question\`, \`ask_followup\`). If you include a multiple-choice quiz in \`mcq\`, NEVER reveal \`correctOptionId\` in your prose. Example:
<kyana_actions>{"actions":[{"id":"next","label":"Next concept →","action":"continue_lesson","actionType":"next_step"},{"id":"ex","label":"Give another example","action":"explain_example","actionType":"quick_reply"},{"id":"prac","label":"Practice this concept","action":"practice_concept","actionType":"practice"}]}</kyana_actions>

COMPILED KAIE KNOWLEDGE GRAPH & TEACHER RESOURCES:
${kaieStructuredParts.join('\n\n')}

${noteContext || 'No specific PDF chunk matched this micro-topic; teach clearly according to the official Gandaki University BIT syllabus.'}`;
}

module.exports = {
  startOrResumeStudySession,
  advanceStudySessionStep,
  evaluateStudentIntent,
  generateCheckpointQuestion,
  buildCompiledTopicLessonBundle,
  renderMicroTopicTurn,
  generateConceptPedagogy,
  evaluateCheckpointReply,
  buildStudyPartnerLlmPrompt
};
