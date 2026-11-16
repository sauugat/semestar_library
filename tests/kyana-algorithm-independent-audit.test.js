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

test('Algorithm Audit 1: Binary Search — Independently Derived Math Traces', () => {
  // Test case A: Found in 2 comparisons
  // Array: [10, 20, 30, 40, 50, 60, 70, 80, 90] (length 9)
  // Target: 70
  // Hand Calculation:
  // Step 1: L=0, H=8, M=4. Arr[4]=50. 50 < 70 -> L=5.
  // Step 2: L=5, H=8, M=6. Arr[6]=70. 70 == 70 -> FOUND at index 6!
  const resA = simulateBinarySearch([10, 20, 30, 40, 50, 60, 70, 80, 90], 70);
  assert.equal(resA.finalState.found, true);
  assert.equal(resA.finalState.foundIndex, 6);

  // All inspection steps (compare_less, compare_greater, or match)
  const inspectionStepsA = resA.steps.filter(s => ['compare_less', 'compare_greater', 'match'].includes(s.action));
  assert.equal(inspectionStepsA.length, 2);
  assert.equal(inspectionStepsA[0].variables.mid, 4);
  assert.equal(inspectionStepsA[0].action, 'compare_less');
  assert.equal(inspectionStepsA[1].variables.mid, 6);
  assert.equal(inspectionStepsA[1].action, 'match');

  // Test case B: Missing target between elements
  // Target: 25 (between 20 and 30)
  // Step 1: L=0, H=8, M=4. 50 > 25 -> H=3.
  // Step 2: L=0, H=3, M=1. 20 < 25 -> L=2.
  // Step 3: L=2, H=3, M=2. 30 > 25 -> H=1.
  // Step 4: L=2, H=1 -> L > H -> NOT FOUND (-1)
  const resB = simulateBinarySearch([10, 20, 30, 40, 50, 60, 70, 80, 90], 25);
  assert.equal(resB.finalState.found, false);
  assert.equal(resB.finalState.foundIndex, -1);
  const inspectionStepsB = resB.steps.filter(s => ['compare_less', 'compare_greater', 'match'].includes(s.action));
  assert.equal(inspectionStepsB.length, 3);
  assert.equal(inspectionStepsB[0].variables.mid, 4);
  assert.equal(inspectionStepsB[1].variables.mid, 1);
  assert.equal(inspectionStepsB[2].variables.mid, 2);
  const notFoundStep = resB.steps[resB.steps.length - 1];
  assert.equal(notFoundStep.status, 'not_found');
});

test('Algorithm Audit 2: Linear Search — Independently Derived Stepping Sequence', () => {
  // Array: [42, 17, 89, 23, 56]
  // Target: 23
  // Independent Trace:
  // idx 0 (42 != 23), idx 1 (17 != 23), idx 2 (89 != 23), idx 3 (23 == 23) -> Stop!
  const res = simulateLinearSearch([42, 17, 89, 23, 56], 23);
  assert.equal(res.finalState.found, true);
  assert.equal(res.finalState.foundIndex, 3);
  assert.equal(res.variables.comparisons, 4);

  const steps = res.steps.filter(s => s.action === 'compare_mismatch' || s.action === 'match');
  assert.equal(steps.length, 4);
  assert.equal(steps[0].variables.currentIndex, 0);
  assert.equal(steps[0].action, 'compare_mismatch');
  assert.equal(steps[1].variables.currentIndex, 1);
  assert.equal(steps[1].action, 'compare_mismatch');
  assert.equal(steps[2].variables.currentIndex, 2);
  assert.equal(steps[2].action, 'compare_mismatch');
  assert.equal(steps[3].variables.currentIndex, 3);
  assert.equal(steps[3].action, 'match');
});

