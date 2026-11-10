import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GoogleCache} from '../../src/google/cache.mjs';
import {createSync} from '../../src/google/sync.mjs';

function fixture(t,overrides={}){
 const directory=mkdtempSync(join(tmpdir(),'kst-google-sync-contract-'));
 const cache=new GoogleCache(directory);
 let account={accountId:'account-A',generation:1,settings:{selectedCalendarIds:['calendar-A']}};
 let now=Date.now();
 const gmail={metadata:m=>m,profile:async()=>({historyId:'H0'}),listMetadata:async()=>({messages:[]}),get:async(a,id)=>({id,threadId:'t-'+id,labelIds:['INBOX'],internalDate:String(now)}),history:async()=>({historyId:'H1'}),...overrides.gmail};
 const calendar={calendarList:async()=>[{id:'calendar-A',accessRole:'owner'}],syncPage:async()=>({items:[],nextSyncToken:'C1'}),...overrides.calendar};
 const sync=createSync({cache,gmail,calendar,getAccount:()=>account,clock:()=>now});
 t.after(async()=>{await sync.close();cache.close();rmSync(directory,{recursive:true,force:true});});
 return {cache,sync,gmail,calendar,get account(){return account;},set account(a){account=a;},get now(){return now;},advance:ms=>{now+=ms;},mail:id=>({id,threadId:'t-'+id,labelIds:['INBOX'],internalDate:String(now)}),gmailConfig:()=>({label:'INBOX',days:30,day:new Date(now).toISOString().slice(0,10)})};
}
function providerError(status){return Object.assign(new Error('Fake provider rejection'),{providerStatus:status,code:status===404?'GOOGLE_NOT_FOUND':'GOOGLE_CURSOR_EXPIRED'});}
const calendarConfig={singleEvents:false,showDeleted:true,maxResults:250};
function event(id,extra={}){return {id,etag:'etag-'+id,status:'confirmed',summary:id,...extra};}

test('G10/G11 scoped: Gmail paginated bootstrap captures starting history before pages and catches up all history pages',async t=>{
 const f=fixture(t),calls=[];
 f.gmail.profile=async()=>{calls.push('profile');return {historyId:'before-bootstrap'};};
 f.gmail.listMetadata=async(a,q,token)=>{calls.push('list:'+String(token));assert.equal(q,'in:inbox newer_than:30d');return token?{messages:[{id:'b'}]}:{messages:[{id:'a'}],nextPageToken:'next-list'};};
 f.gmail.get=async(a,id)=>f.mail(id);
 f.gmail.history=async(a,start,token)=>{calls.push('history:'+String(token));assert.equal(start,'before-bootstrap');return token?{history:[{messagesDeleted:[{message:{id:'b'}}]}],historyId:'after-catchup'}:{history:[{messagesAdded:[{message:{id:'c'}}]}],historyId:'intermediate',nextPageToken:'history-page-2'};};
 await f.sync.run('gmail');
 assert.equal(calls[0],'profile');
 assert.deepEqual(calls,['profile','list:undefined','list:next-list','history:undefined','history:history-page-2']);
 assert.deepEqual(f.cache.resources(f.account,'gmail:recent').map(x=>x.id).sort(),['a','c']);
 const state=f.cache.state(f.account,'gmail:recent');
 assert.equal(state.cursor,'after-catchup');assert.equal(state.complete,1);
});

test('G11/G37 scoped: Gmail repeated history IDs, deleted records and previous LIMIT status remain bounded and incomplete',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'gmail:recent',[f.mail('a'),f.mail('b')],{cursor:'old-history',complete:false,config:f.gmailConfig(),error:'LIMIT'});
 f.gmail.profile=async()=>assert.fail('Same-day incremental sync must not bootstrap');
 f.gmail.get=async(a,id)=>f.mail(id);
 f.gmail.history=async(a,start,token)=>{assert.equal(start,'old-history');return token?{history:[{messages:[{id:'a'},{id:'a'}],messagesDeleted:[{message:{id:'b'}}]}],historyId:'new-history'}:{history:[{messagesAdded:[{message:{id:'c'}},{message:{id:'c'}}],labelsAdded:[{message:{id:'a'}}]}],nextPageToken:'second'};};
 await f.sync.run('gmail');
 assert.deepEqual(f.cache.resources(f.account,'gmail:recent').map(x=>x.id).sort(),['a','c']);
 const state=f.cache.state(f.account,'gmail:recent');
 assert.equal(state.cursor,'new-history');assert.equal(state.complete,0);assert.equal(state.error_code,'LIMIT');
});

