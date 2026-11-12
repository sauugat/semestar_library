const { resolveChatMode } = require('./chat-mode');
const aiChatService = require('./ai-chat-service');
const {
  validateActionRequest,
  resolveActionToPrompt,
  sanitizeMessageMetadataForClient,
  buildFallbackMessageActions
} = require('./message-actions');

// SSE transport shared by the widget, full-page chatbot, and mobile native chat. JSON remains supported.
function createChatHandler(db, assistant, options = {}) {
  const heartbeatIntervalMs = Math.max(10, Number(options.heartbeatMs) || 15000);
  return async (req, res) => {
    const { message, history: providedHistory, stream, conversationId: requestedConvId } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) {
      return res.status(400).json({ message: 'Send a message between 1 and 8,000 characters.' });
    }

    const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
    let conversationId = requestedConvId || null;
    // Client-supplied assistant turns and cards are not trusted conversation state; only user turns are sanitized.
    const sanitizedUserTurns = Array.isArray(providedHistory)
      ? providedHistory
          .filter(m => m?.role === 'user' && typeof m.content === 'string' && m.content.trim())
          .map(m => ({ role: 'user', content: String(m.content || '').slice(0, 6000) }))
          .slice(-8)
      : [];
    let history = studentId ? [] : sanitizedUserTurns;

    let saveUserPromise = null;
    // Authenticated conversation persistence & context recovery
    if (studentId && db && typeof db.run === 'function') {
      try {
        if (conversationId) {
          if (typeof conversationId !== 'string' || conversationId.length > 160) return res.status(400).json({ message: 'Invalid conversation.' });
          const existing = await db.get('SELECT student_id FROM ai_conversations WHERE id = ?', conversationId);
          if (existing && (existing.student_id || existing.studentId) !== studentId) return res.status(404).json({ message: 'Conversation not found.' });
        }
        if (!conversationId) {
          const activeConv = await aiChatService.getOrCreateActiveConversation(db, studentId);
          if (activeConv) conversationId = activeConv.id;
        }

        if (conversationId) {
          // Load recent messages from DB for context preservation
          if (!Array.isArray(history) || history.length === 0) {
            const dbMsgs = await aiChatService.getMessages(db, studentId, conversationId, 12);
            if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
              history = dbMsgs.map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text,
                metadata: m.metadata
              }));
            }
          }
          // If the user sent rapid follow-up messages whose prior user turns aren't yet in DB, append missing sanitized user turns
          if (sanitizedUserTurns.length > 0) {
            const existingUserContents = new Set(history.filter(m => m.role === 'user').map(m => m.content));
            for (const uTurn of sanitizedUserTurns) {
              if (!existingUserContents.has(uTurn.content) && uTurn.content !== message.trim()) {
                history.push(uTurn);
              }
            }
          }
          // Persist user's query asynchronously so first streamed token does not wait for message INSERT
          saveUserPromise = aiChatService.saveUserMessage(db, studentId, conversationId, message).catch(dbErr => {
            console.warn('[AI Chat Persistence Warning] Failed to persist user message:', dbErr.message);
          });
          try {
            const { waitUntil } = require('@vercel/functions');
            if (typeof waitUntil === 'function') {
              waitUntil(saveUserPromise);
            }
          } catch (_) {}
        }
      } catch (dbErr) {
        console.warn('[AI Chat Persistence Warning] Failed to prepare conversation:', dbErr.message);
        return res.status(503).json({ message: 'Could not load your conversation. Please try again.' });
      }
    }

    const { mode: chatMode } = resolveChatMode(message, req.session?.chatMode);
    if (req.session && req.session.chatMode !== chatMode) {
      req.session.chatMode = chatMode;
      try {
        // Persist before SSE headers so a first-time guest receives a session cookie.
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      } catch (err) {
        return res.status(503).json({ message: 'Could not save your chat preference. Please try again.' });
      }
    }
    const controller = new AbortController();
    const streaming = stream === true || (req.headers?.accept || '').includes('text/event-stream');
    let heartbeat;
    const send = (event, data) => {
      if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on?.('aborted', disconnect);
    res.on?.('close', disconnect);
    if (streaming) {
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n'); }, heartbeatIntervalMs);
      heartbeat.unref?.();
    }
    try {
      const studentInfo = req.user || req.student || (studentId ? { studentId, role: req.session?.role } : {});
      const result = await assistant.handleChat(db, message, studentInfo, history, conversationId || req.sessionID || 'guest', {
        signal: controller.signal,
        chatMode,
        onDelta: streaming ? text => send('delta', { text }) : undefined,
        onStatus: streaming ? status => send('status', typeof status === 'string' ? { state: status } : status) : undefined
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
          const savedAssistant = await aiChatService.saveAssistantMessage(db, studentId, conversationId, result.reply, result);
          if (savedAssistant?.id) result.id = savedAssistant.id;
        } catch (dbSaveErr) {
          console.warn('[AI Chat Persistence Warning] Failed to persist assistant reply:', dbSaveErr.message);
        }
      }

      const clientResult = sanitizeMessageMetadataForClient(result);
      if (streaming) { send('result', clientResult); res.end(); }
      else res.json(clientResult);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[Chat request failed]', err.code || err.name);
      const message = 'Couldn’t finish that reply. Try again in a moment.';
      if (streaming) { send('error', { message }); res.end(); }
      else res.status(503).json({ message });
    } finally {
      clearInterval(heartbeat);
      req.off?.('aborted', disconnect);
      res.off?.('close', disconnect);
      if (saveUserPromise) {
        try { await saveUserPromise; } catch (_) {}
      }
    }
  };
}
function createActionHandler(db, assistant) {
  return async (req, res) => {
    const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
    if (!studentId) {
      return res.status(401).json({ message: 'Sign in required.' });
    }

    const validated = validateActionRequest(req.body);
    if (!validated.valid) {
      return res.status(400).json({ message: validated.error });
    }

    const { action, payload } = validated;
    let conversationId = validated.conversationId;

    try {
      if (conversationId) {
        const conv = await aiChatService.getConversation(db, studentId, conversationId);
        if (!conv) {
          return res.status(404).json({ message: 'Conversation not found.' });
        }
      } else {
        const activeConv = await aiChatService.getOrCreateActiveConversation(db, studentId);
        conversationId = activeConv?.id || null;
      }

      // Verify Study Partner session ownership if sessionId is provided
      let ownedSession = null;
      if (payload.sessionId) {
        ownedSession = await db.get(
          `SELECT * FROM study_partner_sessions WHERE id = ? AND student_id = ?`,
          payload.sessionId,
          studentId
        );
        if (!ownedSession) {
          return res.status(404).json({ message: 'Study session not found.' });
        }
      }

      // 1. Navigation action
      if (action === 'view_related_notes') {
        return res.json({
          ok: true,
          action,
          conversationId,
          navigateTo: payload.url || '/notes'
        });
      }

      // 2. Server-evaluated MCQ submission
      if (action === 'submit_mcq_answer') {
        if (!conversationId) {
          return res.status(400).json({ message: 'conversationId is required for MCQ submission.' });
        }
        const targetMsg = await aiChatService.getAssistantMessageForAction(
          db,
          studentId,
          conversationId,
          payload.messageId || null,
          payload.questionId || null
        );
        if (!targetMsg || !targetMsg.metadata?.interactiveQuestion) {
          return res.status(404).json({ message: 'Interactive question not found.' });
        }

        const currentQuestion = targetMsg.metadata.interactiveQuestion;
        if (currentQuestion.submitted) {
          return res.status(409).json({
            message: 'This question has already been answered.',
            interactiveQuestion: sanitizeMessageMetadataForClient(targetMsg.metadata).interactiveQuestion
          });
        }

        const selectedOptionId = String(payload.optionId || '').trim().toUpperCase();
        const validOption = (currentQuestion.options || []).find(o => String(o.id).toUpperCase() === selectedOptionId);
        if (!validOption) {
          return res.status(400).json({ message: 'Invalid option selected.' });
        }

        const answerKey = targetMsg.metadata._serverOnly?.mcqAnswerKey;
        if (!answerKey || !answerKey.correctOptionId) {
          return res.status(400).json({ message: 'Answer key unavailable for this question.' });
        }

        const isCorrect = selectedOptionId === String(answerKey.correctOptionId).toUpperCase();
        const feedbackText = answerKey.explanation
          || (isCorrect
            ? `Spot on! Option ${selectedOptionId} is correct.`
            : `Not quite — option ${answerKey.correctOptionId} is the right answer.`);

        const updatedQuestion = {
          ...currentQuestion,
          submitted: true,
          selectedOptionId,
          isCorrect,
          correctOptionId: answerKey.correctOptionId,
          feedback: feedbackText
        };

        const nextMeta = {
          ...targetMsg.metadata,
          interactiveQuestion: updatedQuestion
        };
        await aiChatService.updateMessageMetadata(db, studentId, targetMsg.id, nextMeta);

        // Persist user choice and Kyana feedback message
        await aiChatService.saveUserMessage(db, studentId, conversationId, `Selected option ${selectedOptionId}: ${validOption.text}`);
        const replyText = isCorrect
          ? `**Correct (${selectedOptionId})!** ${feedbackText}`
          : `You selected **${selectedOptionId}**, but the right answer is **${answerKey.correctOptionId}**. ${feedbackText}`;

        const activeStudySession = ownedSession || (targetMsg.metadata.studySessionId
          ? await db.get(`SELECT * FROM study_partner_sessions WHERE id = ? AND student_id = ?`, targetMsg.metadata.studySessionId, studentId)
          : null);

        const followUpActions = buildFallbackMessageActions({
          intent: activeStudySession ? 'study_partner' : 'direct',
          studySession: activeStudySession,
          step: targetMsg.metadata.currentStepIndex ? { stepIndex: targetMsg.metadata.currentStepIndex } : null,
          isRemediation: !isCorrect,
          evalResult: { passed: isCorrect }
        });

        const savedFeedback = await aiChatService.saveAssistantMessage(db, studentId, conversationId, replyText, {
          intent: activeStudySession ? 'study_partner' : 'direct',
          messageActions: followUpActions,
          studySessionId: activeStudySession?.id || null,
          currentStepIndex: targetMsg.metadata.currentStepIndex || null
        });

        return res.json({
          ok: true,
          action,
          conversationId,
          messageId: targetMsg.id,
          interactiveQuestion: updatedQuestion,
          reply: replyText,
          id: savedFeedback?.id || null,
          messageActions: followUpActions
        });
      }

      // 3. Conversational actions (next_step, quick_reply, quiz, practice, confirmation)
      const promptText = resolveActionToPrompt(action, payload);
      if (!promptText) {
        return res.status(400).json({ message: 'Action prompt could not be resolved.' });
      }

      const dbMsgs = conversationId ? await aiChatService.getMessages(db, studentId, conversationId, 12) : [];
      const history = (dbMsgs || []).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
        metadata: m.metadata
      }));

      if (conversationId) {
        await aiChatService.saveUserMessage(db, studentId, conversationId, promptText);
      }

      const studentInfo = req.user || req.student || { studentId, role: req.session?.role };
      const result = await assistant.handleChat(db, promptText, studentInfo, history, conversationId || studentId, {
        chatMode: req.session?.chatMode
      });
      if (conversationId) {
        result.conversationId = conversationId;
        if (result?.reply) {
          const savedAssistant = await aiChatService.saveAssistantMessage(db, studentId, conversationId, result.reply, result);
          if (savedAssistant?.id) result.id = savedAssistant.id;
        }
      }

      return res.json({
        ok: true,
        action,
        ...sanitizeMessageMetadataForClient(result)
      });
    } catch (err) {
      console.error('[AI Action Handler Error]', err.message);
      return res.status(503).json({ message: 'Could not execute that action right now. Please try again.' });
    }
  };
}

module.exports = { createChatHandler, createActionHandler };
