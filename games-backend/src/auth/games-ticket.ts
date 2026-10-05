export interface GamesTicketPayload {
  v: 1;
  sub: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  iss: 'semester-library';
  aud: 'semester-games';
  iat: number;
  exp: number;
  jti: string;
}

export type VerifyResult =
  | { valid: true; payload: GamesTicketPayload }
  | { valid: false; error: string };

const MAX_LIFETIME_SECONDS = 300;
const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

function base64UrlToUint8Array(base64url: string): Uint8Array | null {
  try {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function base64UrlDecodeText(base64url: string): string | null {
  const bytes = base64UrlToUint8Array(base64url);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Verifies a Semester Library Games ticket using Web Crypto (crypto.subtle).
 * Format: v1.<base64url-payload>.<base64url-signature>
 *
 * @param ticket - The ticket string to verify
 * @param secret - The shared HMAC-SHA256 secret (minimum 32 characters)
 * @returns Typed verification result
 */
export async function verifyGamesTicket(
  ticket: unknown,
  secret: string
): Promise<VerifyResult> {
  if (typeof secret !== 'string' || secret.length < 32) {
    return { valid: false, error: 'Invalid server secret configuration' };
  }

  if (typeof ticket !== 'string' || !ticket.trim()) {
    return { valid: false, error: 'Ticket must be a non-empty string' };
  }

  const parts = ticket.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Ticket must have exactly 3 dot-separated sections' };
  }

  const [version, payloadB64, signatureB64] = parts;
  if (version !== 'v1') {
    return { valid: false, error: 'Unsupported ticket version prefix' };
  }

  const signatureBytes = base64UrlToUint8Array(signatureB64);
  if (!signatureBytes || signatureBytes.length === 0) {
    return { valid: false, error: 'Malformed ticket signature' };
  }

  const signingInput = `v1.${payloadB64}`;
  const signingInputBytes = new TextEncoder().encode(signingInput);
  const secretBytes = new TextEncoder().encode(secret);

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const isSignatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      signingInputBytes
    );

    if (!isSignatureValid) {
      return { valid: false, error: 'Invalid ticket cryptographic signature' };
    }
  } catch {
    return { valid: false, error: 'Cryptographic signature verification failed' };
  }

  const payloadText = base64UrlDecodeText(payloadB64);
  if (!payloadText) {
    return { valid: false, error: 'Failed to decode ticket payload base64url' };
  }

  let rawPayload: any;
  try {
    rawPayload = JSON.parse(payloadText);
  } catch {
    return { valid: false, error: 'Ticket payload is not valid JSON' };
  }

  if (typeof rawPayload !== 'object' || rawPayload === null) {
    return { valid: false, error: 'Ticket payload must be a JSON object' };
  }

  if (rawPayload.v !== 1) {
    return { valid: false, error: 'Payload version must be 1' };
  }

  if (rawPayload.iss !== 'semester-library') {
    return { valid: false, error: 'Invalid issuer (expected "semester-library")' };
  }

  if (rawPayload.aud !== 'semester-games') {
    return { valid: false, error: 'Invalid audience (expected "semester-games")' };
  }

  if (typeof rawPayload.sub !== 'string' || !rawPayload.sub.trim()) {
    return { valid: false, error: 'Subject (sub) must be a non-empty string' };
  }

  if (typeof rawPayload.jti !== 'string' || !rawPayload.jti.trim()) {
    return { valid: false, error: 'Ticket ID (jti) must be a non-empty string' };
  }

  if (typeof rawPayload.iat !== 'number' || !Number.isFinite(rawPayload.iat)) {
    return { valid: false, error: 'Issued-at (iat) must be a valid numeric timestamp' };
  }

  if (typeof rawPayload.exp !== 'number' || !Number.isFinite(rawPayload.exp)) {
    return { valid: false, error: 'Expiration (exp) must be a valid numeric timestamp' };
  }

  if (rawPayload.exp <= rawPayload.iat) {
    return { valid: false, error: 'Expiration timestamp must be greater than issued-at timestamp' };
  }

  const lifetime = rawPayload.exp - rawPayload.iat;
  if (lifetime > MAX_LIFETIME_SECONDS) {
    return { valid: false, error: `Ticket lifetime exceeds maximum of ${MAX_LIFETIME_SECONDS} seconds` };
  }

  const now = Math.floor(Date.now() / 1000);

  if (rawPayload.iat > now + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { valid: false, error: 'Ticket issued in the future (exceeds clock skew tolerance)' };
  }

  if (rawPayload.exp + CLOCK_SKEW_TOLERANCE_SECONDS < now) {
    return { valid: false, error: 'Ticket has expired' };
  }

  const payload: GamesTicketPayload = {
    v: 1,
    sub: rawPayload.sub.trim(),
    username: typeof rawPayload.username === 'string' && rawPayload.username.trim() ? rawPayload.username.trim() : null,
    name: typeof rawPayload.name === 'string' && rawPayload.name.trim() ? rawPayload.name.trim() : null,
    avatarUrl: typeof rawPayload.avatarUrl === 'string' && rawPayload.avatarUrl.trim() ? rawPayload.avatarUrl.trim() : null,
    iss: 'semester-library',
    aud: 'semester-games',
    iat: rawPayload.iat,
    exp: rawPayload.exp,
    jti: rawPayload.jti.trim(),
  };

  return { valid: true, payload };
}
