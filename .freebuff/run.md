# Semester Library — Preview Run Doc

## How to Reproduce Uncommitted Artifacts

1. Copy `.env` from the main checkout (already present — contains DB connection strings and API keys).
2. Dependencies are pre-installed in `node_modules/`. If missing, run `npm install`.

## How to Run the Server

```bash
cd '<worktree-path>'
PORT=3001 node server.js
```

- Default port is 3000; use 3001 if 3000 is occupied.
- Server serves static files from `public/` and exposes API routes at `/api/*`.
- Chatbot page: `/chatbot.html`

## Preview Config

- URL: `http://localhost:3001/chatbot.html`
- Port: 3001
- PID managed via `launchctl submit -l com.semester-library.preview`
- Log: `.freebuff/preview-758c7b0f-e9a1-4220-b771-0974645f6527.log`

## Cleanup

```bash
launchctl remove com.semester-library.preview
```
