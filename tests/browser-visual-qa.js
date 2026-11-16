'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3899;
const ARTIFACT_DIR = '/Users/sauu_gat/.gemini/antigravity/brain/5b7ee805-798e-432d-bcf6-98fd86732595';

const HARNESS_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kyana Visualizer Browser QA Test Harness</title>
  <link rel="stylesheet" href="/css/kyana-visualizers.css">
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
    }
    .test-section {
      max-width: 900px;
      margin: 0 auto 32px;
    }
    .test-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  </style>
  <script src="/js/visualizers/kyana-simulation-engine.js"></script>
  <script src="/js/visualizers/kyana-playback-controller.js"></script>
  <script src="/js/visualizers/kyana-visual-renderer.js"></script>
</head>
<body>
  <div class="test-section">
    <div class="test-title">1. Binary Search Visualizer</div>
    <div id="vis-binary-search"></div>
  </div>

  <div class="test-section">
    <div class="test-title">2. Bubble Sort Visualizer</div>
    <div id="vis-bubble-sort"></div>
  </div>

  <div class="test-section">
    <div class="test-title">3. Selection Sort Visualizer</div>
    <div id="vis-selection-sort"></div>
  </div>

  <div class="test-section">
    <div class="test-title">4. Insertion Sort Visualizer</div>
    <div id="vis-insertion-sort"></div>
  </div>

  <div class="test-section">
    <div class="test-title">5. Stack (LIFO) Visualizer</div>
    <div id="vis-stack"></div>
  </div>

  <div class="test-section">
    <div class="test-title">6. Queue (FIFO) Visualizer</div>
    <div id="vis-queue"></div>
  </div>

  <div class="test-section">
    <div class="test-title">7. XOR Logic Gate & Dynamic Truth Table</div>
    <div id="vis-logic-xor"></div>
  </div>

  <div class="test-section">
    <div class="test-title">8. NOR Logic Gate Simulation</div>
    <div id="vis-logic-nor"></div>
  </div>

  <div class="test-section">
    <div class="test-title">9. Compound Boolean Expression Evaluator</div>
    <div id="vis-compound-logic"></div>
  </div>

  <script>
    window.visualInstances = {};

    document.addEventListener('DOMContentLoaded', () => {
      // 1. Binary Search
      window.visualInstances.binarySearch = KyanaVisualRenderer.mount(
        document.getElementById('vis-binary-search'),
        {
          engine: 'algo_anim',
          title: 'Binary Search (Target: 15)',
          data: {
            algorithm: 'binary_search',
            initialArray: [2, 5, 8, 12, 15, 23, 38],
            target: 15
          }
        }
      );

      // 2. Bubble Sort
      window.visualInstances.bubbleSort = KyanaVisualRenderer.mount(
        document.getElementById('vis-bubble-sort'),
        {
          engine: 'algo_anim',
          title: 'Bubble Sort Demonstration',
          data: {
            algorithm: 'bubble_sort',
            initialArray: [45, 12, 89, 34, 23, 7]
          }
        }
      );

      // 3. Selection Sort
      window.visualInstances.selectionSort = KyanaVisualRenderer.mount(
        document.getElementById('vis-selection-sort'),
        {
          engine: 'algo_anim',
          title: 'Selection Sort Demonstration',
          data: {
            algorithm: 'selection_sort',
            initialArray: [30, 10, 50, 20]
          }
        }
      );

      // 4. Insertion Sort
      window.visualInstances.insertionSort = KyanaVisualRenderer.mount(
        document.getElementById('vis-insertion-sort'),
        {
          engine: 'algo_anim',
          title: 'Insertion Sort Demonstration',
          data: {
            algorithm: 'insertion_sort',
            initialArray: [25, 15, 40, 10]
          }
        }
      );

      // 5. Stack
      window.visualInstances.stack = KyanaVisualRenderer.mount(
        document.getElementById('vis-stack'),
        {
          engine: 'dsa_linear',
          title: 'Stack Memory & Push/Pop Lifecycle',
          data: {
            structure: 'stack',
            capacity: 4,
            operations: [
              { op: 'push', value: 'main()' },
              { op: 'push', value: 'calc()' },
              { op: 'push', value: 'eval()' },
              { op: 'push', value: 'parse()' },
              { op: 'push', value: 'overflow()' }, // triggers overflow alert
              { op: 'pop' },
              { op: 'pop' }
            ]
          }
        }
      );

      // 6. Queue
      window.visualInstances.queue = KyanaVisualRenderer.mount(
        document.getElementById('vis-queue'),
        {
          engine: 'dsa_linear',
          title: 'Process Scheduling Queue',
          data: {
            structure: 'queue',
            capacity: 5,
            operations: [
              { op: 'enqueue', value: 'P1' },
              { op: 'enqueue', value: 'P2' },
              { op: 'enqueue', value: 'P3' },
              { op: 'dequeue' },
              { op: 'enqueue', value: 'P4' }
            ]
          }
        }
      );

      // 7. XOR Gate
      window.visualInstances.logicXor = KyanaVisualRenderer.mount(
        document.getElementById('vis-logic-xor'),
        {
          engine: 'logic_sim',
          title: 'Two-Input XOR Gate Circuit',
          data: {
            inputs: [
              { id: 'A', label: 'Input A', initial: 0 },
              { id: 'B', label: 'Input B', initial: 1 }
            ],
            gates: [
              { id: 'G1', type: 'XOR', inputs: ['A', 'B'] }
            ]
          }
        }
      );

      // 8. NOR Gate
      window.visualInstances.logicNor = KyanaVisualRenderer.mount(
        document.getElementById('vis-logic-nor'),
        {
          engine: 'logic_sim',
          title: 'Universal NOR Gate Circuit',
          data: {
            inputs: [
              { id: 'A', label: 'Input A', initial: 0 },
              { id: 'B', label: 'Input B', initial: 0 }
            ],
            gates: [
              { id: 'G1', type: 'NOR', inputs: ['A', 'B'] }
            ]
          }
        }
      );

      // 9. Compound Boolean Expression
      window.visualInstances.compoundLogic = KyanaVisualRenderer.mount(
        document.getElementById('vis-compound-logic'),
        {
          engine: 'truth_table',
          title: 'Boolean Expression: (A AND B) OR NOT A',
          fallback: 'Truth table for (A AND B) OR NOT A',
          data: {
            variables: ['A', 'B'],
            expression: '(A AND B) OR NOT A'
          }
        }
      );
    });
  </script>
