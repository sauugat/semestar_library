/**
 * Stage 2: Mobile Interaction Controller & Wall-Occluded 3D Raycast Pipeline
 * Target: iPhone / Expo Go (React Native + React Three Fiber)
 *
 * Implements:
 * 1. Slab-method 3D Ray-vs-AABB intersection sorted by distance (firstHitOnly BVH semantics).
 * 2. Wall & Closed-Container Occlusion Check: Blocks interaction rays when walls, closed doors,
 *    or closed desk shells sit between the camera and the target hitbox.
 * 3. Mobile ACTION Button Controller: Handles touch press, rapid-tap debouncing, touch-cancel
 *    recovery, reticle magnetism for small targets (keys/fuses/breakers), and prompt generation.
 */

export class RaycastTarget {
  constructor({
    id,
    type, // 'door' | 'drawer' | 'pickup_item' | 'fuse_socket' | 'breaker_switch' | 'hiding_spot'
    label,
    min,
    max,
    maxReach = 2.15,
    magnetismPadding = 0.04, // Extra hitbox padding for small mobile targets on iPhone screens
    isEnabled = () => true,
    getPrompt = () => `Interact with ${label}`,
    onInteract = () => ({ accepted: true }),
  }) {
    this.id = id;
    this.type = type;
    this.label = label;
    this.min = { ...min };
    this.max = { ...max };
    this.maxReach = maxReach;
    this.magnetismPadding = magnetismPadding;
    this.isEnabled = isEnabled;
    this.getPrompt = getPrompt;
    this.onInteract = onInteract;
  }

  getPaddedBounds() {
    const p = this.magnetismPadding;
    return {
      min: { x: this.min.x - p, y: this.min.y - p, z: this.min.z - p },
      max: { x: this.max.x + p, y: this.max.y + p, z: this.max.z + p },
    };
  }
}

/**
 * Exact 3D Ray vs AABB Slab Intersection
 * Returns distance `t >= 0` along normalized ray `origin + t * dir`, or `null` if no hit.
 */
export function intersectRayAABB(origin, dir, boxMin, boxMax, maxDistance = Infinity) {
  let tmin = 0.0;
  let tmax = maxDistance;

  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    const bMin = boxMin[axis];
    const bMax = boxMax[axis];

    if (Math.abs(d) < 1e-8) {
      if (o < bMin || o > bMax) return null;
    } else {
      const invD = 1.0 / d;
      let t1 = (bMin - o) * invD;
      let t2 = (bMax - o) * invD;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }

  return tmin <= maxDistance ? tmin : null;
}

export function normalizeVector3(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: -1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Mobile Interaction & Raycast Controller
 */
export class MobileInteractionController {
  constructor({ debounceMs = 180, defaultReachMeters = 2.15 } = {}) {
    this.debounceMs = debounceMs;
    this.defaultReachMeters = defaultReachMeters;
    this.lastActionTimestampMs = -Infinity;
    this.activeTouchId = null;
    this.currentFocusedTarget = null;
    this.currentPrompt = null;
  }

  /**
   * Casts a single ray from the player camera against both ElementInterior occluders
   * and FunctionalInterior interactive targets (`firstHitOnly` semantics).
   */
  evaluateReticleRaycast(cameraOrigin, cameraDirection, occluderBoxes = [], targets = []) {
    const dir = normalizeVector3(cameraDirection);

    // 1. Find closest solid occluder distance (walls, closed doors, desk shells)
    let closestOccluderDist = Infinity;
    let closestOccluderId = null;

    for (const box of occluderBoxes) {
      if (!box.isSolid) continue;
      const t = intersectRayAABB(cameraOrigin, dir, box.min, box.max, this.defaultReachMeters * 2.0);
      if (t !== null && t < closestOccluderDist) {
        closestOccluderDist = t;
        closestOccluderId = box.id;
      }
    }

    // 2. Find closest enabled interactable target within reach
    let closestTarget = null;
    let closestTargetDist = Infinity;

    for (const target of targets) {
      if (!target.isEnabled()) continue;
      const bounds = target.getPaddedBounds();
      const t = intersectRayAABB(cameraOrigin, dir, bounds.min, bounds.max, target.maxReach);
      if (t !== null && t < closestTargetDist) {
        closestTargetDist = t;
        closestTarget = target;
      }
    }

    // 3. Wall / Furniture Occlusion Guard:
    // If an occluder sits strictly in front of the interactable target (with 2cm surface tolerance
    // for flush wall-mounted breaker panels), the target is occluded.
    if (!closestTarget) {
      this.currentFocusedTarget = null;
      this.currentPrompt = null;
      return {
        hit: false,
        occluded: false,
        target: null,
        prompt: null,
      };
    }

    const occlusionTolerance = closestTarget.type === 'breaker_switch' || closestTarget.type === 'fuse_socket' ? 0.04 : 0.01;
    if (closestOccluderDist + occlusionTolerance < closestTargetDist) {
      this.currentFocusedTarget = null;
      this.currentPrompt = null;
      return {
        hit: false,
        occluded: true,
        occludedBy: closestOccluderId,
        occluderDistance: Number(closestOccluderDist.toFixed(3)),
        targetDistance: Number(closestTargetDist.toFixed(3)),
        target: null,
        prompt: null,
      };
    }

    this.currentFocusedTarget = closestTarget;
    this.currentPrompt = closestTarget.getPrompt();

    return {
      hit: true,
      occluded: false,
      target: closestTarget,
      distance: Number(closestTargetDist.toFixed(3)),
      prompt: this.currentPrompt,
    };
  }

  /**
   * Simulates tapping the iPhone ACTION button in Expo Go.
   * Enforces hardware debounce window + target animation lock + touch lifecycle tracking.
   */
  pressActionButton({ timestampMs, touchId = 1 } = {}) {
    if (this.activeTouchId !== null && this.activeTouchId !== touchId) {
      return { accepted: false, reason: 'MULTI_TOUCH_REJECTED' };
    }
    if (timestampMs - this.lastActionTimestampMs < this.debounceMs) {
      return { accepted: false, reason: 'DEBOUNCED_RAPID_TAP' };
    }
    if (!this.currentFocusedTarget) {
      return { accepted: false, reason: 'NO_TARGET_IN_FOCUS' };
    }

    this.activeTouchId = touchId;
    const result = this.currentFocusedTarget.onInteract();

    if (result && result.accepted) {
      this.lastActionTimestampMs = timestampMs;
      // Refresh prompt immediately to reflect new state transition
      this.currentPrompt = this.currentFocusedTarget.isEnabled()
        ? this.currentFocusedTarget.getPrompt()
        : null;
    }

    return {
      ...result,
      targetId: this.currentFocusedTarget.id,
      updatedPrompt: this.currentPrompt,
    };
  }

  releaseActionButton({ touchId = 1 } = {}) {
    if (this.activeTouchId === touchId) {
      this.activeTouchId = null;
    }
  }

  cancelTouch() {
    this.activeTouchId = null;
  }
}
