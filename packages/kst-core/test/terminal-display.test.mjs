import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAttachCommand, createTerminalService } from '../src/terminal.mjs';
import { followJob, validateAttachTarget, readPrivateToken, safeOutput } from '../../../bridges/iterm/attach-client.mjs';

const jobId = 'aabbccdd-1234-4567-89ab-aabbccddeeff';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kst-display-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokenFile = join(root, 'private token');
  writeFileSync(tokenFile, 'test-token-that-is-long-enough', { mode: 0o600 });
  return { root, tokenFile };
}

test('attach target rejects external or credential-bearing destinations and invalid job IDs', (t) => {
  const { tokenFile } = fixture(t);
  for (const coreURL of ['https://example.com', 'http://localhost:4310', 'http://127.0.0.1:4310/path', 'http://user:password@127.0.0.1:4310', 'http://127.0.0.1:4310/?token=secret']) assert.throws(() => validateAttachTarget({ jobId, coreURL, tokenFile }));
  assert.throws(() => validateAttachTarget({ jobId: 'raw;command', coreURL: 'http://127.0.0.1:4310', tokenFile }));
});

test('new-window command uses fixed quoted argv without token values or raw transcripts', (t) => {
  const { tokenFile } = fixture(t);
  const command = buildAttachCommand({ jobId, coreURL: 'http://127.0.0.1:4310', tokenFile, nodePath: '/approved path/node', clientPath: "/approved path/it's-a-client.mjs" });
  assert.match(command, /^'\/approved path\/node' /);
  assert.ok(command.includes("it'\"'\"'s-a-client.mjs"));
  assert.ok(command.includes(jobId));
  assert.doesNotMatch(command, /test-token-that-is-long-enough/);
});

test('private token reader rejects symlinks and public-readable files', (t) => {
  const { root, tokenFile } = fixture(t);
  const link = join(root, 'link'); symlinkSync(tokenFile, link);
  assert.throws(() => readPrivateToken(link));
  const publicFile = join(root, 'public'); writeFileSync(publicFile, 'test-token-that-is-long-enough', { mode: 0o644 });
  assert.throws(() => readPrivateToken(publicFile));
});

test('attach display prints only its known receipt and strips terminal control sequences', async (t) => {
  const { tokenFile } = fixture(t);
  let output = '', calls = 0;
  const result = await followJob({ jobId, coreURL: 'http://127.0.0.1:4310', tokenFile, write: (text) => { output += text; }, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:4310/api/terminal/status'); assert.equal(options.redirect, 'error');
    return { ok: true, text: async () => JSON.stringify({ jobs: [{ id: 'other-job', stdout: 'OTHER PRIVATE OUTPUT' }, { id: jobId, status: 'succeeded', message: 'Done', stdout: '\x1b]52;c;clipboard\x07safe\x1b[31m output', stderr: '', exitCode: 0 }] }) };
  } });
  assert.equal(result.status, 'succeeded'); assert.equal(calls, 1);
  assert.match(output, /safe output/); assert.doesNotMatch(output, /OTHER PRIVATE OUTPUT|clipboard|\x1b|test-token/);
  assert.equal(safeOutput('hello\x00world'), 'helloworld');
});

test('missing token leaves managed display unavailable without invoking iTerm', async (t) => {
  const { root } = fixture(t), project = join(root, 'project'); mkdirSync(project);
  const service = createTerminalService({ dataDir: join(root, 'data'), projects: [{ id: 'fixture', root: project, recipes: [{ id: 'test', executable: process.execPath, args: ['-e', 'console.log("ok")'] }] }] });
  t.after(() => service.close());
  const job = await service.runRecipe({ projectId: 'fixture', recipeId: 'test', requestId: 'display-without-token' });
  const receipt = await service.openJobInITerm(job.id);
  assert.equal(receipt.status, 'unavailable');
});
