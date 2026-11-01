# PHASE 12 — PHOTOREALISTIC GRAPHICS OVERHAUL
## Stage A: Comprehensive Graphics Engine Technical Audit

**Target Engine**: Three.js r128 inside Expo `react-native-webview`  
**Audited Source Files**:
- `mobile/components/games/hide-and-seek/gameHtml.ts` (24,990 lines)
- `mobile/components/games/hide-and-seek/horrorConfig.ts` (406 KB)
- `mobile/components/games/hide-and-seek/HideAndSeekScreen.tsx`
- `mobile/components/games/hide-and-seek/threeMinJs.ts` (Three.js r128)
- `scripts/blender/classroom_builder.py`, `classroom_materials.py`, `classroom_lighting_and_baking.py`
- `scripts/blender/computer_lab_builder.py`, `computer_lab_materials.py`, `computer_lab_lighting_and_baking.py`
- `scripts/blender/library_builder.py`, `library_materials.py`, `library_lighting_and_baking.py`

---

## 1. Visual Gap Analysis: Reference Images vs. Current Engine Output

Comparing the three target survival-horror reference images (`IMG_6908`, `IMG_6909`, `IMG_6910`) against our current in-game captures (`01_campus_exterior_night.png`, `existing_lab_01.png`, `existing_classroom_01.png`, `existing_windows_05.png`) reveals why the current scene looks like a flat procedural prototype rather than a cinematic survival-horror environment:

| Visual Dimension | Reference Benchmark (`IMG_6908`–`6910`) | Current Engine Output (`gameHtml.ts`) | Root Technical Cause |
| :--- | :--- | :--- | :--- |
| **Concrete & Plaster Walls** | Multi-scale surface roughness, panel rivets/fasteners, water runoff stains under eaves/windows, hairline cracks, worn edges, dirty plinth splash zone. | Flat `#998b70` fill with 8 uniform vertical lines (`pale-campus-stucco`, lines 5502–5526) or solid-color untextured Blender GLB walls (`Mat_Wall_Plaster`, `Mat_Wall_Dado`). | `createProceduralTextureWithBump('pale-campus-stucco')` draws only flat `fillRect` stripes with zero multi-octave noise, zero water stains, and zero micro-roughness variation. |
| **Roads, Pavements & Wet Surfaces** | Rain-slicked dark asphalt and interlocking brick pavers with spatially varying roughness (`0.06` in puddles to `0.78` on dry porous patches), crisp warm streetlamp reflections, alligator cracks, curb stones, gravel & scattered leaves. | Uniformly smooth brown/grey road ribbon (`buildTerrainDrapeRibbon`, lines 13893–13917) using `naturalGroundTex` with constant roughness (`0.35–0.42`) and no puddle masks, no curbs, and no normal-mapped cracks. | `materials.asphaltRoad` and `interlockingPavers` lack a dedicated high-contrast wetness/puddle roughness map, normal-mapped cracks, and Fresnel-driven specular road reflections. |
| **Street Lamps & Night Lighting** | Warm sodium/incandescent streetlamp heads (`~2400K`) with physical glass panes, soft atmospheric bloom halo, inverse-square ground light pools, and cool moonlit sky/cloud contrast (`~6500K`). | Either a hard-edged translucent `ConeGeometry` (`existing_lab_01.png`) or 3 pooled `PointLight`s with short range (`17.8m`) and flat additive circles on the ground (`createRealisticGroundPoolTexture`). | Pooled `PointLight`s only cover 3 lamps at once (`maxActiveLampLights: 3`); unpooled lamps have zero 3D normal-mapped surface lighting on surrounding walls and pavements. |
| **Post-Processing & Tonemapping** | Filmic ACES contrast with rich shadow toe, soft highlight bloom on emissive fixtures, subtle chromatic aberration at frame edges, micro-contrast, and fine organic film grain. | `gradeMat` fragment shader (lines 4195–4235) declares `uBloomStrength`, `uMicroContrast`, `uChromaStrength`, `uBlackLift`, and `uEdgeDesat` in `gradeUniforms`, **but completely omits them from the GLSL fragment shader**! | Dead uniforms in `NightAtmosphere.initColorGradePass`—bloom, micro-contrast, chromatic aberration, and black-lift are never executed in GLSL. |
| **Tihar Festival Lighting** | Warm flickering clay diyos (`1950K`) and colorful Jhilimili string lights reflecting on wet pavements and illuminating doorways/windowsills. | `TiharNightExperience.finalizeGeometry()` (lines 19260–19264) forcibly sets `this.instDiyoPools.count = 0; this.instDiyoPools.visible = false; this.instJhilimiliBulbs.count = 0; this.instJhilimiliBulbs.visible = false;`! | A prior workaround disabled all 1,800+ Jhilimili string light bulbs and all 750 Diyo warm light pools instead of fixing their frustum/distance culling and shader attenuation. |
| **Environmental Detail** | Hanging electrical cables between poles/buildings, wall-mounted junction boxes and conduit pipes, drainage channels, concrete curbs, rocks, weeds/bushes, and weathered timber decks. | Bare box buildings meeting flat ground planes with no curbs, no drainage gutters, no wall-mounted electrical boxes/conduits, and no catenary utility wires on building facades. | Missing instanced architectural detailing pass on campus buildings, alleys, and road edges. |

