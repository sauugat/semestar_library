import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// User's full-height original photograph (1024 x 682):
// Contains the full purple sky, Machhapuchhre with lenticular sunset cloud,
// Annapurna range, dark foothills, and the glittering sea of Pokhara lights!
const fullPhotoPath = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793608178803_36e90d4c.jpg';
const fullPhotoB64 = fs.readFileSync(fullPhotoPath).toString('base64');

async function build() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  const dataUrl = await page.evaluate(async ({ photoB64 }) => {
    const loadImg = (b64) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = 'data:image/jpeg;base64,' + b64;
    });

    const img = await loadImg(photoB64);

    const W = 2048;
    const H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // -------------------------------------------------------------------------
    // 1. MASTER CELESTIAL SKY GRADIENT (Exact Color-Match to User Reference Photo)
    // Deep cosmic indigo at zenith transitioning smoothly through nocturnal violet
    // into the exact dusky lilac/lavender palette of the photograph at y = 90.
    // -------------------------------------------------------------------------
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0.00, '#07040e'); // Cosmic zenith void
    skyGrad.addColorStop(0.08, '#10071e'); // High celestial dome
    skyGrad.addColorStop(0.16, '#230f3a'); // Deep nocturnal purple
    skyGrad.addColorStop(0.24, '#441d5d'); // Twilight violet
    skyGrad.addColorStop(0.32, '#6c3b7e'); // Rich dusky mauve
    skyGrad.addColorStop(0.38, '#9884a6'); // EXACT match to top of photograph (152, 132, 166)
    skyGrad.addColorStop(0.46, '#725e80'); // Atmospheric twilight haze
    skyGrad.addColorStop(0.54, '#383049'); // Foothill valley dusk
    skyGrad.addColorStop(0.64, '#1a1d2d'); // Lower ridge mist
    skyGrad.addColorStop(0.72, '#0b1220'); // Three.js scene fog color (0x0b1220)
    skyGrad.addColorStop(1.00, '#060a12'); // Nadir ground
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // -------------------------------------------------------------------------
    // 2. AUTHENTIC HIMALAYAN PANORAMA FROM USER'S ORIGINAL PHOTOGRAPH
    // Scaled and positioned so Machhapuchhre is centered at x = 1080
    // (aligns directly behind the courtyard building when rotY = Math.PI - 0.22)
    // -------------------------------------------------------------------------
    const rW = 1800;
    const rH = Math.round(rW * (img.height / img.width)); // ~1200px
    // In photo (1024x682), Machhapuchhre summit is at x ~ 432:
    const rX = Math.round(1080 - (432 / 1024) * rW);
    const rY = 90; // Top of photo placed at y = 90

    // Offscreen feathered canvas for pristine photo
    const pCanvas = document.createElement('canvas');
    pCanvas.width = rW;
    pCanvas.height = rH;
    const pCtx = pCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0, rW, rH);

    // Feather edges:
    // Top: soft 70px feather into matching lavender sky
    // Left & Right: soft 160px feather into 360 wings
    // Bottom: soft 120px feather into nadir ground fog
    const pData = pCtx.getImageData(0, 0, rW, rH);
    const pd = pData.data;
    const topFeather = 70;
    const sideFeather = 160;
    const botFeather = 140;

    for (let y = 0; y < rH; y++) {
      let aY = 1.0;
      if (y < topFeather) {
        const t = y / topFeather;
        aY = t * t * (3 - 2 * t);
      } else if (y > rH - botFeather) {
        const t = (rH - y) / botFeather;
        aY = Math.max(0.0, t * t * (3 - 2 * t));
      }

      for (let x = 0; x < rW; x++) {
        let aX = 1.0;
        if (x < sideFeather) {
          const t = x / sideFeather;
          aX = t * t * (3 - 2 * t);
        } else if (x > rW - sideFeather) {
          const t = (rW - x) / sideFeather;
          aX = t * t * (3 - 2 * t);
        }

        const alpha = aX * aY;
        const idx = (y * rW + x) * 4;
        pd[idx + 3] = Math.round(pd[idx + 3] * alpha);
      }
    }
    pCtx.putImageData(pData, 0, 0);

    // Draw the centerpiece photograph
    ctx.drawImage(pCanvas, rX, rY);

    // -------------------------------------------------------------------------
    // 3. CONTINUOUS 360-DEGREE PANORAMA WINGS
    // Seamlessly connects the Annapurna range, foothills, and city lights around 360°
    // -------------------------------------------------------------------------
    // Left wing
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(pCanvas, rX - rW * 0.85, rY + 45, rW * 0.90, rH * 0.96);
    // Right wing
    ctx.drawImage(pCanvas, rX + rW * 0.85, rY + 45, rW * 0.90, rH * 0.96);
    ctx.restore();

    // -------------------------------------------------------------------------
    // 4. MATHEMATICALLY PERFECT SEAMLESS 360-DEGREE WRAP
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
  }, { photoB64: fullPhotoB64 });

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
