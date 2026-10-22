/**
 * Stage 4: Hide-and-Seek Gameplay, Pushdown Hiding State, Searchable Containers & Acoustic AI
 *
 * Implements:
 * 1. Pushdown Automaton Player Hiding Controller (Game Programming Patterns):
 *    Pushes 'HIDING' onto the player state stack when entering lockers/under-desk spots and pops
 *    back to the exact prior locomotion state ('STANDING' or 'CROUCHING') on exit.
 * 2. Compromise Detection During Chase:
 *    Tracks whether the Chaser AI has line-of-sight when the player enters a hiding spot.
 * 3. Solvable Building-Wide Searchable Container Spawner:
 *    Distributes mission items across rooms while guaranteeing keys never spawn inside locked rooms.
 * 4. Portal/Doorway Acoustic Propagation & Chaser AI Perception:
 *    Propagates environmental sounds along room portals with wall/closed-door dB attenuation.
 */

import { intersectRayAABB, normalizeVector3 } from './mobile_interaction_controller.mjs';

export const PLAYER_LOCOMOTION_STATES = {
  STANDING: 'STANDING',
  CROUCHING: 'CROUCHING',
  SPRINTING: 'SPRINTING',
  HIDING: 'HIDING',
};

export const CHASER_AI_STATES = {
  PATROL: 'PATROL',
  INVESTIGATE_NOISE: 'INVESTIGATE_NOISE',
  CHASE: 'CHASE',
  SEARCHING_AREA: 'SEARCHING_AREA',
  EXTRACT_FROM_HIDING: 'EXTRACT_FROM_HIDING',
};

export class HidingSpot {
  constructor({ id, roomId, label, entryPosition, interiorPosition, maxEntryDistance = 1.65 }) {
    this.id = id;
    this.roomId = roomId;
    this.label = label;
    this.entryPosition = { ...entryPosition };
    this.interiorPosition = { ...interiorPosition };
    this.maxEntryDistance = maxEntryDistance;
    this.occupiedByPlayer = false;
  }
}

/**
 * Pushdown Automaton for Player Locomotion & Hiding
 */
export class PlayerStealthController {
  constructor({ initialPosition = { x: -1.5, y: 0, z: 0.5 }, initialState = PLAYER_LOCOMOTION_STATES.STANDING } = {}) {
    this.position = { ...initialPosition };
    this.stateStack = [initialState]; // Top of stack is active state
    this.activeHidingSpot = null;
    this.preHideSnapshot = null;
    this.compromisedInHiding = false;
    this.colliderEnabled = true;
  }

  getCurrentState() {
    return this.stateStack[this.stateStack.length - 1];
  }

  setLocomotionState(newState) {
    if (this.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING) {
      return { accepted: false, reason: 'CANNOT_CHANGE_LOCOMOTION_WHILE_HIDING' };
    }
    this.stateStack[this.stateStack.length - 1] = newState;
    return { accepted: true, state: this.getCurrentState() };
  }

  enterHidingSpot(hidingSpot, { chaserHasLineOfSight = false } = {}) {
    if (this.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING) {
      return { accepted: false, reason: 'ALREADY_HIDING' };
    }
    const dist = Math.hypot(
      this.position.x - hidingSpot.entryPosition.x,
      this.position.z - hidingSpot.entryPosition.z
    );
    if (dist > hidingSpot.maxEntryDistance) {
      return { accepted: false, reason: 'TOO_FAR_FROM_HIDING_SPOT', distance: Number(dist.toFixed(3)) };
    }

    // Save pre-hide snapshot and push HIDING onto the Pushdown Automaton stack
    this.preHideSnapshot = {
      position: { ...this.position },
      locomotionState: this.getCurrentState(),
    };
    this.stateStack.push(PLAYER_LOCOMOTION_STATES.HIDING);
    this.activeHidingSpot = hidingSpot;
    hidingSpot.occupiedByPlayer = true;
    this.position = { ...hidingSpot.interiorPosition };
    this.colliderEnabled = false;
    this.compromisedInHiding = Boolean(chaserHasLineOfSight);

    return {
      accepted: true,
      state: this.getCurrentState(),
      stackDepth: this.stateStack.length,
      hidingSpotId: hidingSpot.id,
      compromised: this.compromisedInHiding,
    };
  }

