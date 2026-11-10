import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {Engine} from '../src/engine.mjs';
import {createRequestHandler} from '../src/http.mjs';
import {createUnderstanding} from '../src/understanding/runtime.mjs';
import {decodeStrictJSON} from '../src/wire-json.mjs';
function fixture(t,{google}={}){
 const dir=mkdtempSync(join(tmpdir(),'kst-release06-'));const engine=new Engine(join(dir,'kst.sqlite'));
 const adaptive=createUnderstanding({dataDir:dir,engine});
 const handler=createRequestHandler({engine,...adaptive,google,token:'test-token',port:4310,staticDir:'.'});
 t.after(async()=>{await adaptive.close();engine.close();rmSync(dir,{recursive:true,force:true});});
 return {engine,...adaptive,async call(path,body,method=body?'POST':'GET',authorization='Bearer test-token'){
  const req=Readable.from(body===undefined?[]:[Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
  Object.assign(req,{url:path,method,headers:{host:'localhost:4310',authorization,'content-type':'application/json'}});
  let status,data;await handler(req,{writeHead(code){status=code;},end(bytes){data=JSON.parse(String(bytes));}});return {status,data};
 }};
}
test('strict decoder rejects nested/escaped duplicate keys and invalid UTF8',()=>{
 for(const raw of ['{"x":1,"x":2}','{"a":[{"x":0,"\\u0078":1}]}'])assert.throws(()=>decodeStrictJSON(Buffer.from(raw)),/Duplicate/);
 assert.throws(()=>decodeStrictJSON(Buffer.from([0x22,0xff,0x22])),/UTF-8/);
 assert.deepEqual(decodeStrictJSON(Buffer.from('{"a":[1,true,null,"escaped\\\"text"],"b":{}}')),{a:[1,true,null,'escaped"text'],b:{}});
});
test('Google routes authenticate first and voice bypasses generic plaintext ledger',async t=>{
 let calls=0;const google={route:async()=>{calls++;return {status:200,body:{connected:false}};},converse:async body=>{calls++;return /gmail/.test(body.text)?{conversationId:'g-discussion',reply:'Preview ready'}:null;},stop(){}};
 const f=fixture(t,{google});
 assert.equal((await f.call('/api/google/status',undefined,'GET','')).status,401);assert.equal(calls,0);
 assert.equal((await f.call('/api/google/status')).status,200);
 const answer=await f.call('/api/conversation',{requestId:'google-secret-01',text:'draft gmail exact private body'});
 assert.equal(answer.status,200);assert.equal(answer.data.reply,'Preview ready');
 assert.equal(f.engine.db.prepare('SELECT count(*) n FROM understanding_requests').get().n,0);
 assert.equal(JSON.stringify(f.engine.read()).includes('exact private body'),false);
});
test('runtime v2 inhibits learning for all dictation phases while v1 stays strict',async t=>{
 const f=fixture(t);const base={clientInstanceId:'native-release-06',sequence:1,voiceState:'dictating',ttsActive:false,idleSeconds:120,lowPowerMode:false,thermalState:'nominal',schemaVersion:2,modeGeneration:1};
 const health=await f.call('/health');assert.equal(health.data.capabilities.runtimeStateV2,true);
 for(const [index,voiceState] of ['dictating','dictation-paused','finalizing','inserting'].entries()){
  const r=await f.call('/api/runtime-state/v2',{...base,sequence:index+1,voiceState},'PATCH');assert.equal(r.status,200);assert.equal(r.data.accepted,true);assert.equal(f.learning.eligible(true),'WORK_ACTIVE');
 }
 assert.equal((await f.call('/api/runtime-state/v2',{...base,sequence:9,modeGeneration:0},'PATCH')).data.accepted,false);
 const {schemaVersion,modeGeneration,...old}=base;assert.equal((await f.call('/api/understanding/runtime-state',old,'PATCH')).status,400);
});
test('Google wire duplicate fields cannot reach a provider adapter',async t=>{
 let calls=0;const f=fixture(t,{google:{route:async()=>{calls++;return {status:200,body:{}};}}});
 const r=await f.call('/api/google/actions','{"requestId":"a","action":{"kind":"read","kind":"send"}}');assert.equal(r.status,400);assert.equal(calls,0);
});
