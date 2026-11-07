import { Type, Static } from '@sinclair/typebox';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { logger } from './logger';

export const ConfigSchema = Type.Object({
  server: Type.Object({
    port: Type.Number({ default: 3000 }),
    host: Type.String({ default: '127.0.0.1' }),
    authToken: Type.Optional(Type.String())
  }),
  letta: Type.Object({
    enabled: Type.Boolean({ default: false }),
    baseUrl: Type.Optional(Type.String()),
    nluTimeoutMs: Type.Number({ default: 10000 }),
    briefTimeoutMs: Type.Number({ default: 10000 })
  }),
  integrations: Type.Object({
    jira: Type.Object({ enabled: Type.Boolean({ default: false }) }),
    outlook: Type.Object({
      enabled: Type.Boolean({ default: false }),
      mode: Type.Optional(Type.String()), // "copilot"|"com"|"ics"|"graph"
      accessToken: Type.Optional(Type.String()),
      icsUrl: Type.Optional(Type.String())
    }),
    loop: Type.Object({ enabled: Type.Boolean({ default: false }) })
  }),
  tracking: Type.Object({
    enabled: Type.Boolean({ default: false }),
    samplingIntervalMs: Type.Number({ default: 60000 }),
    focusBlockMaxMinutes: Type.Number({ default: 90 })
  }),
  notifications: Type.Object({
    dailyBriefTime: Type.String({ default: '08:00' }),
    preMeetingMinutes: Type.Number({ default: 5 }),
    triggers: Type.Object({
      dailyBrief: Type.Boolean({ default: true }),
      preMeeting: Type.Boolean({ default: true }),
      breakReminder: Type.Boolean({ default: true }),
      reminderDue: Type.Boolean({ default: true })
    })
  }),
  proactive: Type.Object({
    enabled: Type.Boolean({ default: false }),
    workHoursStart: Type.String({ default: '08:00' }),
    workHoursEnd: Type.String({ default: '23:00' }),
    morningKickoffTime: Type.String({ default: '08:30' }),
    middayBoostTime: Type.String({ default: '13:00' }),
    endOfDaySummaryTime: Type.String({ default: '17:30' }),
    signOffTime: Type.String({ default: '22:00' }),
    wellnessIntervalMin: Type.Number({ default: 30 }),
    taskCheckinCooldownMin: Type.Number({ default: 180 }),
    breakReminderCooldownMin: Type.Number({ default: 45 }),
    motivationIntervalMin: Type.Number({ default: 120 }),
    summaryIntervalMin: Type.Number({ default: 240 }),
    wellnessEnabled: Type.Boolean({ default: true }),
    breakEnabled: Type.Boolean({ default: true }),
    checkinEnabled: Type.Boolean({ default: true }),
    motivationEnabled: Type.Boolean({ default: true }),
    summaryEnabled: Type.Boolean({ default: true }),
    useCopilotForAnalysis: Type.Boolean({ default: false }),
    suppressDuringPresentation: Type.Boolean({ default: true }),
    scheduleDayStart: Type.String({ default: '08:00' }),
    scheduleDayEnd: Type.String({ default: '23:00' }),
    scheduleBufferBeforeMeetingMin: Type.Number({ default: 10 }),
    scheduleBufferAfterMeetingMin: Type.Number({ default: 5 }),
    scheduleLunchStartTime: Type.String({ default: '12:00' }),
    scheduleLunchDurationMin: Type.Number({ default: 30 }),
    scheduleDinnerStartTime: Type.String({ default: '19:00' }),
    scheduleDinnerDurationMin: Type.Number({ default: 30 }),
    scheduleMorningEnd: Type.String({ default: '13:00' }),
    scheduleEveningStart: Type.String({ default: '17:00' }),
    scheduleWeights: Type.Object({
      urgency: Type.Number({ default: 3 }),
      importance: Type.Number({ default: 3 }),
      deadline_pressure: Type.Number({ default: 2 }),
      energy_fit: Type.Number({ default: 1.5 }),
      context_bonus: Type.Number({ default: 1 }),
      time_pref_fit: Type.Number({ default: 1.5 })
    })
  }),
  nudgeAppearance: Type.Object({
    position: Type.String({ default: 'bottom-right' }),
    bgColor: Type.Optional(Type.String()),
    textColor: Type.Optional(Type.String()),
    accentColor: Type.Optional(Type.String()),
    borderRadius: Type.Optional(Type.String()),
    fontSize: Type.Optional(Type.String()),
    soundEnabled: Type.Boolean({ default: true }),
    soundName: Type.Optional(Type.String()),
    customSoundDataUrl: Type.Optional(Type.String())
  }),
  nudgeMessages: Type.Object({
    wellness: Type.Object({
      walk: Type.Array(Type.String(), { default: [] }),
      water: Type.Array(Type.String(), { default: [] }),
      workout: Type.Array(Type.String(), { default: [] }),
      meditate: Type.Array(Type.String(), { default: [] }),
      stretch: Type.Array(Type.String(), { default: [] })
    }),
    break: Type.Array(Type.String(), { default: [] }),
    checkin: Type.Array(Type.String(), { default: [] }),
    motivation: Type.Object({
      morning: Type.Array(Type.String(), { default: [] }),
      midday: Type.Array(Type.String(), { default: [] }),
      signoff: Type.Array(Type.String(), { default: [] })
    })
  }),
  theme: Type.String({ default: 'apple' }),
  voice: Type.Object({
    enabled: Type.Boolean({ default: true }),
    alwaysOn: Type.Boolean({ default: false }),
    wakeWord: Type.String({ default: 'secretary' }),
    whisperModelPath: Type.Optional(Type.String()),
    whisperBinaryPath: Type.Optional(Type.String()),
    ttsEnabled: Type.Boolean({ default: false }),
    ttsVoice: Type.Optional(Type.String()),
    language: Type.String({ default: 'en' })
  })
});

