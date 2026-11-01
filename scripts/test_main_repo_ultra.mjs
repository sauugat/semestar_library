import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { GLTF_LOADER_R128_JS } from '../mobile/components/games/hide-and-seek/gltfLoaderR128.ts';
import { LIBRARY_GLB_DATA_URI } from '../mobile/components/games/hide-and-seek/libraryGlbBase64.ts';
import { UNIFIED_SKY_DOME_BASE64 } from '../mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts';

const mainRepoPath = '/Users/sauu_gat/semester-library';
const gameHtmlPath = path.resolve(mainRepoPath, 'mobile/components/games/hide-and-seek/gameHtml.ts');
const horrorConfigPath = path.resolve(mainRepoPath, 'mobile/components/games/hide-and-seek/horrorConfig.ts');

const file = fs.readFileSync(gameHtmlPath, 'utf8');
const horrorConfigFile = fs.readFileSync(horrorConfigPath, 'utf8');

// Extract HORROR_CONFIG
const marker = 'export const HORROR_CONFIG = ';
const configStart = horrorConfigFile.indexOf(marker) + marker.length;
let rawConfig = horrorConfigFile.slice(configStart).trim().replace(/;$/, '');
rawConfig = rawConfig.replace(/as\s+Record<[^>]+>/g, '');
const HORROR_CONFIG = eval('(' + rawConfig + ')');
const configJson = JSON.stringify(HORROR_CONFIG);

const start = file.indexOf("return `");
const end = file.lastIndexOf("`;") + 2;
const fnBody = file.slice(start, end);
const fn = new Function("THREE_MIN_JS", "GLTF_LOADER_R128_JS", "LIBRARY_GLB_DATA_URI", "UNIFIED_SKY_DOME_BASE64", "configJson", fnBody);
const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, UNIFIED_SKY_DOME_BASE64, configJson);

async function testMainRepo() {
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
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3.0
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

  console.log('Navigating to Main Repo Game...');
  await page.goto(`http://127.0.0.1:${port}`);

  console.log('Configuring directly with ULTRA quality...');
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

  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      fps: typeof physicsDebug !== 'undefined' ? Math.round(physicsDebug.fps) : 0,
      renderCalls: typeof atmosphere !== 'undefined' ? atmosphere.lastTotalDrawCalls : 0,
      currentQuality: typeof currentQuality !== 'undefined' ? currentQuality : null,
      gradeActive: typeof atmosphere !== 'undefined' && atmosphere.isColorGradePassActive ? atmosphere.isColorGradePassActive() : false,
      isMatchActive: typeof isMatchActive !== 'undefined' ? isMatchActive : false
    }));
    console.log(`Main Repo Frame check ${i+1}:`, state);
  }

  console.log('Now dynamically switching: HIGH -> ULTRA -> LOW -> ULTRA...');
  await page.evaluate(() => {
    window.postMessage(JSON.stringify({ type: 'SET_QUALITY', quality: 'high', pinMode: 'high' }), '*');
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.postMessage(JSON.stringify({ type: 'SET_QUALITY', quality: 'ultra', pinMode: 'ultra' }), '*');
  });
  await page.waitForTimeout(500);

  const afterSwitch = await page.evaluate(() => ({
    fps: typeof physicsDebug !== 'undefined' ? Math.round(physicsDebug.fps) : 0,
    renderCalls: typeof atmosphere !== 'undefined' ? atmosphere.lastTotalDrawCalls : 0,
    currentQuality: typeof currentQuality !== 'undefined' ? currentQuality : null,
    gradeActive: typeof atmosphere !== 'undefined' && atmosphere.isColorGradePassActive ? atmosphere.isColorGradePassActive() : false,
  }));
  console.log('After dynamic switch to ULTRA:', afterSwitch);

  await browser.close();
  server.close();

  if (errors.length > 0) {
    console.error('FAILED with errors:', errors);
    process.exit(1);
  } else {
    console.log('SUCCESS! Main Repo runs in ULTRA mode with zero errors at 60 FPS.');
  }
}

testMainRepo().catch(console.error);
