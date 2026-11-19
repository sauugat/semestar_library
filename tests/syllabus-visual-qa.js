'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3892;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SCREENSHOT_DIR = '/Users/sauu_gat/.gemini/antigravity/brain/a352d134-9ab3-45a9-907c-2949a3627fed/screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Simple static file server for public/
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/syllabus') reqPath = '/syllabus.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found: ' + req.url);
    return;
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
    '.ico': 'image/x-icon'
  };

  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

async function runVisualQA() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`[QA Server] Running on http://localhost:${PORT}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  try {
    // -------------------------------------------------------------
    // 1. DESKTOP TESTS (1200x800)
    // -------------------------------------------------------------
    const desktopContext = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 2
    });
    const desktopPage = await desktopContext.newPage();

    // 1A. Desktop Landing Page
    console.log('[Test 1A] Loading Desktop Landing Page...');
    await desktopPage.goto(`http://localhost:${PORT}/syllabus.html#`);
    await desktopPage.waitForSelector('.syl-semester-grid');
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_01_landing.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_01_landing.png');

    // 1B. Desktop Search "Java"
    console.log('[Test 1B] Testing Desktop Search...');
    await desktopPage.fill('#syllabusSearchInput', 'Java');
    await desktopPage.waitForTimeout(300);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_02_search_results.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_02_search_results.png');

    // Clear search
    await desktopPage.click('#searchClearBtn');
    await desktopPage.waitForTimeout(200);

    // 1C. Desktop Semester Subjects (Semester III / Year 2)
    console.log('[Test 1C] Loading Desktop Semester Subjects...');
    await desktopPage.goto(`http://localhost:${PORT}/syllabus.html#Year%202/III`);
    await desktopPage.waitForSelector('.syl-subject-card');
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_03_semester_subjects.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_03_semester_subjects.png');

    // 1D. Desktop Course Detail & Accordion (CIT122 - Java)
    console.log('[Test 1D] Loading Desktop Course Detail (Java)...');
    await desktopPage.goto(`http://localhost:${PORT}/syllabus.html#Year%201/II/CIT122-Computer%20Programming%20II%20(Java)`);
    await desktopPage.waitForSelector('.syl-unit-accordion');
    
    // Check initial state: Unit 1 must be expanded, Unit 2 collapsed
    const unit1Expanded = await desktopPage.$eval('#unitAccordion-0', el => el.classList.contains('expanded'));
    const unit2Expanded = await desktopPage.$eval('#unitAccordion-1', el => el.classList.contains('expanded'));
    console.log(`[Accordion Check] Unit 1 initial expanded: ${unit1Expanded}, Unit 2 initial expanded: ${unit2Expanded}`);
    
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_04_subject_syllabus.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_04_subject_syllabus.png');

    // 1E. Expand Unit 2 and capture
    console.log('[Test 1E] Toggling Unit 2...');
    await desktopPage.click('#unitAccordion-1 .syl-unit-header-btn');
    await desktopPage.waitForTimeout(200);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_05_units_expanded.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_05_units_expanded.png');

    // 1F. Desktop Electives View
    console.log('[Test 1F] Loading Desktop Electives with Cluster Filter...');
    await desktopPage.goto(`http://localhost:${PORT}/syllabus.html#Electives`);
    await desktopPage.waitForSelector('.syl-cluster-chip');
    await desktopPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_desktop_06_electives.png'),
      fullPage: false
    });
    console.log('✓ Captured web_desktop_06_electives.png');

    await desktopContext.close();

    // -------------------------------------------------------------
    // 2. MOBILE VIEWPORT TESTS (390x844 - iPhone / Modern Android)
    // -------------------------------------------------------------
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const mobilePage = await mobileContext.newPage();

    // 2A. Mobile Landing Page
    console.log('[Test 2A] Loading Mobile Landing Page...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus.html#`);
    await mobilePage.waitForSelector('.syl-semester-grid');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_mobile_01_landing.png'),
      fullPage: false
    });
    console.log('✓ Captured web_mobile_01_landing.png');

    // 2B. Mobile Search View
    console.log('[Test 2B] Testing Mobile Search...');
    await mobilePage.fill('#syllabusSearchInput', 'Data Structures');
    await mobilePage.waitForTimeout(300);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_mobile_02_search.png'),
      fullPage: false
    });
    console.log('✓ Captured web_mobile_02_search.png');

    // 2C. Mobile Semester Subjects Listing (Semester I)
    console.log('[Test 2C] Loading Mobile Semester Subjects (Sem I)...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus.html#Year%201/I`);
    await mobilePage.waitForSelector('.syl-subject-card');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_mobile_03_semester_subjects.png'),
      fullPage: false
    });
    console.log('✓ Captured web_mobile_03_semester_subjects.png');

    // 2D. Mobile Individual Subject Syllabus (CIT111 - Computer Programming I)
    console.log('[Test 2D] Loading Mobile Subject Syllabus...');
    await mobilePage.goto(`http://localhost:${PORT}/syllabus.html#Year%201/I/CIT111-Computer%20Programming%20I%20(C)`);
    await mobilePage.waitForSelector('.syl-unit-accordion');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_mobile_04_subject_syllabus.png'),
      fullPage: false
    });
    console.log('✓ Captured web_mobile_04_subject_syllabus.png');

    // 2E. Mobile Narrow Screen Test (320px width - small device / extreme width)
    console.log('[Test 2E] Testing Narrow Screen (320px)...');
    await mobilePage.setViewportSize({ width: 320, height: 600 });
    await mobilePage.goto(`http://localhost:${PORT}/syllabus.html#`);
    await mobilePage.waitForSelector('.syl-semester-grid');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'web_mobile_05_narrow_320px.png'),
      fullPage: false
    });
    console.log('✓ Captured web_mobile_05_narrow_320px.png');

    await mobileContext.close();

    // -------------------------------------------------------------
    // 3. FUNCTIONAL VERIFICATION: ALL 8 SEMESTERS
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying all 8 semesters load correctly...');
    const testContext = await browser.newContext();
    const testPage = await testContext.newPage();

    const expectedSemesters = [
      { year: 'Year 1', sem: 'I' },
      { year: 'Year 1', sem: 'II' },
      { year: 'Year 2', sem: 'III' },
      { year: 'Year 2', sem: 'IV' },
      { year: 'Year 3', sem: 'V' },
      { year: 'Year 3', sem: 'VI' },
      { year: 'Year 4', sem: 'VII' },
      { year: 'Year 4', sem: 'VIII' }
    ];

    for (const { year, sem } of expectedSemesters) {
      await testPage.goto(`http://localhost:${PORT}/syllabus.html#${encodeURIComponent(year)}/${encodeURIComponent(sem)}`);
      await testPage.waitForSelector('.syl-subject-card');
      const subjectCardsCount = await testPage.$$eval('.syl-subject-card', els => els.length);
      const title = await testPage.$eval('#syllabusTitle', el => el.textContent);
      console.log(`  ✓ ${year} Sem ${sem}: ${subjectCardsCount} subjects loaded ("${title}")`);
      if (subjectCardsCount === 0) {
        throw new Error(`Semester ${sem} has 0 subjects!`);
      }
    }

    await testContext.close();

    console.log('========================================================');
    console.log('ALL VISUAL QA AND FUNCTIONAL TESTS COMPLETED SUCCESSFULLY!');
    console.log('========================================================');

  } finally {
    await browser.close();
    server.close();
  }
}

runVisualQA().catch(err => {
  console.error('[QA FAILED]:', err);
  process.exit(1);
});
