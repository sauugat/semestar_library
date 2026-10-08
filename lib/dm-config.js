'use strict';

/**
 * Feature flag and configuration for Universal One-to-One Private Messaging.
 * Defaults strictly to disabled.
 */
function isDmEnabled(env = process.env) {
  const val = env.DM_ENABLED;
  return val === '1' || val === 'true';
}

function getDmConfig(env = process.env) {
  return {
    enabled: isDmEnabled(env),
    maxMessageLength: 2000,
    rateLimits: {
      sendWindowSeconds: 10,
      sendMaxRequests: 8,
      createWindowSeconds: 60,
      createMaxRequests: 10,
      searchWindowSeconds: 60,
      searchMaxRequests: 30,
    },
    realtimeTokenTtlSeconds: 120,
    editWindowMinutes: 15,
  };
}

module.exports = {
  isDmEnabled,
  getDmConfig,
};
