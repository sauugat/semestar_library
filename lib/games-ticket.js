const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;
const TICKET_TTL_SECONDS = 300; // 5 minutes

function validateSecret(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('GAMES_TICKET_SECRET must be configured with at least 32 characters');
  }
}

/**
 * Creates a signed Games ticket for an authenticated user.
 * Format: v1.<base64url-payload>.<base64url-signature>
 * Signs: "v1.<base64url-payload>" using HMAC-SHA256
 *
 * @param {Object} user - Authenticated user object from req.user
 * @param {string} [customSecret] - Optional secret override (e.g. for testing)
 * @returns {string} The signed ticket
 */
function createGamesTicket(user, customSecret) {
  const secret = customSecret !== undefined ? customSecret : process.env.GAMES_TICKET_SECRET;
  validateSecret(secret);

  if (!user || typeof user.studentId !== 'string' || !user.studentId.trim()) {
    throw new Error('A valid studentId is required to issue a Games ticket');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: String(user.studentId).trim(),
    username: user.username ? String(user.username).trim() : null,
    name: user.name ? String(user.name).trim() : null,
    avatarUrl: user.avatarUrl ? String(user.avatarUrl).trim() : null,
    iss: 'semester-library',
    aud: 'semester-games',
    iat: now,
    exp: now + TICKET_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `v1.${payloadB64}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Verifies a Games ticket and returns the decoded payload if valid.
 *
 * @param {string} ticket - The v1.<payload>.<signature> ticket string
 * @param {string} [customSecret] - Optional secret override (e.g. for testing)
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
function verifyGamesTicket(ticket, customSecret) {
  const secret = customSecret !== undefined ? customSecret : process.env.GAMES_TICKET_SECRET;
  validateSecret(secret);

  if (typeof ticket !== 'string' || !ticket.trim()) {
    return { valid: false, error: 'Empty or invalid ticket' };
  }

  const parts = ticket.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid ticket format (expected 3 parts)' };
  }

  const [version, payloadB64, signatureB64] = parts;
  if (version !== 'v1') {
    return { valid: false, error: 'Unsupported ticket version' };
  }

  const signingInput = `v1.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64, 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid signature' };
  }

  let payload;
  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, error: 'Malformed JSON payload' };
  }

  if (payload.v !== 1) {
    return { valid: false, error: 'Invalid payload version' };
  }
  if (payload.iss !== 'semester-library') {
    return { valid: false, error: 'Invalid issuer' };
  }
  if (payload.aud !== 'semester-games') {
    return { valid: false, error: 'Invalid audience' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return { valid: false, error: 'Ticket has expired' };
  }

  return { valid: true, payload };
}

module.exports = {
  createGamesTicket,
  verifyGamesTicket,
  TICKET_TTL_SECONDS,
  MIN_SECRET_LENGTH,
};
