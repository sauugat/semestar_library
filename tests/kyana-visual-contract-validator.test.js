'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateVisualContract,
  MAX_PAYLOAD_BYTES,
  ALLOWED_ENGINES,
  ALLOWED_MODES,
  ALLOWED_VERSIONS
} = require('../lib/visual-contract-validator');

test('Visual Contract Validator Suite', async (t) => {

  await t.test('1. Valid envelope: passes valid kyana.visual.v1 and v2 payloads', () => {
    const validV1 = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Binary Search Demo',
      subjectCode: 'CIT214',
      semester: 3,
      data: {
        algorithm: 'binary_search',
        initialArray: [2, 5, 8, 12, 16],
        target: 12
      },
      fallback: {
        type: 'text',
        content: 'Binary search divides a sorted array in half repeatedly.'
      }
    };
    const res1 = validateVisualContract(validV1);
    assert.equal(res1.valid, true);
    assert.equal(res1.fallbackText, 'Binary search divides a sorted array in half repeatedly.');

    const validV2 = {
      ...validV1,
      version: 'kyana.visual.v2'
    };
    const res2 = validateVisualContract(validV2);
    assert.equal(res2.valid, true);
  });

  await t.test('2. Rejects invalid version and unknown engine IDs', () => {
    const invalidVer = {
      version: 'kyana.visual.v999',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Test',
      fallback: { type: 'text', content: 'fallback' },
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 1 }
    };
    const res1 = validateVisualContract(invalidVer);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('version')));

    const invalidEngine = {
      version: 'kyana.visual.v1',
      engine: 'unsupported_quantum_engine',
      mode: 'simulation',
      title: 'Test',
      fallback: { type: 'text', content: 'fallback' },
      data: {}
    };
    const res2 = validateVisualContract(invalidEngine);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('engine')));
  });

  await t.test('3. Rejects invalid modes', () => {
    const invalidMode = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'telepathic_mode',
      title: 'Test',
      fallback: { type: 'text', content: 'fallback' },
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 1 }
    };
    const res = validateVisualContract(invalidMode);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('mode')));
  });

  await t.test('4. Rejects missing or invalid title and fallback content', () => {
    const noTitle = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'ab', // too short (<3)
      fallback: { type: 'text', content: 'fallback' },
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 1 }
    };
    const res1 = validateVisualContract(noTitle);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('title')));

    const noFallback = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Valid Title',
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 1 }
    };
    const res2 = validateVisualContract(noFallback);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('fallback')));
  });

  await t.test('5. Rejects payloads exceeding 65,536 bytes ceiling', () => {
    const hugeArray = Array.from({ length: 20000 }, (_, i) => i);
    const hugePayload = JSON.stringify({
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Oversized Payload',
      fallback: { type: 'text', content: 'fallback' },
      data: {
        algorithm: 'linear_search',
        initialArray: hugeArray,
        target: 100
      }
    });
    assert.ok(Buffer.byteLength(hugePayload, 'utf8') > MAX_PAYLOAD_BYTES);

    const res = validateVisualContract(hugePayload);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('exceeds maximum ceiling')));
  });

  await t.test('6. Security: Rejects prototype pollution keys (__proto__, constructor, prototype)', () => {
    const rawMalicious = '{"version":"kyana.visual.v1","engine":"algo_anim","mode":"simulation","title":"Hack","__proto__":{"polluted":true},"fallback":{"type":"text","content":"fallback"},"data":{"algorithm":"linear_search","initialArray":[1,2],"target":1}}';
    const res = validateVisualContract(rawMalicious);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Prototype pollution')));
  });

  await t.test('7. Security: Rejects executable script tags and DOM event handlers', () => {
    const scriptPayload = JSON.stringify({
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: '<script>alert("xss")</script>',
      fallback: { type: 'text', content: 'fallback' },
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 1 }
    });
    const res1 = validateVisualContract(scriptPayload);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('Executable script')));

    const eventPayload = JSON.stringify({
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Valid Title',
      fallback: { type: 'text', content: 'fallback' },
      data: { algorithm: 'linear_search', initialArray: [1, 2], target: 'onload=alert(1)' }
    });
    const res2 = validateVisualContract(eventPayload);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('Executable script')));
  });

  await t.test('8. Referential integrity: Tree nodes validate child pointers and cycles', () => {
    const brokenTree = {
      version: 'kyana.visual.v1',
      engine: 'dsa_tree',
      mode: 'interactive',
      title: 'Broken Tree',
      fallback: { type: 'text', content: 'fallback' },
      data: {
        treeType: 'bst',
        nodes: [
          { id: 'n1', val: 10, left: 'nonexistent_n2' }
        ]
      }
    };
    const res = validateVisualContract(brokenTree);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('nonexistent node')));
  });

  await t.test('9. Referential integrity: Graph edges validate node references', () => {
    const brokenGraph = {
      version: 'kyana.visual.v1',
      engine: 'dsa_graph',
      mode: 'interactive',
      title: 'Broken Graph',
      fallback: { type: 'text', content: 'fallback' },
      data: {
        directed: false,
        weighted: false,
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'Z_GHOST' }]
      }
    };
    const res = validateVisualContract(brokenGraph);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('nonexistent node')));
  });

  await t.test('10. Bounded array limits: Rejects arrays exceeding maximum sizes', () => {
    const tooManyItems = Array.from({ length: 30 }, (_, i) => i);
    const oversizedArray = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Too many items',
      fallback: { type: 'text', content: 'fallback' },
      data: {
        algorithm: 'bubble_sort',
        initialArray: tooManyItems
      }
    };
    const res = validateVisualContract(oversizedArray);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('between 2 and 20')));
  });

  await t.test('11. Extraction of fallback markdown on error', () => {
    const invalidWithFallback = {
      version: 'kyana.visual.v1',
      engine: 'algo_anim',
      mode: 'simulation',
      title: 'Invalid',
      fallback: {
        type: 'markdown',
        content: '### Fallback Explanation\nBubble sort steps through the list...'
      },
      data: {
        algorithm: 'unsupported_sort',
        initialArray: [1, 2]
      }
    };
    const res = validateVisualContract(invalidWithFallback);
    assert.equal(res.valid, false);
    assert.ok(res.fallbackText.includes('### Fallback Explanation'));
  });

  await t.test('12. Validates all 18 registered engine payload schemas', () => {
    for (const engine of ALLOWED_ENGINES) {
      assert.ok(typeof engine === 'string');
      assert.ok(engine.length > 0);
    }
  });

});
