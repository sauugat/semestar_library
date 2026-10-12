'use strict';

const crypto = require('crypto');

// Regex patterns for sensitive keys that must NEVER be written to audit records
const SENSITIVE_KEY_REGEX = /(pass(word)?|hash|token|secret|key|cred(ential)?|supabase|auth|nonce|dm|private_message|message.*content)/i;

/**
 * Deep sanitization to strip or redact passwords, hashes, secrets, and auth tokens.
 */
function sanitizeAuditData(data) {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitizeAuditData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Ensures admin_audit_logs schema exists (used for local/test isolated databases).
 */
async function ensureAuditSchema(db) {
  const isPg = Boolean(db.isPostgres);
  const sql = isPg
    ? `
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(64) NOT NULL,
        entity_id TEXT,
        before_state JSONB,
        after_state JSONB,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs (actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_logs (entity_type, entity_id, created_at DESC);
    `
    : `
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_state TEXT,
        after_state TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs (actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_logs (entity_type, entity_id, created_at DESC);
    `;

  if (typeof db.exec === 'function') {
    await db.exec(sql);
  } else if (typeof db.query === 'function') {
    await db.query(sql);
  }
}

/**
 * Valid action identifiers
 */
const VALID_ACTIONS = new Set([
  'teacher_invite_created',
  'teacher_invite_bulk_created',
  'teacher_invite_password_regenerated',
  'teacher_invite_reissued',
  'teacher_invite_revoked',
  'teacher_subject_assigned',
  'teacher_subject_removed',
  'cohort_created',
  'cohort_promoted',
  'cohort_graduated',
  'cohort_recycled',
  'cohort_student_assigned',
  'system_settings_updated'
]);

/**
 * Records an immutable administrative audit event.
 *
 * @param {object} db - Database client or transaction adapter
 * @param {object} params
 * @param {string} params.actorUserId - Verified studentId of administrator (required)
 * @param {string} params.action - Audited action identifier
 * @param {string} params.entityType - Target entity type (e.g. 'teacher_subject', 'teacher_invite')
 * @param {string} [params.entityId] - Target entity identifier
 * @param {object} [params.beforeState] - Previous state (auto-sanitized)
 * @param {object} [params.afterState] - New state (auto-sanitized)
 * @param {object} [params.metadata] - Additional action metadata (auto-sanitized)
 * @param {boolean} [params.required=false] - If true, failure to log will throw and abort mutation
 * @param {object} [params.tx=null] - Optional transaction client
 */
async function recordAdminAudit(db, {
  actorUserId,
  action,
  entityType,
  entityId = null,
  beforeState = null,
  afterState = null,
  metadata = null,
  required = false,
  tx = null
}) {
  const client = tx || db;

  if (!actorUserId || typeof actorUserId !== 'string' || !actorUserId.trim()) {
    const err = new Error('Audit recording rejected: Valid administrator actor identity is required.');
    if (required) throw err;
    console.error('[Admin Audit Error]:', err.message);
    return null;
  }

  if (!action || typeof action !== 'string' || !action.trim()) {
    const err = new Error('Audit recording rejected: Valid action is required.');
    if (required) throw err;
    console.error('[Admin Audit Error]:', err.message);
    return null;
  }

  const cleanAction = action.trim().toLowerCase();
  const cleanEntityType = (entityType || 'unknown').trim().toLowerCase();
  const cleanActor = actorUserId.trim();
  const cleanEntityId = entityId ? String(entityId).trim() : null;

  // Sanitize all payloads deeply to eradicate credentials
  const cleanBefore = sanitizeAuditData(beforeState);
  const cleanAfter = sanitizeAuditData(afterState);
  const cleanMeta = sanitizeAuditData(metadata);

  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();

  const beforeJson = cleanBefore ? JSON.stringify(cleanBefore) : null;
  const afterJson = cleanAfter ? JSON.stringify(cleanAfter) : null;
  const metaJson = cleanMeta ? JSON.stringify(cleanMeta) : null;

  try {
    const isPg = Boolean(db.isPostgres);
    const insertSql = isPg
      ? `INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, before_state, after_state, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
      : `INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, before_state, after_state, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      auditId,
      cleanActor,
      cleanAction,
      cleanEntityType,
      cleanEntityId,
      beforeJson,
      afterJson,
      metaJson,
      now
    ];

    if (isPg && client.query) {
      await client.query(insertSql, params);
    } else {
      await client.run(insertSql, ...params);
    }

    return {
      id: auditId,
      actorUserId: cleanActor,
      action: cleanAction,
      entityType: cleanEntityType,
      entityId: cleanEntityId,
      createdAt: now
    };
  } catch (err) {
    console.error(`[Admin Audit Logging Error] Action: ${cleanAction}, Actor: ${cleanActor}, Error:`, err.message);
    if (required) {
      throw new Error(`Critical administrative action aborted: Required audit record could not be written (${err.message})`);
    }
    return null;
  }
}

/**
 * Human-readable description builder for activity viewer.
 */
