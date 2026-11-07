import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.hidden = false;
    this.classes = new Set();
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) };
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((item) => item.textContent).join(''); }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items) { this.text = ''; this.children = []; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  get firstElementChild() { return this.children[0]; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute() {}
  focus() {}
  querySelectorAll(tag) { return this.children.flatMap((item) => [...(item.tag === tag ? [item] : []), ...item.querySelectorAll(tag)]); }
}

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(route = () => response({})) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const navigation = [new Element('a'), new Element('a')];
  const requests = [];
  const sandbox = {
    document: {
      getElementById: (id) => { assert.ok(elements.has(id), `Missing DOM element ${id}`); return elements.get(id); },
      createElement: (tag) => new Element(tag),
      createTextNode: (text) => { const item = new Element(); item.textContent = text; return item; },
      querySelectorAll: () => navigation,
      querySelector: () => navigation[0],
      activeElement: null,
    },
    fetch: async (path, options) => { requests.push({ path, options }); return path === '/health' ? response({ status: 'ok' }) : route(path, options); },
    crypto: { randomUUID }, AbortController, setTimeout, clearTimeout, setInterval: () => 0, console,
  };
  vm.runInNewContext(`${source}\nglobalThis.testing = { state, refresh, disconnect, renderSecretary, renderApprovals, renderWorkspace, renderTerminal, renderExternal, refreshExternal, api };`, sandbox);
  return { ...sandbox.testing, elements, requests };
}

test('every literal DOM reference resolves to a unique document element', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), match[1]);
});

test('provider responses remain plain text and disconnect clears results and waiting state',()=>{
  const ui=setup();ui.renderExternal({services:[],jobs:[{service:'chatgpt',status:'running'},{service:'claude',status:'partial',text:'<script>private provider text</script>'}]});
  assert.equal(ui.state.externalWaiting,true);assert.match(ui.elements.get('external-results').textContent,/<script>private provider text<\/script>/);
  assert.equal(ui.elements.get('external-results').querySelectorAll('script').length,0);
  ui.disconnect();assert.equal(ui.state.externalWaiting,false);assert.equal(ui.elements.get('external-results').textContent,'');
});

test('late provider receipt cannot restore private results after disconnect',async()=>{
  const waiting=deferred();const ui=setup(()=>waiting.promise);ui.state.token='private-token';ui.state.paired=true;
  const refresh=ui.refreshExternal(ui.state.token,ui.state.generation);ui.disconnect();
  waiting.resolve(response({services:[],jobs:[{service:'chatgpt',status:'succeeded',text:'Late private result'}]}));await refresh;
  assert.doesNotMatch(ui.elements.get('external-results').textContent,/Late private result/);assert.equal(ui.state.externalWaiting,false);
});

test('stale source records are not displayed as current tasks/calendar/reminders', () => {
  const ui = setup();
  ui.renderSecretary({ status: 'fresh', source: { label: 'Personal Secretary', fileName: 'flowstate.db', readOnly: true }, observedAt: '2026-11-06T12:00:00Z', data: { tasks: [{ title: 'Private task', status: 'pending' }], calendar: [], reminders: [], notes: [] } });
  assert.match(ui.elements.get('secretary-tasks').textContent, /Private task/);
  ui.renderSecretary({ status: 'stale', lastSuccessAt: '2026-11-06T12:00:00Z', data: { tasks: [{ title: 'Private task' }] } });
  assert.doesNotMatch(ui.elements.get('secretary-tasks').textContent, /Private task/);
  assert.match(ui.elements.get('secretary-status').textContent, /cached snapshot/);
  assert.match(ui.elements.get('secretary-freshness').textContent, /Not current/);
});

test('late source snapshot cannot repopulate private data after disconnect', async () => {
  const waiting = deferred();
  const ui = setup((path) => path === '/api/status' ? response({ settings: { revision: 1, wakePhrase: 'jarvis' }, tasks: [], jobs: [], approvals: [] }) : waiting.promise);
  await flush();
  ui.state.token = 'test-token'; ui.state.paired = true;
  const refresh = ui.refresh();
  await flush();
  assert.ok(ui.requests.some((item) => item.path === '/api/secretary'));
  ui.disconnect();
  waiting.resolve(response({ status: 'fresh', data: { tasks: [{ title: 'Late private task' }] } }));
  await refresh;
  assert.doesNotMatch(ui.elements.get('secretary-tasks').textContent, /Late private task/);
  assert.equal(ui.elements.get('secretary-badge').textContent, 'Not connected');
});

