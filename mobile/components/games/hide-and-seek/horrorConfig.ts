export type GraphicsQuality = 'ultra' | 'high' | 'low' | 'fast';
export type QualityPinMode = 'auto' | GraphicsQuality;

/**
 * Single Master Switch for Map Exploration Mode vs. Hide-and-Seek Gameplay Mode.
 * Set EXPLORE_MODE = false to re-enable full Hide-and-Seek gameplay (Hunter, bots, timer, fuses, scares).
 */
export const EXPLORE_MODE = true;

export interface QualityPreset {
  label: string;
  pixelRatioCap: number;
  particleCount: number;
  paperLeafCount: number;
  mistPlaneCount: number;
  maxActiveLampLights: number;
  shadowMapSize: number;
  enableShadows: boolean;
  extraDetail: boolean;
  enableLampCones: boolean;
  enableColorGrade: boolean;
  fakePoolStride: number;
  cullDistBuilding: number;
  cullDistInterior: number;
  cullDistProps: number;
  eventIntervalMin: number;
  eventIntervalMax: number;
}

/**
 * Centralized Tunables for Gandaki University Nepali Horror Hide-and-Seek
 * (Visual Overhaul Pass: Single-Pass Color Grade, #ff8a2a Warm Orange Lamps,
 *  Darkened Grimy Materials, 3-Layer Ridge Silhouettes & Rim Lighting)
 */
