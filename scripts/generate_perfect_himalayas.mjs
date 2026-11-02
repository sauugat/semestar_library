import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const photo1Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793597721179_79761872.jpg';
const photo2Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793597721185_5131ed56.jpg';

const photo1Base64 = fs.readFileSync(photo1Path).toString('base64');
const photo2Base64 = fs.readFileSync(photo2Path).toString('base64');

async function buildTexture() {
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
    // 1. SKY GRADIENT: Authentic Twilight Sky (Matching User's Reference Photos)
    // Deep cosmic plum at zenith, transitioning through rich nocturnal violet
    // to vibrant twilight magenta-rose behind the snowy mountain ridgeline.
    // -------------------------------------------------------------------------
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0.00, '#030108'); // Zenith cosmic void black-indigo
    skyGrad.addColorStop(0.12, '#080414'); // High celestial deep plum-violet
    skyGrad.addColorStop(0.22, '#150926'); // Deep Himalayan night violet
    skyGrad.addColorStop(0.28, '#2a1244'); // Rich purple above mountain summits
    skyGrad.addColorStop(0.34, '#4a2064'); // Atmospheric twilight magenta-purple
    skyGrad.addColorStop(0.40, '#652a78'); // Vibrant twilight rose glow (behind peaks)
    skyGrad.addColorStop(0.46, '#462058'); // Foothill twilight purple
    skyGrad.addColorStop(0.53, '#221532'); // Valley mist purple-navy
    skyGrad.addColorStop(0.62, '#0b1220'); // Ground fog exact match (0x0b1220)
    skyGrad.addColorStop(1.00, '#060a12'); // Nadir ground
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // -------------------------------------------------------------------------
    // 2. THE GREAT HIMALAYAN MILKY WAY ARCH & NEBULA CLOUDS
    // -------------------------------------------------------------------------
    ctx.save();
    const mwSpline = [
      { x: 340,  y: 260, w: 120, a: 0.28 },
      { x: 620,  y: 150, w: 160, a: 0.40 },
      { x: 980,  y: 80,  w: 210, a: 0.48 },
      { x: 1380, y: 70,  w: 190, a: 0.42 },
      { x: 1740, y: 140, w: 150, a: 0.32 },
    ];

    mwSpline.forEach(pt => {
      const rg = ctx.createRadialGradient(pt.x, pt.y, 8, pt.x, pt.y, pt.w * 1.5);
      rg.addColorStop(0.00, 'rgba(135, 90, 210, ' + (pt.a * 0.75).toFixed(3) + ')');
      rg.addColorStop(0.40, 'rgba(75, 105, 200, ' + (pt.a * 0.45).toFixed(3) + ')');
      rg.addColorStop(0.75, 'rgba(35, 58, 135, ' + (pt.a * 0.18).toFixed(3) + ')');
      rg.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    mwSpline.forEach(pt => {
      const rgCore = ctx.createRadialGradient(pt.x + 3, pt.y - 2, 4, pt.x, pt.y, pt.w * 0.85);
      rgCore.addColorStop(0.00, 'rgba(248, 250, 255, ' + (pt.a * 0.96).toFixed(3) + ')');
      rgCore.addColorStop(0.32, 'rgba(215, 235, 255, ' + (pt.a * 0.70).toFixed(3) + ')');
      rgCore.addColorStop(0.68, 'rgba(135, 185, 245, ' + (pt.a * 0.35).toFixed(3) + ')');
      rgCore.addColorStop(1.00, 'rgba(11, 18, 32, 0)');
      ctx.fillStyle = rgCore;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.w * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });

    // Milky Way micro-stars
    for (let ms = 0; ms < 1500; ms++) {
      const t = ms / 1500;
      const baseX = 340 + t * 1400;
      const baseY = 260 - Math.sin(t * Math.PI) * 200;
      const spread = (Math.sin(t * Math.PI) * 70 + 18) * (Math.sin(ms * 12.3) * 0.5 + 0.5);
      const ang = Math.sin(ms * 33.7) * Math.PI * 2;
      const sx = (baseX + Math.cos(ang) * spread + W) % W;
      const sy = baseY + Math.sin(ang) * (spread * 0.65);
      if (sy < 290) {
        const sa = (0.38 + (ms % 7) * 0.09) * Math.min(1.0, Math.max(0.0, 1.0 - sy / 300));
        const sr = (ms % 29 === 0) ? 1.5 : ((ms % 7 === 0) ? 1.1 : 0.75);
        ctx.fillStyle = (ms % 5 === 0) ? `rgba(255, 238, 210, ${sa.toFixed(2)})` : `rgba(235, 248, 255, ${sa.toFixed(2)})`;
        ctx.fillRect(sx, sy, sr, sr);
      }
    }
    ctx.restore();

    // -------------------------------------------------------------------------
    // 3. COMPOSITE AUTHENTIC HIMALAYAN MOUNTAINS FROM USER'S REFERENCE PHOTOS
    // -------------------------------------------------------------------------
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

    // Crop mountain & valley band of Photo 2 (y = 85 to 682)
    const photo2Band = createFeatheredSection(img2, 85, 595, 110);

    const mCanvas = document.createElement('canvas');
    mCanvas.width = W;
    mCanvas.height = H;
    const mCtx = mCanvas.getContext('2d');

    const destY = 195;
    const destH = 415;

    // 3A. Draw Left Wing (mirrored for western Himalayan panorama / Dhaulagiri)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(photo2Band, -840, destY + 15, 960, destH - 10);
    mCtx.restore();

    // 3B. Draw Right Wing (mirrored for eastern Himalayan panorama / Manaslu)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(photo2Band, -2200, destY + 20, 960, destH - 15);
    mCtx.restore();

    // 3C. Draw Centerpiece (Annapurna Massif from Photo 2)
    mCtx.drawImage(photo2Band, 320, destY, 1400, destH);

    // 3D. Overlay Machhapuchhre (Fishtail) sharp peak from Photo 1 in center!
    // In Photo 1: crop mountain section (y = 120 to 520, height = 400)
    const photo1Peak = createFeatheredSection(img1, 120, 400, 80);
    // Draw centered at x = 1024, y = destY - 10 (peak lands at y ~ 275, +41 deg elevation!)
    mCtx.save();
    mCtx.globalAlpha = 0.88;
    mCtx.drawImage(photo1Peak, 740, destY - 10, 560, 410);
    mCtx.restore();

    // 3E. Process mountain pixels:
    // Boost snow contrast and luminosity, keep natural twilight coloring
    const mData = mCtx.getImageData(0, 0, W, H);
    const md = mData.data;

    for (let y = 0; y < H; y++) {
      let topAlpha = 1.0;
      if (y < 195) {
        topAlpha = 0.0;
      } else if (y < 285) {
        const t = (y - 195) / 90;
        topAlpha = t * t * (3 - 2 * t);
      }

      let bottomFog = 0.0;
      if (y > 520) {
        bottomFog = Math.min(1.0, (y - 520) / 75);
      }

      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        let r = md[idx];
        let g = md[idx + 1];
        let b = md[idx + 2];
        const a = md[idx + 3];

        if (a > 0) {
          // Detect snow-capped ridgelines (high brightness and rose/white tone)
          const isSnow = (y < 420 && r > 105 && b > 100 && g > 85);
          if (isSnow) {
            // Brighten and enrich snow highlights:
            // Gives the crisp, awe-inspiring Himalayan glow from the user's reference photos!
            r = Math.min(255, Math.round(r * 1.48 + 30));
            g = Math.min(255, Math.round(g * 1.40 + 25));
            b = Math.min(255, Math.round(b * 1.52 + 42));
          } else if (y < 320) {
            // Upper twilight sky: converge to rich magenta-violet
            const sBlend = 1.0 - Math.min(1.0, (y - 195) / 125);
            r = Math.round(r * (1 - sBlend * 0.45) + 72 * (sBlend * 0.45));
            g = Math.round(g * (1 - sBlend * 0.45) + 32 * (sBlend * 0.45));
            b = Math.round(b * (1 - sBlend * 0.45) + 95 * (sBlend * 0.45));
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
          md[idx + 3] = Math.round(a * topAlpha);
        }
      }
    }
    mCtx.putImageData(mData, 0, 0);

    // Draw mountains onto the master canvas
    ctx.drawImage(mCanvas, 0, 0);

    // -------------------------------------------------------------------------
    // 4. POKHARA VALLEY FESTIVAL "SEA OF LIGHTS" (ELEVATED & SPARKLING)
    // Placed along the foothills at y = 470 to 555 so they glitter right above
    // the campus perimeter walls!
    // -------------------------------------------------------------------------
    const valleyGlow = ctx.createLinearGradient(0, 455, 0, 560);
    valleyGlow.addColorStop(0.00, 'rgba(255, 185, 75, 0.00)');
    valleyGlow.addColorStop(0.30, 'rgba(255, 170, 60, 0.32)');
    valleyGlow.addColorStop(0.70, 'rgba(240, 140, 50, 0.24)');
    valleyGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = valleyGlow;
    ctx.fillRect(0, 455, W, 105);

    // 4,500 dense sparkling festival lights across the 360-degree basin floor
    const rng = (seed) => {
      const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < 4500; i++) {
      const u = (i / 4500) * W;
      const jx = (rng(i * 1.7) - 0.5) * 24.0;
      const cx = (u + jx + W) % W;

      const v = Math.pow(rng(i * 3.1), 1.3);
      const cy = 472 + v * 68 + Math.sin(cx * 0.015) * 6;

      const lType = i % 16;
      let col, sz;
      if (lType === 0) {
        col = 'rgba(255, 255, 255, 0.98)'; // Brilliant white halide
        sz = 1.45;
      } else if (lType === 1 || lType === 2) {
        col = 'rgba(255, 230, 135, 0.96)'; // Golden Tihar bulb
        sz = 1.35;
      } else if (lType === 3 || lType === 4 || lType === 5) {
        col = 'rgba(255, 180, 60, 0.92)';  // Warm clay diya oil flame
        sz = 1.25;
      } else if (lType === 6) {
        col = 'rgba(255, 90, 60, 0.88)';   // Crimson festival light
        sz = 1.15;
      } else if (lType === 7) {
        col = 'rgba(130, 225, 255, 0.88)'; // Azure LED string
        sz = 1.15;
      } else {
        const a = (0.45 + rng(i * 7.3) * 0.50).toFixed(2);
        col = `rgba(255, 200, 95, ${a})`;
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
  fs.writeFileSync('/tmp/perfect_himalaya_skydome.jpg', outBuf);
  console.log('Saved /tmp/perfect_himalaya_skydome.jpg (' + outBuf.length + ' bytes)');

  // Also save to brain artifact
  fs.writeFileSync('/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/perfect_himalaya_skydome.jpg', outBuf);

  // Export as TS module in worktree
  const tsContent = `export const UNIFIED_SKY_DOME_BASE64 = '${resultBase64}';\n`;
  fs.writeFileSync('mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts', tsContent, 'utf8');
  console.log('Updated worktree mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts');

  // Also update main repo
  const mainRepoSkyPath = '/Users/sauu_gat/semester-library/mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts';
  fs.writeFileSync(mainRepoSkyPath, tsContent, 'utf8');
  console.log('Updated main repo ' + mainRepoSkyPath);
}

buildTexture();
