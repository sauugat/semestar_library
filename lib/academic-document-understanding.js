'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');

const ROMAN_TO_NUMBER = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8
};

// Known technical concept aliases & cross-language (English + Romanized Nepali) mappings
// Used for enriching terminology & related concepts (never for hard-locking a topic to a single subject)
const CONCEPT_TAXONOMY = [
  {
    canonical: 'Just-in-Time Compiler',
    aliases: ['jit', 'jit compiler', 'just in time compiler', 'just-in-time compilation', 'jit compilation', 'dynamic compilation', 'runtime compilation'],
    related: ['Java Virtual Machine', 'JVM', 'Bytecode', 'Byte code', 'Bytecode Execution', 'Interpreter', 'Java Runtime Environment', 'JRE', 'HotSpot'],
    nepaliAliases: ['jit compiler ko', 'jit bhaneko']
  },
  {
    canonical: 'Java Virtual Machine',
    aliases: ['jvm', 'java virtual machine', 'jvm architecture', 'class loader', 'classloader', 'bytecode verifier', 'byte code', 'execution engine'],
    related: ['Bytecode', 'Just-in-Time Compiler', 'Interpreter', 'Garbage Collection', 'Java Runtime Environment']
  },
  {
    canonical: 'Cascading Style Sheets',
    aliases: ['css', 'css3', 'cascading style sheet', 'cascading style sheets', 'stylesheet', 'style sheet', 'css selectors', 'flexbox', 'css grid', 'box model'],
    related: ['HTML', 'DOM', 'Responsive Web Design', 'Media Queries', 'Bootstrap', 'Web Page Layout']
  },
  {
    canonical: 'Database Normalization',
    aliases: ['normalization', 'normal forms', '1nf', '2nf', '3nf', 'bcnf', '4nf', '5nf', 'first normal form', 'second normal form', 'third normal form', 'boyce-codd normal form', 'functional dependency'],
    related: ['Functional Dependencies', 'Relational Database Design', 'Decomposition', 'Lossless Join', 'Transitive Dependency', 'Partial Dependency', 'Redundancy']
  },
  {
    canonical: 'Deadlock',
    aliases: ['deadlock', 'deadlock prevention', 'deadlock avoidance', 'deadlock detection', 'deadlock recovery', 'mutual exclusion', 'hold and wait', 'no preemption', 'circular wait', 'bankers algorithm', "banker's algorithm"],
    related: ['Resource Allocation Graph', 'Safe State', 'Process Synchronization', 'Semaphore', 'Starvation', 'Livelock', 'Operating System']
  },
  {
    canonical: 'Session and Cookie Management',
    aliases: ['session', 'cookie', 'cookies', 'session and cookie', 'session management', 'cookie management', 'session tracking', 'http cookies', 'setcookie', 'session_start', '$_session', '$_cookie'],
    related: ['HTTP State Management', 'PHP Sessions', 'Authentication', 'Web Security', 'Client-Side Storage', 'Server-Side Session']
  },
  {
    canonical: 'Process Scheduling',
    aliases: ['process scheduling', 'cpu scheduling', 'scheduling algorithms', 'fcfs', 'first come first serve', 'sjf', 'shortest job first', 'srtf', 'shortest remaining time next', 'round robin', 'priority scheduling', 'multilevel queue'],
    related: ['Process Control Block', 'Context Switch', 'Turnaround Time', 'Waiting Time', 'Response Time', 'Preemptive Scheduling', 'Non-Preemptive Scheduling']
  },
  {
    canonical: 'Inheritance',
    aliases: ['inheritance', 'single inheritance', 'multiple inheritance', 'multilevel inheritance', 'hierarchical inheritance', 'hybrid inheritance', 'extends', 'superclass', 'subclass', 'base class', 'derived class'],
    related: ['Object-Oriented Programming', 'Polymorphism', 'Method Overriding', 'Abstract Class', 'Interface', 'Encapsulation', 'super keyword']
  },
  {
    canonical: 'Pointers',
    aliases: ['pointer', 'pointers', 'pointer arithmetic', 'pointer to pointer', 'null pointer', 'dangling pointer', 'void pointer', 'dereference', 'address operator', 'dynamic memory allocation', 'malloc', 'calloc', 'realloc', 'free'],
    related: ['Memory Address', 'Call by Reference', 'Call by Address', 'Arrays and Pointers', 'Structure Pointer', 'C Programming']
  },
  {
    canonical: 'Graph Theory',
    aliases: ['graph theory', 'undirected graph', 'directed graph', 'bipartite graph', 'euler graph', 'hamiltonian graph', 'planar graph', 'graph coloring', 'graph isomorphism', 'shortest path', 'dijkstra', 'kruskal', 'prim', 'minimum spanning tree'],
    related: ['Vertices and Edges', 'Adjacency Matrix', 'Adjacency List', 'Graph Traversal', 'BFS', 'DFS', 'Trees']
  },
  {
    canonical: 'TCP and UDP Protocols',
    aliases: ['tcp', 'udp', 'transmission control protocol', 'user datagram protocol', 'tcp vs udp', 'transport layer protocols', 'three-way handshake', 'flow control', 'congestion control'],
    related: ['Transport Layer', 'Port Numbers', 'Socket Programming', 'OSI Model', 'TCP/IP Suite', 'Reliable Delivery']
  },
  {
    canonical: 'OSI and TCP/IP Reference Models',
    aliases: ['osi model', 'osi reference model', 'tcp/ip model', '7 layers of osi', 'application layer', 'transport layer', 'network layer', 'data link layer', 'physical layer'],
    related: ['Protocol Layering', 'Encapsulation', 'PDU', 'Computer Networks']
  },
  {
    canonical: 'SQL Injection and XSS',
    aliases: ['sql injection', 'sqli', 'cross-site scripting', 'xss', 'web security attacks', 'prepared statements'],
    related: ['Web Security', 'Authentication', 'Input Validation', 'Cryptography', 'CSRF']
  },
  {
    canonical: 'Agile and Scrum Methodology',
    aliases: ['agile', 'agile software development', 'scrum', 'extreme programming', 'xp', 'sprint', 'product backlog', 'agile manifesto'],
    related: ['Software Engineering', 'SDLC', 'Plan-Driven Development', 'Requirement Engineering']
  }
];

