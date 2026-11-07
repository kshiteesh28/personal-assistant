import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const required = {
  tasks: ['id','title','due_ts','priority','status','project','updated_at'],
  notes: ['id','title','body','updated_at'],
  reminders: ['id','title','trigger_ts','status','snooze_until_ts','updated_at'],
  events: ['id','title','start_ts','end_ts','all_day','location','updated_at'],
};
const empty = () => ({tasks:[],notes:[],reminders:[],calendar:[]});
class SourceFault extends Error {
  constructor(code,message) { super(message); this.code=code; }
}
const fail = (code,message) => {throw new SourceFault(code,message);};
export function safeFile(path, roots) {
  if(!isAbsolute(path)||!['flowstate.db','secretary.db'].includes(basename(path))) fail('SOURCE_NOT_ALLOWED','Select an expected Personal Secretary database in an approved project directory.');
  const resolved=resolve(path);
  if(!roots.some(root=>isAbsolute(root)&&resolve(root)===dirname(resolved))) fail('SOURCE_NOT_ALLOWED','Database is outside the server-configured project directories.');
  // Validate every existing ancestor, not just the final filename.
  let current=parse(resolved).root;
  for(const segment of resolved.slice(current.length).split('/')) {
    current=join(current,segment);
    let stat;
    try {stat=lstatSync(current);} catch(error) {
      if(error.code==='ENOENT') fail('SOURCE_MISSING','The selected Personal Secretary database is not available.');
      fail('SOURCE_UNAVAILABLE','The selected Personal Secretary database cannot be accessed.');
    }
    if(stat.isSymbolicLink()) fail('SOURCE_NOT_ALLOWED','Symlinked source paths are not permitted.');
  }
  const stat=lstatSync(resolved);
  if(!stat.isFile()||realpathSync(resolved)!==resolved) fail('SOURCE_NOT_ALLOWED','Select a regular database file in an approved project directory.');
  // SQLite can consult these sidecars even with a read-only main database.
  for(const suffix of ['-wal','-shm']) {
    try {const sidecar=lstatSync(resolved+suffix);if(sidecar.isSymbolicLink()||!sidecar.isFile()) fail('SOURCE_NOT_ALLOWED','Database sidecars must be regular files.');}
    catch(error) {if(error instanceof SourceFault)throw error;if(error.code!=='ENOENT')fail('SOURCE_UNAVAILABLE','Database sidecars cannot be accessed.');}
  }
  return {path:resolved,identity:`${stat.dev}:${stat.ino}`};
}
function time(value, nullable=false) {
  if(value===null&&nullable)return null;
  if(!Number.isSafeInteger(value)||!Number.isFinite(new Date(value).getTime()))fail('SOURCE_DATA_INVALID','Personal Secretary contains unsupported date values.');
  return new Date(value).toISOString();
}
function id(value) {if(typeof value!=='string'||!value.length||value.length>256)fail('SOURCE_DATA_INVALID','Personal Secretary contains unsupported identifiers.');return value;}
const text = (value,max=500) => {
  if(value===null)return null;
  if(typeof value!=='string')fail('SOURCE_DATA_INVALID','Personal Secretary contains unsupported text values.');
  return value.slice(0,max);
};

