/**
 * Stage 1: Production Element Interior & Functional Interior 3D Architecture
 * Target: Expo Go (React Three Fiber / Three.js) & Headless 3D Spatial Validator
 *
 * Implements:
 * 1. ElementInteriorKit: Standardized metric grid (0.20m wall thickness, corner/bottom pivots,
 *    window cutouts, doorway frames, and chamfered capsule/AABB collision proxies).
 * 2. FunctionalInteriorRig: Articulated sub-meshes with explicit revolute (door/breaker)
 *    and prismatic (drawer) joint axes, clamped limits, and separate raycast vs. blocker bounds.
 * 3. Smooth Capsule-Proxy Collision Resolver: Sliding contact normal projection to prevent
 *    player snagging or clipping around classroom furniture and open drawers.
 */

export const ARCHITECTURAL_CONSTANTS = {
  GRID_UNIT: 0.5,             // 0.50m modular grid snap
  WALL_THICKNESS: 0.20,       // 20cm production wall thickness
  WALL_HEIGHT: 3.20,          // 3.20m classroom ceiling height
  DOOR_WIDTH: 0.95,           // 95cm clear doorway opening (standard accessible clearance)
  DOOR_HEIGHT: 2.10,          // 2.10m doorway height
  WINDOW_SILL_HEIGHT: 0.95,   // 95cm window sill height
  WINDOW_HEAD_HEIGHT: 2.15,   // 2.15m window head height
  WINDOW_WIDTH: 1.60,         // 1.60m window opening width
  PLAYER_RADIUS: 0.32,        // 32cm player capsule radius
  PLAYER_HEIGHT: 1.72,        // 1.72m player eye/capsule height
  MIN_AISLE_CLEARANCE: 0.90,  // Minimum 90cm aisle between desks (> 2 * PLAYER_RADIUS + 0.25m buffer)
  CHAMFER_RADIUS: 0.08,       // 8cm corner chamfer on furniture collision proxies to prevent snagging
};

/**
 * Represents a 3D Axis-Aligned Bounding Box with optional corner chamfer radius
 * for smooth sliding collision resolution (preventing corner snagging).
 */
export class CollisionProxyBox {
  constructor({ id, category, min, max, chamferRadius = 0, isSolid = true, isTrigger = false }) {
    this.id = id;
    this.category = category; // 'wall' | 'furniture' | 'door_blocker' | 'drawer_blocker' | 'window_sill'
    this.min = { ...min };
    this.max = { ...max };
    this.chamferRadius = chamferRadius;
    this.isSolid = isSolid;
    this.isTrigger = isTrigger;
  }

  getCenter() {
    return {
      x: (this.min.x + this.max.x) * 0.5,
      y: (this.min.y + this.max.y) * 0.5,
      z: (this.min.z + this.max.z) * 0.5,
    };
  }

  getSize() {
    return {
      x: this.max.x - this.min.x,
      y: this.max.y - this.min.y,
      z: this.max.z - this.min.z,
    };
  }
}

/**
 * Prismatic Drawer Rig (Functional Interior)
 * Pivot is anchored at the back of the slide rail; local Z translation is strictly clamped.
 */
export class ArticulatedDrawer {
  constructor({
    id,
    parentDeskId,
    origin,
    size = { x: 0.44, y: 0.16, z: 0.48 },
    maxSlideDistance = 0.40,
    slideSpeed = 1.6,
    slideDirectionZ = -1, // -1 slides out toward south (-Z), +1 slides toward north (+Z)
    containedItemId = null,
  }) {
    this.id = id;
    this.parentDeskId = parentDeskId;
    this.origin = { ...origin };
    this.size = { ...size };
    this.minSlide = 0.0;
    this.maxSlide = maxSlideDistance;
    this.slideSpeed = slideSpeed;
    this.slideDirectionZ = slideDirectionZ;
    this.currentSlide = 0.0;
    this.state = 'IDLE_CLOSED'; // 'IDLE_CLOSED' | 'ANIMATING_OPEN' | 'IDLE_OPEN' | 'ANIMATING_CLOSED'
    this.containedItemId = containedItemId;
    this.visibilityThreshold = 0.55; // Item inside becomes raycast-targetable when >= 55% open
  }

  getOpenRatio() {
    return this.maxSlide > 0 ? this.currentSlide / this.maxSlide : 0;
  }

  isItemExposed() {
    return this.containedItemId !== null && this.getOpenRatio() >= this.visibilityThreshold;
  }

