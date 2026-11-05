'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { handleChat } = require('../ai-assistant');
const {
  routeQuery,
  planVisualExplanation,
  validateVisualBlockPayload,
  computeProjectileMetrics,
  computeWaveSamples,
  classifyAcademicQuestion,
  buildDeterministicVisualEnrichment,
  parseKyanaVisualBlock,
  VISUAL_BLOCK_KINDS,
  ACADEMIC_VISUAL_BLOCK_KINDS,
  VISUAL_SECURITY_LIMITS
} = require('../lib/chat-tools');
const {
  stabilizeStreamingMarkdown,
  fallbackMarkdown,
  renderKyanaVisualBlockHtml
} = require('../public/chatbot.js');

const chatbotJsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.js'), 'utf8');
const chatbotCssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.css'), 'utf8');
const postMarkdownSource = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'components', 'PostMarkdown.tsx'), 'utf8');

function extractVisualBlock(reply, kind) {
  const re = new RegExp('```' + kind + '\\n([\\s\\S]*?)```', 'i');
  const m = String(reply || '').match(re);
  return m ? m[1].trim() : null;
}

// ============================================================================
// 1. Cross-Platform Verification & Browser Marked Path Audit
// ============================================================================
test('1. Cross-platform verification: every VISUAL_BLOCK_KIND is supported on Web (both fallbackMarkdown & browser KyanaCodeBlock.enhance) and React Native Mobile', () => {
  for (const kind of ACADEMIC_VISUAL_BLOCK_KINDS) {
    assert.ok(VISUAL_BLOCK_KINDS.has(kind), `lib/chat-tools.js must include '${kind}'`);
    assert.ok(chatbotJsSource.includes(`'${kind}'`), `Web public/chatbot.js must include '${kind}'`);
    assert.ok(postMarkdownSource.includes(`'${kind.toUpperCase()}'`), `Mobile PostMarkdown.tsx must include '${kind.toUpperCase()}'`);
  }

  // Verify browser KyanaCodeBlock.enhance dispatches VISUAL_BLOCK_KINDS when window.marked is used
  assert.ok(
    chatbotJsSource.includes('if (VISUAL_BLOCK_KINDS.has(langKey) || isAsciiFigure)'),
    'Browser KyanaCodeBlock.enhance must replace <pre><code class="language-..."> visual blocks with renderKyanaVisualBlockHtml'
  );
  assert.ok(postMarkdownSource.includes('function KyanaSimulationCard'), 'Mobile must define stateful KyanaSimulationCard');
  assert.ok(postMarkdownSource.includes("simType === 'binary_search'"), 'Mobile KyanaSimulationCard must support binary_search');
  assert.ok(postMarkdownSource.includes('function KyanaCodePreviewCard'), 'Mobile must define stateful KyanaCodePreviewCard');
});

