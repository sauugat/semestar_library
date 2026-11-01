import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { GLTF_LOADER_R128_JS } from '../mobile/components/games/hide-and-seek/gltfLoaderR128.ts';
import { LIBRARY_GLB_DATA_URI } from '../mobile/components/games/hide-and-seek/libraryGlbBase64.ts';
import { HORROR_CONFIG } from '../mobile/components/games/hide-and-seek/horrorConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateHtml() {
  const root = path.resolve(__dirname, '..');
  const gameHtmlPath = path.resolve(root, 'mobile/components/games/hide-and-seek/gameHtml.ts');
  const file = fs.readFileSync(gameHtmlPath, 'utf8');

  const configJson = JSON.stringify(HORROR_CONFIG);

  const start = file.indexOf("return `");
  const end = file.lastIndexOf("`;") + 2;
  const fnBody = file.slice(start, end);
  const fn = new Function("THREE_MIN_JS", "GLTF_LOADER_R128_JS", "LIBRARY_GLB_DATA_URI", "configJson", fnBody);
  const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, configJson);

  return html;
}

async function runTest() {
  console.log('Generating HTML...');
  const html = generateHtml();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Server listening on port ${port}`);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 412, height: 915 }, // Typical modern phone viewport
    deviceScaleFactor: 2.625 // Modern phone pixel ratio
  });

  const logs = [];
  page.on('console', msg => {
    const text = `[Browser ${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  page.on('pageerror', err => {
    console.error('[Browser PageError]', err);
  });

  console.log('Navigating to game...');
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForTimeout(2000);

  console.log('--- Initial status ---');
  let status = await page.evaluate(() => {
    return {
      currentQuality: typeof currentQuality !== 'undefined' ? currentQuality : null,
      activePreset: typeof activePreset !== 'undefined' ? activePreset.label : null,
      fps: typeof physicsDebug !== 'undefined' ? physicsDebug.fps : null,
      drawCalls: typeof atmosphere !== 'undefined' ? atmosphere.lastTotalDrawCalls : null,
      gradeActive: typeof atmosphere !== 'undefined' && atmosphere.isColorGradePassActive ? atmosphere.isColorGradePassActive() : null,
    };
  });
  console.log('Status before Ultra:', status);

  console.log('--- Switching to ULTRA mode ---');
  await page.evaluate(() => {
    window.postMessage(JSON.stringify({
      type: 'SET_QUALITY',
      quality: 'ultra',
      pinMode: 'ultra'
    }), '*');
  });

  console.log('Waiting 3 seconds to monitor frames...');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    const frameStatus = await page.evaluate(() => {
      return {
        currentQuality: typeof currentQuality !== 'undefined' ? currentQuality : null,
        activePreset: typeof activePreset !== 'undefined' ? activePreset.label : null,
        fps: typeof physicsDebug !== 'undefined' ? Math.round(physicsDebug.fps) : null,
        drawCalls: typeof atmosphere !== 'undefined' ? atmosphere.lastTotalDrawCalls : null,
        gradeActive: typeof atmosphere !== 'undefined' && atmosphere.isColorGradePassActive ? atmosphere.isColorGradePassActive() : null,
        timeSec: Date.now() * 0.001
      };
    });
    console.log(`Tick ${i + 1}:`, frameStatus);
  }

  console.log('Taking screenshot...');
  const screenshotPath = '/tmp/ultra_mode_test.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
  server.close();
}

runTest().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
