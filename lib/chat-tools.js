'use strict';

const syllabus = require('../public/syllabus-data.json');
const topics = require('./chat-topics');
const notes = require('./note-search');
const { aiSearch } = { aiSearch: require('./ai-search-tools') };
const { parseNepaliDateExpression, normalizeDevanagariDigits, matchesDateFilter } = require('./nepali-dates');
const { academicSearchTerms } = require('./knowledge-relevance');

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const courses = syllabus.semesters.flatMap(s => s.courses.map(c => ({ ...c, semester: s.semester, year: s.year })));
const SUBJECT_ALIASES = {
  'Computer Programming,I (C)': ['c programming', 'c language', 'computer programming i (c)', 'computer programming 1'],
  'Computer Programming II (Java)': ['java', 'oop', 'object oriented programming', 'java programming', 'computer programming 2'],
  'Database Management System': ['dbms', 'database management', 'database management systems', 'database'],
  'Data Structure and Algorithms': ['dsa', 'data structures', 'data structure', 'data structures and algorithms'],
  'Operating Systems': ['os', 'operating system'],
  'Data Communication and Computer Networks': ['dccn', 'cn', 'computer networks', 'networking'],
  'Mathematics I': ['math 1', 'math i', 'mathematics 1', 'maths 1'],
  'Mathematics II': ['math 2', 'math ii', 'mathematics 2', 'maths 2'],
  'Discrete Mathematics': ['discrete math', 'discrete maths'],
  'Web Technology I': ['web 1', 'web tech 1', 'web technology 1', 'web tech', 'web technology'],
  'Web Technology II': ['web 2', 'web tech 2', 'web technology 2'],
  'Microprocessor and Computer Architecture': ['microprocessor', 'computer architecture', 'coa'],
  'Digital Logic': ['dl', 'digital logic'],
  'Object Oriented Analysis and Design using UML': ['ooad', 'uml'],
  'Fundamentals of Probability and Statistics': ['statistics', 'probability and statistics', 'stats'],
  'Computer Graphics Technology': ['computer graphics', 'cg'],
  'Artificial Intelligence': ['ai', 'artificial intelligence'],
  'Software Engineering': ['software engineering', 'se'],
  'Principles of Organization and Management': ['pom', 'principles of management'],
  'Management Information System': ['mis', 'management information system'],
  'Mobile Application Development': ['mobile development', 'mad', 'mobile app development'],
  'Cloud Computing': ['cloud computing and virtualization', 'cloud computing'],
  'Data Mining and Warehousing': ['data mining', 'data warehousing', 'dmw'],
  'Digital Forensic Security Technologies': ['digital forensics', 'cyber security', 'cybersecurity'],
  'Software Development and Operations (DevOps)': ['devops'],
  'Human Computer Interface and UI Design': ['hci', 'human computer interaction', 'ui design'],
  'Basic Electronics': ['basic electronics', 'electronics'],
  'Basics of IT': ['basics of it', 'information technology'],
  'Workshop: Problem Solving and Logic': ['problem solving and logic', 'flowchart and pseudocode'],
  'Business Communication Technique': ['business communication', 'technical writing']
};

const DEVANAGARI_SUBJECT_PATTERNS = [
  { subject: 'Operating Systems', pattern: /ऑपररेटिङ\s*सिस्टम|अपरेटिङ\s*सिस्टम|ऑपरेटिङ\s*सिस्टम|ओएस/i },
  { subject: 'Database Management System', pattern: /डाटाबेस\s*(?:म्यानेजमेन्ट\s*सिस्टम)?|डिबिएमएस|डीबीएमएस/i },
  { subject: 'Data Communication and Computer Networks', pattern: /कम्प्युटर\s*नेटवर्क|नेटवर्किङ|डाटा\s*कम्युनिकेसन/i },
  { subject: 'Data Structure and Algorithms', pattern: /डाटा\s*स्ट्रक्चर|एल्गोरिदम\s*र\s*डाटा\s*स्ट्रक्चर|डिएसए/i },
  { subject: 'Computer Programming II (Java)', pattern: /जाभा\s*(?:प्रोग्रामिङ)?|अब्जेक्ट\s*ओरिएन्टेड\s*प्रोग्रामिङ/i },
  { subject: 'Computer Programming,I (C)', pattern: /सी\s*प्रोग्रामिङ|सी\s*ल्याङ्ग्वेज/i },
  { subject: 'Digital Logic', pattern: /डिजिटल\s*लजिक/i },
  { subject: 'Microprocessor and Computer Architecture', pattern: /माइक्रोप्रोसेसर|कम्प्युटर\s*आर्किटेक्चर/i },
  { subject: 'Artificial Intelligence', pattern: /आर्टिफिसियल\s*इन्टेलिजेन्स|कृत्रिम\s*बौद्धिकता/i },
  { subject: 'Software Engineering', pattern: /सफ्टवेयर\s*इन्जिनियरिङ/i },
  { subject: 'Web Technology I', pattern: /वेब\s*टेक्नोलोजी/i },
  { subject: 'Discrete Mathematics', pattern: /डिस्क्रिट\s*म्याथम्याटिक्स|डिस्क्रिट\s*म्याथ/i }
];

const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const phraseIn = (text, phrase) => (` ${normalize(text)} `).includes(` ${normalize(phrase)} `);

function semesterNumber(value) {
  const s = normalizeDevanagariDigits(String(value ?? '')).trim().toLowerCase();
  if (/^[1-8]$/.test(s)) return Number(s);
  const roman = ROMANS.indexOf(s.toUpperCase());
  if (roman >= 0) return roman + 1;
  const word = WORDS.indexOf(s);
  if (word >= 0) return word + 1;
  for (let n = 1; n <= 8; n++) {
    const ordinal = `${n}(?:st|nd|rd|th)?`;
    if (new RegExp(`\\b(?:sem(?:ester)?\\s*[-:]?\\s*(?:${ordinal}|${ROMANS[n - 1]}|${WORDS[n - 1]})|(?:${ordinal}|${WORDS[n - 1]}|${ROMANS[n - 1]})\\s*[-:]?\\s*sem(?:ester)?)\\b`, 'i').test(s)) return n;
  }
  const devMatch = String(value ?? '').match(/(?:सेमेस्टर|सेम)\s*([1-8१-८])|([1-8१-८])\s*(?:सेमेस्टर|सेम)/);
  if (devMatch) {
    const d = Number(normalizeDevanagariDigits(devMatch[1] || devMatch[2]));
    if (d >= 1 && d <= 8) return d;
  }
  return null;
}

function semesterAliases(n) {
  return [String(n), ROMANS[n - 1], `Semester ${n}`, `Semester ${ROMANS[n - 1]}`, `sem ${n}`, `${WORDS[n - 1]} semester`, `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} semester`].map(s => s.toLowerCase());
}

function subjectAliases(subject) {
  const base = [...new Set([subject, ...(SUBJECT_ALIASES[subject] || [])])];
  const matchedCourse = courses.find(
    c => normalize(c.title) === normalize(subject) || normalize(c.code) === normalize(subject)
  );
  if (matchedCourse) {
    if (matchedCourse.title && !base.includes(matchedCourse.title)) base.push(matchedCourse.title);
    if (matchedCourse.code && !base.includes(matchedCourse.code)) base.push(matchedCourse.code);
    for (const a of SUBJECT_ALIASES[matchedCourse.title] || []) {
      if (!base.includes(a)) base.push(a);
    }
  }
  return base;
}

function explicitSubjects(message) {
  const raw = String(message || '');
  const aliasMatches = courses.flatMap(c =>
    [...subjectAliases(c.title), c.code]
      .filter(Boolean)
      .filter(a => phraseIn(raw, a))
      .map(a => ({ subject: c.title, alias: a }))
  );
  // Prefer the longest phrase (Mathematics II must not also match Mathematics I).
  aliasMatches.sort((a, b) => normalize(b.alias).length - normalize(a.alias).length);
  const matched = [...new Set(aliasMatches.filter((m, i) => !aliasMatches.slice(0, i).some(x => phraseIn(x.alias, m.alias))).map(m => m.subject))];
  for (const { subject, pattern } of DEVANAGARI_SUBJECT_PATTERNS) {
    if (pattern.test(raw) && !matched.includes(subject)) {
      matched.push(subject);
    }
  }
  return matched;
}

function resolveSubject(value) {
  const found = courses.find(c => [...subjectAliases(c.title), c.code].filter(Boolean).some(a => normalize(a) === normalize(value)))?.title || null;
  if (found) return found;
  for (const { subject, pattern } of DEVANAGARI_SUBJECT_PATTERNS) {
    if (pattern.test(String(value || ''))) return subject;
  }
  return null;
}

function predictSubjects(query) {
  const matches = topics.filter(t => t.synonyms.some(s => phraseIn(query, s)));
  return [...new Set(matches.map(t => resolveSubject(t.canonicalSubject) || t.canonicalSubject))];
}

/**
 * Extracts explicit chapter or unit filters from a user query
 * (e.g. "DBMS chapter 2 notes deu", "OS ko chapter 3 ma deadlock kata xa?", "Unit 4 of Computer Networks", "अध्याय २").
 */
