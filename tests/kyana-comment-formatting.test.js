/**
 * Test Suite: Kyana AI — Comment Formatting & Reactive Threaded Replies
 *
 * Verifies that:
 * 1. renderCommentMarkdown formats raw markdown bold (`**text**`, `__text__`) into `<strong>` tags with 0 raw asterisks.
 * 2. Formats italic, inline code, fenced code blocks, bullet lists, numbered lists, blockquotes, and links.
 * 3. Formats @kyana and student mentions into high-contrast mention badges.
 * 4. Ensures complete XSS sanitization (scripts, javascript: URLs, dangerous attributes).
 * 5. Deterministic and generated comment replies contain clean structured formatting.
 * 6. Thread nesting: When @kyana is mentioned, the reply comment record has the correct parent_comment_id
 *    so it appears directly below the target comment in the thread.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const {
  renderCommentMarkdown,
  parseCommentInline,
  parseInlineMarkdown
} = require('../public/markdown');
const {
  handleCommentMention,
  hasKyanaMention,
  extractMentionQuery,
  KYANA_BOT_ID
} = require('../lib/kyana-comment-agent');
const { createCommentOrReply, fetchPostComments } = require('../lib/comments');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
    isPostgres: false,
    client,
    async exec(sql) {
      const stmts = sql
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
      for (const s of stmts) {
        await client.execute(s);
      }
    },
    async run(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: Number(res.lastInsertRowid || 0),
        changes: Number(res.rowsAffected || 0)
      };
    },
    async get(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    async all(sql, ...params) {
      const res = await client.execute({ sql, args: params });
      return res.rows.map(r => ({ ...r }));
    }
  };
}

describe('Kyana AI — Comment Formatting Suite', () => {
  test('1. Bold formatting: Converts **text** and __text__ to <strong> with zero raw asterisks', () => {
    const input = '**Important Notice:** All classes resume on **Monday** as per __updated schedule__.';
    const html = renderCommentMarkdown(input);

    assert.ok(html.includes('<strong>Important Notice:</strong>'), 'Should format **Important Notice:** as strong');
    assert.ok(html.includes('<strong>Monday</strong>'), 'Should format **Monday** as strong');
    assert.ok(html.includes('<strong>updated schedule</strong>'), 'Should format __updated schedule__ as strong');
    assert.doesNotMatch(html, /\*\*/, 'Zero raw ** asterisks must appear in rendered HTML');
    assert.doesNotMatch(html, /__/, 'Zero raw __ underscores must appear in rendered HTML');
  });

  test('2. Lists & Code formatting: Formats numbered lists, bullet lists, and code blocks', () => {
    const input = `**My suggestions for Assignment 1:**

1. **Core Concepts:** Study the relational schema carefully.
2. **Implementation:** Practice with SQLite and PostgreSQL.
- Check your \`student_id\`
- Submit before deadline

\`\`\`javascript
const res = await fetch('/api/data');
\`\`\``;

    const html = renderCommentMarkdown(input);

    assert.ok(html.includes('<ol class="comment-list">'), 'Should contain ordered list');
    assert.ok(html.includes('<li class="comment-list-item"><strong>Core Concepts:</strong>'), 'Should format numbered items with bold prefix');
    assert.ok(html.includes('<ul class="comment-list">'), 'Should contain bullet list');
    assert.ok(html.includes('<code class="comment-inline-code">student_id</code>'), 'Should format inline code');
    assert.ok(html.includes('<div class="comment-code-block">'), 'Should contain code block');
    assert.ok(html.includes('<span class="comment-code-lang">javascript</span>'), 'Should display code language');
    assert.ok(html.includes('const res = await fetch'), 'Should include raw code text');
    assert.doesNotMatch(html, /\*\*/, 'No raw asterisks in list output');
  });

  test('3. Mentions & Links: Formats @kyana and @user into badges and links into anchors', () => {
    const input = 'Hey @kyana, can you check with @saroj_cr about [Portal Link](https://gandaki.edu.np)? Also visit https://example.com';
    const html = renderCommentMarkdown(input);

    assert.ok(html.includes('<span class="comment-mention-badge kyana-mention">@kyana</span>'), 'Kyana mention should have kyana-mention badge');
    assert.ok(html.includes('<span class="comment-mention-badge">@saroj_cr</span>'), 'Student mention should have badge');
    assert.ok(html.includes('<a href="https://gandaki.edu.np" target="_blank" rel="noopener noreferrer" class="comment-link">Portal Link</a>'), 'Markdown link should render anchor');
    assert.ok(html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="comment-link">https://example.com</a>'), 'Standalone link should render anchor');
  });

  test('4. Security & XSS Sanitization: Escapes malicious HTML and javascript URLs', () => {
    const malicious = '<script>alert("xss")</script><img src=x onerror=alert(1)> [Click](javascript:alert("steal")) <iframe src="evil.com"></iframe>';
    const html = renderCommentMarkdown(malicious);

    assert.ok(!html.includes('<script>'), 'Must escape script tags');
    assert.ok(html.includes('&lt;script&gt;'), 'Must HTML-escape angle brackets');
    assert.ok(!html.includes('<img'), 'Must not render unescaped img tags');
    assert.ok(html.includes('&lt;img'), 'Must HTML-escape img tag');
    assert.ok(!html.includes('href="javascript:'), 'Must neutralize javascript: URLs');
    assert.ok(!html.includes('<iframe'), 'Must escape iframe tags');
    assert.ok(html.includes('&lt;iframe'), 'Must HTML-escape iframe tag');
  });

  test('5. Blockquotes and Headings in comments', () => {
    const input = `### Summary\n> This notice was issued by Admin Sau Gat.\nRegular classes resume soon.`;
    const html = renderCommentMarkdown(input);

    assert.ok(html.includes('<div class="comment-heading"><strong>Summary</strong></div>'), 'Should render heading');
    assert.ok(html.includes('<blockquote class="comment-quote">'), 'Should render blockquote');
    assert.ok(html.includes('This notice was issued by Admin Sau Gat.'), 'Blockquote content preserved');
  });
});