export const HORROR_CONFIG = {
  exploreMode: true,
  enableDevTelemetry: true,

  // 1. COLOR GRADE & VISUAL OVERHAUL TUNABLES (All required grade values in one section)
  grade: {
    enabled: true,
    shadowTint: [0.06, 0.16, 0.22],     // Teal-blue shadows
    highlightTint: [1.08, 0.78, 0.46],  // Warm orange highlights
    saturation: 0.80,                                               // Midtones slightly desaturated (~0.8)
    contrast: 1.14,                                                 // Gentle S-curve contrast
    blackLift: 0.022,                                               // Lifted blacks (never crushed)
    vignette: 0.46,                                                 // Tunable vignette strength
    grain: 0.04,                                                    // Animated film grain (~0.04)
    edgeDesat: 0.28,                                                // Slight desaturation toward screen edges
    lampColor: 0xff8a2a,                                            // #ff8a2a warm orange lamp light
    poolOpacity: 0.24,                                              // Lowered pool opacity so it never clips to white
    fogColor: 0x0e1b20,                                             // Slightly greener gray-blue fog so distance layers separate
    materialDarknessMultiplier: 0.64,                               // Darken wall & roof albedo by ~36%
    fpsGuardThreshold: 40,                                          // Auto-disable grade pass if avg FPS < 40 for 3s
    fpsGuardWindowSec: 3.0,
    stylizedPs1Mode: false,                                         // Optional PS1-style 0.7x pixel ratio + dither/grain mode
    stylizedPixelRatio: 0.7,
  },

  palette: {
    charcoal: '#04070b',
    charcoalTranslucent: 'rgba(6, 11, 18, 0.90)',
    dimAmber: '#ff8a2a',
    dimAmberBorder: 'rgba(255, 138, 42, 0.28)',
    bloodRed: '#8c1d1d',
    bloodRedGlow: 'rgba(140, 29, 29, 0.72)',
    boneWhite: '#dce3ea',
    mutedBone: '#7e8c99',
  },
  renderer: {
    clearColor: 0x071118,
    toneMappingExposure: 1.15,
    fogColor: 0x14222c,
    fogWarmTintColor: 0x221d18,
    fogNear: 14.0,
    fogFar: 88.0,
    fogMinFarUnderTension: 45.0,
  },
  lighting: {
    // Lower, cooler global ambient & hemisphere fill so rooms have real contrast and stop looking flat
    visibilityFloorAmbient: 0.08,
    ambientColor: 0x162436,
    ambientIntensity: 0.14,
    indoorAmbientIntensity: 0.06,
    hemiSkyColor: 0x1e334a,
    hemiGroundColor: 0x070c12,
    hemiIntensity: 0.16,
    indoorHemiIntensity: 0.07,
    // Cool moonlight directional light for exterior rim lighting (attenuated indoors)
    moonColor: 0x8eb8d6,
    moonIntensity: 0.58,
    indoorMoonIntensity: 0.10,
    rimColor: 0x5c8299,
    rimIntensity: 0.25,
    // Main Player Flashlight: soft-edged spotlight, visible volumetric beam cone, battery flicker & realistic falloff
    flashlightColor: 0xfff1d6,
    flashlightLowBatteryColor: 0xffb366,
    flashlightIntensity: 9.8,
    flashlightDistance: 28.0,
    flashlightAngle: 0.60,
    flashlightPenumbra: 0.88,
    flashlightDecay: 1.85,
    flashlightSpillIntensity: 1.15,
    flashlightSpillDistance: 6.2,
    flashlightBeamOpacity: 0.13,
    // Warm orange lamp light (#ff8a2a) tuned against ACES Filmic so highlights stay orange and never whiten
    lampColor: 0xff8a2a,
    lampCoreColor: 0xffb366,
    lampEmberColor: 0x7c2d12,
    lampIntensity: 11.5,
    lampDistance: 16.5,
    lampDecay: 1.9,
    lampPoolSize: 7.2,
    lampHaloScale: 2.35,
    lampConeOpacity: 0.08,
    windowGlowRatio: 0.38,
    windowColdDark: 0x060b0f,
    windowEmissive: 0xff8a2a,
    windowEmissiveIntensity: 0.58,
    doorwayGlowColor: 0xff8a2a,
    doorwayGlowOpacity: 0.18,
    diyoUltraEmissiveIntensity: 1.25,
    horizonWarmGlowOpacity: 0.18,
    redAccent: 0x8c1d1d,
  },
  roomLightMoods: {
    dark: {
      ambientColor: 0x060b12,
      ambientMult: 0.36,
      color: 0x060b12,
      lightColor: 0x000000,
      intensity: 0.0,
      lightIntensity: 0.0,
      distance: 0.0,
      lightDistance: 0.0,
      flickerType: 'none',
    },
    dying_tube: {
      ambientColor: 0x0c1a20,
      ambientMult: 0.50,
      color: 0xb4f0e4,
      lightColor: 0xb4f0e4,
      intensity: 3.8,
      lightIntensity: 3.8,
      distance: 10.5,
      lightDistance: 10.5,
      flickerType: 'fluorescent_dying',
    },
    moonlight: {
      ambientColor: 0x0b1828,
      ambientMult: 0.52,
      color: 0x84b6e6,
      lightColor: 0x84b6e6,
      intensity: 2.8,
      lightIntensity: 2.8,
      distance: 11.5,
      lightDistance: 11.5,
      flickerType: 'steady_moon',
    },
    warm_lamp: {
      ambientColor: 0x16100c,
      ambientMult: 0.52,
      color: 0xff9838,
      lightColor: 0xff9838,
      intensity: 4.2,
      lightIntensity: 4.2,
      distance: 9.8,
      lightDistance: 9.8,
      flickerType: 'warm_filament',
    },
    emergency_red: {
      ambientColor: 0x180608,
      ambientMult: 0.48,
      color: 0xff2222,
      lightColor: 0xff2222,
      intensity: 4.0,
      lightIntensity: 4.0,
      distance: 10.5,
      lightDistance: 10.5,
      flickerType: 'emergency_pulse',
    },
    '101': { mood: 'dying_tube', color: 0xcbe4f5, intensity: 3.8, ambientScale: 0.14, tubeFlicker: true, moonlightShafts: true },
    '102': { mood: 'warm_lamp', color: 0xe6a152, intensity: 4.0, ambientScale: 0.16, tubeFlicker: false, moonlightShafts: true },
    '201': { mood: 'moonlight', color: 0x82acc9, intensity: 2.8, ambientScale: 0.14, tubeFlicker: false, moonlightShafts: true },
    '202': { mood: 'warm_lamp', color: 0xd99445, intensity: 3.8, ambientScale: 0.16, tubeFlicker: true, moonlightShafts: true },
    '301': { mood: 'dark', color: 0x3b5263, intensity: 0.0, ambientScale: 0.10, tubeFlicker: true, moonlightShafts: true },
    '302': { mood: 'emergency_red', color: 0xc92a2a, intensity: 4.0, ambientScale: 0.14, tubeFlicker: true, moonlightShafts: false },
    'atrium': { mood: 'dying_tube', color: 0xd8a060, intensity: 3.4, ambientScale: 0.18, tubeFlicker: true, moonlightShafts: true },
  },
  tension: {
    baseBreathingAmp: 0.012,
    hunterNearBreathingBoost: 0.038,
    baseSwayRoll: 0.006,
    hunterNearSwayRoll: 0.028,
    hunterProximityRadius: 24.0,
    flickerBurstIntervalMin: 12.0,
    flickerBurstIntervalMax: 22.0,
    autoStepDownFpsThreshold: 40,
    autoStepDownSafeFps: 45,
    autoStepDownWindowSec: 5.0,
  },
  audioAssets: {
    windLoop: 'assets/sounds/horror/campus_wind_loop.mp3',
    droneLoop: 'assets/sounds/horror/dark_tantric_drone_loop.mp3',
    heartbeatLoop: 'assets/sounds/horror/proximity_heartbeat.mp3',
    distantDogBark: 'assets/sounds/horror/distant_dog_bark.mp3',
    woodCreak: 'assets/sounds/horror/newari_wood_creak.mp3',
    phantomFootsteps: 'assets/sounds/horror/distant_footsteps.mp3',
    templeBell: 'assets/sounds/horror/cursed_ghanta_bell.mp3',
  },
  qualityPresets: {
    ultra: {
      label: 'ULTRA',
      pixelRatioCap: 1.35,
      particleCount: 36,
      paperLeafCount: 18,
      mistPlaneCount: 6,
      maxActiveLampLights: 3,
      shadowMapSize: 512,
      enableShadows: true,
      extraDetail: true,
      enableLampCones: true,
      enableColorGrade: true,
      fakePoolStride: 1,
      cullDistBuilding: 85,
      cullDistInterior: 24,
      cullDistProps: 60,
      eventIntervalMin: 12,
      eventIntervalMax: 24,
    },
    high: {
      label: 'HIGH',
      pixelRatioCap: 1.15,
      particleCount: 28,
      paperLeafCount: 12,
      mistPlaneCount: 4,
      maxActiveLampLights: 3,
      shadowMapSize: 512,
      enableShadows: true,
      extraDetail: true,
      enableLampCones: true,
      enableColorGrade: false,
      fakePoolStride: 1,
      cullDistBuilding: 75,
      cullDistInterior: 20,
      cullDistProps: 50,
      eventIntervalMin: 14,
      eventIntervalMax: 26,
    },
    low: {
      label: 'LOW',
      pixelRatioCap: 1.0,
      particleCount: 18,
      paperLeafCount: 8,
      mistPlaneCount: 0,
      maxActiveLampLights: 2,
      shadowMapSize: 256,
      enableShadows: false,
      extraDetail: false,
      enableLampCones: false,
      enableColorGrade: false,
      fakePoolStride: 2,
      cullDistBuilding: 62,
      cullDistInterior: 16,
      cullDistProps: 40,
      eventIntervalMin: 18,
      eventIntervalMax: 32,
    },
    fast: {
      label: 'FAST',
      pixelRatioCap: 0.85,
      particleCount: 12,
      paperLeafCount: 4,
      mistPlaneCount: 0,
      maxActiveLampLights: 1,
      shadowMapSize: 256,
      enableShadows: false,
      extraDetail: false,
      enableLampCones: false,
      enableColorGrade: false,
      fakePoolStride: 2,
      cullDistBuilding: 52,
      cullDistInterior: 13,
      cullDistProps: 32,
      eventIntervalMin: 20,
      eventIntervalMax: 36,
    },
  } as Record<GraphicsQuality, QualityPreset>,
  physics: {
    walkSpeed: 4.8,
    runSpeed: 6.6,
    crouchSpeed: 2.2,
    acceleration: 28.0,
    deceleration: 32.0,
    playerRadius: 0.28,
    standingHeight: 1.80,
    crouchHeight: 1.05,
    hidingHeight: 0.65,
    standingEyeHeight: 1.62,
    crouchEyeHeight: 0.95,
    hidingEyeHeight: 0.58,
    stepHeight: 0.52,
    gravity: 16.5,
    jumpForce: 5.2,
    lookSensitivityX: 0.0055,
    lookSensitivityY: 0.0048,
    mouseSensitivityX: 0.0035,
    mouseSensitivityY: 0.0030,
    lookSmoothing: 24.0,
    joystickDeadZone: 0.10,
    cameraNear: 0.05,
    cameraPushBack: 0.18,
    minCameraDist: 0.45,
    idealCameraDist: 3.4,
    cameraFadeStartDist: 0.60,
    cameraFadeEndDist: 0.15,
    subSteps: 3,
    maxDeltaTime: 0.1,
    maxSubSteps: 6,
    targetSubStepDt: 1.0 / 60.0,
    hidingExitClearance: 0.15,
    streetLampPoleRadius: 0.20,
    fenceHeight: 1.5,
    fenceThickness: 0.15,
    mandalaPostRadius: 0.20,
    tagEyeHeight: 1.62,
    tagChestHeight: 1.10,
    tagRange: 3.2,
    debugPhysics: false,
  },
  accessibility: {
    fearIntensity: 'high',
    flickerReduction: false,
    screenShakeOff: false,
    batterySaver: false,
    qualityPinMode: 'auto',
  },
  gameplay: {
    roundDurationSec: 540, // 9 minutes (8-10 min design pillar)
    fuseBoxCount: 4,
    hunterSpeed: 5.35, // Faster than walking Scholar (4.8), slower than sprinting Scholar (6.6)
    scholarWalkSpeed: 4.8,
    scholarSprintSpeed: 6.6,
    scholarCrouchSpeed: 2.2,
    pingIntervalSec: 30.0,
    doorLockCooldownSec: 25.0,
    doorLockDurationSec: 12.0,
    powerCutCooldownSec: 35.0,
    powerCutDurationSec: 10.0,
    flashlightDrainPerSec: 0.18,
    flashlightBatteryDrainPerSec: 0.18,
    batteryPickupRestore: 45.0,
    flashlightRechargeAmount: 45.0,
    flashlightMinReserveFactor: 0.28,
    flashlightMinDarkRoomDistance: 4.6,
    breathHoldDurationSec: 3.2,
  },
  buses: {
    length: 10.5,
    width: 2.5,
    height: 3.1,
    floorY: 0.54,
    roofBottomY: 2.82,
    stepHeight1: 0.18,
    stepHeight2: 0.36,
    interiorCullDist: 25.0,
    mossAmountBusA: 0.52,
    mossAmountBusB: 0.86,
    glassBreakageBusA: 0.35,
    glassBreakageBusB: 0.68,
    vineCountBusA: 10,
    vineCountBusB: 16,
    routeDevanagari: 'पोखरा',
    busA: {
      id: 'bus-a',
      label: 'Bus A (GP62 • ग १ ख ९४९१)',
      x: 5.2,
      z: -44.2,
      rotY: 0.0,
      plateNumber: 'ग १ ख ९४९१',
      plateAscii: 'GA 1 KHA 9491',
      fleetCode: 'GP62',
      mossAmount: 0.52,
      glassBreakage: 0.35,
      vineCount: 10,
      doorOpenAngle: 0.55, // Slightly open folding door leaf
    },
    busB: {
      id: 'bus-b',
      label: 'Bus B (GP64 • ग १ ख ७२६२)',
      x: 15.4,
      z: -45.2,
      rotY: 0.04,
      plateNumber: 'ग १ ख ७२६२',
      plateAscii: 'GA 1 KHA 7262',
      fleetCode: 'GP64',
      mossAmount: 0.86,
      glassBreakage: 0.68,
      vineCount: 16,
      doorOpenAngle: 1.25, // Wider open door leaf, more broken glass & heavier moss
    },
  },
  mainBuilding: {
    // 1. Windows: 1024px mipmapped + anisotropic dark frame/mullions, interior light fixture + blinds, ~35% lit, ~65% cool sky-reflective dark glass
    litWindowRatio: 0.35,
    windowTextureSize: 1024,
    windowAnisotropy: 8,
    windowFrameHex: '#11171f',
    windowSillColor: 0xd0dae2,
    windowWarmColor: 0xffe6a8,
    windowWarmEmissive: 0xff9c2a,
    windowWarmEmissiveIntensity: 1.05,
    windowRedColor: 0xff7852,
    windowRedEmissive: 0xe62e1c,
    windowRedEmissiveIntensity: 1.12,
    windowDarkColor: 0x22364a,
    windowDarkSkyReflectEmissive: 0x1c3248,
    windowDarkEmissiveIntensity: 0.34,
    windowDarkRoughness: 0.12,
    windowDarkMetalness: 0.82,

    // 2. Walls, Pilasters, Columns, Quoins, Floor Bands & Cornices (realistic masonry/plaster relief & horror weathering)
    wallColor: 0x949ea8,
    wallEmissive: 0x0d151e,
    wallEmissiveIntensity: 0.10,
    wallNormalScale: 0.022,
    wallRoughness: 0.68,
    pilasterColor: 0xdce4ec,
    pilasterEmissive: 0x182430,
    pilasterEmissiveIntensity: 0.16,
    pilasterNormalScale: 0.015,
    pilasterRoughness: 0.54,
    columnPedestalColor: 0x5c6772,
    plinthColor: 0x727e88,

    // 3. Real 3D Light-Source Shader Illumination, Cool Moon Rim & Baked AO (0 new real PointLights; real 3D world-space light sources!)
    physicalLightIntensity: 1.38,
    windowSpillIntensity: 1.18,
    horrorFlickerStrength: 0.18,
    facadeUplightColor: 0xff9436,
    facadeUplightOpacity: 0.14,
    porticoColumnWashOpacity: 0.18,
    entranceGroundSpillColor: 0xff9838,
    entranceGroundSpillOpacity: 0.28,
    moonRimColor: [0.28, 0.44, 0.62],
    moonRimIntensity: 1.05,
    moonRimPower: 2.1,
    eaveAoOpacity: 0.68,
    floorBandAoOpacity: 0.52,

    // 4. Roof: Lifted Terracotta-Red Tile & Ridge/Edge Highlight
    roofColor: 0xbc4032,
    roofEmissive: 0x320e0a,
    roofEmissiveIntensity: 0.20,
    roofRidgeColor: 0xdc5846,
    roofRidgeEmissive: 0x481610,
    roofRidgeEmissiveIntensity: 0.28,
    roofNormalScale: 0.028,
    roofRoughness: 0.42,

    // 5. Distance Silhouette & Per-Building Fog Reduction (building only, global fog untouched)
    fogInfluence: 0.32,
    minLandmarkCullDist: 145.0,

    // 6. High-Res "GANDAKI UNIVERSITY" Sign (>= 1024px wide with mipmaps + floodlit stone relief)
    signCanvasWidth: 2048,
    signCanvasHeight: 256,
    signPlaqueColor: 0xcfd8e0,
    signEmissive: 0x263442,
    signEmissiveIntensity: 0.26,

    // 7. Rotunda Glass Ring (dark glass, 2 warm interior-lit sections with pendant fixtures, visible orange railing)
    rotundaGlassDarkColor: 0x162636,
    rotundaGlassDarkEmissive: 0x152638,
    rotundaGlassDarkEmissiveIntensity: 0.26,
    rotundaGlassWarmColor: 0xffd28a,
    rotundaGlassWarmEmissive: 0xff9632,
    rotundaGlassWarmEmissiveIntensity: 0.82,
    rotundaLitBayIndices: [3, 6],
    rotundaRailingColor: 0xf27e26,
    rotundaRailingEmissive: 0xff6e18,
    rotundaRailingEmissiveIntensity: 0.62,
  },

  // 8. CLASSROOM HORROR REDESIGN TUNABLES (Centralized in horrorConfig.ts)
  classroom: {
    representativeRoomId: 'West Wing L1 Room 1',
    cullDistance: 20.0,

    // Dying fluorescent tube states & cool-green/white additive spill gradients (no new real PointLights)
    tubeStates: {
      steadyDimColor: 0x9ce8d6,
      steadyDimIntensity: 0.38,
      stutterColor: 0xbef6e8,
      stutterPeakIntensity: 1.55,
      stutterMinIntensity: 0.04,
      deadColor: 0x161d22,
      deadIntensity: 0.0,
    },
    flickerRates: {
      stutterBaseHz: 3.1,
      stutterBurstHz: 18.5,
      stutterDropoutThreshold: 0.64,
      safeMaxHz: 1.6,
      calmExploreHz: 1.25,
    },
    tubeSpill: {
      color: 0xaef2e2,
      floorSpillOpacity: 0.16,
      deskSpillOpacity: 0.13,
    },

    // Cold moonlight shafts & window-shaped floor/desk patches with window-frame shadow mullions
    shaftStrength: {
      coneOpacity: 0.16,
      rayBladeOpacity: 0.22,
      floorPatchOpacity: 0.28,
      deskPatchOpacity: 0.22,
      frameShadowContrast: 0.78,
    },

    // Deep dark corners & under-desk AO falloff while keeping visibilityFloorAmbient readable
    cornerDarkness: {
      cornerVertexAoFloor: 0.14,
      underDeskAoOpacity: 0.86,
      wallLowerThirdDarken: 0.76,
      visibilityFloorAmbient: 0.08,
    },

    // At most ONE warm accent per room (desk lamp OR doorway hallway spill)
    warmAccent: {
      maxPerRoom: 1,
      deskLampColor: 0xff9636,
      deskLampOpacity: 0.28,
      doorwayGlowColor: 0xff8a2a,
      doorwayGlowOpacity: 0.16,
    },

    // Surface decay, stains, wet floor sheen, sagging ceiling panel, scratched wood & cracked window pane
    decayAmount: {
      overall: 0.84,
      floorWetSheenOpacity: 0.24,
      floorWetRoughness: 0.14,
      wallMoldOpacity: 0.74,
      ceilingSagAngleRad: 0.24,
      deskScratchStrength: 0.85,
      crackedPaneOpacity: 0.78,
    },

    // Instanced storytelling props & deterministic "wrong" detail per classroom
    propDensity: {
      overturnedChairsPerRoom: 2,
      scatteredPapersCount: 9,
      cobwebsPerRoom: 3,
      draggedDeskNearDoor: true,
      ceilingFanBentBladeRad: 0.28,
      fanSwaySpeed: 0.85,
    },

    // Atmosphere: ULTRA-only doorway ground mist & GPU vertex shader draft movement
    mistAmount: {
      ultraOnly: true,
      doorMistPlanes: 2,
      opacity: 0.16,
      driftSpeed: 0.34,
      paperFlutterAmp: 0.008,
      cableSwayAmp: 0.018,
    },

    // Cheap procedural Web Audio hooks (respecting EXPLORE_MODE flags)
    audio: {
      tubeBuzzVolume: 0.038,
      creakVolume: 0.055,
      fanTickVolume: 0.022,
      fanTickIntervalSec: 2.8,
    },

    // Classroom mood distribution (emergency_red used in ONE classroom room only, dim, with visible exit sign)
    moods: {
      'West Wing L1 Room 1': 'dying_tube',      // Representative "Best Example" Classroom
      'West Wing L1 Room 2': 'moonlight',
      'West Wing L1 Room 3': 'emergency_red',   // ONLY emergency_red classroom (dim red exit sign above door)
      'East Wing R2 Room 1': 'dark',
      'East Wing R2 Room 2': 'moonlight',
      'Newari Heritage Block W1 Room 1': 'warm_lamp',
      'Newari Heritage Block W1 Room 2': 'moonlight',
      'Newari Cultural Hall W2 South': 'dark',
      'Building W4 West Wing Room 1': 'dying_tube',
      'Rotunda Ground West Hall 101': 'dying_tube',
      'Rotunda 1st-Floor West Class 201': 'moonlight',
      'Rotunda 2nd-Floor West Seminar 301': 'dark',
    },
  },
};


