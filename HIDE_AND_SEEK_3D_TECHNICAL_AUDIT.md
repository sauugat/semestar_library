# Hide & Seek — 3D Interior Realism, Lighting & Environment Overhaul
## Technical Audit & Engineering Plan

**Target Engine**: Three.js r128 inside Expo `react-native-webview`  
**Primary Source Files**:
- `mobile/components/games/hide-and-seek/gameHtml.ts`
- `mobile/components/games/hide-and-seek/horrorConfig.ts`
- `mobile/components/games/hide-and-seek/HideAndSeekScreen.tsx`
- `mobile/components/games/hide-and-seek/campusLayoutLoader.ts`
- `gandaki-campus-layout.json`

---

## 1. Identified Visual & Architectural Defects, Technical Causes & Responsible Functions

### Defect 1: Exterior Objects & Campus Sectors Disappearing When Entering or Leaving Rooms
- **Symptom**: Standing inside a classroom or stepping through a doorway causes the outside campus courtyard, nearby buildings, trees, and exterior objects to vanish into an empty dark void. Similarly, stepping out of rooms causes sudden popping.
- **Technical Cause**:
  1. In `updateRoomAndBuildingVisibility` (`gameHtml.ts:19050–19085`), when `currentInsideRoom` is non-null:
     - `if (secDist > 2.5 || sec.id === 'central-courtyard') { sec.group.visible = false; continue; }` forcibly hides the entire `central-courtyard` sector and every building sector further than `2.5m` from the player.
     - `if (activeBuildingKey === 'ROTUNDA' && sec.id !== 'rotunda-complex') { sec.group.visible = false; continue; }` hides the entire campus when inside the Rotunda.
  2. In `updateRoomAndBuildingVisibility` (`gameHtml.ts:19090–19115`), exterior streetlamps beyond `28.0m`, all `rainPuddles`, and all `treeShadowDecals` are forcibly hidden (`visible = false`) whenever `currentInsideRoom` is truthy.
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `updateRoomAndBuildingVisibility()` (lines 18946–19255), `finalizePhaseASceneOptimization()` (lines 18824–18915).
- **Proposed Correction**:
  - Never hide `central-courtyard` or surrounding exterior building sectors when `currentInsideRoom` is true. Because static building sectors are already merged and instanced (`bakeStaticGroup` reduces each sector to ~6–12 draw calls), keeping exterior sectors within `95m` visible while indoors costs <35 draw calls and ensures seamless visibility through open doorways and windows.
  - Keep exterior lamps, rain puddles, and tree shadows visible through windows and doorways within `75m` whether indoors or outdoors.

---

