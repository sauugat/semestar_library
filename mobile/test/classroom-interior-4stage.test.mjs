import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHITECTURAL_CONSTANTS,
  buildRepresentativeClassroomScene,
  resolvePlayerCapsuleCollisions,
} from '../components/games/hide-and-seek/interior/classroom_3d_interior.mjs';
import {
  RaycastTarget,
  MobileInteractionController,
} from '../components/games/hide-and-seek/interior/mobile_interaction_controller.mjs';
import {
  MISSION_STATES,
  PowerRestorationMissionFSM,
} from '../components/games/hide-and-seek/interior/power_restoration_fsm.mjs';
import {
  PLAYER_LOCOMOTION_STATES,
  CHASER_AI_STATES,
  HidingSpot,
  PlayerStealthController,
  SearchableContainerManager,
  AcousticStealthAI,
} from '../components/games/hide-and-seek/interior/hide_and_seek_stealth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadGameHtmlEnvironment() {
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
  code = code.replace('function updatePlayer(delta) {', 'function updatePlayer(delta, timeSec = 0) {');
  code += `
globalThis.__HARNESS_EXPORTS__ = {
  colliders,
  interactiveHidingSpots,
  playerPhysics,
  updatePlayer,
  scene,
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
        fill() {}, arc() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
        translate() {}, rotate() {}, scale() {}, resetTransform() {}, setTransform() {}, transform() {},
        save() {}, restore() {}, clearRect() {},
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

describe('4-Stage Classroom Interior, Mobile Raycast, Power-Restoration FSM & Stealth Suite', () => {
  test('Stage 1: 3D Classroom Element & Functional Interior (metrics, doorway entry, corner sliding, clamped drawer/door)', () => {
    const scene = buildRepresentativeClassroomScene();

    for (const wall of scene.staticColliders.filter((c) => c.category === 'wall')) {
      const size = wall.getSize();
      const minHorizontalDim = Math.min(size.x, size.z);
      assert.ok(Math.abs(minHorizontalDim - ARCHITECTURAL_CONSTANTS.WALL_THICKNESS) < 1e-6);
      assert.ok(Math.abs(size.y - ARCHITECTURAL_CONSTANTS.WALL_HEIGHT) < 1e-6);
    }

    const classroomDoor = scene.doors.find((d) => d.id === 'door_classroom_main');
    assert.strictEqual(classroomDoor.state, 'IDLE_CLOSED');
    assert.strictEqual(classroomDoor.interact().accepted, true);
    assert.strictEqual(classroomDoor.interact().reason, 'BUSY_ANIMATING');
    for (let step = 0; step < 40; step++) classroomDoor.update(0.02);
    assert.strictEqual(classroomDoor.state, 'IDLE_OPEN');

    const teacherDrawer = scene.drawers.find((d) => d.id === 'drawer_teacher_desk_top');
    assert.strictEqual(teacherDrawer.isItemExposed(), false);
    assert.strictEqual(teacherDrawer.toggle().accepted, true);
    for (let step = 0; step < 30; step++) teacherDrawer.update(0.02);
    assert.strictEqual(teacherDrawer.state, 'IDLE_OPEN');
    assert.strictEqual(teacherDrawer.currentSlide, teacherDrawer.maxSlide);
    assert.strictEqual(teacherDrawer.isItemExposed(), true);

    const allActiveColliders = [
      ...scene.staticColliders,
      ...scene.doors.map((d) => d.getDoorLeafWorldAABB()),
      ...scene.drawers.map((d) => d.getWorldBounds()),
    ];

    let doorwayPos = { x: -3.275, y: 0, z: -4.30 };
    for (let frame = 0; frame < 60; frame++) {
      const desired = { x: doorwayPos.x, y: 0, z: doorwayPos.z + 2.8 * (1 / 60) };
      doorwayPos = resolvePlayerCapsuleCollisions(desired, ARCHITECTURAL_CONSTANTS.PLAYER_RADIUS, allActiveColliders).position;
    }
    assert.ok(doorwayPos.z >= -1.80, 'Player must pass through open 0.95m classroom doorway into West aisle');
  });

  test('Stage 2 & 3: Mobile Interaction Controller & Power-Restoration Mission FSM', () => {
    const scene = buildRepresentativeClassroomScene();
    const mission = new PowerRestorationMissionFSM({ scene });
    const mobileUI = new MobileInteractionController({ debounceMs: 180, defaultReachMeters: 2.15 });

    const teacherDrawer = scene.drawers.find((d) => d.id === 'drawer_teacher_desk_top');
    const supplyDrawer = scene.drawers.find((d) => d.id === 'drawer_supply_cabinet_main');
    const elecDoor = scene.doors.find((d) => d.id === 'door_electrical_room');

    const targets = [
      new RaycastTarget({
        id: 'target_teacher_drawer',
        type: 'drawer',
        label: 'Teacher Desk Drawer',
        min: { x: -1.73, y: 0.55, z: 1.86 },
        max: { x: -1.27, y: 0.69, z: 2.34 },
        getPrompt: () => (teacherDrawer.state === 'IDLE_OPEN' ? 'Close Drawer' : 'Open Drawer'),
        onInteract: () => teacherDrawer.toggle(),
      }),
      new RaycastTarget({
        id: 'target_electrical_key',
        type: 'pickup_item',
        label: 'Electrical Room Key',
        min: { x: -1.60, y: 0.60, z: 1.65 },
        max: { x: -1.40, y: 0.70, z: 1.85 },
        isEnabled: () => teacherDrawer.isItemExposed() && !mission.collectedItems.has('item_electrical_room_key'),
        getPrompt: () => 'Take Electrical Room Key',
        onInteract: () => mission.pickupItem('item_electrical_room_key', teacherDrawer),
      }),
      new RaycastTarget({
        id: 'target_fuse_socket',
        type: 'fuse_socket',
        label: 'Main Fuse Socket',
        min: { x: 3.82, y: 1.35, z: -4.60 },
        max: { x: 3.98, y: 1.55, z: -4.40 },
        isEnabled: () => !mission.fuseInserted,
        getPrompt: () => 'Insert 30A Main Fuse',
        onInteract: () => mission.insertFuse(),
      }),
    ];

    // Wall occlusion check
    const occludedResult = mobileUI.evaluateReticleRaycast(
      { x: 3.90, y: 1.45, z: -2.60 },
      { x: 0.0, y: 0.0, z: -1.0 },
      scene.staticColliders,
      targets
    );
    assert.strictEqual(occludedResult.hit, false);
    assert.strictEqual(occludedResult.occluded, true);
    assert.strictEqual(occludedResult.occludedBy, 'wall_south_main');

    // Focus drawer + rapid tap debounce
    const focusDrawer = mobileUI.evaluateReticleRaycast({ x: -1.50, y: 0.62, z: 0.80 }, { x: 0.0, y: 0.0, z: 1.0 }, [], targets);
    assert.strictEqual(focusDrawer.hit, true);
    assert.strictEqual(mobileUI.pressActionButton({ timestampMs: 1000, touchId: 1 }).accepted, true);
    assert.strictEqual(mobileUI.pressActionButton({ timestampMs: 1040, touchId: 1 }).reason, 'DEBOUNCED_RAPID_TAP');
    teacherDrawer.update(0.05);
    mobileUI.releaseActionButton({ touchId: 1 });
    assert.strictEqual(mobileUI.pressActionButton({ timestampMs: 1220, touchId: 1 }).reason, 'BUSY_ANIMATING');
    for (let i = 0; i < 30; i++) teacherDrawer.update(0.02);

    // Invalid sequences before prerequisites
    assert.strictEqual(mission.unlockElectricalRoomDoor(elecDoor).reason, 'LOCKED_NEEDS_KEY');

    // Happy path: Key -> Unlock -> Fuse -> Breakers -> Power Restored -> Reset
    mobileUI.evaluateReticleRaycast({ x: -1.50, y: 0.65, z: 0.80 }, { x: 0.0, y: 0.0, z: 1.0 }, [], targets);
    assert.strictEqual(mobileUI.pressActionButton({ timestampMs: 2000, touchId: 1 }).accepted, true);
    mobileUI.releaseActionButton({ touchId: 1 });
    assert.strictEqual(mission.state, MISSION_STATES.KEY_ACQUIRED);

    assert.strictEqual(mission.unlockElectricalRoomDoor(elecDoor).accepted, true);
    assert.strictEqual(mission.state, MISSION_STATES.ELECTRICAL_ROOM_UNLOCKED);

    // Invalid sequences once inside Electrical Room before retrieving/inserting fuse
    assert.strictEqual(mission.toggleBreaker('breaker_main').reason, 'NO_FUSE_INSTALLED');
    assert.strictEqual(mission.insertFuse().reason, 'MISSING_FUSE_ITEM');

    supplyDrawer.toggle();
    for (let i = 0; i < 30; i++) supplyDrawer.update(0.02);
    assert.strictEqual(mission.pickupItem('item_main_fuse_30a', supplyDrawer).accepted, true);
    assert.strictEqual(mission.insertFuse().accepted, true);
    assert.strictEqual(mission.state, MISSION_STATES.FUSE_INSERTED);
    assert.strictEqual(mission.toggleBreaker('breaker_classroom_1').reason, 'MAIN_BREAKER_OFF');

    assert.strictEqual(mission.toggleBreaker('breaker_main').accepted, true);
    assert.strictEqual(mission.toggleBreaker('breaker_classroom_1').accepted, true);
    assert.strictEqual(mission.toggleBreaker('breaker_corridor').accepted, true);
    assert.strictEqual(mission.state, MISSION_STATES.POWER_RESTORED);
    assert.strictEqual(mission.lights.classroom_lights.intensity, 1.0);

    const resetSnap = mission.resetMission();
    assert.strictEqual(resetSnap.state, MISSION_STATES.BLACKOUT_INIT);
  });

  test('Stage 4: Pushdown Automaton Hiding, Solvable Containers, Wall-Attenuated Acoustic AI & gameHtml.ts Integration', () => {
    const scene = buildRepresentativeClassroomScene();
    const westLocker = new HidingSpot({
      id: 'hiding_locker_west',
      roomId: 'classroom_101',
      label: 'West Classroom Storage Locker',
      entryPosition: { x: -3.10, y: 0, z: 2.15 },
      interiorPosition: { x: -3.62, y: 0, z: 2.15 },
    });

    const player = new PlayerStealthController({
      initialPosition: { x: -3.05, y: 0, z: 2.10 },
      initialState: PLAYER_LOCOMOTION_STATES.CROUCHING,
    });
    const chaser = new AcousticStealthAI({ initialPosition: { x: 0.0, y: 0, z: -4.5 } });
    const allColliders = [...scene.staticColliders, ...scene.doors.map((d) => d.getDoorLeafWorldAABB())];

    chaser.state = CHASER_AI_STATES.CHASE;
    const hasLOSBehindWall = chaser.hasLineOfSight(player.position, allColliders, player);
    assert.strictEqual(hasLOSBehindWall, false);
    player.enterHidingSpot(westLocker, { chaserHasLineOfSight: hasLOSBehindWall });
    assert.strictEqual(chaser.evaluateChaseAndHiding(player, allColliders).playerSafe, true);
    assert.strictEqual(player.exitHidingSpot().restoredState, PLAYER_LOCOMOTION_STATES.CROUCHING);

    // Solvable container distribution across 25 seeds
    const containerMgr = new SearchableContainerManager();
    for (let seed = 1; seed <= 25; seed++) {
      const placements = containerMgr.distributeMissionItems(seed);
      assert.notStrictEqual(placements.item_electrical_room_key.roomId, 'electrical_room');
      assert.notStrictEqual(placements.item_main_fuse_30a.roomId, 'electrical_room');
    }

    // Acoustic attenuation across walls
    chaser.state = CHASER_AI_STATES.PATROL;
    assert.strictEqual(
      chaser.processEnvironmentalSound({ type: 'FOOTSTEP_CROUCH', decibels: 32, position: { x: 0.0, y: 0, z: 0.5 } }, allColliders).heard,
      false
    );
    assert.strictEqual(
      chaser.processEnvironmentalSound({ type: 'DRAWER_RAPID_SLAM', decibels: 76, position: { x: 0.0, y: 0, z: 0.5 } }, allColliders).heard,
      true
    );

    // Verify newly wired hooks in gameHtml.ts window.__INTERIOR_SYSTEM__
    const env = loadGameHtmlEnvironment();
    const sys = env.scene.userData.interiorSystem;
    assert.ok(typeof sys.resetMission === 'function', 'resetMission must be wired on window.__INTERIOR_SYSTEM__');
    assert.ok(typeof sys.propagateInteriorSound === 'function', 'propagateInteriorSound must be wired on window.__INTERIOR_SYSTEM__');

    env.playerPhysics.isCrouching = true;
    const spot = env.interactiveHidingSpots[0];
    const enterRes = sys.enterHidingSpot(spot, 'local_player', { chaserHasLineOfSight: false });
    assert.strictEqual(enterRes.ok, true);
    assert.strictEqual(enterRes.compromised, false);
    const exitRes = sys.exitHidingSpot('local_player');
    assert.strictEqual(exitRes.ok, true);
    assert.strictEqual(exitRes.restoredState, 'CROUCHING');
    assert.strictEqual(env.playerPhysics.isCrouching, true, 'Exiting hiding spot in gameHtml.ts must restore prior CROUCHING posture');

    const soundCheck = sys.propagateInteriorSound(
      { decibels: 76, position: { x: -15.3, y: 1.25, z: -9.5 } },
      { x: -15.3, y: 1.25, z: -12.5 }
    );
    assert.strictEqual(soundCheck.heard, true);

    sys.startMission('restore_campus_power');
    assert.strictEqual(sys.missions.restore_campus_power.active, true);
    const r = sys.resetMission('restore_campus_power');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(sys.missions.restore_campus_power.state, 'not_started');
    assert.strictEqual(sys.powerStates.campusExteriorLights, true);
  });
});
