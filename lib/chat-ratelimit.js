'use strict';

const HOURLY_LIMIT = 100;
const hourlyStore = new Map(); // clientId -> { period: 'YYYY-MM-DDTHH', count: number }

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
  if (req.session && req.session.studentId) {
    return `student:${req.session.studentId}`;
  }
  if (req.sessionID) {
    return `session:${req.sessionID}`;
  }
  return `ip:${req.ip || 'guest'}`;
}

function createHourlyRateLimiter(options = {}) {
  if (options.unlimited === true || options.max === Infinity) {
    return function aiRateLimiter(req, res, next) {
      next();
    };
  }
  const max = options.max || HOURLY_LIMIT;
  const store = options.store || hourlyStore;
  const getPeriod = options.getHourKey || options.getToday || getHourKey;
  const friendlyMessage = options.message || `You’ve reached your limit of ${max} AI chat messages for this hour. Please wait a bit before sending more messages! 🎓`;

  return function aiRateLimiter(req, res, next) {
    // If request has empty message, let downstream validation reject it instead of counting
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      return next();
    }

    const clientId = getClientId(req);
    const period = getPeriod();
    const record = store.get(clientId);

    if (!record || (record.period || record.date) !== period) {
      store.set(clientId, { period, date: period, count: 1 });
      return next();
    }

    if (record.count >= max) {
      return res.status(429).json({
        message: friendlyMessage,
        error: 'HOURLY_RATE_LIMIT_EXCEEDED'
      });
    }

    record.count += 1;
    next();
  };
}

// Backwards compatibility alias
const createDailyRateLimiter = createHourlyRateLimiter;

module.exports = {
  createHourlyRateLimiter,
  createDailyRateLimiter,
  getClientId,
  getHourKey,
  getTodayKey,
  hourlyStore,
  dailyStore: hourlyStore,
  HOURLY_LIMIT,
  DAILY_LIMIT: HOURLY_LIMIT
};
