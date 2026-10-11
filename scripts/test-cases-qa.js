const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
  const screenshotsDir = '/Users/sauu_gat/.gemini/antigravity-ide/brain/6b5c37ac-609b-48fc-be2b-3fe2c8317e98/screenshots';
  await fs.mkdir(screenshotsDir, { recursive: true });

  const app = express();
  app.use(express.json());

  // Test Posts A through L
  const testPosts = [
    // A. One-line General post
    {
      id: 301,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Rohan Shrestha',
      studentId: 'student_r1',
      role: 'student',
      title: null,
      content: 'Heading to the campus library now for group study.',
      created_at: new Date(Date.now() - 300000).toISOString(),
      visibility: 'everyone',
      like_count: 3,
      comment_count: 0,
      liked_by_me: false
    },
    // B. Three-line General post
    {
      id: 302,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Pooja Thapa',
      studentId: 'student_p1',
      role: 'student',
      title: null,
      content: 'Line one: Reviewing Chapter 4 Data Structures.\nLine two: Trees and Binary Search Algorithms.\nLine three: Practice problems completed.',
      created_at: new Date(Date.now() - 600000).toISOString(),
      visibility: 'everyone',
      like_count: 5,
      comment_count: 1,
      liked_by_me: true
    },
    // C. Long article with H1, H2, H3
    {
      id: 303,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Prof. Ram Prasad',
      studentId: 'teacher_t1',
      role: 'teacher',
      title: 'Advanced Computer Architecture Overview',
      content: '# The Future of Computer Architecture\n\nModern hardware is shifting rapidly towards specialized accelerators and energy-efficient designs.\n\n## Memory Hierarchy and Caches\n\nL1, L2, and L3 caches bridge the speed gap between high-speed processors and slower DRAM.\n\n### Vector Execution & SIMD\n\nParallel SIMD units execute single instructions across multiple data elements simultaneously.\n\nUnderstanding these foundations is critical for systems programming and distributed systems performance.',
      created_at: new Date(Date.now() - 900000).toISOString(),
      visibility: 'everyone',
      like_count: 18,
      comment_count: 4,
      liked_by_me: false
    },
    // D. Official Notice with multiple paragraphs
    {
      id: 304,
      type: 'notice',
      category: 'notice',
      category_label: 'Notice',
      is_official: true,
      name: 'Gandaki University Administration',
      studentId: 'admin_official',
      role: 'admin',
      title: 'Resumption of Regular Classes',
      content: 'Date: 9 October 2026\nSubject: Resumption of Regular Classes\n\nThis is to inform all BIT students that regular academic classes will resume following the Dashain vacation as per the updated academic schedule.\n\nAll students are requested to attend their respective classes regularly and follow the timetable provided by the department.\n\nStudents are also advised to check the official notice board and Semester Library platform for further academic updates.\n\nYour cooperation and punctuality are highly appreciated.\n\nBIT Department\nGandaki University',
      created_at: new Date(Date.now() - 1200000).toISOString(),
      visibility: 'everyone',
      like_count: 42,
      comment_count: 8,
      liked_by_me: true
    },
    // E. Post containing only an image
    {
      id: 305,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Bikash Gurung',
      studentId: 'student_b1',
      role: 'student',
      title: null,
      content: '',
      attachment_url: '/uploads/campus-library-banner.jpg',
      media: [{ url: '/uploads/campus-library-banner.jpg', media_type: 'image' }],
      created_at: new Date(Date.now() - 1500000).toISOString(),
      visibility: 'everyone',
      like_count: 12,
      comment_count: 2,
      liked_by_me: false
    },
    // F. Post containing text + image
    {
      id: 306,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Anjali Sharma',
      studentId: 'student_a1',
      role: 'student',
      title: null,
      content: 'Here is the diagram from today\'s database normalisation lecture.',
      attachment_url: '/uploads/db-normalisation.png',
      media: [{ url: '/uploads/db-normalisation.png', media_type: 'image' }],
      created_at: new Date(Date.now() - 1800000).toISOString(),
      visibility: 'everyone',
      like_count: 9,
      comment_count: 1,
      liked_by_me: true
    },
    // G. Post containing bullet lists
    {
      id: 307,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Kiran Adhikari',
      studentId: 'student_k1',
      role: 'student',
      title: 'Lab Submission Checklist',
      content: 'Please ensure all points are satisfied prior to Friday midnight:\n\n- Complete all 5 database queries in SQL\n- Verify primary and foreign keys\n- Format and test Python driver script\n- Include test screenshots in PDF report\n- Submit via the official portal',
      created_at: new Date(Date.now() - 2100000).toISOString(),
      visibility: 'everyone',
      like_count: 14,
      comment_count: 3,
      liked_by_me: false
    },
    // H. Post containing code blocks
    {
      id: 308,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Nabin KC',
      studentId: 'student_n1',
      role: 'student',
      title: 'Fast Fibonacci in Rust',
      content: 'Here is an O(n) iterative solution with zero allocations:\n\n```rust\nfn fibonacci(n: u32) -> u64 {\n    let (mut a, mut b) = (0, 1);\n    for _ in 0..n {\n        let next = a + b;\n        a = b;\n        b = next;\n    }\n    a\n}\n```\n\nRun with `cargo test` to verify against edge cases.',
      created_at: new Date(Date.now() - 2400000).toISOString(),
      visibility: 'everyone',
      like_count: 21,
      comment_count: 5,
      liked_by_me: true
    },
    // I. Post with Show more (collapsed state)
    {
      id: 309,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Deepak Aryal',
      studentId: 'student_d1',
      role: 'student',
      title: 'Semester Project Guidelines & Comprehensive Roadmap',
      content: 'This guide covers all milestones required for the fourth-semester capstone software engineering project.\n\nFirst, team registration must be finalized with the department coordinator. Each team comprises exactly three members.\n\nSecond, the requirement specification document must detail both functional and non-functional requirements including security, latency, and uptime expectations.\n\nThird, system architecture and ER diagrams must be approved before coding commences.\n\nFourth, all code must reside in a git repository with pull request reviews and automated CI checks.\n\nFifth, weekly standups will be logged and submitted to the evaluation panel.\n\nFinally, end-of-semester presentations will demonstrate live deployment, unit test passes, and end-user verification.',
      created_at: new Date(Date.now() - 2700000).toISOString(),
      visibility: 'everyone',
      like_count: 16,
      comment_count: 6,
      liked_by_me: false
    },
    // K. Existing legacy plain-text post
    {
      id: 310,
      type: 'status',
      category: 'general',
      category_label: 'General',
      is_official: false,
      name: 'Saugat Subedi',
      studentId: 'student_s1',
      role: 'student',
      title: null,
      content: 'Just finished the midterm exam. Good luck everyone!',
      created_at: new Date(Date.now() - 3000000).toISOString(),
      visibility: 'everyone',
      like_count: 11,
      comment_count: 2,
      liked_by_me: true
    },
    // L. Rich-text post copied from ChatGPT
    {
      id: 311,
      type: 'status',
      category: 'announcement',
      category_label: 'Announcement',
      is_official: false,
      name: 'Sarah Connor',
      studentId: 'student_s2',
      role: 'student',
      title: 'ChatGPT Summary: Machine Learning Paradigms',
      content: '### Supervised vs Unsupervised Learning\n\n**Supervised Learning** relies on labelled input-output pairs to train predictive models.\n\n*Key Algorithms:*\n- Linear Regression\n- Support Vector Machines (SVM)\n- Random Forests\n\n> "Data is the new oil, but unlabelled data requires unsupervised clustering."\n\nRefer to standard textbooks for mathematical derivations.',
      created_at: new Date(Date.now() - 3300000).toISOString(),
      visibility: 'students_only',
      like_count: 27,
      comment_count: 7,
      liked_by_me: false
    }
  ];

  app.get('/api/me', (_, res) => res.json({
    user: { studentId: 'student_s1', name: 'Saugat Subedi', role: 'student', cohortId: 'cohort_2026', semester: 4, semester_no: 4 }
  }));
  app.get('/api/posts', (_, res) => res.json({ posts: testPosts, total: testPosts.length }));
  app.get('/api/academic-context', (_, res) => res.json({ role: 'student', academicStatus: 'assigned', displayLabel: 'Semester IV · 2026', semesterNumber: 4, semesterRoman: 'IV' }));
  app.get('/api/posts/config', (_, res) => res.json({
    categories: [
      { id: 'general', label: 'General' },
      { id: 'notice', label: 'Notices' },
      { id: 'announcement', label: 'Announcement' },
      { id: 'news', label: 'News' }
    ],
    defaultCategory: 'general', visibilities: ['everyone', 'students_only'], defaultVisibility: 'everyone', canPostNotice: true, canSelectAudience: true, role: 'student'
  }));
  app.get('/api/code-lab/assignments', (_, res) => res.json([]));
  app.get('/auth.js', (_, res) => res.type('js').send('window.SemesterAuth = {protectPage(){}, signOut(){}};'));
  app.get(['/notifications.js', '/chatbot.js'], (_, res) => res.type('js').send(''));
  app.use(express.static(path.join(__dirname, '../public')));

  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${port}/dashboard.html`);
  await page.waitForSelector('.status-post-card', { timeout: 8000 });

  // 1. Measure post card heights and verify each post's height reflects its content
  const cardMetrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.status-post-card'));
    return cards.map(c => {
      const id = c.getAttribute('data-post-id');
      const rect = c.getBoundingClientRect();
      const content = c.querySelector('.post-content');
      const actions = c.querySelector('.post-actions');
      const textLen = (content ? content.textContent : '').trim().length;
      return {
        id,
        height: Math.round(rect.height),
        textLength: textLen,
        gapContentToActions: actions && content ? Math.round(actions.getBoundingClientRect().top - content.getBoundingClientRect().bottom) : null
      };
    });
  });

  console.log('Card Height & Content Verification:');
  console.table(cardMetrics);

  // 2. Capture Dark Mode Feed
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark-mode');
  });
  await page.waitForTimeout(300);

  // Top of feed screenshot (Cards A, B, C, D)
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_dark_top.png') });
  console.log('Saved feed_spacing_dark_top.png');

  // Scroll down to middle (Notice D, Image E, Text+Image F, Lists G)
  const noticeCard = page.locator('.status-post-card[data-post-id="304"]');
  await noticeCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_dark_notice_and_media.png') });
  console.log('Saved feed_spacing_dark_notice_and_media.png');

  // Scroll to code block (H) and expandable post (I)
  const codeCard = page.locator('.status-post-card[data-post-id="308"]');
  await codeCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_dark_code_and_long.png') });
  console.log('Saved feed_spacing_dark_code_and_long.png');

  // Test Post J: Expand post 309 ("Show more")
  const expandBtn = page.locator('.status-post-card[data-post-id="309"] .post-expand-btn');
  if (await expandBtn.isVisible()) {
    const heightBefore = await page.locator('.status-post-card[data-post-id="309"]').boundingBox();
    await expandBtn.click();
    await page.waitForTimeout(300);
    const heightAfter = await page.locator('.status-post-card[data-post-id="309"]').boundingBox();
    console.log(`Post 309 Expand: height before = ${heightBefore.height}px, height after = ${heightAfter.height}px`);
    await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_dark_expanded_post.png') });
    console.log('Saved feed_spacing_dark_expanded_post.png');
  }

  // Scroll to very bottom to verify bottom navigation scroll clearance (Section 12)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_dark_bottom_clearance.png') });
  console.log('Saved feed_spacing_dark_bottom_clearance.png');

  // 3. Capture Light Mode Feed
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.classList.remove('dark-mode');
    document.body.setAttribute('data-theme', 'light');
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_light_top.png') });
  console.log('Saved feed_spacing_light_top.png');

  const lightNotice = page.locator('.status-post-card[data-post-id="304"]');
  await lightNotice.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, 'feed_spacing_light_notice.png') });
  console.log('Saved feed_spacing_light_notice.png');

  await browser.close();
  server.close();
  console.log('Test Cases QA & Screenshots successfully completed.');
})();
