const test=require('node:test');
const assert=require('node:assert/strict');
const {styleLookupReply,toneInstructions}=require('../lib/chat-personality');
const {handleChat}=require('../ai-assistant');
const reply='Found 2 matching notes.';
const style=options=>styleLookupReply(reply,{kind:'notes',successful:true,history:[],...options});

test('successful instant notes use casual wording without invented personal context',()=>{
  assert.match(style({message:'Java notes'}),/^bro,.*\n\nFound 2 matching notes\.$/);
  assert.match(style({message:"Java notes for tomorrow's exam"}),/speedrun/);
  assert.doesNotMatch(style({message:"Java notes for tomorrow's exam"}),/11pm|attendance|GPA/);
});
test('distress suppresses teasing for the current message without changing session mode',()=>{
  const current=style({message:"I'm stressed and cramming, Java notes please"});
  assert.match(current,/one step at a time/);assert.doesNotMatch(current,/💀|😭|speedrun/);
  const history=[{role:'user',content:"I'm overwhelmed and feel stupid"}];
  assert.match(style({message:'Java notes, cramming',history}),/speedrun/);
  assert.match(toneInstructions('explain arrays',history),/CURRENT SESSION MODE: ROAST/);
});
test('serious and answer-only instructions keep deterministic answers exact',()=>{
  for(const message of ['Java notes, no jokes','just the notes','code only','please be serious']) assert.equal(style({message}),reply);
  assert.equal(style({message:'Java notes',chatMode:'formal',history:[]}),reply);
});
test('errors, clarification and empty results never receive jokes or supportive padding',()=>{
  assert.equal(style({message:"I'm stressed and cramming",successful:false}),reply);
  assert.equal(styleLookupReply('No routine is published yet.',{message:'cramming',kind:'routine',successful:false}),'No routine is published yet.');
});
test('repeat teasing requires supplied repetitions and never claims cross-day memory',()=>{
  const first=style({message:'Java notes'});assert.doesNotMatch(first,/encore/);
  const history=[{role:'user',content:'Java notes'},{role:'assistant',content:reply},{role:'user',content:'Java notes'},{role:'assistant',content:reply}];
  const repeated=style({message:'Java notes',history});assert.match(repeated,/encore/);assert.doesNotMatch(repeated,/yesterday|today|three times/);
  history.push({role:'assistant',content:'back for an encore 😭'});
  assert.doesNotMatch(style({message:'Java notes',history}),/encore/);
});
test('early-study encouragement requires actual effort mentioned',()=>{
  assert.match(style({message:'Java notes, started early this time'}),/respect/);
  assert.doesNotMatch(style({message:'Java notes'}),/respect/);
});
test('syllabus lookup gains personality without an LLM call or changed data',async()=>{
  const options={generateReply:()=>{throw Error('Instant lookups must not call a model');}};
  const result=await handleChat({},'semester 2 syllabus, cramming tonight',{},[],'personality',options);
  assert.match(result.reply,/speedrun/);
  assert.ok(result.matchedCourses.every(c=>c.semester==='II'));
});
test('model receives personality and stress override while code remains a direct route',async()=>{
  let prompt;
  await handleChat({},"I'm anxious. Write C code to add two numbers. Code only.",{},[],'personality',{generateReply:async args=>{
    prompt=args.systemPrompt;assert.deepEqual(args.tools,[]);return {reply:'```c\nint sum = 1 + 2;\n```'};
  }});
  assert.match(prompt,/platonic/);assert.match(prompt,/no jokes or roasts/);assert.match(prompt,/Code blocks, formulas, factual lists and citations stay clean/);
});
test('exam stress does not send a normal academic explanation to live search',()=>{
  const {routeQuery}=require('../lib/chat-tools');
  assert.equal(routeQuery("I'm panicking about tomorrow's exam, explain arrays").kind,'direct');
  assert.equal(routeQuery('what is the latest Java version?').kind,'web');
});
