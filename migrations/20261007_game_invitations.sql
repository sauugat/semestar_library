-- Phase 4C2B: Game Invitations Table & Indexes
CREATE TABLE IF NOT EXISTS game_invitations (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  room_id TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_game_invitations_invitee_status ON game_invitations(invitee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter ON game_invitations(inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_room ON game_invitations(room_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_expires ON game_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter_created ON game_invitations(inviter_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invitations_pending ON game_invitations(room_id, inviter_user_id, invitee_user_id) WHERE status = 'pending';
