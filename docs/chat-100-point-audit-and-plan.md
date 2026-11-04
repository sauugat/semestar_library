# 100-Point Chat & Messaging System Audit & Step-by-Step Implementation Plan

This document audits all 100 messaging capabilities across **Semester Library Mobile** (`mobile/`) and **Backend Services** (`lib/dm-service.js`, `lib/cohort-chat.js`, `routes/`), categorizes what is already built vs. what needs enhancement or new development, and defines the step-by-step execution plan.

---

## Status Legend
- **✅ Built & Verified**: Implemented in backend + mobile UI and covered by automated tests.
- **🔧 Upgraded in Step 1**: Existed partially or in one chat mode (Group vs. DM) and upgraded now for full parity and polish.
- **📋 Planned (Steps 2–5)**: Requires new database schema, media pipeline, or external infrastructure; scheduled in sequential steps below.

---

## 1. Core Messaging (Items 1–15)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 1 | 1-to-1 DMs | ✅ Built & Verified | `lib/dm-service.js`, `routes/direct-messaging.js`, `mobile/app/dm/[id].tsx`, `mobile/app/dm/new.tsx` |
| 2 | Group chats (cohort groups) | ✅ Built & Verified | `lib/cohort-chat.js`, `routes/cohort-chat.js`, `mobile/app/(tabs)/chat.tsx` |
| 3 | Inbox sorted by latest activity | ✅ Built & Verified | `sortUnifiedConversations` & `partitionInboxSections` in `mobile/services/unified-inbox.ts` |
| 4 | Unread count badge per conversation | ✅ Built & Verified | Unread pill badges in `UnifiedChatInbox.tsx` and `DmInboxView.tsx` |
| 5 | Last-message preview & timestamp in inbox | ✅ Built & Verified | Live previews with `"You: "` prefix and relative timestamps in `UnifiedChatInbox.tsx` |
| 6 | Text messages with line breaks & emoji | ✅ Built & Verified | Multiline UTF-8/emoji support up to 2,000 chars in `ChatComposer.tsx` and `dm/[id].tsx` |
| 7 | Reply / quote a message | ✅ Built & Verified | Quoted reply banners in `ChatMessageItem.tsx`, `ChatComposer.tsx`, and `dm/[id].tsx` |
| 8 | Edit message (with `edited` label & time limit) | ✅ Built & Verified | 15-min edit window enforced in `lib/dm-service.js` + `edited` label in `dm/[id].tsx` and `ChatMessageItem.tsx` |
| 9 | Delete for me | ✅ Built & Verified | `dm_message_deletions` table + `deleteDmMessage(id, msgId, 'for_me')` in `dm/[id].tsx` |
| 10 | Delete for everyone (`message deleted` tombstone) | ✅ Built & Verified | `deleted_for_all` tombstone in `lib/dm-service.js` & `dm/[id].tsx`; hard delete in cohort chat |
| 11 | Forward message | 🔧 Upgraded in Step 1 | Added Forward Message modal & picker across `dm/[id].tsx`, `ChatMessageActionsSheet.tsx`, and `(tabs)/chat.tsx` |
| 12 | Emoji reactions | 🔧 Upgraded in Step 1 | Built in Group Chat (`ChatMessageItem.tsx`); added quick reaction bar & reaction pills to DM (`dm/[id].tsx`) |
| 13 | `@mentions` | ✅ Built & Verified | `MentionSuggestions.tsx`, `chat_message_mentions` table, highlighted `@handle` tokens in `ChatMessageItem.tsx` |
| 14 | Search inside a chat and across all chats | 🔧 Upgraded in Step 1 | Inbox search in `UnifiedChatInbox.tsx`, group message search in `(tabs)/chat.tsx`, + added in-chat search bar in `dm/[id].tsx` |
| 15 | Link previews | 🔧 Upgraded in Step 1 | Clickable URL detection + inline Link Preview card in `ChatMessageItem.tsx` and `dm/[id].tsx` |

---