---

## 2. Point-by-Point Technical Audit of the 13 Graphics Subsystems

### 2.1 Three.js r128 Renderer Configuration
- **Location**: `gameHtml.ts` (`NightAtmosphere.constructor`, lines 3515–3605) & `horrorConfig.ts` (lines 88–101).
- **Current State**:
  - `THREE.WebGLRenderer` is initialized with `{ canvas: canvasEl, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'default' }`.
  - `renderer.physicallyCorrectLights` is **not** enabled, causing Three.js r128 point/spot light decay to behave non-physically unless carefully calibrated.
  - `antialias: false` is hardcoded even on High/Ultra desktop and modern mobile GPUs when rendering directly or when `gradeTarget` is bypassed.
- **Proposed Fix**:
  - Enable `powerPreference: 'high-performance'` on High/Ultra tiers, enable hardware `antialias: true` on High/Ultra when supported, and calibrate physically based light attenuation and specular energy conservation in custom shader chunks.

### 2.2 WebGL Capabilities & Supported Extensions
- **Location**: `gameHtml.ts` (lines 3520–3600, 6100–6160).
- **Current State**:
  - `renderer.capabilities.getMaxAnisotropy()` is never queried globally; only `rotundaBrick` and `rotundaWindowWarm` set `anisotropy = 8`, while road, paver, stucco, wood, and interior floor textures default to `anisotropy = 1`! At oblique viewing angles (looking down roads, alleys, and corridors as in `IMG_6908`–`6910`), `anisotropy = 1` blurs ground textures into muddy streaks within 4 metres of the camera.
  - `gradeTarget` (`THREE.WebGLRenderTarget` at line 4140) uses default `UnsignedByteType` (`RGBA8`) without checking for `HALF_FLOAT` (`EXT_color_buffer_half_float` / WebGL2 ` HalfFloatType`), causing HDR lamp highlights to clip to `1.0` before reaching the post-processing pass.
- **Proposed Fix**:
  - Query `maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())` and apply anisotropic filtering + trilinear mipmapping (`THREE.LinearMipmapLinearFilter`) across all ground, road, paver, wall, and wood textures on High/Balanced tiers.
  - Use `THREE.HalfFloatType` for `gradeTarget` when `renderer.capabilities.isWebGL2` or `OES_texture_half_float_linear` is supported so HDR emissive streetlamps and wet reflections preserve dynamic range into the bloom and ACES tonemapping pass.

### 2.3 Existing Material Pipeline
- **Location**: `gameHtml.ts` (`materials` at lines 6180–7340, `step2Mats` at lines 9500–9750, `interiorSystemMats` at lines 9850–10050, `campusObjectMats` at lines 14200–14450).
- **Current State**:
  - `pale-campus-stucco` (lines 5502–5526) is just a flat `#998b70` canvas with 8 vertical lines—zero concrete/plaster grain, zero water stains, zero cracks, zero normal map depth.
  - `materials.asphaltRoad` is not even a distinct weathered asphalt PBR material with puddles and cracks—roads use `sculptedTerrainMat` / basic dark grey with uniform roughness.
  - Many secondary materials (`campusObjectMats.acBodyMat`, `interiorSystemMats.panelSteelGrey`, `corridorDadoGreenGrey`, `switchPlateIvory`, `rubberTire`) lack normal and roughness maps.
