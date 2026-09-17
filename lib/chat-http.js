const {resolveChatMode} = require('./chat-mode');

// SSE transport shared by the widget and full-page chatbot. JSON remains supported.
function createChatHandler(db, assistant) {
  return async (req, res) => {
    const {message, history, stream} = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) {
      return res.status(400).json({message:'Send a message between 1 and 8,000 characters.'});
    }
    const {mode:chatMode} = resolveChatMode(message, req.session?.chatMode);
    if (req.session && req.session.chatMode !== chatMode) {
      req.session.chatMode = chatMode;
      try {
        // Persist before SSE headers so a first-time guest receives a session cookie.
        await new Promise((resolve,reject)=>req.session.save(err=>err ? reject(err) : resolve()));
      } catch (err) {
        return res.status(503).json({message:'Could not save your chat preference. Please try again.'});
      }
    }
    const controller = new AbortController();
    const streaming = stream === true || (req.headers.accept || '').includes('text/event-stream');
    let heartbeat;
    const send = (event, data) => {
      if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect);
    res.on('close', disconnect);
    if (streaming) {
      res.status(200).set({
        'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-cache, no-transform',
        'X-Accel-Buffering':'no'
      });
      res.flushHeaders();
      heartbeat = setInterval(()=>{if (!res.destroyed) res.write(': keepalive\n\n');},15000);
      heartbeat.unref?.();
    }
    try {
      const result = await assistant.handleChat(db,message,{},history,req.sessionID || 'guest',{
        signal:controller.signal,
        chatMode,
        onDelta:streaming ? text=>send('delta',{text}) : undefined
      });
      if (controller.signal.aborted) return;
      if (streaming) {send('result',result);res.end();}
      else res.json(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[Chat request failed]',err.code || err.name);
      const message = 'Couldn’t finish that reply. Try again in a moment.';
      if (streaming) {send('error',{message});res.end();}
      else res.status(503).json({message});
    } finally {
      clearInterval(heartbeat);
      req.off('aborted',disconnect);
      res.off('close',disconnect);
    }
  };
}
module.exports = {createChatHandler};
