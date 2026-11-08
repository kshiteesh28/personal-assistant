import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createLearningService} from '../../src/understanding/learning.mjs';
import {LearningStore,LEARNING_LIMITS} from '../../src/understanding/storage.mjs';
import {encodeFeatures,normalizeCounts,decodeFeatures} from '../../src/understanding/features.mjs';
import {decodeModel,encodeModel} from '../../src/understanding/model.mjs';

const seedBytes=readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url)),seed=decodeModel(seedBytes);
const resources=['seed-v1.bin','seed-replay.bin'].map(n=>fileURLToPath(new URL('../../resources/understanding/'+n,import.meta.url)));
const report={schemaVersion:1,scope:'temporary synthetic profiles only',runtime:process.version,platform:process.platform,architecture:process.arch,cases:[],budgets:{},remaining:['APFS snapshots and power-loss durability require hardware trials','Injected ENOSPC is deterministic fault simulation, not exhaustion of user filesystem']};
after(()=>{writeFileSync(new URL('./learning-release-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');writeFileSync(new URL('../../resources/understanding/storage-release-report.json',import.meta.url),JSON.stringify({schemaVersion:1,measured:true,totalTests:19,failedTests:Math.max(0,19-report.cases.length),passedTests:report.cases.length,caps:{examples:256,preferences:32,personalPayloadBytes:65536,steadyAllocatedBytes:786432,peakAllocatedBytes:1048576},steadyAllocatedBytes:report.budgets.steadyAllocatedBytes,peakAllocatedBytes:report.budgets.temporaryPeakAllocatedBytes,personalPayloadBytes:report.budgets.saturatedLogicalBytes,maxDataProfile:report.budgets.maximumDataProfile,cases:report.cases,limitations:report.remaining},null,2)+'\n');});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'kst-release-')),op=new DatabaseSync(join(dir,'kst.sqlite'));let service;
 const open=()=>service=createLearningService({profileDir:dir,operationalDb:op,mode:'active',modelApi:{decodeModel,decodeFeatures,runtime:'js-fallback'}});open();
 t.after(async()=>{try{await service.close();}catch{}op.close();rmSync(dir,{recursive:true,force:true});});return {dir,op,get service(){return service;},open};}
function bytesFor(version,generation=1,revision=0){return encodeModel({...seed,modelVersion:version,privacyGeneration:generation,datasetRevision:revision});}
function id(n){const b=Buffer.alloc(16);b.writeUInt32BE(n,12);return b;}
function featureBytes(n=8,large=false){const indices=Uint16Array.from(Array.from({length:n},(_,i)=>i===0?0:i+(large?128:0))),counts=new Int8Array(n).fill(1);return encodeFeatures({...normalizeCounts(indices,counts),counts});}
function insertExample(s,n,features){s.db.prepare('INSERT INTO examples VALUES(?,?,?,?,?,?)').run(id(n),n%27,0,id(n),1_800_000_000,features);}

for(const point of ['before-open','before-write','after-write','after-fsync','before-rename','after-rename','after-directory-fsync','before-pointer','during-pointer','after-pointer','after-publication'])test(`promotion fault ${point} preserves recoverable pointer`,async t=>{
 const f=fixture(t),s=f.service;Atomics.store(s.cancelFlag,0,0);s.promoteCandidate({bytes:bytesFor(1),version:1,snapshot:{datasetRevision:0,privacyGeneration:1}});
 const inject=name=>{if(name===point){const e=new Error('Injected full device');e.code='ENOSPC';throw e;}};s.store.checkpoint=inject;s.checkpoint=inject;
 assert.throws(()=>s.promoteCandidate({bytes:bytesFor(2),version:2,snapshot:{datasetRevision:0,privacyGeneration:1}}),e=>e.code==='ENOSPC');
 s.store.checkpoint=null;s.checkpoint=null;const pointer=s.store.get('active');assert.ok(pointer===1||pointer===2);decodeModel(s.store.readModel(pointer));
 await s.close();const recovered=f.open();assert.equal(recovered.status().failure,null);assert.equal(recovered.status().activeVersion,pointer);assert.deepEqual(readdirSync(recovered.store.models).sort(),[pointer,...(recovered.store.get('previous',0)?[recovered.store.get('previous')]:[])].sort((a,b)=>a-b).map(v=>`${v}.bin`).sort());
 report.cases.push({name:'promotion-'+point,passed:true,recoveredVersion:pointer});
});

