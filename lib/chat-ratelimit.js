'use strict';

// Note: This in-memory rate limiter is best-effort per serverless instance.
// For strict global enforcement across multiple instances, back with Redis/DB storage.
const DEFAULT_HOURLY_LIMIT = 60;
const DEFAULT_DAILY_LIMIT = 300;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HOURLY_LIMIT = parsePositiveInt(process.env.AI_CHAT_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT);
const DAILY_LIMIT = parsePositiveInt(process.env.AI_CHAT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);

const hourlyStore = new Map(); // clientId -> { period: 'YYYY-MM-DDTHH', count: number }
const dailyStore = new Map(); // clientId -> { period: 'YYYY-MM-DD', count: number }

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

function secondsUntilNextHour(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function secondsUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function getClientId(req) {
  const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId;
  if (studentId) {
    return `student:${studentId}`;
  }
  const userId = req.user?.id || req.student?.id || req.session?.userId;
  if (userId) {
    return `user:${userId}`;
  }
  if (req.sessionID) {
    return `session:${req.sessionID}`;
  }
  return `ip:${req.ip || 'guest'}`;
}

function pruneExpiredEntries(store, activePeriod) {
  for (const [key, entry] of store.entries()) {
    if (!entry || (entry.period || entry.date) !== activePeriod) {
      store.delete(key);
    }
  }
}

function createWindowRateLimiter(buildWindows, options = {}) {
  const getNow = typeof options.now === 'function' ? options.now : () => new Date();

  return function aiRateLimiter(req, res, next) {
    // If request has empty message, let downstream validation reject it instead of counting
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      return next();
    }

    const clientId = getClientId(req);
    const now = getNow();
    const windows = buildWindows(now);
    const snapshots = [];

    for (const win of windows) {
      if (!Number.isFinite(win.max)) {
        continue;
      }
      const period = win.getPeriod(now);
      pruneExpiredEntries(win.store, period);
      const record = win.store.get(clientId);
      const currentCount = record && (record.period || record.date) === period ? record.count : 0;

      if (currentCount >= win.max) {
        const retryAfter = typeof win.getRetryAfterSeconds === 'function' ? win.getRetryAfterSeconds(now) : undefined;
        if (retryAfter && typeof res.set === 'function') {
          res.set('Retry-After', String(retryAfter));
        }
        return res.status(429).json({
          error: win.error,
          message: win.message,
          ...(retryAfter ? { retryAfter } : {})
        });
      }

      snapshots.push({ win, period, currentCount });
    }

    for (const { win, period, currentCount } of snapshots) {
      win.store.set(clientId, { period, date: period, count: currentCount + 1 });
    }

    next();
  };
}

function createHourlyRateLimiter(options = {}) {
  if (options.unlimited === true || options.max === Infinity) {
    return function aiRateLimiter(req, res, next) {
      next();
    };
  }
  const max = options.max || parsePositiveInt(process.env.AI_CHAT_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT);
  const store = options.store || hourlyStore;
  const getPeriod = options.getHourKey || options.getToday || getHourKey;
  const friendlyMessage = options.message || `You’ve reached your limit of ${max} AI chat messages for this hour. Please wait a bit before sending more messages! 🎓`;
  const errorCode = options.error || 'HOURLY_RATE_LIMIT_EXCEEDED';

  return createWindowRateLimiter(() => [{
    max,
    store,
    getPeriod,
    getRetryAfterSeconds: secondsUntilNextHour,
    error: errorCode,
    message: friendlyMessage
  }], options);
}

function createChatRateLimiter(options = {}) {
  if (options.unlimited === true || (options.hourlyMax === Infinity && options.dailyMax === Infinity)) {
    return function aiRateLimiter(req, res, next) {
      next();
    };
  }
  const hourlyMax = options.hourlyMax === Infinity
    ? Infinity
    : parsePositiveInt(options.hourlyMax, parsePositiveInt(process.env.AI_CHAT_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT));
  const dailyMax = options.dailyMax === Infinity
    ? Infinity
    : parsePositiveInt(options.dailyMax, parsePositiveInt(process.env.AI_CHAT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT));
  const hStore = options.hourlyStore || hourlyStore;
  const dStore = options.dailyStore || dailyStore;
  const getHourlyPeriod = options.getHourKey || getHourKey;
  const getDailyPeriod = options.getToday || options.getDayKey || getTodayKey;
  const dailyMessage = options.dailyMessage || `You’ve reached your daily limit of ${dailyMax} AI chat messages. Please try again tomorrow! 🎓`;
  const hourlyMessage = options.hourlyMessage || `You’ve reached your limit of ${hourlyMax} AI chat messages for this hour. Please wait a bit before sending more messages! 🎓`;

  return createWindowRateLimiter(() => [
    {
      max: dailyMax,
      store: dStore,
      getPeriod: getDailyPeriod,
      getRetryAfterSeconds: secondsUntilNextDay,
      error: 'DAILY_RATE_LIMIT_EXCEEDED',
      message: dailyMessage
    },
    {
      max: hourlyMax,
      store: hStore,
      getPeriod: getHourlyPeriod,
      getRetryAfterSeconds: secondsUntilNextHour,
      error: 'HOURLY_RATE_LIMIT_EXCEEDED',
      message: hourlyMessage
    }
  ], options);
}

// Backwards compatibility alias
const createDailyRateLimiter = createHourlyRateLimiter;

module.exports = {
  createHourlyRateLimiter,
  createDailyRateLimiter,
  createChatRateLimiter,
  getClientId,
  getHourKey,
  getTodayKey,
  hourlyStore,
  dailyStore,
  HOURLY_LIMIT,
  DAILY_LIMIT,
  DEFAULT_HOURLY_LIMIT,
  DEFAULT_DAILY_LIMIT
};
