'use strict';

/**
 * KYANA AGENT ENGINE V1
 * =====================
 * Intelligent, Context-Aware, Multi-Step Academic Agent for Semester Library.
 *
 * Implements:
 * 1. Intelligent Understanding Engine (English, Romanized Nepali, Devanagari Nepali, Mixed, Aliases, Follow-ups)
 * 2. Context Intelligence System (Authenticated user, role, semester, subjects, history entity tracking, Nepal clock)
 * 3. Dynamic Tool & Resource Discovery Registry (ACADEMIC, PERSONAL_RECORDS, INTELLIGENCE)
 * 4. Controlled Multi-Step Planning & Execution Loop:
 *    UNDERSTAND -> PLAN -> SELECT TOOLS -> EXECUTE -> OBSERVE -> REPLAN -> VERIFY -> RESPOND
 * 5. Deterministic Temporal & Calculation Intelligence (Asia/Kathmandu, AD/BS, deadlines, next exam, notice conflicts)
 * 6. Evidence & Answer Verification (No fabricated deadlines, dates, submissions, attendance, marks, or notices)
 * 7. Bounded Runtime & Reliability (Max iterations, max tool calls, duplicate prevention, timeout, error recovery)
 */

const {
  courses,
  SUBJECT_ALIASES,
  extractFilters,
  routeQuery,
  createTools,
  formatToolResult,
  mapsToBitSyllabus,
  academicRequest,
  parseSyllabusCourseDetails
} = require('./chat-tools');
const topics = require('./chat-topics');
const {
  getCurrentNepalDateTime,
  resolveCalendarDate,
  calculateDateDifference,
  calculateAssignmentDeadline,
  resolveNextExamination,
  compareAndResolveTemporalRecords,
  parseNepaliDateExpression,
  normalizeDevanagariDigits
} = require('./nepali-dates');
const {
  READ_ONLY_TOOLS,
  isOtherStudentDataRequest,
  resolveRequestedRecordOwner,
  buildScopeRefusal,
  verifyActionOrigin,
  sanitizeUntrustedValue
} = require('./chat-security');
const { detectLanguage } = require('./chat-personality');
const {
  classifyAcademicCategory,
  resolveSyllabusTopic,
  buildDeterministicAcademicStudyGuide,
  enrichReplyWithAcademicVisuals
} = require('./academic-intelligence');
const { searchAssignments, searchNotices, searchPosts } = require('./ai-search-tools');
const { buildResourceCard } = require('./kyana-cards');
const { revalidateCards } = require('./kyana-access');

// Bounded Runtime Constants
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_MAX_TOOL_CALLS = 10;
const DEFAULT_EXECUTION_TIMEOUT_MS = 20000;

// Extended subject alias lookup (case-insensitive)
const EXTENDED_SUBJECT_ALIASES = {
  dsa: 'Data Structure and Algorithms',
  'data structure': 'Data Structure and Algorithms',
  'data structures': 'Data Structure and Algorithms',
  'data structure and algorithms': 'Data Structure and Algorithms',
  'data structures and algorithms': 'Data Structure and Algorithms',
  dbms: 'Database Management System',
  database: 'Database Management System',
  'database management system': 'Database Management System',
  os: 'Operating Systems',
  'operating system': 'Operating Systems',
  'operating systems': 'Operating Systems',
  cn: 'Computer Networks',
  'computer network': 'Computer Networks',
  'computer networks': 'Computer Networks',
  networking: 'Computer Networks',
  oop: 'Object Oriented Programming',
  java: 'Object Oriented Programming',
  'object oriented programming': 'Object Oriented Programming',
  se: 'Software Engineering',
  'software engineering': 'Software Engineering',
  wt: 'Web Technology',
  'web tech': 'Web Technology',
  'web technology': 'Web Technology',
  'web technology ii': 'Web Technology II',
  wt2: 'Web Technology II',
  coa: 'Microprocessor and Computer Architecture',
  mpca: 'Microprocessor and Computer Architecture',
  microprocessor: 'Microprocessor and Computer Architecture',
  'computer architecture': 'Microprocessor and Computer Architecture',
  dl: 'Digital Logic',
  'digital logic': 'Digital Logic',
  c: 'C Programming',
  'c programming': 'C Programming',
  ai: 'Artificial Intelligence',
  'artificial intelligence': 'Artificial Intelligence',
  nm: 'Numerical Methods',
  'numerical methods': 'Numerical Methods',
  pom: 'Principles of Organization and Management',
  sad: 'System Analysis and Design',
  'system analysis and design': 'System Analysis and Design',
  cg: 'Computer Graphics',
  'computer graphics': 'Computer Graphics',
  crypto: 'Cryptography',
  cryptography: 'Cryptography',
  cc: 'Cloud Computing',
  'cloud computing': 'Cloud Computing',
  dwdm: 'Data Warehousing and Data Mining',
  'data mining': 'Data Warehousing and Data Mining'
};

/**
 * Resolves a subject or topic string to a canonical BIT subject, course code, semester, and syllabus unit.
 */
function resolveAcademicEntity(input, enrolledSemester = null) {
  const raw = String(input || '').trim();
  if (!raw) return { matched: false, subject: null, code: null, semester: enrolledSemester || null, unit: null, topic: null };

  const lower = normalizeDevanagariDigits(raw).toLowerCase();

  // 1. Check direct extractFilters from chat-tools
  const extracted = extractFilters(raw);
  if (extracted.subject) {
    const matchedCourse = courses.find(c =>
      c.title.toLowerCase() === extracted.subject.toLowerCase() &&
      (!enrolledSemester || Number(c.semester) === Number(enrolledSemester))
    ) || courses.find(c => c.title.toLowerCase() === extracted.subject.toLowerCase());

    const topicMatch = resolveSyllabusTopic(raw);
    return {
      matched: true,
      subject: matchedCourse ? matchedCourse.title : extracted.subject,
      code: matchedCourse ? matchedCourse.code : (topicMatch?.courseCode || null),
      semester: extracted.semester || (matchedCourse ? Number(matchedCourse.semester) : enrolledSemester),
      unit: extracted.unitNumber || (topicMatch?.unitNumber || null),
      chapter: extracted.chapter || (topicMatch?.unitTitle ? `Unit ${topicMatch.unitNumber}: ${topicMatch.unitTitle}` : null),
      topic: topicMatch?.matchedTopic || null
    };
  }

  // 2. Check extended alias tokens
  for (const [alias, canonicalTitle] of Object.entries(EXTENDED_SUBJECT_ALIASES)) {
    const aliasRegex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (aliasRegex.test(lower)) {
      const matchedCourse = courses.find(c =>
        c.title.toLowerCase() === canonicalTitle.toLowerCase() &&
        (!enrolledSemester || Number(c.semester) === Number(enrolledSemester))
      ) || courses.find(c => c.title.toLowerCase() === canonicalTitle.toLowerCase());
      return {
        matched: true,
        subject: matchedCourse ? matchedCourse.title : canonicalTitle,
        code: matchedCourse ? matchedCourse.code : null,
        semester: extracted.semester || (matchedCourse ? Number(matchedCourse.semester) : enrolledSemester),
        unit: extracted.unitNumber || null,
        chapter: extracted.chapter || null,
        topic: null
      };
    }
  }

  // 3. Check syllabus topic resolution (e.g. "linked list", "normalization", "deadlock", "session and cookies")
  const topicRes = resolveSyllabusTopic(raw);
  if (topicRes && topicRes.courseTitle) {
    return {
      matched: true,
      subject: topicRes.courseTitle,
      code: topicRes.courseCode || null,
      semester: extracted.semester || topicRes.semester || enrolledSemester,
      unit: topicRes.unitNumber || null,
      chapter: topicRes.unitNumber ? `Unit ${topicRes.unitNumber}` : null,
      topic: topicRes.matchedTopic || raw
    };
  }

  // 4. Check chat-topics.js
  for (const t of topics) {
    const allTerms = [t.topic, ...(t.synonyms || [])].filter(Boolean);
    for (const term of allTerms) {
      if (term.length >= 3 && lower.includes(term.toLowerCase())) {
        const matchedCourse = courses.find(c => c.title.toLowerCase() === String(t.subject || '').toLowerCase());
        return {
          matched: true,
          subject: matchedCourse ? matchedCourse.title : t.subject,
          code: matchedCourse ? matchedCourse.code : null,
          semester: extracted.semester || (matchedCourse ? Number(matchedCourse.semester) : enrolledSemester),
          unit: null,
          chapter: null,
          topic: t.topic
        };
      }
    }
  }

  return {
    matched: false,
    subject: null,
    code: null,
    semester: extracted.semester || enrolledSemester || null,
    unit: extracted.unitNumber || null,
    chapter: extracted.chapter || null,
    topic: null
  };
}

/**
 * Extracts conversation context from previous turns (`history`) so follow-up questions
 * ("What about my assignment?", "Have I submitted it?", "Give me an example in C",
 * "Yo topic bujhaideu", "How many days left for it?") resolve naturally.
 */
