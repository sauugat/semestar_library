'use strict';
const { createHash, createHmac } = require('node:crypto');
const { sendExpoPushBatch } = require('./push-notifications');

function resolveCohortProviderEnv(env = process.env) {
  const refUrl = env.COHORT_REALTIME_SUPABASE_PROJECT_REF ? `https://${env.COHORT_REALTIME_SUPABASE_PROJECT_REF}.supabase.co` : '';
  const urlStr = (env.COHORT_SUPABASE_URL || env.COHORT_REALTIME_SUPABASE_URL || refUrl || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
  const publicKey = (env.COHORT_SUPABASE_PUBLIC_KEY || env.COHORT_REALTIME_SUPABASE_PUBLIC_KEY || env.COHORT_REALTIME_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  const serviceKey = (env.COHORT_SUPABASE_SERVICE_KEY || env.COHORT_REALTIME_SUPABASE_SERVICE_ROLE_KEY || env.COHORT_REALTIME_SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '').trim();
  const signingSecret = (env.COHORT_SUPABASE_JWT_SECRET || env.COHORT_REALTIME_SUPABASE_JWT_SECRET || env.SUPABASE_JWT_SECRET || '').trim();
  return { urlStr, publicKey, serviceKey, signingSecret };
}

function checkCohortProviderConfig(env = process.env) {
  const { urlStr, publicKey, serviceKey, signingSecret } = resolveCohortProviderEnv(env);
  let validUrl = false;
  try {
    const url = new URL(urlStr);
    validUrl = url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  } catch {}

  const missing = [];
  if (!validUrl) missing.push('COHORT_SUPABASE_URL');
  if (!publicKey) missing.push('COHORT_SUPABASE_PUBLIC_KEY');
  if (!serviceKey) missing.push('COHORT_SUPABASE_SERVICE_KEY');
  if (!signingSecret || signingSecret.length < 32) missing.push('COHORT_SUPABASE_JWT_SECRET');

  return {
    configured: missing.length === 0,
    missing
  };
}

function createCohortChatProviders(env = process.env, transport = fetch) {
  const { urlStr, publicKey, serviceKey, signingSecret } = resolveCohortProviderEnv(env);
  const url = new URL(urlStr || '');
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error('Invalid cohort Supabase origin');
  if (!publicKey || !serviceKey || !signingSecret || signingSecret.length < 32) throw Error('Cohort provider credentials are required');
  const origin = url.origin;
  const request = async (path, body) => {
    const result = await transport(origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!result.ok) {
      const errText = await result.text().catch(() => '');
      throw Error(`Cohort provider rejected request (${result.status}): ${errText}`);
    }
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

module.exports = { createCohortChatProviders, checkCohortProviderConfig };
