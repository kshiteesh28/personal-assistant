import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createTerminalService } from '../src/terminal.mjs';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function fixture(t, code = 'console.log("verified-result")', timeoutMs = 5000) {
  const root = mkdtempSync(join(tmpdir(), 'kst-terminal-test-'));
  const project = join(root, 'project'); mkdirSync(project);
  const dataDir = join(root, 'data');
  const config = { id: 'fixture', root: project, recipes: [{ id: 'test', executable: process.execPath, args: ['-e', code], timeoutMs }] };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, project, dataDir, config };
}
async function finish(service, id, deadline = 5000) {
  const until = Date.now() + deadline;
  while (Date.now() < until) {
    const job = service.status().jobs.find((item) => item.id === id);
    if (!['prepared', 'running', 'cancelling'].includes(job.status)) return job;
    await pause(20);
  }
  throw Error('Test fixture job did not settle.');
}

test('managed fixed argv executes once with output and exit evidence', async (t) => {
  const f = fixture(t), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  const request = { projectId: 'fixture', recipeId: 'test', requestId: 'same-request' };
  const first = await service.runRecipe(request), duplicate = await service.runRecipe(request);
  assert.equal(first.id, duplicate.id);
  const result = await finish(service, first.id);
  assert.equal(result.status, 'succeeded');
  assert.match(result.stdout, /verified-result/);
  assert.equal(result.exitCode, 0);
  assert.equal(result.evidence[0].kind, 'process-exit');
  assert.equal(service.status().jobs.length, 1);
});

test('project aliases serialize and blocked jobs do not execute', async (t) => {
  const f = fixture(t, 'setTimeout(()=>{},10000)');
  const alias = join(f.root, 'alias'); symlinkSync(f.project, alias);
  const service = createTerminalService({ dataDir: f.dataDir, projects: [f.config, { ...f.config, id: 'alias', root: alias }] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'first' });
  const second = await service.runRecipe({ projectId: 'alias', recipeId: 'test', requestId: 'second' });
  assert.equal(second.status, 'blocked'); assert.equal(second.pid, null);
  assert.equal((await service.cancel(first.id)).status, 'cancelled');
});

test('nonzero exit is failed and frees resource after verified group exit', async (t) => {
  const f = fixture(t, 'process.exit(7)'), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'failure-1' });
  const result = await finish(service, first.id);
  assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 7);
  const next = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'failure-2' });
  assert.notEqual(next.status, 'blocked');
  await finish(service, next.id);
});

test('distinct worktree roots coordinate their shared Git common directory', async (t) => {
  const f = fixture(t, 'setTimeout(()=>{},10000)');
  const second = join(f.root, 'second'); mkdirSync(second);
  const common = join(f.root, 'common'); mkdirSync(common);
  for (const [root, name] of [[f.project, 'one'], [second, 'two']]) {
    const gitDir = join(common, 'worktrees', name); mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(root, '.git'), `gitdir: ${gitDir}\n`);
    writeFileSync(join(gitDir, 'commondir'), '../..\n');
  }
  const service = createTerminalService({ dataDir: f.dataDir, projects: [f.config, { ...f.config, id: 'second', root: second }] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'tree-one' });
  const blocked = await service.runRecipe({ projectId: 'second', recipeId: 'test', requestId: 'tree-two' });
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.pid, null);
  await service.cancel(first.id);
});

test('output is bounded and explicitly marked truncated', async (t) => {
  const f = fixture(t, 'console.log("x".repeat(100000))'), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'output-limit' });
  const result = await finish(service, first.id);
  assert.equal(result.status, 'succeeded'); assert.equal(result.outputTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 32768);
});

test('deadline stops its owned workload and records timeout rather than success', async (t) => {
  const f = fixture(t, 'setTimeout(()=>{},10000)', 100), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'deadline' });
  const result = await finish(service, first.id);
  assert.equal(result.status, 'failed'); assert.equal(result.timedOut, true); assert.match(result.message, /timed out/);
});

test('request ID cannot be reused to switch project or recipe', async (t) => {
  const f = fixture(t), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  const first = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'fixed-id' });
  await assert.rejects(service.runRecipe({ projectId: 'fixture', recipeId: 'git-status', requestId: 'fixed-id' }), (error) => error.code === 'REQUEST_ID_CONFLICT');
  await finish(service, first.id);
});

test('unconfigured projects and arbitrary recipe names cannot dispatch', async (t) => {
  const f = fixture(t), service = createTerminalService({ dataDir: f.dataDir, projects: [] });
  t.after(() => service.close());
  await assert.rejects(service.runRecipe({ projectId: 'fixture', recipeId: 'shell', requestId: 'denied' }), (error) => error.code === 'RECIPE_NOT_APPROVED');
  assert.equal(service.status().jobs.length, 0);
});

test('another service cannot take over a live owner', async (t) => {
  const f = fixture(t), service = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => service.close());
  assert.throws(() => createTerminalService({ dataDir: f.dataDir, projects: [f.config] }), (error) => error.code === 'TERMINAL_OWNER_BUSY');
});

test('core death leaves durable unknown ownership and prevents replay', async (t) => {
  const f = fixture(t, 'setTimeout(()=>{},60000)', 60000);
  const module = new URL('../src/terminal.mjs', import.meta.url).href;
  const script = `import {createTerminalService} from ${JSON.stringify(module)}; const service=createTerminalService(${JSON.stringify({ dataDir: f.dataDir, projects: [f.config] })}); console.log(JSON.stringify(await service.runRecipe({projectId:'fixture',recipeId:'test',requestId:'crashed'}))); setInterval(()=>{},1000);`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  owner.stderr.resume();
  const receipt = await new Promise((accept, reject) => { let output = ''; owner.stdout.on('data', (chunk) => { output += chunk; if (output.includes('\n')) { try { accept(JSON.parse(output.trim())); } catch (error) { reject(error); } } }); owner.on('error', reject); owner.on('exit', (code) => { if (!output) reject(Error(`Fixture owner exited (${code})`)); }); });
  t.after(() => { try { process.kill(-receipt.pid, 'SIGKILL'); } catch {} try { owner.kill('SIGKILL'); } catch {} });
  owner.kill('SIGKILL'); await new Promise((done) => owner.once('exit', done));
  const recovered = createTerminalService({ dataDir: f.dataDir, projects: [f.config] });
  t.after(() => recovered.close());
  assert.equal(recovered.status().mode, 'quarantined');
  const prior = recovered.status().jobs.find((job) => job.id === receipt.id);
  assert.equal(prior.status, 'unknown');
  assert.equal((await recovered.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'crashed' })).id, receipt.id);
  await assert.rejects(recovered.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'new-after-crash' }), (error) => error.code === 'TERMINAL_QUARANTINED');
});
