/**
 * Expo Go / React Three Fiber Integration Component
 * Connects Stage 1 (Element/Functional 3D Interior), Stage 2 (Mobile Action & Occluded Raycast),
 * Stage 3 (Power-Restoration Mission FSM), and Stage 4 (Hide-and-Seek & Acoustic AI).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { Bvh } from '@react-three/drei/native';
import {
  ARCHITECTURAL_CONSTANTS,
  buildRepresentativeClassroomScene,
  resolvePlayerCapsuleCollisions,
} from './classroom_3d_interior.mjs';
import {
  RaycastTarget,
  MobileInteractionController,
} from './mobile_interaction_controller.mjs';
import {
  MISSION_STATES,
  PowerRestorationMissionFSM,
} from './power_restoration_fsm.mjs';
import {
  PLAYER_LOCOMOTION_STATES,
  HidingSpot,
  PlayerStealthController,
  AcousticStealthAI,
} from './hide_and_seek_stealth.mjs';

function ClassroomSimulationLoop({
  sceneModel,
  mission,
  mobileUI,
  playerStealth,
  chaserAI,
  targets,
  joystickVectorRef,
  onHudSync,
}) {
  const { camera } = useThree();

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);

    // 1. Update Functional Interior animations (doors & drawers)
    for (const drawer of sceneModel.drawers) drawer.update(dt);
    for (const door of sceneModel.doors) door.update(dt);

    // 2. Update Player Capsule Movement & Smooth Sliding Collision Resolution
    if (playerStealth.getCurrentState() !== PLAYER_LOCOMOTION_STATES.HIDING) {
      const input = joystickVectorRef.current;
      const moveSpeed =
        playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.SPRINTING
          ? 4.2
          : playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.CROUCHING
          ? 1.5
          : 2.8;

      if (Math.hypot(input.x, input.z) > 0.05) {
        const desiredPos = {
          x: playerStealth.position.x + input.x * moveSpeed * dt,
          y: 0,
          z: playerStealth.position.z + input.z * moveSpeed * dt,
        };
        const activeColliders = [
          ...sceneModel.staticColliders,
          ...sceneModel.doors.map((d) => d.getDoorLeafWorldAABB()),
          ...sceneModel.drawers.map((d) => d.getWorldBounds()),
        ];
        const { position: resolvedPos } = resolvePlayerCapsuleCollisions(
          desiredPos,
          ARCHITECTURAL_CONSTANTS.PLAYER_RADIUS,
          activeColliders
        );
        playerStealth.position = resolvedPos;
      }
    }

    // Sync camera to player eye height (lowered when crouching or hiding)
    const eyeHeight =
      playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.CROUCHING
        ? 1.05
        : playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING
        ? 1.35
        : ARCHITECTURAL_CONSTANTS.PLAYER_HEIGHT;
    camera.position.set(playerStealth.position.x, eyeHeight, playerStealth.position.z);

    // 3. Evaluate Wall-Occluded Reticle Raycast at 60fps
    const forward = { x: 0, y: 0, z: -1 };
    if (camera.getWorldDirection) {
      camera.getWorldDirection(forward);
    }
    const occluderBoxes = [
      ...sceneModel.staticColliders,
      ...sceneModel.doors.map((d) => d.getDoorLeafWorldAABB()),
    ];
    const rayHit = mobileUI.evaluateReticleRaycast(
      camera.position,
      forward,
      occluderBoxes,
      targets
    );

    // 4. Evaluate Chaser AI Line-of-Sight & Hiding State
    const aiStatus = chaserAI.evaluateChaseAndHiding(playerStealth, occluderBoxes);

    onHudSync({
      prompt: rayHit.prompt,
      occluded: rayHit.occluded,
      missionState: mission.state,
      panelLED: mission.panelEmissiveLED,
      playerState: playerStealth.getCurrentState(),
      aiState: aiStatus.aiState,
      classroomLightsOn: mission.lights.classroom_lights.active,
    });
  });

  return (
    <group name="RepresentativeClassroomRoot">
      {/* Dynamic Mission Lighting */}
      <ambientLight intensity={mission.lights.classroom_lights.active ? 0.65 : 0.08} />
      <pointLight
        position={[0, 2.95, 0]}
        intensity={mission.lights.classroom_lights.intensity}
        color={mission.lights.classroom_lights.color}
        distance={12}
      />
      <pointLight
        position={[2.75, 2.8, -4.5]}
        intensity={
          mission.lights.electrical_room_lights.active
            ? mission.lights.electrical_room_lights.intensity
            : mission.lights.emergency_red_amber.intensity
        }
        color={
          mission.lights.electrical_room_lights.active
            ? mission.lights.electrical_room_lights.color
            : mission.lights.emergency_red_amber.color
        }
        distance={6}
      />
    </group>
  );
}

