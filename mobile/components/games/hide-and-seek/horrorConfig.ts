export type GraphicsQuality = 'ultra' | 'high' | 'low' | 'fast';

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
  enableDevTelemetry: false,

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
    visibilityFloorAmbient: 0.45,
    ambientColor: 0x486475,
    ambientIntensity: 0.65,
    hemiSkyColor: 0x587b91,
    hemiGroundColor: 0x24333b,
    hemiIntensity: 0.62,
    // Cool moonlight directional light for crisp rim light on tree canopies, buildings & ground
    moonColor: 0x9bc0d9,
    moonIntensity: 1.15,
    rimColor: 0x5c8299,
    rimIntensity: 0.35,
    // Warm orange lamp light (#ff8a2a) tuned against ACES Filmic so highlights stay orange and never whiten
    lampColor: 0xff8a2a,
    lampCoreColor: 0xffb366,
    lampEmberColor: 0x7c2d12,
    lampIntensity: 14.0,
    lampDistance: 18.0,
    lampDecay: 1.8,
    lampPoolSize: 7.5,
    lampHaloScale: 2.5,
    lampConeOpacity: 0.08,
    windowGlowRatio: 0.38,
    windowColdDark: 0x060b0f,
    windowEmissive: 0xff8a2a,
    windowEmissiveIntensity: 0.62,
    doorwayGlowColor: 0xff8a2a,
    doorwayGlowOpacity: 0.22,
    diyoUltraEmissiveIntensity: 1.25,
    horizonWarmGlowOpacity: 0.22,
    redAccent: 0x8c1d1d,
  },
  tension: {
    baseBreathingAmp: 0.012,
    hunterNearBreathingBoost: 0.038,
    baseSwayRoll: 0.006,
    hunterNearSwayRoll: 0.028,
    hunterProximityRadius: 24.0,
    flickerBurstIntervalMin: 12.0,
    flickerBurstIntervalMax: 22.0,
    autoStepDownFpsThreshold: 30,
    autoStepDownWindowSec: 2.5,
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
    fearIntensity: 'high' as 'low' | 'medium' | 'high',
    flickerReduction: false,
    screenShakeOff: false,
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
    flashlightDrainPerSec: 1.15,
    batteryPickupRestore: 45.0,
    breathHoldDurationSec: 3.2,
  },
  roomLightMoods: {
    '101': { mood: 'flickering_tube', color: 0xcbe4f5, intensity: 1.35, ambientScale: 0.16, tubeFlicker: true, moonlightShafts: true },
    '102': { mood: 'warm_lamp', color: 0xe6a152, intensity: 1.25, ambientScale: 0.18, tubeFlicker: false, moonlightShafts: true },
    '201': { mood: 'moonlit', color: 0x82acc9, intensity: 0.95, ambientScale: 0.14, tubeFlicker: false, moonlightShafts: true },
    '202': { mood: 'warm_lamp', color: 0xd99445, intensity: 1.15, ambientScale: 0.18, tubeFlicker: true, moonlightShafts: true },
    '301': { mood: 'dark', color: 0x3b5263, intensity: 0.40, ambientScale: 0.12, tubeFlicker: true, moonlightShafts: true },
    '302': { mood: 'emergency_red', color: 0xc92a2a, intensity: 1.45, ambientScale: 0.15, tubeFlicker: true, moonlightShafts: false },
    'atrium': { mood: 'flickering_tube', color: 0xd8a060, intensity: 1.10, ambientScale: 0.22, tubeFlicker: true, moonlightShafts: true },
  },
};

