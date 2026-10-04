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
      byClientId.set(`${message.studentId}:${message.clientId}`, message.id);
    }
  });

  incoming.forEach((message) => {
    if (message.clientId && byClientId.has(`${message.studentId}:${message.clientId}`)) {
      const oldId = byClientId.get(`${message.studentId}:${message.clientId}`)!;
      if (oldId !== message.id) {
        byId.delete(oldId);
      }
    }
    byId.set(message.id, { ...byId.get(message.id), ...message });
    if (message.clientId) byClientId.set(`${message.studentId}:${message.clientId}`, message.id);
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
    name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_") || "attachment"
  );
}

/**
 * Determines whether an incoming message should increment the unseen message counter.
 *
 * Rules:
 * 1. If user is at/near the bottom (isNearBottom is true), messages are immediately visible -> false.
 * 2. If the message was sent by the current user -> false.
 * 3. If the message has already been seen / tracked -> false.
 * 4. If the message ID is invalid or a negative temporary ID -> false.
 * 5. Otherwise -> true.
 */
export function shouldIncrementUnseenCounter(
  message: { id: number; studentId: string; clientId?: string | null },
  currentUserId: string | undefined,
  isNearBottom: boolean,
  seenIds: Set<number | string>
): boolean {
  if (isNearBottom) return false;
  if (!message || message.id <= 0) return false;
  if (currentUserId && String(message.studentId) === String(currentUserId)) return false;
  if (seenIds.has(message.id)) return false;
  if (message.clientId && seenIds.has(message.clientId)) return false;
  return true;
}

/**
 * Formats the unseen count for display in the jump-to-bottom badge pill.
 * Returns empty string if count is 0 or less, "99+" if count > 99, otherwise the number as a string.
 */
export function formatUnseenBadge(count: number): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
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

/**
 * Formats a raw byte count into human-readable B, KB, MB, or GB.
 * Returns null if size is undefined, null, <= 0, or invalid (to avoid showing fake 0 KB).
 */
export function formatFileSize(bytes?: number | null): string | null {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    const formatted = kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
    return `${formatted.replace(/\.0$/, "")} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    const formatted = mb < 100 ? mb.toFixed(1) : String(Math.round(mb));
    return `${formatted.replace(/\.0$/, "")} MB`;
  }
  const gb = mb / 1024;
  const formatted = gb.toFixed(1).replace(/\.0$/, "");
  return `${formatted} GB`;
}

/**
 * Extracts a normalized, clean uppercase file extension (e.g. PDF, DOCX, ZIP, PPTX).
 */
export function formatFileExtension(
  filename?: string | null,
  mimeType?: string | null,
): string {
  if (filename) {
    const clean = filename.trim();
    const lastDot = clean.lastIndexOf(".");
    if (lastDot !== -1 && lastDot < clean.length - 1) {
      const ext = clean.slice(lastDot + 1).trim().toUpperCase();
      if (ext && ext.length <= 6 && /^[A-Z0-9]+$/.test(ext)) {
        return ext;
      }
    }
  }
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (lower.includes("pdf")) return "PDF";
    if (lower.includes("word") || lower.includes("officedocument.wordprocessingml")) return "DOCX";
    if (lower.includes("presentation") || lower.includes("powerpoint")) return "PPTX";
    if (lower.includes("spreadsheet") || lower.includes("excel")) return "XLSX";
    if (lower.includes("zip") || lower.includes("compressed")) return "ZIP";
    if (lower.includes("text/plain")) return "TXT";
  }
  return "FILE";
}

/**
 * Formats file subtitle with human-readable size and extension (e.g. "2.4 MB • PDF").
 * When size is unavailable, gracefully shows only file type (e.g. "PDF") rather than fake 0 KB.
 */
export function formatFileSubtitle(
  filename?: string | null,
  sizeBytes?: number | null,
  mimeType?: string | null,
): string {
  const ext = formatFileExtension(filename, mimeType);
  const size = formatFileSize(sizeBytes);
  if (size) {
    return `${size} • ${ext}`;
  }
  return ext;
}