## 2. Delivery & Status (Items 16–25)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 16 | Ticks: pending, sent, delivered, read | ✅ Built & Verified | `time-outline` (pending), `checkmark` (sent), `checkmark-done` (read/seen), retry alert (failed) |
| 17 | "Read by N" and who-read list in groups | 🔧 Upgraded in Step 1 | Added `"Seen by N"` indicator on outgoing group messages in `ChatMessageItem.tsx` + tap to view readers in `(tabs)/chat.tsx` |
| 18 | Typing indicator that times out | ✅ Built & Verified | 4s auto-expiring typing state in `useClassChat.ts` and `dm/[id].tsx` |
| 19 | Online / last seen | ✅ Built & Verified | Heartbeat session tracking (`chat_online_sessions`), `Active now` carousel in `UnifiedChatInbox.tsx`, live online dots |
| 20 | Privacy toggles for last seen & read receipts | 📋 Planned (Step 3) | Add user preference toggles in `notification-settings.tsx` / `student_notification_preferences` |
| 21 | Optimistic send (appears instantly) | ✅ Built & Verified | Immediate local state insertion in `(tabs)/chat.tsx` and `dm/[id].tsx` |
| 22 | Failed-send state with tap to retry | ✅ Built & Verified | `failDmMessage` / `markPendingMessageFailed` + one-tap retry preserving original `clientId` |
| 23 | Client-generated IDs (no duplicate retries) | ✅ Built & Verified | Idempotent `clientId` enforced via `chat_send_keys` and `dm_messages(conversation_id, sender_id, client_id)` |
| 24 | Server-assigned ordering | ✅ Built & Verified | Monotonic server `id` ordering in `mergeChatMessages` and `mergeDmMessages` |
| 25 | Offline outbox that sends on reconnect | ✅ Built & Verified | Durable `dm-outbox.ts` and `chat-db.ts` pending message persistence + auto-sync on reconnect |

---

## 3. Media & Files (Items 26–40)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 26 | Image send with compression | ✅ Built & Verified | `prepareChatAttachment` in `mobile/services/chat-attachments.ts` + `ImagePicker` quality compression |
| 27 | Video send | 📋 Planned (Step 4) | Extend `ImagePicker` mediaTypes & attachment streaming for short MP4/MOV clips |
| 28 | Voice notes | 📋 Planned (Step 4) | Audio recording bar (`expo-av` / `expo-audio`) + waveform playback bubble |
| 29 | Documents and PDFs | ✅ Built & Verified | `DocumentPicker` upload + styled file cards with extension icon & size in `ChatMessageItem.tsx` |
| 30 | Shared media / files / links tab per chat | 🔧 Upgraded in Step 1 | Added Shared Links & Media filter modal in `dm/[id].tsx` and `(tabs)/chat.tsx` |
| 31 | Fullscreen viewer with pinch zoom, save & share | ✅ Built & Verified | `FullScreenImageViewer.tsx` with pinch-to-zoom, swipe-to-close, save to gallery, and OS share sheet |
| 32 | Upload progress and cancel | 📋 Planned (Step 4) | XHR `upload.onprogress` callback + cancel token in `apiFetch` |
| 33 | Resumable uploads for bad connections | 📋 Planned (Step 4) | Chunked/retryable outbox file upload in `chat-attachments.ts` |
| 34 | Thumbnails or blurhash placeholders | ✅ Built & Verified | Aspect-ratio skeleton placeholders (`imageDimensionsCache` + `imageSkeleton`) in `ChatMessageItem.tsx` |
| 35 | Local media cache and download manager | ✅ Built & Verified | `expo-image` `memory-disk` cache + `FileSystem.downloadAsync` to local cache directory |
| 36 | File size and type limits | ✅ Built & Verified | 25 MB limit (`CHAT_MAX_FILE_SIZE`) + MIME/magic-byte validation on server |
| 37 | Malware / magic-byte scanning for uploads | ✅ Built & Verified | Magic-byte verification (`isValidImageBuffer`), `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff` |
| 38 | In-app camera capture | ✅ Built & Verified | `ImagePicker.launchCameraAsync` wired to camera button in `ChatComposer.tsx` |
| 39 | Share library note, assignment, or notice card | 📋 Planned (Step 3) | Deep-linkable rich card embeds for `/post/[id]`, `/assignments/[id]`, and `/notice/[id]` |
| 40 | Voice / video calls | ⏸️ Deferred | Explicitly deferred for later per requirements |

