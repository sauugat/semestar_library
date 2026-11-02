import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { GLTF_LOADER_R128_JS } from '../mobile/components/games/hide-and-seek/gltfLoaderR128.ts';
import { LIBRARY_GLB_DATA_URI } from '../mobile/components/games/hide-and-seek/libraryGlbBase64.ts';
import { UNIFIED_SKY_DOME_BASE64 } from '../mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts';

const horrorConfigFile = fs.readFileSync('./mobile/components/games/hide-and-seek/horrorConfig.ts', 'utf8');
const gameHtmlFile = fs.readFileSync('./mobile/components/games/hide-and-seek/gameHtml.ts', 'utf8');

const marker = 'export const HORROR_CONFIG = ';
const configStart = horrorConfigFile.indexOf(marker) + marker.length;
let rawConfig = horrorConfigFile.slice(configStart).trim().replace(/;$/, '');
rawConfig = rawConfig.replace(/as\s+Record<[^>]+>/g, '');
const HORROR_CONFIG = eval('(' + rawConfig + ')');
const configJson = JSON.stringify(HORROR_CONFIG);

const start = gameHtmlFile.indexOf('return `');
const end = gameHtmlFile.lastIndexOf('`;') + 2;
const fnBody = gameHtmlFile.slice(start, end);
const fn = new Function('THREE_MIN_JS', 'GLTF_LOADER_R128_JS', 'LIBRARY_GLB_DATA_URI', 'UNIFIED_SKY_DOME_BASE64', 'HORROR_CONFIG', 'configJson', fnBody);
const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, UNIFIED_SKY_DOME_BASE64, HORROR_CONFIG, configJson);

async function captureVerificationViews() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
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

  console.log('Loading Gandaki University Campus Environment...');
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

  await page.waitForTimeout(2800);

  const outDir = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de';

  const shots = [
    {
      name: 'himalaya_01_courtyard_north.png',
      desc: 'Courtyard facing North towards Machapuchare and Annapurnas',
      x: -20.0, y: 2.8, z: -15.0, yaw: 0.0, pitch: 0.12
    },
    {
      name: 'himalaya_02_road_bus_north.png',
      desc: 'Main road next to bus looking across valley to mountain range',
      x: -48.0, y: 2.0, z: 8.5, yaw: 0.05, pitch: 0.14
    },
    {
      name: 'himalaya_03_rotunda_plaza.png',
      desc: 'Rotunda plaza with full open Himalayan horizon',
      x: -5.0, y: 2.8, z: -25.0, yaw: 0.15, pitch: 0.16
    },
    {
      name: 'himalaya_04_sky_and_summits_high.png',
      desc: 'Looking up at towering Machapuchare pyramid, stars, and twilight sky',
      x: -20.0, y: 2.8, z: -15.0, yaw: 0.10, pitch: 0.38
    }
  ];

  for (const shot of shots) {
    console.log(`Capturing: ${shot.desc}...`);
    await page.evaluate(({ x, y, z, yaw, pitch }) => {
      if (typeof physicsDebug !== 'undefined') {
        physicsDebug.teleport(x, y, z, yaw);
        playerPhysics.targetPitch = pitch;
        playerPhysics.pitch = pitch;
      }
    }, shot);

    await page.waitForTimeout(1200);
    const savePath = path.join(outDir, shot.name);
    await page.screenshot({ path: savePath });
    console.log(`Saved screenshot: ${savePath}`);
  }

  await browser.close();
  server.close();
  console.log('All verification shots captured successfully!');
}

captureVerificationViews();
