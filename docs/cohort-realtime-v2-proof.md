# Cohort chat realtime security proof V2

**The replacement model passed the disposable local proof. It is safe to resume cohort implementation; this is not production migration approval.** No application cohort migration, runtime API, mobile or web changes were made by this task.

Evidence: [sanitized live results](cohort-realtime-v2-evidence.json). The successful run completed its **54 assertions in 75.008 seconds**. The hostile old client remained subscribed and connected with its original, still-unexpired 120-second credential at the end. Five offline destination/config safety tests also passed.

## Pass gate

- **AUTHORIZED_RECEIVE = PASS**
- **OUTSIDER_JOIN = DENIED**
- **CLIENT_BROADCAST_WRITE = DENIED**
- **CLIENT_PRESENCE_WRITE = DENIED**
- **SERVER_PRIVATE_BROADCAST = PASS**
- **EPOCH_ROTATION = PASS**
- **REVOKED_OLD_TOPIC_RECEIVES_NEW_EVENTS = 0**
- **REVOKED_NEW_EPOCH_JOIN = DENIED**
- **ROOM_CLOSE_FENCING = PASS**
- **GROUP_CODE_REUSE_ISOLATION = PASS**
- **HOSTILE_CONNECTED_CLIENT = CONTAINED**
- **SERVER_MEDIATED_TYPING_DESIGN = authenticated API → active-room validation → fenced trusted broadcast**, detailed below.
- **REALTIME_SECURITY_MODEL = PROVEN** within the tested local architecture and threat model.
- **SAFE_TO_RESUME_COHORT_IMPLEMENTATION = YES**

## What was actually exercised

Environment: Supabase CLI 2.119.0, Realtime v2.140.3, Postgres 17.11.0.002, supabase-js 2.117.2, Node v24.18.0. All identities and content markers were synthetic. Authority tables stood in for Neon in a disposable local PostgreSQL schema; no Neon connection was made. Projection updates used a separate connection/transaction from the authority transaction. This is not a test of a deployed Neon→Supabase integration.

The local tenant was configured **private-only**. The proof required a clean `realtime.messages` policy set, then installed a single SELECT policy for `extension = 'broadcast'`. It installed **no INSERT policy** for Broadcast or Presence and no Presence SELECT policy. Projection tables were not granted to student clients. A private topic required a matching active projected student, immutable room UUID, epoch and signed credential claims.

