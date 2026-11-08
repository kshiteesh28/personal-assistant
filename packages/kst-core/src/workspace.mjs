import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync,lstatSync,realpathSync,accessSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Fault} from './engine.mjs';
import {safeFile} from './secretary.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const iso=ms=>ms==null?null:new Date(ms).toISOString();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fault=(message,code='INVALID_COMMAND',status=400)=>{throw new Fault(code,message,status);};
const title=v=>{if(typeof v!=='string'||!v.trim()||v.length>500)fault('Provide a title of 1–500 characters.');return v.trim();};
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fault('Provide an ISO date and time with timezone.');return Date.parse(v);};
const numbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,thirty:30,forty:40,fortyfive:45,sixty:60};
function normalizeSpeech(input){let s=input.trim().replace(/[.!?]+$/,'').trim();s=s.replace(/^yes,?\s+(?=(?:confirm|apply) plan$)/i,'');if(/^(?:remind me|schedule meeting|reschedule meeting|snooze reminder)/i.test(s)){s=s.replace(/\b(in|for)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty five|sixty)\s+(minutes?|hours?|days?)\b/gi,(_,prefix,n,unit)=>`${prefix} ${numbers[n.toLowerCase().replace(/ /g,'')]} ${unit}`).replace(/\bat\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(am|pm)\b/gi,(_,n,period)=>`at ${numbers[n.toLowerCase()]} ${period}`);}return s;}

