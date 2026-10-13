const syllabus = require('../public/syllabus-data.json');
const topics = require('./chat-topics');
const notes = require('./note-search');
const provider = require('./chat-provider');
const {toneInstructions} = require('./chat-personality');
const aiSearch = require('./ai-search-tools');
const { parseNepaliDateExpression } = require('./nepali-dates');

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const courses = syllabus.semesters.flatMap(s => s.courses.map(c => ({ ...c, semester: s.semester, year:s.year })));
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
    if (new RegExp(`\\b(?:sem(?:ester)?\\s*[-:]?\\s*(?:${ordinal}|${ROMANS[n-1]}|${WORDS[n-1]})|(?:${ordinal}|${WORDS[n-1]}|${ROMANS[n-1]})\\s*[-:]?\\s*sem(?:ester)?)\\b`, 'i').test(s)) return n;
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
    .replace(/\b(?:khojdeu|khojideu|khoja|khoj|chaiyo|chahiyo|deu|deuna|dekhauna|dekhaideu|pathaideu|heram|haleko|upload\s+gareko|upload\s+vako|upload\s+bhako|aako\s+xa|aeko\s+xa|kata\s+xa|kata\s+cha|kata|vayo|bhayo|sir\s+le|cr\s+le|hamro|timro|mero|ko|haru|matra|sabei|sabai|bujhaune|kunai|na|xa|cha|xaina|chaina|hunxa|huncha|aaja|bholi|voli|hijo|asti|parsi)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return query;
}
const wantsWeb = message => /\b(search (?:the )?(?:web|internet)|look (?:it|this) up|google)\b/i.test(message);
const isCurrent = message => wantsWeb(message) || /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|recently|news|trending|this (?:week|month|year)|right now|up[- ]to[- ]date|newest|weather|forecast|stock price|exchange rate|live (?:score|price|update)|who (?:is|s) (?:the )?(?:president|prime minister|ceo)|who won)\b/i.test(message)
  || /\b20(?:2[5-9]|[3-9]\d)\b/.test(message);
const codeRequest = message => /\b(write|generate|create|implement|make|fix|debug|code|program)\b/i.test(message) && /\b(code|program|java|javascript|python|html|css|c\+\+|c|function|script|algorithm)\b/i.test(message);
const academicRequest = message => /\b(explain|define|definition|what (?:is|are)|difference between|how (?:does|do)|teach|calculate|solve|prove)\b/i.test(message)
  && /\b(variable|operator|data ?type|oop|dbms|normalization|inheritance|polymorphism|encapsulation|abstraction|network|networking|tcp|ip|osi|algorithm|recursion|pointer|class|object|database|sql|java|javascript|python|html|css|computer|programming|math|calculus|derivative|integration|cache|stack|queue|tree|array|string|sort|search|function|loop|boolean|circuit|voltage|current|probability|statistics|photosynthesis|operating system)s?\b/i.test(message);
// Platform content intents (posts, notices, assignments)
const noticeIntent = message => (
  /\b(notice|announcement|circular|official (?:notice|update)|campus (?:notice|update|news))s?\b/i.test(message) ||
  /\b(?:notice\s+aako\s+xa|notice\s+aeko\s+xa|announcement\s+dekhauna|cr\s+le\s+haleko\s+announcement)\b/i.test(message)
) && !/\b(explain|define|what is a notice)\b/i.test(message);

const postIntent = message => (
  /\b(post|discussion|community|what (?:are |is )?(?:people|everyone|students?) (?:talking|discussing|saying|posting)|feed)\b/i.test(message) ||
  /\b(?:post\s+dekhauna|cr\s+ko\s+post|community\s+ma\s+k\s+xa|feed\s+heram)\b/i.test(message)
) && !/\b(explain|define|what is a post)\b/i.test(message);

