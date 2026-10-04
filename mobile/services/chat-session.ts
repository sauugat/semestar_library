export interface ChatContext {
  studentId: string; chatGroupId: string; cohortId: string;
  groupCode: 'MERCURY' | 'VENUS' | 'EARTH' | 'MARS'; currentSemester: number;
  cohortStatus: string; roomStatus: string; realtimeEpoch: number;
}
export const CHAT_UNAVAILABLE = 'This conversation is no longer available.';
export type ChatSession = { generation: number; server: string; account: string; credential?: string | null; context: ChatContext | null };
let session: ChatSession = { generation: 0, server: '', account: '', context: null };
const listeners = new Set<() => void>();
export const getChatSession = () => session;
export const chatScope = (s = session) => s.context ? JSON.stringify([s.server, s.account, s.context.chatGroupId]) : '';
export const subscribeChatSession = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const notify = () => listeners.forEach(fn => fn());
export function invalidateChatSession() {
  session = { ...session, generation: session.generation + 1, context: null }; notify();
}
export function beginChatSession(server: string, account: string, credential?: string | null) {
  server = server.replace(/\/+$/, '');
  if (session.server !== server || session.account !== account || session.credential !== credential) {
    session = { generation: session.generation + 1, server, account, credential, context: null }; notify();
  }
  return session;
}
export function acceptChatContext(start: ChatSession, context: ChatContext) {
  if (start.generation !== session.generation || start.account !== session.account || start.server !== session.server) return false;
  if (!context?.chatGroupId || !context.cohortId || context.studentId !== session.account ||
      context.roomStatus !== 'active' || context.cohortStatus !== 'active' ||
      !['MERCURY','VENUS','EARTH','MARS'].includes(context.groupCode) || !Number.isInteger(context.realtimeEpoch)) {
    invalidateChatSession(); throw new Error(CHAT_UNAVAILABLE);
  }
  const changed = session.context?.chatGroupId !== context.chatGroupId;
  session = { ...session, generation: session.generation + (changed ? 1 : 0), context };
  notify(); return true;
}
export function captureChatSession() {
  if (!session.context) throw new Error(CHAT_UNAVAILABLE);
  return session as ChatSession & { context: ChatContext };
}
export const isCurrentChatSession = (s: ChatSession) => s.generation === session.generation && chatScope(s) !== '' && chatScope(s) === chatScope();
export function assertCurrentChatSession(s: ChatSession) { if (!isCurrentChatSession(s)) throw new Error(CHAT_UNAVAILABLE); }
export function assertLocalChatServer(server: string) {
  const host = new URL(server).hostname;
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) {
    throw new Error('Cohort chat is available on the local test server only.');
  }
}
