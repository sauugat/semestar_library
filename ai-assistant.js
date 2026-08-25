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
console.log('[AI Assistant] Initializing Semester Library AI Service');
console.log(`[AI Assistant] Gemini API Key Configured: ${process.env.GEMINI_API_KEY ? 'Yes' : 'No'}`);
console.log(`[AI Assistant] OpenRouter API Key Configured: ${process.env.OPENROUTER_API_KEY ? 'Yes' : 'No'}`);
console.log('----------------------------------------------------');

// --- 2. Ingest Syllabus Data ---
let syllabusData = { semesters: [] };
const ALL_COURSES = [];
const KNOWN_SUBJECT_TERMS = new Set();

try {
  const syllabusPath = path.join(__dirname, 'public', 'syllabus-data.json');
  if (fs.existsSync(syllabusPath)) {
    syllabusData = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
    if (syllabusData && syllabusData.semesters) {
      syllabusData.semesters.forEach(sem => {
        sem.courses.forEach(c => {
          ALL_COURSES.push({
            semester: sem.semester,
            year: sem.year,
            title: c.title,
            code: c.code,
            credit: c.credit,
            nature: c.nature,
            objectives: c.objectives || '',
            contents: c.contents || '',
            objectivesSummary: c.objectives ? c.objectives.substring(0, 180) + '…' : '',
            contentsSummary: c.contents ? c.contents.substring(0, 240) + '…' : ''
          });

          c.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(w => {
            if (w.length >= 4) KNOWN_SUBJECT_TERMS.add(w);
          });
        });
      });
    }
  }
} catch (e) {
  console.error('[AI Assistant] Error parsing syllabus-data.json:', e.message);
}

[
  'networking', 'networks', 'network', 'router', 'switch', 'tcp', 'ip',
  'database', 'databases', 'sql', 'mysql', 'queries', 'normalization',
  'programming', 'algorithm', 'algorithms', 'structure', 'structures',
  'operating', 'system', 'systems', 'kernel', 'process', 'memory',
  'electronics', 'circuits', 'logic', 'gates', 'boolean', 'discrete',
  'mathematics', 'calculus', 'derivatives', 'series', 'infinite', 'probability',
  'statistics', 'accounting', 'finance', 'microprocessor', 'architecture',
  'assembly', 'graphics', 'rendering', 'artificial', 'intelligence',
  'forensics', 'security', 'cyber', 'wireless', 'cloud', 'devops', 'mining'
].forEach(t => KNOWN_SUBJECT_TERMS.add(t));

// --- 3. Ingest Pre-Board Routine Schedule ---
const routineExams = [
  { semester: 'II', semNum: 2, date: '2083/04/25', day: 'Monday', time: '11:30 AM', subject: 'Mathematics II', type: 'Pre-board Examination' },
  { semester: 'IV', semNum: 4, date: '2083/04/25', day: 'Monday', time: '11:30 AM', subject: 'Computer Graphics', type: 'Pre-board Examination' },
  { semester: 'VI', semNum: 6, date: '2083/04/25', day: 'Monday', time: '11:30 AM', subject: 'Financial Accounting', type: 'Pre-board Examination' },
  { semester: 'II', semNum: 2, date: '2083/04/26', day: 'Tuesday', time: '11:30 AM', subject: 'Computer Programming II (Java)', type: 'Pre-board Examination' },
  { semester: 'IV', semNum: 4, date: '2083/04/26', day: 'Tuesday', time: '11:30 AM', subject: 'Data Communication and Computer Network', type: 'Pre-board Examination' },
  { semester: 'VI', semNum: 6, date: '2083/04/26', day: 'Tuesday', time: '11:30 AM', subject: 'Artificial Intelligence', type: 'Pre-board Examination' },
  { semester: 'II', semNum: 2, date: '2083/04/27', day: 'Wednesday', time: '11:30 AM', subject: 'Digital Logic', type: 'Pre-board Examination' },
  { semester: 'IV', semNum: 4, date: '2083/04/27', day: 'Wednesday', time: '11:30 AM', subject: 'Operating System', type: 'Pre-board Examination' },
  { semester: 'VI', semNum: 6, date: '2083/04/27', day: 'Wednesday', time: '11:30 AM', subject: 'Digital Forensic Security and Technology', type: 'Pre-board Examination' },
  { semester: 'VIII', semNum: 8, date: '2083/04/27', day: 'Wednesday', time: '11:30 AM', subject: 'Big Data Technologies', type: 'Pre-board Examination' },
  { semester: 'II', semNum: 2, date: '2083/04/28', day: 'Thursday', time: '11:30 AM', subject: 'Discrete Mathematics', type: 'Pre-board Examination' },
  { semester: 'IV', semNum: 4, date: '2083/04/28', day: 'Thursday', time: '11:30 AM', subject: 'Database Management System', type: 'Pre-board Examination' },
  { semester: 'VI', semNum: 6, date: '2083/04/28', day: 'Thursday', time: '11:30 AM', subject: 'Software Engineering and Project Management', type: 'Pre-board Examination' },
  { semester: 'VIII', semNum: 8, date: '2083/04/28', day: 'Thursday', time: '11:30 AM', subject: 'Cloud Computing and Virtualization', type: 'Pre-board Examination' },
  { semester: 'II', semNum: 2, date: '2083/04/29', day: 'Friday', time: '11:30 AM', subject: 'Web Technology I', type: 'Pre-board Examination' },
  { semester: 'IV', semNum: 4, date: '2083/04/29', day: 'Friday', time: '11:30 AM', subject: 'Probability and Statistics', type: 'Pre-board Examination' },
  { semester: 'VI', semNum: 6, date: '2083/04/29', day: 'Friday', time: '11:30 AM', subject: 'Mobile Application Development', type: 'Pre-board Examination' }
];

