-- Migration: 20261116_ai_conversations_scope_key.sql
-- Description: Add scope_key column and index to ai_conversations for chapter-scoped chats

-- PostgreSQL:
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS scope_key TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_scope ON ai_conversations(student_id, scope_key, updated_at DESC);

-- SQLite equivalent (applied idempotently on ensureSchema in lib/ai-chat-service.js):
-- ALTER TABLE ai_conversations ADD COLUMN scope_key TEXT;
-- CREATE INDEX IF NOT EXISTS idx_ai_conversations_scope ON ai_conversations(student_id, scope_key, updated_at DESC);
