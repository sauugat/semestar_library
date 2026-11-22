'use strict';

/**
 * Academic Teaching Engine
 * 
 * Reusable, subject-adaptive teaching architecture for Ask Kyana AI in Semester Library.
 * Works across all 57 Gandaki University BIT courses, units, and academic disciplines:
 * - Mathematics: Formulas, derivations, truth tables, numerical problems
 * - Physics: Concepts, governing equations, diagrams, numerical solutions
 * - Programming: Code examples, execution traces, memory layout, debugging
 * - Database: ER diagrams, SQL, schema design, normalization
 * - Networking: Architecture diagrams, protocols, packet flow, handshakes
 * - Automata: State diagrams, transition tables, formal language
 * - Graph Theory: Graph visualization, representations, traversal algorithms
 * - Theory Subjects: Structured conceptual hierarchies, comparative matrices
 */

const { normalizeText } = require('./academic-document-understanding');

/**
 * Supported Academic Disciplines
 */
const DISCIPLINES = {
  MATHEMATICS: 'mathematics',
  PHYSICS: 'physics',
  PROGRAMMING: 'programming',
  DATABASE: 'database',
  NETWORKING: 'networking',
  AUTOMATA: 'automata',
  GRAPH_THEORY: 'graph_theory',
  THEORY: 'theory'
};

/**
 * Question Scope Categories (Section 3 of Specification)
 */
const SCOPE_CATEGORIES = {
  ACTIVE_CHAPTER: 'ACTIVE_CHAPTER',
  PREREQUISITE_CONCEPT: 'PREREQUISITE_CONCEPT',
  OTHER_COURSE_CHAPTER: 'OTHER_COURSE_CHAPTER',
  GENERAL_ACADEMIC: 'GENERAL_ACADEMIC',
  NON_ACADEMIC: 'NON_ACADEMIC'
};

/**
 * Detects the academic discipline dynamically across courses, codes, and topic titles.
 */
