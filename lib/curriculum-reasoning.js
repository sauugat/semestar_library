'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Load syllabus data from public or root
let syllabusData = null;
try {
  syllabusData = require('../public/syllabus-data.json');
} catch (_) {
  try {
    syllabusData = require('../syllabus-data.json');
  } catch (e) {
    console.error('[Curriculum Reasoning] Failed to load syllabus-data.json:', e.message);
    syllabusData = { semesters: [] };
  }
}

const ROMAN_MAP = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

// Technical acronyms, abbreviations, and curriculum synonyms
const ACRONYMS_AND_SYNONYMS = {
  jit: {
    canonical: 'Just-in-Time Compiler (JIT)',
    expanded: ['just in time compiler', 'just in time compilation', 'jit compiler', 'bytecode', 'jvm', 'java virtual machine', 'runtime compilation', 'jdk', 'jre'],
    candidateSubjects: ['Computer Programming II (Java)'],
    candidateSemesters: [2]
  },
  css: {
    canonical: 'Cascading Style Sheets (CSS)',
    expanded: ['cascading style sheets', 'css3', 'css selectors', 'box model', 'flexbox', 'grid', 'styling', 'styles', 'pseudo class', 'pseudo element', 'responsive design'],
    candidateSubjects: ['Web Technology I', 'Web Technology II'],
    candidateSemesters: [2, 3]
  },
  dbms: {
    canonical: 'Database Management System',
    expanded: ['database management system', 'relational database', 'rdbms', 'sql', 'queries', 'normalization', 'relational algebra', 'er diagram', 'transaction management'],
    candidateSubjects: ['Database Management System'],
    candidateSemesters: [3]
  },
  normalization: {
    canonical: 'Database Normalization',
    expanded: ['database normalization', 'normal forms', '1nf', '2nf', '3nf', 'bcnf', 'functional dependency', 'redundancy elimination', 'lossless decomposition', 'multivalued dependency'],
    candidateSubjects: ['Database Management System'],
    candidateSemesters: [3]
  },
  deadlock: {
    canonical: 'Deadlock & Process Synchronization',
    expanded: ['deadlock prevention', 'deadlock avoidance', 'deadlock detection', 'bankers algorithm', 'coffman conditions', 'circular wait', 'resource allocation graph', 'mutual exclusion', 'hold and wait'],
    candidateSubjects: ['Operating Systems'],
    candidateSemesters: [4]
  },
  cookies: {
    canonical: 'Session and Cookie Management',
    expanded: ['session management', 'cookie management', 'http cookies', 'session tracking', 'set cookie', 'state management', 'php session', 'session id', 'stateless http'],
    candidateSubjects: ['Web Technology I', 'Web Technology II'],
    candidateSemesters: [2, 3]
  },
  sessions: {
    canonical: 'Session and Cookie Management',
    expanded: ['session management', 'cookie management', 'http cookies', 'session tracking', 'set cookie', 'state management', 'php session', 'session id', 'stateless http'],
    candidateSubjects: ['Web Technology I', 'Web Technology II'],
    candidateSemesters: [2, 3]
  },
  os: {
    canonical: 'Operating Systems',
    expanded: ['operating systems', 'process scheduling', 'virtual memory', 'paging', 'deadlock', 'ipc', 'file systems', 'concurrency', 'semaphores', 'threads'],
    candidateSubjects: ['Operating Systems'],
    candidateSemesters: [4]
  },
  dsa: {
    canonical: 'Data Structures and Algorithms',
    expanded: ['data structure and algorithms', 'arrays', 'linked lists', 'stacks', 'queues', 'trees', 'binary search tree', 'graphs', 'sorting', 'searching', 'asymptotic analysis'],
    candidateSubjects: ['Data Structure and Algorithms'],
    candidateSemesters: [3]
  },
  ipc: {
    canonical: 'Inter-Process Communication (IPC)',
    expanded: ['inter process communication', 'pipes', 'message queues', 'shared memory', 'semaphores', 'synchronization', 'signals'],
    candidateSubjects: ['Operating Systems'],
    candidateSemesters: [4]
  },
  oop: {
    canonical: 'Object-Oriented Programming',
    expanded: ['object oriented programming', 'classes', 'objects', 'inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'interfaces', 'method overloading', 'method overriding'],
    candidateSubjects: ['Computer Programming II (Java)'],
    candidateSemesters: [2]
  },
  jvm: {
    canonical: 'Java Virtual Machine (JVM)',
    expanded: ['java virtual machine', 'bytecode', 'classloader', 'execution engine', 'garbage collection', 'jit compiler', 'jdk', 'jre'],
    candidateSubjects: ['Computer Programming II (Java)'],
    candidateSemesters: [2]
  },
  fsm: {
    canonical: 'Finite State Machines & Automata',
    expanded: ['finite state machine', 'finite automata', 'dfa', 'nfa', 'regular grammar', 'context free grammar', 'turing machine', 'transition diagram'],
    candidateSubjects: ['Discrete Mathematics'],
    candidateSemesters: [2]
  },
  kmap: {
    canonical: 'Karnaugh Map (K-Map)',
    expanded: ['karnaugh map', 'k map', 'boolean simplification', 'sop', 'pos', 'logic minimization', 'dont care conditions', 'prime implicants'],
    candidateSubjects: ['Digital Logic'],
    candidateSemesters: [2]
  },
  microprocessor: {
    canonical: 'Microprocessor Architecture (8085 / 8086)',
    expanded: ['8085 microprocessor', '8086', 'instruction cycle', 'addressing modes', 'pin diagram', 'timing diagram', 'assembly language', 'interrupts', 'registers'],
    candidateSubjects: ['Microprocessor and Computer Architecture'],
    candidateSemesters: [3]
  },
  networking: {
    canonical: 'Computer Networks & Data Communication',
    expanded: ['computer networks', 'osi model', 'tcp ip', 'routing', 'subnetting', 'ip addressing', 'switching', 'protocols', 'lan', 'wan'],
    candidateSubjects: ['Data Communication and Computer Networks'],
    candidateSemesters: [4]
  }
};

/**
 * Builds an in-memory inverted index of courses, units, and subtopics from the BIT syllabus.
 */
function buildCurriculumIndex() {
  const coursesList = [];
  const unitIndex = [];
  const termMap = new Map();

  if (!syllabusData || !Array.isArray(syllabusData.semesters)) {
    return { coursesList, unitIndex, termMap };
  }

  for (const sem of syllabusData.semesters) {
    const semNum = ROMAN_MAP[String(sem.semester || '').toUpperCase()] || Number(sem.semester) || null;
    const courses = Array.isArray(sem.courses) ? sem.courses : [];

    for (const c of courses) {
      const code = String(c.code || '').trim();
      const title = String(c.title || '').trim();
      const rawContents = String(c.contents || '');
      const objectives = String(c.objectives || c.description || '');

      // Parse units
      const units = [];
      const lines = rawContents.split(/\r?\n/);
      let currentUnit = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const isSubtopic = /^\d+\.\d+/.test(trimmed);
        const m = !isSubtopic && trimmed.match(/^(?:Unit\s+)?(\d{1,2})\s*[.:-]\s*(.+?)(?:\s*\(?(\d+\s*(?:hrs?|hours?)\.?)\)?)?$/i);
        if (m && (m[3] || line.search(/\S/) <= 2)) {
          if (currentUnit) {
            currentUnit.topics = currentUnit.topicLines.join('\n');
            delete currentUnit.topicLines;
            units.push(currentUnit);
          }
          currentUnit = {
            unitNumber: Number(m[1]),
            title: m[2].replace(/\s+/g, ' ').trim(),
            teachingHours: m[3] ? m[3].trim() : null,
            topicLines: []
          };
        } else if (currentUnit) {
          currentUnit.topicLines.push(trimmed);
        }
      }
      if (currentUnit) {
        currentUnit.topics = currentUnit.topicLines.join('\n');
        delete currentUnit.topicLines;
        units.push(currentUnit);
      }

      const courseRecord = {
        code,
        title,
        semester: semNum,
        objectives,
        units,
        rawContents
      };
      coursesList.push(courseRecord);

      for (const u of units) {
        const uRec = {
          courseTitle: title,
          courseCode: code,
          semester: semNum,
          unitNumber: u.unitNumber,
          unitTitle: u.title,
          teachingHours: u.teachingHours,
          topicsText: u.topics || ''
        };
        unitIndex.push(uRec);

        // Tokenize unit title and topics
        const combined = `${title} ${u.title} ${u.topics || ''}`.toLowerCase();
        const tokens = combined.match(/[\p{L}\p{N}]+/gu) || [];
        for (const token of tokens) {
          if (token.length >= 3) {
            if (!termMap.has(token)) termMap.set(token, []);
            termMap.get(token).push(uRec);
          }
        }
      }
    }
  }

  return { coursesList, unitIndex, termMap };
}

