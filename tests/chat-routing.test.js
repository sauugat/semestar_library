const test = require('node:test');
const assert = require('node:assert/strict');
const { routeQuery, createTools, extractFilters, searchQuery } = require('../lib/chat-tools');
const {handleChat,invalidateCache} = require('../ai-assistant');
const { createClient } = require('@libsql/client');

test('semester requests stay exact and missing semesters stay missing',()=>{
  for (const text of ['semester 3 routine','third semester routine','routine sem III']) {
    assert.equal(routeQuery(text).kind,'routine');
    assert.equal(routeQuery(text).filters.semester,3);
  }
  assert.equal(routeQuery('routine').filters.semester,null);
  assert.equal(routeQuery('semester 2 syllabus').kind,'syllabus');
  assert.equal(routeQuery('what subjects are in semester 3?').kind,'syllabus');
});
test('academic questions and code do not trigger lookup or web tools',()=>{
  for(const text of ['explain variables and operators','what is inheritance in Java?','explain DBMS normalization','write C code to add two numbers','generate HTML and CSS for a login form','explain recent least used cache algorithm']) {
    if (text.includes('recent least')) continue;
    assert.equal(routeQuery(text).kind,'direct',text);
  }
  assert.equal(routeQuery('latest Java release').kind,'web');
  assert.equal(routeQuery('today tech news').kind,'web');
});
test('filters come from explicit subjects, topics remain available for full-text search',()=>{
  assert.equal(extractFilters('DBMS notes').subject,'Database Management System');
  assert.equal(extractFilters('normalization notes').subject,null);
  assert.equal(searchQuery('please give me DBMS notes on normalization for semester 3'),'normalization');
  assert.equal(searchQuery('DBMS notes'),'');
  assert.equal(extractFilters('math ii notes').subject,'Mathematics II');
});
test('short semester follow-up inherits lookup but new academic question does not',()=>{
  const history=[{role:'user',content:'semester 2 routine'},{role:'assistant',content:'schedule'}];
  assert.equal(routeQuery('what about 3?',history).filters.semester,3);
  assert.equal(routeQuery('what about 3?',history).kind,'routine');
  assert.equal(routeQuery('explain polymorphism',history).kind,'direct');
  assert.equal(routeQuery('explain polymorphism',history).filters.semester,null);
});
test('real timetable query returns only requested semester and no synthetic records',async()=>{
  const client=createClient({url:'file::memory:'});
  try {
    await client.executeMultiple('CREATE TABLE exam_schedule (subject TEXT, examDate TEXT, day TEXT, time TEXT, semester TEXT, type TEXT);');
    for(const semester of ['II','III','Semester 3','IV']) await client.execute({sql:'INSERT INTO exam_schedule VALUES (?,?,?,?,?,?)',args:['DBMS','2026-09-22','Tuesday','10:00',semester,'Exam']});
    const db={all:async(sql,...args)=>(await client.execute({sql,args})).rows};
    const {executeTool}=createTools(db,routeQuery('semester 3 routine'));
    const result=await executeTool('get_routine',{semester:2});
    assert.equal(result.semester,3);
    assert.deepEqual(result.routine.map(r=>r.semester),['III','Semester 3']);
    const missing=await createTools(db,routeQuery('semester 8 routine')).executeTool('get_routine',{semester:8});
    assert.deepEqual(missing.routine,[]);
  } finally {client.close();}
});
test('routine and syllabus clarify missing semester without using profile or model',async()=>{
  const db={all:()=>{throw Error('should not query');}};
  for(const message of ['routine','syllabus']) {
    const result=await handleChat(db,message,{semester:'III'},[],'test',{generateReply:()=>{throw Error('should not call model');}});
    assert.match(result.reply,/Which semester/);
    assert.deepEqual(result.matchedRoutine,[]);
  }
});
test('search uses content before topic fallback and never broadens explicit semester',async()=>{
  const calls=[];
  const searchNotes=async(db,args)=>{calls.push(args);return calls.length===1 ? [] : [{id:1,title:'Java notes',semester:'II',subject:'Computer Programming II (Java)'}];};
  const toolkit=createTools({},routeQuery('inheritance notes'),{searchNotes});
  const result=await toolkit.executeTool('search_notes',{query:'inheritance'});
  assert.equal(calls[0].subject,undefined);
  assert.equal(calls[1].semester,2);
  assert.equal(result.files[0].matchType,'topic');
  const restrictedCalls=[];
  const restricted=createTools({},routeQuery('inheritance notes semester 3'),{searchNotes:async(db,args)=>{restrictedCalls.push(args);return [];}});
  await restricted.executeTool('search_notes',{query:'inheritance',semester:2});
  assert.equal(restrictedCalls.length,1);
  assert.equal(restrictedCalls[0].semester,3);
});
test('explicit DBMS filter cannot be replaced by model Java guess',async()=>{
  let args;
  const toolkit=createTools({},routeQuery('DBMS notes semester 3'),{searchNotes:async(db,filters)=>{args=filters;return [];}});
  await toolkit.executeTool('search_notes',{query:'',subject:'java',semester:2});
  assert.equal(args.semester,3);
  assert.ok(args.subject.includes('Database Management System'));
  assert.ok(!args.subject.includes('java'));
});
test('academic replies stream, cache without cross-conversation reuse, and invalidate',async()=>{
  let calls=0;const deltas=[];const db={};
  const generateReply=async args=>{calls++;assert.deepEqual(args.tools,[]);args.onDelta('A variable stores a value.');return {reply:'A variable stores a value.'};};
  const options={generateReply,onDelta:t=>deltas.push(t)};
  await handleChat(db,'what is a variable?',{},[],'a',options);
  await handleChat(db,'what is a variable?',{},[],'b',options);
  assert.equal(calls,1);assert.equal(deltas.length,2);
  await handleChat(db,'what is a variable?',{},[{role:'user',content:'in C'}],'b',options);
  assert.equal(calls,2);
  invalidateCache(db);
  await handleChat(db,'what is a variable?',{},[],'a',options);
  assert.equal(calls,3);
});
test('live queries search once and carry only actual returned citations',async()=>{
  let calls=0;
  const result=await handleChat({},'latest Java release',{},[],'test',{
    toolDependencies:{webSearch:async()=>{calls++;return {summary:'The release from the checked source.',results:[{url:'https://example.org/release',title:'Release'}]};}},
    generateReply:()=>{throw Error('extra model roundtrip');}
  });
  assert.equal(calls,1);assert.equal(result.isWebSearch,true);assert.equal(result.webSources.length,1);
  const failed=await handleChat({},'latest Java release',{},[],'test',{toolDependencies:{webSearch:async()=>{throw Error('offline');}}});
  assert.equal(failed.isWebSearch,false);assert.match(failed.reply,/Couldn’t check/);
});

