import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Engine} from '../src/engine.mjs';
import {Workspace} from '../src/workspace.mjs';
import {createExternalService} from '../src/external.mjs';
import {createRequestHandler} from '../src/http.mjs';

const answer=()=>new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Only an approved response'}]}]}));
const flush=()=>new Promise(done=>setImmediate(done));
function fixture(t,fetchImpl=async()=>answer(),spawnImpl){
  const dir=mkdtempSync(join(tmpdir(),'kst-egress-http-'));
  const engine=new Engine(join(dir,'state.sqlite'));
  const workspace=new Workspace({dataDir:dir});
  const environment={KST_OPENAI_MODEL:'test-model',KST_OPENAI_API_KEY:'synthetic-key'};
  let calls=0;
  const external=createExternalService({dataDir:join(dir,'external'),environment,fetchImpl:(...args)=>{calls++;return fetchImpl(...args);},...(spawnImpl?{spawnImpl}:{})});
  t.after(async()=>{await external.close();workspace.close();engine.close();rmSync(dir,{recursive:true,force:true});});
  const handler=createRequestHandler({engine,workspace,external,token:'test-private-token',port:4310,staticDir:fileURLToPath(new URL('../../kst-web',import.meta.url))});
  async function call(path,body){
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:path,method:body?'POST':'GET',headers:{host:'127.0.0.1:4310',authorization:'Bearer test-private-token','content-type':'application/json'}});
    let status,data;await handler(req,{writeHead(code){status=code;},end(value){data=JSON.parse(String(value));}});return{status,data};
  }
  const say=(requestId,text,conversationId)=>call('/api/conversation',{requestId,text,...(conversationId?{conversationId}:{})});
  return{call,say,engine,workspace,external,environment,calls:()=>calls};
}

test('production approval route dispatches once, denial and stale replay never contact provider',async t=>{
  const f=fixture(t),proposal=await f.say('external-proposal-1','ask chatgpt explain tests','discussion-one');
  assert.equal(f.calls(),0);assert.equal(proposal.data.approval.transport,'openai-api');
  const a=proposal.data.approval;
  const approved=await f.call(`/api/approvals/${a.id}`,{decision:'approve',revision:1});assert.equal(approved.status,200);
  await flush();assert.equal(f.calls(),1);assert.equal(f.external.status().jobs[0].status,'succeeded');
  assert.equal((await f.call(`/api/approvals/${a.id}`,{decision:'approve',revision:1})).status,409);assert.equal(f.calls(),1);
  const second=await f.say('external-proposal-2','ask chatgpt do not send this','discussion-one');
  await f.call(`/api/approvals/${second.data.approval.id}`,{decision:'deny',revision:1});assert.equal(f.calls(),1);
});

test('spoken approval is discussion-scoped and verified results are available through voice route',async t=>{
  const f=fixture(t);await f.say('voice-proposal-1','ask chatgpt explain this','voice-session');
  await f.say('voice-decision-1','approve external request','different-session');assert.equal(f.calls(),0);
  await f.say('voice-decision-2','approve external request','voice-session');await flush();assert.equal(f.calls(),1);
  const results=await f.say('voice-results-1','show external results','voice-session');assert.match(results.data.reply,/Only an approved response/);
});

test('an explicit external command is not consumed by an unrelated secretary clarification',async t=>{
  const f=fixture(t);await f.say('switch-reminder-1','remind me to stretch','switch-session');
  const proposal=await f.say('switch-proposal-1','ask chatgpt explain stretches','switch-session');
  assert.equal(proposal.data.approval.service,'chatgpt');assert.equal(f.calls(),0);assert.equal(f.workspace.snapshot().reminders.length,0);
});

test('web request opens a visible Chrome Incognito window directly without an approval record',async t=>{
  let launched;
  const f=fixture(t,async()=>answer(),(binary,args,options)=>{
    launched={binary,args,options};
    return spawn(process.execPath,['-e','process.exit(0)'],options);
  });
  const result=await f.say('web-direct-0001','search web personal assistant','web-session');
  assert.equal(result.status,200);assert.equal(result.data.browser.status,'opened');
  assert.match(result.data.reply,/visible Chrome Incognito/);
  assert.equal(launched.binary,'/usr/bin/open');
  assert.deepEqual(launched.args,['-na','Google Chrome','--args','--incognito','--new-window','https://www.google.com/search?q=personal%20assistant']);
  assert.equal(f.engine.status().approvals.length,0);assert.equal(f.calls(),0);
});

test('configuration changes invalidate an already previewed approval before any request leaves',async t=>{
  const f=fixture(t),proposal=await f.say('scope-proposal-1','ask chatgpt explain','scope-session');
  f.environment.KST_OPENAI_MODEL='different-model';
  const result=await f.call(`/api/approvals/${proposal.data.approval.id}`,{decision:'approve',revision:1});
  assert.equal(result.data.job.status,'blocked');assert.equal(f.calls(),0);
});

test('replaying spoken approval cannot approve a newer request in the same discussion',async t=>{
  const f=fixture(t);await f.say('replay-proposal-1','ask chatgpt first','replay-session');
  await f.say('replay-decision-1','approve external request','replay-session');await flush();assert.equal(f.calls(),1);
  const second=await f.say('replay-proposal-2','ask chatgpt second','replay-session');
  assert.equal((await f.say('replay-decision-1','approve external request','replay-session')).status,409);
  assert.equal(f.calls(),1);assert.equal(f.engine.status().approvals.find(a=>a.id===second.data.approval.id).status,'pending');
});

test('Stop captures external job identities so replay cannot interrupt newer requests',async t=>{
  const f=fixture(t,()=>new Promise(()=>{}));
  const first=await f.say('cancel-proposal-1','ask chatgpt first request','cancel-session');
  await f.call(`/api/approvals/${first.data.approval.id}`,{decision:'approve',revision:1});
  const stopped=await f.call('/api/stop',{requestId:'stop-external-1'});assert.equal(stopped.data.jobs[0].status,'unknown');await flush();
  const second=await f.say('cancel-proposal-2','ask chatgpt second request','cancel-session');
  await f.call(`/api/approvals/${second.data.approval.id}`,{decision:'approve',revision:1});
  await f.call('/api/stop',{requestId:'stop-external-1'});
  const newJob=f.external.status().jobs.find(job=>job.approvalId===second.data.approval.id);assert.equal(newJob.status,'running');
});

test('ending one discussion revokes its pending approval without touching a newer discussion',async t=>{
  const f=fixture(t);
  const a=await f.say('close-proposal-1','ask chatgpt first','first-session');
  const b=await f.say('close-proposal-2','ask chatgpt second','new-session');
  await f.say('close-discussion-1','end conversation','first-session');
  assert.equal(f.engine.status().approvals.find(item=>item.id===a.data.approval.id).status,'denied');
  assert.equal(f.engine.status().approvals.find(item=>item.id===b.data.approval.id).status,'pending');assert.equal(f.calls(),0);
});
