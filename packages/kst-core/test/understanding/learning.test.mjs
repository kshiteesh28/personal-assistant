import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLearningService } from '../../src/understanding/learning.mjs';
import { LearningStore } from '../../src/understanding/storage.mjs';
import { encodeFeatures,extractFeatures,decodeFeatures } from '../../src/understanding/features.mjs';

function fixture(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'kst-learning-')),db=new DatabaseSync(join(dir,'kst.sqlite'));let now=1_800_000_000_000;
  const candidate={confirmed:true,label:1,features:encodeFeatures(extractFeatures('add task <title>')),maskedTemplate:'add task <title>',groupFingerprint:'add task',contextRevision:2};
  const service=createLearningService({profileDir:dir,operationalDb:db,mode:'active',resolveFeedbackCandidate:(id,rev)=>id==='target-request'&&rev===2?candidate:null,clock:()=>now,modelApi:{decodeFeatures},...options});
  t.after(async()=>{await service.close();db.close();rmSync(dir,{recursive:true,force:true});});
  return {service,db,dir,candidate,advance:n=>now+=n};
}
const feedback=(id='feedback-0001')=>({requestId:id,targetRequestId:'target-request',contextRevision:2,decision:'confirm-intent'});

test('separate bounded SQLite uses exact three tables and privacy bootstrap',t=>{
  const {service}=fixture(t);assert.equal(service.status().failure,null);const db=service.store.db;
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');assert.equal(db.prepare('PRAGMA page_size').get().page_size,4096);assert.equal(db.prepare('PRAGMA max_page_count').get().max_page_count,32);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(x=>x.name),['control','examples','preferences']);assert.equal(service.privacyGeneration(),1);
});
test('explicit feedback deduplicates and replay cannot change payload',t=>{
  const {service}=fixture(t),body=feedback();const a=service.feedback(body);assert.equal(a.retained,true);assert.deepEqual(service.feedback(body),a);assert.equal(service.status().bytes.examples,1);
  assert.equal(service.feedback(feedback('feedback-0002')).duplicate,true);
  assert.throws(()=>service.feedback({...body,contextRevision:3}),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.throws(()=>service.feedback({...feedback('feedback-0003'),contextRevision:3}),e=>e.code==='FEEDBACK_EXPIRED');
});
test('shadow and paused learning retain no evidence',t=>{
  const {service}=fixture(t,{mode:'shadow'});assert.throws(()=>service.feedback(feedback()),e=>e.code==='LEARNING_NOT_ACTIVE');assert.equal(service.store.counts().examples,0);
  service.mode='active';service.settings({requestId:'settings-0001',expectedRevision:1,learningEnabled:false});assert.throws(()=>service.feedback(feedback('feedback-0002')),e=>e.code==='LEARNING_PAUSED');assert.equal(service.store.counts().examples,0);
});
test('feedback cannot execute and unconfirmed correction is not a positive label',t=>{
  const {service,candidate}=fixture(t);candidate.confirmed=false;assert.throws(()=>service.feedback(feedback()),e=>e.code==='INTERPRETATION_UNCONFIRMED');candidate.confirmed=true;
  assert.throws(()=>service.feedback({...feedback('feedback-0002'),decision:'correct-intent',correctedIntent:6}),e=>e.code==='INTERPRETATION_UNCONFIRMED');assert.equal(service.store.counts().examples,0);
});
test('remember requires preview and forget deletes corresponding evidence with generation barrier',t=>{
  const {service,candidate,db}=fixture(t);candidate.template={v:1,prefix:['add','task'],suffix:[],slot:'title',intent:1};
  assert.throws(()=>service.remember({requestId:'remember-0001',targetRequestId:'target-request',contextRevision:2}),e=>e.code==='TEMPLATE_PREVIEW_REQUIRED');candidate.templatePreviewConfirmed=true;
  const result=service.remember({requestId:'remember-0002',targetRequestId:'target-request',contextRevision:2});assert.equal(service.preferences().items.length,1);
  const forgotten=service.forget({requestId:'forget-0001',preferenceId:result.preferenceId});assert.equal(forgotten.privacyGeneration,2);assert.equal(service.preferences().items.length,0);assert.equal(service.store.counts().examples,0);assert.equal(db.prepare('SELECT pending FROM understanding_privacy').get().pending,null);
  assert.deepEqual(service.forget({requestId:'forget-0001',preferenceId:result.preferenceId}),forgotten);
});
test('reset replay cannot erase feedback retained after reset and consumed token is rejected',t=>{
  const {service}=fixture(t);service.feedback(feedback());const prepared=service.prepareReset({requestId:'reset-prepare1'}),body={requestId:'reset-confirm1',resetToken:prepared.resetToken};const result=service.confirmReset(body);assert.equal(service.store.counts().examples,0);
  service.feedback(feedback('feedback-0002'));assert.equal(service.store.counts().examples,1);assert.deepEqual(service.confirmReset(body),result);assert.equal(service.store.counts().examples,1);
  assert.throws(()=>service.confirmReset({...body,requestId:'reset-confirm2'}),e=>e.code==='RESET_EXPIRED');
});
test('runtime reporter freshness, competing reporters and wake cancellation',t=>{
  const {service,advance}=fixture(t);const heartbeat={clientInstanceId:'native-instance1',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:70,lowPowerMode:false,thermalState:'nominal'};
  assert.equal(service.eligible(),'ACTIVITY_STALE');assert.equal(service.runtimeState(heartbeat).accepted,true);assert.equal(service.eligible(),null);assert.equal(service.runtimeState(heartbeat).accepted,false);
  assert.equal(service.runtimeState({...heartbeat,clientInstanceId:'native-instance2'}).conflict,true);assert.equal(service.eligible(),'ACTIVITY_STALE');
  advance(31000);assert.equal(service.runtimeState({...heartbeat,clientInstanceId:'native-instance2'}).accepted,true);Atomics.store(service.cancelFlag,0,0);service.runtimeState({...heartbeat,clientInstanceId:'native-instance2',sequence:2,voiceState:'discussion'});assert.equal(Atomics.load(service.cancelFlag,0),1);assert.equal(service.eligible(),'WORK_ACTIVE');
});
test('unsafe model directory symlink is rejected without touching target',t=>{
  const root=mkdtempSync(join(tmpdir(),'kst-learning-unsafe-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'target'));mkdirSync(join(root,'understanding'));symlinkSync(join(root,'target'),join(root,'understanding','models'));assert.throws(()=>new LearningStore(root),e=>e.code==='LEARNING_STORAGE_UNSAFE');
});
test('operational receipt IDs cannot cross conversation and learning endpoints',t=>{
  const {service,db}=fixture(t);db.exec('CREATE TABLE understanding_requests(request_id TEXT PRIMARY KEY)');db.prepare('INSERT INTO understanding_requests VALUES(?)').run('settings-0001');assert.throws(()=>service.settings({requestId:'settings-0001',expectedRevision:1,learningEnabled:false}),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(service.settingsValue().learningEnabled,true);
});

test('promotion disk-full leaves seed pointer and existing evidence intact',async t=>{
  const { decodeModel,encodeModel }=await import('../../src/understanding/model.mjs');const {readFileSync}=await import('node:fs');
  const seed=decodeModel(readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url)));
  const {service}=fixture(t,{modelApi:{decodeFeatures,decodeModel}});service.feedback(feedback());Atomics.store(service.cancelFlag,0,0);
  const snapshot={datasetRevision:service.store.get('dataset-revision'),privacyGeneration:service.privacyGeneration()},bytes=encodeModel({...seed,...snapshot,modelVersion:1});
  service.store.writeModel=()=>{const e=new Error('Disk full');e.code='ENOSPC';throw e;};assert.throws(()=>service.promoteCandidate({bytes,version:1,snapshot}),e=>e.code==='ENOSPC');assert.equal(service.status().activeVersion,0);assert.equal(service.store.counts().examples,1);
});
test('privacy barrier during candidate write prevents stale pointer commit',async t=>{
  const { decodeModel,encodeModel }=await import('../../src/understanding/model.mjs');const {readFileSync,readdirSync}=await import('node:fs');
  const seed=decodeModel(readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url))),{service}=fixture(t,{modelApi:{decodeFeatures,decodeModel}});
  Atomics.store(service.cancelFlag,0,0);const snapshot={datasetRevision:0,privacyGeneration:1},bytes=encodeModel({...seed,...snapshot,modelVersion:1}),write=service.store.writeModel.bind(service.store);
  service.store.writeModel=(...args)=>{write(...args);service.privacyBarrier('privacy-during-write',{kind:'reset'});};
  assert.throws(()=>service.promoteCandidate({bytes,version:1,snapshot}),e=>e.code==='TRAINING_CANCELLED');assert.equal(service.privacyGeneration(),2);assert.equal(service.status().activeVersion,0);assert.deepEqual(readdirSync(service.store.models),[]);
});
test('stale personal model cannot be loaded across authoritative privacy generation',async t=>{
  const { decodeModel,encodeModel }=await import('../../src/understanding/model.mjs');const {readFileSync}=await import('node:fs');
  const seed=decodeModel(readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url))),{service,db}=fixture(t,{modelApi:{decodeFeatures,decodeModel}});
  const stale=encodeModel({...seed,modelVersion:1,datasetRevision:0,privacyGeneration:1});service.store.writeModel(1,stale);service.store.transaction(()=>service.store.set('active',1));
  db.prepare('UPDATE understanding_privacy SET generation=2').run();service.loadActive();assert.equal(service.activeModel,null);assert.equal(service.status().activeVersion,0);
});
test('T30 armed worker honors actual packaged corpus coverage and never promotes incomplete data',async t=>{
  const { decodeModel }=await import('../../src/understanding/model.mjs');const {service}=fixture(t,{modelApi:{decodeFeatures,decodeModel,runtime:'js-fallback'}});
  service.runtimeState({clientInstanceId:'native-worker-test',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:80,lowPowerMode:false,thermalState:'nominal'});
  service.train({requestId:'train-worker-0001'});await service.tick();
  const {decodeReplay}=await import('../../src/understanding/replay.mjs'),{readFileSync}=await import('node:fs');const corpus=decodeReplay(readFileSync(new URL('../../resources/understanding/seed-replay.bin',import.meta.url))),counts=Array(27).fill(0),gates=Array(27).fill(0);for(const r of corpus){if(r.partition===0)counts[r.label]++;if(r.partition===1)gates[r.label]++;}const complete=counts.every((n,i)=>n>=(i?40:80))&&gates.every((n,i)=>n>=(i?10:64))&&corpus.filter(r=>r.partition===2).length>=192;const status=service.status();assert.equal(status.trainingState,'idle');if(complete)assert.ok(['NO_CHANGE','PROMOTED'].includes(status.training.state),JSON.stringify(status.training));else assert.equal(status.training.state,'CORPUS_COVERAGE_INSUFFICIENT');if(status.training.state!=='PROMOTED')assert.equal(status.activeVersion,0);
});
test('privacy cancellation during live worker prevents personal promotion',async t=>{
  const { decodeModel }=await import('../../src/understanding/model.mjs');const {service}=fixture(t,{modelApi:{decodeFeatures,decodeModel,runtime:'js-fallback'}});
  service.runtimeState({clientInstanceId:'native-worker-cancel',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:80,lowPowerMode:false,thermalState:'nominal'});service.train({requestId:'train-worker-cancel'});
  const tick=service.tick();assert.ok(service.worker);service.privacyBarrier('worker-reset-0001',{kind:'reset'});await tick;assert.equal(service.status().activeVersion,0);assert.equal(service.privacyGeneration(),2);assert.ok(['TRAINING_CANCELLED','TRAINING_FAILED'].includes(service.status().training.state));
});