</body>
</html>`;

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let filePath = req.url.split('?')[0];
    if (filePath === '/' || filePath === '/visual-qa-harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML);
      return;
    }

    const publicPath = path.join(__dirname, '..', 'public', filePath);
    if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
      let contentType = 'text/plain';
      if (filePath.endsWith('.css')) contentType = 'text/css';
      else if (filePath.endsWith('.js')) contentType = 'application/javascript';
      else if (filePath.endsWith('.html')) contentType = 'text/html';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(publicPath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return new Promise(resolve => {
    server.listen(PORT, () => {
      resolve(server);
    });
  });
}

async function runBrowserQA() {
  console.log('Starting Browser QA test server on port', PORT);
  const server = await startStaticServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const viewports = [
    { name: 'desktop-1440x900', width: 1440, height: 900 },
    { name: 'tablet-768x1024', width: 768, height: 1024 },
    { name: 'mobile-390x844', width: 390, height: 844 },
    { name: 'mobile-375x812', width: 375, height: 812 }
  ];

  const results = {
    viewportsTested: [],
    screenshotsCaptured: [],
    interactionsTested: [],
    errorsEncountered: []
  };

  try {
    for (const vp of viewports) {
      console.log(`Testing viewport ${vp.name} (${vp.width}x${vp.height})...`);
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height }
      });

      page.on('console', msg => {
        if (msg.type() === 'error') {
          results.errorsEncountered.push(`[${vp.name} console.error]: ${msg.text()}`);
        }
      });
      page.on('pageerror', err => {
        results.errorsEncountered.push(`[${vp.name} pageerror]: ${err.message}`);
      });

      await page.goto(`http://localhost:${PORT}/visual-qa-harness.html`, { waitUntil: 'networkidle' });

      // Check overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const hasHorizontalOverflow = scrollWidth > clientWidth;

      results.viewportsTested.push({
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        scrollWidth,
        clientWidth,
        hasHorizontalOverflow
      });

      // Capture full page screenshot
      const shotPath = path.join(ARTIFACT_DIR, `phase2-3-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      results.screenshotsCaptured.push(shotPath);

      // On 1440x900, test and capture specific interactions
      if (vp.name === 'desktop-1440x900') {
        console.log('Testing interactive stepping & toggles on desktop...');

        // 1. Step Binary Search to target found
        const binSearchEl = page.locator('#vis-binary-search');
        await page.evaluate(() => {
          const inst = window.visualInstances.binarySearch;
          inst.setStep(inst.controller.totalSteps - 1);
        });
        const binFoundShot = path.join(ARTIFACT_DIR, 'phase2-3-binary-search-found.png');
        await binSearchEl.screenshot({ path: binFoundShot });
        results.screenshotsCaptured.push(binFoundShot);
        results.interactionsTested.push('Binary search step-to-end (found state)');

        // 2. Step Stack to overflow alert
        const stackEl = page.locator('#vis-stack');
        await page.evaluate(() => {
          const inst = window.visualInstances.stack;
          inst.setStep(4); // 5th op is overflow
        });
        const stackOverflowShot = path.join(ARTIFACT_DIR, 'phase2-3-stack-overflow.png');
        await stackEl.screenshot({ path: stackOverflowShot });
        results.screenshotsCaptured.push(stackOverflowShot);
        results.interactionsTested.push('Stack overflow condition alert banner');

        // 3. Step Queue to dequeue & rear enqueue
        const queueEl = page.locator('#vis-queue');
        await page.evaluate(() => {
          const inst = window.visualInstances.queue;
          inst.setStep(3); // dequeue
        });
        const queueShot = path.join(ARTIFACT_DIR, 'phase2-3-queue-fifo.png');
        await queueEl.screenshot({ path: queueShot });
        results.screenshotsCaptured.push(queueShot);
        results.interactionsTested.push('Queue FIFO dequeue and pointer tracking');

        // 4. Click Toggle B on XOR Gate (toggling 1 -> 0, output becomes 0 ^ 0 = 0)
        const xorEl = page.locator('#vis-logic-xor');
        const toggleB = xorEl.locator('.toggle-b');
        await toggleB.click();
        const xorToggleShot = path.join(ARTIFACT_DIR, 'phase2-3-logic-xor-toggle.png');
        await xorEl.screenshot({ path: xorToggleShot });
        results.screenshotsCaptured.push(xorToggleShot);
        results.interactionsTested.push('XOR gate input toggle switch and truth table row highlight');

        // 5. Test Play/Pause loop on Bubble Sort
        await page.evaluate(() => {
          const inst = window.visualInstances.bubbleSort;
          inst.controller.play();
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          const inst = window.visualInstances.bubbleSort;
          inst.controller.pause();
        });
        results.interactionsTested.push('Sorting auto-play and pause lifecycle');

        // 6. Test Lifecycle destroy
        await page.evaluate(() => {
          const inst = window.visualInstances.insertionSort;
          inst.destroy();
        });
        const destroyedElCount = await page.locator('#vis-insertion-sort .kyana-visual-root').count();
        if (destroyedElCount === 0) {
          results.interactionsTested.push('Clean individual visualizer instance destroy()');
        } else {
          results.errorsEncountered.push('Instance destroy did not remove root DOM element');
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n--- BROWSER QA TEST RESULTS ---');
  console.log(JSON.stringify(results, null, 2));
}

runBrowserQA().catch(err => {
  console.error('Browser QA test failed:', err);
  process.exit(1);
});