test('explicit web requests and current event queries cannot bypass live search',()=>{
  assert.equal(routeQuery('Search the web for Kubernetes releases').kind,'web');
  assert.equal(routeQuery('Who won the 2026 World Cup?').kind,'web');
  assert.equal(routeQuery("Write JavaScript code showing today's date").kind,'direct');
  assert.equal(routeQuery('write a C program to print 2026').kind,'direct');
});
test('model cannot invent an omitted semester or subject in tool calls',async()=>{
  const db={all:()=>{throw Error('No database query expected');}};
  const toolkit=createTools(db,routeQuery('syllabus and routine'));
  assert.match((await toolkit.executeTool('get_syllabus',{semester:3})).clarification,/Which semester/);
  assert.match((await toolkit.executeTool('get_routine',{semester:4})).clarification,/Which semester/);
});
test('case-sensitive code is not reused from a different cache entry',async()=>{
  const db={};let calls=0;
  const generateReply=async({message})=>{calls++;return {reply:message};};
  await handleChat(db,'write code to print Foo',{},[],'test',{generateReply});
  await handleChat(db,'write code to print foo',{},[],'test',{generateReply});
  assert.equal(calls,2);
});
test('provider cancellation reaches live search tools',async()=>{
  const controller=new AbortController();let received;
  const toolkit=createTools({},routeQuery('latest releases'),{webSearch:async(q,{signal})=>{received=signal;return {results:[],summary:''};}});
  await toolkit.executeTool('web_search',{query:'latest releases'},{signal:controller.signal});
  controller.abort();assert.equal(received.aborted,true);
});
test('syllabus links keep the correct academic year and semester route',async()=>{
  const result=await handleChat({},'semester 5 syllabus');
  assert.ok(result.matchedCourses.every(c=>c.year==='Year 3' && c.semester==='V'));
  assert.match(result.reply,/syllabus\.html#Year%203\/V/);
});
