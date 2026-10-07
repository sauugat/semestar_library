-- Run in the Realtime provider database, not the application/Neon database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS cohort_chat_private;
REVOKE ALL ON SCHEMA cohort_chat_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS cohort_chat_private.rooms (
  id uuid PRIMARY KEY, epoch integer NOT NULL CHECK(epoch > 0), status text NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_chat_private.members (
  subject uuid NOT NULL, room_id uuid NOT NULL REFERENCES cohort_chat_private.rooms(id),
  PRIMARY KEY(subject,room_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA cohort_chat_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_cohort_chat_projection(snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE room uuid := (snapshot->>'chatGroupId')::uuid;
  target_epoch integer := (snapshot->>'realtimeEpoch')::integer;
  old_epoch integer;
BEGIN
  IF target_epoch IS NULL OR target_epoch < 1 OR snapshot->>'status' NOT IN ('active','closed','recycling','recycled','quarantined')
    OR jsonb_typeof(snapshot->'members') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid projection'; END IF;
  INSERT INTO cohort_chat_private.rooms(id,epoch,status) VALUES(room,target_epoch,snapshot->>'status') ON CONFLICT DO NOTHING;
  SELECT r.epoch INTO old_epoch FROM cohort_chat_private.rooms r WHERE r.id=room FOR UPDATE;
  IF old_epoch > target_epoch THEN RAISE EXCEPTION 'Stale projection'; END IF;
  UPDATE cohort_chat_private.rooms SET epoch=target_epoch,status=snapshot->>'status' WHERE id=room;
  DELETE FROM cohort_chat_private.members WHERE room_id=room;
  IF snapshot->>'status'='active' THEN
    INSERT INTO cohort_chat_private.members(subject,room_id)
      SELECT (m->>'subject')::uuid,room FROM jsonb_array_elements(snapshot->'members') m;
  END IF;
  RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.sync_cohort_chat_projection(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_cohort_chat_projection(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION cohort_chat_private.can_receive(requested text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM cohort_chat_private.members m JOIN cohort_chat_private.rooms r ON r.id=m.room_id
    WHERE m.subject=auth.uid() AND r.status='active'
      AND requested='chat:'||r.id::text||':'||r.epoch::text
      AND auth.jwt()->>'chat_room_id'=r.id::text AND auth.jwt()->>'chat_epoch'=r.epoch::text)
$$;
REVOKE ALL ON FUNCTION cohort_chat_private.can_receive(text) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA cohort_chat_private TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_chat_private.can_receive(text) TO authenticated;
DROP POLICY IF EXISTS cohort_chat_receive ON realtime.messages;
CREATE POLICY cohort_chat_receive ON realtime.messages FOR SELECT TO authenticated
  USING(extension='broadcast' AND cohort_chat_private.can_receive(realtime.topic()));
-- Other permissive policies must never widen access to a chat room.
DROP POLICY IF EXISTS cohort_chat_read_fence ON realtime.messages;
CREATE POLICY cohort_chat_read_fence ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING(realtime.topic() NOT LIKE 'chat:%' OR (extension='broadcast' AND cohort_chat_private.can_receive(realtime.topic())));
DROP POLICY IF EXISTS cohort_chat_write_fence ON realtime.messages;
CREATE POLICY cohort_chat_write_fence ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK(realtime.topic() NOT LIKE 'chat:%');
NOTIFY pgrst, 'reload schema';
COMMIT;
