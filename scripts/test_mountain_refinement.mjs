import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { HIMALAYA_PANORAMA_BASE64 } from '../mobile/components/games/hide-and-seek/himalayaPanoramaBase64.ts';

const mainRepoPath = '/Users/sauu_gat/semester-library';
const gameHtmlPath = path.resolve(mainRepoPath, 'mobile/components/games/hide-and-seek/gameHtml.ts');
const horrorConfigPath = path.resolve(mainRepoPath, 'mobile/components/games/hide-and-seek/horrorConfig.ts');

const file = fs.readFileSync(gameHtmlPath, 'utf8');
const horrorConfigFile = fs.readFileSync(horrorConfigPath, 'utf8');

const marker = 'export const HORROR_CONFIG = ';
const configStart = horrorConfigFile.indexOf(marker) + marker.length;
let rawConfig = horrorConfigFile.slice(configStart).trim().replace(/;$/, '');
rawConfig = rawConfig.replace(/as\s+Record<[^>]+>/g, '');
const HORROR_CONFIG = eval('(' + rawConfig + ')');
const configJson = JSON.stringify(HORROR_CONFIG);

const start = file.indexOf("return `");
const end = file.lastIndexOf("`;") + 2;
const fnBody = file.slice(start, end);
const fn = new Function("THREE_MIN_JS", "configJson", fnBody);
let html = fn(THREE_MIN_JS, configJson);