test('maximum row caps and logical payload are enforced transactionally',t=>{
 const f=fixture(t),store=f.service.store;store.transaction(()=>{for(let n=1;n<=256;n++)insertExample(store,n,featureBytes());for(let n=1;n<=32;n++)store.db.prepare('INSERT INTO preferences VALUES(?,?,?,?,?)').run(id(n),id(n),n%27,1_800_000_000,Buffer.from(JSON.stringify({v:1,prefix:['remember',String(n)],suffix:[],slot:'title',intent:n%27})));});
 assert.equal(store.counts().examples,256);assert.equal(store.counts().preferences,32);
 assert.throws(()=>store.transaction(()=>insertExample(store,257,featureBytes())),e=>e.code==='LEARNING_FULL');assert.equal(store.counts().examples,256);
 assert.throws(()=>store.transaction(()=>store.db.prepare('INSERT INTO preferences VALUES(?,?,?,?,?)').run(id(33),id(33),6,1_800_000_000,Buffer.from('{}'))),e=>e.code==='LEARNING_FULL');
 report.budgets.maximumRows=store.counts();report.cases.push({name:'row-caps-256-32',passed:true});
});

test('64KiB logical cap and allocated steady/temporary budgets include journal and candidate',t=>{
 const f=fixture(t),store=f.service.store;
 const featureOfLength=size=>{for(let count=1;count<=128;count++)for(const large of [false,true]){const bytes=featureBytes(count,large);if(bytes.length===size)return bytes;}return null;};
 store.transaction(()=>{
  for(let n=1;n<=256;n++)insertExample(store,n,featureBytes(1));
  for(let n=1;n<=32;n++)store.db.prepare('INSERT INTO preferences VALUES(?,?,?,?,?)').run(id(n),id(n),n%27,1_800_000_000,Buffer.from(JSON.stringify({v:1,prefix:['remember',String(n)],suffix:[],slot:'title',intent:n%27})));
  for(let n=1;n<=256;n++){
   let room=65536-store.counts().payloadBytes;if(!room)break;
   if(room===1){store.db.prepare('UPDATE examples SET features=? WHERE id=?').run(featureOfLength(258),id(1));room++;}
   const target=Math.min(259,room+5),bytes=featureOfLength(target);if(bytes)store.db.prepare('UPDATE examples SET features=? WHERE id=?').run(bytes,id(n));
  }
 });
 report.budgets.maximumDataProfile=store.counts();assert.equal(store.counts().examples,256);assert.equal(store.counts().preferences,32);
 const logical=store.counts().payloadBytes;assert.ok(logical===65536);assert.throws(()=>store.transaction(()=>store.db.prepare('UPDATE examples SET features=? WHERE id=?').run(featureBytes(128),id(256))),e=>e.code==='LEARNING_FULL');
 for(const v of [1,2])store.writeModel(v,bytesFor(v),resources);
 const steady=store.accounting(resources);assert.ok(steady.allocatedBytes<=LEARNING_LIMITS.steady);assert.ok(steady.databaseBytes<=LEARNING_LIMITS.database);
 let peak=steady.allocatedBytes;store.checkpoint=point=>{if(point==='after-write'){peak=Math.max(peak,store.accounting(resources).allocatedBytes);store.transaction(()=>{store.db.exec('UPDATE examples SET created_s=created_s+1; UPDATE preferences SET created_s=created_s+1;');peak=Math.max(peak,store.accounting(resources).allocatedBytes);});}};store.writeModel(3,bytesFor(3),resources);store.checkpoint=null;
 store.transaction(()=>{store.set('metrics',{faultBudgetProbe:'x'.repeat(3000)});peak=Math.max(peak,store.accounting(resources).allocatedBytes);});
 assert.ok(peak<=LEARNING_LIMITS.peak);store.cleanup([1,2]);report.budgets.saturatedLogicalBytes=logical;report.budgets.steadyAllocatedBytes=steady.allocatedBytes;report.budgets.temporaryPeakAllocatedBytes=peak;report.budgets.learningDatabaseBytes=steady.databaseBytes;
 report.cases.push({name:'logical-and-allocated-budget',passed:true});
});