const assignmentSearchIntent = message => (
  /\b(assignment|homework|task|submission|due|deadline)s?\b/i.test(message) ||
  /\b(?:assignment\s+xa|homework\s+xa|assignment\s+bujhaune|kunai\s+assignment)\b/i.test(message)
) && !/\b(explain|define|what is|how (?:does|do))\b/i.test(message) && !/\b(?:write|create|generate|make|solve|complete)\s+(?:the\s+)?(?:assignment|homework)\b/i.test(message);

function routeQuery(message, history = []) {
  let effective = message.trim();
  let filters = extractFilters(effective);
  const dateInfo = parseNepaliDateExpression(effective);
  if (dateInfo) filters.dateInfo = dateInfo;

  const previousUser = [...history].reverse().find(m => m.role === 'user')?.content;

  // 1. Resolve short semester follow-ups; never carry stale filters into a new question.
  if (previousUser && /^(?:and |what about |how about |for )?(?:(?:sem(?:ester)?\s*)?(?:[1-8](?:st|nd|rd|th)?|i{1,3}|iv|v|vi{1,3})|(?:first|second|third|fourth|fifth|sixth|seventh|eighth)(?: semester)?)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser);
    if (['notes','syllabus','routine'].includes(prior.kind)) {
      filters = { ...prior.filters, semester: semesterNumber(effective.replace(/^(and|what about|how about|for)\s+/i, '').replace(/[?.!]+$/, '')) };
      return { kind: prior.kind, filters, query: prior.query, message: `${prior.message} (now semester ${filters.semester})` };
    }
  }

  // 2. Query refinement follow-up: "CSS ko matra", "only CSS", "matra"
  if (previousUser && /\b(?:matra|only)\b/i.test(effective) && effective.split(/\s+/).length <= 4) {
    const prior = routeQuery(previousUser);
    if (['notes','posts','notices','assignments'].includes(prior.kind)) {
      const refinedQuery = searchQuery(effective.replace(/\b(?:matra|only|ko)\b/gi, '').trim());
      const refinedSubject = resolveSubject(refinedQuery) || explicitSubjects(effective)[0] || prior.filters.subject;
      filters = { ...prior.filters, subject: refinedSubject };
      return { kind: prior.kind, filters, query: refinedQuery || prior.query, message: `${prior.message} (refined: ${effective})` };
    }
  }

  // 3. Pagination / "Arko xa?" / "More" follow-up
  if (previousUser && /^(?:arko\s+xa|aru\s+xa|more|any\s+more|arko\s+deu|aru\s+dekhauna)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser);
    if (['notes','posts','notices','assignments','routine'].includes(prior.kind)) {
      return { kind: prior.kind, filters: prior.filters, query: prior.query, isMore: true, message: prior.message };
    }
  }

  // 4. Relative reference intent: "second wala khola", "2nd wala", "tyo notes khola ta", "paila ko", "arko wala", "first wala"
  const relMatch = effective.match(/\b(first|second|third|1st|2nd|3rd|pahilo|dosro|tesro|paila\s+ko|arko|tyo|that)\s*(?:wala|item|one|result|notes?|file|pdf|material)?\b/i);
  const isOpenAction = /\b(khola|open|view|dekhauna|show|heram)\b/i.test(effective);
  if ((relMatch && isOpenAction) || (/^\s*(?:tyo\s+)?(?:notes?|file|material)?\s*(?:khola|open|view)(?:\s+ta)?\s*$/i.test(effective))) {
    let index = 0;
    const ord = relMatch ? relMatch[1].toLowerCase() : '';
    if (/second|2nd|dosro/.test(ord)) index = 1;
    else if (/third|3rd|tesro/.test(ord)) index = 2;
    else if (/tyo|that/.test(ord) || !ord) {
      // Check if previous user message asked about an ordinal (e.g. "Second wala k ko barema ho?")
      const prevOrdinalMatch = previousUser && previousUser.match(/\b(first|second|third|1st|2nd|3rd|pahilo|dosro|tesro)\b/i);
      if (prevOrdinalMatch) {
        const po = prevOrdinalMatch[1].toLowerCase();
        if (/second|2nd|dosro/.test(po)) index = 1;
        else if (/third|3rd|tesro/.test(po)) index = 2;
      }
    }
    return { kind: 'relative_reference', index, action: 'open', filters, query: effective, message: effective };
  }

  const routineIntent = (
    /\b(routine|timetable|schedule|exam (?:schedule|date)|exam|deadline)\b/i.test(effective) ||
    /\b(?:routine\s+dekhauna|routine\s+k\s+xa|timetable\s+dekhauna|exam\s+ko\s+date)\b/i.test(effective)
  ) && !/\b(explain|define|what is|how (?:does|do))\b/i.test(effective);

  const syllabusIntent = /\b(syllabus|curriculum)\b/i.test(effective) || (/\b(?:subjects|courses|what.*in)\b/i.test(effective) && !!filters.semester);
  const isNotice = noticeIntent(effective);
  const isPost = postIntent(effective);
  const isAssignment = assignmentSearchIntent(effective);

  const explicitNotesWord = /\b(notes?|pdfs?|files?|study materials?|lecture slides?|slides?|pyqs?|documents?)\b/i.test(effective);
  const notesIntent = (
    explicitNotesWord ||
    (!routineIntent && !syllabusIntent && !isNotice && !isAssignment && !isPost &&
     /\b(?:khojdeu|khojideu|chaiyo|chahiyo|pathaideu)\b/i.test(effective) && (filters.subject || predictSubjects(effective).length > 0))
  ) && !/\b(?:write|create|generate|make)\s+(?:me\s+)?(?:some\s+)?notes?\b/i.test(effective);

  const kinds = [
    notesIntent && 'notes',
    routineIntent && 'routine',
    syllabusIntent && 'syllabus',
    isNotice && 'notices',
    isPost && 'posts',
    isAssignment && 'assignments'
  ].filter(Boolean);
  const stableCode = codeRequest(effective) && !wantsWeb(effective) && !/\b(latest|newest|current version|recent release)\b/i.test(effective);
  const stableAcademic = academicRequest(effective) && !wantsWeb(effective)
    && !/\b(latest|newest|recent(?:ly)?|news|trending|current (?:version|release|price|events?)|changes? (?:in|to)|updates? (?:in|to))\b/i.test(effective);
  const smalltalk = /^(hey|hi|hello|thanks|thank you|bye|how are you|who are you|what can you do|good morning|good evening|wassup|oii|oi|namaste|नमस्ते)\b/i.test(effective)
    || /^(?:oi\s+)?k\s+(?:xa|cha)(?:\s+khabar)?\??$/i.test(effective)
    || /^k\s+gardai\s+(?:xas|xau|chau|ho)\??/i.test(effective)
    || /^(?:k\s+cha|k\s+xa)\??$/i.test(effective);

  const kind = (stableCode || stableAcademic) && !kinds.length
    ? 'direct'
    : kinds.length === 1
      ? kinds[0]
      : kinds.length > 1
        ? 'tools'
        : (isCurrent(effective) ? 'web' : 'direct');
  return { kind, filters, query: searchQuery(effective, filters), message: effective };
}
const tool = (name, description, properties, required) => ({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
const TOOLS = [
  tool('search_notes', 'Find uploaded library notes by title and full content; preserve exact user filters. Return at most 3 matches. Do not use to explain an academic concept.', {query:{type:'string',description:'Topic or title only, no filler words'},semester:{type:'integer',minimum:1,maximum:8},subject:{type:'string',description:'Explicit subject only; omit if only a topic is given'}}, ['query']),
  tool('get_syllabus', 'Get actual BIT syllabus for one exact semester. Ask if semester is missing.', {semester:{type:'integer',minimum:1,maximum:8}}, ['semester']),
  tool('get_routine', 'Get actual published timetable for one exact semester. Never invent dates. Ask if semester is missing.', {semester:{type:'integer',minimum:1,maximum:8}}, ['semester']),
  tool('search_posts', 'Search community posts and discussions on Semester Library. Returns recent posts matching the query that the student is authorized to see.', {query:{type:'string',description:'Topic or keyword to search for in posts'}}, ['query']),
  tool('search_notices', 'Search official notices and announcements posted on Semester Library.', {query:{type:'string',description:'Topic or keyword to search for in notices'}}, ['query']),
  tool('search_assignments', 'Search coding assignments, deadlines, and submissions on Semester Library.', {query:{type:'string',description:'Assignment title, subject, or keyword'}}, ['query']),
  tool('web_search', 'Search the live web only for current/recent facts. Never for ordinary academic explanations or code.', {query:{type:'string'}}, ['query'])
];

/**
 * @param {object} db
 * @param {object} route
 * @param {object} opts
 * @param {object} [opts.academicContext] - Server-resolved academic context (semester, cohort, role).
 *   SECURITY: This is the ONLY source of truth for semester authorization.
 */
function createTools(db, route, {signal, chatMode='roast', history=[], academicContext = null, searchNotes = notes.searchNotes, webSearch = provider.webSearch} = {}) {
  const results = [];
  async function executeTool(name, args = {}, context = {}) {
    const toolSignal = signal && context.signal ? AbortSignal.any([signal, context.signal]) : signal || context.signal;
    toolSignal?.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    if (!TOOLS.some(t => t.function.name === name)) throw new Error('Unknown tool');
    // The user's explicit filters always win over model-supplied arguments.
    const semester = route.filters.semester;
    const subject = route.filters.subject;

    // Resolve authorization from academicContext (server-side only).
    const isAdmin = academicContext?.role === 'admin';
    const isTeacher = academicContext?.role === 'teacher';
    const teacherSemesters = isTeacher && Array.isArray(academicContext?.assignedSemesters) && academicContext.assignedSemesters.length > 0
      ? academicContext.assignedSemesters
      : null;
    const authorizedSemester = (isAdmin || isTeacher) ? null : (academicContext?.cohort?.currentSemester || (academicContext?.semester ? semesterNumber(academicContext.semester) : null) || null);

    let result;
    if (name === 'get_syllabus' || name === 'get_routine') {
      if (semester && authorizedSemester && semester !== authorizedSemester) {
        result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show information for Semester ${authorizedSemester}.` };
      } else if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access information for your assigned semesters.` };
      } else {
        // Syllabus/routine: use student's authorized semester if no explicit filter
        const effectiveSemester = semester || authorizedSemester || (teacherSemesters && teacherSemesters[0]);
        if (!effectiveSemester) result = { clarification: 'Which semester (1–8)?' };
        else if (name === 'get_syllabus') {
          const selected = courses.filter(c => semesterNumber(c.semester) === effectiveSemester && (!subject || c.title === subject));
          result = { semester: effectiveSemester, courses: selected };
        } else {
          let sql = `SELECT id, subject_name AS subject, subject_code, exam_date AS date, calendar, weekday AS day, exam_time AS time, room, semester, exam_type AS type FROM routine WHERE semester = ?`;
          const params = [effectiveSemester];
          if (subject) {
            const names = subjectAliases(subject).map(s=>s.toLowerCase());
            sql += ` AND LOWER(TRIM(subject_name)) IN (${names.map(()=>'?').join(',')})`;
            params.push(...names);
          }
          const rows = await db.all(sql + ' ORDER BY calendar ASC, exam_date ASC, id ASC', ...params);
          let filteredRows = rows.map(r=>({...r,date:r.examDate || r.examdate || r.date}));
          if (route.filters?.dateInfo?.date && filteredRows.length > 0) {
            const targetDate = route.filters.dateInfo.date;
            const onDate = filteredRows.filter(r => r.date === targetDate);
            if (onDate.length > 0) filteredRows = onDate;
          }
          result = { semester: effectiveSemester, routine: filteredRows };
        }
      }
    } else if (name === 'search_notes') {
      const query = typeof args.query === 'string' ? args.query.slice(0,400) : route.query;
      if (semester && authorizedSemester && semester !== authorizedSemester) {
        result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show study materials and notes for Semester ${authorizedSemester}.` };
      } else if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access materials for your assigned semesters.` };
      } else if (subject && authorizedSemester && !semester) {
        const subjectCourse = courses.find(c => c.title === subject);
        const subjectSem = subjectCourse ? semesterNumber(subjectCourse.semester) : null;
        if (subjectSem && subjectSem !== authorizedSemester) {
          result = { clarification: `${subject} is a Semester ${subjectSem} subject. You are registered in Semester ${authorizedSemester}, so I can only retrieve notes for your semester.` };
        }
      } else if (subject && teacherSemesters && !semester) {
        const subjectCourse = courses.find(c => c.title === subject);
        const subjectSem = subjectCourse ? semesterNumber(subjectCourse.semester) : null;
        if (subjectSem && !teacherSemesters.includes(subjectSem)) {
          result = { clarification: `${subject} belongs to Semester ${subjectSem}, which is not in your assigned teaching semesters (${teacherSemesters.join(', ')}).` };
        }
      }
      if (!result) {
        if (!query && !subject) result = {clarification:'Which subject or topic do you need notes for?'};
        else {
          // SEMESTER AUTHORIZATION: If the student has an authorized semester,
          // force it regardless of what they typed (they can only access their semester).
          const searchSem = authorizedSemester || semester;
          let files = await searchNotes(db, { query, semester: searchSem, subject: subject ? subjectAliases(subject) : undefined });
          let inferredSubject = null;
          if (!files.length && !subject) {
            const predictions = predictSubjects(query).filter(s => !searchSem || courses.some(c => c.title === s && semesterNumber(c.semester) === searchSem));
            if (predictions.length > 1) result = {clarification:`Which subject do you mean: ${predictions.join(' or ')}?`};
            else if (predictions.length === 1) {
              inferredSubject = predictions[0];
              const inferredSemester = searchSem || semesterNumber(courses.find(c => c.title === inferredSubject)?.semester);
              files = await searchNotes(db, {query:'', semester:inferredSemester, subject:subjectAliases(inferredSubject)});
            }
          }
          if (!result) result = {files: files.slice(0,3).map(f=>({id:f.id,title:f.title || f.originalName,originalName:f.originalName,subject:f.subject,semester:f.semester,chapter:f.chapter,excerpt:f.excerpt || '',matchType:inferredSubject ? 'topic' : f.matchType,viewUrl:`/api/files/${f.id}/view`,downloadUrl:`/api/files/${f.id}/download`,
            resourceCard:{type:'note',id:f.id,title:f.title||f.originalName,subject:f.subject,semester:f.semester,action:'open_note',deepLink:`/material/${f.id}`,viewUrl:`/api/files/${f.id}/view`,downloadUrl:`/api/files/${f.id}/download`,mobileRoute:`/material/${f.id}`,mobileParams:{id:f.id}}
          })), inferredSubject};
        }
      }
    } else if (name === 'search_posts') {
      // PLATFORM SEARCH: Posts — semester-authorized via academicContext
      const query = typeof args.query === 'string' ? args.query.slice(0,400) : route.query;
      try {
        const posts = await aiSearch.searchPosts(db, academicContext, { query, limit: 5 });
        result = { posts, count: posts.length };
      } catch (e) {
        result = { posts: [], count: 0, error: 'Could not search posts right now.' };
      }
    } else if (name === 'search_notices') {
      // PLATFORM SEARCH: Notices — semester-authorized
      const query = typeof args.query === 'string' ? args.query.slice(0,400) : route.query;
      try {
        const notices = await aiSearch.searchNotices(db, academicContext, { query, limit: 5 });
        result = { notices, count: notices.length };
      } catch (e) {
        result = { notices: [], count: 0, error: 'Could not search notices right now.' };
      }
    } else if (name === 'search_assignments') {
      // PLATFORM SEARCH: Assignments — semester-authorized
      const query = typeof args.query === 'string' ? args.query.slice(0,400) : route.query;
      try {
        const assignments = await aiSearch.searchAssignments(db, academicContext, { query, limit: 5 });
        let filtered = assignments;
        if (route.filters?.dateInfo?.date && filtered.length > 0) {
          const targetDate = route.filters.dateInfo.date;
          const onDate = filtered.filter(a => a.deadline && String(a.deadline).startsWith(targetDate));
          if (onDate.length > 0) filtered = onDate;
        }
        result = { assignments: filtered, count: filtered.length };
      } catch (e) {
        result = { assignments: [], count: 0, error: 'Could not search assignments right now.' };
      }
    } else {
      if (!isCurrent(route.message) && route.kind !== 'web' && !/\b(search (?:the )?(?:web|internet)|look (?:it|this) up|google)\b/i.test(route.message)) result = {error:'This question does not need a live web search. Answer it directly.'};
      else {
        try { result = await webSearch(String(args.query || route.message).slice(0,600), {signal:toolSignal, personalityInstructions:toneInstructions(route.message,history,chatMode)}); }
        catch (e) { if (toolSignal?.aborted) throw e; result = {error:'Couldn’t check the latest information right now. Try again shortly.',results:[]}; }
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
    return `**Semester ${result.semester} routine**\n\n` + result.routine.map(r => `- **${r.subject}** — ${r.date} ${r.calendar || '(calendar unconfirmed)'}${r.day ? ` (${r.day})` : ''}${r.time ? `, ${r.time}` : ''}${r.room ? `, Room ${r.room}` : ''}`).join('\n');
  }
  if (name === 'get_syllabus') {
    if (!result.courses.length) return `No matching syllabus found for semester ${result.semester}.`;
    return `**Semester ${result.semester} syllabus**\n\n` + result.courses.map(c => `- **${c.title}** (${c.code}) — ${c.credit} credits`).join('\n') + `\n\n[Full syllabus](/syllabus.html#${encodeURIComponent(`Year ${Math.ceil(result.semester/2)}`)}/${encodeURIComponent(ROMANS[result.semester-1])})`;
  }
  if (name === 'search_posts') {
    if (!result.posts || !result.posts.length) return 'No matching posts found for your semester.';
    return `Found ${result.count} post${result.count === 1 ? '' : 's'}:\n\n` + result.posts.map(p => `- **${p.title}** — by ${p.authorName}, ${new Date(p.createdAt).toLocaleDateString()}`).join('\n');
  }
  if (name === 'search_notices') {
    if (!result.notices || !result.notices.length) return 'No matching notices found for your semester.';
    return `Found ${result.count} notice${result.count === 1 ? '' : 's'}:\n\n` + result.notices.map(n => `- **${n.title}** — ${new Date(n.createdAt).toLocaleDateString()}`).join('\n');
  }
  if (name === 'search_assignments') {
    if (!result.assignments || !result.assignments.length) return 'No matching assignments found for your semester.';
    return `Found ${result.count} assignment${result.count === 1 ? '' : 's'}:\n\n` + result.assignments.map(a => `- **${a.title}**${a.subject ? ` (${a.subject})` : ''}${a.deadline ? ` — due ${new Date(a.deadline).toLocaleDateString()}` : ''}`).join('\n');
  }
  return result.summary || 'No current sources found for that query.';
}
module.exports = { TOOLS, createTools, formatToolResult, routeQuery, extractFilters, semesterNumber, semesterAliases, subjectAliases, resolveSubject, predictSubjects, courses, SUBJECT_ALIASES, searchQuery, isCurrent, noticeIntent, postIntent, assignmentSearchIntent };