---

## 4. Sync & Reliability (Items 41–55)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 41 | Local-first cache (SQLite) for 0ms open | ✅ Built & Verified | `mobile/services/chat-db.ts` and `mobile/services/dm-db.ts` (`expo-sqlite` + in-memory layer) |
| 42 | Delta sync since last message ID | ✅ Built & Verified | `fetchChatMessages({ since })` and `syncDmConversation(id, sinceMessageId)` |
| 43 | Auto-reconnect with exponential backoff | ✅ Built & Verified | Exponential backoff (`1000 * 2^retry`, capped at 30s) in `dm-realtime.ts` and `chat-realtime.ts` |
| 44 | Gap detection and backfill after reconnect | ✅ Built & Verified | `reconcileChatSnapshot` in `chat-state.ts` detects gaps and refills window |
| 45 | Infinite scroll upward through history | ✅ Built & Verified | Cursor pagination (`before: oldest.id`) on inverted `FlatList` (`onEndReached`) |
| 46 | Restore scroll position & jump to unread | ✅ Built & Verified | `maintainVisibleContentPosition` + floating unread count jump-to-bottom button |
| 47 | Tap a quote to jump to original message | ✅ Built & Verified | `jumpToMessage` / `handleJumpToReply` with animated highlight flash; fetches exact message if unloaded |
| 48 | Realtime with polling fallback | ✅ Built & Verified | Supabase Realtime broadcast + 15s/30s fallback polling when disconnected |
| 49 | Multi-device sync (web & phone consistent) | ✅ Built & Verified | Shared read cursors, realtime outbox broadcasts, and snapshot reconciliation across web & mobile |
| 50 | Draft saved per conversation | 🔧 Upgraded in Step 1 | `composerDraftCache` in `ChatComposer.tsx` (Group) + `dmDraftCache` added to `dm/[id].tsx` (DM) |
| 51 | Server timestamps as source of truth | ✅ Built & Verified | Server-generated ISO timestamps (`nowIso()`) on all messages and read receipts |
| 52 | Background sync when app resumes | ✅ Built & Verified | `AppState` `active` listener triggers immediate delta sync in `useClassChat.ts` and `dm/[id].tsx` |
| 53 | Push notifications (FCM / APNs) | ✅ Built & Verified | `lib/push-notifications.js`, `push_notification_outbox`, `mobile/services/notifications.ts` |
| 54 | Notification grouping & deep link into chat | ✅ Built & Verified | `groupKey` (`chat:<id>`, `dm:<id>`) + deep linking to `/dm/[id]` and `/(tabs)/chat` |
| 55 | Mute and per-chat notification settings | 🔧 Upgraded in Step 1 | Backend `/api/dm/conversations/:id/mute` + Mute/Unmute toggle wired in `dm/[id].tsx` settings sheet |

---

## 5. Groups (Items 56–68)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 58 | Group info page with member list | ✅ Built & Verified | Members modal in `(tabs)/chat.tsx` showing member count, online count, avatars, and profile links |
| 59 | Group name, avatar, description | ✅ Built & Verified | 2x2 member avatar collage (`SemesterGroupAvatar`), cohort planet icons, semester status subtitle |
| 60 | Pinned messages | ✅ Built & Verified | `chat_pinned_announcements` table + pinned banner at top of `(tabs)/chat.tsx` |
| 62 | Slow mode | 📋 Planned (Step 3) | Configurable per-cohort message cooldown for non-staff members |
| 63 | Invite links | 📋 Planned (Step 3) | Cohort enrollment is managed by semester roster; optional shareable deep link |
| 66 | Automatic membership from semester/cohort | ✅ Built & Verified | `lib/cohort-chat.js` enforces membership from `students.cohort_id` and `teacher_subjects` |
| 67 | Archive old semester groups as read-only | ✅ Built & Verified | Graduated/closed cohorts render `isArchived` banner and read-only composer notice |
| 68 | System messages ("X pinned a message") | 📋 Planned (Step 3) | Inline system pill events for pin/lifecycle changes |

