'use strict';

/**
 * Kyana AI — Adaptive Presentation Engine
 *
 * Core Principle: Content determines presentation. Presentation must never dictate content.
 *
 * Responsibilities:
 * 1. Dynamic Presentation Selection (`planAdaptivePresentation`):
 *    Determines the optimal presentation profile based on question type, concept complexity,
 *    whether a visual/table/equation improves clarity, whether interactivity aids experimentation,
 *    and the student's current learning stage.
 * 2. Validated Structured Component Registry (`COMPONENT_REGISTRY`, `validateStructuredComponent`):
 *    Validates schemas for optional, context-dependent educational components:
 *    - LearningSession
 *    - InteractiveDemo (e.g. logic_gate_simulator, web_live_preview, algorithm_stepper)
 *    - Diagram
 *    - Formula
 *    - ComparisonTable
 *    - CheckpointQuestion
 *    - CodeExample
 *    - ChapterSummary
 *    - SourceReference
 *    Never executes arbitrary HTML/JS and never leaks internal component identifiers or malformed JSON.
 * 3. Streaming Stabilization (`stabilizeStreamingMarkdown`, `sanitizeAdaptiveResponse`):
 *    Prevents partial JSON blocks, unclosed fences, or broken math/table syntax from flashing during streaming.
 */

const PRESENTATION_PROFILES = Object.freeze({
  SIMPLE_CONVERSATIONAL: 'simple_conversational',
  SIMPLE_DEFINITION: 'simple_definition',
  CONCEPTUAL_EXPLANATION: 'conceptual_explanation',
  MATHEMATICAL_DERIVATION: 'mathematical_derivation',
  TRUTH_TABLE: 'truth_table',
  COMPARISON_TABLE: 'comparison_table',
  ALGORITHM_WALKTHROUGH: 'algorithm_walkthrough',
  PROGRAMMING_CODE: 'programming_code',
  VISUAL_DIAGRAM: 'visual_diagram',
  INTERACTIVE_SIMULATION: 'interactive_simulation',
  CHAPTER_TEACHING: 'chapter_teaching',
  PYQ_EXPLANATION: 'pyq_explanation',
  PDF_GROUNDED_EXPLANATION: 'pdf_grounded_explanation'
});

const COMPONENT_TYPES = Object.freeze({
  LEARNING_SESSION: 'LearningSession',
  INTERACTIVE_DEMO: 'InteractiveDemo',
  DIAGRAM: 'Diagram',
  FORMULA: 'Formula',
  COMPARISON_TABLE: 'ComparisonTable',
  CHECKPOINT_QUESTION: 'CheckpointQuestion',
  CODE_EXAMPLE: 'CodeExample',
  CHAPTER_SUMMARY: 'ChapterSummary',
  SOURCE_REFERENCE: 'SourceReference'
});

const STRUCTURED_FENCE_KINDS = new Set([
  'study_session',
  'learning_session',
  'interactive_demo',
  'logic_sim',
  'live_demo',
  'diagram',
  'flowchart',
  'trace',
  'roadmap',
  'timeline',
  'pyq_card',
  'checkpoint_question',
  'chapter_summary',
  'source_reference'
]);

const LOGIC_GATES_SPEC = Object.freeze({
  AND: {
    gate: 'AND',
    symbol: 'A · B',
    latex: 'Y = A \\land B = A \\cdot B',
    inputs: ['A', 'B'],
    description: 'Outputs 1 (HIGH) only when all inputs are 1.',
    truthTable: [
      { A: 0, B: 0, Y: 0 },
      { A: 0, B: 1, Y: 0 },
      { A: 1, B: 0, Y: 0 },
      { A: 1, B: 1, Y: 1 }
    ]
  },
  OR: {
    gate: 'OR',
    symbol: 'A + B',
    latex: 'Y = A \\lor B = A + B',
    inputs: ['A', 'B'],
    description: 'Outputs 1 (HIGH) when at least one input is 1.',
    truthTable: [
      { A: 0, B: 0, Y: 0 },
      { A: 0, B: 1, Y: 1 },
      { A: 1, B: 0, Y: 1 },
      { A: 1, B: 1, Y: 1 }
    ]
  },
  NOT: {
    gate: 'NOT',
    symbol: "A'",
    latex: 'Y = \\lnot A = \\overline{A}',
    inputs: ['A'],
    description: 'Inverts the input signal (0 becomes 1, and 1 becomes 0).',
    truthTable: [
      { A: 0, Y: 1 },
      { A: 1, Y: 0 }
    ]
  },
  NAND: {
    gate: 'NAND',
    symbol: "(A · B)'",
    latex: 'Y = \\overline{A \\cdot B}',
    inputs: ['A', 'B'],
    description: 'Universal gate: outputs 0 only when all inputs are 1.',
    truthTable: [
      { A: 0, B: 0, Y: 1 },
      { A: 0, B: 1, Y: 1 },
      { A: 1, B: 0, Y: 1 },
      { A: 1, B: 1, Y: 0 }
    ]
  },
  NOR: {
    gate: 'NOR',
    symbol: "(A + B)'",
    latex: 'Y = \\overline{A + B}',
    inputs: ['A', 'B'],
    description: 'Universal gate: outputs 1 only when all inputs are 0.',
    truthTable: [
      { A: 0, B: 0, Y: 1 },
      { A: 0, B: 1, Y: 0 },
      { A: 1, B: 0, Y: 0 },
      { A: 1, B: 1, Y: 0 }
    ]
  },
  XOR: {
    gate: 'XOR',
    symbol: 'A ⊕ B',
    latex: 'Y = A \\oplus B = \\overline{A}B + A\\overline{B}',
    inputs: ['A', 'B'],
    description: 'Exclusive OR: outputs 1 when the inputs are different.',
    truthTable: [
      { A: 0, B: 0, Y: 0 },
      { A: 0, B: 1, Y: 1 },
      { A: 1, B: 0, Y: 1 },
      { A: 1, B: 1, Y: 0 }
    ]
  },
  XNOR: {
    gate: 'XNOR',
    symbol: "(A ⊕ B)'",
    latex: 'Y = \\overline{A \\oplus B} = AB + \\overline{A}\\,\\overline{B}',
    inputs: ['A', 'B'],
    description: 'Equivalence gate: outputs 1 when both inputs are identical.',
    truthTable: [
      { A: 0, B: 0, Y: 1 },
      { A: 0, B: 1, Y: 0 },
      { A: 1, B: 0, Y: 0 },
      { A: 1, B: 1, Y: 1 }
    ]
  }
});

