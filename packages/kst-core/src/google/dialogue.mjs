import {dailyScope,extractDate,duration,temporalTitle} from '../understanding/extraction.mjs';
import {address} from './schemas.mjs';

const normalize=s=>s.normalize('NFC').toLowerCase().replace(/[’]/gu,"'").replace(/\s+/gu,' ').trim();
const question=text=>({question:text});
const explicitDay=s=>/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d\d-\d\d|in \d+ (?:minutes?|hours?|days?))\b/iu.test(s);
function binding(selection,account,now,kind){
 return selection?.kind===kind&&Array.isArray(selection.ids)&&selection.ids.length&&
  (!account||selection.accountGeneration===undefined||selection.accountGeneration===account.generation)&&
  (selection.expiresAt===undefined||selection.expiresAt>now)?selection:null;
}
function selectedIndex(selection,reference){
 if(!selection)return -1;
 if(/\bfirst\b/iu.test(reference))return 0;
 if(/\blatest\b/iu.test(reference)){
  const dates=selection.ids.map(id=>Number(selection.items?.find(x=>x.id===id)?.internalDate));
  const max=Math.max(...dates);return Number.isFinite(max)&&dates.filter(x=>x===max).length===1?dates.indexOf(max):-1;
 }
 if(selection.selectedId)return selection.ids.filter(id=>id===selection.selectedId).length===1?selection.ids.indexOf(selection.selectedId):-1;
 return selection.ids.length===1?0:-1;
}
function safeAddress(value){try{return address(value);}catch{return null;}}

