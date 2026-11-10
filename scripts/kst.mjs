#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] ?? 'help';
const core = join(root, 'packages/kst-core/src/server.mjs');
const native = join(root, 'apps/macos');
const help = `kst development commands (Node 22+):
  node scripts/kst.mjs start       Start private local core and dashboard
  node scripts/kst.mjs doctor      Check development prerequisites
  node scripts/kst.mjs test        Run core and native tests
  node scripts/kst.mjs build-mac   Build native Swift executable
  node scripts/kst.mjs package-mac Build locally signed kst.app

Start the native app separately using apps/macos instructions.
The current preview uses an isolated kst-dev data profile. Google needs the native broker and local OAuth configuration.
`;

function run(binary, args, cwd = root) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit' });
    child.once('error', (error) => { console.error(`Could not start ${binary}: ${error.code ?? 'unavailable'}`); resolve(1); });
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

if (command === 'start') {
  if (!existsSync(core)) throw new Error('Core entry point missing; checkout/build is incomplete.');
  const child = spawn(process.execPath, [core], { cwd: root, stdio: 'inherit' });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
    const timeout = setTimeout(() => {
      console.error('Core has not stopped. Inspect its process before removing any ownership lock.');
    }, 6000);
    timeout.unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.once('error', (error) => { console.error(`Core failed to launch: ${error.code ?? 'unknown'}`); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} else if (command === 'doctor') {
  console.log(`Node ${process.versions.node}: ${Number(process.versions.node.split('.')[0]) >= 22 ? 'available' : 'upgrade required'}`);
  for (const [label, path] of [['Core', core], ['Dashboard', join(root, 'packages/kst-web/index.html')], ['Native package', join(native, 'Package.swift')], ['Logo', join(root, 'assets/kst/kst-logo.png')]]) {
    console.log(`${label}: ${existsSync(path) ? 'present' : 'missing'}`);
  }
  const swift = spawnSync('/usr/bin/swift', ['--version'], { encoding: 'utf8' });
  console.log(`Swift: ${swift.status === 0 ? swift.stdout.trim().split('\n')[0] : 'unavailable'}`);
  console.log(`Full Xcode: ${existsSync('/Applications/Xcode.app') ? 'present' : 'not installed; command-line Swift development build is supported'}`);
  console.log('Native: arise phrase gate, on-device speech, coarse activity and notices implemented; hardware/offline/performance validation pending.');
  console.log('Terminal: vetted managed recipes and explicit iTerm inventory/display. Native dictation can type literal text into supported armed iTerm prompts; terminal submission remains disabled.');
  console.log('External providers: approval-gated OpenAI/Claude APIs, scoped read-only Codex CLI, and browser search. Explicit account/model setup and live validation are required; no fallback.');
} else if (command === 'test') {
  let result = await run(process.execPath, ['--test', '--test-reporter=spec'], join(root, 'packages/kst-core'));
  result = (await run(process.execPath, ['--test', 'app.test.mjs'], join(root, 'packages/kst-web'))) || result;
  if (existsSync(join(native, 'Package.swift'))) result = (await run('/usr/bin/swift', ['run', '--disable-sandbox', 'KstNativeChecks'], native)) || result;
  process.exitCode = result;
} else if (command === 'build-mac') {
  process.exitCode = await run('/usr/bin/swift', ['build', '--disable-sandbox', '--product', 'kst'], native);
} else if (command === 'package-mac') {
  process.exitCode = await run('/bin/bash', [join(native, 'build-app.sh')], root);
} else {
  console.log(help);
  if (command !== 'help') process.exitCode = 1;
}
