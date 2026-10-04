'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateCohortChat } = require('../migrations/002-cohort-chat');
const { createCohortChat } = require('../lib/cohort-chat');
const { createEventConsumer } = require('../lib/chat-event-dedupe');
const push = require('../lib/push-notifications');
const unavailable = { status: 404 };
const upload = () => ({ buffer: Buffer.from('private attachment'), mimetype: 'text/plain', originalname: 'notes.txt' });
const send = (f, id, extra = {}, file) => f.service.send(id, { clientId: randomUUID(), text: 'room message', ...extra }, file);
const count = async (db, table, where = '', args = []) => Number((await db.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`, ...args)).n);
const stateTables = ['chat_messages','chat_message_mentions','chat_reactions','file_blobs','chat_room_read_receipts','chat_room_typing',
  'chat_pinned_announcements','chat_online_sessions','push_notification_outbox','chat_realtime_outbox','chat_attachment_ownership','chat_send_keys'];
async function snapshot(db) {
  const result = {};
  for (const table of stateTables) result[table] = JSON.stringify(await db.all(`SELECT * FROM ${table} ORDER BY 1`));
  return result;
}
async function http(t, f) {
  const express = require('express'), app = express();
  app.use(express.json());
  // Only authentication is a fixture. Real HTTP, multipart, router, service,
  // schema and DB transactions run beneath it; request body never sets identity.
  app.use('/api/chat', async (req, res, next) => {
    const match = /^Bearer fixture-([a-z0-9]+)(?:-device2)?$/.exec(req.get('authorization') || '');
    if (!match || !await f.db.get('SELECT studentId FROM students WHERE studentId=?', match[1])) return res.sendStatus(401);
    req.student = { studentId: match[1] }; next();
  }, require('../routes/cohort-chat')(f.service));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (method, path, body, student = 'm1') => {
    const headers = student ? { authorization: `Bearer fixture-${student}` } : {};
    if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat${path}`, { method, headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  };
}

// Both engines run the same functional suite. PostgreSQL is mandatory when
// COHORT_TEST_POSTGRES=1; a missing server is a failure, never a skipped test.
const engines = process.env.COHORT_TEST_POSTGRES === '1' ? ['sqlite','postgres'] : ['sqlite'];
for (const engine of engines) {
  test(`${engine}: additive migration, rollback, legacy quarantine and stable cohort assignment`, async t => {
    const f = await fixture(engine, { migrate: false }); t.after(f.close);
    await assert.rejects(migrateCohortChat(f.db), /disposable/);
    let injected = false;
    const broken = { withTransaction: fn => f.db.withTransaction(tx => fn({ ...tx, run: async (...args) => {
      if (args[0].startsWith('INSERT INTO chat_group_slots') && !injected) { injected = true; throw new Error('migration rollback'); }
      return tx.run(...args);
    } })) };
    await assert.rejects(migrateCohortChat(broken, { disposable: true }), /migration rollback/);
    assert.equal((await migrateCohortChat(f.db, { disposable: true })).applied, true);
    assert.deepEqual(await migrateCohortChat(f.db, { disposable: true }), { applied: false });
    assert.equal(await count(f.db, 'chat_groups', "WHERE kind='legacy' AND status='quarantined'"), 1);
    assert.equal((await f.db.get('SELECT chat_group_id FROM chat_messages WHERE id=?', f.legacyId)).chat_group_id, null);
    const rooms = await f.seed();
    for (const [code, semester, student] of [['MERCURY',1,'m1'],['VENUS',3,'v1'],['EARTH',5,'e1'],['MARS',7,'s1']]) {
      const ctx = await f.service.getAuthenticatedChatContext(student);
      assert.equal(ctx.groupCode, code); assert.equal(ctx.currentSemester, semester); assert.equal(ctx.chatGroupId, rooms[code].chatGroupId);
    }
    await assert.rejects(f.service.createCohort('m1', {}), { status: 403 });
    await assert.rejects(f.service.createCohort('admin', { groupCode: 'MARS', intakeYear: 2026 }), { status: 409 });
    for (const id of ['none','outsider','missing']) await assert.rejects(f.service.history(id), unavailable);
    await assert.rejects(f.service.graduate('admin', rooms.MERCURY.chatGroupId), { status: 409 });
    const advanced = await f.service.advance('admin', rooms.MARS.chatGroupId, 1);
    assert.equal(advanced.currentSemester, 8); assert.equal(advanced.cohortId, rooms.MARS.cohortId);
    assert.equal(advanced.chatGroupId, rooms.MARS.chatGroupId);
    await assert.rejects(f.service.advance('admin', rooms.MARS.chatGroupId, 1), { status: 409 });
    await assert.rejects(f.db.run("UPDATE cohorts SET group_code='PLUTO' WHERE id=?", rooms.MARS.cohortId));
    await assert.rejects(f.db.run('UPDATE cohorts SET current_semester=9 WHERE id=?', rooms.MARS.cohortId));
    await f.service.graduate('admin', rooms.MARS.chatGroupId);
    await assert.rejects(f.service.history('s1'), unavailable);
    assert.equal((await f.db.get('SELECT cohort_id FROM students WHERE studentId=?', 's1')).cohort_id, rooms.MARS.cohortId);
  });

  test(`${engine}: HTTP IDOR matrix, all history modes, attachments and zero side effects`, async t => {
    const f = await fixture(engine); t.after(f.close); const rooms = await f.seed(); const request = await http(t, f);
    const mercury = await send(f, 'm1', { text: 'Mercury searchable' }, upload());
    const venus = await send(f, 'v1', { text: 'Venus private' }, upload());
    const mid = mercury.messageId, vid = venus.messageId, own = rooms.MERCURY.chatGroupId, foreign = rooms.VENUS.chatGroupId;
    await send(f, 'm2', { replyToId: mid });
    for (const path of ['/messages',`/messages?before=${vid + 20}`,`/messages?since=1&recent=20`, '/search?q=private']) {
      const result = await request('GET', path); assert.equal(result.status, 200, path);
      for (const message of [...result.body.messages, ...result.body.recentMessages]) assert.equal(message.chatGroupId, own);
      assert.ok(!result.body.messages.some(m => m.id === f.legacyId || m.id === vid));
    }
    assert.equal((await request('GET', `/groups/${own}/messages/${mid}`)).body.id, mid);
    const file = await request('GET', `/attachment/${mercury.data.attachmentName}`);
    assert.equal(file.status, 200); assert.equal(file.body, 'private attachment'); assert.equal(file.headers.get('cache-control'), 'private, no-store');
    const baseline = await snapshot(f.db);
    const cases = [
      ['GET',`/messages?chatGroupId=${foreign}`], ['GET','/messages?groupCode=VENUS'],
      ['GET',`/groups/${foreign}/messages/${vid}`], ['GET',`/groups/${own}/messages/${vid}`],
      ['GET',`/groups/${own}/messages/9999999`], ['GET',`/groups/${randomUUID()}/messages/${mid}`],
      ['POST','/messages',{ clientId: 'reply-idor', text: 'bad', replyToId: vid }],
      ['POST','/reactions',{ messageId: vid, emoji: '👍' }], ['POST',`/pinned/${vid}`,{}],
      ['DELETE',`/messages/${vid}`], ['GET',`/attachment/${venus.data.attachmentName}`],
      ['GET','/attachment/nonexistent'], ['POST','/read',{ lastReadMessageId: vid }],
      ['DELETE',`/pinned?chatGroupId=${foreign}`], ['POST','/typing',{ chatGroupId: foreign }],
      ['POST','/heartbeat',{ chatGroupId: foreign }], ['GET',`/members?chat_group_id=${foreign}`],
      ['GET',`/mentions/students?chatGroupId=${foreign}`], ['GET',`/realtime-config?chatGroupId=${foreign}`],
      ['POST',`/messages?chatGroupId=${foreign}`,{ clientId: 'conflict', text: 'bad', chatGroupId: own }],
    ];
    for (const [method, path, body] of cases) {
      const result = await request(method, path, body);
      assert.equal(result.status, 404, `${method} ${path}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.message, 'This conversation is no longer available.');
      assert.deepEqual(await snapshot(f.db), baseline, `${method} ${path} changed state`);
    }
    const multipart = new FormData();
    multipart.set('text', 'bad mention'); multipart.set('clientId', 'mention-idor'); multipart.set('mentions', '["v1"]');
    multipart.set('attachment', new Blob(['must never persist'], { type: 'text/plain' }), 'bad.txt');
    assert.equal((await request('POST','/messages',multipart)).status, 400);
    assert.deepEqual(await snapshot(f.db), baseline);
    assert.deepEqual((await request('GET','/mentions/students')).body.map(m => m.studentId), ['m2']);
    assert.equal((await request('GET','/messages',undefined,null)).status, 401);
    assert.equal((await request('GET','/messages',undefined,'none')).status, 404);
    assert.equal((await request('POST',`/admin/groups/${own}/graduate`,{})).status, 403);
    assert.equal((await request('GET','/unknown-legacy-route')).status, 404);
    const validUpload = new FormData(); validUpload.set('clientId','http-file'); validUpload.set('mentions','["m2"]');
    validUpload.set('attachment',new Blob(['good']), 'good.txt');
    const uploaded = await request('POST','/messages',validUpload);
    assert.equal(uploaded.status,200); assert.deepEqual(uploaded.body.data.mentions,['m2']);
    assert.equal((await request('POST',`/pinned/${mid}`,{})).status,200);
    assert.equal((await request('GET','/pinned')).body.pinned.id,mid);
    assert.equal((await request('DELETE','/pinned')).status,200);
    assert.equal((await request('DELETE',`/messages/${mid}`)).status,200);
    assert.equal((await request('GET',`/attachment/${mercury.data.attachmentName}`)).status,404);
    await assert.rejects(f.service.send('m1',{clientId:mercury.data.clientId,text:'resurrection'}),unavailable);
    assert.equal(await count(f.db,'chat_realtime_outbox',"WHERE parent_message_id=? AND status='pending'",[mid]),0);
  });

  test(`${engine}: durable concurrent sends, mentions, rollback and push delivery privacy`, async t => {
    const f = await fixture(engine); t.after(f.close); const rooms = await f.seed();
    const results = await Promise.all(Array.from({ length: 5 }, () => send(f,'m1',{ clientId:'same',mentions:['m2'] },upload())));
    assert.equal(new Set(results.map(r => r.messageId)).size,1); assert.equal(results.filter(r => !r.duplicate).length,1);
    assert.equal(await count(f.db,'chat_realtime_outbox'),1); assert.equal(await count(f.db,'file_blobs'),1);
    assert.equal(await count(f.db,'chat_message_mentions'),1); assert.equal(await count(f.db,'push_notification_outbox'),1);
    const restarted = createCohortChat(f.db, f.providers);
    assert.equal((await restarted.send('m1',{clientId:'same',text:'retry'})).messageId, results[0].messageId);
    assert.notEqual((await send(f,'m2',{clientId:'same'})).messageId,results[0].messageId);
    assert.notEqual((await send(f,'v1',{clientId:'same'})).messageId,results[0].messageId);
    const baseline = await snapshot(f.db);
    f.providers.testPoint = async point => { if (point === 'send-before-commit') throw new Error('transaction rollback'); };
    await assert.rejects(send(f,'m1',{mentions:['m2']},upload()),/transaction rollback/);
    assert.deepEqual(await snapshot(f.db),baseline); f.providers.testPoint = undefined;
    await f.db.run("INSERT INTO student_device_tokens(student_id,expo_push_token,platform) VALUES ('m2','ExpoPushToken[second-device]','ios') RETURNING student_id");
    await f.db.run('INSERT INTO student_notification_preferences(student_id,hide_lockscreen_preview) VALUES (?,?) RETURNING student_id','m2',f.db.isPostgres ? true : 1);
    const job = await f.db.get('SELECT * FROM push_notification_outbox WHERE chat_group_id=? AND event_id=?',rooms.MERCURY.chatGroupId,String(results[0].messageId));
    const payload = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : job.payload_json;
    assert.equal(payload.data.chatGroupId,rooms.MERCURY.chatGroupId); assert.ok(job.idempotency_key.includes(rooms.MERCURY.chatGroupId));
    assert.equal((await push.processPushOutbox(f.db,{sendBatch:f.providers.push.sendBatch})).processed,0);
    assert.equal((await f.service.deliverPush(job.id)).sent,1);
    assert.equal(f.pushes.length,2); assert.ok(f.pushes.every(p => p.body === 'New message' && p.data.chatGroupId === rooms.MERCURY.chatGroupId));
    assert.equal(await count(f.db,'push_receipt_tickets'),2);
    await f.service.deliverPush(job.id); assert.equal(f.pushes.length,2);
    const muted = await send(f,'m1');
    await f.db.run('UPDATE student_notification_preferences SET mute_chat=? WHERE student_id=?',f.db.isPostgres ? true : 1,'m2');
    const mutedJob = await f.db.get('SELECT id FROM push_notification_outbox WHERE event_id=?',String(muted.messageId));
    assert.equal((await f.service.deliverPush(mutedJob.id)).skipped,1); assert.equal(f.pushes.length,2);
    await f.service.rotate('admin',rooms.MERCURY.chatGroupId,'m1');
    await assert.rejects(restarted.send('m1',{clientId:'same',text:'retry'}),unavailable);
  });

  test(`${engine}: fail-closed projection/config, ambiguous broadcast and persistent event dedupe`, async t => {
    const f = await fixture(engine); t.after(f.close); const rooms = await f.seed(); const room = rooms.MERCURY.chatGroupId;
    const request = await http(t,f);
    await send(f,'m1'); const event = await f.db.get('SELECT * FROM chat_realtime_outbox');
    assert.equal((await request('GET','/realtime-config')).status,503);
    assert.equal((await f.service.publishRealtime(event.id)).status,'projection_blocked');
    f.providers.projection.sync = async () => { throw new Error('offline'); };
    assert.deepEqual(await f.service.syncProjection(room),{ready:false});
    assert.equal((await request('GET','/realtime-config')).status,503);
    for (const override of [{realtimeEpoch:99},{members:[]}]) {
      f.providers.projection.sync = async s => ({...s,...override});
      assert.equal((await f.service.syncProjection(room)).ready,false);
      assert.equal((await f.service.publishRealtime(event.id)).status,'projection_blocked');
    }
    f.providers.projection.sync = async s => s;
    assert.equal((await f.service.syncProjection(room)).ready,true);
    const config = await request('GET','/realtime-config'); assert.equal(config.status,200);
    assert.equal(config.headers.get('cache-control'),'private, no-store'); assert.equal(config.body.topic,`chat:${room}:1`);
    assert.deepEqual(Object.keys(config.body).sort(),['chatGroupId','expiry','realtimeEpoch','token','topic']);
    f.providers.testPoint = async point => { if (point === 'projection-before-ready') throw new Error('projection SQL transaction failed'); };
    await assert.rejects(f.service.syncProjection(room),/projection SQL transaction failed/);
    assert.equal((await request('GET','/realtime-config')).status,503);
    assert.equal((await f.service.publishRealtime(event.id)).status,'projection_blocked');
    f.providers.testPoint = undefined; await f.service.syncProjection(room);
    let attempts = 0;
    f.providers.realtime.send = async value => { f.broadcasts.push(value); if (++attempts === 1) throw new Error('accepted then response lost'); };
    assert.equal((await f.service.publishRealtime(event.id)).status,'retry');
    f.tick(2000);
    assert.equal((await f.service.publishRealtime(event.id)).status,'sent');
    assert.equal(f.broadcasts.length,2); assert.equal(f.broadcasts[0].payload.eventId,f.broadcasts[1].payload.eventId);
    let applied = 0;
    const consumerOptions = { has: id => f.db.get('SELECT id FROM fixture_client_events WHERE id=?',id),
      applyAndRemember: e => f.db.withTransaction(async tx => { await tx.run('INSERT INTO fixture_client_events(id) VALUES (?) RETURNING id',e.eventId); applied++; }) };
    const consume = createEventConsumer(consumerOptions);
    assert.deepEqual(await Promise.all(f.broadcasts.map(e => consume(e.payload))),[true,false]);
    assert.equal(await createEventConsumer(consumerOptions)(f.broadcasts[0].payload),false); assert.equal(applied,1);
    const oldTopic = config.body.topic;
    await f.service.rotate('admin',room,'m2');
    assert.equal((await request('GET','/realtime-config')).status,503);
    await f.service.syncProjection(room);
    assert.notEqual((await request('GET','/realtime-config')).body.topic,oldTopic);
    assert.equal((await request('GET','/realtime-config',undefined,'m2')).status,404);
    assert.equal(f.broadcasts.length,2);
  });

  test(`${engine}: database typing coalescing, heartbeat device dedupe and TTL`, async t => {
    const f = await fixture(engine); t.after(f.close); const rooms = await f.seed(); const request = await http(t,f);
    assert.deepEqual(await f.service.typing('m1'),{coalesced:false});
    assert.deepEqual(await createCohortChat(f.db,f.providers).typing('m1'),{coalesced:true});
    const typingEvent = await f.db.get("SELECT id FROM chat_realtime_outbox WHERE event_type='typing'");
    assert.equal((await request('POST','/heartbeat',{studentId:'v1',sessionId:'spoof'})).body.total,1);
    assert.equal((await request('POST','/heartbeat',{},'m1-device2')).body.total,1);
    assert.equal((await request('POST','/heartbeat',{},'m2')).body.total,2);
    assert.equal(await count(f.db,'chat_online_sessions'),3);
    const before = await count(f.db,'chat_realtime_outbox');
    await request('POST','/heartbeat',{}); assert.equal(await count(f.db,'chat_realtime_outbox'),before);
    assert.equal((await f.service.history('v1')).typing.length,0);
    f.tick(76000);
    assert.equal((await f.service.history('m1')).typing.length,0);
    assert.equal((await f.service.publishRealtime(typingEvent.id)).status,'cancelled');
    assert.equal((await request('POST','/heartbeat',{})).body.total,1);
    assert.equal(await count(f.db,'chat_online_sessions','WHERE chat_group_id=?',[rooms.MERCURY.chatGroupId]),1);
  });

  test(`${engine}: Mars recycle erases owned data, preserves shared/legacy, retries and allocates once`, async t => {
    const f = await fixture(engine); t.after(f.close); const rooms = await f.seed(); const old = rooms.MARS.chatGroupId;
    await f.service.advance('admin',old,1);
    const msg = await send(f,'s1',{mentions:['s2']},upload());
    const orphan = await send(f,'s1',{},upload()); await f.service.remove('s1',{},orphan.messageId);
    const shared = await send(f,'s1',{},upload()); f.shared.add(shared.data.attachmentName);
    await f.service.reaction('s2',{messageId:msg.messageId,emoji:'👍'});
    await f.service.read('s2',{lastReadMessageId:msg.messageId}); await f.service.typing('s1');
    await f.service.pin('s1',{},msg.messageId); await f.service.heartbeat('s1',{},'device');
    await f.service.syncProjection(old);
    const event = await f.db.get("SELECT id FROM chat_realtime_outbox WHERE chat_group_id=? AND status='pending'",old);
    const job = await f.db.get('SELECT id FROM push_notification_outbox WHERE event_id=?',String(msg.messageId));
    f.providers.realtime.send = async () => { throw new Error('retry'); };
    assert.equal((await f.service.publishRealtime(event.id)).status,'retry');
    f.providers.push.sendBatch = async () => ({tickets:[],status:503,error:'offline'});
    await f.service.deliverPush(job.id);
    await f.service.graduate('admin',old);
    const baseline = await snapshot(f.db);
    f.providers.testPoint = async p => { if (p === 'recycle-before-commit') throw new Error('rollback recycle'); };
    const input = {requestKey:'mars-2027',intakeYear:2027,studentIds:['new1','new2']};
    await assert.rejects(f.service.beginRecycle('admin',old,input),/rollback recycle/);
    assert.deepEqual(await snapshot(f.db),baseline); f.providers.testPoint = undefined;
    const jobs = await Promise.all([f.service.beginRecycle('admin',old,input),f.service.beginRecycle('admin',old,input)]);
    assert.equal(jobs[0].id,jobs[1].id); assert.equal(await count(f.db,'chat_recycle_jobs'),1);
    await assert.rejects(f.service.history('s1'),unavailable);
    await assert.rejects(f.service.attachment('s1',{},msg.data.attachmentName),unavailable);
    f.providers.attachments.eraseExternal = async () => { throw new Error('external erasure offline'); };
    await assert.rejects(f.service.finishRecycle('admin',jobs[0].id),/external erasure offline/);
    assert.equal((await f.db.get('SELECT status FROM chat_groups WHERE id=?',old)).status,'recycling');
    assert.equal((await f.db.get("SELECT current_chat_group_id FROM chat_group_slots WHERE group_code='MARS'")).current_chat_group_id,old);
    await assert.rejects(f.service.history('new1'),unavailable);
    f.providers.attachments.eraseExternal = async name => { f.erased.push(name); };
    const replacements = await Promise.all([f.service.finishRecycle('admin',jobs[0].id),f.service.finishRecycle('admin',jobs[0].id)]);
    assert.equal(replacements[0].chatGroupId,replacements[1].chatGroupId); const fresh = replacements[0].chatGroupId;
    assert.notEqual(fresh,old); assert.equal((await f.service.getAuthenticatedChatContext('new1')).groupCode,'MARS');
    assert.equal((await f.db.get('SELECT status FROM chat_groups WHERE id=?',old)).status,'recycled');
    for (const table of ['chat_messages','chat_room_read_receipts','chat_room_typing','chat_pinned_announcements','chat_online_sessions','chat_realtime_outbox','push_notification_outbox']) {
      assert.equal(await count(f.db,table,'WHERE chat_group_id IN (?,?)',[old,fresh]),0,table);
    }
    assert.equal(await count(f.db,'chat_reactions'),0); assert.equal(await count(f.db,'chat_message_mentions'),0);
    assert.equal(await count(f.db,'file_blobs'),1); assert.ok(f.erased.includes(orphan.data.attachmentName));
    assert.ok(!f.erased.includes(shared.data.attachmentName));
    assert.equal((await f.db.get('SELECT text,chat_group_id FROM chat_messages WHERE id=?',f.legacyId)).text,'legacy quarantine sentinel');
    assert.equal((await f.service.publishRealtime(event.id)).status,'missing');
    assert.equal((await f.service.deliverPush(job.id)).status,'missing');
    await f.service.syncProjection(fresh); const config = await f.service.realtimeConfig('new1');
    assert.equal(config.topic,`chat:${fresh}:1`); assert.ok(!config.topic.includes(old));
    assert.equal(f.broadcasts.length,0); assert.equal(f.pushes.length,0);
  });
}
