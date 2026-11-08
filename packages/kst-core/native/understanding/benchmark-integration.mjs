import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,release} from 'node:os';
import {join} from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {Engine} from '../../src/engine.mjs';
import {Workspace} from '../../src/workspace.mjs';
import {createUnderstanding} from '../../src/understanding/runtime.mjs';
import {interpret} from '../../src/understanding/interpreter.mjs';
import {extractFeatures} from '../../src/understanding/features.mjs';
const dir=mkdtempSync(join(tmpdir(),'kst-integration-bench-'));
const engine=new Engine(join(dir,'kst.sqlite')),workspace=new Workspace({dataDir:dir});
const app=createUnderstanding({dataDir:dir,engine,workspace,mode:'shadow'});
try{
 const phrases=['show tasks','show calendar','plan my day','add task Review deployment','remind me to Stretch tomorrow at 3 pm','schedule meeting Design review tomorrow at 3 pm for 30 minutes',"don't cancel meeting Review",'note delete my tasks','help','status'];
 const runs=[];
 for(let run=0;run<5;run++){
  const samples=[];
  for(let i=0;i<10100;i++){
   const start=performance.now(),text=phrases[i%phrases.length];
   const parsed=interpret(text,{now:Date.parse('2030-01-02T12:00:00Z'),timezone:'America/Chicago'});
   extractFeatures(text);workspace.lookupEntity('tasks','Review deployment');
   if(i>=100)samples.push(performance.now()-start);
   if(!parsed)throw Error('No interpretation');
  }
  samples.sort((a,b)=>a-b);runs.push({p50Ms:samples[5000],p95Ms:samples[9500],p99Ms:samples[9900]});
 }
 // Synthetic isolated profile: exercise training infrastructure, never activate a user's profile.
 app.learning.mode='active';app.learning.runtimeState({clientInstanceId:'integration-benchmark',sequence:1,voiceState:'off',ttsActive:false,idleSeconds:120,lowPowerMode:false,thermalState:'nominal'});
 const delay=monitorEventLoopDelay({resolution:1});delay.enable();
 await new Promise(resolve=>setTimeout(resolve,20));
 app.learning.train({requestId:'integration-benchmark-train'});
 const start=performance.now();await app.learning.tick();
 await new Promise(resolve=>setTimeout(resolve,20));delay.disable();
 const status=app.learning.status();
 const report={schemaVersion:1,measuredAt:new Date().toISOString(),node:process.version,os:release(),arch:process.arch,runtime:status.runtime,
  extractionFeatureLookup:{warmup:100,requestsPerRun:10000,runs,worstP95Ms:Math.max(...runs.map(r=>r.p95Ms)),scope:'Pure extraction + features + authoritative entity lookup. Excludes coordinator receipt/dispatch; not full-interpretation release evidence.'},
  idleWorker:{elapsedMs:performance.now()-start,eventLoopP95Ms:delay.percentile(95)/1e6,state:status.trainingState,failure:status.failure,training:status.training},
  allocatedBytes:status.bytes,rssBytes:process.memoryUsage().rss,activeReleaseApproved:false};
 writeFileSync(new URL('../../resources/understanding/integration-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await app.close();workspace.close();engine.close();rmSync(dir,{force:true,recursive:true});}
ëŽ