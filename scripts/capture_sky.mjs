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
const html = fn(THREE_MIN_JS, configJson);

async function captureSky() {
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
  await page.goto('http://127.0.0.1:' + port);
  await page.waitForTimeout(2500);

  // Look up at moon and sky
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      window.__TEST_HARNESS__.simulateLook(2.3, 0.55);
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_view_moon.png' });

  // Pan around to mountain horizon
  await page.evaluate(() => {
    if (window.__TEST_HARNESS__) {
      window.__TEST_HARNESS__.simulateLook(-1.6, -0.2);
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/sky_view_mountains.png' });

  console.log('Saved screenshots to /tmp/sky_view_moon.png and /tmp/sky_view_mountains.png');
  await browser.close();
  server.close();
}

captureSky();