describe('Kyana AI — Threaded Comment Response Placement', () => {
  let db;

  test('setup test database', async () => {
    db = createTestDb();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        department TEXT DEFAULT 'BIT',
        semester TEXT DEFAULT 'Semester III',
        email TEXT DEFAULT 'student@gandaki.edu.np',
        bio TEXT,
        account_status TEXT DEFAULT 'active',
        verification_status TEXT DEFAULT 'verified',
        avatarUrl TEXT
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'post',
        category TEXT NOT NULL DEFAULT 'GENERAL',
        visibility TEXT NOT NULL DEFAULT 'everyone',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE post_comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_comment_id INTEGER,
        reply_to_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE TABLE post_comment_reactions (
        id INTEGER PRIMARY KEY,
        comment_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        reaction_type TEXT NOT NULL DEFAULT 'like',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.run(`INSERT INTO students (studentId, name, role) VALUES ('STU_01', 'Aashish Sharma', 'student')`);
    await db.run(`INSERT INTO posts (id, user_id, title, content) VALUES (10, 'STU_01', 'Assignment 1 Help', 'Can anyone explain problem 3?')`);
  });

  test('6. Kyana reply to root comment is placed directly in root comment replies', async () => {
    const mockReq = { postUser: { studentId: 'STU_01', name: 'Aashish Sharma', role: 'student' } };

    // User posts root comment mentioning @kyana with await_kyana = true
    const result = await createCommentOrReply(db, {
      postId: 10,
      content: '@kyana summarize this post for me',
      req: { ...mockReq, query: { await_kyana: '1' } }
    });

    assert.ok(result.comment, 'User comment should be created');
    const userCommentId = result.comment.id;

    // Fetch comments for post
    const comments = await fetchPostComments(db, 10, mockReq);
    assert.equal(comments.length, 1, 'Should have 1 root comment');

    const rootComment = comments[0];
    assert.equal(rootComment.id, userCommentId);
    assert.ok(Array.isArray(rootComment.replies), 'Root comment should have replies array');
    assert.equal(rootComment.replies.length, 1, 'Root comment should have exactly 1 reply from Kyana');

    const kyanaReply = rootComment.replies[0];
    assert.equal(kyanaReply.studentId, KYANA_BOT_ID, 'Reply author must be Kyana bot');
    assert.equal(kyanaReply.parentCommentId, userCommentId, 'Kyana reply parentCommentId must match user comment');

    // Verify rendered markdown for Kyana's reply: no raw asterisks
    const renderedReplyHtml = renderCommentMarkdown(kyanaReply.content);
    assert.doesNotMatch(renderedReplyHtml, /\*\*/, 'Kyana reply HTML must not contain raw ** asterisks');
  });

  test('7. Kyana reply to nested reply is placed directly in that same thread', async () => {
    const mockReq = { postUser: { studentId: 'STU_01', name: 'Aashish Sharma', role: 'student' } };

    // Create another root comment
    const rootRes = await createCommentOrReply(db, {
      postId: 10,
      content: 'Here is discussion on problem 3',
      req: mockReq
    });
    const rootId = rootRes.comment.id;

    // User replies to root comment, mentioning @kyana
    const replyRes = await createCommentOrReply(db, {
      postId: 10,
      targetParentId: rootId,
      content: '@kyana give suggestions on this',
      req: { ...mockReq, query: { await_kyana: '1' } }
    });

    const userReplyId = replyRes.comment.id;

    const comments = await fetchPostComments(db, 10, mockReq);
    const targetRoot = comments.find(c => c.id === rootId);
    assert.ok(targetRoot, 'Root comment should be present');
    assert.ok(targetRoot.replies.length >= 2, 'Should contain user reply + Kyana reply');

    // Find Kyana reply
    const kyanaReply = targetRoot.replies.find(r => r.studentId === KYANA_BOT_ID && r.id > userReplyId);
    assert.ok(kyanaReply, 'Kyana reply must be present in the replies array right below');
    assert.equal(kyanaReply.parentCommentId, rootId, 'Kyana reply must be nested under the root comment');
  });
});
