'use strict';

/**
 * Kyana AI — Universal Academic Intelligence & Visual Learning Engine
 *
 * Transforms raw academic information into:
 * Raw academic information -> Understanding -> Structured explanation -> Visual learning -> Better student learning.
 *
 * Works across ALL courses, semesters (1–8), and academic disciplines:
 * Computer Science, Mathematics, Physics, Electronics, Chemistry, Engineering, Business, Economics, Accounting, and Management.
 */

const ACADEMIC_VISUAL_BLOCK_KINDS = [
  'syllabus',
  'diagram',
  'flowchart',
  'graph',
  'trace',
  'quiz',
  'roadmap'
];

const ALL_ALLOWED_VISUAL_BLOCK_KINDS = new Set([
  'attendance',
  'results',
  'assignments',
  'notes',
  'notices',
  'routine',
  'posts',
  'directory',
  ...ACADEMIC_VISUAL_BLOCK_KINDS,
  'comparison',
  'complexity',
  'timeline',
  'simulation',
  'code_preview',
  'illustration'
]);

const VISUAL_SECURITY_LIMITS = {
  MAX_PAYLOAD_BYTES: 32768,
  MAX_DIAGRAM_NODES: 24,
  MAX_CHART_POINTS: 50,
  MAX_TRACE_STEPS: 20,
  MAX_QUIZ_QUESTIONS: 10
};

const {
  getTemporalContext,
  calculateDaysRemaining,
  toDevanagariDigits
} = require('./temporal-intelligence');

const INTENTS = {
  ACADEMIC_EVENT: 'academic_event',
  ASSIGNMENT: 'assignment',
  ATTENDANCE: 'attendance',
  MARKS_RESULT: 'marks_result',
  ROUTINE: 'routine',
  ACADEMIC_CONCEPT: 'academic_concept',
  SYLLABUS: 'syllabus',
  CAMPUS_QUERY: 'campus_query'
};

/**
 * Deterministic physics calculator for projectile motion:
 * Given initial velocity v0 (m/s), launch angle thetaDeg (degrees), and gravity g (m/s^2),
 * computes exact time of flight, maximum height, horizontal range, and trajectory (x, y) points.
 */
function computeProjectileMetrics(v0 = 20, thetaDeg = 45, g = 9.8) {
  const safeV0 = Math.min(100, Math.max(1, Number(v0) || 20));
  const safeTheta = Math.min(89, Math.max(5, Number(thetaDeg) || 45));
  const safeG = Math.min(25, Math.max(1, Number(g) || 9.8));
  const rad = (safeTheta * Math.PI) / 180;
  const vx = safeV0 * Math.cos(rad);
  const vy = safeV0 * Math.sin(rad);
  const timeOfFlight = Number(((2 * vy) / safeG).toFixed(2));
  const maxHeight = Number(((vy * vy) / (2 * safeG)).toFixed(2));
  const range = Number((((safeV0 * safeV0) * Math.sin(2 * rad)) / safeG).toFixed(2));
  const trajectoryPoints = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = (timeOfFlight * i) / steps;
    const x = Number((vx * t).toFixed(2));
    const y = Number(Math.max(0, vy * t - 0.5 * safeG * t * t).toFixed(2));
    trajectoryPoints.push({ t: Number(t.toFixed(2)), x, y });
  }
  return {
    v0: safeV0,
    thetaDeg: safeTheta,
    g: safeG,
    vx: Number(vx.toFixed(2)),
    vy: Number(vy.toFixed(2)),
    timeOfFlight,
    maxHeight,
    range,
    trajectoryPoints
  };
}

/**
 * Deterministic wave function generator for y(x) = A * sin(2 * pi * f * x)
 */
function computeWaveSamples(amplitude = 2, frequency = 2, pointsCount = 25) {
  const safeAmp = Math.min(10, Math.max(0.5, Number(amplitude) || 2));
  const safeFreq = Math.min(10, Math.max(0.5, Number(frequency) || 2));
  const count = Math.min(48, Math.max(8, Number(pointsCount) || 25));
  const samples = [];
  for (let i = 0; i < count; i++) {
    const x = Number((i / (count - 1)).toFixed(3));
    const y = Number((safeAmp * Math.sin(2 * Math.PI * safeFreq * x)).toFixed(3));
    samples.push({ x, y });
  }
  return {
    amplitude: safeAmp,
    frequency: safeFreq,
    period: Number((1 / safeFreq).toFixed(3)),
    samples
  };
}

/**
 * Strict Structured Visual Payload Validator (Section 4 & Section 8).
 * Enforces an explicit component allowlist, payload size limits, node/point complexity caps,
 * and rejects executable HTML/JS, event handlers, or unsafe URLs.
 */
function validateVisualBlockPayload(kind, rawPayload) {
  const normKind = String(kind || '').trim().toLowerCase();
  if (!ALL_ALLOWED_VISUAL_BLOCK_KINDS.has(normKind)) {
    return { valid: false, reason: 'unknown_component_type', kind: normKind };
  }
  if (typeof rawPayload !== 'string' || !rawPayload.trim()) {
    return { valid: false, reason: 'empty_payload', kind: normKind };
  }
  const trimmed = rawPayload.trim();
  if (Buffer.byteLength(trimmed, 'utf8') > VISUAL_SECURITY_LIMITS.MAX_PAYLOAD_BYTES) {
    return { valid: false, reason: 'payload_too_large', kind: normKind };
  }

  // Reject executable content, scripts, SVG/DOM event attributes, prototype pollution keys, and dangerous/encoded protocols
  const dangerousPattern = /<script\b|<\/script>|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|java\s*&#|&#x0*6a;|\\u006a\s*avascript|<iframe\b|<object\b|<embed\b|<foreignObject\b|<animate\b|<set\b|xlink\s*:\s*href|\bon[a-z]{2,}\s*=|\beval\s*\(|new\s+Function\s*\(|"__proto__"|"constructor"\s*:|"prototype"\s*:/i;
  if (dangerousPattern.test(trimmed)) {
    return { valid: false, reason: 'unsafe_executable_content', kind: normKind };
  }

  if (trimmed.startsWith('{') || ['simulation', 'code_preview', 'illustration'].includes(normKind)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, reason: 'malformed_json_object', kind: normKind };
      }
      if (Array.isArray(parsed.nodes) && parsed.nodes.length > VISUAL_SECURITY_LIMITS.MAX_DIAGRAM_NODES) {
        return { valid: false, reason: 'diagram_complexity_exceeded', kind: normKind };
      }
      if (Array.isArray(parsed.series) && parsed.series.length > VISUAL_SECURITY_LIMITS.MAX_CHART_POINTS) {
        return { valid: false, reason: 'chart_points_exceeded', kind: normKind };
      }
      if (Array.isArray(parsed.steps) && parsed.steps.length > VISUAL_SECURITY_LIMITS.MAX_TRACE_STEPS) {
        return { valid: false, reason: 'trace_steps_exceeded', kind: normKind };
      }
      if (Array.isArray(parsed.questions) && parsed.questions.length > VISUAL_SECURITY_LIMITS.MAX_QUIZ_QUESTIONS) {
        return { valid: false, reason: 'quiz_questions_exceeded', kind: normKind };
      }
      if (normKind === 'simulation' && !parsed.simulationType) {
        return { valid: false, reason: 'missing_simulation_type', kind: normKind };
      }
      if (normKind === 'code_preview' && !parsed.html && !parsed.css && !parsed.code) {
        return { valid: false, reason: 'missing_code_preview_content', kind: normKind };
      }
      if (normKind === 'illustration' && !parsed.sceneType && !parsed.panels) {
        return { valid: false, reason: 'missing_illustration_scene', kind: normKind };
      }
      return { valid: true, kind: normKind, isJson: true, data: parsed };
    } catch (_) {
      return { valid: false, reason: 'malformed_json', kind: normKind };
    }
  }

  return { valid: true, kind: normKind, isJson: false, data: null };
}

// Course-level prerequisite and study-order intelligence derived from curriculum structure
const COURSE_PEDAGOGY_MAP = {
  CIT214: {
    prerequisites: [
      'C/C++ or Java fundamentals (functions, pointers/references, structures/classes)',
      'Arrays, loops, and basic memory allocation',
      'Basic discrete mathematics (sets, trees, graphs, and logarithmic growth)'
    ],
    keyConcepts: [
      'Asymptotic Complexity (Big-O, Omega, Theta) & Time-Space Tradeoffs',
      'Pointer-based Dynamic Data Structures (Singly, Doubly, Circular Linked Lists)',
      'LIFO Stacks, FIFO/Circular Queues & Call-Stack Recursion',
      'Hierarchical Trees (Binary Trees, BST, AVL Balancing, B-Trees, Heaps)',
      'Sorting & Searching (Divide-and-Conquer Merge/Quick Sort, Binary Search, Hashing)',
      'Graph Algorithms (BFS, DFS, Minimum Spanning Trees: Prim/Kruskal, Shortest Path: Dijkstra)'
    ],
    unitRelationships: [
      'Unit 1 (Complexity & ADTs) establishes how we measure efficiency across every structure in Units 2–7.',
      'Unit 2 (Linked Lists) introduces dynamic node-pointer manipulation required to build Linked Stacks/Queues (Unit 3), Trees (Unit 4), and Graph Adjacency Lists (Unit 7).',
      'Unit 3 (Stacks, Queues & Recursion) powers tree traversals (Unit 4), recursive Divide-and-Conquer sorting (Unit 5), and DFS/BFS graph exploration (Unit 7).',
      'Unit 4 (Trees) & Unit 5/6 (Sorting/Searching/Hashing) solve fast lookup and ordered indexing ($O(\\log n)$ vs $O(1)$ average).',
      'Unit 7 (Graphs) generalizes trees into arbitrary networks for routing, connectivity, and shortest-path optimization.'
    ],
    studySequence: [
      'Phase 1 — Foundations: Master Big-O analysis and pointer/struct manipulation (Unit 1 & Unit 2).',
      'Phase 2 — Linear Structures & Recursion: Implement Stack, Queue, expression evaluation, and call-stack recursion traces (Unit 3).',
      'Phase 3 — Non-Linear Hierarchies: Practice BST insertion/deletion, AVL rotations, and tree traversals by hand and in code (Unit 4).',
      'Phase 4 — Efficiency & Indexing: Compare $O(n^2)$ vs $O(n \\log n)$ sorting, binary search, and hash collision resolution (Units 5 & 6).',
      'Phase 5 — Network Algorithms: Trace BFS, DFS, Dijkstra, Prim, and Kruskal step-by-step on weighted graphs (Unit 7).'
    ],
    studyTips: [
      'Always draw box-and-arrow pointer diagrams before writing Linked List, Tree, or Graph code.',
      'Trace edge cases first: empty structure, single-element structure, and deleting the head/root node.',
      'Compare every algorithm by best, average, and worst-case time complexity plus auxiliary space.'
    ]
  },
  CIT213: {
    prerequisites: [
      'Basic programming logic and file organization concepts',
      'Set theory, relations, and predicate logic from Discrete Mathematics'
    ],
    keyConcepts: [
      'Three-Schema Architecture, Data Independence & ER Modeling',
      'Relational Model, Relational Algebra & SQL (DDL, DML, Joins, Subqueries, Views)',
      'Functional Dependencies & Normalization (1NF, 2NF, 3NF, BCNF, 4NF)',
      'Transaction Processing, ACID Properties & Serializability',
      'Concurrency Control (Two-Phase Locking, Timestamp Ordering, Deadlock Handling) & Crash Recovery'
    ],
    unitRelationships: [
      'Conceptual ER Models (Unit 2) map directly into Relational Schemas and SQL Tables (Units 3 & 4).',
      'Normalization (Unit 5) refines those relational tables to eliminate redundancy and update anomalies.',
      'Query Processing & Indexing (Unit 6) optimize how SQL queries execute over normalized tables.',
      'Transactions, Concurrency Control & Recovery (Units 7 & 8) guarantee ACID safety when multiple users access the database simultaneously.'
    ],
    studySequence: [
      'Phase 1 — Conceptual Design: ER diagrams, cardinalities, and weak entities (Units 1 & 2).',
      'Phase 2 — Relational & SQL Mastery: Relational algebra operators and complex SQL joins/aggregations (Units 3 & 4).',
      'Phase 3 — Schema Refinement: Attribute closure, canonical cover, and lossless 1NF–BCNF decomposition (Unit 5).',
      'Phase 4 — Internals & Reliability: Conflict serializability, 2PL, deadlock prevention, and log-based recovery (Units 6–8).'
    ],
    studyTips: [
      'Practice converting ER diagrams into SQL CREATE TABLE statements with primary and foreign key constraints.',
      'When solving Normalization problems, always compute the attribute closure $X^+$ first to identify candidate keys.',
      'Write and test every SQL query in a live relational database rather than memorizing syntax.'
    ]
  },
  CIT212: {
    prerequisites: [
      'Programming fundamentals and object-oriented concepts',
      'Basic understanding of software projects and team workflows'
    ],
    keyConcepts: [
      'SDLC Process Models (Waterfall, Incremental, Spiral, Agile & Scrum)',
      'Requirements Engineering (Functional vs Non-Functional Requirements, SRS)',
      'System Modeling & Architectural Design (Context, DFD, UML Use Case/Class/Sequence Diagrams)',
      'Software Testing Strategies (Unit, Integration, System, Black-Box vs White-Box Testing)',
      'Software Maintenance, Quality Assurance (SQA), and Project Estimation (COCOMO)'
    ],
    unitRelationships: [
      'Process Models (Unit 1) define the lifecycle framework within which Requirements (Unit 2) are gathered.',
      'Requirements feed directly into System Modeling and Architectural Design (Units 3 & 4).',
      'Implementation & Testing (Unit 5) verify the design against the SRS requirements.',
      'Project Management, Estimation, and Quality Assurance (Units 6 & 7) govern cost, risk, and reliability across all phases.'
    ],
    studySequence: [
      'Phase 1 — Lifecycle & Requirements: Compare SDLC models and write testable functional/non-functional requirements.',
      'Phase 2 — Modeling & Architecture: Draw DFDs, UML diagrams, and layered/client-server architectures.',
      'Phase 3 — Verification & Management: Master equivalence partitioning, boundary-value analysis, and COCOMO estimation.'
    ],
    studyTips: [
      'Connect every SDLC phase to a real project you are building in Semester Library or Code Lab.',
      'Practice drawing clean Level-0/Level-1 DFDs and UML sequence diagrams for concrete scenarios like library borrowing or online banking.'
    ]
  }
};

