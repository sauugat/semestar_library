const { chromium } = require('playwright');
const express = require('express');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const app = express();
  let feedRequests = 0, likeRequests = 0;
  const posts = [
    { id: 3, type: 'status', name: 'Asha', content: 'Tall portrait caption', user_id: 'student', studentId: 'student', created_at: '2026-10-08T10:00:00Z', attachment_url: '/test-portrait.svg', like_count: 0, comment_count: 2, liked_by_me: false },
    { id: 2, type: 'status', name: 'Mina', content: 'Landscape caption', user_id: 'student', studentId: 'student', created_at: '2026-10-07T10:00:00Z', attachment_url: '/test-landscape.svg', like_count: 0, comment_count: 0 },
    { id: 1, type: 'status', name: 'Sita', content: 'Album caption', user_id: 'student', studentId: 'student', created_at: '2026-10-06T10:00:00Z', media: [{ url: '/test-portrait.svg', media_type: 'image' }, { url: '/test-landscape.svg', media_type: 'image' }], like_count: 0, comment_count: 0 },
  ];
  app.get('/auth.js', (_, res) => res.type('js').send('window.SemesterAuth = {protectPage(){}, signOut(){}};'));
  app.get(['/notifications.js', '/academic-context.js', '/chatbot.js'], (_, res) => res.type('js').send(''));
  app.get('/api/posts', (_, res) => { feedRequests++; res.json({ posts, nextCursor: null }); });
  app.post('/api/posts/:id/like', (req, res) => { likeRequests++; const p = posts.find(p => p.id === Number(req.params.id)); p.liked_by_me = true; p.like_count = 1; res.json({ liked_by_me: true, like_count: 1 }); });
  app.delete('/api/posts/:id/like', (req, res) => { likeRequests++; const p = posts.find(p => p.id === Number(req.params.id)); p.liked_by_me = false; p.like_count = 0; res.json({ liked_by_me: false, like_count: 0 }); });
  app.get('/api/code-lab/assignments', (_, res) => res.json([{ id: 7, title: 'Semester assignment', teacherName: 'Teacher', createdBy: 'teacher', createdAt: '2026-10-08T09:00:00Z', questionCount: 2, semester: '2' }]));
  app.get(['/api/me', '/api/profile'], (_, res) => res.json({ name: 'Test Student', studentId: 'student', role: 'student' }));
  app.get('/api/files', (_, res) => res.json([]));
  app.get('/test-:kind.svg', (req, res) => { const h = req.params.kind === 'portrait' ? 1600 : 400; res.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${h}" viewBox="0 0 800 ${h}"><rect width="800" height="${h}" fill="#456785"/><circle cx="400" cy="200" r="150" fill="#e0b88e"/></svg>`); });
  app.use('/api', (_, res) => res.json([]));
  app.use(express.static(path.join(__dirname, '../public')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html`);
    await page.locator('[data-post-id="3"] img[role="button"]').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.post-single-image img')].every(i => i.complete && i.naturalWidth > 0));
    const ratios = await page.locator('.post-single-image').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return r.width / r.height; }));
    assert(Math.abs(ratios[0] - .8) < .02, `Portrait ratio: ${ratios[0]}`);
    assert(Math.abs(ratios[1] - 2) < .02, `Landscape ratio: ${ratios[1]}`);
    assert.equal(await page.locator('[data-assignment-id="7"] a.file-action').innerText(), 'Do assignment');
    assert.equal(await page.locator('#feedEndMessage').innerText(), 'You reached Bedrock :)');
    const portrait = page.locator('[data-post-id="3"] .post-image img');
    await portrait.dblclick({ delay: 70 });
    await page.waitForTimeout(350);
    assert.equal(likeRequests, 1);
    assert(await page.locator('#imageLightbox').evaluate(el => el.classList.contains('hidden')));
    assert.equal(await page.locator('[data-post-id="3"] .like-btn').getAttribute('aria-pressed'), 'true');
    await portrait.click();
    await page.locator('#imageLightbox:not(.hidden)').waitFor();
    assert((await page.locator('#lightboxDetails').innerText()).includes('Tall portrait caption'));
    await page.locator('#lightboxStage').dblclick({ delay: 70 });
    await page.waitForTimeout(300);
    assert(await page.locator('#lightboxImg').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a > 2));
    await page.locator('#lightboxStage').dblclick({ delay: 70 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lightboxImg').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a), 1);
    await page.locator('#lightboxDetails button').first().click();
    assert.equal(await page.locator('[data-post-id="3"] .like-btn').getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    await page.locator('[data-post-id="1"] .post-image img').first().click();
    await page.locator('#imageLightbox:not(.hidden)').waitFor();
    await page.locator('#lightboxNext').click();
    assert.equal(await page.locator('#lightboxCounter').innerText(), '2 / 2');
    // Two-finger pinch starts after the first pointer, as on a real touchscreen.
    await page.locator('#lightboxStage').evaluate(el => {
      el.setPointerCapture = () => {};
      for (const [type, id, x] of [['pointerdown', 1, 400], ['pointerdown', 2, 600], ['pointermove', 1, 250], ['pointermove', 2, 750]]) el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: 300, bubbles: true }));
    });
    assert(await page.locator('#lightboxImg').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a > 2));
    await page.screenshot({ path: '/tmp/semester-feed-viewer.png' });
    await page.keyboard.press('Escape');
    const beforeRefresh = feedRequests;
    posts[0].content = 'Refreshed caption';
    await page.locator('.lib-wordmark').click();
    await page.waitForFunction(() => scrollY === 0);
    assert(feedRequests > beforeRefresh);
    await page.locator('[data-post-id="3"] .status-post-text').filter({ hasText: 'Refreshed caption' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await portrait.click();
    await page.locator('#imageLightbox:not(.hidden)').waitFor();
    await page.screenshot({ path: '/tmp/semester-feed-mobile-viewer.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: photo proportions, double-tap likes, zoom/reset/pinch, albums, captions/reactions, assignment action, Bedrock, Home refresh; desktop and mobile layouts.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
