import {createHash} from 'node:crypto';
import {phrases} from '../../resources/understanding/corpus-source.mjs';
import {augmentedTraining} from '../../resources/understanding/corpus-augment.mjs';
import {heldoutActionPhrases} from '../../resources/understanding/corpus-heldout.mjs';
import {trainNegatives,gateNegatives,testNegatives} from '../../resources/understanding/corpus-negatives.mjs';
import {additionalActionTests,additionalNegativeTests} from '../../resources/understanding/corpus-test-expansion.mjs';
import {productionFeatures} from '../../src/understanding/features-production.mjs';

const fixed={now:Date.parse('2030-01-02T12:00:00Z'),timezone:'UTC'};
const data={title:'Design review',body:'We agreed to keep the launch small',query:'how to grow basil indoors',prompt:'review the deployment checklist',date:'2030-01-03T15:00:00Z',duration:'30 minutes'};
function instantiate(template){return template.replace(/<(title|body|query|prompt|date|duration)>/g,(_,key)=>data[key]);}
function row(label,template,partition,source){const utterance=instantiate(template);const groupId=createHash('sha256').update(`${source}:${label}:${template}`).digest().subarray(0,16);return {label,utterance,partition,groupId,...productionFeatures(utterance,{},fixed),reference:fixed};}
export const corpusExclusions=[];
export function developmentCorpus({auditSplits=false}={}){
 corpusExclusions.length=0;
 const rows=[];
 for(let label=1;label<27;label++){
  for(const template of phrases[label])rows.push(row(label,template,'train','base'));
  for(const generated of augmentedTraining(label)){const fixture=row(label,generated.text,'train','augmentation');fixture.groupId=createHash('sha256').update(`training-family:${label}:${generated.family}`).digest().subarray(0,16);rows.push(fixture);}
  for(let i=0;i<heldoutActionPhrases[label].length;i++)rows.push(row(label,heldoutActionPhrases[label][i],i<3?'calibration':'test','heldout'));
  const discourse=['Please ','Kindly ','Right now, ','My request is: ','The action I want is: ','I want you to ','Here is what I need: '];
  for(let i=0;i<discourse.length;i++){const original=heldoutActionPhrases[label][i%3],fixture=row(label,discourse[i]+original,'calibration','calibration-discourse');fixture.groupId=createHash('sha256').update(`heldout:${label}:${original}`).digest().subarray(0,16);rows.push(fixture);}
 }
 for(const [label,templates] of Object.entries(additionalActionTests))for(const template of templates)rows.push({...row(Number(label),template,'test','evaluation-v2'),evaluationOnly:true});
 for(const text of additionalNegativeTests)rows.push({...row(0,text,'test','negative-evaluation-v2'),evaluationOnly:true});
 for(const [partition,texts]of [['train',trainNegatives],['calibration',gateNegatives],['test',testNegatives]])for(const text of texts)rows.push(row(0,text,partition,'negative'));
 if(!auditSplits)return rows; // Preserve historical seed/replay construction; audit is evaluation-only.
 const seen=new Map(),clean=[];
 // Training ownership is frozen. Exclude leaked evaluation rows, never move them into training.
 for(const fixture of [...rows.filter(r=>r.partition==='train'),...rows.filter(r=>r.partition==='calibration'),...rows.filter(r=>r.partition==='test')]){
  const key=fixture.utterance.normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim(),previous=seen.get(key);
  if(previous){if(previous.label!==fixture.label)throw Error(`Conflicting labels: ${fixture.utterance}`);corpusExclusions.push({utterance:fixture.utterance,partition:fixture.partition,existingPartition:previous.partition,reason:'duplicate-normalized-utterance'});continue;}
  seen.set(key,fixture);clean.push(fixture);
 }
 return clean;
}
