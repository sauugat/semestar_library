import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const htmlPath = path.resolve(rootDir, 'public/hide-and-seek-in-game.html');
const base64TsPath = path.resolve(rootDir, 'mobile/components/games/hide-and-seek/computerLabGlbBase64.ts');

const base64File = fs.readFileSync(base64TsPath, 'utf-8');
const match = base64File.match(/export const COMPUTER_LAB_GLB_DATA_URI = "([^"]+)";/);
if (!match) {
  console.error('[-] Could not extract COMPUTER_LAB_GLB_DATA_URI from', base64TsPath);
  process.exit(1);
}
const labDataUri = match[1];

let html = fs.readFileSync(htmlPath, 'utf-8');

// 1. Inject window.COMPUTER_LAB_GLB_DATA_URI
if (!html.includes('window.COMPUTER_LAB_GLB_DATA_URI')) {
  const target = 'window.CLASSROOM_GLB_DATA_URI = "data:model/gltf-binary;base64,';
  const idx = html.indexOf(target);
  if (idx !== -1) {
    const endSemi = html.indexOf('";', idx);
    if (endSemi !== -1) {
      const insertPos = endSemi + 2;
      const injection = `\n    window.COMPUTER_LAB_GLB_DATA_URI = "${labDataUri}";`;
      html = html.slice(0, insertPos) + injection + html.slice(insertPos);
      console.log('[+] Injected window.COMPUTER_LAB_GLB_DATA_URI into public/hide-and-seek-in-game.html');
    }
  }
} else {
  // Update existing
  const target = 'window.COMPUTER_LAB_GLB_DATA_URI = "';
  const idx = html.indexOf(target);
  if (idx !== -1) {
    const endSemi = html.indexOf('";', idx);
    html = html.slice(0, idx + target.length) + labDataUri + html.slice(endSemi);
    console.log('[+] Updated window.COMPUTER_LAB_GLB_DATA_URI in public/hide-and-seek-in-game.html');
  }
}

// 2. Inject buildProductionBlenderComputerLabInterior
if (!html.includes('function buildProductionBlenderComputerLabInterior')) {
  const target = "cGroup.userData.hasBlenderProductionMesh = true;\n            },\n            undefined,\n            function (err) {\n              console.warn('[Hide & Seek] Production GLB load fallback to procedural geometry:', err);\n            }\n          );\n        } catch (e) {\n          console.warn('[Hide & Seek] GLB loader error:', e);\n        }\n      }\n    }\n    function buildComputerLabInterior";
  
  // Extract buildProductionBlenderComputerLabInterior from gameHtml.ts
  const gameHtml = fs.readFileSync(path.resolve(rootDir, 'mobile/components/games/hide-and-seek/gameHtml.ts'), 'utf-8');
  const labFnStart = gameHtml.indexOf('    function buildProductionBlenderComputerLabInterior');
  const labFnEnd = gameHtml.indexOf('    function buildComputerLabInterior', labFnStart);
  const labFnCode = gameHtml.slice(labFnStart, labFnEnd);

  const replacement = "cGroup.userData.hasBlenderProductionMesh = true;\n            },\n            undefined,\n            function (err) {\n              console.warn('[Hide & Seek] Production GLB load fallback to procedural geometry:', err);\n            }\n          );\n        } catch (e) {\n          console.warn('[Hide & Seek] GLB loader error:', e);\n        }\n      }\n    }\n\n" + labFnCode + "    function buildComputerLabInterior";

  html = html.replace(target, replacement);
  console.log('[+] Injected buildProductionBlenderComputerLabInterior');
}

// 3. Update 'West Wing L3 Room 1' in ROOM_DEFINITIONS
const rDefTarget = "'West Wing L3 Room 1': {\n        id: 'West Wing L3 Room 1', building: 'L3', archetype: 'library', lightMood: 'warm_lamp',\n        bounds: { minX: -21.3, maxX: -13.7, minZ: 9.0, maxZ: 20.0, floorY: 0.18, ceilingY: 3.56 },\n        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'curtains'],\n        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],\n        waypoints: [{ id: 'wp-l3-r1-door', x: -13.4, y: 0.18, z: 14.5, kind: 'door' }, { id: 'wp-l3-r1-in', x: -17.2, y: 0.18, z: 13.4, kind: 'interior' }],\n      },";
const rDefReplace = "'West Wing L3 Room 1': {\n        id: 'West Wing L3 Room 1', building: 'L3', archetype: 'computer_lab_production_glb', lightMood: 'dying_tube',\n        bounds: { minX: -20.5, maxX: -11.5, minZ: 14.0, maxZ: 22.0, floorY: 1.62, ceilingY: 5.17 },\n        furniture: ['computer_workstations_2x2', 'electronics_benches_x2', 'equipment_cabinet', 'server_rack', 'teacher_desk'],\n        hidingSpots: ['cabinet_interior', 'under_workbench', 'behind_server_rack'],\n        waypoints: [{ id: 'wp-l3-r1-door', x: -16.0, y: 1.62, z: 13.8, kind: 'door' }, { id: 'wp-l3-r1-in', x: -16.0, y: 1.62, z: 17.5, kind: 'interior' }],\n      },";
if (html.includes(rDefTarget)) {
  html = html.replace(rDefTarget, rDefReplace);
  console.log("[+] Updated 'West Wing L3 Room 1' in ROOM_DEFINITIONS");
}