let cachedSyllabusRegistry = null;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_/\\|]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSemesterNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const str = String(raw).trim().toUpperCase();
  const numMatch = str.match(/\b([1-8])\b/);
  if (numMatch) return Number(numMatch[1]);
  const romanMatch = str.replace(/^SEMESTER\s+/i, '').trim();
  if (ROMAN_TO_NUMBER[romanMatch]) return ROMAN_TO_NUMBER[romanMatch];
  return null;
}

function loadSyllabusRegistry() {
  if (cachedSyllabusRegistry) return cachedSyllabusRegistry;
  const syllabusPath = path.join(__dirname, '..', 'syllabus-data.json');
  const courses = [];
  const topicIndex = new Map(); // normalizedTopic -> Array<{ subject, code, semesterNo, unit, chapter, topic, subtopics }>

  try {
    const raw = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
    const allSemesters = Array.isArray(raw.semesters) ? raw.semesters : [];

    for (const sem of allSemesters) {
      const semNo = parseSemesterNumber(sem.semester);
      for (const course of sem.courses || []) {
        const parsedUnits = parseSyllabusUnits(course.contents || '');
        const entry = {
          title: String(course.title || '').trim(),
          normalizedTitle: normalizeText(course.title || ''),
          code: String(course.code || '').trim(),
          semesterNo: semNo,
          objectives: String(course.objectives || '').trim(),
          description: String(course.description || '').trim(),
          units: parsedUnits
        };
        courses.push(entry);

        for (const u of parsedUnits) {
          const allTopics = [u.title, ...u.topics];
          for (const t of allTopics) {
            const norm = normalizeText(t);
            if (!norm || norm.length < 2) continue;
            if (!topicIndex.has(norm)) topicIndex.set(norm, []);
            topicIndex.get(norm).push({
              subject: entry.title,
              subjectCode: entry.code,
              semesterNo: entry.semesterNo,
              unit: `Unit ${u.unitNumber}`,
              chapter: u.title,
              topic: t,
              subtopics: u.topics.filter((st) => st !== t).slice(0, 8)
            });
          }
        }
      }
    }

    for (const elective of raw.electives || []) {
      const parsedUnits = parseSyllabusUnits(elective.contents || '');
      const entry = {
        title: String(elective.title || '').trim(),
        normalizedTitle: normalizeText(elective.title || ''),
        code: String(elective.code || 'ELE').trim(),
        semesterNo: null,
        objectives: String(elective.objectives || '').trim(),
        description: String(elective.description || '').trim(),
        units: parsedUnits
      };
      courses.push(entry);
      for (const u of parsedUnits) {
        const allTopics = [u.title, ...u.topics];
        for (const t of allTopics) {
          const norm = normalizeText(t);
          if (!norm || norm.length < 2) continue;
          if (!topicIndex.has(norm)) topicIndex.set(norm, []);
          topicIndex.get(norm).push({
            subject: entry.title,
            subjectCode: entry.code,
            semesterNo: null,
            unit: `Unit ${u.unitNumber}`,
            chapter: u.title,
            topic: t,
            subtopics: u.topics.filter((st) => st !== t).slice(0, 8)
          });
        }
      }
    }
  } catch (_) {}

  cachedSyllabusRegistry = { courses, topicIndex };
  return cachedSyllabusRegistry;
}

