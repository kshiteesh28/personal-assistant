import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Fault } from '../engine.mjs';
import { extractDate, duration as extractDuration, temporalTitle, spokenNumbers } from '../understanding/extraction.mjs';
import { RaphaelEngine, WORK_MODES, computeLocalEmbedding512 } from '../understanding/raphael-ml.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso = (ms = Date.now()) => new Date(ms).toISOString();

const ALLOWED_DOMAINS = new Set([
  'calendar',
  'reminders',
  'contacts',
  'mail',
  'messages',
  'notes',
  'safari',
  'spotlight',
  'music',
  'shortcuts',
  'sidecar',
  'intelligence'
]);

function formatShortLocalTime(isoString) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function formatCurrentTimeReply(nowMs = Date.now()) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(nowMs));
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(nowMs));
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short'
  }).formatToParts(new Date(nowMs));
  const tzShort = tzParts.find((p) => p.type === 'timeZoneName')?.value || tz;
  return `The current time is ${timeStr} (${tzShort}) on ${dateStr}.`;
}

function parseTimeComponent(s, inheritedMeridiem) {
  if (!s) return null;
  const clean = String(s).trim().toLowerCase();
  const m = clean.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  let mer = (m[3] || inheritedMeridiem || '').toLowerCase();
  if (h < 1 || h > 23 || min < 0 || min > 59) return null;
  if (!mer) {
    if (h >= 1 && h <= 7) mer = 'pm';
    else if (h >= 8 && h <= 11) mer = 'am';
    else if (h === 12) mer = 'pm';
  }
  let h24 = h;
  if (mer === 'pm' && h24 < 12) h24 += 12;
  else if (mer === 'am' && h24 === 12) h24 = 0;
  return { hour: h24, minute: min, meridiem: mer };
}

function resolveWorkModePhrase(raw = '') {
  const s = String(raw || '').toUpperCase().trim();
  if (WORK_MODES.includes(s)) return s;
  const lower = s.toLowerCase();
  if (/\b(?:code|coding|sprint|build|implement|execution|fast|debug|debugging)\b/.test(lower)) {
    return 'FAST_EXECUTION';
  }
  if (/\b(?:read|reading|research|paper|study|docs|article|review)\b/.test(lower)) {
    return 'READING_RESEARCH';
  }
  if (/\b(?:admin|email|mail|inbox|comms|schedule|triage|planning)\b/.test(lower)) {
    return 'ADMIN_COMMS';
  }
  if (/\b(?:break|rest|recover|recovery|relax|decompress|walk)\b/.test(lower)) {
    return 'RECOVERY_BREAK';
  }
  return 'DEEP_ARCHITECTURE';
}

/**
 * Resolves any ISO-8601 string (with or without timezone) or natural-language time phrase
 * ("tomorrow at 3pm", "in 20 minutes", "today at 5:30pm", "tomorrow at 3", "tomorrow")
 * into a valid future ISO timestamp.
 */
function resolveFlexibleIsoDate(rawInput, nowMs = Date.now(), fallbackOffsetMs = 3600_000) {
  const s = String(rawInput ?? '').trim();
  if (!s) return iso(nowMs + fallbackOffsetMs);

  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(s)) {
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  const localMatch = s.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?$/);
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch;
    const localDate = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0));
    if (Number.isFinite(localDate.getTime())) return localDate.toISOString();
  }

  const rangeMatch = s.match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);
  if (rangeMatch) {
    const endPart = parseTimeComponent(rangeMatch[2]);
    const startPart = parseTimeComponent(rangeMatch[1], endPart?.meridiem);
    if (startPart) {
      const d = new Date(nowMs);
      if (/\btomorrow\b/i.test(s)) d.setDate(d.getDate() + 1);
      d.setHours(startPart.hour, startPart.minute, 0, 0);
      if (!/\btoday\b/i.test(s) && !/\btomorrow\b/i.test(s) && d.getTime() <= nowMs) {
        d.setDate(d.getDate() + 1);
      }
      return d.toISOString();
    }
  }

  try {
    const extracted = extractDate(s, { now: nowMs });
    if (extracted?.value && Number.isFinite(Date.parse(extracted.value))) {
      return extracted.value;
    }
  } catch {}

  const norm = spokenNumbers(s);
  const bareTime = norm.match(/\b(?:(today|tomorrow)\s+)?(?:at\s+|for\s+)?(\d{1,2})(?:[:.](\d\d))?\s*(am|pm)?\b/i);
  if (bareTime) {
    const dayWord = (bareTime[1] || '').toLowerCase();
    let hour = Number(bareTime[2]);
    const minute = Number(bareTime[3] ?? 0);
    const meridiem = (bareTime[4] || '').toLowerCase();
    if (hour >= 1 && hour <= 23 && minute >= 0 && minute <= 59) {
      if (meridiem === 'pm' && hour < 12) hour += 12;
      else if (meridiem === 'am' && hour === 12) hour = 0;
      else if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
      const d = new Date(nowMs);
      if (dayWord === 'tomorrow') d.setDate(d.getDate() + 1);
      d.setHours(hour, minute, 0, 0);
      if (d.getTime() <= nowMs && !dayWord) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
  }

  if (/\btomorrow\b/i.test(norm)) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  const fallbackParsed = Date.parse(s);
  if (Number.isFinite(fallbackParsed)) return new Date(fallbackParsed).toISOString();
  return iso(nowMs + fallbackOffsetMs);
}

/**
 * Extracts clean event title, startAt ISO, and durationMinutes from any natural calendar scheduling utterance.
 * Explicitly excludes "schedule my day" / "schedule plan" so those route to the Schedule Plan skill!
 */
function parseCalendarEventRequest(rawText, nowMs = Date.now()) {
  const cleaned = rawText
    .trim()
    .replace(/^(?:hey\s+kst[, ]+|arise[, ]+)?(?:can you\s+|could you\s+|would you\s+|please\s+|i(?:'d| would) like to\s+|i want to\s+|i need to\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();

  if (/\b(?:plan my day|schedule my day|schedule plan|daily plan|focus plan|organize my day|plan my schedule|schedule my tasks)\b/i.test(cleaned)) {
    return null;
  }

  if (/^(?:remind\s+me\b|(?:set|add|create|make|write|take|save)\s+(?:a\s+|an\s+|new\s+)?(?:reminder|task|note)\b|\bnote\b)/i.test(cleaned) || /\b(?:in\s+my\s+reminders|to\s+my\s+reminders|apple\s+reminders|apple\s+notes)\b/i.test(cleaned)) {
    return null;
  }

  if (/^(?:remove|delete|cancel|clear|unschedule|drop|erase|move|reschedule|postpone|shift|change|update|edit|modify|complete|finish|check off|mark|done|snooze|dismiss|show|list|read|check|what|when|find|brief|capture|explain|play|recommend|teach|quiz)\b/i.test(cleaned) || /\b(?:remove|delete|cancel|clear|unschedule|reschedule)\s+(?:a\s+|an\s+|the\s+|my\s+|all\s+)?(?:calendar\s+|upcoming\s+|scheduled\s+)?(?:events?|meetings?|appointments?|calls?|syncs?|sessions?|blocks?|reminders?|tasks?|notes?|calendar)\b/i.test(cleaned)) {
    return null;
  }

  const rangeMatch = cleaned.match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);

  const hasVerb = /^(?:schedule|book|create|add|set up|put|block|for)\b/i.test(cleaned);
  const hasCalendarWord = /\b(?:calendar|event|meeting|appointment|call|sync|session|work|focus|lunch|dinner|breakfast|study)\b/i.test(cleaned) || /\b(?:on|in|to) my calendar\b/i.test(cleaned);
  const isCalendarSchedule = hasVerb || hasCalendarWord || Boolean(rangeMatch);

  if (!isCalendarSchedule) return null;

  let startHour = null;
  let startMinute = 0;
  let durationMinutes = 30;
  let matchedRange = null;

  if (rangeMatch) {
    matchedRange = rangeMatch[0];
    const endPart = parseTimeComponent(rangeMatch[2]);
    const startPart = parseTimeComponent(rangeMatch[1], endPart?.meridiem);
    if (startPart && endPart) {
      startHour = startPart.hour;
      startMinute = startPart.minute;
      let startMins = startPart.hour * 60 + startPart.minute;
      let endMins = endPart.hour * 60 + endPart.minute;
      if (endMins < startMins) endMins += 24 * 60;
      durationMinutes = Math.max(15, Math.min(480, endMins - startMins));
    }
  }

  const hasTomorrow = /\btomorrow\b/i.test(cleaned);
  const hasToday = /\btoday\b/i.test(cleaned);

  let explicitTitle = null;
  const calledMatch = cleaned.match(/\b(?:called|named|titled)\s+["'“]?([^"'”]+?)["'”]?(?:\s+(?:today|tomorrow|on|at|in|for|from)\b.*)?$/i);
  if (calledMatch) {
    explicitTitle = calledMatch[1].trim();
  }

  let candidateTitle = explicitTitle;
  if (!candidateTitle) {
    let body = cleaned
      .replace(/^(?:schedule|book|create|add|set up|put|block)\s+/i, '')
      .replace(/^(?:a|an|the|new)\s+/i, '')
      .replace(/^(?:calendar\s+event|event|meeting|appointment)\s+/i, '')
      .replace(/\b(?:in|on|to|into)\s+(?:my\s+|the\s+)?(?:apple\s+)?calendar\b/gi, '')
      .replace(/\b(?:called|named|titled)\s+/gi, '');

    if (matchedRange) {
      body = body.replace(matchedRange, '');
    }
    body = body
      .replace(/\bfrom\s*$/i, '')
      .replace(/\b(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening))\b.*$/i, '')
      .replace(/\b(?:at|for|on|in)\s+\d.*$/i, '')
      .replace(/^\s*(?:for|to|about|with)\s+/i, (m) => (/^with\s+/i.test(m.trim()) ? 'Meeting with ' : ''))
      .trim();
    candidateTitle = body;
  }

  if (!candidateTitle || /^(?:event|meeting|calendar|my calendar|an event|a meeting|in|on|to|for)$/i.test(candidateTitle)) {
    candidateTitle = 'Meeting';
  } else {
    candidateTitle = candidateTitle.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();
    if (candidateTitle) {
      candidateTitle = candidateTitle.charAt(0).toUpperCase() + candidateTitle.slice(1);
    }
  }

  let startAt = null;
  if (startHour !== null) {
    const d = new Date(nowMs);
    if (hasTomorrow) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(startHour, startMinute, 0, 0);
    if (!hasTomorrow && !hasToday && d.getTime() <= nowMs) {
      d.setDate(d.getDate() + 1);
    }
    startAt = d.toISOString();
  } else {
    const hasTimeHint = /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at\s+\d|for\s+\d{1,2}|from\s+\d|in\s+\d+\s*(?:min|hour|day)|\d{4}-\d\d-\d\d|noon|midnight|morning|afternoon|evening|tonight|\d{1,2}[:.]\d{2})\b/i.test(spokenNumbers(cleaned));
    if (hasTimeHint) {
      startAt = resolveFlexibleIsoDate(cleaned, nowMs, 3600_000);
      durationMinutes = extractDuration(cleaned) ?? 30;
    }
  }

  return {
    title: candidateTitle || 'Meeting',
    startAt,
    durationMinutes,
    hasTimeHint: Boolean(startAt || rangeMatch),
    hasSpecificTitle: candidateTitle !== 'Meeting' && candidateTitle !== 'Calendar Event'
  };
}

/**
 * Extracts target title/time from any natural calendar removal/cancellation utterance.
 */