export type Config = Static<typeof ConfigSchema>;

function deepMerge(target: any, source: any): any {
  if (typeof target !== 'object' || target === null) return source;
  if (typeof source !== 'object' || source === null) return target;
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Array) {
      target[key] = source[key];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function getConfigPath(): string {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
  return join(process.cwd(), "..", "..", "config.json");
}

export function loadConfig(configPath?: string): Config {
  const p = configPath || getConfigPath();
  let userConfig = {};
  if (existsSync(p)) {
    try {
      userConfig = JSON.parse(readFileSync(p, 'utf-8'));
    } catch (e: any) {
      logger.error(`Failed to parse config at ${p}: ${e.message}`);
    }
  }

  const defaultValues = {
    server: { port: 3000, host: '127.0.0.1' },
    letta: { enabled: false, nluTimeoutMs: 10000, briefTimeoutMs: 10000 },
    integrations: {
      jira: { enabled: false },
      outlook: { enabled: false },
      loop: { enabled: false }
    },
    tracking: { enabled: false, samplingIntervalMs: 60000, focusBlockMaxMinutes: 90 },
    notifications: {
      dailyBriefTime: '08:00',
      preMeetingMinutes: 5,
      triggers: { dailyBrief: true, preMeeting: true, breakReminder: true, reminderDue: true }
    },
    proactive: {
      enabled: false, workHoursStart: '08:00', workHoursEnd: '23:00',
      morningKickoffTime: '08:30', middayBoostTime: '13:00', 
      endOfDaySummaryTime: '17:30', signOffTime: '22:00',
      wellnessIntervalMin: 30, taskCheckinCooldownMin: 180, 
      breakReminderCooldownMin: 45, motivationIntervalMin: 120, summaryIntervalMin: 240,
      wellnessEnabled: true, breakEnabled: true, checkinEnabled: true, 
      motivationEnabled: true, summaryEnabled: true, useCopilotForAnalysis: false,
      suppressDuringPresentation: true, scheduleDayStart: '08:00', scheduleDayEnd: '23:00',
      scheduleBufferBeforeMeetingMin: 10, scheduleBufferAfterMeetingMin: 5,
      scheduleLunchStartTime: '12:00', scheduleLunchDurationMin: 30,
      scheduleDinnerStartTime: '19:00', scheduleDinnerDurationMin: 30,
      scheduleMorningEnd: '13:00', scheduleEveningStart: '17:00',
      scheduleWeights: { urgency: 3, importance: 3, deadline_pressure: 2, energy_fit: 1.5, context_bonus: 1, time_pref_fit: 1.5 }
    },
    nudgeAppearance: { position: 'bottom-right', soundEnabled: true },
    nudgeMessages: {
      wellness: { walk: [], water: [], workout: [], meditate: [], stretch: [] },
      break: [], checkin: [],
      motivation: { morning: [], midday: [], signoff: [] }
    },
    theme: 'apple',
    voice: { enabled: true, alwaysOn: false, wakeWord: 'flow state', ttsEnabled: false, language: 'en' }
  };

  const merged = deepMerge(defaultValues, userConfig) as Config;
  
  let needsSave = false;
  if (!merged.server.authToken) {
    merged.server.authToken = randomBytes(32).toString('hex');
    needsSave = true;
  }

  if (needsSave || !existsSync(p)) {
    try {
      writeFileSync(p, JSON.stringify(merged, null, 2), 'utf-8');
      logger.info(`Saved updated config to ${p}`);
    } catch (e: any) {
      logger.error(`Failed to save config to ${p}: ${e.message}`);
    }
  }

  return merged;
}

let activeConfig: Config | null = null;
export function getConfig(): Config {
  if (!activeConfig) activeConfig = loadConfig();
  return activeConfig;
}

export function setConfig(newConfig: Config) {
  activeConfig = newConfig;
}
