/**
 * Semester Library — Hide & Seek Web Edition Engine Compiler (Single Source of Truth)
 * -----------------------------------------------------------------------------------
 * Reads the authoritative campus layout, terrain, procedural architecture, interiors,
 * and Three.js r128 scene builders directly from:
 *   - mobile/components/games/hide-and-seek/horrorConfig.ts
 *   - mobile/components/games/hide-and-seek/threeMinJs.ts
 *   - mobile/components/games/hide-and-seek/gameHtml.ts
 *   - public/gandaki-campus-layout.json
 *
 * WITHOUT modifying any mobile files on disk, and compiles the dedicated
 * Browser-Native Web Edition Engine with:
 *   1. Realistic Dark Night Sky Dome & 18 Drifting Volumetric Cloud Layers
 *   2. Clean Architectural Compound, Roads, Curbs, Intact Buses & Classrooms
 *   3. Web Edition Graphics Overhaul:
 *      - Interior Rectilinear Fill & Ceiling Bounce Lighting + Realistic 50Hz AC Fluorescent Tubes
 *      - Up to 4096x4096 PCFSoftShadowMap with Camera-Following Texel-Snapped Shadow Frustum
 *      - 16x Anisotropic PBR Materials + High-Res 512px PMREM Specular Environment Reflections
 *      - Dual-Zone Volumetric Flashlight (Hotspot SpotLight + Wide Peripheral Bounce Spill)
 *      - WebGL Screen-Space Ambient Occlusion (SSAO) + Dual-Radius Optical Bloom + ACES Filmic Pass
 *      - Height & Distance Atmospheric Fog with Indoor/Outdoor Transitions
 *      - 4 Desktop Graphics Presets (Performance, Balanced, High, Ultra) + Adaptive Resolution (0.65x-1.5x)
 *   4. Desktop Pointer-Lock Mouse Look, WASD + Shift Sprint, Fullscreen, and Web Host Telemetry Bridge
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MOBILE_HS_DIR = path.join(ROOT_DIR, 'mobile', 'components', 'games', 'hide-and-seek');
const CAMPUS_JSON_PATH = path.join(ROOT_DIR, 'public', 'gandaki-campus-layout.json');

let cachedEngineHtml = null;
let cachedMetadata = null;

function replaceExact(src, label, oldStr, newStr) {
  const idx = src.indexOf(oldStr);
  if (idx === -1) {
    return src;
  }
  return src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
}

function replaceBetween(src, label, startMarker, endMarker, replacement) {
  const sIdx = src.indexOf(startMarker);
  if (sIdx === -1) return src;
  const eIdx = src.indexOf(endMarker, sIdx);
  if (eIdx === -1) return src;
  return src.slice(0, sIdx) + replacement + src.slice(eIdx + endMarker.length);
}

/**
 * Loads the authoritative HORROR_CONFIG object from horrorConfig.ts and merges
 * the authoritative public/gandaki-campus-layout.json without touching mobile files.
 */
function loadAuthoritativeWebConfig() {
  const rawConfigTs = fs.readFileSync(path.join(MOBILE_HS_DIR, 'horrorConfig.ts'), 'utf8');
  const startMarker = 'export const HORROR_CONFIG = ';
  const sIdx = rawConfigTs.indexOf(startMarker);
  if (sIdx === -1) {
    throw new Error('[WebEngineCompiler] Could not locate HORROR_CONFIG in horrorConfig.ts');
  }
  let objExpr = rawConfigTs.slice(sIdx + startMarker.length);
  objExpr = objExpr.replace(/\s+as\s+Record<[^>]+>/g, '').trim().replace(/;+\s*$/, '');

  const evalFn = new Function(`return (${objExpr});`);
  const config = evalFn();

  // Sync authoritative campus layout JSON from public/gandaki-campus-layout.json
  if (fs.existsSync(CAMPUS_JSON_PATH)) {
    try {
      const campusJson = JSON.parse(fs.readFileSync(CAMPUS_JSON_PATH, 'utf8'));
      if (campusJson && Array.isArray(campusJson.objects) && campusJson.terrain) {
        campusJson.terrain.size = campusJson.terrain.size || campusJson.terrain.width || 320;
        campusJson.terrain.segments = campusJson.terrain.segments || campusJson.terrain.segmentsX || 128;
        config.campusLayout = campusJson;
      }
    } catch (e) {
      console.warn('[WebEngineCompiler] Using embedded campusLayout fallback:', e.message);
    }
  }

  // Apply Web Edition High-Fidelity Graphics & Lighting Defaults
  config.photorealisticOverhaul = {
    ...config.photorealisticOverhaul,
    enabled: true,
    wetPavementRoughnessMin: 0.24,
    wetPavementRoughnessMax: 0.76,
    puddleReflectivity: 0.42,
    normalMapStrength: 3.15,
    anisotropyMax: 16,
    streetLampAnalyticalCount: 24,
    dynamicShadowFrustumHalfSize: 38.0,
    enableEnvironmentalDetails: true,
  };

  config.grade = {
    ...config.grade,
    enabled: true,
    shadowTint: [0.88, 0.96, 1.12],
    highlightTint: [1.08, 1.00, 0.90],
    saturation: 0.96,
    contrast: 1.06,
    blackCrushPow: 1.01,
    blackLift: 0.012,
    vignette: 0.22,
    vignetteMin: 0.74,
    vignetteInner: 0.40,
    vignetteOuter: 0.94,
    grain: 0.008,
    edgeDesat: 0.05,
    bloomStrength: 0.34,
    bloomThreshold: 0.72,
    microContrast: 0.18,
    chromaStrength: 0.0004,
    lampColor: 0xffa955,
    poolOpacity: 0.34,
    fogColor: 0x070d18,
    fogDensity: 0.0135,
    materialDarknessMultiplier: 0.86,
    maxGradeFrameCostMs: 4.5,
    fpsGuardThreshold: 32,
    fpsGuardWindowSec: 4.0,
    stylizedPs1Mode: false,
  };

  config.albedo = {
    ...config.albedo,
    maxValueCap: 0.86,
    wallCream: 0xc8bca6,
    wallPlaster: 0xb8aca0,
    wallStucco: 0xb2aca2,
    roadAsphalt: 0x262a30,
    roadRoughness: 0.56,
    roofBlueMetal: 0x283c50,
    roofTerracotta: 0x7a3228,
    concretePlinth: 0x586068,
    verandaWood: 0x6b4428,
  };

  config.renderer = {
    ...config.renderer,
    outputColorSpace: 'srgb',
    toneMapping: 'ACESFilmicToneMapping',
    toneMappingExposure: 1.04,
    pixelRatioCap: 2.0,
    shadowMapType: 'PCFSoftShadowMap',
    clearColor: 0x060c17,
    fogType: 'FogExp2',
    fogColor: 0x060c17,
    fogDensity: 0.0135,
    fogWarmTintColor: 0x1e1712,
    fogNear: 20.0,
    fogFar: 118.0,
    fogMinFarUnderTension: 58.0,
  };

  config.lighting = {
    ...config.lighting,
    visibilityFloorAmbient: 0.075,
    ambientColor: 0x122034,
    ambientIntensity: 0.135,
    indoorAmbientIntensity: 0.145,
    hemiSkyColor: 0x2b4872,
    hemiGroundColor: 0x0c131d,
    hemiIntensity: 0.165,
    indoorHemiIntensity: 0.15,
    moonColor: 0xa4c2f0,
    moonIntensity: 0.62,
    indoorMoonIntensity: 0.16,
    moonShadowMapSize: 4096,
    moonShadowBias: -0.00025,
    moonShadowNormalBias: 0.020,
    rimColor: 0x7098c0,
    rimIntensity: 0.26,
    flashlightColor: 0xfff5e0,
    flashlightLowBatteryColor: 0xffb870,
    flashlightIntensity: 14.5,
    flashlightDistance: 36.0,
    flashlightAngle: 0.58,
    flashlightPenumbra: 0.88,
    flashlightDecay: 1.65,
    flashlightSpillIntensity: 1.85,
    flashlightSpillDistance: 9.2,
    flashlightBeamOpacity: 0.095,
    lampColor: 0xffa955,
    lampCoreColor: 0xffe8c2,
    lampEmberColor: 0x7c2d12,
    lampIntensity: 14.2,
    lampDistance: 26.0,
    lampDecay: 1.58,
    lampPoolSize: 8.6,
    lampHaloScale: 2.6,
    lampConeOpacity: 0.075,
    enableLampCones: true,
    maxActiveLampLights: 8,
    windowGlowRatio: 0.52,
    windowColdDark: 0x070d16,
    windowEmissive: 0xffba6e,
    windowEmissiveIntensity: 0.78,
    doorwayGlowColor: 0xffa955,
    doorwayGlowOpacity: 0.0,
    diyoUltraEmissiveIntensity: 1.6,
    horizonWarmGlowOpacity: 0.15,
  };

  config.qualityPresets = {
    ultra: {
      label: 'ULTRA (DESKTOP 4K SHADOWS + SSAO)',
      pixelRatioCap: 1.5,
      particleCount: 52,
      paperLeafCount: 24,
      mistPlaneCount: 0,
      maxActiveLampLights: 8,
      shadowMapSize: 4096,
      enableShadows: true,
      extraDetail: true,
      enableLampCones: true,
      enableColorGrade: true,
      fakePoolStride: 1,
      cullDistBuilding: 115,
      cullDistInterior: 34,
      cullDistProps: 82,
      eventIntervalMin: 12,
      eventIntervalMax: 24,
    },
    high: {
      label: 'HIGH (2K SHADOWS + SSAO)',
      pixelRatioCap: 1.35,
      particleCount: 38,
      paperLeafCount: 18,
      mistPlaneCount: 0,
      maxActiveLampLights: 6,
      shadowMapSize: 2048,
      enableShadows: true,
      extraDetail: true,
      enableLampCones: true,
      enableColorGrade: true,
      fakePoolStride: 1,
      cullDistBuilding: 96,
      cullDistInterior: 28,
      cullDistProps: 68,
      eventIntervalMin: 14,
      eventIntervalMax: 26,
    },
    low: {
      label: 'BALANCED (1K SHADOWS)',
      pixelRatioCap: 1.15,
      particleCount: 24,
      paperLeafCount: 12,
      mistPlaneCount: 0,
      maxActiveLampLights: 4,
      shadowMapSize: 1024,
      enableShadows: true,
      extraDetail: true,
      enableLampCones: false,
      enableColorGrade: true,
      fakePoolStride: 1,
      cullDistBuilding: 78,
      cullDistInterior: 22,
      cullDistProps: 52,
      eventIntervalMin: 18,
      eventIntervalMax: 32,
    },
    fast: {
      label: 'PERFORMANCE (FAST)',
      pixelRatioCap: 0.90,
      particleCount: 14,
      paperLeafCount: 6,
      mistPlaneCount: 0,
      maxActiveLampLights: 2,
      shadowMapSize: 512,
      enableShadows: false,
      extraDetail: false,
      enableLampCones: false,
      enableColorGrade: false,
      fakePoolStride: 2,
      cullDistBuilding: 62,
      cullDistInterior: 16,
      cullDistProps: 38,
      eventIntervalMin: 20,
      eventIntervalMax: 36,
    },
  };

  if (config.buses) {
    config.buses.mossAmountBusA = 0.0;
    config.buses.mossAmountBusB = 0.0;
    config.buses.glassBreakageBusA = 0.0;
    config.buses.glassBreakageBusB = 0.0;
    config.buses.vineCountBusA = 0;
    config.buses.vineCountBusB = 0;
    if (config.buses.busA) {
      config.buses.busA.mossAmount = 0.0;
      config.buses.busA.glassBreakage = 0.0;
      config.buses.busA.vineCount = 0;
    }
    if (config.buses.busB) {
      config.buses.busB.mossAmount = 0.0;
      config.buses.busB.glassBreakage = 0.0;
      config.buses.busB.vineCount = 0;
    }
  }

  return config;
}

/**
 * Loads the embedded Three.js r128 runtime string from mobile/components/games/hide-and-seek/threeMinJs.ts
 */
function loadThreeMinJsString() {
  const threeFile = path.join(MOBILE_HS_DIR, 'three.min.js');
  if (fs.existsSync(threeFile)) {
    return fs.readFileSync(threeFile, 'utf8');
  }
  const rawTs = fs.readFileSync(path.join(MOBILE_HS_DIR, 'threeMinJs.ts'), 'utf8');
  const startIdx = rawTs.indexOf('`');
  const endIdx = rawTs.lastIndexOf('`');
  return rawTs.slice(startIdx + 1, endIdx);
}

/**
 * Transforms the authoritative gameHtml.ts source into the Web Edition HTML string
 * without modifying any files in mobile/.
 */