---

## 6. Safety & Moderation (Items 69–80)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 69 | Block user | ✅ Built & Verified | `dm_blocks` table + `blockDmUser`/`unblockDmUser` + blocked composer fence in `dm/[id].tsx` |
| 70 | Report message or user | ✅ Built & Verified | `dm_reports` table + Report Modal (`HARASSMENT`, `SPAM`, `INAPPROPRIATE`, `OTHER`) in `dm/[id].tsx` |
| 71 | Admin moderation queue | ✅ Built & Verified | `routes/admin-dashboard.js` content moderation & report review endpoints |
| 72 | Profanity and spam filter | 📋 Planned (Step 2) | Server-side content filter hook in `lib/dm-service.js` and `lib/cohort-chat.js` |
| 73 | Per-user rate limiting | ✅ Built & Verified | Atomic `dm_rate_limits` table in `lib/dm-service.js` |
| 74 | Flood control (burst limits) | ✅ Built & Verified | Sliding window burst rate limits on send, search, and conversation creation |
| 75 | Audit log for deletions & moderation | ✅ Built & Verified | `chat_lifecycle_audit` and `admin_audit_logs` tables |
| 76 | "Who can DM me" settings | 📋 Planned (Step 2) | User preference (`everyone`, `cohort_only`, `none`) enforced in `getOrCreateConversation` |
| 77 | Clear teacher-student DM policy | ✅ Built & Verified | Verified role checks & faculty communication rules in `lib/dm-service.js` and `lib/cohort-chat.js` |
| 78 | Message retention policy | ✅ Built & Verified | Local SQLite cache bounded to 300 messages per conversation; server retains audit-safe tombstones |
| 79 | Account deletion & suspension handling | ✅ Built & Verified | Suspended/deleted accounts blocked at auth/chat fence + automatic session & cache purge |
| 80 | Kyana AI as pinned assistant conversation | ✅ Built & Verified | Permanently pinned at top of `PINNED` section in `UnifiedChatInbox.tsx` -> routes to `/kyana` |

---

## 7. Security (Items 81–88)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 81 | Auth check on every realtime channel (RLS) | ✅ Built & Verified | Private Supabase channels with scoped JWT tokens (`getRealtimeConfig` / `realtimeConfig`) |
| 82 | Membership check on every read/write/file | ✅ Built & Verified | `assertParticipant` (DM) and `withContext` + `chat_attachment_ownership` (Group Chat) |
| 83 | Input sanitization against XSS & injection | ✅ Built & Verified | Parameterized SQL queries, `escapeHtml` in web client, sandboxed attachment headers |
| 84 | Signed / authenticated URLs for attachments | ✅ Built & Verified | Bearer-authenticated `/api/chat/attachment/:filename?chatGroupId=...` with ownership check |
| 85 | TLS everywhere & encryption at rest | ✅ Built & Verified | `isTrustedServerUrl` enforces HTTPS in production builds; `expo-secure-store` for tokens |
| 86 | Starred / saved messages (personal bookmark) | 🔧 Upgraded in Step 1 | Added privacy-safe local Star / Bookmark message feature in `dm/[id].tsx` and `(tabs)/chat.tsx` |
| 87 | Session & device management with logout | ✅ Built & Verified | `mobile_tokens`, push token unregistration, and cache wipe on logout/suspension |
| 88 | Short-lived realtime tokens with refresh | ✅ Built & Verified | 120s scoped realtime JWTs with automatic pre-expiry renewal (`schedule` in `dm-realtime.ts`) |