// 4. Update ROOM_ARCHETYPE_BUILDERS
const archTarget = "const ROOM_ARCHETYPE_BUILDERS = {\n      classroom_production_glb: (cGroup, cx, cz, fy, dirZ, title, isNewari) => buildProductionBlenderClassroomInterior(cGroup, cx, cz, fy, dirZ, title),";
const archReplace = "const ROOM_ARCHETYPE_BUILDERS = {\n      classroom_production_glb: (cGroup, cx, cz, fy, dirZ, title, isNewari) => buildProductionBlenderClassroomInterior(cGroup, cx, cz, fy, dirZ, title),\n      computer_lab_production_glb: (cGroup, cx, cz, fy, dirZ, title, isNewari) => buildProductionBlenderComputerLabInterior(cGroup, cx, cz, fy, dirZ, title),";
if (html.includes(archTarget)) {
  html = html.replace(archTarget, archReplace);
  console.log('[+] Updated ROOM_ARCHETYPE_BUILDERS');
}

// 5. Update isProductionGlb
const prodGlbTarget = "const isProductionGlb = (roomDef.archetype === 'classroom_production_glb');";
const prodGlbReplace = "const isProductionGlb = (roomDef.archetype === 'classroom_production_glb' || roomDef.archetype === 'computer_lab_production_glb');";
if (html.includes(prodGlbTarget)) {
  html = html.replace(prodGlbTarget, prodGlbReplace);
  console.log('[+] Updated isProductionGlb');
}

// 6. Update buildEnterableClassroomWing back wall & window sectioning
const wallTarget = `      const backZ = cz - doorSide * (depth / 2);
      if (blockLabel === 'Building B6 Classrooms') {
        // Rooms 2 and 3 retain normal procedural back wall
        const r23Width = width - roomW;
        const r23CenterX = (cx - width / 2 + roomW) + r23Width / 2;
        buildWallSegment(r23CenterX, floorH, backZ, r23Width, wallH, wallT, materials.campusStucco);

        // Flanking wall segments outside the 8m GLB classroom section (GLB bounds: [-20.53, -12.53])
        const leftW = (-20.53) - (cx - width / 2);
        if (leftW > 0.1) {
          buildWallSegment(cx - width / 2 + leftW / 2, floorH, backZ, leftW, wallH, wallT, materials.campusStucco);
        }
        const rightW = (cx - width / 2 + roomW) - (-12.53);
        if (rightW > 0.1) {
          buildWallSegment(-12.53 + rightW / 2, floorH, backZ, rightW, wallH, wallT, materials.campusStucco);
        }
      } else {
        buildWallSegment(cx, floorH, backZ, width, wallH, wallT, materials.campusStucco);
      }`;

const wallReplace = `      const backZ = cz - doorSide * (depth / 2);
      if (blockLabel === 'Building B6 Classrooms') {
        // Rooms 2 and 3 retain normal procedural back wall
        const r23Width = width - roomW;
        const r23CenterX = (cx - width / 2 + roomW) + r23Width / 2;
        buildWallSegment(r23CenterX, floorH, backZ, r23Width, wallH, wallT, materials.campusStucco);

        // Flanking wall segments outside the 8m GLB classroom section (GLB bounds: [-20.53, -12.53])
        const leftW = (-20.53) - (cx - width / 2);
        if (leftW > 0.1) {
          buildWallSegment(cx - width / 2 + leftW / 2, floorH, backZ, leftW, wallH, wallT, materials.campusStucco);
        }
        const rightW = (cx - width / 2 + roomW) - (-12.53);
        if (rightW > 0.1) {
          buildWallSegment(-12.53 + rightW / 2, floorH, backZ, rightW, wallH, wallT, materials.campusStucco);
        }
      } else if (blockLabel === 'West Wing L3') {
        // Rooms 2 and 3 retain normal procedural back wall
        const r23Width = width - roomW;
        const r23CenterX = (cx - width / 2 + roomW) + r23Width / 2;
        buildWallSegment(r23CenterX, floorH, backZ, r23Width, wallH, wallT, materials.campusStucco);

        // Room 1 GLB lab section: bounds along X are [-20.0, -12.0] (center -16.0, span 8.0m)
        const leftW = (-20.0) - (cx - width / 2);
        if (leftW > 0.1) {
          buildWallSegment(cx - width / 2 + leftW / 2, floorH, backZ, leftW, wallH, wallT, materials.campusStucco);
        }
        const rightW = (cx - width / 2 + roomW) - (-12.0);
        if (rightW > 0.1) {
          buildWallSegment(-12.0 + rightW / 2, floorH, backZ, rightW, wallH, wallT, materials.campusStucco);
        }
      } else {
        buildWallSegment(cx, floorH, backZ, width, wallH, wallT, materials.campusStucco);
      }`;

if (html.includes(wallTarget)) {
  html = html.replace(wallTarget, wallReplace);
  console.log('[+] Updated back wall sectioning in buildEnterableClassroomWing');
}

const winTarget = "if (blockLabel === 'Building B6 Classrooms' && wx < cx - width / 2 + roomW) continue;";
const winReplace = "if ((blockLabel === 'Building B6 Classrooms' || blockLabel === 'West Wing L3') && wx < cx - width / 2 + roomW) continue;";
if (html.includes(winTarget)) {
  html = html.replace(winTarget, winReplace);
  console.log('[+] Updated window skipping in buildEnterableClassroomWing');
}

const isGlbRoomTarget = "const isGlbRoom = (blockLabel === 'Building B6 Classrooms' && roomIdx === 0);";
const isGlbRoomReplace = "const isGlbRoom = (blockLabel === 'Building B6 Classrooms' && roomIdx === 0) || (blockLabel === 'West Wing L3' && roomIdx === 0);";
if (html.includes(isGlbRoomTarget)) {
  html = html.replace(isGlbRoomTarget, isGlbRoomReplace);
  console.log('[+] Updated isGlbRoom in buildEnterableClassroomWing');
}

fs.writeFileSync(htmlPath, html, 'utf-8');
console.log(`[+] Saved updated HTML to ${htmlPath}`);