test('G12/G09 scoped: Gmail expired history reboots only its account collection and publishes the new cursor',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'gmail:recent',[f.mail('old')],{cursor:'expired',config:f.gmailConfig()});
 const other={...f.account,accountId:'account-B'};
 f.cache.publish(other,'gmail:recent',[f.mail('other-account')],{cursor:'other-cursor',config:f.gmailConfig()});
 let profiles=0;
 f.gmail.profile=async()=>{profiles++;return {historyId:'fresh-start'};};
 f.gmail.listMetadata=async()=>({messages:[{id:'new'}]});
 f.gmail.get=async(a,id)=>f.mail(id);
 f.gmail.history=async(a,start)=>{if(start==='expired')throw providerError(404);assert.equal(start,'fresh-start');return {historyId:'fresh-end'};};
 await f.sync.run('gmail');
 assert.equal(profiles,1);
 assert.deepEqual(f.cache.resources(f.account,'gmail:recent').map(x=>x.id),['new']);
 assert.equal(f.cache.state(f.account,'gmail:recent').cursor,'fresh-end');
 assert.deepEqual(f.cache.resources(other,'gmail:recent').map(x=>x.id),['other-account']);
 assert.equal(f.cache.state(other,'gmail:recent').cursor,'other-cursor');
});

test('G19/G20 scoped: Calendar 410 discards the expired mirror and fully paginates before publishing replacement cursor',async t=>{
 const f=fixture(t),calls=[];
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{config:calendarConfig,cursor:'expired-calendar'});
 f.calendar.syncPage=async(a,id,{syncToken,pageToken})=>{
  calls.push({syncToken,pageToken});
  if(syncToken==='expired-calendar')throw providerError(410);
  return pageToken?{items:[event('new-a',{summary:'updated'}),event('new-b')],nextSyncToken:'new-calendar-cursor'}:{items:[event('new-a')],nextPageToken:'second-page'};
 };
 await f.sync.run('calendar');
 assert.deepEqual(calls,[{syncToken:'expired-calendar',pageToken:undefined},{syncToken:undefined,pageToken:undefined},{syncToken:undefined,pageToken:'second-page'}]);
 const rows=f.cache.resources(f.account,'calendar:calendar-A');
 assert.deepEqual(rows.map(x=>x.id).sort(),['new-a','new-b']);
 assert.equal(rows.find(x=>x.id==='new-a').summary,'updated');
 assert.equal(f.cache.state(f.account,'calendar:calendar-A').cursor,'new-calendar-cursor');
});

test('G19 scoped: Calendar incremental tombstones remove only the matching remote event',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'calendar:calendar-A',[event('a'),event('b')],{config:calendarConfig,cursor:'old'});
 f.calendar.syncPage=async(a,id,{syncToken})=>{assert.equal(syncToken,'old');return {items:[{id:'a',status:'cancelled'},event('b',{summary:'new title'})],nextSyncToken:'next'};};
 await f.sync.run('calendar');
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A').map(x=>({id:x.id,summary:x.summary})),[{id:'b',summary:'new title'}]);
 assert.equal(f.cache.state(f.account,'calendar:calendar-A').cursor,'next');
});

test('G21/G37 scoped: oversized Calendar resource becomes QUERY_ONLY and never publishes its candidate sync cursor',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{config:calendarConfig,cursor:'old-cursor'});
 f.calendar.syncPage=async()=>({items:[event('huge',{description:'x'.repeat(65536)})],nextSyncToken:'must-not-publish'});
 await f.sync.run('calendar');
 const state=f.cache.state(f.account,'calendar:calendar-A');
 assert.equal(state.phase,'QUERY_ONLY');assert.equal(state.complete,0);assert.equal(state.cursor,null);
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A'),[]);
});

test('G21 scoped: 5001 Calendar masters stop the bounded mirror without advancing a partial snapshot cursor',async t=>{
 const f=fixture(t);let pages=0;
 f.calendar.syncPage=async(a,id,{pageToken})=>{
  const page=Number(pageToken??0),start=page*250;pages++;
  return {items:Array.from({length:Math.min(250,5001-start)},(_,i)=>event('event-'+(start+i))),...(start+250<5001?{nextPageToken:String(page+1)}:{nextSyncToken:'must-not-publish'})};
 };
 await f.sync.run('calendar');
 assert.equal(pages,21);
 const state=f.cache.state(f.account,'calendar:calendar-A');
 assert.equal(state.phase,'QUERY_ONLY');assert.equal(state.cursor,null);assert.equal(state.complete,0);
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A'),[]);
});

