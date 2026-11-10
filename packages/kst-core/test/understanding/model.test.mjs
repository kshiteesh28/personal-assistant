import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extractFeatures,encodeFeatures,decodeFeatures,hashFeature } from '../../src/understanding/features.mjs';
import { decodeModel,trainModel,predict,createRuntime,PCG32 } from '../../src/understanding/model.mjs';
import { decodeReplay } from '../../src/understanding/replay.mjs';
const seed=readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url));
const corpus=readFileSync(new URL('../../resources/understanding/seed-replay.bin',import.meta.url));
test('hash, sparse codec, feature bounds and rejection vectors',()=>{assert.equal(hashFeature('hello'),1335831723);for(const text of ['schedule <title> at <date> for <duration>','don’t cancel my réunion','a '.repeat(80)]){const v=extractFeatures(text);assert.deepEqual(decodeFeatures(encodeFeatures(v)),{indices:v.indices,values:v.values,counts:v.counts});assert.ok(v.indices.length<=128);}assert.throws(()=>decodeFeatures(Buffer.from([1,1,0,128,0,1])));assert.throws(()=>decodeFeatures(Buffer.from([1,1,0,0,0])));});
test('PCG golden sequence and training determinism',()=>{const rng=new PCG32();assert.deepEqual(Array.from({length:6},()=>rng.next()),[0,210066564,1160386676,309281181,2968221517,3649497734]);const samples=[{label:1,features:extractFeatures('add task <title>')},{label:18,features:extractFeatures('search online for <query>')}];const a=trainModel(samples),b=trainModel(samples);assert.deepEqual(a.bytes,b.bytes);assert.equal(predict(a.model,samples[0].features).top[0].label,1);const cancel=new Int32Array(new SharedArrayBuffer(4));Atomics.store(cancel,0,1);assert.throws(()=>trainModel(samples,{cancelFlag:cancel}),/CANCELLED/);});
test('artifact corruption fails closed; packaged corpus verifies checksums and bounds',()=>{assert.equal(decodeModel(seed).bytes.length,132224);for(const offset of [0,8,152,156,512,640,131720]){const b=Buffer.from(seed);b[offset]^=1;assert.throws(()=>decodeModel(b));}const records=decodeReplay(corpus);assert.ok(records.length>1500);const broken=Buffer.concat([corpus,Buffer.from([0])]);assert.throws(()=>decodeReplay(broken));assert.equal(decodeModel(seed).policies.filter(x=>x.automaticEnabled).length,0);});
test('native scorer matches JS and rejects malformed arrays',t=>{const rt=createRuntime({bytes:seed});if(rt.runtime!=='native')return t.skip('Native addon unavailable');const js=decodeModel(seed);for(const text of ['what are my reminders','schedule <title> at <date> for <duration>','do not cancel anything']){const v=extractFeatures(text),a=rt.predict(v).scores,b=predict(js,v).scores;for(let c=0;c<27;c++)assert.ok(Math.abs(a[c]-b[c])<=1e-4);}const addon=createRequire(import.meta.url)('../../native/understanding/build/understanding.node');const handle=addon.loadModel(seed);assert.throws(()=>addon.predict(handle,new Uint16Array([0,0]),new Float32Array([.5,.5])));addon.dispose(handle);assert.throws(()=>addon.predict(handle,new Uint16Array([0]),new Float32Array([1])));rt.dispose();});
test('native PA training conforms to JS exported scores',t=>{let addon;try{addon=createRequire(import.meta.url)('../../native/understanding/build/understanding.node');}catch{return t.skip('Native addon unavailable');}const samples=[1,3,6,11,18,25].map((label,i)=>({label,features:extractFeatures(['add task <title>','list tasks','remind me <title> at <date>','schedule <title> at <date>','search for <query>','help'][i])}));const a=trainModel(samples),b=addon.train(samples.map(r=>({label:r.label,featureBuffer:encodeFeatures(r.features)})),{},new Int32Array(new SharedArrayBuffer(4)));const model=decodeModel(b.bytes);for(const r of samples){const x=predict(a.model,r.features),y=predict(model,r.features);assert.equal(x.top[0].label,y.top[0].label);for(let c=0;c<27;c++)assert.ok(Math.abs(x.scores[c]-y.scores[c])<=1e-4);} });

