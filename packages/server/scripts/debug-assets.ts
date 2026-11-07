/**
 * debug-assets.ts
 * Checks and prints the status of all runtime asset paths.
 * Run with: bun scripts/debug-assets.ts
 */

import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Bun provides import.meta.dir as the directory of the current file
const scriptDir  = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const serverRoot = resolve(scriptDir, '..');
const projectRoot = resolve(serverRoot, '..', '..', '..');

function check(label: string, path: string, required = false): void {
  let exists = false;
  try { statSync(path); exists = true; } catch {}
  const icon   = exists ? '✅' : required ? '❌' : '⚠️ ';
  const status = exists ? 'OK' : required ? 'MISSING (required)' : 'Not found (optional)';
  console.log(`${icon}  ${label}`);
  console.log(`     Path:   ${path}`);
  console.log(`     Status: ${status}`);
  console.log();
}

console.log('=== Flow-State — Asset Diagnostics ===');
console.log(`Project root: ${projectRoot}\n`);

// Server binaries
const binDir    = join(serverRoot, 'bin');
const modelsDir = join(serverRoot, 'models');
check('whisper-cli.exe',  join(binDir, 'whisper-cli.exe'),   true);
check('whisper.dll',      join(binDir, 'whisper.dll'),        true);
check('ggml.dll',         join(binDir, 'ggml.dll'),           true);
check('ggml-base.dll',    join(binDir, 'ggml-base.dll'),      false);
check('ggml-cpu.dll',     join(binDir, 'ggml-cpu.dll'),       false);
check('ggml-base.en.bin', join(modelsDir, 'ggml-base.en.bin'), true);

// Config and DB
check('config.json',  join(projectRoot, 'config.json'),   false);
check('flowstate.db', join(projectRoot, 'flowstate.db'),  false);

// Cache
check('.cache/copilot-llm-response.json',
  join(projectRoot, '.cache', 'copilot-llm-response.json'), false);

// Frontend VAD assets
const vadDir = join(serverRoot, '../web/public/vad');
check('public/vad/ dir', vadDir, false);
check('VAD silero_vad.onnx', join(vadDir, 'silero_vad.onnx'), false);

// Migrations
const migrationsDir = join(projectRoot, 'migrations');
for (let i = 1; i <= 8; i++) {
  const num = String(i).padStart(3, '0');
  // Try common naming patterns
  const candidates = [`${num}_foundation.sql`, `${num}_task_position.sql`,
    `${num}_task_scheduling_params.sql`, `${num}_daily_schedules.sql`,
    `${num}_process_optimization.sql`, `${num}_downtime_pipeline.sql`,
    `${num}_pinned_time.sql`, `${num}_task_progress.sql`];
  const file = candidates[i - 1] ?? `${num}_.sql`;
  check(`Migration ${num}`, join(migrationsDir, file));
}

console.log('=== Diagnostics Complete ===');
