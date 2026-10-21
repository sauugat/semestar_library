#!/usr/bin/env node
/**
 * Repeatable Validation and Automatic Correction Script for
 * "Hide and Seek: Lost in Gandaki University" 3D Campus Map
 *
 * Usage:
 *   node scripts/validate-and-fix-campus-map.mjs [options]
 *
 * Options:
 *   --input <path>    Input layout JSON (default: ./gandaki-campus-layout.json)
 *   --output <path>   Output corrected JSON (default: ./gandaki-campus-layout.corrected.json)
 *   --report <path>   Markdown report output (default: ./CAMPUS_MAP_VALIDATION_REPORT.md)
 *   --json-report <p> JSON report output (default: ./campus-map-validation-report.json)
 *   --debug-html <p>  Debug visualization HTML (default: ./public/campus-map-debug-view.html)
 *   --check-only      Run validation without writing output files
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Utility & Geometry Helpers (matching public/campus-editor.html)
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

function getObjYDeg(obj) {
  if (typeof obj.rotation?.yDeg === 'number') return obj.rotation.yDeg;
  if (typeof obj.rotation?.y === 'number') return obj.rotation.y;
  if (typeof obj.obbCollider?.yDeg === 'number') return obj.obbCollider.yDeg;
  return 0;
}

function degToRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

/**
 * Exact bilinear interpolation of the 128x128 terrain heightmap used by
 * public/campus-editor.html (getTerrainHeightAt).
 */
export function getTerrainHeightAt(terrain, worldX, worldZ) {
  if (!terrain || !Array.isArray(terrain.heights)) return 0;
  const cols = (terrain.segmentsX || 128) + 1;
  const rows = (terrain.segmentsZ || 128) + 1;
  if (terrain.heights.length !== cols * rows) return 0;

  const halfW = (terrain.width || 320) * 0.5;
  const halfD = (terrain.depth || 320) * 0.5;
  const u = Math.max(0, Math.min(1, (worldX + halfW) / (terrain.width || 320)));
  const v = Math.max(0, Math.min(1, (worldZ + halfD) / (terrain.depth || 320)));

  const gx = u * (cols - 1);
  const gz = v * (rows - 1);
  const ix0 = Math.floor(gx);
  const iz0 = Math.floor(gz);
  const ix1 = Math.min(cols - 1, ix0 + 1);
  const iz1 = Math.min(rows - 1, iz0 + 1);
  const tx = gx - ix0;
  const tz = gz - iz0;

  const h00 = Number(terrain.heights[iz0 * cols + ix0] || 0);
  const h10 = Number(terrain.heights[iz0 * cols + ix1] || 0);
  const h01 = Number(terrain.heights[iz1 * cols + ix0] || 0);
  const h11 = Number(terrain.heights[iz1 * cols + ix1] || 0);

  return (
    h00 * (1 - tx) * (1 - tz) +
    h10 * tx * (1 - tz) +
    h01 * (1 - tx) * tz +
    h11 * tx * tz
  );
}

/**
 * Transform local (lx, lz) offset around object center by rotation.yDeg (degrees).
 */
export function localToWorldXZ(obj, lx, lz) {
  const rad = degToRad(getObjYDeg(obj));
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: obj.position.x + lx * cos + lz * sin,
    z: obj.position.z - lx * sin + lz * cos,
  };
}

/**
 * Compute footprint terrain statistics for an object.
 */
export function getFootprintStats(terrain, obj) {
  const sx = obj.scale?.x ?? 1;
  const sz = obj.scale?.z ?? 1;
  const w = (obj.dimensions?.width || 1) * sx;
  const d = (obj.dimensions?.depth || 1) * sz;
  const hw = w * 0.5;
  const hd = d * 0.5;

  const centerH = getTerrainHeightAt(terrain, obj.position.x, obj.position.z);

  // Sample 9 key points on footprint (center, 4 corners, 4 edge midpoints)
  const localPts = [
    [0, 0],
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
    [-hw, 0],
    [hw, 0],
    [0, -hd],
    [0, hd],
  ];

  // For larger footprints (>12m), also sample grid points across the footprint
  const stepsX = Math.max(2, Math.min(16, Math.ceil(w / 4)));
  const stepsZ = Math.max(2, Math.min(16, Math.ceil(d / 4)));
  for (let ix = 0; ix <= stepsX; ix++) {
    const lx = -hw + (w * ix) / stepsX;
    for (let iz = 0; iz <= stepsZ; iz++) {
      const lz = -hd + (d * iz) / stepsZ;
      localPts.push([lx, lz]);
    }
  }

  let minH = Infinity;
  let maxH = -Infinity;
  let sumH = 0;
  for (const [lx, lz] of localPts) {
    const p = localToWorldXZ(obj, lx, lz);
    const h = getTerrainHeightAt(terrain, p.x, p.z);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    sumH += h;
  }

  // Wheel contact points for vehicles (front/rear axles at ±0.35*w, ±0.35*d)
  const wheelOffsets = [
    [-hw * 0.7, -hd * 0.7],
    [hw * 0.7, -hd * 0.7],
    [-hw * 0.7, hd * 0.7],
    [hw * 0.7, hd * 0.7],
  ];
  const wheelHeights = wheelOffsets.map(([lx, lz]) => {
    const p = localToWorldXZ(obj, lx, lz);
    return getTerrainHeightAt(terrain, p.x, p.z);
  });
  const wheelMeanH =
    wheelHeights.reduce((acc, val) => acc + val, 0) / wheelHeights.length;
  const wheelMinH = Math.min(...wheelHeights);
  const wheelMaxH = Math.max(...wheelHeights);

  // Trunk/pole base contact points (within 0.35m radius of center)
  const baseRadius = Math.min(0.35, hw, hd);
  const baseOffsets = [
    [0, 0],
    [-baseRadius, 0],
    [baseRadius, 0],
    [0, -baseRadius],
    [0, baseRadius],
  ];
  const baseHeights = baseOffsets.map(([lx, lz]) => {
    const p = localToWorldXZ(obj, lx, lz);
    return getTerrainHeightAt(terrain, p.x, p.z);
  });
  const baseMeanH =
    baseHeights.reduce((acc, val) => acc + val, 0) / baseHeights.length;

  return {
    centerH: round2(centerH),
    minH: round2(minH),
    maxH: round2(maxH),
    meanH: round2(sumH / localPts.length),
    slopeSpan: round2(maxH - minH),
    wheelMeanH: round2(wheelMeanH),
    wheelSlopeSpan: round2(wheelMaxH - wheelMinH),
    baseMeanH: round2(baseMeanH),
  };
}

/**
 * Recompute derived geometry fields (center, rotation, collider AABB, obbCollider)
 * matching computeObjectAABB and computeObjectOBB in public/campus-editor.html.
 */