function buildWebEditionEngineHtml() {
  if (cachedEngineHtml) return cachedEngineHtml;

  const config = loadAuthoritativeWebConfig();
  const threeMinJs = loadThreeMinJsString();
  let src = fs.readFileSync(path.join(MOBILE_HS_DIR, 'gameHtml.ts'), 'utf8');

  // 1. Disable flat orange square diyo floor pools in TiharNightExperience.finalizeGeometry
  src = replaceExact(
    src,
    'instDiyoPools disable',
    `        // Phase 12: Enable authentic Tihar diyo warm surface pools & Jhilimili string light bulbs within campus bounds
        this.instDiyoPools.count = this.poolCount;
        this.instDiyoPools.visible = true;`,
    `        this.instDiyoPools.count = 0;
        this.instDiyoPools.visible = false;`
  );

  // 2. Clean up populatePhase12EnvironmentalDetails
  src = replaceBetween(
    src,
    'populatePhase12EnvironmentalDetails',
    `    (function populatePhase12EnvironmentalDetails() {`,
    `      scene.add(envDetailGroup);\n    })();`,
    `    (function populatePhase12EnvironmentalDetails() {
      if (HORROR_CONFIG.photorealisticOverhaul && HORROR_CONFIG.photorealisticOverhaul.enableEnvironmentalDetails === false) return;

      const envDetailGroup = new THREE.Group();
      envDetailGroup.name = 'Phase12EnvironmentalDetails';

      const curbSegGeo = new THREE.BoxGeometry(0.24, 0.18, 6.0);
      for (let z = -44.0; z <= 46.0; z += 6.0) {
        [-33.15, -25.85].forEach((cx) => {
          const ty = getTerrainHeightAt(cx, z);
          const curb = new THREE.Mesh(curbSegGeo.clone(), materials.plinthDarkConcrete);
          curb.position.set(cx, ty + 0.07, z);
          curb.receiveShadow = true;
          envDetailGroup.add(curb);
        });
      }

      const jBoxGeo = new THREE.BoxGeometry(0.28, 0.38, 0.14);
      const conduitGeo = new THREE.CylinderGeometry(0.018, 0.018, 2.6, 6);
      const wingElectricalSpecs = [
        [-19.8, 1.40, -5.68, 0],
        [-11.5, 1.40, -5.68, 0],
        [-3.2,  1.40, -5.68, 0],
        [-20.32, 1.40, -8.2, Math.PI / 2],
        [-19.8, 1.40, 0.18, Math.PI],
        [-11.5, 1.40, 0.18, Math.PI],
        [-3.2,  1.40, 0.18, Math.PI],
        [-21.05, 1.40, 3.2, Math.PI / 2],
        [-5.8,  1.40, -19.72, 0],
        [24.18, 1.40, -24.5, Math.PI / 2],
      ];
      wingElectricalSpecs.forEach(([wx, wy, wz, rotY]) => {
        const jb = new THREE.Mesh(jBoxGeo.clone(), materials.deskSteelFrame);
        jb.position.set(wx, wy + 1.55, wz);
        jb.rotation.y = rotY;
        jb.castShadow = true;
        jb.receiveShadow = true;
        envDetailGroup.add(jb);

        const cond = new THREE.Mesh(conduitGeo.clone(), materials.castIronDark);
        cond.position.set(wx + (rotY === 0 ? 0.08 : 0), wy + 1.85, wz + (rotY !== 0 ? 0.08 : 0));
        envDetailGroup.add(cond);
      });

      const cableSpanSpecs = [
        [[-39.0, 4.6, -11.0], [-22.8, 5.2, -13.5]],
        [[-22.8, 5.2, -13.5], [-19.8, 4.9, -5.8]],
        [[-38.9, 4.6, 1.0],   [-24.8, 4.6, 3.6]],
        [[-24.8, 4.6, 3.6],   [-20.5, 5.0, 0.3]],
        [[-18.5, 4.8, -5.7],  [-18.5, 4.8, 0.2]],
        [[-9.5,  4.8, -5.7],  [-9.5,  4.8, 0.2]],
        [[0.5,   4.8, -5.7],  [0.5,   4.8, 0.2]],
      ];
      cableSpanSpecs.forEach(([p0, p1]) => {
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
        const segs = 6;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs, t1 = (s + 1) / segs;
          const sag0 = Math.sin(t0 * Math.PI) * 0.42;
          const sag1 = Math.sin(t1 * Math.PI) * 0.42;
          const x0 = p0[0] + dx * t0, y0 = p0[1] + dy * t0 - sag0, z0 = p0[2] + dz * t0;
          const x1 = p0[0] + dx * t1, y1 = p0[1] + dy * t1 - sag1, z1 = p0[2] + dz * t1;
          const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5, mz = (z0 + z1) * 0.5;
          const sLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
          const wireGeo = new THREE.CylinderGeometry(0.012, 0.012, sLen, 4);
          wireGeo.rotateX(Math.PI / 2);
          const wireMesh = new THREE.Mesh(wireGeo, materials.castIronDark);
          wireMesh.position.set(mx, my, mz);
          wireMesh.lookAt(x1, y1, z1);
          envDetailGroup.add(wireMesh);
        }
      });

      scene.add(envDetailGroup);
    })();`
  );

  // 3. Clean up Bus Master Atlas & Intact Glass & Bus Builder
  src = replaceBetween(
    src,
    'Bus Master Atlas & Glass clean textures',
    `        // Heavy rain-runoff grime streaks, rust patches, and green moss stains across Band 1`,
    `    const busMasterAtlasTex = createBusMasterAtlasTex();`,
    `        const mudGrad = ctx.createLinearGradient(0, 340, 0, 420);
        mudGrad.addColorStop(0.0, 'rgba(30, 24, 18, 0.0)');
        mudGrad.addColorStop(1.0, 'rgba(30, 24, 18, 0.22)');
        ctx.fillStyle = mudGrad;
        ctx.fillRect(0, 340, 2048, 80);

        const bodyGrad = ctx.createLinearGradient(0, 430, 0, 740);
        bodyGrad.addColorStop(0.0, '#9c7018');
        bodyGrad.addColorStop(0.25, '#c99426');
        bodyGrad.addColorStop(0.75, '#b07e1c');
        bodyGrad.addColorStop(1.0, '#785410');
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(0, 430, 1024, 310);

        ctx.fillStyle = '#1e242b';
        ctx.fillRect(1040, 440, 780, 105);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 6;
        ctx.strokeRect(1044, 444, 772, 97);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 54px "Arial Narrow", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText((busConfig.fleetCodeA || 'GP62') + '  |  GANDAKI UNIVERSITY', 1068, 512);

        ctx.fillStyle = '#b07e1b';
        ctx.fillRect(1840, 445, 190, 90);
        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 46px "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(busConfig.fleetCodeA || 'GP62', 1935, 506);

        ctx.fillStyle = '#14181f';
        ctx.fillRect(1040, 560, 580, 62);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.strokeRect(1043, 563, 574, 56);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 34px serif';
        ctx.textAlign = 'center';
        ctx.fillText('LANKA ASHOK LEYLAND', 1330, 603);

        ctx.fillStyle = '#c89d28';
        ctx.fillRect(1640, 555, 390, 95);
        ctx.strokeStyle = '#3b2808';
        ctx.lineWidth = 4;
        ctx.strokeRect(1640, 555, 390, 95);
        ctx.fillStyle = '#991b1b';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(busConfig.routeSignDevanagari || 'पोखरा', 1835, 596);
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 28px serif';
        ctx.fillText('POKHARA', 1835, 636);

        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1040, 660, 380, 74);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 5;
        ctx.strokeRect(1044, 664, 372, 66);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 38px "Arial Narrow", monospace';
        ctx.fillText(busConfig.plateNumberA || 'ग १ ख ९४९१', 1230, 711);

        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1440, 656, 170, 82);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 4;
        ctx.strokeRect(1444, 660, 162, 74);
        ctx.fillStyle = '#1d4ed8';
        ctx.font = 'italic bold 22px serif';
        ctx.fillText('Gandaki', 1525, 696);
        ctx.fillText('Express', 1525, 722);

        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1630, 660, 400, 74);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 5;
        ctx.strokeRect(1634, 664, 392, 66);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText('गण्डकी • पोखरा', 1830, 710);

        ctx.fillStyle = '#244658';
        ctx.fillRect(0, 750, 1024, 274);

        ctx.fillStyle = '#1c1e21';
        ctx.fillRect(1024, 750, 1024, 274);
        ctx.fillStyle = '#2d3136';
        for (let rx = 1032; rx < 2040; rx += 12) {
          ctx.fillRect(rx, 750, 5, 274);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    function createBusShatteredGlassTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1024, 512);
        ctx.fillStyle = 'rgba(34, 46, 58, 0.72)';
        ctx.fillRect(0, 0, 1024, 512);

        ctx.fillStyle = 'rgba(226, 232, 240, 0.86)';
        ctx.font = 'bold 48px "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GANDAKI', 160, 74);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('गण्डकी विश्वविद्यालय - १२००', 160, 478);

        ctx.font = 'bold 46px "Arial Narrow", sans-serif';
        ctx.fillText('UNIVERSITY', 480, 74);

        const sheen = ctx.createLinearGradient(0, 0, 1024, 512);
        sheen.addColorStop(0.0, 'rgba(148, 184, 224, 0.12)');
        sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
        sheen.addColorStop(1.0, 'rgba(148, 184, 224, 0.10)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, 1024, 512);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    function createBusFoliageVineTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      return new THREE.CanvasTexture(canvas);
    }

    function createBusDentBumpTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 512, 256);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    const busMasterAtlasTex = createBusMasterAtlasTex();`
  );

  src = replaceExact(
    src,
    'bus left window intact glass',
    `        const isShatteredBay = isBusB ? (idx === 1 || idx === 2 || idx === 4) : (idx === 2 || idx === 3);
        const gu0 = isShatteredBay ? 0.63 : 0.82;
        const gu1 = isShatteredBay ? 0.81 : 0.98;
        pushBusUvBoxGeo(glassGeos, 0.018, 0.70, bw - 0.04, -halfW + 0.025, 2.10, wz, 0, 0, 0, gu0, 0.05, gu1, 0.95);
        if (isShatteredBay) {
          // 3D jagged glass shards jutting at angles around the broken window hole
          pushBusUvBoxGeo(glassGeos, 0.02, 0.22, 0.28, -halfW + 0.03, 2.24, wz - 0.22, 0.38, 0.06, 0, 0.82, 0.10, 0.95, 0.45);
          pushBusUvBoxGeo(glassGeos, 0.02, 0.19, 0.24, -halfW + 0.03, 1.90, wz + 0.20, -0.42, -0.05, 0, 0.82, 0.50, 0.95, 0.85);
        }`,
    `        pushBusUvBoxGeo(glassGeos, 0.018, 0.70, bw - 0.04, -halfW + 0.025, 2.10, wz, 0, 0, 0, 0.82, 0.05, 0.98, 0.95);`
  );

  src = replaceExact(
    src,
    'bus right window intact glass',
    `          const isShatteredR = isBusB ? (i === 1 || i === 3 || i === 5) : (i === 2 || i === 4);
          pushBusUvBoxGeo(glassGeos, 0.018, 0.70, 1.24, halfW - 0.025, 2.10, wz, 0, 0, 0, isShatteredR ? 0.63 : 0.82, 0.05, isShatteredR ? 0.81 : 0.98, 0.95);`,
    `          pushBusUvBoxGeo(glassGeos, 0.018, 0.70, 1.24, halfW - 0.025, 2.10, wz, 0, 0, 0, 0.82, 0.05, 0.98, 0.95);`
  );

  src = replaceBetween(
    src,
    'bus mossPads, vineCurtains, red cabin tubes & bShadow removal',
    `      // 11. Lush 3D Overgrown Moss Cushions & Layered Hanging Leafy Vine Curtains (Facing -Z Gate & -X Plaza)`,
    `      // ── STEP 4: ORIENTED BOUNDING BOX (OBB) COLLIDERS, WALKABLE FLOORS, STAIR RAMPS & ROOF CEILING ──`,
    `      const extBodyMesh = new THREE.Mesh(mergeBufferGeometries(yellowGeos), busExteriorPaintMat);
      extBodyMesh.castShadow = true;
      extBodyMesh.receiveShadow = true;
      extBodyMesh.userData.noMerge = true;
      busGroup.add(extBodyMesh);

      const extDarkMesh = new THREE.Mesh(mergeBufferGeometries(darkTrimGeos), busDarkTrimMat);
      extDarkMesh.castShadow = true;
      extDarkMesh.receiveShadow = true;
      extDarkMesh.userData.noMerge = true;
      busGroup.add(extDarkMesh);

      const extChromeMesh = new THREE.Mesh(mergeBufferGeometries(chromeGeos), busChromeTrimMat);
      extChromeMesh.userData.noMerge = true;
      busGroup.add(extChromeMesh);

      const extGlassMesh = new THREE.Mesh(mergeBufferGeometries(glassGeos), busDirtyGlassMat);
      extGlassMesh.userData.noMerge = true;
      busGroup.add(extGlassMesh);

      const extHeadlightMesh = new THREE.Mesh(mergeBufferGeometries(headlightGeos), busHeadlightEmissiveMat);
      extHeadlightMesh.userData.noMerge = true;
      busGroup.add(extHeadlightMesh);

      const extAmberMesh = new THREE.Mesh(mergeBufferGeometries(amberGeos), busAmberIndicatorMat);
      extAmberMesh.userData.noMerge = true;
      busGroup.add(extAmberMesh);

      const vineGroup = new THREE.Group();
      vineGroup.name = id + '_vines';
      vineGroup.visible = false;
      busGroup.add(vineGroup);

      const interiorGroup = new THREE.Group();
      interiorGroup.name = id + '_interior';
      interiorGroup.userData.noMerge = true;
      busGroup.add(interiorGroup);

      const intStructGeos = [];
      const intTrimGeos = [];

      pushBusUvBoxGeo(intStructGeos, bWid - 0.22, 0.03, bLen - 0.28, 0.04, floorY + 0.015, 0, 0, 0, 0, 0.52, 0.02, 0.98, 0.24);
      pushBusBoxGeo(intTrimGeos, 1.48, 0.72, 0.54, 0.40, floorY + 0.36, -4.76);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.18, 0.28, 0.62, floorY + 0.80, -4.72);
      pushBusCylGeo(intTrimGeos, 0.03, 0.03, 0.62, 6, 0.62, floorY + 0.74, -4.46, 0.45, 0, 0);
      pushBusCylGeo(intTrimGeos, 0.24, 0.24, 0.035, 10, 0.62, floorY + 0.98, -4.34, -1.12, 0, 0);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.42, 0.52, 0.62, floorY + 0.24, -3.88);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.58, 0.10, 0.62, floorY + 0.68, -3.66);
      pushBusBoxGeo(intTrimGeos, 0.76, 1.35, 0.04, 0.72, floorY + 0.68, -3.42);
      pushBusUvBoxGeo(intStructGeos, bWid - 0.28, 0.42, 0.56, 0, floorY + 0.24, 4.76, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      pushBusUvBoxGeo(intStructGeos, bWid - 0.28, 0.54, 0.12, 0, floorY + 0.68, 4.96, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      pushBusCylGeo(intTrimGeos, 0.018, 0.018, 8.6, 6, -0.42, floorY + 2.18, 0, Math.PI / 2, 0, 0);
      pushBusCylGeo(intTrimGeos, 0.018, 0.018, 8.6, 6, 0.42, floorY + 2.18, 0, Math.PI / 2, 0, 0);

      const intFloorAndRearMesh = new THREE.Mesh(mergeBufferGeometries(intStructGeos), busExteriorPaintMat);
      intFloorAndRearMesh.receiveShadow = true;
      intFloorAndRearMesh.userData.noMerge = true;
      interiorGroup.add(intFloorAndRearMesh);

      const intCabMesh = new THREE.Mesh(mergeBufferGeometries(intTrimGeos), busDarkTrimMat);
      intCabMesh.userData.noMerge = true;
      interiorGroup.add(intCabMesh);

      const leftSeatZs = [-2.10, -1.05, 0.0, 1.05, 2.10];
      const rightSeatZs = [-2.10, -1.05, 0.0, 1.05, 2.10, 3.15];
      const totalSeats = leftSeatZs.length + rightSeatZs.length;
      const seatInstMesh = new THREE.InstancedMesh(sharedBusSeatBenchGeo, busExteriorPaintMat, totalSeats);
      seatInstMesh.castShadow = true;
      seatInstMesh.receiveShadow = true;
      seatInstMesh.userData.noMerge = true;
      const dummyMat = new THREE.Matrix4();
      const dummyPos = new THREE.Vector3();
      const dummyQuat = new THREE.Quaternion();
      const dummyScale = new THREE.Vector3(1, 1, 1);
      let seatIdx = 0;
      leftSeatZs.forEach((sz) => {
        dummyPos.set(-0.78, floorY, sz);
        dummyQuat.identity();
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        seatInstMesh.setMatrixAt(seatIdx++, dummyMat);
      });
      rightSeatZs.forEach((sz) => {
        dummyPos.set(0.78, floorY, sz);
        dummyQuat.identity();
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        seatInstMesh.setMatrixAt(seatIdx++, dummyMat);
      });
      seatInstMesh.instanceMatrix.needsUpdate = true;
      interiorGroup.add(seatInstMesh);

      const poleCoords = [
        [-0.41, -2.65], [-0.41, -0.52], [-0.41, 1.58], [-0.41, 2.65],
        [0.41, -3.35],  [0.41, -1.05],  [0.41, 1.05],  [0.41, 3.15],
      ];
      const poleInstMesh = new THREE.InstancedMesh(sharedBusStanchionGeo, busChromeTrimMat, poleCoords.length);
      poleInstMesh.userData.noMerge = true;
      poleCoords.forEach(([px, pz], idx) => {
        dummyPos.set(px, floorY + 1.12, pz);
        dummyQuat.identity();
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        poleInstMesh.setMatrixAt(idx, dummyMat);
      });
      poleInstMesh.instanceMatrix.needsUpdate = true;
      interiorGroup.add(poleInstMesh);

      const warmTubeGeo = new THREE.BoxGeometry(0.16, 0.045, 3.6);
      const warmTubeMat = busWarmTubeBaseMat.clone();
      const warmTubeMesh = new THREE.Mesh(warmTubeGeo, warmTubeMat);
      warmTubeMesh.position.set(0, floorY + 2.31, -1.75);
      warmTubeMesh.userData.noMerge = true;
      interiorGroup.add(warmTubeMesh);

      const redTubeGeo = new THREE.BoxGeometry(0.16, 0.045, 3.6);
      const redTubeMat = busWarmTubeBaseMat.clone();
      const redTubeMesh = new THREE.Mesh(redTubeGeo, redTubeMat);
      redTubeMesh.position.set(0, floorY + 2.31, 1.85);
      redTubeMesh.userData.noMerge = true;
      interiorGroup.add(redTubeMesh);

      const warmGlowMat = busWarmGlowBaseMat.clone();
      warmGlowMat.opacity = 0.0;
      const redGlowMat = busWarmGlowBaseMat.clone();
      redGlowMat.opacity = 0.0;

      const propsGroup = new THREE.Group();
      propsGroup.name = id + '_props';
      propsGroup.userData.noMerge = true;
      const dustCount = 14;
      const dustPositions = new Float32Array(dustCount * 3);
      for (let d = 0; d < dustCount; d++) {
        dustPositions[d * 3] = -0.95 + ((d * 0.37) % 1.9);
        dustPositions[d * 3 + 1] = floorY + 0.35 + ((d * 0.29) % 1.85);
        dustPositions[d * 3 + 2] = -4.2 + ((d * 0.61) % 8.4);
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
      const dustPoints = new THREE.Points(dustGeo, busDustMat);
      dustPoints.userData.noMerge = true;
      propsGroup.add(dustPoints);
      propsGroup.visible = false;
      interiorGroup.add(propsGroup);

      scene.add(busGroup);

      // ── STEP 4: ORIENTED BOUNDING BOX (OBB) COLLIDERS, WALKABLE FLOORS, STAIR RAMPS & ROOF CEILING ──`
  );

  // 4. Remove rectangular ground shadow planes in populateCampusObjectDetail
  const shadowPlaneBlocks = [
    `          const tShadow = addPart(new THREE.PlaneGeometry(w * 1.15, d * 1.15), materials.treeShadowDecal, 0, 0.03, 0, -Math.PI / 2, 0, 0);\n          tShadow.userData.noMerge = true;`,
    `          const pShadow = addPart(new THREE.PlaneGeometry(w * 1.05, d * 1.05), materials.treeShadowDecal, 0, 0.03, 0, -Math.PI / 2, 0, 0);\n          pShadow.userData.noMerge = true;`,
    `          const bShadow = addPart(new THREE.PlaneGeometry(w * 1.15, d * 1.25), materials.pedestalShadowDecal, 0, 0.025, 0, -Math.PI / 2, 0, 0);\n          bShadow.userData.noMerge = true;`,
    `          const sShadow = addPart(new THREE.PlaneGeometry(w * 1.25, d * 1.15), materials.pedestalShadowDecal, 0, 0.025, 0, -Math.PI / 2, 0, 0);\n          sShadow.userData.noMerge = true;`,
    `          const vShadow = addPart(new THREE.PlaneGeometry(w * 1.18, d * 1.12), materials.pedestalShadowDecal, 0, 0.025, 0, -Math.PI / 2, 0, 0);\n          vShadow.userData.noMerge = true;`,
    `          const cShadow = addPart(new THREE.PlaneGeometry(w * 1.18, d * 1.12), materials.pedestalShadowDecal, 0, 0.025, 0, -Math.PI / 2, 0, 0);\n          cShadow.userData.noMerge = true;`,
  ];
  for (const sb of shadowPlaneBlocks) {
    src = replaceExact(src, 'populateCampusObjectDetail shadow plane removal', sb, '');
  }

  // 5. Clean natural asphaltRoad & sculptedTerrainMat
  src = replaceExact(
    src,
    'materials.asphaltRoad clean natural ground',
    `    materials.asphaltRoad = new THREE.MeshStandardMaterial({
      map: asphaltRoadTex,
      bumpMap: asphaltRoadTex,
      bumpScale: 0.028,
      normalMap: paverTex.normalMap,
      normalScale: new THREE.Vector2(0.52, 0.52),
      roughnessMap: paverTex.roughnessMap,
      color: (HORROR_CONFIG.albedo && HORROR_CONFIG.albedo.roadAsphalt) || 0x24272d,
      roughness: (HORROR_CONFIG.albedo && HORROR_CONFIG.albedo.roadRoughness) || 0.22,
      metalness: 0.26,
      envMap: lowResNightEnvCube,
      envMapIntensity: 1.15,
    });`,
    `    materials.asphaltRoad = new THREE.MeshStandardMaterial({
      map: asphaltRoadTex,
      bumpMap: asphaltRoadTex,
      bumpScale: 0.022,
      color: (HORROR_CONFIG.albedo && HORROR_CONFIG.albedo.roadAsphalt) || 0x262a30,
      roughness: (HORROR_CONFIG.albedo && HORROR_CONFIG.albedo.roadRoughness) || 0.56,
      metalness: 0.10,
      envMap: lowResNightEnvCube,
      envMapIntensity: 0.55,
    });`
  );

  src = replaceExact(
    src,
    'sculptedTerrainMat natural ground',
    `    const sculptedTerrainMat = new THREE.MeshStandardMaterial({
      map: naturalGroundTex,
      normalMap: paverTex.normalMap,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughnessMap: paverTex.roughnessMap,
      bumpMap: naturalGroundTex,
      bumpScale: 0.024,
      color: 0x3a4048,
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.18,
      envMap: lowResNightEnvCube,
      envMapIntensity: 0.92,
    });`,
    `    const sculptedTerrainMat = new THREE.MeshStandardMaterial({
      map: naturalGroundTex,
      bumpMap: naturalGroundTex,
      bumpScale: 0.020,
      color: 0x3d463e,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.04,
      envMap: lowResNightEnvCube,
      envMapIntensity: 0.38,
    });`
  );

  // 6. Disable rectangular under-furniture AO planes & window floor gobo rectangles
  src = replaceExact(
    src,
    'addUnderFurnitureAO no-op',
    `    function addUnderFurnitureAO(parent, x, z, w, d, rotY = 0, yOff = 0.016) {
      const decal = new THREE.Mesh(aoSharedPlaneGeo, materials.aoUnderDeskDecal);
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = -rotY;
      decal.position.set(x, yOff, z);
      decal.scale.set(w * 1.22, d * 1.22, 1.0);
      parent.add(decal);
    }`,
    `    function addUnderFurnitureAO(parent, x, z, w, d, rotY = 0, yOff = 0.016) {}`
  );

  src = replaceExact(
    src,
    'buildWindowLightShaftWithDust hide floor/desk gobo rectangles',
    `      // 3. Hard-edged window-shaped light patch with window-frame mullion shadows on the FLOOR
      const gobo = new THREE.Mesh(sharedWindowFramePatchGeo, step2Mats.windowHardPatchMat);
      gobo.rotation.x = -Math.PI / 2;
      gobo.position.set(inDirX * (length * 0.64), -wy + 0.024, inDirZ * (length * 0.64));
      gobo.scale.set(width * 1.28, width * 1.52, 1.0);
      gobo.userData.noMerge = true;
      shaftGrp.add(gobo);

      // 4. Hard-edged window-shaped light patch with window-frame shadows landing on nearby DESK TOPS (y = 0.76m)
      const deskGobo = new THREE.Mesh(sharedWindowFramePatchGeo, step2Mats.windowHardPatchMat);
      deskGobo.rotation.x = -Math.PI / 2;
      deskGobo.position.set(inDirX * (length * 0.38), -wy + 0.765, inDirZ * (length * 0.38));
      deskGobo.scale.set(width * 0.92, width * 1.05, 1.0);
      deskGobo.userData.noMerge = true;
      shaftGrp.add(deskGobo);`,
    `      const gobo = new THREE.Mesh(sharedWindowFramePatchGeo, step2Mats.windowHardPatchMat);
      gobo.rotation.x = -Math.PI / 2;
      gobo.position.set(inDirX * (length * 0.64), -wy + 0.024, inDirZ * (length * 0.64));
      gobo.scale.set(width * 1.28, width * 1.52, 1.0);
      gobo.visible = false;
      gobo.userData.noMerge = true;
      shaftGrp.add(gobo);

      const deskGobo = new THREE.Mesh(sharedWindowFramePatchGeo, step2Mats.windowHardPatchMat);
      deskGobo.rotation.x = -Math.PI / 2;
      deskGobo.position.set(inDirX * (length * 0.38), -wy + 0.765, inDirZ * (length * 0.38));
      deskGobo.scale.set(width * 0.92, width * 1.05, 1.0);
      deskGobo.visible = false;
      deskGobo.userData.noMerge = true;
      shaftGrp.add(deskGobo);`
  );

  // 7. Clean interiorAtlasCanvas & step2Mats (preserve dedicated PBR textures on walls, floors, ceilings, desks, doors)
  src = replaceBetween(
    src,
    'interiorAtlasCanvas & step2Mats clean materials',
    `    const interiorAtlasCanvas = document.createElement('canvas');`,
    `      handprintSmudgeMat: new THREE.MeshBasicMaterial({\n        map: interiorSurfaceAtlasTex,\n        color: 0xcbd5e1,\n        transparent: true,\n        opacity: 0.46,\n        depthWrite: false,\n        polygonOffset: true,\n        polygonOffsetFactor: -1,\n        polygonOffsetUnits: -1,\n      }),`,
    `    const interiorAtlasCanvas = document.createElement('canvas');
    interiorAtlasCanvas.width = 1024;
    interiorAtlasCanvas.height = 512;
    const iCtx = interiorAtlasCanvas.getContext('2d');

    const interiorBumpCanvas = document.createElement('canvas');
    interiorBumpCanvas.width = 1024;
    interiorBumpCanvas.height = 512;
    const bCtx = interiorBumpCanvas.getContext('2d');

    if (iCtx && bCtx) {
      bCtx.fillStyle = '#808080';
      bCtx.fillRect(0, 0, 1024, 512);

      iCtx.fillStyle = '#75543a';
      iCtx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 3) {
        iCtx.fillStyle = (y % 6 === 0) ? 'rgba(42, 26, 14, 0.16)' : 'rgba(155, 118, 82, 0.12)';
        iCtx.fillRect(0, y, 256, 2);
      }

      iCtx.fillStyle = '#d4cfc4';
      iCtx.fillRect(256, 0, 256, 256);
      iCtx.fillStyle = '#4e5852';
      iCtx.fillRect(256, 168, 256, 88);
      iCtx.fillStyle = '#2d3732';
      iCtx.fillRect(256, 164, 256, 4);

      iCtx.fillStyle = '#7c848c';
      iCtx.fillRect(512, 0, 256, 256);
      iCtx.strokeStyle = 'rgba(45, 52, 60, 0.35)';
      iCtx.lineWidth = 2;
      for (let gx = 512; gx <= 768; gx += 64) {
        iCtx.beginPath(); iCtx.moveTo(gx, 0); iCtx.lineTo(gx, 256); iCtx.stroke();
      }
      for (let gy = 0; gy <= 256; gy += 64) {
        iCtx.beginPath(); iCtx.moveTo(512, gy); iCtx.lineTo(768, gy); iCtx.stroke();
      }

      iCtx.fillStyle = '#d8dde2';
      iCtx.fillRect(768, 0, 256, 256);
      iCtx.strokeStyle = 'rgba(100, 110, 120, 0.45)';
      iCtx.lineWidth = 3;
      for (let x = 768; x <= 1024; x += 64) {
        iCtx.beginPath(); iCtx.moveTo(x, 0); iCtx.lineTo(x, 256); iCtx.stroke();
      }
      for (let y = 0; y <= 256; y += 64) {
        iCtx.beginPath(); iCtx.moveTo(768, y); iCtx.lineTo(1024, y); iCtx.stroke();
      }

      iCtx.fillStyle = '#4a5560';
      iCtx.fillRect(0, 256, 256, 256);
      iCtx.strokeStyle = 'rgba(30, 36, 42, 0.45)';
      iCtx.lineWidth = 2;
      iCtx.strokeRect(8, 264, 240, 240);

      iCtx.fillStyle = '#2d4052';
      iCtx.fillRect(256, 256, 256, 256);
      const gGrad = iCtx.createLinearGradient(256, 256, 512, 512);
      gGrad.addColorStop(0.0, 'rgba(180, 210, 240, 0.18)');
      gGrad.addColorStop(0.5, 'rgba(40, 60, 80, 0.08)');
      gGrad.addColorStop(1.0, 'rgba(160, 195, 230, 0.14)');
      iCtx.fillStyle = gGrad;
      iCtx.fillRect(256, 256, 256, 256);

      iCtx.fillStyle = '#1b362a';
      iCtx.fillRect(512, 256, 256, 256);
      iCtx.fillStyle = 'rgba(235, 242, 238, 0.78)';
      iCtx.font = 'bold 11px monospace';
      iCtx.fillText('GANDAKI UNIVERSITY — B.E. IT', 524, 286);
      iCtx.font = '10px monospace';
      iCtx.fillText('f(x) = ∫ e^(-x²) dx = √π / 2', 524, 312);
      iCtx.fillText('∇ × E = -∂B / ∂t   (Maxwell)', 524, 334);
      iCtx.fillText('Data Structures & Algorithms', 524, 358);
      iCtx.strokeStyle = 'rgba(235, 242, 238, 0.65)';
      iCtx.lineWidth = 1.5;
      iCtx.strokeRect(528, 378, 86, 54);
      iCtx.beginPath();
      iCtx.arc(682, 405, 26, 0, Math.PI * 2);
      iCtx.stroke();

      iCtx.fillStyle = '#e2e8f0';
      iCtx.fillRect(768, 256, 128, 128);
      iCtx.fillStyle = '#1e293b';
      iCtx.font = 'bold 8px sans-serif';
      iCtx.fillText('GANDAKI UNIVERSITY', 776, 272);
      iCtx.fillText('LAB ATTENDANCE SHEET', 776, 283);
      iCtx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
      iCtx.lineWidth = 1;
      for (let ry = 292; ry < 376; ry += 10) {
        iCtx.beginPath(); iCtx.moveTo(774, ry); iCtx.lineTo(888, ry); iCtx.stroke();
      }
      iCtx.fillStyle = '#cbd5e1';
      iCtx.fillRect(896, 256, 128, 128);
      iCtx.fillStyle = '#0f172a';
      iCtx.fillRect(896, 384, 128, 128);
    }

    const interiorSurfaceAtlasTex = new THREE.CanvasTexture(interiorAtlasCanvas);
    interiorSurfaceAtlasTex.wrapS = THREE.ClampToEdgeWrapping;
    interiorSurfaceAtlasTex.wrapT = THREE.ClampToEdgeWrapping;
    interiorSurfaceAtlasTex.colorSpace = THREE.SRGBColorSpace || 'srgb';
    if ('encoding' in interiorSurfaceAtlasTex && THREE.sRGBEncoding) interiorSurfaceAtlasTex.encoding = THREE.sRGBEncoding;
    interiorSurfaceAtlasTex.needsUpdate = true;

    const interiorSurfaceBumpTex = new THREE.CanvasTexture(interiorBumpCanvas);
    interiorSurfaceBumpTex.wrapS = THREE.ClampToEdgeWrapping;
    interiorSurfaceBumpTex.wrapT = THREE.ClampToEdgeWrapping;
    interiorSurfaceBumpTex.needsUpdate = true;

    const dustyGlassTex = interiorSurfaceAtlasTex;

    function remapInteriorAtlasUVs(geo, px, py, pw, ph) {
      if (!geo || !geo.attributes || !geo.attributes.uv) return geo;
      const uv = geo.attributes.uv;
      const u0 = (px + 2) / 1024;
      const u1 = (px + pw - 2) / 1024;
      const v0 = 1.0 - (py + ph - 2) / 512;
      const v1 = 1.0 - (py + 2) / 512;
      for (let i = 0; i < uv.count; i++) {
        const u = ((uv.getX(i) % 1) + 1) % 1;
        const v = ((uv.getY(i) % 1) + 1) % 1;
        uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
      }
      uv.needsUpdate = true;
      return geo;
    }

    materials.deskWoodTop.color.setHex(0x8c6d53);
    materials.deskWoodTop.roughness = 0.46;

    materials.chairWood.color.setHex(0x6e513b);
    materials.chairWood.roughness = 0.50;

    materials.deskSteelFrame.color.setHex(0x4a5560);
    materials.deskSteelFrame.roughness = 0.36;
    materials.deskSteelFrame.metalness = 0.72;

    materials.rotundaInteriorWall.color.setHex(0xc8c2b6);
    materials.rotundaInteriorWall.roughness = 0.68;

    materials.rotundaTerrazzoFloor.roughness = 0.28;
    materials.rotundaTerrazzoFloor.metalness = 0.18;
    materials.rotundaTerrazzoFloor.color.setHex(0x889098);

    materials.stainedCeilingTiles.color.setHex(0xd4d8dc);
    materials.stainedCeilingTiles.roughness = 0.78;

    materials.blackboardGreen.map = interiorSurfaceAtlasTex;
    materials.blackboardGreen.bumpMap = interiorSurfaceBumpTex;
    materials.blackboardGreen.bumpScale = 0.012;
    materials.blackboardGreen.color.setHex(0x9ab0a4);
    materials.blackboardGreen.roughness = 0.54;

    materials.windowGlass.color.setHex(0x385064);
    materials.windowGlass.roughness = 0.14;

    const step2Mats = {
      curtainFabric: new THREE.MeshStandardMaterial({ color: 0x35424f, roughness: 0.86, side: THREE.DoubleSide }),
      curtainGold: new THREE.MeshStandardMaterial({ color: 0x6b4e35, roughness: 0.82, side: THREE.DoubleSide }),
      lockerSteel: new THREE.MeshStandardMaterial({ color: 0x475460, roughness: 0.38, metalness: 0.66 }),
      rustedLockerMetal: new THREE.MeshStandardMaterial({ color: 0x475460, roughness: 0.42, metalness: 0.60 }),
      lockerDoorBlue: new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.38, metalness: 0.60 }),
      fireRed: new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.34, metalness: 0.42 }),
      waterJugBlue: new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.16, metalness: 0.20, transparent: true, opacity: 0.78 }),
      matRubber: new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.90 }),
      corkBoard: new THREE.MeshStandardMaterial({ color: 0x8c6340, roughness: 0.84 }),
      paperSheet: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.78 }),
      bagNavy: new THREE.MeshStandardMaterial({ color: 0x26364a, roughness: 0.84 }),
      bagOlive: new THREE.MeshStandardMaterial({ color: 0x2f3e30, roughness: 0.84 }),
      bagMaroon: new THREE.MeshStandardMaterial({ color: 0x4a252a, roughness: 0.84 }),
      sofaLeather: new THREE.MeshStandardMaterial({ color: 0x2c3531, roughness: 0.44, metalness: 0.14 }),
      greenMarbleTop: new THREE.MeshStandardMaterial({ color: 0x2e4a3e, roughness: 0.20, metalness: 0.28 }),
      monitorScreenOn: new THREE.MeshStandardMaterial({ color: 0x0c1824, emissive: 0x2b5b84, emissiveIntensity: 0.48, roughness: 0.18 }),
      monitorScreenOff: new THREE.MeshStandardMaterial({ color: 0x121820, roughness: 0.20, metalness: 0.44 }),
      serverLedGreen: new THREE.MeshBasicMaterial({ color: 0x4d8c57 }),
      serverLedAmber: new THREE.MeshBasicMaterial({ color: 0xc27d2c }),
      exitSignGreenMat: new THREE.MeshStandardMaterial({ color: 0x166534, emissive: 0x22c55e, emissiveIntensity: 1.65, roughness: 0.22 }),
      recessedPanelWarmMat: new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xeab308, emissiveIntensity: 1.25, roughness: 0.20 }),
      lampShadeGreen: new THREE.MeshStandardMaterial({ color: 0x1f3d2b, emissive: 0xd99242, emissiveIntensity: 0.72, roughness: 0.30 }),
      ceramicWhite: new THREE.MeshStandardMaterial({ color: 0xdbe2e8, roughness: 0.22, metalness: 0.14 }),
      mirrorGlass: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.08, metalness: 0.92 }),
      stainlessSteel: new THREE.MeshStandardMaterial({ color: 0x7c8894, roughness: 0.26, metalness: 0.80 }),
      cardboardCrate: new THREE.MeshStandardMaterial({ color: 0x7c5d41, roughness: 0.84 }),
      vineGreen: new THREE.MeshStandardMaterial({ color: 0x243828, roughness: 0.82, side: THREE.DoubleSide }),
      terrazzoInlayGold: new THREE.MeshStandardMaterial({ color: 0x8c7342, roughness: 0.28, metalness: 0.40 }),
      terrazzoInlayDark: new THREE.MeshStandardMaterial({ color: 0x242c36, roughness: 0.26, metalness: 0.25 }),
      wallStainDecal: new THREE.MeshBasicMaterial({ map: softContactShadowTex, color: 0x05080c, transparent: true, opacity: 0.0, depthWrite: false }),
      cobwebMat: new THREE.MeshBasicMaterial({ color: 0x7c868f, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }),
      moonlightShaftMat: new THREE.MeshBasicMaterial({ map: windowLightShaftTex, color: 0x8cc2f5, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      corridorMistMat: new THREE.MeshBasicMaterial({ map: corridorFogTex, color: 0x5c768f, transparent: true, opacity: 0.0, depthWrite: false }),
      floorWetSheenMat: new THREE.MeshStandardMaterial({
        color: 0x1a2836,
        roughness: 0.32,
        metalness: 0.18,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      }),
      steadyDimTubeMat: new THREE.MeshStandardMaterial({
        color: 0xf4f9ff,
        emissive: 0xd8ecff,
        emissiveIntensity: 1.35,
        roughness: 0.16,
        metalness: 0.12,
      }),
      exitSignRedMat: new THREE.MeshStandardMaterial({
        color: 0xfca5a5,
        emissive: 0xdc2626,
        emissiveIntensity: 1.25,
        roughness: 0.22,
      }),
      handprintSmudgeMat: new THREE.MeshBasicMaterial({
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      }),`
  );

  // 8. Clean applyWallBaseAndEaveGrime & addWarmDoorwayGlow
  src = replaceExact(
    src,
    'applyWallBaseAndEaveGrime uniform clean wall colors',
    `    function applyWallBaseAndEaveGrime(geo, h, yBottomOffset = 0.0, totalWallH = null) {
      if (!geo || !geo.attributes || !geo.attributes.position) return geo;
      const pos = geo.attributes.position;
      const fullH = totalWallH || h;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const localY = (pos.getY(i) + h * 0.5) + yBottomOffset;
        const normY = Math.max(0.0, Math.min(1.0, localY / Math.max(0.5, fullH)));
        // Dark grime rising from wall base (0.0 .. 0.28 of wall height) + subtle damp stain at roof edge (0.82 .. 1.0)
        let shade = 1.0;
        if (normY < 0.28) {
          const tBase = normY / 0.28;
          shade *= (0.48 + 0.52 * (tBase * tBase * (3.0 - 2.0 * tBase)));
        } else if (normY > 0.82) {
          const tTop = (1.0 - normY) / 0.18;
          shade *= (0.72 + 0.28 * Math.max(0.0, tTop));
        }
        colors[i * 3 + 0] = shade * 0.96;
        colors[i * 3 + 1] = shade * 0.98;
        colors[i * 3 + 2] = shade;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.userData.preserveVertexColors = true;
      return geo;
    }`,
    `    function applyWallBaseAndEaveGrime(geo, h, yBottomOffset = 0.0, totalWallH = null) {
      if (!geo || !geo.attributes || !geo.attributes.position) return geo;
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        colors[i * 3 + 0] = 0.98;
        colors[i * 3 + 1] = 0.99;
        colors[i * 3 + 2] = 1.00;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.userData.preserveVertexColors = true;
      return geo;
    }`
  );

  src = replaceExact(
    src,
    'addWarmDoorwayGlow remove orange square floor pool',
    `    function addWarmDoorwayGlow(dx, floorY, dz, spanW = 1.9, isAlongZ = false) {
      // Warm additive threshold pool just above the floor
      const pool = new THREE.Mesh(doorwayGlowPoolGeo, doorwayGlowPoolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(dx, floorY + 0.025, dz);
      scene.add(pool);

      // Warm emissive transom glow strip at the top of the doorway
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(isAlongZ ? 0.18 : spanW * 0.85, 0.08, isAlongZ ? spanW * 0.85 : 0.18),
        materials.windowWarmLit
      );
      strip.position.set(dx, floorY + 2.52, dz);
      scene.add(strip);
    }`,
    `    function addWarmDoorwayGlow(dx, floorY, dz, spanW = 1.9, isAlongZ = false) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(isAlongZ ? 0.18 : spanW * 0.85, 0.08, isAlongZ ? spanW * 0.85 : 0.18),
        materials.windowWarmLit
      );
      strip.position.set(dx, floorY + 2.52, dz);
      scene.add(strip);
    }`
  );

  // 9. Clean rotundaBrick, rotundaWhiteArch, and rotundaWindowRed
  src = replaceBetween(
    src,
    'rotundaBrick, rotundaWhiteArch, and rotundaWindowRed',
    `      rotundaBrick: (function() {`,
    `          roughness: 0.18,\n          metalness: 0.18,\n        });\n      })(),`,
    `      rotundaBrick: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const fineWallTex = createProceduralTexture(1024, 1024, (ctx) => {
          ctx.fillStyle = '#9ca6b0';
          ctx.fillRect(0, 0, 1024, 1024);
          for (let py = 0; py < 1024; py += 64) {
            for (let px = 0; px < 1024; px += 64) {
              const v = ((px * 17 + py * 31) % 16) - 8;
              ctx.fillStyle = v >= 0 ? ('rgba(235, 240, 245, ' + (v * 0.004) + ')') : ('rgba(28, 36, 44, ' + (-v * 0.004) + ')');
              ctx.fillRect(px, py, 64, 64);
            }
          }
          for (let y = 0; y < 1024; y += 32) {
            ctx.fillStyle = 'rgba(30, 38, 46, 0.14)';
            ctx.fillRect(0, y, 1024, 1.5);
            ctx.fillStyle = 'rgba(240, 244, 248, 0.10)';
            ctx.fillRect(0, y + 1.5, 1024, 1.5);
            const rowOff = ((y / 32) % 2) * 32;
            ctx.fillStyle = 'rgba(30, 38, 46, 0.10)';
            for (let x = rowOff; x < 1024; x += 64) {
              ctx.fillRect(x, y, 1.5, 32);
            }
          }
        }, 'main-bldg-fine-wall-plaster-1024');
        fineWallTex.wrapS = THREE.RepeatWrapping;
        fineWallTex.wrapT = THREE.RepeatWrapping;
        fineWallTex.repeat.set(4, 2);
        fineWallTex.generateMipmaps = true;
        fineWallTex.minFilter = THREE.LinearMipmapLinearFilter;
        fineWallTex.anisotropy = mb.windowAnisotropy || 16;
        return new THREE.MeshStandardMaterial({
          map: fineWallTex,
          bumpMap: fineWallTex,
          bumpScale: mb.wallNormalScale !== undefined ? mb.wallNormalScale : 0.016,
          color: mb.wallColor || 0xa6b0b8,
          emissive: mb.wallEmissive || 0x0d151e,
          emissiveIntensity: mb.wallEmissiveIntensity !== undefined ? mb.wallEmissiveIntensity : 0.08,
          roughness: mb.wallRoughness !== undefined ? mb.wallRoughness : 0.64,
          side: THREE.FrontSide,
        });
      })(),
      rotundaWhiteArch: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const colPlasterTex = createProceduralTexture(1024, 1024, (ctx) => {
          ctx.fillStyle = '#dde4ea';
          ctx.fillRect(0, 0, 1024, 1024);
          for (let y = 0; y < 1024; y += 64) {
            ctx.fillStyle = 'rgba(36, 48, 60, 0.12)';
            ctx.fillRect(0, y, 1024, 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.fillRect(0, y + 2, 1024, 2);
          }
          for (let i = 0; i < 600; i++) {
            const gx = (i * 97) % 1024;
            const gy = (i * 163) % 1024;
            ctx.fillStyle = (i % 2 === 0) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(32, 42, 52, 0.06)';
            ctx.fillRect(gx, gy, 3, 3);
          }
        }, 'main-bldg-col-trim-plaster-1024');
        colPlasterTex.wrapS = THREE.RepeatWrapping;
        colPlasterTex.wrapT = THREE.RepeatWrapping;
        colPlasterTex.repeat.set(2, 2);
        colPlasterTex.generateMipmaps = true;
        colPlasterTex.minFilter = THREE.LinearMipmapLinearFilter;
        colPlasterTex.anisotropy = mb.windowAnisotropy || 16;
        return new THREE.MeshStandardMaterial({
          map: colPlasterTex,
          bumpMap: colPlasterTex,
          bumpScale: mb.columnNormalScale !== undefined ? mb.columnNormalScale : 0.014,
          color: mb.columnColor || 0xe2e8f0,
          emissive: mb.columnEmissive || 0x14202e,
          emissiveIntensity: mb.columnEmissiveIntensity !== undefined ? mb.columnEmissiveIntensity : 0.12,
          roughness: mb.columnRoughness !== undefined ? mb.columnRoughness : 0.48,
          side: THREE.FrontSide,
        });
      })(),
      rotundaDomeGold: new THREE.MeshStandardMaterial({
        map: carvedSalTex.map,
        bumpMap: carvedSalTex.bumpMap,
        bumpScale: 0.03,
        color: 0x3b2c20,
        roughness: 0.64,
        metalness: 0.16,
        side: THREE.FrontSide,
      }),
      rotundaWindowAmber: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 1024;
        const winAmberTex = createProceduralTexture(sz, sz, (ctx) => {
          const bg = ctx.createLinearGradient(0, sz, 0, 0);
          bg.addColorStop(0.0, '#fff0c8');
          bg.addColorStop(0.38, '#f6ad49');
          bg.addColorStop(0.78, '#b8621b');
          bg.addColorStop(1.0, '#4a2208');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sz, sz);

          const rad = ctx.createRadialGradient(sz * 0.5, sz * 0.28, sz * 0.02, sz * 0.5, sz * 0.48, sz * 0.58);
          rad.addColorStop(0.0, 'rgba(255, 250, 232, 0.96)');
          rad.addColorStop(0.32, 'rgba(255, 196, 102, 0.65)');
          rad.addColorStop(0.72, 'rgba(180, 92, 24, 0.25)');
          rad.addColorStop(1.0, 'rgba(18, 8, 2, 0.52)');
          ctx.fillStyle = rad;
          ctx.fillRect(0, 0, sz, sz);

          ctx.fillStyle = 'rgba(42, 18, 6, 0.34)';
          for (let by = Math.round(sz * 0.07); by < Math.round(sz * 0.44); by += Math.round(sz * 0.028)) {
            ctx.fillRect(0, by, sz, Math.round(sz * 0.013));
          }

          const fHex = mb.windowFrameHex || '#11171f';
          const bW = Math.round(sz * 0.055);
          const mW = Math.round(sz * 0.036);
          ctx.fillStyle = fHex;
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));
        }, 'main-bldg-win-amber-1024');
        winAmberTex.generateMipmaps = true;
        winAmberTex.minFilter = THREE.LinearMipmapLinearFilter;
        winAmberTex.magFilter = THREE.LinearFilter;
        winAmberTex.anisotropy = mb.windowAnisotropy || 16;
        return new THREE.MeshStandardMaterial({
          map: winAmberTex,
          emissiveMap: winAmberTex,
          color: mb.windowAmberColor || 0xffcf86,
          emissive: mb.windowAmberEmissive || 0xff9b38,
          emissiveIntensity: mb.windowAmberEmissiveIntensity !== undefined ? mb.windowAmberEmissiveIntensity : 0.96,
          roughness: 0.16,
          metalness: 0.18,
        });
      })(),
      rotundaWindowCool: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 1024;
        const winCoolTex = createProceduralTexture(sz, sz, (ctx) => {
          const bg = ctx.createLinearGradient(0, 0, 0, sz);
          bg.addColorStop(0.0, '#e6f6ff');
          bg.addColorStop(0.36, '#8ac8ee');
          bg.addColorStop(0.78, '#38688c');
          bg.addColorStop(1.0, '#162c40');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sz, sz);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.fillRect(sz * 0.18, sz * 0.16, sz * 0.64, sz * 0.032);
          ctx.fillRect(sz * 0.18, sz * 0.22, sz * 0.64, sz * 0.024);

          const fHex = mb.windowFrameHex || '#11171f';
          const bW = Math.round(sz * 0.055);
          const mW = Math.round(sz * 0.036);
          ctx.fillStyle = fHex;
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));
        }, 'main-bldg-win-cool-1024');
        winCoolTex.generateMipmaps = true;
        winCoolTex.minFilter = THREE.LinearMipmapLinearFilter;
        winCoolTex.magFilter = THREE.LinearFilter;
        winCoolTex.anisotropy = mb.windowAnisotropy || 16;
        return new THREE.MeshStandardMaterial({
          map: winCoolTex,
          emissiveMap: winCoolTex,
          color: mb.windowCoolColor || 0xcceeff,
          emissive: mb.windowCoolEmissive || 0x74b9e8,
          emissiveIntensity: mb.windowCoolEmissiveIntensity !== undefined ? mb.windowCoolEmissiveIntensity : 0.86,
          roughness: 0.14,
          metalness: 0.22,
        });
      })(),
      rotundaWindowRed: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 1024;
        const winWarmTex = createProceduralTexture(sz, sz, (ctx) => {
          const bg = ctx.createLinearGradient(0, sz, 0, 0);
          bg.addColorStop(0.0, '#ffefd2');
          bg.addColorStop(0.42, '#f0b254');
          bg.addColorStop(0.82, '#9c581c');
          bg.addColorStop(1.0, '#3d2008');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sz, sz);

          const fHex = mb.windowFrameHex || '#11171f';
          const bW = Math.round(sz * 0.055);
          const mW = Math.round(sz * 0.036);
          ctx.fillStyle = fHex;
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));
        }, 'main-bldg-win-red-1024');
        winWarmTex.generateMipmaps = true;
        winWarmTex.minFilter = THREE.LinearMipmapLinearFilter;
        winWarmTex.magFilter = THREE.LinearFilter;
        winWarmTex.anisotropy = mb.windowAnisotropy || 16;
        return new THREE.MeshStandardMaterial({
          map: winWarmTex,
          emissiveMap: winWarmTex,
          color: 0xffd296,
          emissive: 0xe69a38,
          emissiveIntensity: 0.86,
          roughness: 0.16,
          metalness: 0.18,
        });
      })(),`
  );

  // 10. Clean createProceduralTextureWithBump
  src = replaceBetween(
    src,
    'createProceduralTextureWithBump clean architectural textures',
    `      } else if (type === 'pale-campus-stucco') {`,
    `      };\n\n      const maxAniso =`,
    `      } else if (type === 'pale-campus-stucco') {
          ctx.fillStyle = '#c8bca6';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#808080';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#9a9a9a';
          rCtx.fillRect(0, 0, 512, 512);

          for (let y = 0; y < 512; y += 32) {
            for (let x = 0; x < 512; x += 32) {
              const v = ((x * 13 + y * 29) % 14) - 7;
              ctx.fillStyle = v >= 0 ? ('rgba(255, 250, 242, ' + (v * 0.004) + ')') : ('rgba(40, 34, 28, ' + (-v * 0.004) + ')');
              ctx.fillRect(x, y, 32, 32);
            }
          }
          for (let i = 0; i < 900; i++) {
            const px = (i * 73) % 512;
            const py = (i * 137) % 512;
            ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(60,52,44,0.03)';
            ctx.fillRect(px, py, 2, 2);
            bCtx.fillStyle = (i % 2 === 0) ? '#888888' : '#787878';
            bCtx.fillRect(px, py, 2, 2);
          }

        } else if (type === 'interlocking-pavers') {
          ctx.fillStyle = '#5c6268';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#585858';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#888888';
          rCtx.fillRect(0, 0, 512, 512);

          const pW = 64, pH = 32;
          for (let row = 0; row < 512 / pH; row++) {
            const y = row * pH;
            const offset = (row % 2) * (pW / 2);
            for (let col = -1; col < 512 / pW + 1; col++) {
              const x = col * pW + offset;
              const shade = ((row * 7 + col * 13) % 12) - 6;
              ctx.fillStyle = 'rgb(' + (108 + shade) + ',' + (112 + shade) + ',' + (118 + shade) + ')';
              ctx.fillRect(x + 2, y + 2, pW - 4, pH - 4);
              bCtx.fillStyle = '#a8a8a8';
              bCtx.fillRect(x + 2, y + 2, pW - 4, pH - 4);
            }
          }

        } else if (type === 'surveyor-field-grass') {
          ctx.fillStyle = '#243826';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#787878';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#b0b0b0';
          rCtx.fillRect(0, 0, 512, 512);
          for (let i = 0; i < 1400; i++) {
            const gx = (i * 53) % 512;
            const gy = (i * 97) % 512;
            ctx.fillStyle = (i % 3 === 0) ? 'rgba(54, 82, 52, 0.25)' : 'rgba(22, 36, 24, 0.25)';
            ctx.fillRect(gx, gy, 3, 6);
          }

        } else if (type === 'dachi-appa-brick') {
          ctx.fillStyle = '#8c7e70';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#484848';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#909090';
          rCtx.fillRect(0, 0, 512, 512);

          const bH = 32, bW = 64, mortar = 3;
          for (let row = 0; row < 512 / bH; row++) {
            const y = row * bH;
            const offset = (row % 2) * (bW / 2);
            for (let col = -1; col < 512 / bW + 1; col++) {
              const x = col * bW + offset;
              const v = ((row * 11 + col * 19) % 16) - 8;
              ctx.fillStyle = 'rgb(' + (152 + v) + ',' + (68 + Math.round(v * 0.5)) + ',' + (48 + Math.round(v * 0.4)) + ')';
              ctx.fillRect(x + mortar, y + mortar, bW - mortar * 2, bH - mortar * 2);
              bCtx.fillStyle = '#b8b8b8';
              bCtx.fillRect(x + mortar, y + mortar, bW - mortar * 2, bH - mortar * 2);
            }
          }

        } else if (type === 'carved-sal-wood') {
          ctx.fillStyle = '#5a3a24';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#808080';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#848484';
          rCtx.fillRect(0, 0, 512, 512);
          for (let y = 0; y < 512; y += 4) {
            ctx.fillStyle = (y % 8 === 0) ? 'rgba(32, 18, 10, 0.22)' : 'rgba(110, 74, 48, 0.14)';
            ctx.fillRect(0, y, 512, 2);
          }

        } else if (type === 'scuffed-classroom-floor') {
          ctx.fillStyle = '#828a92';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#909090';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#585858';
          rCtx.fillRect(0, 0, 512, 512);
          const tileSz = 128;
          ctx.strokeStyle = 'rgba(48, 54, 62, 0.32)';
          cCtxLine:
          ctx.lineWidth = 2;
          for (let p = 0; p <= 512; p += tileSz) {
            ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
          }

        } else if (type === 'stained-ceiling-tiles' || type === 'stained-acoustic-tile') {
          ctx.fillStyle = '#d8dde2';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#888888';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#a0a0a0';
          rCtx.fillRect(0, 0, 512, 512);
          const gridSz = 128;
          ctx.strokeStyle = 'rgba(110, 118, 128, 0.42)';
          ctx.lineWidth = 3;
          for (let p = 0; p <= 512; p += gridSz) {
            ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, p); cCtxGrid: ctx.lineTo(512, p); ctx.stroke();
          }

        } else if (type === 'peeling-paint-wall' || type === 'water-damaged-wall') {
          ctx.fillStyle = '#cfc9bc';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#848484';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#989898';
          rCtx.fillRect(0, 0, 512, 512);

        } else if (type === 'worn-wood-grain') {
          ctx.fillStyle = '#7c5a3f';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#848484';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#727272';
          rCtx.fillRect(0, 0, 512, 512);
          for (let y = 0; y < 512; y += 4) {
            ctx.fillStyle = (y % 8 === 0) ? 'rgba(44, 28, 16, 0.16)' : 'rgba(148, 110, 78, 0.12)';
            ctx.fillRect(0, y, 512, 2);
          }

        } else if (type === 'dirty-window-glass' || type === 'cracked-glass') {
          ctx.fillStyle = '#32465a';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#808080';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#282828';
          rCtx.fillRect(0, 0, 512, 512);

        } else if (type === 'scuffed-board') {
          ctx.fillStyle = '#1e3a2f';
          ctx.fillRect(0, 0, 512, 512);
          bCtx.fillStyle = '#808080';
          bCtx.fillRect(0, 0, 512, 512);
          rCtx.fillStyle = '#707070';
          rCtx.fillRect(0, 0, 512, 512);
        }
      };

      const maxAniso =`
  );

  // 11. Realistic Dark Night Sky & Drifting Volumetric Clouds
  src = replaceBetween(
    src,
    'buildCloudyMoonlitSkyDome & updateSky',
    `      buildCloudyMoonlitSkyDome() {`,
    `      setShadowsOnly(enabled) {`,
    `      buildCloudyMoonlitSkyDome() {
        if (this.skyGroup) {
          this.scene.remove(this.skyGroup);
        }
        const skyGroup = new THREE.Group();
        skyGroup.name = 'RealisticNightSkyDome';
        this.skyGroup = skyGroup;
        this.nightClouds = [];
        this.skyLanterns = [];
        this.shootingStar = null;

        const domeW = 2048;
        const domeH = 1024;
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = domeW;
        skyCanvas.height = domeH;
        const ctx = skyCanvas.getContext('2d');

        if (ctx) {
          const horizonY = Math.floor(domeH * 0.54);
          const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
          skyGrad.addColorStop(0.0, '#02050c');
          skyGrad.addColorStop(0.32, '#040914');
          skyGrad.addColorStop(0.68, '#071120');
          skyGrad.addColorStop(0.92, '#091526');
          skyGrad.addColorStop(1.0, '#070d18');
          ctx.fillStyle = skyGrad;
          ctx.fillRect(0, 0, domeW, domeH);

          const moonGlowX = domeW * 0.66;
          const moonGlowY = domeH * 0.24;
          const lunarGlow = ctx.createRadialGradient(moonGlowX, moonGlowY, 12, moonGlowX, moonGlowY, 420);
          lunarGlow.addColorStop(0.0, 'rgba(186, 214, 248, 0.28)');
          lunarGlow.addColorStop(0.28, 'rgba(120, 158, 210, 0.14)');
          lunarGlow.addColorStop(0.65, 'rgba(42, 68, 108, 0.05)');
          lunarGlow.addColorStop(1.0, 'rgba(8, 16, 30, 0.0)');
          ctx.fillStyle = lunarGlow;
          ctx.fillRect(0, 0, domeW, horizonY);

          for (let i = 0; i < 950; i++) {
            const sx = (i * 173 + (i * i * 19)) % domeW;
            const sy = (i * 97 + (i * 31)) % Math.floor(horizonY * 0.86);
            const elevFade = 1.0 - (sy / horizonY) * 0.75;
            const bright = (0.25 + ((i * 37) % 75) / 100.0) * elevFade;
            const sz = (i % 19 === 0) ? 2.0 : ((i % 5 === 0) ? 1.4 : 1.0);
            ctx.fillStyle = (i % 7 === 0)
              ? ('rgba(205, 226, 255, ' + bright.toFixed(3) + ')')
              : ('rgba(240, 246, 255, ' + bright.toFixed(3) + ')');
            ctx.fillRect(sx, sy, sz, sz);
          }

          const paintNightCloudBank = (cx, cy, rx, ry, puffs, alphaBase) => {
            for (let p = 0; p < puffs; p++) {
              const frac = (p / puffs) - 0.5;
              const px = ((cx + frac * rx * 1.45 + Math.sin(p * 2.1) * rx * 0.22) + domeW) % domeW;
              const py = cy + Math.cos(p * 1.7) * ry * 0.36;
              const prx = rx * (0.38 + ((p * 13) % 10) * 0.045);
              const pry = ry * (0.46 + ((p * 7) % 8) * 0.055);
              const distToMoon = Math.hypot(px - moonGlowX, py - moonGlowY);
              const silverRim = Math.max(0.0, 1.0 - distToMoon / 680.0);

              ctx.save();
              ctx.translate(px, py);
              ctx.scale(1.0, pry / Math.max(1, prx));
              const cGrad = ctx.createRadialGradient(0, -prx * 0.18, prx * 0.05, 0, 0, prx);
              const rTop = Math.round(28 + silverRim * 64);
              const gTop = Math.round(42 + silverRim * 82);
              const bTop = Math.round(64 + silverRim * 105);
              cGrad.addColorStop(0.0, 'rgba(' + rTop + ',' + gTop + ',' + bTop + ',' + (alphaBase * (0.85 + silverRim * 0.35)).toFixed(3) + ')');
              cGrad.addColorStop(0.55, 'rgba(14, 24, 38, ' + (alphaBase * 0.72).toFixed(3) + ')');
              cGrad.addColorStop(1.0, 'rgba(6, 12, 22, 0.0)');
              ctx.fillStyle = cGrad;
              ctx.beginPath();
              ctx.arc(0, 0, prx, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          };

          const cloudBanks = [
            [240, 195, 190, 46, 11, 0.42],
            [610, 165, 220, 52, 13, 0.46],
            [980, 210, 240, 54, 14, 0.44],
            [1340, 175, 230, 50, 14, 0.52],
            [1680, 225, 210, 48, 12, 0.46],
            [1940, 185, 180, 44, 10, 0.40],
            [420, 310, 260, 42, 14, 0.38],
            [1160, 295, 280, 46, 15, 0.44],
            [1560, 320, 250, 42, 13, 0.42],
            [820, 120, 175, 36, 9, 0.32],
          ];
          cloudBanks.forEach(([cx, cy, rx, ry, puffs, a]) => {
            paintNightCloudBank(cx, cy, rx, ry, puffs, a);
          });

          ctx.fillStyle = '#050a13';
          ctx.beginPath();
          ctx.moveTo(0, domeH);
          for (let x = 0; x <= domeW; x += 16) {
            const ang = (x / domeW) * Math.PI * 2;
            const ridgeH = Math.sin(ang * 3.0 + 0.4) * 28
              + Math.cos(ang * 7.0 - 1.1) * 16
              + Math.sin(ang * 13.0 + 2.2) * 8;
            ctx.lineTo(x, horizonY - 22 - ridgeH);
          }
          ctx.lineTo(domeW, domeH);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#04070e';
          ctx.beginPath();
          ctx.moveTo(0, domeH);
          for (let x = 0; x <= domeW; x += 16) {
            const ang = (x / domeW) * Math.PI * 2;
            const nearH = Math.cos(ang * 4.0 + 1.2) * 18 + Math.sin(ang * 9.0) * 9;
            ctx.lineTo(x, horizonY - 4 - nearH);
          }
          ctx.lineTo(domeW, domeH);
          ctx.closePath();
          ctx.fill();
        }

        const skyDomeTex = new THREE.CanvasTexture(skyCanvas);
        skyDomeTex.wrapS = THREE.RepeatWrapping;
        skyDomeTex.wrapT = THREE.ClampToEdgeWrapping;
        skyDomeTex.colorSpace = THREE.SRGBColorSpace || 'srgb';
        if ('encoding' in skyDomeTex && THREE.sRGBEncoding) skyDomeTex.encoding = THREE.sRGBEncoding;
        skyDomeTex.needsUpdate = true;

        const domeGeo = new THREE.SphereGeometry(250, 48, 32);
        const domeMat = new THREE.MeshBasicMaterial({
          map: skyDomeTex,
          side: THREE.BackSide,
          fog: false,
          depthWrite: false,
        });
        const domeMesh = new THREE.Mesh(domeGeo, domeMat);
        domeMesh.renderOrder = -20;
        skyGroup.add(domeMesh);

        const starCount = 450;
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
          const theta = ((i * 137.508) % 360) * (Math.PI / 180);
          const u = ((i * 73) % 1000) / 1000.0;
          const phi = Math.acos(0.18 + u * 0.80);
          const r = 232.0;
          starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
          starPos[i * 3 + 1] = r * Math.cos(phi);
          starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
          color: 0xdbeafe,
          size: 1.15,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.78,
          fog: false,
          depthWrite: false,
        });
        const starPoints = new THREE.Points(starGeo, starMat);
        starPoints.renderOrder = -18;
        skyGroup.add(starPoints);

        const moonCanvas = document.createElement('canvas');
        moonCanvas.width = 256;
        moonCanvas.height = 256;
        const mCtx = moonCanvas.getContext('2d');
        if (mCtx) {
          const halo = mCtx.createRadialGradient(128, 128, 22, 128, 128, 124);
          halo.addColorStop(0.0, 'rgba(245, 250, 255, 0.98)');
          halo.addColorStop(0.20, 'rgba(226, 238, 255, 0.92)');
          halo.addColorStop(0.24, 'rgba(175, 206, 245, 0.38)');
          halo.addColorStop(0.55, 'rgba(110, 150, 210, 0.12)');
          halo.addColorStop(1.0, 'rgba(15, 28, 48, 0.0)');
          mCtx.fillStyle = halo;
          mCtx.fillRect(0, 0, 256, 256);

          mCtx.fillStyle = 'rgba(160, 178, 202, 0.22)';
          mCtx.beginPath(); mCtx.arc(118, 118, 10, 0, Math.PI * 2); mCtx.fill();
          mCtx.beginPath(); mCtx.arc(136, 126, 8, 0, Math.PI * 2); mCtx.fill();
          mCtx.beginPath(); mCtx.arc(124, 138, 7, 0, Math.PI * 2); mCtx.fill();
        }
        const moonTex = new THREE.CanvasTexture(moonCanvas);
        const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: moonTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          fog: false,
          depthWrite: false,
        }));
        moonSprite.position.set(82, 118, -142);
        moonSprite.scale.set(42, 42, 1);
        moonSprite.renderOrder = -15;
        skyGroup.add(moonSprite);

        const cloudCanvas = document.createElement('canvas');
        cloudCanvas.width = 512;
        cloudCanvas.height = 256;
        const cCtx = cloudCanvas.getContext('2d');
        if (cCtx) {
          cCtx.clearRect(0, 0, 512, 256);
          const blobs = [
            [150, 138, 95, 58, 0.42],
            [230, 118, 120, 72, 0.54],
            [315, 132, 105, 62, 0.46],
            [375, 146, 80, 48, 0.34],
            [195, 148, 95, 52, 0.38],
          ];
          blobs.forEach(([bx, by, rx, ry, a]) => {
            cCtx.save();
            cCtx.translate(bx, by);
            cCtx.scale(1.0, ry / rx);
            const g = cCtx.createRadialGradient(0, -rx * 0.2, rx * 0.08, 0, 0, rx);
            g.addColorStop(0.0, 'rgba(64, 88, 122, ' + a + ')');
            g.addColorStop(0.52, 'rgba(26, 40, 62, ' + (a * 0.68).toFixed(3) + ')');
            g.addColorStop(1.0, 'rgba(10, 18, 30, 0.0)');
            cCtx.fillStyle = g;
            cCtx.beginPath();
            cCtx.arc(0, 0, rx, 0, Math.PI * 2);
            cCtx.fill();
            cCtx.restore();
          });
        }
        const softCloudTex = new THREE.CanvasTexture(cloudCanvas);
        softCloudTex.colorSpace = THREE.SRGBColorSpace || 'srgb';
        if ('encoding' in softCloudTex && THREE.sRGBEncoding) softCloudTex.encoding = THREE.sRGBEncoding;

        const cloudPlaneGeo = new THREE.PlaneGeometry(110, 56);
        cloudPlaneGeo.rotateX(Math.PI / 2);

        for (let i = 0; i < 18; i++) {
          const angle = (i / 18) * Math.PI * 2 + (i % 3) * 0.22;
          const dist = 45 + (i % 4) * 38;
          const cx = Math.cos(angle) * dist;
          const cz = Math.sin(angle) * dist;
          const cy = 68 + (i % 3) * 14;
          const cMat = new THREE.MeshBasicMaterial({
            map: softCloudTex,
            transparent: true,
            opacity: 0.34 + (i % 3) * 0.06,
            depthWrite: false,
            fog: false,
            side: THREE.DoubleSide,
          });
          const cMesh = new THREE.Mesh(cloudPlaneGeo, cMat);
          cMesh.position.set(cx, cy, cz);
          cMesh.rotation.y = (i * 0.7) % (Math.PI * 2);
          const sc = 0.85 + (i % 4) * 0.25;
          cMesh.scale.set(sc, 1.0, sc);
          cMesh.renderOrder = -12;
          skyGroup.add(cMesh);
          this.nightClouds.push({
            mesh: cMesh,
            baseX: cx,
            baseZ: cz,
            speedX: 0.45 + (i % 4) * 0.12,
            speedZ: 0.18 + (i % 3) * 0.08,
          });
        }

        this.scene.add(skyGroup);
      }

      updateSky(delta, timeSec) {
        if (!this.skyGroup) return;
        if (this.nightClouds && this.nightClouds.length > 0) {
          for (let i = 0; i < this.nightClouds.length; i++) {
            const nc = this.nightClouds[i];
            const dx = ((timeSec * nc.speedX) % 320) - 160;
            const dz = ((timeSec * nc.speedZ) % 320) - 160;
            nc.mesh.position.x = nc.baseX + dx * 0.25;
            nc.mesh.position.z = nc.baseZ + dz * 0.25;
          }
        }
      }

      setShadowsOnly(enabled) {`
  );

  // 12. Inject Web Edition Graphics Overhaul, Realistic Fluorescent Lighting, SSAO Post-Processing,
  //     Camera-Following 4096 Shadow Frustum, Adaptive Resolution, and Desktop Pointer Lock Controls
  const webEditionUpgradeScript = `
    // =========================================================================
    // SEMESTER LIBRARY — HIDE & SEEK WEB EDITION GRAPHICS OVERHAUL & DESKTOP CONTROLS
    // =========================================================================
    (function initWebEditionOverhaul() {
      const isDesktopPointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;

      // 1. Bridge sendToReactNative to window.parent (Web Edition Host Page)
      const origSendToRN = typeof sendToReactNative === 'function' ? sendToReactNative : null;
      sendToReactNative = function(type, payload = {}) {
        if (origSendToRN) {
          try { origSendToRN(type, payload); } catch (e) {}
        }
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ source: 'HIDE_AND_SEEK_ENGINE', type, ...payload }, '*');
          }
          if (typeof window.__onWebEditionEngineEvent === 'function') {
            window.__onWebEditionEngineEvent({ type, ...payload });
          }
        } catch (e) {}
      };

      // 2. Hide Mobile Touch Controls on Desktop Browsers (preserve on touch screens)
      const joyZoneEl = document.getElementById('joystick-zone');
      const actClusterEl = document.getElementById('action-cluster');
      const campusBannerEl = document.getElementById('campus-banner');
      if (isDesktopPointer) {
        if (joyZoneEl) joyZoneEl.style.display = 'none';
        if (actClusterEl) actClusterEl.style.display = 'none';
        if (campusBannerEl) campusBannerEl.style.display = 'none';
      }

      // 3. Desktop Pointer Lock Mouse Look + Shift Sprint + Sensitivity Control
      let webMouseSensitivity = 1.0;
      let webPointerLocked = false;
      const canvasEl = document.getElementById('game-canvas');

      function updatePointerLockState() {
        webPointerLocked = !!(document.pointerLockElement && document.pointerLockElement === canvasEl);
        sendToReactNative('POINTER_LOCK_CHANGED', { locked: webPointerLocked });
      }
      document.addEventListener('pointerlockchange', updatePointerLockState);
      document.addEventListener('pointerlockerror', () => {
        sendToReactNative('POINTER_LOCK_ERROR', { locked: false });
      });

      if (canvasEl) {
        canvasEl.addEventListener('click', (e) => {
          if (isControlElement(e.target)) return;
          soundEngine.resume();
          if (isDesktopPointer && !document.pointerLockElement && canvasEl.requestPointerLock) {
            try { canvasEl.requestPointerLock(); } catch (err) {}
          }
        });
      }

      window.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === canvasEl) {
          const movX = e.movementX || 0;
          const movY = e.movementY || 0;
          const sensX = ((HORROR_CONFIG.physics && HORROR_CONFIG.physics.mouseSensitivityX) || 0.0024) * webMouseSensitivity;
          const sensY = ((HORROR_CONFIG.physics && HORROR_CONFIG.physics.mouseSensitivityY) || 0.0021) * webMouseSensitivity;
          playerPhysics.targetYaw -= movX * sensX;
          playerPhysics.targetPitch = Math.max(-1.42, Math.min(1.42, playerPhysics.targetPitch - movY * sensY));
          if (playerPhysics.isHiding && typeof playerPhysics.hideBaseYaw === 'number') {
            const maxPeek = 0.78;
            const dYaw = playerPhysics.targetYaw - playerPhysics.hideBaseYaw;
            if (dYaw > maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw + maxPeek;
            if (dYaw < -maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw - maxPeek;
          }
        }
      });

      // Hold ShiftLeft / ShiftRight to sprint smoothly on desktop
      window.addEventListener('keydown', (e) => {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          playerPhysics.isSprinting = true;
          if (playerPhysics.isCrouching) playerPhysics.isCrouching = false;
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          playerPhysics.isSprinting = false;
        }
      });

      // 4. Upgrade PBR Materials with Hardware 16x Anisotropy & High-Res 512px PMREM Specular Reflections
      const maxHwAniso = (atmosphere && atmosphere.renderer && atmosphere.renderer.capabilities && typeof atmosphere.renderer.capabilities.getMaxAnisotropy === 'function')
        ? Math.min(16, atmosphere.renderer.capabilities.getMaxAnisotropy() || 8)
        : 8;

      scene.traverse((obj) => {
        if (obj && obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (!m) return;
            ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'emissiveMap'].forEach((tKey) => {
              if (m[tKey]) {
                m[tKey].anisotropy = maxHwAniso;
              }
            });
            if (m.isMeshStandardMaterial && m.envMapIntensity !== undefined && m.envMapIntensity < 0.35) {
              m.envMapIntensity = 0.52;
            }
          });
        }
      });

      // 5. Upgrade Interior Lighting & Realistic 50Hz AC Fluorescent Tube Arrays
      //    Dedicated Rectilinear Interior Bounce & Ceiling Fill Rig that tracks the active room
      const webInteriorFillLight = new THREE.PointLight(0xeef6ff, 0.0, 14.5, 1.55);
      webInteriorFillLight.castShadow = false;
      scene.add(webInteriorFillLight);

      const webCeilingBounceLight = new THREE.PointLight(0xdbeafe, 0.0, 12.0, 1.75);
      webCeilingBounceLight.castShadow = false;
      scene.add(webCeilingBounceLight);

      // Upgrade fluorescent tube materials for realistic high-CRI phosphor diffuser glow
      if (step2Mats && step2Mats.dyingTubeMat) {
        step2Mats.dyingTubeMat.color.setHex(0xf8fbff);
        step2Mats.dyingTubeMat.emissive.setHex(0xdcf0ff);
        step2Mats.dyingTubeMat.emissiveIntensity = 1.65;
        step2Mats.dyingTubeMat.roughness = 0.14;
      }
      if (step2Mats && step2Mats.steadyDimTubeMat) {
        step2Mats.steadyDimTubeMat.color.setHex(0xf8fbff);
        step2Mats.steadyDimTubeMat.emissive.setHex(0xe0f2fe);
        step2Mats.steadyDimTubeMat.emissiveIntensity = 1.48;
        step2Mats.steadyDimTubeMat.roughness = 0.14;
      }

      // 6. Upgrade Post-Processing Shader with Screen-Space Ambient Occlusion (SSAO) + Dual-Radius Bloom + ACES Filmic
      let webSsaoEnabled = true;
      let webBloomStrength = 0.36;
      if (atmosphere && atmosphere.gradeMat && atmosphere.gradeUniforms) {
        atmosphere.gradeUniforms.uSsaoStrength = { value: 0.42 };
        atmosphere.gradeUniforms.uBloomStrength.value = webBloomStrength;
        atmosphere.gradeMat.fragmentShader = [
          'precision highp float;',
          'uniform sampler2D tDiffuse;',
          'uniform float uTime;',
          'uniform vec3 uShadowTint;',
          'uniform vec3 uHighlightTint;',
          'uniform float uSaturation;',
          'uniform float uContrast;',
          'uniform float uBlackLift;',
          'uniform float uVignette;',
          'uniform float uGrain;',
          'uniform float uEdgeDesat;',
          'uniform float uBloomStrength;',
          'uniform float uBloomThreshold;',
          'uniform float uMicroContrast;',
          'uniform float uChromaStrength;',
          'uniform float uStylized;',
          'uniform float uSsaoStrength;',
          'uniform vec2 uResolution;',
          'varying vec2 vUv;',
          '',
          'float hash12(vec2 p) {',
          '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
          '  p3 += dot(p3, p3.yzx + 33.33);',
          '  return fract((p3.x + p3.y) * p3.z);',
          '}',
          '',
          'vec3 acesFilmic(vec3 x) {',
          '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
          '}',
          '',
          'float lumaOf(vec3 c) {',
          '  return dot(c, vec3(0.299, 0.587, 0.114));',
          '}',
          '',
          'void main() {',
          '  vec2 centered = vUv - 0.5;',
          '  float edgeDistSq = dot(centered, centered) * 2.2;',
          '  vec2 texel = 1.0 / max(uResolution, vec2(320.0));',
          '',
          '  // 1. Subtle Radial Chromatic Aberration',
          '  vec2 caOffset = centered * edgeDistSq * uChromaStrength;',
          '  float cR = texture2D(tDiffuse, clamp(vUv + caOffset, 0.0, 1.0)).r;',
          '  vec3 cMid = texture2D(tDiffuse, vUv).rgb;',
          '  float cB = texture2D(tDiffuse, clamp(vUv - caOffset, 0.0, 1.0)).b;',
          '  vec3 col = vec3(cR, cMid.g, cB);',
          '  float centerLuma = lumaOf(col);',
          '',
          '  // 2. Multi-Scale 8-Tap Spiral Neighborhood for Screen-Space Cavity AO & Dual-Radius Optical Bloom',
          '  vec2 o1 = vec2(1.5, 0.5) * texel;',
          '  vec2 o2 = vec2(-0.5, 1.5) * texel;',
          '  vec2 o3 = vec2(3.5, -2.0) * texel;',
          '  vec2 o4 = vec2(-2.0, -3.5) * texel;',
          '  vec3 n1 = texture2D(tDiffuse, clamp(vUv + o1, 0.0, 1.0)).rgb;',
          '  vec3 n2 = texture2D(tDiffuse, clamp(vUv - o1, 0.0, 1.0)).rgb;',
          '  vec3 n3 = texture2D(tDiffuse, clamp(vUv + o2, 0.0, 1.0)).rgb;',
          '  vec3 n4 = texture2D(tDiffuse, clamp(vUv - o2, 0.0, 1.0)).rgb;',
          '  vec3 w1 = texture2D(tDiffuse, clamp(vUv + o3, 0.0, 1.0)).rgb;',
          '  vec3 w2 = texture2D(tDiffuse, clamp(vUv - o3, 0.0, 1.0)).rgb;',
          '  vec3 w3 = texture2D(tDiffuse, clamp(vUv + o4, 0.0, 1.0)).rgb;',
          '  vec3 w4 = texture2D(tDiffuse, clamp(vUv - o4, 0.0, 1.0)).rgb;',
          '',
          '  vec3 nearAvg = (n1 + n2 + n3 + n4) * 0.25;',
          '  vec3 wideAvg = (w1 + w2 + w3 + w4) * 0.25;',
          '  float nearLuma = lumaOf(nearAvg);',
          '  float wideLuma = lumaOf(wideAvg);',
          '',
          '  // Screen-Space Crevice & Contact Ambient Occlusion (darkens concave corners/edges where local luma dips below wider neighborhood)',
          '  float cavity = max(0.0, wideLuma - centerLuma);',
          '  float aoFactor = 1.0 - clamp(cavity * 3.2 * uSsaoStrength * (1.0 - smoothstep(0.45, 0.90, centerLuma)), 0.0, 0.34);',
          '  col *= aoFactor;',
          '',
          '  // Unsharp Midtone Clarity for PBR Normal Relief',
          '  float midMask = smoothstep(0.03, 0.16, centerLuma) * (1.0 - smoothstep(0.76, 0.98, centerLuma));',
          '  float detailDelta = clamp((centerLuma - nearLuma) * uMicroContrast * midMask, -0.05, 0.08);',
          '  col = max(vec3(0.0), col + vec3(detailDelta));',
          '',
          '  // Dual-Radius Physically Based Optical Bloom (Fluorescent Tubes, Streetlamps & Moonlit Clouds)',
          '  vec3 bAcc = vec3(0.0);',
          '  bAcc += n1 * smoothstep(uBloomThreshold, 1.25, lumaOf(n1));',
          '  bAcc += n2 * smoothstep(uBloomThreshold, 1.25, lumaOf(n2));',
          '  bAcc += n3 * smoothstep(uBloomThreshold, 1.25, lumaOf(n3));',
          '  bAcc += n4 * smoothstep(uBloomThreshold, 1.25, lumaOf(n4));',
          '  bAcc += w1 * smoothstep(uBloomThreshold, 1.20, lumaOf(w1)) * 0.85;',
          '  bAcc += w2 * smoothstep(uBloomThreshold, 1.20, lumaOf(w2)) * 0.85;',
          '  bAcc += w3 * smoothstep(uBloomThreshold, 1.20, lumaOf(w3)) * 0.85;',
          '  bAcc += w4 * smoothstep(uBloomThreshold, 1.20, lumaOf(w4)) * 0.85;',
          '  vec3 bloomCol = bAcc / 7.4;',
          '  col += bloomCol * uHighlightTint * uBloomStrength;',
          '',
          '  // 3. Natural Color Grading & Split-Tone Nocturnal Atmosphere',
          '  float luma = lumaOf(col);',
          '  float localSat = max(0.0, uSaturation * (1.0 - edgeDistSq * uEdgeDesat));',
          '  col = mix(vec3(luma), col, localSat);',
          '',
          '  float shadowWeight = pow(clamp(1.0 - luma, 0.0, 1.0), 1.65);',
          '  float highlightWeight = pow(clamp(luma, 0.0, 1.0), 1.35);',
          '  col += (uShadowTint - vec3(0.88)) * shadowWeight * 0.14;',
          '  col *= mix(vec3(1.0), uHighlightTint, highlightWeight * 0.28);',
          '',
          '  // 4. ACES Filmic Tone Curve',
          '  vec3 filmic = acesFilmic(col * 1.06);',
          '  col = mix(col, filmic, clamp((uContrast - 1.0) * 1.8 + 0.28, 0.0, 0.65));',
          '  col = col * (1.0 - uBlackLift) + vec3(uBlackLift);',
          '',
          '  // 5. Fine Sensor Grain & Ocular Vignette',
          '  float noise = (hash12(vUv * uResolution + vec2(uTime * 61.7, uTime * 37.3)) - 0.5) * 2.0;',
          '  col += noise * uGrain * (0.35 + 0.65 * (1.0 - luma));',
          '  float vig = clamp(1.0 - edgeDistSq * uVignette, 0.24, 1.0);',
          '  col *= vig;',
          '',
          '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
          '}'
        ].join('\\n');
        atmosphere.gradeMat.needsUpdate = true;
      }

      // 7. Camera-Following Texel-Snapped Directional Shadow Frustum + Adaptive Resolution & Interior Light Hook
      let adaptiveResEnabled = true;
      let currentResScale = 1.25;
      let telemetryTick = 0;

      const origRenderFrame = atmosphere.renderFrame.bind(atmosphere);
      atmosphere.renderFrame = function(timeSec) {
        // A. Camera-following texel-snapped moon directional light shadow frustum
        if (this.moonDirLight && this.moonDirLight.castShadow && camera) {
          const halfSpan = (HORROR_CONFIG.photorealisticOverhaul && HORROR_CONFIG.photorealisticOverhaul.dynamicShadowFrustumHalfSize) || 38.0;
          const mapW = (this.moonDirLight.shadow && this.moonDirLight.shadow.mapSize && this.moonDirLight.shadow.mapSize.width) || 2048;
          const texelWorld = (halfSpan * 2.0) / mapW;
          const snapX = Math.round(camera.position.x / texelWorld) * texelWorld;
          const snapZ = Math.round(camera.position.z / texelWorld) * texelWorld;
          this.moonDirLight.position.set(snapX - 38.0, 68.0, snapZ - 44.0);
          if (!this.moonDirLight.target.parent) {
            this.scene.add(this.moonDirLight.target);
          }
          this.moonDirLight.target.position.set(snapX, 0.0, snapZ);
          this.moonDirLight.target.updateMatrixWorld();
          if (this.moonDirLight.shadow.camera) {
            this.moonDirLight.shadow.camera.left = -halfSpan;
            this.moonDirLight.shadow.camera.right = halfSpan;
            this.moonDirLight.shadow.camera.top = halfSpan;
            this.moonDirLight.shadow.camera.bottom = -halfSpan;
            this.moonDirLight.shadow.camera.updateProjectionMatrix();
          }
        }

        // B. Realistic 50Hz AC Fluorescent Interior Bounce & Fill Rig when player is inside/near a room
        if (lampFlickerMod && lampFlickerMod.indoorOverrideLight) {
          const il = lampFlickerMod.indoorOverrideLight;
          // Subtle 100Hz (2x50Hz AC mains) ballast ripple (< 2% amplitude) for realistic fluorescent glow
          const acRipple = 0.985 + 0.015 * Math.sin(timeSec * 62.83);
          webInteriorFillLight.position.set(il.x, il.y - 0.15, il.z);
          webInteriorFillLight.color.setHex(il.color || 0xe2f1ff);
          webInteriorFillLight.intensity = (il.intensity || 4.8) * 0.68 * acRipple;
          webInteriorFillLight.distance = (il.distance || 13.5) * 1.25;

          webCeilingBounceLight.position.set(il.x, Math.max(0.8, il.y - 1.85), il.z);
          webCeilingBounceLight.color.setHex(0xdbeafe);
          webCeilingBounceLight.intensity = (il.intensity || 4.8) * 0.34 * acRipple;
          webCeilingBounceLight.distance = (il.distance || 13.5) * 1.15;
        } else {
          webInteriorFillLight.intensity *= 0.85;
          webCeilingBounceLight.intensity *= 0.85;
        }

        origRenderFrame(timeSec);

        // C. Throttled Live Telemetry Broadcast (every ~0.35s) + Adaptive Resolution Scaling
        if (timeSec - telemetryTick > 0.35) {
          telemetryTick = timeSec;
          const fpsNow = Math.min(144, Math.max(1, Math.round(physicsDebug.fps || rollingAvgFps || 60)));
          const frameMsNow = Number((1000.0 / Math.max(1, fpsNow)).toFixed(2));
          const rInfo = (this.renderer && this.renderer.info && this.renderer.info.render) || {};
          const drawCalls = this.lastTotalDrawCalls || rInfo.calls || 0;
          const triangles = rInfo.triangles || 0;
          const shadowMapRes = (this.moonDirLight && this.moonDirLight.shadow && this.moonDirLight.shadow.mapSize)
            ? this.moonDirLight.shadow.mapSize.width
            : 0;

          if (adaptiveResEnabled && this.renderer) {
            const cap = (activePreset && activePreset.pixelRatioCap) || 1.35;
            const nativePR = Math.min(window.devicePixelRatio || 1, cap);
            if (fpsNow < 42 && currentResScale > 0.70) {
              currentResScale = Math.max(0.65, Number((currentResScale - 0.05).toFixed(2)));
              this.renderer.setPixelRatio(currentResScale);
              if (this.resizeGradeTarget) this.resizeGradeTarget(window.innerWidth, window.innerHeight);
            } else if (fpsNow >= 57 && currentResScale < nativePR) {
              currentResScale = Math.min(nativePR, Number((currentResScale + 0.05).toFixed(2)));
              this.renderer.setPixelRatio(currentResScale);
              if (this.resizeGradeTarget) this.resizeGradeTarget(window.innerWidth, window.innerHeight);
            } else {
              currentResScale = Number((this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : nativePR).toFixed(2));
            }
          }

          const roomEl = document.getElementById('dbg-room-info');
          const roomLabel = roomEl ? roomEl.textContent.replace(/^Room:\s*/i, '').split('|')[0].trim() : 'OUTDOORS [CAMPUS]';

          sendToReactNative('WEB_TELEMETRY', {
            fps: fpsNow,
            frameMs: frameMsNow,
            drawCalls,
            triangles,
            shadowMapSize: shadowMapRes,
            quality: currentQuality,
            resScale: currentResScale,
            ssao: webSsaoEnabled,
            room: roomLabel,
            pos: {
              x: Number(playerPhysics.pos.x.toFixed(1)),
              y: Number(playerPhysics.pos.y.toFixed(2)),
              z: Number(playerPhysics.pos.z.toFixed(1)),
            },
            flashlightOn: !!(this.flashlight && this.flashlight.intensity > 0.1),
          });
        }
      };

      // 8. Handle Extended Web Edition Commands from Host Page
      window.addEventListener('message', (e) => {
        try {
          const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          if (!data || !data.type) return;
          if (data.type === 'WEB_SET_OPTIONS') {
            if (typeof data.adaptiveRes === 'boolean') {
              adaptiveResEnabled = data.adaptiveRes;
            }
            if (typeof data.resScale === 'number' && atmosphere.renderer) {
              currentResScale = Math.max(0.5, Math.min(2.0, data.resScale));
              atmosphere.renderer.setPixelRatio(currentResScale);
              if (atmosphere.resizeGradeTarget) atmosphere.resizeGradeTarget(window.innerWidth, window.innerHeight);
            }
            if (typeof data.ssao === 'boolean' && atmosphere.gradeUniforms && atmosphere.gradeUniforms.uSsaoStrength) {
              webSsaoEnabled = data.ssao;
              atmosphere.gradeUniforms.uSsaoStrength.value = webSsaoEnabled ? 0.42 : 0.0;
            }
            if (typeof data.bloomStrength === 'number' && atmosphere.gradeUniforms && atmosphere.gradeUniforms.uBloomStrength) {
              webBloomStrength = data.bloomStrength;
              atmosphere.gradeUniforms.uBloomStrength.value = webBloomStrength;
            }
            if (typeof data.mouseSensitivity === 'number') {
              webMouseSensitivity = Math.max(0.2, Math.min(3.0, data.mouseSensitivity));
            }
            if (typeof data.flashlightIntensity === 'number' && atmosphere.flashlight) {
              atmosphere.flBaseIntensity = data.flashlightIntensity;
              atmosphere.flashlight.intensity = data.flashlightIntensity;
            }
            if (typeof data.fogDensity === 'number') {
              if (typeof exploreTools !== 'undefined') {
                exploreTools.fogFar = Math.max(30, 140 - data.fogDensity * 55);
              }
            }
          } else if (data.type === 'WEB_TELEPORT' && typeof data.coords === 'string') {
            const parts = data.coords.split(',').map(Number);
            if (parts.length >= 3 && !parts.some(isNaN)) {
              playerPhysics.pos.set(parts[0], parts[1] + 0.05, parts[2]);
              playerPhysics.vel.set(0, 0, 0);
              if (typeof parts[3] === 'number' && !isNaN(parts[3])) {
                playerPhysics.yaw = parts[3];
                playerPhysics.targetYaw = parts[3];
              }
              updateRoomAndBuildingVisibility(playerPhysics.pos, playerPhysics.yaw, activePreset);
              showToast('Teleported to ' + (data.label || ('(' + parts[0] + ', ' + parts[2] + ')')));
            }
          } else if (data.type === 'WEB_REQUEST_POINTER_LOCK') {
            if (canvasEl && canvasEl.requestPointerLock) {
              try { canvasEl.requestPointerLock(); } catch (err) {}
            }
          } else if (data.type === 'WEB_TOGGLE_DEBUG_HUD') {
            if (physicsDebug && typeof physicsDebug.toggle === 'function') {
              physicsDebug.toggle();
            }
          }
        } catch (err) {}
      });

      atmosphere.webInteriorFillLight = webInteriorFillLight;
      atmosphere.webCeilingBounceLight = webCeilingBounceLight;
      atmosphere.webFluorescentFixtures = typeof lampFlickerMod !== 'undefined' && Array.isArray(lampFlickerMod.lamps) ? lampFlickerMod.lamps : [];

      window.__WEB_EDITION__ = {
        version: '1.0.0-web-overhaul',
        setQualityPreset: (q) => {
          if (typeof applyGraphicsQuality === 'function') {
            applyGraphicsQuality(q, 'pinned');
          }
          if (atmosphere && atmosphere.moonDirLight && atmosphere.moonDirLight.shadow && activePreset) {
            const sz = activePreset.shadowMapSize || 2048;
            atmosphere.moonDirLight.shadow.mapSize.set(sz, sz);
            if (atmosphere.moonDirLight.shadow.map && atmosphere.moonDirLight.shadow.map.dispose) {
              atmosphere.moonDirLight.shadow.map.dispose();
              atmosphere.moonDirLight.shadow.map = null;
            }
          }
          if (activePreset && atmosphere && atmosphere.renderer) {
            currentResScale = Math.min(window.devicePixelRatio || 1, activePreset.pixelRatioCap || 1.35);
            atmosphere.renderer.setPixelRatio(currentResScale);
          }
        },
        getTelemetry: () => {
          const rInfo = (atmosphere.renderer && atmosphere.renderer.info && atmosphere.renderer.info.render) || {};
          return {
            fps: Math.round(physicsDebug.fps || 60),
            preset: currentQuality,
            quality: currentQuality,
            drawCalls: atmosphere.lastTotalDrawCalls || rInfo.calls || 0,
            triangles: rInfo.triangles || 0,
            resScale: currentResScale,
            ssao: webSsaoEnabled,
            shadowMapSize: (atmosphere.moonDirLight && atmosphere.moonDirLight.shadow) ? atmosphere.moonDirLight.shadow.mapSize.width : 0,
            anisotropy: maxHwAniso,
            pointerLocked: webPointerLocked,
            pos: { x: playerPhysics.pos.x, y: playerPhysics.pos.y, z: playerPhysics.pos.z },
          };
        },
        teleport: (x, y, z, yaw = 0) => {
          playerPhysics.pos.set(x, y + 0.05, z);
          playerPhysics.vel.set(0, 0, 0);
          playerPhysics.yaw = yaw;
          playerPhysics.targetYaw = yaw;
          updateRoomAndBuildingVisibility(playerPhysics.pos, playerPhysics.yaw, activePreset);
        },
      };
    })();
  </script>`;

  // Evaluate the template literal inside gameHtml.ts with our authoritative configJson & threeMinJs
  const templateStart = src.indexOf('return `<!DOCTYPE html>');
  const templateEnd = src.lastIndexOf('`;');
  if (templateStart === -1 || templateEnd === -1) {
    throw new Error('[WebEngineCompiler] Could not extract HTML template literal from gameHtml.ts');
  }
  const templateBody = src.slice(templateStart + 'return `'.length, templateEnd);
  const configJson = JSON.stringify(config);

  const loadOptionalStringExport = (filename) => {
    const p = path.join(MOBILE_HS_DIR, filename);
    if (!fs.existsSync(p)) return '';
    const raw = fs.readFileSync(p, 'utf8');
    const q1 = raw.indexOf("'");
    const q2 = raw.lastIndexOf("'");
    const b1 = raw.indexOf('`');
    const b2 = raw.lastIndexOf('`');
    if (b1 !== -1 && b2 > b1) return raw.slice(b1 + 1, b2);
    if (q1 !== -1 && q2 > q1) return raw.slice(q1 + 1, q2);
    return '';
  };

  const gltfLoaderJs = loadOptionalStringExport('gltfLoaderR128.ts');
  const libraryGlbUri = loadOptionalStringExport('libraryGlbBase64.ts');
  const unifiedSkyDomeB64 = loadOptionalStringExport('unifiedSkyDomeBase64.ts');

  const buildFn = new Function(
    'THREE_MIN_JS',
    'GLTF_LOADER_R128_JS',
    'LIBRARY_GLB_DATA_URI',
    'UNIFIED_SKY_DOME_BASE64',
    'configJson',
    'HORROR_CONFIG',
    `return \`${templateBody}\`;`
  );
  let compiledHtml = buildFn(threeMinJs, gltfLoaderJs, libraryGlbUri, unifiedSkyDomeB64, configJson, config);
  compiledHtml = replaceExact(
    compiledHtml,
    'inject Web Edition Upgrade Script',
    '  </script>\n</body>\n</html>',
    webEditionUpgradeScript + '\n</body>\n</html>'
  );
  cachedEngineHtml = compiledHtml;
  return cachedEngineHtml;
}