The trusted server used Supabase's private REST broadcast endpoint with a server credential. Each student client received only the public project key and its own scoped JWT. The backend configuration response was checked for absence of the server credential. This follows Supabase's documented [private Broadcast transport](https://supabase.com/docs/guides/realtime/broadcast) and [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

Observed delivery counts:

- **11 trusted server events published**, with positive receipt checks throughout the scenarios.
- **0 post-rotation trusted events** delivered to the revoked old-topic client.
- **0 replacement-cohort events** delivered to any old-room member.
- **0 client-originated Broadcast events** delivered anywhere in the probe.
- Presence `track()` explicitly returned **error** in all five attack phases; no attempted Presence marker reached observers.

An authorized client attacked before revocation, after rotation, on both retired and latest topics after closure, and after code reuse. Attacks included chat, typing and reaction Broadcast events, Presence tracking, and direct REST broadcast requests with the student token. WebSocket Broadcast attempts timed out without delivery. The REST batch endpoint sometimes returned **202 despite delivering no unauthorized event**; the proof uses recipient observations and positive delivery controls, not HTTP acknowledgement as authorization evidence.

The outsider was denied at both epochs. Public-channel attempts were denied. A revoked client repeatedly tried epoch 2, tried rejoining epoch 1 with its old token, and tried the replacement MARS topic: all were denied. Even the remaining authorized member could not use its epoch-1 credential to join epoch 2; it needed a newly issued room/epoch credential.

## The server-side security boundary

Topics are `chat:<immutableRoomId>:<epoch>`. Group codes never serve as topics or authorization identities.

The prototype holds an authority room row lock through membership/status/epoch checks **and through the trusted private REST broadcast's acceptance**. Rotation and closure acquire that same lock. Tests deliberately held a publisher in flight and verified that rotation/closure could not overtake it. Afterward, a queued event with an old epoch was rejected; the backend never reused its cached topic.

On member revocation, the backend updates the projection to the next epoch and removes the revoked member, then commits the authoritative membership/epoch change. Tokens are pinned to both room and epoch. The old topic becomes permanently silent. The surviving member obtains epoch-2 configuration; the revoked member cannot obtain new configuration or join the new epoch.

On closure, the source and projection become closed. No further epoch is created. Configuration issuance and publication are rejected. Old sockets can remain connected, but they have no write permissions and the trusted publisher sends nothing further to any topic for that room.

For code reuse, the fixture created a **new UUID room** with code MARS at epoch 1. Its topic differed from every old-room topic. New members received trusted events while the old, still-connected hostile member received none.

Pre-fence messages already accepted by the transport may arrive afterward due to network delay. The tested promise is **no new post-fence application event goes to a retired topic**, not retraction of an already-transmitted packet. Production dispatch must preserve this distinction.

## Short-lived credential/configuration design

Proposed endpoint: `GET /api/chat/realtime-config`, authenticated through existing Semester Library authentication. The backend resolves the verified student in Neon, acquires the room authorization/fencing lock, rechecks membership and active status, and requires a matching acknowledged projection before issuing:

`chatGroupId`, `realtimeEpoch`, `topic`, scoped short-lived `token`, `expiry`.

No client-supplied room/code chooses the response. No signing key, server key or private authority credential is returned. Responses must be `private, no-store`. The proof used synthetic authenticated subjects at the function boundary; implementing and testing the actual HTTP authentication integration remains future work.

The prototype signs a JWT with `sub`, authenticated role/audience, room UUID, epoch and expiry. Ordinary test credentials last 120 seconds. Clients explicitly await token handoff before subscribing. A separate two-second credential joined successfully before expiry and was denied on a new join after natural expiration. Revoked and closed-room credentials were also denied on new joins while otherwise unexpired.

Expiry is defense in depth. Immediate isolation in this proof came from receive-only permissions, epoch rotation, immutable room identity and server fencing **while the old token was still valid**. Cached connection authorization is not assumed to disappear on projection changes.

## SERVER_MEDIATED_TYPING_DESIGN

Keep the existing `POST /api/chat/typing` entry point, but derive student identity and room on the server. Rate-limit/coalesce typing signals, revalidate active membership under the same publication fence, and broadcast a small ephemeral event to the current topic. Include server-derived student ID, room ID, epoch and expiry time. Clients locally expire stale indicators. Do not persist message content in typing events or expose a generic client-supplied broadcast endpoint.

The product currently uses more than typing: mobile `chat.tsx` renders an online count and member badges, while `public/chat.html` shows online counts and filters members using presence state. Silently removing online status would change existing behavior.

Minimal preservation design: authenticated foreground heartbeats, approximately every 25–30 seconds, recorded per `(room, student, device/session)` in shared backend storage with a roughly 60–90 second TTL. Derive online users from non-expired sessions, deduplicate multiple devices, and have the backend emit authorized online snapshots/deltas through the same fenced publisher. The client should also apply expiry times locally so stale badges disappear without a permanent server process. Backgrounding/logging out can send a best-effort departure; TTL handles crashes. Room revocation/closure removes or ignores those records. Avoid process-local maps on serverless instances. Exact intervals are proposed defaults, not tested product settings.

All chat mutations, reactions, typing and online-state changes must go through authenticated backend operations. Student Supabase Presence publishing remains forbidden.

## Scope and implementation requirements

This result resolves the specific V1 cached-permission blocker for the replacement architecture. It does **not** certify production settings, an actual Neon bridge, roster assignment, application IDOR protection, cache invalidation, push delivery or recycle erasure.

The later implementation must retain these requirements:

1. Private-only Realtime configuration and a reviewed complete policy set. Another permissive INSERT/ALL policy must not restore student writes.
2. One server-controlled publisher used by every event path, with room/epoch checks, distributed serialization and no global/old-topic fallback. Server credentials must remain backend-only.
3. Projection acknowledgement and fail-closed mismatch handling before token issuance/publication. The prototype separately commits projection and source updates; it does not claim distributed atomicity. Durable repair after partial failure must be implemented and tested.
4. Queued work must carry immutable room and epoch, then reauthorize before delivery. Never resolve a reused code to a new cohort for an old event.
5. Define crash/timeout handling for an ambiguous external REST send and coordination with rotation/closure. The local proof tests normal acceptance and deliberate concurrent lock contention, not process death, multi-region transport failure or production throughput.
6. Refresh/rejoin clients on epoch changes through authenticated configuration retrieval; a user who refuses to refresh receives nothing new. Old cache and notification safety remain independent requirements.

## Files and validation

Added by this V2 task:

- `scripts/probe-cohort-realtime-v2.cjs` — isolated live proof, backend/config prototype and fail-closed local destination validation.
- `tests/cohort-realtime-v2-proof.test.js` — remote/override destination and missing-credential rejection tests.
- `docs/cohort-realtime-v2-evidence.json` — sanitized successful run evidence, including raw attack acknowledgements and all assertion labels.
- `docs/cohort-realtime-v2-proof.md` — this report.

Validation: 54 live checks passed; 5 combined V1/V2 offline safety tests passed; Node syntax check passed. No mobile source changes were made by this task, so mobile lint/typechecking was not repeated. Other unrelated working-tree edits appeared while the session was paused and were left untouched.

The first V2 run was not counted as a pass: denied sends used the SDK's default timeout, allowing the hostile credential to expire before the final connected-socket assertion. The successful run used bounded 700 ms negative-send timeouts, retained the original 120-second credential, and explicitly verified the old socket and credential at completion. This corrects the test's timing without treating token expiry as isolation.

All synthetic probe schemas/policies were removed in cleanup. The disposable Supabase stack was stopped without a backup; downloaded images remain cached. No production access, application schema change, deployment, commit/push, OTA publication, APK build or historical-chat erasure occurred.

## Reproduction

Use a **new or reset disposable local** Supabase CLI 2.119.0 project outside the application repository, with no real data and no production-forwarded ports. Start PostgreSQL, Auth, Realtime, Kong and REST. Set the disposable `realtime-dev` tenant's `private_only` setting to true after startup; the CLI's startup seed can reset it. The proof independently checks the setting and a public-channel denial. Save local CLI status JSON privately; do not use application `.env` credentials.

Run `node scripts/probe-cohort-realtime-v2.cjs --disposable-local-supabase /absolute/path/to/local-status.json`. Both API and DB must be explicit loopback endpoints. The CLI emits sanitized evidence and exits 0 only when all assertions pass; failure emits `NOT_PROVEN` and exits 1. It waits for its cleanup and flushes the result before exiting so rejected-channel retry timers cannot leave a lingering probe process. Stop the disposable project afterward with `supabase stop --no-backup`.

**STOP: resume implementation only in a subsequent task.** The quarantine policy remains accepted, and production migration readiness remains NO.