  getItemWorldPosition() {
    if (!this.containedItemId) return null;
    return {
      x: this.origin.x,
      y: this.origin.y + 0.02,
      z: this.origin.z + this.slideDirectionZ * this.currentSlide,
    };
  }

  toggle() {
    if (this.state === 'ANIMATING_OPEN' || this.state === 'ANIMATING_CLOSED') {
      return { accepted: false, reason: 'BUSY_ANIMATING', state: this.state };
    }
    if (this.state === 'IDLE_CLOSED') {
      this.state = 'ANIMATING_OPEN';
      return { accepted: true, targetState: 'IDLE_OPEN', state: this.state };
    }
    this.state = 'ANIMATING_CLOSED';
    return { accepted: true, targetState: 'IDLE_CLOSED', state: this.state };
  }

  update(dt) {
    if (this.state === 'ANIMATING_OPEN') {
      this.currentSlide = Math.min(this.maxSlide, this.currentSlide + this.slideSpeed * dt);
      if (this.currentSlide >= this.maxSlide - 1e-5) {
        this.currentSlide = this.maxSlide;
        this.state = 'IDLE_OPEN';
      }
    } else if (this.state === 'ANIMATING_CLOSED') {
      this.currentSlide = Math.max(this.minSlide, this.currentSlide - this.slideSpeed * dt);
      if (this.currentSlide <= this.minSlide + 1e-5) {
        this.currentSlide = this.minSlide;
        this.state = 'IDLE_CLOSED';
      }
    }
    this.currentSlide = Math.max(this.minSlide, Math.min(this.maxSlide, this.currentSlide));
  }

  getWorldBounds() {
    const halfX = this.size.x * 0.5;
    const halfY = this.size.y * 0.5;
    const halfZ = this.size.z * 0.5;
    const centerZ = this.origin.z + this.slideDirectionZ * this.currentSlide;
    return new CollisionProxyBox({
      id: `${this.id}_blocker`,
      category: 'drawer_blocker',
      min: { x: this.origin.x - halfX, y: this.origin.y - halfY, z: centerZ - halfZ },
      max: { x: this.origin.x + halfX, y: this.origin.y + halfY, z: centerZ + halfZ },
      chamferRadius: 0.04,
      isSolid: this.currentSlide > 0.02,
    });
  }
}

/**
 * Revolute Hinged Door Rig (Functional Interior)
 * Pivot is placed strictly at the hinge jamb edge so rotating by [0, maxAngleRad] never clips into the frame.
 */
export class ArticulatedDoor {
  constructor({
    id,
    hingeOrigin,
    width = ARCHITECTURAL_CONSTANTS.DOOR_WIDTH,
    height = ARCHITECTURAL_CONSTANTS.DOOR_HEIGHT,
    thickness = 0.05,
    closedYawRad = 0.0,
    openYawRad = Math.PI * 0.5,
    angularSpeedRad = 2.8,
    isLocked = false,
    requiredKeyId = null,
  }) {
    this.id = id;
    this.hingeOrigin = { ...hingeOrigin };
    this.width = width;
    this.height = height;
    this.thickness = thickness;
    this.closedYawRad = closedYawRad;
    this.openYawRad = openYawRad;
    this.currentYawRad = closedYawRad;
    this.angularSpeedRad = angularSpeedRad;
    this.isLocked = isLocked;
    this.requiredKeyId = requiredKeyId;
    this.state = 'IDLE_CLOSED';
  }

  interact(inventory = new Set()) {
    if (this.state === 'ANIMATING_OPEN' || this.state === 'ANIMATING_CLOSED') {
      return { accepted: false, reason: 'BUSY_ANIMATING', state: this.state };
    }
    if (this.isLocked) {
      if (this.requiredKeyId && inventory.has(this.requiredKeyId)) {
        this.isLocked = false;
        this.state = 'ANIMATING_OPEN';
        return { accepted: true, unlocked: true, state: this.state };
      }
      return { accepted: false, reason: 'LOCKED_NEEDS_KEY', requiredKeyId: this.requiredKeyId, state: this.state };
    }
    if (this.state === 'IDLE_CLOSED') {
      this.state = 'ANIMATING_OPEN';
      return { accepted: true, state: this.state };
    }
    this.state = 'ANIMATING_CLOSED';
    return { accepted: true, state: this.state };
  }