test('corrupt learning store during forget commits operational privacy barrier and recovers conservatively',async t=>{
 const f=fixture(t),s=f.service;const candidate={confirmed:true,label:1,features:featureBytes(),maskedTemplate:'remember <title>',groupFingerprint:'remember',contextRevision:2,previewShown:true,template:{v:1,prefix:['remember'],suffix:[],slot:'title',intent:1}};s.resolveCandidate=()=>candidate;
 const remembered=s.remember({requestId:'remember-corrupt1',targetRequestId:'target-corrupt1',contextRevision:2});
 s.store.db.exec('DROP TABLE examples');assert.throws(()=>s.forget({requestId:'forget-corrupt1',preferenceId:remembered.preferenceId}),e=>e.code==='LEARNING_DELETE_INCOMPLETE');assert.equal(s.privacyGeneration(),2);assert.equal(s.activeModel,null);assert.ok(f.op.prepare('SELECT pending FROM understanding_privacy WHERE id=1').get().pending);
 await s.close();const recovered=f.open();assert.equal(recovered.privacyGeneration(),2);assert.equal(recovered.status().activeVersion,0);assert.equal(recovered.status().failure.code,'LEARNING_CORRUPT');
 report.cases.push({name:'corrupt-during-forget',passed:true,privacyGeneration:2});
});

test('rollback pauses promotion and a forgotten generation cannot be restored',t=>{
 const f=fixture(t),s=f.service;Atomics.store(s.cancelFlag,0,0);for(const version of [1,2])s.promoteCandidate({bytes:bytesFor(version),version,snapshot:{datasetRevision:0,privacyGeneration:1}});
 assert.equal(s.rollback({requestId:'rollback-release1',expectedModelVersion:2}).activeVersion,1);assert.equal(s.status().promotionPaused,true);
 s.privacyBarrier('forget-release1',{kind:'reset'});assert.equal(s.status().activeVersion,0);assert.throws(()=>s.rollback({requestId:'rollback-release2',expectedModelVersion:0}),e=>e.code==='NO_PREVIOUS_MODEL');assert.deepEqual(readdirSync(s.store.models),[]);report.cases.push({name:'rollback-privacy-generation',passed:true});
});

for(const point of ['after-write','after-rename','during-pointer','after-pointer'])test(`abrupt process exit at ${point} recovers durable model authority`,async t=>{
 const {spawnSync}=await import('node:child_process');const f=fixture(t),s=f.service;Atomics.store(s.cancelFlag,0,0);s.promoteCandidate({bytes:bytesFor(1),version:1,snapshot:{datasetRevision:0,privacyGeneration:1}});await s.close();
 const serviceURL=new URL('../../src/understanding/learning.mjs',import.meta.url).href,modelURL=new URL('../../src/understanding/model.mjs',import.meta.url).href,seedURL=new URL('../../resources/understanding/seed-v1.bin',import.meta.url).href;
 const child=`import{DatabaseSync}from'node:sqlite';import{readFileSync}from'node:fs';import{join}from'node:path';import{createLearningService}from${JSON.stringify(serviceURL)};import{decodeModel,encodeModel}from${JSON.stringify(modelURL)};const [dir,point]=process.argv.slice(1);const db=new DatabaseSync(join(dir,'kst.sqlite')),s=createLearningService({profileDir:dir,operationalDb:db,mode:'active',modelApi:{decodeModel}}),seed=decodeModel(readFileSync(new URL(${JSON.stringify(seedURL)})));const checkpoint=p=>{if(p===point)process.exit(73)};s.checkpoint=checkpoint;s.store.checkpoint=checkpoint;Atomics.store(s.cancelFlag,0,0);s.promoteCandidate({bytes:encodeModel({...seed,modelVersion:2,datasetRevision:0,privacyGeneration:1}),version:2,snapshot:{datasetRevision:0,privacyGeneration:1}});process.exit(74);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',child,f.dir,point],{encoding:'utf8',timeout:5000});assert.equal(result.status,73,result.stderr);
 const recovered=f.open(),expected=point==='after-pointer'?2:1;assert.equal(recovered.status().failure,null);assert.equal(recovered.status().activeVersion,expected);decodeModel(recovered.store.readModel(expected));assert.ok(readdirSync(recovered.store.models).every(n=>/^\d+\.bin$/.test(n)));report.cases.push({name:'abrupt-exit-'+point,passed:true,recoveredVersion:expected});
});
