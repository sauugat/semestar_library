#!/usr/bin/env node
'use strict';

// An isolated Supabase authorization experiment, NOT an application bridge.
// Uses only an explicit CLI-generated local status file. Never imports .env,
// db.js, server.js, real students, or the application's Supabase configuration.
const fs = require('node:fs');
const { randomUUID, createHmac } = require('node:crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

function localConfig(filename) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const key of ['API_URL', 'DB_URL']) {
    const url = new URL(config[key]);
    if (url.hostname !== '127.0.0.1' || url.search || url.hash) {
      throw new Error(`${key} must point explicitly to 127.0.0.1 without URL options`);
    }
  }
  if (!config.ANON_KEY || !config.JWT_SECRET) throw new Error('Local Supabase status credentials are missing');
  return config;
}

function token(secret, subject) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: subject, role: 'authenticated', aud: 'authenticated',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 180,
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function join(channel) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve('PROBE_TIMEOUT'), 12000);
    channel.subscribe(status => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
}

async function waitUntil(check, milliseconds = 4000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

async function probe(config) {
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `cohort_probe_${suffix}`;
  const readPolicy = `cohort_probe_read_${suffix}`;
  const presencePolicy = `cohort_probe_presence_${suffix}`;
  const room = `chat:${randomUUID()}`;
  const alice = randomUUID(), bob = randomUUID(), outsider = randomUUID();
  const pool = new Pool({ connectionString: config.DB_URL, connectionTimeoutMillis: 3000 });
  const clients = [];
  const result = { environment: 'disposable local Supabase only', privateChannel: true };
  const client = async id => {
    const jwt = token(config.JWT_SECRET, id);
    const instance = createClient(config.API_URL, config.ANON_KEY, {
      accessToken: async () => jwt,
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(instance);
    // The constructor's asynchronous token callback can race the first join.
    await instance.realtime.setAuth(jwt);
    return instance;
  };
  try {
    // Unique schema/policy names; no destructive reset of public/auth/realtime.
    // A backend-only membership projection: student clients cannot edit it.
    await pool.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.rooms (topic text PRIMARY KEY, active boolean NOT NULL);
      CREATE TABLE ${schema}.memberships (topic text NOT NULL REFERENCES ${schema}.rooms(topic), subject uuid NOT NULL, PRIMARY KEY(topic, subject));
      CREATE FUNCTION ${schema}.allowed(requested_topic text) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (SELECT 1 FROM ${schema}.memberships m JOIN ${schema}.rooms r USING(topic)
          WHERE m.topic = requested_topic AND m.subject = auth.uid() AND r.active)
        $$;
      REVOKE ALL ON FUNCTION ${schema}.allowed(text) FROM PUBLIC;
      GRANT USAGE ON SCHEMA ${schema} TO authenticated;
      GRANT EXECUTE ON FUNCTION ${schema}.allowed(text) TO authenticated;
      CREATE POLICY ${readPolicy} ON realtime.messages FOR SELECT TO authenticated
        USING (${schema}.allowed(realtime.topic()) AND extension IN ('broadcast','presence'));
      CREATE POLICY ${presencePolicy} ON realtime.messages FOR INSERT TO authenticated
        WITH CHECK (${schema}.allowed(realtime.topic()) AND extension = 'presence');
    `);
    await pool.query(`INSERT INTO ${schema}.rooms VALUES ($1, true)`, [room]);
    await pool.query(`INSERT INTO ${schema}.memberships VALUES ($1,$2),($1,$3)`, [room, alice, bob]);
    const a = (await client(alice)).channel(room, { config: { private: true, presence: { key: alice } } });
    const b = (await client(bob)).channel(room, { config: { private: true, presence: { key: bob } } });
    // Presence listeners are needed for the client to request presence permission.
    a.on('presence', { event: 'sync' }, () => {});
    b.on('presence', { event: 'sync' }, () => {});
    result.authorizedJoin = await join(a);
    result.secondAuthorizedJoin = await join(b);
    const wrong = (await client(outsider)).channel(room, { config: { private: true } });
    result.otherRoomMemberJoin = await join(wrong);
    if (result.authorizedJoin !== 'SUBSCRIBED' || result.secondAuthorizedJoin !== 'SUBSCRIBED' || result.otherRoomMemberJoin !== 'CHANNEL_ERROR') {
      result.verdict = 'INCONCLUSIVE_BASELINE';
      return result;
    }
    const before = randomUUID();
    await a.track({ probe: before });
    result.authorizedPresenceReceived = await waitUntil(() => JSON.stringify(b.presenceState()).includes(before));
    if (!result.authorizedPresenceReceived) {
      result.verdict = 'INCONCLUSIVE_BASELINE';
      return result;
    }
    // Simulate the acknowledged revoke/room-close projection from Neon.
    await pool.query(`UPDATE ${schema}.rooms SET active = false WHERE topic = $1`, [room]);
    await pool.query(`DELETE FROM ${schema}.memberships WHERE topic = $1`, [room]);
    const stale = (await client(alice)).channel(room, { config: { private: true } });
    result.staleMemberNewJoin = await join(stale);
    const after = randomUUID();
    result.closedRoomTrackAck = await a.track({ probe: after });
    result.closedRoomPresenceReceivedByExistingMember = await waitUntil(() => JSON.stringify(b.presenceState()).includes(after));
    result.verdict = result.closedRoomPresenceReceivedByExistingMember
      ? 'BLOCKED_EXISTING_CONNECTION_RETAINS_PRESENCE_ACCESS'
      : 'NO_STALE_PRESENCE_OBSERVED_NOT_FULL_BRIDGE_PROOF';
    return result;
  } finally {
    await Promise.allSettled(clients.map(instance => instance.removeAllChannels()));
    for (const instance of clients) await instance.realtime.disconnect();
    // Only objects created by this unique probe; contains synthetic UUIDs only.
    try {
      await pool.query(`DROP POLICY IF EXISTS ${readPolicy} ON realtime.messages;
        DROP POLICY IF EXISTS ${presencePolicy} ON realtime.messages;
        DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    } finally { await pool.end(); }
  }
}

if (require.main === module) {
  if (process.argv.length !== 4 || process.argv[2] !== '--disposable-local-supabase') {
    console.error('Usage: node scripts/probe-cohort-realtime.cjs --disposable-local-supabase /path/to/local-status.json');
    process.exitCode = 1;
  } else {
    Promise.resolve().then(() => probe(localConfig(process.argv[3]))).then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 2; // This probe never certifies a complete production bridge.
    }).catch(error => { console.error(`Local realtime probe failed: ${error.message}`); process.exitCode = 1; });
  }
}

module.exports = { localConfig, token, probe };
