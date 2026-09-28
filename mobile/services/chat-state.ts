import type { ChatMessage } from "./chat";

// An inverted list starts at offset zero with the newest message already visible.
export function mergeChatMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) =>
    byId.set(message.id, { ...byId.get(message.id), ...message }),
  );
  return [...byId.values()].sort((a, b) => b.id - a.id);
}
export function applyChatReaction(
  messages: ChatMessage[],
  messageId: number,
  studentId: string,
  emoji: string,
  action: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const reactions = (message.reactions || []).filter(
      (r) => String(r.studentId) !== String(studentId),
    );
    if (action !== "remove") reactions.push({ studentId, emoji });
    return { ...message, reactions };
  });
}
export function parseChatDate(value: string): Date {
  return new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(" ", "T") + "Z"
      : value,
  );
}
export function safeChatFilename(name: string): string {
  return (
    name.replace(/[/\\\x00-\x1f]/g, "_").replace(/^\.+/, "_") || "attachment"
  );
}

// Reconcile the recent server window while keeping older, paginated history.
export function reconcileChatSnapshot(
  existing: ChatMessage[],
  snapshot: ChatMessage[],
  confirmedId: number,
): ChatMessage[] {
  const floor = snapshot.length ? Math.min(...snapshot.map((m) => m.id)) : 0;
  const ids = new Set(snapshot.map((m) => m.id));
  const retained = existing.filter(
    (m) => m.id < floor || m.id > confirmedId || ids.has(m.id),
  );
  return mergeChatMessages(retained, snapshot);
}
