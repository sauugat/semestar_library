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

async function captureNaturalCampus() {
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
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2.0
  });

  console.log('Navigating to Campus Environment...');
  await page.goto(`http://127.0.0.1:${port}`);

  await page.evaluate(() => {
    window.postMessage(JSON.stringify({
      type: 'CONFIGURE',
      exploreMode: true,
      role: 'hider',
      difficulty: 'medium',
      muted: true,
      quality: 'ultra',
      pinMode: 'ultra',
      batterySaver: false,
      fearIntensity: 'low',
      flickerReduction: true,
      screenShakeOff: true
    }), '*');
  });

  await page.waitForTimeout(2000);

  const outDir = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de';

  // Shot 1: Looking at the parked yellow campus bus next to lantern streetlamps (matching Ref Image 1 & 2)
  console.log('Capturing Shot 1: Yellow campus bus & lantern lighting...');
  await page.evaluate(() => {
    if (typeof physicsDebug !== 'undefined') {
      physicsDebug.teleport(-48.0, 2.0, 8.5, 3.14);
      playerPhysics.targetPitch = 0.04;
      playerPhysics.pitch = 0.04;
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'campus_01_asphalt_road_buses.png') });

  // Shot 2: Courtyard / Interlocking pavers with warm lantern reflections (Ref Image 2)
  console.log('Capturing Shot 2: Interlocking stone pavers courtyard & warm lanterns...');
  await page.evaluate(() => {
    if (typeof physicsDebug !== 'undefined') {
      physicsDebug.teleport(-20.0, 2.8, -15.0, -1.8);
      playerPhysics.targetPitch = -0.08;
      playerPhysics.pitch = -0.08;
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'campus_02_courtyard_pavers_lanterns.png') });

  // Shot 3: Clean architectural building siding and warm study windows
  console.log('Capturing Shot 3: Clean building siding & golden window lighting...');
  await page.evaluate(() => {
    if (typeof physicsDebug !== 'undefined') {
      physicsDebug.teleport(16.0, 2.8, -50.0, 0.45);
      playerPhysics.targetPitch = 0.08;
      playerPhysics.pitch = 0.08;
    }
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'campus_03_building_facade_warm_windows.png') });

  // Shot 4: Rotunda / Campus Plaza with mountain horizon backdrop
  console.log('Capturing Shot 4: Campus grounds and mountain backdrop...');
  await page.evaluate(() => {
    if (typeof physicsDebug !== 'undefined') {
      physicsDebug.teleport(-5.0, 2.8, -25.0, -2.85);
      playerPhysics.targetPitch = 0.12;
      playerPhysics.pitch = 0.12;
    }
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'campus_04_rotunda_and_mountains.png') });

  console.log('All campus beauty shots captured successfully!');
  await browser.close();
  server.close();
}

captureNaturalCampus();