  exitHidingSpot() {
    if (this.getCurrentState() !== PLAYER_LOCOMOTION_STATES.HIDING || !this.activeHidingSpot) {
      return { accepted: false, reason: 'NOT_CURRENTLY_HIDING' };
    }

    const exitedSpotId = this.activeHidingSpot.id;
    this.activeHidingSpot.occupiedByPlayer = false;
    this.activeHidingSpot = null;

    // Pop HIDING off stack to restore prior locomotion state
    this.stateStack.pop();
    this.position = { ...this.preHideSnapshot.position };
    this.colliderEnabled = true;
    this.compromisedInHiding = false;
    this.preHideSnapshot = null;

    return {
      accepted: true,
      exitedSpotId,
      restoredState: this.getCurrentState(),
      stackDepth: this.stateStack.length,
      restoredPosition: { ...this.position },
    };
  }
}

/**
 * Building-Wide Searchable Container Manager with Solvability Guarantees
 */
export class SearchableContainerManager {
  constructor() {
    this.containers = [
      { id: 'drawer_teacher_desk_top', roomId: 'classroom_101', requiresKey: null, itemId: null },
      { id: 'drawer_student_desk_2', roomId: 'classroom_101', requiresKey: null, itemId: null },
      { id: 'drawer_supply_cabinet_main', roomId: 'classroom_101', requiresKey: null, itemId: null },
      { id: 'locker_corridor_north_1', roomId: 'main_corridor', requiresKey: null, itemId: null },
      { id: 'cabinet_faculty_lounge_1', roomId: 'faculty_lounge', requiresKey: null, itemId: null },
      { id: 'toolbox_electrical_room', roomId: 'electrical_room', requiresKey: 'item_electrical_room_key', itemId: null },
    ];
  }

  /**
   * Distributes mission items across building containers while enforcing progression rules:
   * `item_electrical_room_key` MUST NEVER be placed inside a container that requires `item_electrical_room_key`.
   */
  distributeMissionItems(seed = 42) {
    for (const c of this.containers) c.itemId = null;

    const itemsToPlace = [
      { id: 'item_electrical_room_key', forbidLockedBy: 'item_electrical_room_key' },
      { id: 'item_main_fuse_30a', forbidLockedBy: 'item_electrical_room_key' },
      { id: 'item_noisemaker_decoy', forbidLockedBy: null },
      { id: 'item_flashlight_battery', forbidLockedBy: null },
    ];

    let rngState = seed >>> 0;
    const nextRand = () => {
      rngState = (1664525 * rngState + 1013904223) >>> 0;
      return rngState / 0xffffffff;
    };

    const placements = {};
    for (const item of itemsToPlace) {
      const eligible = this.containers.filter(
        (c) => c.itemId === null && (!item.forbidLockedBy || c.requiresKey !== item.forbidLockedBy)
      );
      const idx = Math.floor(nextRand() * eligible.length);
      const chosen = eligible[idx];
      chosen.itemId = item.id;
      placements[item.id] = { containerId: chosen.id, roomId: chosen.roomId };
    }

    return placements;
  }
}

/**
 * Environmental Acoustic Propagation & Chaser AI Controller
 * Models sound attenuation across doorways/walls and line-of-sight chase/hide transitions.
 */
export class AcousticStealthAI {
  constructor({
    initialPosition = { x: -0.5, y: 0, z: -4.5 }, // Starts patrolling in Main Corridor
    hearingThresholdDb = 35.0,
    wallAttenuationDb = 18.0,
  } = {}) {
    this.position = { ...initialPosition };
    this.state = CHASER_AI_STATES.PATROL;
    this.hearingThresholdDb = hearingThresholdDb;
    this.wallAttenuationDb = wallAttenuationDb;
    this.targetPosition = null;
    this.targetHidingSpotId = null;
    this.lastHeardSound = null;
  }

  /**
   * Checks whether Chaser AI has unobstructed 3D line-of-sight to the player.
   */
  hasLineOfSight(playerPosition, wallColliders = [], playerController = null) {
    // If player is inside an uncompromised hiding spot, line of sight is blocked by the locker/desk shell
    if (
      playerController &&
      playerController.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING &&
      !playerController.compromisedInHiding
    ) {
      return false;
    }

    const eyeOrigin = { x: this.position.x, y: 1.55, z: this.position.z };
    const targetEye = { x: playerPosition.x, y: 1.35, z: playerPosition.z };
    const dx = targetEye.x - eyeOrigin.x;
    const dy = targetEye.y - eyeOrigin.y;
    const dz = targetEye.z - eyeOrigin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-5) return true;