function resolveConversationContext(message, history = [], academicContext = {}) {
  const cleanHistory = Array.isArray(history) ? history.filter(m => m && typeof m === 'object') : [];
  const enrolledSemester = Number(
    academicContext?.cohort?.currentSemester ||
    academicContext?.currentSemester ||
    String(academicContext?.semester || '').replace(/[^0-9]/g, '')
  ) || null;

  let lastSubject = null;
  let lastSubjectCode = null;
  let lastSemester = enrolledSemester;
  let lastChapter = null;
  let lastTopic = null;
  let lastAssignmentId = null;
  let lastAssignmentTitle = null;
  let lastAssignments = [];
  let lastIntent = null;
  let lastProgrammingLanguage = null;

  for (let i = cleanHistory.length - 1; i >= 0; i--) {
    const turn = cleanHistory[i];
    const text = String(turn.content || '').trim();
    if (!text) continue;

    if (Array.isArray(turn.matchedAssignments) && turn.matchedAssignments.length > 0 && lastAssignments.length === 0) {
      lastAssignments = turn.matchedAssignments;
      lastAssignmentId = turn.matchedAssignments[0].id;
      lastAssignmentTitle = turn.matchedAssignments[0].title;
      if (!lastSubject && turn.matchedAssignments[0].subject) {
        lastSubject = turn.matchedAssignments[0].subject;
      }
    }
    if (Array.isArray(turn.resourceCards) && turn.resourceCards.length > 0) {
      const assignCards = turn.resourceCards.filter(c => c && c.type === 'assignment');
      if (assignCards.length > 0 && lastAssignments.length === 0) {
        lastAssignments = assignCards;
        lastAssignmentId = assignCards[0].id;
        lastAssignmentTitle = assignCards[0].title;
        if (!lastSubject && assignCards[0].subject) lastSubject = assignCards[0].subject;
      }
      const noteCards = turn.resourceCards.filter(c => c && c.type === 'note');
      if (noteCards.length > 0 && !lastSubject && noteCards[0].subject) {
        lastSubject = noteCards[0].subject;
      }
    }

    const resolved = resolveAcademicEntity(text, enrolledSemester);
    if (!lastSubject && resolved.subject) {
      lastSubject = resolved.subject;
      lastSubjectCode = resolved.code;
    }
    if (!lastChapter && resolved.chapter) {
      lastChapter = resolved.chapter;
    }
    if (!lastTopic && resolved.topic) {
      lastTopic = resolved.topic;
    }

    if (!lastTopic && turn.role === 'user') {
      const conceptMatch = text.match(/\b(?:explain|what\s+is|what\s+are|define|describe|how\s+does|how\s+do|tell\s+me\s+about)\s+([a-z0-9\s+#-]+?)(?:\s+in\s+(?:c|c\+\+|java|python|js|javascript|php|sql|dsa|dbms|os|cn)|[?.!।]|$)/i)
        || text.match(/^([a-z0-9\s+#-]+?)\s+(?:ko\s+barema\s+)?(?:bujhaideu|bujhau|explain\s+gara|bhaneko\s+k\s+ho)[?.!।]*$/i);
      if (conceptMatch && conceptMatch[1]) {
        const candidateTopic = conceptMatch[1].trim();
        if (!/^(?:it|this|that|yo|tyo|my\s+assignment|the\s+assignment)$/i.test(candidateTopic)) {
          lastTopic = candidateTopic;
        }
      }
    }

    if (!lastAssignmentTitle && turn.role === 'assistant') {
      const boldAssignMatch = text.match(/\*\*([^*]*?(?:Assignment|Lab|Project|Homework)[^*]*)\*\*/i);
      if (boldAssignMatch) {
        lastAssignmentTitle = boldAssignMatch[1].trim();
      }
    }

    if (!lastIntent && turn.role === 'user') {
      if (/\b(assignments?|deadlines?|submit\w*|submissions?|homework)\b|असाइनमेन्ट/i.test(text)) {
        lastIntent = 'assignment';
      } else if (/\b(exams?|routines?|schedules?)\b|परीक्षा|रुटिन/i.test(text)) {
        lastIntent = 'exam';
      } else if (/\b(notices?|announcements?|resum\w*|holidays?|bida|khul\w*)\b|सूचना|बिदा/i.test(text)) {
        lastIntent = 'notice';
      } else if (/\b(attendance|hajir|hazir)\b|हाजिरी/i.test(text)) {
        lastIntent = 'attendance';
      } else if (/\b(notes?|pdf|slides?|materials?)\b|नोट्स/i.test(text)) {
        lastIntent = 'notes';
      } else if (/\b(explain|what\s+is|define|example|bujhaideu|bujhau)\b|बुझाइदेऊ/i.test(text)) {
        lastIntent = 'tutoring';
      }
    }
  }

  return {
    enrolledSemester,
    lastSubject,
    lastSubjectCode,
    lastSemester,
    lastChapter,
    lastTopic,
    lastAssignmentId,
    lastAssignmentTitle,
    lastAssignments,
    lastIntent,
    lastProgrammingLanguage
  };
}

/**
 * SECTION 2: INTELLIGENT UNDERSTANDING ENGINE
 * Analyzes any user message (English, Romanized Nepali, Devanagari, Mixed)
 * alongside conversation context to determine intentions, entities, and whether
 * multi-step tool execution / temporal calculation is required.
 */
function understandRequest(message, history = [], academicContext = {}) {
  const raw = String(message || '').trim();
  const norm = normalizeDevanagariDigits(raw);
  const lower = norm.toLowerCase();
  const language = detectLanguage(raw);
  const convCtx = resolveConversationContext(raw, history, academicContext);
  const enrolledSemester = convCtx.enrolledSemester;

  // Resolve entities from current message first
  const currentEntity = resolveAcademicEntity(raw, enrolledSemester);
  const extracted = extractFilters(raw);

  // Detect deictic / follow-up references ("it", "this", "that", "yo", "yesko", "tyo", "tesko", "what about...", "have I submitted it?", "give me an example in C", "yo topic bujhaideu")
  const hasDeicticReference = /\b(it|its|this|that|these|those|yo|yesko|yasko|tyo|tesko|tyesko|yesma|tesma|what\s+about|how\s+about|and\s+for|same\s+topic|yo\s+topic|this\s+topic|that\s+topic|above\s+topic)\b|यो|यसको|त्यो|त्यसको|यसमा/i.test(lower);
  const isShortFollowUp = raw.split(/\s+/).length <= 8 && (
    hasDeicticReference ||
    /\b(example|in\s+c|in\s+java|in\s+python|in\s+js|submitted|submit|deadline|days?\s+left|kati\s+din|kahile\s+samma|bujhaideu|bujhau|notes?\s+xa|assignment\s+xa)\b/i.test(lower)
  );

  // Effective subject/topic/semester combining current message with conversation context when appropriate
  const subject = currentEntity.subject || ((hasDeicticReference || isShortFollowUp || !extracted.subject) ? convCtx.lastSubject : null);
  const subjectCode = currentEntity.code || (subject === convCtx.lastSubject ? convCtx.lastSubjectCode : null);
  const semester = extracted.semester || currentEntity.semester || enrolledSemester || convCtx.lastSemester || null;
  const chapter = extracted.chapter || currentEntity.chapter || (hasDeicticReference ? convCtx.lastChapter : null);
  const unitNumber = extracted.unitNumber || currentEntity.unit || null;

  // Extract explicit topic from current message or inherit from context on follow-up
  let topic = currentEntity.topic || null;
  if (!topic) {
    const cleanedForTopic = raw.replace(/\s+(?:when|if)\s+(?:university\s+)?notes?\s+are\s+(?:unavailable|missing|not\s+found).*$/i, '').trim();
    const topicMatch = cleanedForTopic.match(/\b(?:explain|what\s+is|what\s+are|define|describe|find\s+(?:relevant\s+)?notes?\s+(?:on|for|about)|notes?\s+(?:on|for|about)|study\s+material\s+for|learn\s+about)\s+([a-z0-9\s+#-]+?)(?:\s+(?:in|of|for)\s+[a-z0-9\s]+|[?.!।]|$)/i)
      || cleanedForTopic.match(/^([a-z0-9\s+#-]+?)\s+(?:ko\s+)?(?:notes?|assignment|topic|bujhaideu|bujhau|explain)[?.!।]*$/i);
    if (topicMatch && topicMatch[1]) {
      const candidate = topicMatch[1].trim();
      if (!/^(?:it|this|that|yo|tyo|my|mero|all|unsubmitted|pending|next|exam|attendance)$/i.test(candidate)) {
        topic = candidate;
      }
    }
  }
  if (!topic && (hasDeicticReference || /\b(give\s+(?:me\s+)?an?\s+example|example\s+in\s+\w+|yo\s+topic\s+bujhaideu|bujhaideu|explain\s+it|explain\s+this)\b/i.test(lower))) {
    topic = convCtx.lastTopic || convCtx.lastSubject || null;
  }

  // Programming language preference (e.g., "in C", "C ma example deu")
  const progLangMatch = lower.match(/\b(?:in\s+(c\+\+|cpp|c|java|python|javascript|js|php|sql)|(c\+\+|cpp|c|java|python|javascript|js|php|sql)\s+(?:ma|language\s+ma)\s+(?:example|code|program))\b/i);
  const programmingLanguage = progLangMatch ? (progLangMatch[1] || progLangMatch[2]).toUpperCase() : null;

  // Detect specific intent categories (can be multiple for multi-step questions!)
  const intents = [];

  // 1. Assignment & Deadline & Submission intents
  const mentionsAssignmentWord = /\b(assignments?|homeworks?|labs?\s*\d*|code\s*lab|projects?)\b|असाइनमेन्ट|होमवर्क/i.test(lower);
  const mentionsDeadlineOrTimeLeft = /\b(how\s+many\s+days?\s+(?:are\s+)?(?:left|remaining)|days?\s+(?:left|remaining)|time\s+(?:left|remaining)|deadline|due\s+date|when\s+is\s+.*?\s+due|kahile\s+samma(?:\s+ho)?|kaile\s+samma(?:\s+ho)?|kati\s+din\s+(?:baki|baaki|remaining)|submission\s+date|last\s+date)\b|कहिले\s*सम्म|कति\s*दिन\s*बाँकी|डेडलाइन/i.test(lower);
  const mentionsSubmissionCheck = /\b(have\s+i\s+submitted|did\s+i\s+submit|is\s+it\s+submitted|whether\s+i\s+submitted|submission\s+status|maile\s+(?:.*?\s+)?(?:submit|bujha\w*)\s+(?:gare|gareko|garyo|garexu|garechhu)|submit\s+bhayo|submit\s+gareko\s+(?:xa|cha|chha|xu|chhu)|bujhaye|bujhayeko)\b|बुझाएँ|बुझाएको\s*छु|सबमिट\s*गरें/i.test(lower);
  const mentionsUnsubmittedAll = /\b(unsubmitted\s+assignments?|pending\s+assignments?|not\s+submitted|haven'?t\s+submitted|have\s+not\s+submitted|remaining\s+assignments?|incomplete\s+assignments?|kun\s+kun\s+assignment\s+(?:baki|baaki|submit\s+garna\s+baki)|baki\s+assignments?|submit\s+nagareko\s+assignments?)\b|बुझाउन\s*बाँकी|नबुझाएको\s*असाइनमेन्ट/i.test(lower);

  const inheritsAssignmentContext = convCtx.lastIntent === 'assignment' && (hasDeicticReference || mentionsDeadlineOrTimeLeft || mentionsSubmissionCheck);

  if (mentionsUnsubmittedAll) {
    intents.push('unsubmitted_assignments');
  }
  if ((mentionsAssignmentWord && mentionsDeadlineOrTimeLeft) || (inheritsAssignmentContext && mentionsDeadlineOrTimeLeft) || (mentionsDeadlineOrTimeLeft && !/\bexam\b/i.test(lower))) {
    intents.push('assignment_deadline');
  }
  if (mentionsSubmissionCheck) {
    intents.push('submission_status');
  }
  if (mentionsAssignmentWord && !intents.includes('assignment_deadline') && !intents.includes('unsubmitted_assignments') && !intents.includes('submission_status')) {
    intents.push('assignment_lookup');
  }

  // 2. Examination & Routine intents
  const mentionsNextExam = /\b(next\s+exam(?:ination)?|upcoming\s+exam(?:ination)?|when\s+is\s+(?:the\s+|my\s+|our\s+)?(?:next\s+)?exam(?:ination)?|arko\s+exam\s+(?:kahile|kaile|kun)|exam\s+(?:kahile|kaile)\s+(?:xa|cha|chha|ho|hunxa)|how\s+many\s+days?\s+(?:until|left\s+for|to)\s+(?:the\s+|my\s+)?(?:next\s+)?exam)\b|अर्को\s*परीक्षा|परीक्षा\s*कहिले/i.test(lower);
  const mentionsRoutine = /\b(routines?|timetables?|exam\s+schedules?|exam\s+routine)\b|रुटिन|तालिका/i.test(lower);

  if (mentionsNextExam) {
    intents.push('next_examination');
  } else if (mentionsRoutine) {
    intents.push('routine_lookup');
  }

  // 3. Notice, Class Resumption & Conflict Detection intents
  const mentionsClassResumption = /\b(class(?:es)?\s+(?:resum\w*|reopen\w*|start\w*|begin\w*|suru|shuru|khul\w*|lag\w*)|resumption\s+of\s+(?:regular\s+)?class(?:es)?|when\s+(?:do|does|will|are)\s+(?:our\s+|regular\s+|the\s+)?class(?:es)?\s+(?:resum\w*|start\w*|reopen\w*|begin\w*)|college\s+(?:kahile|kaile)\s+(?:khul\w*|lag\w*|suru)|(?:dashain|tihar|vacation|holiday|bida)\s+(?:pachi|paxi|after)\s+(?:class(?:es)?|college|campus))\b|कक्षा\s*(?:कहिले|सुरु|शुरु|खुल्ने)/i.test(lower);
  const mentionsNotice = /\b(notices?|announcements?|circulars?|holidays?|bida|chutti|official\s+update)\b|सूचना|बिदा|छुट्टी/i.test(lower);

  if (mentionsClassResumption) {
    intents.push('class_resumption_notice');
  } else if (mentionsNotice) {
    intents.push('notice_lookup');
  }

  // 4. Personal Attendance & Attendance Comparison intents
  const mentionsAttendance = /\b(attendance|hajir|hazir|present\s+days?|absent\s+days?)\b|हाजिरी|हाजिर|उपस्थिति/i.test(lower);
  const mentionsAttendanceComparison = mentionsAttendance && /\b(compare|comparison|across\s+subjects?|all\s+subjects?|subject-?wise|lowest|highest|best|worst|which\s+subject|kun\s+subject\s+ma\s+(?:kam|badi|sabai\s+bhanda)|तुलना|कुन\s*विषयमा\s*कम)\b/i.test(lower);

  if (mentionsAttendanceComparison) {
    intents.push('attendance_comparison');
  } else if (mentionsAttendance) {
    intents.push('attendance_lookup');
  }

  // 5. Personal Marks / Results intents
  const mentionsResults = /\b(my\s+(?:marks?|results?|grades?|scores?)|mero\s+(?:marks?|results?|grades?)|show\s+(?:my\s+)?(?:marks?|results?)|internal\s+marks?|midterm\s+marks?|preboard\s+marks?)\b|(?:मेरो\s*)?(?:नतिजा|रिजल्ट|मार्क्स|अंक)/i.test(lower);
  if (mentionsResults) {
    intents.push('results_lookup');
  }

  // 6. Notes / Study Materials intents
  const mentionsNotes = /\b(notes?|pdfs?|slides?|study\s+materials?|documents?|files?|handouts?|chapter\s*\d+\s*ma\s*kata)\b|नोट्स|नोट|पीडीएफ/i.test(lower);
  const mentionsUnavailableNotes = /\bnotes?\s+are\s+(?:unavailable|missing|not\s+available|not\s+found)\b/i.test(lower);
  if (mentionsNotes && !mentionsUnavailableNotes) {
    intents.push('notes_lookup');
  }

  // 7. Syllabus / Subject / Teacher Directory intents
  const mentionsSyllabus = /\b(syllabus|syllabi|curriculum|teaching\s+hours?|credit\s+hours?|course\s+outline|unit\s*\d+\s+of)\b|पाठ्यक्रम|सिल्याबस/i.test(lower);
  const mentionsTeacherOrSubjects = /\b(who\s+teaches|assigned\s+teacher|which\s+teacher|teacher\s+for|kun\s+sir|kun\s+teacher|kasle\s+padha\w*)\b|कसले\s*पढाउनुहुन्छ|कुन\s*शिक्षक/i.test(lower);

  if (mentionsSyllabus) {
    intents.push('syllabus_lookup');
  }
  if (mentionsTeacherOrSubjects) {
    intents.push('subject_directory');
  }

  // 8. Academic Tutoring / Concept Explanation intents
  const mentionsTutoring = /\b(explain|bujhaideu|bujhau|bujhauna|sikhaideu|teach\s+me|what\s+is|what\s+are|how\s+does|how\s+do|define|describe|give\s+(?:me\s+)?an?\s+example|example\s+in\s+(?:c|c\+\+|java|python|js|sql)|write\s+a\s+program|implement|derive|difference\s+between|compare\s+[a-z0-9\s]+\s+and\s+[a-z0-9\s]+)\b|बुझाइदेऊ|बुझाऊ|उदाहरण\s*देऊ|भनेको\s*के\s*हो/i.test(lower);
  if (mentionsTutoring && (!mentionsAttendance || intents.length > 0)) {
    intents.push('academic_tutoring');
  } else if (intents.length === 0 && (mapsToBitSyllabus(raw) || academicRequest(raw) || (hasDeicticReference && convCtx.lastTopic))) {
    intents.push('academic_tutoring');
  }

  const primaryIntent = intents[0] || 'general_academic';
  const isMultiStep = intents.length > 1 || [
    'assignment_deadline',
    'submission_status',
    'unsubmitted_assignments',
    'assignment_lookup',
    'next_examination',
    'class_resumption_notice',
    'attendance_comparison'
  ].includes(primaryIntent) || (
    primaryIntent === 'academic_tutoring' && Boolean(hasDeicticReference || programmingLanguage)
  );

  return {
    rawMessage: raw,
    normalizedMessage: norm,
    language,
    intents,
    primaryIntent,
    isMultiStep,
    hasDeicticReference,
    isShortFollowUp,
    entities: {
      subject,
      subjectCode,
      semester,
      chapter,
      unitNumber,
      topic,
      programmingLanguage,
      assignmentId: convCtx.lastAssignmentId,
      assignmentTitle: convCtx.lastAssignmentTitle,
      previousAssignments: convCtx.lastAssignments
    },
    conversationContext: convCtx
  };
}

/**
 * SECTION 5: CONTEXT INTELLIGENCE SYSTEM
 * Builds on-demand structured context for the agent without dumping the entire database.
 */
function buildStructuredAgentContext(academicContext = {}, history = [], referenceDate = new Date()) {
  const clock = getCurrentNepalDateTime(referenceDate);
  const enrolledSemester = Number(
    academicContext?.cohort?.currentSemester ||
    academicContext?.currentSemester ||
    String(academicContext?.semester || '').replace(/[^0-9]/g, '')
  ) || null;

  const semesterCourses = enrolledSemester
    ? courses.filter(c => Number(c.semester) === enrolledSemester).map(c => ({
      code: c.code,
      title: c.title,
      semester: Number(c.semester),
      credit: c.credit
    }))
    : [];

  return {
    user: {
      authenticated: Boolean(academicContext?.authenticated && academicContext?.studentId),
      studentId: academicContext?.studentId || null,
      name: academicContext?.name || null,
      role: academicContext?.role || 'anonymous',
      cohortId: academicContext?.cohort?.id || academicContext?.cohortId || null,
      cohortName: academicContext?.cohort?.displayName || academicContext?.cohort?.name || null
    },
    enrolledSemester,
    availableSubjects: semesterCourses,
    assignedSubjects: Array.isArray(academicContext?.assignedSubjects) ? academicContext.assignedSubjects : [],
    assignedSemesters: Array.isArray(academicContext?.assignedSemesters) ? academicContext.assignedSemesters : [],
    currentDateTime: clock
  };
}

/**
 * SECTION 4: DYNAMIC TOOL AND RESOURCE DISCOVERY REGISTRY
 * Wraps and extends `createTools` (`lib/chat-tools.js`) with ACADEMIC, PERSONAL_RECORDS,
 * and INTELLIGENCE tools. Enforces server-side authorization on every tool call.
 */
function createAgentToolRegistry(db, academicContext = {}, options = {}) {
  const referenceDate = options.referenceDate || new Date();
  const baseRoute = options.route || {
    kind: 'tools',
    query: options.message || '',
    filters: {
      semester: null,
      subject: null,
      subjects: [],
      chapter: null,
      unitNumber: null
    }
  };

  const baseToolkit = createTools(db, baseRoute, {
    academicContext,
    signal: options.signal,
    excludeIds: options.excludeIds || [],
    referenceDate
  });

  const enrolledSemester = Number(
    academicContext?.cohort?.currentSemester ||
    academicContext?.currentSemester ||
    String(academicContext?.semester || '').replace(/[^0-9]/g, '')
  ) || null;

  const toolDefinitions = [
    ...baseToolkit.tools,
    {
      type: 'function',
      category: 'ACADEMIC',
      function: {
        name: 'search_subjects',
        description: 'Search BIT subjects, course codes, credits, and assigned teachers for a semester or subject query.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 200 },
            semester: { type: 'integer', minimum: 1, maximum: 8 },
            subject: { type: 'string', maxLength: 120 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'ACADEMIC',
      function: {
        name: 'get_assignment_details',
        description: 'Retrieve full details, questions, starter code, PDF attachment, submission status, and deterministic deadline countdown for specific assignment(s).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            assignment_id: { type: 'integer', minimum: 1 },
            subject: { type: 'string', maxLength: 120 },
            query: { type: 'string', maxLength: 200 },
            semester: { type: 'integer', minimum: 1, maximum: 8 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'PERSONAL_RECORDS',
      function: {
        name: 'check_submission_status',
        description: 'Check the authenticated student\'s personal assignment submission status, submitted questions, timestamps, released grades, or list all unsubmitted/pending assignments.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            assignment_id: { type: 'integer', minimum: 1 },
            subject: { type: 'string', maxLength: 120 },
            query: { type: 'string', maxLength: 200 },
            only_unsubmitted: { type: 'boolean' }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'PERSONAL_RECORDS',
      function: {
        name: 'get_my_submissions',
        description: 'Retrieve the authenticated student\'s complete assignment submission history and released grades.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subject: { type: 'string', maxLength: 120 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'ACADEMIC',
      function: {
        name: 'get_academic_calendar',
        description: 'Retrieve upcoming academic events, examination dates, assignment deadlines, and official notices in chronological order.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            semester: { type: 'integer', minimum: 1, maximum: 8 },
            subject: { type: 'string', maxLength: 120 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'get_current_datetime',
        description: 'Retrieve the authoritative server-side current date and time in Asia/Kathmandu timezone (Gregorian AD and Bikram Sambat BS).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'calculate_date_difference',
        description: 'Deterministically calculate days remaining or days elapsed between a target date (AD or BS) and the current Nepal date.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['target_date'],
          properties: {
            target_date: { type: 'string', maxLength: 80 },
            calendar: { type: 'string', enum: ['AD', 'BS'] }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'calculate_deadline_status',
        description: 'Deterministically calculate countdown status (days remaining, due today, or overdue by X days) for an assignment deadline or exam date.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            deadline: { type: 'string', maxLength: 100 },
            submitted: { type: 'boolean' }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'resolve_subject_topic',
        description: 'Resolve subject abbreviations (e.g. DSA, DBMS, OS, CN), aliases, or academic concepts to canonical BIT subject names, course codes, semesters, and syllabus units.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', maxLength: 200 },
            semester: { type: 'integer', minimum: 1, maximum: 8 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'compare_sources',
        description: 'Compare multiple notices or announcements by publication date, effective date, confirmation status, and authority tier to resolve conflicts or detect outdated announcements.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 200 }
          }
        }
      }
    },
    {
      type: 'function',
      category: 'INTELLIGENCE',
      function: {
        name: 'verify_evidence',
        description: 'Validate retrieved resources, authorization, freshness, conflict status, and deterministic calculations before producing the final answer.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: { type: 'string', maxLength: 100 }
          }
        }
      }
    }
  ];

  // Track all retrieved records & cards across tool calls in this registry instance
  const collectedState = {
    assignments: [],
    submissions: [],
    notices: [],
    routine: [],
    files: [],
    courses: [],
    attendance: null,
    results: null,
    datetime: null,
    calculations: [],
    sourceComparisons: [],
    resourceCards: [],
    toolErrors: []
  };

  function pushUniqueCard(card) {
    if (!card || !card.type) return;
    const key = `${card.type}:${card.id ?? card.code ?? card.title}`;
    if (!collectedState.resourceCards.some(c => `${c.type}:${c.id ?? c.code ?? c.title}` === key)) {
      collectedState.resourceCards.push(card);
    }
  }

  /**
   * Queries assignments with full personal submission & question counts for the authenticated student.
   */
  async function queryAuthorizedAssignments({ assignmentId = null, subject = null, query = '', semester = null } = {}) {
    let rawList = await searchAssignments(db, academicContext, {
      query: query || '',
      subject: subject || null,
      semester: semester || enrolledSemester || null,
      limit: 20
    });

    let filtered = Array.isArray(rawList) ? rawList : [];
    if (assignmentId) {
      filtered = filtered.filter(a => Number(a.id) === Number(assignmentId));
    }

    if (subject && filtered.length === 0) {
      const resolved = resolveAcademicEntity(subject, semester || enrolledSemester);
      if (resolved.subject && resolved.subject.toLowerCase() !== String(subject).toLowerCase()) {
        const retryList = await searchAssignments(db, academicContext, {
          query: query || '',
          subject: resolved.subject,
          semester: semester || enrolledSemester || null,
          limit: 20
        });
        filtered = Array.isArray(retryList) ? retryList : [];
      }
    }

    // If query was a specific title or phrase that didn't match full searchAssignments token filter,
    // fall back to searching by subject/semester and filtering in memory
    if (query && filtered.length === 0) {
      const broaderList = await searchAssignments(db, academicContext, {
        query: '',
        subject: subject || null,
        semester: semester || enrolledSemester || null,
        limit: 20
      });
      const qLower = String(query).toLowerCase();
      filtered = (Array.isArray(broaderList) ? broaderList : []).filter(a =>
        String(a.title || '').toLowerCase().includes(qLower) ||
        String(a.subject || '').toLowerCase().includes(qLower)
      );
    }

    const studentId = academicContext?.authenticated ? academicContext?.studentId : null;
    const enriched = [];

    for (const a of filtered) {
      let questions = [];
      let mySubmissions = [];
      try {
        if (typeof db?.all === 'function') {
          questions = await db.all(
            `SELECT id, questionNumber, title, description, language, COALESCE(maxPoints, 10) AS maxPoints
             FROM assignment_questions WHERE assignmentId = ? ORDER BY questionNumber ASC`,
            a.id
          ).catch(() => []);
          if (studentId) {
            mySubmissions = await db.all(
              `SELECT sub.id, sub.assignmentId, sub.questionId, sub.questionTitle, sub.submittedAt,
                      sg.marksObtained, sg.remarks, sg.checked, sg.released
               FROM submissions sub
               LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
               WHERE sub.assignmentId = ? AND sub.studentId = ?
               ORDER BY sub.submittedAt DESC`,
              a.id,
              studentId
            ).catch(() => []);
            if (mySubmissions.length === 0) {
              // Fallback if submission_grades table is not present in minimal test schemas
              mySubmissions = await db.all(
                `SELECT id, assignmentId, questionId, submittedAt
                 FROM submissions
                 WHERE assignmentId = ? AND studentId = ?
                 ORDER BY submittedAt DESC`,
                a.id,
                studentId
              ).catch(() => []);
            }
          }
        }
      } catch (_) {}

      const questionCount = Math.max(questions.length, Number(a.questionCount ?? 1));
      const mySubmissionCount = mySubmissions.length > 0
        ? new Set(mySubmissions.map(s => s.questionId ?? s.id)).size
        : Number(a.mySubmissionCount ?? 0);
      const submitted = mySubmissionCount > 0;
      const latestSubmissionAt = mySubmissions[0]?.submittedAt || null;

      const deadlineInfo = calculateAssignmentDeadline(
        { ...a, questionCount, mySubmissionCount },
        referenceDate,
        { submitted, mySubmissionCount, questionCount }
      );

      const card = a.resourceCard || buildResourceCard('assignment', a);
      if (card) pushUniqueCard(card);

      const item = {
        ...a,
        resourceCard: card || a.resourceCard,
        questionCount,
        questions: questions.map(q => ({
          id: q.id,
          questionNumber: q.questionNumber,
          title: q.title,
          description: q.description,
          language: q.language,
          maxPoints: q.maxPoints,
          submitted: mySubmissions.some(s => Number(s.questionId) === Number(q.id))
        })),
        submitted,
        fullySubmitted: deadlineInfo.fullySubmitted,
        partiallySubmitted: deadlineInfo.partiallySubmitted,
        mySubmissionCount,
        unsubmittedCount: deadlineInfo.unsubmittedCount,
        latestSubmissionAt,
        mySubmissions: mySubmissions.map(s => ({
          id: s.id,
          questionId: s.questionId,
          questionTitle: s.questionTitle || null,
          submittedAt: s.submittedAt,
          released: Boolean(s.released),
          marksObtained: s.released ? s.marksObtained : null,
          remarks: s.released ? s.remarks : null
        })),
        deadlineInfo
      };

      enriched.push(item);
    }

    collectedState.assignments = enriched;
    return enriched;
  }

  async function executeAgentTool(name, rawArgs = {}, execMeta = {}) {
    if (typeof options.onBeforeToolCall === 'function') {
      await options.onBeforeToolCall(name, rawArgs, execMeta);
    }
    if (options.failTools && (
      (Array.isArray(options.failTools) && options.failTools.includes(name)) ||
      (options.failTools instanceof Set && options.failTools.has(name)) ||
      (typeof options.failTools === 'function' && options.failTools(name, rawArgs, execMeta))
    )) {
      throw new Error(`Simulated failure in tool ${name}`);
    }

    const originCheck = verifyActionOrigin({
      toolName: name,
      userMessage: options.message || '',
      round: execMeta.round || 0,
      hasPreInjectedUntrustedEvidence: Boolean(execMeta.hasPreInjectedUntrustedEvidence),
      agentVerifiedStep: Boolean(execMeta.agentVerifiedStep)
    });
    if (!originCheck.allowed) {
      const err = new Error(`Action origin denied: ${originCheck.reason}`);
      err.code = 'ACTION_ORIGIN_DENIED';
      throw err;
    }

    // 1. INTELLIGENCE TOOLS
    if (name === 'get_current_datetime') {
      const dt = getCurrentNepalDateTime(referenceDate);
      collectedState.datetime = dt;
      return dt;
    }

    if (name === 'calculate_date_difference') {
      const calc = calculateDateDifference(rawArgs.target_date, referenceDate, {
        calendar: rawArgs.calendar || null
      });
      collectedState.calculations.push({ type: 'date_difference', input: rawArgs, output: calc });
      return calc;
    }

    if (name === 'calculate_deadline_status') {
      const calc = calculateAssignmentDeadline(
        rawArgs.deadline || null,
        referenceDate,
        rawArgs.submitted !== undefined ? { submitted: Boolean(rawArgs.submitted) } : null
      );
      collectedState.calculations.push({ type: 'deadline_status', input: rawArgs, output: calc });
      return calc;
    }

    if (name === 'resolve_subject_topic') {
      return resolveAcademicEntity(rawArgs.query, rawArgs.semester || enrolledSemester);
    }

    if (name === 'search_subjects') {
      const res = await baseToolkit.executeTool('get_academic_directory', {
        query: rawArgs.query || '',
        semester: rawArgs.semester || enrolledSemester || undefined,
        subject: rawArgs.subject || undefined
      });
      return res;
    }

    // 2. ASSIGNMENT & SUBMISSION TOOLS
    if (name === 'search_assignments' || name === 'get_assignment_details') {
      const resolvedSubj = rawArgs.subject
        ? (resolveAcademicEntity(rawArgs.subject, rawArgs.semester || enrolledSemester).subject || rawArgs.subject)
        : null;
      const items = await queryAuthorizedAssignments({
        assignmentId: rawArgs.assignment_id || null,
        subject: resolvedSubj,
        query: rawArgs.query || '',
        semester: rawArgs.semester || enrolledSemester || null
      });

      const clock = getCurrentNepalDateTime(referenceDate);
      return {
        currentDate: clock.adDate,
        currentBsDate: clock.bsDate,
        timezone: clock.timezone,
        subject: resolvedSubj,
        semester: rawArgs.semester || enrolledSemester || null,
        count: items.length,
        multipleMatches: items.length > 1,
        assignments: items
      };
    }

    if (name === 'check_submission_status' || name === 'get_my_submissions') {
      if (!academicContext?.authenticated || !academicContext?.studentId) {
        return {
          requiresLogin: true,
          clarification: 'Please sign in to check your personal assignment submission status.'
        };
      }
      if (academicContext.role === 'teacher' || academicContext.role === 'admin') {
        return {
          clarification: 'Personal student submission checks apply to student accounts. You can review class submissions on the Code Lab / Assignments dashboard (/assignments).'
        };
      }

      const resolvedSubj = rawArgs.subject
        ? (resolveAcademicEntity(rawArgs.subject, enrolledSemester).subject || rawArgs.subject)
        : null;
      const allMatching = await queryAuthorizedAssignments({
        assignmentId: rawArgs.assignment_id || null,
        subject: resolvedSubj,
        query: rawArgs.query || '',
        semester: enrolledSemester
      });

      const onlyUnsubmitted = Boolean(rawArgs.only_unsubmitted);
      const filtered = onlyUnsubmitted
        ? allMatching.filter(a => !a.fullySubmitted)
        : allMatching;

      const submittedList = allMatching.filter(a => a.submitted);
      const unsubmittedList = allMatching.filter(a => !a.fullySubmitted);
      collectedState.submissions = filtered;

      return {
        studentId: academicContext.studentId,
        semester: enrolledSemester,
        subject: resolvedSubj,
        onlyUnsubmitted,
        totalAssignments: allMatching.length,
        submittedCount: submittedList.length,
        unsubmittedCount: unsubmittedList.length,
        assignments: filtered,
        submittedAssignments: submittedList,
        unsubmittedAssignments: unsubmittedList
      };
    }

    // 3. ROUTINE & NEXT EXAMINATION
    if (name === 'get_routine') {
      const semArg = rawArgs.semester || enrolledSemester || undefined;
      const res = await baseToolkit.executeTool('get_routine', {
        ...(semArg ? { semester: semArg } : {}),
        ...(rawArgs.subject ? { subject: rawArgs.subject } : {}),
        ...(rawArgs.exam_date ? { exam_date: rawArgs.exam_date } : {})
      });
      const rows = Array.isArray(res?.routine) ? res.routine : [];
      const examResolution = resolveNextExamination(rows, referenceDate);
      collectedState.routine = rows;
      collectedState.calculations.push({ type: 'next_examination', output: examResolution });
      for (const r of rows) {
        if (r.resourceCard) pushUniqueCard(r.resourceCard);
        else {
          const card = buildResourceCard('routine', r);
          if (card) pushUniqueCard(card);
        }
      }
      return {
        ...res,
        currentDate: examResolution.referenceAdDate,
        currentBsDate: examResolution.referenceBsDate,
        nextExam: examResolution.nextExam,
        nextExamDayMatches: examResolution.nextExamDayMatches,
        upcomingExams: examResolution.upcomingExams,
        pastExams: examResolution.pastExams
      };
    }

    // 4. NOTICES & SOURCE COMPARISON
    if (name === 'search_notices' || name === 'compare_sources') {
      const res = await baseToolkit.executeTool('search_notices', {
        query: rawArgs.query || '',
        ...(rawArgs.semester ? { semester: rawArgs.semester } : {})
      });
      let notices = Array.isArray(res?.notices) ? res.notices : [];
      // If specific query words returned 0 notices, also check broader notices in the student's semester so outdated/conflicting notices on the topic are not missed
      if (notices.length === 0 && rawArgs.query) {
        const broaderRes = await baseToolkit.executeTool('search_notices', {
          query: '',
          ...(rawArgs.semester ? { semester: rawArgs.semester } : {})
        }).catch(() => null);
        if (Array.isArray(broaderRes?.notices) && broaderRes.notices.length > 0) {
          notices = broaderRes.notices;
        }
      }
      const temporalResolution = compareAndResolveTemporalRecords(notices, referenceDate);
      collectedState.notices = notices;
      collectedState.sourceComparisons.push(temporalResolution);
      for (const n of (temporalResolution.activeRecords.length > 0 ? temporalResolution.activeRecords : notices)) {
        if (n.resourceCard) pushUniqueCard(n.resourceCard);
        else {
          const card = buildResourceCard('notice', n);
          if (card) pushUniqueCard(card);
        }
      }
      return {
        ...res,
        notices,
        temporalResolution
      };
    }

    // 5. PERSONAL ATTENDANCE & CROSS-SUBJECT COMPARISON
    if (name === 'get_my_attendance') {
      const res = await baseToolkit.executeTool('get_my_attendance', {
        ...(rawArgs.subject ? { subject: rawArgs.subject } : {}),
        ...(rawArgs.semester ? { semester: rawArgs.semester } : {})
      });
      if (res && Array.isArray(res.subjects)) {
        const recorded = res.subjects.filter(s => Number(s.totalSessions ?? s.totalClasses ?? 0) > 0 && s.attendancePercentage !== null && s.attendancePercentage !== undefined);
        const unrecorded = res.subjects.filter(s => Number(s.totalSessions ?? s.totalClasses ?? 0) === 0 || s.attendancePercentage === null || s.attendancePercentage === undefined);
        const sortedDesc = [...recorded].sort((a, b) => Number(b.attendancePercentage) - Number(a.attendancePercentage));
        const sortedAsc = [...recorded].sort((a, b) => Number(a.attendancePercentage) - Number(b.attendancePercentage));
        const lowAttendance = recorded.filter(s => Number(s.attendancePercentage) < 50);

        res.comparison = {
          totalSubjects: res.subjects.length,
          recordedCount: recorded.length,
          unrecordedCount: unrecorded.length,
          highestSubject: sortedDesc[0] || null,
          lowestSubject: sortedAsc[0] || null,
          lowAttendanceSubjects: lowAttendance,
          rankedSubjects: sortedDesc,
          unrecordedSubjects: unrecorded
        };
      }
      collectedState.attendance = res;
      if (res?.resourceCard) pushUniqueCard(res.resourceCard);
      return res;
    }

    // 6. PERSONAL RESULTS / MARKS
    if (name === 'get_my_results') {
      const res = await baseToolkit.executeTool('get_my_results', {
        ...(rawArgs.subject ? { subject: rawArgs.subject } : {}),
        ...(rawArgs.semester ? { semester: rawArgs.semester } : {}),
        ...(rawArgs.exam_type ? { exam_type: rawArgs.exam_type } : {})
      });
      collectedState.results = res;
      if (res?.resourceCard) pushUniqueCard(res.resourceCard);
      return res;
    }

    // 7. NOTES & SYLLABUS
    if (name === 'search_notes') {
      const resolvedSubj = rawArgs.subject
        ? (resolveAcademicEntity(rawArgs.subject, rawArgs.semester || enrolledSemester).subject || rawArgs.subject)
        : undefined;
      const res = await baseToolkit.executeTool('search_notes', {
        query: rawArgs.query || '',
        ...(rawArgs.semester ? { semester: rawArgs.semester } : {}),
        ...(resolvedSubj ? { subject: resolvedSubj } : {}),
        ...(rawArgs.chapter ? { chapter: rawArgs.chapter } : {})
      });
      if (Array.isArray(res?.files)) {
        for (const f of res.files) {
          if (!collectedState.files.some(existing => existing.id === f.id)) {
            collectedState.files.push(f);
          }
          if (f.resourceCard) pushUniqueCard(f.resourceCard);
          else {
            const card = buildResourceCard('note', f);
            if (card) pushUniqueCard(card);
          }
        }
      }
      return res;
    }

    if (name === 'read_note_file') {
      const res = await baseToolkit.executeTool('read_note_file', {
        file_id: Number(rawArgs.file_id),
        ...(rawArgs.query ? { query: rawArgs.query } : {})
      });
      if (res?.file || res?.id) {
        const f = res.file || res;
        const existingIdx = collectedState.files.findIndex(existing => existing.id === f.id);
        if (existingIdx >= 0) {
          collectedState.files[existingIdx] = { ...collectedState.files[existingIdx], ...f };
        } else {
          collectedState.files.push(f);
        }
        const card = f.resourceCard || res.resourceCard || buildResourceCard('note', f);
        if (card) pushUniqueCard(card);
      }
      return res;
    }

    if (name === 'get_syllabus') {
      const resolvedSubj = rawArgs.subject
        ? (resolveAcademicEntity(rawArgs.subject, rawArgs.semester || enrolledSemester).subject || rawArgs.subject)
        : undefined;
      const res = await baseToolkit.executeTool('get_syllabus', {
        ...(rawArgs.semester ? { semester: rawArgs.semester } : {}),
        ...(resolvedSubj ? { subject: resolvedSubj } : {}),
        ...(rawArgs.unit ? { unit: rawArgs.unit } : {})
      });
      if (Array.isArray(res?.courses)) {
        collectedState.courses.push(...res.courses);
      }
      return res;
    }

    if (name === 'get_academic_calendar') {
      const sem = rawArgs.semester || enrolledSemester || null;
      const [routineRes, assignList, noticeRes] = await Promise.all([
        executeAgentTool('get_routine', { ...(sem ? { semester: sem } : {}), ...(rawArgs.subject ? { subject: rawArgs.subject } : {}) }, execMeta).catch(() => ({ upcomingExams: [] })),
        queryAuthorizedAssignments({ subject: rawArgs.subject || null, semester: sem }).catch(() => []),
        executeAgentTool('search_notices', { query: rawArgs.subject || '' }, execMeta).catch(() => ({ notices: [] }))
      ]);
      return {
        currentDateTime: getCurrentNepalDateTime(referenceDate),
        semester: sem,
        upcomingExams: routineRes.upcomingExams || [],
        assignments: assignList.filter(a => a.deadlineInfo?.isUpcoming || a.deadlineInfo?.isDueToday),
        activeNotices: noticeRes.temporalResolution?.activeRecords || noticeRes.notices || []
      };
    }

    if (name === 'verify_evidence') {
      return verifyAgentEvidence(collectedState, academicContext, referenceDate);
    }

    return baseToolkit.executeTool(name, rawArgs);
  }

  return {
    tools: toolDefinitions,
    executeTool: executeAgentTool,
    collectedState,
    baseToolkit
  };
}

/**
 * SECTION 7: EVIDENCE AND ANSWER VERIFICATION
 * Validates retrieved evidence before producing a final answer.
 */
function verifyAgentEvidence(collectedState, academicContext = {}, referenceDate = new Date()) {
  const clock = getCurrentNepalDateTime(referenceDate);
  const hasAssignments = Array.isArray(collectedState.assignments) && collectedState.assignments.length > 0;
  const hasNotices = Array.isArray(collectedState.notices) && collectedState.notices.length > 0;
  const hasRoutine = Array.isArray(collectedState.routine) && collectedState.routine.length > 0;
  const hasFiles = Array.isArray(collectedState.files) && collectedState.files.length > 0;
  const hasCourses = Array.isArray(collectedState.courses) && collectedState.courses.length > 0;
  const hasAttendance = Boolean(collectedState.attendance && !collectedState.attendance.clarification);
  const hasResults = Boolean(collectedState.results && !collectedState.results.clarification);

  const missingDeadlines = (collectedState.assignments || []).filter(a => !a.deadlineInfo?.hasDeadline);
  const conflictingNotices = (collectedState.sourceComparisons || []).some(c => c.hasConflict);
  const outdatedOnlyNotices = (collectedState.sourceComparisons || []).some(c => c.hasOutdatedOnly);

  return {
    verifiedAt: clock.iso,
    currentAdDate: clock.adDate,
    currentBsDate: clock.bsDate,
    authorized: Boolean(academicContext?.authenticated || (!hasAttendance && !hasResults)),
    hasEvidence: hasAssignments || hasNotices || hasRoutine || hasFiles || hasCourses || hasAttendance || hasResults,
    counts: {
      assignments: (collectedState.assignments || []).length,
      notices: (collectedState.notices || []).length,
      routine: (collectedState.routine || []).length,
      files: (collectedState.files || []).length,
      courses: (collectedState.courses || []).length
    },
    missingDeadlinesCount: missingDeadlines.length,
    hasConflictingNotices: conflictingNotices,
    hasOutdatedOnlyNotices: outdatedOnlyNotices,
    calculationsVerified: true,
    toolErrorsCount: (collectedState.toolErrors || []).length
  };
}

/**
 * Formats a single assignment's deadline & submission status line cleanly and accurately.
 */
function formatAssignmentSummaryItem(a, { includeSubmission = true, includeQuestions = false } = {}) {
  const title = a.title || `Assignment #${a.id}`;
  const subj = a.subject ? ` (${a.subject}${a.semester ? `, Semester ${String(a.semester).replace(/[^0-9]/g, '') || a.semester}` : ''})` : '';
  const dl = a.deadlineInfo || {};

  let deadlinePart;
  if (!dl.hasDeadline) {
    deadlinePart = '**Deadline:** No deadline specified in records';
  } else if (!dl.validDeadline) {
    deadlinePart = `**Deadline:** ${dl.deadlineRaw} (date format could not be verified)`;
  } else {
    const dateDisplay = `${dl.adDate}${dl.bsDate ? ` (${dl.bsDate} BS)` : ''}`;
    deadlinePart = `**Deadline:** ${dateDisplay} — **${dl.statusLabel}**`;
  }

  let submissionPart = '';
  if (includeSubmission) {
    if (a.fullySubmitted) {
      submissionPart = ` | **Submission Status:** Submitted (${a.mySubmissionCount}/${a.questionCount} question${a.questionCount === 1 ? '' : 's'}${a.latestSubmissionAt ? ` on ${String(a.latestSubmissionAt).slice(0, 10)}` : ''})`;
    } else if (a.partiallySubmitted) {
      submissionPart = ` | **Submission Status:** Partially submitted (${a.mySubmissionCount}/${a.questionCount} questions submitted, ${a.unsubmittedCount} remaining)`;
    } else {
      submissionPart = ` | **Submission Status:** Not submitted (${a.questionCount} question${a.questionCount === 1 ? '' : 's'} pending)`;
    }
  }

  let questionsPart = '';
  if (includeQuestions && Array.isArray(a.questions) && a.questions.length > 0) {
    const qLines = a.questions.slice(0, 5).map(q =>
      `  - Q${q.questionNumber}: ${q.title}${q.description ? ` — ${q.description.slice(0, 140)}` : ''}${q.submitted ? ' *(Submitted)*' : ' *(Pending)*'}`
    );
    questionsPart = `\n${qLines.join('\n')}`;
  }

  return `- **${title}**${subj}: ${deadlinePart}${submissionPart}${questionsPart}`;
}

/**
 * Synthesizes a grounded, verified response from the executed agent steps and collected evidence.
 */
function synthesizeVerifiedAgentResponse({
  understanding,
  registry,
  verification,
  academicContext,
  referenceDate = new Date(),
  fallbackAcademicExplanation = null
}) {
  const state = registry.collectedState;
  const intents = understanding.intents;
  const entities = understanding.entities;
  const clock = state.datetime || getCurrentNepalDateTime(referenceDate);
  const sections = [];

  // 1. Handle Assignment Deadline / Submission / Unsubmitted / Lookup Intents
  const hasAssignmentIntent = intents.some(i =>
    ['assignment_deadline', 'submission_status', 'unsubmitted_assignments', 'assignment_lookup'].includes(i)
  );

  if (hasAssignmentIntent) {
    const subError = state.submissions && state.submissions.clarification;
    if (subError && intents.includes('submission_status') && state.assignments.length === 0) {
      sections.push(subError);
    } else if (intents.includes('unsubmitted_assignments')) {
      if (!academicContext?.authenticated || !academicContext?.studentId) {
        sections.push('Please sign in to view your personal unsubmitted assignments.');
      } else {
        const allAssigns = state.assignments || [];
        const unsubmitted = allAssigns.filter(a => !a.fullySubmitted);
        if (allAssigns.length === 0) {
          sections.push(`No assignments were found in the records for ${entities.subject ? `**${entities.subject}**` : `Semester ${entities.semester || 'your enrolled semester'}`}.`);
        } else if (unsubmitted.length === 0) {
          sections.push(`You have **no unsubmitted assignments**${entities.subject ? ` in **${entities.subject}**` : ''}! All ${allAssigns.length} assignment${allAssigns.length === 1 ? '' : 's'} have been submitted.`);
        } else {
          const header = `You have **${unsubmitted.length} unsubmitted assignment${unsubmitted.length === 1 ? '' : 's'}**${entities.subject ? ` in **${entities.subject}**` : ` in Semester ${entities.semester || academicContext?.currentSemester || ''}`} (as of ${clock.adDate}${clock.bsDate ? ` / ${clock.bsDate} BS` : ''}):`;
          const lines = unsubmitted.map(a => formatAssignmentSummaryItem(a, { includeSubmission: true }));
          sections.push(`${header}\n\n${lines.join('\n')}`);
        }
      }
    } else {
      const matches = state.assignments || [];
      if (matches.length === 0) {
        // Check if user asked a direct date countdown question with an explicit date in the message
        const dateDiffCalc = state.calculations.find(c => c.type === 'date_difference' && c.output?.valid);
        if (dateDiffCalc) {
          const out = dateDiffCalc.output;
          sections.push(
            `From today (**${out.referenceAdDate}** / **${out.referenceBsDate} BS**) until **${out.targetAdDate}** (${out.targetBsDate} BS): **${out.statusLabel}**.`
          );
        } else {
          const subjLabel = entities.subject ? ` for **${entities.subject}**` : '';
          sections.push(`I couldn't find any assignment records${subjLabel}${entities.semester ? ` in Semester ${entities.semester}` : ''} in Semester Library.`);
        }
      } else if (matches.length === 1) {
        const a = matches[0];
        const dl = a.deadlineInfo || {};
        const subjPart = a.subject ? ` (**${a.subject}**)` : '';
        const parts = [];

        if (!dl.hasDeadline) {
          parts.push(`The assignment **${a.title}**${subjPart} does **not** have a deadline specified in the official assignment record.`);
        } else if (!dl.validDeadline) {
          parts.push(`The assignment **${a.title}**${subjPart} lists a deadline of \`${dl.deadlineRaw}\`, which could not be resolved to a standard calendar date.`);
        } else {
          const dateLabel = `**${dl.adDate}**${dl.bsDate ? ` (**${dl.bsDate} BS**)` : ''}`;
          if (dl.isDueToday) {
            parts.push(`The assignment **${a.title}**${subjPart} is **due today** (${dateLabel} — **0 days remaining** as of ${clock.adDate}).`);
          } else if (dl.isUpcoming) {
            parts.push(`There ${dl.daysRemaining === 1 ? 'is **1 day remaining**' : `are **${dl.daysRemaining} days remaining**`} until the deadline for **${a.title}**${subjPart}, which is due on ${dateLabel} (current Nepal date: ${clock.adDate}${clock.bsDate ? ` / ${clock.bsDate} BS` : ''}).`);
          } else {
            parts.push(`The deadline for **${a.title}**${subjPart} was on ${dateLabel}, which is **overdue by ${dl.daysElapsed} day${dl.daysElapsed === 1 ? '' : 's'}** (0 days remaining as of ${clock.adDate}).`);
          }
        }

        if (academicContext?.authenticated && (academicContext?.role === 'student' || academicContext?.role === 'cr')) {
          if (a.fullySubmitted) {
            parts.push(`**Submission Status:** You have **submitted** this assignment (${a.mySubmissionCount}/${a.questionCount} question${a.questionCount === 1 ? '' : 's'} completed${a.latestSubmissionAt ? ` on ${String(a.latestSubmissionAt).slice(0, 10)}` : ''}).`);
          } else if (a.partiallySubmitted) {
            parts.push(`**Submission Status:** You have **partially submitted** this assignment (${a.mySubmissionCount} of ${a.questionCount} questions submitted; ${a.unsubmittedCount} still pending).`);
          } else {
            parts.push(`**Submission Status:** You have **not submitted** this assignment yet (${a.questionCount} question${a.questionCount === 1 ? '' : 's'} pending).`);
          }
        }

        sections.push(parts.join('\n\n'));
      } else {
        // Multiple assignments matched — distinguish them clearly!
        const subjPart = entities.subject ? ` for **${entities.subject}**` : '';
        const intro = `I found **${matches.length} matching assignments**${subjPart} (as of ${clock.adDate}${clock.bsDate ? ` / ${clock.bsDate} BS` : ''}). Here are the details for each:`;
        const lines = matches.map(a => formatAssignmentSummaryItem(a, { includeSubmission: Boolean(academicContext?.authenticated) }));
        const clarify = `Which of these assignments (${matches.map(a => `**${a.title}**`).join(' or ')}) would you like to focus on?`;
        sections.push(`${intro}\n\n${lines.join('\n')}\n\n${clarify}`);
      }
    }
  }

  // 2. Handle Next Examination / Routine Intents
  if (intents.includes('next_examination')) {
    const routineRows = state.routine || [];
    const examRes = resolveNextExamination(routineRows, referenceDate);
    if (routineRows.length === 0) {
      sections.push(`No examination routine records were found${entities.semester ? ` for Semester ${entities.semester}` : ''}.`);
    } else if (!examRes.nextExam) {
      const lastPast = examRes.pastExams[examRes.pastExams.length - 1];
      sections.push(
        `There are **no upcoming examinations** scheduled after today (${clock.adDate}${clock.bsDate ? ` / ${clock.bsDate} BS` : ''})${entities.semester ? ` for Semester ${entities.semester}` : ''}.` +
        (lastPast ? ` The most recent scheduled exam was **${lastPast.subject}** on ${lastPast.adDate} (${lastPast.bsDate} BS, ${lastPast.daysElapsed} days ago).` : '')
      );
    } else {
      const next = examRes.nextExam;
      const dateStr = `**${next.adDate}**${next.bsDate ? ` (**${next.bsDate} BS**)` : ''}`;
      const timeRoom = [next.exam_time || next.time, next.room ? `Room ${next.room.replace(/^room\s*/i, '')}` : null].filter(Boolean).join(', ');
      const countdown = next.isToday
        ? '**today (0 days remaining)**'
        : (next.daysRemaining === 1 ? '**tomorrow (1 day remaining)**' : `in **${next.daysRemaining} days**`);

      let msg = `Your next examination is **${next.subject}**${next.code ? ` (${next.code})` : ''}, scheduled on ${dateStr}${timeRoom ? ` at ${timeRoom}` : ''} — ${countdown} (as of ${clock.adDate}).`;
      if (examRes.upcomingExams.length > 1) {
        const others = examRes.upcomingExams.slice(1, 5).map(e =>
          `- **${e.subject}**${e.code ? ` (${e.code})` : ''}: ${e.adDate}${e.bsDate ? ` (${e.bsDate} BS)` : ''} — **${e.statusLabel}**`
        );
        msg += `\n\n**Subsequent Upcoming Exams:**\n${others.join('\n')}`;
      }
      sections.push(msg);
    }
  } else if (intents.includes('routine_lookup') && state.routine.length > 0) {
    sections.push(formatToolResult('get_routine', {
      semester: entities.semester,
      routine: state.routine
    }));
  }

  // 3. Handle Notices / Class Resumption / Conflicting or Outdated Notices
  if (intents.includes('class_resumption_notice') || intents.includes('notice_lookup')) {
    const notices = state.notices || [];
    const comparison = state.sourceComparisons[0] || compareAndResolveTemporalRecords(notices, referenceDate);

    if (notices.length === 0) {
      sections.push(`I couldn't find any official notices matching your request in Semester Library.`);
    } else if (comparison.hasOutdatedOnly) {
      const old = comparison.outdatedRecords[0];
      sections.push(
        `I found an older announcement — **${old.title || 'Notice'}** — which mentions **${old.effectiveAdDate}${old.effectiveBsDate ? ` (${old.effectiveBsDate} BS)` : ''}**, but that date is **outdated** and has **already passed** (current date: ${clock.adDate}${clock.bsDate ? ` / ${clock.bsDate} BS` : ''}).\n\n` +
        `There is **no current confirmed official notice** with an upcoming date for this event.`
      );
    } else if (comparison.authoritativeRecord) {
      const authRec = comparison.authoritativeRecord;
      const roleLabel = authRec.authorityTier === 1 ? 'Admin (Official)' : (authRec.authorityTier === 2 ? 'Faculty/Teacher' : 'Campus Notice');
      let msg = `According to the latest confirmed notice **${authRec.title || 'Official Notice'}** (${roleLabel}${authRec.publishedAdDate ? `, published ${authRec.publishedAdDate}` : ''}):\n\n${authRec.content || authRec.excerpt || ''}`;

      if (comparison.hasConflict && comparison.supersededRecords.length > 0) {
        const olderTitles = comparison.supersededRecords
          .filter(s => s.id !== authRec.id)
          .map(s => `"${s.title || 'Earlier Notice'}"${s.effectiveAdDate ? ` (${s.effectiveAdDate})` : ''}`);
        if (olderTitles.length > 0) {
          msg += `\n\n*Note: This newer confirmed official notice supersedes the earlier announcement (${olderTitles.join(', ')}).*`;
        }
      }
      sections.push(msg.trim());
    }
  }

  // 4. Handle Attendance & Cross-Subject Attendance Comparison
  if (intents.includes('attendance_comparison') || intents.includes('attendance_lookup')) {
    const att = state.attendance;
    if (!att) {
      sections.push('Could not retrieve attendance records.');
    } else if (att.clarification) {
      sections.push(att.clarification);
    } else {
      const formattedChart = formatToolResult('get_my_attendance', att);
      if (intents.includes('attendance_comparison') && att.comparison) {
        const comp = att.comparison;
        const compLines = [];
        if (comp.recordedCount >= 2 && comp.highestSubject && comp.lowestSubject) {
          compLines.push(
            `**Cross-Subject Attendance Comparison:**\n` +
            `- **Highest Attendance:** **${comp.highestSubject.name}** (${comp.highestSubject.code || 'N/A'}) at **${comp.highestSubject.attendancePercentage}%** (${comp.highestSubject.presentCount}/${comp.highestSubject.totalSessions} classes)\n` +
            `- **Lowest Recorded Attendance:** **${comp.lowestSubject.name}** (${comp.lowestSubject.code || 'N/A'}) at **${comp.lowestSubject.attendancePercentage}%** (${comp.lowestSubject.presentCount}/${comp.lowestSubject.totalSessions} classes)`
          );
          if (comp.lowAttendanceSubjects.length > 0) {
            compLines.push(
              `- **Below 50% (Low Attendance):** ${comp.lowAttendanceSubjects.map(s => `**${s.name}** (${s.attendancePercentage}%)`).join(', ')}`
            );
          }
        }
        sections.push([compLines.join('\n'), formattedChart].filter(Boolean).join('\n\n'));
      } else {
        sections.push(formattedChart);
      }
    }
  }

  // 5. Handle Personal Results / Marks
  if (intents.includes('results_lookup') && state.results) {
    if (state.results.clarification) {
      sections.push(state.results.clarification);
    } else {
      sections.push(formatToolResult('get_my_results', state.results));
    }
  }

  // 6. Handle Notes Lookup
  if (intents.includes('notes_lookup')) {
    const files = state.files || [];
    if (files.length > 0) {
      const topFiles = files.slice(0, 4);
      const fileLines = topFiles.map(f => {
        const excerpt = f.extractedContent || f.snippet || '';
        const cleanExcerpt = excerpt ? `\n  ${excerpt.replace(/\s+/g, ' ').slice(0, 260)}` : '';
        return `- **${f.title || f.originalName}** (${f.subject || 'Course Note'}${f.chapter ? `, ${f.chapter}` : ''})${cleanExcerpt}`;
      });
      sections.push(`Here are the relevant study notes from Semester Library:\n\n${fileLines.join('\n')}`);
    } else if (!intents.includes('academic_tutoring') && !fallbackAcademicExplanation) {
      sections.push(`No uploaded university notes were found for **${entities.topic || entities.subject || understanding.rawMessage}** in Semester Library.`);
    }
  }

  // 7. Handle Academic Tutoring (with University Notes + Academic Knowledge Fallback)
  if (intents.includes('academic_tutoring') || fallbackAcademicExplanation) {
    const files = state.files || [];
    if (files.length > 0 && !understanding.entities.programmingLanguage) {
      const top = files[0];
      const passage = top.extractedContent || top.snippet || '';
      if (passage) {
        sections.push(`Based on **${top.title || top.originalName}** (${top.subject || 'BIT'}${top.chapter ? `, ${top.chapter}` : ''}):\n\n${passage}`);
      }
    }
    if (fallbackAcademicExplanation) {
      const noteStatusPrefix = (files.length === 0)
        ? `*Note: No uploaded university notes were found in Semester Library for this topic, so here is an academic explanation based on the BIT curriculum:*\n\n`
        : '';
      sections.push(`${noteStatusPrefix}${fallbackAcademicExplanation}`);
    }
  }

  // 8. If a tool error occurred and no sections were produced, provide a graceful recovery message
  if (sections.length === 0 && state.toolErrors.length > 0) {
    sections.push(
      `I encountered a temporary issue retrieving one of the records (${state.toolErrors[0].tool}), so I could not verify the complete details right now. Please try again in a moment.`
    );
  }

  return sections.join('\n\n').trim();
}

/**
 * Generates a deterministic academic tutoring explanation (including C/Java/Python examples
 * when requested in a follow-up like "Give me an example in C" after "Explain linked lists").
 */
function buildAcademicTutoringFallback(understanding, state = {}) {
  const topic = understanding.entities.topic || understanding.entities.subject || understanding.rawMessage;
  const progLang = understanding.entities.programmingLanguage || 'C';
  const lowerTopic = String(topic || '').toLowerCase();

  if (understanding.intents.includes('syllabus_lookup') && state.courses?.length > 0) {
    const guide = buildDeterministicAcademicStudyGuide(understanding.rawMessage, state.courses, {
      unitNumber: understanding.entities.unitNumber
    });
    if (guide) return guide;
  }

  if (/\blinked\s*lists?\b/i.test(lowerTopic)) {
    const codeBlock = [
      '```c',
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '',
      'struct Node {',
      '    int data;',
      '    struct Node* next;',
      '};',
      '',
      'void printList(struct Node* head) {',
      '    struct Node* temp = head;',
      '    while (temp != NULL) {',
      '        printf("%d -> ", temp->data);',
      '        temp = temp->next;',
      '    }',
      '    printf("NULL\\n");',
      '}',
      '',
      'int main() {',
      '    struct Node* head = (struct Node*)malloc(sizeof(struct Node));',
      '    struct Node* second = (struct Node*)malloc(sizeof(struct Node));',
      '    head->data = 10;',
      '    head->next = second;',
      '    second->data = 20;',
      '    second->next = NULL;',
      '    printList(head);',
      '    free(second);',
      '    free(head);',
      '    return 0;',
      '}',
      '```'
    ].join('\n');

    return [
      `### Linked List (${understanding.entities.subject || 'Data Structure and Algorithms'})`,
      `A **linked list** is a linear data structure in which elements (called **nodes**) are stored in non-contiguous memory locations and linked using pointers. Each node contains:`,
      `- **Data field**: Stores the value of the element.`,
      `- **Next pointer**: Holds the memory address of the next node in the sequence.`,
      '',
      `#### Example in ${progLang}:`,
      codeBlock,
      '',
      `**Key Operations & Time Complexity:**`,
      `- Insertion at head: $O(1)$`,
      `- Traversal / Search: $O(n)$`,
      `- Deletion (given pointer to predecessor): $O(1)$`
    ].join('\n');
  }

  const baseExplanation = [
    `### ${topic}`,
    `**${topic}** is a core concept in **${understanding.entities.subject || 'the BIT curriculum'}**${understanding.entities.chapter ? ` (${understanding.entities.chapter})` : ''}.`,
    '',
    `- **Core Definition**: It provides a structured mechanism for organizing, processing, or managing data and system operations efficiently.`,
    `- **Key Principles**: Understanding its state transitions, invariants, and time/space trade-offs is essential for both coursework and examinations.`
  ];

  if (understanding.entities.programmingLanguage || /\b(example|code|program|implement)\b/i.test(understanding.rawMessage)) {
    baseExplanation.push(
      '',
      `#### Example in ${progLang}:`,
      '```c\n#include <stdio.h>\n\nint main() {\n    // Demonstration example\n    printf("Concept demonstration\\n");\n    return 0;\n}\n```'
    );
  }

  const rawReply = baseExplanation.join('\n');
  return enrichReplyWithAcademicVisuals(understanding.rawMessage, rawReply, {
    category: classifyAcademicCategory(understanding.rawMessage),
    courses: state.courses || []
  });
}

/**
 * SECTION 3 & 10: CONTROLLED AGENT PLANNING AND EXECUTION ENGINE
 * Executes the bounded loop:
 * UNDERSTAND -> PLAN -> SELECT TOOLS -> EXECUTE -> OBSERVE -> REPLAN -> VERIFY -> RESPOND
 */
async function runKyanaAgentLoop({
  db,
  message,
  history = [],
  academicContext = {},
  generateReply = null,
  onDelta = () => {},
  signal = null,
  referenceDate = new Date(),
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
  failTools = null,
  onBeforeToolCall = null
} = {}) {
  const startTimeMs = Date.now();
  const executionTrace = [];
  const toolCallsExecuted = [];
  const seenToolCalls = new Map();

  const checkAbortAndTimeout = () => {
    if (signal?.aborted) {
      const err = new Error('Agent execution cancelled.');
      err.code = 'ABORT_ERR';
      throw err;
    }
    if (Date.now() - startTimeMs > timeoutMs) {
      const err = new Error('Agent execution timed out.');
      err.code = 'AGENT_TIMEOUT';
      throw err;
    }
  };

  // STEP 1: UNDERSTAND
  checkAbortAndTimeout();
  const understanding = understandRequest(message, history, academicContext);
  const structuredContext = buildStructuredAgentContext(academicContext, history, referenceDate);

  // Enforce server-side cross-student / unauthorized personal record protection upfront
  const crossCheck = isOtherStudentDataRequest(message, academicContext);
  if (crossCheck.blocked) {
    const refusal = buildScopeRefusal(message, {
      category: 'cross_student',
      reason: crossCheck.reason,
      academicContext
    });
    executionTrace.push({
      phase: 'SECURITY_GATE',
      status: 'blocked',
      reason: crossCheck.reason
    });
    onDelta(refusal);
    return {
      handled: true,
      blockedBySecurity: true,
      reply: refusal,
      intent: 'cross_student_refusal',
      resourceCards: [],
      matchedFiles: [],
      matchedAssignments: [],
      matchedNotices: [],
      matchedRoutine: [],
      matchedCourses: [],
      agentTrace: {
        understanding,
        context: structuredContext,
        steps: executionTrace,
        toolCalls: [],
        verification: { authorized: false, blockedReason: crossCheck.reason }
      }
    };
  }

  // Create Dynamic Tool Registry
  const registry = createAgentToolRegistry(db, academicContext, {
    message,
    signal,
    referenceDate,
    failTools,
    onBeforeToolCall
  });

  // Helper to execute a single tool with duplicate prevention, bounds checking, and error recovery
  async function runBoundedTool(toolName, args = {}, iteration = 0) {
    checkAbortAndTimeout();
    if (toolCallsExecuted.length >= maxToolCalls) {
      executionTrace.push({
        phase: 'EXECUTE',
        iteration,
        tool: toolName,
        status: 'skipped_limit',
        reason: 'MAX_TOOL_CALLS_REACHED'
      });
      return { error: 'MAX_TOOL_CALLS_REACHED' };
    }

    const cleanArgs = Object.fromEntries(
      Object.entries(args || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const sig = `${toolName}:${JSON.stringify(cleanArgs)}`;
    if (seenToolCalls.has(sig)) {
      executionTrace.push({
        phase: 'EXECUTE',
        iteration,
        tool: toolName,
        args: cleanArgs,
        status: 'cached_duplicate'
      });
      return seenToolCalls.get(sig);
    }

    const t0 = Date.now();
    try {
      const output = await registry.executeTool(toolName, cleanArgs, {
        round: iteration,
        agentVerifiedStep: true,
        signal
      });
      const durationMs = Date.now() - t0;
      const sanitizedOutput = sanitizeUntrustedValue(output);
      seenToolCalls.set(sig, sanitizedOutput);
      toolCallsExecuted.push({
        iteration,
        tool: toolName,
        args: cleanArgs,
        durationMs,
        status: 'ok'
      });
      executionTrace.push({
        phase: 'EXECUTE',
        iteration,
        tool: toolName,
        args: cleanArgs,
        durationMs,
        status: 'ok'
      });
      return sanitizedOutput;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errEntry = {
        iteration,
        tool: toolName,
        args: cleanArgs,
        durationMs,
        status: 'error',
        error: err.message || String(err)
      };
      registry.collectedState.toolErrors.push(errEntry);
      toolCallsExecuted.push(errEntry);
      executionTrace.push({
        phase: 'EXECUTE',
        ...errEntry
      });
      return { error: true, tool: toolName, message: err.message || 'Tool execution failed' };
    }
  }

  // STEP 2: PLAN & MULTI-STEP EXECUTION LOOP
  const plannedQueue = [];
  const { intents, entities } = understanding;

  if (
    intents.includes('assignment_deadline') ||
    intents.includes('submission_status') ||
    intents.includes('unsubmitted_assignments') ||
    intents.includes('assignment_lookup')
  ) {
    if (entities.subject || understanding.rawMessage) {
      plannedQueue.push({
        tool: 'resolve_subject_topic',
        args: { query: entities.subject || understanding.rawMessage, semester: entities.semester }
      });
    }
    plannedQueue.push({
      tool: 'get_current_datetime',
      args: {}
    });

    // Also check if an explicit calendar date was passed in the query for direct date calculation
    const explicitDateInfo = parseNepaliDateExpression(understanding.rawMessage, referenceDate);
    if (explicitDateInfo && !explicitDateInfo.unresolvable && (explicitDateInfo.date || explicitDateInfo.bsDate)) {
      plannedQueue.push({
        tool: 'calculate_date_difference',
        args: {
          target_date: explicitDateInfo.bsDate && explicitDateInfo.calendar === 'BS' ? explicitDateInfo.bsDate : explicitDateInfo.date,
          calendar: explicitDateInfo.calendar || 'AD'
        }
      });
    }

    if (intents.includes('unsubmitted_assignments')) {
      plannedQueue.push({
        tool: 'check_submission_status',
        args: {
          ...(entities.subject ? { subject: entities.subject } : {}),
          only_unsubmitted: true
        }
      });
    } else if (intents.includes('submission_status')) {
      plannedQueue.push({
        tool: 'check_submission_status',
        args: {
          ...(entities.assignmentId ? { assignment_id: entities.assignmentId } : {}),
          ...(entities.subject ? { subject: entities.subject } : {}),
          ...(entities.assignmentTitle && !entities.assignmentId ? { query: entities.assignmentTitle } : {})
        }
      });
    } else {
      plannedQueue.push({
        tool: 'search_assignments',
        args: {
          ...(entities.subject ? { subject: entities.subject } : {}),
          ...(entities.semester ? { semester: entities.semester } : {})
        }
      });
    }
  }

  if (intents.includes('next_examination') || intents.includes('routine_lookup')) {
    if (!plannedQueue.some(p => p.tool === 'get_current_datetime')) {
      plannedQueue.push({ tool: 'get_current_datetime', args: {} });
    }
    plannedQueue.push({
      tool: 'get_routine',
      args: {
        ...(entities.semester ? { semester: entities.semester } : {}),
        ...(entities.subject ? { subject: entities.subject } : {})
      }
    });
  }

  if (intents.includes('class_resumption_notice') || intents.includes('notice_lookup')) {
    if (!plannedQueue.some(p => p.tool === 'get_current_datetime')) {
      plannedQueue.push({ tool: 'get_current_datetime', args: {} });
    }
    const noticeQuery = intents.includes('class_resumption_notice')
      ? 'classes resume reopen holiday vacation'
      : understanding.rawMessage;
    plannedQueue.push({
      tool: 'compare_sources',
      args: { query: noticeQuery }
    });
  }

  if (intents.includes('attendance_comparison') || intents.includes('attendance_lookup')) {
    plannedQueue.push({
      tool: 'get_my_attendance',
      args: {
        ...(entities.subject && !intents.includes('attendance_comparison') ? { subject: entities.subject } : {}),
        ...(entities.semester ? { semester: entities.semester } : {})
      }
    });
  }

  if (intents.includes('results_lookup')) {
    plannedQueue.push({
      tool: 'get_my_results',
      args: {
        ...(entities.subject ? { subject: entities.subject } : {}),
        ...(entities.semester ? { semester: entities.semester } : {})
      }
    });
  }

  if (intents.includes('notes_lookup') || intents.includes('academic_tutoring')) {
    plannedQueue.push({
      tool: 'search_notes',
      args: {
        query: entities.topic || understanding.rawMessage,
        ...(entities.subject ? { subject: entities.subject } : {}),
        ...(entities.semester ? { semester: entities.semester } : {}),
        ...(entities.chapter ? { chapter: entities.chapter } : {})
      }
    });
  }

  if (intents.includes('syllabus_lookup')) {
    plannedQueue.push({
      tool: 'get_syllabus',
      args: {
        ...(entities.semester ? { semester: entities.semester } : {}),
        ...(entities.subject ? { subject: entities.subject } : {}),
        ...(entities.unitNumber ? { unit: entities.unitNumber } : {})
      }
    });
  }

  if (intents.includes('subject_directory')) {
    plannedQueue.push({
      tool: 'search_subjects',
      args: {
        query: understanding.rawMessage,
        ...(entities.semester ? { semester: entities.semester } : {}),
        ...(entities.subject ? { subject: entities.subject } : {})
      }
    });
  }

  executionTrace.push({
    phase: 'PLAN',
    intents,
    initialSteps: plannedQueue.map(p => ({ tool: p.tool, args: p.args }))
  });

  // Execute the bounded reasoning & replanning loop
  let iteration = 0;
  while (iteration < maxIterations && plannedQueue.length > 0 && toolCallsExecuted.length < maxToolCalls) {
    checkAbortAndTimeout();
    const currentStep = plannedQueue.shift();
    const stepOutput = await runBoundedTool(currentStep.tool, currentStep.args, iteration);

    // OBSERVE & REPLAN: Use one tool's output to inform the next tool call
    if (currentStep.tool === 'resolve_subject_topic' && stepOutput && !stepOutput.error && stepOutput.subject) {
      if (!entities.subject) {
        entities.subject = stepOutput.subject;
        entities.subjectCode = stepOutput.code || entities.subjectCode;
      }
      for (const nextStep of plannedQueue) {
        if (['search_assignments', 'check_submission_status', 'search_notes', 'get_syllabus'].includes(nextStep.tool) && !nextStep.args.subject) {
          nextStep.args.subject = stepOutput.subject;
        }
      }
    }

    // If search_assignments failed (e.g., simulated tool failure in Scenario 17), replan to fallback tool (`get_assignment_details` or `check_submission_status`)
    if (currentStep.tool === 'search_assignments' && stepOutput && stepOutput.error) {
      executionTrace.push({
        phase: 'REPLAN',
        iteration,
        reason: 'search_assignments_failed_fallback_to_get_assignment_details'
      });
      if (!plannedQueue.some(p => p.tool === 'get_assignment_details')) {
        plannedQueue.unshift({
          tool: 'get_assignment_details',
          args: {
            ...(entities.subject ? { subject: entities.subject } : {}),
            ...(entities.semester ? { semester: entities.semester } : {})
          }
        });
      }
    }

    // If search_assignments or get_assignment_details succeeded and returned assignment(s), chain calculate_deadline_status
    if (
      (currentStep.tool === 'search_assignments' || currentStep.tool === 'get_assignment_details' || currentStep.tool === 'check_submission_status') &&
      stepOutput &&
      !stepOutput.error &&
      Array.isArray(stepOutput.assignments) &&
      stepOutput.assignments.length > 0
    ) {
      const firstWithDeadline = stepOutput.assignments.find(a => a.deadline);
      if (firstWithDeadline && intents.includes('assignment_deadline') && !plannedQueue.some(p => p.tool === 'calculate_deadline_status')) {
        plannedQueue.push({
          tool: 'calculate_deadline_status',
          args: {
            deadline: String(firstWithDeadline.deadline),
            submitted: Boolean(firstWithDeadline.submitted)
          }
        });
      }
    }

    // If search_notes returned files without extractedContent, read the top note file in the next step
    if (
      currentStep.tool === 'search_notes' &&
      stepOutput &&
      !stepOutput.error &&
      Array.isArray(stepOutput.files) &&
      stepOutput.files.length > 0 &&
      !stepOutput.files[0].extractedContent
    ) {
      const topFileId = Number(stepOutput.files[0].id);
      if (Number.isInteger(topFileId) && topFileId > 0) {
        executionTrace.push({
          phase: 'REPLAN',
          iteration,
          reason: 'read_top_note_file_content',
          fileId: topFileId
        });
        plannedQueue.unshift({
          tool: 'read_note_file',
          args: {
            file_id: topFileId,
            query: entities.topic || understanding.rawMessage
          }
        });
      }
    }

    // If search_notes returned 0 files (or failed) on an academic tutoring query, replan to check syllabus so we can ground the academic fallback in the BIT curriculum
    if (
      currentStep.tool === 'search_notes' &&
      (stepOutput?.error || !Array.isArray(stepOutput?.files) || stepOutput.files.length === 0) &&
      (intents.includes('academic_tutoring') || intents.includes('notes_lookup')) &&
      entities.subject &&
      !plannedQueue.some(p => p.tool === 'get_syllabus')
    ) {
      executionTrace.push({
        phase: 'REPLAN',
        iteration,
        reason: 'notes_unavailable_check_syllabus_for_tutoring_fallback'
      });
      plannedQueue.push({
        tool: 'get_syllabus',
        args: {
          subject: entities.subject,
          ...(entities.semester ? { semester: entities.semester } : {})
        }
      });
    }

    iteration += 1;
  }

  // STEP 3: VERIFY EVIDENCE
  const verification = await runBoundedTool('verify_evidence', { intent: understanding.primaryIntent }, iteration);
  executionTrace.push({
    phase: 'VERIFY',
    verification
  });

  // STEP 4: RESPOND
  let fallbackAcademicExplanation = null;
  if (
    intents.includes('academic_tutoring') ||
    (intents.includes('notes_lookup') && registry.collectedState.files.length === 0 && (entities.topic || mapsToBitSyllabus(message)))
  ) {
    fallbackAcademicExplanation = buildAcademicTutoringFallback(understanding, registry.collectedState);
  }

  let finalReply = synthesizeVerifiedAgentResponse({
    understanding,
    registry,
    verification,
    academicContext,
    referenceDate,
    fallbackAcademicExplanation
  });

  if (!finalReply && typeof generateReply === 'function') {
    const llmRes = await generateReply({
      message,
      history,
      systemPrompt: 'You are Kyana, the Gandaki University BIT academic assistant. Answer concisely using only verified evidence.',
      tools: registry.tools,
      executeTool: (name, args, meta) => runBoundedTool(name, args, meta?.round || 0),
      onDelta,
      signal,
      maxToolRounds: 4,
      agentVerifiedStep: true
    });
    finalReply = String(llmRes?.reply || '').trim();
  }

  if (!finalReply) {
    finalReply = `I couldn't find matching records in Semester Library for that request.`;
  }

  // Revalidate resource cards server-side through kyana-access
  let verifiedCards = registry.collectedState.resourceCards;
  try {
    if (db && (typeof db.get === 'function' || typeof db.query === 'function') && verifiedCards.length > 0) {
      const revalidated = await revalidateCards(db, academicContext, verifiedCards);
      if (Array.isArray(revalidated) && revalidated.length > 0) {
        verifiedCards = revalidated;
      }
    }
  } catch (_) {}

  onDelta(finalReply);

  executionTrace.push({
    phase: 'RESPOND',
    durationMs: Date.now() - startTimeMs,
    cardsCount: verifiedCards.length
  });

  return {
    handled: true,
    reply: finalReply,
    intent: understanding.primaryIntent,
    intents: understanding.intents,
    resourceCards: verifiedCards,
    matchedFiles: registry.collectedState.files,
    matchedAssignments: registry.collectedState.assignments,
    matchedNotices: registry.collectedState.notices,
    matchedRoutine: registry.collectedState.routine,
    matchedCourses: registry.collectedState.courses,
    agentTrace: {
      understanding,
      context: structuredContext,
      steps: executionTrace,
      toolCalls: toolCallsExecuted,
      verification
    }
  };
}

/**
 * Determines whether an incoming chat request should be handled by Kyana Agent Engine V1.
 */
function shouldUseKyanaAgentEngine(message, history = [], academicContext = {}) {
  const raw = String(message || '').trim();
  if (!raw) return false;
  const u = understandRequest(raw, history, academicContext);

  // 1. Any assignment deadline countdown, submission check, or unsubmitted assignment query
  if (
    u.intents.includes('assignment_deadline') ||
    u.intents.includes('submission_status') ||
    u.intents.includes('unsubmitted_assignments')
  ) {
    return true;
  }

  // 2. "What about my assignment?" or deictic assignment follow-ups
  if (u.intents.includes('assignment_lookup') && (u.hasDeicticReference || /\bmy\s+assignments?\b|\bmero\s+assignments?\b/i.test(raw))) {
    return true;
  }

  // 3. "When is the next exam?" / upcoming exam countdown
  if (u.intents.includes('next_examination')) {
    return true;
  }

  // 4. Multi-step questions combining 2+ distinct intents (e.g. assignment + notes, exam + attendance)
  if (u.intents.length >= 2) {
    return true;
  }

  // 5. Cross-subject attendance comparison ("Compare my attendance across subjects", "Which subject has my lowest attendance?")
  if (u.intents.includes('attendance_comparison')) {
    return true;
  }

  return false;
}

module.exports = {
  resolveAcademicEntity,
  resolveConversationContext,
  understandRequest,
  buildStructuredAgentContext,
  createAgentToolRegistry,
  verifyAgentEvidence,
  runKyanaAgentLoop,
  shouldUseKyanaAgentEngine,
  buildAcademicTutoringFallback
};
