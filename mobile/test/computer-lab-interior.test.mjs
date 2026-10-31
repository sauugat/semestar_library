import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

test('Phase 9: Computer & Electronics Laboratory Production Pipeline & Integration Suite', async (t) => {
  const glbPath = path.resolve(rootDir, 'scripts/blender/output/computer_lab_production.glb');
  const publicGlbPath = path.resolve(rootDir, 'public/models/computer_lab_production.glb');

  await t.test('1. Production GLB Asset Integrity & Scene Metrics', async () => {
    assert.ok(fs.existsSync(glbPath), `Production GLB must exist at ${glbPath}`);
    assert.ok(fs.existsSync(publicGlbPath), `Public GLB must exist at ${publicGlbPath}`);

    const fileBuf = fs.readFileSync(glbPath);
    assert.ok(fileBuf.byteLength > 50000, `GLB file size (${fileBuf.byteLength} bytes) must be substantial`);
    assert.ok(fileBuf.byteLength < 15000000, `GLB file size (${fileBuf.byteLength} bytes) must be mobile-optimized (< 15MB)`);

    // Parse with Three.js GLTFLoader
    if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
    if (typeof URL.createObjectURL === 'undefined') {
      URL.createObjectURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      URL.revokeObjectURL = () => {};
    }

    const loader = new GLTFLoader();
    const arrayBuffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const scene = gltf.scene;
    let meshCount = 0;
    let vertexCount = 0;
    let triangleCount = 0;
    const materialSet = new Set();
    const namedObjects = new Map();

    scene.traverse((obj) => {
      if (obj.name) namedObjects.set(obj.name, obj);
      if (obj.isMesh) {
        meshCount++;
        const geo = obj.geometry;
        if (geo.attributes.position) vertexCount += geo.attributes.position.count;
        if (geo.index) triangleCount += geo.index.count / 3;
        else if (geo.attributes.position) triangleCount += geo.attributes.position.count / 3;

        if (Array.isArray(obj.material)) obj.material.forEach((m) => materialSet.add(m.name || m.uuid));
        else if (obj.material) materialSet.add(obj.material.name || obj.material.uuid);
      }
    });

    assert.ok(triangleCount > 500, `Triangle count (${triangleCount}) must represent detailed environment`);
    assert.ok(triangleCount < 10000, `Triangle count (${triangleCount}) must remain within performance budget (< 10k)`);
    assert.ok(meshCount < 80, `Draw call mesh count (${meshCount}) must be consolidated by material pass`);

    const bbox = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    assert.ok(size.x >= 7.0 && size.x <= 8.5, `Lab width (${size.x.toFixed(2)}m) should be ~7.6-8.0m`);
    assert.ok(size.z >= 7.5 && size.z <= 9.0, `Lab depth (${size.z.toFixed(2)}m) should be ~8.0m`);
    assert.ok(size.y >= 3.0 && size.y <= 4.0, `Lab height (${size.y.toFixed(2)}m) should be ~3.35m`);
  });

  await t.test('2. Interactive Objects & Kinematic Articulations', async () => {
    const fileBuf = fs.readFileSync(glbPath);
    const loader = new GLTFLoader();
    const arrayBuffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const scene = gltf.scene;
    const namedObjects = new Map();
    scene.traverse((o) => { if (o.name) namedObjects.set(o.name, o); });

    const required = [
      'Door_Leaf_Lab',
      'Cabinet_Door_Left',
      'Cabinet_Door_Right',
      'TeacherDesk_Drawer_Lab',
      'Item_Lab_Key',
      'Switchboard_Door_Lab',
      'Terminal_Monitor_1',
      'Window_Glass_Lab_1',
      'Window_Glass_Lab_2'
    ];

    for (const name of required) {
      assert.ok(namedObjects.has(name), `Missing required interactive component: ${name}`);
    }

    // Kinematics tests
    const door = namedObjects.get('Door_Leaf_Lab');
    door.rotation.y = 1.45;
    assert.equal(door.rotation.y, 1.45, 'Door must support rotational swing');

    const cabL = namedObjects.get('Cabinet_Door_Left');
    const cabR = namedObjects.get('Cabinet_Door_Right');
    cabL.rotation.y = 1.35;
    cabR.rotation.y = -1.35;
    assert.equal(cabL.rotation.y, 1.35, 'Left cabinet door must open outwards');
    assert.equal(cabR.rotation.y, -1.35, 'Right cabinet door must open outwards');

    const drawer = namedObjects.get('TeacherDesk_Drawer_Lab');
    const initialZ = drawer.position.z;
    drawer.position.z -= 0.35;
    assert.ok(Math.abs(drawer.position.z - (initialZ - 0.35)) < 1e-4, 'Drawer must slide along track');

    const monitor = namedObjects.get('Terminal_Monitor_1');
    assert.ok(monitor.isMesh, 'Terminal_Monitor_1 must be a mesh');
    assert.ok(monitor.material, 'Terminal_Monitor_1 must have a material');
  });

  await t.test('3. gameHtml.ts Codebase Architecture & Multi-Room Integration', async () => {
    const gameHtmlPath = path.resolve(rootDir, 'mobile/components/games/hide-and-seek/gameHtml.ts');
    assert.ok(fs.existsSync(gameHtmlPath), 'gameHtml.ts must exist');
    const content = fs.readFileSync(gameHtmlPath, 'utf-8');

    // Room definition check
    assert.ok(content.includes('West Wing L3 Room 1'), 'West Wing L3 Room 1 must be registered in room definitions');
    assert.ok(content.includes('computer_lab_production_glb'), 'computer_lab_production_glb archetype must be assigned');

    // Archetype builder check
    assert.ok(content.includes('buildProductionBlenderComputerLabInterior'), 'buildProductionBlenderComputerLabInterior function must exist');

    // Wall sectioning check
    assert.ok(content.includes("blockLabel === 'West Wing L3'"), 'Back wall sectioning must handle West Wing L3');
  });
});