// Production-Grade Himalayan Range & Pokhara Valley Engine
const newSkyImplementation = `
      buildCloudyMoonlitSkyDome() {
        if (this.skyGroup) {
          this.scene.remove(this.skyGroup);
        }
        this.skyGroup = new THREE.Group();
        this.skyGroup.name = 'NightHorrorSkyAndSilhouettes';

        // ---------------------------------------------------------------------
        // 1. HIGH-DEFINITION CELESTIAL SKY DOME & THE GREAT HIMALAYAN MILKY WAY
        // ---------------------------------------------------------------------
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 1024;
        skyCanvas.height = 512;
        const sCtx = skyCanvas.getContext('2d');

        // Atmospheric nocturnal palette matching Pokhara reference images:
        // Deep cosmic violet/indigo celestial vault grading into twilight purple over mountains
        const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
        skyGrad.addColorStop(0.00, '#04020a'); // Zenith cosmic black-violet
        skyGrad.addColorStop(0.20, '#090514'); // Deep nocturnal purple-sapphire
        skyGrad.addColorStop(0.48, '#120c24'); // High Himalayan atmospheric navy-indigo
        skyGrad.addColorStop(0.72, '#201438'); // Mountain ridgeline atmospheric violet
        skyGrad.addColorStop(0.88, '#2e1a46'); // Valley inversion twilight purple
        skyGrad.addColorStop(0.96, '#0b1220'); // Ground fog blend
        skyGrad.addColorStop(1.00, '#070a12');
        sCtx.fillStyle = skyGrad;
        sCtx.fillRect(0, 0, 1024, 512);

        // The Great Himalayan Milky Way Arch
        sCtx.save();
        const mwSpline = [
          { x: 160, y: 360, w: 90,  a: 0.22 },
          { x: 300, y: 240, w: 125, a: 0.32 },
          { x: 480, y: 140, w: 155, a: 0.42 },
          { x: 680, y: 125, w: 140, a: 0.36 },
          { x: 860, y: 220, w: 110, a: 0.26 },
        ];

        // 1A. Outer celestial nebula glow
        mwSpline.forEach(pt => {
          const rgViolet = sCtx.createRadialGradient(pt.x, pt.y, 10, pt.x, pt.y, pt.w * 1.6);
          rgViolet.addColorStop(0.00, 'rgba(88, 58, 146, ' + (pt.a * 0.75).toFixed(3) + ')');
          rgViolet.addColorStop(0.40, 'rgba(46, 78, 152, ' + (pt.a * 0.45).toFixed(3) + ')');
          rgViolet.addColorStop(0.75, 'rgba(22, 42, 92, ' + (pt.a * 0.18).toFixed(3) + ')');
          rgViolet.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
          sCtx.fillStyle = rgViolet;
          sCtx.beginPath();
          sCtx.arc(pt.x, pt.y, pt.w * 1.6, 0, Math.PI * 2);
          sCtx.fill();
        });

        // 1B. Luminous core star clouds
        mwSpline.forEach(pt => {
          const rgCore = sCtx.createRadialGradient(pt.x + 3, pt.y - 2, 4, pt.x, pt.y, pt.w * 0.85);
          rgCore.addColorStop(0.00, 'rgba(235, 242, 255, ' + (pt.a * 0.90).toFixed(3) + ')');
          rgCore.addColorStop(0.32, 'rgba(180, 215, 255, ' + (pt.a * 0.62).toFixed(3) + ')');
          rgCore.addColorStop(0.68, 'rgba(96, 146, 210, ' + (pt.a * 0.28).toFixed(3) + ')');
          rgCore.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
          sCtx.fillStyle = rgCore;
          sCtx.beginPath();
          sCtx.arc(pt.x, pt.y, pt.w * 0.85, 0, Math.PI * 2);
          sCtx.fill();
        });

        // 1C. Organic dust mottling
        for (let d = 0; d < 22; d++) {
          const t = d / 22;
          const gx = 220 + t * 580 + Math.sin(d * 3.7) * 24;
          const gy = 300 - Math.sin(t * Math.PI) * 190 + Math.cos(d * 4.1) * 18;
          const gw = 18 + (d % 4) * 8;
          const dGrad = sCtx.createRadialGradient(gx, gy, 2, gx, gy, gw);
          dGrad.addColorStop(0.0, 'rgba(4, 3, 12, 0.28)');
          dGrad.addColorStop(0.7, 'rgba(6, 4, 18, 0.12)');
          dGrad.addColorStop(1.0, 'rgba(11, 18, 32, 0.0)');
          sCtx.fillStyle = dGrad;
          sCtx.beginPath();
          sCtx.arc(gx, gy, gw, 0, Math.PI * 2);
          sCtx.fill();
        }

        // 1D. Micro-Star Clusters
        for (let ms = 0; ms < 900; ms++) {
          const t = ms / 900;
          const baseX = 160 + t * 700;
          const baseY = 360 - Math.sin(t * Math.PI) * 240;
          const spread = (Math.sin(t * Math.PI) * 55 + 18) * (Math.sin(ms * 12.3) * 0.5 + 0.5);
          const ang = Math.sin(ms * 33.7) * Math.PI * 2;
          const sx = baseX + Math.cos(ang) * spread;
          const sy = baseY + Math.sin(ang) * (spread * 0.65);
          const sa = (0.28 + (ms % 7) * 0.10) * Math.min(1.0, Math.max(0.0, 1.0 - sy / 460));
          const sr = (ms % 23 === 0) ? 1.3 : ((ms % 7 === 0) ? 0.95 : 0.60);
          sCtx.fillStyle = (ms % 5 === 0) ? ('rgba(255, 230, 195, ' + sa.toFixed(2) + ')') : ('rgba(225, 240, 255, ' + sa.toFixed(2) + ')');
          sCtx.fillRect(sx, sy, sr, sr);
        }

        // 1E. Pleiades Cluster
        const plx = 640, ply = 145;
        const plNeb = sCtx.createRadialGradient(plx, ply, 3, plx, ply, 34);
        plNeb.addColorStop(0.00, 'rgba(150, 200, 255, 0.38)');
        plNeb.addColorStop(0.55, 'rgba(80, 130, 220, 0.16)');
        plNeb.addColorStop(1.00, 'rgba(10, 20, 35, 0)');
        sCtx.fillStyle = plNeb;
        sCtx.beginPath();
        sCtx.arc(plx, ply, 34, 0, Math.PI * 2);
        sCtx.fill();

        [
          [0, 0, 1.4], [-6, -4, 1.2], [5, -5, 1.1], [-4, 6, 1.2],
          [7, 3, 1.0], [12, -2, 0.9], [-11, 2, 0.9]
        ].forEach(([ox, oy, sz]) => {
          sCtx.fillStyle = 'rgba(235, 246, 255, 0.95)';
          sCtx.beginPath();
          sCtx.arc(plx + ox, ply + oy, sz, 0, Math.PI * 2);
          sCtx.fill();
        });

        sCtx.restore();

        const skyTex = new THREE.CanvasTexture(skyCanvas);
        if (THREE.SRGBColorSpace) skyTex.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding) skyTex.encoding = THREE.sRGBEncoding;

        const skySphere = new THREE.Mesh(
          new THREE.SphereGeometry(180, 36, 24),
          new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.BackSide,
            fog: false,
            depthWrite: false
          })
        );
        skySphere.renderOrder = -12;
        this.skyGroup.add(skySphere);

        // ---------------------------------------------------------------------
        // 2. HIGH-PRECISION 3D CELESTIAL STARFIELD (Immune to UV distortion!)
        // ---------------------------------------------------------------------
        const starCount = 1200;
        const starGeom = new THREE.BufferGeometry();
        const starPositions = new Float32Array(starCount * 3);
        const starColors = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);
        const starPhases = new Float32Array(starCount);

        const R_STAR = 176.0;
        let sIdx = 0;

        // 2A. Real Himalayan Constellations
        const constellations = [
          { name: 'Betelgeuse', theta: 1.85, phi: 0.72, color: [1.0, 0.68, 0.45], size: 4.2 },
          { name: 'Rigel',      theta: 1.98, phi: 0.94, color: [0.75, 0.88, 1.0],  size: 4.0 },
          { name: 'Bellatrix',  theta: 1.78, phi: 0.76, color: [0.85, 0.92, 1.0],  size: 3.2 },
          { name: 'Saiph',      theta: 2.02, phi: 0.91, color: [0.82, 0.90, 1.0],  size: 3.0 },
          { name: 'Alnitak',    theta: 1.91, phi: 0.83, color: [0.90, 0.95, 1.0],  size: 3.4 },
          { name: 'Alnilam',    theta: 1.89, phi: 0.84, color: [0.92, 0.96, 1.0],  size: 3.5 },
          { name: 'Mintaka',    theta: 1.87, phi: 0.85, color: [0.90, 0.95, 1.0],  size: 3.3 },

          // Ursa Major (Saptarishi / Big Dipper)
          { name: 'Dubhe',      theta: -0.85, phi: 0.52, color: [1.0, 0.88, 0.65], size: 3.6 },
          { name: 'Merak',      theta: -0.82, phi: 0.58, color: [0.92, 0.95, 1.0], size: 3.4 },
          { name: 'Phecda',     theta: -0.92, phi: 0.62, color: [0.92, 0.95, 1.0], size: 3.2 },
          { name: 'Megrez',     theta: -0.96, phi: 0.56, color: [0.90, 0.94, 1.0], size: 2.8 },
          { name: 'Alioth',     theta: -1.06, phi: 0.53, color: [0.92, 0.95, 1.0], size: 3.6 },
          { name: 'Mizar',      theta: -1.14, phi: 0.49, color: [0.92, 0.95, 1.0], size: 3.5 },
          { name: 'Alkaid',     theta: -1.24, phi: 0.44, color: [0.80, 0.88, 1.0], size: 3.6 },

          // Polaris (North Star / Dhruva Tara)
          { name: 'Polaris',    theta: -0.84, phi: 0.35, color: [1.0, 0.96, 0.88], size: 3.8 },

          // Cassiopeia
          { name: 'Schedar',    theta: 0.35, phi: 0.42, color: [1.0, 0.85, 0.60], size: 3.5 },
          { name: 'Caph',       theta: 0.28, phi: 0.45, color: [0.95, 0.96, 1.0], size: 3.2 },
          { name: 'Gamma Cas',  theta: 0.41, phi: 0.38, color: [0.85, 0.92, 1.0], size: 3.4 },
          { name: 'Ruchbah',    theta: 0.48, phi: 0.41, color: [0.92, 0.95, 1.0], size: 3.1 },
          { name: 'Segin',      theta: 0.55, phi: 0.37, color: [0.88, 0.92, 1.0], size: 2.9 },

          // Sirius (Canis Major - Brightest star)
          { name: 'Sirius',     theta: 2.15, phi: 1.05, color: [0.85, 0.94, 1.0],  size: 5.2 },
          { name: 'Vega',       theta: -1.65, phi: 0.48, color: [0.88, 0.94, 1.0], size: 4.5 },
          { name: 'Altair',     theta: -1.85, phi: 0.68, color: [0.95, 0.96, 1.0], size: 3.8 },
        ];

        constellations.forEach(st => {
          if (sIdx < starCount) {
            const spX = R_STAR * Math.sin(st.phi) * Math.cos(st.theta);
            const spY = R_STAR * Math.cos(st.phi);
            const spZ = R_STAR * Math.sin(st.phi) * Math.sin(st.theta);
            starPositions[sIdx * 3 + 0] = spX;
            starPositions[sIdx * 3 + 1] = spY;
            starPositions[sIdx * 3 + 2] = spZ;
            starColors[sIdx * 3 + 0] = st.color[0];
            starColors[sIdx * 3 + 1] = st.color[1];
            starColors[sIdx * 3 + 2] = st.color[2];
            starSizes[sIdx] = st.size;
            starPhases[sIdx] = sIdx * 1.73;
            sIdx++;
          }
        });

        // 2B. Natural Himalayan Autumn Star Field
        while (sIdx < starCount) {
          const h1 = Math.sin(sIdx * 127.1 + 311.7) * 43758.5453;
          const h2 = Math.sin(sIdx * 269.5 + 183.3) * 43758.5453;
          const u = h1 - Math.floor(h1);
          const v = h2 - Math.floor(h2);

          const theta = u * Math.PI * 2.0 - Math.PI;
          const phi = Math.pow(v, 1.45) * 1.25 + 0.10;

          const spX = R_STAR * Math.sin(phi) * Math.cos(theta);
          const spY = R_STAR * Math.cos(phi);
          const spZ = R_STAR * Math.sin(phi) * Math.sin(theta);

          starPositions[sIdx * 3 + 0] = spX;
          starPositions[sIdx * 3 + 1] = spY;
          starPositions[sIdx * 3 + 2] = spZ;

          const tempType = sIdx % 10;
          let r = 0.92, g = 0.95, b = 1.0;
          let sz = 1.2 + (sIdx % 5) * 0.35;
          if (tempType === 0 || tempType === 1) {
            r = 0.78; g = 0.88; b = 1.00; sz *= 1.15;
          } else if (tempType === 2) {
            r = 1.00; g = 0.92; b = 0.72; sz *= 1.25;
          } else if (tempType === 3) {
            r = 1.00; g = 0.74; b = 0.50; sz *= 1.35;
          } else {
            r = 0.96; g = 0.98; b = 1.00;
          }

          starColors[sIdx * 3 + 0] = r;
          starColors[sIdx * 3 + 1] = g;
          starColors[sIdx * 3 + 2] = b;
          starSizes[sIdx] = sz;
          starPhases[sIdx] = sIdx * 2.37;
          sIdx++;
        }

        starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
        starGeom.setAttribute('aStarSize', new THREE.BufferAttribute(starSizes, 1));
        starGeom.setAttribute('aStarPhase', new THREE.BufferAttribute(starPhases, 1));

        // Soft Circular Star Texture
        const starCanvas = document.createElement('canvas');
        starCanvas.width = 64;
        starCanvas.height = 64;
        const starCtx = starCanvas.getContext('2d');
        if (starCtx) {
          const sGrad = starCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
          sGrad.addColorStop(0.00, 'rgba(255, 255, 255, 1.0)');
          sGrad.addColorStop(0.18, 'rgba(240, 248, 255, 0.85)');
          sGrad.addColorStop(0.45, 'rgba(180, 215, 255, 0.32)');
          sGrad.addColorStop(0.80, 'rgba(120, 175, 245, 0.08)');
          sGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.0)');
          starCtx.fillStyle = sGrad;
          starCtx.fillRect(0, 0, 64, 64);

          starCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          starCtx.lineWidth = 1.0;
          starCtx.beginPath();
          starCtx.moveTo(32, 8); starCtx.lineTo(32, 56);
          starCtx.moveTo(8, 32); starCtx.lineTo(56, 32);
          starCtx.stroke();
        }
        const starTexture = new THREE.CanvasTexture(starCanvas);

        const starMaterial = new THREE.PointsMaterial({
          map: starTexture,
          size: 2.2,
          vertexColors: true,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        });

        const skyUniforms = {
          uSkyTime: { value: 0.0 }
        };
        this._skyUniforms = skyUniforms;

        starMaterial.onBeforeCompile = function(shader) {
          shader.uniforms.uSkyTime = skyUniforms.uSkyTime;
          shader.vertexShader = 'attribute float aStarSize;\\nattribute float aStarPhase;\\nuniform float uSkyTime;\\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            'gl_PointSize = size;',
            'float tw = sin(uSkyTime * 2.8 + aStarPhase) * 0.35 + 0.65;\\ngl_PointSize = aStarSize * tw * (180.0 / -mvPosition.z);'
          );
        };

        const starPoints = new THREE.Points(starGeom, starMaterial);
        starPoints.renderOrder = -11;
        this.skyGroup.add(starPoints);

        // ---------------------------------------------------------------------
        // 3. AUTHENTIC HIMALAYAN HORIZON & POKHARA VALLEY SEA OF LIGHTS
        // Derived directly from real photographs of Machapuchare and Pokhara
        // ---------------------------------------------------------------------
        const panoImg = new Image();
        const panoTex = new THREE.Texture(panoImg);
        panoTex.wrapS = THREE.RepeatWrapping;
        panoTex.wrapT = THREE.ClampToEdgeWrapping;
        if (THREE.SRGBColorSpace) panoTex.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding) panoTex.encoding = THREE.sRGBEncoding;

        panoImg.onload = function() {
          panoTex.needsUpdate = true;
        };
        panoImg.src = window.__HIMALAYA_PANORAMA_BASE64__;

        const panoGeo = new THREE.CylinderGeometry(166, 166, 118, 128, 1, true);
        const panoMat = new THREE.MeshBasicMaterial({
          map: panoTex,
          side: THREE.BackSide,
          transparent: true,
          fog: false,
          depthWrite: false
        });

        const panoMesh = new THREE.Mesh(panoGeo, panoMat);
        panoMesh.position.y = 30.0;
        // Rotates texture center (Machapuchare) to North-North-East (~15 deg East of North)
        panoMesh.rotation.y = Math.PI - 0.22;
        panoMesh.renderOrder = -9;
        this.skyGroup.add(panoMesh);

        // 3B. Dynamic 3D Twinkle Layer for Pokhara Valley City Lights
        const cityLightCount = 1200;
        const cityGeom = new THREE.BufferGeometry();
        const cityPositions = new Float32Array(cityLightCount * 3);
        const cityColors = new Float32Array(cityLightCount * 3);
        const citySizes = new Float32Array(cityLightCount);

        let clIdx = 0;
        for (let c = 0; c < cityLightCount; c++) {
          const h1 = Math.sin(c * 17.3 + 43.1) * 43758.5453;
          const u = h1 - Math.floor(h1);
          const v = Math.sin(c * 29.7 + 91.3) * 0.5 + 0.5;

          const ang = (Math.PI - 1.25) + u * 2.50;
          const dist = 142.0 + v * 22.0;
          const y = -4.0 + Math.pow(v, 1.4) * 14.0 + Math.sin(c * 7.1) * 2.0;

          cityPositions[clIdx * 3 + 0] = Math.sin(ang) * dist;
          cityPositions[clIdx * 3 + 1] = y;
          cityPositions[clIdx * 3 + 2] = Math.cos(ang) * dist;

          const lType = c % 12;
          let r = 1.0, g = 0.75, b = 0.35, sz = 1.8;
          if (lType === 0) {
            r = 0.94; g = 0.97; b = 1.00; sz = 2.2;
          } else if (lType === 1 || lType === 2) {
            r = 1.00; g = 0.82; b = 0.40; sz = 2.0;
          } else if (lType === 3) {
            r = 1.00; g = 0.50; b = 0.20; sz = 1.7;
          } else {
            r = 1.00; g = 0.70; b = 0.30; sz = 1.4;
          }

          cityColors[clIdx * 3 + 0] = r;
          cityColors[clIdx * 3 + 1] = g;
          cityColors[clIdx * 3 + 2] = b;
          citySizes[clIdx] = sz;
          clIdx++;
        }

        cityGeom.setAttribute('position', new THREE.BufferAttribute(cityPositions, 3));
        cityGeom.setAttribute('color', new THREE.BufferAttribute(cityColors, 3));
        cityGeom.setAttribute('size', new THREE.BufferAttribute(citySizes, 1));

        const cityLightCanvas = document.createElement('canvas');
        cityLightCanvas.width = 32;
        cityLightCanvas.height = 32;
        const clCtx = cityLightCanvas.getContext('2d');
        if (clCtx) {
          const clGrad = clCtx.createRadialGradient(16, 16, 1, 16, 16, 15);
          clGrad.addColorStop(0.00, 'rgba(255, 255, 255, 1.0)');
          clGrad.addColorStop(0.35, 'rgba(255, 210, 140, 0.85)');
          clGrad.addColorStop(0.70, 'rgba(255, 140, 40, 0.25)');
          clGrad.addColorStop(1.00, 'rgba(200, 80, 10, 0.0)');
          clCtx.fillStyle = clGrad;
          clCtx.fillRect(0, 0, 32, 32);
        }
        const cityLightTex = new THREE.CanvasTexture(cityLightCanvas);

        const cityLightMat = new THREE.PointsMaterial({
          map: cityLightTex,
          size: 2.2,
          vertexColors: true,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        });

        const cityPoints = new THREE.Points(cityGeom, cityLightMat);
        cityPoints.renderOrder = -8;
        this.skyGroup.add(cityPoints);

        // ---------------------------------------------------------------------
        // 4. MAJESTIC AUTUMN MOON (HIGH-DEFINITION CRATER SURFACE & OPTICAL HALO)
        // ---------------------------------------------------------------------
        const moonPos = new THREE.Vector3(-48, 88, -118);

        // 4A. High-Definition Procedural Lunar Disc Texture (512x512)
        const moonCanvas = document.createElement('canvas');
        moonCanvas.width = 512;
        moonCanvas.height = 512;
        const mCtx = moonCanvas.getContext('2d');
        if (mCtx) {
          const moonDisc = mCtx.createRadialGradient(242, 242, 10, 256, 256, 224);
          moonDisc.addColorStop(0.00, '#f0f6ff');
          moonDisc.addColorStop(0.55, '#d6e4f4');
          moonDisc.addColorStop(0.82, '#b2c7de');
          moonDisc.addColorStop(0.96, '#7e98b4');
          moonDisc.addColorStop(0.99, '#506880');
          moonDisc.addColorStop(1.00, 'rgba(80, 104, 128, 0.0)');
          mCtx.fillStyle = moonDisc;
          mCtx.beginPath();
          mCtx.arc(256, 256, 224, 0, Math.PI * 2);
          mCtx.fill();

          const mariaList = [
            { x: 175, y: 220, rx: 75, ry: 95, rot: 0.18, a: 0.44 },
            { x: 215, y: 155, rx: 55, ry: 48, rot: -0.12, a: 0.48 },
            { x: 300, y: 165, rx: 42, ry: 38, rot: 0.20, a: 0.45 },
            { x: 345, y: 225, rx: 48, ry: 38, rot: -0.15, a: 0.46 },
            { x: 385, y: 280, rx: 38, ry: 32, rot: 0.32, a: 0.42 },
            { x: 410, y: 185, rx: 28, ry: 24, rot: 0.08, a: 0.52 },
            { x: 340, y: 310, rx: 30, ry: 25, rot: -0.22, a: 0.40 },
            { x: 230, y: 305, rx: 42, ry: 36, rot: 0.15, a: 0.42 },
            { x: 160, y: 295, rx: 26, ry: 24, rot: -0.10, a: 0.46 },
          ];

          mariaList.forEach(m => {
            mCtx.save();
            mCtx.translate(m.x, m.y);
            mCtx.rotate(m.rot);
            mCtx.scale(1.0, m.ry / m.rx);
            const mGrad = mCtx.createRadialGradient(0, 0, 2, 0, 0, m.rx);
            mGrad.addColorStop(0.00, 'rgba(52, 68, 88, ' + m.a + ')');
            mGrad.addColorStop(0.60, 'rgba(68, 86, 108, ' + (m.a * 0.85) + ')');
            mGrad.addColorStop(0.85, 'rgba(92, 112, 136, ' + (m.a * 0.45) + ')');
            mGrad.addColorStop(1.00, 'rgba(120, 145, 175, 0.0)');
            mCtx.fillStyle = mGrad;
            mCtx.beginPath();
            mCtx.arc(0, 0, m.rx, 0, Math.PI * 2);
            mCtx.fill();
            mCtx.restore();
          });

          // Tycho Crater
          const tychoX = 265, tychoY = 390;
          mCtx.save();
          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
          mCtx.lineWidth = 1.8;
          for (let ray = 0; ray < 18; ray++) {
            const rayAng = (ray / 18) * Math.PI * 2 + 0.08;
            const rayLen = 110 + ((ray * 37) % 75);
            mCtx.beginPath();
            mCtx.moveTo(tychoX, tychoY);
            mCtx.lineTo(tychoX + Math.cos(rayAng) * rayLen, tychoY + Math.sin(rayAng) * rayLen);
            mCtx.stroke();
          }
          mCtx.fillStyle = 'rgba(255, 255, 255, 0.98)';
          mCtx.beginPath();
          mCtx.arc(tychoX, tychoY, 7.5, 0, Math.PI * 2);
          mCtx.fill();
          mCtx.restore();

          // Copernicus Crater
          const copX = 210, copY = 220;
          mCtx.save();
          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
          mCtx.lineWidth = 1.4;
          for (let ray = 0; ray < 12; ray++) {
            const rayAng = (ray / 12) * Math.PI * 2;
            const rayLen = 50 + ((ray * 23) % 40);
            mCtx.beginPath();
            mCtx.moveTo(copX, copY);
            mCtx.lineTo(copX + Math.cos(rayAng) * rayLen, copY + Math.sin(rayAng) * rayLen);
            mCtx.stroke();
          }
          mCtx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          mCtx.beginPath();
          mCtx.arc(copX, copY, 5.5, 0, Math.PI * 2);
          mCtx.fill();
          mCtx.restore();
        }
        const moonTexture = new THREE.CanvasTexture(moonCanvas);

        const moonMesh = new THREE.Mesh(
          new THREE.SphereGeometry(7.2, 32, 32),
          new THREE.MeshBasicMaterial({
            map: moonTexture,
            fog: false,
            depthWrite: false
          })
        );
        moonMesh.position.copy(moonPos);
        moonMesh.lookAt(0, 0, 0);
        moonMesh.renderOrder = -6;
        this.skyGroup.add(moonMesh);

        // 4B. Inner Corona & Lunar Glow
        const coronaCanvas = document.createElement('canvas');
        coronaCanvas.width = 128;
        coronaCanvas.height = 128;
        const cCtx = coronaCanvas.getContext('2d');
        if (cCtx) {
          const cGrad = cCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
          cGrad.addColorStop(0.00, 'rgba(255, 255, 255, 0.95)');
          cGrad.addColorStop(0.20, 'rgba(235, 245, 255, 0.55)');
          cGrad.addColorStop(0.50, 'rgba(180, 215, 255, 0.22)');
          cGrad.addColorStop(0.80, 'rgba(120, 170, 240, 0.06)');
          cGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
          cCtx.fillStyle = cGrad;
          cCtx.fillRect(0, 0, 128, 128);
        }
        const coronaTex = new THREE.CanvasTexture(coronaCanvas);
        const coronaSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: coronaTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        }));
        coronaSprite.position.copy(moonPos);
        coronaSprite.scale.set(34, 34, 1);
        coronaSprite.renderOrder = -6;
        this.skyGroup.add(coronaSprite);

        // 4C. High Himalayan Ice-Crystal Optical Halo (22-degree Lunar Halo)
        const haloCanvas = document.createElement('canvas');
        haloCanvas.width = 256;
        haloCanvas.height = 256;
        const hCtx = haloCanvas.getContext('2d');
        if (hCtx) {
          const hGrad = hCtx.createRadialGradient(128, 128, 60, 128, 128, 124);
          hGrad.addColorStop(0.00, 'rgba(180, 215, 255, 0.00)');
          hGrad.addColorStop(0.40, 'rgba(195, 225, 255, 0.03)');
          hGrad.addColorStop(0.70, 'rgba(220, 238, 255, 0.22)'); // Peak prismatic ring
          hGrad.addColorStop(0.85, 'rgba(175, 205, 250, 0.08)');
          hGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
          hCtx.fillStyle = hGrad;
          hCtx.fillRect(0, 0, 256, 256);
        }
        const haloTex = new THREE.CanvasTexture(haloCanvas);
        const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: haloTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        }));
        haloSprite.position.copy(moonPos);
        haloSprite.scale.set(78, 78, 1);
        haloSprite.renderOrder = -7;
        this.skyGroup.add(haloSprite);

        // ---------------------------------------------------------------------
        // 5. LIVING ATMOSPHERIC ELEMENTS (TIHAR SKY LANTERNS & SHOOTING STARS)
        // ---------------------------------------------------------------------
        // 5A. Drifting Tihar Sky Lanterns (Fanush)
        const lanternCanvas = document.createElement('canvas');
        lanternCanvas.width = 64;
        lanternCanvas.height = 64;
        const lCtx = lanternCanvas.getContext('2d');
        if (lCtx) {
          const lGrad = lCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
          lGrad.addColorStop(0.00, 'rgba(255, 250, 230, 1.0)');
          lGrad.addColorStop(0.25, 'rgba(255, 185, 55, 0.95)');
          lGrad.addColorStop(0.55, 'rgba(245, 110, 25, 0.65)');
          lGrad.addColorStop(0.80, 'rgba(180, 45, 10, 0.22)');
          lGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.0)');
          lCtx.fillStyle = lGrad;
          lCtx.fillRect(0, 0, 64, 64);
        }
        const lanternTex = new THREE.CanvasTexture(lanternCanvas);
        const lanternMat = new THREE.SpriteMaterial({
          map: lanternTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        });

        this.skyLanterns = [];
        for (let l = 0; l < 7; l++) {
          const lSprite = new THREE.Sprite(lanternMat);
          const lAng = 2.45 + (l * 0.26) + (Math.sin(l * 1.7) * 0.12);
          const lDist = 125.0 + (l * 6.5);
          const baseHeight = 28.0 + (l * 6.2);
          lSprite.position.set(
            Math.sin(lAng) * lDist,
            baseHeight,
            Math.cos(lAng) * lDist
          );
          lSprite.scale.set(4.2, 5.8, 1);
          lSprite.renderOrder = -4;
          this.skyGroup.add(lSprite);
          this.skyLanterns.push({
            sprite: lSprite,
            baseX: lSprite.position.x,
            baseY: baseHeight,
            baseZ: lSprite.position.z,
            speed: 0.18 + (l * 0.04),
            phase: l * 1.45,
            driftRate: 0.08 + (l * 0.02)
          });
        }

        // 5B. Dynamic Shooting Stars (Meteors)
        const meteorGeo = new THREE.BufferGeometry();
        const mPos = new Float32Array(6);
        meteorGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
        const meteorMat = new THREE.LineBasicMaterial({
          color: 0xe8f4ff,
          transparent: true,
          opacity: 0.0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          linewidth: 2,
        });
        const meteorLine = new THREE.Line(meteorGeo, meteorMat);
        meteorLine.renderOrder = -3;
        this.skyGroup.add(meteorLine);

        this.shootingStar = {
          mesh: meteorLine,
          active: false,
          progress: 0.0,
          timer: 5.0,
          startPos: new THREE.Vector3(),
          endPos: new THREE.Vector3(),
        };

        this.scene.add(this.skyGroup);
      }

      updateSky(delta, timeSec) {
        if (!this.skyGroup) return;

        // 1. Advance GPU Starfield Twinkle
        if (this._skyUniforms) {
          this._skyUniforms.uSkyTime.value = timeSec;
        }

        // 2. Animate Tihar Sky Lanterns (Drifting & Thermal Bobbing)
        if (this.skyLanterns && this.skyLanterns.length > 0) {
          for (let i = 0; i < this.skyLanterns.length; i++) {
            const sl = this.skyLanterns[i];
            const bob = Math.sin(timeSec * sl.speed + sl.phase) * 1.8;
            const sway = Math.cos(timeSec * (sl.speed * 0.7) + sl.phase) * 1.2;
            sl.sprite.position.y = sl.baseY + bob + (timeSec * sl.driftRate) % 24.0;
            sl.sprite.position.x = sl.baseX + sway;
          }
        }

        // 3. Animate High Himalayan Meteors
        if (this.shootingStar) {
          const ms = this.shootingStar;
          if (!ms.active) {
            ms.timer -= delta;
            if (ms.timer <= 0) {
              ms.active = true;
              ms.progress = 0.0;
              ms.timer = 24.0 + Math.random() * 20.0;
              const ang = Math.random() * Math.PI * 2 - Math.PI;
              const r = 168.0;
              const y1 = 95.0 + Math.random() * 45.0;
              const y2 = y1 - 22.0 - Math.random() * 18.0;
              ms.startPos.set(Math.cos(ang) * r, y1, Math.sin(ang) * r);
              ms.endPos.set(Math.cos(ang + 0.18) * r, y2, Math.sin(ang + 0.18) * r);
            }
          } else {
            ms.progress += delta * 1.85;
            if (ms.progress >= 1.0) {
              ms.active = false;
              ms.mesh.material.opacity = 0.0;
            } else {
              const curPos = ms.startPos.clone().lerp(ms.endPos, ms.progress);
              const trailPos = ms.startPos.clone().lerp(ms.endPos, Math.max(0.0, ms.progress - 0.22));
              const posAttr = ms.mesh.geometry.attributes.position;
              posAttr.setXYZ(0, curPos.x, curPos.y, curPos.z);
              posAttr.setXYZ(1, trailPos.x, trailPos.y, trailPos.z);
              posAttr.needsUpdate = true;
              const op = Math.sin(ms.progress * Math.PI);
              ms.mesh.material.opacity = op * 0.85;
            }
          }
        }
      }
`;

