import { readFileSync, realpathSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Fault } from './engine.mjs';

const string=(v,min=1,max=4000)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
function shape(body, required, optional=[]) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>![...required,...optional].includes(k))||required.some(k=>!(k in body))) throw new Fault('INVALID_BODY','Request does not match the supported schema.');
}
function validId(id) {if(!string(id,8,128)||!/^[\w-]+$/.test(id))throw new Fault('INVALID_ID','Use a unique request ID of 8–128 letters, numbers, underscores or hyphens.');}
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

// Transport-independent handler: the same implementation serves sockets and deterministic tests.
export function createRequestHandler({engine,workspace,terminal,external,token,port,staticDir,getActualPort=()=>port,secretary={snapshot:()=>({status:'disabled',data:{tasks:[],notes:[],reminders:[],calendar:[]}})}}) {
    const secret=Buffer.from(token);
    const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
    const activeJobs=()=>[...(terminal?.status?.().jobs??[]),...(external?.status?.().jobs??[])].filter(j=>['prepared','running','cancelling'].includes(j.status)).slice(0,100);
    const stopAll=async(requestId)=>{const receipt=engine.stop(requestId,activeJobs().map(j=>j.id));workspace?.endConversation();const jobs=await Promise.all((receipt.jobIds??[]).map(async id=>{try{return id.startsWith('external-')?external.cancel(id):await terminal.cancel(id);}catch{return {id,status:'unknown',message:'Cancellation could not be verified. Review the job receipt before retrying.'};}}));return {...receipt,jobs,reply:jobs.length?`Stop requested. ${jobs.map(j=>`Job ${j.id}: ${j.status}`).join('; ')}`:'Stopped. Pending requests cancelled; no owned jobs were running.'};};
    const decide=(id,decision,revision)=>{
      const result=engine.approval(id,decision,revision,{dispatch:Boolean(external)});
      if(!external||result.approval.status!=='approved')return result;
      const job=external.start(result.approval);
      return{...result,job,dispatched:['running','succeeded','opened'].includes(job.status),message:job.status==='running'?'Approved request started. Its durable receipt will show the result; no other service will be called.':job.message};
    };
    return async(req,res)=>{
      const requestId=randomUUID();
      const headers={'X-Request-ID':requestId,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Referrer-Policy':'no-referrer'};
      const json=(status,body)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
      try {
        const expectedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
        // Port 0 is reserved for tests; use the actual listening port.
        const actualPort=getActualPort();
        expectedHosts.add(`127.0.0.1:${actualPort}`);expectedHosts.add(`localhost:${actualPort}`);
        if(!expectedHosts.has(req.headers.host))throw new Fault('HOST_REJECTED','Unsupported local host.',403);
        if(req.headers.origin&&!origins.has(req.headers.origin)&&!new Set([`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`]).has(req.headers.origin))throw new Fault('ORIGIN_REJECTED','This origin is not paired.',403);
        const url=new URL(req.url,`http://${req.headers.host}`),path=url.pathname;
        if(req.method==='GET'&&path==='/health')return json(200,{app:'kst',status:'ok',mode:workspace?'secretary':'scratch',version:'0.4.1',uptimeSeconds:Math.floor(process.uptime())});
        if(path.startsWith('/api/')) {
          const incoming=Buffer.from((req.headers.authorization??'').replace(/^Bearer /,''));
          if(incoming.length!==secret.length||!timingSafeEqual(incoming,secret))throw new Fault('UNAUTHORIZED','Pair this interface using the private local token.',401);
          if(req.method==='GET'&&path==='/api/secretary')return json(200,secretary.snapshot());
          if(req.method==='GET'&&path==='/api/secretary/workspace'&&workspace){workspace.tick();return json(200,workspace.snapshot());}
          if(req.method==='GET'&&path==='/api/notifications'&&workspace){if(terminal)workspace.observeJobs(terminal.status().jobs);workspace.tick();return json(200,{notifications:workspace.notifications()});}
          if(req.method==='GET'&&path==='/api/terminal/status'&&terminal)return json(200,terminal.status());
          if(req.method==='GET'&&path==='/api/external/status'&&external)return json(200,external.status());
          if(req.method==='GET'&&path==='/api/status'){
            const state=engine.status(),w=workspace?.snapshot(),term=terminal?.status();
            if(external){state.jobs=[...state.jobs,...external.status().jobs];state.capabilities=state.capabilities.map(c=>c.id==='external'?{...c,status:'connected',detail:'OpenAI/Claude/Codex require per-request approval and account setup. Web opens Google Search in visible Chrome Incognito without approval and leaves browsing to you.'}:c);}
            if(w){state.mode=w.mode;state.tasks=w.tasks;state.notes=w.notes;state.capabilities=state.capabilities.map(c=>c.id==='conversation'?{...c,detail:'Local tasks, notes, reminders, meetings, planning and timeline.'}:c.id==='sync'?{...c,status:w.mode==='source-write'?'shared-workspace':'local-workspace',detail:w.mode==='source-write'?'Personal Secretary shared database with verified pre-write backup.':'Personal Secretary schema in a private local workspace; optional source connection.'}:c.id==='nudges'?{...c,status:'ready',detail:'Native activity and local calendar feed the local nudge rules; fixture preview remains available.'}:c.id==='terminal'&&term?{...c,status:term.mode,detail:'Explicitly configured fixed-argument project recipes and read-only iTerm inventory; arbitrary shell commands are disabled.'}:c);}
            return json(200,state);
          }
          if(req.method==='GET'&&path==='/api/settings')return json(200,engine.status().settings);
          if(req.method==='GET'&&path==='/api/approvals')return json(200,{approvals:engine.status().approvals});
          if(req.method==='GET'&&path==='/api/jobs')return json(200,{jobs:[...engine.status().jobs,...(external?.status().jobs??[])]});
          if(!['POST','PATCH'].includes(req.method))throw new Fault('NOT_FOUND','Endpoint not found.',404);
          if(!req.headers['content-type']?.startsWith('application/json'))throw new Fault('CONTENT_TYPE','Use application/json.',415);
          let bytes=0,parts=[];
          for await(const part of req){bytes+=part.length;if(bytes>32768)throw new Fault('BODY_TOO_LARGE','Request body exceeds 32 KB.',413);parts.push(part);}
          let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Fault('INVALID_JSON','Malformed JSON.');}
          if(path==='/api/conversation'&&req.method==='POST') {
            shape(body,['requestId','text'],['conversationId']);validId(body.requestId);
            if(!string(body.text)||body.conversationId!==undefined&&!string(body.conversationId,1,128))throw new Fault('INVALID_TEXT','A nonempty command up to 4,000 characters is required.');
            if(/^stop[.!?]?$/i.test(body.text.trim()))return json(200,{...await stopAll(body.requestId),conversationId:body.conversationId??`conversation-${body.requestId}`});
            if(/^(?:hello|hi)[.!?]?$/i.test(body.text.trim()))return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:'I’m here. What would you like to do?'});
            if(/^status[.!?]?$/i.test(body.text.trim()))return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:`Local core connected. ${workspace?'Secretary tasks, notes, reminders, meetings, planning and timeline are available. ':''}${terminal?'Reviewed terminal recipes are available. ':''}${external?'ChatGPT, Claude and Codex require your approval; web opens Chrome Incognito directly. ':''}Voice and activity permissions are managed in the Mac app.`});
            const externalDecision=body.text.trim().match(/^(approve|decline) external request[.!?]?$/i);
            if(externalDecision){
              const target=engine.externalDecisionTarget(body.requestId,body.text,body.conversationId);
              if(!target.id)return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:target.reply});
              const result=decide(target.id,externalDecision[1].toLowerCase()==='approve'?'approve':'deny',target.revision);
              return json(200,{...result,reply:result.message,conversationId:body.conversationId});
            }
            if(/^show external results[.!?]?$/i.test(body.text.trim())&&external){const jobs=external.status().jobs.filter(j=>j.text).slice(0,3);return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:jobs.length?jobs.map(j=>`${j.service} (${j.status}): ${j.text}`).join('\n\n'):'No verified external result is available. Check the receipt or service setup.'});}
            const service=body.text.trim().match(/^(?:ask|use|search|browse)(?:\s+the)?\s+(chatgpt|codex|claude|antigravity|web)\b/i)?.[1]?.toLowerCase();
            if(service==='web'){
              if(!external)throw new Fault('BROWSER_UNAVAILABLE','The Chrome Incognito handoff is not available in this core.',503);
              const query=body.text.trim().replace(/^(?:ask|use|search|browse)(?:\s+the)?\s+web\b\s*/i,'').trim();
              if(!query)return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:'What would you like me to search for? Say “search web” followed by your query.'});
              const result=await external.openWebSearch(query);
              return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:result.message,browser:{status:result.status}});
            }
            if(service)return json(200,engine.conversation(body.requestId,body.text,body.conversationId,undefined,external?.describe(service)));
            if(workspace){
              const projectCancel=body.text.trim().match(/^cancel tests in ([\w-]+)[.!?]?$/i),cancelThat=/^cancel that command[.!?]?$/i.test(body.text.trim());
              if((projectCancel||cancelThat)&&terminal){const jobs=activeJobs().filter(j=>!j.id.startsWith('external-')&&(!projectCancel||(j.projectId===projectCancel[1]&&j.recipeId==='test')));if(jobs.length!==1)return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:jobs.length?'More than one job is active. Say “cancel tests in PROJECT” or select a specific job in the dashboard.':'No matching owned terminal job is running. Use Stop to interrupt all foreground work.'});const job=await terminal.cancel(jobs[0].id);return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:`Job ${job.status}: ${job.message??job.id}`,job});}
              const recipe=body.text.trim().match(/^run (tests|git status|recipe test|recipe git-status) in ([\w-]+)$/i);
              if(recipe&&terminal){const job=await terminal.runRecipe({requestId:body.requestId,projectId:recipe[2],recipeId:['tests','recipe test'].includes(recipe[1].toLowerCase())?'test':'git-status'});return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:`Approved project recipe ${job.status}: ${job.message??job.id}`,job});}
              const cancellation=body.text.trim().match(/^cancel job ([\w-]+)$/i);if(cancellation&&terminal){const job=await terminal.cancel(cancellation[1]);return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:`Job ${job.status}: ${job.message??job.id}`,job});}
              if(/^show terminals$/i.test(body.text.trim())&&terminal){const inventory=await terminal.inventory();return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:inventory.message??`Found ${inventory.sessions?.length??0} terminal sessions.`,inventory});}
              if(/^(?:help|what can you do)[.!?]?$/i.test(body.text.trim()))return json(200,{conversationId:body.conversationId??`conversation-${body.requestId}`,reply:'Say “add task TITLE”, “complete task TITLE”, “note TEXT”, “remind me to TITLE in 10 minutes”, “schedule meeting TITLE tomorrow at 3 pm for 30 minutes”, “reschedule meeting TITLE tomorrow at 4 pm for 30 minutes”, “cancel meeting TITLE”, “snooze reminder TITLE for 15 minutes”, “show calendar”, “show timeline”, or “plan my day”. Plans require “apply plan ID”. Ask before using ChatGPT, Claude or Codex. “Search web QUERY” opens Google Search in a visible Chrome Incognito window without approval; I do not read the page. Terminal recipes require explicit approved project configuration.'});
              if(/^(?:stop|we.?re done|end conversation|stop listening)[.!?]?$/i.test(body.text.trim()))workspace.endConversation(body.conversationId);
              const result=workspace.converse(body.requestId,body.text,body.conversationId);if(result)return json(200,result);
            }
            const sourceSnapshot=/^(?:show|list) (?:personal )?secretary (tasks|notes|reminders|calendar)[.!?]?$/i.test(body.text.trim())?secretary.snapshot():undefined;
            return json(200,engine.conversation(body.requestId,body.text,body.conversationId,sourceSnapshot));
          }
          if(path==='/api/settings'&&req.method==='PATCH') {
            shape(body,['expectedRevision','wakePhrase']);
            if(!Number.isSafeInteger(body.expectedRevision)||!string(body.wakePhrase,1,80))throw new Fault('INVALID_SETTINGS','Supply the current revision and wake phrase.');
            return json(200,engine.settings(body.expectedRevision,body.wakePhrase));
          }
          if(/^\/api\/approvals\/[\w-]+$/.test(path)&&req.method==='POST') {
            shape(body,['decision','revision']);
            if(!['approve','deny'].includes(body.decision)||!Number.isSafeInteger(body.revision))throw new Fault('INVALID_APPROVAL','Supply approve/deny and the current revision.');
            return json(200,decide(path.split('/').at(-1),body.decision,body.revision));
          }
          if(/^\/api\/external\/jobs\/[\w-]+\/cancel$/.test(path)&&req.method==='POST'&&external){shape(body,['requestId']);validId(body.requestId);return json(200,external.cancel(path.split('/').at(-2)));}
          if(path==='/api/stop'&&req.method==='POST'){shape(body,['requestId']);validId(body.requestId);return json(200,await stopAll(body.requestId));}
          if(path==='/api/secretary/actions'&&req.method==='POST'&&workspace){shape(body,['requestId','action']);validId(body.requestId);return json(200,workspace.action(body.requestId,body.action));}
          if(path==='/api/activity'&&req.method==='POST'&&workspace){
            shape(body,['requestId','activeMinutes','idleSeconds','locked'],['inMeeting','quietHours','appBundleId']);validId(body.requestId);
            if(!Number.isFinite(body.activeMinutes)||body.activeMinutes<0||body.activeMinutes>1440||!Number.isFinite(body.idleSeconds)||body.idleSeconds<0||body.idleSeconds>86400||typeof body.locked!=='boolean'||['inMeeting','quietHours'].some(k=>body[k]!==undefined&&typeof body[k]!=='boolean')||body.appBundleId!==undefined&&!string(body.appBundleId,1,200))throw new Fault('INVALID_ACTIVITY','Supply bounded activity measurements and boolean interruption state.');
            const {requestId,...activity}=body;return json(200,workspace.activity(requestId,activity));
          }
          if(/^\/api\/notifications\/[\w:.-]+$/.test(path)&&req.method==='POST'&&workspace){shape(body,['requestId','decision'],['minutes']);validId(body.requestId);return json(200,workspace.notification(path.split('/').at(-1),body.requestId,body.decision,body.minutes));}
          if(path==='/api/terminal/run'&&req.method==='POST'&&terminal){shape(body,['requestId','projectId','recipeId']);validId(body.requestId);if(!string(body.projectId,1,100)||!string(body.recipeId,1,100))throw new Fault('INVALID_RECIPE','Supply an approved project and recipe.');return json(200,await terminal.runRecipe(body));}
          if(path==='/api/terminal/inventory'&&req.method==='POST'&&terminal){shape(body,[],['requestId']);return json(200,await terminal.inventory());}
          if(/^\/api\/terminal\/jobs\/[\w-]+\/cancel$/.test(path)&&req.method==='POST'&&terminal){shape(body,['requestId']);validId(body.requestId);return json(200,await terminal.cancel(path.split('/').at(-2)));}
          if(/^\/api\/terminal\/jobs\/[\w-]+\/show$/.test(path)&&req.method==='POST'&&terminal?.openJobInITerm){shape(body,[],['requestId']);return json(200,await terminal.openJobInITerm(path.split('/').at(-2)));}
          if(path==='/api/nudges/evaluate'&&req.method==='POST') {
            shape(body,['now','activity']);shape(body.activity,['activeMinutes','locked','inMeeting','quietHours']);
            if(!string(body.now,10,40)||!Number.isFinite(Date.parse(body.now))||!Number.isFinite(body.activity.activeMinutes)||body.activity.activeMinutes<0||body.activity.activeMinutes>1440||['locked','inMeeting','quietHours'].some(k=>typeof body.activity[k]!=='boolean'))throw new Fault('INVALID_FIXTURE','Use a valid timestamp, active minutes (0–1440), and boolean interruption flags.');
            return json(200,engine.nudges(body.now,body.activity));
          }
          throw new Fault('NOT_FOUND','Endpoint not found.',404);
        }
        if(req.method!=='GET')throw new Fault('NOT_FOUND','Endpoint not found.',404);
        const requested=path==='/kst-logo.png'?'public/kst-logo.png':decodeURIComponent(path)==='/'?'index.html':decodeURIComponent(path).slice(1);
        if(!['index.html','app.js','styles.css','public/kst-logo.png','public/kst-logo.svg'].includes(requested))throw new Fault('NOT_FOUND','Asset not found.',404);
        const file=resolve(staticDir,requested),root=realpathSync(staticDir);
        if(!file.startsWith(resolve(staticDir)+sep))throw new Fault('NOT_FOUND','Asset not found.',404);
        let actual;try{actual=realpathSync(file);}catch{throw new Fault('NOT_FOUND','Asset not found.',404);}
        if(!actual.startsWith(root+sep)||!contentTypes[extname(actual)])throw new Fault('NOT_FOUND','Asset not found.',404);
        res.writeHead(200,{...headers,'Content-Type':contentTypes[extname(actual)]});res.end(readFileSync(actual));
      }catch(error){const known=error instanceof Fault;if(!known)console.error(`[kst] request=${requestId} code=INTERNAL_ERROR`);json(known?error.status:500,{error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'Operation failed. Check local storage and retry after reviewing the failure.',retryable:!known,requestId}});}
    };
}