// ============================================================================
// 2. Adversarial Security Audit (9 Attack Vectors)
// ============================================================================
test('2. Adversarial security audit rejects nested HTML, encoded JS, SVG event handlers, malicious URLs, prototype pollution, oversized diagrams, and malformed JSON', () => {
  const adversarialPayloads = [
    // 1. Nested HTML script injection
    { kind: 'code_preview', raw: JSON.stringify({ html: '<<script>script>alert(1)</script>', css: '.a{}' }), desc: 'Nested script tag' },
    // 2. Encoded JavaScript URI
    { kind: 'diagram', raw: JSON.stringify({ title: 'java&#x73;cript:alert(1)', nodes: [{ label: 'A' }] }), desc: 'Hex-encoded javascript URI' },
    { kind: 'diagram', raw: JSON.stringify({ title: '\\u006aavascript:alert(1)', nodes: [{ label: 'A' }] }), desc: 'Unicode-encoded javascript URI' },
    // 3. SVG event handlers (onload, onbegin, ontoggle, foreignObject, animate)
    { kind: 'illustration', raw: JSON.stringify({ sceneType: 'physics', title: '<svg onload=alert(1)>' }), desc: 'SVG onload handler' },
    { kind: 'illustration', raw: JSON.stringify({ sceneType: 'physics', title: '<animate onbegin=alert(1)>' }), desc: 'SVG animate onbegin handler' },
    { kind: 'illustration', raw: JSON.stringify({ sceneType: 'physics', title: '<foreignObject><iframe src="x"></iframe></foreignObject>' }), desc: 'SVG foreignObject' },
    // 4. Malicious URLs (javascript:, data:text/html, vbscript:)
    { kind: 'code_preview', raw: JSON.stringify({ html: '<a href="javascript:evil()">Link</a>', css: '' }), desc: 'javascript: href' },
    { kind: 'code_preview', raw: JSON.stringify({ html: '<a href="data:text/html,<script>evil()</script>">Link</a>', css: '' }), desc: 'data:text/html href' },
    // 5. Prototype pollution payloads (__proto__, constructor, prototype)
    { kind: 'simulation', raw: '{"simulationType":"box_model","__proto__":{"polluted":true}}', desc: '__proto__ pollution' },
    { kind: 'simulation', raw: '{"simulationType":"box_model","constructor":{"prototype":{"polluted":true}}}', desc: 'constructor.prototype pollution' },
    // 6. Oversized diagram (> 24 nodes) and oversized chart (> 50 points)
    {
      kind: 'diagram',
      raw: JSON.stringify({
        title: 'Oversized Diagram',
        nodes: Array.from({ length: VISUAL_SECURITY_LIMITS.MAX_DIAGRAM_NODES + 1 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }))
      }),
      desc: 'Oversized diagram nodes'
    },
    {
      kind: 'graph',
      raw: JSON.stringify({
        title: 'Oversized Chart',
        series: Array.from({ length: VISUAL_SECURITY_LIMITS.MAX_CHART_POINTS + 1 }, (_, i) => ({ label: `P${i}`, value: i }))
      }),
      desc: 'Oversized chart series'
    },
    // 7. Oversized raw byte payload (> 32 KB)
    { kind: 'diagram', raw: 'x'.repeat(VISUAL_SECURITY_LIMITS.MAX_PAYLOAD_BYTES + 100), desc: 'Oversized 32KB+ payload' },
    // 8. Malformed JSON
    { kind: 'simulation', raw: '{"simulationType": "box_model", [broken', desc: 'Malformed JSON' },
    // 9. Unknown component type
    { kind: 'raw_html_widget', raw: JSON.stringify({ html: '<div>bad</div>' }), desc: 'Unknown component type' }
  ];

  for (const item of adversarialPayloads) {
    const res = validateVisualBlockPayload(item.kind, item.raw);
    assert.equal(res.valid, false, `Expected validator to reject ${item.desc}`);
    const webHtml = renderKyanaVisualBlockHtml(item.kind, item.raw);
    assert.equal(webHtml, '', `Expected Web renderer to return empty string for ${item.desc}`);
  }
  assert.equal(({}).polluted, undefined, 'Object.prototype must never be polluted');
});

