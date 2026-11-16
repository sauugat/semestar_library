'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  simulateBinarySearch,
  simulateLinearSearch,
  simulateBubbleSort,
  simulateSelectionSort,
  simulateInsertionSort,
  simulateStackOperations,
  simulateQueueOperations
} = require('../public/js/visualizers/kyana-simulation-engine');

test('Kyana Deterministic Simulation Engine Suite', async (t) => {

  // ==========================================================================
  // 1. Binary Search Tests
  // ==========================================================================
  await t.test('1. Binary Search: found, missing, first, last, duplicates, empty, and unsorted rejection', async (st) => {
    await st.test('Found in middle', () => {
      const arr = [2, 5, 8, 12, 16, 23, 38];
      const res = simulateBinarySearch(arr, 12);
      assert.equal(res.completed, true);
      assert.equal(res.error, null);
      assert.equal(res.finalState.found, true);
      assert.equal(res.finalState.foundIndex, 3);
      assert.ok(res.steps.length > 0);
      assert.equal(res.steps[res.steps.length - 1].status, 'found');
    });

    await st.test('Found first element', () => {
      const arr = [10, 20, 30, 40, 50];
      const res = simulateBinarySearch(arr, 10);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, true);
      assert.equal(res.finalState.foundIndex, 0);
    });

    await st.test('Found last element', () => {
      const arr = [10, 20, 30, 40, 50];
      const res = simulateBinarySearch(arr, 50);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, true);
      assert.equal(res.finalState.foundIndex, 4);
    });

    await st.test('Missing target (smaller than min and larger than max)', () => {
      const arr = [10, 20, 30, 40, 50];
      const resLow = simulateBinarySearch(arr, 5);
      assert.equal(resLow.completed, true);
      assert.equal(resLow.finalState.found, false);
      assert.equal(resLow.finalState.foundIndex, -1);

      const resHigh = simulateBinarySearch(arr, 99);
      assert.equal(resHigh.completed, true);
      assert.equal(resHigh.finalState.found, false);
    });

    await st.test('Handles duplicates deterministically', () => {
      const arr = [5, 10, 10, 10, 20];
      const res = simulateBinarySearch(arr, 10);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, true);
      assert.equal(arr[res.finalState.foundIndex], 10);
    });

    await st.test('Handles empty array', () => {
      const res = simulateBinarySearch([], 42);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, false);
      assert.equal(res.steps.length, 1);
      assert.equal(res.steps[0].action, 'empty_check');
    });

    await st.test('Rejects unsorted arrays instead of silently sorting them', () => {
      const unsorted = [10, 5, 20, 15];
      const res = simulateBinarySearch(unsorted, 5);
      assert.equal(res.completed, false);
      assert.ok(res.error !== null);
      assert.equal(res.error.code, 'UNSORTED_ARRAY');
      assert.ok(res.error.message.includes('Binary Search requires a sorted array'));
    });

    await st.test('Does not mutate caller input array', () => {
      const original = [1, 3, 5, 7, 9];
      const copy = [...original];
      simulateBinarySearch(original, 7);
      assert.deepEqual(original, copy);
    });
  });

  // ==========================================================================
  // 2. Linear Search Tests
  // ==========================================================================
  await t.test('2. Linear Search: found, missing, duplicates, and empty array', async (st) => {
    await st.test('Found target', () => {
      const arr = [42, 17, 89, 5, 23];
      const res = simulateLinearSearch(arr, 89);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, true);
      assert.equal(res.finalState.foundIndex, 2);
      assert.equal(res.steps.length, 3); // index 0, 1, 2
    });

    await st.test('Missing target', () => {
      const arr = [1, 2, 3];
      const res = simulateLinearSearch(arr, 999);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, false);
      assert.equal(res.finalState.foundIndex, -1);
      assert.equal(res.steps.length, 4); // 3 inspections + 1 not_found
    });

    await st.test('Duplicate targets: stops on first match', () => {
      const arr = [7, 14, 7, 21];
      const res = simulateLinearSearch(arr, 7);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, true);
      assert.equal(res.finalState.foundIndex, 0);
      assert.equal(res.steps.length, 1);
    });

    await st.test('Empty array', () => {
      const res = simulateLinearSearch([], 10);
      assert.equal(res.completed, true);
      assert.equal(res.finalState.found, false);
      assert.equal(res.steps[0].action, 'empty_check');
    });

    await st.test('Does not mutate caller input', () => {
      const arr = [9, 8, 7];
      simulateLinearSearch(arr, 8);
      assert.deepEqual(arr, [9, 8, 7]);
    });
  });

  // ==========================================================================
  // 3. Bubble Sort Tests
  // ==========================================================================
  await t.test('3. Bubble Sort: ascending, descending, duplicates, and empty array', async (st) => {
    await st.test('Descending to ascending', () => {
      const input = [5, 4, 3, 2, 1];
      const res = simulateBubbleSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [1, 2, 3, 4, 5]);
      assert.ok(res.variables.totalSwaps > 0);
      assert.ok(res.variables.totalComparisons > 0);
    });

    await st.test('Already ascending (early exit trigger)', () => {
      const input = [1, 2, 3, 4, 5];
      const res = simulateBubbleSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [1, 2, 3, 4, 5]);
      assert.equal(res.variables.totalSwaps, 0);
      assert.ok(res.steps.some(s => s.action === 'early_exit'));
    });

    await st.test('Duplicates and negatives', () => {
      const input = [3, -1, 3, 0, -1, 2];
      const res = simulateBubbleSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [-1, -1, 0, 2, 3, 3]);
    });

    await st.test('Empty and single element array', () => {
      const resEmpty = simulateBubbleSort([]);
      assert.equal(resEmpty.completed, true);
      assert.deepEqual(resEmpty.finalState.array, []);

      const resOne = simulateBubbleSort([42]);
      assert.equal(resOne.completed, true);
      assert.deepEqual(resOne.finalState.array, [42]);
    });

    await st.test('Does not mutate caller input array', () => {
      const arr = [5, 1, 4, 2];
      simulateBubbleSort(arr);
      assert.deepEqual(arr, [5, 1, 4, 2]);
    });
  });

  // ==========================================================================
  // 4. Selection Sort Tests
  // ==========================================================================
  await t.test('4. Selection Sort: ascending, descending, and duplicates', async (st) => {
    await st.test('Descending to ascending', () => {
      const input = [64, 25, 12, 22, 11];
      const res = simulateSelectionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [11, 12, 22, 25, 64]);
      assert.ok(res.steps.some(s => s.action === 'swap'));
    });

    await st.test('Already sorted array (no_swap_needed triggered)', () => {
      const input = [1, 2, 3, 4];
      const res = simulateSelectionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [1, 2, 3, 4]);
      assert.equal(res.variables.totalSwaps, 0);
      assert.ok(res.steps.some(s => s.action === 'no_swap_needed'));
    });

    await st.test('Duplicates', () => {
      const input = [4, 2, 4, 1, 2];
      const res = simulateSelectionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [1, 2, 2, 4, 4]);
    });

    await st.test('Does not mutate caller input', () => {
      const arr = [3, 2, 1];
      simulateSelectionSort(arr);
      assert.deepEqual(arr, [3, 2, 1]);
    });
  });

  // ==========================================================================
  // 5. Insertion Sort Tests
  // ==========================================================================
  await t.test('5. Insertion Sort: ascending, descending, and duplicates', async (st) => {
    await st.test('Descending to ascending', () => {
      const input = [12, 11, 13, 5, 6];
      const res = simulateInsertionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [5, 6, 11, 12, 13]);
      assert.ok(res.steps.some(s => s.action === 'shift_right'));
      assert.ok(res.steps.some(s => s.action === 'insert_key'));
    });

    await st.test('Already sorted array', () => {
      const input = [10, 20, 30];
      const res = simulateInsertionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [10, 20, 30]);
      assert.equal(res.variables.totalShifts, 0);
    });

    await st.test('Duplicates', () => {
      const input = [5, 2, 5, 1];
      const res = simulateInsertionSort(input);
      assert.equal(res.completed, true);
      assert.deepEqual(res.finalState.array, [1, 2, 5, 5]);
    });

    await st.test('Does not mutate caller input', () => {
      const arr = [4, 1, 3];
      simulateInsertionSort(arr);
      assert.deepEqual(arr, [4, 1, 3]);
    });
  });

  // ==========================================================================
  // 6. Stack Operations Tests (LIFO)
  // ==========================================================================
  await t.test('6. Stack: push, pop, peek, overflow, and underflow', async (st) => {
    await st.test('Push, peek, and pop sequence', () => {
      const ops = [
        { op: 'push', value: 'A' },
        { op: 'push', value: 'B' },
        { op: 'peek' },
        { op: 'pop' }
      ];
      const res = simulateStackOperations(5, ops);
      assert.equal(res.completed, true);
      assert.equal(res.error, null);
      assert.deepEqual(res.finalState.items, ['A']);
      assert.equal(res.finalState.top, 0);
    });

    await st.test('Stack Overflow handling', () => {
      const ops = [
        { op: 'push', value: 1 },
        { op: 'push', value: 2 },
        { op: 'push', value: 3 } // Capacity is 2 -> overflow
      ];
      const res = simulateStackOperations(2, ops);
      assert.equal(res.completed, true);
      assert.ok(res.error !== null);
      assert.equal(res.error.code, 'STACK_OVERFLOW');
      assert.equal(res.steps[2].status, 'overflow');
      assert.deepEqual(res.finalState.items, [1, 2]); // 3 was rejected
    });

    await st.test('Stack Underflow handling', () => {
      const ops = [
        { op: 'push', value: 'X' },
        { op: 'pop' },
        { op: 'pop' } // Empty stack -> underflow
      ];
      const res = simulateStackOperations(5, ops);
      assert.equal(res.completed, true);
      assert.ok(res.error !== null);
      assert.equal(res.error.code, 'STACK_UNDERFLOW');
      assert.equal(res.steps[2].status, 'underflow');
    });

    await st.test('Rejects invalid capacity', () => {
      const res = simulateStackOperations(99, [{ op: 'push', value: 1 }]);
      assert.equal(res.completed, false);
      assert.equal(res.error.code, 'INVALID_CAPACITY');
    });
  });

  // ==========================================================================
  // 7. Queue Operations Tests (FIFO)
  // ==========================================================================
  await t.test('7. Queue: enqueue, dequeue, FIFO order, overflow, and underflow', async (st) => {
    await st.test('FIFO order verification: first in, first out', () => {
      const ops = [
        { op: 'enqueue', value: 'First' },
        { op: 'enqueue', value: 'Second' },
        { op: 'dequeue' },
        { op: 'enqueue', value: 'Third' },
        { op: 'dequeue' }
      ];
      const res = simulateQueueOperations(5, ops);
      assert.equal(res.completed, true);
      assert.equal(res.error, null);

      const dequeues = res.steps.filter(s => s.action === 'dequeue');
      assert.equal(dequeues[0].state.dequeuedValue, 'First');
      assert.equal(dequeues[1].state.dequeuedValue, 'Second');
      assert.deepEqual(res.finalState.items, ['Third']);
    });

    await st.test('Queue Overflow handling', () => {
      const ops = [
        { op: 'enqueue', value: 10 },
        { op: 'enqueue', value: 20 },
        { op: 'enqueue', value: 30 } // Capacity is 2 -> overflow
      ];
      const res = simulateQueueOperations(2, ops);
      assert.equal(res.completed, true);
      assert.ok(res.error !== null);
      assert.equal(res.error.code, 'QUEUE_OVERFLOW');
      assert.equal(res.steps[2].status, 'overflow');
      assert.deepEqual(res.finalState.items, [10, 20]);
    });

    await st.test('Queue Underflow handling', () => {
      const ops = [
        { op: 'dequeue' } // Empty queue -> underflow
      ];
      const res = simulateQueueOperations(3, ops);
      assert.equal(res.completed, true);
      assert.ok(res.error !== null);
      assert.equal(res.error.code, 'QUEUE_UNDERFLOW');
      assert.equal(res.steps[0].status, 'underflow');
    });
  });

  // ==========================================================================
  // 8. Deterministic Output Stability Verification
  // ==========================================================================
  await t.test('8. Determinism: Identical inputs produce byte-for-byte identical output repeatedly', () => {
    const inputArr = [19, 3, 2, 7, 11, 4, 15];

    const run1 = simulateBubbleSort(inputArr);
    const run2 = simulateBubbleSort(inputArr);
    assert.deepEqual(run1, run2);

    const bsearch1 = simulateBinarySearch([1, 4, 7, 9, 13, 22], 9);
    const bsearch2 = simulateBinarySearch([1, 4, 7, 9, 13, 22], 9);
    assert.deepEqual(bsearch1, bsearch2);

    const stackOps = [{ op: 'push', value: 1 }, { op: 'push', value: 2 }, { op: 'pop' }];
    const stack1 = simulateStackOperations(4, stackOps);
    const stack2 = simulateStackOperations(4, stackOps);
    assert.deepEqual(stack1, stack2);
  });

});
