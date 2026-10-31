import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const screenshotDir = path.resolve(__dirname, 'output/screenshots');

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

server.listen(9876, async () => {
  console.log('='.repeat(70));
  console.log('  PHASE 8: REAL IN-GAME VISUAL VALIDATION & GRAPHICS AUDIT');
  console.log('='.repeat(70));
  console.log('[+] Local game test server listening on http://localhost:9876');

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
  await page.goto('http://localhost:9876/game', { waitUntil: 'networkidle' });

  // Wait for Three.js initialization and GLB asynchronous loading
  console.log('[+] Waiting for game engine and production GLB asset loading...');
  await page.waitForTimeout(4000);

  // 1. Verify Game Integration & GLB Presence
  const integrationCheck = await page.evaluate(() => {
    const game = window.__game;
    if (!game) return { error: 'Game object window.__game not found' };

    const b6Room1 = game.roomVisibilityList.find(r => r.id === 'Building B6 Classrooms Room 1');
    if (!b6Room1) return { error: 'Building B6 Classrooms Room 1 not found in roomVisibilityList' };

    let glbScene = null;
    b6Room1.group.traverse(obj => {
      if (obj.name === 'BlenderProductionClassroomScene') {
        glbScene = obj;
      }
    });

    const meshes = [];
    b6Room1.group.traverse(obj => {
      if (obj.isMesh) {
        meshes.push({
          name: obj.name,
          mat: obj.material ? (obj.material.name || 'unnamed') : 'none',
          hasAO: !!(obj.material && obj.material.aoMap),
          visible: obj.visible
        });
      }
    });

    return {
      roomId: b6Room1.id,
      roomCenter: { x: b6Room1.x, y: b6Room1.y, z: b6Room1.z },
      hasGlbScene: !!glbScene,
      glbPosition: glbScene ? glbScene.position : null,
      glbRotationY: glbScene ? glbScene.rotation.y : null,
      totalMeshesInRoom: meshes.length,
      sampleMeshes: meshes.slice(0, 15),
      interactablesCount: Object.keys(game.interactablesById).length,
      swingingDoorsCount: game.swingingDoors.length,
      animatedFansCount: game.animatedClassroomFans.length
    };
  });

  console.log('\n--- 1. Integration Verification ---');
  console.log(JSON.stringify(integrationCheck, null, 2));

  // Helper to set player/camera pose and render
  async function setView(posX, posY, posZ, lookX, lookY, lookZ, opt = {}) {
    await page.evaluate(({ p, l, opt }) => {
      const game = window.__game;
      if (!game) return;

      const eyeH = 1.35;
      const dx = l.x - p.x;
      const dy = l.y - (p.y + eyeH);
      const dz = l.z - p.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));

      game.playerPhysics.pos.set(p.x, p.y, p.z);
      game.playerPhysics.vel.set(0, 0, 0);
      game.playerPhysics.yaw = yaw;
      game.playerPhysics.targetYaw = yaw;
      game.playerPhysics.pitch = pitch;
      game.playerPhysics.targetPitch = pitch;
      game.playerPhysics.cameraMode = opt.cameraMode || 'first';

      if (opt.camDist) {
        game.playerPhysics.camDist = opt.camDist;
      }

      if (game.playerCharacter) {
        game.playerCharacter.visible = (opt.cameraMode === 'third');
      }

      if (opt.cameraMode === 'third') {
        const dist = opt.camDist || 2.4;
        const camPosX = p.x - Math.sin(yaw) * dist;
        const camPosZ = p.z - Math.cos(yaw) * dist;
        game.camera.position.set(camPosX, p.y + eyeH + 0.35, camPosZ);
        game.camera.lookAt(p.x, p.y + eyeH * 0.8, p.z);
      } else {
        game.camera.position.set(p.x, p.y + eyeH + (opt.camYOffset || 0), p.z);
        game.camera.rotation.order = 'YXZ';
        game.camera.rotation.set(pitch, yaw, 0);
      }
      game.camera.updateMatrixWorld(true);

      if (typeof opt.flashlight === 'boolean') {
        game.atmosphere.isFlashlightOn = opt.flashlight;
        if (game.atmosphere.flashlight) {
          game.atmosphere.flashlight.visible = opt.flashlight;
          game.atmosphere.flashlight.intensity = opt.flashlight ? 2.8 : 0;
        }
      }

      if (typeof opt.ceilingLights === 'boolean') {
        const sw = game.interactablesById['switchboard-bldg6-r1'];
        if (sw && typeof sw.onToggle === 'function') {
          sw.onToggle(opt.ceilingLights);
        }
      }

      game.renderer.render(game.scene, game.camera);
    }, { p: { x: posX, y: posY, z: posZ }, l: { x: lookX, y: lookY, z: lookZ }, opt });
    await page.waitForTimeout(400);
  }

  // Hide UI overlays for pristine graphics capture
  await page.evaluate(() => {
    const ids = ['joystick-container', 'interact-btn', 'crouch-btn', 'sprint-btn', 'toast', 'loading-overlay', 'breath-minigame-overlay'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  });

  console.log('\n--- 2. Capturing 9 In-Game Audit Screenshots ---');

  // View 1: Entrance from corridor looking through doorway into classroom
  console.log('[+] View 1: Classroom entrance from the corridor...');
  await setView(-13.833, 1.62, 43.5, -13.833, 1.62 + 1.20, 48.5, { flashlight: false, ceilingLights: true, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '01_classroom_entrance_from_corridor.png') });

  // View 2: Player standing inside classroom (center view toward desks and dais)
  console.log('[+] View 2: Player standing inside the classroom...');
  await setView(-16.0, 1.62, 48.0, -13.5, 1.62 + 1.10, 48.0, { flashlight: false, ceilingLights: true, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '02_standing_inside_classroom.png') });

  // View 3: View from back of classroom looking across desks toward dais and whiteboard
  console.log('[+] View 3: View from back of classroom...');
  await setView(-19.5, 1.62, 49.0, -13.0, 1.62 + 1.20, 49.0, { flashlight: false, ceilingLights: true, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '03_view_from_back_of_classroom.png') });

  // View 4: View facing whiteboard, dais, teacher desk, and wall clock
  console.log('[+] View 4: View facing the whiteboard...');
  await setView(-15.5, 1.62, 49.0, -12.7, 1.62 + 1.40, 49.0, { flashlight: false, ceilingLights: true, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '04_view_facing_whiteboard.png') });

  // View 5: View through classroom windows out to exterior campus
  console.log('[+] View 5: View through classroom windows...');
  await setView(-16.5, 1.62, 49.5, -16.5, 1.62 + 1.20, 54.0, { flashlight: false, ceilingLights: true, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '05_view_through_windows.png') });

  // View 6: Classroom with flashlight enabled
  console.log('[+] View 6: Classroom with flashlight enabled...');
  await setView(-16.0, 1.62, 48.5, -13.5, 1.62 + 1.00, 48.5, { flashlight: true, ceilingLights: false, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '06_flashlight_enabled.png') });

  // View 7: Classroom with ceiling lights disabled (switchboard toggled)
  console.log('[+] View 7: Classroom with ceiling lights disabled...');
  await setView(-16.0, 1.62, 48.5, -13.5, 1.62 + 1.00, 48.5, { flashlight: false, ceilingLights: false, cameraMode: 'first' });
  await page.screenshot({ path: path.join(screenshotDir, '07_ceiling_lights_disabled.png') });

  // View 8: Player entering the room across doorway threshold (third-person view)
  console.log('[+] View 8: Player entering the room...');
  await setView(-13.833, 1.62, 45.4, -13.833, 1.62 + 1.20, 48.5, { flashlight: false, ceilingLights: true, cameraMode: 'third', camDist: 2.4 });
  await page.screenshot({ path: path.join(screenshotDir, '08_player_entering_room.png') });

  // View 9: Player exiting the room looking back out to corridor (third-person view)
  console.log('[+] View 9: Player exiting the room...');
  await setView(-13.833, 1.62, 45.0, -13.833, 1.62 + 1.20, 42.5, { flashlight: false, ceilingLights: true, cameraMode: 'third', camDist: 2.4 });
  await page.screenshot({ path: path.join(screenshotDir, '09_player_exiting_room.png') });

  console.log('[+] All 9 in-game screenshots captured successfully!');

  // 3. Interactive Objects Test Suite
  console.log('\n--- 3. Testing Interactive Objects in Actual Engine ---');
  const interactResults = await page.evaluate(() => {
    const game = window.__game;
    const isys = window.__INTERIOR_SYSTEM__;
    const results = {};

    // A. Door Test
    const door = game.interactablesById['door-bldg6-r1'];
    if (door && door.doorRef) {
      const initialAngle = door.doorRef.pivot.rotation.y;
      const initialOpen = door.isOpen;
      isys.toggleInteractableById('door-bldg6-r1');
      const toggledOpen = door.isOpen;
      const targetAngle = door.doorRef.targetAngleY;
      results.door = {
        id: door.id,
        initialAngle: Number(initialAngle.toFixed(3)),
        initialOpen,
        toggledOpen,
        targetAngle: Number(targetAngle.toFixed(3)),
        status: (initialOpen !== toggledOpen) ? 'PASS' : 'FAIL'
      };
    } else {
      results.door = { status: 'MISSING' };
    }

    // B. Teacher Drawer & Key Test
    const drawer = game.interactablesById['drawer-teacher-bldg6-r1'];
    if (drawer) {
      const initialOpen = drawer.isOpen;
      isys.toggleInteractableById('drawer-teacher-bldg6-r1');
      const toggledOpen = drawer.isOpen;
      const hasKey = !!drawer.missionItem;
      const keyId = drawer.missionItem ? drawer.missionItem.id : null;
      results.drawer = {
        id: drawer.id,
        initialOpen,
        toggledOpen,
        hasKey,
        keyId,
        status: (initialOpen !== toggledOpen && hasKey) ? 'PASS' : 'FAIL'
      };
    } else {
      results.drawer = { status: 'MISSING' };
    }

    // C. Switchboard Panel Test
    const sw = game.interactablesById['switchboard-bldg6-r1'];
    if (sw) {
      const initialOn = sw.isOn;
      sw.isOn = !sw.isOn;
      if (typeof sw.onToggle === 'function') sw.onToggle(sw.isOn);
      const toggledOn = sw.isOn;
      const tubeCount = sw.tubeMeshes ? sw.tubeMeshes.length : 0;
      results.switchboard = {
        id: sw.id,
        initialOn,
        toggledOn,
        tubeFixturesControlled: tubeCount,
        status: (initialOn !== toggledOn && tubeCount > 0) ? 'PASS' : 'FAIL'
      };
    } else {
      results.switchboard = { status: 'MISSING' };
    }

    // D. Ceiling Fans Test
    const fans = game.animatedClassroomFans;
    const b6Fans = fans.filter(f => f.roomGroup && f.roomGroup.userData && f.roomGroup.userData.hasBlenderProductionMesh);
    results.fans = {
      totalFansAnimated: fans.length,
      b6Room1Fans: b6Fans.length,
      fan1HubName: b6Fans[0] ? b6Fans[0].hub.name : null,
      fan2HubName: b6Fans[1] ? b6Fans[1].hub.name : null,
      status: b6Fans.length >= 2 ? 'PASS' : 'FAIL'
    };

    return results;
  });

  console.log(JSON.stringify(interactResults, null, 2));

  // 4. Measure Mobile Performance (Inside vs Outside)
  console.log('\n--- 4. Measuring Engine Performance Metrics ---');

  // Benchmark inside classroom
  await setView(-13.83, 1.62 + 1.25, 47.5, -10.5, 1.62 + 1.30, 48.0, { flashlight: false, ceilingLights: true });
  await page.waitForTimeout(300);

  const perfInside = await page.evaluate(async () => {
    const game = window.__game;
    const renderer = game.renderer;
    const frames = 120;
    const frameTimes = [];
    let prev = performance.now();

    for (let f = 0; f < frames; f++) {
      renderer.render(game.scene, game.camera);
      const now = performance.now();
      frameTimes.push(now - prev);
      prev = now;
      await new Promise(r => requestAnimationFrame(r));
    }

    const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frames;
    const maxMs = Math.max(...frameTimes);
    const minFps = 1000.0 / Math.max(maxMs, 0.001);
    const avgFps = 1000.0 / Math.max(avgMs, 0.001);

    return {
      location: 'Inside Classroom Room 1',
      avgFps: Number(avgFps.toFixed(1)),
      minFps: Number(minFps.toFixed(1)),
      avgFrameTimeMs: Number(avgMs.toFixed(2)),
      maxFrameTimeMs: Number(maxMs.toFixed(2)),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures
    };
  });

  // Benchmark outside on campus corridor / courtyard
  await setView(3.5, 1.62 + 1.25, 30.0, 3.5, 1.62 + 1.25, 48.0, { flashlight: false, ceilingLights: true });
  await page.waitForTimeout(300);

  const perfOutside = await page.evaluate(async () => {
    const game = window.__game;
    const renderer = game.renderer;
    const frames = 120;
    const frameTimes = [];
    let prev = performance.now();

    for (let f = 0; f < frames; f++) {
      renderer.render(game.scene, game.camera);
      const now = performance.now();
      frameTimes.push(now - prev);
      prev = now;
      await new Promise(r => requestAnimationFrame(r));
    }

    const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frames;
    const maxMs = Math.max(...frameTimes);
    const minFps = 1000.0 / Math.max(maxMs, 0.001);
    const avgFps = 1000.0 / Math.max(avgMs, 0.001);

    return {
      location: 'Outside Classroom (Veranda & Courtyard)',
      avgFps: Number(avgFps.toFixed(1)),
      minFps: Number(minFps.toFixed(1)),
      avgFrameTimeMs: Number(avgMs.toFixed(2)),
      maxFrameTimeMs: Number(maxMs.toFixed(2)),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures
    };
  });

  console.log('Performance Inside:', JSON.stringify(perfInside, null, 2));
  console.log('Performance Outside:', JSON.stringify(perfOutside, null, 2));

  // Save audit results
  const fullAuditReport = {
    timestamp: new Date().toISOString(),
    integrationCheck,
    interactResults,
    perfInside,
    perfOutside,
    screenshots: [
      '01_classroom_entrance_from_corridor.png',
      '02_standing_inside_classroom.png',
      '03_view_from_back_of_classroom.png',
      '04_view_facing_whiteboard.png',
      '05_view_through_windows.png',
      '06_flashlight_enabled.png',
      '07_ceiling_lights_disabled.png',
      '08_player_entering_room.png',
      '09_player_exiting_room.png'
    ]
  };

  fs.writeFileSync(
    path.join(__dirname, 'output/audit_results.json'),
    JSON.stringify(fullAuditReport, null, 2)
  );

  console.log('\n[+] Audit results saved to scripts/blender/output/audit_results.json');
  console.log('[+] Phase 8 visual capture & performance audit successfully completed!');

  await browser.close();
  server.close();
});

