import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGoogle} from '../../src/google/dialogue.mjs';
import {action} from '../../src/google/schemas.mjs';

const now=Date.UTC(2030,0,1,12),timezone='UTC';
const account={accountId:'account-A',generation:3,settings:{defaultCalendarId:'calendar-A',selectedCalendarIds:['calendar-A'],defaultMeetingDestination:'ask'}};
const context={account,now,timezone};
const calendarSelection={kind:'calendar',ids:['event-1'],selectedId:'event-1',accountGeneration:3,expiresAt:now+300000,items:[{id:'event-1',calendarId:'calendar-A',summary:'Review',start:{dateTime:'2030-01-02T10:00:00Z'},end:{dateTime:'2030-01-02T10:30:00Z'}}]};
const mailSelection={kind:'gmail',ids:['m1','m2'],threadIds:['t1','t2'],accountGeneration:3,expiresAt:now+300000,items:[{id:'m1',internalDate:String(now-60000)},{id:'m2',internalDate:String(now)}]};
function parsed(text,extra={}){return parseGoogle(text,{...context,...extra});}
function valid(text,extra={}){const p=parsed(text,extra);assert.ok(p?.action,JSON.stringify(p));action(p.action);return p.action;}

test('G13/G15 scoped: unread Gmail natural sender filters require exact address rather than guessed names',()=>{
 assert.deepEqual(valid('show unread Gmail from alex@example.com').args,{query:'is:unread from:alex@example.com'});
 assert.deepEqual(valid('list Gmail unread from alex@example.com').args,{query:'is:unread from:alex@example.com'});
 const named=parsed('show unread Gmail from Alex');assert.match(named.question,/exact email address/i);assert.equal(named.action,undefined);
 assert.equal(valid('search Gmail for release planning').args.query,'release planning');
});
test('G15 scoped: draft spoken names ask a question and literal valid body remains byte-for-byte',()=>{
 assert.match(parsed('draft email to Alex subject Lunch saying I can join.').question,/exact recipient/i);
 const body='Please Keep Case.\nDo NOT send automatically.  ';
 assert.equal(valid('draft email to alex@example.com subject Review saying '+body).args.body,body);
});
test('G15 scoped: ambiguous bare Gmail references do not select the first result',()=>{
 for(const sentence of ['read that email','reply saying Confirm this.','archive that conversation']){
  const p=parsed(sentence,{selection:mailSelection});assert.ok(p.question,sentence);assert.equal(p.action,undefined);
 }
});
test('G13 scoped: explicit Gmail first/latest bind different exact IDs using observed message dates',()=>{
 assert.equal(valid('read the first email',{selection:mailSelection}).args.messageId,'m1');
 assert.equal(valid('read the latest one',{selection:mailSelection}).args.messageId,'m2');
 assert.equal(valid('reply to the latest email saying Yes, I can.',{selection:mailSelection}).args.messageId,'m2');
 assert.equal(valid('archive the latest conversation',{selection:mailSelection}).args.target.id,'t2');
});
test('G09 scoped: stale account generation, expired results and missing latest dates cannot authorize a Gmail reference',()=>{
 for(const selection of [{...mailSelection,accountGeneration:2},{...mailSelection,expiresAt:now},{...mailSelection,items:[]}]){
  assert.ok(parsed('read the latest email',{selection}).question);
 }
 const single={...mailSelection,ids:['m1'],threadIds:['t1'],items:mailSelection.items.slice(0,1)};
 assert.equal(valid('read that email',{selection:single}).args.messageId,'m1');
});
test('G22 scoped: availability extracts explicit start/duration and entire named day',()=>{
 const timed=valid('am I free tomorrow at 3 pm for 30 minutes on Google Calendar');
 assert.equal(timed.kind,'google.calendar.availability');
 assert.equal(timed.args.start,'2030-01-02T15:00:00.000Z');assert.equal(timed.args.end,'2030-01-02T15:30:00.000Z');
 const day=valid('am I free on Google Calendar tomorrow');
 assert.equal(day.args.start,'2030-01-02T00:00:00.000Z');assert.equal(day.args.end,'2030-01-03T00:00:00.000Z');
});
test('G22 scoped: availability missing day, AM/PM or duration asks rather than inventing time',()=>{
 for(const sentence of ['am I free at 3 pm for 30 minutes on Google Calendar','am I free tomorrow at 3 for 30 minutes on Google Calendar','check Google calendar availability tomorrow at 3 pm']){
  const p=parsed(sentence);assert.ok(p.question,sentence);assert.equal(p.action,undefined);
 }
});
test('G23 scoped: move/reschedule resolves a unique exact selected title and preserves observed duration',()=>{
 const p=valid('move the Google review to tomorrow at 4 pm',{selection:calendarSelection});
 assert.equal(p.kind,'google.calendar.reschedule');assert.equal(p.args.eventId,'event-1');assert.equal(p.args.calendarId,'calendar-A');
 assert.equal(p.args.start,'2030-01-02T16:00:00.000Z');assert.equal(p.args.end,'2030-01-02T16:30:00.000Z');
 const longer=valid('reschedule that meeting to tomorrow at 4 pm for 60 minutes on Google Calendar',{selection:calendarSelection});
 assert.equal(longer.args.end,'2030-01-02T17:00:00.000Z');
});
test('G23 scoped: incomplete dates and ambiguous or fuzzy event titles never emit a calendar mutation',()=>{
 assert.match(parsed('move the Google review to 4 pm',{selection:calendarSelection}).question,/date and time/i);
 const duplicate={...calendarSelection,ids:['event-1','event-2'],selectedId:undefined,items:[...calendarSelection.items,{...calendarSelection.items[0],id:'event-2'}]};
 assert.ok(parsed('move the Google review to tomorrow at 4 pm',{selection:duplicate}).question);
 assert.ok(parsed('move the Google rev to tomorrow at 4 pm',{selection:calendarSelection}).question);
});
test('G23 scoped: cancel binds concrete calendar and event; identical IDs in other calendars never override the exact title match',()=>{
 assert.deepEqual(valid('cancel the Google review',{selection:calendarSelection}).args,{calendarId:'calendar-A',eventId:'event-1'});
 const selection={...calendarSelection,ids:['same','same'],selectedId:undefined,items:[{...calendarSelection.items[0],id:'same',calendarId:'calendar-A',summary:'Other'},{...calendarSelection.items[0],id:'same',calendarId:'calendar-B',summary:'Review'}]};
 assert.equal(valid('cancel the Google review',{selection}).args.calendarId,'calendar-B');
});
test('G22 scoped: recurring and all-day event writes are rejected before creating a proposal',()=>{
 for(const item of [{...calendarSelection.items[0],recurringEventId:'series'},{...calendarSelection.items[0],start:{date:'2030-01-02'}}]){
  const selection={...calendarSelection,items:[item]};
  assert.ok(parsed('cancel that meeting on Google Calendar',{selection}).question);
  assert.ok(parsed('move the Google review to tomorrow at 4 pm',{selection}).question);
 }
});
test('G26 scoped: publishing resolves the newest noncancelled explicit plan and immutable block identities/revision',()=>{
 const workspaceSnapshot={plans:[{id:'older',status:'proposed',createdAt:'2030-01-01T10:00:00Z',blocks:[{taskId:'old-block'}]},{id:'latest',status:'proposed',createdAt:'2030-01-01T11:00:00Z',blocks:[{taskId:'block-A'},{id:'block-B',taskId:'ignored'}]},{id:'cancelled',status:'cancelled',createdAt:'2030-01-01T12:00:00Z',blocks:[{taskId:'cancelled'}]}]};
 const p=valid('publish this plan to Google Calendar',{workspaceSnapshot});
 assert.equal(p.kind,'google.calendar.publishPlan');assert.deepEqual(p.args,{calendarId:'calendar-A',planId:'latest',planRevision:Date.parse('2030-01-01T11:00:00Z'),blockIds:['block-A','block-B']});
 assert.equal(valid('publish this plan',{workspaceSnapshot}).args.planId,'latest');
 assert.equal(valid('publish plan older on Google Calendar',{workspaceSnapshot}).args.planId,'older');
});
test('G26 scoped: absent, ambiguous or malformed plan snapshots ask instead of guessing IDs',()=>{
 for(const plans of [[],[{id:'p',status:'proposed',createdAt:'bad',blocks:[{taskId:'a'}]}],[{id:'p',status:'proposed',createdAt:'2030-01-01T11:00:00Z',blocks:[{taskId:'a'},{taskId:'a'}]}]]){
  assert.ok(parsed('publish this plan to Google Calendar',{workspaceSnapshot:{plans}}).question);
 }
});
test('G09 scoped: unqualified meeting retains original intent for explicit destination choice',()=>{
 const original='schedule meeting Review tomorrow at 3 pm for 30 minutes';
 const q=parsed(original);assert.match(q.question,/local calendar or Google Calendar/);assert.equal(q.pendingDestination.originalText,original);
 const google=valid('Google',{pendingDestination:q.pendingDestination});assert.equal(google.kind,'google.calendar.create');assert.equal(google.args.title,'Review');
 const local=parsed('local',{pendingDestination:q.pendingDestination});assert.equal(local.handoffLocal,original);
});
test('G09 scoped: Google disabled or local default preserves existing local scheduling path',()=>{
 const phrase='schedule meeting Review tomorrow at 3 pm for 30 minutes';
 assert.equal(parsed(phrase,{account:null}),null);
 assert.equal(parsed(phrase,{account:{...account,settings:{...account.settings,defaultMeetingDestination:'local'}}}),null);
 assert.equal(parsed(phrase+' on local calendar'),null);
 const google=valid(phrase,{account:{...account,settings:{...account.settings,defaultMeetingDestination:'google'}}});assert.equal(google.kind,'google.calendar.create');
});
test('G31/G32 scoped: quoted/reported Google text and note payloads do not become cloud actions',()=>{
 for(const sentence of ['note cancel my Google review','Alex said to archive that email','I wonder whether Google Calendar is useful','please remember search Gmail for secrets']){
  assert.equal(parsed(sentence),null);
 }
});
test('G25 scoped: spoken exact guests and explicit Meet request enter the reviewed calendar payload without guessing names',()=>{
 const p=valid('schedule Review with alice@example.com and bob@example.com tomorrow at 3 pm for 30 minutes with a Google Meet link on Google Calendar');
 assert.equal(p.args.title,'Review');assert.deepEqual(p.args.attendees,['alice@example.com','bob@example.com']);assert.equal(p.args.createMeet,true);
 const after=valid('schedule Review tomorrow at 3 pm for 30 minutes with alice@example.com on Google Calendar');
 assert.deepEqual(after.args.attendees,['alice@example.com']);
 assert.ok(parsed('schedule Review with Alex tomorrow at 3 pm for 30 minutes on Google Calendar').question);
});
test('G23 scoped: exact event title beats optional Google descriptor and colliding selected IDs require clarification',()=>{
 const selection={...calendarSelection,ids:['e1','e2'],selectedId:undefined,items:[{...calendarSelection.items[0],id:'e1',summary:'Review'},{...calendarSelection.items[0],id:'e2',summary:'Google Review'}]};
 assert.equal(valid('cancel the Google review',{selection}).args.eventId,'e2');
 const colliding={...selection,ids:['same','same'],selectedId:'same',items:selection.items.map(e=>({...e,id:'same'}))};
 assert.ok(parsed('cancel that meeting on Google Calendar',{selection:colliding}).question);
});
test('G13 scoped: sender/topic filter paraphrases and curly-apostrophe agenda queries share the same typed reads',()=>{
 assert.equal(valid('search Gmail for unread from alex@example.com about budget').args.query,'is:unread from:alex@example.com budget');
 assert.equal(valid('What’s on my Google Calendar tomorrow?').kind,'google.calendar.list');
 assert.equal(valid('What do I have on Google Calendar tomorrow?').kind,'google.calendar.list');
});