test('remembered phrase matches full command and preserves original variable text',t=>{
  const {service,candidate}=fixture(t);candidate.template={v:1,prefix:['put'],suffix:['on','my','radar'],slot:'title',intent:1};candidate.templatePreviewConfirmed=true;
  service.remember({requestId:'remember-match1',targetRequestId:'target-request',contextRevision:2});
  const match=service.matchPreference('Put Renew Passport on my radar.');assert.deepEqual(match.fields,{title:'Renew Passport'});assert.equal(match.intent,1);
  assert.equal(service.matchPreference('Please put Renew Passport on my radar'),null);assert.equal(service.matchPreference('Do not put Renew Passport on my radar'),null);assert.equal(service.matchPreference('Put on my radar'),null);
});
test('remembered templates preserve quotation punctuation inside captured slot',t=>{
  const {service,candidate}=fixture(t);candidate.label=18;candidate.template={v:1,prefix:['find'],suffix:['online'],slot:'query',intent:18};candidate.templatePreviewConfirmed=true;
  service.remember({requestId:'remember-query1',targetRequestId:'target-request',contextRevision:2});
  const match=service.matchPreference('Find Naruto: Episode #4 online');assert.equal(match.value,'Naruto: Episode #4');
});
test('conflicting personal templates require selection and never silently choose',t=>{
  const {service,candidate}=fixture(t);candidate.template={v:1,prefix:['put'],suffix:['on','my','radar'],slot:'title',intent:1};candidate.templatePreviewConfirmed=true;service.remember({requestId:'remember-match1',targetRequestId:'target-request',contextRevision:2});
  candidate.maskedTemplate='put <title> on radar';candidate.features=encodeFeatures(extractFeatures('put <title> on radar'));candidate.label=6;candidate.template={v:1,prefix:['put'],suffix:['on','my','radar'],slot:'title',intent:6};service.remember({requestId:'remember-match2',targetRequestId:'target-request',contextRevision:2});
  assert.equal(service.matchPreference('Put Passport on my radar').ambiguous,true);
});

