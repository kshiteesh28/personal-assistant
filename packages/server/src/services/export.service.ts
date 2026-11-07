import { ExportPayload } from '@secretary/shared';
import { Database } from 'bun:sqlite';
import { logger } from '../config/logger';
import { getConfig } from '../config';

/**
 * ExportService serialises the entire secretary database into a portable JSON payload.
 * The payload can be stored as a backup or imported on a different device.
 */
export class ExportService {
  constructor(private readonly db: Database) {}

  async exportAll(): Promise<ExportPayload> {
    logger.info('[ExportService] Starting full export');

    const events   = this.db.query('SELECT * FROM events ORDER BY start_ts').all();
    const tasks    = this.db.query('SELECT * FROM tasks ORDER BY position, created_at').all();
    const reminders = this.db.query('SELECT * FROM reminders ORDER BY trigger_ts').all();
    const notes    = this.db.query('SELECT * FROM notes ORDER BY updated_at DESC').all();
    const notesTasks = this.db.query('SELECT * FROM notes_tasks').all();

    // Safely get config without sensitive tokens
    const rawConfig = getConfig() as any;
    const safeConfig = { ...rawConfig };
    delete safeConfig.server; // strip auth tokens

    const payload: ExportPayload = {
      version: 2,
      entities: {
        events:      events as any[],
        tasks:       tasks as any[],
        reminders:   reminders as any[],
        notes:       notes as any[],
        notes_tasks: notesTasks as any[],
      },
      config: safeConfig,
    };

    logger.info(`[ExportService] Export complete: ${events.length} events, ${tasks.length} tasks, ${notes.length} notes, ${reminders.length} reminders`);
    return payload;
  }

  exportToJson(): string {
    return JSON.stringify(this.exportAll(), null, 2);
  }
}
