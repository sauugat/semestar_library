-- Semester Library: In-Feed Advertising System Schema Migration
-- Compatible with Neon PostgreSQL and SQLite / LibSQL

CREATE TABLE IF NOT EXISTS advertisements (
  id SERIAL PRIMARY KEY,
  advertiser_name TEXT NOT NULL,
  advertiser_logo_url TEXT,
  primary_text TEXT NOT NULL DEFAULT '',
  headline TEXT,
  description TEXT,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  mime_type TEXT,
  cta_label TEXT NOT NULL DEFAULT 'Learn More',
  destination_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'draft')),
  is_active INTEGER NOT NULL DEFAULT 1,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  impression_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advertisements_active_status
  ON advertisements (is_active, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_advertisements_created_at
  ON advertisements (created_at DESC);

CREATE TABLE IF NOT EXISTS advertisement_impressions (
  id SERIAL PRIMARY KEY,
  advertisement_id INTEGER NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  session_key TEXT NOT NULL DEFAULT 'default',
  window_bucket TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(advertisement_id, viewer_key, session_key, window_bucket)
);

CREATE INDEX IF NOT EXISTS idx_ad_impressions_ad_id
  ON advertisement_impressions (advertisement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS advertisement_clicks (
  id SERIAL PRIMARY KEY,
  advertisement_id INTEGER NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  session_key TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad_id
  ON advertisement_clicks (advertisement_id, created_at DESC);
