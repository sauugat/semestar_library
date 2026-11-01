import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';

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

const newSkyImplementation = `buildCloudyMoonlitSkyDome() {
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

        // Deep Nocturnal Himalayan Autumn Sky Gradient (Kartik Laxmi Puja Night)
        // Perfectly seamless horizontally across u = 0 to u = 1
        const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
        skyGrad.addColorStop(0.00, '#010308'); // Cosmic zenith black-indigo
        skyGrad.addColorStop(0.22, '#030713'); // High celestial deep sapphire
        skyGrad.addColorStop(0.50, '#050f20'); // Mid-dome Himalayan nocturnal navy
        skyGrad.addColorStop(0.76, '#081425'); // Atmospheric lower vault
        skyGrad.addColorStop(0.92, '#0b1220'); // Exact match to scene fogColor (0x0b1220)
        skyGrad.addColorStop(1.00, '#070d18'); // Ground fade
        sCtx.fillStyle = skyGrad;
        sCtx.fillRect(0, 0, 1024, 512);

        // The Great Himalayan Milky Way Arch (Luminous Cosmic Gas & Dust Clouds)
        sCtx.save();
        const mwSpline = [
          { x: 160, y: 360, w: 90,  a: 0.22 },
          { x: 300, y: 240, w: 125, a: 0.32 },
          { x: 480, y: 140, w: 155, a: 0.42 },
          { x: 680, y: 125, w: 140, a: 0.36 },
          { x: 860, y: 220, w: 110, a: 0.26 },
        ];

        // 1A. Outer celestial nebula glow (deep violet & cyan-azure cosmic gas)
        mwSpline.forEach(pt => {
          const rgViolet = sCtx.createRadialGradient(pt.x, pt.y, 10, pt.x, pt.y, pt.w * 1.6);
          rgViolet.addColorStop(0.00, 'rgba(78, 54, 132, ' + (pt.a * 0.75).toFixed(3) + ')');
          rgViolet.addColorStop(0.40, 'rgba(40, 78, 142, ' + (pt.a * 0.45).toFixed(3) + ')');
          rgViolet.addColorStop(0.75, 'rgba(20, 42, 85, ' + (pt.a * 0.18).toFixed(3) + ')');
          rgViolet.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
          sCtx.fillStyle = rgViolet;
          sCtx.beginPath();
          sCtx.arc(pt.x, pt.y, pt.w * 1.6, 0, Math.PI * 2);
          sCtx.fill();
        });

        // 1B. Luminous core star clouds (dense galactic core brightness)
        mwSpline.forEach(pt => {
          const rgCore = sCtx.createRadialGradient(pt.x + 3, pt.y - 2, 4, pt.x, pt.y, pt.w * 0.85);
          rgCore.addColorStop(0.00, 'rgba(230, 240, 255, ' + (pt.a * 0.90).toFixed(3) + ')');
          rgCore.addColorStop(0.32, 'rgba(175, 212, 252, ' + (pt.a * 0.62).toFixed(3) + ')');
          rgCore.addColorStop(0.68, 'rgba(92, 142, 205, ' + (pt.a * 0.28).toFixed(3) + ')');
          rgCore.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
          sCtx.fillStyle = rgCore;
          sCtx.beginPath();
          sCtx.arc(pt.x, pt.y, pt.w * 0.85, 0, Math.PI * 2);
          sCtx.fill();
        });

        // 1C. Organic dust mottling (feathered soft cosmic dust breaks)
        for (let d = 0; d < 22; d++) {
          const t = d / 22;
          const gx = 220 + t * 580 + Math.sin(d * 3.7) * 24;
          const gy = 300 - Math.sin(t * Math.PI) * 190 + Math.cos(d * 4.1) * 18;
          const gw = 18 + (d % 4) * 8;
          const dGrad = sCtx.createRadialGradient(gx, gy, 2, gx, gy, gw);
          dGrad.addColorStop(0.0, 'rgba(3, 7, 16, 0.28)');
          dGrad.addColorStop(0.7, 'rgba(5, 12, 24, 0.12)');
          dGrad.addColorStop(1.0, 'rgba(11, 18, 32, 0.0)');
          sCtx.fillStyle = dGrad;
          sCtx.beginPath();
          sCtx.arc(gx, gy, gw, 0, Math.PI * 2);
          sCtx.fill();
        }

        // 1D. Embedded Micro-Star Clusters along the Milky Way
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

        // 1E. The Pleiades (Krittika / Seven Sisters Cluster) enveloped in azure nebulosity
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

        // 1F. Pokhara Valley Laxmi Puja Horizon Light Dome (Southern Festive Glow)
        const vGlow = sCtx.createRadialGradient(512, 495, 25, 512, 495, 340);
        vGlow.addColorStop(0.00, 'rgba(255, 154, 46, 0.28)'); // Warm golden Tihar diya ambience
        vGlow.addColorStop(0.35, 'rgba(235, 120, 28, 0.16)');
        vGlow.addColorStop(0.70, 'rgba(180, 85, 20, 0.06)');
        vGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.0)');
        sCtx.fillStyle = vGlow;
        sCtx.fillRect(180, 360, 664, 152);

        // Scattered warm festive light pinpricks across the lower Pokhara valley
        for (let vl = 0; vl < 80; vl++) {
          const vx = 260 + ((vl * 37 + 11) % 504);
          const vy = 455 + ((vl * 19 + 7) % 40);
          const va = 0.25 + (vl % 5) * 0.12;
          sCtx.fillStyle = (vl % 3 === 0) ? ('rgba(255, 186, 75, ' + va.toFixed(2) + ')') : ('rgba(255, 140, 42, ' + va.toFixed(2) + ')');
          sCtx.fillRect(vx, vy, 1.2, 1.2);
        }
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
          // Orion (The Hunter - Mrigashira)
          { name: 'Betelgeuse', theta: 1.85, phi: 0.72, color: [1.0, 0.68, 0.45], size: 4.2 },
          { name: 'Rigel',      theta: 1.98, phi: 0.94, color: [0.75, 0.88, 1.0],  size: 4.0 },
          { name: 'Bellatrix',  theta: 1.78, phi: 0.76, color: [0.85, 0.92, 1.0],  size: 3.2 },
          { name: 'Saiph',      theta: 2.02, phi: 0.91, color: [0.82, 0.90, 1.0],  size: 3.0 },
          // Orion Belt
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

          // Cassiopeia (The Queen 'W')
          { name: 'Schedar',    theta: 0.35, phi: 0.42, color: [1.0, 0.85, 0.60], size: 3.5 },
          { name: 'Caph',       theta: 0.28, phi: 0.45, color: [0.95, 0.96, 1.0], size: 3.2 },
          { name: 'Gamma Cas',  theta: 0.41, phi: 0.38, color: [0.85, 0.92, 1.0], size: 3.4 },
          { name: 'Ruchbah',    theta: 0.48, phi: 0.41, color: [0.92, 0.95, 1.0], size: 3.1 },
          { name: 'Segin',      theta: 0.55, phi: 0.37, color: [0.88, 0.92, 1.0], size: 2.9 },

          // Sirius (Canis Major - Brightest star in the sky)
          { name: 'Sirius',     theta: 2.15, phi: 1.05, color: [0.85, 0.94, 1.0],  size: 5.2 },
          // Vega & Altair
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

        // 2B. Natural Himalayan Autumn Star Field (distributed above mountain ridgelines)
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

        // Soft Circular Star Texture with Subtle 4-Point Flare
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
          fog: false,
        });

        // Atmospheric Scintillation (Twinkle Shader Injection into project_vertex)
        const skyUniforms = { uSkyTime: { value: 0.0 } };
        this._skyUniforms = skyUniforms;

        starMaterial.onBeforeCompile = (shader) => {
          shader.uniforms.uSkyTime = skyUniforms.uSkyTime;
          shader.vertexShader = 'uniform float uSkyTime;\\nattribute float aStarSize;\\nattribute float aStarPhase;\\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\\n' +
            'float tw = sin(uSkyTime * 3.6 + aStarPhase * 37.1) * 0.34 + sin(uSkyTime * 8.2 + aStarPhase * 61.3) * 0.16;\\n' +
            'gl_PointSize = aStarSize * (1.0 + tw * 0.30) * (220.0 / -mvPosition.z);\\n'
          );
        };

        const starPoints = new THREE.Points(starGeom, starMaterial);
        starPoints.renderOrder = -11;
        this.skyGroup.add(starPoints);

        // ---------------------------------------------------------------------
        // 3. MAJESTIC HIMALAYAN HORIZON WITH SACRED MACHAPUCHARE (FISHTAIL PEAK)
        // ---------------------------------------------------------------------
        const moonDirNorm = new THREE.Vector3(-38, 64, -44).normalize();

        // 3A. Range 1: High Himalayas & Machapuchare (Radius 166m, Towering Heights 58m - 92m)
        // Strictly integer harmonics across 360 degrees for zero seam
        const segCount1 = 256;
        const rGeo1 = new THREE.CylinderGeometry(166, 166, 96, segCount1, 1, true);
        const pos1 = rGeo1.attributes.position;
        const col1 = new Float32Array(pos1.count * 3);
        const fogBaseCol = new THREE.Color(0x0b1220);

        for (let i = 0; i < pos1.count; i++) {
          const vy = pos1.getY(i);
          if (vy > 0) {
            const vx = pos1.getX(i);
            const vz = pos1.getZ(i);
            const ang = Math.atan2(vx, vz); // -PI to PI

            // Base jagged Himalayan ridgeline harmonics
            let peakH =
              Math.sin(ang * 3.0) * 0.22 +
              Math.cos(ang * 7.0) * 0.14 +
              Math.sin(ang * 15.0) * 0.08 +
              Math.cos(ang * 31.0) * 0.05 +
              Math.abs(Math.sin(ang * 63.0)) * 0.035;

            // Sacred Machapuchare (Fishtail Peak, 6,993m) at bearing ~ 0.44 rad (NNE)
            const dFishtail = Math.abs(ang - 0.44);
            if (dFishtail < 0.28) {
              const u = dFishtail / 0.28;
              const fishtailPyramid = 1.0 - Math.pow(u, 1.6);
              const summitNotch = Math.abs(ang - 0.44) < 0.028 ? 0.14 : 0.0;
              peakH += fishtailPyramid * 1.05 - summitNotch;
            }

            // Annapurna South (7,219m) & Hiunchuli Massif (NW, ang ~ -0.35 rad)
            const dAnnapurna = Math.abs(ang - (-0.35));
            if (dAnnapurna < 0.38) {
              const u = dAnnapurna / 0.38;
              const annaMassif = 1.0 - Math.pow(u, 1.4);
              const crags = Math.sin(ang * 48.0) * 0.08 + Math.cos(ang * 96.0) * 0.04;
              peakH += annaMassif * 0.85 + crags;
            }

            // Lamjung Himal & Manaslu (NE, ang ~ 1.08 rad)
            const dLamjung = Math.abs(ang - 1.08);
            if (dLamjung < 0.35) {
              const u = dLamjung / 0.35;
              const lamjungRidge = 1.0 - Math.pow(u, 1.5);
              peakH += lamjungRidge * 0.68 + Math.sin(ang * 42.0) * 0.05;
            }

            // Dhaulagiri I (WNW, ang ~ -1.15 rad)
            const dDhau = Math.abs(ang - (-1.15));
            if (dDhau < 0.30) {
              const u = dDhau / 0.30;
              const dhauPyramid = 1.0 - Math.pow(u, 1.8);
              peakH += dhauPyramid * 0.75;
            }

            // Southern Valley Gap (Pokhara lake valley, ang ~ PI or -PI)
            const dSouth = Math.min(Math.abs(ang - Math.PI), Math.abs(ang - (-Math.PI)));
            if (dSouth < 0.70) {
              const valleyDip = Math.cos((dSouth / 0.70) * Math.PI * 0.5);
              peakH -= valleyDip * 0.52;
            }

            // High Himalayan heights: 48m base * factor -> Machapuchare reaches ~90m (28.5 deg)
            const finalPeakY = 48.0 * (0.85 + peakH);
            pos1.setY(i, finalPeakY);

            // Slope directional lighting against moon
            const slopeX = -Math.sin(ang);
            const slopeZ = -Math.cos(ang);
            const peakNormal = new THREE.Vector3(Math.cos(ang) * 0.65, 0.75, Math.sin(ang) * 0.65).normalize();
            const moonDot = Math.max(0.0, -slopeX * moonDirNorm.x - slopeZ * moonDirNorm.z) * 0.55 + Math.max(0.0, peakNormal.dot(moonDirNorm)) * 0.45;

            // Snowline altitude: peaks above 32m covered in glacial ice & snow
            const snowFactor = Math.min(1.0, Math.max(0.0, (finalPeakY - 30.0) / 24.0));
            const snowLit = new THREE.Color(0xdceeff);
            const snowShade = new THREE.Color(0x182c46); // Cold nocturnal blue ambient
            const rockShade = new THREE.Color(0x081322);

            const currentSnow = rockShade.clone().lerp(snowShade, snowFactor);
            const finalCol = currentSnow.lerp(snowLit, Math.pow(moonDot, 1.1) * snowFactor * 0.95);

            col1[i * 3 + 0] = finalCol.r;
            col1[i * 3 + 1] = finalCol.g;
            col1[i * 3 + 2] = finalCol.b;
          } else {
            pos1.setY(i, -6.0);
            col1[i * 3 + 0] = fogBaseCol.r;
            col1[i * 3 + 1] = fogBaseCol.g;
            col1[i * 3 + 2] = fogBaseCol.b;
          }
        }
        rGeo1.setAttribute('color', new THREE.BufferAttribute(col1, 3));
        rGeo1.computeVertexNormals();

        const rMesh1 = new THREE.Mesh(rGeo1, new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.BackSide,
          fog: false,
          depthWrite: false,
        }));
        rMesh1.position.y = 6.0;
        rMesh1.renderOrder = -9;
        this.skyGroup.add(rMesh1);

        // 3B. Range 2: Intermediate Forested Foothills (Radius 146m, Height 26m - 40m)
        const segCount2 = 128;
        const rGeo2 = new THREE.CylinderGeometry(146, 146, 48, segCount2, 1, true);
        const pos2 = rGeo2.attributes.position;
        const col2 = new Float32Array(pos2.count * 3);
        const footCol = new THREE.Color(0x06111e);

        for (let i = 0; i < pos2.count; i++) {
          const vy = pos2.getY(i);
          if (vy > 0) {
            const vx = pos2.getX(i);
            const vz = pos2.getZ(i);
            const ang = Math.atan2(vx, vz);
            const wave =
              Math.sin(ang * 6.0) * 0.30 +
              Math.cos(ang * 12.0) * 0.16 +
              Math.sin(ang * 24.0) * 0.08;
            pos2.setY(i, 20.0 * (0.75 + wave));
            col2[i * 3 + 0] = footCol.r;
            col2[i * 3 + 1] = footCol.g;
            col2[i * 3 + 2] = footCol.b;
          } else {
            pos2.setY(i, -5.0);
            col2[i * 3 + 0] = fogBaseCol.r;
            col2[i * 3 + 1] = fogBaseCol.g;
            col2[i * 3 + 2] = fogBaseCol.b;
          }
        }
        rGeo2.setAttribute('color', new THREE.BufferAttribute(col2, 3));
        const rMesh2 = new THREE.Mesh(rGeo2, new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.94,
          fog: false,
          depthWrite: false,
        }));
        rMesh2.position.y = 4.0;
        rMesh2.renderOrder = -8;
        this.skyGroup.add(rMesh2);

        // 3C. Range 3: Near Horizon Campus Boundary Hills (Radius 128m, Height 14m - 22m)
        const segCount3 = 96;
        const rGeo3 = new THREE.CylinderGeometry(128, 128, 28, segCount3, 1, true);
        const pos3 = rGeo3.attributes.position;
        const col3 = new Float32Array(pos3.count * 3);
        const nearHillCol = new THREE.Color(0x091424);

        for (let i = 0; i < pos3.count; i++) {
          const vy = pos3.getY(i);
          if (vy > 0) {
            const vx = pos3.getX(i);
            const vz = pos3.getZ(i);
            const ang = Math.atan2(vx, vz);
            const wave = Math.sin(ang * 8.0) * 0.26 + Math.cos(ang * 16.0) * 0.12;
            pos3.setY(i, 12.0 * (0.68 + wave));
            col3[i * 3 + 0] = nearHillCol.r;
            col3[i * 3 + 1] = nearHillCol.g;
            col3[i * 3 + 2] = nearHillCol.b;
          } else {
            pos3.setY(i, -4.0);
            col3[i * 3 + 0] = fogBaseCol.r;
            col3[i * 3 + 1] = fogBaseCol.g;
            col3[i * 3 + 2] = fogBaseCol.b;
          }
        }
        rGeo3.setAttribute('color', new THREE.BufferAttribute(col3, 3));
        const rMesh3 = new THREE.Mesh(rGeo3, new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.88,
          fog: false,
          depthWrite: false,
        }));
        rMesh3.position.y = 2.0;
        rMesh3.renderOrder = -7;
        this.skyGroup.add(rMesh3);

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
          // Lunar Disc Base with Physical Limb Darkening
          const moonDisc = mCtx.createRadialGradient(242, 242, 10, 256, 256, 224);
          moonDisc.addColorStop(0.00, '#f0f6ff'); // Bright highland core
          moonDisc.addColorStop(0.55, '#d6e4f4');
          moonDisc.addColorStop(0.82, '#b2c7de');
          moonDisc.addColorStop(0.96, '#7e98b4'); // Limb darkening
          moonDisc.addColorStop(0.99, '#506880');
          moonDisc.addColorStop(1.00, 'rgba(80, 104, 128, 0.0)');
          mCtx.fillStyle = moonDisc;
          mCtx.beginPath();
          mCtx.arc(256, 256, 224, 0, Math.PI * 2);
          mCtx.fill();

          // Authentic Lunar Maria (Dark Basalt Plains)
          const mariaList = [
            // Oceanus Procellarum (Ocean of Storms - vast western dark expanse)
            { x: 175, y: 220, rx: 75, ry: 95, rot: 0.18, a: 0.44 },
            // Mare Imbrium (Sea of Rains - massive circular sea in north-west)
            { x: 215, y: 155, rx: 55, ry: 48, rot: -0.12, a: 0.48 },
            // Mare Serenitatis (Sea of Serenity)
            { x: 300, y: 165, rx: 42, ry: 38, rot: 0.20, a: 0.45 },
            // Mare Tranquillitatis (Sea of Tranquility)
            { x: 345, y: 225, rx: 48, ry: 38, rot: -0.15, a: 0.46 },
            // Mare Fecunditatis
            { x: 385, y: 280, rx: 38, ry: 32, rot: 0.32, a: 0.42 },
            // Mare Crisium (Crisium Basin - distinct oval isolated sea in east)
            { x: 410, y: 185, rx: 28, ry: 24, rot: 0.08, a: 0.52 },
            // Mare Nectaris
            { x: 340, y: 310, rx: 30, ry: 25, rot: -0.22, a: 0.40 },
            // Mare Nubium
            { x: 230, y: 305, rx: 42, ry: 36, rot: 0.15, a: 0.42 },
            // Mare Humorum
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

          // Brilliant Crater Ray Systems (Tycho, Copernicus, Kepler)
          // 1. Tycho Crater (Southern Highlands)
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
          // Tycho Central Peak & Rim
          mCtx.fillStyle = 'rgba(255, 255, 255, 0.98)';
          mCtx.beginPath();
          mCtx.arc(tychoX, tychoY, 7.5, 0, Math.PI * 2);
          mCtx.fill();
          mCtx.restore();

          // 2. Copernicus Crater (Near Mare Imbrium)
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
          mCtx.arc(copX, copY, 6.0, 0, Math.PI * 2);
          mCtx.fill();
          mCtx.restore();

          // 3. Aristarchus Plateau (Brightest feature on the moon)
          mCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          mCtx.beginPath();
          mCtx.arc(155, 175, 5.0, 0, Math.PI * 2);
          mCtx.fill();

          // 4. Kepler Crater
          mCtx.fillStyle = 'rgba(255, 255, 255, 0.88)';
          mCtx.beginPath();
          mCtx.arc(175, 240, 4.0, 0, Math.PI * 2);
          mCtx.fill();
        }

        const moonTex = new THREE.CanvasTexture(moonCanvas);
        const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: moonTex,
          transparent: true,
          blending: THREE.NormalBlending,
          depthWrite: false,
          fog: false,
        }));
        moonSprite.position.copy(moonPos);
        moonSprite.scale.set(36, 36, 1);
        moonSprite.renderOrder = -5;
        this.skyGroup.add(moonSprite);

        // 4B. Inner Delicate Lunar Corona (hugs the limb without washing out craters)
        const coronaCanvas = document.createElement('canvas');
        coronaCanvas.width = 256;
        coronaCanvas.height = 256;
        const cCtx = coronaCanvas.getContext('2d');
        if (cCtx) {
          const cGrad = cCtx.createRadialGradient(128, 128, 60, 128, 128, 126);
          cGrad.addColorStop(0.00, 'rgba(235, 245, 255, 0.38)');
          cGrad.addColorStop(0.35, 'rgba(180, 215, 255, 0.16)');
          cGrad.addColorStop(0.70, 'rgba(100, 155, 230, 0.04)');
          cGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.0)');
          cCtx.fillStyle = cGrad;
          cCtx.fillRect(0, 0, 256, 256);
        }
        const coronaTex = new THREE.CanvasTexture(coronaCanvas);
        const coronaSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: coronaTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }));
        coronaSprite.position.copy(moonPos);
        coronaSprite.scale.set(58, 58, 1);
        coronaSprite.renderOrder = -6;
        this.skyGroup.add(coronaSprite);

        // 4C. Atmospheric Ice-Crystal Halo (Smooth 22° Gaussian halo with NO sharp rings)
        const haloRingCanvas = document.createElement('canvas');
        haloRingCanvas.width = 256;
        haloRingCanvas.height = 256;
        const hrCtx = haloRingCanvas.getContext('2d');
        if (hrCtx) {
          const haloGrad = hrCtx.createRadialGradient(128, 128, 30, 128, 128, 126);
          haloGrad.addColorStop(0.00, 'rgba(180, 215, 255, 0.14)');
          haloGrad.addColorStop(0.45, 'rgba(140, 185, 245, 0.08)');
          haloGrad.addColorStop(0.70, 'rgba(125, 175, 240, 0.09)'); // 22° ice peak (subtle!)
          haloGrad.addColorStop(0.85, 'rgba(95, 145, 220, 0.04)');
          haloGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.0)');
          hrCtx.fillStyle = haloGrad;
          hrCtx.fillRect(0, 0, 256, 256);
        }
        const haloRingTex = new THREE.CanvasTexture(haloRingCanvas);
        const haloRingSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: haloRingTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }));
        haloRingSprite.position.copy(moonPos);
        haloRingSprite.scale.set(130, 130, 1);
        haloRingSprite.renderOrder = -6;
        this.skyGroup.add(haloRingSprite);

        // ---------------------------------------------------------------------
        // 5. ANIMATED LIVING SKY DYNAMICS: TIHAR SKY LANTERNS & SHOOTING STARS
        // ---------------------------------------------------------------------
        const lanternCanvas = document.createElement('canvas');
        lanternCanvas.width = 64;
        lanternCanvas.height = 64;
        const lCtx = lanternCanvas.getContext('2d');
        if (lCtx) {
          const lGrad = lCtx.createRadialGradient(32, 32, 2, 32, 32, 28);
          lGrad.addColorStop(0.00, 'rgba(255, 235, 180, 1.0)');
          lGrad.addColorStop(0.25, 'rgba(255, 160, 40, 0.85)');
          lGrad.addColorStop(0.65, 'rgba(230, 80, 15, 0.28)');
          lGrad.addColorStop(1.00, 'rgba(200, 50, 10, 0.0)');
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

        // 7 authentic floating Tihar sky lanterns bobbing over the southern valley
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
              const cur = ms.startPos.clone().lerp(ms.endPos, ms.progress);
              const tail = ms.startPos.clone().lerp(ms.endPos, Math.max(0.0, ms.progress - 0.22));
              const posAttr = ms.mesh.geometry.attributes.position;
              posAttr.setXYZ(0, cur.x, cur.y, cur.z);
              posAttr.setXYZ(1, tail.x, tail.y, tail.z);
              posAttr.needsUpdate = true;
              const fade = Math.sin(ms.progress * Math.PI);
              ms.mesh.material.opacity = fade * 0.95;
            }
          }
        }
      }`;

