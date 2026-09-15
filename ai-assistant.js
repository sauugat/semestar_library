const fs = require('fs');
const path = require('path');

// --- 1. Environment Variables Loader (.env) ---
function loadEnvSafely() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    }
  } catch (err) {
    console.error('[AI Assistant] Error reading .env:', err.message);
  }
}
loadEnvSafely();

console.log('----------------------------------------------------');
console.log('[AI Assistant] Initializing Semester Library AI Engine v3.0');
console.log(`[AI Assistant] Gemini Configured: ${process.env.GEMINI_API_KEY ? 'Yes' : 'No'}`);
console.log(`[AI Assistant] OpenRouter Configured: ${process.env.OPENROUTER_API_KEY ? 'Yes' : 'No'}`);
console.log('----------------------------------------------------');

// ============================================================================
// 2. CANONICAL REGISTRIES (Semesters, Curriculum, Subjects, Topics)
// ============================================================================

const SEMESTER_REGISTRY = {
  1: { num: 1, roman: 'I', year: 'Year 1', name: 'Semester 1', aliases: ['1', '1st', 'first', 'sem 1', 'semester 1', 'sem i', 'semester i', 'first sem', 'first semester'] },
  2: { num: 2, roman: 'II', year: 'Year 1', name: 'Semester 2', aliases: ['2', '2nd', 'second', 'sem 2', 'semester 2', 'sem ii', 'semester ii', 'second sem', 'second semester'] },
  3: { num: 3, roman: 'III', year: 'Year 2', name: 'Semester 3', aliases: ['3', '3rd', 'third', 'sem 3', 'semester 3', 'sem iii', 'semester iii', 'third sem', 'third semester'] },
  4: { num: 4, roman: 'IV', year: 'Year 2', name: 'Semester 4', aliases: ['4', '4th', 'fourth', 'sem 4', 'semester 4', 'sem iv', 'semester iv', 'fourth sem', 'fourth semester'] },
  5: { num: 5, roman: 'V', year: 'Year 3', name: 'Semester 5', aliases: ['5', '5th', 'fifth', 'sem 5', 'semester 5', 'sem v', 'semester v', 'fifth sem', 'fifth semester'] },
  6: { num: 6, roman: 'VI', year: 'Year 3', name: 'Semester 6', aliases: ['6', '6th', 'sixth', 'sem 6', 'semester 6', 'sem vi', 'semester vi', 'sixth sem', 'sixth semester'] },
  7: { num: 7, roman: 'VII', year: 'Year 4', name: 'Semester 7', aliases: ['7', '7th', 'seventh', 'sem 7', 'semester 7', 'sem vii', 'semester vii', 'seventh sem', 'seventh semester'] },
  8: { num: 8, roman: 'VIII', year: 'Year 4', name: 'Semester 8', aliases: ['8', '8th', 'eighth', 'sem 8', 'semester 8', 'sem viii', 'semester viii', 'eighth sem', 'eighth semester'] }
};

function normalizeSemester(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().trim();

  // 1. Explicit Semester mentions (e.g. "sem 2", "semester 3", "3rd sem", "semester ii")
  for (const meta of Object.values(SEMESTER_REGISTRY)) {
    const explicitPatterns = [
      `sem\\s*${meta.num}`, `semester\\s*${meta.num}`,
      `sem\\s*${meta.roman.toLowerCase()}`, `semester\\s*${meta.roman.toLowerCase()}`,
      `${meta.aliases[1]}\\s*sem`, `${meta.aliases[1]}\\s*semester`,
      `${meta.aliases[2]}\\s*sem`, `${meta.aliases[2]}\\s*semester`
    ];
    for (const pat of explicitPatterns) {
      if (new RegExp(`\\b${pat}\\b`, 'i').test(s)) return meta;
    }
  }

  // 2. Standalone exact match ("II", "3", "Semester 4")
  const romanUpper = s.toUpperCase();
  for (const meta of Object.values(SEMESTER_REGISTRY)) {
    if (romanUpper === meta.roman || s === String(meta.num) || s === `semester ${meta.num}` || s === `sem ${meta.num}`) return meta;
  }

  // 3. Multi-word aliases (e.g. "second sem", "third semester")
  for (const meta of Object.values(SEMESTER_REGISTRY)) {
    for (const alias of meta.aliases) {
      if (alias.length <= 2) continue; // skip bare '1', '2'
      const regex = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(s)) return meta;
    }
  }
  return null;
}

// Ingest Syllabus Data & Build High-Precision Search Corpus
let syllabusData = { semesters: [] };
const ALL_COURSES = [];
const CANONICAL_SUBJECTS = new Map(); // Canonical Title -> Subject Info
const ALIAS_TO_SUBJECT = new Map();   // Alias string -> Canonical Title
const DYNAMIC_SYLLABUS_UNITS = [];    // Extracted from all 300+ syllabus units across all semesters

// Comprehensive Subject Aliases Dictionary
const SUBJECT_ALIASES = {
  'Database Management System': ['dbms', 'db', 'database', 'sql', 'mysql', 'relational database', 'database system', 'database management'],
  'Data Structure and Algorithms': ['dsa', 'ds', 'algo', 'algorithms', 'data structure', 'data structures', 'linked list', 'stack and queue', 'binary tree', 'trees and graphs'],
  'Mathematics I': ['math 1', 'math i', 'm1', 'calculus', 'derivatives', 'integration', 'maths 1', 'first semester math', 'matrices and determinants'],
  'Mathematics II': ['math 2', 'math ii', 'm2', 'complex numbers', 'complex number', 'complex variables', 'infinite series', 'differential equations', 'maths 2', 'second semester math'],
  'Discrete Mathematics': ['discrete math', 'discrete mathematics', 'discrete', 'graph theory', 'finite automata', 'fsm', 'fsa', 'recurrence relations', 'predicate logic'],
  'Computer Programming I (C)': ['c programming', 'c prog', 'prog 1', 'prog i', 'c language', 'c prog 1', 'computer programming 1', 'c pointers', 'c functions'],
  'Computer Programming II (Java)': ['java', 'java programming', 'prog 2', 'prog ii', 'oop java', 'oop', 'computer programming 2', 'swing gui', 'java oop'],
  'Digital Logic': ['digital logic', 'dl', 'logic gates', 'boolean algebra', 'k map', 'karnaugh map', 'flip flop', 'combinational circuits', 'sequential circuits'],
  'Web Technology I': ['web 1', 'web tech 1', 'web technology 1', 'web technology i', 'html css', 'php mysql', 'web dev 1', 'web development 1'],
  'Web Technology II': ['web 2', 'web tech 2', 'web technology 2', 'web technology ii', 'react', 'node', 'fullstack web', 'web dev 2'],
  'Microprocessor and Computer Architecture': ['microprocessor', 'computer architecture', 'coa', 'mp', '8085', 'intel 8085', '8086', 'assembly', 'assembly language', 'cpu architecture'],
  'Operating Systems': ['operating systems', 'operating system', 'os', 'linux', 'unix', 'processes and threads', 'deadlock', 'virtual memory', 'paging', 'cpu scheduling'],
  'Data Communication and Computer Networks': ['dccn', 'cn', 'computer networks', 'networking', 'networks', 'network', 'data communication', 'tcp ip', 'osi model'],
  'Fundamentals of Probability and Statistics': ['probability and statistics', 'stats', 'probability', 'statistics', 'prob stats', 'prob', 'business stats'],
  'Object Oriented Analysis and Design using UML': ['ooad', 'uml', 'object oriented analysis', 'uml diagrams', 'use case diagram', 'class diagram', 'design patterns'],
  'Financial Accounting': ['financial accounting', 'accounting', 'finance', 'balance sheet', 'journal ledger', 'account'],
  'Principles of Organization and Management': ['principles of management', 'management', 'pom', 'organization management', 'org management'],
  'Computer Graphics Technology': ['computer graphics', 'graphics', 'cg', 'rendering', '2d 3d transformation', 'opengl'],
  'Artificial Intelligence': ['artificial intelligence', 'ai', 'machine learning', 'expert systems', 'knowledge representation'],
  'Digital Forensic Security Technologies': ['digital forensics', 'forensics', 'cyber security', 'cybersecurity', 'security', 'digital forensic'],
  'Software Engineering': ['software engineering', 'se', 'sdlc', 'agile', 'scrum', 'software testing'],
  'Economics': ['economics', 'microeconomics', 'macroeconomics'],
  'Cloud Computing and Virtualization': ['cloud computing', 'cloud', 'virtualization', 'aws', 'docker', 'kubernetes'],
  'Mobile Application Development': ['mobile app development', 'mobile development', 'mad', 'android', 'flutter', 'android development'],
  'Big Data Technologies': ['big data', 'big data technologies', 'hadoop', 'spark', 'mapreduce'],
  'Data Mining and Warehousing': ['data mining', 'data warehouse', 'data warehousing', 'data mining and warehousing', 'dmw'],
  'Wireless Communication Systems': ['wireless communication', 'wireless', '5g', 'cellular'],
  'Software Development and Operations (DevOps)': ['devops', 'ci cd', 'jenkins', 'devops engineering'],
  'Basic Electronics': ['basic electronics', 'electronics', 'circuit theory', 'semiconductors', 'diodes', 'op-amp'],
  'Basics of IT': ['basics of it', 'it basics', 'fundamental of it', 'it fundamentals', 'information technology basics'],
  'Workshop: Problem Solving and Logic': ['problem solving', 'psl', 'logic workshop', 'flowcharts and algorithms'],
  'Business Communication Technique': ['business communication', 'bct', 'communication skills', 'technical writing']
};