  update(dt) {
    const dir = this.openYawRad >= this.closedYawRad ? 1 : -1;
    const minYaw = Math.min(this.closedYawRad, this.openYawRad);
    const maxYaw = Math.max(this.closedYawRad, this.openYawRad);

    if (this.state === 'ANIMATING_OPEN') {
      this.currentYawRad += dir * this.angularSpeedRad * dt;
      if ((dir > 0 && this.currentYawRad >= this.openYawRad) || (dir < 0 && this.currentYawRad <= this.openYawRad)) {
        this.currentYawRad = this.openYawRad;
        this.state = 'IDLE_OPEN';
      }
    } else if (this.state === 'ANIMATING_CLOSED') {
      this.currentYawRad -= dir * this.angularSpeedRad * dt;
      if ((dir > 0 && this.currentYawRad <= this.closedYawRad) || (dir < 0 && this.currentYawRad >= this.closedYawRad)) {
        this.currentYawRad = this.closedYawRad;
        this.state = 'IDLE_CLOSED';
      }
    }
    this.currentYawRad = Math.max(minYaw, Math.min(maxYaw, this.currentYawRad));
  }

  getDoorLeafWorldAABB() {
    const endX = this.hingeOrigin.x + Math.cos(this.currentYawRad) * this.width;
    const endZ = this.hingeOrigin.z + Math.sin(this.currentYawRad) * this.width;
    const halfT = this.thickness * 0.5;
    return new CollisionProxyBox({
      id: `${this.id}_leaf_blocker`,
      category: 'door_blocker',
      min: {
        x: Math.min(this.hingeOrigin.x, endX) - halfT,
        y: this.hingeOrigin.y,
        z: Math.min(this.hingeOrigin.z, endZ) - halfT,
      },
      max: {
        x: Math.max(this.hingeOrigin.x, endX) + halfT,
        y: this.hingeOrigin.y + this.height,
        z: Math.max(this.hingeOrigin.z, endZ) + halfT,
      },
      chamferRadius: 0.03,
      // Solid when closed or fully open (flush against wall), non-blocking mid-swing so it never clips player
      isSolid: this.state === 'IDLE_CLOSED' || this.state === 'IDLE_OPEN',
    });
  }
}

/**
 * Representative Classroom + Adjacent Hallway & Electrical Room Scene Builder
 * Classroom dimensions: X in [-4.0m, 4.0m] (8.0m wide), Z in [-3.5m, 3.5m] (7.0m deep)
 * Hallway: X in [-4.0m, 1.5m], Z in [-5.5m, -3.5m]
 * Electrical Room: X in [1.5m, 4.0m], Z in [-5.5m, -3.5m]
 */
