const $ = (id) => document.getElementById(id);
const state = { token: '', paired: false, settings: null, conversationId: null, generation: 0, pending: null, busy: false, externalWaiting: false };

class ApiError extends Error {
  constructor(message, status, requestId = null) {
    const correlation = typeof requestId === 'string' && /^[\w-]{1,80}$/.test(requestId) ? requestId : null;
    super(`${message}${correlation ? ` Request ID: ${correlation}.` : ''}`);
    this.status = status;
    this.requestId = correlation;
  }
}

function status(id, message, isError = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error-text', isError);
}

async function api(path, { method = 'GET', body, authenticated = true } = {}) {
  if (authenticated && !state.token) throw new ApiError('Connect this dashboard with your local token first.', 401);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      method,
      headers: { ...(authenticated ? { Authorization: `Bearer ${state.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    let data;
    try { data = await response.json(); } catch { throw new ApiError('The local core returned an unreadable response.', response.status); }
    if (!response.ok) {
      if (response.status === 401 && authenticated && state.paired) {
        disconnect();
        status('pair-status', 'The token is no longer valid. Reconnect with the current token.', true);
      }
      throw new ApiError(data.message || data.error?.message || (typeof data.error === 'string' ? data.error : null) || `Request failed (${response.status}).`, response.status, data.error?.requestId || data.requestId || response.headers?.get('X-Request-ID'));
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('The core did not respond in time. The result may be uncertain; no automatic retry was sent.', 0);
    if (error instanceof ApiError) throw error;
    throw new ApiError('The local core is unavailable. Check that kst is running, then refresh status.', 0);
  } finally { clearTimeout(timeout); }
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function message(text, role = 'assistant') {
  const item = node('div', `message ${role}`);
  item.append(node('span', 'message-avatar', role === 'user' ? 'YOU' : 'kst'), node('div', 'message-content', text));
  $('messages').append(item);
  // Bound rendered discussion state; durable retention belongs to the core.
  while ($('messages').children.length > 80) $('messages').firstElementChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
}

function connection(online) {
  const chip = $('connection-chip');
  chip.classList.toggle('offline', !online);
  chip.replaceChildren(node('span', 'status-dot'), document.createTextNode(online ? (state.paired ? 'Profile connected' : 'Core online · locked') : 'Core offline'));
}

function reportError(error) {
  const panel = $('global-error');
  panel.hidden = false;
  panel.textContent = error.message;
}

function disconnect() {
  state.token = '';
  state.paired = false;
  state.settings = null;
  state.conversationId = null;
  state.pending = null;
  state.generation++;
  $('auth-token').value = '';
  $('pairing').hidden = false;
  $('paired-bar').hidden = true;
  renderApprovals([]);
  renderWork([], [], false);
  renderSecretary(null);
  renderWorkspace(null);
  renderTerminal(null);
  renderExternal(null);
  connection(true);
  $('messages').replaceChildren();
  message('Connect your local profile to start a typed conversation. No microphone or external service is active.');
  status('pair-status', 'Disconnected. The token was cleared from this page.');
}

function renderApprovals(approvals) {
  const list = $('approval-list');
  list.replaceChildren();
  const pending = approvals.filter((item) => item.status === 'pending');
  $('approval-count').textContent = String(pending.length);
  if (!pending.length) { list.append(node('p', 'empty-state', 'No requests waiting for your approval.')); return; }
  for (const approval of pending) {
    const card = node('article', 'approval-card');
    card.append(node('h3', '', `Request to use ${approval.service}`));
    card.append(node('p', '', 'Approving may contact the configured service. Review the exact prompt and context; an unconfigured service stays blocked without fallback.'));
    if(approval.destination)card.append(node('p','',`Destination: ${approval.destination}`));
    if(approval.model)card.append(node('p','',`Configured model: ${approval.model}`));
    card.append(node('div', 'approval-context', approval.prompt || 'No prompt supplied.'));
    if (approval.context?.length) card.append(node('p', '', `Context: ${approval.context.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')}`));
    else card.append(node('p', '', 'Additional context: none.'));
    if (approval.expiresAt) card.append(node('p', '', `Expires: ${new Date(approval.expiresAt).toLocaleString()}`));
    const controls = node('div', 'approval-actions');
    const result = node('p', 'inline-status'); result.setAttribute('role', 'status');
    for (const decision of ['approve', 'deny']) {
      const button = node('button', decision === 'approve' ? 'button secondary' : 'button quiet', decision === 'approve' ? 'Approve this request' : 'Decline');
      button.type = 'button';
      button.addEventListener('click', async () => {
        const generation = state.generation;
        controls.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        try {
          const data = await api(`/api/approvals/${encodeURIComponent(approval.id)}`, { method: 'POST', body: { decision, revision: approval.revision } });
          if (generation !== state.generation) return;
          message(data.message || (decision === 'approve' ? 'Approval recorded. Inspect the job receipt for dispatch status.' : 'Request declined. Nothing was sent.'));
          await refresh();
        } catch (error) {
          if (generation !== state.generation) return;
          result.textContent = `${error.message} Refresh status before deciding again.`;
          result.classList.add('error-text');
          controls.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      });
      controls.append(button);
    }
    card.append(controls, result);
    list.append(card);
  }
}

function renderWork(tasks, jobs, connected = true) {
  for (const [id, entries, empty] of [
    ['task-list', tasks, connected ? 'No tasks yet. Try “add task review API”.' : 'Connect to see saved tasks.'],
    ['job-list', jobs, connected ? 'No job receipts yet.' : 'Connect to see job receipts.'],
  ]) {
    const list = $(id); list.replaceChildren();
    if (!entries.length) { list.append(node('p', 'empty-state', empty)); continue; }
    for (const entry of entries.slice(-12).reverse()) {
      const row = node('article', 'work-item');
      row.append(node('strong', '', entry.title || entry.kind || entry.action || entry.id));
      row.append(node('span', 'pill', entry.status || 'saved'));
      const evidence = entry.message || entry.error?.message || entry.result?.message || entry.summary;
      if (evidence) row.append(node('p', '', typeof evidence === 'string' ? evidence : JSON.stringify(evidence)));
      list.append(row);
    }
  }
}

function readableDate(value) {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Time unavailable';
}

function renderSecretary(snapshot) {
  const fresh = snapshot?.status === 'fresh';
  $('secretary-badge').textContent = fresh ? 'Read only · fresh' : snapshot?.status === 'stale' ? 'Read only · stale' : snapshot?.status === 'disabled' ? 'Disabled' : snapshot ? 'Unavailable' : 'Not connected';
  $('secretary-badge').classList.toggle('muted-pill', !fresh);
  let description = 'Connect your local profile to check the shared-data connection.';
  if (fresh) description = `${snapshot.source?.label || 'Personal Secretary'}${snapshot.source?.fileName ? ` · ${snapshot.source.fileName}` : ''}. Read-only snapshot; source records cannot be edited here.`;
  if (snapshot?.status === 'disabled') description = 'Shared data is disabled. Configure KST_SECRETARY_DB in the local core with the exact approved Personal Secretary database, then restart the core. This page does not scan folders or accept database paths.';
  if (snapshot?.status === 'stale') description = 'The source could not be refreshed. A cached snapshot exists, but its records are hidden here so they are not mistaken for current work. Refresh status after checking the source.';
  if (snapshot?.status === 'unavailable') description = snapshot.error?.message || 'The configured source is unavailable. Check the source connection in the local core, then refresh status.';
  $('secretary-status').textContent = description;
  $('secretary-status').classList.toggle('error-text', !!snapshot && !fresh && snapshot.status !== 'disabled');
  const lastSuccess = snapshot?.lastSuccessAt || (fresh ? snapshot?.observedAt : null);
  $('secretary-freshness').textContent = lastSuccess ? `Last successful snapshot: ${readableDate(lastSuccess)}${fresh ? ' · Updates on manual status refresh.' : ' · Not current.'}` : '';
  for (const [id, entries, kind] of [
    ['secretary-tasks', snapshot?.data?.tasks || [], 'tasks'],
    ['secretary-calendar', snapshot?.data?.calendar || [], 'events'],
    ['secretary-reminders', snapshot?.data?.reminders || [], 'reminders'],
  ]) {
    const list = $(id); list.replaceChildren();
    if (!fresh || !entries.length) {
      list.append(node('p', 'empty-state', !fresh ? 'Current source data unavailable.' : `No ${kind} in this bounded snapshot.`));
      continue;
    }
    for (const entry of entries.slice(0, 8)) {
      const row = node('article', 'source-item');
      row.append(node('strong', '', entry.title || 'Untitled'));
      if (kind === 'events') row.append(node('p', '', `${entry.allDay ? 'All day · ' : ''}${readableDate(entry.startAt)}${entry.endAt ? ` → ${readableDate(entry.endAt)}` : ''}`));
      if (kind === 'reminders') row.append(node('p', '', `${entry.snoozeUntil ? 'Snoozed until' : 'Due'} ${readableDate(entry.snoozeUntil || entry.fireAt)}`));
      if (kind === 'tasks' && entry.dueAt) row.append(node('p', '', `Due ${readableDate(entry.dueAt)}`));
      if (entry.status) row.append(node('span', 'pill', entry.status));
      list.append(row);
    }
    if (entries.length > 8) list.append(node('p', 'source-freshness', `${entries.length - 8} more in this snapshot.`));
  }
  const notes = fresh ? snapshot.data?.notes?.length || 0 : 0;
  $('secretary-notes').textContent = fresh ? `${notes} note${notes === 1 ? '' : 's'} available as read-only context.${snapshot.limits?.truncated?.length ? ' Some source collections were truncated by the configured privacy limit.' : ''}` : '';
}

async function refreshSecretary(token, generation) {
  try {
    const snapshot = await api('/api/secretary');
    if (state.token !== token || state.generation !== generation) return;
    renderSecretary(snapshot);
  } catch (error) {
    if (state.token !== token || state.generation !== generation) return;
    renderSecretary({ status: 'unavailable', error: { message: error.message } });
  }
}

function renderWorkspace(data) {
  $('workspace-mode').textContent = data?.mode === 'source-write' ? 'Personal Secretary · shared' : data ? 'Local secretary workspace' : 'Connect to load';
  $('workspace-status').textContent = data ? `Saved in ${data.source?.label || 'the local secretary workspace'}. Use voice or chat to create, update, schedule, and snooze.` : 'Connect your profile to load the secretary workspace.';
  for (const [id, rows] of [['workspace-calendar', data?.calendar], ['workspace-reminders', data?.reminders], ['workspace-timeline', data?.timeline]]) {
    const list = $(id); list.replaceChildren();
    if (!rows?.length) { list.append(node('p','empty-state','No entries.')); continue; }
    for (const row of rows.slice(0,20)) {
      const item=node('article','source-item');
      item.append(node('strong','',row.title || row.kind || 'Untitled'));
      const at=row.startAt || row.fireAt;
      if(at)item.append(node('p','',readableDate(at)));
      if(row.status)item.append(node('span','pill',row.status));
      list.append(item);
    }
  }
  const plan=data?.plan || data?.plans?.find(item=>item.status==='proposed') || data?.plans?.[0];
  $('workspace-plan').textContent=plan ? `${plan.status || 'proposal'}\n${(plan.blocks || []).map(block=>`${readableDate(block.startAt)} · ${block.title}`).join('\n')}\nAsk “confirm plan” to apply a pending proposal.` : 'Ask “plan my day” to build a proposal around your meetings and tasks.';
  const notifications=$('workspace-notifications');notifications.replaceChildren();
  for(const item of (data?.notifications || []).slice(-20).reverse())notifications.append(node('p','source-item',`${item.title}: ${item.message || ''}`));
}

function renderTerminal(data) {
  const recipes=$('terminal-recipes'),jobs=$('terminal-jobs');recipes.replaceChildren();jobs.replaceChildren();
  for(const job of (data?.jobs || []).slice(-12).reverse()) {
    const row=node('article','source-item');
    row.append(node('strong','',`${job.recipeId || job.kind || job.id}: ${job.status}`));
    if(job.message)row.append(node('p','',job.message));
    if(job.stdout || job.stderr)row.append(node('pre','terminal-output',`${job.stdout || ''}${job.stderr || ''}`.slice(-8000)));
    const show=node('button','button quiet','Show in a new iTerm window');show.type='button';
    show.addEventListener('click',async()=>{
      const generation=state.generation;show.disabled=true;
      try {
        const result=await api(`/api/terminal/jobs/${encodeURIComponent(job.id)}/show`,{method:'POST',body:{requestId:crypto.randomUUID()}});
        if(generation!==state.generation)return;
        $('terminal-status').textContent=result.message || `iTerm display: ${result.status}.`;
      } catch(error) { if(generation===state.generation)$('terminal-status').textContent=`${error.message} Check iTerm before trying again; no automatic retry was sent.`; }
    });row.append(show);
    if(['prepared','running','cancelling'].includes(job.status)) {
      const button=node('button','button quiet danger','Cancel owned job');button.type='button';
      button.addEventListener('click',async()=>{
        const generation=state.generation;button.disabled=true;
        try {
          const result=await api(`/api/terminal/jobs/${encodeURIComponent(job.id)}/cancel`,{method:'POST',body:{requestId:crypto.randomUUID()}});
          if(generation!==state.generation)return;
          $('terminal-status').textContent=`Cancellation result: ${result.status || result.job?.status || 'received'}. Refresh to inspect the receipt.`;
          await refresh();
        } catch(error) { if(generation===state.generation)$('terminal-status').textContent=error.message; }
        finally { button.disabled=false; }
      });row.append(button);
    }
    jobs.append(row);
  }
  if(!data)$('terminal-status').textContent='Connect your profile to inspect configured recipes and owned jobs.';
  else $('terminal-status').textContent='Only explicitly configured recipes can execute. Unknown work stays quarantined; no automatic command retry.';
  // Recipe details are displayed before execution; creating a terminal job remains a deliberate command.
  for(const project of data?.projects || []) {
    for(const recipe of project.recipes || []) {
      const card=node('article','source-item');
      card.append(node('strong','',`${project.id} · ${recipe.label || recipe.id}`));
      card.append(node('p','',`${recipe.executable} ${(recipe.args || []).join(' ')}`));
      const button=node('button','button secondary',`Prepare ${recipe.id}`);button.type='button';
      button.addEventListener('click',()=>{
        $('chat-input').value=`run recipe ${recipe.id} in ${project.id}`;$('chat-input').focus();
      });card.append(button);recipes.append(card);
    }
  }
  if(!data)$('terminal-sessions').textContent='';
}

function renderExternal(data){
  const list=$('external-results');list.replaceChildren();
  state.externalWaiting=Boolean(data?.jobs?.some(job=>['prepared','running'].includes(job.status)));
  $('external-services').textContent=data ? (data.services || []).map(service=>`${service.service}: ${service.configured?'configured':'setup required'}${service.model?` (${service.model})`:''}`).join(' · ') : 'Connect to inspect service readiness.';
  for(const job of (data?.jobs || []).slice(0,12)){
    const item=node('article','source-item');item.append(node('strong','',`${job.service} · ${job.status}`));
    item.append(node('p','',job.message || ''));
    if(job.text)item.append(node('pre','provider-result',job.text));
    list.append(item);
  }
}

async function refreshExternal(token,generation){
  try{
    const data=await api('/api/external/status');
    if(state.token!==token||state.generation!==generation)return;
    renderExternal(data);
  }catch(error){
    if(state.token!==token||state.generation!==generation)return;
    renderExternal(null);$('external-services').textContent=error.message;
  }
}

async function refreshWorkspace(token,generation) {
  for(const [path,render,id] of [['/api/secretary/workspace',renderWorkspace,'workspace-status'],['/api/terminal/status',renderTerminal,'terminal-status']]) {
    try {
      const data=await api(path);
      if(state.token!==token || state.generation!==generation)return;
      render(data);
    } catch(error) {
      if(state.token!==token || state.generation!==generation)return;
      render(null);
      $(id).textContent=error.message;
    }
  }
}

async function refresh() {
  const token = state.token;
  const generation = state.generation;
  await api('/health', { authenticated: false });
  connection(true);
  if (!token || state.token !== token || state.generation !== generation) return;
  const data = await api('/api/status');
  if (state.token !== token || state.generation !== generation) return;
  state.settings = data.settings;
  if (document.activeElement !== $('wake-phrase')) $('wake-phrase').value = data.settings?.wakePhrase || 'arise';
  renderApprovals(data.approvals || []);
  renderWork(data.tasks || [], data.jobs || []);
  $('global-error').hidden = true;
  await refreshSecretary(token, generation);
  if(state.token===token && state.generation===generation)await refreshWorkspace(token,generation);
  if(state.token===token && state.generation===generation)await refreshExternal(token,generation);
}

$('pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const generation = state.generation;
  state.token = $('auth-token').value.trim();
  const token = state.token;
  try {
    await refresh();
    if (generation !== state.generation || token !== state.token) return;
    state.paired = true;
    connection(true);
    $('auth-token').value = '';
    $('pairing').hidden = true;
    $('paired-bar').hidden = false;
    status('pair-status', '');
  } catch (error) {
    if (generation !== state.generation || token !== state.token) return;
    state.token = '';
    $('auth-token').value = '';
    status('pair-status', error.message, true);
  }
});
$('disconnect-button').addEventListener('click', disconnect);
$('terminal-inventory').addEventListener('click',async()=>{
  const generation=state.generation;
  try {
    const data=await api('/api/terminal/inventory',{method:'POST',body:{}});
    if(generation!==state.generation)return;
    $('terminal-sessions').textContent=JSON.stringify(data,null,2);
  } catch(error) { if(generation===state.generation)$('terminal-sessions').textContent=error.message; }
});
$('refresh-button').addEventListener('click', async () => {
  try { await refresh(); } catch (error) { connection(error.status !== 0); reportError(error); }
});

$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const text = $('chat-input').value.trim();
  if (!text) return;
  if (!state.token) { status('chat-status', 'Connect your local profile above first.', true); $('auth-token').focus(); return; }
  const generation = state.generation;
  // A manual retry of the same uncertain utterance reuses the request ID.
  const request = state.pending?.text === text ? state.pending : { requestId: crypto.randomUUID(), text, ...(state.conversationId ? { conversationId: state.conversationId } : {}) };
  if (state.pending !== request) message(text, 'user');
  state.pending = request;
  state.busy = true;
  $('send-button').disabled = true;
  status('chat-status', 'Working locally…');
  try {
    const data = await api('/api/conversation', { method: 'POST', body: request });
    if (generation !== state.generation) return;
    state.conversationId = data.conversationId;
    state.pending = null;
    $('chat-input').value = '';
    message(data.reply || 'The request finished without a reply. Refresh status for details.');
    status('chat-status', '');
    try { await refresh(); } catch { status('chat-status', 'Reply received. Status refresh failed; refresh manually.'); }
  } catch (error) {
    if (generation !== state.generation) return;
    status('chat-status', `${error.message} Your text is retained. Sending the same text retries its existing request ID.`, true);
  } finally { state.busy = false; $('send-button').disabled = false; }
});
$('chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('chat-form').requestSubmit(); }
});
$('stop-button').addEventListener('click', async () => {
  state.generation++;
  const generation = state.generation;
  state.pending = null;
  state.conversationId = null;
  status('chat-status', 'Stopping this discussion…');
  try {
    const data = await api('/api/stop', { method: 'POST', body: { requestId: crypto.randomUUID() } });
    if (generation !== state.generation) return;
    message(data.reply || 'Discussion stopped.');
    status('chat-status', 'Stopped. No new command was sent.');
  } catch (error) { if (generation === state.generation) status('chat-status', `Local replies stopped. ${error.message}`, true); }
});

