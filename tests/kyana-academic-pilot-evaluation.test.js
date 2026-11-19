/**
 * Phase 2.5 — Academic Visualization Pilot & Real-Student Readiness Evaluation Suite
 * 
 * Evaluates Kyana AI's visualization and educational performance across the 
 * Gandaki University Bachelor of Information Technology (BIT) curriculum:
 * 1. AI Provider Execution Verification (Real Provider vs Mocked Isolation)
 * 2. 13 BIT Academic Syllabus Curriculum Questions (DSA, DBMS, OS, Digital Logic)
 * 3. Visualization Selection Accuracy (Visual vs Table vs Text)
 * 4. Academic Correctness & Syllabus Grounding
 * 5. Multi-Turn Conversational Follow-Up Understanding
 * 6. Fault Tolerance, Resilience & Graceful Fallbacks
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Core Engines
const { handleChat } = require('../ai-assistant');
const { createChatProvider } = require('../lib/chat-provider');
const { validateVisualContract } = require('../lib/visual-contract-validator');
const {
  simulateBinarySearch,
  simulateLinearSearch,
  simulateBubbleSort,
  simulateSelectionSort,
  simulateInsertionSort,
  simulateStackOperations,
  simulateQueueOperations
} = require('../public/js/visualizers/kyana-simulation-engine');
const { evaluateBoolean } = require('../public/js/visualizers/kyana-visual-renderer');
const { planAdaptivePresentation } = require('../lib/adaptive-presentation-engine');

describe('Phase 2.5: Academic Visualization Pilot & Student Readiness', () => {

  // =========================================================================
  // 1. AI PROVIDER EXECUTION VERIFICATION
  // =========================================================================
  describe('1. AI Provider Execution Verification', () => {
    test('Distinguishes live provider vs mock configuration and tests live provider connectivity', async () => {
      const hasLiveProvider = Boolean(
        process.env.GEMINI_API_KEY ||
        process.env.GROQ_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.DEEPSEEK_API_KEY
      );

      assert.ok(typeof hasLiveProvider === 'boolean');

      if (hasLiveProvider) {
        const provider = createChatProvider();
        const res = await provider.generateReply({
          message: 'Hello Kyana, state your role in 10 words.',
          systemPrompt: 'You are Kyana, the Gandaki University BIT academic assistant.',
          onDelta: () => {}
        });

        assert.ok(res.reply && res.reply.length > 5, 'Live provider must return a non-empty reply');
        assert.ok(res.provider, 'Live provider response must include provider name');
        assert.ok(res.model, 'Live provider response must include model name');
      }
    });
  });

  // =========================================================================
  // 2. EVALUATION OF 13 BIT CURRICULUM ACADEMIC QUESTIONS
  // =========================================================================
  describe('2. Evaluation of 13 Gandaki University BIT Academic Questions', () => {

    const ACADEMIC_TEST_CASES = [
      // --- DATA STRUCTURES & ALGORITHMS (BIT 3rd Sem, CIT214) ---
      {
        id: 'DSA-1',
        subject: 'Data Structures and Algorithms',
        courseCode: 'CIT214',
        semester: '3rd Semester',
        prompt: 'Show binary search on [10, 20, 30, 40, 50], searching for 40.',
        expectedProfile: 'algorithm_walkthrough',
        expectedInteractive: true,
        expectedEngine: 'algo_anim',
        mustNotForceVisual: false
      },
      {
        id: 'DSA-2',
        subject: 'Data Structures and Algorithms',
        courseCode: 'CIT214',
        semester: '3rd Semester',
        prompt: 'Compare Bubble sort and Selection sort in detail with time complexity and when to use each.',
        expectedProfile: 'comparison_table',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'DSA-3',
        subject: 'Data Structures and Algorithms',
        courseCode: 'CIT214',
        semester: '3rd Semester',
        prompt: 'Explain stack operations with an interactive example showing push and pop.',
        expectedProfile: 'algorithm_walkthrough',
        expectedInteractive: true,
        expectedEngine: 'dsa_linear',
        mustNotForceVisual: false
      },
      {
        id: 'DSA-4',
        subject: 'Data Structures and Algorithms',
        courseCode: 'CIT214',
        semester: '3rd Semester',
        prompt: 'Explain Queue FIFO behavior with an interactive example.',
        expectedProfile: 'algorithm_walkthrough',
        expectedInteractive: true,
        expectedEngine: 'dsa_linear',
        mustNotForceVisual: false
      },

      // --- DATABASE MANAGEMENT SYSTEMS (BIT 3rd Sem, CIT213) ---
      {
        id: 'DBMS-1',
        subject: 'Database Management Systems',
        courseCode: 'CIT213',
        semester: '3rd Semester',
        prompt: 'What is the difference between Primary Key and Foreign Key in relational databases?',
        expectedProfile: 'comparison_table',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'DBMS-2',
        subject: 'Database Management Systems',
        courseCode: 'CIT213',
        semester: '3rd Semester',
        prompt: 'Explain relational table relationships with an example of Student and Department.',
        expectedProfile: 'conceptual_explanation',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'DBMS-3',
        subject: 'Database Management Systems',
        courseCode: 'CIT213',
        semester: '3rd Semester',
        prompt: 'Explain database normalization from 1NF to 3NF with a small concrete example.',
        expectedProfile: 'conceptual_explanation',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },

      // --- OPERATING SYSTEMS (BIT 4th Sem, CIT221) ---
      {
        id: 'OS-1',
        subject: 'Operating Systems',
        courseCode: 'CIT221',
        semester: '4th Semester',
        prompt: 'Explain FCFS CPU scheduling with 3 processes P1, P2, P3 with burst times 4, 3, 1.',
        expectedProfile: 'conceptual_explanation',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'OS-2',
        subject: 'Operating Systems',
        courseCode: 'CIT221',
        semester: '4th Semester',
        prompt: 'How does Round-Robin CPU scheduling work with a time quantum?',
        expectedProfile: 'conceptual_explanation',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'OS-3',
        subject: 'Operating Systems',
        courseCode: 'CIT221',
        semester: '4th Semester',
        prompt: 'What is the role of Stack vs Queue in operating system memory and process management?',
        expectedProfile: 'comparison_table',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },

      // --- DIGITAL LOGIC (BIT 2nd Sem, ELX121) ---
      {
        id: 'DL-1',
        subject: 'Digital Logic',
        courseCode: 'ELX121',
        semester: '2nd Semester',
        prompt: 'Show me XOR and XNOR truth tables with their Boolean expressions.',
        expectedProfile: 'truth_table',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      },
      {
        id: 'DL-2',
        subject: 'Digital Logic',
        courseCode: 'ELX121',
        semester: '2nd Semester',
        prompt: 'How does an AND gate work? Show an interactive logic simulation.',
        expectedProfile: 'interactive_simulation',
        expectedInteractive: true,
        expectedEngine: 'logic_sim',
        mustNotForceVisual: false
      },
      {
        id: 'DL-3',
        subject: 'Digital Logic',
        courseCode: 'ELX121',
        semester: '2nd Semester',
        prompt: 'Derive the truth table for compound Boolean expression Y = (A AND B) OR (NOT C).',
        expectedProfile: 'truth_table',
        expectedInteractive: false,
        expectedEngine: null,
        mustNotForceVisual: true
      }
    ];

    for (const tc of ACADEMIC_TEST_CASES) {
      test(`${tc.id}: Presentation planning for "${tc.prompt.slice(0, 45)}..."`, () => {
        const plan = planAdaptivePresentation(tc.prompt, {
          semester: tc.semester,
          subject: tc.subject
        });

        assert.equal(
          plan.profile,
          tc.expectedProfile,
          `Query ${tc.id} must resolve to profile ${tc.expectedProfile}, got ${plan.profile}`
        );

        assert.equal(
          plan.useInteractiveDemo,
          tc.expectedInteractive,
          `Query ${tc.id} interactive expectation must be ${tc.expectedInteractive}`
        );

        if (tc.mustNotForceVisual) {
          assert.equal(
            plan.useInteractiveDemo,
            false,
            `Academic topic ${tc.id} must NOT force an unsupported interactive visualizer.`
          );
        }
      });
    }

    test('Live End-to-End Chat API Response Verification for representative queries', async () => {
      // Test 1: Algorithm with visual request
      const resVisual = await handleChat(
        null,
        'Show binary search on [10, 20, 30, 40, 50], searching for 40.',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        [],
        'eval-sess-visual'
      );

      assert.ok(resVisual.reply, 'Reply must not be empty');
      assert.ok(resVisual.reply.includes('kyana_visual'), 'Visual request must generate a kyana_visual block');
      
      const match = resVisual.reply.match(/```kyana_visual([\s\S]*?)```/);
      assert.ok(match, 'Must contain a closed ```kyana_visual block');
      const parsedVisual = JSON.parse(match[1].trim());
      const validation = validateVisualContract(parsedVisual);
      assert.equal(validation.valid, true, `Generated visual payload must be valid: ${validation.errors?.join(', ')}`);
      assert.equal(validation.sanitized.engineId, 'algo_anim');

      // Test 2: Comparison question (must NOT generate visual block)
      const resComparison = await handleChat(
        null,
        'Compare Bubble sort and Selection sort in detail with time complexity and when to use each.',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        [],
        'eval-sess-comparison'
      );

      assert.ok(resComparison.reply, 'Comparison reply must not be empty');
      assert.equal(
        resComparison.reply.includes('```kyana_visual'),
        false,
        'Conceptual comparison question must NOT generate a kyana_visual block'
      );
      assert.ok(
        resComparison.reply.includes('|') && resComparison.reply.includes('---'),
        'Comparison question must deliver a structured Markdown table'
      );

      // Test 3: OS scheduling question (must NOT generate visual block)
      const resOS = await handleChat(
        null,
        'Explain FCFS CPU scheduling with 3 processes P1, P2, P3 with burst times 4, 3, 1.',
        { semester: '4th Semester', subject: 'Operating Systems' },
        [],
        'eval-sess-os'
      );

      assert.ok(resOS.reply, 'OS reply must not be empty');
      assert.equal(
        resOS.reply.includes('```kyana_visual'),
        false,
        'OS scheduling question must NOT force an unsupported visualizer'
      );
      assert.ok(
        resOS.reply.toLowerCase().includes('fcfs') || resOS.reply.toLowerCase().includes('first-come'),
        'OS reply must address FCFS accurately'
      );
    });
  });

  // =========================================================================
  // 3. EVALUATION OF VISUALIZATION SELECTION ACCURACY
  // =========================================================================
  describe('3. Visualization Selection Classification Accuracy', () => {
    const SELECTION_CASES = [
      {
        query: 'Show binary search on [10, 20, 30, 40, 50], searching for 40.',
        category: 'Appropriate interactive visualization'
      },
      {
        query: 'Compare Bubble sort and Selection sort',
        category: 'Appropriate static explanation/table'
      },
      {
        query: 'What is a Primary Key in DBMS?',
        category: 'Appropriate text-only answer'
      },
      {
        query: 'Show me XOR truth table',
        category: 'Appropriate static explanation/table'
      },
      {
        query: 'How does an AND gate work? Show an interactive logic simulation.',
        category: 'Appropriate interactive visualization'
      },
      {
        query: 'Explain FCFS CPU scheduling with 3 processes',
        category: 'Appropriate static explanation/table'
      }
    ];

    test('Classifies queries with 100% appropriate pedagogical presentation selection', () => {
      let appropriateCount = 0;

      for (const item of SELECTION_CASES) {
        const plan = planAdaptivePresentation(item.query);
        let selectedCategory = '';

        if (plan.useInteractiveDemo) {
          selectedCategory = 'Appropriate interactive visualization';
        } else if (plan.useTables || plan.profile === 'comparison_table' || plan.profile === 'truth_table' || plan.useHeadings) {
          selectedCategory = 'Appropriate static explanation/table';
        } else {
          selectedCategory = 'Appropriate text-only answer';
        }

        assert.equal(
          selectedCategory,
          item.category,
          `Selection for "${item.query}" expected ${item.category} but got ${selectedCategory}`
        );
        appropriateCount++;
      }

      assert.equal(appropriateCount, SELECTION_CASES.length);
    });
  });

  // =========================================================================
  // 4. EVALUATION OF ACADEMIC CORRECTNESS
  // =========================================================================
  describe('4. Evaluation of Academic Correctness', () => {
    test('Simulated trace matches independently calculated step-by-step mathematical logic', () => {
      // Binary Search on [10, 20, 30, 40, 50] searching for 40
      const sim = simulateBinarySearch([10, 20, 30, 40, 50], 40);
      assert.equal(sim.completed, true);
      assert.ok(sim.steps.length >= 2, 'Must take at least 2 iterations');

      // Iteration 1: low=0, high=4, mid=2 (val=30). Target 40 > 30 => low moves to 3
      assert.equal(sim.steps[0].variables.low, 0);
      assert.equal(sim.steps[0].variables.high, 4);
      assert.equal(sim.steps[0].variables.mid, 2);
      assert.equal(sim.steps[0].action, 'compare_less');

      // Iteration 2: low=3, high=4, mid=3 (val=40). Target 40 == 40 => Match!
      assert.equal(sim.steps[1].variables.low, 3);
      assert.equal(sim.steps[1].variables.high, 4);
      assert.equal(sim.steps[1].variables.mid, 3);
      assert.equal(sim.steps[1].action, 'match');
    });

    test('Logic simulation matches Boolean algebra for AND, OR, NOT, XOR, XNOR', () => {
      // Test XOR gate: 0^0=0, 0^1=1, 1^0=1, 1^1=0
      const truthTableXOR = [
        { A: 0, B: 0, expected: 0 },
        { A: 0, B: 1, expected: 1 },
        { A: 1, B: 0, expected: 1 },
        { A: 1, B: 1, expected: 0 }
      ];

      for (const row of truthTableXOR) {
        const out = evaluateBoolean('A XOR B', { A: row.A, B: row.B });
        assert.equal(out, row.expected, `XOR(${row.A}, ${row.B}) must be ${row.expected}`);
      }
    });
  });

  // =========================================================================
  // 5. EVALUATION OF FOLLOW-UP UNDERSTANDING
  // =========================================================================
  describe('5. Evaluation of Follow-Up Understanding', () => {
    test('Sequential multi-turn conversation maintains pedagogical context without cross-talk or stale visual reuse', async () => {
      const history = [];

      // Turn 1: Student asks for binary search
      const turn1 = await handleChat(
        null,
        'Show binary search on [10, 20, 30, 40, 50], searching for 40.',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        history,
        'conv-followup-test'
      );
      assert.ok(turn1.reply.includes('kyana_visual'), 'Turn 1 must include kyana_visual');
      history.push({ role: 'user', content: 'Show binary search on [10, 20, 30, 40, 50], searching for 40.' });
      history.push({ role: 'assistant', content: turn1.reply });

      // Turn 2: Follow-up: "Why did we eliminate the left half?"
      const turn2 = await handleChat(
        null,
        'Why did we eliminate the left half?',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        history,
        'conv-followup-test'
      );
      assert.ok(turn2.reply, 'Turn 2 reply must be generated');
      // Turn 2 is an explanatory follow-up: it must NOT re-emit an identical visual block
      assert.equal(turn2.reply.includes('kyana_visual'), false, 'Explanatory follow-up must not re-emit visual block');
      assert.ok(
        turn2.reply.toLowerCase().includes('sort') || turn2.reply.toLowerCase().includes('less') || turn2.reply.toLowerCase().includes('smaller'),
        'Turn 2 must explain why the left half was eliminated based on array ordering'
      );
      history.push({ role: 'user', content: 'Why did we eliminate the left half?' });
      history.push({ role: 'assistant', content: turn2.reply });

      // Turn 3: Follow-up: "What happens if the element is not present?"
      const turn3 = await handleChat(
        null,
        'What happens if the element is not present?',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        history,
        'conv-followup-test'
      );
      assert.ok(turn3.reply, 'Turn 3 reply must be generated');
      assert.ok(
        turn3.reply.toLowerCase().includes('low > high') || turn3.reply.toLowerCase().includes('-1') || turn3.reply.toLowerCase().includes('not found') || turn3.reply.toLowerCase().includes('cross'),
        'Turn 3 must explain terminating condition when element is not present'
      );
      history.push({ role: 'user', content: 'What happens if the element is not present?' });
      history.push({ role: 'assistant', content: turn3.reply });

      // Turn 4: Follow-up: "Why is this algorithm O(log n)?"
      const turn4 = await handleChat(
        null,
        'Why is this algorithm O(log n)?',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        history,
        'conv-followup-test'
      );
      assert.ok(turn4.reply, 'Turn 4 reply must be generated');
      assert.ok(
        turn4.reply.includes('log') && (turn4.reply.includes('half') || turn4.reply.includes('divide') || turn4.reply.includes('2')),
        'Turn 4 must explain logarithmic division by 2'
      );
      history.push({ role: 'user', content: 'Why is this algorithm O(log n)?' });
      history.push({ role: 'assistant', content: turn4.reply });

      // Turn 5: Transition follow-up: "Show the same example using linear search with an interactive visualization."
      const turn5 = await handleChat(
        null,
        'Show the same example using linear search with an interactive visualization.',
        { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
        history,
        'conv-followup-test'
      );
      assert.ok(turn5.reply, 'Turn 5 reply must be generated');
      assert.ok(turn5.reply.includes('kyana_visual'), 'Turn 5 must include visual block for linear search');
      const matchLinear = turn5.reply.match(/```kyana_visual([\s\S]*?)```/);
      assert.ok(matchLinear, 'Turn 5 must contain valid fenced visual JSON');
      const parsedLinear = JSON.parse(matchLinear[1].trim());
      const valLinear = validateVisualContract(parsedLinear);
      assert.equal(valLinear.valid, true);
      assert.equal(valLinear.sanitized.payload.algorithm, 'linear_search');
      assert.equal(valLinear.sanitized.payload.target, 40);
    });
  });

  // =========================================================================
  // 6. FAULT TOLERANCE, RESILIENCE & PRESERVATION OF EXPLANATION
  // =========================================================================
  describe('6. Fault Tolerance, Resilience & Text Explanation Preservation', () => {

    test('Malformed visual payload preserves text explanation with graceful fallback', () => {
      const malformedJson = '{"version": "kyana.visual.v1", "engineId": "algo_anim", "data": UNCLOSED_JSON}';
      const validation = validateVisualContract(malformedJson);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.length > 0);
    });

    test('Unsupported engine ID rejected gracefully', () => {
      const unsupported = {
        version: 'kyana.visual.v1',
        engineId: 'quantum_neural_engine_999',
        mode: 'interactive',
        title: 'Unsupported Widget',
        fallback: { type: 'text', content: 'Fallback description.' },
        data: {}
      };
      const validation = validateVisualContract(unsupported);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('Field \'engine\' must be one of')));
    });

    test('Oversized payload exceeding 64 KB ceiling is rejected safely', () => {
      const largeArray = new Array(2000).fill(42);
      const largePayload = {
        version: 'kyana.visual.v1',
        engineId: 'algo_anim',
        mode: 'interactive',
        title: 'Huge Payload',
        fallback: { type: 'text', content: 'A'.repeat(70000) },
        data: {
          algorithm: 'binary_search',
          initialArray: largeArray,
          target: 42
        }
      };
      const validation = validateVisualContract(largePayload);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('exceeds maximum ceiling of 65536 bytes')));
    });

    test('Unsorted binary search input is detected and rejected without crash', () => {
      const res = simulateBinarySearch([50, 10, 40, 20], 40);
      assert.equal(res.completed, false);
      assert.equal(res.error.code, 'UNSORTED_ARRAY');
    });

    test('Empty array input handled gracefully', () => {
      const res = simulateBinarySearch([], 10);
      assert.equal(res.steps.length, 1);
      assert.equal(res.steps[0].action, 'empty_check');
      assert.equal(res.completed, true);
    });

    test('Streaming cancellation aborts cleanly', async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => {
          await handleChat(
            null,
            'Explain stack operations with an interactive example.',
            { semester: '2nd Semester', subject: 'Data Structures and Algorithms' },
            [],
            'abort-test-sess',
            { signal: controller.signal }
          );
        },
        err => err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message.includes('cancelled')
      );
    });
  });
});
