const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');
const createCommentsRouter = require('../routes/comments');

async function setupTestApp(t) {
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename),
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    isPostgres: false,
    exec: (sql) => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const result = await client.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
    },
    initSchema: async () => {},
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      avatarUrl TEXT,
      semester TEXT
    );
    INSERT INTO students VALUES
      ('user1', 'User One', 'student', '/avatar1.jpg', '4'),
      ('user2', 'User Two', 'student', '/avatar2.jpg', '4'),
      ('admin1', 'Admin User', 'admin', '/admin.jpg', '4');
  `);

  await ensurePostsSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-user-id'] || null };
    next();
  });

  const requireLogin = (req, res, next) => {
    if (!req.session?.studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    next();
  };

  app.use('/api/posts', createPostsRouter(db, requireLogin));
  app.use('/api/comments', createCommentsRouter(db, requireLogin));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    client.close();
  });

  async function request(method, path, body, userId = 'user1') {
    const url = `http://127.0.0.1:${server.address().port}${path}`;
    const headers = {};
    if (userId) headers['x-user-id'] = userId;
    let reqBody = undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: reqBody });
    let parsed = null;
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  return { db, request };
}

test('PHASE 2B: Full modern comment, reply, reaction, edit, and soft-delete suite', async (t) => {
  const { db, request } = await setupTestApp(t);

  // Seed two posts
  const p1Res = await request('POST', '/api/posts', { content: 'Post number 1' }, 'user1');
  assert.equal(p1Res.status, 201);
  const postId1 = p1Res.body.id;

  const p2Res = await request('POST', '/api/posts', { content: 'Post number 2' }, 'user2');
  assert.equal(p2Res.status, 201);
  const postId2 = p2Res.body.id;

  // 1. Create root comment
  let root1Id;
  await t.test('1. create root comment', async () => {
    const res = await request('POST', `/api/posts/${postId1}/comments`, { content: 'First root comment' }, 'user1');
    assert.equal(res.status, 201);
    assert.equal(res.body.comment.content, 'First root comment');
    assert.equal(res.body.comment.name, 'User One');
    assert.equal(res.body.comment.userId, 'user1');
    assert.equal(res.body.comment.parentCommentId, null);
    assert.equal(res.body.comment.replyCount, 0);
    assert.equal(res.body.comment_count, 1);
    root1Id = res.body.comment.id;
  });

  // 2. Create reply to root comment
  let reply1Id;
  await t.test('2. create reply', async () => {
    const res = await request('POST', `/api/posts/${postId1}/comments`, {
      content: 'Replying to root comment',
      parent_comment_id: root1Id
    }, 'user2');
    assert.equal(res.status, 201);
    assert.equal(res.body.comment.content, 'Replying to root comment');
    assert.equal(res.body.comment.userId, 'user2');
    assert.equal(res.body.comment.parentCommentId, root1Id);
    assert.equal(res.body.comment.replyToUser?.studentId, 'user1');
    assert.equal(res.body.comment.replyToUser?.name, 'User One');
    assert.equal(res.body.comment_count, 2);
    reply1Id = res.body.comment.id;
  });

  // 3. Reply to reply (should be flattened under root comment with reply_to_user set)
  let reply2Id;
  await t.test('3. reply to reply', async () => {
    const res = await request('POST', `/api/posts/${postId1}/comments`, {
      content: 'Reply to the reply',
      parent_comment_id: reply1Id
    }, 'admin1');
    assert.equal(res.status, 201);
    assert.equal(res.body.comment.content, 'Reply to the reply');
    // Crucial: flattened to root1Id
    assert.equal(res.body.comment.parentCommentId, root1Id);
    assert.equal(res.body.comment.replyToUser?.studentId, 'user2');
    assert.equal(res.body.comment.replyToUser?.name, 'User Two');
    assert.equal(res.body.comment_count, 3);
    reply2Id = res.body.comment.id;
  });

  // 4. Fetch root comments
  await t.test('4. fetch root comments', async () => {
    const res = await request('GET', `/api/posts/${postId1}/comments`, undefined, 'user1');
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body), true);
    assert.equal(res.body.length, 1); // 1 root comment
    assert.equal(res.body[0].id, root1Id);
    assert.equal(res.body[0].replyCount, 2);
    assert.equal(res.body[0].replies.length, 2);
    assert.equal(res.body[0].replies[0].id, reply1Id);
    assert.equal(res.body[0].replies[1].id, reply2Id);
  });

  // 5. Fetch replies independently
  await t.test('5. fetch replies', async () => {
    const res = await request('GET', `/api/posts/${postId1}/comments/${root1Id}/replies`, undefined, 'user1');
    assert.equal(res.status, 200);
    assert.equal(res.body.replyCount, 2);
    assert.equal(res.body.replies.length, 2);
    assert.equal(res.body.replies[0].id, reply1Id);
    assert.equal(res.body.replies[1].id, reply2Id);

    // Also verify via /api/comments/:commentId/replies
    const resStandalone = await request('GET', `/api/comments/${root1Id}/replies`, undefined, 'user1');
    assert.equal(resStandalone.status, 200);
    assert.equal(resStandalone.body.replyCount, 2);
  });

  // 6. React to comment
  await t.test('6. react to comment', async () => {
    const res = await request('POST', `/api/comments/${root1Id}/reactions`, { reaction_type: 'like' }, 'user2');
    assert.equal(res.status, 200);
    assert.equal(res.body.reacted, true);
    assert.equal(res.body.reactionCount, 1);

    // Also react to a reply
    const replyReactRes = await request('POST', `/api/comments/${reply1Id}/reactions`, { reaction_type: 'like' }, 'user1');
    assert.equal(replyReactRes.status, 200);
    assert.equal(replyReactRes.body.reactionCount, 1);
  });

  // 7. Remove reaction
  await t.test('7. remove reaction', async () => {
    const res = await request('DELETE', `/api/comments/${root1Id}/reactions`, { reaction_type: 'like' }, 'user2');
    assert.equal(res.status, 200);
    assert.equal(res.body.reacted, false);
    assert.equal(res.body.reactionCount, 0);

    // Re-add reaction for user2 so we can test duplicate reaction next
    await request('POST', `/api/comments/${root1Id}/reactions`, { reaction_type: 'like' }, 'user2');
  });

  // 8. Duplicate reaction prevented
  await t.test('8. duplicate reaction prevented', async () => {
    // user2 reacts again with 'like'
    const res = await request('POST', `/api/comments/${root1Id}/reactions`, { reaction_type: 'like' }, 'user2');
    assert.equal(res.status, 200);
    assert.equal(res.body.reactionCount, 1); // Remains 1, does NOT increment to 2

    // Check directly in database
    const rows = await db.all('SELECT * FROM post_comment_reactions WHERE comment_id = ? AND user_id = ?', root1Id, 'user2');
    assert.equal(rows.length, 1);
  });

  // 9. Edit own comment
  await t.test('9. edit own comment', async () => {
    const res = await request('PUT', `/api/comments/${root1Id}`, { content: 'Root comment updated' }, 'user1');
    assert.equal(res.status, 200);
    assert.equal(res.body.comment.content, 'Root comment updated');
    assert.equal(res.body.comment.edited, true);
    assert.equal(res.body.comment.id, root1Id);
  });

  // 10. Cannot edit another user's comment
  await t.test('10. cannot edit another user\'s comment', async () => {
    const res = await request('PUT', `/api/comments/${root1Id}`, { content: 'Hacked by user2' }, 'user2');
    assert.equal(res.status, 403);

    // Content in DB remains unchanged
    const comment = await db.get('SELECT content FROM post_comments WHERE id = ?', root1Id);
    assert.equal(comment.content, 'Root comment updated');
  });

  // 11. Delete own comment (reply with no children)
  await t.test('11. delete own comment', async () => {
    const res = await request('DELETE', `/api/comments/${reply2Id}`, undefined, 'admin1');
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Comment deleted.');

    // Post comment_count drops from 3 to 2
    assert.equal(res.body.comment_count, 2);
  });

  // 12. Deleted root retains reply thread
  await t.test('12. deleted root retains reply thread', async () => {
    // Delete root1Id which still has reply1Id attached
    const res = await request('DELETE', `/api/comments/${root1Id}`, undefined, 'user1');
    assert.equal(res.status, 200);

    // Fetch comments for post
    const listRes = await request('GET', `/api/posts/${postId1}/comments`, undefined, 'user1');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.length, 1);
    assert.equal(listRes.body[0].id, root1Id);
    assert.equal(listRes.body[0].isDeleted, true);
    assert.equal(listRes.body[0].content, '[Comment deleted]');
    assert.equal(listRes.body[0].canEdit, false);
    assert.equal(listRes.body[0].canDelete, false);

    // Reply thread is preserved
    assert.equal(listRes.body[0].replyCount, 1);
    assert.equal(listRes.body[0].replies.length, 1);
    assert.equal(listRes.body[0].replies[0].id, reply1Id);
    assert.equal(listRes.body[0].replies[0].content, 'Replying to root comment');
  });

  // 13. Post comment count remains correct
  await t.test('13. post comment count remains correct', async () => {
    // Active comments: 1 (reply1Id; root1 is soft-deleted)
    const postRes = await request('GET', `/api/posts/${postId1}`, undefined, 'user1');
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.comment_count, 1);

    // Add another root comment
    const newRoot = await request('POST', `/api/posts/${postId1}/comments`, { content: 'New active root' }, 'user2');
    assert.equal(newRoot.body.comment_count, 2);

    const postRes2 = await request('GET', `/api/posts/${postId1}`, undefined, 'user1');
    assert.equal(postRes2.body.comment_count, 2);
  });

  // 14. Invalid parent comment rejected
  await t.test('14. invalid parent comment rejected', async () => {
    const res = await request('POST', `/api/posts/${postId1}/comments`, {
      content: 'Replying to non-existent comment',
      parent_comment_id: 999999
    }, 'user1');
    assert.equal(res.status, 404);
  });

  // 15. Reply cannot target comment from another post incorrectly
  await t.test('15. reply cannot target comment from another post incorrectly', async () => {
    // Create comment on post 2
    const cOnP2 = await request('POST', `/api/posts/${postId2}/comments`, { content: 'Comment on Post 2' }, 'user2');
    const p2CommentId = cOnP2.body.comment.id;

    // Attempt to reply to post 2's comment on post 1
    const res = await request('POST', `/api/posts/${postId1}/comments`, {
      content: 'Mismatched reply target',
      parent_comment_id: p2CommentId
    }, 'user1');
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Reply target does not belong to this post.');
  });
});
