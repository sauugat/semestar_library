-- Migration 006: Direct Messaging Supabase Realtime Authorization
-- Run in the Realtime provider database, NOT the application/Neon database.
-- DO NOT RUN IN PRODUCTION WITHOUT APPROVAL.

BEGIN;

CREATE SCHEMA IF NOT EXISTS dm_chat_private;
REVOKE ALL ON SCHEMA dm_chat_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS dm_chat_private.conversations (
  id uuid PRIMARY KEY,
  epoch integer NOT NULL CHECK (epoch > 0),
  status text NOT NULL CHECK (status IN ('active', 'closed', 'blocked'))
);

CREATE TABLE IF NOT EXISTS dm_chat_private.participants (
  subject uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES dm_chat_private.conversations(id) ON DELETE CASCADE,
  PRIMARY KEY (subject, conversation_id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA dm_chat_private FROM PUBLIC, anon, authenticated;

-- Projection synchronization function (called by backend service_role only)
CREATE OR REPLACE FUNCTION public.sync_dm_conversation_projection(snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  conv_id uuid := (snapshot->>'conversationId')::uuid;
  target_epoch integer := (snapshot->>'realtimeEpoch')::integer;
  conv_status text := coalesce(snapshot->>'status', 'active');
  old_epoch integer;
BEGIN
  IF conv_id IS NULL OR target_epoch IS NULL OR target_epoch < 1 OR conv_status NOT IN ('active', 'closed', 'blocked')
     OR jsonb_typeof(snapshot->'participants') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid DM projection snapshot';
  END IF;

  INSERT INTO dm_chat_private.conversations(id, epoch, status)
  VALUES (conv_id, target_epoch, conv_status)
  ON CONFLICT DO NOTHING;

  SELECT c.epoch INTO old_epoch FROM dm_chat_private.conversations c WHERE c.id = conv_id FOR UPDATE;
  IF old_epoch > target_epoch THEN
    RAISE EXCEPTION 'Stale DM projection';
  END IF;

  UPDATE dm_chat_private.conversations
  SET epoch = target_epoch, status = conv_status
  WHERE id = conv_id;

  DELETE FROM dm_chat_private.participants WHERE conversation_id = conv_id;

  IF conv_status = 'active' THEN
    INSERT INTO dm_chat_private.participants(subject, conversation_id)
    SELECT (p->>'subject')::uuid, conv_id
    FROM jsonb_array_elements(snapshot->'participants') p;
  END IF;

  RETURN snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_dm_conversation_projection(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_dm_conversation_projection(jsonb) TO service_role;

-- Verification function for Realtime topic subscription
CREATE OR REPLACE FUNCTION dm_chat_private.can_receive(requested text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM dm_chat_private.participants p
    JOIN dm_chat_private.conversations c ON c.id = p.conversation_id
    WHERE p.subject = auth.uid()
      AND c.status = 'active'
      AND requested = 'dm:' || c.id::text || ':' || c.epoch::text
      AND auth.jwt()->>'dm_conversation_id' = c.id::text
      AND auth.jwt()->>'dm_epoch' = c.epoch::text
  )
$$;

REVOKE ALL ON FUNCTION dm_chat_private.can_receive(text) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA dm_chat_private TO authenticated;
GRANT EXECUTE ON FUNCTION dm_chat_private.can_receive(text) TO authenticated;

-- Policies on realtime.messages
DROP POLICY IF EXISTS dm_receive ON realtime.messages;
CREATE POLICY dm_receive ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND dm_chat_private.can_receive(realtime.topic()));

-- Restrictive fences:
-- Read fence ensures anon/authenticated can only read dm:* if dm_chat_private.can_receive is true
DROP POLICY IF EXISTS dm_read_fence ON realtime.messages;
CREATE POLICY dm_read_fence ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (realtime.topic() NOT LIKE 'dm:%' OR (extension = 'broadcast' AND dm_chat_private.can_receive(realtime.topic())));

-- Write fence ensures NO CLIENT can broadcast to dm:* directly (server-only publication)
DROP POLICY IF EXISTS dm_write_fence ON realtime.messages;
CREATE POLICY dm_write_fence ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (realtime.topic() NOT LIKE 'dm:%');

NOTIFY pgrst, 'reload schema';
COMMIT;
