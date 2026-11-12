import { existsSync, readFileSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint, validateReleaseReadiness } from './release.mjs';
import { understandingMode, INTENTS } from './registry.mjs';
import { createRuntime, decodeModel } from './model.mjs';
import { extractFeatures, encodeFeatures, decodeFeatures } from './features.mjs';
import { createCoordinator } from './coordinator.mjs';
import { createLearningService } from './learning.mjs';
const resources=join(dirname(fileURLToPath(import.meta.url)),'../../resources/understanding');
export function createUnderstanding({dataDir,engine,workspace,terminal,external,secretary,apple,mode:requested,resourceDir=resources}={}) {
  let persistedMode, userRequestedPreview=false;
  const config=join(dataDir,'understanding-activation.json');
  if(existsSync(config)){const stat=lstatSync(config);if(stat.isSymbolicLink()||!stat.isFile()||stat.uid!==process.getuid())throw Error('Unsafe understanding activation file');const value=JSON.parse(readFileSync(config,'utf8'));if(value.schemaVersion!==1||value.mode!=='active')throw Error('Invalid understanding activation file');if(value.sourceSHA256===sourceFingerprint()){persistedMode='active';userRequestedPreview=value.userRequestedPreview===true;}}
  requested=understandingMode(requested??process.env.KST_UNDERSTANDING_MODE??persistedMode??'shadow');
  let seed, runtime, setupFailure, coordinator, learning;
  const sentinel=join(dataDir,'understanding-native-session.json');
  // A surviving sentinel after lawful profile recovery means the last native run was unclean.
  // Explicit local recovery removes it after the owner has been verified; startup never does.
  const nativeAllowed=!existsSync(sentinel);
  try {seed=readFileSync(join(resourceDir,'seed-v1.bin'));runtime=createRuntime({bytes:seed,preferNative:nativeAllowed});}
  catch { setupFailure='Seed classifier is unavailable or invalid; compatibility commands remain available.'; }
  const releaseReady=Boolean(runtime)&&validateReleaseReadiness(resourceDir,seed);
  const previewActive=requested==='active'&&userRequestedPreview&&Boolean(runtime);
  const mode=requested==='active'&&!releaseReady&&!previewActive?'shadow':requested;
  const activationReason=previewActive&&!releaseReady?'Local ML preview enabled by user; release validation is incomplete.':requested==='active'&&!releaseReady?'Active rollout blocked: independent corpus, resource and hardware release gates are incomplete.':undefined;
  if(runtime?.runtime==='native')writeFileSync(sentinel,JSON.stringify({schemaVersion:1,pid:process.pid}),{flag:'wx',mode:0o600});
  const replaceModel=(_version,bytes)=>{
    if(!seed)return;
    const next=createRuntime({bytes:bytes??seed,preferNative:nativeAllowed});
    const prior=runtime;runtime=next;prior?.dispose();
    if(learning)learning.modelApi.runtime=runtime.runtime;
  };
  learning=createLearningService({profileDir:dataDir,operationalDb:engine.db,mode,resources:resourceDir,
    resolveFeedbackCandidate:(id,revision)=>coordinator.feedbackCandidate(id,revision),
    hasActiveWork:()=>Boolean(coordinator?.busy.size)||[...(terminal?.status?.().jobs??[]),...(external?.status?.().jobs??[])].some(j=>['prepared','running','cancelling'].includes(j.status)),
    modelApi:{decodeModel,decodeFeatures,labels:INTENTS,runtime:runtime?.runtime??'compatibility'},
    onModelChange:replaceModel,onPrivacyChange:()=>coordinator?.stop()});
  coordinator=createCoordinator({engine,workspace,terminal,external,secretary,apple,learning,mode,
    features:(text,context)=>encodeFeatures(extractFeatures(text,context)),
    predict:(text,context)=>{
      if(!runtime)return {intent:'other',runtime:'compatibility',modelVersion:0,automaticEnabled:false};
      const v=extractFeatures(text,context);const prediction=runtime.predict(v),top=prediction.top[0],p=runtime.model.policies[top.label];
      return {intent:INTENTS[top.label],score:top.score,margin:prediction.margin,modelVersion:runtime.model.modelVersion,runtime:runtime.runtime,
        automaticEnabled:releaseReady&&!v.truncated&&p.automaticEnabled&&top.score-p.scoreFloor>1e-4&&prediction.margin-p.marginFloor>1e-4};
    }});
  const coordinatorStatus=coordinator.status.bind(coordinator);
  coordinator.status=()=>({...coordinatorStatus(),requestedMode:requested,releaseReady,activationKind:previewActive&&!releaseReady?'user-preview':releaseReady?'validated':'shadow',activationReason,setupFailure,runtime:runtime?.runtime??'compatibility',nativeRecoveryRequired:!nativeAllowed});
  return {understanding:coordinator,learning,async close(){coordinator.close();await learning.close();runtime?.dispose();if(nativeAllowed&&existsSync(sentinel)){const stat=lstatSync(sentinel);if(!stat.isSymbolicLink()&&stat.uid===process.getuid())unlinkSync(sentinel);}}};
}
