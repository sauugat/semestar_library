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
  } else if (/\b(management|economics|accounting|entrepreneurship|marketing|finance|balance\s+sheet|trial\s+balance|double\s+entry|supply\s+and\s+demand|elasticity|swot|maslow|herzberg|leadership|business\s+communication)\b/i.test(text)) {
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
      `**${course.title}** (${course.code}) — **Unit ${targetUnit.unitNumber}: ${targetUnit.title}**${targetUnit.teachingHours ? ` (${targetUnit.teachingHours})` : ''} · Semester ${semNum}`,
      '',
      '### Official University Syllabus — Unit Breakdown',
      `- **Unit ${targetUnit.unitNumber}: ${targetUnit.title}**${targetUnit.teachingHours ? ` (${targetUnit.teachingHours})` : ''}${targetUnit.topics ? `\n  Topics: ${targetUnit.topics}` : ''}`
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
      const hrsLabel = u.teachingHours ? ` (${u.teachingHours})` : '';
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
  if (/```(?:syllabus|diagram|flowchart|graph|trace|quiz|roadmap)\b/i.test(replyStr)) {
    return '';
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

  // 3. Binary Search / O(log n) -> Step-by-Step Search Trace + Complexity Graph
  if (/(?:\bbinary\s+search(?!\s+trees?)\b|o\(log\s*n\))/i.test(text)) {
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
    return `\n\n\`\`\`trace\n${JSON.stringify(tracePayload)}\n\`\`\`\n\n\`\`\`graph\n${JSON.stringify(graphPayload)}\n\`\`\``;
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
    return `\n\n\`\`\`diagram\n${JSON.stringify(diagramPayload)}\n\`\`\``;
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
    '\nACADEMIC TUTOR & VISUAL LEARNING ENGINE DIRECTIVES:',
    '- Act as a rigorous, student-friendly academic tutor: transform raw facts into clear intuition, structured step-by-step explanation, concrete examples, and visual learning.',
    '- Prioritize grounding in: (1) Official university syllabus & academic records, (2) Semester Library notes & uploaded materials, (3) Course-specific context, and (4) Verified academic principles.',
    '- Never invent course codes, credit hours, marks, grades, practical requirements, or library links. Never claim AI study tips or practice questions are guaranteed to appear on an exam.'
  ];

  if (category === 'concept_explanation') {
    baseRules.push(
      '- STRUCTURE FOR CONCEPT EXPLANATION:',
      '  1. Clear, precise definition in 1–2 sentences.',
      '  2. Intuitive explanation (with a concise real-world analogy when helpful).',
      '  3. How it works (step-by-step mechanism or principles).',
      '  4. Practical, mathematical, or programming example.',
      '  5. Key takeaways / applications / limitations.'
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

module.exports = {
  ACADEMIC_VISUAL_BLOCK_KINDS,
  COURSE_PEDAGOGY_MAP,
  parseUnitHoursNumber,
  parseUnitTopicItems,
  deriveCoursePedagogy,
  classifySyllabusSubScope,
  classifyAcademicQuestion,
  formatRichCourseSyllabus,
  buildDeterministicVisualEnrichment,
  buildAcademicTutorPrompt
};
