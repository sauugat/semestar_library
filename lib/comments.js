function positiveId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function normalizeId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && positiveId(value)) return Number(value);
  return null;
}

function formatCommentRow(row, req) {
  const currentUserId = req?.postUser?.studentId || req?.student?.studentId || req?.session?.studentId || null;
  const currentUserRole = req?.postUser?.role || req?.student?.role || null;
  const isAuthor = Boolean(currentUserId && (row.user_id === currentUserId || row.student_id === currentUserId));
  const isAdmin = currentUserRole === 'admin';
  const isDeleted = Boolean(row.deleted_at);

  let content = row.content;
  if (isDeleted) {
    content = '[Comment deleted]';
  }

  const replyToUser = (row.reply_to_user_id && row.reply_to_name) ? {
    studentId: row.reply_to_user_id,
    name: row.reply_to_name
  } : null;

  return {
    id: Number(row.id),
    postId: Number(row.post_id || row.postId),
    userId: row.user_id || row.userId,
    studentId: row.student_id || row.user_id || row.userId,
    name: isDeleted ? 'Deleted Comment' : (row.name || 'User'),
    role: isDeleted ? 'student' : (row.role || 'student'),
    avatarUrl: isDeleted ? null : (row.avatarUrl || null),
    content,
    parentCommentId: row.parent_comment_id ? Number(row.parent_comment_id) : null,
    replyToUserId: row.reply_to_user_id || null,
    replyToUser,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || null,
    edited: Boolean(row.updated_at && !isDeleted),
    isDeleted,
    reactionCount: Number(row.reaction_count || 0),
    reactedByMe: Boolean(row.reacted_by_me),
    replyCount: Number(row.reply_count || 0),
    replies: Array.isArray(row.replies) ? row.replies : [],
    canDelete: !isDeleted && (isAuthor || isAdmin),
    canEdit: !isDeleted && isAuthor
  };
}

async function fetchCommentById(db, commentId, currentUserId) {
  const cid = normalizeId(commentId);
  if (!cid) return null;

  const row = await db.get(`
    SELECT c.id, c.post_id, c.user_id, c.content, c.parent_comment_id, c.reply_to_user_id,
           c.created_at, c.updated_at, c.deleted_at,
           s.name, s.role, s.avatarUrl AS "avatarUrl", s.studentId AS "student_id",
           r_s.name AS reply_to_name,
           COALESCE(rc.reaction_count, 0) AS reaction_count,
           (mine_r.user_id IS NOT NULL) AS reacted_by_me,
           COALESCE(replies_c.reply_count, 0) AS reply_count
    FROM post_comments c
    JOIN students s ON s.studentId = c.user_id
    LEFT JOIN students r_s ON r_s.studentId = c.reply_to_user_id
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS reaction_count
      FROM post_comment_reactions
      GROUP BY comment_id
    ) rc ON rc.comment_id = c.id
    LEFT JOIN post_comment_reactions mine_r ON mine_r.comment_id = c.id AND mine_r.user_id = ?
    LEFT JOIN (
      SELECT parent_comment_id, COUNT(*) AS reply_count
      FROM post_comments
      WHERE deleted_at IS NULL
      GROUP BY parent_comment_id
    ) replies_c ON replies_c.parent_comment_id = c.id
    WHERE c.id = ?
  `, currentUserId, cid);

  return row;
}