    const dir = normalizeVector3({ x: dx, y: dy, z: dz });
    for (const box of wallColliders) {
      if (!box.isSolid) continue;
      // Only full-height walls and closed doors block AI vision
      if (box.category !== 'wall' && box.category !== 'door_blocker') continue;
      const t = intersectRayAABB(eyeOrigin, dir, box.min, box.max, dist);
      if (t !== null && t < dist - 0.05) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluates an environmental sound event emitted by player activity (footsteps, drawers, breakers, decoys).
   * Applies distance decay and wall/closed-door obstacle attenuation.
   */
  processEnvironmentalSound(soundEvent, wallColliders = []) {
    const sourcePos = soundEvent.position || { x: 0, y: 1.0, z: 0 };
    const dist = Math.max(1.0, Math.hypot(sourcePos.x - this.position.x, sourcePos.z - this.position.z));

    // Count intervening walls or closed doors along the acoustic ray
    const dir = normalizeVector3({
      x: sourcePos.x - this.position.x,
      y: 0,
      z: sourcePos.z - this.position.z,
    });
    let obstacleCount = 0;
    for (const box of wallColliders) {
      if (!box.isSolid) continue;
      if (box.category !== 'wall' && box.category !== 'door_blocker') continue;
      const t = intersectRayAABB(
        { x: this.position.x, y: 1.2, z: this.position.z },
        dir,
        box.min,
        box.max,
        dist
      );
      if (t !== null && t < dist) {
        obstacleCount++;
      }
    }

    // Inverse-distance acoustic decay + wall attenuation
    const distanceLossDb = 20 * Math.log10(dist);
    const perceivedDb = soundEvent.decibels - distanceLossDb - obstacleCount * this.wallAttenuationDb;
    const heard = perceivedDb >= this.hearingThresholdDb;

    if (heard && this.state !== CHASER_AI_STATES.CHASE && this.state !== CHASER_AI_STATES.EXTRACT_FROM_HIDING) {
      this.state = CHASER_AI_STATES.INVESTIGATE_NOISE;
      this.targetPosition = { ...sourcePos };
      this.lastHeardSound = {
        type: soundEvent.type,
        perceivedDb: Number(perceivedDb.toFixed(2)),
        obstacleCount,
        origin: { ...sourcePos },
      };
    }

    return {
      heard,
      perceivedDb: Number(perceivedDb.toFixed(2)),
      obstacleCount,
      aiState: this.state,
      targetPosition: this.targetPosition ? { ...this.targetPosition } : null,
    };
  }

  /**
   * Updates AI chase vs. hiding resolution when the player attempts to hide during a chase.
   */
  evaluateChaseAndHiding(playerController, wallColliders = []) {
    const canSee = this.hasLineOfSight(playerController.position, wallColliders, playerController);

    if (playerController.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING) {
      if (playerController.compromisedInHiding) {
        this.state = CHASER_AI_STATES.EXTRACT_FROM_HIDING;
        this.targetHidingSpotId = playerController.activeHidingSpot.id;
        this.targetPosition = { ...playerController.activeHidingSpot.entryPosition };
        return {
          aiState: this.state,
          playerSafe: false,
          reason: 'PLAYER_SEEN_ENTERING_HIDING_SPOT',
        };
      }
      // Player hid unseen! Chaser transitions from CHASE to SEARCHING_AREA and loses lock
      if (this.state === CHASER_AI_STATES.CHASE) {
        this.state = CHASER_AI_STATES.SEARCHING_AREA;
      }
      return {
        aiState: this.state,
        playerSafe: true,
        reason: 'HIDDEN_UNSEEN_EVADED_CHASE',
      };
    }

    if (canSee) {
      this.state = CHASER_AI_STATES.CHASE;
      this.targetPosition = { ...playerController.position };
      return { aiState: this.state, playerSafe: false, reason: 'DIRECT_LINE_OF_SIGHT' };
    }

    return { aiState: this.state, playerSafe: true, reason: 'NO_LINE_OF_SIGHT' };
  }
}
