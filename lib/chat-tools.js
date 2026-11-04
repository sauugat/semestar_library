'use strict';

const syllabus = require('../public/syllabus-data.json');
const topics = require('./chat-topics');
const notes = require('./note-search');
const { aiSearch } = { aiSearch: require('./ai-search-tools') };
const { parseNepaliDateExpression, normalizeDevanagariDigits } = require('./nepali-dates');

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
  return [...new Set([subject, ...(SUBJECT_ALIASES[subject] || [])])];
}

function explicitSubjects(message) {
  const matches = courses.flatMap(c => subjectAliases(c.title).filter(a => phraseIn(message, a)).map(a => ({ subject: c.title, alias: a })));
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
    .replace(/\b(?:can|could|would|you|please|give|show|find|search|look|up|send|me|us|the|a|an|my|our|some|any|all|have|got|do|we|is|there|are|available|uploaded|want|need|notes?|files?|pdfs?|documents?|materials?|lecture|slides?|upload|uploads|uploading|study|on|about|for|from|in|of)\b/g, ' ')
    .replace(/\b(?:khojdeu|khojideu|khoja|khoj|chaiyo|chahiyo|deu|deuna|dekhauna|dekhaideu|pathaideu|heram|haleko|upload\s+gareko|upload\s+vako|upload\s+bhako|aako\s+xa|aeko\s+xa|kata\s+xa|kata\s+cha|kata|vayo|bhayo|sir\s+le|cr\s+le|hamro|timro|mero|ko|haru|matra|sabei|sabai|bujhaune|kunai|na|xa|cha|xaina|chaina|hunxa|huncha|aaja|bholi|voli|hijo|asti|parsi)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
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

// Platform content intents (posts, notices, assignments)
const noticeIntent = message => (
  /\b(notices?|announcements?|circulars?|official (?:notice|update|date|schedule|routine)|campus (?:notice|update|news)|postpon\w*|reschedul\w*)\b/i.test(message) ||
  /\b(?:notice\s+aako\s+xa|notice\s+aeko\s+xa|announcement\s+dekhauna|cr\s+le\s+haleko\s+announcement|date\s+change|exam\s+(?:change|postpone))\b/i.test(message) ||
  /सूचना|जानकारी\s*आएको\s*छ/.test(message)
) && !/\b(explain|define|what is a notice)\b/i.test(message);

const postIntent = message => (
  /\b(post|posts|discussion|discussions|community|what (?:are |is )?(?:people|everyone|students?) (?:talking|discussing|saying|posting)|feed)\b/i.test(message) ||
  /\b(?:post\s+dekhauna|cr\s+ko\s+post|community\s+ma\s+k\s+xa|feed\s+heram)\b/i.test(message) ||
  /पोस्ट|कम्युनिटी/.test(message)
) && !/\b(explain|define|what is a post)\b/i.test(message);

const assignmentSearchIntent = message => (
  /\b(assignment|homework|task|submission|due|deadline)s?\b/i.test(message) ||
  /\b(?:assignment\s+xa|homework\s+xa|assignment\s+bujhaune|kunai\s+assignment)\b/i.test(message) ||
  /असाइनमेन्ट|गृहकार्य|बुझाउने\s*मिति/.test(message)
) && !/\b(explain|define|what is|how (?:does|do))\b/i.test(message) && !/\b(?:write|create|generate|make|solve|complete)\s+(?:the\s+)?(?:assignment|homework)\b/i.test(message);

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

function routeQuery(message, history = []) {
  let effective = String(message || '').trim();
  let filters = extractFilters(effective);
  const dateInfo = parseNepaliDateExpression(effective);
  if (dateInfo) filters.dateInfo = dateInfo;

  const previousUser = [...history].reverse().find(m => m.role === 'user')?.content;

  // 1. Resolve short semester follow-ups; never carry stale filters into a new question.
  if (previousUser && /^(?:and |what about |how about |for )?(?:(?:sem(?:ester)?\s*)?(?:[1-8](?:st|nd|rd|th)?|i{1,3}|iv|v|vi{1,3})|(?:first|second|third|fourth|fifth|sixth|seventh|eighth)(?: semester)?)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser);
    if (['notes', 'syllabus', 'routine'].includes(prior.kind)) {
      filters = { ...prior.filters, semester: semesterNumber(effective.replace(/^(and|what about|how about|for)\s+/i, '').replace(/[?.!]+$/, '')) };
      return { kind: prior.kind, filters, query: prior.query, message: `${prior.message} (now semester ${filters.semester})` };
    }
  }

  // 2. Query refinement follow-up: "CSS ko matra", "only CSS", "matra"
  if (previousUser && /\b(?:matra|only)\b/i.test(effective) && effective.split(/\s+/).length <= 4) {
    const prior = routeQuery(previousUser);
    if (['notes', 'posts', 'notices', 'assignments'].includes(prior.kind)) {
      const refinedQuery = searchQuery(effective.replace(/\b(?:matra|only|ko)\b/gi, '').trim());
      const refinedSubject = resolveSubject(refinedQuery) || explicitSubjects(effective)[0] || prior.filters.subject;
      filters = { ...prior.filters, subject: refinedSubject };
      return { kind: prior.kind, filters, query: refinedQuery || prior.query, message: `${prior.message} (refined: ${effective})` };
    }
  }

  // 3. Pagination / "Arko xa?" / "More" follow-up
  if (previousUser && /^(?:arko\s+xa|aru\s+xa|more|any\s+more|arko\s+deu|aru\s+dekhauna)[?.!]*$/i.test(effective)) {
    const prior = routeQuery(previousUser);
    if (['notes', 'posts', 'notices', 'assignments', 'routine'].includes(prior.kind)) {
      return { kind: prior.kind, filters: prior.filters, query: prior.query, isMore: true, message: prior.message };
    }
  }

  // 4. Relative reference intent: "second wala khola", "2nd wala", "tyo notes khola ta", "paila ko", "arko wala", "first wala", "pahilo wala notice dekhau"
  const relMatch = effective.match(/\b(first|second|third|1st|2nd|3rd|pahilo|dosro|tesro|paila\s+ko|arko|tyo|that)\s*(?:wala|item|one|result|notes?|file|pdf|material|notice|notices|post|posts|assignment|assignments)?\b/i);
  const isOpenAction = /\b(khola|open|view|dekhauna|dekhau|show|heram)\b/i.test(effective);
  if ((relMatch && isOpenAction) || (/^\s*(?:tyo\s+)?(?:notes?|file|material)?\s*(?:khola|open|view)(?:\s+ta)?\s*$/i.test(effective))) {
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

  const routineIntent = (
    /\b(routine|timetable|schedule|exam (?:schedule|date)|exam|deadline)\b/i.test(effective) ||
    /\b(?:routine\s+dekhauna|routine\s+k\s+xa|timetable\s+dekhauna|exam\s+ko\s+date|voli\s+exam\s+xa|bholi\s+exam\s+xa)\b/i.test(effective) ||
    /रुटिन|परीक्षा\s*तालिका|भोलि\s*परीक्षा\s*छ/.test(effective)
  ) && !/\b(?:explain|define|what is|how (?:does|do)|postpon\w*|reschedul\w*|chang\w*|cancel\w*|notice\w*|sareko|saryo|draft|leak\w*|questions?|confidential|unpublished)\b/i.test(effective);

  const syllabusIntent = /\b(syllabus|curriculum)\b|पाठ्यक्रम/i.test(effective) || (/\b(?:subjects|courses|what.*in)\b/i.test(effective) && !!filters.semester);
  const isNotice = noticeIntent(effective);
  const isPost = postIntent(effective);
  const isAssignment = assignmentSearchIntent(effective);

  const explicitNotesWord = /\b(notes?|pdfs?|files?|study materials?|materials?|lecture slides?|slides?|pyqs?|documents?|upload(?:s|ed|ing)?)\b/i.test(effective)
    || /\b(?:upload\s+vako|upload\s+gareko|upload\s+vaye|file\s+ma|notes\s+ma)\b/i.test(effective)
    || /नोट्स|नोट|अध्ययन\s*सामग्री/.test(effective);
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

  return { kind, filters, query: searchQuery(effective, filters), message: effective };
}

const tool = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }
});