function detectAcademicDiscipline(subject = '', subjectCode = '', topicTitle = '', queryText = '') {
  const combined = `${subject} ${subjectCode} ${topicTitle} ${queryText}`.toLowerCase();
  const code = String(subjectCode || '').trim().toUpperCase();

  // 1. Graph Theory specific check (in Discrete Math or DSA)
  if (
    /\b(graph\s+theory|graph|graphs|vertex|vertices|edge|edges|adjacency\s+matrix|adjacency\s+list|dijkstra(?:'s|s)?|breadth\s+first\s+search|depth\s+first\s+search|bfs|dfs|eulerian|hamiltonian|spanning\s+tree|kruskal|prim|topological\s+sort|bipartite|planar\s+graph|isomorphism|chromatic\s+number)\b/i.test(topicTitle || combined)
  ) {
    return DISCIPLINES.GRAPH_THEORY;
  }

  // 2. Automata & Computation Theory
  if (
    /\b(theory\s+of\s+computation|automata|formal\s+languages?|dfa|nfa|pda|turing\s+machine|finite\s+automata|cfg|context\s+free\s+grammar|chomsky|regular\s+expression|regular\s+grammar|pumping\s+lemma|transition\s+table|state\s+diagram)\b/i.test(combined)
  ) {
    return DISCIPLINES.AUTOMATA;
  }

  // 3. Database Systems
  if (
    code === 'CIT213' || code === 'CIT212' ||
    /\b(database|dbms|rdbms|sql|relational\s+algebra|er\s+diagram|normalization|1nf|2nf|3nf|bcnf|4nf|acid|transaction|foreign\s+key|primary\s+key|table\s+schema|schema\s+design|indexing|b\+?\s*tree|query\s+optimization)\b/i.test(combined)
  ) {
    return DISCIPLINES.DATABASE;
  }

  // 4. Computer Networks & Security
  if (
    code === 'CIT223' || code === 'CIT414' || code === 'CIT312' ||
    /\b(computer\s+networks?|networking|osi\s+model|tcp(?:\/ip)?|udp|ip\s+addressing|subnetting|subnet\s+mask|ipv4|ipv6|routing|router|switch|lan|wan|mac\s+address|dns|dhcp|http|packet\s+flow|handshake|socket|congestion\s+control|three[\s-]way\s+handshake)\b/i.test(combined)
  ) {
    return DISCIPLINES.NETWORKING;
  }

  // 5. Mathematics & Formal Logic
  if (
    code === 'CIT121' || code.startsWith('BSM') ||
    /\b(discrete\s+mathematics|mathematics|calculus|linear\s+algebra|numerical\s+methods|propositional\s+logic|predicate\s+logic|implication|conditional(?:\s+statements?)?|logic|propositions?|p\s*(?:->|→)\s*q|truth\s+table|tautology|contradiction|set\s+theory|relation|matrix|matrices|determinant|differential|derivative|integral|integration|induction|mathematical\s+induction|probability|permutation|combination|recurrence\s+relation)\b/i.test(combined)
  ) {
    return DISCIPLINES.MATHEMATICS;
  }

  // 6. Physics & Electronics
  if (
    code.startsWith('ELX') ||
    /\b(basic\s+electronics|digital\s+logic|physics|ohm'?s\s+law|kirchhoff|circuit|resistor|capacitor|inductor|voltage|current|diode|transistor|bjt|op[\s-]amp|logic\s+gate|flip[\s-]flop|k[\s-]map|multiplexer|electromagnetic|kinematics|thermodynamics)\b/i.test(combined)
  ) {
    return DISCIPLINES.PHYSICS;
  }

  // 7. Programming & Algorithms
  if (
    code === 'CIT111' || code === 'CIT122' || code === 'CIT214' || code === 'CIT223' || code === 'CIT311' ||
    /\b(programming|java|python|c\+\+|algorithms?|data\s+structures?|stacks?|queues?|linked\s+lists?|binary\s+trees?|heaps?|sorting|searching|recursion|pointers?|dynamic\s+memory|malloc|free|object[\s-]oriented|oop|inheritance|polymorphism|interfaces?|class(?:es)?|functions?|syntax|debugging|bytecode|jvm|adt|abstract\s+data\s+types?)\b/i.test(combined)
  ) {
    return DISCIPLINES.PROGRAMMING;
  }

  // 8. General Theory & Management / IT Basics
  return DISCIPLINES.THEORY;
}

/**
 * Resolves the specialized teaching strategy, section structure, and depth rules for a discipline.
 */
function resolveTeachingStrategy(subject = '', subjectCode = '', topicTitle = '', queryText = '') {
  const discipline = detectAcademicDiscipline(subject, subjectCode, topicTitle, queryText);

  switch (discipline) {
    case DISCIPLINES.MATHEMATICS:
      return {
        discipline,
        disciplineLabel: 'Mathematics & Formal Logic Methodology',
        sectionTitles: [
          '1. 💡 **Intuitive Conceptual Model & Everyday Analogy**',
          '2. 📐 **Formal Mathematical Definitions, Notation & Theorems**',
          '3. ✍️ **Step-by-Step Derivation, Truth Table or Worked Problem**',
          '4. ⚖️ **Logical Fallacies, Edge Cases & Common Exam Pitfalls**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: MATHEMATICS & LOGIC
1. 💡 Intuitive Conceptual Model: Start with a relatable real-world intuition or everyday analogy to ground the abstract concept before introducing formal symbols.
2. 📐 Formal Definitions & Notation: State precise mathematical definitions using standard symbols (e.g. ∧, ∨, ¬, →, ↔, ∀, ∃, ∈, ⊆, matrices, derivatives). Define every symbol and variable clearly.
3. ✍️ Step-by-Step Derivation, Truth Table or Worked Problem:
   - For logic: Provide a complete row-by-row truth table or formal proof showing intermediate columns and final truth values.
   - For calculus/algebra/numerical: Provide a fully worked numerical or algebraic problem, demonstrating step-by-step transformation without skipping steps.
4. ⚖️ Logical Fallacies, Edge Cases & Exam Pitfalls: Highlight common student mistakes (e.g. confusing conditional P → Q with converse Q → P, division by zero, false equivalences, domain violations).
5. 🎯 Diagnostic Checkpoint Question: End with exactly ONE short mathematical or logical question testing conceptual or symbolic comprehension.`,
        checkpointType: 'symbolic_or_step_check'
      };

    case DISCIPLINES.PHYSICS:
      return {
        discipline,
        disciplineLabel: 'Physics & Applied Electronics Methodology',
        sectionTitles: [
          '1. 💡 **Physical Intuition & Observable Phenomenon**',
          '2. ⚡ **Governing Laws, Equations & SI Units**',
          '3. 🔬 **Worked Numerical Problem or Circuit/Wave Analysis**',
          '4. ⚖️ **Physical Constraints, Real vs Ideal Assumptions & Traps**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: PHYSICS & ELECTRONICS
1. 💡 Physical Intuition: Describe the real-world physical behavior, observable phenomenon, or practical device function in intuitive terms.
2. ⚡ Governing Laws & Equations: Present the governing physical equation(s) cleanly in LaTeX/Markdown. State every variable, constant, and the exact SI units (e.g., Volts, Amperes, Ohms, Joules, Watts).
3. 🔬 Worked Problem or Circuit/Wave Analysis: Provide a complete worked numerical problem or step-by-step circuit analysis. Trace given parameters, formula substitution, unit cancellations, and final answer.
4. ⚖️ Physical Constraints & Real-World Limits: Detail real-world device limitations (e.g. component power ratings, internal resistance, saturation, thermal breakdown, ideal vs non-ideal behavior).
5. 🎯 Diagnostic Checkpoint Question: End with exactly ONE focused question on variable relationships or circuit/law behavior.`,
        checkpointType: 'physical_relationship_check'
      };

    case DISCIPLINES.PROGRAMMING:
      return {
        discipline,
        disciplineLabel: 'Programming & Systems Architecture Methodology',
        sectionTitles: [
          '1. 💡 **Intuitive Beginner Analogy**',
          '2. ⚙️ **Language Mechanics & Runtime/Memory Architecture**',
          '3. 💻 **Complete Commented Code Example & Line-by-Line Execution Trace**',
          '4. ⚖️ **Complexity, Edge Cases & Debugging Pitfalls**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: PROGRAMMING & ALGORITHMS
1. 💡 Intuitive Beginner Analogy: Open with a vivid everyday analogy mapping directly to runtime behavior, memory, or control flow.
2. ⚙️ Language Mechanics & Memory Architecture: Explain how the concept executes at the runtime/memory level (stack vs heap, pointer addresses, references, JVM/CPU lifecycle).
3. 💻 Complete Commented Code Example & Execution Trace: Provide a clean, robust, fully commented code block in the course language (C/Java/Python). Follow it with a line-by-line execution trace detailing variable states and output.
4. ⚖️ Complexity, Edge Cases & Debugging Traps: Detail off-by-one errors, null pointers, memory leaks, uninitialized variables, and Big-O time and space complexity tradeoffs.
5. 🎯 Diagnostic Checkpoint Question: End with ONE focused syntax, output prediction, or tracing question.`,
        checkpointType: 'code_trace_check'
      };

    case DISCIPLINES.DATABASE:
      return {
        discipline,
        disciplineLabel: 'Database & Relational Systems Methodology',
        sectionTitles: [
          '1. 💡 **Data Organization Intuition**',
          '2. 🗄️ **Relational Model, Schema Architecture & Formal Concepts**',
          '3. 📊 **Concrete SQL Query or Schema Normalization Breakdown**',
          '4. ⚖️ **Anomalies, Indexing Tradeoffs & Design Pitfalls**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: DATABASE MANAGEMENT SYSTEMS
1. 💡 Data Organization Intuition: Ground the concept with a relatable real-world filing, inventory, or transactional scenario.
2. 🗄️ Relational Model & Schema Architecture: Define formal concepts (entities, attributes, primary/foreign keys, integrity constraints, functional dependencies, ACID properties, normal forms).
3. 📊 Concrete SQL or Normalization Breakdown:
   - Provide complete SQL DDL/DML statements or table representation illustrating the schema before and after normalization/transformation.
   - Trace join conditions, filtering, or dependency elimination step-by-step.
4. ⚖️ Anomalies, Tradeoffs & Design Traps: Explain insertion/update/deletion anomalies, table scan vs B-tree index tradeoffs, denormalization considerations, and common schema design errors.
5. 🎯 Diagnostic Checkpoint Question: End with ONE question testing query syntax, key constraints, or normalization determination.`,
        checkpointType: 'schema_sql_check'
      };

    case DISCIPLINES.NETWORKING:
      return {
        discipline,
        disciplineLabel: 'Computer Networks & Protocols Methodology',
        sectionTitles: [
          '1. 💡 **Courier / Postal Network Analogy**',
          '2. 🌐 **Protocol Architecture & Layer Responsibilities**',
          '3. 📦 **Step-by-Step Packet Flow & Handshake Message Trace**',
          '4. ⚖️ **Transmission Errors, Bottlenecks & Security Vulnerabilities**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: COMPUTER NETWORKING
1. 💡 Network Analogy: Start with an intuitive physical postal, dispatch, or phone network analogy illustrating sender, receiver, and intermediate routers.
2. 🌐 Protocol Architecture & Layers: Map the protocol to its OSI / TCP-IP layer. Break down essential header fields, addresses (MAC vs IP vs Port), and encapsulation.
3. 📦 Packet Flow & Handshake Trace: Detail the step-by-step sequence of packet exchanges (e.g. SYN, SYN-ACK, ACK, flags, sequence numbers) with data movement between client, switch, router, and server.
4. ⚖️ Bottlenecks, Errors & Security Traps: Discuss packet loss, retransmission, sliding window limits, timeout calculations, IP spoofing, or eavesdropping risks.
5. 🎯 Diagnostic Checkpoint Question: End with ONE focused question checking layer responsibility, packet flow, or header function.`,
        checkpointType: 'protocol_flow_check'
      };

    case DISCIPLINES.AUTOMATA:
      return {
        discipline,
        disciplineLabel: 'Automata & Computation Theory Methodology',
        sectionTitles: [
          '1. 💡 **State Machine Real-World Intuition**',
          '2. 🔄 **Formal Definition (Tuples) & State Architecture**',
          '3. 📋 **Transition Table & String Acceptance/Rejection Trace**',
          '4. ⚖️ **Non-determinism, Ambiguity & Common Reductions**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: AUTOMATA & COMPUTATION THEORY
1. 💡 State Machine Intuition: Ground the machine in a tangible physical mechanism (turnstile, vending machine, elevator).
2. 🔄 Formal Definition: Define the formal mathematical tuple (e.g. Q, Σ, δ, q0, F for DFA). Clearly specify states, alphabet, transition function, and accepting states.
3. 📋 Transition Table & String Trace: Present a structured Markdown transition table. Walk through a specific string trace character-by-character, showing the exact state progression for an accepted vs rejected string.
4. ⚖️ Non-determinism & Traps: Detail DFA vs NFA differences, handling dead/trap states, empty string (ε) transitions, and minimal state minimization pitfalls.
5. 🎯 Diagnostic Checkpoint Question: End with ONE question testing a state transition or string language membership.`,
        checkpointType: 'automata_transition_check'
      };

    case DISCIPLINES.GRAPH_THEORY:
      return {
        discipline,
        disciplineLabel: 'Graph Theory & Algorithmic Traversal Methodology',
        sectionTitles: [
          '1. 💡 **Network / Road Map Intuition**',
          '2. 🕸️ **Formal Graph Topology & Mathematical Properties**',
          '3. 🚶 **Algorithm or Traversal Step-by-Step Trace**',
          '4. ⚖️ **Complexity, Edge Cases & Structural Pitfalls**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: GRAPH THEORY
1. 💡 Network Intuition: Describe vertices and edges as cities, highways, or social connections.
2. 🕸️ Formal Graph Topology: Formalize G = (V, E). Define directed vs undirected, weights, vertex degrees (in-degree/out-degree), paths, cycles, and representation (adjacency matrix vs list).
3. 🚶 Algorithm or Traversal Trace: Walk through traversal (BFS/DFS) or algorithm (Dijkstra/Prim/Kruskal) step-by-step with state tables showing visited sets, priority queues, and distance arrays.
4. ⚖️ Complexity & Graph Pitfalls: Analyze Big-O time and space complexity, negative cycles, disconnected components, and sparse vs dense graph tradeoffs.
5. 🎯 Diagnostic Checkpoint Question: End with ONE question on vertex degrees, path existence, or algorithm step outcome.`,
        checkpointType: 'graph_property_check'
      };

    case DISCIPLINES.THEORY:
    default:
      return {
        discipline: DISCIPLINES.THEORY,
        disciplineLabel: 'Conceptual Systems & Academic Theory Methodology',
        sectionTitles: [
          '1. 💡 **Intuitive Systemic Analogy**',
          '2. 🏛️ **Conceptual Architecture & University Frameworks**',
          '3. 📊 **Structured Comparative Breakdown or Lifecycle Walkthrough**',
          '4. ⚖️ **Strategic Tradeoffs, Industry Standards & Misconceptions**',
          '5. 🎯 **Diagnostic Checkpoint Question**'
        ],
        depthRulesText: `DISCIPLINE-ADAPTIVE TEACHING MANDATE: CONCEPTUAL & THEORY SUBJECTS
1. 💡 Intuitive Systemic Analogy: Open with a vivid macro-level organizational, physical, or systemic analogy.
2. 🏛️ Conceptual Architecture: Define terminology, formal classification, structural role in the university syllabus, and standard principles.
3. 📊 Structured Comparison or Lifecycle: Provide a structured Markdown comparison table (contrasting 2-3 approaches) or sequential lifecycle walkthrough illustrating the mechanics in action.
4. ⚖️ Strategic Tradeoffs & Misconceptions: Detail pros vs cons, common student misunderstandings, when to apply vs when to avoid, and exam traps.
5. 🎯 Diagnostic Checkpoint Question: End with ONE conceptual comparison or scenario analysis question.`,
        checkpointType: 'conceptual_comparison_check'
      };
  }
}

/**
 * Classifies an incoming question into one of the 5 Academic Scope Categories (Section 3 of Specification).
 */
function classifyAcademicQuestionScope(queryText = '', context = {}) {
  const {
    activeSubject = '',
    activeSubjectCode = '',
    activeUnitNumber = 1,
    activeChapterTitle = '',
    syllabusTopics = [],
    courseUnits = []
  } = context;

  const cleanQuery = String(queryText || '').trim();
  const lowerQuery = cleanQuery.toLowerCase();
  const normQuery = normalizeText(cleanQuery);

  if (!cleanQuery) {
    return {
      scopeType: SCOPE_CATEGORIES.ACTIVE_CHAPTER,
      reason: 'Empty query defaults to active chapter'
    };
  }

  // 1. Check for off-topic non-academic queries (gossip, gambling, sports betting, crypto trading, matches)
  const isStrictNonAcademic =
    /\b(crypto|bitcoin|ethereum|forex|betting|ipl(?:\s+score)?|football|cricket|fifa|world\s+cup|celebrity\s+gossip|movie\s+leak|premier\s+league|horoscope|actor|actress)\b/i.test(lowerQuery) &&
    !/\b(cryptography|blockchain|hashing|rsa|security|algorithm)\b/i.test(lowerQuery);

  if (isStrictNonAcademic) {
    return {
      scopeType: SCOPE_CATEGORIES.NON_ACADEMIC,
      reason: 'Non-academic topic outside university curriculum'
    };
  }

  // 2. Check if query matches topics in the CURRENT active chapter
  const activeUnitNum = Number(activeUnitNumber) || 1;
  const activeSylNorms = (Array.isArray(syllabusTopics) ? syllabusTopics : []).map(normalizeText).filter(Boolean);
  const matchesActiveTopic = activeSylNorms.some(st => normQuery.includes(st) || (st.length >= 5 && st.includes(normQuery)));

  if (matchesActiveTopic) {
    return {
      scopeType: SCOPE_CATEGORIES.ACTIVE_CHAPTER,
      targetUnit: activeUnitNum,
      targetTitle: activeChapterTitle,
      reason: 'Direct match for active chapter syllabus topic'
    };
  }

  // 3. Check if query specifically targets another unit in the SAME course
  for (const unit of courseUnits || []) {
    const uNum = Number(unit.unitNumber || unit.unit_number);
    if (uNum === activeUnitNum) continue;

    const uTitle = unit.title || unit.chapterTitle || `Unit ${uNum}`;
    const normUTitle = normalizeText(uTitle);

    // Explicit unit mention e.g. "Unit 3", "Chapter 4"
    const explicitUnitMention = new RegExp(`\\b(?:unit|chapter)\\s*#?\\s*${uNum}\\b`, 'i').test(lowerQuery);
    if (explicitUnitMention) {
      return {
        scopeType: uNum < activeUnitNum ? SCOPE_CATEGORIES.PREREQUISITE_CONCEPT : SCOPE_CATEGORIES.OTHER_COURSE_CHAPTER,
        targetUnit: uNum,
        targetTitle: uTitle,
        reason: `Explicitly references ${uNum < activeUnitNum ? 'earlier prerequisite' : 'different chapter'} Unit ${uNum}`
      };
    }

    if (normUTitle.length >= 4 && normQuery.includes(normUTitle)) {
      return {
        scopeType: uNum < activeUnitNum ? SCOPE_CATEGORIES.PREREQUISITE_CONCEPT : SCOPE_CATEGORIES.OTHER_COURSE_CHAPTER,
        targetUnit: uNum,
        targetTitle: uTitle,
        reason: `Matches title of Unit ${uNum} (${uTitle})`
      };
    }

    // Check unit topics
    for (const t of unit.topics || []) {
      const topicStr = typeof t === 'string' ? t : (t.title || t.topicTitle || '');
      const normT = normalizeText(topicStr);
      if (normT.length >= 4 && normQuery.includes(normT)) {
        return {
          scopeType: uNum < activeUnitNum ? SCOPE_CATEGORIES.PREREQUISITE_CONCEPT : SCOPE_CATEGORIES.OTHER_COURSE_CHAPTER,
          targetUnit: uNum,
          targetTitle: uTitle,
          matchedTopic: topicStr,
          reason: `Topic belongs to ${uNum < activeUnitNum ? 'earlier prerequisite' : 'subsequent chapter'} Unit ${uNum}`
        };
      }
    }
  }

  // 4. Prerequisite heuristics (foundational STEM / CS terms)
  const isPrerequisiteTerm =
    /\b(prerequisite|what\s+is\s+a\s+set|definition\s+of\s+set|what\s+is\s+an?\s+integer|binary\s+number\s+system|basic\s+logic|primitive\s+data\s+type|memory\s+address|truth\s+table\s+basics)\b/i.test(lowerQuery);
  if (isPrerequisiteTerm) {
    return {
      scopeType: SCOPE_CATEGORIES.PREREQUISITE_CONCEPT,
      reason: 'General foundational prerequisite concept'
    };
  }

  // 5. General academic / university topics (valid CS, Math, Engineering)
  const isAcademicComputingQuery =
    /\b(algorithm|complexity|memory|compiler|operating\s+system|database|protocol|network|security|data\s+structure|programming|math|calculus|physics)\b/i.test(lowerQuery);

  if (isAcademicComputingQuery) {
    return {
      scopeType: SCOPE_CATEGORIES.GENERAL_ACADEMIC,
      reason: 'General academic computing / STEM concept'
    };
  }

  // Default: treat as active chapter question/follow-up
  return {
    scopeType: SCOPE_CATEGORIES.ACTIVE_CHAPTER,
    targetUnit: activeUnitNum,
    targetTitle: activeChapterTitle,
    reason: 'Contextual chapter question'
  };
}

/**
 * Initializes a new Structured Teaching State object for a study session.
 */
function createTeachingState(session = {}, reconciledPlan = []) {
  const steps = Array.isArray(reconciledPlan) ? reconciledPlan : [];
  const firstStep = steps[0] || {};
  const strategy = resolveTeachingStrategy(session.subject, session.subject_code, firstStep.topicTitle || '');

  return {
    version: 2,
    subject: session.subject || '',
    subjectCode: session.subject_code || '',
    unitNumber: session.unit_number || 1,
    chapterTitle: session.chapter_title || '',
    discipline: strategy.discipline,
    disciplineLabel: strategy.disciplineLabel,
    activeStepIndex: session.current_step_index || 1,
    totalSteps: session.total_steps || steps.length || 1,
    activeConcept: firstStep.topicTitle || firstStep.topic_title || '',
    flowState: 'EXPLAIN', // EXPLAIN -> DEMONSTRATE -> ASK -> EVALUATE -> ADAPT -> PRACTICE -> PROGRESS
    explainedConcepts: [],
    completedConcepts: [],
    solvedExamples: [],
    askedQuestions: [],
    activeQuestion: null,
    lastStudentResponse: null,
    lastEvaluationResult: null,
    progressPercentage: 0,
    studentAnswers: [],
    understoodConcepts: [],
    strugglingConcepts: [],
    misconceptions: [],
    clarifyingTurnsCount: 0,
    lastInteractionAt: new Date().toISOString()
  };
}

/**
 * Records concept progress and updates the structured teaching state.
 */
function updateTeachingStateOnTurn(currentState = {}, updates = {}) {
  const state = {
    explainedConcepts: [],
    completedConcepts: [],
    solvedExamples: [],
    askedQuestions: [],
    studentAnswers: [],
    understoodConcepts: [],
    strugglingConcepts: [],
    misconceptions: [],
    ...currentState,
    ...updates,
    lastInteractionAt: new Date().toISOString()
  };

  if (updates.conceptExplained && !state.explainedConcepts.includes(updates.conceptExplained)) {
    state.explainedConcepts.push(updates.conceptExplained);
  }

  if (updates.conceptCompleted && !state.completedConcepts.includes(updates.conceptCompleted)) {
    state.completedConcepts.push(updates.conceptCompleted);
  }

  if (updates.exampleSolved && !state.solvedExamples.includes(updates.exampleSolved)) {
    state.solvedExamples.push(updates.exampleSolved);
  }

  if (updates.questionAsked && !state.askedQuestions.includes(updates.questionAsked)) {
    state.askedQuestions.push(updates.questionAsked);
  }

  if (updates.activeQuestion !== undefined) {
    state.activeQuestion = updates.activeQuestion;
  }

  if (updates.lastStudentResponse !== undefined) {
    state.lastStudentResponse = updates.lastStudentResponse;
  }

  if (updates.lastEvaluationResult !== undefined) {
    state.lastEvaluationResult = updates.lastEvaluationResult;
  }

  if (updates.studentAnswer) {
    const targetConcept = updates.studentAnswer.concept || updates.conceptExplained || state.activeConcept;
    state.lastStudentResponse = updates.studentAnswer.text;
    state.studentAnswers.push({
      stepIndex: state.activeStepIndex,
      concept: targetConcept,
      answer: updates.studentAnswer.text,
      passed: Boolean(updates.studentAnswer.passed),
      timestamp: new Date().toISOString()
    });

    if (updates.studentAnswer.passed) {
      if (targetConcept && !state.understoodConcepts.includes(targetConcept)) {
        state.understoodConcepts.push(targetConcept);
      }
      state.strugglingConcepts = state.strugglingConcepts.filter(c => c !== targetConcept);
    } else {
      if (targetConcept && !state.strugglingConcepts.includes(targetConcept)) {
        state.strugglingConcepts.push(targetConcept);
      }
    }
  }

  if (updates.misconception) {
    state.misconceptions.push({
      concept: state.activeConcept,
      description: updates.misconception,
      remediated: false,
      timestamp: new Date().toISOString()
    });
  }

  const total = Math.max(1, Number(state.totalSteps) || 1);
  const doneCount = Array.isArray(state.completedConcepts) ? state.completedConcepts.length : 0;
  state.progressPercentage = Math.min(100, Math.round((doneCount / total) * 100));

  return state;
}

/**
 * Formats the structured teaching state into a prompt context block.
 */
function formatTeachingStatePromptContext(state = {}) {
  if (!state || !state.activeConcept) return '';

  const lines = [
    `STRUCTURED TEACHING STATE & PROGRESSION MEMORY:`,
    `- Current Concept Under Instruction: "${state.activeConcept}" (Step ${state.activeStepIndex || 1} of ${state.totalSteps || 1})`,
    `- Pedagogical Flow Stage: ${state.flowState || 'EXPLAIN'}`,
    `- Concepts Already Taught & Explained: ${state.explainedConcepts.length > 0 ? state.explainedConcepts.map(c => `"${c}"`).join(', ') : 'None yet (first step)'}`
  ];

  if (state.solvedExamples && state.solvedExamples.length > 0) {
    lines.push(`- Solved Examples Completed: ${state.solvedExamples.map(e => `"${e}"`).join(', ')}`);
  }

  if (state.understoodConcepts && state.understoodConcepts.length > 0) {
    lines.push(`- Concepts Student Has Demonstrated Comprehension Of: ${state.understoodConcepts.map(c => `"${c}"`).join(', ')}`);
  }

  if (state.strugglingConcepts && state.strugglingConcepts.length > 0) {
    lines.push(`- Concepts Needing Further Clarification / Remediation: ${state.strugglingConcepts.map(c => `"${c}"`).join(', ')}`);
  }

  if (state.misconceptions && state.misconceptions.length > 0) {
    const unaddressed = state.misconceptions.filter(m => !m.remediated);
    if (unaddressed.length > 0) {
      lines.push(`- Active Student Misconception to Address Gently: "${unaddressed[unaddressed.length - 1].description}"`);
    }
  }

  return lines.join('\n');
}

/**
 * Formulates a dynamic, discipline-adaptive Socratic checkpoint question.
 * Replaces hardcoded topic strings with universal subject-tailored questioning.
 */
function generateSubjectAdaptiveCheckpoint(step = {}, strategy = null, extractedItems = {}, pyqMatches = []) {
  const topicTitle = step.topicTitle || step.topic_title || 'this concept';
  const cleanTitle = topicTitle.trim();

  // 1. Check extracted inline questions from teacher notes first
  const inlineQs = step?.extractedItems?.inlineQuestions || extractedItems?.inlineQuestions || [];
  if (Array.isArray(inlineQs) && inlineQs.length > 0 && inlineQs[0].contentText) {
    return `Quick check (${inlineQs[0].fileTitle || 'Teacher Note'}, p.${inlineQs[0].pageStart || 1}): ${inlineQs[0].contentText}`;
  }

  // 2. Check matched past exam questions (PYQ)
  const pyqs = step?.pyqMatches || pyqMatches || [];
  if (Array.isArray(pyqs) && pyqs.length > 0 && pyqs[0].content) {
    return `Exam checkpoint (${pyqs[0].examYear || ''} ${pyqs[0].examType || 'Exam'}): ${pyqs[0].content}`;
  }

  // 3. Formulate discipline-adaptive Socratic question
  const discipline = strategy?.discipline || detectAcademicDiscipline('', '', cleanTitle);

  switch (discipline) {
    case DISCIPLINES.MATHEMATICS:
      return `Quick check before we advance: In your own words or symbolic notation, under what specific condition is "${cleanTitle}" considered true, valid, or satisfied?`;

    case DISCIPLINES.PHYSICS:
      return `Quick check before we move forward: If we double the primary input parameter in "${cleanTitle}", how does the governing equation predict the final output will change?`;

    case DISCIPLINES.PROGRAMMING:
      return `Quick check before we proceed: If a program executes "${cleanTitle}" with invalid or empty input, what runtime condition, error, or state transition occurs?`;

    case DISCIPLINES.DATABASE:
      return `Quick check before we move forward: Why is "${cleanTitle}" critical for maintaining data integrity or preventing redundancy in a relational database?`;

    case DISCIPLINES.NETWORKING:
      return `Quick check before we proceed: Which layer of the network architecture is responsible for "${cleanTitle}", and what happens if a packet is dropped during this step?`;

    case DISCIPLINES.AUTOMATA:
      return `Quick check before we advance: For the state machine representing "${cleanTitle}", what exact input symbol or condition triggers a transition to an accepting state?`;

    case DISCIPLINES.GRAPH_THEORY:
      return `Quick check before we proceed: In a graph modeling "${cleanTitle}", how does adding a cycle or disconnected vertex affect the algorithm's traversal or correctness?`;

    case DISCIPLINES.THEORY:
    default:
      return `Quick check before we move forward: In your own words, what is the primary role of "${cleanTitle}" in this course, and how does it differ from its main alternative?`;
  }
}

// ============================================================================
// PHASE 3: INTELLIGENT MULTI-MODAL ANSWER EVALUATION ENGINE
// ============================================================================

const ACADEMIC_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'it', 'its', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'and', 'or', 'by', 'as', 'that', 'this', 'these', 'those', 'we', 'you', 'they', 'i',
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'does', 'do', 'did', 'can', 'could',
  'would', 'should', 'be', 'been', 'being', 'have', 'has', 'had', 'so', 'then', 'than', 'from',
  'about', 'into', 'over', 'after', 'before', 'between', 'out', 'up', 'down', 'only', 'just'
]);

function extractAcademicKeywords(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !ACADEMIC_STOPWORDS.has(w));
}

/**
 * Parses multiple choice question (MCQ) structure from question text.
 * Detects options like A) ..., B) ... or (A) ..., (B) ... or A. ..., B. ...
 */
function parseMcqQuestion(questionText = '') {
  if (!questionText || typeof questionText !== 'string') {
    return { isMcq: false, options: {}, textWithoutOptions: '', explicitAnswer: null };
  }

  let explicitAnswer = null;
  const ansMatch = questionText.match(/(?:\[Answer:\s*([A-Da-d])\]|\(Correct:\s*([A-Da-d])\)|\*\(?([A-Da-d])\)?\*|Correct\s+Answer:\s*\(?([A-Da-d])\)?)/i);
  if (ansMatch) {
    explicitAnswer = (ansMatch[1] || ansMatch[2] || ansMatch[3] || ansMatch[4]).toUpperCase();
  }

  const optionRegex = /(?:^|\n|\s+)(?:\(?([A-Da-d])\)|([A-Da-d])\.(?:\s+)|([A-Da-d])\)(?:\s+))([^\n]+)/g;
  const options = {};
  let match;

  while ((match = optionRegex.exec(questionText)) !== null) {
    const letter = (match[1] || match[2] || match[3]).toUpperCase();
    const content = match[4].replace(/(?:\[Answer:.*\]|\(Correct:.*\))/i, '').trim();
    if (content) {
      options[letter] = content;
    }
  }

  const optionKeys = Object.keys(options);
  const isMcq = optionKeys.length >= 2;

  return {
    isMcq,
    options,
    explicitAnswer,
    textWithoutOptions: isMcq ? questionText.replace(optionRegex, '').trim() : questionText
  };
}

/**
 * Extracts a student's chosen option letter from their answer.
 * Normalizes uppercase/lowercase letters, "Option C", "I think it's C",
 * ordinal phrases ("the third one", "3rd option"), and option text/math expressions ("2 + 2 = 5").
 */
function extractStudentMcqChoice(studentAnswer = '', parsedMcq = {}) {
  if (!parsedMcq || !parsedMcq.isMcq) return null;
  const raw = String(studentAnswer || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const optionKeys = Object.keys(parsedMcq.options || {});
  if (optionKeys.length === 0) return null;

  // Guard against genuine ambiguity mentioning multiple options (e.g. "A or C", "between B and D", "either A or B")
  if (/\b(?:between\s+[a-d]\s+and\s+[a-d]|either\s+(?:option\s+)?[a-d]\s+or\s+(?:option\s+)?[a-d]|(?:option\s+)?[a-d]\s+or\s+(?:option\s+)?[a-d]|both\s+[a-d]\s+and\s+[a-d])\b/i.test(lower)) {
    return null;
  }

  // 1. Direct & conversational letter patterns: "C", "c", "Option C", "I think it's C", "my answer is c", "(C)"
  const directMatch = raw.match(/^(?:(?:i\s+think\s+(?:it'?s|it\s+is|the\s+answer\s+is)?|i\s+believe\s+(?:it'?s|it\s+is)?|maybe|probably|my\s+answer\s+is|it'?s|it\s+is|the\s+answer\s+is|answer(?:\s*[:=]|\s+is)?|ans(?:\s*[:=]|\s+is)?|i\s+choose|i\s+pick|i'll\s+go\s+with|going\s+with|definitely|pretty\s+sure\s+(?:it'?s|it\s+is)?)\s+)?(?:(?:option|choice|letter)\s+)?[(\[]?([A-Fa-f])[)\].!]?(?:\s+(?:is\s+(?:correct|right|the\s+answer|valid)|only|please))?[.!?]*$/i);
  if (directMatch) {
    const letter = directMatch[1].toUpperCase();
    if (parsedMcq.options[letter]) return letter;
  }

  // 2. Ordinal natural-language references: "the first one", "second option", "the third one", "3rd", "last one"
  const ordinalMap = [
    { idx: 0, re: /\b(?:first|1st)\b(?:\s+(?:one|option|choice|answer|statement))?/i },
    { idx: 1, re: /\b(?:second|2nd)\b(?:\s+(?:one|option|choice|answer|statement))?/i },
    { idx: 2, re: /\b(?:third|3rd)\b(?:\s+(?:one|option|choice|answer|statement))?/i },
    { idx: 3, re: /\b(?:fourth|4th)\b(?:\s+(?:one|option|choice|answer|statement))?/i },
    { idx: optionKeys.length - 1, re: /\b(?:last)\s+(?:one|option|choice|answer|statement)\b/i }
  ];
  for (const ord of ordinalMap) {
    if (ord.re.test(lower) && optionKeys[ord.idx]) {
      return optionKeys[ord.idx];
    }
  }

  // 3. Standalone letter in a concise conversational turn (<= 6 words)
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 6) {
    for (const t of tokens) {
      const cleanToken = t.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (cleanToken.length === 1 && parsedMcq.options[cleanToken]) {
        if (cleanToken === 'A' && tokens.length > 1 && !/\b(?:option|choice|answer|letter|choose|pick)\b/i.test(raw)) {
          continue;
        }
        return cleanToken;
      }
    }
  }

  // 4. Math-preserving & text matching against option text (e.g. "2 + 2 = 5" or "2+2=5")
  const compactMath = (s) => String(s || '').toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, '');
  const studentMathCompact = compactMath(raw.replace(/^(?:i\s+think\s+(?:it'?s|it\s+is)|it'?s|it\s+is|the\s+answer\s+is|answer\s+is)\s+/i, ''));
  for (const [letter, optText] of Object.entries(parsedMcq.options)) {
    const optMathCompact = compactMath(optText);
    if (optMathCompact.length >= 3 && studentMathCompact.length >= 3) {
      if (studentMathCompact === optMathCompact || studentMathCompact.includes(optMathCompact)) {
        return letter;
      }
    }
    const cleanOpt = optText.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanStudent = lower.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanOpt.length > 3 && cleanStudent.length > 3) {
      if (cleanStudent === cleanOpt || cleanStudent.includes(cleanOpt) || cleanOpt.includes(cleanStudent)) {
        return letter;
      }
    }
  }

  return null;
}

/**
 * Deterministically classifies whether a statement is a valid atomic proposition.
 * A proposition is a declarative sentence with a definite truth value (either TRUE or FALSE).
 * False declarative statements like "2 + 2 = 5" ARE valid atomic propositions.
 * Imperatives, questions, exclamations, and open variable equations ("x + 2 = 5") are NOT propositions.
 */
function isDeclarativeAtomicProposition(statementText = '') {
  const s = String(statementText || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  if (!s) return false;
  // Questions are never propositions
  if (s.endsWith('?') || /^(?:is|are|was|were|do|does|did|can|could|will|would|what|where|when|why|who|how|which)\b/i.test(s)) {
    return false;
  }
  // Imperatives / commands / exclamations are never propositions
  if (s.endsWith('!') || /^(?:go|come|close|open|stop|sit|stand|read|write|do\s+not|don't|please|turn|pass|give|take|keep|shut)\b/i.test(s)) {
    return false;
  }
  // Open sentences with unbound mathematical variables (e.g. "x + 2 = 5", "y > 3") are predicates, not propositions
  if (/\b[a-z]\s*[+\-*/=<>]/i.test(s) && !/\b(?:for\s+all|there\s+exists|∀|∃)\b/i.test(s)) {
    return false;
  }
  // Compound propositions joined by logical connectives are not atomic
  if (/\b(?:and|or|if\s+.*\s+then|implies|if\s+and\s+only\s+if)\b|[∧∨→↔]/i.test(s)) {
    return false;
  }
  // Numeric equality/inequality without free variables (e.g. "2 + 2 = 5", "3 + 4 = 7", "5 > 10") IS a valid atomic proposition
  if (/^\s*-?\d+(?:\.\d+)?(?:\s*[+\-*/^]\s*-?\d+(?:\.\d+)?)*\s*(?:=|!=|≠|<|>|<=|>=|≤|≥)\s*-?\d+(?:\.\d+)?(?:\s*[+\-*/^]\s*-?\d+(?:\.\d+)?)*\s*$/.test(s)) {
    return true;
  }
  // Declarative sentence with subject + verb (e.g. "Kathmandu is the capital of Nepal", "The Earth is flat")
  if (/\b(?:is|are|was|were|has|have|equals?|contains?)\b/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Normalizes physical/engineering/mathematical measurement units.
 */
function normalizeUnit(unitStr = '') {
  if (!unitStr) return '';
  const raw = String(unitStr).trim();
  if (/^(?:ohm|ohms|Ω|ω|Ω)$/i.test(raw)) return 'ohm';
  const lower = raw.toLowerCase().replace(/[^a-z0-9Ωμµ%°ωΩ]/g, '');
  if (/^(?:v|volt|volts)$/i.test(lower)) return 'v';
  if (/^(?:a|amp|amps|ampere|amperes)$/i.test(lower)) return 'a';
  if (/^(?:ma|milliamp|milliamps)$/i.test(lower)) return 'ma';
  if (/^(?:ohm|ohms|Ω|ω|Ω)$/i.test(lower)) return 'ohm';
  if (/^(?:kohm|kohms|kΩ|kω|kΩ)$/i.test(lower)) return 'kohm';
  if (/^(?:hz|hertz)$/i.test(lower)) return 'hz';
  if (/^(?:khz|kilohertz)$/i.test(lower)) return 'khz';
  if (/^(?:s|sec|secs|second|seconds)$/i.test(lower)) return 's';
  if (/^(?:ms|millisecond|milliseconds)$/i.test(lower)) return 'ms';
  if (/^(?:m|meter|meters|metre|metres)$/i.test(lower)) return 'm';
  if (/^(?:w|watt|watts)$/i.test(lower)) return 'w';
  if (/^(?:kw|kilowatt|kilowatts)$/i.test(lower)) return 'kw';
  if (/^(?:j|joule|joules)$/i.test(lower)) return 'j';
  if (/^(?:n|newton|newtons)$/i.test(lower)) return 'n';
  if (/^(?:c|coulomb|coulombs)$/i.test(lower)) return 'c';
  if (/^(?:f|farad|farads)$/i.test(lower)) return 'f';
  if (/^(?:h|henry|henries)$/i.test(lower)) return 'h';
  if (/^(?:%|percent|percentage)$/i.test(lower)) return '%';
  return lower;
}

/**
 * Checks if two numerical values match within a relative floating-point tolerance (default 1%).
 */
function isNumericalMatch(actualVal, expectedVal, tolerance = 0.01) {
  if (typeof actualVal !== 'number' || typeof expectedVal !== 'number') return false;
  if (isNaN(actualVal) || isNaN(expectedVal)) return false;
  if (actualVal === expectedVal) return true;
  const diff = Math.abs(actualVal - expectedVal);
  if (Math.abs(expectedVal) < 1e-6) {
    return diff <= 0.01;
  }
  return (diff / Math.abs(expectedVal)) <= tolerance;
}

/**
 * Extracts a numerical magnitude and optional measurement unit from text.
 * Handles decimals, fractions (1/2), negative numbers, and units with or without spaces (20V vs 20 V).
 */
function extractNumericalValueAndUnit(text = '') {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();

  // Fraction format: e.g. "1/2", "3/4 V"
  const fractionMatch = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*([a-zA-ZΩμµ%°]+.*))?$/);
  if (fractionMatch) {
    const num = parseFloat(fractionMatch[1]);
    const den = parseFloat(fractionMatch[2]);
    if (den !== 0) {
      const value = num / den;
      const rawUnit = (fractionMatch[3] || '').trim();
      return { value, unit: normalizeUnit(rawUnit), rawUnit };
    }
  }

  // Number with optional unit: e.g. "20V", "20 V", "19.99 volts", "-0.5A", "10 ohm"
  const numMatch = raw.match(/([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-ZΩμµ%°]+)?/);
  if (!numMatch) return null;

  const value = parseFloat(numMatch[1]);
  if (isNaN(value)) return null;

  const rawUnit = (numMatch[2] || '').trim();
  return {
    value,
    unit: normalizeUnit(rawUnit),
    rawUnit
  };
}

/**
 * Intelligent Academic Answer Evaluator.
 * Replaces the fragile 3-word length heuristic with multi-modal assessment across disciplines.
 */
function evaluateAcademicAnswer(studentAnswer, currentTopic = {}, checkpointQuestion = '', options = {}) {
  if (typeof studentAnswer === 'object' && studentAnswer !== null && !currentTopic?.topicTitle && !checkpointQuestion) {
    const opts = studentAnswer;
    studentAnswer = opts.studentAnswer || opts.answer || '';
    checkpointQuestion = opts.question || opts.checkpointQuestion || '';
    currentTopic = {
      topicTitle: opts.topicTitle || opts.expectedConcept || '',
      subject: opts.subject || '',
      subjectCode: opts.subjectCode || ''
    };
    options = opts;
  }

  const rawAns = String(studentAnswer || '').trim();
  const coreAns = rawAns
    .replace(/^(?:i\s+said|it\s+is|it's|its|the\s+answer\s+is|answer\s+is|answer|i\s+think(?:\s+it's|\s+it\s+is)?|maybe|probably|mero\s+bichar\s+ma)\s+/i, '')
    .replace(/[?.!`"']+$/g, '')
    .replace(/^[`"']+/g, '')
    .trim();
  const lowerAns = coreAns.toLowerCase();
  const title = (currentTopic.topicTitle || currentTopic.topic_title || '').toLowerCase();
  const subjectCode = options.subjectCode || currentTopic.subjectCode || currentTopic.subject_code || '';
  const questionStr = String(checkpointQuestion || '');
  const qLower = questionStr.toLowerCase();

  // 1. NEUTRAL ADVANCE / STEPPING PACING
  const isNeutralAdvance = /^(?:(?:got\s+it|understood|clear|bujhe|ok|okay|oki|thik\s+cha|yes|haan|han|done|makes\s+sense)[,\s]+)?(?:next(?:\s+topic|\s+step)?|continue|proceed|move\s+on|go\s+ahead|ready|skip(?:\s+topic)?|let's\s+go|aagi\s+badham|agadi\s+badham|nexr|oki\s+nexr)[.!]*(?:\s+(?:please|pls))?$|^(?:ok|okay|oki|yes|ha|haan|han|correct|done|got\s+it|makes\s+sense|clear|bujhe|bujhiyo|thik\s+cha|understood)[.!]*(?:\s+(?:please|pls))?$/i.test(rawAns.trim());
  if (isNeutralAdvance) {
    return {
      passed: true,
      score: 0.0,
      isNeutralAdvance: true,
      format: 'neutral',
      feedback: 'Got it, let’s keep going to the next concept.'
    };
  }

  // 2. SURRENDER / CONFUSION / "I DON'T KNOW"
  const isSurrender = /(?:^|\b)(?:i\s*(?:don'?t|dont)\s*know|no\s*idea|not\s*sure|confused|bujhina|kehi\s*thaha\s*chaina|thaha\s*chaina|you\s*tell\s*me|idk|dunno|can'?t\s*answer|give\s*up|please\s*explain|help\s*me)\b/i.test(rawAns.trim());
  if (isSurrender) {
    return {
      passed: false,
      score: 0.0,
      isSurrender: true,
      misconception: 'Student requested explanation or was unsure',
      feedback: `No worries at all! That's what I'm here for. Let's clarify: in **${currentTopic.topicTitle || 'this concept'}**, the key principle is to look at the underlying mechanism. Let's trace it step-by-step:`
    };
  }

  // 2B. CLARIFICATION QUESTION / CONCEPTUAL INQUIRY
  const isExplicitClarification = /^(?:wait[,\s]+|can\s+(?:you\s+)?(?:explain|give|clarify)|could\s+you\s+(?:explain|give|clarify)|what\s+is\s+the\s+difference|what\s+does\s+.*\s+mean|what\s+if\s+|why\s+is\s+|how\s+come|please\s+explain|give\s+an?\s+example)\b/i.test(rawAns.trim());
  const isQuestionWithoutDirectAnswer = rawAns.includes('?') &&
    !/^(?:[A-Da-d]|\(?option\s+[A-Da-d]\)?|\d+(?:\.\d+)?\s*[a-zA-ZΩμµ%°]*|[ptf]|true|false)\??$/i.test(rawAns.trim()) &&
    !/(?:p\s*(?:is|=|->|→)\s*(?:true|false|t|f)|q\s*(?:is|=|->|→)\s*(?:true|false|t|f)|reflexive|symmetric|transitive)/i.test(rawAns);

  if ((isExplicitClarification || isQuestionWithoutDirectAnswer) && !isSurrender) {
    return {
      passed: false,
      isClarification: true,
      score: 0.0,
      format: 'clarification',
      feedback: 'That’s a thoughtful question! Let’s clarify this concept before answering the checkpoint.'
    };
  }

  // 3. MULTIPLE CHOICE QUESTION (MCQ) EVALUATION (Verified Active Question First)
  const activeQ = options.activeQuestion && typeof options.activeQuestion === 'object' ? options.activeQuestion : null;
  let parsedMcq = null;
  if (activeQ && Array.isArray(activeQ.options) && activeQ.options.length >= 2) {
    const optMap = {};
    for (const o of activeQ.options) {
      const k = String(o.id || o.label || '').toUpperCase();
      if (k) optMap[k] = String(o.text || '');
    }
    parsedMcq = {
      isMcq: Object.keys(optMap).length >= 2,
      options: optMap,
      explicitAnswer: activeQ.correctOptionId ? String(activeQ.correctOptionId).toUpperCase() : null,
      questionId: activeQ.id || null,
      explanation: activeQ.explanation || null,
      hint: activeQ.hint || null,
      optionExplanations: activeQ.optionExplanations || {},
      textWithoutOptions: activeQ.question || questionStr
    };
  } else {
    parsedMcq = parseMcqQuestion(questionStr);
  }

  if (parsedMcq && parsedMcq.isMcq) {
    const studentChoice = extractStudentMcqChoice(rawAns, parsedMcq);
    if (studentChoice) {
      let correctChoice = parsedMcq.explicitAnswer;

      if (!correctChoice) {
        // Deterministic domain verification for Atomic Proposition / Proposition MCQs
        const qStemLower = `${parsedMcq.textWithoutOptions || ''} ${qLower}`.toLowerCase();
        if (/\b(?:atomic\s+)?propositions?\b/i.test(qStemLower) && /\b(?:valid|which|example|following|is\s+an?)\b/i.test(qStemLower) && !/\b(?:not\s+a|invalid|isn't)\b/i.test(qStemLower)) {
          const validPropLetters = Object.entries(parsedMcq.options)
            .filter(([, txt]) => isDeclarativeAtomicProposition(txt))
            .map(([letter]) => letter);
          if (validPropLetters.length === 1) {
            correctChoice = validPropLetters[0];
          }
        }
      }

      if (!correctChoice) {
        // Automatically determine correct option by domain topic match
        let bestScore = 0;
        for (const [letter, text] of Object.entries(parsedMcq.options)) {
          const optLower = text.toLowerCase();
          let score = 0;
          if (title.includes('adt') && (optLower.includes('operations') || optLower.includes('interface')) && (optLower.includes('hid') || optLower.includes('implementation'))) score += 10;
          if (qLower.includes('complexity') && (optLower.includes('log') || optLower.includes('o('))) score += 5;
          if (qLower.includes('implication') && optLower.includes('true') && optLower.includes('false')) score += 10;
          if (qLower.includes('transitive') && optLower.includes('3nf')) score += 10;
          if (score > bestScore) {
            bestScore = score;
            correctChoice = letter;
          }
        }
      }

      if (correctChoice) {
        const chosenText = parsedMcq.options[studentChoice] || '';
        if (studentChoice === correctChoice) {
          const customExp = parsedMcq.explanation
            || (/\b(?:atomic\s+)?propositions?\b/i.test(`${parsedMcq.textWithoutOptions || ''} ${qLower}`) && isDeclarativeAtomicProposition(chosenText)
              ? `A proposition is a declarative statement that has a definite truth value — it can be either true or false. "${chosenText}" has a definite truth value, so it is a valid atomic proposition.`
              : '');
          return {
            passed: true,
            score: 1.0,
            format: 'mcq',
            questionId: parsedMcq.questionId || null,
            selectedOption: studentChoice,
            correctOption: correctChoice,
            feedback: customExp
              ? `Spot on! Correct — option **${studentChoice}** ("${chosenText}") is right. ${customExp}`
              : `Spot on! Correct — option **${studentChoice}** ("${chosenText}") is right.`
          };
        } else {
          const optSpecificWhy = parsedMcq.optionExplanations && parsedMcq.optionExplanations[studentChoice]
            ? parsedMcq.optionExplanations[studentChoice]
            : '';
          const hintText = parsedMcq.hint || 'Review the definition above and try another option.';
          return {
            passed: false,
            score: 0.0,
            format: 'mcq',
            questionId: parsedMcq.questionId || null,
            selectedOption: studentChoice,
            correctOption: correctChoice,
            hint: hintText,
            misconception: `Selected option (${studentChoice}) instead of (${correctChoice})`,
            feedback: activeQ
              ? (optSpecificWhy
                ? `Not quite — option **${studentChoice}** ("${chosenText}") isn't right. ${optSpecificWhy} Hint: ${hintText}`
                : `Not quite — option **${studentChoice}** ("${chosenText}") isn't the best match here. Hint: ${hintText}`)
              : `Not quite. You chose **(${studentChoice})** ("${chosenText}"), but the correct choice is **(${correctChoice})** ("${parsedMcq.options[correctChoice]}"). Let's review why before continuing.`
          };
        }
      }
    } else if (/^(?:hmm+|uh+|um+|maybe|not\s+sure|between\s+[a-d]\s+and\s+[a-d]|either\s+[a-d]\s+or\s+[a-d]|[a-d]\s+or\s+[a-d]|both|neither|all\s+of\s+them|none|idk\s+maybe)[.!?]*$/i.test(rawAns.trim())) {
      return {
        passed: false,
        score: 0.0,
        isAmbiguous: true,
        format: 'ambiguous',
        questionId: parsedMcq.questionId || null,
        feedback: `That answer is a bit ambiguous — could you clarify which option you want to pick (${Object.keys(parsedMcq.options).join(', ')})? You can also click an option button directly or ask me for a hint.`
      };
    }
  }

  // Detect Academic Discipline
  const subject = options.subject || currentTopic.subject || '';
  const topicTitle = currentTopic.topicTitle || currentTopic.topic_title || '';
  const discipline = options.discipline || detectAcademicDiscipline(subject, subjectCode, topicTitle || title, questionStr);

  // 3B. NUMERICAL & UNIT-AWARE EVALUATION (P2-5)
  // Physics, Circuits, and Mathematical calculations
  const studentNumerical = extractNumericalValueAndUnit(rawAns);
  if (studentNumerical) {
    let expectedVal = null;
    let expectedUnitStr = '';

    if (options.expectedValue !== undefined) {
      expectedVal = Number(options.expectedValue);
      expectedUnitStr = options.expectedUnit || options.unit || '';
    } else if (options.expectedNumber !== undefined) {
      expectedVal = Number(options.expectedNumber);
      expectedUnitStr = options.expectedUnit || options.unit || '';
    } else if (options.expectedAnswer) {
      const parsedExp = extractNumericalValueAndUnit(options.expectedAnswer);
      if (parsedExp) {
        expectedVal = parsedExp.value;
        expectedUnitStr = parsedExp.rawUnit;
      }
    } else if (currentTopic.expectedValue !== undefined) {
      expectedVal = Number(currentTopic.expectedValue);
      expectedUnitStr = currentTopic.expectedUnit || '';
    } else if (currentTopic.answerKey) {
      const parsedExp = extractNumericalValueAndUnit(currentTopic.answerKey);
      if (parsedExp) {
        expectedVal = parsedExp.value;
        expectedUnitStr = parsedExp.rawUnit;
      }
    } else if (options.expectedConcept) {
      const parsedExp = extractNumericalValueAndUnit(options.expectedConcept);
      if (parsedExp) {
        expectedVal = parsedExp.value;
        expectedUnitStr = parsedExp.rawUnit;
      }
    } else {
      // Check explicit [Answer: 20V] or (Expected: 20V) in questionStr
      const expMatch = questionStr.match(/(?:\[Answer:\s*([^\]]+)\]|\(Expected:\s*([^)]+)\)|Expected:\s*([^\n,.]+))/i);
      if (expMatch) {
        const parsedExp = extractNumericalValueAndUnit(expMatch[1] || expMatch[2] || expMatch[3]);
        if (parsedExp) {
          expectedVal = parsedExp.value;
          expectedUnitStr = parsedExp.rawUnit;
        }
      } else if (qLower.includes('voltage') && (qLower.includes('ohm') || qLower.includes('resistance')) && (qLower.includes('current') || qLower.includes('amp'))) {
        // Derive V = I * R from question parameters if present
        const rMatch = questionStr.match(/(\d+(?:\.\d+)?)\s*(?:ohm|ohms|Ω)/i);
        const iMatch = questionStr.match(/(\d+(?:\.\d+)?)\s*(?:a|amp|amps|amperes)/i);
        if (rMatch && iMatch) {
          expectedVal = parseFloat(rMatch[1]) * parseFloat(iMatch[1]);
          expectedUnitStr = 'V';
        }
      }
    }

    if (expectedVal !== null && !isNaN(expectedVal)) {
      const isValMatch = isNumericalMatch(studentNumerical.value, expectedVal, 0.01);
      const normExpectedUnit = normalizeUnit(expectedUnitStr);
      const normStudentUnit = studentNumerical.unit;

      if (isValMatch) {
        if (normExpectedUnit && normStudentUnit && normExpectedUnit !== normStudentUnit) {
          return {
            passed: false,
            score: 0.5,
            isPartialCredit: true,
            format: 'calculation',
            misconception: 'Incorrect unit of measurement',
            feedback: `The numerical magnitude (${studentNumerical.value}) is correct, but the unit is wrong. You answered with ${studentNumerical.rawUnit || normStudentUnit.toUpperCase()}, but the required unit is ${expectedUnitStr || normExpectedUnit.toUpperCase()}.`
          };
        }
        return {
          passed: true,
          score: 1.0,
          format: 'calculation',
          feedback: `Spot on! ${studentNumerical.value}${normStudentUnit ? ' ' + (studentNumerical.rawUnit || normStudentUnit.toUpperCase()) : ''} is the correct calculated value.`
        };
      } else if (normStudentUnit && normExpectedUnit && normStudentUnit === normExpectedUnit) {
        return {
          passed: false,
          score: 0.0,
          format: 'calculation',
          misconception: 'Incorrect calculation result',
          feedback: `The unit is correct, but ${studentNumerical.value} does not match the expected calculation. Double check your arithmetic.`
        };
      }
    }
  }

  // 4. DISCIPLINE-SPECIFIC EVALUATION
  // 4A. MATHEMATICS & FORMAL LOGIC
  if (discipline === DISCIPLINES.MATHEMATICS || qLower.includes('p -> q') || qLower.includes('p → q') || qLower.includes('implication') || (qLower.includes('conditional') && qLower.includes('false'))) {
    // Implication condition: P -> Q is false
    if (qLower.includes('implication') || qLower.includes('p -> q') || qLower.includes('p → q') || qLower.includes('conditional')) {
      // 1. Guard against student merely stating truth value ("false", "condition is false", "true")
      if (/^(?:(?:the\s+)?condition\s+(?:is\s+)?|it\s+(?:is|'s)\s+)?(?:false|true|f|t)[.!]*(?:\s+(?:only|always))?$/i.test(lowerAns) || /^(?:it\s+is|its|it's)\s+(?:false|true)$/i.test(lowerAns)) {
        return {
          passed: false,
          score: 0.0,
          format: 'math',
          misconception: 'Stated truth value instead of condition',
          feedback: 'You stated a truth value rather than the condition. Under what specific truth values of the premise (P) and conclusion (Q) is P → Q false?'
        };
      }

      // True premise variations: P is true, P=T, antecedent is true, premise is true, T, true, tru, 1
      const hasPTrue = /(?:p\s+(?:is\s+)?(?:true|tru|1|t\b)|p\s*=\s*(?:t\b|true|tru|1)|(?:premise|antecedent|hypothesis)\s+(?:is\s+)?(?:true|tru|1|t\b)|(?:when\s+|if\s+)?(?:true|tru|t)\s*(?:->|→|to|then|implies)\s*(?:false|fals|f\b)|(?:true|tru)\s+(?:then\s+)?(?:false|fals)|(?:^|\b)t\s*(?:->|→|then|\/)\s*f(?:\b|$))/i.test(lowerAns);

      // False conclusion variations: Q is false, Q=F, consequent is false, conclusion is false, F, false, fals, 0
      const hasQFalse = /(?:q\s+(?:is\s+)?(?:false|fals|0|f\b)|q\s*=\s*(?:f\b|false|fals|0)|(?:conclusion|consequent)\s+(?:is\s+)?(?:false|fals|0|f\b)|(?:true|tru|t)\s*(?:->|→|to|then|implies)\s*(?:false|fals|f\b)|(?:true|tru)\s+(?:then\s+)?(?:false|fals)|(?:^|\b)t\s*(?:->|→|then|\/)\s*f(?:\b|$))/i.test(lowerAns);

      const isCombinedTrueThenFalse = /(?:(?:true|tru|t)\s*(?:->|→|to|then|implies)\s*(?:false|fals|f)|t\s*->\s*f\s*=\s*f|true\s+implies\s+false|tru\s+implies\s+fals|antecedent\s+(?:is\s+)?(?:true|tru)\s*(?:and|,)\s*consequent\s+(?:is\s+)?(?:false|fals)|premise\s+(?:is\s+)?(?:true|tru)\s*(?:and|,)\s*conclusion\s+(?:is\s+)?(?:false|fals))/i.test(lowerAns);

      if ((hasPTrue && hasQFalse) || isCombinedTrueThenFalse) {
        return {
          passed: true,
          score: 1.0,
          format: 'math',
          feedback: 'Spot on! An implication $P \\to Q$ is false ONLY when the premise/antecedent $P$ is True and the conclusion/consequent $Q$ is False ($T \\to F = F$).'
        };
      }

      if (/(?:both\s+(?:.*?\s+)?false|p\s+(?:is\s+)?false|when\s+p\s+(?:is\s+)?false|f\s*(?:->|to)\s*f)/i.test(lowerAns)) {
        return {
          passed: false,
          score: 0.0,
          format: 'math',
          misconception: 'Believed false premise implies false outcome',
          feedback: 'Common pitfall! Remember that an implication with a false premise ($F \\to F$) is vacuously TRUE. $P \\to Q$ is ONLY false when the premise $P$ is True and conclusion $Q$ is False.'
        };
      }

      if (hasPTrue && !hasQFalse) {
        return {
          passed: false,
          score: 0.5,
          isPartialCredit: true,
          format: 'math',
          misconception: 'Omitted condition for Q',
          feedback: 'You have the first part right ($P$ / antecedent must be True)! But what must the truth value of $Q$ / consequent be at the same time to make the implication false?'
        };
      }

      if (!hasPTrue && hasQFalse) {
        return {
          passed: false,
          score: 0.5,
          isPartialCredit: true,
          format: 'math',
          misconception: 'Omitted condition for P',
          feedback: 'You have the second part right ($Q$ / consequent must be False)! But what must the truth value of $P$ / antecedent be at the same time to make the implication false?'
        };
      }
    }

    // Logical Equivalence
    if (qLower.includes('equivalent') || qLower.includes('equivalence')) {
      if (/(?:~p\s*v\s*q|not\s+p\s+or\s+q|!p\s*\|\|\s*q|\\neg\s*p\s*\\lor\s*q)/i.test(lowerAns)) {
        return {
          passed: true,
          score: 1.0,
          format: 'math',
          feedback: 'Exactly right! $P \\to Q \\equiv \\neg P \\lor Q$. Well done!'
        };
      }
    }

    // Equivalence Relations
    if (qLower.includes('equivalence relation')) {
      const hasAntiSymm = /\b(?:anti-?symmetric|asymmetric)\b/i.test(lowerAns);
      const hasSymm = /\bsymmetric\b/i.test(lowerAns) && !hasAntiSymm;
      const hasRefl = /\breflexive\b/i.test(lowerAns) && !/\birreflexive\b/i.test(lowerAns);
      const hasTrans = /\btransitive\b/i.test(lowerAns) && !/\bintransitive\b/i.test(lowerAns);

      if (hasRefl && hasSymm && hasTrans) {
        return {
          passed: true,
          score: 1.0,
          format: 'math',
          feedback: 'Spot on! An equivalence relation must be Reflexive, Symmetric, and Transitive.'
        };
      }
      if (hasAntiSymm) {
        return {
          passed: false,
          score: 0.0,
          format: 'math',
          misconception: 'Stated asymmetric/anti-symmetric instead of symmetric',
          feedback: 'Careful! An equivalence relation requires Symmetry (if a R b then b R a), NOT asymmetry or anti-symmetry (which is for partial orders).'
        };
      }
      if (hasRefl || hasSymm || hasTrans) {
        return {
          passed: false,
          score: 0.5,
          isPartialCredit: true,
          format: 'math',
          misconception: 'Partial properties named',
          feedback: 'Good start! Remember that an equivalence relation requires all THREE properties: Reflexive, Symmetric, and Transitive.'
        };
      }
    }

    // Boolean / Truth Values
    if (/^(?:true|t|valid|tautology)$/i.test(coreAns)) {
      if (qLower.includes('true') || qLower.includes('valid') || qLower.includes('satisfi') || qLower.includes('subset')) {
        return {
          passed: true,
          score: 1.0,
          format: 'math',
          feedback: `Correct! The statement is indeed ${coreAns.toUpperCase()}.`
        };
      }
    }
  }

  // 4B. PROGRAMMING & ALGORITHMS
  if (discipline === DISCIPLINES.PROGRAMMING || discipline === DISCIPLINES.GRAPH_THEORY) {
    // Big-O Time Complexity
    const complexityMatch = coreAns.match(/(?:\bO\s*\(\s*(?:1|n|log\s*n|n\s*log\s*n|n\^2|2\^n|n!)\s*\)|\b(?:log\s*n|linear|constant|quadratic|logarithmic)\b)/i);
    if (complexityMatch && (qLower.includes('complexity') || qLower.includes('big-o') || qLower.includes('time') || qLower.includes('space'))) {
      const compToken = complexityMatch[0].toLowerCase().replace(/\s+/g, '');
      if (qLower.includes('binary search') && (compToken.includes('logn') || compToken.includes('logarithmic'))) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! Binary search runs in O(log n) time because it halves the search space with each comparison.'
        };
      }
      if (qLower.includes('linear search') && (compToken.includes('o(n)') || compToken === 'linear')) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Exactly right! Linear search takes O(n) time in the worst case as it scans elements sequentially.'
        };
      }
      if ((qLower.includes('array index') || qLower.includes('hash') || ((qLower.includes('linked list') || title.includes('linked list')) && (qLower.includes('beginning') || qLower.includes('head') || qLower.includes('front')))) && (compToken.includes('o(1)') || compToken === 'constant')) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! Inserting at the beginning of a linked list with a head pointer (like array indexing or hash lookups) takes O(1) constant time.'
        };
      }
    }

    // Singly Linked List Insertion at Head
    if ((title.includes('singly') || qLower.includes('linked list')) && (qLower.includes('insert') || qLower.includes('pointer'))) {
      if (lowerAns.includes('newnode->next') || lowerAns.includes('next pointer') || lowerAns.includes('newnode') && lowerAns.includes('head')) {
        if (!lowerAns.includes('head first') && !lowerAns.includes('head = newnode first')) {
          return {
            passed: true,
            score: 1.0,
            format: 'code',
            feedback: 'Exactly right! Updating `newNode->next = head` first ensures we don’t orphan the rest of the list before moving `head`.'
          };
        }
      }
      if (lowerAns.includes('head first') || lowerAns.includes('head = newnode first')) {
        return {
          passed: false,
          score: 0.0,
          format: 'code',
          misconception: 'Orphaned list pointer',
          feedback: 'Be careful! If you move `head` first, you lose the address of the existing chain. You must point `newNode->next` to `head` first!'
        };
      }
    }

    // Stack & Queue
    if (qLower.includes('lifo') || qLower.includes('fifo') || qLower.includes('data structure')) {
      if (lowerAns.includes('stack') && (qLower.includes('lifo') || qLower.includes('last in'))) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! A Stack operates on a Last-In, First-Out (LIFO) basis.'
        };
      }
      if (lowerAns.includes('queue') && (qLower.includes('fifo') || qLower.includes('first in'))) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! A Queue operates on a First-In, First-Out (FIFO) basis.'
        };
      }
    }

    // ADT Check
    if (title.includes('adt') || qLower.includes('abstract data type') || lowerAns.includes('adt')) {
      const hasHardwareMisconception = /\b(?:hardware\s+registers?|physical\s+memory\s+bus|cpu\s+registers?|tied\s+to\s+(?:the\s+)?cpu)\b/i.test(lowerAns);
      if (hasHardwareMisconception) {
        return {
          passed: false,
          score: 0.0,
          format: 'code',
          misconception: 'Confused ADT with hardware architecture or physical registers',
          feedback: 'Careful! An ADT is a high-level conceptual abstraction defined independently of any specific CPU hardware, registers, or bus architecture.'
        };
      }

      if (lowerAns.includes('what') || lowerAns.includes('how') || lowerAns.includes('implementation') || lowerAns.includes('interface') || lowerAns.includes('hiding') || lowerAns.includes('operat')) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! ADTs define the interface (what operations can be performed) while abstracting away the internal implementation (how data is physically stored in memory).'
        };
      }
    }

    // Java Bytecode / JVM
    if (qLower.includes('bytecode') || qLower.includes('jvm')) {
      if (lowerAns.includes('intermediate') || lowerAns.includes('platform') || lowerAns.includes('jvm') || lowerAns.includes('independent') || lowerAns.includes('machine code')) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: 'Spot on! Java bytecode is an intermediate, platform-independent representation executed by the JVM on any machine.'
        };
      }
    }
  }

  // 4C. DATABASE & RELATIONAL SYSTEMS
  if (discipline === DISCIPLINES.DATABASE || qLower.includes('3nf') || qLower.includes('2nf') || qLower.includes('1nf') || qLower.includes('normal form') || qLower.includes('normalization') || qLower.includes('transitive') || qLower.includes('partial')) {
    // Normal Forms
    if (qLower.includes('transitive') || qLower.includes('3nf') || qLower.includes('third normal')) {
      if (lowerAns.includes('repeating') || lowerAns.includes('atomic')) {
        return {
          passed: false,
          score: 0.0,
          format: 'sql',
          misconception: 'Confused 3NF with 1NF requirements (repeating groups/atomicity)',
          feedback: 'Careful! Eliminating repeating groups and ensuring atomic values is the definition of 1NF, not 3NF. 3NF eliminates transitive dependencies.'
        };
      }
      if (lowerAns.includes('partial')) {
        return {
          passed: false,
          score: 0.0,
          format: 'sql',
          misconception: 'Confused 3NF with 2NF requirements (partial dependencies)',
          feedback: 'Careful! Removing partial functional dependencies is the rule for 2NF. 3NF eliminates transitive dependencies.'
        };
      }
      if (lowerAns.includes('3nf') || lowerAns.includes('third normal')) {
        return {
          passed: true,
          score: 1.0,
          format: 'sql',
          feedback: 'Spot on! Third Normal Form (3NF) eliminates transitive functional dependencies.'
        };
      }
      if (lowerAns.includes('transitive')) {
        return {
          passed: true,
          score: 1.0,
          format: 'sql',
          feedback: 'Spot on! Third Normal Form (3NF) eliminates transitive functional dependencies.'
        };
      }
    }
    if (qLower.includes('2nf') || qLower.includes('second normal') || qLower.includes('partial')) {
      if (lowerAns.includes('transitive')) {
        return {
          passed: false,
          score: 0.0,
          format: 'sql',
          misconception: 'Confused 2NF with 3NF requirements (transitive dependencies)',
          feedback: 'Careful! Transitive dependencies are removed in 3NF. 2NF specifically removes partial dependencies.'
        };
      }
      if (lowerAns.includes('partial') || lowerAns.includes('2nf') || lowerAns.includes('second normal')) {
        return {
          passed: true,
          score: 1.0,
          format: 'sql',
          feedback: 'Exactly right! Second Normal Form (2NF) removes partial functional dependencies on candidate keys.'
        };
      }
    }
    if (qLower.includes('1nf') || qLower.includes('first normal') || qLower.includes('repeating') || qLower.includes('atomic')) {
      if (lowerAns.includes('atomic') || lowerAns.includes('repeating') || lowerAns.includes('1nf') || lowerAns.includes('first normal')) {
        return {
          passed: true,
          score: 1.0,
          format: 'sql',
          feedback: 'Correct! 1NF ensures all attribute values are atomic with no repeating groups.'
        };
      }
    }

    // SQL Query Syntax
    if (qLower.includes('sql') || qLower.includes('query') || /^\s*select\b/i.test(rawAns)) {
      if (/^\s*select\b/i.test(rawAns) && /\bfrom\b/i.test(rawAns)) {
        return {
          passed: true,
          score: 1.0,
          format: 'sql',
          feedback: 'Excellent SQL syntax! You’ve properly structured the query clauses.'
        };
      }
      return {
        passed: false,
        score: 0.0,
        format: 'sql',
        misconception: 'Missing valid SQL statement syntax',
        feedback: 'A valid SQL query must start with a DDL/DML statement like `SELECT ... FROM ...`.'
      };
    }
  }

  // 4D. NETWORKING & PROTOCOLS
  if (discipline === DISCIPLINES.NETWORKING || qLower.includes('osi') || qLower.includes('layer') || /layer\s*[1-7]/i.test(qLower)) {
    // OSI Layer Evaluation
    if (qLower.includes('osi') || qLower.includes('layer') || /layer\s*[1-7]/i.test(qLower)) {
      let targetLayer = null;
      if (qLower.includes('end-to-end') || qLower.includes('transport') || qLower.includes('port') || qLower.includes('tcp') || qLower.includes('udp') || qLower.includes('segment') || qLower.includes('flow control')) {
        targetLayer = 'transport';
      } else if (qLower.includes('routing') || qLower.includes('packet') || qLower.includes('ip') || qLower.includes('logical address') || qLower.includes('host-to-host')) {
        targetLayer = 'network';
      } else if (qLower.includes('frame') || qLower.includes('mac') || qLower.includes('data link') || qLower.includes('hop-to-hop') || qLower.includes('switch') || qLower.includes('node-to-node')) {
        targetLayer = 'data link';
      } else if (qLower.includes('bit') || qLower.includes('cable') || qLower.includes('signal') || qLower.includes('physical') || qLower.includes('hub')) {
        targetLayer = 'physical';
      } else if (qLower.includes('session') || qLower.includes('dialog') || qLower.includes('token management')) {
        targetLayer = 'session';
      } else if (qLower.includes('presentation') || qLower.includes('syntax') || qLower.includes('encryption') || qLower.includes('compression')) {
        targetLayer = 'presentation';
      } else if (qLower.includes('application') || qLower.includes('http') || qLower.includes('user interface') || qLower.includes('dns') || qLower.includes('ftp') || qLower.includes('smtp')) {
        targetLayer = 'application';
      }

      let studentLayer = null;
      if (/\b(?:transport(?:\s+layer)?|layer\s*4|fourth\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'transport';
      } else if (/\b(?:network(?:\s+layer)?|layer\s*3|third\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'network';
      } else if (/\b(?:data\s*link(?:\s+layer)?|datalink|layer\s*2|second\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'data link';
      } else if (/\b(?:physical(?:\s+layer)?|layer\s*1|first\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'physical';
      } else if (/\b(?:session(?:\s+layer)?|layer\s*5|fifth\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'session';
      } else if (/\b(?:presentation(?:\s+layer)?|layer\s*6|sixth\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'presentation';
      } else if (/\b(?:application(?:\s+layer)?|layer\s*7|seventh\s+layer)\b/i.test(lowerAns)) {
        studentLayer = 'application';
      }

      if (targetLayer && studentLayer) {
        if (studentLayer === targetLayer) {
          const capName = targetLayer.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          return {
            passed: true,
            score: 1.0,
            format: 'concept',
            feedback: `Spot on! The ${capName} Layer provides this essential networking function.`
          };
        } else {
          const capStudent = studentLayer.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const capTarget = targetLayer.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          return {
            passed: false,
            score: 0.0,
            format: 'concept',
            misconception: `Confused ${studentLayer} layer with ${targetLayer} layer`,
            feedback: `Not quite. The ${capStudent} layer handles other responsibilities, while the ${capTarget} layer provides this functionality.`
          };
        }
      }
    }

    if (qLower.includes('handshake') || qLower.includes('tcp')) {
      const hasSyn = lowerAns.includes('syn');
      const hasAck = lowerAns.includes('ack');
      if (hasSyn && hasAck) {
        return {
          passed: true,
          score: 1.0,
          format: 'concept',
          feedback: 'Spot on! The TCP 3-way handshake sequence is SYN -> SYN-ACK -> ACK.'
        };
      }
    }

    // UDP vs TCP Transport Protocols
    if ((qLower.includes('udp') || qLower.includes('tcp')) && (qLower.includes('prefer') || qLower.includes('difference') || qLower.includes('protocol') || qLower.includes('streaming') || qLower.includes('dns'))) {
      const claimsGuaranteedDelivery = /\b(?:guarantees?\s+(?:packet\s+)?delivery|reliable\s+delivery|retransmits?|sliding\s+windows?)\b/i.test(lowerAns) && lowerAns.includes('udp');
      if (claimsGuaranteedDelivery) {
        return {
          passed: false,
          score: 0.0,
          format: 'concept',
          misconception: 'False attribution of TCP reliability mechanisms to UDP',
          feedback: 'Common misconception! UDP is connectionless and UNRELIABLE — it does NOT guarantee delivery, nor does it retransmit lost packets or use sliding windows. It is preferred for streaming and DNS specifically because it has low latency without handshake or retransmission overhead.'
        };
      }

      const hasUdpTraits = /\b(?:connectionless|low(?:er)?\s+latency|fast(?:er)?|no\s+handshake|lightweight|no\s+overhead|unreliable|no\s+(?:delivery\s+)?guarantee|best\s+effort)\b/i.test(lowerAns);
      if (hasUdpTraits) {
        return {
          passed: true,
          score: 1.0,
          format: 'concept',
          feedback: 'Spot on! UDP is connectionless and lightweight with minimal latency, making it ideal for real-time traffic and DNS where retransmission delay cannot be tolerated.'
        };
      }
    }
  }

  // 4E. PHYSICS / CIRCUITS
  if (discipline === DISCIPLINES.PHYSICS) {
    if (qLower.includes('kcl') || (qLower.includes('kirchhoff') && (qLower.includes('current') || qLower.includes('node') || qLower.includes('junction')))) {
      const hasEqualSplitMisconception = /\b(?:splits?\s+equally|equal(?:ly)?\s+across|voltage\s+remains\s+constant\s+throughout\s+all\s+resistors)\b/i.test(lowerAns);
      if (hasEqualSplitMisconception) {
        return {
          passed: false,
          score: 0.0,
          format: 'physics',
          misconception: 'Confused KCL with equal current division or constant voltage',
          feedback: 'Careful! Currents only split equally if branch resistances are identical, and voltage is not constant across series resistors. KCL specifically states that the algebraic sum of currents entering a junction equals the sum leaving (\\sum I_{in} = \\sum I_{out}).'
        };
      }

      const hasKclPrinciple = /\b(?:sum\s+of\s+(?:all\s+)?currents?\s+entering|currents?\s+entering\s+(?:a\s+junction\s+|a\s+node\s+)?equals?\s+(?:the\s+sum\s+of\s+)?(?:currents?\s+)?leaving|algebraic\s+sum\s+of\s+currents?\s+(?:is\s+|equals?\s+)?zero|conservation\s+of\s+charge)\b/i.test(lowerAns);
      if (hasKclPrinciple) {
        return {
          passed: true,
          score: 1.0,
          format: 'physics',
          feedback: 'Spot on! Kirchhoff’s Current Law (KCL) is based on conservation of charge: $\\sum I_{in} = \\sum I_{out}$ at any electrical node.'
        };
      }
    }

    if (qLower.includes('ohm') || qLower.includes('voltage') || qLower.includes('current')) {
      if (/v\s*=\s*i\s*\*?\s*r|i\s*=\s*v\s*\/\s*r/i.test(lowerAns) || (lowerAns.includes('voltage') && lowerAns.includes('resistance') && lowerAns.includes('current'))) {
        return {
          passed: true,
          score: 1.0,
          format: 'math',
          feedback: 'Spot on! Ohm’s Law governs the relationship: $V = IR$.'
        };
      }
    }
  }

  // 4F. LEGACY CSS COMPATIBILITY CHECKS
  if (checkpointQuestion && coreAns) {
    const cssRuleMatch = questionStr.match(/`([^`]+)\{([^}]+)\}`/);
    if (cssRuleMatch) {
      const selectorToken = cssRuleMatch[1].trim().toLowerCase();
      const declBody = cssRuleMatch[2].trim().toLowerCase();
      if (qLower.includes('selector') && (lowerAns === selectorToken || lowerAns === `${selectorToken} tag` || lowerAns === `<${selectorToken}>`)) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: `Spot on! \`${selectorToken}\` is the Selector — it tells CSS which HTML element to style.`
        };
      }
      if (qLower.includes('property') && declBody.includes(`${lowerAns}:`)) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: `Exactly right! \`${lowerAns}\` is the Property being changed.`
        };
      }
      if (qLower.includes('value') && new RegExp(`:\\s*${lowerAns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(declBody)) {
        return {
          passed: true,
          score: 1.0,
          format: 'code',
          feedback: `Spot on! \`${lowerAns}\` is the Value applied to the property.`
        };
      }
    }
  }

  // 5. SEMANTIC RELEVANCE & NONSENSE REJECTION
  // Prevent off-topic / nonsense answers from passing simply by word count
  const questionKeywords = extractAcademicKeywords(questionStr);
  const questionKeywordsSet = new Set(questionKeywords);
  const topicKeywords = extractAcademicKeywords(title);
  const studentKeywords = extractAcademicKeywords(rawAns);

  // Target concept keywords MUST exclude words that appeared in the question prompt!
  const explicitTargetKeywords = [
    ...extractAcademicKeywords(options.expectedConcept || ''),
    ...extractAcademicKeywords(options.expectedAnswer || ''),
    ...extractAcademicKeywords(currentTopic.expectedConcept || ''),
    ...extractAcademicKeywords(currentTopic.answerKey || '')
  ];

  const targetConceptKeywords = new Set(
    [...explicitTargetKeywords, ...topicKeywords].filter(kw => !questionKeywordsSet.has(kw))
  );

  // Prompt keywords + target keywords indicate whether the student is on-topic
  const allDomainKeywords = new Set([...questionKeywords, ...topicKeywords, ...explicitTargetKeywords]);

  let onTopicOverlap = 0;
  for (const kw of studentKeywords) {
    if (allDomainKeywords.has(kw)) onTopicOverlap++;
  }

  // Target overlap ONLY counts matches against TARGET keywords NOT in the question prompt
  let targetOverlap = 0;
  for (const kw of studentKeywords) {
    if (targetConceptKeywords.has(kw)) targetOverlap++;
  }

  // Substantive novel keywords introduced by the student beyond the prompt
  const novelStudentKeywords = studentKeywords.filter(kw => !questionKeywordsSet.has(kw));

  const wordCount = rawAns.split(/\s+/).filter(Boolean).length;

  // Off-topic nonsense: 3 or more words with ZERO domain keyword match
  if (wordCount >= 3 && allDomainKeywords.size >= 2 && onTopicOverlap === 0) {
    return {
      passed: false,
      score: 0.0,
      format: 'concept',
      misconception: 'Off-topic or irrelevant response',
      feedback: `That doesn’t quite address the checkpoint question. Let’s refocus on **${currentTopic.topicTitle || 'this concept'}** before we continue.`
    };
  }

  // Repeating only question prompt keywords without introducing any substantive concept is NOT sufficient to pass!
  if (novelStudentKeywords.length === 0 && studentKeywords.length > 0 && studentKeywords.every(kw => questionKeywordsSet.has(kw))) {
    return {
      passed: false,
      score: 0.0,
      format: 'concept',
      misconception: 'Repeated question prompt without answering',
      feedback: `You repeated keywords from the question without providing the required concept. Please explain the answer in your own words.`
    };
  }

  // High relevance conceptual match against TARGET concept keywords (never question prompt words)
  if (targetOverlap >= 1 || (wordCount <= 3 && studentKeywords.length > 0 && targetConceptKeywords.has(studentKeywords[0]))) {
    return {
      passed: true,
      score: 1.0,
      format: 'concept',
      feedback: 'Great response! You’ve demonstrated clear comprehension of this concept.'
    };
  }

  // Substantial, substantive on-topic academic explanation that introduces multiple novel technical concepts
  if (wordCount >= 5 && onTopicOverlap >= 1 && novelStudentKeywords.length >= 2 && (targetConceptKeywords.size === 0 || targetOverlap >= 1)) {
    return {
      passed: true,
      score: 1.0,
      format: 'concept',
      feedback: 'Great response! You’ve demonstrated clear comprehension of this concept.'
    };
  }

  // Concise fallback if matching target keywords
  if (wordCount >= 3 && targetOverlap > 0) {
    return {
      passed: true,
      score: 1.0,
      format: 'concept',
      feedback: 'Great response! You’ve demonstrated clear comprehension of this concept.'
    };
  }

  return {
    passed: false,
    score: 0.0,
    format: 'concept',
    misconception: 'Incomplete or unclear answer',
    feedback: 'Not quite, but you’re on the right track! Let’s clarify this subtle point before moving forward.'
  };
}