const curriculumIndex = buildCurriculumIndex();

/**
 * Normalizes text for academic topic extraction and matching.
 */
function cleanText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts pure academic topic from any conversational student query.
 * Removes phrases like "give me notes of", "explain", "what is", "teach me", "hamro", "ko barema", etc.
 */
function extractAcademicTopic(query) {
  const raw = String(query || '').trim();
  if (!raw) return '';

  let cleaned = raw
    // English query conversational preambles
    .replace(/^(?:can\s+you\s+)?(?:please\s+)?(?:give|show|provide|send|find|fetch|get)\s+(?:me\s+)?(?:the\s+)?(?:study\s+)?(?:notes?|materials?|slides?|pdf|files?|handouts?)\s+(?:of|for|on|about|regarding)\s+/i, '')
    .replace(/^(?:can\s+you\s+)?(?:please\s+)?(?:explain|describe|clarify|teach\s+me|elaborate\s+on|tell\s+me\s+about|what\s+is|what\s+are|define|how\s+does|how\s+do)\s+/i, '')
    .replace(/^(?:i\s+want\s+to\s+learn\s+about|i\s+need\s+notes\s+(?:on|for|of)|help\s+me\s+with|overview\s+of|summary\s+of)\s+/i, '')
    // Nepali / Roman Nepali conversational phrases
    .replace(/^(?:hamro\s+)?(?:mero\s+)?(?:yo\s+)?(?:tyo\s+)?/i, '')
    .replace(/\s+(?:ko\s+)?(?:notes?|materials?|pdf|slide|bujhaideu|bujhauna|sikhaideu|explain\s+gara|padhaideu|ko\s+barema\s+bataideu|vandeu|bhannus)[?.!।]*$/i, '')
    .replace(/[?.!।]+$/g, '')
    .trim();

  // If wrapped in quotes, unwrap
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
  return cleaned || raw;
}

