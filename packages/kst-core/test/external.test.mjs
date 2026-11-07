import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createExternalService} from '../src/external.mjs';

function fixture(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'kst-external-'));
  const environment=options.environment?{...options.environment}:{KST_OPENAI_MODEL:'configured-test-model',KST_OPENAI_API_KEY:'synthetic-test-key'};
  if(options.codexFixture){environment.KST_CODEX_PROJECT=join(dir,'project');mkdirSync(environment.KST_CODEX_PROJECT);}
  const service=createExternalService({...options,dataDir:dir,environment});
  t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
  return{service,dir,environment};
}
const approve=(service,name='chatgpt',prompt='Explain this concept')=>({id:randomUUID(),service:name,prompt,status:'approved',expiresAt:new Date(Date.now()+300000).toISOString(),scopeHash:service.describe(name).scopeHash});
const output=text=>new Response(JSON.stringify({id:'provider-response',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text}]}]}),{status:200});
const flush=()=>new Promise(done=>setImmediate(done));

test('no transport runs before approval and expired/changed scopes cannot dispatch',async t=>{
  let calls=0;const {service}=fixture(t,{fetchImpl:async()=>{calls++;return output('Answer');}});
  const a=approve(service);
  await assert.rejects(service.dispatch({...a,status:'pending'}),/approved/);assert.equal(calls,0);
  assert.equal((await service.dispatch({...a,expiresAt:'2000-01-01T00:00:00Z'})).status,'blocked');
  assert.equal((await service.dispatch({...approve(service),scopeHash:'changed'})).status,'blocked');assert.equal(calls,0);
});

test('OpenAI receives only approved text with store false and bounded output; duplicate approval never repeats',async t=>{
  let calls=0;const {service}=fixture(t,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');
    assert.deepEqual(JSON.parse(options.body),{model:'configured-test-model',input:'Approved prompt only',store:false,max_output_tokens:1024});
    assert.equal(options.redirect,'error');return output('Verified response');
  }});
  const approval=approve(service,'chatgpt','Approved prompt only');
  const first=await service.dispatch(approval);assert.equal(first.status,'succeeded');assert.equal(first.text,'Verified response');
  assert.deepEqual(await service.dispatch(approval),first);assert.equal(calls,1);
  await assert.rejects(service.dispatch({...approval,prompt:'Different'}),/changed/);assert.equal(calls,1);
});

test('Claude uses only its configured API, approved prompt and fixed version; no tool context',async t=>{
  const {service}=fixture(t,{environment:{KST_CLAUDE_MODEL:'configured-claude',KST_ANTHROPIC_API_KEY:'synthetic-claude-key'},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['anthropic-version'],'2026-10-21');
    assert.deepEqual(JSON.parse(options.body),{model:'configured-claude',messages:[{role:'user',content:'Explain this concept'}],max_tokens:1024});
    return new Response(JSON.stringify({id:'claude-response',content:[{type:'text',text:'Claude result'}]}));
  }});
  assert.equal((await service.dispatch(approve(service,'claude'))).text,'Claude result');
});

test('missing credentials/model blocks without automatic fallback',async t=>{
  let calls=0;const {service}=fixture(t,{environment:{},fetchImpl:async()=>{calls++;throw Error('Should not run');}});
  for(const name of ['chatgpt','claude','codex','antigravity'])assert.equal((await service.dispatch(approve(service,name))).status,'blocked');
  assert.equal(calls,0);
});

test('failed HTTP and uncertain connections are different durable outcomes without retry',async t=>{
  let calls=0;const {service}=fixture(t,{fetchImpl:async()=>{calls++;if(calls===1)return new Response('{}',{status:429});throw Error('private provider details');}});
  assert.equal((await service.dispatch(approve(service))).status,'failed');
  const a=approve(service),result=await service.dispatch(a);assert.equal(result.status,'unknown');
  assert.doesNotMatch(result.message,/private provider details/);await service.dispatch(a);assert.equal(calls,2);
});

test('partial and truncated model responses are not reported complete',async t=>{
  const {service}=fixture(t,{fetchImpl:async()=>output('x'.repeat(17000))});
  const result=await service.dispatch(approve(service));assert.equal(result.status,'partial');assert.equal(result.text.length,16000);assert.match(result.message,/partial|truncated/);
});

