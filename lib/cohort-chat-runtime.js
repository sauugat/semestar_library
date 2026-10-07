'use strict';
const { createCohortChat } = require('./cohort-chat');
const { cohortChatDb } = require('./cohort-chat-db');
const { createCohortChatProviders, checkCohortProviderConfig } = require('./cohort-chat-providers');

function createProductionCohortRuntime(database, options = {}) {
  const db = cohortChatDb(database);
  const env = options.env || process.env;
  const configStatus = checkCohortProviderConfig(env);

  if (!configStatus.configured && !options.providers) {
    const unavail = () => Object.assign(new Error('Chat is temporarily unavailable.'), { status: 503 });
    const serviceStub = new Proxy({}, {
      get() { return async () => { throw unavail(); }; }
    });
    return {
      service: serviceStub,
      prepare: async () => { throw unavail(); },
      drain: async () => {},
      ready: false,
      providerConfigured: false,
      missingConfig: configStatus.missing
    };
  }

  const providers = (options && options.providers) ? options.providers : createCohortChatProviders(env);
  const service = createCohortChat(db, providers);
  async function drain(roomId) {
    const events = await db.all("SELECT id FROM chat_realtime_outbox WHERE chat_group_id=? AND status IN ('pending','retry') AND next_attempt_at<=? ORDER BY created_at LIMIT 30", roomId, new Date().toISOString());
    for (const event of events) await service.publishRealtime(event.id);
    const pushes = await db.all("SELECT id FROM push_notification_outbox WHERE chat_group_id=? AND status='pending' ORDER BY id LIMIT 20", roomId);
    for (const push of pushes) await service.deliverPush(push.id, { timeoutMs: 1500 });
  }
  async function prepare(studentId, input) {
    const ctx = await service.getAuthenticatedChatContext(studentId, input);
    const membership = await db.get('SELECT subject FROM chat_realtime_memberships WHERE chat_group_id=? AND student_id=? AND active=1 AND realtime_epoch=?', ctx.chatGroupId, studentId, ctx.realtimeEpoch);
    if (ctx.projectionStatus !== 'ready' || ctx.projectionEpoch !== ctx.realtimeEpoch || !membership) {
      if (!(await service.syncProjection(ctx.chatGroupId)).ready) throw Object.assign(Error('Chat is temporarily unavailable.'), { status: 503 });
    }
    return ctx;
  }
  const mutations = new Set(['send','remove','reaction','read','typing','heartbeat','pin']);
  const routed = new Proxy(service, { get(target, name) {
    if (!mutations.has(name)) return target[name];
    return async (...args) => {
      const ctx = await prepare(args[0], args[1]);
      const result = await target[name](...args);
      // The committed outbox owns retries. A provider failure must not turn a
      // successful send into an apparent failure or cause duplicate messages.
      try { await drain(ctx.chatGroupId); } catch { console.warn('[cohort-chat] delivery deferred'); }
      return result;
    };
  } });
  return { service: routed, prepare, drain, ready: true, providerConfigured: true };
}
module.exports = { createProductionCohortRuntime, checkCohortProviderConfig };
