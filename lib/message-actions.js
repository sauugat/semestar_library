'use strict';

/**
 * Kyana AI — Reusable Interactive Message Actions & Multiple-Choice System
 * Provides strict schema validation, allowlist enforcement, LLM tag extraction,
 * deterministic contextual fallbacks, and server-side MCQ answer evaluation.
 */

const ALLOWED_ACTION_TYPES = new Set([
  'quick_reply',
  'multiple_choice',
  'next_step',
  'quiz',
  'practice',
  'confirmation',
  'navigation'
]);

const ACTION_ALLOWLIST = {
  continue_lesson: {
    actionType: 'next_step',
    defaultPrompt: 'continue'
  },
  explain_example: {
    actionType: 'quick_reply',
    defaultPrompt: 'Give me another simple example of this'
  },
  explain_again: {
    actionType: 'quick_reply',
    defaultPrompt: 'Explain this again in simpler words'
  },
  practice_concept: {
    actionType: 'practice',
    defaultPrompt: 'Give me a practice question on this concept'
  },
  take_quiz: {
    actionType: 'quiz',
    defaultPrompt: 'Quiz me with a multiple-choice question on this topic'
  },
  try_harder_question: {
    actionType: 'quiz',
    defaultPrompt: 'Give me a harder exam-level question on this topic'
  },
  try_again: {
    actionType: 'quick_reply',
    defaultPrompt: 'Let me try answering again — give me a hint'
  },
  submit_mcq_answer: {
    actionType: 'multiple_choice',
    defaultPrompt: ''
  },
  view_related_notes: {
    actionType: 'navigation',
    defaultPrompt: 'Show me related notes for this topic'
  },
  ask_followup: {
    actionType: 'quick_reply',
    defaultPrompt: ''
  },
  confirm_action: {
    actionType: 'confirmation',
    defaultPrompt: 'Yes, proceed'
  }
};

const FORBIDDEN_PAYLOAD_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'studentId', 'student_id', 'userId', 'user_id', 'role']);

