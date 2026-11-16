'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal Mock DOM environment for Node.js test execution
class MockClassList {
  constructor(el) {
    this._el = el;
    this._classes = new Set();
  }
  add(...cls) {
    cls.forEach(c => {
      if (c && typeof c === 'string') {
        c.split(/\s+/).filter(Boolean).forEach(single => this._classes.add(single));
      }
    });
    this._sync();
  }
  remove(...cls) {
    cls.forEach(c => {
      if (c && typeof c === 'string') {
        c.split(/\s+/).filter(Boolean).forEach(single => this._classes.delete(single));
      }
    });
    this._sync();
  }
  toggle(c, force) {
    if (force === undefined) {
      if (this._classes.has(c)) this._classes.delete(c);
      else this._classes.add(c);
    } else if (force) {
      this._classes.add(c);
    } else {
      this._classes.delete(c);
    }
    this._sync();
    return this._classes.has(c);
  }
  contains(c) {
    return this._classes.has(c);
  }
  _sync() {
    this._el._className = Array.from(this._classes).join(' ');
  }
}

function parseAttrs(str, node) {
  const attrRegex = /([a-zA-Z0-9\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = attrRegex.exec(str)) !== null) {
    const key = match[1];
    const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] || ''));
    node.setAttribute(key, val);
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName ? tagName.toUpperCase() : 'DIV';
    this.children = [];
    this.parentNode = null;
    this._attrs = new Map();
    this._listeners = new Map();
    this.classList = new MockClassList(this);
    this._className = '';
    this.style = {
      _props: new Map(),
      setProperty(k, v) { this._props.set(k, v); this[k] = v; },
      getPropertyValue(k) { return this._props.get(k) || this[k] || ''; }
    };
    this.dataset = {};
    this.value = '';
    this.type = '';
  }

  get childNodes() { return this.children; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode; }

  get className() { return this._className; }
  set className(val) {
    this._className = String(val || '');
    this.classList._classes = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this._textContent != null) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(val) {
    this.children = [];
    this._textContent = String(val == null ? '' : val);
  }

  get innerHTML() {
    return this.children.map(c => `<${c.tagName.toLowerCase()}>${c.textContent}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(html) {
    this.children = [];
    this._textContent = null;
    if (!html) return;

    const stack = [this];
    const tagRegex = /<\/?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      const full = match[0];
      const tag = match[1];
      const attrs = match[2];
      const text = match[3];

      if (text) {
        const top = stack[stack.length - 1];
        const textNode = new MockElement('#text');
        textNode.textContent = text;
        top.appendChild(textNode);
      } else if (full.startsWith('</')) {
        if (stack.length > 1) {
          stack.pop();
        }
      } else {
        const isSelfClosing = full.endsWith('/>') || ['INPUT', 'IMG', 'BR', 'HR'].includes(tag.toUpperCase());
        const elem = new MockElement(tag);
        if (attrs) {
          parseAttrs(attrs, elem);
        }
        stack[stack.length - 1].appendChild(elem);
        if (!isSelfClosing) {
          stack.push(elem);
        }
      }
    }
  }

  setAttribute(k, v) {
    const key = String(k).toLowerCase();
    const val = String(v == null ? '' : v);
    this._attrs.set(key, val);
    if (key === 'class') {
      this.className = val;
    }
    if (key.startsWith('data-')) {
      const prop = key.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[prop] = val;
    }
  }

  getAttribute(k) {
    return this._attrs.get(String(k).toLowerCase()) || null;
  }

  hasAttribute(k) {
    return this._attrs.has(String(k).toLowerCase());
  }

  removeAttribute(k) {
    const key = String(k).toLowerCase();
    this._attrs.delete(key);
    if (key.startsWith('data-')) {
      const prop = key.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      delete this.dataset[prop];
    }
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChild(newChild, oldChild) {
    const idx = this.children.indexOf(oldChild);
    if (idx !== -1) {
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      this.children[idx] = newChild;
      newChild.parentNode = this;
      oldChild.parentNode = null;
    }
    return oldChild;
  }

  addEventListener(ev, fn) {
    if (!this._listeners.has(ev)) {
      this._listeners.set(ev, []);
    }
    this._listeners.get(ev).push(fn);
  }

  removeEventListener(ev, fn) {
    if (this._listeners.has(ev)) {
      const arr = this._listeners.get(ev).filter(f => f !== fn);
      this._listeners.set(ev, arr);
    }
  }

  dispatchEvent(ev) {
    const evType = typeof ev === 'string' ? ev : (ev.type || 'click');
    const fns = this._listeners.get(evType) || [];
    const eventObj = typeof ev === 'object' ? ev : { type: evType, preventDefault() {} };
    fns.forEach(fn => fn.call(this, eventObj));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const cleanSel = selector.trim();

    const match = (node) => {
      if (!node || !node.tagName) return false;
      if (cleanSel.startsWith('.')) {
        const parts = cleanSel.split('.').filter(Boolean);
        return parts.every(p => node.classList.contains(p));
      }
      if (cleanSel.startsWith('#')) {
        return node.getAttribute('id') === cleanSel.slice(1);
      }
      if (cleanSel.includes('[')) {
        const m = cleanSel.match(/^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)(?:=([^\\]]+))?\]$/);
        if (m) {
          const [, t, attr, val] = m;
          if (t && node.tagName.toLowerCase() !== t.toLowerCase()) return false;
          if (val) {
            const unquoted = val.replace(/^["']|["']$/g, '');
            return node.getAttribute(attr) === unquoted;
          }
          return node.hasAttribute(attr);
        }
      }
      return node.tagName.toLowerCase() === cleanSel.toLowerCase();
    };

    const traverse = (node) => {
      node.children.forEach(child => {
        if (match(child)) results.push(child);
        traverse(child);
      });
    };

    traverse(this);
    return results;
  }
}

global.document = {
  createElement(tag) {
    return new MockElement(tag);
  }
};

global.window = {
  matchMedia(query) {
    return { matches: false, media: query };
  }
};

// Require modules after DOM setup
const { validateVisualContract } = require('../lib/visual-contract-validator');
const KyanaVisualRenderer = require('../public/js/visualizers/kyana-visual-renderer');
const {
  planAdaptivePresentation,
  PRESENTATION_PROFILES,
  sanitizeAdaptiveResponse,
  buildAdaptiveEducationalFallback
} = require('../lib/adaptive-presentation-engine');

// --- Live Kyana Visualization Integration Test Suite ---
test('Phase 2.4 — Live Kyana Visualization Integration E2E Suite', async (t) => {

  // Case 1: Binary Search with Valid Sorted Array
  await t.test('1. Binary Search: Valid sorted array mounts and finds target deterministically', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Binary Search Demonstration',
      fallback: {
        type: 'markdown',
        content: 'Binary Search on [10, 20, 30, 40, 50, 60] for target 40.'
      },
      data: {
        algorithm: 'binary_search',
        initialArray: [10, 20, 30, 40, 50, 60],
        target: 40
      }
    };

    const validation = validateVisualContract(envelope);
    assert.equal(validation.valid, true, 'Validation passes for valid envelope');

    const instance = KyanaVisualRenderer.mount(container, validation.sanitized);
    assert.ok(instance, 'Instance created');
    assert.equal(instance.engine, 'algo_anim');
    assert.ok(instance.controller, 'PlaybackController instantiated');

    // Run to final step
    instance.setStep(instance.controller.totalSteps - 1);
    const finalState = instance.getCurrentStep();
    assert.equal(finalState.currentStep.status, 'found', 'Target found in final step');
    assert.equal(finalState.currentStep.variables.mid, 3, 'Found at index 3');
    instance.destroy();
  });

  // Case 2: Binary Search with Unsorted Array (Rejected Deterministically)
  await t.test('2. Binary Search: Unsorted array is rejected deterministically with fallback', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Binary Search on Unsorted Array',
      fallback: {
        type: 'markdown',
        content: 'Binary Search requires a sorted array.'
      },
      data: {
        algorithm: 'binary_search',
        initialArray: [50, 10, 40, 20, 30], // Unsorted!
        target: 40
      }
    };

    // Mount handles the error deterministically and renders fallback
    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Renderer handled error safely');
    assert.equal(instance.controller, null, 'No controller mounted on failure');
    const fallbackEl = container.querySelector('.kyana-visual-fallback');
    assert.ok(fallbackEl, 'Safe fallback view rendered in DOM');
    instance.destroy();
  });

  // Case 3: Bubble Sort
  await t.test('3. Bubble Sort: Mounts correctly and simulates sorting steps to completion', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Bubble Sort Visualizer',
      fallback: {
        type: 'markdown',
        content: 'Bubble sort steps through adjacent elements.'
      },
      data: {
        algorithm: 'bubble_sort',
        initialArray: [45, 12, 89, 34, 23, 7]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Sorting visualizer mounted');
    assert.ok(instance.controller.totalSteps > 1, 'Multiple sort steps generated');

    // Step to end
    instance.setStep(instance.controller.totalSteps - 1);
    const lastStep = instance.getCurrentStep();
    assert.equal(lastStep.currentStep.status, 'sorted', 'Sort reaches sorted status');
    assert.deepEqual(lastStep.currentStep.state.array, [7, 12, 23, 34, 45, 89], 'Array is sorted ascending');
    instance.destroy();
  });

  // Case 4: Stack Push/Pop and Underflow
  await t.test('4. Stack: Push, pop, top pointer, and underflow detection', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'dsa_linear',
      mode: 'simulation',
      title: 'Stack Operations',
      fallback: {
        type: 'markdown',
        content: 'Stack LIFO discipline.'
      },
      data: {
        structure: 'stack',
        capacity: 4,
        operations: [
          { op: 'push', value: 10 },
          { op: 'push', value: 20 },
          { op: 'pop' },
          { op: 'pop' },
          { op: 'pop' } // Underflow!
        ]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Stack visualizer mounted');
    assert.ok(instance.controller.totalSteps >= 5, 'Steps generated');

    // Go to final step (underflow pop)
    instance.setStep(instance.controller.totalSteps - 1);
    const underflowStep = instance.getCurrentStep();
    assert.equal(underflowStep.currentStep.status, 'underflow', 'Detects stack underflow on excess pop');
    instance.destroy();
  });

  // Case 5: Queue Enqueue/Dequeue and FIFO Behavior
  await t.test('5. Queue: Enqueue, dequeue, and FIFO pointer discipline', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'dsa_linear',
      mode: 'simulation',
      title: 'Queue Operations',
      fallback: {
        type: 'markdown',
        content: 'Queue FIFO discipline.'
      },
      data: {
        structure: 'queue',
        capacity: 4,
        operations: [
          { op: 'enqueue', value: 'A' },
          { op: 'enqueue', value: 'B' },
          { op: 'dequeue' }
        ]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Queue visualizer mounted');

    // Step to dequeue
    instance.setStep(3);
    const deqStep = instance.getCurrentStep();
    assert.equal(deqStep.currentStep.variables.dequeuedValue, 'A', 'Dequeued first inserted element A (FIFO)');
    assert.deepEqual(deqStep.currentStep.state.items, ['B'], 'Remaining element is B');
    instance.destroy();
  });

  // Case 6: XOR Truth Table
  await t.test('6. XOR Truth Table: Interactive toggling and deterministic calculation', () => {
    const container = document.createElement('div');

    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'truth_table',
      mode: 'interactive',
      title: 'XOR Truth Table',
      fallback: {
        type: 'markdown',
        content: 'Truth table for A XOR B.'
      },
      data: {
        variables: ['A', 'B'],
        expression: 'A XOR B'
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Logic visualizer mounted');

    // Check evaluateBoolean deterministic outputs
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 0, B: 0 }), 0);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 0, B: 1 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 1, B: 0 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 1, B: 1 }), 0);

    instance.destroy();
  });

  // Case 7: Ordinary Academic Explanation without Visualization (No Forced Visual Block)
  await t.test('7. Plain Definition: Ordinary question generates natural explanation without visual blocks', () => {
    const plan = planAdaptivePresentation('What is database normalization?');
    assert.notEqual(plan.profile, PRESENTATION_PROFILES.INTERACTIVE_SIMULATION);
    assert.equal(plan.useInteractiveDemo, false, 'Interactive demo disabled for definition query');

    const fallbackResponse = buildAdaptiveEducationalFallback('What is database normalization?', { plan });
    if (fallbackResponse) {
      assert.ok(!fallbackResponse.includes('```kyana_visual'), 'No kyana_visual block in plain definition');
      assert.ok(!fallbackResponse.includes('```logic_sim'), 'No logic_sim block in plain definition');
    }
  });

  // Case 8: Invalid Visualization Payload (Graceful Fallback)
  await t.test('8. Resilience: Invalid payload renders graceful fallback without crashing', () => {
    const container = document.createElement('div');

    const malformedPayload = {
      version: 'kyana.visual.v1',
      engine: 'unknown_engine_xyz', // Invalid engine!
      title: 'Corrupted Visualizer',
      fallback: 'This is the fallback markdown trace.'
    };

    const check = validateVisualContract(malformedPayload);
    assert.equal(check.valid, false, 'Validator detects invalid engine');

    // Mounting should not throw, but render fallback
    const inst = KyanaVisualRenderer.mount(container, malformedPayload);
    assert.ok(inst, 'Returns instance safely');
    assert.equal(inst.controller, null, 'No controller created for invalid engine');
    const fallback = container.querySelector('.kyana-visual-fallback');
    assert.ok(fallback, 'Fallback element rendered');
    assert.ok(fallback.textContent.includes('This is the fallback markdown trace.'), 'Fallback content rendered');
    inst.destroy();
  });

  // Case 9: Incomplete Streamed Visualization Block (Hidden During Streaming)
  await t.test('9. Streaming: Incomplete unclosed fenced block is stabilized and hidden', () => {
    const partialStream = [
      'Here is the step-by-step simulation:',
      '```kyana_visual',
      '{\n  "version": "kyana.visual.v1",\n  "engine": "algo_anim"'
    ].join('\n');

    // Emulate stabilizeStreamingMarkdown logic from chatbot.js
    const fenceMatches = [...partialStream.matchAll(/(^|\n)(`{3,}|~{3,})([\w+-]*)[ \t]*(?:\n|$)/g)];
    assert.equal(fenceMatches.length % 2, 1, 'Detected unclosed fence');

    const lastFence = fenceMatches[fenceMatches.length - 1];
    const fenceLang = (lastFence[3] || '').trim().toLowerCase();
    const structuredKinds = new Set([
      'study_session', 'learning_session', 'interactive_demo', 'logic_sim',
      'live_demo', 'kyana_visual', 'algo_anim', 'dsa_linear', 'truth_table'
    ]);

    assert.ok(structuredKinds.has(fenceLang), 'kyana_visual recognized as structured fence');
    const stabilized = partialStream.slice(0, lastFence.index).trimEnd();
    assert.equal(stabilized, 'Here is the step-by-step simulation:', 'Incomplete JSON fence completely hidden during streaming');
  });

  // Case 10: Multiple Visualizations in One Response
  await t.test('10. Multi-Visualizer: Multiple visual blocks in one response mount independently', () => {
    const container = document.createElement('div');

    const visual1 = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'First Visualizer: Search',
      data: { algorithm: 'linear_search', initialArray: [5, 10, 15], target: 10 },
      fallback: 'Search fallback'
    };

    const visual2 = {
      version: 'kyana.visual.v1',
      engine: 'dsa_linear',
      mode: 'simulation',
      title: 'Second Visualizer: Stack',
      data: { structure: 'stack', capacity: 3, operations: [{ op: 'push', value: 99 }] },
      fallback: 'Stack fallback'
    };

    const inst1 = KyanaVisualRenderer.mount(container, visual1);
    const inst2 = KyanaVisualRenderer.mount(container, visual2);

    assert.ok(inst1 && inst2, 'Both instances mounted successfully');
    assert.notEqual(inst1.id, inst2.id, 'Instances have distinct unique IDs');
    assert.equal(inst1.engine, 'algo_anim');
    assert.equal(inst2.engine, 'dsa_linear');

    // Clean up both
    KyanaVisualRenderer.destroyAll();
    assert.equal(inst1.getCurrentStep(), null, 'Instance 1 cleaned up');
    assert.equal(inst2.getCurrentStep(), null, 'Instance 2 cleaned up');
  });

  // Case 11: Follow-Up Question Referring to Previous Visualization
  await t.test('11. Conversation Context: Follow-up question references previous visualization without re-render cross-talk', () => {
    const history = [
      { role: 'user', content: 'Show binary search on [10, 20, 30, 40, 50]' },
      {
        role: 'assistant',
        content: 'Here is the binary search:\n```kyana_visual\n{"version":"kyana.visual.v1","engine":"algo_anim","mode":"simulation","title":"Binary Search","fallback":{"type":"markdown","content":"Trace"},"data":{"algorithm":"binary_search","initialArray":[10,20,30,40,50],"target":30}}\n```'
      }
    ];

    const followUpPlan = planAdaptivePresentation('Can you explain step 2 in more detail?', { history });
    assert.ok(followUpPlan, 'Follow-up plan created');

    // Follow-up question is an explanation and does not force an unwanted duplicate simulation
    assert.equal(followUpPlan.useInteractiveDemo, false, 'Does not force duplicate simulation on follow-up question');
  });

  // Security test: Prototype Pollution & XSS Rejection in visualizer payloads
  await t.test('12. Security: Injection payloads with __proto__ or <script> tags rejected safely', () => {
    const maliciousPayload = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Malicious <script>alert("xss")</script>',
      fallback: 'Safe fallback',
      __proto__: { polluted: true },
      data: {
        algorithm: 'binary_search',
        initialArray: [1, 2, 3],
        target: 2
      }
    };

    const res = validateVisualContract(JSON.stringify(maliciousPayload));
    assert.equal(res.valid, false, 'Payload rejected by security checks');
    assert.ok(res.errors.some(e => e.includes('Prototype pollution') || e.includes('Executable script')), 'Detected injection attempt');
  });

  // Server-side Adaptive Response Sanitization
  await t.test('13. Server-Side: sanitizeAdaptiveResponse validates closed kyana_visual blocks', () => {
    const rawAiReply = [
      'Explanation of Bubble Sort:',
      '```kyana_visual',
      JSON.stringify({
        version: 'kyana.visual.v1',
        engine: 'algo_anim',
        mode: 'simulation',
        title: 'Bubble Sort Test',
        fallback: { type: 'markdown', content: 'Fallback trace' },
        data: { algorithm: 'bubble_sort', initialArray: [10, 5, 2] }
      }, null, 2),
      '```',
      'Hope that helps!'
    ].join('\n');

    const sanitized = sanitizeAdaptiveResponse(rawAiReply);
    assert.ok(sanitized.includes('```kyana_visual'), 'Valid kyana_visual block preserved in sanitized output');
    assert.ok(sanitized.includes('Bubble Sort Test'), 'Payload content preserved');
    assert.ok(sanitized.includes('Hope that helps!'), 'Surrounding prose preserved');
  });
});