export default function ExpoClassroomStealthScene() {
  const joystickVectorRef = useRef({ x: 0, z: 0 });
  const [hud, setHud] = useState({
    prompt: null,
    occluded: false,
    missionState: MISSION_STATES.BLACKOUT_INIT,
    panelLED: '#FF1744',
    playerState: PLAYER_LOCOMOTION_STATES.STANDING,
    aiState: 'PATROL',
    classroomLightsOn: false,
  });

  const runtime = useMemo(() => {
    const sceneModel = buildRepresentativeClassroomScene();
    const chaserAI = new AcousticStealthAI();
    const playerStealth = new PlayerStealthController({
      initialPosition: { x: -1.5, y: 0, z: 0.8 },
    });
    const westLocker = new HidingSpot({
      id: 'hiding_locker_west',
      roomId: 'classroom_101',
      label: 'West Storage Locker',
      entryPosition: { x: -3.1, y: 0, z: 2.15 },
      interiorPosition: { x: -3.62, y: 0, z: 2.15 },
    });

    const mission = new PowerRestorationMissionFSM({
      scene: sceneModel,
      onSoundEmitted: (soundEvent) => {
        const occluders = [
          ...sceneModel.staticColliders,
          ...sceneModel.doors.map((d) => d.getDoorLeafWorldAABB()),
        ];
        chaserAI.processEnvironmentalSound(
          { ...soundEvent, position: { ...playerStealth.position } },
          occluders
        );
      },
    });

    const mobileUI = new MobileInteractionController({
      debounceMs: 180,
      defaultReachMeters: 2.15,
    });

    const teacherDrawer = sceneModel.drawers.find((d) => d.id === 'drawer_teacher_desk_top');
    const supplyDrawer = sceneModel.drawers.find((d) => d.id === 'drawer_supply_cabinet_main');
    const elecDoor = sceneModel.doors.find((d) => d.id === 'door_electrical_room');

    const targets = [
      new RaycastTarget({
        id: 'target_teacher_drawer',
        type: 'drawer',
        label: 'Teacher Desk Drawer',
        min: { x: -1.73, y: 0.55, z: 1.86 },
        max: { x: -1.27, y: 0.69, z: 2.34 },
        getPrompt: () => (teacherDrawer.state === 'IDLE_OPEN' ? 'Close Drawer' : 'Open Drawer'),
        onInteract: () => teacherDrawer.toggle(),
      }),
      new RaycastTarget({
        id: 'target_electrical_key',
        type: 'pickup_item',
        label: 'Electrical Room Key',
        min: { x: -1.6, y: 0.6, z: 1.65 },
        max: { x: -1.4, y: 0.7, z: 1.85 },
        isEnabled: () =>
          teacherDrawer.isItemExposed() && !mission.collectedItems.has('item_electrical_room_key'),
        getPrompt: () => 'Take Electrical Room Key',
        onInteract: () => mission.pickupItem('item_electrical_room_key', teacherDrawer),
      }),
      new RaycastTarget({
        id: 'target_supply_drawer',
        type: 'drawer',
        label: 'Supply Cabinet Drawer',
        min: { x: 2.85, y: 0.77, z: 1.97 },
        max: { x: 3.35, y: 0.93, z: 2.43 },
        getPrompt: () => (supplyDrawer.state === 'IDLE_OPEN' ? 'Close Drawer' : 'Open Drawer'),
        onInteract: () => supplyDrawer.toggle(),
      }),
      new RaycastTarget({
        id: 'target_main_fuse',
        type: 'pickup_item',
        label: '30A Main Fuse',
        min: { x: 3.0, y: 0.82, z: 1.78 },
        max: { x: 3.2, y: 0.94, z: 1.96 },
        isEnabled: () =>
          supplyDrawer.isItemExposed() && !mission.collectedItems.has('item_main_fuse_30a'),
        getPrompt: () => 'Take 30A Main Fuse',
        onInteract: () => mission.pickupItem('item_main_fuse_30a', supplyDrawer),
      }),
      new RaycastTarget({
        id: 'target_elec_door',
        type: 'door',
        label: 'Electrical Room Door',
        min: { x: 1.45, y: 0, z: -4.95 },
        max: { x: 1.55, y: 2.1, z: -4.0 },
        getPrompt: () =>
          elecDoor.isLocked
            ? mission.inventory.has('item_electrical_room_key')
              ? 'Unlock Electrical Room'
              : 'Locked (Needs Key)'
            : 'Open/Close Electrical Room',
        onInteract: () => mission.unlockElectricalRoomDoor(elecDoor),
      }),
      new RaycastTarget({
        id: 'target_west_locker_hide',
        type: 'hiding_spot',
        label: 'West Storage Locker',
        min: { x: -3.95, y: 0, z: 1.8 },
        max: { x: -3.3, y: 2.0, z: 2.5 },
        getPrompt: () =>
          playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING
            ? 'Exit Locker'
            : 'Hide in Locker',
        onInteract: () => {
          if (playerStealth.getCurrentState() === PLAYER_LOCOMOTION_STATES.HIDING) {
            return playerStealth.exitHidingSpot();
          }
          const occluders = [
            ...sceneModel.staticColliders,
            ...sceneModel.doors.map((d) => d.getDoorLeafWorldAABB()),
          ];
          const seen = chaserAI.hasLineOfSight(playerStealth.position, occluders, playerStealth);
          return playerStealth.enterHidingSpot(westLocker, { chaserHasLineOfSight: seen });
        },
      }),
    ];

    return { sceneModel, mission, mobileUI, playerStealth, chaserAI, targets };
  }, []);

  return (
    <View style={styles.container}>
      <Canvas camera={{ fov: 65, near: 0.1, far: 45 }}>
        <Bvh firstHitOnly>
          <ClassroomSimulationLoop
            {...runtime}
            joystickVectorRef={joystickVectorRef}
            onHudSync={setHud}
          />
        </Bvh>
      </Canvas>

      {/* Center Reticle & Contextual Prompt */}
      <View style={styles.reticleContainer} pointerEvents="none">
        <View style={[styles.reticleDot, hud.prompt ? styles.reticleActive : null]} />
        {hud.prompt && <Text style={styles.promptText}>{hud.prompt}</Text>}
      </View>

      {/* Mobile ACTION Button (Debounced + Touch Cancel Safe for Expo Go on iPhone) */}
      <Pressable
        style={({ pressed }) => [
          styles.actionButton,
          !hud.prompt && styles.actionButtonDisabled,
          pressed && styles.actionButtonPressed,
        ]}
        onPressIn={(e) => {
          runtime.mobileUI.pressActionButton({
            timestampMs: e.nativeEvent.timestamp || Date.now(),
            touchId: e.nativeEvent.identifier ?? 1,
          });
        }}
        onPressOut={(e) => {
          runtime.mobileUI.releaseActionButton({
            touchId: e.nativeEvent.identifier ?? 1,
          });
        }}
        onTouchCancel={() => runtime.mobileUI.cancelTouch()}
      >
        <Text style={styles.actionButtonLabel}>ACTION</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090B10' },
  reticleContainer: {
    position: 'absolute',
    top: '48%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  reticleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  reticleActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#00E676',
  },
  promptText: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  },
  actionButton: {
    position: 'absolute',
    bottom: 42,
    right: 32,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(71, 85, 105, 0.55)',
  },
  actionButtonPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: '#1D4ED8',
  },
  actionButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.8,
  },
});