export function buildRepresentativeClassroomScene() {
  const T = ARCHITECTURAL_CONSTANTS.WALL_THICKNESS;
  const H = ARCHITECTURAL_CONSTANTS.WALL_HEIGHT;
  const staticColliders = [];
  const windows = [];

  // 1. North Wall (Z = 3.5m)
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_north',
      category: 'wall',
      min: { x: -4.0 - T, y: 0, z: 3.5 },
      max: { x: 4.0 + T, y: H, z: 3.5 + T },
    })
  );

  // 2. West Wall (X = -4.0m)
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_west',
      category: 'wall',
      min: { x: -4.0 - T, y: 0, z: -5.5 },
      max: { x: -4.0, y: H, z: 3.5 },
    })
  );

  // 3. East Wall (X = 4.0m)
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_east',
      category: 'wall',
      min: { x: 4.0, y: 0, z: -5.5 },
      max: { x: 4.0 + T, y: H, z: 3.5 },
    })
  );

  // 4. South Classroom Wall (Z = -3.5m) with Doorway Opening X in [-3.75m, -2.80m] (width = 0.95m, aligned with West aisle)
  // and Two Window Openings: Window 1 X in [-1.60m, 0.00m], Window 2 X in [1.20m, 2.80m]
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_south_pier_left',
      category: 'wall',
      min: { x: -4.0, y: 0, z: -3.5 - T },
      max: { x: -3.75, y: H, z: -3.5 },
    }),
    new CollisionProxyBox({
      id: 'wall_south_main',
      category: 'wall',
      min: { x: -2.80, y: 0, z: -3.5 - T },
      max: { x: 4.0, y: H, z: -3.5 },
    })
  );

  windows.push(
    {
      id: 'window_south_1',
      wallId: 'wall_south_main',
      min: { x: -1.60, y: ARCHITECTURAL_CONSTANTS.WINDOW_SILL_HEIGHT, z: -3.5 - T },
      max: { x: 0.00, y: ARCHITECTURAL_CONSTANTS.WINDOW_HEAD_HEIGHT, z: -3.5 },
      frameThickness: T,
    },
    {
      id: 'window_south_2',
      wallId: 'wall_south_main',
      min: { x: 1.20, y: ARCHITECTURAL_CONSTANTS.WINDOW_SILL_HEIGHT, z: -3.5 - T },
      max: { x: 2.80, y: ARCHITECTURAL_CONSTANTS.WINDOW_HEAD_HEIGHT, z: -3.5 },
      frameThickness: T,
    }
  );

  // 5. South Corridor Exterior Wall (Z = -5.5m)
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_corridor_south',
      category: 'wall',
      min: { x: -4.0 - T, y: 0, z: -5.5 - T },
      max: { x: 4.0 + T, y: H, z: -5.5 },
    })
  );

  // 6. Electrical Room Partition Wall at X = 1.5m, Z in [-5.5m, -3.5m]
  // Doorway Opening in Z: [-4.95m, -4.00m] (width = 0.95m)
  staticColliders.push(
    new CollisionProxyBox({
      id: 'wall_elec_partition_north',
      category: 'wall',
      min: { x: 1.5 - T * 0.5, y: 0, z: -4.00 },
      max: { x: 1.5 + T * 0.5, y: H, z: -3.5 },
    }),
    new CollisionProxyBox({
      id: 'wall_elec_partition_south',
      category: 'wall',
      min: { x: 1.5 - T * 0.5, y: 0, z: -5.5 },
      max: { x: 1.5 + T * 0.5, y: H, z: -4.95 },
    })
  );

  // 7. Classroom Furniture (Chamfered Proxy Colliders)
  // Teacher Desk near front-center-left (X in [-2.20m, -0.80m], Z in [2.10m, 2.85m])
  staticColliders.push(
    new CollisionProxyBox({
      id: 'furniture_teacher_desk',
      category: 'furniture',
      min: { x: -2.20, y: 0, z: 2.10 },
      max: { x: -0.80, y: 0.78, z: 2.85 },
      chamferRadius: ARCHITECTURAL_CONSTANTS.CHAMFER_RADIUS,
    })
  );

  // Supply Cabinet near front-right (X in [2.6m, 3.6m], Z in [2.2m, 2.8m])
  staticColliders.push(
    new CollisionProxyBox({
      id: 'furniture_supply_cabinet',
      category: 'furniture',
      min: { x: 2.60, y: 0, z: 2.20 },
      max: { x: 3.60, y: 1.85, z: 2.80 },
      chamferRadius: ARCHITECTURAL_CONSTANTS.CHAMFER_RADIUS,
    })
  );

  // Tall Hiding Locker against West Wall (X in [-3.95m, -3.30m], Z in [1.80m, 2.50m])
  staticColliders.push(
    new CollisionProxyBox({
      id: 'furniture_hiding_locker_west',
      category: 'furniture',
      min: { x: -3.95, y: 0, z: 1.80 },
      max: { x: -3.30, y: 2.00, z: 2.50 },
      chamferRadius: ARCHITECTURAL_CONSTANTS.CHAMFER_RADIUS,
    })
  );

  // 6 Student Desks in 3 columns x 2 rows with generous aisles and clear West doorway corridor
  const deskColumns = [-1.80, 0.30, 2.40]; // Desk width = 0.90m -> gap = 1.20m, West aisle [-4.0, -2.25] = 1.75m
  const deskRows = [0.40, -1.20];          // Desk depth = 0.65m -> gap = 0.95m, South vestibule = 1.975m
  let deskIndex = 1;
  for (const rZ of deskRows) {
    for (const cX of deskColumns) {
      staticColliders.push(
        new CollisionProxyBox({
          id: `furniture_student_desk_${deskIndex}`,
          category: 'furniture',
          min: { x: cX - 0.45, y: 0, z: rZ - 0.325 },
          max: { x: cX + 0.45, y: 0.75, z: rZ + 0.325 },
          chamferRadius: ARCHITECTURAL_CONSTANTS.CHAMFER_RADIUS,
        })
      );
      deskIndex++;
    }
  }

  // 8. Functional Interior: Articulated Drawers
  const drawers = [
    new ArticulatedDrawer({
      id: 'drawer_teacher_desk_top',
      parentDeskId: 'furniture_teacher_desk',
      origin: { x: -1.50, y: 0.62, z: 2.10 },
      size: { x: 0.46, y: 0.14, z: 0.48 },
      maxSlideDistance: 0.38,
      slideDirectionZ: -1,
      containedItemId: 'item_electrical_room_key',
    }),
    new ArticulatedDrawer({
      id: 'drawer_supply_cabinet_main',
      parentDeskId: 'furniture_supply_cabinet',
      origin: { x: 3.10, y: 0.85, z: 2.20 },
      size: { x: 0.50, y: 0.16, z: 0.46 },
      maxSlideDistance: 0.36,
      slideDirectionZ: -1,
      containedItemId: 'item_main_fuse_30a',
    }),
    new ArticulatedDrawer({
      id: 'drawer_student_desk_2',
      parentDeskId: 'furniture_student_desk_2',
      origin: { x: 0.30, y: 0.60, z: 0.40 },
      size: { x: 0.42, y: 0.12, z: 0.44 },
      maxSlideDistance: 0.34,
      slideDirectionZ: -1,
      containedItemId: 'item_noisemaker_decoy',
    }),
  ];

  // 9. Functional Interior: Articulated Hinged Doors
  const doors = [
    new ArticulatedDoor({
      id: 'door_classroom_main',
      hingeOrigin: { x: -3.75, y: 0, z: -3.50 },
      width: ARCHITECTURAL_CONSTANTS.DOOR_WIDTH,
      height: ARCHITECTURAL_CONSTANTS.DOOR_HEIGHT,
      closedYawRad: 0.0,
      openYawRad: Math.PI * 0.5, // Swings into classroom (+Z) flush against West pier
      isLocked: false,
    }),
    new ArticulatedDoor({
      id: 'door_electrical_room',
      hingeOrigin: { x: 1.50, y: 0, z: -4.95 },
      width: ARCHITECTURAL_CONSTANTS.DOOR_WIDTH,
      height: ARCHITECTURAL_CONSTANTS.DOOR_HEIGHT,
      closedYawRad: Math.PI * 0.5, // Aligned along Z from -4.95 to -4.00
      openYawRad: 0.0,             // Swings into electrical room (+X)
      isLocked: true,
      requiredKeyId: 'item_electrical_room_key',
    }),
  ];

  return {
    staticColliders,
    windows,
    drawers,
    doors,
  };
}