// --- 3b. Semester-to-Year Mapping (matches syllabus.html hash routing) ---
const SEMESTER_TO_YEAR = {
  'I': 'Year 1', 'II': 'Year 1',
  'III': 'Year 2', 'IV': 'Year 2',
  'V': 'Year 3', 'VI': 'Year 3',
  'VII': 'Year 4', 'VIII': 'Year 4'
};

// --- 3c. Site Structure Knowledge ---
const SITE_MAP = {
  pages: [
    { name: 'Dashboard / Feed', url: 'dashboard.html', description: 'Main feed showing recent uploads, announcements, and activity from all students.' },
    { name: 'Library', url: 'library.html', description: 'Browse all uploaded study notes, assignments, and files organized by subject and chapter. Click any course to see uploaded files.' },
    { name: 'Syllabus', url: 'syllabus.html', description: 'Complete 8-semester BIT curriculum from Gandaki University. Browse by Year → Semester → Course to see full course outlines, unit contents, and textbook references.' },
    { name: 'Routine / Exam Schedule', url: 'routine.html', description: 'Pre-board examination schedule with dates, times, and subjects. Filter by semester (II, IV, VI, VIII).' },
    { name: 'Chat', url: 'chat.html', description: 'Real-time class chat room for students to discuss topics, share links, and ask each other questions.' },
    { name: 'Upload Files', url: 'files.html', description: 'Upload your own notes, assignments, or study materials to the library. Select subject, chapter, and semester.' },
    { name: 'Profile', url: 'profile.html', description: 'View and edit your student profile, avatar, and account settings.' },
    { name: 'AI Assistant', url: 'chatbot.html', description: 'This AI assistant — helps you find notes, syllabus info, and exam schedules on the website.' }
  ],
  features: [
    'Students can upload PDF/DOCX/PPTX notes to the Library under specific subjects and chapters.',
    'The Syllabus page has the complete Gandaki University BIT curriculum for all 8 semesters.',
    'The Routine page shows pre-board exam dates filtered by semester.',
    'The Chat page is a real-time messaging room for class discussions.',
    'Each course in the Library shows uploaded file count and allows direct download.'
  ]
};

