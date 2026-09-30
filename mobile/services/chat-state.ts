import type { ChatMessage } from "./chat";

// An inverted list starts at offset zero with the newest message already visible.
export function mergeChatMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  const byClientId = new Map<string, number>();
  existing.forEach((message) => {
    if (message.clientId) {
      byClientId.set(message.clientId, message.id);
    }
  });

  incoming.forEach((message) => {
    if (message.clientId && byClientId.has(message.clientId)) {
      const oldId = byClientId.get(message.clientId)!;
      if (oldId !== message.id) {
        byId.delete(oldId);
      }
    }
    byId.set(message.id, { ...byId.get(message.id), ...message });
  });

  return [...byId.values()].sort((a, b) => {
    if (a.id < 0 || b.id < 0) {
      if (a.id > 0) return 1;
      if (b.id > 0) return -1;
      return a.id - b.id;
    }
    return b.id - a.id;
  });
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
  previousSnapshotId = confirmedId,
): ChatMessage[] {
  const floor = snapshot.length ? Math.min(...snapshot.map((m) => m.id)) : 0;
  const ids = new Set(snapshot.map((m) => m.id));
  const ceiling = Math.max(confirmedId, ...snapshot.map(m => m.id));
  const retained = existing.filter(
    (m) => m.id < 0 || (floor <= previousSnapshotId && m.id < floor) || m.id > ceiling || ids.has(m.id),
  );
  return mergeChatMessages(retained, snapshot);
}
