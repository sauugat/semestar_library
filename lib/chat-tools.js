const syllabus = require('../public/syllabus-data.json');
const topics = require('./chat-topics');
const notes = require('./note-search');
const provider = require('./chat-provider');

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const courses = syllabus.semesters.flatMap(s => s.courses.map(c => ({ ...c, semester: s.semester })));
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
  'Web Technology I': ['web 1', 'web tech 1', 'web technology 1'],
  'Web Technology II': ['web 2', 'web tech 2', 'web technology 2'],
  'Microprocessor and Computer Architecture': ['microprocessor', 'computer architecture', 'coa'],
  'Digital Logic': ['dl'],
  'Object Oriented Analysis and Design using UML': ['ooad', 'uml'],
  'Fundamentals of Probability and Statistics': ['statistics', 'probability and statistics', 'stats'],
  'Computer Graphics Technology': ['computer graphics', 'cg'],
  'Artificial Intelligence': ['ai'],
  'Software Engineering': ['software engineering', 'se'],
  'Principles of Organization and Management': ['pom', 'principles of management'],
  'Management Information System': ['mis'],
  'Mobile Application Development': ['mobile development', 'mad'],
  'Cloud Computing': ['cloud computing and virtualization'],
  'Data Mining and Warehousing': ['data mining', 'data warehousing', 'dmw'],
  'Digital Forensic Security Technologies': ['digital forensics', 'cyber security', 'cybersecurity'],
  'Software Development and Operations (DevOps)': ['devops'],
  'Human Computer Interface and UI Design': ['hci', 'human computer interaction']
};
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const phraseIn = (text, phrase) => (` ${normalize(text)} `).includes(` ${normalize(phrase)} `);
function semesterNumber(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (/^[1-8]$/.test(s)) return Number(s);
  const roman = ROMANS.indexOf(s.toUpperCase());
  if (roman >= 0) return roman + 1;
  const word = WORDS.indexOf(s);
  if (word >= 0) return word + 1;
  for (let n = 1; n <= 8; n++) {
    const ordinal = `${n}(?:st|nd|rd|th)?`;
    if (new RegExp(`\\b(?:sem(?:ester)?\\s*[-:]?\\s*(?:${ordinal}|${ROMANS[n-1]}|${WORDS[n-1]})|(?:${ordinal}|${WORDS[n-1]}|${ROMANS[n-1]})\\s*sem(?:ester)?)\\b`, 'i').test(s)) return n;
  }
  return null;
}
function semesterAliases(n) {
  return [String(n), ROMANS[n-1], `Semester ${n}`, `Semester ${ROMANS[n-1]}`, `sem ${n}`, `${WORDS[n-1]} semester`, `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} semester`].map(s => s.toLowerCase());
}
function subjectAliases(subject) {
  return [...new Set([subject, ...(SUBJECT_ALIASES[subject] || [])])];
}
function explicitSubjects(message) {
  const matches = courses.flatMap(c => subjectAliases(c.title).filter(a => phraseIn(message, a)).map(a => ({subject: c.title, alias: a})));
  // Prefer the longest phrase (Mathematics II must not also match Mathematics I).
  matches.sort((a, b) => normalize(b.alias).length - normalize(a.alias).length);
  return [...new Set(matches.filter((m, i) => !matches.slice(0, i).some(x => phraseIn(x.alias, m.alias))).map(m => m.subject))];
}
function resolveSubject(value) {
  return courses.find(c => subjectAliases(c.title).some(a => normalize(a) === normalize(value)))?.title || null;
}
function predictSubjects(query) {
  const matches = topics.filter(t => t.synonyms.some(s => phraseIn(query, s)));
  return [...new Set(matches.map(t => resolveSubject(t.canonicalSubject) || t.canonicalSubject))];
}
function extractFilters(message) {
  const subjects = explicitSubjects(message);
  return { semester: semesterNumber(message), subject: subjects.length === 1 ? subjects[0] : null, subjects };
}
function searchQuery(message, filters = extractFilters(message)) {
  let query = normalize(message);
  if (filters.subject) {
    for (const alias of subjectAliases(filters.subject).sort((a, b) => b.length - a.length)) {
      query = (` ${query} `).replace(` ${normalize(alias)} `, ' ').trim();
    }
  }
  query = query.replace(/\b(?:semester|sem)\s*(?:[1-8](?:st|nd|rd|th)?|viii|vii|vi|iv|iii|ii|i|v|first|second|third|fourth|fifth|sixth|seventh|eighth)\b/g, ' ')
    .replace(/\b(?:[1-8](?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth)\s*(?:semester|sem)\b/g, ' ')
    .replace(/\b(?:can|could|would|you|please|give|show|find|search|look|up|send|me|us|the|a|an|my|our|some|any|all|have|got|do|we|is|there|are|available|uploaded|want|need|notes?|files?|pdfs?|documents?|materials?|lecture|slides?|on|about|for|from|in|of)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return query;
}
const isCurrent = message => /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|recently|news|trending|this (?:week|month|year)|right now|up[- ]to[- ]date|live (?:score|price|update)|newest|who (?:is|s) (?:the )?(?:president|prime minister|ceo))\b/i.test(message)
  || /\b(?:20(?:2[5-9]|[3-9]\d))\b/.test(message) && /\b(event|news|release|version|trend|update)\b/i.test(message);
function routeQuery(message, history = []) {
  let effective = message.trim();
  let filters = extractFilters(effective);
  const previousUser = [...history].reverse().find(m => m.role === 'user')?.content;
  // Resolve only obvious short follow-ups; never carry stale filters into a new question.
  if (previousUser && /^(?:and |what about |how about |for )?(?:(?:sem(?:ester)?\s*)?(?:[1-8](?:st|nd|rd|th)?|i{1,3}|iv|v|vi{1,3})|(?:first|second|third|fourth|fifth|sixth|seventh|eighth)(?: semester)?)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser);
    if (['notes','syllabus','routine'].includes(prior.kind)) {
      filters = { ...prior.filters, semester: semesterNumber(effective.replace(/^(and|what about|how about|for)\s+/i, '').replace(/[?.!]+$/, '')) };
      return { kind: prior.kind, filters, query: prior.query, message: `${prior.message} (now semester ${filters.semester})` };
    }
  }
  const notesIntent = /\b(notes?|pdfs?|uploaded files?|study materials?|lecture slides?|pyqs?)\b/i.test(effective) && !/\b(?:write|create|generate|make)\s+(?:me\s+)?(?:some\s+)?notes?\b/i.test(effective);
  const routineIntent = /\b(routine|timetable|exam (?:schedule|date)|exam|deadline)\b/i.test(effective) && !/\b(explain|define|what is|how (?:does|do))\b/i.test(effective);
  const syllabusIntent = /\b(syllabus|curriculum)\b/i.test(effective) || /\b(?:subjects|courses|what.*in)\b/i.test(effective) && !!filters.semester;
  const kinds = [notesIntent && 'notes', routineIntent && 'routine', syllabusIntent && 'syllabus'].filter(Boolean);
  const kind = kinds.length > 1 ? 'tools' : kinds[0] || (isCurrent(effective) ? 'web' : 'direct');
  return { kind, filters, query: searchQuery(effective, filters), message: effective };
}
const tool = (name, description, properties, required) => ({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const TOOLS = [
  tool('search_notes', 'Find uploaded library notes by title and full content; preserve exact user filters. Return at most 3 matches. Do not use to explain an academic concept.', {query:{type:'string',description:'Topic or title only, no filler words'},semester:{type:'integer',minimum:1,maximum:8},subject:{type:'string',description:'Explicit subject only; omit if only a topic is given'}}, ['query']),
  tool('get_syllabus', 'Get actual BIT syllabus for one exact semester. Ask if semester is missing.', {semester:{type:'integer',minimum:1,maximum:8}}, ['semester']),
  tool('get_routine', 'Get actual published timetable for one exact semester. Never invent dates. Ask if semester is missing.', {semester:{type:'integer',minimum:1,maximum:8}}, ['semester']),
  tool('web_search', 'Search the live web only for current/recent facts. Never for ordinary academic explanations or code.', {query:{type:'string'}}, ['query'])
];

function createTools(db, route, {signal, searchNotes = notes.searchNotes, webSearch = provider.webSearch} = {}) {
  const results = [];
  async function executeTool(name, args = {}) {
    signal?.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    if (!TOOLS.some(t => t.function.name === name)) throw new Error('Unknown tool');
    // The user's explicit filters always win over model-supplied arguments.
    const semester = route.filters.semester || semesterNumber(args.semester);
    const subject = route.filters.subject || (args.subject ? resolveSubject(args.subject) || String(args.subject).slice(0,160) : null);
    let result;
    if (name === 'get_syllabus' || name === 'get_routine') {
      if (!semester) result = { clarification: 'Which semester (1–8)?' };
      else if (name === 'get_syllabus') {
        const selected = courses.filter(c => semesterNumber(c.semester) === semester && (!subject || c.title === subject));
        result = { semester, courses: selected };
      } else {
        const aliases = semesterAliases(semester);
        let sql = `SELECT subject, examDate, day, time, semester, type FROM exam_schedule WHERE LOWER(TRIM(semester)) IN (${aliases.map(()=>'?').join(',')})`;
        const params = [...aliases];
        if (subject) {
          const names = subjectAliases(subject).map(s=>s.toLowerCase());
          sql += ` AND LOWER(TRIM(subject)) IN (${names.map(()=>'?').join(',')})`;
          params.push(...names);
        }
        const rows = await db.all(sql + ' ORDER BY examDate ASC', ...params);
        result = { semester, routine: rows.map(r=>({...r,date:r.examDate || r.examdate || r.date})) };
      }
    } else if (name === 'search_notes') {
      const query = typeof args.query === 'string' ? args.query.slice(0,400) : route.query;
      if (!query && !subject) result = {clarification:'Which subject or topic do you need notes for?'};
      else {
        let files = await searchNotes(db, { query, semester, subject: subject ? subjectAliases(subject) : undefined });
        let inferredSubject = null;
        if (!files.length && !subject) {
          const predictions = predictSubjects(query).filter(s => !semester || courses.some(c => c.title === s && semesterNumber(c.semester) === semester));
          if (predictions.length > 1) result = {clarification:`Which subject do you mean: ${predictions.join(' or ')}?`};
          else if (predictions.length === 1) {
            inferredSubject = predictions[0];
            const inferredSemester = semester || semesterNumber(courses.find(c => c.title === inferredSubject)?.semester);
            files = await searchNotes(db, {query:'', semester:inferredSemester, subject:subjectAliases(inferredSubject)});
          }
        }
        if (!result) result = {files: files.slice(0,3).map(f=>({id:f.id,title:f.title || f.originalName,originalName:f.originalName,subject:f.subject,semester:f.semester,chapter:f.chapter,excerpt:f.excerpt || '',matchType:inferredSubject ? 'topic' : f.matchType,viewUrl:`/api/files/${f.id}/view`,downloadUrl:`/api/files/${f.id}/download`})), inferredSubject};
      }
    } else {
      if (!isCurrent(route.message) && route.kind !== 'web' && !/\b(search (?:the )?(?:web|internet)|look (?:it|this) up|google)\b/i.test(route.message)) result = {error:'This question does not need a live web search. Answer it directly.'};
      else {
        try { result = await webSearch(String(args.query || route.message).slice(0,600), {signal}); }
        catch (e) { if (signal?.aborted) throw e; result = {error:'Couldn’t check the latest information right now. Try again shortly.',results:[]}; }
      }
    }
    results.push({name,result});
    return result;
  }
  return {executeTool,results};
}
function formatToolResult(name, result) {
  if (result.clarification) return result.clarification;
  if (result.error) return result.error;
  if (name === 'search_notes') {
    if (!result.files.length) return 'No matching notes found. Which subject or topic should I try?';
    return result.inferredSubject ? `Closest match: **${result.inferredSubject}** notes.` : `Found ${result.files.length === 1 ? 'a matching note' : `${result.files.length} matching notes`}.`;
  }
  if (name === 'get_routine') {
    if (!result.routine.length) return `No routine is published for semester ${result.semester} yet.`;
    return `**Semester ${result.semester} routine**\n\n` + result.routine.map(r => `- **${r.subject}** — ${r.date}${r.day ? ` (${r.day})` : ''}${r.time ? `, ${r.time}` : ''}`).join('\n');
  }
  if (name === 'get_syllabus') {
    if (!result.courses.length) return `No matching syllabus found for semester ${result.semester}.`;
    return `**Semester ${result.semester} syllabus**\n\n` + result.courses.map(c => `- **${c.title}** (${c.code}) — ${c.credit} credits`).join('\n') + `\n\n[Full syllabus](/syllabus.html#${encodeURIComponent(`Year ${Math.ceil(result.semester/2)}-Semester ${ROMANS[result.semester-1]}`)})`;
  }
  return result.summary || 'No current sources found for that query.';
}
module.exports = { TOOLS, createTools, formatToolResult, routeQuery, extractFilters, semesterNumber, semesterAliases, subjectAliases, resolveSubject, predictSubjects, courses, SUBJECT_ALIASES, searchQuery, isCurrent };
