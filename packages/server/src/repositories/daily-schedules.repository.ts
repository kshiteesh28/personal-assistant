import { DailySchedule, ScheduleBlock, OverflowSuggestion } from '@secretary/shared';
import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export class DailySchedulesRepository extends BaseRepository<DailySchedule> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'daily_schedules');
  }

  findByDate(date: string): DailySchedule | null {
    const row = this.db.query<{id: string, date: string, blocks: string, overflow: string, created_at: number, updated_at: number}, any>(
      `SELECT * FROM daily_schedules WHERE date = $date`
    ).get({ $date: date });

    if (!row) return null;

    return {
      id: row.id,
      date: row.date,
      blocks: JSON.parse(row.blocks),
      overflow: JSON.parse(row.overflow),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  upsert(date: string, blocks: ScheduleBlock[], overflow: OverflowSuggestion[]): DailySchedule {
    const now = Date.now();
    const existing = this.findByDate(date);
    const blocksJson = JSON.stringify(blocks);
    const overflowJson = JSON.stringify(overflow);
    
    let id: string;

    if (existing) {
      id = existing.id;
      this.db.query(`
        UPDATE daily_schedules 
        SET blocks = $blocks, overflow = $overflow, updated_at = $updated_at
        WHERE id = $id
      `).run({
        $id: id,
        $blocks: blocksJson,
        $overflow: overflowJson,
        $updated_at: now
      });
    } else {
      id = randomUUID();
      this.db.query(`
        INSERT INTO daily_schedules (id, date, blocks, overflow, created_at, updated_at)
        VALUES ($id, $date, $blocks, $overflow, $created_at, $updated_at)
      `).run({
        $id: id,
        $date: date,
        $blocks: blocksJson,
        $overflow: overflowJson,
        $created_at: now,
        $updated_at: now
      });
    }

    return {
      id,
      date,
      blocks,
      overflow,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };
  }
}
