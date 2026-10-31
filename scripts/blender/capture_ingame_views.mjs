import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// 1. Simple HTTP server to serve game HTML and assets
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/game') {
    reqPath = '/public/hide-and-seek-in-game.html';
  }
  const filePath = path.join(rootDir, reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let contentType = 'text/html';
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) contentType = 'application/javascript';
    else if (filePath.endsWith('.glb')) contentType = 'model/gltf-binary';
    else if (filePath.endsWith('.png')) contentType = 'image/png';
    else if (filePath.endsWith('.jpg')) contentType = 'image/jpeg';
    else if (filePath.endsWith('.json')) contentType = 'application/json';
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found: ' + reqPath);
  }
});

server.listen(9876, async () => {
  console.log('[+] Local game server listening on http://localhost:9876');

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2
  });

  page.on('console', msg => {
    console.log(`[Browser Console ${msg.type()}]`, msg.text());
  });
  page.on('pageerror', err => {
    console.error(`[Browser PageError]`, err.message);
  });
  page.on('requestfailed', req => {
    console.error(`[Browser RequestFailed]`, req.url(), req.failure() ? req.failure().errorText : '');
  });

  console.log('[+] Navigating to game...');
  await page.goto('http://localhost:9876/game', { waitUntil: 'networkidle' });

  // Wait for Three.js canvas & scene initialization
  await page.waitForTimeout(4000);

  // Inspect the scene graph in the page context
  const inspectInfo = await page.evaluate(() => {
    const game = window.__game;
    const results = {
      hasGame: !!game,
      hasThree: typeof THREE !== 'undefined',
      sceneChildren: game ? game.scene.children.length : 0,
      rooms: []
    };

    if (game && game.roomVisibilityList) {
      results.rooms = game.roomVisibilityList.map(r => ({
        id: r.id,
        x: r.x,
        y: r.y,
        z: r.z,
        childCount: r.group ? r.group.children.length : 0,
        hasBlenderProductionMesh: r.group ? !!r.group.userData.hasBlenderProductionMesh : false
      }));
    }

    const b6Room1 = game && game.roomVisibilityList && game.roomVisibilityList.find(r => r.id === 'Building B6 Classrooms Room 1');
    if (b6Room1 && b6Room1.group) {
      const meshNames = [];
      b6Room1.group.traverse(o => {
        if (o.name) meshNames.push({ name: o.name, type: o.type });
      });
      results.b6Room1MeshCount = meshNames.length;
      results.b6Room1SampleMeshes = meshNames.slice(0, 30);
    }

    return results;
  });

  console.log('[+] Inspection info:', JSON.stringify(inspectInfo, null, 2));

  await browser.close();
  server.close();
  console.log('[+] Browser inspection finished.');
});