/**
 * Parses numeric hours from a unit's `teachingHours` string (e.g. "10hrs" -> 10).
 */
function parseUnitHoursNumber(teachingHours) {
  if (!teachingHours) return 0;
  const m = String(teachingHours).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Splits a raw unit `topics` string into clean individual topic items.
 */
function parseUnitTopicItems(topicsText) {
  const raw = String(topicsText || '').trim();
  if (!raw) return [];

  // Check if numbered sub-topics like "1.1 ... 1.2 ... 1.3 ..." exist
  const numberedMatches = [...raw.matchAll(/(\d+\.\d+)\s+([\s\S]*?)(?=(?:\s+\d+\.\d+\s+)|$)/g)];
  if (numberedMatches.length > 0) {
    return numberedMatches.map(m => ({
      code: m[1].trim(),
      text: m[2].replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')
    }));
  }

  // Otherwise split by semicolons or major comma-separated phrases
  return raw
    .split(/[;\n]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, idx) => ({
      code: null,
      text: text.replace(/[.;]+$/, '')
    }));
}

/**
 * Builds pedagogical synthesis (prerequisites, key concepts, unit relationships, study sequence, study tips)
 * for any course in `public/syllabus-data.json`, adapting dynamically to the course's actual units and nature.
 */
function deriveCoursePedagogy(course, details) {
  const code = String(course?.code || '').trim().toUpperCase();
  if (COURSE_PEDAGOGY_MAP[code]) {
    return COURSE_PEDAGOGY_MAP[code];
  }

  const units = Array.isArray(details?.units) ? details.units : [];
  const semNo = Number(course?.semesterNo) || 1;
  const nature = String(course?.nature || '').toUpperCase();
  const hasLab = Boolean(details?.lab || nature.includes('PR') || nature.includes('LAB'));

  const prerequisites = [];
  if (semNo <= 1) {
    prerequisites.push('Secondary-level mathematics and analytical problem-solving fundamentals');
    prerequisites.push('Basic computer literacy and logical reasoning');
  } else {
    prerequisites.push(`Foundational concepts from earlier BIT semesters (Semesters 1–${semNo - 1})`);
    if (/programming|java|web|mobile|software|data|cloud|ai|compiler/i.test(course?.title || '')) {
      prerequisites.push('Core programming constructs (variables, control flow, functions, and data structures)');
    }
    if (/math|statistics|numerical|discrete|graphics|ai|mining/i.test(course?.title || '')) {
      prerequisites.push('Algebra, calculus, matrices, and discrete mathematical notation');
    }
  }

  const keyConcepts = units.slice(0, 6).map(u => {
    const subItems = parseUnitTopicItems(u.topics);
    const preview = subItems.slice(0, 2).map(x => x.text).join('; ');
    return preview ? `${u.title} (${preview})` : u.title;
  });

  const unitRelationships = [];
  if (units.length >= 2) {
    unitRelationships.push(
      `Unit 1 (${units[0].title}) establishes the foundational definitions and theoretical framework for ${course?.title || 'the course'}.`
    );
    if (units.length >= 4) {
      const midUnits = units.slice(1, -1).map(u => `Unit ${u.unitNumber} (${u.title})`).join(', ');
      unitRelationships.push(
        `Core building blocks in ${midUnits} progressively deepen the mechanisms, models, and problem-solving techniques.`
      );
    }
    const lastU = units[units.length - 1];
    unitRelationships.push(
      `Unit ${lastU.unitNumber} (${lastU.title}) synthesizes earlier units into real-world applications, advanced analysis, or system integration.`
    );
  }

  const sortedByHours = [...units].sort((a, b) => parseUnitHoursNumber(b.teachingHours) - parseUnitHoursNumber(a.teachingHours));
  const highestHoursUnits = sortedByHours.slice(0, 2).map(u => `Unit ${u.unitNumber} (${u.title}${u.teachingHours ? `, ${u.teachingHours}` : ''})`);

  const studySequence = [
    units[0] ? `Start with Unit 1 (${units[0].title}) to build core terminology and conceptual mental models.` : 'Begin with foundational definitions and course objectives.',
    highestHoursUnits.length > 0
      ? `Prioritize high-weightage core units: ${highestHoursUnits.join(' and ')}.`
      : 'Work sequentially through the middle units, practicing examples after each topic.',
    hasLab
      ? 'Pair each theoretical unit immediately with its corresponding laboratory/practical implementation.'
      : 'Summarize key definitions, formulas, and conceptual comparisons after completing each unit.'
  ];

  const studyTips = [
    'Review the official unit topics alongside past questions and Semester Library notes to focus your revision.',
    hasLab
      ? 'Complete all practical/lab exercises hands-on — implementing concepts in code or lab setups reinforces theoretical understanding.'
      : 'Create concise concept maps and comparison tables to connect related units before exams.'
  ];

  return {
    prerequisites,
    keyConcepts,
    unitRelationships,
    studySequence,
    studyTips
  };
}

/**
 * Classifies the sub-scope of a syllabus/course question so Kyana adapts the response
 * to the exact scope requested (full course vs single unit vs practicals vs hours vs unit relationships).
 */
