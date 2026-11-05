/**
 * Kyana AI — 50-Question Academic Visual Selection Evaluation Benchmark Suite
 *
 * Evaluates:
 * 1. Whether a visual is useful for the student's question.
 * 2. Whether Kyana selects the least complicated, most appropriate visual representation.
 * 3. Whether unnecessary visuals are strictly avoided on simple definitions and lookups.
 * 4. False-positive rate (unsolicited clutter) and False-negative rate (missed visual opportunities).
 * 5. Full end-to-end assistant pipeline integration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planVisualExplanation,
  buildDeterministicVisualEnrichment,
  classifyAcademicQuestion
} = require('../lib/academic-intelligence');
const { handleChat } = require('../ai-assistant');

const FIFTY_REALISTIC_BIT_QUESTIONS = [
  // ==========================================================================
  // Category A: 25 Questions where a visual MATERIALLY IMPROVES understanding
  // ==========================================================================
  {
    id: 'VIS-01',
    subject: 'Web Technology I (CIT 123 / CIT 215)',
    question: 'What is a CSS selector?',
    expectVisual: true,
    expectedType: 'code_preview',
    rationale: 'Small DOM targeting demonstration with paired HTML/CSS allows students to see selector targets immediately.'
  },
  {
    id: 'VIS-02',
    subject: 'Web Technology / Computer Networks (CIT 123 / CIT 223)',
    question: 'What is session and cookies management?',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Client-browser vs server vs session-store sequence lifecycle explains stateless HTTP resolution.'
  },
  {
    id: 'VIS-03',
    subject: 'Computer Networks (CIT 223)',
    question: 'How does the TCP 3-way handshake work?',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Three-step SYN, SYN-ACK, ACK sequence diagram with sequence numbers and connection states.'
  },
  {
    id: 'VIS-04',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'How to insert a node at the head of a singly linked list?',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'Node pointer rewiring (newNode->next = HEAD, HEAD = newNode) is best learned via visual pointer updates.'
  },
  {
    id: 'VIS-05',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'What is a binary search tree and its ordering invariant?',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Tree hierarchy showing Left < Root < Right ordering invariant and sorted inorder traversal.'
  },
  {
    id: 'VIS-06',
    subject: 'Programming in C (CIT 111 / CIT 121)',
    question: 'How does recursion work in C?',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'Call-stack push (winding) and pop (unwinding) demonstrates why LIFO frames avoid stack overflow.'
  },
  {
    id: 'VIS-07',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'Explain merge sort divide and conquer steps',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'Recursive array splitting followed by two-pointer merge sorting passes.'
  },
  {
    id: 'VIS-08',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'How does binary search find a target in a sorted array?',
    expectVisual: true,
    expectedType: 'simulation',
    rationale: 'Interactive pointer narrowing (low/mid/high) proves logarithmic halving.'
  },
  {
    id: 'VIS-09',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'How does Dijkstra algorithm find the shortest path?',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'Step-by-step edge relaxation and min-priority queue distance updates.'
  },
  {
    id: 'VIS-10',
    subject: 'Database Management Systems (CIT 212 / CIT 222)',
    question: 'Explain database normalization UNF to 3NF',
    expectVisual: true,
    expectedType: 'comparison',
    rationale: 'Concrete table decompositions eliminate repeating groups, partial, and transitive dependencies.'
  },
  {
    id: 'VIS-11',
    subject: 'Physics / Mechanics (PHY 111)',
    question: 'Explain projectile motion and formula derivation',
    expectVisual: true,
    expectedType: 'simulation',
    rationale: '2D parabolic trajectory simulation with initial velocity and launch angle controls.'
  },
  {
    id: 'VIS-12',
    subject: 'Physics / Waves & Optics (PHY 111)',
    question: 'How do wave frequency and amplitude affect a sine wave?',
    expectVisual: true,
    expectedType: 'simulation',
    rationale: 'Interactive waveform simulation demonstrates energy scaling and wavelength compression.'
  },
  {
    id: 'VIS-13',
    subject: 'Web Technology I (CIT 123)',
    question: 'Explain the CSS box model padding and margin',
    expectVisual: true,
    expectedType: 'simulation',
    rationale: 'Concentric box layers (content, padding, border, margin) with interactive dimension recalculation.'
  },
  {
    id: 'VIS-14',
    subject: 'Physics / Electromagnetism (PHY 111 / ELE 112)',
    question: 'Explain Faraday law of electromagnetic induction',
    expectVisual: true,
    expectedType: 'illustration',
    rationale: 'Scientific vector illustration showing dipole magnetic flux linkage and induced EMF direction.'
  },
  {
    id: 'VIS-15',
    subject: 'Basic Electrical Engineering / Physics (ELE 112 / PHY 111)',
    question: 'Explain Ohm law and circuit current flow',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Closed DC circuit diagram paired with linear V-I proportionality graph.'
  },
  {
    id: 'VIS-16',
    subject: 'Computer Networks (CIT 223)',
    question: 'Explain the OSI 7 layer architecture',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Layered architectural stack from Physical to Application with protocol mappings.'
  },
  {
    id: 'VIS-17',
    subject: 'Web Technology II (CIT 215)',
    question: 'How does client server REST API request response cycle work?',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Client -> API Gateway -> Database -> Client sequence flow.'
  },
  {
    id: 'VIS-18',
    subject: 'Computer Architecture (CIT 211)',
    question: 'Explain CPU instruction fetch decode execute cycle',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Control unit, ALU, and register state transitions during instruction pipeline.'
  },
  {
    id: 'VIS-19',
    subject: 'Operating Systems (CIT 221)',
    question: 'Explain Operating System process states transition diagram',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'State transitions between New, Ready, Running, Waiting, and Terminated.'
  },
  {
    id: 'VIS-20',
    subject: 'Operating Systems (CIT 221)',
    question: 'Explain deadlock 4 conditions with resource allocation graph',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Circular wait cycle illustrated through processes and resource node edges.'
  },
  {
    id: 'VIS-21',
    subject: 'Computer Networks (CIT 223)',
    question: 'How does HTTP request response lifecycle work?',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'DNS resolution, TCP/TLS handshake, HTTP headers, and response rendering.'
  },
  {
    id: 'VIS-22',
    subject: 'Computer Architecture (CIT 211)',
    question: 'Explain memory hierarchy cache RAM disk architecture',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Pyramid hierarchy comparing latency, capacity, and cost per bit.'
  },
  {
    id: 'VIS-23',
    subject: 'Operating Systems (CIT 221)',
    question: 'Explain paging and virtual memory address translation',
    expectVisual: true,
    expectedType: 'diagram',
    rationale: 'Logical page number to physical frame offset mapping via page table.'
  },
  {
    id: 'VIS-24',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'How does quicksort partition array step by step?',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'Pivot selection and two-pointer swap sequence across subarray passes.'
  },
  {
    id: 'VIS-25',
    subject: 'Data Structures and Algorithms (CIT 214)',
    question: 'Explain breadth first search queue traversal',
    expectVisual: true,
    expectedType: 'trace',
    rationale: 'FIFO queue state progression visiting level-by-level neighbors.'
  },

  // ==========================================================================
  // Category B: 25 Questions where plain text is SUFFICIENT (No visual needed)
  // ==========================================================================
  {
    id: 'TXT-01',
    subject: 'Computer Networks',
    question: 'What is an IP address?',
    expectVisual: false,
    rationale: 'Fundamental 1-sentence definition; visual diagram adds no pedagogical value.'
  },
  {
    id: 'TXT-02',
    subject: 'Computer Networks',
    question: 'What is port 80?',
    expectVisual: false,
    rationale: 'Standard default HTTP networking port number.'
  },
  {
    id: 'TXT-03',
    subject: 'Object-Oriented Programming (Java / C++)',
    question: 'Define polymorphism',
    expectVisual: false,
    rationale: 'Theoretical OOP definition (ability of an entity to take many forms).'
  },
  {
    id: 'TXT-04',
    subject: 'Database Management Systems',
    question: 'What does SQL stand for?',
    expectVisual: false,
    rationale: 'Direct acronym lookup (Structured Query Language).'
  },
  {
    id: 'TXT-05',
    subject: 'Programming in C',
    question: 'Who invented C language?',
    expectVisual: false,
    rationale: 'Factual history query (Dennis Ritchie at Bell Labs in 1972).'
  },
  {
    id: 'TXT-06',
    subject: 'Programming Fundamentals (Python)',
    question: 'What is a variable in Python?',
    expectVisual: false,
    rationale: 'Basic programming concept definition (named memory reference).'
  },
  {
    id: 'TXT-07',
    subject: 'Academic Administration',
    question: 'What is the course code of DSA?',
    expectVisual: false,
    rationale: 'Factual university course code lookup.'
  },
  {
    id: 'TXT-08',
    subject: 'Computer Hardware',
    question: 'What is RAM?',
    expectVisual: false,
    rationale: 'Volatile primary memory definition.'
  },
  {
    id: 'TXT-09',
    subject: 'Computer Hardware',
    question: 'What is ROM?',
    expectVisual: false,
    rationale: 'Non-volatile read-only memory definition.'
  },
  {
    id: 'TXT-10',
    subject: 'Database Management Systems',
    question: 'What is a primary key?',
    expectVisual: false,
    rationale: 'Relational uniqueness constraint definition.'
  },
  {
    id: 'TXT-11',
    subject: 'Database Management Systems',
    question: 'What is a foreign key?',
    expectVisual: false,
    rationale: 'Referential integrity constraint definition.'
  },
  {
    id: 'TXT-12',
    subject: 'Computer Networks',
    question: 'What is DNS?',
    expectVisual: false,
    rationale: 'Domain Name System naming lookup definition.'
  },
  {
    id: 'TXT-13',
    subject: 'System Software',
    question: 'What is a compiler?',
    expectVisual: false,
    rationale: 'Language translator converting high-level source to machine code.'
  },
  {
    id: 'TXT-14',
    subject: 'System Software',
    question: 'What is an interpreter?',
    expectVisual: false,
    rationale: 'Line-by-line code executor definition.'
  },
  {
    id: 'TXT-15',
    subject: 'Java Programming',
    question: 'What is bytecode in Java?',
    expectVisual: false,
    rationale: 'Intermediate JVM instruction format definition.'
  },
  {
    id: 'TXT-16',
    subject: 'Web Technology',
    question: 'What does HTML stand for?',
    expectVisual: false,
    rationale: 'HyperText Markup Language acronym lookup.'
  },
  {
    id: 'TXT-17',
    subject: 'Web Technology',
    question: 'What does CSS stand for?',
    expectVisual: false,
    rationale: 'Cascading Style Sheets acronym lookup.'
  },
  {
    id: 'TXT-18',
    subject: 'Computer Networks',
    question: 'What is a subnet mask?',
    expectVisual: false,
    rationale: 'Bitmask dividing network and host portions of an IP address.'
  },
  {
    id: 'TXT-19',
    subject: 'Computer Networks',
    question: 'What is a MAC address?',
    expectVisual: false,
    rationale: '48-bit physical hardware identifier.'
  },
  {
    id: 'TXT-20',
    subject: 'Computer Networks',
    question: 'What is a default gateway?',
    expectVisual: false,
    rationale: 'Routing node forwarding traffic to outside networks.'
  },
  {
    id: 'TXT-21',
    subject: 'Programming in C',
    question: 'What is a constant in C?',
    expectVisual: false,
    rationale: 'Immutable identifier defined via const or #define.'
  },
  {
    id: 'TXT-22',
    subject: 'Programming Fundamentals',
    question: 'What is a boolean data type?',
    expectVisual: false,
    rationale: 'Binary true/false truth value primitive.'
  },
  {
    id: 'TXT-23',
    subject: 'Computer Networks',
    question: 'How many bits are in an IPv4 address?',
    expectVisual: false,
    rationale: 'Direct numerical fact (32 bits).'
  },
  {
    id: 'TXT-24',
    subject: 'Database Management Systems',
    question: 'What is the full form of DBMS?',
    expectVisual: false,
    rationale: 'Database Management System acronym.'
  },
  {
    id: 'TXT-25',
    subject: 'Programming Languages',
    question: 'When was Python released?',
    expectVisual: false,
    rationale: 'Factual release year (1991 by Guido van Rossum).'
  }
];

test('Benchmark: 50 realistic BIT student questions achieve >= 98% visual selection accuracy with zero missed opportunities', () => {
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const failureDetails = [];

  for (const item of FIFTY_REALISTIC_BIT_QUESTIONS) {
    const plan = planVisualExplanation(item.question);
    const classification = classifyAcademicQuestion(item.question);
    const enrichment = buildDeterministicVisualEnrichment(item.question, classification, '');
    const actualHasVisual = plan.needsVisual || Boolean(enrichment);

    if (item.expectVisual && actualHasVisual) {
      truePositives++;
      // Verify visual block kind matches expected pedagogical type
      if (item.expectedType) {
        assert.ok(
          plan.primaryVisualType === item.expectedType ||
          plan.visualComponents.includes(item.expectedType) ||
          enrichment.includes(`\`\`\`${item.expectedType}`),
          `Question "${item.question}" expected visual type "${item.expectedType}", but got primary "${plan.primaryVisualType}" and enrichment "${enrichment.slice(0, 40)}"`
        );
      }
    } else if (!item.expectVisual && !actualHasVisual) {
      trueNegatives++;
      assert.equal(enrichment, '', `Simple definition "${item.question}" must not emit any visual block`);
    } else if (!item.expectVisual && actualHasVisual) {
      falsePositives++;
      failureDetails.push({ id: item.id, type: 'False Positive (Unnecessary Visual)', question: item.question });
    } else {
      falseNegatives++;
      failureDetails.push({ id: item.id, type: 'False Negative (Missed Visual Opportunity)', question: item.question });
    }
  }

  const total = FIFTY_REALISTIC_BIT_QUESTIONS.length;
  const accuracyPct = ((truePositives + trueNegatives) / total) * 100;

  console.log(`\n======================================================`);
  console.log(`KYANA VISUAL SELECTION EVALUATION RESULTS (${total} QUESTIONS):`);
  console.log(`  True Positives  (Visual Correctly Chosen)   : ${truePositives} / 25`);
  console.log(`  True Negatives  (Plain Text Maintained)    : ${trueNegatives} / 25`);
  console.log(`  False Positives (Unnecessary Visual Clutter): ${falsePositives}`);
  console.log(`  False Negatives (Missed Visual Opportunity) : ${falseNegatives}`);
  console.log(`  Overall Visual Selection Accuracy           : ${accuracyPct.toFixed(1)}%`);
  console.log(`======================================================\n`);

  assert.equal(falseNegatives, 0, 'Zero missed visual opportunities required across curriculum');
  assert.equal(falsePositives, 0, 'Zero false positive visuals on simple definitions');
  assert.equal(accuracyPct, 100, 'Must achieve 100% accuracy on evaluated standard question set');
});

test('End-to-End Pipeline: ai-assistant attaches visual blocks to conceptual questions without requiring explicit keywords', async () => {
  const mockDb = {
    execute: async () => ({ rows: [] })
  };

  const conceptualQuestions = [
    { q: 'What is session and cookies management?', expectedBlock: '```diagram' },
    { q: 'How does the TCP 3-way handshake work?', expectedBlock: '```diagram' },
    { q: 'What is a CSS selector?', expectedBlock: '```code_preview' },
    { q: 'Explain database normalization', expectedBlock: '```diagram' },
    { q: 'How does recursion work in C?', expectedBlock: '```trace' },
    { q: 'Explain projectile motion', expectedBlock: '```simulation' }
  ];

  for (const item of conceptualQuestions) {
    const res = await handleChat(
      mockDb,
      item.q,
      { studentId: 'stu_saugat', role: 'student', semester: 3 },
      [],
      'eval-sess-concept',
      {
        classifyScope: async () => ({ inScope: true, confidence: 1 }),
        generateReply: async ({ onDelta }) => {
          const text = `Here is the comprehensive academic explanation for: ${item.q}.`;
          if (onDelta) onDelta(text);
          return { reply: text };
        }
      }
    );

    assert.ok(
      res.reply.includes(item.expectedBlock),
      `Expected ${item.expectedBlock} in reply to "${item.q}", got:\n${res.reply.slice(0, 200)}...`
    );
  }
});

test('End-to-End Pipeline: ai-assistant strictly maintains clean, concise text for simple definitions', async () => {
  const mockDb = {
    execute: async () => ({ rows: [] })
  };

  const plainTextQuestions = [
    'What is an IP address?',
    'What is port 80?',
    'Define polymorphism',
    'What does SQL stand for?',
    'Who invented C language?'
  ];

  for (const q of plainTextQuestions) {
    const res = await handleChat(
      mockDb,
      q,
      { studentId: 'stu_saugat', role: 'student', semester: 3 },
      [],
      'eval-sess-def',
      {
        classifyScope: async () => ({ inScope: true, confidence: 1 }),
        generateReply: async ({ onDelta }) => {
          const text = `Direct definition for: ${q}.`;
          if (onDelta) onDelta(text);
          return { reply: text };
        }
      }
    );

    const hasAnyVisual = /```(?:syllabus|diagram|flowchart|graph|trace|quiz|roadmap|simulation|code_preview|illustration)\b/.test(res.reply);
    assert.equal(
      hasAnyVisual,
      false,
      `Simple question "${q}" should not contain visual blocks, got:\n${res.reply}`
    );
  }
});
