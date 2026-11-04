'use strict';

const HOURLY_LIMIT = 100;
const ACTION_CONFIRM_LIMIT = 30;
const DEFAULT_WINDOW_SECONDS = 3600;
const hourlyStore = new Map(); // clientId -> { period: 'YYYY-MM-DDTHH', count: number }
const ensuredRateDbs = new WeakMap();

function getHourKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}`;
}

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getClientId(req) {
  const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId;
  if (studentId) {
    return `student:${studentId}`;
  }
  if (req.sessionID) {
    return `session:${req.sessionID}`;
  }
  return `ip:${req.ip || 'guest'}`;
}

async function ensureRateLimitTable(db) {
  if (!db) return;
  if (ensuredRateDbs.has(db)) return ensuredRateDbs.get(db);
  if (process.env.NODE_ENV === 'production' || process.env.SEMESTER_PRODUCTION === 'true') {
    const resolved = Promise.resolve();
    ensuredRateDbs.set(db, resolved);
    return resolved;
  }
  const promise = (async () => {
    const sql = db.isPostgres
      ? `CREATE TABLE IF NOT EXISTS dm_rate_limits (
           rate_key TEXT PRIMARY KEY,
           request_count INTEGER NOT NULL DEFAULT 1,
           window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         );`
      : `CREATE TABLE IF NOT EXISTS dm_rate_limits (
           rate_key TEXT PRIMARY KEY,
           request_count INTEGER NOT NULL DEFAULT 1,
           window_start TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );`;
    if (typeof db.exec === 'function') {
      await db.exec(sql);
    } else if (typeof db.query === 'function') {
      await db.query(sql);
    } else if (typeof db.run === 'function') {
      await db.run(sql);
    }
  })().catch(err => {
    ensuredRateDbs.delete(db);
    throw err;
  });
  ensuredRateDbs.set(db, promise);
  return promise;
}

/**
 * Distributed database-backed rate limit check using dm_rate_limits.
 * Works atomically across serverless / multi-instance deployments on PostgreSQL
 * and supports SQLite in local/test environments.
 */
async function checkDistributedRateLimit(db, rateKey, maxRequests, windowSeconds = DEFAULT_WINDOW_SECONDS, nowIsoFn = () => new Date().toISOString()) {
  await ensureRateLimitTable(db);
  const isPg = Boolean(db && (db.isPostgres || (db.query && !db.all)));

  if (isPg) {
    const query = `
      INSERT INTO dm_rate_limits (rate_key, request_count, window_start)
      VALUES ($1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (rate_key) DO UPDATE
      SET request_count = CASE
            WHEN dm_rate_limits.window_start + ($2 || ' seconds')::interval < CURRENT_TIMESTAMP THEN 1
            ELSE dm_rate_limits.request_count + 1
          END,
          window_start = CASE
            WHEN dm_rate_limits.window_start + ($2 || ' seconds')::interval < CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
            ELSE dm_rate_limits.window_start
          END
      RETURNING request_count;
    `;
    let row = null;
    if (typeof db.get === 'function') {
      row = await db.get(query, rateKey, String(windowSeconds));
    } else if (typeof db.query === 'function') {
      const res = await db.query(query, [rateKey, String(windowSeconds)]);
      row = Array.isArray(res) ? res[0] : (res?.rows?.[0] || null);
    }
    if (!row || row.request_count === undefined) {
      throw new Error('Failed to read distributed rate limit counter from PostgreSQL');
    }
    const count = Number(row.request_count);
    return { allowed: count <= maxRequests, count };
  }

  // SQLite / libsql adapter
  const nowStr = nowIsoFn();
  const existing = await db.get('SELECT request_count, window_start FROM dm_rate_limits WHERE rate_key = ?', rateKey);
  if (!existing) {
    await db.run('INSERT INTO dm_rate_limits (rate_key, request_count, window_start) VALUES (?, 1, ?)', rateKey, nowStr);
    return { allowed: 1 <= maxRequests, count: 1 };
  }
  const startMs = new Date(existing.window_start).getTime();
  const nowMs = new Date(nowStr).getTime();
  if (Number.isFinite(startMs) && (nowMs - startMs >= windowSeconds * 1000)) {
    await db.run('UPDATE dm_rate_limits SET request_count = 1, window_start = ? WHERE rate_key = ?', nowStr, rateKey);
    return { allowed: 1 <= maxRequests, count: 1 };
  }
  const newCount = Number(existing.request_count || 0) + 1;
  await db.run('UPDATE dm_rate_limits SET request_count = ? WHERE rate_key = ?', newCount, rateKey);
  return { allowed: newCount <= maxRequests, count: newCount };
}

function checkInMemoryRateLimit(store, clientId, period, max) {
  const record = store.get(clientId);
  if (!record || (record.period || record.date) !== period) {
    store.set(clientId, { period, date: period, count: 1 });
    return { allowed: 1 <= max, count: 1 };
  }
  if (record.count >= max) {
    return { allowed: false, count: record.count };
  }
  record.count += 1;
  return { allowed: true, count: record.count };
}

function syncInMemoryCount(store, key, period, count) {
  const existing = store.get(key);
  const prev = (existing && (existing.period || existing.date) === period) ? Number(existing.count || 0) : 0;
  store.set(key, { period, date: period, count: Math.max(prev, Number(count || 0)) });
}

function createHourlyRateLimiter(options = {}) {
  if (options.unlimited === true || options.max === Infinity) {
    return function aiRateLimiter(req, res, next) {
      next();
    };
  }
  const max = options.max || HOURLY_LIMIT;
  const store = options.store || hourlyStore;
  const db = options.db || null;
  const windowSeconds = options.windowSeconds || DEFAULT_WINDOW_SECONDS;
  const namespace = options.namespace || 'kyana:chat';
  const requireMessage = options.requireMessage !== false;
  const getPeriod = options.getHourKey || options.getToday || getHourKey;
  const friendlyMessage = options.message || `You’ve reached your limit of ${max} AI chat messages for this hour. Please wait a bit before sending more messages! 🎓`;
  const errorCode = options.errorCode || 'HOURLY_RATE_LIMIT_EXCEEDED';

  return function aiRateLimiter(req, res, next) {
    if (requireMessage) {
      // If request has empty message, let downstream validation reject it instead of counting
      const message = req.body?.message;
      if (typeof message !== 'string' || !message.trim()) {
        return next();
      }
    }

    const clientId = getClientId(req);
    const period = getPeriod();

    // Distributed DB-backed mode when db is provided
    if (db && (typeof db.get === 'function' || typeof db.query === 'function')) {
      const rateKey = `${namespace}:${clientId}:${period}`;
      const memKey = `${namespace}:${clientId}`;
      return checkDistributedRateLimit(db, rateKey, max, windowSeconds, options.nowIso)
        .then(result => {
          syncInMemoryCount(store, memKey, period, result.count);
          if (!result.allowed) {
            return res.status(429).json({
              message: friendlyMessage,
              error: errorCode
            });
          }
          next();
        })
        .catch(() => {
          // Safe fallback to synchronized in-memory limiter if DB throws an error
          const mem = checkInMemoryRateLimit(store, memKey, period, max);
          if (!mem.allowed) {
            return res.status(429).json({
              message: friendlyMessage,
              error: errorCode
            });
          }
          next();
        });
    }

    // Synchronous in-memory mode (used when no db is supplied)
    const mem = checkInMemoryRateLimit(store, clientId, period, max);
    if (!mem.allowed) {
      return res.status(429).json({
        message: friendlyMessage,
        error: errorCode
      });
    }
    next();
  };
}

function createActionConfirmRateLimiter(options = {}) {
  const max = options.max || ACTION_CONFIRM_LIMIT;
  return createHourlyRateLimiter({
    ...options,
    max,
    namespace: options.namespace || 'kyana:action_confirm',
    requireMessage: false,
    errorCode: 'ACTION_CONFIRM_RATE_LIMIT_EXCEEDED',
    message: options.message || `You’ve reached the limit of ${max} action confirmations for this hour. Please wait before confirming additional actions.`
  });
}

// Backwards compatibility alias
const createDailyRateLimiter = createHourlyRateLimiter;

module.exports = {
  createHourlyRateLimiter,
  createDailyRateLimiter,
  createActionConfirmRateLimiter,
  checkDistributedRateLimit,
  getClientId,
  getHourKey,
  getTodayKey,
  hourlyStore,
  dailyStore: hourlyStore,
  HOURLY_LIMIT,
  ACTION_CONFIRM_LIMIT,
  DAILY_LIMIT: HOURLY_LIMIT
};
