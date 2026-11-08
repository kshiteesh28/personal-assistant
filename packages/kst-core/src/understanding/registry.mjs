import { createHash } from 'node:crypto';
export const INTENTS = Object.freeze(['other','task.create','task.complete','tasks.list','note.create','notes.list','reminder.create','reminder.reschedule','reminder.snooze','reminder.cancel','reminders.list','meeting.create','meeting.reschedule','meeting.cancel','calendar.list','timeline.list','plan.propose','plan.apply','web.search','terminal.runRecipe','terminal.inventory','terminal.cancelJob','external.request','external.results','source.read','help','status']);
export const LABELS = Object.freeze([...INTENTS,null,null,null,null,null]);
export const REGISTRY_HASH = createHash('sha256').update(JSON.stringify(LABELS)).digest();
export const AUTOMATIC_LABELS = Object.freeze([3,5,10,14,15,18,23,24,25,26]);
export function resolveLabel(value) { const id = typeof value === 'number' ? value : INTENTS.indexOf(value); if (!Number.isInteger(id)||id<0||id>=27) throw new RangeError('Invalid intent'); return id; }
export const CONSTANTS = Object.freeze({dimensions:4096,classes:32,enabled:27,featureSchemaVersion:1,registryVersion:1,artifactBytes:132224,maxFeatures:128});
export function understandingMode(value = process.env.KST_UNDERSTANDING_MODE ?? 'shadow') { if (!['off','shadow','active'].includes(value)) throw new Error('Invalid KST_UNDERSTANDING_MODE'); return value; }
