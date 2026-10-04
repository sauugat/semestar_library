#!/usr/bin/env node
'use strict';

// Disposable security research only. No application modules, .env or real data.
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { localConfig } = require('./probe-cohort-realtime.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const topicFor = (roomId, epoch) => `chat:${roomId}:${epoch}`;

function validateProofConfig(config) {
  for (const [name, protocols] of [['API_URL', ['http:']], ['DB_URL', ['postgres:', 'postgresql:']]]) {
    const url = new URL(config[name]);
    if (url.hostname !== '127.0.0.1' || !protocols.includes(url.protocol) || url.search || url.hash ||
        (name === 'API_URL' && (url.username || url.password || url.pathname !== '/'))) {
      throw new Error(`${name}: only explicit disposable loopback endpoints without overrides are allowed`);
    }
  }
  for (const name of ['ANON_KEY', 'JWT_SECRET', 'SERVICE_ROLE_KEY']) {
    if (typeof config[name] !== 'string' || !config[name]) throw new Error(`Missing disposable credential: ${name}`);
  }
  return config;
}

function signCredential(secret, subject, roomId, epoch, ttl = 120) {
  const now = Math.floor(Date.now() / 1000);
  const enc = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
    sub: subject, role: 'authenticated', aud: 'authenticated', iat: now,
    exp: now + ttl, chat_room_id: roomId, chat_epoch: epoch,
  })}`;
  return { token: `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`, expiry: now + ttl };
}

async function waitFor(check, label, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

// Only public project key and one scoped short-lived JWT reach this client.
async function connectStudent({ apiUrl, publicKey, credential, topic, privateChannel = true }) {
  const client = createClient(apiUrl, publicKey, {
    accessToken: async () => credential, // Hostile client never refreshes it.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.realtime.setAuth(credential);
  const channel = client.channel(topic, {
    config: { private: privateChannel, broadcast: { ack: true, self: true }, presence: { key: randomUUID() } },
  });
  const broadcasts = [], presence = [], statuses = [];
  channel.on('broadcast', { event: '*' }, value => broadcasts.push(value));
  channel.on('presence', { event: 'sync' }, () => presence.push(channel.presenceState()));
  const status = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('PROBE_TIMEOUT'), 10000);
    channel.subscribe(next => {
      statuses.push(next);
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(next)) {
        clearTimeout(timer);
        resolve(next);
      }
    });
  });
  return { client, channel, status, statuses, broadcasts, presence, topic, credential };
}

function createBackend(pool, schema, config, journal) {
  const unavailable = () => { const error = new Error('This conversation is no longer available.'); error.code = 'UNAVAILABLE'; return error; };
  const locked = async (roomId, operation) => {
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { rows: [room] } = await tx.query(`SELECT * FROM ${schema}.authority_rooms WHERE id=$1 FOR UPDATE`, [roomId]);
      if (!room || room.status !== 'active') throw unavailable();
      const result = await operation(tx, room);
      await tx.query('COMMIT');
      return result;
    } catch (error) { await tx.query('ROLLBACK'); throw error; }
    finally { tx.release(); }
  };
  const checkProjection = async room => {
    const { rows: [projection] } = await pool.query(`SELECT * FROM ${schema}.projection_rooms WHERE id=$1`, [room.id]);
    if (!projection || projection.status !== 'active' || projection.epoch !== room.epoch) throw unavailable();
  };
  return {
    async createRoom(code, subjects) {
      const id = randomUUID();
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query(`INSERT INTO ${schema}.authority_rooms VALUES ($1,$2,1,'active')`, [id, code]);
        await tx.query(`INSERT INTO ${schema}.projection_rooms VALUES ($1,1,'active')`, [id]);
        for (const subject of subjects) {
          await tx.query(`INSERT INTO ${schema}.authority_members VALUES ($1,$2)`, [subject, id]);
          await tx.query(`INSERT INTO ${schema}.projection_members VALUES ($1,$2,1)`, [subject, id]);
        }
        await tx.query('COMMIT');
        return id;
      } catch (error) { await tx.query('ROLLBACK'); throw error; }
      finally { tx.release(); }
    },
    // Prototype of GET /api/chat/realtime-config. Subject is supplied by the
    // authenticated test harness, not a room parameter or a request body.
    async config(subject, ttl = 120) {
      const { rows: [membership] } = await pool.query(`SELECT room_id FROM ${schema}.authority_members WHERE subject=$1`, [subject]);
      if (!membership) throw unavailable();
      return locked(membership.room_id, async (tx, room) => {
        const { rowCount } = await tx.query(`SELECT 1 FROM ${schema}.authority_members WHERE subject=$1 AND room_id=$2`, [subject, room.id]);
        if (!rowCount) throw unavailable();
        await checkProjection(room);
        const { rowCount: projected } = await pool.query(`SELECT 1 FROM ${schema}.projection_members WHERE subject=$1 AND room_id=$2 AND epoch=$3`, [subject, room.id, room.epoch]);
        if (!projected) throw unavailable();
        return { chatGroupId: room.id, realtimeEpoch: room.epoch, topic: topicFor(room.id, room.epoch),
          ...signCredential(config.JWT_SECRET, subject, room.id, room.epoch, ttl) };
      });
    },
    // Queue entries carry immutable room+epoch; never trust a cached topic or
    // group code. Hold the authority lock THROUGH the private REST acceptance.
    async publish(roomId, expectedEpoch, marker, afterLock) {
      return locked(roomId, async (tx, room) => {
        if (room.epoch !== expectedEpoch) throw unavailable();
        await checkProjection(room);
        if (afterLock) await afterLock();
        const topic = topicFor(room.id, room.epoch);
        const response = await fetch(`${config.API_URL}/realtime/v1/api/broadcast`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
          headers: { apikey: config.SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ topic, private: true, event: 'trusted', payload: { marker, roomId: room.id, epoch: room.epoch } }] }),
        });
        if (!response.ok) throw new Error(`Trusted private REST broadcast failed (${response.status})`);
        journal.push({ marker, topic, epoch: room.epoch });
      });
    },
    async revokeAndRotate(roomId, revoked, afterLock) {
      return locked(roomId, async (tx, room) => {
        if (afterLock) await afterLock();
        const next = room.epoch + 1;
        // The projection commits separately, as it would in Supabase while the
        // source authority transaction runs in Neon. No distributed transaction
        // is claimed. Old JWTs are pinned to the old epoch.
        const projection = await pool.connect();
        try {
          await projection.query('BEGIN');
          await projection.query(`DELETE FROM ${schema}.projection_members WHERE subject=$1 AND room_id=$2`, [revoked, room.id]);
          await projection.query(`UPDATE ${schema}.projection_rooms SET epoch=$1 WHERE id=$2`, [next, room.id]);
          await projection.query(`UPDATE ${schema}.projection_members SET epoch=$1 WHERE room_id=$2`, [next, room.id]);
          await projection.query('COMMIT');
        } catch (error) { await projection.query('ROLLBACK'); throw error; }
        finally { projection.release(); }
        await tx.query(`DELETE FROM ${schema}.authority_members WHERE subject=$1 AND room_id=$2`, [revoked, room.id]);
        await tx.query(`UPDATE ${schema}.authority_rooms SET epoch=$1 WHERE id=$2`, [next, room.id]);
        return next;
      });
    },
    async close(roomId) {
      return locked(roomId, async (tx, room) => {
        await pool.query(`UPDATE ${schema}.projection_rooms SET status='closed' WHERE id=$1`, [room.id]);
        await tx.query(`UPDATE ${schema}.authority_rooms SET status='closed' WHERE id=$1`, [room.id]);
        // No new epoch is generated for a closed room.
      });
    },
  };
}

async function probeV2(config) {
  config = validateProofConfig(config);
  const startedAt = Date.now();
  if (!config.SERVICE_ROLE_KEY) throw new Error('Local server credential missing');
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `cohort_v2_${suffix}`, readPolicy = `cohort_v2_read_${suffix}`;
  const pool = new Pool({ connectionString: config.DB_URL, connectionTimeoutMillis: 3000, max: 8 });
  const connections = [], journal = [];
  const evidence = { versions: { node: process.version, supabaseJs: require('@supabase/supabase-js/package.json').version }, checks: [], attacks: [], joinDenials: [] };
  const check = (condition, name) => { assert.ok(condition, name); evidence.checks.push(name); };
  const seen = (connection, marker) => connection.broadcasts.some(item => item.payload?.marker === marker);
  const countMarkers = (connection, markers) => connection.broadcasts.filter(item => markers.includes(item.payload?.marker)).length;
  const connect = async (credential, topic = credential.topic, privateChannel = true) => {
    const result = await connectStudent({ apiUrl: config.API_URL, publicKey: config.ANON_KEY, credential: credential.token, topic, privateChannel });
    connections.push(result);
    return result;
  };
  const denied = async (credential, topic, label) => {
    const connection = await connect(credential, topic);
    check(connection.status === 'CHANNEL_ERROR', label);
    evidence.joinDenials.push({ label, status: connection.status });
    return connection;
  };
  const deniedBackend = async (operation, label) => {
    await assert.rejects(operation, { code: 'UNAVAILABLE' }); evidence.checks.push(label);
  };
  const server = createBackend(pool, schema, config, journal);
  try {
    const { rows: [tenant] } = await pool.query("SELECT private_only FROM _realtime.tenants WHERE external_id='realtime-dev'");
    check(tenant?.private_only === true, 'Disposable Realtime tenant is configured private-only');
    const { rows: existing } = await pool.query("SELECT policyname FROM pg_policies WHERE schemaname='realtime' AND tablename='messages'");
    check(existing.length === 0, 'Clean disposable policy set; no permissive policies can mask the proof');
    await pool.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.authority_rooms(id uuid PRIMARY KEY, code text NOT NULL, epoch integer NOT NULL, status text NOT NULL);
      CREATE TABLE ${schema}.authority_members(subject uuid PRIMARY KEY, room_id uuid REFERENCES ${schema}.authority_rooms(id));
      CREATE TABLE ${schema}.projection_rooms(id uuid PRIMARY KEY, epoch integer NOT NULL, status text NOT NULL);
      CREATE TABLE ${schema}.projection_members(subject uuid NOT NULL, room_id uuid REFERENCES ${schema}.projection_rooms(id), epoch integer NOT NULL, PRIMARY KEY(subject,room_id));
      CREATE FUNCTION ${schema}.can_receive(requested_topic text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT EXISTS (SELECT 1 FROM ${schema}.projection_members m JOIN ${schema}.projection_rooms r ON r.id=m.room_id
          WHERE m.subject=auth.uid() AND r.status='active' AND m.epoch=r.epoch
          AND requested_topic='chat:' || r.id::text || ':' || r.epoch::text
          AND auth.jwt()->>'chat_room_id'=r.id::text AND auth.jwt()->>'chat_epoch'=r.epoch::text)
      $$;
      REVOKE ALL ON FUNCTION ${schema}.can_receive(text) FROM PUBLIC;
      GRANT USAGE ON SCHEMA ${schema} TO authenticated;
      GRANT EXECUTE ON FUNCTION ${schema}.can_receive(text) TO authenticated;
      CREATE POLICY ${readPolicy} ON realtime.messages FOR SELECT TO authenticated
        USING (extension='broadcast' AND ${schema}.can_receive(realtime.topic()));
    `);
    // No INSERT policy. No SELECT presence policy. No client table grants.
    const aId = randomUUID(), bId = randomUUID(), cId = randomUUID(), newcomerId = randomUUID();
    const oldRoom = await server.createRoom('MARS', [aId, bId]);
    await server.createRoom('VENUS', [cId]);
    const aConfig1 = await server.config(aId), bConfig1 = await server.config(bId), cConfig = await server.config(cId);
    check(!JSON.stringify(aConfig1).includes(config.SERVICE_ROLE_KEY), 'Student configuration excludes service credential');
    const a1 = await connect(aConfig1), b1 = await connect(bConfig1);
    check(a1.status === 'SUBSCRIBED' && b1.status === 'SUBSCRIBED', 'A and B receive-only private joins succeed');
    const outsider = await denied(cConfig, aConfig1.topic, 'C cannot join another room at epoch 1');
    const publicAttempt = await connect(bConfig1, bConfig1.topic, false);
    check(publicAttempt.status === 'CHANNEL_ERROR', 'Public-channel bypass is denied');
    const initial = randomUUID();
    await server.publish(oldRoom, 1, initial);
    await waitFor(() => seen(a1, initial) && seen(b1, initial), 'initial trusted event delivery');
    check(!seen(outsider, initial), 'Outsider receives no trusted epoch 1 event');

    const attack = async (connection, phase, observers) => {
      const markers = [];
      for (const event of ['new_message', 'typing', 'reaction_update']) {
        const marker = `client-${phase}-${randomUUID()}`;
        markers.push(marker);
        const ack = await connection.channel.send({ type: 'broadcast', event, payload: { marker } }, { timeout: 700 });
        evidence.attacks.push({ phase, action: event, ack });
      }
      const presenceMarker = `presence-${phase}-${randomUUID()}`;
      const ack = await connection.channel.track({ marker: presenceMarker }, { timeout: 700 });
      evidence.attacks.push({ phase, action: 'presence', ack });
      check(ack === 'error', `${phase}: Presence track explicitly rejects publication`);
      // Also attack the REST path using ONLY the student's scoped credential.
      const restMarker = `client-rest-${phase}-${randomUUID()}`;
      markers.push(restMarker);
      const rest = await fetch(`${config.API_URL}/realtime/v1/api/broadcast`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
        headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${connection.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: connection.topic, private: true, event: 'new_message', payload: { marker: restMarker } }] }),
      });
      evidence.attacks.push({ phase, action: 'REST broadcast', status: rest.status });
      await delay(800);
      check(observers.every(observer => countMarkers(observer, markers) === 0), `${phase}: no client Broadcast reaches any observing member`);
      check(observers.every(observer => !JSON.stringify(observer.presence).includes(presenceMarker)), `${phase}: no client Presence reaches any observing member`);
      return markers;
    };
    const clientMarkers = await attack(b1, 'before-revocation', [a1, b1]);
    const control = randomUUID();
    await server.publish(oldRoom, 1, control);
    await waitFor(() => seen(a1, control) && seen(b1, control), 'positive control after denied client writes');

    // A deliberate in-flight publish proves the fencing lock, not just a
    // sequential status check. Rotation cannot overtake REST acceptance.
    const publishHeld = deferred(), releasePublish = deferred(), rotationEntered = deferred();
    const inFlight = randomUUID();
    const publishing = server.publish(oldRoom, 1, inFlight, async () => { publishHeld.resolve(); await releasePublish.promise; });
    await publishHeld.promise;
    let rotated = false;
    const rotating = server.revokeAndRotate(oldRoom, bId, async () => rotationEntered.resolve()).then(epoch => { rotated = true; return epoch; });
    await delay(150);
    check(!rotated, 'Rotation waits for the in-flight publisher lock');
    releasePublish.resolve();
    await publishing;
    check(await rotating === 2, 'Revocation increments epoch exactly once');
    await rotationEntered.promise;
    const rotationJournalIndex = journal.length;
    await deniedBackend(() => server.publish(oldRoom, 1, 'stale-queued-event'), 'Stale queued epoch 1 publication is fenced');
    await deniedBackend(() => server.config(bId), 'Revoked B cannot obtain refreshed configuration');
    await denied(bConfig1, bConfig1.topic, 'Revoked credential cannot rejoin the old epoch');
    const aConfig2 = await server.config(aId), a2 = await connect(aConfig2);
    check(a2.status === 'SUBSCRIBED', 'Remaining A joins epoch 2');
    await denied(aConfig1, aConfig2.topic, 'Even remaining A must refresh an epoch 1 credential for epoch 2');
    for (let attempt = 0; attempt < 3; attempt++) await denied(bConfig1, aConfig2.topic, `Hostile B new epoch attempt ${attempt + 1} denied`);
    await denied(cConfig, aConfig2.topic, 'C cannot join epoch 2');
    check(b1.channel.state === 'joined' && b1.client.realtime.isConnected(), 'Hostile B keeps its old WebSocket and subscription alive');
    clientMarkers.push(...await attack(b1, 'after-rotation', [a1, b1, a2]));
    const epoch2Markers = [randomUUID(), randomUUID(), randomUUID()];
    for (const marker of epoch2Markers) await server.publish(oldRoom, 2, marker);
    await waitFor(() => epoch2Markers.every(marker => seen(a2, marker)), 'trusted epoch 2 events');
    await delay(800);
    check(countMarkers(b1, epoch2Markers) === 0 && countMarkers(a1, epoch2Markers) === 0, 'Retired epoch 1 receives zero post-rotation events');

    // Natural expiration: valid before waiting, denied on a fresh join afterward.
    const short = await server.config(aId, 2), shortConnection = await connect(short);
    check(shortConnection.status === 'SUBSCRIBED', 'Short-lived credential works before expiry');
    await delay(Math.max(0, short.expiry * 1000 - Date.now() + 1200));
    await denied(short, short.topic, 'Expired credential cannot authorize a new join');
    check(b1.channel.state === 'joined', 'Isolation was achieved while hostile B still held an unexpired old connection');

    const closureHeld = deferred(), releaseClosureRace = deferred();
    const preclose = randomUUID();
    const closingPublish = server.publish(oldRoom, 2, preclose, async () => { closureHeld.resolve(); await releaseClosureRace.promise; });
    await closureHeld.promise;
    let closed = false;
    const closing = server.close(oldRoom).then(() => { closed = true; });
    await delay(150);
    check(!closed, 'Closure waits for the in-flight publisher lock');
    releaseClosureRace.resolve();
    await closingPublish;
    await closing;
    await waitFor(() => seen(a2, preclose), 'delivery of explicitly pre-close event');
    const closeJournalIndex = journal.length;
    const afterCloseMarkers = [randomUUID(), randomUUID()];
    for (const marker of afterCloseMarkers) await deniedBackend(() => server.publish(oldRoom, 2, marker), 'Closed room blocks server publication');
    await deniedBackend(() => server.config(aId), 'Closed room blocks token/topic configuration');
    await denied(aConfig2, aConfig2.topic, 'Closed room rejects new join with otherwise unexpired credential');
    clientMarkers.push(...await attack(b1, 'after-closure-old-epoch', [a1, b1, a2]));
    clientMarkers.push(...await attack(a2, 'after-closure-latest-epoch', [a1, b1, a2]));
    const { rows: [closedRoom] } = await pool.query(`SELECT * FROM ${schema}.authority_rooms WHERE id=$1`, [oldRoom]);
    check(closedRoom.status === 'closed' && closedRoom.epoch === 2, 'Closure creates no further epoch');

    const newRoom = await server.createRoom('MARS', [newcomerId]);
    check(newRoom !== oldRoom, 'Reused MARS code receives a different immutable room UUID');
    const newConfig = await server.config(newcomerId), newcomer = await connect(newConfig);
    check(newConfig.topic !== bConfig1.topic && newConfig.realtimeEpoch === 1 && newcomer.status === 'SUBSCRIBED', 'New MARS starts on its own epoch 1 topic');
    await denied(bConfig1, newConfig.topic, 'Old MARS member cannot join replacement MARS');
    const newBatchMarkers = [randomUUID(), randomUUID(), randomUUID()];
    for (const marker of newBatchMarkers) await server.publish(newRoom, 1, marker);
    await waitFor(() => newBatchMarkers.every(marker => seen(newcomer, marker)), 'new MARS delivery');
    clientMarkers.push(...await attack(b1, 'after-code-reuse', [a1, b1, a2, newcomer]));
    const lastControl = randomUUID();
    await server.publish(newRoom, 1, lastControl);
    await waitFor(() => seen(newcomer, lastControl), 'final new-room positive control');
    newBatchMarkers.push(lastControl);
    await delay(1000);
    check([a1, b1, a2].every(connection => countMarkers(connection, newBatchMarkers) === 0), 'Old clients receive zero replacement-cohort events');
    check(connections.every(connection => countMarkers(connection, clientMarkers) === 0), 'No client-originated Broadcast was delivered anywhere in the probe');
    check(connections.every(connection => countMarkers(connection, afterCloseMarkers) === 0), 'No attempted post-close server event was delivered');
    check(journal.slice(rotationJournalIndex).every(entry => entry.topic !== bConfig1.topic), 'Trusted publisher permanently retires old epoch topic');
    check(journal.slice(closeJournalIndex).every(entry => !entry.topic.startsWith(`chat:${oldRoom}:`)), 'Trusted publisher permanently retires all closed-room topics');
    check(b1.channel.state === 'joined' && b1.client.realtime.isConnected(), 'Hostile old socket remained connected through code reuse');
    check(Date.now() < bConfig1.expiry * 1000, 'Hostile credential is still unexpired at the end of the isolation proof');
    evidence.durationMs = Date.now() - startedAt;
    evidence.counts = {
      revokedOldTopicNewEvents: countMarkers(b1, epoch2Markers),
      oldMembersReplacementEvents: [a1, b1, a2].reduce((n, connection) => n + countMarkers(connection, newBatchMarkers), 0),
      clientOriginatedEvents: connections.reduce((n, connection) => n + countMarkers(connection, clientMarkers), 0),
      trustedEventsPublished: journal.length,
    };
    evidence.gate = {
      AUTHORIZED_RECEIVE: 'PASS', OUTSIDER_JOIN: 'DENIED', CLIENT_BROADCAST_WRITE: 'DENIED', CLIENT_PRESENCE_WRITE: 'DENIED',
      SERVER_PRIVATE_BROADCAST: 'PASS', EPOCH_ROTATION: 'PASS', REVOKED_OLD_TOPIC_RECEIVES_NEW_EVENTS: evidence.counts.revokedOldTopicNewEvents,
      REVOKED_NEW_EPOCH_JOIN: 'DENIED', ROOM_CLOSE_FENCING: 'PASS', GROUP_CODE_REUSE_ISOLATION: 'PASS',
      HOSTILE_CONNECTED_CLIENT: 'CONTAINED', REALTIME_SECURITY_MODEL: 'PROVEN', SAFE_TO_RESUME_COHORT_IMPLEMENTATION: 'YES',
    };
    return evidence;
  } catch (error) {
    error.evidence = evidence;
    throw error;
  } finally {
    await Promise.allSettled(connections.map(connection => connection.client.removeAllChannels()));
    await Promise.allSettled(connections.map(connection => connection.client.realtime.disconnect()));
    try {
      await pool.query(`DROP POLICY IF EXISTS ${readPolicy} ON realtime.messages; DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    } finally { await pool.end(); }
  }
}

if (require.main === module) {
  if (process.argv.length !== 4 || process.argv[2] !== '--disposable-local-supabase') {
    console.error('Usage: node scripts/probe-cohort-realtime-v2.cjs --disposable-local-supabase /path/to/local-status.json');
    process.exitCode = 1;
  } else {
    // probeV2 has already awaited its finally cleanup when it settles. Flush
    // stdout before exiting: rejected-channel retry timers in the SDK must not
    // keep this disposable CLI alive indefinitely after results are written.
    const finish = (result, code) => process.stdout.write(JSON.stringify(result, null, 2) + '\n', () => process.exit(code));
    Promise.resolve().then(() => probeV2(localConfig(process.argv[3]))).then(result => finish(result, 0)).catch(error => {
      finish({ ...(error.evidence || {}), error: error.message,
        gate: { REALTIME_SECURITY_MODEL: 'NOT_PROVEN', SAFE_TO_RESUME_COHORT_IMPLEMENTATION: 'NO' } }, 1);
    });
  }
}

module.exports = { validateProofConfig, signCredential, topicFor, createBackend, connectStudent, probeV2 };