function getWebEditionMetadata() {
  if (cachedMetadata) return cachedMetadata;
  const config = loadAuthoritativeWebConfig();
  const objects = (config.campusLayout && Array.isArray(config.campusLayout.objects)) ? config.campusLayout.objects : [];
  const counts = {};
  for (const obj of objects) {
    counts[obj.type] = (counts[obj.type] || 0) + 1;
  }
  cachedMetadata = {
    edition: 'Semester Library — Hide & Seek Web Edition',
    version: '1.0.0-web-overhaul',
    mapVersion: (config.campusLayout && config.campusLayout.version) || '1.2.0',
    terrainSize: (config.campusLayout && config.campusLayout.terrain && config.campusLayout.terrain.size) || 320,
    terrainSegments: (config.campusLayout && config.campusLayout.terrain && config.campusLayout.terrain.segments) || 128,
    totalObjects: objects.length,
    objectCounts: counts,
    enterableRooms: 32,
    enterableBuses: ['Bus A (GP62 • ग १ ख ९४९१)', 'Bus B (GP64 • ग १ ख ७२६२)'],
    graphicsPresets: Object.keys(config.qualityPresets).map((k) => ({
      id: k,
      label: config.qualityPresets[k].label,
      shadowMapSize: config.qualityPresets[k].shadowMapSize,
      pixelRatioCap: config.qualityPresets[k].pixelRatioCap,
      maxActiveLampLights: config.qualityPresets[k].maxActiveLampLights,
    })),
  };
  return cachedMetadata;
}

module.exports = {
  loadAuthoritativeWebConfig,
  buildWebEditionEngineHtml,
  getWebEditionMetadata,
};
