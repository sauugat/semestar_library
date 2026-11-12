'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const { buildReconciledStudyPlan } = require('./study-partner-reconciler');
const { searchPyqQuestions } = require('./pyq-intelligence');
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

  // Check if an existing ACTIVE session matches this student, subject, and unit
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

    // Self-heal stale/corrupt session from before reconciler heading filter
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
    unitNumber
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

  // Populate per-step topic progress
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
      syllabusRef: step.syllabusRef,
      noteCitations: step.noteCitations,
      pyqMatches: step.pyqMatches,
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

  // Update current topic progress
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

  // Count total mastered steps
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
    // Set next topic to IN_PROGRESS
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

  // 1. Advance directly
  if (
    /^(?:next|continue|move on|move to next|proceed|go ahead|understood|got it|bujhe|bujhiyo|next topic|next subtopic|skip|let's go|aagi badham)$/i.test(lower) ||
    lower.includes('next topic') ||
    lower.includes('agadi badham') ||
    lower.includes('move to next')
  ) {
    return { intent: 'advance_directly', confidence: 0.95 };
  }

  // 2. Confused / remediation request
  if (
    /^(?:bujhina|confused|lost|feri bujhaideu|explain simpler|give example|simpler analogy|gahro vo|didn't get it|dont understand|can you explain again)$/i.test(lower) ||
    lower.includes('bujhina') ||
    lower.includes('simpler example') ||
    lower.includes('explain again') ||
    lower.includes('confused')
  ) {
    return { intent: 'remediate', confidence: 0.92 };
  }

  // 3. PYQ request
  if (
    lower.includes('pyq') ||
    lower.includes('past question') ||
    lower.includes('exam question') ||
    lower.includes('solve pyq') ||
    lower.includes('show exam question')
  ) {
    return { intent: 'practice_pyq', confidence: 0.9 };
  }

  // 4. Quiz request
  if (
    lower.includes('quiz me') ||
    lower.includes('test me') ||
    lower.includes('ask me a question')
  ) {
    return { intent: 'quiz', confidence: 0.88 };
  }

  // 5. Checkpoint answer attempt
  return {
    intent: 'answer_attempt',
    confidence: 0.8,
    answerText: text
  };
}

/**
 * Formulates a Socratic checkpoint question tailored to a micro-topic.
 */
function generateCheckpointQuestion(step) {
  const title = step.topicTitle || 'this concept';
  const lower = title.toLowerCase();

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
 * Teaches a single micro-topic in depth with teacher note citations, visual blocks, and PYQ alert.
 */
function renderMicroTopicTurn({
  session,
  step,
  topics,
  isRemediation = false,
  studentAnswerEvaluation = null
}) {
  const total = topics.length || 1;
  const currentIdx = step.stepIndex || 1;
  const pct = Math.round(((currentIdx - 1) / total) * 100);

  const parts = [];

  // 1. Interactive Study Session Visual Block (Monochrome Charcoal Progress Header)
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
      sourceBadge: (t.sourceOrigin || t.source_origin) === 'note_exclusive' ? 'PDF Extra' : 'Syllabus + Note',
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

  // 3. Lesson Body: Grounded in Teacher's Note Chunks & Syllabus
  const citations = Array.isArray(step.noteCitations) ? step.noteCitations : safeJsonParse(step.note_citations_json, []);
  const citationNotice = citations.length > 0
    ? `*(Grounded in ${citations[0].fileTitle || 'Teacher Note'}, Page ${citations[0].pageStart || 1})*`
    : `*(Official Syllabus Topic)*`;

  parts.push(`### Step ${currentIdx} of ${total}: ${step.topicTitle || step.topic_title} ${citationNotice}\n`);

  // Micro-topic Core Explanation
  parts.push(generateConceptPedagogy(step, isRemediation));

  // 4. Past Year Question (PYQ) Exam Spotlight
  const pyqs = Array.isArray(step.pyqMatches) ? step.pyqMatches : safeJsonParse(step.pyq_matches_json, []);
  if (pyqs.length > 0) {
    const topPyq = pyqs[0];
    const pyqCardBlock = {
      examTitle: `GANDAKI UNIVERSITY · ${topPyq.examYear || 'PAST EXAM'} ${topPyq.examType || 'FINAL EXAM'}`,
      questionNumber: `Q.${topPyq.questionNumber || '1'}`,
      marks: `${topPyq.marks || 5} MARKS`,
      questionText: topPyq.cleanText || topPyq.questionText || topPyq.question_text,
      teacherNoteReference: citations.length > 0 ? `${citations[0].fileTitle} (Page ${citations[0].pageStart})` : 'Unit 2 Lecture Notes',
      callToAction: 'Practice writing a full-marks exam answer for this past question'
    };
    parts.push('\n```pyq_card\n' + JSON.stringify(pyqCardBlock, null, 2) + '\n```\n');
  }

  // 5. Socratic Checkpoint
  const checkpoint = step.checkpointQuestion || step.checkpoint_question || generateCheckpointQuestion(step);
  parts.push(`\n**🎯 Checkpoint Question:**\n${checkpoint}`);

  return parts.join('\n');
}

/**
 * Synthesizes pedagogical explanation for a micro-topic.
 */
function generateConceptPedagogy(step, isRemediation = false) {
  const title = (step.topicTitle || step.topic_title || '').toLowerCase();

  if (title.includes('adt') || title.includes('abstract data type')) {
    if (isRemediation) {
      return [
        `Think of an **Abstract Data Type (ADT)** like an **ATM or a Smartphone**:`,
        `- As a user, you know **what** buttons to press (\`withdraw()\`, \`checkBalance()\`).`,
        `- You do **not** need to know the internal circuit wiring, database queries, or currency roller motors inside the ATM machine.`,
        ``,
        `In Data Structures:`,
        `1. **ADT Definition:** Specifies the mathematical concept and public operations (e.g. \`insert()\`, \`delete()\`, \`search()\`).`,
        `2. **Implementation:** How we actually code it using C structures (\`struct Node\`) and pointer memory addresses.`
      ].join('\n');
    }
    return [
      `An **Abstract Data Type (ADT)** is a mathematical model for data types where a data type is defined by its **behavior (semantics)** from the user's perspective, rather than its memory representation.`,
      ``,
      `#### Key Principles:`,
      `- **Data Encapsulation & Abstraction:** Users interact only with allowed operations (\`insert()\`, \`delete()\`, \`search()\`, \`isEmpty()\`).`,
      `- **Separation of Interface and Implementation:** The interface guarantees *what* operations do, while the implementation details (using arrays or linked nodes) remain hidden.`,
      `- **Linked List as an ADT:** A Linked List is an ADT that represents a linear sequence of elements where each element is stored in an independent node dynamically allocated in heap memory.`
    ].join('\n');
  }

  if (title.includes('singly linked list') && (title.includes('insert') || title.includes('representation'))) {
    return [
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
  }

  if (title.includes('malloc') || title.includes('dynamic memory')) {
    return [
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
  }

  if (title.includes('revers') || title.includes('reverse')) {
    return [
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
  }

  if (title.includes('css') || title.includes('cascading style sheet') || title.includes('levels of style') || title.includes('where you can add') || title.includes('style specification') || title === 'introduction') {
    if (isRemediation) {
      return [
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
    }
    return [
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
  }

  // Generalized fallback
  return [
    `Let's learn **${step.topicTitle || step.topic_title}** step by step from the basics.`,
    ``,
    `#### What it is in simple words:`,
    `- **Core Idea:** Understand *why* this concept exists before memorizing definitions.`,
    `- **How it works:** Pay attention to how inputs transform step-by-step and any edge cases.`,
    `- **Exam Tip:** Practice writing a short example or dry run from your teacher's notes.`
  ].join('\n');
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

  // Short affirmative keywords
  if (/^(?:yes|correct|done|got it|makes sense|clear|ha|bujhe|thik cha)$/i.test(rawAns)) {
    return {
      passed: true,
      feedback: 'Excellent! You’ve nailed this core concept. Let’s advance to the next micro-topic.'
    };
  }

  // Context-aware check against the exact checkpoint question asked in the previous turn
  if (checkpointQuestion && coreAns) {
    const qLower = String(checkpointQuestion).toLowerCase();
    const coreLower = coreAns.toLowerCase();
    // If question asks about selector/property/value in a CSS rule like `p { color: red; }`
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
    // Generic backticked/quoted token match for short exact answers (e.g., `p`, `h1`, `head`, `NULL`, `O(1)`)
    const backtickTokens = [...String(checkpointQuestion).matchAll(/`([^`]{1,30})`/g)].map(m => m[1].trim().toLowerCase());
    if (coreLower.length >= 1 && backtickTokens.some(tok => tok === coreLower)) {
      return {
        passed: true,
        feedback: `Exactly right! \`${coreAns}\` is spot on. Let’s move to the next step.`
      };
    }
  }

  // Topic-specific keyword checks
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

  // Fallback: If student provided a thoughtful response of 3+ words, consider passed
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
 * Follows the 7-step Study Partner loop in simple, beginner-first language.
 */
function buildStudyPartnerLlmPrompt({
  session,
  step,
  topics,
  noteChunks = [],
  isRemediation = false,
  studentAnswerEvaluation = null,
  languageInstruction = 'Reply in simple, crystal-clear everyday English.'
}) {
  const total = (topics && topics.length) || 1;
  const currentIdx = step.stepIndex || step.step_index || 1;
  const topicTitle = step.topicTitle || step.topic_title || 'Topic';
  const noteContext = (noteChunks || [])
    .slice(0, 3)
    .map((c, idx) => `[Note Excerpt ${idx + 1} — ${c.file_title || 'Teacher Note'}, Page ${c.page_start || 1}]:\n${String(c.clean_content || '').slice(0, 1200)}`)
    .join('\n\n');

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
3. Explain in plain, everyday words first, then introduce technical terms cleanly (e.g., Selector, Property, Value, Declaration).
4. Show concrete, easy-to-follow code examples with "before & after" or anatomy breakdowns.
5. If teaching web/CSS/HTML concepts, include ONE interactive \`\`\`live_demo JSON block so the student can click buttons (e.g. Default / Modern / Dark) and see the concept live! Format:
\`\`\`live_demo
{"title":"...","subtitle":"...","caption":"...","html":"<h1>...</h1><p>...</p><button>...</button>","variants":[{"label":"Default","css":"..."},{"label":"Modern","css":"..."},{"label":"Dark","css":"..."}]}
\`\`\`
6. End with ONE short, friendly **🎯 Checkpoint Question** to test their understanding before moving to the next step (they can reply with their answer, or say "next", or "explain simpler").
7. NEVER write "This is extracted from..." or output raw JSON for \`study_session\` or \`pyq_card\` (the server prepends/appends those cards automatically).

TEACHER NOTES & SYLLABUS GROUNDING:
${noteContext || 'No specific PDF chunk matched this micro-topic; teach clearly according to the official Gandaki University BIT syllabus.'}`;
}

module.exports = {
  startOrResumeStudySession,
  advanceStudySessionStep,
  evaluateStudentIntent,
  generateCheckpointQuestion,
  renderMicroTopicTurn,
  evaluateCheckpointReply,
  buildStudyPartnerLlmPrompt
};
