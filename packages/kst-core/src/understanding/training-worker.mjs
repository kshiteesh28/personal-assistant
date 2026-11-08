import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { decodeModel, trainModel, predict, encodeModel } from './model.mjs';
import { decodeReplay } from './replay.mjs';
import { preserveAutomaticPolicy } from './training-policy.mjs';
import { decodeFeatures, encodeFeatures } from './features.mjs';

function fault(code,message=code){const e=new Error(message);e.code=code;throw e;}
try {
  const d=workerData,flag=new Int32Array(d.cancelBuffer),replay=decodeReplay(d.replay),seed=decodeModel(d.seed),active=decodeModel(d.active);
  if(Atomics.load(flag,0))fault('TRAINING_CANCELLED');
  const seedRecords=replay.filter(r=>r.partition===0),gates=replay.filter(r=>r.partition===1),critical=replay.filter(r=>r.partition===2);
  const counts=Array(27).fill(0),gateCounts=Array(27).fill(0);for(const r of seedRecords)counts[r.label]++;for(const r of gates)gateCounts[r.label]++;
  if(counts.some((n,i)=>n<(i===0?80:40))||gateCounts.some((n,i)=>n<(i===0?64:10))||critical.length<192)fault('CORPUS_COVERAGE_INSUFFICIENT');
  const corpusHash=createHash('sha256').update(Buffer.from(d.replay)).digest();if(!Buffer.from(seed.corpusHash).equals(corpusHash))fault('CORPUS_HASH_MISMATCH');
  const records=[...seedRecords,...d.personal.filter(r=>r.role===0).map(r=>({...r,personal:true,featureBuffer:Buffer.from(r.featureBuffer),id:Buffer.from(r.id)}))];
  const options={modelVersion:d.modelVersion,datasetRevision:d.datasetRevision,privacyGeneration:d.privacyGeneration,corpusHash,policies:seed.policies,deadlineMs:10000};
  let addon;try{if(d.preferNative)addon=createRequire(import.meta.url)(process.env.KST_UNDERSTANDING_ADDON_PATH??'../../native/understanding/build/understanding.node');}catch{}
  const trained=addon?addon.train(records.map(r=>({...r,featureBuffer:r.featureBuffer?Buffer.from(r.featureBuffer):encodeFeatures(r.features)})),{...options,policyBytes:Buffer.from(d.seed).subarray(131712)},flag):trainModel(records,{...options,cancelFlag:flag});
  if(Atomics.load(flag,0))fault('TRAINING_CANCELLED');
  const candidate=decodeModel(trained.bytes??trained),policy=preserveAutomaticPolicy(candidate,seed,gates),candidateCorrect=Array(27).fill(0),seedCorrect=Array(27).fill(0);let activeCorrect=0,changed=candidate.policies.reduce((n,p,i)=>n+(p.automaticEnabled!==active.policies[i].automaticEnabled?1:0),0);
  for(const r of gates){const a=predict(active,r.features).top[0].label,c=predict(candidate,r.features).top[0].label,s=predict(seed,r.features).top[0].label;if(c===r.label)candidateCorrect[r.label]++;if(s===r.label)seedCorrect[r.label]++;if(a===r.label)activeCorrect++;if(a!==c)changed++;}
  if(candidateCorrect.some((n,i)=>n<seedCorrect[i])||candidateCorrect.reduce((a,b)=>a+b,0)<activeCorrect)fault('CANDIDATE_GATE_REGRESSION');
  const personalGate=d.personal.filter(r=>r.role===1),groups=new Set(personalGate.map(r=>Buffer.from(r.groupId).toString('hex')));let improvements=0,personalCandidate=0,personalActive=0;
  for(const r of personalGate){const v=decodeFeatures(r.featureBuffer),a=predict(active,v).top[0].label,c=predict(candidate,v).top[0].label;if(a===r.label)personalActive++;if(c===r.label)personalCandidate++;if(c===r.label&&a!==r.label)improvements++;if(a!==c)changed++;}
  for(let label=0;label<27;label++){const rows=personalGate.filter(r=>r.label===label),labelGroups=new Set(rows.map(r=>Buffer.from(r.groupId).toString('hex')));if(labelGroups.size<5)continue;let a=0,c=0;for(const r of rows){const v=decodeFeatures(r.featureBuffer);if(predict(active,v).top[0].label===label)a++;if(predict(candidate,v).top[0].label===label)c++;}if(c<a)fault('PERSONAL_GATE_REGRESSION');}
  // Pure policy evaluation is required in addition to classification: features cannot verify negation or quotation behavior.
  let evaluate;try{({evaluateCriticalFixture:evaluate}=await import('./interpreter.mjs'));}catch{}
  if(typeof evaluate!=='function')fault('CRITICAL_EVALUATOR_UNAVAILABLE');
  for(const r of critical){if(Atomics.load(flag,0))fault('TRAINING_CANCELLED');const result=await evaluate(r.extra,candidate);if(result!==true&&result?.passed!==true)fault('CRITICAL_GATE_REGRESSION');}
  const metrics={gateCount:gates.length,gateCorrect:candidateCorrect.reduce((a,b)=>a+b,0),criticalCount:critical.length,personalGateCount:personalGate.length,personalCandidate,personalActive,disabledAutomaticClasses:policy.disabledClasses};
  if(!changed&&!improvements){parentPort.postMessage({ok:true,promote:false,reason:'NO_CHANGE',metrics});}
  else {parentPort.postMessage({ok:true,promote:true,bytes:encodeModel(candidate),metrics});}
} catch(e) {parentPort.postMessage({ok:false,code:e.code??(e.message==='TRAINING_CANCELLED'?'TRAINING_CANCELLED':'TRAINING_FAILED'),message:e.message.slice(0,200)});}
ëŽ