### Defect 2: Walls & Adjacent Rooms Disappearing When Entering Rooms or Looking Around Indoors
- **Symptom**: When walking into a room, standing near a doorway, or turning the camera inside a room, adjacent rooms, corridors, or partition walls disappear or pop out of existence.
- **Technical Cause**:
  1. **Coordinate Mismatch in `ROOM_DEFINITIONS`**: At `gameHtml.ts:11665–11920`, `ROOM_DEFINITIONS` hardcodes stale bounds (e.g., `West Wing L1 Room 1` has `minX: -10.3, maxX: -2.7, minZ: -33.0, maxZ: -23.0`), whereas `bldg_west_wing_l1` is actually placed at `(-4.0, 1.4, -9.51)` with East-West width `32.5m` and depth `7.6m` (`x` in `[-20.25, 12.25]`, `z` in `[-13.31, -5.71]`). Furthermore, `getRoomBuildingKey(id)` returns `'OTHER'` for dynamically registered rooms because `getOrRegisterRoomDefinition` defaults `building = 'OTHER'` when not pre-populated or when called with generic arguments.
  2. **Over-Aggressive Sightline Dot-Product Culling**: In `updateRoomAndBuildingVisibility` (`gameHtml.ts:19020–19028`), when `effDist > 4.2`, `if (dot < 0.05) r.group.visible = false;` culls any room whose center is >87° from the camera forward vector. With a 68° vertical FOV (~95°–105° horizontal FOV in 16:9 landscape), the peripheral frustum extends to `±52°` (`dot = cos(52°) ≈ 0.61`, or when standing near a wide room's edge, `dot` to the room center can be `-0.35` while half the room is still on screen!). This causes rooms and interior walls to vanish when turning the camera.
  3. **Same-Wing Room Culling**: `if (currentInsideRoom && r.type === 'room' && dist > 7.2) r.group.visible = false;` hides adjacent rooms in the same wing even when looking through open doors or corridor windows.
  4. **Corridor & Wing Axis Misalignment**: `populateClassroomUnit` is always called with `6.8m × 8.2m` local room bounds regardless of whether the wing is oriented East-West (`buildEnterableClassroomWing`, where each room is `roomW = width / numRooms` wide along X and `depth = 7.6m` along Z) or North-South (`buildLongitudinalClassroomWing`, where each room is `width = 7.6m` along X and `roomLen = length / numRooms` along Z). In `buildLongitudinalClassroomWing` (`East Wing R2`, `East Wing R4`), `populateClassroomUnit` places a `6.8m × 8.2m` ceiling and furniture oriented for a Z-doorway (`facingDirZ = 1`) even though the doors are on the X-wall (`doorAxis = 'x'`)! And in `buildEnterableClassroomWing` (`bldg_6`, `bldg_10`, `bldg_11`, `bldg_12` which are `52m` wide with 3 rooms of `17.33m` width each, or `bldg_5` which is `34.5m` wide with 3 rooms of `11.5m` width), the interior ceiling (`6.8m × 8.2m`), dado bands, and walls do not span the actual room width, leaving gaps and floating/misaligned interior elements!
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `updateRoomAndBuildingVisibility()` (lines 18946–19045), `populateClassroomUnit()` (lines 12350–12450), `buildLongitudinalClassroomWing()` (lines 12569–12740), `buildEnterableClassroomWing()` (lines 12742–12890).
- **Proposed Correction**:
  - Pass the exact `roomW` and `roomD` (and `buildingKey`) into `populateClassroomUnit` and all interior archetype builders so ceilings, floor tiles, skirting boards, dado rails, window curtains, and furniture fit the exact room dimensions and doorway orientation (`doorAxis = 'x'` vs `'z'`).
  - Replace the brittle manual center-point `dot < 0.05` and `dist > 7.2` room culling with frustum-safe bounding-sphere + building-neighborhood visibility: keep all rooms in the current building AND any room within `28m` whose bounding sphere intersects the camera frustum (or is within `12m` omnidirectionally) visible.

---

### Defect 3: Overlapping Full Walls Behind Windows & Inconsistent Door/Window Openings
- **Symptom**: Windows on exterior walls have solid stucco/brick wall boxes directly behind them (`buildWallSegment` creates a single continuous full-height box across the entire back wall and side segments), so players cannot see through windows from outside into rooms or from inside out to the campus.
- **Technical Cause**:
  1. In `buildEnterableClassroomWing` (`gameHtml.ts:12781`) and `buildLongitudinalClassroomWing` (`gameHtml.ts:12618`), the window wall is built as a single solid `BoxGeometry` (`buildWallSegment(cx, floorH, backZ, width, wallH, wallT, ...)`), and `buildDetailedWindow` simply places a window frame and glass plane offset by `0.14m` in front of the solid wall! Because the solid opaque wall spans behind the glass, looking through any window shows only the opaque wall or causes Z-fighting.
  2. In `buildPlaceholderCampusBuilding` (`bldg_15` and `bldg_48`, lines 12892–12942), the building has a doorway and swinging door, but no interior rooms or partition walls are populated inside `bldg_48`, and windows sit on solid walls.
  3. DoubleSide materials (`campusStucco`, `nepalDachiBrick`, `nepalOchreDado`, `nepalCreamPlaster` at lines 6800–6865) were used as a workaround instead of proper closed 3D wall boxes with real window/doorway cutouts.
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `buildWallSegment()`, `buildWallWithWindowOpenings()` (missing), `buildLongitudinalClassroomWing()`, `buildEnterableClassroomWing()`, `buildPlaceholderCampusBuilding()`, `buildTwoStoreyAdminOfficeBlock()`, `buildDetailedWindow()`.
- **Proposed Correction**:
  - Implement a dedicated `buildWallWithWindowOpenings()` architectural builder that constructs genuine 3D wall piers (left/right/inter-window piers), sill walls (`floorY` to `sillY`), and lintel/spandrel walls (`headY` to ` floorY + wallH`) around every window opening—never placing a solid wall behind a window or doorway.
  - Make window glass genuinely transparent (`MeshStandardMaterial` / `MeshPhysicalMaterial` with low opacity `0.28–0.36`, dirty glass roughness/normal map, `depthWrite: false`) with 3D hollow frames on both interior and exterior faces so players can look straight through windows into classrooms and out to the campus.
  - Use `THREE.FrontSide` on opaque architectural box meshes with proper outward-facing normals and manifold box thickness (`0.24m–0.32m`).

---

### Defect 4: Floating Objects, Furniture Clipping & Un-Grounded Props
- **Symptom**: Classroom furniture, corridor props, ceiling fixtures, and certain exterior/interior items float above floors or clip into walls/other objects.
- **Technical Cause**:
  1. **Ceiling Gap (`0.17m` Floating Gap)**: `wallH` in `buildEnterableClassroomWing` and `buildLongitudinalClassroomWing` is `3.55m`, while `populateClassroomUnit` places `ceilPanel` at `y = 3.38m` (`6.8m × 8.2m`), leaving a `0.17m` vertical gap below the roof eaves and huge horizontal gaps in wide rooms (`11.5m` to `17.3m` wide), plus ceiling fans and tube lights hanging from a `6.8m` floating ceiling patch in the middle of a `17.3m` room.
  2. **Longitudinal Wing Interior Rotation Bug**: In `buildLongitudinalClassroomWing` (`East Wing R2` and `East Wing R4`), rooms have `width = 7.6m` (X) and `roomLen = 6.83m–7.16m` (Z), with doors on the West wall (`doorWallX = cx - width/2`, `doorAxis = 'x'`). However, `populateClassroomUnit` builds the classroom interior assuming the door is on the Z wall (`boardZ = facingDirZ * -3.1`, side dado at `x = ±3.36m`, cupboard at `x = ±3.02m` which blocks the West doorway or clips through the wall!).
  3. **Desk & Chair Grounding**: In `buildDetailedClassroomInterior` (`gameHtml.ts:10912`), `deskGroup` places `topMesh.position.y = 0.75`, `legL.position.y = 0.37` (`sharedGeos.deskLeg` has height `0.72m` + feet at `-0.35m` -> bottom at `0.37 - 0.362 = +0.008m`, floating `8mm`), and `tDesk` (`step2Geos.officeDesk`) is placed at `y = 0.42` while its geometry (`lines 9453–9456`) has pedestals of height `0.68m` centered at `y = 0.0` (bottom at `0.42 - 0.34 = +0.08m`, so the teacher desk floats **8 cm** in the air!). Similarly, in `buildStaffAdminOfficeInterior` (`line 11288`), `oDesk.position.set(dx, 0.38, dz)` floats **4 cm** in the air (`0.38 - 0.34 = 0.04m`), and `tChair` at `y = 0.50` (`sharedGeos.chairSeat` bottom is at `-0.44m`, so `0.50 - 0.44 = +0.06m`, floating **6 cm** above the floor!).
  4. **Corridor Props Clipping**: In `populateCorridorProps` (`line 10540`), `corridorX` is `doorWallX` (the center of the `0.24m` wall), and props like `dadoStrip` (`-wallSignX * 0.02`), `baseboard` (`-wallSignX * 0.025`), and `transomFrame` (`-wallSignX * 0.03`) are placed inside the `0.24m` wall thickness (`±0.12m`), causing coplanar Z-fighting with the wall! And `doorZList` is not checked when placing `lockerZ = -length * 0.16`, `shoeBank = lockerZ - 2.15`, `nbZ = length * 0.16`, `wdZ = lockerZ + 1.35`, `feZ = nbZ - 1.35`—some of which overlap doorway openings (`doorZList`)!
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `sharedGeos`, `step2Geos` (lines 9200–9500), `buildDetailedClassroomInterior()` (lines 10749–11000), `buildStaffAdminOfficeInterior()` (lines 11240–11340), `populateCorridorProps()` (lines 10440–10600), `populateClassroomUnit()` (lines 12350–12450).
- **Proposed Correction**:
  - Normalize all furniture geometry pivots or Y-positions so every leg/pedestal bottom sits at `y = 0.000m` flush on the floor (`tDesk.position.y = 0.34`, `tChair.position.y = 0.44`, `deskLeg.position.y = 0.36`, etc.).
  - Orient room interior groups (`cGroup.rotation.y`) according to `doorAxis` and `doorDirSign` so `buildLongitudinalClassroomWing` rooms (`doorAxis = 'x'`) rotate their interior layout by `±90°`, keeping the doorway wall clear and aligning desks, whiteboards, windows, and switches with the actual walls.
  - Offset all wall-mounted corridor and interior props outside the wall half-thickness (`wallT * 0.5 + 0.015m`) and guard corridor prop Z positions against `doorZList` so no locker, water dispenser, or noticeboard ever overlaps a doorway or window.

---

### Defect 5: Surface Materials & Texture Quality
- **Symptom**: Some surfaces use flat single-color `MeshStandardMaterial` (e.g., `campusObjectMats.carSilver`, `dustbinGreen`, `acBodyMat`, `interiorSystemMats.panelSteelGrey`, `corridorDadoGreenGrey`, `switchPlateIvory`, `libraryDarkTable`) without normal/roughness/albedo maps, while other textures repeat noticeably across long walls.
- **Technical Cause**:
  - `interiorSystemMats` and `campusObjectMats` define several bare color-only materials without procedural albedo, normal, or roughness maps.
  - Wall UVs on `BoxGeometry(width, wallH, wallT)` stretch a single `[0..1]` UV across `8m` to `52m` walls unless UV coordinates are world-scaled in `buildWallSegment` / `buildWallWithWindowOpenings`.
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `createProceduralTextureWithBump()` (lines 5233–6050), `materials` / `step2Mats` / `interiorSystemMats` / `campusObjectMats` (lines 6800–9160), `buildWallSegment()` (line 7736).
- **Proposed Correction**:
  - Apply world-space UV scaling (`createWorldScaledBoxGeo`) on walls, floors, ceilings, plinths, and skirting boards so brick, plaster/stucco, ceramic floor tiles, and ceiling grids maintain consistent real-world metric texel density regardless of wall/room dimensions, eliminating stretched or distorted textures.
  - Upgrade all remaining flat materials (`panelSteelGrey`, `corridorDadoGreenGrey`, `switchPlateIvory`, `libraryDarkTable`, `lockerSteel`, `lockerDoorBlue`, `ceramicWhite`, `stainlessSteel`, etc.) to full PBR materials bound to shared normal, roughness, and subtle environmental wear/grime maps.

---

### Defect 6: Lighting & Shadow Realism Indoors vs. Outdoors
- **Symptom**: Rooms either rely on a single shared override point light (`lampFlickerMod.indoorOverrideLight` hijacking slot 0 of the streetlamp pool) or look flat when looking from outside into a lit room. Flashlight orientation lags or detaches in third-person/peek states, and static room geometry lacks rich bounce/shadow contrast.
- **Technical Cause**:
  1. `lampFlickerMod` only allocates 1 `indoorOverrideLight` (slot 0) when the player is physically inside a room (`Math.abs(playerPos.x - rf.worldX) <= hw + 1.5`), so when standing in a corridor or outside looking through a doorway/window into a lit room, that room has zero real-time point light illumination.
  2. `applyBakedVertexAO` (`gameHtml.ts:1261–1330`) computes AO using the bounding box of the merged material bucket (`bbox.min.x`/`max.x`), which for a small prop bucket (like books or switches) treats the prop's own bounding box as the "room perimeter," arbitrarily darkening vertices!
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `NightAtmosphere` (lines 3355–4050), `LampFlicker` (lines 4410–5015), `updateRoomMoodLighting()` (lines 12215–12335), `applyBakedVertexAO()` (lines 1261–1330).
- **Proposed Correction**:
  - Pass explicit room bounds (`roomBox`) into `applyBakedVertexAO` so baked vertex lighting accurately darkens true room corners, floor-wall skirting creases, ceiling covings, and under-furniture cavities while baking subtle directional window/ceiling bounce gradients into static room vertices.
  - Upgrade `LampFlicker` + `updateRoomMoodLighting` to support up to **3 closest visible indoor room PointLights** (in addition to exterior streetlamp PointLights) modulated by each room's switch state, campus power state, and flicker profile, so looking into rooms from corridors or outside shows genuine 3D light falloff on desks and walls.
  - Ensure the player's flashlight spotlight (`atmosphere.flashlight`) and target remain tightly synchronized with the camera's forward vector and position across all movement states, with realistic dual-cone penumbra and surface normal response.

---

### Defect 7: Interactive Objects Missing Full Gameplay Integration (Lockers as Hiding Spots, Windows/Doors/Panels/Lights)
- **Symptom**:
  1. Corridor lockers (`type: 'locker'`) open and close, but do **not** register hiding spots or allow the player to hide inside them with proper collision/visibility handling.
  2. Rooms lack dedicated interior metal lockers that can be opened, searched, AND hidden inside.
  3. Windows (`buildDetailedWindow`) register an interactable at `y = wy - 1.85`, which for upper-floor windows or raised plinths can be slightly off from `floorY`, and window glass uses opaque `windowWarmLit` when `isWarmLit = true`, preventing players from seeing through the window when opened.
  4. Electrical switches and panels need unified sound effects (distinct mechanical switch click, heavy breaker clunk, window slide sound, locker metallic latch sound, drawer slide sound) and complete power-dependency across all room lights.
- **Responsible Files & Functions**:
  - `gameHtml.ts`: `populateCorridorProps()` (lines 10545–10605), `buildDetailedClassroomInterior()` (lines 10749–11000), `buildDetailedWindow()` (lines 7963–8050), `toggleInteriorInteractable()` (lines 21810–21965), `SoundEngine` (lines 1650–2600).
- **Proposed Correction**:
  - Add interactive metal lockers inside classrooms/labs/corridors that support both **opening/searching** AND **player hiding** (with interior hiding camera position, door closing around player, collision bypass while hidden, and clean exit restoration).
  - Fix `buildDetailedWindow` so both sashes use transparent glass (`materials.windowGlass`), the right sash slides open smoothly with a dedicated window-slide sound effect, and `y` is anchored to the true floor elevation.
  - Connect room light switches and ceiling lights directly to the building/campus electrical panel power state so cutting power at a breaker panel extinguishes dependent room lights and triggers emergency/blackout lighting states.

---

## 2. Performance Implications & Mobile Budget Strategy

Because the game runs inside an Expo `WebView` on mobile devices:
1. **Draw Calls**: By keeping `bakeStaticGroup()` per room and per exterior sector (which merges static meshes sharing a material into a single indexed `BufferGeometry` and instances repeated furniture with `THREE.InstancedMesh`), adding real window openings, skirting boards, door frames, and detailed university props adds **zero extra draw calls** per room (each room remains ~8–14 draw calls).
2. **Dynamic Lights**: Capping active PointLights to a pooled budget (max 8 active lights total across nearest indoor rooms and nearest exterior streetlamps, with `castShadow = false` on pooled PointLights and selective `PCFSoftShadowMap` on `moonDirLight` + `flashlight`) prevents mobile fragment shader uniform/ALU bottlenecks.
3. **Texture Memory**: Reusing 512×512 procedural PBR texture bundles (`map`, `normalMap`, `roughnessMap`) via `window.__PROCEDURAL_TEX_CACHE__` and the shared `1024×512` interior surface atlas caps total GPU texture memory under ~28 MB.

---

## 3. Staged Implementation Plan

1. **Stage 1 — Interior/Exterior Visibility & Culling Architecture (`gameHtml.ts`)**:
   - Fix `updateRoomAndBuildingVisibility` so exterior sectors (`central-courtyard`, adjacent buildings, streetlamps, trees, puddles) never disappear when entering a room or looking out through doorways/windows.
   - Replace the narrow `dot < 0.05` and `dist > 7.2` room culling with frustum-aware bounding-sphere + same-building visibility so walls and rooms never pop out when turning the camera indoors.
2. **Stage 2 — Architectural Geometry Reconstruction & Grounding (`gameHtml.ts`)**:
   - Implement `createWorldScaledBoxGeo` and `buildWallWithWindowOpenings` so every exterior and corridor window has a real 3D opening (sill wall, lintel wall, piers, and hollow frame) with transparent glass instead of overlapping full walls.
   - Add proper room floor slabs with thickness, skirting boards, corner trims, and room-fitted ceilings (`roomW × roomD` at `wallH`) across all buildings (`buildEnterableClassroomWing`, `buildLongitudinalClassroomWing`, `buildPlaceholderCampusBuilding`, `buildTwoStoreyAdminOfficeBlock`, and `bldg_guardhouse`).
   - Fix longitudinal wing room orientation (`doorAxis = 'x'`) and ground all furniture meshes (`officeDesk`, `chairSeat`, `deskLeg`, `podium`, `lockerBank`, `cupboard`, etc.) at `y = 0.000m` with zero wall/doorway clipping.
3. **Stage 3 — Complete PBR Material & Texture Overhaul (`gameHtml.ts`)**:
   - Upgrade all architectural and furniture materials to full PBR (`map`, `normalMap`, `roughnessMap`, metalness, and environmental wear/grime) with world-scaled UVs.
4. **Stage 4 — Realistic Horror Lighting & Flashlight System (`gameHtml.ts`, `horrorConfig.ts`)**:
   - Upgrade `applyBakedVertexAO` to use true room-space bounds and directional window/ceiling bounce lighting.
   - Upgrade `updateRoomMoodLighting` and `LampFlicker` to allocate pooled PointLights to the closest visible indoor rooms as well as exterior lamps, with power-state and switch-state coupling.
5. **Stage 5 — Functional Environmental Objects & University Detailing (`gameHtml.ts`)**:
   - Upgrade doors, hideable/searchable lockers, drawers, transparent sliding windows, electrical panels, and switches with distinct synthesized audio and full state persistence.
   - Enrich university room interiors (teacher tables, whiteboards, noticeboards, wall clocks, dustbins, bookshelves, ceiling fans, tube lights, curtains, storage cabinets, and lab equipment).
6. **Stage 6 — Automated Verification against all 12 Acceptance Criteria (`mobile/test/hide-and-seek-audit.test.mjs`)**:
   - Expand the automated test suite to verify all 12 acceptance criteria (entering/exiting every interior, doorway/window sightlines, camera near-wall stability, furniture floor contact, collision boundaries, lighting/flashlight, interactive object states, room-to-room visibility, and draw-call/performance budgets).
