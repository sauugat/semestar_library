const {resolveChatMode} = require('./chat-mode');
const aiChatService = require('./ai-chat-service');

// SSE transport shared by the widget, full-page chatbot, and mobile native chat. JSON remains supported.
function createChatHandler(db, assistant) {
  return async (req, res) => {
    const {message, history: providedHistory, stream, conversationId: requestedConvId} = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) {
      return res.status(400).json({message:'Send a message between 1 and 8,000 characters.'});
    }

    const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
    let conversationId = requestedConvId || null;
    let history = providedHistory;

    let saveUserPromise = null;
    // Authenticated conversation persistence & context recovery
    if (studentId && db && typeof db.run === 'function') {
      try {
        if (!conversationId) {
          const activeConv = await aiChatService.getOrCreateActiveConversation(db, studentId);
          if (activeConv) conversationId = activeConv.id;
        }

        if (conversationId) {
          // If client did not provide conversation history, load recent messages from DB for context preservation
          if (!Array.isArray(history) || history.length === 0) {
            const dbMsgs = await aiChatService.getMessages(db, studentId, conversationId, 12);
            if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
              history = dbMsgs.map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text
              }));
            }
          }
          // Persist user's query asynchronously so first streamed token does not wait for message INSERT
          saveUserPromise = aiChatService.saveUserMessage(db, studentId, conversationId, message).catch(dbErr => {
            console.warn('[AI Chat Persistence Warning] Failed to persist user message:', dbErr.message);
          });
        }
      } catch (dbErr) {
        console.warn('[AI Chat Persistence Warning] Failed to prepare conversation:', dbErr.message);
      }
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
    req.on?.('aborted', disconnect);
    res.on?.('close', disconnect);
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
      const studentInfo = req.user || req.student || (studentId ? { studentId, role: req.session?.role } : {});
      const result = await assistant.handleChat(db,message,studentInfo,history,studentId || req.sessionID || 'guest',{
        signal:controller.signal,
        chatMode,
        onDelta:streaming ? text=>send('delta',{text}) : undefined
      });
      if (controller.signal.aborted) return;

      // Attach conversationId to response result
      if (conversationId) {
        result.conversationId = conversationId;
      }

      // Ensure user message persistence completes before assistant reply is persisted
      if (saveUserPromise) {
        try { await saveUserPromise; } catch (_) {}
      }

      // Persist assistant reply for authenticated students
      if (studentId && conversationId && db && typeof db.run === 'function' && result?.reply) {
        try {
          await aiChatService.saveAssistantMessage(db, studentId, conversationId, result.reply, result);
        } catch (dbSaveErr) {
          console.warn('[AI Chat Persistence Warning] Failed to persist assistant reply:', dbSaveErr.message);
        }
      }

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
      req.off?.('aborted',disconnect);
      res.off?.('close',disconnect);
    }
  };
}
module.exports = {createChatHandler};
