'use strict';

const { normalizeDevanagariDigits } = require('./nepali-dates');

const STOP = new Set((
  'a an the please find search show give get me my us for of on about in and or to from with by is are was were be been being ' +
  'has have had do does did can could would should may might will shall you your our this that these those it its there here ' +
  'any some all only just tell explain summarize summary regarding related actual available complete material materials ' +
  'semester sem university gandaki bit course courses subject subjects chapter chapters unit units module modules part ' +
  'ko ka ki ke lai le ma ra ani pani ta ni hai na ho xa cha chaa xan chha chhan xaina chaina hunxa huncha vayo bhayo ' +
  'yrr yar yaar bro dai didi bhai sir mam maam professor teacher ' +
  'malai mero hamro timro tapaiko aafno afno yo tyo tyesko tesko yesko yasko ' +
  'kati k kasari kun kata kaha kaile kahile ' +
  'chaiyo chahiyo khojdeu khojideu khoja khoj deu deuna dekhauna dekhaideu dekhau pathaideu pathau pathauna ' +
  'bujhaideu bujham bujhauna bujhina bujhdai vaneko bhaneko bhanera भन ' +
  'gara garnu गर्नुहोस् barema bare barey lagi haru हरू ' +
  'bata dekhi pachi paxi paxadi agadi aile ahile samma bhanda vanda ' +
  'what when where how which who whom whose why ' +
  'next last this week date dates time hours baje ' +
  'aauxa auncha aayo aako aeko ki nai haleko upload uploads uploaded uploading ' +
  'sajilo para bhasa ali feri अरु अर्को'
).split(/\s+/));

const NEPALI_STOP = new Set((
  'को का कि की के लाई ले मा र अनि पनि त नि है न हो छ छन् छैन हुन्छ भयो भए ' +
  'मलाई मेरो हाम्रो तपाईंको तिम्रो आफ्नो यो त्यो त्यसको यसको यी ती ' +
  'कति कुन कहाँ कता कहिले कसरी केहि सबै मात्र अलि ' +
  'बारे बारेमा लागि हरु हरू बाट देखि सम्म पछि अगाडि अहिले ' +
  'देऊ दिनुहोस् देखाऊ देखाउनुहोस् पठाऊ पठाउनुहोस् खोज खोज्नुहोस् भन्नुहोस् बुझाइदेऊ बुझाउ ' +
  'आउँछ आउछ आयो आएको थियो छ रछ ' +
  'सम्बन्धी सम्बन्धि जानकारी काम नोट नोट्स नोटहरू नोटहरु फाइल पीडीएफ अध्ययन सामग्री अध्याय युनिट सेमेस्टर'
).split(/\s+/));

