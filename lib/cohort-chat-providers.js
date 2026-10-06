'use strict';
const { createHash, createHmac } = require('node:crypto');
const { sendExpoPushBatch } = require('./push-notifications');

function createCohortChatProviders(env = process.env, transport = fetch) {
  const url = new URL(env.COHORT_SUPABASE_URL || '');
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error('Invalid cohort Supabase origin');
  const publicKey = env.COHORT_SUPABASE_PUBLIC_KEY;
  const serviceKey = env.COHORT_SUPABASE_SERVICE_KEY;
  const signingSecret = env.COHORT_SUPABASE_JWT_SECRET;
  if (!publicKey || !serviceKey || !signingSecret || signingSecret.length < 32) throw Error('Cohort provider credentials are required');
  const origin = url.origin;
  const request = async (path, body) => {
    const result = await transport(origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!result.ok) throw Error(`Cohort provider rejected request (${result.status})`);
    return result;
  };
  return {
    production: true,
    includeStaff: true,
    credentials: {
      // Legacy application logins are already authenticated by requireLogin.
      // Their stable, namespaced subject is only used for the chat projection;
      // this creates no Supabase Auth account or academic membership.
      subject: async member => {
        if (member.supabase_uid) return member.supabase_uid;
        if (!member.student_id) throw Error('Authenticated student identity required');
        const hex = createHash('sha256').update(`semester-library:cohort-realtime:${member.student_id}`).digest('hex');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
      },
      issue: async ({ subject, chatGroupId, realtimeEpoch, expiry }) => {
        const now = Math.floor(Date.now() / 1000), exp = Math.floor(Date.parse(expiry) / 1000);
        if (!subject || !chatGroupId || !Number.isInteger(realtimeEpoch) || !(exp > now && exp <= now + 120)) throw Error('Invalid room credential');
        const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const data = `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:subject,role:'authenticated',aud:'authenticated',iat:now,exp,chat_room_id:chatGroupId,chat_epoch:realtimeEpoch})}`;
        return `${data}.${createHmac('sha256', signingSecret).update(data).digest('base64url')}`;
      },
    },
    projection: { sync: async snapshot => (await request('/rest/v1/rpc/sync_cohort_chat_projection', { snapshot })).json() },
    realtime: {
      publicConnection: { url: origin, key: publicKey },
      send: async event => {
        if (!event.private || !/^chat:[0-9a-f-]{36}:\d+$/.test(event.topic)) throw Error('Private room publication required');
        await request('/realtime/v1/api/broadcast', { messages: [event] });
      },
    },
    push: { sendBatch: sendExpoPushBatch },
  };
}

module.exports = { createCohortChatProviders };
