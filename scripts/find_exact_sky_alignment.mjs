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
let rawConfig = horrorConfigFile.slice(configStart).trim().replace(/;$/, '').replace(/as\s+Record<[^>]+>/g, '');
const HORROR_CONFIG = eval('(' + rawConfig + ')');
const configJson = JSON.stringify(HORROR_CONFIG);

const start = gameHtmlFile.indexOf('return `');
const end = gameHtmlFile.lastIndexOf('`;') + 2;
const fnBody = gameHtmlFile.slice(start, end);
const fn = new Function('THREE_MIN_JS', 'GLTF_LOADER_R128_JS', 'LIBRARY_GLB_DATA_URI', 'UNIFIED_SKY_DOME_BASE64', 'HORROR_CONFIG', 'configJson', fnBody);
const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, UNIFIED_SKY_DOME_BASE64, HORROR_CONFIG, configJson);

async function findAlignment() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1.0 });
  await page.goto('http://127.0.0.1:' + port);
  await page.evaluate(() => {
    window.postMessage(JSON.stringify({
      type: 'CONFIGURE',
      exploreMode: true,
      role: 'hider',
      quality: 'ultra',
      pinMode: 'ultra',
      muted: true
    }), '*');
  });
  await page.waitForTimeout(2000);

  // The screenshot media_1793608178805_4bc9d387.jpg was taken at position:
  // x: -20.0, y: 1.6, z: -22.0, yaw: 0.35, pitch: 0.12 (test_D)
  // Let us test different skySphere.rotation.y values:
  // In the original code before regression, it was: Math.PI - 0.22 (= 2.92)
  // Let us test rotY values: 2.70, 2.85, 2.92, 3.05, 3.14
  const rotYs = [2.70, 2.85, 2.92, 3.05, 3.14, 3.30, -0.22, 0.0, 0.22];

  for (const rotY of rotYs) {
    await page.evaluate(({ rotY }) => {
      // Find skySphere in scene
      scene.traverse(obj => {
        if (obj.isMesh && obj.geometry && obj.geometry.type === 'SphereGeometry') {
          obj.rotation.y = rotY;
        }
      });
      // Teleport to the user's viewpoint in media_1793608178805_4bc9d387.jpg:
      physicsDebug.teleport(-20.0, 1.6, -22.0, 0.35);
      playerPhysics.targetPitch = 0.12;
      playerPhysics.pitch = 0.12;
    }, { rotY });

    await page.waitForTimeout(100);
    const shot = await page.screenshot();
    fs.writeFileSync(`/tmp/align_rotY_${rotY.toFixed(2)}.png`, shot);
    console.log(`Saved /tmp/align_rotY_${rotY.toFixed(2)}.png`);
  }

  await browser.close();
  server.close();
}

findAlignment();
