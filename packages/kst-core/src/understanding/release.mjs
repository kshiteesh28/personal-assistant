import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const RELEASE_GATE_IDS=Object.freeze(['corpus','accuracy','automatic-policy','conformance','adaptation','storage-privacy','voice-parity','performance','regressions','hardware','classifier-comparison']);
const core=dirname(dirname(fileURLToPath(import.meta.url)));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceFingerprint(){
 const files=[];for(const name of readdirSync(join(core,'understanding')).sort())if(name.endsWith('.mjs'))files.push(join(core,'understanding',name));
 for(const name of ['engine','http','server','workspace','terminal','external'])files.push(join(core,name+'.mjs'));
 files.push(join(core,'../native/understanding/addon.cc'));
 const hash=createHash('sha256');for(const file of files.sort()){hash.update(relative(core,file)+'\n');hash.update(readFileSync(file));hash.update('\n');}return hash.digest('hex');
}
export function validateReleaseReadiness(resourceDir,seed){
 try{
  const report=JSON.parse(readFileSync(join(resourceDir,'release-readiness.json'),'utf8'));
  if(report.schemaVersion!==2||report.activeReleaseApproved!==true||report.seedSHA256!==sha256(seed)||report.sourceSHA256!==sourceFingerprint())return false;
  if(!Array.isArray(report.gates)||report.gates.length!==RELEASE_GATE_IDS.length||!RELEASE_GATE_IDS.every(id=>report.gates.filter(g=>g.id===id&&g.passed===true).length===1))return false;
  if(!Array.isArray(report.evidence)||report.evidence.length<1)return false;
  for(const item of report.evidence){if(typeof item.file!=='string'||!/^[a-z0-9-]+\.json$/.test(item.file)||sha256(readFileSync(join(resourceDir,item.file)))!==item.sha256)return false;}
  return true;
 }catch{return false;}
}
ëŽ