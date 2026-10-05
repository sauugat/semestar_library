'use strict';
// Explicit disposable provider only. Never reads application environment files.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const { Pool } = require('pg');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { validateProofConfig } = require('../../scripts/probe-cohort-realtime-v2.cjs');
const { fixture } = require('./cohort-fixture');

async function liveFixture(statusPath) {
  if (process.env.NODE_ENV !== 'test' || process.env.COHORT_CHAT_LOCAL !== '1') throw Error('Explicit local test flags required');
  const config = validateProofConfig(JSON.parse(fs.readFileSync(statusPath, 'utf8')));
  const pool = new Pool({ connectionString: config.DB_URL, connectionTimeoutMillis: 3000 });
  const schema = 'cohort_qa_' + randomUUID().replaceAll('-', '');
  const policy = schema + '_read';
  let f, server, interval, draining = Promise.resolve();
  const users = [], sessions = {}, requests = [], published = [], errors = [];
  const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = 'Disposable-Phase2C-' + randomUUID();
  const close = async () => {
    clearInterval(interval);
    if (server) await new Promise(resolve => server.close(resolve));
    await draining;
    for (const id of users) await admin.auth.admin.deleteUser(id);
    await pool.query(`DROP POLICY IF EXISTS ${policy} ON realtime.messages; DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
    if (f) await f.close();
  };
  try {
    const { rows: policies } = await pool.query("SELECT policyname FROM pg_policies WHERE schemaname='realtime' AND tablename='messages'");
    if (policies.length) throw Error('Disposable provider must have an empty Realtime policy set');
    const {rows:[tenant]}=await pool.query("SELECT private_only FROM _realtime.tenants WHERE external_id='realtime-dev'");
    if(!tenant?.private_only)throw Error('Disposable Realtime tenant must be configured private-only before QA');
    await pool.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.rooms(id uuid PRIMARY KEY, epoch integer NOT NULL, status text NOT NULL);
      CREATE TABLE ${schema}.members(subject uuid NOT NULL, room_id uuid NOT NULL, PRIMARY KEY(subject,room_id));
      CREATE FUNCTION ${schema}.can_receive(requested text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT EXISTS(SELECT 1 FROM ${schema}.members m JOIN ${schema}.rooms r ON r.id=m.room_id
          WHERE m.subject=auth.uid() AND r.status='active'
          AND requested='chat:'||r.id::text||':'||r.epoch::text
          AND auth.jwt()->>'chat_room_id'=r.id::text AND auth.jwt()->>'chat_epoch'=r.epoch::text)
      $$;
      REVOKE ALL ON FUNCTION ${schema}.can_receive(text) FROM PUBLIC;
      GRANT USAGE ON SCHEMA ${schema} TO authenticated;
      GRANT EXECUTE ON FUNCTION ${schema}.can_receive(text) TO authenticated;
      CREATE POLICY ${policy} ON realtime.messages FOR SELECT TO authenticated
        USING(extension='broadcast' AND ${schema}.can_receive(realtime.topic()));`);
    f = await fixture('sqlite');
    f.providers.now = Date.now;
    for (const id of ['m1', 'm2', 'v1', 'v2']) {
      const email = `${id}-${schema}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      users.push(data.user.id);
      await f.db.run('UPDATE students SET supabase_uid=?,name=?,avatarUrl=? WHERE studentId=?', data.user.id, 'QA Student', `/qa/avatar/${id}.svg`, id);
      const auth = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await auth.auth.signInWithPassword({ email, password });
      if (signed.error) throw signed.error;
      sessions[id] = signed.data.session;
    }
    // Non-interactive fixture members also need UUID subjects for the real policy.
    for (const id of ['admin','e1','s1','s2','new1','new2','none','outsider']) await f.db.run('UPDATE students SET supabase_uid=? WHERE studentId=?',randomUUID(),id);
    f.providers.credentials.issue = async ({ subject, chatGroupId, realtimeEpoch, expiry }) => {
      const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const data = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:subject,role:'authenticated',aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.parse(expiry)/1000),chat_room_id:chatGroupId,chat_epoch:realtimeEpoch})}`;
      return data+'.'+createHmac('sha256',config.JWT_SECRET).update(data).digest('base64url');
    };
    f.providers.projection.sync = async snapshot => {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query(`INSERT INTO ${schema}.rooms VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,status=excluded.status`,[snapshot.chatGroupId,snapshot.realtimeEpoch,snapshot.status]);
        await tx.query(`DELETE FROM ${schema}.members WHERE room_id=$1`,[snapshot.chatGroupId]);
        for(const m of snapshot.members)await tx.query(`INSERT INTO ${schema}.members VALUES($1,$2)`,[m.subject,snapshot.chatGroupId]);
        await tx.query('COMMIT');return snapshot;
      } catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
    };
    f.providers.realtime.publicConnection = {url:config.API_URL,key:config.ANON_KEY};
    f.providers.realtime.send = async event => {
      const res = await fetch(config.API_URL+'/realtime/v1/api/broadcast',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[event]})});
      if(!res.ok)throw Error('Local private publication rejected: '+res.status);
      published.push(event);
    };
    const rooms = await f.seed();
    for(const room of Object.values(rooms))if(!(await f.service.syncProjection(room.chatGroupId)).ready)throw Error('Local projection failed');
    const drain = () => {
      draining=draining.then(async()=>{
        const pending=await f.db.all("SELECT id FROM chat_realtime_outbox WHERE status IN ('pending','retry') ORDER BY created_at");
        for(const row of pending)await f.service.publishRealtime(row.id);
      }).catch(error=>errors.push(error.message));
      return draining;
    };
    const app=express();app.use(express.json());
    app.get('/api/auth/config',(_req,res)=>res.json({url:config.API_URL,key:config.ANON_KEY}));
    app.post('/api/mobile/login',async(req,res)=>{
      // Real local Auth password verification; synthetic roster only.
      const id=req.body.identifier||req.body.studentId;
      if(!sessions[id])return res.status(401).json({message:'Unknown local QA account'});
      const auth=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const result=await auth.auth.signInWithPassword({email:sessions[id].user.email,password:req.body.password});
      if(result.error)return res.status(401).json({message:'Invalid local QA credentials'});
      res.json({token:result.data.session.access_token,user:await f.db.get('SELECT * FROM students WHERE studentId=?',id)});
    });
    app.use('/api',async(req,res,next)=>{
      try {
        const token=(req.get('authorization')||'').replace(/^Bearer /,'');
        const result=await admin.auth.getUser(token);
        if(result.error||!result.data.user)return res.status(401).json({message:'Authentication required.'});
        req.student=await f.db.get('SELECT * FROM students WHERE supabase_uid=?',result.data.user.id);
        if(!req.student)return res.status(401).json({message:'Unknown student'});
        requests.push({student:req.student.studentId,path:req.originalUrl,method:req.method,at:Date.now()});
        next();
      }catch{res.status(401).json({message:'Authentication required.'});}
    });
    app.get(['/api/me','/api/profile'],(req,res)=>res.json(req.student));
    app.get('/api/notifications/unread-count',(_req,res)=>res.json({count:0}));
    app.get('/api/notifications',(_req,res)=>res.json([]));
    app.post('/api/notifications/device-token',(_req,res)=>res.json({success:true}));
    app.delete('/api/notifications/device-token',(_req,res)=>res.json({success:true}));
    app.use('/api/chat',require('../../routes/cohort-chat')(f.service));
    app.get('/qa/avatar/:id',(_req,res)=>res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="gray"/></svg>'));
    app.use(express.static(path.join(__dirname,'../../public')));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    interval=setInterval(drain,250);
    return { ...f, rooms, sessions, requests, published, errors, drain, close, config, password,
      base:`http://127.0.0.1:${server.address().port}`,
      sdkPath:path.join(__dirname,'../../node_modules/@supabase/supabase-js/dist/umd/supabase.js') };
  } catch(error){await close();throw error;}
}
module.exports={liveFixture};