/**
 * Checks whether a query is requesting an academic concept, notes, study material, or explanation.
 */
function isAcademicTopicQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  // Explicit non-academic institutional inquiries (dates, routines, holidays, notices, admin, attendance, results)
  if (
    /\b(when\s+is\s+(?:the\s+)?exam|exam\s+routine|exam\s+schedule|timetable|routine\s+for|when\s+will\s+classes\s+resume|reopen|holiday|vacation|bida|chutti|notice|notices|circular|announcement|attendance|my\s+marks|my\s+results|cgpa|percentage)\b/i.test(lower) &&
    !/\b(notes?|slides?|pdf|study\s+materials?|syllabus|explain|define|concept|what\s+is|what\s+are)\b/i.test(lower)
  ) {
    return false;
  }

  // Academic triggers
  if (
    /\b(notes?|study\s+materials?|handouts?|slides?|lecture\s+notes?)\b/i.test(lower) ||
    /\b(explain|what\s+is|what\s+are|define|how\s+does|how\s+do|difference\s+between|compare\s+[a-z0-9\s]+\s+and|teach\s+me|bujhaideu|bujhau|bujhauna)\b/i.test(lower) ||
    /\b(syllabus|curriculum|course\s+outline|unit\s*[1-8]|chapter\s*\d+)\b/i.test(lower)
  ) {
    return true;
  }

  // Check if topic matches known technical concepts or syllabus units
  const topic = extractAcademicTopic(raw);
  const normTopic = cleanText(topic);
  if (!normTopic || normTopic.length < 2) return false;
  if (normTopic.length < 3 && !['os', 'ai', 'db', 'js', 'ui', 'ux', 'ip', 'ml'].includes(normTopic)) return false;

  if (ACRONYMS_AND_SYNONYMS[normTopic]) return true;
  for (const acr of Object.keys(ACRONYMS_AND_SYNONYMS)) {
    const entry = ACRONYMS_AND_SYNONYMS[acr];
    if (normTopic === acr || entry.expanded.some(e => normTopic === e || (normTopic.length >= 4 && (normTopic.includes(e) || e.includes(normTopic))))) {
      return true;
    }
  }

  // Check if query matches syllabus courses or unit titles
  for (const c of curriculumIndex.coursesList) {
    const cTitleLower = c.title.toLowerCase();
    if (cTitleLower === normTopic || (normTopic.length >= 4 && (cTitleLower.includes(normTopic) || normTopic.includes(cTitleLower)))) return true;
  }

  return false;
}

