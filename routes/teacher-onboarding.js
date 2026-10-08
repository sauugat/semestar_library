'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  isTeacherOnboardingEnabled,
  getTeacherOnboardingSecret,
  verifyTemporaryTeacherCredentials,
  signOnboardingToken,
  verifyOnboardingToken,
  getOnboardingState,
  checkPermanentUsernameAvailability,
  listOnboardingSubjects,
  searchSubjects,
  submitTeacherOnboarding,
  resendTeacherVerification,
  changeTeacherPendingEmail,
  finalizeTeacherOnboarding
} = require('../lib/teacher-service');

// Gatekeeper middleware: ensures feature flag is enabled and secret is configured.
// Fails closed safely with 503 instead of crashing server startup.
router.use((req, res, next) => {
  if (!isTeacherOnboardingEnabled()) {
    return res.status(503).json({
      message: 'Teacher onboarding is currently disabled.'
    });
  }

  try {
    getTeacherOnboardingSecret();
  } catch (err) {
    console.error('[Teacher Onboarding] Secret configuration error:', err.message);
    return res.status(503).json({
      message: 'Teacher onboarding service is temporarily unavailable due to configuration.'
    });
  }

  next();
});

// Dedicated rate limiter for temporary teacher credential validation
const teacherLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 10, // Limit each IP to 10 attempts per 15-minute window (relaxed in test)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many login attempts. Please try again in 15 minutes.'
  }
});

/**
 * Middleware: Strictly authorizes only valid teacher onboarding tokens.
 * Blocks all standard app session tokens and unauthenticated requests.
 */
async function requireOnboardingToken(req, res, next) {
  // Strip any client-supplied role or inviteId from body/query to prevent tampering
  if (req.body && typeof req.body === 'object') {
    delete req.body.role;
    delete req.body.inviteId;
    delete req.body.invite_id;
  }
  if (req.query && typeof req.query === 'object') {
    delete req.query.role;
    delete req.query.inviteId;
    delete req.query.invite_id;
  }

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-onboarding-token']) {
    token = String(req.headers['x-onboarding-token']).trim();
  }

  if (!token) {
    return res.status(401).json({
      message: 'Onboarding authentication required. Please sign in with your temporary credentials.'
    });
  }

  const verified = verifyOnboardingToken(token);
  if (!verified.valid) {
    return res.status(401).json({
      message: verified.error || 'Invalid or expired onboarding session. Please sign in again.'
    });
  }

  const { inviteId, nonce } = verified.payload;
  const state = await getOnboardingState(db, inviteId);

  if (!state) {
    return res.status(403).json({
      message: 'Teacher provisioning record not found or no longer active.'
    });
  }

  if (state.status === 'disabled') {
    return res.status(403).json({
      message: 'This teacher account invitation has been disabled by administration.'
    });
  }

  if (state.status === 'completed') {
    // If the invite is completed, allow GET /state to return the completed state without session errors
    if (req.method === 'GET' && (req.path === '/state' || req.path.endsWith('/state'))) {
      return res.json({
        status: 'completed',
        completed: true,
        canResend: false,
        canChangeEmail: false,
        message: 'Your teacher account is ready. Sign in with your new username and password.',
        state
      });
    }
    return res.status(403).json({
      message: 'Teacher account setup has already been completed. Please sign in with your permanent credentials.'
    });
  }

  if (state.isExpired) {
    return res.status(403).json({
      message: 'This teacher account invitation has expired. Please contact administration for a new invite.'
    });
  }

  // Verify that the token's nonce matches the current invite's nonce (session revocation on newer login)
  const currentInvite = await db.get('SELECT onboarding_nonce FROM teacher_invites WHERE id = ?', inviteId);
  const currentNonce = currentInvite?.onboarding_nonce ?? currentInvite?.onboardingnonce ?? 1;

  if (nonce !== currentNonce) {
    return res.status(401).json({
      message: 'Onboarding session has been invalidated by a newer login. Please sign in again.'
    });
  }

  req.onboarding = {
    inviteId,
    initialUsername: verified.payload.initialUsername,
    state
  };

  next();
}

/**
 * POST /api/teacher/onboarding/login
 * Authenticates temporary teacher credentials and returns a restricted onboarding session.
 */
router.post('/login', teacherLoginRateLimiter, async (req, res) => {
  const username = (req.body.username || req.body.identifier || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).json({
      message: 'Temporary username and password are required.'
    });
  }

  const result = await verifyTemporaryTeacherCredentials(db, { username, password });

  if (!result.success) {
    // Constant-ish failure delay against timing side-channels
    await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 40)));
    return res.status(401).json({
      message: 'Invalid username or password.'
    });
  }

  const invite = result.invite;
  const tokenData = signOnboardingToken({
    inviteId: invite.id,
    initialUsername: invite.initial_username || invite.initialusername,
    nonce: invite.onboarding_nonce || invite.onboardingnonce || 1
  });

  return res.json({
    onboardingRequired: true,
    onboardingToken: tokenData.token,
    expiresAt: tokenData.expiresAt,
    state: {
      initialUsername: invite.initial_username || invite.initialusername,
      status: invite.status,
      expiresAt: invite.expires_at || invite.expiresat
    }
  });
});

/**
 * GET /api/teacher/onboarding/state
 * Returns safe onboarding progress state for the authenticated teacher invite.
 */
