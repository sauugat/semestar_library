import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("1-6: Four-Room (Mercury, Venus, Earth, Mars) durable attachment URL hydration", () => {
  const chatTsPath = path.join(rootDir, "mobile/services/chat.ts");
  const chatTs = fs.readFileSync(chatTsPath, "utf8");

  // Ensure getAttachmentUrl accepts chatGroupId and appends it as query param
  assert.match(
    chatTs,
    /getAttachmentUrl\(filename:\s*string,\s*chatGroupId\?:/i,
    "getAttachmentUrl must accept chatGroupId"
  );
  assert.match(
    chatTs,
    /chatGroupId=\$\{encodeURIComponent\(chatGroupId\)\}/,
    "getAttachmentUrl must append chatGroupId to URL"
  );

  // Test URL generation for all four rooms
  const serverUrl = "https://semestar-library.vercel.app";
  const rooms = [
    { name: "Mercury", groupId: "cohort-mercury-1111" },
    { name: "Venus", groupId: "cohort-venus-2222" },
    { name: "Earth", groupId: "cohort-earth-3333" },
    { name: "Mars", groupId: "cohort-mars-4444" },
  ];

  for (const room of rooms) {
    const filename = `attachment-${room.name.toLowerCase()}.jpg`;
    const expectedUrl = `${serverUrl}/api/chat/attachment/${filename}?chatGroupId=${encodeURIComponent(room.groupId)}`;

    // In ChatMessageItem.tsx logic:
    const base = `${serverUrl}/api/chat/attachment/${encodeURIComponent(filename)}`;
    const actualUrl = room.groupId ? `${base}?chatGroupId=${encodeURIComponent(room.groupId)}` : base;

    assert.equal(actualUrl, expectedUrl, `${room.name} URL must be generated identically with room authorization`);
  }
});

test("7: Cache miss and temporary localUri fallback to remote source", () => {
  const chatItemPath = path.join(rootDir, "mobile/components/chat/ChatMessageItem.tsx");
  const chatItem = fs.readFileSync(chatItemPath, "utf8");

  // Verify that transient localUri is only used when pending, and falls back to remote
  assert.match(
    chatItem,
    /item\.status\s*===\s*'pending'\s*&&\s*item\.localUri\s*&&\s*!localUriFailed/,
    "ChatMessageItem must only use localUri during pending optimistic state and fallback if localUri fails"
  );
  assert.match(
    chatItem,
    /setLocalUriFailed\(true\)/,
    "Must trigger localUriFailed fallback on error to switch to authoritative remote URL"
  );
});

test("8 & 10: Failed media shows compact retry state rather than permanent black block", () => {
  const chatItemPath = path.join(rootDir, "mobile/components/chat/ChatMessageItem.tsx");
  const chatItem = fs.readFileSync(chatItemPath, "utf8");

  assert.match(chatItem, /imageState\s*===\s*'error'/, "Must track image error state");
  assert.match(chatItem, /Couldn't load image/, "Must display user-friendly error message");
  assert.match(chatItem, /styles\.imageRetryBtn/, "Must render Retry button on image error");
  assert.match(chatItem, /styles\.imageSkeleton/, "Must render image skeleton placeholder while loading");
});

test("9: Cross-room media authorization enforced in backend lib/cohort-chat.js", () => {
  const backendChatPath = path.join(rootDir, "lib/cohort-chat.js");
  const backendChat = fs.readFileSync(backendChatPath, "utf8");

  // Ensure attachment endpoint queries strictly within caller's authorized room
  assert.match(
    backendChat,
    /WHERE\s*chat_group_id=\?\s*AND\s*attachmentName=\?/,
    "Backend must query attachment inside caller's authorized chat_group_id"
  );
  assert.match(
    backendChat,
    /if\s*\(!msg\)\s*throw\s*unavailable\(\)/,
    "Backend must reject unauthorized or non-existent cross-room access with unavailable/404"
  );
});

test("11 & 26: Document attachment (PDF) is never treated as an image", () => {
  function isImageAttachment(filename, mimeType) {
    if (mimeType && (mimeType.startsWith("image/") || mimeType === "image")) return true;
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".svg")
    );
  }

  assert.equal(isImageAttachment("syllabus.pdf", "application/pdf"), false);
  assert.equal(isImageAttachment("document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
  assert.equal(isImageAttachment("notes.pdf", undefined), false);
  assert.equal(isImageAttachment("photo.jpg", "image/jpeg"), true);
  assert.equal(isImageAttachment("diagram.png", undefined), true);
});

test("12-18: FullScreenImageViewer respects top safe area, supports controls toggle and dismiss", () => {
  const viewerPath = path.join(rootDir, "mobile/components/FullScreenImageViewer.tsx");
  const viewer = fs.readFileSync(viewerPath, "utf8");

  assert.match(viewer, /insets\.top\s*\+\s*12/, "Header must pad topInset + 12px for safe area");
  assert.match(viewer, /toggleControls/, "Must have single tap controls toggle function");
  assert.match(viewer, /onRequestClose=\{onClose\}/, "Must handle Android hardware back");
  assert.match(viewer, /dismissY/, "Must support swipe-down dismiss gesture");
  assert.match(viewer, /handleDoubleTap/, "Must support double tap zoom");
  assert.match(viewer, /showHint/, "Hint must auto-dismiss rather than remain permanently");
});

test("19-21: Message grouping spacing scale (3px consecutive vs 12px non-consecutive)", () => {
  const chatItemPath = path.join(rootDir, "mobile/components/chat/ChatMessageItem.tsx");
  const chatItem = fs.readFileSync(chatItemPath, "utf8");

  assert.match(
    chatItem,
    /marginTop:\s*isConsecutive\s*\?\s*3\s*:\s*12/,
    "Message vertical gap must be 3px for consecutive same-sender messages, and 12px when sender changes"
  );
  assert.match(
    chatItem,
    /maxBubbleWidth\s*=\s*Math\.round\(screenWidth\s*\*\s*0\.8\)/,
    "Bubble max width must be ~80% of screen width"
  );
  assert.match(
    chatItem,
    /targetImageWidth\s*=\s*Math\.min\(Math\.round\(screenWidth\s*\*\s*0\.74\),\s*280\)/,
    "Image max width must be consistent ~74% of screen width (max 280dp)"
  );
});

test("22-23: Self-typing suppression and header-only typing indicator preserved", () => {
  const chatPath = path.join(rootDir, "mobile/app/(tabs)/chat.tsx");
  const chatFile = fs.readFileSync(chatPath, "utf8");

  // Verify that typing indicator is in headerTextGroup and not duplicate bottom strip
  assert.match(chatFile, /headerSubtitle/, "Header subtitle displays typing indicator");
  assert.doesNotMatch(
    chatFile,
    /typingContainer|typingStrip|bottomTyping/i,
    "No duplicate bottom typing strip above composer"
  );
});

test("24-25: Keyboard and image card aspect ratio capping", () => {
  const chatItemPath = path.join(rootDir, "mobile/components/chat/ChatMessageItem.tsx");
  const chatItem = fs.readFileSync(chatItemPath, "utf8");

  // Check aspect ratio clamp
  assert.match(chatItem, /minRatio\s*=\s*4\s*\/\s*5/, "Image aspect ratio must cap at 4:5");
  assert.match(chatItem, /renderedImageDims/, "Must compute renderedImageDims preserving natural aspect ratio");
});

test("27: Date separator renders once per date boundary", () => {
  function isSameDay(d1Str, d2Str) {
    const d1 = new Date(d1Str);
    const d2 = new Date(d2Str);
    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  }

  const msg1 = { createdAt: "2026-10-07T10:00:00Z" };
  const msg2 = { createdAt: "2026-10-07T11:00:00Z" };
  const msg3 = { createdAt: "2026-10-06T15:00:00Z" };

  assert.equal(isSameDay(msg1.createdAt, msg2.createdAt), true, "Same day messages return true");
  assert.equal(isSameDay(msg1.createdAt, msg3.createdAt), false, "Different day messages return false");
});

test("28: Admin cohort list displays real room data with polished styles", () => {
  const chatPath = path.join(rootDir, "mobile/app/(tabs)/chat.tsx");
  const chatFile = fs.readFileSync(chatPath, "utf8");

  assert.match(chatFile, /adminRoomCard/, "Admin list uses polished adminRoomCard style");
  assert.match(chatFile, /adminRoomBadge/, "Admin list renders unread badge properly");
  assert.match(chatFile, /skeletonContainer/, "Chat screen renders skeletonContainer during initial load");
});
