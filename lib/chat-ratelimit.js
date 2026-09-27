'use strict';

const DAILY_LIMIT = 10;
const dailyStore = new Map(); // clientId -> { date: 'YYYY-MM-DD', count: number }

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

function createDailyRateLimiter(options = {}) {
  const max = options.max || DAILY_LIMIT;
  const store = options.store || dailyStore;
  const getToday = options.getToday || getTodayKey;
  const friendlyMessage = options.message || "You’ve reached your daily limit of 10 messages for today. Your limit will reset at midnight — see you tomorrow! 🎓";

  return function aiDailyRateLimiter(req, res, next) {
    // If request has empty message, let downstream validation reject it instead of counting
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      return next();
    }

    const clientId = getClientId(req);
    const today = getToday();
    const record = store.get(clientId);

    if (!record || record.date !== today) {
      store.set(clientId, { date: today, count: 1 });
      return next();
    }

    if (record.count >= max) {
      return res.status(429).json({
        message: friendlyMessage,
        error: 'DAILY_RATE_LIMIT_EXCEEDED'
      });
    }

    record.count += 1;
    next();
  };
}

module.exports = {
  createDailyRateLimiter,
  getClientId,
  getTodayKey,
  dailyStore,
  DAILY_LIMIT
};