// --- 4. CS & Curriculum Alias Dictionary ---
const ALIAS_MAP = {
  'dsa': ['Data Structure and Algorithms', 'Data Structure', 'Algorithms'],
  'ds': ['Data Structure and Algorithms', 'Data Structure'],
  'algo': ['Data Structure and Algorithms', 'Algorithms'],
  'os': ['Operating Systems', 'Operating System'],
  'dbms': ['Database Management System', 'Database', 'SQL'],
  'db': ['Database Management System', 'Database'],
  'sql': ['Database Management System', 'SQL'],
  'prog 1': ['Computer Programming I (C)', 'C Programming', 'C'],
  'prog i': ['Computer Programming I (C)', 'C Programming'],
  'c prog': ['Computer Programming I (C)', 'C Programming'],
  'c programming': ['Computer Programming I (C)', 'C Programming'],
  'prog 2': ['Computer Programming II (Java)', 'Java'],
  'prog ii': ['Computer Programming II (Java)', 'Java'],
  'java': ['Computer Programming II (Java)', 'Java'],
  'oop': ['Computer Programming II (Java)', 'Object Oriented Analysis and Design using UML'],
  'ooad': ['Object Oriented Analysis and Design using UML', 'UML'],
  'uml': ['Object Oriented Analysis and Design using UML'],
  'networking': ['Data Communication and Computer Networks', 'Wireless Communication Systems', 'Networking'],
  'networks': ['Data Communication and Computer Networks', 'Wireless Communication Systems', 'Networking'],
  'network': ['Data Communication and Computer Networks', 'Wireless Communication Systems', 'Networking'],
  'dccn': ['Data Communication and Computer Networks'],
  'cn': ['Data Communication and Computer Networks'],
  'wireless': ['Wireless Communication Systems'],
  'coa': ['Microprocessor and Computer Architecture'],
  'mp': ['Microprocessor and Computer Architecture'],
  'microprocessor': ['Microprocessor and Computer Architecture'],
  'dl': ['Digital Logic'],
  'logic': ['Digital Logic', 'Workshop: Problem Solving and Logic'],
  'electronics': ['Basic Electronics'],
  'math 1': ['Mathematics I', 'Calculus', 'Derivatives'],
  'math i': ['Mathematics I'],
  'm1': ['Mathematics I'],
  'math 2': ['Mathematics II', 'Infinite Series', 'Permutation'],
  'math ii': ['Mathematics II'],
  'm2': ['Mathematics II'],
  'math': ['Mathematics I', 'Mathematics II', 'Discrete Mathematics', 'Math'],
  'maths': ['Mathematics I', 'Mathematics II', 'Discrete Mathematics', 'Math'],
  'discrete': ['Discrete Mathematics'],
  'discrete math': ['Discrete Mathematics'],
  'stats': ['Fundamentals of Probability and Statistics', 'Probability'],
  'prob': ['Fundamentals of Probability and Statistics', 'Probability'],
  'probability': ['Fundamentals of Probability and Statistics'],
  'numerical': ['Numerical Methods'],
  'nm': ['Numerical Methods'],
  'web 1': ['Web Technology I', 'Web Development'],
  'web 2': ['Web Technology II', 'Web Development'],
  'web tech': ['Web Technology I', 'Web Technology II', 'Web Development'],
  'web': ['Web Technology I', 'Web Technology II', 'Web Development', 'Assignment( Web Development )'],
  'graphics': ['Computer Graphics Technology'],
  'cg': ['Computer Graphics Technology'],
  'ui': ['Human Computer Interface and UI Design'],
  'ux': ['Human Computer Interface and UI Design'],
  'hci': ['Human Computer Interface and UI Design'],
  'ai': ['Artificial Intelligence'],
  'se': ['Software Engineering', 'IT Project Management'],
  'software engineering': ['Software Engineering'],
  'cloud': ['Cloud Computing'],
  'devops': ['Software Development and Operations (DevOps)'],
  'big data': ['Big Data Technologies'],
  'data mining': ['Data Mining and Warehousing'],
  'mining': ['Data Mining and Warehousing'],
  'forensics': ['Digital Forensic Security Technologies'],
  'security': ['Digital Forensic Security Technologies'],
  'cyber': ['Digital Forensic Security Technologies'],
  'mobile': ['Mobile Application Development'],
  'android': ['Mobile Application Development'],
  'mad': ['Mobile Application Development'],
  'accounting': ['Financial Accounting'],
  'finance': ['Financial Accounting'],
  'management': ['Principles of Organization and Management', 'IT Project Management'],
  'pom': ['Principles of Organization and Management'],
  'mis': ['Management Information System'],
  'economics': ['Economics'],
  'infinite series': ['infinite series', 'Mathematics II']
};

// --- 5. Pure Fast Levenshtein Distance ---
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

function findClosestTerm(word) {
  if (word.length < 4) return word;
  let bestMatch = word;
  let minDistance = 99;

  for (const term of KNOWN_SUBJECT_TERMS) {
    const dist = levenshteinDistance(word, term);
    const maxAllowed = word.length <= 5 ? 1 : 2;
    if (dist <= maxAllowed && dist < minDistance) {
      minDistance = dist;
      bestMatch = term;
    }
  }
  return bestMatch;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does',
  'did', 'have', 'has', 'had', 'give', 'me', 'find', 'show', 'search', 'get',
  'we', 'i', 'you', 'what', 'whats', 'where', 'when', 'how', 'which', 'who',
  'notes', 'note', 'stuff', 'material', 'materials', 'file', 'files', 'pdf',
  'pdfs', 'slides', 'doc', 'docs', 'please', 'can', 'could', 'would', 'tell',
  'available', 'some', 'any', 'all', 'our', 'my'
]);

function parseSemesterNumber(str) {
  const s = (str || '').toLowerCase();
  if (s.includes('sem 1') || s.includes('semester 1') || s.includes('sem i') || s.includes('semester i') || s.includes('first sem')) return 'I';
  if (s.includes('sem 2') || s.includes('semester 2') || s.includes('sem ii') || s.includes('semester ii') || s.includes('second sem')) return 'II';
  if (s.includes('sem 3') || s.includes('semester 3') || s.includes('sem iii') || s.includes('semester iii') || s.includes('third sem')) return 'III';
  if (s.includes('sem 4') || s.includes('semester 4') || s.includes('sem iv') || s.includes('semester iv') || s.includes('fourth sem')) return 'IV';
  if (s.includes('sem 5') || s.includes('semester 5') || s.includes('sem v') || s.includes('semester v') || s.includes('fifth sem')) return 'V';
  if (s.includes('sem 6') || s.includes('semester 6') || s.includes('sem vi') || s.includes('semester vi') || s.includes('sixth sem')) return 'VI';
  if (s.includes('sem 7') || s.includes('semester 7') || s.includes('sem vii') || s.includes('semester vii') || s.includes('seventh sem')) return 'VII';
  if (s.includes('sem 8') || s.includes('semester 8') || s.includes('sem viii') || s.includes('semester viii') || s.includes('eighth sem')) return 'VIII';
  return null;
}

// --- 6. Tool Execution Functions for Real Data Retrieval ---