function parseSyllabusUnits(contentsText) {
  const text = String(contentsText || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const units = [];
  let currentUnit = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Match top-level unit e.g. "1. Introduction to Circuit Theory 7hrs"
    const unitMatch = line.match(/^(\d{1,2})\.\s+([A-Za-z][^\n]*?)(?:\s+\[?\(?\d+\s*(?:hrs?|hours?)\)?\]?)?$/i);
    if (unitMatch && !line.match(/^\d+\.\d+/)) {
      if (currentUnit) units.push(currentUnit);
      currentUnit = {
        unitNumber: Number(unitMatch[1]),
        title: unitMatch[2].replace(/\s+\d+\s*(?:hrs?|hours?)$/i, '').trim(),
        rawLines: [],
        topics: []
      };
      continue;
    }

    if (currentUnit) {
      currentUnit.rawLines.push(line);
    }
  }
  if (currentUnit) units.push(currentUnit);

  for (const unit of units) {
    const joined = unit.rawLines
      .join(' ')
      .replace(/-\s+/g, '')
      .replace(/\b\d+\.\d+(?:\.\d+)?\s*/g, '; ')
      .replace(/\b(?:[ivx]{1,4}|[a-g])\.\s+/gi, '; ');
    const parts = joined
      .split(/[;,•\n]+/)
      .map((s) => s.replace(/\s+\d+\s*(?:hrs?|hours?)\b/gi, '').trim())
      .filter((s) => s.length >= 3 && s.length <= 120);
    unit.topics = Array.from(new Set([unit.title, ...parts]));
    unit.normTopics = unit.topics.map((t) => ({ raw: t, norm: normalizeText(t) }));
  }

  return units;
}

function matchCourseFromMetadata(subject, title) {
  const registry = loadSyllabusRegistry();
  const normSub = normalizeText(subject);
  const normTitle = normalizeText(title);

  if (normSub) {
    const exact = registry.courses.find((c) => c.normalizedTitle === normSub || normalizeText(c.code) === normSub);
    if (exact) return exact;
    const partial = registry.courses.find(
      (c) => c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle)
    );
    if (partial) return partial;
  }

  if (normTitle) {
    const byTitle = registry.courses.find(
      (c) => normTitle.includes(c.normalizedTitle) || (c.code && normTitle.includes(normalizeText(c.code)))
    );
    if (byTitle) return byTitle;
  }

  return null;
}

/**
 * Extracts rich academic metadata from a document's pages, headings, and text.
 */
