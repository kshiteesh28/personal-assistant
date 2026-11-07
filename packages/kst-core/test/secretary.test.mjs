import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createSecretaryAdapter} from '../src/secretary.mjs';

const migration=new URL('../../../migrations/001_foundation.sql',import.meta.url);
function fixture(t,{rows=1}={}) {
  const root=mkdtempSync(join(realpathSync(tmpdir()),'kst-secretary-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'flowstate.db');
  const db=new DatabaseSync(path);
  db.exec(readFileSync(migration,'utf8'));
  const now=Date.parse('2026-11-06T15:00:00Z');
  for(let i=0;i<rows;i++) {
    db.prepare('INSERT INTO tasks(id,title,due_ts,status,project,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(`task-${i}`,`Task ${i}`,now,'in_progress','API',now,now);
    db.prepare('INSERT INTO notes(id,title,body,created_at,updated_at) VALUES(?,?,?,?,?)').run(`note-${i}`,`Note ${i}`,'secret-body '+ 'x'.repeat(3000),now,now);
    db.prepare('INSERT INTO events(id,title,start_ts,end_ts,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(`event-${i}`,`Event ${i}`,now,now+3600000,now,now);
    db.prepare('INSERT INTO reminders(id,title,trigger_ts,created_at,updated_at) VALUES(?,?,?,?,?)').run(`reminder-${i}`,`Reminder ${i}`,now,now,now);
  }
  db.close();
  return {root,path,now,adapter:createSecretaryAdapter({sourcePath:path,allowedRoots:[root],now:()=>now})};
}

test('integration is disabled by default with no selected source',()=>{
  const snapshot=createSecretaryAdapter().snapshot();
  assert.equal(snapshot.status,'disabled');assert.deepEqual(snapshot.data.tasks,[]);
  assert.match(snapshot.error.message,/KST_SECRETARY_DB/);
});

test('bounded read-only snapshot maps real foundation schema and keeps source unchanged',t=>{
  const {path,root,now}=fixture(t,{rows:3});
  const before=readFileSync(path);
  const adapter=createSecretaryAdapter({sourcePath:path,allowedRoots:[root],maxRows:2,now:()=>now});
  const first=adapter.snapshot(),second=adapter.snapshot();
  assert.equal(first.status,'fresh');assert.deepEqual(first,second);
  assert.equal(first.source.fileName,'flowstate.db');assert.equal(first.source.readOnly,true);
  assert.equal(first.data.tasks.length,2);assert.equal(new Set(first.data.tasks.map(x=>x.id)).size,2);
  assert.equal(first.data.tasks[0].dueAt,'2026-11-06T15:00:00.000Z');
  assert.equal(first.data.notes[0].body.length,2000);
  assert.equal(first.data.calendar[0].startAt,'2026-11-06T15:00:00.000Z');
  assert.equal(first.data.reminders[0].fireAt,'2026-11-06T15:00:00.000Z');
  assert.deepEqual(first.limits.truncated,['tasks','notes','reminders','calendar']);
  assert.deepEqual(readFileSync(path),before);
  assert.ok(!JSON.stringify(first).includes(root));
});

test('no imported domain copy: fresh snapshot observes committed source edits',t=>{
  const {adapter,path,now}=fixture(t);assert.equal(adapter.snapshot().data.tasks[0].title,'Task 0');
  const db=new DatabaseSync(path);db.prepare('UPDATE tasks SET title=?,updated_at=? WHERE id=?').run('Updated at source',now+1000,'task-0');db.close();
  assert.equal(adapter.snapshot().data.tasks[0].title,'Updated at source');
});

test('read-only snapshot includes committed WAL data without copying or checkpointing source',t=>{
  const {path,adapter}=fixture(t);
  const writer=new DatabaseSync(path);writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  try {
    writer.prepare('UPDATE tasks SET title=? WHERE id=?').run('Committed in WAL','task-0');
    const beforeMain=readFileSync(path),beforeWal=readFileSync(path+'-wal');
    const result=adapter.snapshot();assert.equal(result.status,'fresh');assert.equal(result.data.tasks[0].title,'Committed in WAL');
    assert.deepEqual(readFileSync(path),beforeMain);assert.deepEqual(readFileSync(path+'-wal'),beforeWal);
  } finally {writer.close();}
});

test('wrong root/name, symlink file and symlink parent are refused',t=>{
  const {root,path}=fixture(t);
  assert.equal(createSecretaryAdapter({sourcePath:path,allowedRoots:[join(root,'elsewhere')]}).snapshot().error.code,'SOURCE_NOT_ALLOWED');
  assert.equal(createSecretaryAdapter({sourcePath:join(root,'other.db'),allowedRoots:[root]}).snapshot().error.code,'SOURCE_NOT_ALLOWED');
  const fileLink=join(root,'secretary.db');symlinkSync(path,fileLink);
  assert.equal(createSecretaryAdapter({sourcePath:fileLink,allowedRoots:[root]}).snapshot().error.code,'SOURCE_NOT_ALLOWED');
  const link=join(root,'parent');symlinkSync(root,link);
  assert.equal(createSecretaryAdapter({sourcePath:join(link,'flowstate.db'),allowedRoots:[link]}).snapshot().error.code,'SOURCE_NOT_ALLOWED');
});

test('missing/corrupt/schema mismatch returns sanitized unavailable result',t=>{
  const {root,path}=fixture(t);
  const missing=createSecretaryAdapter({sourcePath:join(root,'secretary.db'),allowedRoots:[root]}).snapshot();assert.equal(missing.error.code,'SOURCE_MISSING');
  const corrupt=join(root,'secretary.db');writeFileSync(corrupt,'secret-body not a database');
  const failure=createSecretaryAdapter({sourcePath:corrupt,allowedRoots:[root]}).snapshot();
  assert.equal(failure.status,'unavailable');assert.ok(!JSON.stringify(failure).includes('secret-body'));assert.ok(!JSON.stringify(failure).includes(root));
  const db=new DatabaseSync(path);db.exec('DROP TABLE events');db.close();
  const incompatible=createSecretaryAdapter({sourcePath:path,allowedRoots:[root]}).snapshot();assert.equal(incompatible.error.code,'SOURCE_SCHEMA_MISMATCH');assert.deepEqual(incompatible.data.tasks,[]);
});

test('locked source reports stale bounded cache then unavailable when too old',t=>{
  const {root,path,now:initial}=fixture(t);let now=initial;
  const adapter=createSecretaryAdapter({sourcePath:path,allowedRoots:[root],now:()=>now,staleAfterMs:60000});
  const success=adapter.snapshot();assert.equal(success.status,'fresh');
  const writer=new DatabaseSync(path);writer.exec('BEGIN EXCLUSIVE');
  try {
    now+=1000;const stale=adapter.snapshot();assert.equal(stale.status,'stale');assert.equal(stale.error.code,'SOURCE_BUSY');assert.equal(stale.data.tasks[0].id,'task-0');assert.equal(stale.staleAgeMs,1000);
    now+=60001;const expired=adapter.snapshot();assert.equal(expired.status,'unavailable');assert.deepEqual(expired.data.tasks,[]);
  }finally{writer.exec('ROLLBACK');writer.close();}
  assert.equal(adapter.snapshot().status,'fresh');
});

test('invalid source values fail closed without returning a partial snapshot',t=>{
  const {path,adapter}=fixture(t);const db=new DatabaseSync(path);db.prepare('UPDATE events SET start_ts=?').run('not-a-date');db.close();
  const result=adapter.snapshot();assert.equal(result.error.code,'SOURCE_DATA_INVALID');assert.deepEqual(result.data.tasks,[]);
});

test('configuration bounds prevent unbounded snapshots',()=>{
  assert.throws(()=>createSecretaryAdapter({maxRows:100000}),/configuration/);
  assert.throws(()=>createSecretaryAdapter({staleAfterMs:Infinity}),/configuration/);
});
