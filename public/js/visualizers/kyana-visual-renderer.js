/**
 * Kyana Academic Visualizer Renderer (kyana-visual-renderer.js)
 * 
 * Reusable visualization mounting system for Kyana AI inside Semester Library.
 * Coordinates deterministic simulations, DOM rendering, SVG circuit drawing,
 * and playback control across the supported curriculum engines:
 * 1. Binary Search & Linear Search (algo_anim)
 * 2. Sorting Visualizers: Bubble, Selection, Insertion (algo_anim)
 * 3. Stack Visualizer: LIFO discipline, overflow/underflow (dsa_linear)
 * 4. Queue Visualizer: FIFO discipline, front/rear pointers (dsa_linear)
 * 5. Logic Circuit Simulator (logic_sim) & Dynamic Truth Table (truth_table)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./kyana-simulation-engine', './kyana-playback-controller'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const SimEngine = require('./kyana-simulation-engine');
    const PlaybackCtrl = require('./kyana-playback-controller');
    module.exports = factory(SimEngine, PlaybackCtrl);
  } else {
    root.KyanaVisualRenderer = factory(root.KyanaSimulationEngine, root.KyanaPlaybackController);
  }
}(typeof self !== 'undefined' ? self : this, function (SimulationEngine, PlaybackController) {
  'use strict';

  // Fallback if globals are not yet bound in browser
  function getSimEngine() {
    if (SimulationEngine) return SimulationEngine;
    if (typeof window !== 'undefined' && window.KyanaSimulationEngine) {
      return window.KyanaSimulationEngine;
    }
    return null;
  }

  function getPlaybackController() {
    if (PlaybackController) return PlaybackController;
    if (typeof window !== 'undefined' && window.KyanaPlaybackController) {
      return window.KyanaPlaybackController;
    }
    return null;
  }

  /**
   * Escape HTML entities to prevent XSS
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generate isolated unique visualizer ID
   */
  let _instanceCounter = 0;
  function generateInstanceId(engine) {
    _instanceCounter++;
    return `ky-vis-${engine}-${Date.now().toString(36)}-${_instanceCounter}`;
  }

  // Active instances registry for global inspection / cleanup
  const activeInstances = new Map();

  /**
   * Safe Expression Evaluator for Truth Tables (no eval(), purely deterministic)
   */
  function evaluateBooleanExpression(expr, varValues) {
    // Normalize tokens
    let clean = String(expr || '').toUpperCase();
    for (const [v, val] of Object.entries(varValues)) {
      const reg = new RegExp(`\\b${v}\\b`, 'g');
      clean = clean.replace(reg, val ? '1' : '0');
    }

    // Tokenized recursive descent evaluator for AND, OR, NOT, XOR, NAND, NOR, XNOR
    try {
      return parseBoolOr(clean);
    } catch (_) {
      return 0;
    }

    function parseBoolOr(str) {
      const norParts = splitTopLevel(str, 'NOR');
      if (norParts.length > 1) {
        return norParts.some(p => parseBoolOr(p) === 1) ? 0 : 1;
      }
      const parts = splitTopLevel(str, 'OR');
      if (parts.length > 1) {
        return parts.some(p => parseBoolXor(p) === 1) ? 1 : 0;
      }
      return parseBoolXor(str);
    }

    function parseBoolXor(str) {
      const xnorParts = splitTopLevel(str, 'XNOR');
      if (xnorParts.length > 1) {
        let res = parseBoolAnd(xnorParts[0]);
        for (let i = 1; i < xnorParts.length; i++) {
          res = (res ^ parseBoolAnd(xnorParts[i])) ? 0 : 1;
        }
        return res ? 1 : 0;
      }
      const parts = splitTopLevel(str, 'XOR');
      if (parts.length > 1) {
        let res = parseBoolAnd(parts[0]);
        for (let i = 1; i < parts.length; i++) {
          res = res ^ parseBoolAnd(parts[i]);
        }
        return res ? 1 : 0;
      }
      return parseBoolAnd(str);
    }

    function parseBoolAnd(str) {
      const nandParts = splitTopLevel(str, 'NAND');
      if (nandParts.length > 1) {
        return nandParts.every(p => parseBoolFactor(p) === 1) ? 0 : 1;
      }
      const parts = splitTopLevel(str, 'AND');
      if (parts.length > 1) {
        return parts.every(p => parseBoolFactor(p) === 1) ? 1 : 0;
      }
      return parseBoolFactor(str);
    }

    function parseBoolFactor(str) {
      const s = str.trim();
      if (!s) return 0;
      if (s.startsWith('NOT')) {
        return parseBoolFactor(s.slice(3).trim()) === 1 ? 0 : 1;
      }
      if (s.startsWith('!') || s.startsWith('~')) {
        return parseBoolFactor(s.slice(1).trim()) === 1 ? 0 : 1;
      }
      if (s.startsWith('(') && s.endsWith(')')) {
        return parseBoolOr(s.slice(1, -1));
      }
      if (s === '1' || s === 'TRUE' || s === 'T') return 1;
      return 0;
    }

    function splitTopLevel(str, op) {
      const parts = [];
      let depth = 0;
      let curr = '';
      const tokens = str.split(/(\(|\)|\s+)/).filter(t => t.length > 0);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '(') depth++;
        else if (token === ')') depth--;

        if (depth === 0 && token.trim().toUpperCase() === op) {
          parts.push(curr.trim());
          curr = '';
        } else {
          curr += token;
        }
      }
      if (curr.trim()) parts.push(curr.trim());
      return parts.length > 0 ? parts : [str];
    }
  }

  // ==========================================================================
  // 1. Component Builder: Binary Search & Linear Search (algo_anim)
  // ==========================================================================
  function mountSearchVisualizer(container, envelope, simEngine, Playback) {
    const data = envelope.data || envelope.payload || {};
    const array = Array.isArray(data.initialArray) ? data.initialArray.slice() : (Array.isArray(data.array) ? data.array.slice() : [1, 3, 5, 7, 9, 11, 13]);
    const target = typeof data.target === 'number' ? data.target : 7;
    const isBinary = data.algorithm === 'binary_search';

    // Compute simulation
    const simResult = isBinary
      ? simEngine.simulateBinarySearch(array, target)
      : simEngine.simulateLinearSearch(array, target);

    if (simResult && simResult.error && (!simResult.steps || simResult.steps.length === 0)) {
      throw new Error(simResult.error.message || 'Simulation error');
    }

    const steps = simResult.steps || [];

    // Build DOM structure
    const rootEl = document.createElement('div');
    rootEl.className = 'kyana-visual-root ky-search-visualizer';

    // Header
    const header = document.createElement('div');
    header.className = 'ky-vis-header';
    header.innerHTML = `
      <div class="ky-vis-header-left">
        <span class="ky-vis-badge">${isBinary ? 'Binary Search' : 'Linear Search'}</span>
        <h4 class="ky-vis-title">${escapeHtml(envelope.title || 'Array Search Visualizer')}</h4>
      </div>
      <div class="ky-vis-meta">
        <span class="ky-vis-meta-item">Target: <span class="ky-vis-meta-value">${target}</span></span>
        <span class="ky-vis-meta-item">Length: <span class="ky-vis-meta-value">${array.length}</span></span>
      </div>
    `;
    rootEl.appendChild(header);

    // Stage
    const stage = document.createElement('div');
    stage.className = 'ky-vis-stage';

    const arrayWrap = document.createElement('div');
    arrayWrap.className = 'ky-array-container';

    // Create cells
    const cellNodes = [];
    const pointerNodes = [];

    array.forEach((val, idx) => {
      const col = document.createElement('div');
      col.className = 'ky-array-cell-wrap';

      const cell = document.createElement('div');
      cell.className = 'ky-array-cell';
      cell.textContent = String(val);
      cell.setAttribute('data-index', String(idx));

      const idxLabel = document.createElement('div');
      idxLabel.className = 'ky-array-index';
      idxLabel.textContent = `[${idx}]`;

      const ptrBar = document.createElement('div');
      ptrBar.className = 'ky-array-pointer-bar';

      col.appendChild(cell);
      col.appendChild(idxLabel);
      col.appendChild(ptrBar);
      arrayWrap.appendChild(col);

      cellNodes.push(cell);
      pointerNodes.push(ptrBar);
    });

    stage.appendChild(arrayWrap);
    rootEl.appendChild(stage);

    // Step explanation card
    const stepCard = document.createElement('div');
    stepCard.className = 'ky-vis-step-card';
    stepCard.innerHTML = `
      <span class="ky-vis-step-badge">INIT</span>
      <span class="ky-vis-step-desc">Initialized array of ${array.length} elements. Target is ${target}.</span>
    `;
    rootEl.appendChild(stepCard);

    // Controller
    const controller = new Playback({
      steps: steps,
      container: rootEl,
      onStepChange: function (stepIdx, currentStep) {
        if (!currentStep) return;
        const state = currentStep.state || {};
        const action = currentStep.action || '';
        const vars = currentStep.variables || {};

        // Update step description
        const badge = stepCard.querySelector('.ky-vis-step-badge');
        const desc = stepCard.querySelector('.ky-vis-step-desc');
        if (badge) badge.textContent = action.toUpperCase();
        if (desc) desc.textContent = currentStep.description || '';

        // Reset all cell classes
        cellNodes.forEach((cell, idx) => {
          cell.className = 'ky-array-cell';
          pointerNodes[idx].innerHTML = '';

          if (isBinary) {
            const low = typeof vars.low === 'number' ? vars.low : (state.low != null ? state.low : 0);
            const high = typeof vars.high === 'number' ? vars.high : (state.high != null ? state.high : array.length - 1);
            const mid = typeof vars.mid === 'number' ? vars.mid : state.mid;

            if (idx >= low && idx <= high) {
              cell.classList.add('in-range');
            } else {
              cell.classList.add('eliminated');
            }

            if (idx === mid) {
              cell.classList.add('mid');
              pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag ptr-mid">MID</span>';
            } else if (idx === low && idx === high) {
              pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag">L=H</span>';
            } else if (idx === low) {
              pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag ptr-low">LOW</span>';
            } else if (idx === high) {
              pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag ptr-high">HIGH</span>';
            }

            if (currentStep.status === 'found' && idx === mid) {
              cell.classList.add('found');
              cell.classList.remove('mid');
            }
          } else {
            // Linear search
            const currIdx = vars.currentIndex != null ? vars.currentIndex : (state.currentIndex != null ? state.currentIndex : -1);
            if (idx === currIdx) {
              if (currentStep.status === 'found') {
                cell.classList.add('found');
                pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag">FOUND</span>';
              } else {
                cell.classList.add('mid');
                pointerNodes[idx].innerHTML = '<span class="ky-array-pointer-tag ptr-mid">CURR</span>';
              }
            } else if (idx < currIdx) {
              cell.classList.add('eliminated');
            }
          }
        });
      }
    });

    container.appendChild(rootEl);
    return { rootEl, controller };
  }

  // ==========================================================================
  // 2. Component Builder: Sorting Visualizer (algo_anim)
  // ==========================================================================
  function mountSortingVisualizer(container, envelope, simEngine, Playback) {
    const data = envelope.data || envelope.payload || {};
    const array = Array.isArray(data.initialArray) ? data.initialArray.slice() : (Array.isArray(data.array) ? data.array.slice() : [45, 12, 89, 34, 23, 7]);
    const algo = data.algorithm || 'bubble_sort';

    let simResult;
    if (algo === 'selection_sort') {
      simResult = simEngine.simulateSelectionSort(array);
    } else if (algo === 'insertion_sort') {
      simResult = simEngine.simulateInsertionSort(array);
    } else {
      simResult = simEngine.simulateBubbleSort(array);
    }

    if (simResult && simResult.error && (!simResult.steps || simResult.steps.length === 0)) {
      throw new Error(simResult.error.message || 'Simulation error');
    }

    const steps = simResult.steps || [];
    const maxVal = Math.max(...array, 1);

    const rootEl = document.createElement('div');
    rootEl.className = 'kyana-visual-root ky-sort-visualizer';

    const header = document.createElement('div');
    header.className = 'ky-vis-header';
    header.innerHTML = `
      <div class="ky-vis-header-left">
        <span class="ky-vis-badge">${escapeHtml(algo.replace('_', ' '))}</span>
        <h4 class="ky-vis-title">${escapeHtml(envelope.title || 'Sorting Algorithm Visualizer')}</h4>
      </div>
      <div class="ky-vis-meta">
        <span class="ky-vis-meta-item">Elements: <span class="ky-vis-meta-value">${array.length}</span></span>
        <span class="ky-vis-meta-item">Steps: <span class="ky-vis-meta-value">${steps.length}</span></span>
      </div>
    `;
    rootEl.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'ky-vis-stage';

    const sortStage = document.createElement('div');
    sortStage.className = 'ky-sort-stage';

    const barNodes = [];
    array.forEach((val, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'ky-sort-bar-wrap';

      const bar = document.createElement('div');
      bar.className = 'ky-sort-bar';
      const pct = Math.max(15, Math.round((val / maxVal) * 100));
      bar.style.height = `${pct}%`;
      bar.textContent = String(val);

      const label = document.createElement('div');
      label.className = 'ky-sort-bar-label';
      label.textContent = String(idx);

      wrap.appendChild(bar);
      wrap.appendChild(label);
      sortStage.appendChild(wrap);

      barNodes.push(bar);
    });

    stage.appendChild(sortStage);
    rootEl.appendChild(stage);

    const stepCard = document.createElement('div');
    stepCard.className = 'ky-vis-step-card';
    stepCard.innerHTML = `
      <span class="ky-vis-step-badge">READY</span>
      <span class="ky-vis-step-desc">Starting ${escapeHtml(algo.replace('_', ' '))} with ${array.length} elements.</span>
    `;
    rootEl.appendChild(stepCard);

    const controller = new Playback({
      steps: steps,
      container: rootEl,
      onStepChange: function (stepIdx, currentStep) {
        if (!currentStep) return;
        const state = currentStep.state || {};
        const currArr = Array.isArray(state.array) ? state.array : array;
        const activeIdx = Array.isArray(state.activeIndices) ? state.activeIndices : [];
        const sortedIdx = Array.isArray(state.sortedIndices) ? state.sortedIndices : [];
        const action = currentStep.action || '';

        const badge = stepCard.querySelector('.ky-vis-step-badge');
        const desc = stepCard.querySelector('.ky-vis-step-desc');
        if (badge) badge.textContent = action.toUpperCase();
        if (desc) desc.textContent = currentStep.description || '';

        barNodes.forEach((bar, idx) => {
          const val = currArr[idx];
          const pct = Math.max(15, Math.round((val / maxVal) * 100));
          bar.style.height = `${pct}%`;
          bar.textContent = String(val);
          bar.className = 'ky-sort-bar';

          if (activeIdx.includes(idx)) {
            bar.classList.add(action === 'swap' ? 'swapping' : 'active');
          } else if (sortedIdx.includes(idx)) {
            bar.classList.add('sorted');
          }
        });
      }
    });

    container.appendChild(rootEl);
    return { rootEl, controller };
  }

  // ==========================================================================
  // 3. Component Builder: Stack Visualizer (dsa_linear)
  // ==========================================================================
  function mountStackVisualizer(container, envelope, simEngine, Playback) {
    const data = envelope.data || envelope.payload || {};
    const capacity = typeof data.capacity === 'number' ? data.capacity : 6;
    const operations = Array.isArray(data.operations) && data.operations.length > 0
      ? data.operations
      : [
          { op: 'push', value: '10' },
          { op: 'push', value: '25' },
          { op: 'push', value: '42' },
          { op: 'pop' },
          { op: 'push', value: '55' }
        ];

    const simResult = simEngine.simulateStackOperations(capacity, operations);
    if (simResult && simResult.error && (!simResult.steps || simResult.steps.length === 0)) {
      throw new Error(simResult.error.message || 'Simulation error');
    }
    const steps = simResult.steps || [];

    const rootEl = document.createElement('div');
    rootEl.className = 'kyana-visual-root ky-stack-visualizer';

    const header = document.createElement('div');
    header.className = 'ky-vis-header';
    header.innerHTML = `
      <div class="ky-vis-header-left">
        <span class="ky-vis-badge">Stack (LIFO)</span>
        <h4 class="ky-vis-title">${escapeHtml(envelope.title || 'Stack Data Structure')}</h4>
      </div>
      <div class="ky-vis-meta">
        <span class="ky-vis-meta-item">Capacity: <span class="ky-vis-meta-value">${capacity}</span></span>
        <span class="ky-vis-meta-item">Current Top: <span class="ky-vis-meta-value ky-top-val">-1</span></span>
      </div>
    `;
    rootEl.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'ky-vis-stage';

    const stackStage = document.createElement('div');
    stackStage.className = 'ky-stack-stage';

    const beaker = document.createElement('div');
    beaker.className = 'ky-stack-beaker';
    beaker.style.minHeight = `${Math.max(180, capacity * 42 + 20)}px`;

    const indicatorCol = document.createElement('div');
    indicatorCol.className = 'ky-stack-indicators';
    indicatorCol.innerHTML = `
      <div><strong>Discipline:</strong> Last-In, First-Out</div>
      <div class="ky-stack-size-label"><strong>Size:</strong> 0 / ${capacity}</div>
      <div class="ky-stack-alert-wrap"></div>
    `;

    stackStage.appendChild(beaker);
    stackStage.appendChild(indicatorCol);
    stage.appendChild(stackStage);
    rootEl.appendChild(stage);

    const stepCard = document.createElement('div');
    stepCard.className = 'ky-vis-step-card';
    stepCard.innerHTML = `
      <span class="ky-vis-step-badge">INIT</span>
      <span class="ky-vis-step-desc">Empty stack initialized with maximum capacity ${capacity}.</span>
    `;
    rootEl.appendChild(stepCard);

    const controller = new Playback({
      steps: steps,
      container: rootEl,
      onStepChange: function (stepIdx, currentStep) {
        if (!currentStep) return;
        const state = currentStep.state || {};
        const items = Array.isArray(state.items) ? state.items : [];
        const topIdx = typeof state.top === 'number' ? state.top : items.length - 1;
        const action = currentStep.action || '';

        const badge = stepCard.querySelector('.ky-vis-step-badge');
        const desc = stepCard.querySelector('.ky-vis-step-desc');
        if (badge) badge.textContent = action.toUpperCase();
        if (desc) desc.textContent = currentStep.description || '';

        const topValEl = header.querySelector('.ky-top-val');
        if (topValEl) topValEl.textContent = String(topIdx);

        const sizeLabel = indicatorCol.querySelector('.ky-stack-size-label');
        if (sizeLabel) sizeLabel.innerHTML = `<strong>Size:</strong> ${items.length} / ${capacity}`;

        const alertWrap = indicatorCol.querySelector('.ky-stack-alert-wrap');
        if (alertWrap) {
          if (currentStep.status === 'overflow') {
            alertWrap.innerHTML = '<div class="ky-status-alert overflow">⚠ Stack Overflow: Stack is full!</div>';
          } else if (currentStep.status === 'underflow') {
            alertWrap.innerHTML = '<div class="ky-status-alert underflow">⚠ Stack Underflow: Stack is empty!</div>';
          } else {
            alertWrap.innerHTML = '';
          }
        }

        // Render stack items
        beaker.innerHTML = '';
        items.forEach((itemVal, i) => {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'ky-stack-item' + (i === topIdx ? ' top' : '');
          itemDiv.textContent = String(itemVal) + (i === topIdx ? ' (TOP)' : '');
          beaker.appendChild(itemDiv);
        });
      }
    });

    container.appendChild(rootEl);
    return { rootEl, controller };
  }

  // ==========================================================================
  // 4. Component Builder: Queue Visualizer (dsa_linear)
  // ==========================================================================
  function mountQueueVisualizer(container, envelope, simEngine, Playback) {
    const data = envelope.data || envelope.payload || {};
    const capacity = typeof data.capacity === 'number' ? data.capacity : 6;
    const operations = Array.isArray(data.operations) && data.operations.length > 0
      ? data.operations
      : [
          { op: 'enqueue', value: 'A' },
          { op: 'enqueue', value: 'B' },
          { op: 'enqueue', value: 'C' },
          { op: 'dequeue' },
          { op: 'enqueue', value: 'D' }
        ];

    const simResult = simEngine.simulateQueueOperations(capacity, operations);
    if (simResult && simResult.error && (!simResult.steps || simResult.steps.length === 0)) {
      throw new Error(simResult.error.message || 'Simulation error');
    }
    const steps = simResult.steps || [];

    const rootEl = document.createElement('div');
    rootEl.className = 'kyana-visual-root ky-queue-visualizer';

    const header = document.createElement('div');
    header.className = 'ky-vis-header';
    header.innerHTML = `
      <div class="ky-vis-header-left">
        <span class="ky-vis-badge">Queue (FIFO)</span>
        <h4 class="ky-vis-title">${escapeHtml(envelope.title || 'Queue Data Structure')}</h4>
      </div>
      <div class="ky-vis-meta">
        <span class="ky-vis-meta-item">Capacity: <span class="ky-vis-meta-value">${capacity}</span></span>
        <span class="ky-vis-meta-item">Front: <span class="ky-vis-meta-value ky-front-val">-1</span></span>
        <span class="ky-vis-meta-item">Rear: <span class="ky-vis-meta-value ky-rear-val">-1</span></span>
      </div>
    `;
    rootEl.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'ky-vis-stage';

    const queueStage = document.createElement('div');
    queueStage.className = 'ky-queue-stage';

    const track = document.createElement('div');
    track.className = 'ky-queue-track';

    const metaRow = document.createElement('div');
    metaRow.style.fontSize = '12px';
    metaRow.style.color = 'var(--ky-vis-text-secondary)';
    metaRow.innerHTML = '◀ DEQUEUE (Front) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ENQUEUE (Rear) ◀';

    const alertWrap = document.createElement('div');
    alertWrap.className = 'ky-queue-alert-wrap';

    queueStage.appendChild(metaRow);
    queueStage.appendChild(track);
    queueStage.appendChild(alertWrap);
    stage.appendChild(queueStage);
    rootEl.appendChild(stage);

    const stepCard = document.createElement('div');
    stepCard.className = 'ky-vis-step-card';
    stepCard.innerHTML = `
      <span class="ky-vis-step-badge">INIT</span>
      <span class="ky-vis-step-desc">Empty queue initialized with capacity ${capacity}.</span>
    `;
    rootEl.appendChild(stepCard);

    const controller = new Playback({
      steps: steps,
      container: rootEl,
      onStepChange: function (stepIdx, currentStep) {
        if (!currentStep) return;
        const state = currentStep.state || {};
        const items = Array.isArray(state.items) ? state.items : [];
        const front = typeof state.front === 'number' ? state.front : -1;
        const rear = typeof state.rear === 'number' ? state.rear : -1;
        const action = currentStep.action || '';

        const badge = stepCard.querySelector('.ky-vis-step-badge');
        const desc = stepCard.querySelector('.ky-vis-step-desc');
        if (badge) badge.textContent = action.toUpperCase();
        if (desc) desc.textContent = currentStep.description || '';

        const frontEl = header.querySelector('.ky-front-val');
        const rearEl = header.querySelector('.ky-rear-val');
        if (frontEl) frontEl.textContent = String(front);
        if (rearEl) rearEl.textContent = String(rear);

        if (currentStep.status === 'overflow') {
          alertWrap.innerHTML = '<div class="ky-status-alert overflow">⚠ Queue Overflow: Queue is full!</div>';
        } else if (currentStep.status === 'underflow') {
          alertWrap.innerHTML = '<div class="ky-status-alert underflow">⚠ Queue Underflow: Queue is empty!</div>';
        } else {
          alertWrap.innerHTML = '';
        }

        track.innerHTML = '';
        if (items.length === 0) {
          track.innerHTML = '<span style="color:var(--ky-vis-text-muted);font-size:13px;padding:8px 16px;">Queue is empty</span>';
        } else {
          items.forEach((itemVal, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'ky-queue-item';
            let label = String(itemVal);
            if (idx === 0) itemDiv.classList.add('front');
            if (idx === items.length - 1) itemDiv.classList.add('rear');
            if (idx === 0 && idx === items.length - 1) {
              label += ' (F/R)';
            } else if (idx === 0) {
              label += ' (F)';
            } else if (idx === items.length - 1) {
              label += ' (R)';
            }
            itemDiv.textContent = label;
            track.appendChild(itemDiv);
          });
        }
      }
    });

    container.appendChild(rootEl);
    return { rootEl, controller };
  }

  // ==========================================================================
  // 5. Component Builder: Logic Gate Simulator & Truth Table (logic_sim, truth_table)
  // ==========================================================================
  function mountLogicVisualizer(container, envelope) {
    const data = envelope.data || envelope.payload || {};
    const engine = envelope.engine || envelope.engineId;

    // Normalize inputs & gates
    let inputs = Array.isArray(data.inputs) ? data.inputs : [
      { id: 'A', label: 'Input A', initial: 0 },
      { id: 'B', label: 'Input B', initial: 1 }
    ];

    let gateType = 'AND';
    if (Array.isArray(data.gates) && data.gates.length > 0) {
      gateType = (data.gates[0].type || 'AND').toUpperCase();
    } else if (typeof data.expression === 'string') {
      const up = data.expression.toUpperCase();
      if (up.includes('XOR')) gateType = 'XOR';
      else if (up.includes('OR')) gateType = 'OR';
      else if (up.includes('NOT')) gateType = 'NOT';
      else if (up.includes('NAND')) gateType = 'NAND';
      else if (up.includes('NOR')) gateType = 'NOR';
      else gateType = 'AND';
    }

    if (gateType === 'NOT' && inputs.length > 1) {
      inputs = [inputs[0]];
    }

    // Input state store
    const inputState = {};
    inputs.forEach(inp => {
      inputState[inp.id] = Number(inp.initial) ? 1 : 0;
    });

    const rootEl = document.createElement('div');
    rootEl.className = 'kyana-visual-root ky-logic-visualizer';

    const header = document.createElement('div');
    header.className = 'ky-vis-header';
    header.innerHTML = `
      <div class="ky-vis-header-left">
        <span class="ky-vis-badge">Digital Logic</span>
        <h4 class="ky-vis-title">${escapeHtml(envelope.title || `${gateType} Gate Simulation`)}</h4>
      </div>
      <div class="ky-vis-meta">
        <span class="ky-vis-meta-item">Type: <span class="ky-vis-meta-value">${gateType}</span></span>
        <span class="ky-vis-meta-item">Output: <span class="ky-vis-meta-value ky-output-badge">0</span></span>
      </div>
    `;
    rootEl.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'ky-vis-stage';

    const logicStage = document.createElement('div');
    logicStage.className = 'ky-logic-stage';

    // Build SVG Circuit
    const svgWrap = document.createElement('div');
    svgWrap.style.width = '100%';
    svgWrap.style.maxWidth = '460px';
    svgWrap.style.margin = '0 auto';

    // Gate geometry definitions
    let gatePath = '';
    if (gateType === 'AND' || gateType === 'NAND') {
      gatePath = 'M 140 30 L 170 30 A 30 30 0 0 1 170 90 L 140 90 Z';
    } else if (gateType === 'OR' || gateType === 'NOR') {
      gatePath = 'M 130 30 Q 155 30 190 60 Q 155 90 130 90 Q 145 60 130 30 Z';
    } else if (gateType === 'XOR' || gateType === 'XNOR') {
      gatePath = 'M 135 30 Q 160 30 195 60 Q 160 90 135 90 Q 150 60 135 30 Z M 125 30 Q 140 60 125 90';
    } else if (gateType === 'NOT') {
      gatePath = 'M 140 30 L 185 60 L 140 90 Z';
    }

    const hasBubble = ['NOT', 'NAND', 'NOR', 'XNOR'].includes(gateType);
    const bubbleCx = gateType === 'NOT' ? 190 : (gateType.startsWith('X') ? 200 : 195);

    svgWrap.innerHTML = `
      <svg class="ky-logic-circuit-svg" viewBox="0 0 340 120" width="100%" height="120" xmlns="http://www.w3.org/2000/svg">
        <!-- Input Wire A -->
        <path class="ky-logic-wire wire-a" d="M 80 45 L 140 45" />
        <!-- Input Wire B -->
        ${inputs.length > 1 ? '<path class="ky-logic-wire wire-b" d="M 80 75 L 140 75" />' : ''}
        
        <!-- Gate Outline -->
        <path class="ky-logic-gate-body" d="${gatePath}" />
        ${hasBubble ? `<circle class="ky-logic-gate-body" cx="${bubbleCx}" cy="60" r="5" />` : ''}

        <!-- Output Wire Y -->
        <path class="ky-logic-wire wire-out" d="M ${hasBubble ? bubbleCx + 5 : 195} 60 L 260 60" />

        <!-- Input Toggle A -->
        <g class="ky-logic-toggle-btn toggle-a" transform="translate(20, 30)">
          <rect class="ky-logic-toggle-pill pill-a" width="50" height="30" />
          <text class="ky-logic-toggle-text text-a" x="25" y="15">A: 0</text>
        </g>

        <!-- Input Toggle B -->
        ${inputs.length > 1 ? `
        <g class="ky-logic-toggle-btn toggle-b" transform="translate(20, 65)">
          <rect class="ky-logic-toggle-pill pill-b" width="50" height="30" />
          <text class="ky-logic-toggle-text text-b" x="25" y="15">B: 0</text>
        </g>` : ''}

        <!-- Output Display Pill -->
        <g transform="translate(270, 45)">
          <rect class="ky-logic-toggle-pill pill-out" width="50" height="30" />
          <text class="ky-logic-toggle-text text-out" x="25" y="15">Y: 0</text>
        </g>
      </svg>
    `;

    logicStage.appendChild(svgWrap);

    // Build Truth Table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'ky-truth-table-wrap';

    const numInputs = inputs.length;
    const totalRows = Math.pow(2, numInputs);
    let tableHtml = '<table class="ky-truth-table"><thead><tr>';
    inputs.forEach(inp => {
      tableHtml += `<th>${escapeHtml(inp.id)}</th>`;
    });
    tableHtml += `<th>Output (Y = ${gateType})</th></tr></thead><tbody>`;

    const rowConfigs = [];
    for (let r = 0; r < totalRows; r++) {
      const rowVals = {};
      tableHtml += `<tr class="ky-tt-row" data-row-idx="${r}">`;
      for (let c = 0; c < numInputs; c++) {
        const bit = (r >> (numInputs - 1 - c)) & 1;
        rowVals[inputs[c].id] = bit;
        tableHtml += `<td>${bit}</td>`;
      }

      // Compute output deterministically
      let outBit = 0;
      const vA = rowVals[inputs[0].id] || 0;
      const vB = numInputs > 1 ? (rowVals[inputs[1].id] || 0) : 0;

      if (gateType === 'AND') outBit = (vA & vB);
      else if (gateType === 'OR') outBit = (vA | vB);
      else if (gateType === 'NOT') outBit = vA ? 0 : 1;
      else if (gateType === 'NAND') outBit = (vA & vB) ? 0 : 1;
      else if (gateType === 'NOR') outBit = (vA | vB) ? 0 : 1;
      else if (gateType === 'XOR') outBit = (vA ^ vB);
      else if (gateType === 'XNOR') outBit = (vA ^ vB) ? 0 : 1;

      rowConfigs.push({ rowVals, outBit });
      tableHtml += `<td><strong>${outBit}</strong></td></tr>`;
    }
    tableHtml += '</tbody></table>';
    tableWrap.innerHTML = tableHtml;

    logicStage.appendChild(tableWrap);
    stage.appendChild(logicStage);
    rootEl.appendChild(stage);

    // Evaluator & Refresh function
    function updateCircuit() {
      const valA = inputState['A'] || 0;
      const valB = numInputs > 1 ? (inputState['B'] || 0) : 0;

      let out = 0;
      if (gateType === 'AND') out = (valA & valB);
      else if (gateType === 'OR') out = (valA | valB);
      else if (gateType === 'NOT') out = valA ? 0 : 1;
      else if (gateType === 'NAND') out = (valA & valB) ? 0 : 1;
      else if (gateType === 'NOR') out = (valA | valB) ? 0 : 1;
      else if (gateType === 'XOR') out = (valA ^ valB);
      else if (gateType === 'XNOR') out = (valA ^ valB) ? 0 : 1;

      // Update SVG
      const pillA = svgWrap.querySelector('.pill-a');
      const textA = svgWrap.querySelector('.text-a');
      const wireA = svgWrap.querySelector('.wire-a');
      if (pillA) pillA.classList.toggle('active', valA === 1);
      if (textA) textA.textContent = `A: ${valA}`;
      if (wireA) wireA.classList.toggle('active', valA === 1);

      if (numInputs > 1) {
        const pillB = svgWrap.querySelector('.pill-b');
        const textB = svgWrap.querySelector('.text-b');
        const wireB = svgWrap.querySelector('.wire-b');
        if (pillB) pillB.classList.toggle('active', valB === 1);
        if (textB) textB.textContent = `B: ${valB}`;
        if (wireB) wireB.classList.toggle('active', valB === 1);
      }

      const pillOut = svgWrap.querySelector('.pill-out');
      const textOut = svgWrap.querySelector('.text-out');
      const wireOut = svgWrap.querySelector('.wire-out');
      const gateBody = svgWrap.querySelector('.ky-logic-gate-body');

      if (pillOut) pillOut.classList.toggle('active', out === 1);
      if (textOut) textOut.textContent = `Y: ${out}`;
      if (wireOut) wireOut.classList.toggle('active', out === 1);
      if (gateBody) gateBody.classList.toggle('active', out === 1);

      const outBadge = header.querySelector('.ky-output-badge');
      if (outBadge) outBadge.textContent = String(out);

      // Highlight corresponding row in truth table
      const rows = tableWrap.querySelectorAll('.ky-tt-row');
      rows.forEach((rEl, idx) => {
        const cfg = rowConfigs[idx];
        const match = inputs.every(inp => cfg.rowVals[inp.id] === inputState[inp.id]);
        rEl.classList.toggle('active-row', match);
      });
    }

    // Bind click events on inputs
    const btnA = svgWrap.querySelector('.toggle-a');
    if (btnA) {
      btnA.addEventListener('click', () => {
        inputState['A'] = inputState['A'] === 1 ? 0 : 1;
        updateCircuit();
      });
    }

    if (numInputs > 1) {
      const btnB = svgWrap.querySelector('.toggle-b');
      if (btnB) {
        btnB.addEventListener('click', () => {
          inputState['B'] = inputState['B'] === 1 ? 0 : 1;
          updateCircuit();
        });
      }
    }

    // Initial render
    updateCircuit();

    container.appendChild(rootEl);
    return { rootEl, controller: null, setInput: (id, val) => { inputState[id] = val; updateCircuit(); } };
  }

  // ==========================================================================
  // Pilot Telemetry & Student Feedback Helper
  // ==========================================================================
  function sendPilotBeacon(endpoint, data) {
    try {
      if (typeof fetch === 'function') {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function sendPilotFeedback(data, onSuccess, onError) {
    try {
      if (typeof fetch !== 'function') {
        if (typeof onError === 'function') onError(new Error('Fetch unavailable'));
        return;
      }
      fetch('/api/kyana/telemetry/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true
      })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (json) {
        if (json && json.ok !== false) {
          if (typeof onSuccess === 'function') onSuccess(json);
        } else {
          throw new Error(json && json.message ? json.message : 'Feedback recording failed');
        }
      })
      .catch(function (err) {
        if (typeof onError === 'function') onError(err);
      });
    } catch (e) {
      if (typeof onError === 'function') onError(e);
    }
  }

  function attachFeedbackBar(rootEl, instanceId, engine) {
    if (!rootEl || !instanceId || rootEl.querySelector('.ky-vis-feedback-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'ky-vis-feedback-bar';
    bar.setAttribute('data-instance-id', instanceId);
    bar.innerHTML = `
      <div class="ky-vis-feedback-main">
        <span class="ky-vis-feedback-prompt">Was this simulation helpful?</span>
        <div class="ky-vis-feedback-btns">
          <button type="button" class="ky-vis-feedback-btn ky-fb-helpful" data-rating="helpful" aria-label="Mark simulation as helpful" title="Helpful">
            <span class="ky-fb-icon">👍</span> <span>Helpful</span>
          </button>
          <button type="button" class="ky-vis-feedback-btn ky-fb-unhelpful" data-rating="unhelpful" aria-label="Mark simulation as not helpful" title="Not helpful">
            <span class="ky-fb-icon">👎</span> <span>Not helpful</span>
          </button>
        </div>
      </div>
      <div class="ky-vis-feedback-reasons" style="display:none;" aria-label="Optional feedback reason"></div>
      <div class="ky-vis-feedback-ack" style="display:none;">
        <span class="ky-vis-feedback-ack-text">✓ Thanks for your feedback!</span>
      </div>
    `;

    const helpfulBtn = bar.querySelector('.ky-fb-helpful');
    const unhelpfulBtn = bar.querySelector('.ky-fb-unhelpful');
    const reasonsWrap = bar.querySelector('.ky-vis-feedback-reasons');
    const ackWrap = bar.querySelector('.ky-vis-feedback-ack');
    const ackText = bar.querySelector('.ky-vis-feedback-ack-text');

    let currentRating = null;

    function handleVote(rating) {
      if (currentRating === rating) return;
      const prevRating = currentRating;
      currentRating = rating;

      if (rating === 'helpful') {
        helpfulBtn.classList.add('active');
        unhelpfulBtn.classList.remove('active');
      } else {
        unhelpfulBtn.classList.add('active');
        helpfulBtn.classList.remove('active');
      }

      sendPilotFeedback(
        { instanceId: instanceId, rating: rating },
        function onSuccess() {
          ackWrap.style.display = 'block';
          ackWrap.classList.remove('ky-vis-feedback-error');
          if (ackText) ackText.textContent = '✓ Thanks for your feedback!';

          const tags = rating === 'helpful'
            ? [
                { label: 'Clear explanation', val: 'clear_explanation' },
                { label: 'Easy to follow', val: 'easy_to_follow' },
                { label: 'Interactive helpful', val: 'interactive_helpful' }
              ]
            : [
                { label: 'Confusing', val: 'confusing' },
                { label: 'Broken animation', val: 'broken_animation' },
                { label: 'Incorrect step', val: 'incorrect_step' },
                { label: 'Too fast / slow', val: 'too_fast' }
              ];

          reasonsWrap.innerHTML = '';
          tags.forEach(function (t) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ky-vis-reason-pill';
            btn.textContent = t.label;
            btn.addEventListener('click', function (e) {
              e.preventDefault();
              reasonsWrap.querySelectorAll('.ky-vis-reason-pill').forEach(function (p) {
                p.classList.remove('active');
              });
              btn.classList.add('active');

              sendPilotFeedback(
                { instanceId: instanceId, rating: currentRating, reason: t.val },
                function onReasonSuccess() {
                  ackWrap.style.display = 'block';
                  ackWrap.classList.remove('ky-vis-feedback-error');
                  if (ackText) ackText.textContent = '✓ Thanks for your feedback!';
                },
                function onReasonError() {
                  btn.classList.remove('active');
                  ackWrap.style.display = 'block';
                  ackWrap.classList.add('ky-vis-feedback-error');
                  if (ackText) ackText.textContent = 'Could not save tag. Please retry.';
                }
              );
            });
            reasonsWrap.appendChild(btn);
          });
          reasonsWrap.style.display = 'flex';
        },
        function onError() {
          currentRating = prevRating;
          helpfulBtn.classList.remove('active');
          unhelpfulBtn.classList.remove('active');
          if (prevRating === 'helpful') helpfulBtn.classList.add('active');
          else if (prevRating === 'unhelpful') unhelpfulBtn.classList.add('active');

          ackWrap.style.display = 'block';
          ackWrap.classList.add('ky-vis-feedback-error');
          if (ackText) ackText.textContent = 'Feedback could not be recorded. Please retry.';
        }
      );
    }

    helpfulBtn.addEventListener('click', function (e) {
      e.preventDefault();
      handleVote('helpful');
    });

    unhelpfulBtn.addEventListener('click', function (e) {
      e.preventDefault();
      handleVote('unhelpful');
    });

    rootEl.appendChild(bar);
  }

  // ==========================================================================
  // Primary Visualizer Mount System
  // ==========================================================================
  const KyanaVisualRenderer = {
    /**
     * Mount an educational visualizer into container
     * @param {HTMLElement} container
     * @param {Object} envelope - Validated kyana.visual.v1 payload
     * @returns {Object} Instance handle { id, engine, destroy(), ... }
     */
    mount: function (container, envelope) {
      if (!container) {
        throw new Error('[KyanaVisualRenderer] Target container is required.');
      }

      const env = envelope || {};
      const engine = String(env.engine || env.engineId || '').toLowerCase().trim();
      const instanceId = generateInstanceId(engine || 'vis');

      const SimEngine = getSimEngine();
      const Playback = getPlaybackController();

      let mountedHandle = null;

      try {
        const data = env.data || env.payload || {};
        env.data = data;

        if (engine === 'algo_anim') {
          const algo = data.algorithm || '';
          if (['binary_search', 'linear_search'].includes(algo)) {
            mountedHandle = mountSearchVisualizer(container, env, SimEngine, Playback);
          } else if (['bubble_sort', 'selection_sort', 'insertion_sort'].includes(algo)) {
            mountedHandle = mountSortingVisualizer(container, env, SimEngine, Playback);
          }
        } else if (engine === 'dsa_linear') {
          const struct = data.structure || '';
          if (struct === 'stack') {
            mountedHandle = mountStackVisualizer(container, env, SimEngine, Playback);
          } else if (struct === 'queue') {
            mountedHandle = mountQueueVisualizer(container, env, SimEngine, Playback);
          }
        } else if (engine === 'logic_sim' || engine === 'truth_table') {
          mountedHandle = mountLogicVisualizer(container, env);
        }

        // If no matching handler, render safe fallback
        if (!mountedHandle) {
          mountedHandle = this.renderFallback(container, env, 'Engine or algorithm not supported in this visualizer milestone.');
        }
      } catch (err) {
        console.error('[KyanaVisualRenderer] Mounting failed:', err);
        mountedHandle = this.renderFallback(container, env, err.message || 'Visualizer rendering error');
      }

      // Attach feedback bar
      if (mountedHandle && mountedHandle.rootEl) {
        attachFeedbackBar(mountedHandle.rootEl, instanceId, engine);
      }

      // Record interaction beacon on controls usage (once per instance)
      let interactionLogged = false;
      function recordUserInteraction() {
        if (interactionLogged) return;
        interactionLogged = true;
        sendPilotBeacon('/api/kyana/telemetry/interaction', { instanceId: instanceId });
      }

      if (mountedHandle && mountedHandle.controller) {
        const ctrlEl = mountedHandle.controller._domElement;
        if (ctrlEl) {
          ctrlEl.addEventListener('click', recordUserInteraction, { passive: true });
        }
      }

      if (mountedHandle && mountedHandle.rootEl && (engine === 'logic_sim' || engine === 'truth_table')) {
        mountedHandle.rootEl.addEventListener('click', function (e) {
          if (e.target && (e.target.closest('.ky-logic-input-btn') || e.target.closest('.ky-tt-row'))) {
            recordUserInteraction();
          }
        }, { passive: true });
      }

      // Send initial lifecycle telemetry event
      const isFallback = mountedHandle && mountedHandle.rootEl && mountedHandle.rootEl.classList.contains('kyana-visual-fallback');
      sendPilotBeacon('/api/kyana/telemetry/event', {
        instanceId: instanceId,
        engineId: engine,
        subjectCode: env.subjectCode || env.subject || null,
        semesterNo: env.semesterNo || env.semester || null,
        selected: true,
        validationPassed: !isFallback,
        renderPassed: !isFallback,
        controlsUsed: false,
        latencyMs: Number(env.latencyMs || 0)
      });

      // Instance handle wrapper
      const instance = {
        id: instanceId,
        engine: engine,
        container: container,
        rootEl: mountedHandle.rootEl,
        controller: mountedHandle.controller || null,
        getCurrentStep: function () {
          return this.controller ? this.controller.getState() : null;
        },
        setStep: function (idx) {
          if (this.controller) this.controller.goToStep(idx, true);
        },
        destroy: function () {
          if (this.controller && typeof this.controller.destroy === 'function') {
            this.controller.destroy();
            this.controller = null;
          }
          if (this.rootEl && this.rootEl.parentNode) {
            this.rootEl.parentNode.removeChild(this.rootEl);
          }
          activeInstances.delete(instanceId);
        }
      };

      activeInstances.set(instanceId, instance);
      return instance;
    },

    /**
     * Render safe fallback if visualizer fails or is unsupported
     */
    renderFallback: function (container, envelope, reason) {
      const fallbackDiv = document.createElement('div');
      fallbackDiv.className = 'kyana-visual-fallback';
      const rawFallback = envelope && envelope.fallback;
      const fallbackMd = (typeof rawFallback === 'object' && rawFallback !== null)
        ? (rawFallback.content || rawFallback.markdown || '(Visual representation unavailable)')
        : (rawFallback || '(Visual representation unavailable)');
      fallbackDiv.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;color:var(--ky-vis-text-primary);">📊 ${escapeHtml(envelope && envelope.title || 'Academic Visualizer')}</div>
        <div style="color:var(--ky-vis-text-secondary);">${escapeHtml(fallbackMd)}</div>
        <div style="font-size:11px;color:var(--ky-vis-text-muted);margin-top:8px;">${escapeHtml(reason || '')}</div>
      `;
      container.appendChild(fallbackDiv);

      const engine = String(envelope && (envelope.engine || envelope.engineId) || 'unknown').toLowerCase();
      const fbInstanceId = generateInstanceId(engine || 'vis_fb');
      sendPilotBeacon('/api/kyana/telemetry/event', {
        instanceId: fbInstanceId,
        engineId: engine,
        subjectCode: envelope && (envelope.subjectCode || envelope.subject) || null,
        semesterNo: envelope && (envelope.semesterNo || envelope.semester) || null,
        selected: true,
        validationPassed: false,
        renderPassed: false,
        failureReason: reason || 'FALLBACK_RENDERED'
      });

      return { rootEl: fallbackDiv, controller: null };
    },

    /**
     * Destroy all active visualizer instances
     */
    destroyAll: function () {
      activeInstances.forEach(inst => inst.destroy());
      activeInstances.clear();
    },

    /**
     * Evaluate boolean expressions safely (deterministic)
     */
    evaluateBoolean: evaluateBooleanExpression
  };

  return KyanaVisualRenderer;
}));
