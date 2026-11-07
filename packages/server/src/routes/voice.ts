import { Elysia } from 'elysia';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { getConfig } from '../config';

function getServerRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'bin'))) return cwd;
  if (existsSync(join(cwd, 'packages', 'server', 'bin'))) return join(cwd, 'packages', 'server');
  return cwd;
}

export const voiceRouter = new Elysia({ prefix: '/api/voice' })
  .get('/status', () => {
    const root = getServerRoot();
    const binaryPath = join(root, 'bin', 'whisper-cli.exe');
    const modelPath = join(root, 'models', 'ggml-base.en.bin');
    const ready = existsSync(binaryPath) && existsSync(modelPath);
    return {
      ready,
      ...(ready ? { binaryPath, modelPath } : {}),
      message: ready
        ? 'Whisper binary and model found'
        : 'Run setup-whisper.ps1 to install voice transcription support',
    };
  })
  .post('/transcribe', async ({ request }) => {
    const config = getConfig();
    const root = getServerRoot();
    const binaryPath = (config as any).voice?.whisperBinaryPath ?? join(root, 'bin', 'whisper-cli.exe');
    const modelPath  = (config as any).voice?.whisperModelPath  ?? join(root, 'models', 'ggml-base.en.bin');

    if (!existsSync(binaryPath)) {
      return { text: '', error: 'whisper-cli.exe not found. Run setup-whisper.ps1 first.' };
    }

    try {
      const wavBytes = await request.arrayBuffer();
      const tmpWav = join(tmpdir(), `whisper-${Date.now()}.wav`);
      await Bun.write(tmpWav, new Uint8Array(wavBytes));

      // Try primary arg order first, then fallback
      let result = spawnSync(binaryPath, ['-m', modelPath, '-f', tmpWav, '-otxt', '--output-txt'], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) {
        result = spawnSync(binaryPath, ['-m', modelPath, '-otxt', tmpWav], { encoding: 'utf8', timeout: 30000 });
      }

      // Try to read .txt output file
      const txtFile = tmpWav + '.txt';
      let text = '';
      if (existsSync(txtFile)) {
        text = await Bun.file(txtFile).text();
        try { require('fs').unlinkSync(txtFile); } catch {}
      } else {
        text = (result.stdout ?? '').toString().trim();
      }

      try { require('fs').unlinkSync(tmpWav); } catch {}

      return { text: text.trim(), ...(result.status !== 0 ? { error: result.stderr } : {}) };
    } catch (err: any) {
      return { text: '', error: err.message };
    }
  });
