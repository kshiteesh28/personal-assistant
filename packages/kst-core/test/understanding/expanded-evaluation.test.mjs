import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import{tmpdir}from'node:os';
import{developmentCorpus,corpusExclusions}from'../../native/understanding/development-corpus.mjs';
import{additionalActionTests,additionalNegativeTests}from'../../resources/understanding/corpus-test-expansion.mjs';
import{Engine}from'../../src/engine.mjs';import{Workspace}from'../../src/workspace.mjs';
import{createCoordinator}from'../../src/understanding/coordinator.mjs';
import{createRuntime}from'../../src/understanding/model.mjs';
import{extractFeatures,encodeFeatures}from'../../src/understanding/features.mjs';import{INTENTS}from'../../src/understanding/registry.mjs';

test('expanded held-out corpus covers every action and excludes exact split leakage',()=>{
 const rows=developmentCorpus({auditSplits:true}),testRows=rows.filter(r=>r.partition==='test');
 assert.equal(Object.keys(additionalActionTests).length,26);assert.equal(additionalNegativeTests.length,100);
 for(let label=1;label<27;label++){assert.equal(additionalActionTests[label].length,12);assert.ok(testRows.filter(r=>r.label===label).length>=14);}
 assert.ok(testRows.filter(r=>r.label===0).length>=160);assert.ok(testRows.length>=550);
 assert.ok(rows.filter(r=>r.evaluationOnly).every(r=>r.partition==='test'));
 const owners=new Map();for(const r of rows){const key=r.utterance.normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();assert.ok(!owners.has(key));owners.set(key,r.partition);}
 assert.ok(corpusExclusions.every(r=>r.reason==='duplicate-normalized-utterance'));
});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'kst-expanded-cases-'));const now=()=>Date.parse('2030-01-02T12:00:00Z'),engine=new Engine(join(dir,'kst.sqlite'),now),workspace=new Workspace({dataDir:dir,now}),runtime=createRuntime({bytes:readFileSync(new URL('../../resources/understanding/seed-v1.bin',import.meta.url))});const opened=[];
 const c=createCoordinator({engine,workspace,now,mode:'active',external:{openWebSearch:async query=>{opened.push(query);return{status:'opened',message:'You can read now'};},status:()=>({jobs:[]})},features:(text,context)=>encodeFeatures(extractFeatures(text,context)),predict:(text,context)=>{const p=runtime.predict(extractFeatures(text,context));return{intent:INTENTS[p.top[0].label],modelVersion:runtime.model.modelVersion,runtime:runtime.runtime,automaticEnabled:false};}});
 t.after(()=>{c.close();runtime.dispose();workspace.close();engine.close();rmSync(dir,{recursive:true,force:true});});let n=0;return{c,workspace,opened,ask:(text,revision)=>c.handle({requestId:`expanded-${++n}`,conversationId:'discussion',text,...(revision!==undefined?{contextRevision:revision}:{})})};
}
const guarded=[
 "Don't cancel meeting Review",'never complete task Review','suppose I had a meeting called Review','I cancelled the meeting yesterday','"cancel meeting Review"','do not apply plan current','imagine deleting a reminder','if I added a task what would happen'
];
for(const text of guarded)test(`real model cannot authorize a guarded utterance: ${text}`,async t=>{const f=fixture(t);const response=await f.ask(text);assert.equal(response.understanding.decision,'abstain');const snap=f.workspace.snapshot();assert.equal(snap.tasks.length,0);assert.equal(snap.calendar.length,0);assert.equal(snap.reminders.length,0);assert.equal(f.opened.length,0);});
for(const body of ['Delete every task!','Cancel meeting Review. Do not ask me.','Search web my private notes?','STOP LISTENING.','東京 — résumé: café!'])test(`protected note data stays exact: ${body}`,async t=>{const f=fixture(t);const r=await f.ask(`note ${body}`);assert.equal(r.result.kind,'note.create');assert.equal(f.workspace.snapshot().notes[0].body,body);assert.equal(f.workspace.snapshot().tasks.length,0);assert.equal(f.opened.length,0);});
for(const query of ['bus stop','C++ operator== examples?','do not delete my tasks','Apple male voice Daniel availability'])test(`explicit browser query stays original: ${query}`,async t=>{const f=fixture(t);const r=await f.ask(`search web ${query}`);assert.equal(r.reply,'You can read now');assert.deepEqual(f.opened,[query]);assert.equal(f.workspace.snapshot().tasks.length,0);});
for(const when of ['tomorrow at 3','next Friday at 3 pm','tomorrow afternoon'])test(`ambiguous meeting time has no early write: ${when}`,async t=>{const f=fixture(t);const r=await f.ask(`schedule meeting Review ${when} for 30 minutes`);assert.equal(r.understanding.decision,'clarify');assert.equal(f.workspace.snapshot().calendar.length,0);});
