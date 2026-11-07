import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.mjs';
import { createRequestHandler } from '../src/http.mjs';
import { Workspace } from '../src/workspace.mjs';
import { createTerminalService } from '../src/terminal.mjs';

const token='test-token-'.repeat(4);
function fixture(t, secretary, withWorkspace=false, terminal) {
  const dir=mkdtempSync(join(tmpdir(),'kst-handler-'));
  const engine=new Engine(join(dir,'state.sqlite'));
  const workspace=withWorkspace?new Workspace({dataDir:dir}):undefined;
  t.after(()=>{workspace?.close();engine.close();rmSync(dir,{recursive:true,force:true});});
  const handler=createRequestHandler({engine,workspace,terminal,token,port:4310,staticDir:fileURLToPath(new URL('../../kst-web',import.meta.url)),secretary});
  async function request(path,{method='GET',body,raw,headers={}}={}) {
    const input=raw??(body===undefined?'':JSON.stringify(body));
    const req=Readable.from(input?[Buffer.from(input)]:[]);
    Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:4310',authorization:`Bearer ${token}`,'content-type':'application/json',...headers}});
    const response={status:0,headers:{},raw:Buffer.alloc(0)};
    await handler(req,{writeHead(status,headers){response.status=status;response.headers=headers;},end(value){response.raw=Buffer.from(value??'');}});
    if(response.headers['Content-Type']?.startsWith('application/json'))response.body=JSON.parse(response.raw.toString());
    return response;
  }
  return {request,engine,workspace};
}

test('production workspace voice routes commit domain changes rather than legacy scratch copies',async t=>{
  const {request,workspace,engine}=fixture(t,undefined,true);
  const command={requestId:'domain-http-1',text:'add task Review source'};
  const first=await request('/api/conversation',{method:'POST',body:command});
  const repeated=await request('/api/conversation',{method:'POST',body:command});
  assert.equal(first.status,200);assert.deepEqual(first.body,repeated.body);
  assert.equal(workspace.snapshot().tasks.length,1);assert.equal(engine.status().tasks.length,0);
  const snapshot=await request('/api/secretary/workspace');assert.equal(snapshot.body.tasks[0].title,'Review source');
  assert.equal((await request('/api/secretary/workspace',{headers:{authorization:''}})).status,401);
  assert.equal((await request('/api/secretary/actions',{method:'POST',body:{requestId:'domain-http-2',action:{kind:'task.create',title:'Bad',shell:'rm'}}})).status,400);
  const status=await request('/api/status');assert.equal(status.body.tasks[0].title,'Review source');
});

test('Stop cancels a real managed workload and replay cannot cancel a newly started job',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kst-stop-job-'));
  const terminal=createTerminalService({dataDir:join(dir,'terminal'),projects:[{id:'fixture',root:dir,recipes:[{id:'test',executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:10000}]}]});
  t.after(async()=>{await terminal.close();rmSync(dir,{recursive:true,force:true});});
  const {request}=fixture(t,undefined,true,terminal);
  const first=await terminal.runRecipe({requestId:'actual-job-1',projectId:'fixture',recipeId:'test'});
  const stop=await request('/api/stop',{method:'POST',body:{requestId:'actual-stop1'}});assert.equal(stop.status,200);assert.equal(stop.body.jobs[0].id,first.id);assert.equal(stop.body.jobs[0].status,'cancelled');
  const second=await terminal.runRecipe({requestId:'actual-job-2',projectId:'fixture',recipeId:'test'});
  await request('/api/stop',{method:'POST',body:{requestId:'actual-stop1'}});assert.equal(terminal.status().jobs.find(j=>j.id===second.id).status,'running');
  const natural=await request('/api/conversation',{method:'POST',body:{requestId:'actual-stop2',text:'cancel that command'}});assert.equal(natural.body.job.id,second.id);assert.equal(natural.body.job.status,'cancelled');
  assert.equal((await request('/api/terminal/inventory')).status,404);
});

