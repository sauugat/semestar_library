const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

async function inspectLayout() {
  const app = express();
  
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

  app.get('/api/posts/config', (_, res) => res.json({
    categories: [
      { id: 'general', label: 'General' },
      { id: 'notice', label: 'Notices' },
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

  app.get('/auth.js', (_, res) => res.type('js').send('window.SemesterAuth = {protectPage(){}, signOut(){}};'));
  app.get(['/notifications.js', '/chatbot.js'], (_, res) => res.type('js').send(''));

  app.use(express.static(path.join(__dirname, '../public')));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${port}/dashboard.html`);
  await page.waitForSelector('.status-post-card', { timeout: 8000 });

  const metrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.status-post-card'));
    return cards.map((card, idx) => {
      const getStyles = (el) => {
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: el.className,
          rect: { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width },
          height: cs.height,
          minHeight: cs.minHeight,
          marginTop: cs.marginTop,
          marginBottom: cs.marginBottom,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          lineHeight: cs.lineHeight,
          flexGrow: cs.flexGrow,
          justifyContent: cs.justifyContent
        };
      };

      const header = card.querySelector('.post-header');
      const tagsRow = card.querySelector('.post-tags-row');
      const postContent = card.querySelector('.post-content');
      const markdownContent = card.querySelector('.post-markdown-content');
      const firstChild = markdownContent ? markdownContent.firstElementChild : null;
      const lastChild = markdownContent ? markdownContent.lastElementChild : null;
      const actions = card.querySelector('.post-actions');

      return {
        cardIndex: idx,
        card: getStyles(card),
        header: getStyles(header),
        tagsRow: getStyles(tagsRow),
        postContent: getStyles(postContent),
        markdownContent: getStyles(markdownContent),
        firstChild: getStyles(firstChild),
        lastChild: getStyles(lastChild),
        actions: getStyles(actions),
        gapHeaderToTags: tagsRow ? tagsRow.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
        gapHeaderToContent: postContent.getBoundingClientRect().top - (tagsRow ? tagsRow.getBoundingClientRect().bottom : header.getBoundingClientRect().bottom),
        gapContentToActions: actions.getBoundingClientRect().top - postContent.getBoundingClientRect().bottom
      };
    });
  });

  console.log(JSON.stringify(metrics, null, 2));

  await browser.close();
  server.close();
}

inspectLayout().catch(console.error);
