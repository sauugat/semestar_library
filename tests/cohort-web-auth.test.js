const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(){
  let session={access_token:'old-account'},release,refreshes=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const window={location:{pathname:'/chat.html',search:'',href:''},supabase:{createClient:()=>({auth:{
    getSession:async()=>({data:{session}}),
    refreshSession:async()=>{refreshes++;session=null;return {error:Error('expired'),data:{session:null}};},
  }})},fetch:async url=>url==='/api/auth/config'?{ok:true,json:async()=>({url:'http://127.0.0.1',key:'local'})}:pending};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/auth.js'),'utf8'),{window,console:{warn(){}},URLSearchParams});
  return {window,release,switchAccount:()=>{session={access_token:'new-account'};},refreshes:()=>refreshes};
}
test('web auth ignores a delayed old-account 401 after switching sessions',async()=>{
  const f=fixture();const request=f.window.authFetch('/api/chat/messages');
  await new Promise(r=>setImmediate(r));f.switchAccount();f.release({status:401});
  assert.equal((await request).status,401);assert.equal(f.refreshes(),0);assert.equal(f.window.location.href,'');
});
test('web auth still redirects a current session when refresh confirms expiry',async()=>{
  const f=fixture();const request=f.window.authFetch('/api/chat/messages');
  await new Promise(r=>setImmediate(r));f.release({status:401});await request;
  assert.equal(f.refreshes(),1);assert.match(f.window.location.href,/^\/login.html\?redirect=/);
});