/** Explicit read-only source, disabled by default. No filesystem discovery or import. */
export function createSecretaryAdapter({sourcePath,allowedRoots=[projectRoot],now=Date.now,maxRows=100,staleAfterMs=60000}={}) {
  if(sourcePath!==undefined&&sourcePath!==null&&typeof sourcePath!=='string') throw new TypeError('Invalid source adapter configuration.');
  if(!Array.isArray(allowedRoots)||allowedRoots.some(root=>typeof root!=='string')||!Number.isInteger(maxRows)||maxRows<1||maxRows>500||!Number.isInteger(staleAfterMs)||staleAfterMs<0||staleAfterMs>300000) throw new TypeError('Invalid source adapter configuration.');
  let cached=null;
  const source={label:'Personal Secretary',fileName:sourcePath&&['flowstate.db','secretary.db'].includes(basename(sourcePath))?basename(sourcePath):null,readOnly:true};
  const limits={maxRows,bodyCharacters:2000,titleCharacters:500,truncated:[]};
  return {
    snapshot() {
      const timestamp=now(),observedAt=new Date(timestamp).toISOString();
      const response=(status,data=empty(),extra={})=>({status,source,observedAt,lastSuccessAt:cached?.observedAt??null,staleAgeMs:cached?Math.max(0,timestamp-Date.parse(cached.observedAt)):null,data,limits:{...limits},...extra});
      if(!sourcePath)return response('disabled',empty(),{error:{code:'SOURCE_DISABLED',message:'Personal Secretary integration is off. Configure KST_SECRETARY_DB on the server to select an approved source.'}});
      let db,inTransaction=false;
      try {
        if(typeof sourcePath!=='string') fail('SOURCE_NOT_ALLOWED','Select an expected Personal Secretary database.');
        const selected=safeFile(sourcePath,allowedRoots);
        db=new DatabaseSync(selected.path,{readOnly:true});
        db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=200; BEGIN;');inTransaction=true;
        for(const [table,columns] of Object.entries(required)) {
          const tableInfo=db.prepare("SELECT type FROM sqlite_schema WHERE name = ?").get(table);
          if(tableInfo?.type!=='table')fail('SOURCE_SCHEMA_MISMATCH','This database does not match the supported Personal Secretary schema.');
          const available=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
          if(columns.some(column=>!available.has(column)))fail('SOURCE_SCHEMA_MISMATCH','This database does not match the supported Personal Secretary schema.');
        }
        const truncated=[];
        const rows=(key,sql)=>{
          const result=db.prepare(sql).all(maxRows+1);
          if(result.length>maxRows)truncated.push(key);
          return result.slice(0,maxRows);
        };
        const tasks=rows('tasks','SELECT id,substr(title,1,500) AS title,due_ts,priority,status,substr(project,1,500) AS project,updated_at FROM tasks ORDER BY updated_at DESC,id ASC LIMIT ?').map(row=>({id:id(row.id),title:text(row.title),dueAt:time(row.due_ts,true),priority:row.priority,status:text(row.status),project:text(row.project),updatedAt:time(row.updated_at)}));
        const notes=rows('notes','SELECT id,substr(title,1,500) AS title,substr(body,1,2000) AS body,updated_at FROM notes ORDER BY updated_at DESC,id ASC LIMIT ?').map(row=>({id:id(row.id),title:text(row.title),body:text(row.body,2000),updatedAt:time(row.updated_at)}));
        const reminders=rows('reminders','SELECT id,substr(title,1,500) AS title,trigger_ts,status,snooze_until_ts,updated_at FROM reminders ORDER BY updated_at DESC,id ASC LIMIT ?').map(row=>({id:id(row.id),title:text(row.title),fireAt:time(row.trigger_ts),status:text(row.status),snoozeUntil:time(row.snooze_until_ts,true),updatedAt:time(row.updated_at)}));
        const calendar=rows('calendar','SELECT id,substr(title,1,500) AS title,start_ts,end_ts,all_day,substr(location,1,500) AS location,updated_at FROM events ORDER BY start_ts ASC,id ASC LIMIT ?').map(row=>({id:id(row.id),title:text(row.title),startAt:time(row.start_ts),endAt:time(row.end_ts),allDay:Boolean(row.all_day),location:text(row.location),updatedAt:time(row.updated_at)}));
        const current=safeFile(sourcePath,allowedRoots);
        if(current.identity!==selected.identity)fail('SOURCE_CHANGED','The source changed while being read. Refresh to obtain a new snapshot.');
        db.exec('COMMIT');inTransaction=false;
        cached={observedAt,data:{tasks,notes,reminders,calendar},limits:{...limits,truncated}};
        return response('fresh',cached.data,{lastSuccessAt:observedAt,staleAgeMs:0,limits:cached.limits});
      } catch(error) {
        const busy=error.code==='SQLITE_BUSY'||error.errcode===5||error.errcode===6;
        const errorInfo=error instanceof SourceFault?{code:error.code,message:error.message}:busy?{code:'SOURCE_BUSY',message:'Personal Secretary is busy. Retry after its current transaction finishes.'}:{code:'SOURCE_UNAVAILABLE',message:'Personal Secretary could not be read. Check its availability and database integrity.'};
        if(busy&&cached&&timestamp-Date.parse(cached.observedAt)>=0&&timestamp-Date.parse(cached.observedAt)<=staleAfterMs)return response('stale',cached.data,{error:errorInfo,limits:cached.limits});
        return response('unavailable',empty(),{error:errorInfo});
      } finally {
        if(db){if(inTransaction){try{db.exec('ROLLBACK');}catch{}}db.close();}
      }
    },
  };
}