function buildAuditDescription(action, entityType, entityId, metadata) {
  const meta = metadata || {};
  switch (action) {
    case 'teacher_subject_assigned':
      return `Assigned subject ${meta.subjectCode || meta.subjectId || ''} to Teacher ${entityId || ''}`.trim();
    case 'teacher_subject_removed':
      return `Removed subject ${meta.subjectCode || meta.subjectId || ''} from Teacher ${entityId || ''}`.trim();
    case 'teacher_invite_created':
      return `Created temporary teacher invitation for ${meta.temporaryUsername || entityId || 'new faculty'}`.trim();
    case 'teacher_invite_bulk_created':
      return `Bulk-created ${meta.count || 'multiple'} temporary teacher invitations`.trim();
    case 'teacher_invite_password_regenerated':
      return `Regenerated temporary password credentials for invite ${entityId || ''}`.trim();
    case 'teacher_invite_reissued':
      return `Reissued expired teacher invitation for ${meta.temporaryUsername || entityId || ''}`.trim();
    case 'teacher_invite_revoked':
      return `Revoked temporary teacher invitation ${entityId || ''}`.trim();
    case 'cohort_promoted':
      return `Promoted cohort ${entityId || ''} to next academic semester`.trim();
    case 'cohort_graduated':
      return `Graduated senior cohort ${entityId || ''}`.trim();
    case 'cohort_created':
      return `Created new student cohort ${entityId || ''}`.trim();
    default:
      return `${action.replace(/_/g, ' ')} on ${entityType} ${entityId || ''}`.trim();
  }
}

/**
 * Queries paginated activity logs for administrative oversight.
 */
async function queryAdminAuditLogs(db, {
  page = 1,
  limit = 20,
  action = null,
  actor = null,
  entityType = null,
  startDate = null,
  endDate = null
}) {
  const safePage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit || '20'), 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  // Check if admin_audit_logs table exists
  try {
    const checkSql = db.isPostgres
      ? "SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_audit_logs'"
      : "SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_audit_logs'";
    const tableExists = await db.get(checkSql);
    if (!tableExists) {
      return {
        logs: [],
        pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
        auditTableAvailable: false,
        message: 'Durable administrative audit logging table (admin_audit_logs) has not yet been migrated to this environment.'
      };
    }
  } catch (checkErr) {
    // If error checking table existence, proceed to try-catch the query
  }

  const whereClauses = [];
  const params = [];

  if (action && action !== 'all') {
    whereClauses.push("a.action = ?");
    params.push(String(action).trim().toLowerCase());
  }

  if (actor && actor !== 'all') {
    whereClauses.push("(a.actor_user_id = ? OR LOWER(s.name) LIKE ? OR LOWER(s.username) LIKE ?)");
    const aPattern = `%${String(actor).trim().toLowerCase()}%`;
    params.push(String(actor).trim(), aPattern, aPattern);
  }

  if (entityType && entityType !== 'all') {
    whereClauses.push("a.entity_type = ?");
    params.push(String(entityType).trim().toLowerCase());
  }

  if (startDate) {
    whereClauses.push("a.created_at >= ?");
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push("a.created_at <= ?");
    params.push(endDate);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const countRow = await db.get(
      `SELECT COUNT(*) AS total
       FROM admin_audit_logs a
       LEFT JOIN students s ON s.studentId = a.actor_user_id
       ${whereSql}`,
      ...params
    );

    const total = Number(countRow?.total || 0);
    const totalPages = Math.ceil(total / safeLimit) || 1;

    const querySql = `
      SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id,
             a.metadata, a.before_state, a.after_state, a.created_at,
             s.name AS actor_name, s.role AS actor_role
      FROM admin_audit_logs a
      LEFT JOIN students s ON s.studentId = a.actor_user_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await db.all(querySql, ...params, safeLimit, offset);

    const logs = (rows || []).map(row => {
      let parsedMeta = null;
      let parsedBefore = null;
      let parsedAfter = null;

      try { parsedMeta = row.metadata ? (typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata)) : null; } catch (e) {}
      try { parsedBefore = row.before_state ? (typeof row.before_state === 'object' ? row.before_state : JSON.parse(row.before_state)) : null; } catch (e) {}
      try { parsedAfter = row.after_state ? (typeof row.after_state === 'object' ? row.after_state : JSON.parse(row.after_state)) : null; } catch (e) {}

      // Double-sanitize for defense in depth
      parsedMeta = sanitizeAuditData(parsedMeta);
      parsedBefore = sanitizeAuditData(parsedBefore);
      parsedAfter = sanitizeAuditData(parsedAfter);

      return {
        id: row.id,
        actor_user_id: row.actor_user_id,
        actor_name: row.actor_name || row.actor_user_id,
        actor_role: row.actor_role || 'admin',
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        description: buildAuditDescription(row.action, row.entity_type, row.entity_id, parsedMeta),
        metadata: parsedMeta,
        before_state: parsedBefore,
        after_state: parsedAfter,
        created_at: row.created_at
      };
    });

    return {
      logs,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1
      },
      auditTableAvailable: true
    };
  } catch (err) {
    if (err.message && (err.message.includes('no such table') || err.message.includes('does not exist'))) {
      return {
        logs: [],
        pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
        auditTableAvailable: false,
        message: 'Durable administrative audit logging table (admin_audit_logs) has not yet been migrated to this environment.'
      };
    }
    throw err;
  }
}

module.exports = {
  sanitizeAuditData,
  ensureAuditSchema,
  recordAdminAudit,
  queryAdminAuditLogs,
  VALID_ACTIONS
};
