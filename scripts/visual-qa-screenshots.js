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
      id: 101,
      type: 'notice',
      category: 'notice',
      category_label: 'Notice',
      is_official: true,
      name: 'University Administration',
      studentId: 'admin_official',
      role: 'admin',
      title: 'Examination Routine Published',
      content: 'The final examination routine for all semesters has been officially published. Check the notice board for details.',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      target_all_semesters: 1,
      allSemesters: true,
      targetSemesters: [],
      visibility: 'everyone',
      like_count: 14,
      comment_count: 2,
      liked_by_me: false
    },
    {
      id: 102,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Saugat Subedi',
      studentId: 'student_s1',
      role: 'student',
      title: null,
      content: 'Can someone explain today\'s assignment? Let\'s discuss before tomorrow morning.',
      created_at: new Date(Date.now() - 1800000).toISOString(),
      target_all_semesters: 0,
      allSemesters: false,
      targetSemesters: [1],
      visibility: 'students_only',
      audience: 'students_only',
      like_count: 4,
      comment_count: 1,
      liked_by_me: true
    },
    {
      id: 103,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Alice Henderson',
      studentId: 'student_s2',
      role: 'student',
      title: null,
      content: 'Does anyone have the Mathematics 1 lecture notes from yesterday?',
      created_at: new Date(Date.now() - 900000).toISOString(),
      target_all_semesters: 0,
      allSemesters: false,
      targetSemesters: [1],
      visibility: 'everyone',
      like_count: 2,
      comment_count: 0,
      liked_by_me: false
    }
  ];

  app.get('/auth.js', (_, res) => res.type('js').send('window.SemesterAuth = {protectPage(){}, signOut(){}};'));
  app.get(['/notifications.js', '/academic-context.js', '/chatbot.js'], (_, res) => res.type('js').send(''));
  app.get('/api/me', (_, res) => res.json({
    name: 'Saugat Subedi',
    studentId: 'STUDENT_001',
    role: 'student',
    isAdmin: false,
    isCR: false,
    semester: 'Semester 1'
  }));
  app.get('/api/profile', (_, res) => res.json({ name: 'Saugat Subedi', avatarUrl: null }));
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
  app.get('/api/posts', (_, res) => res.json({ posts: samplePosts, nextCursor: null }));
  app.get('/api/code-lab/assignments', (_, res) => res.json([]));
  app.get(['/create-post', '/create-post.html'], (_, res) => {
    res.sendFile(path.join(__dirname, '../public/create-post.html'));
  });
  app.use(express.static(path.join(__dirname, '../public')));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  console.log(`Server listening on port ${port}`);

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
  const page = await context.newPage();

  // Test dark mode
  await page.goto(`http://127.0.0.1:${port}/dashboard.html`);
  await page.waitForLoadState('networkidle');

  // Ensure dark theme is active
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark-mode');
  });

  // 1. Screenshot Feed presentation
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'web_feed_presentation.png') });
  console.log('Saved web_feed_presentation.png');

  // Open Create Post modal
  await page.click('#openPostModalBtn');
  await page.waitForSelector('#postModalOverlay.open');
  await page.waitForTimeout(300);

  // 2. Screenshot Composer in General mode (Title field hidden, Audience visible)
  await page.screenshot({ path: path.join(screenshotsDir, 'web_composer_general.png') });
  console.log('Saved web_composer_general.png');

  // 3. Open Category dropdown
  await page.click('#composerCategoryBtn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotsDir, 'web_category_dropdown.png') });
  console.log('Saved web_category_dropdown.png');

  // Select Announcement to show Title field
  const annOption = await page.locator('#composerCategoryMenu button[data-value="announcement"]');
  await annOption.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotsDir, 'web_composer_announcement.png') });
  console.log('Saved web_composer_announcement.png');

  // 4. Open Audience dropdown
  await page.click('#composerAudienceBtn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotsDir, 'web_audience_dropdown.png') });
  console.log('Saved web_audience_dropdown.png');

  // Select Students Only
  const soOption = await page.locator('#composerAudienceMenu button[data-value="students_only"]');
  await soOption.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotsDir, 'web_composer_students_only.png') });
  console.log('Saved web_composer_students_only.png');

  // --- Dedicated /create-post page Visual QA ---
  await page.goto(`http://127.0.0.1:${port}/create-post`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark-mode');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, 'dedicated_create_post_page.png') });
  console.log('Saved dedicated_create_post_page.png');

  // Switch category on full page to Announcement
  await page.click('#categoryBtn');
  await page.waitForTimeout(200);
  await page.click('#categoryMenu button[data-value="announcement"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(screenshotsDir, 'dedicated_create_post_announcement.png') });
  console.log('Saved dedicated_create_post_announcement.png');

  await browser.close();
  await new Promise(r => server.close(r));
  console.log('Visual QA completed successfully.');
})();
