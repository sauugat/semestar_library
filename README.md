# Semester Library

Node.js/Express student library with Kyana, a tool-based BIT study chatbot.

## Run locally

Use Node.js 22.13+ (Node.js 24 recommended), then run:

```sh
npm install
npm start
```

Open http://localhost:3000/chatbot.html. Existing database and provider settings are read from `.env` locally and environment variables on Vercel. Do not commit `.env`.

## Chatbot configuration

- `GEMINI_API_KEY`: primary Gemini API credential.
- `OPENROUTER_API_KEY`: alternate provider credential; also supports real web search through OpenRouter's search server tool.
- `CHAT_PROVIDER`: `gemini` (default) or `openrouter`. The alternate is contacted only after an error/timeout before any answer has streamed.
- `CHAT_MODEL`, `CHAT_COMPLEX_MODEL`: optional primary-provider model overrides. Defaults are `gemini-3.1-flash-lite` and `gemini-3.1-pro-preview` for Gemini, with the corresponding `google/` model IDs for OpenRouter.
- `GEMINI_MODEL`, `GEMINI_COMPLEX_MODEL`, `OPENROUTER_MODEL`, `OPENROUTER_COMPLEX_MODEL`: optional provider-specific defaults (including fallback).
- `CHAT_SEARCH_MODEL`: Gemini search model; default `gemini-3.1-flash-lite`.
- `OPENROUTER_SEARCH_MODEL`: optional OpenRouter search model override.
- `CHAT_TIMEOUT_MS`: timeout per provider/tool operation; default 15000, bounded to 1000–30000.

No separate search API key is needed. Live search uses Google Search grounding, or OpenRouter's `openrouter:web_search` with Exa after the primary search fails. Actual source annotations are required before returning a current-information answer. Search requires available provider quota/credits and can incur provider search charges. Ordinary academic questions and code do not trigger web search.

## Data tools and response flow

Kyana defaults to one short affectionate roast followed by the answer, with lighter teasing for harder questions. `be formal`, `stop roasting`, `serious mode`, or `no jokes` stores `chatMode: formal` in the existing server-side session. It persists across page reloads and chat-history resets until `back to normal` or `roast me again`. Stress skips teasing for that message; answer-only formatting and error/clarification responses stay clean. The selected mode also applies to instant lookups and live search, and forms part of the answer cache key.

- `search_notes(query, semester, subject)`: searches metadata first, then indexed document content, then mapped subjects when no exact/content result exists. Semester and explicit subject filters never widen. At most three ranked files are returned; inferred matches are labeled. Unclear queries ask for clarification.
- `get_syllabus(semester)`: reads the exact semester from `public/syllabus-data.json`.
- `get_routine(semester)`: queries the exact semester in `exam_schedule`; no synthetic/hardcoded exam dates.
- `web_search(query)`: retrieves current sources and summarizes only that query.

Recognized notes/syllabus/routine requests execute tools directly without a model round-trip. General academic explanations/code stream directly from the small model. Ambiguous and combined requests use native provider function calls with validated arguments and a bounded tool batch. Complex reasoning uses the configured larger model from the start. Answers and note searches use bounded caches; uploads, deletes and routine changes invalidate relevant caches. Conversations with history are not placed into the shared answer cache.

`POST /api/ai/chat` accepts `{ "message": "...", "history": [], "stream": true }`. With `Accept: text/event-stream`, events are `delta` (`{text}`), `result` (final reply/cards/sources), and `error` (`{message}`). JSON requests remain supported. The UI handles cancellation, partial-stream failures, code fences and sanitized markdown. SSE bypasses the service worker cache.

## Full-text note indexing

Both upload endpoints await text extraction and persist its status. PDFs use PDF.js, DOCX uses Mammoth; TXT/MD/CSV are also supported. SQLite/LibSQL uses FTS5 with update/delete triggers; PostgreSQL/Neon uses a generated `tsvector` and GIN index in the same durable database. No ephemeral SQLite index is used on Vercel with PostgreSQL.

Backfill existing uploads using the configured database:

```sh
npm run index:notes
npm run index:notes -- --limit 25
npm run index:notes -- --retry-failed
npm run index:notes -- --force
```

The default resumes only unindexed notes. `--retry-failed` retries extraction errors; `--force` re-extracts everything. Original files are read from local uploads, database blobs, or the configured Supabase `library_files` bucket. Remote URLs are restricted to that storage origin; redirects are rejected.

Extraction limits: 20 MB per document, 500 PDF pages, 1 million text characters. Truncation and `indexed`, `empty`, `unsupported`, `too_large`, or `error` status are recorded in `note_search_documents`. Scanned PDFs need OCR and PPTX/image content is not indexed; their titles and subjects remain searchable. Indexing never claims unavailable text was extracted.

## Validation

```sh
npm run test:chat
```

Tests cover real SQLite FTS/PDF/DOCX extraction, exact filters, topic fallbacks, invalidation, provider function calls, SSE chunk boundaries, timeout/fallback behavior, real-source requirements, transport errors, safe markdown and service worker behavior. Tests use in-memory databases and mocked provider responses, not live paid calls.

API references: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Gemini search grounding](https://ai.google.dev/gemini-api/docs/google-search), [OpenRouter search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search), [SQLite FTS5](https://www.sqlite.org/fts5.html), [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html).
