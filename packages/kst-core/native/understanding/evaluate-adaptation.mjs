import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import{join}from'node:path';import{createHash}from'node:crypto';import{DatabaseSync}from'node:sqlite';
import{developmentCorpus}from'./development-corpus.mjs';
import{createLearningService}from'../../src/understanding/learning.mjs';
import{createRuntime,decodeModel}from'../../src/understanding/model.mjs';
import{encodeFeatures,decodeFeatures}from'../../src/understanding/features.mjs';
import{INTENTS}from'../../src/understanding/registry.mjs';
const resources=new URL('../../resources/understanding/',import.meta.url),seed=readFileSync(new URL('seed-v1.bin',resources));
const rows=developmentCorpus(),stream=rows.filter(r=>r.partition==='calibration'),future=rows.filter(r=>r.partition==='test');
const dir=mkdtempSync(join(tmpdir(),'kst-adaptation-')),db=new DatabaseSync(join(dir,'kst.sqlite'));let now=1800000000000,sequence=0,runtime=createRuntime({bytes:seed}),candidate;
const service=createLearningService({profileDir:dir,operationalDb:db,mode:'active',clock:()=>now,resolveFeedbackCandidate:()=>candidate,modelApi:{runtime:runtime.runtime,decodeModel,decodeFeatures,labels:INTENTS},onModelChange:(_v,bytes)=>{runtime.dispose();runtime=createRuntime({bytes:bytes??seed});}});
try{
 const before=future.filter(r=>runtime.predict(r.features).top[0].label===r.label).length,events=[],attempts=[];let correct=0;
 for(let i=0;i<stream.length;i++){
  const row=stream[i],prediction=runtime.predict(row.features).top[0].label;if(prediction===row.label)correct++;
  // Expose the simulated explicit feedback only after predicting this turn.
  candidate={confirmed:true,label:row.label,features:encodeFeatures(row.features),maskedTemplate:row.masked,groupFingerprint:row.groupId.toString('hex'),contextRevision:1};
  service.feedback({requestId:`adapt-feedback-${i}`,targetRequestId:`adapt-target-${i}`,contextRevision:1,decision:'confirm-intent'});
  events.push({index:i,group:row.groupId.toString('hex'),prediction,expected:row.label,modelVersion:runtime.model.modelVersion});
  if((i+1)%10===0){now+=1800001;service.runtimeState({clientInstanceId:'adaptation-evaluator',sequence:++sequence,voiceState:'armed',ttsActive:false,idleSeconds:120,lowPowerMode:false,thermalState:'nominal'});service.train({requestId:`adapt-train-${i}`});await service.tick();attempts.push({...service.status().training});}
 }
 const after=future.filter(r=>runtime.predict(r.features).top[0].label===r.label).length;
 const report={schemaVersion:1,seedSHA256:createHash('sha256').update(seed).digest('hex'),measuredAt:new Date().toISOString(),passed:attempts.length>0&&attempts.every(a=>a.state&&a.state!=='training'),scope:'Synthetic chronological explicit-feedback stream through actual bounded learning service, idle scheduler, worker and promotion gates. Future release-test labels never supplied as feedback.',streamCases:stream.length,prequentialCorrect:correct,prequentialAccuracy:correct/stream.length,untouchedTest:{before,after,total:future.length,delta:after-before},attempts,events};
 writeFileSync(new URL('adaptation-report.json',resources),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,streamCases:stream.length,untouchedTest:report.untouchedTest,attempts:attempts.length},null,2));
}finally{await service.close();runtime.dispose();db.close();rmSync(dir,{recursive:true,force:true});}
