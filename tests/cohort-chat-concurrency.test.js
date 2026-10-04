'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { fixture } = require('./helpers/cohort-fixture');
const { createCohortChat } = require('../lib/cohort-chat');

// This suite intentionally has no SQLite surrogate and no skip-on-error path.
// Enable with COHORT_TEST_POSTGRES=1 against the documented disposable server.
if (process.env.COHORT_TEST_POSTGRES === '1') {
  function gate() {
    let entered, release;
    const arrived = new Promise(resolve => { entered = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    return { arrived, release, hold: async () => { entered(); await released; } };
  }
  async function blocked(db) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const row = await db.get(`SELECT pid FROM pg_stat_activity WHERE application_name=current_setting('application_name')
        AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%FOR UPDATE%' LIMIT 1`);
      if (row) return;
      await delay(10);
    }
    assert.fail('No PostgreSQL row-lock wait observed');
  }
  async function mars(t) {
    const f = await fixture('postgres'); t.after(f.close); const rooms = await f.seed();
    const room = rooms.MARS.chatGroupId; await f.service.advance('admin',room,1);
    // Different service instance; synchronization comes from pooled DB clients.
    const other = createCohortChat(f.db,f.providers);
    return { ...f, room, other };
  }
  for (const operation of ['send','reaction','mention','attachment']) {
    for (const winner of ['mutation','close']) {
      test(`postgres race: ${operation} vs close (${winner} acquires fence first)`, { timeout: 15000 }, async t => {
        const f = await mars(t);
        const first = await f.service.send('s1',{clientId:'first',text:'parent'});
        const mutate = () => operation === 'reaction'
          ? f.service.reaction('s2',{messageId:first.messageId,emoji:'👍'})
          : f.service.send('s1',{clientId:'racing',text:'mutation',mentions:operation === 'mention' ? ['s2'] : []},
            operation === 'attachment' ? {buffer:Buffer.from('racing file'),originalname:'file.txt',mimetype:'text/plain'} : null);
        const g = gate(); t.after(g.release);
        const holdAt = winner === 'close' ? 'graduate-before-commit' : operation === 'reaction' ? 'reaction-before-write' : 'send-before-commit';
        f.providers.testPoint = async point => { if (point === holdAt) await g.hold(); };
        const leading = winner === 'close' ? f.other.graduate('admin',f.room) : mutate();
        await g.arrived;
        const trailing = (winner === 'close' ? mutate() : f.other.graduate('admin',f.room)).then(value => ({value}),error => ({error}));
        await blocked(f.db); g.release(); await leading;
        const result = await trailing;
        if (winner === 'close') assert.equal(result.error?.status,404); else assert.ok(result.value);
        const messages = await f.db.all('SELECT id FROM chat_messages WHERE chat_group_id=?',f.room);
        assert.equal(messages.length,winner === 'mutation' && operation !== 'reaction' ? 2 : 1);
        assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM file_blobs')).n),winner === 'mutation' && operation === 'attachment' ? 1 : 0);
        assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM chat_message_mentions')).n),winner === 'mutation' && operation === 'mention' ? 1 : 0);
        assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM chat_reactions')).n),winner === 'mutation' && operation === 'reaction' ? 1 : 0);
        assert.equal(Number((await f.db.get("SELECT COUNT(*) AS n FROM chat_realtime_outbox WHERE status<>'cancelled'")).n),0);
        await assert.rejects(mutate(),{status:404});
      });
    }
  }
  for (const lifecycle of ['rotate','graduate']) {
    for (const winner of ['publisher','lifecycle']) {
      test(`postgres race: realtime publisher vs ${lifecycle} (${winner} acquires fence first)`, {timeout:15000}, async t => {
        const f = await mars(t); await f.service.syncProjection(f.room);
        await f.service.send('s1',{clientId:'publication',text:'private'});
        const event = await f.db.get('SELECT id FROM chat_realtime_outbox WHERE chat_group_id=?',f.room);
        const g = gate(); t.after(g.release); const order = [];
        if (winner === 'publisher') f.providers.realtime.send = async value => { await g.hold(); f.broadcasts.push(value); order.push('accepted'); };
        else f.providers.testPoint = async p => { if (p === `${lifecycle === 'graduate' ? 'graduate' : 'rotate'}-before-commit`) await g.hold(); };
        const change = () => f.other[lifecycle]('admin',f.room).then(value => { order.push('fenced'); return value; });
        const leading = winner === 'publisher' ? f.service.publishRealtime(event.id) : change();
        await g.arrived;
        const trailing = winner === 'publisher' ? change() : f.service.publishRealtime(event.id);
        await blocked(f.db); g.release(); await Promise.all([leading,trailing]);
        assert.deepEqual(order,winner === 'publisher' ? ['accepted','fenced'] : ['fenced']);
        assert.equal(f.broadcasts.length,winner === 'publisher' ? 1 : 0);
        await f.service.publishRealtime(event.id);
        assert.equal(f.broadcasts.length,winner === 'publisher' ? 1 : 0);
        if (f.broadcasts.length) assert.equal(f.broadcasts[0].topic,`chat:${f.room}:1`);
      });
    }
  }
  test('postgres race: competing realtime workers claim one durable event', {timeout:15000}, async t => {
    const f = await mars(t); await f.service.syncProjection(f.room);
    await f.service.send('s1',{clientId:'worker',text:'once'});
    const event = await f.db.get('SELECT id FROM chat_realtime_outbox WHERE chat_group_id=?',f.room);
    const g = gate(); t.after(g.release);
    f.providers.realtime.send = async value => { await g.hold(); f.broadcasts.push(value); };
    const first = f.service.publishRealtime(event.id); await g.arrived;
    const second = f.other.publishRealtime(event.id); await blocked(f.db); g.release();
    await Promise.all([first,second]); assert.equal(f.broadcasts.length,1);
    assert.equal((await f.db.get('SELECT attempts FROM chat_realtime_outbox WHERE id=?',event.id)).attempts,1);
  });
  test('postgres race: retry workers cannot cross recycle; concurrent duplicate recycle allocates once', {timeout:15000}, async t => {
    const f = await mars(t); await f.service.syncProjection(f.room);
    const sent = await f.service.send('s1',{clientId:'retired',text:'old'});
    const event = await f.db.get('SELECT id FROM chat_realtime_outbox WHERE chat_group_id=?',f.room);
    const push = await f.db.get('SELECT id FROM push_notification_outbox WHERE event_id=?',String(sent.messageId));
    await f.service.graduate('admin',f.room);
    // Simulate stale pending work recovered after closure (the usual rows were
    // already cancelled). Workers must revalidate the room, not trust status.
    await f.db.run("UPDATE chat_realtime_outbox SET status='retry' WHERE id=?",event.id);
    await f.db.run("UPDATE push_notification_outbox SET status='pending' WHERE id=?",push.id);
    const g = gate(); t.after(g.release);
    f.providers.testPoint = async p => { if (p === 'recycle-before-commit') await g.hold(); };
    const input = {requestKey:'race',intakeYear:2027,studentIds:['new1']};
    const first = f.service.beginRecycle('admin',f.room,input); await g.arrived;
    const waits = [f.other.beginRecycle('admin',f.room,input),f.other.publishRealtime(event.id),f.other.deliverPush(push.id)];
    await blocked(f.db); g.release(); const job = await first; await Promise.all(waits);
    const results = await Promise.all([f.service.finishRecycle('admin',job.id),f.other.finishRecycle('admin',job.id)]);
    assert.equal(results[0].chatGroupId,results[1].chatGroupId); assert.notEqual(results[0].chatGroupId,f.room);
    assert.equal(f.broadcasts.length,0); assert.equal(f.pushes.length,0);
    assert.equal(Number((await f.db.get("SELECT COUNT(*) AS n FROM cohorts WHERE group_code='MARS'")).n),2);
  });
  test('postgres race: push acceptance fences graduate before recycle', {timeout:15000}, async t => {
    const f = await mars(t); const msg = await f.service.send('s1',{clientId:'push-fence',text:'private'});
    const job = await f.db.get('SELECT id FROM push_notification_outbox WHERE event_id=?',String(msg.messageId));
    const g = gate(); t.after(g.release); const order = [];
    f.providers.push.sendBatch = async messages => { await g.hold(); f.pushes.push(...messages); order.push('accepted'); return {tickets:[{status:'ok',id:'fixture-ticket'}],status:200}; };
    const first = f.service.deliverPush(job.id); await g.arrived;
    const second = f.other.graduate('admin',f.room).then(() => order.push('closed'));
    await blocked(f.db); g.release(); await Promise.all([first,second]);
    assert.deepEqual(order,['accepted','closed']); assert.equal(f.pushes.length,1);
    const recycle = await f.service.beginRecycle('admin',f.room,{requestKey:'push',intakeYear:2027,studentIds:['new1']});
    await f.service.finishRecycle('admin',recycle.id); await f.other.deliverPush(job.id); assert.equal(f.pushes.length,1);
  });
}