test('G30/G37 scoped: real SQLite FULL during snapshot replacement preserves old rows and cursor atomically',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{config:calendarConfig,cursor:'old-cursor'});
 const old=f.cache.state(f.account,'calendar:calendar-A');
 const pages=f.cache.db.prepare('PRAGMA page_count').get().page_count;
 f.cache.db.exec('PRAGMA max_page_count='+pages);
 f.calendar.syncPage=async()=>({items:Array.from({length:150},(_,i)=>event('new-'+i,{description:'x'.repeat(1024)})),nextSyncToken:'new-cursor'});
 await assert.rejects(f.sync.run('calendar'),e=>/full/i.test(e.message));
 const state=f.cache.state(f.account,'calendar:calendar-A');
 assert.equal(state.cursor,'old-cursor');assert.equal(state.active_snapshot_id,old.active_snapshot_id);
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A').map(x=>x.id),['old']);
});

test('G08/G09 scoped: account generation change during a Calendar page prevents publication',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{config:calendarConfig,cursor:'old-cursor'});
 let release,startedResolve;const gate=new Promise(r=>release=r),started=new Promise(r=>startedResolve=r);
 f.calendar.syncPage=async()=>{startedResolve();await gate;return {items:[event('new')],nextSyncToken:'must-not-publish'};};
 const pending=f.sync.run('calendar');await started;
 f.account={...f.account,generation:2};release();
 await assert.rejects(pending,e=>e.code==='ACCOUNT_CHANGED');
 assert.equal(f.cache.state(f.account,'calendar:calendar-A').cursor,'old-cursor');
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A').map(x=>x.id),['old']);
});

test('G29 scoped: Stop during a Calendar page prevents publication and leaves the last coherent mirror',async t=>{
 const f=fixture(t);
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{config:calendarConfig,cursor:'old-cursor'});
 let release,startedResolve;const gate=new Promise(r=>release=r),started=new Promise(r=>startedResolve=r);
 f.calendar.syncPage=async()=>{startedResolve();await gate;return {items:[event('new')],nextSyncToken:'must-not-publish'};};
 const pending=f.sync.run('calendar');await started;f.sync.stop();release();
 await assert.rejects(pending,e=>e.code==='ACCOUNT_CHANGED');
 assert.equal(f.cache.state(f.account,'calendar:calendar-A').cursor,'old-cursor');
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A').map(x=>x.id),['old']);
});

test('G09 scoped: identical remote IDs are isolated by account and clearing one does not clear the other',t=>{
 const f=fixture(t),other={...f.account,accountId:'account-B'};
 f.cache.publish(f.account,'calendar:calendar-A',[event('same',{summary:'account A'})],{config:calendarConfig,cursor:'A-cursor'});
 f.cache.publish(other,'calendar:calendar-A',[event('same',{summary:'account B'})],{config:calendarConfig,cursor:'B-cursor'});
 f.cache.calendars(f.account,[{id:'calendar-A',summary:'A'}]);f.cache.calendars(other,[{id:'calendar-A',summary:'B'}]);
 f.cache.clear(f.account.accountId);
 assert.equal(f.cache.state(f.account,'calendar:calendar-A'),undefined);
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A'),[]);
 assert.equal(f.cache.state(other,'calendar:calendar-A').cursor,'B-cursor');
 assert.equal(f.cache.resources(other,'calendar:calendar-A')[0].summary,'account B');
 assert.equal(f.cache.calendarList(other)[0].summary,'B');
});

test('G20 scoped: changed Calendar query config rejects old cursor and rebuilds a complete fresh mirror',async t=>{
 const f=fixture(t),tokens=[];
 f.cache.publish(f.account,'calendar:calendar-A',[event('old')],{cursor:'must-not-use',config:{singleEvents:true}});
 f.calendar.syncPage=async(a,id,{syncToken})=>{tokens.push(syncToken);return {items:[event('fresh')],nextSyncToken:'fresh-cursor'};};
 await f.sync.run('calendar');
 assert.deepEqual(tokens,[undefined]);
 assert.equal(f.cache.state(f.account,'calendar:calendar-A').cursor,'fresh-cursor');
 assert.deepEqual(f.cache.resources(f.account,'calendar:calendar-A').map(x=>x.id),['fresh']);
});
