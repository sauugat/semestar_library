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

// Ingest Syllabus Data
let syllabusData = { semesters: [] };
const ALL_COURSES = [];
const CANONICAL_SUBJECTS = new Map(); // Canonical Title -> Subject Info
const ALIAS_TO_SUBJECT = new Map();   // Alias string -> Canonical Title
const TOPIC_REGISTRY = [];            // Array of { topic, synonyms, canonicalSubject, semesterNum, unitName }

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
        });
      });
    }
  }
} catch (e) {
  console.error('[AI Assistant] Error parsing syllabus-data.json:', e.message);
}

// Comprehensive Subject Aliases Dictionary
const SUBJECT_ALIASES = {
  'Database Management System': ['dbms', 'db', 'database', 'sql', 'mysql', 'relational database', 'database system', 'database management'],
  'Data Structure and Algorithms': ['dsa', 'ds', 'algo', 'algorithms', 'data structure', 'data structures', 'linked list', 'stack and queue', 'binary tree'],
  'Mathematics I': ['math 1', 'math i', 'm1', 'calculus', 'derivatives', 'integration', 'maths 1', 'first semester math'],
  'Mathematics II': ['math 2', 'math ii', 'm2', 'complex numbers', 'complex number', 'complex variables', 'infinite series', 'differential equations', 'maths 2', 'second semester math'],
  'Discrete Mathematics': ['discrete math', 'discrete mathematics', 'discrete', 'graph theory', 'finite automata', 'fsm', 'fsa', 'recurrence relations'],
  'Computer Programming I (C)': ['c programming', 'c prog', 'prog 1', 'prog i', 'c language', 'c prog 1', 'computer programming 1'],
  'Computer Programming II (Java)': ['java', 'java programming', 'prog 2', 'prog ii', 'oop java', 'oop', 'computer programming 2', 'swing gui'],
  'Digital Logic': ['digital logic', 'dl', 'logic gates', 'boolean algebra', 'k map', 'karnaugh map', 'flip flop', 'combinational circuits'],
  'Web Technology I': ['web 1', 'web tech 1', 'web technology 1', 'web technology i', 'html css', 'php mysql', 'web dev 1', 'web development 1'],
  'Web Technology II': ['web 2', 'web tech 2', 'web technology 2', 'web technology ii', 'react', 'node', 'fullstack web', 'web dev 2'],
  'Microprocessor and Computer Architecture': ['microprocessor', 'computer architecture', 'coa', 'mp', '8085', 'intel 8085', '8086', 'assembly', 'assembly language', 'cpu architecture'],
  'Operating Systems': ['operating systems', 'operating system', 'os', 'linux', 'unix', 'processes and threads', 'deadlock', 'virtual memory', 'paging'],
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

function matchSubjectInText(text) {
  const t = text.toLowerCase();
  
  // 1. Check exact word boundary matches on aliases
  const sortedAliases = Array.from(ALIAS_TO_SUBJECT.keys()).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (alias.length < 3) continue;
    const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(t)) {
      return ALIAS_TO_SUBJECT.get(alias);
    }
  }

  // 2. Fuzzy Typo & Predictive Matching across tokens
  const words = t.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
  for (const word of words) {
    for (const alias of sortedAliases) {
      if (alias.length >= 4) {
        const dist = levenshteinDistance(word, alias);
        const maxAllowed = word.length <= 5 ? 1 : 2;
        if (dist <= maxAllowed) {
          return ALIAS_TO_SUBJECT.get(alias);
        }
      }
    }
  }

  return null;
}

