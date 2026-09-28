# Website and app chat audit

Checked boxes mean the implementation was inspected in both clients, not that a
physical-device test was performed. The tests below exercise the real backend,
website and native component action handlers. This is the existing class-group
chat feature inventory, followed by common features the product does not yet offer.

## Feature-by-feature inspection

- [x] **Text, emoji, links and multiline sending.** Both composers and the shared API inspected. API tests cover valid text/emoji, empty input and the 2,000-character limit. Native links and copy actions exist; OS clipboard/link launching still need device testing.
- [x] **Photos, documents and captions.** Both multipart upload paths inspected. Browser test sends an app-authenticated PNG and PDF without captions, then uploads a captioned photo through the website. App photo conversion and saved retry files were checked in the preceding repair.
- [x] **Cross-client delivery.** Real browser test confirms app-authenticated uploads appear without reload. Website uploads are downloadable byte-for-byte with app authentication. Broadcasts now render immediately without advancing the polling cursor.
- [x] **Recovery when realtime is unavailable.** Website polling now retrieves a recent server snapshot as well as new messages, so existing reactions/deletions update. The browser test deliberately disables realtime. History requests have a 15-second timeout so a stalled request cannot permanently hold the fetch lock. App polling also refreshes pins and typing.
- [x] **Photo previews and file cards.** Website image decoding is tested; native thumbnail dimensions and authenticated sources were checked. Extension fallback supports image messages with generic MIME metadata. OS-native image decoding/viewer gestures still need a device check.
- [x] **Replies to text, photos and files.** Native photo/file touch controls now handle long-press themselves; a visible message menu makes actions discoverable. Attachment filenames appear in reply previews. Browser tests reply to both photo and PDF messages and verify the result through the app-authenticated history API.
- [x] **Jump to quoted message.** Both clients scroll to and highlight a loaded target. A target outside loaded history produces an explanatory message; automatic fetching around an arbitrary old target is not implemented.
- [x] **Reaction add/change/remove.** Shared API tests cover all three operations. Native action tests cover image/file long-press and the visible menu. Browser tests check website reactions in app history and app reactions appearing on existing website rows without realtime.
- [x] **Copy, download, save and share.** Text copy and native OS share/save handlers inspected. Authenticated attachment bytes and recovery from missing local server files are tested. Photos permissions, OS share sheets and save-to-gallery require physical-device testing.
- [x] **Deletion and ownership.** API tests reject another student's deletion. Browser test confirms app deletion removes website rows. Native cache deletion clears local reply references. Deleting a pinned message now removes the stored pin and broadcasts its removal.
- [x] **Pending, failed and retry states.** Native pending messages retain their file URI and metadata after reopening. Unsent messages no longer offer server-only reply/reaction/pin actions; removing one deletes its retained file. Retry is visible for failed image-only messages. The server does not yet provide a client idempotency key, so a retry after a lost acknowledgement can still create a duplicate.
- [x] **Persistent caching and account isolation.** SQLite/browser tests cover insertion, updates, reaction changes, deletion, account/server separation, cache limits and attachment retry metadata. These are metadata caches, not guaranteed permanent offline storage of every attachment.
- [x] **Latest-message entry.** Inverted app list and website initial positioning inspected. Browser layout tests cover cached entry before a delayed refresh and delayed image resizing without pulling readers away from older history.
- [x] **Older history and duplicates.** API/state tests cover newest/older/newer pages, pending ordering, duplicate broadcast/send merging and disconnected history gaps. Offline app pagination falls back to cached history.
- [x] **Unread counts and read marking.** Website marks read only near the bottom and while visible. App marks the newest confirmed message, ignoring negative pending IDs, only while focused/foreground. Device background/keyboard transitions need manual testing.
- [x] **Read receipts.** API test verifies receipts never move backwards. App broadcast merging now keeps the higher receipt. Negative read IDs are rejected.
- [x] **Typing indicators.** Realtime callbacks expire typing state; polling now also returns recent typing activity. API test checks the typing payload. Presence/typing under real mobile network suspension needs device testing.
- [x] **Members, presence and connection state.** Member endpoint and both member panels inspected. Singleton tests confirm the app waits for SUBSCRIBED before reporting a realtime connection and ignores late callbacks after disconnect. Presence depends on Supabase; offline mode cannot provide authoritative live presence.
- [x] **Search.** Both clients search loaded history. Fixed website sender selector and added photo filenames to searchable metadata. Browser test searches a website-uploaded image by filename. Search is not server-wide; the UI now says loaded messages/files.
- [x] **Pins and permissions.** Student pin attempts are rejected, admin pinning succeeds, attachment-only pins use the filename, and deleting a pinned message clears the pin. Polling refreshes pins in both clients.
- [x] **Touch, mouse and keyboard actions.** Native nested attachment controls have their own action handlers and a visible menu. Website image/file action buttons are exercised with a real browser. Mobile touch accessibility and long-press timing need device testing.
- [x] **Dark layout, composer and keyboard.** Existing black/gray styles retained. Composer, reply/file previews, safe-area handling and inverted list inspected. Browser positioning checks pass. This audit does not certify every iOS/Android keyboard or accessibility configuration.
- [x] **Invalid targets and authentication.** Reply/reaction endpoints reject missing/deleted targets; negative IDs are rejected. Attachment download requires authentication and uses private caching. Tests cover unauthenticated download and unauthorized mutation.

## Known limits and next work

- Polling reconciles the most recent message window. Older loaded messages depend on live broadcasts or refetching; there is no durable server event log for offline mutations.
- Retry acknowledgements are not idempotent across a lost response, as noted above.
- Draft text is not durably saved across an application restart. Uploads have a sending state, not percentage progress.
- Automatic navigation to unloaded quoted messages and full-history server search are not implemented.
- Native photo picker, HEIC conversion on a device, long-press timing, gallery save, sharing, keyboard and background/resume behavior need a fresh development build and physical-device checks.

## Common optional chat features not currently implemented

Message editing, voice notes, video recording, multiple attachments per message,
@mentions, push notifications, mute settings, reporting/blocking, forwarding,
bookmarks, multiple rooms and end-to-end encryption require separate product and
backend work. This repair does not add controls that pretend these features exist.

## Repeatable verification

- `npm run test:group-chat`: backend, state/cache, realtime contracts and native component action handlers.
- `npm run test:group-chat:browser`: real website + isolated in-memory backend; requires Google Chrome. Exercises app-authenticated upload to website, website attachment replies/reactions, reverse reactions/deletions without realtime, website photo download with app auth, reload and photo filename search.
- From `mobile`: `npx tsc --noEmit` and targeted ESLint on chat screen/components/hooks/services.
- Full `npx expo lint` still reports existing non-chat errors; do not treat the entire app as lint-clean.

Test fixtures use an in-memory database and remove their uploaded files. They do
not post messages to the live class conversation. The browser test uses the app's
bearer-authenticated transport; it does not run an installed native app.
