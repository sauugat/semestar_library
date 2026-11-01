import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { THREE_MIN_JS } from '../mobile/components/games/hide-and-seek/threeMinJs.ts';

const photo1Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793555830868_89208d79.jpg';
const photo2Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793555830870_64ab75e5.jpg';

const photo1Base64 = fs.readFileSync(photo1Path).toString('base64');
const photo2Base64 = fs.readFileSync(photo2Path).toString('base64');

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

// Pre-composite the High-Definition Sky Dome Texture using Playwright
async function buildSkyTexture() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const textureBase64 = await page.evaluate(async ({ p1B64, p2B64 }) => {
    const loadImg = (b64) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = 'data:image/jpeg;base64,' + b64;
    });

    const [img1, img2] = await Promise.all([loadImg(p1B64), loadImg(p2B64)]);

    const W = 2048;
    const H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 1. Full Spherical Celestial Vault Gradient:
    // y = 0: Zenith (overhead, 90 deg)
    // y = 512: Equator / True Horizon (0 deg)
    // y = 1024: Nadir (straight down, -90 deg)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0.00, '#04020a'); // Cosmic zenith black-violet
    skyGrad.addColorStop(0.18, '#080414'); // Deep nocturnal purple-sapphire
    skyGrad.addColorStop(0.32, '#120b24'); // High Himalayan atmospheric navy
    skyGrad.addColorStop(0.42, '#201438'); // Twilight purple above mountains
    skyGrad.addColorStop(0.50, '#2e1a46'); // Horizon twilight purple
    skyGrad.addColorStop(0.56, '#181224'); // Foothills lower atmosphere
    skyGrad.addColorStop(0.64, '#0b1220'); // Ground fog exact match (0x0b1220)
    skyGrad.addColorStop(1.00, '#070a12'); // Nadir ground base
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. The Great Himalayan Milky Way Arch (Luminous Cosmic Clouds)
    ctx.save();
    const mwSpline = [
      { x: 320,  y: 420, w: 140, a: 0.22 },
      { x: 600,  y: 280, w: 190, a: 0.32 },
      { x: 960,  y: 160, w: 240, a: 0.42 },
      { x: 1360, y: 140, w: 220, a: 0.36 },
      { x: 1720, y: 260, w: 170, a: 0.26 },
    ];

    // 2A. Outer nebula glow
    mwSpline.forEach(pt => {
      const rg = ctx.createRadialGradient(pt.x, pt.y, 10, pt.x, pt.y, pt.w * 1.6);
      rg.addColorStop(0.00, 'rgba(88, 58, 146, ' + (pt.a * 0.75).toFixed(3) + ')');
      rg.addColorStop(0.40, 'rgba(46, 78, 152, ' + (pt.a * 0.45).toFixed(3) + ')');
      rg.addColorStop(0.75, 'rgba(22, 42, 92, ' + (pt.a * 0.18).toFixed(3) + ')');
      rg.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 1.6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 2B. Luminous core star clouds
    mwSpline.forEach(pt => {
      const rgCore = ctx.createRadialGradient(pt.x + 3, pt.y - 2, 4, pt.x, pt.y, pt.w * 0.85);
      rgCore.addColorStop(0.00, 'rgba(235, 242, 255, ' + (pt.a * 0.90).toFixed(3) + ')');
      rgCore.addColorStop(0.32, 'rgba(180, 215, 255, ' + (pt.a * 0.62).toFixed(3) + ')');
      rgCore.addColorStop(0.68, 'rgba(96, 146, 210, ' + (pt.a * 0.28).toFixed(3) + ')');
      rgCore.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rgCore;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });

    // 2C. Micro-Star Clusters along the Milky Way
    for (let ms = 0; ms < 1400; ms++) {
      const t = ms / 1400;
      const baseX = 320 + t * 1400;
      const baseY = 420 - Math.sin(t * Math.PI) * 280;
      const spread = (Math.sin(t * Math.PI) * 85 + 24) * (Math.sin(ms * 12.3) * 0.5 + 0.5);
      const ang = Math.sin(ms * 33.7) * Math.PI * 2;
      const sx = (baseX + Math.cos(ang) * spread + W) % W;
      const sy = baseY + Math.sin(ang) * (spread * 0.65);
      const sa = (0.28 + (ms % 7) * 0.10) * Math.min(1.0, Math.max(0.0, 1.0 - sy / 480));
      const sr = (ms % 23 === 0) ? 1.4 : ((ms % 7 === 0) ? 1.0 : 0.7);
      ctx.fillStyle = (ms % 5 === 0) ? `rgba(255, 230, 195, ${sa.toFixed(2)})` : `rgba(225, 240, 255, ${sa.toFixed(2)})`;
      ctx.fillRect(sx, sy, sr, sr);
    }

    // 2D. Pleiades Cluster
    const plx = 1280, ply = 180;
    const plNeb = ctx.createRadialGradient(plx, ply, 3, plx, ply, 48);
    plNeb.addColorStop(0.00, 'rgba(150, 200, 255, 0.42)');
    plNeb.addColorStop(0.55, 'rgba(80, 130, 220, 0.18)');
    plNeb.addColorStop(1.00, 'rgba(10, 20, 35, 0)');
    ctx.fillStyle = plNeb;
    ctx.beginPath();
    ctx.arc(plx, ply, 48, 0, Math.PI * 2);
    ctx.fill();

    [[0,0,1.5], [-8,-6,1.3], [7,-7,1.2], [-6,8,1.3], [10,4,1.1], [16,-3,1.0], [-15,3,1.0]].forEach(([ox, oy, sz]) => {
      ctx.fillStyle = 'rgba(235, 246, 255, 0.98)';
      ctx.beginPath();
      ctx.arc(plx + ox, ply + oy, sz, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // 3. DRAW THE AUTHENTIC HIMALAYAN HORIZON (Photo 2) DIRECTLY ONTO THE DOME!
    // In spherical UV mapping:
    // The equator / horizon is at y = 512.
    // 25 degrees elevation = y = 512 - (25/180) * 1024 = 512 - 142 = 370.
    // So mountain summits should reach y ~ 370 in the 1024 canvas!
    // Photo 2 has width 1024, height 682.
    // In Photo 2: Machapuchare summit is at y = 200.
    // If we draw Photo 2 with height 480:
    // Placed at y = 300:
    // Summit is at 300 + (200/682) * 480 = 300 + 140 = 440 (12.6 deg elevation).
    // If placed at y = 200 with height 540:
    // Summit is at 200 + (200/682) * 540 = 200 + 158 = 358 (27.0 deg elevation)!
    // That clears the campus rooflines (15-18 deg) and towers into the sky!

    // Create feathered sections of Photo 2
    const createFeatheredSection = (img, cropY, cropH, featherW = 120) => {
      const iw = img.naturalWidth;
      const ih = cropH;
      const c = document.createElement('canvas');
      c.width = iw;
      c.height = ih;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, cropY, iw, cropH, 0, 0, iw, cropH);

      const idata = cx.getImageData(0, 0, iw, ih);
      const d = idata.data;
      for (let y = 0; y < ih; y++) {
        for (let x = 0; x < iw; x++) {
          const idx = (y * iw + x) * 4;
          let a = 1.0;
          if (x < featherW) {
            a = x / featherW;
            a = a * a * (3 - 2 * a);
          } else if (x > iw - featherW) {
            a = (iw - x) / featherW;
            a = a * a * (3 - 2 * a);
          }
          d[idx + 3] = Math.round(d[idx + 3] * a);
        }
      }
      cx.putImageData(idata, 0, 0);
      return c;
    };

    const section = createFeatheredSection(img2, 70, 612, 140);

    const mCanvas = document.createElement('canvas');
    mCanvas.width = W;
    mCanvas.height = H;
    const mCtx = mCanvas.getContext('2d');

    // Draw Left Wing (flipped for organic variety)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(section, -820, 230, 950, 520);
    mCtx.restore();

    // Draw Right Wing
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(section, -2180, 240, 950, 510);
    mCtx.restore();

    // Draw Centerpiece (Machapuchare and Annapurnas, centered at x = 1024)
    mCtx.drawImage(section, 320, 205, 1408, 545);

    // Alpha blend Photo 2 with the celestial sky and ground fog
    const mData = mCtx.getImageData(0, 0, W, H);
    const md = mData.data;

    for (let y = 0; y < H; y++) {
      // Top sky transition:
      // Above y = 230: 0 alpha
      // y = 230 to 350: smooth transition into the celestial sky
      let vAlpha = 1.0;
      if (y < 230) {
        vAlpha = 0.0;
      } else if (y < 350) {
        const t = (y - 230) / 120;
        vAlpha = t * t * (3 - 2 * t);
      }

      // Bottom fog transition:
      // Below y = 560: smoothly fade into 0x0b1220 fog
      let bottomFog = 0.0;
      if (y > 540) {
        bottomFog = Math.min(1.0, (y - 540) / 100);
      }

      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        let r = md[idx];
        let g = md[idx + 1];
        let b = md[idx + 2];

        // Converge upper atmosphere to twilight purple
        if (y < 370) {
          const sBlend = 1.0 - Math.min(1.0, (y - 230) / 140);
          r = Math.round(r * (1 - sBlend * 0.65) + 38 * (sBlend * 0.65));
          g = Math.round(g * (1 - sBlend * 0.65) + 24 * (sBlend * 0.65));
          b = Math.round(b * (1 - sBlend * 0.65) + 58 * (sBlend * 0.65));
        }

        // Converge bottom to scene fog 0x0b1220 (11, 18, 32)
        if (bottomFog > 0.0) {
          r = Math.round(r * (1 - bottomFog) + 11 * bottomFog);
          g = Math.round(g * (1 - bottomFog) + 18 * bottomFog);
          b = Math.round(b * (1 - bottomFog) + 32 * bottomFog);
        }

        md[idx] = r;
        md[idx + 1] = g;
        md[idx + 2] = b;
        md[idx + 3] = Math.round(255 * vAlpha);
      }
    }
    mCtx.putImageData(mData, 0, 0);

    // Draw mountains onto the master spherical canvas
    ctx.drawImage(mCanvas, 0, 0);

    // 4. Pokhara Valley "Sea of Lights" Overhaul
    // Warm golden ambient glow around the horizon (y = 500 to 620)
    const valleyGlow = ctx.createLinearGradient(0, 480, 0, 620);
    valleyGlow.addColorStop(0.00, 'rgba(255, 170, 50, 0.00)');
    valleyGlow.addColorStop(0.35, 'rgba(255, 160, 45, 0.24)');
    valleyGlow.addColorStop(0.70, 'rgba(220, 115, 30, 0.18)');
    valleyGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = valleyGlow;
    ctx.fillRect(0, 480, W, 140);

    // 3500 sparkling pinpoint city lights across the 360-degree basin floor
    const rng = (seed) => {
      const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < 3500; i++) {
      const u = (i / 3500) * W;
      const jx = (rng(i * 1.7) - 0.5) * 22.0;
      const cx = (u + jx + W) % W;

      const v = Math.pow(rng(i * 3.1), 1.5);
      const cy = 508 + v * 76 + Math.sin(cx * 0.015) * 6;

      const lType = i % 16;
      let col, sz;
      if (lType === 0) {
        col = 'rgba(255, 255, 255, 0.98)';
        sz = 1.35;
      } else if (lType === 1 || lType === 2) {
        col = 'rgba(255, 218, 110, 0.94)';
        sz = 1.25;
      } else if (lType === 3 || lType === 4 || lType === 5) {
        col = 'rgba(255, 165, 48, 0.88)';
        sz = 1.15;
      } else if (lType === 6) {
        col = 'rgba(255, 75, 45, 0.82)';
        sz = 1.05;
      } else if (lType === 7) {
        col = 'rgba(110, 210, 255, 0.82)';
        sz = 1.05;
      } else {
        const a = (0.35 + rng(i * 7.3) * 0.55).toFixed(2);
        col = `rgba(255, 185, 75, ${a})`;
        sz = 0.90;
      }

      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, sz, sz);
    }

    // 5. Ensure seamless left-to-right 360 wrap
    const edgeL = ctx.getImageData(0, 0, 64, H);
    const edgeR = ctx.getImageData(W - 64, 0, 64, H);
    const dL = edgeL.data;
    const dR = edgeR.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = (y * 64 + x) * 4;
        const blend = x / 64;
        for (let c = 0; c < 4; c++) {
          const mid = (dL[idx + c] + dR[idx + c]) * 0.5;
          dL[idx + c] = Math.round(dL[idx + c] * blend + mid * (1 - blend));
          dR[idx + c] = Math.round(dR[idx + c] * (1 - blend) + mid * blend);
        }
      }
    }
    ctx.putImageData(edgeL, 0, 0);
    ctx.putImageData(edgeR, W - 64, 0);

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { p1B64: photo1Base64, p2B64: photo2Base64 });

  await browser.close();
  return textureBase64;
}

