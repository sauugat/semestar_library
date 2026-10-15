'use strict';

const STOP = new Set(('a an the please find search show give get me my us for of on about in and or to from with is are was were be has have had do does did can could would should you your our this that these those it its there any some all only just tell explain summarize summary regarding related actual available complete material materials semester sem university gandaki bit ko ka ki ke lai le ma ra ani pani ta ho xa cha chaa xan chha chhan xaina chaina yrr malai mero hamro timro tapaiko yo tyo tyesko tesko kati k kasari kun kata chaiyo chahiyo khojdeu khojideu khoja khoj deu deuna dekhauna pathaideu gara garnu barema bare barey lagi haru bhan na sir professor teacher what when where how which who will next week date dates time hours baje kaile kahile aauxa auncha aayo aeko ki nai vayo bhayo bujhaune chahiyo').split(' '));

const NEPALI_STOP = new Set('को का कि की के लाई ले मा र अनि पनि त हो छ छन् छैन मलाई मेरो हाम्रो तपाईंको यो त्यो त्यसको कति कुन कहाँ कता बारे लागि हरु देऊ दिनुहोस् खोज खोज्नुहोस् देखाउनुहोस् भन्नुहोस् केहि सबै कहिले कहाँ कसरी आउँछ आउछ आयो हुन्छ थियो सम्बन्धी सम्बन्धि जानकारी काम'.split(' '));

const ALIASES = {
  परीक्षा: 'exam', परीक्षाको: 'exam', परिक्षा: 'exam', जाँच: 'exam', परीक्षाहरू: 'exam',
  सूचना: 'notice', सूचनाहरू: 'notice', सूचनाको: 'notice', नोट्स: 'notes', नोट: 'notes', नोटहरू: 'notes', नोटहरु: 'notes',
  तालिका: 'routine', समयतालिका: 'routine', असाइनमेन्ट: 'assignment', असाइनमेन्टको: 'assignment',
  डाटाबेस: 'database', डेटाबेस: 'database', डेटाबेसको: 'database', सामान्यीकरण: 'normalization', नर्मलाइजेसन: 'normalization',
  पाइथन: 'python', जाभा: 'java', नेटवर्क: 'network', नेटवर्किङ: 'network', सुरक्षा: 'security',
  छात्रवृत्ति: 'scholarship', शुल्क: 'fee', पुस्तकालय: 'library', छुट्टी: 'holiday',
  प्रोग्रामिङ: 'programming', कक्षा: 'class', दर्ता: 'registration',
  अब्जेक्ट: 'object', ओरिएन्टेड: 'oriented', कम्प्युटर: 'computer', साइन्स: 'science', ल्याब: 'lab',
  अन्तिम: 'deadline', मिति: 'deadline', बुझाउने: 'deadline',
  exams: 'exam', examination: 'exam', examinations: 'exam', pariksha: 'exam', terminal: 'exam',
  timetable: 'routine', schedule: 'routine', schedules: 'routine',
  databases: 'database', dbms: 'database', networks: 'network', networking: 'network',
  scholarships: 'scholarship', fees: 'fee', holidays: 'holiday',
  due: 'deadline', submission: 'deadline', deadlines: 'deadline',
  normalisation: 'normalization', normaliztion: 'normalization', normlization: 'normalization',
  inheritance: 'inheritance', inheriting: 'inheritance', inherintance: 'inheritance',
  pythn: 'python', javscript: 'javascript', csss: 'css',
  samaya: 'time', suchana: 'notice', suchanaa: 'notice'
};

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
  'today', 'tomorrow', 'yesterday', 'voli', 'boli', 'asti', 'upcoming', 'current'
]);

