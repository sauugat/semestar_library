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

  app.post('/api/posts', express.urlencoded({ extended: true }), (req, res) => {
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

  // Test 2: Verify /create-post Direct WYSIWYG Editor
  await page.goto(`http://127.0.0.1:${port}/create-post`);
  await page.waitForSelector('#postEditor', { timeout: 8000 });

  // Verify preview tab is removed
  const previewTab = await page.$('#tabPreviewBtn');
  console.log('Preview tab absent:', previewTab === null);

  // Focus editor
  await page.click('#postEditor');

  // Click bold button BEFORE typing
  const boldBtn = page.locator('.md-tool-btn[data-format="bold"]');
  await boldBtn.click();
  const isBoldActiveBefore = await boldBtn.evaluate(el => el.classList.contains('active'));
  console.log('Bold button active after click:', isBoldActiveBefore);

  // Type in bold
  await page.keyboard.type('Direct Bold Heading');

  // Click bold button again to toggle OFF
  await boldBtn.click();
  const isBoldActiveAfter = await boldBtn.evaluate(el => el.classList.contains('active'));
  console.log('Bold button active after toggle off:', isBoldActiveAfter);

  // Type normal text
  await page.keyboard.press('Enter');
  await page.keyboard.type('This line is normal text without bold. ');

  // Test selecting written text and formatting
  await page.keyboard.type('Selectable text');
  // Select the last 15 characters
  for (let i = 0; i < 15; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
  }

  // Click italic
  const italicBtn = page.locator('.md-tool-btn[data-format="italic"]');
  await italicBtn.click();

  // Deselect by pressing ArrowRight
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  // Insert bullet list
  await page.locator('.md-tool-btn[data-format="bullet-list"]').click();
  await page.keyboard.type('First bullet point');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second bullet point');

  // Check HTML and serialized Markdown
  const editorHtml = await page.evaluate(() => document.getElementById('postEditor').innerHTML);
  const markdownValue = await page.evaluate(() => document.getElementById('postContent').value);
  console.log('Editor innerHTML snippet:', editorHtml.slice(0, 120));
  console.log('Markdown synced snippet:', markdownValue.slice(0, 120));

  await page.screenshot({ path: `${screenshotsDir}/composer_wysiwyg_direct.png` });
  console.log('✓ Captured composer_wysiwyg_direct.png');

  await browser.close();
  server.close();
  console.log('Visual verification complete!');
})();
