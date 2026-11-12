'use strict';

/**
 * AI Chat Persistence and Conversation Service
 * Manages authenticated Kyana AI conversations and messages across web and mobile clients.
 * Keeps Kyana conversations completely separate from student-to-student messaging and cohorts.
 */

const initializedDatabases = new WeakSet();
const schemaInitPromises = new WeakMap();

/**
 * Ensures ai_conversations and ai_messages tables exist in both PostgreSQL and SQLite.
 * Caches in-flight and completed initialization per DB instance with safe retry on failure.
 */
async function ensureSchema(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return;
  if (initializedDatabases.has(db)) return;
  if (schemaInitPromises.has(db)) return schemaInitPromises.get(db);
  const execFn = typeof db?.exec === 'function' ? (sql) => db.exec(sql) : (typeof db === 'function' ? db : null);
  const isPostgres = Boolean(db?.isPostgres);
  if (!execFn) return;

  const initPromise = (async () => {

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
    initializedDatabases.add(db);
  })().catch((err) => {
    schemaInitPromises.delete(db);
    throw err;
  });
  schemaInitPromises.set(db, initPromise);
  return initPromise;
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
      lastMessage: null,
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
    lastMessage: null,
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
    lastMessage: null,
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
     ORDER BY id DESC
     LIMIT ?`,
    conversationId, studentId, Math.max(1, Math.min(100, Number(limit) || 50))
  );

  const messages = (rows || []).reverse().map(r => {
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
  const { getAcademicContext } = require('./academic-context');
  const { revalidateCards } = require('./kyana-access');
  const { contextKey } = require('./chat-security');
  const context = await getAcademicContext(db, { studentId });
  const expectedCtxKey = contextKey(context);
  const cardValidationCache = new Map();
  const { sanitizeMessageMetadataForClient } = require('./message-actions');
  for (const message of messages) {
    if (message.sender !== 'assistant') continue;
    const meta = message.metadata;
    let valid = meta?.accessContext === expectedCtxKey;
    if (valid && (meta?.evidenceReferences || meta?.resourceCards)?.length) {
      try {
        const refs = meta.evidenceReferences || meta.resourceCards;
        const uncachedRefs = [];
        for (const r of refs) {
          const k = `${r.resourceType || r.type}:${r.id}:${r.sourceVersion || ''}`;
          if (!cardValidationCache.has(k)) uncachedRefs.push({ key: k, ref: r });
        }
        if (uncachedRefs.length > 0) {
          for (const { key, ref } of uncachedRefs) {
            const checked = await revalidateCards(db, context, [ref]);
            cardValidationCache.set(key, checked[0] || null);
          }
        }
        const cards = refs
          .map(r => cardValidationCache.get(`${r.resourceType || r.type}:${r.id}:${r.sourceVersion || ''}`))
          .filter(Boolean);
        valid = cards.length === refs.length;
        if (valid) message.metadata = { ...meta, resourceCards: cards.filter(c => (meta.resourceCards || []).some(old => old.id === c.id && old.type === c.type)) };
      } catch { valid = false; }
    }
    if (!valid) {
      message.text = 'This earlier reply is no longer available. Search again to check current sources.';
      message.metadata = { resourceCards: [], unavailable: true };
    } else if (message.metadata) {
      message.metadata = sanitizeMessageMetadataForClient(message.metadata);
    }
  }
  return messages;
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

  if (!await getConversation(db, studentId, conversationId)) throw new Error('Conversation not found');
  const isPostgres = Boolean(db.isPostgres);
  let resolvedAccessContext = metadata?.accessContext;
  if (!resolvedAccessContext) {
    const { getAcademicContext } = require('./academic-context');
    const { contextKey } = require('./chat-security');
    const currentContext = await getAcademicContext(db, { studentId });
    resolvedAccessContext = contextKey(currentContext);
  }
  metadata = { ...(metadata || {}), accessContext: resolvedAccessContext };
  const metaStr = JSON.stringify(metadata);

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

/**
 * Retrieves an assistant message with raw server-side metadata (including _serverOnly)
 * for authenticated action execution (such as MCQ verification).
 */
async function getAssistantMessageForAction(db, studentId, conversationId, messageId = null, questionId = null) {
  await ensureSchema(db);
  if (!studentId || !conversationId) return null;
  const conv = await getConversation(db, studentId, conversationId);
  if (!conv) return null;

  let row = null;
  if (messageId && Number.isInteger(Number(messageId))) {
    row = await db.get(
      `SELECT id, conversation_id AS "conversationId", student_id AS "studentId", sender, text, metadata
       FROM ai_messages
       WHERE id = ? AND conversation_id = ? AND student_id = ? AND sender = 'assistant'`,
      Number(messageId),
      conversationId,
      studentId
    );
  }

  if (!row) {
    const rows = await db.all(
      `SELECT id, conversation_id AS "conversationId", student_id AS "studentId", sender, text, metadata
       FROM ai_messages
       WHERE conversation_id = ? AND student_id = ? AND sender = 'assistant'
       ORDER BY id DESC LIMIT 10`,
      conversationId,
      studentId
    );
    for (const candidate of rows || []) {
      let meta = null;
      try {
        meta = typeof candidate.metadata === 'string' ? JSON.parse(candidate.metadata) : candidate.metadata;
      } catch (_) {}
      if (meta?.interactiveQuestion) {
        if (!questionId || meta.interactiveQuestion.id === questionId) {
          row = candidate;
          break;
        }
      }
    }
  }

  if (!row) return null;
  let metadata = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
  } catch (_) { metadata = {}; }

  return {
    id: row.id,
    conversationId: row.conversationId || row.conversation_id,
    studentId: row.studentId || row.student_id,
    text: row.text,
    metadata
  };
}

/**
 * Updates persisted metadata on a specific assistant message owned by the student.
 */
async function updateMessageMetadata(db, studentId, messageId, nextMetadata) {
  await ensureSchema(db);
  if (!studentId || !messageId) return false;
  await db.run(
    `UPDATE ai_messages SET metadata = ? WHERE id = ? AND student_id = ?`,
    JSON.stringify(nextMetadata || {}),
    Number(messageId),
    studentId
  );
  return true;
}

/**
 * Retrieves the latest resource cards stored in ai_messages metadata for a conversation.
 * Serverless-safe persistent alternative to in-memory card maps.
 */
async function getLastCardsForConversation(db, conversationId, studentId) {
  if (!db || !conversationId || !studentId) return [];
  const messages = await getMessages(db, studentId, conversationId, 50);
  const last = [...messages].reverse().find(m => m.sender === 'assistant' && m.metadata?.resourceCards?.length);
  return last?.metadata?.resourceCards || [];
}

module.exports = {
  ensureSchema,
  getOrCreateActiveConversation,
  getConversations,
  getConversation,
  getMessages,
  saveUserMessage,
  saveAssistantMessage,
  getAssistantMessageForAction,
  updateMessageMetadata,
  clearConversation,
  deleteConversation,
  createConversation,
  getInboxPreview,
  getLastCardsForConversation
};
