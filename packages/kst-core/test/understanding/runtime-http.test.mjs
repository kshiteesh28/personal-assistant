import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {Engine} from '../../src/engine.mjs';
import {Workspace} from '../../src/workspace.mjs';
import {createUnderstanding} from '../../src/understanding/runtime.mjs';
import {createRequestHandler} from '../../src/http.mjs';
function fixture(t,mode='shadow'){
 const dataDir=mkdtempSync(join(tmpdir(),'kst-adaptive-http-')),engine=new Engine(join(dataDir,'kst.sqlite')),workspace=new Workspace({dataDir});
 const adaptive=createUnderstanding({dataDir,engine,workspace,mode});
 t.after(async()=>{await adaptive.close();workspace.close();engine.close();rmSync(dataDir,{force:true,recursive:true});});
 const handler=createRequestHandler({engine,workspace,...adaptive,token:'test-token',port:4310,staticDir:'.'});
 return {...adaptive,dataDir,async call(path,body,method=body?'POST':'GET'){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:path,method,headers:{host:'localhost:4310',authorization:'Bearer test-token','content-type':'application/json'}});
  let status,data;await handler(req,{writeHead(code){status=code;},end(bytes){data=JSON.parse(String(bytes));}});return {status,data};
 }};
}
test('integrated shadow runtime scores without retention, settings persist and requests keep legacy behavior',async t=>{
 const f=fixture(t);
 const health=await f.call('/health');assert.equal(health.data.version,'0.6.0-preview.1');
 const status=await f.call('/api/understanding/status');assert.equal(status.status,200);assert.equal(status.data.mode,'shadow');assert.ok(['native','js-fallback'].includes(status.data.runtime));
 const result=await f.call('/api/conversation',{requestId:'http-shadow-task',text:'add task preserve legacy'});assert.equal(result.status,200);assert.match(result.data.reply,/preserve legacy/i);
 const feedback=await f.call('/api/understanding/feedback',{requestId:'http-feedback-01',targetRequestId:'http-shadow-task',contextRevision:0,decision:'confirm-intent'});assert.equal(feedback.status,409);
 const revision=status.data.revision;
 const settings=await f.call('/api/understanding/settings',{requestId:'http-settings-01',expectedRevision:revision,learningEnabled:false},'PATCH');assert.equal(settings.status,200);assert.equal(settings.data.learningEnabled,false);
 const invalid=await f.call('/api/conversation',{requestId:'http-invalid-01',text:'show tasks',contextRevision:-1});assert.equal(invalid.status,400);
 assert.ok(existsSync(join(f.dataDir,'understanding')));
});
test('active rollout request falls back to shadow while real release evidence is missing',async t=>{
 const f=fixture(t,'active');assert.equal(f.understanding.status().mode,'shadow');assert.equal(f.understanding.status().releaseReady,false);assert.match(f.understanding.status().activationReason,/blocked/);
});
test('runtime heartbeat schema and fresh reporter conflict cannot silently admit training',async t=>{
 const f=fixture(t);const body={clientInstanceId:'native-instance-one',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:90,lowPowerMode:false,thermalState:'nominal'};
 const accepted=await f.call('/api/understanding/runtime-state',body,'PATCH');assert.equal(accepted.status,200);
 const replay=await f.call('/api/understanding/runtime-state',body,'PATCH');assert.equal(replay.data.accepted,false);
 const bad=await f.call('/api/understanding/runtime-state',{...body,sequence:2,voiceState:'imaginary'},'PATCH');assert.equal(bad.status,400);
});
test('active integration binds confirmation, learns only explicit evidence and previews remembered expression',async t=>{
 const f=fixture(t); // Unit harness exercises the active protocol without altering production release gates.
 f.understanding.mode='active';f.learning.mode='active';
 const first=await f.call('/api/conversation',{requestId:'active-phrase-01',text:'create a task to Review deployment',conversationId:'active-discussion',source:'typed'});
 assert.equal(first.status,200);assert.equal(first.data.understanding.decision,'confirm');
 const stale=await f.call('/api/conversation',{requestId:'active-stale-001',text:'yes',conversationId:first.data.conversationId,contextRevision:0});assert.equal(stale.status,409);
 const yes=await f.call('/api/conversation',{requestId:'active-confirm-01',text:'yes',conversationId:first.data.conversationId,contextRevision:first.data.understanding.contextRevision});assert.equal(yes.status,200);assert.equal(yes.data.understanding.decision,'execute');
 const replay=await f.call('/api/conversation',{requestId:'active-confirm-01',text:'yes',conversationId:first.data.conversationId,contextRevision:first.data.understanding.contextRevision});assert.deepEqual(replay.data,yes.data);
 const candidate=f.understanding.feedbackCandidate('active-confirm-01',yes.data.understanding.contextRevision);assert.ok(candidate.maskedTemplate.includes('<title>'));assert.ok(!candidate.maskedTemplate.includes('Review deployment'));
 const target=`targetRequestId=active-confirm-01&contextRevision=${yes.data.understanding.contextRevision}`;
 const preview=await f.call(`/api/understanding/preview?${target}`);assert.equal(preview.status,200);assert.match(preview.data.preview,/<title>/);
 const remembered=await f.call('/api/understanding/remember',{requestId:'active-remember-01',targetRequestId:'active-confirm-01',contextRevision:yes.data.understanding.contextRevision});assert.equal(remembered.status,200);
 const preferences=await f.call('/api/understanding/preferences?limit=10');assert.equal(preferences.data.items.length,1);
 const conflict=await f.call('/api/conversation',{requestId:'active-remember-01',text:'show tasks'});assert.equal(conflict.status,409);
});

test('spoken possessive reads work in compatibility mode',async t=>{const f=fixture(t);const result=await f.call('/api/conversation',{requestId:'possessive-read-01',text:'Show my tasks',source:'voice'});assert.equal(result.status,200);assert.match(result.data.reply,/No tasks yet/i);});

test('user local preview activates actual ML without claiming completed release evidence',async t=>{
 const {writeFileSync}=await import('node:fs');const {sourceFingerprint}=await import('../../src/understanding/release.mjs');
 const dataDir=mkdtempSync(join(tmpdir(),'kst-preview-')),engine=new Engine(join(dataDir,'kst.sqlite')),workspace=new Workspace({dataDir});
 writeFileSync(join(dataDir,'understanding-activation.json'),JSON.stringify({schemaVersion:1,mode:'active',sourceSHA256:sourceFingerprint(),userRequestedPreview:true}),{mode:0o600});
 const app=createUnderstanding({dataDir,engine,workspace});t.after(async()=>{await app.close();workspace.close();engine.close();rmSync(dataDir,{recursive:true,force:true});});
 assert.equal(app.understanding.status().mode,'active');assert.equal(app.learning.status().mode,'active');assert.equal(app.understanding.status().releaseReady,false);assert.equal(app.understanding.status().activationKind,'user-preview');
 const first=await app.understanding.handle({requestId:'preview-task-001',text:'create a task to review activation',conversationId:'preview-discussion'});assert.equal(first.understanding.decision,'confirm');assert.equal(workspace.snapshot().tasks.length,0);
 const done=await app.understanding.handle({requestId:'preview-confirm-001',text:'yes',conversationId:first.conversationId,contextRevision:first.understanding.contextRevision});assert.equal(done.understanding.decision,'execute');assert.equal(workspace.snapshot().tasks.length,1);
});
