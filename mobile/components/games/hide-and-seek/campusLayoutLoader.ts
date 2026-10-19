/**
 * Standalone Three.js Loader & Validator for Gandaki University Campus Layout JSON
 * --------------------------------------------------------------------------------
 * Single source of truth for building positions, sizes, rotations and ground areas
 * from `/semester-library/gandaki-campus-layout.json` (format: "gandaki-campus-layout", v1.0.0).
 */

export interface CampusVec3 {
  x: number;
  y: number;
  z: number;
}

export const SUPPORTED_CAMPUS_OBJECT_TYPES = ['building', 'road', 'ground_area'] as const;
export type SupportedCampusObjectType = (typeof SUPPORTED_CAMPUS_OBJECT_TYPES)[number];

export interface CampusLayoutObject {
  id: string;
  name: string;
  type: SupportedCampusObjectType | string;
  /** Bottom-center ground position in meters (Y = base elevation, 0 = ground plane) */
  position: CampusVec3;
  /** Precomputed 3D mesh center (Y = position.y + dimensions.height / 2) */
  center?: CampusVec3;
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  rotation: {
    yDeg: number;
    yRad: number;
  };
  /** Precomputed world-space Axis-Aligned Bounding Box (AABB) for server/client colliders */
  collider?: {
    min: CampusVec3;
    max: CampusVec3;
  };
}

export interface CampusLayoutDocument {
  format?: string;
  version: string;
  exportedAt: string;
  coordinateSystem: {
    units?: 'meters' | string;
    upAxis?: 'Y' | string;
    groundY?: number;
    positionOrigin?: 'bottom-center' | string;
    axes?: Record<string, string>;
    [key: string]: any;
  };
  objects: CampusLayoutObject[];
}

export interface CampusLayoutOverlapReport {
  idA: string;
  nameA: string;
  typeA: string;
  idB: string;
  nameB: string;
  typeB: string;
  overlapX: number;
  overlapZ: number;
  kind: 'building-building' | 'building-surface' | 'surface-surface';
}

export interface CampusLayoutOutOfBoundsReport {
  id: string;
  name: string;
  type: string;
  min: CampusVec3;
  max: CampusVec3;
  bound: number;
}

export interface CampusLayoutUnsupportedTypeReport {
  id: string;
  name: string;
  type: string;
}

export interface CampusLayoutValidationResult {
  valid: boolean;
  objectCounts: Record<string, number>;
  overlaps: CampusLayoutOverlapReport[];
  outOfBounds: CampusLayoutOutOfBoundsReport[];
  unsupportedTypes: CampusLayoutUnsupportedTypeReport[];
}

export function computeObjectWorldAABB(obj: CampusLayoutObject): { min: CampusVec3; max: CampusVec3 } {
  if (obj.collider && obj.collider.min && obj.collider.max) {
    return {
      min: { ...obj.collider.min },
      max: { ...obj.collider.max },
    };
  }
  const rotRad = obj.rotation?.yRad ?? ((obj.rotation?.yDeg ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rotRad));
  const s = Math.abs(Math.sin(rotRad));
  const halfW = (obj.dimensions.width * c + obj.dimensions.depth * s) * 0.5;
  const halfD = (obj.dimensions.width * s + obj.dimensions.depth * c) * 0.5;
  return {
    min: {
      x: obj.position.x - halfW,
      y: obj.position.y,
      z: obj.position.z - halfD,
    },
    max: {
      x: obj.position.x + halfW,
      y: obj.position.y + obj.dimensions.height,
      z: obj.position.z + halfD,
    },
  };
}

/**
 * Validates a Gandaki campus layout JSON document, logging overlaps,
 * out-of-bounds objects, and unsupported object types.
 */