try {
  const syllabusPath = path.join(__dirname, 'public', 'syllabus-data.json');
  if (fs.existsSync(syllabusPath)) {
    syllabusData = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
    if (syllabusData && syllabusData.semesters) {
      syllabusData.semesters.forEach(sem => {
        const semMeta = normalizeSemester(sem.semester);
        sem.courses.forEach(c => {
          const courseObj = {
            semester: sem.semester,
            semesterNum: semMeta ? semMeta.num : null,
            year: sem.year,
            title: c.title,
            code: c.code,
            credit: c.credit,
            nature: c.nature,
            objectives: c.objectives || '',
            contents: c.contents || '',
            objectivesSummary: c.objectives ? c.objectives.substring(0, 180) + '…' : '',
            contentsSummary: c.contents ? c.contents.substring(0, 240) + '…' : ''
          };
          ALL_COURSES.push(courseObj);
          CANONICAL_SUBJECTS.set(c.title, courseObj);

          // Parse units dynamically from syllabus contents
          if (c.contents) {
            const lines = c.contents.split('\n');
            lines.forEach(line => {
              const m = line.match(/^\s*(\d+)\.\s+([^0-9\n]+?)(?:\s+\d+\s*hrs)?\s*$/i);
              if (m) {
                const uNum = m[1].trim();
                const uTitle = m[2].trim();
                if (uTitle.length >= 3) {
                  DYNAMIC_SYLLABUS_UNITS.push({
                    unitNum: uNum,
                    unitTitle: uTitle,
                    canonicalSubject: c.title,
                    semesterNum: semMeta ? semMeta.num : null,
                    courseCode: c.code
                  });
                }
              }
            });
          }
        });
      });
    }
  }
} catch (e) {
  console.error('[AI Assistant] Error parsing syllabus-data.json:', e.message);
}

// Index Aliases
for (const [canonical, aliases] of Object.entries(SUBJECT_ALIASES)) {
  ALIAS_TO_SUBJECT.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    ALIAS_TO_SUBJECT.set(alias.toLowerCase(), canonical);
  }
}