router.get('/state', requireOnboardingToken, async (req, res) => {
  const state = req.onboarding.state || {};
  const emailMasked = state.emailMasked || state.pending?.emailMasked || null;
  const email = state.pending?.email || null;
  const subjectsSelected = state.subjectsSelected ?? state.pending?.subjectsCount ?? 0;
  return res.json({
    status: state.status,
    emailMasked,
    email,
    canResend: state.canResend ?? (state.status === 'awaiting_email_verification'),
    canChangeEmail: state.canChangeEmail ?? (state.status === 'awaiting_email_verification'),
    subjectsSelected,
    state
  });
});

/**
 * POST /api/teacher/onboarding/check-username
 * Checks permanent username availability against the global accounts namespace.
 */
router.post('/check-username', requireOnboardingToken, async (req, res) => {
  const desiredUsername = (req.body.username || '').trim();
  const check = await checkPermanentUsernameAvailability(db, desiredUsername);
  return res.json(check);
});

/**
 * GET /api/teacher/onboarding/subjects
 * Returns the canonical active subjects catalog for multi-subject selection.
 */
router.get('/subjects', requireOnboardingToken, async (req, res) => {
  try {
    const q = req.query.q || req.query.query;
    if (q && typeof q === 'string' && q.trim()) {
      const subjects = await searchSubjects(db, q);
      return res.json({ subjects });
    }
    const subjects = await listOnboardingSubjects(db);
    return res.json({ subjects });
  } catch (err) {
    console.error('[Teacher Onboarding] Error listing subjects:', err.message);
    return res.status(500).json({
      message: 'Unable to load subjects catalog at this time.'
    });
  }
});

/**
 * POST /api/teacher/onboarding/submit
 * Submits the teacher profile and subjects, registers unconfirmed Supabase user, relationally saves pending state.
 */
router.post('/submit', requireOnboardingToken, async (req, res) => {
  const { name, username, email, password, confirmPassword, subjectIds } = req.body;
  const proto = req.headers['x-forwarded-proto'] || (req.headers.host?.includes('localhost') ? 'http' : 'https');
  const origin = req.headers.host ? `${proto}://${req.headers.host}` : 'https://semestar-library.vercel.app';
  const redirectTo = `${origin}/teacher-verify.html`;

  const result = await submitTeacherOnboarding(db, {
    inviteId: req.onboarding.inviteId,
    name,
    username,
    email,
    password,
    confirmPassword,
    subjectIds,
    redirectTo,
    supabaseClientMock: req.supabaseClientMock || req.app.get('supabaseClientMock') || global.__testSupabaseMock || null
  });

  if (!result.success) {
    return res.status(400).json({ message: result.reason, code: result.code });
  }

  return res.json(result);
});

/**
 * POST /api/teacher/onboarding/resend-verification
 * Resends the email verification confirmation link for the pending onboarding record.
 */
router.post('/resend-verification', requireOnboardingToken, async (req, res) => {
  const result = await resendTeacherVerification(db, req.onboarding.inviteId, req.supabaseClientMock || req.app.get('supabaseClientMock') || global.__testSupabaseMock || null);
  if (!result.success) {
    const status = result.code === 'RATE_LIMITED' ? 429 : 400;
    return res.status(status).json({ message: result.reason, code: result.code });
  }
  return res.json(result);
});

/**
 * POST /api/teacher/onboarding/change-email
 * Updates the recovery email for the unverified pending onboarding record and resends confirmation.
 */
router.post('/change-email', requireOnboardingToken, async (req, res) => {
  const newEmail = req.body.email || req.body.newEmail;
  const result = await changeTeacherPendingEmail(db, {
    inviteId: req.onboarding.inviteId,
    newEmail,
    supabaseClientMock: req.supabaseClientMock || req.app.get('supabaseClientMock') || global.__testSupabaseMock || null
  });

  if (!result.success) {
    const status = result.code === 'SERVICE_UNAVAILABLE' ? 503 : (result.code === 'EMAIL_COLLISION' ? 409 : 400);
    return res.status(status).json({ message: result.reason, code: result.code });
  }

  return res.json(result);
});

/**
 * POST /api/teacher/onboarding/finalize
 * Finalizes teacher onboarding after permanent email verification in Supabase.
 * Accepts Supabase verified session token via Authorization header or body token.
 */
router.post('/finalize', async (req, res) => {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.body.token || req.body.access_token) {
    token = String(req.body.token || req.body.access_token).trim();
  }

  if (!token && !req.body.user) {
    return res.status(401).json({
      message: 'Verified authentication session token is required to finalize registration.'
    });
  }

  const result = await finalizeTeacherOnboarding(db, {
    supabaseToken: token,
    supabaseUser: req.body.user || null,
    supabaseClientMock: req.supabaseClientMock || req.app.get('supabaseClientMock') || global.__testSupabaseMock || null
  });

  if (!result.success) {
    const status = result.code === 'EMAIL_NOT_CONFIRMED' ? 403 :
                   result.code === 'NO_PENDING_RECORD' ? 404 :
                   result.code === 'INVALID_TOKEN' ? 401 : 400;
    return res.status(status).json({ message: result.reason || 'Account finalization failed.' });
  }

  // Automatically authenticate web session if express-session is present
  if (req.session) {
    req.session.studentId = result.teacherId;
    req.session.studentName = result.teacher?.name || result.user?.name;
    req.session.role = 'teacher';
  }

  return res.json(result);
});

module.exports = router;
module.exports.requireOnboardingToken = requireOnboardingToken;
