import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,lstatSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {RELEASE_GATE_IDS,sourceFingerprint,sha256} from '../../src/understanding/release.mjs';
const root=new URL('../../resources/understanding/',import.meta.url),evidence=[];
function load(name){try{const bytes=readFileSync(new URL(name,root));evidence.push({file:name,sha256:sha256(bytes)});return JSON.parse(bytes);}catch{return null;}}
if(process.argv.includes('--run-checks')){
 const repo=fileURLToPath(new URL('../../../../',import.meta.url));
 function run(args,cwd=repo){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024});return {passed:r.status===0,exitCode:r.status,tests:Number(r.stdout.match(/# tests (\d+)/)?.[1]??0),failures:[...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]),environmentFailure:r.stdout.includes('listen EPERM')};}
 const report={schemaVersion:1,sourceSHA256:sourceFingerprint(),measuredAt:new Date().toISOString(),core:run(['--test',...['packages/kst-core/test','packages/kst-core/test/understanding'].flatMap(dir=>readdirSync(join(repo,dir)).filter(n=>n.endsWith('.test.mjs')).map(n=>join(dir,n)))]),dashboard:run(['--test','app.test.mjs'],join(repo,'packages/kst-web'))};
 report.passed=report.core.passed&&report.dashboard.passed;
 writeFileSync(new URL('regression-report.json',root),JSON.stringify(report,null,2)+'\n');
}
const corpus=load('release-corpus-report.json'),storage=load('storage-release-report.json'),conformance=load('conformance-report.json'),bench=load('coordinator-benchmark.json'),kernel=load('evaluation-report.json'),integration=load('integration-benchmark.json'),regression=load('regression-report.json'),hardware=load('hardware-release-report.json'),adaptation=load('adaptation-report.json');
const seed=readFileSync(new URL('seed-v1.bin',root)),seedHash=sha256(seed),source=sourceFingerprint();
const checks={
 corpus:corpus?.countRequirementsMet===true&&corpus?.groupsDisjoint===true&&corpus?.seedSHA256===seedHash,
 accuracy:corpus?.test?.accuracy>=.95&&corpus?.fullActionEqualityPassed===true,
 'automatic-policy':corpus?.test?.automaticAccepted>=100&&corpus?.test?.automaticPrecision>=.98&&corpus?.test?.oosCount>=500&&corpus?.test?.oosActivationRate<=.02,
 conformance:conformance?.cases?.length===31&&conformance.cases.every(c=>c.passed===true)&&(conformance.failedTests===0||Array.isArray(conformance.failedTests)&&conformance.failedTests.length===0),
 adaptation:adaptation?.passed===true&&adaptation.seedSHA256===seedHash,
 'storage-privacy':storage?.measured===true&&storage.failedTests===0&&storage.steadyAllocatedBytes<=786432&&storage.peakAllocatedBytes<=1048576&&storage.maxDataProfile?.examples===256&&storage.maxDataProfile?.preferences===32&&storage.personalPayloadBytes===65536,
 'voice-parity':conformance?.typedVoiceParity===true&&hardware?.voiceParity===true,
 performance:bench?.passed===true&&bench?.requestsPerRun>=10000&&bench?.runs?.length===5&&kernel?.featureAndClassifierBenchmark?.passes===true&&integration?.idleWorker?.eventLoopP95Ms<=10,
 regressions:regression?.passed===true&&regression?.sourceSHA256===source,
 hardware:hardware?.passed===true&&hardware?.sourceSHA256===source&&hardware?.seedSHA256===seedHash,
 'classifier-comparison':kernel?.comparison?.fastText?.completed===true
};
const report={schemaVersion:2,measuredAt:new Date().toISOString(),seedSHA256:seedHash,sourceSHA256:source,evidence,gates:RELEASE_GATE_IDS.map(id=>({id,passed:checks[id]===true})),activeReleaseApproved:RELEASE_GATE_IDS.every(id=>checks[id]===true)};
writeFileSync(new URL('release-readiness.json',root),JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--activate')){
 if(!report.activeReleaseApproved){console.error('Activation refused: required release evidence is incomplete.');process.exitCode=1;}
 else{const pos=process.argv.indexOf('--data-dir');const dir=resolve(pos>=0?process.argv[pos+1]:join(homedir(),'Library/Application Support/kst-dev/core'));const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('Unsafe profile directory');const target=join(dir,'understanding-activation.json'),temp=target+'.tmp';writeFileSync(temp,JSON.stringify({schemaVersion:1,mode:'active',sourceSHA256:source}),{flag:'wx',mode:0o600});renameSync(temp,target);console.log('Active mode configured for next normal core start.');}
}
console.log(JSON.stringify({activeReleaseApproved:report.activeReleaseApproved,gates:report.gates},null,2));