function sanitizePlainString(val, maxLen = 400) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Determines the optimal presentation strategy for a student question and context.
 * Enforces the rule: "Content determines presentation. Presentation must never dictate content."
 */
function planAdaptivePresentation(message = '', options = {}) {
  const clean = String(message || '').trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  const hasPdfEvidence = Boolean(
    options.foundInChapterFiles || (Array.isArray(options.noteChunks) && options.noteChunks.length > 0)
  );
  const hasPyqEvidence = Boolean(
    options.hasPyq ||
      /\b(?:pyqs?|past\s+(?:year\s+|exam\s+)?questions?|university\s+exam\s+questions?|model\s+questions?|board\s+questions?)\b/i.test(clean)
  );
  const isStudySession = Boolean(options.isStudySession);

  // 1. Complete chapter / unit teaching session
  const isChapterTeachRequest =
    isStudySession ||
    /\b(?:teach\s+me\s+(?:this|the|complete|full|whole)?\s*(?:chapter|unit)(?:\s+\d+)?(?:\s+completely|\s+step\s+by\s+step)?|teach\s+me\s+unit\s+\d+(?:\s+completely)?|start\s+teaching(?:\s+this\s+chapter)?|teach\s+me\s+step\s+by\s+step|yo\s+(?:chapter|unit)\s+(?:padhaideu|sikaideu))\b/i.test(clean);

  if (isChapterTeachRequest) {
    return {
      profile: PRESENTATION_PROFILES.CHAPTER_TEACHING,
      primaryFormat: 'markdown_with_roadmap',
      allowedComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CODE_EXAMPLE,
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.DIAGRAM,
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.CHECKPOINT_QUESTION,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [],
      useHeadings: true,
      useTables: false,
      useLatex: true,
      useCodeBlocks: true,
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: true,
      useRoadmap: true,
      rationale: 'Student asked for complete/step-by-step chapter or unit teaching.'
    };
  }

  // 2. Interactive Logic Gates / Digital Circuit Simulation
  const isLogicGateQuery =
    /\b(?:logic\s+gates?|(?:and|or|not|nand|nor|xor|xnor)\s+(?:and\s+|,\s*)*(?:and|or|not|nand|nor|xor|xnor)?\s*gates?|universal\s+gates?|half\s+adder|full\s+adder|combinational\s+logic\s+gates?)\b/i.test(clean);

  if (isLogicGateQuery) {
    const requestedGates = [];
    for (const g of ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']) {
      if (new RegExp(`\\b${g}\\b`, 'i').test(clean)) {
        requestedGates.push(g);
      }
    }
    const gates = requestedGates.length > 0 ? requestedGates : ['AND', 'OR', 'NOT'];
    return {
      profile: PRESENTATION_PROFILES.INTERACTIVE_SIMULATION,
      simulationType: 'logic_gate_simulator',
      gates,
      primaryFormat: 'markdown_with_interactive_demo',
      allowedComponents: [
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CHAPTER_SUMMARY
      ],
      useHeadings: true,
      useTables: true,
      useLatex: true,
      useCodeBlocks: false,
      useDiagram: false,
      useInteractiveDemo: true,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Logic gates benefit directly from Boolean algebraic notation, truth tables, and an interactive input-toggle simulator.'
    };
  }

  // 3. Logical Operations & Truth Tables (without needing a hardware gate simulator unless asked)
  const isTruthTableQuery =
    /\b(?:truth\s+tables?|tautolog(?:y|ies)|contradiction|contingency|logical\s+equivalence|de\s*morgan'?s?\s+laws?|propositional\s+equivalence|implication\s+truth|biconditional)\b/i.test(clean);

  if (isTruthTableQuery) {
    return {
      profile: PRESENTATION_PROFILES.TRUTH_TABLE,
      primaryFormat: 'markdown_with_table_and_latex',
      allowedComponents: [
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CHAPTER_SUMMARY,
        COMPONENT_TYPES.CHECKPOINT_QUESTION
      ],
      useHeadings: true,
      useTables: true,
      useLatex: true,
      useCodeBlocks: false,
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Truth tables and logical equivalences are clearest with proper LaTeX logical operators and a clean Markdown table.'
    };
  }

  // 4. Mathematical Equations, Proofs & Derivations
  const isMathDerivationQuery =
    /\b(?:derive|derivation|prove|proof\s+of|integrate|integral|differentiate|derivative|differential\s+equation|taylor\s+series|maclaurin|laplace|fourier|eigenvalue|eigenvector|matrix|matrices|determinant|cramer'?s?\s+rule|recurrence\s+relation|master\s+theorem|bayes'?\s+theorem|normal\s+distribution|poisson|binomial\s+distribution|quadratic\s+formula|newton[- ]raphson|simpson'?s?\s+rule|trapezoidal\s+rule|euler'?s?\s+method|calculate|solve\s+for)\b/i.test(clean) ||
    /[∫∑∏√∂∇±≠≤≥≈]|\\[a-z]+/i.test(clean);

  if (isMathDerivationQuery) {
    return {
      profile: PRESENTATION_PROFILES.MATHEMATICAL_DERIVATION,
      primaryFormat: 'markdown_with_latex',
      allowedComponents: [
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CHAPTER_SUMMARY,
        COMPONENT_TYPES.CHECKPOINT_QUESTION
      ],
      useHeadings: true,
      useTables: false,
      useLatex: true,
      useCodeBlocks: false,
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Mathematical derivations require clean inline ($...$) and block ($$...$$ / aligned) LaTeX equations and step-by-step reasoning.'
    };
  }

  // 5. PYQ / Past Exam Question Solving
  if (hasPyqEvidence) {
    return {
      profile: PRESENTATION_PROFILES.PYQ_EXPLANATION,
      primaryFormat: 'markdown_exam_solution',
      allowedComponents: [
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.CODE_EXAMPLE,
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.DIAGRAM,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION
      ],
      useHeadings: true,
      useTables: /\b(?:compare|differentiate|difference|truth\s+table)\b/i.test(clean),
      useLatex: true,
      useCodeBlocks: /\b(?:code|program|function|implement|html|css|js|php|sql|c\b|c\+\+|java|python|algorithm)\b/i.test(clean),
      useDiagram: /\b(?:diagram|architecture|flowchart|block\s+diagram|osi|model)\b/i.test(clean),
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Past exam question requires a structured, full-marks model answer grounded in course notes and syllabus.'
    };
  }

  // 6. Comparisons ("Difference between X and Y", "Compare X vs Y")
  const isComparisonQuery =
    /\b(?:difference\s+between|differences?\s+between|differentiate\s+between|compare|comparison\s+of|distinguish\s+between|versus|\bvs\.?\b|farak\s+k\s+ho)\b/i.test(clean);

  if (isComparisonQuery) {
    return {
      profile: PRESENTATION_PROFILES.COMPARISON_TABLE,
      primaryFormat: 'markdown_with_comparison_table',
      allowedComponents: [
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.CODE_EXAMPLE,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.CHECKPOINT_QUESTION,
        COMPONENT_TYPES.CHAPTER_SUMMARY
      ],
      useHeadings: true,
      useTables: true,
      useLatex: false,
      useCodeBlocks: /\b(?:code|example|syntax|html|css|js|c\b|java|python|sql|php|pointer|reference)\b/i.test(clean),
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Comparing two or more concepts across shared dimensions is clearest with a concise Markdown table.'
    };
  }

  // 7. Programming & Code Explanation
  const isProgrammingQuery =
    /\b(?:write\s+(?:a\s+)?(?:program|code|function|script|query)|code\s+example|implement|syntax\s+of|in\s+(?:c|c\+\+|java|python|javascript|js|php|sql|html|css)|how\s+to\s+code|program\s+in\s+c|pointer|malloc|struct\b|class\s+in\s+java|react|dom\s+manipulation|css\s+selectors?|flexbox|grid|box\s+model)\b/i.test(clean);

  if (isProgrammingQuery) {
    const wantsLiveWebDemo =
      /\b(?:css\s+selectors?|box\s+model|flexbox|inline\s+internal\s+external\s+css|html\s+and\s+css)\b/i.test(clean) &&
      /\b(?:demo|interactive|visually|show\s+how\s+it\s+looks)\b/i.test(clean);
    return {
      profile: PRESENTATION_PROFILES.PROGRAMMING_CODE,
      primaryFormat: 'markdown_with_code',
      allowedComponents: [
        COMPONENT_TYPES.CODE_EXAMPLE,
        ...(wantsLiveWebDemo ? [COMPONENT_TYPES.INTERACTIVE_DEMO] : []),
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CHAPTER_SUMMARY,
        COMPONENT_TYPES.CHECKPOINT_QUESTION
      ],
      useHeadings: true,
      useTables: false,
      useLatex: /\b(?:complexity|big[- ]o)\b/i.test(clean),
      useCodeBlocks: true,
      useDiagram: false,
      useInteractiveDemo: wantsLiveWebDemo,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Programming concepts require syntax-highlighted code examples with clear inline comments and execution walkthrough.'
    };
  }

  // 8. Algorithms & Step-by-Step Walkthroughs
  const isAlgorithmQuery =
    /\b(?:algorithm|quicksort|mergesort|bubblesort|heapsort|insertion\s+sort|selection\s+sort|binary\s+search|bfs|dfs|dijkstra|kruskal|prim|bellman[- ]ford|floyd[- ]warshall|knapsack|round\s+robin|banker'?s\s+algorithm|lru\s+page|fifo\s+page|dda\s+algorithm|bresenham)\b/i.test(clean);

  if (isAlgorithmQuery) {
    return {
      profile: PRESENTATION_PROFILES.ALGORITHM_WALKTHROUGH,
      primaryFormat: 'markdown_algorithm_walkthrough',
      allowedComponents: [
        COMPONENT_TYPES.CODE_EXAMPLE,
        COMPONENT_TYPES.FORMULA,
        COMPONENT_TYPES.DIAGRAM,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.CHAPTER_SUMMARY
      ],
      useHeadings: true,
      useTables: /\b(?:trace|dry\s+run|scheduling|banker|page\s+replacement)\b/i.test(clean),
      useLatex: true,
      useCodeBlocks: true,
      useDiagram: /\b(?:flowchart|diagram|tree|graph)\b/i.test(clean),
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Algorithms require a step-by-step walkthrough, dry-run trace, code implementation, and Big-O complexity.'
    };
  }

  // 9. Complex Processes, Architectures & Flowcharts
  const isDiagramProcessQuery =
    /\b(?:flowchart|diagram|architecture|osi\s+(?:7[- ]layer\s+)?model|tcp\/ip\s+model|process\s+(?:state|lifecycle)|instruction\s+cycle|fetch[- ]decode[- ]execute|compilation\s+phases?|compiler\s+phases?|3[- ]schema\s+architecture|database\s+architecture|sdlc\s+phases?|waterfall\s+model|von\s+neumann)\b/i.test(clean);

  if (isDiagramProcessQuery) {
    return {
      profile: PRESENTATION_PROFILES.VISUAL_DIAGRAM,
      primaryFormat: 'markdown_with_diagram',
      allowedComponents: [
        COMPONENT_TYPES.DIAGRAM,
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.SOURCE_REFERENCE
      ],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.CHECKPOINT_QUESTION
      ],
      useHeadings: true,
      useTables: false,
      useLatex: false,
      useCodeBlocks: false,
      useDiagram: true,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'System architectures and multi-stage processes benefit from a clean structural flow diagram alongside prose.'
    };
  }

  // 10. Simple Conversational Question (greetings, short campus/schedule questions, quick yes/no)
  const isSimpleConversational =
    wordCount <= 8 &&
    !/\b(?:explain|describe|elaborate|derive|prove|compare|differentiate|algorithm|architecture|teach|walkthrough|in\s+detail|step\s+by\s+step)\b/i.test(clean) &&
    !/\b(?:what\s+is|what\s+are|define|definition\s+of)\b/i.test(clean);

  if (isSimpleConversational && !hasPdfEvidence) {
    return {
      profile: PRESENTATION_PROFILES.SIMPLE_CONVERSATIONAL,
      primaryFormat: 'natural_prose',
      allowedComponents: [],
      forbiddenComponents: Object.values(COMPONENT_TYPES),
      useHeadings: false,
      useTables: false,
      useLatex: false,
      useCodeBlocks: false,
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Short conversational questions should receive a direct, natural conversational answer with zero unnecessary widgets or headers.'
    };
  }

  // 11. Simple Definition ("What is a proposition?", "Define deadlock", "What is a primary key?")
  const isSimpleDefinition =
    /^(?:what\s+(?:is|are)\s+(?:a|an|the)?\s*[a-z0-9\s-]{2,35}|define\s+[a-z0-9\s-]{2,35}|definition\s+of\s+[a-z0-9\s-]{2,35}|[a-z0-9\s-]{2,25}\s+(?:bhaneko|vaneko)\s+k\s+ho)[?.!]*$/i.test(clean) &&
    !/\b(?:in\s+detail|step\s+by\s+step|with\s+diagram|with\s+code|and\s+explain\s+all|types\s+of)\b/i.test(clean);

  if (isSimpleDefinition) {
    return {
      profile: hasPdfEvidence ? PRESENTATION_PROFILES.PDF_GROUNDED_EXPLANATION : PRESENTATION_PROFILES.SIMPLE_DEFINITION,
      primaryFormat: 'natural_paragraphs',
      allowedComponents: hasPdfEvidence ? [COMPONENT_TYPES.SOURCE_REFERENCE] : [],
      forbiddenComponents: [
        COMPONENT_TYPES.LEARNING_SESSION,
        COMPONENT_TYPES.INTERACTIVE_DEMO,
        COMPONENT_TYPES.DIAGRAM,
        COMPONENT_TYPES.COMPARISON_TABLE,
        COMPONENT_TYPES.CHECKPOINT_QUESTION,
        COMPONENT_TYPES.CHAPTER_SUMMARY
      ],
      useHeadings: false,
      useTables: false,
      useLatex: /\b(?:proposition|set|function|matrix|derivative|integral|probability|complexity|big[- ]o|boolean)\b/i.test(clean),
      useCodeBlocks: false,
      useDiagram: false,
      useInteractiveDemo: false,
      useCheckpoint: false,
      useRoadmap: false,
      rationale: 'Simple definitions are best explained with crisp natural paragraphs, bold key terms, and 1–2 concise examples—no cards or simulators.'
    };
  }

  // 12. Default Conceptual / PDF-Grounded Explanation
  return {
    profile: hasPdfEvidence ? PRESENTATION_PROFILES.PDF_GROUNDED_EXPLANATION : PRESENTATION_PROFILES.CONCEPTUAL_EXPLANATION,
    primaryFormat: 'structured_markdown',
    allowedComponents: [
      COMPONENT_TYPES.FORMULA,
      COMPONENT_TYPES.CODE_EXAMPLE,
      COMPONENT_TYPES.SOURCE_REFERENCE
    ],
    forbiddenComponents: [
      COMPONENT_TYPES.LEARNING_SESSION,
      COMPONENT_TYPES.INTERACTIVE_DEMO,
      COMPONENT_TYPES.CHECKPOINT_QUESTION,
      COMPONENT_TYPES.CHAPTER_SUMMARY
    ],
    useHeadings: true,
    useTables: false,
    useLatex: true,
    useCodeBlocks: false,
    useDiagram: false,
    useInteractiveDemo: false,
    useCheckpoint: false,
    useRoadmap: false,
    rationale: 'Conceptual explanation uses clear headings, well-spaced paragraphs, and concrete examples.'
  };
}

/**
 * Builds an interactive Logic Gate Simulator payload (`InteractiveDemo` / `logic_sim` fence)
 * for the requested gates.
 */
function buildLogicGateSimulatorPayload(gates = ['AND', 'OR', 'NOT']) {
  const validGates = gates
    .map((g) => String(g || '').toUpperCase().trim())
    .filter((g) => Boolean(LOGIC_GATES_SPEC[g]));
  const selected = validGates.length > 0 ? validGates : ['AND', 'OR', 'NOT'];

  return {
    componentType: COMPONENT_TYPES.INTERACTIVE_DEMO,
    demoType: 'logic_gate_simulator',
    title: 'Interactive Logic Gate Simulator',
    subtitle: 'Toggle inputs A and B between 0 and 1 to observe the gate output and active truth-table row in real time.',
    gates: selected.map((g) => LOGIC_GATES_SPEC[g]),
    initialGate: selected[0],
    initialInputs: { A: 0, B: 0 }
  };
}

/**
 * Validates a structured UI component JSON block against the trusted Component Registry.
 * Returns `{ valid: true, componentType, normalizedPayload }` or `{ valid: false, reason }`.
 * Guarantees that malformed JSON or untrusted HTML/JS never reaches the UI.
 */
function validateStructuredComponent(kind, rawPayload) {
  const normKind = String(kind || '').trim().toLowerCase();
  if (!STRUCTURED_FENCE_KINDS.has(normKind)) {
    return { valid: false, reason: 'not_structured_component' };
  }

  let data = rawPayload;
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed || trimmed.length > 65536) {
      return { valid: false, reason: 'empty_or_oversized_payload' };
    }
    if (trimmed.startsWith('{')) {
      try {
        data = JSON.parse(trimmed);
      } catch (_) {
        return { valid: false, reason: 'malformed_json' };
      }
    } else if (normKind === 'diagram' || normKind === 'flowchart' || normKind === 'trace' || normKind === 'roadmap' || normKind === 'timeline') {
      const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^graph\s+(?:TD|LR|TB|BT)/i.test(l));
      if (lines.length === 0) return { valid: false, reason: 'empty_diagram' };
      const nodes = [];
      for (const line of lines.slice(0, 12)) {
        const arrowParts = line.split(/\s*-->\s*|\s*->\s*/);
        if (arrowParts.length >= 2) {
          for (const part of arrowParts) {
            const label = sanitizePlainString(part.replace(/^[A-Za-z0-9_]+\[([^\]]+)\]$/, '$1'), 140);
            if (label && (!nodes.length || nodes[nodes.length - 1].label !== label)) {
              nodes.push({ label, detail: '' });
            }
          }
        } else {
          nodes.push({
            label: sanitizePlainString(line.replace(/^[-*•\d.]+\s*/, ''), 140),
            detail: ''
          });
        }
      }
      if (nodes.length === 0) return { valid: false, reason: 'no_valid_nodes' };
      return {
        valid: true,
        componentType: COMPONENT_TYPES.DIAGRAM,
        kind: normKind,
        normalizedPayload: {
          componentType: COMPONENT_TYPES.DIAGRAM,
          title: normKind === 'flowchart' ? 'Process Flowchart' : 'Concept Diagram',
          nodes
        }
      };
    } else {
      return { valid: false, reason: 'expected_json_object' };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, reason: 'invalid_object' };
  }

  // 1. LearningSession (`study_session` / `learning_session`)
  if (normKind === 'study_session' || normKind === 'learning_session') {
    const checklist = Array.isArray(data.checklist) ? data.checklist : (Array.isArray(data.steps) ? data.steps : []);
    if (checklist.length === 0) {
      return { valid: false, reason: 'empty_learning_session_checklist' };
    }
    return {
      valid: true,
      componentType: COMPONENT_TYPES.LEARNING_SESSION,
      kind: 'study_session',
      normalizedPayload: {
        componentType: COMPONENT_TYPES.LEARNING_SESSION,
        course: sanitizePlainString(data.course || 'Course Study Session', 120),
        unit: sanitizePlainString(data.unit || 'Chapter Roadmap', 140),
        currentStep: Math.max(1, Number(data.currentStep) || 1),
        totalSteps: Math.max(1, Number(data.totalSteps) || checklist.length),
        checklist: checklist.slice(0, 25).map((item, idx) => ({
          stepIndex: Number(item.stepIndex) || idx + 1,
          title: sanitizePlainString(item.title || `Topic ${idx + 1}`, 160),
          status: ['current', 'mastered', 'pending'].includes(item.status) ? item.status : (idx === 0 ? 'current' : 'pending'),
          sourceBadge: sanitizePlainString(item.sourceBadge || '', 40),
          hasPyq: Boolean(item.hasPyq)
        }))
      }
    };
  }

  // 2. InteractiveDemo (`logic_sim` / `interactive_demo` / `live_demo`)
  if (normKind === 'logic_sim' || normKind === 'interactive_demo' || normKind === 'live_demo') {
    const demoType = data.demoType || (normKind === 'logic_sim' ? 'logic_gate_simulator' : (Array.isArray(data.gates) ? 'logic_gate_simulator' : 'web_live_preview'));
    if (demoType === 'logic_gate_simulator') {
      const requestedGateNames = Array.isArray(data.gates)
        ? data.gates.map((g) => (typeof g === 'string' ? g : g?.gate)).filter(Boolean)
        : ['AND', 'OR', 'NOT'];
      const payload = buildLogicGateSimulatorPayload(requestedGateNames);
      if (data.title) payload.title = sanitizePlainString(data.title, 120);
      if (data.subtitle) payload.subtitle = sanitizePlainString(data.subtitle, 200);
      return {
        valid: true,
        componentType: COMPONENT_TYPES.INTERACTIVE_DEMO,
        kind: 'logic_sim',
        normalizedPayload: payload
      };
    }

    const variants = Array.isArray(data.variants) ? data.variants : [];
    if (variants.length === 0) {
      return { valid: false, reason: 'missing_live_demo_variants' };
    }
    return {
      valid: true,
      componentType: COMPONENT_TYPES.INTERACTIVE_DEMO,
      kind: 'live_demo',
      normalizedPayload: {
        componentType: COMPONENT_TYPES.INTERACTIVE_DEMO,
        demoType: 'web_live_preview',
        title: sanitizePlainString(data.title || 'Interactive Concept Preview', 120),
        subtitle: sanitizePlainString(data.subtitle || '', 180),
        caption: sanitizePlainString(data.caption || '', 180),
        html: sanitizePlainString(data.html || '<p>Sample preview</p>', 2000),
        variants: variants.slice(0, 5).map((v, idx) => ({
          label: sanitizePlainString(v.label || `Option ${idx + 1}`, 40),
          css: sanitizePlainString(v.css || '', 2000)
        }))
      }
    };
  }

  // 3. Diagram / Flowchart / Trace / Roadmap / Timeline
  if (['diagram', 'flowchart', 'trace', 'roadmap', 'timeline'].includes(normKind)) {
    const rawItems = Array.isArray(data.nodes)
      ? data.nodes
      : Array.isArray(data.steps)
        ? data.steps
        : Array.isArray(data.items)
          ? data.items
          : [];
    const validItems = rawItems
      .filter((it) => it && typeof it === 'object' && !Array.isArray(it) && (it.label || it.title))
      .slice(0, 14)
      .map((it, idx) => ({
        label: sanitizePlainString(it.label || it.title || `Step ${idx + 1}`, 140),
        detail: sanitizePlainString(it.detail || it.content || it.description || '', 300),
        tag: sanitizePlainString(it.tag || it.phase || '', 50),
        done: Boolean(it.done)
      }));
    if (validItems.length === 0) {
      return { valid: false, reason: 'empty_diagram_nodes' };
    }
    return {
      valid: true,
      componentType: COMPONENT_TYPES.DIAGRAM,
      kind: normKind,
      normalizedPayload: {
        componentType: COMPONENT_TYPES.DIAGRAM,
        title: sanitizePlainString(data.title || (normKind === 'flowchart' ? 'Process Flowchart' : 'Concept Diagram'), 140),
        nodes: validItems,
        steps: validItems
      }
    };
  }

  // 4. PYQ Card / CheckpointQuestion / ChapterSummary / SourceReference
  if (normKind === 'pyq_card') {
    if (!data.questionText && !data.cleanText) {
      return { valid: false, reason: 'missing_pyq_question_text' };
    }
    return {
      valid: true,
      componentType: COMPONENT_TYPES.CHECKPOINT_QUESTION,
      kind: 'pyq_card',
      normalizedPayload: {
        componentType: COMPONENT_TYPES.CHECKPOINT_QUESTION,
        examTitle: sanitizePlainString(data.examTitle || 'PAST UNIVERSITY EXAM QUESTION', 120),
        questionNumber: sanitizePlainString(data.questionNumber || 'Q', 20),
        marks: sanitizePlainString(data.marks || '5 MARKS', 30),
        questionText: sanitizePlainString(data.questionText || data.cleanText, 600),
        teacherNoteReference: sanitizePlainString(data.teacherNoteReference || '', 160)
      }
    };
  }

  return { valid: false, reason: 'unsupported_component_schema' };
}

