'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3893;
const DIST_DIR = path.join(__dirname, '..', 'mobile', 'dist');
const SCREENSHOT_DIR = '/Users/sauu_gat/.gemini/antigravity/brain/a352d134-9ab3-45a9-907c-2949a3627fed/screenshots';

// Static file server for mobile/dist/
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/syllabus') reqPath = '/syllabus.html';
  let filePath = path.join(DIST_DIR, reqPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, reqPath + '.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'syllabus.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };

  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

async function runMobileQA() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`[Mobile QA Server] Running on http://localhost:${PORT}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  try {
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const mobilePage = await mobileContext.newPage();

    // 1. Mobile App Landing Screen
    console.log('[Mobile App Test 1] Loading Mobile App Landing Screen...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus`);
    await mobilePage.waitForTimeout(1000);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'mobile_app_01_landing.png'),
      fullPage: false
    });
    console.log('✓ Captured mobile_app_01_landing.png');

    // 2. Mobile App Search Input
    console.log('[Mobile App Test 2] Testing Search in Mobile App...');
    const searchInput = await mobilePage.$('input');
    if (searchInput) {
      await searchInput.fill('Java');
      await mobilePage.waitForTimeout(500);
      await mobilePage.screenshot({
        path: path.join(SCREENSHOT_DIR, 'mobile_app_02_search.png'),
        fullPage: false
      });
      console.log('✓ Captured mobile_app_02_search.png');
    }

    // 3. Mobile App Semester Subjects Listing
    console.log('[Mobile App Test 3] Loading Semester Subjects Listing...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus?semester=sem-1`);
    await mobilePage.waitForTimeout(1000);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'mobile_app_03_semester_subjects.png'),
      fullPage: false
    });
    console.log('✓ Captured mobile_app_03_semester_subjects.png');

    // 4. Mobile App Individual Subject Syllabus (CIT111)
    console.log('[Mobile App Test 4] Loading Subject Micro-Syllabus...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus?course=CIT111`);
    await mobilePage.waitForTimeout(1000);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'mobile_app_04_subject_syllabus.png'),
      fullPage: false
    });
    console.log('✓ Captured mobile_app_04_subject_syllabus.png');

    // 5. Mobile App Narrow Screen Test (320px)
    console.log('[Mobile App Test 5] Testing Narrow Screen (320px)...');
    await mobilePage.setViewportSize({ width: 320, height: 600 });
    await mobilePage.goto(`http://localhost:${PORT}/syllabus`);
    await mobilePage.waitForTimeout(1000);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'mobile_app_05_narrow_320px.png'),
      fullPage: false
    });
    console.log('✓ Captured mobile_app_05_narrow_320px.png');

    await mobileContext.close();
    console.log('========================================================');
    console.log('MOBILE APP QA COMPLETED SUCCESSFULLY!');
    console.log('========================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

runMobileQA().catch(err => {
  console.error('[Mobile QA FAILED]:', err);
  process.exit(1);
});