test('actual HTTP handler authenticates and rejects hostile origins/hosts',async t=>{
  const {request}=fixture(t);
  assert.equal((await request('/health',{headers:{authorization:''}})).status,200);
  assert.equal((await request('/api/status',{headers:{authorization:''}})).status,401);
  assert.equal((await request('/api/status',{headers:{origin:'https://untrusted.example'}})).status,403);
  assert.equal((await request('/api/status',{headers:{host:'untrusted.example'}})).status,403);
  const ok=await request('/api/status');assert.equal(ok.status,200);assert.equal(ok.body.app,'kst');
  assert.match(ok.headers['X-Request-ID'],/^[a-f0-9-]+$/);
});

test('actual handler rejects malformed, excessive, and unknown-field bodies',async t=>{
  const {request}=fixture(t);
  assert.equal((await request('/api/conversation',{method:'POST',raw:'{broken'})).status,400);
  assert.equal((await request('/api/conversation',{method:'POST',raw:'x'.repeat(32769)})).status,413);
  assert.equal((await request('/api/conversation',{method:'POST',body:{requestId:'valid-id-1',text:'hello',extra:true}})).status,400);
  assert.equal((await request('/api/conversation',{method:'POST',body:{requestId:'valid-id-1',text:'hello'},headers:{'content-type':'text/plain'}})).status,415);
});

test('concurrent same-ID requests commit one result through the real handler',async t=>{
  const {request,engine}=fixture(t),body={requestId:'http-duplicate-1',text:'add task test exactly once'};
  const [a,b]=await Promise.all([request('/api/conversation',{method:'POST',body}),request('/api/conversation',{method:'POST',body})]);
  assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(engine.status().tasks.length,1);
  assert.equal((await request('/api/conversation',{method:'POST',body:{...body,text:'add task other'}})).status,409);
});

test('Stop invalidates approvals at HTTP boundary without provider dispatch',async t=>{
  const {request,engine}=fixture(t);
  const proposal=await request('/api/conversation',{method:'POST',body:{requestId:'http-external-1',text:'ask claude explain tests'}});
  assert.equal(proposal.body.approval.status,'pending');
  await request('/api/stop',{method:'POST',body:{requestId:'http-stop-1'}});
  const result=await request(`/api/approvals/${proposal.body.approval.id}`,{method:'POST',body:{decision:'approve',revision:1}});
  assert.equal(result.status,409);assert.equal(engine.status().jobs.length,0);
});

test('only approved static assets are served, including the real logo alias',async t=>{
  const {request}=fixture(t);
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/kst-logo.png')).headers['Content-Type'],'image/png');
  for(const path of ['/%2e%2e/package.json','/src/server.mjs','/token','/public/../package.json'])assert.equal((await request(path)).status,404);
});

test('read-only secretary snapshot uses paired route and preserves provenance',async t=>{
  const snapshot={status:'fresh',observedAt:'2026-11-06T17:00:00Z',source:{label:'Personal Secretary',readOnly:true},data:{tasks:[{id:'from-source',title:'Read only'}],notes:[],reminders:[],calendar:[]}};
  const {request}=fixture(t,{snapshot:()=>snapshot});
  assert.equal((await request('/api/secretary',{headers:{authorization:''}})).status,401);
  assert.deepEqual((await request('/api/secretary')).body,snapshot);
  assert.equal((await request('/api/secretary',{method:'POST',body:{}})).status,404);
  const answer=await request('/api/conversation',{method:'POST',body:{requestId:'source-read-1',text:'show secretary tasks'}});
  assert.match(answer.body.reply,/Read only/);
  assert.match(answer.body.reply,/observed 2026/);
});

test('stale source is never presented as current in conversation',async t=>{
  const {request}=fixture(t,{snapshot:()=>({status:'stale',data:{tasks:[{title:'Old confidential task'}]}})});
  const answer=await request('/api/conversation',{method:'POST',body:{requestId:'source-stale-1',text:'show secretary tasks'}});
  assert.match(answer.body.reply,/unavailable/);assert.doesNotMatch(answer.body.reply,/Old confidential/);
});
