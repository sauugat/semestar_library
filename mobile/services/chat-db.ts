import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import type { ChatMessage } from './chat';
import { applyChatReaction, mergeChatMessages, reconcileChatSnapshot } from './chat-state';

let scope = '';
let dbPromise: Promise<SQLiteDatabase> | null = null;
let writes: Promise<unknown> = Promise.resolve();
const memory = new Map<string, ChatMessage[]>();

export function getChatDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) dbPromise = (async () => {
    const db = await openDatabaseAsync('semester_library_chat.db');
    await db.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chat_cache_v2 (
        scope TEXT NOT NULL, id INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope, id)
      );
      UPDATE chat_cache_v2 SET payload = json_set(payload, '$.status', 'failed')
      WHERE json_extract(payload, '$.status') = 'pending';`);
    return db;
  })().catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

export function configureChatCache(serverUrl: string, studentId: string) {
  scope = `${serverUrl.replace(/\/+$/, '')}|${studentId}`;
}

export function getChatCacheScope() { return scope; }

export function getMemoryChatMessages(): ChatMessage[] {
  return memory.get(scope) || [];
}

async function read(db: SQLiteDatabase, key: string): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM chat_cache_v2 WHERE scope = ?', [key]);
  return mergeChatMessages([], rows.flatMap(row => {
    try { return [JSON.parse(row.payload) as ChatMessage]; } catch { return []; }
  }));
}

// Serialize mutations: a send acknowledgement, broadcast, and refresh must never
// overwrite one another. Capture the account before crossing an async boundary.
function mutate(change: (messages: ChatMessage[]) => ChatMessage[]): Promise<void> {
  const key = scope;
  if (!key) return Promise.resolve();
  // Optimistically update memory cache immediately so synchronous callers see state in 0ms
  const currentMem = memory.get(key);
  if (currentMem) {
    const updated = change(currentMem);
    let confirmed = 0;
    memory.set(key, updated.filter(m => m.id < 0 || ++confirmed <= 500));
  }
  const operation = writes.then(async () => {
    const db = await getChatDatabase();
    await db.withExclusiveTransactionAsync(async txn => {
      const messages = change(await read(txn, key));
      let confirmed = 0;
      const retained = messages.filter(m => m.id < 0 || ++confirmed <= 500);
      await txn.runAsync('DELETE FROM chat_cache_v2 WHERE scope = ?', [key]);
      for (const message of retained) {
        await txn.runAsync('INSERT INTO chat_cache_v2 (scope, id, payload) VALUES (?, ?, ?)',
          [key, message.id, JSON.stringify(message)]);
      }
      memory.set(key, retained);
    });
  });
  writes = operation.catch(error => console.warn('[Chat cache]', error));
  return writes as Promise<void>;
}

export async function getCachedChatMessages(limit = 50, beforeId?: number): Promise<ChatMessage[]> {
  const key = scope;
  if (!key) return [];
  await writes;
  try {
    let messages = memory.get(key);
    if (!messages) {
      messages = (await read(await getChatDatabase(), key)).map(m =>
        m.status === 'pending' ? { ...m, status: 'failed' as const } : m);
      memory.set(key, messages);
    }
    if (beforeId) return messages.filter(m => m.id > 0 && m.id < beforeId).slice(0, limit);
    return [...messages.filter(m => m.id < 0), ...messages.filter(m => m.id > 0).slice(0, limit)];
  } catch (error) {
    console.warn('[Chat cache read]', error);
    return [];
  }
}

export async function getNewestCachedMessageId(): Promise<number> {
  return Math.max(0, ...(await getCachedChatMessages()).map(m => m.id));
}
export function upsertChatMessages(messages: ChatMessage[]) {
  return mutate(previous => mergeChatMessages(previous, messages));
}
export function reconcileCachedChat(snapshot: ChatMessage[], confirmedId: number, reset = false, previousSnapshotId = confirmedId) {
  return mutate(previous => reset
    ? mergeChatMessages(previous.filter(m => m.id < 0 || m.id > confirmedId), snapshot)
    : reconcileChatSnapshot(previous, snapshot, confirmedId, previousSnapshotId));
}
export const savePendingMessage = (message: ChatMessage) => upsertChatMessages([message]);
export function resolvePendingMessage(id: number, message: ChatMessage) {
  return mutate(previous =>
    mergeChatMessages(
      previous.filter(m => m.id !== id && (!message.clientId || m.clientId !== message.clientId)),
      [{ ...message, status: 'sent' }]
    )
  );
}
export function markPendingMessageFailed(id: number) {
  return mutate(previous => previous.map(m => m.id === id ? { ...m, status: 'failed' } : m));
}
export function deleteCachedMessage(id: number) {
  return mutate(previous => previous.filter(m => m.id !== id).map(m => m.replyToId === id
    ? { ...m, replyToId: null, replyText: undefined, replySender: undefined } : m));
}
export function updateCachedReaction(messageId: number, studentId: string, emoji: string, action: string) {
  return mutate(previous => applyChatReaction(previous, messageId, studentId, emoji, action));
}
export async function clearChatDb() {
  scope = '';
  await writes;
  memory.clear();
  const db = await getChatDatabase();
  // Remove the old unscoped cache as well when migrating an existing installation.
  await db.execAsync('DELETE FROM chat_cache_v2; DROP TABLE IF EXISTS local_chat_messages; DROP TABLE IF EXISTS local_chat_meta;');
}
