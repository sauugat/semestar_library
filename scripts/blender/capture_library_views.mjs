import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { THREE_MIN_JS } from '../../mobile/components/games/hide-and-seek/threeMinJs.ts';
import { GLTF_LOADER_R128_JS } from '../../mobile/components/games/hide-and-seek/gltfLoaderR128.ts';
import { LIBRARY_GLB_DATA_URI } from '../../mobile/components/games/hide-and-seek/libraryGlbBase64.ts';
import { HORROR_CONFIG } from '../../mobile/components/games/hide-and-seek/horrorConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateHtml() {
  const root = path.resolve(__dirname, '../..');
  const gameHtmlPath = path.resolve(root, 'mobile/components/games/hide-and-seek/gameHtml.ts');
  const file = fs.readFileSync(gameHtmlPath, 'utf8');

  const configJson = JSON.stringify(HORROR_CONFIG);

  const start = file.indexOf("return `");
  const end = file.lastIndexOf("`;") + 2;
  const fnBody = file.slice(start, end);
  const fn = new Function("THREE_MIN_JS", "GLTF_LOADER_R128_JS", "LIBRARY_GLB_DATA_URI", "configJson", fnBody);
  const html = fn(THREE_MIN_JS, GLTF_LOADER_R128_JS, LIBRARY_GLB_DATA_URI, configJson);

  return html;
}

async function main() {
  const outputDir = '/Users/sauu_gat/.gemini/antigravity/brain/45106dad-77ce-43dd-a1d9-7616daf470de/screenshots_library';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = generateHtml();
  console.log('Generated production HTML payload (' + (html.length / 1024 / 1024).toFixed(2) + ' MB)');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Server listening at http://127.0.0.1:${port}`);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--no-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[Browser error]:', msg.text());
    }
  });

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Hide 2D UI elements
  await page.evaluate(() => {
    const ids = [
      'live-lighting-tuner-panel', 'btn-lighting-tuner', 'joystick-zone',
      'cinematic-vignette', 'game-hud', 'toast', 'touch-controls', 'action-cluster',
      'stealth-overlay', 'horror-pulse-overlay', 'blindfold-overlay', 'audio-unlock-gate'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    });

    if (window.playerPhysics) {
      window.playerPhysics.cameraMode = 'first';
    }
  });

  const viewpoints = [
    {
      name: 'view01_library_exterior_steps_and_torana',
      x: 18.5, y: 1.62, z: 16.5, yaw: -2.2, pitch: 0.08,
      flashlight: false, desc: 'East Wing R4 Library exterior veranda, stone steps, Torana garland & entrance doorway'
    },
    {
      name: 'view02_entrance_doorway_looking_into_lobby',
      x: 24.6, y: 1.62, z: 19.0, yaw: -Math.PI / 2, pitch: 0.0,
      flashlight: false, desc: 'Standing at entrance threshold looking East into reception and circulation lobby'
    },
    {
      name: 'view03_reception_circulation_counter_closeup',
      x: 26.2, y: 1.45, z: 18.2, yaw: -2.45, pitch: -0.15,
      flashlight: false, desc: 'L-shaped reception counter with open ledger, clay diyo flame & marigold garland'
    },
    {
      name: 'view04_main_reading_hall_overview',
      x: 28.5, y: 1.62, z: 28.0, yaw: 0.0, pitch: -0.04,
      flashlight: false, desc: 'Grand reading hall perspective: large study tables, banker lamps, central aisle & bookshelves'
    },
    {
      name: 'view05_reading_table_and_banker_lamp_closeup',
      x: 26.8, y: 1.30, z: 26.5, yaw: 0.60, pitch: -0.25,
      flashlight: false, desc: 'Close-up of polished teak study table with classic brass banker lamp and notebooks'
    },
    {
      name: 'view06_tall_bookshelf_aisle_view',
      x: 24.8, y: 1.62, z: 14.5, yaw: -Math.PI / 2, pitch: 0.0,
      flashlight: false, desc: 'Looking down tall bookshelf aisles with categorized academic book spines'
    },
    {
      name: 'view07_rare_book_interaction_closeup',
      x: 27.0, y: 1.40, z: 14.8, yaw: 0.0, pitch: -0.15,
      flashlight: false, desc: 'Rare book collection on shelf: Gandaki University Founding Ledger (1998)'
    },
    {
      name: 'view08_archive_partition_doorway',
      x: 28.0, y: 1.62, z: 14.8, yaw: 0.0, pitch: 0.0,
      flashlight: false, desc: 'Approaching archive partition wall and restricted archive section doorway'
    },
    {
      name: 'view09_inside_restricted_archive_room',
      x: 28.5, y: 1.62, z: 10.5, yaw: Math.PI / 2, pitch: -0.10,
      flashlight: false, desc: 'Inside restricted archive room showing metal filing cabinets, drawer & storage cupboards'
    },
    {
      name: 'view10_flashlight_in_dark_aisle_hiding_spot',
      x: 26.5, y: 1.62, z: 15.0, yaw: Math.PI / 2 + 0.35, pitch: -0.15,
      flashlight: true, desc: 'Player flashlight beam in dark bookshelf corner illuminating hiding spot'
    }
  ];

  for (const vp of viewpoints) {
    await page.evaluate(({ x, y, z, yaw, pitch, flashlight }) => {
      if (window.physicsDebug) {
        window.physicsDebug.teleport(x, y, z, yaw);
      }
      if (window.playerPhysics) {
        window.playerPhysics.cameraMode = 'first';
        window.playerPhysics.pitch = pitch;
        window.playerPhysics.targetPitch = pitch;
      }
      if (window.camera) {
        window.camera.rotation.x = pitch;
        window.camera.rotation.y = yaw;
      }
      if (window.atmosphere && window.atmosphere.flashlight) {
        window.atmosphere.flashlight.intensity = flashlight ? 2.5 : 0;
        if (window.atmosphere.flashlightSpill) window.atmosphere.flashlightSpill.intensity = flashlight ? 0.8 : 0;
        if (window.atmosphere.flashlightRig) window.atmosphere.flashlightRig.visible = flashlight;
      }
    }, vp);

    await page.waitForTimeout(700);
    const filePath = path.join(outputDir, `${vp.name}.png`);
    await page.screenshot({ path: filePath });
    console.log(`Captured ${vp.name} (${vp.desc})`);
  }

  await browser.close();
  server.close();
  console.log('All 10 library viewpoints captured successfully!');
}

main().catch(err => {
  console.error('Error during library capture:', err);
  process.exit(1);
});