- **Proposed Fix**:
  - Overhaul `createProceduralTextureWithBump()` to synthesize high-resolution (1024×1024 on High/Ultra, 512×512 on Balanced/Performance) multi-layered PBR texture sets (`map`, tangent-space `normalMap`, `roughnessMap`, `aoMap`/`bumpMap`) for:
    1. **Weathered Concrete & Plaster (`pale-campus-stucco`, `peeling-paint-wall`)**: Multi-octave Perlin/Worley surface grain, panel seam recesses, rivet/fastener rows (matching `IMG_6910`), sub-window water runoff stains, rising damp/moss at wall bases, and micro-cracks.
    2. **Wet Cracked Asphalt (`wet-cracked-asphalt`) & Interlocking Pavers (`interlocking-pavers`)**: Dark coarse aggregate, branching cracks, oil/water stains, and a dual-regime roughness map (`roughness = 0.05–0.12` in wet puddles, `0.22–0.32` on damp film, `0.68–0.82` on dry porous stone/asphalt) matching `IMG_6908` and `IMG_6909`.
    3. **Weathered Wood (`worn-wood-grain`, `carved-sal-wood`)**: Plank seams, wood fiber grain, edge wear, scratches, and wet veranda deck sheen (matching the right veranda in `IMG_6910`).
    4. **Rusted & Painted Metal (`rusted-painted-metal`, `bus-body`)**: Edge wear, oxidation patches, scratches, and metallic roughness contrast.
    5. **Dirty Architectural Glass (`dirty-window-glass`)**: Rain streaks, corner grime condensation, Fresnel reflectivity, and clear interior visibility.

### 2.4 Texture Loading & Colour-Space Handling
- **Location**: `gameHtml.ts` (lines 5335–6150).
- **Current State**:
  - In `createProceduralTextureWithBump`, `map` (albedo), `bumpMap`, `normalMap`, and `roughnessMap` are all created as `new THREE.CanvasTexture(...)` without setting `encoding = THREE.sRGBEncoding` / `colorSpace = THREE.SRGBColorSpace` on `map`!
  - Because `renderer.outputEncoding = THREE.sRGBEncoding` is enabled (line 3581), leaving `map.encoding` at `THREE.LinearEncoding` causes Three.js to skip sRGB-to-linear degamma on albedo textures, washing out midtones and reducing material contrast! Meanwhile, `normalMap` and `roughnessMap` *must* remain `THREE.LinearEncoding`.
- **Proposed Fix**:
  - Explicitly set `map.encoding = THREE.sRGBEncoding` (and `colorSpace = THREE.SRGBColorSpace`) on all albedo and emissive `CanvasTexture`s while keeping `normalMap`, `roughnessMap`, and `bumpMap` strictly linear (`THREE.LinearEncoding`), and adjust albedo base values so linear-space PBR lighting produces rich, physically accurate contrast.

### 2.5 Tone Mapping & Exposure
- **Location**: `gameHtml.ts` (lines 3583–3586, 4195–4235).
- **Current State**:
  - `renderer.toneMapping = THREE.ACESFilmicToneMapping` with `toneMappingExposure = 0.7`.
  - When `gradeTarget` is active, Three.js applies `ACESFilmicToneMapping` when rendering `this.scene` into `this.gradeTarget`, and then `gradeMat` applies a raw `pow(c, vec3(uContrast))` on top without shoulder roll-off.
- **Proposed Fix**:
  - Calibrate `toneMappingExposure` (`0.78`) and upgrade the `gradeMat` fragment shader to perform proper filmic toe/shoulder grading, highlight bloom extraction, and luminance-preserving color balance.

