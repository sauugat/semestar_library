/**
 * Stage 3: Complete Power-Restoration Mission Finite State Machine (FSM)
 *
 * Implements deterministic state progression, entry/exit lighting & emissive actions,
 * invalid sequence guards, and full mission state resets:
 *   BLACKOUT_INIT -> KEY_ACQUIRED -> ELECTRICAL_ROOM_UNLOCKED -> FUSE_INSERTED -> POWER_RESTORED
 */

export const MISSION_STATES = {
  BLACKOUT_INIT: 'BLACKOUT_INIT',
  KEY_ACQUIRED: 'KEY_ACQUIRED',
  ELECTRICAL_ROOM_UNLOCKED: 'ELECTRICAL_ROOM_UNLOCKED',
  FUSE_INSERTED: 'FUSE_INSERTED',
  POWER_RESTORED: 'POWER_RESTORED',
};

export class PowerRestorationMissionFSM {
  constructor({ scene, onSoundEmitted = () => {} } = {}) {
    this.scene = scene;
    this.onSoundEmitted = onSoundEmitted;
    this.requiredBreakers = ['breaker_main', 'breaker_classroom_1', 'breaker_corridor'];
    this.resetMission();
  }

  resetMission() {
    this.state = MISSION_STATES.BLACKOUT_INIT;
    this.inventory = new Set();
    this.collectedItems = new Set();
    this.fuseInserted = false;
    this.breakers = {
      breaker_main: false,
      breaker_classroom_1: false,
      breaker_corridor: false,
      breaker_auxiliary_unused: false,
    };
    this.lights = {
      emergency_red_amber: { intensity: 0.12, active: true, color: '#FF5252' },
      electrical_room_lights: { intensity: 0.0, active: false, color: '#FFF8E1' },
      classroom_lights: { intensity: 0.0, active: false, color: '#FFFFFF' },
      corridor_lights: { intensity: 0.0, active: false, color: '#FFFDE7' },
    };
    this.panelEmissiveLED = '#FF1744'; // Red fault indicator during blackout
    this.eventLog = ['MISSION_RESET:BLACKOUT_INIT'];

    // Reset scene doors and drawers if attached
    if (this.scene) {
      for (const drawer of this.scene.drawers) {
        drawer.currentSlide = 0.0;
        drawer.state = 'IDLE_CLOSED';
      }
      for (const door of this.scene.doors) {
        door.currentYawRad = door.closedYawRad;
        door.state = 'IDLE_CLOSED';
        if (door.id === 'door_electrical_room') {
          door.isLocked = true;
        } else {
          door.isLocked = false;
        }
      }
    }

    return this.getSnapshot();
  }

  pickupItem(itemId, sourceDrawer = null) {
    // Guard: Cannot pick up an item inside a drawer unless the drawer is sufficiently open
    if (sourceDrawer && !sourceDrawer.isItemExposed()) {
      return {
        accepted: false,
        reason: 'CONTAINER_CLOSED_OR_OCCLUDED',
        state: this.state,
      };
    }
    if (this.collectedItems.has(itemId)) {
      return {
        accepted: false,
        reason: 'ITEM_ALREADY_COLLECTED',
        state: this.state,
      };
    }

    this.inventory.add(itemId);
    this.collectedItems.add(itemId);

    if (itemId === 'item_electrical_room_key' && this.state === MISSION_STATES.BLACKOUT_INIT) {
      this._transitionTo(MISSION_STATES.KEY_ACQUIRED);
    }

    this.onSoundEmitted({
      type: 'ITEM_PICKUP',
      itemId,
      decibels: 28,
      radiusMeters: 3.0,
    });

    return {
      accepted: true,
      itemId,
      inventory: Array.from(this.inventory),
      state: this.state,
    };
  }

  unlockElectricalRoomDoor(door) {
    if (!door || door.id !== 'door_electrical_room') {
      return { accepted: false, reason: 'INVALID_DOOR', state: this.state };
    }
    const res = door.interact(this.inventory);
    if (!res.accepted) {
      // Rattling locked door emits audible metallic rattle
      if (res.reason === 'LOCKED_NEEDS_KEY') {
        this.onSoundEmitted({
          type: 'LOCKED_DOOR_RATTLE',
          sourceId: door.id,
          decibels: 58,
          radiusMeters: 9.5,
        });
      }
      return { ...res, state: this.state };
    }

    if (res.unlocked && (this.state === MISSION_STATES.KEY_ACQUIRED || this.state === MISSION_STATES.BLACKOUT_INIT)) {
      this._transitionTo(MISSION_STATES.ELECTRICAL_ROOM_UNLOCKED);
    }

    this.onSoundEmitted({
      type: 'DOOR_UNLOCK_AND_SWING',
      sourceId: door.id,
      decibels: 46,
      radiusMeters: 7.0,
    });

    return {
      accepted: true,
      unlocked: Boolean(res.unlocked),
      doorState: door.state,
      state: this.state,
    };
  }

