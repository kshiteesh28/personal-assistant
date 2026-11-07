import http from 'node:http';
import { mkdirSync, lstatSync, openSync, writeFileSync, readFileSync, closeSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.mjs';
import { createRequestHandler } from './http.mjs';
import { createSecretaryAdapter } from './secretary.mjs';
import { Workspace } from './workspace.mjs';
import { createTerminalService } from './terminal.mjs';
import { createExternalService } from './external.mjs';

export const defaultDataDir = join(homedir(),'Library','Application Support','kst-dev','core');
const webRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../kst-web');
const string=(v,min=1,max=4000)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
export function startServer(options={}) {
  const dataDir=options.dataDir??process.env.KST_DATA_DIR??defaultDataDir;
  const port=options.port??Number(process.env.KST_PORT??4310);
  const staticDir=options.webDir??process.env.KST_WEB_DIR??webRoot;
  const secretary=createSecretaryAdapter({sourcePath:options.secretaryPath??process.env.KST_SECRETARY_DB});
  if(!isAbsolute(dataDir)||dataDir==='/'||dataDir===homedir())throw new Error('KST_DATA_DIR must be a dedicated absolute directory.');
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  if(lstatSync(dataDir).isSymbolicLink()||lstatSync(dataDir).uid!==process.getuid())throw new Error('Data directory must be owned by this user and must not be a symlink.');
  chmodSync(dataDir,0o700);
  const lockPath=join(dataDir,'owner.lock'), nonce=randomBytes(16).toString('hex');
  let fd;
  try {fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,nonce,startedAt:new Date().toISOString()}));closeSync(fd);} catch {throw new Error(`kst profile is locked. Another core may own it. After an abnormal exit, verify no owner remains before manually archiving ${lockPath}. Never remove a live owner's lock.`);}
  let engine,workspace,terminal,external,server,timer,closed=false,cleanupPromise;
  const cleanup=()=>cleanupPromise??=(async()=>{closed=true;clearInterval(timer);let executorsStopped=false;try{await external?.close?.();await terminal?.close?.();executorsStopped=true;}finally{try{workspace?.close();}finally{engine?.close();}if(executorsStopped){try{if(JSON.parse(readFileSync(lockPath,'utf8')).nonce===nonce)unlinkSync(lockPath);}catch{}}}})();
  try {
    const tokenPath=join(dataDir,'token');
    let token=options.token??process.env.KST_TOKEN;
    if(!token){try{const stat=lstatSync(tokenPath);if(stat.isSymbolicLink()||stat.uid!==process.getuid()||!stat.isFile())throw Error('Token must be a regular file owned by this user.');chmodSync(tokenPath,0o600);token=readFileSync(tokenPath,'utf8').trim();}catch(e){if(e.code!=='ENOENT')throw e;token=randomBytes(32).toString('hex');writeFileSync(tokenPath,token,{flag:'wx',mode:0o600});}}
    if(!string(token,24,256))throw Error('KST_TOKEN must contain 24–256 characters.');
    for(const name of ['kst.sqlite','kst.sqlite-wal','kst.sqlite-shm']){try{const stat=lstatSync(join(dataDir,name));if(stat.isSymbolicLink()||stat.uid!==process.getuid()||!stat.isFile())throw Error('Database files must be regular files owned by this user.');chmodSync(join(dataDir,name),0o600);}catch(e){if(e.code!=='ENOENT')throw e;}}
    engine=new Engine(join(dataDir,'kst.sqlite'));
    workspace=new Workspace({dataDir,sourcePath:options.secretaryPath??process.env.KST_SECRETARY_DB,sourceWrite:options.secretaryWrite??process.env.KST_SECRETARY_WRITE==='1'});
    const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
    let projects=options.projects??[{id:'kst',label:'kst app self-tests',root:projectRoot,recipes:[{id:'test',executable:process.execPath,args:['--test',join(projectRoot,'packages/kst-core/test/http-handler.test.mjs'),join(projectRoot,'packages/kst-core/test/workspace.test.mjs')],timeoutMs:120000}]}];
    if(!options.projects&&process.env.KST_PROJECTS_FILE){const file=process.env.KST_PROJECTS_FILE;if(!isAbsolute(file)||lstatSync(file).isSymbolicLink())throw Error('Project configuration must be an absolute regular file.');projects=JSON.parse(readFileSync(file,'utf8'));}
    terminal=createTerminalService({dataDir,projects,tokenFile:tokenPath,getCoreURL:()=>`http://127.0.0.1:${server?.address()?.port??port}`});
    external=createExternalService({dataDir:join(dataDir,'external')});
    for(const name of ['kst.sqlite','kst.sqlite-wal','kst.sqlite-shm']){try{chmodSync(join(dataDir,name),0o600);}catch(e){if(e.code!=='ENOENT')throw e;}}
    server=http.createServer(createRequestHandler({engine,workspace,terminal,external,token,port,staticDir,secretary,getActualPort:()=>server.address()?.port}));
    server.requestTimeout=10000;server.headersTimeout=10000;
    const ready=new Promise((accept,reject)=>{
      server.once('error',e=>{cleanup().then(()=>reject(e),()=>reject(e));});
      server.listen(port,'127.0.0.1',()=>{try{engine.recover();workspace.observeJobs(terminal.status().jobs);workspace.tick();timer=setInterval(()=>{try{workspace.observeJobs(terminal.status().jobs);workspace.tick();}catch{console.error('[kst] code=SCHEDULER_FAILED');}},15000);timer.unref();accept(server.address());}catch(e){server.close();cleanup().then(()=>reject(e),()=>reject(e));}});
    });
    return {server,ready,engine,workspace,terminal,dataDir,tokenPath,close:()=>new Promise((resolveClose,rejectClose)=>server.close(()=>{cleanup().then(resolveClose,rejectClose);} ))};
  }catch(e){cleanup().catch(()=>console.error('[kst] code=CLEANUP_FAILED owner-lock retained'));throw e;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const app=startServer();await app.ready;
    console.log(`kst core ready at http://127.0.0.1:${app.server.address().port} (scratch mode).`);
    console.log(`Pair using the private token file: ${app.tokenPath}. Token values are never logged.`);
    const stop=async()=>{await app.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch(error){console.error(`kst startup failed: ${error.message}`);process.exitCode=1;}
}