### 2.6 Shadow Mapping
- **Location**: `gameHtml.ts` (lines 3588–3678).
- **Current State**:
  - `moonDirLight.shadow.camera` is fixed at `[-52..52, -68..68]` around the origin, even though the campus spans `[-95..45]` in X and `[-135..58]` in Z! When the player walks to the Grand Rotunda (`z = -115`) or West Classrooms (`x = -63`), the player is **outside the moon shadow map frustum**, so moonlight shadows completely disappear!
  - Pooled `PointLight`s do not cast shadows (`castShadow = false`), which is necessary for mobile FPS, but streetlamps and furniture lack localized contact shadows and directional light-grounding.
- **Proposed Fix**:
  - Dynamically re-center `moonDirLight` and its shadow camera frustum (`±48m` snapped to texel grid to prevent shadow swimming!) around `playerPhysics.pos` every frame so crisp `2048×2048` (`PCFSoftShadowMap`) moonlight shadows cover the player's surroundings everywhere on campus!
  - Add contact shadow decals and vertex AO grounding under all streetlamps, curbs, boulders, buses, benches, and building plinths.

### 2.7 Existing Fog
- **Location**: `gameHtml.ts` (lines 3488–3496).
- **Current State**:
  - Uses standard uniform `THREE.FogExp2(0x0b1220, 0.022)`.
  - Uniform exponential fog darkens the upper sky and distant streetlamps equally without height-based ground mist accumulation or warm streetlamp scattering (inscattering) in the fog around lamps (which is a signature visual feature of `IMG_6908`, `IMG_6909`, and `IMG_6910`).
- **Proposed Fix**:
  - Inject a custom height-aware & light-scattering atmospheric fog enhancement on exterior materials and volumetric halos around streetlamp fixtures so distant lamps glow through the mist with warm amber atmospheric scattering against cold slate-blue mountain/sky depth.

### 2.8 Post-Processing Pipeline
- **Location**: `gameHtml.ts` (`NightAtmosphere.initColorGradePass`, lines 4135–4290).
- **Current State**:
  - `gradeMat` fragment shader ignores 5 of its own uniforms (`uBloomStrength`, `uBloomThreshold`, `uMicroContrast`, `uChromaStrength`, `uEdgeDesat`).
- **Proposed Fix**:
  - Upgrade `gradeMat` fragment shader into a true cinematic survival-horror post-processing pass within a singlefullscreen pass (5-tap cross/tent HDR bloom on lamp/window highlights, local luminance micro-contrast enhancement, subtle radial edge chromatic aberration & desaturation, teal-shadow / warm-amber split toning, filmic S-curve, natural vignette, and animated fine film grain) with automatic quality scaling across High/Balanced/Performance tiers.

### 2.9 Existing Tihar Lighting Implementation
- **Location**: `gameHtml.ts` (`TiharNightExperience`, lines 18720–19615).
- **Current State**:
  - `instDiyoPools` (750 warm Diyo light pools) and `instJhilimiliBulbs` (1,800+ electric string light bulbs) were disabled (`count = 0; visible = false;`) at lines 19260–19264 because distant bulbs previously appeared as unattenuated white dots in the sky.
- **Proposed Fix**:
  - Re-enable `instJhilimiliBulbs` and `instDiyoPools` with proper vertex-shader distance attenuation (`smoothstep(55.0, 18.0, distToCam)`) and saturated warm-gold/multi-color emissive shading so Jhilimili string lights and Diyo pools glow richly up close and fade smoothly into the night fog at distance with zero sky artifacts!

### 2.10 Blender Assets & GLB Materials
- **Location**: `scripts/blender/*.py`, `public/models/*.glb`, `mobile/components/games/hide-and-seek/{gltfLoaderR128,classroomGlbBase64,computerLabGlbBase64,libraryGlbBase64}.ts`.
- **Current State**:
  - The Blender-generated GLB models (`classroom_production.glb`, `computer_lab_production.glb`, `library_production.glb`) exist on sibling commits `8fef8d6` and `b4228bd`, and their materials use flat untextured RGB colors (`Mat_Wall_Plaster`, `Mat_Wall_Dado`, `Mat_Floor_Terrazzo`, `Mat_Wood_Desk`).
