const test=require('node:test');
const assert=require('node:assert/strict');
const {load,context,message,mobile,storage,realtime}=require('./helpers/cohort-client-fixture');
const {createChatCache}=require('../public/chat-cache');
const {createCohortClient}=require('../public/cohort-chat-client');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=(body,status=200)=>({ok:status===200,status,json:async()=>body});

test('mobile: cold offline privacy, room/account/server partition and discarded legacy cache',async t=>{
  const f=mobile();t.after(()=>f.sql.close());
  f.sql.exec(`CREATE TABLE chat_cache_v2(scope TEXT,id INTEGER,payload TEXT);INSERT INTO chat_cache_v2 VALUES('old',1,'{"id":1,"text":"legacy"}');`);
  assert.deepEqual(await f.cache.getCachedChatMessages(),[]);
  f.enter();await f.cache.upsertChatMessages([message(1),message(2,'venus')]);
  assert.deepEqual((await f.cache.getCachedChatMessages()).map(m=>m.id),[1]);
  assert.equal(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='chat_cache_v2'").get(),undefined);
  f.enter('venus');assert.deepEqual(await f.cache.getCachedChatMessages(),[]);
  await f.cache.upsertChatMessages([message(2,'venus')]);
  f.enter('mercury','b');assert.deepEqual(await f.cache.getCachedChatMessages(),[]);
  f.enter();assert.deepEqual((await f.cache.getCachedChatMessages()).map(m=>m.id),[1]);
  f.session.invalidateChatSession();assert.deepEqual(await f.cache.getCachedChatMessages(),[]);
  const restarted=load('services/chat-db.ts',f.deps);assert.deepEqual(await restarted.getCachedChatMessages(),[]);
  f.enter();assert.equal((await restarted.getCachedChatMessages())[0].id,1);
});

test('mobile: atomic persistent event dedupe, rollback, bounded retention, wrong room/epoch/type',async t=>{
  const f=mobile();t.after(()=>f.sql.close());f.enter();
  const event={...message(10),eventId:'event-1',realtimeEpoch:1};
  const decode=(type,payload)=>f.events.decodeChatEvent(type,payload,f.session.getChatSession());
  for(const [type,value] of [['unknown',event],['new_message',{...event,chatGroupId:'venus'}],['new_message',{...event,realtimeEpoch:2}]])assert.equal(decode(type,value),null);
  const e=decode('new_message',event);
  assert.deepEqual(await Promise.all([f.cache.applyCachedChatEvent(e,f.session.getChatSession()),f.cache.applyCachedChatEvent(e,f.session.getChatSession())]),[true,false]);
  const reopened=load('services/chat-db.ts',f.deps);
  assert.equal(await reopened.applyCachedChatEvent(e,f.session.getChatSession()),false);
  assert.equal((await reopened.getCachedChatMessages()).length,1);
  const run=f.database.runAsync;
  f.database.runAsync=async(sql,args)=>{if(sql.startsWith('INSERT INTO chat_events'))throw Error('disk failure');return run(sql,args);};
  const next=decode('new_message',{...message(11),eventId:'event-2',realtimeEpoch:1});
  await assert.rejects(reopened.applyCachedChatEvent(next,f.session.getChatSession()),/disk failure/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM chat_cache_v3').get().n,1);
  f.database.runAsync=run;assert.equal(await reopened.applyCachedChatEvent(next,f.session.getChatSession()),true);
  const scope=f.session.chatScope();
  for(let i=0;i<2001;i++)f.sql.prepare('INSERT INTO chat_events_v3 VALUES(?,?,?)').run(scope,'old-'+i,Date.now()-10000-i);
  await reopened.applyCachedChatEvent(decode('new_message',{...message(12),eventId:'event-3',realtimeEpoch:1}),f.session.getChatSession());
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM chat_events_v3').get().n,2000);
  const old=f.session.getChatSession();f.enter('venus');assert.equal(await reopened.applyCachedChatEvent(next,old),false);
});

test('mobile: delayed HTTP ignored, DTO room checked, stable send ID, stale attachment refused, exact link config first',async t=>{
  const f=mobile();t.after(()=>f.sql.close());f.enter();
  const calls=[];let delayed=null;let config=context();
  const chat=load('services/chat.ts',{'./chat-session':f.session,'./api':{
    api:{get:async url=>{calls.push(url);return config;}},
    apiFetch:async(url,options)=>{calls.push([url,options]);if(delayed)return delayed.promise;
      if(url.includes('/groups/'))return response(message(7));
      if(options.method==='POST')return response({data:message(7,'mercury',{clientId:'stable'}),messageId:7,duplicate:true});
      return response({chatGroupId:config.chatGroupId,messages:[message(7,config.chatGroupId)],readReceipts:[]});}
  }});
  delayed=deferred();const pending=chat.fetchChatMessages();f.enter('venus');delayed.resolve(response({messages:[message(1)],readReceipts:[]}));await assert.rejects(pending,/available/);delayed=null;
  const before=calls.length;
  await assert.rejects(chat.sendChatMessage({chatGroupId:'mercury',clientId:'old-file',file:{uri:'file:///old',name:'old',mimeType:'text/plain'}}),/available/);
  assert.equal(calls.length,before);
  f.enter();
  const a=await chat.sendChatMessage({chatGroupId:'mercury',clientId:'stable',text:'hello'});
  const b=await chat.sendChatMessage({chatGroupId:'mercury',clientId:'stable',text:'hello'});
  assert.equal(a.messageId,b.messageId);
  const posts=calls.filter(c=>Array.isArray(c)&&c[1].method==='POST');assert.ok(posts.every(c=>c[1].body.get('clientId')==='stable'));
  const merged=f.state.mergeChatMessages([message(-1,'mercury',{clientId:'stable'})],[a.data,b.data]);assert.equal(merged.length,1);
  const different=f.state.mergeChatMessages(merged,[message(8,'mercury',{studentId:'b',clientId:'stable'})]);assert.equal(different.length,2);
  await f.cache.upsertChatMessages([message(-1,'mercury',{clientId:'stable'}),different[0],different[1]]);
  await f.cache.resolvePendingMessage(-1,a.data);
  assert.deepEqual((await f.cache.getCachedChatMessages()).map(m=>m.id),[8,7]);
  calls.length=0;assert.equal((await chat.fetchExactChatMessage('mercury',7)).id,7);
  assert.ok(calls[0].endsWith('/api/chat/config'));assert.ok(calls[1][0].includes('/groups/mercury/messages/7'));
  calls.length=0;await assert.rejects(chat.fetchExactChatMessage('recycled-room',7),/available/);assert.equal(calls.length,1);
  config={...context(),roomStatus:'closed'};await assert.rejects(chat.fetchChatConfig(),/available/);assert.equal(f.session.getChatSession().context,null);
});

test('mobile: private auth before subscribe, epoch recovery, duplicate/late callbacks, no client writes',async t=>{
  const f=mobile();t.after(()=>f.sql.close());f.enter();const rt=realtime(),received=[];
  const module=load('services/chat-realtime.ts',{'./api':{ApiError:class extends Error {}},'@supabase/supabase-js':rt,'./chat-session':f.session,'./chat-db':f.cache,'./chat-events':f.events,
    './chat':{fetchRealtimeConfig:async()=>{const c=f.session.getChatSession().context;return {...c,topic:`chat:${c.chatGroupId}:${c.realtimeEpoch}`,expiry:new Date(Date.now()+120000).toISOString(),token:'fixture',url:'http://127.0.0.1:54321',key:'local-public'};}}});
  t.after(()=>module.disconnectChatRealtime());
  module.subscribeChatRealtime({onNewMessage:m=>received.push(m)});
  await module.initChatRealtime();assert.equal(rt.calls[0][0],'auth');assert.equal(rt.calls[1][0],'channel');assert.deepEqual(rt.calls[1][2],{config:{private:true}});
  const first=rt.channels[0];const event={...message(2),eventId:'e',realtimeEpoch:1};
  await first.handlers.new_message({payload:event});await first.handlers.new_message({payload:event});assert.equal(received.length,1);
  f.enter('mercury','a',2);await module.initChatRealtime();assert.equal(rt.channels.at(-1).topic,'chat:mercury:2');
  await first.handlers.new_message({payload:{...event,eventId:'late'}});assert.equal(received.length,1);
  f.session.invalidateChatSession();await rt.channels.at(-1).handlers.new_message({payload:{...event,eventId:'revoked',realtimeEpoch:2}});assert.equal(received.length,1);
});

test('mobile: academic promotion preserves cache and receipts; recycled display slot isolates the new UUID',async t=>{
  const f=mobile();t.after(()=>f.sql.close());f.enter();
  const before=f.session.getChatSession(),scope=f.session.chatScope();
  const event=f.events.decodeChatEvent('new_message',{...message(42),eventId:'promotion-event',realtimeEpoch:1},before);
  assert.equal(await f.cache.applyCachedChatEvent(event,before),true);
  f.session.acceptChatContext(before,{...before.context,currentSemester:2});
  assert.equal(f.session.chatScope(),scope);
  assert.equal(f.session.getChatSession().generation,before.generation);
  assert.equal(await f.cache.applyCachedChatEvent(event,f.session.getChatSession()),false);
  assert.deepEqual((await f.cache.getCachedChatMessages()).map(m=>m.id),[42]);
  f.session.acceptChatContext(f.session.getChatSession(),{...before.context,chatGroupId:'new-mercury-uuid',cohortId:'new-cohort-uuid'});
  assert.equal(f.session.getChatSession().context.groupCode,before.context.groupCode);
  assert.notEqual(f.session.chatScope(),scope);
  assert.deepEqual(await f.cache.getCachedChatMessages(),[]);
  assert.equal(await f.cache.applyCachedChatEvent(event,before),false);
});

function webFixture() {
  const store=storage(),rt=realtime(),calls=[],events=[],contexts=[],online=[],timers=new Map();let clock=Date.now(),sequence=0;
  let config=context(),deny=false,hold=null;
  const client=createCohortClient({account:'a',server:'http://127.0.0.1:3000',storage:store,createCache:createChatCache,createClient:rt.createClient,
    now:()=>clock,setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),
    fetch:async(path,options)=>{calls.push([path,options]);if(path==='/api/chat/config')return response(deny?{message:'unavailable'}:config,deny?404:200);
      if(hold&&path.includes('/messages'))return hold.promise;
      if(path.includes('/realtime-config'))return response({...config,topic:`chat:${config.chatGroupId}:${config.realtimeEpoch}`,expiry:new Date(clock+120000).toISOString(),token:'fixture',url:'http://127.0.0.1:54321',key:'public'});
      if(path.includes('/heartbeat'))return response({onlineIds:['a'],members:[{studentId:'a',expiresAt:new Date(clock+75000).toISOString()}],total:1});
      if(path.includes('/groups/'))return response(message(1,config.chatGroupId));
      return response({chatGroupId:config.chatGroupId,messages:[message(1,config.chatGroupId)]});},
    onContext:c=>contexts.push(c),onEvent:(type,e)=>events.push([type,e]),onOnline:ids=>online.push(ids),onReconcile:()=>{},onInvalidate:()=>contexts.push(null)});
  return {client,store,rt,calls,events,contexts,online,timers,setConfig:next=>{config=next;},rotate:()=>{config={...config,realtimeEpoch:2};},switchRoom:()=>{config=context('venus');},revoke:()=>{deny=true;},hold:d=>{hold=d;},tick:ms=>{clock+=ms;}};
}

test('web: academic promotion retains subscription and receipts; recycled display slot changes scope and denies old target',async()=>{
  const f=webFixture();await f.client.start();
  try {
    const generation=f.client.generation(),channel=f.rt.channels[0];
    const event={...message(42),eventId:'promotion-event',realtimeEpoch:1};
    assert.equal(f.client.receive('new_message',event),true);
    f.setConfig({...context(),currentSemester:2});await f.client.refresh();
    assert.equal(f.client.context().currentSemester,2);
    assert.equal(f.client.generation(),generation);
    assert.equal(f.rt.channels.length,1);
    assert.equal(f.client.receive('new_message',event),false);
    assert.deepEqual(createChatCache(f.store,'a','http://127.0.0.1:3000','mercury').get().map(m=>m.id),[42]);
    f.setConfig({...context(),chatGroupId:'new-mercury-uuid',cohortId:'new-cohort-uuid'});await f.client.refresh();
    assert.notEqual(f.client.generation(),generation);
    assert.deepEqual(createChatCache(f.store,'a','http://127.0.0.1:3000','new-mercury-uuid').get(),[]);
    const count=f.events.length;
    await channel.handlers.new_message({payload:{...event,eventId:'late-old-room'}});
    assert.equal(f.events.length,count);
    f.calls.length=0;await assert.rejects(f.client.exact('mercury',42),/available/);
    assert.ok(!f.calls.some(([url])=>url.includes('/groups/mercury/')));
  } finally { f.client.stop(); }
});
test('web: atomic cache blob, restart dedupe, wrong room/epoch, active periodic rotation recovery and background heartbeat',async()=>{
  const f=webFixture();await f.client.start();
  assert.deepEqual(f.rt.calls[1][2],{config:{private:true}});
  const e={...message(1),eventId:'event',realtimeEpoch:1};
  assert.equal(f.client.receive('new_message',e),true);assert.equal(f.client.receive('new_message',e),false);
  assert.equal(createChatCache(f.store,'a','http://127.0.0.1:3000','mercury').apply('new_message',e),false);
  for(const payload of [{...e,eventId:'wrong',chatGroupId:'venus'},{...e,eventId:'epoch',realtimeEpoch:2}])assert.equal(f.client.receive('new_message',payload),false);
  assert.equal(f.client.receive('unknown',e),false);assert.equal(f.events.length,1);
  f.rotate();f.tick(30000);await [...f.timers.values()].at(-1)();await f.client.refresh();
  assert.equal(f.rt.channels.at(-1).topic,'chat:mercury:2');
  assert.equal(f.client.receive('new_message',{...e,eventId:'old'}),false);
  const beats=f.calls.filter(c=>c[0].includes('/heartbeat')).length;
  f.client.setActive(false);f.tick(100000);await f.client.heartbeat();assert.equal(f.calls.filter(c=>c[0].includes('/heartbeat')).length,beats);assert.equal(f.timers.size,0);
  await f.client.setActive(true);assert.equal(f.calls.filter(c=>c[0].includes('/heartbeat')).length,beats+1);
  f.revoke();await f.client.refresh();assert.equal(f.client.context(),null);assert.equal(f.client.receive('new_message',{...e,realtimeEpoch:2}),false);f.client.stop();
});

test('web: late response ignored, room switch clears, exact link verifies config, cold offline never hydrates',async()=>{
  const f=webFixture();await f.client.start();const d=deferred();f.hold(d);
  const pending=f.client.fetch('/api/chat/messages');f.switchRoom();await f.client.refresh();d.resolve(response({messages:[message(2)]}));await assert.rejects(pending,/available/);f.hold(null);
  assert.equal(f.client.context().chatGroupId,'venus');assert.ok(f.contexts.includes(null));
  f.calls.length=0;await assert.rejects(f.client.exact('mercury',1),/available/);assert.ok(!f.calls.some(c=>c[0].includes('/groups/')));
  await f.client.exact('venus',1);assert.ok(f.calls.findIndex(c=>c[0]==='/api/chat/config')<f.calls.findIndex(c=>c[0].includes('/groups/')));f.client.stop();
  let loaded=false;const offline=createCohortClient({server:'http://127.0.0.1:3000',account:'a',storage:f.store,createCache:()=>{loaded=true;},fetch:async()=>{throw Error('offline');},setTimeout:()=>1,clearTimeout:()=>{}});
  await offline.start();assert.equal(offline.context(),null);assert.equal(loaded,false);offline.stop();
});

test('web: quota failure retains in-session event receipts instead of reloading stale disk state',()=>{
  const store=storage();
  createChatCache(store,'a','http://127.0.0.1','mercury').merge([message(1)]);
  store.setItem=()=>{throw Error('quota exceeded');};
  const cache=createChatCache(store,'a','http://127.0.0.1','mercury');
  const event={...message(2),eventId:'quota-event',realtimeEpoch:1};
  assert.equal(cache.apply('new_message',event),true);
  assert.equal(cache.apply('new_message',event),false);
  assert.deepEqual(cache.get().map(m=>m.id),[1,2]);
});

test('web: room-scoped receipt IDs and expired receipt replay preserve logical message identity',()=>{
  const store=storage(),a=createChatCache(store,'a','http://127.0.0.1','mercury'),b=createChatCache(store,'a','http://127.0.0.1','venus');
  const event={...message(1),eventId:'same-event-id',realtimeEpoch:1};
  assert.equal(a.apply('new_message',event),true);
  assert.equal(b.apply('new_message',{...event,chatGroupId:'venus'}),true);
  const persisted=JSON.parse(store.getItem(a.key));persisted.events[0].at=Date.now()-8*86400000;
  store.setItem(a.key,JSON.stringify(persisted));
  a.merge([]);assert.equal(JSON.parse(store.getItem(a.key)).events.length,0);
  assert.equal(a.apply('new_message',event),true);assert.equal(a.get().length,1);
  // Simulate a stale sibling tab overwriting the blob, then canonical repair.
  store.setItem(a.key,JSON.stringify({...persisted,messages:[message(1,'mercury',{text:'stale',reactions:[{studentId:'b',emoji:'❤️'}]})]}));
  a.merge([message(1,'mercury',{text:'canonical',reactions:[]})]);
  assert.equal(a.get()[0].text,'canonical');assert.deepEqual(a.get()[0].reactions,[]);
});

test('web: online snapshot deduplicates devices and expires locally without a heartbeat',async()=>{
  const f=webFixture();await f.client.start();
  const member={studentId:'a',expiresAt:new Date(Date.now()+1000).toISOString()};
  f.client.receive('online_snapshot',{eventId:'online',chatGroupId:'mercury',realtimeEpoch:1,members:[member,member]});
  assert.deepEqual(f.online.at(-1),['a']);
  const expire=[...f.timers.values()].at(-1), before=f.calls.length;
  f.tick(2000);expire();
  assert.deepEqual(f.online.at(-1),[]);assert.equal(f.calls.length,before);
  f.client.stop();
});

test('mobile hook: periodic/foreground epoch recovery, heartbeat cadence/background stop and revoked state clears',async t=>{
  const f=mobile();t.after(()=>f.sql.close());let next=context(),clock=Date.now(),focusCleanup,appChange,denied=false;
  const states=[],intervals=[],calls=[],topics=[];let stateIndex=0;
  const react={useState:initial=>{const index=stateIndex++;states[index]=initial;return [initial,value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>fn()};
  const app={currentState:'active',addEventListener:(_name,fn)=>{appChange=fn;return {remove(){}};}};
  const chat=load('services/chat.ts',{'./chat-session':f.session,'./api':{
    api:{get:async()=>{calls.push('config');if(denied)throw Object.assign(Error('revoked'),{status:404});return next;}},
    apiFetch:async url=>{calls.push(url);if(url.includes('/heartbeat'))return response({onlineIds:['a'],members:[{studentId:'a',expiresAt:new Date(clock+75000).toISOString()}],total:1});if(url.includes('/pinned'))return response({pinned:null});return response({chatGroupId:next.chatGroupId,messages:[message(1)],recentMessages:[message(1)],readReceipts:[],typing:[]});}
  }});
  const NativeDate=Date;
  const hooks=load('hooks/useClassChat.ts',{
    react,'react-native':{AppState:app},'expo-router':{useFocusEffect:fn=>{focusCleanup=fn();}},
    '@/services/chat':chat,'@/services/chat-state':f.state,'@/services/chat-db':f.cache,'@/services/chat-session':f.session,
    '@/services/dm-state':load('services/dm-state.ts'),
    '@/services/chat-realtime':{initChatRealtime:async()=>topics.push(f.session.getChatSession().context?.realtimeEpoch),disconnectChatRealtime:async()=>{},subscribeChatRealtime:()=>()=>{}},
  },{setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval:()=>{},Date:class extends NativeDate{static now(){return clock;}}});
  hooks.useClassChat('a','http://127.0.0.1:3000',{authToken:'fixture-token-a'});
  const flush=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));};
  await flush();assert.equal(topics.at(-1),1);assert.equal(states[0][0].chatGroupId,'mercury');
  const beats=()=>calls.filter(c=>c.includes('/heartbeat')).length;assert.equal(beats(),1);
  appChange('active');await flush();assert.equal(beats(),1);
  next={...next,realtimeEpoch:2};clock+=30000;intervals.find(i=>i.ms===30000).fn();await flush();assert.equal(topics.at(-1),2);
  app.currentState='background';appChange('background');clock+=90000;const before=calls.length;intervals.find(i=>i.ms===30000).fn();await flush();assert.equal(calls.length,before);
  app.currentState='active';appChange('active');await flush();assert.equal(topics.at(-1),2);
  denied=true;clock+=30000;intervals.find(i=>i.ms===30000).fn();await flush();assert.equal(f.session.getChatSession().context,null);assert.deepEqual(states[0],[]);
  focusCleanup();
});