function analyzeAcademicDocument({ file = {}, pages = [], sections = [], fullText = '' }) {
  const registry = loadSyllabusRegistry();
  const combinedText = fullText || pages.map((p) => p.cleaned_text || p.raw_text || '').join('\n\n');
  const normFullText = normalizeText(combinedText);

  const fileTitle = String(file.title || file.originalName || 'Untitled Document').trim();
  const rawSubject = String(file.subject || '').trim();
  const rawChapter = String(file.chapter || '').trim();
  const semesterNo = parseSemesterNumber(file.semester_no || file.semester);

  const matchedCourse = matchCourseFromMetadata(rawSubject, fileTitle);

  // Collect section headings from pages and structured sections
  const sectionHeadings = [];
  const seenHeadings = new Set();

  const addHeading = (h) => {
    const clean = String(h || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 2 || clean.length > 140) return;
    const key = clean.toLowerCase();
    if (seenHeadings.has(key)) return;
    seenHeadings.add(key);
    sectionHeadings.push(clean);
  };

  for (const sec of sections || []) {
    if (sec && sec.heading) addHeading(sec.heading);
  }
  for (const page of pages || []) {
    const pageHeadings = Array.isArray(page.headings)
      ? page.headings
      : safeJsonParse(page.headings_json, []);
    for (const h of pageHeadings) {
      addHeading(typeof h === 'string' ? h : h && h.text);
    }
  }

  // Also scan text for Markdown or numbered headings if sectionHeadings is sparse
  if (sectionHeadings.length < 3 && combinedText) {
    const lines = combinedText.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.length > 100) continue;
      if (/^#{1,4}\s+(.+)$/.test(line)) {
        addHeading(line.replace(/^#{1,4}\s+/, ''));
      } else if (/^(?:chapter|unit|section|module|lecture)\s+\d+[\s:.-]*(.*)$/i.test(line)) {
        addHeading(line);
      } else if (/^\d+(?:\.\d+){0,2}\s+[A-Z][A-Za-z0-9\s,&/()-]{3,75}$/.test(line)) {
        addHeading(line);
      }
    }
  }

  // Identify unit and chapter from metadata, headings, or syllabus alignment
  let inferredChapter = rawChapter || null;
  let inferredUnit = null;

  for (const h of [fileTitle, rawChapter, ...sectionHeadings]) {
    if (!h) continue;
    const chMatch = String(h).match(/\b(?:chapter|ch\.?)\s*(\d+)\b(?:\s*[:.-]\s*([^\n]+))?/i);
    if (chMatch && !inferredChapter) {
      inferredChapter = chMatch[2] ? `Chapter ${chMatch[1]}: ${chMatch[2].trim()}` : `Chapter ${chMatch[1]}`;
    }
    const unitMatch = String(h).match(/\b(?:unit|module)\s*(\d+)\b(?:\s*[:.-]\s*([^\n]+))?/i);
    if (unitMatch && !inferredUnit) {
      inferredUnit = unitMatch[2] ? `Unit ${unitMatch[1]}: ${unitMatch[2].trim()}` : `Unit ${unitMatch[1]}`;
    }
  }

  // Extract main topics, subtopics, terminology, and related concepts
  const mainTopics = [];
  const subtopics = [];
  const terminology = [];
  const relatedConcepts = [];
  const learningObjectives = [];

  const seenMain = new Set();
  const seenSub = new Set();
  const seenTerm = new Set();
  const seenRelated = new Set();

  const pushUnique = (arr, set, val, max = 35) => {
    const clean = String(val || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 2 || clean.length > 110 || arr.length >= max) return;
    const k = clean.toLowerCase();
    if (set.has(k)) return;
    set.add(k);
    arr.push(clean);
  };

  // 1. Headings -> mainTopics & subtopics
  for (const heading of sectionHeadings) {
    const stripped = heading
      .replace(/^(?:chapter|unit|section|lecture)\s+\d+[\s:.-]*/i, '')
      .replace(/^\d+(?:\.\d+)*[\s.)-]+/, '')
      .trim();
    if (!stripped || /^(?:introduction|overview|summary|conclusion|references|exercises|questions)$/i.test(stripped)) {
      continue;
    }
    if (/^\d+\.\d+/.test(heading)) {
      pushUnique(subtopics, seenSub, stripped);
    } else {
      pushUnique(mainTopics, seenMain, stripped);
    }
  }

  // 2. Match against CONCEPT_TAXONOMY
  for (const concept of CONCEPT_TAXONOMY) {
    let matched = false;
    for (const alias of [concept.canonical.toLowerCase(), ...concept.aliases]) {
      if (containsConceptTerm(normFullText, alias)) {
        matched = true;
        pushUnique(terminology, seenTerm, alias.length <= 5 ? alias.toUpperCase() : toTitleCase(alias));
      }
    }
    if (matched) {
      pushUnique(mainTopics, seenMain, concept.canonical);
      for (const rel of concept.related || []) {
        if (containsConceptTerm(normFullText, rel.toLowerCase())) {
          pushUnique(subtopics, seenSub, rel);
          pushUnique(terminology, seenTerm, rel);
        } else {
          pushUnique(relatedConcepts, seenRelated, rel);
        }
      }
    }
  }

  // 3. Extract definition patterns from document body:
  // e.g. "Just-in-Time (JIT) Compiler: ...", "Normalization is the process of...", "**Bytecode** - ..."
  const definitionRegexes = [
    /(?:^|\n)\s*(?:•|-|\*|\d+\.)?\s*\*\*([A-Za-z][A-Za-z0-9\s/()-]{2,55})\*\*\s*(?::|-|–|is\b|refers to\b)/g,
    /(?:^|\n)\s*([A-Z][A-Za-z0-9\s/()-]{2,50})\s*:\s+[A-Z][^\n]{15,}/g,
    /\b([A-Z][A-Za-z0-9\s-]{2,45}\s*\([A-Z]{2,8}\))\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\s+(?:is defined as|refers to|is a process of|is a technique|is a mechanism|is an algorithm)\b/g
  ];

  for (const regex of definitionRegexes) {
    let m;
    while ((m = regex.exec(combinedText)) !== null) {
      const candidate = m[1].replace(/^\W+|\W+$/g, '').trim();
      if (candidate && !/^(?:note|example|figure|table|page|chapter|unit|step|advantage|disadvantage)s?$/i.test(candidate)) {
        pushUnique(terminology, seenTerm, candidate);
        if (mainTopics.length < 15) {
          pushUnique(mainTopics, seenMain, candidate);
        } else {
          pushUnique(subtopics, seenSub, candidate);
        }
      }
    }
  }

  // 4. Syllabus topic alignment (check matched course first, then all courses for cross-subject topics)
  const candidateCourses = matchedCourse
    ? [matchedCourse, ...registry.courses.filter((c) => c !== matchedCourse)]
    : registry.courses;

  let bestCourseMatch = matchedCourse;
  let bestCourseScore = matchedCourse ? 10 : 0;
  let matchedCoursesCount = 0;

  for (const course of candidateCourses) {
    let courseHits = 0;
    for (const unit of course.units || []) {
      let unitHits = 0;
      for (const topic of unit.topics || []) {
        const normTopic = normalizeText(topic);
        if (normTopic.length < 4) continue;
        if (containsConceptTerm(normFullText, normTopic)) {
          courseHits += 1;
          unitHits += 1;
          if (course === matchedCourse || unitHits >= 2) {
            pushUnique(mainTopics, seenMain, topic);
            for (const sibling of unit.topics.slice(0, 6)) {
              if (sibling !== topic) {
                if (containsConceptTerm(normFullText, normalizeText(sibling))) {
                  pushUnique(subtopics, seenSub, sibling);
                } else {
                  pushUnique(relatedConcepts, seenRelated, sibling);
                }
              }
            }
          }
        }
      }
      if (unitHits >= 2 && !inferredUnit && course === matchedCourse) {
        inferredUnit = `Unit ${unit.unitNumber}: ${unit.title}`;
        if (!inferredChapter) inferredChapter = unit.title;
      }
    }
    if (courseHits >= 3) {
      matchedCoursesCount += 1;
    }
    if (!matchedCourse && courseHits > bestCourseScore) {
      bestCourseScore = courseHits;
      bestCourseMatch = course;
    }
  }

  // Detect if this is a multi-course university curriculum / bulletin document (e.g., BIT_CURRICULUM.pdf)
  const isMultiCourseCurriculum = !rawSubject && (
    /\b(?:curriculum|syllabus|course\s+bulletin)\b/i.test(fileTitle) ||
    matchedCoursesCount >= 4
  );

  // 5. Extract learning objectives if mentioned
  const objMatches = combinedText.match(/(?:learning objectives?|objectives?|after studying this[^\n]*|goals?)\s*[:\n]\s*([^\n]+(?:\n\s*(?:•|-|\*|\d+\.)\s*[^\n]+){0,6})/i);
  if (objMatches && objMatches[1]) {
    const objLines = objMatches[1]
      .split(/\n|•|\*/)
      .map((s) => s.replace(/^\s*[-0-9.)]+\s*/, '').trim())
      .filter((s) => s.length >= 10 && s.length <= 180);
    for (const line of objLines.slice(0, 6)) {
      learningObjectives.push(line);
    }
  }

  // Ensure mainTopics has at least title/chapter fallback if document is short
  if (mainTopics.length === 0 && fileTitle) {
    pushUnique(mainTopics, seenMain, fileTitle.replace(/\.(pdf|docx?|pptx?|txt|md)$/i, ''));
  }

  // Build concise academic summary
  const finalSubject = rawSubject || (
    isMultiCourseCurriculum
      ? 'BIT Curriculum (All Semesters)'
      : (bestCourseMatch ? bestCourseMatch.title : 'General Academic')
  );
  const finalSubjectCode = isMultiCourseCurriculum ? 'BIT-CURR' : (bestCourseMatch ? bestCourseMatch.code : null);
  const finalSemesterNo = semesterNo || (isMultiCourseCurriculum ? null : (bestCourseMatch ? bestCourseMatch.semesterNo : null));
  if (isMultiCourseCurriculum && !rawChapter) {
    inferredChapter = 'Semesters I–VIII Course Bulletin';
    inferredUnit = null;
  }

  const summaryParts = [];
  summaryParts.push(`${fileTitle} (${finalSubject}${inferredChapter ? `, ${inferredChapter}` : ''})`);
  if (mainTopics.length > 0) {
    summaryParts.push(`Covers: ${mainTopics.slice(0, 8).join(', ')}.`);
  }
  const firstMeaningfulSentences = combinedText
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
  if (firstMeaningfulSentences) {
    summaryParts.push(firstMeaningfulSentences);
  }
  const summary = summaryParts.join(' — ').slice(0, 700);

  const provenance = matchedCourse
    ? 'syllabus_verified_and_document_extracted'
    : bestCourseMatch
      ? 'curriculum_aligned_and_document_inferred'
      : 'document_content_inferred';

  const confidence = matchedCourse
    ? Math.min(0.98, 0.78 + Math.min(0.2, mainTopics.length * 0.02))
    : bestCourseMatch
      ? Math.min(0.9, 0.65 + Math.min(0.25, mainTopics.length * 0.02))
      : Math.min(0.82, 0.55 + Math.min(0.25, mainTopics.length * 0.02));

  return {
    file_id: String(file.id || ''),
    title: fileTitle,
    subject: finalSubject,
    subject_code: finalSubjectCode,
    semester_no: finalSemesterNo,
    chapter: inferredChapter,
    unit: inferredUnit,
    section_headings: sectionHeadings.slice(0, 40),
    main_topics: mainTopics.slice(0, 30),
    subtopics: subtopics.slice(0, 35),
    terminology: terminology.slice(0, 45),
    related_concepts: relatedConcepts.slice(0, 30),
    summary,
    learning_objectives: learningObjectives,
    confidence: Number(confidence.toFixed(3)),
    provenance
  };
}