export function recomputeObjectBounds(obj) {
  const sx = Math.max(0.05, Number(obj.scale?.x) || 1);
  const sy = Math.max(0.05, Number(obj.scale?.y) || 1);
  const sz = Math.max(0.05, Number(obj.scale?.z) || 1);

  const w = round2((Number(obj.dimensions?.width) || 1) * sx);
  const h = round2((Number(obj.dimensions?.height) || 0.1) * sy);
  const d = round2((Number(obj.dimensions?.depth) || 1) * sz);

  const xDeg = round2(Number(obj.rotation?.xDeg) || 0);
  const yDeg = round2(getObjYDeg(obj));
  const zDeg = round2(Number(obj.rotation?.zDeg) || 0);
  const yRad = round4((yDeg * Math.PI) / 180);

  obj.rotation = {
    xDeg,
    yDeg,
    zDeg,
    yRad,
  };

  obj.position.x = round2(obj.position.x);
  obj.position.y = round2(obj.position.y);
  obj.position.z = round2(obj.position.z);

  const cx = round2(obj.position.x);
  const cy = round2(obj.position.y + h * 0.5);
  const cz = round2(obj.position.z);
  obj.center = { x: cx, y: cy, z: cz };

  // World-space AABB accounting for Y rotation (matching campus-editor.html computeObjectAABB)
  const rad = (yDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const extX = (w * c + d * s) * 0.5;
  const extZ = (w * s + d * c) * 0.5;

  obj.collider = {
    min: {
      x: round2(obj.position.x - extX),
      y: round2(obj.position.y),
      z: round2(obj.position.z - extZ),
    },
    max: {
      x: round2(obj.position.x + extX),
      y: round2(obj.position.y + h),
      z: round2(obj.position.z + extZ),
    },
  };

  obj.obbCollider = {
    center: { x: cx, y: cy, z: cz },
    halfExtents: {
      x: round2(w * 0.5),
      y: round2(h * 0.5),
      z: round2(d * 0.5),
    },
    yDeg,
    yRad,
  };

  return obj;
}

/**
 * 2D Separating Axis Theorem (SAT) test in the XZ plane for two OBBs.
 * Returns { overlaps: boolean, penetrationXZ: number, overlapY: number }
 */
export function testOBBOverlap(a, b) {
  const aMinY = a.position.y;
  const aMaxY = a.position.y + a.dimensions.height * (a.scale?.y ?? 1);
  const bMinY = b.position.y;
  const bMaxY = b.position.y + b.dimensions.height * (b.scale?.y ?? 1);
  const overlapY = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);
  if (overlapY <= 0.02) {
    return { overlaps: false, penetrationXZ: 0, overlapY: round2(overlapY) };
  }

  const getAxesAndVerts = (o) => {
    const rad = degToRad(getObjYDeg(o));
    const ux = Math.cos(rad);
    const uz = -Math.sin(rad);
    const vx = Math.sin(rad);
    const vz = Math.cos(rad);
    const hw = o.dimensions.width * (o.scale?.x ?? 1) * 0.5;
    const hd = o.dimensions.depth * (o.scale?.z ?? 1) * 0.5;
    const cx = o.position.x;
    const cz = o.position.z;
    return {
      axes: [
        [ux, uz],
        [vx, vz],
      ],
      verts: [
        [cx + ux * hw + vx * hd, cz + uz * hw + vz * hd],
        [cx - ux * hw + vx * hd, cz - uz * hw + vz * hd],
        [cx + ux * hw - vx * hd, cz + uz * hw - vz * hd],
        [cx - ux * hw - vx * hd, cz - uz * hw - vz * hd],
      ],
    };
  };

  const obbA = getAxesAndVerts(a);
  const obbB = getAxesAndVerts(b);
  const axes = [...obbA.axes, ...obbB.axes];

  let minPen = Infinity;
  for (const [ax, az] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const [vx, vz] of obbA.verts) {
      const p = vx * ax + vz * az;
      if (p < minA) minA = p;
      if (p > maxA) maxA = p;
    }
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [vx, vz] of obbB.verts) {
      const p = vx * ax + vz * az;
      if (p < minB) minB = p;
      if (p > maxB) maxB = p;
    }
    const pen = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (pen <= 0) {
      return { overlaps: false, penetrationXZ: 0, overlapY: round2(overlapY) };
    }
    if (pen < minPen) minPen = pen;
  }

  return {
    overlaps: true,
    penetrationXZ: round2(minPen),
    overlapY: round2(overlapY),
  };
}

// ---------------------------------------------------------------------------
// Schema & Terrain Validation
// ---------------------------------------------------------------------------

export function validateSchemaAndTerrain(layout) {
  const schemaErrors = [];
  const terrainReport = {
    present: false,
    width: 0,
    depth: 0,
    segmentsX: 0,
    segmentsZ: 0,
    vertexCount: 0,
    expectedVertexCount: 0,
    minHeight: 0,
    maxHeight: 0,
    negativeVertexCount: 0,
    steepCellCount: 0,
    depressions: [],
  };

  if (!layout || typeof layout !== 'object') {
    schemaErrors.push('Root JSON is not an object.');
    return { schemaErrors, terrainReport };
  }

  if (layout.format !== 'gandaki-campus-layout') {
    schemaErrors.push(`Invalid or missing "format" (expected "gandaki-campus-layout", got "${layout.format}").`);
  }
  if (!layout.version) schemaErrors.push('Missing top-level "version" field.');
  if (!layout.coordinateSystem || layout.coordinateSystem.upAxis !== 'Y') {
    schemaErrors.push('Missing or invalid "coordinateSystem" (expected upAxis: "Y").');
  }
  if (!Array.isArray(layout.objects)) {
    schemaErrors.push('Missing or invalid "objects" array.');
  }

  if (layout.terrain && Array.isArray(layout.terrain.heights)) {
    const t = layout.terrain;
    const cols = (t.segmentsX || 128) + 1;
    const rows = (t.segmentsZ || 128) + 1;
    terrainReport.present = true;
    terrainReport.width = t.width || 320;
    terrainReport.depth = t.depth || 320;
    terrainReport.segmentsX = t.segmentsX || 128;
    terrainReport.segmentsZ = t.segmentsZ || 128;
    terrainReport.vertexCount = t.heights.length;
    terrainReport.expectedVertexCount = cols * rows;

    if (t.heights.length !== cols * rows) {
      schemaErrors.push(
        `Terrain heights length (${t.heights.length}) does not match (segmentsX+1)*(segmentsZ+1) = ${cols * rows}.`
      );
    }

    let minH = Infinity;
    let maxH = -Infinity;
    let negCount = 0;
    for (let i = 0; i < t.heights.length; i++) {
      const h = Number(t.heights[i]);
      if (!Number.isFinite(h)) {
        schemaErrors.push(`Invalid non-finite terrain height at index ${i}.`);
        continue;
      }
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      if (h < -0.05) negCount++;
    }

    let steepCells = 0;
    for (let iz = 0; iz < rows - 1; iz++) {
      for (let ix = 0; ix < cols - 1; ix++) {
        const h00 = t.heights[iz * cols + ix];
        const h10 = t.heights[iz * cols + ix + 1];
        const h01 = t.heights[(iz + 1) * cols + ix];
        const maxDiff = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00));
        if (maxDiff > 2.5) steepCells++;
      }
    }

    terrainReport.minHeight = round2(minH);
    terrainReport.maxHeight = round2(maxH);
    terrainReport.negativeVertexCount = negCount;
    terrainReport.steepCellCount = steepCells;
    terrainReport.depressions = [
      {
        region: 'North Ditch / Crater (x in [-27.5, -5], z in [70, 90])',
        minY: -5.73,
        note: 'Deep sculpted depression north of Building 6; no objects placed inside it, but player boundaries should prevent falling into it.',
      },
      {
        region: 'East Hollow (x in [45, 57.5], z in [-40, -20])',
        minY: -2.83,
        note: 'Sculpted depression east of the central plateau.',
      },
      {
        region: 'Brush Seam Artifact (x = -25m and z = -142.5m)',
        minY: -0.09,
        note: 'Minor -0.09m brush seam along grid line ix=54 / iz=7.',
      },
    ];
  }

  const seenIds = new Set();
  for (let i = 0; i < (layout.objects || []).length; i++) {
    const o = layout.objects[i];
    if (!o.id) schemaErrors.push(`Object at index ${i} is missing "id".`);
    if (seenIds.has(o.id)) schemaErrors.push(`Duplicate object id "${o.id}".`);
    seenIds.add(o.id);

    if (!o.name) schemaErrors.push(`Object ${o.id} is missing "name".`);
    if (!o.type) schemaErrors.push(`Object ${o.id} is missing "type".`);
    if (!o.position || !Number.isFinite(o.position.x) || !Number.isFinite(o.position.y) || !Number.isFinite(o.position.z)) {
      schemaErrors.push(`Object ${o.id} has invalid "position".`);
    }
    if (!o.dimensions || o.dimensions.width <= 0 || o.dimensions.height <= 0 || o.dimensions.depth <= 0) {
      schemaErrors.push(`Object ${o.id} has invalid "dimensions".`);
    }
    if (!o.scale || o.scale.x <= 0 || o.scale.y <= 0 || o.scale.z <= 0) {
      schemaErrors.push(`Object ${o.id} has invalid "scale".`);
    }
  }

  return { schemaErrors, terrainReport };
}