function classifySyllabusSubScope(message, requestedUnit = null) {
  const text = String(message || '').trim();
  if (requestedUnit) return 'unit_focus';

  const unitMatch = text.match(/\b(?:unit|chapter)\s*[-:#.]?\s*(\d{1,2})\b/i);
  if (unitMatch) return 'unit_focus';

  if (/\b(practical\s+requirements?|lab(?:oratory)?\s+requirements?|practical\s+syllabus|lab\s+exercises?|lab\s+work|what\s+are\s+the\s+practicals?)\b/i.test(text)) {
    return 'practical_focus';
  }
  if (/\b(how\s+many\s+hours|hours?\s+(?:are\s+)?allocated|teaching\s+hours|credit\s+hours|course\s+workload|workload\s+distribution|unit[-\s]?wise\s+hours)\b/i.test(text)) {
    return 'hours_workload_focus';
  }
  if (/\b(relationship\s+between\s+(?:different\s+)?units|how\s+(?:do|are)\s+units\s+(?:related|connected)|unit\s+progression|connection\s+between\s+units|prerequisite\s+concepts?)\b/i.test(text)) {
    return 'unit_relationship_focus';
  }
  if (/\b(important\s+topics?|key\s+topics?|most\s+important\s+concepts?|high[-\s]?weightage|suggested\s+study\s+order|study\s+sequence|how\s+to\s+study\s+this\s+course)\b/i.test(text)) {
    return 'important_topics_focus';
  }
  return 'full_course';
}

/**
 * Universal Academic Question Classifier (Section 3, Categories A–H & Section 4 Visual Selection Engine).
 */
function classifyAcademicQuestion(message, route = {}, history = []) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const kind = route?.kind || '';

  // Detect academic discipline
  let discipline = 'computer_science';
  if (/\b(ohm'?s\s+law|electromagnetic\s+induction|faraday|lenz|magnetic\s+flux|electric\s+field|circuit|resistor|capacitor|inductor|voltage|current|kinematics|projectile|newton'?s\s+law|thermodynamics|optics|pendulum|doppler|photoelectric|physics|diode|transistor|bjt|op-?amp|kirchhoff)\b|भौतिक\s*शास्त्र/i.test(text)) {
    discipline = 'physics';
  } else if (/\b(differential\s+equation|matrix|matrices|determinant|eigenvalue|eigenvector|calculus|derivative|integral|integration|limit|taylor\s+series|laplace|fourier|probability\s+distribution|normal\s+distribution|binomial|poisson|bayes|variance|standard\s+deviation|numerical\s+method|newton-raphson|bisection|simpson|trapezoidal|permutation|combination)\b|गणित/i.test(text)) {
    discipline = 'mathematics';
  } else if (/\b(chemistry|chemical\s+bonding|molarity|molality|ph\b|acid|base|titration|oxidation|reduction|redox|electrochemistry|kinetics|equilibrium|ideal\s+gas)\b|रसायन/i.test(text)) {
    discipline = 'chemistry';
  } else if (/\b((?<!database\s)management|economics|accounting|entrepreneurship|marketing|finance|balance\s+sheet|trial\s+balance|double\s+entry|supply\s+and\s+demand|elasticity|swot|maslow|herzberg|leadership|business\s+communication)\b/i.test(text)) {
    discipline = 'business_management';
  } else if (/\b(microprocessor|8085|8086|digital\s+logic|k-?map|flip-?flop|multiplexer|alu|pipelining|wireless|antenna|modulation)\b/i.test(text)) {
    discipline = 'engineering';
  }

  // Category G: Academic resources (notes, files, materials)
  if (kind === 'notes') {
    return {
      category: 'academic_resources',
      subScope: 'resource_search',
      discipline,
      recommendedVisuals: ['notes'],
      needsInteractiveQuiz: false,
      needsAlgorithmTrace: false
    };
  }

  // Category A: Syllabus and course questions
  const isSyllabusQuery = kind === 'syllabus' || (
    /\b(syllabus|curriculum|course\s+overview|overview\s+of|what\s+will\s+i\s+study\s+in|what\s+is\s+unit\s+\d+|explain\s+unit\s+\d+|important\s+topics\s+in\s+this\s+course|practical\s+requirements|hours\s+allocated\s+to\s+each\s+unit|relationship\s+between\s+(?:different\s+)?units)\b/i.test(text)
  );
  if (isSyllabusQuery) {
    const subScope = classifySyllabusSubScope(text, route?.filters?.unitNumber);
    return {
      category: 'syllabus_course',
      subScope,
      discipline,
      recommendedVisuals: subScope === 'unit_focus' ? ['syllabus'] : ['syllabus', 'roadmap'],
      needsInteractiveQuiz: false,
      needsAlgorithmTrace: false
    };
  }

  // Category F: Exam preparation, revision plans, and MCQs
  if (/\b(mcq|mcqs|multiple\s+choice|quiz|test\s+me|practice\s+questions?|important\s+questions?|revision\s+notes?|revision\s+plan|study\s+plan|prepare\s+.*revision|before\s+(?:my\s+)?exam|exam\s+prep(?:aration)?)\b/i.test(text)) {
    const asksMcq = /\b(mcq|mcqs|multiple\s+choice|quiz|test\s+me)\b/i.test(text);
    const asksPlan = /\b(revision\s+plan|study\s+plan|roadmap|schedule|prepare|important\s+topics)\b/i.test(text);
    return {
      category: 'exam_prep',
      subScope: asksMcq ? 'mcq_quiz' : (asksPlan ? 'revision_plan' : 'exam_questions'),
      discipline,
      recommendedVisuals: [
        ...(asksMcq ? ['quiz'] : []),
        ...(asksPlan ? ['roadmap'] : []),
        ...(!asksMcq && !asksPlan ? ['roadmap', 'quiz'] : [])
      ],
      needsInteractiveQuiz: true,
      needsAlgorithmTrace: false
    };
  }

  // Category E: Comparisons and conceptual differences
  if (/\b(vs\.?|versus|compare|comparison|difference\s+between|differences?\s+between|farak\s+k\s+ho|distinguish\s+between|pros?\s+and\s+cons?)\b|फरक\s*के\s*छ/i.test(text)) {
    const visuals = ['comparison_table'];
    if (/\b(sort|search|complexity|big-?o|time\s+complexity|array.*linked\s+list)\b/i.test(text)) {
      visuals.push('graph');
    } else if (/\b(tcp|udp|osi|http|client|server|compiler|interpreter|stack|queue|ram|rom)\b/i.test(text)) {
      visuals.push('diagram');
    }
    return {
      category: 'comparison',
      subScope: 'side_by_side_comparison',
      discipline,
      recommendedVisuals: visuals,
      needsInteractiveQuiz: false,
      needsAlgorithmTrace: false
    };
  }

  // Category D: Mathematical, statistical, and physics numerical/formula questions
  if (
    discipline === 'mathematics' ||
    (discipline === 'physics' && /\b(solve|calculate|numerical|derive|derivation|formula|ohm'?s\s+law|equation)\b/i.test(text)) ||
    /\b(solve|derive|derivation|integrate|differentiate|eigenvalue|matrix|matrices|differential\s+equation|probability\s+distribution|numerical)\b/i.test(text)
  ) {
    const visuals = [];
    if (/\b(ohm'?s\s+law|circuit|kirchhoff|rc\s+circuit|rlc|faraday|electromagnetic\s+induction)\b/i.test(text)) {
      visuals.push('diagram', 'graph');
    } else if (/\b(distribution|normal|gaussian|binomial|poisson|function|plot|graph|parabola|sine|cosine|exponential|logarithm|growth)\b/i.test(text)) {
      visuals.push('graph');
    }
    return {
      category: 'math_numerical',
      subScope: 'step_by_step_derivation',
      discipline,
      recommendedVisuals: visuals,
      needsInteractiveQuiz: false,
      needsAlgorithmTrace: false
    };
  }

  // Category C: Programming and algorithm questions
  if (
    /\b(merge\s*sort|quick\s*sort|insertion\s*sort|bubble\s*sort|selection\s*sort|heap\s*sort|binary\s+search|linear\s+search|dijkstra|bfs|dfs|breadth[- ]first|depth[- ]first|kruskal|prim|dynamic\s+programming|knapsack|linked\s+list|doubly\s+linked|stack|queue|circular\s+queue|binary\s+search\s+tree|bst|avl\s+tree|b-?tree|hashing|hash\s+table|time\s+complexity|o\(log\s*n\)|big-?o|implement|write\s+a\s+program|in\s+c\+\+|in\s+c\b|in\s+java|in\s+python|algorithm)\b/i.test(text)
  ) {
    const visuals = ['trace'];
    if (/(?:\bcomplexity\b|o\(log\s*n\)|o\(n\)|\bbig-?o\b|\bgrowth\b|\bperformance\b)/i.test(text)) {
      visuals.push('graph');
    } else {
      visuals.push('flowchart');
    }
    return {
      category: 'programming_algorithm',
      subScope: 'algorithm_and_code',
      discipline: 'computer_science',
      recommendedVisuals: visuals,
      needsInteractiveQuiz: false,
      needsAlgorithmTrace: true
    };
  }

  // Category B: Individual academic concepts (CS, Physics, Chemistry, Engineering, Management)
  const visuals = [];
  if (/\b(recursion|recursive|call\s+stack)\b/i.test(text)) {
    visuals.push('trace', 'diagram');
  } else if (/\b(architecture|cpu|alu|microprocessor|osi|tcp|udp|network|operating\s+system|process|deadlock|paging|normalization|1nf|2nf|3nf|bcnf|er\s+diagram|electromagnetic\s+induction|faraday|circuit|ohm)\b/i.test(text)) {
    visuals.push('diagram');
  }

  return {
    category: 'concept_explanation',
    subScope: 'concept_teaching',
    discipline,
    recommendedVisuals: visuals,
    needsInteractiveQuiz: false,
    needsAlgorithmTrace: false
  };
}

/**
 * Intelligent Visualization Decision Engine (Section 2).
 * Implements the full decision pipeline:
 * Student Question -> Intent Classification -> Academic Understanding -> Explanation Planning -> Visual Selection
 *
 * Automatically determines whether a response genuinely benefits from visual support
 * or whether plain text is sufficient (never forcing visuals into simple factual lookups).
 */
function planVisualExplanation(message, route = {}, history = []) {
  const text = String(message || '').trim();
  const baseClassification = classifyAcademicQuestion(text, route, history);

  // 1. Detect simple factual questions where plain text is sufficient
  const isSimpleFactOrLookup =
    !text ||
    text.length < 6 ||
    /^(?:hi|hello|hey|namaste|thanks|thank\s+you|ok|okay)\b/i.test(text) ||
    /^(?:what\s+does\s+[a-z0-9]+\s+stand\s+for|full\s+form\s+of\s+[a-z0-9]+|who\s+(?:invented|created|founded|discovered|wrote)\s+[^?]+|when\s+was\s+[^?]+\s+(?:invented|created|released)|what\s+is\s+the\s+course\s+code\s+of|how\s+many\s+credits\s+is)\b/i.test(text) ||
    (/^what\s+is\s+\d+\s*[+\-*/]\s*\d+\??$/i.test(text)) ||
    (/\b(?:in\s+one\s+sentence|in\s+one\s+line|short\s+definition|yes\s+or\s+no)\b/i.test(text)) ||
    (/^(?:define|what\s+is\s+(?:an?\s+)?)(?:ip\s+address|port\s+\d+|port\s+number|polymorphism|variable|constant|boolean(?:\s+data\s+type)?|primary\s+key|foreign\s+key|ram|rom|compiler|interpreter|bytecode|dns|url|mac\s+address|subnet\s+mask|default\s+gateway)\b/i.test(text) && !/(?:diagram|visual|simulate|graph|flowchart|compare|difference|trace)/i.test(text));

  if (isSimpleFactOrLookup) {
    return {
      needsVisual: false,
      subject: route?.filters?.subject || 'General',
      discipline: baseClassification.discipline,
      questionType: 'simple_fact',
      complexity: 'simple',
      cognitiveDimensions: [],
      explanationPlan: ['Direct 1-2 sentence factual answer'],
      primaryVisualType: null,
      visualComponents: [],
      rationale: 'Simple factual or one-line lookup is best answered with concise text.'
    };
  }

  const cognitiveDimensions = [];
  if (/\b(flow|request|response|handshake|session|cookie|lifecycle|pipeline|process|step|stage|http|api|client|server)\b/i.test(text)) {
    cognitiveDimensions.push('processes', 'relationships');
  }
  if (/\b(tree|graph|linked\s+list|stack|queue|normalization|1nf|2nf|3nf|bcnf|schema|er\s+diagram|table|architecture|osi|memory|box\s+model|selector|css|html)\b/i.test(text)) {
    cognitiveDimensions.push('structures', 'spatial');
  }
  if (/\b(projectile|velocity|angle|wave|frequency|amplitude|ohm|circuit|electromagnetic|induction|faraday|lenz|force|field|3d|coordinate|vector|derivative|integral|differential|matrix|probability|distribution)\b/i.test(text)) {
    cognitiveDimensions.push('calculations', 'spatial');
  }
  if (/\b(vs\.?|versus|compare|comparison|difference\s+between|differences?\s+between|pros?\s+and\s+cons?)\b/i.test(text)) {
    cognitiveDimensions.push('relationships');
  }

  // Case 1: CSS Box Model -> Interactive Box Model Simulation + Code Preview
  if (/\b(css\s+box\s+model|box\s+model|margin\s+and\s+padding|padding\s+and\s+margin)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Web Technology I',
      discipline: 'web_development',
      questionType: 'interactive_css_box_model',
      complexity: 'informational',
      cognitiveDimensions: ['spatial', 'interactive_parameters', 'code_styling'],
      explanationPlan: [
        'Define the 4 concentric layers of the CSS Box Model (Content, Padding, Border, Margin)',
        'Provide an interactive CSS Box Model demonstration with adjustable padding and margin sliders',
        'Show how box-sizing: border-box vs content-box affects total element width'
      ],
      primaryVisualType: 'simulation',
      visualComponents: ['simulation', 'code_preview'],
      rationale: 'Spatial box layers are understood fastest by interactively adjusting padding and margin.'
    };
  }

  // Case 2: CSS Selectors / HTML & CSS Styling -> Live HTML/CSS Concept Demonstration (code_preview)
  if (/\b(css\s+selectors?|what\s+is\s+a\s+selector\s+in\s+css|html\s+and\s+css|css\s+styling|class\s+selector|id\s+selector|flexbox|css\s+grid)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Web Technology I',
      discipline: 'web_development',
      questionType: 'code_styling_preview',
      complexity: 'informational',
      cognitiveDimensions: ['code_styling', 'structures'],
      explanationPlan: [
        'Explain how CSS selectors target HTML elements (Element, .class, #id, attribute, pseudo-class)',
        'Render a tabbed HTML / CSS / Live Preview demonstration with highlighted selectors',
        'Summarize specificity rules (#id > .class > element)'
      ],
      primaryVisualType: 'code_preview',
      visualComponents: ['code_preview'],
      rationale: 'HTML/CSS examples with highlighted selectors and a live preview make selector targeting concrete.'
    };
  }

  // Case 2.5: TCP 3-Way Handshake / Connection Establishment -> Sequence Diagram
  if (/\b(tcp\s+(?:3[- ]way\s+)?handshake|three[- ]way\s+handshake|tcp\s+connection|syn[- ]ack)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Computer Networks',
      discipline: 'networking',
      questionType: 'protocol_sequence_flow',
      complexity: 'informational',
      cognitiveDimensions: ['processes', 'relationships'],
      explanationPlan: [
        'Explain reliable connection establishment via synchronization (SYN) and acknowledgement (ACK)',
        'Render a 3-step Sequence Diagram: SYN -> SYN-ACK -> ACK',
        'Explain sequence numbers and connection states (LISTEN, SYN-SENT, SYN-RECEIVED, ESTABLISHED)'
      ],
      primaryVisualType: 'diagram',
      visualComponents: ['diagram'],
      rationale: 'The TCP 3-way handshake is inherently a time-sequenced exchange best illustrated as a sequence diagram.'
    };
  }

  // Case 3: Session and Cookies / HTTP / API -> Sequence & Flow Diagram
  if (/\b(sessions?|cookies?|what\s+is\s+http\b|http\s+request|how\s+does\s+http\s+work|what\s+is\s+an?\s+api\b|rest\s+api|client[- ]server)\b/i.test(text)) {
    const isSessionCookie = /\b(sessions?|cookies?)\b/i.test(text);
    return {
      needsVisual: true,
      subject: 'Web Technology / Computer Networks',
      discipline: 'networking',
      questionType: 'protocol_sequence_flow',
      complexity: 'informational',
      cognitiveDimensions: ['processes', 'relationships'],
      explanationPlan: [
        'Explain the core communication problem (stateless HTTP vs stateful identity or request-response cycle)',
        'Render a step-by-step Browser -> Server -> Database -> Browser sequence diagram',
        ...(isSessionCookie ? ['Compare Cookies and Sessions side-by-side in a structured table'] : ['Show concrete request/response headers and status codes'])
      ],
      primaryVisualType: 'diagram',
      visualComponents: isSessionCookie ? ['diagram', 'comparison_table'] : ['diagram'],
      rationale: 'Protocol handshakes and client-server roundtrips require a sequence/flow diagram.'
    };
  }

  // Case 4: DBMS Normalization -> Database Table Examples & Comparison + Schema Diagram
  if (/\b(normalization|1nf|2nf|3nf|bcnf|functional\s+dependenc(?:y|ies)|unnormalized)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Database Management System',
      discipline: 'database',
      questionType: 'schema_normalization',
      complexity: 'complex',
      cognitiveDimensions: ['structures', 'relationships'],
      explanationPlan: [
        'Explain why normalization eliminates redundancy and insertion/update/deletion anomalies',
        'Show concrete before-and-after database table decompositions (UNF -> 1NF -> 2NF -> 3NF/BCNF)',
        'Render a structured normal-form comparison and dependency diagram'
      ],
      primaryVisualType: 'comparison',
      visualComponents: ['comparison', 'diagram'],
      rationale: 'Normalization is understood by seeing concrete table decompositions and normal-form rules.'
    };
  }

  // Case 5: Projectile Motion -> Physics Diagram + Interactive Simulation (velocity & angle sliders)
  if (/\b(projectile|projectile\s+motion|trajectory|launch\s+angle|range\s+of\s+a\s+projectile)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Physics / Mechanics',
      discipline: 'physics',
      questionType: 'physics_projectile_simulation',
      complexity: 'complex',
      cognitiveDimensions: ['calculations', 'spatial', 'interactive_parameters'],
      explanationPlan: [
        'Decompose initial velocity into independent horizontal (v_x = v_0 cos θ) and vertical (v_y = v_0 sin θ) components',
        'Present governing equations for Time of Flight (T), Maximum Height (H), and Horizontal Range (R)',
        'Provide an interactive Projectile Motion Simulator with adjustable initial velocity and launch angle sliders'
      ],
      primaryVisualType: 'simulation',
      visualComponents: ['simulation', 'illustration'],
      rationale: 'Projectile motion combines 2D vector decomposition with parameter-dependent parabolic trajectories.'
    };
  }

  // Case 6: Wave Frequency & Amplitude -> Interactive Wave Simulation
  if (/\b(wave\s+frequency|frequency\s+and\s+amplitude|amplitude\s+and\s+frequency|sine\s+wave|transverse\s+wave|harmonic\s+wave|wave\s+motion|interference\s+of\s+waves)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: 'Physics / Waves & Optics',
      discipline: 'physics',
      questionType: 'physics_wave_simulation',
      complexity: 'informational',
      cognitiveDimensions: ['spatial', 'interactive_parameters', 'calculations'],
      explanationPlan: [
        'Define wave parameters: Amplitude (A), Frequency (f), Wavelength (λ), Period (T = 1/f), and Wave Speed (v = fλ)',
        'Provide an interactive wave visualization with adjustable Amplitude and Frequency controls'
      ],
      primaryVisualType: 'simulation',
      visualComponents: ['simulation', 'illustration'],
      rationale: 'Interactive sliders let students immediately see how amplitude scales height and frequency compresses wavelength.'
    };
  }

  // Case 7: Electromagnetic Induction / Electric Field / Circuits / 3D Geometry -> Scientific Illustrations & Diagrams
  if (/\b(electromagnetic\s+induction|faraday|lenz|magnetic\s+flux|electric\s+field|dipole|3d\s+geometry|3d\s+coordinate|mitosis|meiosis|cell\s+structure)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: baseClassification.discipline === 'mathematics' ? 'Mathematics' : 'Physics / Science',
      discipline: baseClassification.discipline,
      questionType: 'scientific_illustration',
      complexity: 'informational',
      cognitiveDimensions: ['spatial', 'processes'],
      explanationPlan: [
        'State the physical/mathematical principle and governing equation clearly',
        'Render a vector scientific illustration and process flow diagram showing field lines, flux changes, or axes'
      ],
      primaryVisualType: 'illustration',
      visualComponents: ['illustration', 'diagram'],
      rationale: 'Spatial fields, circuits, and 3D coordinate systems require a dedicated scientific illustration.'
    };
  }

  // Case 8: Binary Search -> Interactive Binary Search Demonstration + Step-by-Step Trace + Complexity Graph
  if (/(?:\bbinary\s+search(?!\s+trees?)\b|o\(log\s*n\))/i.test(text) && baseClassification.category !== 'comparison') {
    return {
      needsVisual: true,
      subject: 'Data Structure and Algorithms',
      discipline: 'computer_science',
      questionType: 'algorithm_interactive_walkthrough',
      complexity: 'informational',
      cognitiveDimensions: ['processes', 'interactive_parameters', 'calculations'],
      explanationPlan: [
        'Explain the sorted-array precondition and midpoint halving invariant',
        'Provide an interactive Binary Search demonstration with target selection and step-by-step pointer narrowing',
        'Plot O(log n) vs O(n) growth to show why halving scales logarithmically'
      ],
      primaryVisualType: 'simulation',
      visualComponents: ['simulation', 'trace', 'graph'],
      rationale: 'Stepping through low/mid/high pointers interactively makes O(log n) halving intuitive.'
    };
  }

  // Case 9: Explicit Chart / Graph / Plot requests (bar chart, line graph, pie chart, scatter plot, function plot)
  if (/\b(bar\s+chart|line\s+graph|pie\s+chart|scatter\s+plot|plot\s+the\s+function|graph\s+of)\b/i.test(text)) {
    return {
      needsVisual: true,
      subject: route?.filters?.subject || 'Quantitative Analysis',
      discipline: baseClassification.discipline,
      questionType: 'quantitative_chart',
      complexity: 'informational',
      cognitiveDimensions: ['calculations', 'relationships'],
      explanationPlan: [
        'Summarize the underlying dataset or mathematical relationship',
        'Render a validated SVG chart with labeled axes, gridlines, and grounded values'
      ],
      primaryVisualType: 'graph',
      visualComponents: ['graph'],
      rationale: 'Quantitative distributions and function trends are best communicated via a chart.'
    };
  }

  // Fallback to baseClassification for comparisons, algorithms, syllabus, exam prep, notes, etc.
  const recVisuals = baseClassification.recommendedVisuals || [];
  const needsVisual = recVisuals.length > 0;
  return {
    needsVisual,
    subject: route?.filters?.subject || 'Academic Study',
    discipline: baseClassification.discipline,
    questionType: baseClassification.category,
    complexity: baseClassification.category === 'comparison' || baseClassification.category === 'programming_algorithm' ? 'complex' : 'informational',
    cognitiveDimensions: cognitiveDimensions.length > 0 ? cognitiveDimensions : ['structures'],
    explanationPlan: [
      'Direct explanation grounded in course context',
      ...(needsVisual ? ['Include structured visual learning blocks: ' + recVisuals.join(', ')] : [])
    ],
    primaryVisualType: recVisuals[0] || null,
    visualComponents: recVisuals,
    rationale: needsVisual
      ? ('Selected ' + recVisuals.join(', ') + ' based on ' + baseClassification.category + ' (' + baseClassification.discipline + ').')
      : 'Conceptual explanation where structured prose is sufficient.'
  };
}

