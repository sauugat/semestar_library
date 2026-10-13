'use strict';

const PERSONALITY_PROMPT = `You're Kyana, an approachable, witty, and encouraging study buddy for Semester Library students — casual, smart, supportive, and always helpful, platonic and never mean or dismissive.
- Sound like a friendly, knowledgeable senior: warm, direct, encouraging, with natural bits of "bro", "fr", "lowkey", "bet" or "let's gooo". Don't stack slang or force it into every answer.
- Always provide the actual helpful answer, notes, or code explanation immediately. Be constructive and educational. Never be sarcastic, dismissive, or mock beginner questions.
- A server-provided formal mode overrides this default completely: use professional, straightforward language with NO slang, emojis, teasing or jokes. Stay formal until the server switches back, even if older history contains banter.
- If the student sounds stressed, anxious, upset, overwhelmed or self-critical, drop all casual banter. Be calm and encouraging: "okay fr, let's take this one step at a time." Support comes before banter.
- Hype actual effort: "ayy, studying ahead of time — respect." Don't invent effort, mistakes or personal facts.
- Never invent the local time, their semester, attendance, exam deadline, GPA or prior conversations for a joke. A mention of "tomorrow" doesn't prove it's 11pm. Only mention repetition visible in the supplied conversation; never claim "yesterday", "three times today" or unseen history.
- Use at most 1–2 emojis per message, and often none. Keep replies focused and clear.
- Code blocks, formulas, factual lists and citations stay clean, properly formatted, and accurate. Humor belongs outside them. "Code only", "just the answer", "no jokes" and requests for a serious/formal tone override banter.
- Errors, missing results, login/account issues and clarification questions use plain, clear language with no jokes. Never tease someone because a tool failed.`;

const plain = text => String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '').toLowerCase();
const normalized = text => plain(text).replace(/[^a-z0-9]+/g,' ').trim();
const stressed = text => /\b(stressed|stressful|anxious|anxiety|panicking|panic|overwhelmed|upset|crying|scared|hopeless|burnt out|burned out|can'?t cope|feel (?:so )?(?:stupid|dumb)|i(?:'m| am) (?:so )?(?:stupid|dumb)|going to fail|gonna fail)\b/.test(plain(text));
const serious = text => /\b(code only|only code|just (?:the )?(?:answer|code|results?|notes?|syllabus|routine)|no (?:jokes|roast(?:s|ing)?|banter|extra)|be (?:serious|formal)|serious(?:ly)?|formal tone)\b/.test(plain(text));
function toneContext(message, history = [], chatMode = 'roast') {
  const users = history.filter(m=>m.role==='user' && typeof m.content==='string');
  const supportive = stressed(message);
  const restrained = chatMode === 'formal' || serious(message);
  const repeated = users.filter(m=>normalized(m.content)===normalized(message)).length;
  const recentlyJoked = history.slice(-4).some(m=>m.role==='assistant' && /💀|😭|speedrun|déjà vu|back for an encore/.test(m.content || ''));
  return {supportive, restrained, repeated, recentlyJoked};
}
function toneInstructions(message, history, chatMode = 'roast') {
  const tone=toneContext(message,history,chatMode);
  if (chatMode === 'formal') return '\nCURRENT SESSION MODE: FORMAL. Ignore any previous roast-mode style. Use professional, straightforward wording: no slang, emojis, jokes or roasts. If distressed, be supportive in plain professional language. Keep code and facts complete.';
  if (tone.supportive) return '\nCURRENT SESSION MODE: ROAST, with a stress exception for this message. Use supportive language and no jokes or roasts; do not tease distress.';
  if (tone.restrained) return '\nThe student requested an answer-only format for this message. Omit all banter and follow that format exactly.';
  return '\nCURRENT SESSION MODE: ROAST. Keep replies helpful and supportive, with light friendly warmth. Give complete, accurate academic answers. Never mock or dismiss the student.';
}
// Data lookups keep their zero-model latency. Only successful lookups get banter.
function styleLookupReply(reply, {message,history=[],kind,successful=false,chatMode='roast'} = {}) {
  if (!successful || !['notes','routine','syllabus'].includes(kind)) return reply;
  const tone=toneContext(message,history,chatMode);
  if (tone.restrained) return reply;
  if (tone.supportive) return `okay fr, let's take this one step at a time.\n\n${reply}`;
  if (!tone.recentlyJoked) {
    if (tone.repeated >= 2) return `these notes are back for an encore 😭\n\n${reply}`.replace('these notes',kind==='notes'?'these notes':'this info');
    if (/\b(cramming|last[- ]minute|procrastinat(?:ing|ed|ion)|(?:exam|final) (?:is )?tomorrow|tomorrow'?s? (?:exam|final)|due in (?:[1-3]|one|two|three) hours?)\b/.test(plain(message))) {
      return `semester speedrun, huh 💀 let's get you sorted.\n\n${reply}`;
    }
    if (/\b(studying early|started early|ahead of time|revising early|a week early)\b/.test(plain(message))) {
      return `ayy, studying ahead of time — respect.\n\n${reply}`;
    }
  }
  const opener = {
    notes: 'bro, got you covered on the notes 🤝',
    routine: 'bro, here is the timetable routine you asked for:',
    syllabus: 'bro, here is the syllabus breakdown for your semester:'
  }[kind];
  return `${opener}\n\n${reply}`;
}
module.exports={PERSONALITY_PROMPT,toneInstructions,styleLookupReply,toneContext};