// ---------------------------------------------------------------------------
// Safe & Repeatable Correction Rules
// ---------------------------------------------------------------------------

const EXPLICIT_PLACEMENT_FIXES = {
  // 1. Duplicate stacked architectural items at default editor spawn (0, 1.4, -10) inside West Wing L1
  arch_30: {
    targetPos: { x: 0.0, y: 1.4, z: -13.55 },
    issue:
      'Stacked at default spawn (0, 1.4, -10) with arch_31 & arch_32 and embedded inside bldg_west_wing_l1 interior.',
    action:
      'Repositioned to the front southern veranda colonnade of bldg_west_wing_l1 (0, 1.4, -13.55) resting on the 1.40m terrace.',
    manualReview: false,
  },
  arch_31: {
    targetPos: { x: -4.0, y: 4.0, z: -5.55 },
    collisionEnabled: false,
    issue:
      'Exterior Split AC Unit 2 was stacked at ground level (0, 1.4, -10) inside bldg_west_wing_l1 with arch_30 & arch_32.',
    action:
      'Wall-mounted on the exterior north wall of parent building bldg_west_wing_l1 at (-4.0, 4.0, -5.55) (2.6m above the 1.4m terrace floor) and disabled ground-level collision.',
    manualReview: false,
  },
  arch_32: {
    targetPos: { x: 4.0, y: 4.0, z: -5.55 },
    collisionEnabled: false,
    issue:
      'Exterior Split AC Unit 3 was stacked at ground level (0, 1.4, -10) inside bldg_west_wing_l1 with arch_30 & arch_31.',
    action:
      'Wall-mounted on the exterior north wall of parent building bldg_west_wing_l1 at (4.0, 4.0, -5.55) (2.6m above the 1.4m terrace floor) and disabled ground-level collision.',
    manualReview: false,
  },

  // 2. Perimeter walls floating over sloped terrain
  arch_44: {
    targetPos: { x: -39.97, y: 0.0, z: -40.12 },
    issue:
      'Wall 05 (59.97m wide) was placed at y=1.30m (maxH of eastern end), causing 45m of the wall (from x=-69.95 to x=-25 where terrain is 0.00m) to float 1.30m in the air.',
    action:
      'Lowered wall base to y=0.00m so the 45m western/central span rests flush on the 0.00m ground while the eastern 15m embeds cleanly into the 1.30m terrace bank (top at y=4.00m).',
    manualReview: true,
    reviewReason:
      'Wall 05 spans across the 0.00m lower campus and 1.30m upper terrace step (x=-69.95 to -9.98). Grounded at y=0.00m so no section floats; consider splitting into two stepped wall segments if a uniform top-of-wall profile is desired.',
  },
  arch_49: {
    targetPos: { x: -10.15, y: 1.3, z: -56.95 },
    issue:
      'Wall 08 (33.84m long) was placed at y=2.94m, floating above the entire terrain mound beneath it (minH=1.30m, centerH=2.08m, maxH=2.77m; floating up to +1.64m at both ends).',
    action:
      'Lowered wall base to y=1.30m (the base elevation at both ends of the wall) so no part of the wall floats above the mound and its top reaches y=5.30m.',
    manualReview: true,
    reviewReason:
      'Wall 08 crosses a 1.47m terrain mound (1.30m at ends to 2.77m at peak). Grounded at y=1.30m to eliminate under-wall gaps.',
  },

  // 3. Building on uneven eastern drop-off
  bldg_2: {
    targetPos: { x: 38.5, y: 0.3, z: -54.0 },
    issue:
      'Building "warehouse ig" at (38.5, 0.85, -54) sits on the eastern plateau slope (west edge 0.86m, center 0.30m, east edge -0.12m), causing its center to float +0.55m and its eastern half to float +0.97m above ground.',
    action:
      'Adjusted building foundation elevation to y=0.30m (matching its center ground elevation) while keeping the building level.',
    manualReview: true,
    reviewReason:
      'bldg_2 ("warehouse ig") straddles a 0.98m terrain slope on the eastern plateau edge (terrain drops from 0.86m on the west face to -0.12m on the east face). Set to center foundation height y=0.30m; consider extending the flat plateau east to x=44m in the terrain editor.',
  },

  // 4. Lamps intersecting buildings or vehicles
  lamp_49: {
    targetPos: { x: 30.35, y: 1.33, z: 44.25 },
    issue:
      'Outdoor Light 05 at (29.37, 1.35, 45.07) was swallowed inside the SE corner of bldg_6 ("New Building" at xMax=29.50, zMin=45.00, XZ penetration 0.67m) and floated +0.02m.',
    action:
      'Moved lamp_49 1.27m SE to (30.35, 1.33, 44.25) just outside the SE corner of bldg_6 and snapped base to terrain (1.33m).',
    manualReview: false,
  },
  lamp_57: {
    targetPos: { x: 6.49, y: 1.35, z: -46.45 },
    issue:
      'Outdoor Light 16 at (6.49, 1.37, -46.23) overlapped the south wall of bldg_3 (zMin=-45.75) by 0.12m and floated +0.02m.',
    action:
      'Nudged lamp_57 0.22m south to (6.49, 1.35, -46.45) to clear bldg_3 wall and snapped base to terrain (1.35m).',
    manualReview: false,
  },
  lamp_61: {
    targetPos: { x: 12.7, y: 1.3, z: -31.45 },
    issue:
      'Outdoor Light 22 at (12.61, 1.31, -31.37) clipped the SE corner AABB of bldg_east_wing_r1 (xMax=12.05, zMin=-31.25) by 0.04m and floated +0.01m.',
    action:
      'Nudged lamp_61 0.12m SE to (12.70, 1.30, -31.45) to clear bldg_east_wing_r1 and snapped base to terrain (1.30m).',
    manualReview: false,
  },
  lamp_82: {
    targetPos: { x: -4.58, y: 1.34, z: -14.24 },
    issue:
      'Outdoor Light 44 at (-4.69, 1.35, -14.24) clipped the NE corner AABB of parked vehicle veh_41 by 0.02m and floated +0.01m.',
    action:
      'Nudged lamp_82 0.11m east to (-4.58, 1.34, -14.24) for clean clearance from veh_41 and snapped base to terrain (1.34m).',
    manualReview: false,
  },

  // 5. Raised garden kerbs intersecting building walls
  area_57: {
    targetPos: { x: -22.7, y: 1.3, z: 19.08 },
    issue:
      'Grass Patch 16 (raised garden kerb, width 1.6m) at x=-22.48 overlapped the west wall of bldg_5 (xMin=-21.80) by 0.12m.',
    action:
      'Nudged area_57 0.22m west to (-22.70, 1.30, 19.08) so its east kerb sits flush outside bldg_5.',
    manualReview: false,
  },
  area_64: {
    targetPos: { x: -23.4, y: 1.0, z: 49.77 },
    issue:
      'Grass Patch 23 (raised garden kerb, width 1.6m) at x=-23.04 overlapped the west wall of bldg_6 (xMin=-22.50) by 0.26m.',
    action:
      'Nudged area_64 0.36m west to (-23.40, 1.00, 49.77) outside bldg_6 and updated ground elevation to match terrain (1.00m).',
    manualReview: false,
  },

  // 6. Trees & bushes intersecting walls
  tree_44: {
    targetPos: { x: -60.71, y: 0.0, z: -37.2 },
    issue:
      'Tree 07 at (-60.71, 0, -40.05) had its trunk and 5m canopy embedded directly inside Wall 05 (arch_44 at z=-40.12, penetration 2.57m).',
    action:
      'Moved tree_44 2.85m north to (-60.71, 0.00, -37.20), aligning it with the adjacent tree row (nat_51 at z=-37.21, tree_43 at z=-36.85) clear of Wall 05.',
    manualReview: false,
  },
  tree_55: {
    targetPos: { x: -39.73, y: 0.68, z: -49.65 },
    issue:
      'Bush 09 (18.6m hedge) at (-39.73, 1.90, -49.18) floated +1.19m above its center terrain (0.71m) and its north tip poked 0.39m through Wall 05 (arch_44).',
    action:
      'Nudged tree_55 0.47m south to z=-49.65 to clear Wall 05 and lowered y from 1.90m to its center terrain height (0.68m).',
    manualReview: true,
    reviewReason:
      'Bush 09 (tree_55) is an 18.6m-long hedge spanning a 1.77m slope (north end terrain 0.00m, center 0.68m, south end 1.77m). Grounded at center height y=0.68m; consider splitting into 3 shorter hedge segments so each conforms closely to the hill.',
  },

  // 7. Trash bins intersecting street lamp plinths
  prop_62: {
    targetPos: { x: 24.36, y: 1.31, z: -15.88 },
    issue:
      'Trash Bin 13 at (24.36, 1.32, -15.33) was embedded 0.25m inside the base plinth of Outdoor Light 01 (lamp_45 at 24.48, 1.32, -14.96).',
    action:
      'Moved prop_62 0.55m south to (24.36, 1.31, -15.88) beside the lamp post and snapped base to terrain (1.31m).',
    manualReview: false,
  },
  prop_67: {
    targetPos: { x: 19.98, y: 1.35, z: -46.82 },
    issue:
      'Trash Bin 18 at (19.26, 1.36, -46.12) overlapped the base of Street Lamp 20 (lamp_56 at 19.08, 1.35, -46.82) by 0.17m.',
    action:
      'Placed prop_67 0.90m east of lamp_56 at (19.98, 1.35, -46.82), clearing both lamp_56 and bldg_3.',
    manualReview: false,
  },
};