// ============================================================================
// 3. Academic Accuracy & Visual Decision Evaluation (32 Real Questions Across 8 Disciplines)
// ============================================================================
test('3. Academic accuracy: 32 real academic questions across HTML/CSS, JS, DBMS, Networks, DSA, OS, Physics, and Math select appropriate visuals or concise text', () => {
  const benchmarkQuestions = [
    // HTML / CSS (4)
    { q: 'What is a CSS selector?', expectVisual: true, expectedType: 'code_preview', discipline: 'web_development' },
    { q: 'Explain CSS box model', expectVisual: true, expectedType: 'simulation', discipline: 'web_development' },
    { q: 'How does CSS flexbox work?', expectVisual: true, expectedType: 'code_preview', discipline: 'web_development' },
    { q: 'What does HTML stand for?', expectVisual: false, expectedType: null, discipline: 'computer_science' },

    // JavaScript & Programming (4)
    { q: 'Explain recursion in C', expectVisual: true, expectedType: 'trace', discipline: 'computer_science' },
    { q: 'Implement linked lists in C++', expectVisual: true, expectedType: 'trace', discipline: 'computer_science' },
    { q: 'Difference between Compiler and Interpreter', expectVisual: true, expectedType: 'comparison_table', discipline: 'computer_science' },
    { q: 'Who invented C?', expectVisual: false, expectedType: null, discipline: 'computer_science' },

    // DBMS (4)
    { q: 'Explain DBMS normalization', expectVisual: true, expectedType: 'comparison', discipline: 'database' },
    { q: 'Explain 1NF, 2NF, and 3NF in DBMS', expectVisual: true, expectedType: 'comparison', discipline: 'database' },
    { q: 'What is an ER diagram in DBMS?', expectVisual: true, expectedType: 'diagram', discipline: 'computer_science' },
    { q: 'Give me an overview of Database Management System', expectVisual: true, expectedType: 'syllabus', discipline: 'computer_science' },

    // Computer Networks (4)
    { q: 'What is HTTP?', expectVisual: true, expectedType: 'diagram', discipline: 'networking' },
    { q: 'Explain session and cookies', expectVisual: true, expectedType: 'diagram', discipline: 'networking' },
    { q: 'What is an API?', expectVisual: true, expectedType: 'diagram', discipline: 'networking' },
    { q: 'Difference between TCP and UDP', expectVisual: true, expectedType: 'comparison_table', discipline: 'computer_science' },

    // Data Structures & Algorithms (4)
    { q: 'Explain binary search', expectVisual: true, expectedType: 'simulation', discipline: 'computer_science' },
    { q: 'Why is binary search O(log n)?', expectVisual: true, expectedType: 'simulation', discipline: 'computer_science' },
    { q: 'Explain merge sort', expectVisual: true, expectedType: 'trace', discipline: 'computer_science' },
    { q: 'How does Dijkstra algorithm work?', expectVisual: true, expectedType: 'trace', discipline: 'computer_science' },

    // Operating Systems & Computer Architecture (4)
    { q: 'Explain deadlock in operating system', expectVisual: true, expectedType: 'diagram', discipline: 'computer_science' },
    { q: 'Explain paging in operating system', expectVisual: true, expectedType: 'diagram', discipline: 'computer_science' },
    { q: 'Difference between RAM and ROM', expectVisual: true, expectedType: 'comparison_table', discipline: 'computer_science' },
    { q: 'Explain CPU and ALU architecture', expectVisual: true, expectedType: 'diagram', discipline: 'engineering' },

    // Physics (4)
    { q: 'Explain projectile motion', expectVisual: true, expectedType: 'simulation', discipline: 'physics' },
    { q: 'Explain electromagnetic induction', expectVisual: true, expectedType: 'illustration', discipline: 'physics' },
    { q: "Explain Ohm's law", expectVisual: true, expectedType: 'diagram', discipline: 'physics' },
    { q: 'Explain wave frequency and amplitude', expectVisual: true, expectedType: 'simulation', discipline: 'physics' },

    // Mathematics (4)
    { q: 'Solve a differential equation dy/dx + 2y = 0', expectVisual: false, expectedType: null, discipline: 'mathematics' },
    { q: 'Explain normal distribution in probability', expectVisual: true, expectedType: 'graph', discipline: 'mathematics' },
    { q: 'Plot a bar chart of semester credits', expectVisual: true, expectedType: 'graph', discipline: 'computer_science' },
    { q: 'What is 2 + 2?', expectVisual: false, expectedType: null, discipline: 'computer_science' }
  ];

  assert.equal(benchmarkQuestions.length, 32);
  for (const item of benchmarkQuestions) {
    const route = routeQuery(item.q);
    const plan = planVisualExplanation(item.q, route);
    assert.equal(plan.needsVisual, item.expectVisual, `Mismatch on needsVisual for "${item.q}"`);
    assert.equal(plan.primaryVisualType, item.expectedType, `Mismatch on primaryVisualType for "${item.q}"`);
    assert.equal(plan.discipline, item.discipline, `Mismatch on discipline for "${item.q}"`);
  }
});