  insertFuse() {
    // Sequence guard 1: Electrical room must be unlocked first
    if (
      this.state !== MISSION_STATES.ELECTRICAL_ROOM_UNLOCKED &&
      this.state !== MISSION_STATES.FUSE_INSERTED &&
      this.state !== MISSION_STATES.POWER_RESTORED
    ) {
      return {
        accepted: false,
        reason: 'ELECTRICAL_ROOM_NOT_ACCESSIBLE',
        state: this.state,
      };
    }
    // Sequence guard 2: Must possess the 30A fuse
    if (!this.inventory.has('item_main_fuse_30a')) {
      return {
        accepted: false,
        reason: 'MISSING_FUSE_ITEM',
        state: this.state,
      };
    }
    if (this.fuseInserted) {
      return {
        accepted: false,
        reason: 'FUSE_ALREADY_INSERTED',
        state: this.state,
      };
    }

    this.inventory.delete('item_main_fuse_30a');
    this.fuseInserted = true;
    this._transitionTo(MISSION_STATES.FUSE_INSERTED);

    this.onSoundEmitted({
      type: 'FUSE_SNAP_INSERT',
      decibels: 42,
      radiusMeters: 6.0,
    });

    return {
      accepted: true,
      fuseInserted: true,
      state: this.state,
      lights: structuredClone(this.lights),
    };
  }

  toggleBreaker(breakerId) {
    if (!(breakerId in this.breakers)) {
      return { accepted: false, reason: 'UNKNOWN_BREAKER', state: this.state };
    }

    // Invalid Sequence Guard: Flipping breakers before fuse is inserted fails with dry click
    if (!this.fuseInserted) {
      this.onSoundEmitted({
        type: 'BREAKER_DEAD_CLICK',
        breakerId,
        decibels: 48,
        radiusMeters: 7.5,
      });
      return {
        accepted: false,
        reason: 'NO_FUSE_INSTALLED',
        state: this.state,
      };
    }

    // Enforce Master Breaker dependency: Sub-breakers cannot energize lines until breaker_main is ON
    if (breakerId !== 'breaker_main' && !this.breakers.breaker_main) {
      this.onSoundEmitted({
        type: 'BREAKER_DEAD_CLICK',
        breakerId,
        decibels: 48,
        radiusMeters: 7.5,
      });
      return {
        accepted: false,
        reason: 'MAIN_BREAKER_OFF',
        state: this.state,
      };
    }

    this.breakers[breakerId] = !this.breakers[breakerId];

    // If main breaker is turned OFF, de-energize dependent room lights
    this._evaluateCircuitLighting();

    const allRequiredOn = this.requiredBreakers.every((id) => this.breakers[id] === true);
    if (allRequiredOn && this.state !== MISSION_STATES.POWER_RESTORED) {
      this._transitionTo(MISSION_STATES.POWER_RESTORED);
    } else if (!allRequiredOn && this.state === MISSION_STATES.POWER_RESTORED) {
      this._transitionTo(MISSION_STATES.FUSE_INSERTED);
    }

    this.onSoundEmitted({
      type: 'BREAKER_HEAVY_CLUNK',
      breakerId,
      decibels: 62,
      radiusMeters: 11.0,
    });

    return {
      accepted: true,
      breakerId,
      breakerOn: this.breakers[breakerId],
      state: this.state,
      lights: structuredClone(this.lights),
      panelEmissiveLED: this.panelEmissiveLED,
    };
  }

  _transitionTo(nextState) {
    const prevState = this.state;
    this.state = nextState;
    this.eventLog.push(`${prevState}->${nextState}`);

    // State Entry Actions (Game Programming Patterns State Entry Action consolidation)
    if (nextState === MISSION_STATES.FUSE_INSERTED) {
      this.panelEmissiveLED = '#FFD600'; // Amber standby: fuse seated, awaiting breakers
      this._evaluateCircuitLighting();
    } else if (nextState === MISSION_STATES.POWER_RESTORED) {
      this.panelEmissiveLED = '#00E676'; // Green active: all circuits restored
      this._evaluateCircuitLighting();
    }
  }

  _evaluateCircuitLighting() {
    const mainEnergized = this.fuseInserted && this.breakers.breaker_main;
    this.lights.electrical_room_lights.active = mainEnergized;
    this.lights.electrical_room_lights.intensity = mainEnergized ? 0.85 : 0.0;

    const classroomEnergized = mainEnergized && this.breakers.breaker_classroom_1;
    this.lights.classroom_lights.active = classroomEnergized;
    this.lights.classroom_lights.intensity = classroomEnergized ? 1.0 : 0.0;

    const corridorEnergized = mainEnergized && this.breakers.breaker_corridor;
    this.lights.corridor_lights.active = corridorEnergized;
    this.lights.corridor_lights.intensity = corridorEnergized ? 0.95 : 0.0;
  }

  getSnapshot() {
    return {
      state: this.state,
      inventory: Array.from(this.inventory),
      fuseInserted: this.fuseInserted,
      breakers: { ...this.breakers },
      lights: structuredClone(this.lights),
      panelEmissiveLED: this.panelEmissiveLED,
      eventLog: [...this.eventLog],
    };
  }
}