/**
 * Formats a single course or unit into a comprehensive, grounded academic guide + ```syllabus visual block.
 * Explicitly distinguishes Official University Syllabus content from AI-generated explanations & study guidance.
 */
function formatRichCourseSyllabus(course, {
  semester = null,
  requestedUnit = null,
  subScope = 'full_course',
  syllabusDetails = null,
  syllabusLink = ''
} = {}) {
  const details = syllabusDetails || course.syllabusDetails || { objectives: '', units: [], textbooks: '', lab: '' };
  const units = Array.isArray(details.units) ? details.units : [];
  const semNum = semester || course.semesterNo || 1;
  const teacherList = Array.isArray(course.assignedTeachers) && course.assignedTeachers.length > 0
    ? course.assignedTeachers.join(', ')
    : null;
  const totalHours = units.reduce((acc, u) => acc + parseUnitHoursNumber(u.teachingHours), 0);
  const pedagogy = deriveCoursePedagogy({ ...course, semesterNo: semNum }, details);

  // 1. Unit-Specific Focus ("Explain Unit 4 of DSA", "What is Unit 3 about?")
  if (requestedUnit || subScope === 'unit_focus') {
    const targetUnitNo = Number(requestedUnit) || 1;
    const targetUnit = units.find(u => Number(u.unitNumber) === targetUnitNo);
    if (!targetUnit) {
      return `**${course.title}** (${course.code}) has ${units.length} official units (Units 1–${units.length}). Unit ${targetUnitNo} is not listed in the official syllabus.`;
    }

    const topicItems = parseUnitTopicItems(targetUnit.topics);
    const prevUnit = units.find(u => Number(u.unitNumber) === targetUnitNo - 1);
    const nextUnit = units.find(u => Number(u.unitNumber) === targetUnitNo + 1);
    const unitHrs = parseUnitHoursNumber(targetUnit.teachingHours);
    const workloadShare = totalHours > 0 && unitHrs > 0 ? `${Math.round((unitHrs / totalHours) * 100)}% of total course hours (${unitHrs} of ${totalHours} hrs)` : (targetUnit.teachingHours || 'Not specified');

    const visualPayload = {
      mode: 'unit_focus',
      courseTitle: course.title,
      courseCode: course.code,
      semester: semNum,
      credit: course.credit,
      nature: course.nature || null,
      instructor: teacherList,
      totalHours,
      unit: {
        unitNumber: targetUnit.unitNumber,
        title: targetUnit.title,
        teachingHours: targetUnit.teachingHours || null,
        hoursNumeric: unitHrs,
        workloadShare,
        topics: topicItems
      },
      connections: {
        buildsOn: prevUnit ? `Prior Unit (#${prevUnit.unitNumber} — ${prevUnit.title})` : 'Course foundational prerequisites',
        leadsTo: nextUnit ? `Next Unit (#${nextUnit.unitNumber} — ${nextUnit.title})` : 'Practical synthesis & final examination'
      },
      textbooks: details.textbooks || null
    };

    const lines = [
      `**${course.title}** (${course.code}) — **Unit ${targetUnit.unitNumber}: ${targetUnit.title}**${targetUnit.teachingHours && totalHours > 0 && unitHrs > 0 ? ` — ${targetUnit.teachingHours} (${Math.round((unitHrs / totalHours) * 100)}%)` : (targetUnit.teachingHours ? ` (${targetUnit.teachingHours})` : '')} · Semester ${semNum}`,
      '',
      '### Official University Syllabus — Unit Breakdown',
      `- **Unit ${targetUnit.unitNumber}: ${targetUnit.title}**${targetUnit.teachingHours && totalHours > 0 && unitHrs > 0 ? ` — ${targetUnit.teachingHours} (${Math.round((unitHrs / totalHours) * 100)}%)` : (targetUnit.teachingHours ? ` (${targetUnit.teachingHours})` : '')}${targetUnit.topics ? `\n  Topics: ${targetUnit.topics}` : ''}`
    ];

    if (details.textbooks) {
      lines.push(`\n**Textbooks & References:**\n${details.textbooks}`);
    }

    lines.push(
      '',
      '### AI Study Guide & Unit Connections',
      `- **Workload Allocation:** ${workloadShare}`,
      prevUnit ? `- **Builds On:** Prior Unit (#${prevUnit.unitNumber} — ${prevUnit.title})` : `- **Foundation:** Core introductory unit for ${course.title}`,
      nextUnit ? `- **Prepares You For:** Next Unit (#${nextUnit.unitNumber} — ${nextUnit.title})` : `- **Capstone Unit:** Completes the ${course.title} syllabus sequence`,
      `- **Key Subtopics to Master:** ${topicItems.map(t => t.text).join(' · ') || targetUnit.title}`,
      '',
      '```syllabus',
      JSON.stringify(visualPayload),
      '```'
    );

    if (syllabusLink) lines.push('', syllabusLink);
    return lines.join('\n');
  }

  // 2. Practical / Laboratory Focus ("What are the practical requirements in DSA?")
  if (subScope === 'practical_focus') {
    const lines = [
      `**${course.title}** (${course.code}) — **Practical & Laboratory Requirements** (Semester ${semNum}, ${course.credit} credits${course.nature ? `, Nature: ${course.nature}` : ''})`,
      '',
      '### Official University Syllabus — Laboratory Requirements',
      details.lab
        ? details.lab
        : 'No separate laboratory exercise list is specified in the official syllabus for this course.',
      '',
      '### AI Practical Study Recommendations',
      ...(pedagogy.studyTips || []).map(tip => `- ${tip}`)
    ];
    if (syllabusLink) lines.push('', syllabusLink);
    return lines.join('\n');
  }

  // 3. Hours & Workload Focus ("How many hours are allocated to each unit in DSA?")
  if (subScope === 'hours_workload_focus') {
    const visualPayload = {
      mode: 'workload_focus',
      courseTitle: course.title,
      courseCode: course.code,
      semester: semNum,
      credit: course.credit,
      nature: course.nature || null,
      totalHours,
      units: units.map(u => {
        const hrs = parseUnitHoursNumber(u.teachingHours);
        return {
          unitNumber: u.unitNumber,
          title: u.title,
          teachingHours: u.teachingHours || 'N/A',
          hoursNumeric: hrs,
          sharePct: totalHours > 0 ? Math.round((hrs / totalHours) * 100) : 0,
          topics: parseUnitTopicItems(u.topics)
        };
      })
    };

    const lines = [
      `**${course.title}** (${course.code}) — **Unit-Wise Teaching Hours & Workload Allocation** (${totalHours > 0 ? `${totalHours} total theory hours, ` : ''}${course.credit} credits, Semester ${semNum})`,
      '',
      '### Official Unit Hours Breakdown',
      ...units.map(u => {
        const hrs = parseUnitHoursNumber(u.teachingHours);
        const pct = totalHours > 0 && hrs > 0 ? ` — **${Math.round((hrs / totalHours) * 100)}%** of theory hours` : '';
        return `- **Unit ${u.unitNumber}: ${u.title}** (${u.teachingHours || 'Hours not specified'})${pct}`;
      }),
      '',
      '```syllabus',
      JSON.stringify(visualPayload),
      '```'
    ];
    if (syllabusLink) lines.push('', syllabusLink);
    return lines.join('\n');
  }

  // 4. Full Course Academic Guide (also covers unit_relationship_focus & important_topics_focus with complete context)
  const visualPayload = {
    mode: 'full_course',
    courseTitle: course.title,
    courseCode: course.code,
    semester: semNum,
    credit: course.credit,
    nature: course.nature || null,
    instructor: teacherList,
    totalHours,
    officialObjectives: details.objectives || null,
    officialLab: details.lab || null,
    officialTextbooks: details.textbooks || null,
    units: units.map(u => {
      const hrs = parseUnitHoursNumber(u.teachingHours);
      return {
        unitNumber: u.unitNumber,
        title: u.title,
        teachingHours: u.teachingHours || null,
        hoursNumeric: hrs,
        sharePct: totalHours > 0 ? Math.round((hrs / totalHours) * 100) : 0,
        topics: parseUnitTopicItems(u.topics)
      };
    }),
    aiGuidance: {
      prerequisites: pedagogy.prerequisites,
      keyConcepts: pedagogy.keyConcepts,
      unitRelationships: pedagogy.unitRelationships,
      studySequence: pedagogy.studySequence,
      studyTips: pedagogy.studyTips
    }
  };

  const teacherInfo = teacherList ? ` — Taught by: ${teacherList}` : '';
  const natureInfo = course.nature ? `, Nature: ${course.nature}` : '';
  const lines = [
    `**${course.title}** (${course.code}) — ${course.credit} credits (Semester ${semNum}${natureInfo}${totalHours > 0 ? `, ${totalHours} Theory Hrs` : ''})${teacherInfo}`
  ];

  if (details.objectives) {
    lines.push(`\n**Learning Objectives:** *(Official University Syllabus)*\n${details.objectives}`);
  }

  if (units.length > 0) {
    lines.push(`\n**Course Units & Contents:** *(Official University Syllabus)*`);
    for (const u of units) {
      const hrs = parseUnitHoursNumber(u.teachingHours);
      const pct = totalHours > 0 && hrs > 0 ? ` (${Math.round((hrs / totalHours) * 100)}%)` : '';
      const hrsLabel = u.teachingHours ? ` — ${u.teachingHours}${pct}` : '';
      lines.push(`- **Unit ${u.unitNumber}: ${u.title}**${hrsLabel}${u.topics ? `\n  Topics: ${u.topics}` : ''}`);
    }
  } else if (course.contents) {
    lines.push(`\n**Contents:** *(Official University Syllabus)*\n${course.contents}`);
  }

  if (details.lab) {
    lines.push(`\n**Lab Requirements:** *(Official University Syllabus)*\n${details.lab}`);
  }

  if (details.textbooks) {
    lines.push(`\n**Textbooks & References:** *(Official University Syllabus)*\n${details.textbooks}`);
  }

  // AI-Generated Academic Guide Section (explicitly separated from Official University Syllabus)
  lines.push(
    `\n**AI Study Guide & Learning Roadmap (Advisory — Not Official University Requirements):**`,
    `- **Prerequisites:** ${pedagogy.prerequisites.join('; ')}`,
    `- **Important Concepts:** ${pedagogy.keyConcepts.join(' · ')}`,
    `- **How Units Connect:** ${pedagogy.unitRelationships.join(' ')}`,
    `- **Suggested Study Order:** ${pedagogy.studySequence.join(' → ')}`,
    '',
    '```syllabus',
    JSON.stringify(visualPayload),
    '```'
  );

  if (syllabusLink) {
    lines.push('', syllabusLink);
  }

  return lines.join('\n');
}

/**
 * Builds deterministic, pre-validated visual blocks (`diagram`, `flowchart`, `graph`, `trace`, `quiz`, `roadmap`)
 * for canonical academic questions so even fast/mocked or concise LLM responses include rich interactive visual learning blocks,
 * and ensures LLM prompts know how to emit them for any subject.
 */