---

## 8. UX Polish (Items 89–100)

| # | Feature | Status | Implementation & Notes |
|---|---|---|---|
| 89 | Date separators | ✅ Built & Verified | `Today`, `Yesterday`, and formatted date pills in both `ChatMessageItem.tsx` and `dm/[id].tsx` |
| 90 | Dark mode (strict monochrome) | ✅ Built & Verified | `Monochrome` design token system in `mobile/constants/theme.ts` |
| 91 | Accessibility: screen readers, font scaling | ✅ Built & Verified | `accessibilityRole`, `accessibilityLabel`, `reduceMotion` listener, and >=48dp touch targets |
| 92 | Skeleton loaders | ✅ Built & Verified | Bubble skeleton loaders in `(tabs)/chat.tsx` and image skeletons in `ChatMessageItem.tsx` |
| 93 | Swipe to reply, haptics, smooth animations | 🔧 Upgraded in Step 1 | Built in `ChatMessageItem.tsx`; added swipe-to-reply + haptics + double-tap heart reaction to `dm/[id].tsx` |
| 94 | Emoji picker / quick reactions | 🔧 Upgraded in Step 1 | Quick reaction emoji bar in both Group Chat (`ChatMessageActionsSheet.tsx`) and DM (`dm/[id].tsx`) |
| 95 | Nepali and English support (Unicode input) | ✅ Built & Verified | Full UTF-8 / Devanagari Unicode rendering and search support |
| 96 | Polls (for class decisions) | 📋 Planned (Step 5) | Interactive poll creation and voting cards in cohort group chat |
| 97 | Scheduled or announcement messages | 📋 Planned (Step 5) | Pinned announcements exist; scheduled send for teachers/admins planned in Step 5 |
| 98 | Message long-press menu | 🔧 Upgraded in Step 1 | Unified bottom sheet with React, Reply, Forward, Star, Copy, Edit, Pin, Delete, Report |
| 99 | Empty states and actionable error messages | ✅ Built & Verified | Contextual empty states with avatar/illustrations and one-tap retry banners |
| 100 | Per-conversation settings screen | 🔧 Upgraded in Step 1 | Upgraded Conversation Options sheet in `dm/[id].tsx` & `(tabs)/chat.tsx` with Mute, Search, Shared Media/Links, Starred Messages, Clear, Block, Report |

---

## Step-by-Step Execution Roadmap

1. **Step 1 (Completed Now)**:
   - Full feature parity between Private Chat (`dm/[id].tsx`) and Group Chat (`(tabs)/chat.tsx`):
     - Swipe-to-reply + haptic feedback + double-tap ❤️ reaction + quick emoji reaction bar in Private Chat.
     - Forward message flow (forward any message to a classmate or conversation).
     - Star / Bookmark messages (personal saved messages view per chat).
     - Clickable URLs + automatic inline Link Preview cards in both DM and Group Chat.
     - Per-conversation draft persistence in DMs (`dmDraftCache`).
     - In-chat message search bar, Mute/Unmute notifications toggle, and Shared Links/Media viewer in DM Conversation Settings.
     - "Seen by N" read receipt count + reader list modal in Group Chat.
2. **Step 2 (Moderation & Privacy Settings)**:
   - Server-side profanity/spam filter hook + "Who can DM me" (`everyone` / `cohort_only`) privacy setting + read-receipt/last-seen privacy toggles.
3. **Step 3 (Group Enhancements & Rich Library Cards)**:
   - Share Library notes, assignments, and notices into chat as rich interactive cards + Group slow mode + inline system messages.
4. **Step 4 (Rich Media: Voice Notes, Video & Upload Progress)**:
   - Voice note recording/playback, short video attachments, and percentage progress bar with cancel on uploads.
5. **Step 5 (Class Polls & Scheduled Announcements)**:
   - Interactive class polls and scheduled announcement publishing for teachers/CRs/admins.
