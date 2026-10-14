-- Migration: KYANA AI 3.0 Unified Knowledge Index (DOWN / ROLLBACK)
-- File: migrations/20261014_kyana_v3_knowledge.down.sql
-- Fully reversible, idempotent rollback.

BEGIN;

DROP TABLE IF EXISTS knowledge_jobs CASCADE;
DROP TABLE IF EXISTS knowledge_chunks CASCADE;
DROP TABLE IF EXISTS knowledge_resources CASCADE;

COMMIT;