async function executeSearchFiles(db, args = {}) {
  const qStr = (args.query || '').toLowerCase().trim();
  const semArg = args.semester ? parseSemesterNumber(args.semester) || args.semester.toUpperCase() : null;

  const rawWords = qStr.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const queryTokens = [];
  rawWords.forEach(w => {
    if (!STOP_WORDS.has(w)) queryTokens.push(findClosestTerm(w));
  });

  const expandedTerms = new Set(queryTokens);
  for (const [alias, fullTerms] of Object.entries(ALIAS_MAP)) {
    if (qStr.includes(alias)) {
      fullTerms.forEach(t => {
        expandedTerms.add(t.toLowerCase());
        t.toLowerCase().split(/\s+/).forEach(w => {
          if (!STOP_WORDS.has(w) && w.length >= 3) expandedTerms.add(w);
        });
      });
    }
  }

  const termsList = Array.from(expandedTerms);

  try {
    const allFiles = await db.all(`
      SELECT id, storedName, originalName, title, subject, chapter, semester, uploadedBy, sizeBytes, uploadedAt 
      FROM files 
      ORDER BY id DESC
    `);

    const scored = allFiles.map(f => {
      let score = 0;
      const fSubject = (f.subject || '').toLowerCase();
      const fChapter = (f.chapter || '').toLowerCase();
      const fTitle = (f.title || '').toLowerCase();
      const fOriginal = (f.originalName || '').toLowerCase();
      const fSemester = (f.semester || '').toUpperCase();
      const fullText = `${fSubject} ${fChapter} ${fTitle} ${fOriginal}`;

      if (semArg && (fSemester === semArg || fullText.includes(`semester ${semArg.toLowerCase()}`))) {
        score += 10;
      }

      termsList.forEach(term => {
        if (term.length < 3) return;
        if (fSubject.includes(term)) score += 10;
        if (fChapter.includes(term)) score += 8;
        if (fTitle.includes(term)) score += 6;
        if (fOriginal.includes(term)) score += 4;
      });

      return { file: f, score };
    });

    const results = scored
      .filter(item => item.score >= 4 || (semArg && item.file.semester === semArg))
      .sort((a, b) => b.score - a.score)
      .map(item => item.file)
      .slice(0, 8);

    return {
      success: true,
      count: results.length,
      files: results.map(f => ({
        id: f.id,
        title: f.title || f.originalName,
        subject: f.subject || 'General',
        chapter: f.chapter || '',
        originalName: f.originalName,
        semester: f.semester || null,
        sizeBytes: f.sizeBytes
      }))
    };
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
}

function executeGetSyllabus(args = {}) {
  const semArg = args.semester ? parseSemesterNumber(args.semester) || args.semester.toUpperCase() : null;
  const subjArg = (args.subject || '').toLowerCase().trim();

  const matched = ALL_COURSES.filter(c => {
    if (semArg && c.semester.toUpperCase() === semArg) return true;
    if (subjArg) {
      const full = `${c.title} ${c.code} ${c.objectives}`.toLowerCase();
      if (full.includes(subjArg)) return true;
      for (const [alias, fullTerms] of Object.entries(ALIAS_MAP)) {
        if (subjArg.includes(alias)) {
          if (fullTerms.some(t => full.includes(t.toLowerCase()))) return true;
        }
      }
    }
    return false;
  }).slice(0, 8);

  return {
    success: true,
    count: matched.length,
    courses: matched.map(c => ({
      code: c.code,
      title: c.title,
      semester: c.semester,
      year: c.year,
      credit: c.credit,
      nature: c.nature,
      objectives: c.objectivesSummary,
      contents: c.contentsSummary
    }))
  };
}

function executeGetSiteMap() {
  return {
    success: true,
    pages: SITE_MAP.pages,
    features: SITE_MAP.features
  };
}

function executeGetRoutine(args = {}) {
  const semArg = args.semester ? parseSemesterNumber(args.semester) || args.semester.toUpperCase() : null;
  const subjArg = (args.subject || '').toLowerCase().trim();

  const matched = routineExams.filter(r => {
    if (semArg && r.semester.toUpperCase() === semArg) return true;
    if (subjArg) {
      const s = r.subject.toLowerCase();
      if (s.includes(subjArg)) return true;
      for (const [alias, fullTerms] of Object.entries(ALIAS_MAP)) {
        if (subjArg.includes(alias)) {
          if (fullTerms.some(t => s.includes(t.toLowerCase()))) return true;
        }
      }
    }
    if (!semArg && !subjArg) return true; // full routine
    return false;
  }).slice(0, 8);

  return {
    success: true,
    count: matched.length,
    routine: matched.map(r => ({
      semester: r.semester,
      subject: r.subject,
      date: r.date,
      day: r.day,
      time: r.time,
      type: r.type
    })),
    note: 'BIT Pre-board examination schedule for Gandaki University.'
  };
}

// --- 7. Gemini Native Tools Declaration Schema ---
const GEMINI_FUNCTION_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'searchFiles',
        description: 'Search uploaded student class notes, assignments, PDFs, and study materials in the Semester Library SQLite database.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Subject name, chapter name, or topic keywords to search for' },
            semester: { type: 'STRING', description: 'Semester numeral e.g. I, II, III, IV, etc. if specified' }
          }
        }
      },
      {
        name: 'getSyllabus',
        description: 'Look up curriculum course titles, codes, credits, and syllabus topics from Gandaki University BIT curriculum.',
        parameters: {
          type: 'OBJECT',
          properties: {
            semester: { type: 'STRING', description: 'Semester numeral e.g. I, II, III, IV, V, VI, VII, VIII' },
            subject: { type: 'STRING', description: 'Course title or code e.g. CIT214, Discrete Mathematics, Networking' }
          }
        }
      },
      {
        name: 'getRoutine',
        description: 'Look up official pre-board examination dates, days, times, and subjects for Gandaki University BIT.',
        parameters: {
          type: 'OBJECT',
          properties: {
            semester: { type: 'STRING', description: 'Semester numeral e.g. II, IV, VI, VIII' },
            subject: { type: 'STRING', description: 'Subject or course name' }
          }
        }
      },
      {
        name: 'getSiteMap',
        description: 'Get the full site structure and page list for the Semester Library website. Use this when a student asks about what pages exist, where to find something, how to navigate the site, or how to upload/download files.',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      }
    ]
  }
];