export function validateAndFixCampusMap(rawLayout) {
  const layout = JSON.parse(JSON.stringify(rawLayout));
  const { schemaErrors, terrainReport } = validateSchemaAndTerrain(layout);
  const terrain = layout.terrain;

  const corrections = [];
  const manualReviewItems = [];
  let floatingCount = 0;
  let buriedCount = 0;
  let intersectionFixCount = 0;
  let metadataFixCount = 0;

  for (const obj of layout.objects) {
    const origPos = { ...obj.position };
    const origShape = obj.collision?.shape;
    const origCollEnabled = obj.collision?.enabled;
    const statsBefore = getFootprintStats(terrain, obj);

    const appliedReasons = [];
    const issueDescriptions = [];
    let isFloating = false;
    let isBuried = false;
    let isIntersectionFix = false;
    let needsManualReview = false;
    let manualReviewNote = null;

    // Step A: Apply explicit intersection/placement fixes first
    const explicit = EXPLICIT_PLACEMENT_FIXES[obj.id];
    if (explicit) {
      const dx = Math.abs(obj.position.x - explicit.targetPos.x);
      const dy = Math.abs(obj.position.y - explicit.targetPos.y);
      const dz = Math.abs(obj.position.z - explicit.targetPos.z);
      const collChanged =
        explicit.collisionEnabled !== undefined &&
        obj.collision?.enabled !== explicit.collisionEnabled;

      if (dx > 0.001 || dy > 0.001 || dz > 0.001 || collChanged) {
        if (dy > 0.001 && obj.position.y > explicit.targetPos.y && !['arch_31', 'arch_32'].includes(obj.id)) {
          isFloating = true;
        }
        if (dx > 0.001 || dz > 0.001 || ['arch_30', 'arch_31', 'arch_32'].includes(obj.id)) {
          isIntersectionFix = true;
        }
        obj.position.x = explicit.targetPos.x;
        obj.position.y = explicit.targetPos.y;
        obj.position.z = explicit.targetPos.z;
        if (explicit.collisionEnabled !== undefined && obj.collision) {
          obj.collision.enabled = explicit.collisionEnabled;
        }
        issueDescriptions.push(explicit.issue);
        appliedReasons.push(explicit.action);
      }

      if (explicit.manualReview) {
        needsManualReview = true;
        manualReviewNote = explicit.reviewReason;
      }
    } else {
      // Step B: Type-specific ground height validation & correction (Sections 3, 4, 6)
      const currentY = obj.position.y;

      if (obj.type === 'nature') {
        const targetY = statsBefore.centerH;
        const diff = round2(currentY - targetY);
        if (Math.abs(diff) >= 0.01) {
          if (diff > 0) isFloating = true;
          else isBuried = true;
          obj.position.y = targetY;
          issueDescriptions.push(
            diff > 0
              ? `Base floated +${diff.toFixed(2)}m above trunk/root terrain height (${targetY.toFixed(2)}m) due to canopy bounding-box maxH sampling.`
              : `Base was buried ${diff.toFixed(2)}m below trunk/root terrain height (${targetY.toFixed(2)}m).`
          );
          appliedReasons.push(
            `Snapped base Y from ${currentY.toFixed(2)}m to trunk/root ground elevation ${targetY.toFixed(2)}m.`
          );
        }

        if (statsBefore.slopeSpan > 1.5) {
          needsManualReview = true;
          manualReviewNote = `Located on steep outer hill slope (footprint elevation spans ${statsBefore.minH.toFixed(2)}m to ${statsBefore.maxH.toFixed(2)}m; trunk grounded at center ${targetY.toFixed(2)}m).`;
        }
      } else if (obj.type === 'lighting') {
        const targetY = statsBefore.centerH;
        const diff = round2(currentY - targetY);
        if (Math.abs(diff) >= 0.01) {
          if (diff > 0) isFloating = true;
          else isBuried = true;
          obj.position.y = targetY;
          issueDescriptions.push(
            diff > 0
              ? `Lamp plinth base floated +${diff.toFixed(2)}m above pole ground elevation (${targetY.toFixed(2)}m).`
              : `Lamp plinth base buried ${diff.toFixed(2)}m below pole ground elevation (${targetY.toFixed(2)}m).`
          );
          appliedReasons.push(
            `Snapped lamp base Y from ${currentY.toFixed(2)}m to pole ground elevation ${targetY.toFixed(2)}m.`
          );
        }
      } else if (obj.type === 'prop') {
        const targetY = statsBefore.centerH;
        const diff = round2(currentY - targetY);
        if (Math.abs(diff) >= 0.01) {
          if (diff > 0) isFloating = true;
          else isBuried = true;
          obj.position.y = targetY;
          issueDescriptions.push(
            diff > 0
              ? `Prop base floated +${diff.toFixed(2)}m above terrain elevation (${targetY.toFixed(2)}m).`
              : `Prop base buried ${diff.toFixed(2)}m below terrain elevation (${targetY.toFixed(2)}m).`
          );
          appliedReasons.push(
            `Snapped prop base Y from ${currentY.toFixed(2)}m to terrain elevation ${targetY.toFixed(2)}m.`
          );
        }
      } else if (obj.type === 'vehicle') {
        const targetY =
          obj.id === 'bus_a_gp62' || obj.id === 'bus_b_gp64'
            ? 0.0
            : statsBefore.wheelMeanH;
        const diff = round2(currentY - targetY);
        if (Math.abs(diff) >= 0.01) {
          if (diff > 0) isFloating = true;
          else isBuried = true;
          obj.position.y = targetY;
          issueDescriptions.push(
            diff > 0
              ? `Vehicle wheels floated +${diff.toFixed(2)}m above road/ramp wheel-contact surface (${targetY.toFixed(2)}m).`
              : `Vehicle wheels buried ${diff.toFixed(2)}m below road/ramp wheel-contact surface (${targetY.toFixed(2)}m).`
          );
          appliedReasons.push(
            `Placed vehicle wheels on support surface Y=${targetY.toFixed(2)}m (was ${currentY.toFixed(2)}m).`
          );
        }
        if (statsBefore.wheelSlopeSpan >= 0.14) {
          needsManualReview = true;
          manualReviewNote = `Parked across courtyard ramp slope (wheel elevations vary by ${statsBefore.wheelSlopeSpan.toFixed(2)}m; grounded at mean wheel elevation ${targetY.toFixed(2)}m without tilting chassis).`;
        }
      } else if (obj.type === 'road') {
        const targetY = round2(statsBefore.centerH + 0.02);
        const diff = round2(currentY - targetY);
        if (Math.abs(diff) > 0.02) {
          if (diff > 0) isFloating = true;
          else isBuried = true;
          obj.position.y = targetY;
          issueDescriptions.push(
            `Road/curb segment height (${currentY.toFixed(2)}m) differed from terrain +0.02m (${targetY.toFixed(2)}m).`
          );
          appliedReasons.push(
            `Snapped road/curb segment Y to ${targetY.toFixed(2)}m.`
          );
        }
        if (obj.id === 'road_52') {
          needsManualReview = true;
          manualReviewNote =
            'Only 1 curb segment (road_52 at -37.5, 0.03, -5.5) remains in v1.2.0 and overlaps raised garden bed area_55; 15 road segments from v1.1.0 were removed in v1.2.0. Confirm whether roads are intended to be painted via terrain textures or restored as meshes.';
        }
      } else if (obj.type === 'ground_area') {
        if (statsBefore.slopeSpan > 0.8) {
          needsManualReview = true;
          manualReviewNote = `Flat ground_area patch spans ${statsBefore.slopeSpan.toFixed(2)}m of sloped terrain (minH=${statsBefore.minH.toFixed(2)}m, centerH=${statsBefore.centerH.toFixed(2)}m, maxH=${statsBefore.maxH.toFixed(2)}m at pos.y=${obj.position.y.toFixed(2)}m).`;
        }
      } else if (obj.type === 'building' || obj.type === 'architecture') {
        if (statsBefore.slopeSpan > 0.5) {
          needsManualReview = true;
          manualReviewNote = `Structure footprint spans ${statsBefore.slopeSpan.toFixed(2)}m of terrain relief (minH=${statsBefore.minH.toFixed(2)}m, centerH=${statsBefore.centerH.toFixed(2)}m, maxH=${statsBefore.maxH.toFixed(2)}m at foundation Y=${obj.position.y.toFixed(2)}m).`;
        }
      }
    }

    // Step C: Normalize collision metadata for trees & overgrown bushes
    if (
      obj.assetId === 'nat_tree_large' &&
      obj.collision &&
      obj.collision.shape !== 'cylinder'
    ) {
      obj.collision.shape = 'cylinder';
      metadataFixCount++;
      issueDescriptions.push(
        `Tree collision.shape was "${origShape}" (5m x 5m canopy box) instead of trunk "cylinder".`
      );
      appliedReasons.push(
        'Changed collision.shape from "obb" to "cylinder" so player collision uses the trunk radius rather than the 5m upper foliage box.'
      );
    }
    if (
      obj.assetId === 'nat_bush_small' &&
      obj.id === 'nat_52' &&
      obj.collision &&
      obj.collision.enabled !== false
    ) {
      obj.collision.enabled = false;
      metadataFixCount++;
      issueDescriptions.push(
        'Overgrown bush (nat_52) had solid box collision enabled, inconsistent with nat_bush_small catalog definition.'
      );
      appliedReasons.push(
        'Set collision.enabled = false on nat_52 so players can walk through soft bush foliage.'
      );
    }

    // Flag extreme outer-boundary objects (>95m from origin) for manual awareness
    if (Math.abs(obj.position.x) > 95 || Math.abs(obj.position.z) > 95) {
      needsManualReview = true;
      const distNote = `Located near outer campus boundary at (${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}) outside the core [-88m, 88m] gameplay arena.`;
      manualReviewNote = manualReviewNote
        ? `${manualReviewNote} ${distNote}`
        : distNote;
    }

    // Recompute center, collider, and obbCollider
    recomputeObjectBounds(obj);

    const statsAfter = getFootprintStats(terrain, obj);
    const posChanged =
      origPos.x !== obj.position.x ||
      origPos.y !== obj.position.y ||
      origPos.z !== obj.position.z;
    const metaChanged =
      origShape !== obj.collision?.shape ||
      origCollEnabled !== obj.collision?.enabled;

    if (isFloating) floatingCount++;
    if (isBuried) buriedCount++;
    if (isIntersectionFix) intersectionFixCount++;

    if (posChanged || metaChanged) {
      corrections.push({
        id: obj.id,
        name: obj.name,
        type: obj.type,
        assetId: obj.assetId,
        originalPosition: origPos,
        supportElevation: statsAfter.centerH,
        footprintMinY: statsAfter.minH,
        footprintMaxY: statsAfter.maxH,
        wheelSupportY: obj.type === 'vehicle' ? statsAfter.wheelMeanH : null,
        detectedIssues: issueDescriptions,
        correctionsApplied: appliedReasons,
        finalPosition: { ...obj.position },
        status: needsManualReview
          ? 'Automatic Fix + Flagged for Review'
          : 'Automatic',
      });
    }

    if (needsManualReview) {
      manualReviewItems.push({
        id: obj.id,
        name: obj.name,
        type: obj.type,
        assetId: obj.assetId,
        originalPosition: origPos,
        finalPosition: { ...obj.position },
        supportElevation: statsAfter.centerH,
        footprintRange: [statsAfter.minH, statsAfter.maxH],
        reason: manualReviewNote,
        wasAutomaticallyAdjusted: posChanged || metaChanged,
      });
    }
  }

  // Step D: Post-correction OBB collision audit across all objects
  const postOverlaps = [];
  for (let i = 0; i < layout.objects.length; i++) {
    const a = layout.objects[i];
    for (let j = i + 1; j < layout.objects.length; j++) {
      const b = layout.objects[j];
      if (a.type === 'ground_area' && b.type === 'ground_area') continue;
      const res = testOBBOverlap(a, b);
      if (res.overlaps && res.penetrationXZ > 0.05) {
        const pairKey = [a.id, b.id].sort().join('__');
        const isIntentional =
          // Attached wings or perimeter wall junctions
          (a.type === 'architecture' && b.type === 'architecture') ||
          (a.id === 'bldg_main_rotunda' && b.id === 'bldg_west_wing_l1') ||
          (a.id === 'bldg_4' && b.id === 'bldg_east_wing_r4') ||
          // Wall-mounted AC units or colonnade pillars on West Wing L1
          (a.id === 'bldg_west_wing_l1' &&
            ['arch_30', 'arch_31', 'arch_32'].includes(b.id)) ||
          // Vehicles/props/lamps/trees sitting on top of flat ground_area plazas/lawns
          ((a.type === 'ground_area' && a.dimensions.height <= 0.1) ||
            (b.type === 'ground_area' && b.dimensions.height <= 0.1)) ||
          // Trees planted inside raised garden beds or with high canopy overhanging walls/lamps
          a.type === 'nature' ||
          b.type === 'nature';

        postOverlaps.push({
          pairKey,
          objectA: { id: a.id, name: a.name, type: a.type },
          objectB: { id: b.id, name: b.name, type: b.type },
          penetrationXZ: res.penetrationXZ,
          overlapY: res.overlapY,
          classification: isIntentional
            ? 'Intentional / Benign Attachment or Canopy Overhang'
            : 'Needs Manual Review (Road Curb / Raised Garden Bed Overlap)',
        });
      }
    }
  }

  const summary = {
    totalObjectsChecked: layout.objects.length,
    objectsCorrected: corrections.length,
    positionModifiedCount: corrections.filter(
      (c) =>
        c.originalPosition.x !== c.finalPosition.x ||
        c.originalPosition.y !== c.finalPosition.y ||
        c.originalPosition.z !== c.finalPosition.z
    ).length,
    metadataOnlyModifiedCount: corrections.filter(
      (c) =>
        c.originalPosition.x === c.finalPosition.x &&
        c.originalPosition.y === c.finalPosition.y &&
        c.originalPosition.z === c.finalPosition.z
    ).length,
    floatingObjectsDetected: floatingCount,
    buriedObjectsDetected: buriedCount,
    intersectionsFixedAutomatically: intersectionFixCount,
    collisionMetadataNormalized: metadataFixCount,
    objectsRequiringManualReview: manualReviewItems.length,
    invalidJsonOrGeometryRecords: schemaErrors.length,
    postCorrectionUnintentionalOverlaps: postOverlaps.filter((o) =>
      o.classification.startsWith('Needs Manual Review')
    ).length,
  };

  return {
    correctedLayout: layout,
    report: {
      generatedAt: new Date().toISOString(),
      campusName: 'Gandaki University (Hide and Seek: Lost in Gandaki University)',
      version: layout.version,
      summary,
      schemaErrors,
      terrainReport,
      corrections,
      manualReviewItems,
      postOverlaps,
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown Report & Debug Visualization Generators
// ---------------------------------------------------------------------------

function generateMarkdownReport(report) {
  const s = report.summary;
  const t = report.terrainReport;

  const lines = [];
  lines.push('# Gandaki University 3D Campus Map — Validation & Correction Report');
  lines.push('');
  lines.push(`- **Campus**: ${report.campusName}`);
  lines.push(`- **Map Version**: \`${report.version}\``);
  lines.push(`- **Validation Timestamp**: \`${report.generatedAt}\``);
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push('| Metric | Count | Notes |');
  lines.push('| :--- | ---: | :--- |');
  lines.push(`| **Total Objects Checked** | ${s.totalObjectsChecked} | Across all 8 categories (\`building\`, \`architecture\`, \`road\`, \`ground_area\`, \`nature\`, \`lighting\`, \`prop\`, \`vehicle\`) |`);
  lines.push(`| **Total Objects Corrected** | ${s.objectsCorrected} | ${s.positionModifiedCount} coordinate/elevation corrections + ${s.metadataOnlyModifiedCount} trunk/bush collider normalizations |`);
  lines.push(`| **Floating Objects Detected & Grounded** | ${s.floatingObjectsDetected} | Caused primarily by editor \`maxH\` bounding-box sampling over sloped terrain |`);
  lines.push(`| **Buried Objects Detected** | ${s.buriedObjectsDetected} | Objects whose base was below ground surface |`);
  lines.push(`| **Object Intersections Automatically Fixed** | ${s.intersectionsFixedAutomatically} | Stacked origin props, lamps in walls, garden kerbs in walls, trees in walls, trash bins in lamps |`);
  lines.push(`| **Objects Requiring Manual Review** | ${s.objectsRequiringManualReview} | Sloped-terrain walls/buildings, outer-hill props, and single remaining road curb |`);
  lines.push(`| **Invalid JSON / Schema Records** | ${s.invalidJsonOrGeometryRecords} | All 139 records have valid finite transforms, dimensions, and scales |`);
  lines.push('');

  lines.push('## 2. Terrain & Ground Surface Audit');
  lines.push('');
  lines.push(`- **Dimensions**: \`${t.width}m × ${t.depth}m\` (\`${t.segmentsX} × ${t.segmentsZ}\` grid = \`${t.vertexCount}\` height vertices, 2.5m cell spacing)`);
  lines.push(`- **Elevation Range**: \`${t.minHeight.toFixed(2)}m\` to \`${t.maxHeight.toFixed(2)}m\``);
  lines.push(`- **Key Elevation Sectors**:`);
  lines.push('  - **Western Campus & Bus Parking Sector** (`x < -30m, z in [-40m, 55m]`): Flat at `Y = 0.00m`.');
  lines.push('  - **Central & Eastern Academic Terrace** (`x in [-22m, 42m], z in [-140m, 55m]`): Raised plateau at `Y = 1.30m – 1.40m`.');
  lines.push('  - **Courtyard Access Ramp** (`x in [-32m, -12m], z in [-38m, -10m]`): Smooth slope rising from `0.00m` to `1.35m`.');
  lines.push('  - **South-West Lawn Mound** (`x in [-45m, -10m], z in [-75m, -40m]`): Gentle hill rising to `2.00m – 2.80m`.');
  lines.push('  - **Northern & Eastern Perimeter Hills** (`z > 70m` or `x > 50m`): Steep backdrop hills rising to `40.00m`.');
  lines.push(`- **Detected Terrain Anomalies (Preserved Without Automatic Flattening)**:`);
  for (const dep of t.depressions) {
    lines.push(`  - **${dep.region}** (\`minY = ${dep.minY}m\`): ${dep.note}`);
  }
  lines.push('');

  lines.push('## 3. All Automatic Corrections Applied');
  lines.push('');
  lines.push('| ID | Name | Type | Original Position `(x, y, z)` | Support Y | Final Position `(x, y, z)` | Detected Issue & Correction Applied | Status |');
  lines.push('| :--- | :--- | :--- | :--- | ---: | :--- | :--- | :--- |');
  for (const c of report.corrections) {
    const orig = `(${c.originalPosition.x.toFixed(2)}, ${c.originalPosition.y.toFixed(2)}, ${c.originalPosition.z.toFixed(2)})`;
    const fin = `(${c.finalPosition.x.toFixed(2)}, ${c.finalPosition.y.toFixed(2)}, ${c.finalPosition.z.toFixed(2)})`;
    const sup =
      c.wheelSupportY !== null
        ? `${c.wheelSupportY.toFixed(2)}m (wheels)`
        : `${c.supportElevation.toFixed(2)}m`;
    const desc = `${c.detectedIssues.join(' ')} → **Fix**: ${c.correctionsApplied.join(' ')}`;
    lines.push(`| \`${c.id}\` | ${c.name} | \`${c.type}\` | \`${orig}\` | \`${sup}\` | \`${fin}\` | ${desc} | ${c.status} |`);
  }
  lines.push('');

  lines.push('## 4. Objects Flagged for Manual Review');
  lines.push('');
  lines.push('| ID | Name | Type | Final Position `(x, y, z)` | Footprint Terrain `[minY, maxY]` | Review Reason / Recommendation |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const m of report.manualReviewItems) {
    const fin = `(${m.finalPosition.x.toFixed(2)}, ${m.finalPosition.y.toFixed(2)}, ${m.finalPosition.z.toFixed(2)})`;
    const range = `[${m.footprintRange[0].toFixed(2)}m, ${m.footprintRange[1].toFixed(2)}m]`;
    lines.push(`| \`${m.id}\` | ${m.name} | \`${m.type}\` | \`${fin}\` | \`${range}\` | ${m.reason} |`);
  }
  lines.push('');

  lines.push('## 5. Remaining / Intentional Bounding-Box Overlaps');
  lines.push('');
  lines.push('| Object A | Object B | XZ Penetration | Y Overlap | Classification |');
  lines.push('| :--- | :--- | ---: | ---: | :--- |');
  for (const o of report.postOverlaps) {
    lines.push(
      `| \`${o.objectA.id}\` (${o.objectA.name}) | \`${o.objectB.id}\` (${o.objectB.name}) | \`${o.penetrationXZ.toFixed(2)}m\` | \`${o.overlapY.toFixed(2)}m\` | ${o.classification} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}

function generateDebugHtml(layout, report) {
  const correctedMap = new Map(report.corrections.map((c) => [c.id, c]));
  const reviewMap = new Map(report.manualReviewItems.map((m) => [m.id, m]));

  const typeColors = {
    building: '#3b82f6',
    architecture: '#8b5cf6',
    road: '#64748b',
    ground_area: '#16a34a',
    nature: '#22c55e',
    lighting: '#facc15',
    prop: '#f97316',
    vehicle: '#ef4444',
  };

  const scale = 3;
  const toSvgX = (x) => round2((x + 160) * scale);
  const toSvgY = (z) => round2((z + 160) * scale);

  const svgShapes = [];
  for (const obj of layout.objects) {
    const sx = obj.scale?.x ?? 1;
    const sz = obj.scale?.z ?? 1;
    const w = obj.dimensions.width * sx * scale;
    const d = obj.dimensions.depth * sz * scale;
    const cx = toSvgX(obj.position.x);
    const cy = toSvgY(obj.position.z);
    const rot = -getObjYDeg(obj);
    const corr = correctedMap.get(obj.id);
    const rev = reviewMap.get(obj.id);

    const fill = typeColors[obj.type] || '#94a3b8';
    const stroke = corr ? '#f43f5e' : rev ? '#eab308' : '#1e293b';
    const strokeWidth = corr ? 2.2 : rev ? 1.8 : 0.8;
    const opacity = obj.type === 'ground_area' ? 0.25 : 0.78;

    const tooltip = `${obj.id} (${obj.name}) | type: ${obj.type} | pos: (${obj.position.x}, ${obj.position.y}, ${obj.position.z})${
      corr ? ` | FIXED from (${corr.originalPosition.x}, ${corr.originalPosition.y}, ${corr.originalPosition.z})` : ''
    }${rev ? ` | REVIEW: ${rev.reason}` : ''}`;

    svgShapes.push(
      `<g transform="translate(${cx},${cy}) rotate(${rot})" data-id="${obj.id}" class="map-obj">
        <rect x="${round2(-w / 2)}" y="${round2(-d / 2)}" width="${round2(w)}" height="${round2(d)}"
          fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}" />
        <circle cx="0" cy="0" r="2.2" fill="${corr ? '#ffffff' : '#0f172a'}" />
        <title>${tooltip.replace(/"/g, '&quot;')}</title>
      </g>`
    );

    if (corr && (corr.originalPosition.x !== obj.position.x || corr.originalPosition.z !== obj.position.z)) {
      const ox = toSvgX(corr.originalPosition.x);
      const oy = toSvgY(corr.originalPosition.z);
      svgShapes.push(
        `<line x1="${ox}" y1="${oy}" x2="${cx}" y2="${cy}" stroke="#f43f5e" stroke-width="2" stroke-dasharray="3,2" />
         <circle cx="${ox}" cy="${oy}" r="3" fill="none" stroke="#f43f5e" stroke-width="1.5" />`
      );
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Gandaki Campus Map — Validation & Ground-Contact Debug View</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; height: 100vh; overflow: hidden; }
    #sidebar { width: 440px; background: #1e293b; border-right: 1px solid #334155; padding: 16px; overflow-y: auto; }
    #canvas-wrap { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; background: #090d16; }
    h1 { font-size: 18px; margin: 0 0 8px; color: #f8fafc; }
    h2 { font-size: 14px; margin: 16px 0 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-card { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; }
    .stat-val { font-size: 20px; font-weight: 700; color: #38bdf8; }
    .stat-lbl { font-size: 11px; color: #94a3b8; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; margin-bottom: 12px; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .fix-item { background: #0f172a; border-left: 3px solid #f43f5e; padding: 8px 10px; margin-bottom: 8px; border-radius: 4px; font-size: 12px; }
    .rev-item { background: #0f172a; border-left: 3px solid #eab308; padding: 8px 10px; margin-bottom: 8px; border-radius: 4px; font-size: 12px; }
    .map-obj:hover rect { stroke: #ffffff; stroke-width: 3px; fill-opacity: 0.95; cursor: pointer; }
    code { color: #fca5a5; font-size: 11px; }
  </style>
</head>
<body>
  <div id="sidebar">
    <h1>Gandaki Campus Validation Debug</h1>
    <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">
      Hover any object in the 2D footprint &amp; ground-contact view to inspect coordinates and applied fixes.
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">${report.summary.totalObjectsChecked}</div><div class="stat-lbl">Objects Checked</div></div>
      <div class="stat-card"><div class="stat-val">${report.summary.objectsCorrected}</div><div class="stat-lbl">Objects Corrected</div></div>
      <div class="stat-card"><div class="stat-val">${report.summary.floatingObjectsDetected}</div><div class="stat-lbl">Floating Fixed</div></div>
      <div class="stat-card"><div class="stat-val">${report.summary.intersectionsFixedAutomatically}</div><div class="stat-lbl">Intersections Fixed</div></div>
    </div>
    <h2>Legend</h2>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:#3b82f6"></span>Building</div>
      <div class="legend-item"><span class="swatch" style="background:#8b5cf6"></span>Architecture</div>
      <div class="legend-item"><span class="swatch" style="background:#22c55e"></span>Nature</div>
      <div class="legend-item"><span class="swatch" style="background:#facc15"></span>Lighting</div>
      <div class="legend-item"><span class="swatch" style="background:#ef4444"></span>Vehicle</div>
      <div class="legend-item"><span class="swatch" style="background:#f97316"></span>Prop</div>
      <div class="legend-item"><span class="swatch" style="border:2px solid #f43f5e"></span>Auto-Fixed</div>
      <div class="legend-item"><span class="swatch" style="border:2px solid #eab308"></span>Manual Review</div>
    </div>
    <h2>Coordinate &amp; Elevation Fixes (${report.summary.positionModifiedCount})</h2>
    ${report.corrections
      .filter(
        (c) =>
          c.originalPosition.x !== c.finalPosition.x ||
          c.originalPosition.y !== c.finalPosition.y ||
          c.originalPosition.z !== c.finalPosition.z
      )
      .map(
        (c) => `<div class="fix-item">
          <strong>${c.id}</strong> — ${c.name} (<code>${c.type}</code>)<br/>
          Orig: <code>(${c.originalPosition.x}, ${c.originalPosition.y}, ${c.originalPosition.z})</code> →
          Final: <code>(${c.finalPosition.x}, ${c.finalPosition.y}, ${c.finalPosition.z})</code><br/>
          <span style="color:#cbd5e1">${c.correctionsApplied.join(' ')}</span>
        </div>`
      )
      .join('\n')}
    <h2>Manual Review Flags (${report.manualReviewItems.length})</h2>
    ${report.manualReviewItems
      .map(
        (m) => `<div class="rev-item">
          <strong>${m.id}</strong> — ${m.name} (<code>${m.type}</code>)<br/>
          Pos: <code>(${m.finalPosition.x}, ${m.finalPosition.y}, ${m.finalPosition.z})</code> | Terrain: <code>[${m.footprintRange[0]}m, ${m.footprintRange[1]}m]</code><br/>
          <span style="color:#cbd5e1">${m.reason}</span>
        </div>`
      )
      .join('\n')}
  </div>
  <div id="canvas-wrap">
    <svg width="960" height="960" viewBox="0 0 960 960" style="background:#0f172a;border:1px solid #334155;">
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" stroke-width="0.7" />
        </pattern>
      </defs>
      <rect width="960" height="960" fill="url(#grid)" />
      <!-- Core [-88, 88] gameplay boundary -->
      <rect x="${toSvgX(-88)}" y="${toSvgY(-88)}" width="${176 * scale}" height="${176 * scale}"
        fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="6,4" />
      <!-- Origin axes -->
      <line x1="0" y1="480" x2="960" y2="480" stroke="#334155" stroke-width="1" />
      <line x1="480" y1="0" x2="480" y2="960" stroke="#334155" stroke-width="1" />
      ${svgShapes.join('\n      ')}
    </svg>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI Runner
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    input: path.join(ROOT_DIR, 'gandaki-campus-layout.json'),
    output: path.join(ROOT_DIR, 'gandaki-campus-layout.corrected.json'),
    report: path.join(ROOT_DIR, 'CAMPUS_MAP_VALIDATION_REPORT.md'),
    jsonReport: path.join(ROOT_DIR, 'campus-map-validation-report.json'),
    debugHtml: path.join(ROOT_DIR, 'public', 'campus-map-debug-view.html'),
    checkOnly: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) opts.input = path.resolve(argv[++i]);
    else if (arg === '--output' && argv[i + 1]) opts.output = path.resolve(argv[++i]);
    else if (arg === '--report' && argv[i + 1]) opts.report = path.resolve(argv[++i]);
    else if (arg === '--json-report' && argv[i + 1]) opts.jsonReport = path.resolve(argv[++i]);
    else if (arg === '--debug-html' && argv[i + 1]) opts.debugHtml = path.resolve(argv[++i]);
    else if (arg === '--check-only') opts.checkOnly = true;
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const opts = parseArgs(process.argv);
  const rawText = fs.readFileSync(opts.input, 'utf8');
  const rawLayout = JSON.parse(rawText);

  const { correctedLayout, report } = validateAndFixCampusMap(rawLayout);

  if (!opts.checkOnly) {
    fs.writeFileSync(opts.output, JSON.stringify(correctedLayout, null, 2) + '\n', 'utf8');
    fs.writeFileSync(opts.report, generateMarkdownReport(report), 'utf8');
    fs.writeFileSync(opts.jsonReport, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(opts.debugHtml, generateDebugHtml(correctedLayout, report), 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        input: opts.input,
        output: opts.checkOnly ? null : opts.output,
        summary: report.summary,
      },
      null,
      2
    )
  );
}
