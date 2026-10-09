import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DmMessage } from './dm';

const PREFIX = 'dm-outbox-v1:';
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
export const dmOutboxGeneration = () => generation;
const keyFor = (account: string, conversation: string) => `${PREFIX}${account}:${conversation}`;
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
export function readDmOutbox(account: string, conversation: string): Promise<DmMessage[]> {
  return serialize(async () => {
    const stored = await AsyncStorage.getItem(keyFor(account, conversation));
    return stored ? JSON.parse(stored) : [];
  });
}
export function updateDmOutbox(account: string, conversation: string, message: DmMessage, expectedGeneration: number): Promise<void> {
  return serialize(async () => {
    if (expectedGeneration !== generation) return;
    const key = keyFor(account, conversation);
    const stored = await AsyncStorage.getItem(key);
    const items: DmMessage[] = stored ? JSON.parse(stored) : [];
    const next = items.filter(m => m.clientId !== message.clientId);
    if (typeof message.id !== 'number') next.push(message);
    if (next.length) await AsyncStorage.setItem(key, JSON.stringify(next));
    else await AsyncStorage.removeItem(key);
  });
}
export function clearDmOutbox(account?: string): Promise<void> {
  generation++;
  return serialize(async () => {
    const prefix = account ? `${PREFIX}${account}:` : PREFIX;
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  });
}