const ALIASES = {
  // General platform terms (Devanagari & Romanized)
  परीक्षा: 'exam', परीक्षाको: 'exam', परिक्षा: 'exam', जाँच: 'exam', परीक्षाहरू: 'exam',
  सूचना: 'notice', सूचनाहरू: 'notice', सूचनाको: 'notice',
  नोट्स: 'notes', नोट: 'notes', नोटहरू: 'notes', नोटहरु: 'notes',
  तालिका: 'routine', समयतालिका: 'routine', रुटिन: 'routine',
  असाइनमेन्ट: 'assignment', असाइनमेन्टको: 'assignment', गृहकार्य: 'assignment',
  अन्तिम: 'deadline', मिति: 'deadline', बुझाउने: 'deadline',
  छात्रवृत्ति: 'scholarship', शुल्क: 'fee', पुस्तकालय: 'library', छुट्टी: 'holiday', बिदा: 'holiday',
  कक्षा: 'class', कक्षाहरू: 'class', कक्षाको: 'class', दर्ता: 'registration', ल्याब: 'lab',
  सुरु: 'resume', शुरु: 'resume', सञ्चालन: 'resume', सुचारु: 'resume', खुल्ने: 'resume', खुल्छ: 'resume',
  दशैं: 'dashain', दशैँ: 'dashain', तिहार: 'tihar',

  // Academic subjects & core CS concepts (Devanagari -> English)
  डाटाबेस: 'database', डेटाबेस: 'database', डेटाबेसको: 'database', डिबिएमएस: 'dbms',
  सामान्यीकरण: 'normalization', नर्मलाइजेसन: 'normalization', नर्मलाइजेशन: 'normalization',
  अपरेटिङ: 'operating', ऑपरेटिङ: 'operating', ऑपररेटिङ: 'operating', अपरेटिंग: 'operating', ऑपरेटिंग: 'operating',
  सिस्टम: 'system', सिस्टमको: 'system', प्रणाली: 'system',
  नेटवर्क: 'network', नेटवर्किङ: 'networking', नेटवर्किंग: 'networking',
  कम्प्युटर: 'computer', कम्प्यूटर: 'computer', साइन्स: 'science',
  प्रोग्रामिङ: 'programming', प्रोग्रामिंग: 'programming', प्रोग्राम: 'program', कोड: 'code',
  पाइथन: 'python', जाभा: 'java', जाभास्क्रिप्ट: 'javascript',
  अब्जेक्ट: 'object', ओरिएन्टेड: 'oriented',
  एल्गोरिदम: 'algorithm', अल्गोरिदम: 'algorithm',
  डाटा: 'data', डेटा: 'data', स्ट्रक्चर: 'structure', संरचना: 'structure',
  डिजिटल: 'digital', लजिक: 'logic', माइक्रोप्रोसेसर: 'microprocessor', आर्किटेक्चर: 'architecture',
  सफ्टवेयर: 'software', इन्जिनियरिङ: 'engineering',
  आर्टिफिसियल: 'artificial', इन्टेलिजेन्स: 'intelligence', कृत्रिम: 'artificial', बुद्धिमत्ता: 'intelligence',
  ग्राफिक्स: 'graphics', क्लाउड: 'cloud', कम्प्युटिङ: 'computing',
  सुरक्षा: 'security', साइबर: 'cyber', फरेन्सिक: 'forensic',
  डेडलक: 'deadlock', रिकर्सन: 'recursion', पोइन्टर: 'pointer', पोइन्टरहरू: 'pointer',
  इनहेरिटेन्स: 'inheritance', वंशाणुगत: 'inheritance', पोलिमोर्फिज्म: 'polymorphism',
  इनक्याप्सुलेसन: 'encapsulation', एब्स्ट्र्याक्सन: 'abstraction',
  ट्रान्जेक्सन: 'transaction', कन्करेन्सी: 'concurrency',
  पेजिङ: 'paging', सेग्मेन्टेसन: 'segmentation', भर्चुअल: 'virtual', मेमोरी: 'memory',
  सेमाफोर: 'semaphore', म्युटेक्स: 'mutex', शिड्युलिङ: 'scheduling',
  बायनरी: 'binary', ट्री: 'tree', ग्राफ: 'graph', स्ट्याक: 'stack', क्यु: 'queue',
  लिङ्क्ड: 'linked', लिस्ट: 'list', एरे: 'array', स्ट्रिङ: 'string',
  सर्टिङ: 'sorting', सर्चिङ: 'searching', ह्यासिङ: 'hashing',
  म्याट्रिक्स: 'matrix', डेरिभेटिभ: 'derivative', इन्टिग्रेसन: 'integration',
  प्रोब्याबिलिटी: 'probability', तथ्याङ्क: 'statistics',

  // English & Romanized Nepali variants / typos -> canonical English
  exams: 'exam', examination: 'exam', examinations: 'exam', pariksha: 'exam', terminal: 'exam',
  timetable: 'routine', schedule: 'routine', schedules: 'routine',
  databases: 'database', dbms: 'database', networks: 'network', networking: 'network',
  scholarships: 'scholarship', fees: 'fee', holidays: 'holiday', bida: 'holiday', chutti: 'holiday',
  vacations: 'vacation', dashai: 'dashain',
  classes: 'class', kaksha: 'class', kakhsa: 'class',
  suru: 'resume', shuru: 'resume', start: 'resume', starts: 'resume', starting: 'resume', started: 'resume',
  begin: 'resume', begins: 'resume', beginning: 'resume',
  resumes: 'resume', resuming: 'resume', resumed: 'resume', resumption: 'resume',
  reopen: 'resume', reopens: 'resume', reopening: 'resume', reopened: 'resume',
  khulxa: 'resume', khulcha: 'resume', khulne: 'resume', lagxa: 'resume', lagcha: 'resume', lagne: 'resume', sanchalan: 'resume',
  due: 'deadline', submission: 'deadline', deadlines: 'deadline',
  normalisation: 'normalization', normaliztion: 'normalization', normlization: 'normalization',
  inheritance: 'inheritance', inheriting: 'inheritance', inherintance: 'inheritance',
  polymorfism: 'polymorphism', encapsulasion: 'encapsulation',
  deadlocks: 'deadlock', recursions: 'recursion', pointers: 'pointer',
  pythn: 'python', javscript: 'javascript', csss: 'css',
  samaya: 'time', suchana: 'notice', suchanaa: 'notice'
};