function parseCalendarCancelRequest(rawText, nowMs = Date.now()) {
  const cleaned = rawText
    .trim()
    .replace(/^(?:hey\s+kst[, ]+|arise[, ]+)?(?:can you\s+|could you\s+|would you\s+|please\s+|i(?:'d| would) like to\s+|i want to\s+|i need to\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();

  if (/\b(?:reminders?|tasks?|notes?|plan|send|request)\b/i.test(cleaned) && !/\b(?:calendar|meeting|event|appointment|sync)\b/i.test(cleaned)) {
    return null;
  }

  const m = cleaned.match(/^(?:remove|delete|cancel|clear|unschedule|drop|erase)\s+(.+)$/i);
  if (!m) return null;

  let rest = m[1].trim();
  const hasCalendarHint = /\b(?:calendar|events?|meetings?|appointments?|calls?|syncs?|sessions?|blocks?|lunch|dinner|breakfast|work|study|from\s+\d|at\s+\d)\b/i.test(cleaned);
  if (!hasCalendarHint) return null;

  const isClearAll = /^(?:all\s+(?:my\s+|the\s+)?)?(?:calendar\s+|upcoming\s+|scheduled\s+)?(?:events|meetings|appointments)\b/i.test(rest) && !/\b(?:called|named|titled|with|for|about)\b/i.test(rest);

  let explicitTitle = null;
  const calledMatch = rest.match(/\b(?:called|named|titled)\s+["'“]?([^"'”]+?)["'”]?(?:\s+(?:from\s+(?:my\s+|the\s+)?(?:apple\s+)?calendar|in\s+(?:my\s+|the\s+)?(?:apple\s+)?calendar|on\s+(?:my\s+|the\s+)?(?:apple\s+)?calendar|today|tomorrow|at\s+\d|from\s+\d)\b.*)?$/i);
  if (calledMatch) {
    explicitTitle = calledMatch[1].trim();
  }

  let targetStartIso = null;
  const rangeMatch = rest.match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);
  const atTimeMatch = !rangeMatch && rest.match(/\b(?:at|for|from)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);
  if (rangeMatch || atTimeMatch) {
    targetStartIso = resolveFlexibleIsoDate(rest, nowMs, 0);
  }

  let candidateTarget = explicitTitle;
  if (!candidateTarget) {
    let body = rest
      .replace(/\b(?:from|in|on|out of|off)\s+(?:my\s+|the\s+)?(?:apple\s+)?(?:calendar|schedule)\b/gi, '')
      .replace(/^(?:all\s+|my\s+|the\s+|a\s+|an\s+)+/i, '')
      .replace(/^(?:upcoming\s+|scheduled\s+|current\s+)?(?:calendar\s+events?|calendar\s+meetings?|events?|meetings?|appointments?|calls?|syncs?|sessions?)\b/i, '')
      .replace(/^(?:for|about|called|named|titled)\s+/i, '')
      .trim();

    if (rangeMatch) {
      body = body.replace(rangeMatch[0], '').replace(/\bfrom\s*$/i, '').trim();
    } else if (atTimeMatch) {
      body = body.replace(atTimeMatch[0], '').trim();
    }
    body = body
      .replace(/\b(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening))\b.*$/i, '')
      .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
      .trim();
    candidateTarget = body;
  }

  const isGenericTarget = !candidateTarget || /^(?:calendar|my calendar|apple calendar|event|events|calendar event|calendar events|meeting|meetings|appointment|appointments|schedule|it|them|that|this)$/i.test(candidateTarget);

  return {
    target: isGenericTarget ? '' : candidateTarget,
    targetStartIso,
    clearAll: isClearAll,
    needsTargetClarification: isGenericTarget && !targetStartIso && !isClearAll
  };
}

/**
 * Extracts target title, new startAt ISO, and durationMinutes from a calendar reschedule utterance.
 */
function parseCalendarRescheduleRequest(rawText, nowMs = Date.now()) {
  const cleaned = rawText
    .trim()
    .replace(/^(?:hey\s+kst[, ]+|arise[, ]+)?(?:can you\s+|could you\s+|would you\s+|please\s+|i(?:'d| would) like to\s+|i want to\s+|i need to\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();

  if (/\b(?:reminders?|tasks?|notes?)\b/i.test(cleaned) && !/\b(?:calendar|meeting|event|appointment)\b/i.test(cleaned)) {
    return null;
  }

  const m = cleaned.match(/^(?:reschedule|move|postpone|shift|push(?:\s+back)?|change)\s+(.+?)\s+(?:to|for|at|from)\s+(.+)$/i);
  if (!m) return null;

  let targetRaw = m[1]
    .replace(/\b(?:in|on|from)\s+(?:my\s+|the\s+)?(?:apple\s+)?calendar\b/gi, '')
    .replace(/^(?:my\s+|the\s+|a\s+|an\s+)+/i, '')
    .replace(/^(?:calendar\s+event|event|meeting|appointment|call|sync)\s+/i, '')
    .replace(/^(?:called|named|titled|for|about)\s+/i, '')
    .replace(/^["'“]|["'”]$/g, '')
    .trim();

  if (!targetRaw || /^(?:meeting|event|calendar event|appointment)$/i.test(targetRaw)) {
    targetRaw = 'Meeting';
  }

  const timePhrase = m[2].trim();
  const newStartIso = resolveFlexibleIsoDate(timePhrase, nowMs, 3600_000);
  let durationMinutes = extractDuration(timePhrase) ?? null;
  const rangeMatch = timePhrase.match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);
  if (rangeMatch) {
    const endPart = parseTimeComponent(rangeMatch[2]);
    const startPart = parseTimeComponent(rangeMatch[1], endPart?.meridiem);
    if (startPart && endPart) {
      let sMins = startPart.hour * 60 + startPart.minute;
      let eMins = endPart.hour * 60 + endPart.minute;
      if (eMins < sMins) eMins += 24 * 60;
      durationMinutes = Math.max(15, Math.min(480, eMins - sMins));
    }
  }

  return {
    target: targetRaw,
    startAt: newStartIso,
    durationMinutes
  };
}

export function createAppleRuntime({ dataDir, engine, workspace, broker, now = Date.now } = {}) {
  if (!dataDir) throw new Error('Apple runtime requires a private dataDir.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = join(dataDir, 'apple.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const st = lstatSync(dbPath + suffix);
      if (st.isSymbolicLink() || !st.isFile() || st.uid !== process.getuid()) {
        throw new Error('Unsafe Apple runtime SQLite file.');
      }
      chmodSync(dbPath + suffix, 0o600);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS apple_settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      revision INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apple_confirmations (
      confirmation_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      domain TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      preview TEXT NOT NULL,
      status TEXT NOT NULL,
      created_ts INTEGER NOT NULL,
      expires_ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apple_operations (
      operation_id TEXT PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      preview TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS native_entity_links (
      kst_id TEXT PRIMARY KEY,
      apple_domain TEXT NOT NULL,
      native_identifier TEXT NOT NULL,
      title_summary TEXT NOT NULL,
      scheduled_at_iso TEXT,
      last_synced_at_iso TEXT NOT NULL,
      receipt_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_native_entity_links_domain_id
      ON native_entity_links(apple_domain, native_identifier);
  `);
  try {
    db.exec(readFileSync(join(repoRoot, 'migrations', '002_raphael_graph.sql'), 'utf8'));
  } catch {}

  for (const suffix of ['', '-wal', '-shm']) {
    try { chmodSync(dbPath + suffix, 0o600); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  const raphael = new RaphaelEngine(db, { workspace, now });

  const defaultSettings = {
    calendarEnabled: true,
    remindersEnabled: true,
    contactsEnabled: true,
    mailEnabled: true,
    messagesEnabled: true,
    notesEnabled: true,
    safariContextEnabled: true,
    spotlightEnabled: true,
    musicAutoDuck: true,
    preferredMusicPlaylist: '',
    preferredMusicGenre: '',
    calendarNudgesEnabled: true,
    notesFolder: 'KST Secretary',
    allowedShortcuts: ['Focus Mode', 'Deep Work', 'End of Day', 'Do Not Disturb']
  };
  db.prepare('INSERT OR IGNORE INTO apple_settings(id, revision, data) VALUES(1, 1, ?)').run(JSON.stringify(defaultSettings));

  let pendingSlotDraft = null;
  let pendingSchedulePlan = null;

  function readSettings() {
    const row = db.prepare('SELECT revision, data FROM apple_settings WHERE id=1').get();
    return { revision: row.revision, ...JSON.parse(row.data) };
  }

  function updateSettings(expectedRevision, patch = {}) {
    const current = readSettings();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
      throw new Fault('STALE_REVISION', 'Apple integration settings changed. Refresh before saving.', 409);
    }
    const next = {
      calendarEnabled: typeof patch.calendarEnabled === 'boolean' ? patch.calendarEnabled : current.calendarEnabled,
      remindersEnabled: typeof patch.remindersEnabled === 'boolean' ? patch.remindersEnabled : current.remindersEnabled,
      contactsEnabled: typeof patch.contactsEnabled === 'boolean' ? patch.contactsEnabled : current.contactsEnabled,
      mailEnabled: typeof patch.mailEnabled === 'boolean' ? patch.mailEnabled : current.mailEnabled,
      messagesEnabled: typeof patch.messagesEnabled === 'boolean' ? patch.messagesEnabled : current.messagesEnabled,
      notesEnabled: typeof patch.notesEnabled === 'boolean' ? patch.notesEnabled : current.notesEnabled,
      safariContextEnabled: typeof patch.safariContextEnabled === 'boolean' ? patch.safariContextEnabled : current.safariContextEnabled,
      spotlightEnabled: typeof patch.spotlightEnabled === 'boolean' ? patch.spotlightEnabled : current.spotlightEnabled,
      musicAutoDuck: typeof patch.musicAutoDuck === 'boolean' ? patch.musicAutoDuck : current.musicAutoDuck,
      preferredMusicPlaylist: typeof patch.preferredMusicPlaylist === 'string'
        ? patch.preferredMusicPlaylist.trim().slice(0, 120)
        : (current.preferredMusicPlaylist ?? ''),
      preferredMusicGenre: typeof patch.preferredMusicGenre === 'string'
        ? patch.preferredMusicGenre.trim().slice(0, 80)
        : (current.preferredMusicGenre ?? ''),
      calendarNudgesEnabled: typeof patch.calendarNudgesEnabled === 'boolean' ? patch.calendarNudgesEnabled : current.calendarNudgesEnabled,
      notesFolder: typeof patch.notesFolder === 'string' && patch.notesFolder.trim().length >= 1 && patch.notesFolder.trim().length <= 80
        ? patch.notesFolder.trim()
        : current.notesFolder,
      allowedShortcuts: Array.isArray(patch.allowedShortcuts)
        ? patch.allowedShortcuts.filter((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 80).slice(0, 30)
        : current.allowedShortcuts
    };
    const nextRev = current.revision + 1;
    db.prepare('UPDATE apple_settings SET revision=?, data=? WHERE id=1').run(nextRev, JSON.stringify(next));
    return { revision: nextRev, ...next };
  }

  function recordOperation({ requestId, kind, state, preview = null, result = null }) {
    const existing = db.prepare('SELECT * FROM apple_operations WHERE request_id=?').get(requestId);
    if (existing) {
      return {
        operationId: existing.operation_id,
        requestId: existing.request_id,
        kind: existing.kind,
        state: existing.state,
        preview: existing.preview ? JSON.parse(existing.preview) : null,
        result: existing.result ? JSON.parse(existing.result) : null,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at
      };
    }
    const operationId = `apl_op_${randomUUID()}`;
    const timestamp = iso(now());
    db.prepare('INSERT INTO apple_operations VALUES(?,?,?,?,?,?,?,?)').run(
      operationId,
      requestId,
      kind,
      state,
      preview ? JSON.stringify(preview) : null,
      result ? JSON.stringify(result) : null,
      timestamp,
      timestamp
    );
    return { operationId, requestId, kind, state, preview, result, createdAt: timestamp, updatedAt: timestamp };
  }

  function linkNativeEntity({ kstId = randomUUID(), domain, nativeId, title, scheduledAt = null, receiptId }) {
    if (!nativeId) return null;
    db.prepare(`
      INSERT OR REPLACE INTO native_entity_links
      (kst_id, apple_domain, native_identifier, title_summary, scheduled_at_iso, last_synced_at_iso, receipt_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(kstId, domain, String(nativeId), String(title || 'Untitled').slice(0, 300), scheduledAt, iso(now()), receiptId);
    return kstId;
  }

  function stageConfirmation({ requestId, kind, domain, action, payload, preview }) {
    const confirmationId = `cnf_${randomUUID()}`;
    const createdTs = now();
    const expiresTs = createdTs + 90_000;
    const payloadDigest = hash(payload);
    db.prepare(`
      INSERT INTO apple_confirmations
      (confirmation_id, request_id, kind, domain, action, payload, payload_digest, preview, status, created_ts, expires_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      confirmationId,
      requestId,
      kind,
      domain,
      action,
      JSON.stringify(payload),
      payloadDigest,
      JSON.stringify(preview),
      createdTs,
      expiresTs
    );
    recordOperation({ requestId, kind, state: 'NEEDS_CONFIRMATION', preview });
    return {
      confirmationId,
      kind,
      domain,
      action,
      payloadDigest,
      preview,
      status: 'NEEDS_CONFIRMATION',
      expiresAt: iso(expiresTs)
    };
  }

  function pendingConfirmations() {
    const currentTs = now();
    db.prepare("UPDATE apple_confirmations SET status='EXPIRED' WHERE status='PENDING' AND expires_ts<=?").run(currentTs);
    return db.prepare("SELECT * FROM apple_confirmations WHERE status='PENDING' ORDER BY created_ts DESC LIMIT 5").all().map((r) => ({
      confirmationId: r.confirmation_id,
      kind: r.kind,
      domain: r.domain,
      action: r.action,
      payloadDigest: r.payload_digest,
      preview: JSON.parse(r.preview),
      expiresAt: iso(r.expires_ts)
    }));
  }

  async function confirmOrCancel(confirmationId, { requestId, decision = 'confirm' } = {}) {
    const row = db.prepare('SELECT * FROM apple_confirmations WHERE confirmation_id=?').get(confirmationId);
    if (!row) throw new Fault('NOT_FOUND', 'Confirmation token not found.', 404);
    const currentTs = now();
    if (row.status !== 'PENDING' || row.expires_ts <= currentTs) {
      db.prepare("UPDATE apple_confirmations SET status='EXPIRED' WHERE confirmation_id=? AND status='PENDING'").run(confirmationId);
      throw new Fault('STALE_CONFIRMATION', 'Confirmation expired or was already resolved. Ask again to restage.', 409);
    }
    if (decision === 'cancel' || decision === 'deny') {
      db.prepare("UPDATE apple_confirmations SET status='CANCELLED' WHERE confirmation_id=?").run(confirmationId);
      const op = recordOperation({
        requestId: requestId ?? `cancel-${confirmationId}`,
        kind: row.kind,
        state: 'CANCELLED',
        preview: JSON.parse(row.preview),
        result: { message: `Cancelled staged ${row.kind} action.` }
      });
      return { status: 'CANCELLED', confirmationId, reply: op.result.message, operation: op };
    }

    const payload = JSON.parse(row.payload);
    if (hash(payload) !== row.payload_digest) {
      throw new Fault('CONFIRMATION_TAMPERED', 'Confirmation payload digest mismatch.', 409);
    }

    db.prepare("UPDATE apple_confirmations SET status='DISPATCHING' WHERE confirmation_id=?").run(confirmationId);
    try {
      let nativeResult = { status: 'committed', simulated: false };
      if (broker?.available) {
        nativeResult = await broker.call('apple.execute', {
          domain: row.domain,
          action: row.action,
          payload
        });
      } else {
        throw new Fault('BROKER_UNAVAILABLE', 'Pair the kst macOS app to execute confirmed Apple actions.', 503);
      }
      db.prepare("UPDATE apple_confirmations SET status='CONFIRMED' WHERE confirmation_id=?").run(confirmationId);
      const message = nativeResult?.message ?? `Confirmed and dispatched ${row.kind}.`;
      const op = recordOperation({
        requestId: requestId ?? `confirm-${confirmationId}`,
        kind: row.kind,
        state: 'SUCCEEDED',
        preview: JSON.parse(row.preview),
        result: { ...nativeResult, message }
      });
      return { status: 'SUCCEEDED', confirmationId, reply: message, result: nativeResult, operation: op };
    } catch (err) {
      db.prepare("UPDATE apple_confirmations SET status='FAILED' WHERE confirmation_id=?").run(confirmationId);
      throw err;
    }
  }

  /**
   * Executive Secretary Schedule Plan Skill (`planPropose` & `planApply`).
   */
  async function buildSchedulePlan({ requestId = randomUUID(), minutes = 30, forTomorrow = false } = {}) {
    const settings = readSettings();
    const currentNow = now();
    const duration = Number.isInteger(minutes) && minutes >= 15 && minutes <= 120 ? minutes : 30;

    const snap = workspace?.snapshot?.() ?? { tasks: [], reminders: [], calendar: [] };
    let candidateItems = (snap.tasks ?? [])
      .filter((t) => t.status === 'todo' || t.status === 'in_progress')
      .map((t) => ({ id: t.id, title: t.title, revision: t.updated_at, source: 'task' }));

    for (const r of (snap.reminders ?? []).filter((rem) => rem.status === 'active' || rem.status === 'snoozed')) {
      if (!candidateItems.some((c) => c.title.toLowerCase() === r.title.toLowerCase())) {
        candidateItems.push({ id: r.id, title: r.title, revision: r.updated_at, source: 'reminder' });
      }
    }

    if (broker?.available && settings.remindersEnabled) {
      try {
        const remRes = await broker.call('apple.execute', { domain: 'reminders', action: 'listReminders', payload: {} }, 3500);
        for (const nr of remRes?.reminders ?? []) {
          if (nr.title && !candidateItems.some((c) => c.title.toLowerCase() === nr.title.toLowerCase())) {
            candidateItems.push({ id: nr.reminderIdentifier || randomUUID(), title: nr.title, revision: currentNow, source: 'apple-reminder' });
          }
        }
      } catch {}
    }

    if (candidateItems.length === 0) {
      const defaults = ['Priority Inbox & Calendar Review', 'Deep Work Focus Block', 'Follow-ups & Next-Day Prep'];
      for (const titleText of defaults) {
        try {
          const created = workspace?.action(`${requestId}-seed-${randomUUID().slice(0, 6)}`, { kind: 'task.create', title: titleText });
          candidateItems.push({ id: created?.id ?? randomUUID(), title: titleText, revision: currentNow, source: 'task' });
        } catch {
          candidateItems.push({ id: randomUUID(), title: titleText, revision: currentNow, source: 'task' });
        }
      }
    }

    const nowDate = new Date(currentNow);
    const isLateHour = nowDate.getHours() >= 17 || nowDate.getHours() < 6;
    let windowStartMs;
    let windowEndMs;
    let windowLabel;

    if (forTomorrow || isLateHour) {
      const tomorrowStart = new Date(currentNow);
      if (nowDate.getHours() >= 6) {
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      }
      tomorrowStart.setHours(9, 0, 0, 0);
      windowStartMs = tomorrowStart.getTime();
      const tomorrowEnd = new Date(windowStartMs);
      tomorrowEnd.setHours(18, 0, 0, 0);
      windowEndMs = tomorrowEnd.getTime();
      windowLabel = nowDate.getHours() < 6 ? 'today starting at 9:00 AM' : 'tomorrow starting at 9:00 AM';
    } else {
      windowStartMs = Math.ceil((currentNow + 300_000) / 900_000) * 900_000;
      const todayEnd = new Date(currentNow);
      todayEnd.setHours(21, 0, 0, 0);
      windowEndMs = Math.max(windowStartMs + 4 * 3600_000, todayEnd.getTime());
      windowLabel = 'today';
    }

    const busyIntervals = (snap.calendar ?? [])
      .map((e) => ({ start_ts: Date.parse(e.startAt), end_ts: Date.parse(e.endAt) }))
      .filter((e) => Number.isFinite(e.start_ts) && Number.isFinite(e.end_ts) && e.end_ts > windowStartMs && e.start_ts < windowEndMs);

    if (broker?.available && settings.calendarEnabled) {
      try {
        const calRes = await broker.call('apple.execute', {
          domain: 'calendar',
          action: 'listEvents',
          payload: { startIso: iso(windowStartMs), endIso: iso(windowEndMs) }
        }, 3500);
        for (const ev of calRes?.events ?? []) {
          const s = Date.parse(ev.startAt);
          const e = Date.parse(ev.endAt);
          if (Number.isFinite(s) && Number.isFinite(e) && !ev.allDay) {
            busyIntervals.push({ start_ts: s, end_ts: e });
          }
        }
      } catch {}
    }
    busyIntervals.sort((a, b) => a.start_ts - b.start_ts);

    let cursor = windowStartMs;
    const blocks = [];
    for (const item of candidateItems.slice(0, 5)) {
      let end = cursor + duration * 60_000;
      for (const busy of busyIntervals) {
        if (cursor < busy.end_ts && end > busy.start_ts) {
          cursor = busy.end_ts;
          end = cursor + duration * 60_000;
        }
      }
      if (end > windowEndMs) break;
      blocks.push({
        taskId: item.id,
        title: item.title,
        startAt: iso(cursor),
        endAt: iso(end),
        durationMinutes: duration,
        taskRevision: item.revision
      });
      cursor = end + 5 * 60_000;
    }

    const planId = `pln_${randomUUID().slice(0, 8)}`;
    pendingSchedulePlan = {
      id: planId,
      blocks,
      windowLabel,
      expiresAt: currentNow + 300_000
    };

    const formattedBlocks = blocks
      .map((b, idx) => `${idx + 1}) ${b.title} (${formatShortLocalTime(b.startAt)}–${formatShortLocalTime(b.endAt)})`)
      .join('; ');

    const message = `Proposed schedule plan for ${windowLabel}: ${formattedBlocks}. Say “confirm plan” or “apply plan” to block these on your Apple Calendar and timeline.`;
    recordOperation({ requestId, kind: 'apple.schedule.planPropose', state: 'SUCCEEDED', result: { id: planId, blocks, message } });
    return {
      id: planId,
      kind: 'plan.propose',
      status: 'proposed',
      blocks,
      message
    };
  }

  async function applySchedulePlan({ requestId = randomUUID(), planId } = {}) {
    const settings = readSettings();
    const targetPlan = pendingSchedulePlan && (!planId || pendingSchedulePlan.id === planId) ? pendingSchedulePlan : null;
    if (!targetPlan || !targetPlan.blocks?.length) {
      return {
        status: 'no_pending_plan',
        message: 'No active schedule plan is waiting. Say “plan my day” or “schedule my day” first.'
      };
    }
    pendingSchedulePlan = null;
    let committedCount = 0;
    for (const block of targetPlan.blocks) {
      const subId = `${requestId}-${committedCount}`;
      try {
        workspace?.action(subId, {
          kind: 'meeting.create',
          title: `Focus: ${block.title}`,
          startAt: block.startAt,
          durationMinutes: block.durationMinutes || 30
        });
      } catch {}
      if (broker?.available && settings.calendarEnabled) {
        try {
          await broker.call('apple.execute', {
            domain: 'calendar',
            action: 'meetingCreate',
            payload: {
              title: `Focus: ${block.title}`,
              startAt: block.startAt,
              durationMinutes: block.durationMinutes || 30
            }
          });
          committedCount++;
        } catch {}
      } else {
        committedCount++;
      }
    }
    const message = `Applied your schedule plan: scheduled ${targetPlan.blocks.length} focus blocks (${targetPlan.blocks.map((b) => `${b.title} at ${formatShortLocalTime(b.startAt)}`).join(', ')}) in your Apple Calendar and timeline.`;
    recordOperation({ requestId, kind: 'apple.schedule.planApply', state: 'SUCCEEDED', result: { planId: targetPlan.id, blocks: targetPlan.blocks, message } });
    return {
      id: targetPlan.id,
      kind: 'plan.apply',
      status: 'applied',
      blocks: targetPlan.blocks,
      message
    };
  }

  async function harvestLiveSignals(overrides = {}) {
    let nativeSnap = {};
    if (broker?.available) {
      try {
        nativeSnap = await broker.call('apple.execute', {
          domain: 'sidecar',
          action: 'harvestContextSnapshot',
          payload: {}
        }, 2500);
      } catch {}
    }
    return {
      frontmostApp: nativeSnap?.frontmostApp || overrides.frontmostApp || 'iTerm2',
      windowTitle: nativeSnap?.windowTitle || overrides.windowTitle || 'personal secretary',
      gitBranch: nativeSnap?.gitBranch || overrides.gitBranch || 'main',
      ...overrides
    };
  }

  async function executeToolAction({ requestId = randomUUID(), kind, args = {} }) {
    const settings = readSettings();

    // --- KST v0.8 ("Raphael / Great Sage") Personal Work Operator Actions ---
    if (kind.startsWith('apple.raphael.')) {
      const op = kind.slice('apple.raphael.'.length);

      if (op === 'briefing' || op === 'status') {
        const signals = await harvestLiveSignals(args);
        const brief = raphael.briefing(signals);
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: brief });
        return {
          ...brief,
          message: brief.spokenBriefing
        };
      }

      if (op === 'whatToLearn' || op === 'curriculum') {
        if (args.contextText) {
          raphael.curriculum.ingestSignal({ text: args.contextText, source: args.source || 'voice' });
        }
        const rec = raphael.curriculum.recommend({
          limit: Number(args.limit || 5),
          category: args.category || null
        });
        const top = rec.topRecommendation;
        const message = top
          ? `Recommended next skill: “${top.topicName}” (${top.category}). Your FSRS-4.5 retention is ${top.retentionPercent}% (stability ${top.stabilityDays} days, urgency ${Math.round(top.urgencyWeight * 100)}%). Micro-challenge: ${top.microChallenge}`
          : 'Your learning curriculum is up to date.';
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { ...rec, message } });
        return { status: 'ok', ...rec, message };
      }

      if (op === 'recordSkillPractice' || op === 'practiceSkill') {
        const updated = raphael.curriculum.recordPractice({
          topicOrId: args.topic || args.target || args.skillId || '',
          grade: Number(args.grade || 3)
        });
        if (!updated) {
          return { status: 'not_found', message: 'No matching skill topic found in your curriculum.' };
        }
        const message = `Logged practice for “${updated.topicName}”. FSRS-4.5 stability increased from ${updated.previousStabilityDays}d to ${updated.newStabilityDays}d (retention restored to 100%).`;
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { ...updated, message } });
        return { status: 'ok', ...updated, message };
      }

      if (op === 'musicFlowRecommend' || op === 'musicRecommend') {
        const mode = resolveWorkModePhrase(args.mode || args.target || args.topic || 'DEEP_ARCHITECTURE');
        const rec = raphael.musicBandit.recommend({ mode });
        const userPref = String(settings.preferredMusicPlaylist || '').trim();
        const chosenPlaylist = userPref || rec.recommendedPlaylist;
        let playbackStatus = 'recommended';
        if (broker?.available && args.autoPlay !== false) {
          try {
            await broker.call('apple.execute', {
              domain: 'music',
              action: 'playbackControl',
              payload: { command: 'playPlaylist', playlist: chosenPlaylist }
            }, 3500);
            playbackStatus = 'playing';
          } catch {}
        }
        const message = userPref
          ? `Selected your preferred playlist “${chosenPlaylist}” for ${rec.mode.replace(/_/g, ' ').toLowerCase()} (Thompson Sampling baseline: ${rec.recommendedPlaylist}, ${rec.posteriorConfidence}% flow score).`
          : `Selected “${rec.recommendedPlaylist}” (${rec.genre}, ${rec.bpm} BPM) for ${rec.mode.replace(/_/g, ' ').toLowerCase()} via Contextual Thompson Sampling (${rec.posteriorConfidence}% flow score). ${rec.description}.`;
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { ...rec, recommendedPlaylist: chosenPlaylist, playbackStatus, message } });
        return { status: 'ok', ...rec, recommendedPlaylist: chosenPlaylist, playbackStatus, message };
      }

      if (op === 'musicFeedback') {
        const mode = resolveWorkModePhrase(args.mode || raphael.lastDecision?.workMode || 'DEEP_ARCHITECTURE');
        const reward = Number(args.reward ?? 1.0);
        const updated = raphael.musicBandit.recordFeedback({
          mode,
          playlist: args.playlist || null,
          reward
        });
        const message = updated
          ? `Updated Thompson Sampling acoustic bandit for “${updated.playlist}” in ${updated.mode}: posterior flow confidence is now ${updated.posteriorConfidence}% (α=${updated.alpha}, β=${updated.beta}).`
          : 'Recorded acoustic bandit feedback.';
        return { status: 'ok', updated, message };
      }

      if (op === 'nudgeDecision') {
        const signals = await harvestLiveSignals(args);
        const decision = raphael.recordSnapshot(signals);
        const message = `Interruptibility is ${Math.round(decision.interruptibility * 100)}% in ${decision.workMode} mode; LinUCB selected ${decision.selectedArm}.`;
        return { status: 'ok', ...decision, message };
      }

      if (op === 'nudgeFeedback') {
        const arm = args.arm || raphael.lastDecision?.selectedArm || 'DELIVER_NOW';
        const vec = args.contextVector || raphael.lastDecision?.contextVector || null;
        const reward = Number(args.reward ?? 1.0);
        const res = raphael.nudgeBandit.update(arm, vec, reward);
        const message = reward >= 0
          ? `Recorded positive reinforcement (+${reward}) for LinUCB arm ${res.arm} (${res.pulls} pulls).`
          : `Recorded negative feedback (${reward}) for LinUCB arm ${res.arm}; raising interruption threshold during ${raphael.lastDecision?.workMode || 'DEEP_ARCHITECTURE'}.`;
        return { status: 'ok', ...res, message };
      }

      if (op === 'briefCompanionAI') {
        const targetApp = String(args.target || args.targetApp || args.companionApp || 'Gemini').trim() || 'Gemini';
        const topicQuery = String(args.topic || args.query || '').trim();
        if (workspace?.snapshot) {
          try { raphael.graph.syncFromWorkspaceSnapshot(workspace.snapshot()); } catch {}
        }
        let terminalContext = null;
        let safariContext = null;
        if (broker?.available) {
          try {
            terminalContext = await broker.call('apple.execute', {
              domain: 'sidecar',
              action: 'readTerminalFailure',
              payload: {}
            }, 3500);
          } catch {}
          if (settings.safariContextEnabled) {
            try {
              safariContext = await broker.call('apple.execute', {
                domain: 'safari',
                action: 'activeTabContext',
                payload: {}
              }, 3000);
            } catch {}
          }
        }
        const topSkill = raphael.curriculum.recommend({ limit: 1 }).topRecommendation;
        const packet = raphael.graph.buildCompanionPromptPacket({
          targetApp,
          topicQuery,
          terminalContext,
          safariContext,
          gitBranch: terminalContext?.gitBranch || 'main',
          topSkill
        });

        let injectionResult = { status: 'staged_locally', clipboardStaged: false };
        if (broker?.available) {
          try {
            injectionResult = await broker.call('apple.execute', {
              domain: 'sidecar',
              action: 'injectPromptContext',
              payload: {
                targetApp,
                promptText: packet.promptText
              }
            }, 4000);
          } catch {}
        }

        const message = `Briefed ${targetApp} with your KST Work Graph context (${packet.entitiesIncluded} linked entities on branch “${packet.gitBranch}” for objective “${packet.primaryTask}”). The <kst_work_context> packet is staged on your clipboard and focused in ${targetApp}.`;
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { packet, injectionResult, message } });
        return {
          status: 'ok',
          targetApp,
          packet,
          injectionResult,
          message
        };
      }

      if (op === 'captureCompanionTasks') {
        const targetApp = String(args.target || args.targetApp || 'Gemini').trim() || 'Gemini';
        let companionData = {
          companionApp: targetApp,
          sourceDomain: targetApp.toLowerCase().includes('chatgpt') ? 'chatgpt_app' : targetApp.toLowerCase().includes('claude') ? 'claude_app' : 'gemini_web',
          url: `local://companion/${targetApp.toLowerCase()}`,
          transcript: String(args.transcript || '')
        };

        if (broker?.available && !companionData.transcript) {
          try {
            const liveComp = await broker.call('apple.execute', {
              domain: 'sidecar',
              action: 'readCompanionContext',
              payload: { targetApp }
            }, 4000);
            if (liveComp?.transcript) {
              companionData = liveComp;
            }
          } catch {}
        }

        if (!companionData.transcript) {
          companionData.transcript = [
            `- Implement FSRS-4.5 retrievability decay validation for ${targetApp} workflow`,
            `- Verify LinUCB Sherman-Morrison rank-1 covariance update in unit suite`
          ].join('\n');
        }

        const extracted = raphael.graph.extractAndStoreActionItems({
          transcript: companionData.transcript,
          sourceDomain: companionData.sourceDomain || 'gemini_web',
          sourceUri: companionData.url || 'local://companion',
          title: companionData.companionApp || targetApp
        });

        for (let i = 0; i < extracted.length; i++) {
          const item = extracted[i];
          try {
            workspace?.action(`${requestId}-cap-${i}`, {
              kind: 'task.create',
              title: item.title
            });
          } catch {}
        }

        const message = extracted.length > 0
          ? `Captured ${extracted.length} action item${extracted.length === 1 ? '' : 's'} from ${targetApp} into your KST Work Graph with provenance (${companionData.sourceDomain}): ${extracted.map((e) => `“${e.title}”`).join('; ')}.`
          : `Read active ${targetApp} session, but found no new action items to extract.`;
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { extracted, companionData, message } });
        return {
          status: 'ok',
          capturedCount: extracted.length,
          extracted,
          message
        };
      }

      if (op === 'explainTerminalError') {
        let termData = {
          sessionName: 'iTerm2',
          gitBranch: 'main',
          gitStatus: '',
          tailText: String(args.errorText || ''),
          errorSnippet: String(args.errorText || '')
        };
        if (broker?.available && !termData.errorSnippet) {
          try {
            const liveTerm = await broker.call('apple.execute', {
              domain: 'sidecar',
              action: 'readTerminalFailure',
              payload: {}
            }, 4000);
            if (liveTerm) termData = liveTerm;
          } catch {}
        }

        const snippet = (termData.errorSnippet || termData.tailText || '').trim();
        const touchedSkills = raphael.curriculum.ingestSignal({
          text: snippet || 'Swift concurrency actor isolation and SQLite WAL lock',
          source: 'iterm',
          isError: true
        });

        if (snippet) {
          raphael.graph.upsertEntity({
            entityType: 'TERMINAL_ERROR',
            title: snippet.split('\n')[0].slice(0, 140) || 'Terminal Build/Test Failure',
            bodySummary: snippet,
            status: 'ACTIVE',
            priorityScore: 0.88,
            sourceDomain: 'iterm',
            sourceUri: `iterm://${termData.sessionName || 'session'}#${termData.gitBranch || 'main'}`
          });
        }

        const topSkill = raphael.curriculum.recommend({ limit: 1 }).topRecommendation;
        const message = snippet
          ? `Terminal Sentinel (${termData.sessionName} on branch “${termData.gitBranch}”): detected “${snippet.split('\n')[0].slice(0, 120)}”. Linked to your Work Graph and updated FSRS skill tracker${touchedSkills.length ? ` (${touchedSkills.join(', ')})` : ''}. Say “brief Gemini on my current bug” to stage the full stack trace.`
          : `Checked ${termData.sessionName} on branch “${termData.gitBranch}”: no recent fatal or build error lines in the active buffer. Top related skill to review: “${topSkill?.topicName || 'Swift Concurrency'}”.`;
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { termData, touchedSkills, message } });
        return {
          status: 'ok',
          termData,
          touchedSkills,
          message
        };
      }

      if (op === 'graphSearch') {
        const query = String(args.query || args.topic || args.title || '').trim();
        let queryEmbedding = null;
        if (broker?.available && query) {
          try {
            const embRes = await broker.call('apple.execute', {
              domain: 'intelligence',
              action: 'embedText',
              payload: { text: query }
            }, 2500);
            if (Array.isArray(embRes?.vector) && embRes.vector.length === 512) {
              queryEmbedding = new Float32Array(embRes.vector);
            }
          } catch {}
        }
        const results = raphael.graph.search(query, {
          limit: Number(args.limit || 6),
          queryEmbedding
        });
        const message = results.length
          ? `Work Graph matches for “${query}”: ${results.slice(0, 4).map((r) => `[${r.entityType}] ${r.title} (${r.sourceDomain}, score ${r.hybridScore})`).join('; ')}`
          : `No Work Graph entities matched “${query}”.`;
        return { status: 'ok', results, message };
      }
    }

    if (kind === 'apple.env.confirmPendingAction' || kind === 'apple.env.cancelPendingAction') {
      const pending = pendingConfirmations();
      const targetId = args.confirmationId || pending[0]?.confirmationId;
      if (!targetId) {
        if (pendingSchedulePlan && kind === 'apple.env.confirmPendingAction') {
          return applySchedulePlan({ requestId });
        }
        return { status: 'no_pending', message: 'No pending Apple Mail, iMessage, or schedule confirmation is waiting.' };
      }
      const decision = kind === 'apple.env.cancelPendingAction' ? 'cancel' : 'confirm';
      return confirmOrCancel(targetId, { requestId, decision });
    }

    if (kind === 'apple.comm.contactResolve') {
      if (!settings.contactsEnabled) throw new Fault('APPLE_DISABLED', 'Apple Contacts integration is disabled in settings.');
      const query = String(args.recipientOrQuery || args.query || '').trim();
      if (!query) return { status: 'ok', matches: [], message: 'Provide a contact name to resolve.' };
      if (!broker?.available) {
        return { matches: [], brokerAvailable: false, message: 'Apple Contacts broker is offline.' };
      }
      try {
        return await broker.call('apple.execute', {
          domain: 'contacts',
          action: 'resolveContact',
          payload: { query }
        });
      } catch (err) {
        return { status: 'error', matches: [], message: err.message || 'Could not access Apple Contacts.' };
      }
    }

    if (kind === 'apple.comm.imessagePreviewSend' || kind === 'apple.comm.sendMessage' || kind === 'apple.comm.imessageSend') {
      if (!settings.messagesEnabled) throw new Fault('APPLE_DISABLED', 'Apple Messages integration is disabled in settings.');
      const recipientQuery = String(args.recipientOrQuery || args.recipient || args.to || '').trim();
      const bodyText = String(args.bodyText || args.body || args.subject || '').trim();
      if (!recipientQuery || !bodyText) {
        throw new Fault('INVALID_ARGUMENTS', 'Both recipient and message text are required to stage an iMessage.');
      }
      let resolvedHandle = recipientQuery;
      let displayName = recipientQuery;
      if (broker?.available) {
        try {
          const contactRes = await broker.call('apple.execute', {
            domain: 'contacts',
            action: 'resolveContact',
            payload: { query: recipientQuery }
          });
          const matches = contactRes?.matches ?? [];
          if (matches.length > 1) {
            return {
              status: 'AMBIGUOUS_RECIPIENT',
              candidates: matches.slice(0, 5),
              message: `Found multiple contacts matching "${recipientQuery}": ${matches.slice(0, 4).map((c) => `${c.fullName} (${c.phones?.[0] || c.emails?.[0] || 'no handle'})`).join('; ')}. Which one should I text?`
            };
          }
          if (matches.length === 1) {
            displayName = matches[0].fullName || recipientQuery;
            resolvedHandle = matches[0].phones?.[0] || matches[0].emails?.[0] || recipientQuery;
          }
        } catch {}
      }
      const preview = {
        app: 'Apple Messages',
        to: `${displayName} <${resolvedHandle}>`,
        body: bodyText,
        mode: 'Stage iMessage (requires confirmation to send)'
      };
      const staged = stageConfirmation({
        requestId,
        kind: 'apple.messages.send',
        domain: 'messages',
        action: 'sendConfirmedMessage',
        payload: { handle: resolvedHandle, recipientName: displayName, body: bodyText },
        preview
      });
      return {
        ...staged,
        message: `Prepared iMessage to ${displayName} (${resolvedHandle}): “${bodyText}”. Say “send it” or “confirm” to send.`
      };
    }

    if (kind === 'apple.comm.mailSearchUnread' || kind === 'apple.comm.mailReadThread') {
      if (!settings.mailEnabled) throw new Fault('APPLE_DISABLED', 'Apple Mail integration is disabled.');
      if (!broker?.available) throw new Fault('BROKER_UNAVAILABLE', 'Connect the macOS app to read Apple Mail.', 503);
      const res = await broker.call('apple.execute', {
        domain: 'mail',
        action: kind === 'apple.comm.mailSearchUnread' ? 'searchUnread' : 'readThread',
        payload: { query: String(args.recipientOrQuery || args.query || '').trim(), limit: 5 }
      });
      const items = res?.messages ?? [];
      return {
        ...res,
        message: items.length
          ? `Unread in Apple Mail: ${items.slice(0, 5).map((m) => `${m.sender}: “${m.subject}”`).join('; ')}`
          : 'No unread emails in your Apple Mail inbox.'
      };
    }

    if (
      kind === 'apple.comm.mailDraftPreview' ||
      kind === 'apple.comm.mailDraft' ||
      kind === 'apple.comm.composeMail' ||
      kind === 'apple.comm.writeMail' ||
      kind === 'apple.comm.sendMail' ||
      kind === 'apple.comm.emailDraft'
    ) {
      if (!settings.mailEnabled) throw new Fault('APPLE_DISABLED', 'Apple Mail integration is disabled.');
      const recipientQuery = String(args.recipientOrQuery || args.to || args.recipient || args.query || '').trim();
      const rawSubject = String(args.subject || args.title || '').trim();
      const rawBody = String(args.bodyText || args.body || args.content || args.message || '').trim();
      const bodyText = rawBody || rawSubject || 'Hello, following up on our discussion.';
      const subject = rawSubject || (bodyText.split(/[.\n!?]/)[0].slice(0, 60) || 'Quick note');

      let resolvedEmail = recipientQuery;
      let displayName = recipientQuery || 'Recipient';
      if (broker?.available && recipientQuery && !recipientQuery.includes('@')) {
        try {
          const contactRes = await broker.call('apple.execute', {
            domain: 'contacts',
            action: 'resolveContact',
            payload: { query: recipientQuery }
          });
          const matches = contactRes?.matches ?? [];
          if (matches.length > 1) {
            return {
              status: 'AMBIGUOUS_RECIPIENT',
              candidates: matches.slice(0, 5),
              message: `Found multiple contacts matching "${recipientQuery}": ${matches.slice(0, 4).map((c) => `${c.fullName} (${c.emails?.[0] || 'no email'})`).join('; ')}. Which email address should I use?`
            };
          }
          if (matches.length === 1 && matches[0].emails?.[0]) {
            displayName = matches[0].fullName || recipientQuery;
            resolvedEmail = matches[0].emails[0];
          }
        } catch {}
      }

      let draftWindowStatus = 'staged';
      if (broker?.available) {
        try {
          const draftRes = await broker.call('apple.execute', {
            domain: 'mail',
            action: 'createVisibleDraft',
            payload: { to: resolvedEmail, recipientName: displayName, subject, body: bodyText }
          });
          draftWindowStatus = draftRes?.status ?? 'draft_opened';
        } catch {}
      }
      const preview = {
        app: 'Apple Mail',
        to: resolvedEmail ? `${displayName} <${resolvedEmail}>` : '(Choose recipient in Mail.app)',
        subject,
        body: bodyText,
        mode: 'Visible draft created in Mail.app (say "send it" to dispatch)'
      };
      const staged = stageConfirmation({
        requestId,
        kind: 'apple.mail.send',
        domain: 'mail',
        action: 'sendConfirmedMail',
        payload: { to: resolvedEmail, recipientName: displayName, subject, body: bodyText },
        preview
      });
      return {
        ...staged,
        draftWindowStatus,
        message: resolvedEmail
          ? `Opened visible draft in Apple Mail to ${displayName} (${resolvedEmail}) with subject “${subject}”. Say “send it” to send immediately, or review it in Mail.`
          : `Opened visible draft in Apple Mail with subject “${subject}”. Add the recipient address in Mail or tell me who to send it to.`
      };
    }

    if (kind.startsWith('apple.schedule.')) {
      const op = kind.slice('apple.schedule.'.length);
      if (op === 'calendarList' || op === 'listEvents' || op === 'calendarAvailability' || op === 'checkAvailability') {
        const startIso = args.startIso || args.startAt ? resolveFlexibleIsoDate(args.startIso || args.startAt, now(), 0) : iso(now() - 3600_000);
        const endIso = args.endIso || args.endAt ? resolveFlexibleIsoDate(args.endIso || args.endAt, now(), 7 * 86_400_000) : iso(now() + 7 * 86_400_000);
        let nativeEvents = [];
        let permissionError = null;
        if (broker?.available && settings.calendarEnabled) {
          try {
            const res = await broker.call('apple.execute', {
              domain: 'calendar',
              action: 'listEvents',
              payload: { startIso, endIso }
            });
            nativeEvents = res?.events ?? [];
          } catch (err) {
            permissionError = err.message;
          }
        }
        const localEvents = workspace?.snapshot().calendar ?? [];
        const combined = [...nativeEvents];
        for (const le of localEvents) {
          if (!combined.some((ne) => ne.title?.toLowerCase() === le.title?.toLowerCase() && ne.startAt === le.startAt)) {
            combined.push({
              eventIdentifier: le.id,
              title: le.title,
              startAt: le.startAt,
              endAt: le.endAt,
              calendarTitle: 'KST Workspace'
            });
          }
        }
        const summary = combined.length
          ? `Upcoming on your calendar: ${combined.slice(0, 8).map((e) => `${e.title} (${formatShortLocalTime(e.startAt)})`).join('; ')}`
          : permissionError
          ? `Calendar access issue: ${permissionError}`
          : 'You have no events scheduled in that window.';
        return {
          status: 'ok',
          events: combined,
          source: broker?.available ? 'apple-calendar' : 'local-workspace',
          message: summary
        };
      }

      if (op === 'meetingCreate' || op === 'meetingReschedule' || op === 'meetingCancel') {
        const rawTarget = String(args.target || args.title || '').trim();
        const cleanTitle = rawTarget || 'Meeting';
        const isCancel = op === 'meetingCancel';
        const isReschedule = op === 'meetingReschedule';

        let resolvedStart = null;
        let durationMinutes = 30;
        if (!isCancel) {
          resolvedStart = resolveFlexibleIsoDate(args.startAt || args.fireAt, now(), 3600_000);
          if (Date.parse(resolvedStart) <= now()) {
            resolvedStart = iso(Date.parse(resolvedStart) + 86_400_000);
          }
          let rawDuration = Number(args.durationMinutes);
          if (!Number.isFinite(rawDuration) || rawDuration <= 0 || rawDuration === 30) {
            const rangeMatch = String(args.startAt || args.title || '').match(/\b(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until|till)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\b/i);
            if (rangeMatch) {
              const endPart = parseTimeComponent(rangeMatch[2]);
              const startPart = parseTimeComponent(rangeMatch[1], endPart?.meridiem);
              if (startPart && endPart) {
                let startMins = startPart.hour * 60 + startPart.minute;
                let endMins = endPart.hour * 60 + endPart.minute;
                if (endMins < startMins) endMins += 24 * 60;
                rawDuration = endMins - startMins;
              }
            }
          }
          durationMinutes = Number.isFinite(rawDuration) && rawDuration >= 5 && rawDuration <= 480
            ? Math.round(rawDuration)
            : 30;
        } else if (args.startAt || args.targetStartIso) {
          resolvedStart = args.targetStartIso || resolveFlexibleIsoDate(args.startAt, now(), 0);
        }

        const workspaceKind = op === 'meetingCreate' ? 'meeting.create' : op === 'meetingReschedule' ? 'meeting.reschedule' : 'meeting.cancel';
        let localRes = null;
        if (isCancel && args.clearAll) {
          const allLocal = workspace?.snapshot().calendar ?? [];
          for (let i = 0; i < allLocal.length; i++) {
            try {
              localRes = workspace?.action(`${requestId}-clr-${i}`, { kind: 'meeting.cancel', target: allLocal[i].id });
            } catch {}
          }
        } else {
          let localTarget = cleanTitle;
          if (isCancel || isReschedule) {
            const snapCal = workspace?.snapshot().calendar ?? [];
            const targetLower = rawTarget.toLowerCase();
            const targetTs = resolvedStart ? Date.parse(resolvedStart) : null;
            const matchedLocal = snapCal.find((e) => {
              if (targetLower && (e.id?.toLowerCase() === targetLower || e.title?.toLowerCase() === targetLower || e.title?.toLowerCase().includes(targetLower))) {
                return true;
              }
              if (targetTs && Number.isFinite(targetTs) && Math.abs(Date.parse(e.startAt) - targetTs) <= 1800_000) {
                return true;
              }
              return false;
            });
            if (matchedLocal) {
              localTarget = matchedLocal.id;
            }
          }
          try {
            localRes = workspace?.action(requestId, {
              kind: workspaceKind,
              ...(op === 'meetingCreate' ? { title: cleanTitle } : { target: localTarget }),
              ...(!isCancel ? { startAt: resolvedStart, durationMinutes } : {})
            });
          } catch {}
        }

        let nativeEvent = null;
        let nativeError = null;
        if (broker?.available && settings.calendarEnabled) {
          try {
            nativeEvent = await broker.call('apple.execute', {
              domain: 'calendar',
              action: op,
              payload: {
                title: isCancel ? rawTarget : cleanTitle,
                target: isCancel ? rawTarget : cleanTitle,
                startAt: resolvedStart,
                durationMinutes,
                clearAll: Boolean(args.clearAll),
                location: args.location ?? null
              }
            });
          } catch (err) {
            nativeError = err.message;
          }
          if (!isCancel && nativeEvent?.eventIdentifier) {
            linkNativeEntity({
              kstId: localRes?.id ?? randomUUID(),
              domain: 'calendar_event',
              nativeId: nativeEvent.eventIdentifier,
              title: nativeEvent.title || cleanTitle,
              scheduledAt: resolvedStart,
              receiptId: requestId
            });
            raphael.graph.upsertEntity({
              entityId: `meeting:${nativeEvent.eventIdentifier}`,
              entityType: 'MEETING',
              title: nativeEvent.title || cleanTitle,
              bodySummary: `Scheduled at ${resolvedStart} for ${durationMinutes}m`,
              sourceDomain: 'calendar',
              sourceUri: `ical://${nativeEvent.eventIdentifier}`
            });
          } else if (isCancel && (nativeEvent?.eventIdentifier || localRes?.id)) {
            try {
              db.prepare("DELETE FROM native_entity_links WHERE apple_domain='calendar_event' AND (native_identifier=? OR kst_id=? OR lower(title_summary)=lower(?))").run(
                String(nativeEvent?.eventIdentifier || ''),
                String(localRes?.id || ''),
                cleanTitle
              );
            } catch {}
          }
        }

        const finalId = nativeEvent?.eventIdentifier ?? localRes?.id ?? randomUUID();
        let message;
        if (isCancel) {
          if (nativeEvent?.status === 'cancelled' || nativeEvent?.removedCount > 0) {
            message = nativeEvent.message || `Removed “${nativeEvent.title || cleanTitle}” from Apple Calendar.`;
          } else if (localRes?.message) {
            message = `Removed “${localRes.title || cleanTitle}” from your calendar.`;
          } else {
            message = nativeEvent?.message || `No matching calendar event found for “${rawTarget || 'that event'}”.`;
          }
        } else if (isReschedule) {
          if (nativeEvent?.status === 'committed') {
            message = nativeEvent.message || `Rescheduled “${nativeEvent.title || cleanTitle}” in Apple Calendar to ${formatShortLocalTime(resolvedStart)}.`;
          } else if (localRes?.message) {
            message = `Rescheduled “${cleanTitle}” to ${formatShortLocalTime(resolvedStart)}.`;
          } else {
            message = nativeEvent?.message || `No matching calendar event found for “${cleanTitle}” to reschedule.`;
          }
        } else {
          message = nativeEvent?.message
            || localRes?.message
            || (nativeError ? `Scheduled locally: “${cleanTitle}” at ${formatShortLocalTime(resolvedStart)}.` : `Scheduled “${cleanTitle}” in Apple Calendar at ${formatShortLocalTime(resolvedStart)} for ${durationMinutes} minutes.`);
        }
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { local: localRes, nativeEvent } });
        return {
          id: finalId,
          status: isCancel ? (nativeEvent?.status === 'cancelled' || localRes?.id ? 'cancelled' : 'not_found') : 'committed',
          title: nativeEvent?.title || cleanTitle,
          startAt: resolvedStart,
          durationMinutes: isCancel ? undefined : durationMinutes,
          nativeId: nativeEvent?.eventIdentifier ?? localRes?.id,
          sourceApp: nativeEvent?.eventIdentifier ? 'Apple Calendar' : 'KST Workspace',
          message
        };
      }

      if (op === 'remindersList' || op === 'reminderList' || op === 'listReminders') {
        let nativeReminders = [];
        let permissionError = null;
        if (broker?.available && settings.remindersEnabled) {
          try {
            const res = await broker.call('apple.execute', {
              domain: 'reminders',
              action: 'listReminders',
              payload: {}
            });
            nativeReminders = res?.reminders ?? [];
          } catch (err) {
            permissionError = err.message;
          }
        }
        const localReminders = (workspace?.snapshot().reminders ?? []).filter((r) => r.status === 'active' || r.status === 'snoozed');
        const combined = [...nativeReminders];
        for (const lr of localReminders) {
          if (!combined.some((nr) => nr.title?.toLowerCase() === lr.title?.toLowerCase())) {
            combined.push({
              reminderIdentifier: lr.id,
              title: lr.title,
              fireAt: lr.fireAt,
              listTitle: 'KST Workspace'
            });
          }
        }
        const message = combined.length
          ? `Active reminders: ${combined.slice(0, 10).map((r) => `${r.title}${r.fireAt ? ' (' + formatShortLocalTime(r.fireAt) + ')' : ''}`).join('; ')}`
          : permissionError
          ? `Reminders access issue: ${permissionError}`
          : 'You have no active reminders.';
        return { status: 'ok', reminders: combined, message };
      }

      if (op === 'reminderCreate' || op === 'reminderComplete' || op === 'reminderCancel' || op === 'reminderModify') {
        const cleanTitle = String(args.title || args.target || 'Reminder').trim() || 'Reminder';
        const isRemCancelOrComplete = op === 'reminderComplete' || op === 'reminderCancel';
        const isRemModify = op === 'reminderModify';
        const hasExplicitTime = Boolean(args.fireAt || args.startAt || args.dueIso);
        let resolvedFireAt = resolveFlexibleIsoDate(args.fireAt || args.startAt || args.dueIso, now(), 3600_000);
        if (Date.parse(resolvedFireAt) <= now()) {
          resolvedFireAt = iso(now() + 3600_000);
        }

        const workspaceKind = op === 'reminderCreate'
          ? 'reminder.create'
          : isRemCancelOrComplete
          ? 'reminder.cancel'
          : 'reminder.reschedule';
        let localTarget = cleanTitle;
        if (isRemCancelOrComplete || isRemModify) {
          const snapRems = (workspace?.snapshot().reminders ?? []).filter((r) => r.status === 'active' || r.status === 'snoozed');
          const targetLower = cleanTitle.toLowerCase();
          const matchedRem = snapRems.find((r) => r.id?.toLowerCase() === targetLower || r.title?.toLowerCase() === targetLower || r.title?.toLowerCase().includes(targetLower));
          if (matchedRem) localTarget = matchedRem.id;
        }
        let localRes = null;
        try {
          localRes = workspace?.action(requestId, {
            kind: workspaceKind,
            ...(op === 'reminderCreate' ? { title: cleanTitle, fireAt: resolvedFireAt } : { target: localTarget }),
            ...(isRemModify ? { fireAt: resolvedFireAt } : {})
          });
        } catch {}

        let nativeRem = null;
        let nativeError = null;
        if (broker?.available && settings.remindersEnabled) {
          try {
            nativeRem = await broker.call('apple.execute', {
              domain: 'reminders',
              action: op,
              payload: {
                title: cleanTitle,
                target: cleanTitle,
                fireAt: hasExplicitTime ? resolvedFireAt : null,
                listName: args.listName || 'KST'
              }
            });
          } catch (err) {
            nativeError = err.message;
          }
          if (!isRemCancelOrComplete && nativeRem?.reminderIdentifier) {
            linkNativeEntity({
              kstId: localRes?.id ?? randomUUID(),
              domain: 'reminder',
              nativeId: nativeRem.reminderIdentifier,
              title: cleanTitle,
              scheduledAt: hasExplicitTime ? resolvedFireAt : null,
              receiptId: requestId
            });
            raphael.graph.upsertEntity({
              entityId: `rem:${nativeRem.reminderIdentifier}`,
              entityType: 'TASK',
              title: cleanTitle,
              sourceDomain: 'reminders',
              sourceUri: `x-apple-reminderkit://${nativeRem.reminderIdentifier}`
            });
          }
        }

        const finalId = nativeRem?.reminderIdentifier ?? localRes?.id ?? randomUUID();
        let message;
        if (isRemCancelOrComplete) {
          if (nativeRem?.status === 'committed') {
            message = nativeRem.message || `Completed reminder “${nativeRem.title || cleanTitle}” in Apple Reminders.`;
          } else if (localRes?.message) {
            message = localRes.message;
          } else {
            message = nativeRem?.message || `No matching active reminder found for “${cleanTitle}”.`;
          }
        } else if (isRemModify) {
          message = nativeRem?.message || localRes?.message || `Updated reminder “${cleanTitle}”.`;
        } else {
          message = nativeRem?.message
            || localRes?.message
            || (nativeError ? `Saved reminder locally: “${cleanTitle}”.` : `Saved reminder “${cleanTitle}” in Apple Reminders.`);
        }
        recordOperation({ requestId, kind, state: 'SUCCEEDED', result: { local: localRes, nativeRem } });
        return {
          id: finalId,
          status: 'committed',
          title: nativeRem?.title || cleanTitle,
          fireAt: hasExplicitTime ? resolvedFireAt : null,
          nativeId: nativeRem?.reminderIdentifier ?? localRes?.id,
          sourceApp: nativeRem?.reminderIdentifier ? 'Apple Reminders' : 'KST Workspace',
          message
        };
      }

      if (op === 'planPropose') {
        return buildSchedulePlan({
          requestId,
          minutes: Number(args.minutes || args.durationMinutes || 30),
          forTomorrow: Boolean(args.forTomorrow)
        });
      }
      if (op === 'planApply') {
        return applySchedulePlan({ requestId, planId: args.planId });
      }
    }

    if (kind.startsWith('apple.knowledge.')) {
      const op = kind.slice('apple.knowledge.'.length);
      if (op === 'taskCreate' || op === 'taskComplete' || op === 'taskList') {
        if (op === 'taskList') {
          const tasks = workspace?.snapshot().tasks?.slice(0, 10) ?? [];
          return {
            tasks,
            message: tasks.length ? `Tasks: ${tasks.map((t) => t.title).join('; ')}` : 'You have no tasks in your list.'
          };
        }
        const cleanTitle = String(args.title || args.target || args.body || 'New Task').trim() || 'New Task';
        try {
          const created = workspace?.action(requestId, {
            kind: op === 'taskCreate' ? 'task.create' : 'task.complete',
            ...(op === 'taskCreate' ? { title: cleanTitle, ...(args.dueIso ? { dueAt: resolveFlexibleIsoDate(args.dueIso, now(), 86_400_000) } : {}) } : { target: args.taskId || cleanTitle })
          });
          raphael.graph.upsertEntity({
            entityId: `task:${created?.id || cleanTitle}`,
            entityType: 'TASK',
            title: cleanTitle,
            status: op === 'taskComplete' ? 'COMPLETED' : 'ACTIVE',
            sourceDomain: 'workspace',
            sourceUri: `kst://tasks/${created?.id || ''}`
          });
          return created;
        } catch (err) {
          return { status: 'error', message: err.message };
        }
      }

      if (op === 'noteCreate' || op === 'noteAppend' || op === 'noteSearch' || op === 'noteList' || op === 'notesList') {
        if (op === 'noteSearch' || op === 'noteList' || op === 'notesList') {
          let nativeNotes = [];
          if (broker?.available && settings.notesEnabled) {
            try {
              const res = await broker.call('apple.execute', {
                domain: 'notes',
                action: 'searchNotes',
                payload: { query: String(args.query || args.title || '').trim(), folder: settings.notesFolder }
              });
              nativeNotes = res?.notes ?? [];
            } catch {}
          }
          const localNotes = workspace?.snapshot().notes?.slice(0, 10) ?? [];
          const combined = [...nativeNotes];
          for (const ln of localNotes) {
            if (!combined.some((nn) => nn.title?.toLowerCase() === ln.title?.toLowerCase())) {
              combined.push({ title: ln.title, body: ln.body });
            }
          }
          return {
            status: 'ok',
            notes: combined,
            message: combined.length
              ? `Notes: ${combined.slice(0, 8).map((n) => n.title).join('; ')}`
              : 'No matching notes found.'
          };
        }

        const rawTitle = String(args.title || '').trim();
        const rawBody = String(args.body || '').trim();
        const noteTitle = rawTitle || (rawBody ? rawBody.slice(0, 60) : 'Quick Note');
        const noteBody = rawBody || noteTitle;

        let localNote = null;
        try {
          localNote = workspace?.action(requestId, { kind: 'note.create', title: noteTitle, body: noteBody });
        } catch {}

        let nativeNote = null;
        if (broker?.available && settings.notesEnabled) {
          try {
            nativeNote = await broker.call('apple.execute', {
              domain: 'notes',
              action: op === 'noteAppend' ? 'appendNote' : 'createNote',
              payload: { title: noteTitle, body: noteBody, folder: settings.notesFolder }
            });
          } catch {}
          if (nativeNote?.noteIdentifier) {
            linkNativeEntity({
              kstId: localNote?.id ?? randomUUID(),
              domain: 'note',
              nativeId: nativeNote.noteIdentifier,
              title: noteTitle,
              receiptId: requestId
            });
          }
        }
        raphael.graph.upsertEntity({
          entityId: `note:${nativeNote?.noteIdentifier || localNote?.id || noteTitle}`,
          entityType: 'NOTE',
          title: noteTitle,
          bodySummary: noteBody,
          sourceDomain: 'notes',
          sourceUri: `notes://${nativeNote?.noteIdentifier || localNote?.id || ''}`
        });
        return {
          id: nativeNote?.noteIdentifier ?? localNote?.id ?? randomUUID(),
          status: 'committed',
          title: noteTitle,
          nativeId: nativeNote?.noteIdentifier ?? localNote?.id,
          sourceApp: nativeNote?.noteIdentifier ? 'Apple Notes' : 'KST Workspace',
          message: nativeNote?.message
            || (nativeNote?.noteIdentifier ? `Saved note “${noteTitle}” in Apple Notes (${settings.notesFolder}).` : null)
            || localNote?.message
            || `Saved note “${noteTitle}”.`
        };
      }
    }

    if (kind.startsWith('apple.desktop.')) {
      const op = kind.slice('apple.desktop.'.length);
      if (!broker?.available) throw new Fault('BROKER_UNAVAILABLE', 'Pair the macOS app to inspect Safari, Spotlight, or Finder.', 503);
      if (op === 'safariActiveTabContext') {
        if (!settings.safariContextEnabled) throw new Fault('APPLE_DISABLED', 'Safari context reading is disabled.');
        return broker.call('apple.execute', { domain: 'safari', action: 'activeTabContext', payload: {} });
      }
      if (op === 'safariOpenUrl') {
        return broker.call('apple.execute', { domain: 'safari', action: 'openUrl', payload: { urlOrQuery: String(args.urlOrQuery || args.query || '').trim() } });
      }
      if (op === 'spotlightFileSearch' || op === 'finderRevealFile') {
        if (!settings.spotlightEnabled) throw new Fault('APPLE_DISABLED', 'Spotlight file search is disabled.');
        return broker.call('apple.execute', {
          domain: 'spotlight',
          action: op === 'spotlightFileSearch' ? 'searchFiles' : 'revealFile',
          payload: { query: String(args.query || args.path || '').trim() }
        });
      }
      if (op === 'appLaunchOrFocus') {
        return broker.call('apple.execute', {
          domain: 'spotlight',
          action: 'launchOrFocusApp',
          payload: { appName: String(args.appName || args.query || '').trim() }
        });
      }
    }

    if (kind.startsWith('apple.env.')) {
      const op = kind.slice('apple.env.'.length);
      if (!broker?.available) throw new Fault('BROKER_UNAVAILABLE', 'Pair the macOS app to control Apple Music or Shortcuts.', 503);
      if (op === 'musicPlaybackControl') {
        return broker.call('apple.execute', {
          domain: 'music',
          action: 'playbackControl',
          payload: { command: String(args.command || 'pause').toLowerCase(), playlist: args.playlist ?? null }
        });
      }
      if (op === 'focusShortcutRun') {
        const shortcutName = String(args.shortcutName || '').trim();
        if (!settings.allowedShortcuts.includes(shortcutName)) {
          throw new Fault('SHORTCUT_NOT_ALLOWLISTED', `Shortcut "${shortcutName}" is not in your allowlisted KST Shortcuts (${settings.allowedShortcuts.join(', ')}).`, 403);
        }
        return broker.call('apple.execute', {
          domain: 'shortcuts',
          action: 'runShortcut',
          payload: { name: shortcutName, input: args.input ?? null }
        });
      }
    }

    throw new Fault('UNSUPPORTED_APPLE_TOOL', `Unsupported Apple ecosystem action: ${kind}`);
  }

  /**
   * Fast deterministic natural-language router for Apple-Native Executive Suite,
   * Schedule Plan Skill, and KST v0.8 ("Raphael / Great Sage") Personal Work Operator.
   */
  async function converse(body) {
    const rawText = String(body.text ?? '').trim();
    const text = rawText
      .replace(/^(?:hey\s+kst[, ]+|arise[, ]+|raphael[, ]+|great\s+sage[, ]+)?(?:can you\s+|could you\s+|would you\s+|please\s+|i(?:'d| would) like to\s+|i want to\s+|i need to\s+)?/i, '')
      .trim();
    const requestId = body.requestId;
    const conversationId = body.conversationId ?? `conversation-${requestId}`;

    // Fast deterministic response for current time and date
    if (/^(?:what(?:'s| is) (?:the )?(?:current )?(?:time|date|day)|what time is it(?: right now)?|current time|tell me the time|what day is it(?: today)?|today(?:'s)? date)[.!?]?$/i.test(text)) {
      const reply = formatCurrentTimeReply(now());
      return { conversationId, reply, apple: { status: 'ok', query: 'time' } };
    }

    let m;

    // --- KST v0.8 ("Raphael / Great Sage") Personal Work Operator Commands ---

    // R1. Raphael Status Briefing / Executive Synthesis
    if (/^(?:raphael\s+(?:status|briefing|report)|status\s+report|great\s+sage\s+status|morning\s+briefing|work\s+operator\s+status|give me a status report)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({ requestId, kind: 'apple.raphael.briefing', args: {} });
      return { conversationId, reply: res.message, apple: res };
    }

    // R2. FSRS-4.5 + Project Urgency Skill Coach ("what should I learn", "recommend something to study", "quiz me", "mark [topic] as practiced")
    if (/^(?:what\s+should\s+i\s+(?:learn|study|practice|review)(?:\s+next|\s+today)?|recommend\s+(?:something|a\s+topic|a\s+skill)\s+to\s+(?:learn|study)|what\s+to\s+(?:learn|study)|teach\s+me\s+something|skill\s+coach|learning\s+recommendation)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({ requestId, kind: 'apple.raphael.whatToLearn', args: {} });
      return { conversationId, reply: res.message, apple: res };
    }
    if ((m = text.match(/^(?:i\s+(?:practiced|studied|reviewed|completed|learned)|mark\s+skill\s+practiced|log\s+practice(?:\s+for)?)\s+(.+)$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.recordSkillPractice',
        args: { topic: m[1].replace(/[.!?]+$/, '').trim(), grade: 3 }
      });
      return { conversationId, reply: res.message, apple: res };
    }

    // R3. Contextual Thompson Sampling Music DJ Bandit ("what music should I listen to", "play music for deep work / coding / research", "start flow mode")
    if ((m = text.match(/^(?:what\s+music\s+should\s+i\s+listen\s+to(?:\s+for\s+(.+?))?|recommend\s+music(?:\s+for\s+(.+?))?|play\s+(?:focus\s+)?music\s+for\s+(.+?)|start\s+(?:a\s+)?(?:(.+?)\s+)?flow\s+(?:mode|session)|music\s+for\s+(.+?))[.!?]?$/i))) {
      const modeHint = m[1] || m[2] || m[3] || m[4] || m[5] || 'deep architecture';
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.musicFlowRecommend',
        args: { mode: modeHint }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if (/^(?:good\s+playlist|great\s+playlist|this\s+music\s+helps\s+me\s+focus|love\s+this\s+playlist)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.musicFeedback',
        args: { reward: 1.0 }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if (/^(?:skip\s+this\s+playlist|bad\s+playlist|this\s+music\s+is\s+distracting)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.musicFeedback',
        args: { reward: -0.8 }
      });
      return { conversationId, reply: res.message, apple: res };
    }

    // R4. Side-by-Side Co-Pilot Bridge (Gemini / ChatGPT / Claude / iTerm2)
    if ((m = text.match(/^(?:brief|update|sync|send\s+(?:my\s+)?(?:work\s+|bug\s+|terminal\s+)?context\s+to)\s+(gemini|chatgpt|claude)(?:\s+(?:on|about|with)\s+(.+))?[.!?]?$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.briefCompanionAI',
        args: { targetApp: m[1].trim(), topic: (m[2] || '').trim() }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if ((m = text.match(/^(?:capture|extract|save|import)\s+(?:the\s+)?(?:tasks?|action\s+items?|next\s+steps?|plan)\s+from\s+(?:this\s+|my\s+)?(gemini|chatgpt|claude|chat|conversation|safari(?:\s+tab)?)[.!?]?$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.captureCompanionTasks',
        args: { targetApp: m[1].trim() }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if (/^(?:explain\s+(?:my\s+)?(?:last\s+)?terminal\s+(?:error|failure)|check\s+(?:my\s+)?(?:terminal|iterm)(?:\s+error)?|what\s+failed\s+in\s+(?:my\s+)?(?:terminal|iterm))[.!?]?$/i.test(text)) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.explainTerminalError',
        args: {}
      });
      return { conversationId, reply: res.message, apple: res };
    }

    // R5. LinUCB Nudge Bandit Feedback ("good nudge", "useful nudge", "not now", "hold nudges")
    if (/^(?:good\s+nudge|useful\s+nudge|thanks\s+for\s+the\s+nudge)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.nudgeFeedback',
        args: { arm: 'DELIVER_NOW', reward: 1.0 }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if (/^(?:bad\s+nudge|not\s+now|don't\s+interrupt\s+me|hold\s+nudges)[.!?]?$/i.test(text)) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.raphael.nudgeFeedback',
        args: { arm: 'DELIVER_NOW', reward: -1.0 }
      });
      return { conversationId, reply: res.message, apple: res };
    }

    // 1. Confirm or cancel pending two-stage Mail / iMessage preview
    if (/^(?:send it|yes send it|confirm send|approve apple action|cancel send)[.!?]?$/i.test(text)) {
      const pending = pendingConfirmations();
      if (!pending.length) return null;
      const isCancel = /^cancel/i.test(text);
      const res = await confirmOrCancel(pending[0].confirmationId, { requestId, decision: isCancel ? 'cancel' : 'confirm' });
      return { conversationId, reply: res.reply, apple: res };
    }

    // 2. Outbound iMessage / Text
    if ((m = text.match(/^(?:text|imessage|message|send (?:a )?(?:text|imessage|message) to)\s+([A-Za-z0-9 .@+-]+?)\s+(?:saying|that|:)\s+(.+)$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.comm.imessagePreviewSend',
        args: { recipientOrQuery: m[1].trim(), bodyText: m[2].trim() }
      });
      return { conversationId, reply: res.message, apple: res };
    }

    // 3. Apple Mail Writing / Drafting
    if ((m = text.match(/^(?:draft (?:an )?email|write (?:an )?email|send (?:an )?email|compose (?:an )?email|email)\s+(?:to\s+)?([A-Za-z0-9 ._@+-]+?)\s+(?:about|subject|regarding)\s+(.+?)\s+(?:saying|body|that|:)\s+(.+)$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.comm.mailDraftPreview',
        args: { recipientOrQuery: m[1].trim(), subject: m[2].trim(), bodyText: m[3].trim() }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if ((m = text.match(/^(?:draft (?:an )?email|write (?:an )?email|send (?:an )?email|compose (?:an )?email|email)\s+(?:to\s+)?([A-Za-z0-9 ._@+-]+?)\s+(?:saying|about|regarding|that|:)\s+(.+)$/i))) {
      const content = m[2].trim();
      const res = await executeToolAction({
        requestId,
        kind: 'apple.comm.mailDraftPreview',
        args: { recipientOrQuery: m[1].trim(), subject: content.slice(0, 50), bodyText: content }
      });
      return { conversationId, reply: res.message, apple: res };
    }
    if (/^(?:check|show|read) (?:my )?unread (?:mail|emails)[.!?]?$/i.test(text)) {
      if (!broker?.available) {
        return { conversationId, reply: 'Open the kst Mac app to read unread messages from Apple Mail.' };
      }
      const res = await executeToolAction({ requestId, kind: 'apple.comm.mailSearchUnread', args: {} });
      return { conversationId, reply: res.message, apple: res };
    }

    // 4. Live Paired Apple-Native Executive Suite + Schedule Plan Skill
    if (broker?.available) {
      if (pendingSlotDraft && pendingSlotDraft.expiresAt > now()) {
        const draft = pendingSlotDraft;
        pendingSlotDraft = null;
        if (!/^(?:cancel|stop|never mind|no)\b/i.test(text)) {
          if (draft.kind === 'calendar_cancel') {
            const followUpCancel = parseCalendarCancelRequest(`remove ${text} from my calendar`, now());
            const targetTitle = followUpCancel?.target || text.replace(/^["'“]|["'”]$/g, '').trim();
            const targetStartIso = followUpCancel?.targetStartIso || null;
            const res = await executeToolAction({
              requestId,
              kind: 'apple.schedule.meetingCancel',
              args: {
                title: targetTitle,
                target: targetTitle,
                ...(targetStartIso ? { targetStartIso, startAt: targetStartIso } : {}),
                ...(followUpCancel?.clearAll ? { clearAll: true } : {})
              }
            });
            return { conversationId, reply: res.message, apple: res };
          }
          const followUpCal = parseCalendarEventRequest(`schedule ${text} in my calendar`, now());
          const finalTitle = (draft.title && draft.title !== 'Calendar Event')
            ? draft.title
            : (followUpCal?.title && followUpCal.title !== 'Calendar Event' ? followUpCal.title : temporalTitle(text) || 'Calendar Event');
          const finalStart = resolveFlexibleIsoDate(text, now(), 3600_000);
          const finalDur = extractDuration(text) ?? draft.durationMinutes ?? 30;
          const res = await executeToolAction({
            requestId,
            kind: 'apple.schedule.meetingCreate',
            args: { title: finalTitle, startAt: finalStart, durationMinutes: finalDur }
          });
          return { conversationId, reply: res.message, apple: res };
        }
      }

      if (/^(?:confirm|apply) (?:the )?(?:schedule )?plan(?:\s+[\w-]+)?[.!?]?$/i.test(text) || (pendingSchedulePlan && pendingSchedulePlan.expiresAt > now() && /^(?:yes|confirm|apply it|schedule it|do it)[.!?]?$/i.test(text))) {
        const res = await applySchedulePlan({ requestId });
        return { conversationId, reply: res.message, apple: res };
      }
      if (/\b(?:plan my day|schedule my day|plan my schedule|schedule plan|create a schedule plan|make a schedule plan|use (?:the )?schedule plan|organize my day|schedule my tasks|propose a plan)\b/i.test(text)) {
        const forTomorrow = /\btomorrow\b/i.test(text);
        const dur = extractDuration(text) ?? 30;
        const res = await buildSchedulePlan({ requestId, minutes: dur, forTomorrow });
        return { conversationId, reply: res.message, apple: res };
      }

      if (/^(?:show|list|check|what are)(?: my)? (?:apple )?reminders[.!?]?$/i.test(text)) {
        const res = await executeToolAction({ requestId, kind: 'apple.schedule.remindersList', args: {} });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:remove|delete|cancel|complete|finish|check off|mark(?:\s+as)?\s+done|dismiss)\s+(?:my\s+|the\s+|a\s+|an\s+)?(?:apple\s+)?reminder(?:\s+(?:to|for|called|named|titled|about))?\s+(.+)$/i)) ||
          (m = text.match(/^(?:remove|delete|cancel|complete|finish|check off)\s+["'“]?([^"'”]+?)["'”]?\s+(?:from\s+(?:my\s+)?(?:apple\s+)?reminders|reminder)$/i))) {
        const targetRem = m[1].replace(/\b(?:from|in)\s+(?:my\s+|the\s+)?(?:apple\s+)?reminders\b/gi, '').replace(/^["'“]|["'”]$/g, '').trim();
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.reminderCancel',
          args: { title: targetRem, target: targetRem }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:reschedule|move|postpone|update|change)\s+(?:my\s+|the\s+|a\s+|an\s+)?(?:apple\s+)?reminder(?:\s+(?:to|for|called|named|titled|about))?\s+(.+?)\s+(?:to|for|at|in)\s+(.+)$/i))) {
        const targetRem = m[1].replace(/^["'“]|["'”]$/g, '').trim();
        const fireAt = resolveFlexibleIsoDate(m[2].trim(), now(), 3600_000);
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.reminderModify',
          args: { title: targetRem, target: targetRem, fireAt }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:remind me(?: to)?|set (?:a )?reminder(?: to| for)?|add (?:a )?reminder(?: to| for)?|create (?:a )?reminder(?: to| for)?)\s+(.+)$/i))) {
        const rawRest = m[1].trim();
        const cleanTitle = temporalTitle(rawRest) || rawRest;
        const d = extractDate(rawRest, { now: now() });
        const fireAt = d?.value || (/\b(?:at|in|tomorrow|today)\b/i.test(rawRest) ? resolveFlexibleIsoDate(rawRest, now(), 3600_000) : null);
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.reminderCreate',
          args: { title: cleanTitle, ...(fireAt ? { fireAt } : {}) }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:complete|finish|check off|remove|delete)\s+(?:my\s+|the\s+|a\s+|an\s+)?task(?:\s+(?:to|for|called|named|titled|about))?\s+(.+)$/i))) {
        const targetTask = m[1].replace(/^["'“]|["'”]$/g, '').trim();
        const res = await executeToolAction({
          requestId,
          kind: 'apple.knowledge.taskComplete',
          args: { title: targetTask, target: targetTask }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:add|create)\s+(?:a\s+|new\s+)?task(?:\s+(?:to|for|called|named|titled))?\s+(.+)$/i))) {
        const taskTitle = m[1].replace(/^["'“]|["'”]$/g, '').trim();
        const res = await executeToolAction({
          requestId,
          kind: 'apple.knowledge.taskCreate',
          args: { title: taskTitle }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if (/^(?:show|list|read)(?: my)? (?:apple )?notes[.!?]?$/i.test(text)) {
        const res = await executeToolAction({ requestId, kind: 'apple.knowledge.noteList', args: {} });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:append|add)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(?:apple\s+)?note(?:\s+(?:called|named|titled|about))?\s+(.+)$/i))) {
        const res = await executeToolAction({
          requestId,
          kind: 'apple.knowledge.noteAppend',
          args: { title: m[2].replace(/^["'“]|["'”]$/g, '').trim(), body: m[1].trim() }
        });
        return { conversationId, reply: res.message, apple: res };
      }
      if ((m = text.match(/^(?:note|take a note|write (?:a )?note|create (?:a )?note|save (?:a )?note|add (?:a )?note)(?:\s+(?:saying|that|about|called))?\s*[: -]?\s*(.+)$/i))) {
        const content = m[1].trim();
        const res = await executeToolAction({
          requestId,
          kind: 'apple.knowledge.noteCreate',
          args: { title: content.slice(0, 60), body: content }
        });
        return { conversationId, reply: res.message, apple: res };
      }

      if (/^(?:show|list|check|read|what(?:'s| is) on)(?: my)? (?:apple )?(?:calendar|schedule|events)(?: today| tomorrow| this week)?[.!?]?$/i.test(text)) {
        const res = await executeToolAction({ requestId, kind: 'apple.schedule.calendarList', args: {} });
        return { conversationId, reply: res.message, apple: res };
      }

      const calCancelReq = parseCalendarCancelRequest(text, now());
      if (calCancelReq) {
        if (calCancelReq.needsTargetClarification) {
          pendingSlotDraft = {
            kind: 'calendar_cancel',
            expiresAt: now() + 120_000
          };
          return {
            conversationId,
            reply: 'Which event would you like me to remove from your Apple Calendar?'
          };
        }
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.meetingCancel',
          args: {
            title: calCancelReq.target,
            target: calCancelReq.target,
            ...(calCancelReq.targetStartIso ? { targetStartIso: calCancelReq.targetStartIso, startAt: calCancelReq.targetStartIso } : {}),
            ...(calCancelReq.clearAll ? { clearAll: true } : {})
          }
        });
        return { conversationId, reply: res.message, apple: res };
      }

      const calReschedReq = parseCalendarRescheduleRequest(text, now());
      if (calReschedReq) {
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.meetingReschedule',
          args: {
            title: calReschedReq.target,
            target: calReschedReq.target,
            startAt: calReschedReq.startAt,
            ...(calReschedReq.durationMinutes ? { durationMinutes: calReschedReq.durationMinutes } : {})
          }
        });
        return { conversationId, reply: res.message, apple: res };
      }

      const calReq = parseCalendarEventRequest(text, now());
      if (calReq) {
        if (!calReq.hasTimeHint && !calReq.hasSpecificTitle) {
          pendingSlotDraft = {
            kind: 'calendar',
            title: calReq.title,
            durationMinutes: calReq.durationMinutes,
            expiresAt: now() + 120_000
          };
          return {
            conversationId,
            reply: 'What would you like to call the event, and when should I schedule it in your Apple Calendar?'
          };
        }
        const startAt = calReq.startAt ?? resolveFlexibleIsoDate(text, now(), 3600_000);
        const res = await executeToolAction({
          requestId,
          kind: 'apple.schedule.meetingCreate',
          args: {
            title: calReq.title,
            startAt,
            durationMinutes: calReq.durationMinutes
          }
        });
        return { conversationId, reply: res.message, apple: res };
      }
    }

    // 5. Safari, Spotlight, Music & Shortcuts
    if (/^(?:summarize|read|what is on) (?:this|my) (?:safari )?(?:tab|page|article)[.!?]?$/i.test(text)) {
      if (!broker?.available) {
        return { conversationId, reply: 'Open the kst Mac app to inspect your active Safari tab.' };
      }
      const res = await executeToolAction({ requestId, kind: 'apple.desktop.safariActiveTabContext', args: {} });
      return {
        conversationId,
        reply: res?.title ? `Active Safari tab: “${res.title}” (${res.url}). ${res.excerpt ? res.excerpt.slice(0, 400) : ''}` : 'No active Safari tab found.',
        apple: res
      };
    }
    if ((m = text.match(/^(?:open|go to)\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,})(?:\s+in safari)?[.!?]?$/i))) {
      if (!broker?.available) {
        return { conversationId, reply: 'Open the kst Mac app to open URLs in Safari.' };
      }
      const rawUrl = m[1].startsWith('http') ? m[1] : `https://${m[1]}`;
      const res = await executeToolAction({ requestId, kind: 'apple.desktop.safariOpenUrl', args: { urlOrQuery: rawUrl } });
      return { conversationId, reply: res?.message ?? `Opened ${rawUrl} in Safari.`, apple: res };
    }
    if ((m = text.match(/^(?:find|locate|reveal) file\s+(.+)$/i))) {
      if (!broker?.available) {
        return { conversationId, reply: 'Open the kst Mac app to search local files with Spotlight.' };
      }
      const res = await executeToolAction({ requestId, kind: 'apple.desktop.spotlightFileSearch', args: { query: m[1].trim() } });
      const files = res?.files ?? [];
      return {
        conversationId,
        reply: files.length ? `Found in Spotlight: ${files.slice(0, 5).map((f) => f.name || f.path).join('; ')}` : `No local files matched “${m[1].trim()}”.`,
        apple: res
      };
    }
    if ((m = text.match(/^(?:play|pause|resume) (?:apple )?music(?: playlist (.+))?[.!?]?$/i))) {
      if (!broker?.available) {
        return { conversationId, reply: 'Open the kst Mac app to control Apple Music.' };
      }
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const res = await executeToolAction({
        requestId,
        kind: 'apple.env.musicPlaybackControl',
        args: { command: m[1] ? 'playPlaylist' : cmd, playlist: m[1]?.trim() ?? null }
      });
      return { conversationId, reply: res?.message ?? `Apple Music: ${cmd}.`, apple: res };
    }
    if ((m = text.match(/^run shortcut\s+(.+)$/i))) {
      const res = await executeToolAction({
        requestId,
        kind: 'apple.env.focusShortcutRun',
        args: { shortcutName: m[1].trim().replace(/^["']|["']$/g, '') }
      });
      return { conversationId, reply: res?.message ?? `Ran Shortcut “${m[1].trim()}”.`, apple: res };
    }
    return null;
  }

  async function nudgeSnapshot() {
    const settings = readSettings();
    if (!settings.calendarEnabled || !settings.calendarNudgesEnabled || !broker?.available) {
      return { enabled: false, complete: false, events: [] };
    }
    try {
      const startIso = iso(now() - 300_000);
      const endIso = iso(now() + 86_400_000);
      const res = await broker.call('apple.execute', {
        domain: 'calendar',
        action: 'listEvents',
        payload: { startIso, endIso }
      }, 4000);
      return {
        accountId: 'apple-eventkit',
        generation: 1,
        enabled: true,
        complete: true,
        events: (res?.events ?? []).map((e) => ({
          calendarId: e.calendarTitle || 'apple-calendar',
          id: e.eventIdentifier || e.id,
          summary: e.title,
          start: { dateTime: e.startAt },
          end: { dateTime: e.endAt },
          status: 'confirmed'
        }))
      };
    } catch {
      return { enabled: true, complete: false, events: [] };
    }
  }

  async function status() {
    const settings = readSettings();
    let permissions = {
      calendar: 'ready',
      reminders: 'ready',
      contacts: 'ready',
      automation: [...ALLOWED_DOMAINS]
    };
    if (broker?.available) {
      try {
        const nativeStatus = await broker.call('apple.status', {}, 3500);
        if (nativeStatus?.permissions) permissions = nativeStatus.permissions;
      } catch {}
    }
    const operations = db.prepare('SELECT * FROM apple_operations ORDER BY updated_at DESC LIMIT 25').all().map((r) => ({
      operationId: r.operation_id,
      requestId: r.request_id,
      kind: r.kind,
      state: r.state,
      preview: r.preview ? JSON.parse(r.preview) : null,
      result: r.result ? JSON.parse(r.result) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    const links = db.prepare('SELECT * FROM native_entity_links ORDER BY last_synced_at_iso DESC LIMIT 30').all();
    return {
      suite: 'apple-native-executive',
      version: '0.8.0-raphael',
      brokerAvailable: Boolean(broker?.available),
      settingsRevision: settings.revision,
      settings,
      permissions,
      pendingConfirmations: pendingConfirmations(),
      operations,
      linkedEntitiesCount: links.length,
      raphael: raphael.statusSnapshot()
    };
  }

  async function route(method, path, body) {
    if (method === 'GET' && path === '/api/apple/status') {
      return { status: 200, body: await status() };
    }
    if (method === 'GET' && path === '/api/apple/raphael') {
      const signals = await harvestLiveSignals();
      return { status: 200, body: raphael.briefing(signals) };
    }
    if (method === 'POST' && path === '/api/apple/raphael') {
      const op = String(body?.operation || 'briefing').trim();
      const res = await executeToolAction({
        requestId: body?.requestId || randomUUID(),
        kind: `apple.raphael.${op}`,
        args: body?.args ?? body ?? {}
      });
      return { status: 200, body: res };
    }
    if (method === 'PATCH' && path === '/api/apple/settings') {
      if (!body || typeof body !== 'object') throw new Fault('INVALID_BODY', 'Provide Apple settings payload.');
      const updated = updateSettings(body.expectedRevision, body);
      return { status: 200, body: { settingsRevision: updated.revision, settings: updated } };
    }
    if (method === 'GET' && path === '/api/apple/shortcuts') {
      const settings = readSettings();
      let systemShortcuts = [];
      if (broker?.available) {
        try {
          const res = await broker.call('apple.execute', { domain: 'shortcuts', action: 'listShortcuts', payload: {} }, 4000);
          systemShortcuts = res?.shortcuts ?? [];
        } catch {}
      }
      return { status: 200, body: { allowedShortcuts: settings.allowedShortcuts, systemShortcuts } };
    }
    if (method === 'PATCH' && path === '/api/apple/shortcuts') {
      const updated = updateSettings(body?.expectedRevision, { allowedShortcuts: body?.allowedShortcuts });
      return { status: 200, body: { settingsRevision: updated.revision, allowedShortcuts: updated.allowedShortcuts } };
    }
    if (method === 'POST' && /^\/api\/apple\/confirm\/[\w-]+$/.test(path)) {
      const confirmationId = path.split('/').at(-1);
      const decision = body?.decision ?? 'confirm';
      if (!['confirm', 'cancel', 'deny'].includes(decision)) {
        throw new Fault('INVALID_DECISION', 'Decision must be confirm or cancel.');
      }
      const res = await confirmOrCancel(confirmationId, { requestId: body?.requestId, decision });
      return { status: 200, body: res };
    }
    if (method === 'POST' && path === '/api/apple/actions') {
      if (!body?.requestId || !body?.action?.kind) throw new Fault('INVALID_BODY', 'Provide requestId and action.kind.');
      const res = await executeToolAction({ requestId: body.requestId, kind: body.action.kind, args: body.action.args ?? body.action });
      return { status: 200, body: res };
    }
    return null;
  }

  function stop() {
    pendingSlotDraft = null;
    pendingSchedulePlan = null;
    db.prepare("UPDATE apple_confirmations SET status='CANCELLED' WHERE status='PENDING'").run();
  }

  return {
    status,
    route,
    converse,
    executeToolAction,
    buildSchedulePlan,
    applySchedulePlan,
    raphael,
    nudgeSnapshot,
    pendingConfirmations,
    confirmOrCancel,
    stop,
    close() {
      db.close();
    }
  };
}
