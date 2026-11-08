import {mkdtempSync,rmSync,writeFileSync,statSync,readFileSync} from 'node:fs';
import {tmpdir,release} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceFingerprint} from '../../src/understanding/release.mjs';
import {performance} from 'node:perf_hooks';
import {Engine} from '../../src/engine.mjs';
import {Workspace} from '../../src/workspace.mjs';
import {createUnderstanding} from '../../src/understanding/runtime.mjs';
const dir=mkdtempSync(join(tmpdir(),'kst-coordinator-bench-')),engine=new Engine(join(dir,'kst.sqlite')),workspace=new Workspace({dataDir:dir});
const app=createUnderstanding({dataDir:dir,engine,workspace,mode:'shadow'});
try {
 app.understanding.mode='active'; // Isolated benchmark only; no real profile activation.
 const texts=['show tasks','show notes','show reminders','show calendar','show timeline','help','status',"Don't cancel meeting Review",'schedule meeting Review tomorrow at 3 pm','remind me to Stretch'];
 const runs=[];
 for(let run=0;run<5;run++){
  const samples=[];
  for(let i=0;i<10100;i++){
   app.understanding.stop();
   const start=performance.now();const result=await app.understanding.handle({requestId:`bench-${run}-${String(i).padStart(8,'0')}`,conversationId:'benchmark',text:texts[i%texts.length],source:'typed'});
   if(!result.reply)throw Error('Missing verified response');
   if(i>=100)samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);runs.push({p50Ms:samples[5000],p95Ms:samples[9500],p99Ms:samples[9900]});
 }
 const report={schemaVersion:1,sourceSHA256:sourceFingerprint(),seedSHA256:createHash('sha256').update(readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url))).digest('hex'),measuredAt:new Date().toISOString(),node:process.version,os:release(),arch:process.arch,runtime:app.learning.status().runtime,warmup:100,requestsPerRun:10000,runs,worstP95Ms:Math.max(...runs.map(r=>r.p95Ms)),limitMs:25,fixtures:texts,scope:'Full coordinator acceptance, normalization, classifier boundary, policy, dialogue, authoritative read lookup, durable receipts and response. Includes bounded read/clarification/negative fixtures. Excludes microphone, TTS, external execution and mutation executor latency.',operationalLedgerBytes:statSync(join(dir,'kst.sqlite')).size,rssBytes:process.memoryUsage().rss};
 report.passed=report.worstP95Ms<=25;
 writeFileSync(new URL('../../resources/understanding/coordinator-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await app.close();workspace.close();engine.close();rmSync(dir,{recursive:true,force:true});}
