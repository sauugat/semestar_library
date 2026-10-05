-- Migration: Production-Grade In-App Notification Center & Preferences
-- File: migrations/20261005_notification_center.sql
-- Safely transitions existing legacy notifications table without data loss.

BEGIN;

-- 1. Safely transform existing legacy notifications table or create new if not present
DO $$
BEGIN
  -- If table does not exist at all, create it
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      secondary_entity_id TEXT,
      deep_link TEXT NOT NULL,
      web_path TEXT NOT NULL,
      group_key TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ
    );
  ELSE
    -- Table already exists: safely alter existing columns to new architecture

    -- Alter id from INTEGER to TEXT if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'id' AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
      ALTER TABLE notifications ALTER COLUMN id TYPE TEXT USING id::text;
      -- Drop the default sequence if present so custom UUIDs can be inserted
      ALTER TABLE notifications ALTER COLUMN id DROP DEFAULT;
    END IF;

    -- Make legacy columns nullable so new multi-recipient notifications do not violate constraints
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'recipientstudentid' AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE notifications ALTER COLUMN recipientStudentId DROP NOT NULL;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'message' AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE notifications ALTER COLUMN message DROP NOT NULL;
    END IF;

    -- Add all new columns if missing
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id TEXT REFERENCES students(studentId) ON DELETE SET NULL;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS secondary_entity_id TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deep_link TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS web_path TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_key TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

    -- Backfill missing created_at from legacy createdat column if present
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'createdat') THEN
      UPDATE notifications SET created_at = createdat WHERE created_at IS NULL AND createdat IS NOT NULL;
    END IF;

    -- Backfill missing actor_id from legacy actorid column if present
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'actorid') THEN
      UPDATE notifications SET actor_id = actorid WHERE actor_id IS NULL AND actorid IS NOT NULL;
    END IF;

    -- Backfill title and body from legacy message
    UPDATE notifications
    SET title = COALESCE(title, 'Notification'),
        body = COALESCE(body, message)
    WHERE body IS NULL AND message IS NOT NULL;

    -- Backfill entity_type, entity_id, deep_link, web_path from legacy postid / relatedfileid
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'postid') THEN
      UPDATE notifications
      SET entity_type = 'post',
          entity_id = postid::text,
          deep_link = '/post/' || postid::text,
          web_path = 'dashboard.html?post=' || postid::text
      WHERE entity_type IS NULL AND postid IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'relatedfileid') THEN
      UPDATE notifications
      SET entity_type = 'material',
          entity_id = relatedfileid::text,
          deep_link = '/material/' || relatedfileid::text,
          web_path = 'files.html?highlight=' || relatedfileid::text
      WHERE entity_type IS NULL AND relatedfileid IS NOT NULL;
    END IF;

    -- Fallback for any remaining unpopulated entity fields
    UPDATE notifications
    SET entity_type = COALESCE(type, 'general'),
        entity_id = id::text,
        deep_link = '/',
        web_path = 'notifications.html'
    WHERE entity_type IS NULL;

    UPDATE notifications
    SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL;
  END IF;
END $$;

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(group_key) WHERE group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);

