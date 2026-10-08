import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import type { DmConversationItem, DmMessage } from './dm';

let dmDbPromise: Promise<SQLiteDatabase> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

// In-memory caching for zero-millisecond synchronous access
const memoryConversations = new Map<string, DmConversationItem[]>(); // accountId -> conversations
const memoryMessages = new Map<string, DmMessage[]>(); // `${accountId}:${conversationId}` -> messages

export async function getDmDatabase(): Promise<SQLiteDatabase> {
  if (!dmDbPromise) {
    dmDbPromise = (async () => {
      const db = await openDatabaseAsync('semester_library_chat.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS dm_conversations_cache_v1 (
          account_id TEXT NOT NULL,
          id TEXT NOT NULL,
          payload TEXT NOT NULL,
          last_message_at TEXT,
          PRIMARY KEY(account_id, id)
        );
        CREATE TABLE IF NOT EXISTS dm_messages_cache_v1 (
          account_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          id INTEGER NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(account_id, conversation_id, id)
        );
      `);
      return db;
    })().catch((err) => {
      dmDbPromise = null;
      throw err;
    });
  }
  return dmDbPromise;
}

// --- Conversations Caching ---
export async function getCachedDmConversations(accountId: string): Promise<DmConversationItem[]> {
  if (!accountId) return [];
  await writeQueue;

  const inMem = memoryConversations.get(accountId);
  if (inMem) return inMem;

  try {
    const db = await getDmDatabase();
    const rows = await db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM dm_conversations_cache_v1 WHERE account_id = ? ORDER BY last_message_at DESC',
      [accountId]
    );
    const parsed = rows.flatMap((r) => {
      try {
        return [JSON.parse(r.payload) as DmConversationItem];
      } catch {
        return [];
      }
    });
    memoryConversations.set(accountId, parsed);
    return parsed;
  } catch (err) {
    console.warn('[DM Cache] Read conversations error:', err);
    return [];
  }
}

export async function saveCachedDmConversations(
  accountId: string,
  items: DmConversationItem[]
): Promise<void> {
  if (!accountId) return;
  memoryConversations.set(accountId, items);

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getDmDatabase();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync('DELETE FROM dm_conversations_cache_v1 WHERE account_id = ?', [accountId]);
        for (const item of items) {
          await txn.runAsync(
            'INSERT OR REPLACE INTO dm_conversations_cache_v1 (account_id, id, payload, last_message_at) VALUES (?, ?, ?, ?)',
            [accountId, item.id, JSON.stringify(item), item.lastMessageAt || item.lastMessage?.createdAt || '']
          );
        }
      });
    } catch (err) {
      console.warn('[DM Cache] Save conversations error:', err);
    }
  });
}

// --- Messages Caching ---
export async function getCachedDmMessages(
  accountId: string,
  conversationId: string,
  limit = 50,
  beforeId?: number
): Promise<DmMessage[]> {
  if (!accountId || !conversationId) return [];
  await writeQueue;

  const key = `${accountId}:${conversationId}`;
  let messages = memoryMessages.get(key);

  if (!messages) {
    try {
      const db = await getDmDatabase();
      const rows = await db.getAllAsync<{ payload: string }>(
        'SELECT payload FROM dm_messages_cache_v1 WHERE account_id = ? AND conversation_id = ? ORDER BY id ASC',
        [accountId, conversationId]
      );
      messages = rows.flatMap((r) => {
        try {
          return [JSON.parse(r.payload) as DmMessage];
        } catch {
          return [];
        }
      });
      memoryMessages.set(key, messages);
    } catch (err) {
      console.warn('[DM Cache] Read messages error:', err);
      return [];
    }
  }

  if (beforeId) {
    return messages.filter((m) => Number(m.id) > 0 && Number(m.id) < beforeId).slice(-limit);
  }
  return messages.slice(-limit);
}

export async function saveCachedDmMessages(
  accountId: string,
  conversationId: string,
  newOrUpdatedMessages: DmMessage[]
): Promise<void> {
  if (!accountId || !conversationId) return;

  const key = `${accountId}:${conversationId}`;
  const existing = memoryMessages.get(key) || [];

  // Merge deduplicated messages
  const map = new Map<number | string, DmMessage>();
  for (const m of existing) {
    map.set(m.id, m);
  }
  for (const m of newOrUpdatedMessages) {
    map.set(m.id, m);
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  // Cap cached messages at 300 per conversation
  const retained = merged.slice(-300);
  memoryMessages.set(key, retained);

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getDmDatabase();
      await db.withExclusiveTransactionAsync(async (txn) => {
        for (const m of newOrUpdatedMessages) {
          const numId = Number(m.id);
          if (isNaN(numId) || numId <= 0) continue; // Skip temporary optimistic IDs in SQLite
          await txn.runAsync(
            'INSERT OR REPLACE INTO dm_messages_cache_v1 (account_id, conversation_id, id, payload, created_at) VALUES (?, ?, ?, ?, ?)',
            [accountId, conversationId, numId, JSON.stringify(m), m.createdAt]
          );
        }
      });
    } catch (err) {
      console.warn('[DM Cache] Save messages error:', err);
    }
  });
}

export async function updateCachedDmMessage(
  accountId: string,
  conversationId: string,
  message: DmMessage
): Promise<void> {
  return saveCachedDmMessages(accountId, conversationId, [message]);
}

export async function deleteCachedDmMessage(
  accountId: string,
  conversationId: string,
  messageId: number
): Promise<void> {
  const key = `${accountId}:${conversationId}`;
  const current = memoryMessages.get(key);
  if (current) {
    memoryMessages.set(key, current.filter((m) => m.id !== messageId));
  }

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getDmDatabase();
      await db.runAsync(
        'DELETE FROM dm_messages_cache_v1 WHERE account_id = ? AND conversation_id = ? AND id = ?',
        [accountId, conversationId, messageId]
      );
    } catch {}
  });
}

// --- Account Isolation and Logout Purge ---
export async function clearDmAccountCache(accountId: string): Promise<void> {
  if (!accountId) return;

  memoryConversations.delete(accountId);
  for (const k of memoryMessages.keys()) {
    if (k.startsWith(`${accountId}:`)) {
      memoryMessages.delete(k);
    }
  }

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getDmDatabase();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync('DELETE FROM dm_conversations_cache_v1 WHERE account_id = ?', [accountId]);
        await txn.runAsync('DELETE FROM dm_messages_cache_v1 WHERE account_id = ?', [accountId]);
      });
    } catch (err) {
      console.warn('[DM Cache] Clear account error:', err);
    }
  });
}

export async function clearAllDmCache(): Promise<void> {
  memoryConversations.clear();
  memoryMessages.clear();
  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getDmDatabase();
      await db.execAsync(`
        DELETE FROM dm_conversations_cache_v1;
        DELETE FROM dm_messages_cache_v1;
      `);
    } catch {}
  });
}
