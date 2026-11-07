import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, lstatSync, statSync, realpathSync, readFileSync, writeFileSync, chmodSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Fault } from './engine.mjs';
import { validateAttachTarget, readPrivateToken } from '../../../bridges/iterm/attach-client.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const live = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const groupLive = (pid) => { try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Fault('TERMINAL_STORAGE_UNSAFE', 'Terminal storage must be a private owned directory.', 503);
  chmodSync(path, 0o700);
}

function readProjects(projects) {
  if (!Array.isArray(projects) || projects.length > 50) throw new Fault('PROJECT_CONFIG_INVALID', 'Project configuration must be an array of at most 50 approved projects.');
  const map = new Map();
  for (const project of projects) {
    if (!safeId(project.id) || map.has(project.id) || !isAbsolute(project.root || '')) throw new Fault('PROJECT_CONFIG_INVALID', 'Projects need unique IDs and absolute roots.');
    const root = realpathSync(project.root), stat = statSync(root);
    if (!stat.isDirectory() || root === '/' || root === homedir()) throw new Fault('PROJECT_CONFIG_INVALID', 'Use a specific project folder.');
    const resource = digest({ device: stat.dev, inode: stat.ino });
    const resources = [resource];
    // Worktrees and subprojects can share Git metadata despite different root paths.
    let cursor = root;
    while (true) {
      const dotGit = join(cursor, '.git');
      if (existsSync(dotGit)) {
        let gitDir = dotGit;
        if (statSync(dotGit).isFile()) {
          const declaration = readFileSync(dotGit, 'utf8').trim().match(/^gitdir:\s*(.+)$/);
          if (!declaration) throw new Fault('PROJECT_CONFIG_INVALID', 'Git metadata path could not be validated.');
          gitDir = resolve(cursor, declaration[1]);
        }
        if (existsSync(join(gitDir, 'commondir'))) gitDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
        const gitStat = statSync(realpathSync(gitDir));
        resources.push(digest({ device: gitStat.dev, inode: gitStat.ino }));
        break;
      }
      if (dirname(cursor) === cursor) break;
      cursor = dirname(cursor);
    }
    const recipes = new Map();
    // Git status has fixed read-only argv. Every other recipe requires a reviewed static configuration.
    recipes.set('git-status', { id: 'git-status', executable: '/usr/bin/git', args: ['status', '--short', '--branch'], timeoutMs: 15000, label: 'Git status' });
    for (const recipe of project.recipes || []) {
      if (recipe.id !== 'test' || !isAbsolute(recipe.executable || '') || !Array.isArray(recipe.args) || recipe.args.length > 50 || recipe.args.some((arg) => typeof arg !== 'string' || arg.includes('\0') || arg.length > 4000)) throw new Fault('RECIPE_CONFIG_INVALID', 'Only a reviewed test recipe with an absolute executable and fixed argv may be configured.');
      const executable = realpathSync(recipe.executable);
      if (!statSync(executable).isFile()) throw new Fault('RECIPE_CONFIG_INVALID', 'The approved executable is unavailable.');
      const timeoutMs = recipe.timeoutMs ?? 120000;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 900000) throw new Fault('RECIPE_CONFIG_INVALID', 'Recipe timeout must be between 100 and 900000 milliseconds.');
      recipes.set(recipe.id, { ...recipe, executable, args: [...recipe.args], timeoutMs, label: 'Approved project tests' });
    }
    map.set(project.id, { id: project.id, label: project.label || project.id, root, resource, resources: [...new Set(resources)].sort(), recipes });
  }
  return map;
}