// --- 8. Self-Check Verification Pass for Factual Claims ---
function verifyFactualClaims(responseText, collectedData) {
  if (!responseText) return '';

  const validFiles = new Set(collectedData.matchedFiles.map(f => (f.originalName || '').toLowerCase()));
  collectedData.matchedFiles.forEach(f => {
    if (f.title) validFiles.add(f.title.toLowerCase());
  });

  const validDates = new Set(collectedData.matchedRoutine.map(r => r.date));
  
  // Guard against invented file attachments if 0 real files were retrieved
  let verified = responseText;
  if (collectedData.matchedFiles.length === 0) {
    const fakeFileRegex = /\b([a-zA-Z0-9_\-\s()]+\.(?:pdf|docx|pptx|xlsx|zip))\b/gi;
    verified = verified.replace(fakeFileRegex, (match) => {
      const clean = match.trim().toLowerCase();
      const isKnown = Array.from(validFiles).some(vf => vf.includes(clean) || clean.includes(vf));
      return isKnown ? match : `[File: ${match} (not currently uploaded)]`;
    });
  }

  // Guard against fabricated exam dates
  if (collectedData.matchedRoutine.length > 0) {
    const dateRegex = /\b(208[0-9]\/[0-1][0-9]\/[0-3][0-9])\b/g;
    verified = verified.replace(dateRegex, (match) => {
      if (!validDates.has(match)) {
        const realDate = Array.from(validDates)[0];
        return realDate || match;
      }
      return match;
    });
  }

  return verified;
}

// --- 9. Pre-AI Scope Classifier (Quota Saver) ---
function evaluateScope(query) {
  const q = query.toLowerCase().trim();

  // Handle small talk directly without consuming API quota
  const isSmallTalk = /^(hi|hello|hey|how are you|how's it going|what's up|sup|good morning|good evening|thanks|thank you|bye|goodbye|see you)\b/i.test(q);
  if (isSmallTalk) {
    return {
      inScope: true,
      isSmallTalk: true,
      cannedReply: `Hey! 👋 I'm the **Semester Library Assistant**. I can help you find:\n\n- 📚 **Uploaded notes & files** in the Library\n- 📖 **Course syllabus** for any semester\n- 📅 **Exam schedule** and routine\n- 🧭 **Navigate** to any page on the site\n\nWhat would you like to know?`,
      actions: [
        { label: '📚 Browse Library', url: 'library.html' },
        { label: '📖 View Syllabus', url: 'syllabus.html' },
        { label: '📅 Exam Routine', url: 'routine.html' }
      ]
    };
  }

  const isExplicitGeneralTutoring = (
    /^what is (?!the (exam|routine|syllabus|library|upload|semester|file|schedule))\w+/i.test(q) ||
    /^(teach me|explain to me|how to code|write (a|me) (code|script|program|essay|story|poem)|who is|solve|calculate)/i.test(q) ||
    (q.includes('what is java') && !q.includes('note') && !q.includes('syllabus') && !q.includes('exam') && !q.includes('file')) ||
    (q.includes('teach me python') || q.includes('what is python') || q.includes('what is c++')) ||
    (q.includes('explain photosynthesis') || q.includes('who is prime minister') || q.includes('capital of'))
  );

  const isSiteNavigation = (
    q.includes('upload') || q.includes('where is') || q.includes('how to find') || q.includes('where do') || q.includes('where can') ||
    q.includes('download') || q.includes('profile') || q.includes('feed') ||
    q.includes('dashboard') || q.includes('login') || q.includes('library') ||
    q.includes('routine') || q.includes('syllabus') || q.includes('notes') ||
    q.includes('file') || q.includes('chat') || q.includes('semester') ||
    q.includes('exam') || q.includes('schedule') || q.includes('exercise') || q.includes('practice') ||
    q.includes('page') || q.includes('section') || q.includes('navigate') || q.includes('find')
  );

  if (isExplicitGeneralTutoring && !isSiteNavigation) {
    return {
      inScope: false,
      cannedReply: `I am the **Semester Library Assistant**, designed exclusively to help you find and navigate resources on this website (such as uploaded notes, syllabus contents, course roadmaps, and exam routines).\n\nI do not act as a general academic tutor or teach subjects from scratch.\n\nIs there a specific **subject note, syllabus chapter, or exam routine** on the site you would like me to help you find?`,
      actions: [
        { label: 'Browse Library Notes', url: 'library.html' },
        { label: 'View Degree Syllabus', url: 'syllabus.html' },
        { label: 'Check Exam Routine', url: 'routine.html' }
      ]
    };
  }

  return { inScope: true };
}

