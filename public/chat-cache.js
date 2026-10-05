/* One atomic storage value contains room messages, metadata and event receipts.
 * localStorage cannot serialize separate tabs: canonical reconciliation repairs
 * last-writer races. Reducers are idempotent by message/student identity. */
(function (root) {
  function createChatCache(storage, studentId, server, room) {
    if (!room || !server || !studentId) throw new Error('Validated room required');
    const key = `semester-chat-v3:${JSON.stringify([server.replace(/\/+$/, ''), studentId, room])}`;
    try { storage.removeItem(`semester-chat-v2:${studentId}`); } catch {}
    let state = { messages: [], events: [], meta: {} }, persistent=true;
    function read() {
      if(!persistent)return;
      try { const raw=storage.getItem(key); const saved=raw?JSON.parse(raw):null; if (saved && Array.isArray(saved.messages) && Array.isArray(saved.events)) state = saved; } catch { persistent=false; }
      state.messages = state.messages.filter(m => m.chatGroupId === room);
    }
    read();
    function save() {
      state.messages = state.messages.filter(m=>m.chatGroupId === room).sort((a,b)=>a.id-b.id).slice(-500);
      state.events = state.events.filter(e => e.at > Date.now()-7*86400000).slice(-2000);
      if(persistent)try { storage.setItem(key,JSON.stringify(state)); } catch { persistent=false; /* Keep this session's memory state instead of reloading a stale disk value. */ }
    }
    function merge(incoming) {
      const map = new Map(state.messages.map(m=>[m.id,m]));
      for (const m of incoming.filter(m=>m.chatGroupId === room)) {
        for (const [id,old] of map) if (m.clientId && old.clientId===m.clientId && old.studentId===m.studentId && id!==m.id) map.delete(id);
        map.set(m.id,{...map.get(m.id),...m});
      }
      state.messages=[...map.values()];
    }
    function remove(id) { state.messages = state.messages.filter(m=>m.id!==Number(id)).map(m=>m.replyToId===Number(id)?{...m,replyToId:null,replyText:null,replySender:null}:m); }
    function react(id,studentId,emoji,action) {
      state.messages = state.messages.map(m=>{
        if(m.id!==Number(id)) return m;
        const reactions=(m.reactions||[]).filter(r=>String(r.studentId)!==String(studentId));
        if(action!=='remove') reactions.push({studentId,emoji}); return {...m,reactions};
      });
    }
    return {
      key, get:()=>state.messages.slice(),
      merge(incoming) { read(); merge(incoming); save(); },
      replace(incoming) { read(); state.messages=incoming.slice(); save(); },
      remove(id) { read(); remove(id); save(); },
      react(id,studentId,emoji,action) { read(); react(id,studentId,emoji,action); save(); },
      apply(type,event) {
        read();
        if(event.chatGroupId!==room || state.events.some(e=>e.id===event.eventId)) return false;
        if(type==='new_message') merge([event]);
        if(type==='delete_message') remove(event.messageId);
        if(type==='reaction_update') react(event.messageId,event.studentId,event.emoji,event.action);
        state.meta[type]=event;
        state.events.push({id:event.eventId,at:Date.now()}); save(); return true;
      }
    };
  }
  if(typeof module!=='undefined') module.exports={createChatCache}; else root.createChatCache=createChatCache;
})(typeof window!=='undefined'?window:globalThis);
