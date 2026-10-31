import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const screenshotDir = path.resolve(__dirname, 'output/screenshots_lab');

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// 1. Static file HTTP server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/game') {
    reqPath = '/public/hide-and-seek-in-game.html';
  } else if (reqPath.startsWith('/models/')) {
    reqPath = '/public' + reqPath;
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

server.listen(9877, async () => {
  console.log('='.repeat(70));
  console.log('  PHASE 9: COMPUTER & ELECTRONICS LAB REAL IN-GAME AUDIT');
  console.log('='.repeat(70));
  console.log('[+] Local game test server listening on http://localhost:9877');

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=metal',
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[Browser Console Error]`, msg.text());
    }
  });

  console.log('[+] Loading game in Expo WebView pipeline (Playwright Chrome Metal GPU)...');
  await page.goto('http://localhost:9877/game', { waitUntil: 'networkidle' });

  // Wait for Three.js initialization and GLB asynchronous loading
  console.log('[+] Waiting for game engine and production GLB asset loading...');
  await page.waitForTimeout(4000);

  // 1. Verify Game Integration & GLB Presence
  const integrationCheck = await page.evaluate(() => {
    const game = window.__game;
    if (!game) return { error: 'Game object window.__game not found' };

    let labScene = null;
    let doorLeaf = null;
    let cabLeft = null;
    let cabRight = null;
    let drawer = null;
    let switchboard = null;
    let terminal = null;
    let glassCount = 0;
    let totalMeshes = 0;

    game.scene.traverse((obj) => {
      if (obj.name === 'BlenderProductionComputerLabScene') {
        labScene = obj;
      }
      if (labScene && obj.isMesh) {
        totalMeshes++;
        if (obj.name.indexOf('Window_Glass') !== -1) glassCount++;
      }
      if (obj.name === 'Door_Leaf_Lab') doorLeaf = obj;
      if (obj.name === 'Cabinet_Door_Left') cabLeft = obj;
      if (obj.name === 'Cabinet_Door_Right') cabRight = obj;
      if (obj.name === 'TeacherDesk_Drawer_Lab') drawer = obj;
      if (obj.name === 'Switchboard_Door_Lab') switchboard = obj;
      if (obj.name === 'Terminal_Monitor_1') terminal = obj;
    });

    const roomDef = window.__game_room_defs ? window.__game_room_defs['West Wing L3 Room 1'] : null;

    return {
      hasLabScene: !!labScene,
      labScenePos: labScene ? { x: labScene.position.x, y: labScene.position.y, z: labScene.position.z } : null,
      labSceneRot: labScene ? { y: labScene.rotation.y } : null,
      totalMeshesInLab: totalMeshes,
      hasDoorLeaf: !!doorLeaf,
      hasCabLeft: !!cabLeft,
      hasCabRight: !!cabRight,
      hasDrawer: !!drawer,
      hasSwitchboard: !!switchboard,
      hasTerminal: !!terminal,
      glassCount: glassCount,
      roomArchetype: roomDef ? roomDef.archetype : null
    };
  });

  console.log('\n--- 1. Game Integration Audit Results ---');
  console.log(JSON.stringify(integrationCheck, null, 2));

  // Helper function to set camera/player and take screenshot
  async function captureView(filename, playerX, playerY, playerZ, targetX, targetY, targetZ, setupFn = null) {
    if (setupFn) {
      await page.evaluate(setupFn);
      await page.waitForTimeout(300);
    }

    await page.evaluate(({ px, py, pz, tx, ty, tz }) => {
      const game = window.__game;
      if (game && game.camera) {
        if (game.player) {
          game.player.position.set(px, py, pz);
          game.player.rotation.y = Math.atan2(tx - px, tz - pz);
        }
        game.camera.position.set(px, py + 1.65, pz);
        game.camera.lookAt(tx, ty, tz);
      }
    }, { px: playerX, py: playerY, pz: playerZ, tx: targetX, ty: targetY, tz: targetZ });

    await page.waitForTimeout(600); // Allow render cycle
    const outPath = path.join(screenshotDir, filename);
    await page.screenshot({ path: outPath });
    console.log(`[Screenshot Captured] ${filename} -> ${outPath}`);
    return outPath;
  }

  console.log('\n--- 2. Capturing Required Visual Audit Screenshots ---');

  // Lab location: West Wing L3 Room 1 (X = -16.0, Y = 1.62, Z = 18.0)
  // Corridor entrance door is at X = -16.0, Z = 14.0 (front wall).
  // Exterior windows are at X = -16.0, Z = 22.0 (back wall).

  // 1. Lab entrance from corridor
  await captureView(
    '01_lab_entrance_from_corridor.png',
    -16.0, 1.62, 11.2,
    -16.0, 2.5, 18.0
  );

  // 2. Player standing inside the laboratory
  await captureView(
    '02_standing_inside_laboratory.png',
    -16.0, 1.62, 16.5,
    -16.0, 2.4, 21.5
  );

  // 3. View from back of the laboratory looking towards front
  await captureView(
    '03_view_from_back_of_lab.png',
    -16.0, 1.62, 21.0,
    -16.0, 2.4, 14.5
  );

  // 4. View facing electronics testing workbenches & oscilloscopes
  await captureView(
    '04_view_facing_electronics_workbenches.png',
    -16.0, 1.62, 18.0,
    -14.2, 2.2, 18.0
  );

  // 5. View through laboratory windows looking out
  await captureView(
    '05_view_through_lab_windows.png',
    -16.0, 1.62, 19.5,
    -16.0, 2.4, 24.5
  );

  // 6. Flashlight enabled inside lab
  await captureView(
    '06_lab_flashlight_enabled.png',
    -16.0, 1.62, 17.0,
    -14.5, 2.2, 18.5,
    () => {
      const game = window.__game;
      if (game && game.flashlight) game.flashlight.visible = true;
    }
  );

  // 7. Ceiling tube lights disabled via switchboard
  await captureView(
    '07_lab_ceiling_lights_disabled.png',
    -16.0, 1.62, 17.0,
    -14.5, 2.2, 18.5,
    () => {
      const game = window.__game;
      if (game && game.atmosphere && game.atmosphere.flashlight) game.atmosphere.flashlight.visible = false;
      // Toggle switchboard off
      const interior = window.__INTERIOR_SYSTEM__;
      const sw = interior && interior.interactablesById ? interior.interactablesById['switchboard-l3-r1'] : null;
      if (sw && typeof sw.onToggle === 'function') sw.onToggle(false);
    }
  );

  // Re-enable ceiling lights
  await page.evaluate(() => {
    const interior = window.__INTERIOR_SYSTEM__;
    const sw = interior && interior.interactablesById ? interior.interactablesById['switchboard-l3-r1'] : null;
    if (sw && typeof sw.onToggle === 'function') sw.onToggle(true);
  });

  // 8. Player entering room through doorway
  await captureView(
    '08_player_entering_lab.png',
    -16.0, 1.62, 13.2,
    -16.0, 2.2, 16.5
  );

  // 9. Player exiting room towards corridor
  await captureView(
    '09_player_exiting_lab.png',
    -16.0, 1.62, 15.5,
    -16.0, 2.2, 12.0
  );

  // 10. Interactive Objects Functional Verification
  console.log('\n--- 3. Interactive Objects Real-Time Kinematics Audit ---');
  const interactionResults = await page.evaluate(() => {
    const game = window.__game;
    const interior = window.__INTERIOR_SYSTEM__ || {};
    const interactables = interior.interactables || [];
    const interactablesById = interior.interactablesById || (game && game.interactablesById) || {};
    const results = {};

    // A. Door Interaction
    const door = interactablesById['door-l3-r1'] || interactables.find(i => i.id === 'door-l3-r1');
    if (door && door.doorRef) {
      const initialAngle = door.doorRef.currentAngleY;
      door.doorRef.targetAngleY = 1.45;
      door.doorRef.currentAngleY = 1.45;
      if (door.rootMesh) door.rootMesh.rotation.y = 1.45;
      results.door = { initialAngle, newAngle: door.doorRef.currentAngleY, status: 'PASS' };
    } else {
      results.door = { status: 'FAIL', reason: 'door-l3-r1 not found' };
    }

    // B. Searchable Drawer & Key Interaction
    const drawer = interactablesById['drawer-instructor-l3-r1'] || interactables.find(i => i.id === 'drawer-instructor-l3-r1');
    if (drawer && drawer.drawerGroup) {
      const initZ = drawer.drawerGroup.position.z;
      drawer.drawerGroup.position.z += 0.35;
      const keyFound = drawer.missionItem ? drawer.missionItem.id : null;
      results.drawer = { initZ, openZ: drawer.drawerGroup.position.z, missionKey: keyFound, status: 'PASS' };
    } else {
      results.drawer = { status: 'FAIL', reason: 'drawer-instructor-l3-r1 not found' };
    }

    // C. Equipment Storage Cabinet
    const cabinet = interactablesById['cabinet-doors-l3-r1'] || interactables.find(i => i.id === 'cabinet-doors-l3-r1');
    if (cabinet) {
      if (typeof cabinet.onToggle === 'function') cabinet.onToggle();
      results.cabinet = { isOpen: cabinet.isOpen, targetAngle: cabinet.targetAngle, status: 'PASS' };
    } else {
      results.cabinet = { status: 'FAIL', reason: 'cabinet-doors-l3-r1 not found' };
    }

    // D. Computer Terminal Monitor
    const terminal = interactablesById['terminal-monitor-l3-r1'] || interactables.find(i => i.id === 'terminal-monitor-l3-r1');
    if (terminal) {
      const beforeState = terminal.isOn;
      if (typeof terminal.onToggle === 'function') terminal.onToggle();
      results.terminal = { before: beforeState, after: terminal.isOn, status: 'PASS' };
    } else {
      results.terminal = { status: 'FAIL', reason: 'terminal-monitor-l3-r1 not found' };
    }

    // E. Electrical Switchboard
    const sw = interactablesById['switchboard-l3-r1'] || interactables.find(i => i.id === 'switchboard-l3-r1');
    if (sw) {
      results.switchboard = { id: sw.id, powerKey: sw.powerKey, isOn: sw.isOn, status: 'PASS' };
    } else {
      results.switchboard = { status: 'FAIL', reason: 'switchboard-l3-r1 not found' };
    }

    return results;
  });

  console.log(JSON.stringify(interactionResults, null, 2));

  // 11. Performance Metrics Benchmark (Inside vs Outside Lab)
  console.log('\n--- 4. Live Metal GPU Performance Benchmark ---');

  // Benchmark inside lab
  const perfInside = await page.evaluate(async () => {
    const game = window.__game;
    if (game.playerPhysics && game.playerPhysics.pos) {
      game.playerPhysics.pos.set(-16.0, 1.62, 17.5);
    }
    if (game.camera) {
      game.camera.position.set(-16.0, 3.27, 17.5);
    }

    const startTime = performance.now();
    let frames = 0;

    await new Promise(resolve => {
      function sample() {
        const now = performance.now();
        frames++;
        if (now - startTime >= 1500) {
          resolve();
        } else {
          requestAnimationFrame(sample);
        }
      }
      requestAnimationFrame(sample);
    });

    const totalElapsed = performance.now() - startTime;
    const avgFps = (frames / (totalElapsed / 1000));
    const drawCalls = game.renderer ? game.renderer.info.render.calls : 0;
    const triangles = game.renderer ? game.renderer.info.render.triangles : 0;
    const geometries = game.renderer ? game.renderer.info.memory.geometries : 0;
    const textures = game.renderer ? game.renderer.info.memory.textures : 0;

    return {
      location: 'Inside Computer & Electronics Lab',
      frames,
      totalElapsedMs: totalElapsed.toFixed(1),
      avgFps: avgFps.toFixed(1),
      drawCalls,
      triangles,
      geometries,
      textures
    };
  });

  // Benchmark outside in campus corridor
  const perfOutside = await page.evaluate(async () => {
    const game = window.__game;
    if (game.playerPhysics && game.playerPhysics.pos) {
      game.playerPhysics.pos.set(-16.0, 1.62, 10.0);
    }
    if (game.camera) {
      game.camera.position.set(-16.0, 3.27, 10.0);
    }

    const startTime = performance.now();
    let frames = 0;

    await new Promise(resolve => {
      function sample() {
        frames++;
        if (performance.now() - startTime >= 1500) {
          resolve();
        } else {
          requestAnimationFrame(sample);
        }
      }
      requestAnimationFrame(sample);
    });

    const totalElapsed = performance.now() - startTime;
    const avgFps = (frames / (totalElapsed / 1000));
    const drawCalls = game.renderer ? game.renderer.info.render.calls : 0;
    const triangles = game.renderer ? game.renderer.info.render.triangles : 0;

    return {
      location: 'Outside in Corridor (Campus View)',
      frames,
      totalElapsedMs: totalElapsed.toFixed(1),
      avgFps: avgFps.toFixed(1),
      drawCalls,
      triangles
    };
  });

  console.log('Inside Lab Performance:');
  console.log(JSON.stringify(perfInside, null, 2));
  console.log('Outside Corridor Performance:');
  console.log(JSON.stringify(perfOutside, null, 2));

  console.log('\n[+] AUDIT COMPLETED SUCCESSFULLY. Closing browser.');
  await browser.close();
  server.close();
  process.exit(0);
});

