import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {developmentCorpus,corpusExclusions} from './development-corpus.mjs';
import {decodeModel,predict,trainModel} from '../../src/understanding/model.mjs';
import {calibratePolicies} from '../../src/understanding/model-calibration.mjs';
import {INTENTS} from '../../src/understanding/registry.mjs';

const directory=new URL('../../resources/understanding/',import.meta.url);
const seed=readFileSync(new URL('seed-v1.bin',directory)),model=decodeModel(seed),corpus=developmentCorpus({auditSplits:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const train=corpus.filter(row=>row.partition==='train'),calibration=corpus.filter(row=>row.partition==='calibration'),test=corpus.filter(row=>row.partition==='test');
const policies=calibratePolicies(model,calibration);
const ownership=new Map();let groupsDisjoint=true;
for(const row of corpus){const key=row.groupId.toString('hex');if(ownership.has(key)&&ownership.get(key)!==row.partition)groupsDisjoint=false;ownership.set(key,row.partition);}
const counts=Object.fromEntries(INTENTS.map((intent,label)=>[label,{intent,...Object.fromEntries(['train','calibration','test'].map(partition=>[partition,corpus.filter(row=>row.label===label&&row.partition===partition).length]))}]));
let correct=0,automaticAccepted=0,automaticCorrect=0,oosActivations=0;
const perClass=INTENTS.map((intent,label)=>({label,intent,total:0,correct:0}));
const predictions=[];
for(const row of test){const result=predict(model,row.features),best=result.top[0],policy=policies.policies[best.label];const accepted=policy.automaticEnabled&&best.score-policy.scoreFloor>1e-4&&result.margin-policy.marginFloor>1e-4;
 perClass[row.label].total++;if(best.label===row.label){correct++;perClass[row.label].correct++;}
 if(accepted){automaticAccepted++;if(best.label===row.label)automaticCorrect++;if(row.label===0)oosActivations++;}
 predictions.push({utterance:row.utterance,expectedIntent:INTENTS[row.label],predictedIntent:INTENTS[best.label],groupId:row.groupId.toString('hex'),expected:row.label,predicted:best.label,score:best.score,margin:result.margin,automatic:accepted});
}
// Chronological mechanism check: expose each calibration label only after its prediction.
// This does not fit policy thresholds or choose a winner from release-test scores.
let adaptive=model,prequentialCorrect=0,seen=0;
const personal=[];
for(const row of calibration){if(predict(adaptive,row.features).top[0].label===row.label)prequentialCorrect++;seen++;personal.push({...row,personal:true,id:row.groupId});if(seen%10===0)adaptive=trainModel([...train,...personal],{modelVersion:Math.floor(seen/10),datasetRevision:seen,privacyGeneration:1,corpusHash:model.corpusHash,policies:model.policies}).model;}
const adaptedTestCorrect=test.filter(row=>predict(adaptive,row.features).top[0].label===row.label).length;
const countRequirementsMet=Object.entries(counts).every(([label,n])=>label==='0'?n.test>=500:n.train>=120&&n.calibration>=40&&n.test>=80);
const inDomain=test.filter(row=>row.label!==0),inDomainCorrect=perClass.slice(1).reduce((sum,row)=>sum+row.correct,0),oosCount=counts[0].test;
const report={schemaVersion:1,datasetVersion:2,evaluationOnlyAdditions:true,seedSHA256:hash(seed),corpusSHA256:hash(JSON.stringify(corpus.map(row=>({label:row.label,utterance:row.utterance,partition:row.partition,groupId:row.groupId.toString('hex')})))),corpusExclusions,classificationPipeline:'interpret -> maskedUtterance(grammar.action) -> extractFeatures',fixedReference:{now:'2030-01-02T12:00:00Z',timezone:'UTC'},counts,groupsDisjoint,countRequirementsMet,
 test:{accuracy:inDomainCorrect/inDomain.length,inDomainCorrect,inDomainTotal:inDomain.length,totalAccuracy:correct/test.length,correct,total:test.length,automaticAccepted,automaticCorrect,automaticPrecision:automaticAccepted?automaticCorrect/automaticAccepted:null,oosCount,oosActivations,oosActivationRate:oosCount?oosActivations/oosCount:null,perClass,predictions},
 calibration:{...policies,calibrationCases:calibration.length,policyFloorsFittedForDeployment:false},
 adaptation:{passed:null,mechanismChecked:true,method:'Predict each calibration stream item before exposing its label; rebuild from seed plus previously exposed explicit examples every ten events. Final release test labels never enter training.',seen,prequentialCorrect,prequentialAccuracy:prequentialCorrect/seen,untouchedTestCorrect:adaptedTestCorrect,untouchedTestTotal:test.length,integrationPromotionAndChronologyGatePending:true},
 releaseReady:false,blockers:['Independent corpus counts do not yet meet 120/40/80 per action or 500 OOS release cases. Duplicate evaluation utterances are excluded from scoring.','Calibrated automatic precision requires at least100 accepted independent release cases; no policy is enabled without sufficient evidence.','Full typed field/action equality and chronological promotion safety require integrated evaluator.','Packaged minimums are met; independent development and release counts remain incomplete.']};
writeFileSync(new URL('release-corpus-report.json',directory),JSON.stringify(report,null,2));
console.log(JSON.stringify({counts:{train:train.length,calibration:calibration.length,test:test.length},inDomainAccuracy:report.test.accuracy,automaticAccepted,automaticPrecision:report.test.automaticPrecision,oosActivationRate:report.test.oosActivationRate,adaptation:report.adaptation,groupsDisjoint,releaseReady:false},null,2));