/** Deterministic routing only. Body payloads are never normalized or interpreted as commands. */
export function parseGoogle(text,{account,selection,now=Date.now(),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone,workspaceSnapshot,workspace,pendingDestination,contextRevision}={}){
 const literal=text.trimStart(),t=text.trim(),clean=t.replace(/[’]/gu,"'").replace(/[.!?]+$/u,'');let m;
 if(pendingDestination&&/^(?:google|google calendar|local|local calendar)$/iu.test(clean)){
  if(/^local/iu.test(clean))return {handoffLocal:pendingDestination.originalText};
  return parseGoogle(pendingDestination.originalText+' on Google Calendar',{account,selection,now,timezone,workspaceSnapshot,workspace,contextRevision});
 }
 if(/^(?:connect|link)(?: my| to)? google(?: account| apps)?$/iu.test(clean))return {control:'connect'};
 if(/^(?:disconnect|unlink)(?: my)? google(?: account)?$/iu.test(clean))return {control:'disconnect'};
 if(/^(?:refresh|sync)(?: my)?(?: google(?: apps)?)?(?: gmail| google calendar)?$/iu.test(clean)&&/google|gmail/iu.test(clean))return {control:'sync',service:/gmail/iu.test(clean)?'gmail':/calendar/iu.test(clean)?'calendar':'all'};
 if(/^(?:schedule|proceed|book) despite (?:this|the) conflict$/iu.test(clean))return {control:'allowConflict'};
 if(/^(?:confirm|approve)(?: this| the)? google (?:action|request)$/iu.test(clean)||/^(?:yes|confirm)$/iu.test(clean))return {control:'confirm'};
 if(/^(?:send|send it|send the prepared email)$/iu.test(clean))return {control:'send'};
 if(/^(?:cancel|decline)(?: this| the)? google (?:action|request)$/iu.test(clean))return {control:'cancel'};
 const make=(kind,args)=>({action:{kind,accountId:account?.accountId??'',accountGeneration:account?.generation??0,args}});
 const mail=binding(selection,account,now,'gmail');
 const mailIndex=reference=>selectedIndex(mail,reference);
 if(/^(?:give me|show|read)(?: an?| my)? inbox briefing$/iu.test(clean))return make('google.gmail.search',{query:'in:inbox newer_than:30d'});
 if((m=clean.match(/^(?:search|find|show|list)(?: my)? (unread )?(?:gmail|emails?|mail)(?:\s+(.+))?$/iu))){
  let rest=(m[2]?.trim()??'').replace(/^(?:for|matching|about)\s+/iu,''),filters=m[1]?['is:unread']:[];
  if(/^unread\b/iu.test(rest)){filters.push('is:unread');rest=rest.replace(/^unread\b\s*/iu,'');}
  if(/^from\s+/iu.test(rest)){
   const senderClause=rest.replace(/^from\s+/iu,'').trim(),parts=senderClause.match(/^(\S+)(?:\s+(?:about|matching|for)\s+(.+))?$/iu),sender=parts?.[1]??senderClause,email=safeAddress(sender);
   if(!email)return question('What exact email address belongs to '+sender+'? I do not guess addresses from names.');
   filters.push('from:'+email);rest=parts?.[2]??'';
  }else rest=rest.replace(/^(?:for|matching|about)\s+/iu,'');
  return make('google.gmail.search',{query:[...filters,rest].filter(Boolean).join(' ')||'in:inbox'});
 }
 if(/^(?:read|open)(?: the)? (?:latest|first)(?: email|message| one)?$/iu.test(clean)||/^(?:read|open) that (?:email|message)$/iu.test(clean)){
  const index=mailIndex(clean);
  return index>=0?make('google.gmail.read',{messageId:mail.ids[index]}):question('Search Gmail and select one exact message, or say “read the first email”. Latest needs a result with a verified date.');
 }
 if((m=literal.match(/^(?:draft|prepare)(?: an?)? email to (\S+) (?:with )?subject (.+?) (?:saying|body) ([\s\S]+)$/iu))){
  const to=safeAddress(m[1]);return to?make('google.gmail.draft',{to:[to],cc:[],subject:m[2],body:m[3]}):question('What exact recipient email address should this draft use?');
 }
 if((m=literal.match(/^reply(?: to ((?:that|the latest|the first) (?:email|message)))? (?:saying|with) ([\s\S]+)$/iu))){
  const index=mailIndex(m[1]??'that');
  return index>=0?make('google.gmail.replyDraft',{messageId:mail.ids[index],body:m[2]}):question('Which exact email should I reply to? Select one message or name the first/latest result explicitly.');
 }
 if((m=clean.match(/^(archive|trash|mark (?:read|unread))(?: that| the latest| the first)? (email|message|conversation|thread)$/iu))){
  const index=mailIndex(clean);if(index<0)return question('Select an exact Gmail message first, or explicitly name the first/latest result.');
  const thread=/conversation|thread/iu.test(m[2]),id=thread?mail.threadIds?.[index]:mail.ids[index];
  if(!id)return question('This result does not contain a verified conversation identity. Search Gmail again.');
  return make(m[1].toLowerCase()==='trash'?'google.gmail.trash':'google.gmail.setLabels',{target:{type:thread?'thread':'message',id},...(/^(?:archive|mark)/iu.test(m[1])?{mode:/unread/iu.test(m[1])?'unread':/read/iu.test(m[1])?'read':'archive'}:{})});
 }
 if((m=clean.match(/^(?:send|send prepared) (?:gmail )?draft ([\w-]+)$/iu)))return make('google.gmail.sendPrepared',{sourceDraftId:m[1]});
 const googleExplicit=/\bgoogle\b/iu.test(clean),localExplicit=/\b(?:on|in) (?:my )?local (?:calendar|timeline)\b/iu.test(clean);
 const meetingVerb=/^(?:schedule|create|add|book|move|reschedule|cancel|delete)\b/iu.test(clean);
 const genericMeeting=meetingVerb&&/\b(?:meeting|appointment|event)\b/iu.test(clean);
 const destination=account?.settings?.defaultMeetingDestination??'ask';
 if(localExplicit)return null;
 if(genericMeeting&&!googleExplicit){
  if(!account||destination==='local')return null;
  if(destination==='ask')return {question:'Should this meeting use your local calendar or Google Calendar? Say “local” or “Google”.',pendingDestination:{originalText:t}};
 }
 const googleMeeting=googleExplicit||genericMeeting&&account&&destination==='google';
 const ids=account?.settings?.selectedCalendarIds??[];
 if(googleExplicit&&(/\b(?:am i free|are we free|availability|available|busy|free time)\b/iu.test(clean))){
  if(!ids.length)return question('Select the Google calendars to check in connection settings first.');
  const mins=duration(clean),hasTime=/\b(?:at|between|from|noon|midnight)\b|\d\s*(?:am|pm)\b|\d:\d/iu.test(clean);
  if(!hasTime){const day=dailyScope(clean,{now,timezone});return day?make('google.calendar.availability',{calendarIds:ids,start:day.startAt,end:day.endAt,timeZone:timezone}):question('Which day and time interval should I check?');}
  if(!explicitDay(clean))return question('Which date should I check? Please include the day, time and duration.');
  const when=extractDate(clean,{now,timezone});if(when.ambiguity||!when.value)return question(when.ambiguity??'What start time, including AM or PM?');
  if(!mins)return question('How many minutes should I check for availability?');
  return make('google.calendar.availability',{calendarIds:ids,start:when.value,end:new Date(Date.parse(when.value)+mins*60000).toISOString(),timeZone:timezone});
 }
 if((googleMeeting||account&&/^publish\b/iu.test(clean))&&(m=clean.match(/^(?:publish|put|add)(?: this| the latest| my)? (?:focus )?plan(?: ([\w-]+))?(?: (?:to|on|in) (?:my )?google calendar)?$/iu))){
  const calendarId=account?.settings?.defaultCalendarId;if(!calendarId)return question('Choose an owned default Google calendar in connection settings first.');
  const snapshot=workspaceSnapshot??workspace,plans=(snapshot?.plans??[]).filter(p=>['proposed','applied'].includes(p.status));
  let plan;if(m[1])plan=plans.find(p=>p.id===m[1]);else{
   const sorted=[...plans].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
   if(sorted.length&&(!sorted[1]||Date.parse(sorted[0].createdAt)!==Date.parse(sorted[1].createdAt)))plan=sorted[0];
  }
  const revision=Date.parse(plan?.createdAt),blockIds=plan?.blocks?.map(b=>b.id??b.taskId);
  if(!plan||!Number.isSafeInteger(revision)||!blockIds?.length||blockIds.length>20||blockIds.some(id=>typeof id!=='string'||!id)||new Set(blockIds).size!==blockIds.length)return question('Select a current explicit focus plan with valid block identities before publishing.');
  return make('google.calendar.publishPlan',{calendarId,planId:plan.id,planRevision:revision,blockIds});
 }
 const events=binding(selection,account,now,'calendar');
 function eventTarget(reference){
  if(!events)return null;
  const exact=normalize(reference).replace(/^(?:the |my )/u,'').replace(/^(?:meeting|event|appointment) /u,'').replace(/^(?:the |my )/u,'');
  const cleaned=exact.replace(/^google /u,'').replace(/^(?:meeting|event|appointment) /u,'');
  let index;
  if(/^(?:that|this)(?: (?:google )?(?:meeting|event|appointment))?$|^first(?: (?:meeting|event|appointment))?$/u.test(cleaned))index=selectedIndex(events,cleaned);
  else{
   const exactMatches=(events.items??[]).filter(e=>normalize(e.summary??'')===exact);
   const matches=exactMatches.length?exactMatches:(events.items??[]).filter(e=>normalize(e.summary??'')===cleaned);
   if(matches.length!==1)return null;return matches[0];
  }
  if(index<0)return null;
  const item=events.items?.[index];return item?.id===events.ids[index]?item:null;
 }
 if(googleMeeting&&(m=clean.match(/^(?:move|reschedule)(?:\s+)(.+?)\s+(?:to|for)\s+(.+?)(?:\s+(?:on|in)\s+(?:my )?google calendar)?$/iu))){
  const event=eventTarget(m[1]);if(!event?.id||!event.calendarId)return question('Search your Google calendar and select one exact event, or provide a unique title from those results.');
  const timing=m[2];if(!explicitDay(timing))return question('What date and time should I move this Google event to? Include the day and AM or PM.');
  const when=extractDate(timing,{now,timezone});if(when.ambiguity||!when.value)return question(when.ambiguity??'What new date and time?');
  if(event.recurringEventId||event.recurrence?.length||event.start?.date)return question('Recurring and all-day Google event changes are not supported in this release.');
  const originalDuration=Date.parse(event.end?.dateTime)-Date.parse(event.start?.dateTime),mins=duration(timing);
  const ms=mins?mins*60000:originalDuration;
  if(!Number.isFinite(ms)||ms<=0||ms>86400000)return question('How many minutes should the moved meeting last? Repeat the request with its duration.');
  return make('google.calendar.reschedule',{calendarId:event.calendarId,eventId:event.id,start:when.value,end:new Date(Date.parse(when.value)+ms).toISOString(),timeZone:timezone});
 }
 if(googleMeeting&&(m=clean.match(/^(?:cancel|delete)\s+(.+?)(?:\s+(?:on|in)\s+(?:my )?google calendar)?$/iu))){
  const event=eventTarget(m[1]);if(event&&(event.recurringEventId||event.recurrence?.length||event.start?.date))return question('Recurring and all-day Google event changes are not supported in this release.');return event?.id&&event.calendarId?make('google.calendar.cancel',{calendarId:event.calendarId,eventId:event.id}):question('Select one exact Google event or give a unique title from the current calendar results before cancelling.');
 }
 if(googleExplicit&&(/^(?:what(?: is|'s| do i have| have i got)|show|list|read|check|do i have|what meetings|what appointments|what events)/iu.test(clean))&&/\bgoogle calendar\b/iu.test(clean)){
  const scope=dailyScope(clean,{now,timezone});if(!scope)return question('Which day should I check on Google Calendar?');if(!ids.length)return question('Select the Google calendars to read in connection settings first.');
  return make('google.calendar.list',{calendarIds:ids,start:scope.startAt,end:scope.endAt,timeZone:timezone});
 }
 if(googleMeeting&&(m=clean.match(/^(?:schedule|create|add|book)(?: a| an)?(?: meeting| appointment| event)?\s+(.+?)(?:\s+(?:on|in)\s+(?:my )?google calendar)?$/iu))){
  const calendarId=account?.settings?.defaultCalendarId;if(!calendarId)return question('Choose an owned default Google calendar in connection settings first.');
  let details=m[1],createMeet=false,attendees=[];
  const meet=details.match(/\bwith (?:a )?(?:google )?meet(?: link)?\b/iu);
  if(meet){createMeet=true;details=details.replace(meet[0],' ').replace(/\s+/gu,' ').trim();}
  const guests=details.match(/\b(?:with|invite)\s+(.+?)(?=\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d\d-\d\d|for\s+(?:\d+|thirty|sixty|half))\b|$)/iu);
  if(guests){
   attendees=guests[1].split(/\s*(?:,|\band\b)\s*/iu).map(s=>safeAddress(s.trim()));
   if(!attendees.length||attendees.length>20||attendees.some(s=>!s)||new Set(attendees.map(s=>s.toLowerCase())).size!==attendees.length)return question('Please provide each guest as one exact email address. I do not infer guests from names.');
   details=details.replace(guests[0],' ').replace(/\s+/gu,' ').trim();
  }
  if(!explicitDay(details))return question('What day should I schedule it? Please repeat the meeting title, day, time and duration.');
  const when=extractDate(details,{now,timezone}),mins=duration(details);if(when.ambiguity||!when.value)return question(when.ambiguity??'What date and time, including AM or PM?');if(!mins)return question('How many minutes should the Google meeting last? Please repeat the full request with its duration.');
  const title=temporalTitle(details);if(!title||/\b(?:with|invite)\b/iu.test(details))return question('Please give the meeting title and exact guest addresses separately; I do not infer guests from names.');
  return make('google.calendar.create',{calendarId,title,start:when.value,end:new Date(Date.parse(when.value)+mins*60000).toISOString(),timeZone:timezone,attendees,createMeet});
 }
 if(/^(?:connect|link|disconnect|sync|search|find|show|read|draft|prepare|reply|archive|trash|mark|schedule|create|move|reschedule|cancel|publish|email|send|book)\b/iu.test(clean)&&/\b(?:google|gmail|email|inbox)\b/iu.test(clean))return question('Please specify the Google action and exact target. You can search Gmail, draft an email to an exact address, or schedule a timed meeting on Google Calendar.');
 return null;
}
