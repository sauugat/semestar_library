/**
 * Stage 5 Automated Three.js GLB Validation Test.
 * Loads the exported classroom_production.glb in Three.js environment,
 * inspects scene graph, materials, geometry, bounding boxes, and validates
 * articulated sub-meshes (door, drawer, switchboard, fans).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const glbPath = path.resolve(__dirname, 'output/classroom_production.glb');

console.log('=' .repeat(60));
console.log('  STAGE 5: THREE.JS ISOLATED GLB LOADER VERIFICATION');
console.log('='.repeat(60));

if (!fs.existsSync(glbPath)) {
  console.error(`[-] ERROR: GLB file not found at ${glbPath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(glbPath);
console.log(`[+] Read GLB file: ${glbPath}`);
console.log(`    File Size: ${fileBuffer.byteLength.toLocaleString()} bytes (${(fileBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB)`);

// Polyfill window / self / URL if needed for GLTFLoader
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

const loader = new GLTFLoader();
const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

console.log('[+] Parsing GLB with Three.js GLTFLoader...');

loader.parse(
  arrayBuffer,
  '',
  (gltf) => {
    console.log('[+] GLTF parsing successful!');
    const scene = gltf.scene;

    let meshCount = 0;
    let vertexCount = 0;
    let triangleCount = 0;
    const materialSet = new Set();
    const namedObjects = new Map();

    scene.traverse((obj) => {
      if (obj.name) {
        namedObjects.set(obj.name, obj);
      }
      if (obj.isMesh) {
        meshCount++;
        const geo = obj.geometry;
        if (geo.attributes.position) {
          vertexCount += geo.attributes.position.count;
        }
        if (geo.index) {
          triangleCount += geo.index.count / 3;
        } else if (geo.attributes.position) {
          triangleCount += geo.attributes.position.count / 3;
        }

        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => materialSet.add(m.name || m.uuid));
        } else if (obj.material) {
          materialSet.add(obj.material.name || obj.material.uuid);
        }
      }
    });

    console.log('\n--- Model Structure & Geometry Statistics ---');
    console.log(`Total Meshes:      ${meshCount}`);
    console.log(`Total Vertices:    ${vertexCount.toLocaleString()}`);
    console.log(`Total Triangles:   ${Math.round(triangleCount).toLocaleString()}`);
    console.log(`Unique Materials:  ${materialSet.size}`);

    // Compute scene bounding box
    const bbox = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    console.log('\n--- World-Space Bounding Box ---');
    console.log(`Min:    (${bbox.min.x.toFixed(2)}, ${bbox.min.y.toFixed(2)}, ${bbox.min.z.toFixed(2)})`);
    console.log(`Max:    (${bbox.max.x.toFixed(2)}, ${bbox.max.y.toFixed(2)}, ${bbox.max.z.toFixed(2)})`);
    console.log(`Size:   ${size.x.toFixed(2)}m (width) x ${size.y.toFixed(2)}m (height) x ${size.z.toFixed(2)}m (depth)`);
    console.log(`Center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

    // Verify room scale
    if (size.x < 7.0 || size.x > 9.0) {
      console.error(`[-] FAIL: Unexpected classroom width: ${size.x.toFixed(2)}m (expected ~7.6-8.0m)`);
      process.exit(1);
    }
    if (size.y < 3.0 || size.y > 4.0) {
      console.error(`[-] FAIL: Unexpected classroom height: ${size.y.toFixed(2)}m (expected ~3.35-3.6m)`);
      process.exit(1);
    }
    if (size.z < 7.0 || size.z > 9.0) {
      console.error(`[-] FAIL: Unexpected classroom depth: ${size.z.toFixed(2)}m (expected ~7.6-8.0m)`);
      process.exit(1);
    }
    console.log('[+] Dimension scale and orientation verified!');

    // Verify critical interactive objects
    console.log('\n--- Verifying Interactive Sub-Meshes in Hierarchy ---');
    const requiredInteractive = [
      'Door_Leaf_Classroom',
      'TeacherDesk_Drawer',
      'Switchboard_Door',
      'CeilingFan_Hub_1',
      'CeilingFan_Hub_2',
      'Item_Brass_Key',
    ];

    let missing = 0;
    for (const name of requiredInteractive) {
      const obj = namedObjects.get(name);
      if (obj) {
        console.log(`  [OK] Found '${name}' (${obj.type}) at local pos: (${obj.position.x.toFixed(3)}, ${obj.position.y.toFixed(3)}, ${obj.position.z.toFixed(3)})`);
      } else {
        console.error(`  [-] MISSING: '${name}'`);
        missing++;
      }
    }

    if (missing > 0) {
      console.error(`[-] FAIL: ${missing} required interactive objects are missing.`);
      process.exit(1);
    }

    // Verify Articulation Animation in Three.js
    console.log('\n--- Simulating Articulation Transforms in Three.js ---');
    const doorLeaf = namedObjects.get('Door_Leaf_Classroom');
    const initialDoorRotY = doorLeaf.rotation.y;
    doorLeaf.rotation.y += Math.PI * 0.5; // Swing door open 90 degrees
    doorLeaf.updateMatrixWorld(true);
    console.log(`  [OK] Door swing transform simulated: rotY from ${initialDoorRotY.toFixed(2)} to ${doorLeaf.rotation.y.toFixed(2)} rad`);

    const drawer = namedObjects.get('TeacherDesk_Drawer');
    const initialDrawerZ = drawer.position.z;
    drawer.position.z -= 0.35; // Slide drawer out 35cm
    drawer.updateMatrixWorld(true);
    console.log(`  [OK] Drawer slide transform simulated: posZ from ${initialDrawerZ.toFixed(2)} to ${drawer.position.z.toFixed(2)}m`);

    const fan1 = namedObjects.get('CeilingFan_Hub_1');
    fan1.rotation.y += Math.PI * 0.25;
    fan1.updateMatrixWorld(true);
    console.log(`  [OK] Ceiling Fan 1 rotation simulated: rotY = ${fan1.rotation.y.toFixed(2)} rad`);

    console.log('\n>>> STAGE 5 THREE.JS VALIDATION PASSED COMPLETELY <<<\n');
  },
  (err) => {
    console.error('[-] ERROR parsing GLTF:', err);
    process.exit(1);
  }
);