test('a substituted SQLite journal symlink is rejected before SQLite opens it',t=>{
  const root=mkdtempSync(join(tmpdir(),'kst-learning-journal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'understanding'));mkdirSync(join(root,'understanding','models'));symlinkSync(join(root,'elsewhere'),join(root,'understanding','learning.sqlite-journal'));assert.throws(()=>new LearningStore(root),e=>e.code==='LEARNING_STORAGE_UNSAFE');
});

test('explicit remember confirms shown preview and receipt replay precedes expired candidate checks',t=>{
  const {service,candidate}=fixture(t);candidate.template={v:1,prefix:['add','task'],suffix:[],slot:'title',intent:1};candidate.previewShown=true;
  const body={requestId:'remember-preview1',targetRequestId:'target-request',contextRevision:2},result=service.remember(body);assert.equal(result.remembered,true);assert.equal(candidate.templatePreviewConfirmed,true);
  service.resolveCandidate=()=>null;assert.deepEqual(service.remember(body),result);
});

test('remembered preferences pin backing examples beyond ninety days while unpinned evidence expires',async t=>{
  const {service,candidate,advance}=fixture(t);candidate.template={v:1,prefix:['add','task'],suffix:[],slot:'title',intent:1};candidate.previewShown=true;
  const remembered=service.remember({requestId:'remember-retention1',targetRequestId:'target-request',contextRevision:2});
  candidate.maskedTemplate='put <title> on task list';candidate.features=encodeFeatures(extractFeatures(candidate.maskedTemplate));service.feedback(feedback('feedback-retention1'));
  assert.equal(service.store.counts().examples,2);advance(91*86400000);await service.tick();assert.equal(service.store.counts().examples,1);assert.equal(service.preferences().items[0].id,remembered.preferenceId);assert.equal(service.privacyGeneration(),2);
});

test('personal candidate preserves seed floors and disables unsafe automatic classes',async()=>{
  const {preserveAutomaticPolicy}=await import('../../src/understanding/training-policy.mjs');
  const policies=Array.from({length:32},(_,i)=>({scoreFloor:.5,marginFloor:.2,automaticEnabled:i===3})),seed={policies},candidate={policies:policies.map(p=>({...p,scoreFloor:0,marginFloor:0}))};
  const gates=Array.from({length:101},(_,i)=>({label:i<3?0:3,features:{}}));
  preserveAutomaticPolicy(candidate,seed,gates,()=>({top:[{label:3,score:1}],margin:.5}));
  assert.equal(candidate.policies[3].scoreFloor,.5);assert.equal(candidate.policies[3].marginFloor,.2);assert.equal(candidate.policies[3].automaticEnabled,false);
  const safe={policies:policies.map(p=>({...p}))};preserveAutomaticPolicy(safe,seed,gates.map(r=>({...r,label:3})),()=>({top:[{label:3,score:1}],margin:.5}));assert.equal(safe.policies[3].automaticEnabled,true);
});

test('T16 forgetting remembered preference while worker runs cancels obsolete generation',async t=>{
  const {decodeModel}=await import('../../src/understanding/model.mjs');const {service,candidate}=fixture(t,{modelApi:{decodeFeatures,decodeModel,runtime:'js-fallback'}});candidate.template={v:1,prefix:['add','task'],suffix:[],slot:'title',intent:1};candidate.previewShown=true;
  const remembered=service.remember({requestId:'remember-worker1',targetRequestId:'target-request',contextRevision:2});service.runtimeState({clientInstanceId:'native-forget-worker',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:80,lowPowerMode:false,thermalState:'nominal'});service.train({requestId:'train-forget-worker'});
  const tick=service.tick();assert.ok(service.worker);service.forget({requestId:'forget-live-worker',preferenceId:remembered.preferenceId});await tick;assert.equal(service.status().activeVersion,0);assert.equal(service.privacyGeneration(),2);assert.equal(service.preferences().items.length,0);assert.equal(service.status().training.state,'TRAINING_CANCELLED');
});
test('T17 expiry invalidates active and rollback models containing forgotten evidence',async t=>{
  const {decodeModel,encodeModel}=await import('../../src/understanding/model.mjs');const {readFileSync,readdirSync}=await import('node:fs');const {service,advance}=fixture(t,{modelApi:{decodeFeatures,decodeModel}});service.feedback(feedback());
  const seed=decodeModel(readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url)));for(const version of [1,2])service.store.writeModel(version,encodeModel({...seed,modelVersion:version,privacyGeneration:1,datasetRevision:1}));service.store.transaction(()=>{service.store.set('active',2);service.store.set('previous',1);});service.loadActive();assert.equal(service.status().activeVersion,2);
  advance(91*86400000);await service.tick();assert.equal(service.status().activeVersion,0);assert.deepEqual(readdirSync(service.store.models),[]);assert.throws(()=>service.rollback({requestId:'rollback-expired1',expectedModelVersion:0}),e=>e.code==='NO_PREVIOUS_MODEL');
});
test('T20 wake heartbeat during armed training cancels worker without waiting for audio',async t=>{
  const {decodeModel}=await import('../../src/understanding/model.mjs');const {service}=fixture(t,{modelApi:{decodeFeatures,decodeModel,runtime:'js-fallback'}});const heartbeat={clientInstanceId:'native-wake-worker',sequence:1,voiceState:'armed',ttsActive:false,idleSeconds:80,lowPowerMode:false,thermalState:'nominal'};service.runtimeState(heartbeat);service.train({requestId:'train-wake-worker'});const tick=service.tick();assert.ok(service.worker);const accepted=service.runtimeState({...heartbeat,sequence:2,voiceState:'discussion'});assert.equal(accepted.accepted,true);assert.equal(Atomics.load(service.cancelFlag,0),1);await tick;assert.equal(service.status().training.state,'TRAINING_CANCELLED');assert.equal(service.status().activeVersion,0);
});