// ============================================================================
// 4. Streaming, Persistence, and Reload Integrity
// ============================================================================
test('4. Streaming and persistence: no incomplete JSON flashes, no duplicate visual blocks, and persisted markdown reloads identically', async () => {
  const projEnrich = buildDeterministicVisualEnrichment('Explain projectile motion', classifyAcademicQuestion('Explain projectile motion'));
  const fullPersistedMessage = [
    'Projectile motion follows a parabolic trajectory under constant gravitational acceleration $g = 9.8\\text{ m/s}^2$.',
    projEnrich
  ].join('');

  // Verify no duplicate visual blocks when enrichment is called again on an already-enriched message
  const secondPass = buildDeterministicVisualEnrichment('Explain projectile motion', classifyAcademicQuestion('Explain projectile motion'), fullPersistedMessage);
  assert.equal(secondPass, '', 'Must never duplicate visual blocks on already-enriched replies');

  // Step through streaming chunks every 30 chars -> never flashes raw JSON key "simulationType" or "trajectoryPoints"
  for (let i = 20; i < fullPersistedMessage.length; i += 30) {
    const partial = fullPersistedMessage.slice(0, i);
    const stabilized = stabilizeStreamingMarkdown(partial);
    const html = fallbackMarkdown(stabilized);
    assert.ok(!html.includes('"trajectoryPoints"'), `Streaming chunk at index ${i} must not flash raw JSON`);
  }

  // Verify full persisted message reloads identically after page refresh / app reopen
  const reloadedHtml = fallbackMarkdown(fullPersistedMessage);
  assert.ok(reloadedHtml.includes('kyana-simulation-card'), 'Persisted simulation block must render on reload');
  assert.ok(reloadedHtml.includes('kyana-illustration-card'), 'Persisted illustration block must render on reload');
  assert.ok(reloadedHtml.includes('63.78 m'), 'Deterministic projectile range must render on reload');
});

// ============================================================================
// 5. Performance Benchmarks (Decision, Validation, Diagram, Chart & Simulation Rendering)
// ============================================================================
test('5. Performance benchmarks: visual decision, validation, diagram, chart, and simulation rendering complete well under sub-5ms budgets', () => {
  const iterations = 100;

  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    planVisualExplanation('Explain projectile motion');
    planVisualExplanation('What is a CSS selector?');
    planVisualExplanation('What does HTML stand for?');
  }
  const avgDecisionMs = (performance.now() - t0) / (iterations * 3);

  const d0 = performance.now();
  const sampleDiagram = extractVisualBlock(buildDeterministicVisualEnrichment('What is HTTP?', classifyAcademicQuestion('What is HTTP?')), 'diagram');
  for (let i = 0; i < iterations; i++) {
    renderKyanaVisualBlockHtml('diagram', sampleDiagram);
  }
  const avgDiagramMs = (performance.now() - d0) / iterations;

  const c0 = performance.now();
  const sampleChart = JSON.stringify({
    chartType: 'vertical_bar',
    title: 'Benchmark Chart',
    series: [{ label: 'A', value: 10 }, { label: 'B', value: 25 }, { label: 'C', value: 40 }, { label: 'D', value: 30 }]
  });
  for (let i = 0; i < iterations; i++) {
    renderKyanaVisualBlockHtml('graph', sampleChart);
  }
  const avgChartMs = (performance.now() - c0) / iterations;

  const s0 = performance.now();
  const sampleSim = extractVisualBlock(buildDeterministicVisualEnrichment('Explain projectile motion', classifyAcademicQuestion('Explain projectile motion')), 'simulation');
  for (let i = 0; i < iterations; i++) {
    renderKyanaVisualBlockHtml('simulation', sampleSim);
  }
  const avgSimMs = (performance.now() - s0) / iterations;

  assert.ok(avgDecisionMs < 2.0, `Expected avgDecisionMs < 2ms, got ${avgDecisionMs.toFixed(3)}ms`);
  assert.ok(avgDiagramMs < 5.0, `Expected avgDiagramMs < 5ms, got ${avgDiagramMs.toFixed(3)}ms`);
  assert.ok(avgChartMs < 5.0, `Expected avgChartMs < 5ms, got ${avgChartMs.toFixed(3)}ms`);
  assert.ok(avgSimMs < 5.0, `Expected avgSimMs < 5ms, got ${avgSimMs.toFixed(3)}ms`);
});
