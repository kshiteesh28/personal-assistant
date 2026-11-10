import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync,copyFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';import {resolve,dirname,join,relative} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const output=join(root,'packages/kst-core/resources/google/release');mkdirSync(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function walk(path){if(!existsSync(path))return [];return readdirSync(path,{withFileTypes:true}).flatMap(d=>d.isSymbolicLink()?[]:d.isDirectory()?walk(join(path,d.name)):[join(path,d.name)]);}
const sources=[...['apps/macos/Sources','apps/macos/Tests','packages/kst-core/src','packages/kst-core/test','packages/kst-web'].flatMap(d=>walk(join(root,d))),...['apps/macos/Info.plist','apps/macos/Package.swift','apps/macos/build-app.sh','package.json','packages/kst-core/package.json','scripts/kst-release-06.mjs','KST-0.6-GOOGLE-SYNC-AND-DICTATION-PLAN.md','packages/kst-core/resources/understanding/seed-v1.bin','packages/kst-core/resources/understanding/seed-replay.bin','packages/kst-core/resources/understanding/seed-manifest.json','packages/kst-core/resources/google/dependency-manifest.json'].map(f=>join(root,f))].filter(f=>/\.(swift|mjs|js|html|css|plist|json|sh|md|bin)$/.test(f)&&!f.includes('/node_modules/')&&!f.includes('/test/understanding/learning-release-report.json')).sort();
const hash=createHash('sha256');for(const file of sources)hash.update(relative(root,file)+'\n'+sha(readFileSync(file))+'\n');const sourceSHA256=hash.digest('hex');
const args=process.argv.slice(2);function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
if(args.includes('--record')){
 const evidence=join(output,'evidence');mkdirSync(evidence,{recursive:true});
 const checks=[];
 for(const [name,flag]of [['core','--core-log'],['web','--web-log'],['native','--native-log'],['build','--build-log']]){
  const path=option(flag);if(!path||!existsSync(path)){checks.push({name,status:'NOT_RUN'});continue;}
  const log=readFileSync(path,'utf8');const destination=join(evidence,name+'.log');copyFileSync(path,destination);
  if(name==='core'||name==='web'){
   const last=re=>[...log.matchAll(re)].at(-1)?.[1];const tests=Number(last(/^# tests (\d+)$/gm)),passed=Number(last(/^# pass (\d+)$/gm)),failed=Number(last(/^# fail (\d+)$/gm));
   const failures=[...log.matchAll(/^not ok .*$/gm)].map(m=>m[0]);
   const environmentBlocked=name==='core'&&log.includes('listen EPERM: operation not permitted 127.0.0.1');
   checks.push({name,status:tests>0&&failed===0?'PASSED':environmentBlocked?'BLOCKED':'FAILED',tests,passed,failed,failures,limitation:environmentBlocked?'The execution sandbox denies local TCP listen; the existing HTTP listener integration test cannot run here.':undefined,log:relative(root,destination),logSHA256:sha(log)});
  }else checks.push({name,status:(name==='native'?log.includes('Native invariant checks passed'):log.includes('Built ')&&log.includes('kst.app'))?'PASSED':'FAILED',log:relative(root,destination),logSHA256:sha(log)});
 }
 writeFileSync(join(output,'automated-checks.json'),JSON.stringify({schemaVersion:1,sourceSHA256,recordedAt:new Date().toISOString(),checks},null,2)+'\n');
}
let automated;try{automated=JSON.parse(readFileSync(join(output,'automated-checks.json')));}catch{}
let dependencies;try{dependencies=JSON.parse(readFileSync(join(root,'packages/kst-core/resources/google/dependency-manifest.json')));}catch{}
const cases=Array.from({length:44},(_,i)=>'G'+String(i+1).padStart(2,'0')).concat(Array.from({length:39},(_,i)=>'D'+String(i+1).padStart(2,'0')));
let caseEvidence=[];try{caseEvidence=JSON.parse(readFileSync(join(output,'case-evidence.json'))).cases;}catch{}
const missingCases=cases.filter(id=>!caseEvidence.some(c=>c.id===id&&c.status==='PASSED'&&c.sourceSHA256===sourceSHA256&&c.expected&&c.observed&&c.artifactSHA256));
const tasks=Array.from({length:16},(_,i)=>'R'+String(i+1).padStart(2,'0'));const taskReports=tasks.map(id=>{try{return JSON.parse(readFileSync(join(output,'tasks',id+'.json')));}catch{return {taskId:id,status:'NOT_STARTED'};}});
const artifact=join(root,'apps/macos/build/kst.app/Contents/MacOS/kst');
const reasons=[];
if(automated?.sourceSHA256!==sourceSHA256)reasons.push('Automated evidence is missing or stale for this source.');
for(const name of ['core','web','native','build'])if(!automated?.checks?.some(c=>c.name===name&&c.status==='PASSED'))reasons.push(`${name} checks are not all passed.`);
if(!dependencies?.installed||!dependencies.auditPassed||dependencies.required.some(d=>!d.exactVersion||!d.integrity))reasons.push('Exact audited MIME dependencies are not installed/locked.');
if(missingCases.length)reasons.push(`${missingCases.length}/83 full acceptance cases need source-bound evidence (deterministic unit tests alone do not establish live acceptance).`);
const pendingTasks=taskReports.filter(r=>r.status!=='PASSED'||r.sourceSHA256!==sourceSHA256).map(r=>r.taskId);if(pendingTasks.length)reasons.push('Incomplete release task gates: '+pendingTasks.join(', '));
if(!existsSync(artifact))reasons.push('Built native app is missing.');
const report={schemaVersion:1,version:'0.6.0-preview.1',sourceSHA256,checkedAt:new Date().toISOString(),releaseReady:reasons.length===0,requiredCases:83,missingCases,pendingTasks,reasons,automatedChecks:automated?.checks??[],artifact:existsSync(artifact)?{path:relative(root,artifact),sha256:sha(readFileSync(artifact))}:null};
writeFileSync(join(output,'readiness.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version:report.version,sourceSHA256,releaseReady:report.releaseReady,reasons},null,2));if(!report.releaseReady)process.exitCode=2;
