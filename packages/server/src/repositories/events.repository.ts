import { Event } from '@secretary/shared';
import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export class EventsRepository extends BaseRepository<Event> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'events');
  }

  findByDateRange(startMs: number, endMs: number): Event[] {
    return this.db.query<Event, any>(`
      SELECT * FROM events 
      WHERE start_ts < $endMs AND end_ts > $startMs 
      ORDER BY start_ts
    `).all({ $startMs: startMs, $endMs: endMs });
  }

  create(data: Omit<Event, 'id' | 'created_at' | 'updated_at'>): Event {
    const now = Date.now();
    const id = randomUUID();
    const event: Event = {
      id,
      ...data,
      all_day: Boolean(data.all_day),
      created_at: now,
      updated_at: now
    };

    this.db.query(`
      INSERT INTO events (id, title, start_ts, end_ts, all_day, recurrence_rule, location, description, created_at, updated_at)
      VALUES ($id, $title, $start_ts, $end_ts, $all_day, $recurrence, $location, $description, $created_at, $updated_at)
    `).run({
      $id: event.id,
      $title: event.title,
      $start_ts: event.start_ts,
      $end_ts: event.end_ts,
      $all_day: event.all_day ? 1 : 0,
      $recurrence: event.recurrence_rule || null,
      $location: event.location || null,
      $description: event.description || null,
      $created_at: event.created_at,
      $updated_at: event.updated_at
    });

    return event;
  }

  update(id: string, updates: Partial<Event>): Event | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updated_at: Date.now() };

    this.db.query(`
      UPDATE events 
      SET title = $title, start_ts = $start_ts, end_ts = $end_ts, all_day = $all_day, 
          recurrence_rule = $recurrence, location = $location, description = $description, updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: merged.id,
      $title: merged.title,
      $start_ts: merged.start_ts,
      $end_ts: merged.end_ts,
      $all_day: merged.all_day ? 1 : 0,
      $recurrence: merged.recurrence_rule || null,
      $location: merged.location || null,
      $description: merged.description || null,
      $updated_at: merged.updated_at
    });

    return merged;
  }
}