test('semantic artifact validation rejects malicious values even with valid checksums',async()=>{
 const {createHash}=await import('node:crypto');const {crc32}=await import('../../src/understanding/model.mjs');
 function repaired(edit){const b=Buffer.from(seed);edit(b);createHash('sha256').update(b.subarray(512)).digest().copy(b,56);b.writeUInt32LE(0,152);b.writeUInt32LE(crc32(b.subarray(0,512)),152);return b;}
 const edits=[b=>b.writeFloatLE(NaN,512),b=>b.writeFloatLE(0,512),b=>b.writeInt8(-128,640),b=>b.writeInt8(1,640+27*4096),b=>b.writeFloatLE(Infinity,131712),b=>{b[131720+16]=1;},b=>{b[131721]=1;},b=>{b[156]=1;},b=>b.writeBigUInt64LE(9007199254740992n,32)];
 let addon;try{addon=createRequire(import.meta.url)('../../native/understanding/build/understanding.node');}catch{}
 for(const edit of edits){const b=repaired(edit);assert.throws(()=>decodeModel(b));if(addon)assert.throws(()=>addon.loadModel(b));}
});
test('native and JS cancellation, deadline and option validation fail closed',t=>{
 const v=extractFeatures('add task <title>'),records=[{label:1,features:v}],flag=new Int32Array(new SharedArrayBuffer(4));
 Atomics.store(flag,0,1);assert.throws(()=>trainModel(records,{cancelFlag:flag}),/CANCELLED/);
 assert.throws(()=>trainModel(records,{deadlineMs:1e-10}),/CANCELLED/);assert.throws(()=>trainModel(records,{path:'/tmp/forbidden'}),/Unknown training option/);
 let addon;try{addon=createRequire(import.meta.url)('../../native/understanding/build/understanding.node');}catch{return t.skip('Native addon unavailable');}
 const nativeRecords=[{label:1,featureBuffer:encodeFeatures(v)}];assert.throws(()=>addon.train(nativeRecords,{},flag),/CANCELLED/);Atomics.store(flag,0,0);
 assert.throws(()=>addon.train(nativeRecords,{deadlineMs:1e-10},flag),/CANCELLED/);assert.throws(()=>addon.train(nativeRecords,{path:'/tmp/forbidden'},flag),/Unknown training option/);
 assert.throws(()=>addon.train([{label:1,featureBuffer:Buffer.from([1,1,0,0,0])}],{},flag));
});
test('replay rejects trailing deflate data, truncated records and oversized inflation',async()=>{
 const {deflateRawSync}=await import('node:zlib');const {createHash}=await import('node:crypto');
 const trailing=Buffer.concat([corpus,Buffer.from([0])]);trailing.writeUInt32LE(trailing.length-64,16);assert.throws(()=>decodeReplay(trailing),/trailing stream/);
 const header=Buffer.from(corpus.subarray(0,64)),raw=Buffer.alloc(1048577);const compressed=deflateRawSync(raw);header.writeUInt32LE(compressed.length,16);header.writeUInt32LE(1048576,20);createHash('sha256').update(raw).digest().copy(header,24);assert.throws(()=>decodeReplay(Buffer.concat([header,compressed])));
 const noRecords=Buffer.from(corpus);noRecords.writeUInt32LE(0,12);assert.throws(()=>decodeReplay(noRecords),/Trailing replay bytes/);
});

test('calibration requires independent split and insufficient evidence disables every automatic policy',async()=>{
 const {calibratePolicies}=await import('../../src/understanding/model-calibration.mjs');
 const model=decodeModel(seed);assert.throws(()=>calibratePolicies(model,[{partition:'train',label:3,features:extractFeatures('list my tasks')}]),/Calibration split/);
 const result=calibratePolicies(model,[{partition:'calibration',label:3,features:extractFeatures('list my tasks')}]);assert.equal(result.minimumOverallMet,false);assert.equal(result.policies.filter(p=>p.automaticEnabled).length,0);
});