- **Proposed Fix**:
  - Preserve and integrate `gltfLoaderR128.ts`, `classroomGlbBase64.ts`, `computerLabGlbBase64.ts`, and `libraryGlbBase64.ts` into the unified codebase, and run an automatic PBR material enhancer on loaded GLB meshes that binds our world-space / UV-mapped normal maps, roughness maps, wood grain, terrazzo speckles, plaster micro-relief, and environment reflections to every GLB material while preserving their baked `aoMap`!

### 2.11 Existing Baked AO
- **Location**: `gameHtml.ts` (`applyBakedVertexAO`, lines 1263–1335; `applyWallBaseAndEaveGrime`, lines 7934–7958).
- **Current State**:
  - `applyWallBaseAndEaveGrime` only darkens the bottom 28% and top 18% of walls uniformly along Y without darkening vertical building corners, window sill under-lips, or veranda post bases.
- **Proposed Fix**:
  - Upgrade `applyWallBaseAndEaveGrime` and `applyBakedVertexAO` to compute 3D corner cavity darkening, eave shadow gradients, and bottom splash-zone grime across all exterior and interior walls.

### 2.12 Existing Campus Environment
- **Location**: `gameHtml.ts` (lines 12560–18750).
- **Current State**:
  - Exterior buildings (`buildEnterableClassroomWing`, `buildLongitudinalClassroomWing`) have plain walls without the signature environmental details visible in `IMG_6908`, `IMG_6909`, and `IMG_6910`:
    - No catenary electrical cables draped along walls and between poles (`IMG_6908`, `IMG_6910`).
    - No wall-mounted electrical meter boxes / junction boxes with conduit pipes (`IMG_6908`, `IMG_6910`).
    - No concrete roadside curbs, drainage channels, scattered stones/boulders with moss, or wet puddles along the walkways (`IMG_6908`, `IMG_6909`, `IMG_6910`).
    - No multi-plank weathered wood veranda decking or patchwork weathered wooden doors (`IMG_6910`).
- **Proposed Fix**:
  - Add instanced / static-baked environmental details across the benchmark area (Bus Parking Plaza, Spine Road, and West Academic Wings L1/L2/L3 Alleyway) and roll out campus-wide:
    1. Concrete roadside curbs, drainage channels, and wet puddle reflection planes along roads and walkways.
    2. Wall-mounted electrical junction boxes, conduit pipes, and sagging catenary utility cables along building facades (`IMG_6908`, `IMG_6910`).
    3. Weathered mossy boulders, pebbles, leaf/debris clusters, and roadside hedge planters (`IMG_6908`, `IMG_6909`).
    4. Multi-toned weathered timber doors and wet wooden veranda decking (`IMG_6910`).
    5. Multi-LightsPerFragment shader injection on exterior walls, roads, and pavements so **all** nearby streetlamps (`lampFlickerMod.lamps`) and Tihar focal lights evaluate analytical point-light diffuse + GGX wet specular highlights in the fragment shader with **zero extra Three.js PointLight objects**!

### 2.13 Expo WebView Graphics Limitations & Quality Tiers
- **Location**: `HideAndSeekScreen.tsx`, `horrorConfig.ts` (`qualityPresets`), `gameHtml.ts`.
- **Current State**:
  - Running inside Expo `WebView` on iOS/Android shares process memory with React Native and uses tile-based mobile GPUs where excessive draw calls (>250), un-instanced small props, or multi-pass fullscreen shaders hurt frame times.
- **Proposed Fix**:
  - Maintain our static room/sector geometry merger (`bakeStaticGroup`) and `THREE.InstancedMesh` batching so all new environmental details (curbs, rocks, cables, junction boxes, puddles) merge into existing sector draw calls (<150 total scene draw calls).
  - Evaluate all 20+ streetlamp diffuse + wet-ground specular reflections in a single unified `onBeforeCompile` shader chunk (using a compact uniform array of active streetlamp positions) instead of spawning 20+ dynamic `THREE.PointLight`s!
  - Provide 3 explicit, device-adaptive quality tiers mapped to the UI (`High` / `Ultra`, `Balanced` / `Medium`, `Performance` / `Low`) with live FPS, frame-time, draw-call, triangle, and texture-memory telemetry.
