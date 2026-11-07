import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine} from '../src/engine.mjs';
import {Workspace} from '../src/workspace.mjs';
import {createRequestHandler} from '../src/http.mjs';

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'kst-workflow-http-'));
  let clock=Date.parse('2026-11-06T09:00:00-06:00');
  const engine=new Engine(join(dir,'core.sqlite'),()=>clock),workspace=new Workspace({dataDir:dir,now:()=>clock});
  t.after(()=>{workspace.close();engine.close();rmSync(dir,{recursive:true,force:true});});
  let inventoryCalls=0;
  const terminal={status:()=>({mode:'disabled',projects:[],jobs:[]}),inventory:async()=>{inventoryCalls++;return{sessions:[],status:'ready'};}};
  const handler=createRequestHandler({engine,workspace,terminal,token:'private-fixture-token',port:4310,staticDir:fileURLToPath(new URL('../../kst-web',import.meta.url))});
  async function call(path,body){
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
    Object.assign(req,{method:body?'POST':'GET',url:path,headers:{host:'127.0.0.1:4310',authorization:'Bearer private-fixture-token','content-type':'application/json'}});
    let status,result;
    await handler(req,{writeHead(code){status=code;},end(data){result=JSON.parse(String(data));}});
    return{status,result};
  }
  const say=(requestId,text,conversationId)=>call('/api/conversation',{requestId,text,...(conversationId?{conversationId}:{})});
  return{call,say,workspace,setClock:value=>{clock=value;},inventoryCalls:()=>inventoryCalls};
}

test('voice-equivalent HTTP turns clarify and persist one reminder without repeating it',async t=>{
  const {say,workspace}=fixture(t);
  const first=await say('spoken-reminder-1','remind me to review the API');
  assert.equal(first.status,200);assert.equal(workspace.snapshot().reminders.length,0);
  const follow=await say('spoken-reminder-2','in 10 minutes',first.result.conversationId);
  assert.equal(follow.status,200);assert.match(follow.result.reply,/saved/i);
  assert.equal(workspace.snapshot().reminders.length,1);
  await say('spoken-reminder-2','in 10 minutes',first.result.conversationId);
  assert.equal(workspace.snapshot().reminders.length,1);
});

test('meeting commands and workspace views share canonical records',async t=>{
  const {say,call}=fixture(t);
  const result=await say('spoken-meeting-1','schedule meeting API review tomorrow at 3 pm for 30 minutes');
  assert.equal(result.status,200);assert.match(result.result.reply,/saved/i);
  const view=await call('/api/secretary/workspace');assert.equal(view.result.calendar[0].title,'API review');
  const duplicate=await say('spoken-meeting-2','schedule meeting Other review tomorrow at 3 pm for 30 minutes');
  assert.equal(duplicate.status,409);
  await say('spoken-meeting-3','cancel meeting API review');
  assert.equal((await call('/api/secretary/workspace')).result.calendar.length,0);
});

test('real activity generates a deduplicated notice that can be snoozed and acknowledged',async t=>{
  const {call,workspace}=fixture(t);
  const payload={requestId:'activity-observed-1',activeMinutes:65,idleSeconds:0,locked:false,appBundleId:'com.example.editor'};
  assert.equal((await call('/api/activity',payload)).status,200);
  await call('/api/activity',payload);
  const notices=await call('/api/notifications');assert.equal(notices.result.notifications.length,1);
  const id=notices.result.notifications[0].id;
  const result=await call(`/api/notifications/${id}`,{requestId:'notice-acknowledge-1',decision:'acknowledge'});
  assert.equal(result.status,200);assert.equal(workspace.notifications().length,0);
});

test('iTerm is never queried by automatic GET; explicit POST performs one observation',async t=>{
  const {call,inventoryCalls}=fixture(t);
  assert.equal((await call('/api/terminal/inventory')).status,404);assert.equal(inventoryCalls(),0);
  assert.equal((await call('/api/terminal/inventory',{})).status,200);assert.equal(inventoryCalls(),1);
});