function buildDeterministicVisualEnrichment(message, classification, existingReply = '') {
  const text = String(message || '').trim();
  const replyStr = String(existingReply || '');

  // Never duplicate if the reply already contains one of the academic visual blocks
  if (/```(?:syllabus|diagram|flowchart|graph|trace|quiz|roadmap|simulation|code_preview|illustration)\b/i.test(replyStr)) {
    if (/\b(linked\s+lists?|singly\s+linked|doubly\s+linked|node\s+and\s+pointer)\b/i.test(text) && !/struct\s+Node\b/i.test(replyStr)) {
      return `\n\n**Node Structure in C:**\n\`\`\`c\nstruct Node {\n    int data;\n    struct Node* next;\n};\n\`\`\``;
    }
    return '';
  }

  // Do not force visuals into simple factual questions where text is sufficient
  const visualPlan = planVisualExplanation(text);
  if (!visualPlan.needsVisual && classification?.category === 'concept_explanation') {
    return '';
  }

  // A1. CSS Box Model -> Interactive Box Model Simulation (Sliders for Padding & Margin)
  if (/\b(css\s+box\s+model|box\s+model|margin\s+and\s+padding|padding\s+and\s+margin)\b/i.test(text)) {
    const simPayload = {
      simulationType: 'box_model',
      title: 'Interactive CSS Box Model Explorer',
      subtitle: 'Adjust padding and margin sliders to inspect how total element dimensions change in real time',
      defaults: {
        margin: 12,
        border: 3,
        padding: 16,
        contentWidth: 220,
        contentHeight: 56
      },
      controls: [
        { id: 'padding', label: 'Adjust padding', min: 0, max: 40, step: 2, defaultValue: 16, unit: 'px' },
        { id: 'margin', label: 'Adjust margin', min: 0, max: 40, step: 2, defaultValue: 12, unit: 'px' }
      ],
      takeaway: 'Total rendered box width (content-box) = Content + 2×Padding + 2×Border + 2×Margin.'
    };
    return `\n\n\`\`\`simulation\n${JSON.stringify(simPayload)}\n\`\`\``;
  }

  // A2. CSS Selectors / HTML & CSS Styling -> Live HTML/CSS Concept Demonstration (code_preview)
  // Follows the least complicated teaching representation rule: small DOM targeting demonstration
  if (/\b(css\s+selectors?|what\s+is\s+a\s+selector\s+in\s+css|html\s+and\s+css|css\s+styling|class\s+selector|id\s+selector)\b/i.test(text)) {
    const previewPayload = {
      title: 'Live Concept Demonstration — HTML & CSS Selectors',
      subtitle: 'Switch tabs to see how HTML structure and CSS selector rules (.card, h2, #badge) combine',
      html: '<div class="card">\n  <span id="badge">CIT 215 · Web Tech</span>\n  <h2>Hello Student!</h2>\n  <p class="highlight">CSS selectors target specific HTML elements for styling.</p>\n</div>',
      css: '/* 1. Class selector (.card) targets class="card" */\n.card {\n  padding: 16px;\n  border-radius: 12px;\n  border: 1px solid #3f3f46;\n}\n\n/* 2. ID selector (#badge) has highest specificity */\n#badge {\n  font-size: 11px;\n  font-weight: 700;\n  text-transform: uppercase;\n}\n\n/* 3. Element selector (h2) targets all <h2> tags */\nh2 {\n  margin: 8px 0 4px;\n}',
      annotations: [
        { selector: 'Element Selector (h2, p)', specificity: '0, 0, 1', description: 'Matches all elements of that tag name.' },
        { selector: 'Class Selector (.card, .highlight)', specificity: '0, 1, 0', description: 'Matches any element with that class attribute; reusable across multiple elements.' },
        { selector: 'ID Selector (#badge)', specificity: '1, 0, 0', description: 'Matches a single unique element with id="badge"; overrides class and tag rules.' }
      ],
      caption: 'Switch tabs to see how HTML structure and CSS styling combine.'
    };

    let enrichment = `\n\n\`\`\`code_preview\n${JSON.stringify(previewPayload)}\n\`\`\``;

    if (/(?:diagram|flowchart|hierarchy|specificity)/i.test(text)) {
      const diagramPayload = {
        title: 'CSS Selector Specificity & Selection Hierarchy',
        subtitle: 'How browsers determine which rule wins when multiple selectors target the same element',
        nodes: [
          { id: 'universal', label: '1. Universal Selector (*)', detail: 'Specificity: 0-0-0-0 · Lowest priority · Used for global resets' },
          { id: 'element', label: '2. Element / Tag Selector (p, h1, div)', detail: 'Specificity: 0-0-0-1 · Targets all elements of that HTML tag' },
          { id: 'class', label: '3. Class Selector (.student)', detail: 'Specificity: 0-0-1-0 · Reusable styling across elements with class="student"' },
          { id: 'id', label: '4. ID Selector (#heading)', detail: 'Specificity: 0-1-0-0 · Highest selector priority · Unique element with id="heading"' }
        ]
      };
      enrichment += `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
    }

    if (/(?:quiz|test\s+me|mcqs?)/i.test(text)) {
      const quizPayload = {
        title: 'CSS Selectors Self-Assessment Quiz',
        subtitle: 'Test your understanding of selector syntax and specificity',
        questions: [
          {
            id: 'q1',
            question: 'Which CSS selector has the highest specificity weight when styling an HTML element?',
            options: [
              'A) Universal selector (*)',
              'B) Element selector (p)',
              'C) Class selector (.student)',
              'D) ID selector (#heading)'
            ],
            correctIndex: 3,
            explanation: 'ID selectors (#id) carry a specificity score of 0-1-0-0, overriding class selectors (0-0-1-0) and tag/element selectors (0-0-0-1).'
          },
          {
            id: 'q2',
            question: 'Which symbol is used to define a class selector in CSS?',
            options: [
              'A) Hash symbol (#)',
              'B) Period / Dot (.)',
              'C) Asterisk (*)',
              'D) Greater-than sign (>)'
            ],
            correctIndex: 1,
            explanation: 'A dot (.) prefixes class selectors (e.g., .student), while # is used for IDs, * for universal, and > for child combinators.'
          }
        ]
      };
      enrichment += `\n\n\`\`\`quiz\n${JSON.stringify(quizPayload)}\n\`\`\``;
    }

    if (!replyStr.includes('prompt:')) {
      enrichment += '\n\n### Next Steps & Deep Dives\nChoose a topic below to continue exploring:\n' +
        '* [Explain Combinator Selectors (`>`, `+`, `~`)](prompt:Explain%20CSS%20Combinator%20Selectors%20with%20HTML%20and%20CSS%20code%20examples)\n' +
        '* [Explain Pseudo-Classes & Pseudo-Elements (`:hover`, `::before`)](prompt:Explain%20CSS%20Pseudo-classes%20and%20Pseudo-elements%20with%20examples)\n' +
        '* [Deep Dive into Specificity Calculation & Conflicts](prompt:Explain%20how%20CSS%20Specificity%20calculation%20works%20with%20examples)';
    }

    return enrichment;
  }

  // A2.5. TCP 3-Way Handshake -> Sequence Diagram
  if (/\b(tcp\s+(?:3[- ]way\s+)?handshake|three[- ]way\s+handshake|tcp\s+connection|syn[- ]ack)\b/i.test(text)) {
    const diagramPayload = {
      diagramType: 'sequence',
      title: 'TCP 3-Way Handshake (Connection Establishment)',
      subtitle: 'Reliable full-duplex session initialization between Client and Server',
      nodes: [
        { id: 'step1', actorFrom: 'Client', actorTo: 'Server', label: '1. SYN (seq = x)', detail: 'Client enters SYN-SENT. Initiates connection request with initial sequence number x.' },
        { id: 'step2', actorFrom: 'Server', actorTo: 'Client', label: '2. SYN-ACK (seq = y, ack = x + 1)', detail: 'Server enters SYN-RECEIVED. Acknowledges x with ack=x+1 and sends its own sequence number y.' },
        { id: 'step3', actorFrom: 'Client', actorTo: 'Server', label: '3. ACK (seq = x + 1, ack = y + 1)', detail: 'Client & Server enter ESTABLISHED. Handshake complete; reliable full-duplex data transfer begins.' }
      ]
    };
    return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
  }

  // A2.7. Linked List -> Node-and-Pointer Visualization Diagram & C Struct
  if (/\b(linked\s+lists?|singly\s+linked\s+list|doubly\s+linked\s+list|node\s+and\s+pointer)\b/i.test(text)) {
    const isDoubly = /\bdoubly\b/i.test(text);
    const diagramPayload = {
      diagramType: 'linear',
      title: isDoubly ? 'Doubly Linked List — Node & Bidirectional Pointer Structure' : 'Singly Linked List — Node & Pointer Structure',
      subtitle: 'Each node allocates dynamic heap memory containing a data field and pointer link(s)',
      nodes: [
        { id: 'head', label: 'HEAD Pointer', detail: 'Holds address of first node (0x100)' },
        { id: 'n1', label: isDoubly ? '[ prev: NULL | Data: 10 | next: 0x200 ]' : '[ Data: 10 | next: 0x200 ]', detail: 'Node 1 at 0x100' },
        { id: 'n2', label: isDoubly ? '[ prev: 0x100 | Data: 20 | next: 0x300 ]' : '[ Data: 20 | next: 0x300 ]', detail: 'Node 2 at 0x200' },
        { id: 'n3', label: isDoubly ? '[ prev: 0x200 | Data: 30 | next: NULL ]' : '[ Data: 30 | next: NULL ]', detail: 'Node 3 at 0x300 (Tail, next = NULL)' }
      ]
    };
    let block = `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
    if (!/struct\s+Node\b/i.test(replyStr)) {
      block = `\n\n**Node Structure in C:**\n\`\`\`c\nstruct Node {\n    int data;\n    struct Node* next;\n};\n\`\`\`${block}`;
    }
    return block;
  }

  // A3. Session & Cookies / HTTP / API -> Sequence & Architecture Flow Diagram
  if (/\b(sessions?|cookies?|what\s+is\s+http\b|http\s+request|how\s+does\s+http\s+work|what\s+is\s+an?\s+api\b|rest\s+api)\b/i.test(text)) {
    const isSession = /\b(sessions?|cookies?)\b/i.test(text);
    const isApi = /\b(api|rest\s+api)\b/i.test(text) && !isSession;
    const diagramPayload = isSession
      ? {
          diagramType: 'sequence',
          title: 'Client vs Server: Session & Cookie Lifecycle',
          subtitle: 'How HTTP statelessness is solved via client-side Cookies and server-side Sessions',
          nodes: [
            { id: 'step1', actorFrom: 'Browser', actorTo: 'Server', label: '1. POST /login (username + password)', detail: 'Browser submits credentials over HTTPS' },
            { id: 'step2', actorFrom: 'Server', actorTo: 'Session Store', label: '2. Create Session (session_id = S_98f2)', detail: 'Server stores user data in server-side memory/DB' },
            { id: 'step3', actorFrom: 'Server', actorTo: 'Browser', label: '3. 200 OK + Set-Cookie: sid=S_98f2; HttpOnly; Secure', detail: 'Browser saves session ID cookie locally' },
            { id: 'step4', actorFrom: 'Browser', actorTo: 'Server', label: '4. GET /dashboard + Cookie: sid=S_98f2', detail: 'Browser automatically attaches cookie on subsequent requests' },
            { id: 'step5', actorFrom: 'Server', actorTo: 'Browser', label: '5. Verify sid=S_98f2 -> Return Authorized Page', detail: 'Server validates SID, looks up session store, and identifies the logged-in student' }
          ]
        }
      : isApi
        ? {
            diagramType: 'sequence',
            title: 'Client ↔ API ↔ Database Communication Flow',
            subtitle: 'Structured request-validation-query-response cycle through a REST API',
            nodes: [
              { id: 's1', actorFrom: 'Client App', actorTo: 'API Gateway', label: '1. HTTP GET /api/courses/CIT214 (Accept: application/json)', detail: 'Web or mobile client requests structured resource' },
              { id: 's2', actorFrom: 'API Gateway', actorTo: 'Database', label: '2. Auth Check & Parameterized SQL Query', detail: 'Controller validates token & queries database' },
              { id: 's3', actorFrom: 'Database', actorTo: 'API Gateway', label: '3. Return Matched Rows', detail: 'Database returns raw course records' },
              { id: 's4', actorFrom: 'API Gateway', actorTo: 'Client App', label: '4. HTTP 200 OK + JSON Payload', detail: 'Client renders structured data in UI' }
            ]
          }
        : {
            diagramType: 'sequence',
            title: 'HTTP Request–Response Lifecycle',
            subtitle: 'Browser → HTTP Request → Server → Database → HTTP Response → Browser',
            nodes: [
              { id: 'h1', actorFrom: 'Browser', actorTo: 'DNS / TCP', label: '1. DNS Resolution & TCP/TLS Handshake', detail: 'Resolves domain to IP and establishes connection' },
              { id: 'h2', actorFrom: 'Browser', actorTo: 'Web Server', label: '2. HTTP Request (GET /syllabus HTTP/1.1 + Headers)', detail: 'Sends method, path, headers, and optional body' },
              { id: 'h3', actorFrom: 'Web Server', actorTo: 'Database', label: '3. Application Logic & Data Retrieval', detail: 'Server processes route and fetches records' },
              { id: 'h4', actorFrom: 'Web Server', actorTo: 'Browser', label: '4. HTTP Response (200 OK + Content-Type + Payload)', detail: 'Browser parses HTML/CSS/JSON and renders view' }
            ]
          };
    return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
  }

  // A4. DBMS Normalization -> Normal Forms Progression Diagram + Table Decomposition Comparison
  if (/\b(normalization|1nf|2nf|3nf|bcnf)\b/i.test(text)) {
    const diagramPayload = {
      diagramType: 'flowchart',
      title: 'DBMS Normalization Progression (UNF → 1NF → 2NF → 3NF → BCNF)',
      subtitle: 'Step-by-step elimination of repeating groups, partial dependencies, and transitive dependencies',
      nodes: [
        { id: '1nf', label: 'First Normal Form (1NF) — Atomic Values', detail: 'Eliminate repeating groups/arrays; every cell holds a single atomic value and each row has a Primary Key.' },
        { id: '2nf', label: 'Second Normal Form (2NF) — No Partial Dependency', detail: 'Must be in 1NF + every non-key attribute depends on the ENTIRE composite primary key (split Student_Course into Students, Courses, Enrollments).' },
        { id: '3nf', label: 'Third Normal Form (3NF) — No Transitive Dependency', detail: 'Must be in 2NF + no non-key attribute depends on another non-key attribute (e.g., move Dept_Name -> Dept_HOD into a separate Departments table).' },
        { id: 'bcnf', label: 'Boyce-Codd Normal Form (BCNF) — Every Determinant is a Candidate Key', detail: 'For every non-trivial functional dependency X → Y, X must be a superkey.' }
      ]
    };
    const compPayload = {
      title: 'Unnormalized vs Normalized Schema Decomposition Example',
      headers: ['Normal Form', 'Table Structure Example', 'Anomaly Eliminated'],
      items: [
        { col1: 'Unnormalized (UNF)', col2: 'Student(Roll, Name, {CIT214, CIT213})', col3: 'Multi-valued attributes prevent clean indexing' },
        { col1: '1NF (Atomic)', col2: 'Enrollment(Roll, CourseCode, StudentName, DeptID, DeptHead)', col3: 'Removes repeating groups, but duplicates DeptHead' },
        { col1: '2NF (Full Key Dependency)', col2: 'Student(Roll, StudentName, DeptID, DeptHead) + Enrolled(Roll, CourseCode)', col3: 'Removes partial dependency on composite key (Roll, CourseCode)' },
        { col1: '3NF / BCNF', col2: 'Student(Roll, StudentName, DeptID) + Department(DeptID, DeptHead) + Enrolled(Roll, CourseCode)', col3: 'Removes transitive dependency (Roll -> DeptID -> DeptHead)' }
      ]
    };
    return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\`\n\n\`\`\`comparison\n${JSON.stringify(compPayload)}\n\`\`\``;
  }

  // A5. Projectile Motion -> Deterministic Interactive Physics Simulation + Vector Illustration
  if (/\b(projectile|projectile\s+motion|trajectory)\b/i.test(text)) {
    const metrics = computeProjectileMetrics(25, 45, 9.8);
    const simPayload = {
      simulationType: 'projectile_motion',
      title: 'Interactive 2D Projectile Motion Simulator (Assumed g = 9.8 m/s²)',
      subtitle: 'Adjust initial launch velocity (v₀) and launch angle (θ) to recalculate deterministic parabolic trajectory, range, and maximum height',
      defaults: { v0: 25, thetaDeg: 45, g: 9.8 },
      controls: [
        { id: 'v0', label: 'Initial Velocity (v₀)', min: 5, max: 50, step: 1, defaultValue: 25, unit: 'm/s' },
        { id: 'thetaDeg', label: 'Launch Angle (θ)', min: 10, max: 85, step: 5, defaultValue: 45, unit: '°' }
      ],
      computed: metrics,
      formulas: [
        'Horizontal Range: R = (v₀² · sin(2θ)) / g',
        'Maximum Height: H = (v₀² · sin²(θ)) / (2g)',
        'Time of Flight: T = (2 · v₀ · sin(θ)) / g'
      ],
      note: 'Illustrative vacuum model assuming zero air resistance and constant gravitational acceleration g = 9.8 m/s².'
    };
    const illPayload = {
      sceneType: 'projectile_vectors',
      title: 'Projectile Velocity Vector Decomposition (v_x = v₀ cos θ, v_y = v₀ sin θ − gt)',
      subtitle: 'Horizontal velocity v_x remains constant while vertical velocity v_y changes at −g = −9.8 m/s²',
      caption: 'At the apex (maximum height H), vertical velocity v_y = 0 m/s while horizontal velocity remains v_x = v₀ cos θ.'
    };
    return `\n\n\`\`\`simulation\n${JSON.stringify(simPayload)}\n\`\`\`\n\n\`\`\`illustration\n${JSON.stringify(illPayload)}\n\`\`\``;
  }

  // A6. Wave Frequency & Amplitude -> Interactive Sine Wave Simulator
  if (/\b(wave\s+frequency|frequency\s+and\s+amplitude|amplitude\s+and\s+frequency|sine\s+wave|transverse\s+wave|harmonic\s+wave|wave\s+motion)\b/i.test(text)) {
    const waveData = computeWaveSamples(2, 2, 25);
    const simPayload = {
      simulationType: 'wave_motion',
      title: 'Interactive Wave Frequency & Amplitude Demonstration — y(x) = A sin(2πfx)',
      subtitle: 'Adjust Amplitude (A) and Frequency (f) to observe how wave energy and wavelength respond',
      defaults: { amplitude: 2, frequency: 2 },
      controls: [
        { id: 'amplitude', label: 'Amplitude (A)', min: 1, max: 5, step: 0.5, defaultValue: 2, unit: 'm' },
        { id: 'frequency', label: 'Frequency (f)', min: 1, max: 6, step: 0.5, defaultValue: 2, unit: 'Hz' }
      ],
      computed: waveData,
      takeaway: 'Higher amplitude increases peak displacement (energy), while higher frequency increases oscillations per unit length (shorter wavelength λ = v / f).'
    };
    return `\n\n\`\`\`simulation\n${JSON.stringify(simPayload)}\n\`\`\``;
  }

  // 1. Recursion -> Call-Stack Trace + Concept Diagram
  if (/\b(recursion|recursive)\b/i.test(text) && classification.category !== 'academic_resources' && !(/^what\s+is\s+recursion\s+in\s+c\??$/i.test(text) && replyStr && !replyStr.includes("\n"))) {
    const tracePayload = {
      title: 'Recursive Call Stack Trace — factorial(4)',
      subtitle: 'Step-by-step push (winding) and pop (unwinding) on the call stack',
      complexity: { time: 'O(n)', space: 'O(n) stack frames' },
      steps: [
        { step: 1, action: 'Call factorial(4)', state: ['factorial(4) -> waits for 4 * factorial(3)'], highlight: 'Push frame n = 4' },
        { step: 2, action: 'Call factorial(3)', state: ['factorial(4)', 'factorial(3) -> waits for 3 * factorial(2)'], highlight: 'Push frame n = 3' },
        { step: 3, action: 'Call factorial(2)', state: ['factorial(4)', 'factorial(3)', 'factorial(2) -> waits for 2 * factorial(1)'], highlight: 'Push frame n = 2' },
        { step: 4, action: 'Base Case Reached: factorial(1)', state: ['factorial(4)', 'factorial(3)', 'factorial(2)', 'factorial(1) = 1'], highlight: 'Base condition (n <= 1) returns 1' },
        { step: 5, action: 'Unwind Stack & Multiply', state: ['factorial(2) = 2 * 1 = 2', 'factorial(3) = 3 * 2 = 6', 'factorial(4) = 4 * 6 = 24'], highlight: 'Final return value: 24' }
      ]
    };
    return `\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\``;
  }

  // 2. Merge Sort -> Divide-and-Conquer Execution Trace
  if (/\bmerge\s*sort\b/i.test(text) && classification.category !== 'comparison') {
    const tracePayload = {
      title: 'Merge Sort Execution Trace — [38, 27, 43, 3]',
      subtitle: 'Divide array into halves recursively, then merge sorted subarrays in O(n log n) time',
      complexity: { time: 'O(n log n) all cases', space: 'O(n) auxiliary' },
      steps: [
        { step: 1, action: 'Initial Unsorted Array', state: ['[38, 27, 43, 3]'], highlight: 'Split at midpoint mid = 1' },
        { step: 2, action: 'Divide into Left & Right Halves', state: ['Left: [38, 27]', 'Right: [43, 3]'], highlight: 'Recursively split each half into single-element arrays' },
        { step: 3, action: 'Base Case (Single Elements)', state: ['[38]', '[27]', '[43]', '[3]'], highlight: 'Single-element subarrays are trivially sorted' },
        { step: 4, action: 'Merge Pairs in Sorted Order', state: ['Merge [38] & [27] -> [27, 38]', 'Merge [43] & [3] -> [3, 43]'], highlight: 'Two-pointer comparison builds sorted pairs' },
        { step: 5, action: 'Final Merge of Sorted Halves', state: ['Merge [27, 38] & [3, 43] -> [3, 27, 38, 43]'], highlight: 'Sorted output: [3, 27, 38, 43]' }
      ]
    };
    return `\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\``;
  }

  // 3. Binary Search / O(log n) -> Interactive Binary Search Demonstration + Step-by-Step Search Trace + Complexity Graph
  if (/(?:\bbinary\s+search(?!\s+trees?)\b|o\(log\s*n\))/i.test(text)) {
    const simPayload = {
      simulationType: 'binary_search',
      title: 'Interactive Binary Search Demonstration',
      subtitle: 'Select a search target or step through low, mid, and high pointers on sorted array [2, 5, 8, 12, 16, 23, 38, 56]',
      array: [2, 5, 8, 12, 16, 23, 38, 56],
      defaultTarget: 23,
      targets: [5, 12, 23, 38, 40],
      steps: [
        { step: 1, low: 0, mid: 3, high: 7, midVal: 12, comparison: 'arr[3] = 12 < 23 → discard left half, set low = 4' },
        { step: 2, low: 4, mid: 5, high: 7, midVal: 23, comparison: 'arr[5] = 23 == 23 → Target found at index 5!' }
      ]
    };
    const tracePayload = {
      title: 'Binary Search Trace — Target = 23 in [2, 5, 8, 12, 16, 23, 38, 56]',
      subtitle: 'Halves the search space on every comparison: log₂(8) = 3 steps maximum',
      complexity: { time: 'O(log n)', space: 'O(1) iterative' },
      steps: [
        { step: 1, action: 'Step 1: low = 0, high = 7 -> mid = 3', state: ['[2, 5, 8, (12), 16, 23, 38, 56]'], highlight: 'arr[3] = 12 < 23 -> discard left half, set low = 4' },
        { step: 2, action: 'Step 2: low = 4, high = 7 -> mid = 5', state: ['[16, (23), 38, 56]'], highlight: 'arr[5] = 23 == target -> Found at index 5!' }
      ]
    };
    const graphPayload = {
      title: 'Algorithm Time Complexity Growth Comparison',
      subtitle: 'Operations required as input size n grows (why O(log n) scales vastly better than O(n))',
      xAxisLabel: 'Input size (n)',
      yAxisLabel: 'Operations',
      series: [
        { label: 'O(1) Constant (n = 1,024)', value: 1, displayValue: '1 op' },
        { label: 'O(log₂ n) Binary Search (n = 1,024)', value: 10, displayValue: '10 ops' },
        { label: 'O(n) Linear Search (n = 1,024)', value: 65, displayValue: '1,024 ops' },
        { label: 'O(n²) Quadratic Sort (n = 1,024)', value: 100, displayValue: '1,048,576 ops' }
      ]
    };
    return `\n\n\`\`\`simulation\n${JSON.stringify(simPayload)}\n\`\`\`\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\`\n\n\`\`\`graph\n${JSON.stringify(graphPayload)}\n\`\`\``;
  }

  // 4. Dijkstra's Algorithm -> Step-by-Step Shortest Path Trace
  if (/\bdijkstra\b/i.test(text)) {
    const tracePayload = {
      title: "Dijkstra's Shortest Path Trace (Source: Node A)",
      subtitle: 'Greedily settles the unvisited vertex with the minimum known distance using a Min-Priority Queue',
      complexity: { time: 'O((V + E) log V)', space: 'O(V)' },
      steps: [
        { step: 1, action: 'Initialize Distances', state: ['dist[A] = 0', 'dist[B] = ∞', 'dist[C] = ∞', 'dist[D] = ∞'], highlight: 'Start at source A (dist = 0)' },
        { step: 2, action: 'Visit A, Relax Neighbors (B: 4, C: 2)', state: ['dist[A] = 0 (visited)', 'dist[C] = 2', 'dist[B] = 4', 'dist[D] = ∞'], highlight: 'Pick C next (minimum unvisited dist = 2)' },
        { step: 3, action: 'Visit C, Relax Edges (C->B weight 1, C->D weight 5)', state: ['dist[B] = min(4, 2+1) = 3', 'dist[D] = min(∞, 2+5) = 7'], highlight: 'Path A -> C -> B improves dist[B] from 4 to 3!' },
        { step: 4, action: 'Visit B, Relax Edge (B->D weight 2)', state: ['dist[D] = min(7, 3+2) = 5'], highlight: 'Shortest paths finalized: A=0, C=2, B=3, D=5' }
      ]
    };
    return `\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\``;
  }

  // 5. Linked List / Stack / Queue / BST -> Data Structure Trace or Diagram
  if (/\b(linked\s+lists?|binary\s+search\s+trees?|\bbst\b)\b/i.test(text) && classification.category !== 'comparison') {
    const isBst = /\b(binary\s+search\s+trees?|\bbst\b)\b/i.test(text);
    if (isBst) {
      const diagramPayload = {
        title: 'Binary Search Tree (BST) Ordering Invariant',
        subtitle: 'For every node N: all keys in Left Subtree < N.key < all keys in Right Subtree',
        nodes: [
          { id: 'root', label: 'Root: 50', detail: 'All left < 50 · All right > 50' },
          { id: 'left', label: 'Left Child: 30', detail: 'Subtree keys: [20, 30, 40]' },
          { id: 'right', label: 'Right Child: 70', detail: 'Subtree keys: [60, 70, 80]' },
          { id: 'inorder', label: 'Inorder Traversal (L -> Root -> R)', detail: 'Produces sorted sequence: 20, 30, 40, 50, 60, 70, 80' }
        ]
      };
      return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
    }
    const tracePayload = {
      title: 'Singly Linked List Node Insertion at Head — O(1)',
      subtitle: 'Pointer rewiring without shifting contiguous memory blocks',
      complexity: { time: 'O(1) at head, O(n) at tail/search', space: 'O(n) nodes' },
      steps: [
        { step: 1, action: 'Initial List', state: ['HEAD -> [10 | next] -> [20 | next] -> NULL'], highlight: 'Existing head points to node 10' },
        { step: 2, action: 'Allocate New Node (5)', state: ['newNode = [5 | next: NULL]', 'HEAD -> [10] -> [20] -> NULL'], highlight: 'Create node in heap memory' },
        { step: 3, action: 'Link newNode->next = HEAD', state: ['newNode [5 | next] -> [10 | next] -> [20 | next] -> NULL'], highlight: 'Connect before updating HEAD so list is never lost' },
        { step: 4, action: 'Update HEAD = newNode', state: ['HEAD -> [5] -> [10] -> [20] -> NULL'], highlight: 'Insertion complete in O(1) constant time' }
      ]
    };
    return `\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\``;
  }

  // 6. Physics: Electromagnetic Induction / Faraday's Law / Ohm's Law -> Concept Diagram + Graph
  if (/\b(electromagnetic\s+induction|faraday|lenz|ohm'?s\s+law)\b/i.test(text)) {
    if (/\bohm'?s\s+law\b/i.test(text)) {
      const diagramPayload = {
        title: "Ohm's Law Closed DC Circuit (V = I × R)",
        subtitle: 'Current (I) is directly proportional to Voltage (V) and inversely proportional to Resistance (R)',
        nodes: [
          { id: 'source', label: 'Voltage Source (V)', detail: 'Provides potential difference (Volts, V)' },
          { id: 'current', label: 'Conventional Current (I = V / R)', detail: 'Flows from + to − terminal (Amperes, A)' },
          { id: 'resistor', label: 'Ohmic Resistor (R)', detail: 'Opposes current flow (Ohms, Ω); V_drop = I × R' }
        ]
      };
      const graphPayload = {
        title: 'Ohmic V–I Characteristic Curve (Constant R = 5 Ω)',
        subtitle: 'Linear proportionality between Voltage (V) and Current (I) at constant temperature',
        xAxisLabel: 'Voltage V (Volts)',
        yAxisLabel: 'Current I (Amperes)',
        series: [
          { label: 'V = 5 V', value: 25, displayValue: 'I = 1.0 A' },
          { label: 'V = 10 V', value: 50, displayValue: 'I = 2.0 A' },
          { label: 'V = 15 V', value: 75, displayValue: 'I = 3.0 A' },
          { label: 'V = 20 V', value: 100, displayValue: 'I = 4.0 A' }
        ]
      };
      return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\`\n\n\`\`\`graph\n${JSON.stringify(graphPayload)}\n\`\`\``;
    }

    const illustrationPayload = {
      sceneType: 'electromagnetic_induction',
      title: 'Electromagnetic Induction & Magnetic Flux Linkage (Φ_B = B · A · cos θ)',
      subtitle: 'Moving a bar magnet toward a conducting solenoid changes magnetic flux ΔΦ_B and induces an opposing current I_ind',
      caption: 'Scientific vector illustration: N-S dipole field lines cutting through N-turn coil connected to a galvanometer.'
    };
    const diagramPayload = {
      title: "Faraday's & Lenz's Law of Electromagnetic Induction",
      subtitle: 'Induced EMF ε = −N (dΦ_B / dt) opposes the change in magnetic flux that produces it',
      nodes: [
        { id: 'flux', label: '1. Changing Magnetic Flux (ΔΦ_B = B · A · cos θ)', detail: 'Relative motion between magnet and coil changes magnetic field lines passing through the loop' },
        { id: 'faraday', label: "2. Faraday's Law (Induced EMF)", detail: 'Magnitude of induced EMF is proportional to the rate of change of flux: |ε| = N |dΦ_B / dt|' },
        { id: 'lenz', label: "3. Lenz's Law (Conservation of Energy)", detail: 'Negative sign (−) means induced current creates an opposing magnetic field to resist the flux change' },
        { id: 'current', label: '4. Induced Current (I = |ε| / R)', detail: 'Drives electrical current in a closed circuit (basis of AC generators and transformers)' }
      ]
    };
    return `\n\n\`\`\`illustration\n${JSON.stringify(illustrationPayload)}\n\`\`\`\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
  }

  // 7. Exam Preparation / MCQs / Revision Plan -> Interactive Quiz or Revision Roadmap
  if (classification.category === 'exam_prep') {
    const blocks = [];
    if (classification.subScope === 'mcq_quiz' || /\b(mcq|mcqs|quiz|multiple\s+choice|questions?)\b/i.test(text)) {
      const isTreeTopic = /\b(trees?|bsts?|avl|heaps?|traversals?)\b/i.test(text);
      const quizPayload = {
        title: isTreeTopic ? 'Practice MCQs — Trees, Traversals & BSTs' : 'Exam Revision Self-Assessment Quiz',
        subtitle: 'Select an option to check your understanding or use Reveal Answer to view the explanation',
        questions: isTreeTopic
          ? [
              {
                id: 'q1',
                question: 'Which traversal of a Binary Search Tree (BST) visits the nodes in ascending sorted order?',
                options: ['A) Preorder (Root, Left, Right)', 'B) Inorder (Left, Root, Right)', 'C) Postorder (Left, Right, Root)', 'D) Level-order (Breadth-First)'],
                correctIndex: 1,
                explanation: 'In a BST, all keys in the left subtree are smaller than the root and all keys in the right subtree are larger. Visiting Left -> Root -> Right (Inorder) therefore outputs keys in non-decreasing sorted order in O(n) time.'
              },
              {
                id: 'q2',
                question: 'What is the worst-case time complexity of searching for a key in an unbalanced Binary Search Tree with n nodes?',
                options: ['A) O(1)', 'B) O(log n)', 'C) O(n)', 'D) O(n log n)'],
                correctIndex: 2,
                explanation: 'If elements are inserted in already sorted order, an unbalanced BST degenerates into a skewed linked list of height n, making search take O(n) comparisons. Self-balancing trees (AVL / Red-Black) guarantee O(log n).'
              },
              {
                id: 'q3',
                question: 'What is the maximum number of nodes in a binary tree of height h (where a single root node has height 0)?',
                options: ['A) 2^h', 'B) 2^(h+1) - 1', 'C) 2^h - 1', 'D) h + 1'],
                correctIndex: 1,
                explanation: 'Level 0 has 1 node, Level 1 has 2 nodes, ..., Level h has 2^h nodes. Summing the geometric series 1 + 2 + 4 + ... + 2^h gives 2^(h+1) - 1.'
              }
            ]
          : [
              {
                id: 'q1',
                question: 'Which asymptotic notation provides a tight upper and lower bound on the growth rate of an algorithm?',
                options: ['A) Big-O (O)', 'B) Big-Omega (Ω)', 'C) Big-Theta (Θ)', 'D) Small-o (o)'],
                correctIndex: 2,
                explanation: 'Big-Theta Θ(g(n)) bounds a function from both above and below for sufficiently large n, representing the exact asymptotic order of growth.'
              },
              {
                id: 'q2',
                question: 'Which data structure is used by the system to manage function calls and local variables during recursion?',
                options: ['A) FIFO Queue', 'B) LIFO Call Stack', 'C) Min-Heap', 'D) Hash Table'],
                correctIndex: 1,
                explanation: 'Because the most recently called function must finish and return before its caller resumes, function activation records are pushed and popped on a Last-In, First-Out (LIFO) Call Stack.'
              }
            ]
      };
      blocks.push(`\`\`\`quiz\n${JSON.stringify(quizPayload)}\n\`\`\``);
    }

    if (classification.subScope === 'revision_plan' || /\b(revision\s+plan|study\s+plan|roadmap|revision\s+notes)\b/i.test(text)) {
      const roadmapPayload = {
        title: 'Structured Exam Revision Roadmap',
        subtitle: 'Prioritized study stages from core concepts to timed problem-solving',
        steps: [
          { phase: 'Stage 1', title: 'Core Definitions, ADTs & Complexity Bounds', detail: 'Review fundamental definitions, invariants, and Big-O time/space complexities across all units.' },
          { phase: 'Stage 2', title: 'Dry-Run Diagrams & Step-by-Step Traces', detail: 'Practice hand-tracing pointer updates, tree rotations, sorting passes, and graph traversals on small inputs.' },
          { phase: 'Stage 3', title: 'Derivations, Numericals & Code Implementation', detail: 'Write clean, bug-free implementations and solve multi-step numerical/derivation problems without looking at notes.' },
          { phase: 'Stage 4', title: 'Self-Assessment & Edge-Case Review', detail: 'Test yourself with MCQs, boundary cases (empty input, single node, cycle handling), and comparison tables.' }
        ]
      };
      blocks.push(`\`\`\`roadmap\n${JSON.stringify(roadmapPayload)}\n\`\`\``);
    }

    return blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
  }

  // 8. Session & Cookie Management -> Interactive Concept Lifecycle Diagram
  if (/\b(sessions?|cookies?|session\s+(?:and|&)\s+cookies?)\b/i.test(text) && classification.category !== 'academic_resources') {
    const diagramPayload = {
      title: 'Client vs Server: Session & Cookie Lifecycle',
      subtitle: 'How HTTP statelessness is solved via client-side Cookies and server-side Sessions',
      nodes: [
        { id: 'step1', label: '1. Client Submits Request (POST /login)', detail: 'Browser submits credentials over HTTPS' },
        { id: 'step2', label: '2. Server Creates Session & ID', detail: 'Server authenticates, creates server session, and issues Set-Cookie: SID=xyz; HttpOnly' },
        { id: 'step3', label: '3. Client Stores Session Cookie', detail: 'Browser saves SID in cookie jar (small ~4KB, sent automatically on next requests)' },
        { id: 'step4', label: '4. Subsequent Requests (GET /dashboard)', detail: 'Browser sends Cookie: SID=xyz with every request' },
        { id: 'step5', label: '5. Server Looks Up Session Data', detail: 'Server validates SID and loads user state from memory/database' }
      ]
    };
    return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
  }

  return '';
}

