'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Feature flag check for KYANA AI 3.0 Knowledge Engine with user allowlist support.
 *
 * Rules:
 *   1. KYANA_KNOWLEDGE_V3 !== 'true' -> OFF for everyone (false)
 *   2. KYANA_KNOWLEDGE_V3 === 'true' and KYANA_KNOWLEDGE_V3_USERS is empty/undefined -> OFF for everyone (false, safe default)
 *   3. KYANA_KNOWLEDGE_V3 === 'true' and KYANA_KNOWLEDGE_V3_USERS === '*' -> ON for everyone (true)
 *   4. KYANA_KNOWLEDGE_V3 === 'true' and KYANA_KNOWLEDGE_V3_USERS is comma-separated list -> ON only if userId is in list
 *
 * @param {string} [userId] - Optional student/user ID to check against allowlist
 * @returns {boolean}
 */
function isKnowledgeIndexingEnabled() {
  return process.env.KYANA_KNOWLEDGE_V3 === 'true' && Boolean(String(process.env.KYANA_KNOWLEDGE_V3_USERS || '').trim());
}

function isKnowledgeV3Enabled(userId = null) {
  if (process.env.KYANA_KNOWLEDGE_V3 !== 'true') {
    return false;
  }

  const rawUsers = String(process.env.KYANA_KNOWLEDGE_V3_USERS || '').trim();
  if (!rawUsers) {
    return false;
  }

  if (rawUsers === '*') {
    return true;
  }

  if (!userId) {
    return false;
  }

  const allowed = rawUsers
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return allowed.includes(String(userId).trim());
}

/**
 * Loads the raw SQL migration files.
 */
function getMigrationSql() {
  const upSqlPath = path.join(__dirname, '..', 'migrations', '20261014_kyana_v3_knowledge.up.sql');
  const downSqlPath = path.join(__dirname, '..', 'migrations', '20261014_kyana_v3_knowledge.down.sql');

  return {
    up: fs.readFileSync(upSqlPath, 'utf8'),
    down: fs.readFileSync(downSqlPath, 'utf8')
  };
}

/**
 * Applies the UP migration on a PostgreSQL client/pool/adapter.
 * Idempotent and safe to run multiple times.
 */
async function applyKnowledgeMigration(client) {
  const { up } = getMigrationSql();
  if (typeof client.query === 'function') {
    return client.query(up);
  }
  if (typeof client.exec === 'function') {
    return client.exec(up);
  }
  throw new Error('[KnowledgeSchema] Unsupported database client interface for migration');
}

/**
 * Applies the DOWN migration on a PostgreSQL client/pool/adapter.
 * Reversible rollback.
 */
async function rollbackKnowledgeMigration(client) {
  const { down } = getMigrationSql();
  if (typeof client.query === 'function') {
    return client.query(down);
  }
  if (typeof client.exec === 'function') {
    return client.exec(down);
  }
  throw new Error('[KnowledgeSchema] Unsupported database client interface for rollback');
}

/**
 * Verifies if all required tables and the vector extension are present in the target database.
 */
async function isKnowledgeSchemaReady(client) {
  const queryFn = async (sql, params = []) => {
    if (typeof client.query === 'function') {
      const res = await client.query(sql, params);
      return Array.isArray(res) ? res : (res.rows || []);
    }
    if (typeof client.all === 'function') {
      return client.all(sql, ...params);
    }
    throw new Error('[KnowledgeSchema] No compatible query method');
  };

  try {
    const extRows = await queryFn("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    const hasVector = extRows.length > 0;

    const tableRows = await queryFn(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('knowledge_resources', 'knowledge_chunks', 'knowledge_jobs')
    `);

    const tableNames = new Set(tableRows.map(r => r.table_name || r.tableName));
    const hasTables = tableNames.has('knowledge_resources') && 
                      tableNames.has('knowledge_chunks') && 
                      tableNames.has('knowledge_jobs');

    return {
      ready: hasVector && hasTables,
      hasVector,
      hasResourcesTable: tableNames.has('knowledge_resources'),
      hasChunksTable: tableNames.has('knowledge_chunks'),
      hasJobsTable: tableNames.has('knowledge_jobs')
    };
  } catch (err) {
    return {
      ready: false,
      error: err.message
    };
  }
}

/**
 * Idempotent initializer to ensure schema exists when the feature flag is enabled.
 */
async function ensureKnowledgeSchema(client) {
  if (!isKnowledgeIndexingEnabled()) {
    return { active: false, status: 'disabled_by_feature_flag' };
  }

  const check = await isKnowledgeSchemaReady(client);
  if (!check.ready) {
    await applyKnowledgeMigration(client);
  }
  return { active: true, status: 'ready' };
}

module.exports = {
  isKnowledgeV3Enabled,
  isKnowledgeIndexingEnabled,
  getMigrationSql,
  applyKnowledgeMigration,
  rollbackKnowledgeMigration,
  isKnowledgeSchemaReady,
  ensureKnowledgeSchema
};
