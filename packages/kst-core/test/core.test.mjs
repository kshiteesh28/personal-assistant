import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine} from '../src/engine.mjs';
import {startServer} from '../src/server.mjs';

function profile(t,clock=Date.now){const dir=mkdtempSync(join(tmpdir(),'kst-test-'));const path=join(dir,'state.sqlite');let engine=new Engine(path,clock);t.after(()=>{try{engine.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {dir,path,engine};}

test('duplicate request persists exactly one task across reconnection',t=>{
  const {engine,path}=profile(t);const first=engine.conversation('request-0001','add task review API');
  assert.deepEqual(engine.conversation('request-0001','add task review API'),first);
  assert.equal(engine.status().tasks.length,1);
  assert.throws(()=>engine.conversation('request-0001','add task destroy API'),/different command/);
  engine.close();const reopened=new Engine(path);t.after(()=>reopened.close());
  assert.deepEqual(reopened.conversation('request-0001','add task review API'),first);
  assert.equal(reopened.status().tasks.length,1);
});

test('settings revisions prevent lost changes; no empty wake phrase',t=>{
  const {engine}=profile(t);assert.throws(()=>engine.settings(1,'  '),/2–40/);
  assert.equal(engine.settings(1,'  hey kst  ').wakePhrase,'hey kst');
  assert.throws(()=>engine.settings(1,'jarvis'),/changed/);
  assert.equal(engine.status().settings.wakePhrase,'hey kst');
});

test('prototype-named request IDs cannot bypass or corrupt idempotency',t=>{
  const {engine}=profile(t);
  for(const requestId of ['__proto__','constructor','toString']) {
    const result=engine.conversation(requestId,'add task prototype test');
    assert.deepEqual(engine.conversation(requestId,'add task prototype test'),result);
    assert.throws(()=>engine.conversation(requestId,'add task changed'),/different command/);
  }
  assert.equal(engine.status().tasks.length,3);
});

test('approval is action specific, expires, and never dispatches a provider',t=>{
  let now=Date.parse('2026-11-06T15:00:00Z');const {engine}=profile(t,()=>now);
  const request=engine.conversation('external-0001','ask codex explain tests');
  assert.equal(request.approval.status,'pending');
  const accepted=engine.approval(request.approval.id,'approve',1);
  assert.equal(accepted.dispatched,false);assert.equal(accepted.approval.status,'approved');
  assert.equal(engine.status().jobs[0].status,'blocked');
  assert.throws(()=>engine.approval(request.approval.id,'approve',1),/changed/);
  const second=engine.conversation('external-0002','browse web new Apple API');now+=300001;
  assert.equal(engine.approval(second.approval.id,'approve',1).approval.status,'expired');
});

test('stop invalidates pending approvals; delayed worker cannot approve',t=>{
  const {engine}=profile(t);const {approval}=engine.conversation('external-0001','ask claude explain');
  const stopped=engine.stop('stop-0000001');
  assert.deepEqual(engine.stop('stop-0000001'),stopped);
  assert.throws(()=>engine.approval(approval.id,'approve',1),/changed/);
  assert.equal(engine.status().approvals[0].status,'denied');
});

test('restart quarantines interrupted work and expires approvals without replay',t=>{
  const {engine,path}=profile(t);engine.conversation('external-0001','ask chatgpt explain');engine.close();
  const db=new DatabaseSync(path),row=db.prepare('SELECT data FROM kst_state WHERE id=1').get(),state=JSON.parse(row.data);
  state.jobs.push({id:'crash-job',kind:'fixture',status:'running',message:'Fixture running job',createdAt:new Date().toISOString(),evidence:[]});
  db.prepare('UPDATE kst_state SET data=? WHERE id=1').run(JSON.stringify(state));db.close();
  const reopened=new Engine(path);t.after(()=>reopened.close());reopened.recover();
  assert.equal(reopened.status().jobs[0].status,'unknown');
  assert.equal(reopened.status().approvals[0].status,'expired');
  assert.match(reopened.status().jobs[0].message,/no automatic replay/);
});

test('unsafe commands are blocked with evidence rather than reported successful',t=>{
  const {engine}=profile(t);const result=engine.conversation('command-0001','run rm -rf /');
  assert.equal(result.job.status,'blocked');assert.deepEqual(result.job.evidence,[]);
  assert.match(result.reply,/disabled/);
});

test('nudges suppress locked/meeting/quiet and deduplicate across restart',t=>{
  const {engine,path}=profile(t);const now='2026-11-06T15:00:00Z',activity={activeMinutes:65,locked:false,inMeeting:false,quietHours:false};
  for(const k of ['locked','inMeeting','quietHours'])assert.deepEqual(engine.nudges(now,{...activity,[k]:true}).nudges,[]);
  const first=engine.nudges(now,activity);assert.equal(first.nudges.length,1);assert.equal(first.source,'fixture');
  assert.deepEqual(engine.nudges('2026-11-06T15:10:00Z',activity).nudges,[]);
  engine.close();const reopened=new Engine(path);t.after(()=>reopened.close());assert.deepEqual(reopened.nudges(now,activity).nudges,[]);
});

test('corrupt persisted state fails closed instead of resetting',t=>{
  const {engine,path}=profile(t);engine.close();const db=new DatabaseSync(path);
  db.prepare('UPDATE kst_state SET data=? WHERE id=1').run('{broken');db.close();assert.throws(()=>new Engine(path));
});

test('HTTP pairing, schemas, origin, static traversal, concurrency and shutdown',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kst-http-'));const token='a'.repeat(64);
  const app=startServer({dataDir:dir,port:0,token});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});await app.ready;
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const api=async(path,body,headers={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await api('/api/status',null,{Origin:'https://evil.example'})).status,403);
  assert.equal((await api('/api/status',null,{Host:'evil.example'})).status,403);
  assert.equal((await api('/api/conversation',{requestId:'request-0001',text:'hello',extra:'bad'})).status,400);
  assert.equal((await fetch(base+'/%2e%2e/package.json')).status,404);
  const body={requestId:'request-0002',text:'add task only once'};
  const [a,b]=await Promise.all([api('/api/conversation',body),api('/api/conversation',body)]);
  assert.equal(a.status,200);assert.deepEqual(await a.json(),await b.json());
  const status=await(await api('/api/status')).json();assert.equal(status.tasks.length,1);
  assert.throws(()=>startServer({dataDir:dir,port:0,token}),/profile is locked/);
});