test('late approval response cannot append a message after disconnect', async () => {
  const waiting = deferred();
  const ui = setup(() => waiting.promise);
  ui.state.token = 'test-token'; ui.state.paired = true;
  ui.renderApprovals([{ id: 'approval-1', service: 'codex', prompt: 'Inspect tests', context: [], revision: 1, status: 'pending' }]);
  const approve = ui.elements.get('approval-list').querySelectorAll('button')[0];
  const pending = approve.listeners.click();
  ui.disconnect();
  waiting.resolve(response({ message: 'STALE APPROVAL RESULT', dispatched: false }));
  await pending;
  assert.doesNotMatch(ui.elements.get('messages').textContent, /STALE APPROVAL RESULT/);
  assert.equal(ui.state.token, '');
});

test('API failure displays a safe request correlation ID without retrying the action', async () => {
  const ui = setup(() => response({ error: { message: 'Storage unavailable.', requestId: 'failure-123' } }, 503));
  ui.state.token = 'test-token';
  await assert.rejects(ui.api('/api/conversation', { method: 'POST', body: { text: 'add task example' } }), /Request ID: failure-123/);
  assert.equal(ui.requests.filter((item) => item.path === '/api/conversation').length, 1);
  assert.ok(ui.requests.every((item) => item.path.startsWith('/')));
});

test('canonical workspace shows calendar and plan, then clears private content on disconnect',()=>{
  const ui=setup();
  ui.renderWorkspace({mode:'source-write',source:{label:'Personal Secretary'},calendar:[{title:'Private review',startAt:'2026-11-07T15:00:00Z'}],reminders:[],timeline:[],plans:[{status:'proposed',blocks:[{title:'Focus on tests',startAt:'2026-11-07T16:00:00Z'}]}]});
  assert.match(ui.elements.get('workspace-calendar').textContent,/Private review/);
  assert.match(ui.elements.get('workspace-plan').textContent,/Focus on tests/);
  ui.disconnect();
  assert.doesNotMatch(ui.elements.get('workspace-calendar').textContent,/Private review/);
  assert.doesNotMatch(ui.elements.get('workspace-plan').textContent,/Focus on tests/);
});

test('late workspace snapshot cannot repaint the calendar after disconnect',async()=>{
  const waiting=deferred();
  const ui=setup(path=>path==='/api/status'?response({settings:{revision:1,wakePhrase:'arise'}}):path==='/api/secretary'?response({status:'disabled'}):waiting.promise);
  await flush();ui.state.token='private-token';ui.state.paired=true;
  const refresh=ui.refresh();await flush();
  assert.ok(ui.requests.some(item=>item.path==='/api/secretary/workspace'));
  ui.disconnect();waiting.resolve(response({calendar:[{title:'Late private appointment'}]}));await refresh;
  assert.doesNotMatch(ui.elements.get('workspace-calendar').textContent,/Late private/);
});

test('job cancellation targets its receipt once and ignores a late response after disconnect',async()=>{
  const waiting=deferred(),ui=setup(()=>waiting.promise);
  ui.state.token='private-token';ui.state.paired=true;
  ui.renderTerminal({projects:[],jobs:[{id:'job-123',status:'running',recipeId:'test',message:'Owned job'}]});
  const button=ui.elements.get('terminal-jobs').querySelectorAll('button').find(item=>item.textContent==='Cancel owned job');
  const action=button.listeners.click();ui.disconnect();waiting.resolve(response({status:'cancelled'}));await action;
  assert.equal(ui.requests.filter(item=>item.path==='/api/terminal/jobs/job-123/cancel').length,1);
  assert.doesNotMatch(ui.elements.get('terminal-status').textContent,/Cancellation result/);
});

test('uncertain iTerm display is not automatically repeated',async()=>{
  const ui=setup(()=>response({error:{message:'Automation outcome unknown.'}},503));ui.state.token='private-token';
  ui.renderTerminal({projects:[],jobs:[{id:'job-123',status:'succeeded',recipeId:'test'}]});
  const button=ui.elements.get('terminal-jobs').querySelectorAll('button')[0];await button.listeners.click();
  assert.equal(ui.requests.filter(item=>item.path==='/api/terminal/jobs/job-123/show').length,1);
  assert.match(ui.elements.get('terminal-status').textContent,/Check iTerm/);assert.equal(button.disabled,true);
});