/**
 * Reasons about a student query to determine which academic concepts, courses,
 * semesters, and syllabus units it relates to.
 */
function reasonCurriculum(query) {
  const raw = String(query || '').trim();
  const extractedTopic = extractAcademicTopic(raw);
  const normTopic = cleanText(extractedTopic);
  const normRaw = cleanText(raw);

  const matchedConcepts = [];
  const candidateSubjects = new Set();
  const candidateSemesters = new Set();
  const matchedUnits = [];
  const expandedTerms = new Set([extractedTopic.toLowerCase()]);

  // 1. Check known acronyms and technical definitions
  if (normTopic.length >= 2) {
    for (const [key, def] of Object.entries(ACRONYMS_AND_SYNONYMS)) {
      const keyMatch = normTopic === key || new RegExp(`\\b${key}\\b`, 'i').test(raw);
      const expMatch = def.expanded.some(exp => normTopic === exp || (normTopic.length >= 4 && (normTopic.includes(exp) || exp.includes(normTopic))));

      if (keyMatch || expMatch) {
        matchedConcepts.push(def.canonical);
        for (const subj of def.candidateSubjects) candidateSubjects.add(subj);
        for (const sem of def.candidateSemesters) candidateSemesters.add(sem);
        for (const exp of def.expanded) expandedTerms.add(exp);
        expandedTerms.add(key);
      }
    }
  }

  // 2. Scan syllabus course titles and codes
  if (normTopic.length >= 2) {
    for (const c of curriculumIndex.coursesList) {
      const cTitleLower = c.title.toLowerCase();
      const cCodeLower = c.code.toLowerCase();
      if ((normTopic.length >= 4 && (cTitleLower.includes(normTopic) || normTopic.includes(cTitleLower))) ||
          cTitleLower === normTopic ||
          new RegExp(`\\b${cCodeLower}\\b`, 'i').test(raw)) {
        candidateSubjects.add(c.title);
        if (c.semester) candidateSemesters.add(c.semester);
      }
    }
  }

  // 3. Scan syllabus units and subtopics
  for (const u of curriculumIndex.unitIndex) {
    const uTitleLower = u.unitTitle.toLowerCase();
    const topicsLower = (u.topicsText || '').toLowerCase();

    // Check if unit title matches topic
    const titleMatch = (normTopic.length >= 3 && (uTitleLower.includes(normTopic) || normTopic.includes(uTitleLower))) ||
      (normRaw.length >= 3 && uTitleLower.includes(normRaw));

    // Check if unit contains any expanded term
    const termMatch = [...expandedTerms].some(t => t.length >= 3 && (uTitleLower.includes(t) || topicsLower.includes(t)));

    if (titleMatch || termMatch) {
      candidateSubjects.add(u.courseTitle);
      if (u.semester) candidateSemesters.add(u.semester);
      if (!matchedUnits.some(existing => existing.courseTitle === u.courseTitle && existing.unitNumber === u.unitNumber)) {
        matchedUnits.push({
          courseTitle: u.courseTitle,
          courseCode: u.courseCode,
          semester: u.semester,
          unitNumber: u.unitNumber,
          unitTitle: u.unitTitle,
          teachingHours: u.teachingHours,
          topicsText: u.topicsText
        });
      }
    }
  }

  // Fallback defaults if nothing was found
  const candidateSubjectsArr = [...candidateSubjects];
  const candidateSemestersArr = [...candidateSemesters].sort((a, b) => a - b);
  const isNotesIntent = /\b(notes?|slides?|pdf|study\s+materials?)\b/i.test(raw);
  const isExplainIntent = /\b(explain|what\s+is|what\s+are|define|how\s+does|how\s+do|bujhaideu|bujhau)\b/i.test(raw);

  return {
    found: candidateSubjectsArr.length > 0 || matchedConcepts.length > 0,
    topic: extractedTopic,
    canonicalSubject: candidateSubjectsArr[0] || null,
    candidateSubjects: candidateSubjectsArr,
    candidateSemesters: candidateSemestersArr,
    matchedConcepts,
    units: matchedUnits,
    expandedTerms: [...expandedTerms],
    isAcademic: isAcademicTopicQuery(raw),
    intent: isNotesIntent ? 'notes' : (isExplainIntent ? 'explain' : 'general')
  };
}

