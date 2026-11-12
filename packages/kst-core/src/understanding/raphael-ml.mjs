import { createHash, randomUUID } from 'node:crypto';

const DAY_MS = 86_400_000;

export const WORK_MODES = Object.freeze([
  'DEEP_ARCHITECTURE',
  'FAST_EXECUTION',
  'READING_RESEARCH',
  'ADMIN_COMMS',
  'RECOVERY_BREAK'
]);

export const NUDGE_ARMS = Object.freeze([
  'DELIVER_NOW',
  'WAIT_FOR_APP_SWITCH',
  'DEFER_30M',
  'SILENCE'
]);

export const DEFAULT_MODE_PLAYLISTS = Object.freeze({
  DEEP_ARCHITECTURE: [
    { name: 'Ambient Architecture', genre: 'Drone / Minimal Synth', bpm: 68, description: 'Zero-vocal atmospheric synth textures for system design and deep proofs' },
    { name: 'Binaural 40Hz Gamma Flow', genre: 'Neuro-Acoustic Focus', bpm: 60, description: '40Hz gamma-entrainment ambient layers for high-working-memory tasks' },
    { name: 'Baroque String Focus', genre: 'Chamber Classical', bpm: 72, description: 'Structured contrapuntal strings for mathematical modeling and LLD drafting' }
  ],
  FAST_EXECUTION: [
    { name: 'Deep Focus Synthwave', genre: 'Instrumental Synthwave', bpm: 118, description: 'High-momentum arpeggiated synthwave for rapid coding and test sprints' },
    { name: 'Lo-Fi Coding Beats', genre: 'Instrumental Boom-Bap', bpm: 88, description: 'Steady head-nodding instrumental grooves for implementation and debugging' },
    { name: 'Post-Rock Instrumental', genre: 'Cinematic Guitar/Drums', bpm: 105, description: 'Driving instrumental crescendos for clearing backlog tasks' }
  ],
  READING_RESEARCH: [
    { name: 'Modern Piano Minimalism', genre: 'Felt Piano / Neo-Classical', bpm: 64, description: 'Soft felt piano motifs that leave verbal working memory uncrowded while reading papers' },
    { name: 'Ambient Architecture', genre: 'Drone / Minimal Synth', bpm: 68, description: 'Low-transient ambient beds for documentation and technical synthesis' }
  ],
  ADMIN_COMMS: [
    { name: 'Acoustic Morning Briefing', genre: 'Warm Acoustic / Jazz Trio', bpm: 96, description: 'Light upbeat instrumental jazz for triaging mail, calendar, and reminders' },
    { name: 'Lo-Fi Coding Beats', genre: 'Instrumental Boom-Bap', bpm: 88, description: 'Relaxed rhythm for planning and status updates' }
  ],
  RECOVERY_BREAK: [
    { name: 'Restorative Alpha Waves', genre: '8-12Hz Acoustic Nature', bpm: 56, description: 'Parasympathetic recovery soundscape after a 90-minute ultradian sprint' },
    { name: 'Acoustic Morning Briefing', genre: 'Warm Acoustic / Jazz Trio', bpm: 96, description: 'Easy decompression music between deep focus blocks' }
  ]
});

export const SEED_CURRICULUM_CATALOG = Object.freeze([
  {
    topicName: 'Swift Strict Concurrency & Sendable Actors',
    category: 'swift_macos',
    difficulty: 6.2,
    stabilityDays: 3.5,
    urgencyWeight: 0.88,
    keywords: ['sendable', 'actor', 'mainactor', 'taskgroup', 'continuation', 'swift concurrency', 'data race'],
    recommendedResource: 'Swift Evolution SE-0302 & SE-0306: Actors and @Sendable closures in macOS system daemons',
    microChallenge: 'Refactor a callback-based EventKit or Process API into a cancellation-safe `withThrowingTaskGroup` actor method with a strict timeout.'
  },
  {
    topicName: 'Contextual Bandits: Disjoint LinUCB & Sherman-Morrison Updates',
    category: 'ml_math',
    difficulty: 6.8,
    stabilityDays: 2.8,
    urgencyWeight: 0.92,
    keywords: ['linucb', 'bandit', 'thompson sampling', 'sherman-morrison', 'ridge regression', 'ucb', 'exploration'],
    recommendedResource: 'Li et al. (WWW 2010): A Contextual-Bandit Approach to Personalized News Article Recommendation',
    microChallenge: 'Derive the O(d^2) Sherman-Morrison rank-1 inverse update for A_a^{-1} when observing a 16-dim context vector x_t.'
  },
  {
    topicName: 'FSRS-4.5 Power-Law Forgetting Curves & Memory Stability',
    category: 'ml_math',
    difficulty: 5.8,
    stabilityDays: 4.0,
    urgencyWeight: 0.85,
    keywords: ['fsrs', 'spaced repetition', 'retrievability', 'forgetting curve', 'stability', 'memory decay'],
    recommendedResource: 'FSRS-4.5 Algorithm Specification: DSR (Difficulty, Stability, Retrievability) Memory Model',
    microChallenge: 'Compute the exact interval delta_t where retrievability R(t) = (1 + 19/81 * dt / S)^(-0.5) drops to 90%.'
  },
  {
    topicName: 'CoreAudio Voice Processing IO & Acoustic Echo Cancellation',
    category: 'systems',
    difficulty: 7.1,
    stabilityDays: 2.5,
    urgencyWeight: 0.86,
    keywords: ['coreaudio', 'voiceprocessingio', 'echo cancellation', 'aec', 'barge-in', 'vad', 'avspeechsynthesizer'],
    recommendedResource: 'Apple AudioUnit VoiceProcessingIO & Half-Duplex Barge-In Gate Architecture',
    microChallenge: 'Explain why hardware AEC must be paired with lexical echo-overlap suppression when full-duplex TTS plays through MacBook speakers.'
  },
  {
    topicName: 'SQLite WAL Concurrency, Busy Timeouts & Idempotent Receipts',
    category: 'distributed_db',
    difficulty: 5.4,
    stabilityDays: 5.0,
    urgencyWeight: 0.80,
    keywords: ['sqlite', 'wal', 'busy_timeout', 'idempotency', 'begin immediate', 'vacuum into', 'fts5'],
    recommendedResource: 'SQLite Write-Ahead Logging (WAL) & Deterministic Idempotency Key Architecture',
    microChallenge: 'Trace how `BEGIN IMMEDIATE` prevents `SQLITE_BUSY` deadlocks between concurrent reader/writer transactions.'
  },
  {
    topicName: 'Apple AppIntents, AppShortcutsProvider & EventKit Bridge',
    category: 'swift_macos',
    difficulty: 5.5,
    stabilityDays: 4.2,
    urgencyWeight: 0.83,
    keywords: ['appintents', 'appshortcutsprovider', 'siri', 'eventkit', 'ekeventstore', 'osascript', 'axuielement'],
    recommendedResource: 'Apple App Intents Framework & Spotlight/Siri Action Delegation Guide',
    microChallenge: 'Design an `AppIntent` that delegates a Siri voice trigger into KST’s local HTTP loop while preserving confirmation gates.'
  }
]);

