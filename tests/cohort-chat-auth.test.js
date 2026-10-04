'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.COHORT_CHAT_LOCAL = '1';
process.env.SEMESTER_DB_SKIP_INIT = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const db = require('../db');
const { migrateCohortChat } = require('../migrations/002-cohort-chat');
const bcrypt = require('bcryptjs');

test('real application login + database adapter route only to authenticated cohort, with providers absent', async t => {
  await db.initSchema();
  await migrateCohortChat(db,{disposable:true});
  for (const [id,role] of [['cohort_admin','admin'],['cohort_a','student'],['cohort_b','student']]) {
    await db.run('INSERT INTO students(studentId,name,passwordHash,role,department) VALUES (?,?,?,?,?)',id,id,bcrypt.hashSync('local-fixture-password',4),role,'BIT');
  }
  await db.run("INSERT INTO chat_messages(studentId,text,createdAt) VALUES ('cohort_a','legacy invisible',CURRENT_TIMESTAMP)");
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve))); t.after(() => db.close());
  const base = `http://127.0.0.1:${server.address().port}`, tokens = {};
  for (const id of ['cohort_admin','cohort_a','cohort_b']) {
    const login = await fetch(`${base}/api/mobile/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({studentId:id,password:'local-fixture-password'})});
    assert.equal(login.status,200); tokens[id] = (await login.json()).token;
  }
  const request = async (student,path,method='GET',body) => {
    const response = await fetch(base+path,{method,headers:{authorization:`Bearer ${tokens[student] || 'invalid'}`,'content-type':'application/json'},body:body ? JSON.stringify(body) : undefined});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  const mercury = await request('cohort_admin','/api/chat/admin/cohorts','POST',{groupCode:'MERCURY',intakeYear:2026,currentSemester:1,studentIds:['cohort_a']});
  assert.equal(mercury.status,200);
  assert.equal((await request('cohort_admin','/api/chat/admin/cohorts','POST',{groupCode:'VENUS',intakeYear:2026,currentSemester:3,studentIds:['cohort_b']})).status,200);
  assert.equal((await request('cohort_a','/api/chat/messages')).body.messages.length,0);
  const sent = await request('cohort_a','/api/chat/messages','POST',{clientId:'auth-message',text:'auth scoped',studentId:'cohort_b'});
  assert.equal(sent.status,200); assert.equal(sent.body.data.studentId,'cohort_a');
  assert.equal((await request('cohort_b',`/api/chat/groups/${mercury.body.chatGroupId}/messages/${sent.body.messageId}`)).status,404);
  assert.equal((await request('cohort_b','/api/chat/messages')).body.messages.length,0);
  assert.equal((await request('cohort_a','/api/chat/realtime-config')).status,503);
  assert.equal((await request('bad','/api/chat/messages')).status,401);
  assert.equal((await request('cohort_a','/api/chat/old-route')).status,404);
  assert.equal((await request('cohort_a','/api/chat/heartbeat','POST',{})).body.total,1);
  // Legacy fallback is never reached even with valid app credentials.
  assert.equal((await request('cohort_a','/api/chat/messages','POST',{text:'missing client ID'})).status,400);
});