// --- 10. Gemini Function Calling Engine with Multi-Turn Context ---
async function callGeminiWithTools(db, userMessage, conversationHistory = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Format multi-turn conversation history (last 8 messages)
  const contents = [];
  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-8).forEach(msg => {
      const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
      if (msg.content && typeof msg.content === 'string') {
        contents.push({
          role: role,
          parts: [{ text: msg.content }]
        });
      }
    });
  }

  // Append current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const systemInstructionText = `You are the Semester Library Website Assistant for Gandaki University (Bachelor of Information Technology - BIT).

IMPORTANT SCOPE & REASONING RULES:
1. USE TOOLS: Use the searchFiles, getSyllabus, getRoutine, and getSiteMap tools whenever a student asks about notes, course topics, syllabus details, exam dates, or site navigation. You may call multiple tools in parallel if the user's question touches multiple topics.
2. SITE NAVIGATION: When a student asks "where do I find X" or "how do I upload" or anything about navigating the site, use the getSiteMap tool to provide accurate page names and descriptions.
3. EXERCISE CAPPING: When asked for practice questions, exercises, or questions on a topic (including follow-up questions like "give me exercises on this"), generate EXACTLY 3-5 focused questions unless the student specifies a different count. Do not generate excessive lists.
4. CONCISE & STRUCTURED: Keep your explanatory text short, organized with markdown headers (###), bold key terms, and short bullet points. Do not write filler preambles.
5. STRICT HONESTY: Never invent file names, course codes, or exam dates that are not in the tool results. If no files or routines exist for a semester/subject, state that clearly.
6. SEMESTER AWARENESS: The BIT program has 8 semesters across 4 years: Year 1 (Sem I, II), Year 2 (Sem III, IV), Year 3 (Sem V, VI), Year 4 (Sem VII, VIII). Pre-board exams are only scheduled for even semesters (II, IV, VI, VIII). If asked about odd semester exams, explain this clearly.`;

  // Step 1: Request with tools
  let attempts = 0;
  let initialResponseData = null;

  while (attempts < 2) {
    attempts++;
    try {
      const res1 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          tools: GEMINI_FUNCTION_TOOLS,
          systemInstruction: { parts: [{ text: systemInstructionText }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
        })
      });

      if (res1.status === 503 || res1.status === 429) {
        if (attempts < 2) {
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }
      }

      if (!res1.ok) {
        const errText = await res1.text();
        throw new Error(`Gemini Tools HTTP ${res1.status}: ${errText}`);
      }

      initialResponseData = await res1.json();
      break;
    } catch (err) {
      if (attempts >= 2) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const candidate = initialResponseData?.candidates?.[0];
  const modelParts = candidate?.content?.parts || [];

  // Check if Gemini invoked any function calls
  const functionCalls = modelParts.filter(p => p.functionCall);

  const collectedData = {
    matchedFiles: [],
    matchedCourses: [],
    matchedRoutine: []
  };

  // If no function calls, return text directly
  if (functionCalls.length === 0) {
    const rawText = modelParts.map(p => p.text || '').join('').trim();
    return {
      text: verifyFactualClaims(rawText, collectedData),
      collectedData
    };
  }

  // Step 2: Execute function calls
  contents.push({
    role: 'model',
    parts: modelParts
  });

  const toolResponseParts = [];
  for (const part of functionCalls) {
    const fnName = part.functionCall.name;
    const fnArgs = part.functionCall.args || {};

    let toolResult = {};
    if (fnName === 'searchFiles') {
      const res = await executeSearchFiles(db, fnArgs);
      toolResult = res;
      if (res.files) collectedData.matchedFiles.push(...res.files);
    } else if (fnName === 'getSyllabus') {
      const res = executeGetSyllabus(fnArgs);
      toolResult = res;
      if (res.courses) collectedData.matchedCourses.push(...res.courses);
    } else if (fnName === 'getRoutine') {
      const res = executeGetRoutine(fnArgs);
      toolResult = res;
      if (res.routine) collectedData.matchedRoutine.push(...res.routine);
    } else if (fnName === 'getSiteMap') {
      toolResult = executeGetSiteMap();
      collectedData.siteMapUsed = true;
    }

    toolResponseParts.push({
      functionResponse: {
        name: fnName,
        response: toolResult
      }
    });
  }

  contents.push({
    role: 'user',
    parts: toolResponseParts
  });

  // Step 3: Send function responses back to Gemini for final grounded generation
  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      tools: GEMINI_FUNCTION_TOOLS,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
    })
  });

  if (!res2.ok) {
    const errText = await res2.text();
    throw new Error(`Gemini Tool Response HTTP ${res2.status}: ${errText}`);
  }

  const finalData = await res2.json();
  const finalText = finalData.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';

  // Deduplicate collected entities
  const uniqueFiles = [];
  const seenFIds = new Set();
  collectedData.matchedFiles.forEach(f => {
    if (!seenFIds.has(f.id)) {
      seenFIds.add(f.id);
      uniqueFiles.push(f);
    }
  });

  const uniqueCourses = [];
  const seenCCodes = new Set();
  collectedData.matchedCourses.forEach(c => {
    if (!seenCCodes.has(c.code)) {
      seenCCodes.add(c.code);
      uniqueCourses.push(c);
    }
  });

  const uniqueRoutine = [];
  const seenRKeys = new Set();
  collectedData.matchedRoutine.forEach(r => {
    const k = `${r.semester}_${r.subject}_${r.date}`;
    if (!seenRKeys.has(k)) {
      seenRKeys.add(k);
      uniqueRoutine.push(r);
    }
  });

  const finalCollected = {
    matchedFiles: uniqueFiles,
    matchedCourses: uniqueCourses,
    matchedRoutine: uniqueRoutine
  };

  return {
    text: verifyFactualClaims(finalText, finalCollected),
    collectedData: finalCollected
  };
}

// --- 11. Fallback Path (OpenRouter with Pre-Grounding) ---
async function callOpenRouterFallback(db, userMessage, conversationHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  // Ground with keyword search + semester-aware search
  const parsedSem = parseSemesterNumber(userMessage);
  const filesRes = await executeSearchFiles(db, { query: userMessage, semester: parsedSem || '' });
  const syllabusRes = executeGetSyllabus(parsedSem ? { semester: parsedSem } : { subject: userMessage });
  const routineRes = executeGetRoutine(parsedSem ? { semester: parsedSem } : { subject: userMessage });

  const collectedData = {
    matchedFiles: filesRes.files || [],
    matchedCourses: syllabusRes.courses || [],
    matchedRoutine: routineRes.routine || []
  };

  const systemPrompt = `You are the Semester Library Assistant for Gandaki University BIT.
RULES:
1. When asked for practice questions or exercises (including "give me exercises on this"), generate EXACTLY 3-5 focused questions.
2. Short & organized: Use headers (###), bold key terms, and short bullet points.
3. Only reference facts provided in the Grounding Context below.
4. The BIT program has 8 semesters across 4 years: Year 1 (Sem I, II), Year 2 (Sem III, IV), Year 3 (Sem V, VI), Year 4 (Sem VII, VIII). Pre-board exams are only scheduled for even semesters (II, IV, VI, VIII).

GROUNDING CONTEXT:
=== FILES IN LIBRARY ===
${collectedData.matchedFiles.length > 0 ? collectedData.matchedFiles.map(f => `- [File #${f.id}] "${f.title}" (${f.originalName}) | Subject: ${f.subject}`).join('\n') : 'No matching files found.'}

=== SYLLABUS COURSES ===
${collectedData.matchedCourses.length > 0 ? collectedData.matchedCourses.map(c => `- ${c.title} (${c.code}) [Sem ${c.semester}, ${c.credit} Credits]: ${c.objectives}`).join('\n') : 'No matching syllabus courses found.'}

=== EXAM ROUTINE ===
${collectedData.matchedRoutine.length > 0 ? collectedData.matchedRoutine.map(r => `- Semester ${r.semester}: ${r.subject} on ${r.date} at ${r.time}`).join('\n') : 'No specific routine match.'}

=== WEBSITE PAGES ===
${SITE_MAP.pages.map(p => `- ${p.name}: ${p.url} — ${p.description}`).join('\n')}
`;

  const messages = [{ role: 'system', content: systemPrompt }];
  if (Array.isArray(conversationHistory)) {
    conversationHistory.slice(-8).forEach(msg => {
      messages.push({
        role: msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user',
        content: msg.content
      });
    });
  }
  messages.push({ role: 'user', content: userMessage });

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Semester Library Assistant'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: messages,
      temperature: 0.2,
      max_tokens: 1200
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  return {
    text: verifyFactualClaims(rawText, collectedData),
    collectedData
  };
}

// --- 12. Main Assistant Dispatcher ---
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

  // 1. Fast Pre-AI Scope Evaluation (Quota Saver)
  const scopeResult = evaluateScope(query);
  if (!scopeResult.inScope) {
    return {
      reply: scopeResult.cannedReply,
      actions: scopeResult.actions || [],
      matchedFiles: [],
      matchedCourses: [],
      matchedRoutine: []
    };
  }

  // 1b. Small talk shortcut — skip API call entirely
  if (scopeResult.isSmallTalk) {
    return {
      reply: scopeResult.cannedReply,
      actions: scopeResult.actions || [],
      matchedFiles: [],
      matchedCourses: [],
      matchedRoutine: []
    };
  }

  // 2. Dispatch to Native Gemini Function Calling with OpenRouter Fallback
  let result;
  try {
    result = await callGeminiWithTools(db, query, conversationHistory);
  } catch (geminiErr) {
    console.warn('[AI Service] Gemini function calling failed:', geminiErr.message);
    console.log('[AI Service] Executing grounded OpenRouter fallback...');
    try {
      result = await callOpenRouterFallback(db, query, conversationHistory);
    } catch (fallbackErr) {
      console.error('[AI Service] Both AI providers failed:', fallbackErr.message);
      throw new Error('Both AI providers encountered a temporary issue. Please try asking again.');
    }
  }

  const { text, collectedData } = result;

  // 3. Build Deep-Link Navigation Actions from Matched Data
  const actions = buildNavigationActions(collectedData);

  return {
    reply: text,
    actions: actions,
    matchedFiles: collectedData.matchedFiles || [],
    matchedCourses: collectedData.matchedCourses || [],
    matchedRoutine: collectedData.matchedRoutine || []
  };
}

// --- 13. Build Deep-Link Navigation Actions from Matched Data ---
function buildNavigationActions(collectedData) {
  const actions = [];
  const seenUrls = new Set();

  function addAction(label, url) {
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      actions.push({ label, url });
    }
  }

  // --- Syllabus deep links ---
  if (collectedData.matchedCourses && collectedData.matchedCourses.length > 0) {
    // Collect distinct semesters
    const semestersSet = new Map();
    collectedData.matchedCourses.forEach(c => {
      const sem = c.semester;
      const year = c.year || SEMESTER_TO_YEAR[sem] || 'Year 1';
      const key = `${year}/${sem}`;
      if (!semestersSet.has(key)) semestersSet.set(key, { year, sem, count: 0 });
      semestersSet.get(key).count++;
    });

    if (semestersSet.size === 1) {
      // Single semester: deep-link directly to that semester's course list
      const entry = Array.from(semestersSet.values())[0];
      const hashPath = `${encodeURIComponent(entry.year)}/${encodeURIComponent(entry.sem)}`;
      addAction(`View Semester ${entry.sem} Syllabus`, `syllabus.html#${hashPath}`);
    } else if (semestersSet.size <= 3) {
      // Multiple semesters: link to each
      for (const [key, entry] of semestersSet) {
        const hashPath = `${encodeURIComponent(entry.year)}/${encodeURIComponent(entry.sem)}`;
        addAction(`Semester ${entry.sem} Syllabus`, `syllabus.html#${hashPath}`);
      }
    } else {
      // Too many — just link to syllabus root
      addAction('View Full Syllabus', 'syllabus.html');
    }

    // If only 1 specific course matched, also link to its detail page
    if (collectedData.matchedCourses.length === 1) {
      const c = collectedData.matchedCourses[0];
      const year = c.year || SEMESTER_TO_YEAR[c.semester] || 'Year 1';
      const hashPath = `${encodeURIComponent(year)}/${encodeURIComponent(c.semester)}/${encodeURIComponent(c.title)}`;
      addAction(`View ${c.title}`, `syllabus.html#${hashPath}`);
    }
  }

  // --- Library deep links ---
  if (collectedData.matchedFiles && collectedData.matchedFiles.length > 0) {
    // If files share a single subject, deep-link to that subject in library
    const subjects = new Set(collectedData.matchedFiles.map(f => f.subject).filter(Boolean));
    if (subjects.size === 1) {
      const subj = Array.from(subjects)[0];
      addAction(`View "${subj}" in Library`, `library.html#${encodeURIComponent(subj)}`);
    } else {
      addAction(`View Files in Library (${collectedData.matchedFiles.length})`, 'library.html');
    }

    // If only 1 file matched, also offer direct download
    if (collectedData.matchedFiles.length === 1) {
      const f = collectedData.matchedFiles[0];
      addAction(`Download "${f.title || f.originalName}"`, `/api/files/${f.id}/download`);
    }
  }

  // --- Routine deep links ---
  if (collectedData.matchedRoutine && collectedData.matchedRoutine.length > 0) {
    const routineSemesters = new Set(collectedData.matchedRoutine.map(r => r.semester));
    if (routineSemesters.size === 1) {
      const sem = Array.from(routineSemesters)[0];
      addAction(`View Semester ${sem} Exam Routine`, `routine.html?semester=${encodeURIComponent(sem)}`);
    } else {
      addAction('View Full Exam Routine', 'routine.html');
    }
  }

  return actions.slice(0, 5);
}

module.exports = {
  handleChat,
  executeSearchFiles,
  executeGetSyllabus,
  executeGetRoutine,
  executeGetSiteMap,
  buildNavigationActions,
  verifyFactualClaims,
  loadEnvSafely
};
