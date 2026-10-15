const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createChatHandler}=require('../lib/chat-http');
async function appFor(t, handleChat) {
  const app=express();app.use(express.json());app.post('/chat',createChatHandler({}, {handleChat}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/chat`;
}
test('HTTP streaming emits ordered deltas and terminal result',async t=>{
  const url=await appFor(t,async(db,msg,user,history,id,{onDelta})=>{onDelta('hi ');onDelta('there');return {reply:'hi there',matchedFiles:[]};});
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({message:'hey',stream:true})});
  assert.match(res.headers.get('content-type'),/text\/event-stream/);
  const body=await res.text();assert.match(body,/event: delta\ndata: {"text":"hi "}/);assert.match(body,/event: result/);
  assert.ok(body.indexOf('hi ')<body.indexOf('there'));
});
test('JSON requests remain supported and bad requests fail before streaming',async t=>{
  let calls=0;const url=await appFor(t,async()=>{calls++;return {reply:'ok'};});
  const post=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.deepEqual(await (await post({message:'hey'})).json(),{reply:'ok'});
  assert.equal((await post({message:'x'.repeat(8001),stream:true})).status,400);assert.equal(calls,1);
});
test('provider failures finish SSE with a safe terminal error',async t=>{
  const url=await appFor(t,async()=>{throw Error('secret provider details');});
  const body=await (await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'hey',stream:true})})).text();
  assert.match(body,/event: error/);assert.doesNotMatch(body,/secret provider details/);
});

test('serverless correctness: user message save is guaranteed to complete when stream ends', async t => {
  const savedMessages = [];
  const mockDb = {
    isPostgres: true,
    exec: async () => {},
    get: async () => null,
    run: async (sql, ...params) => {
      savedMessages.push({ sql, params });
      return { lastInsertRowid: 1 };
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { studentId: 'stu_serverless_test', role: 'student' };
    next();
  });
  app.post('/chat', createChatHandler(mockDb, {
    handleChat: async (db, msg, user, hist, id, { onDelta }) => {
      onDelta('streamed token');
      return { reply: 'streamed token' };
    }
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'save me safely in serverless', stream: true, conversationId: 'conv_123' })
  });

  const body = await res.text();
  assert.match(body, /streamed token/);

  // Assert user message was persisted in DB
  const userMsgInsert = savedMessages.find(m => m.sql && m.sql.includes('INSERT INTO ai_messages') && m.params.includes('save me safely in serverless'));
  assert.ok(userMsgInsert, 'User message must be safely stored in DB when stream ends');
});