/**
 * Returns candidate subject names for a topic query.
 */
function getCandidateSubjects(query) {
  const r = reasonCurriculum(query);
  return r.candidateSubjects;
}

/**
 * Returns candidate semester numbers for a topic query.
 */
function getCandidateSemesters(query) {
  const r = reasonCurriculum(query);
  return r.candidateSemesters;
}

/**
 * Drop-in dynamic replacement for `resolveSyllabusConcept`.
 */
function resolveSyllabusConcept(query) {
  const r = reasonCurriculum(query);
  if (!r.found && r.candidateSubjects.length === 0) return null;

  const topUnit = r.units[0];
  return {
    topic: r.topic || r.matchedConcepts[0] || 'Academic Topic',
    canonicalSubject: r.candidateSubjects[0] || 'General',
    semesterNum: r.candidateSemesters[0] || null,
    unit: topUnit ? `Unit ${topUnit.unitNumber}: ${topUnit.unitTitle}` : null,
    candidateSubjects: r.candidateSubjects,
    candidateSemesters: r.candidateSemesters,
    matchedSynonyms: r.expandedTerms
  };
}

/**
 * Generates an authoritative curriculum-grounded explanation when no course notes
 * are found in Semester Library.
 */
function generateCurriculumExplanation(topicOrQuery, options = {}) {
  const r = reasonCurriculum(topicOrQuery);
  const topic = r.topic || topicOrQuery;
  const subject = r.candidateSubjects[0] || options.subject || 'BIT Curriculum';
  const unit = r.units[0];
  const lowerTopic = String(topic || '').toLowerCase();

  // Curated high-yield curriculum explanations for core topics
  if (/\b(jit|just[- ]in[- ]time)\b/i.test(lowerTopic) || (r.matchedConcepts.some(c => /jit/i.test(c)))) {
    return [
      `### Just-in-Time Compiler (JIT) — Computer Programming II (Java) · Semester 2`,
      '',
      `The **Just-in-Time (JIT) Compiler** is a core component of the **Java Virtual Machine (JVM)** execution engine designed to turn Java bytecode into high-performance native machine code at runtime.`,
      '',
      `#### 1. How It Works (Bytecode to Native Code)`,
      `- **Compilation Phase:** The Java Compiler (\`javac\`) converts source code (\`.java\`) into platform-independent intermediate **bytecode** (\`.class\`).`,
      `- **Interpretation vs JIT:** By default, the JVM interpreter executes bytecode instruction-by-instruction, which is safe and portable but slower than compiled languages.`,
      `- **Hotspot Detection:** The JVM monitors running code to identify frequently executed sections ("hotspots", such as tight loops and heavily invoked methods).`,
      `- **Native Compilation & Caching:** The JIT compiler compiles these hotspots directly into native machine instructions for the host CPU and caches them in memory (Code Cache). Subsequent calls execute native machine code directly with zero interpretation overhead.`,
      '',
      `#### 2. Key Advantages`,
      `- **Speed & Throughput:** Delivers near C/C++ execution speeds for long-running server processes.`,
      `- **Adaptive Optimization:** Employs runtime profiling (inlining, loop unrolling, escape analysis) tailored to the actual workload.`,
      '',
      `#### 3. Summary Invariant`,
      `- Java achieves **"Write Once, Run Anywhere"** via bytecode and achieves **native execution speed** via JIT compilation.`
    ].join('\n');
  }

  if (/\b(css|cascading\s+style\s+sheets?)\b/i.test(lowerTopic)) {
    return [
      `### Cascading Style Sheets (CSS) — Web Technology I · Semester 2`,
      '',
      `**Cascading Style Sheets (CSS)** is the foundational style sheet language used to specify the presentation, layout, and visual formatting of HTML documents.`,
      '',
      `#### 1. Core Syntax & Rule Structure`,
      `A CSS rule consists of a **selector** and a **declaration block**:`,
      '```css',
      'selector {',
      '  property: value;',
      '}',
      '```',
      '',
      `#### 2. CSS Selectors Hierarchy`,
      `- **Element / Type Selector:** Targets all instances of a tag (\`p\`, \`h1\`, \`div\`).`,
      `- **Class Selector:** Targets elements with a class attribute (\`.btn\`, \`.card\`).`,
      `- **ID Selector:** Targets a unique element with an ID attribute (\`#header\`, \`#nav\`).`,
      `- **Pseudo-Classes & Pseudo-Elements:** Style states like hover (\`:hover\`, \`:focus\`) and specific parts of elements (\`::before\`, \`::after\`).`,
      '',
      `#### 3. The CSS Box Model`,
      `Every rendered element is structured as a rectangular box:`,
      `1. **Content:** The actual text, image, or media.`,
      `2. **Padding:** Transparent spacing clearing the area around the content.`,
      `3. **Border:** A border wrapping around the padding and content.`,
      `4. **Margin:** Transparent spacing clearing an area outside the border to separate adjacent elements.`
    ].join('\n');
  }

  if (/\b(normalization|normal\s+form|1nf|2nf|3nf|bcnf)\b/i.test(lowerTopic)) {
    return [
      `### Database Normalization — Database Management System · Semester 3`,
      '',
      `**Database Normalization** is the systematic technique of organizing relational database schemas to **minimize data redundancy** and **eliminate update, insertion, and deletion anomalies** while preserving data integrity and functional dependencies.`,
      '',
      `#### 1. Normal Forms Progression`,
      `- **First Normal Form (1NF):** Every attribute value must be atomic (indivisible single values), no repeating groups or arrays.`,
      `- **Second Normal Form (2NF):** Must be in 1NF, and every non-prime attribute must be fully functionally dependent on the entire primary key (no partial dependency).`,
      `- **Third Normal Form (3NF):** Must be in 2NF, and no non-prime attribute may transitively depend on the primary key via another non-prime attribute (no transitive dependency).`,
      `- **Boyce-Codd Normal Form (BCNF):** A stricter version of 3NF where for every non-trivial functional dependency $X \\rightarrow Y$, $X$ must be a super key.`,
      '',
      `#### 2. Key Takeaways`,
      `- Normalization decomposes large tables into smaller, well-structured relations joined by foreign keys to ensure lossless join and dependency preservation.`
    ].join('\n');
  }

  if (/\b(deadlock|banker|coffman)\b/i.test(lowerTopic)) {
    return [
      `### Deadlock & Prevention — Operating Systems · Semester 4`,
      '',
      `A **Deadlock** is a state in concurrent systems where a set of processes are blocked because every process holds a resource and waits for another resource held by another process in the same set.`,
      '',
      `#### 1. The Four Coffman Conditions (Must all hold simultaneously for deadlock)`,
      `1. **Mutual Exclusion:** At least one resource must be held in a non-shareable mode.`,
      `2. **Hold and Wait:** A process holding at least one resource must be waiting to acquire additional resources held by other processes.`,
      `3. **No Preemption:** Resources cannot be forcibly taken; they can only be released voluntarily by the holding process.`,
      `4. **Circular Wait:** A closed chain of processes exists such that each process holds resources needed by the next process in the chain.`,
      '',
      `#### 2. Deadlock Handling Strategies`,
      `- **Deadlock Prevention:** Design protocols that invalidate at least one of the four Coffman conditions (e.g., impose total resource ordering to eliminate circular wait).`,
      `- **Deadlock Avoidance:** Dynamically evaluate resource requests using algorithms like the **Banker's Algorithm** to ensure the system never enters an unsafe state.`,
      `- **Deadlock Detection & Recovery:** Allow the system to enter deadlock, periodically run detection algorithms (resource allocation graphs), and recover by terminating processes or preempting resources.`
    ].join('\n');
  }

  if (/\b(cookies?|sessions?|session\s+management|cookie\s+management)\b/i.test(lowerTopic)) {
    return [
      `### Session & Cookie Management — Web Technology I · Semester 2`,
      '',
      `Because **HTTP is a stateless protocol**, servers do not automatically retain user identity across distinct requests. **Cookies and Sessions** provide client-side and server-side state persistence.`,
      '',
      `#### 1. How Cookies Work (Client-Side State)`,
      `- Small text data (up to ~4 KB) sent by the server using the \`Set-Cookie\` response header.`,
      `- Stored locally by the browser and automatically sent back to the server in subsequent requests via the \`Cookie\` request header.`,
      `- Secured using attributes like \`HttpOnly\` (prevents XSS access), \`Secure\` (HTTPS-only), and \`SameSite=Lax/Strict\` (CSRF protection).`,
      '',
      `#### 2. How Sessions Work (Server-Side State)`,
      `- Sensitive user state (user ID, permissions, cart) is stored securely on the server.`,
      `- The server creates a unique, cryptographically random **Session ID (SID)**.`,
      `- The SID is transmitted to the client as an \`HttpOnly\` cookie. On incoming requests, the server matches the SID to its session storage.`
    ].join('\n');
  }

  // Generalized curriculum unit explanation
  const unitHeader = unit ? ` · Unit ${unit.unitNumber}: ${unit.unitTitle}` : '';
  const topicsSnippet = unit?.topicsText ? `\n\n**Syllabus Topics Covered in Curriculum:**\n${unit.topicsText.slice(0, 300)}` : '';

  return [
    `### ${topic} — ${subject}${unitHeader}`,
    '',
    `**${topic}** is an essential topic in the university's BIT curriculum under **${subject}**.`,
    topicsSnippet,
    '',
    `#### Core Academic Overview`,
    `- **Foundational Concept:** In **${subject}**, understanding ${topic} is critical for establishing core theory and practical implementation skills.`,
    `- **Curriculum Alignment:** This subject is part of the official Gandaki University Bachelor of Information Technology (BIT) coursework. Review your lecture handouts and practical lab exercises for detailed code walkthroughs.`
  ].join('\n');
}

module.exports = {
  curriculumIndex,
  cleanText,
  extractAcademicTopic,
  isAcademicTopicQuery,
  reasonCurriculum,
  getCandidateSubjects,
  getCandidateSemesters,
  resolveSyllabusConcept,
  generateCurriculumExplanation,
  ACRONYMS_AND_SYNONYMS
};
