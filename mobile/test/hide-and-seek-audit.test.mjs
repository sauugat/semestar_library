import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// HELPER: Initialize Full Game World & Physics Environment from gameHtml.ts
// ============================================================================
export function initGameEnvironment() {
  const gameHtmlPath = path.resolve(__dirname, '../components/games/hide-and-seek/gameHtml.ts');
  const horrorConfigPath = path.resolve(__dirname, '../components/games/hide-and-seek/horrorConfig.ts');

  const file = fs.readFileSync(gameHtmlPath, 'utf8');
  const horrorConfigFile = fs.readFileSync(horrorConfigPath, 'utf8');

  const marker = 'export const HORROR_CONFIG = ';
  const configStart = horrorConfigFile.indexOf(marker) + marker.length;
  let rawConfig = horrorConfigFile.slice(configStart).trim().replace(/;$/, '');
  rawConfig = rawConfig.replace(/as\s+Record<[^>]+>/g, '');
  const configObj = eval('(' + rawConfig + ')');
  const configJson = JSON.stringify(configObj);

  const scriptTag = '<script>';
  const firstScript = file.indexOf(scriptTag);
  const secondScript = file.indexOf(scriptTag, firstScript + 1);
  const endScript = file.lastIndexOf('</script>');
  let code = file.slice(secondScript + scriptTag.length, endScript);
  code = code.replace('${configJson}', configJson);
  // Safe default for timeSec parameter in updatePlayer for headless runner
  code = code.replace('function updatePlayer(delta) {', 'function updatePlayer(delta, timeSec = 0) {');

  code += `
globalThis.__HARNESS_EXPORTS__ = {
  colliders,
  walkableFloors,
  walkableStairRamps,
  interactiveHidingSpots,
  enterableBuses,
  isPositionClearOfColliders,
  bots,
  navWaypoints,
  playerPhysics,
  resolvePlayerMovement,
  getSupportFloorY,
  updatePlayer,
  scene,
  camera,
  raycastCameraDistance,
  performAction,
  performJump,
  toggleCrouch,
  touchMove,
  keys,
  startMatch,
  GAME_CONFIG,
  HORROR_CONFIG,
  isObstacle: (box) => {
    const playerBottom = playerPhysics.pos.y;
    const playerHeight = playerPhysics.isHiding ? 0.65 : (playerPhysics.isCrouching ? 1.05 : 1.8);
    const stepHeight = 0.52;
    const playerTop = playerBottom + playerHeight;
    if (box.max.y <= playerBottom + stepHeight) return false;
    if (box.min.y >= playerTop) return false;
    return true;
  }
};
`;

  const makeEl = () => ({
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    getContext() {
      return {
        fillStyle: '', fillRect() {}, strokeStyle: '', strokeRect() {},
        fillText() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {},
        fill() {}, arc() {}, ellipse() {}, save() {}, restore() {}, clearRect() {},
        createRadialGradient() { return { addColorStop() {} }; },
        createLinearGradient() { return { addColorStop() {} }; },
      };
    },
  });

  const dom = {
    getElementById: () => makeEl(),
    createElement: () => makeEl(),
    addEventListener: () => {},
  };

  const MockRenderer = function () {
    this.setSize = () => {};
    this.setPixelRatio = () => {};
    this.render = () => {};
    this.dispose = () => {};
    this.domElement = makeEl();
    this.shadowMap = {};
    this.capabilities = { maxTextures: 16 };
  };

  const sandbox = {
    THREE: Object.assign({}, THREE, { WebGLRenderer: MockRenderer }),
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 1280,
      innerHeight: 720,
      AudioContext: function () {
        return {
          createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {} } }),
          createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {}, setTargetAtTime() {} } }),
          createBiquadFilter: () => ({ connect() {}, frequency: { setValueAtTime() {}, setTargetAtTime() {} } }),
          createBufferSource: () => ({ connect() {}, start() {}, buffer: null }),
          createBuffer: () => ({ getChannelData() { return new Float32Array(100); } }),
          destination: {},
          currentTime: 0,
          resume: () => Promise.resolve(),
        };
      },
    },
    document: dom,
    console: { log() {}, warn() {}, error() {}, info() {} },
    Math,
    Date,
    performance: { now: () => Date.now() },
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    requestAnimationFrame: () => {},
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = dom;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);
  return sandbox.__HARNESS_EXPORTS__;
}

function boxContainsPoint(b, pt) {
  return (
    pt.x >= b.min.x && pt.x <= b.max.x &&
    pt.y >= b.min.y && pt.y <= b.max.y &&
    pt.z >= b.min.z && pt.z <= b.max.z
  );
}

// Global audit results collector for Step 3 Report
export const AUDIT_RESULTS = [];

function recordResult(testName, pass, measured, expected, details = {}) {
  const result = {
    testName,
    pass,
    status: pass ? 'PASS' : 'FAIL',
    measured: String(measured),
    expected: String(expected),
    ...details,
  };
  AUDIT_RESULTS.push(result);
  return result;
}

