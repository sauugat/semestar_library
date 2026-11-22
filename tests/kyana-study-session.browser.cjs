// Run from your terminal (requires Google Chrome):
//   node tests/kyana-study-session.browser.cjs
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'scratch', 'kyana-e2e-screenshots');
const DB_PATH = '/tmp/kyana-browser-e2e.db';
const PORT = 3125;
const BASE_URL = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/library.html`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`QA server did not start on ${BASE_URL}`);
}

async function openDiscreteMathUnit1(page) {
  await page.waitForSelector('.course-card-minimal', { timeout: 15000 });
  const card = page.locator('.course-card-minimal', { hasText: /Discrete Mathematics/i }).first();
  if ((await card.count()) === 0) {
    const sem2 = page.locator('button', { hasText: /^Sem(ester)?\s*2$/i }).first();
    if ((await sem2.count()) > 0) {
      await sem2.click();
      await page.waitForTimeout(300);
    }
  }
  await card.click();
  await page.waitForSelector('#drawerOverlay .ask-kyana-chapter-btn', { timeout: 10000 });
  await page.locator('#drawerOverlay .ask-kyana-chapter-btn').first().click();
  await page.waitForSelector('#chapterKyanaChatView', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
}

(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${DB_PATH}${suffix}`); } catch (_) {}
  }

  const serverProc = spawn(process.execPath, ['scripts/qa-server.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let browser = null;
  const consoleErrors = [];
  const failedRequests = [];
  let continueCalls = 0;

  try {
    await waitForServer();
    browser = await chromium.launch({ channel: 'chrome', headless: true });

    // --- DESKTOP (1440 x 900) ---
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopCtx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('response', (r) => {
      if (r.url().startsWith(BASE_URL) && r.status() >= 400) {
        failedRequests.push(`${r.request().method()} ${r.url()} -> ${r.status()}`);
      }
      if (r.url().includes('/api/ai/actions') && r.request().method() === 'POST') {
        try {
          if (r.request().postDataJSON()?.action === 'continue_lesson') continueCalls++;
        } catch (_) {}
      }
    });

    const login = await page.request.post(`${BASE_URL}/api/login`, {
      data: { studentId: 'qa_student', password: 'QaStudent123!' }
    });
    assert.equal(login.status(), 200);

    await page.goto(`${BASE_URL}/library.html`, { waitUntil: 'domcontentloaded' });
    await openDiscreteMathUnit1(page);

    // 1. Start chapter teaching session
    await page.locator('#chapterKyanaTeachBtn').click();
    const mcqCard = page.locator('#chapterKyanaMessages .kyana-mcq-card').last();
    await mcqCard.waitFor({ state: 'visible', timeout: 15000 });

    const visibleText = await page.locator('#chapterKyanaMessages').innerText();
    assert.ok(!/STUDY_SESSION|"progressPercentage"|"checklist"\s*:/i.test(visibleText), 'No raw STUDY_SESSION JSON may leak');

    // 2. Select incorrect option A and submit
    await mcqCard.locator('.kyana-mcq-option', { hasText: /Go to your room!/i }).click();
    await mcqCard.locator('.kyana-mcq-check-btn').click();
    await mcqCard.locator('.kyana-mcq-hint').waitFor({ state: 'visible', timeout: 10000 });
    await mcqCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-quiz-incorrect.png') });

    // 3. Retry with correct option C ("2 + 2 = 5") and submit
    await mcqCard.locator('.kyana-mcq-option', { hasText: /2 \+ 2 = 5/ }).click();
    await mcqCard.locator('.kyana-mcq-check-btn').click();
    const continueBtn = mcqCard.locator('.kyana-mcq-continue-btn');
    await continueBtn.waitFor({ state: 'visible', timeout: 10000 });
    await mcqCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-quiz-correct.png') });

    // 4. Click Continue to Next Topic and verify single load
    const callsBefore = continueCalls;
    await continueBtn.click();
    await page.waitForTimeout(1000);
    assert.equal(continueCalls - callsBefore, 1, 'Continue to Next Topic must fire exactly once');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-step2.png') });

    // 5. Refresh and verify session restoration
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openDiscreteMathUnit1(page);
    await page.waitForTimeout(800);
    assert.ok((await page.locator('#chapterKyanaMessages .kyana-mcq-card').count()) >= 1, 'Restored session must render MCQ');

    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(desktopOverflow <= 2, `Desktop horizontal overflow detected: ${desktopOverflow}px`);
    await desktopCtx.close();

    // --- MOBILE (390 x 844) ---
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mPage = await mobileCtx.newPage();
    const mLogin = await mPage.request.post(`${BASE_URL}/api/login`, {
      data: { studentId: 'qa_student', password: 'QaStudent123!' }
    });
    assert.equal(mLogin.status(), 200);
    await mPage.goto(`${BASE_URL}/library.html`, { waitUntil: 'domcontentloaded' });
    await openDiscreteMathUnit1(mPage);
    await mPage.waitForTimeout(800);
    const mCard = mPage.locator('#chapterKyanaMessages .kyana-mcq-card').last();
    await mCard.scrollIntoViewIfNeeded();
    await mPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'mobile-quiz.png') });
    const mobileOverflow = await mPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(mobileOverflow <= 2, `Mobile horizontal overflow detected: ${mobileOverflow}px`);
    await mobileCtx.close();

    assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join('; ')}`);
    assert.deepEqual(failedRequests, [], `Failed requests: ${failedRequests.join('; ')}`);
    console.log('PASS: Desktop (1440x900) and Mobile (390x844) Kyana Study Session & Quiz E2E verified. Screenshots saved to', SCREENSHOT_DIR);
  } finally {
    if (browser) await browser.close();
    serverProc.kill('SIGTERM');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${DB_PATH}${suffix}`); } catch (_) {}
    }
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
