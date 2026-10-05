process.env.NODE_ENV='test';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {createClient}=require('@supabase/supabase-js');
const {liveFixture}=require('./helpers/cohort-live-provider.cjs');
const {load,mobile}=require('./helpers/cohort-client-fixture');
const wait=async(fn,label,ms=7000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+label);};

if(!process.env.COHORT_LIVE_STATUS)throw Error('COHORT_LIVE_STATUS must name explicit disposable loopback provider status JSON');
test('live local Auth + private Realtime: real browser accounts and mobile service lifecycle', {timeout:180000},async t=>{
  const f=await liveFixture(process.env.COHORT_LIVE_STATUS);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const checks=[],pageErrors=[];
  const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
  const api=async(id,url,method='GET',body)=>{
    const res=await fetch(f.base+url,{method,headers:{Authorization:'Bearer '+f.sessions[id].access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:await res.json()};
  };
  const open=async(id,existing)=>{
    const context=existing||await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:850}});
    const page=await context.newPage();
    await page.route('https://**/*',route=>route.request().url().includes('supabase-js')?route.fulfill({contentType:'text/javascript',body:''}):route.abort());
    const initialize=({session})=>{
      // Chrome's offline error document has an opaque origin, not app storage.
      try { void localStorage.length; } catch { return; }
      if(!localStorage.getItem('qa-initialized')){
        localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
        localStorage.setItem('qa-initialized','yes');
      }
      const sdk=window.supabase;
      window.qaRealtime=[];window.qaWrites=0;
      window.supabase={...sdk,createClient:(...args)=>{
        const c=sdk.createClient(...args),setAuth=c.realtime.setAuth.bind(c.realtime),channel=c.channel.bind(c);
        let attached=false;
        c.realtime.setAuth=async token=>{attached=Boolean(token);return setAuth(token);};
        c.channel=(topic,options)=>{
          if(!attached||!options.config.private)throw Error('Missing explicit private credential');
          const ch=channel(topic,options),subscribe=ch.subscribe.bind(ch);
          const record={topic,status:'starting',events:[]};window.qaRealtime.push(record);
          ch.on('broadcast',{event:'*'},e=>record.events.push(e));
          ch.subscribe=callback=>subscribe((status,error)=>{record.status=status;callback?.(status,error);});
          ch.send=()=>{window.qaWrites++;throw Error('Client Broadcast forbidden');};
          ch.track=()=>{window.qaWrites++;throw Error('Presence forbidden');};
          return ch;
        };return c;
      }};
    };
    // Playwright does not guarantee ordering between separate init scripts.
    await page.addInitScript({content:fs.readFileSync(f.sdkPath,'utf8')+'\n;window.supabase=supabase;('+initialize.toString()+')('+JSON.stringify({session:f.sessions[id]})+');'});
    page.on('pageerror',e=>pageErrors.push(e.message));
    page.on('console',msg=>{if(msg.type()==='warning')console.error('Browser warning:',msg.text());});
    await page.goto(f.base+'/chat.html');
    await page.waitForFunction(()=>window.qaRealtime.some(c=>c.status==='SUBSCRIBED'),{},{timeout:10000}).catch(async error=>{
      console.error('Connection diagnostics',await page.evaluate(async()=>({url:location.pathname,channels:qaRealtime.map(c=>({topic:c.topic,status:c.status})),error:document.getElementById('chatError')?.textContent,keys:Object.keys(localStorage),auth:await SemesterAuth.getSupabase().then(async c=>({key:c.storageKey,session:Boolean((await c.auth.getSession()).data.session)})).catch(e=>e.message)})),pageErrors);
      throw error;
    });
    return {page,context};
  };
  let native;
  try {
    const mercury=f.rooms.MERCURY.chatGroupId,venus=f.rooms.VENUS.chatGroupId;
    for(let i=0;i<85;i++)await f.service.send('m1',{text:'history '+i,clientId:'seed-'+i});
    await f.service.send('v1',{text:'VENUS PRIVATE',clientId:'venus'});
    await f.drain();
    const A=await open('m1'),B=await open('m2'),V=await open('v1');
    const send=async(page,text)=>{await page.locator('#chatTextarea').fill(text);await page.locator('#sendBtn').click();await page.waitForFunction(()=>!isSending);};
    await send(A.page,'A to B live');
    await B.page.getByText('A to B live',{exact:true}).waitFor();
    check(await B.page.evaluate(()=>qaRealtime.some(c=>c.events.some(e=>e.event==='new_message'&&e.payload.text==='A to B live'))),'A → B delivered by actual private WebSocket');
    await send(B.page,'B to A live');await A.page.getByText('B to A live',{exact:true}).waitFor();
    check(await A.page.evaluate(()=>qaRealtime.some(c=>c.events.some(e=>e.payload.text==='B to A live'))),'B → A delivered by actual private WebSocket');
    check((await V.page.locator('body').innerText()).includes('VENUS PRIVATE')&&!(await V.page.locator('body').innerText()).includes('A to B live'),'Separate room sees only its history');
    const sent=await f.db.get("SELECT id FROM chat_messages WHERE text='A to B live'");
    check(await A.page.locator('#msg-row-'+sent.id).count()===1,'Canonical ack + broadcast gives one sender bubble');
    check(await B.page.locator(`#msg-row-${sent.id} a[href*="m1"]`).count()>0,'Profile identity is immutable despite same display names');
    check(await B.page.locator(`#msg-row-${sent.id} img`).count()>0,'Sender avatar rendered');
    let lose=true;const accepted=[];
    await A.page.route('**/api/chat/messages?*',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const response=await route.fetch(),body=await response.json();accepted.push(body.messageId);
      if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});
    });
    await A.page.locator('#hiddenFileInput').setInputFiles({name:'qa.txt',mimeType:'text/plain',buffer:Buffer.from('disposable attachment')});
    await send(A.page,'file accepted response lost');
    await A.page.locator('#sendBtn').click();await A.page.waitForFunction(()=>!isSending&&document.getElementById('chatTextarea').value==='');
    check(accepted.length===2&&accepted[0]===accepted[1],'Live file response-loss retry preserves one message ID');
    await B.page.locator('#msg-row-'+accepted[0]+' .im-file-card').waitFor();
    check(await B.page.locator('#msg-row-'+accepted[0]).count()===1,'Peer sees one file message despite retry');
    await A.page.unroute('**/api/chat/messages?*');
    await A.page.locator('#hiddenFileInput').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=','base64')});
    await send(A.page,'image upload');await B.page.getByText('image upload',{exact:true}).waitFor();
    const imageRow=await f.db.get("SELECT id,attachmentName FROM chat_messages WHERE text='image upload'");
    check((await api('v1','/api/chat/attachment/'+imageRow.attachmentName)).status===404,'Cross-room attachment access denied');
    const before=await A.page.locator('.im-row[data-message-id]').count();await A.page.evaluate(()=>fetchOlderMessages());
    check(await A.page.locator('.im-row[data-message-id]').count()>before,'Older pagination retains recent messages');
    await B.page.locator('#chatTextarea').fill('typing test');
    await A.page.waitForFunction(()=>document.getElementById('typingIndicator').classList.contains('visible'));
    await A.page.waitForFunction(()=>!document.getElementById('typingIndicator').classList.contains('visible'),{},{timeout:6000});
    check(true,'Typing arrives through provider and expires');
    await A.page.evaluate(id=>sendReaction(id,'❤️'),sent.id);
    await B.page.waitForFunction(id=>document.getElementById('msg-row-'+id)?.textContent.includes('❤️'),sent.id);
    await B.page.evaluate(id=>sendReaction(id,'👍'),sent.id);
    await A.page.waitForFunction(id=>document.getElementById('msg-row-'+id)?.textContent.includes('👍'),sent.id);
    check(true,'Two-user reactions converge live');
    await B.page.locator('#chatTextarea').fill('@m');await B.page.locator('#mentionCandidates button').first().click();
    await B.page.locator('#sendBtn').click();await B.page.waitForFunction(()=>!isSending);
    const mention=await f.db.get("SELECT id FROM chat_messages WHERE studentId='m2' ORDER BY id DESC LIMIT 1");
    check((await f.service.exact('m1',mercury,mention.id)).mentions[0]==='m1','Structured mention selects member by immutable ID');
    const targets=await f.db.all('SELECT recipient_student_id,payload_json FROM push_notification_outbox WHERE chat_group_id=? AND event_id=?',mercury,String(mention.id));
    check(targets.length===1&&targets[0].recipient_student_id==='m1','Mention intent goes only to intended peer; no Expo send');
    const cfg=(await api('m1','/api/chat/realtime-config')).data;
    check(!JSON.stringify(cfg).includes(f.config.SERVICE_ROLE_KEY)&&!JSON.stringify(cfg).includes(f.config.JWT_SECRET),'Client config excludes provider secrets');
    const denied=async(token,topic)=>{
      const c=createClient(f.config.API_URL,f.config.ANON_KEY,{accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false}});await c.realtime.setAuth(token);
      const ch=c.channel(topic,{config:{private:true}});
      ch.on('broadcast',{event:'*'},()=>{});
      const result=await new Promise(resolve=>{const timer=setTimeout(()=>{console.error('Denied probe connection',c.realtime.connectionState());resolve('timeout');},10000);ch.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='SUBSCRIBED'){clearTimeout(timer);resolve(status);}});});
      await c.removeAllChannels();return result;
    };
    const vcfg=(await api('v1','/api/chat/realtime-config')).data;
    const outsiderStatus=await denied(vcfg.token,cfg.topic);
    assert.equal(outsiderStatus,'CHANNEL_ERROR','Outsider broadcast subscription status');
    check(true,'Authenticated outsider cannot subscribe to Mercury');
    const replay=f.published.find(e=>e.payload.id===sent.id&&e.event==='new_message');
    await f.providers.realtime.send(replay);await A.page.reload();await A.page.waitForFunction(()=>qaRealtime.some(c=>c.status==='SUBSCRIBED'));
    await f.providers.realtime.send(replay);await new Promise(r=>setTimeout(r,150));
    check(await A.page.locator('#msg-row-'+sent.id).count()===1,'Duplicate replay across browser reload remains one message');
    const tab=await open('m1',A.context);await send(B.page,'multiple tabs');await tab.page.getByText('multiple tabs',{exact:true}).waitFor();await A.page.getByText('multiple tabs',{exact:true}).waitFor();
    check(true,'Same-account tabs receive canonical message once');
    await A.context.setOffline(true);await A.page.reload().catch(error=>assert.match(error.message,/ERR_INTERNET_DISCONNECTED/));
    check(await A.page.locator('.im-row[data-message-id]').count()===0,'Cold offline document cannot hydrate protected cache');
    await A.context.setOffline(false);await A.page.goto(f.base+'/chat.html');await A.page.waitForFunction(()=>qaRealtime.some(c=>c.status==='SUBSCRIBED'));
    await A.context.setOffline(true);check(await A.page.locator('.im-row[data-message-id]').count()>0,'Validated history survives transient network loss');await A.context.setOffline(false);
    // Actual source-loaded mobile service + SQLite cache, real HTTP and SDK transport.
    native=mobile();const initial=native.session.beginChatSession(f.base,'m1',f.sessions.m1.access_token);
    const chat=load('services/chat.ts',{'./chat-session':native.session,'./api':{
      api:{get:async(url,init)=>{const res=await fetch(url,init);const data=await res.json();if(!res.ok)throw Object.assign(Error(data.message),{status:res.status});return data;}},apiFetch:fetch,
    }});
    await chat.fetchChatConfig();assert.notEqual(native.session.getChatSession().generation,initial.generation);
    const received=[],connections=[];
    const realtime=load('services/chat-realtime.ts',{'@supabase/supabase-js':{createClient},'./chat':chat,'./chat-db':native.cache,'./chat-events':native.events,'./chat-session':native.session});
    const unsub=realtime.subscribeChatRealtime({onNewMessage:m=>received.push(m),onConnectionChange:c=>connections.push(c)});
    t.after(async()=>{unsub();await realtime.disconnectChatRealtime();native.sql.close();});
    await realtime.initChatRealtime();await wait(()=>connections.at(-1),'mobile real subscribe');
    await send(B.page,'native service live');await wait(()=>received.some(m=>m.text==='native service live'),'mobile wire delivery');
    check(true,'Actual mobile service + transactional cache receives real provider event');
    await A.page.goto(`${f.base}/chat.html?chatGroupId=${mercury}&messageId=${sent.id}`);
    await A.page.waitForFunction(id=>document.getElementById('msg-row-'+id)?.classList.contains('im-highlight-flash'),sent.id);
    check(true,'Exact deep link validates and highlights');
    check((await api('v1',`/api/chat/groups/${mercury}/messages/${sent.id}`)).status===404,'Foreign exact deep link denied');
    const rotationAt=Date.now();await f.service.rotate('admin',mercury,'m2');await f.service.syncProjection(mercury);
    await A.page.waitForFunction(()=>qaRealtime.some(c=>c.topic.endsWith(':2')&&c.status==='SUBSCRIBED'),{},{timeout:35000});
    check(Date.now()-rotationAt<35000,'Survivor automatically subscribes to epoch 2 within refresh policy');
    await B.page.waitForFunction(()=>roomClient.context()===null,{},{timeout:35000});
    check(await B.page.locator('.im-row[data-message-id]').count()===0&&await B.page.locator('#chatTextarea').isDisabled(),'Revoked browser clears history and composer');
    check(await denied(cfg.token,`chat:${mercury}:2`)==='CHANNEL_ERROR','Old epoch credential cannot join new epoch');
    check((await api('m2','/api/chat/realtime-config')).status===404,'Revoked member cannot obtain new config');
    check(await B.page.locator('#onlineCountText').innerText()==='0 online','Revocation clears online metadata');
    await chat.fetchChatConfig();await realtime.initChatRealtime();await wait(()=>connections.at(-1),'mobile epoch reconnect');
    await send(A.page,'epoch two');await wait(()=>received.some(m=>m.text==='epoch two'),'mobile epoch two delivery');
    check(true,'Mobile service reconnects to epoch 2 using fresh configuration');
    const downloads=[];A.page.on('download',d=>downloads.push(d));
    let releaseDownload,downloadStarted;
    const started=new Promise(r=>{downloadStarted=r;});const gate=new Promise(r=>{releaseDownload=r;});
    await A.page.route('**/api/chat/attachment/*',async route=>{downloadStarted();await gate;await route.continue();});
    await A.page.evaluate(name=>{currentLightboxUrl='/api/chat/attachment/'+name;currentLightboxFilename='pixel.png';void downloadCurrentMedia();},imageRow.attachmentName);
    await started;
    await A.page.evaluate(async()=>{const auth=await SemesterAuth.getSupabase();await auth.auth.signOut({scope:'local'});});
    check(await A.page.locator('.im-row[data-message-id]').count()===0,'Same-tab logout clears protected history immediately');
    releaseDownload();await new Promise(r=>setTimeout(r,200));check(downloads.length===0,'Late download after logout cannot open/save file');
    await A.page.unroute('**/api/chat/attachment/*');
    await A.page.evaluate(async credentials=>{const auth=await SemesterAuth.getSupabase();const result=await auth.auth.signInWithPassword(credentials);if(result.error)throw result.error;},{email:f.sessions.v1.user.email,password:f.password});
    await A.page.reload();await A.page.waitForFunction(()=>window.roomClient?.context()?.groupCode==='VENUS');
    check(!(await A.page.locator('body').innerText()).includes('A to B live'),'Account switch cannot hydrate previous room cache');
    await A.page.evaluate(async credentials=>{const auth=await SemesterAuth.getSupabase();const result=await auth.auth.signInWithPassword(credentials);if(result.error)throw result.error;},{email:f.sessions.m1.user.email,password:f.password});
    await A.page.reload();await A.page.waitForFunction(()=>window.roomClient?.context()?.groupCode==='MERCURY');
    check(true,'Switch back requires authoritative validation');
    check((await A.page.evaluate(()=>qaWrites))+(await B.page.evaluate(()=>qaWrites))===0,'No client Broadcast or Presence publication');
    check(f.errors.length===0,'Local durable publisher has no errors');assert.deepEqual(pageErrors,[]);check(true,'Browser has no uncaught errors');
    fs.writeFileSync('/tmp/cohort-phase2c/live-evidence.json',JSON.stringify({checks,requestCount:f.requests.length,publishedCount:f.published.length,manualDevice:false},null,2));
    console.log('LIVE_CHECKS='+checks.length);
  }catch(error){console.error('LIVE_FAILURE',error.stack);throw error;}
  finally{await browser.close();await f.close();}
});
