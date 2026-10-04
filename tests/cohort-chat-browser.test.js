process.env.NODE_ENV='test';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {chromium}=require('playwright');
const {fixture}=require('./helpers/cohort-fixture');

test('browser page + local backend: scoped history, upload timeout retry, reactions, mentions, deep links, rotation and revoke', {timeout:60000}, async()=>{
  const f=await fixture('sqlite');let browser,server;
  try {
    const rooms=await f.seed();
    const old=await f.service.send('m2',{clientId:'old-target',text:'old Mercury target'});
    for(let i=0;i<42;i++)await f.service.send('m2',{clientId:'history-'+i,text:'Mercury history '+i});
    await f.service.send('v1',{clientId:'venus-secret',text:'VENUS MUST STAY PRIVATE'});
    await f.service.syncProjection(rooms.MERCURY.chatGroupId);
    const app=express();app.use(express.json());
    app.use(async(req,_res,next)=>{const id=/fixture_sid=([^;]+)/.exec(req.headers.cookie||'')?.[1]||'m1';req.student=await f.db.get('SELECT * FROM students WHERE studentId=?',id);req.sessionID='fixture-'+id;next();});
    app.get(['/api/me','/api/profile'],(req,res)=>res.json(req.student));
    app.get('/api/auth/config',(req,res)=>res.json({url:`http://${req.headers.host}`,key:'local-public'}));
    app.get('/api/notifications/unread-count',(_req,res)=>res.json({count:0}));
    app.get('/api/notifications',(_req,res)=>res.json([]));
    app.use('/api/chat',require('../routes/cohort-chat')(f.service));
    app.use(express.static(path.join(__dirname,'../public')));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    f.providers.realtime.publicConnection={url:base,key:'local-public'};
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:850}});const errors=[];
    page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{
      window.fixtureChannels=[];
      const fixtureSupabase = {createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-m1'}}})},realtime:{setAuth:async token=>{window.fixtureCredential=token;}},
        channel:(topic,options)=>{if(!window.fixtureCredential||!options.config.private)throw Error('private auth missing');const c={topic,handlers:{},on(type,{event},fn){if(type!=='broadcast')throw Error('Presence forbidden');c.handlers[event]=fn;return c;},subscribe(fn){fn('SUBSCRIBED');return c;},track(){throw Error('Presence forbidden');},send(){throw Error('client broadcast forbidden');}};window.fixtureChannels.push(c);return c;},removeChannel:async()=>{},removeAllChannels:async()=>{}})};
      try {
        Object.defineProperty(window, 'supabase', { value: fixtureSupabase, writable: false, configurable: true });
      } catch (_) {
        window.supabase = fixtureSupabase;
      }
      localStorage.setItem('semester-chat-v2:m1',JSON.stringify([{id:999,text:'LEGACY CACHE MUST NOT RENDER'}]));
    });
    await page.goto(base+'/chat.html');
    await page.waitForFunction(()=>document.querySelector('.im-contact-name')?.textContent==='Mercury Group',{},{timeout:5000}).catch(async error=>{console.error(await page.locator('#chatError').innerText());throw error;});
    await page.locator('.im-row[data-message-id]').first().waitFor();
    assert.equal(await page.locator('body').innerText().then(t=>t.includes('VENUS MUST STAY PRIVATE')||t.includes('LEGACY CACHE MUST NOT RENDER')),false);
    assert.equal(await page.locator('.im-row[data-message-id]').count(),40);
    await page.evaluate(()=>fetchOlderMessages());assert.equal(await page.locator('.im-row[data-message-id]').count(),43);
    await page.locator('#chatTextarea').fill('@m');
    await page.locator('#mentionCandidates button').first().waitFor();
    await page.locator('#mentionCandidates button').first().click();
    assert.match(await page.locator('#chatTextarea').inputValue(),/@m2/);
    await page.locator('#chatTextarea').fill('@m2 accepted response lost');
    await page.locator('#hiddenFileInput').setInputFiles({name:'local.txt',mimeType:'text/plain',buffer:Buffer.from('room attachment')});
    let lose=true;const identities=[];
    await page.route('**/api/chat/messages?*',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const response=await route.fetch();const body=await response.json();identities.push(body.messageId);
      if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});
    });
    await page.locator('#sendBtn').click();await page.waitForFunction(()=>!isSending);
    assert.equal(identities.length,1);
    await page.locator('#sendBtn').click();await page.waitForFunction(()=>!isSending&&document.getElementById('chatTextarea').value==='');
    assert.equal(identities.length,2);assert.equal(identities[0],identities[1]);
    const row=page.locator('#msg-row-'+identities[0]);assert.equal(await row.count(),1);
    assert.equal(await row.locator('.im-file-card').count(),1);
    const stored=await f.service.exact('m1',rooms.MERCURY.chatGroupId,identities[0]);assert.deepEqual(stored.mentions,['m2']);
    await page.evaluate(id=>sendReaction(id,'❤️'),identities[0]);assert.ok((await row.innerText()).includes('❤️'));
    await page.evaluate(()=>searchRoom('history 0'));await page.waitForTimeout(400);assert.ok(await page.locator('.is-search-active').count());
    const event={...stored,eventId:'repeat-browser',realtimeEpoch:1};
    assert.equal(await page.evaluate(e=>roomClient.receive('new_message',e),event),true);
    assert.equal(await page.evaluate(e=>roomClient.receive('new_message',e),event),false);
    await page.reload();await page.locator('#msg-row-'+identities[0]).waitFor({timeout:5000}).catch(async e=>{console.error('reload state',await page.evaluate(()=>({url:location.href,context:window.roomClient?.context(),error:document.getElementById('chatError')?.textContent,rows:[...document.querySelectorAll('.im-row')].map(r=>r.id)})));throw e;});
    assert.equal(await page.evaluate(e=>roomClient.receive('new_message',e),event),false);
    await f.service.rotate('admin',rooms.MERCURY.chatGroupId,'m2');await f.service.syncProjection(rooms.MERCURY.chatGroupId);
    await page.evaluate(()=>roomClient.refresh());
    assert.equal(await page.evaluate(()=>window.fixtureChannels.at(-1).topic),`chat:${rooms.MERCURY.chatGroupId}:2`);
    await page.goto(`${base}/chat.html?chatGroupId=${rooms.MERCURY.chatGroupId}&messageId=${old.messageId}`);
    await page.locator('#msg-row-'+old.messageId).waitFor();
    await page.screenshot({path:'/tmp/cohort-phase2b-browser.png',fullPage:true});
    await page.goto(`${base}/chat.html?chatGroupId=${rooms.VENUS.chatGroupId}&messageId=${old.messageId}`);
    await page.waitForFunction(()=>document.getElementById('chatError').textContent.includes('no longer available'));
    await f.service.rotate('admin',rooms.MERCURY.chatGroupId,'m1');
    await page.evaluate(()=>roomClient.refresh());assert.equal(await page.locator('.im-row[data-message-id]').count(),0);
    assert.equal(await page.locator('#chatTextarea').isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await f.close();}
});
