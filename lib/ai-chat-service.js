'use strict';

/**
 * AI Chat Persistence and Conversation Service
 * Manages authenticated Kyana AI conversations and messages across web and mobile clients.
 * Keeps Kyana conversations completely separate from student-to-student messaging and cohorts.
 */

let schemaInitialized = false;

/**
 * Ensures ai_conversations and ai_messages tables exist in both PostgreSQL and SQLite.
 */
async function ensureSchema(db) {
  if (schemaInitialized) return;
  const execFn = typeof db?.exec === 'function' ? (sql) => db.exec(sql) : (typeof db === 'function' ? db : null);
  const isPostgres = Boolean(db?.isPostgres);
  if (!execFn) return;

  if (isPostgres) {
    await execFn(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Chat with Kyana',
        last_message TEXT,
        last_message_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_conversations_student ON ai_conversations(student_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, id ASC);
    `);
  } else {
    await execFn(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Chat with Kyana',
        last_message TEXT,
        last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_conversations_student ON ai_conversations(student_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, id ASC);
    `);
  }
  schemaInitialized = true;
}

function normalizeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
}

/**
 * Returns the most active conversation for a student or creates a default one.
 */
async function getOrCreateActiveConversation(db, studentId) {
  await ensureSchema(db);
  if (!studentId) return null;

  const existing = await db.get(
    `SELECT id, student_id AS "studentId", title, last_message AS "lastMessage",
            last_message_at AS "lastMessageAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM ai_conversations
     WHERE student_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
    studentId
  );

  if (existing) {
    return {
      id: existing.id,
      studentId: existing.studentId || existing.student_id,
      title: existing.title || 'Chat with Kyana',
      lastMessage: existing.lastMessage || existing.last_message,
      lastMessageAt: normalizeDate(existing.lastMessageAt || existing.last_message_at),
      createdAt: normalizeDate(existing.createdAt || existing.created_at),
      updatedAt: normalizeDate(existing.updatedAt || existing.updated_at)
    };
  }

  // Create default conversation
  const newId = `kyana_${studentId}_default`;
  const isPostgres = Boolean(db.isPostgres);
  if (isPostgres) {
    await db.run(
      `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'Chat with Kyana', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      newId, studentId
    );
  } else {
    await db.run(
      `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'Chat with Kyana', NULL, datetime('now'), datetime('now'), datetime('now'))`,
      newId, studentId
    );
  }

  return {
    id: newId,
    studentId,
    title: 'Chat with Kyana',
    lastMessage: null,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Returns all conversations for a student.
 */
async function getConversations(db, studentId) {
  await ensureSchema(db);
  if (!studentId) return [];

  const rows = await db.all(
    `SELECT id, student_id AS "studentId", title, last_message AS "lastMessage",
            last_message_at AS "lastMessageAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM ai_conversations
     WHERE student_id = ?
     ORDER BY updated_at DESC`,
    studentId
  );

  return (rows || []).map(r => ({
    id: r.id,
    studentId: r.studentId || r.student_id,
    title: r.title || 'Chat with Kyana',
    lastMessage: r.lastMessage || r.last_message,
    lastMessageAt: normalizeDate(r.lastMessageAt || r.last_message_at),
    createdAt: normalizeDate(r.createdAt || r.created_at),
    updatedAt: normalizeDate(r.updatedAt || r.updated_at)
  }));
}

/**
 * Validates ownership and returns a single conversation.
 */
async function getConversation(db, studentId, conversationId) {
  await ensureSchema(db);
  if (!studentId || !conversationId) return null;

  const row = await db.get(
    `SELECT id, student_id AS "studentId", title, last_message AS "lastMessage",
            last_message_at AS "lastMessageAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM ai_conversations
     WHERE id = ? AND student_id = ?`,
    conversationId, studentId
  );

  if (!row) return null;
  return {
    id: row.id,
    studentId: row.studentId || row.student_id,
    title: row.title || 'Chat with Kyana',
    lastMessage: row.lastMessage || row.last_message,
    lastMessageAt: normalizeDate(row.lastMessageAt || row.last_message_at),
    createdAt: normalizeDate(row.createdAt || row.created_at),
    updatedAt: normalizeDate(row.updatedAt || row.updated_at)
  };
}

/**
 * Returns messages for a conversation, validating ownership.
 */
async function getMessages(db, studentId, conversationId, limit = 50) {
  await ensureSchema(db);
  if (!studentId || !conversationId) return [];

  // Verify conversation exists and belongs to student
  const conv = await getConversation(db, studentId, conversationId);
  if (!conv) return [];

  const rows = await db.all(
    `SELECT id, conversation_id AS "conversationId", student_id AS "studentId",
            sender, text, metadata, created_at AS "createdAt"
     FROM ai_messages
     WHERE conversation_id = ? AND student_id = ?
     ORDER BY id ASC
     LIMIT ?`,
    conversationId, studentId, limit
  );

  return (rows || []).map(r => {
    let meta = null;
    if (r.metadata) {
      try {
        meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      } catch (_) {
        meta = null;
      }
    }
    return {
      id: r.id,
      conversationId: r.conversationId || r.conversation_id,
      studentId: r.studentId || r.student_id,
      sender: r.sender,
      text: r.text,
      metadata: meta,
      createdAt: normalizeDate(r.createdAt || r.created_at)
    };
  });
}

/**
 * Saves a user message to a conversation.
 */
async function saveUserMessage(db, studentId, conversationId, text) {
  await ensureSchema(db);
  if (!studentId || !conversationId || !text) return null;

  const conv = await getConversation(db, studentId, conversationId);
  if (!conv) {
    // If conversation doesn't exist, create it
    const isPostgres = Boolean(db.isPostgres);
    const titleSnippet = text.length > 36 ? text.substring(0, 36) + '…' : text;
    if (isPostgres) {
      await db.run(
        `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        conversationId, studentId, titleSnippet, text
      );
    } else {
      await db.run(
        `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
        conversationId, studentId, titleSnippet, text
      );
    }
  }

  const isPostgres = Boolean(db.isPostgres);
  let insertRes;
  if (isPostgres) {
    insertRes = await db.run(
      `INSERT INTO ai_messages (conversation_id, student_id, sender, text, created_at)
       VALUES (?, ?, 'user', ?, CURRENT_TIMESTAMP)`,
      conversationId, studentId, text
    );
    await db.run(
      `UPDATE ai_conversations
       SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND student_id = ?`,
      text, conversationId, studentId
    );
  } else {
    insertRes = await db.run(
      `INSERT INTO ai_messages (conversation_id, student_id, sender, text, created_at)
       VALUES (?, ?, 'user', ?, datetime('now'))`,
      conversationId, studentId, text
    );
    await db.run(
      `UPDATE ai_conversations
       SET last_message = ?, last_message_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND student_id = ?`,
      text, conversationId, studentId
    );
  }

  return {
    id: insertRes?.lastInsertRowid || insertRes?.id || Date.now(),
    conversationId,
    studentId,
    sender: 'user',
    text,
    createdAt: new Date().toISOString()
  };
}

/**
 * Saves an assistant (Kyana) message to a conversation.
 */
async function saveAssistantMessage(db, studentId, conversationId, text, metadata = null) {
  await ensureSchema(db);
  if (!studentId || !conversationId || !text) return null;

  const isPostgres = Boolean(db.isPostgres);
  const metaStr = metadata ? JSON.stringify(metadata) : '{}';

  let insertRes;
  if (isPostgres) {
    insertRes = await db.run(
      `INSERT INTO ai_messages (conversation_id, student_id, sender, text, metadata, created_at)
       VALUES (?, ?, 'assistant', ?, ?, CURRENT_TIMESTAMP)`,
      conversationId, studentId, text, metaStr
    );
    await db.run(
      `UPDATE ai_conversations
       SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND student_id = ?`,
      text, conversationId, studentId
    );
  } else {
    insertRes = await db.run(
      `INSERT INTO ai_messages (conversation_id, student_id, sender, text, metadata, created_at)
       VALUES (?, ?, 'assistant', ?, ?, datetime('now'))`,
      conversationId, studentId, text, metaStr
    );
    await db.run(
      `UPDATE ai_conversations
       SET last_message = ?, last_message_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND student_id = ?`,
      text, conversationId, studentId
    );
  }

  return {
    id: insertRes?.lastInsertRowid || insertRes?.id || Date.now(),
    conversationId,
    studentId,
    sender: 'assistant',
    text,
    metadata,
    createdAt: new Date().toISOString()
  };
}

/**
 * Clears all messages in a conversation without deleting the conversation record.
 */
async function clearConversation(db, studentId, conversationId) {
  await ensureSchema(db);
  if (!studentId || !conversationId) return false;

  const conv = await getConversation(db, studentId, conversationId);
  if (!conv) return false;

  await db.run(
    `DELETE FROM ai_messages WHERE conversation_id = ? AND student_id = ?`,
    conversationId, studentId
  );

  const isPostgres = Boolean(db.isPostgres);
  if (isPostgres) {
    await db.run(
      `UPDATE ai_conversations
       SET last_message = NULL, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND student_id = ?`,
      conversationId, studentId
    );
  } else {
    await db.run(
      `UPDATE ai_conversations
       SET last_message = NULL, last_message_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND student_id = ?`,
      conversationId, studentId
    );
  }

  return true;
}

/**
 * Permanently deletes a conversation and all its messages.
 */
async function deleteConversation(db, studentId, conversationId) {
  await ensureSchema(db);
  if (!studentId || !conversationId) return false;

  const conv = await getConversation(db, studentId, conversationId);
  if (!conv) return false;

  await db.run(
    `DELETE FROM ai_messages WHERE conversation_id = ? AND student_id = ?`,
    conversationId, studentId
  );
  await db.run(
    `DELETE FROM ai_conversations WHERE id = ? AND student_id = ?`,
    conversationId, studentId
  );

  return true;
}

/**
 * Creates a brand new conversation for an authenticated student.
 */
async function createConversation(db, studentId, title = 'New conversation') {
  await ensureSchema(db);
  if (!studentId) return null;

  const newId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const isPostgres = Boolean(db.isPostgres);

  if (isPostgres) {
    await db.run(
      `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      newId, studentId, title
    );
  } else {
    await db.run(
      `INSERT INTO ai_conversations (id, student_id, title, last_message, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'), datetime('now'))`,
      newId, studentId, title
    );
  }

  return {
    id: newId,
    studentId,
    title,
    lastMessage: null,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Returns high-level inbox status for the chat list item.
 */
async function getInboxPreview(db, studentId) {
  await ensureSchema(db);
  if (!studentId) {
    return {
      conversationId: null,
      title: 'Kyana AI',
      subtitle: 'How can I help you today?',
      timestamp: null,
      unreadCount: 0,
      isPinned: true
    };
  }

  const active = await getOrCreateActiveConversation(db, studentId);
  return {
    conversationId: active ? active.id : null,
    title: 'Kyana AI',
    subtitle: (active && active.lastMessage) ? active.lastMessage : 'How can I help you today?',
    timestamp: (active && active.lastMessageAt) ? active.lastMessageAt : null,
    unreadCount: 0,
    isPinned: true
  };
}

module.exports = {
  ensureSchema,
  getOrCreateActiveConversation,
  getConversations,
  getConversation,
  getMessages,
  saveUserMessage,
  saveAssistantMessage,
  clearConversation,
  deleteConversation,
  createConversation,
  getInboxPreview
};