// Multi-token Devanagari / Romanized phrase expansions for academic & notice search
const PHRASE_EXPANSIONS = [
  { pattern: /(?:ऑपरेटिङ|ऑपररेटिङ|अपरेटिङ|अपरेटिंग|ऑपरेटिंग)\s*सिस्टम/gi, terms: ['operating', 'system'] },
  { pattern: /डाटा\s*स्ट्रक्चर|डेटा\s*स्ट्रक्चर/gi, terms: ['data', 'structure'] },
  { pattern: /डिजिटल\s*लजिक/gi, terms: ['digital', 'logic'] },
  { pattern: /कम्प्युटर\s*नेटवर्क/gi, terms: ['computer', 'network'] },
  { pattern: /सफ्टवेयर\s*इन्जिनियरिङ/gi, terms: ['software', 'engineering'] },
  { pattern: /आर्टिफिसियल\s*इन्टेलिजेन्स|कृत्रिम\s*बुद्धिमत्ता/gi, terms: ['artificial', 'intelligence'] },
  { pattern: /वेब\s*टेक्नोलोजी/gi, terms: ['web', 'technology'] },
  { pattern: /सी\s*प्रोग्रामिङ/gi, terms: ['c', 'programming'] },
  { pattern: /जाभा\s*प्रोग्रामिङ/gi, terms: ['java', 'programming'] },
  { pattern: /बायनरी\s*ट्री/gi, terms: ['binary', 'tree'] },
  { pattern: /लिङ्क्ड\s*लिस्ट/gi, terms: ['linked', 'list'] },
  { pattern: /\b(?:class(?:es)?|kaksha)\s+(?:kaile|kahile)\s+(?:bata|dekhi|suru|shuru|start|resume|reopen|khul\w*|lag\w*|xa|cha|chha|hunxa|huncha)\b|\b(?:kaile|kahile)\s+(?:bata|dekhi)\s+(?:class(?:es)?|kaksha)\b|\bwhen\s+(?:do|are|will|does)\s+(?:regular\s+|our\s+|the\s+)?class(?:es)?\s*(?:start|resume|reopen|begin)?\b/gi, terms: ['class', 'resume'] },
  { pattern: /\b(?:dashain|tihar|vacation|holiday|bida|chutti)\s+(?:pachi|paxi|paxadi|after)\s+(?:class(?:es)?|college|campus)\b/gi, terms: ['class', 'resume', 'vacation'] },
  { pattern: /\b(?:class|classes|college|campus)\s+(?:resumption|reopening|suru|shuru|start|starts|resume|resumes|reopen|reopens|khul\w*|lag\w*)\b/gi, terms: ['class', 'resume'] }
];

const CATEGORY_TERMS = new Set([
  'notice', 'notices', 'announcement', 'announcements',
  'assignment', 'assignments', 'homework', 'task', 'lab',
  'routine', 'schedule', 'timetable', 'exam', 'exams',
  'note', 'notes', 'pdf', 'slide', 'slides', 'file', 'files', 'document', 'documents',
  'deadline', 'deadlines', 'submission',
  'post', 'posts', 'update', 'updates'
]);

