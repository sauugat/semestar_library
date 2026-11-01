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
  return fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, configJson);
}

async function testStartup() {
  const html = generateHtml();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, // iPhone 14
    deviceScaleFactor: 3.0 // High DPI iPhone
  });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('TypeError') || msg.text().includes('GL_INVALID')) {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
      errors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    console.error('[PageError]', err);
    errors.push(err.message);
  });

  console.log('Loading page with direct CONFIGURE quality=ultra...');
  await page.goto(`http://127.0.0.1:${port}`);

  // Send CONFIGURE as onLoadEnd does
  await page.evaluate(() => {
    window.postMessage(JSON.stringify({
      type: 'CONFIGURE',
      exploreMode: true,
      role: 'hider',
      difficulty: 'medium',
      muted: false,
      quality: 'ultra',
      pinMode: 'ultra',
      batterySaver: false,
      fearIntensity: 'medium',
      flickerReduction: false,
      screenShakeOff: false
    }), '*');
  });

  await page.waitForTimeout(1000);

  // Monitor 10 frames
  let frozenCount = 0;
  let lastTime = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      fps: typeof physicsDebug !== 'undefined' ? Math.round(physicsDebug.fps) : 0,
      renderCalls: typeof atmosphere !== 'undefined' ? atmosphere.lastTotalDrawCalls : 0,
      currentQuality: typeof currentQuality !== 'undefined' ? currentQuality : null,
      gradeActive: typeof atmosphere !== 'undefined' && atmosphere.isColorGradePassActive ? atmosphere.isColorGradePassActive() : false,
      isMatchActive: typeof isMatchActive !== 'undefined' ? isMatchActive : false
    }));
    console.log(`Frame check ${i+1}:`, state);
  }

  await browser.close();
  server.close();
}

testStartup().catch(console.error);