test('cancellation stays unknown and a late response cannot replace its receipt',async t=>{
  let finish;const {service}=fixture(t,{fetchImpl:()=>new Promise(done=>{finish=done;})});
  const pending=service.dispatch(approve(service));await flush();
  const job=service.status().jobs[0];assert.equal(job.status,'running');
  assert.equal(service.cancel(job.id).status,'unknown');await pending;
  finish(output('Too late'));await flush();assert.equal(service.status().jobs[0].status,'unknown');assert.equal(service.status().jobs[0].text,undefined);
});

test('bounded admission starts one external request and does not queue another approved egress',async t=>{
  let finish,calls=0;const {service}=fixture(t,{fetchImpl:()=>{calls++;return new Promise(done=>{finish=done;});}});
  const first=service.start(approve(service));assert.equal(first.status,'running');
  assert.equal((await service.dispatch(approve(service))).status,'blocked');assert.equal(calls,1);
  service.cancel(first.id);finish(output('Ignored'));await flush();
});

test('Codex verifies scope offline before restricted argv/stdin dispatch and parses structured output',async t=>{
  const observed=[];const {service}=fixture(t,{codexFixture:true,environment:{KST_CODEX_ENABLED:'1',KST_CODEX_PATH:process.execPath},spawnImpl:(executable,args,options)=>{
    observed.push({executable,args,options});
    return spawn(process.execPath,['-e',args[0]==='sandbox'?'console.log("kst-scope-ok")':'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Read-only answer"}})))'],options);
  }});
  // The configured directory is explicit and dedicated; no real provider is spawned.
  const result=await service.dispatch(approve(service,'codex','Do not interpolate $(touch secret)'));
  assert.equal(result.status,'succeeded');assert.equal(result.text,'Read-only answer');
  assert.equal(observed.length,2);assert.equal(observed[0].args[0],'sandbox');assert.ok(observed[0].args.includes('kst-read'));
  assert.equal(observed[1].args[0],'exec');assert.ok(observed[1].args.includes('default_permissions="kst-read"'));
  assert.ok(observed[1].args.includes('web_search="disabled"'));
  assert.ok(!observed[1].args.includes('--sandbox'));assert.ok(observed[1].args.includes('hooks'));assert.ok(observed[1].args.includes('plugins'));
  assert.equal(observed[1].args.at(-1),'-');assert.equal(observed[1].options.shell,false);
  assert.ok(!observed[1].args.some(arg=>arg.includes('touch secret')));assert.ok(service.describe('codex').context.some(line=>line.includes('Project files')));
  assert.equal(result.evidence[0].scopeProbe,'passed');
});

test('a failed Codex scope probe never starts a model client',async t=>{
  let calls=0;const {service}=fixture(t,{codexFixture:true,environment:{KST_CODEX_ENABLED:'1',KST_CODEX_PATH:process.execPath},spawnImpl:(executable,args,options)=>{
    calls++;assert.equal(args[0],'sandbox');return spawn(process.execPath,['-e','console.log("wrong scope")'],options);
  }});
  const result=await service.dispatch(approve(service,'codex'));
  assert.equal(result.status,'failed');assert.equal(result.errorCode,'SCOPE_CHECK_FAILED');assert.equal(calls,1);
});

test('Codex rejects a broad project containing its private profile before launch',async t=>{
  let calls=0;const {service}=fixture(t,{environment:{KST_CODEX_ENABLED:'1',KST_CODEX_PATH:process.execPath,KST_CODEX_PROJECT:tmpdir()},spawnImpl:()=>{calls++;throw Error();}});
  assert.equal(service.describe('codex').configured,false);
  assert.equal((await service.dispatch(approve(service,'codex'))).status,'blocked');assert.equal(calls,0);
});

test('web requests cannot enter provider approval dispatch',async t=>{
  const {service}=fixture(t);
  await assert.rejects(service.dispatch(approve(service,'web','precise approved query')),/Chrome Incognito/);
});

test('restart preserves uncertain provider work and never automatically calls a transport',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kst-external-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const first=createExternalService({dataDir:dir,environment:{}});await first.close();
  const db=new DatabaseSync(join(dir,'external.sqlite'));db.prepare('INSERT INTO external_jobs VALUES(?,?,?,?)').run('external-interrupted','approval-before-crash','hash',JSON.stringify({id:'external-interrupted',status:'running',message:'Before crash'}));db.close();
  let calls=0;const recovered=createExternalService({dataDir:dir,environment:{},fetchImpl:async()=>{calls++;throw Error();}});t.after(()=>recovered.close());
  assert.equal(recovered.status().jobs[0].status,'unknown');assert.equal(calls,0);
});