async function fetchPostComments(db, postId, req) {
  const pid = normalizeId(postId);
  if (!pid) return [];
  const currentUserId = req?.postUser?.studentId || req?.student?.studentId || req?.session?.studentId || null;

  const rows = await db.all(`
    SELECT c.id, c.post_id, c.user_id, c.content, c.parent_comment_id, c.reply_to_user_id,
           c.created_at, c.updated_at, c.deleted_at,
           s.name, s.role, s.avatarUrl AS "avatarUrl", s.studentId AS "student_id",
           r_s.name AS reply_to_name,
           COALESCE(rc.reaction_count, 0) AS reaction_count,
           (mine_r.user_id IS NOT NULL) AS reacted_by_me
    FROM post_comments c
    JOIN students s ON s.studentId = c.user_id
    LEFT JOIN students r_s ON r_s.studentId = c.reply_to_user_id
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS reaction_count
      FROM post_comment_reactions
      GROUP BY comment_id
    ) rc ON rc.comment_id = c.id
    LEFT JOIN post_comment_reactions mine_r ON mine_r.comment_id = c.id AND mine_r.user_id = ?
    WHERE c.post_id = ?
    ORDER BY c.id ASC
  `, currentUserId, pid);

  const repliesByParent = new Map();
  const activeRepliesCountByParent = new Map();

  for (const row of rows) {
    if (row.parent_comment_id != null) {
      const parentId = Number(row.parent_comment_id);
      if (!row.deleted_at) {
        if (!repliesByParent.has(parentId)) {
          repliesByParent.set(parentId, []);
        }
        repliesByParent.get(parentId).push(row);
        activeRepliesCountByParent.set(parentId, (activeRepliesCountByParent.get(parentId) || 0) + 1);
      }
    }
  }

  const rootComments = [];
  for (const row of rows) {
    if (row.parent_comment_id == null) {
      const rootId = Number(row.id);
      const activeReplies = repliesByParent.get(rootId) || [];
      const activeCount = activeRepliesCountByParent.get(rootId) || 0;

      // If root is soft-deleted and has no active replies, skip it
      if (row.deleted_at && activeCount === 0) {
        continue;
      }

      row.reply_count = activeCount;
      row.replies = activeReplies.map(r => formatCommentRow(r, req));
      rootComments.push(formatCommentRow(row, req));
    }
  }

  return rootComments;
}

async function fetchCommentReplies(db, commentId, req, { limit = 50, offset = 0 } = {}) {
  const cid = normalizeId(commentId);
  if (!cid) return [];
  const currentUserId = req?.postUser?.studentId || req?.student?.studentId || req?.session?.studentId || null;

  const rows = await db.all(`
    SELECT c.id, c.post_id, c.user_id, c.content, c.parent_comment_id, c.reply_to_user_id,
           c.created_at, c.updated_at, c.deleted_at,
           s.name, s.role, s.avatarUrl AS "avatarUrl", s.studentId AS "student_id",
           r_s.name AS reply_to_name,
           COALESCE(rc.reaction_count, 0) AS reaction_count,
           (mine_r.user_id IS NOT NULL) AS reacted_by_me
    FROM post_comments c
    JOIN students s ON s.studentId = c.user_id
    LEFT JOIN students r_s ON r_s.studentId = c.reply_to_user_id
    LEFT JOIN (
      SELECT comment_id, COUNT(*) AS reaction_count
      FROM post_comment_reactions
      GROUP BY comment_id
    ) rc ON rc.comment_id = c.id
    LEFT JOIN post_comment_reactions mine_r ON mine_r.comment_id = c.id AND mine_r.user_id = ?
    WHERE c.parent_comment_id = ? AND c.deleted_at IS NULL
    ORDER BY c.id ASC
    LIMIT ? OFFSET ?
  `, currentUserId, cid, Number(limit), Number(offset));

  return rows.map(r => formatCommentRow(r, req));
}