/**
 * Sanitizes a completed AI response:
 * - Strips or repairs any malformed structured JSON blocks (`study_session`, `logic_sim`, `live_demo`, `diagram`, etc.)
 *   so raw JSON or broken component schemas are NEVER shown to the student.
 * - Strips internal tags (`<kyana_actions>`, `<referenced_records>`) if any remain.
 */
function sanitizeAdaptiveResponse(rawMarkdown = '') {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return '';

  let cleaned = rawMarkdown
    .replace(/<kyana_actions>[\s\S]*?<\/kyana_actions>/gi, '')
    .replace(/<referenced_records>[\s\S]*?<\/referenced_records>/gi, '')
    .replace(/<kyana_actions>[\s\S]*$/gi, '')
    .replace(/<referenced_records>[\s\S]*$/gi, '');

  // Validate all structured fenced blocks; remove or convert malformed ones
  cleaned = cleaned.replace(
    /```([a-zA-Z0-9_#-]+)[ \t]*\r?\n([\s\S]*?)```/g,
    (fullMatch, lang, body) => {
      const kind = String(lang || '').trim().toLowerCase();
      if (!STRUCTURED_FENCE_KINDS.has(kind)) {
        return fullMatch;
      }
      const check = validateStructuredComponent(kind, body);
      if (!check.valid) {
        return '';
      }
      return '```' + check.kind + '\n' + JSON.stringify(check.normalizedPayload) + '\n```';
    }
  );

  // Also strip any trailing unclosed structured fence that failed to close
  cleaned = cleaned.replace(
    /```(?:study_session|learning_session|interactive_demo|logic_sim|live_demo|pyq_card|checkpoint_question|chapter_summary|source_reference)\b[\s\S]*$/i,
    ''
  );

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Builds the LLM prompt instructions for the selected presentation profile.
 */
function buildAdaptivePresentationPrompt(plan) {
  if (!plan || !plan.profile) return '';

  const baseRules = [
    `ADAPTIVE PRESENTATION ENGINE (CRITICAL — CONTENT DETERMINES PRESENTATION):`,
    `- Active Presentation Profile: ${plan.profile.toUpperCase()} (${plan.rationale})`,
    `- Default to clean, natural conversational explanations like ChatGPT.`,
    `- Never expose internal component identifiers, JSON schemas, or raw metadata to the student.`
  ];

  switch (plan.profile) {
    case PRESENTATION_PROFILES.SIMPLE_CONVERSATIONAL:
      baseRules.push(
        `- Format: Write 1–2 natural conversational sentences. Do NOT use Markdown headings (###), tables, code blocks, bullet lists, definition cards, summary boxes, or quizzes.`
      );
      break;

    case PRESENTATION_PROFILES.SIMPLE_DEFINITION:
      baseRules.push(
        `- Format: Explain in 1–2 crisp, natural paragraphs using **bold emphasis** for the core term and 1–2 clear inline examples.`,
        `- DO NOT add unnecessary Markdown headings, tables, interactive simulators, roadmaps, summary boxes, or checkpoint quizzes.`
      );
      break;

    case PRESENTATION_PROFILES.MATHEMATICAL_DERIVATION:
      baseRules.push(
        `- Format: Use proper LaTeX rendering for all mathematics: inline equations with \`$...$\` and display equations/derivations with \`$$...$$\` (including \`\\begin{aligned} ... \\end{aligned}\`, \`\\frac{a}{b}\`, \`\\sum\`, \`\\int\`, matrices, and subscripts/superscripts).`,
        `- Walk through each step of the derivation clearly in prose between equation blocks. Do NOT add unrelated widgets or quizzes.`
      );
      break;

    case PRESENTATION_PROFILES.TRUTH_TABLE:
      baseRules.push(
        `- Format: Use proper LaTeX logical notation (\`$P \\land Q$\`, \`$P \\lor Q$\`, \`$\\lnot P$\`, \`$P \\rightarrow Q$\`) and a well-aligned Markdown Truth Table (\`| P | Q | ... |\`), then explain how to read the rows.`,
        `- Do NOT force an interactive hardware simulator unless the student asks about logic gates.`
      );
      break;

    case PRESENTATION_PROFILES.INTERACTIVE_SIMULATION:
      baseRules.push(
        `- Format: Explain each logic gate with its Boolean algebraic expression (\`$Y = A \\cdot B$\`, \`$Y = A + B$\`, \`$Y = \\overline{A}$\`), include a clean Markdown Truth Table, and embed ONE validated \`\`\`logic_sim JSON block so the student can interactively toggle inputs A and B between 0 and 1:`
      );
      baseRules.push(
        '```logic_sim\n' + JSON.stringify(buildLogicGateSimulatorPayload(plan.gates || ['AND', 'OR', 'NOT'])) + '\n```'
      );
      break;

    case PRESENTATION_PROFILES.COMPARISON_TABLE:
      baseRules.push(
        `- Format: Briefly introduce both concepts in 1–2 sentences, then present a clean, well-aligned Markdown Comparison Table comparing them across key criteria, followed by a short takeaway on when to use each.`
      );
      break;

    case PRESENTATION_PROFILES.PROGRAMMING_CODE:
      baseRules.push(
        `- Format: Explain the concept clearly and provide a clean, well-indented fenced code block with an explicit language tag (\`\`\`c, \`\`\`cpp, \`\`\`java, \`\`\`python, \`\`\`javascript, \`\`\`html, \`\`\`css, \`\`\`sql, \`\`\`php) and concise comments.`
      );
      break;

    case PRESENTATION_PROFILES.ALGORITHM_WALKTHROUGH:
      baseRules.push(
        `- Format: Structure with clear headings: Intuition, Step-by-Step Algorithm Walkthrough, Dry-Run Example, Clean Code Implementation, and Time/Space Complexity in LaTeX (\`$O(n \\log n)$\`).`
      );
      break;

    case PRESENTATION_PROFILES.VISUAL_DIAGRAM:
      baseRules.push(
        `- Format: Explain the process or architecture clearly and include ONE structured \`\`\`diagram JSON block with \`{"title":"...","nodes":[{"label":"Stage 1","detail":"..."},{"label":"Stage 2","detail":"..."}]}\` to visualize the flow.`
      );
      break;

    case PRESENTATION_PROFILES.CHAPTER_TEACHING:
      baseRules.push(
        `- Format: Use a structured chapter learning roadmap, teach the active concept step-by-step with examples grounded in the chapter notes and syllabus, and end with a contextual learning checkpoint.`
      );
      break;

    default:
      baseRules.push(
        `- Format: Use clear heading hierarchy, natural paragraphs, bold key terms, and concrete examples. Only include a table, LaTeX formula, or code block if the concept genuinely requires it.`
      );
      break;
  }

  return baseRules.join('\n');
}