$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.settings) { status('settings-status', 'Connect and refresh status before saving.', true); return; }
  $('save-settings').disabled = true;
  const generation = state.generation;
  try {
    const data = await api('/api/settings', { method: 'PATCH', body: { expectedRevision: state.settings.revision, wakePhrase: $('wake-phrase').value.trim() } });
    if (generation !== state.generation) return;
    state.settings = data.settings || data;
    status('settings-status', 'Preference saved. The Mac app reads the shared phrase; arm listening there to use it.');
  } catch (error) { if (generation === state.generation) status('settings-status', `${error.message} Refresh status before trying again.`, true); }
  finally { $('save-settings').disabled = false; }
});

$('active-minutes').addEventListener('input', () => { $('minutes-value').textContent = `${$('active-minutes').value} min`; });
$('nudge-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('nudge-button').disabled = true;
  const generation = state.generation;
  try {
    const data = await api('/api/nudges/evaluate', { method: 'POST', body: { now: new Date().toISOString(), activity: { activeMinutes: Number($('active-minutes').value), locked: $('sample-locked').checked, inMeeting: $('sample-meeting').checked, quietHours: false } } });
    if (generation !== state.generation) return;
    $('nudge-result').textContent = data.nudges?.length ? data.nudges.map((item) => `${item.message}${item.evidence ? `\nWhy: ${typeof item.evidence === 'string' ? item.evidence : JSON.stringify(item.evidence)}` : ''}`).join('\n\n') : 'No nudge right now. The threshold, interruption rules, or cooldown kept things quiet.';
  } catch (error) { if (generation === state.generation) $('nudge-result').textContent = error.message; }
  finally { $('nudge-button').disabled = false; }
});

for (const link of document.querySelectorAll('.nav-link')) link.addEventListener('click', () => {
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
  link.classList.add('active');
});
document.querySelector('.nav-link').classList.add('active');
for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{
  $('chat-input').value=button.dataset.command;
  $('chat-input').focus();
});
message('Hi, I’m kst. Connect your profile for meetings, calendar, reminders, planner, and timeline. Type “help” for supported commands, or arm “arise” in the Mac app to speak. External help always requires your approval.');
refresh().catch(() => connection(false));
// Only local read requests are polled. Commands and provider dispatch never auto-retry.
setInterval(() => {
  api('/health', { authenticated: false }).then(() => connection(true)).catch(() => connection(false));
  if(state.paired && state.externalWaiting)refreshExternal(state.token,state.generation);
}, 15000);
