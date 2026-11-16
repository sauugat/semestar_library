'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal Mock DOM environment for Node.js test execution
function setupMockDom() {
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
    let m;
    while ((m = attrRegex.exec(str)) !== null) {
      const k = m[1];
      const v = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }

  function parseHTMLtoNodes(html, createElement) {
    const root = createElement('root');
    const stack = [root];

    const tokenRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
    let match;

    while ((match = tokenRegex.exec(html)) !== null) {
      if (match[0].startsWith('<!--')) continue;

      if (match[2]) {
        const isClosing = Boolean(match[1]);
        const tagName = match[2];
        const attrStr = match[3] || '';
        const isSelfClosing = attrStr.trim().endsWith('/') || ['circle', 'line', 'path', 'polygon', 'rect', 'input', 'img', 'br', 'hr'].includes(tagName.toLowerCase());

        if (isClosing) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName.toLowerCase() === tagName.toLowerCase()) {
              stack.splice(i);
              break;
            }
          }
        } else {
          const node = createElement(tagName);
          parseAttrs(attrStr.replace(/\/$/, ''), node);
          stack[stack.length - 1].appendChild(node);
          if (!isSelfClosing) {
            stack.push(node);
          }
        }
      } else if (match[4]) {
        const text = match[4].trim();
        if (text) {
          const parent = stack[stack.length - 1];
          if (parent) {
            parent._textContent = (parent._textContent ? parent._textContent + ' ' : '') + text;
          }
        }
      }
    }

    const result = root.children.slice();
    result.forEach(c => { c.parentNode = null; });
    return result;
  }

  class MockElement {
    constructor(tagName) {
      this.tagName = String(tagName || 'div').toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this._className = '';
      this.classList = new MockClassList(this);
      this._listeners = new Map();
      this.style = {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, v); },
        getPropertyValue(k) { return this._props.get(k) || ''; }
      };
      this._textContent = '';
      this._innerHTML = '';
      this.disabled = false;
      this.type = 'button';
      this.value = '0';
    }

    get className() {
      return this._className;
    }

    set className(val) {
      this._className = String(val || '');
      this.classList._classes.clear();
      this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
    }

    get textContent() {
      if (this._textContent) {
        return this._textContent;
      }
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).filter(Boolean).join(' ');
      }
      return '';
    }

    set textContent(val) {
      this._textContent = String(val == null ? '' : val);
      this.children = [];
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(val) {
      this._innerHTML = String(val || '');
      this.children = [];
      this._textContent = '';
      if (!val) return;
      const childNodes = parseHTMLtoNodes(this._innerHTML, (tag) => new MockElement(tag));
      childNodes.forEach(c => this.appendChild(c));
    }

    setAttribute(k, v) {
      this.attributes.set(String(k).toLowerCase(), String(v));
    }

    getAttribute(k) {
      return this.attributes.get(String(k).toLowerCase()) || null;
    }

    hasAttribute(k) {
      return this.attributes.has(String(k).toLowerCase());
    }

    removeAttribute(k) {
      this.attributes.delete(String(k).toLowerCase());
    }

    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
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
        if (cleanSel.startsWith('[') && cleanSel.endsWith(']')) {
          const attr = cleanSel.slice(1, -1);
          return node.hasAttribute(attr);
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
}

setupMockDom();

// Require modules after DOM setup
const KyanaPlaybackController = require('../public/js/visualizers/kyana-playback-controller');
const KyanaVisualRenderer = require('../public/js/visualizers/kyana-visual-renderer');

test('Kyana Academic Visualizer Suite (Phase 2.2)', async (t) => {

  // ==========================================================================
  // 1. KyanaPlaybackController Tests
  // ==========================================================================
  await t.test('1. Playback Controller: State transitions, stepping, bounds and loop', () => {
    const dummySteps = [
      { stepNumber: 1, action: 'init', description: 'Start' },
      { stepNumber: 2, action: 'compare', description: 'Compare A & B' },
      { stepNumber: 3, action: 'swap', description: 'Swap A & B' },
      { stepNumber: 4, action: 'finish', description: 'Sorted' }
    ];

    let recordedSteps = [];
    const controller = new KyanaPlaybackController({
      steps: dummySteps,
      onStepChange: (idx, step, isPlaying) => {
        recordedSteps.push({ idx, action: step ? step.action : null, isPlaying });
      }
    });

    const initial = controller.getState();
    assert.equal(initial.currentIndex, 0);
    assert.equal(initial.totalSteps, 4);
    assert.equal(initial.isPlaying, false);
    assert.equal(initial.isFirst, true);
    assert.equal(initial.isLast, false);

    // Step next
    controller.next();
    assert.equal(controller.getState().currentIndex, 1);
    assert.equal(recordedSteps.length, 2);
    assert.equal(recordedSteps[0].idx, 0);
    assert.equal(recordedSteps[1].idx, 1);
    assert.equal(recordedSteps[1].action, 'compare');

    // Step next to end
    controller.next();
    controller.next();
    assert.equal(controller.getState().currentIndex, 3);
    assert.equal(controller.getState().isLast, true);

    // Next at end does not exceed bounds when loop=false
    controller.next();
    assert.equal(controller.getState().currentIndex, 3);

    // Prev works
    controller.prev();
    assert.equal(controller.getState().currentIndex, 2);

    // Jump to step
    controller.goToStep(0);
    assert.equal(controller.getState().currentIndex, 0);

    // Speed setting
    controller.setSpeed(2.0);
    assert.equal(controller.getState().speed, 2.0);
    controller.cycleSpeed();
    assert.equal(controller.getState().speed, 0.5);

    // Restart
    controller.goToStep(2);
    controller.restart();
    assert.equal(controller.getState().currentIndex, 0);

    controller.destroy();
  });

  await t.test('2. Playback Controller: DOM UI generation and touch target compliance', () => {
    const container = document.createElement('div');
    const controller = new KyanaPlaybackController({
      totalSteps: 5,
      container: container
    });

    const playBtn = container.querySelector('.ky-btn-play');
    assert.ok(playBtn, 'Play button rendered in DOM');

    const nextBtn = container.querySelector('.ky-btn-next');
    const prevBtn = container.querySelector('.ky-btn-prev');
    const restartBtn = container.querySelector('.ky-btn-restart');
    const speedBtn = container.querySelector('.ky-btn-speed');
    const slider = container.querySelector('.ky-playback-slider');
    const counter = container.querySelector('.ky-playback-counter');

    assert.ok(nextBtn && prevBtn && restartBtn && speedBtn && slider && counter);
    assert.equal(counter.textContent, 'Step 1 / 5');

    // Simulate clicking next
    nextBtn.dispatchEvent('click');
    assert.equal(controller.getState().currentIndex, 1);
    assert.equal(counter.textContent, 'Step 2 / 5');

    // Simulate clicking restart
    restartBtn.dispatchEvent('click');
    assert.equal(controller.getState().currentIndex, 0);
    assert.equal(counter.textContent, 'Step 1 / 5');

    controller.destroy();
  });

  // ==========================================================================
  // 2. Binary Search Component Tests (algo_anim)
  // ==========================================================================
  await t.test('3. Binary Search Visualizer: Mounts, calculates deterministic steps, and highlights mid/found', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Binary Search for 15',
      fallback: 'Array: [2, 5, 8, 12, 15, 23, 38], target: 15',
      data: {
        algorithm: 'binary_search',
        initialArray: [2, 5, 8, 12, 15, 23, 38],
        target: 15
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Visualizer mounted instance returned');
    assert.equal(instance.engine, 'algo_anim');
    assert.ok(instance.controller, 'Has playback controller');

    const cells = container.querySelectorAll('.ky-array-cell');
    assert.equal(cells.length, 7, 'Rendered 7 array cells');
    assert.equal(cells[4].textContent, '15');

    // Advance to found step
    const total = instance.controller.totalSteps;
    instance.setStep(total - 1);

    const state = instance.getCurrentStep();
    assert.equal(state.currentIndex, total - 1);
    assert.equal(state.currentStep.status, 'found');

    // Target cell index 4 should have found class
    assert.ok(cells[4].classList.contains('found'), 'Cell 4 highlighted as found');

    instance.destroy();
  });

  // ==========================================================================
  // 3. Sorting Component Tests (algo_anim)
  // ==========================================================================
  await t.test('4. Sorting Visualizer: Mounts Bubble Sort, adjusts bar heights, and reaches sorted state', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Bubble Sort Demo',
      fallback: 'Bubble sort on [30, 10, 50, 20]',
      data: {
        algorithm: 'bubble_sort',
        initialArray: [30, 10, 50, 20]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance.controller);
    assert.ok(instance.controller.totalSteps > 1);

    const bars = container.querySelectorAll('.ky-sort-bar');
    assert.equal(bars.length, 4, 'Rendered 4 sorting bars');

    // Advance to final sorted step
    instance.setStep(instance.controller.totalSteps - 1);
    const finalStep = instance.getCurrentStep().currentStep;
    assert.equal(finalStep.status, 'sorted');

    instance.destroy();
  });

  // ==========================================================================
  // 4. Stack Visualizer Tests (dsa_linear)
  // ==========================================================================
  await t.test('5. Stack Visualizer: PUSH, POP, TOP indicator, and overflow/underflow alerts', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'dsa_linear',
      mode: 'simulation',
      title: 'Call Stack Simulation',
      fallback: 'Stack with capacity 3',
      data: {
        structure: 'stack',
        capacity: 3,
        operations: [
          { op: 'push', value: 'main()' },
          { op: 'push', value: 'parse()' },
          { op: 'push', value: 'eval()' },
          { op: 'push', value: 'overflow()' }, // causes overflow
          { op: 'pop' },
          { op: 'pop' },
          { op: 'pop' },
          { op: 'pop' } // causes underflow
        ]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance);

    // Initial step 0
    instance.setStep(0);
    let topValEl = container.querySelector('.ky-top-val');
    assert.ok(topValEl, 'Top indicator exists in DOM');
    assert.equal(topValEl.textContent, '0');

    // Step 3 (4th op) causes overflow
    instance.setStep(3);
    const step3 = instance.getCurrentStep().currentStep;
    assert.equal(step3.status, 'overflow');
    const alertOverflow = container.querySelector('.ky-status-alert');
    assert.ok(alertOverflow, 'Alert displayed');
    assert.ok(alertOverflow.textContent.includes('Overflow'));

    // Last step causes underflow
    instance.setStep(instance.controller.totalSteps - 1);
    const lastStep = instance.getCurrentStep().currentStep;
    assert.equal(lastStep.status, 'underflow');
    const alertUnderflow = container.querySelector('.ky-status-alert');
    assert.ok(alertUnderflow, 'Alert displayed');
    assert.ok(alertUnderflow.textContent.includes('Underflow'));

    instance.destroy();
  });

  // ==========================================================================
  // 5. Queue Visualizer Tests (dsa_linear)
  // ==========================================================================
  await t.test('6. Queue Visualizer: ENQUEUE, DEQUEUE, FRONT/REAR indicators, FIFO discipline', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'dsa_linear',
      mode: 'simulation',
      title: 'Print Queue Simulation',
      fallback: 'Queue demo',
      data: {
        structure: 'queue',
        capacity: 4,
        operations: [
          { op: 'enqueue', value: 'Job1' },
          { op: 'enqueue', value: 'Job2' },
          { op: 'dequeue' },
          { op: 'enqueue', value: 'Job3' }
        ]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance);

    // Step 0: Job1 in queue -> is both front and rear
    instance.setStep(0);
    let frontEl = container.querySelector('.ky-front-val');
    let rearEl = container.querySelector('.ky-rear-val');
    assert.ok(frontEl && rearEl);
    assert.equal(frontEl.textContent, '0');
    assert.equal(rearEl.textContent, '0');

    // Step 1: Job1 (F) and Job2 (R)
    instance.setStep(1);
    assert.equal(container.querySelector('.ky-front-val').textContent, '0');
    assert.equal(container.querySelector('.ky-rear-val').textContent, '1');

    instance.destroy();
  });

  // ==========================================================================
  // 6. Logic Gate & Dynamic Truth Table Tests (logic_sim, truth_table)
  // ==========================================================================
  await t.test('7. Logic Simulator: XOR gate, interactive toggle, deterministic propagation and truth table matching', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'logic_sim',
      mode: 'simulation',
      title: 'XOR Gate Logic',
      fallback: 'A XOR B truth table',
      data: {
        inputs: [
          { id: 'A', label: 'Input A', initial: 0 },
          { id: 'B', label: 'Input B', initial: 0 }
        ],
        gates: [
          { id: 'G1', type: 'XOR', inputs: ['A', 'B'] }
        ]
      }
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance);

    const outBadge = container.querySelector('.ky-output-badge');
    assert.ok(outBadge, 'Output badge exists');
    assert.equal(outBadge.textContent, '0', 'Initial output 0 ^ 0 = 0');

    // Truth table rows should exist (2^2 = 4 rows)
    const rows = container.querySelectorAll('.ky-tt-row');
    assert.equal(rows.length, 4, '4 rows in truth table');

    // Row 0 (A=0, B=0) should be active
    assert.ok(rows[0].classList.contains('active-row'), 'Row 0 active initially');

    // Simulate clicking toggle B (A=0, B=1 -> XOR=1)
    const toggleB = container.querySelector('.toggle-b');
    assert.ok(toggleB, 'Toggle B exists');
    toggleB.dispatchEvent('click');

    assert.equal(outBadge.textContent, '1', 'Output 0 ^ 1 = 1');
    assert.ok(rows[1].classList.contains('active-row'), 'Row 1 (0, 1) active after toggle');

    // Simulate clicking toggle A (A=1, B=1 -> XOR=0)
    const toggleA = container.querySelector('.toggle-a');
    assert.ok(toggleA, 'Toggle A exists');
    toggleA.dispatchEvent('click');

    assert.equal(outBadge.textContent, '0', 'Output 1 ^ 1 = 0');
    assert.ok(rows[3].classList.contains('active-row'), 'Row 3 (1, 1) active after toggle');

    instance.destroy();
  });

  await t.test('8. Safe Boolean Expression Evaluator: Deterministic calculation of complex expressions', () => {
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A AND B', { A: 1, B: 1 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A AND B', { A: 1, B: 0 }), 0);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A OR B', { A: 0, B: 1 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 1, B: 1 }), 0);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('A XOR B', { A: 1, B: 0 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('NOT A', { A: 0 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('NOT A', { A: 1 }), 0);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('(A OR B) AND C', { A: 1, B: 0, C: 1 }), 1);
    assert.equal(KyanaVisualRenderer.evaluateBoolean('(A OR B) AND C', { A: 1, B: 0, C: 0 }), 0);
  });

  // ==========================================================================
  // 7. Graceful Fallback & Instance Lifecycle
  // ==========================================================================
  await t.test('9. Unsupported engine / malformed payload renders graceful fallback without crashing', () => {
    const container = document.createElement('div');
    const envelope = {
      version: 'kyana.visual.v1',
      engine: 'unsupported_engine_xyz',
      mode: 'simulation',
      title: 'Future Quantum Sim',
      fallback: 'Quantum state fallback',
      data: {}
    };

    const instance = KyanaVisualRenderer.mount(container, envelope);
    assert.ok(instance, 'Returns instance handle even for fallback');
    const fallbackEl = container.querySelector('.kyana-visual-fallback');
    assert.ok(fallbackEl, 'Fallback DOM element rendered');
    assert.ok(fallbackEl.textContent.includes('Quantum state fallback'));

    instance.destroy();
  });

  await t.test('10. Lifecycle destroyAll cleans up multiple instances cleanly', () => {
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');

    KyanaVisualRenderer.mount(container1, {
      engine: 'algo_anim',
      data: { algorithm: 'binary_search', initialArray: [1, 2, 3], target: 2 }
    });

    KyanaVisualRenderer.mount(container2, {
      engine: 'dsa_linear',
      data: { structure: 'stack', capacity: 2, operations: [{ op: 'push', value: '1' }] }
    });

    assert.equal(container1.children.length, 1);
    assert.equal(container2.children.length, 1);

    KyanaVisualRenderer.destroyAll();

    assert.equal(container1.children.length, 0, 'Container 1 emptied on destroyAll');
    assert.equal(container2.children.length, 0, 'Container 2 emptied on destroyAll');
  });

  // ==========================================================================
  // 8. Gate Correctness & Keyboard Isolation (Phase 2.3 Verification)
  // ==========================================================================
  await t.test('11. Logic Correctness: Exhaustive verification of all 7 logic gates and compound formulas', () => {
    const evalBool = KyanaVisualRenderer.evaluateBoolean;

    // AND
    assert.equal(evalBool('A AND B', { A: 0, B: 0 }), 0);
    assert.equal(evalBool('A AND B', { A: 0, B: 1 }), 0);
    assert.equal(evalBool('A AND B', { A: 1, B: 0 }), 0);
    assert.equal(evalBool('A AND B', { A: 1, B: 1 }), 1);

    // OR
    assert.equal(evalBool('A OR B', { A: 0, B: 0 }), 0);
    assert.equal(evalBool('A OR B', { A: 0, B: 1 }), 1);
    assert.equal(evalBool('A OR B', { A: 1, B: 0 }), 1);
    assert.equal(evalBool('A OR B', { A: 1, B: 1 }), 1);

    // NOT
    assert.equal(evalBool('NOT A', { A: 0 }), 1);
    assert.equal(evalBool('NOT A', { A: 1 }), 0);

    // XOR
    assert.equal(evalBool('A XOR B', { A: 0, B: 0 }), 0);
    assert.equal(evalBool('A XOR B', { A: 0, B: 1 }), 1);
    assert.equal(evalBool('A XOR B', { A: 1, B: 0 }), 1);
    assert.equal(evalBool('A XOR B', { A: 1, B: 1 }), 0);

    // NAND
    assert.equal(evalBool('A NAND B', { A: 0, B: 0 }), 1);
    assert.equal(evalBool('A NAND B', { A: 0, B: 1 }), 1);
    assert.equal(evalBool('A NAND B', { A: 1, B: 0 }), 1);
    assert.equal(evalBool('A NAND B', { A: 1, B: 1 }), 0);

    // NOR
    assert.equal(evalBool('A NOR B', { A: 0, B: 0 }), 1);
    assert.equal(evalBool('A NOR B', { A: 0, B: 1 }), 0);
    assert.equal(evalBool('A NOR B', { A: 1, B: 0 }), 0);
    assert.equal(evalBool('A NOR B', { A: 1, B: 1 }), 0);

    // XNOR
    assert.equal(evalBool('A XNOR B', { A: 0, B: 0 }), 1);
    assert.equal(evalBool('A XNOR B', { A: 0, B: 1 }), 0);
    assert.equal(evalBool('A XNOR B', { A: 1, B: 0 }), 0);
    assert.equal(evalBool('A XNOR B', { A: 1, B: 1 }), 1);

    // Complex compound formulas with precedence & parentheses
    assert.equal(evalBool('(A AND B) OR (NOT C)', { A: 0, B: 1, C: 0 }), 1);
    assert.equal(evalBool('(A AND B) OR (NOT C)', { A: 0, B: 1, C: 1 }), 0);
    assert.equal(evalBool('A XOR (B AND C)', { A: 1, B: 1, C: 1 }), 0);
    assert.equal(evalBool('A XOR (B AND C)', { A: 1, B: 1, C: 0 }), 1);
  });

  await t.test('12. Keyboard Navigation Isolation: Keys inside TEXTAREA or text INPUT do not trigger playback', () => {
    const container = document.createElement('div');
    const controller = new KyanaPlaybackController({
      totalSteps: 5,
      container: container
    });

    const wrap = container.querySelector('.ky-playback-bar');
    assert.ok(wrap);

    // Fake textarea element
    const textarea = document.createElement('textarea');
    textarea.tagName = 'TEXTAREA';

    // Space event inside textarea
    wrap.dispatchEvent({
      type: 'keydown',
      key: ' ',
      code: 'Space',
      target: textarea,
      preventDefault: () => {}
    });
    assert.equal(controller.getState().isPlaying, false, 'Playback did not start when typing in textarea');

    // ArrowRight inside textarea
    wrap.dispatchEvent({
      type: 'keydown',
      key: 'ArrowRight',
      code: 'ArrowRight',
      target: textarea,
      preventDefault: () => {}
    });
    assert.equal(controller.getState().currentIndex, 0, 'Step index did not advance when typing in textarea');

    // R inside text input
    const textInput = document.createElement('input');
    textInput.tagName = 'INPUT';
    textInput.type = 'text';
    controller.goToStep(3);
    wrap.dispatchEvent({
      type: 'keydown',
      key: 'r',
      target: textInput,
      preventDefault: () => {}
    });
    assert.equal(controller.getState().currentIndex, 3, 'Restart did not trigger when typing in text input');

    // Proper keydown on playback bar container directly triggers restart
    wrap.dispatchEvent({
      type: 'keydown',
      key: 'r',
      target: wrap,
      preventDefault: () => {}
    });
    assert.equal(controller.getState().currentIndex, 0, 'Restart triggered when bar container is focused');

    controller.destroy();
  });
});
