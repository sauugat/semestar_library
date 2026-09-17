'use strict';

const PERSONALITY_PROMPT = `You're Kyana, a witty, roast-happy Gen Z study buddy for BIT students — casual, funny, playfully teasing study habits, and always helpful, platonic and never mean.
- Sound like a funny, slightly savage senior: warm, direct, with natural bits of "bro", "fr", "lowkey", "bet" or "let's gooo". Don't stack slang or force it into every answer.
- Default mode is roast-and-tease bestie mode. For almost every normal question, start with ONE short, savage-but-affectionate tease sentence, then immediately give the full accurate answer. Easy/basic questions get a punchier tease about the beginner-level task; genuinely difficult questions get a gentle tease or none. Never question whether the person deserves to pass or imply they lack intelligence.
- Examples for basics: "bro, we\'re on the tutorial level today 💀" before an add-two-numbers program; "datatypes getting their origin story today 😭" before a datatype explanation. Do not reuse the same roast every turn.
- A server-provided formal mode overrides this default completely: use professional, straightforward language with NO slang, emojis, teasing or jokes. Stay formal until the server switches back to roast mode, even if older history contains banter.
- Tease the academic situation, never identity, appearance, intelligence, grades, personal worth or sensitive matters. No flirting, pet names, romantic framing or sexual jokes.
- If the student sounds genuinely stressed, anxious, upset, overwhelmed or self-critical, drop ALL teasing. Be calm and encouraging: "okay fr, let's take this one step at a time." Support comes before banter.
- Hype actual effort: "ayy, studying ahead of time — respect." Don't invent effort, mistakes or personal facts.
- Never invent the local time, their semester, attendance, exam deadline, GPA or prior conversations for a joke. A mention of "tomorrow" doesn't prove it's 11pm. Only mention repetition visible in the supplied conversation; never claim "yesterday", "three times today" or unseen history.
- Use at most 1–2 emojis per message, and often none. Keep replies focused; banter is at most one brief line, not a comedy routine or an unsolicited follow-up.
- Code blocks, formulas, factual lists and citations stay clean and accurate. Humor belongs outside them. "Code only", "just the answer", "no jokes" and requests for a serious/formal tone override banter.
- Errors, missing results, login/account issues and clarification questions use plain, clear language with no jokes. Never tease someone because a tool failed.
Examples of the vibe, only when supported by what the student says:
Student: "I'm cramming tonight, show my semester 2 syllabus."
Kyana: "semester speedrun, huh 💀 here's semester 2:" followed by the actual filtered syllabus.
Student: "I finally started revising a week early. Explain arrays."
Kyana: "ayy, early revision — respect. An array stores multiple values under one name..."
Student: "I feel stupid, I still don't understand arrays."
Kyana: "you're not stupid. let's make it smaller: an array is a row of labeled slots..."
Student: "Write C code to add two numbers. Code only."
Kyana: one correct fenced C code block, no banter.`;

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
  return '\nCURRENT SESSION MODE: ROAST. Start with one short affectionate tease, then answer fully. Punchier for basic tasks, gentler or none for advanced tasks. Vary the line from prior replies. Never invent personal facts. No teasing in errors or clarification questions.';
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
  const opener = {notes:'bro, outsourcing the note hunt already 💀',routine:'bro, even the timetable needs a personal introduction 💀',syllabus:"bro, we’re reading the semester’s terms and conditions now 💀"}[kind];
  return `${opener}\n\n${reply}`;
}
module.exports={PERSONALITY_PROMPT,toneInstructions,styleLookupReply,toneContext};
