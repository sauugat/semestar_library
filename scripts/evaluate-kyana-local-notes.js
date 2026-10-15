#!/usr/bin/env node
'use strict';
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const fs = require('fs');
const { buildNoteKnowledge } = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');
const { applyKnowledgeMigration } = require('../lib/knowledge-schema');
const { searchKnowledge } = require('../lib/knowledge-search');
(async()=>{
 const source = new DatabaseSync(process.env.KYANA_LOCAL_SNAPSHOT || 'database.db',{readOnly:true});
 const files = source.prepare(`SELECT f.id, COALESCE(NULLIF(TRIM(f.title),''),f.originalName) AS title, f.originalName, f.storedName, f.subject, f.chapter, f.semester FROM files f WHERE LENGTH(COALESCE(NULLIF(TRIM(f.title),''),f.originalName))>3 GROUP BY LOWER(COALESCE(NULLIF(TRIM(f.title),''),f.originalName)) ORDER BY f.id LIMIT 60`).all(); source.close();
 if(files.length<50)throw Error('Need at least 50 distinct note titles');
 const { createClient } = require('@libsql/client');
 const local = createClient({url:'file::memory:'});
 const localDb = { exec: sql => local.executeMultiple(sql), run: (sql,...args) => local.execute({sql,args}), get:async(sql,...args)=>(await local.execute({sql,args})).rows[0] };
 await local.execute('CREATE TABLE files(id INTEGER PRIMARY KEY)');
 const extraction = {};
 for(const f of files){
  await local.execute({sql:'INSERT INTO files VALUES(?)',args:[f.id]});
  const status = await require('../lib/note-search').indexNote(localDb,f);
  extraction[status.status] = (extraction[status.status] || 0)+1;
  const doc=await localDb.get('SELECT content,indexed_at FROM note_search_documents WHERE id = ?',f.id);
  f.extracted_content=doc.content; f.extraction_indexed_at=doc.indexed_at;
 }
 local.close();
 const url=process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';
 if(!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Local test DB only');
 const c=new Client({connectionString:url});await c.connect();const schema='kyana_notes_'+Date.now();
 await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET search_path TO ${schema},public`);
 try{
  await c.query(`CREATE TABLE students(studentId TEXT PRIMARY KEY); CREATE TABLE cohorts(id TEXT PRIMARY KEY);
   CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,semester_no INTEGER,cohort_id TEXT,audience_scope TEXT,visibility TEXT,target_all_semesters INTEGER);
   CREATE TABLE post_target_semesters(post_id INTEGER,semester INTEGER);
   CREATE TABLE assignments(id INTEGER PRIMARY KEY,title TEXT,deadline TIMESTAMPTZ,semester_no INTEGER,semester TEXT,cohort_id TEXT,audience_scope TEXT);
   CREATE TABLE files(id INTEGER PRIMARY KEY,title TEXT,originalName TEXT,storedName TEXT,subject TEXT,chapter TEXT,semester TEXT,semester_no INTEGER,cohort_id TEXT,audience_scope TEXT);
   CREATE TABLE routine(id INTEGER PRIMARY KEY,semester INTEGER);
  `);await applyKnowledgeMigration(c);
  const start=performance.now();
  for(const f of files){
   // Academic text/metadata are real; test visibility is deliberately universal.
   const sem=require('../lib/academic-context').parseSemesterNumber(f.semester);
   await c.query('INSERT INTO files VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,\'all_students\')',[f.id,f.title,f.originalName,f.storedName,f.subject,f.chapter,f.semester,sem]);
   await c.query('INSERT INTO note_search_documents(id,content,extraction_status,indexed_at) VALUES($1,$2,\'indexed\',$3)',[f.id,f.extracted_content,f.extraction_indexed_at]);
   const row=(await c.query('SELECT f.*, d.content AS extracted_content,d.indexed_at AS extraction_indexed_at FROM files f JOIN note_search_documents d ON d.id=f.id WHERE f.id=$1',[f.id])).rows[0];
   await persistKnowledgeResource(c,buildNoteKnowledge(row),{keywordOnly:true});
  }
  const indexingMs=performance.now()-start;
  process.env.KYANA_KNOWLEDGE_V3='true';process.env.KYANA_KNOWLEDGE_V3_USERS='evaluator';
  const results=[];
  for(const f of files){const t=performance.now();const rows=await searchKnowledge(c,{authenticated:true,studentId:'evaluator',role:'admin'},f.title,{searchMode:'keyword_only',limit:5});results.push({id:f.id,rank:rows.findIndex(r=>r.id===`note:${f.id}`)+1,count:rows.length,ms:performance.now()-t});}
  const report={source:'60 actual local note titles; extraction rerun locally in disposable index; test authorization scope is synthetic; no external API calls',extraction,queries:files.length,recallAt5:results.filter(r=>r.rank>0).length/files.length,precisionAt5:results.filter(r=>r.rank>0).length/(files.length*5),mrr:results.reduce((s,r)=>s+(r.rank?1/r.rank:0),0)/files.length,meanSearchMs:results.reduce((s,r)=>s+r.ms,0)/files.length,indexingMs,resourcesPerSecond:files.length/indexingMs*1000,failures:results.filter(r=>!r.rank)};
  fs.writeFileSync('scratch/kyana-hardening/actual-notes.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await c.query(`DROP SCHEMA ${schema} CASCADE`);await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
