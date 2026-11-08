import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { productionFeatures } from '../../src/understanding/features-production.mjs';
import { encodeReplay } from '../../src/understanding/replay.mjs';
import { trainModel } from '../../src/understanding/model.mjs';
import { developmentCorpus } from './development-corpus.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest();
const development = developmentCorpus();
const records = development.filter(row => row.partition !== 'test').map(row => ({
 partition: row.partition === 'train' ? 0 : 1,
 label: row.label,
 groupId: row.groupId,
 features: row.features,
 ...(row.partition !== 'train' ? {extra: {utterance: row.utterance,context: {},expected: {intent: row.label}}} : {})
}));
const criticalVariants = [
 text => ({text:`do not ${text}`,guard:1}),
 text => ({text:`don't ${text}`,guard:1}),
 text => ({text:`never ${text}`,guard:1}),
 text => ({text:`imagine ${text}`,guard:8}),
 text => ({text:`if I were to ${text}`,guard:8}),
 text => ({text:`"${text}"`,guard:2}),
 text => ({text:`I cancelled the meeting yesterday and said ${text}`,guard:4}),
 text => ({text:`send an email with instructions to ${text}`,guard:16})
];
const actions=development.filter(row=>row.partition==='train'&&row.label!==0);
for(let index=0;index<192;index++){
 const {text,guard}=criticalVariants[Math.floor(index/24)](actions[index%actions.length].utterance);
 records.push({partition:2,label:0,guard,groupId:hash(`critical:${index}`).subarray(0,16),features:productionFeatures(text,{}, {now:Date.parse('2030-01-02T12:00:00Z'),timezone:'UTC'}).features,extra:{utterance:text,context:{},expected:{mustNotDispatch:true}}});
}
const replay=encodeReplay(records);
const result=trainModel(records.filter(row=>row.partition===0),{corpusHash:hash(replay)});
const directory=new URL('../../resources/understanding/',import.meta.url);
writeFileSync(new URL('seed-replay.bin',directory),replay);
writeFileSync(new URL('seed-v1.bin',directory),result.bytes);
writeFileSync(new URL('seed-manifest.json',directory),JSON.stringify({
 schemaVersion:1,synthetic:true,clonedPadding:false,classificationPipeline:'interpret -> maskedUtterance(grammar.action) -> extractFeatures',
 independentSemanticCorpusComplete:false,
 partitions:Object.fromEntries(['train','calibration','test'].map(name=>[name,development.filter(row=>row.partition===name).length])),
 perActionCounts:{train:40,calibration:10,test:3},otherCounts:{train:80,calibration:64,test:64},
 criticalCases:192,artifactBytes:result.bytes.length,replayBytes:replay.length,
 corpusHash:hash(replay).toString('hex'),automaticPoliciesEnabled:0,releaseReady:false,
 blockers:['Independent action corpus minima remain unmet: 40/10/3 train/calibration/test per action versus required 120/40/80.','Other independent test count 64 versus required 500.','Automatic policies require calibration and independent precision/OOS gates.']
},null,2));
console.log(JSON.stringify({artifactBytes:result.bytes.length,replayBytes:replay.length,metrics:result.metrics}));
ëŽ