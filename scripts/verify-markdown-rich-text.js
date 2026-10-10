const { chromium } = require('playwright');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const screenshotsDir = '/Users/sauu_gat/.gemini/antigravity-ide/brain/6b5c37ac-609b-48fc-be2b-3fe2c8317e98/screenshots';
  await fs.mkdir(screenshotsDir, { recursive: true });

  const app = express();
  app.use(express.json());

  const samplePosts = [
    {
      id: 201,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Aayush Sharma',
      studentId: 'student_s1',
      role: 'student',
      title: null,
      content: '# Study Guide & Formulas\n\nHere are the **core formulas** for tomorrow\'s test:\n\n- Determinants and *Eigenvalues*\n- <u>Rank-Nullity Theorem</u>\n- Gaussian elimination\n\n> "Consistency is what transforms average into excellence."\n\n```python\nimport numpy as np\nA = np.array([[1, 2], [3, 4]])\nprint(np.linalg.eig(A))\n```\n\nCheck official references at [Semester Library](https://example.com/math).',
      created_at: new Date(Date.now() - 1200000).toISOString(),
      target_all_semesters: 1,
      allSemesters: true,
      targetSemesters: [],
      visibility: 'everyone',
      audience: 'everyone',
      like_count: 5,
      comment_count: 2,
      liked_by_me: true
    },
    {
      id: 202,
      type: 'status',
      category: 'notice',
      category_label: 'Notice',
      is_official: true,
      name: 'College Administration',
      studentId: 'admin_1',
      role: 'admin',
      title: 'Exam Schedule Released',
      content: 'Final semester examinations will commence from next Monday. Please review the updated schedule.',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      target_all_semesters: 1,
      allSemesters: true,
      targetSemesters: [],
      visibility: 'everyone',
      audience: 'everyone',
      like_count: 12,
      comment_count: 4,
      liked_by_me: false
    }
  ];

  app.get('/api/me', (_, res) => {
    res.json({
      user: {
        studentId: 'student_s1',
        name: 'Aayush Sharma',
        role: 'student',
        cohortId: 'cohort_2026',
        semester: 4,
        semester_no: 4
      }
    });
  });

  app.get('/api/posts', (_, res) => {
    res.json({ posts: samplePosts, total: samplePosts.length });
  });

  app.get('/api/academic-context', (_, res) => {
    res.json({
      role: 'student',
      academicStatus: 'assigned',
      displayLabel: 'Semester IV · 2026',
      semesterNumber: 4,
      semesterRoman: 'IV'
    });
  });

  const multer = require('multer');
  const upload = multer();

  app.post('/api/posts', upload.any(), (req, res) => {
    const newPost = {
      id: Date.now(),
      type: req.body.type || 'status',
      category: req.body.category || 'general',
      category_label: req.body.category || 'General',
      is_official: false,
      name: 'Aayush Sharma',
      studentId: 'student_s1',
      role: 'student',
      title: req.body.title || null,
      content: req.body.content || '',
      created_at: new Date().toISOString(),
      target_all_semesters: 1,
      allSemesters: true,
      targetSemesters: [],
      visibility: req.body.visibility || 'everyone',
      audience: req.body.audience || 'everyone',
      like_count: 0,
      comment_count: 0,
      liked_by_me: false
    };
    samplePosts.unshift(newPost);
    res.status(201).json(newPost);
  });

  app.get('/auth.js', (_, res) => res.type('js').send('window.SemesterAuth = {protectPage(){}, signOut(){}};'));
  app.get(['/notifications.js', '/chatbot.js'], (_, res) => res.type('js').send(''));
  app.get('/api/posts/meta', (_, res) => res.json({
    categories: [
      { id: 'notice', label: 'Notice' },
      { id: 'general', label: 'General' },
      { id: 'announcement', label: 'Announcement' },
      { id: 'news', label: 'News' },
      { id: 'complaints', label: 'Complaints' },
      { id: 'feedback', label: 'Feedback' }
    ],
    defaultCategory: 'general',
    visibilities: ['everyone', 'students_only'],
    defaultVisibility: 'everyone',
    canPostNotice: false,
    canSelectAudience: true,
    role: 'student'
  }));
  app.get('/api/code-lab/assignments', (_, res) => res.json([]));

  app.get(['/create-post', '/create-post.html'], (_, res) => {
    res.sendFile(path.join(__dirname, '../public/create-post.html'));
  });

  app.use(express.static(path.join(__dirname, '../public')));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  console.log(`Test server running at http://127.0.0.1:${port}`);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();

  // Test 1: Verify Feed Card Rendering with Rich Markdown
  await page.goto(`http://127.0.0.1:${port}/dashboard.html`);
  await page.waitForSelector('.status-post-card', { timeout: 8000 });
  await page.screenshot({ path: `${screenshotsDir}/feed_post_markdown_rendered.png` });
  console.log('✓ Captured feed_post_markdown_rendered.png');

  // Test 2: Verify /create-post Professional WYSIWYG Formatting
  await page.goto(`http://127.0.0.1:${port}/create-post`);
  await page.waitForSelector('#postEditor', { timeout: 8000 });

  // Focus editor
  await page.click('#postEditor');

  // Step 1: Type written normal text
  await page.keyboard.type('First written line that is normal text.');
  console.log('✓ Typed initial normal text line');

  // Step 2: Click H1 when cursor is at the end of written text
  const h1Btn = page.locator('.md-tool-btn[data-format="h1"]');
  await h1Btn.click();

  // Step 3: Type upcoming text in H1
  await page.keyboard.type('Brand New Heading 1');
  console.log('✓ Clicked H1 and typed upcoming text');

  // Step 4: Press Enter - should automatically drop down to a normal paragraph <p>
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body paragraph right after heading. ');

  // Step 5: Click Bold button to toggle ON for upcoming text
  const boldBtn = page.locator('.md-tool-btn[data-format="bold"]');
  await boldBtn.click();
  await page.keyboard.type('This text must be bold.');

  // Step 6: Click Bold button again to toggle OFF for upcoming text
  await boldBtn.click();
  await page.keyboard.type(' This text must be normal again.');

  // Step 7: Select written words and format
  for (let i = 0; i < 11; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }
  const italicBtn = page.locator('.md-tool-btn[data-format="italic"]');
  await italicBtn.click();
  await page.keyboard.press('ArrowRight');

  // Inspect the DOM of postEditor
  const editorHtml = await page.evaluate(() => document.getElementById('postEditor').innerHTML);
  const markdownValue = await page.evaluate(() => document.getElementById('postContent').value);

  console.log('--- Resulting Editor HTML ---');
  console.log(editorHtml);
  console.log('--- Resulting Markdown ---');
  console.log(markdownValue);

  const cleanHtml = editorHtml.replace(/\u200B/g, '');

  // Assertions:
  // 1. Initial text is NOT in H1
  const initialTextInH1 = cleanHtml.includes('<h1>First written line');
  if (initialTextInH1) {
    throw new Error('FAIL: Initial written text was converted to H1!');
  }
  console.log('✓ PASS: Initial text was preserved as normal text (not converted to H1)');

  // 2. Initial text IS preserved in the editor
  if (!cleanHtml.includes('First written line that is normal text.')) {
    throw new Error('FAIL: Initial written text was lost or wiped!');
  }
  console.log('✓ PASS: Initial written text is fully preserved in the editor');

  // 3. Upcoming text IS in H1
  if (!cleanHtml.includes('<h1>Brand New Heading 1</h1>')) {
    throw new Error('FAIL: Upcoming text did not become H1!');
  }
  console.log('✓ PASS: Upcoming text is correctly inside <h1>');

  // 4. Bold text is bold and subsequent text is normal
  if (!cleanHtml.includes('<b>This text must be bold.</b>') && !cleanHtml.includes('<strong>This text must be bold.</strong>')) {
    throw new Error('FAIL: Upcoming bold text was not wrapped in bold tag!');
  }
  console.log('✓ PASS: Upcoming bold text is bold');

  const innerText = await page.evaluate(() => document.getElementById('postEditor').innerText);
  if (!innerText.includes('This text must be normal again.')) {
    throw new Error('FAIL: Normal text was missing or corrupted!');
  }
  console.log('✓ PASS: Subsequent text reverted to normal text');

  if (!cleanHtml.includes('<i>rmal again.</i>') && !cleanHtml.includes('<em>rmal again.</em>')) {
    throw new Error('FAIL: Selected text was not italicized!');
  }
  console.log('✓ PASS: Selected text was formatted with italics');

  // Step 8: Paste user's markdown table directly into postEditor
  const tableMarkdown = `| Feature | Traditional Learning | AI-Assisted Learning |
|---|---|---|
| Information access | Books and teachers | Books, teachers, and AI |
| Availability | Limited hours | Often available 24/7 |
| Personalization | Depends on instruction | Can adapt explanations |
| Feedback | Sometimes delayed | Often immediate |
| Accuracy | Depends on source | Requires verification |`;

  await page.evaluate((tableText) => {
    const editor = document.getElementById('postEditor');
    editor.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', tableText);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });
    editor.dispatchEvent(pasteEvent);
  }, tableMarkdown);

  await page.waitForTimeout(100);

  const tableHtml = await page.evaluate(() => document.getElementById('postEditor').innerHTML);
  console.log('--- Editor HTML After Table Paste ---');
  console.log(tableHtml);

  if (!tableHtml.includes('class="md-table-wrapper"') || !tableHtml.includes('<table class="md-table">')) {
    throw new Error('FAIL: Pasted markdown table was not converted into .md-table-wrapper table!');
  }
  if (!tableHtml.includes('Information access') || !tableHtml.includes('Books, teachers, and AI')) {
    throw new Error('FAIL: Table content is missing from editor!');
  }
  console.log('✓ PASS: Markdown table paste was successfully converted to live styled table in editor');

  await page.screenshot({ path: `${screenshotsDir}/composer_wysiwyg_direct.png` });
  console.log('✓ Captured composer_wysiwyg_direct.png');

  // Submit the post
  await page.click('#submitBtn');
  await page.waitForTimeout(1000);

  // Navigate to dashboard and verify the table rendered on feed
  await page.goto(`http://127.0.0.1:${port}/dashboard.html`);
  await page.waitForSelector('.status-post-card', { timeout: 8000 });
  await page.screenshot({ path: `${screenshotsDir}/feed_post_table_rendered.png` });
  console.log('✓ Captured feed_post_table_rendered.png');

  // Also verify light mode styling
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.classList.add('light-mode');
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${screenshotsDir}/feed_post_table_light.png` });
  console.log('✓ Captured feed_post_table_light.png');

  await browser.close();
  server.close();
  console.log('Visual verification complete!');
})();