// ============================================================================
// TEST SUITE: Physics and Controls Audit
// ============================================================================
describe('Physics & Controls Audit: Gandaki University 3D Hide-and-Seek', () => {

  // --------------------------------------------------------------------------
  // 1. COLLISION AUDIT
  // --------------------------------------------------------------------------
  describe('1. Collision Audit', () => {
    test('1.1 Walk straight into exterior wall (West Wing L1 East Wall)', () => {
      const env = initGameEnvironment();
      // West Wing L1 (bldg_west_wing_l1 at (-4.0, 1.4, -9.51), span 32.5m x 7.6m): East wall at x = 12.25, z in [-13.31, -5.71]
      // Place player at (10.8, 1.65, -9.51) facing +X towards East wall
      env.playerPhysics.pos.set(10.8, 1.65, -9.51);
      env.playerPhysics.yaw = -Math.PI / 2; // looking +X
      env.playerPhysics.targetYaw = -Math.PI / 2;
      env.keys['KeyW'] = true;

      const positions = [];
      let tunneled = false;
      const dt = 1 / 60;

      for (let f = 0; f < 120; f++) {
        env.updatePlayer(dt, f * dt);
        positions.push({ x: env.playerPhysics.pos.x, z: env.playerPhysics.pos.z });
        // Check if penetrated beyond wall face (x > 12.25)
        if (env.playerPhysics.pos.x > 12.25) tunneled = true;
      }

      // Check jitter in last 30 frames (stationary against wall)
      const last30 = positions.slice(-30);
      const meanX = last30.reduce((s, p) => s + p.x, 0) / 30;
      const varianceX = last30.reduce((s, p) => s + Math.pow(p.x - meanX, 2), 0) / 30;
      const jitterRms = Math.sqrt(varianceX);

      // Check sticking: immediately release W and press S (move away -X)
      env.keys['KeyW'] = false;
      env.keys['KeyS'] = true;
      for (let f = 0; f < 30; f++) env.updatePlayer(dt, (120 + f) * dt);
      const detachedX = env.playerPhysics.pos.x;
      const detached = detachedX < meanX - 0.2;

      const pass = !tunneled && jitterRms < 0.001 && detached;
      recordResult(
        'Walk straight into exterior wall (Wing L1)',
        pass,
        `tunneled: ${tunneled}, jitter: ${jitterRms.toFixed(5)}m, detached: ${detached}`,
        'no tunneling, jitter < 0.001m, instant detachment',
        {
          file: 'gameHtml.ts',
          line: 6385,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
      assert.strictEqual(tunneled, false, 'Player should not tunnel into wall');
    });

    test('1.2 Walk into inside corner (Heritage Wing W1 northwest interior corner)', () => {
      const env = initGameEnvironment();
      // Inside corner of Newari Heritage Wing W1 (bldg_12 at (-63.5, 0, 48.5), 52m x 8m): west wall x = -89.5, north wall z = 52.5
      env.playerPhysics.pos.set(-88.2, 0.25, 51.2);
      env.playerPhysics.yaw = Math.PI * 0.75; // facing -X and +Z into corner
      env.playerPhysics.targetYaw = Math.PI * 0.75;
      env.keys['KeyW'] = true;

      const dt = 1 / 60;
      for (let f = 0; f < 120; f++) {
        env.updatePlayer(dt, f * dt);
      }
      const finalPos = env.playerPhysics.pos.clone();
      const isInsideAny = env.colliders.some(b => env.isObstacle(b) && boxContainsPoint(b, finalPos));
      const pass = !isInsideAny;

      recordResult(
        'Walk into inside corner',
        pass,
        `inside collider: ${isInsideAny}, finalPos: (${finalPos.x.toFixed(2)}, ${finalPos.z.toFixed(2)})`,
        'inside collider: false',
        {
          file: 'gameHtml.ts',
          line: 6455,
          position: finalPos,
          severity: pass ? 'None' : 'Critical',
        }
      );
      assert.strictEqual(isInsideAny, false);
    });

    test('1.3 Push diagonally into tight corner for 3 seconds (Vibration/Stability)', () => {
      const env = initGameEnvironment();
      // Inside southwest corner of West Wing L1 Room 1: west wall at x = -20.75, south corridor partition at z = -11.3
      env.playerPhysics.pos.set(-20.1, 1.60, -10.6);
      env.playerPhysics.yaw = 0;
      env.playerPhysics.targetYaw = 0;
      env.playerPhysics.vel.set(0, 0, 0);
      env.keys['KeyW'] = true; // -Z towards wall
      env.keys['KeyA'] = true; // -X towards west wall
      const dt = 1 / 60;

      const samples = [];
      for (let f = 0; f < 180; f++) {
        env.updatePlayer(dt, f * dt);
        if (f >= 60) samples.push({ x: env.playerPhysics.pos.x, z: env.playerPhysics.pos.z });
      }

      const meanX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
      const meanZ = samples.reduce((s, p) => s + p.z, 0) / samples.length;
      const maxDev = Math.max(...samples.map(p => Math.hypot(p.x - meanX, p.z - meanZ)));

      const pass = maxDev < 0.005;
      recordResult(
        'Push diagonally into tight corner 3s (Vibration)',
        pass,
        `maxDev: ${maxDev.toFixed(6)}m`,
        'maxDev < 0.005m (rock stable)',
        {
          file: 'gameHtml.ts',
          line: 6455,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'Medium',
        }
      );
      assert.ok(maxDev < 0.05, `Max deviation ${maxDev} exceeded tolerance`);
    });

    test('1.4 Squeeze through narrow gap: Car vs Wall (-6.5, -34.5 vs -6.5, -33.0)', () => {
      const env = initGameEnvironment();
      // Parked car at (-6.5, -34.5), collider bounds: cx-1.2 to cx+1.2, cz-2.2 to cz+2.2 => z in [-36.7, -32.3]
      // Wall of Wing L1 starts at z = -33.0!
      // The car collider overlaps the wall collider in Z by 0.7m!
      const carBox = env.colliders.find(b =>
        b.min.x <= -6.5 && b.max.x >= -6.5 && b.min.z <= -34.5 && b.max.z >= -34.5
      );
      const wallBox = env.colliders.find(b =>
        b !== carBox && b.min.x <= -6.5 && b.max.x >= -6.5 && Math.abs(b.min.z - (-33.0)) < 0.5
      );

      let gap = 0;
      let overlapping = false;
      if (carBox && wallBox) {
        // Intersect check
        overlapping = carBox.intersectsBox(wallBox);
        gap = wallBox.min.z - carBox.max.z; // negative if overlapping
      }

      // Try walking through gap from x = -4.5 to x = -8.5 at z = -33.5
      env.playerPhysics.pos.set(-4.5, 0, -33.5);
      env.playerPhysics.yaw = Math.PI / 2; // facing -X
      env.playerPhysics.targetYaw = Math.PI / 2;
      env.keys['KeyW'] = true;
      const dt = 1 / 60;
      for (let f = 0; f < 60; f++) env.updatePlayer(dt, f * dt);

      const pass = !overlapping && gap > 0.6;
      recordResult(
        'Squeeze narrow gap (Car vs Wall)',
        pass,
        `gap: ${gap.toFixed(2)}m (overlapping: ${overlapping})`,
        'clear walkable gap > 0.6m without collider overlap',
        {
          file: 'gameHtml.ts',
          line: 5090,
          position: env.playerPhysics.pos,
          severity: 'High',
        }
      );
    });

    test('1.5 Sprint into thin object: Street Lamp Post at (3.2, -61.0)', () => {
      const env = initGameEnvironment();
      // Lamp pole at (3.2, 0, -61.0)
      // Check if any collider encompasses this pole
      const lampColliders = env.colliders.filter(b =>
        b.min.x <= 3.2 && b.max.x >= 3.2 && b.min.z <= -61.0 && b.max.z >= -61.0
      );

      // Attempt to sprint through lamp from z = -58.0 to -64.0 at x = 3.2
      env.playerPhysics.pos.set(3.2, 0, -58.0);
      env.playerPhysics.yaw = 0; // facing -Z
      env.playerPhysics.targetYaw = 0;
      env.keys['KeyW'] = true;
      env.keys['ShiftLeft'] = true; // sprint 6.4m/s
      const dt = 1 / 60;

      let passedThrough = false;
      for (let f = 0; f < 90; f++) {
        env.updatePlayer(dt, f * dt);
        if (env.playerPhysics.pos.z < -61.5) passedThrough = true;
      }

      const pass = lampColliders.length > 0 && !passedThrough;
      recordResult(
        'Sprint into thin object: Street Lamp Post',
        pass,
        `colliders: ${lampColliders.length}, passedThrough: ${passedThrough}, finalZ: ${env.playerPhysics.pos.z.toFixed(2)}`,
        'colliders >= 1, passedThrough: false',
        {
          file: 'gameHtml.ts',
          line: 1848,
          position: { x: 3.2, y: 0, z: -61.0 },
          severity: 'Critical',
        }
      );
    });

    test('1.6 Sprint into thin object: Wrought-Iron Spiked Fence at z = 42.5', () => {
      const env = initGameEnvironment();
      // Fence at rotPlazaX - 18 (-12.0) to rotPlazaX - 6.5 (-0.5), z = 42.5
      const fenceColliders = env.colliders.filter(b =>
        b.min.x <= -6.0 && b.max.x >= -6.0 && b.min.z <= 42.5 && b.max.z >= 42.5
      );

      // Sprint from z = 39.0 towards z = 45.0 at x = -6.0
      env.playerPhysics.pos.set(-6.0, 0, 39.0);
      env.playerPhysics.yaw = Math.PI; // facing +Z
      env.playerPhysics.targetYaw = Math.PI;
      env.keys['KeyW'] = true;
      env.keys['ShiftLeft'] = true;
      const dt = 1 / 60;

      let passedThrough = false;
      for (let f = 0; f < 60; f++) {
        env.updatePlayer(dt, f * dt);
        if (env.playerPhysics.pos.z > 43.5) passedThrough = true;
      }

      const pass = fenceColliders.length > 0 && !passedThrough;
      recordResult(
        'Sprint into thin object: Wrought-Iron Fence',
        pass,
        `colliders: ${fenceColliders.length}, passedThrough: ${passedThrough}, finalZ: ${env.playerPhysics.pos.z.toFixed(2)}`,
        'colliders >= 1, passedThrough: false',
        {
          file: 'gameHtml.ts',
          line: 3403,
          position: { x: -6.0, y: 0, z: 42.5 },
          severity: 'Critical',
        }
      );
    });

    test('1.7 Run into map boundary in all 8 directions (including sprint+jump)', () => {
      const env = initGameEnvironment();
      const BOUND = 88.0;
      const dirs = [
        { name: '+X (East)', yaw: -Math.PI / 2, start: [80, 0, 0], check: p => p.x <= BOUND + 0.01 },
        { name: '-X (West)', yaw: Math.PI / 2, start: [-80, 0, 0], check: p => p.x >= -BOUND - 0.01 },
        { name: '+Z (North)', yaw: Math.PI, start: [0, 0, 80], check: p => p.z <= BOUND + 0.01 },
        { name: '-Z (South)', yaw: 0, start: [0, 0, -80], check: p => p.z >= -BOUND - 0.01 },
        { name: '+X +Z', yaw: -Math.PI * 0.75, start: [75, 0, 75], check: p => p.x <= BOUND + 0.01 && p.z <= BOUND + 0.01 },
        { name: '+X -Z', yaw: -Math.PI * 0.25, start: [75, 0, -75], check: p => p.x <= BOUND + 0.01 && p.z >= -BOUND - 0.01 },
        { name: '-X +Z', yaw: Math.PI * 0.75, start: [-75, 0, 75], check: p => p.x >= -BOUND - 0.01 && p.z <= BOUND + 0.01 },
        { name: '-X -Z', yaw: Math.PI * 0.25, start: [-75, 0, -75], check: p => p.x >= -BOUND - 0.01 && p.z >= -BOUND - 0.01 },
      ];

      let allPassed = true;
      const failedDirs = [];
      const dt = 1 / 60;

      for (const d of dirs) {
        env.playerPhysics.pos.set(d.start[0], d.start[1], d.start[2]);
        env.playerPhysics.yaw = d.yaw;
        env.playerPhysics.targetYaw = d.yaw;
        env.playerPhysics.vel.set(0, 0, 0);
        env.keys['KeyW'] = true;
        env.keys['ShiftLeft'] = true;
        env.performJump(); // Jump + sprint!

        for (let f = 0; f < 100; f++) {
          env.updatePlayer(dt, f * dt);
        }

        if (!d.check(env.playerPhysics.pos)) {
          allPassed = false;
          failedDirs.push(`${d.name} breached at (${env.playerPhysics.pos.x.toFixed(1)}, ${env.playerPhysics.pos.z.toFixed(1)})`);
        }
      }

      recordResult(
        'Map boundary in 8 directions (Sprint + Jump)',
        allPassed,
        allPassed ? 'Clamped at BOUND=88.0 in all 8 directions' : failedDirs.join('; '),
        'All 8 directions strictly <= 88.0m',
        {
          file: 'gameHtml.ts',
          line: 6388,
          position: env.playerPhysics.pos,
          severity: allPassed ? 'None' : 'Critical',
        }
      );
      assert.strictEqual(allPassed, true);
    });

    test('1.8 Object collision sweep: walk at world objects from 8 angles', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;

      // Objects to test:
      const targets = [
        { name: 'Campus Tree (-8.2, -53.5)', x: -8.2, z: -53.5, expectedBlocked: true },
        { name: 'Palm Tree (-6.2, -33.5)', x: -6.2, z: -33.5, expectedBlocked: true },
        { name: 'Dead Tree (-22.5, -34.0)', x: -22.5, z: -34.0, expectedBlocked: true },
        { name: 'Street Lamp Pole (3.2, -61.0)', x: 3.2, z: -61.0, expectedBlocked: true },
        { name: 'Street Lamp Pole (-1.2, -30.0)', x: -1.2, z: -30.0, expectedBlocked: true },
        { name: 'Wrought-Iron Fence (-10.0, 42.5)', x: -10.0, z: 42.5, expectedBlocked: true },
        { name: 'Mandala Archway Post (-14.1, -28.5)', x: -14.1, z: -28.5, expectedBlocked: true },
        { name: 'Campus Bench (Rotated 90 deg) (-4.2, -14.0)', x: -4.2, z: -14.0, expectedBlocked: true },
        { name: 'Parked Car (-17.0, -46.0)', x: -17.0, z: -46.0, expectedBlocked: true },
        { name: 'Stone Chaitya Stupa (-12.0, -16.0)', x: -12.0, z: -16.0, expectedBlocked: true },
        { name: 'Forecourt Circular Fountain (6.0, 42.5)', x: 6.0, z: 42.5, expectedBlocked: true },
      ];

      const objectAuditList = [];

      for (const tgt of targets) {
        let blockedCount = 0;
        const angles = [0, 45, 90, 135, 180, 225, 270, 315];
        for (const angDeg of angles) {
          const rad = (angDeg * Math.PI) / 180;
          const startX = tgt.x + Math.sin(rad) * 2.2;
          const startZ = tgt.z + Math.cos(rad) * 2.2;
          env.playerPhysics.pos.set(startX, 0, startZ);
          // Look towards target
          const targetYaw = Math.atan2(tgt.x - startX, tgt.z - startZ);
          env.playerPhysics.yaw = targetYaw;
          env.playerPhysics.targetYaw = targetYaw;
          env.playerPhysics.vel.set(0, 0, 0);
          env.keys['KeyW'] = true;

          for (let f = 0; f < 45; f++) env.updatePlayer(dt, f * dt);
          const finalDist = Math.hypot(env.playerPhysics.pos.x - tgt.x, env.playerPhysics.pos.z - tgt.z);
          // If stopped at >= 0.25m from center, considered blocked
          if (finalDist >= 0.25) blockedCount++;
        }

        const pass = blockedCount === 8;
        objectAuditList.push({
          name: tgt.name,
          blocked: `${blockedCount}/8 angles`,
          pass,
        });

        recordResult(
          `Object walk sweep: ${tgt.name}`,
          pass,
          `blocked: ${blockedCount}/8`,
          'blocked: 8/8 angles',
          {
            file: 'gameHtml.ts',
            position: { x: tgt.x, y: 0, z: tgt.z },
            severity: pass ? 'None' : (blockedCount === 0 ? 'Critical' : 'High'),
          }
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. REVERSED-CONTROLS BUG AUDIT
  // --------------------------------------------------------------------------
  describe('2. Reversed-Controls Bug Audit', () => {
    test('2.1 Near wall: joystick forward, back, left, right movement dot product', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;

      // Test locations along different wall orientations
      const locations = [
        { desc: 'East face of West Wing L1 (x = -2.7)', pos: [-2.99, 0, -18.0], norm: [-1, 0, 0] },
        { desc: 'South face of Wing L1 (z = -3.0)', pos: [-6.5, 0, -3.29], norm: [0, 0, -1] },
        { desc: 'Inside corner Wing L1/L2', pos: [-13.9, 0, -25.8], norm: [-0.707, 0, -0.707] },
        { desc: 'Rotunda Portico Entrance', pos: [6.0, 0, 53.7], norm: [0, 0, -1] },
      ];

      const inputs = [
        { name: 'Forward', f: 1, r: 0 },
        { name: 'Back', f: -1, r: 0 },
        { name: 'Right', f: 0, r: 1 },
        { name: 'Left', f: 0, r: -1 },
      ];

      const yaws = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2];

      let anyReversed = false;
      const failures = [];

      for (const loc of locations) {
        for (const yaw of yaws) {
          for (const inp of inputs) {
            env.playerPhysics.pos.set(loc.pos[0], loc.pos[1], loc.pos[2]);
            env.playerPhysics.vel.set(0, 0, 0);
            env.playerPhysics.yaw = yaw;
            env.playerPhysics.targetYaw = yaw;
            env.playerPhysics.smoothMoveX = inp.r;
            env.playerPhysics.smoothMoveZ = inp.f;
            env.touchMove.x = inp.r;
            env.touchMove.y = -inp.f;

            // Expected movement direction in world space from yaw:
            const sinY = Math.sin(yaw);
            const cosY = Math.cos(yaw);
            const expDx = (inp.r * cosY + inp.f * -sinY);
            const expDz = (inp.r * sinY + inp.f * -cosY);
            const expMag = Math.hypot(expDx, expDz);

            const startX = env.playerPhysics.pos.x;
            const startZ = env.playerPhysics.pos.z;

            // Run 5 frames
            for (let f = 0; f < 5; f++) env.updatePlayer(dt, f * dt);

            const actualDx = env.playerPhysics.pos.x - startX;
            const actualDz = env.playerPhysics.pos.z - startZ;
            const actualDist = Math.hypot(actualDx, actualDz);

            // If player actually moved:
            if (actualDist > 0.005 && expMag > 0.01) {
              const dot = (actualDx * expDx + actualDz * expDz) / (actualDist * expMag);
              if (dot < -0.05) {
                anyReversed = true;
                failures.push(
                  `${loc.desc} | Yaw: ${(yaw * 180 / Math.PI).toFixed(0)}° | Input: ${inp.name} | Dot: ${dot.toFixed(3)}`
                );
              }
            }
          }
        }
      }

      const pass = !anyReversed;
      recordResult(
        'Reversed-controls: dot product check near walls & corners',
        pass,
        pass ? 'All dot products >= 0' : failures.slice(0, 3).join('; '),
        'Dot product >= 0 (no reverse movement)',
        {
          file: 'gameHtml.ts',
          line: 7050,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('2.2 Rotate yaw during wall sliding (Direction consistency)', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;
      // Along wall x = -2.7, moving in Z
      env.playerPhysics.pos.set(-2.98, 0, -20.0);
      env.playerPhysics.vel.set(0, 0, 0);
      env.keys['KeyW'] = true;

      let consistent = true;
      let prevZ = env.playerPhysics.pos.z;

      // Rotate yaw while holding forward against wall
      for (let deg = -60; deg <= 60; deg += 10) {
        const rad = (deg * Math.PI) / 180;
        env.playerPhysics.targetYaw = rad;
        for (let f = 0; f < 10; f++) {
          env.updatePlayer(dt, f * dt);
        }
        // Since rad is between -60 and +60, -cos(rad) is negative, so player should keep moving -Z!
        if (env.playerPhysics.pos.z > prevZ + 0.01) {
          consistent = false;
        }
        prevZ = env.playerPhysics.pos.z;
      }

      recordResult(
        'Rotate yaw during wall sliding',
        consistent,
        `consistent: ${consistent}`,
        'movement direction remains continuous without snapping backward',
        {
          file: 'gameHtml.ts',
          line: 7050,
          position: env.playerPhysics.pos,
          severity: consistent ? 'None' : 'Medium',
        }
      );
      assert.strictEqual(consistent, true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. FRAMERATE INDEPENDENCE AUDIT
  // --------------------------------------------------------------------------
  describe('3. Framerate Independence Audit', () => {
    test('3.1 10-second run at 60, 30 and 15 FPS: distance variance', () => {
      const runSim = (fps) => {
        const env = initGameEnvironment();
        env.playerPhysics.pos.set(0, 0, 0);
        env.playerPhysics.yaw = 0; // facing -Z
        env.playerPhysics.targetYaw = 0;
        env.playerPhysics.vel.set(0, 0, 0);
        env.keys['KeyW'] = true;

        const dt = 1 / fps;
        const totalFrames = Math.round(10.0 * fps);
        for (let f = 0; f < totalFrames; f++) {
          env.updatePlayer(dt, f * dt);
        }
        return Math.abs(env.playerPhysics.pos.z);
      };

      const dist60 = runSim(60);
      const dist30 = runSim(30);
      const dist15 = runSim(15);

      const diff30 = Math.abs(dist30 - dist60) / dist60;
      const diff15 = Math.abs(dist15 - dist60) / dist60;
      const maxDiff = Math.max(diff30, diff15);

      const pass = maxDiff <= 0.05;
      recordResult(
        'Framerate independence: 10s run (60 vs 30 vs 15 FPS)',
        pass,
        `60fps: ${dist60.toFixed(2)}m, 30fps: ${dist30.toFixed(2)}m (${(diff30 * 100).toFixed(1)}%), 15fps: ${dist15.toFixed(2)}m (${(diff15 * 100).toFixed(1)}%)`,
        'Difference <= 5.0%',
        {
          file: 'gameHtml.ts',
          line: 7063,
          position: { x: 0, y: 0, z: -dist60 },
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('3.2 Jump height at 60, 30 and 15 FPS', () => {
      const jumpSim = (fps) => {
        const env = initGameEnvironment();
        env.playerPhysics.pos.set(0, 0, 0);
        env.playerPhysics.vel.set(0, 0, 0);
        env.performJump();

        let peakY = 0;
        const dt = 1 / fps;
        for (let f = 0; f < Math.round(2.0 * fps); f++) {
          env.updatePlayer(dt, f * dt);
          if (env.playerPhysics.pos.y > peakY) peakY = env.playerPhysics.pos.y;
        }
        return peakY;
      };

      const peak60 = jumpSim(60);
      const peak30 = jumpSim(30);
      const peak15 = jumpSim(15);

      const diff30 = Math.abs(peak30 - peak60) / peak60;
      const diff15 = Math.abs(peak15 - peak60) / peak60;
      const maxDiff = Math.max(diff30, diff15);

      const pass = maxDiff <= 0.05;
      recordResult(
        'Framerate independence: Jump height (60 vs 30 vs 15 FPS)',
        pass,
        `60fps: ${peak60.toFixed(3)}m, 30fps: ${peak30.toFixed(3)}m (${(diff30 * 100).toFixed(1)}%), 15fps: ${peak15.toFixed(3)}m (${(diff15 * 100).toFixed(1)}%)`,
        'Difference <= 5.0%',
        {
          file: 'gameHtml.ts',
          line: 7070,
          position: { x: 0, y: peak60, z: 0 },
          severity: pass ? 'None' : 'Medium',
        }
      );
    });

    test('3.3 Mid-run lag spike (1.0s freeze): Tunneling & Teleportation check', () => {
      const env = initGameEnvironment();
      // Wall at x = -2.7, thickness 0.2m (min.x = -2.7, max.x = -2.5)
      // Place player at x = -3.0 (0.02m from wall contact!)
      env.playerPhysics.pos.set(-3.0, 0, -18.0);
      env.playerPhysics.yaw = -Math.PI / 2; // facing +X
      env.playerPhysics.targetYaw = -Math.PI / 2;
      env.playerPhysics.vel.set(6.4, 0, 0); // full sprint speed into wall
      env.keys['KeyW'] = true;
      env.keys['ShiftLeft'] = true;

      // In game loop, a 1-second freeze occurs: rawDelta = 1.0, clamped in animate() to delta = 0.1
      const lagDelta = 0.10;
      env.updatePlayer(lagDelta, 1.0);

      // Check if player passed through to x > -2.5
      const tunneled = env.playerPhysics.pos.x > -2.5;
      const pass = !tunneled;

      recordResult(
        'Mid-run 1.0s lag spike (delta=0.1s tunneling check)',
        pass,
        `finalX: ${env.playerPhysics.pos.x.toFixed(3)}m (tunneled: ${tunneled})`,
        'finalX <= -2.70m - radius (-2.98m), tunneled: false',
        {
          file: 'gameHtml.ts',
          line: 6387,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'Critical',
        }
      );
    });

    test('3.4 Diagonal speed vs straight speed', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;

      // Measure straight jog speed (touchMove y = -0.7)
      env.playerPhysics.pos.set(0, 0, 0);
      env.playerPhysics.vel.set(0, 0, 0);
      env.touchMove.x = 0;
      env.touchMove.y = -0.70;
      for (let f = 0; f < 60; f++) env.updatePlayer(dt, f * dt);
      const straightSpeed = Math.hypot(env.playerPhysics.vel.x, env.playerPhysics.vel.z);

      // Measure diagonal jog speed (touchMove x = 0.7, y = -0.7)
      env.playerPhysics.pos.set(0, 0, 0);
      env.playerPhysics.vel.set(0, 0, 0);
      env.touchMove.x = 0.70;
      env.touchMove.y = -0.70;
      for (let f = 0; f < 60; f++) env.updatePlayer(dt, f * dt);
      const diagSpeed = Math.hypot(env.playerPhysics.vel.x, env.playerPhysics.vel.z);

      const ratio = diagSpeed / straightSpeed;
      const pass = Math.abs(ratio - 1.0) < 0.05;

      recordResult(
        'Diagonal speed equals straight speed',
        pass,
        `straight: ${straightSpeed.toFixed(2)}m/s, diagonal: ${diagSpeed.toFixed(2)}m/s, ratio: ${ratio.toFixed(2)}`,
        'ratio: 1.00 (tolerance +- 0.05)',
        {
          file: 'gameHtml.ts',
          line: 7042,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. JUMP, CROUCH, GROUND AUDIT
  // --------------------------------------------------------------------------
  describe('4. Jump, Crouch & Ground Audit', () => {
    test('4.1 Jump against wall: no vertical wall-climbing or sticking', () => {
      const env = initGameEnvironment();
      // West Wing L1 East Wall at x = 11.75, z = -9.5 (floorY = 1.60m)
      const startY = env.getSupportFloorY(11.1, -9.5, 1.60);
      env.playerPhysics.pos.set(11.1, startY, -9.5);
      env.playerPhysics.isGrounded = true;
      env.playerPhysics.yaw = -Math.PI / 2; // pushing into wall
      env.keys['KeyW'] = true;
      env.performJump();

      const dt = 1 / 60;
      let maxY = startY;
      for (let f = 0; f < 90; f++) {
        env.updatePlayer(dt, f * dt);
        if (env.playerPhysics.pos.y > maxY) maxY = env.playerPhysics.pos.y;
      }

      // Normal jump peak above startY is ~0.82m
      const jumpGain = maxY - startY;
      const climbed = jumpGain > 1.20;
      const pass = !climbed;

      recordResult(
        'Jump against wall (No climbing / sticking)',
        pass,
        `jumpGain: ${jumpGain.toFixed(3)}m (climbed: ${climbed})`,
        'jumpGain ~ 0.82m, climbed: false',
        {
          file: 'gameHtml.ts',
          line: 7070,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
      assert.strictEqual(climbed, false);
    });

    test('4.2 Jump under low eave / ceiling (Head bump detection)', () => {
      const env = initGameEnvironment();
      // Check if vertical ceiling collision exists in physics
      // Add a test obstacle ceiling box at y = [2.2, 2.5]
      env.colliders.push(new THREE.Box3(
        new THREE.Vector3(-1, 2.2, -1),
        new THREE.Vector3(1, 2.5, 1)
      ));

      env.playerPhysics.pos.set(0, 0, 0); // Player height = 1.8m
      env.performJump(); // Jump vel = 5.2m/s, reaches 0.82m -> top = 1.8 + 0.82 = 2.62m > 2.2m!

      const dt = 1 / 60;
      let maxHeadY = 0;
      for (let f = 0; f < 60; f++) {
        env.updatePlayer(dt, f * dt);
        const headY = env.playerPhysics.pos.y + env.playerPhysics.height;
        if (headY > maxHeadY) maxHeadY = headY;
      }

      // If ceiling collision works, headY should not exceed 2.2m
      const bumped = maxHeadY <= 2.22;
      recordResult(
        'Jump under low eave (Head bump ceiling check)',
        bumped,
        `maxHeadY: ${maxHeadY.toFixed(3)}m (ceiling at 2.20m)`,
        'maxHeadY <= 2.20m (head bumps and stops)',
        {
          file: 'gameHtml.ts',
          line: 7071,
          position: env.playerPhysics.pos,
          severity: bumped ? 'None' : 'High',
        }
      );
    });

    test('4.3 Crouch under low obstacle & release (Clearance check)', () => {
      const env = initGameEnvironment();
      // Add obstacle at y: [1.25, 2.0]
      env.colliders.push(new THREE.Box3(
        new THREE.Vector3(-1, 1.25, -1),
        new THREE.Vector3(1, 2.0, 1)
      ));

      env.playerPhysics.pos.set(0, 0, 0);
      env.playerPhysics.isCrouching = true; // crouch height = 1.05m < 1.25m (fits!)

      // User releases crouch / toggles crouch under the obstacle
      env.toggleCrouch();

      // If standing up, height is 1.8m which penetrates [1.25, 2.0]!
      // A proper controller checks headroom before allowing stand-up!
      const stayedCrouched = env.playerPhysics.isCrouching;
      const pass = stayedCrouched;

      recordResult(
        'Crouch under low obstacle & release (Headroom check)',
        pass,
        `isCrouching after release: ${env.playerPhysics.isCrouching}`,
        'isCrouching remains true until cleared',
        {
          file: 'gameHtml.ts',
          line: 6794,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('4.4 Curbs and steps: Stupa base plinth tiers stepping', () => {
      const env = initGameEnvironment();
      // Stupa at (-12.0, -16.0), plinth has tiers at y = 0.10, 0.34, 0.63
      // But collider is a single block from y=0 to y=2.8!
      // Walk towards stupa base from x = -15.0 at z = -16.0
      env.playerPhysics.pos.set(-15.0, 0, -16.0);
      env.playerPhysics.yaw = -Math.PI / 2; // facing +X
      env.playerPhysics.targetYaw = -Math.PI / 2;
      env.keys['KeyW'] = true;

      const dt = 1 / 60;
      let highestY = 0;
      for (let f = 0; f < 90; f++) {
        env.updatePlayer(dt, f * dt);
        if (env.playerPhysics.pos.y > highestY) highestY = env.playerPhysics.pos.y;
      }

      // Can player step onto the 0.10m / 0.34m plinth tiers?
      const steppedOnPlinth = highestY >= 0.10;
      recordResult(
        'Curbs & steps: Stupa base plinth tiers',
        steppedOnPlinth,
        `highestY reached: ${highestY.toFixed(3)}m (tier 1 is 0.10m, tier 2 is 0.34m)`,
        'Player steps up onto tiers within stepHeight (0.52m)',
        {
          file: 'gameHtml.ts',
          line: 4005,
          position: env.playerPhysics.pos,
          severity: steppedOnPlinth ? 'None' : 'Medium',
        }
      );
    });

    test('4.5 Below ground check: Respawn handling', () => {
      const env = initGameEnvironment();
      // Drop player deep under the ground
      env.playerPhysics.pos.set(-4, -8.0, -48);
      env.playerPhysics.vel.set(0, -10, 0);

      const dt = 1 / 60;
      for (let f = 0; f < 30; f++) env.updatePlayer(dt, f * dt);

      // Check if respawned to initial spawn pos (-4, 0, -48)
      const respawned = env.playerPhysics.pos.y >= 0.0 && env.playerPhysics.pos.y <= 0.1;
      recordResult(
        'Player under ground: Fall respawn trigger',
        respawned,
        `pos.y: ${env.playerPhysics.pos.y.toFixed(2)}`,
        'pos.y == 0.0 (respawned at campus surface)',
        {
          file: 'gameHtml.ts',
          line: 7072,
          position: env.playerPhysics.pos,
          severity: respawned ? 'None' : 'Critical',
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. CAMERA AUDIT
  // --------------------------------------------------------------------------
  describe('5. Camera Audit', () => {
    test('5.1 First-person camera: pressed against wall near-plane check', () => {
      const env = initGameEnvironment();
      env.playerPhysics.cameraMode = 'first';
      // Press player against wall at x = -2.7 (player pos x = -2.98)
      env.playerPhysics.pos.set(-2.98, 0, -18.0);
      env.playerPhysics.yaw = -Math.PI / 2; // looking into wall (+X)
      env.updatePlayer(1 / 60, 0);

      // Camera position
      const camX = env.camera.position.x;
      const distToWall = Math.abs(-2.7 - camX);
      const nearPlane = 0.12;
      const clips = distToWall < nearPlane;

      const pass = !clips;
      recordResult(
        'First-person camera pressed against wall',
        pass,
        `distToWall: ${distToWall.toFixed(3)}m vs nearPlane: ${nearPlane}m`,
        'distToWall >= nearPlane (no clipping/see-through)',
        {
          file: 'gameHtml.ts',
          line: 7184,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('5.2 Third-person camera: 1.35m hard clamp wall see-through bug', () => {
      const env = initGameEnvironment();
      env.playerPhysics.cameraMode = 'third';
      // Place player 0.4m in front of wall at x = -2.7: player at (-3.1, 0, -18)
      // Player looks away from wall (-X, yaw = Math.PI/2)
      // Camera is placed BEHIND player (+X, towards wall at -2.7)
      env.playerPhysics.pos.set(-3.1, 0, -18.0);
      env.playerPhysics.yaw = Math.PI / 2; // looking away from wall
      env.playerPhysics.camDist = 3.4;

      const targetCamDist = env.raycastCameraDistance(
        env.playerPhysics.pos.x,
        1.77,
        env.playerPhysics.pos.z,
        Math.sin(env.playerPhysics.yaw),
        0,
        Math.cos(env.playerPhysics.yaw),
        3.4
      );

      // In line 6582: shortest = Math.max(1.35, tmin - 0.25)
      // Distance from player (-3.1) to wall (-2.7) is 0.40m!
      // tmin is 0.40m. But shortest is clamped to 1.35m!
      // So camera distance is 1.35m, placing camera at -3.1 + 1.35 = -1.75m (0.95m INSIDE THE WALL!)
      const camX = env.playerPhysics.pos.x + Math.sin(env.playerPhysics.yaw) * targetCamDist;
      const insideWall = camX > -2.70; // wall face is at -2.70!

      const pass = !insideWall;
      recordResult(
        'Third-person camera wall occlusion (1.35m clamp bug)',
        pass,
        `targetCamDist: ${targetCamDist.toFixed(2)}m, camX: ${camX.toFixed(2)}m (inside wall: ${insideWall})`,
        'camX < -2.70m (camera remains in front of wall)',
        {
          file: 'gameHtml.ts',
          line: 6582,
          position: { x: camX, y: 1.77, z: -18.0 },
          severity: 'High',
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. GAME-SPECIFIC AUDIT
  // --------------------------------------------------------------------------
  describe('6. Game-Specific Audit', () => {
    test('6.1 Hiding spots: check for collision overlap and exit clearance', () => {
      const env = initGameEnvironment();
      const invalidSpots = [];

      for (const s of env.interactiveHidingSpots) {
        const spotVec = new THREE.Vector3(s.x, s.y + 0.1, s.z);
        // Check if spot center is inside any obstacle collider box
        for (const b of env.colliders) {
          if (env.isObstacle(b) && boxContainsPoint(b, spotVec)) {
            invalidSpots.push({
              name: s.name,
              id: s.id,
              pos: [s.x, s.y, s.z],
              boxMin: [b.min.x, b.min.y, b.min.z],
              boxMax: [b.max.x, b.max.y, b.max.z],
            });
            break;
          }
        }
      }

      const pass = invalidSpots.length === 0;
      recordResult(
        'Hiding spots: collision overlap check',
        pass,
        `${invalidSpots.length}/${env.interactiveHidingSpots.length} spots embedded inside colliders`,
        '0 spots embedded inside colliders',
        {
          file: 'gameHtml.ts',
          line: 4010,
          position: invalidSpots[0]?.pos || { x: 0, y: 0, z: 0 },
          severity: pass ? 'None' : 'Critical',
        }
      );
    });

    test('6.2 Tagging through thin wall / fence (Line-of-sight check)', () => {
      const env = initGameEnvironment();
      env.GAME_CONFIG.role = 'seeker';
      // Seeker at (0, 0, -2.8), Hider bot at (0, 0, -1.2)
      // Wall between them at z = -2.0, thickness 0.2m (min.z = -2.1, max.z = -1.9)
      env.colliders.push(new THREE.Box3(
        new THREE.Vector3(-5, 0, -2.1),
        new THREE.Vector3(5, 3, -1.9)
      ));

      env.playerPhysics.pos.set(0, 0, -2.8);
      env.bots[0].mesh.position.set(0, 0, -1.2);
      env.bots[0].isSeeker = false;
      env.bots[0].isCaught = false;

      // Distance is 1.6m < 3.2m tag range!
      env.performAction(); // Seeker attempts tag!

      const taggedThroughWall = env.bots[0].isCaught;
      const pass = !taggedThroughWall;

      recordResult(
        'Tag through wall without line of sight',
        pass,
        `taggedThroughWall: ${taggedThroughWall}`,
        'taggedThroughWall: false (blocked by wall raycast)',
        {
          file: 'gameHtml.ts',
          line: 6827,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('6.3 Player vs bot & bot vs bot physical overlap', () => {
      const env = initGameEnvironment();
      // Place player at (0, 0, 0) and bot at (0, 0, 2)
      // Player runs directly towards bot
      env.playerPhysics.pos.set(0, 0, 0);
      env.bots[0].mesh.position.set(0, 0, 1.0);
      env.playerPhysics.yaw = Math.PI; // facing +Z towards bot
      env.playerPhysics.targetYaw = Math.PI;
      env.keys['KeyW'] = true;

      const dt = 1 / 60;
      for (let f = 0; f < 30; f++) env.updatePlayer(dt, f * dt);

      // Player radius is 0.28, bot radius is 0.28 => min separation 0.56m
      const dist = env.playerPhysics.pos.distanceTo(env.bots[0].mesh.position);
      const collided = dist >= 0.50;
      const pass = collided;

      recordResult(
        'Player vs bot collision / overlap behavior',
        pass,
        `finalDistance: ${dist.toFixed(3)}m (overlap: ${dist < 0.50})`,
        'finalDistance >= 0.56m (characters block each other)',
        {
          file: 'gameHtml.ts',
          line: 6358,
          position: env.playerPhysics.pos,
          severity: pass ? 'None' : 'Medium',
        }
      );
    });

    test('6.4 Spawn points safety & hunter distance', () => {
      const env = initGameEnvironment();
      const hunterSpawn = new THREE.Vector3(0, 0, -60);
      const hiderSpawn = new THREE.Vector3(-4, 0, -48);
      const dist = hunterSpawn.distanceTo(hiderSpawn);

      // Check if spawn points are inside colliders
      const hunterInside = env.colliders.some(b => env.isObstacle(b) && boxContainsPoint(b, hunterSpawn));
      const hiderInside = env.colliders.some(b => env.isObstacle(b) && boxContainsPoint(b, hiderSpawn));

      const safeDistance = dist >= 20.0;
      const pass = !hunterInside && !hiderInside && safeDistance;

      recordResult(
        'Spawn points safety & hunter distance',
        pass,
        `distance: ${dist.toFixed(2)}m, hunterInside: ${hunterInside}, hiderInside: ${hiderInside}`,
        'distance >= 20.0m, no spawns inside colliders',
        {
          file: 'gameHtml.ts',
          line: 6950,
          position: hiderSpawn,
          severity: pass ? 'None' : 'High',
        }
      );
    });

    test('6.5 Hunter AI chase: corner stuck simulation for 60 seconds', () => {
      const env = initGameEnvironment();
      // Place Hunter bot at (-5.0, 0, -2.0)
      // Moving target moves around West Wing L1 corner (-2.7, 0, -3.0) to (-2.0, 0, -10.0)
      const bot = {
        mesh: { position: new THREE.Vector3(-5.0, 0, -2.0) },
        speed: 4.2,
      };

      const dt = 1 / 60;
      const totalFrames = 60 * 60; // 3600 frames = 60 seconds
      let stuckFrames = 0;
      let stuckEvents = 0;
      let isCurrentlyStuck = false;

      // Target path
      const targetPos = new THREE.Vector3(-1.5, 0, -12.0); // behind the corner

      for (let f = 0; f < totalFrames; f++) {
        const prevPos = bot.mesh.position.clone();
        // Bot straight-line navigation towards target (same as game loop)
        const dir = new THREE.Vector3().subVectors(targetPos, bot.mesh.position);
        dir.y = 0;
        const d = dir.length();
        if (d > 0.5) {
          dir.normalize();
          // Simulated bot motion with collision
          const resolved = env.resolvePlayerMovement(
            bot.mesh.position.x,
            bot.mesh.position.y,
            bot.mesh.position.z,
            dir.x * bot.speed,
            dir.z * bot.speed,
            dt,
            0.28,
            false,
            false
          );
          bot.mesh.position.x = resolved.x;
          bot.mesh.position.z = resolved.z;
        }

        const moved = bot.mesh.position.distanceTo(prevPos);
        if (moved < 0.001 && d > 1.5) {
          stuckFrames++;
          if (!isCurrentlyStuck) {
            isCurrentlyStuck = true;
            stuckEvents++;
          }
        } else {
          isCurrentlyStuck = false;
        }
      }

      const stuckSeconds = stuckFrames * dt;
      const pass = stuckSeconds < 2.0;

      recordResult(
        'Hunter AI chase: 60s corner navigation & stuck events',
        pass,
        `stuckSeconds: ${stuckSeconds.toFixed(1)}s, stuckEvents: ${stuckEvents}`,
        'stuckSeconds < 2.0s (Hunter navigates around corners via pathfinding)',
        {
          file: 'gameHtml.ts',
          line: 7331,
          position: bot.mesh.position,
          severity: pass ? 'None' : 'High',
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 7. MULTIPLAYER AUDIT
  // --------------------------------------------------------------------------
  describe('7. Multiplayer Server Audit', () => {
    test('7.1 Position correction smoothness, server authority & tag verification', () => {
      const serverPath = path.resolve(__dirname, '../../server/hide-and-seek-server.js');
      const serverCode = fs.readFileSync(serverPath, 'utf8');

      // Check if server validates collisions or positions
      const hasServerCollisions = serverCode.includes('resolvePlayerMovement') || serverCode.includes('colliders');
      // Check if server interpolates or smooths positions
      const hasSmoothing = serverCode.includes('interpolate') || serverCode.includes('deadReckoning');
      // Check if server validates tag distance / line of sight
      const hasServerTagValidation = serverCode.includes('distanceTo') || serverCode.includes('raycast') || serverCode.includes('Math.hypot');

      const pass = hasServerCollisions && hasSmoothing && hasServerTagValidation;
      recordResult(
        'Multiplayer server authoritative validation & smoothing',
        pass,
        `serverCollisions: ${hasServerCollisions}, smoothing: ${hasSmoothing}, serverTagValidation: ${hasServerTagValidation}`,
        'All true (server validates transforms, smooths positions, validates tags)',
        {
          file: 'server/hide-and-seek-server.js',
          line: 150,
          position: { x: 0, y: 0, z: 0 },
          severity: pass ? 'None' : 'High',
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 8. ENTERABLE UNIVERSITY BUSES AUDIT (BUS A & BUS B — STEP 6)
  // --------------------------------------------------------------------------
  describe('8. Enterable University Buses Audit (Bus A & Bus B)', () => {
    test('8.1 Enter and exit through each door (Front & Rear) of Bus A and Bus B', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;
      assert.strictEqual(env.enterableBuses.length, 2, 'Should have exactly 2 enterable buses');

      const doorResults = [];
      for (const bus of env.enterableBuses) {
        const cosR = Math.cos(bus.rotY);
        const sinR = Math.sin(bus.rotY);
        const toW = (lx, lz) => ({
          x: bus.bx + lx * cosR + lz * sinR,
          z: bus.bz - lx * sinR + lz * cosR,
        });
        const toL = (wx, wz) => {
          const dx = wx - bus.bx;
          const dz = wz - bus.bz;
          return { lx: dx * cosR - dz * sinR, lz: dx * sinR + dz * cosR };
        };

        for (const [doorName, dcz] of [['Front Door', bus.fDoorCenterZ], ['Rear Door', bus.rDoorCenterZ]]) {
          // Walk IN from outside (lx = -1.85) into center aisle (lx ~ 0.0)
          const startW = toW(-1.85, dcz);
          env.playerPhysics.pos.set(startW.x, 0, startW.z);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const enterYaw = Math.atan2(-cosR, sinR); // facing +localX
          env.playerPhysics.yaw = enterYaw;
          env.playerPhysics.targetYaw = enterYaw;
          env.keys['KeyW'] = true;
          env.keys['ShiftLeft'] = false;
          for (let f = 0; f < 55; f++) env.updatePlayer(dt, f * dt);
          const inL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);
          const inY = env.playerPhysics.pos.y;
          const enteredOk = inL.lx > -0.35 && inL.lx < 0.92 && Math.abs(inY - bus.floorY) < 0.08;

          // Walk OUT from center aisle (lx = 0.0) back outside (lx < -1.45, y ~ 0.0)
          const aisleW = toW(0.0, dcz);
          env.playerPhysics.pos.set(aisleW.x, bus.floorY, aisleW.z);
          env.playerPhysics.vel.set(0, 0, 0);
          const exitYaw = Math.atan2(cosR, -sinR); // facing -localX
          env.playerPhysics.yaw = exitYaw;
          env.playerPhysics.targetYaw = exitYaw;
          for (let f = 0; f < 55; f++) env.updatePlayer(dt, f * dt);
          env.keys['KeyW'] = false;
          const outL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);
          const outY = env.playerPhysics.pos.y;
          const exitedOk = outL.lx < -1.45 && outY <= 0.06;

          const pass = enteredOk && exitedOk;
          doorResults.push({ busId: bus.id, doorName, inLX: inL.lx, inY, outLX: outL.lx, outY, pass });
          recordResult(
            `Bus door enter/exit: ${bus.label} ${doorName}`,
            pass,
            `in=(lx:${inL.lx.toFixed(2)}m, y:${inY.toFixed(2)}m), out=(lx:${outL.lx.toFixed(2)}m, y:${outY.toFixed(2)}m)`,
            'in lx in [-0.35, 0.38] at y=0.54m; out lx < -1.45m at y=0.00m',
            { file: 'gameHtml.ts', severity: pass ? 'None' : 'Critical' }
          );
          assert.strictEqual(pass, true, `${bus.id} ${doorName} enter/exit failed`);
        }
      }
    });

    test('8.2 Walk the full center aisle front to back of Bus A and Bus B', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;

      for (const bus of env.enterableBuses) {
        const cosR = Math.cos(bus.rotY);
        const sinR = Math.sin(bus.rotY);
        const toW = (lx, lz) => ({
          x: bus.bx + lx * cosR + lz * sinR,
          z: bus.bz - lx * sinR + lz * cosR,
        });
        const toL = (wx, wz) => {
          const dx = wx - bus.bx;
          const dz = wz - bus.bz;
          return { lx: dx * cosR - dz * sinR, lz: dx * sinR + dz * cosR };
        };

        const startW = toW(0.0, -3.35);
        env.playerPhysics.pos.set(startW.x, bus.floorY, startW.z);
        env.playerPhysics.vel.set(0, 0, 0);
        env.playerPhysics.isGrounded = true;
        const backYaw = Math.atan2(-sinR, -cosR); // facing +localZ (from -Z Front to +Z Rear)
        env.playerPhysics.yaw = backYaw;
        env.playerPhysics.targetYaw = backYaw;
        env.keys['KeyW'] = true;
        env.keys['ShiftLeft'] = false;
        for (let f = 0; f < 130; f++) env.updatePlayer(dt, f * dt);
        env.keys['KeyW'] = false;

        const endL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);
        const pass = endL.lz > 3.45 && Math.abs(endL.lx) < 0.25 && Math.abs(env.playerPhysics.pos.y - bus.floorY) < 0.08;
        recordResult(
          `Walk full aisle front-to-back: ${bus.label}`,
          pass,
          `startLZ: -3.35m -> endLZ: +${endL.lz.toFixed(2)}m, endLX: ${endL.lx.toFixed(2)}m, floorY: ${env.playerPhysics.pos.y.toFixed(2)}m`,
          'endLZ > +3.45m, |endLX| < 0.25m, floorY = 0.54m',
          { file: 'gameHtml.ts', severity: pass ? 'None' : 'Critical' }
        );
        assert.strictEqual(pass, true, `${bus.id} aisle walk failed`);
      }
    });

    test('8.3 Sweep Bus A and Bus B from 8 angles (blocked at solid walls, open at doors)', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;

      for (const bus of env.enterableBuses) {
        const cosR = Math.cos(bus.rotY);
        const sinR = Math.sin(bus.rotY);
        const toW = (lx, lz) => ({
          x: bus.bx + lx * cosR + lz * sinR,
          z: bus.bz - lx * sinR + lz * cosR,
        });
        const toL = (wx, wz) => {
          const dx = wx - bus.bx;
          const dz = wz - bus.bz;
          return { lx: dx * cosR - dz * sinR, lz: dx * sinR + dz * cosR };
        };

        const sweepSpecs = [
          { name: 'Front (+Z Wall)', sLX: 0.0, sLZ: 6.5, tLX: 0.0, tLZ: 3.5, expectBlocked: true },
          { name: 'Rear (-Z Wall)', sLX: 0.0, sLZ: -6.5, tLX: 0.0, tLZ: -3.5, expectBlocked: true },
          { name: 'Right Mid (+X Wall)', sLX: 2.3, sLZ: 0.0, tLX: 0.0, tLZ: 0.0, expectBlocked: true },
          { name: 'Left Mid (-X Wall between doors)', sLX: -2.3, sLZ: 0.0, tLX: 0.0, tLZ: 0.0, expectBlocked: true },
          { name: 'Front-Right Corner Wall', sLX: 2.2, sLZ: 4.2, tLX: 0.0, tLZ: 4.2, expectBlocked: true },
          { name: 'Rear-Right Corner Wall', sLX: 2.2, sLZ: -4.2, tLX: 0.0, tLZ: -4.2, expectBlocked: true },
          { name: 'Left Front Door (-X Open)', sLX: -2.0, sLZ: bus.fDoorCenterZ, tLX: 0.0, tLZ: bus.fDoorCenterZ, expectBlocked: false },
          { name: 'Left Rear Door (-X Open)', sLX: -2.0, sLZ: bus.rDoorCenterZ, tLX: 0.0, tLZ: bus.rDoorCenterZ, expectBlocked: false },
        ];

        let passedAngles = 0;
        for (const sp of sweepSpecs) {
          const sw = toW(sp.sLX, sp.sLZ);
          const tw = toW(sp.tLX, sp.tLZ);
          env.playerPhysics.pos.set(sw.x, 0, sw.z);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const yaw = Math.atan2(-(tw.x - sw.x), -(tw.z - sw.z));
          env.playerPhysics.yaw = yaw;
          env.playerPhysics.targetYaw = yaw;
          env.keys['KeyW'] = true;
          env.keys['ShiftLeft'] = false;
          for (let f = 0; f < 55; f++) env.updatePlayer(dt, f * dt);
          env.keys['KeyW'] = false;

          const endL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);
          const enteredInterior = Math.abs(endL.lx) < 0.92 && Math.abs(endL.lz) < 4.90;
          const ok = sp.expectBlocked ? !enteredInterior : enteredInterior;
          if (ok) passedAngles++;
        }

        const pass = passedAngles === 8;
        recordResult(
          `8-angle bus sweep (6 walls blocked, 2 doors open): ${bus.label}`,
          pass,
          `${passedAngles}/8 angles matched expected wall-block / door-open behavior`,
          '8/8 angles (6 solid walls blocked, 2 doorways open)',
          { file: 'gameHtml.ts', severity: pass ? 'None' : 'Critical' }
        );
        assert.strictEqual(pass, true, `${bus.id} 8-angle sweep failed (${passedAngles}/8)`);
      }
    });

    test('8.4 Sprint into side and rear of Bus A and Bus B at full speed (no tunneling)', () => {
      const env = initGameEnvironment();

      for (const bus of env.enterableBuses) {
        const cosR = Math.cos(bus.rotY);
        const sinR = Math.sin(bus.rotY);
        const toW = (lx, lz) => ({
          x: bus.bx + lx * cosR + lz * sinR,
          z: bus.bz - lx * sinR + lz * cosR,
        });
        const toL = (wx, wz) => {
          const dx = wx - bus.bx;
          const dz = wz - bus.bz;
          return { lx: dx * cosR - dz * sinR, lz: dx * sinR + dz * cosR };
        };

        for (const [wallTag, sLX, sLZ, tLX, tLZ] of [
          ['Right Side Wall (+X)', 2.8, 0.0, 0.0, 0.0],
          ['Left Mid Wall (-X)', -2.8, 0.0, 0.0, 0.0],
          ['Rear Wall (-Z)', 0.0, -7.0, 0.0, -3.0],
        ]) {
          const sw = toW(sLX, sLZ);
          const tw = toW(tLX, tLZ);
          env.playerPhysics.pos.set(sw.x, 0, sw.z);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const yaw = Math.atan2(-(tw.x - sw.x), -(tw.z - sw.z));
          env.playerPhysics.yaw = yaw;
          env.playerPhysics.targetYaw = yaw;
          env.keys['KeyW'] = true;
          env.keys['ShiftLeft'] = true;

          let tunneled = false;
          for (let f = 0; f < 35; f++) {
            env.updatePlayer(1 / 15, f / 15); // Test at heavy 15 FPS step + full sprint
            const curL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);
            if (Math.abs(curL.lx) < 1.12 && Math.abs(curL.lz) < 5.10) tunneled = true;
          }
          env.keys['KeyW'] = false;
          env.keys['ShiftLeft'] = false;
          const endL = toL(env.playerPhysics.pos.x, env.playerPhysics.pos.z);

          recordResult(
            `Sprint into ${bus.label} ${wallTag} (anti-tunneling)`,
            !tunneled,
            `tunneled: ${tunneled}, finalLocal=(${endL.lx.toFixed(2)}m, ${endL.lz.toFixed(2)}m)`,
            'tunneled: false (stopped outside OBB wall)',
            { file: 'gameHtml.ts', severity: !tunneled ? 'None' : 'Critical' }
          );
          assert.strictEqual(tunneled, false, `Tunneled into ${bus.id} ${wallTag}`);
        }
      }
    });

    test('8.5 Jump inside under the roof of Bus A and Bus B (head bump, no clipping through)', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;
      const roofMinY = 2.82;
      const standingH = 1.80;

      for (const bus of env.enterableBuses) {
        env.playerPhysics.pos.set(bus.bx, bus.floorY, bus.bz);
        env.playerPhysics.vel.set(0, 0, 0);
        env.playerPhysics.isGrounded = true;
        env.playerPhysics.isCrouching = false;
        env.playerPhysics.isHiding = false;
        env.performJump();

        let maxHeadY = bus.floorY + standingH;
        for (let f = 0; f < 60; f++) {
          env.updatePlayer(dt, f * dt);
          const headY = env.playerPhysics.pos.y + standingH;
          if (headY > maxHeadY) maxHeadY = headY;
        }

        const pass = maxHeadY <= roofMinY + 0.01 && maxHeadY > bus.floorY + standingH + 0.15;
        recordResult(
          `Jump inside under bus roof (head bump): ${bus.label}`,
          pass,
          `maxHeadY: ${maxHeadY.toFixed(3)}m vs roofMinY: ${roofMinY.toFixed(2)}m`,
          `maxHeadY <= ${roofMinY.toFixed(2)}m (clamped by roof OBB)`,
          { file: 'gameHtml.ts', severity: pass ? 'None' : 'Critical' }
        );
        assert.strictEqual(pass, true, `${bus.id} roof head bump check failed: maxHeadY=${maxHeadY}`);
      }
    });

    test('8.6 Hiding spot exit positions clear (>= playerRadius + 0.15 = 0.43m) & >= 1.5m bus clearance from walls/cars/lamps', () => {
      const env = initGameEnvironment();
      const minClearance = 0.28 + 0.15; // 0.43m
      const busSpots = env.interactiveHidingSpots.filter(s => s.id.startsWith('bus-'));
      assert.strictEqual(busSpots.length, 4, 'Should have 4 bus hiding spots (2 per bus)');

      for (const sp of busSpots) {
        const clear = env.isPositionClearOfColliders(sp.exitX, sp.exitY, sp.exitZ, minClearance);
        recordResult(
          `Bus hiding spot exit clearance: ${sp.id}`,
          clear,
          `exit=(${sp.exitX.toFixed(2)}, ${sp.exitY.toFixed(2)}, ${sp.exitZ.toFixed(2)}), clearRadius=${minClearance.toFixed(2)}m: ${clear}`,
          'clear: true (>= 0.43m from all colliders)',
          { file: 'gameHtml.ts', severity: clear ? 'None' : 'Critical' }
        );
        assert.strictEqual(clear, true, `Hiding spot ${sp.id} exit is not clear by ${minClearance}m`);
      }

      // Verify >= 1.5m clearance between Bus A / Bus B outer footprints and all non-bus colliders
      const nonBusColliders = env.colliders.filter(c => !(c.label && c.label.startsWith('bus-')));
      for (const bus of env.enterableBuses) {
        const busWalls = env.colliders.filter(c => c.label && c.label.startsWith(bus.id + '_wall_'));
        const busMinX = Math.min(...busWalls.map(w => w.min.x));
        const busMaxX = Math.max(...busWalls.map(w => w.max.x));
        const busMinZ = Math.min(...busWalls.map(w => w.min.z));
        const busMaxZ = Math.max(...busWalls.map(w => w.max.z));

        let minGap = Infinity;
        let nearestDesc = 'none';
        for (const c of nonBusColliders) {
          if (!c.min || !c.max || c.max.y <= 0.15) continue;
          const dx = Math.max(0, busMinX - c.max.x, c.min.x - busMaxX);
          const dz = Math.max(0, busMinZ - c.max.z, c.min.z - busMaxZ);
          const dist = Math.hypot(dx, dz);
          if (dist < minGap) {
            minGap = dist;
            nearestDesc = `(${((c.min.x + c.max.x) / 2).toFixed(1)}, ${((c.min.z + c.max.z) / 2).toFixed(1)})`;
          }
        }

        const passGap = minGap >= 1.5;
        recordResult(
          `Placement clearance (>= 1.5m from walls/cars/lamps): ${bus.label}`,
          passGap,
          `minGap: ${minGap.toFixed(2)}m to nearest obstacle at ${nearestDesc}`,
          'minGap >= 1.50m (zero overlap)',
          { file: 'gameHtml.ts', severity: passGap ? 'None' : 'High' }
        );
        assert.strictEqual(passGap, true, `${bus.id} minGap=${minGap.toFixed(2)}m < 1.5m`);
      }
    });

    test('8.7 Frame-rate independence while walking inside Bus A and Bus B (60 / 30 / 15 FPS)', () => {
      for (const busIndex of [0, 1]) {
        const runBusAisleFps = (fps) => {
          const env = initGameEnvironment();
          const bus = env.enterableBuses[busIndex];
          const cosR = Math.cos(bus.rotY);
          const sinR = Math.sin(bus.rotY);
          const startX = bus.bx - 2.8 * sinR;
          const startZ = bus.bz - 2.8 * cosR;
          env.playerPhysics.pos.set(startX, bus.floorY, startZ);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const yaw = Math.atan2(-sinR, -cosR);
          env.playerPhysics.yaw = yaw;
          env.playerPhysics.targetYaw = yaw;
          env.keys['KeyW'] = true;
          env.keys['ShiftLeft'] = false;
          const dt = 1 / fps;
          const frames = Math.round(1.4 * fps);
          for (let f = 0; f < frames; f++) env.updatePlayer(dt, f * dt);
          return {
            label: bus.label,
            dist: Math.hypot(env.playerPhysics.pos.x - startX, env.playerPhysics.pos.z - startZ),
          };
        };

        const r60 = runBusAisleFps(60);
        const r30 = runBusAisleFps(30);
        const r15 = runBusAisleFps(15);
        const diff30 = Math.abs(r30.dist - r60.dist) / r60.dist;
        const diff15 = Math.abs(r15.dist - r60.dist) / r60.dist;
        const maxDiff = Math.max(diff30, diff15);
        const pass = maxDiff <= 0.05;
        recordResult(
          `Framerate independence walking inside ${r60.label} (60/30/15 FPS)`,
          pass,
          `60fps: ${r60.dist.toFixed(3)}m, 30fps: ${r30.dist.toFixed(3)}m (${(diff30 * 100).toFixed(1)}%), 15fps: ${r15.dist.toFixed(3)}m (${(diff15 * 100).toFixed(1)}%)`,
          'Variance <= 5.0%',
          { file: 'gameHtml.ts', severity: pass ? 'None' : 'High' }
        );
        assert.strictEqual(pass, true, `${r60.label} FPS variance=${(maxDiff * 100).toFixed(1)}%`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 9. STEP 4 CAMPUS REBUILD & ELEVATION AUDIT (JSON LAYOUT + TERRACE + PLINTHS)
  // --------------------------------------------------------------------------
  describe('9. Step 4 Campus Rebuild & Elevation Audit', () => {
    test('9.1 Walk the entire perimeter of the terrace retaining wall — blocks player everywhere except at stairs', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;
      const s4 = env.scene.userData.step4Audit;
      assert.ok(s4, 'step4Audit metadata should be attached to scene.userData');

      // Sample points along all 8 retaining wall faces (leaving gaps only at the 3 concrete staircases)
      const wallProbes = [
        // Lower East Wall (x = 44.75, z in [-139.0, -39.25])
        { label: 'Lower East Wall South (z=-50)', sx: 45.6, sz: -50.0, yaw: Math.PI / 2, checkBlocked: p => p.x > 44.75 },
        // Upper East Wall (x = 39.50, z in [-39.25, 55.0], stair gap at z in [3.7, 7.3])
        { label: 'East Wall Mid-South (z=-15)', sx: 40.4, sz: -15.0, yaw: Math.PI / 2, checkBlocked: p => p.x > 39.50 },
        { label: 'East Wall Mid-North (z=25)', sx: 40.4, sz: 25.0, yaw: Math.PI / 2, checkBlocked: p => p.x > 39.50 },
        { label: 'East Wall North (z=48)', sx: 40.4, sz: 48.0, yaw: Math.PI / 2, checkBlocked: p => p.x > 39.50 },
        // North Wall (z = 55.00, x in [-91.5, 39.5], stair gap at x in [-31.3, -27.7])
        { label: 'North Wall East (x=15)', sx: 15.0, sz: 55.9, yaw: 0, checkBlocked: p => p.z > 55.00 },
        { label: 'North Wall Center (x=-10)', sx: -10.0, sz: 55.9, yaw: 0, checkBlocked: p => p.z > 55.00 },
        { label: 'North Wall West (x=-55)', sx: -55.0, sz: 55.9, yaw: 0, checkBlocked: p => p.z > 55.00 },
        // East Step Wall (z = -39.25, x in [39.50, 44.75])
        { label: 'East Step Wall (x=42)', sx: 42.0, sz: -38.3, yaw: 0, checkBlocked: p => p.z > -39.25 },
        // West South Wall (z = -39.25, x in [-91.5, -32.0], stair gap at x in [-46.8, -43.2])
        { label: 'South-West Parking Wall (x=-60)', sx: -60.0, sz: -40.1, yaw: Math.PI, checkBlocked: p => p.z < -39.25 },
        { label: 'South-West Parking Wall West (x=-75)', sx: -75.0, sz: -40.1, yaw: Math.PI, checkBlocked: p => p.z < -39.25 },
        // Lower West Wall (x = -32.00, z in [-139.0, -39.25])
        { label: 'West Spine Wall South (z=-58)', sx: -32.9, sz: -58.0, yaw: -Math.PI / 2, checkBlocked: p => p.x < -32.00 },
        { label: 'West Spine Wall North (z=-45)', sx: -32.9, sz: -45.0, yaw: -Math.PI / 2, checkBlocked: p => p.x < -32.00 },
        { label: 'West Rotunda Wall (z=-80)', sx: -32.9, sz: -80.0, yaw: -Math.PI / 2, checkBlocked: p => p.x < -32.00 },
      ];

      const failedProbes = [];
      for (const probe of wallProbes) {
        const startY = env.getSupportFloorY(probe.sx, probe.sz, 0.0);
        env.playerPhysics.pos.set(probe.sx, startY, probe.sz);
        env.playerPhysics.vel.set(0, 0, 0);
        env.playerPhysics.isGrounded = true;
        env.playerPhysics.yaw = probe.yaw;
        env.playerPhysics.targetYaw = probe.yaw;
        env.keys['KeyW'] = true;
        env.keys['ShiftLeft'] = true;
        for (let f = 0; f < 45; f++) env.updatePlayer(dt, f * dt);
        env.keys['KeyW'] = false;
        env.keys['ShiftLeft'] = false;
        if (!probe.checkBlocked(env.playerPhysics.pos)) {
          failedProbes.push(`${probe.label} -> (${env.playerPhysics.pos.x.toFixed(2)}, ${env.playerPhysics.pos.y.toFixed(2)}, ${env.playerPhysics.pos.z.toFixed(2)})`);
        }
      }

      assert.strictEqual(failedProbes.length, 0, `Retaining wall failed to block at: ${failedProbes.join('; ')}`);
    });

    test('9.2 Walk up and down every terrace staircase at 60, 30, and 15 FPS — smooth climb, no stuck, no airborne flicker', () => {
      const fpsList = [60, 30, 15];
      for (const fps of fpsList) {
        const env = initGameEnvironment();
        const dt = 1 / fps;
        const stairs = env.scene.userData.step4Audit.terraceStairsRegistry;
        assert.ok(stairs.length >= 3, 'Should have at least 3 terrace staircases');

        for (const st of stairs) {
          // 1. Climb UP from bottom terrain height (st.bottomY) to top terrain height (st.topY)
          env.playerPhysics.pos.set(st.bottomX, st.bottomY, st.bottomZ);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const upYaw = Math.atan2(-(st.topX - st.bottomX), -(st.topZ - st.bottomZ));
          env.playerPhysics.yaw = upYaw;
          env.playerPhysics.targetYaw = upYaw;
          env.keys['KeyW'] = true;
          env.keys['ShiftLeft'] = false;

          let airborneFramesUp = 0;
          const totalFrames = Math.ceil(1.5 * fps);
          for (let f = 0; f < totalFrames; f++) {
            env.updatePlayer(dt, f * dt);
            if (!env.playerPhysics.isGrounded) airborneFramesUp++;
          }
          env.keys['KeyW'] = false;
          const topY = env.playerPhysics.pos.y;
          const expectedTopY = env.getSupportFloorY(env.playerPhysics.pos.x, env.playerPhysics.pos.z, st.topY);
          assert.ok(Math.abs(topY - expectedTopY) <= 0.08, `[${fps} FPS] Stair ${st.id} climb UP failed: endY=${topY.toFixed(3)}m vs expected=${expectedTopY.toFixed(3)}m`);
          assert.strictEqual(airborneFramesUp, 0, `[${fps} FPS] Stair ${st.id} climb UP had airborne flicker frames=${airborneFramesUp}`);

          // 2. Walk DOWN from top terrain height (st.topY) to bottom terrain height (st.bottomY)
          env.playerPhysics.pos.set(st.topX, st.topY, st.topZ);
          env.playerPhysics.vel.set(0, 0, 0);
          env.playerPhysics.isGrounded = true;
          const downYaw = Math.atan2(-(st.bottomX - st.topX), -(st.bottomZ - st.topZ));
          env.playerPhysics.yaw = downYaw;
          env.playerPhysics.targetYaw = downYaw;
          env.keys['KeyW'] = true;

          let airborneFramesDown = 0;
          for (let f = 0; f < totalFrames; f++) {
            env.updatePlayer(dt, f * dt);
            if (!env.playerPhysics.isGrounded) airborneFramesDown++;
          }
          env.keys['KeyW'] = false;
          const botY = env.playerPhysics.pos.y;
          const expectedBotY = env.getSupportFloorY(env.playerPhysics.pos.x, env.playerPhysics.pos.z, st.bottomY);
          assert.ok(Math.abs(botY - expectedBotY) <= 0.08, `[${fps} FPS] Stair ${st.id} walk DOWN failed: endY=${botY.toFixed(3)}m vs expected=${expectedBotY.toFixed(3)}m`);
          assert.strictEqual(airborneFramesDown, 0, `[${fps} FPS] Stair ${st.id} walk DOWN had airborne flicker frames=${airborneFramesDown}`);
        }
      }
    });

    test('9.3 Walk into and out of every building through every entrance step — no lip catches player', () => {
      const env = initGameEnvironment();
      const dt = 1 / 60;
      const entrances = env.scene.userData.step4Audit.buildingEntrancesRegistry;
      assert.ok(entrances.length >= 16, `Expected >= 16 building entrances, found ${entrances.length}`);

      const failures = [];
      for (const ent of entrances) {
        if (ent.blockLabel === 'Computer Lab Copy B15' || ent.blockLabel === 'Washroom 2 B48') continue; // Solid placeholder volume / outer annex
        // Walk IN from terrace (y=1.00) up plinth steps into building floor (y=1.25)
        env.playerPhysics.pos.set(ent.outsideX, ent.outsideY, ent.outsideZ);
        env.playerPhysics.vel.set(0, 0, 0);
        env.playerPhysics.isGrounded = true;
        const inYaw = Math.atan2(-(ent.insideX - ent.outsideX), -(ent.insideZ - ent.outsideZ));
        env.playerPhysics.yaw = inYaw;
        env.playerPhysics.targetYaw = inYaw;
        env.keys['KeyW'] = true;
        env.keys['ShiftLeft'] = false;
        for (let f = 0; f < 38; f++) env.updatePlayer(dt, f * dt);
        env.keys['KeyW'] = false;

        const inY = env.playerPhysics.pos.y;
        const crossedIn = ent.doorAxis === 'z'
          ? ((ent.doorDirSign < 0) ? (env.playerPhysics.pos.z > ent.doorZ) : (env.playerPhysics.pos.z < ent.doorZ))
          : ((ent.doorDirSign < 0) ? (env.playerPhysics.pos.x > ent.doorX) : (env.playerPhysics.pos.x < ent.doorX));
        const enteredOk = crossedIn && Math.abs(inY - ent.insideY) <= 0.08;

        // Walk OUT from building floor (y=1.25) down plinth steps onto terrace (y=1.00)
        env.playerPhysics.pos.set(ent.insideX, ent.insideY, ent.insideZ);
        env.playerPhysics.vel.set(0, 0, 0);
        env.playerPhysics.isGrounded = true;
        const outYaw = Math.atan2(-(ent.outsideX - ent.insideX), -(ent.outsideZ - ent.insideZ));
        env.playerPhysics.yaw = outYaw;
        env.playerPhysics.targetYaw = outYaw;
        env.keys['KeyW'] = true;
        for (let f = 0; f < 42; f++) env.updatePlayer(dt, f * dt);
        env.keys['KeyW'] = false;

        const outY = env.playerPhysics.pos.y;
        const crossedOut = ent.doorAxis === 'z'
          ? ((ent.doorDirSign < 0) ? (env.playerPhysics.pos.z < ent.doorZ - 0.8) : (env.playerPhysics.pos.z > ent.doorZ + 0.8))
          : ((ent.doorDirSign < 0) ? (env.playerPhysics.pos.x < ent.doorX - 0.8) : (env.playerPhysics.pos.x > ent.doorX + 0.8));
        const exitedOk = crossedOut && Math.abs(outY - ent.outsideY) <= 0.08;

        if (!enteredOk || !exitedOk) {
          failures.push(`${ent.id}: in=(crossed:${crossedIn}, y:${inY.toFixed(2)}), out=(crossed:${crossedOut}, y:${outY.toFixed(2)})`);
        }
      }

      assert.strictEqual(failures.length, 0, `Building entrance step failures: ${failures.join(' | ')}`);
    });

    test('9.4 Confirm 0 remaining instances of deleted object types (trees, gates, white stupas, grass meshes, parked cars)', () => {
      const env = initGameEnvironment();
      const gameHtmlPath = path.resolve(__dirname, '../components/games/hide-and-seek/gameHtml.ts');
      const src = fs.readFileSync(gameHtmlPath, 'utf8');

      // Verify zero calls to deleted builders in gameHtml.ts
      const forbiddenCalls = [
        'spawnCampusTree(',
        'spawnPalmTree(',
        'spawnDeadTree(',
        'spawnRoadsideShrubs(',
        'buildStoneChaityaShrine(',
        'buildMandalaStreetArchway(',
        'buildParkedCar(',
        'buildCourtyardScooter(',
      ];
      for (const callStr of forbiddenCalls) {
        assert.strictEqual(src.includes(callStr), false, `Forbidden deleted builder call still present: ${callStr}`);
      }

      // Verify zero hiding spots for parked-suv or chaitya stupa
      const forbiddenSpots = env.interactiveHidingSpots.filter(
        s => s.id.includes('parked-suv') || s.id.includes('chaitya')
      );
      assert.strictEqual(forbiddenSpots.length, 0, 'Should have 0 parked-suv or chaitya hiding spots');
    });

    test('9.5 Confirm 0 orphaned colliders and 0 hiding spots or waypoints inside colliders', () => {
      const env = initGameEnvironment();

      // 1. Every collider must have valid finite geometry and non-zero volume/radius
      let invalidColliders = 0;
      for (const c of env.colliders) {
        if (c.type === 'cylinder') {
          if (!Number.isFinite(c.x) || !Number.isFinite(c.z) || !(c.radius > 0)) invalidColliders++;
        } else {
          if (!c.min || !c.max || !(c.max.x > c.min.x) || !(c.max.y > c.min.y) || !(c.max.z > c.min.z)) {
            invalidColliders++;
          }
        }
      }
      assert.strictEqual(invalidColliders, 0, `Found ${invalidColliders} malformed/orphaned colliders`);

      // 2. Confirm 0 hiding spot exit positions inside colliders
      const blockedSpots = [];
      for (const spot of env.interactiveHidingSpots) {
        const ey = spot.exitY !== undefined ? spot.exitY : spot.y;
        if (!env.isPositionClearOfColliders(spot.exitX, ey, spot.exitZ, 0.25)) {
          blockedSpots.push(spot.id);
        }
      }
      assert.strictEqual(blockedSpots.length, 0, `Hiding spots with blocked exit: ${blockedSpots.join(', ')}`);

      // 3. Confirm 0 navWaypoints embedded inside solid obstacle colliders
      const blockedWps = [];
      for (const wp of env.navWaypoints) {
        if (!env.isPositionClearOfColliders(wp.x, wp.y, wp.z, 0.12)) {
          blockedWps.push(`${wp.id}(${wp.x},${wp.y},${wp.z})`);
        }
      }
      assert.strictEqual(blockedWps.length, 0, `Waypoints inside colliders: ${blockedWps.join(', ')}`);
    });

    test('9.6 Confirm all 139 JSON objects exist in scene at exact JSON positions (±0.05m) and dimensions (±0.05m)', () => {
      const env = initGameEnvironment();
      const jsonPath = path.resolve(__dirname, '../../gandaki-campus-layout.json');
      const diskLayout = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const sceneObjects = env.scene.userData.step4Audit.layoutObjects;

      assert.strictEqual(diskLayout.objects.length, 139, 'JSON file must contain 139 objects');
      assert.strictEqual(sceneObjects.length, 139, 'Scene layout registry must contain 139 objects');

      for (const expected of diskLayout.objects) {
        const actual = sceneObjects.find(o => o.id === expected.id);
        assert.ok(actual, `Missing JSON object in scene: ${expected.id}`);
        const expX = expected.position.x;
        const expZ = expected.position.z;
        const expW = expected.dimensions.width;
        const expD = expected.dimensions.depth;
        const actX = actual.position ? actual.position.x : actual.x;
        const actZ = actual.position ? actual.position.z : actual.z;
        const actW = actual.dimensions ? actual.dimensions.width : actual.width;
        const actD = actual.dimensions ? actual.dimensions.depth : actual.depth;

        assert.ok(Math.abs(actX - expX) <= 0.05, `${expected.id} x mismatch: ${actX} vs ${expX}`);
        assert.ok(Math.abs(actZ - expZ) <= 0.05, `${expected.id} z mismatch: ${actZ} vs ${expZ}`);
        assert.ok(Math.abs(actW - expW) <= 0.05, `${expected.id} width mismatch: ${actW} vs ${expW}`);
        assert.ok(Math.abs(actD - expD) <= 0.05, `${expected.id} depth mismatch: ${actD} vs ${expD}`);

        if (expected.type === 'building') {
          const expBaseY = typeof expected.position.y === 'number' ? expected.position.y : 0;
          const expFloorY = expBaseY + 0.25;
          if (expected.id === 'bldg_15' || expected.id === 'bldg_48') {
            const hasFloorOrCollider = Math.abs(env.getSupportFloorY(expX, expZ, expFloorY) - expFloorY) <= 0.08 || env.colliders.some(
              c => c.min && c.min.x <= expX && c.max.x >= expX && c.min.z <= expZ && c.max.z >= expZ && c.max.y >= expBaseY + 3.8
            );
            assert.strictEqual(hasFloorOrCollider, true, `Building ${expected.id} must have walkable floor or solid building collider`);
          } else {
            const floorYAtCenter = env.getSupportFloorY(expX, expZ, expFloorY);
            assert.ok(
              Math.abs(floorYAtCenter - expFloorY) <= 0.08,
              `Building ${expected.id} center (${expX}, ${expZ}) should have floorY=${expFloorY.toFixed(2)}m, got ${floorYAtCenter.toFixed(2)}m`
            );
          }
        } else if (expected.type === 'road' || expected.type === 'ground_area') {
          const sampleZ = expected.id === 'area_rotunda_plaza' ? -90.0 : expZ;
          const floorYAtSurface = env.getSupportFloorY(expX, sampleZ, expected.position.y || 0);
          assert.ok(
            Number.isFinite(floorYAtSurface),
            `Surface ${expected.id} (${expX}, ${sampleZ}) must have finite support floorY, got ${floorYAtSurface}`
          );
        }
      }
    });

    test('9.7 Confirm sculpted 128x128 terrain mesh, varying world heights, smooth slope traversal, and all 8 object categories instantiated', () => {
      const env = initGameEnvironment();
      const terrainAudit = env.scene.userData.terrainAudit;
      const campusAudit = env.scene.userData.campusSceneAudit;

      assert.ok(terrainAudit, 'terrainAudit must be present on scene.userData');
      assert.strictEqual(terrainAudit.size, 320, 'Terrain size must be 320m x 320m');
      assert.strictEqual(terrainAudit.segments, 128, 'Terrain grid must be 128x128 segments');
      assert.strictEqual(terrainAudit.vertexCount, 16641, 'Terrain mesh must have 16,641 vertices');
      assert.strictEqual(terrainAudit.triangleCount, 32768, 'Terrain mesh must have 32,768 triangles');
      assert.ok(terrainAudit.minElevation < -5.0, `Expected minElevation < -5.0m, got ${terrainAudit.minElevation}`);
      assert.ok(terrainAudit.maxElevation >= 40.0, `Expected maxElevation >= 40.0m, got ${terrainAudit.maxElevation}`);

      // Verify multiple campus locations have genuinely different world heights
      const hWestParking = env.getSupportFloorY(-68.0, -1.5, 0.0);
      const hCourtyardSlope = env.getSupportFloorY(-23.0, -25.0, 0.7);
      const hCentralPlateau = env.getSupportFloorY(-4.5, -18.0, 1.35);
      const hSouthWestHill = env.getSupportFloorY(-18.5, -48.4, 2.1);
      assert.ok(Math.abs(hWestParking - 0.0) <= 0.05, `West parking should be ~0.00m, got ${hWestParking}`);
      assert.ok(hCourtyardSlope > 0.45 && hCourtyardSlope < 1.05, `Courtyard slope should be ~0.72m, got ${hCourtyardSlope}`);
      assert.ok(hCentralPlateau > 1.25 && hCentralPlateau < 1.50, `Central plateau should be ~1.32m, got ${hCentralPlateau}`);
      assert.ok(hSouthWestHill > 1.95, `South-west hill should be >1.95m, got ${hSouthWestHill}`);

      // Verify player movement across sloped terrain stays grounded without floating, sinking, or airborne flicker
      const startX = -34.0, startZ = -25.0;
      const startY = env.getSupportFloorY(startX, startZ, 0.0);
      env.playerPhysics.pos.set(startX, startY, startZ);
      env.playerPhysics.vel.set(0, 0, 0);
      env.playerPhysics.isGrounded = true;
      env.playerPhysics.yaw = -Math.PI / 2; // Walk +X up the courtyard slope from ~0.00m to ~1.35m
      env.playerPhysics.targetYaw = -Math.PI / 2;
      env.keys['KeyW'] = true;
      const dt = 1 / 60;
      let airborneFrames = 0;
      let maxHeightError = 0;
      for (let f = 0; f < 280; f++) {
        env.updatePlayer(dt, f * dt);
        if (!env.playerPhysics.isGrounded) airborneFrames++;
        const expectedY = env.getSupportFloorY(env.playerPhysics.pos.x, env.playerPhysics.pos.z, env.playerPhysics.pos.y);
        const err = Math.abs(env.playerPhysics.pos.y - expectedY);
        if (err > maxHeightError) maxHeightError = err;
      }
      env.keys['KeyW'] = false;
      assert.strictEqual(airborneFrames, 0, `Player should not become airborne on terrain slope (airborneFrames=${airborneFrames})`);
      assert.ok(maxHeightError <= 0.06, `Player should track terrain height closely (maxHeightError=${maxHeightError.toFixed(4)}m)`);
      assert.ok(env.playerPhysics.pos.y > startY + 1.15, `Player should climb >1.15m up the courtyard slope (startY=${startY.toFixed(2)}, endY=${env.playerPhysics.pos.y.toFixed(2)})`);

      // Verify all 139 JSON objects across all 8 categories are instantiated in the Three.js scene
      assert.ok(campusAudit, 'campusSceneAudit must be present on scene.userData');
      assert.strictEqual(campusAudit.totalInJson, 139);
      assert.strictEqual(campusAudit.instantiatedCount, 139);
      assert.strictEqual(campusAudit.unsupportedOrFailed.length, 0);
      assert.deepStrictEqual({ ...campusAudit.byCategory }, {
        building: 19,
        lighting: 44,
        prop: 19,
        vehicle: 18,
        nature: 16,
        ground_area: 15,
        architecture: 7,
        road: 1,
      });
    });

    test('9.8 Functional Interior System Audit: Openable windows/doors, room light switches, searchable drawers/cupboards/lockers/racks, mission items, and electrical switchboards', () => {
      const env = initGameEnvironment();
      const sys = env.scene.userData.interiorSystem;
      assert.ok(sys, 'interiorSystem must be registered on scene.userData');
      assert.ok(Array.isArray(sys.interactables) && sys.interactables.length >= 60, `Expected >=60 functional interior interactables, got ${sys.interactables && sys.interactables.length}`);
      assert.ok(Array.isArray(sys.missionItems) && sys.missionItems.length >= 5, `Expected >=5 mission items hidden in interiors, got ${sys.missionItems && sys.missionItems.length}`);

      const byType = {};
      sys.interactables.forEach(it => {
        byType[it.type] = (byType[it.type] || 0) + 1;
      });
      assert.ok(byType.window >= 15, `Expected >=15 openable windows, got ${byType.window}`);
      assert.ok(byType.door >= 15, `Expected >=15 interactive doors, got ${byType.door}`);
      assert.ok(byType.light_switch >= 15, `Expected >=15 working room light switches, got ${byType.light_switch}`);
      assert.ok(byType.drawer >= 8, `Expected >=8 searchable desk/cabinet drawers, got ${byType.drawer}`);
      assert.ok(byType.cupboard >= 8, `Expected >=8 openable storage cupboards, got ${byType.cupboard}`);
      assert.ok(byType.locker >= 6, `Expected >=6 interactive corridor lockers, got ${byType.locker}`);
      assert.ok(byType.rack >= 2, `Expected >=2 sliding storage/library racks, got ${byType.rack}`);
      assert.ok(byType.switchboard >= 2, `Expected >=2 electrical switchboards/breaker panels, got ${byType.switchboard}`);

      // 1. Test openable window & dynamic collider state
      const sampleWin = sys.interactables.find(it => it.type === 'window');
      assert.strictEqual(sampleWin.isOpen, false);
      assert.strictEqual(sampleWin.collider.enabled, true);
      sys.toggleInteractableById(sampleWin.id);
      assert.strictEqual(sampleWin.isOpen, true, 'Window should open when toggled');
      assert.strictEqual(sampleWin.collider.enabled, false, 'Window collider should disable when opened');

      // 2. Test door manual close & dynamic door-leaf collider blocking
      const sampleDoor = sys.interactables.find(it => it.type === 'door');
      assert.strictEqual(sampleDoor.isOpen, true);
      assert.strictEqual(sampleDoor.collider.enabled, false);
      sys.toggleInteractableById(sampleDoor.id);
      assert.strictEqual(sampleDoor.isOpen, false, 'Door should close when toggled');
      assert.strictEqual(sampleDoor.collider.enabled, true, 'Door collider should enable when closed');

      // 3. Test working room light switch toggling room illumination state
      const sampleSwitch = sys.interactables.find(it => it.type === 'light_switch' && it.isOn);
      assert.ok(sampleSwitch, 'Should have an active room light switch');
      sys.toggleInteractableById(sampleSwitch.id);
      assert.strictEqual(sampleSwitch.isOn, false, 'Light switch should turn OFF room lights');
      assert.strictEqual(sys.roomLightStates[sampleSwitch.roomId], false);

      // 4. Test searchable drawer/rack revealing & collecting hidden mission items
      const itemDrawer = sys.interactables.find(it => it.missionItem && it.missionItem.id === 'item_main_breaker_key');
      assert.ok(itemDrawer, 'Teacher desk drawer with Main Switchboard Brass Key must exist');
      assert.strictEqual(itemDrawer.missionItem.collected, false);
      sys.toggleInteractableById(itemDrawer.id);
      assert.strictEqual(itemDrawer.isOpen, true);
      assert.strictEqual(itemDrawer.missionItem.collected, true, 'Opening container should discover and collect mission item');
      assert.ok(sys.collectedItems.includes('item_main_breaker_key'));

      // 5. Test Electrical & Maintenance Room Main Campus Switchboard power state control
      const mainSwitchboard = sys.interactables.find(it => it.type === 'switchboard' && it.controlsCampusLights);
      assert.ok(mainSwitchboard, 'Main Campus Lighting Switchboard must exist in Electrical/Maintenance Room');
      assert.strictEqual(sys.powerStates.campusExteriorLights, true);
      sys.toggleInteractableById(mainSwitchboard.id);
      assert.strictEqual(sys.powerStates.campusExteriorLights, false, 'Main switchboard should cut exterior campus lights power state');
      sys.toggleInteractableById(mainSwitchboard.id);
      assert.strictEqual(sys.powerStates.campusExteriorLights, true, 'Main switchboard should restore exterior campus lights power state');
    });
  });
});