function words(text) {
  return String(text || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
}
function canonical(term) { return ALIASES[term] || term; }

const technicalAcronyms = new Set(['css', 'html', 'js', 'sql', 'php', 'cit', 'dsa', 'oop', 'ai', 'ml', 'os', 'api', 'ui', 'ux', 'dom', 'git']);

function extractNamedEntities(query) {
  const tokens = String(query || '').match(/\b[A-Za-z\u0900-\u097F0-9_'-]+\b/g) || [];
  const commonStarters = new Set([
    'please', 'find', 'search', 'show', 'give', 'get', 'tell', 'explain',
    'what', 'when', 'where', 'how', 'which', 'who', 'hamro', 'mero', 'timro',
    'tapaiko', 'yo', 'tyo', 'asti', 'voli', 'boli', 'naya', 'kun', 'kati',
    'kaile', 'kahile', 'can', 'could', 'would', 'should', 'yrr', 'yar', 'yaar',
    'bro', 'dai', 'didi', 'bhai', 'oi', 'oii', 'sunana', 'suna', 'namaste', 'hello', 'hi', 'hey'
  ]);
  const entities = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (STOP.has(lower) || NEPALI_STOP.has(lower) || commonStarters.has(lower)) continue;
    const isCap = /^[A-Z]/.test(token);
    if (isCap) {
      if (!['Notice', 'Assignment', 'Routine', 'Exam', 'Notes', 'Semester', 'University', 'Gandaki'].includes(token) && !technicalAcronyms.has(lower)) {
        entities.push(lower);
      }
    }
  }
  return entities;
}

function queryTerms(query) {
  const raw = words(query).filter(t => !NEPALI_STOP.has(t)).filter(t => !STOP.has(t));
  const expanded = [];
  for (const t of raw) {
    expanded.push(t);
    const alias = ALIASES[t];
    if (alias && alias !== t) expanded.push(alias);
  }
  return [...new Set(expanded)].slice(0, 30);
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

  const evidence = evidenceTerms(`${candidate.title || ''} ${candidate.content || ''}`);

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
    const isNotice = resType === 'notice' || resType === 'post' || candidate.type === 'notice' || candidate.category === 'notice';
    const isAssignment = resType === 'assignment' || candidate.type === 'assignment';
    const isRoutine = resType === 'routine' || candidate.type === 'routine';
    const hasDeadline = Boolean(candidate.deadline);

    let typeMatches = false;
    if (category.includes('notice') || category.includes('post') || category.includes('update')) typeMatches = isNotice;
    else if (category.includes('assignment') || category.includes('lab') || category.includes('homework')) typeMatches = isAssignment;
    else if (category.includes('routine') || category.includes('exam') || category.includes('timetable') || category.includes('schedule')) typeMatches = isRoutine || isNotice;
    else if (category.includes('deadline') || category.includes('submission')) typeMatches = hasDeadline || isAssignment || isNotice;
    else if (recency.length > 0) typeMatches = true;

    if (typeMatches) {
      return { relevant: true, coverage: 1.0, reason: 'category_recency_intent' };
    }
    return { relevant: false, coverage: 0, reason: 'category_mismatch' };
  }

  // Case 4: Topic / Entity search
  const matches = allTerms.filter(t => evidence.has(t));
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

  const coverage = matches.length / allTerms.length;
  return { relevant: true, coverage, reason: 'supported_anchors' };
}

function rankCandidates(query, candidates, limit = 5, minScore = 0) {
  const best = new Map();
  for (const row of candidates) {
    const evidence = validateRelevance(query, row, minScore);
    if (!evidence.relevant) continue;
    const titleTerms = evidenceTerms(row.title);
    const terms = queryTerms(query);
    const titleCoverage = terms.length ? terms.filter(t => titleTerms.has(t)).length / terms.length : 0;
    const semantic = Math.max(0, Math.min(1, Number(row.vector_sim || 0)));
    const exactTitle = String(row.title || '').normalize('NFKC').trim().toLowerCase() === String(query).normalize('NFKC').trim().toLowerCase();
    const score = (exactTitle ? 1 : 0) + 0.65 * evidence.coverage + 0.2 * titleCoverage + 0.1 * semantic + 0.05 * (6 - Number(row.authorityTier || 5)) / 5;
    if (score < minScore) continue;
    const item = { ...row, score: Number(score.toFixed(4)) };
    if (!best.has(row.id) || best.get(row.id).score < score) best.set(row.id, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

module.exports = { queryTerms, validateRelevance, rankCandidates, ALIASES, CATEGORY_TERMS, RECENCY_TERMS, extractNamedEntities };
