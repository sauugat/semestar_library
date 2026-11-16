/**
 * Kyana Academic Deterministic Simulation Engine
 * Client-side, pure mathematical and algorithmic simulation adapters.
 * All algorithms compute mathematically exact and deterministic state transitions
 * without LLM generation, random behaviors, or caller input mutation.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KyanaSimulationEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ARRAY_SIZE = 20;
  const MAX_STACK_QUEUE_CAPACITY = 15;
  const MAX_OPERATIONS_COUNT = 20;

  /**
   * Helper: Deep clones array or primitive object to prevent mutation.
   */
  function clone(item) {
    if (item === undefined || item === null) return item;
    return JSON.parse(JSON.stringify(item));
  }

  /**
   * Helper: Validates a numeric array.
   */
  function validateNumericArray(arr, name = 'array', minLen = 1, maxLen = MAX_ARRAY_SIZE) {
    if (!Array.isArray(arr)) {
      return { valid: false, error: `${name} must be an array.` };
    }
    if (arr.length < minLen || arr.length > maxLen) {
      return { valid: false, error: `${name} length must be between ${minLen} and ${maxLen}. Received ${arr.length}.` };
    }
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { valid: false, error: `${name}[${i}] must be a finite number. Received ${v}.` };
      }
    }
    return { valid: true };
  }

  // ==========================================================================
  // 1. Binary Search
  // ==========================================================================
  /**
   * Simulates Binary Search step-by-step.
   * Rejects unsorted arrays instead of silently sorting them.
   *
   * @param {number[]} rawArray - Monotonically non-decreasing sorted array.
   * @param {number} target - Numeric search target.
   * @returns {object} SimulationResult
   */
  function simulateBinarySearch(rawArray, target) {
    const arrayValidation = validateNumericArray(rawArray, 'array', 0, MAX_ARRAY_SIZE);
    if (!arrayValidation.valid) {
      return {
        initialState: { array: clone(rawArray), target },
        steps: [],
        operation: 'binary_search',
        variables: {},
        finalState: { array: clone(rawArray), target },
        completed: false,
        error: { code: 'INVALID_INPUT', message: arrayValidation.error }
      };
    }

    if (typeof target !== 'number' || !Number.isFinite(target)) {
      return {
        initialState: { array: clone(rawArray), target },
        steps: [],
        operation: 'binary_search',
        variables: {},
        finalState: { array: clone(rawArray), target },
        completed: false,
        error: { code: 'INVALID_TARGET', message: 'Target must be a finite number.' }
      };
    }

    const arr = clone(rawArray);

    // Explicit check: Array must be sorted ascending
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] > arr[i + 1]) {
        return {
          initialState: { array: arr, target },
          steps: [],
          operation: 'binary_search',
          variables: {},
          finalState: { array: arr, target },
          completed: false,
          error: {
            code: 'UNSORTED_ARRAY',
            message: `Binary Search requires a sorted array. Element at index ${i} (${arr[i]}) is greater than element at index ${i + 1} (${arr[i + 1]}).`
          }
        };
      }
    }

    const steps = [];
    let low = 0;
    let high = arr.length - 1;
    let stepNumber = 1;
    let found = false;
    let foundIndex = -1;

    // Handle empty array
    if (arr.length === 0) {
      steps.push({
        stepNumber: 1,
        action: 'empty_check',
        description: 'Array is empty; target cannot be found.',
        state: { array: [], target, low: 0, high: -1, mid: -1 },
        variables: { low: 0, high: -1, mid: -1 },
        status: 'not_found'
      });
      return {
        initialState: { array: [], target },
        steps,
        operation: 'binary_search',
        variables: { low: 0, high: -1, mid: -1 },
        finalState: { array: [], target, found: false, foundIndex: -1 },
        completed: true,
        error: null
      };
    }

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midVal = arr[mid];

      if (midVal === target) {
        found = true;
        foundIndex = mid;
        steps.push({
          stepNumber: stepNumber++,
          action: 'match',
          description: `Checked mid index ${mid} (${midVal}). Target ${target} found!`,
          state: { array: clone(arr), target, low, high, mid, midVal },
          variables: { low, high, mid, midVal },
          status: 'found'
        });
        break;
      } else if (midVal < target) {
        steps.push({
          stepNumber: stepNumber++,
          action: 'compare_less',
          description: `Checked mid index ${mid} (${midVal}) < ${target}. Search right half: low = ${mid + 1}.`,
          state: { array: clone(arr), target, low, high, mid, midVal },
          variables: { low, high, mid, midVal },
          status: 'too_low'
        });
        low = mid + 1;
      } else {
        steps.push({
          stepNumber: stepNumber++,
          action: 'compare_greater',
          description: `Checked mid index ${mid} (${midVal}) > ${target}. Search left half: high = ${mid - 1}.`,
          state: { array: clone(arr), target, low, high, mid, midVal },
          variables: { low, high, mid, midVal },
          status: 'too_high'
        });
        high = mid - 1;
      }
    }

    if (!found) {
      steps.push({
        stepNumber: stepNumber++,
        action: 'exhausted',
        description: `Search interval exhausted (low=${low} > high=${high}). Target ${target} is not in array.`,
        state: { array: clone(arr), target, low, high, mid: -1 },
        variables: { low, high, mid: -1 },
        status: 'not_found'
      });
    }

    return {
      initialState: { array: clone(rawArray), target },
      steps,
      operation: 'binary_search',
      variables: { low, high, foundIndex },
      finalState: { array: clone(arr), target, found, foundIndex },
      completed: true,
      error: null
    };
  }

  // ==========================================================================
  // 2. Linear Search
  // ==========================================================================
  /**
   * Simulates Linear Search step-by-step.
   *
   * @param {number[]} rawArray
   * @param {number} target
   * @returns {object} SimulationResult
   */
  function simulateLinearSearch(rawArray, target) {
    const arrayValidation = validateNumericArray(rawArray, 'array', 0, MAX_ARRAY_SIZE);
    if (!arrayValidation.valid) {
      return {
        initialState: { array: clone(rawArray), target },
        steps: [],
        operation: 'linear_search',
        variables: {},
        finalState: { array: clone(rawArray), target },
        completed: false,
        error: { code: 'INVALID_INPUT', message: arrayValidation.error }
      };
    }

    if (typeof target !== 'number' || !Number.isFinite(target)) {
      return {
        initialState: { array: clone(rawArray), target },
        steps: [],
        operation: 'linear_search',
        variables: {},
        finalState: { array: clone(rawArray), target },
        completed: false,
        error: { code: 'INVALID_TARGET', message: 'Target must be a finite number.' }
      };
    }

    const arr = clone(rawArray);
    const steps = [];
    let found = false;
    let foundIndex = -1;

    if (arr.length === 0) {
      steps.push({
        stepNumber: 1,
        action: 'empty_check',
        description: 'Array is empty; target cannot be found.',
        state: { array: [], target, currentIndex: -1 },
        variables: { currentIndex: -1 },
        status: 'not_found'
      });
      return {
        initialState: { array: [], target },
        steps,
        operation: 'linear_search',
        variables: { currentIndex: -1, comparisons: 0 },
        finalState: { array: [], target, found: false, foundIndex: -1 },
        completed: true,
        error: null
      };
    }

    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (val === target) {
        found = true;
        foundIndex = i;
        steps.push({
          stepNumber: i + 1,
          action: 'match',
          description: `Inspecting index ${i} (${val}) == ${target}. Target found!`,
          state: { array: clone(arr), target, currentIndex: i, currentVal: val },
          variables: { currentIndex: i, currentVal: val, comparisons: i + 1 },
          status: 'found'
        });
        break;
      } else {
        steps.push({
          stepNumber: i + 1,
          action: 'compare_mismatch',
          description: `Inspecting index ${i} (${val}) != ${target}. Advancing to next element.`,
          state: { array: clone(arr), target, currentIndex: i, currentVal: val },
          variables: { currentIndex: i, currentVal: val, comparisons: i + 1 },
          status: 'comparing'
        });
      }
    }

    if (!found) {
      steps.push({
        stepNumber: steps.length + 1,
        action: 'not_found',
        description: `Scanned all ${arr.length} elements. Target ${target} is not in array.`,
        state: { array: clone(arr), target, currentIndex: arr.length },
        variables: { currentIndex: arr.length, comparisons: arr.length },
        status: 'not_found'
      });
    }

    return {
      initialState: { array: clone(rawArray), target },
      steps,
      operation: 'linear_search',
      variables: { foundIndex, comparisons: found ? foundIndex + 1 : arr.length },
      finalState: { array: clone(arr), target, found, foundIndex },
      completed: true,
      error: null
    };
  }

  // ==========================================================================
  // 3. Bubble Sort
  // ==========================================================================
  /**
   * Simulates Bubble Sort with atomic comparison and swap state transitions.
   *
   * @param {number[]} rawArray
   * @returns {object} SimulationResult
   */
  function simulateBubbleSort(rawArray) {
    const arrayValidation = validateNumericArray(rawArray, 'array', 0, MAX_ARRAY_SIZE);
    if (!arrayValidation.valid) {
      return {
        initialState: { array: clone(rawArray) },
        steps: [],
        operation: 'bubble_sort',
        variables: {},
        finalState: { array: clone(rawArray) },
        completed: false,
        error: { code: 'INVALID_INPUT', message: arrayValidation.error }
      };
    }

    const arr = clone(rawArray);
    const steps = [];
    const n = arr.length;
    let stepNumber = 1;
    let totalComparisons = 0;
    let totalSwaps = 0;

    if (n <= 1) {
      steps.push({
        stepNumber: 1,
        action: 'already_sorted',
        description: n === 0 ? 'Array is empty; already sorted.' : 'Array has 1 element; already sorted.',
        state: { array: clone(arr), sortedIndices: n === 1 ? [0] : [] },
        variables: { i: 0, j: 0 },
        status: 'sorted'
      });
      return {
        initialState: { array: clone(rawArray) },
        steps,
        operation: 'bubble_sort',
        variables: { totalComparisons: 0, totalSwaps: 0 },
        finalState: { array: clone(arr), isSorted: true },
        completed: true,
        error: null
      };
    }

    const sortedIndices = [];

    for (let i = 0; i < n - 1; i++) {
      let swappedInPass = false;
      for (let j = 0; j < n - i - 1; j++) {
        totalComparisons++;
        const shouldSwap = arr[j] > arr[j + 1];

        steps.push({
          stepNumber: stepNumber++,
          action: 'compare',
          description: `Comparing A[${j}] (${arr[j]}) and A[${j + 1}] (${arr[j + 1]}). ${shouldSwap ? 'Requires swap.' : 'In order.'}`,
          state: { array: clone(arr), activeIndices: [j, j + 1], sortedIndices: clone(sortedIndices) },
          variables: { pass: i, j, shouldSwap, totalComparisons, totalSwaps },
          status: 'comparing'
        });

        if (shouldSwap) {
          const temp = arr[j];
          arr[j] = arr[j + 1];
          arr[j + 1] = temp;
          swappedInPass = true;
          totalSwaps++;

          steps.push({
            stepNumber: stepNumber++,
            action: 'swap',
            description: `Swapped A[${j}] and A[${j + 1}]. Array is now [${arr.join(', ')}].`,
            state: { array: clone(arr), activeIndices: [j, j + 1], sortedIndices: clone(sortedIndices) },
            variables: { pass: i, j, totalComparisons, totalSwaps },
            status: 'swapping'
          });
        }
      }

      sortedIndices.unshift(n - i - 1);

      steps.push({
        stepNumber: stepNumber++,
        action: 'pass_complete',
        description: `Pass ${i + 1} complete. Element at index ${n - i - 1} (${arr[n - i - 1]}) is in its final sorted position.`,
        state: { array: clone(arr), sortedIndices: clone(sortedIndices) },
        variables: { pass: i, sortedElementIndex: n - i - 1 },
        status: 'sorted'
      });

      if (!swappedInPass) {
        steps.push({
          stepNumber: stepNumber++,
          action: 'early_exit',
          description: `No swaps occurred during pass ${i + 1}. Array is fully sorted early.`,
          state: { array: clone(arr), sortedIndices: Array.from({ length: n }, (_, k) => k) },
          variables: { pass: i, totalComparisons, totalSwaps },
          status: 'sorted'
        });
        break;
      }
    }

    return {
      initialState: { array: clone(rawArray) },
      steps,
      operation: 'bubble_sort',
      variables: { totalComparisons, totalSwaps },
      finalState: { array: clone(arr), isSorted: true },
      completed: true,
      error: null
    };
  }

  // ==========================================================================
  // 4. Selection Sort
  // ==========================================================================
  /**
   * Simulates Selection Sort step-by-step.
   *
   * @param {number[]} rawArray
   * @returns {object} SimulationResult
   */
  function simulateSelectionSort(rawArray) {
    const arrayValidation = validateNumericArray(rawArray, 'array', 0, MAX_ARRAY_SIZE);
    if (!arrayValidation.valid) {
      return {
        initialState: { array: clone(rawArray) },
        steps: [],
        operation: 'selection_sort',
        variables: {},
        finalState: { array: clone(rawArray) },
        completed: false,
        error: { code: 'INVALID_INPUT', message: arrayValidation.error }
      };
    }

    const arr = clone(rawArray);
    const steps = [];
    const n = arr.length;
    let stepNumber = 1;
    let totalComparisons = 0;
    let totalSwaps = 0;
    const sortedIndices = [];

    if (n <= 1) {
      steps.push({
        stepNumber: 1,
        action: 'already_sorted',
        description: n === 0 ? 'Array is empty; already sorted.' : 'Array has 1 element; already sorted.',
        state: { array: clone(arr), sortedIndices: n === 1 ? [0] : [] },
        variables: {},
        status: 'sorted'
      });
      return {
        initialState: { array: clone(rawArray) },
        steps,
        operation: 'selection_sort',
        variables: { totalComparisons: 0, totalSwaps: 0 },
        finalState: { array: clone(arr), isSorted: true },
        completed: true,
        error: null
      };
    }

    for (let i = 0; i < n - 1; i++) {
      let minIdx = i;

      steps.push({
        stepNumber: stepNumber++,
        action: 'start_pass',
        description: `Starting pass ${i + 1}. Current minimum assumed at index ${i} (${arr[i]}).`,
        state: { array: clone(arr), activeIndices: [i], sortedIndices: clone(sortedIndices), minIndex: minIdx },
        variables: { i, minIdx, currentVal: arr[minIdx] },
        status: 'comparing'
      });

      for (let j = i + 1; j < n; j++) {
        totalComparisons++;
        const isNewMin = arr[j] < arr[minIdx];

        steps.push({
          stepNumber: stepNumber++,
          action: 'compare',
          description: `Comparing A[${j}] (${arr[j]}) with current min A[${minIdx}] (${arr[minIdx]}). ${isNewMin ? 'Found new minimum!' : 'No change.'}`,
          state: { array: clone(arr), activeIndices: [j, minIdx], sortedIndices: clone(sortedIndices), minIndex: minIdx },
          variables: { i, j, minIdx, isNewMin, totalComparisons },
          status: 'comparing'
        });

        if (isNewMin) {
          minIdx = j;
          steps.push({
            stepNumber: stepNumber++,
            action: 'update_min',
            description: `Updated minimum index to ${minIdx} (${arr[minIdx]}).`,
            state: { array: clone(arr), activeIndices: [minIdx], sortedIndices: clone(sortedIndices), minIndex: minIdx },
            variables: { i, j, minIdx, currentMinVal: arr[minIdx] },
            status: 'comparing'
          });
        }
      }

      if (minIdx !== i) {
        const temp = arr[i];
        arr[i] = arr[minIdx];
        arr[minIdx] = temp;
        totalSwaps++;

        steps.push({
          stepNumber: stepNumber++,
          action: 'swap',
          description: `Swapped minimum element ${arr[i]} into index ${i} with ${temp}.`,
          state: { array: clone(arr), activeIndices: [i, minIdx], sortedIndices: clone(sortedIndices) },
          variables: { i, swappedWith: minIdx, totalSwaps },
          status: 'swapping'
        });
      } else {
        steps.push({
          stepNumber: stepNumber++,
          action: 'no_swap_needed',
          description: `Minimum element is already at index ${i} (${arr[i]}). No swap needed.`,
          state: { array: clone(arr), sortedIndices: clone(sortedIndices) },
          variables: { i, minIdx },
          status: 'sorted'
        });
      }

      sortedIndices.push(i);
    }

    sortedIndices.push(n - 1);

    steps.push({
      stepNumber: stepNumber++,
      action: 'complete',
      description: 'Selection sort complete. Array is fully sorted.',
      state: { array: clone(arr), sortedIndices: clone(sortedIndices) },
      variables: { totalComparisons, totalSwaps },
      status: 'sorted'
    });

    return {
      initialState: { array: clone(rawArray) },
      steps,
      operation: 'selection_sort',
      variables: { totalComparisons, totalSwaps },
      finalState: { array: clone(arr), isSorted: true },
      completed: true,
      error: null
    };
  }

  // ==========================================================================
  // 5. Insertion Sort
  // ==========================================================================
  /**
   * Simulates Insertion Sort step-by-step.
   *
   * @param {number[]} rawArray
   * @returns {object} SimulationResult
   */
  function simulateInsertionSort(rawArray) {
    const arrayValidation = validateNumericArray(rawArray, 'array', 0, MAX_ARRAY_SIZE);
    if (!arrayValidation.valid) {
      return {
        initialState: { array: clone(rawArray) },
        steps: [],
        operation: 'insertion_sort',
        variables: {},
        finalState: { array: clone(rawArray) },
        completed: false,
        error: { code: 'INVALID_INPUT', message: arrayValidation.error }
      };
    }

    const arr = clone(rawArray);
    const steps = [];
    const n = arr.length;
    let stepNumber = 1;
    let totalComparisons = 0;
    let totalShifts = 0;

    if (n <= 1) {
      steps.push({
        stepNumber: 1,
        action: 'already_sorted',
        description: n === 0 ? 'Array is empty; already sorted.' : 'Array has 1 element; already sorted.',
        state: { array: clone(arr), sortedLength: n },
        variables: {},
        status: 'sorted'
      });
      return {
        initialState: { array: clone(rawArray) },
        steps,
        operation: 'insertion_sort',
        variables: { totalComparisons: 0, totalShifts: 0 },
        finalState: { array: clone(arr), isSorted: true },
        completed: true,
        error: null
      };
    }

    steps.push({
      stepNumber: stepNumber++,
      action: 'initialize',
      description: `Single-element prefix [${arr[0]}] is trivially sorted.`,
      state: { array: clone(arr), sortedLength: 1 },
      variables: { sortedLength: 1 },
      status: 'sorted'
    });

    for (let i = 1; i < n; i++) {
      const key = arr[i];
      let j = i - 1;

      steps.push({
        stepNumber: stepNumber++,
        action: 'pick_key',
        description: `Picked key element A[${i}] = ${key} to insert into sorted prefix.`,
        state: { array: clone(arr), key, keyIndex: i, sortedLength: i },
        variables: { i, key },
        status: 'comparing'
      });

      while (j >= 0) {
        totalComparisons++;
        if (arr[j] > key) {
          arr[j + 1] = arr[j];
          totalShifts++;

          steps.push({
            stepNumber: stepNumber++,
            action: 'shift_right',
            description: `A[${j}] (${arr[j]}) > key (${key}). Shifted ${arr[j]} right to index ${j + 1}.`,
            state: { array: clone(arr), key, activeIndices: [j, j + 1], sortedLength: i },
            variables: { i, j, key, shiftedVal: arr[j + 1] },
            status: 'swapping'
          });
          j--;
        } else {
          steps.push({
            stepNumber: stepNumber++,
            action: 'compare_stop',
            description: `A[${j}] (${arr[j]}) <= key (${key}). Insertion slot found at index ${j + 1}.`,
            state: { array: clone(arr), key, activeIndices: [j], sortedLength: i },
            variables: { i, j, key },
            status: 'comparing'
          });
          break;
        }
      }

      arr[j + 1] = key;

      steps.push({
        stepNumber: stepNumber++,
        action: 'insert_key',
        description: `Inserted key ${key} into position ${j + 1}. Sorted prefix is now [${arr.slice(0, i + 1).join(', ')}].`,
        state: { array: clone(arr), sortedLength: i + 1, insertedAt: j + 1 },
        variables: { i, insertedAt: j + 1, key },
        status: 'sorted'
      });
    }

    return {
      initialState: { array: clone(rawArray) },
      steps,
      operation: 'insertion_sort',
      variables: { totalComparisons, totalShifts },
      finalState: { array: clone(arr), isSorted: true },
      completed: true,
      error: null
    };
  }

  // ==========================================================================
  // 6. Stack Operations (LIFO)
  // ==========================================================================
  /**
   * Simulates Stack LIFO operations with explicit overflow and underflow handling.
   *
   * @param {number} capacity - Stack maximum capacity (1 to 15).
   * @param {Array<{ op: 'push'|'pop'|'peek', value?: any }>} operations - Ordered operations.
   * @returns {object} SimulationResult
   */
  function simulateStackOperations(capacity = 8, operations = []) {
    if (typeof capacity !== 'number' || capacity < 1 || capacity > MAX_STACK_QUEUE_CAPACITY) {
      return {
        initialState: { items: [], capacity },
        steps: [],
        operation: 'stack_operations',
        variables: {},
        finalState: { items: [], capacity },
        completed: false,
        error: { code: 'INVALID_CAPACITY', message: `Capacity must be between 1 and ${MAX_STACK_QUEUE_CAPACITY}.` }
      };
    }

    if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS_COUNT) {
      return {
        initialState: { items: [], capacity },
        steps: [],
        operation: 'stack_operations',
        variables: {},
        finalState: { items: [], capacity },
        completed: false,
        error: { code: 'INVALID_OPERATIONS', message: `Operations must be an array of up to ${MAX_OPERATIONS_COUNT} operations.` }
      };
    }

    const items = [];
    const steps = [];
    let stepNumber = 1;
    let hadError = false;
    let lastError = null;

    for (let idx = 0; idx < operations.length; idx++) {
      const opObj = operations[idx];
      if (!opObj || typeof opObj !== 'object') continue;

      const op = String(opObj.op || '').toLowerCase().trim();

      if (op === 'push') {
        const val = opObj.value !== undefined ? opObj.value : `Item_${items.length + 1}`;
        if (items.length >= capacity) {
          hadError = true;
          lastError = { code: 'STACK_OVERFLOW', message: `Cannot push '${val}': Stack overflow (capacity ${capacity} reached).` };
          steps.push({
            stepNumber: stepNumber++,
            action: 'overflow',
            description: `Overflow Error: Attempted to push '${val}' onto a full stack (size ${items.length}/${capacity}).`,
            state: { items: clone(items), capacity, top: items.length - 1 },
            variables: { op: 'push', attemptedValue: val, top: items.length - 1 },
            status: 'overflow'
          });
        } else {
          items.push(val);
          steps.push({
            stepNumber: stepNumber++,
            action: 'push',
            description: `Pushed '${val}' onto stack. Top index is now ${items.length - 1}.`,
            state: { items: clone(items), capacity, top: items.length - 1 },
            variables: { op: 'push', pushedValue: val, top: items.length - 1, size: items.length },
            status: 'ok'
          });
        }
      } else if (op === 'pop') {
        if (items.length === 0) {
          hadError = true;
          lastError = { code: 'STACK_UNDERFLOW', message: 'Cannot pop: Stack underflow (stack is empty).' };
          steps.push({
            stepNumber: stepNumber++,
            action: 'underflow',
            description: 'Underflow Error: Attempted to pop from an empty stack.',
            state: { items: [], capacity, top: -1 },
            variables: { op: 'pop', top: -1 },
            status: 'underflow'
          });
        } else {
          const popped = items.pop();
          steps.push({
            stepNumber: stepNumber++,
            action: 'pop',
            description: `Popped '${popped}' from stack. Top index is now ${items.length - 1}.`,
            state: { items: clone(items), capacity, top: items.length - 1, poppedValue: popped },
            variables: { op: 'pop', poppedValue: popped, top: items.length - 1, size: items.length },
            status: 'ok'
          });
        }
      } else if (op === 'peek') {
        if (items.length === 0) {
          steps.push({
            stepNumber: stepNumber++,
            action: 'peek_empty',
            description: 'Peeked top of stack: Stack is currently empty.',
            state: { items: [], capacity, top: -1, peekValue: null },
            variables: { op: 'peek', top: -1 },
            status: 'ok'
          });
        } else {
          const peekVal = items[items.length - 1];
          steps.push({
            stepNumber: stepNumber++,
            action: 'peek',
            description: `Peeked top of stack: '${peekVal}' at index ${items.length - 1}.`,
            state: { items: clone(items), capacity, top: items.length - 1, peekValue: peekVal },
            variables: { op: 'peek', peekValue: peekVal, top: items.length - 1 },
            status: 'ok'
          });
        }
      }
    }

    return {
      initialState: { items: [], capacity },
      steps,
      operation: 'stack_operations',
      variables: { size: items.length, capacity, top: items.length - 1 },
      finalState: { items: clone(items), capacity, top: items.length - 1 },
      completed: true,
      error: hadError ? lastError : null
    };
  }

  // ==========================================================================
  // 7. Queue Operations (FIFO)
  // ==========================================================================
  /**
   * Simulates Linear Queue FIFO operations with explicit overflow and underflow handling.
   *
   * @param {number} capacity - Queue maximum capacity (1 to 15).
   * @param {Array<{ op: 'enqueue'|'dequeue'|'peek', value?: any }>} operations
   * @returns {object} SimulationResult
   */
  function simulateQueueOperations(capacity = 8, operations = []) {
    if (typeof capacity !== 'number' || capacity < 1 || capacity > MAX_STACK_QUEUE_CAPACITY) {
      return {
        initialState: { items: [], capacity },
        steps: [],
        operation: 'queue_operations',
        variables: {},
        finalState: { items: [], capacity },
        completed: false,
        error: { code: 'INVALID_CAPACITY', message: `Capacity must be between 1 and ${MAX_STACK_QUEUE_CAPACITY}.` }
      };
    }

    if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS_COUNT) {
      return {
        initialState: { items: [], capacity },
        steps: [],
        operation: 'queue_operations',
        variables: {},
        finalState: { items: [], capacity },
        completed: false,
        error: { code: 'INVALID_OPERATIONS', message: `Operations must be an array of up to ${MAX_OPERATIONS_COUNT} operations.` }
      };
    }

    const items = [];
    const steps = [];
    let stepNumber = 1;
    let hadError = false;
    let lastError = null;

    for (let idx = 0; idx < operations.length; idx++) {
      const opObj = operations[idx];
      if (!opObj || typeof opObj !== 'object') continue;

      const op = String(opObj.op || '').toLowerCase().trim();

      if (op === 'enqueue') {
        const val = opObj.value !== undefined ? opObj.value : `Item_${items.length + 1}`;
        if (items.length >= capacity) {
          hadError = true;
          lastError = { code: 'QUEUE_OVERFLOW', message: `Cannot enqueue '${val}': Queue overflow (capacity ${capacity} reached).` };
          steps.push({
            stepNumber: stepNumber++,
            action: 'overflow',
            description: `Overflow Error: Attempted to enqueue '${val}' into a full queue (size ${items.length}/${capacity}).`,
            state: { items: clone(items), capacity, front: 0, rear: items.length - 1 },
            variables: { op: 'enqueue', attemptedValue: val, size: items.length },
            status: 'overflow'
          });
        } else {
          items.push(val);
          steps.push({
            stepNumber: stepNumber++,
            action: 'enqueue',
            description: `Enqueued '${val}' at rear of queue (index ${items.length - 1}).`,
            state: { items: clone(items), capacity, front: 0, rear: items.length - 1 },
            variables: { op: 'enqueue', enqueuedValue: val, front: 0, rear: items.length - 1, size: items.length },
            status: 'ok'
          });
        }
      } else if (op === 'dequeue') {
        if (items.length === 0) {
          hadError = true;
          lastError = { code: 'QUEUE_UNDERFLOW', message: 'Cannot dequeue: Queue underflow (queue is empty).' };
          steps.push({
            stepNumber: stepNumber++,
            action: 'underflow',
            description: 'Underflow Error: Attempted to dequeue from an empty queue.',
            state: { items: [], capacity, front: -1, rear: -1 },
            variables: { op: 'dequeue', front: -1, rear: -1 },
            status: 'underflow'
          });
        } else {
          const dequeued = items.shift();
          steps.push({
            stepNumber: stepNumber++,
            action: 'dequeue',
            description: `Dequeued '${dequeued}' from front of queue. Remaining items: ${items.length}.`,
            state: { items: clone(items), capacity, front: items.length > 0 ? 0 : -1, rear: items.length - 1, dequeuedValue: dequeued },
            variables: { op: 'dequeue', dequeuedValue: dequeued, front: items.length > 0 ? 0 : -1, rear: items.length - 1, size: items.length },
            status: 'ok'
          });
        }
      } else if (op === 'peek') {
        if (items.length === 0) {
          steps.push({
            stepNumber: stepNumber++,
            action: 'peek_empty',
            description: 'Peeked front of queue: Queue is currently empty.',
            state: { items: [], capacity, front: -1, rear: -1, peekValue: null },
            variables: { op: 'peek', front: -1, rear: -1 },
            status: 'ok'
          });
        } else {
          const peekVal = items[0];
          steps.push({
            stepNumber: stepNumber++,
            action: 'peek',
            description: `Peeked front of queue: '${peekVal}'.`,
            state: { items: clone(items), capacity, front: 0, rear: items.length - 1, peekValue: peekVal },
            variables: { op: 'peek', peekValue: peekVal, front: 0, rear: items.length - 1 },
            status: 'ok'
          });
        }
      }
    }

    return {
      initialState: { items: [], capacity },
      steps,
      operation: 'queue_operations',
      variables: { size: items.length, capacity, front: items.length > 0 ? 0 : -1, rear: items.length - 1 },
      finalState: { items: clone(items), capacity, front: items.length > 0 ? 0 : -1, rear: items.length - 1 },
      completed: true,
      error: hadError ? lastError : null
    };
  }

  return {
    MAX_ARRAY_SIZE,
    MAX_STACK_QUEUE_CAPACITY,
    MAX_OPERATIONS_COUNT,
    simulateBinarySearch,
    simulateLinearSearch,
    simulateBubbleSort,
    simulateSelectionSort,
    simulateInsertionSort,
    simulateStackOperations,
    simulateQueueOperations
  };
});