/**
 * 2D (XZ plane) Circle-vs-Chamfered-AABB Collision & Smooth Sliding Resolver
 * Prevents player capsule from snagging on furniture corners or clipping through walls.
 */
export function resolvePlayerCapsuleCollisions(
  position,
  radius = ARCHITECTURAL_CONSTANTS.PLAYER_RADIUS,
  colliders = []
) {
  let resolved = { x: position.x, y: position.y ?? 0, z: position.z };
  const contacts = [];

  for (let pass = 0; pass < 3; pass++) {
    for (const box of colliders) {
      if (!box.isSolid) continue;

      const c = Math.min(
        box.chamferRadius || 0,
        (box.max.x - box.min.x) * 0.45,
        (box.max.z - box.min.z) * 0.45
      );
      const innerMinX = box.min.x + c;
      const innerMaxX = box.max.x - c;
      const innerMinZ = box.min.z + c;
      const innerMaxZ = box.max.z - c;
      const effectiveRadius = radius + c;

      const closestX = Math.max(innerMinX, Math.min(resolved.x, innerMaxX));
      const closestZ = Math.max(innerMinZ, Math.min(resolved.z, innerMaxZ));

      const dx = resolved.x - closestX;
      const dz = resolved.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < effectiveRadius * effectiveRadius) {
        const dist = Math.sqrt(distSq);
        let nx = 0;
        let nz = 0;
        let penetration = 0;

        if (dist > 1e-6) {
          nx = dx / dist;
          nz = dz / dist;
          penetration = effectiveRadius - dist;
        } else {
          const leftPen = resolved.x - box.min.x + radius;
          const rightPen = box.max.x - resolved.x + radius;
          const backPen = resolved.z - box.min.z + radius;
          const frontPen = box.max.z - resolved.z + radius;
          const minPen = Math.min(leftPen, rightPen, backPen, frontPen);
          penetration = minPen;
          if (minPen === leftPen) nx = -1;
          else if (minPen === rightPen) nx = 1;
          else if (minPen === backPen) nz = -1;
          else nz = 1;
        }

        resolved.x += nx * penetration;
        resolved.z += nz * penetration;
        contacts.push({ colliderId: box.id, normal: { x: nx, z: nz }, penetration });
      }
    }
  }

  return { position: resolved, contacts };
}
