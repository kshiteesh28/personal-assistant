import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, readdirSync, statfsSync, fsyncSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export class LearningFault extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const LEARNING_LIMITS = Object.freeze({ examples: 256, preferences: 32, payload: 65536, database: 131072, steady: 786432, peak: 1048576, reserve: 8388608 });
export function stableJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
  throw new LearningFault('INVALID_INPUT', 'Unsupported JSON value.');
}
export const digest = value => createHash('sha256').update(value).digest();
export function strictObject(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || required.some(k => !(k in value))) throw new LearningFault('INVALID_INPUT', 'Unexpected or missing fields.');
}
export function safeInteger(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
export function requestID(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new LearningFault('INVALID_REQUEST_ID', 'Use a valid request ID.'); return value; }
function owned(path, directory = false) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || s.uid !== process.getuid() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)) throw new LearningFault('LEARNING_STORAGE_UNSAFE', 'Learning storage ownership or file type is unsafe.', 503);
  chmodSync(path, directory ? 0o700 : 0o600);
  return s;
}
export function privateDirectories(profileDir) {
  const root = resolve(profileDir);
  owned(root, true);
  // Every existing ancestor inside the supplied profile is checked before descent.
  for (const suffix of ['understanding', 'understanding/models']) {
    const path = join(root, suffix);
    try { owned(path, true); } catch (e) { if (e.code !== 'ENOENT') throw e; mkdirSync(path, { mode: 0o700 }); owned(path, true); }
  }
  return { dir: join(root, 'understanding'), models: join(root, 'understanding/models') };
}
const keys = new Set(['settings','active','previous','dataset-revision','privacy-generation','training','promotion-paused','metrics','native-session']);
export class LearningStore {
  constructor(profileDir) {
    Object.assign(this, privateDirectories(profileDir)); this.path = join(this.dir, 'learning.sqlite');
    try { owned(this.path); } catch (e) { if (e.code !== 'ENOENT') throw e; const fd = openSync(this.path, 'wx', 0o600); closeSync(fd); }
    for(const suffix of ['-journal','-wal','-shm']){try{owned(this.path+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}}
    this.db = new DatabaseSync(this.path);
    try{this.db.exec(`PRAGMA page_size=4096; PRAGMA max_page_count=32; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS examples(id BLOB PRIMARY KEY CHECK(length(id)=16),label INTEGER NOT NULL CHECK(label BETWEEN 0 AND 26),role INTEGER NOT NULL CHECK(role IN(0,1)),group_id BLOB NOT NULL CHECK(length(group_id)=16),created_s INTEGER NOT NULL,features BLOB NOT NULL CHECK(length(features)<=512)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS preferences(id BLOB PRIMARY KEY CHECK(length(id)=16),example_id BLOB NOT NULL,label INTEGER NOT NULL CHECK(label BETWEEN 0 AND 26),created_s INTEGER NOT NULL,template BLOB NOT NULL CHECK(length(template)<=416)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS control(key TEXT PRIMARY KEY CHECK(length(key)<=32),value BLOB NOT NULL CHECK(length(value)<=4096)) WITHOUT ROWID;`);
    if(this.db.prepare('PRAGMA page_size').get().page_size!==4096||this.db.prepare('PRAGMA page_count').get().page_count>32)throw new LearningFault('LEARNING_CORRUPT','Learning database page layout is invalid.',503);
    if (this.db.prepare('SELECT count(*) AS n FROM preferences p LEFT JOIN examples e ON e.id=p.example_id WHERE e.id IS NULL').get().n) throw new LearningFault('LEARNING_CORRUPT', 'Preference references are invalid.', 503);
    this.validate();}catch(e){this.db.close();throw e;}
  }
  close() { this.db.close(); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.validate(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  get(key, fallback = null) { const row = this.db.prepare('SELECT value FROM control WHERE key=?').get(key); return row ? JSON.parse(Buffer.from(row.value).toString('utf8')) : fallback; }
  set(key, value) {
    if (!keys.has(key)) throw new LearningFault('LEARNING_CONTROL', 'Unknown control key.');
    const bytes = Buffer.from(stableJSON(value)); if (bytes.length > 4096) throw new LearningFault('LEARNING_FULL', 'Control record is too large.', 507);
    this.db.prepare('INSERT INTO control(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, bytes);
  }
  examples() { return this.db.prepare('SELECT * FROM examples ORDER BY id').all().map(row => ({ ...row, id: Buffer.from(row.id), group_id: Buffer.from(row.group_id), features: Buffer.from(row.features) })); }
  counts() {
    const e = this.db.prepare('SELECT count(*) n,coalesce(sum(16+16+8+length(features)),0) bytes FROM examples').get();
    const p = this.db.prepare('SELECT count(*) n,coalesce(sum(16+16+8+length(template)),0) bytes FROM preferences').get();
    return { examples: e.n, preferences: p.n, payloadBytes: e.bytes + p.bytes };
  }
  validate() {
    const n = this.counts();
    if (n.examples > LEARNING_LIMITS.examples || n.preferences > LEARNING_LIMITS.preferences || n.payloadBytes > LEARNING_LIMITS.payload) throw new LearningFault('LEARNING_FULL', 'Personal learning storage is full.', 507);
    const bytes = this.db.prepare('SELECT coalesce(sum(length(value)),0) n FROM control').get().n;
    if (bytes > 16384) throw new LearningFault('LEARNING_FULL', 'Learning metadata is full.', 507);
    for (const { key, value } of this.db.prepare('SELECT key,value FROM control').all()) { if (!keys.has(key)) throw new LearningFault('LEARNING_CORRUPT', 'Unexpected learning metadata.', 503); JSON.parse(Buffer.from(value).toString('utf8')); }
  }
  accounting(resourceFiles = []) {
    let logical = 0, allocated = 0;
    const files = [this.path, this.path + '-journal', ...readdirSync(this.models).filter(n => /^\d+\.bin$|^candidate-[a-f0-9]+\.tmp$/.test(n)).map(n => join(this.models, n)), ...resourceFiles];
    for (const path of files) { try { const s = lstatSync(path); if (s.isSymbolicLink() || !s.isFile()) throw new LearningFault('LEARNING_STORAGE_UNSAFE','Unsafe learning resource.',503); logical += s.size; allocated += s.blocks * 512; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    return { ...this.counts(), logicalBytes: logical, allocatedBytes: allocated, databaseBytes: lstatSync(this.path).size, steadyLimit: LEARNING_LIMITS.steady, peakLimit: LEARNING_LIMITS.peak };
  }
  admit(extra = 0, resources = []) {
    const a = this.accounting(resources), fs = statfsSync(this.dir);
    if (a.allocatedBytes + extra + 139264 > LEARNING_LIMITS.peak || fs.bavail * fs.bsize < LEARNING_LIMITS.reserve + extra) throw new LearningFault('LEARNING_SPACE', 'Not enough learning storage headroom.', 507);
  }
  modelPath(version) { if (!safeInteger(version,1)) throw new LearningFault('MODEL_VERSION','Invalid model version.'); return join(this.models,`${version}.bin`); }
  readModel(version) { const path = this.modelPath(version); const s = owned(path); if(s.size !== 132224)throw new LearningFault('MODEL_INVALID','Invalid model file size.',503); return readFileSync(path); }
  writeModel(version, bytes, resources = []) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== 132224) throw new LearningFault('MODEL_INVALID','Invalid model byte length.');
    this.admit(135168, resources); const path=this.modelPath(version), temp=join(this.models,`candidate-${digest(bytes).toString('hex')}.tmp`);
    let fd; try { this.checkpoint?.('before-open'); fd=openSync(temp,'wx',0o600); this.checkpoint?.('before-write'); writeFileSync(fd,bytes); this.checkpoint?.('after-write'); fsyncSync(fd); this.checkpoint?.('after-fsync'); closeSync(fd); fd=undefined; try{lstatSync(path);throw new LearningFault('MODEL_EXISTS','Model version already exists.',409);}catch(e){if(e.code!=='ENOENT')throw e;} this.checkpoint?.('before-rename'); renameSync(temp,path); this.checkpoint?.('after-rename'); const d=openSync(this.models,'r');try{fsyncSync(d);this.checkpoint?.('after-directory-fsync');}finally{closeSync(d);} } catch(e) { if(fd!==undefined)closeSync(fd);try{owned(temp);unlinkSync(temp);}catch{}throw e; }
  }
  cleanup(keepVersions = []) {
    const keep = new Set(keepVersions.filter(v=>safeInteger(v,1)).map(v=>`${v}.bin`));
    for (const name of readdirSync(this.models)) if ((/^\d+\.bin$/.test(name) && !keep.has(name)) || /^candidate-[a-f0-9]+\.tmp$/.test(name)) { const path=join(this.models,name);owned(path);unlinkSync(path); }
  }
}
