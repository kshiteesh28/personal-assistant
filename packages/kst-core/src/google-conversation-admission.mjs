import {createHash} from 'node:crypto';import {Fault} from './engine.mjs';import {stableJSON} from './understanding/ledger.mjs';
// Slow Google reads/previews outlive HTTP in bounded RAM; no transcript disk ledger.
export function createGoogleConversationAdmission(google,{clock=Date.now,waitMs=2000,max=8,ttl=300000}={}){
 const jobs=new Map();let generation=0;
 const prune=()=>{for(const [id,j]of jobs)if(j.expires<=clock()&&j.state!=='PREPARED')jobs.delete(id);};
 const receipt=id=>{prune();const j=jobs.get(id);if(!j)throw new Fault('NOT_FOUND','This transient response expired. Check durable Google receipts before retrying a write.',404);return {requestId:id,state:j.state,...(j.response?{response:j.kind==='route'?j.response.body:j.response,responseStatus:j.kind==='route'?j.response.status:200}:{}),...(j.error?{error:j.error}:{}),pending:j.state==='PREPARED'};};
 async function run(body,work,key,kind){
  if(!google)return null;if(!body||typeof body.requestId!=='string'||!(/^[A-Za-z0-9_.:-]{1,128}$/).test(body.requestId))throw new Fault('INVALID_ID','Supply a bounded Google request ID.');prune();const hash=createHash('sha256').update(stableJSON({key,body})).digest('hex');let job=jobs.get(body.requestId);
  if(job&&job.hash!==hash)throw new Fault('IDEMPOTENCY_CONFLICT','This request ID belongs to different input.',409);
  if(!job){
   if(jobs.size>=max){const terminal=[...jobs].find(([,j])=>j.state!=='PREPARED');if(terminal)jobs.delete(terminal[0]);else throw new Fault('GOOGLE_CAPACITY','Google foreground requests are busy. Stop or wait before another request.',429);}
   const epoch=generation;job={hash,kind,state:'PREPARED',expires:clock()+ttl,conversationId:body.conversationId??'conversation-'+body.requestId};jobs.set(body.requestId,job);
   job.promise=Promise.resolve().then(work).then(value=>{
    if(value===null){jobs.delete(body.requestId);return null;}
    if(epoch!==generation)return job.response;
    if(Buffer.byteLength(JSON.stringify(value))>524288)throw new Fault('GOOGLE_RESPONSE_LIMIT','Google response exceeds the foreground display limit.',413);
    job.response=value;job.state='SUCCEEDED';job.expires=clock()+ttl;return value;
   }).catch(error=>{if(epoch===generation){job.error={code:error.code??'GOOGLE_FAILED',message:error.message??'Google request failed.',retryable:false};job.state='FAILED';job.expires=clock()+ttl;}throw error;});
   job.promise.catch(()=>{});
  }
  if(job.state==='CANCELLED')return job.response;
  let timer;try{return await Promise.race([job.promise,new Promise(resolve=>{timer=setTimeout(()=>resolve({pending:true,requestId:body.requestId,receiptURL:'/api/google/requests/'+encodeURIComponent(body.requestId),conversationId:job.conversationId}),waitMs);})]);}finally{clearTimeout(timer);}
 }
 return {receipt,stop(){generation++;for(const j of jobs.values())if(j.state==='PREPARED'){j.state='CANCELLED';j.expires=clock()+ttl;const response={conversationId:j.conversationId,reply:'Stopped. Review any admitted Google operation in its durable receipt.'};j.response=j.kind==='route'?{status:200,body:{...response,state:'CANCELLED'}}:response;}},
  handle(body){return run(body,()=>google.converse(body),'/api/conversation','conversation');},
  async handleRoute(method,path,body){const result=await run(body,()=>google.route(method,path,body),method+' '+path,'route');return result?.pending?{status:202,body:result}:result;}
 };
}
