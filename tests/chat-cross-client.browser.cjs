// Run with npm run test:group-chat:browser (requires Google Chrome).
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.CHAT_PLAYWRIGHT_MODULE || 'playwright');
const app = require('../server');
const db = require('../db');
const bcrypt = require('bcryptjs');
(async () => {
  await db.initSchema();
  for (const id of ['chat_web_fixture', 'chat_app_fixture']) {
    await db.run('INSERT INTO students (studentId,name,passwordHash,role) VALUES (?,?,?,?)', id, id, bcrypt.hashSync('fixture-password', 4), 'student');
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const files = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/chat/config', route => route.fulfill({ json: {} }));
    const login = await page.request.post(`${base}/api/login`, { data: { studentId: 'chat_web_fixture', password: 'fixture-password' } });
    assert.equal(login.status(), 200);
    const mobileLogin = await fetch(`${base}/api/mobile/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'chat_app_fixture', password: 'fixture-password' }) });
    const { token } = await mobileLogin.json();
    const headers = { Authorization: `Bearer ${token}` };
    await page.goto(`${base}/chat.html`);
    await page.waitForFunction(() => document.getElementById('emptyNotice'));
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/chat-photo.png'));
    for (const fixture of [
      { name: 'app-photo.png', mime: 'image/png', bytes: png },
      { name: 'app-notes.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n%%EOF') },
    ]) {
      const body = new FormData();
      body.append('attachment', new Blob([fixture.bytes], { type: fixture.mime }), fixture.name);
      const response = await fetch(`${base}/api/chat/messages`, { method: 'POST', headers, body });
      assert.equal(response.status, 200);
      const { data } = await response.json();
      files.push(data.attachmentName);
      const row = page.locator(`#msg-row-${data.id}`);
      await row.waitFor({ timeout: 8000 });
      if (fixture.mime === 'image/png') {
        await row.locator('.im-media-box img').waitFor();
        await page.waitForFunction(id => { const image = document.querySelector(`#msg-row-${id} .im-media-box img`); return image?.complete && image.naturalWidth >= 320 && image.getBoundingClientRect().width > 100 && image.getBoundingClientRect().height > 50; }, data.id);
      }
      await row.hover();
      await row.locator('.msg-reply-btn').click();
      await page.locator('#chatTextarea').fill(`Reply to ${fixture.name}`);
      await page.locator('#sendBtn').click();
      await page.waitForFunction(text => document.body.innerText.includes(text), `Reply to ${fixture.name}`);
      await row.hover();
      await row.locator('.msg-reaction-btn').click();
      await row.locator('.emoji-picker-popup').getByText('👍', { exact: true }).click();
      await page.waitForFunction(id => document.querySelector(`#reactions-${id}`)?.textContent.includes('👍'), data.id);
      const history = await (await fetch(`${base}/api/chat/messages?before=2147483647&limit=40`, { headers })).json();
      assert.ok(history.messages.some(m => m.replyToId === data.id && m.text === `Reply to ${fixture.name}`));
      assert.equal(history.messages.find(m => m.id === data.id).reactions[0].emoji, '👍');
      // App reactions must reach existing website rows even with Supabase disabled.
      const reaction = await fetch(`${base}/api/chat/reactions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: data.id, emoji: '❤️' }) });
      assert.equal(reaction.status, 200);
      await page.waitForFunction(id => document.querySelector(`#reactions-${id}`)?.textContent.includes('❤️'), data.id, { timeout: 8000 });
      await fetch(`${base}/api/chat/messages/${data.id}`, { method: 'DELETE', headers });
      await row.waitFor({ state: 'detached', timeout: 8000 });

    }
    await page.locator('#hiddenFileInput').setInputFiles({ name: 'website-photo.png', mimeType: 'image/png', buffer: png });
    await page.locator('#chatTextarea').fill('Photo from website');
    const sentPromise = page.waitForResponse(response => response.url().endsWith('/api/chat/messages') && response.request().method() === 'POST');
    await page.locator('#sendBtn').click();
    const sent = await (await sentPromise).json();
    files.push(sent.data.attachmentName);
    const appImage = await fetch(`${base}/api/chat/attachment/${sent.data.attachmentName}`, { headers });
    assert.deepEqual(Buffer.from(await appImage.arrayBuffer()), png);
    await page.reload();
    await page.locator(`#msg-row-${sent.data.id}`).waitFor();
    await page.evaluate(() => handleChatSearch('website-photo.png'));
    assert.match(await page.locator('#searchMatchesCount').textContent(), /1 of 1/);
    await page.screenshot({ path: process.env.CHAT_SCREENSHOT_PATH || '/tmp/chat-cross-client-audit.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: real app-auth photo/file uploads appear in website without reload; website attachment replies/reactions reach app history; app reactions/deletions update existing website rows; website photos download with app auth and survive reload.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    files.forEach(file => fs.rmSync(path.join(__dirname, '../uploads', file), { force: true }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
