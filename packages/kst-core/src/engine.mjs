import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
export class Fault extends Error {
    code;
    status;
    constructor(code, message, status = 400){
        super(message), this.code = code, this.status = status;
    }
}
const initial = ()=>({
        schemaVersion: 1,
        generation: 1,
        settings: {
            revision: 1,
            wakePhrase: 'arise',
            voice: 'system-default',
            localReasoning: true,
            externalApproval: 'every-request'
        },
        jobs: [],
        approvals: [],
        nudges: [],
        tasks: [],
        notes: [],
        requests: {}
    });
const digest = (v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const capabilities = [
    {
        id: 'conversation',
        label: 'Full-duplex conversation & Apple intelligence',
        status: 'ready',
        detail: 'Tier 1 on-device Apple Foundation Models + deterministic workspace actions.'
    },
    {
        id: 'voice',
        label: 'Apple native full-duplex voice & barge-in',
        status: 'native-only',
        detail: 'Echo-cancelled AVAudioEngine + AVAudioPlayerNode with sample-accurate barge-in.'
    },
    {
        id: 'wake',
        label: 'Wake detection',
        status: 'native-only',
        detail: 'Arm the Mac app for the configured phrase (default arise) using on-device Apple SpeechAnalyzer / SFSpeechRecognizer.'
    },
    {
        id: 'stt',
        label: 'Voice input',
        status: 'native-only',
        detail: 'On-device SpeechAnalyzer / SFSpeechRecognizer with full-duplex continuous listening.'
    },
    {
        id: 'apple-suite',
        label: 'Apple-Native Executive Suite',
        status: 'ready',
        detail: 'Native EventKit Calendar & Reminders, Contacts, Mail, Messages, Notes, Safari, Spotlight/Finder, Music, and Shortcuts.'
    },
    {
        id: 'terminal',
        label: 'iTerm / command execution',
        status: 'unavailable',
        detail: 'Disabled until native broker and supervised execution are verified.'
    },
    {
        id: 'external',
        label: 'Claude / Gemini / ChatGPT / Codex / web',
        status: 'approval-preview',
        detail: 'Every request requires approval. Provider dispatch is gated.'
    },
    {
        id: 'nudges',
        label: 'Proactive nudges',
        status: 'fixture-preview',
        detail: 'Native activity and Apple Calendar EventKit feed the local nudge rules.'
    },
    {
        id: 'sync',
        label: 'Personal Secretary data',
        status: 'configurable-read-only',
        detail: 'Optional approved read-only source via /api/secretary.'
    }
];
export class Engine {
    clock;
    db;
    constructor(file, clock = Date.now){
        this.clock = clock;
        this.db = new DatabaseSync(file);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS kst_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);');
        this.db.prepare('INSERT OR IGNORE INTO kst_state(id,data) VALUES(1,?)').run(JSON.stringify(initial()));
        try { this.read(); this.mutate(state=>{if(state.settings.wakePhrase==='jarvis'&&state.settings.revision===1){state.settings.wakePhrase='arise';state.settings.revision++;}}); } catch(error) { this.db.close(); throw error; }
    }
    close() {
        this.db.close();
    }
    read() {
        const row = this.db.prepare('SELECT data FROM kst_state WHERE id=1').get();
        const state = JSON.parse(row.data);
        if (state.schemaVersion !== 1 || !state.settings || !Array.isArray(state.jobs) || !Array.isArray(state.approvals) || !state.requests) throw new Fault('STATE_INVALID', 'Unsupported or corrupt state. Restore a checked backup before retrying.', 503);
        return state;
    }
    mutate(operation) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const state = this.read();
            const result = operation(state);
            state.jobs = state.jobs.slice(-500);
            state.nudges = state.nudges.slice(-100);
            state.approvals = state.approvals.filter((a)=>a.status === 'pending').concat(state.approvals.filter((a)=>a.status !== 'pending').slice(-200));
            this.db.prepare('UPDATE kst_state SET data=? WHERE id=1').run(JSON.stringify(state));
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    recover() {
        this.mutate((state)=>{
            for (const job of state.jobs)if (job.status === 'running' || job.status === 'prepared') {
                job.status = 'unknown';
                job.message = 'Interrupted by restart. Quarantined; no automatic replay.';
            }
            for (const approval of state.approvals)if (approval.status === 'pending') {
                approval.status = 'expired';
                approval.revision++;
            }
            state.generation++;
        });
    }
    status() {
        const state = this.read();
        return {
            app: 'kst',
            mode: 'scratch',
            generation: state.generation,
            settings: state.settings,
            capabilities,
            jobs: state.jobs,
            approvals: state.approvals,
            nudges: state.nudges,
            tasks: state.tasks,
            notes: state.notes
        };
    }
    settings(expectedRevision, wakePhrase) {
        const normalized = wakePhrase.normalize('NFKC').trim().replace(/\s+/g, ' ');
        if (normalized.length < 2 || normalized.length > 40 || /[\p{C}]/u.test(normalized)) throw new Fault('INVALID_PHRASE', 'Wake phrase must contain 2–40 visible characters.');
        return this.mutate((state)=>{
            if (state.settings.revision !== expectedRevision) throw new Fault('STALE_REVISION', 'Settings changed. Refresh before saving.', 409);
            state.settings = {
                ...state.settings,
                wakePhrase: normalized,
                revision: expectedRevision + 1
            };
            return state.settings;
        });
    }
    once(state, requestId, payload, operation) {
        const hash = digest(payload), prior = Object.hasOwn(state.requests, requestId) ? state.requests[requestId] : undefined;
        if (prior) {
            if (prior.hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT', 'Request ID already belongs to a different command.', 409);
            return prior.result;
        }
        if (Object.keys(state.requests).length >= 5000) throw new Fault('REQUEST_CAPACITY', 'Scratch request history is full. Export/reset this development profile.', 503);
        const result = operation();
        Object.defineProperty(state.requests, requestId, {enumerable: true, configurable: true, writable: true, value: {
            hash,
            result
        }});
        return result;
    }
    lookupRequest(requestId){const prior=this.read().requests[requestId];return prior?.result??null;}
    proposeExternal(requestId,{service,prompt,conversationId},details){
        if(!['chatgpt','claude','gemini','codex','antigravity'].includes(service)||typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw new Fault('INVALID_EXTERNAL','Supply an explicit supported service and prompt.');
        return this.mutate(state=>this.once(state,requestId,{service,prompt,conversationId},()=>{
            if(state.approvals.filter(a=>a.status==='pending').length>=20)throw new Fault('APPROVAL_CAPACITY','Resolve an existing request first.',409);
            const approval={id:randomUUID(),service,prompt,context:details?.context??[],conversationId,scopeHash:details?.scopeHash??null,destination:details?.destination??null,transport:details?.transport??null,model:details?.model??null,configured:details?.configured??false,revision:1,status:'pending',createdAt:new Date(this.clock()).toISOString(),expiresAt:new Date(this.clock()+300000).toISOString()};
            state.approvals.push(approval);return {conversationId,approval,reply:`May I use ${service} for: “${prompt}”? ${approval.context.join(' ')} Say “approve external request” or “decline external request”.`};
        }));
    }
    conversation(requestId, text, conversationId, sourceSnapshot, externalDetails) {
        return this.mutate((state)=>this.once(state, requestId, {
                text,
                conversationId: conversationId ?? null
            }, ()=>{
                const id = conversationId ?? randomUUID(), command = text.trim(), now = new Date(this.clock()).toISOString();
                const response = {
                    reply: '',
                    conversationId: id
                };
                const sourceRead = command.match(/^(?:show|list) (?:personal )?secretary (tasks|notes|reminders|calendar)[.!?]?$/i);
                if (sourceRead) {
                    if (sourceSnapshot?.status !== 'fresh') {
                        response.reply = 'Current Personal Secretary data is unavailable. Configure its read-only connection and refresh; I will not use stale records as current work.';
                        return response;
                    }
                    const collection = sourceRead[1].toLowerCase();
                    const records = sourceSnapshot.data[collection] ?? [];
                    const selected = records.slice(0, 10);
                    response.reply = selected.length
                        ? `Personal Secretary ${collection} (read only, observed ${sourceSnapshot.observedAt}): ${selected.map(row => row.title || '(untitled)').join('; ')}${records.length > selected.length ? '. More records are available in the dashboard.' : ''}`
                        : `No ${collection} in the current bounded Personal Secretary snapshot.`;
                    return response;
                }
                const external = command.match(/^(?:ask|use|search|browse)(?:\s+the)?\s+(chatgpt|codex|claude|gemini|antigravity|web)\b[:\s]*(.*)$/i);
                if (external) {
                    if (!external[2].trim()) {
                        response.reply = 'What would you like to send to that service?';
                        return response;
                    }
                    if (state.approvals.filter((a)=>a.status === 'pending').length >= 20) throw new Fault('APPROVAL_CAPACITY', 'Resolve an existing request before creating another.', 409);
                    const approval = {
                        id: randomUUID(),
                        service: external[1].toLowerCase(),
                        prompt: external[2].trim(),
                        context: externalDetails?.context ?? [],
                        conversationId: id,
                        scopeHash: externalDetails?.scopeHash ?? null,
                        destination: externalDetails?.destination ?? null,
                        transport: externalDetails?.transport ?? null,
                        model: externalDetails?.model ?? null,
                        configured: externalDetails?.configured ?? false,
                        revision: 1,
                        status: 'pending',
                        createdAt: now,
                        expiresAt: new Date(this.clock() + 300000).toISOString()
                    };
                    state.approvals.push(approval);
                    response.approval = approval;
                    response.reply = externalDetails ? `May I use ${approval.service} for: “${approval.prompt}”? ${approval.context.join(' ')}${approval.model?` Model: ${approval.model}.`:''}${approval.configured?'':' This service still needs setup; nothing will be sent while unconfigured.'} Say “approve external request” or “decline external request”, or review it in the dashboard.` : `May I send this request to ${approval.service}: “${approval.prompt}”? No files or conversation history will be shared. This build previews approval only; the provider is not connected.`;
                } else if (/^(?:run|execute|launch command|delete|sudo)\b/i.test(command)) {
                    const job = {
                        id: randomUUID(),
                        kind: 'terminal',
                        status: 'blocked',
                        createdAt: now,
                        evidence: [],
                        message: 'Terminal execution is disabled until the native broker, target ownership, and locks are implemented.'
                    };
                    state.jobs.push(job);
                    response.job = job;
                    response.reply = job.message;
                } else if (/^add task\s+/i.test(command)) {
                    const title = command.replace(/^add task\s+/i, '').trim();
                    if (state.tasks.length >= 500) throw new Fault('TASK_CAPACITY', 'Scratch task limit reached.', 409);
                    const task = {
                        id: randomUUID(),
                        title
                    };
                    state.tasks.push(task);
                    response.reply = `Saved scratch task: ${title}`;
                } else if (/^note\s+/i.test(command)) {
                    if (state.notes.length >= 500) throw new Fault('NOTE_CAPACITY', 'Scratch note limit reached.', 409);
                    const note = {
                        id: randomUUID(),
                        text: command.replace(/^note\s+/i, '').trim()
                    };
                    state.notes.push(note);
                    response.reply = `Saved scratch note: ${note.text}`;
                } else if (/^(?:list|show)(?: my)? tasks[.!?]?$/i.test(command)) response.reply = state.tasks.length ? state.tasks.map((t)=>t.title).join('; ') : 'No tasks in this scratch profile.';
                else if (/^(?:list|show)(?: my)? notes[.!?]?$/i.test(command)) response.reply = state.notes.length ? state.notes.map((n)=>n.text).join('; ') : 'No notes in this scratch profile.';
                else if (/^(?:stop|we.?re done|end conversation|stop listening)[.!?]?$/i.test(command)) {
                    state.generation++;
                    response.reply = 'Conversation ended. Uncommitted requests are cancelled.';
                    for (const a of state.approvals)if (a.status === 'pending' && (/^stop[.!?]?$/i.test(command) || a.conversationId === id)) {
                        a.status = 'denied';
                        a.revision++;
                    }
                } else if (/^(?:status|help|hello|hi|what can you do)[.!?]?$/i.test(command)) response.reply = 'I’m kst, running locally in a scratch profile. Try “add task review API”, “show tasks”, “note review tomorrow”, “show secretary tasks”, or “ask codex explain the tests”. “Search web QUERY” opens Google Search in visible Chrome Incognito without approval. ChatGPT, Claude, Gemini and Codex requests require your approval.';
                else response.reply = 'I need a clearer local command. Try “add task …”, “show tasks”, “note …”, or ask to use ChatGPT, Codex, Claude, Gemini, or the web. I won’t guess a command or contact a service automatically.';
                return response;
            }));
    }
    externalDecisionTarget(requestId, text, conversationId) {
        return this.mutate(state=>this.once(state,requestId,{text,conversationId:conversationId??null},()=>{
            const pending=state.approvals.filter(a=>a.status==='pending'&&a.conversationId===conversationId);
            return pending.length===1?{id:pending[0].id,revision:pending[0].revision}:{reply:pending.length?'More than one external request is pending. Review the exact request in the dashboard.':'No external request is pending in this discussion.'};
        }));
    }
    approval(id, decision, revision, {dispatch = false} = {}) {
        return this.mutate((state)=>{
            const item = state.approvals.find((a)=>a.id === id);
            if (!item) throw new Fault('NOT_FOUND', 'Approval not found.', 404);
            if (item.status !== 'pending' || item.revision !== revision) throw new Fault('STALE_APPROVAL', 'Approval changed or was already resolved.', 409);
            if (Date.parse(item.expiresAt) <= this.clock()) {
                item.status = 'expired';
                item.revision++;
                return {
                    approval: item,
                    dispatched: false,
                    message: 'Approval expired. Ask again.'
                };
            }
            item.status = decision === 'approve' ? 'approved' : 'denied';
            item.revision++;
            if (decision === 'approve' && !dispatch) state.jobs.push({
                id: randomUUID(),
                kind: `external:${item.service}`,
                status: 'blocked',
                createdAt: new Date(this.clock()).toISOString(),
                evidence: [],
                message: 'Approval recorded. Provider dispatch is not implemented; nothing was sent.'
            });
            return {
                approval: item,
                dispatched: false,
                message: decision === 'approve' ? dispatch?'Approval recorded for this request.':'Approval recorded. Nothing was sent: provider is not connected.' : 'Request denied. Nothing was sent.'
            };
        });
    }
    stop(requestId, jobIds = []) {
        return this.mutate((state)=>this.once(state, requestId, {
                operation: 'stop'
            }, ()=>{
                state.generation++;
                for (const a of state.approvals)if (a.status === 'pending') {
                    a.status = 'denied';
                    a.revision++;
                }
                return {reply:'Pending requests cancelled. Stop requested for owned jobs.',generation:state.generation,jobIds};
            }));
    }
    nudges(now, activity) {
        return this.mutate((state)=>{
            const at = Date.parse(now);
            if (activity.locked || activity.inMeeting || activity.quietHours || activity.activeMinutes < 60) return {
                nudges: [],
                source: 'fixture',
                suppressed: true
            };
            const recent = state.nudges.filter((n)=>at - Date.parse(n.createdAt) >= 0 && at - Date.parse(n.createdAt) < 3600000);
            if (recent.length >= 2 || recent.some((n)=>at - Date.parse(n.createdAt) < 1200000)) return {
                nudges: [],
                source: 'fixture',
                suppressed: true
            };
            const id = `fixture-break-${Math.floor(at / 3600000)}`;
            if (state.nudges.some((n)=>n.id === id)) return {
                nudges: [],
                source: 'fixture',
                suppressed: true
            };
            const nudge = {
                id,
                kind: 'break',
                createdAt: now,
                source: 'fixture',
                message: 'You’ve been active for an hour. Take a short break?',
                evidence: `Preview input: ${activity.activeMinutes} active minutes. This is not observed screen time.`
            };
            state.nudges.push(nudge);
            return {
                nudges: [
                    nudge
                ],
                source: 'fixture',
                suppressed: false
            };
        });
    }
}
