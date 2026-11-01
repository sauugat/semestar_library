import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const imgPath = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/.user_uploaded/media_1793555830870_64ab75e5.jpg';
const imgBase64 = fs.readFileSync(imgPath).toString('base64');
const dataUrl = `data:image/jpeg;base64,${imgBase64}`;

async function processImage() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();

  const resultBase64 = await page.evaluate(async (srcUrl) => {
    const img = new Image();
    img.src = srcUrl;
    await new Promise(r => { img.onload = r; });

    // Target texture size: 2048 x 512 for full 360 degree cylindrical horizon
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // 1. Draw background dark Himalayan atmosphere
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
    bgGrad.addColorStop(0.00, 'rgba(5, 3, 10, 0.0)');
    bgGrad.addColorStop(0.35, 'rgba(18, 10, 32, 0.25)');
    bgGrad.addColorStop(0.60, 'rgba(28, 16, 44, 0.85)');
    bgGrad.addColorStop(0.85, 'rgba(16, 12, 24, 0.98)');
    bgGrad.addColorStop(1.00, 'rgba(11, 18, 32, 1.0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 2048, 512);

    // 2. We position the high Himalayas in the northern sector (centered around x = 1150 for bearing 0.44 rad)
    // The photo (1024x682) contains Machapuchare in the upper center and Pokhara lights in the lower half.
    // Let's create an offscreen canvas for the photo with feathered edges
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 1024;
    pCanvas.height = 682;
    const pCtx = pCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0);

    // Feather the top sky to transparent so stars show above the ridgeline
    const idata = pCtx.getImageData(0, 0, 1024, 682);
    const d = idata.data;
    for (let y = 0; y < 682; y++) {
      for (let x = 0; x < 1024; x++) {
        const idx = (y * 1024 + x) * 4;
        
        // Vertical feathering: top sky fades smoothly to transparent above mountains
        let vAlpha = 1.0;
        if (y < 170) {
          vAlpha = Math.max(0.0, (y - 70) / 100.0);
        } else if (y > 610) {
          vAlpha = Math.max(0.0, (682 - y) / 72.0);
        }

        // Horizontal feathering: smooth fade at the edges for seamless 360 blending
        let hAlpha = 1.0;
        if (x < 120) {
          hAlpha = Math.max(0.0, x / 120.0);
        } else if (x > 904) {
          hAlpha = Math.max(0.0, (1024 - x) / 120.0);
        }

        const a = vAlpha * hAlpha;
        d[idx + 3] = Math.round(d[idx + 3] * a);
      }
    }
    pCtx.putImageData(idata, 0, 0);

    // 3. Draw the feathered real Himalayan mountain panorama onto the 2048x512 cylinder texture
    // Primary placement facing North / North-East (Machapuchare at bearing ~ 0.44 rad, x ~ 1180)
    ctx.drawImage(pCanvas, 680, 80, 1024, 432);

    // Secondary complementary mountain profile on the opposite / extended side
    ctx.save();
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(pCanvas, -720, 110, 750, 402);
    ctx.restore();

    // 4. Fill the valley base and foothills with authentic Pokhara city lights and warm Tihar glow
    // Southern and valley opening
    const vGlow = ctx.createRadialGradient(1024, 480, 20, 1024, 480, 500);
    vGlow.addColorStop(0.00, 'rgba(255, 170, 55, 0.42)'); // Warm Tihar diya ambience
    vGlow.addColorStop(0.40, 'rgba(235, 130, 40, 0.22)');
    vGlow.addColorStop(0.75, 'rgba(160, 75, 120, 0.08)');
    vGlow.addColorStop(1.00, 'rgba(11, 18, 32, 0.00)');
    ctx.fillStyle = vGlow;
    ctx.fillRect(0, 360, 2048, 152);

    // Add thousands of sparkling pinpoint lights across the lower valley
    for (let c = 0; c < 1200; c++) {
      const cx = (c * 23.7 + Math.sin(c * 2.3) * 85) % 2048;
      const cy = 415 + Math.pow((c % 100) / 100, 1.4) * 92 + (Math.sin(c * 7.1) * 4);
      const lType = c % 12;
      let colStr, rad;
      if (lType === 0) {
        colStr = 'rgba(245, 250, 255, 0.95)';
        rad = 1.4;
      } else if (lType === 1 || lType === 2) {
        colStr = 'rgba(255, 190, 65, 0.92)';
        rad = 1.3;
      } else if (lType === 3) {
        colStr = 'rgba(255, 120, 45, 0.88)';
        rad = 1.1;
      } else {
        const a = (0.40 + (c % 5) * 0.12).toFixed(2);
        colStr = (c % 3 === 0) ? `rgba(255, 205, 110, ${a})` : `rgba(255, 168, 60, ${a})`;
        rad = 0.85;
      }
      ctx.fillStyle = colStr;
      ctx.fillRect(cx, cy, rad, rad);
    }

    return canvas.toDataURL('image/jpeg', 0.82);
  }, dataUrl);

  await browser.close();

  const outBase64 = resultBase64.replace(/^data:image\/jpeg;base64,/, '');
  const outBuf = Buffer.from(outBase64, 'base64');
  fs.writeFileSync('/tmp/processed_himalaya_panorama.jpg', outBuf);
  console.log('Saved processed panorama to /tmp/processed_himalaya_panorama.jpg, size:', outBuf.length, 'bytes');

  // Also write as a small ts module
  const tsContent = `export const HIMALAYA_PANORAMA_BASE64 = '${resultBase64}';\n`;
  fs.writeFileSync('mobile/components/games/hide-and-seek/himalayaPanoramaBase64.ts', tsContent, 'utf8');
  console.log('Saved mobile/components/games/hide-and-seek/himalayaPanoramaBase64.ts');
}

processImage();
