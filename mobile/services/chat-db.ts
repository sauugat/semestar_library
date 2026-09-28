import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { ChatMessage } from './chat';

const DB_NAME = 'semester_library_chat.db';
const MAX_CACHED_MESSAGES = 500;

let dbPromise: Promise<SQLiteDatabase> | null = null;

export async function getChatDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS local_chat_messages (
          id INTEGER PRIMARY KEY,
          text TEXT,
          attachmentName TEXT,
          attachmentOriginalName TEXT,
          attachmentMimeType TEXT,
          replyToId INTEGER,
          createdAt TEXT,
          studentId TEXT,
          name TEXT,
          avatarUrl TEXT,
          replyText TEXT,
          replySender TEXT,
          reactionsJson TEXT,
          status TEXT DEFAULT 'sent'
        );

        CREATE INDEX IF NOT EXISTS idx_chat_id ON local_chat_messages(id DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_created ON local_chat_messages(createdAt DESC);

        CREATE TABLE IF NOT EXISTS local_chat_meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

function parseRow(row: any): ChatMessage {
  let reactions: { studentId: string; emoji: string }[] = [];
  if (row.reactionsJson) {
    try {
      reactions = JSON.parse(row.reactionsJson);
    } catch {}
  }

  return {
    id: Number(row.id),
    text: row.text || '',
    attachmentName: row.attachmentName || null,
    attachmentOriginalName: row.attachmentOriginalName || null,
    attachmentMimeType: row.attachmentMimeType || null,
    replyToId: row.replyToId ? Number(row.replyToId) : null,
    createdAt: row.createdAt,
    studentId: String(row.studentId),
    name: row.name || 'Classmate',
    avatarUrl: row.avatarUrl || null,
    replyText: row.replyText || undefined,
    replySender: row.replySender || undefined,
    reactions,
    status: (row.status as 'sent' | 'pending' | 'failed') || 'sent',
  };
}

/**
 * Returns cached messages from SQLite ordered chronologically.
 * If beforeId is provided, returns older messages (id < beforeId).
 */
export async function getCachedChatMessages(
  limit = 50,
  beforeId?: number
): Promise<ChatMessage[]> {
  try {
    const db = await getChatDatabase();
    let rows: any[];
    if (beforeId && beforeId > 0) {
      rows = await db.getAllAsync(
        `SELECT * FROM local_chat_messages WHERE id < ? ORDER BY id DESC LIMIT ?`,
        [beforeId, limit]
      );
    } else {
      // Include pending/failed optimistic messages (negative IDs) and recent server messages
      rows = await db.getAllAsync(
        `SELECT * FROM local_chat_messages ORDER BY id DESC LIMIT ?`,
        [limit]
      );
    }
    // Convert to chronological order (oldest to newest)
    return rows.map(parseRow).reverse();
  } catch (err) {
    console.warn('[Chat DB] Failed to read cached messages:', err);
    return [];
  }
}

/**
 * Returns the highest confirmed server message ID stored in SQLite (id > 0).
 */
export async function getNewestCachedMessageId(): Promise<number> {
  try {
    const db = await getChatDatabase();
    const row = await db.getFirstAsync<{ maxId: number | null }>(
      `SELECT MAX(id) AS maxId FROM local_chat_messages WHERE id > 0`
    );
    return row?.maxId ? Number(row.maxId) : 0;
  } catch (err) {
    console.warn('[Chat DB] Failed to get newest message ID:', err);
    return 0;
  }
}

/**
 * Inserts or updates multiple messages in SQLite and prunes messages older than 500.
 */
export async function upsertChatMessages(messages: ChatMessage[]): Promise<void> {
  if (!messages || messages.length === 0) return;
  try {
    const db = await getChatDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const m of messages) {
        const reactionsJson = JSON.stringify(m.reactions || []);
        await txn.runAsync(
          `INSERT INTO local_chat_messages (
            id, text, attachmentName, attachmentOriginalName, attachmentMimeType,
            replyToId, createdAt, studentId, name, avatarUrl,
            replyText, replySender, reactionsJson, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            attachmentName = excluded.attachmentName,
            attachmentOriginalName = excluded.attachmentOriginalName,
            attachmentMimeType = excluded.attachmentMimeType,
            replyToId = excluded.replyToId,
            createdAt = excluded.createdAt,
            studentId = excluded.studentId,
            name = excluded.name,
            avatarUrl = excluded.avatarUrl,
            replyText = excluded.replyText,
            replySender = excluded.replySender,
            reactionsJson = excluded.reactionsJson,
            status = excluded.status`,
          [
            m.id,
            m.text || '',
            m.attachmentName || null,
            m.attachmentOriginalName || null,
            m.attachmentMimeType || null,
            m.replyToId || null,
            m.createdAt,
            m.studentId,
            m.name || 'Classmate',
            m.avatarUrl || null,
            m.replyText || null,
            m.replySender || null,
            reactionsJson,
            m.status || 'sent',
          ]
        );
      }

      // Prune messages older than the latest 500 (preserve optimistic messages with id < 0)
      await txn.runAsync(
        `DELETE FROM local_chat_messages
         WHERE id > 0 AND id NOT IN (
           SELECT id FROM local_chat_messages WHERE id > 0 ORDER BY id DESC LIMIT ?
         )`,
        [MAX_CACHED_MESSAGES]
      );
    });
  } catch (err) {
    console.warn('[Chat DB] Failed to upsert messages:', err);
  }
}