-- 2. Create notification_recipients table
CREATE TABLE IF NOT EXISTS notification_recipients (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,
  push_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unseen ON notification_recipients(user_id, hidden_at, seen_at);
CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unread ON notification_recipients(user_id, hidden_at, read_at);
CREATE INDEX IF NOT EXISTS idx_notif_recip_user_created ON notification_recipients(user_id, hidden_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_recip_notif_id ON notification_recipients(notification_id);

-- 3. Backfill legacy notifications into notification_recipients
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'recipientstudentid') THEN
    INSERT INTO notification_recipients (
      id,
      notification_id,
      user_id,
      seen_at,
      read_at,
      hidden_at,
      created_at
    )
    SELECT
      'recip_legacy_' || n.id::text,
      n.id::text,
      n.recipientStudentId,
      CASE WHEN n.isRead = 1 THEN COALESCE(n.created_at, CURRENT_TIMESTAMP) ELSE NULL END,
      CASE WHEN n.isRead = 1 THEN COALESCE(n.created_at, CURRENT_TIMESTAMP) ELSE NULL END,
      NULL,
      COALESCE(n.created_at, CURRENT_TIMESTAMP)
    FROM notifications n
    WHERE n.recipientStudentId IS NOT NULL
      AND n.recipientStudentId IN (SELECT studentId FROM students)
    ON CONFLICT (notification_id, user_id) DO NOTHING;
  END IF;
END $$;

-- 4. Extend student_notification_preferences table
DO $$
BEGIN
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS delivery_messages TEXT DEFAULT 'push_inbox';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS delivery_activity TEXT DEFAULT 'push_inbox';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS delivery_academic TEXT DEFAULT 'push_inbox';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS delivery_system TEXT DEFAULT 'push_inbox';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN DEFAULT false;
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT DEFAULT '22:30';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT DEFAULT '07:00';
  ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kathmandu';
EXCEPTION
  WHEN undefined_table THEN
    CREATE TABLE student_notification_preferences (
      student_id TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
      mute_chat BOOLEAN DEFAULT false,
      notify_notes BOOLEAN DEFAULT true,
      notify_posts BOOLEAN DEFAULT true,
      notify_notices BOOLEAN DEFAULT true,
      hide_lockscreen_preview BOOLEAN DEFAULT true,
      delivery_messages TEXT DEFAULT 'push_inbox',
      delivery_activity TEXT DEFAULT 'push_inbox',
      delivery_academic TEXT DEFAULT 'push_inbox',
      delivery_system TEXT DEFAULT 'push_inbox',
      quiet_hours_enabled BOOLEAN DEFAULT false,
      quiet_hours_start TEXT DEFAULT '22:30',
      quiet_hours_end TEXT DEFAULT '07:00',
      timezone TEXT DEFAULT 'Asia/Kathmandu',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
END $$;

-- 5. Row Level Security (RLS) - Guarded for Postgres environments with Supabase Auth
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_notification_preferences ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can read own notification recipients" ON notification_recipients;
    CREATE POLICY "Users can read own notification recipients"
      ON notification_recipients FOR SELECT
      USING (
        user_id IN (SELECT studentId FROM students WHERE supabase_uid = auth.uid()::text)
        OR current_user = 'service_role'
        OR current_user = 'neondb_owner'
      );

    DROP POLICY IF EXISTS "Users can update own notification recipients" ON notification_recipients;
    CREATE POLICY "Users can update own notification recipients"
      ON notification_recipients FOR UPDATE
      USING (
        user_id IN (SELECT studentId FROM students WHERE supabase_uid = auth.uid()::text)
        OR current_user = 'service_role'
        OR current_user = 'neondb_owner'
      );

    DROP POLICY IF EXISTS "Users can read notifications addressed to them" ON notifications;
    CREATE POLICY "Users can read notifications addressed to them"
      ON notifications FOR SELECT
      USING (
        id IN (
          SELECT notification_id FROM notification_recipients
          WHERE user_id IN (SELECT studentId FROM students WHERE supabase_uid = auth.uid()::text)
        )
        OR current_user = 'service_role'
        OR current_user = 'neondb_owner'
      );

    DROP POLICY IF EXISTS "Users can read own notification preferences" ON student_notification_preferences;
    CREATE POLICY "Users can read own notification preferences"
      ON student_notification_preferences FOR SELECT
      USING (
        student_id IN (SELECT studentId FROM students WHERE supabase_uid = auth.uid()::text)
        OR current_user = 'service_role'
        OR current_user = 'neondb_owner'
      );

    DROP POLICY IF EXISTS "Users can update own notification preferences" ON student_notification_preferences;
    CREATE POLICY "Users can update own notification preferences"
      ON student_notification_preferences FOR UPDATE
      USING (
        student_id IN (SELECT studentId FROM students WHERE supabase_uid = auth.uid()::text)
        OR current_user = 'service_role'
        OR current_user = 'neondb_owner'
      );
  END IF;
END $$;

COMMIT;