// Topic Definitions for Deep Topic Matching & Disambiguation
const TOPIC_DEFINITIONS = [
  {
    topic: 'complex numbers',
    synonyms: ['complex number', 'complex numbers', 'complex no', 'complex nos', 'complex num', 'complex variable', 'complex variables', 'functions of complex variable', 'de moivre'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 5: Functions of Complex Variable'
  },
  {
    topic: 'matrices and determinants',
    synonyms: ['matrices', 'matrix', 'determinant', 'determinants', 'cramers rule', 'eigenvalues'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 4: Matrices and Determinants'
  },
  {
    topic: 'derivatives and calculus',
    synonyms: ['derivative', 'derivatives', 'differentiation', 'calculus', 'taylor series', 'limits and continuity'],
    canonicalSubject: 'Mathematics I',
    semesterNum: 1,
    unit: 'Unit 1 & 2: Derivatives & Applications'
  },
  {
    topic: 'normalization',
    synonyms: ['normalization', '1nf', '2nf', '3nf', 'bcnf', 'functional dependency', 'functional dependencies'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 5: Relational Database Design'
  },
  {
    topic: 'sql queries and relational algebra',
    synonyms: ['sql', 'queries', 'ddl', 'dml', 'relational algebra', 'joins', 'subqueries'],
    canonicalSubject: 'Database Management System',
    semesterNum: 3,
    unit: 'Unit 4: Relational Language and Database Constraints'
  },
  {
    topic: 'graphs and shortest path',
    synonyms: ['graph', 'graphs', 'graph theory', 'dijkstra', 'kruskal', 'prim', 'bfs', 'dfs', 'minimum spanning tree', 'shortest path', 'isomorphism', 'graph coloring'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 5: Graph Theory'
  },
  {
    topic: 'logic and proposition',
    synonyms: ['logic', 'proposition', 'truth table', 'predicates', 'quantifiers', 'nested quantifiers', 'tautology', 'logical equivalence'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 1: Logic and Induction'
  },
  {
    topic: 'mathematical reasoning and proofs',
    synonyms: ['proof', 'proofs', 'direct proof', 'indirect proof', 'rules of inference', 'mathematical reasoning'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 2: Mathematical Reasoning'
  },
  {
    topic: 'automata and fsm',
    synonyms: ['automata', 'fsm', 'fsa', 'dfa', 'nfa', 'finite state', 'grammars', 'languages', 'nfa to dfa'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 3: Finite state Automata, Grammars and Languages'
  },
  {
    topic: 'recurrence relation',
    synonyms: ['recurrence relation', 'linear recurrence', 'non linear recurrence', 'recursive definition'],
    canonicalSubject: 'Discrete Mathematics',
    semesterNum: 2,
    unit: 'Unit 4: Recurrence Relation'
  },
  {
    topic: 'complex numbers and variables',
    synonyms: ['complex number', 'complex numbers', 'complex variable', 'cauchy riemann', 'analytic function', 'harmonic function'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 5: Functions of Complex Variable'
  },
  {
    topic: 'several variables and partial derivatives',
    synonyms: ['several variables', 'partial derivative', 'partial derivatives', 'maxima and minima', 'total derivative', 'euler theorem'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 3: Function of Several Variables'
  },
  {
    topic: 'permutation and combination',
    synonyms: ['permutation', 'permutations', 'combination', 'combinations', 'counting principle'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 1: Permutation and Combination'
  },
  {
    topic: 'sorting and searching',
    synonyms: ['sorting', 'quicksort', 'mergesort', 'bubblesort', 'heapsort', 'binary search', 'linear search', 'hashing'],
    canonicalSubject: 'Data Structure and Algorithms',
    semesterNum: 3,
    unit: 'Unit 5 & 6: Sorting & Searching'
  },
  {
    topic: 'processes and deadlock',
    synonyms: ['deadlock', 'deadlocks', 'process synchronization', 'bankers algorithm', 'semaphores', 'mutex', 'cpu scheduling'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Process Management & Deadlock'
  },
  {
    topic: 'memory management and paging',
    synonyms: ['paging', 'virtual memory', 'page replacement', 'segmentation', 'memory management'],
    canonicalSubject: 'Operating Systems',
    semesterNum: 4,
    unit: 'Memory Management'
  },
  {
    topic: '8085 microprocessor',
    synonyms: ['8085', 'intel 8085', '8085 microprocessor', 'pin diagram', 'instruction cycle', 'addressing modes'],
    canonicalSubject: 'Microprocessor and Computer Architecture',
    semesterNum: 3,
    unit: 'Unit 2: Intel 8085'
  },
  {
    topic: 'logic gates and k-map',
    synonyms: ['logic gate', 'logic gates', 'k-map', 'karnaugh map', 'boolean simplification', 'demorgan'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 3: Boolean Algebra'
  },
  {
    topic: 'flip flops and counters',
    synonyms: ['flip flop', 'flip flops', 'jk flip flop', 'rs flip flop', 'counter', 'registers', 'shift register'],
    canonicalSubject: 'Digital Logic',
    semesterNum: 2,
    unit: 'Unit 5 & 6: Sequential Circuits & Counters'
  },
  {
    topic: 'css and styling',
    synonyms: ['css', 'cascading style sheet', 'cascading style sheets', 'css selectors', 'styling'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 3: Introducing Cascading Style Sheet'
  },
  {
    topic: 'html and web markup',
    synonyms: ['html', 'xhtml', 'html forms', 'tables', 'web markup', 'html elements'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 2: HTML and XHTML'
  },
  {
    topic: 'javascript basics',
    synonyms: ['javascript', 'js', 'dom', 'form validation', 'client script'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 4: Learning JavaScript'
  },
  {
    topic: 'php and mysql',
    synonyms: ['php', 'mysql', 'php mysql', 'server side php', 'crud in php'],
    canonicalSubject: 'Web Technology I',
    semesterNum: 2,
    unit: 'Unit 5: Programming in PHP and MYSQL'
  },
  {
    topic: 'java oop and basics',
    synonyms: ['java', 'java basics', 'oop java', 'java oop', 'inheritance in java', 'java exceptions', 'java io', 'event handling', 'swing'],
    canonicalSubject: 'Computer Programming II (Java)',
    semesterNum: 2,
    unit: 'Java Programming'
  },
  {
    topic: 'infinite series',
    synonyms: ['infinite series', 'convergence of series', 'alternating series', 'power series', 'radius of convergence'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 2: Infinite Series'
  },
  {
    topic: 'differential equations',
    synonyms: ['differential equations', 'differential equation', 'ode', 'homogeneous differential', 'initial value problem', '2nd order de'],
    canonicalSubject: 'Mathematics II',
    semesterNum: 2,
    unit: 'Unit 4: Differential Equations'
  }
];

// Ingest Default Routine Schedule
const DEFAULT_ROUTINE_SCHEDULE = [
  // Semester II
  { semester: 'II', semNum: 2, date: '2083/05/17', time: 'CIT121', subject: 'Discrete Mathematics', type: 'Examination' },
  { semester: 'II', semNum: 2, date: '2083/05/23', time: 'CIT122', subject: 'Computer Programming II (Java)', type: 'Examination' },
  { semester: 'II', semNum: 2, date: '2083/05/26', time: 'ELX121', subject: 'Digital Logic', type: 'Examination' },
  { semester: 'II', semNum: 2, date: '2083/05/30', time: 'CIT123', subject: 'Web Technology I', type: 'Examination' },
  { semester: 'II', semNum: 2, date: '2083/06/02', time: 'BSM121', subject: 'Mathematics-II', type: 'Examination' },

  // Semester IV
  { semester: 'IV', semNum: 4, date: '2083/06/05', time: 'CIT222', subject: 'Management Information System', type: 'Examination' },
  { semester: 'IV', semNum: 4, date: '2083/06/09', time: 'CIT221', subject: 'Operating Systems', type: 'Examination' },
  { semester: 'IV', semNum: 4, date: '2083/06/13', time: 'CIT223', subject: 'Data Communication and Computer Networks', type: 'Examination' },
  { semester: 'IV', semNum: 4, date: '2083/06/16', time: 'BSM221', subject: 'Fundamentals of Probability and Statistics', type: 'Examination' },
  { semester: 'IV', semNum: 4, date: '2083/06/21', time: 'CIT224', subject: 'Computer Graphics Technology', type: 'Examination' },

  // Semester VI
  { semester: 'VI', semNum: 6, date: '2083/05/22', time: 'CIT321', subject: 'Human Computer Interface and UI Design', type: 'Examination' },
  { semester: 'VI', semNum: 6, date: '2083/05/25', time: 'CIT323', subject: 'Artificial Intelligence', type: 'Examination' },
  { semester: 'VI', semNum: 6, date: '2083/05/31', time: 'BCT322', subject: 'Financial Accounting', type: 'Examination' },
  { semester: 'VI', semNum: 6, date: '2083/06/05', time: 'BCT321', subject: 'IT Project Management', type: 'Examination' },
  { semester: 'VI', semNum: 6, date: '2083/06/08', time: 'CIT322', subject: 'Digital Forensic Security Technologies', type: 'Examination' },

  // Semester VIII
  { semester: 'VIII', semNum: 8, date: '2083/05/16', time: 'CIT421', subject: 'Big Data Technologies', type: 'Examination' },
  { semester: 'VIII', semNum: 8, date: '2083/05/18', time: 'BCT421', subject: 'Society, IT and Law', type: 'Examination' },
  { semester: 'VIII', semNum: 8, date: '2083/05/22', time: 'Elective', subject: 'IoT and Smart Technologies / E-Business and E-Commerce', type: 'Examination' }
];

// Website Navigation Constants
const SITE_PAGES = [
  { name: 'Dashboard', url: 'dashboard.html', description: 'Recent file uploads, campus feed, announcements' },
  { name: 'Library', url: 'library.html', description: 'Browse uploaded subject notes, assignments, documents' },
  { name: 'Syllabus', url: 'syllabus.html', description: 'Full 8-semester Gandaki University BIT curriculum' },
  { name: 'Routine', url: 'routine.html', description: 'Pre-board examination timetable and dates' },
  { name: 'Chat', url: 'chat.html', description: 'Real-time student community discussion group' },
  { name: 'Upload', url: 'files.html', description: 'Upload notes and study resources' },
  { name: 'Profile', url: 'profile.html', description: 'Student profile settings and uploads history' },
  { name: 'AI Assistant', url: 'chatbot.html', description: 'AI study assistant grounded in website library' }
];

// ============================================================================
// 3. DETERMINISTIC ROUTE RESOLVER
// ============================================================================

const RouteResolver = {
  getSemesterSyllabusRoute(semMeta) {
    if (!semMeta) return 'syllabus.html';
    return `syllabus.html#${encodeURIComponent(semMeta.year)}/${encodeURIComponent(semMeta.roman)}`;
  },

  getCourseSyllabusRoute(semMeta, courseTitle, courseCode) {
    if (!semMeta || !courseTitle) return 'syllabus.html';
    const key = courseCode ? `${courseCode}-${courseTitle}` : courseTitle;
    return `syllabus.html#${encodeURIComponent(semMeta.year)}/${encodeURIComponent(semMeta.roman)}/${encodeURIComponent(key)}`;
  },

  getSemesterRoutineRoute(semMeta) {
    if (!semMeta) return 'routine.html';
    return `routine.html?semester=${encodeURIComponent(semMeta.roman)}`;
  },

  getLibrarySubjectRoute(subjectName) {
    if (!subjectName) return 'library.html';
    return `library.html#${encodeURIComponent(subjectName)}`;
  },

  getFileDownloadRoute(fileId) {
    return `/api/files/${fileId}/download`;
  },

  getNoticeRoute() {
    return 'dashboard.html';
  }
};

// ============================================================================
// 4. QUERY UNDERSTANDING & MULTI-INTENT PARSER
// ============================================================================

/**
 * Parses user message into structured query metadata.
 * Distinguishes:
 * - RESOURCE_SEARCH (Mode A)
 * - WEBSITE_INFO (Mode B)
 * - KNOWLEDGE_QUESTION (Mode C)
 * - NAVIGATE_RESOURCE (Mode D)
 * - MULTI_INTENT
 */
function parseQueryIntent(rawQuery, conversationHistory = []) {
  const q = (rawQuery || '').toLowerCase().trim();

  // 1. Detect Smalltalk / Greeting
  if (/^(hi|hello|hey|greetings|good morning|good evening|how are you|whats up|sup|thanks|thank you|bye|goodbye)\b/i.test(q)) {
    return {
      intent: 'SMALLTALK',
      resourceType: null,
      semester: null,
      subject: null,
      topic: null,
      searchQuery: q,
      subQueries: []
    };
  }

  // 2. Extract Active Context from Conversation History (for follow-ups like "what about its syllabus?", "and PYQs?")
  let contextualSemester = null;
  let contextualSubject = null;
  let contextualTopic = null;

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      if (msg.content) {
        const histSem = normalizeSemester(msg.content);
        if (histSem && !contextualSemester) contextualSemester = histSem;

        const histSubj = matchSubjectInText(msg.content);
        if (histSubj && !contextualSubject) contextualSubject = histSubj;

        const histTopic = matchTopicInText(msg.content);
        if (histTopic && !contextualTopic) contextualTopic = histTopic;
      }
    }
  }

  // 3. Check for Multi-Intent Conjunctions ("Give me DBMS notes and tell me when the exam is")
  const multiIntentConjunction = /\b(?:and\s+(?:tell\s+me|show\s+me|when\s+is|what\s+is|give\s+me)|also\s+(?:tell\s+me|show\s+me|when\s+is|give\s+me))\b/i;
  if (multiIntentConjunction.test(q)) {
    const parts = q.split(/\band\b|\balso\b/i).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const subQueries = parts.map(part => parseSingleIntent(part, contextualSemester, contextualSubject, contextualTopic));
      return {
        intent: 'MULTI_INTENT',
        resourceType: 'MULTIPLE',
        semester: subQueries.find(s => s.semester)?.semester || contextualSemester,
        subject: subQueries.find(s => s.subject)?.subject || contextualSubject,
        topic: subQueries.find(s => s.topic)?.topic || contextualTopic,
        searchQuery: q,
        subQueries
      };
    }
  }

  return parseSingleIntent(q, contextualSemester, contextualSubject, contextualTopic);
}

// --- Pure Fast Levenshtein Distance for Typo & Fuzzy Prediction ---
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = Array(lb + 1);
  let curr = Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }
  return prev[lb];
}

function escapeRegex(str) {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function matchSubjectInText(text) {
  const t = text.toLowerCase();

  // 0. High priority coding language patterns
  if (/\b(?:in\s+c|c\s+program|c\s+programming|c\s+code|c\s+language|wap\s+in\s+c)\b/i.test(t)) {
    return 'Computer Programming I (C)';
  }
  if (/\b(?:in\s+java|java\s+program|java\s+programming|java\s+code|wap\s+in\s+java|java\s+oop)\b/i.test(t)) {
    return 'Computer Programming II (Java)';
  }

  // 1. Check exact word boundary matches on aliases (longest alias first)
  const sortedAliases = Array.from(ALIAS_TO_SUBJECT.keys()).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (alias.length < 3) continue;
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i');
    if (regex.test(t)) {
      return ALIAS_TO_SUBJECT.get(alias);
    }
  }

  // 2. Fuzzy Typo & Predictive Matching across tokens (only for non-stop words with min length >= 5)
  const queryWords = t.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5);
  for (const word of queryWords) {
    for (const alias of sortedAliases) {
      if (alias.length >= 5 && !alias.includes(' ')) {
        const dist = levenshteinDistance(word, alias);
        if (dist <= 1) {
          return ALIAS_TO_SUBJECT.get(alias);
        }
      }
    }
  }

  return null;
}

function matchTopicInText(text) {
  const t = text.toLowerCase();

  // 1. Exact / Boundary Synonym Match in TOPIC_DEFINITIONS (Full phrase matching)
  for (const item of TOPIC_DEFINITIONS) {
    for (const syn of item.synonyms) {
      const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(syn)}([^a-z0-9]|$)`, 'i');
      if (regex.test(t)) {
        return item;
      }
    }
  }

  // 2. Dynamic Match in all 300+ Syllabus Units (Full phrase matching)
  for (const unit of DYNAMIC_SYLLABUS_UNITS) {
    const uTitleLower = unit.unitTitle.toLowerCase();
    if (uTitleLower.length >= 4) {
      const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(uTitleLower)}([^a-z0-9]|$)`, 'i');
      if (regex.test(t)) {
        return {
          topic: unit.unitTitle,
          synonyms: [unit.unitTitle],
          canonicalSubject: unit.canonicalSubject,
          semesterNum: unit.semesterNum,
          unit: `Unit ${unit.unitNum}: ${unit.unitTitle}`
        };
      }
    }
  }

  // 3. Fuzzy topic matching ONLY against single-word synonyms (e.g. "determinants", "normalization")
  // Multi-word phrases like "complex numbers" MUST NEVER match just because the word "number" appeared!
  const words = t.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 6);
  for (const word of words) {
    for (const item of TOPIC_DEFINITIONS) {
      for (const syn of item.synonyms) {
        if (!syn.includes(' ') && syn.length >= 6) {
          const dist = levenshteinDistance(word, syn);
          if (dist <= 1) {
            return item;
          }
        }
      }
    }
  }

  return null;
}

function parseSingleIntent(queryStr, ctxSem, ctxSubj, ctxTopic) {
  const q = queryStr.toLowerCase().trim();

  // Extract Direct Entities from Query Text
  let explicitSemester = normalizeSemester(q);
  let explicitSubject = matchSubjectInText(q);
  let topicObj = matchTopicInText(q);

  let subject = explicitSubject;
  let semester = explicitSemester;

  if (topicObj) {
    if (!subject) subject = topicObj.canonicalSubject;
    if (!semester && topicObj.semesterNum && explicitSubject) {
      semester = SEMESTER_REGISTRY[topicObj.semesterNum];
    }
  }

  // Handle follow-up pronouns and time refs ("what about tomorrow", "show its notes")
  const hasPronounRef = /\b(it|its|this|that|same|tomorrow|tonight|next(?:\s+one)?|the next one)\b/i.test(q);
  if (hasPronounRef) {
    if (!semester && ctxSem) semester = ctxSem;
    if (!subject && ctxSubj) subject = ctxSubj;
    if (!topicObj && ctxTopic) topicObj = ctxTopic;
  }

  // ---- ADVANCED RESOURCE TYPE CLASSIFICATION ----
  // Phase 1: Detect if user is EXPLICITLY requesting a resource (not just mentioning keywords)

  // Request verbs — user is asking FOR something, not asking ABOUT something
  const hasResourceRequestVerb = /\b(give\s+me|show\s+me|find\s+me|find\s+(?:some|any)?|send\s+me|get\s+me|download|provide|share|pull\s+up|i\s+need|i\s+want|do\s+(we|you)\s+have|is\s+there|are\s+there|where\s+(can\s+i\s+find|is|are))\b/i.test(q);

  // Resource noun detectors (presence check only — NOT intent)
  const mentionsNoteNouns = /\b(note|notes|pdf|pdfs|slides|handouts|study\s+material|lecture\s+notes|material|materials)\b/i.test(q);
  const mentionsSyllabusNouns = /\b(syllabus|curriculum|course\s+outline|course\s+content)\b/i.test(q);
  const mentionsRoutineNouns = /\b(routine|timetable|exam\s+date|exam\s+time|exam\s+schedule|pre-?board\s+schedule)\b/i.test(q);
  const mentionsPYQNouns = /\b(pyq|pyqs|previous\s+year|past\s+questions|old\s+questions|question\s+paper|model\s+question)\b/i.test(q);
  const mentionsNoticeNouns = /\b(notice|notices|announcement|announcements)\b/i.test(q);

  // Direct resource request patterns: "X notes", "notes for X", standalone "notes" at end of query
  const isNounDirectRequest = /\b(notes|pdf|slides|handouts|syllabus|routine|timetable|schedule|pyq|pyqs|question\s+paper|past\s+questions|previous\s+year\s+questions?|old\s+questions|model\s+question)\s+(for|of|on|about)\b/i.test(q) ||
    /\b(notes|pdf|slides|handouts|material|syllabus|routine|schedule|pyqs?|questions?)\s*[?.!]?\s*$/i.test(q) ||
    /^(notes|pdf|slides|handouts|syllabus|routine|schedule|pyq|pyqs|previous\s+year|past\s+questions|model\s+question)\b/i.test(q);

  // "When is X exam?" — always a routine request, never a knowledge question
  const isWhenExamPattern = /\b(when\s+is|when\s+are|when\s+does|when\s+do|what\s+date|what\s+day|which\s+date)\b.*\b(exam|test|pre-?board|board)\b/i.test(q) ||
    /\b(exam|test|pre-?board)\b.*\b(when|date|day|schedule)\b/i.test(q);

  // Phase 2: Set resource type ONLY when clear request signals are present
  let resourceType = null;
  if ((hasResourceRequestVerb || isNounDirectRequest) && mentionsNoteNouns) {
    resourceType = 'NOTE';
  } else if ((hasResourceRequestVerb || isNounDirectRequest) && mentionsSyllabusNouns) {
    resourceType = 'SYLLABUS';
  } else if (isWhenExamPattern || ((hasResourceRequestVerb || isNounDirectRequest) && mentionsRoutineNouns)) {
    resourceType = 'ROUTINE';
  } else if ((hasResourceRequestVerb || isNounDirectRequest) && mentionsPYQNouns) {
    resourceType = 'PYQ';
  } else if (hasResourceRequestVerb && mentionsNoticeNouns) {
    resourceType = 'NOTICE';
  }

  // Phase 3: Intent Classification (default: answer the question, don't push resource cards)
  let intent = 'KNOWLEDGE_QUESTION';

  const isChitChat = /^(hi|hello|hey|who\s+(are\s+you|r\s+u|you)|what\s+is\s+your\s+name|your\s+name|what\s+can\s+you\s+do|how\s+are\s+you|thanks|thank\s+you|bye|good\s+(morning|afternoon|evening))\b/i.test(q.trim()) ||
    q.trim().length <= 2;

  // Explicit file/resource search patterns (strong request signals)
  const isExplicitFileSearch = /\b(give\s+me\s+(?:notes|pdf|handout|file|slides)|find\s+(?:notes|pdf|handout|file)|show\s+me\s+(?:notes|pdf|slides|handouts)|send\s+me\s+(?:notes|pdf|file)|get\s+me\s+(?:notes|pdf|file)|download\s+(?:notes|pdf|file)|where\s+can\s+i\s+find\s+notes|any\s+notes\s+for|have\s+notes\s+for)\b/i.test(q);

  // Broad knowledge/conceptual question verbs — user wants to LEARN, not GET a resource
  const isKnowledgeQuestion = /^(wap|write\s+a?\s*(program|code|function)|code\s+for|program\s+to|what\s+is|what\s+are|what\s+do|what\s+does|what\s+was|what\s+were|explain|describe|tell\s+me\s+(about|something|the|how|what|why)|overview\s+of|how\s+does|how\s+to|how\s+is|how\s+do|how\s+can|how\s+many|why\s+is|why\s+do|why\s+does|differentiate|define|solve|calculate|teach\s+me|difference\s+between|create\s+a\s+function|can\s+you\s+(explain|describe|tell)|list\s+(all|the)\s+(subjects|courses|topics)|what\s+topics|what\s+units|what\s+chapters|what\s+is\s+covered|what\s+will\s+(i|we)\s+(learn|study|cover)|compare|discuss|elaborate|summarize|derive|prove|meaning\s+of|advantages|disadvantages|features\s+of|types\s+of|steps\s+to|process\s+of|what\s+happens|who\s+(invented|created|discovered|developed))\b/i.test(q);
  const isPrefixedKnowledge = /^\s*(can\s+you|could\s+you|please|hey|so|ok|umm?|hmm?|basically|actually|kindly|bro|dude|yo)?\s*(tell\s+me\s+about|explain|describe|what\s+is|what\s+are|what\s+do|how\s+does|how\s+to|how\s+do|how\s+can|how\s+many|overview\s+of|define|difference\s+between|meaning\s+of|discuss|elaborate|summarize)\b/i.test(q);
  // Conceptual questions that contain resource words but do NOT want the resource itself
  // e.g. "what topics come in the exam?", "is normalization in the syllabus?", "how many credits is DSA?"
  const isConceptualWithResourceWord = /\b(what\s+(topics?|chapters?|units?|things?|concepts?|portions?)\s+(come|are|is|will|do|does|should|might|could)\b|what\s+(is|are)\s+(covered|included|taught|there)\s+in|how\s+many\s+(subjects?|courses?|credits?)|is\s+.{0,20}\s+in\s+the\s+(syllabus|exam|curriculum))/i.test(q);

  if (isChitChat) {
    intent = 'CHITCHAT';
    resourceType = 'NONE';
  } else if (isConceptualWithResourceWord && !isExplicitFileSearch && !hasResourceRequestVerb) {
    // "What topics come in the exam?" → answer the question, don't show routine/cards
    intent = 'KNOWLEDGE_QUESTION';
    resourceType = 'NONE';
  } else if ((isKnowledgeQuestion || isPrefixedKnowledge) && !isExplicitFileSearch && !hasResourceRequestVerb && !isWhenExamPattern && !resourceType) {
    // Pure knowledge question with no explicit resource request → just answer
    intent = 'KNOWLEDGE_QUESTION';
    resourceType = 'NONE';
  } else if (isExplicitFileSearch || resourceType === 'NOTE' || resourceType === 'PYQ') {
    intent = 'RESOURCE_SEARCH';
  } else if (resourceType === 'ROUTINE') {
    intent = 'WEBSITE_INFO';
  } else if (resourceType === 'SYLLABUS') {
    intent = 'WEBSITE_INFO';
  } else if (/\b(open|take\s+me\s+to|go\s+to|navigate\s+to|show\s+page)\b/i.test(q)) {
    intent = 'NAVIGATE_RESOURCE';
  } else if (resourceType === 'NOTICE') {
    intent = 'WEBSITE_INFO';
  } else {
    // Default: answer the question directly — no resource cards
    intent = 'KNOWLEDGE_QUESTION';
    resourceType = 'NONE';
  }

  return {
    intent,
    resourceType: resourceType || (intent === 'CHITCHAT' || intent === 'KNOWLEDGE_QUESTION' ? 'NONE' : 'ALL'),
    semester,
    subject,
    topic: topicObj ? topicObj.topic : null,
    topicObj,
    searchQuery: q,
    subQueries: []
  };
}

// ============================================================================
// 4.5 SEARCH-TOOL INTENT + TABLE CACHE
// ============================================================================

const HISTORY_TURNS = 16;
const TABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const SITE_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const tableCache = new Map(); // cacheKey -> { at, rows }
const siteResultCache = new Map(); // sessionId:query -> { at, results }

async function cachedDbAll(db, cacheKey, sql) {
  const hit = tableCache.get(cacheKey);
  if (hit && (Date.now() - hit.at) < TABLE_CACHE_TTL_MS) {
    return hit.rows;
  }
  const rows = await db.all(sql);
  tableCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

const SITE_KEYWORD_RE = /routine|notice|syllabus|exam|schedule|timetable|file|upload|deadline|assignment date/i;
const CODE_KEYWORD_RE = /error|code|function|bug|javascript|python|java|c\+\+|algorithm|debug|syntax|api|sql|query/i;
const SITE_FOLLOWUP_RE = /^(what about|how about|and(?:\s+then)?|tomorrow|tonight|next|the next one|same|that one|it)\b/i;
const SITE_RESOURCE_TYPES = new Set(['ROUTINE', 'SYLLABUS', 'NOTE', 'PYQ', 'NOTICE', 'ALL']);
const SITE_PARSE_INTENTS = new Set(['WEBSITE_INFO', 'RESOURCE_SEARCH', 'NAVIGATE_RESOURCE']);

/**
 * Cheap keyword/regex pass — decides Gemini Google Search grounding.
 * Returns: 'site' | 'code' | 'general' | 'smalltalk'
 */
function classifyIntent(message, conversationHistory = [], queryMeta = null) {
  const text = String(message || '');

  // Explicit site/resource intent wins over overlapping words such as "file" or "sql".
  if (queryMeta) {
    if (queryMeta.intent === 'CHITCHAT' || queryMeta.intent === 'SMALLTALK') return 'smalltalk';
    if (SITE_PARSE_INTENTS.has(queryMeta.intent) || SITE_RESOURCE_TYPES.has(queryMeta.resourceType)) {
      return 'site';
    }
  }

  if (SITE_KEYWORD_RE.test(text)) return 'site';
  if (CODE_KEYWORD_RE.test(text)) return 'code';

  const histText = (conversationHistory || []).slice(-HISTORY_TURNS).map(m => m.content || '').join(' ');
  if (SITE_KEYWORD_RE.test(histText) && (SITE_FOLLOWUP_RE.test(text.trim()) || /\b(tomorrow|tonight|next exam|same subject)\b/i.test(text))) {
    return 'site';
  }

  return 'general';
}

function cacheKeyForSiteQuery(sessionId, query, student = {}) {
  return `${sessionId || 'anonymous'}:${student.studentId || 'guest'}:${String(query || '').toLowerCase().trim()}`;
}

function cloneSearchResults(results) {
  return {
    matchedFiles: [...(results.matchedFiles || [])],
    matchedCourses: [...(results.matchedCourses || [])],
    matchedRoutine: [...(results.matchedRoutine || [])],
    actions: [...(results.actions || [])],
    debug: { ...(results.debug || {}) }
  };
}

function forceSiteSearchMeta(queryMeta, message) {
  if (!queryMeta) return queryMeta;
  const q = message || queryMeta.searchQuery || '';
  const alreadyTyped = queryMeta.resourceType && queryMeta.resourceType !== 'NONE';
  if (alreadyTyped) return queryMeta;

  const looksRoutine = /\b(routine|exam|schedule|timetable|deadline|assignment date)\b/i.test(q);
  const looksSyllabus = /\b(syllabus|curriculum)\b/i.test(q);
  const looksFiles = /\b(file|upload|notes?|pdf|pyq)\b/i.test(q);
  const looksNotice = /\b(notice|announcement)\b/i.test(q);

  if (looksRoutine) queryMeta.resourceType = 'ROUTINE';
  else if (looksSyllabus) queryMeta.resourceType = 'SYLLABUS';
  else if (looksFiles) queryMeta.resourceType = 'NOTE';
  else if (looksNotice) queryMeta.resourceType = 'NOTICE';
  else queryMeta.resourceType = 'ALL';

  if (queryMeta.intent === 'KNOWLEDGE_QUESTION' || queryMeta.intent === 'CHITCHAT') {
    queryMeta.intent = queryMeta.resourceType === 'NOTE' ? 'RESOURCE_SEARCH' : 'WEBSITE_INFO';
  }
  return queryMeta;
}

function hasSiteMatches(searchResults) {
  return Boolean(
    (searchResults.matchedFiles && searchResults.matchedFiles.length > 0) ||
    (searchResults.matchedCourses && searchResults.matchedCourses.length > 0) ||
    (searchResults.matchedRoutine && searchResults.matchedRoutine.length > 0)
  );
}

function formatHistoryPlain(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return '(none)';
  return conversationHistory.slice(-HISTORY_TURNS).map(msg => {
    const role = msg.role === 'assistant' || msg.role === 'model' ? 'Kyana' : 'User';
    return `${role}: ${msg.content || ''}`;
  }).join('\n');
}

function buildSiteContext(searchResults) {
  const files = searchResults.matchedFiles.length > 0
    ? searchResults.matchedFiles.map(f => `- [File #${f.id}] "${f.title || f.originalName}" | Subject: ${f.subject} | Semester: ${f.semester || 'General'} | Chapter: ${f.chapter || 'All'}`).join('\n')
    : 'No files matched.';
  const courses = searchResults.matchedCourses.length > 0
    ? searchResults.matchedCourses.map(c => `- ${c.title} (${c.code}) [Semester ${c.semester}, ${c.credit} Credits]: ${c.objectivesSummary}`).join('\n')
    : 'No syllabus courses matched.';
  const routine = searchResults.matchedRoutine.length > 0
    ? searchResults.matchedRoutine.map(r => `- Semester ${r.semester}: ${r.subject} on ${r.date} (${r.day}) at ${r.time} [${r.type}]`).join('\n')
    : 'No routine matched.';
  const pages = SITE_PAGES.map(p => `- ${p.name} (${p.url}): ${p.description}`).join('\n');

  return `=== MATCHED FILES IN LIBRARY ===
${files}

=== MATCHED SYLLABUS COURSES ===
${courses}

=== MATCHED EXAM ROUTINE ===
${routine}

=== PLATFORM PAGES ===
${pages}`;
}

function buildKyanaSystemPrompt({ siteContext, historyText, userMessage, searchBucket, useSearch, hasSiteData }) {
  const searchRuleNote = useSearch
    ? `Live Google Search is ENABLED this turn. Use it for accuracy on programming, technical, or general questions — especially anything version-specific or likely outdated.`
    : `Live Google Search is DISABLED this turn. Do NOT invent campus facts, exam dates, notices, or uploaded files. If SITE_CONTEXT is empty for a campus question, say you couldn't find it in the library yet.`;

  return `You are Kyana, the AI assistant for Gandaki University's student portal (Semester Library / BIT). You're not a corporate chatbot — you're a smart, chill senior who knows the campus inside out and is always down to help. Think of yourself as a friend students text when they're stuck, not a helpdesk.

## PERSONALITY & TONE
- Talk like a real person texting a friend: casual, warm, a little playful. Use words like "ngl", "fr", "lowkey", "no cap" naturally — but don't force one into every single sentence, that reads try-hard.
- Skip corporate phrases entirely: never say "I'd be happy to assist you", "Please let me know if you have further questions", "As an AI language model".
- Keep responses tight. Don't pad with fluff — say what's useful, then stop.
- If you don't know something, say so like a friend would: "hmm idk that one tbh, lemme check" — not a formal disclaimer.
- Use emojis sparingly, only when they add something (not every message).
- You can joke around, but never at the cost of being actually useful — humor is a bonus, not a substitute for a real answer.

Example tone:
User: "when's the DBMS exam"
You: "DBMS final is on [date] at [time], room [X] — don't sleep on it 💀 want me to check what chapters are covered too?"

User: "explain recursion in js"
You: "ok so recursion is basically a function calling itself until it hits a stop condition (the 'base case'), otherwise it just loops forever and crashes your stack. quick example: [code]. wanna see it with an actual problem like factorial or fibonacci?"

User: "do we have OS unit 2 notes?"
You: "Found a couple — lecture slides for Process Scheduling plus a unit 2 summary. they're right below. ngl don't wait till the night before 💀"

## WHAT YOU HAVE ACCESS TO
1. SITE_CONTEXT — real data pulled from this university's own database: uploaded files, syllabus, exam routine, notices, static page info. This is passed to you as context below.
2. Your own training knowledge — general concepts, programming, explanations.
3. Live Google Search (only enabled for certain question types — see rules below).

${searchRuleNote}

Question bucket this turn: ${searchBucket}. Site matches present: ${hasSiteData ? 'yes' : 'no'}.

## ANSWER PRIORITY RULES — FOLLOW STRICTLY
1. **Routine, notices, syllabus, exam dates, deadlines, uploaded files** → ALWAYS answer from SITE_CONTEXT if it's present there. Never guess, never use outside knowledge, never use search for these — the source of truth is the university's own database. If SITE_CONTEXT doesn't have it, say honestly you couldn't find it in the library yet and suggest checking with faculty/admin — do NOT make something up.
2. **Programming, technical, or general knowledge questions** (code, debugging, concepts, "how does X work", current events, etc.) → Use your knowledge, and live search is enabled for these — feel free to reference it for accuracy, especially anything that could be outdated or version-specific. Explain thoroughly and use markdown code blocks.
3. **Ambiguous questions** → Check SITE_CONTEXT first. If nothing relevant is there, answer normally.

Never blend an outside guess into a site-data answer (e.g. don't invent an exam date if it's not in SITE_CONTEXT — check first, then say if it's missing).

If SITE_CONTEXT has a routine/notice/file match, quote from that. Don't hedge. The cards under your message already show files — keep the text short when cards are present.

Do NOT volunteer extra resource types the student didn't ask for.

## FORMATTING
- Use markdown: code blocks for code, bold for key info like dates/times, short bullet lists when listing multiple things.
- Keep paragraphs short — this is a chat widget, not an essay.
- For code answers, always explain briefly what the code does, don't just dump code with zero context.

## CONTEXT PROVIDED THIS TURN
SITE_CONTEXT:
${siteContext}

CONVERSATION HISTORY (last ${HISTORY_TURNS} turns):
${historyText}

USER MESSAGE:
${userMessage}

Respond as Kyana now, following all rules above.`;
}

// ============================================================================
// 5. CANONICAL CENTRAL SEARCH SERVICE (searchWebsite)
// ============================================================================

/**
 * Searches website resources (files, syllabus, routine) with hard constraints,
 * multi-tiered relevance scoring, and zero-hallucination thresholds.
 */
async function searchWebsite(db, queryMeta, student = {}) {
  const { intent, resourceType, semester, subject, topic, topicObj, searchQuery } = queryMeta;

  console.log(`[AI Search Engine] Query: "${searchQuery}" | Intent: ${intent} | Type: ${resourceType} | Sem: ${semester ? semester.num : 'None'} | Subj: ${subject || 'None'} | Topic: ${topic || 'None'}`);

  const results = {
    matchedFiles: [],
    matchedCourses: [],
    matchedRoutine: [],
    actions: [],
    debug: {}
  };

  // If user is just chatting or asking a general knowledge/identity question, do not search cards!
  if (intent === 'CHITCHAT' || intent === 'SMALLTALK' || intent === 'KNOWLEDGE_QUESTION' || resourceType === 'NONE') {
    console.log(`[AI Search Engine] Skipping card search for non-resource query (Intent: ${intent}, Type: ${resourceType})`);
    return results;
  }

  // --------------------------------------------------------------------------
  // Resource Search Flags — rely on intent classification, no re-scanning keywords
  // --------------------------------------------------------------------------
  const isRoutineQuery = resourceType === 'ROUTINE' || resourceType === 'ALL' || resourceType === 'NOTICE';
  const isSyllabusQuery = resourceType === 'SYLLABUS' || resourceType === 'ALL';
  const wantsFiles = resourceType === 'NOTE' || resourceType === 'PYQ' || resourceType === 'ALL' || intent === 'RESOURCE_SEARCH';

  // --------------------------------------------------------------------------
  // 1. Search Files in Library with Advanced BM25 + Multi-Tier Scoring & Strict Verification
  // --------------------------------------------------------------------------
  if (wantsFiles) {
    try {
      const allFiles = await cachedDbAll(db, 'files:all', `
        SELECT id, storedName, originalName, title, subject, chapter, semester, uploadedBy, sizeBytes, uploadedAt 
        FROM files 
        ORDER BY id DESC
      `);

      if (!allFiles || allFiles.length === 0) {
        results.matchedFiles = [];
        return results;
      }

      // Comprehensive English and domain stop words
      const stopWords = new Set([
        'give', 'notes', 'find', 'show', 'semester', 'please', 'with', 'what', 'have', 'note',
        'some', 'about', 'material', 'materials', 'study', 'pdfs', 'slides', 'send', 'want',
        'need', 'course', 'tell', 'from', 'help', 'there', 'any', 'for', 'the', 'and', 'are', 'you',
        'me', 'of', 'in', 'on', 'at', 'to', 'a', 'an', 'is', 'it', 'get', 'can', 'i', 'will', 'do',
        'does', 'did', 'how', 'when', 'where', 'why', 'all', 'handouts', 'lecture', 'lectures'
      ]);

      const rawTokens = searchQuery
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.has(w));

      console.log(`[AI Search Engine] Extracted Keywords from "${searchQuery}":`, rawTokens);

      // Build BM25 Corpus Statistics
      const N = allFiles.length;
      const k1 = 1.2;
      const b = 0.75;

      const docTokensList = allFiles.map(f => {
        const full = `${f.subject || ''} ${f.chapter || ''} ${f.title || ''} ${f.originalName || ''}`.toLowerCase();
        return full.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
      });

      const avgDocLen = docTokensList.reduce((sum, d) => sum + d.length, 0) / (N || 1);

      // Document frequencies (DF) for each query token
      const dfMap = new Map();
      rawTokens.forEach(token => {
        let count = 0;
        docTokensList.forEach(tokens => {
          if (tokens.includes(token)) count++;
        });
        dfMap.set(token, count);
      });

      // Specific Chapter/Unit and Lecture Number Extraction
      const lectureMatch = searchQuery.match(/\b(?:lecture|lec|l)\s*(\d+)\b/i);
      const targetLecNum = lectureMatch ? lectureMatch[1] : null;

      const unitMatch = searchQuery.match(/\b(?:unit|chapter|ch)\s*(\d+)\b/i);
      const targetUnitNum = unitMatch ? unitMatch[1] : null;

      const cleanQueryPhrase = rawTokens.join(' ');

      // Substring & Token Helper
      function matchesToken(token, text) {
        if (!token || !text) return false;
        const tLower = text.toLowerCase();
        const tokLower = token.toLowerCase();
        if (tokLower.length <= 4) {
          const regex = new RegExp(`(^|[^a-z0-9])${tokLower.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
          return regex.test(tLower);
        }
        return tLower.includes(tokLower);
      }

      const scoredFiles = allFiles.map((f, docIdx) => {
        let score = 0;
        const fSubject = (f.subject || '').toLowerCase();
        const fChapter = (f.chapter || '').toLowerCase();
        const fTitle = (f.title || '').toLowerCase();
        const fOriginal = (f.originalName || '').toLowerCase();
        const fullFileText = `${fSubject} ${fChapter} ${fTitle} ${fOriginal}`;
        const docTokens = docTokensList[docIdx];
        const docLen = docTokens.length;

        // 1. Strict Explicit Semester Constraint (Eliminates Cross-Semester Contamination)
        if (semester) {
          const fileSemMeta = normalizeSemester(f.semester);
          if (fileSemMeta && fileSemMeta.num !== semester.num) {
            return { file: f, score: -999, reasons: ['Mismatched semester'] };
          } else if (fileSemMeta && fileSemMeta.num === semester.num) {
            score += 35;
          }
        }

        // 2. Subject Affinity Scoring & Strict Mismatch Filter
        let isFileSubjectMatch = false;
        if (subject) {
          const canonicalLower = subject.toLowerCase();
          const isExactSubj = fSubject.includes(canonicalLower) || fTitle.includes(canonicalLower);

          let hasAliasMatch = false;
          const aliases = SUBJECT_ALIASES[subject] || [];
          for (const a of aliases) {
            if (fullFileText.includes(a.toLowerCase())) {
              hasAliasMatch = true;
              break;
            }
          }

          if (isExactSubj || hasAliasMatch) {
            score += 85;
            isFileSubjectMatch = true;
          } else {
            // Check if file belongs to an ENTIRELY DIFFERENT known subject
            let fileBelongsToOtherSubject = false;
            for (const [otherSubj, otherAliases] of Object.entries(SUBJECT_ALIASES)) {
              if (otherSubj !== subject) {
                if (fSubject.includes(otherSubj.toLowerCase())) {
                  fileBelongsToOtherSubject = true;
                  break;
                }
              }
            }

            if (fileBelongsToOtherSubject) {
              // If user explicitly searched for a specific subject, NEVER return notes from a conflicting subject!
              return { file: f, score: -999, reasons: ['Conflicting subject'] };
            }
            score -= 40;
          }
        }

        // 3. BM25 Probabilistic Relevance Calculation
        let bm25Score = 0;
        let tokenHits = 0;

        rawTokens.forEach(token => {
          const df = dfMap.get(token) || 0;
          // Standard Lucene/BM25 IDF
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

          // Term frequency in document
          let tf = 0;
          docTokens.forEach(dt => { if (dt === token) tf++; });

          if (tf > 0) {
            tokenHits++;
            const tfWeight = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / (avgDocLen || 1))));
            bm25Score += idf * tfWeight * 20;
          }
        });
        score += bm25Score;

        // 4. Topic Definition & Syllabus Alignment Boost
        if (topicObj) {
          let topicMatched = false;
          for (const syn of topicObj.synonyms) {
            if (fullFileText.includes(syn.toLowerCase())) {
              score += 95;
              topicMatched = true;
              break;
            }
          }
          if (topicObj.unit && fullFileText.includes(topicObj.unit.toLowerCase())) {
            score += 85;
            topicMatched = true;
          }
          if (topicMatched) score += 45;
        }

        // 5. Exact Phrase & N-Gram Match
        if (cleanQueryPhrase.length >= 4 && fullFileText.includes(cleanQueryPhrase)) {
          score += 120;
        }

        // 6. Lecture & Unit Number Exact Matching
        if (targetLecNum) {
          const lecRegex = new RegExp(`(^|[^a-z0-9])(?:lecture|lec|l)\\s*0*${targetLecNum}([^a-z0-9]|$)`, 'i');
          if (lecRegex.test(fTitle) || lecRegex.test(fOriginal) || lecRegex.test(fChapter)) {
            score += 95;
          } else {
            score -= 20;
          }
        }

        if (targetUnitNum) {
          const unitRegex = new RegExp(`(^|[^a-z0-9])(?:unit|chapter|ch)\\s*0*${targetUnitNum}([^a-z0-9]|$)`, 'i');
          if (unitRegex.test(fChapter) || unitRegex.test(fTitle)) {
            score += 80;
          } else {
            score -= 15;
          }
        }

        // 7. Field-Specific Priority Weights
        for (const token of rawTokens) {
          if (matchesToken(token, fTitle)) score += 30;
          if (matchesToken(token, fChapter)) score += 25;
          if (matchesToken(token, fSubject)) score += 20;
          if (matchesToken(token, fOriginal)) score += 15;
        }

        // Multi-Token Coverage Bonus
        if (rawTokens.length >= 2) {
          const coverageRatio = tokenHits / rawTokens.length;
          if (coverageRatio === 1) {
            score += 60; // 100% keyword coverage
          } else if (coverageRatio >= 0.5) {
            score += 25;
          }
        }

        // Fuzzy Typo Match Bonus if zero direct token hits
        if (tokenHits === 0 && rawTokens.length > 0) {
          for (const token of rawTokens) {
            if (token.length >= 4) {
              for (const dt of docTokens) {
                if (dt.length >= 4) {
                  const dist = levenshteinDistance(token, dt);
                  if (dist <= 1) {
                    score += 25;
                    tokenHits++;
                    break;
                  }
                }
              }
            }
          }
        }

        // If user searched for specific keywords and this file had ZERO keyword hits, and no subject/topic match, penalize
        if (rawTokens.length > 0 && tokenHits === 0 && !isFileSubjectMatch && !topicObj) {
          score = -999;
        }

        // When user asks for specific topic notes (e.g. "DBMS unit 2"), heavily penalize files that only match subject
        // but NOT the specific topic — prevents flooding with irrelevant subject-wide notes
        if (topicObj && isFileSubjectMatch && !rawTokens.some(token => fullFileText.includes(token))) {
          score -= 30;
        }
        if (targetUnitNum && isFileSubjectMatch && !fChapter.includes(targetUnitNum) && !fTitle.includes(targetUnitNum)) {
          score -= 25;
        }

        return { file: f, score, tokenHits };
      });

      // Filter with Adaptive Relevance Threshold
      // Higher threshold when subject/topic detected for precision; lower for general searches
      const MIN_RELEVANCE_SCORE = (subject || topicObj) ? 60 : 45;

      // Precision limit: return fewer, more relevant files — don't overwhelm with loosely-matched results
      const maxFileResults = (subject || topicObj) ? 3 : 4;
      const filteredFiles = scoredFiles
        .filter(item => item.score >= MIN_RELEVANCE_SCORE)
        .sort((a, b) => b.score - a.score)
        .map(item => item.file)
        .slice(0, maxFileResults);

      results.matchedFiles = filteredFiles;
      console.log(`[AI Search Engine] Filtered Files (${filteredFiles.length} matches):`, filteredFiles.map(f => f.title || f.originalName));
    } catch (err) {
      console.error('[AI Search Engine] File search error:', err.message);
    }
  }

  // --------------------------------------------------------------------------
  // 2. Search Syllabus Curriculum (Only if user explicitly asked for syllabus)
  // --------------------------------------------------------------------------
  if (isSyllabusQuery) {
    const matchedCourses = ALL_COURSES.filter(c => {
      // Semester constraint
      if (semester) {
        if (c.semester.toUpperCase() !== semester.roman && c.semesterNum !== semester.num) {
          return false;
        }
      }

      // Subject constraint — when specified, ONLY return the exact matching course
      if (subject) {
        if (c.title === subject) return true;
        const aliases = SUBJECT_ALIASES[subject] || [];
        if (aliases.some(a => c.title.toLowerCase().includes(a.toLowerCase()))) return true;
        return false; // Strict: if subject specified, exclude all non-matching courses
      }

      // Topic constraint — only return the course containing this topic
      if (topicObj) {
        if (c.title === topicObj.canonicalSubject) return true;
        for (const syn of topicObj.synonyms) {
          if (c.contents.toLowerCase().includes(syn.toLowerCase())) return true;
        }
        return false; // Strict: don't include unrelated courses
      }

      // Semester-only query — return all courses for that semester
      if (semester) {
        return true;
      }

      // No subject, topic, or semester = too vague — return nothing
      return false;
    });

    // Precision limit: specific subject/topic → max 2, semester-wide → max 5
    const maxSyllabusResults = (subject || topicObj) ? 2 : 5;
    results.matchedCourses = matchedCourses.slice(0, maxSyllabusResults);
    console.log(`[AI Search Engine] Filtered Courses (${results.matchedCourses.length} matches):`, results.matchedCourses.map(c => c.title));
  }

  // --------------------------------------------------------------------------
  // 3. Search Examination Routine (Only if user explicitly asked for routine)
  // --------------------------------------------------------------------------
  if (isRoutineQuery) {
    let allRoutines = [];
    try {
      allRoutines = await cachedDbAll(db, 'exam_schedule:all', 'SELECT * FROM exam_schedule ORDER BY id ASC');
    } catch (e) {
      allRoutines = DEFAULT_ROUTINE_SCHEDULE;
    }
    if (!allRoutines || allRoutines.length === 0) allRoutines = DEFAULT_ROUTINE_SCHEDULE;

    const matchedRoutine = allRoutines.filter(r => {
      const rSem = normalizeSemester(r.semester);
      // Semester filter
      if (semester) {
        if (!rSem || rSem.num !== semester.num) return false;
      }

      // Subject filter
      if (subject) {
        const rSubj = (r.subject || '').toLowerCase();
        const sSubj = subject.toLowerCase();
        const norm = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (rSubj.includes(sSubj) || sSubj.includes(rSubj) || (norm(rSubj) && norm(sSubj) && (norm(rSubj).includes(norm(sSubj)) || norm(sSubj).includes(norm(rSubj))))) return true;
        const aliases = SUBJECT_ALIASES[subject] || [];
        if (aliases.some(a => {
          const aLower = a.toLowerCase();
          return rSubj.includes(aLower) || aLower.includes(rSubj) || (norm(rSubj) && norm(aLower) && (norm(rSubj).includes(norm(aLower)) || norm(aLower).includes(norm(rSubj))));
        })) return true;
        return false;
      }

      return true;
    });

    // Precision limit: specific subject → max 2, semester/general → max 5
    const routineSlice = matchedRoutine.slice(0, subject ? 2 : 5);

    results.matchedRoutine = routineSlice.map(r => {
      const rSem = normalizeSemester(r.semester);
      return {
        semester: rSem ? rSem.roman : (r.semester || 'General'),
        subject: r.subject,
        date: r.examdate || r.examDate || r.date || 'To be announced',
        day: r.day || '',
        time: r.time || '11:30 AM',
        type: r.type || 'Examination'
      };
    });

    console.log(`[AI Search Engine] Filtered Routine (${results.matchedRoutine.length} matches):`, results.matchedRoutine.map(r => `${r.subject} (${r.date})`));
  }

  // --------------------------------------------------------------------------
  // 4. Deterministic Action Button Generation
  // --------------------------------------------------------------------------
  results.actions = buildDeterministicActions(queryMeta, results);

  return results;
}

/**
 * Builds precise, labeled action navigation buttons that link directly to actual website routes.
 */
function buildDeterministicActions(queryMeta, searchResults) {
  const actions = [];
  const seenUrls = new Set();

  function addAction(label, url) {
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      actions.push({ label, url });
    }
  }

  const { semester, subject, resourceType, topic } = queryMeta;
  const isRoutine = resourceType === 'ROUTINE' || queryMeta.searchQuery.includes('routine') || queryMeta.searchQuery.includes('exam');
  const isSyllabus = resourceType === 'SYLLABUS' || queryMeta.searchQuery.includes('syllabus') || queryMeta.searchQuery.includes('curriculum');
  const wantsFiles = resourceType === 'NOTE' || resourceType === 'PYQ' || searchResults.matchedFiles.length > 0;

  // 1. Exact Routine Navigation (Only when routine was requested)
  if (isRoutine || searchResults.matchedRoutine.length > 0) {
    if (semester) {
      addAction(`Open Semester ${semester.num} Routine`, RouteResolver.getSemesterRoutineRoute(semester));
    } else {
      addAction('Open Exam Routine', 'routine.html');
    }
  }

  // 2. Exact Syllabus Navigation (Only when syllabus was requested)
  if (isSyllabus || (searchResults.matchedCourses.length > 0 && !isRoutine && !wantsFiles)) {
    if (semester) {
      addAction(`Open Semester ${semester.num} Syllabus`, RouteResolver.getSemesterSyllabusRoute(semester));
    } else {
      addAction('Open Full Syllabus', 'syllabus.html');
    }
  }

  // 3. Subject-Specific Library Navigation (Only when files were requested or matched)
  if (wantsFiles && searchResults.matchedFiles.length > 0) {
    const exactFileSubj = searchResults.matchedFiles[0].subject || subject;
    if (exactFileSubj) {
      addAction(`Open ${exactFileSubj} in Library`, RouteResolver.getLibrarySubjectRoute(exactFileSubj));
    }
  }

  // 4. File-Specific Direct Download Action
  if (wantsFiles && searchResults.matchedFiles.length === 1) {
    const f = searchResults.matchedFiles[0];
    addAction(`Download "${f.title || f.originalName}"`, RouteResolver.getFileDownloadRoute(f.id));
  }

  return actions.slice(0, 3);
}

// ============================================================================
// 6. GROUNDED AI ANSWER GENERATION (Gemini + OpenRouter Fallback)
// ============================================================================

/**
 * HARD PRIVACY GUARD — Detects and blocks queries that ask to find or reveal
 * personal information about a real individual (classmate, student, private person).
 * This fires regardless of whether the question looks like a site query or a web query.
 * Returns true if the query should be blocked.
 */
function isPrivacyViolationQuery(q) {
  const text = (q || '').toLowerCase();

  // Verbs that signal "look this person up"
  const lookupVerbs = /\b(find|search|look\s*up|get|tell\s+me|what(?:'s|\s+is)|give\s+me|show\s+me|locate|track|fetch|reveal|share|send\s+me|do\s+you\s+have|what\s+do\s+you\s+know\s+about)\b/i;

  // Personal info nouns people might try to extract
  const privateInfoNouns = /\b(phone\s*(?:number|no|num)?|mobile\s*(?:number|no|num)?|contact(?:\s+(?:number|info|detail))?|social\s+media|facebook|instagram|snapchat|whatsapp|tiktok|twitter|email\s*(?:address)?|home\s*address|address|personal\s+(?:detail|info|data|profile)|private\s+(?:info|detail|data)|id\s*(?:number)?|student\s*id|account(?:\s+(?:name|link|detail))?)\b/i;

  // Patterns like "find [Name]'s phone" or "get [Name]'s number"
  // Matches possessives, "of [Name]", or "for [Name]"  
  const possessiveOrOf = /\b(?:[A-Za-z][a-z]+'s|of\s+[A-Z][a-z]+|for\s+[A-Z][a-z]+|about\s+[A-Z][a-z]+)\b/;

  // Standalone red-flag phrases that need no further analysis
  const redFlagPhrases = [
    /\bfind\s+(?:someone|a\s+classmate|my\s+classmate|a\s+student|student)\b/i,
    /\b(?:classmate|student|person|friend|someone)\b.*\b(?:phone|number|contact|address|social|instagram|whatsapp)\b/i,
    /\b(?:phone|number|contact|social|instagram|whatsapp)\b.*\b(?:classmate|student|person|friend|someone)\b/i,
    /\bwho\s+is\s+[A-Z][a-z]+\b.*\b(?:phone|number|contact|social|real|person)\b/i,
    /\btrack\s+(?:someone|a\s+(?:classmate|student|person))\b/i
  ];

  for (const pattern of redFlagPhrases) {
    if (pattern.test(q)) return true;
  }

  // Combination match: lookup verb + private info noun (with or without name indicator)
  if (lookupVerbs.test(text) && privateInfoNouns.test(text)) {
    return true;
  }

  // Possessive + private info: "[Name]'s phone number"
  if (possessiveOrOf.test(q) && privateInfoNouns.test(text)) {
    return true;
  }

  return false;
}

async function callGroundedAI(userMessage, queryMeta, searchResults, conversationHistory = [], intentBucket = 'general') {
  const { intent, resourceType, semester, subject, topic } = queryMeta;

  // ── HARD PRIVACY GUARD ─────────────────────────────────────────────────────
  // Block ALL queries asking to look up personal info about a real person.
  // This fires BEFORE any API call — no external model ever sees the query.
  if (isPrivacyViolationQuery(userMessage)) {
    console.log(`[AI Privacy Guard] Blocked personal-info query: "${userMessage.substring(0, 80)}"`);
    return {
      replyText: `That's not something I can help with. Looking up personal details — like someone's phone number, contact info, or social media — isn't what this tool is for, and it's not safe to do that for any student or person here.\n\nIf you need to reach a classmate, the best way is through the Group Chat or asking them directly. Is there anything study-related I can help you with?`,
      isWebSearch: false,
      webSources: [],
      sourceLabel: ''
    };
  }

  const hasSiteData = hasSiteMatches(searchResults);
  const isSmalltalkOrIdentity = /^(hi|hello|hey|who\s+(are\s+you|r\s+u|you)|what\s+is\s+your\s+name|your\s+name|what\s+can\s+you\s+do|how\s+are\s+you|thanks|thank\s+you|bye|good\s+(morning|afternoon|evening))\b/i.test(userMessage.trim()) ||
    /(who are you|what is your name|your name|introduce yourself)/i.test(userMessage);
  const useSearch = intentBucket === 'code' || (intentBucket === 'general' && !hasSiteData);
  const isWebFallback = useSearch && !isSmalltalkOrIdentity;

  // Site-only misses must never reach a model that could fill in campus facts.
  if (intentBucket === 'site' && !hasSiteData) {
    return {
      replyText: `Hmm, couldn't find that in the library yet. I'd check with faculty/admin for the latest info.`,
      isWebSearch: false,
      webSources: [],
      sourceLabel: ''
    };
  }

  const systemPrompt = buildKyanaSystemPrompt({
    siteContext: buildSiteContext(searchResults),
    historyText: formatHistoryPlain(conversationHistory),
    userMessage,
    searchBucket: intentBucket,
    useSearch,
    hasSiteData
  });

  /*
   * The prompt above is shared by Gemini and OpenRouter. Keeping the policy in
   * one place prevents fallback responses from losing Kyana's tone or source rules.
   */
  const messages = [{ role: 'system', content: systemPrompt }];


  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-HISTORY_TURNS).forEach(msg => {
      messages.push({
        role: msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user',
        content: msg.content
      });
    });
  }

  messages.push({ role: 'user', content: userMessage });

  let rawReply = '';
  let isWebSearch = false;
  let webSources = [];
  let sourceLabel = '';

  // 1. Try Gemini API (with Google Search Grounding when falling back to internet)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const requestBody = {
        contents: contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      };

      // Grounding is decided by the pre-model intent bucket.
      if (useSearch) {
        requestBody.tools = [{ googleSearch: {} }];
        // Lower temperature for factual web answers to reduce hallucination
        requestBody.generationConfig.temperature = 0.3;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(12000)
      });

      if (res.ok) {
        const data = await res.json();
        const candidate = data.candidates?.[0];
        rawReply = candidate?.content?.parts?.map(p => p.text || '').join('').trim() || '';

        // Extract Google Search Grounding Metadata if available
        if (candidate?.groundingMetadata) {
          isWebSearch = true;
          sourceLabel = '🌐 From the web — not from Semester Library';
          const meta = candidate.groundingMetadata;
          const chunks = meta.groundingChunks || [];
          chunks.forEach(chunk => {
            if (chunk.web && chunk.web.uri) {
              try {
                const urlObj = new URL(chunk.web.uri);
                webSources.push({
                  title: chunk.web.title || urlObj.hostname.replace(/^www\./, ''),
                  url: chunk.web.uri,
                  domain: urlObj.hostname.replace(/^www\./, '')
                });
              } catch (uErr) {
                webSources.push({
                  title: chunk.web.title || 'Web Source',
                  url: chunk.web.uri,
                  domain: 'web'
                });
              }
            }
          });

          // Deduplicate web sources by URL
          webSources = Array.from(new Map(webSources.map(s => [s.url, s])).values()).slice(0, 5);

          // Append a clean, server-formatted source block to the reply
          if (webSources.length > 0 && rawReply) {
            const sourceLines = webSources
              .map(s => `• [${s.title || s.domain}](${s.url})`)
              .join('\n');
            rawReply = rawReply.trimEnd() + `\n\n🔗 **Sources:**\n${sourceLines}`;
          }
        } else if (isWebFallback) {
          // Gemini responded but without explicit grounding metadata — still mark as web
          isWebSearch = true;
          sourceLabel = '🌐 From the web — not from Semester Library';
        }
      }
    } catch (e) {
      console.warn('[AI Service] Gemini invocation notice:', e.message);
    }
  }

  // 2. Try OpenRouter API Fallback
  if (!rawReply && process.env.OPENROUTER_API_KEY) {
    try {
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Kyana - Semester Library Assistant'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct',
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const data = await response.json();
        const openRouterReply = data.choices?.[0]?.message?.content || '';
        if (openRouterReply) {
          if (isWebFallback) {
            // OpenRouter cannot do live search — prepend an honest ungrounded disclaimer
            // so students know this is training-data knowledge, not a real-time search result.
            rawReply = `⚠️ I can't verify this with a live search right now — here's what I know from my training data, but please double-check before relying on it:\n\n${openRouterReply}`;
            isWebSearch = true;
            sourceLabel = '⚠️ Unverified — live search unavailable, answer from training data only';
          } else {
            rawReply = openRouterReply;
          }
        }
      }
    } catch (e) {
      console.warn('[AI Service] OpenRouter fallback notice:', e.message);
    }
  }

  // 3. Fallback Template Generator if external AI models are unreachable
  if (!rawReply) {
    if (isSmalltalkOrIdentity) {
      rawReply = `Hey! I'm Kyana, your study assistant for Semester Library. I can help you pull up notes, check syllabus details, or look up exam dates. What are you working on?`;
    } else if (intent === 'RESOURCE_SEARCH') {
      if (searchResults.matchedFiles.length > 0) {
        rawReply = `Found ${searchResults.matchedFiles.length} file(s) for that in the library:\n\n` +
          searchResults.matchedFiles.map(f => `- **${f.title || f.originalName}** (${f.subject || 'General'})`).join('\n') +
          `\n\nYou can view or download them right below!`;
      } else {
        rawReply = `Don't see anything uploaded for "${userMessage}" yet — want me to check another topic or subject?`;
      }
    } else if (intent === 'WEBSITE_INFO' && searchResults.matchedRoutine.length > 0) {
      rawReply = `Here are the upcoming exam dates:\n\n` +
        searchResults.matchedRoutine.map(r => `- **${r.subject}** (${r.time || 'CIT'}): **${r.date}**`).join('\n');
    } else if (intent === 'WEBSITE_INFO' && searchResults.matchedCourses.length > 0) {
      rawReply = `Here's the course lineup:\n\n` +
        searchResults.matchedCourses.map(c => `- **${c.title}** (${c.code}) — ${c.credit} credits`).join('\n');
    } else {
      rawReply = `Here's what I found from the library for you!`;
    }
  }

  return {
    replyText: rawReply,
    isWebSearch,
    webSources,
    sourceLabel
  };
}

// ============================================================================
// 7. MAIN ASSISTANT DISPATCHER (handleChat)
// ============================================================================

async function handleChat(db, userMessage, studentInfo = {}, conversationHistory = [], sessionId = 'anonymous') {
  const query = (userMessage || '').trim();
  if (!query) {
    return {
      reply: 'Please ask a question about website notes, syllabus, or exam routines.',
      actions: [],
      matchedFiles: [],
      matchedCourses: [],
      matchedRoutine: [],
      isWebSearch: false,
      webSources: [],
      sourceLabel: ''
    };
  }

  // 1. Query understanding happens before any model call.
  const queryMeta = parseQueryIntent(query, conversationHistory);
  const intentBucket = classifyIntent(query, conversationHistory, queryMeta);
  const cacheKey = cacheKeyForSiteQuery(sessionId, query, studentInfo);
  console.log(`[AI Assistant] path=${intentBucket} query="${query.substring(0, 100)}"`);

  // 2. Smalltalk / Chitchat passes through to dynamic AI generation with zero extra cards
  // (Central search returns empty matched cards for chitchat)

  // 3. Centralized Search Service Execution
  let searchResults;
  if (queryMeta.intent === 'MULTI_INTENT') {
    // Combine sub-query searches
    const combinedFiles = [];
    const combinedCourses = [];
    const combinedRoutine = [];
    const combinedActions = [];

    for (const sub of queryMeta.subQueries) {
      const subRes = await searchWebsite(db, sub, studentInfo);
      combinedFiles.push(...subRes.matchedFiles);
      combinedCourses.push(...subRes.matchedCourses);
      combinedRoutine.push(...subRes.matchedRoutine);
      combinedActions.push(...subRes.actions);
    }

    // Deduplicate
    const uniqueFiles = Array.from(new Map(combinedFiles.map(f => [f.id, f])).values());
    const uniqueCourses = Array.from(new Map(combinedCourses.map(c => [c.code, c])).values());
    const uniqueRoutine = Array.from(new Map(combinedRoutine.map(r => [`${r.semester}-${r.subject}`, r])).values());
    const uniqueActions = Array.from(new Map(combinedActions.map(a => [a.url, a])).values());

    searchResults = {
      matchedFiles: uniqueFiles,
      matchedCourses: uniqueCourses,
      matchedRoutine: uniqueRoutine,
      actions: uniqueActions
    };
  } else if (intentBucket === 'site' || intentBucket === 'general') {
    const cached = siteResultCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < SITE_RESULT_CACHE_TTL_MS) {
      searchResults = cloneSearchResults(cached.results);
      console.log(`[AI Assistant] path=${intentBucket} site-cache=hit`);
    } else {
      searchResults = await searchWebsite(db, queryMeta, studentInfo);
      siteResultCache.set(cacheKey, { at: Date.now(), results: cloneSearchResults(searchResults) });
      console.log(`[AI Assistant] path=${intentBucket} site-cache=miss`);
    }
  } else {
    searchResults = { matchedFiles: [], matchedCourses: [], matchedRoutine: [], actions: [], debug: {} };
  }

  // 4. Grounded AI Response Generation
  let aiOutput = { replyText: '', isWebSearch: false, webSources: [], sourceLabel: '' };
  try {
    aiOutput = await callGroundedAI(query, queryMeta, searchResults, conversationHistory, intentBucket);
  } catch (err) {
    console.error('[AI Assistant] callGroundedAI error:', err.message);
    aiOutput.replyText = `I encountered a temporary issue processing your request. Please try again.`;
  }

  return {
    reply: aiOutput.replyText,
    intent: queryMeta.intent,
    resourceType: queryMeta.resourceType,
    actions: searchResults.actions,
    matchedFiles: searchResults.matchedFiles,
    matchedCourses: searchResults.matchedCourses,
    matchedRoutine: searchResults.matchedRoutine,
    isWebSearch: aiOutput.isWebSearch,
    webSources: aiOutput.webSources || [],
    sourceLabel: aiOutput.sourceLabel || ''
  };
}

module.exports = {
  handleChat,
  classifyIntent,
  parseQueryIntent,
  searchWebsite,
  normalizeSemester,
  RouteResolver,
  CANONICAL_SUBJECTS,
  SUBJECT_ALIASES,
  TOPIC_DEFINITIONS
};
