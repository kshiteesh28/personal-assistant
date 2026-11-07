import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export interface DowntimeItem {
  id: string;
  title: string;
  category: string;
  estimated_mins: number;
  priority: number;
  status: string;
  created_at: number;
}

export class DowntimePipelineRepository extends BaseRepository<DowntimeItem> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'downtime_pipeline');
  }

  findByStatus(status: string): DowntimeItem[] {
    return this.db.query<DowntimeItem, any>(`SELECT * FROM downtime_pipeline WHERE status = $status ORDER BY priority ASC, created_at ASC`).all({ $status: status });
  }

  findSuggestions(maxMins: number): DowntimeItem[] {
    return this.db.query<DowntimeItem, any>(`
      SELECT * FROM downtime_pipeline 
      WHERE status = 'queued' AND estimated_mins <= $maxMins
      ORDER BY priority ASC, created_at ASC
    `).all({ $maxMins: maxMins });
  }

  create(title: string, category: string = 'research', estimated_mins: number = 30, priority: number = 2): DowntimeItem {
    const id = randomUUID();
    const created_at = Date.now();
    const status = 'queued';

    this.db.query(`
      INSERT INTO downtime_pipeline (id, title, category, estimated_mins, priority, status, created_at)
      VALUES ($id, $title, $cat, $mins, $prio, $status, $ca)
    `).run({
      $id: id,
      $title: title,
      $cat: category,
      $mins: estimated_mins,
      $prio: priority,
      $status: status,
      $ca: created_at
    });

    return { id, title, category, estimated_mins, priority, status, created_at };
  }

  markComplete(id: string): void {
    this.db.query(`UPDATE downtime_pipeline SET status = 'completed' WHERE id = $id`).run({ $id: id });
  }
}