export function validateCampusLayout(
  layout: CampusLayoutDocument,
  options?: {
    mapBound?: number;
    logWarnings?: boolean;
    logger?: Pick<Console, 'warn' | 'info'>;
  }
): CampusLayoutValidationResult {
  const mapBound = options?.mapBound ?? 88.0;
  const logWarnings = options?.logWarnings ?? true;
  const logger = options?.logger ?? console;

  const objectCounts: Record<string, number> = { building: 0, road: 0, ground_area: 0 };
  const overlaps: CampusLayoutOverlapReport[] = [];
  const outOfBounds: CampusLayoutOutOfBoundsReport[] = [];
  const unsupportedTypes: CampusLayoutUnsupportedTypeReport[] = [];

  const objects = Array.isArray(layout?.objects) ? layout.objects : [];
  const aabbs = objects.map((obj) => ({ obj, aabb: computeObjectWorldAABB(obj) }));

  for (const { obj, aabb } of aabbs) {
    objectCounts[obj.type] = (objectCounts[obj.type] || 0) + 1;

    if (!(SUPPORTED_CAMPUS_OBJECT_TYPES as readonly string[]).includes(obj.type)) {
      unsupportedTypes.push({ id: obj.id, name: obj.name, type: String(obj.type) });
      if (logWarnings) {
        logger.warn(`[CampusLayoutValidator] Unsupported object type "${obj.type}" on ${obj.id} (${obj.name})`);
      }
    }

    if (
      aabb.min.x < -mapBound ||
      aabb.max.x > mapBound ||
      aabb.min.z < -mapBound ||
      aabb.max.z > mapBound
    ) {
      outOfBounds.push({
        id: obj.id,
        name: obj.name,
        type: obj.type,
        min: aabb.min,
        max: aabb.max,
        bound: mapBound,
      });
      if (logWarnings) {
        logger.warn(
          `[CampusLayoutValidator] Out-of-bounds object ${obj.id} (${obj.name}): x=[${aabb.min.x.toFixed(2)}, ${aabb.max.x.toFixed(2)}], z=[${aabb.min.z.toFixed(2)}, ${aabb.max.z.toFixed(2)}] exceeds +/-${mapBound}m`
        );
      }
    }
  }

  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i];
      const b = aabbs[j];
      const overlapX = Math.min(a.aabb.max.x, b.aabb.max.x) - Math.max(a.aabb.min.x, b.aabb.min.x);
      const overlapZ = Math.min(a.aabb.max.z, b.aabb.max.z) - Math.max(a.aabb.min.z, b.aabb.min.z);
      if (overlapX > 0.01 && overlapZ > 0.01) {
        const isA = a.obj.type === 'building';
        const isB = b.obj.type === 'building';
        const kind: CampusLayoutOverlapReport['kind'] =
          isA && isB ? 'building-building' : isA || isB ? 'building-surface' : 'surface-surface';
        overlaps.push({
          idA: a.obj.id,
          nameA: a.obj.name,
          typeA: a.obj.type,
          idB: b.obj.id,
          nameB: b.obj.name,
          typeB: b.obj.type,
          overlapX: Number(overlapX.toFixed(2)),
          overlapZ: Number(overlapZ.toFixed(2)),
          kind,
        });
        if (logWarnings) {
          logger.warn(
            `[CampusLayoutValidator] Overlap (${kind}): ${a.obj.id} <-> ${b.obj.id} (dx=${overlapX.toFixed(2)}m, dz=${overlapZ.toFixed(2)}m)`
          );
        }
      }
    }
  }

  const hasBuildingOverlap = overlaps.some((o) => o.kind === 'building-building');
  return {
    valid: unsupportedTypes.length === 0 && !hasBuildingOverlap,
    objectCounts,
    overlaps,
    outOfBounds,
    unsupportedTypes,
  };
}

/**
 * Instantiates Three.js meshes and registers colliders from an exported layout JSON.
 */
export function loadCampusLayoutIntoScene(
  THREE: any,
  scene: any,
  layout: CampusLayoutDocument,
  options?: {
    terraceHeight?: number;
    plinthHeight?: number;
    mapBound?: number;
    logValidation?: boolean;
    onRegisterColliderBox?: (min: CampusVec3, max: CampusVec3, obj: CampusLayoutObject) => void;
    onRegisterOBBCollider?: (
      cx: number,
      cz: number,
      halfW: number,
      halfD: number,
      rotYRad: number,
      minY: number,
      maxY: number,
      obj: CampusLayoutObject
    ) => void;
  }
) {
  const validation = validateCampusLayout(layout, {
    mapBound: options?.mapBound ?? 88.0,
    logWarnings: options?.logValidation ?? true,
  });

  const terraceHeight = options?.terraceHeight ?? 1.0;
  const plinthHeight = options?.plinthHeight ?? 0.25;

  const group = new THREE.Group();
  group.name = 'GandakiImportedCampusLayout';
  group.userData = { validation };

  const materials: Record<string, any> = {
    building: new THREE.MeshStandardMaterial({ color: 0x949ea8, roughness: 0.72, metalness: 0.08 }),
    road: new THREE.MeshStandardMaterial({ color: 0x333942, roughness: 0.88, metalness: 0.04 }),
    ground_area: new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.85, metalness: 0.04 }),
  };

  for (const obj of layout.objects || []) {
    if (!(SUPPORTED_CAMPUS_OBJECT_TYPES as readonly string[]).includes(obj.type)) {
      continue;
    }
    const { width, height, depth } = obj.dimensions;
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = materials[obj.type] || materials.building;
    const mesh = new THREE.Mesh(geo, mat);

    const isLowerGround = obj.id === 'area_16' || obj.position.x < -91.5;
    const baseElevation =
      obj.type === 'building'
        ? (isLowerGround ? 0 : terraceHeight) + plinthHeight
        : isLowerGround
        ? 0
        : terraceHeight;

    const baseY = obj.position.y + baseElevation;
    const centerY = baseY + height * 0.5;
    const rotYRad = obj.rotation?.yRad ?? (obj.rotation.yDeg * Math.PI) / 180;

    mesh.position.set(obj.position.x, centerY, obj.position.z);
    mesh.rotation.y = rotYRad;
    mesh.name = obj.id;
    mesh.userData = {
      layoutId: obj.id,
      layoutName: obj.name,
      layoutType: obj.type,
      baseY,
    };

    group.add(mesh);

    // Register solid building colliders for player/seeker movement & line-of-sight
    if (obj.type === 'building') {
      if (options?.onRegisterOBBCollider) {
        options.onRegisterOBBCollider(
          obj.position.x,
          obj.position.z,
          width * 0.5,
          depth * 0.5,
          rotYRad,
          baseY,
          baseY + height,
          obj
        );
      } else if (options?.onRegisterColliderBox) {
        const aabb = computeObjectWorldAABB(obj);
        options.onRegisterColliderBox(
          { x: aabb.min.x, y: baseY, z: aabb.min.z },
          { x: aabb.max.x, y: baseY + height, z: aabb.max.z },
          obj
        );
      }
    }
  }

  scene.add(group);
  return group;
}
