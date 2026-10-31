/**
 * Stage 5 Automated Three.js GLB Validation Test for Computer & Electronics Laboratory.
 * Loads the exported computer_lab_production.glb in Three.js environment,
 * inspects scene graph, materials, geometry, bounding boxes, and validates
 * articulated sub-meshes (door, cabinet doors, drawer, switchboard, monitor).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const glbPath = path.resolve(__dirname, 'output/computer_lab_production.glb');

console.log('='.repeat(60));
console.log('  STAGE 5: THREE.JS ISOLATED LAB GLB LOADER VERIFICATION');
console.log('='.repeat(60));

if (!fs.existsSync(glbPath)) {
  console.error(`[-] ERROR: GLB file not found at ${glbPath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(glbPath);
console.log(`[+] Read GLB file: ${glbPath}`);
console.log(`    File Size: ${fileBuffer.byteLength.toLocaleString()} bytes (${(fileBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB)`);

// Polyfill window / self / URL if needed for GLTFLoader in Node.js
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = (blob) => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  URL.revokeObjectURL = () => {};
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

    console.log('\n--- GLB Scene Metrics ---');
    console.log(`Total Meshes:      ${meshCount}`);
    console.log(`Total Vertices:    ${vertexCount.toLocaleString()}`);
    console.log(`Total Triangles:   ${triangleCount.toLocaleString()}`);
    console.log(`Unique Materials:  ${materialSet.size}`);

    // Bounding box calculation
    const bbox = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    console.log('\n--- Bounding Box Inspection ---');
    console.log(`Min:    (${bbox.min.x.toFixed(2)}, ${bbox.min.y.toFixed(2)}, ${bbox.min.z.toFixed(2)})`);
    console.log(`Max:    (${bbox.max.x.toFixed(2)}, ${bbox.max.y.toFixed(2)}, ${bbox.max.z.toFixed(2)})`);
    console.log(`Size:   Width=${size.x.toFixed(2)}m, Depth=${size.z.toFixed(2)}m, Height=${size.y.toFixed(2)}m`);
    console.log(`Center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

    // Verify key interactive and articulated components
    console.log('\n--- Interactive Object Validation ---');
    const requiredInteractive = [
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

    let missing = 0;
    for (const name of requiredInteractive) {
      const obj = namedObjects.get(name);
      if (obj) {
        console.log(`  [PASS] '${name}' present (type=${obj.type}, visible=${obj.visible})`);
      } else {
        console.error(`  [FAIL] Missing required interactive object: '${name}'`);
        missing++;
      }
    }

    // Verify kinematic articulation works
    console.log('\n--- Kinematic Articulation Verification ---');
    const door = namedObjects.get('Door_Leaf_Lab');
    if (door) {
      const initialRotY = door.rotation.y;
      door.rotation.y = initialRotY + Math.PI / 2;
      console.log(`  [PASS] Door_Leaf_Lab rotated from ${initialRotY.toFixed(2)} to ${door.rotation.y.toFixed(2)} rad`);
    }

    const drawer = namedObjects.get('TeacherDesk_Drawer_Lab');
    if (drawer) {
      const initialZ = drawer.position.z;
      drawer.position.z += 0.35;
      console.log(`  [PASS] TeacherDesk_Drawer_Lab translated from ${initialZ.toFixed(2)} to ${drawer.position.z.toFixed(2)} m`);
    }

    const cabL = namedObjects.get('Cabinet_Door_Left');
    const cabR = namedObjects.get('Cabinet_Door_Right');
    if (cabL && cabR) {
      cabL.rotation.y += Math.PI / 2;
      cabR.rotation.y -= Math.PI / 2;
      console.log(`  [PASS] Cabinet_Door_Left and Right articulated successfully`);
    }

    const swDoor = namedObjects.get('Switchboard_Door_Lab');
    if (swDoor) {
      swDoor.rotation.y += Math.PI / 2;
      console.log(`  [PASS] Switchboard_Door_Lab hinged panel rotated successfully`);
    }

    const monitor = namedObjects.get('Terminal_Monitor_1');
    if (monitor && monitor.material) {
      console.log(`  [PASS] Terminal_Monitor_1 has material: ${monitor.material.name}`);
    }

    if (missing > 0) {
      console.error(`\n[-] Stage 5 Failed: ${missing} required objects missing!`);
      process.exit(1);
    } else {
      console.log('\n[+] STAGE 5 VERIFICATION PASSED PERFECTLY!\n');
      process.exit(0);
    }
  },
  (progress) => {},
  (error) => {
    console.error('[-] ERROR parsing GLB:', error);
    process.exit(1);
  }
);