function matchTopicInText(text) {
  const t = text.toLowerCase();
  for (const item of TOPIC_DEFINITIONS) {
    for (const syn of item.synonyms) {
      const regex = new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(t)) {
        return item;
      }
    }
  }

  // Fuzzy topic matching
  const words = t.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5);
  for (const word of words) {
    for (const item of TOPIC_DEFINITIONS) {
      for (const syn of item.synonyms) {
        const synWords = syn.split(/\s+/);
        for (const sw of synWords) {
          if (sw.length >= 5) {
            const dist = levenshteinDistance(word, sw);
            if (dist <= 1) {
              return item;
            }
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

  // Extract clean search tokens
  let subject = explicitSubject;
  let semester = explicitSemester;

  if (topicObj) {
    if (!subject) subject = topicObj.canonicalSubject;
    // Only inherit semester from topic if not explicitly specified
    if (!semester && topicObj.semesterNum && explicitSubject) {
      semester = SEMESTER_REGISTRY[topicObj.semesterNum];
    }
  }

  // Handle follow-up pronouns ("what about its syllabus?", "show its notes")
  const hasPronounRef = /\b(it|its|this|that|same)\b/i.test(q);
  if (hasPronounRef) {
    if (!semester && ctxSem) semester = ctxSem;
    if (!subject && ctxSubj) subject = ctxSubj;
    if (!topicObj && ctxTopic) topicObj = ctxTopic;
  }

  // Detect Resource Type
  let resourceType = null;
  if (/\b(note|notes|pdf|pdfs|slides|handouts|study material|doc|docs|lecture|exercises|exercise|material|materials|slides)\b/i.test(q)) {
    resourceType = 'NOTE';
  } else if (/\b(syllabus|curriculum|course outline|course content|credit|credits)\b/i.test(q)) {
    resourceType = 'SYLLABUS';
  } else if (/\b(routine|exam|schedule|timetable|exam date|exam time|pre-board|preboard)\b/i.test(q)) {
    resourceType = 'ROUTINE';
  } else if (/\b(pyq|pyqs|previous year|past questions|old questions|question paper|model question)\b/i.test(q)) {
    resourceType = 'PYQ';
  } else if (/\b(notice|notices|announcement|announcements|news)\b/i.test(q)) {
    resourceType = 'NOTICE';
  } else if (/\b(subject|subjects|courses|classes)\b/i.test(q)) {
    resourceType = 'SUBJECT';
  }

  // Classify Intent Mode
  let intent = 'WEBSITE_INFO';

  const isChitChat = /^(hi|hello|hey|who\s+(are\s+you|r\s+u|you)|what\s+is\s+your\s+name|your\s+name|what\s+can\s+you\s+do|how\s+are\s+you|thanks|thank\s+you|bye|good\s+(morning|afternoon|evening))\b/i.test(q.trim()) ||
    q.trim().length <= 2;

  const isResourceSearchVerb = /\b(give\s+me|find|show\s+me|send\s+me|search|get\s+me|download|where\s+can\s+i\s+find|where\s+is|provide)\b/i.test(q);
  const isKnowledgeVerb = /^(what\s+is|what\s+are|explain|how\s+does|how\s+to|why\s+is|differentiate|define|solve|calculate|teach\s+me)\b/i.test(q);

  if (isChitChat) {
    intent = 'CHITCHAT';
    resourceType = 'NONE';
  } else if (isKnowledgeVerb && !resourceType && !/\b(routine|exam|schedule|syllabus|library|upload|semester|file)\b/i.test(q)) {
    intent = 'KNOWLEDGE_QUESTION';
    resourceType = 'NONE';
  } else if (isResourceSearchVerb && (resourceType === 'NOTE' || resourceType === 'PYQ' || topicObj || subject)) {
    intent = 'RESOURCE_SEARCH';
  } else if (/\b(open|take\s+me\s+to|go\s+to|navigate\s+to|show\s+page)\b/i.test(q)) {
    intent = 'NAVIGATE_RESOURCE';
  } else if (resourceType === 'NOTE' || resourceType === 'PYQ') {
    intent = 'RESOURCE_SEARCH';
  } else if (resourceType === 'SYLLABUS' || resourceType === 'ROUTINE' || resourceType === 'NOTICE' || resourceType === 'SUBJECT') {
    intent = 'WEBSITE_INFO';
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
  if (intent === 'CHITCHAT' || intent === 'KNOWLEDGE_QUESTION' || resourceType === 'NONE') {
    return results;
  }

  // --------------------------------------------------------------------------
  // Intent Classification Flags
  // --------------------------------------------------------------------------
  const isRoutineQuery = resourceType === 'ROUTINE' || 
    /\b(routine|exam|schedule|timetable|preboard|pre-board|when is the exam|exam date|exam time)\b/i.test(searchQuery);

  const isSyllabusQuery = resourceType === 'SYLLABUS' || 
    resourceType === 'SUBJECT' ||
    /\b(syllabus|curriculum|course outline|credit|credits|course content|subjects taught|courses taught)\b/i.test(searchQuery);

  const wantsFiles = resourceType === 'NOTE' || 
    resourceType === 'PYQ' || 
    intent === 'RESOURCE_SEARCH' ||
    Boolean(topicObj) ||
    /\b(note|notes|pdf|pdfs|slide|slides|handout|handouts|doc|docs|material|materials|download)\b/i.test(searchQuery);

  // --------------------------------------------------------------------------
  // 1. Search Files in Library with Advanced Fuzzy & TF-IDF Scoring
  // --------------------------------------------------------------------------
  if (wantsFiles) {
    try {
      const allFiles = await db.all(`
        SELECT id, storedName, originalName, title, subject, chapter, semester, uploadedBy, sizeBytes, uploadedAt 
        FROM files 
        ORDER BY id DESC
      `);

      // Clean query tokens
      const stopWords = new Set([
        'give', 'notes', 'find', 'show', 'semester', 'please', 'with', 'what', 'have', 'note',
        'some', 'about', 'material', 'materials', 'study', 'pdfs', 'slides', 'send', 'want',
        'need', 'course', 'tell', 'from', 'help', 'there', 'any', 'for', 'the', 'and', 'are', 'you'
      ]);

      const rawTokens = searchQuery
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.has(w));

      // Check for specific lecture/chapter numbers in query (e.g. "lecture 12", "unit 3", "ch 2")
      const lectureMatch = searchQuery.match(/\b(?:lecture|lec|l)\s*(\d+)\b/i);
      const targetLecNum = lectureMatch ? lectureMatch[1] : null;

      const unitMatch = searchQuery.match(/\b(?:unit|chapter|ch)\s*(\d+)\b/i);
      const targetUnitNum = unitMatch ? unitMatch[1] : null;

      const cleanQueryPhrase = rawTokens.join(' ');

      const scoredFiles = allFiles.map(f => {
        let score = 0;
        const fSubject = (f.subject || '').toLowerCase();
        const fChapter = (f.chapter || '').toLowerCase();
        const fTitle = (f.title || '').toLowerCase();
        const fOriginal = (f.originalName || '').toLowerCase();
        const fullFileText = `${fSubject} ${fChapter} ${fTitle} ${fOriginal}`;

        // 1. Strict Explicit Semester Constraint
        if (semester) {
          const fileSemMeta = normalizeSemester(f.semester);
          if (fileSemMeta && fileSemMeta.num !== semester.num) {
            return { file: f, score: -999 };
          } else if (fileSemMeta && fileSemMeta.num === semester.num) {
            score += 30;
          }
        }

        // 2. Subject Boost / Soft Constraint
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
            score += 70;
          } else {
            score -= 30; // soft penalty
          }
        }

        // 3. Topic & Synonym Matching
        if (topicObj) {
          let topicMatched = false;
          for (const syn of topicObj.synonyms) {
            if (fullFileText.includes(syn.toLowerCase())) {
              score += 90;
              topicMatched = true;
              break;
            }
          }
          if (topicObj.unit && fullFileText.includes(topicObj.unit.toLowerCase())) {
            score += 80;
            topicMatched = true;
          }
          if (topicMatched) score += 40;
        }

        // 4. Exact Phrase Match
        if (cleanQueryPhrase.length >= 4 && fullFileText.includes(cleanQueryPhrase)) {
          score += 100;
        }

        // 5. Lecture / Unit Number Precision Match
        if (targetLecNum) {
          const lecRegex = new RegExp(`\\b(?:lecture|lec|l)\\s*${targetLecNum}\\b`, 'i');
          if (lecRegex.test(fTitle) || lecRegex.test(fOriginal)) {
            score += 90;
          }
        }

        if (targetUnitNum) {
          const unitRegex = new RegExp(`\\b(?:unit|chapter|ch)\\s*${targetUnitNum}\\b`, 'i');
          if (unitRegex.test(fChapter) || unitRegex.test(fTitle)) {
            score += 70;
          }
        }

        // 6. Token Overlap Scoring
        let tokenHits = 0;
        for (const token of rawTokens) {
          let tokenFound = false;
          if (fTitle.includes(token)) {
            score += 35;
            tokenFound = true;
          }
          if (fChapter.includes(token)) {
            score += 30;
            tokenFound = true;
          }
          if (fSubject.includes(token)) {
            score += 25;
            tokenFound = true;
          }
          if (fOriginal.includes(token)) {
            score += 15;
            tokenFound = true;
          }
          if (tokenFound) tokenHits++;
        }

        // Reward files that match multiple query tokens
        if (rawTokens.length > 0 && tokenHits === rawTokens.length) {
          score += 40;
        }

        return { file: f, score };
      });

      const filteredFiles = scoredFiles
        .filter(item => item.score >= 35)
        .sort((a, b) => b.score - a.score)
        .map(item => item.file)
        .slice(0, 5);

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

      // Subject constraint
      if (subject) {
        if (c.title === subject) return true;
        const aliases = SUBJECT_ALIASES[subject] || [];
        if (aliases.some(a => c.title.toLowerCase().includes(a.toLowerCase()))) return true;
      }

      // Topic constraint
      if (topicObj) {
        if (c.title === topicObj.canonicalSubject) return true;
        for (const syn of topicObj.synonyms) {
          if (c.contents.toLowerCase().includes(syn.toLowerCase())) return true;
        }
      }

      // General query token match
      if (!subject && !topicObj && semester) {
        return true;
      }

      if (!subject && !topicObj && !semester) {
        const fullCourse = `${c.title} ${c.code} ${c.objectives} ${c.contents}`.toLowerCase();
        return searchQuery.length > 3 && fullCourse.includes(searchQuery);
      }

      return false;
    }).slice(0, 6);

    results.matchedCourses = matchedCourses;
    console.log(`[AI Search Engine] Filtered Courses (${matchedCourses.length} matches):`, matchedCourses.map(c => c.title));
  }

  // --------------------------------------------------------------------------
  // 3. Search Examination Routine (Only if user explicitly asked for routine)
  // --------------------------------------------------------------------------
  if (isRoutineQuery) {
    let allRoutines = [];
    try {
      allRoutines = await db.all('SELECT * FROM exam_schedule ORDER BY id ASC');
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
        if (rSubj.includes(sSubj) || sSubj.includes(rSubj)) return true;
        const aliases = SUBJECT_ALIASES[subject] || [];
        if (aliases.some(a => rSubj.includes(a.toLowerCase()) || a.toLowerCase().includes(rSubj))) return true;
        return false;
      }

      return true;
    }).slice(0, 8);

    results.matchedRoutine = matchedRoutine.map(r => {
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

async function callGroundedAI(userMessage, queryMeta, searchResults, conversationHistory = []) {
  const { intent, resourceType, semester, subject, topic } = queryMeta;

  // System Prompt for Grounded Language Generation with Natural Classmate Tone
  const systemPrompt = `You are Kyana, the AI study assistant for Semester Library at Gandaki University (BIT).

TONE & COMMUNICATION STYLE:
- Talk like a helpful, friendly classmate — not a formal customer support bot.
- Use natural, conversational language. It's fine to use contractions (I'll, you're, that's), start sentences casually, and show a little warmth or light enthusiasm when it fits (e.g. "Found a few good ones for Complex Numbers!" instead of "The following files have been located matching your query.").
- Avoid stiff phrases like "I have located", "Please find below", "According to the available data" — just talk normally, the way a classmate explaining something would.
- Stay concise and don't ramble — natural doesn't mean long-winded.
- Keep the same honesty standard: if you don't have real data to answer something, say so plainly and simply ("Don't see anything uploaded for that yet — want me to check something else?") rather than a formal apology.
- Keep this appropriate for a shared class tool used by many students — friendly and warm, not overly familiar, flirtatious, or unpredictable. This is a reliable assistant students depend on, not a persona or companion character.

CONVERSATIONAL DIALOGUE EXAMPLES (FEW-SHOT TONE BENCHMARK):
- Student: "I literally cannot focus on studying today, my brain is completely fried"
  Kyana: "Felt that. Take a quick 10-minute break — grab some water or step outside for a bit. When you're back, we can tackle just one small section at a time instead of the whole chapter. What subject are you trying to get through?"

- Student: "do we have any notes for operating systems unit 2?"
  Kyana: "Found a couple of good ones! There's lecture slides for Process Scheduling and a chapter summary from Unit 2 uploaded in our library. You can check them out right below."

- Student: "how many credits is data structures?"
  Kyana: "Data Structure and Algorithms (CIT214) is 3 credits in Semester 3 — covers theory and practical lab work."

- Student: "when is the math 2 exam?"
  Kyana: "Our Mathematics-II (BSM121) exam for Semester II is on 2083/06/02. You've got time to practice — let me know if you need any unit notes or formulas!"

- Student: "got any notes on quantum machine learning for sem 1?"
  Kyana: "Don't see anything uploaded for that in our library yet — want me to check something else for Semester 1?"

GROUNDING CONTEXT:
=== MATCHED FILES IN LIBRARY ===
${searchResults.matchedFiles.length > 0 
  ? searchResults.matchedFiles.map(f => `- [File #${f.id}] "${f.title || f.originalName}" | Subject: ${f.subject} | Semester: ${f.semester || 'General'} | Chapter: ${f.chapter || 'All'}`).join('\n')
  : 'No files matched.'}

=== MATCHED SYLLABUS COURSES ===
${searchResults.matchedCourses.length > 0
  ? searchResults.matchedCourses.map(c => `- ${c.title} (${c.code}) [Semester ${c.semester}, ${c.credit} Credits]: ${c.objectivesSummary}`).join('\n')
  : 'No syllabus courses matched.'}

=== MATCHED EXAM ROUTINE ===
${searchResults.matchedRoutine.length > 0
  ? searchResults.matchedRoutine.map(r => `- Semester ${r.semester}: ${r.subject} on ${r.date} (${r.day}) at ${r.time} [${r.type}]`).join('\n')
  : 'No routine matched.'}

=== PLATFORM PAGES ===
${SITE_PAGES.map(p => `- ${p.name} (${p.url}): ${p.description}`).join('\n')}
`;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-6).forEach(msg => {
      messages.push({
        role: msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user',
        content: msg.content
      });
    });
  }

  messages.push({ role: 'user', content: userMessage });

  let rawReply = '';

  // 1. Try Gemini API
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        rawReply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
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
        })
      });

      if (response.ok) {
        const data = await response.json();
        rawReply = data.choices?.[0]?.message?.content || '';
      }
    } catch (e) {
      console.warn('[AI Service] OpenRouter fallback notice:', e.message);
    }
  }

  // 3. Fallback Template Generator if external AI models are unreachable
  if (!rawReply) {
    if (/(who are you|what is your name|your name|introduce yourself)/i.test(userMessage)) {
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

  return rawReply;
}

// ============================================================================
// 7. MAIN ASSISTANT DISPATCHER (handleChat)
// ============================================================================

async function handleChat(db, userMessage, studentInfo = {}, conversationHistory = []) {
  const query = (userMessage || '').trim();
  if (!query) {
    return {
      reply: 'Please ask a question about website notes, syllabus, or exam routines.',
      actions: [],
      matchedFiles: [],
      matchedCourses: [],
      matchedRoutine: []
    };
  }

  // 1. Query Understanding & Intent Decomposition
  const queryMeta = parseQueryIntent(query, conversationHistory);

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
  } else {
    searchResults = await searchWebsite(db, queryMeta, studentInfo);
  }

  // 4. Grounded AI Response Generation
  let replyText = '';
  try {
    replyText = await callGroundedAI(query, queryMeta, searchResults, conversationHistory);
  } catch (err) {
    console.error('[AI Assistant] callGroundedAI error:', err.message);
    replyText = `I encountered a temporary issue processing your request. Please try again.`;
  }

  return {
    reply: replyText,
    intent: queryMeta.intent,
    resourceType: queryMeta.resourceType,
    actions: searchResults.actions,
    matchedFiles: searchResults.matchedFiles,
    matchedCourses: searchResults.matchedCourses,
    matchedRoutine: searchResults.matchedRoutine
  };
}

module.exports = {
  handleChat,
  parseQueryIntent,
  searchWebsite,
  normalizeSemester,
  RouteResolver,
  CANONICAL_SUBJECTS,
  SUBJECT_ALIASES,
  TOPIC_DEFINITIONS
};