async function run() {
  console.log('Generating unified high-definition sky & Himalayan dome texture...');
  const skyBase64 = await buildSkyTexture();
  const b64Only = skyBase64.replace(/^data:image\/jpeg;base64,/, '');
  const outBuf = Buffer.from(b64Only, 'base64');
  fs.writeFileSync('/tmp/unified_himalaya_skydome.jpg', outBuf);
  console.log('Saved /tmp/unified_himalaya_skydome.jpg (' + outBuf.length + ' bytes)');

  // Inject into HTML harness
  const b64Inject = `window.__UNIFIED_SKY_BASE64__ = "${skyBase64}";\n`;
  html = html.replace('<script>', `<script>\n${b64Inject}`);

  const unifiedSkyImpl = `
      buildCloudyMoonlitSkyDome() {
        if (this.skyGroup) {
          this.scene.remove(this.skyGroup);
        }
        this.skyGroup = new THREE.Group();
        this.skyGroup.name = 'NightHorrorSkyAndSilhouettes';

        // ---------------------------------------------------------------------
        // 1. UNIFIED CELESTIAL SKY DOME WITH REAL HIMALAYAS & POKHARA VALLEY
        // One seamless sphere: zero cylinder rims, zero seams, zero clipping!
        // ---------------------------------------------------------------------
        const skyImg = new Image();
        const skyTex = new THREE.Texture(skyImg);
        skyTex.wrapS = THREE.RepeatWrapping;
        skyTex.wrapT = THREE.ClampToEdgeWrapping;
        if (THREE.SRGBColorSpace) skyTex.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding) skyTex.encoding = THREE.sRGBEncoding;

        skyImg.onload = function() {
          skyTex.needsUpdate = true;
        };
        skyImg.src = window.__UNIFIED_SKY_BASE64__;

        const skySphere = new THREE.Mesh(
          new THREE.SphereGeometry(180, 48, 32),
          new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.BackSide,
            fog: false,
            depthWrite: false
          })
        );
        // Rotate so Machapuchare faces North-North-East (~15 deg East of North)
        skySphere.rotation.y = Math.PI - 0.22;
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

        // Real Himalayan Constellations
        const constellations = [
          { name: 'Betelgeuse', theta: 1.85, phi: 0.72, color: [1.0, 0.68, 0.45], size: 4.2 },
          { name: 'Rigel',      theta: 1.98, phi: 0.94, color: [0.75, 0.88, 1.0],  size: 4.0 },
          { name: 'Bellatrix',  theta: 1.78, phi: 0.76, color: [0.85, 0.92, 1.0],  size: 3.2 },
          { name: 'Saiph',      theta: 2.02, phi: 0.91, color: [0.82, 0.90, 1.0],  size: 3.0 },
          { name: 'Alnitak',    theta: 1.91, phi: 0.83, color: [0.90, 0.95, 1.0],  size: 3.4 },
          { name: 'Alnilam',    theta: 1.89, phi: 0.84, color: [0.92, 0.96, 1.0],  size: 3.5 },
          { name: 'Mintaka',    theta: 1.87, phi: 0.85, color: [0.90, 0.95, 1.0],  size: 3.3 },

          // Ursa Major (Saptarishi)
          { name: 'Dubhe',      theta: -0.85, phi: 0.52, color: [1.0, 0.88, 0.65], size: 3.6 },
          { name: 'Merak',      theta: -0.82, phi: 0.58, color: [0.92, 0.95, 1.0], size: 3.4 },
          { name: 'Phecda',     theta: -0.92, phi: 0.62, color: [0.92, 0.95, 1.0], size: 3.2 },
          { name: 'Megrez',     theta: -0.96, phi: 0.56, color: [0.90, 0.94, 1.0], size: 2.8 },
          { name: 'Alioth',     theta: -1.06, phi: 0.53, color: [0.92, 0.95, 1.0], size: 3.6 },
          { name: 'Mizar',      theta: -1.14, phi: 0.49, color: [0.92, 0.95, 1.0], size: 3.5 },
          { name: 'Alkaid',     theta: -1.24, phi: 0.44, color: [0.80, 0.88, 1.0], size: 3.6 },

          // Polaris
          { name: 'Polaris',    theta: -0.84, phi: 0.35, color: [1.0, 0.96, 0.88], size: 3.8 },

          // Cassiopeia
          { name: 'Schedar',    theta: 0.35, phi: 0.42, color: [1.0, 0.85, 0.60], size: 3.5 },
          { name: 'Caph',       theta: 0.28, phi: 0.45, color: [0.95, 0.96, 1.0], size: 3.2 },
          { name: 'Gamma Cas',  theta: 0.41, phi: 0.38, color: [0.85, 0.92, 1.0], size: 3.4 },
          { name: 'Ruchbah',    theta: 0.48, phi: 0.41, color: [0.92, 0.95, 1.0], size: 3.1 },
          { name: 'Segin',      theta: 0.55, phi: 0.37, color: [0.88, 0.92, 1.0], size: 2.9 },

          // Sirius
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

        while (sIdx < starCount) {
          const h1 = Math.sin(sIdx * 127.1 + 311.7) * 43758.5453;
          const h2 = Math.sin(sIdx * 269.5 + 183.3) * 43758.5453;
          const u = h1 - Math.floor(h1);
          const v = h2 - Math.floor(h2);

          const theta = u * Math.PI * 2.0 - Math.PI;
          const phi = Math.pow(v, 1.45) * 1.15 + 0.10; // High in the celestial sphere

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
        // 3. DYNAMIC POKHARA VALLEY TWINKLE LIGHTS
        // ---------------------------------------------------------------------
        const cityLightCount = 900;
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

        // Inner Corona
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

        // 22-degree Lunar Halo
        const haloCanvas = document.createElement('canvas');
        haloCanvas.width = 256;
        haloCanvas.height = 256;
        const hCtx = haloCanvas.getContext('2d');
        if (hCtx) {
          const hGrad = hCtx.createRadialGradient(128, 128, 60, 128, 128, 124);
          hGrad.addColorStop(0.00, 'rgba(180, 215, 255, 0.00)');
          hGrad.addColorStop(0.40, 'rgba(195, 225, 255, 0.03)');
          hGrad.addColorStop(0.70, 'rgba(220, 238, 255, 0.22)');
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

        // Shooting Stars
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

        if (this._skyUniforms) {
          this._skyUniforms.uSkyTime.value = timeSec;
        }

        if (this.skyLanterns && this.skyLanterns.length > 0) {
          for (let i = 0; i < this.skyLanterns.length; i++) {
            const sl = this.skyLanterns[i];
            const bob = Math.sin(timeSec * sl.speed + sl.phase) * 1.8;
            const sway = Math.cos(timeSec * (sl.speed * 0.7) + sl.phase) * 1.2;
            sl.sprite.position.y = sl.baseY + bob + (timeSec * sl.driftRate) % 24.0;
            sl.sprite.position.x = sl.baseX + sway;
          }
        }

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
      }
`;

  const skyMarker = 'buildCloudyMoonlitSkyDome() {';
  const nextMethodMarker = 'setShadowsOnly(enabled) {';
  const sIdx = html.indexOf(skyMarker);
  const eIdx = html.indexOf(nextMethodMarker);

  if (sIdx !== -1 && eIdx !== -1) {
    html = html.slice(0, sIdx) + unifiedSkyImpl.trim() + '\n\n      ' + html.slice(eIdx);
    console.log('Successfully injected unified Himalayan sky dome into HTML!');
  } else {
    console.error('Could not find markers in gameHtml.ts! sIdx:', sIdx, 'eIdx:', eIdx);
  }

  // Start test server
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  const port = await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  console.log('Testing unified sky at http://127.0.0.1:' + port);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  await page.goto('http://127.0.0.1:' + port);
  await page.waitForTimeout(2500);

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

  // View 1: Looking North-East up at Sacred Machapuchare and High Himalayas
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

  // View 3: Southern Pokhara Valley lights
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      physicsDebug.teleport(0, 1.62, 0, 0.40);
      playerPhysics.targetPitch = 0.08;
      playerPhysics.pitch = 0.08;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_03_pokhara_lights.png' });

  // View 4: Wide courtyard view
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      physicsDebug.teleport(15.0, 1.62, 12.0, -2.50);
      playerPhysics.targetPitch = 0.15;
      playerPhysics.pitch = 0.15;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/refine_04_campus_himalayas.png' });

  console.log('Saved all screenshots to /tmp/refine_0*.png');
  await browser.close();
  server.close();
}

run();

