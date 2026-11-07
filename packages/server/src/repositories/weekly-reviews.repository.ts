import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export interface WeeklyReview {
  id: string;
  week_start: string;
  what_worked: string;
  what_to_refine: string;
  improvements: string[];
  created_at: number;
}

export class WeeklyReviewsRepository extends BaseRepository<WeeklyReview> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'weekly_reviews');
  }

  findAllRaw(): any[] {
    return this.db.query(`SELECT * FROM weekly_reviews ORDER BY created_at DESC`).all();
  }

  findAllParsed(): WeeklyReview[] {
    return this.findAllRaw().map(r => ({
      ...r,
      improvements: JSON.parse(r.improvements)
    }));
  }

  findByWeek(weekStart: string): WeeklyReview | null {
    const row = this.db.query<any, any>(`SELECT * FROM weekly_reviews WHERE week_start = $ws`).get({ $ws: weekStart });
    if (!row) return null;
    return {
      ...row,
      improvements: JSON.parse(row.improvements)
    };
  }

  create(weekStart: string, whatWorked: string = '', whatToRefine: string = '', improvements: string[] = []): WeeklyReview {
    const id = randomUUID();
    const created_at = Date.now();
    const impJson = JSON.stringify(improvements);

    this.db.query(`
      INSERT INTO weekly_reviews (id, week_start, what_worked, what_to_refine, improvements, created_at)
      VALUES ($id, $ws, $ww, $wr, $imp, $ca)
    `).run({
      $id: id,
      $ws: weekStart,
      $ww: whatWorked,
      $wr: whatToRefine,
      $imp: impJson,
      $ca: created_at
    });

    return { id, week_start: weekStart, what_worked: whatWorked, what_to_refine: whatToRefine, improvements, created_at };
  }
}
