'use strict';
const { createCohortChat } = require('./cohort-chat');
const { cohortChatDb } = require('./cohort-chat-db');
const { createCohortChatProviders, checkCohortProviderConfig } = require('./cohort-chat-providers');
const { deferDelivery } = require('./background-delivery');

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
      scheduleDrain: () => {},
      ready: false,
      providerConfigured: false,
      missingConfig: configStatus.missing
    };
  }

  const providers = (options && options.providers) ? options.providers : createCohortChatProviders(env);
  const service = createCohortChat(db, providers);
  async function drain(roomId) {
    const deadline = Date.now() + 5000;
    const events = await db.all("SELECT id FROM chat_realtime_outbox WHERE chat_group_id=? AND status IN ('pending','retry') AND next_attempt_at<=? ORDER BY created_at LIMIT 30", roomId, new Date().toISOString());
    for (const event of events) {
      if (Date.now() >= deadline) return;
      await service.publishRealtime(event.id);
    }
    if (Date.now() >= deadline) return;
    const pushes = await db.all("SELECT id FROM push_notification_outbox WHERE chat_group_id=? AND status='pending' ORDER BY id LIMIT 20", roomId);
    for (const push of pushes) {
      if (Date.now() >= deadline) return;
      await service.deliverPush(push.id, { timeoutMs: 1500 });
    }
  }
  const draining = new Map();
  function scheduleDrain(roomId) {
    const existing = draining.get(roomId);
    if (existing) { existing.again = true; return (options.deferDelivery || deferDelivery)(() => existing.work); }
    const state = { again: false, work: null };
    draining.set(roomId, state);
    state.work = (options.deferDelivery || deferDelivery)(async () => {
      try {
        // One follow-up catches messages committed during the first batch. Any
        // remaining durable rows are retried on the next room request.
        await drain(roomId);
        if (state.again) await drain(roomId);
      } finally { draining.delete(roomId); }
    });
    return state.work;
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
      scheduleDrain(ctx.chatGroupId);
      return result;
    };
  } });
  return { service: routed, prepare, drain, scheduleDrain, ready: true, providerConfigured: true };
}
module.exports = { createProductionCohortRuntime, checkCohortProviderConfig };
