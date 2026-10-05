import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import type { ChatMessage } from './chat';
import { applyChatReaction, mergeChatMessages, reconcileChatSnapshot } from './chat-state';
import { chatScope, getChatSession, isCurrentChatSession, type ChatSession } from './chat-session';
import type { ChatEvent } from './chat-events';

let dbPromise: Promise<SQLiteDatabase> | null = null;
let writes: Promise<unknown> = Promise.resolve();
const memory = new Map<string, ChatMessage[]>();

export function getChatDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) dbPromise = (async () => {
    const db = await openDatabaseAsync('semester_library_chat.db');
    await db.execAsync(`PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS chat_cache_v2;
      DROP TABLE IF EXISTS local_chat_messages;
      DROP TABLE IF EXISTS local_chat_meta;
      CREATE TABLE IF NOT EXISTS chat_cache_v3 (
        scope TEXT NOT NULL, id INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope, id)
      );
      CREATE TABLE IF NOT EXISTS chat_events_v3(scope TEXT NOT NULL,event_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,event_id));
      CREATE TABLE IF NOT EXISTS chat_meta_v3(scope TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,type));
      UPDATE chat_cache_v3 SET payload = json_set(payload, '$.status', 'failed')
      WHERE json_extract(payload, '$.status') = 'pending';`);
    return db;
  })().catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

export function getChatCacheScope() { return chatScope(); }

export function getMemoryChatMessages(): ChatMessage[] {
  return memory.get(chatScope()) || [];
}

async function read(db: SQLiteDatabase, key: string): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM chat_cache_v3 WHERE scope = ?', [key]);
  return mergeChatMessages([], rows.flatMap(row => {
    try { return [JSON.parse(row.payload) as ChatMessage]; } catch { return []; }
  }));
}

// Serialize mutations: a send acknowledgement, broadcast, and refresh must never
// overwrite one another. Capture the account before crossing an async boundary.
function mutate(change: (messages: ChatMessage[]) => ChatMessage[], start = getChatSession()): Promise<void> {
  const key = chatScope(start);
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
      await txn.runAsync('DELETE FROM chat_cache_v3 WHERE scope = ?', [key]);
      for (const message of retained) {
        await txn.runAsync('INSERT INTO chat_cache_v3 (scope, id, payload) VALUES (?, ?, ?)',
          [key, message.id, JSON.stringify(message)]);
      }
      memory.set(key, retained);
    });
  });
  writes = operation.catch(error => console.warn('[Chat cache]', error));
  return writes as Promise<void>;
}

export async function getCachedChatMessages(limit = 50, beforeId?: number): Promise<ChatMessage[]> {
  const start = getChatSession(), key = chatScope(start);
  if (!key) return [];
  await writes;
  try {
    let messages = memory.get(key);
    if (!messages) {
      messages = (await read(await getChatDatabase(), key)).map(m =>
        m.status === 'pending' ? { ...m, status: 'failed' as const } : m);
      memory.set(key, messages);
    }
    if (!isCurrentChatSession(start)) return [];
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
  const room = getChatSession().context?.chatGroupId;
  return mutate(previous => mergeChatMessages(previous, messages.filter(m => m.chatGroupId === room)));
}
export function reconcileCachedChat(snapshot: ChatMessage[], confirmedId: number, reset = false, previousSnapshotId = confirmedId) {
  return mutate(previous => reset
    ? mergeChatMessages(previous.filter(m => m.id < 0 || m.id > confirmedId), snapshot)
    : reconcileChatSnapshot(previous, snapshot, confirmedId, previousSnapshotId));
}
export const savePendingMessage = (message: ChatMessage) => upsertChatMessages([message]);
export function resolvePendingMessage(id: number, message: ChatMessage) {
  if (message.chatGroupId !== getChatSession().context?.chatGroupId) return Promise.resolve();
  return mutate(previous =>
    mergeChatMessages(
      previous.filter(m => m.id !== id && (!message.clientId || m.clientId !== message.clientId || m.studentId !== message.studentId)),
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
  await writes;
  memory.clear();
  const db = await getChatDatabase();
  // Remove the old unscoped cache as well when migrating an existing installation.
  await db.execAsync('DELETE FROM chat_cache_v3; DELETE FROM chat_events_v3; DELETE FROM chat_meta_v3;');
}

// State mutation and event receipt share one exclusive SQLite transaction.
// No UI callback may run until it commits; failed transactions remain retryable.
export function applyCachedChatEvent(event: ChatEvent, start: ChatSession): Promise<boolean> {
  const key = chatScope(start);
  const operation = writes.then(async () => {
    if (!isCurrentChatSession(start) || event.chatGroupId !== start.context?.chatGroupId || event.realtimeEpoch !== getChatSession().context?.realtimeEpoch) return false;
    const db = await getChatDatabase(); let applied = false; let messages: ChatMessage[] = [];
    await db.withExclusiveTransactionAsync(async tx => {
      if (await tx.getFirstAsync('SELECT event_id FROM chat_events_v3 WHERE scope=? AND event_id=?',[key,event.eventId])) return;
      messages = await read(tx,key);
      if (event.type === 'new_message') messages = mergeChatMessages(messages,[event.message]);
      if (event.type === 'delete_message') messages = messages.filter(m => m.id !== event.messageId).map(m => m.replyToId === event.messageId ? {...m,replyToId:null,replyText:undefined,replySender:undefined} : m);
      if (event.type === 'reaction_update') messages = applyChatReaction(messages,event.messageId,event.studentId,event.emoji,event.action);
      await tx.runAsync('DELETE FROM chat_cache_v3 WHERE scope=?',[key]);
      for (const m of messages.slice(0,500)) await tx.runAsync('INSERT INTO chat_cache_v3(scope,id,payload) VALUES (?,?,?)',[key,m.id,JSON.stringify(m)]);
      await tx.runAsync('INSERT OR REPLACE INTO chat_meta_v3(scope,type,payload) VALUES (?,?,?)',[key,event.type,JSON.stringify(event)]);
      await tx.runAsync('INSERT INTO chat_events_v3(scope,event_id,created_at) VALUES (?,?,?)',[key,event.eventId,Date.now()]);
      await tx.runAsync('DELETE FROM chat_events_v3 WHERE scope=? AND (created_at<? OR event_id NOT IN (SELECT event_id FROM chat_events_v3 WHERE scope=? ORDER BY created_at DESC,event_id DESC LIMIT 2000))',[key,Date.now()-7*86400000,key]);
      applied = true;
    });
    if (applied) memory.set(key,messages.slice(0,500));
    return applied && isCurrentChatSession(start) && event.realtimeEpoch === getChatSession().context?.realtimeEpoch;
  });
  writes = operation.catch(() => {});
  return operation;
}