// Inject into HTML:
// 1. Inject HIMALAYA_PANORAMA_BASE64 into global window
const b64Inject = `window.__HIMALAYA_PANORAMA_BASE64__ = "${HIMALAYA_PANORAMA_BASE64}";\n`;
html = html.replace('<script>', `<script>\n${b64Inject}`);

// 2. Replace buildCloudyMoonlitSkyDome and updateSky
const skyMarker = 'buildCloudyMoonlitSkyDome() {';
const nextMethodMarker = 'setShadowsOnly(enabled) {';
const sIdx = html.indexOf(skyMarker);
const eIdx = html.indexOf(nextMethodMarker);

if (sIdx !== -1 && eIdx !== -1) {
  html = html.slice(0, sIdx) + newSkyImplementation.trim() + '\n\n      ' + html.slice(eIdx);
  console.log('Successfully injected authentic Himalayan mountain panorama into HTML test harness!');
} else {
  console.error('Could not find buildCloudyMoonlitSkyDome in gameHtml.ts! sIdx:', sIdx, 'eIdx:', eIdx);
}

// Write to /tmp/test_himalayas.html
fs.writeFileSync('/tmp/test_himalayas.html', html, 'utf8');

async function testMountainRefinement() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  const port = await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  console.log('Testing realistic mountain rendering at http://127.0.0.1:' + port);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}]`, msg.text());
  });
  page.on('pageerror', err => {
    console.error('[PageError]', err);
  });

  await page.goto('http://127.0.0.1:' + port);
  await page.waitForTimeout(2500);

  // Configure directly with ULTRA quality
  await page.evaluate(() => {
    window.postMessage(JSON.stringify({
      type: 'CONFIGURE',
      exploreMode: true,
      role: 'hider',
      difficulty: 'medium',
      muted: false,
      quality: 'ultra',
      pinMode: 'ultra',
      batterySaver: false,
      fearIntensity: 'medium',
      flickerReduction: false,
      screenShakeOff: false
    }), '*');
  });
  await page.waitForTimeout(1500);

  // View 1: Looking North-East up at Sacred Machapuchare (Fishtail Peak) and High Himalayas
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = -2.70;
      playerPhysics.yaw = -2.70;
      playerPhysics.targetPitch = 0.22;
      playerPhysics.pitch = 0.22;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_01_machapuchare.png' });

  // View 2: Looking West/North-West at Annapurna South & Autumn Moon
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = 0.38;
      playerPhysics.yaw = 0.38;
      playerPhysics.targetPitch = 0.28;
      playerPhysics.pitch = 0.28;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_02_moon_and_annapurna.png' });

  // View 3: Step to edge of courtyard / look at the southern Pokhara Valley lights
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      physicsDebug.teleport(-2.5, 5.0, -10.0, 3.14);
      playerPhysics.targetPitch = 0.05;
      playerPhysics.pitch = 0.05;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_03_pokhara_lights.png' });

  // View 4: Wide view across courtyard showing illuminated campus and mountains
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      physicsDebug.teleport(15.0, 1.62, 12.0, -2.50);
      playerPhysics.targetPitch = 0.15;
      playerPhysics.pitch = 0.15;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_04_campus_himalayas.png' });

  console.log('Saved all refined mountain screenshots to /tmp/refine_0*.png');
  await browser.close();
  server.close();
}

testMountainRefinement();
