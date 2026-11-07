import { ExportPayload, ImportRequest, ImportConflict, ImportResult } from '@secretary/shared';
import { Database } from 'bun:sqlite';
import { logger } from '../config/logger';
import { randomUUID } from 'crypto';

/**
 * ImportService merges or replaces local DB data from an ExportPayload.
 * Conflict detection (same id, different updated_at) handled before write.
 */
export class ImportService {
  constructor(private readonly db: Database) {}

  async detectConflicts(entities: ExportPayload['entities']): Promise<ImportConflict[]> {
    const conflicts: ImportConflict[] = [];

    const check = (tableName: string, rows: any[]) => {
      for (const row of rows) {
        const local = this.db.query(`SELECT updated_at FROM ${tableName} WHERE id = ?`).get(row.id) as any;
        if (local && local.updated_at !== row.updated_at) {
          conflicts.push({
            entity: tableName,
            id: row.id,
            local_updated_at: local.updated_at,
            export_updated_at: row.updated_at,
          });
        }
      }
    };

    check('events', entities.events ?? []);
    check('tasks', entities.tasks ?? []);
    check('reminders', entities.reminders ?? []);
    check('notes', entities.notes ?? []);

    return conflicts;
  }

  async importData(request: ImportRequest): Promise<ImportResult> {
    const { payload, mode, conflict_resolution = 'keep_local', conflict_decisions = {} } = request;
    const entities = payload.entities;

    logger.info(`[ImportService] Starting import mode=${mode}`);

    if (mode === 'replace') {
      return this.replaceAll(entities);
    }

    // Merge with conflict resolution
    const conflicts = await this.detectConflicts(entities);
    const unresolvedConflicts = conflicts.filter(c => {
      const decision = (conflict_decisions[c.id] ?? conflict_resolution) as string;
      return decision === 'ask';
    });

    if (unresolvedConflicts.length > 0) {
      return { success: false, conflicts: unresolvedConflicts, message: 'Conflicts require resolution' };
    }

    return this.mergeAll(entities, conflict_resolution, conflict_decisions);
  }

  private replaceAll(entities: ExportPayload['entities']): ImportResult {
    try {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM notes_tasks');
        this.db.exec('DELETE FROM notes');
        this.db.exec('DELETE FROM reminders');
        this.db.exec('DELETE FROM tasks');
        this.db.exec('DELETE FROM events');

        this.insertEntities(entities);
      })();

      logger.info('[ImportService] Replace complete');
      return { success: true, message: 'Data replaced successfully' };
    } catch (err) {
      logger.error(`[ImportService] Replace failed: ${err}`);
      return { success: false, message: `Import failed: ${err}` };
    }
  }

  private mergeAll(
    entities: ExportPayload['entities'],
    defaultResolution: string,
    decisions: Record<string, string>,
  ): ImportResult {
    try {
      this.db.transaction(() => {
        const upsert = (tableName: string, rows: any[], columns: string[]) => {
          for (const row of rows) {
            const decision = decisions[row.id] ?? defaultResolution;
            if (decision === 'keep_local') {
              const exists = this.db.query(`SELECT id FROM ${tableName} WHERE id = ?`).get(row.id);
              if (exists) continue; // skip, keep local
            }
            const cols = columns.join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const vals = columns.map(c => row[c] ?? null);
            this.db.prepare(`INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES (${placeholders})`).run(...vals);
          }
        };

        upsert('events', entities.events ?? [], ['id','title','start_ts','end_ts','all_day','recurrence_rule','location','description','created_at','updated_at']);
        upsert('tasks', entities.tasks ?? [], ['id','title','due_ts','priority','status','project','tags','position','time_estimate','energy_level','task_type','is_splittable','context','time_preference','pinned_time','progress','created_at','updated_at']);
        upsert('reminders', entities.reminders ?? [], ['id','title','trigger_ts','repeat_rule','linked_event_id','status','snooze_until_ts','created_at','updated_at']);
        upsert('notes', entities.notes ?? [], ['id','title','body','linked_event_id','created_at','updated_at']);
      })();

      logger.info('[ImportService] Merge complete');
      return { success: true, message: 'Data merged successfully' };
    } catch (err) {
      logger.error(`[ImportService] Merge failed: ${err}`);
      return { success: false, message: `Import failed: ${err}` };
    }
  }

  private insertEntities(entities: ExportPayload['entities']): void {
    const now = Date.now();
    for (const e of entities.events ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO events (id,title,start_ts,end_ts,all_day,recurrence_rule,location,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(e.id ?? randomUUID(), e.title, e.start_ts, e.end_ts, e.all_day ? 1 : 0, e.recurrence_rule ?? null, e.location ?? null, e.description ?? null, e.created_at ?? now, e.updated_at ?? now);
    }
    for (const t of entities.tasks ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO tasks (id,title,due_ts,priority,status,project,tags,position,time_estimate,energy_level,task_type,is_splittable,context,time_preference,pinned_time,progress,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(t.id ?? randomUUID(), t.title, t.due_ts ?? null, t.priority ?? 2, t.status ?? 'todo', t.project ?? null, t.tags ?? null, t.position ?? 0, t.time_estimate ?? 30, t.energy_level ?? 'medium', t.task_type ?? 'deep_work', t.is_splittable ? 1 : 0, t.context ?? null, t.time_preference ?? 'either', t.pinned_time ?? null, t.progress ?? 0, t.created_at ?? now, t.updated_at ?? now);
    }
    for (const r of entities.reminders ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO reminders (id,title,trigger_ts,repeat_rule,linked_event_id,status,snooze_until_ts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(r.id ?? randomUUID(), r.title, r.trigger_ts, r.repeat_rule ?? null, r.linked_event_id ?? null, r.status ?? 'active', r.snooze_until_ts ?? null, r.created_at ?? now, r.updated_at ?? now);
    }
    for (const n of entities.notes ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO notes (id,title,body,linked_event_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(n.id ?? randomUUID(), n.title, n.body ?? '', n.linked_event_id ?? null, n.created_at ?? now, n.updated_at ?? now);
    }
  }
}