test('Algorithm Audit 3: Bubble Sort — Independently Derived State Trace', () => {
  // Array: [5, 1, 4, 2, 8]
  // Target final array: [1, 2, 4, 5, 8]
  const res = simulateBubbleSort([5, 1, 4, 2, 8]);
  const lastStep = res.steps[res.steps.length - 1];
  assert.deepEqual(lastStep.state.array, [1, 2, 4, 5, 8]);
  assert.equal(lastStep.status, 'sorted');

  // Verify early exit on already sorted array
  const alreadySorted = simulateBubbleSort([1, 2, 3, 4, 5]);
  assert.equal(alreadySorted.variables.totalSwaps, 0);
  // In already sorted array, exactly n-1 comparisons occur before early exit
  assert.equal(alreadySorted.variables.totalComparisons, 4);
});

test('Algorithm Audit 4: Selection Sort — Independently Derived Min-Finding', () => {
  // Array: [64, 25, 12, 22, 11]
  // Final array: [11, 12, 22, 25, 64]
  const res = simulateSelectionSort([64, 25, 12, 22, 11]);
  const lastStep = res.steps[res.steps.length - 1];
  assert.deepEqual(lastStep.state.array, [11, 12, 22, 25, 64]);
  assert.equal(lastStep.status, 'sorted');
});

test('Algorithm Audit 5: Insertion Sort — Independently Derived In-Place Shifting', () => {
  // Array: [12, 11, 13, 5, 6]
  // Final array: [5, 6, 11, 12, 13]
  const res = simulateInsertionSort([12, 11, 13, 5, 6]);
  const lastStep = res.steps[res.steps.length - 1];
  assert.deepEqual(lastStep.state.array, [5, 6, 11, 12, 13]);
  assert.equal(lastStep.status, 'sorted');
});

test('Algorithm Audit 6: Stack Overflow and Underflow Bounds', () => {
  // Capacity: 2
  // Push 10 (size=1)
  // Push 20 (size=2)
  // Push 30 -> Overflow!
  const overflowOps = [
    { op: 'push', value: 10 },
    { op: 'push', value: 20 },
    { op: 'push', value: 30 }
  ];
  const resOverflow = simulateStackOperations(2, overflowOps);
  assert.equal(resOverflow.error.code, 'STACK_OVERFLOW');
  const overflowStep = resOverflow.steps[resOverflow.steps.length - 1];
  assert.equal(overflowStep.status, 'overflow');
  assert.deepEqual(overflowStep.state.items, [10, 20]); // 30 was not pushed

  // Underflow: Pop on empty
  const underflowOps = [
    { op: 'push', value: 99 },
    { op: 'pop' },
    { op: 'pop' } // triggers underflow
  ];
  const resUnderflow = simulateStackOperations(3, underflowOps);
  assert.equal(resUnderflow.error.code, 'STACK_UNDERFLOW');
  const underflowStep = resUnderflow.steps[resUnderflow.steps.length - 1];
  assert.equal(underflowStep.status, 'underflow');
  assert.deepEqual(underflowStep.state.items, []);
});

test('Algorithm Audit 7: Queue FIFO Discipline & Underflow Bounds', () => {
  // Capacity: 3
  // Enqueue 'A', 'B', 'C'
  // Dequeue -> must return 'A' (FIFO!)
  // Dequeue -> must return 'B'
  // Dequeue -> must return 'C'
  // Dequeue -> Underflow!
  const fifoOps = [
    { op: 'enqueue', value: 'A' },
    { op: 'enqueue', value: 'B' },
    { op: 'enqueue', value: 'C' },
    { op: 'dequeue' },
    { op: 'dequeue' },
    { op: 'dequeue' },
    { op: 'dequeue' }
  ];
  const res = simulateQueueOperations(3, fifoOps);
  assert.equal(res.error.code, 'QUEUE_UNDERFLOW');

  // Find the first dequeue step
  const dequeueSteps = res.steps.filter(s => s.action === 'dequeue' && s.status !== 'underflow');
  assert.equal(dequeueSteps.length, 3);
  assert.equal(dequeueSteps[0].variables.dequeuedValue, 'A');
  assert.equal(dequeueSteps[1].variables.dequeuedValue, 'B');
  assert.equal(dequeueSteps[2].variables.dequeuedValue, 'C');

  // Final step is underflow
  const lastStep = res.steps[res.steps.length - 1];
  assert.equal(lastStep.status, 'underflow');
  assert.deepEqual(lastStep.state.items, []);
});