/**
 * Saves an optimistic message pending network confirmation.
 */
export async function savePendingMessage(message: ChatMessage): Promise<void> {
  try {
    const db = await getChatDatabase();
    const reactionsJson = JSON.stringify(message.reactions || []);
    await db.runAsync(
      `INSERT OR REPLACE INTO local_chat_messages (
        id, text, attachmentName, attachmentOriginalName, attachmentMimeType,
        replyToId, createdAt, studentId, name, avatarUrl,
        replyText, replySender, reactionsJson, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.text || '',
        message.attachmentName || null,
        message.attachmentOriginalName || null,
        message.attachmentMimeType || null,
        message.replyToId || null,
        message.createdAt,
        message.studentId,
        message.name || 'Classmate',
        message.avatarUrl || null,
        message.replyText || null,
        message.replySender || null,
        reactionsJson,
        'pending',
      ]
    );
  } catch (err) {
    console.warn('[Chat DB] Failed to save pending message:', err);
  }
}

/**
 * Replaces a pending message with the confirmed server message.
 */
export async function resolvePendingMessage(
  tempId: number,
  serverMessage: ChatMessage
): Promise<void> {
  try {
    const db = await getChatDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(`DELETE FROM local_chat_messages WHERE id = ?`, [tempId]);
      const reactionsJson = JSON.stringify(serverMessage.reactions || []);
      await txn.runAsync(
        `INSERT OR REPLACE INTO local_chat_messages (
          id, text, attachmentName, attachmentOriginalName, attachmentMimeType,
          replyToId, createdAt, studentId, name, avatarUrl,
          replyText, replySender, reactionsJson, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          serverMessage.id,
          serverMessage.text || '',
          serverMessage.attachmentName || null,
          serverMessage.attachmentOriginalName || null,
          serverMessage.attachmentMimeType || null,
          serverMessage.replyToId || null,
          serverMessage.createdAt,
          serverMessage.studentId,
          serverMessage.name || 'Classmate',
          serverMessage.avatarUrl || null,
          serverMessage.replyText || null,
          serverMessage.replySender || null,
          reactionsJson,
          'sent',
        ]
      );
    });
  } catch (err) {
    console.warn('[Chat DB] Failed to resolve pending message:', err);
  }
}

/**
 * Marks a pending message as failed.
 */
export async function markPendingMessageFailed(tempId: number): Promise<void> {
  try {
    const db = await getChatDatabase();
    await db.runAsync(
      `UPDATE local_chat_messages SET status = 'failed' WHERE id = ?`,
      [tempId]
    );
  } catch (err) {
    console.warn('[Chat DB] Failed to mark message failed:', err);
  }
}

/**
 * Deletes a message from SQLite.
 */
export async function deleteCachedMessage(id: number): Promise<void> {
  try {
    const db = await getChatDatabase();
    await db.runAsync(`DELETE FROM local_chat_messages WHERE id = ?`, [id]);
  } catch (err) {
    console.warn('[Chat DB] Failed to delete cached message:', err);
  }
}

/**
 * Updates a reaction on a cached message in SQLite.
 */
export async function updateCachedReaction(
  messageId: number,
  studentId: string,
  emoji: string
): Promise<void> {
  try {
    const db = await getChatDatabase();
    const row = await db.getFirstAsync<{ reactionsJson: string | null }>(
      `SELECT reactionsJson FROM local_chat_messages WHERE id = ?`,
      [messageId]
    );
    if (!row) return;

    let reactions: { studentId: string; emoji: string }[] = [];
    if (row.reactionsJson) {
      try {
        reactions = JSON.parse(row.reactionsJson);
      } catch {}
    }

    const existingIndex = reactions.findIndex((r) => r.studentId === studentId);
    if (existingIndex >= 0) {
      if (reactions[existingIndex].emoji === emoji) {
        reactions.splice(existingIndex, 1);
      } else {
        reactions[existingIndex].emoji = emoji;
      }
    } else {
      reactions.push({ studentId, emoji });
    }

    await db.runAsync(
      `UPDATE local_chat_messages SET reactionsJson = ? WHERE id = ?`,
      [JSON.stringify(reactions), messageId]
    );
  } catch (err) {
    console.warn('[Chat DB] Failed to update reaction:', err);
  }
}

/**
 * Clears all cached chat data on sign out.
 */
export async function clearChatDb(): Promise<void> {
  try {
    const db = await getChatDatabase();
    await db.execAsync(`
      DELETE FROM local_chat_messages;
      DELETE FROM local_chat_meta;
    `);
  } catch (err) {
    console.warn('[Chat DB] Failed to clear chat database:', err);
  }
}