/**
 * Builds structured academic teaching instructions for the LLM based on the classified question category,
 * discipline, and visual selection rules.
 */
function buildAcademicTutorPrompt(message, classification) {
  if (!classification) return '';
  const { category, discipline } = classification;

  const baseRules = [
    '\nACADEMIC TUTOR & VISUAL LEARNING ENGINE DIRECTIVES (TEACH LIKE WE\'RE 5):',
    '- Act as an exceptional, student-friendly academic mentor: transform complex academic concepts into simple, intuitive, step-by-step explanations that anyone can understand from first principles.',
    '- PROFESSIONAL TONE WITHOUT EMOJIS: Do NOT use casual emojis in explanations (avoid decorative emojis like cookies, locks, globes, servers, lightning). Maintain a clean, professional, high-standard academic tone with bold structural headings, clear terminology, and clean UI components.',
    '- CODE FORMATTING & WRAPPING: Keep code lines concise and readable. If a line of code or comment is long, break it onto the next line (wrap lines) rather than writing long horizontal one-liners that exceed standard screen widths.',
    '- NO RAW ASCII / TEXT ART FIGURES: NEVER output raw ASCII box-and-arrow figures using characters like "+---", "|", or ASCII boxes. Instead, use a structured Markdown numbered sequence with bold step titles and descriptions, or output a structured ```diagram visual block with JSON nodes so the UI can render it as a professional CSS diagram.',
    '- NO ROBOTIC CITATIONS: Never start answers with "This is extracted from [File Title]..." or include raw file metadata headers in normal academic teaching answers. Just answer what they asked directly.',
    '- NO UNSOLICITED FILE/SYLLABUS LINKS: Do NOT output file links or full syllabus links at the end of the answer unless the student explicitly asks for files, notes, or links.',
    '- Prioritize grounding in: (1) Official university syllabus & academic records, (2) Semester Library notes & uploaded materials, (3) Course-specific context, and (4) Verified academic principles.',
    '- Never invent course codes, credit hours, marks, grades, practical requirements, or library links. Never claim AI study tips or practice questions are guaranteed to appear on an exam.'
  ];

  if (category === 'concept_explanation') {
    baseRules.push(
      '- STRUCTURE FOR CONCEPT EXPLANATION (TEACH LIKE WE\'RE 5 — 5-STAGE INTUITIVE PEDAGOGICAL STRUCTURE):',
      '  1. First, understand the problem (ELI5 / Relatable Scenario):',
      '     Start from the absolute basics with a clear, relatable scenario or analogy explaining WHY this concept exists and what goes wrong without it (e.g. for sessions/cookies: "HTTP is a stateless protocol. The server doesn\'t automatically remember previous requests. Imagine opening Semester Library and logging in... Without session management, the server has no way of knowing each request is from the same user!"). Do not use emojis.',
      '  2. Core Concept & Plain-Language Definitions:',
      '     Explain each component simply, clearly, and intuitively without dense academic jargon or emojis (e.g. Cookies: client-side memory token; Sessions: server-side secure vault).',
      '  3. Systematic Visual Flow Diagram & Comparison Table:',
      '     - Use a clean numbered step-by-step sequence or a structured ```diagram visual block with JSON nodes. NEVER draw raw ASCII box-and-arrow art.',
      '     - Include a structured Markdown comparison table comparing key dimensions (Where stored, Security, Capacity, Persistence/Lifetime, Typical use cases).',
      '  4. Practical Code Example / Real-World Implementation:',
      '     Provide concise, practical, runnable code with clear comments showing how it works in practice (e.g. PHP session_start(), setcookie()). Break long lines onto the next line so code does not stretch horizontally. For Data Structures (e.g. Linked Lists, Stacks, Queues, Trees), ALWAYS include the node definition in C (e.g. struct Node { int data; struct Node* next; };).',
      '  5. Pro Tips / Best Practices / Traps to Avoid:',
      '     Share practical security, performance, or debugging tips (e.g. HttpOnly and Secure flags, session fixation, CSRF protection).',
      '- MANDATORY RULE FOR TAXONOMY & MULTI-TYPE CONCEPTS (e.g. CSS Selectors, SQL Joins, HTTP Methods, OOP Principles, Data Structures):',
      '  When a concept has multiple types, categories, or subtypes (e.g. "What is CSS Selector?"):',
      '  * NEVER just dump a bulleted list of types with 1-line definitions! That is not teaching.',
      '  * 1. Basic Example First: ALWAYS begin with "1. Basic example" showing a simple, tangible scenario with SEPARATE paired code boxes (e.g. explicit HTML code block, then explicit CSS code block) followed by a breakdown explaining what each selector targets.',
      '  * 2. In-Depth Subtype Breakdown with SEPARATE PAIRED CODE BOXES: For EACH core type (e.g., A. Element Selector, B. Class Selector ( . ), C. ID Selector ( # ), D. Universal Selector ( * ), E. Attribute Selector):',
      '     - Clear Subheading with notation (e.g. "#### B. Class selector ( . )")',
      '     - 1-sentence intuitive concept explaining what it selects',
      '     - SEPARATE PAIRED CODE BOXES: Label each block and provide separate syntax boxes with explicit language tags: e.g. for CSS, provide an HTML: code box (`html`), then a CSS: code box (`css`). NEVER combine HTML and CSS into one block or omit them.',
      '     - Breakdown of the syntax symbol (e.g. ". represents a class selector. Both <p> tags with class=\\"student\\" turn green.").',
      '     - Real-world practical use case.',
      '  * 3. Systematic Comparison Matrix: Provide a structured Markdown table comparing Selector Type, Syntax, Example, Specificity, and Purpose.',
      '  * 4. Interactive Learning & Live Code Preview: Code boxes support live interactive preview (▶), wrap toggle, and copy features for hands-on experimentation. Only emit an extra ```diagram or ```quiz block when the user specifically requests a diagram, flowchart, or quiz.',
      '  * 5. Progressive Pacing & Interactive Next Steps: For broad topics with many types (e.g., CSS Selectors has basic selectors, combinators >, +, ~, pseudo-classes :hover, pseudo-elements ::before, attribute selectors), explain the foundational types thoroughly first, and end with clickable interactive continuation prompt links: [Option Label](prompt:Question%20To%20Ask) so the student can easily tap to explore advanced types without feeling overwhelmed.'
    );
  } else if (category === 'programming_algorithm') {
    baseRules.push(
      '- STRUCTURE FOR PROGRAMMING & ALGORITHM QUESTIONS:',
      '  1. Problem definition & core intuition.',
      '  2. Step-by-step algorithm workflow & dry-run execution trace on a small concrete input.',
      '  3. Clean, complete, syntactically correct code in the requested language with sample input/output.',
      '  4. Time complexity (Best, Average, Worst) and Space complexity analysis.',
      '  5. Common mistakes or edge cases to watch out for.'
    );
  } else if (category === 'math_numerical') {
    baseRules.push(
      `- STRUCTURE FOR MATHEMATICAL & ${discipline.toUpperCase()} NUMERICAL QUESTIONS:`,
      '  1. Given information & target quantity.',
      '  2. Governing formula or theorem using clean LaTeX ($...$ for inline, $$...$$ for display).',
      '  3. Complete step-by-step derivation or calculation (never skip intermediate algebraic steps).',
      '  4. Final answer clearly highlighted with proper units.',
      '  5. Brief physical or mathematical interpretation of the result.'
    );
  } else if (category === 'comparison') {
    baseRules.push(
      '- STRUCTURE FOR CONCEPTUAL COMPARISONS:',
      '  1. 1-sentence high-level summary of the core difference.',
      '  2. Structured Markdown comparison table across shared dimensions (Architecture/Mechanism, Performance/Complexity, Reliability/State, Primary Use Cases).',
      '  3. Concrete scenario showing when to choose each option.'
    );
  } else if (category === 'exam_prep') {
    baseRules.push(
      '- STRUCTURE FOR EXAM PREPARATION & REVISION:',
      '  1. High-priority topic summary & key definitions/formulas/complexities.',
      '  2. Practice questions (MCQs with clear explanations, plus short-answer and long-answer focus points).',
      '  3. Actionable revision sequence (never claim any question is guaranteed to appear in an official exam).'
    );
  }

  return baseRules.join('\n');
}

