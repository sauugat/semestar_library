import { apiFetch, ApiError } from '../api';
import {
  LudoInvitationError,
  type LudoUserSearchResult,
  type LudoInvitationDetail,
  type CreateInvitationResponse,
  type AcceptInvitationResponse,
  type DeclineInvitationResponse,
} from './types';

export { LudoInvitationError };

/**
 * Search students for lobby invite picker
 */
export async function searchLudoUsers(query: string): Promise<LudoUserSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const res = await apiFetch(`/api/games/ludo/users/search?q=${encodeURIComponent(trimmed)}`);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new LudoInvitationError(
      errorBody.message || 'Failed to search students.',
      errorBody.error || 'SEARCH_FAILED',
      res.status
    );
  }

  const data = await res.json();
  return data.users || [];
}

/**
 * Create an invitation for a private Ludo lobby
 */
export async function createLudoInvitation(
  roomId: string,
  inviteeUserId: string
): Promise<CreateInvitationResponse> {
  const res = await apiFetch('/api/games/ludo/invitations', {
    method: 'POST',
    body: JSON.stringify({ roomId, inviteeUserId }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new LudoInvitationError(
      body.message || 'Failed to send invitation.',
      body.error || 'CREATE_FAILED',
      res.status
    );
  }

  return body as CreateInvitationResponse;
}

/**
 * Fetch invitation details
 */
export async function getLudoInvitation(invitationId: string): Promise<LudoInvitationDetail> {
  const res = await apiFetch(`/api/games/ludo/invitations/${encodeURIComponent(invitationId)}`);
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new LudoInvitationError(
      body.message || 'Failed to fetch invitation.',
      body.error || 'FETCH_FAILED',
      res.status
    );
  }

  return body.invitation as LudoInvitationDetail;
}

/**
 * Accept invitation and obtain the room ID to join
 */
export async function acceptLudoInvitation(
  invitationId: string
): Promise<AcceptInvitationResponse> {
  const res = await apiFetch(
    `/api/games/ludo/invitations/${encodeURIComponent(invitationId)}/accept`,
    {
      method: 'POST',
    }
  );

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new LudoInvitationError(
      body.message || 'Failed to accept invitation.',
      body.error || 'ACCEPT_FAILED',
      res.status
    );
  }

  return body as AcceptInvitationResponse;
}

/**
 * Decline invitation
 */
export async function declineLudoInvitation(
  invitationId: string
): Promise<DeclineInvitationResponse> {
  const res = await apiFetch(
    `/api/games/ludo/invitations/${encodeURIComponent(invitationId)}/decline`,
    {
      method: 'POST',
    }
  );

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new LudoInvitationError(
      body.message || 'Failed to decline invitation.',
      body.error || 'DECLINE_FAILED',
      res.status
    );
  }

  return body as DeclineInvitationResponse;
}