const TOOLS = [
  tool('search_notes', 'Search uploaded library notes and study materials by title, topic, or content. Shortlists matching candidate files and returns extracted passages from inside the files.', { query: { type: 'string', description: 'Topic, concept, or title to search in notes' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string', description: 'Explicit subject only; omit if only a topic is given' } }, ['query']),
  tool('read_note_file', 'Read inside an uploaded study material or note file by file ID to extract its detailed text content on a topic. Use this to read the explanation from a shortlisted note file.', { file_id: { type: 'integer', minimum: 1, description: 'The ID of the file to read' }, topic: { type: 'string', description: 'The topic or keyword to search for inside the file' } }, ['file_id']),
  tool('get_syllabus', 'Get actual BIT syllabus for one exact semester. Ask if semester is missing.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, query: { type: 'string' } }, []),
  tool('get_routine', 'Get actual published examination schedule (routine) for one exact semester. Note: Only examination schedules are stored in routine; no daily class lecture timetable exists. Never invent dates. Ask if semester is missing.', { semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' }, query: { type: 'string' } }, []),
  tool('search_posts', 'Search community posts and discussions on Semester Library. Returns recent posts matching the query that the student is authorized to see.', { query: { type: 'string', description: 'Topic or keyword to search for in posts' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query']),
  tool('search_notices', 'Search official notices and announcements posted on Semester Library.', { query: { type: 'string', description: 'Topic or keyword to search for in notices' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query']),
  tool('search_assignments', 'Search coding assignments, deadlines, and submissions on Semester Library.', { query: { type: 'string', description: 'Assignment title, subject, or keyword' }, semester: { type: 'integer', minimum: 1, maximum: 8 }, subject: { type: 'string' } }, ['query'])
];

/**
 * @param {object} db
 * @param {object} route
 * @param {object} opts
 * @param {object} [opts.academicContext] - Server-resolved academic context (semester, cohort, role).
 *   SECURITY: This is the ONLY source of truth for semester authorization.
 */
function createTools(db, route, { signal, academicContext = null, searchNotes = notes.searchNotes } = {}) {
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
    if (['search_posts', 'search_notices', 'search_assignments'].includes(name) && !academicContext?.authenticated) {
      result = { clarification: 'Please sign in so I can check your current semester.' };
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
      if (semester && authorizedSemester && semester !== authorizedSemester) {
        result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show information for Semester ${authorizedSemester}.` };
      } else if (teacherSemesters && semester && !teacherSemesters.includes(semester)) {
        result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access information for your assigned semesters.` };
      } else {
        const effectiveSemester = semester || authorizedSemester || (teacherSemesters && teacherSemesters[0]);
        if (!effectiveSemester) result = { clarification: 'Which semester (1–8)?' };
        else if (authorizedSemester && effectiveSemester !== authorizedSemester) {
          result = { clarification: `You're registered in Semester ${authorizedSemester}. I can only show information for Semester ${authorizedSemester}.` };
        } else if (teacherSemesters && !teacherSemesters.includes(effectiveSemester)) {
          result = { clarification: `You are assigned to teach Semester(s) ${teacherSemesters.join(', ')}. You can only access information for your assigned semesters.` };
        } else if (name === 'get_syllabus') {
          const selected = courses.filter(c => semesterNumber(c.semester) === effectiveSemester && (!subject || c.title === subject));
          result = { semester: effectiveSemester, courses: selected };
        } else {
          let sql = `SELECT id, subject_name AS subject, subject_code, exam_date AS date, calendar, weekday AS day, exam_time AS time, room, semester, exam_type AS type FROM routine WHERE semester = ?`;
          const params = [effectiveSemester];
          if (subject) {
            const names = subjectAliases(subject).map(s => s.toLowerCase());
            sql += ` AND LOWER(TRIM(subject_name)) IN (${names.map(() => '?').join(',')})`;
            params.push(...names);
          }
          const rows = await db.all(sql + ' ORDER BY calendar ASC, exam_date ASC, id ASC', ...params);
          let filteredRows = rows.map(r => ({ ...r, date: r.examDate || r.examdate || r.date }));
          if (route.filters?.dateInfo?.date && filteredRows.length > 0) {
            const targetDate = route.filters.dateInfo.date;
            const onDate = filteredRows.filter(r => r.date === targetDate);
            if (onDate.length > 0) filteredRows = onDate;
          }
          result = { semester: effectiveSemester, routine: filteredRows, scheduleType: 'examination_schedule' };
        }
      }
    } else if (name === 'search_notes') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
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
      if (!result && subject && !isTeacherSubjectAllowed(subject)) {
        result = { clarification: `${subject} is not in your assigned teaching subjects.` };
      }
      if (!result) {
        if (!query && !subject) result = { clarification: 'Which subject or topic do you need notes for?' };
        else {
          const searchSem = authorizedSemester || semester || (teacherSemesters && teacherSemesters.length === 1 ? teacherSemesters[0] : undefined);
          let files = await searchNotes(db, { query, academicContext, semester: searchSem, subject: subject ? subjectAliases(subject) : undefined });
          let inferredSubject = null;
          if (!files.length && !subject) {
            const predictions = predictSubjects(query).filter(s => {
              if (!isTeacherSubjectAllowed(s)) return false;
              const cSem = semesterNumber(courses.find(c => c.title === s)?.semester);
              if (searchSem && cSem !== searchSem) return false;
              if (teacherSemesters && cSem && !teacherSemesters.includes(cSem)) return false;
              return true;
            });
            if (predictions.length > 1) result = { clarification: `Which subject do you mean: ${predictions.join(' or ')}?` };
            else if (predictions.length === 1) {
              inferredSubject = predictions[0];
              const inferredSemester = searchSem || semesterNumber(courses.find(c => c.title === inferredSubject)?.semester);
              files = await searchNotes(db, { query: '', academicContext, semester: inferredSemester, subject: subjectAliases(inferredSubject) });
            }
          }
          if (!result) result = {
            files: files.slice(0, 3).map(f => ({
              id: f.id,
              title: f.title || f.originalName,
              originalName: f.originalName,
              subject: f.subject,
              semester: f.semester,
              chapter: f.chapter,
              excerpt: f.excerpt || '',
              matchType: inferredSubject ? 'topic' : f.matchType,
              viewUrl: `/api/files/${f.id}/view`,
              downloadUrl: `/api/files/${f.id}/download`,
              extractedContent: f.extractedContent || null,
              hasContent: Boolean(f.extractedContent),
              sourceCitation: f.chapter ? `This is extracted from **${f.title || f.originalName}** (${f.subject || 'Study Material'}, Chapter ${f.chapter})` : `This is extracted from **${f.title || f.originalName}** (${f.subject || 'Study Material'})`,
              resourceCard: { type: 'note', id: f.id, title: f.title || f.originalName, subject: f.subject, semester: f.semester, action: 'open_note', deepLink: `/material/${f.id}`, viewUrl: `/api/files/${f.id}/view`, downloadUrl: `/api/files/${f.id}/download`, mobileRoute: `/material/${f.id}`, mobileParams: { id: f.id } }
            })),
            inferredSubject
          };
        }
      }
    } else if (name === 'read_note_file') {
      const fileId = Number(validatedArgs.file_id);
      if (!fileId) {
        result = { error: 'Please specify a valid file ID to read.' };
      } else {
        const fileContent = await notes.readNoteFileContent(db, fileId, {
          query: validatedArgs.topic || route.query,
          academicContext
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
          result = {
            ...fileContent,
            sourceCitation: fileContent.chapter
              ? `This is extracted from **${fileContent.title}** (${fileContent.subject || 'General'}, Chapter ${fileContent.chapter})`
              : `This is extracted from **${fileContent.title}** (${fileContent.subject || 'General'})`,
            resourceCard: {
              type: 'note',
              id: fileContent.id,
              title: fileContent.title,
              subject: fileContent.subject,
              semester: fileContent.semester,
              action: 'open_note',
              deepLink: `/material/${fileContent.id}`,
              viewUrl: `/api/files/${fileContent.id}/view`,
              downloadUrl: `/api/files/${fileContent.id}/download`,
              mobileRoute: `/material/${fileContent.id}`,
              mobileParams: { id: fileContent.id }
            }
          };
        }
      }
    } else if (name === 'search_posts') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      try {
        const posts = await aiSearch.searchPosts(db, academicContext, { query, limit: 5 });
        result = { posts, count: posts.length };
      } catch (e) {
        result = { posts: [], count: 0, error: 'Could not search posts right now.' };
      }
    } else if (name === 'search_notices') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      try {
        const notices = await aiSearch.searchNotices(db, academicContext, { query, limit: 5 });
        result = { notices, count: notices.length };
      } catch (e) {
        result = { notices: [], count: 0, error: 'Could not search notices right now.' };
      }
    } else if (name === 'search_assignments') {
      const query = typeof validatedArgs.query === 'string' ? validatedArgs.query.slice(0, 400) : route.query;
      if (subject && !isTeacherSubjectAllowed(subject)) {
        result = { assignments: [], count: 0, clarification: `${subject} is not in your assigned teaching subjects.` };
      } else {
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
      }
    }
    result = sanitizeUntrustedValue(result);
    results.push({ name, result });
    return result;
  }
  return { executeTool, results };
}

function formatToolResult(name, result) {
  if (result.clarification) return result.clarification;
  if (result.error) return result.error;
  if (name === 'search_notes') {
    if (!result.files || !result.files.length) return 'No matching notes found. Which subject or topic should I try?';
    const topFile = result.files[0];
    if (topFile.extractedContent) {
      const citation = topFile.chapter
        ? `This is extracted from **${topFile.title}** (${topFile.subject || 'General'}, Chapter ${topFile.chapter}):`
        : `This is extracted from **${topFile.title}** (${topFile.subject || 'General'}):`;
      let text = `Found note: **${topFile.title}**\n\n${citation}\n\n${topFile.extractedContent}`;
      if (result.files.length > 1) {
        text += `\n\n**Other shortlisted files:**\n` + result.files.slice(1).map(f => `- **${f.title}** (${f.subject || 'General'}${f.chapter ? `, Chapter ${f.chapter}` : ''})`).join('\n');
      }
      return text;
    }
    return result.inferredSubject ? `Closest match: **${result.inferredSubject}** notes.` : `Found ${result.files.length === 1 ? 'a matching note' : `${result.files.length} matching notes`}.`;
  }
  if (name === 'read_note_file') {
    if (result.error) return result.error;
    if (!result.hasContent) return `Could not read inside **${result.title}** (${result.message || 'scanned or empty document'}).`;
    const citation = result.sourceCitation ? `${result.sourceCitation}:` : `This is extracted from **${result.title}**:`;
    return `### ${result.title}\n\n${citation}\n\n${result.extractedContent}`;
  }
  if (name === 'get_routine') {
    if (!result.routine.length) return `No routine is published for semester ${result.semester} yet.`;
    return `**Semester ${result.semester} routine**\n\n` + result.routine.map(r => `- **${r.subject}** — ${r.date} ${r.calendar || '(calendar unconfirmed)'}${r.day ? ` (${r.day})` : ''}${r.time ? `, ${r.time}` : ''}${r.room ? `, Room ${r.room}` : ''}`).join('\n');
  }
  if (name === 'get_syllabus') {
    if (!result.courses.length) return `No matching syllabus found for semester ${result.semester}.`;
    return `**Semester ${result.semester} syllabus**\n\n` + result.courses.map(c => `- **${c.title}** (${c.code}) — ${c.credit} credits`).join('\n') + `\n\n[Full syllabus](/syllabus.html#${encodeURIComponent(`Year ${Math.ceil(result.semester / 2)}`)}/${encodeURIComponent(ROMANS[result.semester - 1])})`;
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
  return result.summary || "I couldn't find that in the university records.";
}

module.exports = {
  TOOLS,
  createTools,
  formatToolResult,
  routeQuery,
  extractFilters,
  semesterNumber,
  semesterAliases,
  subjectAliases,
  explicitSubjects,
  resolveSubject,
  predictSubjects,
  courses,
  SUBJECT_ALIASES,
  searchQuery,
  noticeIntent,
  postIntent,
  assignmentSearchIntent,
  academicRequest,
  codeRequest,
  mapsToBitSyllabus,
  isSmalltalkMessage,
  NON_BIT_ACADEMIC_OR_CODE
};