function containsConceptTerm(normText, normConcept) {
  if (!normText || !normConcept) return false;
  const escaped = normConcept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i');
  return re.test(normText);
}

function toTitleCase(str) {
  return String(str || '')
    .split(/\s+/)
    .map((w) => (w.length <= 3 && /^(?:jit|jvm|css|sql|tcp|udp|osi|xml|dom|api|gui|awt|oop|bst|avl|bcnf)$/i.test(w)
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

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
 * Persists structured document topic metadata and populates the Academic Knowledge Graph.
 */
async function persistAcademicUnderstanding(db, { file, docVersion = 1, metadata, chunks = [] }) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();
  const fileId = String(file.id || metadata.file_id || '');
  if (!fileId) return metadata;

  await db.run(
    `DELETE FROM document_topic_metadata WHERE file_id = ?`,
    [fileId]
  );

  await db.run(
    `INSERT INTO document_topic_metadata (
      file_id, doc_version, title, subject, subject_code, semester_no,
      chapter, unit, section_headings_json, main_topics_json, subtopics_json,
      terminology_json, related_concepts_json, summary, learning_objectives_json,
      confidence, provenance, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      Number(docVersion) || 1,
      metadata.title || null,
      metadata.subject || null,
      metadata.subject_code || null,
      metadata.semester_no ?? null,
      metadata.chapter || null,
      metadata.unit || null,
      JSON.stringify(metadata.section_headings || []),
      JSON.stringify(metadata.main_topics || []),
      JSON.stringify(metadata.subtopics || []),
      JSON.stringify(metadata.terminology || []),
      JSON.stringify(metadata.related_concepts || []),
      metadata.summary || '',
      JSON.stringify(metadata.learning_objectives || []),
      metadata.confidence ?? 0.8,
      metadata.provenance || 'hybrid',
      now
    ]
  );

  // Rebuild knowledge graph edges for this document
  await db.run(`DELETE FROM academic_knowledge_graph WHERE file_id = ?`, [fileId]);

  const registry = loadSyllabusRegistry();
  const graphEdges = [];
  const seenEdgeKeys = new Set();

  const addEdge = ({ subject, subjectCode, semesterNo, unit, chapter, topic, subtopic, sectionHeading, chunkId, pageNumber, confidence, provenance }) => {
    const normTopic = normalizeText(topic);
    if (!normTopic || normTopic.length < 2) return;
    const key = `${normalizeText(subject)}|${normTopic}|${normalizeText(subtopic || '')}|${fileId}|${chunkId || ''}`;
    if (seenEdgeKeys.has(key)) return;
    seenEdgeKeys.add(key);
    const id = 'akg_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
    graphEdges.push({
      id,
      subject: subject || metadata.subject || 'General Academic',
      subject_code: subjectCode || metadata.subject_code || null,
      semester_no: semesterNo ?? metadata.semester_no ?? null,
      unit: unit || metadata.unit || null,
      chapter: chapter || metadata.chapter || null,
      topic,
      normalized_topic: normTopic,
      subtopic: subtopic || null,
      section_heading: sectionHeading || null,
      file_id: fileId,
      chunk_id: chunkId || null,
      page_number: pageNumber ?? null,
      confidence: confidence ?? metadata.confidence ?? 0.8,
      provenance: provenance || metadata.provenance || 'syllabus_and_document',
      updated_at: now
    });
  };

  // Map document main topics and subtopics to specific child chunks where they appear
  const childChunks = chunks.filter((c) => c.chunk_level === 'child' || !c.chunk_level);
  const allTopics = [
    ...(metadata.main_topics || []).map((t) => ({ topic: t, isMain: true })),
    ...(metadata.subtopics || []).map((t) => ({ topic: t, isMain: false })),
    ...(metadata.terminology || []).slice(0, 20).map((t) => ({ topic: t, isMain: false }))
  ];

  for (const item of allTopics) {
    const normT = normalizeText(item.topic);
    if (!normT) continue;

    // Find best matching chunk in this document
    let matchedChunk = null;
    for (const ch of childChunks) {
      const chNorm = normalizeText(`${ch.section_heading || ''} ${ch.clean_content || ch.content || ''}`);
      if (containsConceptTerm(chNorm, normT)) {
        matchedChunk = ch;
        break;
      }
    }

    // Check if this topic also exists in syllabus across one or multiple subjects
    const syllabusEntries = registry.topicIndex.get(normT) || [];
    if (syllabusEntries.length > 0) {
      for (const syl of syllabusEntries.slice(0, 3)) {
        addEdge({
          subject: syl.subject,
          subjectCode: syl.subjectCode,
          semesterNo: syl.semesterNo,
          unit: syl.unit,
          chapter: syl.chapter,
          topic: item.topic,
          subtopic: matchedChunk ? matchedChunk.section_heading : (syl.subtopics[0] || null),
          sectionHeading: matchedChunk ? matchedChunk.section_heading : null,
          chunkId: matchedChunk ? matchedChunk.id : null,
          pageNumber: matchedChunk ? matchedChunk.page_start : 1,
          confidence: 0.92,
          provenance: 'syllabus_verified'
        });
      }
    }

    // Always add edge for the document's own assigned subject
    addEdge({
      subject: metadata.subject || 'General Academic',
      subjectCode: metadata.subject_code,
      semesterNo: metadata.semester_no,
      unit: metadata.unit,
      chapter: matchedChunk && matchedChunk.chapter ? matchedChunk.chapter : metadata.chapter,
      topic: item.topic,
      subtopic: matchedChunk ? matchedChunk.section_heading : null,
      sectionHeading: matchedChunk ? matchedChunk.section_heading : null,
      chunkId: matchedChunk ? matchedChunk.id : null,
      pageNumber: matchedChunk ? matchedChunk.page_start : 1,
      confidence: item.isMain ? metadata.confidence : Math.max(0.6, (metadata.confidence || 0.8) - 0.1),
      provenance: metadata.provenance
    });
  }

  for (const edge of graphEdges.slice(0, 80)) {
    await db.run(
      `INSERT INTO academic_knowledge_graph (
        id, subject, subject_code, semester_no, unit, chapter,
        topic, normalized_topic, subtopic, section_heading,
        file_id, chunk_id, page_number, confidence, provenance, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.id,
        edge.subject,
        edge.subject_code,
        edge.semester_no,
        edge.unit,
        edge.chapter,
        edge.topic,
        edge.normalized_topic,
        edge.subtopic,
        edge.section_heading,
        edge.file_id,
        edge.chunk_id,
        edge.page_number,
        edge.confidence,
        edge.provenance,
        edge.updated_at
      ]
    );
  }

  return { metadata, graphEdgesCount: graphEdges.length };
}

/**
 * Infers candidate subjects, units, chapters, and related concepts for a query topic
 * using both the university syllabus and the indexed academic knowledge graph.
 */
async function inferAcademicContextForQuery(db, queryTerms = []) {
  const registry = loadSyllabusRegistry();
  const normTerms = queryTerms.map((t) => normalizeText(t)).filter((t) => t.length >= 2);

  const candidateSubjects = new Map(); // subject -> { subject, subjectCode, semesterNo, chapters: Set, units: Set, score, provenance }
  const relatedConcepts = new Set();

  const recordSubject = (subject, code, semNo, unit, chapter, weight, prov) => {
    if (!subject) return;
    const key = normalizeText(subject);
    if (!candidateSubjects.has(key)) {
      candidateSubjects.set(key, {
        subject,
        subjectCode: code || null,
        semesterNo: semNo ?? null,
        units: new Set(),
        chapters: new Set(),
        score: 0,
        provenance: prov || 'syllabus'
      });
    }
    const entry = candidateSubjects.get(key);
    entry.score += weight;
    if (unit) entry.units.add(unit);
    if (chapter) entry.chapters.add(chapter);
  };

  // 1. Check CONCEPT_TAXONOMY for related concepts (query term must equal or contain the full alias)
  for (const concept of CONCEPT_TAXONOMY) {
    const allAliases = [concept.canonical.toLowerCase(), ...concept.aliases, ...(concept.nepaliAliases || [])];
    const hit = normTerms.some((qt) =>
      allAliases.some((a) => a === qt || (a.length >= 3 && containsConceptTerm(qt, a)))
    );
    if (hit) {
      relatedConcepts.add(concept.canonical);
      for (const rel of concept.related || []) relatedConcepts.add(rel);
    }
  }

  // 2. Check syllabus courses & units using pre-normalized topics (skipping generic single-word modifiers)
  const genericSingleWords = new Set([
    'theory', 'system', 'systems', 'management', 'model', 'design',
    'introduction', 'overview', 'concept', 'concepts', 'programming',
    'language', 'prevention', 'database', 'compiler', 'class', 'code'
  ]);
  const specificNormTerms = normTerms.filter((qt) => !genericSingleWords.has(qt));

  for (const course of registry.courses) {
    for (const unit of course.units || []) {
      const unitTopics = unit.normTopics || (unit.topics || []).map((t) => ({ raw: t, norm: normalizeText(t) }));
      for (const item of unitTopics) {
        const normTopic = item.norm;
        if (!normTopic) continue;
        for (const qt of specificNormTerms) {
          if (normTopic === qt || (qt.length >= 3 && normTopic.includes(qt) && containsConceptTerm(normTopic, qt))) {
            recordSubject(
              course.title,
              course.code,
              course.semesterNo,
              `Unit ${unit.unitNumber}`,
              unit.title,
              normTopic === qt ? 10 : 6,
              'syllabus'
            );
            for (const sib of unit.topics.slice(0, 5)) {
              if (sib !== item.raw) relatedConcepts.add(sib);
            }
          }
        }
      }
    }
  }

  // 3. Check indexed academic_knowledge_graph in DB if available
  if (db && typeof db.all === 'function' && specificNormTerms.length > 0) {
    try {
      await ensureRagSchema(db);
      const clauses = [];
      const params = [];
      for (const qt of specificNormTerms.slice(0, 6)) {
        clauses.push(`normalized_topic LIKE ?`);
        params.push(`%${qt}%`);
      }
      const rows = await db.all(
        `SELECT subject, subject_code, semester_no, unit, chapter, topic, subtopic, section_heading, file_id, chunk_id, confidence
         FROM academic_knowledge_graph
         WHERE ${clauses.join(' OR ')}
         ORDER BY confidence DESC
         LIMIT 30`,
        params
      );
      for (const r of rows || []) {
        recordSubject(
          r.subject,
          r.subject_code,
          r.semester_no,
          r.unit,
          r.chapter,
          8 * (Number(r.confidence) || 0.8),
          'knowledge_graph'
        );
        if (r.topic) relatedConcepts.add(r.topic);
        if (r.subtopic) relatedConcepts.add(r.subtopic);
      }
    } catch (_) {}
  }

  const rankedSubjects = Array.from(candidateSubjects.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      subject: s.subject,
      subjectCode: s.subjectCode,
      semesterNo: s.semesterNo,
      units: Array.from(s.units),
      chapters: Array.from(s.chapters),
      score: Number(s.score.toFixed(2)),
      provenance: s.provenance
    }));

  return {
    candidateSubjects: rankedSubjects,
    relatedConcepts: Array.from(relatedConcepts).slice(0, 20)
  };
}

module.exports = {
  CONCEPT_TAXONOMY,
  normalizeText,
  parseSemesterNumber,
  loadSyllabusRegistry,
  analyzeAcademicDocument,
  persistAcademicUnderstanding,
  inferAcademicContextForQuery
};