async function createCommentOrReply(db, { postId, targetParentId, replyToUserId, content, req }) {
  const authorStudentId = req?.postUser?.studentId;
  if (!authorStudentId) {
    const err = new Error('Sign in with a student account to comment.');
    err.status = 403;
    throw err;
  }

  if (typeof content !== 'string' || !content.trim() || content.trim().length > 2000) {
    const err = new Error('Comment must be between 1 and 2,000 characters.');
    err.status = 400;
    throw err;
  }

  let finalPostId = normalizeId(postId);
  let resolvedParentId = null;
  let resolvedReplyToUserId = replyToUserId || null;

  if (targetParentId !== undefined && targetParentId !== null && targetParentId !== '') {
    const pid = normalizeId(targetParentId);
    if (!pid) {
      const err = new Error('Invalid parent comment ID.');
      err.status = 400;
      throw err;
    }

    const targetComment = await db.get(
      'SELECT id, post_id, user_id, parent_comment_id, deleted_at FROM post_comments WHERE id = ?',
      pid
    );

    if (!targetComment) {
      const err = new Error('Parent comment not found.');
      err.status = 404;
      throw err;
    }

    if (targetComment.deleted_at) {
      const err = new Error('Cannot reply to a deleted comment.');
      err.status = 400;
      throw err;
    }

    if (finalPostId && Number(targetComment.post_id) !== finalPostId) {
      const err = new Error('Reply target does not belong to this post.');
      err.status = 400;
      throw err;
    }

    finalPostId = Number(targetComment.post_id);

    // Root-flattening: if target is already a reply, keep under target's root parent
    if (targetComment.parent_comment_id) {
      resolvedParentId = Number(targetComment.parent_comment_id);
    } else {
      resolvedParentId = Number(targetComment.id);
    }

    // Set replyToUser identity
    if (!resolvedReplyToUserId) {
      resolvedReplyToUserId = targetComment.user_id;
    }
  }

  if (!finalPostId) {
    const err = new Error('Post ID is required.');
    err.status = 400;
    throw err;
  }

  const post = await db.get('SELECT id FROM posts WHERE id = ?', finalPostId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }

  const result = await db.run(
    `INSERT INTO post_comments (post_id, user_id, content, parent_comment_id, reply_to_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    finalPostId, authorStudentId, content.trim(), resolvedParentId, resolvedReplyToUserId, new Date().toISOString()
  );

  const newCommentRow = await fetchCommentById(db, result.lastInsertRowid, authorStudentId);
  const formatted = formatCommentRow(newCommentRow, req);

  const countRow = await db.get(
    'SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ? AND deleted_at IS NULL',
    finalPostId
  );

  return {
    comment: formatted,
    comment_count: Number(countRow?.c || 0),
    commentCount: Number(countRow?.c || 0)
  };
}

async function editComment(db, { commentId, content, req }) {
  const currentUserId = req?.postUser?.studentId;
  if (!currentUserId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const cid = normalizeId(commentId);
  if (!cid) {
    const err = new Error('Invalid comment ID.');
    err.status = 400;
    throw err;
  }

  const comment = await db.get('SELECT * FROM post_comments WHERE id = ?', cid);
  if (!comment) {
    const err = new Error('Comment not found.');
    err.status = 404;
    throw err;
  }

  if (comment.deleted_at) {
    const err = new Error('Cannot edit a deleted comment.');
    err.status = 400;
    throw err;
  }

  if (comment.user_id !== currentUserId) {
    const err = new Error('Only the comment author can edit this comment.');
    err.status = 403;
    throw err;
  }

  if (typeof content !== 'string' || !content.trim() || content.trim().length > 2000) {
    const err = new Error('Comment must be between 1 and 2,000 characters.');
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  await db.run('UPDATE post_comments SET content = ?, updated_at = ? WHERE id = ?', content.trim(), now, cid);

  const updatedRow = await fetchCommentById(db, cid, currentUserId);
  return {
    comment: formatCommentRow(updatedRow, req),
    message: 'Comment updated.'
  };
}

async function deleteComment(db, { commentId, postId, req }) {
  const currentUserId = req?.postUser?.studentId;
  const currentUserRole = req?.postUser?.role;
  if (!currentUserId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const cid = normalizeId(commentId);
  if (!cid) {
    const err = new Error('Invalid comment ID.');
    err.status = 400;
    throw err;
  }

  const comment = await db.get('SELECT * FROM post_comments WHERE id = ?', cid);
  if (!comment) {
    const err = new Error('Comment not found.');
    err.status = 404;
    throw err;
  }

  if (postId && Number(comment.post_id) !== normalizeId(postId)) {
    const err = new Error('Comment not found on this post.');
    err.status = 404;
    throw err;
  }

  const isAuthor = comment.user_id === currentUserId;
  const isAdmin = currentUserRole === 'admin';
  if (!isAuthor && !isAdmin) {
    const err = new Error('Only the comment author or an admin can delete this comment.');
    err.status = 403;
    throw err;
  }

  // Check if comment has active replies
  const repliesCountRow = await db.get(
    'SELECT COUNT(*) AS c FROM post_comments WHERE parent_comment_id = ? AND deleted_at IS NULL',
    cid
  );
  const activeReplies = Number(repliesCountRow?.c || 0);

  if (activeReplies > 0) {
    // Soft delete: retain thread structure
    const now = new Date().toISOString();
    await db.run(
      'UPDATE post_comments SET deleted_at = ?, content = ? WHERE id = ?',
      now, '[Comment deleted]', cid
    );
  } else {
    // Hard delete when no replies depend on it
    await db.run('DELETE FROM post_comments WHERE id = ?', cid);
  }

  const countRow = await db.get(
    'SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ? AND deleted_at IS NULL',
    comment.post_id
  );

  return {
    message: 'Comment deleted.',
    comment_count: Number(countRow?.c || 0),
    commentCount: Number(countRow?.c || 0)
  };
}

async function addCommentReaction(db, { commentId, reactionType = 'like', req }) {
  const currentUserId = req?.postUser?.studentId;
  if (!currentUserId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const cid = normalizeId(commentId);
  if (!cid) {
    const err = new Error('Invalid comment ID.');
    err.status = 400;
    throw err;
  }

  const comment = await db.get('SELECT id, deleted_at FROM post_comments WHERE id = ?', cid);
  if (!comment) {
    const err = new Error('Comment not found.');
    err.status = 404;
    throw err;
  }

  if (comment.deleted_at) {
    const err = new Error('Cannot react to a deleted comment.');
    err.status = 400;
    throw err;
  }

  const cleanReactionType = typeof reactionType === 'string' && reactionType.trim() ? reactionType.trim().toLowerCase() : 'like';

  await db.run(
    `INSERT INTO post_comment_reactions (comment_id, user_id, reaction_type, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (comment_id, user_id, reaction_type) DO NOTHING`,
    cid, currentUserId, cleanReactionType, new Date().toISOString()
  );

  const countRow = await db.get('SELECT COUNT(*) AS c FROM post_comment_reactions WHERE comment_id = ?', cid);
  const reactionCount = Number(countRow?.c || 0);

  return {
    reacted: true,
    reacted_by_me: true,
    reaction_count: reactionCount,
    reactionCount
  };
}

async function removeCommentReaction(db, { commentId, reactionType = 'like', req }) {
  const currentUserId = req?.postUser?.studentId;
  if (!currentUserId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const cid = normalizeId(commentId);
  if (!cid) {
    const err = new Error('Invalid comment ID.');
    err.status = 400;
    throw err;
  }

  const cleanReactionType = typeof reactionType === 'string' && reactionType.trim() ? reactionType.trim().toLowerCase() : 'like';

  await db.run(
    'DELETE FROM post_comment_reactions WHERE comment_id = ? AND user_id = ? AND reaction_type = ?',
    cid, currentUserId, cleanReactionType
  );

  const countRow = await db.get('SELECT COUNT(*) AS c FROM post_comment_reactions WHERE comment_id = ?', cid);
  const reactionCount = Number(countRow?.c || 0);

  return {
    reacted: false,
    reacted_by_me: false,
    reaction_count: reactionCount,
    reactionCount
  };
}

async function toggleCommentReaction(db, { commentId, reactionType = 'like', req }) {
  const currentUserId = req?.postUser?.studentId;
  if (!currentUserId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  const cid = normalizeId(commentId);
  if (!cid) {
    const err = new Error('Invalid comment ID.');
    err.status = 400;
    throw err;
  }

  const cleanReactionType = typeof reactionType === 'string' && reactionType.trim() ? reactionType.trim().toLowerCase() : 'like';
  const existing = await db.get(
    'SELECT id FROM post_comment_reactions WHERE comment_id = ? AND user_id = ? AND reaction_type = ?',
    cid, currentUserId, cleanReactionType
  );

  if (existing) {
    return removeCommentReaction(db, { commentId: cid, reactionType: cleanReactionType, req });
  } else {
    return addCommentReaction(db, { commentId: cid, reactionType: cleanReactionType, req });
  }
}

module.exports = {
  positiveId,
  normalizeId,
  formatCommentRow,
  fetchCommentById,
  fetchPostComments,
  fetchCommentReplies,
  createCommentOrReply,
  editComment,
  deleteComment,
  addCommentReaction,
  removeCommentReaction,
  toggleCommentReaction
};
