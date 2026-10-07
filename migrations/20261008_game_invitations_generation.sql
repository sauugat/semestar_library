-- Phase 4D: Game Invitations Room Generation Binding
-- Extends game_invitations with room_generation and updates unique pending index

ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS room_generation INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS uq_game_invitations_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invitations_gen_pending ON game_invitations(room_id, room_generation, inviter_user_id, invitee_user_id) WHERE status = 'pending';
