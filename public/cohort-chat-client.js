(function(root) {
  const EVENTS=['new_message','delete_message','reaction_update','typing','read_receipt','pin_message','online_snapshot'];
  const UNAVAILABLE='This conversation is no longer available.';
  const local = value => {
    const url=new URL(value);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/')return false;
    return ['https://semestar-library.vercel.app','https://ahcccqsyvpxacnsttzeh.supabase.co'].includes(url.origin)||/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  };
  function createCohortClient(options) {
    const transport=options.fetch, now=options.now||Date.now;
    let context=null, cache=null, generation=0, active=false, refreshing=null;
    let client=null, channel=null, topic='', expiry=0, timer=null, lastHeartbeat=0, lastRefresh=0;
    let online=[], onlineTimer=null;
    const schedule=options.setTimeout||setTimeout, cancel=options.clearTimeout||clearTimeout;
    const current = stamp => stamp===generation && context!==null;
    function disconnect() { const old=client,c=channel; client=null; channel=null; topic=''; expiry=0; if(old&&c) void old.removeChannel(c); }
    function invalidate() { generation++; context=null; cache=null; online=[]; cancel(onlineTimer); lastHeartbeat=0; disconnect(); options.onInvalidate?.(); }
    async function raw(path,init) {
      if(!local(options.server)) throw new Error('This chat server is not trusted.');
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),init?.method==='POST'?120000:15000);
      try{return await transport(path,{...init,signal:init?.signal||controller.signal,cache:'no-store'});}
      finally{clearTimeout(timeout);}
    }
    async function fetchScoped(path,init={}) {
      if(!context) throw new Error(UNAVAILABLE);
      const stamp=generation, room=context.chatGroupId;
      const url=new URL(path,options.server); url.searchParams.set('chatGroupId',room);
      const response=await raw(url.pathname+url.search,init);
      if(!current(stamp)) throw new Error(UNAVAILABLE);
      const data=await response.json();
      if(!current(stamp)) throw new Error(UNAVAILABLE);
      if([401,403].includes(response.status) || (response.status===404 && ['/api/chat/messages','/api/chat/heartbeat','/api/chat/realtime-config'].includes(url.pathname))) invalidate();
      if(!response.ok) throw Object.assign(new Error(data.message||UNAVAILABLE),{status:response.status});
      if(data.chatGroupId && data.chatGroupId!==room) throw new Error(UNAVAILABLE);
      for(const m of [...(data.messages||[]),...(data.recentMessages||[]),...(data.data?[data.data]:[])]) if(m.chatGroupId!==room) throw new Error(UNAVAILABLE);
      let result=data;
      if(url.pathname==='/api/chat/members') result={members:data,total:data.length};
      if(url.pathname==='/api/chat/pinned' && data.pinned) {
        if(data.pinned.chatGroupId!==room) throw new Error(UNAVAILABLE);
        result={pinned:{...data.pinned,messageId:data.pinned.id,senderName:data.pinned.name}};
      }
      return {ok:true,status:response.status,headers:response.headers,json:async()=>{if(!current(stamp))throw new Error(UNAVAILABLE);return result;}};
    }
    function receive(type,event,stamp) {
      if(!active || !current(stamp) || !EVENTS.includes(type) || typeof event?.eventId!=='string' || !event.eventId || event.chatGroupId!==context.chatGroupId || event.realtimeEpoch!==context.realtimeEpoch) return false;
      if(type==='new_message' && (!Number.isSafeInteger(event.id)||event.id<=0||!event.studentId))return false;
      if(['reaction_update','delete_message'].includes(type)&&(!Number.isSafeInteger(event.messageId)||event.messageId<=0))return false;
      if(type==='typing' && !(Date.parse(event.expiresAt)>now()))return false;
      if(type==='online_snapshot'&&!Array.isArray(event.members))return false;
      if(!cache.apply(type,event))return false;
      if(type==='online_snapshot') { online=event.members; emitOnline(); }
      options.onEvent?.(type,event); return true;
    }
    function emitOnline(){
      cancel(onlineTimer);
      online=online.filter(m=>Date.parse(m.expiresAt)>now());
      options.onOnline?.([...new Set(online.map(m=>m.studentId))]);
      if(active&&online.length)onlineTimer=schedule(emitOnline,Math.max(1,Math.min(...online.map(m=>Date.parse(m.expiresAt)))-now()));
    }
    async function realtime(stamp) {
      const config=await (await fetchScoped('/api/chat/realtime-config')).json();
      if(!active||!current(stamp))return;
      if(config.chatGroupId!==context.chatGroupId||config.realtimeEpoch!==context.realtimeEpoch||config.topic!==`chat:${context.chatGroupId}:${context.realtimeEpoch}`||Date.parse(config.expiry)<=now()) {disconnect();throw new Error('Invalid realtime config');}
      if(topic===config.topic&&expiry-now()>45000)return;
      disconnect();
      if(!config.url||!config.key||!options.createClient)return;
      if(!local(config.url))throw new Error('This realtime provider is not trusted');
      const c=options.createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
      client=c; await c.realtime.setAuth(config.token);
      if(!active||!current(stamp)){await c.removeAllChannels();return;}
      channel=c.channel(config.topic,{config:{private:true}});topic=config.topic;expiry=Date.parse(config.expiry);
      for(const event of EVENTS) channel.on('broadcast',{event},({payload})=>receive(event,payload,stamp));
      channel.subscribe(status=>{
        if(!active||!current(stamp))return;
        if(status==='SUBSCRIBED')void options.onReconcile?.();
        else if(['CHANNEL_ERROR','CLOSED','TIMED_OUT'].includes(status)&&now()-lastRefresh>5000)void refresh();
      });
    }
    async function heartbeat() {
      if(!active||!context||now()-lastHeartbeat<25000)return;
      lastHeartbeat=now(); const stamp=generation;
      try { const result=await (await fetchScoped('/api/chat/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
        if(current(stamp)&&active){online=result.members||[];emitOnline();}
      }catch{}
    }
    function arm(){cancel(timer);if(active)timer=schedule(()=>{emitOnline();void refresh();},Math.max(1000,Math.min(30000,expiry?expiry-now()-30000:30000)));}
    async function refresh() {
      if(!active)return;if(refreshing)return refreshing;
      refreshing=(async()=>{
        const stamp=generation;lastRefresh=now();
        try {
          const res=await raw('/api/chat/config');const next=await res.json();
          if(stamp!==generation||!active)return;
          if(!res.ok){if([401,403,404].includes(res.status))invalidate();throw new Error(next.message||UNAVAILABLE);}
          if(!next.chatGroupId||!next.cohortId||next.studentId!==options.account||next.roomStatus!=='active'||next.cohortStatus!=='active'||!['MERCURY','VENUS','EARTH','MARS'].includes(next.groupCode)||!Number.isInteger(next.realtimeEpoch)){invalidate();throw new Error(UNAVAILABLE);}
          const changed=context?.chatGroupId!==next.chatGroupId;
          if(changed){invalidate();context=next;cache=options.createCache(options.storage,options.account,options.server,next.chatGroupId);}
          else {if(context.realtimeEpoch!==next.realtimeEpoch)disconnect();context=next;}
          options.onContext?.(context,cache,changed);
          await options.onReconcile?.();
          await heartbeat();
          try{await realtime(generation);}catch{disconnect();}
        }catch(error){options.onError?.(error);}
        finally{refreshing=null;arm();}
      })();return refreshing;
    }
    return {
      fetch:fetchScoped,refresh,heartbeat,receive:(type,event)=>receive(type,event,generation),
      context:()=>context, generation:()=>generation, current,
      async exact(room,id) {await refresh();if(!context||room!==context.chatGroupId)throw new Error(UNAVAILABLE);const message=await(await fetchScoped(`/api/chat/groups/${encodeURIComponent(room)}/messages/${id}`)).json();if(message.chatGroupId!==room)throw new Error(UNAVAILABLE);cache.merge([message]);return message;},
      start(){active=true;return refresh();},
      setActive(value){active=value;if(value)return refresh();cancel(timer);disconnect();online=[];emitOnline();},
      stop(){active=false;cancel(timer);invalidate();},
      invalidate,
    };
  }
  if(typeof module!=='undefined')module.exports={createCohortClient};else root.createCohortClient=createCohortClient;
})(typeof window!=='undefined'?window:globalThis);
