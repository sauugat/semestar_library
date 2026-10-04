const fs=require('node:fs');
const path=require('node:path');
const ts=require('../../mobile/node_modules/typescript');
const {DatabaseSync}=require('node:sqlite');
function load(file,dependencies={},globals={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../mobile',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',...Object.keys(globals),code)(name=>{
    if(!(name in dependencies))throw Error(`Unexpected dependency ${name} in ${file}`);return dependencies[name];
  },module,module.exports,...Object.values(globals));
  return module.exports;
}
const context=(room='mercury',studentId='a',realtimeEpoch=1)=>({chatGroupId:room,studentId,realtimeEpoch,cohortId:`cohort-${room}`,groupCode:room==='venus'?'VENUS':'MERCURY',currentSemester:1,roomStatus:'active',cohortStatus:'active'});
const message=(id,room='mercury',extra={})=>({id,chatGroupId:room,studentId:'a',text:`message ${id}`,createdAt:new Date().toISOString(),...extra});
function mobile() {
  const session=load('services/chat-session.ts'), state=load('services/chat-state.ts');
  const events=load('services/chat-events.ts');
  const sql=new DatabaseSync(':memory:');
  const database={
    execAsync:async query=>sql.exec(query),
    runAsync:async(query,values=[])=>sql.prepare(query).run(...values),
    getAllAsync:async(query,values=[])=>sql.prepare(query).all(...values),
    getFirstAsync:async(query,values=[])=>sql.prepare(query).get(...values),
    withExclusiveTransactionAsync:async callback=>{sql.exec('BEGIN');try{await callback(database);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}
  };
  const deps={'expo-sqlite':{openDatabaseAsync:async()=>database},'./chat-state':state,'./chat-session':session};
  const cache=load('services/chat-db.ts',deps);
  const enter=(room='mercury',account='a',epoch=1)=>{const s=session.beginChatSession('http://127.0.0.1:3000',account,'fixture-token-'+account);session.acceptChatContext(s,context(room,account,epoch));};
  return {session,state,events,sql,database,deps,cache,enter};
}
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
function realtime() {
  const calls=[],channels=[];
  return {calls,channels,createClient:()=>({
    realtime:{setAuth:async token=>calls.push(['auth',token])},
    channel:(topic,options)=>{
      calls.push(['channel',topic,options]);const handlers={};
      const c={topic,handlers,on(type,{event},fn){if(type!=='broadcast')throw Error('Presence subscription forbidden');handlers[event]=fn;return c;},subscribe(fn){c.status=fn;fn('SUBSCRIBED');return c;},track(){throw Error('Presence track forbidden');},send(){throw Error('Client Broadcast forbidden');}};
      channels.push(c);return c;
    },removeChannel:async c=>calls.push(['remove',c.topic]),removeAllChannels:async()=>{},
  })};
}
module.exports={load,context,message,mobile,storage,realtime};
