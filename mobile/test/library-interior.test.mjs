import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_GLB_DATA_URI } from '../components/games/hide-and-seek/libraryGlbBase64.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// HELPER: Initialize Full Game Environment from gameHtml.ts in Headless VM
// ============================================================================
function initLibraryGameEnvironment() {
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
  walkableFloors,
  interactiveHidingSpots,
  interiorInteractables,
  interactablesById,
  ROOM_ARCHETYPE_BUILDERS,
  ROOM_DEFINITIONS,
  isPositionClearOfColliders,
  toggleInteriorInteractable,
  playerPhysics,
  updatePlayer,
  scene,
  camera,
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
      LIBRARY_GLB_DATA_URI,
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

// ============================================================================
// TEST SUITE: Phase 11 — University Library Production Environment
// ============================================================================
describe('Phase 11: University Library Production Environment Verification', () => {

  test('1. GLB Asset & Base64 Payload Integrity', () => {
    assert.ok(LIBRARY_GLB_DATA_URI, 'LIBRARY_GLB_DATA_URI must be defined');
    assert.ok(LIBRARY_GLB_DATA_URI.startsWith('data:model/gltf-binary;base64,'), 'Must be a valid glTF binary data URI');

    const base64Data = LIBRARY_GLB_DATA_URI.replace('data:model/gltf-binary;base64,', '');
    const buffer = Buffer.from(base64Data, 'base64');
    assert.ok(buffer.length > 500000, `GLB buffer size should exceed 500KB (actual: ${buffer.length} bytes)`);

    // Verify glTF binary magic number: 0x46546C67 ('glTF')
    const magic = buffer.toString('utf8', 0, 4);
    assert.strictEqual(magic, 'glTF', 'Binary must have glTF magic header');

    const version = buffer.readUInt32LE(4);
    assert.strictEqual(version, 2, 'glTF version must be 2.0');

    // Verify presence of key node definitions in JSON chunk
    const jsonLength = buffer.readUInt32LE(12);
    const jsonChunk = buffer.toString('utf8', 20, 20 + jsonLength);
    const gltf = JSON.parse(jsonChunk);

    assert.ok(Array.isArray(gltf.nodes), 'glTF must contain nodes');
    const nodeNames = gltf.nodes.map(n => n.name).filter(Boolean);

    const requiredNodes = [
      'Library_Floor_Slab',
      'Library_Ceiling_Slab',
      'Door_Leaf_Library_Entrance',
      'Door_Leaf_Archive',
      'Bookshelf_Interaction',
      'Filing_Cabinet_Drawer',
      'Archive_Cabinet_Door',
      'Desk_Lamp_Banker_1',
      'Librarian_Keyboard',
    ];

    for (const reqNode of requiredNodes) {
      assert.ok(nodeNames.includes(reqNode), `glTF scene must contain node: ${reqNode}`);
    }
  });

  test('2. Room Archetype & East Wing R4 Layout Integration', () => {
    const env = initLibraryGameEnvironment();
    assert.ok(env.ROOM_ARCHETYPE_BUILDERS.library_production_glb, 'library_production_glb archetype must be registered in ROOM_ARCHETYPE_BUILDERS');

    const libraryRoom = env.ROOM_DEFINITIONS['East Wing R4 Room 1'];
    assert.ok(libraryRoom, 'East Wing R4 Room 1 definition must exist in ROOM_DEFINITIONS');
    assert.strictEqual(libraryRoom.archetype, 'library_production_glb', 'Room archetype must be library_production_glb');

    // Check bounds: X in [23.7, 33.3], Z in [8.25, 29.75]
    assert.strictEqual(libraryRoom.bounds.minX, 23.7);
    assert.strictEqual(libraryRoom.bounds.maxX, 33.3);
    assert.strictEqual(libraryRoom.bounds.minZ, 8.25);
    assert.strictEqual(libraryRoom.bounds.maxZ, 29.75);

    // Floor and ceiling elevations
    assert.ok(Math.abs(libraryRoom.bounds.floorY - 1.62) < 0.05, `Floor elevation should be approx 1.62m (actual: ${libraryRoom.bounds.floorY})`);
    assert.ok(Math.abs(libraryRoom.bounds.ceilingY - 5.17) < 0.05, `Ceiling elevation should be approx 5.17m (actual: ${libraryRoom.bounds.ceilingY})`);

    // Entrance position
    assert.ok(Math.abs(libraryRoom.door.x - 23.7) <= 0.35, `Door X should align with west doorway (actual: ${libraryRoom.door.x})`);
    assert.ok(Math.abs(libraryRoom.door.z - 19.0) < 0.1, 'Door Z should align with exterior entrance steps at 19.0');
  });

  test('3. Hiding Spots: 4 Required Locations & Navigability', () => {
    const env = initLibraryGameEnvironment();
    const hidingSpots = env.interactiveHidingSpots;

    const requiredSpotIds = [
      'hiding-library-bookshelf',
      'hiding-library-archive-cabinet',
      'hiding-library-table',
      'hiding-library-reception',
    ];

    for (const spotId of requiredSpotIds) {
      const spot = hidingSpots.find(s => s.id === spotId);
      assert.ok(spot, `Hiding spot '${spotId}' must be registered`);
      assert.ok(spot.name, `Spot '${spotId}' must have a name`);
      assert.strictEqual(typeof spot.x, 'number', `Spot '${spotId}' must have an x coordinate`);
      assert.strictEqual(typeof spot.y, 'number', `Spot '${spotId}' must have a y coordinate`);
      assert.strictEqual(typeof spot.z, 'number', `Spot '${spotId}' must have a z coordinate`);

      // Spot must be within library bounds [23.7, 33.3] x [8.25, 29.75]
      assert.ok(spot.x >= 23.7 && spot.x <= 33.3, `Spot '${spotId}' X (${spot.x}) must be inside library bounds [23.7, 33.3]`);
      assert.ok(spot.z >= 8.25 && spot.z <= 29.75, `Spot '${spotId}' Z (${spot.z}) must be inside library bounds [8.25, 29.75]`);

      // Check elevation: floor is at 1.62m, spot should be at floor level
      assert.ok(Math.abs(spot.y - 1.62) < 0.1, `Spot '${spotId}' Y (${spot.y}) should be at floor level (~1.62m)`);
    }
  });

  test('4. Interior Interactables: All 10 Required Interactions Registered & Functional', () => {
    const env = initLibraryGameEnvironment();
    const interactables = env.interiorInteractables;

    // Filter library interactables: X in [23, 34], Z in [8, 30]
    const libraryItems = interactables.filter(item => {
      const x = item.x !== undefined ? item.x : (item.pos && item.pos.x);
      const z = item.z !== undefined ? item.z : (item.pos && item.pos.z);
      return x >= 23 && x <= 34 && z >= 8 && z <= 30;
    });

    assert.ok(libraryItems.length >= 10, `Expected at least 10 library interactables, found ${libraryItems.length}`);

    // Verify 10 specific required interactions:
    // 1. Entrance Door
    const entranceDoor = libraryItems.find(i => i.id === 'door-library-entrance');
    assert.ok(entranceDoor, '1. Main library entrance door must be registered');
    assert.strictEqual(entranceDoor.type, 'door');
    const initDoorState = entranceDoor.isOpen;
    env.toggleInteriorInteractable(entranceDoor);
    assert.strictEqual(entranceDoor.isOpen, !initDoorState, 'Toggling door must invert isOpen');

    // 2. Archive Room Door
    const archiveDoor = libraryItems.find(i => i.id === 'door-library-archive');
    assert.ok(archiveDoor, '2. Archive partition door must be registered');
    assert.strictEqual(archiveDoor.type, 'door');
    const initArchDoorState = archiveDoor.isOpen;
    env.toggleInteriorInteractable(archiveDoor);
    assert.strictEqual(archiveDoor.isOpen, !initArchDoorState, 'Toggling archive door must invert isOpen');

    // 3. Reception Desk Drawers
    const receptionDrawer = libraryItems.find(i => i.id === 'drawer-library-reception');
    assert.ok(receptionDrawer, '3. Reception desk drawers must be registered');
    assert.strictEqual(receptionDrawer.type, 'drawer');
    assert.ok(receptionDrawer.missionItem, 'Reception drawer must contain key item');
    const initDrawerState = receptionDrawer.isOpen;
    env.toggleInteriorInteractable(receptionDrawer);
    assert.strictEqual(receptionDrawer.isOpen, !initDrawerState, 'Toggling reception drawer must invert isOpen');

    // 4. Filing Cabinet Drawers
    const filingCabinet = libraryItems.find(i => i.id === 'drawer-library-filing');
    assert.ok(filingCabinet, '4. Filing cabinet drawers must be registered');
    assert.strictEqual(filingCabinet.type, 'drawer');
    const initFilingState = filingCabinet.isOpen;
    env.toggleInteriorInteractable(filingCabinet);
    assert.strictEqual(filingCabinet.isOpen, !initFilingState, 'Toggling filing cabinet drawer must invert isOpen');

    // 5. Archive Storage Cupboard
    const archiveCab = libraryItems.find(i => i.id === 'cupboard-library-archive');
    assert.ok(archiveCab, '5. Archive storage cupboard must be registered');
    assert.strictEqual(archiveCab.type, 'cupboard');
    const initArchCabState = archiveCab.isOpen;
    env.toggleInteriorInteractable(archiveCab);
    assert.strictEqual(archiveCab.isOpen, !initArchCabState, 'Toggling archive cupboard must invert isOpen');

    // 6. Bookshelf / Rare Book interaction
    const rareBook = libraryItems.find(i => i.id === 'book-library-gandaki-ledger');
    assert.ok(rareBook, '6. Bookshelf rare book interaction must be registered');
    assert.strictEqual(rareBook.type, 'bookshelf');
    assert.strictEqual(typeof rareBook.onInteract, 'function');
    env.toggleInteriorInteractable(rareBook);
    assert.strictEqual(rareBook.isExamined, true, 'Examining book must set isExamined flag');

    // 7. Librarian Computer / Monitor Toggle
    const librarianPc = libraryItems.find(i => i.id === 'terminal-library-librarian');
    assert.ok(librarianPc, '7. Librarian workstation monitor must be registered');
    assert.strictEqual(librarianPc.type, 'monitor');
    const initPcState = librarianPc.isOn;
    env.toggleInteriorInteractable(librarianPc);
    assert.strictEqual(librarianPc.isOn, !initPcState, 'Toggling monitor must invert isOn');

    // 8. Reading Desk Banker Lamp
    const deskLamp = libraryItems.find(i => i.id === 'lamp-library-banker-1');
    assert.ok(deskLamp, '8. Reading desk banker lamp must be registered');
    assert.strictEqual(deskLamp.type, 'desk_lamp');
    const initLampState = deskLamp.isOn;
    env.toggleInteriorInteractable(deskLamp);
    assert.strictEqual(deskLamp.isOn, !initLampState, 'Toggling desk lamp must invert isOn');

    // 9. Main Electrical Switchboard
    const switchboard = libraryItems.find(i => i.id === 'switchboard-library-r4');
    assert.ok(switchboard, '9. Main electrical switchboard must be registered');
    assert.strictEqual(switchboard.type, 'switchboard');
    const initSbState = switchboard.isOn;
    env.toggleInteriorInteractable(switchboard);
    assert.strictEqual(switchboard.isOn, !initSbState, 'Toggling switchboard must invert isOn');

    // 10. Secondary Reading Hall Light Switch
    const lightSwitch = libraryItems.find(i => i.id === 'switch-library-secondary');
    assert.ok(lightSwitch, '10. Reading hall light switch must be registered');
    assert.strictEqual(lightSwitch.type, 'light_switch');
    const initLsState = lightSwitch.isOn;
    env.toggleInteriorInteractable(lightSwitch);
    assert.strictEqual(lightSwitch.isOn, !initLsState, 'Toggling light switch must invert isOn');
  });

  test('5. Architectural Collision & Spatial Clearance', () => {
    const env = initLibraryGameEnvironment();
    const colliders = env.colliders;

    // Filter colliders in library area
    const libraryColliders = colliders.filter(c => {
      if (!c.box) return false;
      const min = c.box.min;
      const max = c.box.max;
      return max.x >= 23.7 && min.x <= 33.3 && max.z >= 8.25 && min.z <= 29.75;
    });

    assert.ok(libraryColliders.length >= 10, `Expected colliders for walls, tables, and shelves (found: ${libraryColliders.length})`);

    // Verify entrance threshold is clear of colliders
    // Entrance is at (24.0, 1.62, 19.0)
    const doorwayPoint = new THREE.Vector3(24.0, 1.62, 19.0);
    const clearAtEntrance = env.isPositionClearOfColliders(doorwayPoint.x, doorwayPoint.y, doorwayPoint.z, 0.28);
    assert.ok(clearAtEntrance, 'Player must be able to stand inside doorway threshold at (24.0, 1.62, 19.0)');

    // Verify reception walking corridor is clear
    const receptionWalkway = new THREE.Vector3(26.0, 1.62, 19.0);
    const clearAtReception = env.isPositionClearOfColliders(receptionWalkway.x, receptionWalkway.y, receptionWalkway.z, 0.28);
    assert.ok(clearAtReception, 'Reception walkway at (26.0, 1.62, 19.0) must be clear of colliders');

    // Verify reading hall aisle is clear
    const readingAisle = new THREE.Vector3(28.5, 1.62, 21.0);
    const clearAtAisle = env.isPositionClearOfColliders(readingAisle.x, readingAisle.y, readingAisle.z, 0.28);
    assert.ok(clearAtAisle, 'Reading hall center aisle at (28.5, 1.62, 21.0) must be clear of colliders');

    // Verify bookshelf solid collider blocks player at Bookshelf Row 1 (26.0, 1.62, 23.6)
    const bookshelfCore = new THREE.Vector3(26.0, 1.62, 23.6);
    const clearInsideBookshelf = env.isPositionClearOfColliders(bookshelfCore.x, bookshelfCore.y, bookshelfCore.z, 0.28);
    assert.strictEqual(clearInsideBookshelf, false, 'Inside bookshelf collider must block player');
  });

  test('6. Preservation of Tihar Night Campus Environment', () => {
    const env = initLibraryGameEnvironment();
    const scene = env.scene;

    const tiharRoot = scene.getObjectByName('GandakiTiharNightExperience');
    assert.ok(tiharRoot, 'GandakiTiharNightExperience root group must remain in scene');

    // Check presence of instanced meshes and decorative systems
    let hasDiyoMeshes = false;
    let hasGarlandBlossoms = false;
    let hasWallWashes = false;

    tiharRoot.traverse(child => {
      if (child.isInstancedMesh) {
        if (child.geometry && child.count > 0) {
          hasDiyoMeshes = true;
        }
      }
      if (child.isMesh && child.material) {
        if (child.material.name === 'garland' || (child.name && child.name.includes('Garland'))) {
          hasGarlandBlossoms = true;
        }
      }
    });

    assert.ok(hasDiyoMeshes, 'Tihar instanced meshes (diyos/bulbs/flowers) must be active and populated');
  });

});