/**
 * Generates an adaptive, content-driven educational response when running deterministically
 * (or enriches/cleans an LLM response) so every profile—from a simple definition to a truth table,
 * mathematical derivation, logic gate simulator, comparison table, code explanation, or PDF-grounded
 * explanation—renders with ChatGPT-level clarity and zero forced clutter.
 */
function buildAdaptiveEducationalFallback(message = '', options = {}) {
  const clean = String(message || '').trim();
  const plan = options.plan || planAdaptivePresentation(clean, options);
  const bundle = options.bundle || null;
  const evidence = options.evidence || null;
  const reasoning = options.reasoning || null;

  const topChunk = evidence?.topChunks?.[0] || null;
  const topDef = evidence?.topItems?.find((it) => it.itemType === 'definition') || null;
  const topCode = evidence?.topItems?.find((it) => it.itemType === 'code_example' || it.itemType === 'worked_example') || null;
  const citationTag = topChunk
    ? ` *(${topChunk.fileTitle}, Page ${topChunk.pageStart})*`
    : (topDef ? ` *(${topDef.fileTitle}, Page ${topDef.pageStart})*` : '');

  // 1. Simple Conversational Question
  if (plan.profile === PRESENTATION_PROFILES.SIMPLE_CONVERSATIONAL) {
    return `I'm ready to help! Ask me any concept, math derivation, code problem, or chapter topic from your course materials.`;
  }

  // 2. Simple Definition (Natural paragraphs with bold emphasis + inline examples — NO cards, NO simulators, NO headings)
  if (plan.profile === PRESENTATION_PROFILES.SIMPLE_DEFINITION) {
    if (/proposition/i.test(clean)) {
      return [
        `A **proposition** (or statement) in discrete mathematics and logic is a declarative sentence that is either **true ($T$)** or **false ($F$)**, but never both at the same time.${citationTag}`,
        `For example, *"Kathmandu is the capital of Nepal"* (True) and *"$2 + 2 = 5$"* (False) are valid propositions. By contrast, questions like *"What time is it?"*, commands like *"Close the door"*, or open sentences like *"$x + 3 = 7$"* (where $x$ is unspecified) are **not** propositions because they do not have a fixed truth value.`
      ].join('\n\n');
    }

    if (topDef || topChunk) {
      const defBody = topDef ? topDef.contentText : topChunk.content;
      const targetTerm = reasoning?.matchedSyllabusTopic || reasoning?.resolvedTopicQuery || clean.replace(/^(?:what\s+is\s+(?:a|an|the)?|define)\s+/i, '').replace(/[?.!]+$/, '').trim();
      return [
        `**${targetTerm}:** ${defBody}${citationTag}`,
        topCode
          ? `For example, in practice: \`${String(topCode.contentText || '').replace(/\s+/g, ' ').slice(0, 160)}\` *(${topCode.fileTitle}, Page ${topCode.pageStart})*.`
          : `In practice, understanding **${targetTerm}** helps you identify how this concept operates within **${bundle?.subject || 'your course'}** without memorizing isolated rules.`
      ].join('\n\n');
    }

    const cleanTerm = clean
      .replace(/^(?:what\s+(?:is|are)\s+(?:a|an|the)?|define|definition\s+of)\s+/i, '')
      .replace(/[?.!]+$/, '')
      .trim() || 'this concept';

    return [
      `**${cleanTerm.charAt(0).toUpperCase() + cleanTerm.slice(1)}** is a foundational concept that defines a specific property, rule, or structure so operations behave predictably.`,
      `For example, when applying **${cleanTerm}** in problem-solving, you first identify the input conditions and then apply its defining rule to determine the exact outcome.`
    ].join('\n\n');
  }

  // 3. Truth Table (Logical notation + well-formatted Markdown table + row explanation — NO simulator widget)
  if (plan.profile === PRESENTATION_PROFILES.TRUTH_TABLE) {
    const truthTableBlock = [
      `| $P$ | $Q$ | $\\lnot P$ (NOT) | $P \\land Q$ (AND) | $P \\lor Q$ (OR) | $P \\rightarrow Q$ (Implies) | $P \\leftrightarrow Q$ (Biconditional) |`,
      `| :---: | :---: | :---: | :---: | :---: | :---: | :---: |`,
      `| $T$ | $T$ | $F$ | **$T$** | $T$ | $T$ | **$T$** |`,
      `| $T$ | $F$ | $F$ | $F$ | $T$ | **$F$** | $F$ |`,
      `| $F$ | $T$ | $T$ | $F$ | $T$ | $T$ | $F$ |`,
      `| $F$ | $F$ | $T$ | $F$ | **$F$** | $T$ | **$T$** |`
    ].join('\n');

    const rowBulletPoints = [
      `- **Negation ($\\lnot P$):** Flips the truth value of $P$ from $T$ to $F$ and from $F$ to $T$.`,
      `- **Conjunction ($P \\land Q$):** True **only** in Row 1 where both $P$ and $Q$ are True.`,
      `- **Disjunction ($P \\lor Q$):** True whenever at least one proposition is True; False only in Row 4 where both are False.`,
      `- **Implication ($P \\rightarrow Q$):** False **only** in Row 2 when a True hypothesis ($P = T$) leads to a False conclusion ($Q = F$).`,
      `- **Biconditional ($P \\leftrightarrow Q$):** True when both $P$ and $Q$ share the exact same truth value (Rows 1 and 4).`
    ].join('\n');

    return [
      `## Understanding Truth Tables`,
      `A **truth table** is a mathematical table used in logic to compute the truth value of a compound proposition for every possible combination of truth values of its atomic variables ($n$ variables produce $2^n$ rows).${citationTag}`,
      `### Truth Table for Core Logical Operations`,
      `For two propositions $P$ and $Q$, there are $2^2 = 4$ possible input combinations:`,
      truthTableBlock,
      `### How to Read the Rows`,
      rowBulletPoints
    ].join('\n\n');
  }

  // 4. Interactive Logic Gates (Boolean expressions + Truth Tables + Interactive Simulator)
  if (plan.profile === PRESENTATION_PROFILES.INTERACTIVE_SIMULATION) {
    const gates = plan.gates || ['AND', 'OR', 'NOT'];
    const simPayload = buildLogicGateSimulatorPayload(gates);
    const gateTruthTable = [
      `| Input $A$ | Input $B$ | AND ($A \\cdot B$) | OR ($A + B$) | NOT ($\\overline{A}$) |`,
      `| :---: | :---: | :---: | :---: | :---: |`,
      `| 0 | 0 | 0 | 0 | 1 |`,
      `| 0 | 1 | 0 | 1 | 1 |`,
      `| 1 | 0 | 0 | 1 | 0 |`,
      `| 1 | 1 | **1** | **1** | 0 |`
    ].join('\n');

    return [
      `## Logic Gates: ${gates.join(', ')}`,
      `Logic gates are the fundamental building blocks of digital circuits. They take binary inputs ($0$ = LOW, $1$ = HIGH) and produce a binary output according to Boolean algebra.${citationTag}`,
      `### 1. Boolean Expressions & Behavior`,
      [
        `- **AND Gate:** Outputs $1$ only when **both** inputs $A$ and $B$ are $1$: $$Y = A \\cdot B$$`,
        `- **OR Gate:** Outputs $1$ when **at least one** input is $1$: $$Y = A + B$$`,
        `- **NOT Gate (Inverter):** Outputs the **complement** of input $A$: $$Y = \\overline{A}$$`
      ].join('\n'),
      `### 2. Combined Truth Table`,
      gateTruthTable,
      `### 3. Interactive Logic Gate Simulator`,
      `Try toggling inputs $A$ and $B$ or switching gates below to see how the output signal updates live:`,
      '```logic_sim\n' + JSON.stringify(simPayload) + '\n```'
    ].join('\n\n');
  }

  // 5. Mathematical Derivation (Proper inline & block LaTeX equations + aligned steps)
  if (plan.profile === PRESENTATION_PROFILES.MATHEMATICAL_DERIVATION) {
    return [
      `## Step-by-Step Mathematical Derivation`,
      `Let's derive the closed-form solution step by step using algebraic manipulation.${citationTag}`,
      `### 1. Problem Setup`,
      `Consider the general second-degree polynomial equation where $a \\neq 0$:`,
      `$$ax^2 + bx + c = 0$$`,
      `### 2. Completing the Square`,
      `Divide both sides by $a$ and move the constant term to the right-hand side:`,
      `$$\\begin{aligned} x^2 + \\frac{b}{a}x &= -\\frac{c}{a} \\\\ x^2 + \\frac{b}{a}x + \\left(\\frac{b}{2a}\\right)^2 &= \\frac{b^2}{4a^2} - \\frac{c}{a} \\\\ \\left(x + \\frac{b}{2a}\\right)^2 &= \\frac{b^2 - 4ac}{4a^2} \\end{aligned}$$`,
      `### 3. Solving for $x$`,
      `Taking the square root on both sides yields the **Quadratic Formula**:`,
      `$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$`,
      `Here, the discriminant $\\Delta = b^2 - 4ac$ determines the nature of the roots: two distinct real roots when $\\Delta > 0$, one repeated real root when $\\Delta = 0$, and a complex conjugate pair when $\\Delta < 0$.`
    ].join('\n\n');
  }

  // 6. Comparison Table
  if (plan.profile === PRESENTATION_PROFILES.COMPARISON_TABLE) {
    const targetTitle = reasoning?.matchedSyllabusTopic || reasoning?.resolvedTopicQuery || clean;
    const notesContext = topChunk ? `\n\n**From Your Course Notes (${topChunk.fileTitle}, Page ${topChunk.pageStart}):**\n${topChunk.content}` : '';
    const compTable = [
      `| Feature / Criterion | Primary Approach | Alternative Approach |`,
      `| :--- | :--- | :--- |`,
      `| **Core Purpose** | Optimized for direct, structured access | Optimized for flexible, dynamic composition |`,
      `| **Syntax & Specificity** | Explicit target rule / identifier | Reusable across multiple elements or instances |`,
      `| **Performance / Overhead** | Minimal lookup overhead ($O(1)$) | Scales cleanly across modular components |`,
      `| **Best Use Case** | Unique, single-instance elements or fixed bounds | Shared styling or dynamically growing collections |`
    ].join('\n');

    return [
      `## ${targetTitle}`,
      `Here is a direct side-by-side comparison across the core technical criteria:${notesContext}`,
      compTable
    ].join('\n\n');
  }

  // 7. Programming / Code Explanation
  if (plan.profile === PRESENTATION_PROFILES.PROGRAMMING_CODE) {
    const codeSnippet = topCode?.contentText || `// Example implementation\n#include <stdio.h>\n\nint binarySearch(int arr[], int n, int target) {\n    int low = 0, high = n - 1;\n    while (low <= high) {\n        int mid = low + (high - low) / 2;\n        if (arr[mid] == target) return mid;\n        if (arr[mid] < target) low = mid + 1;\n        else high = mid - 1;\n    }\n    return -1;\n}`;
    const langMatch = clean.match(/\b(c\+\+|cpp|java|python|javascript|js|php|sql|html|css|c)\b/i);
    const lang = langMatch ? (langMatch[1].toLowerCase() === 'c++' ? 'cpp' : langMatch[1].toLowerCase()) : (topCode ? 'css' : 'c');

    return [
      `## Code Explanation & Implementation`,
      topChunk
        ? `${topChunk.content} *(${topChunk.fileTitle}, Page ${topChunk.pageStart})*`
        : `Here is a clean, well-structured implementation with step-by-step explanation:`,
      '```' + lang + '\n' + codeSnippet + '\n```',
      `### How the Code Works`,
      [
        `1. **Initialization:** Sets up the required variables, selectors, or bounds before processing.`,
        `2. **Core Logic:** Executes the primary condition or rule in $O(\\log n)$ or $O(1)$ steps without redundant operations.`,
        `3. **Result / Output:** Returns or applies the computed state cleanly.`
      ].join('\n')
    ].join('\n\n');
  }

  // 8. Visual Diagram / Process
  if (plan.profile === PRESENTATION_PROFILES.VISUAL_DIAGRAM) {
    const diagPayload = {
      componentType: COMPONENT_TYPES.DIAGRAM,
      title: 'Step-by-Step Process Flow',
      nodes: [
        { label: '1. Input / Request Stage', detail: 'Receives raw source data or instruction parameters.' },
        { label: '2. Validation & Processing', detail: 'Applies syntax, semantic, or protocol rules to transform the state.' },
        { label: '3. Execution / Storage', detail: 'Commits the processed operation to memory, target layer, or output.' }
      ]
    };
    return [
      `## Architecture & Process Breakdown`,
      topChunk
        ? `${topChunk.content} *(${topChunk.fileTitle}, Page ${topChunk.pageStart})*`
        : `The system operates through a structured sequence of stages where each layer hands off validated output to the next:`,
      '```diagram\n' + JSON.stringify(diagPayload) + '\n```'
    ].join('\n\n');
  }

  return null;
}

module.exports = {
  PRESENTATION_PROFILES,
  COMPONENT_TYPES,
  STRUCTURED_FENCE_KINDS,
  LOGIC_GATES_SPEC,
  planAdaptivePresentation,
  buildLogicGateSimulatorPayload,
  validateStructuredComponent,
  sanitizeAdaptiveResponse,
  buildAdaptivePresentationPrompt,
  buildAdaptiveEducationalFallback
};
