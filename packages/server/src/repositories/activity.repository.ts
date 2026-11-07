import { BaseRepository } from './base.repository';

export interface ActivitySession {
  id?: number;
  activity_type: string;
  start_ts: number;
  end_ts: number;
  source: string;
  app_name?: string;
  window_title?: string;
  process_name?: string;
}

export interface ActivityCategory {
  id?: number;
  name: string;
  match_rules: string;
  is_predefined: boolean;
  is_discovered: boolean;
  enabled: boolean;
  created_at: number;
}

export class ActivityRepository extends BaseRepository<any> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'activity_sessions');
  }

  getCategories(): ActivityCategory[] {
    return this.db.query<ActivityCategory, any>(`SELECT * FROM activity_categories WHERE enabled = 1`).all().map(c => ({
      ...c,
      is_predefined: Boolean(c.is_predefined),
      is_discovered: Boolean(c.is_discovered),
      enabled: Boolean(c.enabled)
    }));
  }

  createSession(session: Omit<ActivitySession, 'id'>): number {
    const info = this.db.query(`
      INSERT INTO activity_sessions (activity_type, start_ts, end_ts, source, app_name, window_title, process_name)
      VALUES ($type, $start, $end, $source, $app, $title, $proc)
    `).run({
      $type: session.activity_type,
      $start: session.start_ts,
      $end: session.end_ts,
      $source: session.source,
      $app: session.app_name || null,
      $title: session.window_title || null,
      $proc: session.process_name || null
    });
    return Number(info.lastInsertRowid);
  }

  updateSessionEndTs(id: number, endTs: number) {
    this.db.query(`UPDATE activity_sessions SET end_ts = $end WHERE id = $id`).run({ $end: endTs, $id: id });
  }

  getSummaryForDate(startMs: number, endMs: number): Record<string, number> {
    const rows = this.db.query<{activity_type: string, duration: number}, any>(`
      SELECT activity_type, SUM(end_ts - start_ts) as duration
      FROM activity_sessions
      WHERE start_ts >= $start AND start_ts <= $end
      GROUP BY activity_type
    `).all({ $start: startMs, $end: endMs });
    
    const summary: Record<string, number> = {};
    for (const r of rows) {
      summary[r.activity_type] = Math.round(r.duration / 60000); // minutes
    }
    return summary;
  }
}
