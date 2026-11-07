import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,chmodSync,realpathSync,existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Fault} from './engine.mjs';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const instant=()=>new Date().toISOString();
const maxBytes=1024*1024;
const codexPolicyArgs=['--strict-config','-c','default_permissions="kst-read"','-c','permissions.kst-read.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read",".env"="deny",".env.*"="deny","**/*.env"="deny","**/.env.*"="deny",".git"="deny",".codex"="deny",".agents"="deny",".aws"="deny","config.json"="deny"}}','-c','permissions.kst-read.network.enabled=false','-c','mcp_servers={}','-c','web_search="disabled"'];
const disabledFeatures=['hooks','plugins','apps','browser_use','computer_use','remote_plugin','shell_snapshot','workspace_dependencies'];
class DispatchFailure extends Error {constructor(code,message,uncertain=false){super(message);this.code=code;this.uncertain=uncertain;}}

/** No provider transport is invoked until a current, stored approval reaches dispatch. */
export function createExternalService({dataDir,environment=process.env,fetchImpl=globalThis.fetch,spawnImpl=spawn}={}) {
  if(!isAbsolute(dataDir||'')||dataDir==='/'||dataDir===homedir())throw new Error('A dedicated external-service profile is required.');
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const dir=lstatSync(dataDir);if(dir.isSymbolicLink()||dir.uid!==process.getuid())throw new Error('External-service profile must be privately owned.');
  dataDir=realpathSync(dataDir);
  chmodSync(dataDir,0o700);
  const file=join(dataDir,'external.sqlite');
  for(const suffix of ['','-wal','-shm']){try{const s=lstatSync(file+suffix);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid())throw new Error('Unsafe external-service database.');chmodSync(file+suffix,0o600);}catch(error){if(error.code!=='ENOENT')throw error;}}
  const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS external_jobs(id TEXT PRIMARY KEY,approval_id TEXT UNIQUE NOT NULL,approval_hash TEXT NOT NULL,data TEXT NOT NULL);');
  for(const suffix of ['','-wal','-shm']){try{chmodSync(file+suffix,0o600);}catch(error){if(error.code!=='ENOENT')throw error;}}
  const active=new Map(),terminations=new Set();let closing=false;
  const get=id=>{const row=db.prepare('SELECT data FROM external_jobs WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
  const save=job=>{job.updatedAt=instant();db.prepare('UPDATE external_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);};
  for(const row of db.prepare('SELECT data FROM external_jobs').all()){
    const job=JSON.parse(row.data);
    if(['prepared','running'].includes(job.status)){job.status='unknown';job.message='Interrupted by restart. The provider may have processed the request; it will not be repeated.';save(job);}
  }

  function describe(service) {
    const scope={service,transport:'unavailable',destination:null,model:null,maxOutputTokens:1024,deadlineSeconds:45,context:[]};
    let configured=false,key='';
    if(service==='chatgpt'){
      scope.transport='openai-api';scope.destination='https://api.openai.com/v1/responses';scope.model=environment.KST_OPENAI_MODEL||null;
      key=environment.KST_OPENAI_API_KEY||'';configured=Boolean(key&&scope.model);
      scope.context=['Only this prompt is sent; no files, audio, terminal output, or conversation history.','Uses your configured OpenAI API key/model and API billing; a ChatGPT subscription is not assumed.'];
    }else if(service==='claude'){
      scope.transport='claude-api';scope.destination='https://api.anthropic.com/v1/messages';scope.model=environment.KST_CLAUDE_MODEL||null;
      key=environment.KST_ANTHROPIC_API_KEY||'';configured=Boolean(key&&scope.model);
      scope.context=['Only this prompt is sent; no files, audio, terminal output, or conversation history.','Uses your configured Claude API key/model and API billing.'];
    }else if(service==='web'){
      scope.transport='chrome-incognito';scope.destination='https://www.google.com/search';scope.deadlineSeconds=10;configured=process.platform==='darwin';
      scope.context=['Opens Google Search in a visible Chrome Incognito window.','Only the typed or spoken query is sent to Google. kst does not read or return page contents.'];
    }else if(service==='codex'){
      scope.transport='codex-cli';scope.deadlineSeconds=120;
      try{
        const binary=environment.KST_CODEX_PATH,project=environment.KST_CODEX_PROJECT;
        if(environment.KST_CODEX_ENABLED==='1'&&isAbsolute(binary||'')&&isAbsolute(project||'')){
          const executable=realpathSync(binary),root=realpathSync(project),stat=lstatSync(root),exe=lstatSync(executable);
          if(!exe.isFile()||!stat.isDirectory()||root==='/'||root===homedir()||homedir().startsWith(root+'/')||dataDir===root||dataDir.startsWith(root+'/'))throw Error('Unsupported Codex scope.');
          for(let directory=root;directory!==dirname(directory);directory=dirname(directory)){if(directory!==homedir()&&existsSync(join(directory,'.codex','config.toml')))throw Error('Project-local Codex configuration requires a separately reviewed adapter.');}
          scope.destination=executable;scope.project=root;scope.projectIdentity=`${stat.dev}:${stat.ino}`;scope.executableIdentity=`${exe.dev}:${exe.ino}:${exe.mtimeMs}`;configured=true;
        }
      }catch{configured=false;}
      scope.context=[`Installed Codex CLI, restricted read-only project profile${scope.project?` in ${scope.project}`:''}. No project write access is granted.`, 'An offline scope probe must pass before model dispatch. Project files may be sent to Codex; common secret/config paths, plugins, hooks and direct tool network access are denied. Existing CLI account authentication is used.','This is an approved bounded agent job, not a prompt-only API request.'];
    }else scope.context=['This service has no configured adapter; approving will not switch to another service.'];
    const scopeHash=fingerprint({...scope,keyFingerprint:key?fingerprint(key):null});
    return{...scope,configured,scopeHash};
  }

  function stopChild(entry){
    if(entry.termination)return;
    const child=entry.child;if(!child?.pid||child.exitCode!==null&&child.exitCode!==undefined)return;
    try{process.kill(-child.pid,'SIGTERM');}catch{return;}
    let settle;
    const task=new Promise(done=>{settle=done;});entry.termination=task;terminations.add(task);
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}settle();},1500);
    child.once('close',()=>{clearTimeout(timer);settle();});
    task.finally(()=>terminations.delete(task));
  }

  async function readResponse(response){
    let size=0,chunks=[];
    if(response.body){for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes){await response.body.cancel?.().catch(()=>{});throw new DispatchFailure('OUTPUT_LIMIT','Provider output exceeded the response limit; review its receipt.',true);}chunks.push(Buffer.from(chunk));}}
    const text=Buffer.concat(chunks).toString('utf8');
    if(!response.ok)throw new DispatchFailure(`PROVIDER_HTTP_${response.status}`,`Provider rejected the request (HTTP ${response.status}). No fallback was used.`);
    try{return JSON.parse(text);}catch{throw new DispatchFailure('INVALID_PROVIDER_RESPONSE','Provider returned an unreadable response. The request is not repeated.',true);}
  }

  async function modelRequest(scope,prompt,signal){
    const openai=scope.transport==='openai-api';
    const key=openai?environment.KST_OPENAI_API_KEY:environment.KST_ANTHROPIC_API_KEY;
    const body=openai?{model:scope.model,input:prompt,store:false,max_output_tokens:1024}:{model:scope.model,messages:[{role:'user',content:prompt}],max_tokens:1024};
    const headers={'Content-Type':'application/json',Authorization:`Bearer ${key}`};
    if(!openai)headers['anthropic-version']='2026-10-21';
    const response=await fetchImpl(scope.destination,{method:'POST',headers,body:JSON.stringify(body),signal,redirect:'error'});
    const data=await readResponse(response);
    const text=openai?(data.output||[]).flatMap(item=>item.type==='message'?(item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text):[]).join('\n'):(data.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
    if(!text)throw new DispatchFailure('NO_TEXT_RESULT','Provider returned no verified text result. Tool calls are not executed.',true);
    const partial=text.length>16000||data.status==='incomplete'||data.stop_reason==='max_tokens';
    return{text:text.slice(0,16000),partial,message:partial?'Provider returned a partial or truncated response.':'Approved provider response received.',providerResponseId:data.id||null,evidence:[{type:'provider-http',status:response.status}]};
  }

  async function childRequest(scope,prompt,entry){
    const executable=scope.destination;
    const run=(args,preflight=false)=>new Promise((accept,reject)=>{
      let out='',bytes=0,settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;error?reject(error):accept(result);};
      let child;
      try{child=spawnImpl(executable,args,{cwd:scope.project,shell:false,detached:true,stdio:['pipe','pipe','pipe'],env:{HOME:homedir(),PATH:`${dirname(executable)}:/usr/bin:/bin:/usr/sbin:/sbin`,LANG:'en_US.UTF-8'}});}catch{finish(new DispatchFailure('LAUNCH_FAILED','The approved local client could not start.'));return;}
      entry.child=child;entry.termination=null;
      child.stdin.on('error',()=>{});child.stdin.end(preflight?undefined:prompt);
      const collect=chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>maxBytes){stopChild(entry);finish(new DispatchFailure('OUTPUT_LIMIT','Client output limit reached. Its result is uncertain.',true));}else out+=chunk.toString();};
      child.stdout.on('data',collect);child.stderr.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>maxBytes){stopChild(entry);finish(new DispatchFailure('OUTPUT_LIMIT','Client output limit reached.',true));}});
      child.on('error',()=>finish(new DispatchFailure('LAUNCH_FAILED','The approved local client could not start. Check its path and permissions.')));
      child.on('close',code=>{
        if(code!==0){finish(new DispatchFailure(preflight?'SCOPE_CHECK_FAILED':'CLIENT_FAILED',preflight?'Codex scope verification failed. No model request was started.':'Approved client failed or needs authentication. No alternate provider was called.',!preflight));return;}
        finish(null,out);
      });
    });
    const probe=join(dataDir,`kst-scope-probe-${randomUUID()}`);
    writeFileSync(probe,'non-secret scope test',{flag:'wx',mode:0o600});
    try{
      const policyOnly=codexPolicyArgs.filter(value=>value!=='--strict-config');
      const verified=await run(['sandbox','--include-managed-config','--permission-profile','kst-read',...policyOnly,'-C',scope.project,'--','/bin/sh','-c','ls "$1" >/dev/null 2>&1 || exit 90; if cat "$2" >/dev/null 2>&1; then exit 91; fi; printf kst-scope-ok','kst-scope-check',scope.project,probe],true);
      if(verified.trim()!=='kst-scope-ok')throw new DispatchFailure('SCOPE_CHECK_FAILED','Codex did not verify the restricted read scope. No model request was started.');
    }finally{unlinkSync(probe);}
    if(entry.job.status!=='running')throw new DispatchFailure('CANCELLED','Stopped before model dispatch.',true);
    const out=await run(['exec','--ignore-user-config','--json','--ephemeral','--skip-git-repo-check',...codexPolicyArgs,...disabledFeatures.flatMap(name=>['--disable',name]),'--cd',scope.project,'-']);
    const messages=[];for(const line of out.split('\n')){try{const event=JSON.parse(line);if(event.type==='item.completed'&&event.item?.type==='agent_message'&&typeof event.item.text==='string')messages.push(event.item.text);}catch{}}
    if(!messages.length)throw new DispatchFailure('NO_TEXT_RESULT','Codex returned no verified final text. Check its authentication and receipt.',true);
    const text=messages.join('\n');
    return{text:text.slice(0,16000),partial:text.length>16000,message:text.length>16000?'Read-only Codex response truncated; inspect the receipt.':'Read-only Codex response received.',evidence:[{type:'cli-exit',exitCode:0,scopeProbe:'passed',profile:'kst-read'}]};
  }

  function openWebSearch(query){
    if(process.platform!=='darwin')throw new Fault('BROWSER_UNAVAILABLE','Chrome Incognito handoff requires macOS.',503);
    if(typeof query!=='string'||!query.trim()||query.length>1200)throw new Fault('INVALID_QUERY','Give a web search under 1,200 characters.',400);
    const url=`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
    return new Promise((resolve,reject)=>{
      let child,settled=false,timer;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
      try{child=spawnImpl('/usr/bin/open',['-na','Google Chrome','--args','--incognito','--new-window',url],{shell:false,detached:true,stdio:['ignore','ignore','ignore'],env:{HOME:homedir(),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'}});}
      catch{finish(new Fault('BROWSER_LAUNCH_FAILED','Could not launch Google Chrome. Check that Chrome is installed.',503));return;}
      timer=setTimeout(()=>{try{child.kill('SIGTERM');}catch{}finish(new Fault('BROWSER_LAUNCH_TIMEOUT','Chrome did not confirm the Incognito launch. Check the app and try again.',504));},10000);
      child.once('error',()=>finish(new Fault('BROWSER_LAUNCH_FAILED','Could not launch Google Chrome. Check that Chrome is installed.',503)));
      child.once('close',code=>code===0?finish(null,{status:'opened',url,message:'You can read now'}):finish(new Fault('BROWSER_LAUNCH_FAILED','Chrome Incognito did not open. Check that Google Chrome is installed.',503)));
    });
  }

  async function dispatch(approval){
    if(!approval||approval.status!=='approved'||typeof approval.id!=='string'||typeof approval.prompt!=='string'||!approval.prompt.trim()||approval.prompt.length>4000)throw new Fault('APPROVAL_REQUIRED','A stored, approved request is required.',403);
    if(approval.service==='web')throw new Fault('BROWSER_HANDOFF_REQUIRED','Web requests open directly in Chrome Incognito and do not use external-service approval records.',400);
    const approvedHash=fingerprint({id:approval.id,service:approval.service,prompt:approval.prompt,scopeHash:approval.scopeHash});
    const previous=db.prepare('SELECT approval_hash,data FROM external_jobs WHERE approval_id=?').get(approval.id);
    if(previous){if(previous.approval_hash!==approvedHash)throw new Fault('APPROVAL_CHANGED','Approval contents changed; nothing was repeated.',409);return JSON.parse(previous.data);}
    const scope=describe(approval.service),job={id:`external-${randomUUID()}`,kind:`external:${approval.service}`,service:approval.service,approvalId:approval.id,status:'prepared',createdAt:instant(),updatedAt:instant(),evidence:[],message:'Preparing the approved request.'};
    db.prepare('INSERT INTO external_jobs VALUES(?,?,?,?)').run(job.id,approval.id,approvedHash,JSON.stringify(job));
    if(Date.parse(approval.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(approval.expiresAt))||approval.scopeHash!==scope.scopeHash){job.status='blocked';job.message='Approval expired or service configuration changed. Ask again before sharing anything.';save(job);return job;}
    if(closing||!scope.configured||active.size>=1){job.status='blocked';job.message=closing?'Service is stopping; nothing was sent.':!scope.configured?'Service is not configured. Set its credentials/model or CLI scope; nothing was sent.':'Another external request is active. Nothing was queued or sent.';save(job);return job;}
    job.status='running';job.message='Executing exactly the approved request.';save(job);
    const entry={controller:new AbortController(),child:null,job,interrupt:null};active.set(job.id,entry);
    let timer;
    try{
      const operation=['openai-api','claude-api'].includes(scope.transport)?modelRequest(scope,approval.prompt,entry.controller.signal):childRequest(scope,approval.prompt,entry);
      const interrupted=new Promise((_,reject)=>{entry.interrupt=reject;});
      const result=await Promise.race([operation,interrupted,new Promise((_,reject)=>{timer=setTimeout(()=>{entry.controller.abort();stopChild(entry);reject(new DispatchFailure('DEADLINE','Provider deadline expired; it may have processed the request. No retry was sent.',true));},scope.deadlineSeconds*1000);})]);
      if(job.status==='running'){Object.assign(job,result,{status:scope.transport==='browser-search'?'opened':result.partial?'partial':'succeeded'});save(job);}
    }catch(error){if(job.status==='running'){job.status=error instanceof DispatchFailure&&!error.uncertain?'failed':'unknown';job.message=error instanceof DispatchFailure?error.message:'Connection ended without a verified result. The provider may have processed the request; no retry was sent.';job.errorCode=error instanceof DispatchFailure?error.code:'UNVERIFIED_OUTCOME';save(job);}}
    finally{clearTimeout(timer);active.delete(job.id);}
    return structuredClone(job);
  }

  function cancel(id){
    const job=get(id);if(!job)throw new Fault('NOT_FOUND','External job not found.',404);
    if(['prepared','running'].includes(job.status)){
      const entry=active.get(id);if(entry){entry.job.status='unknown';entry.job.message='Stopped waiting. The provider may already have processed the request; no retry is allowed.';save(entry.job);entry.controller.abort();stopChild(entry);entry.interrupt?.(new DispatchFailure('CANCELLED','Request interrupted; provider processing may already have occurred.',true));return structuredClone(entry.job);}
      job.status='unknown';job.message='No live executor could confirm cancellation. Review before making a new request.';save(job);
    }return job;
  }
  function start(approval){
    const task=dispatch(approval);task.catch(()=>{});
    const row=db.prepare('SELECT data FROM external_jobs WHERE approval_id=?').get(approval.id);
    if(!row)throw new Fault('DISPATCH_REJECTED','No approved request was admitted.',409);
    return JSON.parse(row.data);
  }
  return{describe,dispatch,start,openWebSearch,cancel,status:()=>({services:['chatgpt','codex','claude','web','antigravity'].map(describe),jobs:db.prepare('SELECT data FROM external_jobs ORDER BY rowid DESC LIMIT 100').all().map(row=>JSON.parse(row.data))}),close:async()=>{closing=true;for(const id of active.keys())cancel(id);while(active.size)await new Promise(done=>setTimeout(done,10));await Promise.all([...terminations]);db.close();}};
}
