import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import type { KyanaMessage } from './kyana';

let kyanaDbPromise: Promise<SQLiteDatabase> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

// In-memory cache for synchronous zero-latency lookups
const memoryMessages = new Map<string, KyanaMessage[]>(); // `${accountId}:${conversationId}` -> messages

export async function getKyanaDatabase(): Promise<SQLiteDatabase> {
  if (!kyanaDbPromise) {
    kyanaDbPromise = (async () => {
      const db = await openDatabaseAsync('semester_library_chat.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS kyana_messages_cache_v1 (
          account_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(account_id, conversation_id, id)
        );
      `);
      return db;
    })().catch((err) => {
      kyanaDbPromise = null;
      throw err;
    });
  }
  return kyanaDbPromise;
}

export async function getCachedKyanaMessages(
  accountId: string,
  conversationId: string
): Promise<KyanaMessage[]> {
  if (!accountId || !conversationId) return [];
  await writeQueue;

  const memKey = `${accountId}:${conversationId}`;
  const inMem = memoryMessages.get(memKey);
  if (inMem) return inMem;

  try {
    const db = await getKyanaDatabase();
    const rows = await db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM kyana_messages_cache_v1 WHERE account_id = ? AND conversation_id = ? ORDER BY created_at ASC',
      [accountId, conversationId]
    );
    const parsed = rows.flatMap((r) => {
      try {
        return [JSON.parse(r.payload) as KyanaMessage];
      } catch {
        return [];
      }
    });
    memoryMessages.set(memKey, parsed);
    return parsed;
  } catch (err) {
    console.warn('[Kyana Cache] Read messages error:', err);
    return [];
  }
}

export async function saveCachedKyanaMessages(
  accountId: string,
  conversationId: string,
  messages: KyanaMessage[]
): Promise<void> {
  if (!accountId || !conversationId) return;

  const memKey = `${accountId}:${conversationId}`;
  memoryMessages.set(memKey, messages);

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getKyanaDatabase();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          'DELETE FROM kyana_messages_cache_v1 WHERE account_id = ? AND conversation_id = ?',
          [accountId, conversationId]
        );
        for (const msg of messages) {
          await txn.runAsync(
            'INSERT OR REPLACE INTO kyana_messages_cache_v1 (account_id, conversation_id, id, payload, created_at) VALUES (?, ?, ?, ?, ?)',
            [accountId, conversationId, String(msg.id), JSON.stringify(msg), msg.createdAt || new Date().toISOString()]
          );
        }
      });
    } catch (err) {
      console.warn('[Kyana Cache] Save messages error:', err);
    }
  });

  await writeQueue;
}

export async function clearCachedKyanaMessages(
  accountId?: string,
  conversationId?: string
): Promise<void> {
  if (!accountId && !conversationId) {
    memoryMessages.clear();
  } else if (accountId && !conversationId) {
    const prefix = `${accountId}:`;
    for (const key of memoryMessages.keys()) {
      if (key.startsWith(prefix)) {
        memoryMessages.delete(key);
      }
    }
  } else if (accountId && conversationId) {
    const memKey = `${accountId}:${conversationId}`;
    memoryMessages.delete(memKey);
  } else {
    return;
  }

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await getKyanaDatabase();
      if (!accountId && !conversationId) {
        await db.runAsync('DELETE FROM kyana_messages_cache_v1');
      } else if (accountId && !conversationId) {
        await db.runAsync(
          'DELETE FROM kyana_messages_cache_v1 WHERE account_id = ?',
          [accountId]
        );
      } else if (accountId && conversationId) {
        await db.runAsync(
          'DELETE FROM kyana_messages_cache_v1 WHERE account_id = ? AND conversation_id = ?',
          [accountId, conversationId]
        );
      }
    } catch (err) {
      console.warn('[Kyana Cache] Clear messages error:', err);
    }
  });

  await writeQueue;
}

