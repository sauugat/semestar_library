import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const photo1Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793597721179_79761872.jpg';
const photo2Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793597721185_5131ed56.jpg';

const photo1Base64 = fs.readFileSync(photo1Path).toString('base64');
const photo2Base64 = fs.readFileSync(photo2Path).toString('base64');

async function generatePanorama() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();

  const resultBase64 = await page.evaluate(async ({ p1B64, p2B64 }) => {
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

    // -------------------------------------------------------------------------
    // 1. SKY GRADIENT: Deep Twilight Royal Indigo to Himalayan Horizon Violet
    // Matches the rich twilight atmosphere in Photo 1 & 2
    // -------------------------------------------------------------------------
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0.00, '#04020a'); // Zenith cosmic void black-violet
    skyGrad.addColorStop(0.12, '#0a0518'); // High celestial deep plum-indigo
    skyGrad.addColorStop(0.24, '#150a28'); // Deep Himalayan night violet
    skyGrad.addColorStop(0.35, '#26123e'); // Twilight purple above mountain summits
    skyGrad.addColorStop(0.44, '#381c50'); // Rich twilight magenta-violet (matching photo sky)
    skyGrad.addColorStop(0.50, '#2e1840'); // Horizon twilight purple
    skyGrad.addColorStop(0.58, '#161226'); // Lower foothills haze
    skyGrad.addColorStop(0.66, '#0b1220'); // Scene ground fog exact match (0x0b1220)
    skyGrad.addColorStop(1.00, '#060a12'); // Nadir ground
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // -------------------------------------------------------------------------
    // 2. THE GREAT HIMALAYAN MILKY WAY ARCH & NEBULA CLOUDS
    // -------------------------------------------------------------------------
    ctx.save();
    const mwSpline = [
      { x: 340,  y: 320, w: 130, a: 0.24 },
      { x: 620,  y: 200, w: 170, a: 0.35 },
      { x: 980,  y: 110, w: 220, a: 0.45 },
      { x: 1380, y: 95,  w: 200, a: 0.38 },
      { x: 1740, y: 190, w: 160, a: 0.28 },
    ];

    mwSpline.forEach(pt => {
      const rg = ctx.createRadialGradient(pt.x, pt.y, 10, pt.x, pt.y, pt.w * 1.6);
      rg.addColorStop(0.00, 'rgba(102, 68, 168, ' + (pt.a * 0.75).toFixed(3) + ')');
      rg.addColorStop(0.40, 'rgba(56, 88, 172, ' + (pt.a * 0.45).toFixed(3) + ')');
      rg.addColorStop(0.75, 'rgba(28, 48, 110, ' + (pt.a * 0.18).toFixed(3) + ')');
      rg.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 1.6, 0, Math.PI * 2);
      ctx.fill();
    });

    mwSpline.forEach(pt => {
      const rgCore = ctx.createRadialGradient(pt.x + 3, pt.y - 2, 4, pt.x, pt.y, pt.w * 0.85);
      rgCore.addColorStop(0.00, 'rgba(240, 245, 255, ' + (pt.a * 0.92).toFixed(3) + ')');
      rgCore.addColorStop(0.32, 'rgba(195, 225, 255, ' + (pt.a * 0.65).toFixed(3) + ')');
      rgCore.addColorStop(0.68, 'rgba(110, 160, 225, ' + (pt.a * 0.30).toFixed(3) + ')');
      rgCore.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rgCore;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });

    // Micro-Star Clusters along the Milky Way
    for (let ms = 0; ms < 1500; ms++) {
      const t = ms / 1500;
      const baseX = 340 + t * 1400;
      const baseY = 320 - Math.sin(t * Math.PI) * 230;
      const spread = (Math.sin(t * Math.PI) * 75 + 20) * (Math.sin(ms * 12.3) * 0.5 + 0.5);
      const ang = Math.sin(ms * 33.7) * Math.PI * 2;
      const sx = (baseX + Math.cos(ang) * spread + W) % W;
      const sy = baseY + Math.sin(ang) * (spread * 0.65);
      if (sy < 380) {
        const sa = (0.35 + (ms % 7) * 0.09) * Math.min(1.0, Math.max(0.0, 1.0 - sy / 420));
        const sr = (ms % 29 === 0) ? 1.5 : ((ms % 7 === 0) ? 1.1 : 0.75);
        ctx.fillStyle = (ms % 5 === 0) ? `rgba(255, 235, 205, ${sa.toFixed(2)})` : `rgba(230, 245, 255, ${sa.toFixed(2)})`;
        ctx.fillRect(sx, sy, sr, sr);
      }
    }
    ctx.restore();

    // -------------------------------------------------------------------------
    // 3. TOWERING HIGH HIMALAYAS: EXTRACTED DIRECTLY FROM USER'S PHOTO 2
    // Photo 2 has the exact mountain profile: Machhapuchhre (Fishtail) in center,
    // Annapurna range to the left, and peaks to the right.
    // -------------------------------------------------------------------------
    // Photo 2: width 1024, height 682.
    // Mountain peaks are at photo y = 120 to 220.
    // Foothills are at photo y = 300 to 420.
    // City lights are at photo y = 430 to 650.

    // Helper: create an offscreen crop with edge feathering
    const createFeatheredSection = (img, cropY, cropH, featherW = 100) => {
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

    // Crop the mountain & city band of Photo 2 (y = 80 to 680, height 600)
    const photoBand = createFeatheredSection(img2, 70, 610, 120);

    const mCanvas = document.createElement('canvas');
    mCanvas.width = W;
    mCanvas.height = H;
    const mCtx = mCanvas.getContext('2d');

    // Placed so mountain summits reach y = 210..270!
    // In equirectangular: y = 240 is +27.2 degrees elevation above eye-level!
    // This clears campus buildings (which are < 18 deg) and towers into the sky!
    // Center Machhapuchhre at x = 1024 (width = 1380, height = 560, top y = 145)
    // Left Wing (West/Dhaulagiri): x = -200 to 750
    // Right Wing (East/Manaslu): x = 1400 to 2250

    // 3A. Draw Left Wing (mirrored for natural variation)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(photoBand, -850, 160, 980, 540);
    mCtx.restore();

    // 3B. Draw Right Wing
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(photoBand, -2220, 170, 980, 530);
    mCtx.restore();

    // 3C. Draw Centerpiece (Annapurna Massif & Machhapuchhre in prime focus)
    // Positioned from x = 320 to 1720 (width 1400, height 570, top y = 135)
    // Machhapuchhre summit will sit at x ~ 960..1024, y ~ 235!
    mCtx.drawImage(photoBand, 320, 135, 1400, 570);

    // 3D. Process mountain pixels:
    // - Enhance snow highlights so snowy ridges are crisp white/rose (just like the user's photos)
    // - Smooth blend top of mountains into the twilight purple sky (NO cut-off or premature fade)
    // - Smooth blend bottom of valley into scene fog (0x0b1220)
    const mData = mCtx.getImageData(0, 0, W, H);
    const md = mData.data;

    for (let y = 0; y < H; y++) {
      // Top sky transition:
      // Above y = 150: completely transparent (pure starry sky)
      // y = 150 to 260: smooth atmospheric blend
      let topAlpha = 1.0;
      if (y < 150) {
        topAlpha = 0.0;
      } else if (y < 260) {
        const t = (y - 150) / 110;
        topAlpha = t * t * (3 - 2 * t);
      }

      // Bottom fog transition:
      // Below y = 570: smoothly fade into scene fog 0x0b1220 (11, 18, 32)
      let bottomFog = 0.0;
      if (y > 550) {
        bottomFog = Math.min(1.0, (y - 550) / 110);
      }

      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        let r = md[idx];
        let g = md[idx + 1];
        let b = md[idx + 2];
        const a = md[idx + 3];

        if (a > 0) {
          // Boost snowy ridge contrast and luminosity:
          // In Photo 2, snow has high red & blue (r > 120, b > 120, g > 100)
          const isSnow = (r > 120 && b > 115 && g > 95 && y < 420);
          if (isSnow) {
            // Brighten snow to make the Himalayan peaks vividly pop out against the night sky!
            r = Math.min(255, Math.round(r * 1.32 + 25));
            g = Math.min(255, Math.round(g * 1.25 + 18));
            b = Math.min(255, Math.round(b * 1.35 + 30));
          } else if (y < 350) {
            // Upper mountain atmosphere: converge smoothly to twilight magenta-violet
            const sBlend = 1.0 - Math.min(1.0, (y - 150) / 180);
            r = Math.round(r * (1 - sBlend * 0.55) + 48 * (sBlend * 0.55));
            g = Math.round(g * (1 - sBlend * 0.55) + 24 * (sBlend * 0.55));
            b = Math.round(b * (1 - sBlend * 0.55) + 68 * (sBlend * 0.55));
          }

          // Converge bottom to scene fog 0x0b1220
          if (bottomFog > 0.0) {
            r = Math.round(r * (1 - bottomFog) + 11 * bottomFog);
            g = Math.round(g * (1 - bottomFog) + 18 * bottomFog);
            b = Math.round(b * (1 - bottomFog) + 32 * bottomFog);
          }

          md[idx] = r;
          md[idx + 1] = g;
          md[idx + 2] = b;
          md[idx + 3] = Math.round(a * topAlpha);
        }
      }
    }
    mCtx.putImageData(mData, 0, 0);

    // Draw mountains onto the master canvas
    ctx.drawImage(mCanvas, 0, 0);

    // -------------------------------------------------------------------------
    // 4. POKHARA VALLEY FESTIVAL "SEA OF LIGHTS" (ELEVATED & SPARKLING)
    // Placed along the foothills at y = 460 to 560 so they shimmer right above
    // the campus perimeter walls!
    // -------------------------------------------------------------------------
    const valleyGlow = ctx.createLinearGradient(0, 440, 0, 580);
    valleyGlow.addColorStop(0.00, 'rgba(255, 175, 60, 0.00)');
    valleyGlow.addColorStop(0.25, 'rgba(255, 160, 50, 0.28)');
    valleyGlow.addColorStop(0.65, 'rgba(235, 130, 40, 0.22)');
    valleyGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = valleyGlow;
    ctx.fillRect(0, 440, W, 140);

    // 4,000 dense sparkling festival lights across the 360-degree basin floor
    const rng = (seed) => {
      const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < 4200; i++) {
      const u = (i / 4200) * W;
      const jx = (rng(i * 1.7) - 0.5) * 26.0;
      const cx = (u + jx + W) % W;

      const v = Math.pow(rng(i * 3.1), 1.35);
      const cy = 465 + v * 85 + Math.sin(cx * 0.015) * 8;

      const lType = i % 16;
      let col, sz;
      if (lType === 0) {
        col = 'rgba(255, 255, 255, 0.98)'; // Brilliant white halide
        sz = 1.45;
      } else if (lType === 1 || lType === 2) {
        col = 'rgba(255, 225, 120, 0.96)'; // Golden Tihar bulb
        sz = 1.35;
      } else if (lType === 3 || lType === 4 || lType === 5) {
        col = 'rgba(255, 170, 50, 0.92)';  // Warm clay diya oil flame
        sz = 1.25;
      } else if (lType === 6) {
        col = 'rgba(255, 80, 50, 0.88)';   // Crimson festival light
        sz = 1.15;
      } else if (lType === 7) {
        col = 'rgba(120, 215, 255, 0.88)'; // Azure LED string
        sz = 1.15;
      } else {
        const a = (0.40 + rng(i * 7.3) * 0.55).toFixed(2);
        col = `rgba(255, 190, 80, ${a})`;
        sz = 1.0;
      }

      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, sz, sz);
    }

    // -------------------------------------------------------------------------
    // 5. SEAMLESS 360-DEGREE HORIZONTAL WRAP
    // -------------------------------------------------------------------------
    const edgeL = ctx.getImageData(0, 0, 72, H);
    const edgeR = ctx.getImageData(W - 72, 0, 72, H);
    const dL = edgeL.data;
    const dR = edgeR.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 72; x++) {
        const idx = (y * 72 + x) * 4;
        const blend = x / 72;
        for (let c = 0; c < 4; c++) {
          const mid = (dL[idx + c] + dR[idx + c]) * 0.5;
          dL[idx + c] = Math.round(dL[idx + c] * blend + mid * (1 - blend));
          dR[idx + c] = Math.round(dR[idx + c] * (1 - blend) + mid * blend);
        }
      }
    }
    ctx.putImageData(edgeL, 0, 0);
    ctx.putImageData(edgeR, W - 72, 0);

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { p1B64: photo1Base64, p2B64: photo2Base64 });

  await browser.close();

  const outBase64 = resultBase64.replace(/^data:image\/jpeg;base64,/, '');
  const outBuf = Buffer.from(outBase64, 'base64');
  fs.writeFileSync('/tmp/towering_himalaya_skydome.jpg', outBuf);
  console.log('Saved /tmp/towering_himalaya_skydome.jpg (' + outBuf.length + ' bytes)');

  // Also save to brain artifact
  fs.writeFileSync('/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/towering_himalaya_skydome.jpg', outBuf);

  // Export as TS module
  const tsContent = `export const UNIFIED_SKY_DOME_BASE64 = '${resultBase64}';\n`;
  fs.writeFileSync('mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts', tsContent, 'utf8');
  console.log('Updated mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts');
}

generatePanorama();

