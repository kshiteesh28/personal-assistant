import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{validateReleaseReadiness,sourceFingerprint,sha256,RELEASE_GATE_IDS}from'../../src/understanding/release.mjs';
test('release activation requires complete named evidence bound to source, seed and unchanged reports',t=>{
 const dir=mkdtempSync(join(tmpdir(),'kst-release-proof-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const seed=Buffer.from('fixture-seed'),artifact=Buffer.from('{"passed":true}');writeFileSync(join(dir,'fixture-report.json'),artifact);
 const proof={schemaVersion:2,activeReleaseApproved:true,seedSHA256:sha256(seed),sourceSHA256:sourceFingerprint(),gates:RELEASE_GATE_IDS.map(id=>({id,passed:true})),evidence:[{file:'fixture-report.json',sha256:sha256(artifact)}]};
 const save=value=>writeFileSync(join(dir,'release-readiness.json'),JSON.stringify(value));save(proof);assert.equal(validateReleaseReadiness(dir,seed),true);
 save({...proof,gates:Array(11).fill({id:'performance',passed:true})});assert.equal(validateReleaseReadiness(dir,seed),false);
 save({...proof,sourceSHA256:'0'.repeat(64)});assert.equal(validateReleaseReadiness(dir,seed),false);
 save(proof);assert.equal(validateReleaseReadiness(dir,Buffer.from('changed-seed')),false);
 writeFileSync(join(dir,'fixture-report.json'),'{}');assert.equal(validateReleaseReadiness(dir,seed),false);
});