/**
 * Builds an authoritative deterministic fact sheet injected into LLM context.
 * Guarantees the LLM is strictly grounded on pre-calculated server truths.
 */
function buildDeterministicFactSheet({
  temporalContext = getTemporalContext(),
  resolvedEvents = null,
  attendanceStats = null,
  marksStats = null,
  routineStats = null,
  academicContext = null
} = {}) {
  const lines = [
    '====================================================================',
    'AUTHORITATIVE SERVER-SIDE DETERMINISTIC FACT SHEET (VERIFIED BY SYSTEM)',
    `* Current System Timezone: Asia/Kathmandu (UTC+05:45)`,
    `* Current Authoritative Date (AD): ${temporalContext.adDate} (${temporalContext.dayOfWeek})`,
    `* Current Authoritative Date (BS): ${temporalContext.bsFormattedEn} (${temporalContext.dayOfWeekNe})`,
    `* Current Local Time: ${temporalContext.timeStr}`
  ];

  if (academicContext?.studentId || academicContext?.name) {
    lines.push(`* Authenticated Student: ${academicContext.name || 'Student'} (ID: ${academicContext.studentId || academicContext.id || 'N/A'}, Semester: ${academicContext.semester || academicContext.currentSemester || 'N/A'})`);
  }

  if (resolvedEvents && resolvedEvents.hasEvent && resolvedEvents.activeEvent) {
    const ev = resolvedEvents.activeEvent;
    const cd = resolvedEvents.countdown;
    lines.push('');
    lines.push(`* VERIFIED ACADEMIC EVENT: ${ev.eventType.toUpperCase()}`);
    lines.push(`  - Event Title: ${ev.title}`);
    lines.push(`  - Confirmation Status: ${ev.confirmationStatus.toUpperCase()}`);
    lines.push(`  - Event Date: ${ev.eventDateBsFormatted} BS (${ev.eventDateAd} AD)`);
    lines.push(`  - Official Source: ${ev.title} (Published: ${ev.publicationDate})`);
    if (cd) {
      lines.push(`  - EXACT DETERMINISTIC DAYS REMAINING: ${cd.daysRemaining} days`);
      lines.push(`  - Humanized Countdown: ${cd.humanSummaryEn}`);
      lines.push(`  - Humanized Countdown (Nepali): ${cd.humanSummaryNe}`);
      lines.push(`  - MANDATORY RULE FOR KYANA: You MUST state that the event date is ${ev.eventDateBsFormatted} BS (${ev.eventDateAd} AD) and there are EXACTLY ${cd.daysRemaining} days remaining from today (${temporalContext.adDate} AD / ${temporalContext.bsFormattedEn} BS).`);
      lines.push(`  - DO NOT calculate remaining days from the notice publication date (${ev.publicationDate}). The publication date is NOT today.`);
    }
  }

  if (resolvedEvents?.supersededEvents?.length > 0) {
    lines.push('');
    lines.push('* SUPERSEDED (OUTDATED) NOTICES - DO NOT USE FOR DATE OR COUNTDOWN:');
    resolvedEvents.supersededEvents.forEach(s => {
      lines.push(`  - "${s.title}": claimed date was ${s.eventDateBsFormatted} BS (${s.eventDateAd} AD). Reason: ${s.supersessionReason}`);
    });
  }

  if (resolvedEvents?.hasConflict) {
    lines.push('');
    lines.push('* CONFLICTING ANNOUNCEMENTS DETECTED:');
    resolvedEvents.conflictingEvents.forEach(c => {
      lines.push(`  - "${c.title}" mentions ${c.eventDateBsFormatted} BS (${c.eventDateAd} AD)`);
    });
    lines.push('  - MANDATORY INSTRUCTION: You MUST explain this contradiction to the student and recommend confirming with the administration.');
  }

  if (attendanceStats) {
    lines.push('');
    lines.push(`* ATTENDANCE RECORD:`);
    lines.push(`  - Total Classes Conducted: ${attendanceStats.totalClasses}`);
    lines.push(`  - Classes Attended: ${attendanceStats.presentCount}`);
    lines.push(`  - Attendance Percentage: ${attendanceStats.percentage}%`);
    lines.push(`  - Status: ${attendanceStats.status} (Requirement: 75% for exam eligibility)`);
  }

  if (marksStats) {
    lines.push('');
    lines.push(`* MARKS & RESULTS:`);
    lines.push(`  - Cumulative GPA: ${marksStats.gpa || 'N/A'}`);
    if (marksStats.subjects && marksStats.subjects.length > 0) {
      marksStats.subjects.forEach(sub => {
        lines.push(`  - ${sub.subjectName}: Internal ${sub.internal}/${sub.maxInternal}, Final ${sub.final || 'Pending'}, Grade: ${sub.grade || 'N/A'}`);
      });
    }
  }

  if (routineStats && Array.isArray(routineStats) && routineStats.length > 0) {
    lines.push('');
    lines.push(`* AUTHORITATIVE CLASS SCHEDULE / ROUTINE:`);
    routineStats.forEach(r => {
      lines.push(`  - ${r.day || 'Day'}: ${r.time || 'Time'} | ${r.subject || 'Subject'} (${r.teacher || 'Faculty'}${r.room ? `, Room ${r.room}` : ''})`);
    });
  }

  lines.push('====================================================================');
  return lines.join('\n');
}

