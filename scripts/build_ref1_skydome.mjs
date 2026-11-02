import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ref1Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793606772788_469ea29c.jpg';
const ref1B64 = fs.readFileSync(ref1Path).toString('base64');

async function build() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  const dataUrl = await page.evaluate(async ({ r1 }) => {
    const loadImg = (b64) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = 'data:image/jpeg;base64,' + b64;
    });

    const imgRef1 = await loadImg(r1);

    const W = 2048;
    const H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // -------------------------------------------------------------------------
    // 1. MASTER CELESTIAL SKY GRADIENT (Exact Color-Match to User Reference 1)
    // Silky smooth, authentic twilight sky graduating from deep cosmic indigo
    // at the celestial zenith into dusky violet and exact lavender at photo top.
    // -------------------------------------------------------------------------
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0.00, '#06040e'); // Cosmic zenith indigo-black
    skyGrad.addColorStop(0.08, '#0d071a'); // Upper celestial dome
    skyGrad.addColorStop(0.16, '#1e0f34'); // Deep nocturnal purple
    skyGrad.addColorStop(0.24, '#381b53'); // Twilight violet
    skyGrad.addColorStop(0.31, '#5a2f74'); // Mauve-violet
    skyGrad.addColorStop(0.36, '#7e5590'); // Dusky lilac
    skyGrad.addColorStop(0.40, '#9884a6'); // EXACT match to top of Ref 1 photo
    skyGrad.addColorStop(0.48, '#6c5a7a'); // Valley twilight haze
    skyGrad.addColorStop(0.54, '#352e46'); // Distant foothill mist
    skyGrad.addColorStop(0.62, '#181b2b'); // Lower ridge silhouette
    skyGrad.addColorStop(0.70, '#0b1220'); // Three.js scene fog color (0x0b1220)
    skyGrad.addColorStop(1.00, '#060a12'); // Nadir ground
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // -------------------------------------------------------------------------
    // 2. AUTHENTIC HIMALAYAN MASSIF & MACHHAPUCHHRE FROM REFERENCE 1
    // Peak is centered at x = 1086 (dead center facing North from campus).
    // -------------------------------------------------------------------------
    const r1W = 1820;
    const r1H = Math.round(r1W * (imgRef1.height / imgRef1.width)); // ~657px
    // In Ref 1 (1024x370), peak is at x ~ 432:
    const r1X = Math.round(1086 - (432 / 1024) * r1W); // Center peak at x = 1086
    const r1Y = 135; // Summit peak lands at y ~ 360 (+26.7 deg elevation)

    const r1Canvas = document.createElement('canvas');
    r1Canvas.width = r1W;
    r1Canvas.height = r1H;
    const r1Ctx = r1Canvas.getContext('2d');
    r1Ctx.drawImage(imgRef1, 0, 0, r1W, r1H);

    // Feather top (seamless blend into lavender sky) and left/right/bottom edges
    const r1Data = r1Ctx.getImageData(0, 0, r1W, r1H);
    const d1 = r1Data.data;
    const topFeather = 65;
    const sideFeather = 160;
    const botFeather = 110;

    for (let y = 0; y < r1H; y++) {
      let aY = 1.0;
      if (y < topFeather) {
        const t = y / topFeather;
        aY = t * t * (3 - 2 * t);
      } else if (y > r1H - botFeather) {
        const t = (r1H - y) / botFeather;
        aY = Math.max(0.0, t * t * (3 - 2 * t));
      }

      for (let x = 0; x < r1W; x++) {
        let aX = 1.0;
        if (x < sideFeather) {
          const t = x / sideFeather;
          aX = t * t * (3 - 2 * t);
        } else if (x > r1W - sideFeather) {
          const t = (r1W - x) / sideFeather;
          aX = t * t * (3 - 2 * t);
        }

        const alpha = aX * aY;
        const idx = (y * r1W + x) * 4;
        d1[idx + 3] = Math.round(d1[idx + 3] * alpha);
      }
    }
    r1Ctx.putImageData(r1Data, 0, 0);

    // Draw pristine Ref 1 mountain panorama
    ctx.drawImage(r1Canvas, r1X, r1Y);

    // -------------------------------------------------------------------------
    // 3. LAYERED FOOTHILL SILHOUETTES & 360-DEGREE PANORAMA
    // -------------------------------------------------------------------------
    // Gentle distant ridges continuing around the western and eastern horizons
    ctx.save();
    ctx.globalAlpha = 0.70;
    ctx.drawImage(r1Canvas, r1X - r1W * 0.85, r1Y + 38, r1W * 0.90, r1H * 0.95);
    ctx.drawImage(r1Canvas, r1X + r1W * 0.85, r1Y + 38, r1W * 0.90, r1H * 0.95);
    ctx.restore();

    // -------------------------------------------------------------------------
    // 4. SOFT POKHARA VALLEY FESTIVAL "SEA OF LIGHTS"
    // Warm glittering city lights nestled along the southern valley floor
    // (x: 0..450 and x: 1600..2048, y: 505..560), matching Ref 2
    // -------------------------------------------------------------------------
    const rng = (seed) => {
      const s = Math.sin(seed * 91.345) * 43758.5453;
      return s - Math.floor(s);
    };

    // Soft valley basin ambient glow
    const valGrad = ctx.createLinearGradient(0, 495, 0, 565);
    valGrad.addColorStop(0.00, 'rgba(255, 185, 75, 0.00)');
    valGrad.addColorStop(0.40, 'rgba(255, 175, 65, 0.18)');
    valGrad.addColorStop(0.75, 'rgba(215, 125, 45, 0.12)');
    valGrad.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = valGrad;
    ctx.fillRect(0, 495, W, 70);

    for (let i = 0; i < 4000; i++) {
      const u = rng(i * 1.6180339887);
      const v = rng(i * 2.7182818284);
      const cx = (u * W) | 0;

      // Higher density in the southern valley (away from the central massif)
      const isNorthCenter = (cx > 700 && cx < 1450);
      const prob = isNorthCenter ? 0.18 : 0.92;
      if (rng(i * 3.14159) > prob) continue;

      const cy = 502 + Math.pow(v, 1.4) * 58 + Math.sin(cx * 0.025) * 4;
      if (cy > 560) continue;

      const warmType = i % 10;
      let col;
      if (warmType < 6) {
        col = `rgba(255, 218, 145, ${(0.35 + rng(i * 5.1) * 0.55).toFixed(2)})`;
      } else if (warmType < 8) {
        col = `rgba(255, 165, 65, ${(0.40 + rng(i * 6.2) * 0.50).toFixed(2)})`;
      } else {
        col = `rgba(225, 242, 255, ${(0.45 + rng(i * 7.3) * 0.45).toFixed(2)})`;
      }

      const sz = (i % 19 === 0) ? 1.4 : 1.0;
      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, sz, sz);
    }

    // -------------------------------------------------------------------------
    // 5. MATHEMATICALLY PERFECT SEAMLESS 360-DEGREE WRAP
    // Blends x in [0, K-1] and x in [W-K, W-1] so column 0 == column W-1 identically
    // -------------------------------------------------------------------------
    const K = 128;
    const fullImgData = ctx.getImageData(0, 0, W, H);
    const fd = fullImgData.data;

    for (let y = 0; y < H; y++) {
      const idxL0 = (y * W + 0) * 4;
      const idxR_end = (y * W + (W - 1)) * 4;

      for (let c = 0; c < 4; c++) {
        const midVal = (fd[idxL0 + c] + fd[idxR_end + c]) * 0.5;

        // Blend left margin x = 0..K-1
        for (let x = 0; x < K; x++) {
          const s = x / K;
          const t = s * s * (3 - 2 * s);
          const idx = (y * W + x) * 4;
          fd[idx + c] = Math.round(midVal * (1 - t) + fd[idx + c] * t);
        }

        // Blend right margin x = (W - K)..W-1
        for (let xp = 0; xp < K; xp++) {
          const x = (W - K) + xp;
          const sp = (K - 1 - xp) / K;
          const tp = sp * sp * (3 - 2 * sp);
          const idx = (y * W + x) * 4;
          fd[idx + c] = Math.round(midVal * (1 - tp) + fd[idx + c] * tp);
        }
      }
    }
    ctx.putImageData(fullImgData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.92);
  }, { r1: ref1B64 });

  await browser.close();

  const outBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  const outBuf = Buffer.from(outBase64, 'base64');
  const outJpgPath = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/ref1_himalayas_skydome.jpg';
  fs.writeFileSync(outJpgPath, outBuf);
  console.log(`Saved ${outJpgPath} (${outBuf.length} bytes)`);

  const tsContent = `export const UNIFIED_SKY_DOME_BASE64 = '${dataUrl}';\n`;
  fs.writeFileSync('mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts', tsContent, 'utf8');
  console.log('Updated worktree unifiedSkyDomeBase64.ts');

  const mainRepoSkyPath = '/Users/sauu_gat/semester-library/mobile/components/games/hide-and-seek/unifiedSkyDomeBase64.ts';
  fs.writeFileSync(mainRepoSkyPath, tsContent, 'utf8');
  console.log('Updated main repo ' + mainRepoSkyPath);
}

build();