const RECENCY_TERMS = new Set([
  'latest', 'recent', 'new', 'naya', 'aako', 'aeko', 'haleko', 'upload', 'uploaded',
  'today', 'tomorrow', 'yesterday', 'voli', 'boli', 'bholi', 'aaja', 'hijo', 'parsi', 'asti', 'upcoming', 'current'
]);

function words(text) {
  const normalizedDigits = normalizeDevanagariDigits(String(text || '')).normalize('NFKC').toLowerCase();
  // Keep combining vowel signs/matras (\p{M}) attached to base letters (\p{L}) so Devanagari words stay intact
  return normalizedDigits.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
}

function canonical(term) {
  return ALIASES[term] || term;
}

const technicalAcronyms = new Set(['css', 'html', 'js', 'sql', 'php', 'cit', 'dsa', 'oop', 'ai', 'ml', 'os', 'api', 'ui', 'ux', 'dom', 'git', 'dbms', 'bcnf', '1nf', '2nf', '3nf', 'tcp', 'udp', 'http', 'dns', 'cpu', 'alu', 'dma', 'lru', 'fifo', 'fcfs', 'sjf', 'bfs', 'dfs', 'bst', 'avl', 'uml', 'sdlc', 'jwt']);

function extractNamedEntities(query) {
  const tokens = String(query || '').match(/\b[A-Za-z\u0900-\u097F0-9_'-]+\b/g) || [];
  const commonStarters = new Set([
    'please', 'find', 'search', 'show', 'give', 'get', 'tell', 'explain',
    'what', 'when', 'where', 'how', 'which', 'who', 'hamro', 'mero', 'timro',
    'tapaiko', 'yo', 'tyo', 'asti', 'voli', 'boli', 'bholi', 'aaja', 'hijo', 'parsi',
    'naya', 'kun', 'kati', 'kaile', 'kahile', 'can', 'could', 'would', 'should',
    'yrr', 'yar', 'yaar', 'bro', 'dai', 'didi', 'bhai', 'oi', 'oii', 'sunana', 'suna',
    'namaste', 'hello', 'hi', 'hey', 'today', 'tomorrow', 'yesterday',
    'class', 'classes', 'kaksha', 'resume', 'resumption', 'resuming', 'reopen', 'reopening',
    'start', 'starts', 'starting', 'begin', 'begins', 'suru', 'shuru', 'khulxa', 'khulne',
    'regular', 'updated', 'revised', 'schedule', 'schedules', 'timetable', 'routine', 'routines',
    'dashain', 'tihar', 'vacation', 'vacations', 'holiday', 'holidays', 'bida', 'chutti',
    'college', 'campus', 'department', 'faculty', 'student', 'students', 'teacher', 'teachers', 'admin',
    'notice', 'notices', 'announcement', 'announcements', 'assignment', 'assignments', 'homework',
    'exam', 'exams', 'examination', 'midterm', 'preboard', 'final', 'result', 'results', 'marks', 'grade', 'grades',
    'attendance', 'eligible', 'eligibility', 'library', 'notes', 'note', 'syllabus',
    'deadlock', 'normalization', 'recursion', 'inheritance', 'polymorphism', 'encapsulation',
    'abstraction', 'operating', 'system', 'database', 'management', 'computer', 'networks',
    'unit', 'chapter', 'section', 'module', 'lab', 'labs', 'morning', 'evening',
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra'
  ]);
  const entities = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (STOP.has(lower) || NEPALI_STOP.has(lower) || commonStarters.has(lower) || CATEGORY_TERMS.has(lower) || RECENCY_TERMS.has(lower)) continue;
    const isTitleCaseProperNoun = /^[A-Z][a-z]{2,}$/.test(token);
    if (isTitleCaseProperNoun) {
      if (!['Notice', 'Assignment', 'Routine', 'Exam', 'Notes', 'Semester', 'University', 'Gandaki', 'Chapter', 'Unit'].includes(token) && !technicalAcronyms.has(lower)) {
        entities.push(lower);
      }
    }
  }
  return entities;
}

function queryTerms(query) {
  const text = String(query || '');
  const raw = words(text).filter(t => !NEPALI_STOP.has(t)).filter(t => !STOP.has(t));
  const expanded = [];

  for (const { pattern, terms } of PHRASE_EXPANSIONS) {
    if (pattern.test(text)) {
      expanded.push(...terms);
    }
    pattern.lastIndex = 0;
  }

  for (const t of raw) {
    const alias = ALIASES[t];
    if (alias && alias !== t) {
      expanded.push(alias);
      // If original token is ASCII, keep it alongside alias; if Devanagari mapped to English, prefer English alias for matching English records while keeping original if needed
      expanded.push(t);
    } else {
      expanded.push(t);
    }
  }
  return [...new Set(expanded)].slice(0, 30);
}

/**
 * Extracts clean, canonical academic search tokens for note/file/assignment retrieval.
 * - Maps Devanagari & Romanized Nepali terms to English canonical equivalents
 * - Strips conversational filler, category words ("notes", "pdf", "file"), and chapter/semester markers
 * - Preserves technical terms (normalization, deadlock, inheritance, recursion, polymorphism, 1nf, bcnf, c, etc.)
 */
function academicSearchTerms(query, { stripTerms = [] } = {}) {
  let cleaned = normalizeDevanagariDigits(String(query || ''))
    .replace(/\b(?:semester|sem)\s*(?:[1-8](?:st|nd|rd|th)?|viii|vii|vi|iv|iii|ii|i|v)\b/gi, ' ')
    .replace(/\b(?:chapter|chap|ch|unit|module)\s*(?:no\.?|number|#)?\s*(?:[1-9]\d?|viii|vii|vi|iv|iii|ii|i|v)\b/gi, ' ')
    .replace(/(?:अध्याय|युनिट|एकाइ|सेमेस्टर|सेम)\s*[0-9]{1,2}/g, ' ');

  const extraStop = new Set(
    stripTerms.flatMap(s => words(s)).map(w => (ALIASES[w] || w).toLowerCase())
  );

  const out = [];
  for (const { pattern, terms } of PHRASE_EXPANSIONS) {
    if (pattern.test(cleaned)) {
      for (const term of terms) {
        if (!extraStop.has(term) && !CATEGORY_TERMS.has(term)) out.push(term);
      }
    }
    pattern.lastIndex = 0;
  }

  const rawWords = words(cleaned);
  for (const w of rawWords) {
    if (STOP.has(w) || NEPALI_STOP.has(w) || CATEGORY_TERMS.has(w)) continue;
    const mapped = ALIASES[w] || w;
    if (STOP.has(mapped) || NEPALI_STOP.has(mapped) || CATEGORY_TERMS.has(mapped)) continue;
    if (extraStop.has(w) || extraStop.has(mapped)) continue;
    // If token was Devanagari and mapped to an ASCII academic term, push the mapped ASCII term
    if (/[\u0900-\u097F]/.test(w) && mapped !== w) {
      out.push(mapped);
    } else if (!/[\u0900-\u097F]/.test(w)) {
      out.push(w);
      if (mapped !== w) out.push(mapped);
    } else {
      out.push(w);
    }
  }

  return [...new Set(out)].slice(0, 15);
}

function evidenceTerms(text) {
  const raw = words(text);
  const set = new Set();
  for (const t of raw) {
    set.add(t);
    const alias = ALIASES[t];
    if (alias) set.add(alias);
  }
  return set;
}

function validateRelevance(query, candidate, minScore = 0) {
  const allTerms = queryTerms(query);
  const recency = allTerms.filter(t => RECENCY_TERMS.has(t));
  const category = allTerms.filter(t => CATEGORY_TERMS.has(t));
  const topicTerms = allTerms.filter(t => !RECENCY_TERMS.has(t) && !CATEGORY_TERMS.has(t));

  // Case 1: Ambiguous query (no topic, no category, no recency)
  if (!allTerms.length || (!topicTerms.length && !category.length && !recency.length)) {
    return { relevant: false, coverage: 0, reason: 'ambiguous_query' };
  }

  const evidence = evidenceTerms(`${candidate.title || ''} ${candidate.content || ''} ${candidate.subject || ''} ${candidate.chapter || ''}`);

  // Case 2: Named Entity Check (Eliminates false positives like Dumbledore, Gotham, Hogwarts, etc.)
  const entities = extractNamedEntities(query);
  if (entities.length > 0) {
    const matchedEntities = entities.filter(e => evidence.has(e) || evidence.has(ALIASES[e]));
    if (matchedEntities.length === 0) {
      return { relevant: false, coverage: 0, reason: 'unmatched_named_entity' };
    }
  }

  // Case 3: Generic request for recent notices / assignments / routines
  if (!topicTerms.length && (category.length || recency.length)) {
    const resType = candidate.resourceType || candidate.resource_type || (candidate.id && candidate.id.split(':')[0]) || '';
    const isNotice = resType === 'notice' || resType === 'gu_official' || resType === 'post' ||
      String(candidate.type || '').toLowerCase() === 'notice' ||
      String(candidate.category || '').toLowerCase() === 'notice';
    const isAssignment = resType === 'assignment' || candidate.type === 'assignment';
    const isRoutine = resType === 'routine' || candidate.type === 'routine';
    const isNote = resType === 'note' || candidate.type === 'note';
    const hasDeadline = Boolean(candidate.deadline);

    let typeMatches = false;
    if (category.includes('notice') || category.includes('post') || category.includes('update')) typeMatches = isNotice;
    else if (category.includes('assignment') || category.includes('lab') || category.includes('homework')) typeMatches = isAssignment;
    else if (category.includes('routine') || category.includes('exam') || category.includes('timetable') || category.includes('schedule')) typeMatches = isRoutine || isNotice;
    else if (category.includes('deadline') || category.includes('submission')) typeMatches = hasDeadline || isAssignment || isNotice;
    else if (category.includes('note') || category.includes('notes') || category.includes('pdf') || category.includes('file') || category.includes('slides')) typeMatches = isNote;
    else if (recency.length > 0) typeMatches = true;

    if (typeMatches) {
      return { relevant: true, coverage: 1.0, reason: 'category_recency_intent' };
    }
    return { relevant: false, coverage: 0, reason: 'category_mismatch' };
  }

  // Case 4: Topic / Entity search
  // Deduplicate by canonical term so bilingual/synonym expansions (e.g. suru -> resume, classes -> class)
  // are evaluated as unified concepts rather than penalizing coverage when only one language appears in the text.
  const asciiOrMatchedTerms = topicTerms.filter(t => !/[\u0900-\u097F]/.test(t) || evidence.has(t) || (ALIASES[t] && evidence.has(ALIASES[t])));
  const rawEvalTerms = asciiOrMatchedTerms.length > 0 ? asciiOrMatchedTerms : allTerms;
  const evalTerms = [...new Set(rawEvalTerms.map(t => canonical(t)))];
  const matches = evalTerms.filter(t => evidence.has(t) || (ALIASES[t] && evidence.has(ALIASES[t])));
  if (matches.length === 0) {
    const semantic = Math.max(0, Math.min(1, Number(candidate.vector_sim || 0)));
    if (minScore <= 0.05) {
      return { relevant: true, coverage: 0.1, reason: 'low_threshold_override' };
    }
    if (semantic >= 0.75) {
      return { relevant: true, coverage: semantic, reason: 'strong_semantic_evidence' };
    }
    return { relevant: false, coverage: 0, reason: 'no_term_match' };
  }

  const coverage = matches.length / evalTerms.length;
  return { relevant: true, coverage, reason: 'supported_anchors', matchedTerms: matches };
}

function rankCandidates(query, candidates, limit = 5, minScore = 0) {
  const best = new Map();
  const canonicalTerms = [...new Set(
    queryTerms(query)
      .filter(t => !RECENCY_TERMS.has(t) && !CATEGORY_TERMS.has(t))
      .map(t => canonical(t))
  )];

  for (const row of candidates) {
    const evidence = validateRelevance(query, row, minScore);
    if (!evidence.relevant) continue;
    const titleTerms = evidenceTerms(`${row.title || ''} ${row.subject || ''}`);
    const evalTitleTerms = canonicalTerms.length > 0
      ? canonicalTerms
      : [...new Set(queryTerms(query).map(t => canonical(t)))];
    const titleCoverage = evalTitleTerms.length
      ? evalTitleTerms.filter(t => titleTerms.has(t) || (ALIASES[t] && titleTerms.has(ALIASES[t]))).length / evalTitleTerms.length
      : 0;
    const semantic = Math.max(0, Math.min(1, Number(row.vector_sim || 0)));
    const exactTitle = String(row.title || '').normalize('NFKC').trim().toLowerCase() === String(query).normalize('NFKC').trim().toLowerCase();
    const tier = Number(row.authorityTier || 5);
    const isAuthoritativeNotice = (row.resourceType === 'notice' || row.resourceType === 'gu_official' ||
      String(row.type || '').toLowerCase() === 'notice' ||
      String(row.category || '').toLowerCase() === 'notice') && tier <= 3;
    const bitWideBonus = isAuthoritativeNotice && (Number(row.target_all_semesters ?? row.source?.target_all_semesters ?? 0) === 1 || /\ball\s+bit\s+students\b/i.test(String(row.content || ''))) ? 0.04 : 0;
    const score = (exactTitle ? 1 : 0) + 0.65 * evidence.coverage + 0.2 * titleCoverage + 0.1 * semantic + 0.05 * (6 - tier) / 5 + bitWideBonus;
    if (score < minScore) continue;
    const item = {
      ...row,
      score: Number(score.toFixed(4)),
      _matchedTerms: evidence.matchedTerms || []
    };
    if (!best.has(row.id) || best.get(row.id).score < score) best.set(row.id, item);
  }

  const items = [...best.values()];

  // Supersession & recency resolution among authoritative notices on the same topic:
  // A newer relevant notice with equal/higher authority (especially one marked updated/revised/rescheduled/supersedes)
  // must outrank an older superseded notice on the same topic.
  const noticeItems = items.filter(it =>
    (it.resourceType === 'notice' || it.resourceType === 'gu_official' ||
      String(it.type || '').toLowerCase() === 'notice' ||
      String(it.category || '').toLowerCase() === 'notice') &&
    Number(it.authorityTier || 5) <= 3
  );
  if (noticeItems.length > 1) {
    for (const newer of noticeItems) {
      const newerDate = String(newer.createdAt || newer.source?.created_at || '');
      if (!newerDate) continue;
      const newerText = `${newer.title || ''} ${newer.content || ''}`;
      const hasExplicitUpdateSignal = /\b(updated?|revised?|rescheduled?|supersedes?|corrigendum|amendment|new\s+schedule|latest)\b/i.test(newerText);
      for (const older of noticeItems) {
        if (older.id === newer.id) continue;
        const olderDate = String(older.createdAt || older.source?.created_at || '');
        if (!olderDate || newerDate <= olderDate) continue;
        if (Number(newer.authorityTier || 5) > Number(older.authorityTier || 5)) continue;
        const sharedTerms = (newer._matchedTerms || []).filter(t => (older._matchedTerms || []).includes(t));
        if (sharedTerms.length > 0 && (hasExplicitUpdateSignal || newer.score >= older.score - 0.15)) {
          older.superseded = true;
          older.supersededBy = newer.id;
          if (newer.score <= older.score) {
            newer.score = Number((older.score + 0.05).toFixed(4));
          }
        }
      }
    }
  }

  return items
    .map(it => {
      const copy = { ...it };
      delete copy._matchedTerms;
      return copy;
    })
    .sort((a, b) => b.score - a.score || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
}

module.exports = {
  queryTerms,
  academicSearchTerms,
  validateRelevance,
  rankCandidates,
  ALIASES,
  STOP,
  NEPALI_STOP,
  CATEGORY_TERMS,
  RECENCY_TERMS,
  extractNamedEntities,
  words
};