function extractChapterFilter(message) {
  const s = normalizeDevanagariDigits(String(message || '')).trim();
  if (!s) return { chapter: null, unitNumber: null };

  // 1. Numeric / Roman / Ordinal chapter or unit: "chapter 2", "chap 3", "unit 4", "unit IV", "2nd chapter", "अध्याय २", "युनिट ४"
  const numMatch = s.match(/\b(?:(chapter|chap|ch|unit)\s*[-:#.]?\s*([1-9]\d?|viii|vii|vi|iv|iii|ii|i|v|first|second|third|fourth|fifth|sixth|seventh|eighth)|([1-9]\d?)(?:st|nd|rd|th)?\s+(chapter|unit))\b/i)
    || s.match(/(?:अध्याय|च्याप्टर|युनिट|एकाइ)\s*[-:#.]?\s*([1-9]\d?)|([1-9]\d?)\s*(?:अध्याय|च्याप्टर|युनिट|एकाइ)/);

  if (numMatch) {
    const rawNum = (numMatch[2] || numMatch[3] || numMatch[1] || '').toLowerCase();
    let num = null;
    if (/^\d+$/.test(rawNum)) num = Number(rawNum);
    else {
      const rIdx = ROMANS.indexOf(rawNum.toUpperCase());
      if (rIdx >= 0) num = rIdx + 1;
      else {
        const wIdx = WORDS.indexOf(rawNum);
        if (wIdx >= 0) num = wIdx + 1;
      }
    }
    if (num && num >= 1 && num <= 20) {
      const isUnit = /\bunit\b|युनिट|एकाइ/i.test(numMatch[0]);
      return {
        chapter: isUnit ? `Unit ${num}` : `Chapter ${num}`,
        unitNumber: num
      };
    }
  }

  // 2. Named chapter filter: e.g. "chapter on modeling", "chapter modeling", "unit: data model"
  const namedMatch = s.match(/\b(?:chapter|unit)\s*(?:on|about|named|called|:|-)\s*([a-z0-9\s]{3,35}?)(?=\s+(?:notes?|files?|pdfs?|materials?|deu|dekhauna|dekhau|pathau|ma|ko|of|for|in)\b|[?.!]|$)/i);
  if (namedMatch && namedMatch[1]) {
    const cleanName = namedMatch[1].trim();
    if (cleanName && !/^(?:summary|notes?|files?|all|available|k\s+xa|kun\s+kun)$/i.test(cleanName)) {
      return { chapter: cleanName, unitNumber: null };
    }
  }

  return { chapter: null, unitNumber: null };
}

function isAllSemestersRequest(message) {
  const s = String(message || '').trim();
  if (!s) return false;
  return /\b(?:all\s+(?:available\s+|published\s+|bit\s+|8\s+|eight\s+)?(?:[a-z0-9_-]+\s+){0,3}(?:semesters?|notes?|syllab(?:us|i)|courses?|subjects?|notices?|posts?|assignments?)|(?:notes?|syllab(?:us|i)|courses?|subjects?|notices?|posts?|assignments?)\s+(?:from|for|across|in|of)\s+all\s+(?:8\s+|eight\s+)?semesters?|every\s+semester|across\s+(?:all\s+)?semesters?|sabai\s+semester)\b|सबै\s*सेमेस्टर/i.test(s);
}

function isOtherSemesterRequest(message) {
  const s = String(message || '').trim();
  if (!s) return false;
  return /\b(?:another|other|different|arko|aru)\s+semesters?\b|अर्को\s*सेमेस्टर/i.test(s);
}

function extractFilters(message) {
  const subjects = explicitSubjects(message);
  const { chapter, unitNumber } = extractChapterFilter(message);
  const allSemesters = isAllSemestersRequest(message);
  const otherSemester = isOtherSemesterRequest(message);
  return {
    semester: semesterNumber(message),
    subject: subjects.length === 1 ? subjects[0] : null,
    subjects,
    ...(allSemesters ? { allSemesters: true } : {}),
    ...(otherSemester ? { otherSemester: true } : {}),
    ...(chapter ? { chapter } : {}),
    ...(unitNumber ? { unitNumber } : {})
  };
}

function searchQuery(message, filters = extractFilters(message)) {
  let query = normalize(normalizeDevanagariDigits(message));
  if (filters.subject) {
    for (const alias of subjectAliases(filters.subject).sort((a, b) => b.length - a.length)) {
      query = (` ${query} `).replace(` ${normalize(alias)} `, ' ').trim();
    }
  }
  query = query
    .replace(/\b(?:semester|sem)\s*(?:[1-8](?:st|nd|rd|th)?|viii|vii|vi|iv|iii|ii|i|v|first|second|third|fourth|fifth|sixth|seventh|eighth)\b/g, ' ')
    .replace(/\b(?:[1-8](?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth)\s*(?:semester|sem)\b/g, ' ')
    .replace(/\b(?:(?:chapter|chap|ch|unit)\s*(?:[1-9]\d?|viii|vii|vi|iv|iii|ii|i|v|first|second|third|fourth|fifth|sixth|seventh|eighth)|[1-9]\d?(?:st|nd|rd|th)?\s+(?:chapter|unit))\b/gi, ' ')
    .replace(/\b(?:can|could|would|you|please|give|show|find|search|look|up|send|me|us|the|a|an|my|our|some|any|all|have|got|do|does|did|has|had|we|is|there|are|was|were|available|uploaded|want|need|notes?|files?|pdfs?|documents?|materials?|lecture|slides?|upload|uploads|uploading|study|on|about|for|from|in|of|to|with|by|this|that|it|its|also|too|more|other|another|else|what|where|when|which|who|why|how|explain|explained|define|definition|chapters?|units?|contains?|covers?|includes?|belongs?|assignments?|homeworks?|tasks?|notices?|announcements?|posts?|discussions?|routines?|schedules?|timetables?|syllab(?:us|i)|attendance|eligible|eligibility|results?|marks?|grades?|scores?)\b/g, ' ')
    .replace(/\b(?:khojdeu|khojideu|khoja|khoj|chaiyo|chahiyo|deu|deuna|dekhauna|dekhaideu|dekhau|pathaideu|pathau|heram|haleko|upload\s+gareko|upload\s+vako|upload\s+bhako|aako\s+xa|aeko\s+xa|kata\s+xa|kata\s+cha|kata|kaha|kun|kati|kaile|kahile|bata|dekhi|pachi|paxi|paxadi|agadi|aile|ahile|samma|barema|bare|vayo|bhayo|vako|bhako|gareko|garne|garyo|nagareko|nabujhako|baki|sir\s+le|cr\s+le|hamro|timro|mero|malai|mlai|maile|ko|ka|ki|ma|le|lai|ra|ani|pani|ta|ni|hai|haru|matra|sabei|sabai|bujhaune|bujhaideu|bujhauna|kunai|na|ho|hun|xa|cha|chha|xan|chan|xaina|chaina|hunxa|huncha|hunchha|hunxan|kasari|aaja|bholi|voli|hijo|asti|parsi|yo|tyo|yesko|yasko|tyesko|tesko|arko|aru|aaru|summary|hajir|hazir|plz|pls)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  // If the original message contained Devanagari and ASCII normalization left query empty, extract mapped academic terms
  if (!query && /[\u0900-\u097F]/.test(String(message || ''))) {
    const subjectTerms = filters.subject ? subjectAliases(filters.subject) : [];
    const mappedTerms = academicSearchTerms(message, { stripTerms: [...subjectTerms, 'note', 'notes', 'chapter', 'unit', 'summary'] });
    query = mappedTerms.join(' ').trim();
  }
  return query;
}

// Explicit non-BIT coding, off-topic smuggling tasks, & non-BIT academic topics that must never pass as BIT syllabus
const NON_BIT_ACADEMIC_OR_CODE = /\b(solidity|smart\s+contracts?|ethereum|web3|blockchain\s+token|erc20|nft|rust\s+borrow|borrow\s+checker|cargo\s+toml|tokio|swiftui|uikit|objective[- ]c|kotlin\s+multiplatform|unreal\s+engine|unity\s+shader|hlsl|glsl|godot|roblox|luau|cobol|fortran|abap|haskell\s+monad|elixir|erlang|prolog|verilog|vhdl|photosynthesis|mitochondria|chloroplast|krebs\s+cycle|dna\s+replication|meiosis|mitosis|organic\s+chemistry|stoichiometry|periodic\s+table|plate\s+tectonics|thermodynamics\s+entropy|black\s+hole|relativity|quantum\s+chromodynamics|macroeconomics\s+gdp|constitutional\s+law|criminal\s+law|pharmacology|anatomy|betting\s+app|betting|gambling|casino|1xbet|crypto(?:currency)?|bitcoin|trading\s+bot|forex|scrape\s+(?:instagram|facebook|tiktok|twitter|linkedin)|(?:instagram|facebook|tiktok|twitter)\s+scrap(?:e|er|ing)|hack\s+(?:wifi|instagram|facebook|account|password)|keylogger|ransomware|phishing\s+page)\b|प्रकाश\s*संश्लेषण|माइटोकोन्ड्रिया|सट्टाबाजी|जुवा|क्रिप्टो|ट्रेडिङ\s*बोट|बिटक्वाइन|इन्स्टाग्राम\s*स्क्र्याप/i;

// Core BIT syllabus concepts across Semesters 1–8 (public/syllabus-data.json + lib/chat-topics.js)
const BIT_SYLLABUS_CONCEPTS = /\b(variable|operator|data\s*type|oop|object[- ]oriented|dbms|normalization|1nf|2nf|3nf|bcnf|functional\s+dependenc(?:y|ies)|er\s+diagram|entity\s+relationship|relational\s+algebra|transaction|acid\s+properties|concurrency\s+control|sql|join|subquer(?:y|ies)|primary\s+key|foreign\s+key|inheritance|polymorphism|encapsulation|abstraction|overloading|overriding|interface|abstract\s+class|jvm|bytecode|jdk|jre|exception\s+handling|multithreading|java\s+stream|serialization|awt|swing|servlet|jsp|network|networking|tcp|udp|ip\s+address(?:ing)?|ipv4|ipv6|subnet(?:ting)?|osi\s+model|http|https|dns|dhcp|smtp|ftp|routing|switching|vlan|firewall|cryptography|encryption|rsa|aes|algorithm|recursion|recursive|pointer|struct|union|malloc|calloc|dynamic\s+memory|file\s+handling|preprocessor|macro|flowchart|pseudocode|class|object|database|java|javascript|python|html|xhtml|css|php|mysql|ajax|json|xml|dom|react|node|c\+\+|c\s+program(?:ming)?|c\s+language|c\s+code|in\s+c|computer|programming|math|calculus|derivative|differentiation|integration|integral|limit|continuity|rolle|mean\s+value\s+theorem|taylor\s+series|maclaurin|matrix|matrices|determinant|cramer|gaussian\s+elimination|eigenvalue|vector\s+space|permutation|combination|infinite\s+series|partial\s+derivative|euler|differential\s+equation|complex\s+number|complex\s+variable|de\s+moivre|cauchy[- ]riemann|cache|stack|queue|linked\s+list|doubly\s+linked|circular\s+queue|tree|binary\s+tree|bst|avl\s+tree|b[- ]tree|heap|graph|bfs|dfs|dijkstra|kruskal|prim|spanning\s+tree|topological\s+sort|array|string|sort(?:ing)?|quicksort|mergesort|bubblesort|heapsort|insertion\s+sort|selection\s+sort|binary\s+search|linear\s+search|hashing|hash\s+table|dynamic\s+programming|greedy|time\s+complexity|big[- ]o|asymptotic|function|loop|for\s+loop|while\s+loop|do\s+while|switch\s+case|boolean\s+algebra|k[- ]?map|karnaugh|de\s*morgan|logic\s+gate|nand|nor|xor|xnor|half\s+adder|full\s+adder|multiplexer|demultiplexer|encoder|decoder|flip[- ]?flop|latch|counter|shift\s+register|sequential\s+circuit|combinational\s+circuit|number\s+system|binary|octal|hexadecimal|bcd|gray\s+code|ascii|complement|circuit\s+theory|kirchhoff|kcl|kvl|thevenin|norton|superposition|semiconductor|diode|zener|rectifier|transistor|bjt|npn|pnp|op[- ]?amp|operational\s+amplifier|modulation|oscilloscope|transducer|probability|statistics|mean|median|mode|variance|standard\s+deviation|normal\s+distribution|poisson|binomial|bayes|hypothesis\s+testing|chi[- ]square|correlation|regression|sampling|operating\s+system|process|thread|cpu\s+scheduling|fcfs|sjf|round\s+robin|deadlock|banker'?s\s+algorithm|semaphore|mutex|critical\s+section|paging|segmentation|virtual\s+memory|page\s+replacement|lru|fifo|thrashing|disk\s+scheduling|8085|microprocessor|instruction\s+cycle|addressing\s+mode|interrupt|dma|8086|coa|computer\s+architecture|alu|control\s+unit|pipelining|uml|use\s+case|class\s+diagram|sequence\s+diagram|activity\s+diagram|ooad|sdlc|waterfall|agile|scrum|spiral\s+model|software\s+testing|black\s+box|white\s+box|unit\s+testing|cohesion|coupling|cost\s+estimation|cocomo|computer\s+graphics|dda|bresenham|midpoint\s+circle|clipping|cohen[- ]sutherland|2d\s+transformation|3d\s+transformation|projection|rendering|artificial\s+intelligence|turing\s+test|intelligent\s+agent|a\*\s+search|minimax|alpha[- ]beta|knowledge\s+representation|predicate\s+logic|propositional\s+logic|truth\s+table|tautology|inference|mathematical\s+induction|pigeonhole|recurrence\s+relation|automata|dfa|nfa|fsm|fsa|context[- ]free\s+grammar|turing\s+machine|neural\s+network|machine\s+learning|nlp|expert\s+system|cloud\s+computing|iaas|paas|saas|virtualization|hypervisor|docker|container|kubernetes|devops|ci\/cd|git|jenkins|data\s+mining|data\s+warehous(?:e|ing)|olap|oltp|etl|star\s+schema|snowflake\s+schema|k[- ]means|apriori|decision\s+tree|clustering|classification|digital\s+forensics|cyber\s*security|malware|phishing|intrusion\s+detection|incident\s+response|mobile\s+application|android|activity\s+lifecycle|intent|flutter|hci|usability|wireframe|prototyping|heuristic\s+evaluation|mis|erp|decision\s+support\s+system|e[- ]commerce|organization\s+and\s+management|management\s+principles|maslow|herzberg|leadership|business\s+communication|memo\s+writing|cv\s+writing|report\s+writing|technical\s+writing)s?\b|रिकर्सन|पोइन्टर|डाटाबेस|सामान्यीकरण|एल्गोरिदम|अपरेटिङ\s*सिस्टम|नेटवर्किङ|जाभा|पाइथन|सी\s*प्रोग्रामिङ|बायनरी\s*ट्री|स्ट्याक|क्यु|लिङ्क्ड\s*लिस्ट|म्याट्रिक्स|डेरिभेटिभ|इन्टिग्रेसन|प्रोब्याबिलिटी|तथ्याङ्क|डिजिटल\s*लजिक|माइक्रोप्रोसेसर/i;

const COURSE_CODE_PATTERN = new RegExp(`\\b(${courses.map(c => c.code).filter(Boolean).join('|')})\\b`, 'i');

/**
 * Checks whether a message maps to a topic or course in the Gandaki University BIT syllabus
 * (public/syllabus-data.json, SUBJECT_ALIASES, or lib/chat-topics.js).
 */
function mapsToBitSyllabus(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (NON_BIT_ACADEMIC_OR_CODE.test(text)) return false;
  if (explicitSubjects(text).length > 0) return true;
  if (predictSubjects(text).length > 0) return true;
  if (COURSE_CODE_PATTERN.test(text)) return true;
  if (BIT_SYLLABUS_CONCEPTS.test(text)) return true;
  return false;
}

/**
 * Detects whether the user is explicitly asking for official Gandaki University notices/updates.
 */
function isExplicitOfficialUniversityNoticeQuery(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const hasGuMention = /\b(gandaki\s+university|official\s+(?:gandaki\s+)?university|gu\s+official|official\s+gu|university\s+official|university\s+portal)\b|गण्डकी\s*विश्वविद्यालय|विश्वविद्यालयको\s*(?:आधिकारिक\s*)?सूचना/i.test(text);
  const hasNoticeOrInfoWord = /\b(notices?|announcements?|circulars?|updates?|calendar|guidelines?|scholarships?|results?|routine|schedule|news|aako|aeko|xa|cha)\b|सूचना|जानकारी|तालिका|छात्रवृत्ति/i.test(text);
  return hasGuMention && hasNoticeOrInfoWord;
}

const codeRequest = message =>
  !NON_BIT_ACADEMIC_OR_CODE.test(message) &&
  (/\b(write|generate|create|implement|make|fix|debug|code|program|example)\b|कोड|प्रोग्राम|उदाहरण|lekh|banaideu|deu/i.test(message)) &&
  (/\b(code|program|java|javascript|js|python|php|sql|html|css|c\+\+|c\b|function|script|algorithm|loop|array|pointer|struct|class|recursion|sorting|searching)\b|कोड|प्रोग्राम|फङ्गसन|सी|जाभा/i.test(message));

const academicRequest = message =>
  !NON_BIT_ACADEMIC_OR_CODE.test(message) &&
  (
    /\b(explain|define|definition|what\s+(?:is|are)|difference\s+between|how\s+(?:does|do)|teach|calculate|solve|prove|example\s+of|why\s+(?:is|do|does)|steps?\s+of|types?\s+of|architecture|advantages?|disadvantages?|working\s+of)\b/i.test(message) ||
    /\b(vaneko\s+k\s+ho|bhaneko\s+k\s+ho|bujhaideu|bujham|bujhauna|bujhdai\s+bujhina|bujhina|kasari\s+kam\s+garcha|difference\s+k\s+ho|farak\s+k\s+ho|example\s+deu|sajilo\s+para\s+ma)\b/i.test(message) ||
    /भनेको\s*के\s*हो|बुझाइदेऊ|बुझाउ|उदाहरण|फरक\s*के\s*छ|कसरी\s*काम\s*गर्छ/.test(message)
  ) &&
  mapsToBitSyllabus(message);

// Platform content intents (posts, notices, assignments, attendance, results, academic directory, teacher classroom)
const noticeIntent = message => (
  /\b(notices?|announcements?|circulars?|official (?:notice|update|date|schedule|routine)|campus (?:notice|update|news|open|closed|off|reopen\w*|resum\w*)|college\s+(?:open|closed|off|holiday|bida|reopen\w*|resum\w*|khul\w*|suru)|class(?:es)?\s+(?:off|cancelled|canceled|closed|start\w*|resum\w*|reopen\w*|begin\w*|suru|shuru|khul\w*|lag\w*|kaile|kahile|bata|dekhi|hunxa|huncha|xa|cha|chha|ho)|when\s+(?:do|does|will|are)\s+(?:our\s+|regular\s+|the\s+)?class(?:es)?\b|class(?:es)?\s+resumption|resumption\s+of\s+(?:regular\s+)?class(?:es)?|(?:dashain|tihar|vacation)\s+(?:pachi|paxi|paxadi|after)\s+(?:class(?:es)?|college|campus)|any\s+(?:new\s+|official\s+|latest\s+)?(?:updates?|notices?|news|info(?:rmation)?)\s+(?:about|on|regarding|for)\s+(?:[a-z0-9_-]+\s+){0,4}(?:class(?:es)?|resumption|reopening|college|campus|holidays?|vacation|exams?|semesters?|bit\b)|holidays?|bida|chutti|postpon\w*|reschedul\w*)\b/i.test(message) ||
  /\b(?:notice\s+aako\s+xa|notice\s+aeko\s+xa|announcement\s+dekhauna|cr\s+le\s+haleko\s+announcement|date\s+change|exam\s+(?:change|postpone)|is\s+tomorrow\s+(?:a\s+)?(?:holiday|off|class)|(?:aaja|bholi|voli|today|tomorrow|parsi)\b[^?.!]{0,40}\b(?:bida|chutti|holiday|college\s+khul\w*|class(?:es)?|kaksha))\b/i.test(message) ||
  /सूचना|जानकारी\s*आएको\s*छ|बिदा|छुट्टी|कक्षा\s*(?:कहिले|सुरु|शुरु|सञ्चालन|खुल्ने|छ|हुन्छ)/.test(message)
) && !/\b(?:what\s+is\s+a\s+(?:notice|class)|define\s+(?:a\s+)?(?:notice|class)|explain\s+(?:what\s+)?(?:a\s+)?class\s+is|class\s+and\s+object|java\s+class|c\+\+\s+class|python\s+class)\b/i.test(message);

const postIntent = message => (
  /\b(post|posts|discussion|discussions|community|what (?:are |is )?(?:people|everyone|students?) (?:talking|discussing|saying|posting)|feed)\b/i.test(message) ||
  /\b(?:post\s+dekhauna|cr\s+ko\s+post|community\s+ma\s+k\s+xa|feed\s+heram)\b/i.test(message) ||
  /पोस्ट|कम्युनिटी/.test(message)
) && !/\b(explain|define|what is a post)\b/i.test(message);

const teacherClassroomIntent = message => (
  /\b(pending\s+(?:submissions?|grad(?:e|ing))|ungraded\s+submissions?|submissions?\s+(?:requiring|needing|waiting\s+for|pending)\s+grading|(?:how\s+many|number\s+of)\s+(?:submissions?|assignments?)\s+(?:are\s+)?(?:pending|ungraded|to\s+grade|left\s+to\s+grade|require\s+grading)|(?:how\s+many|number\s+of)\s+attendance\s+sessions?|attendance\s+sessions?\s+recorded|recorded\s+attendance\s+sessions?|draft\s+(?:and|or|&)\s+published\s+exam|exam\s+configurations?|exam\s+configs?|(?:draft|published)\s+exam\s+configurations?|which\s+exams?\s+are\s+(?:in\s+)?draft)\b/i.test(message) ||
  /\b(?:check\s+garna\s+baki\s+(?:submissions?|assignments?)|kati\s+(?:wota\s+)?attendance\s+sessions?\s+record)\b/i.test(message)
);

const assignmentSearchIntent = message => !teacherClassroomIntent(message) && (
  /\b(assignment|homework|task|submission|unsubmitted|due|deadline)s?\b/i.test(message) ||
  /\b(?:assignment\s+xa|homework\s+xa|assignment\s+bujhaune|kunai\s+assignment|did\s+i\s+submit|have\s+i\s+(?:not\s+)?submitted|haven'?t\s+submitted|not\s+submitted|submit\s+gare|submit\s+gareko\s+(?:xaina|chaina)|submit\s+nagareko|submit\s+vayo|submit\s+bhayo|baki\s+assignments?)\b/i.test(message) ||
  /\b(?:checked|grading|graded|check\s+(?:vayo|bhayo|cha|xa)|teacher\s+le\s+check|is\s+my\s+assignment\s+checked|has\s+(?:my\s+)?assignment\s+been\s+checked)\b/i.test(message) ||
  /\b(?:missed|chutyo|chhutyo|overdue|deadline\s+(?:cut|gayo|passed)|is\s+any\s+assignment\s+(?:is\s+)?missed)\b/i.test(message) ||
  /\b(?:how\s+many\s+assignments?|total\s+assignments?|kati\s+(?:wota\s+)?assignments?|assignments?\s+we\s+have|assignments?\s+do\s+we\s+have)\b/i.test(message) ||
  /असाइनमेन्ट|गृहकार्य|बुझाउने\s*मिति|बुझाउन\s*बाँकी|बुझाएको\s*छैन/.test(message)
) && !/\b(explain|define|what\s+is\s+an?\s+assignment|how\s+(?:does|do)\s+assignments?\s+work)\b/i.test(message) && !/\b(?:write|create|generate|make|solve|complete)\s+(?:the\s+)?(?:assignment|homework)\b/i.test(message);

const attendanceIntent = message => !teacherClassroomIntent(message) && (
  /\b(my\s+attendance|mero\s+attendance|hamro\s+attendance|attendance\s+(?:kati|kasto|dekhau|dekhauna|dekhaideu|deu|deuna|status|summary|report|record|percentage)|(?:show|check|get|view|give|what\s+is)\s+(?:me\s+)?(?:report\s+of\s+)?(?:my\s+)?(?:subject[-\s]?wise\s+)?attendance|attendance\s+of|attendance\s+in|attendance\s+for|how\s+much\s+attendance)\b/i.test(message) ||
  /\b(?:hajir|hazir)\s+(?:kati|kasto|dekhau|dekhaideu|deu|vayo|bhayo|record|status|report)\b/i.test(message) ||
  /\b(am\s+i\s+eligible(?:\s+for\s+exams?)?|eligible\s+for\s+exams?|exam\s+eligibility|exam\s+dina\s+(?:pauxu|paunchu|eligible)|ma\s+(?:exam\s+)?(?:dina\s+|ko\s+lagi\s+)?eligible\s*(?:xu|chu|chhu|cha|xa|ho)?|minimum\s+attendance|attendance\s+threshold)\b/i.test(message) ||
  /\b(?:how\s+many\s+classes|kati\s+(?:wota\s+)?class(?:es)?)\s+(?:did\s+i\s+miss|have\s+i\s+missed|was\s+i\s+absent|was\s+i\s+present|i\s+missed|have\s+i\s+attended|did\s+i\s+attend|i\s+attended|attended)\b/i.test(message) ||
  /\b(?:how\s+many|kati\s+(?:wota\s+)?)(?:classes?|days?|din)\s+(?:attend|attended|present|absent|miss|missed)\b/i.test(message) ||
  /\bkati\s+(?:wota\s+)?class(?:es)?(?:\s+[a-z0-9_-]+)*?\s+(?:attend|present|absent|chutyo|miss|gare|vaye)\b/i.test(message) ||
  /\b(was\s+i\s+(?:present|absent)|am\s+i\s+(?:marked\s+)?(?:present|absent)|did\s+i\s+(?:miss|attend)\s+(?:class|classes)|present\s+thiye|absent\s+thiye|present\s+vaye|absent\s+bhae|present\s+or\s+absent|present\s+or\s+not)\b/i.test(message) ||
  /\b(?:which|what|kaile|kahile)\s+(?:classes?|days?|din)\s+(?:did\s+i\s+miss|was\s+i\s+absent|miss\s+vayo|miss\s+gare|absent\s+thiye|absent\s+vaye|chutyo|chhutyo)\b/i.test(message) ||
  /\b(?:missed\s+classes|absent\s+classes|classes\s+missed|days\s+absent|absent\s+days)\b/i.test(message) ||
  (/\b(?:attendance|hajir|hazir)\b/i.test(message) && !/\b(?:how\s+(?:do\s+i|to)\s+(?:check|view|open)|kasari\s+herne)\b/i.test(message)) ||
  /मेरो\s*हाजिरी|हाजिरी\s*कति|कति\s*कक्षा\s*छुट्यो|परीक्षा\s*दिन\s*पाउँछु|उपस्थित|अनुपस्थित|हाजिर/.test(message)
) && !/\b(?:how\s+(?:do\s+i|to)\s+(?:check|view|open)|kasari\s+herne)\b/i.test(message);

const resultsIntent = message => !teacherClassroomIntent(message) && !assignmentSearchIntent(message) && (!attendanceIntent(message) || /\b(marks?|results?|scores?|grades?|gpa|cgpa)\b|नतिजा|रिजल्ट|अंक|मार्क्स/i.test(message)) && (
  /\b(my\s+(?:[a-z0-9\s-]+\s+)?(?:mid-?term|pre-?board|pre\s*bpard|final|exam|semester)?\s*(?:marks?|results?|scores?|grades?)|mero\s+(?:[a-z0-9\s-]+\s+)?(?:mid-?term|pre-?board|pre\s*bpard|final|exam)?\s*(?:marks?|results?|scores?)|hamro\s+(?:[a-z0-9\s-]+\s+)?(?:marks?|results?)|what\s+(?:are|were|was|is)\s+my\s+(?:[a-z0-9\s-]+\s+)?(?:marks?|results?|scores?|grades?)|whats\s+my\s+(?:[a-z0-9\s-]+\s+)?(?:marks?|results?|scores?)|are\s+(?:my\s+)?(?:mid-?term|pre-?board|pre\s*bpard|final|exam|semester)?\s*results?\s+(?:published|out|available)|(?:mid-?term|pre-?board|pre\s*bpard|final)\s+(?:exam\s+)?(?:marks?|results?|scores?)\s*(?:kati|published|out|aayo|aako|dekhau|dekhaideu|show|kasto|vayo|bhayo)?|(?:show|give|view|check)\s+(?:me\s+)?(?:report\s+of\s+)?my\s+(?:[a-z0-9\s-]+\s+)?(?:results?|marks?|scores?|grades?)|tell\s+me\s+my\s+(?:marks?|results?|scores?)|results?\s+for\s+semester\s*[1-8iIvV]+|marks?\s+for\s+semester\s*[1-8iIvV]+|kati\s+marks?\s+aayo|kati\s+aayo|kati\s+aako)\b/i.test(message) ||
  /\b(?:marks?|results?|scores?)\s+(?:in|for|of)\s+[a-z0-9\s-]+\b/i.test(message) ||
  /\b(?:in\s+)?(?:last|previous|agadi\s+ko)\s+sem(?:ester)?\s*(?:marks?|results?|scores?|ko\s+result|ko\s+marks?)\b/i.test(message) ||
  /\b(?:last|previous|agadi\s+ko)\s+sem(?:ester)?\s+ma\s+(?:kati|marks?|result|score)\b/i.test(message) ||
  /\b[a-z0-9\s-]+\s+ma\s+(?:kati\s+marks?\s+aayo|kati\s+aayo|marks?\s+kati\s+cha|result\s+kasto\s+cha)\b/i.test(message) ||
  /\b(?:sabai\s+(?:vanda|bhanda|bata)\s+(?:dherai|dheari|badhi|high|highest|kam|thorai|low|lowest))\b/i.test(message) ||
  /\b(?:highest|lowest|max|maximum|minimum|min)\s+(?:marks?|scores?|results?|grade)\b/i.test(message) ||
  /\bk\s+ma\s+(?:kam|dherai|dheari|thorai|badhi|highest|lowest|sabai\s+(?:vanda|bhanda|bata))\s*(?:aaxa|aako|aayo|cha|xa)?\b/i.test(message) ||
  /\b(?:aaile|ahile|aile|till\s+now|so\s+far)\s+(?:samma\s+)?(?:mero\s+)?(?:sabai\s+(?:vanda|bhanda|bata)\s+)?(?:dherai|dheari|kam|thorai|highest|lowest|k\s+ma)\b/i.test(message) ||
  /\b(?:mero\s+)?\d{1,3}\s+(?:marks?\s+)?(?:k\s+k?\s+ma|ma\s+k|kun\s+kun\s+ma|kun\s+ma)\b/i.test(message) ||
  /\b\d{1,3}\s+(?:marks?\s+)?(?:aaxa|aako|aayo|lyaye|lyako)\b/i.test(message) ||
  /\b(?:scored?|got|marks?\s+of)\s+\d{1,3}\b/i.test(message) ||
  /\b(?:list\s+down\s+)?(?:mero\s+)?top\s+\d+\s+(?:highest\s+)?(?:marks?|scores?|results?)?\b/i.test(message) ||
  /\btop\s+\d+\s+(?:marks?|scores?|results?)\b/i.test(message) ||
  /\b(?:did\s+i\s+pass|did\s+i\s+fail|failed\s+(?:in\s+)?(?:any\s+)?(?:subjects?|exams?)|backlogs?|arrears?|pass\s+vaye|fail\s+vaye|kunai\s+(?:subject|exam)\s+ma\s+fail)\b/i.test(message) ||
  (!attendanceIntent(message) && /\b(?:overall|aggregate)\s+(?:percentage|marks?|results?|score)\b/i.test(message)) ||
  /मेरो\s*(?:नतिजा|रिजल्ट|अंक|मार्क्स)|मिडटर्म\s*(?:अंक|मार्क्स|नतिजा)|प्रि-बोर्ड\s*(?:अंक|मार्क्स|नतिजा)|सबैभन्दा\s*(?:धेरै|कम|थोरै)|कुनमा\s*(?:धेरै|कम)|टप\s*\d+|अघिल्लो\s*सेमेस्टर/.test(message)
) && !/\b(?:how\s+(?:do\s+i|to)\s+(?:check|view|open)|kasari\s+herne|what\s+are\s+the\s+(?:passing|full|maximum)\s+marks\s+(?:of|for))\b/i.test(message);

const academicDirectoryIntent = message => (
  /\b(who\s+teaches|which\s+teacher\s+(?:is\s+assigned|teaches)|assigned\s+teacher|teacher\s+(?:assigned\s+to|for|of)|faculty\s+(?:assigned\s+to|for|of)|kasle\s+padhaunu\s*hunxa|kasle\s+padhauxa|ko\s+sir\s+le\s+padhaunu\s*hunxa|kun\s+(?:teacher|sir|mam)\s+(?:le\s+padhaunu\s*hunxa|assigned)|which\s+chapters?\s+(?:are\s+)?(?:available|in|for|of)|what\s+chapters?\s+(?:are\s+)?(?:available|in|for|of)|available\s+chapters?\s+(?:for|in|of)|chapters?\s+available\s+(?:for|in|of)|kun\s+kun\s+chapters?\s+(?:xa|cha|xan|chan))\b/i.test(message) ||
  /कसले\s*पढाउनुहुन्छ|कुन\s*शिक्षक|कुन\s*कुन\s*अध्याय/.test(message)
);

function isSmalltalkMessage(text) {
  const effective = String(text || '').trim();
  if (!effective) return false;
  // Must not contain a substantive question about courses, notices, off-topic subjects, etc.
  if (effective.split(/\s+/).length > 10) return false;
  return /^(?:hey|hi|hello|yo|sup|thanks|thank\s+you|thanku|dhanyabad|bye|goodbye|good\s+(?:morning|afternoon|evening|night)|how\s+are\s+you(?:\s+doing)?|who\s+are\s+you(?:\s+and\s+what\s+can\s+you\s+do)?|what\s+are\s+you|what\s+can\s+you\s+do|wassup|oii+|oi+|namaste|namaskar)(?:[,\s]+(?:kyana|bro|yrr|senior|didi|dai|there|k\s+(?:xa|cha|chha)(?:\s+khabar)?|how\s+are\s+you))*[?.!]*$/i.test(effective)
    || /^(?:oi+\s+|hey\s+|namaste[,\s]+)?k\s+(?:xa|cha|chha)(?:\s+khabar|\s+yrr|\s+bro)?[?.!]*$/i.test(effective)
    || /^(?:oi+\s+)?k\s+gardai\s+(?:xas|xau|chau|chhau|ho)(?:\s+yrr|\s+bro)?[?.!]*$/i.test(effective)
    || /^(?:timi|tmi)\s+(?:ko\s+hau|ko\s+ho|sanchai\s+xau|kasto\s+xau|robot\s+ho(?:\s+ki\s+manchhe)?)[?.!]*$/i.test(effective)
    || /^(?:(?:नमस्ते|नमस्कार|हेलो|हाई|ए|ओइ)[,\s!।]*)*(?:नमस्ते|नमस्कार|हेलो|हाई|के\s*छ(?:\s*खबर)?|कस्तो\s*छ(?:\s*खबर)?|तिमी\s*को\s*हौ|के\s*गर्दै\s*छौ|धन्यवाद|सञ्चै\s*छौ)[?.!।,\s]*$/.test(effective);
}

function isShowMoreQuery(text) {
  const effective = String(text || '').trim();
  if (!effective) return false;
  return /^(?:(?:arko|a?aru)(?:\s+(?:xa|cha|chha|deu|deuna|dekhauna|dekhaideu|dekhau|notes?|files?|pdfs?|notices?|posts?|assignments?|results?|pani|kei|kunei))+|(?:show(?:\s+me)?\s+more|more|any\s+more)(?:\s+(?:notes?|files?|pdfs?|notices?|posts?|assignments?|results?))*|what\s+else(?:\s+(?:is\s+there|do\s+you\s+have|xa|cha))?|(?:अरु|अर्को)(?:\s*(?:नोट्स|नोट|सूचना|असाइनमेन्ट|पोस्ट|छ|देखाऊ|देऊ|पनि))*)[?.!।]*$/i.test(effective);
}

/**
 * Extracts active academic context (subject, semester, chapter, conceptQuery) from prior user turns in history
 * so cross-intent follow-ups ("Yesko notes xa?", "Assignment pani xa?", "Chapter 3 ma kata explain gareko xa?")
 * carry forward the correct academic concept and subject without overriding explicit topic changes.
 */
function extractConversationAcademicContext(history = []) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const userTurns = history
    .filter(m => m && m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[Earlier context summary:'))
    .map(m => m.content.trim())
    .filter(Boolean);

  if (userTurns.length === 0) return null;

  let resolvedSubject = null;
  let resolvedSemester = null;
  let resolvedChapter = null;
  let resolvedUnitNumber = null;
  let resolvedConcept = null;

  for (let i = userTurns.length - 1; i >= 0; i--) {
    const turnText = userTurns[i];
    if (isShowMoreQuery(turnText) || isSmalltalkMessage(turnText)) continue;
    if (NON_BIT_ACADEMIC_OR_CODE.test(turnText)) continue;

    const turnFilters = extractFilters(turnText);
    const turnQuery = searchQuery(turnText, turnFilters);
    const predicted = turnQuery ? predictSubjects(turnQuery) : [];
    const turnImpliedSubject = turnFilters.subject || (predicted.length === 1 ? predicted[0] : null);

    // Topic-switch boundary: if a newer turn already established a subject and this older turn
    // belongs to a DIFFERENT subject, stop immediately so old concepts/chapters never leak across topics.
    if (resolvedSubject && turnImpliedSubject && turnImpliedSubject !== resolvedSubject) {
      break;
    }

    if (!resolvedSubject && turnImpliedSubject) {
      resolvedSubject = turnImpliedSubject;
    }
    if (!resolvedSemester && turnFilters.semester) {
      resolvedSemester = turnFilters.semester;
    }
    if (!resolvedChapter && turnFilters.chapter) {
      resolvedChapter = turnFilters.chapter;
      resolvedUnitNumber = turnFilters.unitNumber || null;
    }
    const isPurePersonalStatusTurn = attendanceIntent(turnText) || resultsIntent(turnText) || teacherClassroomIntent(turnText);
    if (!resolvedConcept && turnQuery && !isPurePersonalStatusTurn) {
      resolvedConcept = turnQuery;
    }
    if (resolvedSubject && resolvedConcept) break;
  }

  if (!resolvedSubject && !resolvedConcept && !resolvedChapter && !resolvedSemester) {
    return null;
  }

  return {
    subject: resolvedSubject,
    semester: resolvedSemester,
    chapter: resolvedChapter,
    unitNumber: resolvedUnitNumber,
    conceptQuery: resolvedConcept
  };
}

function routeQuery(message, history = []) {
  let effective = String(message || '').trim();
  let filters = extractFilters(effective);
  const dateInfo = parseNepaliDateExpression(effective);
  if (dateInfo) filters.dateInfo = dateInfo;

  const previousUser = [...history].reverse().find(m => m.role === 'user')?.content;

  // 0. Deictic chapter summary/note follow-up: "यो chapter को summary देऊ।", "yo chapter ko summary deu", "this chapter notes"
  if (
    previousUser &&
    !filters.chapter &&
    (/\b(yo|this|tyo|that)\s+(?:chapter|unit)\b|यो\s*(?:chapter|अध्याय|च्याप्टर|युनिट)|त्यो\s*(?:chapter|अध्याय|च्याप्टर|युनिट)/i.test(effective))
  ) {
    const convCtx = extractConversationAcademicContext(history);
    if (convCtx) {
      filters = {
        ...filters,
        chapter: filters.chapter || convCtx.chapter || null,
        unitNumber: filters.unitNumber || convCtx.unitNumber || null,
        subject: filters.subject || convCtx.subject || null,
        subjects: filters.subjects?.length ? filters.subjects : (convCtx.subject ? [convCtx.subject] : []),
        semester: filters.semester || convCtx.semester || null
      };
    }
  }

  // 1. Resolve short semester follow-ups; never carry stale filters into a new question.
  if (previousUser && /^(?:and |what about |how about |for )?(?:(?:sem(?:ester)?\s*)?(?:[1-8](?:st|nd|rd|th)?|i{1,3}|iv|v|vi{1,3})|(?:first|second|third|fourth|fifth|sixth|seventh|eighth)(?: semester)?)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser, history.slice(0, -1));
    if (['notes', 'syllabus', 'routine', 'results', 'academic_directory'].includes(prior.kind)) {
      filters = { ...prior.filters, semester: semesterNumber(effective.replace(/^(and|what about|how about|for)\s+/i, '').replace(/[?.!]+$/, '')) };
      return { kind: prior.kind, filters, query: prior.query, message: `${prior.message} (now semester ${filters.semester})` };
    }
  }

  // 2. Query refinement follow-up: "CSS ko matra", "only CSS", "matra"
  if (previousUser && /\b(?:matra|only)\b/i.test(effective) && effective.split(/\s+/).length <= 4) {
    const prior = routeQuery(previousUser, history.slice(0, -1));
    if (['notes', 'posts', 'notices', 'assignments', 'attendance', 'results'].includes(prior.kind)) {
      const refinedQuery = searchQuery(effective.replace(/\b(?:matra|only|ko)\b/gi, '').trim());
      const refinedSubject = resolveSubject(refinedQuery) || explicitSubjects(effective)[0] || prior.filters.subject;
      filters = { ...prior.filters, subject: refinedSubject, subjects: refinedSubject ? [refinedSubject] : prior.filters.subjects };
      return { kind: prior.kind, filters, query: refinedQuery || prior.query, message: `${prior.message} (refined: ${effective})` };
    }
  }

  // 3. Pagination / "Arko xa?" / "Aaru notes dekhau" / "Show more" / "What else?" follow-up
  if (previousUser && isShowMoreQuery(effective)) {
    const userHistory = history.filter(m => m && m.role === 'user' && typeof m.content === 'string');
    let baseRoute = null;
    for (let i = userHistory.length - 1; i >= 0; i--) {
      const candidateText = userHistory[i].content;
      if (isShowMoreQuery(candidateText)) continue;
      const r = routeQuery(candidateText, history.slice(0, history.indexOf(userHistory[i])));
      if (['notes', 'posts', 'notices', 'assignments', 'routine'].includes(r.kind)) {
        baseRoute = r;
        break;
      }
    }
    if (baseRoute) {
      let targetKind = baseRoute.kind;
      if (/\b(notes?|files?|pdfs?)\b|नोट्स|नोट/i.test(effective)) targetKind = 'notes';
      else if (/\bnotices?\b|सूचना/i.test(effective)) targetKind = 'notices';
      else if (/\bposts?\b|पोस्ट/i.test(effective)) targetKind = 'posts';
      else if (/\bassignments?\b|असाइनमेन्ट/i.test(effective)) targetKind = 'assignments';
      return {
        kind: targetKind,
        filters: baseRoute.filters,
        query: baseRoute.query,
        isMore: true,
        message: baseRoute.message
      };
    }
  }

  // 4. Relative reference intent: "second wala khola", "2nd wala", "tyo notes khola ta", "paila ko", "arko wala", "first wala", "pahilo wala notice dekhau"
  const relMatch = effective.match(/\b(first|second|third|1st|2nd|3rd|pahilo|dosro|tesro|paila\s+ko|arko|tyo|that)\s*(?:wala|item|one|result|notes?|file|pdf|material|notice|notices|post|posts|assignment|assignments)?\b/i);
  const isOpenAction = /\b(khola|open|view|dekhauna|dekhau|show|heram)\b/i.test(effective);
  if (!attendanceIntent(effective) && !resultsIntent(effective) && ((relMatch && isOpenAction) || (/^\s*(?:tyo\s+)?(?:notes?|file|material)?\s*(?:khola|open|view)(?:\s+ta)?\s*$/i.test(effective)))) {
    let index = 0;
    const ord = relMatch ? relMatch[1].toLowerCase() : '';
    if (/\b(second|2nd|dosro)\b/i.test(effective)) index = 1;
    else if (/\b(third|3rd|tesro)\b/i.test(effective)) index = 2;
    else if (/\b(first|1st|pahilo)\b/i.test(effective)) index = 0;
    else if (/second|2nd|dosro/.test(ord)) index = 1;
    else if (/third|3rd|tesro/.test(ord)) index = 2;
    else if (/tyo|that/.test(ord) || !ord) {
      const prevOrdinalMatch = previousUser && previousUser.match(/\b(first|second|third|1st|2nd|3rd|pahilo|dosro|tesro)\b/i);
      if (prevOrdinalMatch) {
        const po = prevOrdinalMatch[1].toLowerCase();
        if (/second|2nd|dosro/.test(po)) index = 1;
        else if (/third|3rd|tesro/.test(po)) index = 2;
      }
    }
    return { kind: 'relative_reference', index, action: 'open', filters, query: effective, message: effective };
  }

  const isTeacherClassroom = teacherClassroomIntent(effective);
  const isAttendance = attendanceIntent(effective);
  const isResults = resultsIntent(effective);
  const isDirectory = academicDirectoryIntent(effective);

  const isAssignment = !isTeacherClassroom && assignmentSearchIntent(effective);
  const routineIntent = !isTeacherClassroom && !isAttendance && !isResults && !isDirectory && !isAssignment && (
    /\b(routine|timetable|schedule|exam (?:schedule|date)|exam|deadline)\b/i.test(effective) ||
    /\b(?:routine\s+dekhauna|routine\s+k\s+xa|timetable\s+dekhauna|exam\s+ko\s+date|voli\s+exam\s+xa|bholi\s+exam\s+xa)\b/i.test(effective) ||
    /रुटिन|परीक्षा\s*तालिका|भोलि\s*परीक्षा\s*छ/.test(effective)
  ) && !/\b(?:explain|define|what\s+is\s+an?\s+(?:routine|timetable|schedule|exam)|how (?:does|do)|postpon\w*|reschedul\w*|chang\w*|cancel\w*|notice\w*|sareko|saryo|draft|leak\w*|questions?|confidential|unpublished|marks?|results?|eligible|eligibility)\b/i.test(effective);

  const syllabusIntent = !isDirectory && !isResults && !isAttendance && !isTeacherClassroom && (
    /\b(syllabus|curriculum|textbooks?|reference\s+books?|learning\s+objectives?|teaching\s+hours?|credit\s+hours?)\b|पाठ्यक्रम/i.test(effective) ||
    (/\b(?:subjects|courses|what.*in)\b/i.test(effective) && !!filters.semester && !filters.chapter)
  );
  const isNotice = !isResults && !isAttendance && !isTeacherClassroom && noticeIntent(effective);
  const isPost = !isResults && !isAttendance && !isTeacherClassroom && postIntent(effective);

  const explicitNotesWord = /\b(notes?|pdfs?|files?|study materials?|materials?|lecture slides?|slides?|pyqs?|documents?|upload(?:s|ed|ing)?)\b/i.test(effective)
    || /\b(?:upload\s+vako|upload\s+gareko|upload\s+vaye|file\s+ma|notes\s+ma|kata\s+xa|kata\s+cha|kata\s+explain|where\s+is\s+(?:it|[a-z0-9\s]+)\s+explained|(?:which|what)\s+(?:chapter|unit)\s+(?:contains?|has|covers?|explains?|includes?|is)|in\s+which\s+(?:chapter|unit)|(?:kun|kati)\s+(?:chapter|unit)\s+ma)\b/i.test(effective)
    || /नोट्स|नोट|अध्ययन\s*सामग्री|कुन\s*(?:अध्याय|च्याप्टर|युनिट)(?:मा)?/.test(effective)
    || Boolean(filters.chapter && !syllabusIntent && !isDirectory);
  const notesIntent = !isDirectory && !isAttendance && !isResults && !isTeacherClassroom && (
    explicitNotesWord ||
    (!routineIntent && !syllabusIntent && !isNotice && !isAssignment && !isPost &&
     /\b(?:khojdeu|khojideu|chaiyo|chahiyo|pathaideu|pathau|dekhau|dekhauna|summary)\b|देखाऊ|देऊ|पठाऊ/i.test(effective) && (filters.subject || filters.chapter || predictSubjects(effective).length > 0))
  ) && !/\b(?:write|create|generate|make)\s+(?:me\s+)?(?:some\s+)?notes?\b/i.test(effective);

  // 5. Cross-intent conversational context inheritance:
  //    Turn 1: "Explain deadlock in Operating Systems."
  //    Turn 2: "Yesko notes xa?" -> notes (subject: Operating Systems, query: deadlock)
  //    Turn 3: "Assignment pani xa?" -> assignments (subject: Operating Systems, query: deadlock)
  //    Turn 4: "Chapter 3 ma kata explain gareko xa?" -> notes (subject: Operating Systems, chapter: Chapter 3, query: deadlock)
  let computedQuery = searchQuery(effective, filters);
  const hasDeicticOrEllipticalFollowUp = Boolean(
    history.length > 0 &&
    !NON_BIT_ACADEMIC_OR_CODE.test(effective) &&
    (
      /\b(yesko|yasko|tyesko|tesko|yo|tyo|this|that|it|its|pani|also|too|same)\b|यसको|त्यसको|यो|त्यो|पनि/i.test(effective) ||
      (filters.chapter && !filters.subject && !computedQuery)
    )
  );

  if (hasDeicticOrEllipticalFollowUp && (notesIntent || isAssignment || isNotice || isPost || syllabusIntent || filters.chapter)) {
    const convCtx = extractConversationAcademicContext(history);
    if (convCtx) {
      if (!filters.subject && convCtx.subject) {
        filters = {
          ...filters,
          subject: convCtx.subject,
          subjects: [convCtx.subject]
        };
      }
      if (!filters.semester && convCtx.semester && !filters.subject) {
        filters = {
          ...filters,
          semester: convCtx.semester
        };
      }
      if (!computedQuery && convCtx.conceptQuery) {
        computedQuery = convCtx.conceptQuery;
      }
    }
  }

  const kinds = [
    isTeacherClassroom && 'teacher_classroom',
    isAttendance && 'attendance',
    isResults && 'results',
    isDirectory && 'academic_directory',
    notesIntent && 'notes',
    routineIntent && 'routine',
    syllabusIntent && 'syllabus',
    isNotice && 'notices',
    isPost && 'posts',
    isAssignment && 'assignments'
  ].filter(Boolean);

  const stableCode = codeRequest(effective) && !/\b(latest|newest|current version|recent release)\b/i.test(effective);
  const stableAcademic = academicRequest(effective)
    && !/\b(latest|newest|recent(?:ly)?|news|trending|current (?:version|release|price|events?)|changes? (?:in|to)|updates? (?:in|to))\b/i.test(effective);

  // Contextual follow-up on a prior BIT syllabus explanation (e.g. "Ali sajilo para ma", "C ma example deu", "in C")
  const isContextualAcademicFollowUp = Boolean(
    previousUser &&
    mapsToBitSyllabus(previousUser) &&
    !NON_BIT_ACADEMIC_OR_CODE.test(effective) &&
    /^(?:(?:ali\s+)?sajilo\s+(?:para\s+ma|bhasa\s+ma)|(?:give\s+)?(?:an?\s+)?example(?:\s+in\s+[a-z+]+)?|(?:in\s+)?(?:c|c\+\+|java|python|js|javascript|sql|php)(?:\s+ma)?(?:\s+example(?:\s+deu)?)?|c\s+ma\s+example\s+deu|explain\s+(?:more|again|simply)|elaborate|feri\s+bujhaideu|अझ\s*सजिलो\s*गरी|उदाहरण\s*देऊ)[?.!।]*$/i.test(effective)
  );

  const smalltalk = isSmalltalkMessage(effective);

  const kind = ((stableCode || stableAcademic) && mapsToBitSyllabus(effective) || isContextualAcademicFollowUp) && !kinds.length
    ? 'direct'
    : kinds.length === 1
      ? kinds[0]
      : kinds.length > 1
        ? 'tools'
        : smalltalk
          ? 'smalltalk'
          : 'scope_check';

  return { kind, filters, query: computedQuery, message: effective };
}

const tool = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }
});

const TOOLS = [
  tool('search_notes', 'Search uploaded library notes and study materials by title, topic, chapter/unit, or content. Shortlists matching candidate files and returns extracted multi-passage content with page numbers.', { query: { type: 'string', description: 'Topic, concept, or title to search in notes' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string', description: 'Explicit subject only; omit if only a topic is given' }, chapter: { type: 'string', description: 'Optional chapter or unit number/name (e.g., "Chapter 2", "Unit 4")' } }, ['query']),
  tool('read_note_file', 'Read inside an uploaded study material or note file by file ID to extract its detailed text content on a topic. Use this to read the explanation from a shortlisted note file.', { file_id: { type: 'integer', minimum: 1, description: 'The ID of the file to read' }, topic: { type: 'string', description: 'The topic or keyword to search for inside the file' } }, ['file_id']),
  tool('get_syllabus', 'Get actual BIT syllabus, units, topics, teaching hours, learning objectives, textbooks, and lab requirements for a semester or specific subject/unit. Ask if semester is missing.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, unit: { type: 'integer', minimum: 1, maximum: 20 }, query: { type: 'string' } }, []),
  tool('get_routine', 'Get actual published examination schedule (routine) for one exact semester. Note: Only examination schedules are stored in routine; no daily class lecture timetable exists. Never invent dates. Ask if semester is missing.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, query: { type: 'string' } }, []),
  tool('search_posts', 'Search community posts and discussions on Semester Library. Returns recent posts matching the query that the student is authorized to see.', { query: { type: 'string', description: 'Topic or keyword to search for in posts' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query']),
  tool('search_notices', 'Search official notices and announcements posted on Semester Library.', { query: { type: 'string', description: 'Topic or keyword to search for in notices' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query']),
  tool('search_assignments', 'Search coding assignments, deadlines, questions, and the authenticated student\'s submission status and released grades on Semester Library.', { query: { type: 'string', description: 'Assignment title, subject, or keyword' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query']),
  tool('get_my_attendance', 'Get the authenticated student\'s own live attendance summary, present/absent class counts, recorded classes, and subject-wise attendance percentage.', { subject: { type: 'string', description: 'Optional subject name or code to check attendance for' } }, []),
  tool('get_my_results', 'Get the authenticated student\'s own published examination marks and results (Mid-Term Exam, Pre-Board Exam, Final Exam). Never exposes unpublished or draft marks.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, exam_type: { type: 'string', description: 'Optional exam type: Mid-Term Exam, Pre-Board Exam, or Final Exam' } }, []),
  tool('get_academic_directory', 'Look up live academic directory information: which teacher teaches or is assigned to a subject, which subjects are available in a semester, and which chapters are available for a subject.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, query: { type: 'string' } }, []),
  tool('get_teacher_classroom_summary', 'Get aggregate classroom intelligence for an authenticated teacher or admin: pending assignment submissions requiring grading, number of recorded attendance sessions, and draft vs published exam configurations.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, [])
];

/**
 * Cleans soft line-wrap hyphens from syllabus text (e.g. "un-\nderstanding" -> "understanding").
 */
function cleanSyllabusText(raw) {
  return String(raw || '')
    .replace(/([a-z])-\s*\r?\n\s*([a-z])/g, '$1$2')
    .replace(/\b(Nor|func|Re|con|docu|struc|Ap|Characteris|un|im|Ag|cat|Con|de|Se|Clas)-\s+([a-z])/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Parses a syllabus course object (`public/syllabus-data.json`) into structured units
 * (unitNumber, title, teachingHours, topics), learning objectives, textbooks/references, and lab requirements.
 */
function parseSyllabusCourseDetails(course) {
  if (!course || typeof course !== 'object') {
    return { objectives: '', units: [], textbooks: '', lab: '' };
  }

  let rawContents = String(course.contents || '');
  let rawLab = String(course.lab || '');
  const extractedTextbooks = [];

  const splitOutTextbooks = (text) => {
    const tbMatch = text.match(/\n\s*(?:Text\s*Books?|Textbooks?|Reference\s*Books?|References?)\s*:\s*([\s\S]*)$/i);
    if (tbMatch) {
      extractedTextbooks.push(cleanSyllabusText(tbMatch[1]));
      return text.slice(0, tbMatch.index).trim();
    }
    return text;
  };

  rawContents = splitOutTextbooks(rawContents);
  rawLab = splitOutTextbooks(rawLab);

  if (course.textbooks) extractedTextbooks.push(cleanSyllabusText(course.textbooks));
  if (course.references) extractedTextbooks.push(cleanSyllabusText(course.references));

  const units = [];
  const lines = rawContents.split(/\r?\n/);
  let currentUnit = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "1. Introduction   5hrs" or "Unit 1: Introduction (5 Hrs.)"
    const unitHeaderMatch = trimmed.match(/^(?:Unit\s+)?(\d{1,2})\s*[.:-]\s*(.+?)(?:\s*\(?(\d+\s*(?:hrs?|hours?)\.?)\)?)?$/i);
    if (unitHeaderMatch && (/^\s*(?:Unit\s+)?\d{1,2}\s*[.:-]/i.test(line) && (unitHeaderMatch[3] || line.search(/\S/) <= 2))) {
      if (currentUnit) {
        currentUnit.topics = cleanSyllabusText(currentUnit.topicLines.join('\n'));
        delete currentUnit.topicLines;
        units.push(currentUnit);
      }
      currentUnit = {
        unitNumber: Number(unitHeaderMatch[1]),
        title: cleanSyllabusText(unitHeaderMatch[2]),
        teachingHours: unitHeaderMatch[3] ? unitHeaderMatch[3].replace(/\s+/g, ' ').trim() : null,
        topicLines: []
      };
    } else if (currentUnit) {
      currentUnit.topicLines.push(trimmed);
    }
  }
  if (currentUnit) {
    currentUnit.topics = cleanSyllabusText(currentUnit.topicLines.join('\n'));
    delete currentUnit.topicLines;
    units.push(currentUnit);
  }

  return {
    objectives: cleanSyllabusText(course.objectives || course.description || ''),
    units,
    textbooks: extractedTextbooks.filter(Boolean).join('\n'),
    lab: cleanSyllabusText(rawLab)
  };
}

/**
 * Resolves live chapters for a subject from `files`, `library_custom_chapters`, `library_chapter_overrides`,
 * and canonical syllabus unit breakdowns.
 */
async function resolveSubjectChapters(db, subjectRecordOrTitle, academicContext = null) {
  const canonicalTitle = typeof subjectRecordOrTitle === 'string'
    ? (resolveSubject(subjectRecordOrTitle) || subjectRecordOrTitle)
    : (subjectRecordOrTitle?.name || subjectRecordOrTitle?.title || '');
  const courseEntry = courses.find(
    c => normalize(c.title) === normalize(canonicalTitle) ||
         (subjectRecordOrTitle?.code && normalize(c.code) === normalize(subjectRecordOrTitle.code))
  );
  const subjectCode = subjectRecordOrTitle?.code || courseEntry?.code || null;
  const aliases = [...new Set([
    canonicalTitle,
    ...(subjectCode ? [subjectCode] : []),
    ...subjectAliases(canonicalTitle)
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()))];

  // Parse syllabus units if available
  const syllabusUnits = [];
  if (courseEntry) {
    const parsedDetails = parseSyllabusCourseDetails(courseEntry);
    for (const u of parsedDetails.units) {
      syllabusUnits.push(`Unit ${u.unitNumber}: ${u.title}`);
    }
  }

  let fileChapterRows = [];
  let customChapterRows = [];
  let overrideRows = [];

  if (db && typeof db.all === 'function' && aliases.length > 0) {
    const ph = aliases.map(() => '?').join(',');
    try {
      fileChapterRows = (await db.all(
        `SELECT chapter, COUNT(*) AS file_count
         FROM files
         WHERE LOWER(TRIM(COALESCE(subject, ''))) IN (${ph})
           AND chapter IS NOT NULL AND TRIM(chapter) != ''
           AND (deleted_at IS NULL) AND (hidden_at IS NULL)
         GROUP BY chapter
         ORDER BY chapter ASC`,
        ...aliases
      )) || [];
    } catch (_) {
      try {
        fileChapterRows = (await db.all(
          `SELECT chapter, COUNT(*) AS file_count
           FROM files
           WHERE LOWER(TRIM(COALESCE(subject, ''))) IN (${ph})
             AND chapter IS NOT NULL AND TRIM(chapter) != ''
           GROUP BY chapter
           ORDER BY chapter ASC`,
          ...aliases
        )) || [];
      } catch (__) {}
    }

    try {
      customChapterRows = (await db.all(
        `SELECT chapter FROM library_custom_chapters
         WHERE LOWER(TRIM(COALESCE(subject, ''))) IN (${ph})
         ORDER BY id ASC`,
        ...aliases
      )) || [];
    } catch (_) {}

    try {
      overrideRows = (await db.all(
        `SELECT original_chapter, new_chapter, is_deleted
         FROM library_chapter_overrides
         WHERE LOWER(TRIM(COALESCE(subject, ''))) IN (${ph})
         ORDER BY id ASC`,
        ...aliases
      )) || [];
    } catch (_) {}
  }

  const deletedSet = new Set();
  const renameMap = new Map();
  for (const ov of overrideRows) {
    const orig = String(ov.original_chapter || '').trim().toLowerCase();
    if (!orig) continue;
    if (Number(ov.is_deleted) === 1 || ov.is_deleted === true) {
      deletedSet.add(orig);
    } else if (ov.new_chapter && String(ov.new_chapter).trim()) {
      renameMap.set(orig, String(ov.new_chapter).trim());
    }
  }

  const chapterMap = new Map();
  const addChapter = (rawName, fileCount = 0, source = 'library') => {
    if (!rawName) return;
    let name = String(rawName).trim();
    if (!name) return;
    const lowerOrig = name.toLowerCase();
    if (deletedSet.has(lowerOrig)) return;
    if (renameMap.has(lowerOrig)) {
      name = renameMap.get(lowerOrig);
    }
    const key = name.toLowerCase();
    if (deletedSet.has(key)) return;
    const existing = chapterMap.get(key) || { name, fileCount: 0, source };
    existing.fileCount += Number(fileCount || 0);
    if (source === 'library' && existing.source === 'syllabus') {
      existing.source = 'library';
    }
    chapterMap.set(key, existing);
  };

  for (const row of fileChapterRows) {
    addChapter(row.chapter, Number(row.file_count ?? row.filecount ?? 0), 'library');
  }
  for (const row of customChapterRows) {
    addChapter(row.chapter, 0, 'custom');
  }
  for (const unit of syllabusUnits) {
    addChapter(unit, 0, 'syllabus');
  }

  return [...chapterMap.values()];
}

/**
 * Executes live Academic Directory queries using `lib/academic-service.js`, `lib/teacher-service.js`,
 * and live library chapter records.
 */
async function executeAcademicDirectoryLookup(db, academicContext, { semester = null, subject = null, query = '', message = '' } = {}) {
  const { listCanonicalSubjects } = require('./academic-service');
  const { listTeachersWithAssignments } = require('./teacher-service');

  const rawText = String(message || query || '').trim();
  const asksChapters = /\b(chapters?|units?)\b|अध्याय/i.test(rawText);
  const asksTeacher = /\b(who\s+teaches|teacher|faculty|assigned|sir|mam|ma'am|instructor|kasle\s+padhaunu|kasle\s+padhauxa)\b|शिक्षक|कसले\s*पढाउनुहुन्छ/i.test(rawText);

  let allTeachersWithAssignments = [];
  if (db && typeof db.all === 'function') {
    try {
      allTeachersWithAssignments = (await listTeachersWithAssignments(db)) || [];
    } catch (_) {
      allTeachersWithAssignments = [];
    }
  }

  // Helper to find assigned active teachers for a subject (by id, code, or name/alias)
  const findTeachersForSubject = (subjObjOrTitle) => {
    const title = typeof subjObjOrTitle === 'string' ? subjObjOrTitle : (subjObjOrTitle?.name || subjObjOrTitle?.title || '');
    const code = typeof subjObjOrTitle === 'object' ? subjObjOrTitle?.code : null;
    const id = typeof subjObjOrTitle === 'object' ? subjObjOrTitle?.id : null;
    const aliases = new Set(
      [title, code, id, ...subjectAliases(title)]
        .filter(Boolean)
        .map(s => String(s).trim().toLowerCase())
    );
    const matchedTeachers = [];
    for (const entry of allTeachersWithAssignments) {
      if (entry.teacher?.status && String(entry.teacher.status).toLowerCase() !== 'active') continue;
      const teachesSubj = (entry.subjects || []).some(s =>
        aliases.has(String(s.id || '').trim().toLowerCase()) ||
        aliases.has(String(s.code || '').trim().toLowerCase()) ||
        aliases.has(String(s.name || s.title || '').trim().toLowerCase())
      );
      if (teachesSubj) {
        matchedTeachers.push({
          id: entry.teacher.id,
          userId: entry.teacher.userId,
          name: entry.teacher.name,
          designation: entry.teacher.designation || 'Instructor',
          department: entry.teacher.department || 'BIT'
        });
      }
    }
    return matchedTeachers;
  };

  // Resolve target subject if specified or mentioned by code/name in message
  let targetSubjectTitle = subject;
  if (!targetSubjectTitle) {
    const codeMatch = rawText.match(COURSE_CODE_PATTERN);
    if (codeMatch) {
      const foundCourse = courses.find(c => c.code.toLowerCase() === codeMatch[1].toLowerCase());
      if (foundCourse) targetSubjectTitle = foundCourse.title;
    }
  }
  if (!targetSubjectTitle && db && typeof db.all === 'function') {
    try {
      const liveAll = await listCanonicalSubjects(db, { status: 'active' });
      const normMsg = normalize(rawText);
      const matchedLive = (liveAll.subjects || []).find(
        s => phraseIn(normMsg, s.code) || phraseIn(normMsg, s.name)
      );
      if (matchedLive) targetSubjectTitle = matchedLive.name;
    } catch (_) {}
  }

  // Case 1: Specific subject lookup (teacher assignment, chapters, or full subject detail)
  if (targetSubjectTitle) {
    let liveSubject = null;
    if (db && typeof db.all === 'function') {
      try {
        const aliases = subjectAliases(targetSubjectTitle).map(a => a.toLowerCase());
        const { subjects: liveList } = await listCanonicalSubjects(db, { status: 'active' });
        liveSubject = (liveList || []).find(
          s => aliases.includes(String(s.name || '').trim().toLowerCase()) ||
               aliases.includes(String(s.code || '').trim().toLowerCase())
        ) || null;
      } catch (_) {}
    }

    const staticCourse = courses.find(
      c => subjectAliases(c.title).some(a => normalize(a) === normalize(targetSubjectTitle))
    );

    const resolvedSubj = {
      id: liveSubject?.id || staticCourse?.code || targetSubjectTitle,
      code: liveSubject?.code || staticCourse?.code || null,
      name: liveSubject?.name || staticCourse?.title || targetSubjectTitle,
      semester: liveSubject?.semester || (staticCourse ? semesterNumber(staticCourse.semester) : semester),
      creditHours: liveSubject?.creditHours ?? (staticCourse?.credit ? Number(String(staticCourse.credit).replace(/[^\d.]/g, '')) : 3),
      nature: liveSubject?.nature || staticCourse?.nature || null,
      materialsCount: liveSubject?.materialsCount ?? 0,
      assignmentsCount: liveSubject?.assignmentsCount ?? 0
    };

    const assignedTeachers = findTeachersForSubject(resolvedSubj);
    const chapters = await resolveSubjectChapters(db, resolvedSubj, academicContext);

    return {
      mode: asksChapters ? 'subject_chapters' : (asksTeacher ? 'subject_teachers' : 'subject_detail'),
      subject: resolvedSubj,
      assignedTeachers,
      chapters
    };
  }

  // Case 2: Semester subjects lookup ("Which subjects are available in semester 3?")
  const effectiveSemester = semester || (academicContext?.cohort?.currentSemester || academicContext?.currentSemester || semesterNumber(academicContext?.semester)) || null;
  if (effectiveSemester) {
    let liveSubjects = [];
    if (db && typeof db.all === 'function') {
      try {
        const res = await listCanonicalSubjects(db, { semester: effectiveSemester, status: 'active' });
        liveSubjects = res.subjects || [];
      } catch (_) {
        liveSubjects = [];
      }
    }

    const subjectsList = liveSubjects.length > 0
      ? liveSubjects.map(s => ({
          id: s.id,
          code: s.code,
          title: s.name,
          name: s.name,
          semester: s.semester,
          credit: s.creditHours,
          creditHours: s.creditHours,
          nature: s.nature,
          materialsCount: s.materialsCount,
          assignmentsCount: s.assignmentsCount,
          assignedTeachers: findTeachersForSubject(s)
        }))
      : courses
          .filter(c => semesterNumber(c.semester) === effectiveSemester)
          .map(c => ({
            id: c.code,
            code: c.code,
            title: c.title,
            name: c.title,
            semester: effectiveSemester,
            credit: c.credit,
            creditHours: Number(String(c.credit || 3).replace(/[^\d.]/g, '')) || 3,
            nature: c.nature || null,
            assignedTeachers: findTeachersForSubject({ code: c.code, name: c.title })
          }));

    return {
      mode: 'semester_subjects',
      semester: effectiveSemester,
      subjects: subjectsList
    };
  }

  // Case 3: General teacher directory overview
  if (asksTeacher && allTeachersWithAssignments.length > 0) {
    return {
      mode: 'teachers_directory',
      teachers: allTeachersWithAssignments
        .filter(t => t.teacher?.status === 'active')
        .map(t => ({
          name: t.teacher.name,
          designation: t.teacher.designation,
          subjects: (t.subjects || []).map(s => ({ code: s.code, name: s.name, semester: s.semester })),
          semesters: t.derivedSemesters || []
        }))
    };
  }

  return { clarification: 'Which subject or semester (1–8) would you like academic directory details for?' };
}

/**
 * Executes aggregate Teacher Classroom Intelligence queries for an authenticated teacher or admin.
 * Reuses `getTeacherAttendanceContext` (`lib/attendance-service.js`), `getTeacherMarksContext` (`lib/marks-service.js`),
 * and aggregate assignment submission/grading counts.
 */
async function executeTeacherClassroomSummary(db, academicContext, { semester = null, subject = null, message = '' } = {}) {
  if (!academicContext?.authenticated) {
    return { clarification: 'Please sign in so I can check your classroom summary.' };
  }
  const role = String(academicContext.role || '').toLowerCase();
  if (role !== 'teacher' && role !== 'admin') {
    return { clarification: 'Classroom management summaries (pending grading, recorded attendance sessions, and draft/published exam configurations) are only available for teachers and administrators.' };
  }

  const { getTeacherAttendanceContext } = require('./attendance-service');
  const { getTeacherMarksContext } = require('./marks-service');

  const actorUserId = academicContext.studentId;
  const [attendanceCtx, marksCtx] = await Promise.all([
    getTeacherAttendanceContext(db, { actorUserId }).catch(() => null),
    getTeacherMarksContext(db, { actorUserId }).catch(() => null)
  ]);

  const authorizedSubjects = (marksCtx?.subjects || attendanceCtx?.subjects || []).filter(s => {
    if (semester && Number(s.semester) !== Number(semester)) return false;
    if (subject) {
      const aliases = subjectAliases(subject).map(a => a.toLowerCase());
      const matchName = aliases.includes(String(s.name || s.title || '').trim().toLowerCase());
      const matchCode = aliases.includes(String(s.code || '').trim().toLowerCase());
      if (!matchName && !matchCode) return false;
    }
    return true;
  });

  const authorizedSubjectIds = authorizedSubjects.map(s => s.id).filter(Boolean);
  const authorizedSubjectNamesAndCodes = [
    ...new Set(
      authorizedSubjects.flatMap(s => [s.id, s.code, s.name, s.title].filter(Boolean).map(v => String(v).trim().toLowerCase()))
    )
  ];

  // 1. Aggregate Attendance Sessions Recorded
  let attendanceSessionsBySubject = [];
  let totalAttendanceSessionsRecorded = 0;
  if (db && typeof db.all === 'function' && authorizedSubjectIds.length > 0) {
    const ph = authorizedSubjectIds.map(() => '?').join(',');
    try {
      const sessRows = (await db.all(
        `SELECT subject_id, semester_no, cohort_id, status, COUNT(*) AS session_count, MAX(session_date) AS latest_date
         FROM attendance_sessions
         WHERE subject_id IN (${ph})
           AND status IN ('submitted', 'locked')
         GROUP BY subject_id, semester_no, cohort_id, status`,
        ...authorizedSubjectIds
      )) || [];

      const countBySubj = new Map();
      for (const r of sessRows) {
        const sId = r.subject_id || r.subjectId;
        const cnt = Number(r.session_count ?? r.sessioncount ?? 0);
        totalAttendanceSessionsRecorded += cnt;
        const prev = countBySubj.get(sId) || { count: 0, latestDate: null };
        prev.count += cnt;
        const dt = r.latest_date || r.latestdate || null;
        if (dt && (!prev.latestDate || dt > prev.latestDate)) prev.latestDate = dt;
        countBySubj.set(sId, prev);
      }

      attendanceSessionsBySubject = authorizedSubjects.map(s => {
        const st = countBySubj.get(s.id) || { count: 0, latestDate: null };
        return {
          subjectId: s.id,
          code: s.code,
          name: s.name || s.title,
          semester: Number(s.semester),
          sessionsRecorded: st.count,
          latestSessionDate: st.latestDate
        };
      });
    } catch (_) {}
  }

  // 2. Draft and Published Exam Configurations (from getTeacherMarksContext)
  const examConfigsSummary = [];
  let draftExamConfigsCount = 0;
  let publishedExamConfigsCount = 0;
  let unconfiguredExamSlotsCount = 0;

  for (const sub of authorizedSubjects) {
    const exams = Array.isArray(sub.exams) ? sub.exams : [];
    for (const ex of exams) {
      if (ex.status === 'published') {
        publishedExamConfigsCount += 1;
      } else if (ex.status === 'draft' || ex.status === 'partially_published' || ex.configured) {
        draftExamConfigsCount += 1;
      } else {
        unconfiguredExamSlotsCount += 1;
      }
      if (ex.configured || ex.status !== 'not_started') {
        examConfigsSummary.push({
          subjectId: sub.id,
          subjectCode: sub.code,
          subjectName: sub.name || sub.title,
          semester: Number(sub.semester),
          examType: ex.examType,
          status: ex.status,
          configured: ex.configured,
          maxMarks: ex.maxMarks,
          enteredCount: ex.enteredCount,
          draftCount: ex.draftCount,
          publishedCount: ex.publishedCount
        });
      }
    }
  }

  // 3. Pending Assignment Submissions Requiring Grading
  let assignmentsGradingSummary = [];
  let totalPendingSubmissions = 0;
  let totalSubmissionsCount = 0;
  let totalReleasedGradesCount = 0;

  if (db && typeof db.all === 'function') {
    try {
      const releasedCond = db.isPostgres ? 'sg.released = TRUE' : 'sg.released = 1';
      let assignWhere = 'a.createdBy = ?';
      let assignParams = [actorUserId];

      if (role === 'admin' && !subject && !semester) {
        assignWhere = '1=1';
        assignParams = [];
      } else if (authorizedSubjectNamesAndCodes.length > 0) {
        const ph = authorizedSubjectNamesAndCodes.map(() => '?').join(',');
        assignWhere = `(a.createdBy = ? OR LOWER(TRIM(COALESCE(a.subject, ''))) IN (${ph}))`;
        assignParams = [actorUserId, ...authorizedSubjectNamesAndCodes];
      }

      const rawAssignments = (await db.all(
        `SELECT a.id, a.title, a.subject, a.semester, a.semester_no, a.deadline,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS question_count,
                (SELECT COUNT(*) FROM submissions sub WHERE sub.assignmentId = a.id) AS total_submissions,
                (SELECT COUNT(DISTINCT sub.studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS distinct_students_submitted,
                (SELECT COUNT(*) FROM submissions sub JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId WHERE sub.assignmentId = a.id AND ${releasedCond}) AS released_submissions
         FROM assignments a
         WHERE (a.deleted_at IS NULL) AND ${assignWhere}
         ORDER BY a.createdAt DESC`,
        ...assignParams
      )) || [];

      assignmentsGradingSummary = rawAssignments
        .filter(a => {
          if (semester) {
            const aSem = Number(a.semester_no) || semesterNumber(a.semester);
            if (aSem && aSem !== Number(semester)) return false;
          }
          return true;
        })
        .map(a => {
          const totalSubs = Number(a.total_submissions ?? a.totalsubmissions ?? 0);
          const releasedSubs = Number(a.released_submissions ?? a.releasedsubmissions ?? 0);
          const pendingSubs = Math.max(0, totalSubs - releasedSubs);
          const distinctStudents = Number(a.distinct_students_submitted ?? a.distinctstudentssubmitted ?? 0);

          totalSubmissionsCount += totalSubs;
          totalReleasedGradesCount += releasedSubs;
          totalPendingSubmissions += pendingSubs;

          return {
            assignmentId: a.id,
            title: a.title,
            subject: a.subject,
            semester: a.semester || (a.semester_no ? `Semester ${a.semester_no}` : null),
            deadline: a.deadline || null,
            questionCount: Number(a.question_count ?? a.questioncount ?? 0),
            totalSubmissions: totalSubs,
            distinctStudentsSubmitted: distinctStudents,
            releasedSubmissions: releasedSubs,
            pendingSubmissions: pendingSubs
          };
        });
    } catch (_) {}
  }

  return {
    role,
    assignedSemesters: marksCtx?.assignedSemesters || attendanceCtx?.assignedSemesters || [],
    attendance: {
      totalSessionsRecorded: totalAttendanceSessionsRecorded,
      bySubject: attendanceSessionsBySubject
    },
    marks: {
      draftExamConfigsCount,
      publishedExamConfigsCount,
      unconfiguredExamSlotsCount,
      configuredExams: examConfigsSummary
    },
    assignments: {
      totalAssignments: assignmentsGradingSummary.length,
      totalSubmissionsCount,
      totalReleasedGradesCount,
      totalPendingSubmissions,
      items: assignmentsGradingSummary
    }
  };
}

/**
 * @param {object} db
 * @param {object} route
 * @param {object} opts
 * @param {object} [opts.academicContext] - Server-resolved academic context (semester, cohort, role).
 *   SECURITY: This is the ONLY source of truth for semester authorization.
 */
function createTools(db, route, { signal, history = [], academicContext = null, searchNotes = notes.searchNotes } = {}) {
  const results = [];
  async function executeTool(name, args = {}, context = {}) {
    const toolSignal = signal && context.signal ? AbortSignal.any([signal, context.signal]) : signal || context.signal;
    toolSignal?.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    const toolEntry = TOOLS.find(t => t.function.name === name);
    if (!toolEntry) throw new Error('Unknown tool');

    const { verifyActionOrigin, sanitizeUntrustedValue } = require('./chat-security');
    const originCheck = verifyActionOrigin({
      toolName: name,
      round: context.round || 0,
      hasPreInjectedUntrustedEvidence: Boolean(context.hasPreInjectedUntrustedEvidence),
      userConfirmedAction: Boolean(context.userConfirmedAction)
    });
    if (!originCheck.allowed) {
      throw new Error(`Action origin denied: ${originCheck.reason}`);
    }

    // Unified argument validation for both directTool and LLM tool execution
    const { argumentsFor } = require('./chat-provider');
    const rawArgs = {};
    for (const key of Object.keys(args)) {
      if (args[key] !== undefined) rawArgs[key] = args[key];
    }
    if (['__proto__', 'prototype', 'constructor'].some(k => Object.prototype.hasOwnProperty.call(args, k))) {
      throw new Error('Invalid tool argument.');
    }
    if (['search_notes', 'search_posts', 'search_notices', 'search_assignments'].includes(name) && !Object.prototype.hasOwnProperty.call(rawArgs, 'query') && typeof route?.query === 'string') {
      rawArgs.query = route.query;
    }
    const validatedArgs = argumentsFor({ name, arguments: rawArgs }, toolEntry.function);

    // The user's explicit filters always win over model-supplied arguments.
    const semester = route.filters.semester;
    const subject = route.filters.subject;

    // Resolve authorization from academicContext (server-side only).
    const isAdmin = academicContext?.role === 'admin';
    const isTeacher = academicContext?.role === 'teacher';
    const hasTeacherScope = isTeacher && (
      Array.isArray(academicContext?.assignedSemesters) || Array.isArray(academicContext?.assignedSubjects)
    );
    const canViewAll = Boolean(isAdmin || (academicContext?.canViewAllCohorts && !hasTeacherScope));
    const teacherSemesters = isTeacher && !canViewAll
      ? (Array.isArray(academicContext?.assignedSemesters) ? academicContext.assignedSemesters : [])
      : null;
    const { teacherSubjectAliases } = require('./kyana-access');
    const teacherAllowedSubjects = isTeacher ? teacherSubjectAliases(academicContext) : null;
    const isTeacherSubjectAllowed = targetSubject => {
      if (!isTeacher || teacherAllowedSubjects === null) return true;
      if (!teacherAllowedSubjects.length) return false;
      const aliases = subjectAliases(targetSubject).map(a => String(a || '').trim().toLowerCase());
      return aliases.some(a => teacherAllowedSubjects.includes(a));
    };
    const authorizedSemester = (isAdmin || isTeacher) ? null : (academicContext?.cohort?.currentSemester || academicContext?.currentSemester || (academicContext?.semester ? semesterNumber(academicContext.semester) : null) || null);

    let result;
    if (['search_posts', 'search_notices', 'search_assignments', 'get_my_attendance', 'get_my_results', 'get_teacher_classroom_summary'].includes(name) && (!academicContext?.authenticated || !academicContext?.studentId)) {
      result = { clarification: 'Please sign in (log in) so I can check your current semester and personal academic records.' };
      results.push({ name, result }); return result;
    }
    if (['search_notes', 'get_routine', 'read_note_file'].includes(name) && academicContext && !academicContext.authenticated) {
      result = { clarification: 'Please sign in so I can check your current semester.' };
      results.push({ name, result }); return result;
    }
    if (isTeacher && teacherSemesters && !teacherSemesters.length && ['search_notes', 'get_routine', 'get_syllabus'].includes(name)) {
      result = { clarification: 'No teaching semesters are assigned to your account yet.' };
      results.push({ name, result }); return result;
    }
    if (name === 'get_syllabus' || name === 'get_routine') {
      const allSemesters = Boolean(route.filters?.allSemesters || validatedArgs.all_semesters);
      if (name === 'get_routine' && route.filters?.dateInfo?.unresolvable) {
        result = { clarification: route.filters.dateInfo.clarification || 'Could not resolve that date. Please specify a valid BS or AD date.' };
      } else if (name === 'get_routine' && semester && authorizedSemester && semester !== authorizedSemester) {
        result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show information for Semester ${authorizedSemester}.` };
      } else if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access information for your assigned semesters.` };
      } else if (name === 'get_syllabus' && allSemesters && !semester && !subject) {
        const allowedSems = teacherSemesters && teacherSemesters.length ? teacherSemesters : [1, 2, 3, 4, 5, 6, 7, 8];
        const selected = courses
          .filter(c => allowedSems.includes(semesterNumber(c.semester)))
          .map(c => ({
            ...c,
            semesterNo: semesterNumber(c.semester),
            syllabusDetails: parseSyllabusCourseDetails(c)
          }));
        result = {
          semester: null,
          allSemesters: true,
          courses: selected,
          requestedSubject: null,
          requestedUnit: null
        };
      } else {
        const subjectCourseSem = (name === 'get_syllabus' && subject)
          ? semesterNumber(courses.find(c => c.title === subject)?.semester)
          : null;
        const effectiveSemester = semester || subjectCourseSem || authorizedSemester || (teacherSemesters && teacherSemesters[0]);
        if (!effectiveSemester) result = { clarification: 'Which semester (1–8)?' };
        else if (name === 'get_routine' && authorizedSemester && effectiveSemester !== authorizedSemester) {
          result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show information for Semester ${authorizedSemester}.` };
        } else if (teacherSemesters && !teacherSemesters.includes(effectiveSemester)) {
          result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access information for your assigned semesters.` };
        } else if (subject && !isTeacherSubjectAllowed(subject)) {
          result = { clarification: `${subject} is not in your assigned teaching subjects.` };
        } else if (name === 'get_syllabus') {
          const requestedUnit = route.filters?.unitNumber || (Number.isInteger(validatedArgs.unit) ? validatedArgs.unit : null);
          const staticSelected = courses.filter(c => semesterNumber(c.semester) === effectiveSemester && (!subject || c.title === subject));
          let selected = staticSelected;

          // Enrich or use live canonical subjects from DB when available
          if (db && typeof db.all === 'function') {
            try {
              const { listCanonicalSubjects } = require('./academic-service');
              const { listTeachersWithAssignments } = require('./teacher-service');
              const [liveSubRes, liveTeachers] = await Promise.all([
                listCanonicalSubjects(db, { semester: effectiveSemester, status: 'active' }).catch(() => ({ subjects: [] })),
                listTeachersWithAssignments(db).catch(() => [])
              ]);
              const liveSubs = liveSubRes?.subjects || [];
              if (liveSubs.length > 0) {
                const yearLabel = `Year ${Math.ceil(effectiveSemester / 2)}`;
                const semRoman = ROMANS[effectiveSemester - 1];
                const merged = liveSubs
                  .filter(ls => !subject || subjectAliases(subject).some(a => normalize(a) === normalize(ls.name) || normalize(a) === normalize(ls.code)))
                  .map(ls => {
                    const staticMatch = staticSelected.find(sc => normalize(sc.code) === normalize(ls.code) || normalize(sc.title) === normalize(ls.name));
                    const teachersForSub = (liveTeachers || [])
                      .filter(t => t.teacher?.status === 'active' && (t.subjects || []).some(ts => normalize(ts.code) === normalize(ls.code) || normalize(ts.id) === normalize(ls.id)))
                      .map(t => t.teacher.name);
                    return {
                      ...(staticMatch || {}),
                      code: ls.code,
                      title: ls.name,
                      credit: staticMatch?.credit || ls.creditHours || 3,
                      nature: ls.nature || staticMatch?.nature || null,
                      year: staticMatch?.year || yearLabel,
                      semester: staticMatch?.semester || semRoman,
                      assignedTeachers: teachersForSub,
                      materialsCount: ls.materialsCount ?? 0,
                      assignmentsCount: ls.assignmentsCount ?? 0
                    };
                  });
                if (merged.length > 0) selected = merged;
              }
            } catch (_) {}
          }
          const enrichedCourses = selected.map(c => ({
            ...c,
            syllabusDetails: parseSyllabusCourseDetails(c)
          }));
          result = {
            semester: effectiveSemester,
            courses: enrichedCourses,
            requestedSubject: subject || null,
            requestedUnit
          };
        } else {
          try {
            let sql = `SELECT id, subject_name AS subject, subject_code, exam_date AS date, calendar, weekday AS day, exam_time AS time, room, semester, exam_type AS type FROM routine WHERE semester = ?`;
            const params = [effectiveSemester];
            if (subject) {
              const names = subjectAliases(subject).map(s => s.toLowerCase());
              sql += ` AND LOWER(TRIM(subject_name)) IN (${names.map(() => '?').join(',')})`;
              params.push(...names);
            }
            const rows = (await db.all(sql + ' ORDER BY calendar ASC, exam_date ASC, id ASC', ...params)) || [];
            let filteredRows = rows.map(r => ({ ...r, date: r.examDate || r.examdate || r.date }));
            const dateInfo = route.filters?.dateInfo;
            if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate))) {
              filteredRows = filteredRows.filter(r => matchesDateFilter(r.date, dateInfo, r.calendar || 'BS'));
            }
            let relatedNotices = [];
            if (filteredRows.length === 0 && route.message && /\b(class|classes|kaksha|exam|pariksha|bida|holiday|suru|resume|start)\b|कक्षा|परीक्षा|बिदा/i.test(route.message)) {
              try {
                relatedNotices = await aiSearch.searchNotices(db, academicContext, {
                  query: route.message,
                  semester: effectiveSemester,
                  dateInfo,
                  limit: 3
                });
              } catch (_) {}
            }
            result = {
              semester: effectiveSemester,
              routine: filteredRows,
              ...(relatedNotices.length > 0 ? { relatedNotices, notices: relatedNotices } : {}),
              scheduleType: 'examination_schedule',
              dateFilter: dateInfo ? (dateInfo.label || dateInfo.expression) : null
            };
          } catch (err) {
            result = {
              semester: effectiveSemester,
              routine: [],
              error: 'Could not retrieve the examination routine right now. Please try again in a moment.'
            };
          }
        }
      }
    } else if (name === 'get_my_attendance') {
      if (isTeacher || isAdmin) {
        result = await executeTeacherClassroomSummary(db, academicContext, {
          semester,
          subject: subject || validatedArgs.subject || null,
          message: route.message
        });
      } else {
        try {
          const { getStudentAttendanceSummary } = require('./attendance-service');
          // SECURITY: Always use server-resolved academicContext.studentId, never user/model input
          const summary = await getStudentAttendanceSummary(db, { studentUserId: academicContext.studentId });
          const targetSubj = subject || (typeof validatedArgs.subject === 'string' ? validatedArgs.subject.trim() : null);
          let matchedSubject = null;
          if (targetSubj && Array.isArray(summary.subjects)) {
            const aliases = subjectAliases(targetSubj).map(a => normalize(a));
            matchedSubject = summary.subjects.find(
              s => aliases.includes(normalize(s.name)) || aliases.includes(normalize(s.code))
            ) || null;
          }
          const rawMsg = String(route.message || route.query || '');
          result = {
            ...summary,
            matchedSubject,
            query: rawMsg,
            targetSubject: targetSubj,
            dateInfo: route.filters?.dateInfo || null,
            recentHistory: Array.isArray(summary.recentHistory)
              ? (matchedSubject
                  ? summary.recentHistory.filter(h => h.subjectId === matchedSubject.subjectId || normalize(h.subjectCode) === normalize(matchedSubject.code)).slice(0, 20)
                  : summary.recentHistory.slice(0, 20))
              : []
          };
        } catch (err) {
          result = { error: err.message || 'Could not retrieve your attendance summary right now.' };
        }
      }
    } else if (name === 'get_my_results') {
      if (isTeacher || isAdmin) {
        result = await executeTeacherClassroomSummary(db, academicContext, {
          semester,
          subject: subject || validatedArgs.subject || null,
          message: route.message
        });
      } else {
        try {
          const { getStudentPublishedResults, normalizeExamType } = require('./marks-service');
          const rawMsg = String(route.message || route.query || '');
          const currentSemNo = Number(academicContext?.currentSemester || 1);

          // Detect semester intention
          const isCurrentSemQuery = /\b(yo|this|current|present)\s+sem(?:ester)?\b|यो\s*सेमेस्टर/i.test(rawMsg);
          const isPrevSemQuery = /\b(last|previous|agadi\s+ko|hijo\s+ko)\s+sem(?:ester)?\b|अघिल्लो\s*सेमेस्टर/i.test(rawMsg);
          const isAllTimeQuery = /\b(?:aaile\s+samma|ahile\s+samma|aile\s+samma|till\s+now|so\s+far|all\s+time|overall|top\s+\d+|sabai\s+(?:vanda|bhanda|bata))\b/i.test(rawMsg);

          let targetSemester = null;
          if (isPrevSemQuery) {
            targetSemester = Math.max(1, currentSemNo - 1);
          } else if (isCurrentSemQuery) {
            targetSemester = currentSemNo;
          } else if (semester || validatedArgs.semester) {
            targetSemester = Number(semester || validatedArgs.semester);
          }

          // Detect exam type (including pre bpard typo handling)
          let requestedExamType = null;
          if (validatedArgs.exam_type) {
            try { requestedExamType = normalizeExamType(validatedArgs.exam_type, { required: false }); } catch (_) {}
          }
          if (!requestedExamType) {
            if (/\b(mid-?term|mid\s*term)\b|मिडटर्म/i.test(rawMsg)) requestedExamType = 'Mid-Term Exam';
            else if (/\b(pre-?board|pre\s*board|pre\s*bpard|preboard)\b|प्रि-?बोर्ड/i.test(rawMsg)) requestedExamType = 'Pre-Board Exam';
            else if (/\b(final\s+exams?|finals?|board\s+exams?)\b|फाइनल/i.test(rawMsg)) requestedExamType = 'Final Exam';
          }

          // Detect target subject
          let targetSubj = subject || (typeof validatedArgs.subject === 'string' ? validatedArgs.subject.trim() : null);
          if (!targetSubj) {
            const explicit = explicitSubjects(rawMsg);
            if (explicit.length === 1) targetSubj = explicit[0];
            else {
              const pred = predictSubjects(rawMsg);
              if (pred.length === 1) targetSubj = pred[0];
            }
          }
          const subjAliases = targetSubj ? subjectAliases(targetSubj).map(a => normalize(a)) : null;

          // Detect analytical query types:
          const isHighestQuery = (
            /\b(?:highest|max|maximum|top|best)\s+(?:marks?|scores?|result|sub(?:ject)?)\b/i.test(rawMsg) ||
            /\b(?:sabai\s+(?:vanda|bhanda|bata)\s+(?:dherai|dheari|badhi|high|highest)|sabai\s+vanda\s+ramro)\b/i.test(rawMsg) ||
            /\bk\s+ma\s+(?:dherai|dheari|badhi|highest)\s+(?:aaxa|aako|aayo|cha|xa)\b/i.test(rawMsg) ||
            /सबैभन्दा\s*(?:धेरै|राम्रो)/.test(rawMsg)
          ) && !/\btop\s+\d+\b/i.test(rawMsg);

          const isLowestQuery = (
            /\b(?:lowest|min|minimum|least|worst)\s+(?:marks?|scores?|result|sub(?:ject)?)\b/i.test(rawMsg) ||
            /\b(?:sabai\s+(?:vanda|bhanda|bata)\s+(?:kam|thorai|lowest|low))\b/i.test(rawMsg) ||
            /\bk\s+ma\s+(?:kam|thorai|lowest|low)\s+(?:aaxa|aako|aayo|cha|xa)\b/i.test(rawMsg) ||
            /सबैभन्दा\s*(?:कम|थोरै)/.test(rawMsg)
          );

          const topNMatch = rawMsg.match(/\btop\s+(\d+)\b/i) || rawMsg.match(/(?:पहिलो|शीर्ष)\s*([0-9१-९]+)/);
          const topN = topNMatch ? Math.min(Number(topNMatch[1]), 50) : null;

          const scoreMatch = rawMsg.match(/\b(?:mero\s+)?(\d{1,3})\s+(?:marks?\s+)?(?:k\s+k?\s+ma|ma\s+k|kun\s+kun\s+ma|kun\s+ma)\b/i)
            || rawMsg.match(/\b(?:scored?|got|marks?\s+of)\s+(\d{1,3})\b/i)
            || rawMsg.match(/\b(\d{1,3})\s+(?:marks?\s+)?(?:aaxa|aako|aayo)\b/i);
          const targetScore = scoreMatch ? Number(scoreMatch[1]) : null;

          const isPassFailQuery = /\b(pass|fail|failed|backlog|backlogs?|arrear|arrears?|katyo|katena|pass\s+vaye|fail\s+vaye)\b|पास|फेल|ब्याक/i.test(rawMsg);
          const isOverallAggregateQuery = /\b(overall|aggregate|total\s+percentage|overall\s+percentage|gpa|cgpa|average)\b|समग्र|कुल\s*प्राप्ताङ्क/i.test(rawMsg);

          // If query is global/all-time/highest/lowest/topN/targetScore without a semester explicitly forced, fetch ALL semesters
          const semesterFilterForService = (isHighestQuery || isLowestQuery || topN || targetScore !== null || isAllTimeQuery) && !isCurrentSemQuery && !isPrevSemQuery && !semester && !validatedArgs.semester
            ? null
            : targetSemester;

          // SECURITY: Always use server-resolved academicContext.studentId; getStudentPublishedResults strictly filters status = 'published'
          const publishedData = await getStudentPublishedResults(db, {
            studentUserId: academicContext.studentId,
            semesterFilter: semesterFilterForService
          });

          const resolvedCurrentSem = Number(publishedData.currentSemesterNo || currentSemNo || 1);
          const allResults = Array.isArray(publishedData.results) ? publishedData.results : [];

          // Helper to match subject
          const matchesSubject = (r) => {
            if (!targetSubj) return true;
            const normName = normalize(r.subjectName || '');
            const normCode = normalize(r.subjectCode || '');
            const normTarget = normalize(targetSubj);
            if (normName === normTarget || normCode === normTarget) return true;
            if (normName.includes(normTarget) || normTarget.includes(normName)) return true;
            if (subjAliases && (subjAliases.includes(normName) || subjAliases.includes(normCode))) return true;
            for (const alias of (subjAliases || [])) {
              if (alias && (normName.includes(alias) || alias.includes(normName))) return true;
            }
            return false;
          };

          // Filter by semester, subject, and examType for standard lookups
          let filteredResults = allResults;
          if (targetSemester) {
            filteredResults = filteredResults.filter(r => Number(r.semesterNo) === Number(targetSemester));
          }
          if (targetSubj) {
            filteredResults = filteredResults.filter(matchesSubject);
          }
          if (requestedExamType) {
            filteredResults = filteredResults.filter(r => r.examType === requestedExamType);
          }

          // Compute analytics on published results:
          const validResults = allResults.filter(r => !r.isAbsent && r.percentage !== null && r.obtainedMarks !== null);
          const sortedDescending = [...validResults].sort((a, b) => {
            const pctA = a.percentage ?? ((a.obtainedMarks / a.maxMarks) * 100);
            const pctB = b.percentage ?? ((b.obtainedMarks / b.maxMarks) * 100);
            if (pctB !== pctA) return pctB - pctA;
            return b.obtainedMarks - a.obtainedMarks;
          });
          const sortedAscending = [...validResults].sort((a, b) => {
            const pctA = a.percentage ?? ((a.obtainedMarks / a.maxMarks) * 100);
            const pctB = b.percentage ?? ((b.obtainedMarks / b.maxMarks) * 100);
            if (pctA !== pctB) return pctA - pctB;
            return a.obtainedMarks - b.obtainedMarks;
          });

          // Candidates for highest/lowest:
          const semScopedCandidates = isCurrentSemQuery
            ? validResults.filter(r => Number(r.semesterNo) === resolvedCurrentSem)
            : (targetSemester ? validResults.filter(r => Number(r.semesterNo) === Number(targetSemester)) : validResults);

          let highestList = [];
          if (semScopedCandidates.length > 0) {
            const maxPct = Math.max(...semScopedCandidates.map(r => r.percentage ?? ((r.obtainedMarks / r.maxMarks) * 100)));
            highestList = semScopedCandidates.filter(r => (r.percentage ?? ((r.obtainedMarks / r.maxMarks) * 100)) === maxPct);
          }

          let lowestList = [];
          if (semScopedCandidates.length > 0) {
            const minPct = Math.min(...semScopedCandidates.map(r => r.percentage ?? ((r.obtainedMarks / r.maxMarks) * 100)));
            lowestList = semScopedCandidates.filter(r => (r.percentage ?? ((r.obtainedMarks / r.maxMarks) * 100)) === minPct);
          }

          // Exact and close score matches
          const exactScoreMatches = targetScore !== null
            ? allResults.filter(r => !r.isAbsent && r.obtainedMarks === targetScore)
            : [];
          const closeScoreMatches = targetScore !== null && exactScoreMatches.length === 0
            ? allResults.filter(r => !r.isAbsent && Math.abs(r.obtainedMarks - targetScore) <= 5)
            : [];

          // Top N
          const topNList = topN ? sortedDescending.slice(0, topN) : [];

          // Failed exams
          const failedExams = allResults.filter(r => r.passFail === 'Fail' || r.isAbsent);

          result = {
            ...publishedData,
            requestedSemester: targetSemester || (isCurrentSemQuery ? resolvedCurrentSem : null),
            currentSemesterNo: resolvedCurrentSem,
            lastSemesterNo: isPrevSemQuery ? targetSemester : Math.max(1, resolvedCurrentSem - 1),
            requestedSubject: targetSubj || null,
            requestedExamType,
            rawMessage: rawMsg,
            isCurrentSemQuery,
            isPrevSemQuery,
            isHighestQuery,
            isLowestQuery,
            topN,
            targetScore,
            isPassFailQuery,
            isOverallAggregateQuery,
            filteredResults,
            allResults,
            validResults,
            highestList,
            lowestList,
            topNList,
            exactScoreMatches,
            closeScoreMatches,
            failedExams
          };
        } catch (err) {
          result = { error: err.message || 'Could not retrieve your published results right now.' };
        }
      }
    } else if (name === 'get_academic_directory') {
      try {
        result = await executeAcademicDirectoryLookup(db, academicContext, {
          semester: semester || validatedArgs.semester || null,
          subject: subject || validatedArgs.subject || null,
          query: validatedArgs.query || route.query || '',
          message: route.message || ''
        });
      } catch (err) {
        result = { error: err.message || 'Could not retrieve academic directory details right now.' };
      }
    } else if (name === 'get_teacher_classroom_summary') {
      const targetSem = semester || validatedArgs.semester || null;
      const targetSubj = subject || validatedArgs.subject || null;
      if (teacherSemesters && targetSem && !teacherSemesters.includes(Number(targetSem))) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access classroom summaries for your assigned semesters.` };
      } else if (targetSubj && !isTeacherSubjectAllowed(targetSubj)) {
        result = { clarification: `${targetSubj} is not in your assigned teaching subjects.` };
      } else {
        try {
          result = await executeTeacherClassroomSummary(db, academicContext, {
            semester: targetSem,
            subject: targetSubj,
            message: route.message || ''
          });
        } catch (err) {
          result = { error: err.message || 'Could not retrieve teacher classroom summary right now.' };
        }
      }
    } else if (name === 'search_notes') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      const chapter = (typeof validatedArgs.chapter === 'string' && validatedArgs.chapter.trim())
        ? validatedArgs.chapter.trim()
        : (route.filters?.chapter || null);
      const allSemesters = Boolean(route.filters?.allSemesters || validatedArgs.all_semesters);
      const subjectCourse = subject ? courses.find(c => c.title === subject) : null;
      const subjectSem = subjectCourse ? semesterNumber(subjectCourse.semester) : null;

      if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access materials for your assigned semesters.` };
      } else if (subject && teacherSemesters && !semester) {
        if (subjectSem && !teacherSemesters.includes(subjectSem)) {
          result = { clarification: `${subject} belongs to Semester ${subjectSem}, which is not in your assigned teaching semesters (${teacherSemesters.join(', ')}).` };
        }
      }
      if (!result && subject && !isTeacherSubjectAllowed(subject)) {
        result = { clarification: `${subject} is not in your assigned teaching subjects.` };
      }

      // Check chapter ambiguity when a non-numeric chapter keyword is given
      if (!result && chapter && subject && notes.parseChapterFilter) {
        const parsedChap = notes.parseChapterFilter(chapter);
        if (parsedChap && parsedChap.number === null && parsedChap.text) {
          try {
            const subjectChaps = await resolveSubjectChapters(db, subject, academicContext);
            const matchedChaps = (subjectChaps || []).filter(c => notes.matchesChapter(c.name, parsedChap));
            const exactChap = matchedChaps.find(c => normalize(c.name) === normalize(chapter));
            if (matchedChaps.length > 1 && !exactChap) {
              result = {
                clarification: `Which chapter of ${subject} do you mean: ${matchedChaps.slice(0, 4).map(c => c.name).join(' or ')}?`
              };
            }
          } catch (_) {}
        }
      }

      if (!result) {
        if (!query && !subject && !chapter && !semester && !allSemesters) result = { clarification: 'Which subject or topic do you need notes for?' };
        else if (!subject && !query && chapter) result = { clarification: `Which subject do you need ${chapter} notes for?` };
        else {
          try {
            // Academic learning resources policy:
            // - Default: search the student's assigned semester (authorizedSemester).
            // - If the student asks for notes from all semesters: search all semesters (searchAllSemesters: true).
            // - If the student explicitly asks for another semester: search that semester.
            // - If the student explicitly names a subject belonging to another semester: resolve the subject's actual semester and retrieve from it.
            // - Never silently mix other-semester notes into normal current-semester results.
            const searchSem = allSemesters
              ? undefined
              : (semester || (subjectSem && authorizedSemester && subjectSem !== authorizedSemester ? subjectSem : null) || authorizedSemester || subjectSem || (teacherSemesters && teacherSemesters.length === 1 ? teacherSemesters[0] : undefined));
            const excludeIds = Array.isArray(route.excludeIds) ? route.excludeIds : [];
            let files = await searchNotes(db, {
              query,
              academicContext,
              semester: searchSem,
              searchAllSemesters: allSemesters,
              subject: subject ? subjectAliases(subject) : undefined,
              ...(chapter ? { chapter } : {}),
              ...(excludeIds.length > 0 ? { excludeIds } : {})
            });
            let inferredSubject = null;
            if (!files.length && !subject) {
              const predictions = predictSubjects(query).filter(s => {
                if (!isTeacherSubjectAllowed(s)) return false;
                const cSem = semesterNumber(courses.find(c => c.title === s)?.semester);
                if (!allSemesters && searchSem && cSem !== searchSem) return false;
                if (teacherSemesters && cSem && !teacherSemesters.includes(cSem)) return false;
                return true;
              });
              if (predictions.length > 1) result = { clarification: `Which subject do you mean: ${predictions.join(' or ')}?` };
              else if (predictions.length === 1) {
                inferredSubject = predictions[0];
                const inferredSemester = allSemesters ? undefined : (searchSem || semesterNumber(courses.find(c => c.title === inferredSubject)?.semester));
                files = await searchNotes(db, {
                  query: '',
                  academicContext,
                  semester: inferredSemester,
                  searchAllSemesters: allSemesters,
                  subject: subjectAliases(inferredSubject),
                  ...(chapter ? { chapter } : {}),
                  ...(excludeIds.length > 0 ? { excludeIds } : {})
                });
              }
            }
            // Also check if a non-numeric chapter filter matched multiple distinct file chapters
            if (!result && chapter && notes.parseChapterFilter) {
              const parsedChap = notes.parseChapterFilter(chapter);
              if (parsedChap && parsedChap.number === null) {
                const distinctChaps = [...new Set(files.map(f => String(f.chapter || '').trim()).filter(Boolean))];
                if (distinctChaps.length > 1 && !distinctChaps.some(c => normalize(c) === normalize(chapter))) {
                  result = {
                    clarification: `Which chapter do you mean: ${distinctChaps.slice(0, 4).join(' or ')}?`
                  };
                }
              }
            }
            if (!result) result = {
              files: files.slice(0, 3).map(f => {
                const pageNums = Array.isArray(f.pageNumbers) && f.pageNumbers.length > 0 ? f.pageNumbers : [];
                const pageLabel = pageNums.length > 0
                  ? `, Page${pageNums.length > 1 ? 's' : ''} ${pageNums.join(', ')}`
                  : '';
                const rawChap = String(f.chapter || '').trim();
                const chapFormatted = rawChap
                  ? (/^(?:chapter|chap|unit|module|folder)\b/i.test(rawChap) ? rawChap : `Chapter ${rawChap}`)
                  : '';
                const chapLabel = chapFormatted ? `, ${chapFormatted}` : '';
                const folderPath = f.folderPath || (typeof topics.formatNoteFolderPath === 'function'
                  ? topics.formatNoteFolderPath(f, query)
                  : [f.subject || 'Study Material', chapFormatted].filter(Boolean).join(' / '));
                return {
                  id: f.id,
                  title: f.title || f.originalName,
                  originalName: f.originalName,
                  subject: f.subject,
                  semester: f.semester,
                  chapter: f.chapter,
                  folderPath,
                  syllabusUnit: f.syllabusUnit || null,
                  excerpt: f.excerpt || '',
                  matchType: inferredSubject ? 'topic' : f.matchType,
                  viewUrl: `/api/files/${f.id}/view`,
                  downloadUrl: `/api/files/${f.id}/download`,
                  extractedContent: f.extractedContent || null,
                  passages: f.passages || [],
                  pageNumbers: pageNums,
                  hasContent: Boolean(f.extractedContent),
                  sourceCitation: `This is extracted from **${f.title || f.originalName}** (${f.subject || 'Study Material'}${chapLabel}${pageLabel})`,
                  resourceCard: { type: 'note', id: f.id, title: f.title || f.originalName, subject: f.subject, semester: f.semester, chapter: f.chapter, folderPath, action: 'open_note', deepLink: `/material/${f.id}`, viewUrl: `/api/files/${f.id}/view`, downloadUrl: `/api/files/${f.id}/download`, mobileRoute: `/material/${f.id}`, mobileParams: { id: f.id } }
                };
              }),
              inferredSubject,
              chapterFilter: chapter || null,
              searchedSemester: searchSem || null,
              allSemesters
            };
          } catch (err) {
            result = { files: [], error: 'Could not search study materials right now. Please try again in a moment.' };
          }
        }
      }
    } else if (name === 'read_note_file') {
      const fileId = Number(validatedArgs.file_id);
      if (!fileId) {
        result = { error: 'Please specify a valid file ID to read.' };
      } else {
        try {
          const allowCrossSemester = Boolean(
            route.filters?.semester ||
            route.filters?.subject ||
            route.filters?.allSemesters ||
            route.filters?.otherSemester ||
            validatedArgs.all_semesters
          );
          const fileContent = await notes.readNoteFileContent(db, fileId, {
            query: validatedArgs.topic || route.query,
            academicContext,
            allowCrossSemester
          });
          if (!fileContent) {
            result = { error: 'File not found or access denied.' };
          } else if (!fileContent.hasContent) {
            result = {
              id: fileContent.id,
              title: fileContent.title,
              subject: fileContent.subject,
              semester: fileContent.semester,
              extractionStatus: fileContent.extractionStatus,
              hasContent: false,
              message: 'No readable text content extracted from this file (scanned image or empty).'
            };
          } else {
            const pageNums = Array.isArray(fileContent.pageNumbers) && fileContent.pageNumbers.length > 0 ? fileContent.pageNumbers : [];
            const pageLabel = pageNums.length > 0
              ? `, Page${pageNums.length > 1 ? 's' : ''} ${pageNums.join(', ')}`
              : '';
            const rawChap = String(fileContent.chapter || '').trim();
            const chapFormatted = rawChap
              ? (/^(?:chapter|chap|unit|module|folder)\b/i.test(rawChap) ? rawChap : `Chapter ${rawChap}`)
              : '';
            const chapLabel = chapFormatted ? `, ${chapFormatted}` : '';
            const folderPath = fileContent.folderPath || [fileContent.subject || 'General', chapFormatted].filter(Boolean).join(' / ');
            result = {
              ...fileContent,
              folderPath,
              sourceCitation: `This is extracted from **${fileContent.title}** (${fileContent.subject || 'General'}${chapLabel}${pageLabel})`,
              resourceCard: {
                type: 'note',
                id: fileContent.id,
                title: fileContent.title,
                subject: fileContent.subject,
                semester: fileContent.semester,
                chapter: fileContent.chapter,
                folderPath,
                action: 'open_note',
                deepLink: `/material/${fileContent.id}`,
                viewUrl: `/api/files/${fileContent.id}/view`,
                downloadUrl: `/api/files/${fileContent.id}/download`,
                mobileRoute: `/material/${fileContent.id}`,
                mobileParams: { id: fileContent.id }
              }
            };
          }
        } catch (err) {
          result = { error: 'Could not read that study material right now. Please try again in a moment.' };
        }
      }
    } else if (name === 'search_posts') {
      const rawArgQuery = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      const query = (route.message && (!rawArgQuery || rawArgQuery === route.query)) ? `${rawArgQuery || ''} ${route.message}`.trim().slice(0, 400) : rawArgQuery;
      const dateInfo = route.filters?.dateInfo || null;
      const excludeIds = Array.isArray(route.excludeIds) ? route.excludeIds : [];
      const otherSemesterOnly = Boolean(route.filters?.otherSemester);
      if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { posts: [], count: 0, clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access posts for your assigned semesters.` };
      } else if (dateInfo?.unresolvable) {
        result = { clarification: dateInfo.clarification || 'Could not resolve that date. Please specify a valid BS or AD date.' };
      } else {
        try {
          const posts = await aiSearch.searchPosts(db, academicContext, {
            query,
            semester: semester || null,
            otherSemesterOnly,
            dateInfo,
            excludeIds,
            limit: 5
          });
          result = { posts, count: posts.length, viewerSemester: authorizedSemester };
        } catch (e) {
          result = { posts: [], count: 0, error: 'Could not search posts right now.' };
        }
      }
    } else if (name === 'search_notices') {
      const rawArgQuery = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      const query = (route.message && (!rawArgQuery || rawArgQuery === route.query || rawArgQuery.split(/\s+/).length <= 1)) ? `${rawArgQuery || ''} ${route.message}`.trim().slice(0, 400) : rawArgQuery;
      const dateInfo = route.filters?.dateInfo || null;
      const excludeIds = Array.isArray(route.excludeIds) ? route.excludeIds : [];
      const otherSemesterOnly = Boolean(route.filters?.otherSemester);
      const includeOfficialUniversityNotices = isExplicitOfficialUniversityNoticeQuery(route.message || query);
      if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { notices: [], count: 0, clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access notices for your assigned semesters.` };
      } else if (dateInfo?.unresolvable) {
        result = { clarification: dateInfo.clarification || 'Could not resolve that date. Please specify a valid BS or AD date.' };
      } else {
        try {
          const rawMsgStr = String(route.message || query || '');
          const isDeicticNoticeQuery = /\b(?:(yo|this|tyo|that)\s+(?:notice|announcement|post)|(?:yesko|yasko|tesko|tyesko)\s+(?:meaning|matlab|summary|details?|k\s+ho|ke\s+ho)|meaning\s+of\s+(?:this|that)|what\s+does\s+(?:this|that)\s+(?:notice|announcement|post)\s+mean|(?:explain|bujhaideu|bujhauna)\s+(?:this|that|yo|tyo)|(?:yo|tyo)\s+notice\s+explain)\b|यो\s*सूचना|त्यो\s*सूचना/i.test(rawMsgStr);
          let notices = [];
          if (isDeicticNoticeQuery && Array.isArray(history) && history.length > 0) {
            const priorCards = [...history].reverse().flatMap(m => (m && (m.metadata?.resourceCards || m.resourceCards)) || []);
            const targetCard = priorCards.find(c => c && c.type === 'notice') || priorCards.find(c => c && c.type === 'post');
            if (targetCard) {
              const { readResource, resourceCard, formatResourceSemester } = require('./kyana-access');
              const sourceRow = await readResource(db, academicContext, targetCard);
              if (sourceRow) {
                const builtCard = resourceCard(targetCard.type, sourceRow);
                const createdAt = sourceRow.created_at || sourceRow.createdAt || null;
                const semLabel = formatResourceSemester(sourceRow) || 'All Semesters';
                notices.push({
                  id: Number(sourceRow.id),
                  title: builtCard?.title || sourceRow.title || 'Campus Notice',
                  content: sourceRow.content || '',
                  excerpt: builtCard?.excerpt || String(sourceRow.content || '').slice(0, 180),
                  type: 'notice',
                  resourceType: 'notice',
                  semester: semLabel,
                  semesterNo: semesterNumber(sourceRow.semester_no ?? sourceRow.semester),
                  authorName: sourceRow.author_name || sourceRow.authorName || targetCard.authorName || null,
                  authorRole: String(sourceRow.author_role || sourceRow.role || targetCard.authorRole || 'admin').toLowerCase(),
                  authority: builtCard?.authority || 'Official Notice',
                  isOfficialNotice: true,
                  createdAt,
                  publishedDate: builtCard?.publishedDate || (createdAt ? String(createdAt).slice(0, 10) : null),
                  resourceCard: builtCard
                });
              }
            }
          }
          if (notices.length === 0) {
            notices = await aiSearch.searchNotices(db, academicContext, {
              query,
              semester: semester || null,
              otherSemesterOnly,
              dateInfo,
              excludeIds,
              limit: 5,
              includeOfficialUniversityNotices
            });
          }
          let relatedRoutine = [];
          const targetRoutineSem = semester || authorizedSemester;
          const isGeneralClassOrExamScheduleQuery = /\b(?:aaja|bholi|voli|today|tomorrow|hamro)\b[^?.!]{0,40}\b(?:class(?:es)?|kaksha|routine|timetable|schedule|exam)\b/i.test(rawMsgStr);
          if ((notices.length > 0 || isGeneralClassOrExamScheduleQuery) && targetRoutineSem && (!authorizedSemester || Number(targetRoutineSem) === Number(authorizedSemester)) && /\b(class|classes|kaksha|exam|exams|examination|pariksha|routine|timetable|schedule)\b|परीक्षा|रुटिन|तालिका|कक्षा/i.test(rawMsgStr)) {
            try {
              const rRows = (await db.all(
                `SELECT id, subject_name AS subject, subject_code, exam_date AS date, calendar, weekday AS day, exam_time AS time, room, semester, exam_type AS type FROM routine WHERE semester = ? ORDER BY calendar ASC, exam_date ASC, id ASC`,
                Number(targetRoutineSem)
              )) || [];
              relatedRoutine = rRows.map(r => ({ ...r, date: r.examDate || r.examdate || r.date }));
              if (dateInfo && !dateInfo.unresolvable && (dateInfo.date || (dateInfo.startDate && dateInfo.endDate)) && !isGeneralClassOrExamScheduleQuery) {
                const dateFiltered = relatedRoutine.filter(r => matchesDateFilter(r.date, dateInfo, r.calendar || 'BS'));
                if (dateFiltered.length > 0) relatedRoutine = dateFiltered;
              }
            } catch (_) {}
          }
          let relatedPosts = [];
          // Unified Notice + Post Fallback: if no official notice matched, check regular campus posts
          // (excluding spoofed student posts claiming to be official notices) so questions answered in community posts are still synthesized.
          if (notices.length === 0) {
            const candidatePosts = await aiSearch.searchPosts(db, academicContext, {
              query,
              semester: semester || null,
              otherSemesterOnly,
              dateInfo,
              excludeIds,
              limit: 4
            });
            relatedPosts = (candidatePosts || []).filter(p => {
              const role = String(p.authorRole || 'student').toLowerCase();
              if (['admin', 'teacher', 'cr'].includes(role)) return true;
              const rawType = String(p.rawType || '').toLowerCase();
              const rawCat = String(p.category || '').toLowerCase();
              const isFakeNoticeClaim = rawType === 'notice' || rawCat === 'notice' || /\b(?:official\s+notice|urgent\s+.*notice)\b/i.test(`${p.title || ''} ${p.content || ''}`);
              return !isFakeNoticeClaim;
            });
          }
          const { validateRetrievedEvidence } = require('./chat-grounding');
          const evidenceValidation = validateRetrievedEvidence(
            route.message || query,
            notices.length > 0 ? notices : relatedPosts,
            { userSemester: authorizedSemester }
          );
          result = {
            notices,
            count: notices.length,
            query: route.message || query,
            evidenceValidation,
            ...(relatedRoutine.length > 0 ? { relatedRoutine, routine: relatedRoutine } : {}),
            ...(relatedPosts.length > 0 ? { relatedPosts, posts: relatedPosts } : {}),
            includeOfficialUniversityNotices,
            viewerSemester: authorizedSemester
          };
        } catch (e) {
          result = { notices: [], count: 0, error: 'Could not search notices right now.' };
        }
      }
    } else if (name === 'search_assignments') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      const dateInfo = route.filters?.dateInfo || null;
      const excludeIds = Array.isArray(route.excludeIds) ? route.excludeIds : [];
      const allSemesters = Boolean(route.filters?.allSemesters || validatedArgs.all_semesters);
      const otherSemesterOnly = Boolean(route.filters?.otherSemester);
      const subjectCourseSem = subject ? semesterNumber(courses.find(c => c.title === subject)?.semester) : null;
      const targetSemester = semester || (subjectCourseSem && authorizedSemester && subjectCourseSem !== authorizedSemester ? subjectCourseSem : null);
      if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { assignments: [], count: 0, clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access assignments for your assigned semesters.` };
      } else if (dateInfo?.unresolvable) {
        result = { clarification: dateInfo.clarification || 'Could not resolve that date. Please specify a valid BS or AD date.' };
      } else if (subject && !isTeacherSubjectAllowed(subject)) {
        result = { assignments: [], count: 0, clarification: `${subject} is not in your assigned teaching subjects.` };
      } else {
        try {
          const rawMsg = String(route.message || query || '');
          const isUnsubmittedFilter = /\b(haven'?t\s+submitted|have\s+(?:i\s+)?not\s+submitted|not\s+submitted|unsubmitted|pending\s+to\s+submit|left\s+to\s+submit|remaining\s+assignments?|submit\s+gareko\s+(?:xaina|chaina)|submit\s+nagareko|nabujhako|baki\s+assignments?)\b|बुझाउन\s*बाँकी|बुझाएको\s*छैन/i.test(rawMsg);
          const isCheckedFilter = /\b(is\s+(?:my\s+|the\s+)?assignment\s+checked|has\s+(?:my\s+)?assignment\s+been\s+checked|checked|grading|graded|check\s+(?:vayo|bhayo|cha|xa)|teacher\s+le\s+check)\b/i.test(rawMsg);
          const isMissedFilter = /\b(is\s+any\s+assignment\s+(?:is\s+)?missed|did\s+i\s+miss\s+(?:any\s+)?assignments?|missed\s+assignments?|kunai\s+assignment\s+(?:miss|chutyo|chhutyo)|overdue\s+assignments?|deadline\s+(?:cut|gayo|passed))\b/i.test(rawMsg);
          const isCountFilter = /\b(how\s+many\s+assignments?|total\s+assignments?|kati\s+(?:wota\s+)?assignments?\s+(?:chan?|xan?|xa|cha|ho)|assignments?\s+we\s+have|assignments?\s+do\s+we\s+have)\b/i.test(rawMsg);

          const needsAllSemesterAssignments = isCheckedFilter || isMissedFilter || isCountFilter || isUnsubmittedFilter;
          const searchLimit = needsAllSemesterAssignments ? 50 : (isUnsubmittedFilter ? 10 : 5);
          const effectiveQuery = needsAllSemesterAssignments ? '' : query;

          const isDeicticAssignmentQuery = /\b(yesko|yasko|tesko|tyesko|yo|tyo|this|that|its)\s+(?:deadline|last\s+date|due\s+date|submission\s+date)\b|त्यसको\s*(?:अन्तिम\s*मिति|डेडलाइन)|यसको\s*(?:अन्तिम\s*मिति|डेडलाइन)/i.test(rawMsg);
          let assignments = await aiSearch.searchAssignments(db, academicContext, {
            query: isDeicticAssignmentQuery ? '' : effectiveQuery,
            subject: subject ? subjectAliases(subject) : null,
            semester: targetSemester,
            searchAllSemesters: allSemesters,
            otherSemesterOnly,
            dateInfo,
            excludeIds,
            limit: searchLimit
          });
          if (isDeicticAssignmentQuery && Array.isArray(history) && history.length > 0) {
            const priorCards = [...history].reverse().flatMap(m => (m && (m.metadata?.resourceCards || m.resourceCards)) || []);
            const targetAsgCard = priorCards.find(c => c && c.type === 'assignment');
            if (targetAsgCard) {
              const { readResource } = require('./kyana-access');
              const verifiedRow = await readResource(db, academicContext, targetAsgCard);
              if (verifiedRow) {
                const exactMatch = assignments.filter(a => Number(a.id) === Number(verifiedRow.id));
                if (exactMatch.length > 0) assignments = exactMatch;
              }
            }
          }
          const totalMatchedCount = assignments.length;
          const isCallerStudent = ['student', 'cr'].includes(academicContext?.role) && !targetSemester && !otherSemesterOnly;

          const submittedAssignments = assignments.filter(a => a.studentSubmission?.submitted);
          const checkedAssignments = assignments.filter(a => a.studentSubmission?.checked);
          const gradedAssignments = assignments.filter(a => a.studentSubmission?.hasReleasedGrades);
          const pendingReviewAssignments = assignments.filter(a => a.studentSubmission?.submitted && !a.studentSubmission?.checked);
          const unsubmittedAssignments = assignments.filter(a => !a.studentSubmission?.submitted);
          const missedAssignments = assignments.filter(a => a.isMissed);
          const upcomingAssignments = assignments.filter(a => a.isUpcoming);

          const bySubject = {};
          for (const a of assignments) {
            const subj = a.subject || 'General';
            if (!bySubject[subj]) {
              bySubject[subj] = { total: 0, submitted: 0, checked: 0, missed: 0, upcoming: 0 };
            }
            bySubject[subj].total += 1;
            if (a.studentSubmission?.submitted) bySubject[subj].submitted += 1;
            if (a.studentSubmission?.checked) bySubject[subj].checked += 1;
            if (a.isMissed) bySubject[subj].missed += 1;
            if (a.isUpcoming) bySubject[subj].upcoming += 1;
          }

          let displayAssignments = assignments;
          if (isUnsubmittedFilter && isCallerStudent) {
            displayAssignments = unsubmittedAssignments;
          }

          result = {
            assignments: displayAssignments,
            allSemesterAssignments: assignments,
            count: displayAssignments.length,
            totalCount: assignments.length,
            submittedCount: submittedAssignments.length,
            checkedCount: checkedAssignments.length,
            gradedCount: gradedAssignments.length,
            pendingReviewCount: pendingReviewAssignments.length,
            unsubmittedCount: unsubmittedAssignments.length,
            missedCount: missedAssignments.length,
            upcomingCount: upcomingAssignments.length,
            bySubject,
            checkedAssignments,
            missedAssignments,
            upcomingAssignments,
            unsubmittedAssignments,
            unsubmittedOnly: isUnsubmittedFilter,
            isCheckedFilter,
            isMissedFilter,
            isCountFilter,
            query: rawMsg,
            allSubmitted: isUnsubmittedFilter && totalMatchedCount > 0 && displayAssignments.length === 0,
            viewerSemester: authorizedSemester
          };
        } catch (e) {
          result = { assignments: [], count: 0, error: 'Could not search assignments right now.' };
        }
      }
    }
    result = sanitizeUntrustedValue(result);
    results.push({ name, result });
    return result;
  }
  return { executeTool, results };
}

function formatAttendanceStatusLabel(percentage, totalSessions) {
  const total = Number(totalSessions || 0);
  if (total <= 0) return 'No records';
  const pct = Number(percentage);
  if (!Number.isFinite(pct)) return 'No records';
  return pct < 50 ? 'Low Attendance' : 'Recorded';
}

function formatEligibilityLabel(item, thresholdArg) {
  // Retained only as a legacy export; attendance responses never output exam eligibility.
  if (typeof item === 'number') {
    const total = thresholdArg !== undefined ? 1 : 0;
    return formatAttendanceStatusLabel(item, total);
  }
  if (!item) return 'No records';
  const total = Number(item.totalSessions ?? item.totalClasses ?? 0);
  if (total <= 0 || item.percentageAvailable === false) return 'No records';
  const pct = Number(item.attendancePercentage ?? item.overallPercentage ?? ((Number(item.presentCount || 0) / total) * 100));
  return formatAttendanceStatusLabel(pct, total);
}

function buildAttendanceProgressBar(percentage) {
  const num = Number(percentage);
  if (!Number.isFinite(num)) return '';
  const filled = Math.max(0, Math.min(10, Math.round(num / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function computeSafePercentage(present, total, explicitPct) {
  const t = Number(total || 0);
  if (t <= 0) return null;
  const p = Number(present || 0);
  if (explicitPct !== null && explicitPct !== undefined && Number.isFinite(Number(explicitPct))) {
    return Math.round(Number(explicitPct) * 100) / 100;
  }
  return Math.round((p / t) * 10000) / 100;
}

function parseAttendanceBlock(rawBlock) {
  const lines = String(rawBlock || '').replace(/\r\n/g, '\n').split('\n');
  const data = {
    hasOverview: false,
    hasRecords: false,
    semester: null,
    overallPct: null,
    isLow: false,
    attendedLabel: '0 / 0',
    present: 0,
    absent: 0,
    totalClasses: 0,
    recordedSubjects: 0,
    totalSubjects: 0,
    recordedItems: [],
    unrecordedItems: []
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^Overview:/i.test(line)) {
      data.hasOverview = true;
      const parts = line.replace(/^Overview:\s*/i, '').split('|').map(p => p.trim());
      const first = parts[0] || '';
      if (/No records/i.test(first)) {
        data.hasRecords = false;
        data.overallPct = null;
        data.isLow = false;
      } else {
        const pctMatch = first.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          data.hasRecords = true;
          data.overallPct = Number(pctMatch[1]);
          data.isLow = data.overallPct < 50 || /Low Attendance/i.test(first);
        }
      }
      for (const part of parts.slice(1)) {
        const attMatch = part.match(/^(\d+)\s*\/\s*(\d+)\s+classes/i);
        if (attMatch) {
          data.present = Number(attMatch[1]);
          data.totalClasses = Number(attMatch[2]);
          data.attendedLabel = `${attMatch[1]} / ${attMatch[2]}`;
          continue;
        }
        const presMatch = part.match(/^Present:\s*(\d+)/i);
        if (presMatch) {
          data.present = Number(presMatch[1]);
          continue;
        }
        const absMatch = part.match(/^Absent:\s*(\d+)/i);
        if (absMatch) {
          data.absent = Number(absMatch[1]);
          continue;
        }
        const subjMatch = part.match(/^(\d+)\s+of\s+(\d+)\s+subjects/i);
        if (subjMatch) {
          data.recordedSubjects = Number(subjMatch[1]);
          data.totalSubjects = Number(subjMatch[2]);
          continue;
        }
        const semMatch = part.match(/^Semester\s+(\d+)/i);
        if (semMatch) {
          data.semester = Number(semMatch[1]);
        }
      }
      continue;
    }

    const itemMatch = line.match(/^[-•*]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?:\s*(.+)$/);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const code = (itemMatch[2] || '').trim();
      const rest = itemMatch[3].trim();
      if (/\*\*No records\*\*|^No records$/i.test(rest)) {
        data.unrecordedItems.push({ name, code });
      } else {
        const pctMatch = rest.match(/\*\*(\d+(?:\.\d+)?)%\*\*|(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          const pct = Number(pctMatch[1] ?? pctMatch[2]);
          const isLow = pct < 50 || /Low Attendance/i.test(rest);
          const classesMatch = rest.match(/(\d+)\s+recorded\s+class/i) || rest.match(/out\s+of\s+(\d+)\s+class/i);
          const presMatch = rest.match(/Present:\s*(\d+)/i) || rest.match(/(\d+)\s+present/i);
          const absMatch = rest.match(/Absent:\s*(\d+)/i) || rest.match(/(\d+)\s+(?:missed\/)?absent/i);
          const present = presMatch ? Number(presMatch[1]) : 0;
          const absent = absMatch ? Number(absMatch[1]) : 0;
          const classes = classesMatch ? Number(classesMatch[1]) : (present + absent);
          data.recordedItems.push({
            name,
            code,
            pct,
            isLow,
            classes,
            present,
            absent
          });
        }
      }
    }
  }

  if (!data.hasOverview && (data.recordedItems.length > 0 || data.unrecordedItems.length > 0)) {
    const totalPres = data.recordedItems.reduce((acc, r) => acc + r.present, 0);
    const totalAbs = data.recordedItems.reduce((acc, r) => acc + r.absent, 0);
    const totalCls = data.recordedItems.reduce((acc, r) => acc + r.classes, 0);
    data.present = totalPres;
    data.absent = totalAbs;
    data.totalClasses = totalCls;
    data.attendedLabel = `${totalPres} / ${totalCls}`;
    data.recordedSubjects = data.recordedItems.length;
    data.totalSubjects = data.recordedItems.length + data.unrecordedItems.length;
    if (totalCls > 0) {
      data.hasRecords = true;
      data.overallPct = Math.round((totalPres / totalCls) * 10000) / 100;
      data.isLow = data.overallPct < 50;
    }
  }

  return data;
}

/**
 * Rewrites formal notice or post text into natural, conversational, own-words prose
 * instead of dumping the raw bureaucratic announcement body verbatim, while keeping all factual details intact.
 */
function paraphraseAppRecordInOwnWords(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^(?:Date\s*:\s*[^\r\n]+\r?\n?)?/i, '')
    .replace(/^(?:Subject|Title)\s*:\s*[^\r\n]+\r?\n?/im, '')
    .replace(/\r?\n\s*(?:Your cooperation and punctuality are highly appreciated\.?)\s*/gi, ' ')
    .replace(/\r?\n\s*(?:BIT Department\s*\r?\n?\s*Gandaki University)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  let rewritten = cleaned
    .replace(/^This is to inform all (?:BIT )?students that\s+/i, 'all BIT students are informed that ')
    .replace(/^This is an? (?:official )?notice (?:to inform (?:you )?that\s+)?/i, '')
    .replace(/\bAll students are requested to\b/gi, 'Make sure you')
    .replace(/\bStudents are also advised to\b/gi, 'You should also');

  return rewritten;
}

function formatToolResult(name, result) {
  if (result.clarification) return result.clarification;
  if (result.error) return result.error;
  if (name === 'search_notes') {
    if (!result.files || !result.files.length) return 'No matching notes found. Which subject or topic should I try?';
    const topFile = result.files[0];
    const formatChap = ch => ch ? (/^(?:chapter|unit)\b/i.test(String(ch).trim()) ? String(ch).trim() : `Chapter ${ch}`) : '';
    const formatSem = sem => sem ? `, ${/^semester\b/i.test(String(sem).trim()) ? String(sem).trim() : `Semester ${sem}`}` : '';
    const folderLabel = topFile.folderPath
      ? ` (Folder: ${topFile.folderPath}${formatSem(topFile.semester)})`
      : (topFile.semester ? ` (${formatSem(topFile.semester).replace(/^,\s*/, '')})` : '');
    if (topFile.extractedContent) {
      const citation = topFile.sourceCitation
        ? `${topFile.sourceCitation}:`
        : (topFile.chapter
            ? `This is extracted from **${topFile.title}** (${topFile.subject || 'General'}${formatSem(topFile.semester)}, ${formatChap(topFile.chapter)}):`
            : `This is extracted from **${topFile.title}** (${topFile.subject || 'General'}${formatSem(topFile.semester)}):`);
      let text = `Found note: **${topFile.title}**${folderLabel}\n\n${citation}\n\n${topFile.extractedContent}`;
      if (result.files.length > 1) {
        text += `\n\n**Other shortlisted files:**\n` + result.files.slice(1).map(f => `- **${f.title}** (${f.subject || 'General'}${formatSem(f.semester)}${f.chapter ? `, ${formatChap(f.chapter)}` : ''})`).join('\n');
      }
      return text;
    }
    const fileLines = result.files.map(f => `- **${f.title}** (${f.subject || 'General'}${formatSem(f.semester)}${f.chapter ? `, ${formatChap(f.chapter)}` : ''}${f.folderPath ? ` | Folder: ${f.folderPath}` : ''})`).join('\n');
    return (result.inferredSubject ? `Closest match: **${result.inferredSubject}** notes:\n\n` : `Found ${result.files.length === 1 ? '1 matching note' : `${result.files.length} matching notes`}:\n\n`) + fileLines;
  }
  if (name === 'read_note_file') {
    if (result.error) return result.error;
    if (!result.hasContent) return `Could not read inside **${result.title}** (${result.message || 'scanned or empty document'}).`;
    const citation = result.sourceCitation ? `${result.sourceCitation}:` : `This is extracted from **${result.title}**:`;
    const folderLine = result.folderPath ? `\n**Folder:** ${result.folderPath}` : '';
    return `### ${result.title}${folderLine}\n\n${citation}\n\n${result.extractedContent}`;
  }
  if (name === 'get_routine') {
    if (!result.routine.length) {
      if (Array.isArray(result.relatedNotices) && result.relatedNotices.length > 0) {
        const noticeSummary = formatToolResult('search_notices', {
          notices: result.relatedNotices,
          count: result.relatedNotices.length,
          viewerSemester: result.semester
        });
        const prefix = result.dateFilter
          ? `No examination is scheduled in the routine table for ${result.dateFilter} in Semester ${result.semester}, but here is a related official notice:\n\n`
          : `No structured routine is published in the timetable for Semester ${result.semester} yet, but here is a related official notice:\n\n`;
        return prefix + noticeSummary;
      }
      if (result.dateFilter) {
        return `No examination scheduled for ${result.dateFilter} in Semester ${result.semester}.`;
      }
      return `No routine is published for semester ${result.semester} yet.`;
    }
    return `**Semester ${result.semester} routine**\n\n` + result.routine.map(r => `- **${r.subject}** — ${r.date} ${r.calendar || '(calendar unconfirmed)'}${r.day ? ` (${r.day})` : ''}${r.time ? `, ${r.time}` : ''}${r.room ? `, Room ${r.room}` : ''}`).join('\n');
  }
  if (name === 'get_syllabus') {
    if (!result.courses.length) return `No matching syllabus found${result.semester ? ` for semester ${result.semester}` : ''}.`;
    if (result.allSemesters && !result.semester) {
      const grouped = new Map();
      for (const c of result.courses) {
        const semNo = c.semesterNo || semesterNumber(c.semester) || 1;
        if (!grouped.has(semNo)) grouped.set(semNo, []);
        grouped.get(semNo).push(c);
      }
      const sections = [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([semNo, semCourses]) => {
          const lines = semCourses.map(c => `- **${c.title}** (${c.code}) — ${c.credit} credits`);
          return `**Semester ${semNo} Syllabus**\n${lines.join('\n')}`;
        });
      return `**BIT All-Semesters Syllabus (Semesters 1–8)**\n\n` + sections.join('\n\n') + `\n\n[Full syllabus](/syllabus.html)`;
    }
    const syllabusLink = `[Full syllabus](/syllabus.html#${encodeURIComponent(`Year ${Math.ceil(result.semester / 2)}`)}/${encodeURIComponent(ROMANS[result.semester - 1])})`;

    // Detailed subject or unit breakdown when a specific subject or unit is requested (or single course matched)
    if (result.requestedSubject || result.requestedUnit || result.courses.length === 1) {
      const sections = result.courses.map(c => {
        const details = c.syllabusDetails || parseSyllabusCourseDetails(c);
        const teacherInfo = Array.isArray(c.assignedTeachers) && c.assignedTeachers.length > 0
          ? ` — Taught by: ${c.assignedTeachers.join(', ')}`
          : '';
        const natureInfo = c.nature ? `, Nature: ${c.nature}` : '';
        const lines = [
          `**${c.title}** (${c.code}) — ${c.credit} credits (Semester ${result.semester}${natureInfo})${teacherInfo}`
        ];

        if (details.objectives) {
          lines.push(`\n**Learning Objectives:**\n${details.objectives}`);
        }

        const targetUnits = result.requestedUnit
          ? details.units.filter(u => Number(u.unitNumber) === Number(result.requestedUnit))
          : details.units;

        if (targetUnits.length > 0) {
          lines.push(`\n**${result.requestedUnit ? `Unit ${result.requestedUnit}` : 'Course Units & Contents'}:**`);
          for (const u of targetUnits) {
            const hrsLabel = u.teachingHours ? ` (${u.teachingHours})` : '';
            lines.push(`- **Unit ${u.unitNumber}: ${u.title}**${hrsLabel}${u.topics ? `\n  Topics: ${u.topics}` : ''}`);
          }
        } else if (c.contents) {
          lines.push(`\n**Contents:**\n${cleanSyllabusText(c.contents)}`);
        }

        if (details.lab) {
          lines.push(`\n**Lab Requirements:**\n${details.lab}`);
        }
        if (details.textbooks) {
          lines.push(`\n**Textbooks & References:**\n${details.textbooks}`);
        }
        return lines.join('\n');
      });
      return sections.join('\n\n') + `\n\n${syllabusLink}`;
    }

    return `**Semester ${result.semester} syllabus**\n\n` + result.courses.map(c => {
      const teacherInfo = Array.isArray(c.assignedTeachers) && c.assignedTeachers.length > 0
        ? ` — Taught by: ${c.assignedTeachers.join(', ')}`
        : '';
      return `- **${c.title}** (${c.code}) — ${c.credit} credits${teacherInfo}`;
    }).join('\n') + `\n\n${syllabusLink}`;
  }
  if (name === 'get_my_attendance') {
    if (result.attendance && result.marks && result.assignments) {
      return formatToolResult('get_teacher_classroom_summary', result);
    }
    const rawOv = result.overall || result.overallSummary || null;
    if (result.academicStatus === 'unassigned' || (!rawOv && !Array.isArray(result.subjects))) {
      return 'Your account is not assigned to an active cohort yet, so no attendance records are available.';
    }

    const rawSubjects = Array.isArray(result.subjects) ? result.subjects : [];
    const normalizedSubjects = rawSubjects.map(s => {
      const name = s.name || s.subjectName || 'Subject';
      const code = s.code || s.subjectCode || '';
      const total = Number(s.totalSessions ?? s.totalClasses ?? 0);
      const present = Number(s.presentCount ?? s.attendedClasses ?? 0);
      const absent = Number(s.absentCount ?? s.missedClasses ?? Math.max(0, total - present));
      const pct = total > 0 ? computeSafePercentage(present, total, s.attendancePercentage) : null;
      return {
        ...s,
        name,
        code,
        totalSessions: total,
        presentCount: present,
        absentCount: absent,
        attendancePercentage: pct,
        isLow: total > 0 && pct !== null && pct < 50
      };
    });

    const subjectsWithRecords = normalizedSubjects.filter(s => s.totalSessions > 0);
    const subjectsWithoutRecords = normalizedSubjects.filter(s => s.totalSessions <= 0);
    const totalSubjectsCount = normalizedSubjects.length;
    const recordedSubjectsCount = subjectsWithRecords.length;
    const hasIncompleteSubjects = recordedSubjectsCount > 0 && subjectsWithoutRecords.length > 0;

    const sumPresent = subjectsWithRecords.reduce((acc, s) => acc + s.presentCount, 0);
    const sumAbsent = subjectsWithRecords.reduce((acc, s) => acc + s.absentCount, 0);
    const sumTotal = subjectsWithRecords.reduce((acc, s) => acc + s.totalSessions, 0);

    const ovTotal = Number(rawOv?.totalSessions ?? rawOv?.totalClasses ?? sumTotal);
    const ovPresent = Number(rawOv?.presentCount ?? rawOv?.attendedClasses ?? sumPresent);
    const ovAbsent = Number(rawOv?.absentCount ?? rawOv?.missedClasses ?? sumAbsent);
    const ovPct = ovTotal > 0 ? computeSafePercentage(ovPresent, ovTotal, rawOv?.attendancePercentage ?? rawOv?.overallPercentage) : null;
    const ovIsLow = ovTotal > 0 && ovPct !== null && ovPct < 50;
    const semNum = result.semesterNo || rawOv?.semester || '';

    const rawQuery = String(result.query || '').trim();
    const query = rawQuery.toLowerCase();
    const { parseNepaliDateExpression } = require('./nepali-dates');
    const dateInfo = result.dateInfo || parseNepaliDateExpression(rawQuery);

    // 1. Specific Date Presence Inquiry: "was I present on November 2", "did I attend class yesterday", etc.
    let targetDate = dateInfo?.date || null;
    if (!targetDate) {
      const isoMatch = query.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (isoMatch) targetDate = isoMatch[1];
    }
    if (!targetDate) {
      const monthMatch = query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i);
      if (monthMatch) {
        const mNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const mIndex = mNames.indexOf(monthMatch[1].toLowerCase()) + 1;
        const dayNum = String(monthMatch[2]).padStart(2, '0');
        const mStr = String(mIndex).padStart(2, '0');
        const yr = (result.allSessions?.[0]?.sessionDate || result.recentHistory?.[0]?.sessionDate || new Date().toISOString()).slice(0, 4);
        targetDate = `${yr}-${mStr}-${dayNum}`;
      }
    }

    const isDatePresenceQuery = Boolean(
      targetDate ||
      /\b(was\s+i\s+(?:present|absent)|am\s+i\s+(?:marked\s+)?(?:present|absent)|did\s+i\s+(?:miss|attend)\s+(?:class|classes)?|present\s+thiye|absent\s+thiye|present\s+vaye|absent\s+bhae|present\s+or\s+not|present\s+or\s+absent|on\s+this\s+date|yo\s+date\s+ma|aaja|bholi|hijo|yesterday|today|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(query)
    );

    const isNepaliQuery = /\b(mero|hamro|kati|kasto|kaile|kahile|cha|xa|chha|ho|deu|dekhau|dekhauna|hajir|hazir|gare|thiye|vaye)\b|[\u0900-\u097F]/i.test(rawQuery);
    const asksRecentHistory = /\b(recent|history|dates?|sessions?|log|when\s+was|kaile|which\s+days)\b/i.test(query);

    if (isDatePresenceQuery && targetDate) {
      const sessions = (result.sessionsByDate && result.sessionsByDate[targetDate]) ||
        (result.allSessions || []).filter(s => s.sessionDate === targetDate);
      const dateDisplay = dateInfo?.label || targetDate;
      if (sessions.length > 0) {
        const presentList = sessions.filter(s => s.status === 'present');
        const absentList = sessions.filter(s => s.status === 'absent');
        const lines = [];
        if (absentList.length === 0) {
          lines.push(`**Yes, on ${dateDisplay}, you were marked Present in all recorded classes.**`);
        } else if (presentList.length === 0) {
          lines.push(`**On ${dateDisplay}, you were marked Absent in all recorded classes:**`);
        } else {
          lines.push(`**Attendance on ${dateDisplay}:**`);
        }
        for (const s of sessions) {
          const statusText = s.status === 'present' ? 'Present' : 'Absent';
          lines.push(`- **${s.subjectName}** (${s.subjectCode}): **${statusText}**`);
        }
        return lines.join('\n');
      }
      return `No class attendance was recorded on **${dateDisplay}** (no classes were scheduled or recorded on this date).`;
    }

    // 2. Absence / Missed Classes Inquiry: "which classes did I miss", "which days was I absent"
    const isAbsenceQuery = !result.matchedSubject && /\b(which\s+(?:classes?|days?|din)\s+(?:did\s+i\s+miss|was\s+i\s+absent)|missed\s+classes?|absent\s+classes?|kaile\s+kaile\s+absent|chuteko\s+class|days\s+(?:was\s+i\s+)?absent|classes\s+(?:did\s+i\s+)?miss)\b/i.test(query);
    if (isAbsenceQuery) {
      if (ovTotal === 0) {
        return `No attendance records are available for Semester ${semNum} yet (**No records**).`;
      }
      if (ovAbsent === 0) {
        return `You have not missed any recorded classes so far — **100% attendance** (${ovPresent}/${ovTotal} classes attended, 0 absent).`;
      }
      const lines = [];
      lines.push(`You have missed **${ovAbsent}** recorded class${ovAbsent === 1 ? '' : 'es'} in Semester ${semNum} (${ovPresent} present, ${ovAbsent} missed/absent out of ${ovTotal} recorded classes):`);
      const absentList = Array.isArray(result.absentSessions) ? result.absentSessions : (result.allSessions || []).filter(s => s.status === 'absent');
      for (const sess of absentList) {
        lines.push(`- **${sess.sessionDate}**: **${sess.subjectName}** (${sess.subjectCode}) — Absent`);
      }
      return lines.join('\n');
    }

    // 3. Specific Subject Attendance Inquiry: "what is my attendance in DBMS", "DBMS ma kati class miss gare?"
    if (result.matchedSubject) {
      const rawSub = result.matchedSubject;
      const subName = rawSub.name || rawSub.subjectName || 'Subject';
      const subCode = rawSub.code || rawSub.subjectCode || '';
      const subSem = rawSub.semester || semNum || '';
      const total = Number(rawSub.totalSessions ?? rawSub.totalClasses ?? 0);
      const present = Number(rawSub.presentCount ?? rawSub.attendedClasses ?? 0);
      const absent = Number(rawSub.absentCount ?? rawSub.missedClasses ?? Math.max(0, total - present));

      if (total === 0) {
        return [
          `**${subName} (${subCode}) — Semester ${subSem}:** **No records** (no classes have been recorded for this subject yet).`,
          '',
          '```attendance',
          `Overview: No records | 0/0 classes attended | Present: 0 | Absent: 0 | 0 of 1 subjects recorded | Semester ${subSem}`,
          `- **${subName}** (${subCode}): **No records**`,
          '```'
        ].join('\n');
      }

      const subPct = computeSafePercentage(present, total, rawSub.attendancePercentage);
      const isLow = subPct !== null && subPct < 50;
      const lowLabel = isLow ? ' — **Low Attendance**' : '';
      const lines = [
        `**${subName} (${subCode}) — Semester ${subSem} Attendance:** ${subPct}% (${present} present, ${absent} missed/absent out of ${total} classes)${lowLabel}.`,
        '',
        '```attendance',
        `Overview: ${subPct}%${isLow ? ' (Low Attendance)' : ''} | ${present}/${total} classes attended | Present: ${present} | Absent: ${absent} | 1 of 1 subjects recorded | Semester ${subSem}`,
        `- **${subName}** (${subCode}): **${subPct}%**${isLow ? ' — Low Attendance' : ''} | ${total} recorded ${total === 1 ? 'class' : 'classes'} | Present: ${present} | Absent: ${absent}`,
        '```'
      ];
      if (asksRecentHistory) {
        const subSessions = (result.allSessions || []).filter(s => s.subjectId === rawSub.subjectId || s.subjectCode === subCode);
        if (subSessions.length > 0) {
          lines.push(`\n**Recent Classes in ${subName}:**`);
          for (const sess of subSessions.slice(0, 5)) {
            lines.push(`- **${sess.sessionDate}**: ${sess.status === 'present' ? 'Present' : 'Absent'}`);
          }
        }
      }
      return lines.join('\n');
    }

    // 4. Overall & Subject-Wise Attendance Report (Visual Overview + Horizontal Bar Chart + Other Subjects)
    const lines = [];
    const hasAnySessions = ovTotal > 0;

    if (!hasAnySessions) {
      lines.push(
        isNepaliQuery
          ? `Semester ${semNum} ko kunai pani subject ma attendance record bhayeko chaina (**No records**).${totalSubjectsCount > 0 ? ` Sabai ${totalSubjectsCount} subjects ma **No records** cha.` : ''}`
          : `No attendance records are available for Semester ${semNum} yet (**No records**${totalSubjectsCount > 0 ? ` across all ${totalSubjectsCount} subjects` : ''}).`
      );
      lines.push('');
      lines.push('```attendance');
      lines.push(`Overview: No records | 0/0 classes attended | Present: 0 | Absent: 0 | 0 of ${totalSubjectsCount} subjects recorded | Semester ${semNum}`);
      for (const s of normalizedSubjects) {
        lines.push(`- **${s.name}** (${s.code}): **No records**`);
      }
      lines.push('```');
      return lines.join('\n');
    }

    const lowHeadlineTag = ovIsLow ? ' (**Low Attendance**)' : '';
    if (hasIncompleteSubjects) {
      const subjPhrase = recordedSubjectsCount === 1
        ? `Only **1 of ${totalSubjectsCount} subjects** (${subjectsWithRecords[0].name}) has recorded attendance so far.`
        : `Only **${recordedSubjectsCount} of ${totalSubjectsCount} subjects** have recorded attendance so far.`;
      lines.push(
        isNepaliQuery
          ? `Semester ${semNum} ma timro overall recorded attendance **${ovPct}%** cha${lowHeadlineTag}, **${ovTotal}** recorded ${ovTotal === 1 ? 'class' : 'classes'} ma (${ovPresent} present, ${ovAbsent} missed/absent out of ${ovTotal} total classes). ${subjPhrase}`
          : `Your overall recorded attendance in Semester ${semNum} is **${ovPct}%**${lowHeadlineTag}, based on **${ovTotal}** recorded ${ovTotal === 1 ? 'class' : 'classes'} (${ovPresent} present, ${ovAbsent} missed/absent out of ${ovTotal} total classes). ${subjPhrase}`
      );
    } else {
      lines.push(
        isNepaliQuery
          ? `Semester ${semNum} ma timro overall attendance **${ovPct}%** cha${lowHeadlineTag} (${ovPresent} present, ${ovAbsent} missed/absent out of ${ovTotal} total classes).`
          : `Your overall attendance in Semester ${semNum} is **${ovPct}%**${lowHeadlineTag} across **${ovTotal}** recorded ${ovTotal === 1 ? 'class' : 'classes'} (${ovPresent} present, ${ovAbsent} missed/absent out of ${ovTotal} total classes).`
      );
    }

    lines.push('');
    lines.push('```attendance');
    lines.push(
      `Overview: ${ovPct}%${ovIsLow ? ' (Low Attendance)' : ''} | ${ovPresent}/${ovTotal} classes attended | Present: ${ovPresent} | Absent: ${ovAbsent} | ${recordedSubjectsCount} of ${totalSubjectsCount || recordedSubjectsCount} subjects recorded | Semester ${semNum}`
    );

    for (const s of subjectsWithRecords) {
      const lowTag = s.isLow ? ' — Low Attendance' : '';
      lines.push(
        `- **${s.name}** (${s.code}): **${s.attendancePercentage}%**${lowTag} | ${s.totalSessions} recorded ${s.totalSessions === 1 ? 'class' : 'classes'} | Present: ${s.presentCount} | Absent: ${s.absentCount}`
      );
    }

    for (const s of subjectsWithoutRecords) {
      lines.push(`- **${s.name}** (${s.code}): **No records**`);
    }
    lines.push('```');

    if (asksRecentHistory) {
      const recentSess = (result.recentHistory && result.recentHistory.length > 0)
        ? result.recentHistory
        : (result.allSessions ? result.allSessions.slice(0, 5) : []);
      if (recentSess.length > 0) {
        lines.push('\n**Recent Class Attendance:**');
        for (const sess of recentSess.slice(0, 5)) {
          lines.push(`- **${sess.sessionDate}**: ${sess.subjectName || sess.subjectCode} — ${sess.status === 'present' ? 'Present' : 'Absent'}`);
        }
      }
    }
    return lines.join('\n');
  }
  if (name === 'get_my_results') {
    if (result.attendance && result.marks && result.assignments) {
      return formatToolResult('get_teacher_classroom_summary', result);
    }
    if (result.error) return result.error;

    const allPub = Array.isArray(result.allResults) ? result.allResults : (Array.isArray(result.results) ? result.results : []);
    if (!result.hasPublishedResults || allPub.length === 0) {
      const scopeParts = [];
      if (result.requestedExamType) scopeParts.push(`**${result.requestedExamType}**`);
      if (result.requestedSubject) scopeParts.push(`**${result.requestedSubject}**`);
      if (result.requestedSemester) scopeParts.push(`**Semester ${result.requestedSemester}**`);
      const scopeDesc = scopeParts.length > 0 ? ` for ${scopeParts.join(' in ')}` : '';
      return `No published exam results were found${scopeDesc} yet. Results appear here only after they are officially published by your teachers or college administration.`;
    }

    const lines = [];

    // Helper for formatting an exam line
    const formatExamLine = (r, { showSemester = false } = {}) => {
      const scoreText = r.isAbsent
        ? `Absent (Max: ${r.maxMarks})`
        : `${r.obtainedMarks} / ${r.maxMarks} (${r.formattedPercentage || `${r.percentage}%`})`;
      const semTag = showSemester && r.semesterNo ? ` (Semester ${r.semesterNo})` : '';
      return `- **${r.subjectName}** (${r.subjectCode}) — *${r.examType}*: **${scoreText}**${semTag}`;
    };

    // 1. Highest Marks Query (e.g. "aaile samma mero sabai vanda dheari k ma aaxa", "yo semester ma sabai bata dherai k ma aaxa")
    if (result.isHighestQuery) {
      if (result.highestList && result.highestList.length > 0) {
        const title = result.isCurrentSemQuery
          ? `**Highest Marks in Semester ${result.currentSemesterNo}:**`
          : (result.requestedSemester
              ? `**Highest Marks in Semester ${result.requestedSemester}:**`
              : `**Your Highest Marks Scored Till Now:**`);
        lines.push(title);
        for (const h of result.highestList) {
          lines.push(formatExamLine(h, { showSemester: !result.isCurrentSemQuery && !result.requestedSemester }));
        }
        return lines.join('\n');
      } else {
        const semDesc = result.isCurrentSemQuery ? ` in Semester ${result.currentSemesterNo}` : '';
        return `No published exam marks found${semDesc} to determine the highest score.`;
      }
    }

    // 2. Lowest Marks Query (e.g. "k ma kam aaxa", "yo semester ma sabai vanda kam k ma aaxa")
    if (result.isLowestQuery) {
      if (result.lowestList && result.lowestList.length > 0) {
        const title = result.isCurrentSemQuery
          ? `**Lowest Marks in Semester ${result.currentSemesterNo}:**`
          : (result.requestedSemester
              ? `**Lowest Marks in Semester ${result.requestedSemester}:**`
              : `**Your Lowest Marks Scored Till Now:**`);
        lines.push(title);
        for (const l of result.lowestList) {
          lines.push(formatExamLine(l, { showSemester: !result.isCurrentSemQuery && !result.requestedSemester }));
        }
        return lines.join('\n');
      } else {
        const semDesc = result.isCurrentSemQuery ? ` in Semester ${result.currentSemesterNo}` : '';
        return `No published exam marks found${semDesc} to determine the lowest score.`;
      }
    }

    // 3. Top N Highest Marks Ranking (e.g. "list down mero top 10 highest mark till now")
    if (result.topN != null) {
      const topItems = result.topNList || [];
      if (topItems.length > 0) {
        const count = Math.min(result.topN, topItems.length);
        lines.push(`**Top ${count} Highest Marks Till Now:**\n`);
        topItems.slice(0, count).forEach((item, idx) => {
          const scoreText = item.isAbsent
            ? `Absent (Max: ${item.maxMarks})`
            : `${item.obtainedMarks} / ${item.maxMarks} (${item.formattedPercentage || `${item.percentage}%`})`;
          lines.push(`${idx + 1}. **${item.subjectName}** (${item.subjectCode}): **${scoreText}** — *${item.examType}* (Semester ${item.semesterNo})`);
        });
        return lines.join('\n');
      } else {
        return `No published exam marks found to rank top scores.`;
      }
    }

    // 4. Target Score Lookup (e.g. "mero 30 k k ma aaxaa aaile samma")
    if (result.targetScore != null) {
      if (result.exactScoreMatches && result.exactScoreMatches.length > 0) {
        lines.push(`**Exams where you scored ${result.targetScore} marks:**\n`);
        for (const ex of result.exactScoreMatches) {
          lines.push(formatExamLine(ex, { showSemester: true }));
        }
        return lines.join('\n');
      } else {
        lines.push(`You haven't scored exactly **${result.targetScore} marks** in any published exam.`);
        if (result.closeScoreMatches && result.closeScoreMatches.length > 0) {
          lines.push(`\n**Closest published scores around ${result.targetScore}:**`);
          for (const cl of result.closeScoreMatches) {
            lines.push(formatExamLine(cl, { showSemester: true }));
          }
        }
        return lines.join('\n');
      }
    }

    // 5. Pass / Fail Query (e.g. "did I fail in any subject", "backlogs")
    if (result.isPassFailQuery) {
      if (result.failedExams && result.failedExams.length > 0) {
        lines.push(`**Exam Backlogs / Failed Subjects (${result.failedExams.length}):**\n`);
        for (const f of result.failedExams) {
          lines.push(formatExamLine(f, { showSemester: true }));
        }
      } else {
        lines.push(`**Exam Clearance Status:** You have **passed all published exams** with zero backlogs! 🎉`);
      }
      return lines.join('\n');
    }

    // 6. Last Semester Results (e.g. "what was my marks in last semester")
    if (result.isPrevSemQuery) {
      const filtered = Array.isArray(result.filteredResults) ? result.filteredResults : [];
      if (filtered.length === 0) {
        return `No published exam results were found for **Semester ${result.requestedSemester}** (last semester) yet.`;
      }
      lines.push(`**Your Semester ${result.requestedSemester} (Last Semester) Exam Results:**\n`);
      for (const r of filtered) {
        lines.push(formatExamLine(r, { showSemester: false }));
      }
      const semObj = Array.isArray(result.semesters) ? result.semesters.find(s => Number(s.semesterNo) === Number(result.requestedSemester)) : null;
      if (semObj?.summary?.formattedOverallPercentage || semObj?.summary?.formattedAggregatePercentage) {
        const pct = semObj.summary.formattedOverallPercentage || semObj.summary.formattedAggregatePercentage;
        lines.push(`\n**Semester ${result.requestedSemester} Aggregate:** ${semObj.summary.totalObtainedMarks} / ${semObj.summary.totalMaxMarks} (${pct})`);
      }
      return lines.join('\n');
    }

    // 7. Filtered / Standard Lookup (Specific Subject, Exam Type, or Semester)
    const filtered = Array.isArray(result.filteredResults) ? result.filteredResults : allPub;
    if (filtered.length === 0) {
      const scopeParts = [];
      if (result.requestedExamType) scopeParts.push(`**${result.requestedExamType}**`);
      if (result.requestedSubject) scopeParts.push(`**${result.requestedSubject}**`);
      if (result.requestedSemester) scopeParts.push(`**Semester ${result.requestedSemester}**`);
      const scopeDesc = scopeParts.length > 0 ? ` for ${scopeParts.join(' in ')}` : '';
      return `No published exam results were found${scopeDesc} yet. Results appear here only after they are officially published.`;
    }

    const headerParts = [];
    if (result.requestedSubject) headerParts.push(result.requestedSubject);
    if (result.requestedExamType) headerParts.push(result.requestedExamType);
    if (result.requestedSemester && !result.requestedSubject) headerParts.push(`Semester ${result.requestedSemester}`);
    const headerTitle = headerParts.length > 0 ? headerParts.join(' ') : 'Published';

    lines.push(`**Your ${headerTitle} Exam Results:**\n`);
    for (const r of filtered) {
      lines.push(formatExamLine(r, { showSemester: !result.requestedSemester }));
    }

    // Include summary if relevant
    if (!result.requestedSubject && result.requestedSemester) {
      const semObj = Array.isArray(result.semesters) ? result.semesters.find(s => Number(s.semesterNo) === Number(result.requestedSemester)) : null;
      if (semObj?.summary?.formattedOverallPercentage || semObj?.summary?.formattedAggregatePercentage) {
        const pct = semObj.summary.formattedOverallPercentage || semObj.summary.formattedAggregatePercentage;
        lines.push(`\n**Semester ${result.requestedSemester} Aggregate:** ${semObj.summary.totalObtainedMarks} / ${semObj.summary.totalMaxMarks} (${pct})`);
      }
    } else if (!result.requestedSubject && !result.requestedExamType && !result.requestedSemester && result.summary?.formattedOverallPercentage) {
      lines.push(`\n**Overall Aggregate:** ${result.summary.totalObtainedMarks} / ${result.summary.totalMaxMarks} (${result.summary.formattedOverallPercentage})`);
    }

    return lines.join('\n');
  }
  if (name === 'get_academic_directory') {
    if (result.mode === 'subject_teachers' || result.mode === 'subject_detail') {
      const s = result.subject;
      const teachers = result.assignedTeachers || [];
      const teacherLine = teachers.length > 0
        ? teachers.map(t => `**${t.name}** (${t.designation || 'Instructor'})`).join(', ')
        : 'No teacher is currently assigned in the directory';
      const lines = [
        `**${s.name}** (${s.code || 'BIT'}) — Semester ${s.semester || '—'} (${s.creditHours || 3} credits)`,
        `- **Assigned Teacher(s):** ${teacherLine}`
      ];
      if (Array.isArray(result.chapters) && result.chapters.length > 0) {
        lines.push(`- **Available Chapters (${result.chapters.length}):** ${result.chapters.map(c => c.fileCount > 0 ? `${c.name} (${c.fileCount} file${c.fileCount === 1 ? '' : 's'})` : c.name).join(', ')}`);
      }
      return lines.join('\n');
    }
    if (result.mode === 'subject_chapters') {
      const s = result.subject;
      if (!result.chapters || result.chapters.length === 0) {
        return `No chapters were found for **${s.name}** (${s.code || ''}) yet.`;
      }
      const lines = [`**Available Chapters for ${s.name} (${s.code || `Semester ${s.semester}`})**\n`];
      for (const ch of result.chapters) {
        const countLabel = ch.fileCount > 0 ? ` — ${ch.fileCount} study material${ch.fileCount === 1 ? '' : 's'}` : '';
        lines.push(`- **${ch.name}**${countLabel}`);
      }
      return lines.join('\n');
    }
    if (result.mode === 'semester_subjects') {
      if (!result.subjects || result.subjects.length === 0) {
        return `No active subjects found for Semester ${result.semester}.`;
      }
      const lines = [`**Semester ${result.semester} Subjects**\n`];
      for (const s of result.subjects) {
        const tNames = Array.isArray(s.assignedTeachers) && s.assignedTeachers.length > 0
          ? ` — Teacher: ${s.assignedTeachers.map(t => t.name).join(', ')}`
          : '';
        lines.push(`- **${s.name}** (${s.code}) — ${s.creditHours} credits${tNames}`);
      }
      return lines.join('\n');
    }
    if (result.mode === 'teachers_directory') {
      if (!result.teachers || result.teachers.length === 0) {
        return 'No assigned faculty teachers were found in the directory.';
      }
      const lines = ['**Assigned Faculty Directory**\n'];
      for (const t of result.teachers) {
        const subText = (t.subjects || []).map(s => `${s.name} (${s.code}, Sem ${s.semester})`).join(', ') || 'No subjects assigned';
        lines.push(`- **${t.name}** (${t.designation || 'Instructor'}): ${subText}`);
      }
      return lines.join('\n');
    }
  }
  if (name === 'get_teacher_classroom_summary') {
    const att = result.attendance || { totalSessionsRecorded: 0, bySubject: [] };
    const mk = result.marks || { draftExamConfigsCount: 0, publishedExamConfigsCount: 0, configuredExams: [] };
    const asg = result.assignments || { totalAssignments: 0, totalPendingSubmissions: 0, totalSubmissionsCount: 0, totalReleasedGradesCount: 0, items: [] };

    const lines = ['**Teacher Classroom Summary**\n'];
    lines.push(`- **Pending Submissions Requiring Grading:** ${asg.totalPendingSubmissions} pending (out of ${asg.totalSubmissionsCount} total submissions across ${asg.totalAssignments} assignment${asg.totalAssignments === 1 ? '' : 's'}; ${asg.totalReleasedGradesCount} released)`);
    if (asg.items.length > 0) {
      for (const item of asg.items.slice(0, 5)) {
        lines.push(`  • **${item.title}** (${item.subject || 'General'}): ${item.pendingSubmissions} pending grading, ${item.releasedSubmissions} released (${item.distinctStudentsSubmitted} student${item.distinctStudentsSubmitted === 1 ? '' : 's'} submitted)`);
      }
    }
    lines.push(`- **Attendance Sessions Recorded:** ${att.totalSessionsRecorded} finalized session${att.totalSessionsRecorded === 1 ? '' : 's'}`);
    if (att.bySubject.length > 0) {
      for (const s of att.bySubject) {
        lines.push(`  • **${s.name}** (${s.code}, Sem ${s.semester}): ${s.sessionsRecorded} session${s.sessionsRecorded === 1 ? '' : 's'}${s.latestSessionDate ? ` (latest: ${s.latestSessionDate})` : ''}`);
      }
    }
    lines.push(`- **Exam Configurations:** ${mk.draftExamConfigsCount} draft, ${mk.publishedExamConfigsCount} published`);
    if (mk.configuredExams.length > 0) {
      for (const ex of mk.configuredExams) {
        lines.push(`  • **${ex.subjectName}** (${ex.subjectCode}) — *${ex.examType}*: **${ex.status}** (Max: ${ex.maxMarks}, Entered: ${ex.enteredCount}, Draft: ${ex.draftCount}, Published: ${ex.publishedCount})`);
      }
    }
    return lines.join('\n');
  }
  if (name === 'search_posts') {
    if (!result.posts || !result.posts.length) return 'No matching posts found.';
    return result.posts.map((p, idx) => {
      const paraphrased = paraphraseAppRecordInOwnWords(p.content || p.title);
      if (idx === 0) {
        return `Based on the campus post **${p.title}** by ${p.authorName || 'Campus User'}, ${paraphrased}`;
      }
      return `- Also in **${p.title}** by ${p.authorName || 'Campus User'}: ${paraphrased}`;
    }).join('\n\n');
  }
  if (name === 'search_notices') {
    const queryStr = String(result.query || '');
    const isNepaliQuery = /\b(hamro|kaile|kahile|bholi|voli|aaja|bida|chutti|hunxa|huncha|suru|khul|cha|xa|ho|kasto|ke|kina|bujha|vane)\b|[\u0900-\u097F]/i.test(queryStr);

    if (!result.notices || !result.notices.length) {
      if (Array.isArray(result.relatedPosts) && result.relatedPosts.length > 0) {
        const topPost = result.relatedPosts[0];
        const paraphrasedPost = paraphraseAppRecordInOwnWords(topPost.content || topPost.title);
        return isNepaliQuery
          ? `Official notice ta aako chaina, tara community post anusar: ${paraphrasedPost}`
          : `There's no official notice on this yet, but a community post mentions: ${paraphrasedPost}`;
      }
      if (Array.isArray(result.relatedRoutine) && result.relatedRoutine.length > 0) {
        return `No specific daily class notice was found for that date, but here is your published **Semester ${result.viewerSemester || ''} Examination Routine**:\n\n` +
          result.relatedRoutine.map(r => `- **${r.subject}** — ${r.date} ${r.calendar || 'BS'}${r.day ? ` (${r.day})` : ''}${r.time ? `, ${r.time}` : ''}${r.room ? `, Room ${r.room}` : ''}`).join('\n');
      }
      return 'No matching notices found.';
    }

    const { validateRetrievedEvidence } = require('./chat-grounding');
    const validation = result.evidenceValidation || validateRetrievedEvidence(queryStr, result.notices, { userSemester: result.viewerSemester });

    // 1. Deduplicate notices by ID or title
    const seenNoticeKeys = new Set();
    const dedupedNotices = [];
    for (const n of result.notices) {
      const key = `${n.id || ''}:${String(n.title || '').trim().toLowerCase()}`;
      if (seenNoticeKeys.has(key)) continue;
      seenNoticeKeys.add(key);
      dedupedNotices.push(n);
    }

    // 2. Filter superseded notices unless historical context explicitly requested
    const asksHistory = /\b(history|previous|purano|paila(?:ko)?|earlier|superseded|purnao)\b/i.test(queryStr);
    const activeNotices = asksHistory ? dedupedNotices : dedupedNotices.filter(n => !n.superseded);
    const effectiveNotices = activeNotices.length > 0 ? activeNotices : dedupedNotices;

    // Unless historical context was explicitly asked, strictly prioritize the LATEST news/notice first!
    if (!asksHistory && effectiveNotices.length > 1) {
      effectiveNotices.sort((a, b) => {
        const tierA = Number(a.authorityTier || (a.authorRole === 'admin' ? 1 : a.authorRole === 'teacher' ? 2 : a.authorRole === 'cr' ? 3 : 4));
        const tierB = Number(b.authorityTier || (b.authorRole === 'admin' ? 1 : b.authorRole === 'teacher' ? 2 : b.authorRole === 'cr' ? 3 : 4));
        const aOfficial = tierA <= 3;
        const bOfficial = tierB <= 3;
        if (aOfficial !== bOfficial) return aOfficial ? -1 : 1;

        const scoreA = Number(a._score || a.relevanceScore || 0);
        const scoreB = Number(b._score || b.relevanceScore || 0);
        if (Math.abs(scoreB - scoreA) >= 10) {
          return scoreB - scoreA;
        }

        const dateA = String(a.createdAt || a.created_at || a.publishedDate || '');
        const dateB = String(b.createdAt || b.created_at || b.publishedDate || '');
        if (dateA && dateB && dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }
        return (scoreB - scoreA) || (tierA - tierB);
      });
    }

    const prefixBlocks = [];
    if (validation.hasConflicts && validation.conflicts.length > 0) {
      const c = validation.conflicts[0];
      const datesDetail = (c.reason === 'contradictory_dates' && c.firstDates?.length && c.secondDates?.length)
        ? ` (dates ${c.firstDates.join(', ')} vs. ${c.secondDates.join(', ')})`
        : '';
      prefixBlocks.push(
        isNepaliQuery
          ? `⚠️ **Conflicting Announcements Detected:** **${c.firstTitle}** ra **${c.secondTitle}** bich conflicting information cha${datesDetail}. Department ko latest announcement verify garnu hola.`
          : `⚠️ **Conflicting Announcements Detected:** **${c.firstTitle}** and **${c.secondTitle}** contain conflicting information${datesDetail}. Please verify with the latest department announcement.`
      );
    }
    if (validation.hasOutdatedOnly) {
      const outdatedDate = validation.outdatedEventDate ? ` (${validation.outdatedEventDate})` : '';
      prefixBlocks.push(
        isNepaliQuery
          ? `⚠️ **Outdated Notice Warning:** Bhetiyeko notice purano date${outdatedDate} ko ho, ra aaja samma naya official notice aako chaina.`
          : `⚠️ **Outdated Notice Warning:** The matching notice refers to a past date${outdatedDate} that has already passed, and no newer official announcement has been published yet.`
      );
    }

    // 3. Ground answer in top/latest valid official notice (or earlier notice if asking history)
    const topNotice = asksHistory
      ? (dedupedNotices.find(n => n.superseded) || dedupedNotices[1] || dedupedNotices[0])
      : effectiveNotices[0];
    const fullText = `${topNotice.title || ''} ${topNotice.content || ''}`;

    // Check if query is an explicit request for the notice card/title/link/explanation
    const isExplicitNoticeRequest = asksHistory ||
      /\b(?:(?:ke|kun|kasto|what|which|any)\s+notice|show\s+(?:me\s+)?(?:the\s+)?notice|notice\s+(?:dekha|dekhau|her|link|card|title|kasto)|what\s+is\s+the\s+notice|which\s+notice|yo\s+notice|tyo\s+notice|this\s+notice|that\s+notice|meaning\s+ke\s+ho|meaning\s+of\b)/i.test(queryStr) ||
      (/\bnotice\b/i.test(queryStr) && !/\b(?:class(?:es)?|bida|chutti|exam(?:s)?|timetable|routine)\s+(?:kaile|suru|khul|start|resume)\b/i.test(queryStr) && !/\b(?:hamro\s+class\s+kaile|bida\s+sakiyo|class\s+kaile)\b/i.test(queryStr));

    // Check if notice refers to vacation resumption / schedule without specifying an exact calendar date
    const refersToScheduleWithoutExactDate = !asksHistory && (
      /\b(?:as\s+per\s+the\s+updated\s+academic\s+schedule|follow\s+the\s+timetable\s+provided\s+by\s+the\s+department|according\s+to\s+the\s+(?:updated\s+)?(?:schedule|timetable)|after\s+dashain|after\s+tihar|after\s+vacation|until\s+further\s+notice|will\s+resume|resumption\s+of\s+regular\s+classes)\b/i.test(fullText) ||
      validation.missingExactDate
    ) && !/\b(?:on|from)\s+(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/i.test(String(topNotice.content || ''));

    // Cross-semester indicator (conversational, not raw pipe metadata)
    const crossSemNote = (result.viewerSemester && topNotice.semesterNo && Number(topNotice.semesterNo) !== Number(result.viewerSemester))
      ? (isNepaliQuery
          ? ` (Yo notice Semester ${topNotice.semesterNo || topNotice.semester} ko lagi ho, timi Semester ${result.viewerSemester} ma registered xau.)`
          : ` (This notice concerns Semester ${topNotice.semesterNo || topNotice.semester} (you are registered in Semester ${result.viewerSemester}))`)
      : '';

    let conversationalReply = '';

    if (asksHistory) {
      const paraphrased = paraphraseAppRecordInOwnWords(topNotice.content || topNotice.title);
      conversationalReply = isNepaliQuery
        ? `Purano official notice (**"${topNotice.title}"**) anusar: ${paraphrased}.${crossSemNote}`
        : `According to the previous official notice (**"${topNotice.title}"**): ${paraphrased}.${crossSemNote}`;
    } else if (isExplicitNoticeRequest) {
      const authorPart = topNotice.authorName
        ? (topNotice.authorRole === 'teacher' ? `${topNotice.authorName} (Teacher)` : (topNotice.authorRole === 'admin' ? `${topNotice.authorName} (Admin)` : topNotice.authorName))
        : '';
      const authorPartNp = authorPart ? `${authorPart} le ` : '';
      const authorPartEn = authorPart ? ` by ${authorPart}` : '';
      const semLabel = topNotice.semester ? ` | Semester: ${topNotice.semester}` : '';
      const paraphrased = paraphraseAppRecordInOwnWords(topNotice.content || topNotice.title);

      conversationalReply = isNepaliQuery
        ? `${authorPartNp}**"${topNotice.title}"** notice publish garnu bhayeko cha: ${paraphrased}.${crossSemNote}`
        : `According to **"${topNotice.title}"**${authorPartEn}${semLabel}: ${paraphrased}.${crossSemNote}`;
    } else if (refersToScheduleWithoutExactDate) {
      conversationalReply = isNepaliQuery
        ? `University ko latest official notice anusar regular classes resume hune kura cha, tara exact starting date mention gareko chaina. Updated timetable publish bhayepachi confirm huncha.${crossSemNote}`
        : `According to the university's latest official notice, regular classes resume following vacation as per the updated academic schedule, but no exact starting date is stated in the notice. It will be confirmed once the updated department timetable is published.${crossSemNote}`;
    } else {
      // Natural conversational synthesis for specific dates or general notice topics
      const isClassResumption = /\b(class(?:es)?|padhai|kaksya|kakshya|regular\s+classes)\b/i.test(fullText) &&
        /\b(resume|resumption|reopen|start|suru|khul|khulne)\b/i.test(fullText);
      const dateMatch = String(topNotice.content || '').match(/\b(?:on|from)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/i);
      const paraphrased = paraphraseAppRecordInOwnWords(topNotice.content || topNotice.title);

      if (isClassResumption && dateMatch) {
        conversationalReply = isNepaliQuery
          ? `University ko latest official notice anusar regular classes ${dateMatch[1]} bata resume huncha.${crossSemNote}`
          : `According to the university's latest official notice, regular classes resume on ${dateMatch[1]}.${crossSemNote}`;
      } else {
        conversationalReply = isNepaliQuery
          ? `University ko latest official notice anusar: ${paraphrased}.${crossSemNote}`
          : `According to the university's latest official notice, ${paraphrased}.${crossSemNote}`;
      }
    }

    const routineSuffix = (Array.isArray(result.relatedRoutine) && result.relatedRoutine.length > 0)
      ? `\n\n**Related Semester ${result.viewerSemester || ''} Examination Routine:**\n` + result.relatedRoutine.slice(0, 4).map(r => `- **${r.subject}** — ${r.date} ${r.calendar || 'BS'}${r.time ? `, ${r.time}` : ''}${r.room ? `, Room ${r.room}` : ''}`).join('\n')
      : '';

    return [...prefixBlocks, conversationalReply].filter(Boolean).join('\n\n') + routineSuffix;
  }
  if (name === 'search_assignments') {
    if (result.unsubmittedOnly && result.allSubmitted) {
      return 'You have submitted all published assignments for your semester!';
    }
    if (!result.assignments || !result.assignments.length) {
      if (result.isCountFilter) {
        return 'You have 0 assignments assigned for your semester.';
      }
      return 'No matching assignments found.';
    }

    // 1. Checked status inquiry: "is my assignment checked", "check vayo?", etc.
    if (result.isCheckedFilter) {
      const allA = result.allSemesterAssignments || result.assignments || [];
      const lines = [];
      const checkedList = allA.filter(a => a.studentSubmission?.checked);
      const pendingReviewList = allA.filter(a => a.studentSubmission?.submitted && !a.studentSubmission?.checked);
      const notSubList = allA.filter(a => !a.studentSubmission?.submitted);

      if (checkedList.length > 0) {
        lines.push(`✅ **Yes, ${checkedList.length} of your assignment${checkedList.length === 1 ? ' has' : 's have'} been checked by the teacher:**\n`);
        for (const a of checkedList) {
          const sub = a.studentSubmission;
          if (sub.hasReleasedGrades && Array.isArray(sub.releasedGrades) && sub.releasedGrades.length > 0) {
            const gradeStrs = sub.releasedGrades.map(g => `${g.questionTitle}: **${g.marksObtained}/${g.maxPoints}**${g.remarks ? ` ("${g.remarks}")` : ''}`).join('; ');
            lines.push(`- **${a.title}** (${a.subject || 'General'}): **Checked & Graded!** Marks: ${gradeStrs}`);
          } else {
            lines.push(`- **${a.title}** (${a.subject || 'General'}): **Checked by teacher!** (Official grades have not been released to the class yet).`);
          }
        }
      } else if (pendingReviewList.length > 0) {
        lines.push(`⏳ **Your submitted assignments have not been checked by the teacher yet (currently pending review):**\n`);
      } else {
        lines.push(`ℹ️ **None of your assignments have been checked yet because you haven't submitted them.**\n`);
      }

      if (pendingReviewList.length > 0) {
        lines.push('\n**Submitted — Waiting for Teacher Review:**');
        for (const a of pendingReviewList) {
          const subDate = a.studentSubmission?.submittedAt ? String(a.studentSubmission.submittedAt).slice(0, 10) : 'recently';
          lines.push(`- **${a.title}** (${a.subject || 'General'}) — Submitted on ${subDate}, pending review`);
        }
      }
      if (notSubList.length > 0) {
        lines.push('\n**Not Submitted Yet:**');
        for (const a of notSubList) {
          lines.push(`- **${a.title}** (${a.subject || 'General'})${a.deadline ? ` — Deadline: ${new Date(a.deadline).toLocaleDateString()}` : ''}`);
        }
      }
      return lines.join('\n');
    }

    // 2. Missed assignments inquiry: "is any assignment missed", "did I miss any assignment"
    if (result.isMissedFilter) {
      const allA = result.allSemesterAssignments || result.assignments || [];
      const missedList = allA.filter(a => a.isMissed);
      const upcomingList = allA.filter(a => a.isUpcoming);
      const lines = [];

      if (missedList.length > 0) {
        lines.push(`⚠️ **Yes, you have missed the deadline for ${missedList.length} assignment${missedList.length === 1 ? '' : 's'}:**\n`);
        for (const a of missedList) {
          const dlStr = a.deadline ? new Date(a.deadline).toLocaleDateString() : 'passed';
          lines.push(`- **${a.title}** (${a.subject || 'General'}) — **Missed!** Was due on ${dlStr} (Unsubmitted)`);
        }
      } else {
        lines.push(`✅ **No, you haven't missed any assignment deadlines!** All past-due assignments have been submitted.\n`);
      }

      if (upcomingList.length > 0) {
        lines.push('\n📅 **Upcoming Assignments Due Soon:**');
        for (const a of upcomingList) {
          const dlStr = a.deadline ? new Date(a.deadline).toLocaleDateString() : 'soon';
          lines.push(`- **${a.title}** (${a.subject || 'General'}) — Due **${dlStr}**`);
        }
      }
      return lines.join('\n');
    }

    // 3. Count inquiry: "how many assignments we have", "total assignments"
    if (result.isCountFilter) {
      const allA = result.allSemesterAssignments || result.assignments || [];
      const total = allA.length;
      const sem = result.viewerSemester ? `in Semester ${result.viewerSemester}` : '';
      const lines = [];
      lines.push(`📚 **You have ${total} total assignment${total === 1 ? '' : 's'} ${sem}:**\n`);
      lines.push(`- **Submitted:** ${result.submittedCount || 0} (${result.checkedCount || 0} checked/graded, ${result.pendingReviewCount || 0} pending review)`);
      lines.push(`- **Unsubmitted:** ${result.unsubmittedCount || 0} (${result.missedCount || 0} overdue/missed, ${result.upcomingCount || 0} upcoming)\n`);

      if (result.bySubject && Object.keys(result.bySubject).length > 0) {
        lines.push('**Breakdown by Subject:**');
        for (const [subj, counts] of Object.entries(result.bySubject)) {
          lines.push(`- **${subj}**: ${counts.total} assignment${counts.total === 1 ? '' : 's'} (${counts.submitted} submitted, ${counts.total - counts.submitted} pending)`);
        }
        lines.push('');
      }

      lines.push('**Assignment List:**');
      for (const a of allA) {
        const statusStr = a.studentSubmission?.submitted
          ? (a.studentSubmission.checked ? 'Checked ✅' : 'Submitted ⏳')
          : (a.isMissed ? 'Overdue/Missed ❌' : 'Pending 📅');
        lines.push(`- **${a.title}** (${a.subject || 'General'}) — *Status: ${statusStr}*${a.deadline ? ` (Due: ${new Date(a.deadline).toLocaleDateString()})` : ''}`);
      }
      return lines.join('\n');
    }

    const heading = result.unsubmittedOnly
      ? `You have ${result.count} unsubmitted assignment${result.count === 1 ? '' : 's'}:`
      : `Found ${result.count} assignment${result.count === 1 ? '' : 's'}:`;
    return `${heading}\n\n` + result.assignments.map(a => {
      const semPart = a.semester ? ` [${a.semester}]` : '';
      const header = `- **${a.title}**${a.subject ? ` (${a.subject})` : ''}${semPart}${a.deadline ? ` — due ${new Date(a.deadline).toLocaleDateString()}` : ''}`;
      const details = [];
      if (a.authorName) {
        details.push(`  • **Author:** ${a.authorName}${a.authorRole ? ` (${a.authorRole})` : ''}`);
      }
      if (a.description) {
        details.push(`  • **Description:** ${a.description}`);
      }
      if (Array.isArray(a.questions) && a.questions.length > 0) {
        const qList = a.questions.map(q => `Q${q.questionNumber}: ${q.title}${q.description ? ` — ${q.description}` : ''} (${q.maxPoints} pts)`).join('; ');
        details.push(`  • **Questions (${a.questions.length}):** ${qList}`);
      }
      if (a.studentSubmission) {
        const sub = a.studentSubmission;
        if (sub.submitted) {
          const dateStr = sub.submittedAt ? ` on ${new Date(sub.submittedAt).toISOString().slice(0, 10)}` : '';
          const statusLabel = sub.submissionStatus === 'partially_submitted'
            ? `Partially submitted (${sub.submittedQuestionsCount}/${sub.totalQuestionsCount} questions)${dateStr}`
            : `Submitted (${sub.submittedQuestionsCount}${sub.totalQuestionsCount ? `/${sub.totalQuestionsCount}` : ''} question${sub.submittedQuestionsCount === 1 ? '' : 's'})${dateStr}`;
          details.push(`  • **Your Submission Status:** ${statusLabel}`);
          if (sub.hasReleasedGrades && Array.isArray(sub.releasedGrades) && sub.releasedGrades.length > 0) {
            const gradeStrs = sub.releasedGrades.map(g => {
              const rem = g.remarks ? ` — Remarks: "${g.remarks}"` : '';
              return `${g.questionTitle}: **${g.marksObtained}/${g.maxPoints}**${rem}`;
            }).join('; ');
            details.push(`  • **Released Grade:** ${gradeStrs}`);
          } else if (sub.checked) {
            details.push(`  • **Grade Status:** Checked by teacher — grades pending official release`);
          } else {
            details.push(`  • **Grade Status:** Submitted — pending teacher review`);
          }
        } else {
          const dlStatus = a.isMissed ? 'Overdue & Missed' : 'Not submitted';
          details.push(`  • **Your Submission Status:** ${dlStatus}`);
        }
      }
      return [header, ...details].join('\n');
    }).join('\n\n');
  }
  return result.summary || "I couldn't find that in the university records.";
}

module.exports = {
  TOOLS,
  createTools,
  formatToolResult,
  routeQuery,
  extractFilters,
  extractChapterFilter,
  extractConversationAcademicContext,
  isShowMoreQuery,
  isAllSemestersRequest,
  isOtherSemesterRequest,
  parseSyllabusCourseDetails,
  searchQuery,
  semesterNumber,
  semesterAliases,
  subjectAliases,
  explicitSubjects,
  resolveSubject,
  predictSubjects,
  SUBJECT_ALIASES,
  courses,
  academicRequest,
  codeRequest,
  mapsToBitSyllabus,
  isSmalltalkMessage,
  isExplicitOfficialUniversityNoticeQuery,
  NON_BIT_ACADEMIC_OR_CODE,
  formatEligibilityLabel,
  formatAttendanceStatusLabel,
  buildAttendanceProgressBar,
  parseAttendanceBlock
};