export function buildAttachCommand({ jobId, coreURL, tokenFile, nodePath = process.execPath, clientPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../bridges/iterm/attach-client.mjs') }) {
  validateAttachTarget({ jobId, coreURL, tokenFile });
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  if (![nodePath, clientPath].every((value) => isAbsolute(value) && !value.includes('\0'))) throw new Fault('DISPLAY_PATH_INVALID', 'Managed display requires absolute executable/client paths.');
  return [nodePath, clientPath, jobId, coreURL, tokenFile].map(quote).join(' ');
}

export function createTerminalService({ dataDir, projects = [], getCoreURL = () => 'http://127.0.0.1:4310', tokenFile = join(dataDir || '', 'token') } = {}) {
  if (!isAbsolute(dataDir || '') || dataDir === '/' || dataDir === homedir()) throw new Fault('TERMINAL_STORAGE_INVALID', 'A dedicated absolute terminal data directory is required.');
  const projectMap = readProjects(projects);
  privateDirectory(dataDir);
  const locks = join(dataDir, 'resources'); privateDirectory(locks);
  const ownerDirectory = join(dataDir, 'service-owner');
  const nonce = randomUUID();
  let ownsService = false, quarantine = false, closing = false;
  try {
    mkdirSync(ownerDirectory, { mode: 0o700 });
    writeFileSync(join(ownerDirectory, 'owner.json'), JSON.stringify({ pid: process.pid, nonce, startedAt: now() }), { flag: 'wx', mode: 0o600 });
    ownsService = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = lstatSync(ownerDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid()) throw new Fault('TERMINAL_STORAGE_UNSAFE', 'Terminal ownership directory is unsafe.', 503);
    let owner;
    try { owner = JSON.parse(readFileSync(join(ownerDirectory, 'owner.json'), 'utf8')); } catch {}
    if (Number.isInteger(owner?.pid) && live(owner.pid)) throw new Fault('TERMINAL_OWNER_BUSY', 'Another terminal service may own this profile. No takeover was attempted.', 409);
    quarantine = true;
  }
  const dbFile = join(dataDir, 'terminal.sqlite');
  for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Fault('TERMINAL_STORAGE_UNSAFE', 'Terminal database must be an owned regular file.', 503); chmodSync(file, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS terminal_jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL, data TEXT NOT NULL);');
  chmodSync(dbFile, 0o600);
  if (quarantine) {
    for (const row of db.prepare('SELECT id,data FROM terminal_jobs').all()) {
      const job = JSON.parse(row.data);
      if (['prepared', 'running', 'cancelling'].includes(job.status)) {
        job.status = 'unknown'; job.message = 'Prior owner exited. Work may still be running; resources are quarantined and no replay is allowed.'; job.updatedAt = now();
        db.prepare('UPDATE terminal_jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
      }
    }
  }
  const running = new Map();
  let dbClosed = false;
  const get = (id) => { const row = db.prepare('SELECT data FROM terminal_jobs WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; };
  const save = (job) => { job.updatedAt = now(); if (!dbClosed) db.prepare('UPDATE terminal_jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id); };
  function release(resource, jobId) {
    const directory = join(locks, resource);
    try {
      const owner = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'));
      if (owner.jobId !== jobId || owner.nonce !== nonce) return false;
      unlinkSync(join(directory, 'owner.json')); rmdirSync(directory); return true;
    } catch { return false; }
  }
  function snapshot() {
    return { mode: quarantine ? 'quarantined' : closing ? 'closing' : projectMap.size ? 'ready' : 'disabled', supervised: true, existingPaneWrites: false,
      message: quarantine ? 'Previous ownership is uncertain. Inspect processes and job receipts before manually archiving ownership/resource records. No automatic lock expiry exists.' : 'Only explicitly configured project recipes run. No raw shell text or existing-pane writes.',
      projects: [...projectMap.values()].map((project) => ({ id: project.id, label: project.label, recipes: [...project.recipes.values()].map((recipe) => ({ id: recipe.id, label: recipe.label, executable: recipe.executable, args: recipe.args })) })),
      jobs: db.prepare('SELECT data FROM terminal_jobs ORDER BY rowid DESC LIMIT 100').all().map((row) => JSON.parse(row.data)) };
  }
  async function runRecipe({ projectId, recipeId, requestId } = {}) {
    if (!safeId(requestId)) throw new Fault('REQUEST_ID_INVALID', 'A stable request ID is required.');
    const requestHash = digest({ projectId, recipeId });
    const previous = db.prepare('SELECT request_hash,data FROM terminal_jobs WHERE request_id=?').get(requestId);
    if (previous) { if (previous.request_hash !== requestHash) throw new Fault('REQUEST_ID_CONFLICT', 'This request ID belongs to a different command.', 409); return JSON.parse(previous.data); }
    if (closing || quarantine) throw new Fault('TERMINAL_QUARANTINED', 'Terminal ownership is unavailable. No command was started.', 409);
    const project = projectMap.get(projectId), recipe = project?.recipes.get(recipeId);
    if (!project || !recipe) throw new Fault('RECIPE_NOT_APPROVED', 'Choose an explicitly configured project and approved recipe.', 403);
    const stat = statSync(project.root);
    if (digest({ device: stat.dev, inode: stat.ino }) !== project.resource) throw new Fault('PROJECT_CHANGED', 'The approved project identity changed. Reconfigure it before running commands.', 409);
    const job = { id: randomUUID(), kind: 'terminal.recipe', projectId, recipeId, requestId, resources: project.resources, status: 'prepared', message: 'Preparing approved local recipe.', createdAt: now(), updatedAt: now(), pid: null, exitCode: null, signal: null, stdout: '', stderr: '', outputTruncated: false, evidence: [], ownerNonce: nonce };
    db.prepare('INSERT INTO terminal_jobs(id,request_id,request_hash,data) VALUES(?,?,?,?)').run(job.id, requestId, requestHash, JSON.stringify(job));
    const acquired = [];
    try {
      for (const resource of project.resources) {
        const directory = join(locks, resource);
        mkdirSync(directory, { mode: 0o700 });
        writeFileSync(join(directory, 'owner.json'), JSON.stringify({ jobId: job.id, nonce, pid: process.pid, createdAt: now() }), { flag: 'wx', mode: 0o600 });
        acquired.push(resource);
      }
    } catch (error) {
      for (const resource of acquired) release(resource, job.id);
      job.status = error.code === 'EEXIST' ? 'blocked' : 'unknown'; job.message = error.code === 'EEXIST' ? 'Project is owned by another job or quarantined resource. No command was started.' : 'Resource ownership could not be established. No command was started; inspect storage.'; save(job); return job;
    }
    let child;
    try {
      // A reviewed recipe supplies every argument. No transcript, shell, inherited secrets, or dynamic PATH lookup.
      child = spawn(recipe.executable, recipe.args, { cwd: project.root, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: `${dirname(recipe.executable)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
    } catch {
      job.status = 'failed'; job.message = 'Approved process could not be spawned.'; save(job); for (const resource of acquired) release(resource, job.id); return job;
    }
    job.pid = child.pid || null;
    job.status = child.pid ? 'running' : 'prepared'; job.message = 'Approved local recipe is running.'; save(job);
    let settle;
    const settled = new Promise((done) => { settle = done; });
    const entry = { child, job, project, settled, cancelling: false, timeout: null, cancelPromise: null };
    running.set(job.id, entry);
    const collect = (field) => (chunk) => { const combined = job[field] + chunk.toString('utf8'); if (Buffer.byteLength(combined) > 32768 || combined.length > 8192) job.outputTruncated = true; job[field] = combined.slice(-8192); };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => { job.spawnError = error.code || 'SPAWN_FAILED'; });
    child.once('close', async (code, signal) => {
      clearTimeout(entry.timeout);
      job.exitCode = code; job.signal = signal;
      // A shell/test may leave children in its group. Do not free ownership underneath them.
      for (let attempt = 0; child.pid && groupLive(child.pid) && attempt < 10; attempt++) await wait(25);
      if (child.pid && groupLive(child.pid)) {
        job.status = 'unknown'; job.message = 'The process ended but descendants may still be alive. Project remains quarantined.';
      } else {
        job.status = job.timedOut ? 'failed' : entry.cancelling ? 'cancelled' : code === 0 && !job.spawnError ? 'succeeded' : 'failed';
        job.message = job.timedOut ? 'Recipe timed out; owned process group was stopped and verified.' : entry.cancelling ? 'Owned process group stopped; cancellation verified.' : job.status === 'succeeded' ? 'Approved process exited successfully.' : `Approved process failed${job.spawnError ? ` (${job.spawnError})` : code !== null ? ` with exit code ${code}` : ` (${signal || 'unknown signal'})`}.`;
        if (acquired.map((resource) => release(resource, job.id)).some((released) => !released)) { job.status = 'unknown'; job.message = 'Process ended but resource release could not be verified; inspect ownership before reuse.'; }
      }
      job.evidence = [{ kind: 'process-exit', pid: job.pid, exitCode: code, signal, observedAt: now() }];
      save(job); running.delete(job.id); settle(structuredClone(job));
    });
    entry.timeout = setTimeout(() => { job.timedOut = true; cancel(job.id).catch(() => {}); }, recipe.timeoutMs);
    return structuredClone(job);
  }
  async function cancel(jobId) {
    const entry = running.get(jobId);
    if (!entry) { const job = get(jobId); if (!job) throw new Fault('JOB_NOT_FOUND', 'No managed job has that ID.', 404); if (job.status === 'unknown') throw new Fault('JOB_OWNERSHIP_UNKNOWN', 'Cannot signal a job whose live ownership is unknown.', 409); return job; }
    if (entry.cancelPromise) return entry.cancelPromise;
    entry.cancelPromise = (async () => {
      entry.cancelling = true; entry.job.status = 'cancelling'; entry.job.message = 'Stopping owned local process group.'; save(entry.job);
      const child = entry.child;
      if (child.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      await Promise.race([entry.settled, wait(500)]);
      // Escalate only while the original unreaped child is still owned. Never signal an unknown/reused PID.
      if (child.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      const result = await Promise.race([entry.settled, wait(1500).then(() => null)]);
      if (result) return result;
      entry.job.status = 'unknown'; entry.job.message = 'Cancellation could not be verified. Resource remains quarantined.'; save(entry.job); return structuredClone(entry.job);
    })();
    return entry.cancelPromise;
  }
  async function inventory() {
    if (process.platform !== 'darwin') return { status: 'unavailable', sessions: [], message: 'iTerm inventory is available on macOS only.' };
    const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'bridges/iterm/inventory.js');
    return new Promise((done) => {
      const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', script], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      let out = '', finished = false;
      const finish = (value) => { if (finished) return; finished = true; clearTimeout(timer); done(value); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ status: 'unavailable', sessions: [], message: 'iTerm inventory timed out. Check Automation permission and try again explicitly.' }); }, 5000);
      child.stdout.on('data', (chunk) => { out += chunk.toString(); if (out.length > 65536) { child.kill('SIGTERM'); finish({ status: 'unavailable', sessions: [], message: 'Inventory exceeded its bounded output limit.' }); } });
      child.stderr.resume();
      child.on('error', () => finish({ status: 'unavailable', sessions: [], message: 'iTerm inventory helper could not start.' }));
      child.on('close', (code) => { if (code !== 0) return finish({ status: 'unavailable', sessions: [], message: 'iTerm inventory was denied or unavailable. Enable Automation permission only if desired; no terminal input was sent.' }); try { finish({ ...JSON.parse(out), observedAt: now(), connectionEpoch: randomUUID(), existingPaneWrites: false }); } catch { finish({ status: 'unavailable', sessions: [], message: 'iTerm returned an unreadable inventory. No terminal input was sent.' }); } });
    });
  }
  async function openJobInITerm(jobId) {
    if (!get(jobId)) throw new Fault('JOB_NOT_FOUND', 'No managed job has that ID.', 404);
    if (process.platform !== 'darwin') return { status: 'unavailable', jobId, message: 'iTerm display is available on macOS only.' };
    let command;
    try {
      // Check the private file without passing the token itself through argv, JXA, or logs.
      readPrivateToken(tokenFile);
      command = buildAttachCommand({ jobId, coreURL: getCoreURL(), tokenFile });
    } catch { return { status: 'unavailable', jobId, message: 'Managed display needs a valid local core URL and its private token file. No window was requested.' }; }
    const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../../bridges/iterm/open-job.js');
    return new Promise((done) => {
      const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', script, command], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      let output = '', finished = false;
      const finish = (value) => { if (finished) return; finished = true; clearTimeout(timer); done({ jobId, ...value }); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ status: 'unknown', message: 'The display request timed out. A new window may already exist; inspect iTerm before retrying.' }); }, 5000);
      child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16384); }); child.stderr.resume();
      child.on('error', () => finish({ status: 'unavailable', message: 'The managed-display helper could not start.' }));
      child.on('close', (code) => {
        if (code !== 0) return finish({ status: 'unavailable', message: 'iTerm did not acknowledge a new display window. Check Automation permission and inspect iTerm before retrying.' });
        try { const receipt = JSON.parse(output); finish({ ...receipt, message: 'A new iTerm window was created for this job’s read-only receipt display.' }); }
        catch { finish({ status: 'unknown', message: 'The window acknowledgement was unreadable. Inspect iTerm before retrying.' }); }
      });
    });
  }
  async function close() {
    if (closing) return;
    closing = true;
    await Promise.all([...running.keys()].map((id) => cancel(id).catch(() => null)));
    const unknown = db.prepare('SELECT data FROM terminal_jobs').all().some((row) => ['unknown', 'prepared', 'running', 'cancelling'].includes(JSON.parse(row.data).status));
    db.close(); dbClosed = true;
    if (ownsService && !unknown) { try { const owner = JSON.parse(readFileSync(join(ownerDirectory, 'owner.json'), 'utf8')); if (owner.nonce === nonce) { unlinkSync(join(ownerDirectory, 'owner.json')); rmdirSync(ownerDirectory); } } catch {} }
  }
  return { inventory, runRecipe, cancel, openJobInITerm, status: snapshot, close };
}
