import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { LearningStore, LearningFault, strictObject, safeInteger, requestID, stableJSON, digest } from './storage.mjs';

const resourceDir=join(dirname(fileURLToPath(import.meta.url)),'../../resources/understanding');
const RETENTION=90*86400, COOLDOWN=1800000;
const slots=new Set(['title','query','prompt']);
const fail=(code,message,status=400)=>{throw new LearningFault(code,message,status);};
const idBytes=value=>{if(typeof value!=='string'||!(/^[a-f0-9]{32}$/).test(value))fail('INVALID_INPUT','Use a valid preference ID.');return Buffer.from(value,'hex');};
function templateBytes(template) {
  strictObject(template,['v','prefix','suffix','slot','intent'],['v','prefix','suffix','slot','intent']);
  if(template.v!==1||!slots.has(template.slot)||!safeInteger(template.intent)||template.intent>26||!Array.isArray(template.prefix)||!Array.isArray(template.suffix))fail('TEMPLATE_INVALID','Unsupported expression template.');
  const literals=[...template.prefix,...template.suffix];
  if(!literals.length||literals.length>64||literals.some(t=>typeof t!=='string'||!t.length||t.length>80||/[^\p{L}\p{N}\p{M}'<>:_-]/u.test(t))||Buffer.byteLength(literals.join(' '))>160)fail('TEMPLATE_INVALID','Expression literals exceed limits.');
  if(literals.some(t=>/^(approve|approval|stop|settings|sudo|https?|file|javascript)$/i.test(t))||[17,19,20,21,22].includes(template.intent)&&template.slot!=='prompt')fail('TEMPLATE_INVALID','This expression cannot be remembered as a template.');
  const bytes=Buffer.from(stableJSON(template));if(bytes.length>416)fail('TEMPLATE_INVALID','Expression is too large.');return bytes;
}
export function createLearningService(options={}) { return new LearningService(options); }
export class LearningService {
  constructor({profileDir,operationalDb,mode='shadow',resolveFeedbackCandidate=()=>null,hasActiveWork=()=>false,modelApi={},resources=resourceDir,clock=Date.now,onPrivacyChange=()=>{},onModelChange=()=>{}}={}) {
    if(!['off','shadow','active'].includes(mode))throw new Error('Invalid understanding mode.');
    this.mode=mode;this.clock=clock;this.op=operationalDb;this.resolveCandidate=resolveFeedbackCandidate;this.hasActiveWork=hasActiveWork;this.modelApi=modelApi;this.resources=resources;this.onPrivacyChange=onPrivacyChange;this.onModelChange=onModelChange;
    this.worker=null;this.reporter=null;this.reportConflict=false;this.closed=false;this.resetTokens=new Map();this.state='idle';this.failure=null;this.cancelFlag=new Int32Array(new SharedArrayBuffer(4));this.pendingManual=false;this.activeRequests=0;
    if(!this.op)throw new Error('Learning service requires the private operational database.');
    this.op.exec(`CREATE TABLE IF NOT EXISTS understanding_privacy(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL,pending TEXT);
      INSERT OR IGNORE INTO understanding_privacy(id,generation,pending) VALUES(1,1,NULL);
      CREATE TABLE IF NOT EXISTS understanding_learning_receipts(request_id TEXT PRIMARY KEY,path TEXT NOT NULL,payload_hash TEXT NOT NULL,response TEXT NOT NULL);`);
    try {
      this.store=new LearningStore(profileDir);
      const generation=this.privacyGeneration();
      const pending=this.op.prepare('SELECT pending FROM understanding_privacy WHERE id=1').get().pending;
      if(pending||this.store.get('privacy-generation',generation)!==generation)this.reconcilePrivacy(pending?JSON.parse(pending):{kind:'reset'});
      if(!this.store.get('settings'))this.store.transaction(()=>{this.store.set('settings',{revision:1,learningEnabled:true});this.store.set('dataset-revision',0);this.store.set('privacy-generation',generation);this.store.set('active',0);this.store.set('previous',0);});
      this.store.cleanup([this.store.get('active',0),this.store.get('previous',0)]);
      const expired=this.expiredExamples();if(expired.length)this.privacyBarrier('startup-retention-'+this.clock(),{kind:'examples',ids:expired.map(r=>r.id.toString('hex'))});
      this.loadActive();
    } catch(e) {this.failure={code:e.code??'LEARNING_UNAVAILABLE',message:e.message};this.state='paused';}
    this.timer=setInterval(()=>{this.tickPromise=this.tick().catch(e=>this.rejectTraining(e.code??'TRAINING_FAILED'));},5000);this.timer.unref();
  }
  privacyGeneration() {const row=this.op.prepare('SELECT generation FROM understanding_privacy WHERE id=1').get();if(!row||!safeInteger(row.generation,1))fail('PRIVACY_UNAVAILABLE','Privacy generation is unavailable.',503);return row.generation;}
  settingsValue() {return this.store?.get('settings',{revision:1,learningEnabled:true})??{revision:1,learningEnabled:true};}
  requireStore() {if(!this.store||this.failure)fail(this.failure?.code??'LEARNING_UNAVAILABLE',this.failure?.message??'Learning is unavailable.',503);}
  requireActive() {this.requireStore();if(this.mode!=='active')fail('LEARNING_NOT_ACTIVE','Adaptive collection awaits active rollout.',409);}
  resourcesFiles() {return ['seed-v1.bin','seed-replay.bin'].map(n=>join(this.resources,n)).filter(existsSync);}
  status() {
    let bytes=null;try{bytes=this.store?.accounting(this.resourcesFiles())??null;}catch{}
    return {mode:this.mode,runtime:this.modelApi.runtime??'js-fallback',activeVersion:this.store?.get('active',0)??0,privacyGeneration:this.privacyGeneration(),...this.settingsValue(),promotionPaused:this.store?.get('promotion-paused',false)??true,trainingState:this.state,training:this.store?.get('training',{})??{},failure:this.failure,activityConflict:this.reportConflict,bytes};
  }
  receipt(path,body,operation) {
    requestID(body.requestId);const hash=digest(path+'\n'+stableJSON(body)).toString('hex');
    const old=this.op.prepare('SELECT * FROM understanding_learning_receipts WHERE request_id=?').get(body.requestId);
    if(old){if(old.path!==path||old.payload_hash!==hash)fail('IDEMPOTENCY_CONFLICT','Request ID already has another payload.',409);const stored=JSON.parse(old.response);if(stored.__pending)fail('LEARNING_OPERATION_UNKNOWN','The prior operation needs review; it will not execute again.',409);if(stored.__error)fail(stored.code,stored.message,stored.status);return stored;}
    if(this.op.prepare("SELECT name FROM sqlite_schema WHERE name='understanding_requests'").get()&&this.op.prepare('SELECT request_id FROM understanding_requests WHERE request_id=?').get(body.requestId))fail('IDEMPOTENCY_CONFLICT','Request ID already belongs to another operation.',409);
    this.op.prepare('INSERT INTO understanding_learning_receipts VALUES(?,?,?,?)').run(body.requestId,path,hash,stableJSON({__pending:true}));
    try{const result=operation();this.op.prepare('UPDATE understanding_learning_receipts SET response=? WHERE request_id=?').run(stableJSON(result),body.requestId);return result;}catch(e){this.op.prepare('UPDATE understanding_learning_receipts SET response=? WHERE request_id=?').run(stableJSON({__error:true,code:e.code??'LEARNING_FAILED',message:e.message,status:e.status??503}),body.requestId);throw e;}
  }
  settings(body) {
    strictObject(body,['requestId','expectedRevision','learningEnabled','promotionPaused'],['requestId','expectedRevision']);
    return this.receipt('/api/understanding/settings',body,()=>{
      this.requireStore();const previous=this.settingsValue();if(body.expectedRevision!==previous.revision)fail('SETTINGS_CHANGED','Learning settings changed.',409);
      if(!('learningEnabled'in body)&&!('promotionPaused'in body)||('learningEnabled'in body&&typeof body.learningEnabled!=='boolean')||('promotionPaused'in body&&typeof body.promotionPaused!=='boolean'))fail('INVALID_INPUT','Supply a boolean learning setting.');
      if(body.learningEnabled===false||body.promotionPaused===true)this.cancel('settings');
      this.store.transaction(()=>{this.store.set('settings',{revision:previous.revision+1,learningEnabled:body.learningEnabled??previous.learningEnabled});if('promotionPaused'in body)this.store.set('promotion-paused',body.promotionPaused);});return this.status();
    });
  }
  preferences({after,limit=10}={}) {
    this.requireStore();limit=Number(limit);if(!safeInteger(limit,1)||limit>10)fail('INVALID_INPUT','Preference page limit must be 1 through 10.');
    const rows=this.store.db.prepare('SELECT id,label,template,created_s FROM preferences WHERE id>? ORDER BY id LIMIT ?').all(after?idBytes(after):Buffer.alloc(0),limit);
    return {items:rows.map(r=>({id:Buffer.from(r.id).toString('hex'),intent:r.label,template:JSON.parse(Buffer.from(r.template).toString()),createdAt:new Date(r.created_s*1000).toISOString()})),nextAfter:rows.length===limit?Buffer.from(rows.at(-1).id).toString('hex'):null};
  }
  matchPreference(text) {
    if(this.mode!=='active'||this.failure||!this.store||typeof text!=='string'||text.length>4000||Buffer.byteLength(text)>16000)return null;
    // Interpretation of data spans follows matching. Until then ambiguous speech acts abstain conservatively.
    if(/\b(?:don't|do not|never|would|could|might|suppose|imagine)\b|^(?:yes|no|stop|approve|reject|pause learning|resume learning|remember|forget)\b|^(?:i|he|she|they|we)\s+(?:cancelled|scheduled|added|deleted|completed)\b|^['"“]/iu.test(text.trim()))return null;
    const tokens=[...text.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu)].map(m=>({value:m[0].normalize('NFC').toLowerCase().replace(/’/g,"'"),start:m.index,end:m.index+m[0].length}));
    if(tokens.length<2||tokens.length>256)return null;
    const consume=(literal,start)=>{
      if(start>=tokens.length)return [];
      if(!literal.startsWith('<'))return tokens[start].value===literal?[start+1]:[];
      const rest=text.slice(tokens[start].start);let m;
      if(literal==='<date>')m=rest.match(/^(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i);
      else if(literal==='<number>')m=rest.match(/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty|ninety)\b/i);
      else if(literal==='<duration>')m=rest.match(/^(?:(?:\d+|one|two|fifteen|thirty|sixty)\s+(?:minutes?|hours?)|half an? hour|a quarter of an? hour)\b/i);
      else if(literal==='<datetime>')m=rest.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/i);
      if(!m)return [];const end=tokens[start].start+m[0].length;let next=start;while(next<tokens.length&&tokens[next].end<=end)next++;return next>start?[next]:[];
    };
    const matchLiterals=(literals,start)=>{let positions=[start];for(const literal of literals){positions=[...new Set(positions.flatMap(p=>consume(literal,p)))];if(!positions.length)break;}return positions;};
    const matches=[];
    for(const row of this.store.db.prepare('SELECT id,template FROM preferences ORDER BY id').all()){
      let template;try{template=JSON.parse(Buffer.from(row.template).toString('utf8'));templateBytes(template);}catch{continue;}
      const starts=matchLiterals(template.prefix,0);
      for(const prefixEnd of starts)for(let suffixStart=prefixEnd+1;suffixStart<=tokens.length;suffixStart++){
        if(!matchLiterals(template.suffix,suffixStart).includes(tokens.length))continue;
        const value=text.slice(prefixEnd?tokens[prefixEnd-1].end:0,suffixStart<tokens.length?tokens[suffixStart].start:text.length).trim();if(!value.trim())continue;
        matches.push({intent:template.intent,slot:template.slot,value,fields:{[template.slot]:value},preferenceId:Buffer.from(row.id).toString('hex')});
      }
    }
    if(!matches.length)return null;
    if(matches.length>1)return {ambiguous:true,preferenceIds:[...new Set(matches.map(m=>m.preferenceId))].slice(0,3)};
    return matches[0];
  }
  candidate(targetRequestId,contextRevision) {
    requestID(targetRequestId);if(!safeInteger(contextRevision))fail('INVALID_INPUT','A context revision is required.');
    const c=this.resolveCandidate(targetRequestId,contextRevision);
    if(!c||c.contextRevision!==contextRevision)fail('FEEDBACK_EXPIRED','The live feedback candidate has expired.',410);
    return c;
  }
  feedback(body) {
    strictObject(body,['requestId','targetRequestId','contextRevision','decision','correctedIntent'],['requestId','targetRequestId','contextRevision','decision']);
    return this.receipt('/api/understanding/feedback',body,()=>{
      this.requireActive();if(!this.settingsValue().learningEnabled)fail('LEARNING_PAUSED','Learning is paused.',409);
      if(!['confirm-intent','correct-intent'].includes(body.decision))fail('INVALID_INPUT','Unsupported feedback decision.');
      const c=this.candidate(body.targetRequestId,body.contextRevision);
      let label=c.label;
      if(body.decision==='correct-intent') {label=body.correctedIntent;if(typeof label==='string')label=this.modelApi.labels?.indexOf(label);}
      else if('correctedIntent'in body)fail('INVALID_INPUT','A confirmation cannot change the label.');
      if(!safeInteger(label)||label>26||!c.confirmed||body.decision==='correct-intent'&&label!==c.label)fail('INTERPRETATION_UNCONFIRMED','Confirm the corrected complete interpretation before retaining it.',409);
      return this.retain(c,label,body.requestId);
    });
  }
  recordConfirmedCandidate(candidate,targetRequestId,contextRevision,requestIdValue) {
    if(this.mode!=='active'||!this.settingsValue().learningEnabled||!candidate?.confirmed)return {retained:false};
    return this.feedback({requestId:requestIdValue,targetRequestId,contextRevision,decision:'confirm-intent'});
  }
  retain(c,label,operationId) {
    let features=c.features;if(!Buffer.isBuffer(features))features=Buffer.from(features??[]);
    if(!features.length||features.length>512||typeof c.maskedTemplate!=='string'||Buffer.byteLength(c.maskedTemplate)>1024)fail('FEEDBACK_INVALID','Masked feature evidence is invalid.');
    this.modelApi.decodeFeatures?.(features);
    const id=digest('1\n'+c.maskedTemplate+'\n'+stableJSON(c.contextFlags??{})).subarray(0,16);
    const group=digest(c.groupFingerprint??c.maskedTemplate).subarray(0,16),role=digest(group)[0]%5===0?1:0;
    const prior=this.store.db.prepare('SELECT * FROM examples WHERE id=?').get(id);
    if(prior&&!Buffer.from(prior.features).equals(features))fail('FINGERPRINT_COLLISION','Feature fingerprint collision; evidence was not stored.',409);
    if(prior?.label===label)return {retained:false,duplicate:true,exampleId:id.toString('hex')};
    if(prior)this.privacyBarrier(operationId,{kind:'example',id:id.toString('hex')});
    this.store.admit(139264,this.resourcesFiles());
    let evict=[];const rows=this.store.examples(),pinned=new Set(this.store.db.prepare('SELECT example_id FROM preferences').all().map(r=>Buffer.from(r.example_id).toString('hex')));
    let counts=this.store.counts(),needed=40+features.length;
    const frequencies=new Map();for(const r of rows)frequencies.set(r.label,(frequencies.get(r.label)??0)+1);
    while(counts.examples+1>256||counts.payloadBytes+needed>65536){
      const candidates=rows.filter(r=>!pinned.has(r.id.toString('hex'))&&!evict.some(x=>x.equals(r.id))).sort((a,b)=>(frequencies.get(b.label)-frequencies.get(a.label))||a.created_s-b.created_s||Buffer.compare(a.id,b.id));
      const victim=candidates[0];if(!victim)fail('LEARNING_FULL','Forget a remembered expression to make space.',507);evict.push(victim.id);counts.examples--;counts.payloadBytes-=40+victim.features.length;frequencies.set(victim.label,frequencies.get(victim.label)-1);
    }
    if(evict.length)this.privacyBarrier(operationId+'-evict',{kind:'examples',ids:evict.map(b=>b.toString('hex'))});
    this.store.transaction(()=>{this.store.db.prepare('INSERT INTO examples VALUES(?,?,?,?,?,?)').run(id,label,role,group,Math.floor(this.clock()/1000),features);this.store.set('dataset-revision',this.store.get('dataset-revision',0)+1);});
    return {retained:true,exampleId:id.toString('hex'),provisional:true,datasetRevision:this.store.get('dataset-revision')};
  }
  remember(body) {
    strictObject(body,['requestId','targetRequestId','contextRevision'],['requestId','targetRequestId','contextRevision']);
    return this.receipt('/api/understanding/remember',body,()=>{
      this.requireActive();if(!this.settingsValue().learningEnabled)fail('LEARNING_PAUSED','Learning is paused.',409);
      const c=this.candidate(body.targetRequestId,body.contextRevision);if(c.previewShown===true)c.templatePreviewConfirmed=true;if(!c.confirmed||!c.template||!c.templatePreviewConfirmed)fail('TEMPLATE_PREVIEW_REQUIRED','Confirm the expression template preview before remembering it.',409);
      if(c.template.intent!==c.label)fail('TEMPLATE_INVALID','Expression intent does not match its confirmed interpretation.');
      const bytes=templateBytes(c.template),retained=this.retain(c,c.label,body.requestId);
      const example=Buffer.from(retained.exampleId,'hex'),id=digest(bytes).subarray(0,16);
      const old=this.store.db.prepare('SELECT template FROM preferences WHERE id=?').get(id);
      if(old){if(!Buffer.from(old.template).equals(bytes))fail('FINGERPRINT_COLLISION','Expression fingerprint collision.',409);return {remembered:true,preferenceId:id.toString('hex')};}
      this.store.transaction(()=>{this.store.db.prepare('INSERT INTO preferences VALUES(?,?,?,?,?)').run(id,example,c.label,Math.floor(this.clock()/1000),bytes);this.store.set('dataset-revision',this.store.get('dataset-revision',0)+1);});
      return {remembered:true,preferenceId:id.toString('hex'),preview:c.template};
    });
  }
  forget(body) {
    strictObject(body,['requestId','preferenceId'],['requestId','preferenceId']);
    return this.receipt('/api/understanding/forget',body,()=>{this.requireStore();const id=idBytes(body.preferenceId);if(!this.store.db.prepare('SELECT id FROM preferences WHERE id=?').get(id))fail('PREFERENCE_NOT_FOUND','That expression is not remembered.',404);this.privacyBarrier(body.requestId,{kind:'preference',id:body.preferenceId});return {forgotten:true,privacyGeneration:this.privacyGeneration()};});
  }
  privacyBarrier(operationId,operation) {
    this.cancel('privacy');const old=this.op.prepare('SELECT generation,pending FROM understanding_privacy WHERE id=1').get();
    if(old.pending){this.reconcilePrivacy(JSON.parse(old.pending));return this.privacyBarrier(operationId,operation);}
    if(!safeInteger(old.generation+1,1))fail('PRIVACY_EXHAUSTED','Privacy counter exhausted.',503);
    const pending={...operation,operationId,generation:old.generation+1};
    try{this.op.prepare('UPDATE understanding_privacy SET generation=?,pending=? WHERE id=1').run(pending.generation,stableJSON(pending));}catch(e){this.cancel('privacy-failed');this.activeModel=null;this.onModelChange(0,null);this.failure={code:'PRIVACY_BARRIER_FAILED',message:'Deletion has not completed; personal inference is disabled.'};this.state='paused';throw new LearningFault('PRIVACY_BARRIER_FAILED',this.failure.message,503);}
    this.onPrivacyChange(pending.generation);
    this.reconcilePrivacy(pending);
  }
  reconcilePrivacy(operation) {
    try {
      const generation=this.privacyGeneration();this.cancel('privacy');
      this.store.transaction(()=>{
        if(operation.kind==='reset'){this.store.db.exec('DELETE FROM preferences; DELETE FROM examples;');}
        else if(operation.kind==='preference'){
          const row=this.store.db.prepare('SELECT example_id FROM preferences WHERE id=?').get(Buffer.from(operation.id,'hex'));
          this.store.db.prepare('DELETE FROM preferences WHERE id=?').run(Buffer.from(operation.id,'hex'));
          if(row&&!this.store.db.prepare('SELECT id FROM preferences WHERE example_id=?').get(row.example_id))this.store.db.prepare('DELETE FROM examples WHERE id=?').run(row.example_id);
        } else for(const id of operation.ids??[operation.id]){this.store.db.prepare('DELETE FROM preferences WHERE example_id=?').run(Buffer.from(id,'hex'));this.store.db.prepare('DELETE FROM examples WHERE id=?').run(Buffer.from(id,'hex'));}
        this.store.set('active',0);this.store.set('previous',0);this.store.set('privacy-generation',generation);this.store.set('dataset-revision',this.store.get('dataset-revision',0)+1);
      });
      this.store.cleanup([]);this.activeModel=null;this.onModelChange(0,null);this.op.prepare('UPDATE understanding_privacy SET pending=NULL WHERE id=1').run();
    } catch(e) {this.failure={code:'LEARNING_DELETE_INCOMPLETE',message:'Learning deletion has not completed.'};this.state='paused';this.activeModel=null;this.onModelChange(0,null);throw new LearningFault('LEARNING_DELETE_INCOMPLETE','Learning deletion has not completed; personal inference is disabled.',503);}
  }
  prepareReset(body) {
    strictObject(body,['requestId'],['requestId']);return this.receipt('/api/understanding/reset/prepare',body,()=>{this.requireStore();const token=randomBytes(24).toString('hex');for(const [k,v]of this.resetTokens)if(v.expires<this.clock())this.resetTokens.delete(k);if(this.resetTokens.size>=8)fail('RESET_CAPACITY','Too many pending reset requests.',429);this.resetTokens.set(token,{revision:this.store.get('dataset-revision',0),generation:this.privacyGeneration(),expires:this.clock()+60000});return {resetToken:token,expiresInSeconds:60};});
  }
  confirmReset(body) {
    strictObject(body,['requestId','resetToken'],['requestId','resetToken']);return this.receipt('/api/understanding/reset/confirm',body,()=>{this.requireStore();const t=this.resetTokens.get(body.resetToken);if(!t||t.expires<this.clock()||t.revision!==this.store.get('dataset-revision',0)||t.generation!==this.privacyGeneration())fail('RESET_EXPIRED','Prepare a fresh reset.',409);this.privacyBarrier(body.requestId,{kind:'reset'});this.resetTokens.delete(body.resetToken);return {reset:true,privacyGeneration:this.privacyGeneration()};});
  }
  rollback(body) {
    strictObject(body,['requestId','expectedModelVersion'],['requestId','expectedModelVersion']);return this.receipt('/api/understanding/rollback',body,()=>{this.requireStore();if(body.expectedModelVersion!==this.store.get('active',0))fail('MODEL_CHANGED','The active model changed.',409);const previous=this.store.get('previous',0);if(!previous)fail('NO_PREVIOUS_MODEL','No eligible previous model exists. Reset learning to use the seed.',409);const model=this.modelApi.decodeModel?.(this.store.readModel(previous));if(!model||model.privacyGeneration!==this.privacyGeneration())fail('MODEL_INELIGIBLE','The previous model is no longer eligible.',409);this.cancel('rollback');this.store.transaction(()=>{this.store.set('previous',this.store.get('active',0));this.store.set('active',previous);this.store.set('promotion-paused',true);});this.loadActive();return {rolledBack:true,activeVersion:previous,promotionPaused:true};});
  }
  runtimeState(body) {
    strictObject(body,['clientInstanceId','sequence','voiceState','ttsActive','idleSeconds','lowPowerMode','thermalState'],['clientInstanceId','sequence','voiceState','ttsActive','idleSeconds','lowPowerMode','thermalState']);
    if(typeof body.clientInstanceId!=='string'||!(/^[a-zA-Z0-9_-]{8,128}$/).test(body.clientInstanceId)||!safeInteger(body.sequence)||!['off','armed','discussion','speaking'].includes(body.voiceState)||typeof body.ttsActive!=='boolean'||typeof body.lowPowerMode!=='boolean'||!Number.isFinite(body.idleSeconds)||body.idleSeconds<0||body.idleSeconds>86400||!['nominal','fair','serious','critical'].includes(body.thermalState))fail('INVALID_INPUT','Invalid activity heartbeat.');
    const now=this.clock();if(this.reporter&&this.reporter.clientInstanceId!==body.clientInstanceId&&now-this.reporter.received<30000){this.reportConflict=true;this.cancel('reporter-conflict');return {accepted:false,conflict:true};}
    if(this.reporter?.clientInstanceId===body.clientInstanceId&&body.sequence<=this.reporter.sequence)return {accepted:false};
    this.reporter={...body,received:now};this.reportConflict=false;if(['discussion','speaking'].includes(body.voiceState)||body.ttsActive||body.lowPowerMode||['serious','critical'].includes(body.thermalState))this.cancel('activity');return {accepted:true};
  }
  cancel(reason='work') {Atomics.store(this.cancelFlag,0,1);if(this.worker)this.state='cancelling';this.cancelReason=reason;}
  beginRequest() {this.activeRequests++;this.cancel('request');}
  endRequest() {this.activeRequests=Math.max(0,this.activeRequests-1);}
  train(body) {
    strictObject(body,['requestId'],['requestId']);return this.receipt('/api/understanding/train',body,()=>{this.requireActive();if(!this.settingsValue().learningEnabled)fail('LEARNING_PAUSED','Learning is paused.',409);this.pendingManual=true;return {queued:true,trainingState:this.state};});
  }
  eligible(manual=false) {
    const r=this.reporter;if(!r||this.clock()-r.received>=30000||this.reportConflict)return 'ACTIVITY_STALE';
    if(['discussion','speaking'].includes(r.voiceState)||r.ttsActive||this.activeRequests||this.hasActiveWork())return 'WORK_ACTIVE';
    if(r.lowPowerMode||!['nominal','fair'].includes(r.thermalState))return 'POWER_OR_THERMAL';if(!manual&&r.idleSeconds<60)return 'NOT_IDLE';
    const last=this.store.get('training',{});if(last.attemptedAt&&this.clock()-last.attemptedAt<COOLDOWN)return 'COOLDOWN';return null;
  }
  loadActive() {
    const version=this.store.get('active',0);if(!version){this.activeModel=null;return;}
    try {const bytes=this.store.readModel(version),model=this.modelApi.decodeModel(bytes);if(model.privacyGeneration!==this.privacyGeneration())throw Error('Privacy mismatch');this.activeModel=model;this.onModelChange(version,bytes);}catch{
      const previous=this.store.get('previous',0);if(previous&&previous!==version){try{const bytes=this.store.readModel(previous),model=this.modelApi.decodeModel(bytes);if(model.privacyGeneration!==this.privacyGeneration())throw Error();this.store.transaction(()=>{this.store.set('active',previous);this.store.set('previous',0);});this.activeModel=model;this.onModelChange(previous,bytes);return;}catch{}}
      this.store.transaction(()=>{this.store.set('active',0);this.store.set('previous',0);});this.activeModel=null;this.onModelChange(0,null);
    }
  }
  expiredExamples(rows=this.store.examples()) {
    const pinned=new Set(this.store.db.prepare('SELECT example_id FROM preferences').all().map(r=>Buffer.from(r.example_id).toString('hex')));
    return rows.filter(r=>r.created_s<Math.floor(this.clock()/1000)-RETENTION&&!pinned.has(r.id.toString('hex')));
  }
  async tick() {
    if(this.closed||this.mode!=='active'||this.failure||!this.store||!this.settingsValue().learningEnabled||this.worker)return;
    const now=this.clock(),rows=this.store.examples();if(!this.lastSweep||now-this.lastSweep>=3600000){this.lastSweep=now;const expired=this.expiredExamples(rows);if(expired.length){this.privacyBarrier('retention-'+now,{kind:'examples',ids:expired.map(r=>r.id.toString('hex'))});return;}}
    const last=this.store.get('training',{}),revision=this.store.get('dataset-revision',0);
    const fresh=rows.filter(r=>r.role===0&&r.created_s*1000>(last.completedAt??0)).length;
    if(!this.pendingManual&&(fresh<10||last.datasetRevision===revision))return;
    if(this.store.get('promotion-paused',false)||this.eligible(this.pendingManual))return;
    this.store.admit(135168,this.resourcesFiles());this.pendingManual=false;this.state='training';Atomics.store(this.cancelFlag,0,0);
    const snapshot={datasetRevision:revision,privacyGeneration:this.privacyGeneration()};
    this.store.transaction(()=>this.store.set('training',{attemptedAt:now,datasetRevision:revision,state:'training'}));
    try {
      const seed=readFileSync(join(this.resources,'seed-v1.bin')),replay=readFileSync(join(this.resources,'seed-replay.bin'));
      const active=this.store.get('active',0)?this.store.readModel(this.store.get('active')):seed;
      const version=Math.max(this.store.get('active',0),this.store.get('previous',0),this.store.get('metrics',{}).lastVersion??0)+1;
      const worker=new Worker(new URL('./training-worker.mjs',import.meta.url),{execArgv:process.execArgv.filter(a=>!a.startsWith('--input-type')),workerData:{seed,active,replay,personal:rows.map(r=>({id:r.id,groupId:r.group_id,label:r.label,role:r.role,featureBuffer:r.features})),...snapshot,modelVersion:version,preferNative:this.modelApi.runtime==='native',cancelBuffer:this.cancelFlag.buffer}});this.worker=worker;
      const result=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{this.cancel('deadline');worker.terminate();reject(new LearningFault('TRAINING_DEADLINE','Training exceeded its deadline.'));},11000);worker.once('message',m=>{clearTimeout(deadline);m.ok?resolve(m):reject(new LearningFault(m.code??'TRAINING_FAILED',m.message??'Training rejected.'));});worker.once('error',e=>{clearTimeout(deadline);reject(e);});worker.once('exit',code=>{clearTimeout(deadline);if(code!==0)reject(new LearningFault('TRAINING_WORKER_EXIT','Training worker stopped.'));});});
      if(Atomics.load(this.cancelFlag,0)||snapshot.datasetRevision!==this.store.get('dataset-revision')||snapshot.privacyGeneration!==this.privacyGeneration()||this.closed)throw new LearningFault('TRAINING_CANCELLED','Training was cancelled.');
      if(result.promote)this.promoteCandidate({bytes:Buffer.from(result.bytes),version,snapshot,metrics:result.metrics});
      this.store.transaction(()=>this.store.set('training',{attemptedAt:now,completedAt:this.clock(),datasetRevision:revision,state:result.promote?'PROMOTED':result.reason??'NO_CHANGE'}));this.state='idle';
    }catch(e){this.rejectTraining(e.code??'TRAINING_FAILED');}finally{await this.worker?.terminate();this.worker=null;if(this.state==='cancelling')this.state='idle';}
  }
  promoteCandidate({bytes,version,snapshot,metrics={}}) {
    const current=()=>!Atomics.load(this.cancelFlag,0)&&!this.closed&&snapshot.datasetRevision===this.store.get('dataset-revision',0)&&snapshot.privacyGeneration===this.privacyGeneration()&&!this.store.get('promotion-paused',false);
    if(!current())fail('TRAINING_CANCELLED','Candidate snapshot is no longer current.',409);
    const model=this.modelApi.decodeModel(bytes);if(model.privacyGeneration!==snapshot.privacyGeneration||model.datasetRevision!==snapshot.datasetRevision||model.modelVersion!==version)fail('MODEL_INVALID','Candidate counters do not match snapshot.');
    this.store.writeModel(version,bytes,this.resourcesFiles());
    if(!current()){this.store.cleanup([this.store.get('active',0),this.store.get('previous',0)]);fail('TRAINING_CANCELLED','Candidate snapshot changed before promotion.',409);}
    this.checkpoint?.('before-pointer');this.store.transaction(()=>{this.store.set('previous',this.store.get('active',0));this.store.set('active',version);this.checkpoint?.('during-pointer');this.store.set('metrics',{lastVersion:version,lastOutcome:'PROMOTED',gate:metrics});});this.checkpoint?.('after-pointer');this.loadActive();this.checkpoint?.('after-publication');this.store.cleanup([version,this.store.get('previous',0)]);
  }
  rejectTraining(code) {if(!this.store)return;try{const t=this.store.get('training',{});this.store.transaction(()=>this.store.set('training',{...t,completedAt:this.clock(),state:code}));}catch{}this.state='idle';}
  async close() {this.closed=true;clearInterval(this.timer);this.cancel('shutdown');await this.worker?.terminate();await this.tickPromise;this.worker=null;this.store?.close();}
}
