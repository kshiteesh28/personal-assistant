import { openSync, fstatSync, readFileSync, closeSync, constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateAttachTarget({ jobId, coreURL, tokenFile }) {
  if (typeof jobId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId)) throw Error('A known managed job UUID is required.');
  const target = new URL(coreURL);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('The attach client accepts an explicit local loopback core URL only.');
  if (!isAbsolute(tokenFile || '') || tokenFile.includes('\0')) throw Error('A private absolute token-file path is required.');
  return target.origin;
}

export function readPrivateToken(file) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 256) throw Error('The token file must be a private regular file owned by this user.');
    const token = readFileSync(descriptor, 'utf8').trim();
    if (token.length < 24 || token.length > 256) throw Error('The local token is unavailable.');
    return token;
  } finally { closeSync(descriptor); }
}

// Receipts are untrusted terminal data. Remove ANSI/OSC escape sequences and control characters.
export function safeOutput(text) {
  return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export async function followJob({ jobId, coreURL, tokenFile, write = (text) => process.stdout.write(text), pollMs = 1000, maxPolls = 900, fetchImpl = fetch }) {
  const origin = validateAttachTarget({ jobId, coreURL, tokenFile });
  const token = readPrivateToken(tokenFile);
  write(`kst · managed job ${jobId}\nRead-only receipt display. No input is sent to another terminal.\n\n`);
  let priorStatus = '', priorOut = '', priorErr = '';
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const response = await fetchImpl(`${origin}/api/terminal/status`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) throw Error(`The local core refused the receipt request (${response.status}).`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error('Receipt response exceeded the bounded display limit.');
    const job = JSON.parse(text).jobs?.find((item) => item.id === jobId);
    if (!job) throw Error('This job is no longer in the available receipt window.');
    if (job.status !== priorStatus) { write(`\n[${safeOutput(job.status)}] ${safeOutput(job.message || '')}\n`); priorStatus = job.status; }
    for (const [name, previous] of [['stdout', priorOut], ['stderr', priorErr]]) {
      const output = String(job[name] || '').slice(-32768);
      if (output !== previous) write(`${name === 'stderr' ? '\n[stderr]\n' : ''}${safeOutput(output.startsWith(previous) ? output.slice(previous.length) : `\n[bounded output tail]\n${output}`)}`);
      if (name === 'stdout') priorOut = output; else priorErr = output;
    }
    if (!['prepared', 'running', 'cancelling'].includes(job.status)) {
      write(`\n\nJob receipt: ${safeOutput(job.status)}${job.exitCode !== null && job.exitCode !== undefined ? ` · exit ${job.exitCode}` : ''}${job.outputTruncated ? ' · output truncated' : ''}\n`);
      return { status: job.status, jobId };
    }
    await new Promise((done) => setTimeout(done, pollMs));
  }
  throw Error('The display time limit elapsed. The job itself was not cancelled; check kst for its current status.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [jobId, coreURL, tokenFile] = process.argv.slice(2);
  try { await followJob({ jobId, coreURL, tokenFile }); }
  catch (error) { process.stderr.write(`kst display unavailable: ${safeOutput(error.message)}\n`); process.exitCode = 1; }
  if (process.stdin.isTTY) {
    process.stdout.write('\nPress Enter to close this display.\n');
    await new Promise((done) => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); done(); }); });
  }
}
