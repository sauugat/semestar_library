/**
 * Types for Ludo Private Lobby Invitations
 * Phase 4C2B
 */

export interface LudoUserSearchResult {
  studentId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export interface LudoInvitationDetail {
  id: string;
  status: InvitationStatus;
  gameType: string;
  roomId: string;
  expiresAt: string;
  createdAt: string;
  inviter: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  invitee: {
    userId: string;
    displayName: string;
  };
}

export interface CreateInvitationResponse {
  invitation: {
    id: string;
    gameType: string;
    roomId: string;
    inviterUserId: string;
    inviteeUserId: string;
    status: InvitationStatus;
    createdAt: string;
    expiresAt: string;
  };
  deduplicated?: boolean;
  pushDelivery?: {
    success: boolean;
    attemptedCount: number;
    sentCount: number;
    message?: string;
  };
}

export interface AcceptInvitationResponse {
  success: boolean;
  roomId: string;
  status: 'accepted';
}

export interface DeclineInvitationResponse {
  success: boolean;
  status: 'declined';
}

export class LudoInvitationError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string = 'UNKNOWN', status: number = 400) {
    super(message);
    this.name = 'LudoInvitationError';
    this.code = code;
    this.status = status;
  }
}