function sanitizeString(val, maxLen = 200) {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sanitizeActionPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {};
  }
  const clean = {};
  const allowedKeys = ['sessionId', 'stepIndex', 'stepId', 'prompt', 'questionId', 'optionId', 'messageId', 'url', 'subject', 'topic'];
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(rawPayload, key)) continue;
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) continue;
    const val = rawPayload[key];
    if (val === undefined || val === null) continue;
    if (key === 'stepIndex') {
      const n = Number(val);
      if (Number.isInteger(n) && n >= 1 && n <= 100) clean[key] = n;
    } else if (key === 'messageId') {
      const n = Number(val);
      if (Number.isInteger(n) && n >= 1) clean[key] = n;
      else if (typeof val === 'string' && val.trim().length <= 80) clean[key] = sanitizeString(val, 80);
    } else if (key === 'url') {
      const s = sanitizeString(String(val), 300);
      if (s.startsWith('/') && !s.startsWith('//')) clean[key] = s;
    } else if (typeof val === 'string') {
      clean[key] = sanitizeString(val, 240);
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Validates and normalizes a message_actions payload against the strict allowlist.
 * Returns null if no valid actions remain.
 */
function validateMessageActions(rawActions) {
  if (!rawActions) return null;
  const list = Array.isArray(rawActions)
    ? rawActions
    : (Array.isArray(rawActions.actions) ? rawActions.actions : []);

  const normalized = [];
  const seenIds = new Set();

  for (const item of list.slice(0, 5)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const actionName = sanitizeString(item.action || '', 60);
    if (!Object.prototype.hasOwnProperty.call(ACTION_ALLOWLIST, actionName)) continue;

    const spec = ACTION_ALLOWLIST[actionName];
    const actionType = ALLOWED_ACTION_TYPES.has(item.actionType) ? item.actionType : spec.actionType;
    const label = sanitizeString(item.label || '', 60);
    if (!label) continue;

    const id = sanitizeString(item.id || `${actionName}_${normalized.length + 1}`, 60) || `${actionName}_${normalized.length + 1}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const payload = sanitizeActionPayload(item.payload);
    if (actionName === 'ask_followup' && !payload.prompt) {
      payload.prompt = label;
    }

    normalized.push({
      id,
      label,
      action: actionName,
      actionType,
      payload
    });
  }

  if (normalized.length === 0) return null;
  return {
    type: 'message_actions',
    actions: normalized
  };
}

/**
 * Validates an interactive single-choice MCQ object.
 * Splits public client payload (without correctOptionId) from server-only answer key.
 */
function validateInteractiveQuestion(rawMcq, context = {}) {
  if (!rawMcq || typeof rawMcq !== 'object' || Array.isArray(rawMcq)) return null;
  const question = sanitizeString(rawMcq.question || '', 500);
  if (!question) return null;

  const rawOptions = Array.isArray(rawMcq.options) ? rawMcq.options : [];
  const options = [];
  const seenOptionIds = new Set();

  for (let i = 0; i < Math.min(rawOptions.length, 6); i++) {
    const opt = rawOptions[i];
    if (!opt) continue;
    const id = sanitizeString(
      typeof opt === 'string' ? String.fromCharCode(65 + i) : (opt.id || opt.label || String.fromCharCode(65 + i)),
      12
    ).toUpperCase();
    const text = sanitizeString(typeof opt === 'string' ? opt : (opt.text || opt.label || ''), 240);
    if (!id || !text || seenOptionIds.has(id)) continue;
    seenOptionIds.add(id);
    options.push({ id, label: id, text });
  }

  if (options.length < 2) return null;

  const rawCorrect = sanitizeString(rawMcq.correctOptionId || rawMcq.correct || '', 12).toUpperCase();
  const validCorrect = seenOptionIds.has(rawCorrect) ? rawCorrect : null;
  if (!validCorrect) return null;

  const questionId = sanitizeString(
    rawMcq.id || `mcq_${context.sessionId || 'chat'}_${context.stepIndex || Date.now()}`,
    80
  );

  return {
    publicQuestion: {
      id: questionId,
      type: 'multiple_choice',
      question,
      options,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.stepIndex ? { stepIndex: Number(context.stepIndex) } : {}),
      submitted: false,
      selectedOptionId: null,
      isCorrect: null,
      correctOptionId: null,
      feedback: null
    },
    serverAnswerKey: {
      questionId,
      correctOptionId: validCorrect,
      explanation: sanitizeString(rawMcq.explanation || '', 400) || null
    }
  };
}

/**
 * Extracts and strips an optional <kyana_actions>...</kyana_actions> JSON block from LLM output.
 */
function extractKyanaActionsFromText(rawText, context = {}) {
  const text = String(rawText || '');
  const match = text.match(/<kyana_actions>([\s\S]*?)<\/kyana_actions>/i);
  if (!match) {
    return { cleanText: text.trim(), messageActions: null, interactiveQuestion: null, serverAnswerKey: null };
  }

  const cleanText = text.replace(/<kyana_actions>[\s\S]*?<\/kyana_actions>/gi, '').trim();
  let messageActions = null;
  let interactiveQuestion = null;
  let serverAnswerKey = null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.actions)) {
        messageActions = validateMessageActions(parsed.actions);
      }
      if (parsed.mcq) {
        const validatedMcq = validateInteractiveQuestion(parsed.mcq, context);
        if (validatedMcq) {
          interactiveQuestion = validatedMcq.publicQuestion;
          serverAnswerKey = validatedMcq.serverAnswerKey;
        }
      }
    }
  } catch (_) {
    // Ignore malformed LLM JSON; deterministic fallback will provide clean actions
  }

  return { cleanText, messageActions, interactiveQuestion, serverAnswerKey };
}

/**
 * Builds contextual deterministic fallback actions when the LLM does not emit valid <kyana_actions>.
 */
function buildFallbackMessageActions({
  intent = '',
  studySession = null,
  step = null,
  isRemediation = false,
  evalResult = null,
  isCompleted = false,
  resourceCards = []
} = {}) {
  if (intent === 'study_partner' && studySession) {
    const sessPayload = {
      sessionId: studySession.id,
      ...(step ? { stepIndex: Number(step.stepIndex || step.step_index || 1) } : {})
    };

    if (isCompleted) {
      return validateMessageActions([
        { id: 'take_quiz', label: 'Take a unit quiz', action: 'take_quiz', actionType: 'quiz', payload: { subject: studySession.subject } },
        { id: 'ask_pyqs', label: 'Show past exam questions', action: 'ask_followup', actionType: 'quick_reply', payload: { prompt: `Show past exam questions for ${studySession.subject}` } }
      ]);
    }

    if (isRemediation && evalResult && evalResult.passed === false) {
      return validateMessageActions([
        { id: 'explain_again', label: 'Show simpler explanation', action: 'explain_again', actionType: 'quick_reply', payload: sessPayload },
        { id: 'another_example', label: 'Give another example', action: 'explain_example', actionType: 'quick_reply', payload: sessPayload },
        { id: 'try_again', label: 'Try again', action: 'try_again', actionType: 'quick_reply', payload: sessPayload }
      ]);
    }

    if (evalResult && evalResult.passed === true) {
      return validateMessageActions([
        { id: 'next_concept', label: 'Next concept →', action: 'continue_lesson', actionType: 'next_step', payload: sessPayload },
        { id: 'try_harder', label: 'Try a harder question', action: 'try_harder_question', actionType: 'quiz', payload: sessPayload },
        { id: 'another_example', label: 'Give another example', action: 'explain_example', actionType: 'quick_reply', payload: sessPayload }
      ]);
    }

    return validateMessageActions([
      { id: 'next_concept', label: 'Next concept →', action: 'continue_lesson', actionType: 'next_step', payload: sessPayload },
      { id: 'another_example', label: 'Give another example', action: 'explain_example', actionType: 'quick_reply', payload: sessPayload },
      { id: 'practice_concept', label: 'Practice this concept', action: 'practice_concept', actionType: 'practice', payload: sessPayload },
      { id: 'explain_again', label: 'Explain again', action: 'explain_again', actionType: 'quick_reply', payload: sessPayload }
    ]);
  }

  // Academic / notes / syllabus informational fallback actions
  const hasNotes = Array.isArray(resourceCards) && resourceCards.some(c => c && c.type === 'note' && c.deepLink);
  if (['direct', 'syllabus', 'notes'].includes(intent) || hasNotes) {
    const actions = [
      { id: 'explain_simpler', label: 'Explain in simpler language', action: 'explain_again', actionType: 'quick_reply', payload: { prompt: 'Explain this in simpler language' } },
      { id: 'take_quiz', label: 'Practice with a quiz', action: 'take_quiz', actionType: 'quiz', payload: { prompt: 'Quiz me with a multiple-choice question on this' } }
    ];
    if (hasNotes) {
      const topNote = resourceCards.find(c => c && c.type === 'note' && c.deepLink);
      actions.unshift({
        id: 'view_notes',
        label: 'View related notes',
        action: 'view_related_notes',
        actionType: 'navigation',
        payload: { url: topNote.viewUrl || topNote.deepLink }
      });
    }
    return validateMessageActions(actions);
  }

  return null;
}

/**
 * Strips server-only fields (like _serverOnly.correctOptionId) before sending metadata to any client.
 */
function sanitizeMessageMetadataForClient(metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const copy = { ...metadata };
  delete copy._serverOnly;
  if (copy.interactiveQuestion && !copy.interactiveQuestion.submitted) {
    copy.interactiveQuestion = {
      ...copy.interactiveQuestion,
      correctOptionId: null
    };
  }
  return copy;
}

/**
 * Validates an incoming POST /api/ai/actions request body.
 */
function validateActionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Invalid request body.' };
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return { valid: false, error: 'Forbidden parameter in request.' };
    }
  }

  const action = sanitizeString(body.action || '', 60);
  if (!action || !Object.prototype.hasOwnProperty.call(ACTION_ALLOWLIST, action)) {
    return { valid: false, error: 'Unsupported or disallowed action.' };
  }

  const spec = ACTION_ALLOWLIST[action];
  const actionType = body.actionType ? sanitizeString(body.actionType, 40) : spec.actionType;
  if (!ALLOWED_ACTION_TYPES.has(actionType) || actionType !== spec.actionType) {
    return { valid: false, error: 'Invalid actionType for requested action.' };
  }

  const conversationId = body.conversationId ? sanitizeString(String(body.conversationId), 160) : null;
  const payload = sanitizeActionPayload(body.payload);

  if (action === 'submit_mcq_answer') {
    if (!payload.optionId) {
      return { valid: false, error: 'Selected optionId is required.' };
    }
  }

  return {
    valid: true,
    action,
    actionType,
    conversationId,
    payload
  };
}

/**
 * Resolves an allowed action into the canonical user message/intent to execute through handleChat.
 */
function resolveActionToPrompt(action, payload = {}) {
  const spec = ACTION_ALLOWLIST[action];
  if (!spec) return '';
  if (action === 'ask_followup' && payload.prompt) {
    return payload.prompt;
  }
  if (payload.prompt && action !== 'continue_lesson') {
    return payload.prompt;
  }
  return spec.defaultPrompt;
}

module.exports = {
  ALLOWED_ACTION_TYPES,
  ACTION_ALLOWLIST,
  validateMessageActions,
  validateInteractiveQuestion,
  extractKyanaActionsFromText,
  buildFallbackMessageActions,
  sanitizeMessageMetadataForClient,
  validateActionRequest,
  resolveActionToPrompt
};