// Explicit imported sources can have another UID; the current user's effective access
// is authoritative. Private kst profile/backup ownership remains strict below.
export function validateWritableSource(sourcePath,allowedRoots=[root]) {
  const selected=safeFile(sourcePath,allowedRoots);
  try {
    accessSync(dirname(selected.path),constants.R_OK|constants.W_OK|constants.X_OK);
    for(const suffix of ['','-wal','-shm']) {
      try {const stat=lstatSync(selected.path+suffix);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Unsafe source file.');accessSync(selected.path+suffix,constants.R_OK|constants.W_OK);}
      catch(error){if(suffix&&error.code==='ENOENT')continue;throw error;}
    }
  }catch{throw Error('The selected source database, existing sidecars, and project directory must be readable and writable by this user.');}
  return selected;
}

/** Deterministic local date grammar. Returns null rather than guessing incomplete dates. */
export function parseWhen(input,now) {
  const s=input.trim();
  const relative=s.match(/^in (\d{1,5}) (minutes?|hours?|days?)$/i);
  if(relative){const n=Number(relative[1]);if(n<1||n>10080)return null;return now+n*({minute:60000,hour:3600000,day:86400000}[relative[2].toLowerCase().replace(/s$/,'')]);}
  if(/^\d{4}-\d\d-\d\dT/.test(s)){try{return date(s);}catch{return null;}}
  const at=s.match(/^(today|tomorrow|\d{4}-\d\d-\d\d) at (\d{1,2})(?::(\d\d))?\s*(am|pm)?$/i);
  if(!at)return null;
  let hour=Number(at[2]),minute=Number(at[3]??0);if(minute>59||hour>23)return null;
  if(at[4]){if(hour<1||hour>12)return null;hour=hour%12+(at[4].toLowerCase()==='pm'?12:0);}
  else if(hour<=12)return null; // 3 means 3am or 3pm: clarify.
  const d=new Date(now);
  if(at[1].toLowerCase()==='tomorrow')d.setDate(d.getDate()+1);
  else if(at[1].toLowerCase()!=='today') {const [y,m,day]=at[1].split('-').map(Number);d.setFullYear(y,m-1,day);if(d.getFullYear()!==y||d.getMonth()!==m-1||d.getDate()!==day)return null;}
  d.setHours(hour,minute,0,0);
  if(d.getHours()!==hour||d.getMinutes()!==minute)return null; // DST gap.
  for(const delta of [-3600000,3600000]){const other=new Date(d.getTime()+delta);if(other.getFullYear()===d.getFullYear()&&other.getMonth()===d.getMonth()&&other.getDate()===d.getDate()&&other.getHours()===hour&&other.getMinutes()===minute)return null;} // DST fold.
  return d.getTime();
}

export class Workspace {
  constructor({dataDir,sourcePath,sourceWrite=false,allowedRoots=[root],now=Date.now}={}) {
    this.now=now;this.mode=sourceWrite?'source-write':'local';this.backup=null;
    if(!dataDir)throw Error('A private data directory is required.');
    mkdirSync(dataDir,{recursive:true,mode:0o700});
    if(lstatSync(dataDir).isSymbolicLink()||!lstatSync(dataDir).isDirectory()||lstatSync(dataDir).uid!==process.getuid())throw Error('Workspace requires an owned private directory.');chmodSync(dataDir,0o700);
    let path=join(dataDir,'secretary.sqlite');
    if(sourceWrite){
      if(!sourcePath)throw Error('KST_SECRETARY_WRITE requires an explicit approved source database.');
      const selected=validateWritableSource(sourcePath,allowedRoots);path=selected.path;
      const backupDir=join(dataDir,'source-backups');mkdirSync(backupDir,{recursive:true,mode:0o700});if(lstatSync(backupDir).isSymbolicLink()||lstatSync(backupDir).uid!==process.getuid())throw Error('Backup directory must be privately owned.');chmodSync(backupDir,0o700);
      const backupPath=join(backupDir,`${Date.now()}-${randomUUID()}.sqlite`);
      const reader=new DatabaseSync(path,{readOnly:true});
      try{reader.exec('PRAGMA busy_timeout=1000');reader.prepare('VACUUM INTO ?').run(backupPath);}finally{reader.close();}
      chmodSync(backupPath,0o600);const check=new DatabaseSync(backupPath,{readOnly:true});
      try{if(Object.values(check.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw Error('Source backup failed integrity validation.');for(const table of ['tasks','notes','reminders','events'])if(!check.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table))throw Error('Source backup lacks required Personal Secretary tables.');}finally{check.close();}
      if(validateWritableSource(sourcePath,allowedRoots).identity!==selected.identity)throw Error('The source database changed identity during backup. No workspace writes were started; review and retry.');
      this.backup={fileName:backupPath.split('/').at(-1),verified:true,createdAt:iso(this.now())};
    }
    for(const suffix of ['','-wal','-shm']){try{const stat=lstatSync(path+suffix);if(stat.isSymbolicLink()||!stat.isFile()||(!sourceWrite&&stat.uid!==process.getuid()))throw Error('Workspace database must be a regular file; private files must be owned by this user.');if(!sourceWrite)chmodSync(path+suffix,0o600);else accessSync(path+suffix,constants.R_OK|constants.W_OK);}catch(e){if(e.code!=='ENOENT')throw e;}}
    this.path=path;this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;');
    if(!sourceWrite)this.db.exec(readFileSync(join(root,'migrations','001_foundation.sql'),'utf8'));
    for(const table of ['tasks','notes','reminders','events'])if(!this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table))throw Error('Workspace source schema is unsupported.');
    this.db.exec(`CREATE TABLE IF NOT EXISTS kst_domain_requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kst_dialogue(id TEXT PRIMARY KEY,pending TEXT NOT NULL,expires_ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kst_plans(id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL,created_ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kst_notifications(id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT,title TEXT NOT NULL,message TEXT NOT NULL,created_ts INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',snooze_ts INTEGER);
      CREATE TABLE IF NOT EXISTS kst_activity(id TEXT PRIMARY KEY,payload TEXT NOT NULL,observed_ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kst_delivery_keys(id TEXT PRIMARY KEY,created_ts INTEGER NOT NULL);
      INSERT OR IGNORE INTO kst_delivery_keys SELECT id,created_ts FROM kst_notifications;`);
    if(!sourceWrite)chmodSync(path,0o600);
  }
  close(){this.db.close();}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  once(id,payload,fn){if(typeof id!=='string'||!/^[\w-]{8,128}$/.test(id))fault('Provide a unique request ID.');const digest=hash(payload),prior=this.db.prepare('SELECT hash,result FROM kst_domain_requests WHERE id=?').get(id);if(prior){if(prior.hash!==digest)fault('Request ID already belongs to a different operation.','IDEMPOTENCY_CONFLICT',409);return JSON.parse(prior.result);}const result=fn();this.db.prepare('INSERT INTO kst_domain_requests VALUES(?,?,?)').run(id,digest,JSON.stringify(result));return result;}
  snapshot(){
    const tasks=this.db.prepare('SELECT id,title,status,due_ts,priority,project,updated_at FROM tasks ORDER BY updated_at DESC,id LIMIT 500').all().map(r=>({...r,dueAt:iso(r.due_ts),updatedAt:iso(r.updated_at)}));
    const notes=this.db.prepare('SELECT id,title,substr(body,1,4000) body,updated_at FROM notes ORDER BY updated_at DESC,id LIMIT 500').all().map(r=>({...r,updatedAt:iso(r.updated_at)}));
    const reminders=this.db.prepare('SELECT id,title,status,trigger_ts,snooze_until_ts,updated_at FROM reminders ORDER BY trigger_ts,id LIMIT 500').all().map(r=>({...r,fireAt:iso(r.trigger_ts),snoozeUntil:iso(r.snooze_until_ts),updatedAt:iso(r.updated_at)}));
    const calendar=this.db.prepare('SELECT id,title,start_ts,end_ts,all_day,location,updated_at FROM events WHERE end_ts>=? ORDER BY start_ts,id LIMIT 500').all(this.now()-86400000).map(r=>({...r,startAt:iso(r.start_ts),endAt:iso(r.end_ts),allDay:Boolean(r.all_day),updatedAt:iso(r.updated_at)}));
    const plans=this.db.prepare('SELECT * FROM kst_plans ORDER BY created_ts DESC LIMIT 10').all().map(r=>({id:r.id,status:r.status,...JSON.parse(r.payload),createdAt:iso(r.created_ts)}));
    const timeline=[...calendar.map(r=>({id:r.id,kind:'meeting',title:r.title,startAt:r.startAt,endAt:r.endAt})),...reminders.filter(r=>r.status==='active'||r.status==='snoozed').map(r=>({id:r.id,kind:'reminder',title:r.title,startAt:r.snoozeUntil??r.fireAt,status:r.status})),...plans.filter(r=>r.status==='applied').flatMap(p=>p.blocks.map(b=>({...b,id:`${p.id}:${b.taskId}`,kind:'focus'})))].sort((a,b)=>a.startAt.localeCompare(b.startAt));
    return {mode:this.mode,source:{label:this.mode==='local'?'kst personal workspace':'Personal Secretary shared workspace',fileName:this.path.split('/').at(-1)},backup:this.backup,observedAt:iso(this.now()),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,tasks,notes,reminders,calendar,timeline,plans,notifications:this.notifications()};
  }
  notifications(){return this.db.prepare("SELECT * FROM kst_notifications WHERE status='pending' OR (status='snoozed' AND snooze_ts<=?) ORDER BY created_ts DESC LIMIT 100").all(this.now()).map(r=>({id:r.id,kind:r.kind,title:r.title,message:r.message,entityId:r.entity_id,createdAt:iso(r.created_ts),status:r.status,snoozeUntil:iso(r.snooze_ts)}));}
  action(requestId,action,preconditions=[]){const fields={'task.create':['kind','title','dueAt','project'],'task.complete':['kind','target'],'note.create':['kind','title','body'],'reminder.create':['kind','title','fireAt'],'reminder.snooze':['kind','target','minutes'],'reminder.cancel':['kind','target'],'reminder.reschedule':['kind','target','fireAt'],'meeting.create':['kind','title','startAt','durationMinutes'],'meeting.reschedule':['kind','target','startAt','durationMinutes'],'meeting.cancel':['kind','target'],'plan.propose':['kind','minutes'],'plan.apply':['kind','planId']};if(!action||typeof action!=='object'||!Object.hasOwn(fields,action.kind)||Object.keys(action).some(key=>!fields[action.kind].includes(key)))fault('Unsupported action or fields.');return this.tx(()=>this.once(requestId,action,()=>{this.checkPreconditions(preconditions);return this.apply(action);}));}
  receipt(requestId){const r=this.db.prepare('SELECT result FROM kst_domain_requests WHERE id=?').get(requestId);return r?JSON.parse(r.result):null;}
  checkPreconditions(preconditions){if(!Array.isArray(preconditions)||preconditions.length>3)fault('Invalid target preconditions.');for(const p of preconditions){if(!p||!['tasks','reminders','events'].includes(p.table)||typeof p.id!=='string'||!Number.isSafeInteger(p.revision))fault('Invalid target preconditions.');const row=this.db.prepare(`SELECT updated_at FROM ${p.table} WHERE id=?`).get(p.id);if(!row||row.updated_at!==p.revision)fault('The target changed. Restate your request.','TARGET_CHANGED',409);}}
  lookupEntity(table,target){if(!['tasks','reminders','events'].includes(table))fault('Unknown entity type.');const direct=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(target);if(direct)return {matches:[direct],truncated:false};const rows=this.db.prepare(`SELECT * FROM ${table} WHERE lower(title)=lower(?) ORDER BY updated_at DESC,id LIMIT 501`).all(target.normalize('NFC').trim());return {matches:rows.slice(0,500),truncated:rows.length>500};}
  suggestEntities(table,target){if(!['tasks','reminders','events'].includes(table))fault('Unknown entity type.');const rows=this.db.prepare(`SELECT id,title,updated_at FROM ${table} ORDER BY updated_at DESC,id LIMIT 501`).all();if(rows.length>500)return {matches:[],truncated:true};const norm=s=>s.normalize('NFC').toLowerCase().trim().replace(/\s+/g,' '),a=norm(target),tokens=s=>new Set(s.match(/[\p{L}\p{N}]+/gu)??[]),ta=tokens(a);const similarity=b=>{const tb=tokens(b),intersection=[...ta].filter(x=>tb.has(x)).length,union=new Set([...ta,...tb]).size;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}return .5*(union?intersection/union:1)+.5*(1-prev[b.length]/Math.max(a.length,b.length,1));};return {matches:rows.map(r=>({...r,score:similarity(norm(r.title))})).filter(r=>r.score>=.6).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,3),truncated:false};}
  queryCollection(collection,{startAt,endAt}={}){const table={tasks:'tasks',notes:'notes',reminders:'reminders',calendar:'events'}[collection];if(!table)fault('Unknown collection.');let where='',args=[];if(startAt&&endAt){const start=Date.parse(startAt),end=Date.parse(endAt);if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)fault('Invalid date scope.');where=collection==='calendar'?' WHERE start_ts<? AND end_ts>?':collection==='reminders'?' WHERE COALESCE(snooze_until_ts,trigger_ts)>=? AND COALESCE(snooze_until_ts,trigger_ts)<?':collection==='tasks'?' WHERE due_ts>=? AND due_ts<?':'';if(where)args=collection==='calendar'?[end,start]:[start,end];}const rows=this.db.prepare(`SELECT * FROM ${table}${where} ORDER BY updated_at DESC,id LIMIT 501`).all(...args);return {items:rows.slice(0,500),truncated:rows.length>500};}
  apply(a){
    const now=this.now(),id=randomUUID();
    switch(a.kind){
      case 'task.create':{const value=title(a.title);this.db.prepare("INSERT INTO tasks(id,title,due_ts,priority,status,project,created_at,updated_at) VALUES(?,?,?,?,'todo',?,?,?)").run(id,value,a.dueAt?date(a.dueAt):null,2,a.project??null,now,now);return {id,kind:a.kind,message:`Task saved: ${value}`};}
      case 'task.complete':{const item=this.resolve('tasks',a.target);const progress=this.db.prepare('PRAGMA table_info(tasks)').all().some(c=>c.name==='progress');this.db.prepare(`UPDATE tasks SET status='done',updated_at=?${progress?',progress=100':''} WHERE id=?`).run(now,item.id);return {id:item.id,kind:a.kind,message:`Completed task: ${item.title}`};}
      case 'note.create':{const value=title(a.title);if(typeof a.body!=='string'||a.body.length>8000)fault('Note body must be at most 8,000 characters.');this.db.prepare('INSERT INTO notes(id,title,body,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,value,a.body,now,now);if(this.db.prepare("SELECT name FROM sqlite_schema WHERE name='notes_fts'").get())this.db.prepare('INSERT INTO notes_fts(id,title,body) VALUES(?,?,?)').run(id,value,a.body);return {id,kind:a.kind,message:`Note saved: ${value}`};}
      case 'reminder.create':{const value=title(a.title),at=date(a.fireAt);if(at<=now)fault('Choose a future reminder time.');this.db.prepare("INSERT INTO reminders(id,title,trigger_ts,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(id,value,at,now,now);return {id,kind:a.kind,message:`Reminder saved: ${value}, ${iso(at)}`};}
      case 'reminder.snooze':{const item=this.resolve('reminders',a.target);if(!Number.isInteger(a.minutes)||a.minutes<1||a.minutes>1440)fault('Snooze must be 1–1440 minutes.');this.db.prepare("UPDATE reminders SET status='snoozed',snooze_until_ts=?,updated_at=? WHERE id=?").run(now+a.minutes*60000,now,item.id);return {id:item.id,kind:a.kind,message:`Snoozed reminder: ${item.title}`};}
      case 'reminder.cancel':{const item=this.resolve('reminders',a.target);this.db.prepare("UPDATE reminders SET status='dismissed',snooze_until_ts=NULL,updated_at=? WHERE id=?").run(now,item.id);this.db.prepare("UPDATE kst_notifications SET status='acknowledged' WHERE kind='reminder' AND entity_id=?").run(item.id);return {id:item.id,kind:a.kind,message:`Cancelled reminder: ${item.title}`};}
      case 'reminder.reschedule':{const item=this.resolve('reminders',a.target),at=date(a.fireAt);if(at<=now)fault('Choose a future reminder time.');this.db.prepare("UPDATE reminders SET status='active',trigger_ts=?,snooze_until_ts=NULL,updated_at=? WHERE id=?").run(at,now,item.id);this.db.prepare("UPDATE kst_notifications SET status='acknowledged' WHERE kind='reminder' AND entity_id=?").run(item.id);return {id:item.id,kind:a.kind,message:`Reminder rescheduled: ${item.title}, ${iso(at)}`};}
      case 'meeting.create':case 'meeting.reschedule':{
        const at=date(a.startAt),duration=a.durationMinutes;if(at<=now||!Number.isInteger(duration)||duration<5||duration>480)fault('Choose a future start and a duration of 5–480 minutes.');
        const end=at+duration*60000,item=a.kind==='meeting.reschedule'?this.resolve('events',a.target):null;
        const conflict=this.db.prepare('SELECT id FROM events WHERE start_ts<? AND end_ts>? AND id!=? LIMIT 1').get(end,at,item?.id??'');if(conflict)fault('This time overlaps an existing meeting. Choose another time.','SCHEDULE_CONFLICT',409);
        if(item){this.db.prepare('UPDATE events SET start_ts=?,end_ts=?,updated_at=? WHERE id=?').run(at,end,now,item.id);this.db.prepare("UPDATE kst_notifications SET status='acknowledged' WHERE kind='meeting' AND entity_id=?").run(item.id);}
        else this.db.prepare('INSERT INTO events(id,title,start_ts,end_ts,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,title(a.title),at,end,now,now);
        return {id:item?.id??id,kind:a.kind,message:`Meeting ${item?'rescheduled':'saved'}: ${item?.title??a.title}, ${iso(at)} for ${duration} minutes`};
      }
      case 'meeting.cancel':{const item=this.resolve('events',a.target);this.db.prepare('DELETE FROM events WHERE id=?').run(item.id);this.db.prepare("UPDATE kst_notifications SET status='acknowledged' WHERE kind='meeting' AND entity_id=?").run(item.id);return {id:item.id,kind:a.kind,message:`Cancelled meeting: ${item.title}`};}
      case 'plan.propose':return this.plan(a);
      case 'plan.apply':{const p=this.db.prepare('SELECT * FROM kst_plans WHERE id=?').get(a.planId);if(!p||p.status!=='proposed')fault('Choose a current proposed plan.','STALE_PLAN',409);const plan=JSON.parse(p.payload),reserved=this.reserved();for(const b of plan.blocks){const t=this.db.prepare('SELECT status,updated_at FROM tasks WHERE id=?').get(b.taskId);if(!t||t.status==='done'||t.updated_at!==b.taskRevision||Date.parse(b.startAt)<now||reserved.some(r=>r.start_ts<Date.parse(b.endAt)&&r.end_ts>Date.parse(b.startAt))||this.db.prepare('SELECT id FROM events WHERE start_ts<? AND end_ts>? LIMIT 1').get(Date.parse(b.endAt),Date.parse(b.startAt)))fault('Tasks, meetings, or focus blocks changed. Request a new plan.','STALE_PLAN',409);}this.db.prepare("UPDATE kst_plans SET status='applied' WHERE id=?").run(a.planId);return {id:a.planId,kind:a.kind,message:'Focus plan applied to your local timeline.',blocks:plan.blocks};}
      default:fault('Unsupported workspace action.');
    }
  }
  resolve(table,target){if(!['tasks','reminders','events'].includes(table))fault('Unknown entity type.');const value=title(target);const exact=this.db.prepare(`SELECT * FROM ${table} WHERE id=? OR lower(title)=lower(?) LIMIT 2`).all(value,value);if(exact.length!==1)fault(exact.length?'More than one record has this title. Use its ID.':'No matching record. Use an exact title or ID.','TARGET_UNRESOLVED',409);return exact[0];}
  plan(a){const now=this.now(),duration=a.minutes??30;if(!Number.isInteger(duration)||duration<15||duration>120)fault('Focus blocks must be 15–120 minutes.');const day=new Date(now);day.setHours(18,0,0,0);let cursor=Math.ceil((now+60000)/300000)*300000;
    const busy=[...this.db.prepare('SELECT start_ts,end_ts FROM events WHERE end_ts>? AND start_ts<? ORDER BY start_ts').all(now,day.getTime()),...this.reserved()].sort((a,b)=>a.start_ts-b.start_ts);
    const tasks=this.db.prepare("SELECT id,title,updated_at FROM tasks WHERE status IN ('todo','in_progress') ORDER BY priority ASC,due_ts IS NULL,due_ts ASC,created_at ASC LIMIT 8").all(),blocks=[];
    for(const task of tasks){let end=cursor+duration*60000;for(const e of busy){if(cursor<e.end_ts&&end>e.start_ts){cursor=e.end_ts;end=cursor+duration*60000;}}if(end>day.getTime())break;blocks.push({taskId:task.id,title:task.title,startAt:iso(cursor),endAt:iso(end),taskRevision:task.updated_at});cursor=end;}
    if(!blocks.length)fault('No unfinished tasks or free focus time before 18:00. Add tasks or try during your workday.');const id=randomUUID(),payload={blocks};this.db.prepare("INSERT INTO kst_plans VALUES(?,'proposed',?,?)").run(id,JSON.stringify(payload),now);return {id,kind:'plan.propose',status:'proposed',blocks,unscheduledTaskCount:tasks.length-blocks.length,message:`Proposed ${blocks.length} focus blocks before 18:00 local time. ${tasks.length-blocks.length} selected tasks did not fit. Say “apply plan ${id}” to add them to your timeline.`};}
  reserved(){return this.db.prepare("SELECT payload FROM kst_plans WHERE status='applied'").all().flatMap(p=>JSON.parse(p.payload).blocks.map(b=>({start_ts:Date.parse(b.startAt),end_ts:Date.parse(b.endAt)}))).filter(b=>b.end_ts>this.now());}
  notification(id,requestId,decision,minutes){return this.tx(()=>this.once(requestId,{id,decision,minutes:minutes??null},()=>{const row=this.db.prepare('SELECT id FROM kst_notifications WHERE id=?').get(id);if(!row)fault('Notification not found.','NOT_FOUND',404);if(decision==='acknowledge')this.db.prepare("UPDATE kst_notifications SET status='acknowledged' WHERE id=?").run(id);else if(decision==='snooze'&&[15,30,60].includes(minutes))this.db.prepare("UPDATE kst_notifications SET status='snoozed',snooze_ts=? WHERE id=?").run(this.now()+minutes*60000,id);else fault('Choose acknowledge or snooze for 15, 30 or 60 minutes.');return {notification:{id,status:decision==='acknowledge'?'acknowledged':'snoozed'}};}));}
  emit(id,kind,entityId,title,message){if(this.db.prepare('INSERT OR IGNORE INTO kst_delivery_keys VALUES(?,?)').run(id,this.now()).changes)return this.db.prepare('INSERT OR IGNORE INTO kst_notifications(id,kind,entity_id,title,message,created_ts) VALUES(?,?,?,?,?,?)').run(id,kind,entityId,title,message,this.now());return {changes:0};}
  tick(){return this.tx(()=>{const now=this.now();this.db.prepare('DELETE FROM kst_notifications WHERE created_ts<? AND (status=? OR status=?)').run(now-30*86400000,'acknowledged','pending');const emit=(id,kind,entityId,title,message)=>this.emit(id,kind,entityId,title,message);
    for(const r of this.db.prepare("SELECT * FROM reminders WHERE (status='active' AND trigger_ts<=?) OR (status='snoozed' AND snooze_until_ts<=?) LIMIT 500").all(now,now)){const at=r.snooze_until_ts??r.trigger_ts;emit(`reminder:${r.id}:${at}`,'reminder',r.id,r.title,'Reminder due.');if(!r.repeat_rule)this.db.prepare("UPDATE reminders SET status='dismissed',updated_at=? WHERE id=?").run(now,r.id);}
    for(const e of this.db.prepare('SELECT * FROM events WHERE start_ts>? AND start_ts<=?').all(now,now+600000))emit(`meeting:${e.id}:${e.start_ts}`,'meeting',e.id,e.title,`Meeting starts at ${iso(e.start_ts)}.`);
    const recent=this.db.prepare('SELECT payload FROM kst_activity WHERE observed_ts>? ORDER BY observed_ts DESC,rowid DESC LIMIT 1').get(now-120000),activity=recent?JSON.parse(recent.payload):null;
    const meeting=this.db.prepare('SELECT id FROM events WHERE start_ts<=? AND end_ts>? LIMIT 1').get(now,now);
    const ordinary=this.db.prepare("SELECT created_ts FROM kst_notifications WHERE kind IN ('break','checkpoint') AND created_ts>? ORDER BY created_ts DESC").all(now-3600000);
    if(activity&&!activity.locked&&!activity.quietHours&&!activity.inMeeting&&!meeting&&ordinary.length<2&&(!ordinary[0]||now-ordinary[0].created_ts>=1200000)){
      for(const p of this.db.prepare("SELECT id,payload FROM kst_plans WHERE status='applied' ORDER BY created_ts DESC LIMIT 10").all()){
        const block=JSON.parse(p.payload).blocks.find(b=>Date.parse(b.endAt)<=now&&Date.parse(b.endAt)>now-3600000&&this.db.prepare("SELECT id FROM tasks WHERE id=? AND status!='done'").get(b.taskId)&&!this.db.prepare('SELECT id FROM kst_notifications WHERE id=?').get(`checkpoint:${p.id}:${b.taskId}`));
        if(block){emit(`checkpoint:${p.id}:${block.taskId}`,'checkpoint',block.taskId,block.title,'Your planned focus block ended. Is this task still in progress, or should we update the plan?');break;}
      }
    }
    return this.notifications();});}
  observeJobs(jobs){return this.tx(()=>{let count=0;for(const job of jobs??[]){if(count>=5)break;if(!['succeeded','failed','unknown'].includes(job.status)||!job.id||!Number.isFinite(Date.parse(job.updatedAt??job.createdAt))||this.now()-Date.parse(job.updatedAt??job.createdAt)>900000)continue;const result=this.emit(`job:${job.id}:${job.status}`,'job',job.id,`Project job ${job.status}`,job.status==='succeeded'?'Your managed project job finished. Open its receipt to review the output.':'Your managed project job needs attention. Open its receipt; no automatic retry was started.');count+=Number(result.changes);}return this.notifications();});}
  activity(requestId,payload){return this.tx(()=>this.once(requestId,payload,()=>{const now=this.now();this.db.prepare('INSERT INTO kst_activity VALUES(?,?,?)').run(requestId,JSON.stringify(payload),now);this.db.prepare('DELETE FROM kst_domain_requests WHERE id IN (SELECT id FROM kst_activity WHERE observed_ts<?)').run(now-86400000);this.db.prepare('DELETE FROM kst_activity WHERE observed_ts<?').run(now-86400000);
    const meeting=Boolean(this.db.prepare('SELECT id FROM events WHERE start_ts<=? AND end_ts>? LIMIT 1').get(now,now));
    if(!payload.locked&&!payload.inMeeting&&!payload.quietHours&&!meeting&&payload.idleSeconds<300&&payload.activeMinutes>=60){const recent=this.db.prepare("SELECT created_ts FROM kst_notifications WHERE kind IN ('break','checkpoint') AND created_ts>? ORDER BY created_ts DESC").all(now-3600000);if(recent.length<2&&(!recent[0]||now-recent[0].created_ts>=1200000))this.emit(`break:${Math.floor(now/3600000)}`,'break',null,'Time for a break','You have been active for an hour. Take a short break?');}
    return {accepted:true,inMeeting:meeting,notificationCount:this.notifications().length};}));}
  endConversation(conversationId){const pending=conversationId?this.db.prepare('SELECT pending FROM kst_dialogue WHERE id=?').all(conversationId):this.db.prepare('SELECT pending FROM kst_dialogue').all();for(const row of pending){const p=JSON.parse(row.pending);if(p.slot==='confirm')this.db.prepare("UPDATE kst_plans SET status='cancelled' WHERE id=? AND status='proposed'").run(p.operation.planId);}if(conversationId)this.db.prepare('DELETE FROM kst_dialogue WHERE id=?').run(conversationId);else this.db.exec('DELETE FROM kst_dialogue');}
  converse(requestId,text,conversationId=`conversation-${requestId}`){
    const command=normalizeSpeech(text);const matched=/^(?:add task|complete task|note |remind me|snooze reminder|reschedule reminder|cancel reminder|schedule meeting|reschedule meeting|cancel meeting|show (?:my )?(?:tasks|notes|reminders|calendar|timeline)|list (?:my )?(?:tasks|notes|reminders)|plan my day|apply plan|confirm plan|cancel request)\b/i.test(command);
    const pending=this.db.prepare('SELECT * FROM kst_dialogue WHERE id=? AND expires_ts>?').get(conversationId,this.now());
    if(!matched&&!pending)return null;
    return this.tx(()=>this.once(requestId,{text,conversationId},()=>{
      const respond=(reply,extra={})=>({reply,conversationId,...extra});
      const ask=(operation,slot,reply)=>{this.db.prepare('INSERT OR REPLACE INTO kst_dialogue VALUES(?,?,?)').run(conversationId,JSON.stringify({operation,slot}),this.now()+90000);return respond(reply,{clarification:{slot,expiresAt:iso(this.now()+90000)}});};
      if(/^cancel request$/i.test(command)){this.endConversation(conversationId);return respond('Pending request cancelled.');}
      if(/^(?:show|list) (?:my )?(tasks|notes|reminders|calendar|timeline)$/i.test(command)){const key=command.split(' ').at(-1),items=this.snapshot()[key];return respond(items.length?items.slice(0,20).map(x=>`${x.title}${x.startAt?' — '+x.startAt:x.fireAt?' — '+x.fireAt:''}`).join('; '):`No ${key} yet.`,{items});}
      let action;
      if(pending&&!matched){const p=JSON.parse(pending.pending);action=p.operation;
        if(p.slot==='when'){const at=parseWhen(command,this.now());if(!at||at<=this.now())return ask(action,'when','Please give a future time, for example “tomorrow at 3 pm” or an ISO timestamp with timezone.');action[action.kind.startsWith('meeting')?'startAt':'fireAt']=iso(at);}
        else if(p.slot==='duration'){const duration=command.match(/^(\d+)\s*(?:minutes?|mins?)?$/i);if(!duration)return ask(action,'duration','How many minutes should the meeting last?');action.durationMinutes=Number(duration[1]);}
        else if(p.slot==='title'){action.title=title(command);}
        else if(p.slot==='confirm')return ask(action,'confirm','Say “confirm plan” to apply your proposed focus blocks, or “cancel request”.');
      }else{
        let m;
        if((m=command.match(/^add task\s+(.+)$/i)))action={kind:'task.create',title:m[1]};
        else if((m=command.match(/^complete task\s+(.+)$/i)))action={kind:'task.complete',target:m[1]};
        else if((m=command.match(/^note\s+(.+)$/i)))action={kind:'note.create',title:m[1].slice(0,80),body:m[1]};
        else if((m=command.match(/^remind me(?: to)?\s+(.+?)(?:\s+(in \d+ (?:minutes?|hours?|days?)|(?:today|tomorrow|\d{4}-\d\d-\d\d) at .+|\d{4}-\d\d-\d\dT.+))?$/i))){action={kind:'reminder.create',title:m[1]};if(m[2]){const at=parseWhen(m[2],this.now());if(at)action.fireAt=iso(at);}}
        else if((m=command.match(/^(schedule|reschedule) meeting\s+(.+?)(?:\s+(today at .+?|tomorrow at .+?|\d{4}-\d\d-\d\d at .+?|\d{4}-\d\d-\d\dT.+?))?(?:\s+for (\d+) minutes?)?$/i))){action={kind:m[1].toLowerCase()==='schedule'?'meeting.create':'meeting.reschedule',[m[1].toLowerCase()==='schedule'?'title':'target']:m[2]};if(m[3]){const at=parseWhen(m[3],this.now());if(at)action.startAt=iso(at);}if(m[4])action.durationMinutes=Number(m[4]);}
        else if((m=command.match(/^cancel meeting\s+(.+)$/i)))action={kind:'meeting.cancel',target:m[1]};
        else if((m=command.match(/^cancel reminder\s+(.+)$/i)))action={kind:'reminder.cancel',target:m[1]};
        else if((m=command.match(/^reschedule reminder\s+(.+?)(?:\s+(in \d+ (?:minutes?|hours?|days?)|(?:today|tomorrow|\d{4}-\d\d-\d\d) at .+|\d{4}-\d\d-\d\dT.+))?$/i))){action={kind:'reminder.reschedule',target:m[1]};if(m[2]){const at=parseWhen(m[2],this.now());if(at)action.fireAt=iso(at);}}
        else if((m=command.match(/^snooze reminder\s+(.+?)\s+for (\d+) minutes?$/i)))action={kind:'reminder.snooze',target:m[1],minutes:Number(m[2])};
        else if(/^plan my day$/i.test(command))action={kind:'plan.propose'};
        else if((m=command.match(/^apply plan ([\w-]+)$/i)))action={kind:'plan.apply',planId:m[1]};
        else if(/^(?:confirm|apply) plan$/i.test(command)){const p=pending?JSON.parse(pending.pending):null;if(p?.slot!=='confirm')fault('No proposed plan in this conversation. Say “plan my day” first.','NO_PENDING_PLAN',409);action=p.operation;}
        else return respond('Please include the title and required time. For example: “remind me to review in 10 minutes”.');
      }
      if(['reminder.create','reminder.reschedule'].includes(action.kind)&&!action.fireAt)return ask(action,'when','When should I remind you? Say “in 10 minutes” or “tomorrow at 3 pm”.');
      if(action.kind.startsWith('meeting.')&&action.kind!=='meeting.cancel'){
        if(!action.startAt)return ask(action,'when','When should the meeting start? Include am/pm, for example “tomorrow at 3 pm”.');
        if(!action.durationMinutes)return ask(action,'duration','How many minutes should the meeting last?');
      }
      const result=this.apply(action);this.endConversation(conversationId);if(action.kind==='plan.propose'){this.db.prepare('INSERT INTO kst_dialogue VALUES(?,?,?)').run(conversationId,JSON.stringify({operation:{kind:'plan.apply',planId:result.id},slot:'confirm'}),this.now()+90000);result.message+=' You can also say “confirm plan” in this conversation.';}return respond(result.message,{result});
    }));
  }
}
