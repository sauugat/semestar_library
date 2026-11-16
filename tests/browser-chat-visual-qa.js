'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3899;
const ARTIFACT_DIR = '/Users/sauu_gat/.gemini/antigravity/brain/5b7ee805-798e-432d-bcf6-98fd86732595';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
      let pathname = parsedUrl.pathname;

      if (pathname === '/') pathname = '/chatbot.html';

      // Mock user profile
      if (pathname === '/api/auth/me' || pathname === '/api/user/profile') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          studentId: 'B18001',
          name: 'Shree Sharma',
          role: 'student',
          semester: 4,
          token: 'mock-test-token'
        }));
      }

      // Mock active conversations
      if (pathname.startsWith('/api/ai/conversations')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ conversations: [], messages: [] }));
      }

      const filePath = path.join(PUBLIC_DIR, pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // Handle root-relative libs if any
      const libPath = path.join(__dirname, '..', pathname);
      if (fs.existsSync(libPath) && fs.statSync(libPath).isFile()) {
        const ext = path.extname(libPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        fs.createReadStream(libPath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
    });

    server.listen(PORT, () => {
      resolve(server);
    });
  });
}

async function runBrowserQa() {
  console.log(`Starting local static server on http://localhost:${PORT}...`);
  const server = await startServer();

  console.log('Launching Chromium headless browser...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const consoleLogs = [];
  const errors = [];

  const viewports = [
    { name: 'desktop-1440x900', width: 1440, height: 900, isMobile: false },
    { name: 'mobile-390x844', width: 390, height: 844, isMobile: true },
    { name: 'mobile-375x812', width: 375, height: 812, isMobile: true }
  ];

  try {
    for (const vp of viewports) {
      console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
        deviceScaleFactor: 2
      });

      await context.addInitScript(() => {
        try {
          sessionStorage.setItem('sl_user_cache', JSON.stringify({
            studentId: '20220101',
            name: 'Shree Sharma',
            role: 'student',
            semester: 4
          }));
          localStorage.setItem('sb-test-auth-token', JSON.stringify({
            access_token: 'mock-test-token',
            user: {
              id: 'user_123',
              user_metadata: {
                studentId: '20220101',
                name: 'Shree Sharma',
                role: 'student'
              }
            }
          }));
        } catch (_) {}
      });

      const page = await context.newPage();

      page.on('console', (msg) => {
        const text = msg.text();
        consoleLogs.push(`[${vp.name}] [${msg.type()}] ${text}`);
        if (msg.type() === 'error' && !text.includes('favicon') && !text.includes('adservice') && !text.includes('adsbygoogle') && !text.includes('Failed to load resource')) {
          errors.push(`[${vp.name}] ${text}`);
        }
      });

      page.on('pageerror', (err) => {
        errors.push(`[${vp.name}] PageError: ${err.message}`);
      });

      await page.goto(`http://localhost:${PORT}/chatbot.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      console.log(`[${vp.name}] Current URL:`, page.url(), 'Title:', await page.title());

      // Inject live Kyana chat messages with valid academic visualizations
      const renderSuccess = await page.evaluate(() => {
        const mockBinarySearchMessage = [
          'Here is the step-by-step trace of **Binary Search**:',
          '',
          '### 1. Algorithm Intuition',
          'We search for target $40$ within a sorted integer array by repeatedly halving the search space:',
          '',
          '```kyana_visual',
          JSON.stringify({
            version: 'kyana.visual.v1',
            engine: 'algo_anim',
            mode: 'simulation',
            title: 'Binary Search Demonstration',
            fallback: {
              type: 'markdown',
              content: 'Binary Search on [10, 20, 30, 40, 50, 60] searching for target 40.'
            },
            data: {
              algorithm: 'binary_search',
              initialArray: [10, 20, 30, 40, 50, 60],
              target: 40
            }
          }, null, 2),
          '```',
          '',
          '### 2. Time & Space Complexity',
          '- **Worst Case:** $O(\\log_2 n)$ comparisons',
          '- **Space Complexity:** $O(1)$ auxiliary space'
        ].join('\n');

        const mockMultiVisualizerMessage = [
          'Here is the **Stack (LIFO)** data structure and an **XOR Logic Gate** truth table:',
          '',
          '```kyana_visual',
          JSON.stringify({
            version: 'kyana.visual.v1',
            engine: 'dsa_linear',
            mode: 'simulation',
            title: 'Stack Operations (LIFO Discipline)',
            fallback: { type: 'markdown', content: 'Stack LIFO operations.' },
            data: {
              structure: 'stack',
              capacity: 5,
              operations: [
                { op: 'push', value: 10 },
                { op: 'push', value: 20 },
                { op: 'push', value: 30 },
                { op: 'pop' }
              ]
            }
          }, null, 2),
          '```',
          '',
          'And here is the interactive XOR gate simulator with live truth table evaluation:',
          '',
          '```kyana_visual',
          JSON.stringify({
            version: 'kyana.visual.v1',
            engine: 'truth_table',
            mode: 'interactive',
            title: 'XOR Logic Gate & Dynamic Truth Table',
            fallback: { type: 'markdown', content: 'XOR truth table.' },
            data: {
              variables: ['A', 'B'],
              expression: 'A XOR B'
            }
          }, null, 2),
          '```'
        ].join('\n');

        const messagesList = document.getElementById('kyanaMessagesList');
        const welcomeHero = document.getElementById('kyanaWelcomeHero');
        const app = document.getElementById('kyanaApp');

        if (!messagesList) return { ok: false, reason: 'kyanaMessagesList element not found' };

        if (welcomeHero) welcomeHero.style.display = 'none';
        if (app) app.classList.remove('is-empty');
        messagesList.innerHTML = '';

        // Turn 1: User message
        const userRow = document.createElement('div');
        userRow.className = 'kyana-msg kyana-msg-user';
        userRow.innerHTML = '<div class="kyana-msg-bubble"><p>Show binary search on [10, 20, 30, 40, 50, 60] for target 40</p></div>';
        messagesList.appendChild(userRow);

        // Turn 1: Assistant response
        const respRow1 = document.createElement('div');
        respRow1.className = 'kyana-msg kyana-msg-assistant';
        const doc1 = document.createElement('div');
        doc1.className = 'kyana-response-doc';
        respRow1.appendChild(doc1);
        messagesList.appendChild(respRow1);

        if (window.KyanaAdaptiveRenderer && window.KyanaAdaptiveRenderer.renderFormattedContent) {
          window.KyanaAdaptiveRenderer.renderFormattedContent(doc1, mockBinarySearchMessage, false);
        }

        // Turn 2: User message
        const userRow2 = document.createElement('div');
        userRow2.className = 'kyana-msg kyana-msg-user';
        userRow2.innerHTML = '<div class="kyana-msg-bubble"><p>Now show Stack and the XOR truth table</p></div>';
        messagesList.appendChild(userRow2);

        // Turn 2: Assistant response (Multi-Visualizers: Stack + XOR)
        const respRow2 = document.createElement('div');
        respRow2.className = 'kyana-msg kyana-msg-assistant';
        const doc2 = document.createElement('div');
        doc2.className = 'kyana-response-doc';
        respRow2.appendChild(doc2);
        messagesList.appendChild(respRow2);

        if (window.KyanaAdaptiveRenderer && window.KyanaAdaptiveRenderer.renderFormattedContent) {
          window.KyanaAdaptiveRenderer.renderFormattedContent(doc2, mockMultiVisualizerMessage, false);
        }

        return { ok: true };
      });

      console.log(`[${vp.name}] Render status:`, renderSuccess);
      await page.waitForTimeout(1000);

      // Verify that visualizers mounted inside the chat response
      const mountedCount = await page.evaluate(() => {
        return document.querySelectorAll('.kyana-visual-root').length;
      });
      console.log(`[${vp.name}] Mounted visualizer components inside chat: ${mountedCount}`);

      // Step forward on the Binary Search visualizer
      await page.evaluate(() => {
        const nextBtn = document.querySelector('.ky-search-visualizer .ky-btn-next');
        if (nextBtn) nextBtn.click();
      });
      await page.waitForTimeout(300);

      // Toggle input on XOR gate visualizer
      await page.evaluate(() => {
        const toggleBtnA = document.querySelector('.ky-logic-visualizer .ky-toggle-btn');
        if (toggleBtnA) toggleBtnA.click();
      });
      await page.waitForTimeout(300);

      // Check horizontal overflow
      const overflowInfo = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const bodyWidth = document.body.scrollWidth;
        const mainWidth = document.getElementById('kyanaMessagesList') ? document.getElementById('kyanaMessagesList').scrollWidth : 0;
        return {
          docWidth,
          winWidth,
          bodyWidth,
          mainWidth,
          hasDocOverflow: docWidth > winWidth,
          hasBodyOverflow: bodyWidth > winWidth
        };
      });

      console.log(`[${vp.name}] Overflow Check:`, overflowInfo);

      // Capture screenshots
      const ssPath = path.join(ARTIFACT_DIR, `phase2-4-${vp.name}.png`);
      await page.screenshot({ path: ssPath, fullPage: false });
      console.log(`[${vp.name}] Screenshot saved to ${ssPath}`);

      if (vp.name === 'desktop-1440x900') {
        const searchEl = await page.$('.ky-search-visualizer');
        if (searchEl) {
          const detailPath = path.join(ARTIFACT_DIR, 'phase2-4-chat-binary-search.png');
          await searchEl.screenshot({ path: detailPath });
          console.log(`Captured binary search detail screenshot to ${detailPath}`);
        }

        const logicEl = await page.$('.ky-logic-visualizer');
        if (logicEl) {
          const logicPath = path.join(ARTIFACT_DIR, 'phase2-4-chat-stack-and-xor.png');
          await logicEl.screenshot({ path: logicPath });
          console.log(`Captured logic/truth table detail screenshot to ${logicPath}`);
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n--- Browser QA Summary ---');
  if (errors.length > 0) {
    console.error(`Encountered ${errors.length} unexpected browser errors:`);
    errors.forEach(e => console.error('  - ', e));
  } else {
    console.log('Zero unexpected browser errors encountered!');
  }
}

runBrowserQa().catch(err => {
  console.error('Browser QA failed with error:', err);
  process.exit(1);
});
