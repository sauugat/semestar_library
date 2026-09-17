const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const session=require('express-session');
const {resolveChatMode}=require('../lib/chat-mode');
const {createChatHandler}=require('../lib/chat-http');
const {handleChat}=require('../ai-assistant');
const {createTools,routeQuery}=require('../lib/chat-tools');

test('mode commands strip only control phrases and keep requested subject filters',()=>{
  for(const message of ['be formal','stop roasting','serious mode','no jokes','switch to formal mode']) {
    assert.deepEqual(resolveChatMode(message),{mode:'formal',requested:true,query:''});
  }
  assert.deepEqual(resolveChatMode('no jokes, Java notes'),{mode:'formal',requested:true,query:'Java notes'});
  assert.equal(resolveChatMode('roast me again','formal').mode,'roast');
  assert.equal(resolveChatMode('back to normal','formal').mode,'roast');
  assert.equal(resolveChatMode('explain arrays','formal').mode,'formal');
  assert.equal(resolveChatMode('be formal, actually back to normal').mode,'roast');
});
test('quoted/code examples do not toggle mode; code-only is a one-message format request',()=>{
  assert.equal(resolveChatMode('Write Java to print "be formal"').requested,false);
  assert.equal(resolveChatMode('```js\nconsole.log("no jokes")\n```').requested,false);
  assert.equal(resolveChatMode('Code only').mode,'roast');
  assert.equal(resolveChatMode("I'm tired, don't roast me").mode,'formal');
});
test('mode-only request has no provider call and formal controls never pollute note search',async()=>{
  const options={generateReply:()=>{throw Error('no LLM expected');}};
  assert.equal((await handleChat({},'be formal',{},[],'test',options)).chatMode,'formal');
  let filters;
  const result=await handleChat({},'No jokes, Java notes',{},[],'test',{...options,toolDependencies:{searchNotes:async(db,args)=>{
    filters=args;return [{id:1,title:'Java notes',subject:'Computer Programming II (Java)',semester:'II'}];
  }}});
  assert.equal(filters.query,'');assert.equal(result.reply,'Found a matching note.');
});
test('mode participates in cache identity and formal prompt overrides old roast history',async()=>{
  const db={};let calls=0;
  const generateReply=async({systemPrompt})=>{calls++;return {reply:systemPrompt.includes('CURRENT SESSION MODE: FORMAL')?'Professional answer.':'Tease.\n\nAnswer.'};};
  const ask=(mode,history=[])=>handleChat(db,'explain variables',{},history,'test',{chatMode:mode,generateReply});
  assert.equal((await ask('roast')).reply,'Tease.\n\nAnswer.');
  assert.equal((await ask('formal')).reply,'Professional answer.');
  assert.equal((await ask('formal')).reply,'Professional answer.');assert.equal(calls,2);
  assert.equal((await ask('formal',[{role:'assistant',content:'bro 💀'}])).reply,'Professional answer.');
});
test('web search gets the same authoritative session tone',async()=>{
  let instructions;
  const tools=createTools({},routeQuery('latest Java release'),{chatMode:'formal',webSearch:async(q,options)=>{instructions=options.personalityInstructions;return {results:[],summary:''};}});
  await tools.executeTool('web_search',{query:'latest Java release'});
  assert.match(instructions,/CURRENT SESSION MODE: FORMAL/);assert.match(instructions,/no slang/);
});
test('session cookie persists formal mode across history resets, SSE and separate handler instances',async t=>{
  const store=new session.MemoryStore();
  const app=express();app.use(express.json());app.use(session({secret:'test-only-secret',resave:false,saveUninitialized:false,store}));
  const assistant={handleChat:async(db,message,user,history,id,{chatMode})=>({reply:chatMode})};
  app.post('/a',createChatHandler({},assistant));app.post('/b',createChatHandler({},assistant));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const post=(message,cookie='',path='/a',stream=false)=>fetch(root+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({message,history:[],stream})});
  const first=await post('be formal','','/a',true);
  const cookie=first.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  assert.match(await first.text(),/"reply":"formal"/);
  assert.equal((await (await post('explain arrays',cookie,'/b')).json()).reply,'formal');
  assert.equal((await (await post('explain arrays')).json()).reply,'roast');
  assert.equal((await (await post('back to normal',cookie)).json()).reply,'roast');
  assert.equal((await (await post('explain arrays',cookie,'/b')).json()).reply,'roast');
});
