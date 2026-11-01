import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const photo1Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793555830868_89208d79.jpg';
const photo2Path = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793555830870_64ab75e5.jpg';

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
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Helper: create an offscreen canvas of an image with smooth horizontal edge feathering
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
            a = a * a * (3 - 2 * a); // smoothstep
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

    const sectionMain = createFeatheredSection(img2, 70, 612, 140);

    const mCanvas = document.createElement('canvas');
    mCanvas.width = W;
    mCanvas.height = H;
    const mCtx = mCanvas.getContext('2d');

    // 1. Draw Left Wing (West / Dhaulagiri)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(sectionMain, -820, 35, 950, 477);
    mCtx.restore();

    // 2. Draw Right Wing (East / Manaslu)
    mCtx.save();
    mCtx.scale(-1, 1);
    mCtx.drawImage(sectionMain, -2180, 40, 950, 472);
    mCtx.restore();

    // 3. Draw Centerpiece: High Himalayas (Machapuchare and Annapurna range)
    // Overlapping smoothly across x = 320 to 1728
    mCtx.drawImage(sectionMain, 320, 20, 1408, 492);

    // Now process the entire 2048x512 mountain canvas pixel-by-pixel
    const mData = mCtx.getImageData(0, 0, W, H);
    const d = mData.data;

    for (let y = 0; y < H; y++) {
      // Smooth vertical alpha curve:
      // y = 0 to 45: 0 (completely transparent for stars)
      // y = 45 to 140: smoothstep transition from 0 to 1
      // y = 140 to 430: 1.0 (full mountain & foothill opacity)
      // y = 430 to 512: smooth fade into ground fog base
      let vAlpha = 1.0;
      if (y < 45) {
        vAlpha = 0.0;
      } else if (y < 140) {
        const t = (y - 45) / 95;
        vAlpha = t * t * (3 - 2 * t);
      }

      let bottomFogWeight = 0.0;
      if (y > 440) {
        bottomFogWeight = Math.min(1.0, (y - 440) / 72);
      }

      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        let r = d[idx];
        let g = d[idx + 1];
        let b = d[idx + 2];

        // Atmospheric color tuning:
        // In the upper atmosphere (y < 160), blend towards deep cosmic purple (36, 22, 54)
        if (y < 160) {
          const skyBlend = 1.0 - Math.min(1.0, (y - 45) / 115);
          r = Math.round(r * (1 - skyBlend * 0.7) + 36 * (skyBlend * 0.7));
          g = Math.round(g * (1 - skyBlend * 0.7) + 22 * (skyBlend * 0.7));
          b = Math.round(b * (1 - skyBlend * 0.7) + 54 * (skyBlend * 0.7));
        }

        // Blend with scene fog at bottom (0x0b1220 -> R:11, G:18, B:32)
        if (bottomFogWeight > 0.0) {
          r = Math.round(r * (1 - bottomFogWeight) + 11 * bottomFogWeight);
          g = Math.round(g * (1 - bottomFogWeight) + 18 * bottomFogWeight);
          b = Math.round(b * (1 - bottomFogWeight) + 32 * bottomFogWeight);
        }

        d[idx] = r;
        d[idx + 1] = g;
        d[idx + 2] = b;
        d[idx + 3] = Math.round(255 * vAlpha);
      }
    }
    mCtx.putImageData(mData, 0, 0);

    // 4. Draw into master canvas
    // Background atmospheric gradient:
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0.00, 'rgba(4, 2, 10, 0.00)');
    bgGrad.addColorStop(0.25, 'rgba(24, 14, 40, 0.20)');
    bgGrad.addColorStop(0.55, 'rgba(32, 20, 48, 0.75)');
    bgGrad.addColorStop(0.85, 'rgba(16, 20, 32, 0.95)');
    bgGrad.addColorStop(1.00, 'rgba(11, 18, 32, 1.00)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Draw the continuous mountains
    ctx.drawImage(mCanvas, 0, 0);

    // 5. Pokhara Valley "Sea of Lights" Overhaul
    // Warm golden ambient glow
    const valleyGlow = ctx.createLinearGradient(0, 370, 0, 512);
    valleyGlow.addColorStop(0.00, 'rgba(255, 170, 50, 0.00)');
    valleyGlow.addColorStop(0.35, 'rgba(255, 160, 45, 0.22)');
    valleyGlow.addColorStop(0.70, 'rgba(220, 115, 30, 0.16)');
    valleyGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = valleyGlow;
    ctx.fillRect(0, 370, W, 142);

    // 3200 sparkling pinpoint city lights across the 360-degree basin floor
    const rng = (seed) => {
      const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < 3200; i++) {
      const u = (i / 3200) * W;
      const jx = (rng(i * 1.7) - 0.5) * 22.0;
      const cx = (u + jx + W) % W;

      const v = Math.pow(rng(i * 3.1), 1.5);
      const cy = 405 + v * 80 + Math.sin(cx * 0.015) * 5;

      const lType = i % 16;
      let col, sz;
      if (lType === 0) {
        col = 'rgba(255, 255, 255, 0.98)'; // Brilliant white halide
        sz = 1.35;
      } else if (lType === 1 || lType === 2) {
        col = 'rgba(255, 218, 110, 0.94)'; // Golden Tihar bulb
        sz = 1.25;
      } else if (lType === 3 || lType === 4 || lType === 5) {
        col = 'rgba(255, 165, 48, 0.88)';  // Warm clay diya oil flame
        sz = 1.15;
      } else if (lType === 6) {
        col = 'rgba(255, 75, 45, 0.82)';   // Crimson festival light
        sz = 1.05;
      } else if (lType === 7) {
        col = 'rgba(110, 210, 255, 0.82)'; // Azure LED string
        sz = 1.05;
      } else {
        const a = (0.35 + rng(i * 7.3) * 0.55).toFixed(2);
        col = `rgba(255, 185, 75, ${a})`;
        sz = 0.90;
      }

      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, sz, sz);
    }

    // 6. Ensure perfect 360-degree seamless seam matching (left 64px with right 64px)
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

    return canvas.toDataURL('image/jpeg', 0.86);
  }, { p1B64: photo1Base64, p2B64: photo2Base64 });

  await browser.close();

  const outBase64 = resultBase64.replace(/^data:image\/jpeg;base64,/, '');
  const outBuf = Buffer.from(outBase64, 'base64');
  fs.writeFileSync('/tmp/realistic_himalaya_panorama.jpg', outBuf);
  console.log('Saved seamless realistic panorama to /tmp/realistic_himalaya_panorama.jpg (' + outBuf.length + ' bytes)');

  const tsContent = `export const HIMALAYA_PANORAMA_BASE64 = '${resultBase64}';\n`;
  fs.writeFileSync('mobile/components/games/hide-and-seek/himalayaPanoramaBase64.ts', tsContent, 'utf8');
  console.log('Saved to mobile/components/games/hide-and-seek/himalayaPanoramaBase64.ts');
}

generatePanorama();