/**
 * Deterministic 512-dim float32 embedding generator (used as fast local fallback
 * when NaturalLanguage.NLEmbedding is not invoked over IPC, or blended with NLEmbedding).
 */
export function computeLocalEmbedding512(text) {
  const vec = new Float32Array(512);
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_+#.\s-]/g, ' ')
    .trim();
  if (!norm) return vec;

  const words = norm.split(/\s+/).filter(Boolean);
  for (let wIdx = 0; wIdx < words.length; wIdx++) {
    const word = `^${words[wIdx]}$`;
    const weight = 1.0 / Math.sqrt(1 + wIdx * 0.15);
    const hWord = fnv1a(word);
    const slotW = hWord % 512;
    vec[slotW] += ((hWord & 1) === 0 ? 1 : -1) * weight * 1.5;

    for (let i = 0; i <= word.length - 3; i++) {
      const trigram = word.slice(i, i + 3);
      const h = fnv1a(trigram);
      const idx1 = h % 512;
      const idx2 = ((h >>> 9) ^ (Math.imul(h, 2654435761) >>> 0)) % 512;
      const sign1 = (h & 1) === 0 ? 1 : -1;
      const sign2 = (h & 2) === 0 ? 1 : -1;
      vec[idx1] += sign1 * weight;
      vec[idx2] += sign2 * 0.5 * weight;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < 512; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < 512; i++) vec[i] /= mag;
  return vec;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function cosineSimilarity512(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-9 ? dot / denom : 0;
}

export function serializeFloat32Vector(vec) {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function deserializeFloat32Vector(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.byteLength < 4) return null;
  const aligned = new Uint8Array(buf.byteLength);
  aligned.set(buf);
  return new Float32Array(aligned.buffer);
}

/**
 * Infers the user's current cognitive work mode from active desktop signals.
 */
export function inferCognitiveWorkMode(signals = {}) {
  if (signals.explicitMode && WORK_MODES.includes(signals.explicitMode)) {
    return signals.explicitMode;
  }
  if (signals.idleSeconds > 300 || signals.onBreak) {
    return 'RECOVERY_BREAK';
  }
  const app = String(signals.frontmostApp || '').toLowerCase();
  const title = String(signals.windowTitle || '').toLowerCase();
  const url = String(signals.activeUrl || '').toLowerCase();

  if (/\b(?:mail|messages|slack|discord|calendar|reminders)\b/.test(app)) {
    return 'ADMIN_COMMS';
  }
  if (/\b(?:design|lld|architecture|rfc|spec|diagram|schema|whitepaper|math|proof)\b/.test(title)) {
    return 'DEEP_ARCHITECTURE';
  }
  if (/\b(?:iterm2?|terminal|xcode|cursor|code|zed|neovim|vim)\b/.test(app)) {
    if (/\b(?:design|architecture|model|migration)\b/.test(title)) {
      return 'DEEP_ARCHITECTURE';
    }
    return 'FAST_EXECUTION';
  }
  if (/\b(?:safari|chrome|arc|preview|books|obsidian|notes)\b/.test(app) || /\b(?:arxiv|docs|documentation|github\.com\/.*\/pull|gemini\.google|chatgpt\.com|claude\.ai)\b/.test(url + ' ' + title)) {
    return 'READING_RESEARCH';
  }
  return 'DEEP_ARCHITECTURE';
}

/**
 * Builds the 16-dimensional context vector x_t in R^16 for the LinUCB Bandit
 * and computes the analytical Interruptibility Score I(t) in [0, 1].
 */
export function buildContextVector16(signals = {}, nowMs = Date.now()) {
  const d = new Date(nowMs);
  const hourFloat = d.getHours() + d.getMinutes() / 60;
  const angle = (2 * Math.PI * hourFloat) / 24;
  const sinHour = Math.sin(angle);
  const cosHour = Math.cos(angle);

  const activeMinutes = Math.max(0, Number(signals.activeMinutes ?? 25));
  const ultradianPhase = (activeMinutes % 90) / 90;
  const ultradianEndProximity = Math.exp(-Math.pow((ultradianPhase - 0.92) / 0.15, 2));

  const appSwitchCount5m = Math.min(20, Math.max(0, Number(signals.appSwitchesLast5m ?? 2)));
  const appSwitchRateNorm = appSwitchCount5m / 20;
  const justSwitchedApp = signals.secondsSinceAppSwitch != null && signals.secondsSinceAppSwitch <= 15 ? 1.0 : 0.0;

  const minsToNextMeeting = Math.max(0, Number(signals.minutesToNextMeeting ?? 120));
  const meetingProximity = Math.exp(-minsToNextMeeting / 30);

  const overdueTaskUrgency = Math.min(1.0, Math.max(0, Number(signals.overdueTaskUrgency ?? 0.35)));
  const terminalJustExited = signals.terminalJustExited ? 1.0 : 0.0;
  const musicPlaying = signals.musicPlaying ? 1.0 : 0.0;
  const inMeeting = signals.inMeeting ? 1.0 : 0.0;

  const mode = inferCognitiveWorkMode(signals);
  const isDeepArch = mode === 'DEEP_ARCHITECTURE' ? 1.0 : 0.0;
  const isFastExec = mode === 'FAST_EXECUTION' ? 1.0 : 0.0;
  const isReading = mode === 'READING_RESEARCH' ? 1.0 : 0.0;
  const isAdmin = mode === 'ADMIN_COMMS' ? 1.0 : 0.0;
  const isBreak = mode === 'RECOVERY_BREAK' ? 1.0 : 0.0;

  const vector = [
    1.0,                    // 0: bias
    sinHour,                // 1: circadian sin
    cosHour,                // 2: circadian cos
    ultradianPhase,         // 3: ultradian progress [0, 1]
    ultradianEndProximity,  // 4: ultradian 90-min boundary peak
    appSwitchRateNorm,      // 5: app switch frequency
    justSwitchedApp,        // 6: natural task-boundary indicator
    meetingProximity,       // 7: exp(-minsToMeeting / 30)
    overdueTaskUrgency,     // 8: task/deadline pressure
    terminalJustExited,     // 9: build/test completion boundary
    musicPlaying,           // 10: audio focus state
    isDeepArch,             // 11: mode one-hot 1
    isFastExec,             // 12: mode one-hot 2
    isReading,              // 13: mode one-hot 3
    isAdmin,                // 14: mode one-hot 4
    isBreak                 // 15: mode one-hot 5
  ];

  let rawLogit =
    -0.85 * isDeepArch -
    0.45 * isFastExec +
    0.15 * isReading +
    0.75 * isAdmin +
    1.10 * isBreak +
    0.95 * justSwitchedApp +
    0.85 * terminalJustExited +
    0.70 * ultradianEndProximity +
    0.65 * meetingProximity +
    0.50 * appSwitchRateNorm -
    2.50 * inMeeting;

  const interruptibility = Number((1 / (1 + Math.exp(-rawLogit))).toFixed(4));

  return {
    mode,
    vector,
    interruptibility,
    diagnostics: {
      hourFloat: Number(hourFloat.toFixed(2)),
      ultradianPhase: Number(ultradianPhase.toFixed(2)),
      meetingProximity: Number(meetingProximity.toFixed(2)),
      justSwitchedApp: Boolean(justSwitchedApp),
      terminalJustExited: Boolean(terminalJustExited)
    }
  };
}

/**
 * Disjoint LinUCB Contextual Bandit ($d = 16$) with exact Sherman-Morrison $O(d^2)$ inverse updates.
 */
export class LinUCBNudgeBandit {
  constructor(db, { alpha = 0.65, dimension = 16, now = Date.now } = {}) {
    this.db = db;
    this.alpha = alpha;
    this.dimension = dimension;
    this.now = now;
    this.banditId = 'nudge_linucb_v1';
    this._ensureArms();
  }

  _identityMatrix(d) {
    const mat = new Array(d * d).fill(0);
    for (let i = 0; i < d; i++) mat[i * d + i] = 1.0;
    return mat;
  }

  _defaultBiasForArm(arm) {
    const b = new Array(this.dimension).fill(0);
    if (arm === 'DELIVER_NOW') {
      b[6] = 0.45;  // justSwitchedApp
      b[7] = 0.40;  // meetingProximity
      b[9] = 0.50;  // terminalJustExited
      b[14] = 0.35; // ADMIN_COMMS
    } else if (arm === 'WAIT_FOR_APP_SWITCH') {
      b[11] = 0.45; // DEEP_ARCHITECTURE
      b[12] = 0.40; // FAST_EXECUTION
    } else if (arm === 'DEFER_30M') {
      b[11] = 0.30;
      b[10] = 0.25; // musicPlaying
    } else if (arm === 'SILENCE') {
      b[0] = -0.15;
    }
    return b;
  }

  _ensureArms() {
    const ts = this.now();
    for (const arm of NUDGE_ARMS) {
      const fullId = `${this.banditId}::${arm}`;
      const row = this.db
        .prepare('SELECT state_json FROM personal_bandits WHERE bandit_id=? AND arm_name=?')
        .get(fullId, arm);
      if (!row) {
        const initState = {
          AInv: this._identityMatrix(this.dimension),
          b: this._defaultBiasForArm(arm)
        };
        this.db
          .prepare(
            'INSERT INTO personal_bandits(bandit_id, arm_name, dimension, state_json, pulls, cumulative_reward, updated_ts) VALUES(?,?,16,?,0,0.0,?)'
          )
          .run(fullId, arm, JSON.stringify(initState), ts);
      }
    }
  }

  _loadArm(arm) {
    const row = this.db
      .prepare('SELECT * FROM personal_bandits WHERE bandit_id=? AND arm_name=?')
      .get(`${this.banditId}::${arm}`, arm);
    if (!row) {
      return {
        AInv: this._identityMatrix(this.dimension),
        b: this._defaultBiasForArm(arm),
        pulls: 0,
        cumulativeReward: 0
      };
    }
    const parsed = JSON.parse(row.state_json || '{}');
    return {
      AInv: Array.isArray(parsed.AInv) && parsed.AInv.length === this.dimension * this.dimension
        ? parsed.AInv
        : this._identityMatrix(this.dimension),
      b: Array.isArray(parsed.b) && parsed.b.length === this.dimension
        ? parsed.b
        : this._defaultBiasForArm(arm),
      pulls: row.pulls || 0,
      cumulativeReward: row.cumulative_reward || 0
    };
  }

  decide(signals = {}) {
    const ctx = buildContextVector16(signals, this.now());
    const x = ctx.vector;
    const d = this.dimension;
    const evaluations = [];

    for (const arm of NUDGE_ARMS) {
      const state = this._loadArm(arm);
      const { AInv, b } = state;

      const theta = new Array(d).fill(0);
      const AInvX = new Array(d).fill(0);
      for (let i = 0; i < d; i++) {
        let sumB = 0;
        let sumX = 0;
        const rowOffset = i * d;
        for (let j = 0; j < d; j++) {
          const aij = AInv[rowOffset + j];
          sumB += aij * b[j];
          sumX += aij * x[j];
        }
        theta[i] = sumB;
        AInvX[i] = sumX;
      }

      let expectedReward = 0;
      let quadForm = 0;
      for (let i = 0; i < d; i++) {
        expectedReward += theta[i] * x[i];
        quadForm += x[i] * AInvX[i];
      }
      const uncertainty = this.alpha * Math.sqrt(Math.max(0, quadForm));
      const ucbScore = expectedReward + uncertainty;

      evaluations.push({
        arm,
        ucbScore: Number(ucbScore.toFixed(4)),
        expectedReward: Number(expectedReward.toFixed(4)),
        uncertainty: Number(uncertainty.toFixed(4)),
        pulls: state.pulls,
        cumulativeReward: Number(state.cumulativeReward.toFixed(2))
      });
    }

    evaluations.sort((a, b) => b.ucbScore - a.ucbScore);
    const chosen = evaluations[0];
    return {
      selectedArm: chosen.arm,
      interruptibility: ctx.interruptibility,
      workMode: ctx.mode,
      diagnostics: ctx.diagnostics,
      rankings: evaluations,
      contextVector: x
    };
  }

  update(arm, contextVector, reward) {
    if (!NUDGE_ARMS.includes(arm)) {
      throw new Error(`Unknown LinUCB arm: ${arm}`);
    }
    const d = this.dimension;
    const x = Array.isArray(contextVector) && contextVector.length === d
      ? contextVector
      : buildContextVector16({}, this.now()).vector;
    const r = Math.max(-1.5, Math.min(1.5, Number(reward ?? 0)));

    const state = this._loadArm(arm);
    const { AInv, b } = state;

    const z = new Array(d).fill(0);
    for (let i = 0; i < d; i++) {
      let sum = 0;
      const rowOffset = i * d;
      for (let j = 0; j < d; j++) {
        sum += AInv[rowOffset + j] * x[j];
      }
      z[i] = sum;
    }

    let denom = 1.0;
    for (let i = 0; i < d; i++) denom += x[i] * z[i];
    if (denom < 1e-9) denom = 1e-9;

    const nextAInv = new Array(d * d);
    for (let i = 0; i < d; i++) {
      const rowOffset = i * d;
      for (let j = 0; j < d; j++) {
        nextAInv[rowOffset + j] = AInv[rowOffset + j] - (z[i] * z[j]) / denom;
      }
    }

    const nextB = b.map((val, idx) => val + r * x[idx]);
    const nextPulls = state.pulls + 1;
    const nextCumReward = state.cumulativeReward + r;

    this.db
      .prepare(
        'UPDATE personal_bandits SET state_json=?, pulls=?, cumulative_reward=?, updated_ts=? WHERE bandit_id=? AND arm_name=?'
      )
      .run(
        JSON.stringify({ AInv: nextAInv, b: nextB }),
        nextPulls,
        nextCumReward,
        this.now(),
        `${this.banditId}::${arm}`,
        arm
      );

    return {
      arm,
      pulls: nextPulls,
      cumulativeReward: Number(nextCumReward.toFixed(3)),
      lastReward: r
    };
  }

  summary() {
    return NUDGE_ARMS.map((arm) => {
      const s = this._loadArm(arm);
      return {
        arm,
        pulls: s.pulls,
        cumulativeReward: Number(s.cumulativeReward.toFixed(2)),
        meanReward: s.pulls > 0 ? Number((s.cumulativeReward / s.pulls).toFixed(3)) : 0
      };
    });
  }
}

/**
 * Contextual Thompson Sampling Bandit for Personal Acoustic / Music Flow State Selection.
 */
export class MusicFlowBandit {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    this.prefix = 'music_thompson_v1';
    this._seedDefaultArms();
  }

  _seedDefaultArms() {
    const ts = this.now();
    for (const [mode, playlists] of Object.entries(DEFAULT_MODE_PLAYLISTS)) {
      playlists.forEach((pl, idx) => {
        const armKey = `${mode}::${pl.name}`;
        const banditId = `${this.prefix}::${armKey}`;
        const existing = this.db
          .prepare('SELECT bandit_id FROM personal_bandits WHERE bandit_id=?')
          .get(banditId);
        if (!existing) {
          const initAlpha = idx === 0 ? 3.2 : idx === 1 ? 2.6 : 2.2;
          const initBeta = 1.2;
          const state = {
            mode,
            playlist: pl.name,
            genre: pl.genre,
            bpm: pl.bpm,
            description: pl.description,
            alpha: initAlpha,
            beta: initBeta
          };
          this.db
            .prepare(
              'INSERT INTO personal_bandits(bandit_id, arm_name, dimension, state_json, pulls, cumulative_reward, updated_ts) VALUES(?,?,2,?,0,0.0,?)'
            )
            .run(banditId, armKey, JSON.stringify(state), ts);
        }
      });
    }
  }

  _sampleStandardNormal() {
    const u1 = Math.max(1e-7, Math.random());
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  _sampleGamma(shape) {
    if (shape < 1) {
      return this._sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let iter = 0; iter < 64; iter++) {
      let x = this._sampleStandardNormal();
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return shape;
  }

  _sampleBeta(alpha, beta) {
    const x = this._sampleGamma(Math.max(0.1, alpha));
    const y = this._sampleGamma(Math.max(0.1, beta));
    return x / Math.max(1e-9, x + y);
  }

  recommend({ mode = 'DEEP_ARCHITECTURE', deterministic = false } = {}) {
    const targetMode = WORK_MODES.includes(mode) ? mode : 'DEEP_ARCHITECTURE';
    const rows = this.db
      .prepare('SELECT * FROM personal_bandits WHERE bandit_id LIKE ?')
      .all(`${this.prefix}::${targetMode}::%`);

    const candidates = rows.map((row) => {
      const state = JSON.parse(row.state_json);
      const posteriorMean = state.alpha / (state.alpha + state.beta);
      const thompsonSample = deterministic
        ? posteriorMean
        : this._sampleBeta(state.alpha, state.beta);
      return {
        armKey: row.arm_name,
        mode: state.mode,
        playlist: state.playlist,
        genre: state.genre,
        bpm: state.bpm,
        description: state.description,
        alpha: Number(state.alpha.toFixed(2)),
        beta: Number(state.beta.toFixed(2)),
        posteriorMean: Number(posteriorMean.toFixed(3)),
        thompsonSample: Number(thompsonSample.toFixed(3)),
        pulls: row.pulls
      };
    });

    candidates.sort((a, b) => b.thompsonSample - a.thompsonSample || b.posteriorMean - a.posteriorMean);
    const top = candidates[0] || {
      mode: targetMode,
      playlist: 'Ambient Architecture',
      genre: 'Drone / Minimal Synth',
      bpm: 68,
      description: 'Zero-vocal atmospheric synth textures for system design',
      posteriorMean: 0.75,
      thompsonSample: 0.78,
      pulls: 0
    };

    return {
      mode: targetMode,
      recommendedPlaylist: top.playlist,
      genre: top.genre,
      bpm: top.bpm,
      description: top.description,
      posteriorConfidence: Math.round(top.posteriorMean * 100),
      thompsonSample: top.thompsonSample,
      alternatives: candidates.slice(1, 3),
      allCandidates: candidates
    };
  }

  recordFeedback({ mode = 'DEEP_ARCHITECTURE', playlist, reward = 1.0 }) {
    const targetMode = WORK_MODES.includes(mode) ? mode : 'DEEP_ARCHITECTURE';
    let targetRow = null;
    if (playlist) {
      targetRow = this.db
        .prepare('SELECT * FROM personal_bandits WHERE bandit_id=?')
        .get(`${this.prefix}::${targetMode}::${playlist}`);
    }
    if (!targetRow) {
      targetRow = this.db
        .prepare('SELECT * FROM personal_bandits WHERE bandit_id LIKE ? ORDER BY updated_ts DESC LIMIT 1')
        .get(`${this.prefix}::${targetMode}::%`);
    }
    if (!targetRow) return null;

    const state = JSON.parse(targetRow.state_json);
    const clamped = Math.max(-1.0, Math.min(1.0, Number(reward)));
    if (clamped >= 0) {
      state.alpha += Math.max(0.2, clamped);
    } else {
      state.beta += Math.abs(clamped);
    }
    const nextPulls = targetRow.pulls + 1;
    const nextCumReward = targetRow.cumulative_reward + clamped;

    this.db
      .prepare(
        'UPDATE personal_bandits SET state_json=?, pulls=?, cumulative_reward=?, updated_ts=? WHERE bandit_id=?'
      )
      .run(JSON.stringify(state), nextPulls, nextCumReward, this.now(), targetRow.bandit_id);

    const newMean = state.alpha / (state.alpha + state.beta);
    return {
      mode: state.mode,
      playlist: state.playlist,
      pulls: nextPulls,
      posteriorConfidence: Math.round(newMean * 100),
      alpha: Number(state.alpha.toFixed(2)),
      beta: Number(state.beta.toFixed(2))
    };
  }
}

/**
 * FSRS-4.5 Spaced Repetition + Project Deadline Urgency Skill Coach.
 */
export class CurriculumCoach {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    this._seedSkills();
  }

  _seedSkills() {
    const ts = this.now();
    for (let i = 0; i < SEED_CURRICULUM_CATALOG.length; i++) {
      const item = SEED_CURRICULUM_CATALOG[i];
      const existing = this.db
        .prepare('SELECT skill_id FROM knowledge_skills WHERE lower(topic_name)=lower(?)')
        .get(item.topicName);
      if (!existing) {
        const simulatedAgeDays = 1.2 + i * 0.85;
        const practicedTs = ts - Math.round(simulatedAgeDays * DAY_MS);
        const r = this.computeRetrievability(item.stabilityDays, practicedTs, ts);
        this.db
          .prepare(`
            INSERT INTO knowledge_skills(
              skill_id, topic_name, category, stability_days, difficulty, retrievability,
              urgency_weight, error_count, practice_count, last_encountered_ts, last_practiced_ts,
              recommended_resource, micro_challenge, updated_ts
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `)
          .run(
            `skl_${createHash('sha1').update(item.topicName).digest('hex').slice(0, 10)}_${i}`,
            item.topicName,
            item.category,
            item.stabilityDays,
            item.difficulty,
            r,
            item.urgencyWeight,
            i < 2 ? 2 : 1,
            1,
            ts,
            practicedTs,
            item.recommendedResource,
            item.microChallenge,
            ts
          );
      }
    }
  }

  computeRetrievability(stabilityDays, lastPracticedTs, currentTs = this.now()) {
    const s = Math.max(0.25, Number(stabilityDays || 1.5));
    if (!lastPracticedTs) return 0.35;
    const elapsedDays = Math.max(0, (currentTs - lastPracticedTs) / DAY_MS);
    const r = Math.pow(1.0 + (19.0 / 81.0) * (elapsedDays / s), -0.5);
    return Number(Math.max(0.05, Math.min(1.0, r)).toFixed(4));
  }

  ingestSignal({ text = '', source = 'iterm', isError = false, customTopic = null } = {}) {
    const ts = this.now();
    const lower = String(text || '').toLowerCase();
    const touched = [];

    for (const seed of SEED_CURRICULUM_CATALOG) {
      if (seed.keywords.some((kw) => lower.includes(kw))) {
        const row = this.db
          .prepare('SELECT * FROM knowledge_skills WHERE lower(topic_name)=lower(?)')
          .get(seed.topicName);
        if (row) {
          const nextErrors = row.error_count + (isError ? 1 : 0);
          const nextUrgency = Math.min(1.0, row.urgency_weight + (isError ? 0.08 : 0.03));
          this.db
            .prepare(
              'UPDATE knowledge_skills SET error_count=?, urgency_weight=?, last_encountered_ts=?, updated_ts=? WHERE skill_id=?'
            )
            .run(nextErrors, nextUrgency, ts, ts, row.skill_id);
          touched.push(row.topic_name);
        }
      }
    }

    if (customTopic && String(customTopic).trim()) {
      const cleanTopic = String(customTopic).trim().slice(0, 120);
      const existing = this.db
        .prepare('SELECT * FROM knowledge_skills WHERE lower(topic_name)=lower(?)')
        .get(cleanTopic);
      if (existing) {
        this.db
          .prepare(
            'UPDATE knowledge_skills SET error_count=error_count+?, urgency_weight=MIN(1.0, urgency_weight+0.1), last_encountered_ts=?, updated_ts=? WHERE skill_id=?'
          )
          .run(isError ? 1 : 0, ts, ts, existing.skill_id);
        touched.push(existing.topic_name);
      } else {
        const skillId = `skl_${randomUUID().slice(0, 8)}`;
        this.db
          .prepare(`
            INSERT INTO knowledge_skills(
              skill_id, topic_name, category, stability_days, difficulty, retrievability,
              urgency_weight, error_count, practice_count, last_encountered_ts, last_practiced_ts,
              recommended_resource, micro_challenge, updated_ts
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `)
          .run(
            skillId,
            cleanTopic,
            source === 'iterm' ? 'debugging' : 'engineering',
            1.5,
            6.0,
            0.45,
            0.85,
            isError ? 1 : 0,
            0,
            ts,
            ts - 2 * DAY_MS,
            `Hands-on drill derived from ${source}`,
            `Write a minimal reproduction and fix verification test for ${cleanTopic}.`,
            ts
          );
        touched.push(cleanTopic);
      }
    }
    return touched;
  }

  recommend({ limit = 5, category = null } = {}) {
    const ts = this.now();
    const rows = category
      ? this.db.prepare('SELECT * FROM knowledge_skills WHERE category=?').all(category)
      : this.db.prepare('SELECT * FROM knowledge_skills').all();

    const scored = rows.map((row) => {
      const r = this.computeRetrievability(row.stability_days, row.last_practiced_ts, ts);
      const forgettingNeed = 1.0 - r;
      const errorSignal = Math.min(1.0, (row.error_count || 0) / 4.0);
      const priorityScore = Number(
        (0.45 * forgettingNeed + 0.35 * row.urgency_weight + 0.20 * errorSignal).toFixed(4)
      );
      return {
        skillId: row.skill_id,
        topicName: row.topic_name,
        category: row.category,
        stabilityDays: Number(row.stability_days.toFixed(2)),
        difficulty: Number(row.difficulty.toFixed(2)),
        retrievability: r,
        retentionPercent: Math.round(r * 100),
        urgencyWeight: Number(row.urgency_weight.toFixed(2)),
        errorCount: row.error_count,
        practiceCount: row.practice_count,
        priorityScore,
        recommendedResource: row.recommended_resource,
        microChallenge: row.micro_challenge
      };
    });

    scored.sort((a, b) => b.priorityScore - a.priorityScore);
    return {
      topRecommendation: scored[0] || null,
      curriculum: scored.slice(0, limit)
    };
  }

  recordPractice({ topicOrId, grade = 3 } = {}) {
    const ts = this.now();
    const g = Math.max(1, Math.min(4, Number(grade || 3)));
    const q = String(topicOrId || '').trim().toLowerCase();

    let row = null;
    if (q) {
      row = this.db
        .prepare(
          'SELECT * FROM knowledge_skills WHERE lower(skill_id)=? OR lower(topic_name)=? OR lower(topic_name) LIKE ? ORDER BY updated_ts DESC LIMIT 1'
        )
        .get(q, q, `%${q}%`);
    }
    if (!row) {
      const top = this.recommend({ limit: 1 }).topRecommendation;
      if (top) {
        row = this.db.prepare('SELECT * FROM knowledge_skills WHERE skill_id=?').get(top.skillId);
      }
    }
    if (!row) return null;

    const r = this.computeRetrievability(row.stability_days, row.last_practiced_ts, ts);
    const nextDifficulty = Math.max(1.0, Math.min(10.0, row.difficulty - 0.65 * (g - 3)));

    let nextStability;
    if (g === 1) {
      nextStability = Math.max(0.5, row.stability_days * 0.45);
    } else {
      const hardPenalty = g === 2 ? 0.85 : 1.0;
      const easyBonus = g === 4 ? 1.35 : 1.0;
      const growth =
        1.0 +
        Math.exp(1.1) *
          (11.0 - nextDifficulty) *
          Math.pow(row.stability_days, -0.2) *
          (Math.exp((1.0 - r) * 0.9) - 1.0) *
          hardPenalty *
          easyBonus;
      nextStability = Math.min(365, row.stability_days * Math.max(1.25, growth));
    }

    const prevStability = Number(row.stability_days);
    const prevPracticeCount = Number(row.practice_count || 0);
    this.db
      .prepare(`
        UPDATE knowledge_skills
        SET stability_days=?, difficulty=?, retrievability=1.0, practice_count=practice_count+1,
            error_count=MAX(0, error_count-1), last_practiced_ts=?, updated_ts=?
        WHERE skill_id=?
      `)
      .run(nextStability, nextDifficulty, ts, ts, row.skill_id);

    return {
      skillId: row.skill_id,
      topicName: row.topic_name,
      previousStabilityDays: Number(prevStability.toFixed(2)),
      newStabilityDays: Number(nextStability.toFixed(2)),
      newDifficulty: Number(nextDifficulty.toFixed(2)),
      retrievability: 1.0,
      practiceCount: prevPracticeCount + 1
    };
  }
}

/**
 * Durable Work Graph Engine with Provenance, Freshness, Typed Edges, and 512-dim Hybrid Vector Search.
 */
export class WorkGraphEngine {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }

  upsertEntity({
    entityId = null,
    entityType = 'TASK',
    title,
    bodySummary = '',
    status = 'ACTIVE',
    priorityScore = 0.6,
    sourceDomain = 'workspace',
    sourceUri = '',
    confidence = 1.0,
    embedding = null,
    metadata = {}
  }) {
    const cleanTitle = String(title || 'Untitled').trim().slice(0, 400);
    const cleanBody = String(bodySummary || '').trim().slice(0, 4000);
    const ts = this.now();

    let existing = null;
    if (entityId) {
      existing = this.db.prepare('SELECT * FROM work_entities WHERE entity_id=?').get(entityId);
    } else {
      existing = this.db
        .prepare('SELECT * FROM work_entities WHERE entity_type=? AND lower(title)=lower(?) LIMIT 1')
        .get(entityType, cleanTitle);
    }

    const vec = embedding instanceof Float32Array
      ? embedding
      : computeLocalEmbedding512(`${cleanTitle} ${cleanBody}`);
    const blob = serializeFloat32Vector(vec);
    const finalId = existing?.entity_id || entityId || `ent_${randomUUID().slice(0, 10)}`;

    if (existing) {
      this.db
        .prepare(`
          UPDATE work_entities
          SET title=?, body_summary=?, status=?, priority_score=?, source_domain=?, source_uri=?,
              updated_ts=?, last_verified_ts=?, confidence=?, embedding_f16=?, metadata_json=?
          WHERE entity_id=?
        `)
        .run(
          cleanTitle,
          cleanBody || existing.body_summary,
          status,
          priorityScore,
          sourceDomain,
          sourceUri || existing.source_uri,
          ts,
          ts,
          confidence,
          blob,
          JSON.stringify({ ...JSON.parse(existing.metadata_json || '{}'), ...metadata }),
          finalId
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO work_entities(
            entity_id, entity_type, title, body_summary, status, priority_score,
            source_domain, source_uri, created_ts, updated_ts, last_verified_ts,
            confidence, embedding_f16, metadata_json
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        .run(
          finalId,
          entityType,
          cleanTitle,
          cleanBody,
          status,
          priorityScore,
          sourceDomain,
          sourceUri,
          ts,
          ts,
          ts,
          confidence,
          blob,
          JSON.stringify(metadata)
        );
    }

    return {
      entityId: finalId,
      entityType,
      title: cleanTitle,
      status,
      sourceDomain,
      sourceUri,
      lastVerifiedAt: new Date(ts).toISOString()
    };
  }

  linkEntities({ srcId, dstId, relationType = 'PART_OF', weight = 1.0 }) {
    if (!srcId || !dstId || srcId === dstId) return null;
    const edgeId = `edg_${createHash('sha1').update(`${srcId}:${relationType}:${dstId}`).digest('hex').slice(0, 12)}`;
    const ts = this.now();
    this.db
      .prepare(`
        INSERT OR REPLACE INTO work_edges(edge_id, src_id, dst_id, relation_type, weight, created_ts)
        VALUES (?,?,?,?,?,?)
      `)
      .run(edgeId, srcId, dstId, relationType, weight, ts);
    return { edgeId, srcId, dstId, relationType };
  }

  search(query, { limit = 8, entityTypes = null, queryEmbedding = null } = {}) {
    const q = String(query || '').trim();
    const qVec = queryEmbedding instanceof Float32Array
      ? queryEmbedding
      : computeLocalEmbedding512(q);
    const qTokens = new Set(q.toLowerCase().match(/[a-z0-9_+#.-]+/g) ?? []);

    const rows = this.db
      .prepare("SELECT * FROM work_entities WHERE status != 'ARCHIVED' ORDER BY updated_ts DESC LIMIT 250")
      .all();
    const ts = this.now();

    const scored = rows
      .filter((r) => !entityTypes || entityTypes.includes(r.entity_type))
      .map((r) => {
        const vec = deserializeFloat32Vector(r.embedding_f16);
        const semSim = vec ? Math.max(0, cosineSimilarity512(qVec, vec)) : 0;
        const text = `${r.title} ${r.body_summary}`.toLowerCase();
        let tokenHits = 0;
        for (const t of qTokens) {
          if (text.includes(t)) tokenHits++;
        }
        const lexScore = qTokens.size > 0 ? tokenHits / qTokens.size : 0.5;
        const ageHours = Math.max(0, (ts - r.updated_ts) / 3_600_000);
        const recencyBoost = Math.exp(-ageHours / (24 * 14));
        const hybridScore = Number(
          (0.50 * semSim + 0.30 * lexScore + 0.12 * r.priority_score + 0.08 * recencyBoost).toFixed(4)
        );
        return {
          entityId: r.entity_id,
          entityType: r.entity_type,
          title: r.title,
          bodySummary: r.body_summary,
          status: r.status,
          priorityScore: r.priority_score,
          sourceDomain: r.source_domain,
          sourceUri: r.source_uri,
          lastVerifiedAt: new Date(r.last_verified_ts).toISOString(),
          confidence: r.confidence,
          hybridScore,
          metadata: JSON.parse(r.metadata_json || '{}')
        };
      });

    scored.sort((a, b) => b.hybridScore - a.hybridScore);
    return scored.slice(0, limit);
  }

  syncFromWorkspaceSnapshot(snap = {}) {
    let count = 0;
    for (const t of (snap.tasks || []).slice(0, 30)) {
      this.upsertEntity({
        entityId: `task:${t.id}`,
        entityType: 'TASK',
        title: t.title,
        bodySummary: t.project ? `Project: ${t.project}` : '',
        status: t.status === 'done' ? 'COMPLETED' : 'ACTIVE',
        priorityScore: t.priority === 1 ? 0.9 : 0.65,
        sourceDomain: 'workspace',
        sourceUri: `kst://tasks/${t.id}`
      });
      count++;
    }
    for (const n of (snap.notes || []).slice(0, 20)) {
      this.upsertEntity({
        entityId: `note:${n.id}`,
        entityType: 'NOTE',
        title: n.title,
        bodySummary: n.body || '',
        status: 'ACTIVE',
        priorityScore: 0.55,
        sourceDomain: 'notes',
        sourceUri: `kst://notes/${n.id}`
      });
      count++;
    }
    for (const e of (snap.calendar || []).slice(0, 20)) {
      this.upsertEntity({
        entityId: `meeting:${e.id}`,
        entityType: 'MEETING',
        title: e.title,
        bodySummary: `${e.startAt || ''} - ${e.endAt || ''}`,
        status: 'ACTIVE',
        priorityScore: 0.75,
        sourceDomain: 'calendar',
        sourceUri: `kst://events/${e.id}`
      });
      count++;
    }
    return count;
  }

  buildCompanionPromptPacket({
    targetApp = 'Gemini',
    topicQuery = '',
    terminalContext = null,
    safariContext = null,
    gitBranch = '',
    topSkill = null
  } = {}) {
    const relevantEntities = this.search(topicQuery || terminalContext?.errorSnippet || 'active task', { limit: 5 });
    const activeTasks = relevantEntities.filter((e) => e.entityType === 'TASK' || e.entityType === 'TERMINAL_ERROR');
    const primaryTask = activeTasks[0]?.title || topicQuery || 'Active Engineering Task';
    const branch = gitBranch || terminalContext?.gitBranch || 'main';
    const errorTail = terminalContext?.errorSnippet || terminalContext?.tailText || '';
    const safariRef = safariContext?.url ? `${safariContext.title} (${safariContext.url})` : '';

    const xmlLines = [
      `<kst_work_context generated_by="KST Raphael v0.8" target_companion="${targetApp}">`,
      `  <active_objective>${primaryTask}</active_objective>`,
      `  <git_branch>${branch}</git_branch>`
    ];
    if (errorTail) {
      xmlLines.push(`  <terminal_failure_tail><![CDATA[\n${errorTail.slice(-1200)}\n  ]]></terminal_failure_tail>`);
    }
    if (safariRef) {
      xmlLines.push(`  <active_reference_tab>${safariRef}</active_reference_tab>`);
    }
    if (relevantEntities.length > 0) {
      xmlLines.push('  <provenance_work_graph>');
      for (const ent of relevantEntities.slice(0, 4)) {
        xmlLines.push(
          `    <entity type="${ent.entityType}" status="${ent.status}" source="${ent.sourceDomain}" verified="${ent.lastVerifiedAt}">${ent.title}</entity>`
        );
      }
      xmlLines.push('  </provenance_work_graph>');
    }
    if (topSkill) {
      xmlLines.push(
        `  <learning_focus topic="${topSkill.topicName}" retention="${topSkill.retentionPercent}%" />`
      );
    }
    xmlLines.push(
      `  <instruction>Analyze the objective${errorTail ? ' and terminal failure' : ''} above. Propose a minimal, root-cause fix and list concrete verification steps.</instruction>`,
      `</kst_work_context>`
    );

    return {
      targetApp,
      primaryTask,
      gitBranch: branch,
      promptText: xmlLines.join('\n'),
      entitiesIncluded: relevantEntities.length
    };
  }

  extractAndStoreActionItems({ transcript = '', sourceDomain = 'gemini_web', sourceUri = '', title = 'AI Co-Pilot Thread' } = {}) {
    const raw = String(transcript || '').trim();
    if (!raw) return [];

    const threadEntity = this.upsertEntity({
      entityType: 'AI_THREAD',
      title: title || 'Companion AI Session',
      bodySummary: raw.slice(0, 1200),
      status: 'ACTIVE',
      priorityScore: 0.7,
      sourceDomain,
      sourceUri
    });

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const extracted = [];

    for (const line of lines) {
      let match =
        line.match(/^(?:[-*•]|\d+[.)])\s*(?:\[[ xX]?\]\s*)?(?:TODO|ACTION|TASK|FIX|NEXT|STEP)?[:\s-]*(.+)$/i) ||
        line.match(/^(?:TODO|Action Item|Next Step|Task)\s*:\s*(.+)$/i);
      if (match) {
        const candidate = match[1]
          .replace(/\*\*/g, '')
          .replace(/`+/g, '')
          .trim();
        if (candidate.length >= 6 && candidate.length <= 180 && !candidate.endsWith('?')) {
          const taskEnt = this.upsertEntity({
            entityType: 'TASK',
            title: candidate,
            bodySummary: `Captured from ${sourceDomain} (${title})`,
            status: 'ACTIVE',
            priorityScore: 0.78,
            sourceDomain,
            sourceUri
          });
          this.linkEntities({
            srcId: taskEnt.entityId,
            dstId: threadEntity.entityId,
            relationType: 'DERIVED_FROM'
          });
          extracted.push(taskEnt);
          if (extracted.length >= 5) break;
        }
      }
    }

    if (extracted.length === 0) {
      const sentences = raw.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        const clean = s.trim().replace(/[.!?]+$/, '');
        if (/^(?:Implement|Fix|Add|Update|Verify|Refactor|Run|Create|Test|Check)\s+\w+/i.test(clean) && clean.length <= 140) {
          const taskEnt = this.upsertEntity({
            entityType: 'TASK',
            title: clean,
            bodySummary: `Captured from ${sourceDomain}`,
            status: 'ACTIVE',
            priorityScore: 0.75,
            sourceDomain,
            sourceUri
          });
          this.linkEntities({
            srcId: taskEnt.entityId,
            dstId: threadEntity.entityId,
            relationType: 'DERIVED_FROM'
          });
          extracted.push(taskEnt);
          if (extracted.length >= 3) break;
        }
      }
    }

    return extracted;
  }

  stats() {
    const counts = this.db
      .prepare('SELECT entity_type, COUNT(*) as count FROM work_entities GROUP BY entity_type')
      .all();
    const edgeCount = this.db.prepare('SELECT COUNT(*) as count FROM work_edges').get()?.count ?? 0;
    const recent = this.db
      .prepare('SELECT entity_id, entity_type, title, status, source_domain, source_uri, last_verified_ts FROM work_entities ORDER BY updated_ts DESC LIMIT 12')
      .all()
      .map((r) => ({
        entityId: r.entity_id,
        entityType: r.entity_type,
        title: r.title,
        status: r.status,
        sourceDomain: r.source_domain,
        sourceUri: r.source_uri,
        lastVerifiedAt: new Date(r.last_verified_ts).toISOString()
      }));
    return {
      countsByType: Object.fromEntries(counts.map((c) => [c.entity_type, c.count])),
      totalEntities: counts.reduce((acc, c) => acc + c.count, 0),
      totalEdges: edgeCount,
      recentEntities: recent
    };
  }
}

/**
 * Unified Raphael / Great Sage Personal Work Operator Engine (`0.8.0`).
 */
export class RaphaelEngine {
  constructor(db, { workspace = null, now = Date.now } = {}) {
    this.db = db;
    this.workspace = workspace;
    this.now = now;
    this.graph = new WorkGraphEngine(db, { now });
    this.nudgeBandit = new LinUCBNudgeBandit(db, { now });
    this.musicBandit = new MusicFlowBandit(db, { now });
    this.curriculum = new CurriculumCoach(db, { now });
    this.lastDecision = null;
  }

  recordSnapshot(signals = {}) {
    const decision = this.nudgeBandit.decide(signals);
    this.lastDecision = decision;
    const snapshotId = `snap_${randomUUID().slice(0, 10)}`;
    const ts = this.now();
    this.db
      .prepare(`
        INSERT INTO context_snapshots(
          snapshot_id, ts, work_mode, interruptibility, frontmost_app,
          window_title, git_branch, music_playlist, active_entity_id, payload_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        snapshotId,
        ts,
        decision.workMode,
        decision.interruptibility,
        String(signals.frontmostApp || ''),
        String(signals.windowTitle || ''),
        String(signals.gitBranch || ''),
        String(signals.musicPlaylist || ''),
        signals.activeEntityId || null,
        JSON.stringify(signals)
      );
    return decision;
  }

  briefing(signals = {}) {
    if (this.workspace?.snapshot) {
      try {
        this.graph.syncFromWorkspaceSnapshot(this.workspace.snapshot());
      } catch {}
    }
    const nudgeDecision = this.recordSnapshot(signals);
    const musicRec = this.musicBandit.recommend({ mode: nudgeDecision.workMode, deterministic: true });
    const skillRec = this.curriculum.recommend({ limit: 4 });
    const graphStats = this.graph.stats();

    const topSkill = skillRec.topRecommendation;
    const activeTasks = this.graph
      .search('active task priority', { limit: 4, entityTypes: ['TASK'] })
      .filter((t) => t.status === 'ACTIVE');

    const summaryParts = [
      `Raphael Status [${nudgeDecision.workMode} | Interruptibility ${Math.round(nudgeDecision.interruptibility * 100)}% → ${nudgeDecision.selectedArm}]`
    ];
    if (activeTasks.length > 0) {
      summaryParts.push(`Top Focus: ${activeTasks.slice(0, 2).map((t) => t.title).join('; ')}`);
    }
    if (topSkill) {
      summaryParts.push(
        `Recommended Skill Drill: “${topSkill.topicName}” (FSRS retention ${topSkill.retentionPercent}%, stability ${topSkill.stabilityDays}d)`
      );
    }
    summaryParts.push(
      `Acoustic Flow DJ: “${musicRec.recommendedPlaylist}” (${musicRec.genre}, ${musicRec.posteriorConfidence}% flow confidence)`
    );

    return {
      version: '0.8.0-raphael',
      workMode: nudgeDecision.workMode,
      interruptibility: nudgeDecision.interruptibility,
      nudgePolicy: {
        selectedArm: nudgeDecision.selectedArm,
        rankings: nudgeDecision.rankings,
        banditSummary: this.nudgeBandit.summary()
      },
      musicRecommendation: musicRec,
      curriculumRecommendation: skillRec,
      workGraph: graphStats,
      spokenBriefing: summaryParts.join('. ') + '.'
    };
  }

  /**
   * Read-only status summary for /api/apple/status polling (zero SQLite writes).
   */
  statusSnapshot(signals = {}) {
    const nudgeDecision = this.lastDecision || this.nudgeBandit.decide(signals);
    const musicRec = this.musicBandit.recommend({ mode: nudgeDecision.workMode, deterministic: true });
    const skillRec = this.curriculum.recommend({ limit: 1 });
    return {
      version: '0.8.0-raphael',
      workMode: nudgeDecision.workMode,
      interruptibility: nudgeDecision.interruptibility,
      selectedArm: nudgeDecision.selectedArm,
      musicRecommendation: musicRec,
      curriculumRecommendation: skillRec
    };
  }
}