/**
 * Generates a verified structured MCQ checkpoint for a study session micro-topic.
 * Always includes a unique question ID, verified correctOptionId, explanation, hint,
 * and per-option wrong-answer explanations.
 */
function generateStructuredMcqForTopic(step = {}, session = {}) {
  const title = String(step.topicTitle || step.topic_title || '').trim();
  const lower = title.toLowerCase();
  const stepIdx = Number(step.stepIndex || step.step_index || 1);
  const sessId = session?.id || 'study';
  const qId = `mcq_${sessId}_s${stepIdx}`;

  if (lower.includes('implication') || lower.includes('conditional') || lower.includes('propositional logic')) {
    return {
      id: qId,
      question: 'When is the logical implication P → Q FALSE?',
      options: [
        { id: 'A', text: 'When P is False and Q is False' },
        { id: 'B', text: 'When P is True and Q is False' },
        { id: 'C', text: 'When P is False and Q is True' },
        { id: 'D', text: 'When P is True and Q is True' }
      ],
      correctOptionId: 'B',
      explanation: 'An implication P → Q is only false when a true premise (P = True) leads to a false conclusion (Q = False). Whenever P is false, P → Q is vacuously true.',
      hint: 'Think of P → Q as a promise ("If P happens, then Q will happen"). In which case is the promise actually broken?',
      optionExplanations: {
        A: 'When P is false, the implication P → Q is vacuously true (the promise was never triggered).',
        C: 'When P is false and Q is true, P → Q evaluates to True.',
        D: 'When both P and Q are true, the implication holds and evaluates to True.'
      }
    };
  }

  if (lower.includes('proposition') || lower.includes('atomic') || lower.includes('logic and induction')) {
    return {
      id: qId,
      question: 'Which of the following is a valid Atomic Proposition?',
      options: [
        { id: 'A', text: 'Go to your room!' },
        { id: 'B', text: 'Is it raining?' },
        { id: 'C', text: '2 + 2 = 5' },
        { id: 'D', text: 'What time is it?' }
      ],
      correctOptionId: 'C',
      explanation: 'A proposition is a declarative statement that has a definite truth value — it can be either true or false. "2 + 2 = 5" is definitely false and cannot be broken into smaller propositions, so it is a valid atomic proposition.',
      hint: 'A proposition does not have to be true — it only needs to be a declarative statement that is clearly either true or false (not a command or a question).',
      optionExplanations: {
        A: '"Go to your room!" is an imperative command, not a declarative statement, so it has no truth value.',
        B: '"Is it raining?" is an interrogative question, so it cannot be evaluated as true or false.',
        D: '"What time is it?" is a question rather than a declarative statement.'
      }
    };
  }

  if (lower.includes('adt') || lower.includes('abstract data type')) {
    return {
      id: qId,
      question: 'What does an Abstract Data Type (ADT) primarily define?',
      options: [
        { id: 'A', text: 'The physical CPU registers used to store data' },
        { id: 'B', text: 'The operations and behavior, hiding internal implementation details' },
        { id: 'C', text: 'The exact number of bytes allocated on the stack' },
        { id: 'D', text: 'The compiler flags needed to optimize loops' }
      ],
      correctOptionId: 'B',
      explanation: 'An ADT specifies what operations can be performed and their behavior (the interface) while abstracting away how data is stored in memory.',
      hint: 'Focus on the word "Abstract" — does an ADT specify *what* operations do or *how* memory is wired?',
      optionExplanations: {
        A: 'ADTs are high-level mathematical models independent of CPU hardware or registers.',
        C: 'Memory byte layout is an implementation detail, not part of the ADT specification.',
        D: 'Compiler flags are unrelated to defining a data type abstraction.'
      }
    };
  }

  if (lower.includes('css') || lower.includes('cascading style sheet') || lower.includes('levels of style') || lower.includes('where you can add')) {
    return {
      id: qId,
      question: 'Which way of applying CSS is considered best practice for styling multiple pages of a website?',
      options: [
        { id: 'A', text: 'Inline CSS inside every HTML tag' },
        { id: 'B', text: 'External stylesheet linked with <link rel="stylesheet">' },
        { id: 'C', text: 'Repeating <style> blocks inside <body>' },
        { id: 'D', text: 'Writing CSS inside HTML comments' }
      ],
      correctOptionId: 'B',
      explanation: 'An external CSS file separates presentation from HTML structure and lets one stylesheet consistently style an entire multi-page website.',
      hint: 'Think about maintainability: which approach lets you update styles across all pages from a single file?',
      optionExplanations: {
        A: 'Inline CSS mixes styling into every element and is hard to maintain across multiple pages.',
        C: 'Internal styles only apply to a single document and belong in <head>, not repeated in <body>.',
        D: 'CSS inside HTML comments is ignored by the browser.'
      }
    };
  }

  if (lower.includes('singly linked list') && (lower.includes('insert') || lower.includes('representation'))) {
    return {
      id: qId,
      question: 'When inserting a new node at the beginning of a singly linked list, which pointer update must happen first?',
      options: [
        { id: 'A', text: 'Set head = newNode first' },
        { id: 'B', text: 'Set newNode->next = head first' },
        { id: 'C', text: 'Set head->next = NULL first' },
        { id: 'D', text: 'Free the old head node first' }
      ],
      correctOptionId: 'B',
      explanation: 'Pointing newNode->next to the current head first preserves the reference to the rest of the list before updating head = newNode.',
      hint: 'If you overwrite `head` too early, what happens to the address of the existing first node?',
      optionExplanations: {
        A: 'Updating head first orphans the rest of the list because you lose the pointer to the original first node.',
        C: 'Setting head->next = NULL would sever the rest of the list.',
        D: 'Freeing the old head would destroy the existing first element instead of inserting before it.'
      }
    };
  }

  if (lower.includes('3nf') || lower.includes('third normal') || lower.includes('normalization')) {
    return {
      id: qId,
      question: 'What type of dependency does Third Normal Form (3NF) specifically eliminate?',
      options: [
        { id: 'A', text: 'Repeating groups of non-atomic values' },
        { id: 'B', text: 'Partial dependencies on a composite key' },
        { id: 'C', text: 'Transitive dependencies of non-key attributes on the primary key' },
        { id: 'D', text: 'All foreign key constraints' }
      ],
      correctOptionId: 'C',
      explanation: '3NF requires a table to be in 2NF and have no transitive functional dependencies where a non-key attribute depends on another non-key attribute.',
      hint: '1NF handles atomic values, 2NF handles partial dependencies — what dependency chain remains for 3NF?',
      optionExplanations: {
        A: 'Eliminating repeating groups and ensuring atomic values is the rule for 1NF.',
        B: 'Removing partial functional dependencies on a composite key is the rule for 2NF.',
        D: 'Foreign keys are preserved in normalized relational schemas to maintain referential integrity.'
      }
    };
  }

  return null;
}

module.exports = {
  DISCIPLINES,
  SCOPE_CATEGORIES,
  detectAcademicDiscipline,
  resolveTeachingStrategy,
  classifyAcademicQuestionScope,
  createTeachingState,
  updateTeachingStateOnTurn,
  formatTeachingStatePromptContext,
  generateSubjectAdaptiveCheckpoint,
  generateStructuredMcqForTopic,
  isDeclarativeAtomicProposition,
  parseMcqQuestion,
  extractStudentMcqChoice,
  normalizeUnit,
  isNumericalMatch,
  extractNumericalValueAndUnit,
  evaluateAcademicAnswer
};