/**
 * Post-Generation Answer Verification & Guard.
 * 
 * Verifies that the LLM response complies with authoritative truths:
 * 1. Corrects any arithmetic discrepancy in event countdowns (e.g. 11 days -> 8 days).
 * 2. Prevents anchoring to stale notice publication dates as "today".
 * 3. Enforces student-specific privacy (redacts cross-student marks/attendance).
 * 4. Guards attendance percentage and marks totals.
 */
function verifyAndGuardReply({
  reply,
  resolvedEvents = null,
  attendanceStats = null,
  marksStats = null,
  temporalContext = getTemporalContext(),
  academicContext = null
}) {
  if (typeof reply !== 'string') return { reply: '', guarded: false, corrections: [] };

  let guardedText = reply;
  let guarded = false;
  const corrections = [];

  // Guard 1: Event Countdown Arithmetic Correction
  if (resolvedEvents && resolvedEvents.hasEvent && resolvedEvents.activeEvent && resolvedEvents.countdown) {
    const trueDays = resolvedEvents.countdown.daysRemaining;
    const trueDaysNe = toDevanagariDigits(trueDays);

    const dayRegexEn = /\b(?:just\s+)?(\d+)\s+(?:more\s+)?days?\s+(?:remaining|left|away|until\b)/gi;
    const dayRegexIn = /(?<!\b(?:replied|submitted|completed|finished|took|done|created|built)\s+)in\s+(\d+)\s+days?\b(?=\s*[,.!]|\s*\(|\s*$|\s+(?:left|remaining|from\s+now|from\s+today))/gi;
    const dayRegexNe = /(?:(आजबाट)\s*)?([०-९\d]+)\s*दिन\s*बाँकी(?:\s*(छ!?))?/gu;
    const dayRegexRomanNe = /\b(\d+)\s*din\s*(?:baki|baaki)(?:\s+(cha|chha|xa))?\b/gi;

    const replaceIfWrong = (match, claimedStr, replacement) => {
      const claimed = Number(String(claimedStr).replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)));
      if (!isNaN(claimed) && claimed !== trueDays) {
        guarded = true;
        corrections.push(`Corrected countdown calculation from ${claimed} days to deterministic ${trueDays} days`);
        return replacement;
      }
      return match;
    };

    guardedText = guardedText.replace(dayRegexEn, (m, d) => {
      const justPrefix = /^\s*just/i.test(m) ? 'Just ' : '';
      return replaceIfWrong(m, d, `${justPrefix}${trueDays} day${trueDays === 1 ? '' : 's'} remaining`);
    });
    guardedText = guardedText.replace(dayRegexIn, (m, d) => replaceIfWrong(m, d, `in ${trueDays} day${trueDays === 1 ? '' : 's'}`));
    guardedText = guardedText.replace(dayRegexNe, (m, p, d, s) => {
      const prefixStr = p ? `${p} ` : '';
      const suffixStr = s ? ` ${s}` : '';
      return replaceIfWrong(m, d, `${prefixStr}${trueDaysNe} दिन बाँकी${suffixStr}`);
    });
    guardedText = guardedText.replace(dayRegexRomanNe, (m, d, v) => {
      const verbStr = v ? ` ${v}` : '';
      return replaceIfWrong(m, d, `${trueDays} din baki${verbStr}`);
    });
  }

  // Guard 2: Stale Publication Date Anchoring Correction
  if (resolvedEvents && resolvedEvents.activeEvent) {
    const pubDate = resolvedEvents.activeEvent.publicationDate;
    const todayDate = temporalContext.adDate;
    if (pubDate && pubDate !== todayDate) {
      const staleTodayRegex = new RegExp(`(?:today\\s+is|aaja|आज)\\s+(?:${pubDate}|${pubDate.replace(/-/g, '[/.]')})`, 'gi');
      if (staleTodayRegex.test(guardedText)) {
        guarded = true;
        corrections.push(`Corrected stale today date anchoring (${pubDate} -> ${todayDate})`);
        guardedText = guardedText.replace(staleTodayRegex, `today is ${todayDate}`);
      }
    }
  }

  // Guard 3: Student Privacy Enforcement
  if (academicContext?.studentId) {
    const authId = String(academicContext.studentId).trim();
    const otherStudentRegex = /\b(?:student\s+id|roll(?:\s+no)?)\s*[:#]?\s*([A-Za-z0-9_-]+)\b/gi;
    let privMatch;
    while ((privMatch = otherStudentRegex.exec(guardedText)) !== null) {
      const foundId = privMatch[1].trim();
      if (foundId && foundId.toLowerCase() !== authId.toLowerCase() && !/^(n\/a|none|null|undefined)$/i.test(foundId)) {
        guarded = true;
        corrections.push(`Redacted unauthorized student ID (${foundId})`);
        guardedText = guardedText.replace(privMatch[0], '[redacted student info]');
      }
    }
  }

  // Guard 4: Attendance Percentage Arithmetic Correction
  if (attendanceStats && typeof attendanceStats.percentage === 'number') {
    const truePct = attendanceStats.percentage;
    const pctRegex = /\b(\d+(?:\.\d+)?)\s*%\s*(?:attendance|उपस्थिति)?\b/gi;
    guardedText = guardedText.replace(pctRegex, (match, claimedPct) => {
      const val = parseFloat(claimedPct);
      if (!isNaN(val) && Math.abs(val - truePct) > 0.05 && Math.abs(val - 75) > 0.01) { // avoid replacing 75% threshold
        guarded = true;
        corrections.push(`Corrected attendance percentage from ${val}% to ${truePct}%`);
        return `${truePct}%`;
      }
      return match;
    });
  }

  return {
    reply: guardedText,
    guarded,
    corrections
  };
}

module.exports = {
  INTENTS,
  ACADEMIC_VISUAL_BLOCK_KINDS,
  ALL_ALLOWED_VISUAL_BLOCK_KINDS,
  VISUAL_SECURITY_LIMITS,
  COURSE_PEDAGOGY_MAP,
  computeProjectileMetrics,
  computeWaveSamples,
  validateVisualBlockPayload,
  parseUnitHoursNumber,
  parseUnitTopicItems,
  deriveCoursePedagogy,
  classifySyllabusSubScope,
  classifyAcademicQuestion,
  planVisualExplanation,
  formatRichCourseSyllabus,
  buildDeterministicVisualEnrichment,
  buildAcademicTutorPrompt,
  buildDeterministicFactSheet,
  verifyAndGuardReply
};