// Replace existing buildCloudyMoonlitSkyDome
const targetStart = "buildCloudyMoonlitSkyDome() {";
const targetStartIndex = html.indexOf(targetStart);
const nextFnStart = "setShadowsOnly(enabled) {";
const targetEndIndex = html.indexOf(nextFnStart);

if (targetStartIndex !== -1 && targetEndIndex !== -1) {
  html = html.slice(0, targetStartIndex) + newSkyImplementation.trim() + "\n\n      " + html.slice(targetEndIndex);
  console.log("Successfully patched buildCloudyMoonlitSkyDome!");
} else {
  console.error("Could not find start/end indices for replacement!");
  process.exit(1);
}

// Hook atmosphere.updateSky into animate()
const animMarker = "if (atmosphere.skyGroup && camera) {";
const animIdx = html.indexOf(animMarker);
if (animIdx !== -1) {
  const insertCode = "if (atmosphere.updateSky) { atmosphere.updateSky(delta, timeSec); }\n        ";
  html = html.slice(0, animIdx) + insertCode + html.slice(animIdx);
  console.log("Successfully hooked atmosphere.updateSky into animate()!");
}

async function testSky() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

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
  await page.waitForTimeout(1200);

  // View 1: Looking North-East up at Sacred Machapuchare (Fishtail Peak) and High Himalayas
  // In our coordinate system, Machapuchare is at angle 0.44 rad (facing +X, +Z), which is at yaw ~ -2.70 rad.
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = -2.70;
      playerPhysics.yaw = -2.70;
      playerPhysics.targetPitch = 0.38;
      playerPhysics.pitch = 0.38;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_01_machapuchare_fishtail.png' });

  // View 2: Looking West/North-West at the Majestic Autumn Moon & Atmospheric Corona/Halo
  // Moon is at Vector3(-48, 88, -118), which is at yaw ~ +0.38 rad.
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = 0.38;
      playerPhysics.yaw = 0.38;
      playerPhysics.targetPitch = 0.42;
      playerPhysics.pitch = 0.42;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_02_moon_and_halo.png' });

  // View 3: Looking high up at the Great Himalayan Milky Way arch & Zenith constellations
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = 1.60;
      playerPhysics.yaw = 1.60;
      playerPhysics.targetPitch = 0.58;
      playerPhysics.pitch = 0.58;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_03_milky_way_zenith.png' });

  // View 4: Looking South at Pokhara Valley Tihar Glow & Drifting Sky Lanterns
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      playerPhysics.targetYaw = 3.14;
      playerPhysics.yaw = 3.14;
      playerPhysics.targetPitch = 0.16;
      playerPhysics.pitch = 0.16;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_04_valley_lanterns.png' });

  console.log('Saved all 4 sky overhaul screenshots to /tmp/sky_0*.png');
  await browser.close();
  server.close();
}

testSky();
